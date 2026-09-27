import { z } from 'zod';

export const schemaVersion = '1' as const;

export const viewportSchema = z.object({
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  deviceScaleFactor: z.number().positive().max(4).default(1),
});
export type Viewport = z.infer<typeof viewportSchema>;

export const provenanceSchema = z.object({
  provenance: z.enum(['exact', 'provided', 'measured', 'derived', 'estimated', 'unknown']),
  confidence: z.number().min(0).max(1).optional(),
  source: z.string().optional(),
});

export const bboxSchema = z.tuple([
  z.number(),
  z.number(),
  z.number().nonnegative(),
  z.number().nonnegative(),
]);

export const referenceScreenshotSchema = z.object({
  referenceId: z.string().min(1),
  path: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  viewport: viewportSchema,
  scrollX: z.number().default(0),
  scrollY: z.number().default(0),
  captureType: z.enum(['viewport', 'full-page']).default('viewport'),
  state: z.string().optional(),
  sourceType: z
    .enum(['screenshot', 'rectified-photo', 'figma-export', 'unknown'])
    .default('screenshot'),
  rectification: z.record(z.string(), z.unknown()).optional(),
  runtime: z.record(z.string(), z.unknown()).optional(),
  familyId: z.string().optional(),
});
export type ReferenceScreenshot = z.infer<typeof referenceScreenshotSchema> & {
  sha256: string;
};

export const assetSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['image', 'svg', 'font', 'data', 'other']).default('other'),
  mimeType: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  sha256: z.string().optional(),
  provenance: provenanceSchema.optional(),
});

export const textBlockSchema = z.object({
  id: z.string(),
  bbox: bboxSchema,
  text: z.string(),
  family: z.string().optional(),
  size: z.number().positive().optional(),
  weight: z.union([z.number(), z.string()]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
  alignment: z.enum(['left', 'center', 'right', 'justify']).optional(),
  color: z.string().optional(),
  ...provenanceSchema.shape,
});

export const sceneNodeSchema = z.object({
  id: z.string(),
  kind: z
    .enum(['element', 'text', 'image', 'svg', 'canvas', 'region', 'unknown'])
    .default('unknown'),
  bbox: bboxSchema,
  parentId: z.string().optional(),
  tagName: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  assetId: z.string().optional(),
  paint: z.record(z.string(), z.unknown()).default({}),
  geometryArtifact: z.string().optional(),
  ...provenanceSchema.shape,
});

export const layoutRelationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  relation: z.enum(['align-x', 'align-y', 'inside', 'overlap', 'gap', 'edge', 'stack']),
  targetId: z.string(),
  value: z.number().optional(),
  ...provenanceSchema.shape,
});

export const referenceBundleSchema = z.object({
  schemaVersion: z.literal('1').default('1'),
  name: z.string().optional(),
  screenshots: z.array(referenceScreenshotSchema).min(1),
  assets: z.array(assetSchema).default([]),
  fonts: z.array(z.record(z.string(), z.unknown())).default([]),
  textBlocks: z.array(textBlockSchema).default([]),
  scene: z.array(sceneNodeSchema).default([]),
  layout: z.array(layoutRelationSchema).default([]),
  typography: z.array(z.record(z.string(), z.unknown())).default([]),
  colors: z.array(z.record(z.string(), z.unknown())).default([]),
  geometry: z.array(z.record(z.string(), z.unknown())).default([]),
  interactions: z.array(z.record(z.string(), z.unknown())).default([]),
  responsiveMappings: z.array(z.record(z.string(), z.unknown())).default([]),
  chartData: z.array(z.record(z.string(), z.unknown())).default([]),
  crops: z.array(z.record(z.string(), z.unknown())).default([]),
  uncertainties: z.array(z.record(z.string(), z.unknown())).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ReferenceBundle = z.infer<typeof referenceBundleSchema>;

export const browserSettingsSchema = z.object({
  locale: z.string().default('en-US'),
  timezoneId: z.string().default('UTC'),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).default('light'),
  fixedTime: z.string().datetime().default('2024-01-01T00:00:00.000Z'),
  randomSeed: z.number().int().default(1),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('networkidle'),
  readySelector: z.string().optional(),
  readinessPredicate: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  disableAnimations: z.boolean().default(true),
  maskSelectors: z.array(z.string()).default([]),
});
export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
