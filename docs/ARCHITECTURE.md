# Architecture

## The one rule
A **Report Definition** (JSON, validated by `@reporting/schema`) is the only model. The designer, code editor, API, plugins and (future) AI tools all read and write it. Nothing else holds state about a report.

## Pipeline
```
 definition ─▶ validate ─▶ parameters ─▶ datasets (parallel, timeout, row cap)
            ─▶ expressions + variables ─▶ Resolved Report Tree ─▶ paginate(layout) ─▶ renderer
```
1. **Validate** (`@reporting/core` validator): schema errors, unknown datasets/fields (with "did you mean"), expression syntax, circular fragments.
2. **Parameters / datasets**: typed parameters; datasets run in parallel through registered data sources (`inline`, `json`, `rest`, `sql`, `plugin:*`).
3. **Resolve** (`resolve-component.ts`): evaluates bindings and expressions, applies conditional styles, empty states, fragments, label sheets and plugin components. Output is a plain tree of *resolved* components — text already computed.
4. **Paginate** (`@reporting/layout`): box layout (flow, row, grid, absolute; margins, padding, gap, grow, min/max) and page breaking. Produces `PaginatedReport`: pages, header/body/footer zones, which page master was used, and a **decision log** explaining each break.
5. **Render**: every renderer consumes only the resolved tree (and the paginated pages for paged formats). Renderers never run SQL, call APIs or evaluate formulas.

## Why pagination is its own engine
Typography decides page breaks, so the online designer uses the PDF renderer's font metrics (`createPdfMeasurer`, Noto fonts, per-script runs). The paginator records auto-height flow text as page fragments of one source component; PDF, HTML and the canvas draw only each page's fragment. Table rows and text lines have separate orphan/widow controls. HTML and the offline designer still paginate with a heuristic measurer, so their page counts can differ from PDF. Other behaviours include repeated table headers, `keepTogether`, `keepWithNext`, forced breaks, and page masters (`appliesTo`: first / last / odd / even / standard). The last-page master changes available height, so the page count is resolved to a fixed point. Each detail band and table row carries the record it printed (under a symbol key, so it stays out of JSON); after pagination the paginator collects the records of each page and hands page headers and footers `page.rows`, `page.start` and `page.end`, which is how carried-forward totals work.

## Packages
```
schema ─ expressions ─ core ─ layout ─ renderer-pdf / html / xlsx / csv / zpl
                         └─ datasource-json / rest / sql
plugin-sdk ─ plugin-clinic-pack            apps/server (Fastify, SQLite)     apps/designer (React, Vite, zustand)
```
Dependencies point downward only: `core` knows nothing about renderers or concrete data sources; renderers know nothing about each other.

## Server
Fastify 5 + better-sqlite3 (swappable via a storage plugin). Templates have **versions**: a draft can change, a **published** version is immutable. Rendering supports inline definitions, stored templates and async jobs. A `RenderRuntime` (renderers, data sources, plugin functions and components) is built once per server from the plugin registry.

## Designer
The designer runs `core` and `layout` **in the browser** against sample data for immediate feedback, then replaces its paginated page tree with `/api/v1/analyze` output measured by the PDF renderer when the server responds. The browser loads the server's installed font faces and uses the returned text line advance; it labels the local estimate when analysis is unavailable. The Preview tab uses the server's PDF renderer for exact output. Edits are pure functions over the JSON (`model/ops.ts`); undo/redo and the labelled history are snapshots of the JSON. The code editor and the canvas stay in sync through the same store.

**Design system.** `apps/designer/src/design-tokens.css` holds every colour, the type scale (`--text-2xs` … `--text-3xl`), radii and spacing, with a dark-mode override for each themed surface. `styles.css` uses only tokens. Groups: surfaces and text (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--on-accent`); status tones (`--ok|warn|danger-soft` with matching `-text`); `--paper*` for the printed page, which stays white in dark mode; `--chrome*` for the title bar and ribbon tab strip; and `--overlay-*` for guides, page breaks and handle labels drawn over the page. `tests/unit/design-tokens.test.ts` fails on a raw hex colour in `styles.css`, an undefined `var(--…)`, a themed token without a dark value, and text/surface pairs below WCAG AA (4.5:1) in either mode.

## Extension points
Plugins (`@reporting/plugin-sdk`) can add: output formats, data sources, expression functions, `custom` components that expand into ordinary components (so all renderers support them), and a storage backend. See [PLUGIN_DEVELOPMENT.md](PLUGIN_DEVELOPMENT.md).

## Determinism and testing strategy
- Layout/pagination: unit tests plus a real-PDF boundary suite.
- Output stability: rasterised visual baselines.
- Designer UI: screenshot tests tagged `@visual` (`apps/designer/tests/e2e/visual.spec.ts`) for the start screen, workspace, inspector, Table Designer, data workspace and theme dialog, in light and dark mode. CI runs them inside the official Playwright image. After an intended UI change, regenerate the Linux baselines with `scripts/update-visual-baselines.sh` (Docker) and the local ones with `playwright test --grep @visual --update-snapshots`. Review the new images before committing.
- Safety: sandbox, SSRF, injection, traversal tests.
- Performance: repeatable benchmark script, run in CI as a smoke test.
