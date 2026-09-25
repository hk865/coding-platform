import { expect, it, vi } from 'vitest';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { captureProjectSource } from '../../src/core/workspace/project-source-snapshot.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';

const work = vi.hoisted(() => ({ servicesCreated: 0 }));
vi.mock('typescript', async importOriginal => {
  const original = await importOriginal<typeof import('typescript')>();
  return {
    ...original,
    createLanguageService: (...args: Parameters<typeof original.createLanguageService>) => {
      work.servicesCreated++;
      return original.createLanguageService(...args);
    },
  };
});

it('updates content, HEAD and dependency permissions without rebuilding an unchanged project service', async () => {
  work.servicesCreated = 0;
  const files = new Map([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler' }, files: ['src/use.ts'] })],
    ['src/lib.ts', 'export function chosen() { return 1; }\n'],
    ['src/use.ts', 'import { chosen } from "./lib";\nchosen();\n'],
  ]);
  const denied = new Set<string>();
  let commit = 'a'.repeat(40);
  const access: ProjectSourceAccess = {
    allowed: path => !denied.has(path),
    inventory: async () => ({ paths: [...files.keys()], truncated: false }),
    sourceIdentity: async () => ({ workspace: 'service-reuse-tests', commit }),
    read: async path => {
      const content = files.get(path);
      if (content === undefined || denied.has(path)) throw Error('source unavailable');
      return { content };
    },
  };
  const signal = new AbortController().signal;
  const subject = new TypeScriptSourceAnalyzer();
  const definition = { operation: 'definitions' as const, path: 'src/use.ts', line: 2, column: 2 };
  const imports = { operation: 'imports' as const, path: 'src/use.ts' };
  try {
    const initial = await captureProjectSource(access, signal);
    const initialDefinition = subject.analyze(initial, definition, signal).results;
    expect(initialDefinition).toEqual([
      expect.objectContaining({ path: 'src/lib.ts', line: 1, digest: initial.files.get('/workspace/src/lib.ts')?.digest }),
    ]);
    expect(work.servicesCreated).toBe(1);

    files.set('src/lib.ts', '// Updated implementation.\n\nexport function chosen() { return 2; }\n');
    const edited = await captureProjectSource(access, signal);
    const editedDefinition = subject.analyze(edited, definition, signal).results;
    expect(editedDefinition).toEqual([
      expect.objectContaining({ path: 'src/lib.ts', line: 3, digest: edited.files.get('/workspace/src/lib.ts')?.digest }),
    ]);
    expect(editedDefinition).not.toEqual(initialDefinition);

    commit = 'b'.repeat(40);
    const movedHead = await captureProjectSource(access, signal);
    expect(movedHead.snapshot).not.toBe(edited.snapshot);
    expect(subject.analyze(movedHead, definition, signal).results).toEqual(editedDefinition);

    // lib.ts is an imported dependency, not a root: config options and roots stay identical.
    denied.add('src/lib.ts');
    const restricted = await captureProjectSource(access, signal);
    const unavailable = subject.analyze(restricted, imports, signal);
    expect(unavailable.results).toEqual([
      expect.objectContaining({ module: './lib', resolution: 'unknown', targets: [] }),
    ]);
    expect(unavailable.indexedSources.map(source => source.path)).toEqual(['src/use.ts']);
    expect(unavailable.sources.some(source => source.path === 'src/lib.ts')).toBe(false);

    denied.clear();
    const restored = await captureProjectSource(access, signal);
    expect(subject.analyze(restored, imports, signal).results).toEqual([
      expect.objectContaining({ module: './lib', resolution: 'resolved', targets: [expect.objectContaining({ path: 'src/lib.ts' })] }),
    ]);
    expect(subject.analyze(restored, definition, signal).results).toEqual(editedDefinition);
    expect(subject.analyze(initial, definition, signal).results).toEqual(initialDefinition);

    // All semantic assertions use the real TypeScript implementation; only its public factory is counted.
    expect(work.servicesCreated).toBe(1);
  } finally {
    subject.dispose();
  }
});

