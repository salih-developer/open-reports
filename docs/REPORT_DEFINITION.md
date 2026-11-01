# Report definition reference

The authoritative, machine-readable description is the JSON Schema at `GET /api/v1/schema` (use it for editor autocomplete). This page is the human summary.

```jsonc
{
  "schemaVersion": "1.0",
  "id": "invoice", "name": "Invoice", "locale": "en-IN",
  "theme": { "currency": "INR", "fonts": { "body": "Noto Sans" } },
  "page": { "size": "A4", "orientation": "portrait", "unit": "mm", "margin": {"top":15,"right":15,"bottom":18,"left":15} },
  "parameters": [{ "id": "invoiceId", "type": "string", "required": true }],
  "datasets": [{ "id": "invoice", "source": "inline|json|rest|sql|plugin:<name>", "query": { } }],
  "variables": [{ "id": "total", "scope": "report", "expression": "sumProduct(data.invoice.items, \"quantity\", \"rate\")" }],
  "fragments": [{ "id": "letterhead", "children": [ ] }],
  "watermark": { "text": "CONFIDENTIAL", "opacity": 0.18, "pages": "all" },
  "print": { "printerType": "label", "language": "zpl", "dpi": 203, "safeMargin": 1.5 },
  "sections": [ { "type": "pageHeader", "appliesTo": "first", "children": [ ] }, { "type": "detail", "children": [ ] } ]
}
```
Units are **points** for component sizes (1 pt = 1/72 in) and `page.unit` for the page. Label-sheet sizes are in **mm**.

`watermark` stamps diagonal text on every page (PDF, HTML). Any component can set `bookmark: true` (use its own text) or a string, plus `bookmarkLevel` 1–4, to create PDF outline entries.

For ZPL labels, `print.calibration` can contain `{ "scaleX": 1.008, "scaleY": 1, "offsetXmm": 0.5, "offsetYmm": 0 }`. Scale factors multiply ZPL element positions and dimensions; offsets move the content in millimetres. The declared media width/length and the PDF output stay unchanged. The designer's **Print & labels → Calibrate ZPL printer** control downloads an uncorrected measurement box and derives scale from the measured length. A saved printer profile copies these values into reports when selected.

**Continuous media** (label rolls, wristbands, receipts printed as PDF): `"page": { "width": 100, "height": 150, "unit": "mm", "continuous": { "minLength": 40, "maxLength": 600 } }` produces one page whose length follows the content. `page.height` is ignored for continuous pages; `minLength`/`maxLength` (in `page.unit`) bound it. Content longer than `maxLength` continues on further segments of exactly `maxLength`; without `maxLength` a segment is at most 14400 pt (200 in). The page footer sits directly after the content.

`print.rotation` (`0`, `90`, `180`, `270`) rotates the printed output clockwise without changing the design: PDF pages get a `/Rotate` entry, and ZPL output rotates every field and swaps print width and label length (180 uses `^POI`). Use it for wristbands and labels fed sideways.

## Sections
`reportHeader`, `pageHeader`, `groupHeader`, `detail`, `groupFooter`, `pageFooter`, `reportFooter`, `background` (among other section types in the schema). Page headers, page footers, and backgrounds take `appliesTo`: `first | last | odd | even | standard | all`. The standard/all or unspecified band is the fallback. A variant can copy it and then edit its own `children`, dimensions, and `style` independently. A variant with empty `children` suppresses the fallback for that slot. Background bands are positioned behind page content; their section `style` (for example a fill) and child elements are rendered on the canvas and in the PDF. The report's page size, margins, and orientation remain global.

Bands also accept `hidden: true` to omit them from rendered output while keeping them in the designer's structure view. `locked: true` is a designer layout guard: it prevents moving, resizing, duplicating, or deleting a band; its visibility, name, and print rules can still be edited. Both flags default to false.

