import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export interface ImportEdge {
  readonly from: string;
  /** Repository-relative file for local imports, otherwise the bare package specifier. */
  readonly to: string;
  readonly local: boolean;
}

const aliases: Readonly<Record<string, string>> = { '@core/': 'src/core/' };

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

function resolveLocal(root: string, from: string, specifier: string): string | null {
  const alias = Object.keys(aliases).find((a) => specifier.startsWith(a));
  let base: string;
  if (alias) base = aliases[alias] + specifier.slice(alias.length);
  else if (specifier.startsWith('.')) base = posix.join(posix.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    const full = join(root, candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate;
  }
  return `${base}.ts`;
}

/** Collects every import and export-from edge of the TypeScript files below `dirs`. */
export function importGraph(root: string, dirs: readonly string[]): ImportEdge[] {
  return dirs
    .filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) => listTypeScriptFiles(join(root, dir)))
    .flatMap((file) => {
      const from = relative(root, file).split('\\').join('/');
      const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
      return importedFiles.map(({ fileName }) => {
        const local = resolveLocal(root, from, fileName);
        return local ? { from, to: local, local: true } : { from, to: fileName, local: false };
      });
    });
}

export const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Static imports that bring code along (not `import type`, not only type specifiers, not dynamic). */
export function valueImports(root: string, dirs: readonly string[]): ImportEdge[] {
  return dirs
    .filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) => listTypeScriptFiles(join(root, dir)))
    .flatMap((file) => {
      const from = relative(root, file).split('\\').join('/');
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
      return source.statements.flatMap((statement): ImportEdge[] => {
        const declaration = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement : undefined;
        if (!declaration?.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) return [];
        if (ts.isImportDeclaration(declaration)) {
          const clause = declaration.importClause;
          const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((e) => e.isTypeOnly));
          if (onlyTypes) return [];
        } else if (declaration.isTypeOnly) return [];
        const specifier = declaration.moduleSpecifier.text;
        const local = resolveLocal(root, from, specifier);
        return [local ? { from, to: local, local: true } : { from, to: specifier, local: false }];
      });
    });
}
