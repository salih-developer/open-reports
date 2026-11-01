import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function placeSelected(page: Page, x: number, y: number, width: number, height: number) {
  const props = page.getByTestId("properties");
  await props.getByTestId("element-tab-layout").click();
  const positionFreely = props.getByRole("button", { name: "Position freely" });
  if (await positionFreely.count()) await positionFreely.click();
  await props.getByLabel("Width", { exact: true }).fill(String(width));
  await props.getByLabel("Height", { exact: true }).fill(String(height));
  await props.getByLabel("X position").fill(String(x));
  await props.getByLabel("Y position").fill(String(y));
}

test("build a 40 × 25 mm patient label through the UI, validate it, and preview PDF and ZPL", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("blank-size").selectOption({ label: "Label 40 × 25 mm" });
  await page.getByTestId("starter-blank").click();
  await expect(page.getByTestId("page-1")).toBeVisible();

  await page.getByTestId("left-tab-layers").click();
  await page.getByTestId("section-detail").first().click();
  await page.getByTestId("band-tab-layout").click();
  await page.getByTestId("band-layout-absolute").click();
  await page.getByTestId("page-1").click({ position: { x: 8, y: 8 } });
  await page.getByTestId("report-tab-print").click();
  await page.getByTestId("print-preset").selectOption({ label: "Label 40 × 25 mm (ZPL 203 dpi)" });
  await expect(page.getByTestId("print-preset")).toHaveValue("3");
  await expect(page.getByTestId("print-facts")).toContainText("40.0 × 25.0 mm");
  await expect(page.getByTestId("print-facts")).toContainText("320 × 200 dots");
  await expect(page.locator(".safe-area")).toBeVisible();

  await page.getByTestId("left-tab-data").click();
  await page.getByTestId("add-dataset").click();
  await page.getByTestId("dataset-id").fill("patient");
  await page.getByTestId("dataset-json").fill(JSON.stringify({ name: "Asha Rao", uhid: "UH12345" }));
  await page.getByTestId("dataset-test").click();
  await expect(page.getByTestId("dataset-result")).toBeVisible();
  await page.getByTestId("dataset-save").click();
  await page.getByTestId("left-tab-insert").click();

  await page.getByTestId("palette-text").click();
  await page.getByTestId("value-mode-field").click();
  await page.getByTestId("value-field").selectOption("data.patient.name");
  await placeSelected(page, 0, 0, 68, 10);
  await page.getByTestId("element-tab-style").click();
  await page.getByTestId("properties").getByLabel("Font size").fill("7");

  await page.getByTestId("palette-text").click();
  await page.getByTestId("value-mode-field").click();
  await page.getByTestId("value-field").selectOption("data.patient.uhid");
  await placeSelected(page, 0, 13, 68, 8);
  await page.getByTestId("element-tab-style").click();
  await page.getByTestId("properties").getByLabel("Font size").fill("6");

  await page.getByTestId("palette-barcode").click();
  await page.getByTestId("value-mode-field").click();
  await page.getByTestId("value-field").selectOption("data.patient.uhid");
  await placeSelected(page, 0, 30, 40, 25);
  await page.getByTestId("toggle-problems").click();
  await expect(page.getByTestId("problems")).toContainText("may not scan reliably");
  await page.getByTestId("problem-fix").first().click();

  await page.getByTestId("palette-qr-code").click();
  await page.getByTestId("value-mode-field").click();
  await page.getByTestId("value-field").selectOption("data.patient.uhid");
  await placeSelected(page, 70, 60, 30, 30);
  await expect(page.getByTestId("problems")).toContainText("outside the printer's 1.5 mm safe area");
  await page.getByTestId("properties").getByLabel("Y position").fill("0");
  await expect(page.getByTestId("canvas")).toContainText("Asha Rao");
  await expect(page.getByTestId("problems")).toContainText("No problems found.");

  await page.getByTestId("canvas-options").locator("summary").click();
  await page.getByTestId("ruler-unit").selectOption("mm");
  await expect(page.getByTestId("ruler-h")).toContainText("10");
  await page.getByTestId("ruler-unit").selectOption("dots");
  await expect(page.getByTestId("ruler-dpi")).toContainText("203 dpi");
  await page.getByTestId("canvas-options").locator("summary").click();

  await page.getByTestId("mode-preview").click();
  await expect(page.getByTestId("pdf-info")).toContainText("1 page");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
  const pdf = path.join(os.tmpdir(), `patient-label-${Date.now()}.pdf`);
  await download.saveAs(pdf);
  const size = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
  expect(size).toMatch(/Page size:\s+113\.3\d* x 70\.8\d* pts/);
  expect(execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" })).toContain("Asha Rao");

  await page.getByTestId("preview-tab-zpl").click();
  await expect(page.getByTestId("zpl-info")).toContainText("40.0 × 25.0 mm · 203 dpi · 1 label");
  await expect(page.getByTestId("zpl-text")).toContainText("^PW320");
  await expect(page.getByTestId("zpl-text")).toContainText("^LL200");
  await expect(page.getByTestId("zpl-text")).toContainText("^FDAsha Rao^FS");
  await expect(page.getByTestId("zpl-text")).toContainText("^FDUH12345^FS");
  await expect(page.getByTestId("zpl-text")).toContainText("^BCN");
  await expect(page.getByTestId("zpl-text")).toContainText("^BQN");
  expect(await page.getByTestId("zpl-warnings").count()).toBe(0);

  await page.getByTestId("mode-design").click();
  await page.getByTestId("btn-publish").click();
  await page.getByTestId("publish-run-checks").click();
  await expect(page.getByTestId("publish-preview-reviewed")).toBeVisible();
  await expect(page.getByTestId("publish-review")).toContainText("Ready for review");
  const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-02");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.getByTestId("publish-review").screenshot({ path: path.join(screenshots, "30-patient-label-validation.png") });
});