it('invalidates package entry resolution when only an existing package declaration changes', async () => {
  work.servicesCreated = 0;
  const declaration = (entry: 'a' | 'b') => JSON.stringify({ name: 'pkg', type: 'module', exports: `./${entry}.js`, main: `./${entry}.js` });
  const files = new Map([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, files: ['src/use.ts'] })],
    ['src/use.ts', 'import { chosen } from "pkg";\nchosen();\n'],
    ['node_modules/pkg/package.json', declaration('a')],
    ['node_modules/pkg/a.d.ts', 'export declare function chosen(): "a";\n'],
    ['node_modules/pkg/b.d.ts', 'export declare function chosen(): "b";\n'],
  ]);
  const access: ProjectSourceAccess = {
    allowed: () => true,
    inventory: async () => ({ paths: [...files.keys()], truncated: false }),
    sourceIdentity: async () => ({ workspace: 'package-entry-tests', commit: null }),
    read: async path => {
      const content = files.get(path);
      if (content === undefined) throw Error('source unavailable');
      return { content };
    },
  };
  const signal = new AbortController().signal;
  const subject = new TypeScriptSourceAnalyzer();
  const freshControl = new TypeScriptSourceAnalyzer();
  const imports = { operation: 'imports' as const, path: 'src/use.ts' };
  const definition = { operation: 'definitions' as const, path: 'src/use.ts', line: 2, column: 2 };
  try {
    const before = await captureProjectSource(access, signal);
    expect(subject.analyze(before, imports, signal).results).toEqual([
      expect.objectContaining({ module: 'pkg', resolution: 'resolved', targets: [expect.objectContaining({ path: 'node_modules/pkg/a.d.ts' })] }),
    ]);
    expect(subject.analyze(before, definition, signal).results).toEqual([
      expect.objectContaining({ path: 'node_modules/pkg/a.d.ts' }),
    ]);

    files.set('node_modules/pkg/package.json', declaration('b'));
    const after = await captureProjectSource(access, signal);
    expect([...after.files.keys()]).toEqual([...before.files.keys()]);
    expect(after.files.get('/workspace/tsconfig.json')).toEqual(before.files.get('/workspace/tsconfig.json'));

    // The fresh control proves this entry is supported; the reused service must agree with it.
    const expectedImports = freshControl.analyze(after, imports, signal).results;
    expect(expectedImports).toEqual([
      expect.objectContaining({ module: 'pkg', resolution: 'resolved', targets: [expect.objectContaining({ path: 'node_modules/pkg/b.d.ts' })] }),
    ]);
    expect(subject.analyze(after, imports, signal).results).toEqual(expectedImports);
    expect(subject.analyze(after, definition, signal).results).toEqual([
      expect.objectContaining({ path: 'node_modules/pkg/b.d.ts' }),
    ]);

    // A rejected configuration must not acknowledge changes the service has not synchronized.
    files.set('node_modules/pkg/package.json', declaration('a'));
    const pending = await captureProjectSource(access, signal);
    expect(() => subject.analyze(pending, { ...imports, configPath: 'missing.json' }, signal)).toThrow();
    expect(subject.analyze(pending, imports, signal).results).toEqual([
      expect.objectContaining({ module: 'pkg', resolution: 'resolved', targets: [expect.objectContaining({ path: 'node_modules/pkg/a.d.ts' })] }),
    ]);
    expect(subject.analyze(pending, definition, signal).results).toEqual([
      expect.objectContaining({ path: 'node_modules/pkg/a.d.ts' }),
    ]);
    // One service per analyzer; updating the package must not recreate the subject's service.
    expect(work.servicesCreated).toBe(2);
  } finally {
    subject.dispose();
    freshControl.dispose();
  }
});
