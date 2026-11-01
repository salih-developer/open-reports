import type { VariableDefinition } from "@reporting/schema";
import type { ExpressionEngine } from "@reporting/expressions";
import type { ResolveContext } from "./context.js";

/** Evaluates every report-scoped variable once, over the full dataset context.
 * Report-scope variables typically aggregate an already-flat numeric dataset
 * (e.g. `sum(data.amounts)`); row/group-level totals should instead be
 * expressed as row/group variables or table column footer aggregates. */
export function computeReportVariables(
  definitions: VariableDefinition[],
  engine: ExpressionEngine,
  ctx: ResolveContext
): Record<string, unknown> {
  return evaluateAll(definitions.filter((v) => v.scope === "report"), engine, ctx);
}

/** Row-scope variables are evaluated once per row, in document order, with
 * `vars` pre-seeded from the running accumulator so an expression can
 * reference its own previous value (`vars.runningBalance + row.amount`),
 * enabling running-total/running-balance patterns; `resetOn` restarts one at each
 * instance of the named group (see bands.ts). The accumulator is
 * mutated in place and returned for convenience. */
export function evaluateRowVariables(
  definitions: VariableDefinition[],
  engine: ExpressionEngine,
  ctx: ResolveContext,
  accumulator: Record<string, unknown>
): Record<string, unknown> {
  const rowVars = definitions.filter((v) => v.scope === "row");
  // Before its first record a row variable reads as undefined, so `(vars.total ?? 0) + row.amount` starts at 0.
  for (const def of rowVars) if (!(def.id in accumulator)) accumulator[def.id] = undefined;
  for (const def of rowVars) {
    accumulator[def.id] = engine.evaluate(def.expression, { ...ctx, vars: { ...ctx.vars, ...accumulator } });
  }
  return accumulator;
}

/** Page-scope variables are evaluated once per page, for page headers, footers and backgrounds, with `page.rows`
 * (the records printed on that page) and `page.start` / `page.end` (row variables before and after them), so
 * `sumBy(page.rows, "amount")` is a page subtotal. */
export function computePageVariables(
  definitions: VariableDefinition[],
  engine: ExpressionEngine,
  ctx: ResolveContext
): Record<string, unknown> {
  return evaluateAll(definitions.filter((v) => v.scope === "page"), engine, ctx);
}

/** Group-scope variables are evaluated once per group instance, with the
 * group's own rows substituted in place of the full dataset under the given
 * dataset id, so `sum(data.items)` aggregates only that group's rows. */
export function computeGroupVariables(
  definitions: VariableDefinition[],
  engine: ExpressionEngine,
  ctx: ResolveContext,
  datasetId: string | undefined,
  groupRows: unknown[]
): Record<string, unknown> {
  const groupVars = definitions.filter((v) => v.scope === "group");
  const data = datasetId ? { ...ctx.data, [datasetId]: groupRows } : ctx.data;
  return evaluateAll(groupVars, engine, { ...ctx, data });
}

function evaluateAll(definitions: VariableDefinition[], engine: ExpressionEngine, ctx: ResolveContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of definitions) {
    result[def.id] = engine.evaluate(def.expression, { ...ctx, vars: { ...ctx.vars, ...result } });
  }
  return result;
}