A band with no `height` hugs its content; `height` fixes the band's height in points. `layout: "flow"` stacks children, `"row"` places them side by side, `"grid"` uses `columns`, and `"absolute"` uses each child's coordinates. `gap`, `style.padding`, `alignItems`, and row `justifyContent` control the space between and around children. In a row, children without a width fill remaining space according to `grow`; text with `width: "auto"` hugs its measured longest line, while an explicit dimension fixes its width. `wrap: true` moves children onto additional lines when their preferred widths cannot fit together. A child's `shrink` weight allows its assigned width to decrease toward `minWidth` when a line is crowded. Text reflows within the assigned width.

`printAtBottom: true` anchors a band to the bottom of the page body (just above the page footer) on the page where it prints, which suits signatures and totals. The band moves as one block, and anything after it starts on a new page, so a group footer marked this way gives each group its own page. Continuous media has no page bottom, so the band prints where it falls there.

## Expressions
Reference data as `data.<dataset>.<path>`, `params.x`, `vars.x`, `row.x` (inside tables/repeaters), `parent.x`, `page.number`, `page.total`, `page.rows`, `page.start.x`, `page.end.x` (see *Page totals*), `report.name`. Operators: `+ - * / %`, comparison, `&& || !`, `a ? b : c`. Functions include `upper lower trim concat substring replace contains startsWith endsWith round ceil floor abs min max formatDate addDays difference now formatCurrency formatNumber formatPercent sum avg count first last sumBy avgBy minBy maxBy sumProduct`. Unknown names fail with a suggestion. No assignment, no statements, no arbitrary calls.

## Components
Common props: `id`, `name`, `width`, `height`, `x`/`y` (free position), `style`, `rules`, `visibleWhen`, `hidden`, `locked`, `keepTogether`, `keepWithNext`, `pageBreakBefore/After`, `grow`, `gap`, `alignItems`, `justifyContent`, `minWidth/maxWidth/minHeight/maxHeight`. Spacing lives in `style.margin` / `style.padding`.

| Type | Key props |
|---|---|
| `text`, `richText`, `field` | `value` \| `binding` \| `expression`, `format` (`currency`, `date:dd MMM yyyy`, `number`, `percent`), `minLinesAtTop/Bottom`; auto-height flow text continues across pages unless `allowSplit: false` or `keepTogether: true` |
| `table` | `dataset`, `columns[{id, header, binding\|expression, width, align, format, mergeRepeated?, footer:{aggregate}}]`, optional `headerRows[[{column, text, colSpan?, rowSpan?, align?}]]` for a complete multi-level header grid, optional `cellSpans[{row \| match:{field, value}, column, colSpan?, rowSpan?}]` for body merges (see *Table merges*), `showHeader/Footer`, `repeatHeaderOnPageBreak`, `allowRowSplit` (a row that does not fit continues its remaining lines on the next page; without it rows stay whole and a row taller than a page is an error), `rowRules` and `columns[].rules` (see *Table rules*), legacy `rowStyleWhen`, `emptyState`, `minRowsBeforeBreak/AfterBreak`, `filterWhen`, `sortBy` |
| `container`, `row`, `column`, `grid` | `children`, `layout` (`flow\|row\|grid\|absolute`), `columns` |
| `repeater` | `dataset`, `children` = one item; `itemLayout`: `flow` (default, items stacked), `row` (items side by side, sharing the width), `grid` (`columns` items per row, default 2; pages break between rows of items); `gap` |
| `group` | `dataset`, `groupBy`, group header/footer |
| `image`, `qrcode`, `barcode`, `chart`, `line`, `rectangle`, `spacer`, `pageBreak` | `src`/`value`/`symbology`/`series` … |
| `labelSheet` | `columns`, `rows`, `labelWidth`, `labelHeight` (mm), `gapX`, `gapY`, `startPosition`, `dataset` \| `copies`, `outlines`, `children` = **one label** |
| `fragment` | `ref` to `fragments[]` (reusable blocks) |
| `custom` | `kind`, `props` — provided by a plugin |

### Nested lists (master-detail)

