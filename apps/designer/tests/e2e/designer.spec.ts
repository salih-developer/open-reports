import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const doc = (page: Page) => page.evaluate(() => (window as any).__designer.getState().doc);
const company = (page: Page) => page.evaluate(() => {
  const find = (value: any): any => {
    if (!value || typeof value !== "object") return undefined;
    if (value.id === "company") return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
  };
  return find((window as any).__designer.getState().doc);
});
const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__designer.getState();
  return { selection: s.selection, doc: s.doc, past: s.past.length, future: s.future.length, clipboard: s.clipboard.length };
});

async function startBlank(page: Page) {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await expect(page.getByTestId("page-1")).toBeVisible();
}

function pdfText(file: string): string {
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf-8" });
}

test.describe("complete journey: create, bind, style, preview, save, reload, export", () => {
  test("blank report to PDF with real data", async ({ page }) => {
    await startBlank(page);

    // 1. add a title
    await page.getByTestId("palette-text").click();
    const first = (await state(page)).selection[0];
    await page.getByTestId("value-text").fill("Patient Invoice");
    await expect(page.getByTestId("canvas")).toContainText("Patient Invoice");

    // 2. create a dataset from JSON through the dataset editor
    await page.getByTestId("left-tab-data").click();
    await page.getByTestId("add-dataset").click();
    await page.getByTestId("dataset-id").fill("invoice");
    await page.getByTestId("dataset-json").fill(
      JSON.stringify({ number: "INV-77", customer: { name: "Asha Rao" }, items: [{ description: "Consult", quantity: 2, rate: 500 }, { description: "X-ray", quantity: 1, rate: 800 }] })
    );
    await page.getByTestId("dataset-test").click();
    await expect(page.getByTestId("dataset-result")).toBeVisible();
    await page.getByTestId("dataset-save").click();
    await expect(page.getByTestId("dataset-invoice")).toBeVisible();

    // 3. drag a field onto the page -> bound text
    await page.getByTestId("field-invoice-customer.name").dragTo(page.getByTestId("page-1"), { targetPosition: { x: 200, y: 400 } });
    await expect(page.getByTestId("canvas")).toContainText("Asha Rao");

    // 4. drag the items array -> prompt -> Table with generated columns
    await page.getByTestId("field-invoice-items").dragTo(page.getByTestId("page-1"), { targetPosition: { x: 200, y: 500 } });
    await expect(page.getByTestId("drop-prompt").getByRole("radio", { name: /Table/ })).toBeChecked();
    await expect(page.getByTestId("drop-prompt").getByRole("checkbox", { name: "Create fields automatically" })).toBeChecked();
    await page.getByTestId("create-array-display").click();
    await expect(page.getByTestId("canvas")).toContainText("Consult");
    await expect(page.getByTestId("canvas")).toContainText("Description");

    // 5. add an Amount column with a formula and a currency format, plus a total
    await page.getByTestId("open-table-designer").click();
    await page.getByTestId("table-designer-add-column").click();
    await page.getByTestId("column-3").getByRole("button", { name: /New column/ }).click();
    await page.getByTestId("column-3").getByLabel("Column header").fill("Amount");
    await page.getByTestId("column-3").getByRole("button", { name: "fx Formula" }).click();
    await page.getByTestId("column-formula-3").fill("row.quantity * row.rate");
    await page.getByTestId("column-3").getByLabel("Format as").selectOption("currency");
    await page.getByTestId("column-3").getByLabel("Footer total").selectOption("sum");
    await page.getByTestId("table-designer-done").click();
    await expect(page.getByTestId("canvas")).toContainText("1,800.00"); // 2*500 + 800 total, formatted

    // 6. change styling of the title
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId(`layer-${first}`).click();
    await page.getByTestId("element-tab-style").click();
    await page.getByTestId("properties").getByLabel("Font size").fill("24");
    await page.getByTestId("properties").getByRole("button", { name: "Italic", exact: true }).click();
    expect((await doc(page)).sections[0].children[0].style).toMatchObject({ fontSize: 24, italic: true });

    // 7. preview: the real PDF renderer on the server
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("pdf-frame")).toBeVisible();
    await expect(page.getByTestId("pdf-info")).toContainText("1 page");

    // 8. save, reload the page, reopen, and export
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("status-pill")).toContainText("draft · v1");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByTestId("starter-blank").waitFor();
    await page.keyboard.press("Escape"); // dismiss the welcome gallery
    await page.getByTestId("btn-open").click();
    await page.getByTestId("open-untitled").click();
    await page.getByTestId("mode-design").click();
    await expect(page.getByTestId("canvas")).toContainText("Patient Invoice");
    await expect(page.getByTestId("canvas")).toContainText("Consult");

    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-export").click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-pdf").click()]);
    const file = path.join(os.tmpdir(), `e2e-${Date.now()}.pdf`);
    await download.saveAs(file);
    expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(file);
    expect(text).toContain("Patient Invoice");
    expect(text).toContain("Asha Rao");
    expect(text).toContain("Consult");
    expect(text).toContain("1,800.00");
  });
});

