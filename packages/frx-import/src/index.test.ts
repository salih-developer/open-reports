import { describe, expect, it } from "vitest";
import { importFrx, translateFrxExpression } from "./index.js";

const ledger = `<?xml version="1.0" encoding="utf-8"?>
<Report ScriptLanguage="CSharp">
  <ScriptText>using System;
namespace FastReport
{
  public class ReportScript
  {
    private void Data1_BeforePrint(object sender, EventArgs e)
    {
      TextCaption.Left = 10;
    }
    private void Unused_AfterPrint(object sender, EventArgs e)
    {
    }
  }
}</ScriptText>
  <Dictionary>
    <MsSqlDataConnection Name="Connection" ConnectionString="Data Source=db">
      <TableDataSource Name="Table" Alias="Cari" DataType="System.Int32" Enabled="true">
        <Column Name="CariKod" DataType="System.String"/>
        <Column Name="Tarih" DataType="System.DateTime"/>
        <Column Name="Borc" DataType="System.Decimal"/>
        <Column Name="Alacak" DataType="System.Decimal"/>
        <Column Name="Acik" DataType="System.Int32"/>
      </TableDataSource>
    </MsSqlDataConnection>
    <Parameter Name="Sirket" DataType="System.String"/>
    <Total Name="BorcToplam" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="GroupFooter1"/>
    <Total Name="Genel Toplam" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="ReportSummary1"/>
    <Total Name="AcikBorc" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="GroupFooter1" EvaluateCondition="[Cari.Acik] == 1"/>
    <Total Name="Bakiye" Expression="[Cari.Borc] - [Cari.Alacak] &gt; 0 ? [Cari.Borc] - [Cari.Alacak] : 0" Evaluator="Data1" PrintOn="ReportSummary1"/>
  </Dictionary>
  <ReportPage Name="Page1" PaperWidth="210" PaperHeight="297">
    <ReportTitleBand Name="ReportTitle1" Width="718.2" Height="37.8">
      <TextObject Name="Title" Width="3402" Height="18.9" Text="Cari Ekstre" Font="Arial, 12pt, style=Bold"/>
      <TextObject Name="Company" Top="18.9" Width="300" Height="18.9" Text="[Sirket]" HorzAlign="Right" Font="Arial, 8pt, style=Italic"/>
    </ReportTitleBand>
    <PageHeaderBand Name="PageHeader1" Width="718.2" Height="18.9">
      <TextObject Name="Head" Width="200" Height="18.9" Text="Borç" Fill.Color="Gainsboro" Border.Lines="Bottom"/>
    </PageHeaderBand>
    <GroupHeaderBand Name="GroupHeader1" Width="718.2" Height="18.9" Condition="[Cari.CariKod]" SortOrder="None" RepeatOnEveryPage="true">
      <TextObject Name="Kod" Width="300" Height="18.9" Text="Cari Kod : [Cari.CariKod]" Fill.Color="Silver"/>
      <DataBand Name="Data1" Width="718.2" Height="13.23" DataSource="Table" BeforePrintEvent="Data1_BeforePrint">
        <TextObject Name="Tarih" Width="94.5" Height="13.23" Text="[Cari.Tarih]" Format="Date" Format.Format="d"/>
        <TextObject Name="Borc" Left="94.5" Width="94.5" Height="13.23" Text="[Cari.Borc]" Format="Number" Format.UseLocale="true" HideZeros="true" HorzAlign="Right">
          <Highlight><Condition Expression="[Cari.Borc] &lt; 0" Font="Arial, 8pt, style=Bold" ApplyFont="true" TextFill.Color="Red"/></Highlight>
        </TextObject>
        <TextObject Name="Durum" Left="189" Width="94.5" Height="13.23" Text="[IIf([Cari.Borc] &gt; [Cari.Alacak], &quot;Borçlu&quot;, &quot;Alacaklı&quot;)]" VisibleExpression="[Cari.Acik] == 1"/>
        <TextObject Name="KodKisa" Left="283.5" Width="94.5" Height="13.23" Text="[Cari.CariKod]" WordWrap="false" Trimming="EllipsisCharacter" Font="Arial, 8pt"/>
      </DataBand>
      <GroupFooterBand Name="GroupFooter1" Width="718.2" Height="18.9">
        <TextObject Name="Sum" Left="94.5" Width="94.5" Height="13.23" Text="[BorcToplam]" Format="Number" Format.DecimalDigits="2"/>
        <TextObject Name="Open" Left="189" Width="94.5" Height="13.23" Text="Açık: [AcikBorc]" Format="Number" Format.DecimalDigits="2"/>
        <LineObject Name="Rule" Top="18.9" Width="718.2" Border.Width="3"/>
      </GroupFooterBand>
    </GroupHeaderBand>
    <ReportSummaryBand Name="ReportSummary1" Width="718.2" Height="18.9">
      <TextObject Name="Grand" Width="200" Height="18.9" Text="[Genel Toplam]" Format="Number" Format.DecimalDigits="2"/>
      <TextObject Name="Balance" Left="200" Width="200" Height="18.9" Text="[Bakiye]"/>
    </ReportSummaryBand>
    <PageFooterBand Name="PageFooter1" Width="718.2" Height="18.9">
      <TextObject Name="PageNo" Width="300" Height="18.9" Text="Sayfa [Page#] / [TotalPages#]"/>
    </PageFooterBand>
  </ReportPage>
</Report>`;

