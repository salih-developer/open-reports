import type { BlockMode } from "../lib/blocks";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { savePref, useStore } from "../store";
import * as ops from "../model/ops";
import { datasetFields, datasetIsArray, fieldSample, filterFields, type FieldNode } from "../lib/fields";
import { candidatesFor, FUNCTION_CANDIDATES } from "../lib/bindings";
import { titleCase } from "../lib/lowcode";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { explorerTree, type ExplorerNode } from "../lib/explorer-tree";
import { searchExplorer, type ExplorerSearch } from "../lib/explorer-search";

interface PaletteItem {
  type: string;
  label: string;
  group: string;
  keywords?: string;
  overrides?: Record<string, any>;
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { type: "text", label: "Text", group: "Basic", keywords: "label heading paragraph" },
  { type: "image", label: "Image", group: "Basic", keywords: "logo picture photo" },
  { type: "line", label: "Line", group: "Basic", keywords: "divider rule" },
  { type: "rectangle", label: "Rectangle", group: "Basic", keywords: "shape box border" },
  { type: "spacer", label: "Spacer", group: "Basic", keywords: "gap space" },
  { type: "container", label: "Container", group: "Layout", keywords: "group box" },
  { type: "row", label: "Row", group: "Layout", keywords: "horizontal columns side by side" },
  { type: "column", label: "Column", group: "Layout", keywords: "vertical stack" },
  { type: "grid", label: "Grid", group: "Layout", keywords: "columns cells" },
  { type: "table", label: "Table", group: "Data", keywords: "rows columns list items" },
  { type: "subreport", label: "Subreport", group: "Data", keywords: "nested report reusable report header footer" },
  { type: "repeater", label: "Repeater", group: "Data", keywords: "list loop each" },
  { type: "crosstab", label: "Crosstab", group: "Data", keywords: "pivot matrix cross tab summary totals" },
  { type: "qrcode", label: "QR Code", group: "Print", keywords: "barcode 2d scan" },
  { type: "barcode", label: "Barcode", group: "Print", keywords: "code128 ean scan" },
  { type: "pageBreak", label: "Page break", group: "Print", keywords: "new page" },
  { type: "labelSheet", label: "Label sheet", group: "Print", keywords: "stickers avery a4 sheet labels n-up grid" },
  { type: "chart", label: "Bar chart", group: "Charts", keywords: "graph", overrides: { chartType: "bar" } },
  { type: "chart", label: "Line chart", group: "Charts", keywords: "graph trend", overrides: { chartType: "line" } },
  { type: "chart", label: "Pie chart", group: "Charts", keywords: "graph share", overrides: { chartType: "pie" } },
];