test.describe("editing", () => {
  test("long narrative continues across design pages with an explained break", async ({ page }) => {
    await startBlank(page);
    const markers = Array.from({ length: 90 }, (_, index) => `NARRATIVE${String(index + 1).padStart(3, "0")}`);
    await page.evaluate((value) => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "narrative-design", page: { size: "custom", unit: "pt", width: 300, height: 320, margin: { top: 0, right: 0, bottom: 0, left: 0 } }, sections: [{ type: "detail", children: [{ type: "text", id: "narrative", value, width: 200 }] }] });
    }, markers.join("\n"));
    await expect(page.getByTestId("page-2")).toBeVisible();
    const rendered = (await page.locator('[data-cid="narrative"] .text-content').allTextContents()).join("\n");
    expect([...rendered.matchAll(/NARRATIVE\d{3}/g)].map((match) => match[0])).toEqual(markers);
    await page.getByTestId("toggle-pagination").click();
    await expect(page.getByTestId("pagination-panel")).toContainText("text split");
    await expect(page.getByTestId("pagination-panel")).not.toContainText("cannot split");
    await page.screenshot({ path: path.resolve("../../output/playwright/ui-audit-2026-10-03/45-long-narrative-pages.png") });
  });

  test("undo, redo, copy, paste, duplicate and delete", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("palette-text").click();
    await page.getByTestId("value-text").fill("Hello");
    let s = await state(page);
    expect(s.doc.sections[0].children).toHaveLength(1);

    // focus the canvas so shortcuts are not swallowed by the text area
    await page.getByTestId("canvas").click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => (window as any).__designer.getState().select([(window as any).__designer.getState().doc.sections[0].children[0].id]));
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    s = await state(page);
    expect(s.doc.sections[0].children).toHaveLength(2);

    await page.keyboard.press("Control+d");
    expect((await state(page)).doc.sections[0].children).toHaveLength(3);

    await page.keyboard.press("Delete");
    expect((await state(page)).doc.sections[0].children).toHaveLength(2);

    await page.keyboard.press("Control+z");
    expect((await state(page)).doc.sections[0].children).toHaveLength(3);
    await page.keyboard.press("Control+Shift+z");
    expect((await state(page)).doc.sections[0].children).toHaveLength(2);

    await page.getByTestId("btn-undo").click();
    expect((await state(page)).doc.sections[0].children).toHaveLength(3);
  });

  test("drag from the palette, reorder by dragging, and the layer tree stays in sync", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("palette-text").click();
    await page.getByTestId("palette-line").dragTo(page.getByTestId("page-1"), { targetPosition: { x: 300, y: 300 } });
    let kids = (await doc(page)).sections[0].children.map((c: any) => c.type);
    expect(kids).toEqual(["text", "line"]);

    await page.getByTestId("left-tab-layers").click();
    const textId = (await doc(page)).sections[0].children[0].id;
    const lineId = (await doc(page)).sections[0].children[1].id;
    await page.getByTestId(`layer-${lineId}`).dragTo(page.getByTestId(`layer-${textId}`), { targetPosition: { x: 20, y: 2 } });
    kids = (await doc(page)).sections[0].children.map((c: any) => c.type);
    expect(kids).toEqual(["line", "text"]);
  });

  test("absolute layout: arrow-key nudge, resize handle and alignment", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await expect(page.getByTestId("page-1")).toBeVisible();

    const before = (await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "date");
    await page.evaluate(() => (window as any).__designer.getState().select(["date"]));
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const moved = (await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "date");
    expect(moved.x).toBe(before.x + 1);
    expect(moved.y).toBe(before.y + 10);

    // resize: drag the east handle (wait for the debounced re-render so the handle sits at its new position)
    await page.waitForTimeout(400);
    const handle = page.locator(".handle.e");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 5 + 60, box.y + 5, { steps: 6 });
    await page.mouse.up();
    const resized = (await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "date");
    expect(resized.width).toBeGreaterThan(before.width + 30);

    // multi-select + align
    await page.evaluate(() => (window as any).__designer.getState().select(["title", "name", "course"]));
    await page.getByTestId("align-left").click();
    const kids = (await doc(page)).sections[0].children[0].children;
    const xs = ["title", "name", "course"].map((id) => kids.find((c: any) => c.id === id).x);
    expect(new Set(xs).size).toBe(1);
  });

  test("multi-selection matches width without changing positions", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("layer-title").click();
    await page.getByTestId("layer-date").click({ modifiers: ["Shift"] });
    const before = (await doc(page)).sections[0].children[0].children;
    const dateBefore = before.find((component: any) => component.id === "date");
    await expect(page.getByTestId("same-width")).toBeEnabled();
    await expect(page.getByTestId("same-height")).toBeDisabled();
    await page.getByTestId("same-width").click();
    const after = (await doc(page)).sections[0].children[0].children;
    expect(after.find((component: any) => component.id === "date")).toMatchObject({ x: dateBefore.x, y: dateBefore.y, width: 770 });
  });

  test("multi-selection aligns the rendered first text baselines", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.evaluate(() => (window as any).__designer.getState().select(["title", "date"]));
    await expect(page.getByTestId("align-baseline")).toBeEnabled();
    const before = (await doc(page)).sections[0].children[0].children.find((item: any) => item.id === "date").y;
    await page.getByTestId("align-baseline").click();
    await expect.poll(async () => {
      const baselines = await page.locator(".cn-text[data-cid]").evaluateAll((nodes) => ["title", "date"].map((id) => {
        const node = nodes.find((item) => item.getAttribute("data-cid") === id)!;
        return node.querySelector(".text-baseline-probe")!.getBoundingClientRect().top;
      }));
      return Math.abs(baselines[0]! - baselines[1]!);
    }).toBeLessThan(1);
    expect((await doc(page)).sections[0].children[0].children.find((item: any) => item.id === "date").y).not.toBe(before);
  });

  test("dragging text snaps its baseline to a sibling", async ({ page }) => {
    await startBlank(page);
    await page.evaluate(() => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "baseline-drag", sections: [{ type: "detail", layout: "absolute", children: [
        { type: "text", id: "heading", value: "Heading", x: 80, y: 100, width: 150, height: 40, style: { fontSize: 24 } },
        { type: "text", id: "value", value: "Value", x: 260, y: 150, width: 100, height: 24, style: { fontSize: 12 } },
      ] }] });
    });
    const heading = page.locator('[data-cid="heading"] .text-baseline-probe');
    const value = page.locator('[data-cid="value"] .text-baseline-probe');
    await expect(page.locator('[data-cid="heading"]')).toBeVisible();
    await expect(page.locator('[data-cid="value"]')).toBeVisible();
    const pageBox = (await page.getByTestId("page-1").boundingBox())!;
    const widthPt = await page.evaluate(() => (window as any).__designer.getState().engine.paginated.pageSize.width);
    const k = pageBox.width / widthPt;
    const headingTop = (await heading.boundingBox())!.y;
    const valueTop = (await value.boundingBox())!.y;
    const source = (await page.locator('[data-cid="value"]').boundingBox())!;
    const start = { x: source.x + 8, y: source.y + 8 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + headingTop - valueTop + 2 * k, { steps: 8 });
    await expect(page.getByTestId("baseline-snap-guide")).toBeVisible();
    await page.screenshot({ path: path.resolve("../../output/playwright/ui-audit-2026-10-03/44-baseline-drag-guide.png") });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await heading.boundingBox())!.y - (await value.boundingBox())!.y)).toBeLessThan(1);
  });

  test("tidy up places selected elements into compact rows and is undoable", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.evaluate(() => (window as any).__designer.getState().select(["title", "name", "date"]));
    await expect(page.getByTestId("tidy-up")).toBeDisabled();
    await expect(page.getByText("Tidy would overlap another element.")).toBeVisible();

    await page.evaluate(() => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "tidy-demo", name: "Tidy demo", sections: [{ type: "detail", layout: "absolute", children: [
        { id: "a", type: "text", value: "Patient name", x: 20, y: 30, width: 150, height: 30, style: { fontSize: 16 } },
        { id: "b", type: "text", value: "UHID", x: 220, y: 32, width: 90, height: 30, style: { fontSize: 16 } },
        { id: "c", type: "text", value: "Bill total", x: 170, y: 130, width: 120, height: 30, style: { fontSize: 16 } },
      ] }] });
      (window as any).__designer.getState().select(["a", "b", "c"]);
    });
    await expect(page.getByTestId("tidy-up")).toBeEnabled();
    await page.getByTestId("tidy-up").click();
    const after = (await doc(page)).sections[0].children;
    expect(after.map((item: any) => [item.x, item.y])).toEqual([[20, 30], [178, 30], [20, 68]]);
    await expect.poll(async () => {
      const first = await page.locator('.cn-text[data-cid="a"]').boundingBox();
      const last = await page.locator('.cn-text[data-cid="c"]').boundingBox();
      return Math.abs((first?.x ?? Infinity) - (last?.x ?? -Infinity));
    }).toBeLessThan(1);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "39-tidy-up.png") });
    await page.evaluate(() => (window as any).__designer.getState().undo());
    expect((await doc(page)).sections[0].children.find((item: any) => item.id === "c").y).toBe(130);
  });

  test("dragging uses sibling equal-spacing guides and Ctrl/⌘ bypasses snapping", async ({ page }) => {
    await startBlank(page);
    await page.evaluate(() => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "snap-demo", name: "Spacing demo", sections: [{ type: "detail", layout: "absolute", children: [
        { id: "left", type: "text", value: "Left", x: 100, y: 100, width: 30, height: 20 },
        { id: "right", type: "text", value: "Right", x: 200, y: 100, width: 30, height: 20 },
        { id: "moving", type: "text", value: "Move", x: 300, y: 100, width: 30, height: 20 },
      ] }] });
    });
    const moving = page.locator('.cn-text[data-cid="moving"]');
    await expect(moving).toBeVisible();
    const scale = await page.evaluate(() => (4 / 3) * (window as any).__designer.getState().zoom);
    const start = (await moving.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 - 148 * scale, start.y + start.height / 2, { steps: 12 });
    await expect(page.getByTestId("equal-gap-guide")).toHaveCount(2);
    await expect.poll(async () => {
      const left = await page.locator('.cn-text[data-cid="left"]').boundingBox();
      const moved = await moving.boundingBox();
      return Math.abs((moved?.x ?? Infinity) - (left?.x ?? 0) - 50 * scale);
    }).toBeLessThan(1);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "40-equal-spacing-guides.png") });
    await page.mouse.up();
    expect((await doc(page)).sections[0].children.find((item: any) => item.id === "moving").x).toBe(150);

    await page.evaluate(() => (window as any).__designer.getState().patch("moving", { x: 300, y: 100 }));
    await expect.poll(async () => (await moving.boundingBox())?.x).toBeCloseTo(start.x, 0);
    const reset = (await moving.boundingBox())!;
    await page.keyboard.down("ControlOrMeta");
    await page.mouse.move(reset.x + reset.width / 2, reset.y + reset.height / 2);
    await page.mouse.down();
    await page.mouse.move(reset.x + reset.width / 2 - 148 * scale, reset.y + reset.height / 2, { steps: 12 });
    await expect(page.getByTestId("equal-gap-guide")).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up("ControlOrMeta");
    expect((await doc(page)).sections[0].children.find((item: any) => item.id === "moving").x).toBeCloseTo(152, 0);
    expect((await doc(page)).sections[0].children).toHaveLength(3);

    await expect.poll(async () => (await moving.boundingBox())?.x).toBeCloseTo(start.x - 148 * scale, 0);
    const current = (await moving.boundingBox())!;
    await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2);
    await page.mouse.down();
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await page.mouse.move(current.x + current.width / 2 + 40 * scale, current.y + current.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.keyboard.up("Alt");
    expect((await doc(page)).sections[0].children).toHaveLength(4);
  });

  test("resizing an absolute element snaps its active edge and Ctrl/⌘ bypasses it", async ({ page }) => {
    await startBlank(page);
    await page.evaluate(() => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "resize-demo", name: "Resize demo", sections: [{ type: "detail", layout: "absolute", children: [
        { id: "resize-me", type: "rectangle", x: 100, y: 100, width: 50, height: 30 },
        { id: "neighbour", type: "rectangle", x: 200, y: 100, width: 40, height: 30 },
      ] }] });
      (window as any).__designer.getState().select(["resize-me"]);
    });
    const handle = page.locator(".handle.e");
    await expect(handle).toBeVisible();
    const scale = await page.evaluate(() => (4 / 3) * (window as any).__designer.getState().zoom);
    const start = (await handle.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 48 * scale, start.y + start.height / 2, { steps: 9 });
    expect((await doc(page)).sections[0].children[0].width).toBe(50);
    await expect(page.locator(".guide.x")).toHaveCount(1);
    await expect.poll(async () => {
      const selected = await page.locator(".selbox").boundingBox();
      const neighbour = await page.locator('.cn[data-cid="neighbour"]').boundingBox();
      return Math.abs((selected?.x ?? 0) + (selected?.width ?? 0) - (neighbour?.x ?? Infinity));
    }).toBeLessThan(1);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "41-resize-smart-guide.png") });
    await page.mouse.up();
    expect((await doc(page)).sections[0].children[0].width).toBe(100);

    await page.evaluate(() => (window as any).__designer.getState().patch("resize-me", { width: 50 }));
    await expect.poll(async () => (await page.locator(".selbox").boundingBox())?.width).toBeCloseTo(50 * scale, 0);
    const reset = (await handle.boundingBox())!;
    await page.keyboard.down("ControlOrMeta");
    await page.mouse.move(reset.x + reset.width / 2, reset.y + reset.height / 2);
    await page.mouse.down();
    await page.mouse.move(reset.x + reset.width / 2 + 48 * scale, reset.y + reset.height / 2, { steps: 9 });
    await expect(page.locator(".guide.x")).toHaveCount(0);
    await page.mouse.up();
    await page.keyboard.up("ControlOrMeta");
    expect((await doc(page)).sections[0].children[0].width).toBeCloseTo(98, 0);
  });

  test("selection ruler zero and canvas dimensions follow the rendered element", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.evaluate(() => (window as any).__designer.getState().select(["date"]));
    await page.getByTestId("canvas-options").locator("summary").click();
    await page.getByTestId("ruler-origin").selectOption("selection");
    await expect(page.getByTestId("selection-metrics").first()).toContainText(/X .* Y .* W .* H .* mm/);
    const selected = await page.evaluate(() => {
      const st = (window as any).__designer.getState();
      const walk = (items: any[]): any => {
        for (const item of items) {
          if (item.component.id === "date") return item;
          const child = walk(item.children ?? []);
          if (child) return child;
        }
      };
      const first = st.engine.paginated.pages[0];
      return { box: walk([...first.header, ...first.content, ...first.footer]).box, zoom: st.zoom };
    });
    const zero = page.getByTestId("ruler-h").locator('.tick.major[data-value="0"]');
    expect(Number(await zero.evaluate((element) => (element as HTMLElement).style.left.replace("px", "")))).toBeCloseTo(selected.box.x * 4 / 3 * selected.zoom, 1);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "38-selection-ruler-origin.png") });
  });

  test("flow content does not offer coordinate alignment", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("palette-text").click();
    await page.getByTestId("palette-text").click();
    const ids = (await doc(page)).sections[0].children.map((component: any) => component.id);
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId(`layer-${ids[0]}`).click();
    await page.getByTestId(`layer-${ids[1]}`).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("align-left")).toBeDisabled();
    await expect(page.getByTestId("same-width")).toBeDisabled();
    expect((await doc(page)).sections[0].children.every((component: any) => component.x === undefined)).toBe(true);
  });

  test("text content: field binding, formula with autocomplete and inline error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await expect(page.getByTestId("page-1")).toBeVisible();
    await page.evaluate(() => (window as any).__designer.getState().select(["company"]));

    await page.getByTestId("value-mode-formula").click();
    const input = page.getByTestId("formula-input");
    await input.fill('upper(data.invoice.customer.na');
    await expect(page.getByRole("listbox").getByRole("option").first()).toContainText("data.invoice.customer.name");
    await page.keyboard.press("Enter");
    await input.type(")");
    await expect(page.getByTestId("canvas")).toContainText("ALEX MORGAN");
    expect((await company(page)).expression).toBe("upper(data.invoice.customer.name)");

    await input.fill("1 +");
    await expect(page.getByRole("alert")).toBeVisible();
    // an invalid expression never breaks the canvas: the element shows the error instead
    await expect(page.getByTestId("canvas")).toContainText("⚠");
  });

  test("low-code visibility rule becomes an expression", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-conditional").click();
    await expect(page.getByTestId("page-1")).toBeVisible();
    await page.evaluate(() => (window as any).__designer.getState().select(["attention"]));
    await page.getByTestId("element-tab-rules").click();
    await page.getByTestId("visible-when-toggle").check();
    await page.getByTestId("cond-field").selectOption({ index: 0 });
    await page.getByTestId("cond-op").selectOption("gt");
    await page.getByTestId("cond-value").fill("0");
    const c = (await doc(page)).sections[0].children.find((x: any) => x.id === "attention");
    expect(c.visibleWhen).toMatch(/^[\w.]+ > 0$/);
    await page.getByTestId("visibility-code").click();
    const codeCondition = `${c.visibleWhen} && ${c.visibleWhen}`;
    await page.getByLabel("Formula").fill(codeCondition);
    expect((await doc(page)).sections[0].children.find((x: any) => x.id === "attention").visibleWhen).toBe(codeCondition);
    await expect(page.getByTestId("visibility-builder")).toBeDisabled();
    await page.getByLabel("Formula").fill(`${c.visibleWhen} &&`);
    await expect(page.getByLabel("Formula")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("data, code and problems", () => {
  test("paste sample JSON generates a bound report", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-json").click();
    await page.getByTestId("generate-create").click();
    await expect(page.getByTestId("canvas")).toContainText("Alex Morgan");
    await expect(page.getByTestId("canvas")).toContainText("Blood test (CBC)");
    await expect(page.getByTestId("canvas")).toContainText("Items");
  });

  test("code mode edits the same model: JSON change shows in design, and design change shows in JSON", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-receipt").click();
    await page.getByTestId("mode-code").click();
    const setCode = (t: string) => page.evaluate((text) => { const v = (window as any).__codeView; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }); }, t);
    const original = await page.evaluate(() => (window as any).__codeView.state.doc.toString());
    expect(original).toContain("NORTHSTAR PHARMACY");
    const edited = original.replace("Thank you - get well soon", "Edited from code");
    await setCode(edited);
    await expect(page.getByTestId("code-status")).toContainText("valid");
    await page.getByTestId("mode-design").click();
    await expect(page.getByTestId("canvas")).toContainText("Edited from code");

    // invalid JSON is reported with a position and does not clobber the design
    await page.getByTestId("mode-code").click();
    await setCode("{ nope");
    await expect(page.getByTestId("code-status")).toContainText("problem");
    await expect(page.getByRole("alert")).toContainText(/Line \d+/);
    await page.getByTestId("mode-design").click();
    await expect(page.getByTestId("canvas")).toContainText("Edited from code");
  });

  test("Open in Code jumps to the component, and the cursor selects it back on the canvas", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.evaluate(() => (window as any).__designer.getState().select(["pay-qr"]));
    await page.getByRole("button", { name: "Element actions" }).click();
    await page.getByTestId("open-in-code").click();
    const selected = await page.evaluate(() => { const v = (window as any).__codeView; const r = v.state.selection.main; return v.state.doc.sliceString(r.from, r.to); });
    expect(selected).toContain('"id": "pay-qr"');

    await page.evaluate(() => (window as any).__designer.getState().select([]));
    await page.evaluate(() => {
      const v = (window as any).__codeView;
      v.focus();
      const i = v.state.doc.toString().indexOf('"id": "items"');
      v.dispatch({ selection: { anchor: i + 5 } });
    });
    await expect.poll(async () => (await state(page)).selection).toEqual(["items"]);
  });

  test("problems panel reports an unknown dataset and clicking it selects the component", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("palette-table").click();
    await page.getByTestId("table-dataset").selectOption({ index: 0 }).catch(() => {});
    await page.evaluate(() => {
      const s = (window as any).__designer.getState();
      s.patch(s.selection[0], { dataset: "orderss" });
    });
    await page.getByTestId("toggle-problems").click();
    await expect(page.getByTestId("problem-error").first()).toContainText(/orderss/);
    await page.evaluate(() => (window as any).__designer.getState().select([]));
    await page.getByTestId("problem-error").first().click();
    expect((await state(page)).selection).toHaveLength(1);
  });

  test("command palette: Ctrl+K runs commands", async ({ page }) => {
    await startBlank(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("palette-input").fill("add qr");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await doc(page)).sections[0].children.map((c: any) => c.type)).toContain("qrcode");

    await page.keyboard.press("Control+k");
    await page.getByTestId("palette-input").fill("landscape");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await doc(page)).page.orientation).toBe("landscape");
  });
});

