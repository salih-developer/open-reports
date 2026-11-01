// Started by the ASP.NET Core host (apps/host) through SpaProxy, from Visual Studio or `dotnet run`:
// runs scripts/dev.mjs (API :4000 + designer :3000) with the repository's .env and Node 22.
// The API needs Node 22 (better-sqlite3). If the default `node` is another version, set OPEN_REPORTS_NODE
// (in .env or the environment) to a Node 22 executable.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const node = process.env.OPEN_REPORTS_NODE || process.execPath;
if (!process.env.OPEN_REPORTS_NODE && process.versions.node.split(".")[0] !== "22") {
  console.warn(`[dev-spa-proxy] Node ${process.versions.node} is running, but the API needs Node 22. Set OPEN_REPORTS_NODE in .env to a Node 22 executable.`);
}

// dev.mjs points the designer at http://localhost:4000, so the API must listen there whatever PORT the host passes on.
const child = spawn(node, [resolve(root, "scripts/dev.mjs")], { stdio: "inherit", cwd: root, env: { ...process.env, PORT: "4000" } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
