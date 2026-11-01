import type { PageValues, PrintedRecord, ResolvedComponent, ResolvedReport, ResolvedTableComponent, ResolvedSection } from "@reporting/core";
import { PRINTED_RECORD, sliceTableSpans } from "@reporting/core";
import type { TextMeasurer } from "./measure.js";
import { defaultTextMeasurer, ellipsizeText, wrapTextLines } from "./measure.js";
import { resolveDimension, resolvePageGeometry, toPoints } from "./units.js";
import { edgesOf, layoutComponent, marginOf, measureFooterHeight, measureHeaderRowHeights, measureTableRowHeights, resolveColumnWidths, shiftNode, styleFontSize } from "./box-layout.js";
import { splitTableRow } from "./table-row-split.js";
import type { PageLayout, PaginatedReport, PaginationDecision, PositionedNode } from "./types.js";

export interface PaginateOptions {
  measurer?: TextMeasurer;
  /** Re-resolves a pageHeader/pageFooter section's components for a specific
   * page, with `page.number`/`page.total` bound to real values, plus the
   * records printed on the page and the row variables around them. If omitted,
   * the section's already-resolved (page-number-less) content is repeated verbatim. */
  resolvePageDependentSection?: (section: ResolvedSection, page: PageValues) => ResolvedComponent[];
}

/**
 * The records each page printed: a record counts on the first page where one of its detail bands or table rows
 * starts. `start` carries the row variables of the last record on earlier pages (devreden), `end` those of the
 * last record on this page (nakli yekûn); a page without records carries the previous value through.
 */
export function pageRecords(pages: PositionedNode[][]): Omit<PageValues, "number" | "total">[] {
  const seen = new Set<PrintedRecord>();
  let carried: Record<string, unknown> = {};
  return pages.map((nodes) => {
    const records: PrintedRecord[] = [];
    const take = (record: PrintedRecord | undefined) => {
      if (record && !seen.has(record)) {
        seen.add(record);
        records.push(record);
      }
    };
    const visit = (node: PositionedNode) => {
      const component = node.component as ResolvedComponent;
      take(component.band?.[PRINTED_RECORD]);
      if (component.type === "table") {
        const table = component as ResolvedTableComponent;
        const range = node.rowRange ?? { start: 0, end: table.rows.length };
        for (const row of table.rows.slice(range.start, range.end)) take(row[PRINTED_RECORD]);
      }
      for (const child of node.children ?? []) visit(child);
    };
    nodes.forEach(visit);
    const start = carried;
    if (records.length) carried = records[records.length - 1]!.vars;
    return { rows: records.map((record) => record.row), start, end: carried };
  });
}

/** Warnings that mean a generated document may omit or misplace report data. */
export const isDataLossWarningCode = (code: string): boolean =>
  code === "CONTENT_OVERFLOWS_PAGE" || code === "CONTENT_EXCEEDS_PRINTABLE_WIDTH" || code === "TEXT_EXCEEDS_HEIGHT" || code === "CONTAINER_CONTENT_EXCEEDS_HEIGHT" || code === "FREE_ELEMENT_OUTSIDE_PAGE" || code === "SUBREPORT_NOT_RENDERED";

/**
 * Page masters: a report may declare several pageHeader / pageFooter sections,
 * each with `appliesTo` first | last | odd | even | standard | all. For page
 * N of T the most specific match wins: first (N=1) > last (N=T) > odd/even >
 * standard > all/unspecified. A page with no matching section simply has no
 * header/footer, so "hide the header on the first page" is a `first` master
 * that is empty.
 */
export function pickMaster(sections: ResolvedSection[], pageNumber: number, total: number): ResolvedSection | undefined {
  const at = (v: string) => sections.find((s) => s.appliesTo === v);
  if (pageNumber === 1 && at("first")) return at("first");
  if (pageNumber === total && at("last")) return at("last");
  const parity = pageNumber % 2 === 1 ? "odd" : "even";
  if (at(parity)) return at(parity);
  return at("standard") ?? sections.find((s) => !s.appliesTo || s.appliesTo === "all");
}

/** Longest roll segment when continuous media has no maxLength (200 in). */
const CONTINUOUS_LIMIT = 14_400;

export function paginate(report: ResolvedReport, options: PaginateOptions = {}): PaginatedReport {
  const continuous = (report.page as { continuous?: { minLength?: number; maxLength?: number } } | undefined)?.continuous;
  if (!continuous) return paginateFixed(report, options);
  return paginateContinuous(report, continuous, options);
}

/**
 * Roll media: lay out on a segment as long as the maximum, then, when everything fits on one segment, shorten the page to
 * its content (respecting the minimum) and move the footer to the new bottom.
 */
function paginateContinuous(report: ResolvedReport, continuous: { minLength?: number; maxLength?: number }, options: PaginateOptions): PaginatedReport {
  const page = report.page;
  const width = resolvePageGeometry({ ...page, orientation: "portrait" } as typeof page).width;
  const unit = page.unit ?? "mm";
  const toUnit = (points: number) => points / toPoints(1, unit);
  const maxPoints = continuous.maxLength ? toPoints(continuous.maxLength, unit) : CONTINUOUS_LIMIT;
  const tall = { ...page, size: "custom" as const, width: toUnit(width), height: toUnit(maxPoints), orientation: "portrait" as const };
  // A roll has no page bottom to anchor to, so bands marked printAtBottom print where they fall.
  const result = paginateFixed({ ...report, page: tall }, options, false);
  if (result.pages.length !== 1) return result;
  const only = result.pages[0]!;
  const footerHeight = only.zones.footer.height;
  const bottomOf = (nodes: PositionedNode[]) => Math.max(0, ...nodes.map((node) => node.box.y + node.box.height));
  const contentBottom = Math.max(bottomOf(only.header), bottomOf(only.content), result.margin.top + only.zones.header.height);
  const minPoints = continuous.minLength ? toPoints(continuous.minLength, unit) : 0;
  const height = Math.min(maxPoints, Math.max(minPoints, contentBottom + footerHeight + result.margin.bottom));
  const dy = height - result.pageSize.height;
  const footer = offsetNodes(only.footer, 0, dy);
  return {
    ...result,
    pageSize: { width: result.pageSize.width, height },
    pages: [{
      ...only,
      footer,
      zones: {
        header: only.zones.header,
        body: { y: only.zones.body.y, height: Math.max(0, height - result.margin.bottom - footerHeight - only.zones.body.y) },
        footer: { y: only.zones.footer.y + dy, height: footerHeight },
      },
    }],
  };
}

