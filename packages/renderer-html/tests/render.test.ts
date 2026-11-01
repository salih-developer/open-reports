import { describe, it, expect } from "vitest";
import { parseReportDefinition } from "@reporting/schema";
import { DataSourceRegistry, InlineDataSource, resolveReport } from "@reporting/core";
import { HtmlRenderer } from "../src/render.js";

function registry() {
  const r = new DataSourceRegistry();
  r.register(new InlineDataSource());
  return r;
}

async function renderReport(doc: unknown, parameters: Record<string, unknown> = {}) {
  const parsed = parseReportDefinition(doc);
  if (!parsed.valid) throw new Error("fixture should be schema-valid: " + JSON.stringify(parsed.issues));
  const pipeline = await resolveReport(parsed.report, { registry: registry(), parameters });
  const renderer = new HtmlRenderer();
  return renderer.render({ resolved: pipeline.resolved, resolvePageSection: pipeline.resolvePageSection });
}

const invoiceReport = {
  schemaVersion: "1.0",
  id: "invoice",
  name: "Invoice <Test>",
  datasets: [
    {
      id: "items",
      source: "inline",
      query: { data: [{ description: "Widget", quantity: 2, price: 500 }] },
    },
  ],
  sections: [
    { type: "reportHeader", children: [{ type: "text", value: "My Company" }] },
    {
      type: "detail",
      children: [
        {
          type: "table",
          dataset: "items",
          showFooter: true,
          columns: [
            { id: "description", header: "Description", binding: "row.description" },
            { id: "amount", header: "Amount", expression: "row.quantity * row.price", format: "currency", footer: { aggregate: "sum" } },
          ],
        },
        { type: "qrcode", value: "INV-1001" },
      ],
    },
  ],
};

