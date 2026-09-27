import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import {
  browserSettingsSchema,
  referenceBundleSchema,
  schemaVersion,
  viewportSchema,
  type BrowserSettings,
  type ReferenceBundle,
  type ReferenceAction,
  type ReferenceScreenshot,
  type Viewport,
} from './schemas.js';

export {
  browserSettingsSchema,
  referenceBundleSchema,
  referenceActionSchema,
  schemaVersion,
  viewportSchema,
  assetSchema,
  bboxSchema,
  colorSchema,
  chartDataSchema,
  cropSchema,
  effectSchema,
  fontSchema,
  gradientSchema,
  geometryArtifactSchema,
  interactionSchema,
  layoutRelationSchema,
  provenanceSchema,
  referenceScreenshotSchema,
  rawMeasurementSchema,
  responsiveMappingSchema,
  sceneNodeSchema,
  semanticInterpretationSchema,
  textBlockSchema,
  uncertaintySchema,
} from './schemas.js';
export type { ReferenceAction, ReferenceBundle, ReferenceScreenshot, Viewport } from './schemas.js';

export interface ProjectManifest {
  schemaVersion: typeof schemaVersion;
  projectId: string;
  name: string;
  createdAt: string;
  referencePath: string;
  referenceSha256: string;
  references: ReferenceScreenshot[];
  referenceBundle: ReferenceBundle;
  referenceBundlePath?: string;
  browserSettings: BrowserSettings;
  targetConfig?: {
    repositoryRoot?: string;
    route?: string;
    framework?: string;
    devCommand?: string;
    buildCommand?: string;
    designTokens?: Record<string, string>;
  };
  targetUrl: string;
  viewport: Viewport;
}

export interface DomNode {
  id: string;
  selector: string;
  tagName: string;
  bbox: [number, number, number, number];
  display: string;
  position: string;
  zIndex: string;
  opacity: number;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  margin: string;
  padding: string;
  gap: string;
  flexDirection: string;
  background: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
  transform: string;
  paintOrder: number;
  parentId?: string;
  textRects: Array<[number, number, number, number]>;
  svg?: {
    tagName: string;
    viewBox: string | null;
    pathData?: string;
    fill: string;
    stroke: string;
  };
  image?: {
    src: string;
    currentSrc: string;
    naturalWidth: number;
    naturalHeight: number;
    objectFit: string;
    objectPosition: string;
  };
  video?: {
    currentTime: number;
    duration: number;
    videoWidth: number;
    videoHeight: number;
    paused: boolean;
    readyState: number;
  };
  text: string;
}

export interface DiffRegion {
  id: string;
  bbox: [number, number, number, number];
  changedPixels: number;
  severity: number;
  metrics: { color: number; edge: number; structure: number };
  classification:
    | 'position'
    | 'dimensions'
    | 'spacing'
    | 'typography'
    | 'paint'
    | 'border'
    | 'border-radius'
    | 'shadow'
    | 'wrong-asset'
    | 'geometry'
    | 'unknown';
  deltas?: { dx: number; dy: number; dw: number; dh: number; provenance: 'measured' | 'unknown' };
  candidates: Array<{
    nodeId: string;
    selector: string;
    overlap: number;
    paintOrder: number;
    evidence: string[];
  }>;
}

export interface CompareResult {
  schemaVersion: typeof schemaVersion;
  runId: string;
  projectId: string;
  referenceId: string;
  loss: {
    changedPixelRatio: number;
    meanAbsoluteError: number;
    edgeLoss: number;
    structuralLoss: number;
    totalLoss: number;
  };
  screenshotPath: string;
  diffPath: string;
  regions: DiffRegion[];
  nodes: DomNode[];
  canvasDrawCalls: CanvasDrawCall[];
  runtime: { browser: 'chromium'; version: string };
  readiness: {
    waitUntil: BrowserSettings['waitUntil'];
    fontsReady: true;
    animationsDisabled: boolean;
  };
  warnings: string[];
}

export interface CanvasDrawCall {
  drawId: string;
  canvasId: string;
  selector: string;
  method: string;
  api?: 'canvas2d' | 'webgl' | 'webgl2';
  primitive?: string;
  vertexCount?: number;
  instanceCount?: number;
  commands: Array<{ method: string; args: unknown[] }>;
  bbox: [number, number, number, number];
  transform: number[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  lineCap: string;
  lineJoin: string;
  sourceRef?: { file?: string; line?: number; column?: number };
}

const root = process.env.GLAMOUR_HOME ?? process.cwd();
const storeRoot = path.resolve(root, '.glamour');
const projectFile = (id: string) => path.join(storeRoot, 'projects', id, 'project.json');
const projectArtifact = (id: string, name: string) => path.join(storeRoot, 'projects', id, name);
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function ensureStore(): Promise<void> {
  await mkdir(path.join(storeRoot, 'projects'), { recursive: true });
}

export async function createProject(input: {
  name: string;
  referencePath?: string;
  referenceBundlePath?: string;
  targetUrl: string;
  viewport?: Viewport;
  browserSettings?: Partial<BrowserSettings>;
  targetConfig?: ProjectManifest['targetConfig'];
}): Promise<ProjectManifest> {
  if (!input.referencePath && !input.referenceBundlePath) {
    throw new Error('Provide a referencePath or referenceBundlePath.');
  }
  let bundle: ReferenceBundle;
  let bundleRoot: string | undefined;
  let savedBundlePath: string | undefined;
  if (input.referenceBundlePath) {
    const providedPath = path.resolve(input.referenceBundlePath);
    const info = await import('node:fs/promises').then(({ stat }) => stat(providedPath));
    bundleRoot = info.isDirectory() ? providedPath : path.dirname(providedPath);
    const manifestPath = info.isDirectory()
      ? path.join(providedPath, 'manifest.json')
      : providedPath;
    const manifestContent = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
    bundle = referenceBundleSchema.parse(manifestContent);
    bundle = {
      ...bundle,
      screenshots: bundle.screenshots.map((reference) => ({
        ...reference,
        path: path.resolve(bundleRoot!, reference.path),
      })),
      assets: bundle.assets.map((asset) => ({
        ...asset,
        path: path.resolve(bundleRoot!, asset.path),
      })),
      fonts: bundle.fonts.map((font) => ({
        ...font,
        ...(typeof font.path === 'string' ? { path: path.resolve(bundleRoot!, font.path) } : {}),
      })),
      geometry: bundle.geometry.map((item) => ({
        ...item,
        ...(typeof item.path === 'string' ? { path: path.resolve(bundleRoot!, item.path) } : {}),
      })),
      crops: bundle.crops.map((item) => ({
        ...item,
        ...(typeof item.path === 'string' ? { path: path.resolve(bundleRoot!, item.path) } : {}),
        ...(typeof item.imagePath === 'string'
          ? { imagePath: path.resolve(bundleRoot!, item.imagePath) }
          : {}),
      })),
      chartData: bundle.chartData.map((item) => ({
        ...item,
        ...(typeof item.path === 'string' ? { path: path.resolve(bundleRoot!, item.path) } : {}),
      })),
    };
    savedBundlePath = path.resolve(manifestPath);
  } else {
    const referencePath = path.resolve(input.referencePath!);
    const viewport = viewportSchema.parse(input.viewport);
    bundle = referenceBundleSchema.parse({
      name: input.name,
      screenshots: [{ referenceId: 'default', path: referencePath, viewport }],
    });
  }
  if (input.viewport && !input.referenceBundlePath) {
    bundle.screenshots[0]!.viewport = viewportSchema.parse(input.viewport);
  }
  const refs: ReferenceScreenshot[] = await Promise.all(
    bundle.screenshots.map(async (reference) => {
      const bytes = await readFile(reference.path).catch(() => {
        throw new Error(`Reference image not found: ${reference.path}`);
      });
      const hash = sha256(bytes);
      if (reference.sha256 && reference.sha256.toLowerCase() !== hash)
        throw new Error(`Reference hash does not match screenshot ${reference.referenceId}.`);
      return { ...reference, sha256: hash };
    }),
  );
  bundle.assets = await Promise.all(
    bundle.assets.map(async (asset) => {
      const bytes = await readFile(asset.path).catch(() => {
        throw new Error(`Reference asset not found: ${asset.path}`);
      });
      const hash = sha256(bytes);
      if (asset.sha256 && asset.sha256.toLowerCase() !== hash)
        throw new Error(`Reference hash does not match asset ${asset.id}.`);
      return { ...asset, sha256: hash };
    }),
  );
  const referencePath = refs[0]!.path;
  const referenceSha256 = refs[0]!.sha256;
  const viewport = refs[0]!.viewport;
  if (refs.some((reference) => reference.captureType === 'viewport')) {
    for (const reference of refs.filter((item) => item.captureType === 'viewport')) {
      const image = decodePng(await normalizeRaster(await readFile(reference.path)));
      const expectedWidth = Math.round(
        reference.viewport.width * reference.viewport.deviceScaleFactor,
      );
      const expectedHeight = Math.round(
        reference.viewport.height * reference.viewport.deviceScaleFactor,
      );
      if (image.width !== expectedWidth || image.height !== expectedHeight) {
        throw new Error(
          `Screenshot ${reference.referenceId} is ${image.width}x${image.height}px, expected ${expectedWidth}x${expectedHeight}px from viewport × DPR.`,
        );
      }
    }
  }
  const id = randomUUID();
  const dir = projectArtifact(id, '');
  await mkdir(dir, { recursive: true });
  const browserSettings = browserSettingsSchema.parse(input.browserSettings ?? {});
  const manifest: ProjectManifest = {
    schemaVersion,
    projectId: id,
    name: input.name,
    createdAt: new Date().toISOString(),
    referencePath,
    referenceSha256,
    references: refs,
    referenceBundle: bundle,
    ...(savedBundlePath ? { referenceBundlePath: savedBundlePath } : {}),
    browserSettings,
    ...(input.targetConfig ? { targetConfig: input.targetConfig } : {}),
    targetUrl: input.targetUrl,
    viewport,
  };
  await writeFile(projectFile(id), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    projectArtifact(id, 'reference-ir.json'),
    `${JSON.stringify({ schemaVersion, projectId: id, bundle }, null, 2)}\n`,
  );
  return manifest;
}

export async function getProject(projectId: string): Promise<ProjectManifest> {
  const manifest = JSON.parse(
    await readFile(projectFile(projectId), 'utf8'),
  ) as Partial<ProjectManifest>;
  if (manifest.schemaVersion !== schemaVersion)
    throw new Error('Unsupported project schema version.');
  if (manifest.references && manifest.referenceBundle) {
    return {
      ...(manifest as ProjectManifest),
      browserSettings: browserSettingsSchema.parse(manifest.browserSettings ?? {}),
    };
  }
  // Upgrade schemaVersion 1 manifests created before Reference Bundle support.
  const viewport = viewportSchema.parse(manifest.viewport);
  const reference = {
    referenceId: 'default',
    path: manifest.referencePath ?? '',
    viewport,
    sha256: manifest.referenceSha256 ?? '',
  };
  const referenceBundle = referenceBundleSchema.parse({
    name: manifest.name,
    screenshots: [reference],
  });
  const upgradedReference: ReferenceScreenshot = {
    ...referenceBundle.screenshots[0]!,
    sha256: reference.sha256,
  };
  return {
    ...(manifest as ProjectManifest),
    referencePath: reference.path,
    referenceSha256: reference.sha256,
    viewport,
    references: [upgradedReference],
    referenceBundle,
    browserSettings: browserSettingsSchema.parse(manifest.browserSettings ?? {}),
  };
}

function resolveViewportReference(
  manifest: ProjectManifest,
  referenceId?: string,
): ReferenceScreenshot {
  const reference = referenceId
    ? manifest.references.find((item) => item.referenceId === referenceId)
    : manifest.references.find((item) => item.captureType === 'viewport');
  if (!reference)
    throw new Error(`Unknown or unavailable viewport reference ${referenceId ?? '<primary>'}.`);
  if (reference.captureType !== 'viewport')
    throw new Error(
      `Reference ${reference.referenceId} is a full-page structural capture; compare a viewport reference instead.`,
    );
  return reference;
}

export async function getReferenceIR(
  projectId: string,
  referenceId: string,
): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  reference: ReferenceScreenshot;
  bundle: ReferenceBundle;
}> {
  const manifest = await getProject(projectId);
  const reference = manifest.references.find((item) => item.referenceId === referenceId);
  if (!reference) throw new Error(`Unknown reference ${referenceId} for project ${projectId}.`);
  return { schemaVersion, projectId, reference, bundle: manifest.referenceBundle };
}

