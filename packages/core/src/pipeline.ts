import { applyOwnRules, type RuleDecision } from "./rules.js";
import { checkDatasetShape, shapeCheckSummary } from "./dataset-shape.js";
import type { ReportDefinition } from "@reporting/schema";
import { ExpressionEngine } from "@reporting/expressions";
import { DataSourceRegistry } from "./datasource.js";
import { resolveParameters, type ParameterIssue } from "./parameters.js";
import { executeDatasets, type DatasetExecutionIssue } from "./datasets.js";
import { computePageVariables, computeReportVariables } from "./variables.js";
import { PAGE_BAND_TYPES } from "@reporting/schema";
import { expandBodyBands } from "./bands.js";
import { resolveNestedReport, type SubreportSource } from "./subreports.js";
import { bundledSubreports } from "./bundled-subreports.js";
import { lookupDataset, resolveComponents, themeStyle, type CustomComponentExpander, type ResolveEnv } from "./resolve-component.js";
import type { ResolvedComponent, ResolvedReport, ResolvedSection, ResolvedWarning } from "./resolved-report.js";
import type { ResolveContext } from "./context.js";

/** Re-resolves one section (by type) with a page-number-aware context. Used
 * for pageHeader/pageFooter (and reportFooter) content that references
 * `page.number`/`page.total` -- those can't be known until @reporting/layout
 * has paginated the report once, so the main pipeline pass above resolves
 * them with `page.number`/`total` as `undefined` and the layout engine calls
 * this afterwards, once per page, with the real values. */
export type PageSectionResolver = (section: ResolvedSection, page: PageValues) => ResolvedComponent[];

/**
 * What pagination knows about one page. `rows` are the records whose detail band or table row starts on the page;
 * `start` holds every row variable before them (the value carried forward from earlier pages) and `end` after them
 * (the value carried to the next page). Callers that do not track records omit them.
 */
export interface PageValues {
  number: number;
  total: number;
  rows?: Record<string, unknown>[];
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
}

export interface RenderPipelineOptions {
  registry: DataSourceRegistry;
  parameters?: Record<string, unknown>;
  maxRows?: number;
  datasetTimeoutMs?: number;
  /** See ResolveEnv.tolerant -- used by the designer so one bad binding doesn't blank the canvas. */
  tolerant?: boolean;
  /** Extra expression functions (from plugins). They cannot shadow built-ins. */
  functions?: Record<string, (...args: unknown[]) => unknown>;
  /** Plugin component expanders keyed by `custom.kind`. */
  customComponents?: Map<string, CustomComponentExpander>;
  /** Design view: expand each band once instead of per record/group (used by the designer's structure canvas). */
  design?: { ghosts: number };
  /** Record every rule decision (conditions, current values, what applied) in `ruleDecisions`, for the condition debugger. */
  traceRules?: boolean;
  /** Child definitions and already-authorized data. Child SQL is never executed implicitly. */
  subreports?: Record<string, SubreportSource>;
}

export interface RenderPipelineResult {
  resolved: ResolvedReport;
  issues: (ParameterIssue | DatasetExecutionIssue)[];
  resolvePageSection: PageSectionResolver;
  /** Rule decisions when `traceRules` is on (empty otherwise). Per-page decisions are appended as `resolvePageSection` runs. */
  ruleDecisions: RuleDecision[];
}

/** Page facts available to postLayout rules and expressions in page headers, footers and backgrounds. */
export function pageFacts(page: PageValues) {
  return { ...page, isFirst: page.number === 1, isLast: page.number === page.total, isOdd: page.number % 2 === 1, isEven: page.number % 2 === 0 };
}

/**
 * Runs the full staged pipeline described in the spec:
 * schema validation (assumed already done by the caller) -> parameter
 * resolution -> dataset execution -> expression evaluation -> component
 * resolution -> Resolved Report Tree. Every renderer consumes only the
 * output of this function.
 */
