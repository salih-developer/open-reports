import * as ops from "../model/ops";

/** Components whose text the ribbon's Font and Paragraph groups format (the inspector's Typography section). */
export const TEXT_TYPES: readonly string[] = ["text", "richText", "field"];
/** Components with colours and borders (the inspector's Appearance section). */
export const STYLED_TYPES: readonly string[] = [...TEXT_TYPES, "rectangle", "container", "row", "column", "grid"];

export const FONT_SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
export const LINE_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];
export interface Pen {
  width: number;
  style: "solid" | "dashed" | "dotted";
  color: string;
}
type BorderSide = Pen | { width: number; style: string; color: string };
type Border = BorderSide | Partial<Record<Side, BorderSide>> | undefined;

/** Formatting that "Clear formatting" removes and "Paste formatting" copies; spacing, wrapping and direction change layout, so they stay. */
const FORMATTING_KEYS = ["fontFamily", "pdfFontFace", "fontSize", "fontWeight", "italic", "underline", "strikethrough", "align", "verticalAlign", "lineHeight", "letterSpacing", "color", "background", "border", "borderRadius"];
/** The part of the formatting that components without text (rectangles, containers) use. */
const APPEARANCE_KEYS = ["color", "background", "border", "borderRadius"];

const isUniform = (border: NonNullable<Border>): border is BorderSide => "width" in border && typeof border.width === "number";

/** The border of each side that is drawn. */
export function borderSides(border: Border): Partial<Record<Side, BorderSide>> {
  if (!border) return {};
  if (isUniform(border)) return Object.fromEntries(SIDES.map((side) => [side, border]));
  return Object.fromEntries(SIDES.filter((side) => border[side]).map((side) => [side, border[side]!]));
}

/** The smallest border value for these sides: none, one uniform border, or per-side borders. */
export function fromSides(sides: Partial<Record<Side, BorderSide>>): Border {
  const drawn = SIDES.filter((side) => sides[side]);
  if (!drawn.length) return undefined;
  const first = sides[drawn[0]!]!;
  const same = (a: BorderSide, b: BorderSide) => a.width === b.width && a.style === b.style && a.color === b.color;
  if (drawn.length === 4 && drawn.every((side) => same(sides[side]!, first))) return { ...first };
  return Object.fromEntries(drawn.map((side) => [side, { ...sides[side]! }]));
}

export function hasSide(border: Border, side: Side): boolean {
  return Boolean(borderSides(border)[side]);
}

/** Draws a side with the pen, or removes it when it is already drawn. */
export function toggleBorderSide(border: Border, side: Side, pen: Pen): Border {
  const sides = borderSides(border);
  if (sides[side]) delete sides[side];
  else sides[side] = { ...pen };
  return fromSides(sides);
}

/** Changes the width, style or colour of the sides that are already drawn; draws nothing new. */
export function restyleBorder(border: Border, patch: Partial<Pen>): Border {
  const sides = borderSides(border);
  return fromSides(Object.fromEntries(Object.entries(sides).map(([side, value]) => [side, { ...value, ...patch }])));
}

/** The value every item shares, or undefined when the items differ (a mixed selection). */
export function common<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  return values.every((value) => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] : undefined;
}

export function isBold(style: Record<string, any> | undefined): boolean {
  const weight = style?.fontWeight;
  return weight === "bold" || (typeof weight === "number" && weight >= 600);
}

const only = (style: Record<string, any> | undefined, keys: string[], keep: boolean) => Object.fromEntries(Object.entries(style ?? {}).filter(([key]) => keys.includes(key) === keep));
const orUndefined = (style: Record<string, any>) => (Object.keys(style).length ? style : undefined);

/** A style without its formatting; components without text lose only their colours and borders. */
export function clearFormatting(style: Record<string, any> | undefined, text = true): Record<string, any> | undefined {
  return orUndefined(only(style, text ? FORMATTING_KEYS : APPEARANCE_KEYS, false));
}

/** The formatting that "Copy formatting" carries to other components. */
export function formattingOf(style: Record<string, any> | undefined): Record<string, any> {
  return only(style, FORMATTING_KEYS, true);
}

/** A target's style with its formatting replaced by copied formatting; components without text take only colours and borders. */
export function pasteFormatting(style: Record<string, any> | undefined, formatting: Record<string, any>, text = true): Record<string, any> | undefined {
  return orUndefined({ ...clearFormatting(style, text), ...only(formatting, text ? FORMATTING_KEYS : APPEARANCE_KEYS, true) });
}

/** Applies a style patch, computed per component, to every selected component of the given types; an empty patch leaves the component (and the document) as it is. */
export function styleEach(doc: ops.Doc, ids: string[], types: readonly string[], patchFor: (comp: ops.Comp) => Record<string, any>): ops.Doc {
  let next = doc;
  for (const id of ids) {
    const comp = ops.find(next, id)?.comp;
    if (!comp || !types.includes(comp.type)) continue;
    const patch = patchFor(comp);
    if (Object.keys(patch).length) next = ops.updateStyle(next, id, patch);
  }
  return next;
}