test.describe("preview and export formats", () => {
  test("HTML, XLSX grid and CSV previews show the same business values", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.getByTestId("mode-preview").click();

    await page.getByTestId("preview-tab-html").click();
    await expect(page.frameLocator('[data-testid="html-frame"]').locator("body")).toContainText("15,340.00");

    await page.getByTestId("preview-tab-xlsx").click();
    await expect(page.getByTestId("xlsx-grid")).toContainText("Progressive Lenses");
    await expect(page.getByTestId("xlsx-grid")).toContainText("6400"); // raw number, not "₹6,400.00"

    await page.getByTestId("preview-tab-csv").click();
    await expect(page.getByTestId("csv-text")).toContainText("Progressive Lenses,2,3200,6400");

    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-csv").click()]);
    const file = path.join(os.tmpdir(), `e2e-${Date.now()}.csv`);
    await dl.saveAs(file);
    expect(fs.readFileSync(file, "utf-8")).toContain("Progressive Lenses,2,3200,6400");
  });

  test("a multi-page statement previews as several pages", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-account-statement").click();
    await expect(page.getByTestId("page-2")).toBeVisible();
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("pdf-info")).toContainText(/[2-9] pages/);
  });

  test("a 500-item thermal bill previews as one continuous ESC/POS roll", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-receipt-58mm").click();
    const sale = (await doc(page)).datasets[0].query.data;
    sale.items = Array.from({ length: 500 }, (_, index) => ({ name: `Item${String(index).padStart(4, "0")} Supermarket Flour 10kg`, qty: 1, price: 10 }));
    await page.getByTestId("left-tab-data").click();
    await page.getByRole("button", { name: "Edit sale" }).click();
    await page.getByTestId("dataset-json").fill(JSON.stringify(sale));
    await page.getByTestId("dataset-save").click();
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("btn-more").click();
    await expect(page.getByTestId("target-select")).toHaveValue("escpos");
    await page.getByTestId("view-pages").click();
    await expect(page.getByTestId("view-pages")).toHaveText("Roll");
    await expect(page.getByTestId("design-roll-preview").getByTestId("escpos-text")).toContainText("Item0000");
    await expect(page.getByTestId("design-roll-preview").getByTestId("escpos-text")).toContainText("Item0499");
    await expect(page.getByTestId("design-roll-preview").getByTestId("escpos-text")).toContainText(/Item0000[^\n]*Rs\.10\.00/);
    await expect(page.getByTestId("design-roll-preview").getByTestId("escpos-info")).toContainText("1 cut");
    await expect(page.getByTestId("page-2")).toHaveCount(0);
    await expect(page.getByTestId("problem-counts")).toContainText("PDF:");
    const designScreenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(designScreenshots, { recursive: true });
    await page.screenshot({ path: path.join(designScreenshots, "51-continuous-receipt-design.png") });
    await page.getByTestId("btn-more").click();
    await page.getByTestId("target-select").selectOption("escpos");
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("preview-tab-escpos")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("escpos-text")).toContainText("Item0000");
    await expect(page.getByTestId("escpos-text")).toContainText("Item0499");
    await expect(page.getByTestId("escpos-info")).toContainText("58 mm");
    await expect(page.getByTestId("escpos-info")).toContainText("1 cut");
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "06-receipt-roll-preview.png") });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-escpos").click()]);
    expect(download.suggestedFilename()).toMatch(/^receipt-58mm(?:-[a-z0-9]+)?\.bin$/);
    const file = path.join(os.tmpdir(), `receipt-${Date.now()}.bin`);
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(-4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  });

  test("a blank 80 mm receipt starts with an editable structure and a live roll", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("blank-size").selectOption({ label: "Receipt 80 mm" });
    await page.getByTestId("starter-blank").click();
    expect((await doc(page)).print).toMatchObject({ printerType: "receipt", language: "escpos", dpi: 203 });
    await page.getByTestId("btn-more").click();
    await expect(page.getByTestId("target-select")).toHaveValue("escpos");
    await expect(page.getByTestId("view-structure")).toBeVisible();
    await page.getByTestId("view-pages").click();
    await expect(page.getByTestId("design-roll-preview")).toContainText("80 mm");
    await expect(page.getByTestId("design-roll-preview")).toContainText("Page height only affects PDF");
    await page.getByTestId("view-structure").click();
    await expect(page.getByTestId("page-1")).toBeVisible();
  });
});

