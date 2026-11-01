import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const doc = (page: Page) => page.evaluate(() => (window as any).__designer.getState().doc);
const company = (page: Page) => page.evaluate(() => {
  const find = (value: any): any => {
    if (!value || typeof value !== "object") return undefined;
    if (value.id === "company") return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
  };
  return find((window as any).__designer.getState().doc);
});
const st = (page: Page) => page.evaluate(() => {
  const s = (window as any).__designer.getState();
  return { selection: s.selection, bottom: s.bottom, mode: s.mode, past: s.past.length };
});

async function absoluteForm(page: Page) {
  await page.goto("/");
  await page.getByTestId("starter-absolute-form").click();
  await expect(page.getByTestId("page-1")).toBeVisible();
}

test.describe("workspace", () => {
  test("selected elements and bands show only the relevant inspector view", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await absoluteForm(page);
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("layer-title").click();
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await expect(page.getByTestId("element-tab-content")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("value-text")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "72-element-content-inspector.png") });
    await page.getByTestId("element-tab-style").click();
    await expect(page.getByTestId("properties").getByLabel("Font size")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "73-element-style-inspector.png") });
    await page.getByTestId("element-tab-layout").click();
    await expect(page.getByRole("button", { name: "Layout", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: path.join(screenshots, "74-element-layout-inspector.png") });
    await page.getByTestId("element-tab-rules").click();
    await expect(page.getByTestId("visible-when-toggle")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "75-element-rules-inspector.png") });

    await page.getByTestId("section-detail").first().click();
    await expect(page.getByTestId("band-tab-general")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("band-name")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "76-band-general-inspector.png") });
    await page.getByTestId("band-tab-layout").click();
    await expect(page.getByTestId("band-layout")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "77-band-layout-inspector.png") });
    await page.getByTestId("band-tab-rules").click();
    await expect(page.getByTestId("band-hidden")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "78-band-rules-inspector.png") });
    expect(await page.evaluate(() => (window as any).__designer.getState().meta.dirty)).toBe(false);
  });

  test("global header stays calm while canvas tools remain available at desktop and laptop widths", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.addInitScript(() => localStorage.setItem("designer.canvasView", "structure"));
    await page.goto("/");
    await page.getByTestId("starter-search").fill("department");
    await page.getByTestId("starter-department-report").click();
    await expect(page.getByTestId("page-1")).toBeVisible();
    const toolbar = page.getByRole("toolbar", { name: "Main toolbar" });
    await expect(toolbar.getByRole("tablist", { name: "Editor mode" }).getByRole("tab")).toHaveCount(4);
    await expect(toolbar.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
    await expect(page.getByTestId("band-bar").getByRole("button", { name: "Zoom in" })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const global = box(".toolbar");
      const context = box(".band-bar");
      const canvas = box(".canvas-scroll");
      const center = box(".center");
      return { globalBottom: global.bottom, contextTop: context.top, contextBottom: context.bottom, canvasTop: canvas.top, contextLeft: context.left, contextRight: context.right, centerLeft: center.left, centerRight: center.right };
    });
    expect(geometry.contextTop).toBeGreaterThanOrEqual(geometry.globalBottom - 1);
    expect(geometry.canvasTop).toBeGreaterThanOrEqual(geometry.contextBottom - 1);
    expect(geometry.contextLeft).toBeGreaterThanOrEqual(geometry.centerLeft);
    expect(geometry.contextRight).toBeLessThanOrEqual(geometry.centerRight);
    const initialZoom = await page.getByTestId("zoom-label").innerText();
    await page.getByTestId("band-bar").getByRole("button", { name: "Zoom in" }).click();
    await expect(page.getByTestId("zoom-label")).not.toHaveText(initialZoom);
    await page.getByTestId("canvas-fit").click();
    await page.getByTestId("btn-more").click();
    await expect(page.getByTestId("btn-new")).toBeFocused();
    await page.getByTestId("btn-new").press("End");
    await expect(page.getByTestId("menu-feedback")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("btn-more")).toBeFocused();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByTestId("left-tab-layers").click();
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "65-designer-workspace-desktop.png") });
    await page.setViewportSize({ width: 1120, height: 720 });
    await expect(page.getByTestId("btn-publish")).toBeVisible();
    await expect(page.getByTestId("band-bar").getByRole("button", { name: "Fit to width" })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "66-designer-workspace-laptop.png") });
  });

  test("new blank reports open Components while designed reports open a compact Structure overview", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await expect(page.getByTestId("left-tab-insert")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-new").click();
    await page.getByTestId("starter-search").fill("department");
    await page.getByTestId("starter-department-report").click();
    await expect(page.getByTestId("left-tab-layers")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("view-structure").click();
    await expect(page.locator(".canvas-scroll")).toContainText("DEPARTMENT REVENUE REPORT");
    const reportBand = page.getByTestId("section-reportHeader");
    const countChildren = (items: any[]): number => items.reduce((count, item) => count + 1 + countChildren(item.children ?? []), 0);
    const expectedChildren = countChildren((await doc(page)).sections[0].children);
    const bandContents = reportBand.locator("..").locator('.explorer-row[data-testid^="layer-"]');
    await expect(bandContents).toHaveCount(0);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "67-structure-overview.png") });
    await page.getByTestId("explorer-collapse-0").click();
    await expect(bandContents).toHaveCount(expectedChildren);
    expect((await doc(page)).sections[0].collapsed).toBeUndefined();
    await page.reload();
    await page.getByTestId("home-continue").click();
    await expect(page.getByTestId("left-tab-layers")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("section-reportHeader").locator("..").locator('.explorer-row[data-testid^="layer-"]')).toHaveCount(0);
    await page.evaluate(() => { const s = (window as any).__designer.getState(); s.select([s.doc.sections[0].children[0].id]); });
    await expect(page.getByTestId("section-reportHeader").locator("..").locator('.explorer-row[data-testid^="layer-"]')).toHaveCount(expectedChildren);
  });

  test("report settings keep page, print, and details in focused inspector views", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await page.goto("/");
    await page.getByTestId("starter-search").fill("department");
    await page.getByTestId("starter-department-report").click();
    await page.getByTestId("view-structure").click();
    await expect(page.locator(".canvas-scroll")).toContainText("DEPARTMENT REVENUE REPORT");
    await expect(page.getByTestId("report-tab-page")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("page-size")).toBeVisible();
    await expect(page.getByTestId("print-preset")).toHaveCount(0);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "68-report-page-inspector.png") });

    await page.getByTestId("report-tab-page").press("ArrowRight");
    await expect(page.getByTestId("report-tab-print")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("report-tab-print")).toBeFocused();
    await expect(page.getByTestId("print-preset")).toBeVisible();
    await expect(page.getByTestId("page-size")).toHaveCount(0);
    await page.getByTestId("report-tab-print").click();
    await page.screenshot({ path: path.join(screenshots, "69-report-print-inspector.png") });

    await page.getByTestId("report-tab-print").press("End");
    await expect(page.getByTestId("report-tab-details")).toBeFocused();
    await expect(page.getByTestId("report-name")).toBeVisible();
    await expect(page.getByLabel("Description")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "70-report-details-inspector.png") });

    await page.getByTestId("left-tab-pages").click();
    await expect(page.getByTestId("report-tab-page")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("edit-page-masters").click();
    await expect(page.getByTestId("page-masters-section")).toContainText("Page masters");
    expect(await page.evaluate(() => (window as any).__designer.getState().meta.dirty)).toBe(false);

    await page.setViewportSize({ width: 1120, height: 720 });
    await page.getByRole("button", { name: "Show properties" }).click();
    await expect(page.getByTestId("report-tab-page")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "71-report-inspector-laptop.png") });
  });

  test("receipt reports open their physical print settings first", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-receipt").click();
    await expect(page.getByTestId("report-tab-print")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("print-facts")).toContainText("Roll width");
    await page.getByTestId("report-tab-page").click();
    await expect(page.getByTestId("page-size")).toBeVisible();
  });

  test("laptop keeps the canvas wide and opens side panels without squeezing it", async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 720 });
    await absoluteForm(page);
    await expect(page.getByTestId("btn-save")).toBeVisible();
    await expect(page.getByTestId("btn-publish")).toBeVisible();
    const publishBox = (await page.getByTestId("btn-publish").boundingBox())!;
    expect(publishBox.x + publishBox.width).toBeLessThanOrEqual(1120);
    await expect(page.getByTestId("properties")).toHaveCount(0);
    const initialWidth = (await page.locator(".center").boundingBox())!.width;
    expect(initialWidth).toBeGreaterThanOrEqual(740);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.getByRole("button", { name: "Show properties" }).click();
    await expect(page.getByTestId("properties")).toBeVisible();
    expect((await page.locator(".center").boundingBox())!.width).toBe(initialWidth);
    await page.screenshot({ path: path.join(screenshots, "08-laptop-properties-overlay.png") });
    await page.getByRole("button", { name: "Close properties" }).click();
    await expect(page.getByTestId("properties")).toHaveCount(0);
    await page.getByTestId("canvas-fit").click();
    const center = (await page.locator(".center").boundingBox())!;
    const pageBox = (await page.getByTestId("page-1").boundingBox())!;
    expect(pageBox.x).toBeGreaterThanOrEqual(center.x);
    expect(pageBox.x + pageBox.width).toBeLessThanOrEqual(center.x + center.width + 1);
    await page.getByTestId("view-structure").click();
    await page.getByTestId("canvas-fit").click();
    const structureBox = (await page.getByTestId("page-1").boundingBox())!;
    expect(structureBox.x).toBeGreaterThanOrEqual(center.x);
    expect(structureBox.x + structureBox.width).toBeLessThanOrEqual(center.x + center.width + 1);
    await page.getByTestId("view-pages").click();
    await page.getByTestId("canvas-fit").click();
    await page.screenshot({ path: path.join(screenshots, "07-laptop-canvas-collapsed-inspector.png") });

    await page.setViewportSize({ width: 900, height: 720 });
    expect((await page.getByTestId("title-input").boundingBox())!.width).toBeGreaterThanOrEqual(100);
    await expect(page.getByRole("complementary", { name: "Workspace panels" })).toHaveCount(0);
    await page.getByRole("button", { name: "Show insert panel" }).click();
    await expect(page.getByRole("complementary", { name: "Workspace panels" })).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "09-narrow-workspace-overlay.png") });
    await page.getByRole("button", { name: "Close workspace panel" }).click();
    await expect(page.getByRole("complementary", { name: "Workspace panels" })).toHaveCount(0);
    await page.getByTestId("mode-preview").click();
    expect((await page.locator(".center").boundingBox())!.width).toBe(900);
  });

  test("structure rail and tree keep compact rows with fixed action columns", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 1024 });
    await absoluteForm(page);
    await page.getByTestId("left-tab-layers").click();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const labelX = (selector: string) => rect(`${selector} .layer-name`).x;
      const actionX = (selector: string) => rect(`${selector} .layer-actions`).x;
      const rail = rect(".workspace-rail");
      const components = document.querySelector('[data-testid="left-tab-insert"] span:last-child') as HTMLElement;
      return {
        railWidth: rail.width,
        componentsLabelHidden: components.getBoundingClientRect().width <= 1,
        rowHeights: ["[data-testid=\"section-detail\"]", "[data-testid=\"layer-canvas\"]", "[data-testid=\"layer-title\"]"].map((selector) => rect(selector).height),
        labels: [labelX('[data-testid="section-detail"]'), labelX('[data-testid="layer-canvas"]'), labelX('[data-testid="layer-title"]')],
        actions: [actionX('[data-testid="layer-title"]'), actionX('[data-testid="layer-name"]')],
        sidebarWidth: rect(".panel.left").width,
        addButtonVisible: !!document.querySelector('.structure-add > summary'),
      };
    });
    expect(geometry.railWidth).toBeGreaterThanOrEqual(48);
    expect(geometry.railWidth).toBeLessThanOrEqual(52);
    expect(geometry.sidebarWidth).toBeLessThanOrEqual(312);
    expect(geometry.componentsLabelHidden).toBe(true);
    expect(geometry.rowHeights.every((height) => height >= 28 && height <= 32)).toBe(true);
    expect(geometry.labels[1] - geometry.labels[0]).toBe(16);
    expect(geometry.labels[2] - geometry.labels[1]).toBe(16);
    expect(geometry.actions[0]).toBe(geometry.actions[1]);
    expect(geometry.addButtonVisible).toBe(true);

    await page.getByTestId("layer-title").click();
    await page.getByTestId("layer-course").click({ modifiers: ["Shift"] });
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "04-sidebar-aligned-desktop.png") });
    await page.setViewportSize({ width: 1120, height: 720 });
    await expect(page.getByTestId("left-tab-insert")).toBeVisible();
    await page.screenshot({ path: path.join(screenshots, "05-sidebar-aligned-laptop.png") });
  });

  test("structure search reveals deep matches without changing collapsed bands", async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await absoluteForm(page);
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("explorer-collapse-0").click();
    await expect(page.getByTestId("layer-course")).toHaveCount(0);
    await page.getByRole("button", { name: "Find in structure" }).click();
    const search = page.getByRole("searchbox", { name: "Search structure" });
    await search.fill("data.cert.course");
    await expect(page.getByTestId("layers-tab").getByRole("status")).toHaveText("1 match");
    await expect(page.getByTestId("layer-course")).toBeVisible();
    await expect(page.getByTestId("layer-title")).toHaveCount(0);
    await search.press("Enter");
    await expect(page.getByTestId("layer-course")).toBeFocused();
    await page.getByTestId("layer-course").press("ArrowUp");
    await expect(page.getByTestId("layer-canvas")).toBeFocused();
    await page.getByTestId("layer-canvas").press("ArrowDown");
    await page.getByTestId("layer-course").press("Enter");
    expect(await page.evaluate(() => (window as any).__designer.getState().selection)).toEqual(["course"]);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "48-structure-search.png") });
    await search.press("Escape");
    await expect(page.getByTestId("layer-course")).toBeVisible();
    await page.getByTestId("explorer-collapse-0").click();
    await expect(page.getByTestId("layer-course")).toHaveCount(0);
    expect((await doc(page)).sections[0].collapsed).toBeUndefined();
  });

  test("workspace rail switches semantic panels with pointer and keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    const rail = page.getByRole("tablist", { name: "Workspace panels" });
    await expect(rail.getByRole("tab")).toHaveCount(4);
    await page.getByTestId("left-tab-layers").click();
    await expect(page.getByRole("tabpanel", { name: "Structure" })).toContainText("Untitled report");
    await page.getByTestId("left-tab-layers").press("ArrowDown");
    await expect(page.getByTestId("left-tab-data")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Data" })).toContainText("Datasets");
    await expect(page.getByTestId("left-tab-data")).toBeFocused();
    await page.getByTestId("left-tab-insert").click();
    await expect(page.getByRole("tabpanel", { name: "Components" })).toContainText("Text");
    await expect(page.getByTestId("canvas")).toBeVisible();
  });

  test("data rail searches nested paths and shows types with sample values", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("left-tab-data").click();
    await page.getByTestId("add-dataset").click();
    await page.getByTestId("dataset-id").fill("clinical");
    await page.getByTestId("dataset-json").fill(JSON.stringify({ patient: { name: "Asha Rao", uhid: "UH123" }, investigations: [{ testName: "Glucose", result: 92 }] }));
    await page.getByTestId("dataset-save").click();
    await expect(page.getByTestId("field-clinical-patient.name")).toContainText("Asha Rao");
    await expect(page.getByTestId("field-clinical-investigations")).toContainText("1 row");
    await page.getByRole("searchbox", { name: "Search fields" }).fill("uhid");
    await expect(page.getByTestId("field-clinical-patient.uhid")).toBeVisible();
    await expect(page.getByTestId("field-clinical-patient.name")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search fields" }).fill("nothing-matches");
    await expect(page.getByRole("status")).toContainText("No fields match");
  });

  test("modes: Data mode lists datasets; split view shows canvas and code together", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.getByTestId("mode-data").click();
    await expect(page.getByTestId("data-mode")).toBeVisible();
    await expect(page.getByTestId("data-item-invoice")).toBeVisible();
    await page.getByTestId("mode-design").click();
    await page.getByTestId("btn-more").click();
    await page.getByTestId("toggle-split").click();
    await expect(page.getByTestId("canvas")).toBeVisible();
    await expect(page.locator(".split")).toBeVisible();
  });

  test("editing shows a subtle save state and labelled history", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await expect(page.getByTestId("save-state")).toContainText(/Draft|Saved/);
    await page.getByTestId("palette-text").click();
    await page.getByTestId("toggle-history").click();
    await expect(page.getByTestId("history-row").first()).toBeVisible();
    await expect(page.getByTestId("history-panel")).toContainText(/Added/);
  });

  test("pagination panel explains page breaks and offers a fix", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-account-statement").click();
    await expect(page.getByTestId("page-2")).toBeVisible();
    await page.getByTestId("toggle-pagination").click();
    await expect(page.getByTestId("pagination-panel")).toBeVisible();
    await expect(page.getByTestId("pagination-decision").first()).toBeVisible();
    await expect(page.getByTestId("page-break-2")).toBeVisible();
    expect(await page.getByTestId("pagination-decision").count()).toBe((await page.evaluate(() => (window as any).__designer.getState().engine.paginated.pages.length)) - 1);
    await page.getByTestId("pagination-decision").first().click();
    await expect(page.getByTestId("pagination-panel").getByTestId("page-break-details")).toContainText("Previous page body");
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "55-pagination-page-explanation.png") });
  });

  test("first table slice explains its minimum-row move and applies the suggested fix", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => {
      const state = (window as any).__designer.getState();
      state.setDoc({
        ...state.doc,
        page: { size: "custom", width: 300, height: 100, unit: "pt", orientation: "landscape", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
        datasets: [{ id: "items", source: "inline", query: { data: Array.from({ length: 4 }, (_, index) => ({ name: `Item ${index + 1}` })) } }],
        sections: [{ type: "detail", children: [
          { type: "text", id: "intro", value: "Intro", height: 55 },
          { type: "table", id: "items-table", dataset: "items", minRowsBeforeBreak: 2, repeatHeaderOnPageBreak: false, columns: [{ id: "name", header: "Name", binding: "row.name" }] },
        ] }],
      });
    });
    await expect.poll(() => page.evaluate(() => (window as any).__designer.getState().engine.paginated?.decisions.some((decision: any) => decision.kind === "orphan-control" && decision.page === 2))).toBe(true);
    await page.getByTestId("toggle-pagination").click();
    await page.getByTestId("pagination-decision").first().click();
    const fix = page.getByTestId("pagination-panel").getByRole("button", { name: "Allow 1 row here" });
    await expect(fix).toBeVisible();
    await expect(page.getByTestId("pagination-panel").getByTestId("page-break-details")).toContainText("minimum of 2");
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "56-table-min-rows-break.png") });
    await fix.click();
    expect((await doc(page)).sections[0].children[1].minRowsBeforeBreak).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__designer.getState().engine.paginated?.pages[0]?.content.find((node: any) => node.component.id === "items-table")?.rowRange?.end)).toBe(1);
  });

  test("Table Designer keeps totals with a row and can allow totals alone", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => {
      const state = (window as any).__designer.getState();
      state.setDoc({ ...state.doc,
        page: { size: "custom", width: 300, height: 400, unit: "pt", orientation: "portrait", margin: { top: 0, right: 0, bottom: 0, left: 0 } },
        datasets: [{ id: "items", source: "inline", query: { data: Array.from({ length: 4 }, (_, index) => ({ name: `Item ${index + 1}` })) } }],
        sections: [{ type: "detail", children: [{ type: "table", id: "totals-table", dataset: "items", showFooter: true, columns: [{ id: "name", header: "Name", binding: "row.name", footer: { expression: '"TOTAL"' } }] }] }],
      });
      state.select(["totals-table"]);
    });
    // Size the page from the measured table so all four rows fit but the totals row does not, whatever the fonts.
    const tableHeight = async (showFooter: boolean) => {
      await page.evaluate((showFooter) => (window as any).__designer.getState().patch("totals-table", { showFooter }), showFooter);
      const measure = () => page.evaluate(() => {
        const find = (nodes: any[]): any => nodes.map((n) => (n.component?.id === "totals-table" ? n : find(n.children ?? []))).find(Boolean);
        const node = find((window as any).__designer.getState().engine.paginated?.pages[0]?.content ?? []);
        return node ? { height: node.box.height, footer: node.component.showFooter } : null;
      });
      await expect.poll(async () => (await measure())?.footer).toBe(showFooter);
      return (await measure())!.height;
    };
    const rowsOnly = await tableHeight(false);
    const withTotals = await tableHeight(true);
    await page.evaluate((height) => {
      const state = (window as any).__designer.getState();
      state.setDoc({ ...state.doc, page: { ...state.doc.page, height, orientation: height < 300 ? "landscape" : "portrait" } });
    }, (rowsOnly + withTotals) / 2);
    await expect.poll(() => page.evaluate(() => (window as any).__designer.getState().engine.paginated?.pages[1]?.content[0]?.rowRange?.start)).toBe(3);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "57-table-totals-with-row.png") });
    await page.getByTestId("toggle-pagination").click();
    await page.getByTestId("pagination-decision").first().click();
    await expect(page.getByTestId("page-break-details").getByRole("button", { name: "Allow totals on their own page" })).toBeVisible();
    await page.getByTestId("toggle-pagination").click();
    await page.getByTestId("open-table-designer").click();
    await page.getByTestId("table-tab-totals").click();
    const keep = page.getByLabel("Keep totals with a data row");
    await expect(keep).toBeChecked();
    await page.screenshot({ path: path.join(screenshots, "58-table-totals-designer.png") });
    await keep.uncheck();
    await page.getByTestId("table-designer-done").click();
    expect((await doc(page)).sections[0].children[0].keepFooterTogether).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).__designer.getState().engine.paginated?.pages[0]?.content[0]?.rowRange?.end)).toBe(4);
    await expect.poll(() => page.evaluate(() => (window as any).__designer.getState().engine.paginated?.pages[1]?.content[0]?.rowRange?.start)).toBe(4);
    await page.getByTestId("toggle-pagination").click();
    await page.getByTestId("pagination-decision").first().click();
    await expect(page.getByTestId("page-break-details")).toContainText("on its own as allowed");
    await page.screenshot({ path: path.join(screenshots, "59-table-totals-alone.png") });
  });

  test("view menu toggles overlays and the target selector changes renderer warnings", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-view").click();
    await page.getByTestId("toggle-boundaries").click();
    await expect(page.locator(".page.boundaries")).toHaveCount(1);
    await page.getByTestId("toggle-problems").click();
    await page.getByTestId("btn-more").click();
    await page.getByTestId("target-select").selectOption("xlsx");
    await expect(page.getByTestId("problems")).toContainText(/Excel|XLSX|Absolute/i, { timeout: 8000 });
  });

  test("Focus Canvas hides both side panels and restores their previous state", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-absolute-form").click();
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-view").click();
    await page.getByTestId("toggle-focus-canvas").click();
    await expect(page.getByTestId("canvas")).toBeVisible();
    await expect(page.getByTestId("properties")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Workspace panels" })).toHaveCount(0);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "24-focus-canvas.png") });
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-view").click();
    await page.getByTestId("toggle-focus-canvas").click();
    await expect(page.getByTestId("properties")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Workspace panels" })).toBeVisible();
  });
});