export async function analyzeReference(projectId: string): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  summary: {
    screenshotCount: number;
    stateCount: number;
    viewportCount: number;
    assetCount: number;
    fontCount: number;
    textBlockCount: number;
    sceneNodeCount: number;
    layoutRelationCount: number;
    geometryArtifactCount: number;
    interactionCount: number;
    chartDataCount: number;
    gradientCount: number;
    effectCount: number;
    complexRegions: number;
  };
  palette: Array<{ color: string; share: number; provenance: 'measured'; confidence: number }>;
  highConfidenceFacts: Array<{
    category: string;
    id: string;
    value: unknown;
    provenance: string;
    confidence?: number;
  }>;
  uncertainties: Array<{ id: string; message: string; provenance: string }>;
  fullPageCaptures: Array<{
    referenceId: string;
    viewport: Viewport;
    scrollOffset: { x: number; y: number };
    bitmap: { width: number; height: number };
    contentSizeCss: { width: number; height: number };
    provenance: 'measured';
  }>;
}> {
  const manifest = await getProject(projectId);
  const bundle = manifest.referenceBundle;
  const colors = new Map<string, number>();
  for (const reference of manifest.references) {
    const image = decodePng(await normalizeRaster(await readFile(reference.path)));
    const stride = Math.max(1, Math.floor((image.width * image.height) / 80_000));
    for (let pixel = 0; pixel < image.width * image.height; pixel += stride) {
      const index = pixel * 4;
      const red = Math.round((image.data[index] ?? 0) / 32) * 32;
      const green = Math.round((image.data[index + 1] ?? 0) / 32) * 32;
      const blue = Math.round((image.data[index + 2] ?? 0) / 32) * 32;
      const color = `#${[red, green, blue].map((channel) => Math.min(255, channel).toString(16).padStart(2, '0')).join('')}`;
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
  }
  const totalSamples = [...colors.values()].reduce((sum, count) => sum + count, 0);
  const palette = [...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([color, count]) => ({
      color,
      share: count / Math.max(1, totalSamples),
      provenance: 'measured' as const,
      confidence: Math.min(0.99, (count / Math.max(1, totalSamples)) * 2 + 0.35),
    }));
  const highConfidenceFacts = [
    ...Object.entries(manifest.targetConfig?.designTokens ?? {}).map(([name, value]) => ({
      category: 'design-token',
      id: name,
      value,
      provenance: 'exact',
      confidence: 1,
    })),
    ...bundle.textBlocks
      .filter((item) => item.provenance === 'provided' || item.provenance === 'exact')
      .map((item) => ({
        category: 'text',
        id: item.id,
        value: item,
        provenance: item.provenance!,
        ...(item.confidence === undefined ? {} : { confidence: item.confidence }),
      })),
    ...bundle.assets
      .filter(
        (asset) =>
          asset.provenance?.provenance === 'provided' || asset.provenance?.provenance === 'exact',
      )
      .map((asset) => ({
        category: 'asset',
        id: asset.id,
        value: asset,
        provenance: asset.provenance!.provenance,
        ...(asset.provenance!.confidence === undefined
          ? {}
          : { confidence: asset.provenance!.confidence }),
      })),
    ...bundle.scene
      .filter((node) => node.provenance === 'provided' || node.provenance === 'exact')
      .map((node) => ({
        category: 'scene-node',
        id: node.id,
        value: node,
        provenance: node.provenance!,
        ...(node.confidence === undefined ? {} : { confidence: node.confidence }),
      })),
    ...bundle.scene.flatMap((node) =>
      node.measurement?.bbox &&
      (node.measurement.provenance === 'exact' ||
        node.measurement.provenance === 'provided' ||
        (node.measurement.provenance === 'measured' && (node.measurement.confidence ?? 0) >= 0.8))
        ? [
            {
              category: 'measurement',
              id: node.id,
              value: node.measurement,
              provenance: node.measurement.provenance!,
              ...(node.measurement.confidence === undefined
                ? {}
                : { confidence: node.measurement.confidence }),
            },
          ]
        : [],
    ),
    ...bundle.scene.flatMap((node) =>
      node.interpretation &&
      (node.interpretation.provenance === 'provided' || node.interpretation.provenance === 'exact')
        ? [
            {
              category: 'interpretation',
              id: node.id,
              value: node.interpretation,
              provenance: node.interpretation.provenance!,
              ...(node.interpretation.confidence === undefined
                ? {}
                : { confidence: node.interpretation.confidence }),
            },
          ]
        : [],
    ),
  ];
  const uncertainties = [
    ...bundle.uncertainties.map((item, index) => ({
      id: `uncertainty-${index + 1}`,
      message: String(item.message ?? item.description ?? 'Bundle uncertainty'),
      provenance: String(item.provenance ?? 'unknown'),
    })),
    ...manifest.references
      .filter((item) => !item.familyId)
      .map((item) => ({
        id: `responsive-${item.referenceId}`,
        message: `No responsive family mapping is supplied for reference ${item.referenceId}.`,
        provenance: 'unknown',
      })),
  ];
  const fullPageCaptures = await Promise.all(
    manifest.references
      .filter((reference) => reference.captureType === 'full-page')
      .map(async (reference) => {
        const image = decodePng(await normalizeRaster(await readFile(reference.path)));
        return {
          referenceId: reference.referenceId,
          viewport: reference.viewport,
          scrollOffset: { x: reference.scrollX, y: reference.scrollY },
          bitmap: { width: image.width, height: image.height },
          contentSizeCss: {
            width: image.width / reference.viewport.deviceScaleFactor,
            height: image.height / reference.viewport.deviceScaleFactor,
          },
          provenance: 'measured' as const,
        };
      }),
  );
  return {
    schemaVersion,
    projectId,
    summary: {
      screenshotCount: manifest.references.length,
      stateCount: manifest.references.filter((item) => item.state).length,
      viewportCount: new Set(
        manifest.references.map(
          (item) =>
            `${item.viewport.width}x${item.viewport.height}@${item.viewport.deviceScaleFactor}`,
        ),
      ).size,
      assetCount: bundle.assets.length,
      fontCount: bundle.fonts.length,
      textBlockCount: bundle.textBlocks.length,
      sceneNodeCount: bundle.scene.length,
      layoutRelationCount: bundle.layout.length,
      geometryArtifactCount: bundle.geometry.length,
      interactionCount: bundle.interactions.length,
      chartDataCount: bundle.chartData.length,
      gradientCount: bundle.gradients.length,
      effectCount: bundle.effects.length,
      complexRegions: bundle.crops.length,
    },
    palette,
    highConfidenceFacts: highConfidenceFacts.slice(0, 30),
    uncertainties: uncertainties.slice(0, 30),
    fullPageCaptures,
  };
}

export async function compareProjectAll(projectId: string): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  results: Array<
    Pick<
      CompareResult,
      'runId' | 'referenceId' | 'loss' | 'regions' | 'screenshotPath' | 'diffPath' | 'warnings'
    >
  >;
  skippedReferences: Array<{ referenceId: string; reason: string }>;
}> {
  const manifest = await getProject(projectId);
  const results = [];
  const skippedReferences = manifest.references
    .filter((reference) => reference.captureType !== 'viewport')
    .map((reference) => ({
      referenceId: reference.referenceId,
      reason: 'Full-page capture is retained as structural input; compare viewport references.',
    }));
  for (const reference of manifest.references.filter((item) => item.captureType === 'viewport')) {
    const result = await compareProject(projectId, reference.referenceId);
    results.push({
      runId: result.runId,
      referenceId: result.referenceId,
      loss: result.loss,
      regions: result.regions,
      screenshotPath: result.screenshotPath,
      diffPath: result.diffPath,
      warnings: result.warnings,
    });
  }
  if (!results.length)
    throw new Error('The Reference Bundle has no viewport screenshots to compare.');
  return { schemaVersion, projectId, results, skippedReferences };
}

async function applyReferenceActions(
  page: Page,
  actions: ReferenceAction[],
  timeoutMs: number,
): Promise<void> {
  for (const action of actions) {
    const locator = page.locator(action.selector).first();
    const timeout = timeoutMs;
    switch (action.type) {
      case 'click':
        await locator.click({ timeout });
        break;
      case 'hover':
        await locator.hover({ timeout });
        break;
      case 'focus':
        await locator.focus({ timeout });
        break;
      case 'fill':
        await locator.fill(action.value, { timeout });
        break;
      case 'press':
        await locator.press(action.value, { timeout });
        break;
      case 'selectOption':
        await locator.selectOption(action.value, { timeout });
        break;
      case 'check':
        await locator.check({ timeout });
        break;
      case 'uncheck':
        await locator.uncheck({ timeout });
        break;
    }
  }
}