function paginateFixed(report: ResolvedReport, options: PaginateOptions = {}, anchorBottom = true): PaginatedReport {
  const measurer = options.measurer ?? defaultTextMeasurer;
  const geometry = resolvePageGeometry(report.page);
  const warnings: PaginatedReport["warnings"] = [...report.warnings];

  const headers = report.sections.filter((s) => s.type === "pageHeader");
  const footers = report.sections.filter((s) => s.type === "pageFooter");
  const backgrounds = report.sections.filter((s) => s.type === "background");
  const contentComponents = report.sections.filter((s) => s.type !== "pageHeader" && s.type !== "pageFooter" && s.type !== "background").flatMap((s) => s.children);

  const heightCache = new Map<ResolvedSection, number>();
  const heightOf = (s: ResolvedSection | undefined): number => {
    if (!s) return 0;
    let h = heightCache.get(s);
    if (h === undefined) {
      h = layoutBlock(s.children, geometry.contentWidth, measurer).height;
      heightCache.set(s, h);
    }
    return h;
  };
  const bodyHeightFor = (pageNumber: number, total: number) =>
    Math.max(1, geometry.contentHeight - heightOf(pickMaster(headers, pageNumber, total)) - heightOf(pickMaster(footers, pageNumber, total)));

  // The master of the last page depends on the total page count, which depends
  // on the masters' heights: iterate until the count is stable.
  let guess = Number.POSITIVE_INFINITY;
  let run = layoutContentIntoPages(contentComponents, geometry.contentWidth, (i) => bodyHeightFor(i + 1, guess), measurer, anchorBottom);
  for (let i = 0; i < 4 && run.pages.length !== guess; i++) {
    guess = run.pages.length;
    run = layoutContentIntoPages(contentComponents, geometry.contentWidth, (idx) => bodyHeightFor(idx + 1, guess), measurer, anchorBottom);
  }
  const total = run.pages.length;

  if (geometry.contentHeight - Math.max(0, ...headers.map(heightOf)) - Math.max(0, ...footers.map(heightOf)) <= 0) {
    warnings.push({ code: "PAGE_HEADER_FOOTER_TOO_LARGE", path: "page", message: "Page header/footer leave no room for content." });
  }

  const records = pageRecords(run.pages);
  const pages: PageLayout[] = run.pages.map((content, i) => {
    const number = i + 1;
    const headerSection = pickMaster(headers, number, total);
    const footerSection = pickMaster(footers, number, total);
    const hh = heightOf(headerSection);
    const fh = heightOf(footerSection);
    const values: PageValues = { number, total, ...records[i] };

    const resolveFor = (s: ResolvedSection | undefined) =>
      !s ? [] : options.resolvePageDependentSection ? options.resolvePageDependentSection(s, values) : s.children;

    const header = layoutBlock(resolveFor(headerSection), geometry.contentWidth, measurer, { x: geometry.margin.left, y: geometry.margin.top }).nodes;
    const footer = layoutBlock(resolveFor(footerSection), geometry.contentWidth, measurer, {
      x: geometry.margin.left,
      y: geometry.height - geometry.margin.bottom - fh,
    }).nodes;

    const bgSection = pickMaster(backgrounds, number, total);
    const background = bgSection
      ? layoutBlock(
          [{ type: "container", layout: "absolute", width: geometry.width, height: geometry.height, style: bgSection.style, children: options.resolvePageDependentSection ? options.resolvePageDependentSection(bgSection, values) : bgSection.children } as any],
          geometry.width,
          measurer,
          { x: 0, y: 0 }
        ).nodes
      : [];

    const pageFrames = (run.subreportPageFrames[i] ?? []).flatMap((id) => {
      const frame = run.subreportFrames.get(id);
      if (!frame) return [];
      const childPage = i - frame.startPage + 1;
      const childTotal = frame.endPage - frame.startPage + 1;
      const footer = pickMaster(frame.footerMasters, childPage, childTotal);
      const background = pickMaster(frame.backgrounds, childPage, childTotal);
      return [{ frame, footer, background }];
    });
    const pageFooterHeights = pageFrames.map(({ footer }) => footer ? layoutBlock(footer.children, geometry.contentWidth, measurer).height : 0);
    const nestedFooterHeight = pageFooterHeights.reduce((sum, value) => sum + value, 0);
    let nestedFooterY = geometry.margin.top + hh + Math.max(0, geometry.contentHeight - hh - fh - nestedFooterHeight);
    const nestedFooters = pageFrames.flatMap(({ footer }, frameIndex) => {
      if (!footer) return [];
      // These masters were resolved in the child report context. The parent's
      // page-dependent resolver indexes the parent's sections and must not be
      // applied to them.
      const placed = layoutBlock(footer.children, geometry.contentWidth, measurer, { x: geometry.margin.left, y: nestedFooterY }).nodes;
      nestedFooterY += pageFooterHeights[frameIndex]!;
      return placed;
    });
    const nestedBackgrounds = pageFrames.flatMap(({ background }) => background
      ? layoutBlock(
          [{ type: "container", layout: "absolute", width: geometry.width, height: geometry.height, style: background.style, children: background.children } as any],
          geometry.width, measurer, { x: 0, y: 0 },
        ).nodes
      : []);

    return {
      number,
      header,
      footer,
      content: [...offsetNodes(content, geometry.margin.left, geometry.margin.top + hh), ...nestedFooters],
      zones: {
        header: { y: geometry.margin.top, height: hh },
        body: { y: geometry.margin.top + hh, height: Math.max(0, geometry.contentHeight - hh - fh - nestedFooterHeight) },
        footer: { y: geometry.height - geometry.margin.bottom - fh, height: fh },
      },
      background: [...background, ...nestedBackgrounds],
      master: { header: headerSection?.sourceIndex, footer: footerSection?.sourceIndex },
    };
  });

  warnings.push(...run.warnings);
  const seenOverflows = new Set<string>();
  const deepestBottom = (node: PositionedNode): number => Math.max(node.box.y + node.box.height, ...(node.children ?? []).map(deepestBottom));
  const inspect = (nodes: PositionedNode[]) => {
    for (const node of nodes) {
      const c = node.component as any;
      if (["text", "richText", "field"].includes(c.type) && String(c.text ?? "").trim().length > 0 && !node.textFragment) {
        const style = c.style ?? {};
        const pad = edgesOf(style.padding);
        const fontSize = style.fontSize ?? 10;
        const hint = { family: style.fontFamily, pdfFontFace: style.pdfFontFace, bold: style.fontWeight === "bold" || (typeof style.fontWeight === "number" && style.fontWeight >= 700), italic: Boolean(style.italic), lineHeight: style.lineHeight };
        const width = Math.max(1, node.box.width - pad.left - pad.right);
        const lineHeight = measurer.lineHeight(fontSize, hint);
        const actualHeight = wrapTextLines(c.text ?? "", width, fontSize, measurer, hint).length * lineHeight + pad.top + pad.bottom;
        let code: string | undefined;
        let message = "";
        if (style.overflow === "ellipsis") {
          const display = ellipsizeText(c.text ?? "", width, fontSize, measurer, hint);
          node.renderText = display.text;
          if (node.box.height + 0.5 < lineHeight + pad.top + pad.bottom) {
            code = "TEXT_EXCEEDS_HEIGHT";
            message = `Text ${label(node.component)} is too short to show even one ellipsis line.`;
          } else if (display.truncated) {
            code = "TEXT_TRUNCATED_BY_POLICY";
            message = `Text ${label(node.component)} was shortened with an ellipsis as requested by its overflow setting.`;
          }
        } else if ((c.height !== undefined || c.maxHeight !== undefined) && actualHeight > node.box.height + 0.5) {
          const intentional = style.overflow === "clip" || style.overflow === "hidden";
          code = intentional ? "TEXT_TRUNCATED_BY_POLICY" : "TEXT_EXCEEDS_HEIGHT";
          message = intentional
            ? `Text ${label(node.component)} is clipped to its fixed height as requested by its overflow setting.`
            : `Text ${label(node.component)} needs ${pt(actualHeight)} but its height is limited to ${pt(node.box.height)}; output may clip or flow unexpectedly.`;
        }
        const key = `${code}:${c.id ?? `${c.type}:${node.box.x}:${node.box.y}`}`;
        if (code && !seenOverflows.has(key)) {
          seenOverflows.add(key);
          warnings.push({ code, path: c.id ?? c.type, message });
        }
      }
      if (node.children?.length && !c.freeOverlay && (c.height !== undefined || c.maxHeight !== undefined)) {
        const excess = Math.max(0, ...node.children.map((child) => deepestBottom(child) - node.box.y - node.box.height));
        const key = c.id ?? `${c.type}:${node.box.x}:${node.box.y}`;
        if (excess > 0.5 && !seenOverflows.has(key)) {
          seenOverflows.add(key);
          warnings.push({ code: "CONTAINER_CONTENT_EXCEEDS_HEIGHT", path: c.id ?? c.type, message: `Container ${label(node.component)} has content extending ${pt(excess)} below its fixed height; it may overlap or be clipped.` });
        }
      }
      if (c.freeOverlay) for (const child of node.children ?? []) {
        const outside = child.box.x < 0 || child.box.y < 0 || child.box.x + child.box.width > geometry.width + 0.5 || child.box.y + child.box.height > geometry.height + 0.5;
        const key = `free:${(child.component as any).id ?? child.component.type}`;
        if (outside && !seenOverflows.has(key)) {
          seenOverflows.add(key);
          warnings.push({ code: "FREE_ELEMENT_OUTSIDE_PAGE", path: (child.component as any).id ?? child.component.type, message: `Free-positioned ${label(child.component)} extends beyond the page after its band splits; move it into a suitable page band or reduce its position.` });
        }
      }
      if (node.children?.length && (c.layout === "row" || c.type === "row" && !c.layout)) {
        const pad = edgesOf(c.style?.padding);
        const rowRight = node.box.x + node.box.width - pad.right;
        const printableRight = geometry.width - geometry.margin.right;
        for (const child of node.children) {
          const right = child.box.x + child.box.width;
          const overflow = right - rowRight;
          if (overflow <= 0.5) continue;
          const id = (child.component as any).id ?? c.id ?? child.component.type;
          const beyondPage = right > printableRight + 0.5;
          const code = beyondPage ? "CONTENT_EXCEEDS_PRINTABLE_WIDTH" : "ROW_CONTENT_EXCEEDS_WIDTH";
          const key = `${code}:${id}`;
          if (seenOverflows.has(key)) continue;
          seenOverflows.add(key);
          warnings.push({
            code,
            path: id,
            message: beyondPage
              ? `Row item ${label(child.component)} extends ${pt(right - printableRight)} beyond the printable page edge. Reduce fixed widths or gaps, or let an item fill the remaining width.`
              : `Row item ${label(child.component)} extends ${pt(overflow)} beyond its row. Reduce fixed widths or gaps, or let an item fill the remaining width.`,
          });
        }
      }
      if (node.children) inspect(node.children);
    }
  };
  for (const page of pages) inspect([...page.header, ...page.content, ...page.footer]);
  return {
    pageSize: { width: geometry.width, height: geometry.height },
    margin: geometry.margin,
    pages: pages.length
      ? pages
      : [{ number: 1, header: [], footer: [], background: [], content: [], zones: { header: { y: 0, height: 0 }, body: { y: 0, height: geometry.height }, footer: { y: geometry.height, height: 0 } }, master: {} }],
    decisions: run.decisions,
    warnings,
  };
}

