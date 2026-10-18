import { isMainThread, type MessagePort, parentPort, workerData } from 'node:worker_threads';
import { nodeWorker, type NodeResources, serveViews } from '@core/composition/node';
import reference from 'cadence:reference';
import { unpacked } from './binary';
import { runCli } from './cli';

declare const CADENCE_VERSION: string;

/** What this module is started with again, as the worker that draws drawing views (CAD-125). */
interface ViewsWorker {
  readonly cadence: 'views';
  readonly resources?: NodeResources;
}

async function main(): Promise<void> {
  const started = workerData as ViewsWorker | undefined;
  if (!isMainThread && started?.cadence === 'views') return serveViews(parentPort as MessagePort, started.resources?.kernel);
  // The self-contained binary carries the kernels, the fonts and this program as a script (CAD-131).
  const binary = unpacked();
  const views: ViewsWorker = { cadence: 'views', ...(binary ? { resources: binary.resources } : {}) };
  const args = process.argv.slice(2);
  // The MCP server owns stdout (one JSON message per line): any other output goes to stderr.
  if (args[0] === 'mcp') console.log = console.info = console.debug = console.warn = console.error;
  const io = { out: (text: string) => process.stdout.write(`${text}\n`), err: (text: string) => process.stderr.write(`${text}\n`) };
  const code = await runCli(args, io, reference, CADENCE_VERSION, process.env, () => nodeWorker(binary?.script ?? new URL(import.meta.url), views), binary?.resources);
  // The geometry kernel keeps handles open; leave once the command is done.
  process.exit(code);
}

void main();