async function captureTarget(
  manifest: ProjectManifest,
  viewport: Viewport = manifest.viewport,
  scroll: { x: number; y: number } = { x: 0, y: 0 },
  reference?: ReferenceScreenshot,
): Promise<{
  png: Buffer;
  nodes: DomNode[];
  canvasDrawCalls: CanvasDrawCall[];
  chromiumVersion: string;
  unloadedImages: string[];
  videoWarnings: string[];
  pageErrors: string[];
}> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      locale: manifest.browserSettings.locale,
      timezoneId: manifest.browserSettings.timezoneId,
      colorScheme: manifest.browserSettings.colorScheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript((settings) => {
      const NativeDate = Date;
      const fixedEpoch = new NativeDate(settings.fixedTime).valueOf();
      const DeterministicDate = new Proxy(NativeDate, {
        construct(target, args) {
          return Reflect.construct(target, args.length ? args : [fixedEpoch]);
        },
        get(target, property) {
          return property === 'now' ? () => fixedEpoch : Reflect.get(target, property);
        },
      });
      Object.defineProperty(window, 'Date', { value: DeterministicDate });
      let randomState = settings.randomSeed >>> 0;
      Math.random = () => {
        randomState = (randomState * 1664525 + 1013904223) >>> 0;
        return randomState / 0x100000000;
      };
      const installMotionRules = () => {
        if (!settings.disableAnimations || !document.documentElement) return;
        const style = document.createElement('style');
        style.dataset.glamour = 'determinism';
        style.textContent =
          '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
        document.documentElement.append(style);
      };
      document.addEventListener('DOMContentLoaded', installMotionRules, { once: true });
      // Install the Canvas trace shim before app scripts execute.
      const host = window as Window & { __glamourCanvasDrawCalls?: CanvasDrawCall[] };
      const calls: CanvasDrawCall[] = [];
      host.__glamourCanvasDrawCalls = calls;
      const canvasIds = new WeakMap<HTMLCanvasElement, string>();
      let canvasSequence = 0;
      const commands = new WeakMap<
        CanvasRenderingContext2D,
        Array<{ method: string; args: unknown[] }>
      >();
      const selector = (canvas: HTMLCanvasElement): string => {
        if (canvas.id) return `#${CSS.escape(canvas.id)}`;
        const parent = canvas.parentElement;
        const siblings = parent ? [...parent.querySelectorAll('canvas')] : [];
        return siblings.length > 1
          ? `canvas:nth-of-type(${siblings.indexOf(canvas) + 1})`
          : 'canvas';
      };
      const boxFor = (
        ctx: CanvasRenderingContext2D,
        method: string,
        args: unknown[],
      ): [number, number, number, number] => {
        const canvas = ctx.canvas;
        const matrix = ctx.getTransform();
        const transformPoint = (x: number, y: number) => ({
          x: matrix.a * x + matrix.c * y + matrix.e,
          y: matrix.b * x + matrix.d * y + matrix.f,
        });
        let x = 0,
          y = 0,
          width = canvas.width,
          height = canvas.height;
        let transformed = false;
        if (['fillRect', 'strokeRect', 'clearRect'].includes(method) && args.length >= 4) {
          [x, y, width, height] = args.slice(0, 4).map(Number) as [number, number, number, number];
        } else if (method === 'drawImage' && args.length >= 3) {
          if (args.length >= 9) {
            x = Number(args[5]);
            y = Number(args[6]);
            width = Number(args[7]);
            height = Number(args[8]);
          } else if (args.length >= 5) {
            x = Number(args[1]);
            y = Number(args[2]);
            width = Number(args[3]);
            height = Number(args[4]);
          } else {
            x = Number(args[1]);
            y = Number(args[2]);
            width = Number((args[0] as CanvasImageSource & { width?: number }).width ?? 0);
            height = Number((args[0] as CanvasImageSource & { height?: number }).height ?? 0);
          }
        } else if ((method === 'fillText' || method === 'strokeText') && args.length >= 3) {
          x = Number(args[1]);
          y = Number(args[2]);
          width = ctx.measureText(String(args[0])).width;
          height = parseFloat(ctx.font) || 16;
          if (args.length > 3 && args[3] !== undefined) width = Math.min(width, Number(args[3]));
          y -= height;
        } else {
          const pathCommands = commands.get(ctx) ?? [];
          const points: Array<{ x: number; y: number }> = [];
          for (const command of pathCommands) {
            const a = command.args;
            if (['moveTo', 'lineTo'].includes(command.method)) {
              points.push(transformPoint(Number(a[0]), Number(a[1])));
            } else if (command.method === 'quadraticCurveTo') {
              points.push(
                transformPoint(Number(a[0]), Number(a[1])),
                transformPoint(Number(a[2]), Number(a[3])),
              );
            } else if (command.method === 'bezierCurveTo') {
              for (let i = 0; i < 6; i += 2)
                points.push(transformPoint(Number(a[i]), Number(a[i + 1])));
            } else if (command.method === 'rect') {
              const p = transformPoint(Number(a[0]), Number(a[1]));
              points.push(
                p,
                transformPoint(Number(a[0]) + Number(a[2]), Number(a[1]) + Number(a[3])),
              );
            } else if (command.method === 'arc' || command.method === 'ellipse') {
              const radius = Number(a[2] ?? a[3] ?? 0);
              const p = transformPoint(Number(a[0]), Number(a[1]));
              points.push(
                { x: p.x - radius, y: p.y - radius },
                { x: p.x + radius, y: p.y + radius },
              );
            } else if (command.method === 'roundRect') {
              const p = transformPoint(Number(a[0]), Number(a[1]));
              points.push(
                p,
                transformPoint(Number(a[0]) + Number(a[2]), Number(a[1]) + Number(a[3])),
              );
            }
          }
          if (points.length) {
            const xs = points.map((p) => p.x),
              ys = points.map((p) => p.y);
            x = Math.min(...xs);
            y = Math.min(...ys);
            width = Math.max(...xs) - x;
            height = Math.max(...ys) - y;
            transformed = true;
            if (method === 'stroke') {
              x -= ctx.lineWidth / 2;
              y -= ctx.lineWidth / 2;
              width += ctx.lineWidth;
              height += ctx.lineWidth;
            }
          }
        }
        if (!transformed) {
          const points = [
            transformPoint(x, y),
            transformPoint(x + width, y),
            transformPoint(x, y + height),
            transformPoint(x + width, y + height),
          ];
          const xs = points.map((point) => point.x);
          const ys = points.map((point) => point.y);
          x = Math.min(...xs);
          y = Math.min(...ys);
          width = Math.max(...xs) - x;
          height = Math.max(...ys) - y;
        }
        const rect = canvas.getBoundingClientRect();
        return [
          rect.x + (x * rect.width) / canvas.width,
          rect.y + (y * rect.height) / canvas.height,
          (width * rect.width) / canvas.width,
          (height * rect.height) / canvas.height,
        ];
      };
      const pathMethods = new Set([
        'beginPath',
        'moveTo',
        'lineTo',
        'bezierCurveTo',
        'quadraticCurveTo',
        'arc',
        'ellipse',
        'rect',
        'roundRect',
        'closePath',
      ]);
      const paintMethods = new Set([
        'stroke',
        'fill',
        'drawImage',
        'fillText',
        'strokeText',
        'clearRect',
        'fillRect',
        'strokeRect',
      ]);
      const serializeArgument = (value: unknown): unknown => {
        if (value === null || typeof value !== 'object') return value;
        const item = value as {
          constructor?: { name?: string };
          currentSrc?: string;
          src?: string;
          width?: number;
          height?: number;
          tagName?: string;
        };
        return {
          type: item.constructor?.name ?? 'object',
          ...(item.tagName ? { tagName: item.tagName.toLowerCase() } : {}),
          ...(item.currentSrc || item.src ? { src: item.currentSrc || item.src } : {}),
          ...(typeof item.width === 'number' ? { width: item.width } : {}),
          ...(typeof item.height === 'number' ? { height: item.height } : {}),
        };
      };
      for (const method of [
        ...pathMethods,
        ...paintMethods,
        'save',
        'restore',
        'translate',
        'rotate',
        'scale',
        'transform',
        'setTransform',
        'clip',
      ]) {
        const prototype = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
        const original = prototype[method];
        if (typeof original !== 'function') continue;
        prototype[method] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
          let canvasId = canvasIds.get(this.canvas);
          if (!canvasId) {
            canvasId = `canvas-${++canvasSequence}`;
            canvasIds.set(this.canvas, canvasId);
          }
          if (method === 'beginPath') commands.set(this, []);
          if (pathMethods.has(method) && method !== 'beginPath') {
            const list = commands.get(this) ?? [];
            list.push({ method, args });
            commands.set(this, list);
          }
          if (paintMethods.has(method)) {
            const priorCommands = [...(commands.get(this) ?? [])].map((command) => ({
              method: command.method,
              args: command.args.map(serializeArgument),
            }));
            if (method.endsWith('Rect') || method === 'clearRect')
              priorCommands.push({ method, args: args.map(serializeArgument) });
            const box = boxFor(this, method, args);
            const transform = this.getTransform();
            calls.push({
              drawId: `draw-${calls.length + 1}`,
              canvasId,
              selector: selector(this.canvas),
              method,
              api: 'canvas2d',
              commands: priorCommands,
              bbox: box,
              transform: [
                transform.a,
                transform.b,
                transform.c,
                transform.d,
                transform.e,
                transform.f,
              ],
              fillStyle: String(this.fillStyle),
              strokeStyle: String(this.strokeStyle),
              lineWidth: this.lineWidth,
              globalAlpha: this.globalAlpha,
              lineCap: this.lineCap,
              lineJoin: this.lineJoin,
            });
          }
          return (original as (...args: unknown[]) => unknown).apply(this, args);
        };
      }
      const webglDrawMethods = [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'drawElementsInstanced',
      ];
      const webglPrimitiveNames = new Map<number, string>([
        [0x0000, 'points'],
        [0x0001, 'lines'],
        [0x0002, 'line-loop'],
        [0x0003, 'line-strip'],
        [0x0004, 'triangles'],
        [0x0005, 'triangle-strip'],
        [0x0006, 'triangle-fan'],
      ]);
      const webglViewports = new WeakMap<object, [number, number, number, number]>();
      const installWebGlTracing = (
        prototype: Record<string, unknown> | undefined,
        api: 'webgl' | 'webgl2',
      ) => {
        if (!prototype || installedWebGlPrototypes.has(prototype)) return;
        installedWebGlPrototypes.add(prototype);
        for (const method of webglDrawMethods) {
          const original = prototype[method];
          if (typeof original !== 'function') continue;
          prototype[method] = function (this: WebGLRenderingContext, ...args: number[]) {
            const canvas = this.canvas;
            if (!(canvas instanceof HTMLCanvasElement))
              return (original as (...values: number[]) => unknown).apply(this, args);
            let canvasId = canvasIds.get(canvas);
            if (!canvasId) {
              canvasId = `canvas-${++canvasSequence}`;
              canvasIds.set(canvas, canvasId);
            }
            const rect = canvas.getBoundingClientRect();
            const sx = rect.width / canvas.width;
            const sy = rect.height / canvas.height;
            const viewport = webglViewports.get(this) ?? [0, 0, canvas.width, canvas.height];
            const [x, y, width, height] = viewport;
            const vertexCount =
              method === 'drawArrays' || method === 'drawArraysInstanced'
                ? (args[2] ?? 0)
                : (args[1] ?? 0);
            const instanceCount =
              method === 'drawArraysInstanced'
                ? (args[3] ?? 1)
                : method === 'drawElementsInstanced'
                  ? (args[4] ?? 1)
                  : 1;
            calls.push({
              drawId: `draw-${calls.length + 1}`,
              canvasId,
              selector: selector(canvas),
              method,
              api,
              primitive: webglPrimitiveNames.get(args[0] ?? -1) ?? `mode-${args[0]}`,
              vertexCount,
              instanceCount,
              commands: [{ method, args: [...args] }],
              bbox: [
                rect.x + x * sx,
                rect.y + (canvas.height - y - height) * sy,
                width * sx,
                height * sy,
              ],
              transform: [1, 0, 0, 1, 0, 0],
              fillStyle: '',
              strokeStyle: '',
              lineWidth: 1,
              globalAlpha: 1,
              lineCap: 'butt',
              lineJoin: 'miter',
            });
            return (original as (...values: number[]) => unknown).apply(this, args);
          };
        }
        const nativeViewport = prototype.viewport;
        if (typeof nativeViewport === 'function')
          prototype.viewport = function (this: WebGLRenderingContext, ...args: number[]) {
            webglViewports.set(this, [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0]);
            return (nativeViewport as (...values: number[]) => unknown).apply(this, args);
          };
      };
      const installedWebGlPrototypes = new WeakSet<object>();
      const nativeGetContext = HTMLCanvasElement.prototype.getContext as (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) => RenderingContext | null;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        const context = nativeGetContext.call(this, type, ...args);
        if (context && (type === 'webgl' || type === 'experimental-webgl')) {
          const webgl = context as WebGLRenderingContext;
          webglViewports.set(webgl, [0, 0, webgl.drawingBufferWidth, webgl.drawingBufferHeight]);
          installWebGlTracing(Object.getPrototypeOf(webgl) as Record<string, unknown>, 'webgl');
        }
        if (context && type === 'webgl2') {
          const webgl = context as WebGL2RenderingContext;
          webglViewports.set(webgl, [0, 0, webgl.drawingBufferWidth, webgl.drawingBufferHeight]);
          installWebGlTracing(Object.getPrototypeOf(webgl) as Record<string, unknown>, 'webgl2');
        }
        return context;
      } as typeof HTMLCanvasElement.prototype.getContext;
    }, manifest.browserSettings);
    await page.goto(reference?.targetUrl ?? manifest.targetUrl, {
      waitUntil: manifest.browserSettings.waitUntil,
      timeout: manifest.browserSettings.timeoutMs,
    });
    if (reference)
      await applyReferenceActions(page, reference.actions, manifest.browserSettings.timeoutMs);
    if (scroll.x || scroll.y) await page.evaluate(({ x, y }) => window.scrollTo(x, y), scroll);
    if (manifest.browserSettings.readySelector) {
      await page
        .locator(manifest.browserSettings.readySelector)
        .waitFor({ state: 'visible', timeout: manifest.browserSettings.timeoutMs });
    }
    if (manifest.browserSettings.readinessPredicate) {
      const predicate = manifest.browserSettings.readinessPredicate;
      await page.waitForFunction((source) => Boolean((0, eval)(source)), predicate, {
        timeout: manifest.browserSettings.timeoutMs,
      });
    }
    for (const selector of manifest.browserSettings.maskSelectors) {
      await page.locator(selector).evaluateAll((elements) =>
        elements.forEach((element) => {
          (element as HTMLElement).style.visibility = 'hidden';
        }),
      );
    }
    await page.evaluate(async () => await document.fonts.ready);
    const unloadedImages = await page.evaluate(async () => {
      const images = [...document.images];
      const failures = await Promise.all(
        images.map(async (image) => {
          try {
            await image.decode();
            return null;
          } catch {
            return image.currentSrc || image.src || '<image without source>';
          }
        }),
      );
      return failures.filter((source): source is string => source !== null);
    });
    const videoWarnings = await stabilizeVideos(
      page,
      reference?.videoTimeSeconds,
      manifest.browserSettings.timeoutMs,
    );
    const nodes = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('body *')].slice(0, 5000);
      const ids = new Map<Element, string>();
      const selectorFor = (element: Element): string => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.body && parts.length < 5) {
          const tag = current.tagName.toLowerCase();
          const parentElement: Element | null = current.parentElement;
          const sameTag = parentElement
            ? [...parentElement.children].filter(
                (child: Element) => child.tagName === current?.tagName,
              )
            : [];
          const suffix = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(current) + 1})` : '';
          parts.unshift(`${tag}${suffix}`);
          current = parentElement;
        }
        return parts.join(' > ') || 'body';
      };
      const stableId = (element: Element): string => {
        const identity = `${element.tagName.toLowerCase()}|${selectorFor(element)}`;
        return `node-${encodeURIComponent(identity)}`;
      };
      elements.forEach((element) => {
        const id = stableId(element);
        ids.set(element, id);
        element.setAttribute('data-glamour-runtime-id', id);
      });
      return elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRects = [...range.getClientRects()].map(
          (item) => [item.x, item.y, item.width, item.height] as [number, number, number, number],
        );
        const svgElement = element instanceof SVGElement ? element : null;
        const pathElement =
          svgElement?.querySelector('path') ??
          (svgElement?.tagName.toLowerCase() === 'path' ? svgElement : null);
        return {
          id: ids.get(element)!,
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          bbox: [rect.x, rect.y, rect.width, rect.height] as [number, number, number, number],
          display: style.display,
          position: style.position,
          zIndex: style.zIndex,
          opacity: Number(style.opacity),
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          margin: style.margin,
          padding: style.padding,
          gap: style.gap,
          flexDirection: style.flexDirection,
          background: style.background,
          border: style.border,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          transform: style.transform,
          paintOrder: index,
          ...(element.parentElement && ids.has(element.parentElement)
            ? { parentId: ids.get(element.parentElement)! }
            : {}),
          textRects,
          ...(svgElement
            ? {
                svg: {
                  tagName: svgElement.tagName.toLowerCase(),
                  viewBox: svgElement.getAttribute('viewBox'),
                  ...(pathElement?.getAttribute('d')
                    ? { pathData: pathElement.getAttribute('d')! }
                    : {}),
                  fill: style.fill,
                  stroke: style.stroke,
                },
              }
            : {}),
          ...(element instanceof HTMLImageElement
            ? {
                image: {
                  src: element.getAttribute('src') ?? '',
                  currentSrc: element.currentSrc,
                  naturalWidth: element.naturalWidth,
                  naturalHeight: element.naturalHeight,
                  objectFit: style.objectFit,
                  objectPosition: style.objectPosition,
                },
              }
            : {}),
          ...(element instanceof HTMLVideoElement
            ? {
                video: {
                  currentTime: element.currentTime,
                  duration: element.duration,
                  videoWidth: element.videoWidth,
                  videoHeight: element.videoHeight,
                  paused: element.paused,
                  readyState: element.readyState,
                },
              }
            : {}),
          text: (element.textContent ?? '').trim().slice(0, 160),
        };
      });
    });
    const png = await page.screenshot({ type: 'png', animations: 'disabled' });
    const canvasDrawCalls = await page.evaluate(
      () =>
        (window as Window & { __glamourCanvasDrawCalls?: CanvasDrawCall[] })
          .__glamourCanvasDrawCalls ?? [],
    );
    await context.close();
    return {
      png,
      nodes,
      canvasDrawCalls,
      chromiumVersion: browser.version(),
      unloadedImages,
      videoWarnings,
      pageErrors,
    };
  } finally {
    await browser?.close();
  }
}

function decodePng(bytes: Buffer): { data: Uint8Array; width: number; height: number } {
  const image = PNG.sync.read(bytes);
  return { data: image.data, width: image.width, height: image.height };
}

async function normalizeRaster(bytes: Buffer): Promise<Buffer> {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return bytes;
  const image = sharp(bytes, { limitInputPixels: 268_435_456 });
  const metadata = await image.metadata();
  if (metadata.format !== 'webp')
    throw new Error(
      `Unsupported reference format ${metadata.format ?? 'unknown'}; use PNG or WebP.`,
    );
  return image.png().toBuffer();
}

function comparePixels(
  referenceBytes: Buffer,
  targetBytes: Buffer,
): {
  changedMask: Uint8Array;
  width: number;
  height: number;
  changedPixelRatio: number;
  meanAbsoluteError: number;
  edgeLoss: number;
  structuralLoss: number;
  totalLoss: number;
  colorDelta: Float32Array;
  edgeDelta: Float32Array;
  structureDelta: Float32Array;
  referenceData: Uint8Array;
} {
  const reference = decodePng(referenceBytes);
  const target = decodePng(targetBytes);
  if (reference.width !== target.width || reference.height !== target.height) {
    throw new Error(
      `Image dimensions differ: reference ${reference.width}x${reference.height}, target ${target.width}x${target.height}.`,
    );
  }
  const pixels = reference.width * reference.height;
  const changedMask = new Uint8Array(pixels);
  const referenceGray = new Float32Array(pixels);
  const targetGray = new Float32Array(pixels);
  const colorDelta = new Float32Array(pixels);
  let changed = 0;
  let absoluteError = 0;
  for (let p = 0; p < pixels; p += 1) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta += Math.abs(
        (reference.data[p * 4 + channel] ?? 0) - (target.data[p * 4 + channel] ?? 0),
      );
    }
    delta /= 3;
    absoluteError += delta;
    colorDelta[p] = delta / 255;
    referenceGray[p] =
      ((reference.data[p * 4] ?? 0) * 0.299 +
        (reference.data[p * 4 + 1] ?? 0) * 0.587 +
        (reference.data[p * 4 + 2] ?? 0) * 0.114) /
      255;
    targetGray[p] =
      ((target.data[p * 4] ?? 0) * 0.299 +
        (target.data[p * 4 + 1] ?? 0) * 0.587 +
        (target.data[p * 4 + 2] ?? 0) * 0.114) /
      255;
  }
  const sobel = (gray: Float32Array, x: number, y: number): number => {
    const at = (dx: number, dy: number) => gray[(y + dy) * reference.width + x + dx] ?? 0;
    const gx = -at(-1, -1) + at(1, -1) - 2 * at(-1, 0) + 2 * at(1, 0) - at(-1, 1) + at(1, 1);
    const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
    return Math.min(1, Math.hypot(gx, gy) / 4);
  };
  let edgeTotal = 0;
  const edgeDelta = new Float32Array(pixels);
  for (let y = 1; y < reference.height - 1; y += 1) {
    for (let x = 1; x < reference.width - 1; x += 1) {
      const index = y * reference.width + x;
      const difference = Math.abs(sobel(referenceGray, x, y) - sobel(targetGray, x, y));
      edgeDelta[index] = difference;
      edgeTotal += difference;
    }
  }
  let structureTotal = 0;
  const structureDelta = new Float32Array(pixels);
  const blockSize = 4;
  for (let by = 0; by < reference.height; by += blockSize) {
    for (let bx = 0; bx < reference.width; bx += blockSize) {
      let refMean = 0,
        targetMean = 0,
        count = 0;
      for (let y = by; y < Math.min(by + blockSize, reference.height); y += 1) {
        for (let x = bx; x < Math.min(bx + blockSize, reference.width); x += 1) {
          const index = y * reference.width + x;
          refMean += referenceGray[index] ?? 0;
          targetMean += targetGray[index] ?? 0;
          count += 1;
        }
      }
      const blockDelta = count ? Math.abs(refMean - targetMean) / count : 0;
      structureTotal += blockDelta * count;
      for (let y = by; y < Math.min(by + blockSize, reference.height); y += 1) {
        for (let x = bx; x < Math.min(bx + blockSize, reference.width); x += 1) {
          structureDelta[y * reference.width + x] = blockDelta;
        }
      }
    }
  }
  for (let p = 0; p < pixels; p += 1) {
    if (colorDelta[p]! > 18 / 255 || edgeDelta[p]! > 0.12 || structureDelta[p]! > 0.08) {
      changedMask[p] = 1;
      changed += 1;
    }
  }
  const meanAbsoluteError = absoluteError / pixels / 255;
  const edgeLoss = edgeTotal / pixels;
  const structuralLoss = structureTotal / pixels;
  return {
    changedMask,
    width: reference.width,
    height: reference.height,
    changedPixelRatio: changed / pixels,
    meanAbsoluteError,
    edgeLoss,
    structuralLoss,
    totalLoss: meanAbsoluteError * 0.55 + edgeLoss * 0.25 + structuralLoss * 0.2,
    colorDelta,
    edgeDelta,
    structureDelta,
    referenceData: reference.data,
  };
}

function referenceSolidBox(
  referenceData: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  node: DomNode,
  deviceScaleFactor: number,
): [number, number, number, number] | undefined {
  const color = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
    node.backgroundColor,
  );
  if (!color || (color[4] !== undefined && Number(color[4]) < 0.98)) return undefined;
  const expected = color.slice(1, 4).map(Number);
  const [nodeX, nodeY, nodeWidth, nodeHeight] = node.bbox;
  if (nodeWidth < 3 || nodeHeight < 3) return undefined;
  const padding =
    Math.max(8, Math.min(64, Math.max(nodeWidth, nodeHeight) * 0.3)) * deviceScaleFactor;
  const left = Math.max(0, Math.floor(nodeX * deviceScaleFactor - padding));
  const top = Math.max(0, Math.floor(nodeY * deviceScaleFactor - padding));
  const right = Math.min(imageWidth, Math.ceil((nodeX + nodeWidth) * deviceScaleFactor + padding));
  const bottom = Math.min(
    imageHeight,
    Math.ceil((nodeY + nodeHeight) * deviceScaleFactor + padding),
  );
  const localWidth = right - left;
  const localHeight = bottom - top;
  if (localWidth <= 0 || localHeight <= 0) return undefined;
  const visited = new Uint8Array(localWidth * localHeight);
  const matches = (localIndex: number): boolean => {
    const x = (localIndex % localWidth) + left;
    const y = Math.floor(localIndex / localWidth) + top;
    const pixel = (y * imageWidth + x) * 4;
    return (
      Math.abs((referenceData[pixel] ?? 0) - expected[0]!) <= 8 &&
      Math.abs((referenceData[pixel + 1] ?? 0) - expected[1]!) <= 8 &&
      Math.abs((referenceData[pixel + 2] ?? 0) - expected[2]!) <= 8
    );
  };
  const nodeLeft = nodeX * deviceScaleFactor;
  const nodeTop = nodeY * deviceScaleFactor;
  const nodeRight = (nodeX + nodeWidth) * deviceScaleFactor;
  const nodeBottom = (nodeY + nodeHeight) * deviceScaleFactor;
  let best: { bbox: [number, number, number, number]; score: number } | undefined;
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || !matches(start)) continue;
    const queue = [start];
    visited[start] = 1;
    let minX = localWidth;
    let minY = localHeight;
    let maxX = 0;
    let maxY = 0;
    let componentPixels = 0;
    let overlapPixels = 0;
    let touchesEdge = false;
    while (queue.length) {
      const index = queue.pop()!;
      const x = index % localWidth;
      const y = Math.floor(index / localWidth);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      componentPixels += 1;
      const absoluteX = x + left;
      const absoluteY = y + top;
      if (
        absoluteX >= nodeLeft &&
        absoluteX < nodeRight &&
        absoluteY >= nodeTop &&
        absoluteY < nodeBottom
      )
        overlapPixels += 1;
      if (x === 0 || y === 0 || x === localWidth - 1 || y === localHeight - 1) touchesEdge = true;
      for (const next of [index - 1, index + 1, index - localWidth, index + localWidth]) {
        if (next < 0 || next >= visited.length || visited[next]) continue;
        if (Math.abs((next % localWidth) - x) + Math.abs(Math.floor(next / localWidth) - y) !== 1)
          continue;
        if (!matches(next)) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (touchesEdge || componentPixels < 9 || overlapPixels < 9) continue;
    const score =
      overlapPixels /
      Math.max(1, Math.min(componentPixels, nodeWidth * nodeHeight * deviceScaleFactor ** 2));
    if (!best || score > best.score) {
      best = {
        bbox: [
          (minX + left) / deviceScaleFactor,
          (minY + top) / deviceScaleFactor,
          (maxX - minX + 1) / deviceScaleFactor,
          (maxY - minY + 1) / deviceScaleFactor,
        ],
        score,
      };
    }
  }
  return best && best.score >= 0.08 ? best.bbox : undefined;
}

function buildRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  nodes: DomNode[],
  metrics: {
    color: number;
    edge: number;
    structure: number;
    colorDelta: Float32Array;
    edgeDelta: Float32Array;
    structureDelta: Float32Array;
    referenceData: Uint8Array;
  },
  deviceScaleFactor = 1,
): DiffRegion[] {
  const seen = new Uint8Array(mask.length);
  const components: Array<{ bbox: [number, number, number, number]; pixels: number[] }> = [];
  const regions: DiffRegion[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0,
      changedPixels = 0;
    const componentPixels: number[] = [];
    while (stack.length) {
      const index = stack.pop();
      if (index === undefined) continue;
      const x = index % width,
        y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      changedPixels += 1;
      componentPixels.push(index);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (changedPixels < 4) continue;
    components.push({
      bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
      pixels: componentPixels,
    });
  }
  const mergeGap = Math.max(2, Math.round(6 * deviceScaleFactor));
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      const a = components[i]!,
        b = components[j]!;
      const [ax, ay, aw, ah] = a.bbox,
        [bx, by, bw, bh] = b.bbox;
      const dx = Math.max(0, Math.max(ax, bx) - Math.min(ax + aw, bx + bw));
      const dy = Math.max(0, Math.max(ay, by) - Math.min(ay + ah, by + bh));
      if (Math.hypot(dx, dy) > mergeGap) continue;
      a.bbox = [
        Math.min(ax, bx),
        Math.min(ay, by),
        Math.max(ax + aw, bx + bw) - Math.min(ax, bx),
        Math.max(ay + ah, by + bh) - Math.min(ay, by),
      ];
      a.pixels.push(...b.pixels);
      components.splice(j, 1);
      j -= 1;
    }
  }
  for (const component of components) {
    const bbox = component.bbox;
    const local = { color: 0, edge: 0, structure: 0 };
    for (const pixel of component.pixels) {
      local.color += metrics.colorDelta[pixel] ?? 0;
      local.edge += metrics.edgeDelta[pixel] ?? 0;
      local.structure += metrics.structureDelta[pixel] ?? 0;
    }
    const divisor = Math.max(1, component.pixels.length);
    local.color /= divisor;
    local.edge /= divisor;
    local.structure /= divisor;
    const bboxCss: [number, number, number, number] = bbox.map(
      (item) => item / deviceScaleFactor,
    ) as [number, number, number, number];
    const candidates = nodes
      .map((node) => {
        const [x, y, w, h] = node.bbox;
        const px = x * deviceScaleFactor,
          py = y * deviceScaleFactor,
          pw = w * deviceScaleFactor,
          ph = h * deviceScaleFactor;
        const overlapWidth = Math.max(
          0,
          Math.min(bbox[0] + bbox[2], px + pw) - Math.max(bbox[0], px),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(bbox[1] + bbox[3], py + ph) - Math.max(bbox[1], py),
        );
        const actualOverlap = (overlapWidth * overlapHeight) / Math.max(1, bbox[2] * bbox[3]);
        const pad = 10 * deviceScaleFactor;
        const nearWidth = Math.max(
          0,
          Math.min(bbox[0] + bbox[2], px + pw + pad) - Math.max(bbox[0], px - pad),
        );
        const nearHeight = Math.max(
          0,
          Math.min(bbox[1] + bbox[3], py + ph + pad) - Math.max(bbox[1], py - pad),
        );
        const overlap = Math.max(
          actualOverlap,
          ((nearWidth * nearHeight) / Math.max(1, bbox[2] * bbox[3])) * 0.45,
        );
        const evidence: string[] = [];
        const nodeRight = x + w;
        const nodeBottom = y + h;
        const gapX = Math.max(0, bboxCss[0] - nodeRight, x - (bboxCss[0] + bboxCss[2]));
        const gapY = Math.max(0, bboxCss[1] - nodeBottom, y - (bboxCss[1] + bboxCss[3]));
        const edgeDistance = Math.hypot(gapX, gapY);
        if (edgeDistance <= 10) evidence.push('edge-proximity');
        if (
          node.textRects.some(
            ([tx, ty, tw, th]) =>
              Math.min(bboxCss[0] + bboxCss[2], tx + tw) > Math.max(bboxCss[0], tx) &&
              Math.min(bboxCss[1] + bboxCss[3], ty + th) > Math.max(bboxCss[1], ty),
          )
        )
          evidence.push('text-overlap');
        if (node.svg) evidence.push('svg-element');
        if (node.tagName === 'canvas') evidence.push('canvas-element');
        if (node.backgroundColor !== 'rgba(0, 0, 0, 0)' && node.backgroundColor !== 'transparent')
          evidence.push('painted-background');
        return {
          nodeId: node.id,
          selector: node.selector,
          overlap,
          paintOrder: node.paintOrder,
          evidence,
        };
      })
      .filter((candidate) => candidate.overlap > 0.01)
      .sort((a, b) => candidateScore(b) - candidateScore(a))
      .slice(0, 5);
    function candidateScore(candidate: DiffRegion['candidates'][number]): number {
      const node = nodes.find((item) => item.id === candidate.nodeId);
      const nodeArea = node ? Math.max(1, node.bbox[2] * node.bbox[3]) : 1;
      const precision = Math.min(1, (bboxCss[2] * bboxCss[3]) / nodeArea);
      const evidenceScore =
        (candidate.evidence.includes('painted-background') ? 0.25 : 0) +
        (candidate.evidence.includes('svg-element') || candidate.evidence.includes('canvas-element')
          ? 0.2
          : 0) -
        (candidate.evidence.includes('text-overlap') ? 0.35 : 0);
      const [rx, ry, rw, rh] = bboxCss;
      const [nx, ny, nw, nh] = node?.bbox ?? [0, 0, 0, 0];
      const edgeDistance = Math.hypot(
        Math.max(0, rx - (nx + nw), nx - (rx + rw)),
        Math.max(0, ry - (ny + nh), ny - (ry + rh)),
      );
      const edgeProximity = candidate.evidence.includes('edge-proximity')
        ? Math.max(0, 1 - edgeDistance / 10)
        : 0;
      const zIndex = Number.parseInt(node?.zIndex ?? '', 10);
      const stacking = Number.isFinite(zIndex) ? Math.tanh(zIndex / 10) * 0.05 : 0;
      return (
        candidate.overlap * 0.5 +
        precision * 0.25 +
        edgeProximity * 0.15 +
        stacking +
        evidenceScore +
        (candidate.paintOrder / Math.max(nodes.length, 1)) * 0.02
      );
    }
    const topNode = nodes.find((node) => node.id === candidates[0]?.nodeId);
    const extendsBeyondNode = topNode
      ? bboxCss[0] < topNode.bbox[0] - 1 ||
        bboxCss[1] < topNode.bbox[1] - 1 ||
        bboxCss[0] + bboxCss[2] > topNode.bbox[0] + topNode.bbox[2] + 1 ||
        bboxCss[1] + bboxCss[3] > topNode.bbox[1] + topNode.bbox[3] + 1
      : false;
    const borderStrip = topNode
      ? bboxCss[0] >= topNode.bbox[0] - 2 &&
        bboxCss[1] >= topNode.bbox[1] - 2 &&
        bboxCss[0] + bboxCss[2] <= topNode.bbox[0] + topNode.bbox[2] + 2 &&
        bboxCss[1] + bboxCss[3] <= topNode.bbox[1] + topNode.bbox[3] + 2 &&
        (bboxCss[2] < topNode.bbox[2] * 0.35 || bboxCss[3] < topNode.bbox[3] * 0.35)
      : false;
    const classification: DiffRegion['classification'] =
      topNode?.tagName === 'canvas' || topNode?.svg
        ? 'geometry'
        : topNode?.image && local.color > 0.08
          ? 'wrong-asset'
          : candidates[0]?.evidence.includes('text-overlap')
            ? 'typography'
            : topNode?.boxShadow !== 'none' && topNode?.boxShadow !== '' && extendsBeyondNode
              ? 'shadow'
              : topNode?.borderRadius !== '0px' &&
                  topNode?.borderRadius !== '0px 0px 0px 0px' &&
                  local.edge > local.color
                ? 'border-radius'
                : topNode &&
                    Number.parseFloat(topNode.border) > 0 &&
                    (borderStrip ||
                      (extendsBeyondNode === false &&
                        component.pixels.length / Math.max(1, bboxCss[2] * bboxCss[3]) < 0.5))
                  ? 'border'
                  : local.edge > 0.08 && local.color < 0.08
                    ? 'geometry'
                    : local.color > 0.08
                      ? 'paint'
                      : 'unknown';
    regions.push({
      id: `region-${regions.length + 1}`,
      bbox: bboxCss,
      changedPixels: component.pixels.length,
      severity: component.pixels.length / (bbox[2] * bbox[3]),
      metrics: local,
      classification,
      candidates,
    });
  }
  const consumed = new Set<string>();
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    const left = regions[leftIndex]!;
    if (consumed.has(left.id)) continue;
    const node = nodes.find((candidate) => candidate.id === left.candidates[0]?.nodeId);
    if (!node) continue;
    const [nx, ny, nw, nh] = node.bbox;
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const right = regions[rightIndex]!;
      if (consumed.has(right.id) || right.candidates[0]?.nodeId !== node.id) continue;
      const [lx, ly, lw, lh] = left.bbox,
        [rx, ry, rw, rh] = right.bbox;
      const tolerance = 1 / deviceScaleFactor + 0.5;
      const sameRow =
        Math.abs(ly - ry) <= tolerance &&
        Math.abs(lh - rh) <= tolerance &&
        Math.abs(lw - rw) <= tolerance;
      const rightShift =
        sameRow &&
        Math.abs(lx + lw - nx) <= tolerance &&
        Math.abs(rx + rw - (nx + nw)) <= tolerance &&
        Math.abs(rx - (nx + nw - rw)) <= tolerance;
      const leftShift =
        sameRow &&
        Math.abs(rx - (nx + nw)) <= tolerance &&
        Math.abs(lx - nx) <= tolerance &&
        Math.abs(lx + lw - (nx + lw)) <= tolerance;
      const sameColumn =
        Math.abs(lx - rx) <= tolerance &&
        Math.abs(lw - rw) <= tolerance &&
        Math.abs(lh - rh) <= tolerance;
      const downShift =
        sameColumn &&
        Math.abs(ly + lh - ny) <= tolerance &&
        Math.abs(ry + rh - (ny + nh)) <= tolerance &&
        Math.abs(ry - (ny + nh - rh)) <= tolerance;
      const upShift =
        sameColumn &&
        Math.abs(ry - (ny + nh)) <= tolerance &&
        Math.abs(ly - ny) <= tolerance &&
        Math.abs(ly + lh - (ny + lh)) <= tolerance;
      if (!rightShift && !leftShift && !downShift && !upShift) continue;
      const unionX = Math.min(lx, rx),
        unionY = Math.min(ly, ry),
        unionRight = Math.max(lx + lw, rx + rw),
        unionBottom = Math.max(ly + lh, ry + rh);
      left.bbox = [unionX, unionY, unionRight - unionX, unionBottom - unionY];
      left.changedPixels += right.changedPixels;
      left.severity = Math.max(left.severity, right.severity);
      left.classification = 'position';
      // The union of the old and new boxes is centered halfway between their
      // positions. This is more stable than using the threshold-mask width,
      // which may include antialiasing pixels on both edges.
      const dx =
        rightShift || leftShift
          ? Math.round(2 * (nx + nw / 2 - (unionX + (unionRight - unionX) / 2)))
          : 0;
      const dy =
        downShift || upShift
          ? Math.round(2 * (ny + nh / 2 - (unionY + (unionBottom - unionY) / 2)))
          : 0;
      left.deltas = {
        dx,
        dy,
        dw: 0,
        dh: 0,
        provenance: 'measured',
      };
      left.metrics = {
        color: (left.metrics.color + right.metrics.color) / 2,
        edge: (left.metrics.edge + right.metrics.edge) / 2,
        structure: (left.metrics.structure + right.metrics.structure) / 2,
      };
      consumed.add(right.id);
      break;
    }
  }
  const filtered = regions.filter((region) => !consumed.has(region.id));
  for (const region of filtered) {
    if (!region.candidates[0]) continue;
    const node = nodes.find((item) => item.id === region.candidates[0]!.nodeId);
    if (!node) continue;
    const measuredBox = referenceSolidBox(
      metrics.referenceData,
      width,
      height,
      node,
      deviceScaleFactor,
    );
    if (measuredBox) {
      const [x, y, boxWidth, boxHeight] = measuredBox;
      const [nodeX, nodeY, nodeWidth, nodeHeight] = node.bbox;
      const dx = Math.round(nodeX - x);
      const dy = Math.round(nodeY - y);
      const dw = Math.round(nodeWidth - boxWidth);
      const dh = Math.round(nodeHeight - boxHeight);
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1 || Math.abs(dw) >= 1 || Math.abs(dh) >= 1) {
        region.deltas = { dx, dy, dw, dh, provenance: 'measured' };
        region.classification = Math.abs(dw) >= 1 || Math.abs(dh) >= 1 ? 'dimensions' : 'position';
      }
    }
    if (region.classification === 'position' || region.classification === 'spacing') continue;
    const [x, y, bboxWidth, bboxHeight] = region.bbox;
    const [nx, ny, nw, nh] = node.bbox;
    const tolerance = 2 / deviceScaleFactor;
    const verticalEdge =
      Math.abs(y - ny) <= tolerance * 2 &&
      Math.abs(bboxHeight - nh) <= tolerance * 2 &&
      bboxWidth < nw * 0.35;
    const horizontalEdge =
      Math.abs(x - nx) <= tolerance * 2 &&
      Math.abs(bboxWidth - nw) <= tolerance * 2 &&
      bboxHeight < nh * 0.35;
    if (verticalEdge || horizontalEdge) {
      region.classification = 'dimensions';
      const centerX = x + bboxWidth / 2;
      const centerY = y + bboxHeight / 2;
      const deltaWidth = centerX >= nx + nw / 2 ? 2 * (nx + nw - centerX) : 2 * (centerX - nx);
      const deltaHeight = centerY >= ny + nh / 2 ? 2 * (ny + nh - centerY) : 2 * (centerY - ny);
      region.deltas = {
        dx: 0,
        dy: 0,
        dw: verticalEdge ? Math.round(deltaWidth) : 0,
        dh: horizontalEdge ? Math.round(deltaHeight) : 0,
        provenance: 'measured',
      };
    }
  }
  for (const region of filtered) {
    if (region.classification !== 'position' || !region.candidates[0]) continue;
    const node = nodes.find((item) => item.id === region.candidates[0]!.nodeId);
    if (!node?.parentId) continue;
    const parent = nodes.find((item) => item.id === node.parentId);
    const siblings = nodes.filter((item) => item.parentId === node.parentId);
    if (
      parent &&
      (parent.display === 'flex' ||
        parent.display === 'inline-flex' ||
        parent.display === 'grid') &&
      siblings.length > 1
    ) {
      region.classification = 'spacing';
    } else if (parent && parent.padding.split(' ').some((value) => Number.parseFloat(value) > 0)) {
      region.classification = 'spacing';
    }
  }
  for (const region of filtered) {
    if (!region.candidates[0]) continue;
    const node = nodes.find((item) => item.id === region.candidates[0]!.nodeId);
    if (!node?.parentId) continue;
    const parent = nodes.find((item) => item.id === node.parentId);
    if (!parent || !parent.padding.split(' ').some((value) => Number.parseFloat(value) > 0))
      continue;
    const [x, y, width, height] = region.bbox;
    const [nodeX, nodeY, nodeWidth, nodeHeight] = node.bbox;
    const oldAndNewBounds =
      x < nodeX - 1 &&
      y < nodeY - 1 &&
      x + width > nodeX + nodeWidth + 1 &&
      y + height > nodeY + nodeHeight + 1;
    if (oldAndNewBounds) region.classification = 'spacing';
  }
  filtered.forEach((region, index) => {
    region.id = `region-${index + 1}`;
  });
  return filtered.sort((a, b) => b.changedPixels - a.changedPixels).slice(0, 100);
}

export async function compareProject(
  projectId: string,
  referenceId?: string,
): Promise<CompareResult> {
  await ensureStore();
  const manifest = await getProject(projectId);
  const referenceRecord = resolveViewportReference(manifest, referenceId);
  const reference = await normalizeRaster(await readFile(referenceRecord.path));
  const {
    png,
    nodes,
    canvasDrawCalls,
    chromiumVersion,
    unloadedImages,
    videoWarnings,
    pageErrors,
  } = await captureTarget(
    manifest,
    referenceRecord.viewport,
    { x: referenceRecord.scrollX, y: referenceRecord.scrollY },
    referenceRecord,
  );
  const metrics = comparePixels(reference, png);
  const regions = buildRegions(
    metrics.changedMask,
    metrics.width,
    metrics.height,
    nodes,
    {
      color: metrics.meanAbsoluteError,
      edge: metrics.edgeLoss,
      structure: metrics.structuralLoss,
      colorDelta: metrics.colorDelta,
      edgeDelta: metrics.edgeDelta,
      structureDelta: metrics.structureDelta,
      referenceData: metrics.referenceData,
    },
    referenceRecord.viewport.deviceScaleFactor,
  );
  const runId = randomUUID();
  const screenshotPath = projectArtifact(projectId, `runs/${runId}/target.png`);
  const diffPath = projectArtifact(projectId, `runs/${runId}/diff.png`);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, png);
  // Keep the raw threshold mask as a compact, portable artifact for downstream inspection.
  const diff = new PNG({ width: metrics.width, height: metrics.height });
  for (let i = 0; i < metrics.changedMask.length; i += 1) {
    const index = i * 4;
    diff.data[index] = 255;
    diff.data[index + 1] = metrics.changedMask[i] ? 32 : 255;
    diff.data[index + 2] = metrics.changedMask[i] ? 32 : 255;
    diff.data[index + 3] = 255;
  }
  await writeFile(diffPath, PNG.sync.write(diff));
  const result: CompareResult = {
    schemaVersion,
    runId,
    projectId,
    referenceId: referenceRecord.referenceId,
    loss: {
      changedPixelRatio: metrics.changedPixelRatio,
      meanAbsoluteError: metrics.meanAbsoluteError,
      edgeLoss: metrics.edgeLoss,
      structuralLoss: metrics.structuralLoss,
      totalLoss: metrics.totalLoss,
    },
    screenshotPath,
    diffPath,
    regions,
    nodes,
    canvasDrawCalls,
    runtime: { browser: 'chromium', version: chromiumVersion },
    readiness: {
      waitUntil: manifest.browserSettings.waitUntil,
      fontsReady: true,
      animationsDisabled: manifest.browserSettings.disableAnimations,
    },
    warnings: [
      ...unloadedImages.map((source) => `An image did not decode before capture: ${source}`),
      ...videoWarnings,
      ...pageErrors.map((message) => `Target page error: ${message}`),
      ...(nodes.some((node) => node.tagName === 'canvas') && !canvasDrawCalls.length
        ? [
            'A Canvas element is present, but no 2D or WebGL draw calls were captured. The rendered pixels are still compared.',
          ]
        : []),
    ],
  };
  const runManifest = {
    schemaVersion,
    projectId,
    runId,
    createdAt: new Date().toISOString(),
    inputReferenceHash: referenceRecord.sha256,
    referenceId: referenceRecord.referenceId,
    targetUrl: referenceRecord.targetUrl ?? manifest.targetUrl,
    viewport: referenceRecord.viewport,
    ...(referenceRecord.videoTimeSeconds === undefined
      ? {}
      : { videoTimeSeconds: referenceRecord.videoTimeSeconds }),
    browser: { name: 'chromium', version: chromiumVersion },
    readiness: result.readiness,
    artifactPaths: { screenshotPath, diffPath },
    metrics: result.loss,
    warnings: result.warnings,
  };
  await writeFile(
    projectArtifact(projectId, `runs/${runId}/manifest.json`),
    `${JSON.stringify(runManifest, null, 2)}\n`,
  );
  await writeFile(
    projectArtifact(projectId, `runs/${runId}/result.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await writeFile(
    projectArtifact(projectId, 'latest.json'),
    `${JSON.stringify({ runId, referenceId: referenceRecord.referenceId }, null, 2)}\n`,
  );
  const latestByReferencePath = projectArtifact(projectId, 'latest-by-reference.json');
  const latestByReference: Record<string, string> = await readFile(latestByReferencePath, 'utf8')
    .then((contents) => JSON.parse(contents) as Record<string, string>)
    .catch(() => ({}));
  latestByReference[referenceRecord.referenceId] = runId;
  await writeFile(latestByReferencePath, `${JSON.stringify(latestByReference, null, 2)}\n`);
  return result;
}

