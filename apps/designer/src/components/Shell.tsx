import { ThemeDialogBody } from "./ThemeDialog";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { requestReplaceReport, resolveReplaceReport, useStore, type Mode } from "../store";
import { api, ApiError, normalizeServerUrl, settings, type TemplateRecord } from "../lib/api";
import { STARTERS, blankReport } from "../lib/templates";
import { generateReportFromJson } from "../lib/generate";
import { insertFromPalette, PALETTE_ITEMS } from "./LeftPanel";
import { exportReport } from "./Preview";
import { DatasetEditor } from "./DatasetEditor";
import { GroupWizard } from "./GroupWizard";
import { PageBreakDetails } from "./PageBreakDetails";
import { SaveBlockDialogBody } from "./CanvasTools";
import { CompareDialogBody } from "./CompareDialog";
import { PublishDialogBody } from "./PublishDialog";
import { AiSettingsBody } from "./AiBar";
import { ShortcutSheet } from "./ShortcutSheet";
import { downloadReportFile, isPublicDemo } from "../lib/report-file";
import { exportJrxml, downloadJrxml, downloadJrxmlPackage } from "../lib/jrxml-export";
import { COMMANDS, shortcutLabel } from "../lib/commands";
import { importJrxml, type ImportResult } from "@reporting/jrxml-import";
import { JrxmlFolderImport } from "./JrxmlFolderImport";
import { importFrx, type FrxImportResult } from "@reporting/frx-import";
import type { WordImportResult } from "../lib/docx-import";
import { FeatureGuide } from "./FeatureGuide";
import { LandingPage } from "./home/LandingPage";
import { LearningLibrary } from "./learning/LearningLibrary";
import { ReportFilePicker } from "./ReportFilePicker";
import { DesignerIntegrationExample } from "./DesignerIntegrationExample";
import { McpSettingsPanel } from "./McpSettingsPanel";
import "./integration.css";

/** Opens the "I tried Open Reports" issue form on the upstream repository. */
const FEEDBACK_URL = "https://github.com/varaprasadreddy9676/open-reports/issues/new?template=1-feedback.yml";

// ------------------------------------------------------------------ toolbar
function useOutsideClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".menu-wrap")) close();
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open, close]);
}

function SaveIndicator() {
  const { saveState, meta, embedded, embeddedSaveMode } = useStore();
  const hostManaged = embedded && embeddedSaveMode === "host";
  const text = saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : saveState === "dirty" ? (hostManaged || meta.id ? "Unsaved changes" : "Draft kept locally") : hostManaged ? "✓ Saved in your application" : meta.id ? "✓ Saved" : "✓ Draft saved locally";
  return (
    <span className={`save-state ${saveState}${hostManaged ? " host-managed" : ""}`} data-testid="save-state" aria-live="polite">
      {text}
    </span>
  );
}

const TARGETS = [
  { id: "pdf", label: "PDF" },
  { id: "html", label: "HTML" },
  { id: "xlsx", label: "Excel" },
  { id: "csv", label: "CSV (data)" },
  { id: "zpl", label: "Label (ZPL)" },
  { id: "escpos", label: "Receipt (ESC/POS)" },
];

