import { placeBlock, syncLinkedBlocks, type BlockMode } from "./lib/blocks";
import { parseGrid, parseSnapTargets, type GridSettings, type SnapTargets } from "./lib/grid";
import { create } from "zustand";
import * as ops from "./model/ops";
import type { Comp, Doc } from "./model/ops";
import { runEngine, type EngineResult, type Capabilities } from "./engine";
import { diffDocs, summarize } from "./lib/diff";
import type { Proposal } from "./lib/ai";
import { blankReport } from "./lib/templates";
import { api, ApiError } from "./lib/api";
import { loadCanvasFonts } from "./lib/fonts";
import { disintegrate } from "./lib/dust";
import { downloadReportFile, isPublicDemo } from "./lib/report-file";
import { scenarioSample, type CanvasScenario } from "./lib/canvas-scenario";
import { saveDefinitionToHost } from "./lib/embed-save";
import type { MigrationIssue } from "@reporting/jrxml-import";

export type Mode = "design" | "data" | "code" | "preview";
export type LeftTab = "insert" | "layers" | "data" | "pages";
export type ReportInspectorTab = "page" | "print" | "details";
export type BottomPanel = null | "problems" | "pagination" | "history" | "migration";
export type CanvasView = "structure" | "pages";
export type RulerUnit = "mm" | "cm" | "in" | "pt" | "px" | "dots";
export type RulerOrigin = "page" | "printable" | "section" | "selection";
export type SaveState = "saved" | "saving" | "dirty" | "error";
export type InterfaceTheme = "light" | "dark" | "system";

export interface HistoryEntry {
  doc: Doc;
  label: string;
  at: number;
}

export interface ViewOptions {
  grid: boolean;
  rulers: boolean;
  guides: boolean;
  margins: boolean;
  boundaries: boolean;
  diagnostics: boolean;
}

export interface Block {
  id: string;
  name: string;
  /** Latest library version. */
  version: number;
  children: Comp[];
}

export interface TemplateMeta {
  id?: string;
  version?: number;
  status?: "draft" | "published" | "archived";
  dirty: boolean;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
  /** One follow-up action, e.g. Undo after a delete. */
  action?: { label: string; run: () => void };
}

export interface DropPrompt {
  x: number;
  y: number;
  dataset: string;
  targetId?: string;
  position: ops.DropPosition;
  bandIndex?: number | null;
  /** Absolute dataset path to infer fields from when `dataset` is a row-relative nested list. */
  fieldsFrom?: string;
  /** Wrap the new list in a repeater over this dataset (a nested list dropped outside its parent's rows). */
  wrapIn?: string;
}