test("save and reapply a named printer profile to a label", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("blank-size").selectOption({ label: "Label 40 × 25 mm" });
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("page-1").click();
  await page.getByTestId("report-tab-print").click();
  await page.getByTestId("print-preset").selectOption({ label: "Label 40 × 25 mm (ZPL 203 dpi)" });
  await page.getByTestId("save-printer-profile").click();
  await page.getByLabel("New printer profile name").fill("Lab Zebra 40 × 25");
  await page.getByRole("button", { name: "Save", exact: true }).last().click();
  await expect(page.getByTestId("saved-print-profile").getByRole("option", { name: "Lab Zebra 40 × 25" })).toBeAttached();
  const savedId = await page.getByTestId("saved-print-profile").inputValue();
  expect(savedId).toMatch(/^printer-/);

  await page.getByTestId("print-preset").selectOption({ label: "Label 50 × 30 mm (ZPL 203 dpi)" });
  await expect(page.getByTestId("print-facts")).toContainText("50.0 × 30.0 mm");
  await page.getByTestId("saved-print-profile").selectOption(savedId);
  await expect(page.getByTestId("print-facts")).toContainText("40.0 × 25.0 mm");
  const report = await page.evaluate(() => (window as any).__designer.getState().doc);
  expect(report.print).toMatchObject({ language: "zpl", dpi: 203, safeMargin: 1.5 });
  expect(report.page).toMatchObject({ size: "custom", width: 40, height: 25, unit: "mm" });
  const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "50-saved-printer-profile.png") });

  await page.getByTestId("mode-preview").click();
  await expect(page.getByTestId("pdf-info")).toContainText("1 page");
  await page.getByTestId("preview-tab-zpl").click();
  await expect(page.getByTestId("zpl-text")).toContainText("^PW320");
  await expect(page.getByTestId("zpl-text")).toContainText("^LL200");
  await page.getByTestId("mode-design").click();
  await page.getByTestId("report-tab-print").click();
  await expect(page.getByRole("button", { name: "Delete saved profile" })).toBeVisible();
  await page.getByRole("button", { name: "Delete saved profile" }).click();
  await expect(page.getByTestId("saved-print-profile").getByRole("option", { name: "Lab Zebra 40 × 25" })).toHaveCount(0);
  expect((await page.evaluate(() => (window as any).__designer.getState().doc)).print.dpi).toBe(203);
});

