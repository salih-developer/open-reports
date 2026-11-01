// Bundles the MCP server and everything it needs into one file, dist/open-reports-mcp.mjs, which the
// Open Reports server offers for download (Settings → AI tools). Users need only Node.js 18+ to run it.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await build({
  entryPoints: [fileURLToPath(new URL("../src/cli.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/open-reports-mcp.mjs", import.meta.url)),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  minify: true,
  legalComments: "eof",
  // Some dependencies are CommonJS; give them a require() inside the ES module.
  banner: { js: `// Open Reports MCP server ${version} · MIT licensed · https://github.com/varaprasadreddy9676/open-reports\nimport { createRequire as __orCreateRequire } from "node:module"; const require = __orCreateRequire(import.meta.url);` },
  define: { "process.env.OPEN_REPORTS_MCP_VERSION": JSON.stringify(version) },
});
console.log("Bundled dist/open-reports-mcp.mjs");

// A manifest of the tools in this bundle, so the Open Reports server can describe them without importing
// the MCP packages (it serves the bundle as a plain file).
const { TOOLS } = await import("@reporting/ai-tools");
const { LOCAL_TOOLS } = await import("../dist/local-tools.js");
const describe = (local) => (tool) => ({ name: tool.name, description: tool.description, readOnly: tool.readOnly, destructive: Boolean(tool.destructive), local });
const { writeFile } = await import("node:fs/promises");
await writeFile(new URL("../dist/open-reports-mcp.tools.json", import.meta.url), `${JSON.stringify({ version, requires: "Node.js 18 or newer", tools: [...TOOLS.map(describe(false)), ...LOCAL_TOOLS.map(describe(true))] }, null, 2)}\n`);
console.log("Wrote dist/open-reports-mcp.tools.json");

// The npm package `open-reports-mcp`: the same single file with a bin entry and no dependencies.
// Publish with: npm publish packages/mcp-server/dist/npm --access public (see .github/workflows/release-mcp.yml).
const { mkdir, copyFile } = await import("node:fs/promises");
const npmDir = new URL("../dist/npm/", import.meta.url);
await mkdir(npmDir, { recursive: true });
await copyFile(new URL("../dist/open-reports-mcp.mjs", import.meta.url), new URL("open-reports-mcp.mjs", npmDir));
await copyFile(new URL("../README.md", import.meta.url), new URL("README.md", npmDir));
await copyFile(new URL("../../../LICENSE", import.meta.url), new URL("LICENSE", npmDir));
const npmPackage = {
  name: "open-reports-mcp",
  version,
  description: "MCP server for Open Reports: lets Claude, Cursor and any MCP client design, check, render and save reports (PDF, Word, Excel, labels, receipts).",
  license: "MIT",
  type: "module",
  bin: { "open-reports-mcp": "open-reports-mcp.mjs" },
  files: ["open-reports-mcp.mjs", "README.md", "LICENSE"],
  engines: { node: ">=18.3" },
  keywords: ["mcp", "model-context-protocol", "claude", "cursor", "reports", "pdf", "report-designer", "jasperreports", "open-reports"],
  homepage: "https://github.com/varaprasadreddy9676/open-reports/blob/HEAD/docs/AI_AND_MCP.md",
  repository: { type: "git", url: "git+https://github.com/varaprasadreddy9676/open-reports.git", directory: "packages/mcp-server" },
  bugs: { url: "https://github.com/varaprasadreddy9676/open-reports/issues" },
};
await writeFile(new URL("package.json", npmDir), `${JSON.stringify(npmPackage, null, 2)}\n`);
console.log("Wrote the npm package to dist/npm");
