/// <reference lib="webworker" />
import { createShapeAccess } from '@core/access/shape';
import { createModelingEngine } from '@core/engines/modeling';
import { expose } from '@core/utilities/messaging';

/**
 * The views worker (docs/Architecture.md#deployment-and-threads): a kernel of its own that draws
 * drawing views exactly, stopped and started again when a view takes too long (CAD-125), so the
 * geometry worker is never held up by one.
 */
expose(self, { modeling: createModelingEngine(createShapeAccess({ wasmUrl: new URL('wasm/replicad_single.wasm', self.location.href).href })) });
