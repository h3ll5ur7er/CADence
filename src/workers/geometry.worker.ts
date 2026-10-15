/// <reference lib="webworker" />
import { createShapeAccess } from '@core/access/shape';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { expose } from '@core/utilities/messaging';

/**
 * The geometry worker (docs/Architecture.md#deployment-and-threads): OpenCascade and the engines that
 * need its shapes run here, off the main thread. The kernel's WebAssembly is served from /wasm/.
 */
const shapes = createShapeAccess({ wasmUrl: new URL('wasm/replicad_single.wasm', self.location.href).href });
expose(self, { modeling: createModelingEngine(shapes), interchange: createInterchangeEngine(shapes), analysis: createAnalysisEngine(shapes) });
