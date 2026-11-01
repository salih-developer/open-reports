// Development: API on :4000 (rebuild packages yourself) + designer with hot reload on :3000.   pnpm dev
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "data"), { recursive: true });
const env = { EXAMPLES_DIR: resolve(root, "examples"), DB_PATH: resolve(root, "data/reporting.sqlite"), API_URL: "http://localhost:4000", ...process.env };
const run = (cmd, args, cwd) => spawn(cmd, args, { stdio: "inherit", env, cwd: resolve(root, cwd) });
// Vite runs through node directly: spawning "pnpm" without a shell fails on Windows (pnpm.cmd).
const procs = [run(process.execPath, ["dist/index.js"], "apps/server"), run(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0", "--port", "3000"], "apps/designer")];
console.log("\nDesigner: http://localhost:3000   API: http://localhost:4000\n");
for (const p of procs) p.on("exit", () => procs.forEach((q) => q.kill()));
process.on("SIGINT", () => procs.forEach((q) => q.kill()));
