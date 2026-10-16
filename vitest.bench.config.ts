import { mergeConfig } from 'vitest/config';
import core from './vitest.core.config';

/** Benchmarks of large models (CAD-94): `npm run bench`. Not part of the tests: they take minutes. */
export default mergeConfig(core, { test: { name: 'bench', include: ['tools/benchmark/**/*.bench.ts'], fileParallelism: false } });