/** Keep native disclosure menus easy to dismiss with either Escape or an outside click. */
function useDismissibleDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => {
      const details = ref.current;
      if (details?.open) {
        details.open = false;
        details.querySelector<HTMLElement>("summary")?.focus();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ref.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) {
        ref.current.open = false;
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  return ref;
}

export const BAND_DESCRIPTIONS: Record<string, string> = {
  reportHeader: "Appears once at the start of the report.",
  pageHeader: "Repeats at the top of every printed page.",
  dataHeader: "Appears once before the data rows, often for column labels.",
  groupHeader: "Appears before each group of matching records.",
  detail: "Repeats once for every record in your data.",
  child: "Adds related content below its parent section.",
  groupFooter: "Appears after each group of matching records.",
  dataFooter: "Appears once after all data rows.",
  noData: "Appears when the report has no records to show.",
  reportFooter: "Appears once at the very end of the report.",
  pageFooter: "Repeats at the bottom of every printed page.",
  background: "Sits behind the content on every printed page.",
};

export function insertFromPalette(item: PaletteItem) {
  const s = useStore.getState();
  const last = s.selection[s.selection.length - 1];
  const loc = last ? ops.find(s.doc, last) : undefined;
  const container = loc && (ops.CONTAINER_TYPES as readonly string[]).includes(loc.comp.type) && loc.comp.type !== "group";
  s.addComponent(item.type, last, container ? "inside" : "after", item.overrides);
}

export const SECTION_GROUPS: { label: string; types: readonly string[] }[] = [
  { label: "Page layout", types: ["pageHeader", "pageFooter", "background"] },
  { label: "Report flow", types: ["reportHeader", "detail", "reportFooter", "noData"] },
  { label: "Data sections", types: ["dataHeader", "dataFooter", "groupHeader", "groupFooter", "child"] },
];
/** Adds a report section (band) and selects it; returns its index, or undefined when it needs more setup first. */
export function addReportSection(type: string): number | undefined {
  const st = useStore.getState();
  const props: Record<string, any> = {};
  if (type === "groupHeader" || type === "groupFooter") {
    if (!(st.doc.groups ?? []).length) return void st.set({ dialog: "group" });
    props.groupId = st.doc.groups[0].id;
  }
  if (type === "child") {
    const parent = st.selectedBand === null ? undefined : st.doc.sections[st.selectedBand];
    if (!parent?.id) return void st.toast("Select a named parent band before adding a child band", "info");
    props.parent = parent.id;
  }
  const result = ops.addBand(st.doc, type, props);
  st.setDoc(result.doc);
  st.set({ selectedBand: result.index, selection: [], rightOpen: true, leftTab: "layers", leftOpen: true });
  return result.index;
}

function ReportSectionsPalette({ query }: { query: string }) {
  const visible = SECTION_GROUPS.map((group) => ({
    ...group,
    types: group.types.filter((type) => `${ops.BAND_TITLES[type]} ${group.label} section band`.toLowerCase().includes(query.toLowerCase())),
  })).filter((group) => group.types.length);
  if (!visible.length) return null;
  return <section className="palette-group report-sections-palette" data-testid="report-sections-palette">
    <div className="group-title">Report sections</div>
    <p className="muted small">Add a section first, then add components inside it. Headers and footers are report sections.</p>
    {visible.map((group) => <div className="report-section-group" key={group.label}>
      <div className="report-section-label">{group.label}</div>
      <div className="report-section-actions">{group.types.map((type) => <button type="button" key={type} data-testid={`palette-section-${type}`} title={BAND_DESCRIPTIONS[type]} onClick={() => addReportSection(type)}>
        <span className="report-section-code">{ops.BAND_CODES[type]}</span><span className="report-section-copy"><strong>{ops.BAND_TITLES[type]}</strong><small>{BAND_DESCRIPTIONS[type]}</small></span><span className="report-section-add" aria-hidden="true">+</span>
      </button>)}</div>
    </div>)}
  </section>;
}

function PluginComponents({ q }: { q: string }) {
  const list = (useStore((s) => s.capabilities?.customComponents) ?? []).filter((c) => `${c.kind} ${c.description ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  if (!list.length) return null;
  return (
    <div className="palette-group" data-testid="plugin-components">
      <div className="group-title">Plugins</div>
      {list.map((c) => (
        <div key={c.kind} className="block-row">
          <button
            className="block-item"
            title={c.description}
            data-testid={`plugin-${c.kind}`}
            onClick={() => {
              const s = useStore.getState();
              const last = s.selection[s.selection.length - 1];
              s.insertComponent({ type: "custom", kind: c.kind, props: Object.fromEntries(Object.keys(c.props ?? {}).map((k) => [k, ""])) } as any, last, "after");
            }}
          >
            <Icon name="group" small />
            <span>{c.kind}</span>
            <span className="muted small">previews in Preview</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function BlocksSection({ q }: { q: string }) {
  const blocks = useStore((s) => s.blocks);
  const [mode, setMode] = useState<BlockMode>(() => {
    try { return (localStorage.getItem("designer.blockMode") as BlockMode) || "linked"; } catch { return "linked"; }
  });
  const filtered = blocks.filter((b) => b.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="palette-group" data-testid="my-components">
      <div className="group-title row-title">
        My Components
        <button className="mini" data-testid="save-block" title="Save the current selection as a reusable component" disabled={false} onClick={() => (useStore.getState().selection.length ? useStore.getState().set({ dialog: "block" }) : useStore.getState().toast("Select something on the canvas first"))}>
          + Save selection
        </button>
      </div>
      {filtered.length === 0 && <p className="muted small">Save headers, letterheads, signature blocks and totals once - reuse them in every report.</p>}
      {filtered.length > 0 && <label className="block-mode" title="Linked blocks follow new versions of the block; pinned blocks stay on the version you insert; a copy can be edited freely in this report.">
        Insert as{" "}
        <select data-testid="block-insert-mode" aria-label="Insert library blocks as" value={mode} onChange={(e) => { savePref("blockMode", e.target.value); setMode(e.target.value as BlockMode); }}>
          <option value="linked">Linked (follows updates)</option>
          <option value="pinned">Pinned to this version</option>
          <option value="detached">Editable copy</option>
        </select>
      </label>}
      {filtered.map((b) => (
        <div key={b.id} className="block-row">
          <button className="block-item" data-testid={`block-${b.id}`} onClick={() => useStore.getState().insertBlock(b.id, mode)}>
            <Icon name="group" small />
            <span>{b.name}</span>
            <span className="muted small">v{b.version}</span>
          </button>
          <button
            className="mini danger"
            aria-label={`Delete ${b.name}`}
            onClick={async () => {
              await api.deleteBlock(b.id);
              useStore.getState().loadBlocks();
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Tables, repeaters and crosstabs show rows only from data, so say so before an empty one is dropped. */
function DataFirstNote() {
  const hasData = useStore((s) => (s.doc.datasets?.length ?? 0) > 0);
  const set = useStore((s) => s.set);
  if (hasData) return null;
  return <div className="data-first" data-testid="data-first-note">
    <p><strong>No data yet.</strong> Tables, repeaters and crosstabs fill their rows from data: add it first, then drop them in.</p>
    <div className="data-first-actions">
      <button type="button" className="btn primary" data-testid="data-first-add" onClick={() => set({ dialog: "dataset", editingDataset: null })}>Add data</button>
      <button type="button" className="btn" data-testid="data-first-json" onClick={() => set({ dialog: "generate" })}>Paste sample JSON</button>
    </div>
  </div>;
}

function InsertTab() {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const filtered = PALETTE_ITEMS.filter((i) => `${i.label} ${i.group} ${i.keywords ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    const map = new Map<string, PaletteItem[]>();
    for (const i of filtered) map.set(i.group, [...(map.get(i.group) ?? []), i]);
    return [...map.entries()];
  }, [q]);
  return (
    <div className="tab-body">
      <input className="search" placeholder="Search components or sections..." aria-label="Search components or report sections" value={q} onChange={(e) => setQ(e.target.value)} />
      <ReportSectionsPalette query={q.trim()} />
      {groups.map(([g, items]) => (
        <div key={g} className="palette-group">
          <div className="group-title">{g}</div>
          {g === "Data" && <DataFirstNote />}
          <div className="palette-grid">
            {items.map((i) => (
              <button
                key={i.label}
                className="palette-item"
                draggable
                data-testid={`palette-${i.label.toLowerCase().replace(/\s+/g, "-")}`}
                title={`Add ${i.label} (click, or drag onto the page)`}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-rpt", JSON.stringify({ kind: "component", type: i.type }));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => insertFromPalette(i)}
              >
                <Icon name={i.type === "chart" ? `chart-${i.overrides?.chartType}` : i.type} />
                <span>{i.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <PluginComponents q={q} />
      <BlocksSection q={q} />
      {groups.length === 0 && !SECTION_GROUPS.some((group) => group.types.some((type) => `${ops.BAND_TITLES[type]} ${group.label} section band`.toLowerCase().includes(q.toLowerCase()))) && <p className="muted">No components or report sections match "{q}".</p>}
    </div>
  );
}

function FieldRow({ node, dsId, arrayRoot, depth, parentIsArray, searching }: { node: FieldNode; dsId: string; arrayRoot?: string; depth: number; parentIsArray: boolean; searching: boolean }) {
  const [open, setOpen] = useState(depth < 1);
  const isArray = node.kind === "array";
  const isObj = node.kind === "object";
  const canDrag = !isObj;
  const ref = `${dsId}.${node.path}`;
  const expanded = searching || open;
  const example = fieldSample(node.sample);
  const rowPath = `row.${node.path.split(".").slice(arrayRoot ? arrayRoot.split(".").length : 0).join(".")}`;
  const rowDataset = arrayRoot ? `${dsId}.${arrayRoot}` : dsId;
  const payload = isArray
    ? parentIsArray ? { kind: "array", ref, rowRef: rowPath, rowDataset } : { kind: "array", ref }
    : parentIsArray
      ? { kind: "field", binding: rowPath, name: node.name, fieldKind: node.kind, rowDataset }
      : { kind: "field", binding: `data.${dsId}.${node.path}`, name: node.name, fieldKind: node.kind };
  return (
    <div className="data-tree">
      <div
        className={`field-row kind-${node.kind}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={canDrag}
        data-testid={`field-${dsId}-${node.path}`}
        onDragStart={(e) => {
          e.dataTransfer.setData("application/x-rpt", JSON.stringify(payload));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => (isObj || isArray) && setOpen(!open)}
        title={`${node.path} · ${node.kind}${example ? ` · Sample: ${example}` : ""}${isArray ? parentIsArray ? " · Drag into a row of its parent list to show each record's own list (or anywhere to list both)" : " · Drag to choose Table, Repeater, or Cards" : !isObj ? " · Drag to bind" : ""}`}
      >
        <span className="twisty">{isObj || isArray ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="field-icon">{isArray ? "[]" : isObj ? "{}" : node.kind === "number" ? "#" : node.kind === "date" ? "d" : node.kind === "boolean" ? "b" : "a"}</span>
        <span className="field-copy">
          <span className="field-label-line"><span className="field-name">{titleCase(node.name)}</span><span className="field-type">{node.kind}</span></span>
          {example && <span className="field-sample">{example}</span>}
        </span>
      </div>
      {expanded && node.children?.map((c) => <FieldRow key={c.path} node={c} dsId={dsId} arrayRoot={isArray ? node.path : arrayRoot} depth={depth + 1} parentIsArray={isArray || parentIsArray} searching={searching} />)}
    </div>
  );
}

function DataTab() {
  const { doc, sample, parameters } = useStore();
  const set = useStore((s) => s.set);
  const [query, setQuery] = useState("");
  const searching = Boolean(query.trim());
  const datasets: any[] = doc.datasets ?? [];
  const params: any[] = doc.parameters ?? [];
  let visibleDatasets = 0;
  return (
    <div className="tab-body">
      <div className="group-title row-title">
        Datasets
        <button className="mini" data-testid="add-dataset" onClick={() => set({ dialog: "dataset", editingDataset: null })}>
          + Add
        </button>
      </div>
      {datasets.length === 0 && <div className="data-first" data-testid="data-empty-state">
        <p><strong>No data connected.</strong> Add data to fill tables and show live values in your report.</p>
        <div className="data-first-actions">
          <button type="button" className="btn primary" data-testid="data-tab-add-dataset" onClick={() => set({ dialog: "dataset", editingDataset: null })}>Add dataset</button>
          <button type="button" className="btn" data-testid="data-tab-paste-json" onClick={() => set({ dialog: "generate" })}>Paste sample JSON</button>
        </div>
      </div>}
      {datasets.length > 0 && <input className="search" type="search" aria-label="Search fields" placeholder="Search fields or paths…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      {datasets.map((ds) => {
        const datasetMatches = searching && `${ds.id} ${ds.source}`.toLowerCase().includes(query.trim().toLowerCase());
        const fields = filterFields(datasetFields(doc, sample, ds.id), query, datasetMatches);
        const isArray = datasetIsArray(doc, sample, ds.id);
        if (searching && !datasetMatches && fields.length === 0) return null;
        visibleDatasets += 1;
        return (
          <div key={ds.id} className="dataset" data-testid={`dataset-${ds.id}`}>
            <div className="dataset-head">
              <span className="ds-name">{ds.id}</span>
              <span className="badge">{ds.source}</span>
              <span className="spacer" />
              <button className="mini" aria-label={`Edit ${ds.id}`} onClick={() => set({ dialog: "dataset", editingDataset: ds.id })}>
                Edit
              </button>
              <button
                className="mini danger"
                aria-label={`Delete ${ds.id}`}
                onClick={() => useStore.getState().setDoc({ ...doc, datasets: datasets.filter((d) => d.id !== ds.id) })}
              >
                ×
              </button>
            </div>
            {isArray && (
              <div
                className="field-row kind-array"
                draggable
                data-testid={`array-${ds.id}`}
                onDragStart={(e) => e.dataTransfer.setData("application/x-rpt", JSON.stringify({ kind: "array", ref: ds.id }))}
                title="Drag onto the page to choose Table, Repeater, or Cards"
              >
                <span className="field-icon">[]</span>
                <span className="field-name">{titleCase(ds.id)} rows</span>
                <span className="badge">drag</span>
              </div>
            )}
            {fields.map((f) => (
              <FieldRow key={f.path} node={f} dsId={ds.id} depth={0} parentIsArray={isArray} arrayRoot={isArray ? "" : undefined} searching={searching} />
            ))}
            {!searching && fields.length === 0 && <p className="muted small">No fields yet. Open Edit to define fields or preview data.</p>}
          </div>
        );
      })}
      {searching && visibleDatasets === 0 && <p className="muted" role="status">No fields match “{query}”.</p>}

      <div className="group-title row-title">
        Parameters
        <button className="mini" data-testid="add-parameter" onClick={() => useStore.getState().setDoc({ ...doc, parameters: [...params, { id: `param${params.length + 1}`, type: "string", required: false }] })}>
          + Add
        </button>
      </div>
      {params.map((p, i) => (
        <div key={i} className="param-row">
          <input aria-label="Parameter id" value={p.id} onChange={(e) => update(i, { id: e.target.value })} />
          <select aria-label="Parameter type" value={p.type} onChange={(e) => update(i, { type: e.target.value })}>
            {["string", "number", "boolean", "date", "datetime", "array", "object", "enum"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input aria-label="Sample value" placeholder="sample" value={String(parameters[p.id] ?? p.default ?? "")} onChange={(e) => useStore.getState().setParameter(p.id, e.target.value)} />
          <span draggable className="field-icon drag" title="Drag onto the page" onDragStart={(e) => e.dataTransfer.setData("application/x-rpt", JSON.stringify({ kind: "field", binding: `params.${p.id}`, name: p.id, fieldKind: "string" }))}>
            ⠿
          </span>
          <button className="mini danger" aria-label="Remove parameter" onClick={() => useStore.getState().setDoc({ ...doc, parameters: params.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <div className="group-title">Variables</div>
      {(doc.variables ?? []).map((v: any, i: number) => (
        <div key={i} className="param-row var">
          <input aria-label="Variable id" value={v.id} onChange={(e) => updateVar(i, { id: e.target.value })} />
          <select aria-label="Scope" value={v.scope} onChange={(e) => updateVar(i, { scope: e.target.value, ...(e.target.value === "row" ? {} : { resetOn: undefined }) })}>
            {["report", "group", "row", "page"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input aria-label="Variable expression" className="mono" placeholder="expression" value={v.expression} onChange={(e) => updateVar(i, { expression: e.target.value })} />
          {v.scope === "row" && (doc.groups ?? []).length > 0 && <select aria-label="Reset on" title="Restart this running value at each instance of a group" value={v.resetOn ?? ""} onChange={(e) => updateVar(i, { resetOn: e.target.value || undefined })}>
            <option value="">Never reset</option>
            {(doc.groups ?? []).map((g: any) => <option key={g.id} value={g.id}>{`Reset per ${g.id}`}</option>)}
          </select>}
          <button className="mini danger" aria-label="Remove variable" onClick={() => useStore.getState().setDoc({ ...doc, variables: (doc.variables ?? []).filter((_: any, j: number) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <button className="mini" onClick={() => useStore.getState().setDoc({ ...doc, variables: [...(doc.variables ?? []), { id: `var${(doc.variables ?? []).length + 1}`, scope: "report", expression: "0" }] })}>
        + Add variable
      </button>
    </div>
  );

  function update(i: number, patch: Record<string, any>) {
    const s = useStore.getState();
    s.setDoc({ ...s.doc, parameters: (s.doc.parameters ?? []).map((p: any, j: number) => (j === i ? { ...p, ...patch } : p)) }, { coalesce: `param${i}` });
  }
  function updateVar(i: number, patch: Record<string, any>) {
    const s = useStore.getState();
    s.setDoc({ ...s.doc, variables: (s.doc.variables ?? []).map((p: any, j: number) => (j === i ? { ...p, ...patch } : p)) }, { coalesce: `var${i}` });
  }
}

function LayerRow({ comp, depth, search }: { comp: ops.Comp; depth: number; search?: ExplorerSearch }) {
  const selection = useStore((s) => s.selection);
  const editingText = useStore((s) => s.renaming);
  const [open, setOpen] = useState(true);
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState("");
  const [valueSuggestions, setValueSuggestions] = useState<{ value: string; label: string }[]>([]);
  const valueInput = useRef<HTMLInputElement>(null);
  const cancelValueEdit = useRef(false);
  const kids = ops.CHILD_LISTS.flatMap((k) => (Array.isArray(comp[k]) ? (comp[k] as ops.Comp[]) : []));
  const searching = !!search;
  const expanded = searching || open;
  const selected = selection.includes(comp.id);
  const renaming = editingText === comp.id;
  const valueKey = comp.binding !== undefined ? "binding" : comp.expression !== undefined ? "expression" : "value";
  const canEditValue = ["text", "field", "qrcode", "barcode"].includes(comp.type);
  const displayedValue = String((comp as any)[valueKey] ?? "");
  const rowLabel = comp.name ?? (canEditValue ? displayedValue || ops.layerName(comp) : ops.layerName(comp));
  const fullLayerLabel = String(comp.name ?? (canEditValue ? (comp as any).binding ?? (comp as any).expression ?? (comp as any).value ?? ops.layerName(comp) : ops.layerName(comp)));
  const st = useStore.getState;
  const beginValueEdit = () => {
    if (!canEditValue) return;
    setValueDraft(displayedValue);
    const state = useStore.getState();
    const candidates = candidatesFor(state.doc, state.sample, comp.id);
    setValueSuggestions([...candidates, ...FUNCTION_CANDIDATES].map(({ value, label }) => ({ value, label })));
    cancelValueEdit.current = false;
    setEditingValue(true);
    requestAnimationFrame(() => valueInput.current?.focus());
  };
  const finishValueEdit = () => {
    if (cancelValueEdit.current) { cancelValueEdit.current = false; return; }
    if (valueDraft !== displayedValue) st().patch(comp.id, { [valueKey]: valueDraft }, `layer-value:${comp.id}`);
    setEditingValue(false);
  };
  const openActions = (x: number, y: number) => {
    if (!st().selection.includes(comp.id)) st().select([comp.id]);
    st().set({ contextMenu: { x, y, id: comp.id } });
  };
  if (search && !search.components.has(comp.id)) return null;
  return (
    <div>
      <div
        className={`layer explorer-row ${selected ? "selected" : ""} ${comp.hidden ? "is-hidden" : ""} ${search?.matchedComponents.has(comp.id) ? "search-match" : ""}`}
        style={{ paddingLeft: `calc(8px + ${depth} * var(--explorer-indent))` }}
        data-depth={depth}
        draggable={!comp.locked && !searching}
        data-testid={`layer-${comp.id}`}
        data-explorer-entry=""
        data-explorer-match={search?.matchedComponents.has(comp.id) ? "" : undefined}
        role="button"
        tabIndex={0}
        aria-label={`${ops.layerName(comp)}${comp.locked ? ", locked" : ""}${comp.hidden ? ", hidden" : ""}`}
        aria-expanded={kids.length || comp.type === "table" ? expanded : undefined}
        onClick={(e) => st().select([comp.id], e.shiftKey)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); st().select([comp.id], e.shiftKey); }
          else if (e.key === "F2") { e.preventDefault(); st().set({ renaming: comp.id }); }
          else if (!searching && e.key === "ArrowRight" && !open) { e.preventDefault(); setOpen(true); }
          else if (!searching && e.key === "ArrowLeft" && open) { e.preventDefault(); setOpen(false); }
          else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); openActions(rect.right, rect.bottom); }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openActions(e.clientX, e.clientY);
        }}
        onDoubleClick={() => st().set({ renaming: comp.id })}
        onDragStart={(e) => e.dataTransfer.setData("application/x-layer", comp.id)}
        onDragOver={(e) => !searching && e.dataTransfer.types.includes("application/x-layer") && e.preventDefault()}
        onDrop={(e) => {
          if (searching) return;
          const id = e.dataTransfer.getData("application/x-layer");
          if (!id) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const rel = (e.clientY - rect.top) / rect.height;
          const isContainer = (ops.CONTAINER_TYPES as readonly string[]).includes(comp.type);
          const s = st();
          s.setDoc(ops.move(s.doc, id, comp.id, isContainer && rel > 0.3 && rel < 0.7 ? "inside" : rel < 0.5 ? "before" : "after"));
        }}
      >
        <span className="twisty" onClick={(e) => { e.stopPropagation(); if (!searching) setOpen(!open); }}>{kids.length || comp.type === "table" ? (expanded ? "▾" : "▸") : ""}</span>
        <Icon name={comp.type} small />
        {renaming ? (
          <input
            className="layer-rename"
            data-testid="layer-rename"
            autoFocus
            defaultValue={comp.name ?? ops.layerName(comp)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => (st().rename(comp.id, e.target.value.trim() === ops.layerName({ ...comp, name: undefined }) ? "" : e.target.value.trim()), st().set({ renaming: null }))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") st().set({ renaming: null });
            }}
          />
        ) : editingValue ? (
          <input
            ref={valueInput}
            className="layer-value-edit mono"
            data-testid={`layer-value-${comp.id}`}
            aria-label={`Edit data value for ${ops.layerName(comp)}`}
            list={`layer-value-suggestions-${comp.id}`}
            title="Type a field path or expression; press the down arrow to choose a suggestion"
            value={valueDraft}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setValueDraft(event.target.value)}
            onBlur={finishValueEdit}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === "Escape") { event.preventDefault(); cancelValueEdit.current = true; setEditingValue(false); }
            }}
          />
        ) : (
          <span className="layer-name" title={fullLayerLabel}>{rowLabel}</span>
        )}
        <span className="layer-actions">
          {canEditValue && <button className="layer-edit-value" type="button" aria-label={`Edit data value for ${ops.layerName(comp)}`} title="Edit data field or expression" data-testid={`layer-edit-value-${comp.id}`} onClick={(event) => { event.stopPropagation(); if (!selected) st().select([comp.id]); beginValueEdit(); }}>✎</button>}
          {comp.locked && <span title="Layout locked"><Icon name="lock" small /></span>}
          {comp.hidden && <span title="Hidden from output"><Icon name="hidden" small /></span>}
        </span>
        <button className="layer-end explorer-more" type="button" aria-label={`Actions for ${ops.layerName(comp)}`} title="Element actions" data-testid={`layer-actions-${comp.id}`} onClick={(e) => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); openActions(rect.right, rect.bottom); }}>⋯</button>
      </div>
      {editingValue && <datalist id={`layer-value-suggestions-${comp.id}`}>
        {valueSuggestions.map((suggestion) => <option key={suggestion.value} value={suggestion.value} label={suggestion.label} />)}
      </datalist>}
      {expanded && !searching && comp.type === "table" && (
        <>
          {[
            comp.showHeader !== false ? "H  Header" : null,
            "D  Detail rows",
            comp.showFooter ? "F  Footer" : null,
          ]
            .filter(Boolean)
            .map((label) => (
              <div key={label as string} className="layer explorer-row pseudo" style={{ paddingLeft: `calc(8px + ${depth + 1} * var(--explorer-indent))` }} data-depth={depth + 1} onClick={() => st().select([comp.id])}>
                <span className="twisty" />
                <span className="layer-type">▤</span>
                <span className="layer-name muted">{label}</span>
                <span className="layer-actions" />
                <span className="layer-end" aria-hidden="true" />
              </div>
            ))}
        </>
      )}
      {expanded && kids.map((k) => <LayerRow key={k.id} comp={k} depth={depth + 1} search={search} />)}
    </div>
  );
}


function ExplorerBand({ index, depth, search, overview }: { index: number; depth: number; search?: ExplorerSearch; overview: boolean }) {
  const doc = useStore((state) => state.doc);
  const menuRef = useDismissibleDetails();
  const selection = useStore((state) => state.selection);
  const selectedBand = useStore((state) => state.selectedBand);
  const sections: any[] = doc.sections ?? [];
  const i = index;
  const s = sections[i];
  const [open, setOpen] = useState(!overview && !s?.collapsed);
  const selectedHere = selection.some((id) => ops.bandIndexOf(doc, id) === i);
  useEffect(() => { if (selectedHere) setOpen(true); }, [selectedHere]);
  if (!s || (search && !search.bands.has(i))) return null;
  const searching = !!search;
  const expanded = searching || open;
  const bandName = s.name ?? (s.type === "groupHeader" ? "Header" : s.type === "groupFooter" ? "Footer" : ops.BAND_TITLES[s.type] ?? s.type);
  return (
        <div>
          <div
            className={`layer explorer-row section ${selectedBand === i ? "selected" : ""} ${s.hidden ? "is-hidden" : ""} ${search?.matchedBands.has(i) ? "search-match" : ""}`}
            data-testid={`section-${s.type}`}
            data-explorer-entry=""
            data-explorer-match={search?.matchedBands.has(i) ? "" : undefined}
            data-band-index={i}
            data-depth={depth}
            style={{ paddingLeft: `calc(8px + ${depth} * var(--explorer-indent))` }}
            title={`${bandName}: ${BAND_DESCRIPTIONS[s.type] ?? "Report section."}`}
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            draggable={!s.locked && !searching}
            onClick={() => useStore.getState().set({ selectedBand: i, selection: [], rightOpen: true })}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); useStore.getState().set({ selectedBand: i, selection: [], rightOpen: true }); }
              else if (!searching && e.key === "ArrowRight" && !open) { e.preventDefault(); setOpen(true); }
              else if (!searching && e.key === "ArrowLeft" && open) { e.preventDefault(); setOpen(false); }
              else if (e.key === "F2") { e.preventDefault(); useStore.getState().set({ selectedBand: i, selection: [], rightOpen: true }); requestAnimationFrame(() => (document.querySelector('[data-testid="band-name"]') as HTMLInputElement | null)?.focus()); }
              else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); e.currentTarget.querySelector<HTMLDetailsElement>(".explorer-menu")?.setAttribute("open", ""); }
            }}
            onDragStart={(e) => {
              if (s.locked) { e.preventDefault(); return; }
              e.dataTransfer.setData("text/band", String(i));
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (s.locked || searching) return;
              if (e.dataTransfer.types.includes("text/band")) e.preventDefault();
              if (e.dataTransfer.types.includes("application/x-layer")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (s.locked || searching) return;
              const bandFrom = e.dataTransfer.getData("text/band");
              if (bandFrom !== "") {
                e.preventDefault();
                const st = useStore.getState();
                const next = ops.moveBand(st.doc, Number(bandFrom), i);
                if (next) {
                  st.setDoc(next);
                  st.set({ selectedBand: i });
                }
                return;
              }
              const id = e.dataTransfer.getData("application/x-layer");
              if (!id) return;
              e.preventDefault();
              const st = useStore.getState();
              const loc = ops.find(st.doc, id);
              if (!loc) return;
              const without = ops.remove(st.doc, [id]);
              const next = structuredClone(without);
              next.sections[i].children.push(loc.comp);
              st.setDoc(next);
            }}
          >
            <button className="mini" aria-label={expanded ? "Collapse band" : "Expand band"} title={searching ? "Clear search to change the band view" : undefined} disabled={searching} data-testid={`explorer-collapse-${i}`} onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}>{expanded ? "▾" : "▸"}</button>
            <span className="layer-type" title={ops.BAND_TITLES[s.type] ?? s.type}>{ops.BAND_CODES[s.type] ?? ""}</span>
            <span className="layer-name" title={ops.bandDisplayName(doc, s)}>{bandName}</span>
            <span className="layer-actions" aria-hidden="true">
              {s.locked && <span title="Layout locked"><Icon name="lock" small /></span>}
              {s.hidden && <span title="Hidden from output"><Icon name="hidden" small /></span>}
            </span>
            <details ref={menuRef} className="explorer-menu" onClick={(e) => e.stopPropagation()}>
              <summary role="button" aria-label={`Actions for ${bandName}`} title="Band actions" aria-haspopup="menu">⋯</summary>
              <div className="explorer-menu-popover" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
                <button onClick={() => { useStore.getState().set({ selectedBand: i, selection: [], rightOpen: true }); requestAnimationFrame(() => (document.querySelector('[data-testid="band-name"]') as HTMLInputElement | null)?.focus()); }}>Rename</button>
                <button disabled={!!s.locked} onClick={() => { const st = useStore.getState(); const result = ops.duplicateBand(st.doc, i); st.setDoc(result.doc); st.set({ selectedBand: result.index }); }}>Duplicate</button>
                <button onClick={() => { const st = useStore.getState(); st.setDoc(ops.updateBand(st.doc, i, { locked: !s.locked })); }}>{s.locked ? "Unlock layout" : "Lock layout"}</button>
                <button onClick={() => { const st = useStore.getState(); st.setDoc(ops.updateBand(st.doc, i, { hidden: !s.hidden })); }}>{s.hidden ? "Show in output" : "Hide from output"}</button>
                <button disabled={!ops.canMoveBand(doc, i, i - 1)} onClick={() => { const st = useStore.getState(); const next = ops.moveBand(st.doc, i, i - 1); if (next) st.setDoc(next); }}>Move up</button>
                <button disabled={!ops.canMoveBand(doc, i, i + 1)} onClick={() => { const st = useStore.getState(); const next = ops.moveBand(st.doc, i, i + 1); if (next) st.setDoc(next); }}>Move down</button>
                <button disabled={searching} onClick={() => setOpen(!open)}>{open ? "Collapse in tree" : "Expand in tree"}</button>
                <button className="danger" aria-label={`Remove ${s.type} band`} disabled={!!s.locked} onClick={() => { const st = useStore.getState(); st.setDoc(ops.removeSection(st.doc, i)); st.set({ selectedBand: null }); }}>Delete section</button>
              </div>
            </details>
          </div>
          {expanded && (s.children ?? []).map((c: ops.Comp) => (
            <LayerRow key={c.id} comp={c} depth={depth + 1} search={search} />
          ))}
        </div>
  );
}

function ExplorerNodeRow({ node, depth, search, overview }: { node: ExplorerNode; depth: number; search?: ExplorerSearch; overview: boolean }) {
  const doc = useStore((state) => state.doc);
  const menuRef = useDismissibleDetails();
  const [open, setOpen] = useState(true);
  if (node.kind === "band") return <ExplorerBand index={node.index} depth={depth} search={search} overview={overview} />;
  const group = (doc.groups ?? []).find((entry: any) => entry.id === node.id);
  if (!group || (search && !search.groups.has(node.id))) return null;
  const searching = !!search;
  const expanded = searching || open;
  const selectGroup = () => {
    const index = (doc.sections ?? []).findIndex((section: any) => section.groupId === node.id && section.type === "groupHeader");
    const fallback = (doc.sections ?? []).findIndex((section: any) => section.groupId === node.id && section.type === "groupFooter");
    useStore.getState().set({ selectedBand: index >= 0 ? index : fallback >= 0 ? fallback : null, selection: [], rightOpen: true });
  };
  return <div className="explorer-group" data-testid={"explorer-group-" + node.id}>
    <div className={`layer explorer-row ${search?.matchedGroups.has(node.id) ? "search-match" : ""}`} style={{ paddingLeft: `calc(8px + ${depth} * var(--explorer-indent))` }} data-depth={depth} title={group.by}>
      <button className="mini" aria-label={(expanded ? "Collapse " : "Expand ") + (group.name ?? group.id)} disabled={searching} onClick={() => setOpen(!open)}>{expanded ? "▾" : "▸"}</button>
      <span className="layer-type" aria-hidden="true">▦</span>
      <button className="explorer-group-name" data-explorer-entry="" data-explorer-match={search?.matchedGroups.has(node.id) ? "" : undefined} aria-expanded={node.children.length ? expanded : undefined} onClick={selectGroup} onKeyDown={(event) => {
        if (searching) return;
        if (event.key === "ArrowRight" && !open) { event.preventDefault(); setOpen(true); }
        if (event.key === "ArrowLeft" && open) { event.preventDefault(); setOpen(false); }
      }}>{group.name ?? group.id}</button>
      <span className="layer-actions" />
      <details ref={menuRef} className="explorer-menu" onClick={(event) => event.stopPropagation()}>
        <summary role="button" aria-label={`Actions for ${group.name ?? group.id}`} title="Group actions" aria-haspopup="menu">⋯</summary>
        <div className="explorer-menu-popover" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
          <button onClick={selectGroup}>Edit group</button>
          <button className="danger" aria-label={"Remove group " + (group.name ?? group.id)} data-testid={"explorer-remove-group-" + group.id} disabled={(doc.sections ?? []).some((section: any) => section.groupId === group.id && section.locked)} onClick={() => {
            const st = useStore.getState();
            st.setDoc(ops.removeGroup(st.doc, group.id));
            st.set({ selectedBand: null, selection: [] });
          }}>Delete group</button>
        </div>
      </details>
    </div>
    {expanded && node.children.map((child) => <ExplorerNodeRow key={child.kind === "group" ? "g:" + child.id : "b:" + child.index} node={child} depth={depth + 1} search={search} overview={overview} />)}
  </div>;
}

function ReportExplorer() {
  const doc = useStore((state) => state.doc);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const tree = useMemo(() => explorerTree(doc.sections ?? [], doc.groups ?? []), [doc]);
  const overview = (doc.sections ?? []).length >= 8;
  const search = useMemo(() => query.trim() ? searchExplorer(doc, tree, query) : undefined, [doc, tree, query]);
  const searchInput = useRef<HTMLInputElement>(null);
  const addMenuRef = useDismissibleDetails();
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  // Focus right after the box renders. A frame-delayed focus could arrive after the user has already moved on
  // (for example to a search result) and pull focus back.
  useLayoutEffect(() => { if (searchFocusRequest) searchInput.current?.focus(); }, [searchFocusRequest]);
  const focusSearch = () => {
    setSearchOpen(true);
    setSearchFocusRequest((request) => request + 1);
  };
  const addBand = (type: string) => {
    addReportSection(type);
    setQuery("");
  };
  return (
    <div className="tab-body structure-tab" data-testid="layers-tab" onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); focusSearch(); return; }
      if (!(event.target as HTMLElement).hasAttribute("data-explorer-entry")) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-explorer-entry]")];
      const index = rows.indexOf(event.target as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault();
      rows[next]?.focus();
      rows[next]?.scrollIntoView({ block: "nearest" });
    }}>
      <div className="structure-head"><span>Structure</span>
        <div className="structure-head-actions">
          <button className="structure-search-trigger" type="button" aria-label="Find in structure" title="Find in structure" aria-expanded={searchOpen} onClick={focusSearch}><Icon name="search" small /></button>
          <button className="compact-close" type="button" aria-label="Close workspace panel" onClick={() => useStore.getState().set({ leftOpen: false })}>×</button>
          <details ref={addMenuRef} className="structure-add">
            <summary role="button" aria-label="Add section or group" title="Add section or group" aria-haspopup="menu" data-testid="explorer-add-trigger">+</summary>
            <div className="structure-add-popover" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
              <button className="structure-add-option" data-testid="explorer-add-group" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); useStore.getState().set({ dialog: "group" }); }}><strong>Group…</strong><small>Organize records by a field, with a header and footer for each value.</small></button>
              {ops.BAND_TYPES.map((type) => <button className="structure-add-option" key={type} data-testid={`explorer-add-band-${type}`} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); addBand(type); }}><strong>{ops.BAND_TITLES[type]}</strong><small>{BAND_DESCRIPTIONS[type]}</small></button>)}
            </div>
          </details>
        </div>
      </div>
      {searchOpen && <div className="structure-search-row">
        <input className="search" type="search" ref={searchInput} data-testid="structure-search" aria-label="Search structure" placeholder="Find bands or elements…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setQuery(""); setSearchOpen(false); document.querySelector<HTMLButtonElement>(".structure-search-trigger")?.focus(); }
          if (event.key === "Enter") { event.preventDefault(); document.querySelector<HTMLElement>("[data-explorer-match]")?.focus(); }
        }} />
        <button type="button" aria-label="Close structure search" onClick={() => { setQuery(""); setSearchOpen(false); }}>×</button>
      </div>}
      {search && <div className="structure-search-count" role="status">{search.count} {search.count === 1 ? "match" : "matches"}</div>}
      <div className="structure-root" title={doc.name}>{doc.name}</div>
      {tree.map((node) => <ExplorerNodeRow key={`${doc.id}:${node.kind === "group" ? "g:" + node.id : "b:" + node.index}`} node={node} depth={0} search={search} overview={overview} />)}
      {search && search.count === 0 && <p className="structure-search-empty">No bands or elements match “{query.trim()}”.</p>}
    </div>
  );
}

function PagesTab() {
  const { engine } = useStore();
  const pag = engine.paginated;
  if (!pag) return <div className="tab-body muted">No pages yet.</div>;
  const scale = 96 / pag.pageSize.width;
  return (
    <div className="tab-body" data-testid="pages-tab">
      <button className="btn pages-master-entry" data-testid="edit-page-masters" onClick={() => { savePref("canvasView", "pages"); useStore.getState().set({ selection: [], selectedBand: null, rightOpen: true, canvasView: "pages", reportInspectorTab: "page" }); requestAnimationFrame(() => { const section = document.querySelector('[data-testid="page-masters-section"]'); const toggle = section?.querySelector<HTMLButtonElement>(".prop-section-title"); if (toggle?.getAttribute("aria-expanded") === "false") toggle.click(); section?.scrollIntoView({ block: "start" }); }); }}>Edit page masters</button>
      {pag.pages.map((p, i) => (
        <button key={i} className="thumb" data-testid="page-thumb" onClick={() => document.querySelector(`[data-page="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label={`Go to page ${i + 1}`}>
          <span className="thumb-page" style={{ width: pag.pageSize.width * scale, height: pag.pageSize.height * scale }}>
            {[...p.background.flatMap((node) => node.children ?? []), ...p.header, ...p.content, ...p.footer].map((n, j) => (
              <span key={j} className={`thumb-box ${(n.component as any).type}`} style={{ left: n.box.x * scale, top: n.box.y * scale, width: Math.max(1, n.box.width * scale), height: Math.max(1, n.box.height * scale) }} />
            ))}
          </span>
          <span className="muted small">Page {i + 1}{(() => { const sec = (useStore.getState().doc.sections ?? [])[p.master.header ?? -1] as any; return sec?.appliesTo && sec.appliesTo !== "all" && sec.appliesTo !== "standard" ? ` · ${sec.appliesTo}` : ""; })()}</span>
        </button>
      ))}
    </div>
  );
}

const LEFT_PANEL_MIN = 240;
const LEFT_PANEL_MAX = 560;

export function LeftPanel({ width, onWidthChange }: { width: number; onWidthChange(width: number): void }) {
  const tab = useStore((s) => s.leftTab);
  const set = useStore((s) => s.set);
  const resizeStart = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const clampWidth = (value: number) => Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, Math.round(value)));
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { x: event.clientX, width, pointerId: event.pointerId };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = resizeStart.current;
    if (start?.pointerId === event.pointerId) onWidthChange(clampWidth(start.width + event.clientX - start.x));
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current?.pointerId !== event.pointerId) return;
    resizeStart.current = null;
    savePref("leftPanelWidth", String(width));
  };
  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === "Home" ? LEFT_PANEL_MIN
      : event.key === "End" ? LEFT_PANEL_MAX
        : event.key === "ArrowLeft" ? clampWidth(width - step)
          : event.key === "ArrowRight" ? clampWidth(width + step)
            : null;
    if (next === null) return;
    event.preventDefault();
    onWidthChange(next);
    savePref("leftPanelWidth", String(next));
  };
  const tabs = [
    { id: "layers", label: "Structure", icon: "structure" },
    { id: "data", label: "Data", icon: "data" },
    { id: "insert", label: "Components", icon: "components" },
    { id: "pages", label: "Pages", icon: "pages" },
  ] as const;
  const moveTab = (event: React.KeyboardEvent, index: number) => {
    const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!offset && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
    const id = tabs[next]!.id;
    set({ leftTab: id, ...(id === "pages" ? { reportInspectorTab: "page" as const } : {}) });
    requestAnimationFrame(() => document.getElementById(`workspace-tab-${id}`)?.focus());
  };
  return (
    <aside className="panel left" aria-label="Workspace panels">
      <nav className="workspace-rail" aria-label="Workspace panels" role="tablist">
        {tabs.map((item, index) => (
          <button key={item.id} id={`workspace-tab-${item.id}`} type="button" role="tab" aria-controls="workspace-panel" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "active" : ""} data-testid={`left-tab-${item.id}`} onClick={() => set({ leftTab: item.id, ...(item.id === "pages" ? { reportInspectorTab: "page" } : {}) })} onKeyDown={(event) => moveTab(event, index)} title={item.label}>
            <Icon name={item.icon} small />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div id="workspace-panel" className="workspace-panel" role="tabpanel" aria-labelledby={`workspace-tab-${tab}`}>
        {tab !== "layers" && <div className="workspace-panel-head">{tabs.find((item) => item.id === tab)?.label}<button className="compact-close" type="button" aria-label="Close workspace panel" onClick={() => set({ leftOpen: false })}>×</button></div>}
        {tab === "insert" && <InsertTab />}
        {tab === "data" && <DataTab />}
        {tab === "layers" && <ReportExplorer />}
        {tab === "pages" && <PagesTab />}
      </div>
      <div
        className="workspace-resize-handle"
        role="separator"
        aria-label="Resize workspace sidebar"
        aria-orientation="vertical"
        aria-valuemin={LEFT_PANEL_MIN}
        aria-valuemax={LEFT_PANEL_MAX}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels wide`}
        tabIndex={0}
        title="Drag to resize this sidebar; use arrow keys for precise sizing"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
        onKeyDown={resizeByKeyboard}
      />
    </aside>
  );
}
