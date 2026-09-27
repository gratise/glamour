import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';

const owner = 'gratise';
const repository = 'glamour';
const version = process.env.GLAMOUR_RUNTIME_VERSION;
const dataDirectory = process.env.GLAMOUR_DATA_DIR ?? path.join(os.homedir(), '.glamour');

function platformName() {
  const platform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
  const architecture = { arm64: 'arm64', x64: 'x64' }[process.arch];
  if (!platform || !architecture || (platform === 'windows' && architecture !== 'x64')) {
    throw new Error(
      `Glamour does not publish an MCP runtime for ${process.platform}-${process.arch}.`,
    );
  }
  return `${platform}-${architecture}`;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getInstalledRuntime(runtimeRoot) {
  const serverEntry = path.join(runtimeRoot, 'node', 'dist', 'index.js');
  const manifestPath = path.join(runtimeRoot, 'runtime.json');
  if (!(await exists(serverEntry)) || !(await exists(manifestPath))) return undefined;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (typeof manifest.pythonExecutable !== 'string' || path.isAbsolute(manifest.pythonExecutable)) {
    throw new Error('The Glamour runtime manifest does not contain a valid Python path.');
  }
  const pythonExecutable = path.resolve(runtimeRoot, manifest.pythonExecutable);
  if (
    !pythonExecutable.startsWith(`${runtimeRoot}${path.sep}`) ||
    !(await exists(pythonExecutable))
  ) {
    throw new Error('The Glamour runtime manifest points to an invalid Python executable.');
  }
  const pythonSitePackages = execFileSync(
    pythonExecutable,
    ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'],
    { encoding: 'utf8' },
  ).trim();
  return { runtimeRoot, serverEntry, pythonExecutable, pythonSitePackages };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal ?? `status ${code}`}.`));
    });
  });
}

async function installRuntime() {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('The Glamour plugin has no valid pinned runtime version.');
  }
  const targetPlatform = platformName();
  const runtimeRoot = path.join(dataDirectory, 'runtime', `v${version}-${targetPlatform}`);
  const installed = await getInstalledRuntime(runtimeRoot);
  if (installed) return installed;

  await mkdir(path.dirname(runtimeRoot), { recursive: true });
  const temporaryRoot = `${runtimeRoot}.installing-${process.pid}`;
  const archivePath = `${temporaryRoot}.tar.gz`;
  await rm(temporaryRoot, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await mkdir(temporaryRoot, { recursive: true });
  const asset = `glamour-runtime-v${version}-${targetPlatform}.tar.gz`;
  const releaseBaseUrl =
    process.env.GLAMOUR_RELEASE_BASE_URL ??
    `https://github.com/${owner}/${repository}/releases/download/v${version}`;
  const url = `${releaseBaseUrl.replace(/\/$/, '')}/${asset}`;

  process.stderr.write(`Glamour is downloading its ${targetPlatform} runtime (one-time setup).\n`);
  try {
    const response = await globalThis.fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Runtime download returned HTTP ${response.status}: ${url}`);
    }
    await pipeline(response.body, createWriteStream(archivePath));
    await run('tar', ['-xzf', archivePath, '-C', temporaryRoot]);
    await rm(runtimeRoot, { recursive: true, force: true });
    await rename(temporaryRoot, runtimeRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw new Error(
      `Could not install the pinned Glamour runtime. ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  } finally {
    await rm(archivePath, { force: true });
  }
  const extracted = await getInstalledRuntime(runtimeRoot);
  if (!extracted) {
    throw new Error(`The downloaded Glamour runtime archive is missing required files (${asset}).`);
  }
  return extracted;
}

try {
  const { runtimeRoot, serverEntry, pythonExecutable, pythonSitePackages } = await installRuntime();
  const environment = {
    ...process.env,
    GLAMOUR_CV_PROJECT_PATH: path.join(runtimeRoot, 'python', 'glamour_cv'),
    GLAMOUR_PYTHON: pythonExecutable,
    PYTHONPATH: [pythonSitePackages, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
  const child = spawn(process.execPath, [serverEntry], { stdio: 'inherit', env: environment });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.once('error', (error) => {
    process.stderr.write(`Could not start Glamour MCP server: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch (error) {
  process.stderr.write(`Glamour setup failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