A `table`, `repeater`, `list`, `chart` or `group` normally takes its records from a report dataset (`"dataset": "orders"`, or a dotted path into one).
- **Row-relative sources.** Inside a band or repeater that iterates records, the source can instead be a nested list of the current record: `"dataset": "row.lines"`, `"parent.items"` (the record one level out), or `"group.rows"` (the records of the current group).
- **Per-record evaluation.** These sources are evaluated for each record, so each order prints its own lines.
- **Expressions inside the nested list.** `row` is the nested record and `parent` is the enclosing record, for example `"binding": "parent.customer"`.
- **Validation.** Row-relative sources are checked as expressions rather than dataset names.
- **Unreadable lists.** A nested list that can't be read yields no rows, with a `NESTED_LIST_UNAVAILABLE` warning.

### Table merges

- **Merge repeated values.** Set `mergeRepeated: true` on a column. Consecutive rows with the same displayed value print as one merged cell, and blank values never merge.
  - Merges nest: a column never merges across a boundary of a merging column to its left, so Region > Country > City groups correctly.
  - These merges are computed from the output rows after sorting and filtering.
  - When one continues onto another page, it splits at the page break and its value prints again at the top of the new page.
- **Explicit merges.** `cellSpans` entries merge a rectangle.
  - `match: { field, value }` anchors the merge to the first output row whose `field` expression equals `value` (strict equality). It follows that record through sorting and filtering. When no row matches, the merge is skipped with `TABLE_SPAN_ANCHOR_NOT_FOUND`.
  - `row` fixes the merge at a row position, whatever record is there.
  - Exactly one of `row` or `match` is required. Explicit merges keep their rows on one page.
  - An explicit merge overrides an overlapping automatic merge, with a `TABLE_AUTO_MERGE_CONFLICT` warning. Explicit merges that collide in the output are reported as `TABLE_SPAN_CONFLICT`.

### Table rules

Tables take rules in the same shape as component rules (`{ when, set, else? }` or `{ cases, else? }`), decided before pagination:

- `rowRules` run once per row. They can set `style.*` for the whole row (`color`, `background`, `fontWeight`, `italic`, …) or `visible: false` to leave the row out of the table and its totals.
- `columns[].rules` run once per cell, with the cell's raw value available as `value`. They can set `style.*` for that cell, or `text` to print something else (`{ "expr": "\"(\" + formatNumber(-value, 2) + \")\"" }` for accounting negatives). A column rule that sets `visible` hides the whole column; its condition is decided once per run and cannot use `row`, `value`, `parent` or `group`. Header groups and merges stay aligned when a column is hidden.

```json
{ "type": "table", "dataset": "lines",
  "rowRules": [{ "when": "row.status == \"void\"", "set": { "visible": false } }],
  "columns": [
    { "id": "amount", "binding": "row.amount", "format": "number:2",
      "rules": [{ "when": "value < 0", "set": { "style.color": "#b91c1c" } }] },
    { "id": "cost", "binding": "row.cost", "rules": [{ "when": "!params.showCost", "set": { "visible": false } }] }
  ] }
```

`rowStyleWhen` (`[{ when, style }]`) still works and runs before `rowRules`. The designer converts it to `rowRules` the first time you edit a table's conditions.

### Text overflow and strict output

Auto-height text in a flow band continues onto later pages. A fixed `height` or `maxHeight` prevents that split. If the measured text exceeds the box, the designer shows `TEXT_EXCEEDS_HEIGHT` as an error and the render API returns HTTP 422 with the affected component in `error.details.warnings`. Set a larger height, remove the height, or choose `style.overflow: "clip"` or `"ellipsis"` when shortening is intentional. `ellipsis` fits one measured line; `clip` keeps the box height. Intentional shortening appears as the warning `TEXT_TRUNCATED_BY_POLICY` in analysis. Fixed-height containers whose descendants extend past the box raise `CONTAINER_CONTENT_EXCEEDS_HEIGHT`.

For `layout: "row"`, an item that extends beyond its row gets `ROW_CONTENT_EXCEEDS_WIDTH`. If it also passes the printable right edge, `CONTENT_EXCEEDS_PRINTABLE_WIDTH` replaces that warning and strict PDF/HTML rendering fails. The warning identifies the item; reduce fixed widths or gaps, or leave a child flexible. When an auto-height row is taller than a page, the paginator continues its direct text children in aligned page fragments, retaining a short non-text child beside the first fragment. Each continuation records a `row-split` explanation. Fixed-height and other unsplittable row content still raises `CONTENT_OVERFLOWS_PAGE` and blocks strict output.

