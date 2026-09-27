#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  compareProject,
  compareProjectAll,
  createProject,
  analyzeReference,
  extractGeometry,
  finalizeProject,
  inspectRegion,
  latestCompare,
  optimize,
  testOverrides,
  viewportSchema,
} from '@glamour/core';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: string[], name: string): number {
  const value = option(args, name);
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} requires a finite number.`);
  return parsed;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help') {
    console.log(
      `glamour — visual debugging for web interfaces\n\nCommands:\n  init --reference <png> | --bundle <dir|manifest.json> --url <url> [--viewport <WxH>] [--dpr <n>] [--name <name>] [--repository-root <dir>] [--framework <name>] [--token name=value]\n  analyze <projectId>\n  compare <projectId> [--reference <referenceId>]\n  inspect <projectId> <regionId> [--reference <referenceId>]\n  extract <projectId> <regionId> [--reference <id>] [--format svg|path2d] [--mode open|closed]\n  override <projectId> --selector <css> [--style property=value ...] [--svg-attribute name=value ...] [--region <regionId>]\n  optimize <projectId> --selector <css> --property <name> --min <n> --max <n> --step <n> [--region <regionId>]\n  finalize <projectId>`,
    );
    return;
  }
  if (command === 'init') {
    const referencePath = option(args, '--reference');
    const referenceBundlePath = option(args, '--bundle');
    const targetUrl = option(args, '--url');
    const viewportText = option(args, '--viewport') ?? '1440x900';
    const [widthText, heightText] = viewportText.toLowerCase().split('x');
    if ((!referencePath && !referenceBundlePath) || !targetUrl)
      throw new Error('init requires --reference or --bundle, and --url.');
    const viewport = referenceBundlePath
      ? undefined
      : viewportSchema.parse({
          width: Number(widthText),
          height: Number(heightText),
          deviceScaleFactor: Number(option(args, '--dpr') ?? '1'),
        });
    const designTokens: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== '--token' || !args[index + 1]) continue;
      const [name, ...value] = args[++index]!.split('=');
      if (!name || !value.length) throw new Error('Design tokens must use name=value.');
      designTokens[name] = value.join('=');
    }
    const result = await createProject({
      name: option(args, '--name') ?? 'glamour-project',
      ...(referencePath ? { referencePath: resolve(referencePath) } : {}),
      ...(referenceBundlePath ? { referenceBundlePath: resolve(referenceBundlePath) } : {}),
      targetUrl,
      ...(viewport ? { viewport } : {}),
      targetConfig: {
        ...(option(args, '--repository-root')
          ? { repositoryRoot: resolve(option(args, '--repository-root')!) }
          : {}),
        ...(option(args, '--route') ? { route: option(args, '--route')! } : {}),
        ...(option(args, '--framework') ? { framework: option(args, '--framework')! } : {}),
        ...(option(args, '--dev-command') ? { devCommand: option(args, '--dev-command')! } : {}),
        ...(option(args, '--build-command')
          ? { buildCommand: option(args, '--build-command')! }
          : {}),
        ...(Object.keys(designTokens).length ? { designTokens } : {}),
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const id = args[0];
  if (!id) throw new Error(`${command} requires a project ID.`);
  if (command === 'compare') {
    const referenceId = option(args, '--reference');
    console.log(
      JSON.stringify(
        referenceId ? await compareProject(id, referenceId) : await compareProjectAll(id),
        null,
        2,
      ),
    );
  } else if (command === 'analyze')
    console.log(JSON.stringify(await analyzeReference(id), null, 2));
  else if (command === 'inspect') {
    const regionId = args[1];
    if (!regionId) throw new Error('inspect requires a region ID.');
    console.log(
      JSON.stringify(
        inspectRegion(await latestCompare(id, option(args, '--reference')), regionId),
        null,
        2,
      ),
    );
  } else if (command === 'extract') {
    const regionId = args[1];
    if (!regionId) throw new Error('extract requires a region ID.');
    console.log(
      JSON.stringify(
        await extractGeometry({
          projectId: id,
          regionId,
          ...(option(args, '--reference') ? { referenceId: option(args, '--reference')! } : {}),
          mode: (option(args, '--mode') as 'open' | 'closed' | undefined) ?? 'open',
          format: (option(args, '--format') as 'svg' | 'path2d' | undefined) ?? 'svg',
        }),
        null,
        2,
      ),
    );
  } else if (command === 'override') {
    const selector = option(args, '--selector');
    if (!selector) throw new Error('override requires --selector.');
    const styles: Record<string, string> = {};
    const svgAttributes: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--style' && args[index + 1]) {
        const [key, ...value] = args[++index]!.split('=');
        if (!key || !value.length) throw new Error('Styles must use property=value.');
        styles[key] = value.join('=');
      } else if (args[index] === '--svg-attribute' && args[index + 1]) {
        const [key, ...value] = args[++index]!.split('=');
        if (!key || !value.length) throw new Error('SVG attributes must use name=value.');
        svgAttributes[key] = value.join('=');
      }
    }
    console.log(
      JSON.stringify(
        await testOverrides({
          projectId: id,
          selector,
          styles,
          svgAttributes,
          ...(option(args, '--region') ? { regionId: option(args, '--region')! } : {}),
          ...(option(args, '--reference') ? { referenceId: option(args, '--reference')! } : {}),
        }),
        null,
        2,
      ),
    );
  } else if (command === 'optimize') {
    const selector = option(args, '--selector');
    const property = option(args, '--property');
    if (!selector || !property) throw new Error('optimize requires --selector and --property.');
    console.log(
      JSON.stringify(
        await optimize({
          projectId: id,
          selector,
          property: property as Parameters<typeof optimize>[0]['property'],
          min: numberOption(args, '--min'),
          max: numberOption(args, '--max'),
          step: numberOption(args, '--step'),
          ...(option(args, '--region') ? { regionId: option(args, '--region')! } : {}),
          ...(option(args, '--reference') ? { referenceId: option(args, '--reference')! } : {}),
        }),
        null,
        2,
      ),
    );
  } else if (command === 'finalize')
    console.log(JSON.stringify(await finalizeProject(id), null, 2));
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
