import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const gitVersion = process.env.GITHUB_REF_NAME?.replace(/^v/, '');
const version = /^\d+\.\d+\.\d+$/.test(gitVersion ?? '') ? gitVersion : rootPackage.version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Set GITHUB_REF_NAME to a vMAJOR.MINOR.PATCH release tag.');
}

const target = {
  darwin: 'macos',
  linux: 'linux',
  win32: 'windows',
}[process.platform];
const architecture = { arm64: 'arm64', x64: 'x64' }[process.arch];
if (!target || !architecture || (target === 'windows' && architecture !== 'x64')) {
  throw new Error(`Unsupported release target ${process.platform}-${process.arch}.`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? `status ${code}`}.`));
    });
  });
}

async function findExecutable(command) {
  const fileNames = process.platform === 'win32' ? [`${command}.exe`, command] : [command];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const fileName of fileNames) {
      const candidate = path.join(directory, fileName);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  throw new Error(`${command} is required to package the standalone Glamour runtime.`);
}

async function packageWindowsNodeRuntime(nodeRuntime) {
  const serverDirectory = path.join(root, 'apps/mcp-server');
  const coreDirectory = path.join(root, 'packages/core');
  const serverPackage = JSON.parse(
    await readFile(path.join(serverDirectory, 'package.json'), 'utf8'),
  );
  const corePackage = JSON.parse(await readFile(path.join(coreDirectory, 'package.json'), 'utf8'));
  const dependencies = {};

  for (const [workspaceDirectory, packageData] of [
    [serverDirectory, serverPackage],
    [coreDirectory, corePackage],
  ]) {
    for (const name of Object.keys(packageData.dependencies ?? {})) {
      if (name === '@glamour/core') continue;
      const dependencyManifest = JSON.parse(
        await readFile(path.join(workspaceDirectory, 'node_modules', name, 'package.json'), 'utf8'),
      );
      const previous = dependencies[name];
      if (previous && previous !== dependencyManifest.version) {
        throw new Error(`The runtime requires conflicting versions of ${name}.`);
      }
      dependencies[name] = dependencyManifest.version;
    }
  }

  await mkdir(nodeRuntime, { recursive: true });
  await writeFile(
    path.join(nodeRuntime, 'package.json'),
    `${JSON.stringify(
      {
        name: '@glamour/mcp-runtime',
        version,
        private: true,
        type: 'module',
        packageManager: rootPackage.packageManager,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await run('pnpm', ['install', '--prod', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: nodeRuntime,
  });

  const serverDist = path.join(nodeRuntime, 'dist');
  const coreDist = path.join(nodeRuntime, 'node_modules/@glamour/core/dist');
  await mkdir(serverDist, { recursive: true });
  await mkdir(coreDist, { recursive: true });
  await copyFile(path.join(serverDirectory, 'dist/index.js'), path.join(serverDist, 'index.js'));
  await copyFile(path.join(coreDirectory, 'dist/index.js'), path.join(coreDist, 'index.js'));
  await writeFile(
    path.join(nodeRuntime, 'node_modules/@glamour/core/package.json'),
    `${JSON.stringify(corePackage, null, 2)}\n`,
  );
}

async function smokeMcpServer(serverEntry, cwd) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, GLAMOUR_HOME: path.join(stagingParent, 'mcp-smoke') },
  });
  let output = '';
  let pending = '';
  const responses = new Map();
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    pending += chunk;
    for (const line of pending.split('\n').slice(0, -1)) {
      if (!line) continue;
      const response = JSON.parse(line);
      const resolve = responses.get(response.id);
      if (resolve) {
        responses.delete(response.id);
        resolve(response);
      }
    }
    pending = pending.slice(pending.lastIndexOf('\n') + 1);
    output += chunk;
  });

  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        responses.delete(id);
        reject(new Error(`Packaged MCP runtime timed out during ${method}.\n${output}`));
      }, 15_000);
      responses.set(id, (response) => {
        clearTimeout(timeout);
        if (response.error) reject(new Error(JSON.stringify(response.error)));
        else resolve(response.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  try {
    await request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'runtime-package-smoke', version: '1.0.0' },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
    const toolResult = await request(2, 'tools/list', {});
    if (!toolResult.tools.some((tool) => tool.name === 'visual.create_project')) {
      throw new Error('The packaged MCP runtime did not expose Glamour visual tools.');
    }
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

const uvExecutable = await findExecutable('uv');
const stagingParent = await mkdtemp(path.join(os.tmpdir(), 'glamour-runtime-'));
const stagingRoot = path.join(stagingParent, 'runtime');
const nodeRuntime = path.join(stagingRoot, 'node');
const pythonProject = path.join(stagingRoot, 'python', 'glamour_cv');
const pythonRuntime = path.join(stagingRoot, 'python', 'runtime');
const archive = path.join(root, `glamour-runtime-v${version}-${target}-${architecture}.tar.gz`);

try {
  await mkdir(stagingRoot, { recursive: true });
  if (process.platform === 'win32') {
    await packageWindowsNodeRuntime(nodeRuntime);
  } else {
    await run('pnpm', ['deploy', '--filter', '@glamour/mcp-server', '--prod', nodeRuntime]);
  }
  await mkdir(pythonProject, { recursive: true });
  await cp(path.join(root, 'python/glamour_cv/src'), path.join(pythonProject, 'src'), {
    recursive: true,
  });
  await mkdir(pythonRuntime, { recursive: true });
  await run(uvExecutable, [
    'python',
    'install',
    '--install-dir',
    path.join(stagingParent, 'python'),
    '--no-bin',
    '3.12',
  ]);
  const installedPython = path.join(stagingParent, 'python');
  const pythonDistribution = (await readdir(installedPython, { withFileTypes: true })).find(
    (entry) => entry.isDirectory() && entry.name.startsWith('cpython-'),
  );
  if (!pythonDistribution) throw new Error('uv did not install a standalone CPython distribution.');
  await cp(path.join(installedPython, pythonDistribution.name), pythonRuntime, { recursive: true });
  await rm(path.join(pythonRuntime, '.temp'), { recursive: true, force: true });
  const executableName = process.platform === 'win32' ? 'python.exe' : 'python3.12';
  const pythonExecutable = path.join(
    pythonRuntime,
    process.platform === 'win32' ? executableName : 'bin',
    ...(process.platform === 'win32' ? [] : [executableName]),
  );
  await access(pythonExecutable);
  const sitePackages = execFileSync(
    pythonExecutable,
    ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'],
    { encoding: 'utf8' },
  ).trim();
  const requirements = path.join(stagingParent, 'cv-requirements.txt');
  await run(
    uvExecutable,
    [
      'export',
      '--locked',
      '--project',
      path.join(root, 'python/glamour_cv'),
      '--no-dev',
      '--no-emit-project',
      '--format',
      'requirements.txt',
      '--output-file',
      requirements,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  await mkdir(sitePackages, { recursive: true });
  await run(uvExecutable, [
    'pip',
    'install',
    '--python',
    pythonExecutable,
    '--target',
    sitePackages,
    '--requirement',
    requirements,
  ]);
  execFileSync(
    pythonExecutable,
    ['-c', 'import cv2, numpy, skimage; print("Bundled CV runtime imports passed.")'],
    { encoding: 'utf8', env: { ...process.env, PYTHONPATH: sitePackages }, stdio: 'inherit' },
  );
  const relativePythonExecutable = path.relative(stagingRoot, pythonExecutable);
  await writeFile(
    path.join(stagingRoot, 'runtime.json'),
    `${JSON.stringify({ pythonExecutable: relativePythonExecutable.split(path.sep).join('/') }, null, 2)}\n`,
  );
  await smokeMcpServer(path.join(nodeRuntime, 'dist/index.js'), nodeRuntime);
  await run('tar', ['-czf', archive, '-C', stagingRoot, '.']);
  process.stdout.write(`Created ${archive}\n`);
} finally {
  await rm(stagingParent, { recursive: true, force: true });
}