test("publish creates an immutable published version", async ({ page }) => {
  await startBlank(page);
  await page.getByTestId("btn-publish").click();
  await expect(page.getByTestId("publish-review")).toBeVisible();
  await expect(page.getByTestId("publish-confirm")).toBeDisabled();
  await page.getByTestId("publish-run-checks").click();
  await expect(page.getByTestId("publish-preview-reviewed")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("publish-preview-reviewed").check();
  await page.getByTestId("publish-notes").fill("Reviewed the initial layout");
  await expect(page.getByTestId("publish-confirm")).toBeEnabled();
  await page.getByTestId("publish-confirm").click();
  await expect(page.getByTestId("status-pill")).toContainText("published");
  const id = (await doc(page)).id;
  const template = await page.request.get(`/api/v1/templates/${id}`);
  const { currentVersion } = await template.json();
  const version = await page.request.get(`/api/v1/templates/${id}/versions/${currentVersion}`);
  expect((await version.json()).notes).toBe("Reviewed the initial layout");
  await page.getByTestId("btn-more").click();
  await page.getByRole("menuitem", { name: "Compare versions…" }).click();
  await page.getByTestId("compare-from").selectOption(String(currentVersion));
  await expect(page.getByTestId("version-notes")).toContainText("Reviewed the initial layout");
});

test("publish review blocks a report with critical validation errors", async ({ page }) => {
  await startBlank(page);
  await page.evaluate(() => {
    const store = (window as any).__designer.getState();
    store.setDoc({ ...store.doc, sections: [{ type: "detail", children: [{ id: "bad-table", type: "table", dataset: "missing", columns: [{ id: "name", header: "Name", binding: "row.name" }] }] }] });
  });
  await page.getByTestId("btn-publish").click();
  await page.getByTestId("publish-run-checks").click();
  await expect(page.getByTestId("publish-review")).toContainText("Fix errors and run checks again");
  await expect(page.getByTestId("publish-confirm")).toBeDisabled();
  await expect(page.getByTestId("status-pill")).toContainText("unsaved");
});

test("publish review runs row boundaries and requires warning review after the PDF preview", async ({ page }) => {
  await startBlank(page);
  await page.evaluate(() => {
    const store = (window as any).__designer.getState();
    store.setDoc({ ...store.doc,
      datasets: [{ id: "items", source: "inline", query: { data: [{ name: "Widget", amount: 10 }] } }],
      sections: [{ type: "detail", children: [
        { id: "items-table", type: "table", dataset: "items", columns: [{ id: "name", header: "Name", binding: "row.name" }, { id: "amount", header: "Amount", binding: "row.amount" }] },
        { id: "small-barcode", type: "barcode", value: "123456789012", width: 10, height: 20 },
      ] }],
    });
  });
  await page.getByTestId("btn-publish").click();
  await page.getByTestId("publish-run-checks").click();
  await expect(page.getByTestId("publish-preview-reviewed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("publish-check")).toHaveCount(8);
  await expect(page.getByTestId("publish-review")).toContainText("items · 0 records");
  await expect(page.getByTestId("publish-review")).toContainText("items · 100 records");
  await expect(page.getByTestId("publish-review")).toContainText("items · stress values");
  if (process.env.UI_AUDIT_DIR) {
    fs.mkdirSync(process.env.UI_AUDIT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UI_AUDIT_DIR, "28-publish-review.png") });
  }
  await page.getByTestId("publish-notes").fill("Checked data boundaries and barcode warning");
  await page.getByTestId("publish-preview-reviewed").check();
  await expect(page.getByTestId("publish-confirm")).toBeDisabled();
  await page.getByTestId("publish-warnings-reviewed").check();
  await expect(page.getByTestId("publish-confirm")).toBeEnabled();
  await page.evaluate(() => {
    const store = (window as any).__designer.getState();
    store.setDoc({ ...store.doc, name: "Changed after review" });
  });
  await expect(page.getByTestId("publish-confirm")).toBeDisabled();
  await expect(page.getByTestId("publish-review")).toContainText("Report changed — run checks again");
});