test.describe("canvas interactions", () => {
  test("group, lock and hide via the context menu and shortcuts", async ({ page }) => {
    await absoluteForm(page);
    await page.evaluate(() => (window as any).__designer.getState().select(["title", "name"]));
    await page.keyboard.press("Control+g");
    let d = await doc(page);
    const group = d.sections[0].children[0].children.find((c: any) => c.type === "group" || c.children?.some?.((x: any) => x.id === "title"));
    expect(group).toBeTruthy();

    await page.keyboard.press("Control+Shift+g");
    d = await doc(page);
    expect(d.sections[0].children[0].children.some((c: any) => c.id === "title")).toBe(true);

    await page.evaluate(() => (window as any).__designer.getState().select(["date"]));
    await page.keyboard.press("Control+l");
    expect((await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "date").locked).toBe(true);
    await page.keyboard.press("Control+l");
    await page.keyboard.press("Control+Shift+h");
    expect((await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "date").hidden).toBe(true);
  });

  test("right-click opens the context menu with actions", async ({ page }) => {
    await absoluteForm(page);
    await page.locator('[data-cid="title"]').first().click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.getByTestId("ctx-lock").click();
    expect((await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "title").locked).toBe(true);
  });

  test("double-click edits static text in place", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("palette-text").click();
    const id = (await st(page)).selection[0];
    await expect(page.locator(`[data-cid="${id}"]`).first()).toContainText("New text");
    await page.waitForTimeout(300);
    await page.locator(`[data-cid="${id}"]`).first().dblclick();
    const editor = page.getByTestId("inline-editor");
    await expect(editor).toBeVisible();
    await editor.fill("Hello patients");
    await editor.press("Enter");
    await expect(page.getByTestId("canvas")).toContainText("Hello patients");
  });

  test("floating toolbar changes text style", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("palette-text").click();
    await page.getByTestId("ft-bold").click();
    const d = await doc(page);
    expect(JSON.stringify(d)).toContain('"fontWeight":"bold"');
  });

  test("marquee selects several elements; Shift+Alt-drag duplicates; guides snap", async ({ page }) => {
    await absoluteForm(page);
    await page.waitForTimeout(400);
    const pageBox = (await page.getByTestId("page-1").boundingBox())!;
    await page.mouse.move(pageBox.x + 3, pageBox.y + 3);
    await page.mouse.down();
    await page.mouse.move(pageBox.x + pageBox.width - 3, pageBox.y + pageBox.height / 2, { steps: 6 });
    await page.mouse.up();
    expect((await st(page)).selection.length).toBeGreaterThan(1);

    // Shift+Alt-drag a single element: original stays, a copy is created.
    await page.evaluate(() => (window as any).__designer.getState().select([]));
    const before = (await doc(page)).sections[0].children[0].children.length;
    const el = (await page.locator('[data-cid="date"]').first().boundingBox())!;
    await page.keyboard.down("Alt");
    await page.keyboard.down("Shift");
    await page.mouse.move(el.x + 4, el.y + 4);
    await page.mouse.down();
    await page.mouse.move(el.x + 40, el.y + 70, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await page.keyboard.up("Shift");
    expect((await doc(page)).sections[0].children[0].children.length).toBe(before + 1);
  });

  test("clicking a diagnostics badge opens Problems; one-click fix for an oversized element", async ({ page }) => {
    await absoluteForm(page);
    await page.evaluate(() => {
      const s = (window as any).__designer.getState();
      s.patch("title", { width: 900 });
    });
    await page.getByTestId("toggle-problems").click();
    await expect(page.getByTestId("problem-fix").first()).toBeVisible({ timeout: 8000 });
    await page.getByTestId("problem-fix").first().click();
    expect((await doc(page)).sections[0].children[0].children.find((c: any) => c.id === "title").width).toBeLessThan(900);
    await expect(page.getByTestId("problem-fix")).toHaveCount(0, { timeout: 8000 });
  });

  test("pages tab shows thumbnails that jump to a page", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-account-statement").click();
    await page.getByTestId("left-tab-pages").click();
    await expect(page.getByTestId("page-thumb").first()).toBeVisible();
    await expect.poll(() => page.getByTestId("page-thumb").count()).toBeGreaterThan(1);
  });
});

