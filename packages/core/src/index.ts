import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { z } from 'zod';
import { PNG } from 'pngjs';

export const schemaVersion = '1' as const;
export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().default(1),
});
export type Viewport = z.infer<typeof viewportSchema>;

export interface ProjectManifest {
  schemaVersion: typeof schemaVersion;
  projectId: string;
  name: string;
  createdAt: string;
  referencePath: string;
  referenceSha256: string;
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
  text: string;
}

export interface DiffRegion {
  id: string;
  bbox: [number, number, number, number];
  changedPixels: number;
  severity: number;
  candidates: Array<{ nodeId: string; selector: string; overlap: number }>;
}

export interface CompareResult {
  schemaVersion: typeof schemaVersion;
  runId: string;
  projectId: string;
  loss: { changedPixelRatio: number; meanAbsoluteError: number };
  screenshotPath: string;
  diffPath: string;
  regions: DiffRegion[];
  nodes: DomNode[];
  runtime: { browser: 'chromium'; version: string };
  readiness: { waitUntil: 'networkidle'; fontsReady: true; animationsDisabled: true };
  warnings: string[];
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
  referencePath: string;
  targetUrl: string;
  viewport: Viewport;
}): Promise<ProjectManifest> {
  const viewport = viewportSchema.parse(input.viewport);
  const referencePath = path.resolve(input.referencePath);
  const bytes = await readFile(referencePath).catch(() => {
    throw new Error(`Reference image not found: ${referencePath}`);
  });
  const id = randomUUID();
  const dir = projectArtifact(id, '');
  await mkdir(dir, { recursive: true });
  const manifest: ProjectManifest = {
    schemaVersion,
    projectId: id,
    name: input.name,
    createdAt: new Date().toISOString(),
    referencePath,
    referenceSha256: sha256(bytes),
    targetUrl: input.targetUrl,
    viewport,
  };
  await writeFile(projectFile(id), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function getProject(projectId: string): Promise<ProjectManifest> {
  const manifest = JSON.parse(await readFile(projectFile(projectId), 'utf8')) as ProjectManifest;
  if (manifest.schemaVersion !== schemaVersion)
    throw new Error('Unsupported project schema version.');
  return manifest;
}

async function captureTarget(
  manifest: ProjectManifest,
): Promise<{ png: Buffer; nodes: DomNode[]; chromiumVersion: string }> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: manifest.viewport.width, height: manifest.viewport.height },
      deviceScaleFactor: manifest.viewport.deviceScaleFactor,
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const disableMotion = () => {
        const style = document.createElement('style');
        style.textContent =
          '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
        document.documentElement.append(style);
      };
      if (document.documentElement) disableMotion();
      else document.addEventListener('DOMContentLoaded', disableMotion, { once: true });
    });
    await page.goto(manifest.targetUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.evaluate(async () => await document.fonts.ready);
    const nodes = await page.evaluate(() => {
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
      return [...document.querySelectorAll('body *')].slice(0, 4000).map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          id: `node-${index + 1}`,
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
          text: (element.textContent ?? '').trim().slice(0, 160),
        };
      });
    });
    const png = await page.screenshot({ type: 'png', animations: 'disabled' });
    await context.close();
    return { png, nodes, chromiumVersion: browser.version() };
  } finally {
    await browser?.close();
  }
}

function decodePng(bytes: Buffer): { data: Uint8Array; width: number; height: number } {
  const image = PNG.sync.read(bytes);
  return { data: image.data, width: image.width, height: image.height };
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
    if (delta > 18) {
      changedMask[p] = 1;
      changed += 1;
    }
  }
  return {
    changedMask,
    width: reference.width,
    height: reference.height,
    changedPixelRatio: changed / pixels,
    meanAbsoluteError: absoluteError / pixels / 255,
  };
}

function buildRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  nodes: DomNode[],
): DiffRegion[] {
  const seen = new Uint8Array(mask.length);
  const regions: DiffRegion[] = [];
  const neighbors = [-1, 1, -width, width];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0,
      changedPixels = 0;
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
      for (const offset of neighbors) {
        const next = index + offset;
        if (
          next >= 0 &&
          next < mask.length &&
          Math.abs((next % width) - x) <= 1 &&
          mask[next] &&
          !seen[next]
        ) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (changedPixels < 4) continue;
    const bbox: [number, number, number, number] = [minX, minY, maxX - minX + 1, maxY - minY + 1];
    const candidates = nodes
      .map((node) => {
        const [x, y, w, h] = node.bbox;
        const overlapWidth = Math.max(0, Math.min(maxX + 1, x + w) - Math.max(minX, x));
        const overlapHeight = Math.max(0, Math.min(maxY + 1, y + h) - Math.max(minY, y));
        const overlap = (overlapWidth * overlapHeight) / Math.max(1, bbox[2] * bbox[3]);
        return { nodeId: node.id, selector: node.selector, overlap };
      })
      .filter((candidate) => candidate.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5);
    regions.push({
      id: `region-${regions.length + 1}`,
      bbox,
      changedPixels,
      severity: changedPixels / (bbox[2] * bbox[3]),
      candidates,
    });
  }
  return regions.sort((a, b) => b.changedPixels - a.changedPixels).slice(0, 100);
}

