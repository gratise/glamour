import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type * as Core from './index.js';

let server: Server;
let baseUrl: string;
let referencePath: string;
let smallReferencePath: string;
let curveReferencePath: string;
let webpReferencePath: string;
let spacingReferencePath: string;
let tempRoot: string;
let core: typeof Core;

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'glamour-test-'));
  process.env.GLAMOUR_HOME = path.join(tempRoot, 'store');
  referencePath = path.join(tempRoot, 'reference.png');
  const image = new PNG({ width: 160, height: 100 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = 255;
      if (x >= 20 && x < 60 && y >= 20 && y < 50) {
        image.data[i] = 255;
        image.data[i + 1] = 0;
        image.data[i + 2] = 180;
      }
    }
  }
  await writeFile(referencePath, PNG.sync.write(image));
  webpReferencePath = path.join(tempRoot, 'reference.webp');
  await sharp(await readFile(referencePath))
    .webp({ lossless: true })
    .toFile(webpReferencePath);
  const small = new PNG({ width: 80, height: 50 });
  for (let pixel = 0; pixel < small.width * small.height; pixel += 1) {
    small.data[pixel * 4] = 255;
    small.data[pixel * 4 + 1] = 255;
    small.data[pixel * 4 + 2] = 255;
    small.data[pixel * 4 + 3] = 255;
  }
  smallReferencePath = path.join(tempRoot, 'small-reference.png');
  await writeFile(smallReferencePath, PNG.sync.write(small));
  const curve = new PNG({ width: 160, height: 100 });
  for (let pixel = 0; pixel < curve.width * curve.height; pixel += 1) {
    curve.data[pixel * 4] = 255;
    curve.data[pixel * 4 + 1] = 255;
    curve.data[pixel * 4 + 2] = 255;
    curve.data[pixel * 4 + 3] = 255;
  }
  for (const [x1, y1, x2, y2] of [
    [15, 80, 65, 30],
    [65, 30, 145, 42],
  ] as const) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x1 + ((x2 - x1) * step) / steps);
      const y = Math.round(y1 + ((y2 - y1) * step) / steps);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= curve.width || py >= curve.height) continue;
          const index = (py * curve.width + px) * 4;
          curve.data[index] = 220;
          curve.data[index + 1] = 90;
          curve.data[index + 2] = 20;
          curve.data[index + 3] = 255;
        }
      }
    }
  }
  curveReferencePath = path.join(tempRoot, 'curve-reference.png');
  await writeFile(curveReferencePath, PNG.sync.write(curve));
  const spacing = new PNG({ width: 160, height: 100 });
  for (let pixel = 0; pixel < spacing.width * spacing.height; pixel += 1) {
    spacing.data[pixel * 4] = 255;
    spacing.data[pixel * 4 + 1] = 255;
    spacing.data[pixel * 4 + 2] = 255;
    spacing.data[pixel * 4 + 3] = 255;
  }
  for (const [left, right] of [
    [20, 40],
    [60, 80],
  ] as const) {
    for (let y = 20; y < 40; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = (y * spacing.width + x) * 4;
        spacing.data[index] = 255;
        spacing.data[index + 1] = 0;
        spacing.data[index + 2] = 180;
        spacing.data[index + 3] = 255;
      }
    }
  }
  spacingReferencePath = path.join(tempRoot, 'spacing-reference.png');
  await writeFile(spacingReferencePath, PNG.sync.write(spacing));
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/canvas') {
      response.end(
        '<!doctype html><html><body style="margin:0;background:white"><canvas id="chart" width="160" height="100"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#0055ff";c.fillRect(20,20,40,30)</script></body></html>',
      );
      return;
    }
    if (pathname === '/responsive') {
      response.end(
        '<!doctype html><html><body style="margin:0"><nav id="nav">Navigation</nav><style>@media(max-width:100px){#nav{display:none}}</style></body></html>',
      );
      return;
    }
    if (pathname === '/blank') {
      response.end('<!doctype html><html><body style="margin:0;background:white"></body></html>');
      return;
    }
    if (pathname === '/gap') {
      response.end(
        '<!doctype html><html><body style="margin:0"><div id="row" style="position:absolute;left:20px;top:20px;display:flex;gap:28px"><i style="width:20px;height:20px;background:#ff00b4"></i><i id="second" style="width:20px;height:20px;background:#ff00b4"></i></div></body></html>',
      );
      return;
    }
    const shiftMatch = /^\/shift-(x|y)-(1|2)$/.exec(pathname);
    const left =
      pathname === '/shift' ? 28 : shiftMatch?.[1] === 'x' ? 20 + Number(shiftMatch[2]) : 20;
    const top = shiftMatch?.[1] === 'y' ? 20 + Number(shiftMatch[2]) : 20;
    const width = pathname === '/width' ? 48 : 40;
    const height = pathname === '/height' ? 38 : 30;
    const color = pathname === '/paint' ? '#0055ff' : '#ff00b4';
    response.end(
      `<!doctype html><html><body style="margin:0;background:white"><div id="box" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;background:${color}"></div></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server did not bind to a TCP port.');
  baseUrl = `http://127.0.0.1:${address.port}`;
  core = await import('./index.js');
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(tempRoot, { recursive: true, force: true });
});