interface State {
  doc: Doc;
  sample: Record<string, unknown>;
  parameters: Record<string, unknown>;
  selection: string[];
  clipboard: Comp[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastCoalesce: { key: string; at: number } | null;
  mode: Mode;
  home: boolean;
  /** Running inside <open-report-designer> on another page: no home screen or demo links. */
  embedded: boolean;
  /** The embedding application, rather than this server, owns durable template storage. */
  embeddedSaveMode: "server" | "host";
  interfaceTheme: InterfaceTheme;
  demoHint: "edit" | "preview" | null;
  leftTab: LeftTab;
  reportInspectorTab: ReportInspectorTab;
  zoom: number;
  fitToWidth: boolean;
  showGrid: boolean;
  snap: boolean;
  showRulers: boolean;
  canvasView: CanvasView;
  previewSplit: boolean;
  showPagination: boolean;
  /** Example records shown per detail band in the structure view. */
  ghosts: number;
  rulerUnit: RulerUnit;
  rulerOrigin: RulerOrigin;
  gridMode: "lines" | "dots";
  /** Grid spacing and subdivisions (saved per user). */
  grid: GridSettings;
  /** Which targets dragging and resizing snap to (saved per user). */
  snapTargets: SnapTargets;
  /** Index (in doc.sections) of the band selected on the structure canvas. */
  selectedBand: number | null;
  view: ViewOptions;
  split: boolean;
  bottom: BottomPanel;
  migrationIssues: MigrationIssue[];
  target: string;
  sampleRows: number;
  /** A disposable data scenario shown on the canvas only (see CanvasScenario); exports and saves keep the real sample. */
  canvasScenario: CanvasScenario | null;
  saveState: SaveState;
  capabilities?: Capabilities;
  blocks: Block[];
  editingText: string | null;
  tableEditId: string | null;
  renaming: string | null;
  contextMenu: { x: number; y: number; id?: string } | null;
  compareVersion: number | null;
  aiOpen: boolean;
  aiProposal: Proposal | null;
  aiBusy: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  focusCanvas: boolean;
  focusRestore: { leftOpen: boolean; rightOpen: boolean; bottom: BottomPanel } | null;
  engine: EngineResult;
  /** The document `engine` was laid out from; the canvas shows newer geometry optimistically until layout catches up. */
  engineDoc?: Doc;
  engineBusy: boolean;
  meta: TemplateMeta;
  toasts: Toast[];
  dialog: null | "ai-settings" | "open" | "new" | "guide" | "tour" | "import-jrxml" | "import-frx" | "import-docx" | "settings" | "dataset" | "group" | "palette" | "generate" | "compare" | "block" | "publish" | "theme" | "replace" | "shortcuts";
  editingDataset: string | null;
  dropPrompt: DropPrompt | null;
  codeFocus: { id: string; nonce: number } | null;

  setDoc(doc: Doc, opts?: { coalesce?: string; keepSelection?: boolean }): void;
  loadDoc(doc: Doc, meta?: Partial<TemplateMeta>, sample?: Record<string, unknown>): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  addComponent(type: string, targetId?: string, position?: ops.DropPosition, overrides?: Partial<Comp>, bandIndex?: number | null): string;
  insertComponent(comp: Comp, targetId?: string, position?: ops.DropPosition, bandIndex?: number | null): string;
  removeSelected(): void;
  duplicateSelected(): void;
  copy(): void;
  paste(): void;
  patch(id: string, patch: Record<string, any>, coalesce?: string): void;
  patchStyle(id: string, patch: Record<string, any>, coalesce?: string): void;
  nudge(dx: number, dy: number): void;
  setSample(id: string, value: unknown): void;
  clearSample(id: string): void;
  setParameter(id: string, value: unknown): void;
  setMode(m: Mode): void;
  setInterfaceTheme(theme: InterfaceTheme): void;
  set(partial: Partial<State>): void;
  toast(text: string, kind?: Toast["kind"], action?: Toast["action"]): void;
  refresh(): Promise<void>;
  save(): Promise<void>;
  publish(notes: string): Promise<boolean>;
  openTemplate(id: string): Promise<void>;
  openCode(id: string): void;
  groupSelected(): void;
  ungroupSelected(): void;
  toggleLock(id?: string): void;
  toggleHide(id?: string): void;
  rename(id: string, name: string): void;
  restore(index: number): void;
  loadCapabilities(): Promise<void>;
  loadBlocks(): Promise<void>;
  saveBlock(name: string, notes?: string): Promise<void>;
  /** Places a library block: linked (follows new versions), pinned (stays on this version) or detached (a copy). */
  insertBlock(id: string, mode?: BlockMode): void;
  /** Brings linked blocks in the open report up to the library's latest versions. */
  syncLinkedBlocks(): void;
  acceptAi(): void;
  rejectAi(): void;
}

let toastId = 1;
let engineRun = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Library block id for a name; saving under an existing name adds a version to that block. */
export const blockIdFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "block";

function pref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`designer.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`designer.${key}`, value);
  } catch {
    /* private mode */
  }
}

function savedInterfaceTheme(): InterfaceTheme {
  const value = pref("interfaceTheme", "light");
  return value === "dark" || value === "system" ? value : "light";
}

export function applyInterfaceTheme(theme: InterfaceTheme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.uiTheme = dark ? "dark" : "light";
}

let pendingReplacement: { action: () => void | Promise<void>; previousDialog: State["dialog"] } | null = null;

export function requestReplaceReport(action: () => void | Promise<void>): void {
  const state = useStore.getState();
  if (!state.meta.dirty) { void action(); return; }
  pendingReplacement = { action, previousDialog: state.dialog };
  state.set({ dialog: "replace" });
}

export function resolveReplaceReport(replace: boolean): void {
  const pending = pendingReplacement;
  pendingReplacement = null;
  useStore.getState().set({ dialog: replace ? null : pending?.previousDialog ?? null });
  if (replace && pending) void pending.action();
}

const DRAFT_KEY = "designer.draft";
const CLIP_KEY = "designer.clipboard";

function saveClipboard(comps: Comp[]) {
  try {
    localStorage.setItem(CLIP_KEY, JSON.stringify(comps));
  } catch {
    /* storage unavailable */
  }
}

function loadClipboard(): Comp[] {
  try {
    return JSON.parse(localStorage.getItem(CLIP_KEY) ?? "[]");
  } catch {
    return [];
  }
}

let autosave: ReturnType<typeof setTimeout> | undefined;
/** Drafts are always kept locally; saved templates are autosaved to the server a few seconds after the last edit. */
function scheduleAutosave() {
  clearTimeout(autosave);
  autosave = setTimeout(() => {
    const s = useStore.getState();
    if (s.meta.id && s.meta.dirty && s.meta.status !== "published") s.save();
  }, 4000);
}

function persistDraft(doc: Doc, sample: Record<string, unknown>, dirty = false) {
  if (useStore.getState().embedded) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ doc, sample, dirty }));
  } catch {
    /* storage unavailable */
  }
}

export function loadDraft(): { doc: Doc; sample: Record<string, unknown>; dirty?: boolean } | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export const useStore = create<State>((set, get) => ({
  doc: ops.ensureIds(blankReport()),
  sample: {},
  parameters: {},
  selection: [],
  clipboard: loadClipboard(),
  past: [],
  future: [],
  lastCoalesce: null,
  mode: "design",
  home: true,
  embedded: false,
  embeddedSaveMode: "server",
  interfaceTheme: savedInterfaceTheme(),
  demoHint: null,
  leftTab: "insert",
  reportInspectorTab: "page",
  zoom: 1,
  fitToWidth: false,
  showGrid: false,
  snap: true,
  showRulers: true,
  canvasView: pref("canvasView", "pages") as CanvasView,
  previewSplit: false,
  showPagination: false,
  ghosts: 0,
  rulerUnit: pref("rulerUnit", "mm") as RulerUnit,
  rulerOrigin: pref("rulerOrigin", "page") as RulerOrigin,
  gridMode: "lines",
  grid: parseGrid(pref("grid", "")),
  snapTargets: parseSnapTargets(pref("snapTargets", "")),
  selectedBand: null,
  view: { grid: false, rulers: true, guides: true, margins: true, boundaries: false, diagnostics: true },
  split: false,
  bottom: null,
  migrationIssues: [],
  target: "pdf",
  sampleRows: 0,
  canvasScenario: null,
  saveState: "saved",
  capabilities: undefined,
  blocks: [],
  editingText: null,
  tableEditId: null,
  renaming: null,
  contextMenu: null,
  compareVersion: null,
  aiOpen: false,
  aiProposal: null,
  aiBusy: false,
  leftOpen: true,
  rightOpen: true,
  focusCanvas: false,
  focusRestore: null,
  engine: { problems: [] },
  engineBusy: false,
  meta: { dirty: false },
  toasts: [],
  dialog: null,
  editingDataset: null,
  dropPrompt: null,
  codeFocus: null,

  setDoc(doc, opts = {}) {
    const s = get();
    if (doc === s.doc) return;
    if (s.aiProposal) set({ aiProposal: null }); // editing by hand supersedes a pending AI proposal
    const now = Date.now();
    const coalesce = opts.coalesce && s.lastCoalesce && s.lastCoalesce.key === opts.coalesce && now - s.lastCoalesce.at < 900;
    const past = coalesce ? s.past : [...s.past, { doc: s.doc, label: summarize(diffDocs(s.doc, doc)), at: now }].slice(-100);
    set({
      doc,
      past,
      future: [],
      lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
      meta: { ...s.meta, dirty: true },
      saveState: s.saveState === "saving" ? "saving" : "dirty",
      demoHint: s.demoHint === "edit" ? "preview" : s.demoHint,
    });
    persistDraft(doc, s.sample, true);
    get().refresh();
    scheduleAutosave();
  },

  loadDoc(doc, meta = {}, sample = {}) {
    const d = ops.ensureIds(doc);
    const hasStructure = (d.sections ?? []).length > 1 || (d.groups ?? []).length > 0 || (d.sections ?? []).some((section: { children?: Comp[] }) => section.children?.length);
    const printFirst = !!d.print?.printerType && d.print.printerType !== "document";
    const blank = !hasStructure && !(d.sections ?? []).some((section: { children?: Comp[] }) => section.children?.length);
    set({ doc: d, sample, home: false, demoHint: null, selection: [], editingDataset: null, tableEditId: null, past: [], future: [], migrationIssues: d.migration?.issues ?? [], meta: { dirty: false, ...meta }, parameters: {}, target: d.print?.language ?? "pdf", leftTab: hasStructure ? "layers" : "insert", reportInspectorTab: printFirst ? "print" : "page", lastCoalesce: null, saveState: meta.dirty ? "dirty" : "saved", showPagination: false, canvasScenario: null, canvasView: blank ? "pages" : get().canvasView, fitToWidth: !blank, zoom: blank ? 0.8 : get().zoom });
    persistDraft(d, sample, meta.dirty ?? false);
    get().refresh();
    get().syncLinkedBlocks();
  },

  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ doc: prev.doc, past: s.past.slice(0, -1), future: [{ doc: s.doc, label: prev.label, at: Date.now() }, ...s.future], lastCoalesce: null, meta: { ...s.meta, dirty: true }, saveState: s.saveState === "saving" ? "saving" : "dirty" });
    persistDraft(prev.doc, s.sample, true);
    get().refresh();
  },

  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ doc: next.doc, past: [...s.past, { doc: s.doc, label: next.label, at: Date.now() }], future: s.future.slice(1), lastCoalesce: null, meta: { ...s.meta, dirty: true }, saveState: s.saveState === "saving" ? "saving" : "dirty" });
    persistDraft(next.doc, s.sample, true);
    get().refresh();
  },

  select(ids, additive = false) {
    const s = get();
    if (additive) {
      const set2 = new Set(s.selection);
      for (const id of ids) (set2.has(id) ? set2.delete(id) : set2.add(id));
      set({ selection: [...set2], selectedBand: null });
    } else set({ selection: ids, selectedBand: null });
  },

  addComponent(type, targetId, position = "after", overrides = {}, bandIndex) {
    const make = ops.PALETTE[type];
    if (!make) return "";
    return get().insertComponent({ ...make(), ...overrides }, targetId, position, bandIndex);
  },

  insertComponent(comp, targetId, position = "after", bandIndex) {
    const s = get();
    const withId: Comp = comp.id ? comp : { id: ops.genId(s.doc, comp.type), ...comp };
    const next = ops.insert(s.doc, withId, targetId, position, bandIndex === undefined ? s.selectedBand : bandIndex);
    get().setDoc(next, { coalesce: `insert:${withId.id}` });
    set({ selection: [withId.id] });
    return withId.id;
  },

  removeSelected() {
    const s = get();
    if (!s.selection.length) return;
    const ids = s.selection.filter((id) => ops.find(s.doc, id));
    if (!ids.length) return;
    disintegrate(ids);
    get().setDoc(ops.remove(s.doc, ids));
    set({ selection: [] });
    const afterDelete = get().doc;
    get().toast(ids.length === 1 ? "Deleted 1 element" : `Deleted ${ids.length} elements`, "info", {
      label: "Undo",
      // Only undo the delete itself; after other edits, Undo would revert those instead.
      run: () => (get().doc === afterDelete ? get().undo() : get().toast("Other changes were made since the delete. Use Undo in the toolbar to step back.")),
    });
  },

  duplicateSelected() {
    const s = get();
    let doc = s.doc;
    const ids: string[] = [];
    for (const id of s.selection) {
      const r = ops.duplicate(doc, id);
      doc = r.doc;
      if (r.newId) ids.push(r.newId);
    }
    get().setDoc(doc);
    set({ selection: ids });
  },

  copy() {
    const s = get();
    const comps = s.selection.map((id) => ops.find(s.doc, id)?.comp).filter(Boolean) as Comp[];
    set({ clipboard: structuredClone(comps) });
    saveClipboard(comps);
    if (comps.length) get().toast(`Copied ${comps.length} element${comps.length > 1 ? "s" : ""}`);
  },

  paste() {
    const s = get();
    if (!s.clipboard.length) return;
    let doc = s.doc;
    const ids: string[] = [];
    let target = s.selection[s.selection.length - 1];
    for (const c of s.clipboard) {
      const copy = ops.reId(doc, structuredClone(c));
      if (typeof copy.x === "number") copy.x += 10;
      if (typeof copy.y === "number") copy.y += 10;
      doc = ops.insert(doc, copy, target, "after");
      target = copy.id;
      ids.push(copy.id);
    }
    get().setDoc(doc);
    set({ selection: ids });
  },

  patch(id, patch, coalesce) {
    const s = get();
    get().setDoc(ops.update(s.doc, id, patch), { coalesce: coalesce ?? `p:${id}:${Object.keys(patch).join(",")}` });
  },

  patchStyle(id, patch, coalesce) {
    const s = get();
    get().setDoc(ops.updateStyle(s.doc, id, patch), { coalesce: coalesce ?? `s:${id}:${Object.keys(patch).join(",")}` });
  },

  nudge(dx, dy) {
    const s = get();
    let doc = s.doc;
    for (const id of s.selection) {
      const loc = ops.find(doc, id);
      if (!loc) continue;
      const layout = ops.parentLayout(doc, id);
      if (layout === "absolute" || typeof loc.comp.x === "number") {
        doc = ops.update(doc, id, { x: (Number(loc.comp.x) || 0) + dx, y: (Number(loc.comp.y) || 0) + dy });
      } else if (dy !== 0) {
        doc = ops.shift(doc, id, dy > 0 ? 1 : -1);
      }
    }
    get().setDoc(doc, { coalesce: "nudge" });
  },

  setSample(id, value) {
    const sample = { ...get().sample, [id]: value };
    set({ sample });
    persistDraft(get().doc, sample, get().meta.dirty);
    get().refresh();
  },

  clearSample(id) {
    const sample = { ...get().sample };
    if (!(id in sample)) return;
    delete sample[id];
    set({ sample });
    persistDraft(get().doc, sample, get().meta.dirty);
    get().refresh();
  },

  setParameter(id, value) {
    set({ parameters: { ...get().parameters, [id]: value } });
    get().refresh();
  },

  setMode(mode) {
    set({ mode, ...(mode !== "design" ? { tableEditId: null } : {}) });
  },

  setInterfaceTheme(theme) {
    savePref("interfaceTheme", theme);
    applyInterfaceTheme(theme);
    set({ interfaceTheme: theme });
  },

  set(partial) {
    set({ ...partial, ...(partial.mode && partial.mode !== "design" ? { tableEditId: null } : {}) } as any);
  },

  toast(text, kind = "info", action) {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, kind, text, ...(action ? { action } : {}) }] });
    // Toasts with an action stay long enough to reach the button.
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === "error" || action ? 6000 : 2800);
  },

  async refresh() {
    clearTimeout(timer);
    const run = ++engineRun;
    set({ engineBusy: true });
    timer = setTimeout(async () => {
      const { doc: realDoc, aiProposal, sample: realSample, parameters, sampleRows, target, capabilities, ghosts, canvasScenario } = get();
      // While an AI proposal awaits approval the canvas shows the proposed result; nothing is committed until Accept.
      const doc = aiProposal?.doc ?? realDoc;
      const sample = scenarioSample(doc, realSample, canvasScenario);
      const result = await runEngine(doc, sample, parameters, { sampleRows, target, capabilities, ghosts }, (estimate) => {
        if (run === engineRun && estimate.paginated) set({ engine: estimate, engineDoc: aiProposal ? undefined : doc });
      });
      if (run === engineRun) {
        // On a schema/engine error keep showing the last good render, with fresh problems alongside it.
        const prev = get().engine;
        // A layout of an AI proposal is not a layout of `doc`, so no optimistic deltas apply to it.
        set(result.paginated ? { engine: result, engineDoc: aiProposal ? undefined : doc, engineBusy: false } : { engine: { ...prev, problems: result.problems }, engineBusy: false });
      }
    }, 60);
  },

  async save() {
    const s = get();
    if (s.saveState === "saving") return;
    set({ saveState: "saving" });
    try {
      if (s.embedded && s.embeddedSaveMode === "host") {
        await saveDefinitionToHost(s.doc);
        if (get().doc === s.doc) {
          set({ meta: { ...get().meta, dirty: false }, saveState: "saved" });
          persistDraft(s.doc, s.sample, false);
          get().toast("Report saved in the host application.", "success");
        } else {
          set({ saveState: "dirty" });
          get().toast("A newer edit was made while saving. Save again to include it.", "info");
        }
        return;
      }
      const id = s.meta.id ?? s.doc.id;
      let rec;
      if (s.meta.id) rec = await api.saveTemplate(id, s.doc.name, s.doc);
      else {
        try {
          rec = await api.createTemplate(id, s.doc.name, s.doc);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) rec = await api.saveTemplate(id, s.doc.name, s.doc);
          else throw e;
        }
      }
      set({ meta: { id: rec.id, version: rec.currentVersion, status: rec.status, dirty: false }, saveState: "saved" });
      persistDraft(s.doc, s.sample, false);
      // Say what Save did: a draft version on this server, not live until published, and on the demo, shared.
      get().toast(
        isPublicDemo()
          ? `Saved draft version ${rec.currentVersion} on the public demo server. Every visitor can open it and it may be reset: export the report file to keep a copy.`
          : `Saved draft version ${rec.currentVersion}. Publish it when the report viewer and API should use it.`,
        "success",
        isPublicDemo() ? { label: "Export file", run: () => downloadReportFile(get().doc) } : undefined,
      );
    } catch (e) {
      set({ saveState: "error" });
      get().toast((e as Error).message, "error");
    }
  },

  async publish(notes) {
    const s = get();
    if (s.embedded && s.embeddedSaveMode === "host") {
      get().toast("Save this report to your application. Your application manages publishing and version history.", "info");
      return false;
    }
    if (s.meta.dirty || !s.meta.id) await get().save();
    const m = get().meta;
    if (!m.id || !m.version || m.dirty || get().saveState === "error") return false;
    try {
      await api.publish(m.id, m.version, notes);
      set({ meta: { ...m, status: "published" } });
      get().toast(`Published version ${m.version}`, "success");
      return true;
    } catch (e) {
      get().toast((e as Error).message, "error");
      return false;
    }
  },

  async openTemplate(id) {
    requestReplaceReport(async () => {
      try {
        const tpl = await api.getTemplate(id);
        const version = await api.getVersion(id, tpl.currentVersion);
        get().loadDoc(version.definition, { id: tpl.id, version: tpl.currentVersion, status: version.status, dirty: false });
        set({ dialog: null });
      } catch (e) {
        get().toast((e as Error).message, "error");
      }
    });
  },

  openCode(id) {
    set({ mode: "code", codeFocus: { id, nonce: Date.now() } });
  },

  groupSelected() {
    const s = get();
    if (s.selection.length < 2) return;
    const r = ops.group(s.doc, s.selection);
    if (!r.id) return get().toast("Select elements that share the same parent to group them");
    get().setDoc(r.doc);
    set({ selection: [r.id] });
  },

  ungroupSelected() {
    const s = get();
    const id = s.selection[0];
    if (!id) return;
    const r = ops.ungroup(s.doc, id);
    if (r.ids.length) {
      get().setDoc(r.doc);
      set({ selection: r.ids });
    }
  },

  toggleLock(id) {
    const s = get();
    for (const t of id ? [id] : s.selection) {
      const c = ops.find(get().doc, t)?.comp;
      if (c) get().setDoc(ops.setLocked(get().doc, [t], !c.locked));
    }
  },

  toggleHide(id) {
    const s = get();
    for (const t of id ? [id] : s.selection) {
      const c = ops.find(get().doc, t)?.comp;
      if (c) get().setDoc(ops.setHidden(get().doc, [t], !c.hidden));
    }
  },

  rename(id, name) {
    get().setDoc(ops.update(get().doc, id, { name: name || undefined }));
  },

  restore(index) {
    const s = get();
    const entry = s.past[index];
    if (!entry) return;
    get().setDoc(entry.doc);
    get().toast("Restored an earlier state - Undo brings back your latest edits");
  },

  async loadCapabilities() {
    try {
      const capabilities = await api.capabilities();
      set({ capabilities });
      get().refresh();
      await loadCanvasFonts(capabilities);
      set({ capabilities: { ...capabilities } });
    } catch {
      /* server unavailable: capability checks are skipped */
    }
  },

  async loadBlocks() {
    try {
      set({ blocks: (await api.listBlocks()).map((block) => ({ ...block, version: block.version ?? 1 })) as Block[] });
      get().syncLinkedBlocks();
    } catch {
      /* ignore */
    }
  },

  syncLinkedBlocks() {
    const s = get();
    if (!s.blocks.length || !s.doc.fragments?.length) return;
    const { doc, updated } = syncLinkedBlocks(s.doc, s.blocks);
    if (!updated.length) return;
    s.setDoc(doc);
    s.toast(`Updated linked block${updated.length === 1 ? "" : "s"} to the latest version: ${updated.join(", ")}`, "info");
  },

  async saveBlock(name, notes) {
    const s = get();
    const comps = s.selection.map((id) => ops.find(s.doc, id)?.comp).filter(Boolean) as Comp[];
    if (!comps.length) return;
    try {
      const version = await api.putBlock(blockIdFor(name), name, structuredClone(comps), notes);
      await get().loadBlocks();
      get().toast(`Saved "${name}"${version ? ` as version ${version}` : ""} to My Components`, "success");
    } catch (e) {
      get().toast((e as Error).message, "error");
    }
  },

  insertBlock(id, mode = (pref("blockMode", "linked") as BlockMode)) {
    const s = get();
    const b = s.blocks.find((x) => x.id === id);
    if (!b) return;
    const { doc, ids } = placeBlock(s.doc, b, mode, s.selection[s.selection.length - 1]);
    get().setDoc(doc);
    set({ selection: ids });
  },

  acceptAi() {
    const p = get().aiProposal;
    if (!p) return;
    set({ aiProposal: null });
    get().setDoc(ops.ensureIds(p.doc));
    get().toast("Applied the AI change - Undo restores your previous version", "success");
  },

  rejectAi() {
    if (!get().aiProposal) return;
    set({ aiProposal: null });
    get().refresh();
  },
}));
