import { applyOwnRules } from "./rules.js";
import { resolveGapToken } from "./theme.js";
import type { GroupDefinition, ReportDefinition, ReportSection } from "@reporting/schema";
import { DATA_BAND_TYPES, PAGE_BAND_TYPES } from "@reporting/schema";
import type { ExpressionEngine } from "@reporting/expressions";
import type { ResolveContext } from "./context.js";
import { computeGroupVariables, evaluateRowVariables } from "./variables.js";
import { lookupDataset, resolveComponents, themeStyle, type ResolveEnv } from "./resolve-component.js";
import { PRINTED_RECORD, type BandMeta, type PrintedRecord, type ResolvedComponent } from "./resolved-report.js";

export interface BandDeps {
  report: ReportDefinition;
  engine: ExpressionEngine;
  baseCtx: ResolveContext;
  datasets: Record<string, unknown>;
  rowVarAccumulator: Record<string, unknown>;
  makeEnv(path: string): ResolveEnv;
  /**
   * Design-time structure view: every band appears once (one record / one group chain, `ghosts` extra records),
   * nothing is dropped by visibility rules and expressions that cannot be evaluated yet degrade to placeholders.
   */
  design?: { ghosts: number };
}

interface Entry {
  s: ReportSection;
  index: number;
}

/** What `group.*` exposes to expressions inside a group's bands. */
export interface GroupContext {
  id: string;
  key: unknown;
  level: number;
  /** Zero-based index of this group instance within its parent. */
  index: number;
  count: number;
  rows: unknown[];
  first: unknown;
  last: unknown;
}

const isPageBand = (s: ReportSection) => (PAGE_BAND_TYPES as readonly string[]).includes(s.type);
const isDataBand = (s: ReportSection) => (DATA_BAND_TYPES as readonly string[]).includes(s.type);
const truthy = (v: unknown) => Boolean(v) && v !== "false" && v !== 0;

function compareKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** True when a resolved subtree prints nothing (empty text only). */
function isBlank(components: ResolvedComponent[]): boolean {
  return components.every((c: any) => {
    if (c.type === "text" || c.type === "richText" || c.type === "field") return String(c.text ?? "").trim() === "";
    if (Array.isArray(c.children)) return isBlank(c.children);
    if (c.type === "spacer") return true;
    return false;
  });
}

/**
 * Turns the report's body bands into the ordered list of band **instances** that get paginated:
 * static bands once, and for every data region the group / detail / footer bands expanded per record and group.
 * Pagination rules (keep-with-next chains, repeated group headers, page breaks) are attached here as band metadata
 * so the layout engine can enforce them and explain every decision.
 */