function layoutBlock(components: ResolvedComponent[], width: number, measurer: TextMeasurer, origin = { x: 0, y: 0 }) {
  let y = origin.y;
  const nodes: PositionedNode[] = [];
  let freeBottom = origin.y;
  for (const component of components) {
    const m = marginOf(component);
    const free = component.x !== undefined || component.y !== undefined;
    const x = free ? origin.x + (resolveDimension(component.x, width, "pt") ?? 0) : origin.x + m.left;
    const top = free ? origin.y + (resolveDimension(component.y, 0, "pt") ?? 0) : y + m.top;
    const availableWidth = width - m.left - m.right - (free && component.width === undefined ? Math.max(0, x - origin.x) : 0);
    const node = layoutComponent(component, { x, y: top, width: Math.max(1, availableWidth), height: 0 }, measurer);
    nodes.push(node);
    if (free) freeBottom = Math.max(freeBottom, node.box.y + node.box.height);
    else y = node.box.y + node.box.height + m.bottom;
  }
  return { nodes, height: Math.max(y, freeBottom) - origin.y };
}

function offsetNodes(nodes: PositionedNode[], dx: number, dy: number): PositionedNode[] {
  return nodes.map((node) => {
    const copy: PositionedNode = { ...node, box: { ...node.box }, children: node.children ? offsetNodes(node.children, 0, 0) : undefined };
    shiftNode(copy, dx, dy);
    return copy;
  });
}

interface ContentRun {
  pages: PositionedNode[][];
  decisions: PaginationDecision[];
  warnings: PaginatedReport["warnings"];
  subreportPageFrames: string[][];
  subreportFrames: Map<string, { startPage: number; endPage: number; footerMasters: ResolvedSection[]; backgrounds: ResolvedSection[]; reservedFooterHeight: number }>;
}

const pt = (n: number) => `${Math.round(n * 10) / 10}pt`;
const label = (c: ResolvedComponent) => `"${(c as any).id ?? c.type}"`;

interface RowSplitChild {
  node: PositionedNode;
  x: number;
  y: number;
  lines?: string[];
  lineHeight?: number;
  padding?: ReturnType<typeof edgesOf>;
  /** A vertically stacked container: its children move to later pages whole, never cut. */
  blocks?: { node: PositionedNode; top: number; height: number }[];
}

/** Vertically stacked containers whose content can continue on the next page. */
const STACKS = new Set(["container", "column"]);

interface RowSlice {
  take: number[];
  height: number;
}

/** Plan every page before placing any fragment, so an unsplittable child can
 * fall back to the existing strict overflow warning without duplicating data. */
function planTallRow(
  component: ResolvedComponent,
  probe: PositionedNode,
  measurer: TextMeasurer,
  outer: ReturnType<typeof marginOf>,
  availableAt: (pageOffset: number) => number,
): { children: RowSplitChild[]; slices: RowSlice[]; startOnNext: boolean } | undefined {
  const row = component as any;
  if (!(row.layout === "row" || row.type === "row" && !row.layout) || row.wrap || row.alignItems && row.alignItems !== "start"
      || row.height !== undefined || row.minHeight !== undefined || row.maxHeight !== undefined || row.keepTogether || row.allowSplit === false || row.band?.allowSplit === false) return undefined;
  const pad = edgesOf(row.style?.padding);
  const children: RowSplitChild[] = [];
  for (const node of probe.children ?? []) {
    const child = node.component as any;
    const part: RowSplitChild = { node, x: node.box.x - probe.box.x, y: node.box.y - probe.box.y };
    if (STACKS.has(child.type) && (!child.layout || child.layout === "flow" || child.layout === "column") && node.children?.length) {
      const style = child.style ?? {};
      if (child.height !== undefined || child.minHeight !== undefined || child.maxHeight !== undefined || child.keepTogether
          || child.allowSplit === false || ["clip", "hidden", "ellipsis"].includes(style.overflow)) return undefined;
      part.padding = edgesOf(style.padding);
      part.blocks = [...node.children].sort((a, b) => a.box.y - b.box.y).map((block) => ({ node: block, top: block.box.y - node.box.y, height: block.box.height }));
    } else if (["text", "richText", "field"].includes(child.type)) {
      const style = child.style ?? {};
      if (child.height !== undefined || child.minHeight !== undefined || child.maxHeight !== undefined || child.keepTogether
          || child.allowSplit === false || ["clip", "hidden", "ellipsis"].includes(style.overflow)
          || (child.minLinesAtTop ?? 1) > 1 || (child.minLinesAtBottom ?? 1) > 1) return undefined;
      const hint = { family: style.fontFamily, pdfFontFace: style.pdfFontFace, bold: style.fontWeight === "bold" || (typeof style.fontWeight === "number" && style.fontWeight >= 700), italic: Boolean(style.italic), lineHeight: style.lineHeight };
      const padding = edgesOf(style.padding);
      part.lines = wrapTextLines(child.text ?? "", Math.max(1, node.box.width - padding.left - padding.right), style.fontSize ?? 10, measurer, hint);
      part.lineHeight = measurer.lineHeight(style.fontSize ?? 10, hint);
      part.padding = padding;
    }
    children.push(part);
  }
  if (!children.some((child) => child.lines || child.blocks)) return undefined;
  // Where each continuing column's next slice starts, measured from the top of the column.
  const offsetFor = (child: RowSplitChild, start: number) => (start === 0 || !child.blocks ? 0 : child.blocks[start]!.top - child.padding!.top);
  const blockSpan = (child: RowSplitChild, start: number, count: number) => {
    const last = child.blocks![start + count - 1]!;
    return last.top + last.height - offsetFor(child, start) + child.padding!.bottom;
  };

  const starts = children.map(() => 0);
  const slices: RowSlice[] = [];
  let startOnNext = false;
  let pageOffset = 0;
  const maxPages = children.reduce((sum, child) => sum + (child.lines?.length ?? 0), 0) + 2;
  while (slices.length < maxPages) {
    const room = availableAt(pageOffset) - outer.top - outer.bottom;
    const take = children.map((child, index) => {
      if (child.blocks) {
        const start = starts[index]!;
        let count = 0;
        while (start + count < child.blocks.length && child.y + blockSpan(child, start, count + 1) + pad.bottom <= room + 0.01) count++;
        return count;
      }
      if (!child.lines) return slices.length === 0 ? 1 : 0;
      const left = child.lines.length - starts[index]!;
      if (left <= 0) return 0;
      const inner = room - pad.bottom - child.y - child.padding!.top - child.padding!.bottom;
      return Math.min(left, Math.max(0, Math.floor((inner + 0.01) / child.lineHeight!)));
    });
    const canPlace = children.every((child, index) => child.blocks
      ? starts[index]! >= child.blocks.length || take[index]! > 0
      : child.lines
      ? starts[index]! >= child.lines.length || take[index]! > 0
      : slices.length > 0 || child.y + child.node.box.height + pad.bottom <= room + 0.01);
    if (!canPlace) {
      if (pageOffset === 0) { startOnNext = true; pageOffset++; continue; }
      return undefined;
    }
    const bottom = Math.max(pad.top, ...children.map((child, index) => {
      if (!take[index]) return 0;
      const height = child.blocks ? blockSpan(child, starts[index]!, take[index]!) : child.lines ? take[index]! * child.lineHeight! + child.padding!.top + child.padding!.bottom : child.node.box.height;
      return child.y + height;
    }));
    slices.push({ take, height: bottom + pad.bottom });
    children.forEach((child, index) => { if (child.lines || child.blocks) starts[index] = starts[index]! + take[index]!; });
    if (children.every((child, index) => (child.blocks ? starts[index]! >= child.blocks.length : !child.lines || starts[index]! >= child.lines.length))) return { children, slices, startOnNext };
    pageOffset++;
  }
  return undefined;
}

