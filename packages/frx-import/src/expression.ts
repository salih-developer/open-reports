import { Parser, type Expr } from "@reporting/expressions";

/**
 * FastReport expressions are C#: `[Table.Column]` references, operators, IIf, .NET calls and methods.
 * This module translates the subset that has an Open Reports equivalent and refuses the rest, so the
 * importer can flag it for review. Nothing in a source expression is ever executed.
 */

/** Maps a bracketed reference ([Table.Column], [Total1], [Page#], [Param]) to an Open Reports expression, or undefined when unknown. */
export type ResolveRef = (name: string) => string | undefined;

type Tok = { t: "num" | "str" | "ref" | "id" | "op" | "eof"; v: string };

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "?", ":", "(", ")", ",", ".", "!", "+", "-", "*", "/", "%", "<", ">"];
/** .NET type and namespace prefixes read as part of a qualified name (DateTime.MinValue, Math.Abs, Convert.ToDecimal). */
const QUALIFIERS = new Set(["DateTime", "Math", "Convert", "String", "string", "System", "Decimal", "decimal", "Int32", "Double"]);
const CAST_TYPES = new Set(["decimal", "double", "float", "int", "long", "short", "string", "object", "bool", "DateTime", "Decimal", "Double", "Int32", "Int64"]);
/** Functions an imported expression may call; everything else is refused by validation. */
const ALLOWED_CALLS = new Set(["formatNumber", "formatCurrency", "formatDate", "now", "abs", "round", "floor", "ceil", "upper", "lower", "trim",
  "substring", "replace", "contains", "startsWith", "endsWith", "sumBy", "avgBy", "minBy", "maxBy", "sumProduct", "count", "first", "last"]);
const ROOTS = new Set(["row", "params", "page", "vars", "data", "group"]);

export class FrxExpressionError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "[") {
      const end = closingBracket(src, i);
      out.push({ t: "ref", v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (c === '"' || (c === "@" && src[i + 1] === '"')) {
      const verbatim = c === "@";
      let j = i + (verbatim ? 2 : 1);
      let s = "";
      for (; j < src.length; j++) {
        const ch = src[j]!;
        if (verbatim) {
          if (ch !== '"') { s += ch; continue; }
          if (src[j + 1] === '"') { s += '"'; j++; continue; }
          break;
        }
        if (ch === "\\") {
          const next = src[++j] ?? "";
          s += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          continue;
        }
        if (ch === '"') break;
        s += ch;
      }
      if (j >= src.length) throw new FrxExpressionError("Unclosed string literal.");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const m = /^'(\\.|[^'\\])'/.exec(src.slice(i));
      if (!m) throw new FrxExpressionError("Unsupported character literal.");
      out.push({ t: "str", v: m[1]!.startsWith("\\") ? m[1]!.slice(1) : m[1]! });
      i += m[0].length;
      continue;
    }
    const num = /^\d+(?:\.\d+)?[mMdDfFlL]?/.exec(src.slice(i));
    if (num) { out.push({ t: "num", v: num[0].replace(/[mMdDfFlL]$/, "") }); i += num[0].length; continue; }
    const id = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
    if (id) { out.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FrxExpressionError(`Unexpected "${c}".`);
    out.push({ t: "op", v: op });
    i += op.length;
  }
  out.push({ t: "eof", v: "" });
  return out;
}

/** Index of the "]" that closes the "[" at `start`, skipping nested brackets and string literals. */
export function closingBracket(src: string, start: number): number {
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    const ch = src[j];
    if (ch === '"') {
      for (j++; j < src.length && src[j] !== '"'; j++) if (src[j] === "\\") j++;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return j;
  }
  throw new FrxExpressionError("Unclosed [ reference.");
}

const str = (value: string) => JSON.stringify(value);

/** Date pattern for a .NET standard or custom date format string. */
export function datePattern(format: string): string | undefined {
  const standard: Record<string, string> = {
    d: "dd.MM.yyyy", D: "d MMMM yyyy", f: "d MMMM yyyy HH:mm", F: "d MMMM yyyy HH:mm:ss",
    g: "dd.MM.yyyy HH:mm", G: "dd.MM.yyyy HH:mm:ss", t: "HH:mm", T: "HH:mm:ss", M: "d MMMM", Y: "MMMM yyyy",
  };
  if (standard[format]) return standard[format];
  return /^(?:yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|[-./ :,])+$/.test(format) ? format : undefined;
}