export async function latestCompare(
  projectId: string,
  referenceId?: string,
): Promise<CompareResult> {
  let latest: { runId: string; referenceId?: string };
  if (referenceId) {
    const records = JSON.parse(
      await readFile(projectArtifact(projectId, 'latest-by-reference.json'), 'utf8'),
    ) as Record<string, string>;
    const runId = records[referenceId];
    if (!runId) throw new Error(`No comparison exists for reference ${referenceId}.`);
    latest = { runId, referenceId };
  } else {
    latest = JSON.parse(await readFile(projectArtifact(projectId, 'latest.json'), 'utf8')) as {
      runId: string;
      referenceId?: string;
    };
  }
  return JSON.parse(
    await readFile(projectArtifact(projectId, `runs/${latest.runId}/result.json`), 'utf8'),
  ) as CompareResult;
}

export async function getTargetIR(
  projectId: string,
  referenceId?: string,
): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  runId: string;
  referenceId: string;
  nodes: DomNode[];
  canvasDrawCalls: CanvasDrawCall[];
}> {
  const result = await latestCompare(projectId, referenceId);
  return {
    schemaVersion,
    projectId,
    runId: result.runId,
    referenceId: result.referenceId,
    nodes: result.nodes,
    canvasDrawCalls: result.canvasDrawCalls,
  };
}