test.describe("properties, masters, print, blocks", () => {
  test("layers: rename, hide and lock rows; table shows header/detail/footer pseudo rows", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.getByTestId("left-tab-layers").click();
    await page.getByTestId("layer-company").hover();
    await page.getByTestId("layer-actions-company").click();
    await page.getByTestId("ctx-hide").click();
    expect((await company(page)).hidden).toBe(true);
    await expect(page.getByTestId("layer-company").locator(".layer-actions svg")).toHaveCount(1);
    await page.getByTestId("layer-company").focus();
    await page.getByTestId("layer-company").press("F2");
    await page.getByTestId("layer-rename").fill("Company name");
    await page.getByTestId("layer-rename").press("Enter");
    expect(JSON.stringify(await doc(page))).toContain('"name":"Company name"');
    await page.getByTestId("layer-actions-company").click();
    await page.getByTestId("ctx-lock").click();
    await expect(page.getByTestId("layer-company").locator(".layer-actions svg")).toHaveCount(2);
    await page.getByTestId("layer-company").focus();
    await page.getByTestId("layer-company").press("Shift+F10");
    await expect(page.getByTestId("context-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("context-menu")).toHaveCount(0);
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "46-structure-native-actions.png") });
    await expect(page.getByTestId("layers-tab")).toContainText("H  Header");
  });

  test("layout inspector edits margin, padding and size limits; calculated-value builder writes the expression", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("palette-text").click();
    await page.getByTestId("element-tab-layout").click();
    await page.getByLabel("Margin top").fill("6");
    await page.getByLabel("Padding left").fill("4");
    const d = JSON.stringify(await doc(page));
    expect(d).toContain('"margin":{"top":6');
    expect(d).toContain('"padding":{"top":0,"right":0,"bottom":0,"left":4}');

    await page.getByTestId("element-tab-content").click();
    await page.getByTestId("value-mode-formula").click();
    await page.getByTestId("formula-input").fill("params.a * params.b");
    await page.getByTestId("calc-view-builder").click();
    await expect(page.getByTestId("calc-builder")).toBeVisible();
    await page.getByTestId("calc-add").click();
    expect(JSON.stringify(await doc(page))).toMatch(/params\.a \* params\.b [+] /);
  });

  test("page masters: different first page is added from the page panel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.evaluate(() => (window as any).__designer.getState().select([]));
    await page.getByRole("button", { name: /Headers & footers/ }).click();
    // The invoice already has a first-page header; remove it before testing creation.
    await page.getByTestId("master-remove-pageHeader-first").click();
    await page.getByTestId("master-add-pageHeader-first").click();
    const sections = (await doc(page)).sections;
    expect(sections.some((s: any) => s.type === "pageHeader" && s.appliesTo === "first")).toBe(true);
    await page.getByTestId("master-remove-pageHeader-first").click();
    expect((await doc(page)).sections.some((s: any) => s.appliesTo === "first")).toBe(false);
  });

  test("print profile: preset sets page size and dpi; ZPL preview shows source and download", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => (window as any).__designer.getState().select([]));
    await page.getByTestId("report-tab-print").click();
    await page.getByTestId("print-preset").selectOption({ label: "Label 50 × 30 mm (ZPL 203 dpi)" });
    const d = await doc(page);
    expect(d.print).toMatchObject({ printerType: "label", language: "zpl", dpi: 203 });
    expect(d.page.width).toBe(50);
    await expect(page.getByTestId("print-facts")).toContainText("50.0 × 30.0 mm");
    await page.getByTestId("palette-qr-code").click();
    await page.getByTestId("mode-preview").click();
    await page.getByTestId("preview-tab-zpl").click();
    await expect(page.getByTestId("zpl-text")).toContainText("^XA");
    await expect(page.getByTestId("zpl-info")).toContainText("203 dpi");
  });

  test("printer-dot rulers use the selected DPI and can start at the printable margin", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => (window as any).__designer.getState().select([]));
    await page.getByTestId("report-tab-print").click();
    await page.getByTestId("print-preset").selectOption({ label: "Label 50 × 30 mm (ZPL 203 dpi)" });
    await expect.poll(() => page.getByTestId("page-1").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(500);
    await expect(page.getByTestId("ruler-h")).toBeVisible();
    await page.getByTestId("canvas-options").locator("summary").click();
    await page.getByTestId("ruler-unit").selectOption("dots");
    await expect(page.getByTestId("ruler-dpi")).toContainText("203 dpi");
    const mark = page.getByTestId("ruler-h").locator(".tick.major").filter({ hasText: /^200$/ });
    await expect(mark).toBeVisible();
    const at203 = await mark.evaluate((element: HTMLElement) => parseFloat(element.style.left));
    await page.getByTestId("print-dpi").selectOption("300");
    await expect(page.getByTestId("ruler-dpi")).toContainText("300 dpi");
    const at300 = await mark.evaluate((element: HTMLElement) => parseFloat(element.style.left));
    expect(at300).toBeLessThan(at203);
    expect(at300 / at203).toBeCloseTo(203 / 300, 1);

    await page.getByTestId("ruler-origin").selectOption("printable");
    const zero = await page.getByTestId("ruler-h").locator(".tick.major").filter({ hasText: /^0$/ }).evaluate((element: HTMLElement) => parseFloat(element.style.left));
    const margin = await page.getByTestId("margin-marker-left").evaluate((element: HTMLElement) => parseFloat(element.style.left));
    expect(zero).toBeCloseTo(margin, 1);
    for (const axis of ["h", "v"] as const) {
      const ruler = (await page.getByTestId(`ruler-${axis}`).boundingBox())!;
      const label = (await page.getByTestId(`ruler-${axis}`).locator(".tick.major").filter({ hasText: /^0$/ }).locator("span").boundingBox())!;
      expect(label.x).toBeGreaterThanOrEqual(ruler.x);
      expect(label.y).toBeGreaterThanOrEqual(ruler.y);
      expect(label.x + label.width).toBeLessThanOrEqual(ruler.x + ruler.width);
      expect(label.y + label.height).toBeLessThanOrEqual(ruler.y + ruler.height);
    }
    expect(await page.evaluate(() => localStorage.getItem("designer.rulerOrigin"))).toBe("printable");
    await page.getByTestId("canvas-options").locator("summary").click();
    const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, "29-printer-dot-ruler.png") });
  });

  test("label starter: barcode too small gets a one-click fix", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-search").fill("pharmacy");
    await page.getByTestId("starter-pharmacy-label").click();
    await page.evaluate(() => {
      const s = (window as any).__designer.getState();
      s.patch("rx-qr", { width: 12, height: 12 });
    });
    await page.getByTestId("toggle-problems").click();
    await expect(page.getByTestId("problems")).toContainText(/QR code .* should be at least/, { timeout: 8000 });
    await page.getByTestId("problem-fix").first().click();
    expect(JSON.stringify(await doc(page))).not.toContain('"width":12,"height":12');
  });

  test("My Components: save a selection as a reusable block and insert it again", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("palette-text").click();
    await page.getByTestId("save-block").click();
    await page.getByTestId("block-name").fill("Letterhead " + Date.now().toString(36));
    await page.getByTestId("block-save").click();
    await expect(page.getByTestId("my-components").locator(".block-item").first()).toBeVisible();
    const before = (await doc(page)).sections[0].children.length;
    await page.getByTestId("my-components").locator(".block-item").first().click();
    expect((await doc(page)).sections[0].children.length).toBe(before + 1);
  });

  test("new-report dialog: size picker and template search", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("blank-size").selectOption({ label: "Receipt 58 mm" });
    await page.getByTestId("starter-blank").click();
    expect((await doc(page)).page.width).toBe(58);
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-new").click();
    await page.getByTestId("starter-search").fill("wristband");
    await expect(page.getByTestId("starter-wristband")).toBeVisible();
    await expect(page.getByTestId("starter-invoice")).toHaveCount(0);
  });
});

