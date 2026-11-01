import type { ExpressionContext } from "@reporting/expressions";

/** A full evaluation context plus the report's own in-progress variable
 * accumulator, which core mutates as it walks rows (see variables.ts). The
 * expression engine only ever sees the plain ExpressionContext shape. */
export interface ResolveContext extends ExpressionContext {
  params: Record<string, unknown>;
  data: Record<string, unknown>;
  vars: Record<string, unknown>;
  report: Record<string, unknown>;
  page: {
    number?: number; total?: number; isFirst?: boolean; isLast?: boolean; isOdd?: boolean; isEven?: boolean;
    /** Page bands only: the records printed on this page, and every row variable before and after them. */
    rows?: Record<string, unknown>[]; start?: Record<string, unknown>; end?: Record<string, unknown>;
  };
}

export function childContext(ctx: ResolveContext, overrides: Partial<ResolveContext>): ResolveContext {
  return { ...ctx, ...overrides };
}
