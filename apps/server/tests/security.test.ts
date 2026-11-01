import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { restMaxResponseBytes } from "../src/datasources.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let designerDir: string;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  designerDir = path.join(dir, "dist");
  fs.mkdirSync(designerDir);
  fs.writeFileSync(path.join(designerDir, "index.html"), "<html>designer</html>");
  fs.writeFileSync(path.join(dir, "secret.txt"), "TOP SECRET");
  ({ app } = buildApp({ dbPath: path.join(dir, "db.sqlite"), apiKeys: ["k1"], designerDist: designerDir }));
  await app.ready();
});
afterAll(() => app.close());

const auth = { "x-api-key": "k1" };
const base = (children: unknown[], data: unknown = { name: "x" }) => ({
  schemaVersion: "1.0",
  id: "sec",
  name: "sec",
  datasets: [{ id: "d", source: "inline", query: { data } }],
  sections: [{ type: "detail", children }],
});
const render = (report: unknown, format: string) => app.inject({ method: "POST", url: "/api/v1/render", headers: auth, payload: { report, format } });

describe("authentication", () => {
  it("rejects API calls without a key and with a wrong key; health and schema stay public", async () => {
    expect((await app.inject({ url: "/api/v1/templates" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/templates", headers: { "x-api-key": "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/templates", headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/schema" })).statusCode).toBe(200);
  });
});

describe("expression sandbox", () => {
  it("cannot reach prototypes, constructors or globals", async () => {
    for (const expr of ['data.d.constructor', 'data.d.__proto__', 'data.d.constructor.constructor("return process")()', "process.env", 'this.constructor', "globalThis", "require('fs')", '[].constructor']) {
      const res = await render(base([{ type: "text", expression: expr }]), "html");
      if (res.statusCode === 200) expect(res.payload, expr).not.toMatch(/\[object|function Object|SECRET/i);
    }
  });

  it("no assignment, no statements, no calling arbitrary functions", async () => {
    for (const expr of ['data.d.name = "hacked"', "1; 2", "(() => 1)()", "eval('1')", "fetch('http://x')", 'constructor("x")']) {
      const res = await render(base([{ type: "text", expression: expr }]), "html");
      expect(res.statusCode, expr).toBeGreaterThanOrEqual(400);
    }
  });

  it("runaway expressions are bounded (deep nesting)", async () => {
    const deep = "(".repeat(5000) + "1" + ")".repeat(5000);
    const res = await render(base([{ type: "text", expression: deep }]), "html");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("output injection", () => {
  it("HTML output escapes data (no script injection)", async () => {
    const res = await render(base([{ type: "text", binding: "data.d.name" }], { name: '<script>alert(1)</script><img src=x onerror=alert(2)>' }), "html");
    expect(res.payload).not.toContain("<script>alert(1)");
    expect(res.payload).not.toMatch(/<img src=x onerror/);
    expect(res.payload).toContain("&lt;script&gt;");
  });

  it("HTML output escapes column headers and attribute values", async () => {
    const report = base([{ type: "table", dataset: "d", columns: [{ id: "a", header: '"><script>x()</script>', binding: "row.a" }] }], [{ a: '" onmouseover="x()' }]);
    const res = await render(report, "html");
    expect(res.payload).not.toContain("<script>x()");
    expect(res.payload).not.toMatch(/onmouseover="x\(\)"/);
  });

  it("CSV neutralises spreadsheet formula injection", async () => {
    const report = base([{ type: "table", dataset: "d", columns: [{ id: "a", header: "A", binding: "row.a" }] }], [{ a: "=HYPERLINK(\"http://evil\",\"x\")" }, { a: "+1+1" }, { a: "@SUM(A1)" }, { a: "-2+3" }]);
    const res = await render(report, "csv");
    const lines = res.payload.trim().split("\n").slice(1);
    for (const l of lines) expect(l.replace(/^"/, "")).toMatch(/^'[=+@-]/);
  });

  it("ZPL output cannot be hijacked by ^ or ~ commands in data", async () => {
    const res = await render(base([{ type: "text", binding: "data.d.name" }], { name: "A^FS^XA^MMT~JA hacked" }), "zpl");
    const body = res.payload;
    const fieldData = body.split("\n").find((l) => l.includes("^FD")) ?? "";
    const inner = fieldData.split("^FD")[1]?.split("^FS")[0] ?? "";
    expect(inner).not.toMatch(/[\^~]/);
  });
});

describe("file and network access", () => {
  it("static serving cannot escape the designer directory", async () => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt"]) {
      const res = await app.inject({ url: p });
      expect(res.payload, p).not.toContain("TOP SECRET");
    }
  });

  it("json datasets cannot read local files through the API", async () => {
    const report = { ...base([{ type: "text", binding: "data.d.name" }]), datasets: [{ id: "d", source: "json", query: { path: "/etc/passwd" } }] };
    const res = await render(report, "html");
    expect(res.payload).not.toContain("root:");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("REST datasets block SSRF to metadata and loopback addresses", async () => {
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:4000/health", "http://localhost/", "http://[::1]/", "file:///etc/passwd", "http://10.0.0.1/"]) {
      const report = { ...base([{ type: "text", binding: "data.d.name" }]), datasets: [{ id: "d", source: "rest", query: { url } }] };
      const res = await render(report, "html");
      expect(res.statusCode, url).toBeGreaterThanOrEqual(400);
    }
  });

  it("template ids are validated, not used as paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/templates/..%2f..%2fetc%2fpasswd", headers: auth });
    expect([400, 404]).toContain(res.statusCode);
  });
});

describe("abuse limits", () => {
  it("malformed JSON and unknown formats return structured 4xx errors, never 500", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/v1/render", headers: { ...auth, "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
    const fmt = await render(base([]), "exe");
    expect(fmt.statusCode).toBe(400);
    const nul = await app.inject({ method: "POST", url: "/api/v1/render", headers: auth, payload: { report: null, format: "pdf" } });
    expect(nul.statusCode).toBe(400);
  });

  it("an enormous report body is rejected", async () => {
    const huge = base([{ type: "text", value: "x".repeat(12 * 1024 * 1024) }]);
    const res = await render(huge, "html");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("the REST response cap keeps its default and only accepts a positive whole number of bytes", () => {
    expect(restMaxResponseBytes({})).toBeUndefined();
    expect(restMaxResponseBytes({ REPORT_REST_MAX_RESPONSE_BYTES: " 52428800 " })).toBe(52428800);
    for (const bad of ["0", "-1", "50MB", "1e9", "1.5", "Infinity", "99999999999999999999"]) {
      expect(() => restMaxResponseBytes({ REPORT_REST_MAX_RESPONSE_BYTES: bad })).toThrow(/REPORT_REST_MAX_RESPONSE_BYTES/);
    }
  });

  it("prototype-pollution keys in report data do not poison later renders", async () => {
    await render(base([{ type: "text", value: "x" }], JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}')), "html");
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).polluted2).toBeUndefined();
  });
});
