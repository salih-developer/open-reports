import { SaxesParser } from "saxes";
import { parseReportDefinition, type ReportDefinition } from "@reporting/schema";
import { datePattern, FrxExpressionError, member, numberDigits, splitText, translateFrxExpression, type ResolveRef } from "./expression.js";

export { translateFrxExpression, FrxExpressionError } from "./expression.js";

export type MigrationStatus = "converted" | "needs-review" | "unsupported";
export type MigrationIssue = {
  status: MigrationStatus;
  feature: string;
  source: string;
  line: number;
  message: string;
  targetId?: string;
  original?: string;
};
export interface FrxImportOptions {
  id?: string;
  name?: string;
  sourceName?: string;
  /** Locale for numbers and dates; FastReport reports usually format for the machine's culture. Default tr-TR. */
  locale?: string;
  /** Currency for Format="Currency". Default TRY. */
  currency?: string;
}
export type FrxImportResult = {
  report?: ReportDefinition;
  issues: MigrationIssue[];
  summary: Record<MigrationStatus, number>;
};

type XmlNode = { name: string; attrs: Record<string, string>; text: string; children: XmlNode[]; path: string; line: number };
type Component = Record<string, unknown>;
type Style = Record<string, unknown>;
type Section = Record<string, unknown> & { id: string; type: string; children: Component[] };
/** Where a band's column references read from: the current record, or the first/last record of the dataset. */
type Scope = "row" | "first" | "last";
type DataSource = { name: string; alias: string; id: string; columns: { name: string; type: string }[] };
type Total = { name: string; expression: string; type: string; printOn: string; node: XmlNode };

/** 96 px per inch, the unit of FastReport object geometry. */
const pt = (px: number) => Math.round(px * 0.75 * 100) / 100;
const num = (value: string | undefined, fallback = 0) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) ? n : fallback;
};
const bool = (value: string | undefined) => value?.toLowerCase() === "true";

/** The .NET named colours that appear in FastReport files. */
const NAMED_COLORS: Record<string, string> = {
  Black: "#000000", White: "#ffffff", Silver: "#c0c0c0", DarkGray: "#a9a9a9", Gray: "#808080", DimGray: "#696969", Gainsboro: "#dcdcdc",
  LightGray: "#d3d3d3", WhiteSmoke: "#f5f5f5", Red: "#ff0000", DarkRed: "#8b0000", Maroon: "#800000", Green: "#008000", DarkGreen: "#006400",
  Blue: "#0000ff", Navy: "#000080", DarkBlue: "#00008b", RoyalBlue: "#4169e1", SteelBlue: "#4682b4", LightSteelBlue: "#b0c4de",
  LightBlue: "#add8e6", AliceBlue: "#f0f8ff", Yellow: "#ffff00", LightYellow: "#ffffe0", LemonChiffon: "#fffacd", Orange: "#ffa500",
  Purple: "#800080", Teal: "#008080", Beige: "#f5f5dc", Ivory: "#fffff0", Linen: "#faf0e6", Lavender: "#e6e6fa", Honeydew: "#f0fff0",
};