export function Toolbar() {
  const { doc, meta, view, snap, past, future, engineBusy, target, mode, split, embedded, embeddedSaveMode, saveState } = useStore();
  const hostManaged = embedded && embeddedSaveMode === "host";
  const s = useStore.getState;
  const set = useStore((st) => st.set);
  const [menu, setMenu] = useState<null | "export" | "more" | "view">(null);
  const printerFormat = doc.print?.printerType === "receipt" ? "escpos" : ["label", "card", "wristband"].includes(doc.print?.printerType ?? "") ? "zpl" : null;
  const close = React.useCallback(() => setMenu(null), []);
  useOutsideClose(menu !== null, close);
  useEffect(() => {
    if (menu) requestAnimationFrame(() => document.querySelector<HTMLElement>('.toolbar [role="menu"] [role="menuitem"]:not(:disabled), .toolbar [role="menu"] [role="menuitemcheckbox"]:not(:disabled)')?.focus());
  }, [menu]);
  const setView = (k: keyof typeof view) => {
    const v = { ...s().view, [k]: !s().view[k] };
    set({ view: v, showGrid: v.grid, showRulers: v.rulers });
  };
  return (
    <header className="toolbar" role="toolbar" aria-label="Main toolbar">
      <div className="brand">
        {!embedded && <button className="home-nav" data-testid="btn-home" title="Go to Home" onClick={() => set({ home: true, dialog: null })}>
          <span className="logo" aria-hidden="true">▤</span>
          <span>Home</span>
        </button>}
        {!embedded && <span className="sep-slash">/</span>}
        <input
          className="title-input"
          data-testid="title-input"
          aria-label="Report name"
          value={doc.name ?? ""}
          onChange={(e) => s().setDoc({ ...s().doc, name: e.target.value }, { coalesce: "name" })}
        />
        {!hostManaged && <span className={`status-pill ${meta.status ?? "draft"}`} data-testid="status-pill">
          {meta.id ? `${meta.status ?? "draft"} · v${meta.version ?? 1}` : "unsaved"}
        </span>}
        <SaveIndicator />
        {engineBusy && <span className="busy" aria-label="Updating">⟳</span>}
      </div>

      <div className="toolbar-group toolbar-history">
        <button className="icon-btn" data-testid="btn-undo" title={`Undo (${shortcutLabel("undo")})`} aria-label="Undo" disabled={!past.length} onClick={() => s().undo()}>↶</button>
        <button className="icon-btn" data-testid="btn-redo" title={`Redo (${shortcutLabel("redo")})`} aria-label="Redo" disabled={!future.length} onClick={() => s().redo()}>↷</button>
      </div>

      <div className="mode-switch" role="tablist" aria-label="Editor mode">
        {(["design", "data", "code", "preview"] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} data-testid={`mode-${m}`} onClick={() => set({ mode: m })}>
            {m === "design" ? "Design" : m === "data" ? "Data" : m === "code" ? "Code" : "Preview"}
          </button>
        ))}
      </div>

      <div className="toolbar-group right">
        <button className="btn toolbar-open" data-testid="btn-open" onClick={() => set({ dialog: "open" })}>{hostManaged ? "Open file" : "Open"}</button>
        <button className="btn" data-testid="btn-preview" onClick={() => set({ mode: "preview", demoHint: null })}>▶ Run preview</button>
        <button className="btn" data-testid="btn-save" disabled={saveState === "saving"} title={hostManaged ? "Save the report JSON back to your application." : `Save a new draft version on this server, to reopen and keep editing. Drafts are not what the report viewer or API render.${isPublicDemo() ? " Public demo: every visitor can open saved reports, and they may be reset." : ""}`} onClick={() => s().save()}>{saveState === "saving" ? "Saving…" : "Save"}</button>
        {!hostManaged && <button className="btn publish" data-testid="btn-publish" title="Check the report, then make this version the one the report viewer, API and embedded pages render. Published versions never change." onClick={() => set({ dialog: "publish" })}>Publish</button>}
        <button className="icon-btn" data-testid="btn-guide" aria-label="Feature guide" title="What can I do?" onClick={() => set({ dialog: "guide" })}>?</button>
        <div className="menu-wrap" onKeyDown={(e) => {
          if (!menu) return;
          if (e.key === "Escape") {
            e.preventDefault();
            setMenu(null);
            document.querySelector<HTMLElement>('[data-testid="btn-more"]')?.focus();
            return;
          }
          if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'));
          if (!items.length) return;
          e.preventDefault();
          const at = items.indexOf(document.activeElement as HTMLElement);
          const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}>
          <button className="icon-btn" data-testid="btn-more" aria-label="More report actions" aria-haspopup="menu" aria-expanded={menu !== null} onClick={() => setMenu(menu === null ? "more" : null)}>⋯</button>
          {menu === "more" && (
            <div className="menu right" role="menu">
              <button role="menuitem" data-testid="btn-new" onClick={() => (setMenu(null), set({ dialog: "new" }))}>New report…</button>
              <button role="menuitem" onClick={() => (setMenu(null), set({ dialog: "open" }))}>{hostManaged ? "Open report file…" : "Open…"}</button>
              <button role="menuitem" data-testid="menu-import-jrxml" onClick={() => (setMenu(null), set({ dialog: "import-jrxml" }))}>Import JRXML…</button>
              <button role="menuitem" data-testid="menu-import-frx" onClick={() => (setMenu(null), set({ dialog: "import-frx" }))}>Import FastReport…</button>
              <button role="menuitem" data-testid="menu-import-docx" onClick={() => (setMenu(null), set({ dialog: "import-docx" }))}>Import Word document…</button>
              <button role="menuitem" data-testid="menu-duplicate" onClick={() => (setMenu(null), duplicateReport())}>Duplicate report</button>
              {!hostManaged && <button role="menuitem" onClick={() => (setMenu(null), set({ dialog: "compare", compareVersion: null }))} disabled={!meta.id}>Compare versions…</button>}
              <hr />
              <button role="menuitem" data-testid="btn-view" onClick={() => setMenu("view")}>Canvas view options…</button>
              <button role="menuitemcheckbox" aria-checked={split} data-testid="toggle-split" onClick={() => (set({ split: !split, mode: split ? s().mode : "design" }), setMenu(null))}><span className="check">{split ? "✓" : ""}</span>Split design and code</button>
              <button role="menuitem" data-testid="btn-ai" onClick={() => (set({ aiOpen: !s().aiOpen }), setMenu(null))}>Ask AI…</button>
              <button role="menuitem" data-testid="btn-palette" onClick={() => (set({ dialog: "palette" }), setMenu(null))}>Command palette… <kbd>⌘K</kbd></button>
              <button role="menuitem" data-testid="menu-guide" onClick={() => (set({ dialog: "guide" }), setMenu(null))}>What can I do?…</button>
              <button role="menuitem" data-testid="btn-export" onClick={() => setMenu("export")}>Export…</button>
              <label className="menu-field">Output target
                <select data-testid="target-select" value={target} onChange={(e) => (set({ target: e.target.value }), s().refresh())}>
                  {TARGETS.filter((t) => t.id !== "zpl" && t.id !== "escpos" || t.id === printerFormat).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
              <hr />
              <button role="menuitem" onClick={() => (setMenu(null), set({ dialog: "settings" }))}>Settings…</button>
              {!embedded && <a role="menuitem" data-testid="menu-feedback" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(null)}>Send feedback ↗</a>}
              <hr />
              {!hostManaged && <button role="menuitem" className="danger" disabled={!meta.id} onClick={() => (setMenu(null), deleteReport())}>Delete report</button>}
            </div>
          )}
          {menu === "export" && <div className="menu right" role="menu">
            <button role="menuitem" onClick={() => setMenu("more")}>← Report actions</button>
            <hr />
            {(["pdf", "docx", "html", "xlsx", "csv", ...(printerFormat ? [printerFormat] : [])] as ("pdf" | "docx" | "html" | "xlsx" | "csv" | "zpl" | "escpos")[]).map((f) => (
              <button key={f} role="menuitem" data-testid={`export-${f}`} onClick={() => (setMenu(null), exportReport(f))}>
                {f === "zpl" ? "ZPL label" : f === "escpos" ? "ESC/POS receipt" : f === "docx" ? "Word (DOCX)" : f.toUpperCase()}
              </button>
            ))}
            <hr />
            <button role="menuitem" data-testid="export-definition" onClick={() => (setMenu(null), downloadDefinition())}>Report file (.json): your own copy</button>
            <button role="menuitem" data-testid="export-jrxml" onClick={() => {
              setMenu(null);
              const doc = useStore.getState().doc;
              const result = exportJrxml(doc);
              const details = result.issues.slice(0, 8).map((issue) => `• ${issue.path}: ${issue.message}`).join("\n");
              const more = result.issues.length > 8 ? `\n• …and ${result.issues.length - 8} more.` : "";
              const dependencies = result.dependencies.length ? `\n\nThis report references ${result.dependencies.length} bundled subreport(s); they are not included in this single file. Choose “JasperReports source package (.zip)” to include them.` : "";
              if (!window.confirm(`EXPERIMENTAL JRXML EXPORT\n\nUse this as an interoperability bridge or migration aid. For the best experience, plan to move authoring to Open Reports JSON as soon as practical; it preserves the full designer, renderer, and editing experience. JasperReports may behave differently, and this export is not a guarantee of complete feature parity.${result.issues.length ? `\n\n${result.issues.length} compatibility note(s):\n${details}${more}` : "\n\nNo known compatibility notes were found for this report; still compile and compare its output in your Jasper runtime."}${dependencies}\n\nDownload the JRXML source anyway?`)) return;
              downloadJrxml(doc, result);
              useStore.getState().toast("JRXML file downloaded.");
            }}>Experimental · JasperReports 6 JRXML (.jrxml)</button>
            <button role="menuitem" data-testid="export-jrxml-project" onClick={async () => {
              setMenu(null);
              const doc = useStore.getState().doc;
              const result = exportJrxml(doc);
              const details = result.issues.slice(0, 8).map((issue) => `• ${issue.path}: ${issue.message}`).join("\n");
              const more = result.issues.length > 8 ? `\n• …and ${result.issues.length - 8} more.` : "";
              if (!window.confirm(`EXPERIMENTAL JRXML EXPORT\n\nUse this as an interoperability bridge or migration aid. For the best experience, plan to move authoring to Open Reports JSON as soon as practical; it preserves the full designer, renderer, and editing experience. JasperReports may behave differently, and this export is not a guarantee of complete feature parity.${result.issues.length ? `\n\n${result.issues.length} compatibility note(s):\n${details}${more}` : "\n\nNo known compatibility notes were found for this report; still compile and compare its output in your Jasper runtime."}\n\nDownload the JasperReports source package anyway?`)) return;
              await downloadJrxmlPackage(doc, result);
              useStore.getState().toast(`JRXML source package downloaded${result.dependencies.length ? ` with ${result.dependencies.length} subreport source(s)` : ""}.`);
            }}>Experimental · JasperReports source package (.zip)</button>
          </div>}
          {menu === "view" && <div className="menu right" role="menu">
            <button role="menuitem" onClick={() => setMenu("more")}>← Report actions</button>
            <hr />
            {([
              ["grid", "Grid", "toggle-grid"],
              ["rulers", "Rulers", "toggle-rulers"],
              ["guides", "Smart guides", "toggle-guides"],
              ["margins", "Margins & safe area", "toggle-margins"],
              ["boundaries", "Show all boundaries", "toggle-boundaries"],
              ["diagnostics", "Diagnostics on canvas", "toggle-diagnostics"],
            ] as const).map(([k, label, tid]) => (
              <button key={k} role="menuitemcheckbox" aria-checked={view[k]} data-testid={tid} onClick={() => setView(k)}>
                <span className="check">{view[k] ? "✓" : ""}</span>{label}
              </button>
            ))}
            <label className="menu-field">Design with
              <select data-testid="sample-rows" value={useStore.getState().sampleRows} onChange={(e) => (set({ sampleRows: Number(e.target.value) }), s().refresh())}>
                <option value={0}>all rows</option>
                <option value={5}>first 5 rows</option>
                <option value={20}>first 20 rows</option>
                <option value={50}>first 50 rows</option>
              </select>
            </label>
            <button role="menuitemcheckbox" aria-checked={snap} data-testid="toggle-snap" onClick={() => set({ snap: !snap })}><span className="check">{snap ? "✓" : ""}</span>Snap to grid & components</button>
            <button role="menuitemcheckbox" aria-checked={useStore.getState().focusCanvas} data-testid="toggle-focus-canvas" onClick={() => {
              const state = s();
              if (state.focusCanvas) set({ ...state.focusRestore, focusCanvas: false, focusRestore: null });
              else set({ focusCanvas: true, focusRestore: { leftOpen: state.leftOpen, rightOpen: state.rightOpen, bottom: state.bottom }, leftOpen: false, rightOpen: false, bottom: null });
              setMenu(null);
            }}><span className="check">{useStore.getState().focusCanvas ? "✓" : ""}</span>Focus Canvas</button>
          </div>}
        </div>
      </div>
    </header>
  );
}

function downloadDefinition() {
  downloadReportFile(useStore.getState().doc);
}

function duplicateReport() {
  const s = useStore.getState();
  const copy = { ...structuredClone(s.doc), id: `${s.doc.id}-copy-${Date.now().toString(36).slice(-4)}`, name: `${s.doc.name} (copy)` };
  requestReplaceReport(() => {
    s.loadDoc(copy);
    s.toast("Duplicated - this copy is not saved yet");
  });
}

async function deleteReport() {
  const s = useStore.getState();
  if (!s.meta.id || !window.confirm(`Delete "${s.doc.name}" and all of its versions? This cannot be undone.`)) return;
  try {
    await api.deleteTemplate(s.meta.id);
    s.loadDoc(blankReport());
    s.toast("Report deleted", "success");
  } catch (e) {
    s.toast((e as Error).message, "error");
  }
}

