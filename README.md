# Glamour

Glamour is a local-first visual debugging tool for coding agents. It renders a web page in pinned Playwright Chromium, compares the result with a reference screenshot, ranks mismatch regions, attributes them to DOM candidates, and can verify temporary CSS changes without editing source files.

The first release focuses on ordinary DOM/CSS pages. SVG/Canvas tracing, geometry extraction, and bounded automatic optimization are later phases and are reported as unsupported until implemented.

## Requirements

- Node.js 22+
- pnpm 9.15.9
- Chromium installed with Playwright (`pnpm exec playwright install chromium`)

## Install and verify

```sh
pnpm install
pnpm exec playwright install chromium
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## CLI

```sh
pnpm --filter @glamour/cli dev -- init \
  --reference ./reference.png \
  --url http://localhost:3000 \
  --viewport 1440x900 \
  --name homepage

pnpm --filter @glamour/cli dev -- compare <project-id>
pnpm --filter @glamour/cli dev -- inspect <project-id> region-1
pnpm --filter @glamour/cli dev -- finalize <project-id>
```

Projects and immutable run outputs are written beneath `.glamour/` in the current working directory. Set `GLAMOUR_HOME` to use a different artifact root. Coordinates are CSS viewport pixels; DPR is stored separately. The input screenshot dimensions must match viewport × DPR.

## MCP server

Build the workspace and register the server in an MCP client:

```json
{
  "mcpServers": {
    "glamour": {
      "command": "node",
      "args": ["/absolute/path/to/glamour/apps/mcp-server/dist/index.js"],
      "env": { "GLAMOUR_HOME": "/path/to/your/project" }
    }
  }
}
```

Available tools: `visual.create_project`, `visual.analyze_reference`, `visual.compare`, `visual.inspect`, `visual.test_overrides`, and `visual.finalize`. `visual.extract_geometry` and `visual.optimize` are reserved contracts and currently return explicit not-implemented errors.

## Workflow

1. Create a project with a screenshot, URL, and exact viewport/DPR.
2. Run `visual.compare` or `glamour compare` to render the page and get ranked regions plus a DOM snapshot.
3. Inspect a region and use its ranked selectors and computed styles to form a candidate correction.
4. Run `visual.test_overrides` to measure the CSS change in memory.
5. Apply a confirmed correction in the source app, compare again, and finalize per viewport.

Every persisted project and result uses `schemaVersion: "1"`. Reference screenshots remain unchanged and are SHA-256 recorded in the manifest.