function color(value: string | undefined): string | undefined {
  if (!value || value === "Transparent") return undefined;
  if (NAMED_COLORS[value]) return NAMED_COLORS[value];
  const parts = value.split(",").map((p) => Number(p.trim()));
  if ((parts.length === 3 || parts.length === 4) && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    const [r, g, b] = parts.slice(-3) as [number, number, number];
    if (parts.length === 4 && parts[0] === 0) return undefined;
    return `#${[r, g, b].map((p) => p.toString(16).padStart(2, "0")).join("")}`;
  }
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

function local(name: string): string { return name.split(":").pop()!; }

function parseXml(xml: string): XmlNode {
  if (xml.length > 10_000_000) throw new Error("The report file exceeds the 10 MB import limit.");
  const parser = new SaxesParser({ xmlns: false });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodes = 0;
  parser.on("doctype", () => { throw new Error("DTDs and external entities are not allowed."); });
  parser.on("opentag", (tag) => {
    if (++nodes > 50_000 || stack.length >= 128) throw new Error("The report file exceeds the XML complexity limit.");
    const parent = stack.at(-1);
    const same = parent?.children.filter((c) => c.name === tag.name).length ?? 0;
    const node: XmlNode = {
      name: tag.name, attrs: tag.attributes as Record<string, string>, text: "", children: [],
      path: `${parent?.path ?? ""}/${local(tag.name)}[${same + 1}]`, line: parser.line,
    };
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("text", (value) => { if (stack.length) stack[stack.length - 1]!.text += value; });
  parser.on("cdata", (value) => { if (stack.length) stack[stack.length - 1]!.text += value; });
  parser.on("closetag", () => { stack.pop(); });
  parser.write(xml.replace(/^﻿/, "")).close();
  if (!root || local(root.name) !== "Report") throw new Error("The XML root must be a FastReport <Report>.");
  return root;
}

function* walk(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

const BAND_TYPES: Record<string, string> = {
  ReportTitleBand: "reportHeader", PageHeaderBand: "pageHeader", ColumnHeaderBand: "columnHeader", DataHeaderBand: "dataHeader",
  GroupHeaderBand: "groupHeader", DataBand: "detail", GroupFooterBand: "groupFooter", DataFooterBand: "dataFooter",
  ReportSummaryBand: "reportFooter", ColumnFooterBand: "columnFooter", PageFooterBand: "pageFooter", OverlayBand: "background", ChildBand: "child",
};
const SCOPES: Record<string, Scope> = {
  reportHeader: "first", pageHeader: "first", columnHeader: "first", reportFooter: "last", pageFooter: "last", columnFooter: "last", background: "first",
};

export function importFrx(xml: string, options: FrxImportOptions = {}): FrxImportResult {
  const issues: MigrationIssue[] = [];
  const summary: Record<MigrationStatus, number> = { converted: 0, "needs-review": 0, unsupported: 0 };
  const add = (status: MigrationStatus, feature: string, node: Pick<XmlNode, "path" | "line">, message: string, targetId?: string, original?: string) => {
    issues.push({ status, feature, source: node.path, line: node.line, message, ...(targetId ? { targetId } : {}), ...(original ? { original } : {}) });
    summary[status]++;
  };
  let root: XmlNode;
  try { root = parseXml(xml); }
  catch (error) {
    add("unsupported", "document", { path: "/", line: 0 }, (error as Error).message);
    return { issues, summary };
  }
  const dictionary = root.children.find((c) => local(c.name) === "Dictionary");
  const pages = root.children.filter((c) => local(c.name) === "ReportPage");
  const page = pages[0];
  if (!page) {
    add("unsupported", "report page", root, "The file has no ReportPage; dialog-only reports cannot be imported.");
    return { issues, summary };
  }
  for (const extra of pages.slice(1)) add("unsupported", "report page", extra, `Only the first page is imported; "${extra.attrs.Name}" needs to be rebuilt or imported as its own report.`);
  for (const node of root.children.filter((c) => local(c.name) === "DialogPage")) add("unsupported", "dialog page", node, "Dialog pages are not imported; report parameters replace them.");

  // ---------------------------------------------------------------- dictionary
  const sources: DataSource[] = [];
  const parameters: Array<{ id: string; type: string }> = [];
  const totals = new Map<string, Total>();
  for (const node of dictionary ? walk(dictionary) : []) {
    const kind = local(node.name);
    if (kind === "TableDataSource" || kind === "BusinessObjectDataSource") {
      const name = node.attrs.Name ?? `source${sources.length + 1}`;
      const id = sources.length === 0 ? "rows" : name.replace(/[^A-Za-z0-9_]/g, "_");
      const columns = node.children.filter((c) => local(c.name) === "Column").map((c) => ({ name: c.attrs.Name ?? "", type: c.attrs.DataType ?? "System.String" }));
      sources.push({ name, alias: node.attrs.Alias ?? name, id, columns });
      if (node.attrs.SelectCommand?.trim()) add("needs-review", "data source query", node, "The data source's SQL was not imported; the host application supplies the rows for this dataset.", id, node.attrs.SelectCommand);
    } else if (kind === "Parameter" && dictionary && node !== dictionary) {
      const id = node.attrs.Name;
      if (!id || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
        add("unsupported", "parameter", node, `Parameter "${id}" is not a valid parameter name.`);
        continue;
      }
      parameters.push({ id, type: dataKind(node.attrs.DataType) === "number" ? "number" : dataKind(node.attrs.DataType) === "boolean" ? "boolean" : dataKind(node.attrs.DataType) === "date" ? "date" : "string" });
      if (node.attrs.Expression) add("needs-review", "parameter default", node, "The parameter's default expression was not imported; the host supplies its value.", id, node.attrs.Expression);
    } else if (kind === "Total") {
      totals.set(node.attrs.Name ?? "", { name: node.attrs.Name ?? "", expression: node.attrs.Expression ?? "", type: node.attrs.TotalType ?? "Sum", printOn: node.attrs.PrintOn ?? "", node });
    } else if (kind.endsWith("DataConnection") && node.attrs.ConnectionString) {
      add("needs-review", "data connection", node, "The connection string was not imported.", undefined);
    }
  }
  if (!sources.length) add("needs-review", "data source", dictionary ?? root, "No table data source; the report only prints static content until a dataset is added.");
  const sourceByName = new Map<string, DataSource>();
  for (const source of sources) {
    sourceByName.set(source.alias.toLowerCase(), source);
    sourceByName.set(source.name.toLowerCase(), source);
  }
  const mainSource = sources[0];

  // ---------------------------------------------------------------- band pre-pass: names, types and groups
  let serial = 0;
  const nextId = (prefix = "frx") => `${prefix}-${++serial}`;
  const bandInfo = new Map<string, { type: string; groupId?: string; id: string; scope: Scope }>();
  const groupIds = new Map<XmlNode, string>();
  (function scan(node: XmlNode, parentScope: Scope | undefined, groupId: string | undefined) {
    for (const child of node.children) {
      const kind = local(child.name);
      const type = BAND_TYPES[kind];
      if (!type) continue;
      let ownGroup = groupId;
      if (kind === "GroupHeaderBand") {
        ownGroup = `group-${groupIds.size + 1}`;
        groupIds.set(child, ownGroup);
      }
      const scope: Scope = type === "child" ? (parentScope ?? "row") : SCOPES[type] ?? "row";
      bandInfo.set(child.attrs.Name ?? "", { type, groupId: type === "groupHeader" || type === "groupFooter" ? ownGroup : undefined, id: nextId("band"), scope });
      scan(child, scope, ownGroup);
    }
  })(page, undefined, undefined);

  // ---------------------------------------------------------------- expressions
  const columnPath = (source: DataSource, column: string, scope: Scope) => {
    const real = source.columns.find((c) => c.name.toLowerCase() === column.toLowerCase())?.name ?? column;
    if (scope === "row") return member("row", real);
    const rows = `data.${source.id}`;
    return member(scope === "first" ? `${rows}[0]` : `${rows}[count(${rows}) - 1]`, real);
  };
  const variables: Array<{ id: string; scope: "row"; expression: string; resetOn?: string }> = [];
  const totalCache = new Map<string, string | undefined>();
  /**
   * A plain column total becomes an aggregate over the group's, the page's or the dataset's rows. A total with a
   * condition, a computed expression or a running (not reset) value becomes a row variable that accumulates in print
   * order, which is how FastReport evaluates it. On a page header or footer a running total is the carried-forward
   * value (devreden / nakli yekûn): the variable before or after the page's records.
   */
  const totalExpression = (total: Total): string | undefined => {
    if (totalCache.has(total.name)) return totalCache.get(total.name);
    totalCache.set(total.name, undefined);
    const band = bandInfo.get(total.printOn);
    const groupScope = band?.type === "groupFooter" || band?.type === "groupHeader";
    const pageScope = band?.type === "pageHeader" || band?.type === "pageFooter";
    const source = mainSource;
    if (!source) return undefined;
    const rows = groupScope ? "group.rows" : pageScope ? "page.rows" : `data.${source.id}`;
    const ref = /^\[([^\]]+)\]$/.exec(total.expression.trim())?.[1];
    const column = ref?.includes(".") ? ref.slice(ref.indexOf(".") + 1) : undefined;
    const field = (name: string) => JSON.stringify(source.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ?? name);
    const type = total.type || "Sum";
    const condition = total.node.attrs.EvaluateCondition;
    const running = total.node.attrs.ResetAfterPrint === "false";
    /** A row variable that adds up the total's value (1 for Count) on every record that meets its condition. */
    const runningVariable = (resetOn?: string): string | undefined => {
      const value = type === "Count" ? "1" : translate(total.expression, "row", "total expression", total.node, total.name);
      const when = condition ? translate(condition, "row", "total condition", total.node, total.name) : "true";
      if (value === undefined || when === undefined) return undefined;
      let id = total.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
      while (variables.some((v) => v.id === id)) id += "_";
      variables.push({ id, scope: "row", expression: `(vars.${id} ?? 0) + (${when} ? (${value} ?? 0) : 0)`, ...(resetOn ? { resetOn } : {}) });
      return id;
    };
    let result: string | undefined;
    if (pageScope && running && (type === "Sum" || type === "Count")) {
      const id = runningVariable();
      if (id) result = `(page.${band!.type === "pageHeader" ? "start" : "end"}.${id} ?? 0)`;
    } else if (!condition && !running && type === "Count") result = `count(${rows})`;
    else if (!condition && !running && column) {
      const fn = ({ Sum: "sumBy", Avg: "avgBy", Min: "minBy", Max: "maxBy" } as Record<string, string>)[type];
      result = fn ? `${fn}(${rows}, ${field(column)})` : undefined;
    } else if (type === "Sum" || type === "Count") {
      const id = runningVariable(groupScope && !running ? band?.groupId : undefined);
      // On a page band a reset total is this page's share of the running value; elsewhere the running value itself.
      // Bands printed before the first record (headers) read the variable before it has a value.
      if (id) result = pageScope ? `((page.end.${id} ?? 0) - (page.start.${id} ?? 0))` : `(vars.${id} ?? 0)`;
    } else add("needs-review", "total", total.node, `${type} totals with a condition or a computed expression need to be rebuilt by hand.`, total.name, total.expression);
    totalCache.set(total.name, result);
    return result;
  };
  const reportedTotals = new Set<string>();
  const resolverFor = (scope: Scope, targetId: string): ResolveRef => (name) => {
    const dot = name.indexOf(".");
    if (dot > 0) {
      const source = sourceByName.get(name.slice(0, dot).toLowerCase());
      if (source) return columnPath(source, name.slice(dot + 1), scope);
    }
    if (name === "Page#" || name === "Page") return "page.number";
    if (name === "TotalPages#" || name === "TotalPages") return "page.total";
    if (name === "Date") return "now()";
    if (parameters.some((p) => p.id === name)) return member("params", name);
    const total = totals.get(name);
    if (total) {
      const expression = totalExpression(total);
      if (expression && !reportedTotals.has(name)) {
        reportedTotals.add(name);
        if (expression.startsWith("(page.")) add("converted", "carried-forward total", total.node, `Total "${name}" carries its running value from page to page as ${expression}.`, targetId);
        else if (expression.startsWith("(vars.") || expression.startsWith("((page.")) add("needs-review", "total", total.node, `Total "${name}" became the running variable ${expression}; compare it with the FastReport output.`, targetId);
      }
      return expression;
    }
    return undefined;
  };
  /** Translates an expression; on failure records why and returns undefined. */
  const translate = (source: string, scope: Scope, feature: string, node: XmlNode, targetId: string): string | undefined => {
    try { return translateFrxExpression(source, resolverFor(scope, targetId)); }
    catch (error) {
      const reason = error instanceof FrxExpressionError ? error.message : "The expression could not be read.";
      add("needs-review", feature, node, `${reason} Translate it by hand.`, targetId, source);
      return undefined;
    }
  };

  // ---------------------------------------------------------------- styles
  const fontStyle = (font: string | undefined, style: Style) => {
    const value = font ?? "Arial, 10pt";
    const size = /([\d.]+)pt/.exec(value)?.[1];
    style.fontSize = size ? Number(size) : 10;
    const flags = /style=([^,]+(?:,\s*(?:Bold|Italic|Underline|Strikeout))*)/.exec(value)?.[1] ?? "";
    style.fontWeight = /Bold/.test(flags) ? "bold" : "normal";
    if (/Italic/.test(flags)) style.italic = true;
    if (/Underline/.test(flags)) style.underline = true;
    if (/Strikeout/.test(flags)) style.strikethrough = true;
  };
  const borderStyle = (node: XmlNode | Record<string, string>, style: Style) => {
    const attrs = "attrs" in node ? (node as XmlNode).attrs : (node as Record<string, string>);
    const lines = attrs["Border.Lines"];
    if (!lines || lines === "None") return;
    const dash = attrs["Border.Style"];
    const side = {
      width: pt(num(attrs["Border.Width"], 1)),
      style: dash === "Dot" ? "dotted" : dash === "Dash" || dash === "DashDot" || dash === "DashDotDot" ? "dashed" : "solid",
      color: color(attrs["Border.Color"]) ?? "#000000",
    };
    const sides = lines === "All" ? ["Left", "Right", "Top", "Bottom"] : lines.split(",").map((s) => s.trim());
    style.border = sides.length === 4 ? side : Object.fromEntries(sides.map((s) => [s.toLowerCase(), side]));
  };
  const geometry = (node: XmlNode): Component => ({
    x: `${pt(num(node.attrs.Left))}pt`, y: `${pt(num(node.attrs.Top))}pt`,
    width: `${pt(Math.max(0, num(node.attrs.Width)))}pt`, height: `${pt(Math.max(0, num(node.attrs.Height)))}pt`,
  });

  type FormatInfo = { format?: string; wrap?: (value: string) => string; kind?: "number" | "date" };
  /** Format string, the function that formats one value the same way inside a composed text, and the value kind it applies to. */
  const formatOf = (node: XmlNode, targetId: string): FormatInfo => {
    const kind = node.attrs.Format;
    if (!kind || kind === "General") return {};
    if (kind === "Number") {
      const digits = num(node.attrs["Format.DecimalDigits"], 2);
      const grouped = node.attrs["Format.UseLocale"] !== "false" || (node.attrs["Format.GroupSeparator"] ?? ".") !== "";
      return { format: `number:${digits}${grouped ? "" : ":plain"}`, wrap: (v) => `formatNumber(${v}, ${digits})`, kind: "number" };
    }
    if (kind === "Currency") return { format: `currency:${options.currency ?? "TRY"}`, wrap: (v) => `formatCurrency(${v})`, kind: "number" };
    if (kind === "Percent") return { format: "percent", wrap: (v) => `formatNumber((${v}) * 100, ${num(node.attrs["Format.DecimalDigits"], 0)}) + "%"`, kind: "number" };
    if (kind === "Date" || kind === "Time") {
      const pattern = datePattern(node.attrs["Format.Format"] ?? (kind === "Time" ? "T" : "d"));
      if (pattern) return { format: `date:${pattern}`, wrap: (v) => `formatDate(${v}, ${JSON.stringify(pattern)})`, kind: "date" };
    }
    if (kind === "Custom") {
      const custom = node.attrs["Format.Format"] ?? "";
      const digits = numberDigits(custom);
      const pattern = datePattern(custom);
      if (digits !== undefined) {
        if (/#$/.test(custom)) add("needs-review", "format", node, `Custom format "${custom}" drops trailing zeros in FastReport; it now always prints ${digits} decimals.`, targetId);
        return { format: `number:${digits}${custom.includes(",") ? "" : ":plain"}`, wrap: (v) => `formatNumber(${v}, ${digits})`, kind: "number" };
      }
      if (pattern) return { format: `date:${pattern}`, wrap: (v) => `formatDate(${v}, ${JSON.stringify(pattern)})`, kind: "date" };
    }
    add("needs-review", "format", node, `Format ${kind}${node.attrs["Format.Format"] ? ` "${node.attrs["Format.Format"]}"` : ""} has no equivalent; the value prints unformatted.`, targetId);
    return {};
  };
  /** The kind of value an imported expression produces, when it can be told: a column's declared type, a date, or a number. */
  const kindOf = (expression: string): string | undefined => {
    if (expression === "now()") return "date";
    if (/^(?:page\.(?:number|total)|(?:sumBy|avgBy|minBy|maxBy|count|sumProduct)\(|\(vars\.)/.test(expression)) return "number";
    if (!/^(?:row|data)[.[]/.test(expression)) return undefined;
    const name = /(?:\.([A-Za-z_$][\w$]*)|\["([^"]+)"\])$/.exec(expression);
    const column = sources.flatMap((s) => s.columns).find((c) => c.name === (name?.[1] ?? name?.[2]));
    return column ? dataKind(column.type) : undefined;
  };
  /** FastReport applies a number or date format only to values of that kind; a string under a date format prints as it is. */
  const fits = (info: FormatInfo, expression: string) => {
    const kind = kindOf(expression);
    return !info.kind || kind === undefined || kind === info.kind;
  };

  // ---------------------------------------------------------------- objects
  const placeholder = (node: XmlNode, feature: string, message: string, targetId = nextId()): Component => {
    add("unsupported", feature, node, message, targetId);
    return { id: targetId, type: "text", ...geometry(node), value: `[Migration review: ${feature}]`, style: { color: "#b91c1c", fontSize: 8, overflow: "clip" } };
  };

  const textObject = (node: XmlNode, scope: Scope): Component => {
    const targetId = nextId();
    const style: Style = {};
    fontStyle(node.attrs.Font, style);
    const align = node.attrs.HorzAlign;
    if (align && align !== "Left") style.align = align === "Center" ? "center" : align === "Right" ? "right" : "justify";
    const vertical = node.attrs.VertAlign;
    if (vertical && vertical !== "Top") style.verticalAlign = vertical === "Center" ? "middle" : "bottom";
    const textColor = color(node.attrs.TextColor ?? node.attrs["TextFill.Color"]);
    if (textColor && textColor !== "#000000") style.color = textColor;
    const fill = color(node.attrs["Fill.Color"]);
    if (fill) style.background = fill;
    borderStyle(node, style);
    // FastReport insets text by Padding (left, top, right, bottom in px); the default is 2, 0, 2, 0.
    const padding = (node.attrs.Padding ?? "2, 0, 2, 0").split(",").map((p) => pt(num(p.trim())));
    if (padding.some(Boolean)) style.padding = { left: padding[0] ?? 0, top: padding[1] ?? 0, right: padding[2] ?? 0, bottom: padding[3] ?? 0 };
    if (node.attrs.WordWrap === "false") style.wrap = false;
    const grows = bool(node.attrs.CanGrow);
    // A fixed FastReport box clips its text; a growing one is kept at its designed height and reviewed below.
    style.overflow = node.attrs.WordWrap === "false" && node.attrs.Trimming?.startsWith("Ellipsis") ? "ellipsis" : "clip";
    if (grows) add("needs-review", "can grow", node, "The text can grow in FastReport; it now keeps its designed height and clips longer text. Remove the height or make the band taller where long values occur.", targetId);
    const component: Component = { id: targetId, name: node.attrs.Name, type: "text", ...geometry(node), style };
    const formatInfo = formatOf(node, targetId);
    const { format, wrap } = formatInfo;
    const parts = (() => {
      try { return splitText(node.attrs.Text ?? ""); }
      catch { return undefined; }
    })();
    let valueExpression: string | undefined;
    if (!parts) {
      component.value = node.attrs.Text;
      add("needs-review", "text", node, "The text has an unclosed [ and was kept as literal text.", targetId, node.attrs.Text);
    } else if (parts.every((p) => "literal" in p)) {
      component.value = parts.map((p) => ("literal" in p ? p.literal : "")).join("");
    } else if (parts.length === 1 && "expression" in parts[0]!) {
      const source = parts[0].expression;
      const expression = translate(source, scope, "text expression", node, targetId);
      if (expression === undefined) {
        component.value = `[Migration review: ${source}]`;
        style.color = "#b91c1c";
      } else {
        if (/^(?:row|params|data|group|page)(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])+$/.test(expression)) component.binding = expression;
        else component.expression = expression;
        if (format && fits(formatInfo, expression)) component.format = format;
        valueExpression = expression;
      }
    } else {
      const pieces: string[] = [];
      let failed = false;
      for (const part of parts) {
        if ("literal" in part) { pieces.push(JSON.stringify(part.literal)); continue; }
        const expression = translate(part.expression, scope, "text expression", node, targetId);
        if (expression === undefined) { failed = true; pieces.push(JSON.stringify(`[${part.expression}]`)); continue; }
        pieces.push(wrap && fits(formatInfo, expression) ? wrap(expression) : `(${expression} ?? "")`);
      }
      component.expression = pieces.join(" + ");
      if (failed) style.color = "#b91c1c";
    }
    const rules: unknown[] = [];
    if (bool(node.attrs.HideZeros) && valueExpression) rules.push({ when: `${valueExpression} == 0`, set: { value: "" } });
    else if (bool(node.attrs.HideZeros)) add("needs-review", "hide zeros", node, "Zero values inside composed text are no longer hidden.", targetId);
    for (const condition of node.children.find((c) => local(c.name) === "Highlight")?.children ?? []) {
      const when = translate(condition.attrs.Expression ?? "", scope, "highlight condition", condition, targetId);
      if (!when) continue;
      const set: Record<string, unknown> = {};
      if (bool(condition.attrs.ApplyFont)) {
        const fontSet: Style = {};
        fontStyle(condition.attrs.Font, fontSet);
        for (const [key, value] of Object.entries(fontSet)) set[`style.${key}`] = value;
        for (const flag of ["italic", "underline", "strikethrough"]) if (!(flag in fontSet)) set[`style.${flag}`] = false;
      }
      if (condition.attrs.ApplyTextFill !== "false") {
        const text = color(condition.attrs["TextFill.Color"] ?? "Red");
        if (text) set["style.color"] = text;
      }
      const highlightFill = bool(condition.attrs.ApplyFill) ? color(condition.attrs["Fill.Color"]) : undefined;
      if (highlightFill) set["style.background"] = highlightFill;
      if (bool(condition.attrs.ApplyBorder)) {
        const borderSet: Style = {};
        borderStyle(condition.attrs, borderSet);
        if (borderSet.border) set["style.border"] = borderSet.border;
      }
      if (condition.attrs.Visible === "false") set.visible = false;
      if (Object.keys(set).length) rules.push({ when, set });
    }
    if (rules.length) component.rules = rules;
    if (node.attrs.VisibleExpression) {
      const visible = translate(node.attrs.VisibleExpression, scope, "visibility condition", node, targetId);
      if (visible) component.visibleWhen = visible;
    }
    if (node.attrs.Visible === "false") component.hidden = true;
    if (node.attrs.Duplicates && node.attrs.Duplicates !== "Show") add("needs-review", "duplicates", node, `Repeated values were ${node.attrs.Duplicates === "Hide" ? "hidden" : "merged"} in FastReport; they now print on every row.`, targetId);
    if (node.attrs.Angle && num(node.attrs.Angle) !== 0) add("unsupported", "rotated text", node, `Text rotated by ${node.attrs.Angle}° prints horizontally.`, targetId);
    if (node.attrs.NullValue) add("needs-review", "null text", node, `FastReport printed "${node.attrs.NullValue}" for empty values.`, targetId);
    return component;
  };

  const lineObject = (node: XmlNode): Component => {
    const targetId = nextId();
    const width = num(node.attrs.Width);
    const height = num(node.attrs.Height);
    const thickness = num(node.attrs["Border.Width"], 1);
    const lineColor = color(node.attrs["Border.Color"]) ?? "#000000";
    if (width !== 0 && height !== 0) return placeholder(node, "diagonal line", "Diagonal lines are not supported.", targetId);
    const vertical = width === 0;
    if (thickness > 1.5) {
      // The line component draws 1 pt; a thick rule becomes a filled bar of the same thickness.
      return {
        id: targetId, name: node.attrs.Name, type: "rectangle",
        x: `${pt(num(node.attrs.Left))}pt`, y: `${pt(num(node.attrs.Top))}pt`,
        width: `${pt(vertical ? thickness : width)}pt`, height: `${pt(vertical ? height : thickness)}pt`,
        style: { background: lineColor },
      };
    }
    if (node.attrs["Border.Style"] && node.attrs["Border.Style"] !== "Solid") add("needs-review", "line style", node, "Dashed and dotted lines print solid.", targetId);
    return {
      id: targetId, name: node.attrs.Name, type: "line", orientation: vertical ? "vertical" : "horizontal",
      x: `${pt(num(node.attrs.Left))}pt`, y: `${pt(num(node.attrs.Top))}pt`,
      width: `${pt(vertical ? 1 : width)}pt`, height: `${pt(vertical ? height : 1)}pt`,
      ...(lineColor !== "#000000" ? { style: { color: lineColor } } : {}),
    };
  };

  const objectFor = (node: XmlNode, scope: Scope): Component | undefined => {
    const kind = local(node.name);
    if (kind === "TextObject") return textObject(node, scope);
    if (kind === "LineObject") return lineObject(node);
    if (kind === "ShapeObject") {
      const targetId = nextId();
      const style: Style = {};
      const fill = color(node.attrs["Fill.Color"]);
      if (fill) style.background = fill;
      style.border = { width: pt(num(node.attrs["Border.Width"], 1)), style: "solid", color: color(node.attrs["Border.Color"]) ?? "#000000" };
      if (node.attrs.Shape && node.attrs.Shape !== "Rectangle") add("needs-review", "shape", node, `${node.attrs.Shape} shapes print as rectangles.`, targetId);
      return { id: targetId, name: node.attrs.Name, type: "rectangle", ...geometry(node), style };
    }
    if (kind === "PictureObject") {
      const targetId = nextId();
      const image = node.attrs.Image;
      const column = node.attrs.DataColumn;
      if (image) {
        const mime = image.startsWith("iVBOR") ? "image/png" : image.startsWith("/9j/") ? "image/jpeg" : undefined;
        if (mime) return { id: targetId, name: node.attrs.Name, type: "image", ...geometry(node), src: `data:${mime};base64,${image}`, fit: "contain" };
      }
      if (column) {
        const source = sourceByName.get(column.slice(0, column.indexOf(".")).toLowerCase());
        if (source) {
          add("needs-review", "image", node, "The image comes from a data column; the host must send it as a data URL or reachable URL.", targetId);
          return { id: targetId, name: node.attrs.Name, type: "image", ...geometry(node), binding: columnPath(source, column.slice(column.indexOf(".") + 1), scope), fit: "contain", whenMissing: "hide" };
        }
      }
      add("needs-review", "image", node, image ? "The embedded picture is not PNG or JPEG; add the image again." : "The picture is empty in the source (usually a logo set at run time); choose the image in the designer.", targetId);
      return { id: targetId, name: node.attrs.Name, type: "image", ...geometry(node), whenMissing: "placeholder", alt: node.attrs.Name };
    }
    if (kind === "BarcodeObject") {
      const targetId = nextId();
      const type = node.attrs.Barcode ?? "Code128";
      const symbology = /^Code39/.test(type) ? "code39" : /^EAN13/.test(type) ? "ean13" : /^UPC/.test(type) ? "upc" : /^Code128/.test(type) ? "code128" : undefined;
      if (!symbology) return placeholder(node, "barcode", `${type} barcodes are not supported; choose Code 128, Code 39, EAN-13 or UPC.`, targetId);
      const column = node.attrs.DataColumn;
      const source = column ? sourceByName.get(column.slice(0, column.indexOf(".")).toLowerCase()) : undefined;
      const component: Component = { id: targetId, name: node.attrs.Name, type: "barcode", ...geometry(node), symbology };
      if (source && column) component.binding = columnPath(source, column.slice(column.indexOf(".") + 1), scope);
      else if (node.attrs.Expression) {
        const expression = translate(node.attrs.Expression, scope, "barcode value", node, targetId);
        if (expression) component.expression = expression;
      } else component.value = node.attrs.Text ?? "";
      if (type !== "Code39" && symbology === "code39") add("needs-review", "barcode", node, `${type} became Code 39; check that every value uses Code 39 characters.`, targetId);
      return component;
    }
    if (kind === "MatrixObject") return matrixObject(node);
    if (kind === "SubreportObject") return placeholder(node, "subreport", "Subreports need to be imported as their own report and attached as a child report.");
    if (kind === "TableObject") return placeholder(node, "table object", "FastReport table objects need to be rebuilt with the Table component.");
    if (kind === "CheckBoxObject") return placeholder(node, "check box", "Check boxes need to be rebuilt, for example as a text with ☑ / ☐.");
    if (kind === "RichObject") return placeholder(node, "rich text", "RTF text needs to be rebuilt as rich text.");
    if (/Object$/.test(kind)) return placeholder(node, kind, `${kind} is not supported.`);
    return undefined;
  };

  function matrixObject(node: XmlNode): Component {
    const targetId = nextId();
    const source = sourceByName.get((node.attrs.DataSource ?? "").toLowerCase()) ?? mainSource;
    const part = (tag: string) => node.children.find((c) => local(c.name) === tag)?.children ?? [];
    const dimension = (header: XmlNode) => {
      const binding = translate(header.attrs.Expression ?? "", "row", "matrix header", header, targetId);
      return binding ? { binding, ...(header.attrs.Sort === "Descending" ? { sort: "desc" } : {}) } : undefined;
    };
    const rows = part("MatrixRows").map(dimension);
    const columns = part("MatrixColumns").map(dimension);
    const measures = part("MatrixCells").map((cell) => {
      const binding = translate(cell.attrs.Expression ?? "", "row", "matrix cell", cell, targetId);
      const fn = (cell.attrs.Function ?? "Sum").toLowerCase();
      const aggregate = fn === "average" ? "avg" : ["sum", "count", "min", "max"].includes(fn) ? fn : undefined;
      return binding && aggregate ? { binding, aggregate } : undefined;
    });
    if (!source || !rows.length || !measures.length || [...rows, ...columns, ...measures].some((p) => !p)) {
      return placeholder(node, "matrix", "The matrix could not be converted; rebuild it with the Crosstab component.", targetId);
    }
    // The first table row holds the row-header captions (Kodu, Adı…) above the row dimensions.
    const captions = node.children.filter((c) => local(c.name) === "TableRow")[0]?.children.map((cell) => cell.attrs.Text ?? "") ?? [];
    rows.forEach((row, index) => { if (row && captions[index] && !captions[index]!.includes("[")) (row as Record<string, unknown>).header = captions[index]; });
    const cellText = node.children.filter((c) => local(c.name) === "TableRow").at(-1)?.children.at(-1);
    const format = cellText ? formatOf(cellText, targetId).format : undefined;
    if (format) measures.forEach((m) => { (m as Record<string, unknown>).format = format; });
    const totalOf = (tag: string) => part(tag).some((h) => h.attrs.Totals !== "false");
    add("needs-review", "matrix", node, "The matrix became a crosstab with the same rows, columns and values. Cell sizes, borders and colours follow the crosstab's own style; compare the output.", targetId);
    return {
      id: targetId, name: node.attrs.Name, type: "crosstab", x: `${pt(num(node.attrs.Left))}pt`, y: `${pt(num(node.attrs.Top))}pt`,
      dataset: source.id, rows, columns, measures, totalRow: totalOf("MatrixRows"), totalColumn: totalOf("MatrixColumns"),
    };
  }

  // ---------------------------------------------------------------- bands
  const pageMm = (key: string, fallback: number) => num(page.attrs[key], fallback);
  const printableHeight = Math.floor((pageMm("PaperHeight", 297) - pageMm("TopMargin", 10) - pageMm("BottomMargin", 10)) * 72 / 25.4 * 100) / 100;
  const printableWidth = Math.floor((pageMm("PaperWidth", 210) - pageMm("LeftMargin", 10) - pageMm("RightMargin", 10)) * 72 / 25.4 * 100) / 100;
  const sections: Section[] = [];
  const groups: Array<Record<string, unknown>> = [];
  const scriptEvents: Array<{ node: XmlNode; event: string; handler: string; targetId?: string }> = [];
  const noteEvents = (node: XmlNode, targetId?: string) => {
    for (const [key, handler] of Object.entries(node.attrs)) if (/Event$/.test(key) && handler) scriptEvents.push({ node, event: key.replace(/Event$/, ""), handler, targetId });
  };

  const band = (node: XmlNode, parentId?: string) => {
    const kind = local(node.name);
    const info = bandInfo.get(node.attrs.Name ?? "")!;
    const type = info.type;
    const section: Section = { id: info.id, name: node.attrs.Name, type, layout: "absolute", height: pt(num(node.attrs.Height)), children: [] };
    if (type === "detail" || type === "dataHeader" || type === "dataFooter") {
      const source = sourceByName.get((node.attrs.DataSource ?? "").toLowerCase()) ?? mainSource;
      if (source) section.dataset = source.id;
      else add("unsupported", "data band", node, "The data band has no data source; it prints once.", info.id);
    }
    if (info.groupId) section.groupId = info.groupId;
    if (type === "child" && parentId) section.parent = parentId;
    if (bool(node.attrs.CanGrow)) add("needs-review", "can grow", node, "The band can grow in FastReport; it now keeps its designed height.", info.id);
    if (bool(node.attrs.CanShrink)) add("needs-review", "can shrink", node, "The band can shrink in FastReport; it now keeps its designed height.", info.id);
    if (bool(node.attrs.StartNewPage) && type !== "groupHeader") section.newPageBefore = true;
    if (node.attrs.VisibleExpression) {
      const visible = translate(node.attrs.VisibleExpression, info.scope, "band visibility", node, info.id);
      if (visible) section.visibleWhen = visible;
    }
    if (node.attrs.Visible === "false") section.hidden = true;
    const fill = color(node.attrs["Fill.Color"]);
    const bandStyle: Style = {};
    if (fill) bandStyle.background = fill;
    borderStyle(node, bandStyle);
    if (Object.keys(bandStyle).length) section.style = bandStyle;
    if (node.attrs.Filter) add("needs-review", "data filter", node, "The data band's filter was not imported; filter the rows in the host or add a visibility condition.", info.id, node.attrs.Filter);
    if (num(node.attrs["Columns.Count"], 1) > 1) add("unsupported", "multi-column band", node, `The band printed in ${node.attrs["Columns.Count"]} columns; it now prints in one.`, info.id);
    if (node.attrs.PrintOn && node.attrs.PrintOn !== "FirstPage, LastPage, OddPages, EvenPages, RepeatedBand, SinglePage") add("needs-review", "print on", node, `The band printed only on: ${node.attrs.PrintOn}.`, info.id);
    noteEvents(node, info.id);
    const nested: XmlNode[] = [];
    for (const child of node.children) {
      const childKind = local(child.name);
      if (BAND_TYPES[childKind]) { nested.push(child); continue; }
      const component = objectFor(child, info.scope);
      if (component) {
        noteEvents(child, component.id as string);
        section.children.push(component);
        add("converted", childKind, child, "Object, geometry and style converted.", component.id as string);
      }
    }
    add("converted", kind, node, "Band converted.", info.id);
    // FastReport lets objects overhang their band (a rule on the bottom edge); a crosstab grows with its data.
    const bottom = Math.max(0, ...section.children.map((c) => typeof c.y === "string" && typeof c.height === "string" ? parseFloat(c.y) + parseFloat(c.height) : 0));
    if (section.children.some((c) => c.type === "crosstab")) {
      section.minHeight = section.height;
      delete section.height;
    } else if (bottom > (section.height as number) + 0.05) section.height = Math.ceil(bottom * 100) / 100; // ignore rounding of separately converted values
    // FastReport crops objects at the page edge; keep them within the printable width.
    for (const component of section.children) {
      if (typeof component.x !== "string" || typeof component.width !== "string") continue;
      const x = parseFloat(component.x);
      if (x + parseFloat(component.width) > printableWidth + 0.5) {
        component.width = `${Math.max(1, Math.floor((printableWidth - x) * 100) / 100)}pt`;
        add("needs-review", "page edge", node, `${component.name ?? component.id} ran past the page edge and was cut to the printable width.`, component.id as string);
      }
    }
    // A label band that fills the page exactly can exceed it by a rounding hair; keep it within the printable height.
    if (typeof section.height === "number" && section.height > printableHeight) section.height = printableHeight;
    if (kind === "GroupHeaderBand") {
      const groupId = info.groupId!;
      const by = translate(node.attrs.Condition ?? "", "row", "group condition", node, groupId);
      const sort = node.attrs.SortOrder ?? "Ascending";
      groups.push({
        id: groupId, name: node.attrs.Name, by: by ?? "null",
        sort: sort === "None" ? "none" : sort === "Descending" ? "desc" : "asc",
        repeatHeader: bool(node.attrs.RepeatOnEveryPage), newPage: bool(node.attrs.StartNewPage) ? "before" : "none",
      });
      if (bool(node.attrs.ResetPageNumber)) add("needs-review", "page numbering", node, "Page numbers restarted for each group in FastReport; they now run through the report.", info.id);
    }
    // Bands print in this order: header, nested header/data band, children, then footers.
    sections.push(section);
    for (const child of nested.filter((c) => !["GroupFooterBand", "DataFooterBand", "ChildBand"].includes(local(c.name)))) band(child, info.id);
    for (const child of nested.filter((c) => local(c.name) === "ChildBand")) band(child, info.id);
    for (const child of nested.filter((c) => ["GroupFooterBand", "DataFooterBand"].includes(local(c.name)))) band(child, info.id);
  };
  for (const child of page.children) if (BAND_TYPES[local(child.name)]) band(child);
  for (const child of page.children) if (!BAND_TYPES[local(child.name)] && /Object$/.test(local(child.name))) add("unsupported", "page object", child, "Objects placed directly on the page (outside bands) are not imported.");
  // FastReport prints the report title above the page header on page 1 (TitleBeforeHeader, on by default). Open Reports
  // always puts the page header at the top, so page 1 gets an empty header master and the title carries a copy of it.
  const title = sections.find((s) => s.type === "reportHeader");
  const header = sections.find((s) => s.type === "pageHeader");
  if (title && header && page.attrs.TitleBeforeHeader !== "false" && typeof title.height === "number" && typeof header.height === "number") {
    const offset = title.height;
    title.children.push(...header.children.map((component) => ({
      ...structuredClone(component), id: `${component.id as string}-first`,
      y: `${Math.round((parseFloat(String(component.y ?? "0")) + offset) * 100) / 100}pt`,
    })));
    title.height = Math.round((offset + header.height) * 100) / 100;
    sections.splice(sections.indexOf(header), 0, { id: nextId("band"), name: `${header.name ?? "Page header"} (page 1: under the title)`, type: "pageHeader", appliesTo: "first", layout: "absolute", height: 0, children: [] });
    add("converted", "title before header", page, "Page 1 prints the title above the page header, as in FastReport.", title.id);
  }

  // ---------------------------------------------------------------- script
  const script = root.children.find((c) => local(c.name) === "ScriptText")?.text ?? "";
  for (const { node, event, handler, targetId } of scriptEvents) {
    const body = new RegExp(`void\\s+${handler}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s{4}\\}`).exec(script)?.[1]?.trim();
    add("unsupported", "script event", node, `${node.attrs.Name} runs the C# handler ${handler} on ${event}; scripts are never executed. Rebuild its effect with variables, rules or data from the host.`, targetId, body);
  }
  const wired = new Set(scriptEvents.map((e) => e.handler));
  const unwired = [...script.matchAll(/(?:private|public)\s+void\s+(\w+)\s*\(object\s+sender/g)].map((m) => m[1]!).filter((name) => !wired.has(name));
  if (unwired.length) add("needs-review", "unused script", root, `The script defines handlers no object uses (${unwired.join(", ")}); they were ignored.`);
  const helpers = [...script.matchAll(/(?:private|public)\s+(?:static\s+)?(?!void)[\w.<>]+\s+(\w+)\s*\((?!object\s+sender)[^)]*\)\s*\{/g)].map((m) => m[1]!);
  if (helpers.length) add("needs-review", "script functions", root, `The script defines helper functions (${helpers.join(", ")}). Expressions that call them were flagged; translate them by hand.`);

  // ---------------------------------------------------------------- report
  const paperWidth = num(page.attrs.PaperWidth, 210);
  const paperHeight = num(page.attrs.PaperHeight, 297);
  const margin = (key: string) => num(page.attrs[key], 10);
  const report = {
    schemaVersion: "1.0",
    id: options.id ?? `frx-${(options.name ?? "report").replace(/[^A-Za-z0-9_-]/g, "-").toLowerCase()}-${Date.now().toString(36)}`,
    name: options.name ?? root.attrs["ReportInfo.Name"] ?? "Imported FastReport",
    locale: options.locale ?? "tr-TR",
    page: {
      size: "custom", unit: "mm", width: paperWidth, height: paperHeight,
      orientation: paperWidth > paperHeight ? "landscape" : "portrait",
      margin: { top: margin("TopMargin"), right: margin("RightMargin"), bottom: margin("BottomMargin"), left: margin("LeftMargin") },
    },
    parameters,
    datasets: sources.map((source) => ({
      id: source.id, source: "inline", query: [],
      schema: { kind: "array", fields: source.columns.filter((c) => c.name).map((c) => ({ path: c.name, kind: dataKind(c.type) })) },
    })),
    groups, sections, variables,
    migration: {
      sourceFormat: "frx", sourceName: options.sourceName, format: "fastreport", summary,
      issues: issues.filter((issue) => issue.status !== "converted").map(({ status, feature, source, line, message, targetId }) => ({ status, feature, source, line, message, targetId })),
    },
  };
  if (bool(page.attrs.MirrorMargins)) add("needs-review", "mirror margins", page, "Odd and even pages mirrored their margins in FastReport.");
  const validation = parseReportDefinition(report);
  if (!validation.valid) {
    for (const issue of validation.issues) add("unsupported", "schema validation", root, `${issue.path}: ${issue.message}`);
    return { issues, summary };
  }
  // The migration record is written before late issues (mirror margins) are added; refresh it.
  validation.report.migration = { ...validation.report.migration!, summary: { ...summary }, issues: issues.filter((issue) => issue.status !== "converted").map(({ status, feature, source, line, message, targetId }) => ({ status: status as "needs-review" | "unsupported", feature, source, line, message, targetId })) };
  return { report: validation.report, issues, summary };
}

function dataKind(type: string | undefined): "string" | "number" | "boolean" | "date" {
  if (!type) return "string";
  if (/(?:Int\d+|Decimal|Double|Single|Byte|Int16|Int64|UInt\d+)$/.test(type)) return "number";
  if (/Boolean$/.test(type)) return "boolean";
  if (/DateTime(?:Offset)?$/.test(type)) return "date";
  return "string";
}
