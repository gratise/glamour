import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  compareProject,
  compareProjectAll,
  createProject,
  analyzeReference,
  extractGeometry,
  finalizeProject,
  getProject,
  getReferenceIR,
  getRegion,
  getRun,
  getTargetIR,
  inspectRegion,
  latestCompare,
  optimize,
  readArtifact,
  testOverrides,
  viewportSchema,
  browserSettingsSchema,
} from '@glamour/core';

const server = new McpServer({ name: 'glamour', version: '0.1.0' });
const projectId = z.string().uuid();
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
type DeepDefined<T> = T extends readonly (infer U)[]
  ? DeepDefined<U>[]
  : T extends object
    ? {
        [K in Exclude<keyof T, OptionalKeys<T>>]: DeepDefined<Exclude<T[K], undefined>>;
      } & { [K in OptionalKeys<T>]?: DeepDefined<Exclude<T[K], undefined>> }
    : Exclude<T, undefined>;
const cleanUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, cleanUndefined(item)]),
    );
  }
  return value;
};
const withoutUndefined = <T extends object>(value: T): DeepDefined<T> =>
  cleanUndefined(value) as DeepDefined<T>;

server.registerTool(
  'visual.create_project',
  {
    description: 'Create a persistent Glamour project from a reference screenshot and target URL.',
    inputSchema: z
      .object({
        name: z.string().min(1).default('glamour-project'),
        referencePath: z.string().optional(),
        referenceBundlePath: z.string().optional(),
        targetUrl: z.string().url(),
        viewport: viewportSchema.optional(),
        browserSettings: browserSettingsSchema.partial().optional(),
        targetConfig: z
          .object({
            repositoryRoot: z.string().optional(),
            route: z.string().optional(),
            framework: z.string().optional(),
            devCommand: z.string().optional(),
            buildCommand: z.string().optional(),
            designTokens: z.record(z.string(), z.string()).optional(),
          })
          .optional(),
      })
      .refine((input) => input.referencePath || input.referenceBundlePath, {
        message: 'Provide referencePath or referenceBundlePath.',
      }),
  },
  async (input) => json(await createProject(withoutUndefined(input))),
);

server.registerTool(
  'visual.analyze_reference',
  {
    description:
      'Read project metadata and reference image provenance before rendering a comparison.',
    inputSchema: z.object({ projectId }),
  },
  async ({ projectId: id }) => json(await analyzeReference(id)),
);

server.registerTool(
  'visual.compare',
  {
    description:
      'Render the target URL in pinned Playwright Chromium and compare against the project reference.',
    inputSchema: z.object({ projectId, referenceId: z.string().optional() }),
  },
  async ({ projectId: id, referenceId }) => {
    if (referenceId) {
      const result = await compareProject(id, referenceId);
      return json({
        schemaVersion: result.schemaVersion,
        projectId: id,
        runId: result.runId,
        referenceId,
        loss: result.loss,
        regionCount: result.regions.length,
        topRegions: result.regions.slice(0, 20),
        screenshotPath: result.screenshotPath,
        diffPath: result.diffPath,
        warnings: result.warnings,
      });
    }
    return json(await compareProjectAll(id));
  },
);

server.registerTool(
  'visual.inspect',
  {
    description:
      'Inspect a mismatch region from the latest comparison and retrieve its ranked DOM candidates.',
    inputSchema: z.object({
      projectId,
      regionId: z.string().min(1),
      referenceId: z.string().optional(),
    }),
  },
  async ({ projectId: id, regionId, referenceId }) => {
    const result = await latestCompare(id, referenceId);
    const inspected = inspectRegion(result, regionId);
    const drawCalls = result.canvasDrawCalls.filter((draw) => {
      const [x, y, width, height] = draw.bbox;
      const [rx, ry, rw, rh] = inspected.region.bbox;
      return x < rx + rw && x + width > rx && y < ry + rh && y + height > ry;
    });
    return json({ ...inspected, runId: result.runId, canvasDrawCalls: drawCalls });
  },
);