export async function getRun(projectId: string, runId: string): Promise<CompareResult> {
  const result = JSON.parse(
    await readFile(projectArtifact(projectId, `runs/${runId}/result.json`), 'utf8'),
  ) as CompareResult;
  if (result.projectId !== projectId || result.runId !== runId)
    throw new Error('Run manifest identity does not match requested URI.');
  return result;
}

export async function getRegion(
  projectId: string,
  runId: string,
  regionId: string,
): Promise<ReturnType<typeof inspectRegion>> {
  const result = await getRun(projectId, runId);
  return inspectRegion(result, regionId);
}

export async function readArtifact(
  projectId: string,
  artifactPath: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const projectRoot = path.resolve(projectArtifact(projectId, ''));
  const resolved = path.resolve(projectRoot, artifactPath);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error('Artifact path must stay inside the project artifact store.');
  }
  const extension = path.extname(resolved).toLowerCase();
  const mimeType =
    extension === '.png'
      ? 'image/png'
      : extension === '.svg'
        ? 'image/svg+xml'
        : extension === '.json'
          ? 'application/json'
          : 'application/octet-stream';
  return { bytes: await readFile(resolved), mimeType };
}

export function inspectRegion(
  result: CompareResult,
  regionId: string,
): {
  schemaVersion: typeof schemaVersion;
  region: DiffRegion;
  classification: string;
  measuredDeltas: DiffRegion['deltas'] | null;
  localMetrics: DiffRegion['metrics'];
  candidates: Array<{ node: DomNode; overlap: number }>;
} {
  const region = result.regions.find((candidate) => candidate.id === regionId);
  if (!region) throw new Error(`Unknown region ${regionId} in run ${result.runId}.`);
  const candidates = region.candidates.flatMap((candidate) => {
    const node = result.nodes.find((item) => item.id === candidate.nodeId);
    return node ? [{ node, overlap: candidate.overlap }] : [];
  });
  return {
    schemaVersion,
    region,
    classification: region.classification,
    measuredDeltas: region.deltas ?? null,
    localMetrics: region.metrics,
    candidates,
  };
}