export async function compareProject(projectId: string): Promise<CompareResult> {
  await ensureStore();
  const manifest = await getProject(projectId);
  const reference = await readFile(manifest.referencePath);
  const { png, nodes, chromiumVersion } = await captureTarget(manifest);
  const metrics = comparePixels(reference, png);
  const regions = buildRegions(metrics.changedMask, metrics.width, metrics.height, nodes);
  const runId = randomUUID();
  const screenshotPath = projectArtifact(projectId, `runs/${runId}/target.png`);
  const diffPath = projectArtifact(projectId, `runs/${runId}/diff.png`);
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, png);
  // A portable binary mask is a useful first diff artifact; richer multiscale visualizations follow in the next phase.
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
    loss: {
      changedPixelRatio: metrics.changedPixelRatio,
      meanAbsoluteError: metrics.meanAbsoluteError,
    },
    screenshotPath,
    diffPath,
    regions,
    nodes,
    runtime: { browser: 'chromium', version: chromiumVersion },
    readiness: { waitUntil: 'networkidle', fontsReady: true, animationsDisabled: true },
    warnings: [
      'Phase 1 uses thresholded RGB change detection; edge and structural multiscale metrics are not implemented yet.',
    ],
  };
  await writeFile(
    projectArtifact(projectId, `runs/${runId}/result.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await writeFile(
    projectArtifact(projectId, 'latest.json'),
    `${JSON.stringify({ runId }, null, 2)}\n`,
  );
  return result;
}

export async function latestCompare(projectId: string): Promise<CompareResult> {
  const latest = JSON.parse(await readFile(projectArtifact(projectId, 'latest.json'), 'utf8')) as {
    runId: string;
  };
  return JSON.parse(
    await readFile(projectArtifact(projectId, `runs/${latest.runId}/result.json`), 'utf8'),
  ) as CompareResult;
}

export function inspectRegion(
  result: CompareResult,
  regionId: string,
): {
  schemaVersion: typeof schemaVersion;
  region: DiffRegion;
  classification: string;
  candidates: Array<{ node: DomNode; overlap: number }>;
} {
  const region = result.regions.find((candidate) => candidate.id === regionId);
  if (!region) throw new Error(`Unknown region ${regionId} in run ${result.runId}.`);
  const candidates = region.candidates.flatMap((candidate) => {
    const node = result.nodes.find((item) => item.id === candidate.nodeId);
    return node ? [{ node, overlap: candidate.overlap }] : [];
  });
  const classification = candidates.some(({ node }) => node.text)
    ? 'typography-or-layout'
    : candidates.length
      ? 'paint-or-geometry'
      : 'unknown';
  return { schemaVersion, region, classification, candidates };
}

export async function testOverrides(input: {
  projectId: string;
  selector: string;
  styles: Record<string, string>;
}): Promise<{
  schemaVersion: typeof schemaVersion;
  baselineLoss: number;
  candidateLoss: number;
  improved: boolean;
  previewPath: string;
}> {
  const manifest = await getProject(input.projectId);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: manifest.viewport.width, height: manifest.viewport.height },
      deviceScaleFactor: manifest.viewport.deviceScaleFactor,
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto(manifest.targetUrl, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.evaluate(async () => await document.fonts.ready);
    const baseline = await page.screenshot({ type: 'png', animations: 'disabled' });
    await page
      .locator(input.selector)
      .first()
      .evaluate((element, styles) => {
        for (const [property, value] of Object.entries(styles))
          (element as HTMLElement).style.setProperty(property, value, 'important');
      }, input.styles);
    const candidate = await page.screenshot({ type: 'png', animations: 'disabled' });
    const reference = await readFile(manifest.referencePath);
    const baselineLoss = comparePixels(reference, baseline).meanAbsoluteError;
    const candidateLoss = comparePixels(reference, candidate).meanAbsoluteError;
    const previewPath = projectArtifact(input.projectId, `previews/${randomUUID()}.png`);
    await mkdir(path.dirname(previewPath), { recursive: true });
    await writeFile(previewPath, candidate);
    await context.close();
    return {
      schemaVersion,
      baselineLoss,
      candidateLoss,
      improved: candidateLoss < baselineLoss,
      previewPath,
    };
  } finally {
    await browser?.close();
  }
}

export async function extractGeometry(): Promise<never> {
  throw new Error('Geometry extraction is not part of the DOM/CSS MVP yet.');
}

export async function optimize(): Promise<never> {
  throw new Error(
    'The bounded optimizer is not implemented yet; use visual.test_overrides to verify one candidate at a time.',
  );
}

export async function finalizeProject(projectId: string): Promise<{
  schemaVersion: typeof schemaVersion;
  projectId: string;
  runId: string;
  status: 'verified' | 'mismatches-found';
  summary: CompareResult['loss'];
  regionCount: number;
}> {
  const result = await latestCompare(projectId);
  return {
    schemaVersion,
    projectId,
    runId: result.runId,
    status: result.regions.length ? 'mismatches-found' : 'verified',
    summary: result.loss,
    regionCount: result.regions.length,
  };
}