server.registerTool(
  'visual.extract_geometry',
  {
    description: 'Extract and browser-validate SVG geometry from a reference region.',
    inputSchema: z.object({
      projectId,
      regionId: z.string(),
      referenceId: z.string().optional(),
      mode: z.enum(['open', 'closed']).default('open'),
      color: z.string().optional(),
      threshold: z.number().min(1).max(255).optional(),
      maxError: z.number().positive().max(20).optional(),
      format: z.enum(['svg', 'path2d']).default('svg'),
    }),
  },
  async ({ format, ...input }) =>
    json(await extractGeometry(withoutUndefined({ ...input, format }))),
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
      svgAttributes: z.record(z.string(), z.string()).optional(),
      referenceId: z.string().optional(),
      regionId: z.string().optional(),
    }),
  },
  async (input) => json(await testOverrides(withoutUndefined(input))),
);

server.registerTool(
  'visual.optimize',
  {
    description:
      'Search a bounded CSS parameter range using coarse-to-fine browser rendering and a strict render budget.',
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
      referenceId: z.string().optional(),
      regionId: z.string().optional(),
      maxEvaluations: z.number().int().positive().max(60).optional(),
      timeoutMs: z.number().int().positive().max(120000).optional(),
    }),
  },
  async (input) => json(await optimize(withoutUndefined(input))),
);

server.registerTool(
  'visual.finalize',
  {
    description: 'Summarize the latest comparison by remaining mismatch regions and loss metrics.',
    inputSchema: z.object({ projectId }),
  },
  async ({ projectId: id }) => json(await finalizeProject(id)),
);

const projectResource = (
  name: string,
  uriTemplate: string,
  title: string,
  reader: (projectId: string, variables: Record<string, string>) => Promise<string>,
) => {
  server.registerResource(
    name,
    new ResourceTemplate(uriTemplate, { list: undefined }),
    { title, mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: await reader(String(variables.projectId), variables as Record<string, string>),
        },
      ],
    }),
  );
};

projectResource(
  'visual-project',
  'visual://project/{projectId}',
  'Glamour project manifest',
  async (id) => JSON.stringify(await getProject(id)),
);
projectResource(
  'visual-reference-ir',
  'visual://project/{projectId}/rir/{referenceId}',
  'Reference Visual IR',
  async (id, variables) => JSON.stringify(await getReferenceIR(id, variables.referenceId!)),
);
projectResource(
  'visual-target-ir',
  'visual://project/{projectId}/tir/latest',
  'Latest Target Visual IR',
  async (id) => JSON.stringify(await getTargetIR(id)),
);
server.registerResource(
  'visual-run-diff',
  new ResourceTemplate('visual://project/{projectId}/runs/{runId}/diff', { list: undefined }),
  { title: 'Visual difference mask', mimeType: 'image/png' },
  async (uri, variables) => {
    const result = await getRun(String(variables.projectId), String(variables.runId));
    const artifact = await readArtifact(
      String(variables.projectId),
      'runs/' + result.runId + '/diff.png',
    );
    return {
      contents: [
        { uri: uri.href, mimeType: artifact.mimeType, blob: artifact.bytes.toString('base64') },
      ],
    };
  },
);
projectResource(
  'visual-run-region',
  'visual://project/{projectId}/runs/{runId}/region/{regionId}',
  'Visual mismatch region',
  async (id, variables) =>
    JSON.stringify(await getRegion(id, variables.runId!, variables.regionId!)),
);
server.registerResource(
  'visual-artifact',
  new ResourceTemplate('visual://project/{projectId}/artifacts/{artifact}', { list: undefined }),
  { title: 'Glamour artifact', mimeType: 'application/octet-stream' },
  async (uri, variables) => {
    const artifact = await readArtifact(
      String(variables.projectId),
      'artifacts/' + String(variables.artifact),
    );
    return {
      contents: [
        { uri: uri.href, mimeType: artifact.mimeType, blob: artifact.bytes.toString('base64') },
      ],
    };
  },
);
projectResource(
  'visual-final-report',
  'visual://project/{projectId}/report/final',
  'Glamour final report',
  async (id) => JSON.stringify(await finalizeProject(id)),
);

await server.connect(new StdioServerTransport());
console.error('glamour MCP server running over stdio');