test.describe("data and code tooling", () => {
  test("CodeMirror shows schema errors as squiggles and offers key completions", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("mode-code").click();
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.evaluate(() => {
      const v = (window as any).__codeView;
      const t = v.state.doc.toString().replace('"type": "detail"', '"type": "bogus"');
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
    });
    await expect(page.locator(".cm-lintRange-error").first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("code-status")).toContainText("problem");
  });

  test("CSV dataset becomes inline data with schema view and insights", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("mode-data").click();
    await page.getByTestId("data-add").click();
    await page.getByTestId("dataset-kind-csv").click();
    await page.getByTestId("dataset-csv").fill("name,amount,date\nConsultation,600,2025-01-05\nX-ray,700,2025-01-06\n");
    await page.getByTestId("dataset-test").click();
    await expect(page.getByTestId("dataset-insights")).toContainText("2 rows");
    await page.getByTestId("result-view-schema").click();
    await page.getByTestId("schema-use-preview").click();
    await page.getByTestId("dataset-save").click();
    const d = await page.evaluate(() => (window as any).__designer.getState().doc);
    expect(d.datasets[0].query.data).toEqual([
      { name: "Consultation", amount: 600, date: "2025-01-05" },
      { name: "X-ray", amount: 700, date: "2025-01-06" },
    ]);
    expect(d.datasets[0].schema.fields).toEqual([{ path: "name", kind: "string" }, { path: "amount", kind: "number" }, { path: "date", kind: "date" }]);
  });

  test("compare versions lists changes between a saved version and the editor", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => { const s = (window as any).__designer.getState(); s.setDoc({ ...s.doc, id: "cmp-" + Date.now() }); });
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("status-pill")).toContainText("v1");
    await page.getByTestId("palette-text").click();
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("status-pill")).toContainText("v2");
    await page.getByTestId("btn-more").click();
    await page.getByRole("menuitem", { name: /Compare versions/ }).click();
    await page.getByTestId("compare-from").selectOption({ label: /v1/ as any }).catch(() => {});
    await expect(page.getByTestId("compare-changes")).toBeVisible();
  });
});