export async function testOverrides(input: {
  projectId: string;
  selector: string;
  styles: Record<string, string>;
  svgAttributes?: Record<string, string>;
  referenceId?: string;
  regionId?: string;
}): Promise<{
  schemaVersion: typeof schemaVersion;
  baselineLoss: number;
  candidateLoss: number;
  absoluteDelta: number;
  relativeDelta: number;
  improved: boolean;
  previewPath: string;
}> {
  const manifest = await getProject(input.projectId);
  const reference = resolveViewportReference(manifest, input.referenceId);
  const comparison = input.regionId
    ? await latestCompare(input.projectId, reference.referenceId)
    : undefined;
  const region = input.regionId
    ? comparison?.regions.find((item) => item.id === input.regionId)
    : undefined;
  if (input.regionId && !region)
    throw new Error('Unknown region ' + input.regionId + '; run visual.compare first.');
  const clip = region ? regionClip(region, reference.viewport) : undefined;
  const referenceBytes = await normalizeRaster(await readFile(reference.path));
  const referenceCrop = clip
    ? cropPng(referenceBytes, clip, reference.viewport.deviceScaleFactor)
    : referenceBytes;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: reference.viewport.width, height: reference.viewport.height },
      deviceScaleFactor: reference.viewport.deviceScaleFactor,
      locale: manifest.browserSettings.locale,
      timezoneId: manifest.browserSettings.timezoneId,
      colorScheme: manifest.browserSettings.colorScheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await installDeterminism(page, manifest.browserSettings);
    await page.goto(reference.targetUrl ?? manifest.targetUrl, {
      waitUntil: manifest.browserSettings.waitUntil,
      timeout: manifest.browserSettings.timeoutMs,
    });
    await applyReferenceActions(page, reference.actions, manifest.browserSettings.timeoutMs);
    await waitUntilReady(page, manifest.browserSettings);
    await page.evaluate(async () => await document.fonts.ready);
    await stabilizeVideos(page, reference.videoTimeSeconds, manifest.browserSettings.timeoutMs);
    const screenshotOptions = clip ? { clip } : {};
    const baseline = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      ...screenshotOptions,
    });
    await page
      .locator(input.selector)
      .first()
      .evaluate(
        (element, overrides) => {
          for (const [property, value] of Object.entries(overrides.styles))
            (element as HTMLElement).style.setProperty(property, value, 'important');
          for (const [attribute, value] of Object.entries(overrides.attributes)) {
            if (!(element instanceof SVGElement))
              throw new Error('SVG attributes require an SVG element.');
            element.setAttribute(attribute, value);
          }
        },
        { styles: input.styles, attributes: input.svgAttributes ?? {} },
      );
    const candidate = await page.screenshot({
      type: 'png',
      animations: 'disabled',
      ...screenshotOptions,
    });
    const baselineLoss = comparePixels(referenceCrop, baseline).totalLoss;
    const candidateLoss = comparePixels(referenceCrop, candidate).totalLoss;
    const absoluteDelta = candidateLoss - baselineLoss;
    const relativeDelta = baselineLoss ? absoluteDelta / baselineLoss : 0;
    const previewPath = projectArtifact(input.projectId, `previews/${randomUUID()}.png`);
    await mkdir(path.dirname(previewPath), { recursive: true });
    await writeFile(previewPath, candidate);
    await context.close();
    return {
      schemaVersion,
      baselineLoss,
      candidateLoss,
      absoluteDelta,
      relativeDelta,
      improved: candidateLoss < baselineLoss,
      previewPath,
    };
  } finally {
    await browser?.close();
  }
}