const find = (sections: any[], name: string) => sections.flatMap((s) => s.children).find((c: any) => c.name === name);

describe("FastReport import", () => {
  const result = importFrx(ledger, { id: "cari", name: "Cari Ekstre", sourceName: "Cari.frx" });
  const report = result.report as any;

  it("produces a valid report with the dictionary as the host-supplied dataset", () => {
    expect(report).toBeDefined();
    expect(report.locale).toBe("tr-TR");
    expect(report.page).toMatchObject({ unit: "mm", width: 210, height: 297, orientation: "portrait" });
    expect(report.datasets).toEqual([{ id: "rows", source: "inline", query: [], schema: { kind: "array", fields: [
      { path: "CariKod", kind: "string" }, { path: "Tarih", kind: "date" }, { path: "Borc", kind: "number" }, { path: "Alacak", kind: "number" }, { path: "Acik", kind: "number" },
    ] } }]);
    expect(report.parameters).toEqual([{ id: "Sirket", type: "string", required: false }]);
    expect(report.migration).toMatchObject({ sourceFormat: "frx", format: "fastreport", sourceName: "Cari.frx" });
  });

  it("maps bands, nesting and groups", () => {
    expect(report.sections.map((s: any) => s.type)).toEqual(["reportHeader", "pageHeader", "pageHeader", "groupHeader", "detail", "groupFooter", "reportFooter", "pageFooter"]);
    expect(report.groups).toEqual([expect.objectContaining({ id: "group-1", by: "row.CariKod", sort: "none", repeatHeader: true, newPage: "none" })]);
    const detail = report.sections.find((s: any) => s.type === "detail");
    expect(detail).toMatchObject({ dataset: "rows", layout: "absolute", height: 9.92 });
  });

  it("converts text, references, formats, highlights and conditions", () => {
    expect(find(report.sections, "Company")).toMatchObject({ binding: "params.Sirket", style: { align: "right", italic: true, fontSize: 8 } });
    expect(find(report.sections, "Kod")).toMatchObject({ expression: '"Cari Kod : " + (row.CariKod ?? "")', style: { background: "#c0c0c0" } });
    expect(find(report.sections, "Tarih")).toMatchObject({ binding: "row.Tarih", format: "date:dd.MM.yyyy", x: "0pt", width: "70.88pt" });
    const borc = find(report.sections, "Borc");
    expect(borc).toMatchObject({ binding: "row.Borc", format: "number:2" });
    expect(borc.rules).toEqual([
      { when: "row.Borc == 0", set: { value: "" } },
      { when: "(row.Borc < 0)", set: { "style.fontSize": 8, "style.fontWeight": "bold", "style.italic": false, "style.underline": false, "style.strikethrough": false, "style.color": "#ff0000" } },
    ]);
    expect(find(report.sections, "Durum")).toMatchObject({ expression: '((row.Borc > row.Alacak) ? "Borçlu" : "Alacaklı")', visibleWhen: "(row.Acik == 1)" });
    expect(find(report.sections, "PageNo")).toMatchObject({ expression: '"Sayfa " + (page.number ?? "") + " / " + (page.total ?? "")' });
    // A 9.92pt single-line box with 8pt text: the line height fits the box (FastReport's own line spacing is tighter than the PDF font's).
    expect(find(report.sections, "KodKisa")).toMatchObject({ height: "9.92pt", style: { fontSize: 8, wrap: false, overflow: "ellipsis", lineHeight: 1.24 } });
    expect(find(report.sections, "Tarih").style.lineHeight).toBeUndefined();
  });

  it("turns totals into aggregates, and conditional or computed totals into running variables", () => {
    expect(find(report.sections, "Sum")).toMatchObject({ expression: 'sumBy(group.rows, "Borc")', format: "number:2" });
    expect(find(report.sections, "Grand")).toMatchObject({ expression: 'sumBy(data.rows, "Borc")' });
    expect(find(report.sections, "Open")).toMatchObject({ expression: '"Açık: " + formatNumber((vars.AcikBorc ?? 0), 2)' });
    expect(report.variables).toEqual([
      { id: "AcikBorc", scope: "row", expression: "(vars.AcikBorc ?? 0) + ((row.Acik == 1) ? (row.Borc ?? 0) : 0)", resetOn: "group-1" },
      { id: "Bakiye", scope: "row", expression: "(vars.Bakiye ?? 0) + (true ? ((((row.Borc - row.Alacak) > 0) ? (row.Borc - row.Alacak) : 0) ?? 0) : 0)" },
    ]);
  });

  it("keeps FastReport's page geometry: title above the page header on page 1, thick rules, and the page edge", () => {
    const [title, firstHeader, header] = report.sections;
    expect(firstHeader).toMatchObject({ type: "pageHeader", appliesTo: "first", children: [] });
    expect(header.appliesTo).toBeUndefined();
    expect(title.height).toBe(42.53);
    expect(title.children.at(-1)).toMatchObject({ value: "Borç", y: "28.35pt" });
    expect(find(report.sections, "Title").width).toBe("538.58pt");
    const rule = find(report.sections, "Rule");
    expect(rule).toMatchObject({ type: "rectangle", height: "2.25pt", y: "14.18pt", style: { background: "#000000" } });
    expect(report.sections.find((s: any) => s.type === "groupFooter").height).toBe(16.43);
  });

  it("never runs scripts and lists what they did", () => {
    const script = result.issues.find((i) => i.feature === "script event");
    expect(script).toMatchObject({ status: "unsupported", original: "TextCaption.Left = 10;" });
    expect(script?.message).toContain("Data1_BeforePrint");
    expect(result.issues.find((i) => i.feature === "unused script")?.message).toContain("Unused_AfterPrint");
    expect(result.issues.some((i) => i.feature === "data connection")).toBe(true);
  });

  it("carries running page totals forward (devreden / nakli yekûn) and keeps page subtotals per page", () => {
    const frx = ledger
      .replace(`<Total Name="Genel Toplam" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="ReportSummary1"/>`, [
        `<Total Name="Devir" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="PageHeader1" ResetAfterPrint="false"/>`,
        `<Total Name="Nakli" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="PageFooter1" ResetAfterPrint="false"/>`,
        `<Total Name="SayfaToplam" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="PageFooter1"/>`,
        `<Total Name="Genel Toplam" Expression="[Cari.Borc]" Evaluator="Data1" PrintOn="ReportSummary1"/>`,
      ].join(""))
      .replace(`<TextObject Name="Head" Width="200" Height="18.9" Text="Borç"`, `<TextObject Name="Head" Width="200" Height="18.9" Text="Devreden [Devir]"`)
      .replace(`Text="Sayfa [Page#] / [TotalPages#]"`, `Text="[Nakli] / [SayfaToplam]"`);
    const imported = importFrx(frx);
    const sections = imported.report!.sections as any[];
    expect(find(sections, "Head")).toMatchObject({ expression: '"Devreden " + ((page.start.Devir ?? 0) ?? "")' });
    expect(find(sections, "PageNo")).toMatchObject({ expression: '((page.end.Nakli ?? 0) ?? "") + " / " + (sumBy(page.rows, "Borc") ?? "")' });
    expect(imported.report!.variables).toEqual(expect.arrayContaining([
      { id: "Devir", scope: "row", expression: "(vars.Devir ?? 0) + (true ? (row.Borc ?? 0) : 0)" },
      { id: "Nakli", scope: "row", expression: "(vars.Nakli ?? 0) + (true ? (row.Borc ?? 0) : 0)" },
    ]));
    expect(imported.issues.filter((i) => i.feature === "carried-forward total").map((i) => i.status)).toEqual(["converted", "converted"]);
  });

  it("refuses a non-FastReport document", () => {
    const refused = importFrx("<jasperReport/>");
    expect(refused.report).toBeUndefined();
    expect(refused.issues[0]).toMatchObject({ status: "unsupported", feature: "document" });
  });
});