describe('DOM visual workflow', () => {
  it('compares a page, attributes a region, and verifies a CSS override', async () => {
    const project = await core.createProject({
      name: 'fixture',
      referencePath,
      targetUrl: `${baseUrl}/shift`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const result = await core.compareProject(project.projectId);
    expect(result.schemaVersion).toBe('1');
    expect(result.regions.length).toBeGreaterThan(0);
    expect(
      result.regions.some(
        (region) => region.classification === 'position' && region.deltas?.dx === 8,
      ),
    ).toBe(true);
    const inspection = core.inspectRegion(result, result.regions[0]!.id);
    expect(inspection.candidates.some(({ node }) => node.selector === '#box')).toBe(true);
    expect(inspection.classification).toBe('position');
    const override = await core.testOverrides({
      projectId: project.projectId,
      selector: '#box',
      styles: { 'background-color': 'rgb(255, 0, 180)', left: '20px' },
    });
    expect(override.improved).toBe(true);
    expect(override.candidateLoss).toBeLessThan(override.baselineLoss);
    const optimized = await core.optimize({
      projectId: project.projectId,
      selector: '#box',
      property: 'translateX',
      min: -8,
      max: 0,
      step: 1,
      regionId: result.regions[0]!.id,
      maxEvaluations: 24,
    });
    expect(optimized.improved).toBe(true);
    expect(optimized.bestValue).toBe(-8);
  }, 30_000);

  it('distinguishes dimension and paint errors, and produces repeatable identical renders', async () => {
    const project = await core.createProject({
      name: 'known-mismatch-fixtures',
      referencePath,
      targetUrl: `${baseUrl}/width`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const widthResult = await core.compareProject(project.projectId);
    expect(widthResult.regions.some((region) => region.classification === 'dimensions')).toBe(true);

    const paintProject = await core.createProject({
      name: 'paint-fixture',
      referencePath,
      targetUrl: `${baseUrl}/paint`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const paintResult = await core.compareProject(paintProject.projectId);
    expect(paintResult.regions.some((region) => region.classification === 'paint')).toBe(true);

    const identicalProject = await core.createProject({
      name: 'determinism-fixture',
      referencePath,
      targetUrl: `${baseUrl}/`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const first = await core.compareProject(identicalProject.projectId);
    const second = await core.compareProject(identicalProject.projectId);
    expect(Math.abs(first.loss.totalLoss - second.loss.totalLoss)).toBeLessThan(1e-6);
    expect(first.loss.totalLoss).toBeLessThan(0.002);
  }, 30_000);

  it('measures small x/y offsets, height changes, and flex-gap spacing', async () => {
    for (const [route, dx, dy] of [
      ['/shift-x-1', 1, 0],
      ['/shift-x-2', 2, 0],
      ['/shift-y-2', 0, 2],
    ] as const) {
      const project = await core.createProject({
        name: `offset-${route.slice(1)}`,
        referencePath,
        targetUrl: `${baseUrl}${route}`,
        viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
      });
      const result = await core.compareProject(project.projectId);
      expect(
        result.regions.some(
          (region) =>
            region.classification === 'position' &&
            region.deltas?.dx === dx &&
            region.deltas?.dy === dy,
        ),
      ).toBe(true);
    }

    const heightProject = await core.createProject({
      name: 'height-fixture',
      referencePath,
      targetUrl: `${baseUrl}/height`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const heightResult = await core.compareProject(heightProject.projectId);
    expect(
      heightResult.regions.some(
        (region) => region.classification === 'dimensions' && region.deltas?.dh === 8,
      ),
    ).toBe(true);

    const spacingProject = await core.createProject({
      name: 'gap-fixture',
      referencePath: spacingReferencePath,
      targetUrl: `${baseUrl}/gap`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const spacingResult = await core.compareProject(spacingProject.projectId);
    expect(
      spacingResult.regions.some(
        (region) => region.classification === 'spacing' && region.deltas?.dx === 8,
      ),
    ).toBe(true);
  }, 30_000);

  it('records Canvas draw calls with stable IDs and region-intersecting bounds', async () => {
    const project = await core.createProject({
      name: 'canvas-fixture',
      referencePath,
      targetUrl: `${baseUrl}/canvas`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const result = await core.compareProject(project.projectId);
    expect(result.canvasDrawCalls).toHaveLength(1);
    const draw = result.canvasDrawCalls[0]!;
    expect(draw.drawId).toBe('draw-1');
    expect(draw.selector).toBe('#chart');
    expect(draw.method).toBe('fillRect');
    expect(draw.bbox).toEqual([20, 20, 40, 30]);
    expect(
      result.regions.some((region) => {
        const [x, y, width, height] = region.bbox;
        const [dx, dy, dw, dh] = draw.bbox;
        return x < dx + dw && x + width > dx && y < dy + dh && y + height > dy;
      }),
    ).toBe(true);
  }, 30_000);

  it('loads a first-class multi-viewport bundle and reports derived responsive evidence', async () => {
    const bundlePath = path.join(tempRoot, 'bundle');
    await mkdir(path.join(bundlePath, 'screenshots'), { recursive: true });
    await writeFile(
      path.join(bundlePath, 'screenshots', 'desktop.png'),
      await readFile(referencePath),
    );
    await writeFile(
      path.join(bundlePath, 'screenshots', 'mobile.png'),
      await readFile(smallReferencePath),
    );
    await sharp(await readFile(referencePath))
      .extend({ bottom: 100, background: '#ffffff' })
      .png()
      .toFile(path.join(bundlePath, 'screenshots', 'full-page.png'));
    await writeFile(path.join(bundlePath, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(
      path.join(bundlePath, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1',
        name: 'responsive-fixture',
        screenshots: [
          {
            referenceId: 'desktop',
            path: 'screenshots/desktop.png',
            viewport: { width: 160, height: 100 },
            familyId: 'home',
          },
          {
            referenceId: 'mobile',
            path: 'screenshots/mobile.png',
            viewport: { width: 80, height: 50 },
            familyId: 'home',
          },
          {
            referenceId: 'full-page',
            path: 'screenshots/full-page.png',
            viewport: { width: 160, height: 100 },
            captureType: 'full-page',
          },
        ],
        assets: [
          {
            id: 'logo',
            path: 'logo.svg',
            kind: 'svg',
            provenance: { provenance: 'provided', confidence: 1 },
          },
        ],
        fonts: [{ family: 'Inter', provenance: 'provided' }],
        textBlocks: [
          { id: 'nav-label', bbox: [0, 0, 10, 10], text: 'Navigation', provenance: 'exact' },
        ],
        responsiveMappings: [{ familyId: 'home', referenceIds: ['desktop', 'mobile'] }],
      }),
    );
    const project = await core.createProject({
      name: 'responsive-fixture',
      referenceBundlePath: bundlePath,
      targetUrl: `${baseUrl}/responsive`,
    });
    expect(project.references).toHaveLength(3);
    const analysis = await core.analyzeReference(project.projectId);
    expect(analysis.summary.assetCount).toBe(1);
    expect(analysis.summary.textBlockCount).toBe(1);
    const allComparisons = await core.compareProjectAll(project.projectId);
    expect(allComparisons.results).toHaveLength(2);
    expect(allComparisons.skippedReferences).toEqual([
      expect.objectContaining({ referenceId: 'full-page' }),
    ]);
    const report = await core.finalizeProject(project.projectId);
    expect(report.references).toHaveLength(3);
    expect(
      report.references.find((item) => item.referenceId === 'full-page')?.comparisonStatus,
    ).toBe('structural-only');
    expect(report.responsive.suppliedMappings).toHaveLength(1);
    expect(report.responsive.breakpointHypotheses).toContainEqual(
      expect.objectContaining({
        familyId: 'home',
        selector: '#nav',
        betweenWidths: [80, 160],
        provenance: 'derived',
      }),
    );
  }, 30_000);

  it('extracts a synthetic open curve into browser-validated SVG/Path2D geometry', async () => {
    const project = await core.createProject({
      name: 'geometry-fixture',
      referencePath: curveReferencePath,
      targetUrl: `${baseUrl}/blank`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const comparison = await core.compareProject(project.projectId);
    const extraction = await core.extractGeometry({
      projectId: project.projectId,
      regionId: comparison.regions[0]!.id,
      mode: 'open',
      color: '#dc5a14',
      format: 'path2d',
      maxError: 1,
    });
    expect(extraction.artifactUri).toContain('/artifacts/');
    expect(extraction.path2D).toMatch(/^M /);
    expect(extraction.fitError).toBeLessThanOrEqual(1.5);
    expect(Number.isFinite(extraction.browserValidationLoss)).toBe(true);
    expect(extraction.browserValidationLoss).toBeLessThan(0.15);
    expect(
      await core.readArtifact(
        project.projectId,
        `artifacts/${path.basename(extraction.artifactPath)}`,
      ),
    ).toBeDefined();
  }, 30_000);

  it('accepts lossless WebP references while retaining the original reference hash', async () => {
    const project = await core.createProject({
      name: 'webp-fixture',
      referencePath: webpReferencePath,
      targetUrl: `${baseUrl}/`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    expect(project.referenceSha256).toMatch(/^[a-f0-9]{64}$/);
    const result = await core.compareProject(project.projectId);
    expect(result.loss.totalLoss).toBeLessThan(0.002);
  }, 30_000);

  it('migrates older schemaVersion 1 projects to the Reference Bundle defaults', async () => {
    const project = await core.createProject({
      name: 'legacy-project',
      referencePath,
      targetUrl: `${baseUrl}/`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const projectFile = path.join(
      tempRoot,
      'store',
      '.glamour',
      'projects',
      project.projectId,
      'project.json',
    );
    const legacy = JSON.parse(await readFile(projectFile, 'utf8')) as Record<string, unknown>;
    delete legacy.references;
    delete legacy.referenceBundle;
    delete legacy.browserSettings;
    await writeFile(projectFile, JSON.stringify(legacy));
    const migrated = await core.getProject(project.projectId);
    expect(migrated.references).toHaveLength(1);
    expect(migrated.references[0]?.referenceId).toBe('default');
    expect(migrated.browserSettings.fixedTime).toBe('2024-01-01T00:00:00.000Z');
  }, 30_000);
});
