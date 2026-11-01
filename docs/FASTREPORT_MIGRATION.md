# FastReport migration

Import FastReport `.frx` designs into editable Open Reports definitions. Every source feature gets an explicit status: `converted`, `needs-review` or `unsupported`. Like the [JRXML import](JRXML_MIGRATION.md), the result is a draft. It is not proven equal to FastReport output until it has been compared with real data.

## Importing

- **Designer:** **More report actions → Import FastReport…**, or **Import FastReport** in the New report dialog. Choose one `.frx` file to open it as a draft with the **Migration** panel open. Choose several to save them all as drafts on the server.
- **Code:** `importFrx(xml, { id, name, sourceName, locale, currency })` from `@reporting/frx-import` returns `{ report, issues, summary }`. `report` is a validated definition, or undefined when the file cannot be read.

The parser refuses DTDs and files over 10 MB or 50,000 elements. The C# script is read only to report on it. Nothing in it runs.

## Data comes from the host

A FastReport design names its data source in the dictionary (`TableDataSource` with its columns). The import turns that into an inline dataset `rows` with a `schema` that lists the columns and their types. The SQL, connection strings and business objects are not imported. The application renders a report by sending the definition and the rows:

```json
POST /api/v1/render
{ "report": <definition>, "format": "pdf",
  "data": { "rows": [ { "CariKod": "120.01.001", "Borc": 1250.75 } ] },
  "parameters": { "Sirket": "…", "Donem": "2026", "Kriter": "…" } }
```

Column names keep their FastReport spelling, so rows from the code that fed FastReport fit unchanged. Dictionary parameters become report parameters (`params.Sirket`).

## What converts

| FastReport | Open Reports |
| --- | --- |
| ReportTitle, PageHeader, ColumnHeader, DataHeader, Data, GroupHeader, GroupFooter, DataFooter, ReportSummary, ColumnFooter, PageFooter, Overlay, Child bands | The same band types, in absolute layout at the designed size (px at 96 dpi → pt). Nested groups keep their order. |
| GroupHeader `Condition`, `SortOrder`, `RepeatOnEveryPage`, `StartNewPage` | `groups[]` with `by`, `sort`, `repeatHeader`, `newPage`. |
| TextObject `[Table.Column]`, parameters, `[Page#]`, `[TotalPages#]`, `[Date]`, text with several `[…]` parts | Bindings and expressions (`row.X`, `params.X`, `page.number`, `page.total`, `now()`). Column references in title and summary bands read the first or last row. |
| C# in `[…]`: operators, `?:`, `IIf`, `FormatNumber`, `Format("{0:…}")`, `ToString("N2")`, `Math.*`, `Convert.To*`, `String.IsNullOrEmpty`, `Substring`, `ToUpper`… | Expression language equivalents. Anything else is listed for review and prints a red placeholder. |
| Format Number, Currency, Percent, Date, Time, Custom | `number:n`, `currency:TRY`, `percent`, `date:pattern`. The report locale is `tr-TR` unless another is passed. As in FastReport, a format applies only to values of its kind. |
| Totals: Sum, Count, Avg, Min, Max | `sumBy`/`count`/`avgBy`/`minBy`/`maxBy` over `group.rows`, `page.rows` or the dataset, by the band that prints them. Totals with `EvaluateCondition`, a computed expression, or `ResetAfterPrint="false"` become running row variables. |
| Running totals in a page header or footer (*devreden* / *nakli yekûn*) | `page.start.<total>` in the header (carried forward from earlier pages) and `page.end.<total>` in the footer (carried to the next page). See [Page totals](REPORT_DEFINITION.md#page-totals). |
| Font size and style, alignment, colours, fill, borders (sides, width, dot/dash), padding, word wrap, trimming | `style`. Arial, Tahoma and Calibri print in the bundled Noto Sans. |
| `HideZeros`, `Highlight` conditions, `VisibleExpression`, `Visible` | Component `rules`, `visibleWhen`, `hidden`. |
| LineObject | `line`; rules thicker than 1.5 px become a filled bar of the same thickness. |
| BarcodeObject (Code 128, Code 39, EAN-13, UPC), PictureObject, ShapeObject | `barcode`, `image`, `rectangle`. |
| MatrixObject | `crosstab` with the same rows, columns, values and totals. |
| Report title above the page header on page 1 (`TitleBeforeHeader`) | An empty first-page header master and a copy of the page header under the title. |

Objects that run past the page edge are cut to the printable width, and bands grow to hold objects that overhang them, as FastReport draws them.

## What needs review

- **Script events** (`BeforePrint`, `AfterPrint`, `AfterLayout` handlers) are unsupported. The review list shows the handler body. Rebuild the effect with variables, rules, or columns computed by the host. Handlers no object uses are listed and ignored.
- **Script helper functions** called from text, such as `Tutar(…)` or `AyAdi(…)`, are not translated.
- **CanGrow / CanShrink** texts and bands keep their designed height and clip longer text.
- Data band filters, multi-column bands, `Duplicates`, rotated text, per-group page numbering, mirror margins and diagonal lines are listed where they occur.

## Pilot: WP_NEW reports (2026-11-01)

The source was the 41 designs in `BTECHCORE.reporting_rapor` of the WP_NEW ERP (`rapordata`, or `reportxml` when that is empty). The designs, SQL and data stay outside this repository.

- All 41 import as schema-valid definitions: 1,480 converted bands, objects and totals.
- All 41 render to PDF through `POST /api/v1/render`, using six synthetic rows built from each design's column types.
- Review notes:

| Feature | Notes | Reports |
| --- | --- | --- |
| CanGrow text or band | 96 | 32 |
| Script event (unsupported) | 36 | 12 |
| Text expression calling a script helper | 18 | 2 |
| Object cut at the page edge | 10 | 3 |
| Total became a running variable | 10 | 5 |
| Script helper functions | 8 | 8 |

The four carried-forward totals of the Yevmiye Defteri (*devreden* and *nakli yekûn*, debit and credit) convert to `page.start` / `page.end`. With 90 synthetic journal lines over three pages, each page header carries exactly the previous page's footer total.

The synthetic-data PDFs show that every report is laid out and renders. They do not show that it is equal to FastReport output. Comparing each report with FastReport on the same rows is still required.