The render API applies this strict check by default to inline renders, template renders and jobs. Existing callers that explicitly accept the risk can send `"strict": false`; the renderer still constrains fixed-height PDF text and reports warnings. `/api/v1/analyze` sets `valid: false` for data-loss warnings and returns the full warning list.

### Image sources

An image `src` can be an embedded PNG/JPEG/WebP data URL, a file path readable by the reporting server, a `file://` URL, or an HTTP(S) image URL. The designer's **Embed image from file** action stores a copy in the report. Entering a path or URL stores only that reference; the server reads it again on every render, so replacing the image at the same location updates later output without editing the report. A path on a designer user's computer works only if the reporting server can access that same path. Relative paths are relative to the server's working directory; `~/` uses the server user's home directory.

Linked files and URLs are limited to 5 MB and must contain PNG, JPEG, or WebP image bytes. A linked file path must be inside a folder listed in `REPORT_IMAGE_ROOTS` on the reporting server (comma-separated); symlinks may not lead outside those folders, and every local path is refused when the setting is empty. A refused path and a missing file return the same error. Public URLs work by default. Private/internal URL hosts require `REPORT_IMAGE_ALLOWED_HOSTS`, a comma-separated list of permitted hostnames; when this is set, other URL hosts are rejected. Every redirect is checked again (at most 3), an https URL may not redirect to http, and connections are made only to the address that was checked. The preview endpoint requires the same API authentication as rendering.

### Styles

Every component accepts `style`: `fontFamily`, `fontSize`, `fontWeight`, `italic`, `underline`, `strikethrough`, `align`, `verticalAlign` (`top`, `middle`, `bottom`: where text sits in a box taller than its lines, such as a fixed `height` or a stretched row), `lineHeight`, `letterSpacing`, `color`, `background`, `padding`, `margin`, `border`, `borderRadius` (points; rounds the background and border), `overflow`, `direction`.

### Variables

`variables[]` take `id`, `scope` and `expression`, and are read as `vars.<id>`. `report` variables are computed once; `group` variables once per group instance over that group's rows; `row` variables once per detail record, in print order, so they can accumulate: `"(vars.balance ?? 0) + row.amount"` is a running balance. Set `resetOn` to a group id to restart a row variable at each instance of that group (a running total per region). Row variables also accumulate over table rows.

`page` variables are computed once per page for page headers, footers and backgrounds, after pagination, from the page values below.

### Page totals

Page headers, footers and backgrounds know which records printed on their page. A record counts on the page where its detail band or table row starts.

| Value | Meaning |
| --- | --- |
| `page.rows` | The records printed on this page. `sumBy(page.rows, "amount")` is the page subtotal. |
| `page.start.<id>` | Row variable `<id>` before this page's first record: the total carried forward from earlier pages (*devreden*). |
| `page.end.<id>` | Row variable `<id>` after this page's last record: the total carried to the next page (*nakli yekûn*). |

A page with no records carries the previous value through. Before the first record a variable reads as undefined, so write `page.start.total ?? 0`. Body bands have no page of their own: there `page.rows` is empty and `page.start` / `page.end` read as undefined.

```json
"variables": [
  { "id": "debit", "scope": "row", "expression": "(vars.debit ?? 0) + row.debit" },
  { "id": "pageDebit", "scope": "page", "expression": "sumBy(page.rows, \"debit\")" }
],
"sections": [
  { "type": "pageHeader", "children": [{ "type": "text", "expression": "\"Devreden: \" + formatNumber(page.start.debit ?? 0, 2)" }] },
  { "type": "detail", "dataset": "entries", "children": [{ "type": "text", "binding": "row.debit", "format": "number:2" }] },
  { "type": "pageFooter", "children": [
    { "type": "text", "expression": "\"Sayfa toplamı: \" + formatNumber(vars.pageDebit, 2)" },
    { "type": "text", "expression": "\"Nakli yekûn: \" + formatNumber(page.end.debit ?? 0, 2)" }
  ] }
]
```

