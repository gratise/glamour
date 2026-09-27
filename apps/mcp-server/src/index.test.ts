import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('Glamour MCP surface', () => {
  let client: Client | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it('serves all eight public workflows over stdio', async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'glamour-mcp-test-'));
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
  }, 30_000);
});
