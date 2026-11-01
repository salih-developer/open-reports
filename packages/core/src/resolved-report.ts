import type { ResolvedLink } from "./links.js";
/**
 * The Resolved Report Tree: the normalized, renderer-neutral structure
 * produced by the pipeline (schema validation -> parameter resolution ->
 * dataset execution -> expression evaluation -> component resolution).
 * Renderers (PDF/HTML/XLSX/CSV) consume *only* this tree. They never see raw
 * bindings/expressions, run SQL, call REST APIs, or compute business
 * formulas themselves -- all of that already happened here, once, so every
 * output format reports the same numbers (see spec sections 82-83).
 */

import type { ResolvedTableStyles } from "./table-styles.js";
import type { ExportsConfig, PageConfig, Style, Theme } from "@reporting/schema";

export interface ResolvedReport {
  id: string;
  name: string;
  locale: string;
  page: PageConfig;
  theme?: Theme;
  sections: ResolvedSection[];
  exports?: ExportsConfig;
  print?: import("@reporting/schema").PrintProfile;
  watermark?: import("@reporting/schema").Watermark;
  warnings: ResolvedWarning[];
}

export interface ResolvedWarning {
  code: string;
  path: string;
  message: string;
  componentId?: string;
}

export interface ResolvedSection {
  type: string;
  /** Index of the section in the report definition (stable key for page-master re-resolution). */
  sourceIndex: number;
  appliesTo?: string;
  repeat?: boolean;
  style?: Style;
  children: ResolvedComponent[];
}

export type ResolvedComponent =
  | ResolvedTextComponent
  | ResolvedImageComponent
  | ResolvedLineComponent
  | ResolvedRectangleComponent
  | ResolvedSpacerComponent
  | ResolvedQrCodeComponent
  | ResolvedBarcodeComponent
  | ResolvedPageBreakComponent
  | ResolvedChartComponent
  | ResolvedTableComponent
  | ResolvedContainerComponent
  | ResolvedGroupComponent;

export interface ResolvedComponentBase {
  id?: string;
  type: string;
  layout?: string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  style?: Record<string, unknown>;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  keepTogether?: boolean;
  keepWithNext?: boolean;
  gap?: number;
  wrap?: boolean;
  alignItems?: string;
  justifyContent?: string;
  grow?: number;
  shrink?: number;
  minWidth?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  exports?: Record<string, unknown>;
  bookmark?: boolean | string;
  bookmarkLevel?: number;
  /** Clickable link (see links.ts). */
  link?: ResolvedLink;
  /** On a drill-down group's first header element: which group and key it expands or collapses. */
  drillToggle?: { component: string; key: string; collapsed: boolean };
  /** Present on the container that represents one printed instance of a report band. */
  band?: BandMeta;
}

/** What the engine knows about a printed band: used by pagination (repeat/keep rules) and by the designer (structure overlay, explanations). */
export interface BandMeta {
  sectionIndex: number;
  sectionId?: string;
  type: string;
  name?: string;
  groupId?: string;
  /** Group nesting level, 0 = outermost. */
  level?: number;
  /** groupHeader: print again at the top of every page the group continues onto. */
  repeatEveryPage?: boolean;
  /** Group key of the instance (headers/footers/details inside a group). */
  groupKey?: unknown;
  /** Zero-based record index for detail bands. */
  rowIndex?: number;
  /** Whether pagination may split this band between its children when it does not fit the page. */
  allowSplit?: boolean;
  /** Unique number of the group instance (all bands of one group occurrence share it). */
  instance?: number;
  /** Design view: the band's visibility rule currently hides it (shown dimmed). */
  hiddenByRule?: boolean;
  /** Anchor this band to the bottom of the page body; content after it starts a new page. */
  printAtBottom?: boolean;
  /** True when this node is a copy of a group header repeated on a continuation page. */
  repeated?: boolean;
  /** Detail bands: the record this band printed. Every band and fragment of one record shares the same object. */
  [PRINTED_RECORD]?: PrintedRecord;
}

/**
 * Key of the record a detail band or table row printed. A symbol, so the records stay out of JSON (the analyze
 * response, saved layouts) while spreads and copies of a node keep them.
 */
export const PRINTED_RECORD: unique symbol = Symbol.for("open-reports.printed-record");

/**
 * A data record as printed, for page-level values: pagination finds the records that landed on each page and
 * gives page bands `page.rows`, and the row variables before and after that page (`page.start`, `page.end`).
 */
export interface PrintedRecord {
  row: Record<string, unknown>;
  /** Every row variable after this record was counted. */
  vars: Record<string, unknown>;
}

