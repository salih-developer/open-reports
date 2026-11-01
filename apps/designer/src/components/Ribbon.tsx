import React, { useEffect, useRef, useState } from "react";
import { savePref, useStore, type ViewOptions } from "../store";
import * as ops from "../model/ops";
import { COMMANDS, shortcutLabel } from "../lib/commands";
import { FONT_FAMILIES } from "../lib/fonts";
import {
  borderSides, clearFormatting, common, FONT_SIZES, formattingOf, hasSide, isBold, LINE_WIDTHS, pasteFormatting,
  restyleBorder, SIDES, STYLED_TYPES, styleEach, TEXT_TYPES, toggleBorderSide, type Pen, type Side,
} from "../lib/ribbon";
import { nextZoomStep } from "../lib/viewport";
import { zoomCanvas, zoomToFit } from "../lib/zoom";
import { addReportSection, BAND_DESCRIPTIONS, insertFromPalette, PALETTE_ITEMS, SECTION_GROUPS } from "./LeftPanel";
import { Icon } from "./Icon";

// The ribbon: an Office-style command bar under the title bar in Design mode. Every command edits the report
// JSON through the same store actions and commands as the canvas, inspector and keyboard shortcuts.

type RibbonTab = "home" | "insert" | "arrange" | "view";
const TABS: { id: RibbonTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "insert", label: "Insert" },
  { id: "arrange", label: "Arrange" },
  { id: "view", label: "View" },
];

/** Standard colours, ten per row: greys, soft tones, then strong tones. */
const SWATCHES: [string, string][] = [
  ["#000000", "Black"], ["#262626", "Grey 85%"], ["#404040", "Grey 75%"], ["#595959", "Grey 65%"], ["#7f7f7f", "Grey 50%"], ["#a6a6a6", "Grey 35%"], ["#bfbfbf", "Grey 25%"], ["#d9d9d9", "Grey 15%"], ["#f2f2f2", "Grey 5%"], ["#ffffff", "White"],
  ["#1f4e79", "Dark blue"], ["#2e75b6", "Blue"], ["#9dc3e6", "Light blue"], ["#deebf7", "Pale blue"], ["#375623", "Dark green"], ["#548235", "Green"], ["#a9d18e", "Light green"], ["#e2f0d9", "Pale green"], ["#833c0b", "Brown"], ["#f4b183", "Peach"],
  ["#c00000", "Dark red"], ["#ff0000", "Red"], ["#ffc000", "Orange"], ["#ffff00", "Yellow"], ["#92d050", "Lime"], ["#00b050", "Emerald"], ["#00b0f0", "Sky blue"], ["#0070c0", "Ocean blue"], ["#002060", "Navy"], ["#7030a0", "Purple"],
];
const PALETTE_GROUPS = ["Basic", "Layout", "Data", "Print", "Charts"];

// Kept across tab switches: the pen that new borders are drawn with, and the formatting "Copy formatting" picked up.
let lastPen: Pen = { width: 1, style: "solid", color: "#000000" };
let copiedFormat: { style: Record<string, any>; textStyle?: string } | null = null;

const st = useStore.getState;

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem("designer.ribbonCollapsed") === "1";
  } catch {
    return false;
  }
}

function selectedComps(doc: ops.Doc, ids: string[]): ops.Comp[] {
  return ids.map((id) => ops.find(doc, id)?.comp).filter((comp): comp is ops.Comp => Boolean(comp));
}

/** Applies a style patch, computed per component, to the selected components of these types as one undo step. */
function applyStyle(types: readonly string[], patchFor: (comp: ops.Comp) => Record<string, any>, coalesce?: string) {
  const s = st();
  s.setDoc(styleEach(s.doc, s.selection, types, patchFor), coalesce ? { coalesce } : {});
}

/** Applies a component patch to the selected components of these types as one undo step. */
function applyEach(types: readonly string[], patchFor: (comp: ops.Comp) => Record<string, any>) {
  const s = st();
  let doc = s.doc;
  for (const id of s.selection) {
    const comp = ops.find(doc, id)?.comp;
    if (comp && types.includes(comp.type)) doc = ops.update(doc, id, patchFor(comp));
  }
  s.setDoc(doc);
}

