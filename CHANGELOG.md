# Changelog

All notable changes. Format based on [Keep a Changelog](https://keepachangelog.com); versions follow semver once 1.0 is reached (0.x may change between minors; report-definition changes bump `schemaVersion` with a migration).

## [Unreleased]
### Designer
- Ribbon under the title bar in Design mode: Home (clipboard, font, paragraph, borders and fill, text styles, copy/paste/clear formatting), Insert (components, report sections, datasets, grouping), Arrange (align, space, order, group, lock, hide) and View (canvas aids, snapping, zoom, panels). It can be collapsed to its tabs.
- Application chrome: a coloured title bar and ribbon tab strip in light and dark mode, with tighter corner radii across the interface.
- Opening a saved template loads a live sample (up to 500 rows) for each REST or SQL dataset that has none, so the canvas and Preview show real data straight away. A dataset that fails reports its error; the Data tab can still replace or clear the sample.
- Import FastReport: `.frx` designs become drafts (`@reporting/frx-import`). Bands, groups, totals, formats, highlights, lines, barcodes and matrices convert. Scripts never run; what they did is listed for review. See [FastReport migration](docs/FASTREPORT_MIGRATION.md).
### Engine
- Page totals: page headers, footers and backgrounds read `page.rows` (the records printed on the page), `page.start.<variable>` (carried forward from earlier pages, *devreden*) and `page.end.<variable>` (carried to the next page, *nakli yekûn*). `scope: "page"` variables are now computed per page instead of warning `PAGE_VARIABLES_REQUIRE_LAYOUT`.
### Server
- `REPORT_REST_MAX_RESPONSE_BYTES` sets the REST dataset response cap (default stays 10 MB). An invalid value stops start-up.
### Schema
- `migration.sourceFormat` accepts `"frx"` and `migration.format` accepts `"fastreport"`.
### Fixed
- `pnpm dev` and the MCP bundle build now work on Windows.
- FastReport import: single-line ellipsis texts in short boxes (8 pt text in a 9.92 pt row) no longer fail the PDF render with `TEXT_EXCEEDS_HEIGHT`; their line height fits the box.

## [0.2.0] — 2026-10-04
### Designer
- Banded structure view with nested groups, rulers, named guides, baseline and equal-spacing snapping, Space-drag panning, adjustable major/minor grid.
- Contextual inspectors, searchable structure explorer, drag handles for gap and padding, page masters (first/last/odd/even header, footer, background).
- Table Designer: multi-level headers, body merges (positional, data-anchored, repeated values), table styles, row and column rules with a live sample.
- Themes: colour, font, size and spacing tokens, named text styles and table styles.
- Real PDF preview (PDF.js) with search and selectable text; rendered visual comparison between versions.
- Versioned library blocks (linked, pinned or detached), data contracts checked against the full response, nested lists for master-detail reports.
- Import JasperReports `.jrxml` files or whole folders as editable drafts, with a review list of anything that needs attention.
- Design-system pass: every colour and size is a token, WCAG AA contrast in light and dark mode, screenshot tests.
### Engine and outputs
- Universal conditional rules for components, bands, table rows and table columns.
- Continuous media (rolls sized to their content) and print rotation for PDF and ZPL; ZPL printer calibration; printer profiles.
- Report time zone, vertical text alignment, rounded corners, print-at-bottom bands, running totals that reset per group, repeater row and grid layouts, table rows that can break across pages, tall side-by-side rows that split cleanly.
### AI
- Band-aware AI tools: `@band` patch references, `describe_report`, band change summaries; the designer AI can work on a selected band.
### Security
- REST datasets and image URLs re-check every redirect and pin the resolved address; linked image files are confined to configured folders; SQL datasets run read-only, bounded and cancellable.
### Fixed
- Date formats containing a colon (for example `HH:mm`) were cut short.
- Row variables did not accumulate in band-based detail sections.
- The CI workflow was invalid YAML and had not been running; it now runs on every push and pull request, and `scripts/ci-linux.sh` reproduces it locally.
### Changed
- Tables author `rowRules`; `rowStyleWhen` still works and the designer converts it on first edit.

## [0.1.0] — first public release
### Engine
- Report definition schema (+ JSON Schema), sandboxed expression language, parameters, datasets (inline, JSON, REST, SQL, CSV via inline), variables, fragments.
- Pagination: repeating headers/footers, page X of Y, table splitting, orphan/widow, keep-together / keep-with-next, forced breaks, first/last/odd/even page layouts, decision log.
- Layout: flow, row, grid, absolute; margins/padding/gap/grow/min-max; label sheets (N-up stickers).
### Outputs
- PDF (multi-script Noto fonts, charts, barcodes/QR, bookmarks, watermarks), HTML, XLSX (streaming), CSV, ZPL, ESC/POS; plugin formats.
### Server
- REST API, versioned templates (published = immutable), async jobs, reusable blocks, analyze/validate, OpenAPI, API-key auth, SQL connections from env, REST allow-list and secrets.
### Designer
- Design / Data / Code / Preview, layers, smart guides, page layouts, print profiles + ZPL preview, label sheets, 23 starter templates, CodeMirror editor, version compare, problems with one-click fixes, pagination explainer, BYOK AI bar with diff review.
### AI
- MCP server (tools, resources, prompt, read-only mode) and shared tool catalogue; id-addressed JSON Patch.
### Extensibility
- Plugin SDK: renderers, datasources, expression functions, components, storage.
### Ops
- Dockerfile + compose, GitHub Actions CI (PostgreSQL/MySQL services), benchmarks, visual regression, security suite.
### Known gaps
- No typed SDK/CLI, PDF/A, signatures, footnotes/TOC, EPL, subreport execution, live co-editing.