/** The core pagination loop: walks components in order, placing each on the
 * current page if it fits, honoring pageBreakBefore/After, keepTogether and
 * keepWithNext, margins, and splitting tables row-by-row across pages
 * (repeating the header on continuation pages). Every move to a new page is
 * recorded as a decision so the designer can explain it. */
function layoutContentIntoPages(
  input: ResolvedComponent[],
  width: number,
  pageHeightAt: (pageIndex: number) => number,
  measurer: TextMeasurer,
  anchorBottom = true,
): ContentRun {
  // work on a copy: containers that cannot fit a page are replaced by their children while we paginate
  const components: ResolvedComponent[] = [...input];
  const pages: PositionedNode[][] = [[]];
  const subreportPageFrames: string[][] = [[]];
  const subreportFrames = new Map<string, { startPage: number; endPage: number; footerMasters: ResolvedSection[]; backgrounds: ResolvedSection[]; reservedFooterHeight: number }>();
  const activeSubreportFrames: string[] = [];
  const decisions: PaginationDecision[] = [];
  const warnings: PaginatedReport["warnings"] = [];
  let y = 0;

  const decide = (d: Omit<PaginationDecision, "page">) => decisions.push({ ...d, page: pages.length + 1 });
  const pageFrameHeight = (ids: string[]) => ids.reduce((sum, id) => sum + (subreportFrames.get(id)?.reservedFooterHeight ?? 0), 0);
  const activeFrameHeight = () => pageFrameHeight(activeSubreportFrames);
  const availablePageHeight = (pageIndex: number) => Math.max(0, pageHeightAt(pageIndex) - activeFrameHeight());
  // Group headers marked repeatEveryPage that are currently "open": they are printed again at the top of every continuation page.
  const repeatStack: { level: number; instance: number; comps: ResolvedComponent[] }[] = [];
  let repeatWarned = false;
  const repeatMeasure = (): { total: number; nodes: { comp: ResolvedComponent; height: number; top: number; bottom: number }[] } => {
    const nodes = repeatStack.flatMap((e) => e.comps).map((comp) => {
      const mm = marginOf(comp);
      const n = layoutComponent(comp, { x: 0, y: 0, width: Math.max(1, width - mm.left - mm.right), height: 0 }, measurer);
      return { comp, height: n.box.height, top: mm.top, bottom: mm.bottom };
    });
    return { total: nodes.reduce((a, n) => a + n.height + n.top + n.bottom, 0), nodes };
  };
  /** Height consumed at the top of every continuation page by repeated group headers. */
  const repeatHeight = () => {
    if (!repeatStack.length) return 0;
    const { total } = repeatMeasure();
    return total > availablePageHeight(pages.length - 1) * 0.4 ? 0 : total;
  };
  const newPage = () => {
    pages.push([]);
    subreportPageFrames.push([...activeSubreportFrames]);
    y = 0;
    if (!repeatStack.length) return;
    const { total, nodes } = repeatMeasure();
    if (total > availablePageHeight(pages.length - 1) * 0.4) {
      if (!repeatWarned) {
        repeatWarned = true;
        warnings.push({ code: "REPEATED_HEADERS_TOO_TALL", path: "groups", message: "Repeated group headers take more than 40% of a page, so they are not repeated on continuation pages." });
      }
      return;
    }
    for (const n of nodes) {
      const clone: any = { ...n.comp, pageBreakBefore: false, pageBreakAfter: false, keepWithNext: false, band: { ...(n.comp as any).band, repeated: true } };
      const placed = layoutComponent(clone, { x: marginOf(clone).left, y: y + n.top, width: Math.max(1, width - marginOf(clone).left - marginOf(clone).right), height: 0 }, measurer);
      pages[pages.length - 1]!.push(placed);
      y = placed.box.y + placed.box.height + n.bottom;
      decisions.push({
        kind: "group-header-repeated",
        page: pages.length,
        componentId: (n.comp as any).id,
        sectionIndex: (n.comp as any).band?.sectionIndex,
        sectionId: (n.comp as any).band?.sectionId,
        message: `Group header ${label(n.comp)} is repeated at the top of page ${pages.length} because its group continues here.`,
        actions: [{ label: "Stop repeating this header", target: "band", patch: { repeatEveryPage: false } }],
      });
    }
  };
  const currentPage = () => pages[pages.length - 1]!;
  const pageHeight = () => Math.max(0, pageHeightAt(pages.length - 1) - pageFrameHeight(subreportPageFrames[pages.length - 1]!));
  const remaining = () => pageHeight() - y;

  for (let idx = 0; idx < components.length; idx++) {
    const component = components[idx]!;
    const anyC = component as any;
    const frameMarker = anyC.subreportFrame as { action: "start" | "end"; id: string; footerMasters?: ResolvedSection[]; backgrounds?: ResolvedSection[] } | undefined;
    if (frameMarker?.action === "start") {
      const footerMasters = frameMarker.footerMasters ?? [];
      const reservedFooterHeight = Math.max(0, ...footerMasters.map((section) => layoutBlock(section.children, width, measurer).height));
      if (y > 0 && y + pageFrameHeight(subreportPageFrames[pages.length - 1]!) + reservedFooterHeight > pageHeightAt(pages.length - 1) - repeatHeight()) newPage();
      subreportFrames.set(frameMarker.id, { startPage: pages.length - 1, endPage: pages.length - 1, footerMasters, backgrounds: frameMarker.backgrounds ?? [], reservedFooterHeight });
      activeSubreportFrames.push(frameMarker.id);
      if (!subreportPageFrames[pages.length - 1]!.includes(frameMarker.id)) subreportPageFrames[pages.length - 1]!.push(frameMarker.id);
      continue;
    }
    if (frameMarker?.action === "end") {
      const frame = subreportFrames.get(frameMarker.id);
      if (frame) frame.endPage = pages.length - 1;
      for (let frameIndex = activeSubreportFrames.length - 1; frameIndex >= 0; frameIndex--) {
        if (activeSubreportFrames[frameIndex] === frameMarker.id) { activeSubreportFrames.splice(frameIndex, 1); break; }
      }
      const markerBand = anyC.band as { level?: number } | undefined;
      if (markerBand) for (let k = repeatStack.length - 1; k >= 0; k--) if (repeatStack[k]!.level >= (markerBand.level ?? 0)) repeatStack.splice(k, 1);
      continue;
    }
    // A nested report is a logical flow, not a single unbreakable box. Its
    // frame markers and rows must enter the page loop so continuation pages
    // can receive the child's own page furniture.
    if (anyC.subreportFrameContainer && Array.isArray(anyC.children)) {
      components.splice(idx, 1, ...anyC.children);
      idx--;
      continue;
    }
    const m = marginOf(component);
    const innerWidth = Math.max(1, width - m.left - m.right);
    const place = (node: PositionedNode) => {
      shiftNode(node, 0, 0);
      currentPage().push(node);
    };

    // Containers (and bands, groups, repeaters) are laid out as one box. When one cannot fit a page, dissolve it into
    // its children so they paginate individually: nothing is ever drawn below the page edge.
    const parts = flowParts(component, innerWidth, measurer, y);
    const containsFrame = (candidate: ResolvedComponent): boolean => {
      const value = candidate as any;
      return Boolean(value.subreportFrame) || (Array.isArray(value.children) && value.children.some(containsFrame));
    };
    if (parts && parts.some(containsFrame)) {
      // Frame markers are pagination instructions. Expose them even when the
      // enclosing band would otherwise fit intact on the current page.
      components.splice(idx, 1, ...parts);
      idx--;
      continue;
    }
    if (parts) {
      const probe = layoutComponent(component, { x: 0, y: 0, width: innerWidth, height: 0 }, measurer);
      const needed = probe.box.height + m.top + m.bottom;
      const tooTall = needed > availablePageHeight(pages.length - 1) - repeatHeight();
      const bandInfo = anyC.band as { allowSplit?: boolean } | undefined;
      const splitNow = bandInfo?.allowSplit !== false && (tooTall || (bandInfo?.allowSplit === true && !anyC.keepTogether && needed > remaining()));
      if (splitNow && parts.length > 0) {
        const first = parts[0] as any;
        const last = parts[parts.length - 1] as any;
        if (anyC.pageBreakBefore) first.pageBreakBefore = true;
        if (anyC.pageBreakAfter) last.pageBreakAfter = true;
        if (anyC.keepWithNext) last.keepWithNext = true;
        const meta = anyC.band as any;
        if (meta?.type === "groupHeader" || meta?.type === "groupFooter") for (const p of parts as any[]) p.band ??= { ...meta, repeatEveryPage: false };
        components.splice(idx, 1, ...parts);
        idx--;
        continue;
      }
    }

    const band = anyC.band as { type?: string; level?: number; instance?: number; repeatEveryPage?: boolean; sectionIndex?: number; sectionId?: string } | undefined;
    const source = band && typeof band.sectionIndex === "number" ? { sectionIndex: band.sectionIndex, sectionId: band.sectionId } : {};
    const actionTarget = band && typeof band.sectionIndex === "number" ? "band" as const : "component" as const;
    if (band?.type === "groupHeader") {
      // a new instance of this group (or an outer one) closes any repeated header of the same or deeper level
      for (let k = repeatStack.length - 1; k >= 0; k--) if (repeatStack[k]!.level >= (band.level ?? 0) && repeatStack[k]!.instance !== band.instance) repeatStack.splice(k, 1);
    }

    if (anyC.pageBreakBefore && y > 0) {
      decide({ kind: "forced-break", componentId: anyC.id, ...source, message: `${label(component)} starts on a new page (page break before).`, actions: [{ label: "Remove page break", target: actionTarget, patch: actionTarget === "band" ? { newPageBefore: false } : { pageBreakBefore: false } }] });
      newPage();
    }

    // keep-with-next *chains*: a run of consecutive keepWithNext components (a group header + its first records,
    // a whole keep-together group, a band and its child bands) must start on a page where the whole run fits.
    const prevKept = idx > 0 && Boolean((components[idx - 1] as any).keepWithNext);
    if (anyC.keepWithNext && !prevKept && idx + 1 < components.length && y > 0) {
      const freshRoom = availablePageHeight(pages.length - 1) - repeatHeight();
      let combined = 0;
      let members = 0;
      let k = idx;
      for (; k < components.length; k++) {
        const c = components[k]!;
        const cm = marginOf(c);
        const n = layoutComponent(c, { x: 0, y: 0, width: Math.max(1, width - cm.left - cm.right), height: 0 }, measurer);
        combined += n.box.height + cm.top + cm.bottom;
        members++;
        if (combined > freshRoom || !(c as any).keepWithNext) break;
      }
      if (combined > remaining() && combined <= freshRoom) {
        const names = components.slice(idx, idx + members).map((c) => ((c as any).band?.name ?? (c as any).id ?? c.type) as string);
        decide({
          kind: members > 2 ? "keep-chain" : "keep-with-next",
          componentId: anyC.id,
          ...source,
          message:
            members > 2
              ? `${label(component)} is kept together with the ${members - 1} elements after it (${[...new Set(names)].slice(0, 3).join(", ")}): they need ${pt(combined)} but only ${pt(remaining())} is left.`
              : `${label(component)} is kept with the next element; together they need ${pt(combined)} but only ${pt(remaining())} is left.`,
          required: combined,
          available: remaining(),
          actions: [{ label: "Release keep-with-next", target: actionTarget, patch: { keepWithNext: false } }],
        });
        newPage();
      }
    }

    const textComponent = ["text", "richText", "field"].includes(component.type);
    const textStyle = (component.style ?? {}) as Record<string, any>;
    const textPad = edgesOf(textStyle.padding);
    const textFontSize = textStyle.fontSize ?? 10;
    const textHint = { family: textStyle.fontFamily, pdfFontFace: textStyle.pdfFontFace, bold: textStyle.fontWeight === "bold" || (typeof textStyle.fontWeight === "number" && textStyle.fontWeight >= 700), italic: Boolean(textStyle.italic), lineHeight: textStyle.lineHeight };
    const textProbe = textComponent ? layoutComponent(component, { x: 0, y: y + m.top, width: innerWidth, height: 0 }, measurer) : undefined;
    const textLines = textComponent ? wrapTextLines(anyC.text ?? "", Math.max(1, textProbe!.box.width - textPad.left - textPad.right), textFontSize, measurer, textHint) : [];
    const lineHeight = textComponent ? measurer.lineHeight(textFontSize, textHint) : 0;
    const textHeight = textLines.length * lineHeight + textPad.top + textPad.bottom;
    const canSplitText = textComponent && textStyle.overflow !== "ellipsis" && lineHeight > 0 && anyC.height === undefined && anyC.minHeight === undefined && anyC.maxHeight === undefined && !anyC.keepTogether && anyC.allowSplit !== false;
    const splitText = canSplitText && textHeight + m.top + m.bottom > remaining() && (anyC.allowSplit === true || textHeight + m.top + m.bottom > availablePageHeight(pages.length - 1) - repeatHeight());

    if (splitText) {
      let start = 0;
      const minBottom = Math.max(1, Number(anyC.minLinesAtBottom) || 1);
      const minTop = Math.max(1, Number(anyC.minLinesAtTop) || 1);
      while (start < textLines.length) {
        const capacity = Math.floor((remaining() - m.top - m.bottom - textPad.top - textPad.bottom + 0.01) / lineHeight);
        const fresh = currentPage().every((node) => Boolean((node.component as any).band?.repeated));
        if (capacity < 1) {
          if (fresh) throw new Error(`Text ${label(component)} cannot fit even one line in the available page area.`);
          decide({ kind: "text-split", componentId: anyC.id, message: `${label(component)} continues on the next page because no line fits in the ${pt(Math.max(0, remaining()))} left.`, required: lineHeight + textPad.top + textPad.bottom, available: remaining() });
          newPage();
          continue;
        }
        const left = textLines.length - start;
        let take = Math.min(left, capacity);
        if (take < left && take < minBottom && !fresh) {
          decide({ kind: "orphan-control", componentId: anyC.id, message: `${label(component)} moves to the next page so at least ${minBottom} lines stay below the break.`, required: minBottom * lineHeight + textPad.top + textPad.bottom, available: remaining() });
          newPage();
          continue;
        }
        if (take < left && left - take < minTop) {
          const adjusted = left - minTop;
          if (adjusted >= minBottom) {
            take = adjusted;
            decide({ kind: "widow-control", componentId: anyC.id, message: `${label(component)} keeps at least ${minTop} lines at the top of the next page.`, required: minTop * lineHeight + textPad.top + textPad.bottom, available: remaining() });
          } else if (!fresh) {
            decide({ kind: "widow-control", componentId: anyC.id, message: `${label(component)} moves to the next page to avoid leaving fewer than ${minTop} lines at the top.`, required: minTop * lineHeight + textPad.top + textPad.bottom, available: remaining() });
            newPage();
            continue;
          } else {
            warnings.push({ code: "TEXT_WIDOW_LIMIT_UNSATISFIED", path: anyC.id ?? component.type, message: `Text ${label(component)} cannot satisfy its minimum lines at the top and bottom of a page.` });
          }
        }
        const end = start + take;
        const fragment = textLines.slice(start, end).join("\n");
        const node = layoutComponent({ ...component, text: fragment } as ResolvedComponent, { x: m.left, y: y + m.top, width: innerWidth, height: 0 }, measurer);
        node.component = component;
        node.box.height = take * lineHeight + textPad.top + textPad.bottom;
        node.textFragment = { text: fragment, startLine: start, endLine: end, totalLines: textLines.length };
        place(node);
        y = node.box.y + node.box.height + m.bottom;
        start = end;
        if (start < textLines.length) {
          decide({ kind: "text-split", componentId: anyC.id, message: `${label(component)} continues on page ${pages.length + 1} at line ${start + 1} of ${textLines.length}.`, required: (textLines.length - start) * lineHeight, available: remaining() });
          newPage();
        }
      }
    } else if (component.type === "table" && !anyC.keepTogether) {
      if (typeof anyC.freePageY === "number") y = anyC.freePageY;
      const tableX = component.x === undefined ? m.left : (resolveDimension(component.x, width, "pt") ?? 0) + m.left;
      placeTable(component as ResolvedTableComponent, innerWidth, measurer, {
        place: (node, height) => {
          node.box.y = y;
          node.box.x = tableX;
          currentPage().push(node);
          y += height;
        },
        remaining,
        freshRoom: () => availablePageHeight(pages.length - 1) - repeatHeight(),
        isFresh: () => currentPage().every((node) => Boolean((node.component as any).band?.repeated)),
        newPage,
        decide,
      });
      y += m.bottom;
    } else {
      const probe = textProbe ?? layoutComponent(component, { x: 0, y: y + m.top, width: innerWidth, height: 0 }, measurer);
      const needed = probe.box.height + m.top + m.bottom;
      const fitsCurrent = needed <= remaining();
      const fitsFresh = needed <= availablePageHeight(pages.length - 1) - repeatHeight();
      const repeatRoomAt = (offset: number) => {
        if (offset === 0) return remaining();
        const height = availablePageHeight(pages.length - 1 + offset);
        const repeated = repeatStack.length ? repeatMeasure().total : 0;
        return height - (repeated > height * 0.4 ? 0 : repeated);
      };
      const rowPlan = !fitsFresh ? planTallRow(component, probe, measurer, m, repeatRoomAt) : undefined;

      if (rowPlan) {
        const bandType = band?.type ? band.type[0]!.toUpperCase() + band.type.slice(1).replace(/([A-Z])/g, " $1") : undefined;
        const rowName = (component as any).band?.name ?? bandType ?? anyC.id ?? component.type;
        const minimumSpace = (slice: RowSlice) => m.top + m.bottom + edgesOf(anyC.style?.padding).bottom + Math.max(0, ...rowPlan.children.map((child, index) => {
          if (!slice.take[index]) return 0;
          return child.y + (child.blocks ? Math.min(...child.blocks.map((block) => block.height)) + child.padding!.top + child.padding!.bottom : child.lines ? child.lineHeight! + child.padding!.top + child.padding!.bottom : child.node.box.height);
        }));
        if (rowPlan.startOnNext) {
          decide({ kind: "row-split", componentId: anyC.id, ...source, required: minimumSpace(rowPlan.slices[0]!), available: remaining(), message: `Row "${rowName}" starts on the next page so its side-by-side content has room for at least one line.` });
          newPage();
        }
        const starts = rowPlan.children.map(() => 0);
        rowPlan.slices.forEach((slice, index) => {
          if (index > 0) {
            decide({ kind: "row-split", componentId: anyC.id, ...source, required: minimumSpace(slice), available: remaining(), message: rowPlan.children.some((child) => child.blocks)
              ? `Row "${rowName}" continues on page ${pages.length + 1}; its columns hold more items than fit on the previous page, and items are never cut.`
              : `Row "${rowName}" continues on page ${pages.length + 1}; its text columns have more lines than fit on the previous page.` });
            newPage();
          }
          const rowX = m.left;
          const rowY = y + m.top;
          const children: PositionedNode[] = [];
          rowPlan.children.forEach((child, childIndex) => {
            const count = slice.take[childIndex]!;
            if (!count) return;
            if (child.blocks) {
              const start = starts[childIndex]!;
              const taken = child.blocks.slice(start, start + count);
              const offset = start === 0 ? 0 : taken[0]!.top - child.padding!.top;
              const last = taken[taken.length - 1]!;
              const dx = rowX + child.x - child.node.box.x;
              const dy = rowY + child.y - child.node.box.y - offset;
              children.push({ ...child.node, box: { ...child.node.box, x: rowX + child.x, y: rowY + child.y, height: last.top + last.height - offset + child.padding!.bottom }, children: offsetNodes(taken.map((block) => block.node), dx, dy) });
              starts[childIndex] = start + count;
            } else if (child.lines) {
              const start = starts[childIndex]!;
              const end = start + count;
              children.push({ ...child.node, box: { ...child.node.box, x: rowX + child.x, y: rowY + child.y, height: count * child.lineHeight! + child.padding!.top + child.padding!.bottom }, textFragment: { text: child.lines.slice(start, end).join("\n"), startLine: start, endLine: end, totalLines: child.lines.length } });
              starts[childIndex] = end;
            } else {
              children.push(offsetNodes([child.node], rowX + child.x - child.node.box.x, rowY + child.y - child.node.box.y)[0]!);
            }
          });
          const fragment: PositionedNode = { component, box: { x: rowX, y: rowY, width: probe.box.width, height: slice.height }, children };
          place(fragment);
          y = fragment.box.y + fragment.box.height + m.bottom;
        });
      } else {
        let moved = false;

        if (!fitsCurrent && y > 0) {
          if (fitsFresh) {
            const keep = Boolean(anyC.keepTogether);
            decide({
              kind: keep ? "keep-together" : "cannot-split",
              componentId: anyC.id,
              ...source,
              message: keep
                ? `${label(component)} is set to keep together: it needs ${pt(needed)} but only ${pt(remaining())} is left, so it moves to the next page.`
                : `${label(component)} cannot be split across pages: it needs ${pt(needed)} but only ${pt(remaining())} is left, so it moves to the next page.`,
              required: needed,
              available: remaining(),
              actions: keep ? [{ label: "Allow split", target: actionTarget, patch: { keepTogether: false } }] : undefined,
            });
            newPage();
            moved = true;
          } else {
            decide({ kind: "overflow", componentId: anyC.id, message: `${label(component)} (${pt(needed)}) is taller than a whole page and will overflow.`, required: needed, available: pageHeight() });
            warnings.push({
              code: "CONTENT_OVERFLOWS_PAGE",
              path: anyC.id ?? component.type,
              message: `Component ${label(component)} is taller than a full page and will overflow; manual splitting of this component type is not yet supported.`,
            });
            newPage();
            moved = true;
          }
        } else if (!fitsFresh) {
          warnings.push({
            code: "CONTENT_OVERFLOWS_PAGE",
            path: anyC.id ?? component.type,
            message: `Component ${label(component)} is taller than a full page and will overflow; manual splitting of this component type is not yet supported.`,
          });
        }

        const placed = moved ? layoutComponent(component, { x: m.left, y: y + m.top, width: innerWidth, height: 0 }, measurer) : probe;
        if (!moved) shiftNode(placed, m.left, 0);
        if (component.type === "table") (placed as PositionedNode).rowRange = { start: 0, end: (component as ResolvedTableComponent).rows.length };
        place(placed);
        y = placed.box.y + placed.box.height + m.bottom;
      }
    }

    if (anchorBottom && anyC.band?.printAtBottom) {
      const node = currentPage().find((n) => n.component === component);
      const free = remaining();
      if (node && free > 0.01) {
        shiftNode(node, 0, free);
        y = pageHeight();
        decide({ kind: "print-at-bottom", componentId: anyC.id, ...source, message: `${label(component)} prints at the bottom of page ${pages.length}, so the content after it starts a new page.`, actions: [{ label: "Print directly after the content", target: "band", patch: { printAtBottom: false } }] });
      }
    }

    if (band?.type === "groupHeader" && band.repeatEveryPage) {
      let entry = repeatStack.find((e) => e.instance === band.instance && e.level === (band.level ?? 0));
      if (!entry) repeatStack.push((entry = { level: band.level ?? 0, instance: band.instance ?? -1, comps: [] }));
      entry.comps.push(component);
    }
    if (band?.type === "groupFooter") for (let k = repeatStack.length - 1; k >= 0; k--) if (repeatStack[k]!.level >= (band.level ?? 0)) repeatStack.splice(k, 1);

    if (anyC.pageBreakAfter) {
      newPage();
      decisions.push({ kind: "forced-break", page: pages.length, componentId: anyC.id, ...source, message: `A page break follows ${label(component)}.`, actions: [{ label: "Remove page break", target: actionTarget, patch: actionTarget === "band" ? { newPageAfter: false } : { pageBreakAfter: false } }] });
    }
  }

  // Drop a trailing empty page created by a forced break with nothing after it.
  if (pages.length > 1 && pages[pages.length - 1]!.length === 0) pages.pop();
  fillMissingPageBreakDecisions(pages, decisions, pageHeightAt);
  return { pages, decisions: decisions.filter((d) => d.page <= pages.length), warnings, subreportPageFrames, subreportFrames };
}

