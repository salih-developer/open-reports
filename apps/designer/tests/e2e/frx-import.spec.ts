import { test, expect } from "@playwright/test";

const frx = (title: string) => Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp">
  <Dictionary>
    <TableDataSource Name="Table" Alias="Stok" DataType="System.Int32" Enabled="true">
      <Column Name="Kod" DataType="System.String"/>
      <Column Name="Miktar" DataType="System.Decimal"/>
    </TableDataSource>
    <Total Name="Toplam" Expression="[Stok.Miktar]" Evaluator="Data1" PrintOn="ReportSummary1"/>
  </Dictionary>
  <ReportPage Name="Page1">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="28.35">
      <TextObject Name="Title" Width="400" Height="28.35" Text="${title}" Font="Arial, 14pt, style=Bold"/>
    </ReportTitleBand>
    <DataBand Name="Data1" Width="718.2" Height="18.9" DataSource="Table" BeforePrintEvent="Data1_BeforePrint">
      <TextObject Name="Kod" Width="200" Height="18.9" Text="[Stok.Kod]"/>
      <TextObject Name="Miktar" Left="200" Width="100" Height="18.9" Text="[Stok.Miktar]" Format="Number" Format.DecimalDigits="2" HorzAlign="Right"/>
    </DataBand>
    <ReportSummaryBand Name="ReportSummary1" Width="718.2" Height="18.9">
      <TextObject Name="Sum" Left="200" Width="100" Height="18.9" Text="[Toplam]" Format="Number" Format.DecimalDigits="2" HorzAlign="Right"/>
    </ReportSummaryBand>
  </ReportPage>
</Report>`);

test("a FastReport design opens as a draft with its migration list", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("btn-more").click();
  await page.getByTestId("menu-import-frx").click();
  await page.getByTestId("frx-file").setInputFiles({ name: "StokListesi.frx", mimeType: "application/xml", buffer: frx("Stok Listesi") });
  await expect(page.getByTestId("frx-review")).toContainText("StokListesi.frx");
  await expect(page.getByTestId("frx-review")).toContainText("script event");
  await page.getByTestId("apply-frx").click();
  const state = await page.evaluate(() => {
    const s = (window as any).__designer.getState();
    return { name: s.doc.name, types: s.doc.sections.map((x: any) => x.type), dataset: s.doc.datasets[0], bottom: s.bottom };
  });
  expect(state).toMatchObject({ name: "StokListesi", types: ["reportHeader", "detail", "reportFooter"], dataset: { id: "rows", source: "inline" }, bottom: "migration" });
  await expect(page.getByTestId("migration-panel")).toContainText("Data1_BeforePrint");
  await expect(page.getByTestId("canvas")).toContainText("Stok Listesi");
});

test("several FastReport designs are saved as drafts", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("starter-blank").click();
  await page.getByTestId("btn-more").click();
  await page.getByTestId("menu-import-frx").click();
  const suffix = Date.now().toString(36);
  await page.getByTestId("frx-file").setInputFiles([
    { name: `Alim${suffix}.frx`, mimeType: "application/xml", buffer: frx("Alım") },
    { name: `Satis${suffix}.frx`, mimeType: "application/xml", buffer: frx("Satış") },
  ]);
  await expect(page.getByTestId("save-frx-drafts")).toHaveText("Save 2 drafts");
  await page.getByTestId("save-frx-drafts").click();
  await expect(page.getByRole("dialog")).toContainText(`Alim${suffix}`);
  const ids = await page.evaluate(async () => (await (await fetch("/api/v1/templates")).json()).map((t: { id: string }) => t.id));
  expect(ids).toEqual(expect.arrayContaining([`frx-alim${suffix}`, `frx-satis${suffix}`]));
});
