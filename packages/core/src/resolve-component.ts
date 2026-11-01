import { applyLegacyStyleWhen, applyOwnRules, type RuleDecision } from "./rules.js";
import { resolveGapToken, resolveStyleTokens, withTextStyle, type UnknownToken } from "./theme.js";
import { resolveTableStyles, type ResolvedTableStyles } from "./table-styles.js";
import type { Theme } from "@reporting/schema";
import { ExpressionEngine } from "@reporting/expressions";
import type { ResolveContext } from "./context.js";
import { formatValue } from "./format.js";
import type {
  ResolvedComponent,
  ResolvedGroupInstance,
  ResolvedTableCellSpan,
  ResolvedTableColumn,
  ResolvedTableRow,
  ResolvedWarning,
} from "./resolved-report.js";
import { aggregate } from "./aggregate.js";
import { pivotCrosstab, type CrosstabDefinition } from "./crosstab.js";
import { resolveLink, type ResolvedLink } from "./links.js";
import { PRINTED_RECORD } from "./resolved-report.js";
import type { LinkDefinition } from "@reporting/schema";
import { combineTableSpans, repeatedValueSpans, tableCellSpanErrors, tableCellSpanGrid, type TableCellSpanDefinition } from "./table-cell-spans.js";
import { evaluateRowVariables, computeGroupVariables } from "./variables.js";
import { applyCellRules, applyRowRules, hiddenColumns, withoutColumns } from "./table-rules.js";
import type { VariableDefinition } from "@reporting/schema";

// The schema package intentionally keeps the component tree loosely typed
// (see AnyComponent in @reporting/schema) because it is recursive; the
// resolver works against that same loose shape.
export type Component = Record<string, any> & { type: string };

export interface ResolveEnv {
  engine: ExpressionEngine;
  locale: string;
  currency: string;
  timeZone?: string;
  variables: VariableDefinition[];
  rowVarAccumulator: Record<string, unknown>;
  warnings: ResolvedWarning[];
  path: string;
  /** Design-time mode: a component that throws becomes a visible error placeholder + warning instead of failing the whole report. */
  tolerant?: boolean;
  fragments?: Map<string, Component[]>;
  fragmentStack?: string[];
  customComponents?: Map<string, CustomComponentExpander>;
  /** Rule decisions are collected here when rule tracing is on. */
  decisions?: RuleDecision[];
  /** Report theme: tokens ("$name") and named text styles are resolved against it. */
  theme?: Theme;
  /** Optional nested-report resolver; supplied by the pipeline after report lookup is configured. */
  subreportResolver?: (component: Component, ctx: ResolveContext, env: ResolveEnv) => ResolvedComponent;
  subreportStack?: string[];
}

/** Resolves theme tokens in a style, reporting unknown ones against the component. */
export function themeStyle(style: Record<string, unknown> | undefined, env: ResolveEnv, componentId?: string): Record<string, unknown> | undefined {
  const unknown: UnknownToken[] = [];
  const resolved = resolveStyleTokens(style, env.theme, unknown);
  for (const item of unknown) env.warnings.push({ code: "THEME_UNKNOWN_TOKEN", path: `${env.path}.style.${item.key}`, componentId, message: `Theme token ${item.token} is not defined in theme.${item.category}; ${item.key} was left unset.` });
  return resolved;
}

/** A component with its text style applied and every theme token in its style and gap resolved. */
function themeComponent<T extends Component>(component: T, env: ResolveEnv): T {
  const c = component as any;
  if (!c.style && !c.textStyle && c.gap === undefined) return component;
  if (c.textStyle && !env.theme?.textStyles?.[c.textStyle]) env.warnings.push({ code: "THEME_UNKNOWN_TEXT_STYLE", path: env.path, componentId: c.id, message: `Text style "${c.textStyle}" is not defined in theme.textStyles.` });
  const unknown: UnknownToken[] = [];
  const gap = resolveGapToken(c.gap, env.theme, unknown);
  for (const item of unknown) env.warnings.push({ code: "THEME_UNKNOWN_TOKEN", path: `${env.path}.gap`, componentId: c.id, message: `Theme token ${item.token} is not defined in theme.spacing; gap was left unset.` });
  return { ...c, style: themeStyle(withTextStyle(c.style, c.textStyle, env.theme), env, c.id), gap } as T;
}