/** The size a text component prints at: its own, its text style's, or the default 10 pt. */
function sizeOf(doc: ops.Doc, comp: ops.Comp): number | string {
  return comp.style?.fontSize ?? doc.theme?.textStyles?.[comp.textStyle]?.fontSize ?? 10;
}

function points(doc: ops.Doc, size: number | string): number {
  if (typeof size === "number") return size;
  const token = doc.theme?.fontSizes?.[size.replace(/^\$/, "")];
  return typeof token === "number" ? token : 10;
}

/** A swatch colour for a stored colour, resolving theme colour tokens. */
function swatch(doc: ops.Doc, color: string | undefined): string | undefined {
  return color?.startsWith("$") ? doc.theme?.colors?.[color.slice(1)] : color;
}

// ------------------------------------------------------------------ building blocks
interface ButtonProps {
  /** Accessible name and tooltip; contains the caption when there is one. */
  label: string;
  icon?: string;
  /** A text glyph (B, I, U) drawn instead of an icon. */
  glyph?: React.ReactNode;
  caption?: string;
  size?: "large" | "small";
  pressed?: boolean;
  disabled?: boolean;
  shortcut?: string;
  testId?: string;
  popup?: "menu" | "dialog";
  expanded?: boolean;
  className?: string;
  onClick(event: React.MouseEvent<HTMLButtonElement>): void;
}

