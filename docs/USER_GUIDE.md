# User guide

Open the designer (`http://localhost:3000`). Everything you do edits one JSON document; you can see and edit it any time in **Code**.

If you are deciding where to start, select **What can I do?** on Home or the **?** button in the designer. The guide explains the purpose of Word/JRXML import, crosstabs, precise canvas layout, Word export, the published viewer, and embedding, with an action for each. The **Sales by region and service** starter is a ready crosstab to explore.

## 1. Your first invoice (no documentation needed)
1. **New report → Invoice** (or **From sample JSON**: paste a response from your API and the report is generated with fields and tables).
2. Click any text on the page. The right panel shows its content as **Text · Field · Formula** — pick **Field** to bind to data.
3. In **Data**, search by field name, path, or type. Check the sample value, then drag a field onto the intended report band. Drag a *list* (e.g. `items`) and choose **Table**, **Repeater**, or **Cards**. Leave **Create fields automatically** on to bind columns or card fields from the sample; turn it off to start with a blank editable field.
4. Changing a total? Choose **fx Formula → Builder**: pick *Quantity × Rate* from dropdowns. Switch to **Formula** for the raw expression; autocomplete and errors appear as you type.
5. **Preview** shows the real PDF. Use **Pages** for thumbnails, enter a page number, choose **Fit page**, **Fit width** or a zoom level, and use **Find** to locate text on a page. PDF text can be selected and copied in Preview, and Find highlights phrases split between PDF text items. Only the current page and nearby thumbnails are drawn in long reports. **Open to print** opens the PDF in the browser's viewer; **Download PDF** saves the same generated file shown in Preview. **More report actions → Export** also gives HTML, Excel, CSV or a ZPL label. **Save** keeps a version. **Publish** opens a review: run validation and boundary-data checks, inspect the generated PDF, review warnings, and enter version notes. Critical errors block publishing; published versions never change.

**Experimental JasperReports export:** open **More report actions → Export…**. JRXML export is an interoperability bridge and migration aid, not a full-parity replacement for JasperReports. For the best experience, plan to move report authoring to the Open Reports JSON format as soon as practical; it preserves the full designer, rendering, and editing experience. Keep JRXML export for interoperability and migration during the transition. The exporter supports common page setups, text and safe expressions, row variables, report groups and group bands, images (including embedded base64 logos), bundled subreports, QR/barcodes, charts, and native table components. The ZIP includes parent/child JRXML files, a Maven `pom.xml`, setup instructions, and feature-specific compatibility notes. Compile with JasperReports 6.20.5, supply matching data sources and runtime resources, then compare representative PDF/print output before use. External images must be reachable by the Jasper host; custom fonts must be installed or supplied through a Jasper font extension. JasperReports may paginate, style, or render expressions differently. Every export displays its compatibility notes before download.

**Starting from Word:** choose **Import Word document** on Home or in **More report actions**. Select a `.docx` file and review the conversion notes before opening the draft. Text, headings, embedded images, static tables, page size, and standard/first/even headers and footers become editable report content. Imported table rows are sample data; connect them to your real dataset before publishing. Word's exact spacing, columns, fields, and floating objects need review in Preview. The file is read in your browser and is not uploaded during import.