/** Guard the page-level debugger against a new pagination path with no log entry. */
export function fillMissingPageBreakDecisions(
  pages: PositionedNode[][],
  decisions: PaginationDecision[],
  pageHeightAt: (pageIndex: number) => number,
): void {
  // Every actual page start needs a reason, even when an unusual component
  // path created a boundary without going through one of the named rules.
  for (let pageIndex = 1; pageIndex < pages.length; pageIndex++) {
    const pageNumber = pageIndex + 1;
    if (decisions.some((d) => d.page === pageNumber && d.kind !== "group-header-repeated")) continue;
    const first = pages[pageIndex]!.find((node) => !(node.component as any).band?.repeated);
    if (!first) continue;
    const previous = pages[pageIndex - 1]!;
    const used = Math.max(0, ...previous.map((node) => node.box.y + node.box.height));
    const available = Math.max(0, pageHeightAt(pageIndex - 1) - used);
    const m = marginOf(first.component);
    const required = first.box.height + m.top + m.bottom;
    const band = (first.component as any).band;
    decisions.push({
      kind: "flow-break",
      page: pageNumber,
      componentId: (first.component as any).id,
      sectionIndex: band?.sectionIndex,
      sectionId: band?.sectionId,
      required,
      available,
      message: required > available + 0.5
        ? `${label(first.component)} starts on page ${pageNumber}: its measured box needs ${pt(required)}, with ${pt(available)} left in the previous page's body.`
        : `${label(first.component)} starts on page ${pageNumber} after content flow. The engine did not record a more specific rule for this boundary.`,
    });
  }
}

