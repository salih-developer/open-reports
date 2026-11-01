# Configuration

Everything is configured with environment variables (or a `.env` file with Docker Compose — start from [`.env.example`](../.env.example)). No config files, no admin UI to secure.

## Server

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `API_KEYS` | *(empty = **no auth**)* | Comma-separated keys. Clients send `x-api-key: <key>` or `Authorization: Bearer <key>`. `/health`, `/openapi.json` and `/api/v1/schema` stay public |
| `DB_PATH` | `./reporting.sqlite` (Docker: `/data/reporting.sqlite`; `pnpm start`: `./data/reporting.sqlite`) | SQLite file for templates, versions and reusable blocks. **Back this file up** |
| `DESIGNER_DIST` | *(unset)* | Directory of the built designer; when set it is served at `/` (set automatically by `pnpm start` and the Docker image) |
| `EXAMPLES_DIR` | *(unset)* | Directory of `*.report.json` files exposed at `/api/v1/examples` (used by the AI/MCP tools) |
| `REPORT_PLUGINS` | *(none)* | Comma-separated plugin modules to load at start: package names or `./relative/paths` |

Request bodies are limited to 10 MB. Dataset rows are capped per query and every dataset has a timeout.

## Data sources

### Databases — `REPORT_SQL_<NAME>`
```bash
REPORT_SQL_HMS=postgres://reporting_ro:p%40ssw0rd@db.internal:5432/hms
REPORT_SQL_ERP=mysql://reporting_ro:secret@erp.internal/erp?ssl=true
```
- Creates connection ids `hms` and `erp` (lower-case, `_` → `-`). Reports and the designer reference **only the id**.
- Schemes: `postgres://`, `postgresql://`, `mysql://`, `mariadb://`. URL-encode special characters in the password. `?ssl=true` enables TLS.
- Use a **read-only** database user limited to the tables reports need.
- Queries are always parameterised: `$1, $2` (PostgreSQL) or `?` (MySQL), with `params: ["{{params.id}}"]`.

### REST APIs — secrets and allowed hosts
| Variable | Meaning |
|---|---|
| `REPORT_SECRET_<NAME>` | A secret usable in dataset URLs, headers, query or body as `{{secrets.NAME}}`. The designer sees only the **names** |
| `REPORT_REST_ALLOWED_HOSTS` | Strict allow-list of hostnames REST datasets may call. **Unset:** any *public* host is allowed and private/loopback/link-local/cloud-metadata addresses are always blocked (SSRF protection). **Set:** *only* these hosts are allowed — and this is how you deliberately permit an internal API (e.g. `api.hospital.internal`) |
| `REPORT_REST_MAX_RESPONSE_BYTES` | Largest REST response body one dataset may read, in bytes. **Default:** 10 MB (`10485760`). Raise it for APIs that return large result sets (e.g. `52428800` for 50 MB); the whole body is held in memory while a report renders. Anything other than a positive whole number stops the server at start-up |

Example dataset header: `{ "Authorization": "Bearer {{secrets.BILLING_TOKEN}}" }` with `REPORT_SECRET_BILLING_TOKEN=…` on the server.

### JSON files — `JSON_DATA_ROOT`
Disabled by default. Set it to a directory to allow `json` datasets with `filePath` relative to it; paths (including via symlinks) cannot escape the directory.

### Inline and CSV
Always available; the data lives in the report (CSV uploads are converted to inline data).

## Rendering inputs
- `parameters` — typed report parameters (`params.x`), also available as `{{params.x}}` in REST/SQL.
- `data` — replaces the dataset with the same id for one render (or adds a new inline dataset). One template, any record.

## Fonts
PDF layout is measured with real font metrics, so the server needs the same fonts everywhere. The Docker image installs **Noto** (`fonts-noto-core`): Latin, Devanagari, Telugu, Kannada, Tamil, Arabic. On a bare machine install it yourself (`pnpm doctor` checks). `GET /api/v1/capabilities` lists what the server found; the designer warns if a report needs a script the server lacks.

## Plugins
`REPORT_PLUGINS="@reporting/plugin-clinic-pack,./plugins/acme.mjs"`. Status at `GET /api/v1/plugins`. See [Plugin development](PLUGIN_DEVELOPMENT.md).

## Designer
Served by the API in production. In development (`pnpm dev`) it proxies `/api` to `API_URL` (default `http://localhost:4000`). **Settings (⚙ in the designer)** hold the API base URL and key if the designer is hosted on a different origin.
AI keys are entered in the designer's *AI settings* and stay in the browser — see [AI & MCP](AI_AND_MCP.md).

## MCP server
`REPORTS_API_URL`, `REPORTS_API_KEY`; flag `--read-only`. See [AI & MCP](AI_AND_MCP.md).
