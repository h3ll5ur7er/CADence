import { describe, expect, it } from 'vitest';
import { importGraph, repositoryRoot, valueImports } from './import-graph';
import { checkImport, checkKernelImport, checkPackage, classify } from './rules';

describe('architecture rules', () => {
  it('classifies files into iDesign layers', () => {
    expect(classify('src/app/home/home.ts')).toEqual({ layer: 'client', component: 'app' });
    expect(classify('src/core/managers/project/index.ts')).toEqual({
      layer: 'manager',
      component: 'project',
    });
    expect(classify('src/core/contracts/project.ts')?.layer).toBe('contracts');
    expect(classify('tools/architecture/rules.ts')).toBeNull();
    expect(classify('src/automation/mcp.ts')).toEqual({ layer: 'client', component: 'automation' });
  });

  it.each([
    ['src/app/home/home.ts', 'src/core/managers/project/index.ts'],
    ['src/core/managers/design/design-manager.ts', 'src/core/engines/sketch/index.ts'],
    ['src/core/managers/design/design-manager.ts', 'src/core/access/document/index.ts'],
    ['src/core/engines/modeling/modeling-engine.ts', 'src/core/access/shape/index.ts'],
    ['src/core/access/project/indexed-db.ts', 'src/core/contracts/index.ts'],
    ['src/core/managers/project/project-manager.ts', 'src/core/managers/project/events.ts'],
    ['src/core/composition/browser.ts', 'src/core/access/project/index.ts'],
    ['src/core/access/project/fs.spec.ts', 'src/core/utilities/file-system/testing/x.ts'],
    ['src/core/access/project/fs.spec.ts', 'src/core/utilities/file-system/node.ts'],
    ['src/automation/cli.ts', 'src/core/composition/node.ts'],
    ['src/core/composition/node.ts', 'src/core/utilities/file-system/node.ts'],
    ['src/app/platform/tauri-file-delivery.ts', 'src/core/access/external-file/index.ts'],
    ['src/app/app.config.ts', 'src/app/platform/tauri-file-system.ts'],
  ])('allows %s → %s', (from, to) => {
    expect(checkImport(from, to)).toBeNull();
  });

  it.each([
    ['client → engine', 'src/app/editor/editor.ts', 'src/core/engines/sketch/index.ts'],
    ['client → access', 'src/app/home/home.ts', 'src/core/access/project/index.ts'],
    ['manager → manager', 'src/core/managers/assembly/a.ts', 'src/core/managers/design/index.ts'],
    ['engine → engine', 'src/core/engines/analysis/a.ts', 'src/core/engines/modeling/index.ts'],
    ['engine → manager', 'src/core/engines/sketch/a.ts', 'src/core/managers/design/index.ts'],
    ['access → engine', 'src/core/access/shape/a.ts', 'src/core/engines/modeling/index.ts'],
    ['utility → contracts', 'src/core/utilities/messaging/a.ts', 'src/core/contracts/index.ts'],
    ['contracts → utility', 'src/core/contracts/a.ts', 'src/core/utilities/identity/index.ts'],
    ['internals', 'src/core/managers/project/a.ts', 'src/core/access/project/indexed-db.ts'],
    ['platform → manager', 'src/app/platform/x.ts', 'src/core/managers/design/index.ts'],
    ['test support in production code', 'src/core/access/project/fs.ts', 'src/core/utilities/file-system/testing/x.ts'],
    ['Node code in browser code', 'src/app/home/home.ts', 'src/core/composition/node.ts'],
    ['Node code in the core', 'src/core/composition/index.ts', 'src/core/utilities/file-system/node.ts'],
    ['automation → engine', 'src/automation/cli.ts', 'src/core/engines/modeling/index.ts'],
  ])('rejects %s', (_, from, to) => {
    expect(checkImport(from, to)).not.toBeNull();
  });

  it('keeps the core free of Angular, three.js and Tauri', () => {
    expect(checkPackage('src/core/engines/sketch/a.ts', '@angular/core')).not.toBeNull();
    expect(checkPackage('src/core/access/project/a.ts', '@tauri-apps/api/core')).not.toBeNull();
    expect(checkPackage('src/core/engines/sketch/a.ts', 'rxjs')).toBeNull();
    expect(checkPackage('src/app/viewport/viewport.ts', 'three')).toBeNull();
  });
});

describe('the code base', () => {
  const edges = importGraph(repositoryRoot, ['src']);

  it('has imports to check', () => {
    expect(edges.length).toBeGreaterThan(0);
  });

  it('follows the call rules', () => {
    const violations = edges
      .map((e) => (e.local ? checkImport(e.from, e.to) : checkPackage(e.from, e.to)))
      .filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });

  it('keeps the geometry kernel out of the main thread', () => {
    const violations = valueImports(repositoryRoot, ['src'])
      .map((e) => checkKernelImport(e.from, e.to))
      .filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });
});

describe('kernel imports', () => {
  it('allows types and test code, refuses code on the main thread', () => {
    expect(checkKernelImport('src/core/managers/project/a.ts', 'src/core/engines/interchange/index.ts')).toMatch(/import its types only/);
    expect(checkKernelImport('src/app/x.ts', 'replicad')).toMatch(/import its types only/);
    expect(checkKernelImport('src/core/managers/project/a.spec.ts', 'src/core/engines/interchange/index.ts')).toBeNull();
    expect(checkKernelImport('src/workers/geometry.worker.ts', 'src/core/engines/modeling/index.ts')).toBeNull();
    expect(checkKernelImport('src/core/managers/design/a.ts', 'src/core/engines/sketch/index.ts')).toBeNull();
  });
});