// ------------------------------------------------------------------ bottom bar + panels
export function BottomBar() {
  const { engine, bottom, doc } = useStore();
  const receipt = doc.print?.printerType === "receipt";
  const set = useStore((s) => s.set);
  const errors = engine.problems.filter((p) => p.severity === "error").length;
  const warnings = engine.problems.filter((p) => p.severity === "warning").length;
  const suggestions = engine.problems.filter((p) => p.severity === "suggestion").length;
  const decisions = engine.paginated?.decisions.length ?? 0;
  const toggle = (b: Exclude<typeof bottom, null>) => set({ bottom: bottom === b ? null : b });
  return (
    <footer className="bottombar">
      <div className="tabs" role="tablist" aria-label="Panels">
        <button role="tab" aria-selected={bottom === "problems"} className={bottom === "problems" ? "active" : ""} data-testid="toggle-problems" onClick={() => toggle("problems")}>
          Problems
        </button>
        <button role="tab" aria-selected={bottom === "pagination"} className={bottom === "pagination" ? "active" : ""} data-testid="toggle-pagination" onClick={() => toggle("pagination")}>
          {receipt ? "PDF pagination" : "Pagination"}{decisions ? ` (${decisions})` : ""}
        </button>
        <button role="tab" aria-selected={bottom === "history"} className={bottom === "history" ? "active" : ""} data-testid="toggle-history" onClick={() => toggle("history")}>
          History
        </button>
        {useStore.getState().migrationIssues.length > 0 && <button role="tab" aria-selected={bottom === "migration"} className={bottom === "migration" ? "active" : ""} data-testid="toggle-migration" onClick={() => toggle("migration")}>
          Migration ({useStore.getState().migrationIssues.filter((issue) => issue.status !== "converted").length})
        </button>}
      </div>
      <div className="counts" data-testid="problem-counts">
        <span className={errors ? "err" : ""}>{errors} errors</span>
        <span className={warnings ? "warn" : ""}>{warnings} warnings</span>
        <span>{suggestions} suggestions</span>
        {engine.paginated && <span className="muted">{receipt ? "PDF: " : ""}{engine.paginated.pages.length} page{engine.paginated.pages.length === 1 ? "" : "s"}</span>}
      </div>
    </footer>
  );
}

export function BottomPanel() {
  const bottom = useStore((s) => s.bottom);
  if (!bottom) return null;
  return (
    <div className="bottom-panel" role="region" aria-label={bottom}>
      {bottom === "problems" && <ProblemsPanel />}
      {bottom === "pagination" && <PaginationPanel />}
      {bottom === "history" && <HistoryPanel />}
      {bottom === "migration" && <MigrationPanel />}
    </div>
  );
}

