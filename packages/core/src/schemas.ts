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
const optionalProvenanceShape = {
  provenance: provenanceSchema.shape.provenance.optional(),
  confidence: provenanceSchema.shape.confidence,
  source: provenanceSchema.shape.source,
};

export const bboxSchema = z.tuple([
  z.number(),
  z.number(),
  z.number().nonnegative(),
  z.number().nonnegative(),
]);

export const referenceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), selector: z.string().min(1) }),
  z.object({ type: z.literal('hover'), selector: z.string().min(1) }),
  z.object({ type: z.literal('focus'), selector: z.string().min(1) }),
  z.object({ type: z.literal('fill'), selector: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal('press'), selector: z.string().min(1), value: z.string().min(1) }),
  z.object({ type: z.literal('selectOption'), selector: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal('check'), selector: z.string().min(1) }),
  z.object({ type: z.literal('uncheck'), selector: z.string().min(1) }),
]);
export type ReferenceAction = z.infer<typeof referenceActionSchema>;

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
  targetUrl: z.string().url().optional(),
  actions: z.array(referenceActionSchema).default([]),
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

export const fontSchema = z
  .object({
    id: z.string().optional(),
    family: z.string().min(1),
    path: z.string().optional(),
    weight: z.union([z.number(), z.string()]).optional(),
    style: z.string().optional(),
    format: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

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
  ...optionalProvenanceShape,
});

export const rawMeasurementSchema = z
  .object({
    bbox: bboxSchema.optional(),
    textRects: z.array(bboxSchema).optional(),
    computed: z.record(z.string(), z.unknown()).default({}),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const semanticInterpretationSchema = z
  .object({
    role: z.string().optional(),
    label: z.string().optional(),
    component: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const sceneNodeSchema = z.object({
  id: z.string(),
  kind: z
    .enum(['element', 'text', 'image', 'svg', 'canvas', 'region', 'unknown'])
    .default('unknown'),
  bbox: bboxSchema,
  parentId: z.string().optional(),
  tagName: z.string().optional(),
  role: z.string().optional(),
  measurement: rawMeasurementSchema.optional(),
  interpretation: semanticInterpretationSchema.optional(),
  text: z.string().optional(),
  assetId: z.string().optional(),
  paint: z.record(z.string(), z.unknown()).default({}),
  geometryArtifact: z.string().optional(),
  ...optionalProvenanceShape,
});

export const layoutRelationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  relation: z.enum(['align-x', 'align-y', 'inside', 'overlap', 'gap', 'edge', 'stack']),
  targetId: z.string(),
  value: z.number().optional(),
  ...optionalProvenanceShape,
});

export const colorSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    value: z.string().optional(),
    color: z.string().optional(),
    type: z.enum(['solid', 'gradient']).optional(),
    stops: z.array(z.record(z.string(), z.unknown())).optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const gradientSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum(['linear', 'radial', 'conic']),
    angle: z.number().optional(),
    center: z.tuple([z.number(), z.number()]).optional(),
    radius: z.number().positive().optional(),
    stops: z
      .array(
        z.object({
          offset: z.number().min(0).max(1),
          color: z.string(),
          opacity: z.number().min(0).max(1).optional(),
        }),
      )
      .min(2),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const effectSchema = z
  .object({
    id: z.string().optional(),
    targetId: z.string().optional(),
    kind: z.enum(['shadow', 'border', 'radius', 'filter', 'backdrop-filter', 'other']),
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    blur: z.number().nonnegative().optional(),
    spread: z.number().optional(),
    color: z.string().optional(),
    opacity: z.number().min(0).max(1).optional(),
    radius: z.number().nonnegative().optional(),
    value: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const geometryArtifactSchema = z
  .object({
    id: z.string().optional(),
    artifact: z.string().optional(),
    path: z.string().optional(),
    bbox: bboxSchema.optional(),
    viewBox: z.string().optional(),
    geometry: z.string().optional(),
    paint: z.record(z.string(), z.unknown()).optional(),
    fitError: z.number().nonnegative().optional(),
    browserValidationLoss: z.number().nonnegative().optional(),
    warnings: z.array(z.string()).optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const interactionSchema = z
  .object({
    id: z.string().optional(),
    state: z.string().optional(),
    trigger: z.string().optional(),
    target: z.string().optional(),
    selector: z.string().optional(),
    actions: z.array(referenceActionSchema).optional(),
    unknown: z.boolean().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const responsiveMappingSchema = z
  .object({
    familyId: z.string().min(1),
    referenceIds: z.array(z.string().min(1)).min(2),
    nodeMappings: z
      .array(
        z.object({
          identity: z.string(),
          referenceId: z.string(),
          nodeId: z.string().optional(),
          visible: z.boolean().optional(),
          ...optionalProvenanceShape,
        }),
      )
      .default([]),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const cropSchema = z
  .object({
    id: z.string().optional(),
    referenceId: z.string().min(1),
    bbox: bboxSchema,
    purpose: z.string().optional(),
    path: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const uncertaintySchema = z
  .object({
    id: z.string().optional(),
    message: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const chartDataSchema = z
  .object({
    id: z.string().optional(),
    reconstructionGoal: z.enum(['visual', 'semantic']).default('visual'),
    axes: z.array(z.record(z.string(), z.unknown())).default([]),
    series: z.array(z.record(z.string(), z.unknown())).default([]),
    data: z.array(z.unknown()).optional(),
    interpolation: z.string().optional(),
    ...optionalProvenanceShape,
  })
  .passthrough();

export const referenceBundleSchema = z.object({
  schemaVersion: z.literal('1').default('1'),
  name: z.string().optional(),
  screenshots: z.array(referenceScreenshotSchema).min(1),
  assets: z.array(assetSchema).default([]),
  fonts: z.array(fontSchema).default([]),
  textBlocks: z.array(textBlockSchema).default([]),
  scene: z.array(sceneNodeSchema).default([]),
  layout: z.array(layoutRelationSchema).default([]),
  typography: z.array(textBlockSchema.passthrough()).default([]),
  colors: z.array(colorSchema).default([]),
  gradients: z.array(gradientSchema).default([]),
  effects: z.array(effectSchema).default([]),
  geometry: z.array(geometryArtifactSchema).default([]),
  interactions: z.array(interactionSchema).default([]),
  responsiveMappings: z.array(responsiveMappingSchema).default([]),
  chartData: z.array(chartDataSchema).default([]),
  crops: z.array(cropSchema).default([]),
  uncertainties: z.array(uncertaintySchema).default([]),
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
