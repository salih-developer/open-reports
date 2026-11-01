# Troubleshooting & FAQ

Run **`pnpm doctor`** first — it checks Node, pnpm, fonts, install and build state.

## Install / start
**`pnpm start` says "Not built yet".** Run `pnpm build:all` first (once, and after pulling updates).
**Node version errors.** Need Node 22+. `node -v`; install via nvm or nodejs.org. Then `corepack enable`.
**`better-sqlite3` fails to install/build.** Install build tools (`build-essential python3` on Debian/Ubuntu; Xcode CLT on macOS) and rerun `pnpm install`. Docker avoids this entirely.
**Port already in use.** `PORT=4100 pnpm start`, or stop whatever holds 4000/3000.
**Designer loads but "Cannot reach the server".** In `pnpm dev` the API must be running on `API_URL` (default :4000). Hosting the designer elsewhere? Set API base URL + key under ⚙ Settings.
**401 Unauthorized.** The server has `API_KEYS`. Send `x-api-key`, or enter the key in the designer's ⚙ Settings.

## Output problems
**Boxes/blank glyphs for Hindi/Telugu/Arabic, or ₹ looks wrong.** The Noto fonts are missing on the *server*. Install `fonts-noto-core` (Docker image has it). Check `GET /api/v1/capabilities` → `scriptFonts`; the designer's Problems panel also warns.
**Page breaks differ between my machine and the server.** Different fonts ⇒ different line breaks. Use the same font set everywhere (the Docker image); avoid fonts not installed on the server.
**Table header doesn't repeat / a single row sits alone on the last page.** Select the table → *Repeat header on every page* and *Min rows after break = 2*. Open **Pagination** (bottom bar) for the exact reason and one-click fixes.
**Content cut off or "wider than the page".** Problems → *Fit to printable width*; or reduce margins in *Page*.
**Text is bound but shows ⚠ or "Unknown field …".** The path doesn't exist in the dataset. The message suggests the nearest field; check *Data* mode (schema tree) and for nested lists use `row.field` inside tables/repeaters.
**Chart/image missing.** Remote images are not fetched (security); embed as data URI or a server-local path.
**Excel/CSV shows only a table.** By design: these formats export the report's table data. Use PDF/HTML for the full layout.

## Labels and printers
**Barcode won't scan.** Problems panel shows the minimum scannable size — click **Fix**. Keep quiet zones; print at the printer's native DPI; Code 128 needs ~0.25 mm modules at 203 dpi.
**ZPL prints `?` or nothing for non-English text.** Zebra built-in fonts are Latin only. Print those labels as PDF/image.
**Label is offset or scaled.** Match *Print & labels* (size/DPI) to the media and printer; in the OS print dialog choose *Actual size / 100 %*, never "fit to page". Use *Draw label outlines* on plain paper to calibrate sticker sheets.
**ESC/POS garbage characters.** Printer code page differs; the renderer targets WPC1252 and substitutes `₹`→`Rs.`. Non-Latin text isn't supported on ESC/POS — print PDF for those receipts.

## Data
**REST dataset blocked.** "private/internal address" ⇒ SSRF protection. Add the host to `REPORT_REST_ALLOWED_HOSTS` (that switches to strict allow-list mode: *only* listed hosts).
**Database connection not listed.** Set `REPORT_SQL_<NAME>=postgres://…` on the **server** and restart; the designer shows the ids.
**Unknown secret "X".** Set `REPORT_SECRET_X` on the server.
**"REST response exceeded the maximum allowed size".** The API returned more than `REPORT_REST_MAX_RESPONSE_BYTES` (10 MB by default). Filter the request with parameters, or raise the limit on the server and restart.
**Dataset timed out / too many rows.** Filter in SQL, add parameters, or use async jobs and CSV for very large exports.

## FAQ
**Is it really free?** MIT. No usage limits, seats or phone-home.
**How do I move templates between servers?** Export the definition (JSON) from the designer or `GET /api/v1/templates/:id/versions/:n`, store in git, `POST` to the other server.
**Can I edit the JSON by hand?** Yes — *Code* mode is schema-aware; designer and code stay in sync. The schema is at `/api/v1/schema`.
**Can several people edit one template?** Templates are versioned; the last save creates the next draft version. There is no live co-editing yet.
**Can it replace my report tool?** See [README → Is this right for you?](../README.md#-is-this-right-for-you).
**Which databases/formats are missing?** SQL Server/Oracle, PDF/A, signatures, EPL — see the roadmap; plugins can add data sources and formats.

## Still stuck?
Open an issue with: what you did, what you expected, the output of `pnpm doctor`, and (if possible) the report JSON (remove private data). Security problems: see [SECURITY.md](../SECURITY.md) — please don't file those publicly.
