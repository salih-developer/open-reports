import { describe, expect, it } from "vitest";
import { borderSides, clearFormatting, common, formattingOf, hasSide, pasteFormatting, restyleBorder, styleEach, toggleBorderSide, type Pen } from "../../src/lib/ribbon";

const pen: Pen = { width: 1, style: "solid", color: "#000000" };
const thick = { width: 2, style: "solid", color: "#000000" };

describe("ribbon borders", () => {
  it("draws one side, then normalizes four equal sides to a uniform border", () => {
    let border = toggleBorderSide(undefined, "bottom", pen);
    expect(border).toEqual({ bottom: pen });
    border = toggleBorderSide(border, "top", pen);
    border = toggleBorderSide(border, "left", pen);
    border = toggleBorderSide(border, "right", pen);
    expect(border).toEqual(pen);
  });

  it("removes a side from a uniform border and drops the border when no side is left", () => {
    const border = toggleBorderSide(thick, "top", pen);
    expect(border).toEqual({ right: thick, bottom: thick, left: thick });
    expect(hasSide(border, "top")).toBe(false);
    expect(hasSide(border, "left")).toBe(true);
    expect(toggleBorderSide({ left: thick }, "left", pen)).toBeUndefined();
  });

  it("restyles only the sides that are drawn", () => {
    expect(restyleBorder({ bottom: pen }, { width: 3 })).toEqual({ bottom: { ...pen, width: 3 } });
    expect(restyleBorder(pen, { color: "#ff0000" })).toEqual({ ...pen, color: "#ff0000" });
    expect(restyleBorder(undefined, { width: 3 })).toBeUndefined();
    expect(Object.keys(borderSides(pen))).toEqual(["top", "right", "bottom", "left"]);
  });
});

describe("ribbon formatting", () => {
  const style = { fontSize: 14, fontWeight: "bold", color: "#c00000", background: "#ffff00", padding: 4, wrap: false };

  it("clears formatting but keeps spacing and wrapping, which change layout", () => {
    expect(clearFormatting(style)).toEqual({ padding: 4, wrap: false });
    expect(clearFormatting({ fontSize: 9 })).toBeUndefined();
    // Components without text keep their (meaningless) text settings and lose only colours and borders.
    expect(clearFormatting({ background: "#ffff00", border: pen, padding: 2 }, false)).toEqual({ padding: 2 });
  });

  it("pastes copied formatting over the target's own, keeping the target's layout", () => {
    const copied = formattingOf(style);
    expect(copied).toEqual({ fontSize: 14, fontWeight: "bold", color: "#c00000", background: "#ffff00" });
    expect(pasteFormatting({ italic: true, padding: 8 }, copied)).toEqual({ padding: 8, ...copied });
    expect(pasteFormatting({ padding: 8 }, copied, false)).toEqual({ padding: 8, color: "#c00000", background: "#ffff00" });
  });

  it("reports a shared value, or undefined for a mixed selection", () => {
    expect(common([10, 10])).toBe(10);
    expect(common([10, 12])).toBeUndefined();
    expect(common([])).toBeUndefined();
  });

  it("styles only components of the given types, and leaves the document alone for empty patches", () => {
    const doc = { sections: [{ type: "detail", children: [{ id: "t", type: "text" }, { id: "img", type: "image" }] }] };
    const next = styleEach(doc, ["t", "img"], ["text"], () => ({ italic: true }));
    expect(next.sections[0].children[0].style).toEqual({ italic: true });
    expect(next.sections[0].children[1].style).toBeUndefined();
    expect(styleEach(doc, ["t"], ["text"], () => ({}))).toBe(doc);
  });
});