test.describe("label sheets", () => {
  test("sticker sheet starter lays 8 labels per A4 sheet and the panel validates fit", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-search").fill("sticker");
    await page.getByTestId("starter-sticker-sheet").click();
    await expect(page.getByTestId("page-2")).toBeVisible();
    await page.evaluate(() => (window as any).__designer.getState().select(["sheet"]));
    await expect(page.getByTestId("sheet-facts")).toContainText("8 labels per sheet");
    await expect(page.getByTestId("sheet-facts")).not.toHaveClass(/bad/);
    // oversize a label: the panel flags it
    await page.getByLabel("Label height (mm)").fill("100");
    await expect(page.getByTestId("sheet-facts")).toHaveClass(/bad/);
  });

  test("insert a Label sheet, pick a stock preset and a start position", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("palette-label-sheet").click();
    await page.getByTestId("sheet-preset").selectOption({ label: "A4 · 3 × 7 (63.5 × 38.1 mm)" });
    let d = await page.evaluate(() => (window as any).__designer.getState().doc);
    const sheet = d.sections[0].children[0];
    expect(sheet).toMatchObject({ type: "labelSheet", columns: 3, rows: 7, labelWidth: 63.5, labelHeight: 38.1 });
    expect(d.page.margin.top).toBe(15.1);
    await page.getByLabel("Start position").fill("5");
    d = await page.evaluate(() => (window as any).__designer.getState().doc);
    expect(d.sections[0].children[0].startPosition).toBe(5);
  });
});