## 2. The workspace
| Area | What it does |
|---|---|
| Top modes | **Design · Data · Code · Preview**. **More report actions → Split design and code** opens both editors side by side. |
| Ribbon | Under the title bar in Design mode. **Home** formats the selection: clipboard, font, size, bold/italic/underline, colours, text alignment, borders (all, none or single sides, with width, style and colour), fill, text styles, and copy, paste or clear formatting. **Insert** adds components and report sections and opens the dataset and grouping dialogs. **Arrange** aligns, spaces, orders, groups, locks and hides elements. **View** toggles canvas aids, snapping, zoom and panels. **Collapse ribbon** (˄) leaves only the tabs; the choice is remembered. |
| Left | **Structure** (bands, layers, lock 🔒, hide 👁) · **Data** (searchable fields and samples) · **Components** (incl. *My Components* and *Plugins*) · **Pages** (thumbnails) |
| Canvas | The toolbar above the page switches Structure/Pages, shows pagination, and controls zoom. The page supports smart guides with distances in mm, 8 resize handles, marquee select, hold Alt/Option to move without snapping, Shift+Alt/Option-drag to duplicate, double-click to edit text, floating format bar, and right-click menu. **Canvas settings** includes zoom to selection. |
| Right | Properties for the selection — content, typography, layout (margin, padding, gap, grow, min/max), page-break rules, Advanced (visibility conditions) |
| Bottom | **Problems** (with one-click *Fix*) · **Pagination** (why content moved to the next page) · **History** (labelled steps, restore) |
| **More report actions → Canvas view options** | Grid, rulers, smart guides, margins & safe area, boundaries, diagnostics, "design with first N rows", Focus Canvas |
| **More report actions → Output target** | Choose PDF / HTML / Excel / CSV / ZPL / ESC/POS — the designer warns about anything that format cannot express |

A blank report opens **Components** so you can start adding content. A report with bands or elements opens **Structure**. Reports with many bands start with their band contents folded so the section outline stays readable; expand a band to inspect its elements. Selecting an element on the canvas opens its band in the tree. Folding the tree does not change the report or its output.

With nothing selected, the right inspector offers **Page** (size, margins, headers, footers, watermark), **Print** (printer and media settings), and **Details** (report identity and locale). Page opens first for documents; Print opens first for reports with a receipt, label, card, or wristband printer profile. Selecting a band or element replaces these with its own controls. You can switch inspector tabs with the arrow keys.

For a text element, **Content** changes the text, field binding, or formula; **Style** changes typography and appearance; **Layout** arranges and sizes it; **Rules** holds conditions, pagination, and advanced output choices. The width and height controls stay visible above those tabs. A selected band has **General**, **Layout**, and **Rules** views. A table keeps its dataset and **Edit table** action in Content; detailed column and cell work happens in Table Designer.

On a laptop, the properties panel starts closed and opens over the canvas when requested. Below 980 px the left workspace panel also starts closed; use the side arrows to open it and the close button in its header to return to the canvas. The canvas **Fit** control scales a full page into the available width.

Shortcuts: `Ctrl+K` command palette · `Ctrl+S` save · `Ctrl+Z/Y` undo/redo · `Ctrl+C/V/D` copy/paste/duplicate · `Ctrl+G` group · `Ctrl+Shift+G` ungroup · `Ctrl+L` lock · `Ctrl+Shift+H` hide · `F2` rename · arrows nudge (Shift = ×10).

For free-positioned elements inside the same absolute layout, select two or more and use the right panel to align or match widths and heights. With three or more, **Space horizontally/vertically** makes the gaps equal while keeping the outer elements in place. Match-size actions use the first selected element as the source. Flow content is arranged by its container, so coordinate actions are disabled for it. A selected element shows its X, Y, width, and height beside the canvas selection.

To arrange a band's contents, select its label in Structure and open **Size and layout**. Choose **Stack**, **Row**, **Grid**, or **Free**. **Hug content** makes the band grow with its contents; **Fixed** gives it an exact height. Gap and padding use points. In a Row, children fill the available width by default. Select a text child and choose **Width in row → Hug text** to size it to the longest line, or **Fixed width** and enter an exact width above. **Distribute** uses the remaining space after hugged and fixed children. Turn on **Wrap items onto another line** to let wide children form additional rows. Set a fixed or hugged child's **Shrink** above zero to let it give up width when crowded, down to its minimum width; text then reflows in the narrower box. Drag a child within a flow layout to reorder it.

