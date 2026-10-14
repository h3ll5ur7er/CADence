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
 * and evicted shapes free their WebAssembly memory.
 */
export interface ShapeAccess {
  ready(): Promise<void>;
  put(key: string, shape: NamedShape): void;
  get(key: string): NamedShape | undefined;
  has(key: string): boolean;
}

export interface ShapeAccessOptions {
  /** URL of replicad_single.wasm in the browser; Node finds it next to the module. */
  readonly wasmUrl?: string;
  readonly capacity?: number;
}

class KernelShapeAccess implements ShapeAccess {
  private readonly entries = new Map<string, NamedShape>();
  private kernel: Promise<void> | undefined;

  constructor(private readonly options: ShapeAccessOptions) {}

  ready(): Promise<void> {
    this.kernel ??= (async () => {
      const [{ default: opencascade }, { setOC }] = await Promise.all([import('replicad-opencascadejs'), import('replicad')]);
      const wasmUrl = this.options.wasmUrl;
      const quiet = () => undefined; // the STEP writer reports statistics on stdout
      const oc = await opencascade({ print: quiet, printErr: quiet, ...(wasmUrl ? { locateFile: () => wasmUrl } : {}) });
      setOC(oc);
    })();
    return this.kernel;
  }

  put(key: string, shape: NamedShape): void {
    const previous = this.entries.get(key);
    if (previous && previous.shape !== shape.shape) previous.shape.delete();
    this.entries.delete(key);
    this.entries.set(key, shape);
    const capacity = this.options.capacity ?? 400;
    for (const [oldKey, old] of this.entries) {
      if (this.entries.size <= capacity) break;
      this.entries.delete(oldKey);
      if (![...this.entries.values()].some((e) => e.shape === old.shape)) old.shape.delete();
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

export { baseName, centerOf, find } from './lookup';
