import { z } from "zod";
import { pageConfigSchema } from "./page.js";
import { themeSchema } from "./theme.js";
import { groupDefinitionSchema, sectionSchema } from "./sections.js";
import { componentSchema } from "./components.js";
import { datasetDefinitionSchema } from "./datasets.js";
import { parameterDefinitionSchema } from "./parameters.js";
import { variableDefinitionSchema } from "./variables.js";

export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;

export const exportsConfigSchema = z.object({
  pdf: z.record(z.string(), z.unknown()).optional(),
  html: z.record(z.string(), z.unknown()).optional(),
  xlsx: z
    .object({
      sheetName: z.string().optional(),
    })
    .passthrough()
    .optional(),
  csv: z
    .object({
      target: z.string().optional(),
      delimiter: z.string().optional(),
      newline: z.enum(["\n", "\r\n"]).optional(),
      includeHeaders: z.boolean().optional(),
    })
    .optional(),
});
export type ExportsConfig = z.infer<typeof exportsConfigSchema>;

export const printCalibrationSchema = z.object({
  /** Multiply horizontal/vertical ZPL element geometry after measuring a raw test print. */
  scaleX: z.number().min(0.9).max(1.1).default(1),
  scaleY: z.number().min(0.9).max(1.1).default(1),
  /** Shift ZPL content on the media, in millimetres. */
  offsetXmm: z.number().min(-25).max(25).default(0),
  offsetYmm: z.number().min(-25).max(25).default(0),
});
export type PrintCalibration = z.infer<typeof printCalibrationSchema>;

export const printProfileSchema = z.object({
  name: z.string().optional(),
  dpi: z.number().positive().optional(),
  printerType: z.enum(["document", "label", "receipt", "card", "wristband"]).optional(),
  language: z.enum(["pdf", "zpl", "escpos"]).optional(),
  /** Printable margin the printer cannot reach, in mm. */
  safeMargin: z.number().nonnegative().optional(),
  /** Clockwise turn applied when printing, for media fed in a different direction from the design (e.g. wristbands). */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  calibration: printCalibrationSchema.optional(),
});
export type PrintProfile = z.infer<typeof printProfileSchema>;

/** Diagonal text stamped on every page (e.g. DRAFT, CONFIDENTIAL, COPY). */
export const watermarkSchema = z.object({
  text: z.string().min(1),
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  fontSize: z.number().positive().optional(),
  /** Degrees, counter-clockwise. Default 45. */
  angle: z.number().optional(),
  pages: z.enum(["all", "first"]).optional(),
});
export type Watermark = z.infer<typeof watermarkSchema>;

/** A persistent alignment guide drawn on the design surface (page coordinates, points). */
export const guideSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  axis: z.enum(["x", "y"]),
  /** Distance from the page's left (x) or top (y) edge, in points. */
  pos: z.number(),
  locked: z.boolean().optional(),
});
export type Guide = z.infer<typeof guideSchema>;

export const fragmentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  /** `children` is a snapshot of this library block version. Linked blocks render the library's latest version
   * (the snapshot is the fallback when the library is unavailable); pinned blocks always render their own version. */
  source: z.object({ block: z.string().min(1), version: z.number().int().positive(), mode: z.enum(["linked", "pinned"]) }).strict().optional(),
  children: z.array(componentSchema).default([]),
});

/** Durable review record for source imports. Original expressions remain in the source file. */
export const migrationRecordSchema = z.object({
  sourceFormat: z.enum(["jrxml", "frx"]),
  sourceName: z.string().optional(),
  /** JRXML element style, or "fastreport" for a FastReport .frx source. */
  format: z.enum(["v6-style", "v7-style", "fastreport"]),
  summary: z.object({ converted: z.number().int().nonnegative(), "needs-review": z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }),
  issues: z.array(z.object({
    status: z.enum(["needs-review", "unsupported"]),
    feature: z.string(),
    source: z.string(),
    line: z.number().int().nonnegative(),
    message: z.string(),
    targetId: z.string().optional(),
  })),
});

export const reportDefinitionSchema = z.object({
  schemaVersion: z.enum(SUPPORTED_SCHEMA_VERSIONS),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  locale: z.string().optional(),
  parameters: z.array(parameterDefinitionSchema).default([]),
  datasets: z.array(datasetDefinitionSchema).default([]),
  variables: z.array(variableDefinitionSchema).default([]),
  page: pageConfigSchema.default({}),
  theme: themeSchema.optional(),
  /** Grouping levels (outermost first) referenced by groupHeader/groupFooter bands. */
  groups: z.array(groupDefinitionSchema).default([]),
  sections: z.array(sectionSchema).default([]),
  fragments: z.array(fragmentDefinitionSchema).default([]),
  /** Child report definitions attached by the designer. Render APIs may also receive these separately. */
  subreports: z.record(z.string(), z.unknown()).optional(),
  migration: migrationRecordSchema.optional(),
  print: printProfileSchema.optional(),
  watermark: watermarkSchema.optional(),
  guides: z.array(guideSchema).default([]),
  exports: exportsConfigSchema.optional(),
});

export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;
/** Convenience input type (pre-defaults) for authoring reports by hand or via SDK. */
export type ReportDefinitionInput = z.input<typeof reportDefinitionSchema>;