If fixed widths and gaps push an item beyond its row, **Problems** names that item. An item beyond the printable page edge is an error and blocks PDF/HTML output until you narrow the widths or gaps, or set a child to fill the remaining space. A row overflow still inside the page is a warning because it may overlap nearby content.

If an auto-height row's text columns exceed a page, they continue side by side on later pages. Open **Pagination** and select a **row split** to see why the continuation page starts there. A fixed-height child that cannot fit remains an error; increase the available page space or change its layout.

For precise alignment, click the top ruler to place a vertical guide or the left ruler to place a horizontal guide. Open **Canvas settings → Guides** to add guides by keyboard, name them, enter exact positions, lock them against changes, or remove them. Positions use the selected ruler unit and zero point; switching to **Inside margins** changes the displayed origin without moving a guide. Guides are saved with the report and can also be dragged or double-clicked on the canvas.

While moving an element in a free-position layout, smart guides compare it with sibling edges and centres. Matching gaps between neighbours appear as blue paired measurements. Resizing from a handle snaps the active edge to nearby sibling edges, centres, page bounds, or saved guides, and shows the remaining gap. Grid snapping still applies on an axis without a nearby smart-guide match. Hold **Alt/Option** during the drag or resize to place freely; hold **Shift+Alt/Option** while dragging to make a copy.

**Grid and snapping.** In **Canvas settings**:
- Set **Grid spacing** in the current ruler unit (mm, cm, in, pt, px or printer dots) and choose **Subdivisions**. Major lines are drawn stronger than minor lines, and objects snap to the minor step (**Snaps every …** shows it). Grid lines start at the page edge, and moved or resized edges land exactly on them, whatever the page margins.
- **Snap to** turns each target on or off: grid, other objects, band and page edges, guides, equal spacing and text baselines.
- These settings are saved for you and are not stored in the report.

**Comparing versions visually.** **⋯ → Compare versions… → Visual** renders both versions to PDF with the current sample data and compares every page (up to 30) pixel by pixel.
- It lists the pages that changed, with the share of each page that changed, plus pages that were added or removed.
- Each changed page is shown before, after, and with the changes marked in red.
- Small anti-aliasing differences are ignored.

**Reusable blocks.** **My Components** in the Components panel holds blocks shared by every report on the server.
- **Saving:** **+ Save selection** saves the selected components. Saving under an existing name creates its next version, with an optional note about what changed.
- **Inserting:** choose **Insert as**:
  - **Linked** follows new versions automatically;
  - **Pinned** stays on the inserted version;
  - **Editable copy** is independent.
- **Managing a placed block:** select it to see its source, version and history. From there you can follow updates, pin it, update a pinned block to the newest version, or detach it to edit it in this report only.

