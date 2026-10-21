import { isMainThread, type MessagePort, parentPort, Worker as NodeWorker, workerData } from 'node:worker_threads';
import { nodeWorker, type NodeResources, serveGeometry, serveViews } from '@core/composition/node';
import guide from 'cadence:guide';
import reference from 'cadence:reference';
import { serveSandbox, type SandboxWorker, workerSandbox } from '@core/utilities/sandbox';
import { unpacked } from './binary';
import { runCli } from './cli';

declare const CADENCE_VERSION: string;

/** What this module is started with again, as a worker: the geometry kernel (CAD-134), one that draws drawing views (CAD-125), or a script's sandbox (CAD-171). */
interface Worker {
  readonly cadence: 'geometry' | 'views' | 'sandbox';
  readonly resources?: NodeResources;
}

async function main(): Promise<void> {
  const started = workerData as Worker | undefined;
  if (!isMainThread && started?.cadence === 'views') return serveViews(parentPort as MessagePort, started.resources?.kernel);
  if (!isMainThread && started?.cadence === 'geometry') return serveGeometry(parentPort as MessagePort, started.resources);
  if (!isMainThread && started?.cadence === 'sandbox') {
    const port = parentPort as MessagePort;
    return serveSandbox({ post: (message) => port.postMessage(message), listen: (handler) => void port.on('message', handler) });
  }
  // The self-contained binary carries the kernels, the fonts and this program as a script (CAD-131).
  const binary = unpacked();
  const worker = (cadence: Worker['cadence']) => () => nodeWorker(binary?.script ?? new URL(import.meta.url), { cadence, ...(binary ? { resources: binary.resources } : {}) });
  // Scripts run in a worker thread of their own: a loop that never waits holds up no other request.
  const sandbox = workerSandbox((): SandboxWorker => {
    const thread = new NodeWorker(binary?.script ?? new URL(import.meta.url), { workerData: { cadence: 'sandbox' } satisfies Worker });
    return { post: (message) => thread.postMessage(message), listen: (handler) => void thread.on('message', handler), terminate: () => void thread.terminate() };
  });
  const args = process.argv.slice(2);
  // The MCP server owns stdout (one JSON message per line): any other output goes to stderr.
  if (args[0] === 'mcp') console.log = console.info = console.debug = console.warn = console.error;
  const io = { out: (text: string) => process.stdout.write(`${text}\n`), err: (text: string) => process.stderr.write(`${text}\n`) };
  const code = await runCli(args, io, reference, CADENCE_VERSION, process.env, { views: worker('views'), geometry: worker('geometry'), guide, sandbox, ...(binary ? { resources: binary.resources } : {}) });
  // The geometry kernel keeps handles open; leave once the command is done.
  process.exit(code);
}

void main();