function regionClip(region: DiffRegion, viewport: Viewport, padding = 12) {
  const x = Math.max(0, region.bbox[0] - padding);
  const y = Math.max(0, region.bbox[1] - padding);
  return {
    x,
    y,
    width: Math.max(1, Math.min(viewport.width - x, region.bbox[2] + padding * 2)),
    height: Math.max(1, Math.min(viewport.height - y, region.bbox[3] + padding * 2)),
  };
}

function cropPng(
  bytes: Buffer,
  clip: { x: number; y: number; width: number; height: number },
  dpr: number,
): Buffer {
  const source = PNG.sync.read(bytes);
  const left = Math.max(0, Math.floor(clip.x * dpr));
  const top = Math.max(0, Math.floor(clip.y * dpr));
  const width = Math.min(source.width - left, Math.ceil(clip.width * dpr));
  const height = Math.min(source.height - top, Math.ceil(clip.height * dpr));
  if (width <= 0 || height <= 0)
    throw new Error('Requested crop is outside the reference screenshot.');
  const output = new PNG({ width, height });
  PNG.bitblt(source, output, left, top, width, height, 0, 0);
  return PNG.sync.write(output);
}

async function installDeterminism(page: Page, settings: BrowserSettings): Promise<void> {
  await page.addInitScript((browserSettings) => {
    const NativeDate = Date;
    const fixedEpoch = new NativeDate(browserSettings.fixedTime).valueOf();
    const DeterministicDate = new Proxy(NativeDate, {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [fixedEpoch]);
      },
      get(target, property) {
        return property === 'now' ? () => fixedEpoch : Reflect.get(target, property);
      },
    });
    Object.defineProperty(window, 'Date', { value: DeterministicDate });
    let randomState = browserSettings.randomSeed >>> 0;
    Math.random = () => {
      randomState = (randomState * 1664525 + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    if (browserSettings.disableAnimations) {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          const style = document.createElement('style');
          style.textContent =
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
          document.documentElement.append(style);
        },
        { once: true },
      );
    }
  }, settings);
}

async function waitUntilReady(page: Page, settings: BrowserSettings): Promise<void> {
  if (settings.readySelector)
    await page
      .locator(settings.readySelector)
      .waitFor({ state: 'visible', timeout: settings.timeoutMs });
  if (settings.readinessPredicate)
    await page.waitForFunction(
      (source) => Boolean((0, eval)(source)),
      settings.readinessPredicate,
      { timeout: settings.timeoutMs },
    );
  for (const selector of settings.maskSelectors)
    await page.locator(selector).evaluateAll((elements) =>
      elements.forEach((element) => {
        (element as HTMLElement).style.visibility = 'hidden';
      }),
    );
}