**Nested lists.** A list inside each record (for example each order's `lines`) can be dragged from the data tree:
- **Into a row of its parent list** (for example inside a repeater over `orders`): it shows that record's own list.
- **Anywhere else:** the designer wraps it automatically in a repeater over the parent list, so one drag builds a master-detail layout. The drop dialog says which of the two will happen.
- **Column choices:** inside a nested table they offer the nested fields and the parent record's fields (**Parent › …**).

**Merging table cells.** In the Table Designer:
- **Columns** → open a column and turn on **Merge repeated values** to merge equal consecutive values automatically. This suits category columns such as region or department; long runs split across pages and repeat their value.
- **Rows & cells** → select two corner cells, choose **Keep this merge**, then **Merge cells**.
  - The default keeps the merge with its record, using the first column whose value is unique in the sample, so it follows that record when the data is sorted or filtered.
  - Choose **At row N** to fix it at a row position instead.
  - Selecting a merged cell shows how it is anchored. Automatic merges are shaded and change only through their column setting.

**Auto-layout handles.** When a row or a stacked container is selected:
- drag the pink bars between its items to change the gap;
- drag the inner edges to change that side's padding (hold **Shift** for every side).

The value is shown while dragging. Values snap to 0.5 pt (hold **Alt/Option** to place freely), and each drag is one undo step. Double-clicking the right handle of an item in a row makes text hug its content, and other items fill the remaining width.

**Long rows.** A row taller than a page continues on the next page. Text columns continue line by line, and stacked columns continue item by item without cutting an item.

**Panning.** Hold **Space** and drag, or drag with the middle mouse button, to pan the canvas. A pan never selects or moves anything. Space still types in text fields and activates focused buttons.

In **Canvas settings → Ruler zero**, choose **Selected band** in Structure view to measure vertically from that band's top. Choose **Selection bounds** to measure from the upper-left corner of the selected element(s) visible on the first page. Clearing the selection temporarily returns the ruler to the page edge; it does not move any report content or guides.

For several elements in one **Free position** layout, the inspector's **Arrange** controls align edges, centres, and equal spacing. **Text baseline** aligns the first visible line of selected text using the canvas font measurements. **Tidy up** groups selected elements by their current rows, then places each row from the left with an 8 pt gap. It is disabled when that arrangement would overlap another visible element in the same layout. Both actions change report coordinates and can be undone. Flow items, locked elements, and items in different parents cannot be arranged together.

## 3. Data
**Data mode** lists datasets: JSON, REST API, database (PostgreSQL/MySQL via server-side connections), or CSV upload. **Test request** shows a Table / Raw JSON / Schema view and hints (row counts, nested lists, dates). For API keys use `{{secrets.NAME}}`; the real value lives on the server as `REPORT_SECRET_NAME` and never enters the report. Add **parameters** (e.g. `invoiceId`) and use them as `{{params.invoiceId}}`.

When a source has no preview rows, open its dataset editor and add **Fields**. Enter paths such as `name`, `amount`, or `patient.name`, choose each type, and set **Data shape** to a list or single object. Save the dataset; the fields appear in the Data rail and can be bound immediately. If a preview is available, **Use fields from preview** copies its inferred fields into the report definition. Declared fields describe the data shape; they do not create sample records.

Run **Preview** or **Test request** to compare declared fields with returned values. The result shows missing fields, mismatched types, and example row locations. A zero-row result keeps declared fields visible but cannot check their values. The check samples up to 20 records and a bounded number of nested values; **Problems** links any saved mismatch back to its dataset. It is an authoring warning, not a runtime rejection of source data.

Open **Data → Test data** to run disposable 0, 1, 10, 31, 32, 100, or 1,000 record scenarios against an array. You can add long text, nulls, negative values, multilingual text, and many groups. The lab compares its page count with the generated PDF. For a visible, unfiltered table with a simple text column, it also adds temporary row IDs to the test data and checks that each ID appears in the PDF text; the result shows `Rows found/marked`. It checks short Latin text elements against their expected PDF pages. For placed images, it compares PDF raster draw counts and, when source and PDF pixels can be decoded, matches each image to a PDF image on the same page. If content is absent or changed, expand the result to see its record or page and choose **Show table** or **Show component** to inspect it in Design. It leaves the report and saved sample intact. Large or unsupported images may only receive the count check; image matching samples visible pixels and does not prove print color fidelity. These checks do not verify formatting, barcodes, complex scripts, long text, or rows deliberately hidden by report rules, so inspect the output before publishing.

For a grouped list such as `clinical.investigations`, create the group from that list, then drag the list into an otherwise empty Detail band and choose **Table**. The table prints once for each group using only that group's records. Add a field such as `row.department` to the Group Header, then select the table and choose **Edit table** (or double-click it) to remove a redundant Department column. Table Designer contains columns, multi-level headers, merged cells, groups, totals, pagination, conditions, and the no-data behavior; the normal inspector stays focused on the dataset and overall layout.

**Variables** (Data mode, below parameters): a *row* variable is evaluated for every record and can accumulate, for example `(vars.balance ?? 0) + row.amount` for a running balance. When the report has groups, **Reset on** restarts it for each group. Set the report's **Time zone** under Report settings → Details → Locale & theme so printed dates and times match your users, whatever the server's own time zone.

A **Repeater** prints its content once per record. In its Layout tab, **Items** chooses Stacked, Side by side, or Grid (with **Per row**), which suits cards, badges and photo sheets.

In an element's Style tab, **Vertical** places text at the top, middle or bottom of a taller box, and **Corner radius** (shown once a background or border is set) rounds the box.

The selected element or band's **⋯** menu contains its code, lock, duplicate, and delete actions, as applicable.

For a custom hospital header, add Image components to the Page Header. **Embed image from file** stores a copy in the report. Alternatively, enter an **Image path or URL** to read the current logo on each render without editing the report; the rendering server must be able to access that path or URL. The repository's `apps/designer/tests/fixtures/letterheads/` folder includes separately cropped left brand artwork, left symbols, and right accreditation marks from the four supplied samples. Place editable Text components between the images, then preview the PDF to check spacing and legibility.

## 4. Pagination for long documents
- Tables: **Repeat header on every page**. **Min rows before break** moves a table to the next page when too few rows fit below preceding content. **Min rows after break** can pull trailing rows onto the final page so it does not start with a lone row. The Pagination panel shows the measured space and offers a smaller minimum when that would keep a row on the current page. In Table Designer → **Totals**, **Keep totals with a data row** moves trailing rows with the totals when they fit on a fresh page. Turn it off to allow totals on their own page. If a row and totals cannot fit together on any page, the debugger explains that limit. Rows currently remain whole at page breaks.
- Long cells: in **Edit table → Pagination**, tick **Allow rows to break across pages** so a row with long notes continues its remaining lines on the next page under the repeated header. Without it a row always moves whole.
- Signatures and totals: tick **Print at bottom** on a band to anchor it just above the page footer. Content after it starts a new page.
- Headings: **Keep with next**. Blocks that must not split: **Keep together** (Page breaks section).
- Auto-height text in a flow band continues on later pages with the page header/footer repeated. Set **Minimum lines at bottom/top** to avoid a single stranded line. A fixed-height text box that cannot fit its content appears as an error in **Problems** and blocks rendering. Increase or remove its height, or set **Advanced → Overflow** to **Clip at box edge** or **Single line with ellipsis** if shortening is deliberate. The latter choices appear as warnings. A fixed-height container with children extending beyond its box also blocks rendering; increase its height or let it size to content.
- **Pages → Edit page masters** opens **Headers & footers**. Choose **First**, **Normal**, **Last**, **Odd**, or **Even**, then add or edit its Header, Footer, or Background. **Copy normal** starts an independent variant with the normal band's contents, size, and appearance; **Blank here** suppresses the normal band on that variant. Remove an override to use Normal again. The page outline shows which slots are custom, blank, or inherited. Edit the band and its elements in the Structure tree, then preview the PDF to check the actual page sequence. A one-page report uses First before Last; Last takes priority over Odd and Even.
- Open **Pagination** at the bottom to see one entry for each actual page start. Expand an entry to see the previous page's measured body space, the first item on the new page, the recorded rules, and any applicable fix. **Page N starts · Why?** on the page canvas opens the same explanation. The online designer labels PDF-measured pagination; when server analysis is unavailable it labels the local estimate.

## 5. Printing and labels
- **Report settings → Print**: choose a preset (80/58 mm receipt, 50×30 or 100×50 mm label, wristband…). Small media fit the canvas when selected. Save the current media and output settings as a named printer profile to reuse them in another report. Selecting a saved profile copies those settings into the current report; later edits to the saved profile do not change existing reports. The panel shows physical size and dot count at the printer's DPI, and the safe area is drawn on the canvas. In **Canvas settings**, choose **Printer dots** to read the ruler at that DPI; **Ruler zero → Inside margins** measures from the printable page margin. Set the correct DPI before positioning elements by dots.
- **Rolls and wristbands**: the *Continuous label roll* presets make the page grow with its content. Tick **Continuous** on any report to do the same, and set **Minimum length** and **Maximum length** to bound it. The *Wristband … printed rotated* preset designs the band left-to-right and sets **Print rotation** to 90°, so PDF and ZPL output come out in the printer's feed direction. Pick another rotation, or 0° to print as designed.
- QR/barcodes are checked for scannable size; **Fix** enlarges them.
- **Preview → ZPL** shows the label program and warnings (for example non-Latin text needs a PDF/image label, since Zebra's built-in fonts are Latin). **Download .zpl** to send to a printer.
- For a ZPL printer whose physical output is slightly offset or scaled, open **Report settings → Print → Calibrate ZPL printer**. Download its raw test label, print it at the matching DPI, measure the outer edges of the box, and enter the measured width (and optionally height). Apply the correction to the current report; save the settings as a named printer profile to reuse them. The media size and PDF remain nominal. Recheck the printed result on the real printer before using labels for patients or specimens.
- For thermal bills, start with a 58 mm or 80 mm receipt or choose a receipt preset. The **Structure** canvas edits the bill; **Roll** in Design mode shows the generated ESC/POS output as one continuous strip through its final cut. Receipt starters select ESC/POS automatically. The roll reports printer columns, line count, cut count, and renderer warning count. **Preview → ESC/POS** offers the same output, and **Download .bin** saves those exact bytes. Page height still controls PDF output, but does not limit ESC/POS roll length. Check paper feed, character set, and cutting on the target printer before using it at a checkout.
- **Sticker sheets**: insert **Label sheet**, pick a stock (e.g. A4 2×4), design **one** label inside it, fill from a dataset (one label per record) or repeat the same label. *Start at position* reuses a partly used sheet. Print at **Actual size**; use *Draw label outlines* on plain paper to check alignment.

## 5b. Watermarks, bookmarks, highlighting
**Page → Watermark** (DRAFT/CONFIDENTIAL…), element *Advanced → PDF bookmark*, **Table Designer → Conditions**, and **Table Designer → Rows & cells → When there is no data** (headers / message / hide).

For band visibility, element visibility, and conditional appearance, choose **Builder** for a simple field/operator/value rule or **Code** to type a JavaScript-style expression such as `row.quantity > 0 && row.status == "Ready"`. Both tabs edit the same report expression. Code offers field suggestions and syntax errors; it supports expressions and built-in functions, not arbitrary JavaScript statements. A condition too complex for the simple Builder stays editable in Code.

**Table conditions.** *Rows* rules colour a whole row or leave it out (*Leave the row out*); hidden rows also drop out of the totals. *Cells* rules work on one column at a time: pick the column, then colour its cells or set *Print instead* (for example "credit" for negative amounts). `value` is the cell's own value. *Hide column when* hides the whole column for a run, e.g. `!params.showCost`. Rules that the cards cannot show (several cases, computed values) appear as *Advanced rule*; edit them in Code. Older tables' row conditions are listed as rules and are converted when you change them.

## 6. Reuse
Select elements → right-click → **Save as reusable component**. They appear under *My Components* for every report on that server.

## 6b. Publishing
**Publish** checks the current draft and every available array with 0, 1, 31, 32, and 100 records, plus a long/null/multilingual stress scenario. It renders a PDF from the current sample for review. A report change after the checks makes the results stale, so run them again. Acknowledge the PDF and any warnings, add version notes, then publish. The notes appear in **Compare versions**. The server independently refuses to publish a saved version with critical validation errors, including direct API requests. For REST/SQL reports, load sample data before running publish checks; this review does not prove that future live data will have the same shape.

## 7. API
`POST /api/v1/render` `{ report | templateId, format, parameters, data }` returns the file. Long jobs: `POST /api/v1/render/jobs`. Full list at `/openapi.json`. Authenticate with `x-api-key` or `Authorization: Bearer`.
