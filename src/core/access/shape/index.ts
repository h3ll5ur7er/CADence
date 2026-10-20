import type { Shape3D } from 'replicad';

/** A solid with the persistent names of its faces and edges, keyed by OCCT hash code. */
export interface NamedShape {
  readonly shape: Shape3D;
  readonly faces: ReadonlyMap<number, string>;
  readonly edges: ReadonlyMap<number, string>;
}

/**
 * Access to the geometry kernel's shape store (docs/Architecture/Components.md#resource-access).
 * The kernel (OpenCascade WebAssembly) loads on first use. Entries are evicted least recently used,
 * and evicted shapes free their WebAssembly memory; kept entries are never evicted.
 */
export interface ShapeAccess {
  ready(): Promise<void>;
  put(key: string, shape: NamedShape): void;
  get(key: string): NamedShape | undefined;
  has(key: string): boolean;
  /**
   * Keeps entries from eviction while something holds them (an open assembly its components'
   * shapes), or lets them go again; holds are counted, so two holders keep an entry until both let go.
   */
  keep(keys: readonly string[], kept: boolean): void;
  /**
   * Notes an error the kernel threw or reported. When it shows the kernel cannot go on (it ran out
   * of memory, or its WebAssembly trapped: CAD-133), the next `ready` starts a new kernel, and the
   * shapes of the old one are gone; true then.
   */
  report(error: unknown): boolean;
  /** How many times the kernel was started again after a failure: shapes of earlier generations are gone. */
  generation(): number;
}

/**
 * Why an error means the kernel cannot go on, or nothing. After running out of memory OpenCascade's
 * heap is broken: later calls trap, or the bindings mistake one object for another (CAD-133).
 */
export function kernelFailure(error: unknown): string | undefined {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/Standard_OutOfMemory|malloc failed|out of memory/i.test(text)) return 'it ran out of memory';
  if (/function signature mismatch|memory access out of bounds|unreachable|RuntimeError|Expected null or instance of|table index is out of bounds/i.test(text)) return 'it failed inside';
  return undefined;
}

export interface ShapeAccessOptions {
  /** URL of replicad_single.wasm in the browser; Node finds it next to the module. */
  readonly wasmUrl?: string;
  readonly capacity?: number;
  /** Told when the kernel failed beyond repair (`report`), e.g. to tell the thread that started a worker (CAD-134). */
  readonly onFailure?: () => void;
}

/**
 * The kernel loads once per thread: replicad keeps it in a global, so a second instance would make
 * the shapes of the first unusable. After a failure it loads again: a new generation (CAD-133).
 */
let kernel: Promise<void> | undefined;
let generation = 0;
let failed = false;

function loadKernel(wasmUrl: string | undefined): Promise<void> {
  if (failed) {
    failed = false;
    kernel = undefined;
    generation += 1;
  }
  kernel ??= (async () => {
    const [{ default: opencascade }, { setOC }] = await Promise.all([import('replicad-opencascadejs'), import('replicad')]);
    const quiet = () => undefined; // the STEP writer reports statistics on stdout
    const oc = await opencascade({ print: quiet, printErr: quiet, ...(wasmUrl ? { locateFile: () => wasmUrl } : {}) });
    setOC(oc);
  })();
  return kernel;
}

class KernelShapeAccess implements ShapeAccess {
  private readonly entries = new Map<string, NamedShape>();
  /** Holds on entries, by key. */
  private readonly held = new Map<string, number>();
  /** The kernel generation the entries belong to. */
  private of = generation;

  constructor(private readonly options: ShapeAccessOptions) {}

  async ready(): Promise<void> {
    await loadKernel(this.options.wasmUrl);
    // Shapes of a failed kernel cannot be used, nor freed: they go with it.
    if (this.of !== generation) {
      this.entries.clear();
      this.of = generation;
    }
  }

  report(error: unknown): boolean {
    if (!kernelFailure(error)) return false;
    if (!failed) this.options.onFailure?.();
    failed = true;
    return true;
  }

  generation(): number {
    return generation;
  }

  put(key: string, shape: NamedShape): void {
    const previous = this.entries.get(key);
    if (previous && previous.shape !== shape.shape) previous.shape.delete();
    this.entries.delete(key);
    this.entries.set(key, shape);
    // Kept entries do not count: they stay, and the others share the capacity (CAD-121).
    const capacity = (this.options.capacity ?? 400) + this.held.size;
    for (const [oldKey, old] of this.entries) {
      if (this.entries.size <= capacity) break;
      if (this.held.has(oldKey)) continue;
      this.entries.delete(oldKey);
      if (![...this.entries.values()].some((e) => e.shape === old.shape)) old.shape.delete();
    }
  }

  keep(keys: readonly string[], kept: boolean): void {
    for (const key of keys) {
      const holds = (this.held.get(key) ?? 0) + (kept ? 1 : -1);
      if (holds > 0) this.held.set(key, holds);
      else this.held.delete(key);
    }
  }

  get(key: string): NamedShape | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }
}

export function createShapeAccess(options: ShapeAccessOptions = {}): ShapeAccess {
  return new KernelShapeAccess(options);
}

export { baseName, centerOf, find, piecesOf, verticesOf } from './lookup';
export { place } from './placement';
export { adopt, edgesOf, facesOf } from './topology';

/**
 * An engine whose calls report the kernel's failures to the shape store (CAD-133): errors thrown,
 * and errors in the results it returns (`{ error }` of an outcome, `{ ok: false, error }` of a result).
 */
export function guarded<T extends object>(engine: T, shapes: ShapeAccess): T {
  const note = (value: unknown) => {
    const error = value && typeof value === 'object' ? (value as { error?: unknown }).error : undefined;
    if (typeof error === 'string') shapes.report(error);
    else if (error && typeof error === 'object' && 'message' in error) shapes.report((error as { message: unknown }).message);
  };
  return new Proxy(engine, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
          note(result);
          return result;
        } catch (error) {
          shapes.report(error);
          throw error;
        }
      };
    },
  });
}
