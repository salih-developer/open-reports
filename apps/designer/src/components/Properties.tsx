import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import * as ops from "../model/ops";
import { buildCalc, CALC_OPS, parseCalc, buildFormat, conditionToExpression, expressionToCondition, OPERATORS, parseFormat, titleCase, type Condition } from "../lib/lowcode";
import { candidatesFor, type Candidate } from "../lib/bindings";
import { datasetValue, datasetFields, scalarFields, inferFields, arrayRefs } from "../lib/fields";
import { Icon } from "./Icon";
import { BandProps } from "./BandProps";
import { FormulaInput } from "./FormulaInput";
import { InspectorSection as Section } from "./InspectorSection";
import { CrosstabProps } from "./CrosstabProps";
import { LinkProps } from "./LinkProps";
import { removeHeaderColumn } from "../lib/table-header";
import { removeBodyColumn } from "../lib/table-body";
import { textStyleFromStyle } from "../lib/theme-edit";
import { FONT_FAMILIES } from "../lib/fonts";
import { FragmentProps } from "./FragmentProps";
import { fitZoom } from "../lib/zoom";
import { SpacingFields } from "./SpacingFields";
import { InspectorActions } from "./InspectorActions";
import { InspectorTabs } from "./InspectorTabs";
import { api, type SavedPrinterProfile } from "../lib/api";
import { PrintCalibration } from "./PrintCalibration";
import { PageMasters } from "./PageMasters";
import { parseSubreportFile } from "../lib/subreports";

// ------------------------------------------------------------------ small controls
/** IANA time zones offered for date formatting; any other valid name can be typed. */
const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

export function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Num({ value, onChange, label, min, step = 1 }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; min?: number; step?: number }) {
  return (
    <input
      type="number"
      aria-label={label}
      value={value ?? ""}
      min={min}
      step={step}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
    />
  );
}

function Dim({ value, onChange, label, placeholder }: { value: unknown; onChange: (v: number | string | undefined) => void; label: string; placeholder?: string }) {
  return (
    <input
      aria-label={label}
      placeholder={placeholder ?? "auto"}
      value={value === undefined ? "" : String(value)}
      onChange={(e) => {
        const t = e.target.value.trim();
        onChange(t === "" ? undefined : t !== "" && !Number.isNaN(Number(t)) ? Number(t) : t);
      }}
    />
  );
}

