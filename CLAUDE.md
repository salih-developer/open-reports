# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Open Reports: a JSON-native reporting engine (pnpm monorepo, TypeScript, ESM). A browser designer (`apps/designer`, React + Vite + zustand) edits report definitions; a Fastify + SQLite server (`apps/server`) renders them to PDF, HTML, DOCX, XLSX, CSV, ZPL and ESC/POS. Engine pieces live in `packages/*` as `@reporting/<name>`. The default branch is `claude/upbeat-volta-pe84n7` (CI also runs on `main` and `claude/**`).

## Environment

- **Node 22 is required.** Node 24 breaks `better-sqlite3` (`NODE_MODULE_VERSION`). If the default Node is newer, prefix commands with `fnm exec --using=22`.
- pnpm 10 via corepack. `fontkit` is patched (`patches/fontkit@1.9.0.patch`).
- Pagination depends on real glyph metrics: CI and Docker install `fonts-noto-core`; PDF tests use `poppler-utils`. Missing fonts change line/page breaks and fail tests.
- SQL datasource tests need local PostgreSQL (db `reporting_test`, user `postgres`) and MySQL/MariaDB (db `reporting_test`, user `reporting`).

## Commands

**Packages are consumed from `dist/`** (each package's `exports` points at `dist`). After editing anything in `packages/`, rebuild it (`pnpm --filter @reporting/<name> build`) before dependents, the server, or the designer see the change.

```bash
pnpm install
pnpm -r --filter "./packages/**" build && pnpm --filter @reporting/server build   # what CI builds
pnpm build:all              # packages + server + designer
pnpm dev                    # API :4000 (from server dist, no watch) + designer :3000 with HMR
pnpm start                  # production build on :4000
pnpm doctor                 # environment check
```

`pnpm dev` passes the shell env to the API, so a stray `PORT` moves it; use `PORT=4000 pnpm dev` (`.claude/launch.json` already does).

Tests (vitest everywhere; designer e2e is Playwright):

| What | Command |
|---|---|
| One package | `pnpm --filter @reporting/core test` |
| One test file / name | `pnpm --filter @reporting/core exec vitest run tests/foo.test.ts -t "name"` |
| All packages | `pnpm test` |
| Everything (packages + apps, as CI) | `pnpm -r test` |
| Server (security, examples, visual, MCP…) | `pnpm --filter @reporting/server test` |
| Designer unit (`tests/unit/**`) | `pnpm --filter @reporting/designer test` |
| Designer e2e, one file | `pnpm --filter @reporting/designer exec playwright test tests/e2e/embed.spec.ts` |
| Designer e2e, functional only | `pnpm --filter @reporting/designer exec playwright test --grep-invert @visual` |
| Typecheck | `pnpm typecheck`; designer: `pnpm --filter @reporting/designer exec tsc --noEmit` |
| Benchmark smoke | `pnpm --filter @reporting/server bench:quick` |

There is no linter configured in the packages; `pnpm lint` is effectively a no-op. Typecheck is the static check.

Playwright starts its own server from `apps/server/dist` on :4100 and Vite on :3100 (build server first; don't run two suites at once). It runs on one worker against shared SQLite; a full run is 5–15 min, so run single files.

Known pre-existing failures (check before assuming you broke something) are listed in `docs/design/competitive-features.md` under "Tests that fail for reasons outside these features" — notably ~30 designer e2e tests (mostly `bands.spec.ts`) and visual tests off Linux.

### CI gates beyond tests

- `pnpm check:schema-consumers` (needs packages built): every field in the zod schema must be read by some engine source (core, expressions, layout, renderers, datasources, server). Designer-only fields go in `DESIGN_ONLY` in `scripts/schema-consumers.mjs`. Adding a schema field without engine code that consumes it fails CI.
- `examples/*.report.json` are **generated** by `scripts/build-examples.mjs`; CI runs it and fails on `git diff`. Edit the script, then `pnpm examples` — never hand-edit the JSON. New starters also need registering in `apps/designer/src/lib/templates.ts`.
- Visual baselines: server PDF rasters refresh with `UPDATE_BASELINES=1 pnpm --filter @reporting/server test visual`; designer `@visual` screenshots are Linux-only, regenerate with `scripts/update-visual-baselines.sh` (Docker, Playwright image pinned in `ci.yml` — keep it in step with `@playwright/test`).

## Architecture

Read `docs/ARCHITECTURE.md` for the full picture. The essentials:

**The report definition JSON is the only model.** Designer, code editor, API, plugins and AI/MCP tools all read and write it; nothing keeps a second copy of report state. Schemas are versioned (`schemaVersion`, migrations in `packages/schema/src/migrate.ts`); breaking changes need a migration.

Pipeline (orchestrated in `packages/core/src/pipeline.ts`):

```
definition → validate → parameters → datasets (parallel, timeout, row cap)
          → expressions + variables → Resolved Report Tree → paginate (layout) → renderer
```

- `schema` — zod schemas + generated JSON Schema. `expressions` — the sandboxed expression language; **no `eval`/dynamic code anywhere**, all formulas go through it.
- `core` — validation, datasets via registered data sources, `resolve-component.ts` produces the Resolved Report Tree (all text already computed). Knows nothing about concrete renderers or datasources.
- `layout` — box layout + page breaking → `PaginatedReport` with a decision log explaining each break. Last-page masters change available height, so page count is solved to a fixed point.
- `renderer-*` — consume only the resolved tree (and paginated pages for paged formats). They never run queries or evaluate expressions, and don't depend on each other (except `renderer-pdf` → `renderer-html`).
- `datasource-json|rest|sql` — data sources; REST has SSRF protections, SQL connections come from `REPORT_SQL_<NAME>` env vars, secrets via `{{secrets.NAME}}`.
- `plugin-sdk` — plugins add formats, data sources, functions, `custom` components (expand into ordinary components so every renderer supports them), storage. `plugin-clinic-pack` is the sample.
- `ai-tools` / `mcp-server` — template-editing tools shared by the designer's AI panel and the MCP server (published to npm as `open-reports-mcp`; server copies it in via `scripts/copy-mcp.mjs` and serves `/mcp`). `jrxml-import` and `frx-import` (JasperReports / FastReport sources → draft definitions with a migration review list; scripts never run), `embed` (web components `<open-report-viewer>`/`<open-report-designer>`), `client` (unpublished TS helper).

Dependencies point downward only: `schema → expressions → core → layout → renderers`.

**Server** (`apps/server/src`): `app.ts` wires routes; `render-pipeline.ts` / `renderers.ts` build a `RenderRuntime` once from the plugin registry. Templates have versions — drafts are mutable, published versions immutable. Supports inline-definition renders, stored templates, and async jobs (`jobs.ts`). OpenAPI at `/openapi.json`.

**Designer** (`apps/designer/src`): runs `core` + `layout` in the browser against sample data for instant feedback, then swaps in `/api/v1/analyze` pagination measured with the server's PDF font metrics. Preview is the real server PDF. Edits are pure functions over the JSON in `model/ops.ts`; undo/redo are JSON snapshots; canvas and code editor share the zustand store (`store.ts`). Styling: every colour/size is a token in `design-tokens.css` (with dark-mode values); `styles.css` may only use tokens — `tests/unit/design-tokens.test.ts` fails on raw hex, undefined vars, missing dark values, or sub-WCAG-AA contrast.

## Contribution rules (from CONTRIBUTING.md)

- Determinism: same definition + data + fonts must give the same pages; anything affecting layout needs a test.
- Pagination changes need a case in `packages/renderer-pdf/tests/pagination-boundary.test.ts` or `packages/layout/tests`.
- Security-relevant changes (datasources, expressions, renderer escaping) need a case in `apps/server/tests/security.test.ts`.
- Feature-area guides (canvas, embedding, crosstabs, viewer, DOCX, charts, RDL import: where code lives, how to test, plans): `docs/design/competitive-features.md`.
