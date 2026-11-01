import type { Capabilities } from "../engine";
import { api } from "./api";

/** The font families offered in the inspector and the ribbon (the bundled Noto faces). */
export const FONT_FAMILIES = ["Noto Sans", "Noto Sans Devanagari", "Noto Sans Telugu", "Noto Sans Kannada", "Noto Sans Tamil", "Noto Sans Arabic"];

const loaded = new Map<string, Promise<void>>();
const faceStyle: Record<string, FontFaceDescriptors> = {
  regular: { weight: "400", style: "normal" },
  bold: { weight: "700", style: "normal" },
  italic: { weight: "400", style: "italic" },
  boldItalic: { weight: "700", style: "italic" },
};

/** Match the PDF registry's chosen family, then let the browser pick script faces per glyph. */
export function canvasFontStack(caps: Capabilities | undefined, requested?: string): string {
  const installed = requested && caps?.fonts.find((family) => family.toLowerCase() === requested.toLowerCase());
  const primary = installed ?? caps?.defaultFont ?? "Helvetica";
  const families = [primary, ...Object.values(caps?.scriptFonts ?? {}), "Helvetica", "Arial"];
  return [...new Set(families)].map((family) => JSON.stringify(family)).join(", ") + ", sans-serif";
}

/** Register only the font faces the PDF renderer says it can embed. */
export async function loadCanvasFonts(caps: Capabilities): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const tasks = Object.entries(caps.fontFaces ?? {}).flatMap(([family, variants]) => variants.filter((v) => faceStyle[v]).map((variant) => {
    const key = `${family}:${variant}`;
    let task = loaded.get(key);
    if (!task) {
      task = api.fontFace(family, variant).then(async (data) => {
        const face = new FontFace(family, data, faceStyle[variant]);
        await face.load();
        document.fonts.add(face);
      });
      loaded.set(key, task);
    }
    return task;
  }));
  await Promise.allSettled(tasks);
}