function MigrationPanel() {
  const { migrationIssues: issues, doc } = useStore();
  const pending = issues.filter((issue) => issue.status !== "converted");
  return <div className="migration-panel" data-testid="migration-panel">
    <div className="pg-summary"><strong>JRXML migration</strong><span className="muted">{pending.length} items need review; {doc.migration?.summary.converted ?? issues.filter((issue) => issue.status === "converted").length} converted</span></div>
    {pending.map((issue, index) => <div className="migration-row" key={index}>
      <button className="problem-main" data-testid="migration-issue" onClick={() => {
        const state = useStore.getState();
        if (issue.targetId) {
          const band = state.doc.sections?.findIndex((section: { id?: string }) => section.id === issue.targetId) ?? -1;
          if (band >= 0) state.set({ selectedBand: band, selection: [], mode: "design" });
          else state.select([issue.targetId]);
          state.set({ mode: "design" });
          requestAnimationFrame(() => document.querySelector(`[data-cid="${issue.targetId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
        }
      }}>
        <span className={`migration-status ${issue.status}`}>{issue.status}</span>
        <span>{issue.feature}: {issue.message}</span>
        <span className="muted small">line {issue.line}</span>
      </button>
      {issue.original && <details><summary>Original expression</summary><code>{issue.original}</code></details>}
    </div>)}
  </div>;
}

export function ProblemsPanel() {
  const { engine } = useStore();
  const order = { error: 0, warning: 1, suggestion: 2 } as const;
  const list = [...engine.problems].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="problems" data-testid="problems">
      {list.length === 0 && <div className="muted pad">No problems found.</div>}
      {list.map((p, i) => (
        <div key={i} className={`problem ${p.severity}`} data-testid={`problem-${p.severity}`}>
          <button
            className="problem-main"
            onClick={() => {
              if (p.datasetId) {
                useStore.getState().set({ mode: "data", editingDataset: p.datasetId });
                return;
              }
              if (p.componentId) {
                useStore.getState().select([p.componentId]);
                if (useStore.getState().mode !== "design") useStore.getState().set({ mode: "design" });
                requestAnimationFrame(() => document.querySelector(`[data-cid="${p.componentId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
              }
            }}
          >
            <span className="sev">{p.severity === "error" ? "ERROR" : p.severity === "warning" ? "WARNING" : "SUGGESTION"}</span>
            <span className="msg">{p.message}</span>
            {p.componentId && <span className="where">{p.componentId}</span>}
          </button>
          {p.fix && (
            <button
              className="btn small fix"
              data-testid="problem-fix"
              onClick={() => {
                const st = useStore.getState();
                st.patch(p.fix!.id, p.fix!.patch, `fix:${p.code}`);
                st.toast(`Fixed: ${p.fix!.label}`, "success");
              }}
            >
              {p.fix.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function PaginationPanel() {
  const { engine } = useStore();
  const [openPage, setOpenPage] = useState<number | null>(null);
  const pag = engine.paginated;
  if (!pag) return <div className="muted pad">Nothing paginated yet.</div>;
  const mm = (pt: number) => `${(pt * 25.4 / 72).toFixed(1)} mm`;
  return (
    <div className="pagination-panel" data-testid="pagination-panel">
      <div className="pg-summary">
        <strong>{pag.pages.length} page{pag.pages.length === 1 ? "" : "s"}</strong>
        <span className="muted" data-testid="pagination-source">{engine.paginationSource === "pdf" ? "PDF font layout" : "Estimated font layout"}</span>
        <span className="muted">Printable area {mm(pag.pageSize.width - pag.margin.left - pag.margin.right)} × {mm(pag.pageSize.height - pag.margin.top - pag.margin.bottom)}</span>
      </div>
      {pag.pages.length <= 1 && <div className="muted pad">Everything fits on one page.</div>}
      {pag.pages.slice(1).map((page) => {
        const causes = pag.decisions.filter((decision) => decision.page === page.number && decision.kind !== "group-header-repeated");
        const primary = causes[0] ?? pag.decisions.find((decision) => decision.page === page.number);
        return <div key={page.number} className="decision-row">
          <button className={`decision ${primary?.kind ?? "flow-break"}`} data-testid="pagination-decision" aria-expanded={openPage === page.number} onClick={() => {
            setOpenPage(openPage === page.number ? null : page.number);
            const st = useStore.getState();
            if (primary?.componentId) st.select([primary.componentId]);
            st.set({ mode: "design" });
            requestAnimationFrame(() => document.querySelector(`[data-page="${page.number - 1}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
          }}>
            <span className="dk">p.{page.number}</span>
            <span className="dm"><strong>{primary?.kind.replace(/-/g, " ") ?? "Page start"}</strong> {primary?.message ?? "Inspect this page's start."}</span>
            <span className="decision-chevron" aria-hidden="true">{openPage === page.number ? "▾" : "▸"}</span>
          </button>
          {openPage === page.number && <div className="pagination-page-details"><PageBreakDetails paginated={pag} pageNumber={page.number} /></div>}
        </div>;
      })}
    </div>
  );
}

function HistoryPanel() {
  const { past, future, meta } = useStore();
  const restore = useStore((s) => s.restore);
  const set = useStore((s) => s.set);
  return (
    <div className="history-panel" data-testid="history-panel">
      <div className="pg-summary">
        <strong>History</strong>
        <span className="muted">{past.length} change{past.length === 1 ? "" : "s"} this session</span>
        <span className="spacer" />
        <button className="btn small" disabled={!meta.id} onClick={() => set({ dialog: "compare", compareVersion: null })}>Compare saved versions…</button>
      </div>
      {future.length > 0 && <div className="muted small pad">{future.length} undone step{future.length === 1 ? "" : "s"} can be redone</div>}
      {[...past].map((h, i) => ({ h, i })).reverse().map(({ h, i }) => (
        <button key={i} className="history-row" data-testid="history-row" onClick={() => restore(i)} title="Restore the report to how it was before this change">
          <span className="muted small">{new Date(h.at).toLocaleTimeString()}</span>
          <span>{h.label || "Edit"}</span>
          <span className="muted small">Restore before this</span>
        </button>
      ))}
      {past.length === 0 && <div className="muted pad">No edits yet.</div>}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs
export function Modal({ children, onClose, wide, className = "", label = "Report dialog", closable = true }: { children: React.ReactNode; onClose: () => void; wide?: boolean; className?: string; label?: string; closable?: boolean }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (modal.current?.querySelector<HTMLElement>("[data-default-focus]") ?? closeButton.current)?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (closable) onClose();
      } else if (e.key === "Tab") {
        const focusable = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose, closable]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closable && onClose()}>
      <div ref={modal} className={`modal ${wide ? "wide" : ""} ${className}`} role="dialog" aria-modal="true" aria-label={label}>
        <button ref={closeButton} className="modal-close" type="button" aria-label="Close dialog" title="Close (Esc)" disabled={!closable} onClick={onClose}>×</button>
        {children}
      </div>
    </div>
  );
}

const DOC_SIZES: { label: string; page: Record<string, unknown>; print?: Record<string, unknown> }[] = [
  { label: "A4", page: { size: "A4", orientation: "portrait" } },
  { label: "A4 landscape", page: { size: "A4", orientation: "landscape" } },
  { label: "A5", page: { size: "A5", orientation: "portrait" } },
  { label: "A5 landscape", page: { size: "A5", orientation: "landscape" } },
  { label: "A6", page: { size: "A6", orientation: "portrait" } },
  { label: "A6 landscape", page: { size: "A6", orientation: "landscape" } },
  { label: "Letter", page: { size: "Letter", orientation: "portrait" } },
  { label: "Receipt 80 mm", page: { size: "custom", width: 80, height: 200, unit: "mm", margin: { top: 3, right: 3, bottom: 3, left: 3 } }, print: { printerType: "receipt", language: "escpos", dpi: 203, safeMargin: 2 } },
  { label: "Receipt 58 mm", page: { size: "custom", width: 58, height: 160, unit: "mm", margin: { top: 3, right: 3, bottom: 3, left: 3 } }, print: { printerType: "receipt", language: "escpos", dpi: 203, safeMargin: 2 } },
  { label: "Label 40 × 25 mm", page: { size: "custom", width: 40, height: 25, unit: "mm", orientation: "landscape", margin: { top: 1.5, right: 2, bottom: 1.5, left: 2 } } },
  { label: "Label 50 × 30 mm", page: { size: "custom", width: 50, height: 30, unit: "mm", orientation: "landscape", margin: { top: 1.5, right: 2, bottom: 1.5, left: 2 } } },
  { label: "Label 100 × 50 mm", page: { size: "custom", width: 100, height: 50, unit: "mm", orientation: "landscape", margin: { top: 3, right: 4, bottom: 3, left: 4 } } },
];

function StarterChoices({ actionsOnly = false }: { actionsOnly?: boolean }) {
  const set = useStore((s) => s.set);
  const [q, setQ] = useState("");
  const [size, setSize] = useState(0);
  const groups = ["Documents", "Industries", "Healthcare", "Printing", "Data"] as const;
  const create = (doc: any) => {
    requestReplaceReport(() => {
      useStore.getState().loadDoc(doc);
      set({ dialog: null, mode: "design" });
    });
  };
  const createBlank = () => {
    const selected = DOC_SIZES[size]!;
    const blank = blankReport();
    create({ ...blank, page: { ...blank.page, ...selected.page }, ...(selected.print ? { print: selected.print } : {}) });
  };
  return <>
      <div className="starter-actions">
        <div className="starter blank">
          <button className="starter-main" data-testid="starter-blank" onClick={createBlank}>
            <strong>Blank report</strong>
            <span>Start from an empty page</span>
          </button>
          <select aria-label="Blank page size" data-testid="blank-size" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {DOC_SIZES.map((d, i) => (
              <option key={d.label} value={i}>{d.label}</option>
            ))}
          </select>
        </div>
        <button className="starter blank" data-testid="starter-json" onClick={() => set({ dialog: "generate" })}>
          <strong>From sample JSON</strong>
          <span>Paste data - fields, tables and layout are generated</span>
        </button>
        <button className="starter blank" data-testid="starter-jrxml" onClick={() => set({ dialog: "import-jrxml" })}>
          <strong>Import JRXML</strong>
          <span>Open a JasperReports source file and review conversion issues</span>
        </button>
        <button className="starter blank" data-testid="starter-frx" onClick={() => set({ dialog: "import-frx" })}>
          <strong>Import FastReport</strong>
          <span>Turn .frx designs into drafts and review what their scripts did</span>
        </button>
        <button className="starter blank" data-testid="starter-docx" onClick={() => set({ dialog: "import-docx" })}>
          <strong>Import Word document</strong>
          <span>Turn a DOCX file into an editable report draft</span>
        </button>
      </div>
      {!actionsOnly && <><input className="search" data-testid="starter-search" placeholder="Search templates (invoice, label, wristband…)" aria-label="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
      {groups.filter((g) => STARTERS.some((t) => t.group === g && `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase()))).map((g) => (
        <div key={g}>
          <div className="group-title">{g}</div>
          <div className="starter-grid">
            {STARTERS.filter((t) => t.group === g && `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase())).map((t) => (
              <button
                key={t.key}
                className="starter"
                data-testid={`starter-${t.key}`}
                onClick={() => create({ ...structuredClone(t.doc), id: `${t.doc.id}-${Date.now().toString(36).slice(-4)}` })}
              >
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      ))}</>}
    </>;
}

function openStarterExample(key: string, message?: string, guided = true) {
  const example = STARTERS.find((item) => item.key === key);
  if (!example) return;
  requestReplaceReport(() => {
    const state = useStore.getState();
    state.loadDoc({ ...structuredClone(example.doc), id: `${example.doc.id}-${Date.now().toString(36).slice(-4)}` });
    state.set({ dialog: null, mode: "design", demoHint: !message && guided ? "edit" : null });
    if (message) state.toast(message);
  });
}

export function HomeScreen() {
  return <LandingPage onExample={openStarterExample} onTemplate={(key) => openStarterExample(key, undefined, false)}><StarterChoices actionsOnly /></LandingPage>;
}

function NewDialog() {
  const set = useStore((s) => s.set);
  return <Modal wide label="New report" onClose={() => set({ dialog: null })}>
    <h2>New report</h2>
    <StarterChoices />
  </Modal>;
}

function GuideDialog() {
  const set = useStore((state) => state.set);
  return <Modal wide className="feature-modal" label="Feature guide" onClose={() => set({ dialog: null })}>
    <FeatureGuide
      onExample={openStarterExample}
      onImport={(format) => set({ dialog: format === "docx" ? "import-docx" : "import-jrxml" })}
      onLearn={() => set({ dialog: "tour" })}
    />
  </Modal>;
}

const PRACTICAL_VIDEOS = [
  { id: "open-reports-flagship-trailer", title: "Open Reports in under two minutes", summary: "A hospital system prints an invoice designed in Open Reports, a second branch gets its own letterhead, staff edit the layout in place, and a fintech app renders statements.", duration: "1:47", category: "Start here" },
  { id: "open-reports-intro", title: "Open Reports in one minute", summary: "See how a report goes from data and design to a printable result.", duration: "1:15", category: "Start here" },
  { id: "designer-tour", title: "Find your way around the designer", summary: "Start at Home, explore Design, Data, Code and Preview, then return home.", duration: "2:02", category: "Start here" },
  { id: "first-report", title: "Build your first report from data", summary: "Create a heading, connect sample JSON, add a bound field and table, calculate a total, and preview the PDF.", duration: "2:07", category: "Start here" },
  { id: "table-designer-workflow", title: "Edit an invoice table", summary: "Resize columns, add a grouped header, inspect rows and set totals before previewing.", duration: "2:01", category: "Tables" },
  { id: "table-merges-rules", title: "Merge table cells and highlight rows", summary: "Merge repeated transaction dates and inspect a conditional low-balance style in a real statement.", duration: "1:57", category: "Tables" },
  { id: "grouped-report-workflow", title: "Group records and calculate subtotals", summary: "Read nested department and doctor groups, inspect subtotal bands, and verify the report total.", duration: "1:36", category: "Data" },
  { id: "group-create-workflow", title: "Create a group and add subtotals", summary: "Group fictional sales by region, label each group, and calculate its revenue total.", duration: "1:43", category: "Data" },
  { id: "barcode-label-zpl", title: "Design a barcode label and export ZPL", summary: "Check a 50 × 30 mm label, its safe area and barcode, then download printer-ready ZPL.", duration: "2:08", category: "Print" },
  { id: "printer-profiles", title: "Calibrate and reuse a printer profile", summary: "Download a ZPL calibration label, save stock and DPI settings, then apply the profile to another report.", duration: "2:20", category: "Print" },
  { id: "layout-precision", title: "Set up a page and place elements precisely", summary: "Choose A4, A5 or A6 and orientation, then align and resize on the canvas.", duration: "1:49", category: "Design" },
  { id: "sections-explained", title: "Sections and bands explained", summary: "Learn what runs once, repeats on each page, groups records, and prints for each row.", duration: "2:08", category: "Design" },
  { id: "data-sources", title: "Connect data from JSON, CSV and a REST API", summary: "Test sample data, pass a report parameter to an API, and bind a returned field.", duration: "2:09", category: "Data" },
  { id: "formulas-conditions", title: "Use formulas and conditions", summary: "Transform a value, format a date, and control element visibility with a rule.", duration: "2:09", category: "Data" },
  { id: "long-report-pagination", title: "Keep long reports readable across pages", summary: "Inspect page breaks, repeat table headings, and choose first, normal, and last page masters.", duration: "2:16", category: "Pagination" },
  { id: "page-master-variants", title: "Customize first, normal and last page bands", summary: "Give an account statement a distinct opening and final page footer, then review the real PDF.", duration: "2:02", category: "Pagination" },
  { id: "client-letterhead", title: "Customize a client letterhead and footer", summary: "Replace logo sources, update organization details, and compare a pre-printed page.", duration: "2:09", category: "Design" },
  { id: "shared-header-subreport", title: "Reuse a client header with a subreport", summary: "Select a child report file and attach its logos and contact details to multiple parent reports.", duration: "1:45", category: "Reuse" },
  { id: "crosstab-workflow", title: "Build a sales crosstab", summary: "Compare regions and services, change the calculation, and review totals.", duration: "2:01", category: "Data" },
  { id: "output-formats", title: "Choose the right report output", summary: "Compare PDF, HTML, Excel, CSV and Word exports, then see where printer formats fit.", duration: "2:07", category: "Output" },
  { id: "publish-review", title: "Review and publish a report version", summary: "Run validation, inspect the PDF, publish an immutable version, and compare later edits.", duration: "1:49", category: "Quality and sharing" },
  { id: "interactive-viewer", title: "Use the interactive report viewer", summary: "Change report parameters, drill into grouped records, open a linked detail report, search, sort, and download a PDF.", duration: "2:01", category: "Sharing" },
  { id: "api-rendering", title: "Render a report from your application API", summary: "Send host-owned report JSON and authorized data, then use the rendered PDF bytes in your app.", duration: "1:48", category: "Developers" },
  { id: "designer-embedding", title: "Embed the designer in your application", summary: "Load a host-owned report into the embedded designer, edit it, and save the JSON through your host callback.", duration: "1:34", category: "Developers" },
  { id: "open-reports-codex-mcp", title: "Build and render a report with Codex MCP", summary: "Watch a real Codex client inspect, edit, validate, and render an invoice through Open Reports MCP, then open the same report in the designer and PDF preview.", duration: "2:18", category: "Developers" },
  { id: "open-reports-flagship", title: "Build and integrate an invoice report", summary: "Create an invoice from a blank page, reuse a shared letterhead, print it from a hospital app, edit it inside that app, and render a saved template in a fintech dashboard.", duration: "12:21", category: "Developers" },
  { id: "settings-security", title: "Connect the designer and protect API keys", summary: "Set the server URL, test the connection, and review safer backend integration patterns.", duration: "1:27", category: "Developers" },
  { id: "plugin-workflow", title: "Extend the server with a trusted plugin", summary: "Inspect a real plugin registry and use its custom renderer and expression functions.", duration: "2:06", category: "Developers" },
  { id: "reusable-blocks", title: "Save and reuse report components", summary: "Save a shared brand element and choose whether report copies follow, pin, or detach from updates.", duration: "1:37", category: "Reuse" },
  { id: "async-render-jobs", title: "Handle a long render as a background job", summary: "Queue a render, poll its status, download the completed file, and understand the current job store limits.", duration: "1:34", category: "Developers" },
  { id: "invoice-to-pdf", title: "Create an invoice and preview the PDF", summary: "Edit a working invoice, then inspect the finished PDF.", duration: "0:36", category: "Examples" },
  { id: "hospital-letterhead", title: "Build a hospital letterhead with logos", summary: "Align left and right logos, then compare editable headers with pre-printed stationery.", duration: "1:09", category: "Examples" },
  { id: "sales-crosstab", title: "Summarize sales with a crosstab", summary: "Compare sales by region and service, then preview the totals.", duration: "0:36", category: "Examples" },
  { id: "supermarket-receipt", title: "Build and print a long supermarket receipt", summary: "Edit a 45-item grocery basket, inspect the continuous roll, compare PDF with ESC/POS, and download printer bytes.", duration: "2:00", category: "Print" },
  { id: "sticker-sheet-workflow", title: "Print a sheet of address or inventory labels", summary: "Choose A4 label stock, fill one label per record, use a start position and check print alignment.", duration: "1:36", category: "Print" },
  { id: "word-to-report", title: "Turn a Word template into an editable report", summary: "Review DOCX counts and warnings, edit the draft, and compare its PDF.", duration: "2:17", category: "Import" },
  { id: "jasper-folder-migration", title: "Review a JasperReports folder migration", summary: "Convert related JRXML files into separate JSON drafts, inspect the linked child, and preview the result.", duration: "2:24", category: "Import" },
];

function TourDialog() {
  const set = useStore((state) => state.set);
  return <Modal wide className="learning-modal" label="Open Reports training videos" onClose={() => set({ dialog: null })}>
    <LearningLibrary lessons={PRACTICAL_VIDEOS} onExample={openStarterExample} onGuide={() => set({ dialog: "guide" })} onImport={(format) => set({ dialog: format === "docx" ? "import-docx" : "import-jrxml" })} onSettings={() => set({ dialog: "settings" })} />
  </Modal>;
}

function JrxmlImportDialog() {
  const set = useStore((s) => s.set);
  const [scope, setScope] = useState<"single" | "folder">("single");
  const [folderBusy, setFolderBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filename, setFilename] = useState("");
  const [error, setError] = useState("");
  const read = async (file?: File) => {
    setResult(null); setError("");
    if (!file) return;
    setFilename(file.name);
    if (!file.name.toLowerCase().endsWith(".jrxml")) { setError("Choose a .jrxml source file."); return; }
    if (file.size > 10_000_000) { setError("JRXML exceeds the 10 MB import limit."); return; }
    try { setResult(importJrxml(await file.text(), { sourceName: file.name })); }
    catch (cause) { setError((cause as Error).message); }
  };
  const apply = () => {
    if (!result?.report) return;
    requestReplaceReport(() => {
      const state = useStore.getState();
      state.loadDoc(result.report!);
      state.set({ migrationIssues: result.issues, bottom: "migration", dialog: null, mode: "design" });
      state.toast("JRXML draft imported. Review migration issues before using the output.");
    });
  };
  const pending = result?.issues.filter((issue) => issue.status !== "converted") ?? [];
  return <Modal wide label="Import JRXML" closable={!folderBusy} onClose={() => { if (!folderBusy) set({ dialog: null }); }}>
    <h2>Import JasperReports source</h2>
    <p className="muted">Import one JRXML file or a folder. Converted reports stay as drafts; data connections and unsupported expressions need review.</p>
    <div className="tabs" aria-label="JRXML import scope"><button aria-pressed={scope === "single"} className={scope === "single" ? "active" : ""} disabled={folderBusy} onClick={() => setScope("single")}>One file</button><button aria-pressed={scope === "folder"} className={scope === "folder" ? "active" : ""} disabled={folderBusy} onClick={() => setScope("folder")}>Folder</button></div>
    {scope === "single" ? <>
    <input type="file" accept=".jrxml,application/xml,text/xml" data-testid="jrxml-file" aria-label="JRXML file" onChange={(event) => void read(event.target.files?.[0])} />
    {error && <p className="err" role="alert">{error}</p>}
    {result && <div className="jrxml-review" data-testid="jrxml-review">
      <p><strong>{filename}</strong> · {result.format ?? "invalid"} · {result.summary.converted} converted · {result.summary["needs-review"]} need review · {result.summary.unsupported} unsupported</p>
      <div className="jrxml-review-list">{pending.slice(0, 100).map((issue, index) => <div key={index} className="migration-row">
        <span className={`migration-status ${issue.status}`}>{issue.status}</span>
        <span>{issue.feature}: {issue.message}</span>
        <span className="muted small">line {issue.line}</span>
      </div>)}</div>
      {pending.length > 100 && <p className="muted">Showing the first 100 issues here. All issues will be available after import.</p>}
    </div>}
    <div className="dialog-actions"><button className="btn" onClick={() => set({ dialog: null })}>Cancel</button><button className="btn primary" data-testid="apply-jrxml" disabled={!result?.report} onClick={apply}>Open editable draft</button></div>
    </> : <JrxmlFolderImport onBusyChange={setFolderBusy} />}
  </Modal>;
}

function FrxImportDialog() {
  const set = useStore((s) => s.set);
  const [results, setResults] = useState<{ file: string; result: FrxImportResult }[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const read = async (list?: FileList | null) => {
    setResults([]); setError("");
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (files.some((file) => !file.name.toLowerCase().endsWith(".frx"))) { setError("Choose FastReport .frx files."); return; }
    if (files.some((file) => file.size > 10_000_000)) { setError("A file exceeds the 10 MB import limit."); return; }
    const read = await Promise.all(files.map(async (file) => {
      const name = file.name.replace(/\.frx$/i, "");
      return { file: file.name, result: importFrx(await file.text(), { id: `frx-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`, name, sourceName: file.name }) };
    }));
    setResults(read);
  };
  const single = results.length === 1 ? results[0]!.result : undefined;
  const apply = () => {
    if (!single?.report) return;
    requestReplaceReport(() => {
      const state = useStore.getState();
      state.loadDoc(single.report!);
      state.set({ migrationIssues: single.issues, bottom: "migration", dialog: null, mode: "design" });
      state.toast("FastReport draft imported. Review the migration list before using the output.");
    });
  };
  const saveAll = async () => {
    setSaving(true);
    let saved = 0;
    for (const { result } of results) {
      const report = result.report;
      if (!report) continue;
      try { await api.createTemplate(report.id, report.name, report); saved++; }
      catch {
        try { await api.saveTemplate(report.id, report.name, report); saved++; }
        catch (cause) { useStore.getState().toast(`${report.name}: ${(cause as Error).message}`, "error"); }
      }
    }
    setSaving(false);
    set({ dialog: "open" });
    useStore.getState().toast(`${saved} FastReport draft${saved === 1 ? "" : "s"} saved. Open one to review its migration list.`, "success");
  };
  const pending = single?.issues.filter((issue) => issue.status !== "converted") ?? [];
  return <Modal wide label="Import FastReport" closable={!saving} onClose={() => { if (!saving) set({ dialog: null }); }}>
    <h2>Import FastReport designs</h2>
    <p className="muted">Choose one .frx file to open it as a draft, or several to save them all as drafts. Bands, groups, totals, formats and highlights are converted. C# scripts never run; anything they did is listed for review. The rows come from your application at render time.</p>
    <input type="file" multiple accept=".frx,application/xml,text/xml" data-testid="frx-file" aria-label="FastReport files" disabled={saving} onChange={(event) => void read(event.target.files)} />
    {error && <p className="err" role="alert">{error}</p>}
    {single && <div className="jrxml-review" data-testid="frx-review">
      <p><strong>{results[0]!.file}</strong> · {single.summary.converted} converted · {single.summary["needs-review"]} need review · {single.summary.unsupported} unsupported</p>
      <div className="jrxml-review-list">{pending.slice(0, 100).map((issue, index) => <div key={index} className="migration-row">
        <span className={`migration-status ${issue.status}`}>{issue.status}</span>
        <span>{issue.feature}: {issue.message}</span>
        <span className="muted small">line {issue.line}</span>
      </div>)}</div>
    </div>}
    {results.length > 1 && <div className="jrxml-review" data-testid="frx-review">
      <div className="jrxml-review-list">{results.map(({ file, result }) => <div key={file} className="migration-row">
        <span className={`migration-status ${result.report ? (result.summary.unsupported ? "unsupported" : result.summary["needs-review"] ? "needs-review" : "converted") : "unsupported"}`}>{result.report ? "draft" : "failed"}</span>
        <span>{file}</span>
        <span className="muted small">{result.summary["needs-review"]} need review · {result.summary.unsupported} unsupported</span>
      </div>)}</div>
    </div>}
    <div className="dialog-actions">
      <button className="btn" disabled={saving} onClick={() => set({ dialog: null })}>Cancel</button>
      {results.length > 1
        ? <button className="btn primary" data-testid="save-frx-drafts" disabled={saving || !results.some((r) => r.result.report)} onClick={() => void saveAll()}>{saving ? "Saving…" : `Save ${results.filter((r) => r.result.report).length} drafts`}</button>
        : <button className="btn primary" data-testid="apply-frx" disabled={!single?.report} onClick={apply}>Open editable draft</button>}
    </div>
  </Modal>;
}

function DocxImportDialog() {
  const set = useStore((state) => state.set);
  const [result, setResult] = useState<WordImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const read = async (file?: File) => {
    setResult(null); setError("");
    if (!file) return;
    setBusy(true);
    try {
      const { importDocx } = await import("../lib/docx-import");
      setResult(await importDocx(file));
    } catch (cause) {
      setError((cause as Error).message || "This Word file could not be imported.");
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!result) return;
    requestReplaceReport(() => {
      const state = useStore.getState();
      state.loadDoc(result.report);
      state.set({ dialog: null, mode: "design" });
      state.toast("Word draft imported. Review the layout and data before publishing.");
    });
  };
  return <Modal wide label="Import Word document" closable={!busy} onClose={() => set({ dialog: null })}>
    <h2>Import a Word document</h2>
    <p className="muted">Choose a DOCX file to start an editable report. Paragraphs, tables and embedded images are converted locally in your browser. Review the result before publishing.</p>
    <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-testid="docx-file" aria-label="Word document" disabled={busy} onChange={(event) => void read(event.target.files?.[0])} />
    {busy && <p role="status">Reading Word document…</p>}
    {error && <p className="err" role="alert">{error}</p>}
    {result && <div className="jrxml-review" data-testid="docx-review">
      <p><strong>{result.report.name}</strong> · {result.summary.paragraphs} paragraphs · {result.summary.tables} tables · {result.summary.images} images</p>
      {result.warnings.length ? <div className="jrxml-review-list">{result.warnings.map((warning) => <div key={warning} className="migration-row"><span className="migration-status needs-review">Review</span><span>{warning}</span></div>)}</div> : <p className="muted">No conversion warnings. Check layout and sample data in Preview.</p>}
    </div>}
    <div className="dialog-actions"><button className="btn" onClick={() => set({ dialog: null })} disabled={busy}>Cancel</button><button className="btn primary" data-testid="apply-docx" disabled={!result || busy} onClick={apply}>Open editable draft</button></div>
  </Modal>;
}

const SAMPLE_JSON = `{
  "patient": { "name": "Alex Morgan", "mrn": "MRN-1042", "dob": "1994-05-12", "gender": "Male" },
  "invoice": {
    "number": "INV-2001",
    "date": "2025-02-10",
    "items": [
      { "description": "Consultation", "quantity": 1, "rate": 600 },
      { "description": "Blood test (CBC)", "quantity": 1, "rate": 450 },
      { "description": "X-ray chest", "quantity": 2, "rate": 700 }
    ]
  }
}`;

function GenerateDialog() {
  const set = useStore((s) => s.set);
  const [json, setJson] = useState(SAMPLE_JSON);
  const [name, setName] = useState("Patient invoice");
  const [error, setError] = useState("");
  return (
    <Modal wide onClose={() => set({ dialog: "new" })}>
      <h2>Create a report from sample JSON</h2>
      <p className="muted">Paste a response from your API. Datasets, bound fields and tables are created for you - then adjust visually.</p>
      <label className="field wide">
        <span className="field-label">Report name</span>
        <input data-testid="generate-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <textarea className="mono" data-testid="generate-json" rows={14} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} aria-label="Sample JSON" />
      {error && <div className="field-error" role="alert">{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={() => set({ dialog: "new" })}>Back</button>
        <span className="spacer" />
        <button
          className="btn primary"
          data-testid="generate-create"
          onClick={() => {
            try {
              const doc = generateReportFromJson(JSON.parse(json), name || "New report");
              requestReplaceReport(() => {
                useStore.getState().loadDoc(doc);
                useStore.getState().set({ dialog: null, mode: "design", leftTab: "data" });
              });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Create report
        </button>
      </div>
    </Modal>
  );
}

function OpenDialog() {
  const set = useStore((s) => s.set);
  const home = useStore((s) => s.home);
  const hostManaged = useStore((s) => s.embedded && s.embeddedSaveMode === "host");
  const embedded = useStore((s) => s.embedded);
  const [items, setItems] = useState<TemplateRecord[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!hostManaged) api.listTemplates().then(setItems).catch((e) => setError((e as Error).message));
  }, [hostManaged]);
  return (
    <Modal label={hostManaged ? "Open report file" : "Open a saved report"} onClose={() => set({ dialog: null })}>
      <h2>{hostManaged ? "Open report file" : "Open a saved report"}</h2>
      <ReportFilePicker />
      {!hostManaged && <><h3>Saved on this server</h3><p className="muted">Select a report to edit, or close this dialog to return.</p>
      {error && <div className="field-error" role="alert">{error}</div>}
      {!items && !error && <p className="muted" role="status">Loading saved reports…</p>}
      {items && items.length === 0 && <p className="muted">Nothing saved yet. Use Save to store this report on the server.</p>}
      <ul className="template-list" data-testid="template-list">
        {(items ?? []).map((t) => (
          <li key={t.id}>
            <button data-testid={`open-${t.id}`} onClick={() => useStore.getState().openTemplate(t.id)}>
              <strong>{t.name}</strong>
              <span className={`status-pill ${t.status}`}>{t.status} · v{t.currentVersion}</span>
              <span className="muted small">{t.id}</span>
            </button>
          </li>
        ))}
      </ul>
      </>}
      <div className="dialog-actions">
        <button className="btn" onClick={() => set({ dialog: null })}>Close</button>
        {!home && !embedded && <button className="btn" onClick={() => set({ dialog: null, home: true })}>Go Home</button>}
        <span className="spacer" />
        <button className="btn" onClick={() => set({ dialog: "new" })}>New report</button>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const set = useStore((s) => s.set);
  const embedded = useStore((s) => s.embedded);
  const interfaceTheme = useStore((s) => s.interfaceTheme);
  const setInterfaceTheme = useStore((s) => s.setInterfaceTheme);
  const [key, setKey] = useState(settings.apiKey);
  const [base, setBase] = useState(settings.apiBase);
  const [tab, setTab] = useState<"preferences" | "connection" | "integrate" | "ai">("connection");
  const [showKey, setShowKey] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const [example, setExample] = useState<"curl" | "node" | "java" | "python">("node");
  const [copied, setCopied] = useState(false);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0 || !tabs.length) return;
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  const examples = {
    curl: [
      '# render-request.json contains report, format, and data from your application.',
      'curl -X POST "$OPEN_REPORTS_URL/api/v1/render" -H "content-type: application/json" -H "x-api-key: $OPEN_REPORTS_API_KEY" --data-binary @render-request.json -o invoice.pdf',
    ].join("\n"),
    node: [
      'const { definition } = await reportStore.getForTenant(tenantId, "invoice");',
      'const response = await fetch(process.env.OPEN_REPORTS_URL + "/api/v1/render", {',
      '  method: "POST",',
      '  headers: {',
      '    "content-type": "application/json",',
      '    "x-api-key": process.env.OPEN_REPORTS_API_KEY,',
      '  },',
      '  body: JSON.stringify({ report: definition, format: "pdf", data: { invoice: authorizedInvoice } }),',
      '});',
      'if (!response.ok) throw new Error(`Open Reports: ${response.status}`);',
      'const pdf = Buffer.from(await response.arrayBuffer());',
    ].join("\n"),
    java: [
      'var body = new ObjectMapper().createObjectNode();',
      'body.set("report", reportDefinition); // loaded from host-owned template storage',
      'body.put("format", "pdf");',
      'body.set("data", mapper.valueToTree(Map.of("invoice", authorizedInvoice)));',
      'var request = HttpRequest.newBuilder(URI.create(openReportsUrl',
      '        + "/api/v1/render"))',
      '    .header("content-type", "application/json")',
      '    .header("x-api-key", openReportsApiKey)',
      '    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))',
      '    .build();',
      'var response = HttpClient.newHttpClient().send(request,',
      '    HttpResponse.BodyHandlers.ofByteArray());',
      'if (response.statusCode() / 100 != 2) throw new RuntimeException("Render failed");',
      'byte[] pdf = response.body();',
    ].join("\n"),
    python: [
      'report_definition = report_store.get_for_tenant(tenant_id, "invoice")',
      'response = requests.post(',
      '    f"{OPEN_REPORTS_URL}/api/v1/render",',
      '    headers={"x-api-key": OPEN_REPORTS_API_KEY},',
      '    json={"report": report_definition, "format": "pdf", "data": {"invoice": authorized_invoice}},',
      '    timeout=120,',
      ')',
      'response.raise_for_status()',
      'pdf_bytes = response.content',
    ].join("\n"),
  };
  const testConnection = async () => {
    setChecking(true);
    setConnection(null);
    let url: string;
    try {
      url = `${normalizeServerUrl(base)}/api/v1/templates`;
    } catch {
      setConnection({ ok: false, message: "Enter a valid server URL, such as https://reports.example.com." });
      setChecking(false);
      return;
    }

    try {
      const headers = new Headers();
      if (key.trim()) headers.set("x-api-key", key.trim());
      const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const body: unknown = await response.json();
        setConnection(Array.isArray(body) ? { ok: true, message: key.trim() ? "Connected. The server accepted this API key." : "Connected. The reporting API is reachable without an API key." } : { ok: false, message: "This URL did not return the reporting API. Check the server base address." });
      }
      else if (response.status === 401) setConnection({ ok: false, message: "Server reached, but this API key was not accepted." });
      else if (response.status === 403) setConnection({ ok: false, message: "Server reached, but access was denied. Check the key and server permissions." });
      else setConnection({ ok: false, message: `Server reached, but returned ${response.status}. Check the server URL and API configuration.` });
    } catch (error) {
      setConnection({ ok: false, message: error instanceof SyntaxError ? "This URL returned a web page instead of the reporting API. Check the server base address." : "Could not reach the server. Check the URL, that the server is running, and its CORS settings." });
    } finally {
      setChecking(false);
    }
  };
  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(examples[example]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal wide className="settings-modal" label="Settings" onClose={() => set({ dialog: null })}>
      <div className="settings-heading">
        <div><p className="eyebrow">OPEN REPORTS</p><h2>Settings</h2></div>
        <p>Connect the designer to a reporting server, or follow the quick start to integrate it with your application.</p>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKeyDown}>
        {([ ["connection", "Server connection"], ["integrate", "Integration guide"], ["ai", "AI tools (MCP)"], ["preferences", "Preferences"] ] as const).map(([id, label]) => (
          <button key={id} id={`settings-tab-${id}`} role="tab" aria-controls={`settings-panel-${id}`} tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} data-testid={`settings-tab-${id}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "connection" && <section className="settings-section" id="settings-panel-connection" role="tabpanel" aria-labelledby="settings-tab-connection" tabIndex={0}>
        <div className="settings-section-title"><div><h3>Reporting server</h3><p>Connect to the Open Reports instance that renders your reports. Template storage is optional.</p></div><span className="settings-status-dot" aria-hidden="true" /></div>
        <label className="field wide"><span className="field-label">Server URL</span><input data-testid="settings-api-base" type="url" value={base} onChange={(e) => { setBase(e.target.value); setConnection(null); }} placeholder="https://reports.example.com" autoComplete="url" /><span className="field-hint">Use the server’s base address. Leave blank when the designer and API share an origin.</span></label>
        <label className="field wide"><span className="field-label">API key <span className="muted">(optional if server auth is disabled)</span></span><span className="settings-key-field"><input data-testid="settings-api-key" type={showKey ? "text" : "password"} value={key} onChange={(e) => { setKey(e.target.value); setConnection(null); }} autoComplete="off" spellCheck={false} placeholder="Paste the server API key" /><button className="btn" type="button" data-testid="settings-toggle-key" aria-label={showKey ? "Hide API key" : "Show API key"} onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button></span><span className="field-hint">{embedded ? "Connection settings apply only to this embedded editor session. Keep privileged API keys in your host backend." : "This designer stores the key in this browser. Server API keys are currently instance-wide; do not use a privileged key in a public or shared browser. For application integrations, keep it in your backend."}</span></label>
        {connection && <p className={connection.ok ? "ok-text settings-feedback" : "field-error settings-feedback"} role="status" data-testid="settings-connection-status">{connection.message}</p>}
        <div className="dialog-actions settings-actions"><button className="btn" type="button" data-testid="settings-test-connection" disabled={checking} onClick={testConnection}>{checking ? "Checking…" : "Test connection"}</button><span className="spacer" /><button className="btn primary" type="button" data-testid="settings-save" disabled={checking} onClick={() => { try { settings.apiBase = normalizeServerUrl(base); settings.apiKey = key.trim(); set({ dialog: null }); } catch { setConnection({ ok: false, message: "Enter a valid server URL, such as https://reports.example.com." }); } }}>Save connection</button></div>
      </section>}

      {tab === "ai" && <McpSettingsPanel onTabKeyDown={onTabKeyDown} />}

      {tab === "preferences" && <section className="settings-section" id="settings-panel-preferences" role="tabpanel" aria-labelledby="settings-tab-preferences" tabIndex={0}>
        <h3>Appearance</h3><p>Choose how the designer looks in this browser.</p>
        <label className="field wide"><span className="field-label">Interface theme</span><select aria-label="Interface appearance" data-testid="settings-appearance" value={interfaceTheme} onChange={(event) => setInterfaceTheme(event.target.value as typeof interfaceTheme)}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>
      </section>}

      {tab === "integrate" && <section className="settings-section integration-quickstart" id="settings-panel-integrate" role="tabpanel" aria-labelledby="settings-tab-integrate" tabIndex={0}>
        <div className="integration-intro"><span className="integration-step">1</span><div><h3>Call the reporting API from your backend</h3><p>Your application keeps login, permissions, business rules, and report definitions. It loads authorized data, then sends the chosen report JSON and data to Open Reports to render the document.</p></div></div>
        <div className="integration-note"><strong>Keep your API key on the server.</strong> A key placed in browser JavaScript or an embedded page can be copied by users. Open Reports renders reports; your application decides who can request them.</div>
        <div className="integration-code-heading"><div><h4>Render a host-owned report</h4><p>POST the JSON definition and data to <code>/api/v1/render</code>. No Open Reports template ID or template storage is required.</p></div><div className="integration-code-tabs" role="tablist" aria-label="Code example language" onKeyDown={onTabKeyDown}>{([ ["node", "Node"], ["java", "Java"], ["python", "Python"], ["curl", "cURL"] ] as const).map(([id, label]) => <button key={id} id={`settings-example-tab-${id}`} role="tab" aria-controls="settings-example-panel" tabIndex={example === id ? 0 : -1} aria-selected={example === id} data-testid={`settings-example-${id}`} onClick={() => { setExample(id); setCopied(false); }}>{label}</button>)}</div></div>
        <pre className="integration-code" id="settings-example-panel" role="tabpanel" aria-labelledby={`settings-example-tab-${example}`} tabIndex={0}><code>{examples[example]}</code></pre>
        <div className="dialog-actions integration-actions"><button className="btn" type="button" data-testid="settings-copy-example" onClick={copyExample}>{copied ? "Copied" : "Copy example"}</button><span className="spacer" /><span className="field-hint">Uses your normal HTTP client; no SDK required.</span></div>
        <div className="integration-next-steps"><h4>Typical setup</h4><ol><li>Keep each tenant’s report JSON in your application’s normal storage and versioning system.</li><li>From your backend, authorize the user and prepare the data and branding for that request.</li><li>POST the report definition, format, and data to <code>/api/v1/render</code>; return the PDF or other output from your application.</li></ol><p>Open Reports also has optional server-side template storage for standalone use. For an embedded designer, enable host-managed saving so edited JSON returns to your application.</p></div>
        <DesignerIntegrationExample />
        <div className="integration-branding-note"><h4>Use one report definition with different client branding</h4><p>Bind the logo image to <code>data.client.logoUrl</code>, and header/footer text to paths such as <code>data.client.headerText</code> and <code>data.client.footerText</code>. Pass each client’s branding in the render request:</p><pre className="integration-branding-code"><code>{`"data": {
  "client": {
    "logoUrl": "https://assets.example.com/client-logo.png",
    "headerText": "Northstar Medical Center",
    "footerText": "Care with clarity · northstar.example"
  },
  "invoice": { "number": "INV-1042", "total": 15340 }
}`}</code></pre><p>A logo may be a PNG/JPEG/WebP URL reachable by the reporting server, or a <code>data:image/png;base64,...</code> value sent by your backend. Private image hosts must be explicitly allowed on the server; the client’s local file path is not automatically accessible to a hosted server.</p></div>
        <div className="integration-doc-links"><a href="https://github.com/varaprasadreddy9676/open-reports/blob/claude/upbeat-volta-pe84n7/docs/INTEGRATION_GUIDE.md" target="_blank" rel="noreferrer">Full integration guide ↗</a><a href="https://github.com/varaprasadreddy9676/open-reports/blob/claude/upbeat-volta-pe84n7/docs/API.md" target="_blank" rel="noreferrer">REST API reference ↗</a><a href="https://github.com/varaprasadreddy9676/open-reports/blob/claude/upbeat-volta-pe84n7/docs/EMBEDDING.md" target="_blank" rel="noreferrer">Embedding guide ↗</a></div>
      </section>}
    </Modal>
  );
}

// ------------------------------------------------------------------ command palette
interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

function useCommands(): Command[] {
  return useMemo(() => {
    const s = () => useStore.getState();
    const cmds: Command[] = [
      { id: "publish", label: "Review and publish version", run: () => s().set({ dialog: "publish" }) },
      { id: "new", label: "New report...", run: () => s().set({ dialog: "new" }) },
      { id: "open", label: "Open report...", run: () => s().set({ dialog: "open" }) },
      { id: "dataset", label: "Create dataset", run: () => s().set({ dialog: "dataset", editingDataset: null }) },
      { id: "theme", label: "Edit theme: colours, fonts, sizes, spacing and text styles", run: () => s().set({ dialog: "theme" }) },
      { id: "json", label: "Paste sample JSON to generate a report", run: () => s().set({ dialog: "generate" }) },
      ...(s().mode === "design" ? [] : [{ id: "design", label: "Switch to Design", run: () => s().set({ mode: "design" }) }]),
      { id: "code", label: "Open report JSON", run: () => s().set({ mode: "code" }) },
      { id: "preview", label: "Preview PDF", run: () => s().set({ mode: "preview" }) },
      ...(["pdf", "docx", "html", "xlsx", "csv", "zpl"] as const).map((f) => ({ id: `export-${f}`, label: f === "docx" ? "Export Word (DOCX)" : `Export ${f.toUpperCase()}`, run: () => exportReport(f) })),
      { id: "landscape", label: "Change page to landscape", run: () => s().setDoc({ ...s().doc, page: { ...s().doc.page, orientation: "landscape" } }) },
      { id: "portrait", label: "Change page to portrait", run: () => s().setDoc({ ...s().doc, page: { ...s().doc.page, orientation: "portrait" } }) },
      { id: "grid", label: "Toggle grid", run: () => s().set({ showGrid: !s().showGrid }) },
      { id: "rulers", label: "Toggle rulers", run: () => s().set({ showRulers: !s().showRulers }) },
      { id: "problems", label: "Toggle problems panel", run: () => s().set({ bottom: s().bottom === "problems" ? null : "problems" }) },
      { id: "pagination", label: "Show pagination decisions", run: () => s().set({ bottom: "pagination" }) },
      { id: "history", label: "Show history", run: () => s().set({ bottom: "history" }) },
      { id: "data", label: "Open Data mode", run: () => s().set({ mode: "data" }) },
      ...PALETTE_ITEMS.map((i) => ({ id: `add-${i.label}`, label: `Add ${i.label.toLowerCase()}`, run: () => insertFromPalette(i) })),
      ...((useStore.getState().doc.sections ?? []) as any[]).flatMap((sec) => (sec.children ?? []).map((c: any) => ({ id: `find-${c.id}`, label: `Find component: ${c.id}`, run: () => s().select([c.id]) }))),
    ];
    // Keyboard commands come first and carry their shortcut, so the palette teaches the keys.
    const keyed: Command[] = COMMANDS.filter((command) => command.palette).map((command) => ({ id: command.id, label: command.label, hint: shortcutLabel(command.id), run: () => void command.run(s()) }));
    const hostManaged = s().embedded && s().embeddedSaveMode === "host";
    return [...keyed, ...cmds].filter((command) => !hostManaged || command.id !== "publish");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useStore.getState().dialog]);
}

function CommandPalette() {
  const set = useStore((s) => s.set);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const cmds = useCommands();
  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const run = (c: Command) => {
    set({ dialog: null });
    setTimeout(c.run, 0);
  };
  return (
    <Modal onClose={() => set({ dialog: null })}>
      <input
        autoFocus
        data-default-focus
        className="palette-input"
        data-testid="palette-input"
        placeholder="Type a command... (add table, create dataset, preview PDF)"
        aria-label="Command"
        value={q}
        onChange={(e) => (setQ(e.target.value), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, list.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          if (e.key === "Enter" && list[active]) run(list[active]!);
        }}
      />
      <ul className="palette-list" role="listbox">
        {list.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
            <span>{c.label}</span>
            {c.hint && <kbd>{c.hint}</kbd>}
          </li>
        ))}
        {list.length === 0 && <li className="muted">No matching command</li>}
      </ul>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const set = useStore((s) => s.set);
  if (!dialog) return null;
  if (dialog === "replace") return <Modal label="Unsaved changes" onClose={() => resolveReplaceReport(false)}><h2>Replace this report?</h2><p className="muted">Your changes to <strong>{useStore.getState().doc.name || "Untitled report"}</strong> are saved only in this local draft. Opening another report will replace it.</p><div className="dialog-actions"><button className="btn" data-testid="replace-cancel" data-default-focus onClick={() => resolveReplaceReport(false)}>Keep editing</button><span className="spacer" /><button className="btn danger" data-testid="replace-confirm" onClick={() => resolveReplaceReport(true)}>Replace report</button></div></Modal>;
  if (dialog === "new") return <NewDialog />;
  if (dialog === "guide") return <GuideDialog />;
  if (dialog === "tour") return <TourDialog />;
  if (dialog === "import-jrxml") return <JrxmlImportDialog />;
  if (dialog === "import-frx") return <FrxImportDialog />;
  if (dialog === "import-docx") return <DocxImportDialog />;
  if (dialog === "open") return <OpenDialog />;
  if (dialog === "settings") return <SettingsDialog />;
  if (dialog === "generate") return <GenerateDialog />;
  if (dialog === "palette") return <CommandPalette />;
  if (dialog === "shortcuts") return <ShortcutSheet />;
  if (dialog === "ai-settings")
    return (
      <Modal onClose={() => set({ dialog: null })}>
        <AiSettingsBody onClose={() => set({ dialog: null })} />
      </Modal>
    );
  if (dialog === "compare")
    return (
      <Modal wide onClose={() => set({ dialog: null })}>
        <CompareDialogBody />
      </Modal>
    );
  if (dialog === "publish")
    return (
      <Modal wide onClose={() => set({ dialog: null })}>
        <PublishDialogBody />
      </Modal>
    );
  if (dialog === "theme")
    return (
      <Modal wide onClose={() => set({ dialog: null })}>
        <ThemeDialogBody />
      </Modal>
    );
  if (dialog === "block")
    return (
      <Modal onClose={() => set({ dialog: null })}>
        <SaveBlockDialogBody />
      </Modal>
    );
  if (dialog === "dataset")
    return (
      <Modal wide onClose={() => set({ dialog: null })}>
        <DatasetEditor key={useStore.getState().editingDataset ?? "new"} />
      </Modal>
    );
  if (dialog === "group")
    return (
      <Modal onClose={() => set({ dialog: null })}>
        <GroupWizard />
      </Modal>
    );
  return null;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} data-testid="toast">
          {t.text}
          {t.action && <button type="button" className="toast-action" data-testid="toast-action" onClick={() => { t.action!.run(); useStore.setState({ toasts: useStore.getState().toasts.filter((x) => x.id !== t.id) }); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export { ApiError };
