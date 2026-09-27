#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  await readFile(path.join(packageDirectory, '../package.json'), 'utf8'),
);

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(`${packageJson.version}\n`);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    'Glamour MCP server\n\nConfigure your MCP client to launch `glamour-mcp` over stdio.\nThe matching runtime is downloaded automatically on first start.\n\nOptions: --version, --help\n',
  );
  process.exit(0);
}

process.env.GLAMOUR_RUNTIME_VERSION ??= packageJson.version;
process.env.GLAMOUR_DATA_DIR ??= path.join(os.homedir(), '.glamour');
await import('../scripts/start-mcp.mjs');
