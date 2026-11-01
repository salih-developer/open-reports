import React, { useEffect, useRef, useState } from "react";
import { useStore, loadDraft, savePref } from "./store";
import { Canvas } from "./components/Canvas";
import { LeftPanel } from "./components/LeftPanel";
import { Properties } from "./components/Properties";
import { CodeEditor } from "./components/CodeEditor";
import { Preview } from "./components/Preview";
import { BottomBar, BottomPanel, Dialogs, HomeScreen, Toasts, Toolbar } from "./components/Shell";
import { DataMode } from "./components/DataMode";
import { AiBar } from "./components/AiBar";
import { TableDesigner } from "./components/TableDesigner";
import { BandBar } from "./components/BandLayer";
import { Ribbon } from "./components/Ribbon";
import { arrayRefs, datasetFields, scalarFields } from "./lib/fields";
import { titleCase } from "./lib/lowcode";
import * as ops from "./model/ops";
import { handleShortcut } from "./lib/commands";
import { startEmbedHost } from "./lib/embed-host";
import { CanvasScenarioSwitch } from "./components/CanvasScenario";

function GettingStartedHint() {
  const { doc, sample, selection, demoHint, mode } = useStore();
  const set = useStore((s) => s.set);
  if (mode !== "design") return null;
  const selected = selection.length === 1 ? ops.find(doc, selection[0]!)?.comp : null;
  const table = selected?.type === "table" && !selected.dataset ? selected : null;
  const refs = table ? arrayRefs(doc, sample) : [];
  // Name the report's real first static text, so the hint never points at something that is not there.
  const firstHeading = demoHint === "edit" ? [...ops.walkAll(doc)].map((l) => l.comp).find((c) => c.type === "text" && typeof c.value === "string" && c.value.trim() && !c.binding && !c.expression)?.value as string | undefined : undefined;
  // A blank report's first step is shown on the page itself (BlankPageStart), not in this bar.
  if (!demoHint && !table) return null;
  const useDataset = (ref: string) => {
    if (!table) return;
    const fields = scalarFields(datasetFields(doc, sample, ref));
    useStore.getState().patch(table.id, {
      dataset: ref,
      columns: fields.slice(0, 10).map((field) => ({
        id: field.name,
        header: titleCase(field.name),
        binding: `row.${field.path}`,
        format: field.kind === "date" ? "date:dd MMM yyyy" : field.kind === "number" && /amount|price|total|rate|cost|balance/i.test(field.name) ? "currency" : undefined,
        align: field.kind === "number" ? "right" : undefined,
      })),
      headerRows: undefined,
      cellSpans: undefined,
    });
  };
  return <div className="getting-started" role="status" data-testid="getting-started">
    <div><strong>{table ? "Connect table data" : demoHint === "edit" ? "Try one edit" : "See the printable result"}</strong><span>{table ? refs.length ? "Choose data to fill this table and create its columns." : "Create a dataset to fill this table." : demoHint === "edit" ? `Double-click “${firstHeading ?? "the title"}” at the top, type a new name, then press Enter.` : "Your change is on the canvas. Check the PDF it produces."}</span></div>
    {table ? refs.length ? <select aria-label="Table data" data-testid="canvas-table-data" defaultValue="" onChange={(event) => useDataset(event.target.value)}><option value="" disabled>Choose data…</option>{refs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}</select> : <button className="btn primary" data-testid="canvas-create-dataset" onClick={() => set({ dialog: "dataset", editingDataset: null })}>Create dataset</button> : demoHint === "preview" ? <button className="btn primary" onClick={() => set({ mode: "preview", demoHint: null })}>Preview PDF →</button> : <button className="mini" onClick={() => set({ demoHint: null })}>Dismiss</button>}
  </div>;
}

function MobileDesignerGate() {
  const name = useStore((s) => s.doc.name);
  const set = useStore((s) => s.set);
  return <main className="mobile-designer-gate" data-testid="mobile-designer-gate">
    <div className="mobile-gate-card">
      <div className="mobile-gate-brand"><span className="logo" aria-hidden="true">▤</span> Open Reports</div>
      <h1>Design on a larger screen</h1>
      <p>The canvas, rulers, and properties need room to work accurately. Your {name || "report"} draft is still here when you return on a desktop.</p>
      <div className="mobile-gate-actions">
        <button className="btn primary" onClick={() => set({ dialog: "tour" })}>Practical videos ▶</button>
        <a className="btn" href="/sample-invoice.pdf" target="_blank" rel="noopener noreferrer">View a sample invoice PDF ↗</a>
      </div>
      <button className="mobile-gate-home" onClick={() => set({ home: true })}>← Back to examples</button>
    </div>
  </main>;
}

const LEFT_PANEL_MIN = 240;
const LEFT_PANEL_MAX = 560;

function savedLeftPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem("designer.leftPanelWidth"));
    return Number.isFinite(saved) && saved >= LEFT_PANEL_MIN && saved <= LEFT_PANEL_MAX ? saved : 312;
  } catch {
    return 312;
  }
}

