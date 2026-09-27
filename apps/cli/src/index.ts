#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  compareProject,
  createProject,
  finalizeProject,
  inspectRegion,
  latestCompare,
  viewportSchema,
} from '@glamour/core';

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(
      `glamour — visual debugging for web interfaces\n\nCommands:\n  init --reference <png> --url <url> --viewport <WxH> [--name <name>]\n  compare <projectId>\n  analyze <projectId>\n  inspect <projectId> <regionId>\n  finalize <projectId>`,
    );
    return;
  }
  if (command === 'init') {
    const referencePath = option(args, '--reference');
    const targetUrl = option(args, '--url');
    const viewportText = option(args, '--viewport') ?? '1440x900';
    const [widthText, heightText] = viewportText.toLowerCase().split('x');
    if (!referencePath || !targetUrl || !widthText || !heightText)
      throw new Error('init requires --reference, --url, and --viewport WxH.');
    const viewport = viewportSchema.parse({
      width: Number(widthText),
      height: Number(heightText),
      deviceScaleFactor: 1,
    });
    const result = await createProject({
      name: option(args, '--name') ?? 'glamour-project',
      referencePath: resolve(referencePath),
      targetUrl,
      viewport,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const id = args[0];
  if (!id) throw new Error(`${command} requires a project ID.`);
  if (command === 'compare') console.log(JSON.stringify(await compareProject(id), null, 2));
  else if (command === 'analyze')
    console.log(JSON.stringify(await (await import('@glamour/core')).getProject(id), null, 2));
  else if (command === 'inspect') {
    const regionId = args[1];
    if (!regionId) throw new Error('inspect requires a region ID.');
    console.log(JSON.stringify(inspectRegion(await latestCompare(id), regionId), null, 2));
  } else if (command === 'finalize')
    console.log(JSON.stringify(await finalizeProject(id), null, 2));
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
