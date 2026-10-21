import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';

/**
 * Runs JavaScript others wrote (scripts, plugins) in QuickJS compiled to WebAssembly: an engine of
 * its own, which sees only the globals given to it ([[Architecture/Decisions#ADR-60]]).
 */

/** Calls out of the sandbox: `host(name, ...args)` inside it resolves to what this answers (plain data). */
export type SandboxHost = (name: string, args: readonly unknown[]) => Promise<unknown>;

export interface SandboxOptions {
  /** Plain data (JSON) set as globals, e.g. a script's parameters. */
  readonly globals?: Readonly<Record<string, unknown>>;
  /** Answers the script's `host(name, ...args)` calls; without it, `host` is missing. */
  readonly host?: SandboxHost;
  /** Milliseconds the script may take, waiting included (30 s by default). */
  readonly timeLimit?: number;
  /** Bytes the script's engine may use (256 MB by default). */
  readonly memoryLimit?: number;
  /** Stops the script where it is (a cancelled call, the Stop button). */
  readonly signal?: AbortSignal;
  /** A line the script printed (`console.log` and the others), as it prints it. */
  readonly onOutput?: (line: string) => void;
}

/** How a run ended: the value the script returned (as JSON data) or why it failed, with what it printed. */
export type SandboxOutcome =
  | { readonly ok: true; readonly value: unknown; readonly output: readonly string[] }
  | { readonly ok: false; readonly error: string; readonly reason: 'error' | 'time-limit' | 'stopped' | 'memory'; readonly output: readonly string[] };

let quickjs: Promise<QuickJSWASMModule> | undefined;

/** The engine, loaded once (about 1 MB of WebAssembly inside a module), when the first script runs. */
function engine(): Promise<QuickJSWASMModule> {
  quickjs ??= Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-singlefile-browser-release-sync')]).then(([core, variant]) =>
    core.newQuickJSWASMModuleFromVariant(variant.default),
  );
  return quickjs;
}

/** What the sandbox defines before the script: `console` (into `__print`) and `host` (JSON both ways). */
const prelude = `(() => {
const print = __print;
const show = (v) => typeof v === 'string' ? v : (() => { try { const s = JSON.stringify(v); return s === undefined ? String(v) : s; } catch { return String(v); } })();
globalThis.console = Object.freeze(Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((level) => [level, (...values) => print(level, values.map(show).join(' '))])));
if (typeof __host === 'function') {
  const call = __host;
  globalThis.host = async (name, ...args) => { const answer = await call(name, JSON.stringify(args)); return answer === undefined ? undefined : JSON.parse(answer); };
}
delete globalThis.__host; delete globalThis.__print;
})();`;

/**
 * Runs `source`, the body of an async function (`return` gives the value), in a fresh engine with a
 * memory and a time limit. The value must be JSON data; it comes back parsed.
 */