test.describe("AI assistant (BYOK, mocked provider)", () => {
  async function mockProvider(page: Page, reply: unknown, status = 200) {
    let calls = 0;
    let lastBody = "";
    await page.route("https://api.anthropic.com/**", async (route) => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      calls++;
      lastBody = route.request().postData() ?? "";
      await route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(status === 200 ? { content: [{ type: "text", text: JSON.stringify(reply) }] } : { error: { message: "invalid x-api-key" } }) });
    });
    return { calls: () => calls, body: () => lastBody };
  }
  const withKey = async (page: Page) =>
    page.addInitScript(() => localStorage.setItem("designer.ai", JSON.stringify({ provider: "anthropic", model: "claude-test", apiKey: "sk-test", baseUrl: "" })));

  test("selection-scoped edit: proposal previews on the canvas, Accept commits, Undo restores", async ({ page }) => {
    await withKey(page);
    const mock = await mockProvider(page, { explanation: "Made the title larger and bold.", ops: [{ op: "replace", path: "#company/style/fontSize", value: 28 }, { op: "add", path: "#company/style/fontWeight", value: "bold" }] });
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await expect(page.getByTestId("page-1")).toBeVisible();
    await page.evaluate(() => (window as any).__designer.getState().select(["company"]));
    await page.keyboard.press("Control+j");
    await expect(page.getByTestId("ai-scope")).toContainText("1 selected");
    await page.getByTestId("ai-prompt").fill("make the company name bigger and bold");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    await expect(page.getByTestId("ai-changes")).toContainText('changed text "company"');
    // nothing committed yet
    expect((await company(page)).style.fontSize).not.toBe(28);
    // the model never saw sample data values
    expect(mock.body()).not.toContain("Alex Morgan");
    expect(mock.body()).toContain("claude-test");
    await page.getByTestId("ai-accept").click();
    expect(JSON.stringify(await doc(page))).toContain('"fontSize":28');
    await page.getByTestId("btn-undo").click();
    expect(JSON.stringify(await doc(page))).not.toContain('"fontSize":28');
  });

  test("band-scoped edit: the selected band is sent by reference and band changes are listed", async ({ page }) => {
    await withKey(page);
    const mock = await mockProvider(page, { explanation: "Kept the band together and added a note.", ops: [
      { op: "add", path: "@reportFooter/keepTogether", value: true },
      { op: "add", path: "@reportFooter/children/-", value: { type: "text", value: "Thank you" } },
    ] });
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.evaluate(() => {
      const store = (window as any).__designer.getState();
      store.loadDoc({ ...store.doc, id: "band-ai", sections: [{ type: "detail", children: [{ type: "text", id: "body", value: "Body" }] }, { type: "reportFooter", children: [] }] });
      store.set({ selection: [], selectedBand: 1 });
    });
    await page.keyboard.press("Control+j");
    await expect(page.getByTestId("ai-scope")).toContainText("Band @reportFooter");
    await page.getByTestId("ai-prompt").fill("keep this band together and thank the reader");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-changes")).toContainText("changed band @reportFooter: keepTogether");
    expect(mock.body()).toContain("SELECTED band @reportFooter");
    expect(mock.body()).toContain("@detail [detail]");
    await page.getByTestId("ai-accept").click();
    const footer = (await doc(page)).sections[1];
    expect(footer.keepTogether).toBe(true);
    expect(footer.children[0].value).toBe("Thank you");
  });

  test("Reject leaves the report untouched", async ({ page }) => {
    await withKey(page);
    await mockProvider(page, { explanation: "Removed it.", ops: [{ op: "remove", path: "#company" }] });
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.keyboard.press("Control+j");
    await page.getByTestId("ai-prompt").fill("delete the company name");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    await page.getByTestId("ai-reject").click();
    expect(JSON.stringify(await doc(page))).toContain('"id":"company"');
    await expect(page.getByTestId("ai-proposal")).toHaveCount(0);
  });

  test("a bad model reply or provider error is shown, and nothing changes", async ({ page }) => {
    await withKey(page);
    await mockProvider(page, { explanation: "oops", ops: [{ op: "replace", path: "#ghost/value", value: 1 }] });
    await page.goto("/");
    await page.getByTestId("starter-invoice").click();
    await page.keyboard.press("Control+j");
    await page.getByTestId("ai-prompt").fill("do something");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-error")).toContainText("Nothing was changed");
  });

  test("without a key the settings dialog opens; the key is stored locally only", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("starter-blank").click();
    await page.getByTestId("btn-more").click();
    await page.getByTestId("btn-ai").click();
    await page.getByTestId("ai-prompt").fill("add a title");
    await page.getByTestId("ai-send").click();
    await page.getByTestId("ai-key").fill("sk-local");
    await page.getByTestId("ai-settings-save").click();
    const stored = await page.evaluate(() => localStorage.getItem("designer.ai"));
    expect(stored).toContain("sk-local");
    await expect(page.getByTestId("ai-bar")).toBeVisible();
  });
});