interface TablePlacer {
  place(node: PositionedNode, height: number): void;
  remaining(): number;
  freshRoom(): number;
  isFresh(): boolean;
  newPage(): void;
  decide(d: Omit<PaginationDecision, "page">): void;
}

function placeTable(
  input: ResolvedTableComponent,
  width: number,
  measurer: TextMeasurer,
  placer: TablePlacer
): void {
  // Splitting a row (allowRowSplit) replaces the table with one that has an extra row, so these are reassigned.
  let table = input;
  const columnWidths = resolveColumnWidths(table, width);
  let rowHeights = measureTableRowHeights(table, columnWidths, measurer);
  const headerRowHeights = table.showHeader ? measureHeaderRowHeights(table, columnWidths, measurer) : [];
  const headerHeight = headerRowHeights.reduce((sum, height) => sum + height, 0);
  const footerHeight = table.showFooter ? measureFooterHeight(table, measurer) : 0;
  // Explicit table height reserves space after the measured rows. A table may
  // grow beyond it when data requires more room; rows are never compressed.
  const naturalHeight = (table.showHeader ? headerHeight : 0) + rowHeights.reduce((sum, height) => sum + height, 0) + footerHeight;
  const extraHeight = Math.max(0, (resolveDimension(table.height, 0, "pt") ?? 0) - naturalHeight);
  const tid = (table as any).id as string | undefined;

  const minBefore = table.minRowsBeforeBreak ?? 0;
  const minAfter = table.minRowsAfterBreak ?? 0;
  const safeBreakBefore = (proposed: number): number => {
    let point = proposed;
    let changed = true;
    while (changed) {
      changed = false;
      for (const span of table.cellSpans ?? []) {
        // Repeated-value merges split instead: the value prints again at the top of the next page.
        if (span.splittable) continue;
        if (span.row < point && span.row + (span.rowSpan ?? 1) > point) {
          point = span.row;
          changed = true;
        }
      }
    }
    return point;
  };

  let rowIndex = 0;
  let sliceStart = 0;
  let isFirstSlice = true;
  let orphanPushAttempted = false;

  const flushSlice = (end: number, includeFooter: boolean) => {
    const showHeaderOnThisSlice = isFirstSlice ? table.showHeader : table.showHeader && table.repeatHeaderOnPageBreak;
    let height = showHeaderOnThisSlice ? headerHeight : 0;
    for (let i = sliceStart; i < end; i++) height += rowHeights[i]!;
    if (includeFooter) height += footerHeight;
    if (end === table.rows.length && (includeFooter || !table.showFooter)) height += extraHeight;

    if (height > placer.remaining() && height <= placer.freshRoom() && !placer.isFresh()) placer.newPage();

    const node: PositionedNode = {
      component: { ...table, showHeader: showHeaderOnThisSlice, showFooter: includeFooter, ...(table.cellSpans?.length ? { cellSpans: sliceTableSpans(table.cellSpans, sliceStart, end) } : {}) },
      box: { x: 0, y: 0, width, height },
      rowRange: { start: sliceStart, end },
      tableMetrics: { headerRowHeights, rowHeights },
    };
    placer.place(node, height);
    sliceStart = end;
    isFirstSlice = false;
    orphanPushAttempted = false;
  };

  const remainingRowsFitOnFreshPage = (fromIndex: number): boolean => {
    let height = table.showHeader && table.repeatHeaderOnPageBreak ? headerHeight : 0;
    for (let i = fromIndex; i < table.rows.length; i++) height += rowHeights[i]!;
    return height <= placer.freshRoom();
  };

  const startHeight = () => (table.showHeader && table.repeatHeaderOnPageBreak ? headerHeight : 0);

  let sliceHeight = table.showHeader ? headerHeight : 0;
  while (rowIndex < table.rows.length) {
    const rowHeight = rowHeights[rowIndex]!;
    const wouldOverflow = sliceHeight + rowHeight > placer.remaining();

    if (wouldOverflow && table.allowRowSplit) {
      const split = splitTableRow(table, rowIndex, placer.remaining() - sliceHeight, columnWidths, measurer, styleFontSize(table));
      if (split) {
        placer.decide({
          kind: "row-split", componentId: tid, rowIndex,
          required: rowHeight, available: Math.max(0, placer.remaining() - sliceHeight),
          message: `Row ${rowIndex + 1} of table ${tid ? `"${tid}" ` : ""}needs ${pt(rowHeight)} but ${pt(Math.max(0, placer.remaining() - sliceHeight))} is left, so its remaining lines continue on the next page.`,
          actions: [{ label: "Keep rows whole", target: "component", patch: { allowRowSplit: false } }],
        });
        table = split;
        rowHeights = measureTableRowHeights(table, columnWidths, measurer);
        continue;
      }
    }

    if (wouldOverflow && rowIndex > sliceStart) {
      const roomRows = rowIndex - sliceStart;
      const rowsLeft = table.rows.length - sliceStart;
      const minimumHeight = (isFirstSlice ? (table.showHeader ? headerHeight : 0) : startHeight())
        + rowHeights.slice(sliceStart, sliceStart + minBefore).reduce((sum, height) => sum + height, 0);
      if (roomRows < minBefore && rowsLeft >= minBefore && minimumHeight <= placer.freshRoom() && !placer.isFresh() && !orphanPushAttempted) {
        orphanPushAttempted = true;
        placer.decide({
          kind: "orphan-control",
          componentId: tid,
          rowIndex: sliceStart,
          required: minimumHeight,
          available: placer.remaining(),
          message: `Only ${roomRows} table row${roomRows === 1 ? "" : "s"} fit here. The minimum of ${minBefore} needs ${pt(minimumHeight)}, with ${pt(placer.remaining())} left; rows starting at ${sliceStart + 1} move to the next page.`,
          actions: roomRows > 0 ? [{ label: `Allow ${roomRows} row${roomRows === 1 ? "" : "s"} here`, target: "component", patch: { minRowsBeforeBreak: roomRows } }] : undefined,
        });
        placer.newPage();
        sliceHeight = isFirstSlice ? (table.showHeader ? headerHeight : 0) : startHeight();
        rowIndex = sliceStart;
        continue;
      }

      let breakPoint = rowIndex;
      const remainder = table.rows.length - breakPoint;
      let widowPullback = 0;
      if (remainder > 0 && remainder < minAfter && remainingRowsFitOnFreshPage(breakPoint)) {
        const maxPullback = breakPoint - sliceStart - minBefore;
        const pullback = Math.min(minAfter - remainder, Math.max(0, maxPullback));
        if (pullback > 0) {
          breakPoint -= pullback;
          widowPullback = pullback;
        }
      }

      const beforeSpans = breakPoint;
      breakPoint = safeBreakBefore(breakPoint);
      const spanAdjusted = breakPoint < beforeSpans;
      if (widowPullback > 0) placer.decide({
        kind: "widow-control",
        componentId: tid,
        rowIndex: breakPoint,
        message: `The last page would start with ${remainder} table row(s), below the minimum of ${minAfter}. ${widowPullback} row(s) move with them${spanAdjusted ? ", with merged cells moving more" : ""}; the final page now starts with ${table.rows.length - breakPoint}.`,
        actions: !spanAdjusted && remainder > 0 ? [{ label: `Allow ${remainder} row${remainder === 1 ? "" : "s"} on the last page`, target: "component", patch: { minRowsAfterBreak: remainder } }] : undefined,
      });
      if (spanAdjusted) placer.decide({
        kind: "merged-cell",
        componentId: tid,
        rowIndex: breakPoint,
        message: `A merged cell crosses the proposed break before row ${beforeSpans + 1}. Rows starting at ${breakPoint + 1} move together to the next page.`,
      });
      if (breakPoint === sliceStart) {
        if (!placer.isFresh()) {
          placer.decide({ kind: "keep-together", componentId: tid, rowIndex: sliceStart, message: `Merged table rows starting at row ${sliceStart + 1} move together to the next page.` });
          placer.newPage();
          rowIndex = sliceStart;
          sliceHeight = isFirstSlice ? (table.showHeader ? headerHeight : 0) : startHeight();
          continue;
        }
        throw new Error(`Merged table rows starting at row ${sliceStart + 1} are taller than a whole page.`);
      }

      flushSlice(breakPoint, false);
      const ordinarySplit = breakPoint === rowIndex;
      const available = placer.remaining();
      const required = rowHeights[breakPoint]!;
      placer.decide({
        kind: "table-split",
        componentId: tid,
        rowIndex: breakPoint,
        required: ordinarySplit ? required : undefined,
        available: ordinarySplit ? available : undefined,
        message: table.rows[breakPoint]?.continued
          ? `Table ${tid ? `"${tid}" ` : ""}continues on the next page with the rest of a split row.`
          : ordinarySplit
          ? `Table ${tid ? `"${tid}" ` : ""}continues on the next page: row ${breakPoint + 1} needs ${pt(required)} but only ${pt(Math.max(0, available))} is left. Rows are never cut in half.`
          : `Table ${tid ? `"${tid}" ` : ""}continues on the next page at row ${breakPoint + 1} after its minimum-row or merged-cell rule moved the break.`,
      });
      placer.newPage();
      sliceHeight = startHeight();
      rowIndex = breakPoint;
      continue;
    }
    if (wouldOverflow && rowIndex === sliceStart) {
      // Nothing of this table fits on the current page (the header plus one row is too tall): start on a new page.
      if (!placer.isFresh()) {
        placer.decide({ kind: "cannot-split", componentId: tid, rowIndex, required: sliceHeight + rowHeight, available: placer.remaining(), message: `Table ${tid ? `"${tid}" ` : ""}starts on the next page: its header and first row need ${pt(sliceHeight + rowHeight)} but only ${pt(placer.remaining())} is left.` });
        placer.newPage();
        sliceHeight = isFirstSlice ? (table.showHeader ? headerHeight : 0) : startHeight();
      } else {
        throw new Error(`Table row ${rowIndex + 1} is taller than a whole page. Set allowRowSplit on the table to let a row continue on the next page.`);
      }
    }

    sliceHeight += rowHeight;
    rowIndex++;
  }

  const footerFits = sliceHeight + footerHeight <= placer.remaining();
  if (!footerFits && table.showFooter) {
    const headerOnNext = (from: number) => table.showHeader && (from === sliceStart ? isFirstSlice || table.repeatHeaderOnPageBreak : table.repeatHeaderOnPageBreak) ? headerHeight : 0;
    const heightWithFooter = (from: number) => headerOnNext(from) + footerHeight + rowHeights.slice(from, rowIndex).reduce((sum, height) => sum + height, 0);
    let candidate: number | undefined;
    if (table.keepFooterTogether !== false) {
      const desiredRows = Math.min(rowIndex - sliceStart, Math.max(1, minAfter));
      for (let count = desiredRows; count >= 1; count--) {
        const start = safeBreakBefore(rowIndex - count);
        if (start < sliceStart || (start === sliceStart && placer.isFresh())) continue;
        if (heightWithFooter(start) <= placer.freshRoom()) { candidate = start; break; }
      }
    }
    if (candidate !== undefined) {
      const trailingRows = rowIndex - candidate;
      const neededTogether = heightWithFooter(candidate);
      if (candidate > sliceStart) flushSlice(candidate, false);
      placer.decide({
        kind: "keep-together", componentId: tid, rowIndex: candidate,
        required: neededTogether, available: placer.remaining(),
        message: `The totals row stays with ${trailingRows} table row${trailingRows === 1 ? "" : "s"} on the next page. Together they need ${pt(neededTogether)}, with ${pt(Math.max(0, placer.remaining()))} left here.`,
        actions: [{ label: "Allow totals on their own page", target: "component", patch: { keepFooterTogether: false } }],
      });
      placer.newPage();
      flushSlice(rowIndex, true);
    } else {
      const minimumTogether = rowIndex > sliceStart ? heightWithFooter(rowIndex - 1) : footerHeight;
      flushSlice(rowIndex, false);
      placer.decide({
        kind: "keep-together", componentId: tid, required: footerHeight, available: placer.remaining(),
        message: table.keepFooterTogether !== false
          ? `The totals row moves to the next page alone: the last data row and totals need ${pt(minimumTogether)}, or no data row can move without leaving an empty page.`
          : `The totals row needs ${pt(footerHeight)} but only ${pt(Math.max(0, placer.remaining()))} is left. It moves to the next page on its own as allowed.`,
      });
      placer.newPage();
      flushSlice(rowIndex, true);
    }
  } else {
    flushSlice(rowIndex, table.showFooter);
  }
}