describe("FastReport expression translation", () => {
  const resolve = (name: string) => (name.startsWith("T.") ? `row.${name.slice(2)}` : name === "Page#" ? "page.number" : undefined);

  it("translates operators, IIf, formatting and .NET helpers", () => {
    expect(translateFrxExpression("[T.A] + [T.B] * 2", resolve)).toBe("(row.A + (row.B * 2))");
    expect(translateFrxExpression('IIf([T.A] == DateTime.MinValue, "", [T.A])', resolve)).toBe('((row.A == null) ? "" : row.A)');
    expect(translateFrxExpression('Format("{0:dd.MM.yyyy}", [T.D])', resolve)).toBe('formatDate(row.D, "dd.MM.yyyy")');
    expect(translateFrxExpression("[T.A].ToString(\"N2\")", resolve)).toBe("formatNumber(row.A, 2)");
    expect(translateFrxExpression("Math.Abs((decimal)[T.A]) + 1m", resolve)).toBe("(abs(row.A) + 1)");
    expect(translateFrxExpression("[T.Name].Substring(0, 3).ToUpper()", resolve)).toBe("upper(substring(row.Name, 0, (0) + (3)))");
    expect(translateFrxExpression("String.IsNullOrEmpty([T.N]) ? \"-\" : [T.N]", resolve)).toBe('((row.N == null || trim("" + row.N) == "") ? "-" : row.N)');
    expect(translateFrxExpression("Page#", resolve)).toBe("page.number");
  });

  it("refuses script functions, unknown references and anything outside the supported set", () => {
    expect(() => translateFrxExpression("Tutar([T.A], 2)", resolve)).toThrow(/Tutar\(\)/);
    expect(() => translateFrxExpression("[Other.X]", resolve)).toThrow(/Unknown reference/);
    expect(() => translateFrxExpression("bakiye + 1", resolve)).toThrow(/bakiye/);
    expect(() => translateFrxExpression("System.IO.File.ReadAllText(\"x\")", resolve)).toThrow();
  });
});