test("watermark and bookmark settings write to the report", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByRole("button", { name: "Watermark" }).click();
  await page.getByTestId("watermark-text").fill("CONFIDENTIAL");
  await expect.poll(async () => (await doc(page)).watermark?.text).toBe("CONFIDENTIAL");
  await page.getByTestId("palette-text").click();
  await page.getByTestId("element-tab-rules").click();
  await page.getByRole("button", { name: /Advanced/ }).click();
  await page.getByTestId("flag-bookmark").check();
  expect(JSON.stringify(await page.evaluate(() => (window as any).__designer.getState().doc))).toContain('"bookmark":true');
});

test("table: highlight rows rule and empty-state options write to the report", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-lab-report").click();
  await page.evaluate(() => (window as any).__designer.getState().select(["results"]));
  await page.getByTestId("open-table-designer").click();
  await page.getByTestId("table-tab-conditions").click();
  await page.getByTestId("table-row-rules-add").click();
  await page.getByLabel("Rule 2 field").selectOption("row.value");
  await page.getByLabel("Rule 2 operator").selectOption("gt");
  await page.getByLabel("Rule 2 value").fill("100");
  await page.getByTestId("table-row-rules-add").click();
  await page.getByLabel("Rule 3 field").selectOption("row.value");
  await page.getByLabel("Rule 3 operator").selectOption("lt");
  await page.getByLabel("Rule 3 value").fill("0");
  await page.getByLabel("Rule 3 text colour value").fill("#1d4ed8");
  const rules = (await page.evaluate(() => (window as any).__designer.getState().doc)).sections.flatMap((section: any) => section.children).find((child: any) => child.id === "results");
  expect(rules.rowStyleWhen).toBeUndefined();
  expect(rules.rowRules).toMatchObject([
    { when: "row.value < row.low || row.value > row.high", set: { "style.color": "#b91c1c", "style.fontWeight": "bold" } },
    { when: "row.value > 100", set: { "style.color": "#b91c1c", "style.fontWeight": "bold" } },
    { when: "row.value < 0", set: { "style.color": "#1d4ed8", "style.fontWeight": "bold" } },
  ]);
  await page.getByRole("button", { name: "Move rule 3 up" }).click();
  const reordered = (await page.evaluate(() => (window as any).__designer.getState().doc)).sections.flatMap((section: any) => section.children).find((child: any) => child.id === "results").rowRules;
  expect(reordered.map((rule: any) => rule.when)).toEqual(["row.value < row.low || row.value > row.high", "row.value < 0", "row.value > 100"]);
  await page.getByTestId("table-tab-rows").click();
  await page.getByLabel("Empty state").selectOption("message");
  expect(JSON.stringify(await page.evaluate(() => (window as any).__designer.getState().doc))).toContain('"emptyState":"message"');
});