## Datasets
- `inline`: `{ "data": [...] }`
- `json`: sandboxed file read.
- `rest`: `{ url, method, headers, query, body, resultPath }`; `{{params.x}}` and `{{secrets.NAME}}` are substituted; SSRF-guarded.
- `sql`: `{ connectionId, sql, params: ["{{params.id}}"] }` — parameterised; `connectionId` is registered by the server; optional `timeoutMs` and `maxRows`. Each query runs as one statement in a read-only transaction (writes, DDL and multiple statements are refused), is cancelled on the database server at its time limit, and stops reading at `maxRows`. A result cut off at `maxRows` is not yet reported as a warning.
- Nested lists are addressed with a dotted dataset path, e.g. `"dataset": "invoice.items"`.

An optional dataset `schema` records field names and types for authoring when sample rows are empty or unavailable. For example: `"schema": { "kind": "array", "fields": [{ "path": "patient.name", "kind": "string" }, { "path": "amount", "kind": "number" }] }`. Paths are dot-separated; field kinds are `string`, `number`, `boolean`, `date`, `object`, or `array`. This metadata drives the designer's field tree, binding choices, and generated table/card fields. It does not fabricate runtime records or change source responses. Reports without it continue to infer fields from sample values.

The declared fields are also a **data contract**.
- Every render checks the full response against them: every row and every nested list item, up to a budget of 5 million values. A check stopped by the budget is reported as `DATASET_SHAPE_PARTIALLY_CHECKED`.
- Mismatches are grouped by field and type, with counts and example locations such as `row 5000 lines[2]`.
- By default a mismatch is a `DATASET_SHAPE_MISMATCH` warning, and its details are available from `/api/v1/analyze`.
- With `"onMismatch": "error"` the render fails with HTTP 422 instead of printing data that does not match.
- Null and empty values are counted as unchecked, not as mismatches.
- The designer runs the same check on its sample data.

The designer compares declared fields with a bounded preview sample and reports shape, missing-field, and type mismatches. Null values and empty nested lists are counted as unchecked. The comparison does not change source data or reject rendering; absence of warnings only covers the values actually checked.

See `examples/` for complete, working definitions of each feature.

Table merge coordinates are zero-based. Body `row` positions refer to resolved rows **after** filtering and sorting. The top-left cell supplies the merged value; covered values are suppressed and a warning is emitted when they differ. Vertical body merges move as a unit at page breaks; a merge taller than one printable page fails explicitly.

## Theme, tokens and text styles

`theme` holds reusable values:
- `colors`, `fonts` (font families), `fontSizes` and `spacing` (points), each a name → value table;
- `textStyles`: named partial styles;
- `locale`, `currency`, and `timezone`: an IANA name such as `"Europe/London"` used by `date:` formats and `formatDate()`. Without it, dates use the server's local time. An unknown name is a validation error;
- `locale`, `currency` and `timezone`.

**Using tokens.**
- A style refers to a token as `"$name"`. The property decides which table is read:
  - `color`, `background` and border colours → `colors`;
  - `fontFamily` → `fonts`;
  - `fontSize` → `fontSizes`;
  - `padding`, `margin` (or any of their sides) and `gap` → `spacing`.
- `"textStyle": "title"` applies a text style beneath the component's own style, so the component's own properties win. Text styles may use tokens too.
- Tokens and text styles are resolved after conditional rules, so rules can set `"style.color": "$danger"` or `"textStyle": "warning"`. Every renderer receives final values.

**Errors.**
- Validation reports `THEME_UNKNOWN_TOKEN` and `THEME_UNKNOWN_TEXT_STYLE` at the exact path, including inside rules, `styleWhen` and the theme's own text styles.
- At render time an unknown token is left unset, with a warning, and is never passed to a renderer.

**In the designer.** **Edit theme…** (report properties, or the command palette) manages tokens and text styles. Renaming one updates every reference in the report, and deleting one in use asks first.

### Table styles

- **Setting styles.** A table's `styles` set:
  - `header`, `body`, `alternateRow` (every second row of the whole table) and `footer`, each with `color`, `background`, `fontWeight` and `italic`;
  - `grid: { lines, color, width }`, where `lines` is `none`, `header` (the default: under the header and above the footer), `horizontal` (also between rows) or `all` (every cell and the outline).
