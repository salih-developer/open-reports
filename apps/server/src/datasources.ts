import { DataSourceRegistry, InlineDataSource } from "@reporting/core";
import { RestDataSource } from "@reporting/datasource-rest";
import { JsonDataSource } from "@reporting/datasource-json";
import { SqlConnectionRegistry, SqlDataSource, connectionsFromEnv } from "@reporting/datasource-sql";

/** Default registry for the dev server: inline data (always safe) and REST
 * (SSRF-guarded by default: public hosts only; REPORT_REST_ALLOWED_HOSTS switches to a strict allow-list, which is also the only way to reach internal hosts). SQL datasources need real credentials
 * configured by the host application, so they're intentionally not wired up
 * here -- see @reporting/datasource-sql and SqlConnectionRegistry for how a
 * production deployment would register one. */
export function createDefaultDataSourceRegistry(): DataSourceRegistry {
  const registry = new DataSourceRegistry();
  registry.register(new InlineDataSource());
  registry.register(new RestDataSource({ secrets: secretsFromEnv(), allowedHosts: restAllowedHosts(), maxResponseBytes: restMaxResponseBytes() }));
  // File-based JSON datasets are off unless the operator names a directory they may read from (JSON_DATA_ROOT).
  if (process.env.JSON_DATA_ROOT) registry.register(new JsonDataSource({ rootDir: process.env.JSON_DATA_ROOT }));
  // Databases: REPORT_SQL_<NAME>=postgres://user:pass@host/db  (or mysql://). Reports reference the connection id only, never credentials.
  const connections = connectionsFromEnv();
  if (Object.keys(connections).length) {
    const sql = new SqlConnectionRegistry();
    for (const [id, cfg] of Object.entries(connections)) sql.register(id, cfg);
    registry.register(new SqlDataSource(sql));
  }
  return registry;
}

export function sqlConnectionIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env).filter((k) => k.startsWith("REPORT_SQL_") && env[k]).map((k) => k.slice(11).toLowerCase().replace(/_/g, "-"));
}

/** Secrets are named `REPORT_SECRET_<NAME>` in the server environment and referenced from datasets as {{secrets.NAME}}. */
export function secretsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("REPORT_SECRET_") && v) out[k.slice("REPORT_SECRET_".length)] = v;
  }
  return out;
}

/** Strict mode: when set, ONLY these hostnames may be called (this is also how you deliberately allow an internal API). Unset = any public host. */
function restAllowedHosts(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const list = (env.REPORT_REST_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/** REPORT_REST_MAX_RESPONSE_BYTES sets the largest REST response body a dataset may read. Unset = the data source's 10 MB default.
 * A value that is not a positive whole number stops start-up rather than silently falling back. */
export function restMaxResponseBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.REPORT_REST_MAX_RESPONSE_BYTES?.trim();
  if (!raw) return undefined;
  const bytes = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`REPORT_REST_MAX_RESPONSE_BYTES must be a positive whole number of bytes (for example 52428800 for 50 MB); got "${raw}".`);
  }
  return bytes;
}
