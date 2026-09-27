import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import type * as Core from './index.js';

let server: Server;
let baseUrl: string;
let referencePath: string;
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
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      '<!doctype html><html><body style="margin:0;background:white"><div id="box" style="position:absolute;left:20px;top:20px;width:40px;height:30px;background:#0055ff"></div></body></html>',
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
      targetUrl: baseUrl,
      viewport: { width: 160, height: 100, deviceScaleFactor: 1 },
    });
    const result = await core.compareProject(project.projectId);
    expect(result.schemaVersion).toBe('1');
    expect(result.regions.length).toBeGreaterThan(0);
    const inspection = core.inspectRegion(result, result.regions[0]!.id);
    expect(inspection.candidates.some(({ node }) => node.selector === '#box')).toBe(true);
    const override = await core.testOverrides({
      projectId: project.projectId,
      selector: '#box',
      styles: { 'background-color': 'rgb(255, 0, 180)' },
    });
    expect(override.improved).toBe(true);
    expect(override.candidateLoss).toBeLessThan(override.baselineLoss);
  }, 30_000);
});