export function expandBodyBands(deps: BandDeps): ResolvedComponent[] {
  const { report, engine, baseCtx } = deps;
  const out: ResolvedComponent[] = [];
  const warn = (path: string, code: string, message: string) => deps.makeEnv(path).warnings.push({ code, path, message });

  const all: Entry[] = report.sections.map((s, index) => ({ s, index }));
  const body = all.filter((e) => !isPageBand(e.s) && e.s.type !== "columnHeader" && e.s.type !== "columnFooter");
  for (const e of all) if (e.s.type === "columnHeader" || e.s.type === "columnFooter") warn(`sections[${e.index}]`, "COLUMN_BANDS_NOT_SUPPORTED", `"${e.s.type}" bands need multi-column reports, which are not supported yet; the band was skipped.`);

  // child bands travel with their parent
  const byId = new Map(body.filter((e) => e.s.id).map((e) => [e.s.id!, e]));
  const childrenOf = new Map<string, Entry[]>();
  const attached = new Set<Entry>();
  for (const e of body) {
    if (e.s.type !== "child") continue;
    const parent = e.s.parent ? byId.get(e.s.parent) : undefined;
    if (!parent) {
      warn(`sections[${e.index}]`, "CHILD_BAND_WITHOUT_PARENT", `Child band "${e.s.name ?? e.s.id ?? e.index}" has no valid "parent"; it prints as a detail band instead.`);
      continue;
    }
    childrenOf.set(parent.s.id!, [...(childrenOf.get(parent.s.id!) ?? []), e]);
    attached.add(e);
  }
  const standalone = body.filter((e) => !attached.has(e));

  const band = (entry: Entry, ctx: ResolveContext, meta: Partial<BandMeta> = {}): ResolvedComponent[] => {
    const { index } = entry;
    if (entry.s.hidden && !deps.design) return [];
    const env = deps.makeEnv(`sections[${index}]`);
    // The band's own conditions (legacy visibleWhen, then rules) give the effective band for this instance.
    const s = applyOwnRules(entry.s, ctx, {
      engine, warnings: env.warnings, decisions: env.decisions,
      target: { kind: "band", id: entry.s.id, path: `sections[${index}]` },
      visibleWhenErrors: deps.design ? "show" : "throw",
    });
    if (s.hidden && !deps.design) return [];
    const hiddenByRule = Boolean(s.hidden);
    const children = resolveComponents(s.children as any, ctx, env);
    if (s.suppressWhenBlank && isBlank(children) && !deps.design) return [];
    const node: any = {
      id: s.id,
      type: "container",
      layout: s.layout,
      height: s.height,
      minHeight: s.minHeight,
      gap: resolveGapToken(s.gap, env.theme),
      wrap: s.wrap,
      alignItems: s.alignItems,
      justifyContent: s.justifyContent,
      columns: s.columns,
      style: themeStyle(s.style, env, s.id),
      pageBreakBefore: s.newPageBefore,
      pageBreakAfter: s.newPageAfter,
      // A band printed at the bottom moves whole, so it can be anchored as one block.
      keepTogether: s.keepTogether || s.printAtBottom,
      keepWithNext: s.keepWithNext,
      children,
      band: { ...meta, sectionIndex: index, sectionId: s.id, type: s.type, name: s.name, allowSplit: s.allowSplit ?? meta.allowSplit, ...(s.printAtBottom ? { printAtBottom: true } : {}), ...(hiddenByRule ? { hiddenByRule } : {}) } as BandMeta,
    };
    const result: ResolvedComponent[] = [node];
    for (const child of childrenOf.get(s.id ?? "") ?? []) {
      result.push(...band(child, ctx, { ...meta }));
    }
    if (result.length > 1) for (const n of result.slice(0, -1)) (n as any).keepWithNext = true; // a band stays with its child bands
    return result;
  };

  let instanceCounter = 0;
  // Static bands after a data region (notably reportFooter) can read the final
  // value of row variables accumulated by that region.
  const emitStatic = (entry: Entry) => out.push(...band(entry, {
    ...baseCtx,
    vars: { ...baseCtx.vars, ...deps.rowVarAccumulator },
  }, { allowSplit: true }));

  const emitRegion = (bands: Entry[]) => {
    const ownDataset = bands.find((b) => b.s.dataset)?.s.dataset;
    // --- groups used by this region (explicit ones keep report order, implicit ones follow)
    const explicit = report.groups.filter((g) => bands.some((b) => b.s.groupId === g.id));
    const implicit: GroupDefinition[] = [];
    const bandGroup = new Map<Entry, string>();
    for (const b of bands) {
      if (b.s.type === "groupHeader" && !b.s.groupId && b.s.groupBy) {
        const id = `@${b.index}`;
        implicit.push({ id, by: b.s.groupBy, sort: "asc", repeatHeader: false, newPage: "none", keepTogether: false, minDetailRows: 1 });
        bandGroup.set(b, id);
      } else if (b.s.groupId) bandGroup.set(b, b.s.groupId);
    }
    const open = [...implicit.map((g) => g.id)];
    for (const b of [...bands].reverse()) {
      if (b.s.type === "groupFooter" && !b.s.groupId) {
        const id = open.pop();
        if (id) bandGroup.set(b, id);
      }
    }
    const groups: GroupDefinition[] = [...explicit, ...implicit];
    for (const b of bands) if (b.s.groupId && !report.groups.some((g) => g.id === b.s.groupId)) warn(`sections[${b.index}]`, "UNKNOWN_GROUP", `Band "${b.s.name ?? b.s.type}" refers to group "${b.s.groupId}", which is not declared in report.groups.`);

    const datasetId = ownDataset ?? groups.find((g) => g.dataset)?.dataset;
    const found = datasetId ? lookupDataset(deps.datasets, datasetId) : undefined;
    let rows: Record<string, unknown>[] = Array.isArray(found) ? (found as Record<string, unknown>[]) : [];

    const ofType = (type: string, groupId?: string) => bands.filter((b) => b.s.type === type && (groupId === undefined || bandGroup.get(b) === groupId));

    if (deps.design) {
      // one example record (or a blank one while the dataset has no sample data yet), plus any requested ghosts
      const want = Math.max(1, deps.design.ghosts);
      if (!rows.length) rows = [{}];
      else if (groups.length) {
        // example records that belong to the same outermost group, so the group header/footer print once around them
        const k0 = (() => { try { return engine.evaluate(groups[0]!.by, { ...baseCtx, row: rows[0]! }); } catch { return undefined; } })();
        rows = rows.filter((r) => { try { return compareKeys(engine.evaluate(groups[0]!.by, { ...baseCtx, row: r }), k0) === 0; } catch { return true; } }).slice(0, want);
      } else rows = rows.slice(0, want);
    } else if (rows.length === 0) {
      for (const b of ofType("noData")) out.push(...band(b, baseCtx));
      return;
    }

    // --- sort by every group key (stable), outermost first
    const evalKey = (g: GroupDefinition, row: Record<string, unknown>) => {
      try {
        return engine.evaluate(g.by, { ...baseCtx, row });
      } catch (err) {
        if (deps.design) return undefined;
        throw err;
      }
    };
    if (groups.some((g) => g.sort !== "none") && !deps.design) {
      const keyed = rows.map((row, i) => ({ row, i, keys: groups.map((g) => evalKey(g, row)) }));
      keyed.sort((a, b) => {
        for (let k = 0; k < groups.length; k++) {
          if (groups[k]!.sort === "none") continue;
          const c = compareKeys(a.keys[k], b.keys[k]);
          if (c !== 0) return groups[k]!.sort === "desc" ? -c : c;
        }
        return a.i - b.i;
      });
      rows = keyed.map((k) => k.row);
    }

    const ctxFor = (row: Record<string, unknown> | undefined, group?: GroupContext, groupRows?: unknown[]): ResolveContext => {
      const ctx: ResolveContext = { ...baseCtx, row: (row ?? {}) as Record<string, unknown>, vars: { ...baseCtx.vars, ...deps.rowVarAccumulator } };
      if (group) {
        (ctx as any).group = group;
        if (groupRows && report.variables.some((v) => v.scope === "group")) {
          Object.assign(ctx.vars, computeGroupVariables(report.variables, engine, ctx, datasetId, groupRows));
        }
      }
      return ctx;
    };

    // Row variables accumulate once per detail record; resetOn names the group whose instances restart them.
    const resetVariables = new Map<string, string[]>();
    for (const v of report.variables) if (v.scope === "row" && v.resetOn) resetVariables.set(v.resetOn, [...(resetVariables.get(v.resetOn) ?? []), v.id]);
    const accumulateRowVariables = (row: Record<string, unknown>) => {
      try {
        evaluateRowVariables(report.variables, engine, { ...baseCtx, row, vars: { ...baseCtx.vars } }, deps.rowVarAccumulator);
      } catch (err) {
        if (!deps.design) throw err;
      }
    };

    for (const b of ofType("dataHeader")) out.push(...band(b, ctxFor(rows[0])));

    const details = bands.filter((b) => b.s.type === "detail" || (b.s.type === "child" && !attached.has(b)));
    // A table already iterates its dataset. When it is the sole detail content,
    // emit it once per group (or once for the whole dataset) instead of once per row.
    const tableDetail = details.length === 1 && details[0]!.s.children?.length === 1
      && (details[0]!.s.children[0] as any).type === "table"
      && (details[0]!.s.children[0] as any).dataset === datasetId;

    const emitLevel = (level: number, levelRows: Record<string, unknown>[], parentGroup?: GroupContext, parentInstance?: number) => {
      if (level >= groups.length) {
        if (tableDetail && datasetId) {
          const ctx = ctxFor(levelRows[0], parentGroup, parentGroup?.rows);
          // lookupDataset accepts an exact dotted reference before traversing
          // the root object, so nested array datasets can be scoped as well.
          ctx.data = { ...ctx.data, [datasetId]: levelRows };
          out.push(...band(details[0]!, ctx, { rowIndex: 0, level: parentGroup?.level, groupId: parentGroup?.id, groupKey: parentGroup?.key, instance: parentInstance }));
          return;
        }
        levelRows.forEach((row, rowIndex) => {
          accumulateRowVariables(row);
          const ctx = ctxFor(row, parentGroup, parentGroup?.rows);
          const record: PrintedRecord = { row, vars: { ...deps.rowVarAccumulator } };
          for (const d of details) out.push(...band(d, ctx, { rowIndex, level: parentGroup?.level, groupId: parentGroup?.id, groupKey: parentGroup?.key, instance: parentInstance, [PRINTED_RECORD]: record }));
        });
        return;
      }
      const g = groups[level]!;
      // partition consecutive records with the same key
      const parts: { key: unknown; rows: Record<string, unknown>[] }[] = [];
      for (const row of levelRows) {
        const key = evalKey(g, row);
        const last = parts[parts.length - 1];
        if (last && compareKeys(last.key, key) === 0) last.rows.push(row);
        else parts.push({ key, rows: [row] });
      }
      parts.forEach((part, index) => {
        const gctx: GroupContext = { id: g.id, key: part.key, level, index, count: part.rows.length, rows: part.rows, first: part.rows[0], last: part.rows[part.rows.length - 1] };
        for (const v of resetVariables.get(g.id) ?? []) deps.rowVarAccumulator[v] = undefined;
        const start = out.length;
        const instance = ++instanceCounter;
        const headers = ofType("groupHeader", g.id);
        for (const h of headers) {
          const nodes = band(h, ctxFor(part.rows[0], gctx, part.rows), { groupId: g.id, level, groupKey: part.key, instance, repeatEveryPage: h.s.repeatEveryPage ?? g.repeatHeader });
          out.push(...nodes);
        }
        const headerEnd = out.length;
        emitLevel(level + 1, part.rows, gctx, instance);
        const bodyEnd = out.length;
        for (const f of ofType("groupFooter", g.id)) out.push(...band(f, ctxFor(part.rows[part.rows.length - 1], gctx, part.rows), { groupId: g.id, level, groupKey: part.key, instance }));
        const end = out.length;
        if (end === start) return;

        const node = (i: number) => out[i] as any;
        // keep the header with its first detail record(s)
        if (headerEnd > start && g.minDetailRows > 0 && bodyEnd > headerEnd) {
          for (let i = start; i < headerEnd; i++) node(i).keepWithNext = true;
          let rowsKept = 0;
          let lastRow = -1;
          for (let i = headerEnd; i < bodyEnd && rowsKept < g.minDetailRows; i++) {
            const ri = node(i).band?.rowIndex;
            if (ri !== undefined && ri !== lastRow) {
              lastRow = ri;
              rowsKept++;
              if (rowsKept === g.minDetailRows) break; // the first node of the last kept row ends the chain
            }
            node(i).keepWithNext = true;
          }
        }
        // keep the last detail record with the group footer(s), unless the band opts out
        const firstFooter = ofType("groupFooter", g.id)[0];
        if (end > bodyEnd && bodyEnd > headerEnd && firstFooter && firstFooter.s.keepWithPrevious !== false) node(bodyEnd - 1).keepWithNext = true;
        if (g.keepTogether) for (let i = start; i < end - 1; i++) node(i).keepWithNext = true;
        if (g.newPage === "before") node(start).pageBreakBefore = true;
        if (g.newPage === "after") node(end - 1).pageBreakAfter = true;
      });
    };

    emitLevel(0, rows);
    for (const b of ofType("dataFooter")) out.push(...band(b, ctxFor(rows[rows.length - 1])));
    if (deps.design) for (const b of ofType("noData")) out.push(...band(b, baseCtx));
  };

  let i = 0;
  while (i < standalone.length) {
    const entry = standalone[i]!;
    if (!isDataBand(entry.s)) {
      emitStatic(entry);
      i++;
      continue;
    }
    let j = i;
    while (j < standalone.length && isDataBand(standalone[j]!.s)) j++;
    // split into regions when consecutive bands name different datasets
    let region: Entry[] = [];
    let regionDataset: string | undefined;
    const flush = () => {
      if (!region.length) return;
      const dynamic = region.some((b) => b.s.dataset || b.s.groupId || b.s.groupBy) || region.some((b) => ["groupHeader", "groupFooter", "dataHeader", "dataFooter", "noData"].includes(b.s.type));
      if (dynamic) emitRegion(region);
      else for (const b of region) emitStatic(b);
      region = [];
      regionDataset = undefined;
    };
    for (const e of standalone.slice(i, j)) {
      if (e.s.dataset && regionDataset && e.s.dataset !== regionDataset) flush();
      if (e.s.dataset) regionDataset ??= e.s.dataset;
      region.push(e);
    }
    flush();
    i = j;
  }
  void byId;
  return out;
}
