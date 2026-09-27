# glamour-mcp

Installable stdio MCP server for coding agents. Configure any MCP-compatible host with:

```json
{
  "mcpServers": {
    "glamour": {
      "command": "npx",
      "args": ["-y", "glamour-mcp@latest"]
    }
  }
}
```

Node.js 22+ and network access are required for the first launch. Glamour downloads and caches its matching runtime automatically. No Glamour repository checkout, Python, uv, or pnpm is required.

See the [main README](https://github.com/gratise/glamour#coding-agent-integration) for a ready-to-use prompt and supported workflows.
