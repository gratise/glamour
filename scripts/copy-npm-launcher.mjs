import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDirectory = path.join(root, 'distribution/npm/scripts');
await mkdir(targetDirectory, { recursive: true });
await copyFile(
  path.join(root, 'plugins/glamour/scripts/start-mcp.mjs'),
  path.join(targetDirectory, 'start-mcp.mjs'),
);