async function stabilizeVideos(
  page: Page,
  timeSeconds: number | undefined,
  timeoutMs: number,
): Promise<string[]> {
  return page.evaluate(
    async ({ timeSeconds: requestedTime, timeoutMs: timeout }) => {
      const warnings: string[] = [];
      const videos = [...document.querySelectorAll('video')];
      await Promise.all(
        videos.map(async (video, index) => {
          const label = video.id ? `#${video.id}` : `video:nth-of-type(${index + 1})`;
          video.pause();
          if (requestedTime === undefined) {
            warnings.push(
              `Video ${label} was paused at its current frame; set videoTimeSeconds for repeatable capture.`,
            );
            return;
          }
          try {
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
              await new Promise<void>((resolve, reject) => {
                const timer = window.setTimeout(
                  () => reject(new Error('Timed out waiting for video data.')),
                  timeout,
                );
                video.addEventListener(
                  'loadeddata',
                  () => {
                    window.clearTimeout(timer);
                    resolve();
                  },
                  { once: true },
                );
                video.addEventListener(
                  'error',
                  () => {
                    window.clearTimeout(timer);
                    reject(new Error('Video failed to load.'));
                  },
                  { once: true },
                );
              });
            }
            if (Number.isFinite(video.duration) && requestedTime > video.duration)
              throw new Error(`Requested time exceeds duration ${video.duration}s.`);
            const seekable = Array.from(
              { length: video.seekable.length },
              (_, index): [number, number] => [
                video.seekable.start(index),
                video.seekable.end(index),
              ],
            );
            if (
              Math.abs(video.currentTime - requestedTime) > 0.01 &&
              !seekable.some(([start, end]) => requestedTime >= start && requestedTime <= end)
            )
              throw new Error(
                `Requested time is not in the media's seekable ranges (${seekable.map(([start, end]) => `${start}-${end}`).join(', ') || 'none'}).`,
              );
            if (Math.abs(video.currentTime - requestedTime) > 0.01) {
              await new Promise<void>((resolve, reject) => {
                const timer = window.setTimeout(
                  () => reject(new Error('Timed out seeking to requested video time.')),
                  timeout,
                );
                const finishSeek = () => {
                  if (video.seeking || Math.abs(video.currentTime - requestedTime) > 0.05) return;
                  window.clearTimeout(timer);
                  video.removeEventListener('seeked', finishSeek);
                  resolve();
                };
                video.addEventListener('seeked', finishSeek);
                video.currentTime = requestedTime;
                finishSeek();
              });
            }
            video.pause();
            if (Math.abs(video.currentTime - requestedTime) > 0.05)
              throw new Error(
                `Seek settled at ${video.currentTime}s instead of ${requestedTime}s.`,
              );
          } catch (error) {
            warnings.push(
              `Could not freeze ${label} at ${requestedTime}s: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
      return warnings;
    },
    { timeSeconds, timeoutMs },
  );
}

async function runCvWorker(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const workerProject =
    process.env.GLAMOUR_CV_PROJECT_PATH ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../python/glamour_cv');
  const workerScript = path.join(workerProject, 'src/glamour_cv/worker.py');
  return new Promise((resolve, reject) => {
    const worker = spawn(
      process.env.GLAMOUR_UV ?? 'uv',
      ['run', '--project', workerProject, 'python', workerScript],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      worker.kill('SIGTERM');
      reject(new Error('Geometry extraction exceeded its 60 second worker timeout.'));
    }, 60_000);
    timeout.unref();
    worker.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    worker.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    worker.on('error', (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          'Could not start geometry extraction. Install uv and the Glamour CV dependencies. ' +
            error.message,
        ),
      );
    });
    worker.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) return;
      try {
        if (!stdout.trim()) {
          reject(
            new Error(
              `Geometry worker exited with code ${code}: ${stderr.trim() || 'no diagnostic output'}`,
            ),
          );
          return;
        }
        const response = JSON.parse(stdout) as {
          ok: boolean;
          result?: Record<string, unknown>;
          error?: string;
        };
        if (code !== 0 || !response.ok || !response.result)
          reject(new Error(response.error ?? stderr.trim() ?? 'CV worker failed.'));
        else resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    worker.stdin.end(JSON.stringify(payload));
  });
}

export async function extractGeometry(input: {
  projectId: string;
  regionId: string;
  referenceId?: string;
  mode?: 'open' | 'closed';
  color?: string;
  threshold?: number;
  maxError?: number;
  format?: 'svg' | 'path2d';
}): Promise<{
  schemaVersion: typeof schemaVersion;
  artifactUri: string;
  artifactPath: string;
  sourceBbox: number[];
  viewBox: number[];
  paint: Record<string, unknown>;
  fitError: number;
  browserValidationLoss: number;
  warnings: string[];
  format: 'svg' | 'path2d';
  path2D?: string;
}> {
  const project = await getProject(input.projectId);
  const reference = resolveViewportReference(project, input.referenceId);
  const result = await latestCompare(input.projectId, reference.referenceId);
  const region = result.regions.find((item) => item.id === input.regionId);
  if (!region) throw new Error('Unknown mismatch region ' + input.regionId + '.');
  const artifactPath = projectArtifact(input.projectId, 'artifacts/' + randomUUID() + '.svg');
  const cv = await runCvWorker({
    sourcePath: reference.path,
    bbox: region.bbox,
    deviceScaleFactor: reference.viewport.deviceScaleFactor,
    mode: input.mode ?? 'open',
    color: input.color,
    threshold: input.threshold,
    maxError: input.maxError,
    artifactPath,
  });
  const sourceBbox = cv.sourceBbox as number[];
  const viewBox = cv.viewBox as number[];
  const width = Number(viewBox[2]);
  const height = Number(viewBox[3]);
  let browser: Browser | undefined;
  let browserValidationLoss: number;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const background = String(cv.backgroundColor ?? '#ffffff');
    await page.setContent(
      '<!doctype html><html><body style="margin:0;background:' +
        background +
        '">' +
        String(cv.svg) +
        '</body></html>',
    );
    const rendered = await page.screenshot({ type: 'png' });
    const crop = cropPng(
      await normalizeRaster(await readFile(reference.path)),
      { x: sourceBbox[0]!, y: sourceBbox[1]!, width: sourceBbox[2]!, height: sourceBbox[3]! },
      reference.viewport.deviceScaleFactor,
    );
    browserValidationLoss = comparePixels(crop, rendered).totalLoss;
    await context.close();
  } finally {
    await browser?.close();
  }
  const warnings = (cv.warnings as string[] | undefined) ?? [];
  if (browserValidationLoss > 0.12)
    warnings.push('Browser-rendered vector differs substantially from the source crop.');
  const format = input.format ?? 'svg';
  const pathData = /<path\s+d="([^"]+)"/.exec(String(cv.svg))?.[1];
  return {
    schemaVersion,
    artifactUri:
      'visual://project/' + input.projectId + '/artifacts/' + path.basename(artifactPath),
    artifactPath,
    sourceBbox,
    viewBox,
    paint: cv.paint as Record<string, unknown>,
    fitError: Number(cv.fitError),
    browserValidationLoss,
    warnings,
    format,
    ...(format === 'path2d' && pathData ? { path2D: pathData } : {}),
  };
}

export async function optimize(input: {
  projectId: string;
  selector: string;
  property:
    | 'translateX'
    | 'translateY'
    | 'width'
    | 'height'
    | 'fontSize'
    | 'lineHeight'
    | 'letterSpacing'
    | 'borderRadius'
    | 'opacity';
  min: number;
  max: number;
  step: number;
  referenceId?: string;
  regionId?: string;
  maxEvaluations?: number;
  timeoutMs?: number;
}): Promise<{
  schemaVersion: typeof schemaVersion;
  selector: string;
  property: string;
  baselineLoss: number;
  bestLoss: number;
  bestValue: number;
  improved: boolean;
  evaluations: number;
  candidates: Array<{ value: number; loss: number }>;
  previewPath: string;
}> {
  if (
    !Number.isFinite(input.min) ||
    !Number.isFinite(input.max) ||
    !Number.isFinite(input.step) ||
    !(input.max > input.min) ||
    !(input.step > 0)
  )
    throw new Error('Optimizer requires max > min and a positive step.');
  const project = await getProject(input.projectId);
  const reference = resolveViewportReference(project, input.referenceId);
  const previous = await latestCompare(input.projectId, reference.referenceId).catch(
    () => undefined,
  );
  const region = input.regionId
    ? previous?.regions.find((item) => item.id === input.regionId)
    : undefined;
  if (input.regionId && !region)
    throw new Error('Unknown region ' + input.regionId + '; run visual.compare first.');
  const clip = region ? regionClip(region, reference.viewport) : undefined;
  const referenceBytes = await normalizeRaster(await readFile(reference.path));
  const referenceCrop = clip
    ? cropPng(referenceBytes, clip, reference.viewport.deviceScaleFactor)
    : referenceBytes;
  const propertyMap = {
    translateX: 'translate',
    translateY: 'translate',
    width: 'width',
    height: 'height',
    fontSize: 'font-size',
    lineHeight: 'line-height',
    letterSpacing: 'letter-spacing',
    borderRadius: 'border-radius',
    opacity: 'opacity',
  } as const;
  const cssProperty = propertyMap[input.property];
  const maxEvaluations = Math.min(60, Math.max(3, input.maxEvaluations ?? 36));
  const timeoutMs = Math.min(120_000, Math.max(1_000, input.timeoutMs ?? 45_000));
  const candidates: Array<{ value: number; loss: number }> = [];
  const startedAt = Date.now();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: reference.viewport.width, height: reference.viewport.height },
      deviceScaleFactor: reference.viewport.deviceScaleFactor,
      locale: project.browserSettings.locale,
      timezoneId: project.browserSettings.timezoneId,
      colorScheme: project.browserSettings.colorScheme,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await installDeterminism(page, project.browserSettings);
    await page.goto(reference.targetUrl ?? project.targetUrl, {
      waitUntil: project.browserSettings.waitUntil,
      timeout: project.browserSettings.timeoutMs,
    });
    await applyReferenceActions(page, reference.actions, project.browserSettings.timeoutMs);
    await waitUntilReady(page, project.browserSettings);
    await page.evaluate(async () => await document.fonts.ready);
    await stabilizeVideos(page, reference.videoTimeSeconds, project.browserSettings.timeoutMs);
    const locator = page.locator(input.selector).first();
    await locator.waitFor({ state: 'visible', timeout: project.browserSettings.timeoutMs });
    const originalStyle = await locator.getAttribute('style');
    const restore = async () =>
      locator.evaluate((element, style) => {
        if (style === null) element.removeAttribute('style');
        else element.setAttribute('style', style);
      }, originalStyle);
    const evaluate = async (value?: number) => {
      if (value === undefined) await restore();
      else
        await locator.evaluate(
          (element, args) => {
            const style = (element as HTMLElement).style;
            if (args.property === 'translateX')
              style.setProperty('translate', String(args.value) + 'px 0px', 'important');
            else if (args.property === 'translateY')
              style.setProperty('translate', '0px ' + String(args.value) + 'px', 'important');
            else
              style.setProperty(
                args.cssProperty,
                String(args.value) + (args.property === 'opacity' ? '' : 'px'),
                'important',
              );
          },
          { property: input.property, cssProperty, value },
        );
      const screenshot = await page.screenshot({
        type: 'png',
        animations: 'disabled',
        ...(clip ? { clip } : {}),
      });
      return comparePixels(referenceCrop, screenshot).totalLoss;
    };
    const baselineLoss = await evaluate();
    let bestLoss = baselineLoss;
    let bestValue = input.min;
    let low = input.min;
    let high = input.max;
    let spacing = Math.max(input.step, (high - low) / 6);
    while (candidates.length < maxEvaluations && Date.now() - startedAt < timeoutMs) {
      const sampleCount = Math.min(7, Math.floor((high - low) / spacing) + 1);
      for (let index = 0; index < sampleCount && candidates.length < maxEvaluations; index += 1) {
        const value = Math.min(high, low + index * spacing);
        if (candidates.some((candidate) => Math.abs(candidate.value - value) < 1e-9)) continue;
        const loss = await evaluate(value);
        candidates.push({ value, loss });
        if (loss < bestLoss) {
          bestLoss = loss;
          bestValue = value;
        }
        if (Date.now() - startedAt >= timeoutMs) break;
      }
      if (spacing <= input.step) break;
      spacing = Math.max(input.step, spacing / 2);
      low = Math.max(input.min, bestValue - spacing * 2);
      high = Math.min(input.max, bestValue + spacing * 2);
    }
    await restore();
    if (bestLoss < baselineLoss) await evaluate(bestValue);
    const previewPath = projectArtifact(
      input.projectId,
      'previews/optimize-' + randomUUID() + '.png',
    );
    await mkdir(path.dirname(previewPath), { recursive: true });
    await writeFile(
      previewPath,
      await page.screenshot({ type: 'png', animations: 'disabled', ...(clip ? { clip } : {}) }),
    );
    await context.close();
    return {
      schemaVersion,
      selector: input.selector,
      property: input.property,
      baselineLoss,
      bestLoss,
      bestValue,
      improved: bestLoss < baselineLoss,
      evaluations: candidates.length,
      candidates,
      previewPath,
    };
  } finally {
    await browser?.close();
  }
}

export async function finalizeProject(projectId: string): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  status: 'verified' | 'mismatches-found' | 'not-compared';
  references: Array<{
    referenceId: string;
    viewport: Viewport;
    captureType: ReferenceScreenshot['captureType'];
    comparisonStatus: 'compared' | 'structural-only' | 'not-compared';
    skippedReason?: string;
    runId?: string;
    loss?: CompareResult['loss'];
    regionCount: number;
    dimensions: number;
    layout: number;
    geometry: number;
    paint: number;
    typography: number;
    effects: number;
    unsupportedOrUncertain: number;
  }>;
  responsive: {
    suppliedMappings: ReferenceBundle['responsiveMappings'];
    observedNodeChanges: Array<{
      familyId: string;
      identity?: string;
      selector: string;
      tagName: string;
      observations: Array<{
        referenceId: string;
        viewport: Viewport;
        bbox: DomNode['bbox'];
        visible: boolean;
      }>;
    }>;
    breakpointHypotheses: Array<{
      familyId: string;
      selector: string;
      betweenWidths: [number, number];
      evidence: string[];
      provenance: 'derived';
      confidence: number;
    }>;
  };
  summary: { totalRegions: number; meanTotalLoss: number | null };
}> {
  const project = await getProject(projectId);
  const reports = await Promise.all(
    project.references.map(async (reference) => {
      const result = await latestCompare(projectId, reference.referenceId).catch(() => undefined);
      if (!result)
        return {
          referenceId: reference.referenceId,
          viewport: reference.viewport,
          captureType: reference.captureType,
          comparisonStatus:
            reference.captureType === 'full-page'
              ? ('structural-only' as const)
              : ('not-compared' as const),
          ...(reference.captureType === 'full-page'
            ? {
                skippedReason: 'Full-page captures are structural input, not viewport comparisons.',
              }
            : {}),
          regionCount: 0,
          dimensions: 0,
          layout: 0,
          geometry: 0,
          paint: 0,
          typography: 0,
          effects: 0,
          unsupportedOrUncertain: 0,
        };
      const count = (kind: DiffRegion['classification']) =>
        result.regions.filter((region) => region.classification === kind).length;
      const unsupportedOrUncertain =
        result.warnings.length +
        result.regions.filter((region) => region.classification === 'unknown').length;
      return {
        referenceId: reference.referenceId,
        viewport: reference.viewport,
        captureType: reference.captureType,
        comparisonStatus: 'compared' as const,
        runId: result.runId,
        loss: result.loss,
        regionCount: result.regions.length,
        dimensions: count('dimensions'),
        layout: count('position') + count('spacing'),
        geometry: count('geometry'),
        paint: count('paint'),
        typography: count('typography'),
        effects: count('shadow') + count('border-radius') + count('border'),
        unsupportedOrUncertain,
      };
    }),
  );
  const compared = reports.filter((item) => item.loss);
  const families = new Map<string, ReferenceScreenshot[]>();
  for (const reference of project.references) {
    if (!reference.familyId || reference.captureType !== 'viewport') continue;
    const family = families.get(reference.familyId) ?? [];
    family.push(reference);
    families.set(reference.familyId, family);
  }
  const observedNodeChanges: Array<{
    familyId: string;
    selector: string;
    tagName: string;
    observations: Array<{
      referenceId: string;
      viewport: Viewport;
      bbox: DomNode['bbox'];
      visible: boolean;
    }>;
  }> = [];
  const breakpointHypotheses: Array<{
    familyId: string;
    selector: string;
    betweenWidths: [number, number];
    evidence: string[];
    provenance: 'derived';
    confidence: number;
  }> = [];
  for (const [familyId, references] of families) {
    const targetByReference = await Promise.all(
      references.map(async (reference) => ({
        reference,
        nodes:
          (await latestCompare(projectId, reference.referenceId).catch(() => undefined))?.nodes ??
          [],
      })),
    );
    const suppliedMapping = project.referenceBundle.responsiveMappings.find(
      (mapping) => mapping.familyId === familyId,
    );
    const suppliedNodes = suppliedMapping?.nodeMappings ?? [];
    const identities = new Map<string, (typeof observedNodeChanges)[number]['observations']>();
    const labels = new Map<string, { identity?: string; selector: string; tagName: string }>();
    for (const { reference, nodes } of targetByReference) {
      for (const node of nodes) {
        const explicit = suppliedNodes.find(
          (mapping) =>
            mapping.referenceId === reference.referenceId &&
            (mapping.nodeId === node.id || mapping.nodeId === node.selector),
        );
        const partOfExplicitIdentity = suppliedNodes.some(
          (mapping) => mapping.nodeId === node.id || mapping.nodeId === node.selector,
        );
        if (suppliedNodes.length && partOfExplicitIdentity && !explicit) continue;
        const key = explicit?.identity ?? `${node.selector}|${node.tagName}`;
        labels.set(key, {
          ...(explicit?.identity ? { identity: explicit.identity } : {}),
          selector: node.selector,
          tagName: node.tagName,
        });
        const observations = identities.get(key) ?? [];
        observations.push({
          referenceId: reference.referenceId,
          viewport: reference.viewport,
          bbox: node.bbox,
          visible: node.display !== 'none' && node.bbox[2] > 0 && node.bbox[3] > 0,
        });
        identities.set(key, observations);
      }
    }
    for (const identity of [...new Set(suppliedNodes.map((mapping) => mapping.identity))]) {
      const identityMappings = suppliedNodes.filter((mapping) => mapping.identity === identity);
      const representative = identityMappings[0]!;
      const observations = identities.get(identity) ?? [];
      for (const { reference, nodes } of targetByReference) {
        if (observations.some((observation) => observation.referenceId === reference.referenceId))
          continue;
        const mapping = identityMappings.find((item) => item.referenceId === reference.referenceId);
        const node = mapping?.nodeId
          ? nodes.find((item) => item.id === mapping.nodeId || item.selector === mapping.nodeId)
          : undefined;
        observations.push({
          referenceId: reference.referenceId,
          viewport: reference.viewport,
          bbox: node?.bbox ?? [0, 0, 0, 0],
          visible: mapping?.visible ?? Boolean(node && node.display !== 'none'),
        });
        if (node)
          labels.set(identity, {
            identity,
            selector: node.selector,
            tagName: node.tagName,
          });
      }
      identities.set(identity, observations);
      labels.set(identity, {
        identity,
        selector: labels.get(identity)?.selector ?? representative.nodeId ?? identity,
        tagName: labels.get(identity)?.tagName ?? 'unknown',
      });
    }
    for (const [key, observations] of identities) {
      if (observations.length < 2) continue;
      const label = labels.get(key) ?? {
        selector: key.split('|')[0]!,
        tagName: key.split('|')[1]!,
      };
      observedNodeChanges.push({
        familyId,
        ...(label.identity ? { identity: label.identity } : {}),
        selector: label.selector,
        tagName: label.tagName,
        observations: observations.sort((a, b) => a.viewport.width - b.viewport.width),
      });
      const ordered = observations.sort((a, b) => a.viewport.width - b.viewport.width);
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const narrow = ordered[index]!;
        const wide = ordered[index + 1]!;
        if (narrow.visible === wide.visible) continue;
        breakpointHypotheses.push({
          familyId,
          selector: label.selector,
          betweenWidths: [narrow.viewport.width, wide.viewport.width],
          evidence: [
            `${narrow.referenceId}: ${narrow.visible ? 'visible' : 'absent'}`,
            `${wide.referenceId}: ${wide.visible ? 'visible' : 'absent'}`,
          ],
          provenance: 'derived',
          confidence: 0.65,
        });
      }
    }
  }
  return {
    schemaVersion,
    projectId,
    status: !compared.length
      ? 'not-compared'
      : reports.some((item) => item.regionCount > 0)
        ? 'mismatches-found'
        : 'verified',
    references: reports,
    responsive: {
      suppliedMappings: project.referenceBundle.responsiveMappings,
      observedNodeChanges,
      breakpointHypotheses,
    },
    summary: {
      totalRegions: reports.reduce((total, item) => total + item.regionCount, 0),
      meanTotalLoss: compared.length
        ? compared.reduce((total, item) => total + item.loss!.totalLoss, 0) / compared.length
        : null,
    },
  };
}