- **Presets.** `theme.tableStyles` holds named presets, applied with `tableStyle`; `styles` overrides a preset section by section. Both may use theme tokens.
- **Where they apply.** PDF, HTML, XLSX (fonts, fills and borders) and the designer canvas all use the same resolved styles.
- **What styles can't change.** Font size and padding stay on the table itself, so styling never moves a page break.
- **Measurement.** Row heights are measured with the weight and slant each row is drawn with.
- **Tables without styles.** They keep their previous look. Grey stripes from `alternateRowStyle` now follow the row's position in the whole table, so they continue consistently across pages.

### Crosstabs (pivot tables)

A `crosstab` summarises a dataset: distinct values of `rows` down the side, of `columns` across the top, and `measures` aggregated in each cell.

```json
{ "type": "crosstab", "dataset": "sales",
  "rows": [{ "binding": "row.region", "header": "Region" }, { "binding": "row.doctor" }],
  "columns": [{ "binding": "row.month", "sort": "asc" }],
  "measures": [{ "binding": "row.amount", "aggregate": "sum", "format": "currency" }, { "binding": "row.amount", "aggregate": "count", "header": "Visits" }],
  "totalColumn": true, "totalRow": true, "totalLabel": "Total" }
```

- **Aggregates.** `sum` (the default), `count`, `avg`, `min` and `max`. Totals are computed from the raw values, so an average total is the average of all values, not an average of averages.
- **Sorting.** Each dimension sorts `asc` (the default) or `desc`; numbers sort numerically and text naturally ("Item 2" before "Item 10").
- **Nesting.** Several `rows` nest, with repeated outer values merged. Several `measures` produce a two-level header: column values on top, measure names underneath.
- **Headings.** A dimension or measure without a `header` gets one from its field name (`row.unit_price` → "Unit price").
- **Size.** At most `maxColumns` column values (default 60) are shown; the rest are left out with a `CROSSTAB_COLUMNS_TRUNCATED` warning.
- **Output.** A crosstab becomes an ordinary table before layout, so it paginates, repeats its header on every page (`repeatHeaderOnPageBreak`), takes `tableStyle` and `styles`, and exports to PDF, HTML, Excel and CSV like any table.
- **In the designer.** Add **Crosstab** from the Data group, then choose a dataset: rows, columns and a sum are filled in from its fields, and can be changed in the inspector.
- **From JasperReports.** JRXML crosstabs import as crosstabs: row and column groups, measures (Sum, Count, Average, Lowest, Highest) and totals. Cell layouts, colours and number patterns are listed for review.

### Links and drill-through

Any element, and any table column (one link per cell), can take a `link` with exactly one of:

```json
"link": { "url": "https://example.com/help" }
"link": { "expression": "\"https://track.example.com/\" + row.awb" }
"link": { "report": "invoice", "parameters": { "invoiceId": "row.id" } }
```

- `url` and `expression` may produce `http`, `https`, `mailto` or `tel` links; anything else (`javascript:`, `data:`, `file:`) is left out with a `LINK_BLOCKED` warning. They are clickable in PDF and HTML.
- `report` links drill through: the report viewer opens that template with the parameters evaluated for the clicked record, with a Back button. PDFs leave them out.
- In the designer: **Content → Link** on text, fields and images.

### Drill-down groups

`group` takes `drillDown: "expanded"` or `"collapsed"`. The report viewer then shows ▸/▾ beside each group header; toggling re-renders with that group's rows shown or hidden, and headers and footers (subtotals) always print. PDFs and other exports use the current state. In the designer: **Grouping → In the report viewer**.

## Reusable blocks

- **Report-local blocks.** `fragments` holds reusable component groups for one report. A `{ "type": "fragment", "ref": "<id>" }` component prints one.
- **Library blocks.** The server's block library (`/api/v1/blocks`) stores blocks shared across reports.
  - Every save creates an immutable version. The new number is returned in the `x-block-version` header; history is at `/api/v1/blocks/:id/versions` and each version at `/versions/:n`.
