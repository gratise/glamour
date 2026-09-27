import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { chromium } from 'playwright';
import type * as Core from './index.js';

let server: Server;
let baseUrl: string;
let referencePath: string;
let smallReferencePath: string;
let curveReferencePath: string;
let closedReferencePath: string;
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
  const closed = new PNG({ width: 160, height: 100 });
  for (let pixel = 0; pixel < closed.width * closed.height; pixel += 1) {
    closed.data[pixel * 4] = 255;
    closed.data[pixel * 4 + 1] = 255;
    closed.data[pixel * 4 + 2] = 255;
    closed.data[pixel * 4 + 3] = 255;
  }
  for (let y = 30; y < 70; y += 1) {
    for (let x = 60; x < 100; x += 1) {
      if ((x - 80) ** 2 + (y - 50) ** 2 > 20 ** 2) continue;
      const index = (y * closed.width + x) * 4;
      closed.data[index] = 0;
      closed.data[index + 1] = 85;
      closed.data[index + 2] = 255;
      closed.data[index + 3] = 255;
    }
  }
  closedReferencePath = path.join(tempRoot, 'closed-reference.png');
  await writeFile(closedReferencePath, PNG.sync.write(closed));
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
    if (pathname === '/canvas-path') {
      response.end(
        '<!doctype html><html><body style="margin:0;background:white"><canvas id="chart" width="160" height="100"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.strokeStyle="#dc5a14";c.lineWidth=3;c.beginPath();c.moveTo(15,80);c.bezierCurveTo(40,30,50,25,65,30);c.bezierCurveTo(95,35,120,50,145,42);c.stroke()</script></body></html>',
      );
      return;
    }
    if (pathname === '/svg-curve') {
      const controlX =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('cx') ?? '50';
      const controlY =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('cy') ?? '25';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><svg width="160" height="100" viewBox="0 0 160 100"><path id="curve" d="M15 80 C40 30 ${controlX} ${controlY} 65 30 C95 35 120 50 145 42" fill="none" stroke="#dc5a14" stroke-width="3" /></svg></body></html>`,
      );
      return;
    }
    if (pathname === '/responsive') {
      response.end(
        '<!doctype html><html><body style="margin:0"><nav id="nav">Navigation</nav><style>@media(max-width:500px){#nav{display:none}}</style></body></html>',
      );
      return;
    }
    if (pathname === '/state') {
      response.end(
        '<!doctype html><html><body style="margin:0;background:white"><button id="open" style="position:absolute;left:10px;top:10px">Open</button><section id="dialog" style="display:none;position:absolute;left:40px;top:30px;width:80px;height:50px;background:#0055ff"></section><script>document.querySelector("#open").addEventListener("click",()=>document.querySelector("#dialog").style.display="block");if(location.search.includes("open=1"))document.querySelector("#dialog").style.display="block"</script></body></html>',
      );
      return;
    }
    if (pathname === '/typography') {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
      const size = params.get('size') ?? '20';
      const weight = params.get('weight') ?? '400';
      const lineHeight = params.get('line') ?? '24';
      const spacing = params.get('spacing') ?? '0';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><p id="copy" style="position:absolute;left:10px;top:10px;width:140px;margin:0;font-family:Arial,sans-serif;font-size:${size}px;font-weight:${weight};line-height:${lineHeight}px;letter-spacing:${spacing}px;color:#111">Visual fidelity matters</p></body></html>`,
      );
      return;
    }
    if (pathname === '/effects') {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
      const radius = params.get('radius') ?? '0';
      const shadow = params.get('shadow') ?? 'none';
      const opacity = params.get('opacity') ?? '1';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><div id="panel" style="position:absolute;left:20px;top:20px;width:80px;height:50px;background:#ff00b4;border-radius:${radius}px;box-shadow:${shadow};opacity:${opacity}"></div></body></html>`,
      );
      return;
    }
    if (pathname === '/gradient') {
      const end =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('end') ?? '#ff00b4';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><div id="gradient" style="position:absolute;left:20px;top:20px;width:80px;height:50px;background:linear-gradient(90deg,#ff00b4 0%,${end} 100%)"></div></body></html>`,
      );
      return;
    }
    if (pathname === '/asset') {
      response.end(
        '<!doctype html><html><body style="margin:0;background:white"><img id="hero" alt="" src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2740%27 height=%2730%27%3E%3Crect width=%2740%27 height=%2730%27 fill=%27%230055ff%27/%3E%3C/svg%3E" style="position:absolute;left:20px;top:20px;width:40px;height:30px" /></body></html>',
      );
      return;
    }
    if (pathname === '/overlap') {
      const color =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('top') ?? '#ff00b4';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><div id="under" style="position:absolute;left:20px;top:20px;width:40px;height:30px;background:#00aa00;z-index:1"></div><div id="top" style="position:absolute;left:20px;top:20px;width:40px;height:30px;background:${color};z-index:2"></div></body></html>`,
      );
      return;
    }
    if (pathname === '/nested-padding') {
      const padding =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('padding') ?? '10';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><div id="outer" style="position:absolute;left:20px;top:20px;width:120px;height:60px;padding:${padding}px"><div id="inner" style="width:20px;height:20px;background:#ff00b4"></div></div></body></html>`,
      );
      return;
    }
    if (pathname === '/border') {
      const border =
        new URL(request.url ?? '/', 'http://localhost').searchParams.get('value') ?? 'none';
      response.end(
        `<!doctype html><html><body style="margin:0;background:white"><div id="panel" style="position:absolute;left:20px;top:20px;width:80px;height:50px;box-sizing:border-box;background:#ff00b4;border:${border}"></div></body></html>`,
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
  it('replays reference-specific URLs and interactions for interactive states', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 160, height: 100 } });
    await page.goto(`${baseUrl}/state?open=1`);
    const openStatePath = path.join(tempRoot, 'dialog-open.png');
    await writeFile(openStatePath, await page.screenshot({ type: 'png' }));
    await page.goto(`${baseUrl}/state`);
    const defaultStatePath = path.join(tempRoot, 'dialog-closed.png');
    await writeFile(defaultStatePath, await page.screenshot({ type: 'png' }));
    await browser.close();

    const bundlePath = path.join(tempRoot, 'states-bundle');
    await mkdir(path.join(bundlePath, 'screenshots'), { recursive: true });
    await writeFile(
      path.join(bundlePath, 'screenshots', 'dialog-closed.png'),
      await readFile(defaultStatePath),
    );
    await writeFile(
      path.join(bundlePath, 'screenshots', 'dialog-open.png'),
      await readFile(openStatePath),
    );
    await writeFile(
      path.join(bundlePath, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1',
        screenshots: [
          {
            referenceId: 'closed',
            path: 'screenshots/dialog-closed.png',
            viewport: { width: 160, height: 100 },
            state: 'closed',
            targetUrl: `${baseUrl}/state`,
          },
          {
            referenceId: 'open',
            path: 'screenshots/dialog-open.png',
            viewport: { width: 160, height: 100 },
            state: 'dialog-open',
            targetUrl: `${baseUrl}/state`,
            actions: [{ type: 'click', selector: '#open' }],
          },
        ],
      }),
    );
    const project = await core.createProject({
      name: 'interactive-states',
      referenceBundlePath: bundlePath,
      targetUrl: `${baseUrl}/blank`,
    });
    const closed = await core.compareProject(project.projectId, 'closed');
    const opened = await core.compareProject(project.projectId, 'open');
    expect(closed.loss.totalLoss).toBeLessThan(0.002);
    expect(opened.loss.totalLoss).toBeLessThan(0.005);

    const override = await core.testOverrides({
      projectId: project.projectId,
      referenceId: 'open',
      selector: '#dialog',
      styles: { background: '#0055ff' },
    });
    expect(override.baselineLoss).toBeLessThan(0.005);
  }, 30_000);

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
    expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));
  }, 30_000);

  it('classifies isolated typography, radius, and shadow fixture errors', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 160, height: 100 } });
    const typographyReference = path.join(tempRoot, 'typography-reference.png');
    await page.goto(`${baseUrl}/typography`);
    await writeFile(typographyReference, await page.screenshot({ type: 'png' }));
    const effectsReference = path.join(tempRoot, 'effects-reference.png');
    await page.goto(`${baseUrl}/effects`);
    await writeFile(effectsReference, await page.screenshot({ type: 'png' }));
    const gradientReference = path.join(tempRoot, 'gradient-reference.png');
    await page.goto(`${baseUrl}/gradient?end=%23ff00b4`);
    await writeFile(gradientReference, await page.screenshot({ type: 'png' }));
    await browser.close();

    for (const query of ['?size=22', '?weight=700', '?line=28', '?spacing=1.5']) {
      const project = await core.createProject({
        name: `typography-${query.slice(1).replace('=', '-')}`,
        referencePath: typographyReference,
        targetUrl: `${baseUrl}/typography${query}`,
        viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
      });
      const result = await core.compareProject(project.projectId);
      expect(
        result.regions.some((region) => region.classification === 'typography'),
        `${query}: ${JSON.stringify(result.regions.map(({ classification, candidates }) => ({ classification, candidates })))}`,
      ).toBe(true);
      expect(result.regions.some((region) => region.candidates[0]?.selector === '#copy')).toBe(
        true,
      );
    }

    for (const [query, classification] of [
      ['?radius=12', 'border-radius'],
      ['?shadow=0px%204px%208px%20rgba(0,0,0,0.4)', 'shadow'],
      ['?opacity=0.5', 'paint'],
    ] as const) {
      const project = await core.createProject({
        name: `effect-${classification}`,
        referencePath: effectsReference,
        targetUrl: `${baseUrl}/effects${query}`,
        viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
      });
      const result = await core.compareProject(project.projectId);
      expect(
        result.regions.some((region) => region.classification === classification),
        `${classification}: ${JSON.stringify(result.regions.map(({ classification: kind, candidates }) => ({ classification: kind, candidates })))}`,
      ).toBe(true);
    }

    const gradientProject = await core.createProject({
      name: 'gradient-stop-fixture',
      referencePath: gradientReference,
      targetUrl: `${baseUrl}/gradient?end=%230055ff`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const gradientResult = await core.compareProject(gradientProject.projectId);
    expect(gradientResult.regions.some((region) => region.classification === 'paint')).toBe(true);
  }, 60_000);

  it('attributes wrong image assets and overlapping paint to the visible top element', async () => {
    const assetProject = await core.createProject({
      name: 'wrong-asset-fixture',
      referencePath,
      targetUrl: `${baseUrl}/asset`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const assetResult = await core.compareProject(assetProject.projectId);
    expect(assetResult.regions.some((region) => region.classification === 'wrong-asset')).toBe(
      true,
    );
    expect(assetResult.regions[0]?.candidates[0]?.selector).toBe('#hero');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 160, height: 100 } });
    await page.goto(`${baseUrl}/overlap?top=%23ff00b4`);
    const overlapReference = path.join(tempRoot, 'overlap-reference.png');
    await writeFile(overlapReference, await page.screenshot({ type: 'png' }));
    await browser.close();
    const overlapProject = await core.createProject({
      name: 'overlap-z-index-fixture',
      referencePath: overlapReference,
      targetUrl: `${baseUrl}/overlap?top=%230055ff`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const overlapResult = await core.compareProject(overlapProject.projectId);
    expect(overlapResult.regions[0]?.candidates[0]?.selector).toBe('#top');
  }, 60_000);

  it('classifies nested padding shifts as spacing and detects border mismatches', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 160, height: 100 } });
    await page.goto(`${baseUrl}/nested-padding?padding=10`);
    const nestedReference = path.join(tempRoot, 'nested-padding-reference.png');
    await writeFile(nestedReference, await page.screenshot({ type: 'png' }));
    await page.goto(`${baseUrl}/border?value=none`);
    const borderReference = path.join(tempRoot, 'border-reference.png');
    await writeFile(borderReference, await page.screenshot({ type: 'png' }));
    await browser.close();

    const paddingProject = await core.createProject({
      name: 'nested-padding-fixture',
      referencePath: nestedReference,
      targetUrl: `${baseUrl}/nested-padding?padding=18`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const paddingResult = await core.compareProject(paddingProject.projectId);
    expect(
      paddingResult.regions.some((region) => region.classification === 'spacing'),
      JSON.stringify(paddingResult.regions),
    ).toBe(true);

    const borderProject = await core.createProject({
      name: 'border-fixture',
      referencePath: borderReference,
      targetUrl: `${baseUrl}/border?value=2px%20solid%20%230055ff`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const borderResult = await core.compareProject(borderProject.projectId);
    expect(
      borderResult.regions.some((region) => region.classification === 'border'),
      JSON.stringify(borderResult.regions),
    ).toBe(true);
  }, 60_000);

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

    const pathProject = await core.createProject({
      name: 'canvas-path-fixture',
      referencePath: curveReferencePath,
      targetUrl: `${baseUrl}/canvas-path`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const pathResult = await core.compareProject(pathProject.projectId);
    const stroke = pathResult.canvasDrawCalls.find((call) => call.method === 'stroke');
    expect(stroke?.commands.map((command) => command.method)).toContain('bezierCurveTo');
    expect(
      pathResult.regions.some((region) => {
        const [x, y, width, height] = region.bbox;
        const [dx, dy, dw, dh] = stroke!.bbox;
        return x < dx + dw && x + width > dx && y < dy + dh && y + height > dy;
      }),
    ).toBe(true);
  }, 30_000);

  it('attributes an SVG Bézier control-point change to captured path geometry', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 160, height: 100 } });
    await page.goto(`${baseUrl}/svg-curve?cx=50&cy=25`);
    const svgReference = path.join(tempRoot, 'svg-reference.png');
    await writeFile(svgReference, await page.screenshot({ type: 'png' }));
    await browser.close();
    const project = await core.createProject({
      name: 'svg-control-point-fixture',
      referencePath: svgReference,
      targetUrl: `${baseUrl}/svg-curve?cx=54&cy=20`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const result = await core.compareProject(project.projectId);
    const inspected = core.inspectRegion(result, result.regions[0]!.id);
    expect(inspected.classification).toBe('geometry');
    expect(inspected.candidates.some(({ node }) => node.svg?.pathData?.includes('C'))).toBe(true);
  }, 30_000);

  it('loads a first-class multi-viewport bundle and reports derived responsive evidence', async () => {
    const bundlePath = path.join(tempRoot, 'bundle');
    const screenshotsPath = path.join(bundlePath, 'screenshots');
    await mkdir(screenshotsPath, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    for (const [id, width, height] of [
      ['mobile', 390, 844],
      ['tablet', 768, 1024],
      ['desktop', 1440, 900],
    ] as const) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(`${baseUrl}/responsive`);
      await writeFile(path.join(screenshotsPath, `${id}.png`), await page.screenshot());
      await page.close();
    }
    await browser.close();
    await sharp(await readFile(path.join(screenshotsPath, 'desktop.png')))
      .extend({ bottom: 100, background: '#ffffff' })
      .png()
      .toFile(path.join(screenshotsPath, 'full-page.png'));
    await writeFile(path.join(bundlePath, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(
      path.join(bundlePath, 'manifest.json'),
      JSON.stringify({
        schemaVersion: '1',
        name: 'responsive-fixture',
        screenshots: [
          {
            referenceId: 'mobile',
            path: 'screenshots/mobile.png',
            viewport: { width: 390, height: 844 },
            familyId: 'home',
          },
          {
            referenceId: 'tablet',
            path: 'screenshots/tablet.png',
            viewport: { width: 768, height: 1024 },
            familyId: 'home',
          },
          {
            referenceId: 'desktop',
            path: 'screenshots/desktop.png',
            viewport: { width: 1440, height: 900 },
            familyId: 'home',
          },
          {
            referenceId: 'full-page',
            path: 'screenshots/full-page.png',
            viewport: { width: 1440, height: 900 },
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
        scene: [
          {
            id: 'measured-nav',
            kind: 'text',
            bbox: [0, 0, 100, 20],
            measurement: {
              bbox: [0, 0, 100, 20],
              provenance: 'measured',
              confidence: 0.95,
            },
            interpretation: {
              role: 'primary-navigation',
              provenance: 'estimated',
              confidence: 0.6,
            },
          },
        ],
        responsiveMappings: [
          {
            familyId: 'home',
            referenceIds: ['mobile', 'tablet', 'desktop'],
            nodeMappings: [
              { identity: 'primary-navigation', referenceId: 'mobile', nodeId: '#nav' },
              { identity: 'primary-navigation', referenceId: 'tablet', nodeId: '#nav' },
              { identity: 'primary-navigation', referenceId: 'desktop', nodeId: '#nav' },
            ],
          },
        ],
      }),
    );
    const project = await core.createProject({
      name: 'responsive-fixture',
      referenceBundlePath: bundlePath,
      targetUrl: `${baseUrl}/responsive`,
    });
    expect(project.references).toHaveLength(4);
    const analysis = await core.analyzeReference(project.projectId);
    expect(analysis.summary.assetCount).toBe(1);
    expect(analysis.summary.textBlockCount).toBe(1);
    expect(analysis.highConfidenceFacts).toContainEqual(
      expect.objectContaining({
        category: 'measurement',
        id: 'measured-nav',
        provenance: 'measured',
      }),
    );
    expect(analysis.highConfidenceFacts.some((fact) => fact.category === 'interpretation')).toBe(
      false,
    );
    expect(analysis.fullPageCaptures).toEqual([
      expect.objectContaining({
        referenceId: 'full-page',
        bitmap: { width: 1440, height: 1000 },
        contentSizeCss: { width: 1440, height: 1000 },
        provenance: 'measured',
      }),
    ]);
    const allComparisons = await core.compareProjectAll(project.projectId);
    expect(allComparisons.results).toHaveLength(3);
    expect(allComparisons.skippedReferences).toEqual([
      expect.objectContaining({ referenceId: 'full-page' }),
    ]);
    const report = await core.finalizeProject(project.projectId);
    expect(report.references).toHaveLength(4);
    expect(
      report.references.find((item) => item.referenceId === 'full-page')?.comparisonStatus,
    ).toBe('structural-only');
    expect(report.responsive.suppliedMappings).toHaveLength(1);
    expect(report.responsive.observedNodeChanges).toContainEqual(
      expect.objectContaining({
        identity: 'primary-navigation',
        selector: '#nav',
        observations: expect.arrayContaining([
          expect.objectContaining({ referenceId: 'mobile', visible: false }),
          expect.objectContaining({ referenceId: 'desktop', visible: true }),
        ]),
      }),
    );
    expect(report.responsive.breakpointHypotheses).toContainEqual(
      expect.objectContaining({
        familyId: 'home',
        selector: '#nav',
        betweenWidths: [390, 768],
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
  }, 60_000);

  it('extracts closed geometry as a browser-validated closed contour', async () => {
    const project = await core.createProject({
      name: 'closed-geometry-fixture',
      referencePath: closedReferencePath,
      targetUrl: `${baseUrl}/blank`,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const comparison = await core.compareProject(project.projectId);
    const extraction = await core.extractGeometry({
      projectId: project.projectId,
      regionId: comparison.regions[0]!.id,
      mode: 'closed',
      color: '#0055ff',
      format: 'svg',
      maxError: 1,
    });
    const artifact = await core.readArtifact(
      project.projectId,
      `artifacts/${path.basename(extraction.artifactPath)}`,
    );
    expect(artifact.bytes.toString('utf8')).toMatch(/Z/);
    expect(extraction.browserValidationLoss).toBeLessThan(0.15);
  }, 60_000);

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