/** Plugin hook: turns a `custom` component's props into ordinary components. Must be pure and deterministic. */
export type CustomComponentExpander = (props: Record<string, unknown>, ctx: { params: unknown; data: unknown; row: unknown; locale: string; currency: string }) => Component[];

function resolveValueLike(component: Component, ctx: ResolveContext, env: ResolveEnv): unknown {
  if (component.expression !== undefined) {
    return env.engine.evaluate(component.expression, ctx);
  }
  if (component.binding !== undefined) {
    return env.engine.evaluate(component.binding, ctx);
  }
  return component.value;
}


/** Resolves a dataset reference: an exact dataset id, or a dotted path into a
 * dataset's value (e.g. "invoice.items" for an array nested in an object
 * dataset), so master/detail JSON needs no flattening. */
export function lookupDataset(data: Record<string, unknown>, ref: string): unknown {
  if (ref in data) return data[ref];
  return ref.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, data);
}

/** Sources rooted at the current record (`row.lines`, `parent.items`, `group.rows`) are that record's nested list. */
export const ROW_RELATIVE_SOURCE = /^(row|parent|group)(\.|$)/;

/** Rows for a table, repeater, list, chart or group: a report dataset (or dotted path into one), or a nested list of the current record. */
export function sourceRows(ref: string, ctx: ResolveContext, env: ResolveEnv): unknown {
  if (!ROW_RELATIVE_SOURCE.test(ref)) return lookupDataset(ctx.data, ref);
  try {
    return env.engine.evaluate(ref, ctx);
  } catch (err) {
    env.warnings.push({ code: "NESTED_LIST_UNAVAILABLE", path: env.path, message: `"${ref}" could not be read: ${err instanceof Error ? err.message : String(err)}` });
    return undefined;
  }
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function applyStyleWhen(rules: { when: string; style: Record<string, unknown> }[], base: Record<string, unknown> | undefined, ctx: ResolveContext, env: ResolveEnv): Record<string, unknown> {
  let style: Record<string, unknown> = { ...(base ?? {}) };
  for (const rule of rules) {
    try {
      if (env.engine.evaluate(rule.when, ctx)) style = { ...style, ...rule.style };
    } catch (err) {
      env.warnings.push({ code: "STYLE_EXPRESSION_FAILED", path: env.path, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return style;
}

function toRowContext(ctx: ResolveContext, row: unknown): ResolveContext {
  return { ...ctx, row: row as Record<string, unknown>, parent: ctx.row };
}

export function resolveComponents(components: Component[], ctx: ResolveContext, env: ResolveEnv): ResolvedComponent[] {
  const out: ResolvedComponent[] = [];
  for (const component of components) {
    let resolved: ResolvedComponent | ResolvedComponent[] | null;
    if (env.tolerant) {
      try {
        resolved = resolveComponent(component, ctx, env);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        env.warnings.push({ code: "COMPONENT_ERROR", path: env.path, message, componentId: component.id });
        resolved = { id: component.id, type: "text", text: `\u26a0 ${message.replace(/^Expression error in ".*?": /, "")}`, style: { color: "#b91c1c", fontSize: 8 } } as ResolvedComponent;
      }
    } else {
      resolved = resolveComponent(component, ctx, env);
    }
    if (resolved && !Array.isArray(resolved) && component.styleWhen) {
      const target = { kind: "component" as const, id: component.id, path: env.path };
      resolved = { ...resolved, style: themeStyle(applyLegacyStyleWhen(component.styleWhen, resolved.style, ctx, { engine: env.engine, warnings: env.warnings, decisions: env.decisions, target }), env, component.id) } as ResolvedComponent;
    }
    if (resolved) out.push(...(Array.isArray(resolved) ? resolved : [resolved]));
  }
  return out;
}

function base(component: Component) {
  return {
    id: component.id,
    layout: component.layout,
    x: component.x,
    y: component.y,
    width: component.width,
    height: component.height,
    style: component.style,
    pageBreakBefore: component.pageBreakBefore,
    pageBreakAfter: component.pageBreakAfter,
    keepTogether: component.keepTogether,
    keepWithNext: component.keepWithNext,
    gap: component.gap,
    wrap: component.wrap,
    alignItems: component.alignItems,
    justifyContent: component.justifyContent,
    grow: component.grow,
    shrink: component.shrink,
    minWidth: component.minWidth,
    maxWidth: component.maxWidth,
    minHeight: component.minHeight,
    maxHeight: component.maxHeight,
    exports: component.exports,
    bookmark: component.bookmark,
    bookmarkLevel: component.bookmarkLevel,
  };
}

function resolveComponent(definition: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent | ResolvedComponent[] | null {
  const resolved = resolveComponentBody(definition, ctx, env);
  if (!resolved || !definition.link || definition.type === "table" || definition.type === "crosstab") return resolved;
  const link = linkFor(definition.link, ctx, env, definition.id);
  if (!link) return resolved;
  return Array.isArray(resolved) ? resolved.map((item) => ({ ...item, link })) : { ...resolved, link };
}

function linkFor(link: LinkDefinition, ctx: ResolveContext, env: ResolveEnv, componentId?: string) {
  return resolveLink(link, (expression) => env.engine.evaluate(expression, ctx), (message) => env.warnings.push({ code: "LINK_BLOCKED", path: env.path, componentId, message }));
}

function resolveComponentBody(definition: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent | ResolvedComponent[] | null {
  if (definition.hidden) return null;
  const ruled = applyOwnRules(definition, ctx, {
    engine: env.engine, warnings: env.warnings, decisions: env.decisions,
    target: { kind: "component", id: definition.id, path: env.path },
    visibleWhenErrors: "show",
  });
  if (ruled.hidden) return null;
  // Rules run first, so a rule can switch a text style or set a token.
  const component = themeComponent(ruled, env);

  switch (component.type) {
    case "text":
    case "richText":
    case "field": {
      const raw = resolveValueLike(component, ctx, env);
      return { ...base(component), type: component.type, text: formatValue(raw, component.format, env) };
    }
    case "image": {
      const src = component.binding ? env.engine.evaluate(component.binding, ctx) : component.src;
      if (!src && component.whenMissing === "hide") return null;
      if (!src && component.whenMissing === "fail") throw new Error(`Image "${component.id ?? "image"}" has no source and whenMissing is "fail".`);
      return { ...base(component), type: "image", src: src as string | undefined, fit: component.fit ?? "contain", alt: component.alt };
    }
    case "line":
      return { ...base(component), type: "line", orientation: component.orientation ?? "horizontal" };
    case "rectangle":
      return { ...base(component), type: "rectangle" };
    case "spacer":
      return { ...base(component), type: "spacer" };
    case "pageBreak":
      return { ...base(component), type: "pageBreak" };
    case "qrcode": {
      const value = String(resolveValueLike(component, ctx, env) ?? "");
      if (!value) env.warnings.push({ code: "EMPTY_QRCODE_VALUE", path: env.path, message: "QR code has no value to encode." });
      return { ...base(component), type: "qrcode", value };
    }
    case "barcode": {
      const value = String(resolveValueLike(component, ctx, env) ?? "");
      if (!value) env.warnings.push({ code: "EMPTY_BARCODE_VALUE", path: env.path, message: "Barcode has no value to encode." });
      return { ...base(component), type: "barcode", value, symbology: component.symbology ?? "code128" };
    }
    case "chart": {
      const dataset = component.dataset ? sourceRows(component.dataset, ctx, env) : undefined;
      const rows = toArray(dataset);
      const categories = component.categoryBinding
        ? rows.map((row) => String(env.engine.evaluate(component.categoryBinding, toRowContext(ctx, row))))
        : rows.map((_, i) => String(i));
      const series = (component.series ?? []).map((s: { name: string; binding?: string; expression?: string }) => ({
        name: s.name,
        values: rows.map((row) => {
          const rowCtx = toRowContext(ctx, row);
          const v = s.expression ? env.engine.evaluate(s.expression, rowCtx) : env.engine.evaluate(s.binding!, rowCtx);
          return Number(v) || 0;
        }),
      }));
      return { ...base(component), type: "chart", chartType: component.chartType, title: component.title, categories, series };
    }
    case "table":
      return resolveTable(component, ctx, env);
    case "crosstab":
      return resolveCrosstab(component, ctx, env);
    case "group":
      return resolveGroup(component, ctx, env);
    case "container":
    case "row":
    case "column":
    case "grid":
    case "keepTogether": {
      const children = resolveComponents(component.children ?? [], ctx, env);
      return { ...base(component), type: component.type, columns: component.columns, children };
    }
    case "repeater": {
      const rows = toArray(sourceRows(component.dataset, ctx, env));
      const perItem = rows.map((row) => resolveComponents(component.children ?? [], toRowContext(ctx, row), env));
      if (component.itemLayout === "row") {
        const items = perItem.map((children) => ({ type: "container", children }) as ResolvedComponent);
        return { ...base(component), type: "repeater", layout: "row", wrap: component.wrap ?? true, children: items };
      }
      if (component.itemLayout === "grid") {
        // One grid container per row of items, so pagination breaks between rows of items and never through one.
        const columns = Math.max(1, Number(component.columns) || 2);
        const rowsOfItems: ResolvedComponent[] = [];
        for (let i = 0; i < perItem.length; i += columns) {
          const items = perItem.slice(i, i + columns).map((children) => ({ type: "container", children }) as ResolvedComponent);
          rowsOfItems.push({ type: "container", layout: "grid", columns, gap: component.gap, children: items } as ResolvedComponent);
        }
        return { ...base(component), type: "repeater", layout: "flow", children: rowsOfItems };
      }
      return { ...base(component), type: "repeater", children: perItem.flat() };
    }
    case "labelSheet":
      return resolveLabelSheet(component, ctx, env);
    case "custom": {
      const expand = env.customComponents?.get(component.kind);
      if (!expand) {
        env.warnings.push({ code: "UNKNOWN_CUSTOM_COMPONENT", path: env.path, message: `No plugin provides the custom component "${component.kind}". Install or enable the plugin.`, componentId: component.id });
        return null;
      }
      let expanded: Component[];
      try {
        expanded = expand(component.props ?? {}, { params: ctx.params, data: ctx.data, row: ctx.row, locale: env.locale, currency: env.currency });
      } catch (err) {
        env.warnings.push({ code: "CUSTOM_COMPONENT_FAILED", path: env.path, message: `Plugin component "${component.kind}" failed: ${err instanceof Error ? err.message : String(err)}`, componentId: component.id });
        return null;
      }
      const inner = resolveComponents(expanded, ctx, env);
      return { ...base(component), type: "container", children: inner } as ResolvedComponent;
    }
    case "conditional": {
      const when = Boolean(env.engine.evaluate(component.when, ctx));
      return resolveComponents(when ? component.children ?? [] : component.otherwise ?? [], ctx, env);
    }
    case "fragment": {
      const children = env.fragments?.get(component.ref);
      if (!children) {
        env.warnings.push({ code: "UNKNOWN_FRAGMENT", path: env.path, message: `Reusable block "${component.ref}" is not defined in this report.`, componentId: component.id });
        return null;
      }
      const stack = env.fragmentStack ?? [];
      if (stack.includes(component.ref)) {
        env.warnings.push({ code: "CIRCULAR_FRAGMENT", path: env.path, message: `Reusable block "${component.ref}" contains itself.`, componentId: component.id });
        return null;
      }
      const inner = resolveComponents(children, ctx, { ...env, fragmentStack: [...stack, component.ref] });
      return { ...base(component), type: "container", children: inner } as ResolvedComponent;
    }
    case "subreport":
      if (env.subreportResolver) return env.subreportResolver(component, ctx, env);
      env.warnings.push({
        code: "SUBREPORT_NOT_RENDERED",
        path: env.path,
        message: `Subreport "${component.reportId}" was not rendered: no child report was supplied.`,
      });
      return { ...base(component), type: "text", text: `[Subreport ${component.reportId} needs a report source]`, style: { ...component.style, color: "#b91c1c" } } as ResolvedComponent;
    default:
      env.warnings.push({ code: "UNKNOWN_COMPONENT_TYPE", path: env.path, message: `Unknown component type "${component.type}".` });
      return null;
  }
}

const MM_TO_PT = 72 / 25.4;
const MAX_LABELS = 20000;

/** Expands a label sheet into one fixed-size, absolutely positioned container per sheet (each starting a new page). */
function resolveLabelSheet(component: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent[] {
  const cols: number = component.columns;
  const rowsPerSheet: number = component.rows;
  const perSheet = cols * rowsPerSheet;
  const lw = component.labelWidth * MM_TO_PT;
  const lh = component.labelHeight * MM_TO_PT;
  const gx = (component.gapX ?? 0) * MM_TO_PT;
  const gy = (component.gapY ?? 0) * MM_TO_PT;
  const skip = Math.max(0, (component.startPosition ?? 1) - 1) % perSheet;

  const records: (Record<string, unknown> | null)[] = component.dataset
    ? toArray(sourceRows(component.dataset, ctx, env)).map((r) => r as Record<string, unknown>)
    : Array.from({ length: component.copies ?? perSheet }, () => null);
  if (records.length + skip > MAX_LABELS) {
    env.warnings.push({ code: "LABEL_SHEET_TOO_LARGE", path: env.path, message: `Label sheet would produce more than ${MAX_LABELS} labels; the rest were dropped.`, componentId: component.id });
    records.length = Math.max(0, MAX_LABELS - skip);
  }
  const cells: (Record<string, unknown> | null | undefined)[] = [...Array.from({ length: skip }, () => undefined), ...records];

  const sheets: ResolvedComponent[] = [];
  for (let start = 0; start < Math.max(cells.length, 1); start += perSheet) {
    const children: ResolvedComponent[] = [];
    for (let i = 0; i < perSheet; i++) {
      const cell = cells[start + i];
      if (cell === undefined) continue; // skipped position or past the last record
      const rowCtx = cell === null ? ctx : toRowContext(ctx, cell);
      children.push({
        type: "container",
        x: (i % cols) * (lw + gx),
        y: Math.floor(i / cols) * (lh + gy),
        width: lw,
        height: lh,
        style: component.outlines ? { border: { width: 0.25, color: "#9ca3af" } } : undefined,
        children: resolveComponents(component.children ?? [], rowCtx, env),
      } as ResolvedComponent);
    }
    sheets.push({
      id: component.id,
      type: "container",
      layout: "absolute",
      width: cols * lw + (cols - 1) * gx,
      height: rowsPerSheet * lh + (rowsPerSheet - 1) * gy,
      pageBreakBefore: start > 0,
      children,
    } as ResolvedComponent);
  }
  return sheets;
}

/** A crosstab is pivoted here and then resolved as an ordinary table over the pivoted rows. */
function resolveCrosstab(component: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent | null {
  const source = toArray(sourceRows(component.dataset, ctx, env));
  const { table, rows, truncatedColumns } = pivotCrosstab(component as unknown as CrosstabDefinition, source, (binding, row) => (binding ? env.engine.evaluate(binding, toRowContext(ctx, row)) : undefined));
  if (truncatedColumns > 0) {
    env.warnings.push({ code: "CROSSTAB_COLUMNS_TRUNCATED", path: env.path, componentId: component.id, message: `Crosstab shows the first ${table.columns.length} columns; ${truncatedColumns} more column values were left out. Raise maxColumns or group the column values.` });
  }
  // The pivoted rows live under a private dataset name so the normal table code can read them.
  const dataset = `__crosstab:${component.id ?? env.path}`;
  const asTable = {
    ...component,
    type: "table",
    dataset,
    columns: table.columns,
    headerRows: table.headerRows,
    showHeader: true,
    showFooter: table.showFooter,
    repeatHeaderOnPageBreak: component.repeatHeaderOnPageBreak ?? true,
  } as Component;
  return resolveTable(asTable, { ...ctx, data: { ...ctx.data, [dataset]: rows } }, env);
}

function resolveTable(definition: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent | null {
  const ruleEnv = { engine: env.engine, warnings: env.warnings, decisions: env.decisions, path: env.path, componentId: definition.id };
  const component = withoutColumns(definition as Component & { columns: any[] }, hiddenColumns(definition.columns ?? [], ctx, ruleEnv));
  const rawRows = toArray(sourceRows(component.dataset, ctx, env));
  let rows = rawRows.map((row) => row as Record<string, unknown>);

  if (component.filterWhen) {
    rows = rows.filter((row) => {
      try {
        return Boolean(env.engine.evaluate(component.filterWhen, toRowContext(ctx, row)));
      } catch {
        return true;
      }
    });
  }

  if (component.sortBy?.length) {
    const sortBy = component.sortBy as { binding: string; direction: "asc" | "desc" }[];
    rows = [...rows].sort((a, b) => {
      for (const s of sortBy) {
        const av = env.engine.evaluate(s.binding, toRowContext(ctx, a));
        const bv = env.engine.evaluate(s.binding, toRowContext(ctx, b));
        if (av === bv) continue;
        const cmp = (av as any) > (bv as any) ? 1 : -1;
        return s.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  const columns: ResolvedTableColumn[] = (component.columns ?? []).map((col: any) => ({
    id: col.id ?? col.binding ?? col.header ?? Math.random().toString(36).slice(2),
    header: col.header ?? "",
    width: col.width,
    align: col.align,
    format: col.format,
  }));

  const kept: Record<string, unknown>[] = [];
  const resolvedRows: ResolvedTableRow[] = rows.flatMap((row) => {
    const rowCtx = toRowContext(ctx, row);
    evaluateRowVariables(env.variables, env.engine, rowCtx, env.rowVarAccumulator);
    const raw: Record<string, unknown> = {};
    const formatted: Record<string, string> = {};
    (component.columns ?? []).forEach((col: any, i: number) => {
      const id = columns[i]!.id;
      const value = col.expression
        ? env.engine.evaluate(col.expression, { ...rowCtx, vars: env.rowVarAccumulator })
        : col.binding
          ? env.engine.evaluate(col.binding, rowCtx)
          : undefined;
      raw[id] = value;
      formatted[id] = formatValue(value, col.format, env);
    });
    const ruleCtx = { ...rowCtx, vars: { ...rowCtx.vars, ...env.rowVarAccumulator } };
    const legacy = component.rowStyleWhen?.length ? applyStyleWhen(component.rowStyleWhen, undefined, ruleCtx, env) : undefined;
    const rowOutcome = applyRowRules(component.rowRules, ruleCtx, ruleEnv);
    if (rowOutcome.hidden) return [];
    const style = rowOutcome.style ? { ...(legacy ?? {}), ...rowOutcome.style } : legacy;
    const themedRowStyle = themeStyle(style, env, component.id);
    const cellStyles: Record<string, Record<string, unknown>> = {};
    (component.columns ?? []).forEach((col: any, i: number) => {
      const id = columns[i]!.id;
      const cell = applyCellRules(col.rules, ruleCtx, raw[id], ruleEnv, i);
      if (cell.text !== undefined) formatted[id] = cell.text;
      const cellStyle = themeStyle(cell.style, env, component.id);
      if (cellStyle && Object.keys(cellStyle).length) cellStyles[id] = cellStyle;
    });
    const links: Record<string, ResolvedLink> = {};
    (component.columns ?? []).forEach((col: any, i: number) => {
      if (!col.link) return;
      const link = linkFor(col.link, rowCtx, env, component.id);
      if (link) links[columns[i]!.id] = link;
    });
    kept.push(row);
    return [{ raw, formatted, style: themedRowStyle && Object.keys(themedRowStyle).length ? themedRowStyle : undefined, ...(Object.keys(cellStyles).length ? { cellStyles } : {}), ...(Object.keys(links).length ? { links } : {}), [PRINTED_RECORD]: { row, vars: { ...env.rowVarAccumulator } } }];
  });
  rows = kept;

  const configuredSpans: TableCellSpanDefinition[] = component.cellSpans ?? [];
  const spanErrors = tableCellSpanErrors(columns.length, configuredSpans);
  if (spanErrors.length) throw new Error(spanErrors.join(" "));
  const warnSpan = (code: string, message: string) => env.warnings.push({ code, path: env.path, componentId: component.id, message });
  // Record-anchored merges are placed at the first output row (after sorting and filtering) whose field matches.
  const explicitSpans: ResolvedTableCellSpan[] = [];
  for (const [source, span] of configuredSpans.entries()) {
    let row = span.row;
    if (span.match) {
      const { field, value } = span.match;
      const index = rows.findIndex((record) => env.engine.evaluate(field, toRowContext(ctx, record)) === value);
      if (index < 0) {
        warnSpan("TABLE_SPAN_ANCHOR_NOT_FOUND", `Body merge anchored to ${field} = ${JSON.stringify(value)} was skipped: no output row matches.`);
        continue;
      }
      row = index;
    }
    const placed = { row: row!, column: span.column, colSpan: span.colSpan ?? 1, rowSpan: span.rowSpan ?? 1, source };
    if (placed.row + placed.rowSpan > resolvedRows.length) {
      warnSpan("TABLE_SPAN_OUT_OF_RANGE", `Body merge at row ${placed.row + 1} extends beyond ${resolvedRows.length} resolved table rows and was skipped.`);
      continue;
    }
    explicitSpans.push(placed);
  }
  const mergeColumns = (component.columns ?? []).map((col: any) => Boolean(col.mergeRepeated));
  const automaticSpans = mergeColumns.some(Boolean) ? repeatedValueSpans(mergeColumns, resolvedRows.map((row) => columns.map((col) => row.formatted[col.id] ?? ""))) : [];
  const cellSpans = combineTableSpans(explicitSpans, automaticSpans, warnSpan);
  const spanGrid = tableCellSpanGrid(cellSpans);
  for (const span of cellSpans) {
    if (span.splittable) continue;
    const anchorId = columns[span.column]!.id;
    const anchor = resolvedRows[span.row]!.formatted[anchorId] ?? "";
    let hidesDifferentValue = false;
    for (let row = span.row; row < span.row + (span.rowSpan ?? 1); row++) for (let column = span.column; column < span.column + (span.colSpan ?? 1); column++) {
      if (row === span.row && column === span.column) continue;
      if (!spanGrid.get(row)?.get(column)) continue;
      const value = resolvedRows[row]!.formatted[columns[column]!.id] ?? "";
      if (value !== "" && value !== anchor) hidesDifferentValue = true;
    }
    if (hidesDifferentValue) env.warnings.push({ code: "TABLE_MERGE_HIDES_DATA", path: env.path, componentId: component.id, message: `Body merge at row ${span.row + 1}, column ${span.column + 1} hides different values in covered cells.` });
  }

  if (component.showFooter) {
    (component.columns ?? []).forEach((col: any, i: number) => {
      if (!col.footer) return;
      const id = columns[i]!.id;
      const values = resolvedRows.map((r) => r.raw[id]);
      let value: unknown;
      if (col.footer.aggregate) {
        value = aggregate(col.footer.aggregate, values);
      } else if (col.footer.expression) {
        value = env.engine.evaluate(col.footer.expression, { ...ctx, data: { ...ctx.data, [component.dataset]: rows } });
      }
      columns[i]!.footer = { label: col.footer.label, value: formatValue(value, col.format, env), raw: value };
    });
  }

  if (resolvedRows.length === 0 && component.emptyState === "hide") return null;
  if (resolvedRows.length === 0 && component.emptyState === "message") {
    return { ...base(component), type: "text", text: component.emptyMessage ?? "No records found", style: { color: "#6b7280", ...(component.style ?? {}) } } as ResolvedComponent;
  }

  return {
    ...base(component),
    type: "table",
    columns,
    headerRows: component.headerRows,
    cellSpans,
    rows: resolvedRows,
    showHeader: component.showHeader ?? true,
    showFooter: component.showFooter ?? false,
    keepFooterTogether: component.keepFooterTogether ?? true,
    repeatHeaderOnPageBreak: component.repeatHeaderOnPageBreak ?? true,
    ...((): { styles?: ResolvedTableStyles } => {
      const unknown: UnknownToken[] = [];
      const styles = resolveTableStyles(component as any, env.theme, unknown);
      for (const item of unknown) env.warnings.push({ code: "THEME_UNKNOWN_TOKEN", path: `${env.path}.styles`, componentId: component.id, message: `Theme token ${item.token} is not defined in theme.${item.category}; it was left unset.` });
      return styles ? { styles } : {};
    })(),
    keepRowTogether: component.keepRowTogether ?? true,
    ...(component.allowRowSplit ? { allowRowSplit: true } : {}),
    minRowsBeforeBreak: component.minRowsBeforeBreak ?? 0,
    minRowsAfterBreak: component.minRowsAfterBreak ?? 0,
    alternateRowStyle: component.alternateRowStyle,
  };
}

function resolveGroup(component: Component, ctx: ResolveContext, env: ResolveEnv): ResolvedComponent {
  const datasetId: string | undefined = component.dataset;
  const rawRows = toArray(datasetId ? sourceRows(datasetId, ctx, env) : undefined).map((r) => r as Record<string, unknown>);

  const keyed = rawRows.map((row) => ({
    row,
    key: env.engine.evaluate(component.groupBy, toRowContext(ctx, row)),
  }));

  const direction = component.sortDirection === "desc" ? -1 : 1;
  keyed.sort((a, b) => {
    if (a.key === b.key) return 0;
    return (a.key as any) > (b.key as any) ? direction : -direction;
  });

  const groups: ResolvedGroupInstance[] = [];
  let current: { key: unknown; rows: Record<string, unknown>[] } | null = null;
  for (const item of keyed) {
    if (!current || current.key !== item.key) {
      if (current) groups.push(buildGroupInstance(component, ctx, env, datasetId, current.key, current.rows));
      current = { key: item.key, rows: [] };
    }
    current.rows.push(item.row);
  }
  if (current) groups.push(buildGroupInstance(component, ctx, env, datasetId, current.key, current.rows));

  return {
    ...base(component),
    type: "group",
    groupBy: component.groupBy,
    pageBreakBeforeGroup: component.pageBreakBeforeGroup,
    keepGroupTogether: component.keepGroupTogether,
    groups,
  };
}

function buildGroupInstance(
  component: Component,
  ctx: ResolveContext,
  env: ResolveEnv,
  datasetId: string | undefined,
  key: unknown,
  rows: Record<string, unknown>[]
): ResolvedGroupInstance {
  const groupVars = computeGroupVariables(env.variables, env.engine, ctx, datasetId, rows);
  const groupCtx: ResolveContext = { ...ctx, row: rows[0], vars: { ...ctx.vars, ...groupVars } };

  let header = resolveComponents(component.header ?? [], groupCtx, env);
  // Drill-down: the report's initial state, flipped for the keys a viewer toggled. Collapsed groups keep header and footer.
  let collapsed = false;
  if (component.drillDown) {
    const toggled = ((component.drillToggled as string[] | undefined) ?? []).includes(String(key));
    collapsed = (component.drillDown === "collapsed") !== toggled;
    if (header[0] && component.id) header = [{ ...header[0], drillToggle: { component: component.id, key: String(key), collapsed } }, ...header.slice(1)];
  }
  const children = collapsed ? [] : rows.flatMap((row) => resolveComponents(component.children ?? [], { ...toRowContext(ctx, row), vars: { ...ctx.vars, ...groupVars } }, env));
  const footer = resolveComponents(component.footer ?? [], groupCtx, env);

  return { key, header, children, footer };
}