/** The children a container can be dissolved into without changing what is printed (flow layout, no fixed size, no decoration). */
function flowParts(component: ResolvedComponent, width: number, measurer: TextMeasurer, pageY: number): ResolvedComponent[] | undefined {
  const c = component as any;
  if (c.type === "group") {
    return (c.groups ?? []).flatMap((g: any) => [...(g.header ?? []), ...(g.children ?? []), ...(g.footer ?? [])]);
  }
  if (!["container", "column", "repeater", "keepTogether"].includes(c.type)) return undefined;
  if (c.layout && c.layout !== "flow") return undefined;
  if (c.height !== undefined || c.minHeight !== undefined) return undefined;
  const st = c.style ?? {};
  if (st.background || st.border || st.padding) return undefined;
  if (!Array.isArray(c.children)) return undefined;
  const free = c.children.filter((child: any) => (child.x !== undefined || child.y !== undefined) && child.type !== "table");
  const freeTables = c.children.some((child: any) => child.type === "table" && (child.x !== undefined || child.y !== undefined));
  if (!free.length && !freeTables) return c.children;
  if (!c.children.some((child: any) => child.x === undefined && child.y === undefined) && !freeTables) return undefined;
  // A tall band can still paginate its flowing content. Place its free items
  // over the first band fragment. Spacers retain their original flow slots.
  const overlay = free.length ? { type: "container", layout: "absolute", height: 0, children: free, freeOverlay: true, band: c.band } as ResolvedComponent : undefined;
  const parts = c.children.map((child: ResolvedComponent) => {
    if (child.type === "table" && (child.x !== undefined || child.y !== undefined)) {
      return { ...child, freePageY: child.y === undefined ? undefined : pageY + (resolveDimension(child.y, 0, "pt") ?? 0) } as ResolvedComponent;
    }
    if (child.x === undefined && child.y === undefined) return child;
    const measured = layoutComponent({ ...child, x: undefined, y: undefined } as ResolvedComponent, { x: 0, y: 0, width, height: 0 }, measurer);
    return { type: "spacer", height: measured.box.height, style: { margin: (child.style as any)?.margin } } as ResolvedComponent;
  });
  return overlay ? [overlay, ...parts] : parts;
}
