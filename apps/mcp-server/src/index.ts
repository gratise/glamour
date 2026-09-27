import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  compareProject,
  createProject,
  extractGeometry,
  finalizeProject,
  getProject,
  inspectRegion,
  latestCompare,
  optimize,
  testOverrides,
  viewportSchema,
} from '@glamour/core';

const server = new McpServer({ name: 'glamour', version: '0.1.0' });
const projectId = z.string().uuid();
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

server.registerTool(
  'visual.create_project',
  {
    description: 'Create a persistent Glamour project from a reference screenshot and target URL.',
    inputSchema: z.object({
      name: z.string().min(1).default('glamour-project'),
      referencePath: z.string(),
      targetUrl: z.string().url(),
      viewport: viewportSchema,
    }),
  },
  async (input) => json(await createProject(input)),
);

server.registerTool(
  'visual.analyze_reference',
  {
    description:
      'Read project metadata and reference image provenance before rendering a comparison.',
    inputSchema: z.object({ projectId }),
  },
  async ({ projectId: id }) => json(await getProject(id)),
);

server.registerTool(
  'visual.compare',
  {
    description:
      'Render the target URL in pinned Playwright Chromium and compare against the project reference.',
    inputSchema: z.object({ projectId }),
  },
  async ({ projectId: id }) => json(await compareProject(id)),
);

server.registerTool(
  'visual.inspect',
  {
    description:
      'Inspect a mismatch region from the latest comparison and retrieve its ranked DOM candidates.',
    inputSchema: z.object({ projectId, regionId: z.string().min(1) }),
  },
  async ({ projectId: id, regionId }) => json(inspectRegion(await latestCompare(id), regionId)),
);

server.registerTool(
  'visual.extract_geometry',
  {
    description:
      'Extract a vector geometry artifact for a region (currently unavailable in the DOM/CSS MVP).',
    inputSchema: z.object({
      projectId,
      regionId: z.string(),
      format: z.enum(['svg', 'path2d']).default('svg'),
    }),
  },
  async () => json(await extractGeometry()),
);

server.registerTool(
  'visual.test_overrides',
  {
    description:
      'Apply temporary CSS overrides in the browser and measure whether they reduce visual loss.',
    inputSchema: z.object({
      projectId,
      selector: z.string().min(1),
      styles: z.record(z.string(), z.string()),
    }),
  },
  async (input) => json(await testOverrides(input)),
);

server.registerTool(
  'visual.optimize',
  {
    description:
      'Find a bounded CSS parameter adjustment (not available yet; test overrides supports manual candidates).',
    inputSchema: z.object({
      projectId,
      selector: z.string(),
      property: z.enum([
        'translateX',
        'translateY',
        'width',
        'height',
        'fontSize',
        'lineHeight',
        'letterSpacing',
        'borderRadius',
        'opacity',
      ]),
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
    }),
  },
  async () => json(await optimize()),
);

server.registerTool(
  'visual.finalize',
  {
    description: 'Summarize the latest comparison by remaining mismatch regions and loss metrics.',
    inputSchema: z.object({ projectId }),
  },
  async ({ projectId: id }) => json(await finalizeProject(id)),
);

await server.connect(new StdioServerTransport());
console.error('glamour MCP server running over stdio');