export default function App() {
  const { mode, home, leftOpen, rightOpen, split, tableEditId } = useStore();
  const set = useStore((s) => s.set);
  const previousPanels = useRef({ leftOpen, rightOpen });
  const [leftPanelWidth, setLeftPanelWidth] = useState(savedLeftPanelWidth);
  const [phone, setPhone] = useState(() => window.matchMedia("(max-width: 700px)").matches);
  const showsLeft = mode === "design" && leftOpen;
  const showsRight = (mode === "design" || mode === "code") && rightOpen;

  useEffect(() => {
    const s = useStore.getState();
    // Embedded in another page: the host decides what to open, so skip the local draft and the home screen.
    if (startEmbedHost()) {
      s.refresh();
      s.loadCapabilities();
      s.loadBlocks();
      return;
    }
    const draft = loadDraft();
    if (draft?.doc) {
      s.loadDoc(draft.doc, { dirty: draft.dirty ?? false }, draft.sample ?? {});
    } else {
      s.refresh();
    }
    s.set({ home: true, ...(new URLSearchParams(window.location.search).get("tour") === "1" ? { dialog: "tour" as const } : {}) });
    s.loadCapabilities();
    s.loadBlocks();
  }, []);

  useEffect(() => {
    const previous = previousPanels.current;
    previousPanels.current = { leftOpen, rightOpen };
    if (!window.matchMedia("(max-width: 980px)").matches) return;
    if (leftOpen && rightOpen) {
      // At overlay widths, keep one panel visible at a time so neither can cover the canvas.
      const propertiesJustOpened = rightOpen && !previous.rightOpen;
      useStore.getState().set(propertiesJustOpened
        ? { leftOpen: false, fitToWidth: true }
        : { rightOpen: false, fitToWidth: true });
    } else if ((leftOpen && !previous.leftOpen) || (rightOpen && !previous.rightOpen)) {
      // Re-fit the page in the area left beside the opened overlay.
      useStore.getState().set({ fitToWidth: true });
    }
  }, [leftOpen, rightOpen]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const theme = useStore.getState().interfaceTheme;
      if (theme === "system") useStore.getState().setInterfaceTheme(theme);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setPhone(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const laptop = window.matchMedia("(max-width: 1200px)");
    const overlay = window.matchMedia("(max-width: 980px)");
    const collapseForWidth = () => {
      if (!laptop.matches) return;
      useStore.getState().set({ rightOpen: false, bottom: null, ...(overlay.matches ? { leftOpen: false } : {}) });
    };
    collapseForWidth();
    laptop.addEventListener("change", collapseForWidth);
    overlay.addEventListener("change", collapseForWidth);
    return () => {
      laptop.removeEventListener("change", collapseForWidth);
      overlay.removeEventListener("change", collapseForWidth);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void handleShortcut(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" data-testid="app">
      {home ? <HomeScreen /> : phone ? <MobileDesignerGate /> : <>
      <div className="app-header">
        <Toolbar />
        {mode === "design" && !tableEditId && <Ribbon />}
      </div>
      {mode === "design" && tableEditId ? <TableDesigner id={tableEditId} /> : <div className={`main ${showsLeft ? "has-left" : "no-left"} ${showsRight ? "has-right" : "no-right"}`} style={{ "--left-panel-width": `${leftPanelWidth}px` } as React.CSSProperties}>
        {showsLeft && <LeftPanel width={leftPanelWidth} onWidthChange={setLeftPanelWidth} />}
        <section className="center" aria-label="Workspace">
          {mode === "design" && <button className="edge left" aria-label={leftOpen ? "Hide insert panel" : "Show insert panel"} title="Toggle insert panel" onClick={() => set({ leftOpen: !leftOpen, focusCanvas: false, focusRestore: null })}>
            {leftOpen ? "‹" : "›"}
          </button>}
          {(mode === "design" || mode === "code") && <button className="edge right" aria-label={rightOpen ? "Hide properties" : "Show properties"} title="Toggle properties" onClick={() => set({ rightOpen: !rightOpen, focusCanvas: false, focusRestore: null })}>
            {rightOpen ? "›" : "‹"}
          </button>}
          {mode === "design" && <BandBar />}
          {mode === "design" && <GettingStartedHint />}
          {mode === "design" && !tableEditId && <CanvasScenarioSwitch />}
          {mode === "design" && !split && <Canvas />}
          {mode === "design" && split && (
            <div className="split">
              <Canvas />
              <CodeEditor />
            </div>
          )}
          {mode === "data" && <DataMode />}
          {mode === "code" && <CodeEditor />}
          {mode === "preview" && <Preview />}
        </section>
        {showsRight && <Properties />}
      </div>}
      <BottomPanel />
      <BottomBar />
      <AiBar />
      </>}
      <Dialogs />
      <Toasts />
    </div>
  );
}