function RibbonButton({ label, icon, glyph, caption, size = "small", pressed, disabled, shortcut, testId, popup, expanded, className, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      className={`ribbon-btn ${size}${caption ? " captioned" : ""}${pressed ? " on" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={popup}
      aria-expanded={popup ? expanded : undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      data-testid={testId}
      // Keep focus (and an open inline text editor) where it was, as the floating toolbar does.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {glyph ? <span className="ribbon-glyph" aria-hidden="true">{glyph}</span> : icon ? <Icon name={icon} size={size === "large" ? 24 : 16} /> : null}
      {caption && <span className="ribbon-caption">{caption}</span>}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label" aria-hidden="true">{label}</div>
    </div>
  );
}

/** A popover pinned under its trigger. It is fixed-positioned so the scrolling ribbon panel cannot clip it. */
function usePopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAnchor(null);
    };
    // Capture phase, so Escape closes the popover before the canvas shortcut clears the selection.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setAnchor(null);
      ref.current?.querySelector<HTMLElement>("button")?.focus();
    };
    const close = () => setAnchor(null);
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);
  const style = anchor ? { left: Math.max(8, Math.min(anchor.left, window.innerWidth - 248)), top: anchor.bottom + 4 } : undefined;
  return { ref, open: Boolean(anchor), style, toggle: (el: HTMLElement) => setAnchor(anchor ? null : el.getBoundingClientRect()), close: () => setAnchor(null) };
}

function ColorButton({ label, icon, glyph, value, initial, none, disabled, testId, onPick }: {
  label: string;
  icon?: string;
  glyph?: React.ReactNode;
  /** The colour of the selection, when it has one. */
  value: string | undefined;
  /** The colour the main button applies before anything is picked. */
  initial: string;
  /** Label of the choice that removes the colour, or nothing when a colour is required. */
  none?: string;
  disabled?: boolean;
  testId: string;
  onPick(color: string | undefined, coalesce?: string): void;
}) {
  const doc = useStore((s) => s.doc);
  const [last, setLast] = useState(initial);
  const pop = usePopover();
  const custom = useRef<HTMLInputElement>(null);
  const themeColors = Object.entries((doc.theme?.colors ?? {}) as Record<string, string>);
  const pick = (color: string | undefined) => {
    if (color) setLast(color);
    onPick(color);
    pop.close();
  };
  const hex = swatch(doc, last);
  return (
    <div className="ribbon-split" ref={pop.ref}>
      <RibbonButton label={label} icon={icon} glyph={glyph} className="ribbon-color" disabled={disabled} testId={testId} onClick={() => onPick(last)} />
      <span className="ribbon-color-bar" style={{ background: hex }} aria-hidden="true" />
      <RibbonButton label={`Choose ${label.toLowerCase()}`} icon="chevron-down" className="ribbon-split-arrow" popup="dialog" expanded={pop.open} disabled={disabled} testId={`${testId}-menu`} onClick={(e) => pop.toggle(e.currentTarget.parentElement!)} />
      <input
        ref={custom}
        type="color"
        className="ribbon-color-input"
        tabIndex={-1}
        aria-hidden="true"
        value={/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : "#000000"}
        onChange={(e) => {
          setLast(e.target.value);
          onPick(e.target.value, `ribbon-${testId}`);
        }}
      />
      {pop.open && <div className="ribbon-popover ribbon-colors" role="dialog" aria-label={label} style={pop.style} data-testid={`${testId}-palette`}>
        {none && <button type="button" className="ribbon-color-choice" data-testid={`${testId}-none`} onClick={() => pick(undefined)}>
          <span className="ribbon-swatch empty" aria-hidden="true" />{none}
        </button>}
        {themeColors.length > 0 && <>
          <div className="ribbon-menu-heading">Theme colours</div>
          <div className="ribbon-swatches">
            {themeColors.map(([name, color]) => (
              <button type="button" key={name} className={`ribbon-swatch${value === `$${name}` ? " on" : ""}`} style={{ background: color }} aria-label={`Theme colour ${name}`} title={`$${name} · ${color}`} onClick={() => pick(`$${name}`)} />
            ))}
          </div>
        </>}
        <div className="ribbon-menu-heading">Standard colours</div>
        <div className="ribbon-swatches">
          {SWATCHES.map(([color, name]) => (
            <button type="button" key={color} className={`ribbon-swatch${value?.toLowerCase() === color ? " on" : ""}`} style={{ background: color }} aria-label={name} title={`${name} · ${color}`} data-testid={`${testId}-${color.slice(1)}`} onClick={() => pick(color)} />
          ))}
        </div>
        <button type="button" className="ribbon-color-choice" onClick={() => {
          pop.close();
          const input = custom.current;
          if (input?.showPicker) input.showPicker();
          else input?.click();
        }}>More colours…</button>
      </div>}
    </div>
  );
}

/** An editable font size box: type a size and press Enter, or choose one from the list. */
function SizeBox({ value, disabled, onCommit }: { value: string; disabled: boolean; onCommit(size: number): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (text: string) => {
    const size = Number(text.replace(",", "."));
    if (text.trim() && Number.isFinite(size) && size >= 1 && size <= 400 && text !== value) onCommit(Math.round(size * 2) / 2);
    else setDraft(value);
  };
  return (
    <>
      <input
        className="ribbon-size"
        aria-label="Font size"
        title="Font size (pt)"
        list="ribbon-font-sizes"
        inputMode="decimal"
        placeholder={disabled ? "" : "Mixed"}
        value={draft}
        disabled={disabled}
        data-testid="ribbon-font-size"
        onChange={(e) => {
          setDraft(e.target.value);
          // A size picked from the list applies at once; a typed size applies on Enter or when leaving the box.
          if ((e.nativeEvent as InputEvent).inputType === "insertReplacementText") commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Escape") setDraft(value);
        }}
      />
      <datalist id="ribbon-font-sizes">{FONT_SIZES.map((size) => <option key={size} value={size} />)}</datalist>
    </>
  );
}

// ------------------------------------------------------------------ tabs
function HomeTab() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const clipboard = useStore((s) => s.clipboard);
  const [pen, setPen] = useState(lastPen);
  const [hasFormat, setHasFormat] = useState(Boolean(copiedFormat));
  const comps = selectedComps(doc, selection);
  const text = comps.filter((comp) => TEXT_TYPES.includes(comp.type));
  const styled = comps.filter((comp) => STYLED_TYPES.includes(comp.type));
  const noText = !text.length;
  const noStyle = !styled.length;

  const allOn = (key: string) => text.length > 0 && text.every((comp) => Boolean(comp.style?.[key]));
  const toggle = (key: string) => {
    const on = allOn(key);
    applyStyle(TEXT_TYPES, () => ({ [key]: on ? undefined : true }));
  };
  const bold = text.length > 0 && text.every((comp) => isBold(comp.style));
  const align = common(text.map((comp) => comp.style?.align ?? "left"));
  const verticalAlign = common(text.map((comp) => comp.style?.verticalAlign ?? "top"));
  const family = noText ? "" : common(text.map((comp) => comp.style?.fontFamily ?? ""));
  const size = noText ? "" : common(text.map((comp) => sizeOf(doc, comp)));
  const step = (direction: 1 | -1) => applyStyle(TEXT_TYPES, (comp) => {
    const current = points(doc, sizeOf(doc, comp));
    const next = direction > 0 ? FONT_SIZES.find((s) => s > current) ?? current + 8 : [...FONT_SIZES].reverse().find((s) => s < current) ?? Math.max(1, current - 1);
    return { fontSize: next };
  }, "ribbon-size");

  const sides = styled.map((comp) => comp.style?.border);
  const sideOn = (side: Side) => styled.length > 0 && sides.every((border) => hasSide(border, side));
  const allSides = SIDES.every(sideOn);
  const toggleSide = (side: Side) => {
    const on = sideOn(side);
    // Adding draws the side where it is missing; removing clears it everywhere.
    applyStyle(STYLED_TYPES, (comp) => (hasSide(comp.style?.border, side) === on ? { border: toggleBorderSide(comp.style?.border, side, pen) } : {}));
  };
  const drawn = styled.flatMap((comp) => Object.values(borderSides(comp.style?.border)));
  const shownPen: Pen = {
    width: common(drawn.map((side) => side.width)) ?? pen.width,
    style: (common(drawn.map((side) => side.style)) as Pen["style"] | undefined) ?? pen.style,
    color: common(drawn.map((side) => side.color)) ?? pen.color,
  };
  const restyle = (patch: Partial<Pen>, coalesce?: string) => {
    lastPen = { ...pen, ...patch };
    setPen(lastPen);
    applyStyle(STYLED_TYPES, (comp) => (comp.style?.border ? { border: restyleBorder(comp.style.border, patch) } : {}), coalesce);
  };

  const textStyles = Object.keys(doc.theme?.textStyles ?? {});
  const textStyle = noText ? "" : common(text.map((comp) => comp.textStyle ?? ""));
  const copyFormat = () => {
    const source = comps[0];
    if (!source) return;
    copiedFormat = { style: formattingOf(source.style), textStyle: source.textStyle };
    setHasFormat(true);
    st().toast("Formatting copied. Select other elements, then choose Paste formatting.");
  };
  const pasteFormat = () => {
    const format = copiedFormat;
    if (!format) return;
    applyEach(STYLED_TYPES, (comp) => {
      const isText = TEXT_TYPES.includes(comp.type);
      return { style: pasteFormatting(comp.style, format.style, isText), ...(isText ? { textStyle: format.textStyle } : {}) };
    });
  };
  const clear = () => applyEach(STYLED_TYPES, (comp) => {
    const isText = TEXT_TYPES.includes(comp.type);
    return { style: clearFormatting(comp.style, isText), ...(isText ? { textStyle: undefined } : {}) };
  });

  return (
    <>
      <Group label="Clipboard">
        <RibbonButton size="large" icon="paste" label="Paste" caption="Paste" shortcut={shortcutLabel("paste")} disabled={!clipboard.length} testId="ribbon-paste" onClick={() => st().paste()} />
        <div className="ribbon-stack">
          <RibbonButton icon="cut" label="Cut" caption="Cut" disabled={!comps.length} testId="ribbon-cut" onClick={() => {
            st().copy();
            st().removeSelected();
          }} />
          <RibbonButton icon="copy" label="Copy" caption="Copy" shortcut={shortcutLabel("copy")} disabled={!comps.length} testId="ribbon-copy" onClick={() => st().copy()} />
          <RibbonButton icon="duplicate" label="Duplicate" caption="Duplicate" shortcut={shortcutLabel("duplicate")} disabled={!comps.length} testId="ribbon-duplicate" onClick={() => st().duplicateSelected()} />
        </div>
      </Group>

      <Group label="Font">
        <div className="ribbon-rows">
          <div className="ribbon-row">
            <select className="ribbon-select ribbon-font" aria-label="Font family" title="Font family" data-testid="ribbon-font-family" disabled={noText} value={family ?? "\u0000mixed"} onChange={(e) => applyStyle(TEXT_TYPES, () => ({ fontFamily: e.target.value || undefined }))}>
              {family === undefined && <option value={"\u0000mixed"} disabled>Mixed fonts</option>}
              <option value="">{doc.theme?.fonts?.body ?? "Default font"}</option>
              {Object.keys(doc.theme?.fonts ?? {}).map((name) => <option key={`token-${name}`} value={`$${name}`}>{`$${name} (${doc.theme.fonts[name]})`}</option>)}
              {FONT_FAMILIES.map((name) => <option key={name}>{name}</option>)}
            </select>
            <SizeBox value={size === undefined ? "" : String(size)} disabled={noText} onCommit={(fontSize) => applyStyle(TEXT_TYPES, () => ({ fontSize }), "ribbon-size")} />
            <RibbonButton glyph={<>A<small>+</small></>} label="Increase font size" disabled={noText} testId="ribbon-grow" onClick={() => step(1)} />
            <RibbonButton glyph={<>A<small>−</small></>} label="Decrease font size" disabled={noText} testId="ribbon-shrink" onClick={() => step(-1)} />
          </div>
          <div className="ribbon-row">
            <RibbonButton glyph={<b>B</b>} label="Bold" pressed={bold} disabled={noText} testId="ribbon-bold" onClick={() => applyStyle(TEXT_TYPES, () => ({ fontWeight: bold ? undefined : "bold" }))} />
            <RibbonButton glyph={<i>I</i>} label="Italic" pressed={allOn("italic")} disabled={noText} testId="ribbon-italic" onClick={() => toggle("italic")} />
            <RibbonButton glyph={<u>U</u>} label="Underline" pressed={allOn("underline")} disabled={noText} testId="ribbon-underline" onClick={() => toggle("underline")} />
            <RibbonButton glyph={<s>S</s>} label="Strikethrough" pressed={allOn("strikethrough")} disabled={noText} testId="ribbon-strikethrough" onClick={() => toggle("strikethrough")} />
            <span className="ribbon-sep" />
            <ColorButton label="Font colour" glyph="A" value={noText ? undefined : common(text.map((comp) => comp.style?.color))} initial="#c00000" none="Automatic" disabled={noText} testId="ribbon-font-color" onPick={(color, coalesce) => applyStyle(TEXT_TYPES, () => ({ color }), coalesce)} />
          </div>
        </div>
      </Group>

      <Group label="Paragraph">
        <div className="ribbon-rows">
          <div className="ribbon-row">
            {(["left", "center", "right", "justify"] as const).map((a) => (
              <RibbonButton key={a} icon={`text-${a}`} label={a === "center" ? "Centre text" : a === "justify" ? "Justify text" : `Align text ${a}`} pressed={!noText && align === a} disabled={noText} testId={`ribbon-text-${a}`} onClick={() => applyStyle(TEXT_TYPES, () => ({ align: align === a ? undefined : a }))} />
            ))}
          </div>
          <div className="ribbon-row">
            {(["top", "middle", "bottom"] as const).map((v) => (
              <RibbonButton key={v} icon={`text-${v}`} label={`Align text to ${v}`} pressed={!noText && verticalAlign === v} disabled={noText} testId={`ribbon-text-${v}`} onClick={() => applyStyle(TEXT_TYPES, () => ({ verticalAlign: v === "top" || verticalAlign === v ? undefined : v }))} />
            ))}
          </div>
        </div>
      </Group>

      <Group label="Borders & fill">
        <div className="ribbon-rows">
          <div className="ribbon-row">
            <RibbonButton icon="border-all" label="All borders" pressed={allSides} disabled={noStyle} testId="ribbon-border-all" onClick={() => applyStyle(STYLED_TYPES, () => ({ border: allSides ? undefined : { ...pen } }))} />
            <RibbonButton icon="border-none" label="No border" disabled={noStyle} testId="ribbon-border-none" onClick={() => applyStyle(STYLED_TYPES, () => ({ border: undefined }))} />
            {SIDES.map((side) => (
              <RibbonButton key={side} icon={`border-${side}`} label={`${side[0]!.toUpperCase()}${side.slice(1)} border`} pressed={sideOn(side)} disabled={noStyle} testId={`ribbon-border-${side}`} onClick={() => toggleSide(side)} />
            ))}
          </div>
          <div className="ribbon-row">
            <ColorButton label="Fill colour" icon="fill" value={noStyle ? undefined : common(styled.map((comp) => comp.style?.background))} initial="#deebf7" none="No fill" disabled={noStyle} testId="ribbon-fill-color" onPick={(background, coalesce) => applyStyle(STYLED_TYPES, () => ({ background }), coalesce)} />
            <ColorButton label="Border colour" icon="border-color" value={shownPen.color} initial={pen.color} disabled={noStyle} testId="ribbon-border-color" onPick={(color, coalesce) => color && restyle({ color }, coalesce)} />
            <select className="ribbon-select ribbon-narrow" aria-label="Border width" title="Border width (pt)" data-testid="ribbon-border-width" disabled={noStyle} value={shownPen.width} onChange={(e) => restyle({ width: Number(e.target.value) })}>
              {[...new Set([...LINE_WIDTHS, shownPen.width])].sort((a, b) => a - b).map((width) => <option key={width} value={width}>{width} pt</option>)}
            </select>
            <select className="ribbon-select ribbon-narrow" aria-label="Border style" title="Border style" data-testid="ribbon-border-style" disabled={noStyle} value={shownPen.style} onChange={(e) => restyle({ style: e.target.value as Pen["style"] })}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>
        </div>
      </Group>

      <Group label="Styles">
        <div className="ribbon-rows">
          <select className="ribbon-select ribbon-styles" aria-label="Text style" title="Text style from the report theme" data-testid="ribbon-text-style" disabled={noText} value={textStyle ?? "\u0000mixed"} onChange={(e) => applyEach(TEXT_TYPES, () => ({ textStyle: e.target.value || undefined }))}>
            {textStyle === undefined && <option value={"\u0000mixed"} disabled>Mixed styles</option>}
            <option value="">No text style</option>
            {textStyles.map((name) => <option key={name} value={name}>{name}</option>)}
            {textStyle && !textStyles.includes(textStyle) && <option value={textStyle}>{textStyle} (missing)</option>}
          </select>
          <div className="ribbon-row">
            <RibbonButton icon="format-copy" label="Copy formatting" disabled={!comps.length} testId="ribbon-copy-format" onClick={copyFormat} />
            <RibbonButton icon="format-paste" label="Paste formatting" disabled={!hasFormat || noStyle} testId="ribbon-paste-format" onClick={pasteFormat} />
            <RibbonButton icon="format-clear" label="Clear formatting" disabled={noStyle} testId="ribbon-clear-format" onClick={clear} />
          </div>
        </div>
      </Group>
    </>
  );
}

function SectionMenu() {
  const pop = usePopover();
  useEffect(() => {
    if (pop.open) requestAnimationFrame(() => pop.ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }, [pop.open]);
  return (
    <div className="ribbon-split" ref={pop.ref}>
      <RibbonButton size="large" icon="section" label="Add section" caption="Section" popup="menu" expanded={pop.open} testId="ribbon-add-section" onClick={(e) => pop.toggle(e.currentTarget)} />
      {pop.open && <div className="ribbon-popover ribbon-menu" role="menu" aria-label="Add section" style={pop.style} onKeyDown={(e) => {
        if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
        {SECTION_GROUPS.map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <div className="ribbon-menu-heading">{group.label}</div>
            {group.types.map((type) => (
              <button key={type} type="button" role="menuitem" title={BAND_DESCRIPTIONS[type]} data-testid={`ribbon-section-${type}`} onClick={() => {
                pop.close();
                addReportSection(type);
              }}>
                <span className="ribbon-menu-code">{ops.BAND_CODES[type]}</span>{ops.BAND_TITLES[type]}
              </button>
            ))}
          </div>
        ))}
      </div>}
    </div>
  );
}

function InsertTab() {
  return (
    <>
      {PALETTE_GROUPS.map((group) => (
        <Group key={group} label={group}>
          {PALETTE_ITEMS.filter((item) => item.group === group).map((item) => {
            const chart = item.overrides?.chartType as string | undefined;
            return <RibbonButton key={item.label} size="large" icon={chart ? `chart-${chart}` : item.type} label={`Insert ${item.label.toLowerCase()}`} caption={item.label} testId={`ribbon-insert-${item.type}${chart ? `-${chart}` : ""}`} onClick={() => insertFromPalette(item)} />;
          })}
        </Group>
      ))}
      <Group label="Report">
        <SectionMenu />
        <RibbonButton size="large" icon="dataset" label="New dataset" caption="Dataset" testId="ribbon-new-dataset" onClick={() => st().set({ dialog: "dataset", editingDataset: null })} />
        <RibbonButton size="large" icon="grouping" label="Grouping wizard" caption="Grouping" testId="ribbon-grouping" onClick={() => st().set({ dialog: "group" })} />
      </Group>
    </>
  );
}

function ArrangeTab() {
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const comps = selectedComps(doc, selection);
  const count = comps.length;
  const command = (id: string, icon: string, options: { caption?: string; disabled?: boolean; pressed?: boolean } = {}) => {
    const cmd = COMMANDS.find((c) => c.id === id)!;
    return <RibbonButton icon={icon} label={cmd.label} caption={options.caption} shortcut={shortcutLabel(id)} disabled={options.disabled} pressed={options.pressed} testId={`ribbon-${id}`} onClick={() => cmd.run(st())} />;
  };
  return (
    <>
      <Group label="Align">
        <div className="ribbon-rows">
          <div className="ribbon-row">
            {command("align-left", "align-left", { disabled: count < 2 })}
            {command("align-center", "align-center", { disabled: count < 2 })}
            {command("align-right", "align-right", { disabled: count < 2 })}
          </div>
          <div className="ribbon-row">
            {command("align-top", "align-top", { disabled: count < 2 })}
            {command("align-middle", "align-middle", { disabled: count < 2 })}
            {command("align-bottom", "align-bottom", { disabled: count < 2 })}
          </div>
        </div>
        <div className="ribbon-stack">
          {command("distribute-h", "distribute-h", { caption: "Across", disabled: count < 3 })}
          {command("distribute-v", "distribute-v", { caption: "Down", disabled: count < 3 })}
        </div>
      </Group>
      <Group label="Order">
        <div className="ribbon-stack">
          {command("order-forward", "order-forward", { caption: "Forward", disabled: !count })}
          {command("order-backward", "order-backward", { caption: "Backward", disabled: !count })}
        </div>
        <div className="ribbon-stack">
          {command("order-front", "order-front", { caption: "To front", disabled: !count })}
          {command("order-back", "order-back", { caption: "To back", disabled: !count })}
        </div>
      </Group>
      <Group label="Group">
        <div className="ribbon-stack">
          {command("group", "group-selection", { caption: "Group", disabled: count < 2 })}
          {command("ungroup", "ungroup", { caption: "Ungroup", disabled: !(count === 1 && comps[0]!.type === "group") })}
        </div>
      </Group>
      <Group label="Protect">
        <div className="ribbon-stack">
          {command("lock", "lock", { caption: "Lock", disabled: !count, pressed: count > 0 && comps.every((comp) => comp.locked) })}
          {command("hide", "hidden", { caption: "Hide", disabled: !count, pressed: count > 0 && comps.every((comp) => comp.hidden) })}
        </div>
      </Group>
    </>
  );
}

const SHOW_OPTIONS: [keyof ViewOptions, string, string][] = [
  ["grid", "Grid", "Grid"],
  ["rulers", "Rulers", "Rulers"],
  ["guides", "Smart guides", "Guides"],
  ["margins", "Margins & safe area", "Margins"],
  ["boundaries", "Show all boundaries", "Boundaries"],
  ["diagnostics", "Diagnostics on canvas", "Diagnostics"],
];

function ViewTab() {
  const view = useStore((s) => s.view);
  const snap = useStore((s) => s.snap);
  const zoom = useStore((s) => s.zoom);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const split = useStore((s) => s.split);
  const focusCanvas = useStore((s) => s.focusCanvas);
  const set = useStore((s) => s.set);
  const toggleView = (key: keyof ViewOptions) => {
    const next = { ...st().view, [key]: !st().view[key] };
    set({ view: next, showGrid: next.grid, showRulers: next.rulers });
  };
  const option = ([key, label, caption]: (typeof SHOW_OPTIONS)[number]) => (
    <RibbonButton key={key} icon={key} label={label} caption={caption} pressed={view[key]} testId={`ribbon-view-${key}`} onClick={() => toggleView(key)} />
  );
  const toggleFocus = () => {
    const s = st();
    if (s.focusCanvas) set({ ...s.focusRestore, focusCanvas: false, focusRestore: null });
    else set({ focusCanvas: true, focusRestore: { leftOpen: s.leftOpen, rightOpen: s.rightOpen, bottom: s.bottom }, leftOpen: false, rightOpen: false, bottom: null });
  };
  return (
    <>
      <Group label="Show">
        <div className="ribbon-stack">{SHOW_OPTIONS.slice(0, 3).map(option)}</div>
        <div className="ribbon-stack">{SHOW_OPTIONS.slice(3).map(option)}</div>
      </Group>
      <Group label="Snap">
        <RibbonButton size="large" icon="snap" label="Snap to grid & components" caption="Snap" pressed={snap} testId="ribbon-snap" onClick={() => set({ snap: !snap })} />
      </Group>
      <Group label="Zoom">
        <div className="ribbon-rows">
          <div className="ribbon-row">
            <RibbonButton icon="zoom-out" label="Zoom out" shortcut={shortcutLabel("zoom-out")} testId="ribbon-zoom-out" onClick={() => zoomCanvas(nextZoomStep(st().zoom, -1))} />
            <span className="ribbon-zoom-value" data-testid="ribbon-zoom-value">{Math.round(zoom * 100)}%</span>
            <RibbonButton icon="zoom-in" label="Zoom in" shortcut={shortcutLabel("zoom-in")} testId="ribbon-zoom-in" onClick={() => zoomCanvas(nextZoomStep(st().zoom, 1))} />
          </div>
          <div className="ribbon-row">
            <RibbonButton icon="zoom-actual" label="Zoom to 100%" caption="100%" shortcut={shortcutLabel("zoom-100")} testId="ribbon-zoom-100" onClick={() => zoomCanvas(1)} />
            <RibbonButton icon="zoom-width" label="Zoom to fit page width" caption="Page width" shortcut={shortcutLabel("zoom-fit")} testId="ribbon-zoom-fit" onClick={() => zoomToFit()} />
          </div>
        </div>
      </Group>
      <Group label="Window">
        <div className="ribbon-stack">
          <RibbonButton icon="panel-left" label="Left panel" caption="Left panel" pressed={leftOpen} testId="ribbon-left-panel" onClick={() => set({ leftOpen: !leftOpen, focusCanvas: false, focusRestore: null })} />
          <RibbonButton icon="panel-right" label="Properties panel" caption="Properties" pressed={rightOpen} testId="ribbon-properties-panel" onClick={() => set({ rightOpen: !rightOpen, focusCanvas: false, focusRestore: null })} />
        </div>
        <div className="ribbon-stack">
          <RibbonButton icon="split" label="Split design and code" caption="Split" pressed={split} testId="ribbon-split" onClick={() => set({ split: !split, mode: "design" })} />
          <RibbonButton icon="focus" label="Focus canvas" caption="Focus" pressed={focusCanvas} testId="ribbon-focus" onClick={toggleFocus} />
        </div>
      </Group>
    </>
  );
}

// ------------------------------------------------------------------ ribbon
export function Ribbon() {
  const [tab, setTab] = useState<RibbonTab>("home");
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const collapse = (next: boolean) => {
    setCollapsed(next);
    savePref("ribbonCollapsed", next ? "1" : "0");
  };
  const choose = (id: RibbonTab) => {
    setTab(id);
    if (collapsed) collapse(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const next = e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]!.id);
    document.getElementById(`ribbon-tab-${TABS[next]!.id}`)?.focus();
  };
  return (
    <div className={`ribbon${collapsed ? " collapsed" : ""}`} data-testid="ribbon">
      <div className="ribbon-tabs">
        <div className="ribbon-tablist" role="tablist" aria-label="Ribbon" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`ribbon-tab-${t.id}`}
              type="button"
              role="tab"
              className="ribbon-tab"
              aria-selected={!collapsed && tab === t.id}
              aria-controls={collapsed ? undefined : "ribbon-panel"}
              tabIndex={tab === t.id ? 0 : -1}
              data-testid={`ribbon-tab-${t.id}`}
              onClick={() => choose(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="ribbon-collapse" aria-label={collapsed ? "Expand ribbon" : "Collapse ribbon"} aria-expanded={!collapsed} title={collapsed ? "Expand ribbon" : "Collapse ribbon"} data-testid="ribbon-collapse" onClick={() => collapse(!collapsed)}>
          <Icon name={collapsed ? "chevron-down" : "chevron-up"} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="ribbon-panel" id="ribbon-panel" role="tabpanel" aria-labelledby={`ribbon-tab-${tab}`}>
          {tab === "home" && <HomeTab />}
          {tab === "insert" && <InsertTab />}
          {tab === "arrange" && <ArrangeTab />}
          {tab === "view" && <ViewTab />}
        </div>
      )}
    </div>
  );
}