function Color({ value, onChange, label }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string }) {
  const colors: Record<string, string> = useStore((st) => st.doc.theme?.colors) ?? {};
  const shown = value?.startsWith("$") ? colors[value.slice(1)] : value;
  return (
    <span className="color">
      <input type="color" aria-label={label} className={shown && /^#[0-9a-f]{6}$/i.test(shown) ? undefined : "empty"} title={value ? undefined : "No colour"} value={shown && /^#[0-9a-f]{6}$/i.test(shown) ? shown : "#000000"} onChange={(e) => onChange(e.target.value)} />
      <input aria-label={`${label} value`} placeholder="none" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />
      {Object.keys(colors).length > 0 && <select aria-label={`${label} theme colour`} value={value?.startsWith("$") ? value : ""} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Theme…</option>
        {Object.entries(colors).map(([name, colour]) => <option key={name} value={`$${name}`}>{`$${name} ${colour}`}</option>)}
      </select>}
    </span>
  );
}

// ------------------------------------------------------------------ value editor: text | field | formula
type ValueMode = "text" | "field" | "formula";

function modeOf(c: ops.Comp): ValueMode {
  if (c.expression !== undefined) return "formula";
  if (c.binding !== undefined) return "field";
  return "text";
}

function ValueEditor({ comp, valueKey = "value" }: { comp: ops.Comp; valueKey?: string }) {
  const { doc, sample } = useStore();
  const patch = useStore((s) => s.patch);
  const mode = modeOf(comp);
  const candidates = useMemo(() => candidatesFor(doc, sample, comp.id), [doc, sample, comp.id]);
  const setMode = (m: ValueMode) => {
    if (m === mode) return;
    if (m === "text") patch(comp.id, { binding: undefined, expression: undefined, [valueKey]: comp[valueKey] ?? "" });
    if (m === "field") patch(comp.id, { binding: comp.binding ?? candidates.find((c) => c.group !== "Page")?.value ?? "", expression: undefined, [valueKey]: undefined });
    if (m === "formula") patch(comp.id, { expression: comp.expression ?? (comp.binding ? comp.binding : JSON.stringify(String(comp[valueKey] ?? ""))), binding: undefined, [valueKey]: undefined });
  };
  return (
    <div className="value-editor">
      <div className="seg" role="tablist" aria-label="Content source">
        {(["text", "field", "formula"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} data-testid={`value-mode-${m}`} onClick={() => setMode(m)}>
            {m === "text" ? "Text" : m === "field" ? "Field" : "fx Formula"}
          </button>
        ))}
      </div>
      {mode === "text" && (
        <textarea data-testid="value-text" aria-label="Content" rows={2} value={String(comp[valueKey] ?? "")} onChange={(e) => patch(comp.id, { [valueKey]: e.target.value })} />
      )}
      {mode === "field" && (
        <select data-testid="value-field" aria-label="Field" value={comp.binding ?? ""} onChange={(e) => patch(comp.id, { binding: e.target.value })}>
          {!candidates.some((c) => c.value === comp.binding) && <option value={comp.binding ?? ""}>{comp.binding || "Choose a field..."}</option>}
          {[...new Set(candidates.map((c) => c.group))].map((g) => (
            <optgroup key={g} label={g}>
              {candidates.filter((c) => c.group === g).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {mode === "formula" && <FormulaOrCalc comp={comp} candidates={candidates} />}
    </div>
  );
}

function CalcBuilder({ expr, candidates, onChange }: { expr: string; candidates: Candidate[]; onChange: (v: string) => void }) {
  const terms = parseCalc(expr) ?? [{ operand: "" }];
  const fields = candidates.filter((c) => c.group !== "Functions" && c.group !== "Page");
  const setTerm = (i: number, patchTerm: Partial<(typeof terms)[number]>) => onChange(buildCalc(terms.map((t, j) => (j === i ? { ...t, ...patchTerm } : t))));
  return (
    <div className="calc-builder" data-testid="calc-builder">
      {terms.map((t, i) => (
        <div key={i} className="calc-term">
          {i > 0 && (
            <select aria-label="Operator" value={t.op ?? "+"} onChange={(e) => setTerm(i, { op: e.target.value as any })}>
              {CALC_OPS.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
          )}
          <select
            aria-label={`Operand ${i + 1}`}
            value={fields.some((f) => f.value === t.operand) ? t.operand : "__number"}
            onChange={(e) => setTerm(i, { operand: e.target.value === "__number" ? "0" : e.target.value })}
          >
            {fields.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
            <option value="__number">A number…</option>
          </select>
          {!fields.some((f) => f.value === t.operand) && (
            <input aria-label={`Number ${i + 1}`} type="number" value={t.operand} onChange={(e) => setTerm(i, { operand: e.target.value === "" ? "0" : e.target.value })} />
          )}
          {terms.length > 1 && (
            <button className="mini danger" aria-label="Remove term" onClick={() => onChange(buildCalc(terms.filter((_, j) => j !== i).map((x, j) => (j === 0 ? { operand: x.operand } : x))))}>
              ×
            </button>
          )}
        </div>
      ))}
      <button className="mini" data-testid="calc-add" onClick={() => onChange(buildCalc([...terms, { op: "+", operand: fields[0]?.value ?? "0" }]))}>
        + Add
      </button>
    </div>
  );
}

function FormulaOrCalc({ comp, candidates }: { comp: ops.Comp; candidates: Candidate[] }) {
  const patch = useStore((s) => s.patch);
  const expr = comp.expression ?? "";
  const simple = parseCalc(expr) !== undefined && /[+\-*/]/.test(expr);
  const [view, setView] = useState<"builder" | "formula">(simple ? "builder" : "formula");
  const canBuild = parseCalc(expr) !== undefined || expr.trim() === "";
  return (
    <>
      {canBuild && (
        <div className="seg small" role="tablist" aria-label="Formula style">
          <button role="tab" aria-selected={view === "builder"} className={view === "builder" ? "active" : ""} data-testid="calc-view-builder" onClick={() => setView("builder")}>Builder</button>
          <button role="tab" aria-selected={view === "formula"} className={view === "formula" ? "active" : ""} data-testid="calc-view-formula" onClick={() => setView("formula")}>Formula</button>
        </div>
      )}
      {view === "builder" && canBuild ? (
        <CalcBuilder expr={expr} candidates={candidates} onChange={(v) => patch(comp.id, { expression: v })} />
      ) : (
        <FormulaInput value={expr} candidates={candidates} onChange={(v) => patch(comp.id, { expression: v })} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ format picker (no format strings exposed)
function FormatPicker({ comp, valueFormat = "format", patchTarget }: { comp: any; valueFormat?: string; patchTarget: (patch: Record<string, any>) => void }) {
  const spec = parseFormat(comp[valueFormat]);
  const set = (kind: string, arg: string) => patchTarget({ [valueFormat]: buildFormat({ kind: kind as any, arg }) });
  return (
    <div className="format-picker">
      <select aria-label="Format as" data-testid="format-kind" value={spec.kind} onChange={(e) => set(e.target.value, e.target.value === "currency" ? "" : e.target.value === "number" ? "2" : e.target.value === "date" ? "dd MMM yyyy" : "")}>
        <option value="">Plain</option>
        <option value="currency">Currency</option>
        <option value="number">Number</option>
        <option value="percent">Percent</option>
        <option value="date">Date</option>
      </select>
      {spec.kind === "currency" && (
        <select aria-label="Currency" value={spec.arg} onChange={(e) => set("currency", e.target.value)}>
          <option value="">Report default</option>
          {["INR", "USD", "EUR", "GBP", "AED", "JPY"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
      {spec.kind === "number" && (
        <select aria-label="Decimal places" value={spec.arg} onChange={(e) => set("number", e.target.value)}>
          {["0", "1", "2", "3", "4"].map((d) => (
            <option key={d} value={d}>
              {d} decimals
            </option>
          ))}
        </select>
      )}
      {spec.kind === "date" && (
        <select aria-label="Date pattern" value={spec.arg} onChange={(e) => set("date", e.target.value)}>
          {["dd MMM yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "MMMM yyyy", "dd MMM yyyy HH:mm"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ condition builder
function ConditionBuilder({ comp }: { comp: ops.Comp }) {
  const { doc, sample } = useStore();
  const patch = useStore((s) => s.patch);
  const expr: string = comp.visibleWhen ?? "";
  const cond = expr ? expressionToCondition(expr) : undefined;
  const [view, setView] = useState<"builder" | "code">("builder");
  const candidates = useMemo(() => candidatesFor(doc, sample, comp.id), [doc, sample, comp.id]);
  const enabled = expr !== "";
  const showCode = view === "code" || (enabled && !cond);
  const setCond = (c: Condition) => patch(comp.id, { visibleWhen: conditionToExpression(c) });
  const current: Condition = cond ?? { field: candidates[0]?.value ?? "row.value", operator: "gt", value: "0" };

  return (
    <div className="condition">
      <label className="check">
        <input
          type="checkbox"
          data-testid="visible-when-toggle"
          checked={enabled}
          onChange={(e) => patch(comp.id, { visibleWhen: e.target.checked ? conditionToExpression(current) : undefined })}
        />
        Show this element only when...
      </label>
      {enabled && <div className="seg small" role="tablist" aria-label="Visibility condition editor">
        <button type="button" role="tab" aria-selected={!showCode} disabled={!cond} className={!showCode ? "active" : ""} data-testid="visibility-builder" onClick={() => setView("builder")}>Builder</button>
        <button type="button" role="tab" aria-selected={showCode} className={showCode ? "active" : ""} data-testid="visibility-code" onClick={() => setView("code")}>Code</button>
      </div>}
      {enabled && !showCode && cond && (
        <div className="condition-row">
          <select aria-label="Condition field" data-testid="cond-field" value={cond.field} onChange={(e) => setCond({ ...cond, field: e.target.value })}>
            {!candidates.some((c) => c.value === cond.field) && <option>{cond.field}</option>}
            {candidates.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="Condition operator" data-testid="cond-op" value={cond.operator} onChange={(e) => setCond({ ...cond, operator: e.target.value as Condition["operator"] })}>
            {OPERATORS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {cond.operator !== "empty" && cond.operator !== "notempty" && <input aria-label="Condition value" data-testid="cond-value" value={cond.value} onChange={(e) => setCond({ ...cond, value: e.target.value })} />}
        </div>
      )}
      {enabled && showCode && <>
        <FormulaInput value={expr} candidates={candidates} placeholder="e.g. row.balance > 0" onChange={(v) => patch(comp.id, { visibleWhen: v })} />
        <p className="muted small">Use a boolean expression, or a simple <code>if (...) &#123; return true; &#125;</code> block. Report fields and built-in functions are available.</p>
      </>}
    </div>
  );
}

type StyleRule = { when: string; style: Record<string, any> };

export function StyleRuleCard<R extends StyleRule>({ rule, index, count, candidates, onChange, onMove, onRemove, testId, children }: {
  rule: R;
  index: number;
  count: number;
  candidates: Candidate[];
  onChange: (rule: R) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  testId: string;
  /** Extra "Then" fields after the style controls. */
  children?: React.ReactNode;
}) {
  const condition = expressionToCondition(rule.when);
  const [view, setView] = useState<"builder" | "code">("builder");
  const visual = !!condition && view === "builder";
  const setStyle = (patch: Record<string, unknown>) => onChange({ ...rule, style: { ...rule.style, ...patch } });
  return (
    <div className="column-card style-rule-card" data-testid={`${testId}-${index}`}>
      <div className="column-head">
        <strong>Rule {index + 1}</strong>
        <span className="spacer" />
        <button className="mini" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
        <button className="mini" aria-label={`Move rule ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
        <button className="mini danger" aria-label={`Remove rule ${index + 1}`} onClick={onRemove}>×</button>
      </div>
      <div className="column-body">
        <div className="group-title small">If</div>
        <div className="seg small" role="tablist" aria-label={`Rule ${index + 1} condition editor`}>
          <button type="button" role="tab" aria-selected={visual} disabled={!condition} className={visual ? "active" : ""} data-testid={`${testId}-builder-${index}`} onClick={() => setView("builder")}>Builder</button>
          <button type="button" role="tab" aria-selected={!visual} className={!visual ? "active" : ""} data-testid={`${testId}-code-${index}`} onClick={() => setView("code")}>Code</button>
        </div>
        {visual && condition ? (
          <div className="condition-row">
            <select aria-label={`Rule ${index + 1} field`} value={condition.field} onChange={(e) => onChange({ ...rule, when: conditionToExpression({ ...condition, field: e.target.value }) })}>
              {!candidates.some((candidate) => candidate.value === condition.field) && <option value={condition.field}>{condition.field}</option>}
              {candidates.map((candidate) => <option key={candidate.value} value={candidate.value}>{candidate.label}</option>)}
            </select>
            <select aria-label={`Rule ${index + 1} operator`} value={condition.operator} onChange={(e) => onChange({ ...rule, when: conditionToExpression({ ...condition, operator: e.target.value as Condition["operator"] }) })}>
              {OPERATORS.map((operator) => <option key={operator.id} value={operator.id}>{operator.label}</option>)}
            </select>
            {condition.operator !== "empty" && condition.operator !== "notempty" && (
              <input aria-label={`Rule ${index + 1} value`} value={condition.value} onChange={(e) => onChange({ ...rule, when: conditionToExpression({ ...condition, value: e.target.value }) })} />
            )}
          </div>
        ) : (
          <FormulaInput value={rule.when} candidates={candidates} testId={`${testId}-formula-${index}`} placeholder={'e.g. row.flag == "H"'} onChange={(when) => onChange({ ...rule, when })} />
        )}
        {!visual && <p className="muted small">Use a boolean expression or an <code>if (...) &#123; return true; &#125;</code> block. Return true or false to control this rule.</p>}
        <div className="group-title small">Then</div>
        <Field label="Text colour" wide>
          <Color label={`Rule ${index + 1} text colour`} value={rule.style.color} onChange={(color) => setStyle({ color })} />
        </Field>
        <Field label="Background" wide>
          <Color label={`Rule ${index + 1} background`} value={rule.style.background} onChange={(background) => setStyle({ background })} />
        </Field>
        <label className="check">
          <input type="checkbox" aria-label={`Rule ${index + 1} bold`} checked={rule.style.fontWeight === "bold"} onChange={(e) => setStyle({ fontWeight: e.target.checked ? "bold" : undefined })} /> Bold
        </label>
        {children}
      </div>
    </div>
  );
}

export function StyleRulesEditor({ comp, property, dataset, testId }: { comp: ops.Comp; property: "styleWhen" | "rowStyleWhen"; dataset?: string; testId: string }) {
  const { doc, sample } = useStore();
  const patch = useStore((state) => state.patch);
  const rules = (comp[property] ?? []) as StyleRule[];
  // Appearance rules resolve before pagination, so page numbers are not available here.
  const candidates = useMemo(() => candidatesFor(doc, sample, comp.id, dataset).filter((candidate) => candidate.group !== "Page"), [doc, sample, comp.id, dataset]);
  const write = (next: StyleRule[]) => patch(comp.id, { [property]: next.length ? next : undefined });
  const update = (index: number, rule: StyleRule) => write(rules.map((current, i) => i === index ? rule : current));
  const move = (index: number, direction: -1 | 1) => {
    const to = index + direction;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to]!, next[index]!];
    write(next);
  };
  const add = () => {
    const selectedField = [comp.binding, comp.expression].find((value) => value && candidates.some((candidate) => candidate.value === value));
    const field = selectedField ?? candidates.find((candidate) => candidate.value === "row.flag")?.value ?? candidates[0]?.value;
    write([...rules, { when: field ? conditionToExpression({ field, operator: "eq", value: "H" }) : "false", style: { color: "#b91c1c", fontWeight: "bold" } }]);
  };
  return (
    <div className="style-rules" data-testid={testId}>
      {rules.length === 0 && <p className="muted small">Add an If/Then rule to change appearance when data matches.</p>}
      {rules.map((rule, index) => (
        <StyleRuleCard key={index} rule={rule} index={index} count={rules.length} candidates={candidates} testId={testId}
          onChange={(next) => update(index, next)} onMove={(direction) => move(index, direction)} onRemove={() => write(rules.filter((_, i) => i !== index))} />
      ))}
      <button className="btn" data-testid={`${testId}-add`} onClick={add}>+ Add rule</button>
      {rules.length > 1 && <p className="muted small">Rules run from top to bottom. Later matches override earlier style values.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ typography & style sections
function Typography({ comp }: { comp: ops.Comp }) {
  const patchStyle = useStore((s) => s.patchStyle);
  const st = comp.style ?? {};
  const doc = useStore((s) => s.doc);
  const bold = st.fontWeight === "bold" || (typeof st.fontWeight === "number" && st.fontWeight >= 600);
  const set = (p: Record<string, any>) => patchStyle(comp.id, p);
  const textStyles = Object.keys(doc.theme?.textStyles ?? {});
  const fontTokens = Object.keys(doc.theme?.fonts ?? {});
  const sizeTokens = Object.keys(doc.theme?.fontSizes ?? {});
  const saveAsTextStyle = () => {
    const name = window.prompt("Name for the new text style", "style-1")?.trim();
    if (!name) return;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || doc.theme?.textStyles?.[name]) { useStore.getState().toast(`"${name}" is not a valid new text style name.`, "error"); return; }
    const captured = textStyleFromStyle(st);
    const rest = Object.fromEntries(Object.entries(st).filter(([key]) => !(key in captured)));
    const s = useStore.getState();
    const withStyle = { ...s.doc, theme: { ...(s.doc.theme ?? {}), textStyles: { ...(s.doc.theme?.textStyles ?? {}), [name]: captured } } };
    s.setDoc(ops.update(withStyle, comp.id, { textStyle: name, style: Object.keys(rest).length ? rest : undefined }));
  };
  return (
    <>
      <Field label="Text style">
        <span className="row-inline">
          <select aria-label="Text style" data-testid="text-style" value={comp.textStyle ?? ""} onChange={(e) => useStore.getState().patch(comp.id, { textStyle: e.target.value || undefined })}>
            <option value="">None</option>
            {textStyles.map((name) => <option key={name} value={name}>{name}</option>)}
            {comp.textStyle && !textStyles.includes(comp.textStyle) && <option value={comp.textStyle}>{comp.textStyle} (missing)</option>}
          </select>
          <button className="mini" data-testid="save-text-style" title="Save this component's text formatting as a reusable text style" onClick={saveAsTextStyle}>Save as style</button>
        </span>
      </Field>
      <Field label="Font">
        <select aria-label="Font family" value={st.fontFamily ?? ""} onChange={(e) => set({ fontFamily: e.target.value || undefined })}>
          <option value="">{doc.theme?.fonts?.body ?? "Default"}</option>
          {fontTokens.map((name) => <option key={`token-${name}`} value={`$${name}`}>{`$${name} (${doc.theme?.fonts?.[name]})`}</option>)}
          {FONT_FAMILIES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      <div className="grid2">
        <Field label="Size">
          <span className="row-inline">
            <Num label="Font size" value={typeof st.fontSize === "number" ? st.fontSize : undefined} min={4} onChange={(v) => set({ fontSize: v })} />
            {sizeTokens.length > 0 && <select aria-label="Font size token" value={typeof st.fontSize === "string" ? st.fontSize : ""} onChange={(e) => set({ fontSize: e.target.value || undefined })}>
              <option value="">pt</option>
              {sizeTokens.map((name) => <option key={name} value={`$${name}`}>{`$${name}`}</option>)}
            </select>}
          </span>
        </Field>
        <Field label="Weight">
          <select aria-label="Font weight" value={bold ? "bold" : "normal"} onChange={(e) => set({ fontWeight: e.target.value === "bold" ? "bold" : undefined })}>
            <option value="normal">Regular</option>
            <option value="bold">Bold</option>
          </select>
        </Field>
      </div>
      <div className="btn-row">
        <button aria-pressed={!!st.italic} className={st.italic ? "on" : ""} aria-label="Italic" onClick={() => set({ italic: st.italic ? undefined : true })}>
          <i>I</i>
        </button>
        <button aria-pressed={!!st.underline} className={st.underline ? "on" : ""} aria-label="Underline" onClick={() => set({ underline: st.underline ? undefined : true })}>
          <u>U</u>
        </button>
        <button aria-pressed={!!st.strikethrough} className={st.strikethrough ? "on" : ""} aria-label="Strikethrough" onClick={() => set({ strikethrough: st.strikethrough ? undefined : true })}>
          <s>S</s>
        </button>
        <span className="sep" />
        {(["left", "center", "right", "justify"] as const).map((a) => (
          <button key={a} aria-label={`Align ${a}`} aria-pressed={st.align === a} className={st.align === a ? "on" : ""} data-testid={`align-${a}`} onClick={() => set({ align: st.align === a ? undefined : a })}>
            {a === "left" ? "⯇" : a === "center" ? "☰" : a === "right" ? "⯈" : "▤"}
          </button>
        ))}
      </div>
      <Field label="Vertical">
        <select aria-label="Vertical align" data-testid="vertical-align" value={st.verticalAlign ?? ""} onChange={(e) => set({ verticalAlign: e.target.value || undefined })}>
          <option value="">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </Field>
    </>
  );
}

function Appearance({ comp }: { comp: ops.Comp }) {
  const patchStyle = useStore((s) => s.patchStyle);
  const st = comp.style ?? {};
  const set = (p: Record<string, any>) => patchStyle(comp.id, p);
  const border = st.border && st.border.width !== undefined ? st.border : undefined;
  return (
    <>
      <div className="grid2">
        <Field label="Text color">
          <Color label="Text color" value={st.color} onChange={(v) => set({ color: v })} />
        </Field>
        <Field label="Background">
          <Color label="Background" value={st.background} onChange={(v) => set({ background: v })} />
        </Field>
      </div>
      <div className="grid2">
        <Field label="Padding">
          <Num label="Padding" min={0} value={typeof st.padding === "number" ? st.padding : undefined} onChange={(v) => set({ padding: v })} />
        </Field>
        <Field label="Border">
          <Num label="Border width" min={0} step={0.5} value={border?.width} onChange={(v) => set({ border: v ? { width: v, style: "solid", color: border?.color ?? "#000000" } : undefined })} />
        </Field>
      </div>
      {border && (
        <Field label="Border color">
          <Color label="Border color" value={border.color} onChange={(v) => set({ border: { ...border, color: v ?? "#000000" } })} />
        </Field>
      )}
      {(st.background || border) && <Field label="Corner radius">
        <Num label="Corner radius" min={0} step={0.5} value={st.borderRadius} onChange={(v) => set({ borderRadius: v || undefined })} />
      </Field>}
    </>
  );
}

function Advanced({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  return (
    <Section title="Advanced" open={false}>
      <label className="check">
        <input type="checkbox" data-testid="flag-bookmark" checked={!!comp.bookmark} onChange={(e) => patch(comp.id, { bookmark: e.target.checked ? true : undefined })} />
        PDF bookmark (shows in the PDF outline / navigation pane)
      </label>
      {["text", "richText", "field"].includes(comp.type) && <><div className="group-title small">Overflow</div>
        <Field label="When text is too long">
          <select aria-label="Overflow" value={comp.style?.overflow ?? ""} onChange={(e) => useStore.getState().patchStyle(comp.id, { overflow: e.target.value || undefined })}>
            <option value="">Auto (continue when height is unset)</option>
            <option value="ellipsis">Single line with ellipsis</option>
            <option value="clip">Clip at box edge</option>
          </select>
        </Field>
        <p className="field-hint">Fixed-height text that exceeds its box blocks a strict render unless clipping is chosen.</p></>}
    </Section>
  );
}

// ------------------------------------------------------------------ type-specific panels
function TextProps({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  return (
    <Section title="Content">
      <ValueEditor comp={comp} />
      <Field label="Format as" wide>
        <FormatPicker comp={comp} patchTarget={(p) => patch(comp.id, p)} />
      </Field>
    </Section>
  );
}

export function ColumnEditor({ table, col, index }: { table: ops.Comp; col: any; index: number }) {
  const { doc, sample } = useStore();
  const patch = useStore((s) => s.patch);
  const candidates = useMemo(() => candidatesFor(doc, sample, table.id, table.dataset), [doc, sample, table.id, table.dataset]);
  const [open, setOpen] = useState(false);
  const mode: ValueMode = col.expression !== undefined ? "formula" : "field";
  const update = (p: Record<string, any>) => patch(table.id, { columns: table.columns.map((c: any, i: number) => (i === index ? { ...c, ...p } : c)) }, `col:${table.id}:${index}`);
  const move = (d: number) => {
    const cols = [...table.columns];
    const j = index + d;
    if (j < 0 || j >= cols.length) return;
    [cols[index], cols[j]] = [cols[j], cols[index]];
    patch(table.id, { columns: cols });
  };
  return (
    <div className="column-card" data-testid={`column-${index}`}>
      <div className="column-head">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"} {col.header || "(untitled)"}
        </button>
        <span className="spacer" />
        <button className="mini" aria-label="Move column left" onClick={() => move(-1)}>↑</button>
        <button className="mini" aria-label="Move column right" onClick={() => move(1)}>↓</button>
        <button className="mini danger" aria-label="Remove column" onClick={() => patch(table.id, { columns: table.columns.filter((_: any, i: number) => i !== index), ...(table.headerRows ? { headerRows: table.columns.length === 1 ? undefined : removeHeaderColumn(table.headerRows, index) } : {}), ...(table.cellSpans ? { cellSpans: removeBodyColumn(table.cellSpans, index) } : {}) })}>×</button>
      </div>
      {open && (
        <div className="column-body">
          <Field label="Header">
            <input aria-label="Column header" value={col.header ?? ""} onChange={(e) => update({ header: e.target.value })} />
          </Field>
          <label className="check" title="Consecutive rows with the same value print as one merged cell, inside merges of columns to the left. A merge that continues onto the next page prints its value again there.">
            <input type="checkbox" data-testid={`column-merge-repeated-${index}`} checked={!!col.mergeRepeated} onChange={(e) => update({ mergeRepeated: e.target.checked || undefined })} />
            Merge repeated values
          </label>
          <div className="seg small">
            {(["field", "formula"] as const).map((m) => (
              <button key={m} className={mode === m ? "active" : ""} onClick={() => update(m === "field" ? { binding: col.binding ?? col.expression ?? "row.value", expression: undefined } : { expression: col.expression ?? col.binding ?? "row.value", binding: undefined })}>
                {m === "field" ? "Field" : "fx Formula"}
              </button>
            ))}
          </div>
          {mode === "field" ? (
            <select aria-label="Column field" value={col.binding ?? ""} onChange={(e) => update({ binding: e.target.value })}>
              {!candidates.some((c) => c.value === col.binding) && <option value={col.binding ?? ""}>{col.binding}</option>}
              {candidates.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <FormulaInput value={col.expression ?? ""} candidates={candidates} onChange={(v) => update({ expression: v })} testId={`column-formula-${index}`} />
          )}
          <Field label="Format" wide>
            <FormatPicker comp={col} patchTarget={update} />
          </Field>
          <div className="grid2">
            <Field label="Width">
              <Dim label="Column width" value={col.width} placeholder="auto (*)" onChange={(v) => update({ width: v })} />
            </Field>
            <Field label="Align">
              <select aria-label="Column align" value={col.align ?? ""} onChange={(e) => update({ align: e.target.value || undefined })}>
                <option value="">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </Field>
          </div>
          <Field label="Total in footer">
            <select
              aria-label="Footer total"
              value={col.footer?.aggregate ?? ""}
              onChange={(e) => {
                update({ footer: e.target.value ? { aggregate: e.target.value } : undefined });
                if (e.target.value && !table.showFooter) patch(table.id, { showFooter: true });
              }}
            >
              <option value="">None</option>
              {["sum", "avg", "min", "max", "count"].map((a) => (
                <option key={a} value={a}>
                  {titleCase(a)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

function TableProps({ comp }: { comp: ops.Comp }) {
  const { doc, sample } = useStore();
  const patch = useStore((s) => s.patch);
  const refs = arrayRefs(doc, sample);
  const generate = () => {
    const fields = scalarFields(datasetFields(doc, sample, comp.dataset));
    patch(comp.id, {
      columns: fields.slice(0, 10).map((f) => {
        const money = f.kind === "number" && /amount|price|total|rate|cost|balance/i.test(f.name);
        return {
          id: f.name,
          header: titleCase(f.name),
          binding: `row.${f.path}`,
          format: f.kind === "date" ? "date:dd MMM yyyy" : money ? "currency" : undefined,
          align: f.kind === "number" ? "right" : undefined,
          // Numbers get compact fixed widths; text columns share the remaining space.
          width: money ? 80 : f.kind === "number" ? 50 : f.kind === "date" ? 70 : undefined,
        };
      }),
      headerRows: undefined,
      cellSpans: undefined,
    });
  };
  return (
    <>
      <div className="table-edit-entry">
        <div className="table-edit-summary" data-testid="table-summary">
          <strong>Table structure</strong>
          <span>{comp.columns?.length ?? 0} columns · {comp.headerRows?.length ?? 1} header {comp.headerRows?.length === 1 || !comp.headerRows ? "level" : "levels"} · {comp.cellSpans?.length ?? 0} merges</span>
        </div>
        <button className="btn primary" data-testid="open-table-designer" onClick={() => useStore.getState().set({ tableEditId: comp.id })}>Edit table</button>
      </div>
      <Section title="Data" summary={comp.dataset || "Choose a dataset"}>
        {refs.length === 0 && <div className="table-data-prompt"><p>No list data is available for this table yet.</p><button className="btn" data-testid="table-create-dataset" onClick={() => useStore.getState().set({ dialog: "dataset", editingDataset: null })}>Create dataset</button></div>}
        <Field label="Dataset">
          <select aria-label="Table dataset" data-testid="table-dataset" value={comp.dataset ?? ""} onChange={(e) => patch(comp.id, { dataset: e.target.value })}>
            <option value="">Choose...</option>
            {comp.dataset && !refs.includes(comp.dataset) && <option value={comp.dataset}>{comp.dataset}</option>}
            {refs.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <button className="btn" data-testid="generate-columns" onClick={generate} disabled={!comp.dataset}>
          Generate columns from data
        </button>
      </Section>
      <Section title="Typography" open={false}>
        <Typography comp={comp} />
      </Section>
    </>
  );
}

const SHEET_PRESETS: { label: string; cfg: Record<string, number>; margin: { top: number; left: number } }[] = [
  { label: "A4 · 2 × 4 (99.1 × 67.7 mm)", cfg: { columns: 2, rows: 4, labelWidth: 99.1, labelHeight: 67.7, gapX: 2.5, gapY: 0 }, margin: { top: 13, left: 4.7 } },
  { label: "A4 · 3 × 7 (63.5 × 38.1 mm)", cfg: { columns: 3, rows: 7, labelWidth: 63.5, labelHeight: 38.1, gapX: 2.5, gapY: 0 }, margin: { top: 15.1, left: 7.2 } },
  { label: "A4 · 2 × 7 (99.1 × 38.1 mm)", cfg: { columns: 2, rows: 7, labelWidth: 99.1, labelHeight: 38.1, gapX: 2.5, gapY: 0 }, margin: { top: 15.1, left: 4.7 } },
  { label: "A4 · 3 × 8 (70 × 36 mm)", cfg: { columns: 3, rows: 8, labelWidth: 70, labelHeight: 36, gapX: 0, gapY: 0 }, margin: { top: 4.5, left: 0 } },
  { label: "A4 · 4 equal (105 × 148.5 mm)", cfg: { columns: 2, rows: 2, labelWidth: 105, labelHeight: 148.5, gapX: 0, gapY: 0 }, margin: { top: 0, left: 0 } },
  { label: "A4 · 5 × 13 (38.1 × 21.2 mm)", cfg: { columns: 5, rows: 13, labelWidth: 38.1, labelHeight: 21.2, gapX: 2.5, gapY: 0 }, margin: { top: 10.7, left: 8.5 } },
];

/** Sticker/label sheet setup: grid, label size, gaps, start position, and a fit check against the page. */
function LabelSheetProps({ comp }: { comp: ops.Comp }) {
  const { doc } = useStore();
  const patch = useStore((s) => s.patch);
  const setDoc = useStore((s) => s.setDoc);
  const engine = useStore((s) => s.engine);
  const pag = engine.paginated;
  const mmFromPt = (v: number) => (v * 25.4) / 72;
  const gx = comp.gapX ?? 0;
  const gy = comp.gapY ?? 0;
  const sheetW = comp.columns * comp.labelWidth + (comp.columns - 1) * gx;
  const sheetH = comp.rows * comp.labelHeight + (comp.rows - 1) * gy;
  const pageW = pag ? mmFromPt(pag.pageSize.width - pag.margin.left - pag.margin.right) : undefined;
  const pageH = pag ? mmFromPt(pag.pageSize.height - pag.margin.top - pag.margin.bottom) : undefined;
  const fits = pageW === undefined || (sheetW <= pageW + 0.05 && sheetH <= (pageH ?? 0) + 0.05);
  const num = (key: string, label: string, min = 0, step = 0.1) => (
    <Field label={label}>
      <Num label={label} min={min} step={step} value={comp[key]} onChange={(v) => patch(comp.id, { [key]: v })} />
    </Field>
  );
  return (
    <Section title="Label sheet">
      <Field label="Sheet type" wide>
        <select
          aria-label="Sheet preset"
          data-testid="sheet-preset"
          value=""
          onChange={(e) => {
            const p = SHEET_PRESETS[Number(e.target.value)];
            if (!p) return;
            const next = ops.update(doc, comp.id, { ...p.cfg });
            setDoc({ ...next, page: { ...(next.page ?? {}), size: "A4", orientation: "portrait", unit: "mm", margin: { top: p.margin.top, left: p.margin.left, right: 0, bottom: 0 } } });
          }}
        >
          <option value="">Choose a label stock…</option>
          {SHEET_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
          ))}
        </select>
      </Field>
      <div className="grid2">
        {num("columns", "Columns", 1, 1)}
        {num("rows", "Rows", 1, 1)}
        {num("labelWidth", "Label width (mm)", 1)}
        {num("labelHeight", "Label height (mm)", 1)}
        {num("gapX", "Gap across (mm)")}
        {num("gapY", "Gap down (mm)")}
      </div>
      <Field label="Start at position">
        <Num label="Start position" min={1} value={comp.startPosition ?? 1} onChange={(v) => patch(comp.id, { startPosition: v && v > 1 ? v : undefined })} />
      </Field>
      <Field label="Fill" wide>
        <select
          aria-label="Fill mode"
          data-testid="sheet-fill"
          value={comp.dataset ? "records" : "copies"}
          onChange={(e) => patch(comp.id, e.target.value === "records" ? { dataset: (doc.datasets ?? [])[0]?.id ?? "", copies: undefined } : { dataset: undefined, copies: comp.copies ?? comp.columns * comp.rows })}
        >
          <option value="copies">Repeat the same label</option>
          <option value="records">One label per record</option>
        </select>
      </Field>
      {comp.dataset !== undefined && (
        <Field label="Dataset" wide>
          <select aria-label="Sheet dataset" value={comp.dataset} onChange={(e) => patch(comp.id, { dataset: e.target.value })}>
            {(doc.datasets ?? []).map((d: any) => (
              <option key={d.id}>{d.id}</option>
            ))}
          </select>
        </Field>
      )}
      {comp.dataset === undefined && num("copies", "Number of labels", 1, 1)}
      <label className="check">
        <input type="checkbox" data-testid="sheet-outlines" checked={!!comp.outlines} onChange={(e) => patch(comp.id, { outlines: e.target.checked ? true : undefined })} />
        Draw label outlines (alignment test on plain paper)
      </label>
      <div className={`print-facts ${fits ? "" : "bad"}`} data-testid="sheet-facts">
        <div>Sheet area <strong>{sheetW.toFixed(1)} × {sheetH.toFixed(1)} mm</strong>{pageW !== undefined && <> of {pageW.toFixed(1)} × {pageH!.toFixed(1)} mm printable</>}</div>
        <div>{comp.columns * comp.rows} labels per sheet{comp.dataset === undefined && comp.copies ? ` · ${Math.ceil((comp.copies + Math.max(0, (comp.startPosition ?? 1) - 1)) / (comp.columns * comp.rows))} sheet(s)` : ""}</div>
        {!fits && <div className="field-error">The labels do not fit on the page. Check the page margins and label size.</div>}
      </div>
      <p className="muted small">Design ONE label by dropping elements into this sheet. Printers need “Actual size” (no scaling) for the labels to line up.</p>
    </Section>
  );
}

function ChartProps({ comp }: { comp: ops.Comp }) {
  const { doc, sample } = useStore();
  const patch = useStore((s) => s.patch);
  const refs = arrayRefs(doc, sample);
  const candidates = candidatesFor(doc, sample, comp.id, comp.dataset);
  const series: any[] = comp.series ?? [];
  const setSeries = (s: any[]) => patch(comp.id, { series: s });
  return (
    <Section title="Chart">
      <Field label="Type">
        <select aria-label="Chart type" value={comp.chartType} onChange={(e) => patch(comp.id, { chartType: e.target.value })}>
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="pie">Pie</option>
        </select>
      </Field>
      <Field label="Title">
        <input aria-label="Chart title" value={comp.title ?? ""} onChange={(e) => patch(comp.id, { title: e.target.value || undefined })} />
      </Field>
      <Field label="Dataset">
        <select aria-label="Chart dataset" value={comp.dataset ?? ""} onChange={(e) => patch(comp.id, { dataset: e.target.value })}>
          <option value="">Choose...</option>
          {refs.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </Field>
      <Field label="Category">
        <select aria-label="Category field" value={comp.categoryBinding ?? ""} onChange={(e) => patch(comp.id, { categoryBinding: e.target.value })}>
          <option value="">Row number</option>
          {candidates.filter((c) => c.value.startsWith("row.")).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      {series.map((s, i) => (
        <div className="series-row" key={i}>
          <input aria-label="Series name" value={s.name} onChange={(e) => setSeries(series.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select aria-label="Series field" value={s.binding ?? ""} onChange={(e) => setSeries(series.map((x, j) => (j === i ? { ...x, binding: e.target.value } : x)))}>
            <option value="">Field...</option>
            {candidates.filter((c) => c.value.startsWith("row.")).map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button className="mini danger" aria-label="Remove series" onClick={() => setSeries(series.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="btn" onClick={() => setSeries([...series, { name: `Series ${series.length + 1}`, binding: candidates.find((c) => c.kind === "number" && c.value.startsWith("row."))?.value }])}>
        + Add series
      </button>
    </Section>
  );
}

function CodeProps({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  return (
    <Section title={comp.type === "qrcode" ? "QR code" : "Barcode"}>
      <ValueEditor comp={comp} />
      {comp.type === "barcode" && (
        <Field label="Symbology">
          <select aria-label="Symbology" value={comp.symbology ?? "code128"} onChange={(e) => patch(comp.id, { symbology: e.target.value })}>
            {["code128", "code39", "ean13", "upc"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      )}
    </Section>
  );
}

function ImageProps({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  const embedded = comp.src?.startsWith("data:");
  return (
    <Section title="Image">
      <Field label="Image path or URL">
        <input aria-label="Image path or URL" placeholder="/path/to/logo.png or https://…" value={embedded ? "" : comp.src ?? ""} onChange={(e) => patch(comp.id, { src: e.target.value })} />
      </Field>
      <p className="field-hint">{embedded ? "Image embedded in this report. Enter a path or URL to link it instead." : "Linked images update on the next render. The server must be able to reach this path or URL."}</p>
      <label className="btn file">
        Embed image from file
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => patch(comp.id, { src: String(r.result) });
            r.readAsDataURL(f);
          }}
        />
      </label>
      <Field label="Fit">
        <select aria-label="Image fit" value={comp.fit ?? "contain"} onChange={(e) => patch(comp.id, { fit: e.target.value })}>
          {["contain", "cover", "fill", "stretch", "fit"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
    </Section>
  );
}

function SubreportProps({ comp }: { comp: ops.Comp }) {
  const { doc } = useStore();
  const picker = React.useRef<HTMLInputElement>(null);
  const linked = comp.reportId ? doc.subreports?.[comp.reportId] as Record<string, unknown> | undefined : undefined;
  const chooseFile = async (file?: File) => {
    if (!file) return;
    try {
      const selected = parseSubreportFile(await file.text());
      let id = selected.id;
      let suffix = 2;
      while (doc.subreports?.[id] && JSON.stringify(doc.subreports[id]) !== JSON.stringify(selected.definition)) id = `${selected.id}-${suffix++}`;
      const next = ops.update(doc, comp.id, { reportId: id, name: comp.name ?? selected.name });
      useStore.getState().setDoc({ ...next, subreports: { ...(doc.subreports ?? {}), [id]: selected.definition } });
      useStore.getState().toast(`Added “${selected.name}” as a subreport.`, "success");
    } catch (error) {
      useStore.getState().toast(`Could not use that report file: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      if (picker.current) picker.current.value = "";
    }
  };
  return <Section title="Subreport">
    <p className="field-hint">Choose another Open Reports JSON file. It stays attached to this report and can be reused anywhere you add a Subreport.</p>
    <input ref={picker} type="file" accept=".json,application/json" hidden data-testid="subreport-file" aria-label="Choose subreport JSON file" onChange={(event) => void chooseFile(event.currentTarget.files?.[0])} />
    <button type="button" className="btn" data-testid="choose-subreport" onClick={() => picker.current?.click()}>{linked ? "Choose a different report file" : "Choose report file…"}</button>
    {linked && <SubreportData comp={comp} child={linked} />}
    {linked ? <div className="subreport-file-status" data-testid="subreport-file-status" role="status"><strong>{String(linked.name ?? "Subreport")}</strong><small>Report ID: {comp.reportId}</small></div> : <p className="field-hint">No file selected yet. Choose a report definition to see it in the preview and include it when exporting.</p>}
  </Section>;
}

/** Which parent dataset fills the child report's single dataset, e.g. this customer's branding for a shared header. */
function SubreportData({ comp, child }: { comp: ops.Comp; child: Record<string, unknown> }) {
  const { doc } = useStore();
  const patch = useStore((s) => s.patch);
  const childDatasets = Array.isArray(child.datasets) ? child.datasets as { id: string }[] : [];
  if (childDatasets.length !== 1) return <p className="field-hint">{childDatasets.length ? "This report has several datasets; supply them from your application when rendering." : "This report has no dataset of its own."}</p>;
  return <Field label="Data for the subreport" wide>
    <select data-testid="subreport-dataset" aria-label="Data for the subreport" value={comp.dataset ?? ""} onChange={(event) => patch(comp.id, { dataset: event.target.value || undefined })}>
      <option value="">Its own sample data</option>
      {((doc.datasets ?? []) as { id: string }[]).map((dataset) => <option key={dataset.id} value={dataset.id}>{`This report's ${dataset.id} data`}</option>)}
    </select>
    <span className="field-hint">{`Rows from the selected dataset fill the subreport's “${childDatasets[0]!.id}” dataset.`}</span>
  </Field>;
}

function SpacingEditor({ comp, prop, label }: { comp: ops.Comp; prop: "margin" | "padding"; label: string }) {
  const patchStyle = useStore((s) => s.patchStyle);
  return <SpacingFields label={label} value={comp.style?.[prop]} onChange={(next) => patchStyle(comp.id, { [prop]: next })} />;
}

function QuickGeometry({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  const absolute = comp.x !== undefined || comp.y !== undefined || ops.parentLayout(useStore.getState().doc, comp.id) === "absolute";
  return <div className="quick-geometry" data-testid="quick-geometry">
    <div className="grid2">
      <Field label="Width"><Dim label="Width" value={comp.width} onChange={(value) => patch(comp.id, { width: value })} /></Field>
      <Field label="Height"><Dim label="Height" value={comp.height} onChange={(value) => patch(comp.id, { height: value })} /></Field>
    </div>
    {absolute && <div className="grid2">
      <Field label="X"><Dim label="X position" value={comp.x} onChange={(value) => patch(comp.id, { x: value })} /></Field>
      <Field label="Y"><Dim label="Y position" value={comp.y} onChange={(value) => patch(comp.id, { y: value })} /></Field>
    </div>}
  </div>;
}

function LayoutProps({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  const isContainer = ["container", "row", "column", "grid", "repeater", "keepTogether"].includes(comp.type);
  const absolute = comp.x !== undefined || comp.y !== undefined;
  const parentLayout = ops.parentLayout(useStore.getState().doc, comp.id);
  const layout = comp.layout ?? (comp.type === "row" ? "row" : comp.type === "grid" ? "grid" : "flow");
  const textChild = ["text", "richText", "field"].includes(comp.type);
  const widthMode = comp.width === "auto" && textChild ? "hug" : comp.width === undefined || comp.width === "*" || comp.width === "auto" ? "fill" : "fixed";
  const summary = isContainer ? ({ flow: "Stack", row: "Row", grid: "Grid", absolute: "Free" } as Record<string, string>)[layout]
    : absolute ? "Free position" : parentLayout === "row" ? ({ hug: "Hug text", fill: "Fill width", fixed: "Fixed width" } as Record<string, string>)[widthMode] : "Flow";
  return (
    <>
      <Section title="Layout" summary={summary}>
        {isContainer && comp.type !== "repeater" && (
          <Field label="Arrange children">
            <select aria-label="Layout" value={layout} onChange={(e) => patch(comp.id, { layout: e.target.value })}>
              <option value="flow">Stacked (flow)</option>
              <option value="row">Side by side (row)</option>
              <option value="grid">Grid</option>
              <option value="absolute">Free position (absolute)</option>
            </select>
          </Field>
        )}
        {isContainer && comp.type !== "repeater" && layout === "grid" && (
          <Field label="Columns">
            <Num label="Grid columns" min={1} value={comp.columns} onChange={(v) => patch(comp.id, { columns: v ?? 1 })} />
          </Field>
        )}
        {comp.type === "repeater" && (<>
          <Field label="Dataset">
            <select aria-label="Repeater dataset" value={comp.dataset ?? ""} onChange={(e) => patch(comp.id, { dataset: e.target.value })}>
              <option value="">Choose...</option>
              {arrayRefs(useStore.getState().doc, useStore.getState().sample).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <div className="grid2">
            <Field label="Items">
              <select aria-label="Item layout" data-testid="repeater-item-layout" value={comp.itemLayout ?? "flow"} onChange={(e) => patch(comp.id, { itemLayout: e.target.value === "flow" ? undefined : e.target.value, columns: e.target.value === "grid" ? comp.columns ?? 2 : undefined })}>
                <option value="flow">Stacked</option>
                <option value="row">Side by side</option>
                <option value="grid">Grid</option>
              </select>
            </Field>
            {comp.itemLayout === "grid" && <Field label="Per row">
              <Num label="Items per row" min={1} value={comp.columns} onChange={(v) => patch(comp.id, { columns: v ?? 2 })} />
            </Field>}
          </div>
        </>)}
        {isContainer && layout !== "absolute" && (
          <>
            <div className="grid2">
              <Field label="Gap">
                <Num label="Gap between children" min={0} value={comp.gap} onChange={(v) => patch(comp.id, { gap: v })} />
              </Field>
              {(layout === "row" || layout === "flow") && <Field label="Align items">
                <select aria-label="Align items" value={comp.alignItems ?? ""} onChange={(e) => patch(comp.id, { alignItems: e.target.value || undefined })}>
                  <option value="">Default</option>
                  <option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="stretch">Stretch</option>
                </select>
              </Field>}
            </div>
            {layout === "row" && <>
              <Field label="Distribute">
                <select aria-label="Justify content" value={comp.justifyContent ?? ""} onChange={(e) => patch(comp.id, { justifyContent: e.target.value || undefined })}>
                  <option value="">Start</option><option value="center">Center</option><option value="end">End</option><option value="space-between">Space between</option><option value="space-around">Space around</option>
                </select>
              </Field>
              <label className="check"><input type="checkbox" aria-label="Wrap row items" checked={!!comp.wrap} onChange={(e) => patch(comp.id, { wrap: e.target.checked || undefined })} />Wrap items onto another line</label>
            </>}
          </>
        )}
        {parentLayout === "row" && !absolute && <Field label="Width in row">
          <select aria-label="Width in row" data-testid="row-width-mode" value={widthMode} onChange={(event) => patch(comp.id, { width: event.target.value === "hug" ? "auto" : event.target.value === "fixed" ? 100 : undefined, grow: undefined })}>
            <option value="fill">Fill available space</option>
            {textChild && <option value="hug">Hug text</option>}
            <option value="fixed">Fixed width</option>
          </select>
        </Field>}
        {parentLayout === "row" && !absolute && widthMode === "fixed" && <p className="field-hint">Set the exact width above. Distribution uses space left after fixed and hugged children.</p>}
        {parentLayout === "row" && !absolute && widthMode !== "fill" && <Field label="Shrink (when crowded)">
          <Num label="Shrink" min={0} value={comp.shrink} onChange={(v) => patch(comp.id, { shrink: v })} />
        </Field>}
        {!absolute && parentLayout !== "absolute" && <p className="field-hint">Drag this element on the canvas to place it freely within its section.</p>}
        {absolute && parentLayout !== "absolute" && (
          <button className="btn" onClick={() => patch(comp.id, { x: undefined, y: undefined })}>Return to flow</button>
        )}
        <SpacingEditor comp={comp} prop="margin" label="Margin" />
        <SpacingEditor comp={comp} prop="padding" label="Padding" />
        {parentLayout === "row" && !absolute && widthMode === "fill" && (
          <Field label="Grow (share extra width)">
            <Num label="Grow" min={0} value={comp.grow} onChange={(v) => patch(comp.id, { grow: v })} />
          </Field>
        )}
      </Section>
      <Section title="Size limits" open={false}>
        <div className="grid2">
          <Field label="Min width"><Dim label="Min width" value={comp.minWidth} onChange={(v) => patch(comp.id, { minWidth: v })} /></Field>
          <Field label="Max width"><Dim label="Max width" value={comp.maxWidth} onChange={(v) => patch(comp.id, { maxWidth: v })} /></Field>
          <Field label="Min height"><Dim label="Min height" value={comp.minHeight} onChange={(v) => patch(comp.id, { minHeight: v })} /></Field>
          <Field label="Max height"><Dim label="Max height" value={comp.maxHeight} onChange={(v) => patch(comp.id, { maxHeight: v })} /></Field>
        </div>
      </Section>
    </>
  );
}

function PaginationProps({ comp }: { comp: ops.Comp }) {
  const patch = useStore((s) => s.patch);
  const flag = (key: string, label: string) => (
    <label className="check" key={key}>
      <input type="checkbox" data-testid={`flag-${key}`} checked={!!comp[key]} onChange={(e) => patch(comp.id, { [key]: e.target.checked ? true : undefined })} />
      {label}
    </label>
  );
  return <Section title="Pagination" open={false} summary={comp.keepTogether || comp.keepWithNext || comp.pageBreakBefore || comp.pageBreakAfter || comp.minLinesAtTop || comp.minLinesAtBottom ? "Custom" : "Default"}>
    {flag("keepTogether", "Keep together (never split across pages)")}
    {flag("keepWithNext", "Keep with next element")}
    {comp.type === "text" && (
      <div className="grid2">
        <Field label="Min lines at top"><Num label="Minimum lines at top of page" min={0} value={comp.minLinesAtTop} onChange={(v) => patch(comp.id, { minLinesAtTop: v })} /></Field>
        <Field label="Min lines at bottom"><Num label="Minimum lines at bottom of page" min={0} value={comp.minLinesAtBottom} onChange={(v) => patch(comp.id, { minLinesAtBottom: v })} /></Field>
      </div>
    )}
    {flag("pageBreakBefore", "Start on a new page")}
    {flag("pageBreakAfter", "Page break after")}
  </Section>;
}

const PRINT_PRESETS: { label: string; profile: Record<string, unknown>; page?: Record<string, unknown> }[] = [
  { label: "Office printer (A4)", profile: { printerType: "document", language: "pdf", dpi: 300, safeMargin: 5 } },
  { label: "Receipt roll 80 mm (continuous)", profile: { printerType: "receipt", language: "escpos", dpi: 203, safeMargin: 2 }, page: { size: "custom", width: 80, height: 200, unit: "mm", orientation: "portrait", continuous: {} } },
  { label: "Receipt roll 58 mm (continuous)", profile: { printerType: "receipt", language: "escpos", dpi: 203, safeMargin: 2 }, page: { size: "custom", width: 58, height: 200, unit: "mm", orientation: "portrait", continuous: {} } },
  { label: "Label 40 × 25 mm (ZPL 203 dpi)", profile: { printerType: "label", language: "zpl", dpi: 203, safeMargin: 1.5 }, page: { size: "custom", width: 40, height: 25, unit: "mm", orientation: "landscape", margin: { top: 1.5, right: 2, bottom: 1.5, left: 2 } } },
  { label: "Label 50 × 30 mm (ZPL 203 dpi)", profile: { printerType: "label", language: "zpl", dpi: 203, safeMargin: 1.5 }, page: { size: "custom", width: 50, height: 30, unit: "mm", orientation: "landscape" } },
  { label: "Label 100 × 50 mm (ZPL 300 dpi)", profile: { printerType: "label", language: "zpl", dpi: 300, safeMargin: 2 }, page: { size: "custom", width: 100, height: 50, unit: "mm", orientation: "landscape" } },
  { label: "Continuous label roll 100 mm (ZPL, up to 600 mm)", profile: { printerType: "label", language: "zpl", dpi: 203, safeMargin: 2 }, page: { size: "custom", width: 100, height: 150, unit: "mm", orientation: "portrait", continuous: { maxLength: 600 } } },
  { label: "Event ticket 5.5 × 2 in (ZPL 203 dpi)", profile: { printerType: "card", language: "zpl", dpi: 203, safeMargin: 1.5 }, page: { size: "custom", width: 5.5, height: 2, unit: "in", orientation: "landscape", margin: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 } } },
  { label: "Hang tag 50 × 90 mm (PDF 300 dpi)", profile: { printerType: "card", language: "pdf", dpi: 300, safeMargin: 2 }, page: { size: "custom", width: 50, height: 90, unit: "mm", orientation: "portrait" } },
  { label: "Wristband 254 × 25 mm (ZPL 300 dpi, printed rotated)", profile: { printerType: "wristband", language: "zpl", dpi: 300, safeMargin: 1, rotation: 90 }, page: { size: "custom", width: 254, height: 25, unit: "mm", orientation: "landscape", margin: { top: 2, right: 3, bottom: 2, left: 3 } } },
];

function PrintProfilePanel() {
  const { doc, engine } = useStore();
  const setDoc = useStore((s) => s.setDoc);
  const [profiles, setProfiles] = useState<SavedPrinterProfile[]>([]);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const print = doc.print;
  const pag = engine.paginated;
  const mm = (pt: number) => (pt * 25.4) / 72;
  const dpi = print?.dpi ?? 203;
  const presetIndex = PRINT_PRESETS.findIndex((preset) =>
    print && Object.entries(preset.profile).every(([key, value]) => print[key as keyof typeof print] === value)
      && (print.rotation ?? 0) === ((preset.profile.rotation as number | undefined) ?? 0)
      && (!preset.page || (JSON.stringify(doc.page?.continuous ?? null) === JSON.stringify(preset.page.continuous ?? null) && Object.entries(preset.page).every(([key, value]) =>
        key === "continuous" ? true
        : key === "margin"
          ? Object.entries(value as Record<string, number>).every(([side, amount]) => doc.page?.margin?.[side] === amount)
          : doc.page?.[key as keyof typeof doc.page] === value)))
  );
  const set = (p: Record<string, unknown>) => {
    const { name: _name, ...settings } = doc.print ?? {};
    setDoc({ ...doc, print: { ...settings, ...p } }, { coalesce: "print" });
  };
  useEffect(() => {
    let active = true;
    api.listPrinterProfiles().then((items) => { if (active) setProfiles(items); }).catch((error) => { if (active) setProfileError((error as Error).message); });
    return () => { active = false; };
  }, []);
  const samePage = (page: Record<string, any>) => ["size", "width", "height", "unit", "orientation"].every((key) => page[key] === doc.page?.[key])
    && ["top", "right", "bottom", "left"].every((side) => page.margin?.[side] === doc.page?.margin?.[side]);
  const selectedProfile = profiles.find((profile) => print && ["printerType", "language", "dpi", "safeMargin"].every((key) => profile.print[key as keyof typeof profile.print] === print[key])
    && JSON.stringify(profile.print.calibration ?? null) === JSON.stringify(print.calibration ?? null) && samePage(profile.page));
  const applySavedProfile = (profile: SavedPrinterProfile) => {
    setDoc({ ...doc, print: { ...profile.print }, page: structuredClone(profile.page) });
    useStore.getState().set({ target: profile.print.printerType === "receipt" ? "escpos" : "pdf" });
    if (profile.page.unit === "mm" && profile.page.size === "custom" && profile.page.width) useStore.getState().set({ zoom: fitZoom(profile.page.width * 72 / 25.4), fitToWidth: true });
  };
  const saveCurrentProfile = async () => {
    const name = profileName.trim();
    if (!name || !print || !doc.page) return;
    setProfileBusy(true);
    try {
      const { name: _name, ...settings } = print;
      const profile = await api.putPrinterProfile(`printer-${crypto.randomUUID()}`, name, settings, doc.page);
      setProfiles((items) => [...items, profile].sort((a, b) => a.name.localeCompare(b.name)));
      setProfileError("");
      setSavingProfile(false);
      setProfileName("");
      useStore.getState().toast(`Saved printer profile “${name}”`, "success");
    } catch (error) { setProfileError((error as Error).message); }
    finally { setProfileBusy(false); }
  };
  const deleteSelectedProfile = async () => {
    if (!selectedProfile) return;
    setProfileBusy(true);
    try {
      await api.deletePrinterProfile(selectedProfile.id);
      setProfiles((items) => items.filter((item) => item.id !== selectedProfile.id));
      useStore.getState().toast(`Deleted saved profile “${selectedProfile.name}”; report settings kept`, "success");
    } catch (error) { setProfileError((error as Error).message); }
    finally { setProfileBusy(false); }
  };
  return (
    <div className="prop-body print-profile-body">
      <Field label="Saved printer profile" wide>
        <select aria-label="Saved printer profile" data-testid="saved-print-profile" value={selectedProfile?.id ?? ""} onChange={(event) => {
          const profile = profiles.find((item) => item.id === event.target.value);
          if (profile) applySavedProfile(profile);
        }}>
          <option value="">{profiles.length ? "Custom settings" : "No saved profiles yet"}</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </Field>
      {!savingProfile ? <div className="profile-actions">
        <button className="link" type="button" data-testid="save-printer-profile" disabled={!print} onClick={() => setSavingProfile(true)}>Save current settings as profile</button>
        {selectedProfile && <button className="link danger" type="button" disabled={profileBusy} onClick={deleteSelectedProfile}>Delete saved profile</button>}
      </div> : <div className="profile-save-row">
        <input aria-label="New printer profile name" placeholder="e.g. Lab label printer" maxLength={100} value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveCurrentProfile(); if (event.key === "Escape") setSavingProfile(false); }} />
        <button className="btn primary" type="button" disabled={!profileName.trim() || profileBusy} onClick={saveCurrentProfile}>Save</button>
        <button className="btn" type="button" onClick={() => setSavingProfile(false)}>Cancel</button>
      </div>}
      {profileError && <p className="field-hint" role="alert">{profileError}</p>}
      <p className="field-hint">Applying a saved profile copies its media and output settings into this report.</p>
      <Field label="Printer / media preset" wide>
        <select
          aria-label="Printer / media preset"
          data-testid="print-preset"
          value={presetIndex < 0 ? "" : String(presetIndex)}
          onChange={(e) => {
            const preset = PRINT_PRESETS[Number(e.target.value)];
            if (!preset) return;
            setDoc({ ...doc, print: { ...preset.profile }, page: preset.page ? { ...(doc.page ?? {}), ...preset.page, continuous: preset.page.continuous, margin: preset.page.margin ?? { top: 2, right: 2, bottom: 2, left: 2 } } : doc.page });
            useStore.getState().set({ target: preset.profile.printerType === "receipt" ? "escpos" : "pdf" });
            if (preset.page?.unit === "mm" && typeof preset.page.width === "number") {
              useStore.getState().set({ zoom: fitZoom(preset.page.width * 72 / 25.4), fitToWidth: true });
            }
          }}
        >
          <option value="">{print ? "Custom settings" : "Choose a printer / media…"}</option>
          {PRINT_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
          ))}
        </select>
      </Field>
      <div className="grid2">
        <Field label="Printer type">
          <select aria-label="Printer type" value={print?.printerType ?? ""} onChange={(e) => set({ printerType: e.target.value || undefined })}>
            <option value="">Not set</option>
            {["document", "label", "receipt", "card", "wristband"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Language">
          <select aria-label="Printer language" value={print?.language ?? ""} onChange={(e) => { set({ language: e.target.value || undefined }); useStore.getState().set({ target: e.target.value || "pdf" }); }}>
            <option value="">PDF</option>
            <option value="zpl">ZPL</option>
            <option value="escpos">ESC/POS</option>
          </select>
        </Field>
        <Field label="Resolution (dpi)">
          <select aria-label="DPI" data-testid="print-dpi" value={print?.dpi ?? ""} onChange={(e) => set({ dpi: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Default</option>
            {[152, 203, 300, 600].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Safe margin (mm)">
          <Num label="Safe margin" min={0} step={0.5} value={print?.safeMargin} onChange={(v) => set({ safeMargin: v })} />
        </Field>
        <Field label="Print rotation">
          <select aria-label="Print rotation" data-testid="print-rotation" value={print?.rotation ?? 0} onChange={(e) => set({ rotation: Number(e.target.value) === 0 ? undefined : Number(e.target.value) })} title="Turn the output for media fed in a different direction from the design, e.g. wristbands">
            <option value={0}>As designed</option><option value={90}>90° clockwise</option><option value={180}>180°</option><option value={270}>90° counter-clockwise</option>
          </select>
        </Field>
        <Field label="Length" wide>
          <span className="row-inline">
            <label className="check" title="Make the page as long as its content, for label and receipt rolls"><input type="checkbox" data-testid="page-continuous" checked={!!doc.page?.continuous} onChange={(e) => setDoc({ ...doc, page: { ...(doc.page ?? {}), continuous: e.target.checked ? {} : undefined } })} />Continuous</label>
          </span>
        </Field>
        {doc.page?.continuous && <div className="grid2">
          <Field label={`Minimum (${doc.page.unit ?? "mm"})`}><Num label="Minimum length" min={0} value={doc.page.continuous.minLength} onChange={(v) => setDoc({ ...doc, page: { ...doc.page, continuous: { ...doc.page.continuous, minLength: v || undefined } } }, { coalesce: "continuous" })} /></Field>
          <Field label={`Maximum (${doc.page.unit ?? "mm"})`}><Num label="Maximum length" min={0} value={doc.page.continuous.maxLength} onChange={(v) => setDoc({ ...doc, page: { ...doc.page, continuous: { ...doc.page.continuous, maxLength: v || undefined } } }, { coalesce: "continuous" })} /></Field>
        </div>}
      </div>
      {pag && (
        <div className="print-facts" data-testid="print-facts">
          {print?.printerType === "receipt" ? <>
            <div>Roll width <strong>{mm(pag.pageSize.width).toFixed(1)} mm · continuous to final cut</strong></div>
            <div>Printable width at {dpi} dpi <strong>{Math.max(16, Math.floor(((pag.pageSize.width - pag.margin.left - pag.margin.right) / 72 * dpi) / 12))} printer columns</strong></div>
            <div>PDF page height <strong>{mm(pag.pageSize.height).toFixed(1)} mm</strong> · does not limit ESC/POS roll length</div>
          </> : <>
            <div>Physical size <strong>{mm(pag.pageSize.width).toFixed(1)} × {mm(pag.pageSize.height).toFixed(1)} mm</strong></div>
            <div>At {dpi} dpi <strong>{Math.round((mm(pag.pageSize.width) / 25.4) * dpi)} × {Math.round((mm(pag.pageSize.height) / 25.4) * dpi)} dots</strong></div>
          </>}
          {print?.safeMargin ? <div>Keep content {print.safeMargin} mm from the edge (shown on the canvas)</div> : null}
        </div>
      )}
      {print?.language === "zpl" && <PrintCalibration />}
      {print?.calibration && print.language !== "zpl" && <p className="field-hint">Saved calibration is applied only to ZPL output.</p>}
      {print && (
        <button className="btn" onClick={() => setDoc({ ...doc, print: undefined })}>
          Remove print profile
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ page / report panel (nothing selected)
function PageProps() {
  const { doc } = useStore();
  const reportTab = useStore((s) => s.reportInspectorTab);
  const set = useStore((s) => s.set);
  const setDoc = useStore((s) => s.setDoc);
  const page = doc.page ?? {};
  const margin = page.margin ?? { top: 15, right: 15, bottom: 18, left: 15 };
  const setPage = (p: Record<string, any>) => setDoc({ ...doc, page: { ...page, ...p } }, { coalesce: "page" });
  const setTheme = (p: Record<string, any>) => setDoc({ ...doc, theme: { ...(doc.theme ?? {}), ...p } }, { coalesce: "theme" });
  return (
    <>
      <div className="prop-head">
        <strong>Report settings</strong>
      </div>
      <InspectorTabs label="Report settings" tabs={[{ id: "page", label: "Page" }, { id: "print", label: "Print" }, { id: "details", label: "Details" }]} active={reportTab} onChange={(next) => set({ reportInspectorTab: next })} testIdPrefix="report-tab">
      {reportTab === "details" && <Section title="Report">
        <Field label="Name">
          <input aria-label="Report name" data-testid="report-name" value={doc.name ?? ""} onChange={(e) => setDoc({ ...doc, name: e.target.value }, { coalesce: "name" })} />
        </Field>
        <Field label="Id">
          <input aria-label="Report id" value={doc.id ?? ""} onChange={(e) => setDoc({ ...doc, id: e.target.value.replace(/[^a-z0-9-_]/gi, "-").toLowerCase() }, { coalesce: "id" })} />
        </Field>
        <Field label="Description">
          <input aria-label="Description" value={doc.description ?? ""} onChange={(e) => setDoc({ ...doc, description: e.target.value }, { coalesce: "desc" })} />
        </Field>
      </Section>}
      {reportTab === "page" && <>
      <Section title="Size & margins">
        <div className="grid2">
          <Field label="Size">
            <select aria-label="Page size" data-testid="page-size" value={page.size ?? "A4"} onChange={(e) => setPage({ size: e.target.value, ...(e.target.value === "custom" && !page.width ? { width: 100, height: 150, unit: "mm" } : {}) })}>
              {["A4", "A3", "A5", "A6", "Letter", "Legal", "custom"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Orientation">
            <select aria-label="Orientation" data-testid="page-orientation" value={page.orientation ?? "portrait"} onChange={(e) => setPage({ orientation: e.target.value })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>
        </div>
        {page.size === "custom" && (
          <div className="grid3">
            <Field label="Width">
              <Num label="Page width" value={page.width} onChange={(v) => setPage({ width: v })} />
            </Field>
            <Field label="Height">
              <Num label="Page height" value={page.height} onChange={(v) => setPage({ height: v })} />
            </Field>
            <Field label="Unit">
              <select aria-label="Unit" value={page.unit ?? "mm"} onChange={(e) => setPage({ unit: e.target.value })}>
                {["mm", "cm", "in", "pt", "px"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="grid4">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <Field key={side} label={titleCase(side)}>
              <Num label={`Margin ${side}`} min={0} value={margin[side]} onChange={(v) => setPage({ margin: { ...margin, [side]: v ?? 0 } })} />
            </Field>
          ))}
        </div>
      </Section>
      <Section title="Watermark" open={!!doc.watermark}>
        <Field label="Text" wide>
          <input aria-label="Watermark text" data-testid="watermark-text" placeholder="DRAFT, CONFIDENTIAL, COPY…" value={doc.watermark?.text ?? ""} onChange={(e) => setDoc({ ...doc, watermark: e.target.value ? { ...(doc.watermark ?? {}), text: e.target.value } : undefined }, { coalesce: "wm" })} />
        </Field>
        {doc.watermark && (
          <div className="grid2">
            <Field label="Opacity">
              <Num label="Watermark opacity" min={0} step={0.05} value={doc.watermark.opacity ?? 0.18} onChange={(v) => setDoc({ ...doc, watermark: { ...doc.watermark, opacity: Math.min(1, v ?? 0.18) } }, { coalesce: "wm" })} />
            </Field>
            <Field label="Pages">
              <select aria-label="Watermark pages" value={doc.watermark.pages ?? "all"} onChange={(e) => setDoc({ ...doc, watermark: { ...doc.watermark, pages: e.target.value } })}>
                <option value="all">Every page</option>
                <option value="first">First page</option>
              </select>
            </Field>
          </div>
        )}
        <p className="muted small">Shown in Preview and exports (PDF, HTML).</p>
      </Section>
      <PageMasters />
      </>}
      {reportTab === "print" && <PrintProfilePanel />}
      {reportTab === "details" && <Section title="Locale & theme" open={false}>
        <Field label="Locale">
          <input aria-label="Locale" value={doc.locale ?? ""} placeholder="en-US" onChange={(e) => setDoc({ ...doc, locale: e.target.value || undefined }, { coalesce: "locale" })} />
        </Field>
        <Field label="Currency">
          <input aria-label="Currency" value={doc.theme?.currency ?? ""} placeholder="USD" onChange={(e) => setTheme({ currency: e.target.value || undefined })} />
        </Field>
        <Field label="Time zone">
          <input aria-label="Time zone" list="time-zones" value={doc.theme?.timezone ?? ""} placeholder="Server local time" onChange={(e) => setTheme({ timezone: e.target.value || undefined })} />
          <datalist id="time-zones">{TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
        </Field>
        <Field label="Body font">
          <input aria-label="Body font" value={doc.theme?.fonts?.body ?? ""} placeholder="Noto Sans" onChange={(e) => setTheme({ fonts: { ...(doc.theme?.fonts ?? {}), body: e.target.value || undefined } })} />
        </Field>
        <button className="btn" data-testid="open-theme" onClick={() => useStore.getState().set({ dialog: "theme" })}>Edit theme…</button>
      </Section>}
      </InspectorTabs>
    </>
  );
}

function MultiProps({ ids }: { ids: string[] }) {
  const { doc, engine, canvasView, zoom } = useStore();
  const setDoc = useStore((s) => s.setDoc);
  const [arrangeError, setArrangeError] = useState("");
  const btn = (label: string, fn: () => void, testId?: string, enabled = true, disabledHint = "Select unlocked elements in the same absolute layout with numeric geometry") => (
    <button className="btn" data-testid={testId} onClick={fn} disabled={!enabled} title={enabled ? label : disabledHint}>
      {label}
    </button>
  );
  const free = ops.canArrange(doc, ids);
  const textOnly = free && ids.every((id) => ["text", "richText", "field"].includes(ops.find(doc, id)?.comp.type ?? ""));
  const layout = canvasView === "structure" ? engine.structure ?? engine.paginated : engine.paginated;
  const first = layout?.pages[0];
  const rendered = new Map<string, ops.ArrangedSize>();
  const collect = (items: any[]) => {
    for (const item of items) {
      if (item.component.id && !rendered.has(item.component.id)) rendered.set(item.component.id, { width: item.box.width, height: item.box.height });
      collect(item.children ?? []);
    }
  };
  if (first) collect([...first.header, ...first.content, ...first.footer]);
  const hasTidySizes = free && ids.every((id) => rendered.has(id));
  const tidyCandidate = hasTidySizes ? ops.tidyUp(doc, ids, Object.fromEntries(rendered), 8) : doc;
  const canTidy = tidyCandidate !== doc;
  const alignBaseline = () => {
    const textNodes = [...document.querySelectorAll<HTMLElement>(".cn-text[data-cid]")];
    const offsets: Record<string, number> = {};
    for (const id of ids) {
      const node = textNodes.find((element) => element.dataset.cid === id);
      const probe = node?.querySelector<HTMLElement>(".text-baseline-probe");
      if (!node || !probe) {
        setArrangeError("Select text visible on the canvas to align baselines.");
        return;
      }
      offsets[id] = (probe.getBoundingClientRect().top - node.getBoundingClientRect().top) / (4 / 3 * zoom);
    }
    setArrangeError("");
    setDoc(ops.alignTextBaseline(doc, ids, offsets));
  };
  return (
    <>
      <div className="prop-head">
        <strong>{ids.length} elements selected</strong>
      </div>
      <Section title="Arrange">
        {!free && <p className="muted small">Select unlocked elements in the same absolute layout to arrange them.</p>}
        <p className="arrange-label">Align edges and centres</p>
        <div className="btn-grid">
          {(["left", "center", "right", "top", "middle", "bottom"] as const).map((m) => btn(`Align ${m}`, () => setDoc(ops.align(doc, ids, m)), `align-${m}`, ops.canArrange(doc, ids, m === "center" || m === "right" ? ["width"] : m === "middle" || m === "bottom" ? ["height"] : [])))}
          {btn("Text baseline", alignBaseline, "align-baseline", textOnly && ids.every((id) => rendered.has(id)), "Select visible text elements in one free-position layout")}
        </div>
        {arrangeError && <p className="muted small" role="status">{arrangeError}</p>}
        <p className="arrange-label">Equal spacing · keep the outer edges</p>
        <div className="btn-grid">
          {btn("Space horizontally", () => setDoc(ops.distribute(doc, ids, "horizontal")), "distribute-h", ids.length >= 3 && ops.canArrange(doc, ids, ["width"]))}
          {btn("Space vertically", () => setDoc(ops.distribute(doc, ids, "vertical")), "distribute-v", ids.length >= 3 && ops.canArrange(doc, ids, ["height"]))}
        </div>
        <p className="arrange-label">Match the first selected element</p>
        <div className="btn-grid">
          {btn("Same width", () => setDoc(ops.matchSize(doc, ids, "width")), "same-width", free && typeof ops.find(doc, ids[0]!)?.comp.width === "number")}
          {btn("Same height", () => setDoc(ops.matchSize(doc, ids, "height")), "same-height", free && typeof ops.find(doc, ids[0]!)?.comp.height === "number")}
          {btn("Same size", () => setDoc(ops.matchSize(doc, ids, "both")), "same-size", free && typeof ops.find(doc, ids[0]!)?.comp.width === "number" && typeof ops.find(doc, ids[0]!)?.comp.height === "number")}
        </div>
        <p className="arrange-label">Tidy into rows · 8 pt gap</p>
        <div className="btn-grid">
          {btn("Tidy up", () => setDoc(tidyCandidate), "tidy-up", canTidy, hasTidySizes ? "Tidy would overlap other elements" : "Select elements visible on the first page in one free-position layout")}
        </div>
        {hasTidySizes && !canTidy && <p className="muted small">Tidy would overlap another element. Select a clear group or move the surrounding content first.</p>}
      </Section>
      <Section title="Actions">
        <div className="btn-grid">
          {btn("Duplicate", () => useStore.getState().duplicateSelected())}
          {btn("Delete", () => useStore.getState().removeSelected())}
        </div>
      </Section>
    </>
  );
}

const CONTENT_TYPES = new Set(["text", "richText", "field", "table", "crosstab", "chart", "labelSheet", "qrcode", "barcode", "image", "group", "pageBreak", "line", "fragment", "subreport"]);

function ComponentProps({ id }: { id: string }) {
  const { doc } = useStore();
  const loc = ops.find(doc, id);
  const type = loc?.comp.type;
  const [tab, setTab] = useState<"content" | "style" | "layout" | "rules">(
    type === "rectangle" ? "style" : type && !CONTENT_TYPES.has(type) ? "layout" : "content"
  );
  if (!loc) return <PageProps />;
  const comp = loc.comp;
  const t = comp.type;
  const hasContent = CONTENT_TYPES.has(t);
  const textLike = ["text", "richText", "field"].includes(t);
  const hasStyle = textLike || ["rectangle", "container", "row", "column", "grid"].includes(t);
  const hasLayout = !["pageBreak", "line", "labelSheet"].includes(t);
  const hasRules = t !== "pageBreak";
  const tabs = [
    ...(hasContent ? [{ id: "content", label: "Content" }] : []),
    ...(hasStyle ? [{ id: "style", label: "Style" }] : []),
    ...(hasLayout ? [{ id: "layout", label: "Layout" }] : []),
    ...(hasRules ? [{ id: "rules", label: "Rules" }] : []),
  ] as { id: typeof tab; label: string }[];
  return (
    <>
      <div className="prop-head">
        <Icon name={t === "chart" ? `chart-${comp.chartType}` : t} />
        <input className="name-input" data-testid="component-name" aria-label="Element name" placeholder={ops.layerName({ ...comp, name: undefined })} value={comp.name ?? ""} onChange={(e) => useStore.getState().rename(comp.id, e.target.value)} />
        <span className="spacer" />
        <InspectorActions label="Element actions">
          <button data-testid="open-in-code" onClick={() => useStore.getState().openCode(comp.id)}>Open in code</button>
          <button onClick={() => useStore.getState().duplicateSelected()}>Duplicate element</button>
          <button className="danger" data-testid="delete-selected" onClick={() => useStore.getState().removeSelected()}>Delete element</button>
        </InspectorActions>
      </div>
      {t !== "pageBreak" && t !== "line" && t !== "labelSheet" && <QuickGeometry comp={comp} />}
      <InspectorTabs label="Element properties" tabs={tabs} active={tab} onChange={setTab} testIdPrefix="element-tab">
      {tab === "content" && textLike && <TextProps comp={comp} />}
      {tab === "content" && t === "table" && <TableProps comp={comp} />}
      {tab === "content" && t === "fragment" && <Section title="Library block"><FragmentProps comp={comp} /></Section>}
      {tab === "content" && t === "subreport" && <SubreportProps comp={comp} />}
      {tab === "content" && t === "chart" && <ChartProps comp={comp} />}
      {tab === "content" && t === "crosstab" && <CrosstabProps comp={comp} />}
      {tab === "content" && t === "labelSheet" && <LabelSheetProps comp={comp} />}
      {tab === "content" && (t === "qrcode" || t === "barcode") && <CodeProps comp={comp} />}
      {tab === "content" && t === "image" && <ImageProps comp={comp} />}
      {tab === "content" && (textLike || t === "image") && <LinkProps comp={comp} />}
      {tab === "content" && t === "pageBreak" && <p className="inspector-empty">Content after this element starts on a new page.</p>}
      {tab === "content" && t === "line" && <p className="inspector-empty">Drag the line on the canvas to place it.</p>}
      {tab === "layout" && hasLayout && <LayoutProps comp={comp} />}
      {tab === "style" && textLike && <Section title="Typography"><Typography comp={comp} /></Section>}
      {tab === "style" && hasStyle && (
        <Section title="Appearance" summary={comp.style?.color || comp.style?.background || comp.style?.border ? "Customized" : "Default"}>
          <Appearance comp={comp} />
        </Section>
      )}
      {tab === "content" && t === "group" && (
        <Section title="Grouping">
          <Field label="Group by (expression)">
            <FormulaInput value={comp.groupBy ?? ""} candidates={candidatesFor(doc, useStore.getState().sample, comp.id, comp.dataset)} onChange={(v) => useStore.getState().patch(comp.id, { groupBy: v })} />
          </Field>
          <Field label="In the report viewer">
            <select aria-label="Drill-down" value={comp.drillDown ?? ""} onChange={(e) => useStore.getState().patch(comp.id, { drillDown: e.target.value || undefined })}>
              <option value="">Always show rows</option>
              <option value="expanded">Expandable, open at first</option>
              <option value="collapsed">Expandable, closed at first</option>
            </select>
          </Field>
        </Section>
      )}
      {tab === "rules" && hasRules && (
        <Section title="Conditions" summary={comp.visibleWhen || comp.styleWhen?.length ? "Active" : "None"}>
          <div className="inspector-subtitle">Visibility</div>
          <ConditionBuilder comp={comp} />
          {t !== "table" && <><div className="inspector-subtitle">Appearance</div><StyleRulesEditor comp={comp} property="styleWhen" testId="component-style-rules" /></>}
          {t === "table" && <p className="field-hint">Edit row appearance rules in Table Designer.</p>}
        </Section>
      )}
      {tab === "rules" && t !== "line" && t !== "labelSheet" && <PaginationProps comp={comp} />}
      {tab === "rules" && <Advanced comp={comp} />}
      </InspectorTabs>
    </>
  );
}

export function Properties() {
  const selection = useStore((s) => s.selection);
  const selectedBand = useStore((s) => s.selectedBand);
  return (
    <aside className="panel right" aria-label="Properties" data-testid="properties">
      <div className="compact-properties-head">Properties<button className="compact-close" type="button" aria-label="Close properties" onClick={() => useStore.getState().set({ rightOpen: false })}>×</button></div>
      {selection.length === 0 && selectedBand !== null && <BandProps key={selectedBand} index={selectedBand} />}
      {selection.length === 0 && selectedBand === null && <PageProps />}
      {selection.length === 1 && <ComponentProps key={selection[0]} id={selection[0]!} />}
      {selection.length > 1 && <MultiProps ids={selection} />}
    </aside>
  );
}
