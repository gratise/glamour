import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';

describe('Glamour MCP surface', () => {
  let client: Client | undefined;
  let tempRoot: string | undefined;
  let fixtureServer: Server | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    if (fixtureServer) {
      await new Promise<void>((resolve) => fixtureServer!.close(() => resolve()));
      fixtureServer = undefined;
    }
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('executes all eight public workflows over stdio against a deterministic fixture', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'glamour-mcp-test-'));
    fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><html><body style="margin:0;background:white"><div id="box" style="position:absolute;left:8px;top:5px;width:12px;height:12px;background:#ff00b4"></div></body></html>',
      );
    });
    await new Promise<void>((resolve) => fixtureServer!.listen(0, '127.0.0.1', resolve));
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server failed to start.');
    const referencePath = path.join(tempRoot, 'reference.png');
    const reference = new PNG({ width: 32, height: 24 });
    for (let y = 0; y < reference.height; y += 1) {
      for (let x = 0; x < reference.width; x += 1) {
        const index = (y * reference.width + x) * 4;
        const painted = x >= 5 && x < 17 && y >= 5 && y < 17;
        reference.data[index] = 255;
        reference.data[index + 1] = painted ? 0 : 255;
        reference.data[index + 2] = painted ? 180 : 255;
        reference.data[index + 3] = 255;
      }
    }
    await writeFile(referencePath, PNG.sync.write(reference));
    const transport = new StdioClientTransport({
      command: 'pnpm',
      args: ['--filter', '@glamour/mcp-server', 'dev'],
      cwd: process.cwd(),
      env: { ...process.env, GLAMOUR_HOME: tempRoot },
    });
    client = new Client({ name: 'glamour-integration-test', version: '1.0.0' });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'visual.analyze_reference',
      'visual.compare',
      'visual.create_project',
      'visual.extract_geometry',
      'visual.finalize',
      'visual.inspect',
      'visual.optimize',
      'visual.test_overrides',
    ]);
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates.length).toBeGreaterThanOrEqual(6);

    const create = await client.callTool({
      name: 'visual.create_project',
      arguments: {
        name: 'mcp-integration',
        referencePath,
        targetUrl: `http://127.0.0.1:${address.port}/`,
        viewport: { width: 32, height: 24, deviceScaleFactor: 1 },
      },
    });
    const projectId = (create.structuredContent as { projectId: string }).projectId;
    expect((create.structuredContent as { schemaVersion: string }).schemaVersion).toBe('1');
    const projectResource = await client.readResource({ uri: `visual://project/${projectId}` });
    expect(projectResource.contents.length).toBe(1);
    expect(
      (await client.callTool({ name: 'visual.analyze_reference', arguments: { projectId } }))
        .isError,
    ).not.toBe(true);

    const compared = await client.callTool({
      name: 'visual.compare',
      arguments: { projectId, referenceId: 'default' },
    });
    const run = compared.structuredContent as {
      schemaVersion: string;
      runId: string;
      topRegions: Array<{ id: string }>;
    };
    expect(run.schemaVersion).toBe('1');
    expect(
      (
        await client.readResource({
          uri: `visual://project/${projectId}/runs/${run.runId}/diff`,
        })
      ).contents.length,
    ).toBe(1);
    expect(run.topRegions.length).toBeGreaterThan(0);
    const regionId = run.topRegions[0]!.id;
    const inspected = await client.callTool({
      name: 'visual.inspect',
      arguments: { projectId, regionId, referenceId: 'default' },
    });
    expect(inspected.isError).not.toBe(true);
    const override = await client.callTool({
      name: 'visual.test_overrides',
      arguments: {
        projectId,
        referenceId: 'default',
        regionId,
        selector: '#box',
        styles: { left: '5px' },
      },
    });
    expect(override.isError).not.toBe(true);
    const optimized = await client.callTool({
      name: 'visual.optimize',
      arguments: {
        projectId,
        referenceId: 'default',
        regionId,
        selector: '#box',
        property: 'translateX',
        min: -4,
        max: 0,
        step: 1,
      },
    });
    expect(optimized.isError).not.toBe(true);
    const geometry = await client.callTool({
      name: 'visual.extract_geometry',
      arguments: {
        projectId,
        referenceId: 'default',
        regionId,
        mode: 'closed',
        color: '#ff00b4',
      },
    });
    expect(geometry.isError).not.toBe(true);
    const finalized = await client.callTool({ name: 'visual.finalize', arguments: { projectId } });
    expect(finalized.isError).not.toBe(true);
  }, 60_000);
});
