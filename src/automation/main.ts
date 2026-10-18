import { isMainThread, type MessagePort, parentPort, workerData } from 'node:worker_threads';
import { nodeWorker, serveViews } from '@core/composition/node';
import reference from 'cadence:reference';
import { runCli } from './cli';

declare const CADENCE_VERSION: string;

/** This module started again as the worker that draws drawing views (CAD-125). */
const views = { cadence: 'views' };

if (!isMainThread && (workerData as typeof views | undefined)?.cadence === views.cadence) {
  await serveViews(parentPort as MessagePort);
} else {
  const args = process.argv.slice(2);
  // The MCP server owns stdout (one JSON message per line): any other output goes to stderr.
  if (args[0] === 'mcp') console.log = console.info = console.debug = console.warn = console.error;
  const io = { out: (text: string) => process.stdout.write(`${text}\n`), err: (text: string) => process.stderr.write(`${text}\n`) };
  const code = await runCli(args, io, reference, CADENCE_VERSION, process.env, () => nodeWorker(new URL(import.meta.url), views));
  // The geometry kernel keeps handles open; leave once the command is done.
  process.exit(code);
}