- **Placing a library block.** It is placed as a fragment with `source: { block, version, mode }` and a snapshot of that version in `children`:
  - **`linked`** follows the library. The designer updates the snapshot when the report opens, and renders and analyses use the library's latest version. If the library can't supply the block, the snapshot is used with a `BLOCK_UNAVAILABLE` warning.
  - **`pinned`** always renders its own snapshot until it is deliberately updated.
  - A **detached** block is an ordinary copy with no link.

## Conditional rules

Any component and any band may declare `rules`. A rule changes properties of the object it is declared on when its condition holds. Rules run in order; when two rules set the same property, the later one wins.

```json
"rules": [
  { "name": "Flag colour",
    "cases": [
      { "when": { "field": "row.flag", "op": "==", "value": "H" }, "set": { "style.color": "#b91c1c", "style.bold": true } },
      { "when": { "field": "row.flag", "op": "==", "value": "L" }, "set": { "style.color": "#1d4ed8" } }
    ],
    "else": { "style.color": "#111827" } },
  { "when": "params.patientType != 'IP'", "set": { "visible": false } },
  { "when": { "all": [{ "field": "row.note", "op": "isNotEmpty" }, "params.showNotes"] }, "set": { "value": { "expr": "'Note: ' + row.note" } } }
]
```

- **Shape.** `{ when, set, else? }` is IF/THEN/ELSE. `{ cases: [{ when, set }…], else? }` is IF / ELSE IF / ELSE: the first case whose condition holds applies. Optional fields are `id`, `name`, `disabled` and `phase`.
- **Conditions.** A condition is either a safe expression string or a structured tree. The tree uses `{ "all": […] }`, `{ "any": […] }`, `{ "not": … }` and comparisons `{ "field", "op", "value" }`. `field` is an expression, usually a path. The operators are `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `notContains`, `startsWith`, `endsWith`, `in` and `notIn` (with an array `value`), plus `isEmpty` and `isNotEmpty`. Equality is strict, and `>`/`<` compare only two numbers or two strings.
- **Targets.** `set` and `else` map property paths to values, relative to the object: `"style.color"`, `"keepTogether"`, `"pageBreakBefore"` or `"width"` on a component, and `"newPageBefore"`, `"keepTogether"` or `"height"` on a band. Any property the schema allows on that object may be set.
  - `"visible": false` hides the object.
  - Setting `value`, `binding` or `expression` replaces the content and clears the other two.
  - A value is used literally unless it is `{ "expr": "…" }`, which is computed.
  - Rules cannot change identity or structure (`id`, `type`, `children`, `dataset`, group links). A component or band with `hidden: true` stays hidden.
  - Validation reports unknown targets, invalid literal values and syntax errors at the exact rule path.
- **Phases.** The phase is inferred from what the rule reads and may be pinned with `phase`.
  - Rules on parameters, data, rows, groups and variables are decided while the report resolves, before layout.
  - Rules that read `page.*` (`number`, `total`, `isFirst`, `isLast`, `isOdd`, `isEven`) are decided per page after pagination. This currently works only inside page headers, footers and backgrounds. Elsewhere validation reports `RULE_PHASE_UNSUPPORTED`.
  - Layout, output (`renderer.*`) and print (`print.*`) phases are reserved and not supported yet.
- **Errors.** A rule whose condition or computed value fails is skipped, and the render gets a `RULE_CONDITION_FAILED` warning with the component id.
- **Explanations.** `resolveReport(…, { traceRules: true })` returns `ruleDecisions`. Each decision records every condition clause, the value it saw, the case that matched and the values applied, including for objects that ended up hidden.

**Legacy fields.** These remain supported and are evaluated by the same engine:
- `visibleWhen` hides the object when its expression is false. A failing expression shows a component (with a warning) and fails the render for a band.
- `styleWhen: [{ when, style }]` merges styles into the resolved style.
- `rowStyleWhen` on tables styles matching rows; it is not part of `rules` yet.

A `visibleWhen` or `rules` on a page header, footer or background band is now evaluated; previously it was ignored. The designer's visual condition controls currently edit `styleWhen` and `rowStyleWhen`.
