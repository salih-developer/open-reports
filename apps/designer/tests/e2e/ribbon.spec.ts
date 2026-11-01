import { test, expect, type Page } from "@playwright/test";

/** The style of the one selected component. */
const selectedStyle = (page: Page) => page.evaluate(() => {
  const s = (window as any).__designer.getState();
  const find = (value: any): any => {
    if (!value || typeof value !== "object") return undefined;
    if (value.id === s.selection[0]) return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
  };
  return find(s.doc)?.style;
});

test("ribbon formats the selected text, draws borders and clears formatting", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  const ribbon = page.getByTestId("ribbon");
  // Nothing selected yet: formatting waits for a selection.
  await expect(ribbon.getByRole("button", { name: "Bold" })).toBeDisabled();
  await page.getByTestId("palette-text").click();

  await ribbon.getByRole("button", { name: "Bold" }).click();
  await ribbon.getByRole("button", { name: "Italic", exact: true }).click();
  const size = ribbon.getByLabel("Font size", { exact: true });
  await size.fill("18");
  await size.press("Enter");
  await ribbon.getByRole("button", { name: "Increase font size" }).click();
  await ribbon.getByRole("button", { name: "Centre text" }).click();
  await ribbon.getByRole("button", { name: "Bottom border" }).click();
  await ribbon.getByRole("button", { name: "Choose fill colour" }).click();
  await page.getByRole("dialog", { name: "Fill colour" }).getByRole("button", { name: "Pale blue" }).click();
  await expect(page.getByRole("dialog", { name: "Fill colour" })).toHaveCount(0);

  expect(await selectedStyle(page)).toMatchObject({
    fontWeight: "bold", italic: true, fontSize: 20, align: "center",
    border: { bottom: { width: 1, style: "solid", color: "#000000" } }, background: "#deebf7",
  });
  await expect(ribbon.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  await expect(size).toHaveValue("20");

  // The pen restyles drawn sides; a second side joins the first.
  await ribbon.getByLabel("Border width").selectOption("2");
  await ribbon.getByRole("button", { name: "Top border" }).click();
  expect((await selectedStyle(page)).border).toEqual({
    top: { width: 2, style: "solid", color: "#000000" }, bottom: { width: 2, style: "solid", color: "#000000" },
  });

  await ribbon.getByRole("button", { name: "Clear formatting" }).click();
  expect(await selectedStyle(page)).toBeUndefined();
  await page.getByTestId("btn-undo").click();
  expect(await selectedStyle(page)).toMatchObject({ fontWeight: "bold", fontSize: 20 });
});

test("ribbon tabs follow the keyboard, insert components, and stay collapsed after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  const tabs = page.getByRole("tablist", { name: "Ribbon" });
  await tabs.getByRole("tab", { name: "Home" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Insert" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "Insert" })).toBeFocused();

  await page.getByTestId("ribbon").getByRole("button", { name: "Insert barcode" }).click();
  const types = await page.evaluate(() => JSON.stringify((window as any).__designer.getState().doc.sections));
  expect(types).toContain('"type":"barcode"');

  await page.getByRole("button", { name: "Collapse ribbon" }).click();
  await expect(page.getByRole("tabpanel", { name: "Insert" })).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => (window as any).__designer);
  await page.getByRole("button", { name: /Continue Untitled report/ }).click();
  await expect(page.getByRole("button", { name: "Expand ribbon" })).toBeVisible();
  await page.getByRole("tablist", { name: "Ribbon" }).getByRole("tab", { name: "View" }).click();
  await expect(page.getByRole("tabpanel", { name: "View" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse ribbon" })).toHaveAttribute("aria-expanded", "true");
});
