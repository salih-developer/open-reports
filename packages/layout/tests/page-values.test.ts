import { describe, it, expect } from "vitest";
import { parseReportDefinition } from "@reporting/schema";
import { DataSourceRegistry, InlineDataSource, resolveReport } from "@reporting/core";
import { paginate } from "../src/paginate.js";
import type { PositionedNode } from "../src/types.js";

const registry = new DataSourceRegistry();
registry.register(new InlineDataSource());

const amounts = (n: number) => Array.from({ length: n }, (_, i) => ({ no: i + 1, amount: i + 1, side: i < n / 2 ? "A" : "B" }));

async function run(def: { sections: unknown[]; data?: unknown; variables?: unknown[]; groups?: unknown[] }) {
  const doc = {
    schemaVersion: "1.0", id: "p", name: "p",
    page: { size: "custom", width: 300, height: 300, unit: "pt", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
    datasets: [{ id: "d", source: "inline", query: { data: def.data ?? amounts(10) } }],
    variables: def.variables ?? [
      { id: "total", scope: "row", expression: "(vars.total ?? 0) + row.amount" },
      { id: "pageSum", scope: "page", expression: 'sumBy(page.rows, "amount")' },
    ],
    groups: def.groups ?? [],
    sections: def.sections,
  };
  const parsed = parseReportDefinition(doc);
  if (!parsed.valid) throw new Error(JSON.stringify(parsed.issues));
  const resolved = await resolveReport(parsed.report, { registry, parameters: {} });
  return paginate(resolved.resolved, { resolvePageDependentSection: resolved.resolvePageSection });
}

function* all(nodes: PositionedNode[]): Generator<PositionedNode> {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* all(node.children);
  }
}
const texts = (nodes: PositionedNode[]) => [...all(nodes)].map((n) => (n.component as { text?: string }).text).filter((t): t is string => typeof t === "string" && t !== "");

// Devreden (carried forward) in the header, nakli yekûn (carried to the next page) and the page subtotal in the footer.
const pageBands = [
  { type: "pageHeader", height: 20, children: [{ type: "text", expression: '"Devreden " + (page.start.total ?? 0)' }] },
  { type: "pageFooter", height: 20, children: [{ type: "text", expression: '"Nakli " + (page.end.total ?? 0) + " | sayfa " + vars.pageSum + " | " + count(page.rows) + " kayıt"' }] },
];

describe("page values: records per page and carried-forward totals", () => {
  it("gives page headers and footers the running value before and after each page's records", async () => {
    // 260 pt of body per page and 60 pt records: 4, 4 and 2 records.
    const pag = await run({ sections: [...pageBands, { type: "detail", dataset: "d", height: 60, children: [{ type: "text", binding: "row.no" }] }] });
    expect(pag.pages.map((p) => texts(p.content))).toEqual([["1", "2", "3", "4"], ["5", "6", "7", "8"], ["9", "10"]]);
    expect(pag.pages.map((p) => texts(p.header))).toEqual([["Devreden 0"], ["Devreden 10"], ["Devreden 36"]]);
    expect(pag.pages.map((p) => texts(p.footer))).toEqual([["Nakli 10 | sayfa 10 | 4 kayıt"], ["Nakli 36 | sayfa 26 | 4 kayıt"], ["Nakli 55 | sayfa 19 | 2 kayıt"]]);
  });

  it("follows a reset variable through groups", async () => {
    const pag = await run({
      variables: [{ id: "total", scope: "row", expression: "(vars.total ?? 0) + row.amount", resetOn: "side" }, { id: "pageSum", scope: "page", expression: 'sumBy(page.rows, "amount")' }],
      groups: [{ id: "side", by: "row.side" }],
      sections: [...pageBands, { type: "groupHeader", groupId: "side", height: 20, children: [{ type: "text", expression: '"Taraf " + group.key' }] },
        { type: "detail", dataset: "d", height: 60, children: [{ type: "text", binding: "row.no" }] }],
    });
    // Group A is 1..5 (total 15); group B restarts at 6.
    const footers = pag.pages.map((p) => texts(p.footer)[0]);
    const bodies = pag.pages.map((p) => texts(p.content));
    const lastOn = (page: number) => Number(bodies[page]!.filter((t) => /^\d+$/.test(t)).at(-1));
    const running = (no: number) => (no <= 5 ? (no * (no + 1)) / 2 : ((no * (no + 1)) / 2) - 15);
    bodies.forEach((_, page) => expect(footers[page]).toMatch(new RegExp(`^Nakli ${running(lastOn(page))} `)));
  });

  it("counts table rows on the page they print on", async () => {
    const pag = await run({
      data: amounts(40),
      sections: [...pageBands, { type: "detail", children: [{ type: "table", dataset: "d", columns: [{ header: "No", binding: "row.no" }, { header: "Tutar", binding: "row.amount" }] }] }],
    });
    expect(pag.pages.length).toBeGreaterThan(1);
    let before = 0;
    for (const page of pag.pages) {
      const table = [...all(page.content)].find((n) => n.component.type === "table")!;
      const range = table.rowRange!;
      const through = ((range.end) * (range.end + 1)) / 2;
      expect(texts(page.header)).toEqual([`Devreden ${before}`]);
      expect(texts(page.footer)[0]).toBe(`Nakli ${through} | sayfa ${through - before} | ${range.end - range.start} kayıt`);
      before = through;
    }
    expect(before).toBe((40 * 41) / 2);
  });

  it("keeps printed records out of the JSON layout", async () => {
    const pag = await run({ sections: [...pageBands, { type: "detail", dataset: "d", height: 60, children: [{ type: "text", binding: "row.no" }] }] });
    const json = JSON.stringify(pag);
    expect(json).not.toContain('"vars"');
    expect(json).not.toContain('"amount"');
  });
});