describe("HtmlRenderer", () => {
  it("keeps every line of a long narrative in paginated HTML", async () => {
    const markers = Array.from({ length: 80 }, (_, index) => `NARRATIVE${String(index + 1).padStart(3, "0")}`);
    const html = String((await renderReport({
      schemaVersion: "1.0", id: "narrative", name: "Long narrative",
      page: { size: "custom", unit: "pt", width: 300, height: 320, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      sections: [{ type: "detail", children: [{ type: "text", value: markers.join("\n"), width: 200 }] }],
    })).content);
    expect((html.match(/class="page"/g) ?? []).length).toBeGreaterThan(1);
    expect([...html.matchAll(/NARRATIVE\d{3}/g)].map((match) => match[0])).toEqual(markers);
  });

  it("keeps both columns of a tall row in paginated HTML", async () => {
    const left = Array.from({ length: 45 }, (_, index) => `LEFTCOL${String(index + 1).padStart(3, "0")}`);
    const right = Array.from({ length: 35 }, (_, index) => `RIGHTCOL${String(index + 1).padStart(3, "0")}`);
    const html = String((await renderReport({
      schemaVersion: "1.0", id: "tall-row", name: "Tall row",
      page: { size: "custom", unit: "pt", width: 320, height: 320, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      sections: [{ type: "detail", layout: "row", gap: 12, children: [
        { type: "text", value: left.join("\n"), width: 145 },
        { type: "text", value: right.join("\n"), width: 145 },
      ] }],
    })).content);
    expect((html.match(/class="page"/g) ?? []).length).toBeGreaterThan(1);
    expect([...html.matchAll(/LEFTCOL\d{3}/g)].map((match) => match[0])).toEqual(left);
    expect([...html.matchAll(/RIGHTCOL\d{3}/g)].map((match) => match[0])).toEqual(right);
  });

  it("renders basic report structure as a single page with correct mime type", async () => {
    const result = await renderReport(invoiceReport);
    expect(result.mimeType).toBe("text/html");
    expect(result.extension).toBe("html");
    const html = result.content as string;
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('class="page"');
    expect(html).toContain("My Company");
  });

  it("renders table rows and footer totals with correctly formatted currency", async () => {
    const html = (await renderReport(invoiceReport)).content as string;
    expect(html).toContain("Widget");
    expect(html).toContain("$1,000.00"); // 2 * 500
  });

  it("prints totals with the last data row on the next HTML page", async () => {
    const html = String((await renderReport({
      schemaVersion: "1.0", id: "totals-boundary", name: "Totals boundary",
      page: { size: "custom", unit: "pt", width: 300, height: 90, orientation: "landscape", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      datasets: [{ id: "items", source: "inline", query: { data: Array.from({ length: 4 }, (_, index) => ({ code: `ROW${String(index + 1).padStart(5, "0")}` })) } }],
      sections: [{ type: "detail", children: [{ type: "table", dataset: "items", showFooter: true, columns: [{ id: "code", header: "Code", binding: "row.code", footer: { expression: '"TOTALMARK"' } }] }] }],
    })).content);
    const pages = [...html.matchAll(/<section class="page"[^>]*>(.*?)<\/section>/gs)].map((match) => match[1]!);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("ROW00003");
    expect(pages[0]).not.toContain("ROW00004");
    expect(pages[1]).toContain("ROW00004");
    expect(pages[1]).toContain("TOTALMARK");
  });

  it("embeds the QR code as a self-contained PNG data URL image", async () => {
    const html = (await renderReport(invoiceReport)).content as string;
    expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+"/);
  });

  it("escapes report name and user-provided text to prevent HTML/script injection", async () => {
    const malicious = {
      ...invoiceReport,
      sections: [{ type: "detail", children: [{ type: "text", value: '<script>alert(1)</script>' }] }],
    };
    const html = (await renderReport(malicious)).content as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("splits a long table across multiple HTML pages with a repeated header", async () => {
    const manyRows = {
      ...invoiceReport,
      page: { size: "custom", width: 300, height: 320, unit: "pt", orientation: "portrait", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      datasets: [
        {
          id: "items",
          source: "inline",
          query: { data: Array.from({ length: 40 }, (_, i) => ({ description: `Item ${i}`, quantity: 1, price: 10 })) },
        },
      ],
      sections: [
        {
          type: "detail",
          children: [{ type: "table", dataset: "items", columns: [{ id: "description", header: "Description", binding: "row.description" }] }],
        },
      ],
    };
    const html = (await renderReport(manyRows)).content as string;
    const pageCount = (html.match(/class="page"/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    const theadCount = (html.match(/<thead>/g) ?? []).length;
    expect(theadCount).toBe(pageCount); // header repeated on every page
  });

  it("renders multi-level header spans on each paginated page", async () => {
    const doc = {
      ...invoiceReport,
      page: { size: "custom", width: 300, height: 320, unit: "pt", orientation: "portrait", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      datasets: [{ id: "items", source: "inline", query: { data: Array.from({ length: 40 }, (_, i) => ({ description: `Item ${i}`, price: i })) } }],
      sections: [{ type: "detail", children: [{
        type: "table", dataset: "items", columns: [{ id: "description", header: "Item", binding: "row.description" }, { id: "price", header: "Price", binding: "row.price" }],
        headerRows: [[{ column: 0, text: "Sale", colSpan: 2 }], [{ column: 0, text: "Item" }, { column: 1, text: "Price" }]],
      }] }],
    };
    const html = String((await renderReport(doc)).content);
    const pageCount = (html.match(/class="page"/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect((html.match(/colspan="2"/g) ?? []).length).toBe(pageCount);
    expect((html.match(/<thead>/g) ?? []).length).toBe(pageCount);
    expect((html.match(/<th(?:\s|>)/g) ?? []).length).toBe(pageCount * 3);
  });

  it("renders merged body cells with HTML colSpan and rowSpan", async () => {
    const doc = {
      ...invoiceReport,
      datasets: [{ id: "items", source: "inline", query: { data: [{ description: "Group A", quantity: 1, price: 2 }, { description: "Group A", quantity: 3, price: 4 }, { description: "Subtotal", quantity: 0, price: 6 }] } }],
      sections: [{ type: "detail", children: [{ type: "table", dataset: "items", columns: [
        { id: "description", header: "Description", binding: "row.description" },
        { id: "amount", header: "Amount", binding: "row.price" },
      ], cellSpans: [{ row: 0, column: 0, rowSpan: 2 }, { row: 2, column: 0, colSpan: 2 }] }] }],
    };
    const result = await renderReport(doc);
    const html = String(result.content);
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('colspan="2"');
    expect((html.match(/Group A/g) ?? [])).toHaveLength(1);
    expect(html).toContain("Subtotal");
    expect(result.warnings.some((warning) => warning.code === "TABLE_MERGE_HIDES_DATA")).toBe(true);
  });

  it("renders a chart as inline SVG", async () => {
    const withChart = {
      ...invoiceReport,
      sections: [
        {
          type: "detail",
          children: [
            { type: "chart", chartType: "bar", dataset: "items", categoryBinding: "row.description", series: [{ name: "Amount", binding: "row.price" }] },
          ],
        },
      ],
    };
    const html = (await renderReport(withChart)).content as string;
    expect(html).toContain("<svg");
    expect(html).toContain("<rect");
  });
});

describe("watermark", () => {
  it("is drawn on each page and its text is escaped", async () => {
    const r = await renderReport({ schemaVersion: "1.0", id: "w", name: "w", watermark: { text: "<DRAFT>" }, sections: [{ type: "detail", children: [{ type: "text", value: "x" }] }] });
    const html = String(r.content);
    expect(html).toContain('class="watermark"');
    expect(html).toContain("&lt;DRAFT&gt;");
    expect(html).not.toContain("<DRAFT>");
  });

  it("renders theme tokens and named text styles as their resolved values", async () => {
    const html = String((await renderReport({
      schemaVersion: "1.0", id: "themed", name: "Themed",
      theme: { colors: { brand: "#b91c1c" }, fonts: { heading: "Georgia" }, fontSizes: { xl: 18 }, textStyles: { title: { color: "$brand", fontSize: "$xl", fontFamily: "$heading" } } },
      sections: [{ type: "detail", children: [{ type: "text", value: "Themed heading", textStyle: "title" }] }],
    })).content);
    expect(html).toContain("Themed heading");
    expect(html).toMatch(/color:\s*#b91c1c/i);
    expect(html).toMatch(/font-size:\s*18pt|font-size:\s*24px/);
    expect(html).toContain("Georgia");
    expect(html).not.toContain("$brand");
  });

  it("renders table styles: section colours, stripes and grid-line modes", async () => {
    const html = async (lines: string) => String((await renderReport({
      schemaVersion: "1.0", id: "styled", name: "Styled",
      datasets: [{ id: "rows", source: "inline", query: { data: [{ a: "one" }, { a: "two" }, { a: "three" }] } }],
      sections: [{ type: "detail", children: [{ type: "table", dataset: "rows", columns: [{ id: "a", header: "A", binding: "row.a" }], showFooter: true,
        styles: { header: { background: "#1d4ed8", color: "#ffffff" }, alternateRow: { background: "#fde68a" }, footer: { italic: true }, grid: { lines, color: "#ff0000", width: 1 } } }] }],
    })).content);
    const all = await html("all");
    expect(all).toMatch(/<th[^>]*background-color:#1d4ed8[^>]*color:#ffffff|<th[^>]*color:#ffffff[^>]*background-color:#1d4ed8/);
    expect(all.match(/background-color:#fde68a/g)).toHaveLength(1);
    expect(all).toContain("font-style:italic");
    expect((all.match(/solid #ff0000/g) ?? []).length).toBeGreaterThan(4);
    expect(await html("none")).not.toContain("#ff0000");
    expect((await html("horizontal")).match(/border-bottom:[^;]*#ff0000/g)?.length).toBe(3);
  });
});

describe("box styles", () => {
  const report = (children: unknown[]) => ({ schemaVersion: "1.0", id: "box", name: "Box", sections: [{ type: "detail", children }] });
  it("moves bottom-aligned text down with extra top padding", async () => {
    const html = (await renderReport(report([{ type: "text", id: "t", value: "LOW", height: 60, style: { padding: 4, verticalAlign: "bottom" } }]))).content.toString();
    const top = Number(html.match(/padding-top:([\d.]+)px[^>]*>LOW</)?.[1]);
    // 60pt box, 4pt padding each side, one ~12pt line: about 44pt (58.7px) above the line.
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(65);
  });
  it("rounds corners with border-radius", async () => {
    const html = (await renderReport(report([{ type: "rectangle", width: 80, height: 40, style: { background: "#e0f2fe", borderRadius: 6 } }]))).content.toString();
    expect(html).toContain("border-radius:8px");
  });
});

describe("table rows split across pages", () => {
  it("prints each part of a split row with its line breaks", async () => {
    const note = Array.from({ length: 80 }, (_, i) => `line${i}`).join("\n");
    const html = (await renderReport({ schemaVersion: "1.0", id: "split", name: "Split",
      datasets: [{ id: "notes", source: "inline", query: { data: [{ note }] } }],
      sections: [{ type: "detail", children: [{ type: "table", dataset: "notes", allowRowSplit: true, columns: [{ id: "note", header: "Note", binding: "row.note" }] }] }],
    })).content.toString();
    expect(html.match(/class="page"/g)!.length).toBeGreaterThan(1);
    expect(html).toContain("white-space:pre-wrap");
    for (const i of [0, 40, 79]) expect(html).toContain(`line${i}`);
  });
});

describe("table rules", () => {
  it("styles rows and single cells", async () => {
    const html = (await renderReport({ schemaVersion: "1.0", id: "rules", name: "Rules",
      datasets: [{ id: "lines", source: "inline", query: { data: [{ item: "Rent", amount: 10 }, { item: "Refund", amount: -5 }] } }],
      sections: [{ type: "detail", children: [{ type: "table", dataset: "lines",
        rowRules: [{ when: "row.amount < 0", set: { "style.background": "#fee2e2" } }],
        columns: [{ id: "item", header: "Item", binding: "row.item" }, { id: "amount", header: "Amount", binding: "row.amount", rules: [{ when: "value < 0", set: { "style.color": "#b91c1c", text: "(5)" } }] }],
      }] }],
    })).content.toString();
    expect(html).toMatch(/<tr style="[^"]*background-color:#fee2e2[^"]*">/);
    expect(html).toMatch(/<td[^>]*color:#b91c1c[^>]*>\(5\)<\/td>/);
  });
});

describe("default text size", () => {
  it("sets the page's base font size to the layout's 10 pt so unsized text matches its measured box", async () => {
    const html = await renderReport({ schemaVersion: "1.0", id: "plain", name: "Plain", datasets: [], sections: [{ type: "detail", children: [{ type: "text", value: "Unsized" }] }] });
    expect(html.content.toString()).toMatch(/\.page \{[^}]*font-size: 13\.33px/);
  });
});

describe("carried-forward page totals", () => {
  it("prints devreden in each page header and nakli yekûn in each footer", async () => {
    const html = (await renderReport({
      schemaVersion: "1.0", id: "ledger", name: "Ledger",
      page: { size: "custom", width: 300, height: 300, unit: "pt", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
      datasets: [{ id: "d", source: "inline", query: { data: Array.from({ length: 10 }, (_, i) => ({ amount: (i + 1) * 100 })) } }],
      variables: [{ id: "total", scope: "row", expression: "(vars.total ?? 0) + row.amount" }],
      sections: [
        { type: "pageHeader", height: 20, children: [{ type: "text", expression: '"Devreden " + (page.start.total ?? 0)' }] },
        { type: "detail", dataset: "d", height: 60, children: [{ type: "text", binding: "row.amount" }] },
        { type: "pageFooter", height: 20, children: [{ type: "text", expression: '"Nakli " + page.end.total' }] },
      ],
    })).content.toString();
    // 4, 4 and 2 records per page.
    expect([...html.matchAll(/(Devreden|Nakli) (\d+)/g)].map((m) => m[0])).toEqual(["Devreden 0", "Nakli 1000", "Devreden 1000", "Nakli 3600", "Devreden 3600", "Nakli 5500"]);
  });
});