export async function runSandboxed(source: string, options: SandboxOptions = {}): Promise<SandboxOutcome> {
  const module = await engine();
  const output: string[] = [];
  const print = (line: string) => {
    output.push(line);
    options.onOutput?.(line);
  };
  const runtime: QuickJSRuntime = module.newRuntime();
  runtime.setMemoryLimit(options.memoryLimit ?? 256 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const vm: QuickJSContext = runtime.newContext();
  const deadline = Date.now() + (options.timeLimit ?? 30_000);
  let ended: 'time-limit' | 'stopped' | undefined;
  const over = () => {
    if (options.signal?.aborted) ended = 'stopped';
    else if (Date.now() > deadline) ended = 'time-limit';
    return ended !== undefined;
  };
  runtime.setInterruptHandler(over);
  let alive = true;
  /** Calls out still waiting: their promises are freed before the engine is. */
  const waiting = new Set<{ readonly alive: boolean; dispose(): void }>();
  /**
   * Answers that need no I/O resolve as microtasks only: a script calling the host in a loop would
   * starve timers and messages (a Stop, a cancel). So it waits for the next task every 50 ms.
   */
  let yielded = Date.now();
  const settle = (apply: () => void) => {
    if (Date.now() - yielded < 50) return apply();
    setTimeout(() => {
      yielded = Date.now();
      apply();
    }, 0);
  };
  const pump = () => {
    if (!alive) return;
    const jobs = runtime.executePendingJobs();
    jobs.error?.dispose();
  };

  try {
    const printer = vm.newFunction('__print', (level, text) => {
      const line = vm.getString(text);
      print(vm.getString(level) === 'log' ? line : `${vm.getString(level)}: ${line}`);
    });
    vm.setProp(vm.global, '__print', printer);
    printer.dispose();
    if (options.host) {
      const host = options.host;
      const caller = vm.newFunction('__host', (name, args) => {
        const deferred = vm.newPromise();
        waiting.add(deferred);
        const [called, values] = [vm.getString(name), JSON.parse(vm.getString(args)) as unknown[]];
        void host(called, values).then(
          (answer) =>
            settle(() => {
              waiting.delete(deferred);
              if (!alive) return;
              const text = answer === undefined ? vm.undefined : vm.newString(JSON.stringify(answer));
              deferred.resolve(text);
              text.dispose();
              pump();
            }),
          (error: unknown) =>
            settle(() => {
              waiting.delete(deferred);
              if (!alive) return;
              const failure = vm.newError(error instanceof Error ? error.message : String(error));
              deferred.reject(failure);
              failure.dispose();
              pump();
            }),
        );
        return deferred.handle;
      });
      vm.setProp(vm.global, '__host', caller);
      caller.dispose();
    }
    for (const [name, value] of Object.entries(options.globals ?? {})) {
      const json = vm.newString(JSON.stringify(value ?? null));
      const parse = vm.unwrapResult(vm.evalCode('JSON.parse'));
      const parsed = vm.unwrapResult(vm.callFunction(parse, vm.undefined, json));
      vm.setProp(vm.global, name, parsed);
      [json, parse, parsed].forEach((h) => h.dispose());
    }
    vm.unwrapResult(vm.evalCode(prelude, 'prelude.js')).dispose();

    const evaluated = vm.evalCode(`(async () => {\n${source}\n})()`, 'script.js');
    if (evaluated.error) return failed(vm, evaluated.error, ended, output);
    const settled = vm.resolvePromise(evaluated.value);
    evaluated.value.dispose();
    pump();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'time-limit' | 'stopped'>((resolve) => {
      timer = setTimeout(() => resolve('time-limit'), Math.max(0, deadline - Date.now()));
      options.signal?.addEventListener('abort', () => resolve('stopped'), { once: true });
    });
    const result = await Promise.race([settled, limit]);
    clearTimeout(timer);
    if (result === 'time-limit' || result === 'stopped') {
      ended = result;
      return { ok: false, error: result === 'stopped' ? 'The script was stopped.' : 'The script ran out of time.', reason: result, output };
    }
    if (result.error) return failed(vm, result.error, ended, output);
    const value = toJson(vm, result.value);
    result.value.dispose();
    return { ok: true, value, output };
  } catch (error) {
    // A trap leaves the engine's memory unusable: the next script loads it anew.
    if (error instanceof WebAssembly.RuntimeError) quickjs = undefined;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, reason: /memory/i.test(message) ? 'memory' : 'error', output };
  } finally {
    alive = false;
    // Handles of calls still waiting belong to the context: dropping it with them is what ends the script.
    try {
      for (const deferred of waiting) if (deferred.alive) deferred.dispose();
      vm.dispose();
      runtime.dispose();
    } catch {
      // A context with handles still held cannot be freed cleanly: load the engine anew for the next script.
      quickjs = undefined;
    }
  }
}

/** The script's value as JSON data (undefined stays undefined). */
function toJson(vm: QuickJSContext, handle: QuickJSHandle): unknown {
  if (vm.typeof(handle) === 'undefined') return undefined;
  const stringify = vm.unwrapResult(vm.evalCode('(v) => JSON.stringify(v)'));
  const text = vm.callFunction(stringify, vm.undefined, handle);
  stringify.dispose();
  if (text.error) {
    text.error.dispose();
    return String(vm.dump(handle));
  }
  const json = vm.typeof(text.value) === 'string' ? vm.getString(text.value) : undefined;
  text.value.dispose();
  return json === undefined ? undefined : JSON.parse(json);
}

/** A thrown error as a message with where it was thrown (line numbers of the script). */
function failed(vm: QuickJSContext, error: QuickJSHandle, ended: 'time-limit' | 'stopped' | undefined, output: readonly string[]): SandboxOutcome {
  const dumped = vm.dump(error) as { name?: string; message?: string; stack?: string } | string;
  error.dispose();
  if (ended) return { ok: false, error: ended === 'stopped' ? 'The script was stopped.' : 'The script ran out of time.', reason: ended, output };
  if (typeof dumped !== 'object' || dumped === null) return { ok: false, error: String(dumped), reason: 'error', output };
  const message = `${dumped.name && dumped.name !== 'Error' ? `${dumped.name}: ` : ''}${dumped.message ?? ''}`;
  const memory = /out of memory/i.test(message);
  // The script's lines are one further down than in its text (the async wrapper's first line).
  const where = /script\.js:(\d+)(?::(\d+))?/.exec(dumped.stack ?? '');
  const line = where ? ` (line ${Number(where[1]) - 1})` : '';
  return { ok: false, error: memory ? 'The script ran out of memory.' : `${message}${line}`, reason: memory ? 'memory' : 'error', output };
}

