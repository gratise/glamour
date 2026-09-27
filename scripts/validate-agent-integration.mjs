import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = path.join(root, 'plugins/glamour');
const manifest = JSON.parse(
  await readFile(path.join(pluginPath, '.codex-plugin/plugin.json'), 'utf8'),
);
const mcpPath = path.join(pluginPath, '.mcp.json');
const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
const portableManifest = JSON.parse(await readFile(path.join(pluginPath, 'plugin.json'), 'utf8'));
const portableMcp = JSON.parse(await readFile(path.join(pluginPath, 'mcp.json'), 'utf8'));
const marketplace = JSON.parse(
  await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'),
);
const npmPackage = JSON.parse(
  await readFile(path.join(root, 'distribution/npm/package.json'), 'utf8'),
);
const registryServer = JSON.parse(
  await readFile(path.join(root, 'distribution/npm/server.json'), 'utf8'),
);
const entry = marketplace.plugins.find((candidate) => candidate.name === manifest.name);
assert(entry, 'The Glamour plugin must be discoverable from the repository marketplace.');
assert.equal(entry.source.source, 'local');
assert.equal(
  path.resolve(root, entry.source.path),
  pluginPath,
  'The marketplace entry must resolve to the plugin directory.',
);
assert.equal(entry.policy.installation, 'AVAILABLE');
assert.equal(entry.policy.authentication, 'ON_INSTALL');
assert.equal(manifest.skills, './skills/');
assert.equal(manifest.mcpServers, './.mcp.json');
assert.equal(portableManifest.name, manifest.name);
assert.equal(portableManifest.version, manifest.version);
assert.equal(portableManifest.mcpServers, './mcp.json');
assert.deepEqual(portableMcp, mcp, 'Codex and portable MCP wiring must stay in sync.');
assert(mcp.mcpServers.glamour, 'The installable plugin must register the Glamour MCP server.');
assert.equal(mcp.mcpServers.glamour.command, 'node');
assert.deepEqual(mcp.mcpServers.glamour.args, ['${PLUGIN_ROOT}/scripts/start-mcp.mjs']);
assert.match(mcp.mcpServers.glamour.env.GLAMOUR_RUNTIME_VERSION, /^\d+\.\d+\.\d+$/);
await readFile(path.join(pluginPath, 'scripts/start-mcp.mjs'));
assert.equal(npmPackage.name, 'glamour-mcp');
assert.equal(npmPackage.version, manifest.version);
assert.equal(npmPackage.mcpName, registryServer.name);
assert.equal(registryServer.version, manifest.version);
assert.equal(registryServer.packages[0].identifier, npmPackage.name);
assert.equal(registryServer.packages[0].transport.type, 'stdio');
assert.deepEqual(npmPackage.bin, { 'glamour-mcp': './bin/glamour-mcp.mjs' });
await readFile(path.join(root, 'distribution/npm/bin/glamour-mcp.mjs'));
const packedPackage = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: path.join(root, 'distribution/npm'),
    encoding: 'utf8',
  }),
)[0];
const packagedFiles = packedPackage.files.map((file) => file.path);
assert(packagedFiles.includes('bin/glamour-mcp.mjs'));
assert(packagedFiles.includes('scripts/start-mcp.mjs'));
assert.equal(
  packedPackage.bundled.length,
  0,
  'The npm launcher must not ship development dependencies.',
);

const skillPath = path.join(pluginPath, 'skills/glamour-site-builder/SKILL.md');
const skill = await readFile(skillPath, 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert(frontmatter, 'The agent skill must have YAML frontmatter.');
assert.match(frontmatter[1], /^name:\s*glamour-site-builder\s*$/m);
assert.match(frontmatter[1], /^description:\s*\S/m);
assert.match(skill, /You are the coding agent and author of the application/);
assert.match(skill, /Run the visual correction loop/);
assert.match(skill, /MCP when connected/);

stdout.write('Glamour coding-agent integration is valid.\n');