/** Decimal digits for a .NET numeric format such as N2, F0, #,##0.00 or 0.##; undefined when it is not numeric. */
export function numberDigits(format: string): number | undefined {
  const standard = /^[NnFf](\d*)$/.exec(format);
  if (standard) return standard[1] ? Number(standard[1]) : 2;
  const custom = /^[#,0]*0(?:\.([0#]+))?$/.exec(format);
  return custom ? (custom[1]?.length ?? 0) : undefined;
}

function formatCall(value: string, format: string): string | undefined {
  const digits = numberDigits(format);
  if (digits !== undefined) return `formatNumber(${value}, ${digits})`;
  if (/^[Cc]\d*$/.test(format)) return `formatCurrency(${value})`;
  const pattern = datePattern(format);
  return pattern ? `formatDate(${value}, ${str(pattern)})` : undefined;
}

class Translator {
  private i = 0;
  constructor(private readonly toks: Tok[], private readonly resolve: ResolveRef) {}

  run(): string {
    const out = this.expr();
    if (this.peek().t !== "eof") throw new FrxExpressionError(`Unexpected "${this.peek().v}".`);
    return out;
  }

  private peek(offset = 0): Tok { return this.toks[this.i + offset]!; }
  private next(): Tok { return this.toks[this.i++]!; }
  private is(op: string): boolean { const t = this.peek(); return t.t === "op" && t.v === op; }
  private expect(op: string): void {
    if (!this.is(op)) throw new FrxExpressionError(`Expected "${op}".`);
    this.i++;
  }

  private expr(): string {
    const cond = this.binary(0);
    if (!this.is("?")) return cond;
    this.next();
    const yes = this.expr();
    this.expect(":");
    const no = this.expr();
    return `(${cond} ? ${yes} : ${no})`;
  }

  private static readonly LEVELS = [["||"], ["&&"], ["==", "!="], ["<", ">", "<=", ">="], ["+", "-"], ["*", "/", "%"]];

  private binary(level: number): string {
    if (level >= Translator.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.peek().t === "op" && Translator.LEVELS[level]!.includes(this.peek().v)) {
      const op = this.next().v;
      const right = this.binary(level + 1);
      left = `(${left} ${op} ${right})`;
    }
    return left;
  }

  private unary(): string {
    if (this.is("!")) { this.next(); return `!${this.unary()}`; }
    if (this.is("-")) { this.next(); return `-${this.unary()}`; }
    if (this.is("+")) { this.next(); return this.unary(); }
    return this.postfix();
  }

  private postfix(): string {
    let base = this.primary();
    while (this.is(".")) {
      this.next();
      const name = this.next();
      if (name.t !== "id") throw new FrxExpressionError("Expected a member name.");
      const args = this.is("(") ? this.args() : undefined;
      base = this.member(base, name.v, args);
    }
    return base;
  }

  private args(): string[] {
    this.expect("(");
    const out: string[] = [];
    if (!this.is(")")) {
      do out.push(this.expr());
      while (this.is(",") && this.next());
    }
    this.expect(")");
    return out;
  }

  private primary(): string {
    const tok = this.peek();
    if (tok.t === "num") { this.next(); return tok.v; }
    if (tok.t === "str") { this.next(); return str(tok.v); }
    if (tok.t === "ref") {
      this.next();
      const resolved = this.resolve(tok.v.trim());
      if (resolved === undefined) throw new FrxExpressionError(`Unknown reference [${tok.v}].`);
      return resolved;
    }
    if (this.is("(")) {
      // A C# cast such as (decimal)x is dropped: values keep their JSON type.
      const type = this.peek(1);
      if (type.t === "id" && CAST_TYPES.has(type.v) && this.peek(2).t === "op" && this.peek(2).v === ")") {
        this.i += 3;
        return this.unary();
      }
      this.next();
      const inner = this.expr();
      this.expect(")");
      return `(${inner})`;
    }
    if (tok.t === "id") {
      this.next();
      if (tok.v === "true" || tok.v === "false" || tok.v === "null") return tok.v;
      let name = tok.v;
      while (QUALIFIERS.has(name.split(".")[0]!) && this.is(".") && this.peek(1).t === "id" && name.split(".").length < 3) {
        this.next();
        name += `.${this.next().v}`;
      }
      return this.is("(") ? this.call(name, this.args()) : this.constant(name);
    }
    throw new FrxExpressionError(`Unexpected "${tok.v || "end of expression"}".`);
  }

  private constant(name: string): string {
    if (name === "DateTime.MinValue") return "null";
    if (name === "DateTime.Now" || name === "DateTime.Today") return "now()";
    throw new FrxExpressionError(`Uses "${name}", which is defined in the report script or .NET.`);
  }

  private call(name: string, args: string[]): string {
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max) throw new FrxExpressionError(`${name} expects ${min === max ? min : `${min}–${max}`} arguments.`);
    };
    switch (name) {
      case "IIf": arity(3); return `(${args[0]} ? ${args[1]} : ${args[2]})`;
      case "FormatNumber": arity(1, 2); return `formatNumber(${args[0]}, ${args[1] ?? 2})`;
      case "FormatCurrency": arity(1, 2); return `formatCurrency(${args[0]})`;
      case "Format":
      case "String.Format":
      case "string.Format": {
        arity(2);
        const pattern = /^"\{0:(.+)\}"$/.exec(args[0]!)?.[1];
        const call = pattern ? formatCall(args[1]!, JSON.parse(`"${pattern}"`) as string) : undefined;
        if (!call) throw new FrxExpressionError(`Format pattern ${args[0]} has no equivalent.`);
        return call;
      }
      case "Abs": case "Math.Abs": arity(1); return `abs(${args[0]})`;
      case "Round": case "Math.Round": arity(1, 2); return `round(${args[0]}, ${args[1] ?? 0})`;
      case "Math.Floor": arity(1); return `floor(${args[0]})`;
      case "Math.Ceiling": arity(1); return `ceil(${args[0]})`;
      case "Upper": arity(1); return `upper(${args[0]})`;
      case "Lower": arity(1); return `lower(${args[0]})`;
      case "Trim": arity(1); return `trim(${args[0]})`;
      case "Convert.ToDecimal": case "Convert.ToDouble": case "Convert.ToInt32": case "Convert.ToInt64": case "Convert.ToSingle":
      case "ToDecimal": case "ToDouble": case "ToInt32":
        arity(1); return args[0]!;
      case "Convert.ToString": case "ToString": arity(1); return `("" + ${args[0]})`;
      case "String.IsNullOrEmpty": case "string.IsNullOrEmpty": case "String.IsNullOrWhiteSpace": case "string.IsNullOrWhiteSpace":
        arity(1); return `(${args[0]} == null || trim("" + ${args[0]}) == "")`;
      default:
        throw new FrxExpressionError(`Calls ${name}(), which is defined in the report script or .NET.`);
    }
  }

  private member(base: string, name: string, args: string[] | undefined): string {
    if (args === undefined) {
      if (name === "Value") return base;
      throw new FrxExpressionError(`Uses the .NET property ${name}.`);
    }
    switch (name) {
      case "ToString": {
        if (!args.length) return `("" + ${base})`;
        const format = /^"(.+)"$/.exec(args[0]!)?.[1];
        const call = format && args.length === 1 ? formatCall(base, JSON.parse(`"${format}"`) as string) : undefined;
        if (!call) throw new FrxExpressionError(`ToString(${args.join(", ")}) has no equivalent.`);
        return call;
      }
      case "ToUpper": case "ToUpperInvariant": return `upper(${base})`;
      case "ToLower": case "ToLowerInvariant": return `lower(${base})`;
      case "Trim": return `trim(${base})`;
      case "Substring": return args.length === 1 ? `substring(${base}, ${args[0]})` : `substring(${base}, ${args[0]}, (${args[0]}) + (${args[1]}))`;
      case "Replace": return `replace(${base}, ${args[0]}, ${args[1]})`;
      case "Contains": return `contains(${base}, ${args[0]})`;
      case "StartsWith": return `startsWith(${base}, ${args[0]})`;
      case "EndsWith": return `endsWith(${base}, ${args[0]})`;
      default: throw new FrxExpressionError(`Calls the .NET method ${name}().`);
    }
  }
}

