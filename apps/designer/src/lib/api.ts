/** Thin client for the reporting server. Same-origin by default (Vite proxies /api to the server in dev). */
import type { PaginatedReport } from "@reporting/layout";
import type { PageConfig, PrintProfile } from "@reporting/schema";
import type { SubreportSource } from "@reporting/core";
import type { Doc } from "../model/ops";
import { subreportSources } from "./subreports";
import type { McpToolInfo } from "./mcp-config";
const KEY = "designer.apiKey";
const BASE = "designer.apiBase";
let embeddedConnection: { apiKey: string; apiBase: string } | undefined;

/** An embed must not inherit or persist another host application's connection. */
export function setEmbeddedConnection(apiKey = ""): void {
  embeddedConnection = { apiKey, apiBase: "" };
}

export function normalizeServerUrl(value: string): string {
  const base = value.trim().replace(/\/+$/, "");
  if (!base) return "";
  const parsed = new URL(base);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Invalid server URL");
  return base;
}

export const settings = {
  get apiKey() {
    if (embeddedConnection) return embeddedConnection.apiKey;
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  },
  set apiKey(v: string) {
    if (embeddedConnection) { embeddedConnection.apiKey = v; return; }
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
  },
  get apiBase() {
    if (embeddedConnection) return embeddedConnection.apiBase;
    try {
      return localStorage.getItem(BASE) ?? "";
    } catch {
      return "";
    }
  },
  set apiBase(v: string) {
    if (embeddedConnection) { embeddedConnection.apiBase = v; return; }
    try {
      localStorage.setItem(BASE, v);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (settings.apiKey) headers.set("x-api-key", settings.apiKey);
  let res: Response;
  try {
    res = await fetch(`${settings.apiBase}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Cannot reach the reporting server. Check your connection and server address, then try again.", 0, "NETWORK");
  }
  if (!res.ok) {
    let body: any = undefined;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code, body?.error?.details);
  }
  return res;
}

export interface TemplateRecord {
  id: string;
  name: string;
  description?: string;
  currentVersion: number;
  status: "draft" | "published" | "archived";
  updatedAt: string;
}

export interface VersionRecord {
  templateId: string;
  version: number;
  definition: any;
  status: "draft" | "published";
  createdAt: string;
  notes?: string;
}

export interface SavedPrinterProfile {
  id: string;
  name: string;
  print: PrintProfile;
  page: PageConfig;
  updatedAt: string;
}

export const api = {
  /** The downloadable MCP server and the tools it offers (Settings → AI tools). */
  async mcpInfo(): Promise<{ available: boolean; downloadPath: string; endpoint?: string; npmPackage?: string; version?: string; requires: string; tools: McpToolInfo[] }> {
    return (await request("/api/v1/mcp")).json();
  },
  async listTemplates(): Promise<TemplateRecord[]> {
    return (await request("/api/v1/templates")).json();
  },
  async getTemplate(id: string): Promise<TemplateRecord> {
    return (await request(`/api/v1/templates/${encodeURIComponent(id)}`)).json();
  },
  async getVersion(id: string, version: number): Promise<VersionRecord> {
    return (await request(`/api/v1/templates/${encodeURIComponent(id)}/versions/${version}`)).json();
  },
  async listVersions(id: string): Promise<VersionRecord[]> {
    return (await request(`/api/v1/templates/${encodeURIComponent(id)}/versions`)).json();
  },
  async createTemplate(id: string, name: string, definition: unknown): Promise<TemplateRecord> {
    return (await request("/api/v1/templates", { method: "POST", body: JSON.stringify({ id, name, definition }) })).json();
  },
  async saveTemplate(id: string, name: string, definition: unknown): Promise<TemplateRecord> {
    return (await request(`/api/v1/templates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name, definition }) })).json();
  },
  async publish(id: string, version: number, notes: string): Promise<VersionRecord> {
    return (await request(`/api/v1/templates/${encodeURIComponent(id)}/versions/${version}/publish`, { method: "POST", body: JSON.stringify({ notes }) })).json();
  },
  async validate(report: unknown): Promise<{ valid: boolean; issues: { severity?: string; code: string; message: string; path?: string }[] }> {
    return (await request("/api/v1/validate", { method: "POST", body: JSON.stringify({ report }) })).json();
  },
  async deleteTemplate(id: string): Promise<void> {
    await request(`/api/v1/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async capabilities(): Promise<{ formats: { id: string; supports: string[] }[]; fonts: string[]; fontFaces?: Record<string, string[]>; defaultFont?: string | null; scriptFonts: Record<string, string>; secrets: string[] }> {
    return (await request("/api/v1/capabilities")).json();
  },
  async fontFace(family: string, variant: string): Promise<ArrayBuffer> {
    return (await request(`/api/v1/resources/font?family=${encodeURIComponent(family)}&variant=${encodeURIComponent(variant)}`)).arrayBuffer();
  },
  async imageSource(src: string): Promise<string> {
    const result = await (await request(`/api/v1/resources/image?src=${encodeURIComponent(src)}`, { cache: "no-store" })).json() as { dataUrl: string };
    return result.dataUrl;
  },
  async listBlocks(): Promise<{ id: string; name: string; version?: number; children: any[] }[]> {
    return (await request("/api/v1/blocks")).json();
  },
  /** Saves a new version of a library block and returns its number. */
  async putBlock(id: string, name: string, children: unknown[], notes?: string): Promise<number | undefined> {
    const response = await request(`/api/v1/blocks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name, children, ...(notes ? { notes } : {}) }) });
    const version = Number(response.headers.get("x-block-version"));
    return Number.isInteger(version) && version > 0 ? version : undefined;
  },
  async listBlockVersions(id: string): Promise<{ version: number; name: string; notes?: string; createdAt: string }[]> {
    return (await request(`/api/v1/blocks/${encodeURIComponent(id)}/versions`)).json();
  },
  async deleteBlock(id: string): Promise<void> {
    await request(`/api/v1/blocks/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async listPrinterProfiles(): Promise<SavedPrinterProfile[]> {
    return (await request("/api/v1/printer-profiles")).json();
  },
  async putPrinterProfile(id: string, name: string, print: PrintProfile, page: PageConfig): Promise<SavedPrinterProfile> {
    return (await request(`/api/v1/printer-profiles/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ name, print, page }) })).json();
  },
  async deletePrinterProfile(id: string): Promise<void> {
    await request(`/api/v1/printer-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async render(report: unknown, format: "pdf" | "html" | "xlsx" | "csv" | "docx" | "zpl" | "escpos", parameters?: Record<string, unknown>): Promise<{ blob: Blob; renderId: string | null; warningCount: number }> {
    const subreports = report && typeof report === "object" ? subreportSources(report as Doc) : {};
    const res = await request("/api/v1/render", { method: "POST", body: JSON.stringify({ report, format, parameters, ...(Object.keys(subreports).length ? { subreports } : {}) }) });
    return { blob: await res.blob(), renderId: res.headers.get("x-render-id"), warningCount: Number(res.headers.get("x-render-warnings") ?? 0) };
  },
  async analyze(report: unknown, parameters: Record<string, unknown> = {}, subreports?: Record<string, SubreportSource>): Promise<{ paginated?: PaginatedReport; valid: boolean; issues: { severity: string; code: string; message: string }[] }> {
    const dependencies = subreports ?? (report && typeof report === "object" ? subreportSources(report as Doc) : {});
    return (await request("/api/v1/analyze", { method: "POST", body: JSON.stringify({ report, parameters, ...(Object.keys(dependencies).length ? { subreports: dependencies } : {}), includeLayout: true }) })).json();
  },
  async testDataset(dataset: unknown, parameters: Record<string, unknown> = {}, maxRows?: number): Promise<{ ok: boolean; issues: { message: string }[]; rowCount: number; durationMs?: number; value: unknown }> {
    return (await request("/api/v1/datasets/test", { method: "POST", body: JSON.stringify({ dataset, parameters, maxRows }) })).json();
  },
};