export interface ResolvedTextComponent extends ResolvedComponentBase {
  type: "text" | "richText" | "field";
  text: string;
}

export interface ResolvedImageComponent extends ResolvedComponentBase {
  type: "image";
  src?: string;
  fit: string;
  alt?: string;
}

export interface ResolvedLineComponent extends ResolvedComponentBase {
  type: "line";
  orientation: string;
}

export interface ResolvedRectangleComponent extends ResolvedComponentBase {
  type: "rectangle";
}

export interface ResolvedSpacerComponent extends ResolvedComponentBase {
  type: "spacer";
}

export interface ResolvedQrCodeComponent extends ResolvedComponentBase {
  type: "qrcode";
  value: string;
}

export interface ResolvedBarcodeComponent extends ResolvedComponentBase {
  type: "barcode";
  value: string;
  symbology: string;
}

export interface ResolvedPageBreakComponent extends ResolvedComponentBase {
  type: "pageBreak";
}

export interface ResolvedChartComponent extends ResolvedComponentBase {
  type: "chart";
  chartType: "bar" | "line" | "pie";
  title?: string;
  categories: string[];
  series: { name: string; values: number[] }[];
}

export interface ResolvedTableColumn {
  id: string;
  header: string;
  width?: number | string;
  align?: string;
  format?: string;
  footer?: { label?: string; value: string; raw?: unknown };
}

export interface ResolvedTableHeaderCell {
  /** Zero-based starting column. */
  column: number;
  text: string;
  colSpan?: number;
  rowSpan?: number;
  align?: "left" | "center" | "right";
}

export interface ResolvedTableCellSpan {
  row: number;
  column: number;
  colSpan?: number;
  rowSpan?: number;
  /** A merge of repeated values: pagination may split it, repeating the value on the next page. */
  splittable?: boolean;
  /** Index of the `cellSpans` entry that produced an explicit merge (absent for automatic merges). */
  source?: number;
}

export interface ResolvedTableRow {
  /** Raw per-column values, keyed by column id -- used by XLSX/CSV for correct cell types. */
  raw: Record<string, unknown>;
  /** Formatted display strings, keyed by column id -- used by PDF/HTML. */
  formatted: Record<string, string>;
  /** Style overrides from the table's rowStyleWhen rules that matched this row. */
  style?: Record<string, unknown>;
  /** Per-cell style from column rules, keyed by column id; applied over the row style. */
  cellStyles?: Record<string, Record<string, unknown>>;
  /** Per-cell links from column `link`s, keyed by column id. */
  links?: Record<string, ResolvedLink>;
  /** The record this row printed, for page-level values (see PrintedRecord). */
  [PRINTED_RECORD]?: PrintedRecord;
  /** Set by pagination when rows were split: the source row whose zebra stripe this row uses. */
  stripeIndex?: number;
  /** Set by pagination on the continuation part of a row split across pages. */
  continued?: boolean;
}

export interface ResolvedTableComponent extends ResolvedComponentBase {
  type: "table";
  columns: ResolvedTableColumn[];
  /** Omitted for the legacy single header row from columns[].header. */
  headerRows?: ResolvedTableHeaderCell[][];
  cellSpans?: ResolvedTableCellSpan[];
  rows: ResolvedTableRow[];
  showHeader: boolean;
  showFooter: boolean;
  keepFooterTogether: boolean;
  repeatHeaderOnPageBreak: boolean;
  keepRowTogether: boolean;
  /** Rows may break across pages at a line boundary; otherwise a whole row always moves. */
  allowRowSplit?: boolean;
  minRowsBeforeBreak: number;
  minRowsAfterBreak: number;
  alternateRowStyle?: boolean;
  /** Effective table styles when the table uses `tableStyle` or `styles`; renderers otherwise use the historical look. */
  styles?: ResolvedTableStyles;
}

export interface ResolvedContainerComponent extends ResolvedComponentBase {
  type: "container" | "row" | "column" | "grid" | "repeater" | "keepTogether";
  columns?: number;
  /** Band containers: explicit/minimum height in points. */
  children: ResolvedComponent[];
}

export interface ResolvedGroupComponent extends ResolvedComponentBase {
  type: "group";
  groupBy: string;
  pageBreakBeforeGroup?: boolean;
  keepGroupTogether?: boolean;
  groups: ResolvedGroupInstance[];
}

export interface ResolvedGroupInstance {
  key: unknown;
  header: ResolvedComponent[];
  children: ResolvedComponent[];
  footer: ResolvedComponent[];
}