test("calibrate a ZPL label from a measured test box and reuse its printer profile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("blank-size").selectOption({ label: "Label 40 × 25 mm" });
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("page-1").click();
  const props = page.getByTestId("properties");
  await props.getByTestId("report-tab-print").click();
  await props.getByTestId("print-preset").selectOption({ label: "Label 40 × 25 mm (ZPL 203 dpi)" });
  const calibration = props.getByTestId("calibration-panel");
  await calibration.locator("summary").click();
  const expected = (await calibration.getByTestId("calibration-expected").innerText()).match(/([\d.]+) × ([\d.]+) mm/);
  expect(expected).not.toBeNull();
  const [testDownload] = await Promise.all([page.waitForEvent("download"), calibration.getByTestId("calibration-download").click()]);
  const testFile = path.join(os.tmpdir(), `label-calibration-${Date.now()}.zpl`);
  await testDownload.saveAs(testFile);
  const pattern = fs.readFileSync(testFile, "utf8");
  expect(pattern).toContain("^PW320\n^LL200");
  expect(pattern).toMatch(/\^FO\d+,\d+\^GB\d+,\d+,1\^FS/);
  await calibration.getByTestId("calibration-width").fill((Number(expected![1]) / 1.008).toFixed(2));
  await calibration.getByTestId("calibration-height").fill(Number(expected![2]).toFixed(2));
  await calibration.getByLabel("Calibration X offset").fill("0.5");
  await expect(calibration.getByTestId("calibration-result")).toContainText("Correction: X 100.8");
  await calibration.getByTestId("calibration-apply").click();
  await expect(calibration.getByTestId("calibration-current")).toContainText("right 0.5 mm");
  expect((await page.evaluate(() => (window as any).__designer.getState().doc)).print.calibration.scaleX).toBeGreaterThan(1);

  await props.getByTestId("save-printer-profile").click();
  await props.getByLabel("New printer profile name").fill("Calibrated Lab Zebra");
  await props.getByRole("button", { name: "Save", exact: true }).click();
  await expect(props.getByTestId("saved-print-profile").getByRole("option", { name: "Calibrated Lab Zebra" })).toBeAttached();
  const savedId = await props.getByTestId("saved-print-profile").inputValue();
  expect(savedId).toMatch(/^printer-/);
  const screenshots = path.resolve("../../output/playwright/ui-audit-2026-10-03");
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, "52-zpl-calibration.png") });

  await props.getByTestId("print-preset").selectOption({ label: "Label 50 × 30 mm (ZPL 203 dpi)" });
  expect((await page.evaluate(() => (window as any).__designer.getState().doc)).print.calibration).toBeUndefined();
  await props.getByTestId("saved-print-profile").selectOption(savedId);
  const report = await page.evaluate(() => (window as any).__designer.getState().doc);
  expect(report.page).toMatchObject({ width: 40, height: 25 });
  expect(report.print.calibration).toMatchObject({ offsetXmm: 0.5 });
  await page.getByTestId("left-tab-insert").click();
  await page.getByTestId("palette-text").click();
  await page.getByTestId("mode-preview").click();
  await page.getByTestId("preview-tab-zpl").click();
  await expect(page.getByTestId("zpl-text")).toContainText("^PW320");
  await expect(page.getByTestId("zpl-text")).toContainText("^FDNew text^FS");
});