/** One end of a worker, as the sandbox talks to it: a Web Worker or a Node worker thread. */
export interface SandboxEndpoint {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
}

/** A worker started for one script, ended when the script is done, stopped or out of time. */
export interface SandboxWorker extends SandboxEndpoint {
  terminate(): void;
}

type ToWorker =
  | { readonly type: 'run'; readonly source: string; readonly globals: Readonly<Record<string, unknown>>; readonly timeLimit?: number; readonly memoryLimit?: number; readonly host: boolean }
  | { readonly type: 'answer'; readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string };
type FromWorker = { readonly type: 'call'; readonly id: number; readonly name: string; readonly args: readonly unknown[] } | { readonly type: 'output'; readonly line: string } | { readonly type: 'done'; readonly outcome: SandboxOutcome };

/**
 * Runs each script in a worker of its own (the app's Web Worker, the MCP server's worker thread): a
 * loop that never waits holds up nothing else, and Stop or the time limit ends the worker.
 */
export function workerSandbox(start: () => SandboxWorker): (source: string, options?: SandboxOptions) => Promise<SandboxOutcome> {
  return (source, options = {}) =>
    new Promise((resolve) => {
      const output: string[] = [];
      const worker = start();
      let done = false;
      const finish = (outcome: SandboxOutcome) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(outcome);
      };
      const end = (reason: 'time-limit' | 'stopped') => finish({ ok: false, reason, error: reason === 'stopped' ? 'The script was stopped.' : 'The script ran out of time.', output });
      // The worker keeps its own time; this one is for a worker that no longer answers.
      const timer = setTimeout(() => end('time-limit'), (options.timeLimit ?? 30_000) + 2_000);
      if (options.signal?.aborted) return end('stopped');
      options.signal?.addEventListener('abort', () => end('stopped'), { once: true });
      worker.listen((message) => {
        const received = message as FromWorker;
        if (received.type === 'output') {
          output.push(received.line);
          options.onOutput?.(received.line);
        } else if (received.type === 'done') finish({ ...received.outcome, output });
        else if (received.type === 'call') {
          const answer = (reply: ToWorker) => !done && worker.post(reply);
          const host = options.host ?? (() => Promise.reject(new Error('There is no host.')));
          host(received.name, received.args).then(
            (value) => answer({ type: 'answer', id: received.id, ok: true, value }),
            (error: unknown) => answer({ type: 'answer', id: received.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
        }
      });
      worker.post({
        type: 'run',
        source,
        globals: options.globals ?? {},
        host: Boolean(options.host),
        ...(options.timeLimit !== undefined ? { timeLimit: options.timeLimit } : {}),
        ...(options.memoryLimit !== undefined ? { memoryLimit: options.memoryLimit } : {}),
      } satisfies ToWorker);
    });
}

/** The worker's side of {@link workerSandbox}: runs the script it is sent, asking for host calls. */
export function serveSandbox(endpoint: SandboxEndpoint): void {
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let next = 0;
  endpoint.listen((message) => {
    const received = message as ToWorker;
    if (received.type === 'answer') {
      const call = waiting.get(received.id);
      waiting.delete(received.id);
      if (received.ok) call?.resolve(received.value);
      else call?.reject(new Error(received.error));
      return;
    }
    const host: SandboxHost = (name, args) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        endpoint.post({ type: 'call', id, name, args } satisfies FromWorker);
      });
    void runSandboxed(received.source, {
      globals: received.globals,
      ...(received.host ? { host } : {}),
      ...(received.timeLimit !== undefined ? { timeLimit: received.timeLimit } : {}),
      ...(received.memoryLimit !== undefined ? { memoryLimit: received.memoryLimit } : {}),
      onOutput: (line) => endpoint.post({ type: 'output', line } satisfies FromWorker),
    }).then((outcome) => endpoint.post({ type: 'done', outcome } satisfies FromWorker));
  });
}