export async function resolveReport(report: ReportDefinition, options: RenderPipelineOptions): Promise<RenderPipelineResult> {
  const subreports = bundledSubreports(report, options.subreports);
  const locale = report.locale ?? report.theme?.locale ?? "en-US";
  const currency = report.theme?.currency ?? "USD";
  const timeZone = report.theme?.timezone || undefined;

  const { values: parameters, issues: parameterIssues } = resolveParameters(report.parameters, options.parameters ?? {});

  const { datasets, issues: datasetIssues } = await executeDatasets(report.datasets, options.registry, parameters, {
    maxRows: options.maxRows,
    timeoutMs: options.datasetTimeoutMs,
  });

  // Declared dataset contracts are checked against the full response, not a preview sample.
  const contractWarnings: ResolvedWarning[] = [];
  for (const definition of report.datasets) {
    if (!definition.schema || !(definition.id in datasets) || datasets[definition.id] === null) continue;
    const check = checkDatasetShape(definition.schema, datasets[definition.id]);
    const path = `datasets.${definition.id}`;
    if (check.issues.length) {
      const message = shapeCheckSummary(definition.id, check);
      if (definition.schema.onMismatch === "error") datasetIssues.push({ severity: "error", code: "DATASET_SHAPE_MISMATCH", path, message });
      else contractWarnings.push({ code: "DATASET_SHAPE_MISMATCH", path, message });
    } else if (!check.complete) {
      contractWarnings.push({ code: "DATASET_SHAPE_PARTIALLY_CHECKED", path, message: `${definition.id}: only ${check.checkedRows} of ${check.totalRows} rows were checked against the declared fields before the check limit; no problems were found in them.` });
    }
  }

  const engine = new ExpressionEngine({ locale, currency, timeZone, functions: options.functions });

  const baseCtx: ResolveContext = {
    params: parameters,
    data: datasets,
    vars: {},
    report: { id: report.id, name: report.name },
    // `number`/`total` are not known until layout/pagination runs; keeping the
    // keys present (rather than an empty object) means `page.number` reads as
    // `undefined` instead of throwing "Unknown field page". The layout engine
    // re-resolves pageHeader/pageFooter/reportFooter per page with real values.
    page: { number: undefined, total: undefined },
    // `row`/`parent` are always present (even if empty) so a binding like
    // `row.balance` used outside of any row-iteration context evaluates to
    // `undefined` rather than throwing "Unknown field row".
    row: {},
    parent: {},
  };

  const reportVars = computeReportVariables(report.variables, engine, baseCtx);
  baseCtx.vars = reportVars;

  // Jasper expressions in report/page bands can reference fields even though
  // those bands are not iterated over a dataset. Seed their context with the
  // first row of the primary dataset so imported $F references resolve.
  const primaryRows = datasets[report.datasets[0]?.id ?? ""];
  if (Array.isArray(primaryRows) && primaryRows[0] && typeof primaryRows[0] === "object") {
    baseCtx.row = primaryRows[0] as Record<string, unknown>;
  }

  const fragments = new Map<string, any[]>(report.fragments.map((f) => [f.id, f.children as any[]]));
  const warnings: ResolvedWarning[] = [...contractWarnings];
  const rowVarAccumulator: Record<string, unknown> = {};
  // Page bands read page.rows, page.start and page.end (filled in by pagination), and page-scoped variables
  // computed from them. Every row variable is a key of start/end, so `page.start.total ?? 0` reads before any record.
  const rowVariableIds = report.variables.filter((v) => v.scope === "row").map((v) => v.id);
  const noVars = () => Object.fromEntries(rowVariableIds.map((id) => [id, undefined]));
  // Body bands have no page of their own: they read no records and no values, so `page.start.total ?? 0` is 0 there.
  baseCtx.page = { ...baseCtx.page, rows: [], start: noVars(), end: noVars() };
  const pageContext = (page: ResolveContext["page"]): ResolveContext => {
    const ctx: ResolveContext = { ...baseCtx, page: { rows: [], ...page, start: { ...noVars(), ...page.start }, end: { ...noVars(), ...page.end } } };
    return { ...ctx, vars: { ...ctx.vars, ...computePageVariables(report.variables, engine, ctx) } };
  };
  const ruleDecisions: RuleDecision[] = [];
  const decisions = options.traceRules ? ruleDecisions : undefined;

  const makeEnv = (path: string): ResolveEnv => ({
    engine,
    locale,
    currency,
    timeZone,
    variables: report.variables,
    rowVarAccumulator,
    warnings,
    path,
    tolerant: options.tolerant,
    fragments,
    customComponents: options.customComponents,
    decisions,
    theme: report.theme,
    subreportStack: [report.id],
    subreportResolver: (component, ctx, env) => resolveNestedReport(component, ctx, env, subreports),
  });

  /** A page band's own rules decide whether it prints; in the per-page pass they also see `page.*`. */
  const pageBandChildren = (index: number, ctx: ResolveContext, env: ResolveEnv) => {
    const raw = report.sections[index]!;
    const band = applyOwnRules(raw, ctx, {
      engine, warnings: env.warnings, decisions: env.decisions,
      target: { kind: "band", id: raw.id, path: `sections[${index}]` },
      visibleWhenErrors: "show",
    });
    if (band.hidden && !options.design) return [];
    const children = resolveComponents(band.children as any, ctx, env);
    if (band.type === "background" || band.layout !== "absolute") return children;
    // A page master has one layout root. Its children must obey the band's
    // layout mode; feeding them directly to layoutBlock always stacks them.
    return [{
      type: "container",
      layout: band.layout,
      height: band.height || undefined,
      children,
    } as ResolvedComponent];
  };

  // Page-level bands (page header/footer masters, backgrounds) keep their own resolved section so they can be
  // re-resolved per page; every other band is expanded into printed band instances (see bands.ts).
  const pageSections: ResolvedSection[] = [];
  report.sections.forEach((section, index) => {
    if (!PAGE_BAND_TYPES.includes(section.type as any)) return;
    if (section.hidden && !options.design) return;
    pageSections.push({
      type: section.type,
      repeat: section.repeat,
      sourceIndex: index,
      appliesTo: section.appliesTo,
      style: themeStyle(section.style, makeEnv(`sections[${index}]`), section.id),
      children: pageBandChildren(index, pageContext(baseCtx.page), makeEnv(`sections[${index}]`)),
    });
  });
  const bodyChildren = expandBodyBands({ report, engine, baseCtx, datasets, rowVarAccumulator, makeEnv, design: options.design });
  const sections: ResolvedSection[] = [...pageSections, { type: "body", sourceIndex: -1, children: bodyChildren }];

  const resolved: ResolvedReport = {
    id: report.id,
    name: report.name,
    locale,
    page: report.page,
    theme: report.theme,
    sections,
    exports: report.exports,
    print: report.print,
    watermark: report.watermark,
    warnings,
  };

  const resolvePageSection: PageSectionResolver = (section, page) => {
    const raw = report.sections[section.sourceIndex];
    if (!raw) return section.children;
    const env: ResolveEnv = {
      engine,
      locale,
      currency,
      timeZone,
      variables: report.variables,
      rowVarAccumulator: { ...rowVarAccumulator },
      warnings,
      path: `sections[${section.sourceIndex}]`,
      tolerant: options.tolerant,
      fragments,
      customComponents: options.customComponents,
      decisions,
      theme: report.theme,
      subreportStack: [report.id],
      subreportResolver: (component, ctx, nestedEnv) => resolveNestedReport(component, ctx, nestedEnv, subreports),
    };
    return pageBandChildren(section.sourceIndex, pageContext(pageFacts(page)), env);
  };

  return { resolved, issues: [...parameterIssues, ...datasetIssues], resolvePageSection, ruleDecisions };
}
