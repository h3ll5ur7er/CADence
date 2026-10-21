import { describe, expect, it } from 'vitest';
import { runSandboxed, type SandboxWorker, serveSandbox, workerSandbox } from './index';

describe('the sandbox', () => {
  it('returns what a script returns, and what it printed', async () => {
    const outcome = await runSandboxed('console.log("size", size, { a: 1 }); console.warn("careful"); return size * 2;', { globals: { size: 21 } });
    expect(outcome).toEqual({ ok: true, value: 42, output: ['size 21 {"a":1}', 'warn: careful'] });
  });

  it('answers calls out through the host, in order, with errors as exceptions', async () => {
    const calls: string[] = [];
    const host = async (name: string, args: readonly unknown[]) => {
      calls.push(`${name}(${JSON.stringify(args)})`);
      if (name === 'fail') throw new Error('refused');
      return { name, args };
    };
    const outcome = await runSandboxed(
      `const parts = [];
       for (let i = 1; i <= 3; i++) parts.push((await host('make', i, 'part')).args[0]);
       try { await host('fail'); } catch (error) { parts.push(error.message); }
       return parts;`,
      { host },
    );
    expect(outcome).toMatchObject({ ok: true, value: [1, 2, 3, 'refused'] });
    expect(calls).toEqual(['make([1,"part"])', 'make([2,"part"])', 'make([3,"part"])', 'fail([])']);
  });

  it('reaches nothing of its host: no Node, no network, no eval of the host', async () => {
    const outcome = await runSandboxed('return [typeof process, typeof require, typeof fetch, typeof globalThis.__host, typeof host, typeof console.log];');
    expect(outcome).toMatchObject({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'function'] });
  });

  it('stops a loop that never waits at its time limit, and one that waits too long', async () => {
    const loop = await runSandboxed('while (true) {}', { timeLimit: 200 });
    expect(loop).toMatchObject({ ok: false, reason: 'time-limit' });
    const waiting = await runSandboxed('await host("never");', { timeLimit: 200, host: () => new Promise(() => undefined) });
    expect(waiting).toMatchObject({ ok: false, reason: 'time-limit' });
    // A loop after a call out is stopped too.
    const later = await runSandboxed('await host("x"); while (true) {}', { timeLimit: 300, host: async () => 1 });
    expect(later).toMatchObject({ ok: false, reason: 'time-limit' });
    // The engine works on after scripts were stopped.
    expect(await runSandboxed('return 1 + 1;')).toMatchObject({ ok: true, value: 2 });
  });

  it('is stopped from outside', async () => {
    const stop = new AbortController();
    const running = runSandboxed('await host("wait"); while (true) {}', { host: async () => stop.abort(), signal: stop.signal });
    expect(await running).toMatchObject({ ok: false, reason: 'stopped', error: 'The script was stopped.' });
  });

  it('reports errors with their line, and a script that takes too much memory', async () => {
    expect(await runSandboxed('const a = 1;\nnull.size;')).toMatchObject({ ok: false, reason: 'error', error: expect.stringMatching(/TypeError: .*\(line 2\)/) });
    expect(await runSandboxed('const a = [];\nwhile (true) a.push("x".repeat(1000));', { memoryLimit: 8 * 1024 * 1024 })).toMatchObject({ ok: false, reason: 'memory' });
    expect(await runSandboxed('return 3;')).toMatchObject({ ok: true, value: 3 });
    // Filling 8 MB takes about five seconds on CI runners.
  }, 30_000);
});

describe('the sandbox in a worker', () => {
  /** A worker in this thread: messages cross as copies, after the current task, as between threads. */
  function inThread(): SandboxWorker & { terminated: boolean } {
    const toWorker: ((message: unknown) => void)[] = [];
    const toMain: ((message: unknown) => void)[] = [];
    const worker = {
      terminated: false,
      post: (message: unknown) => setTimeout(() => !worker.terminated && toWorker.forEach((h) => h(structuredClone(message)))),
      listen: (handler: (message: unknown) => void) => void toMain.push(handler),
      terminate: () => void (worker.terminated = true),
    };
    serveSandbox({ post: (message) => setTimeout(() => !worker.terminated && toMain.forEach((h) => h(structuredClone(message)))), listen: (handler) => void toWorker.push(handler) });
    return worker;
  }

  it('runs a script there, with host calls, printed lines and its value', async () => {
    const workers: ReturnType<typeof inThread>[] = [];
    const run = workerSandbox(() => {
      const worker = inThread();
      workers.push(worker);
      return worker;
    });
    const lines: string[] = [];
    const outcome = await run('const a = await host("twice", 21); console.log("got", a); return a + n;', { globals: { n: 1 }, host: async (_name, [value]) => (value as number) * 2, onOutput: (line) => lines.push(line) });
    expect(outcome).toEqual({ ok: true, value: 43, output: ['got 42'] });
    expect(lines).toEqual(['got 42']);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('ends the worker when stopped', async () => {
    const stop = new AbortController();
    const run = workerSandbox(inThread);
    const running = run('await host("wait");', { host: () => new Promise(() => undefined), signal: stop.signal });
    setTimeout(() => stop.abort(), 50);
    expect(await running).toMatchObject({ ok: false, reason: 'stopped' });
  });
});