test("a text element can use the same visual conditional style editor", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("palette-text").click();
  await page.getByTestId("value-text").fill("Priority");
  await page.getByTestId("left-tab-data").click();
  await page.getByTestId("add-dataset").click();
  await page.getByTestId("dataset-id").fill("patient");
  await page.getByTestId("dataset-json").fill(JSON.stringify({ flag: "H" }));
  await page.getByTestId("dataset-save").click();
  await page.getByTestId("element-tab-rules").click();
  await page.getByTestId("component-style-rules-add").click();
  await page.getByLabel("Rule 1 field").selectOption("data.patient.flag");
  await page.getByLabel("Rule 1 value").fill("H");
  const report = await page.evaluate(() => (window as any).__designer.getState().doc);
  expect(report.sections[0].children[0].styleWhen).toMatchObject([{ when: 'data.patient.flag == "H"', style: { color: "#b91c1c", fontWeight: "bold" } }]);
  await page.getByTestId("component-style-rules-code-0").click();
  const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "34-condition-code-tab.png") });
  await page.getByTestId("component-style-rules-formula-0").fill("data.patient.flag ==");
  await expect(page.getByTestId("problem-counts")).toContainText("1 error");
  await page.getByTestId("component-style-rules-formula-0").fill('data.patient.flag == "H"');
  await expect(page.getByTestId("problem-counts")).toContainText("0 errors");
  await page.getByTestId("mode-preview").click();
  await page.getByTestId("preview-tab-html").click();
  const body = page.getByTestId("html-frame").contentFrame().locator("body");
  await expect(body.getByText("Priority")).toHaveCSS("color", "rgb(185, 28, 28)");
});

test("text inspector keeps geometry visible and secondary settings collapsed", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("palette-text").click();
  await page.getByTestId("value-text").fill("Patient name: Asha Rao");
  await expect(page.getByTestId("quick-geometry")).toBeVisible();
  await page.getByLabel("Width", { exact: true }).fill("180");
  await page.getByLabel("Height", { exact: true }).fill("24");
  await expect(page.getByTestId("element-tab-content")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("element-tab-layout")).toBeVisible();
  await expect(page.getByTestId("element-tab-rules")).toBeVisible();
  await expect(page.getByTestId("page-1")).toBeVisible();
  await page.getByTestId("left-tab-layers").click();
  const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "47-contextual-text-inspector.png") });
  await page.getByTestId("element-tab-rules").click();
  await expect(page.getByTestId("visible-when-toggle")).toBeVisible();
  await expect(page.getByTestId("component-style-rules-add")).toBeVisible();
});

test("fixed-height text shows an error until the author chooses an overflow policy", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("palette-text").click();
  await page.getByTestId("value-text").fill(Array.from({ length: 24 }, (_, index) => `Report line ${index + 1}`).join("\n"));
  await page.getByLabel("Height", { exact: true }).fill("20");
  await expect(page.getByTestId("problem-counts")).toContainText("1 errors");
  await page.getByTestId("toggle-problems").click();
  await expect(page.getByTestId("problems")).toContainText("height is limited");
  await page.getByTestId("element-tab-rules").click();
  await page.getByRole("button", { name: /Advanced/ }).click();
  await page.getByLabel("Overflow").selectOption("ellipsis");
  await expect(page.getByTestId("problem-counts")).toContainText("0 errors");
  await expect(page.getByTestId("problems")).toContainText("ellipsis");
  await page.getByTestId("mode-preview").click();
  await expect(page.getByTestId("pdf-frame")).toBeVisible();
});

test("table header grid: add a level, split and merge cells, then edit the label", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-lab-report").click();
  await page.evaluate(() => (window as any).__designer.getState().select(["results"]));
  await page.getByTestId("open-table-designer").click();
  await page.getByTestId("table-tab-header").click();
  await page.getByTestId("header-add-level").click();
  await expect(page.getByTestId("header-cell-0-0")).toContainText("Group");
  await page.getByTestId("header-cell-0-0").click();
  await page.getByTestId("header-split").click();
  await page.getByTestId("header-cell-0-0").click();
  await page.getByTestId("header-cell-0-1").click();
  await page.getByTestId("header-merge").click();
  await page.getByLabel("Selected header text").fill("Test panel");
  const d = JSON.stringify(await doc(page));
  expect(d).toContain('"text":"Test panel","colSpan":2');
  await page.getByTestId("table-designer-done").click();
  await expect(page.locator(".cn-table thead").first()).toContainText("Test panel");
  const originalColumns = await page.evaluate(() => {
    const s = (window as any).__designer.getState();
    const find = (list: any[]): any => list.flatMap((item) => item.children ?? []).find((item) => item.id === "results");
    return find(s.doc.sections).columns.length;
  });
  await page.getByTestId("open-table-designer").click();
  await page.getByTestId("table-designer-add-column").click();
  await page.getByTestId("table-tab-header").click();
  await expect(page.getByTestId(`header-cell-0-${originalColumns}`)).toBeVisible();
  await page.getByTestId("table-tab-columns").click();
  await page.getByTestId(`column-${originalColumns}`).getByLabel("Remove column").click();
  await page.getByTestId("table-tab-header").click();
  await expect(page.getByTestId(`header-cell-0-${originalColumns}`)).toHaveCount(0);
});

test("table body grid: merge and split rows using resolved sample data", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-lab-report").click();
  await page.evaluate(() => (window as any).__designer.getState().select(["results"]));
  await page.getByTestId("open-table-designer").click();
  await page.getByTestId("table-tab-rows").click();
  await expect(page.getByTestId("body-cell-1-0")).toBeVisible();
  await page.getByTestId("body-cell-0-0").click();
  await page.getByTestId("body-cell-1-0").click();
  await page.getByTestId("merge-anchor").selectOption("position");
  await page.getByTestId("body-merge").click();
  expect(JSON.stringify(await doc(page))).toContain('"cellSpans":[{"row":0,"column":0,"rowSpan":2,"colSpan":1}]');
  await page.getByTestId("table-designer-done").click();
  await expect(page.locator(".cn-table tbody td[rowspan='2']").first()).toBeVisible();
  await page.getByTestId("open-table-designer").click();
  await page.getByTestId("table-tab-rows").click();
  await page.getByTestId("body-cell-0-0").click();
  await page.getByTestId("body-split").click();
  await page.getByTestId("table-designer-done").click();
  await expect(page.locator(".cn-table tbody td[rowspan='2']")).toHaveCount(0);
});

test("the more menu links to the feedback form", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("btn-more").click();
  const link = page.getByTestId("menu-feedback");
  await expect(link).toHaveAttribute("href", /\/issues\/new\?template=1-feedback\.yml$/);
  await expect(link).toHaveAttribute("target", "_blank");
});