function safe(expr: Expr): boolean {
  switch (expr.kind) {
    case "number": case "string": case "boolean": case "null": return true;
    case "path": {
      const head = expr.segments[0];
      return head?.type === "prop" && ROOTS.has(head.name) && expr.segments.every((s) => s.type === "prop" || safe(s.expr));
    }
    case "unary": return safe(expr.expr);
    case "binary": return safe(expr.left) && safe(expr.right);
    case "conditional": return safe(expr.cond) && safe(expr.then) && safe(expr.else);
    case "call": return ALLOWED_CALLS.has(expr.name) && expr.args.every(safe);
  }
}

/** Translates a FastReport (C#) expression; throws FrxExpressionError with the reason when it cannot. */
export function translateFrxExpression(source: string, resolve: ResolveRef): string {
  // A text's [..] holds either an expression or one bare name: Table.Column, a total such as "KDV Toplamı", Page#, Date or a parameter.
  const plain = source.trim();
  const named = /^[^[\]()"'+*/<>=!?:,%&|]+$/.test(plain) ? resolve(plain) : undefined;
  const result = named ?? new Translator(tokenize(source), resolve).run();
  let ast: Expr;
  try { ast = Parser.parse(result); }
  catch (error) { throw new FrxExpressionError(`The translation does not parse: ${(error as Error).message}`); }
  if (!safe(ast)) throw new FrxExpressionError("The translation uses data or functions outside the supported set.");
  return result;
}

export type TextPart = { literal: string } | { expression: string };

/** Splits a TextObject's text into literal text and bracketed expressions. */
export function splitText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let literal = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") { literal += text[i]; continue; }
    const end = closingBracket(text, i);
    if (literal) parts.push({ literal });
    literal = "";
    parts.push({ expression: text.slice(i + 1, end) });
    i = end;
  }
  if (literal) parts.push({ literal });
  return parts;
}

/** `base.name`, or `base["name"]` when the name is not an expression identifier (spaces, Turkish letters). */
export function member(base: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? `${base}.${name}` : `${base}[${str(name)}]`;
}
