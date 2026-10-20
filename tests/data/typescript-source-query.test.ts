import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-snapshot.js';
import { captureProjectSource } from '../../src/core/workspace/project-source-snapshot.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const analyzers: TypeScriptSourceAnalyzer[] = [];
const roots: string[] = [];
afterEach(() => { for (const analyzer of analyzers.splice(0)) analyzer.dispose(); });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const signal = () => new AbortController().signal;
function analyzer() {
  const value = new TypeScriptSourceAnalyzer();
  analyzers.push(value);
  return value;
}

function memoryProject() {
  const files = new Map([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler' }, files: ['src/use.ts'] })],
    ['src/lib.ts', 'export function chosen() { return 1; }\n'],
    ['src/use.ts', 'import { chosen } from "./lib";\nchosen();\n'],
    ['other/extra.ts', 'export const outside = 42;\n'],
  ]);
  const denied = new Set<string>();
  let liveCalls = 0;
  const access: ProjectSourceAccess = {
    allowed: path => { liveCalls++; return !denied.has(path); },
    inventory: async () => { liveCalls++; return { paths: [...files.keys()], truncated: false }; },
    sourceIdentity: async () => { liveCalls++; return { workspace: 'frozen-query-tests', commit: 'a'.repeat(40) }; },
    read: async path => {
      liveCalls++;
      const content = files.get(path);
      if (content === undefined || denied.has(path)) throw Error('source unavailable');
      return { content };
    },
  };
  return { access, files, denied, liveCalls: () => liveCalls };
}

it('answers all five query kinds from one capture after every live access entry is disabled', async () => {
  const project = memoryProject();
  const captured = await captureProjectSource(project.access, signal());
  const callsAtCapture = project.liveCalls();
  const unavailable = () => { throw Error('frozen analysis attempted live access'); };
  project.access.allowed = unavailable;
  project.access.read = unavailable;
  project.access.inventory = unavailable;
  project.access.sourceIdentity = unavailable;
  project.files.clear();
  const subject = analyzer();

  expect(subject.analyze(captured, { operation: 'symbols' }, signal()).results).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'chosen', path: 'src/lib.ts' }),
  ]));
  expect(subject.analyze(captured, { operation: 'definitions', path: 'src/use.ts', line: 2, column: 2 }, signal()).results).toEqual([
    expect.objectContaining({ path: 'src/lib.ts', line: 1, digest: captured.files.get('/workspace/src/lib.ts')?.digest }),
  ]);
  expect(subject.analyze(captured, { operation: 'references', path: 'src/lib.ts', line: 1, column: 18 }, signal()).results).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'src/use.ts', line: 2 }),
  ]));
  expect(subject.analyze(captured, { operation: 'imports', path: 'src/use.ts' }, signal()).results).toEqual([
    expect.objectContaining({ module: './lib', resolution: 'resolved', targets: [expect.objectContaining({ path: 'src/lib.ts' })] }),
  ]);
  expect(subject.analyze(captured, { operation: 'calls', path: 'src/use.ts' }, signal()).results).toEqual([
    expect.objectContaining({ expression: 'chosen', resolution: 'static_candidate', target: expect.objectContaining({ path: 'src/lib.ts' }) }),
  ]);
  expect(project.liveCalls()).toBe(callsAtCapture);
});

it('can revisit S1 after S2 changed content and config without mutating earlier results', async () => {
  const project = memoryProject();
  const first = await captureProjectSource(project.access, signal());
  const subject = analyzer();
  const before = subject.analyze(first, { operation: 'symbols' }, signal());
  const saved = structuredClone(before);

  project.files.set('src/lib.ts', 'export function replacement() { return 2; }\n');
  project.files.set('tsconfig.json', '{"files":["src/lib.ts","other/extra.ts"]}');
  const second = await captureProjectSource(project.access, signal());
  const after = subject.analyze(second, { operation: 'symbols' }, signal());
  expect(after.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'replacement', path: 'src/lib.ts' }),
    expect.objectContaining({ name: 'outside', path: 'other/extra.ts' }),
  ]));
  expect(after.indexedSources.map(source => source.path).sort()).toEqual(['other/extra.ts', 'src/lib.ts']);
  expect(after.results).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'chosen' })]));

  const revisited = subject.analyze(first, { operation: 'symbols' }, signal());
  expect(revisited.results).toEqual(saved.results);
  expect(revisited.sources).toEqual(saved.sources);
  expect(revisited.indexedSources).toEqual(saved.indexedSources);
  expect(revisited.coverage).toEqual(saved.coverage);
  expect(before).toEqual(saved);
});

it('does not reuse a cached resolved dependency when that file is absent from a later permission-filtered capture', async () => {
  const project = memoryProject();
  const first = await captureProjectSource(project.access, signal());
  const subject = analyzer();
  const query = { operation: 'imports' as const, path: 'src/use.ts' };
  const visible = subject.analyze(first, query, signal());
  expect(visible.results).toEqual([expect.objectContaining({ resolution: 'resolved' })]);

  // The same config and root list remain; only the imported file loses permission.
  project.denied.add('src/lib.ts');
  const restricted = await captureProjectSource(project.access, signal());
  const hidden = subject.analyze(restricted, query, signal());
  expect(hidden.results).toEqual([expect.objectContaining({ resolution: 'unknown', targets: [] })]);
  expect(hidden.indexedSources.map(source => source.path)).toEqual(['src/use.ts']);
  expect(hidden.sources.some(source => source.path === 'src/lib.ts')).toBe(false);
  expect(subject.analyze(first, query, signal()).results).toEqual(visible.results);
});

it('filters output by prefix while resolving readable dependencies outside that prefix', async () => {
  const project = memoryProject();
  project.files.delete('src/use.ts');
  project.files.set('feature/main.ts', 'import { chosen } from "../src/lib";\nchosen();\n');
  project.files.set('tsconfig.json', '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"},"files":["feature/main.ts"]}');
  const captured = await captureProjectSource(project.access, signal());
  const subject = analyzer();
  const imports = subject.analyze(captured, { operation: 'imports', prefix: 'feature' }, signal());
  expect(imports.results).toEqual([
    expect.objectContaining({ path: 'feature/main.ts', resolution: 'resolved', targets: [expect.objectContaining({ path: 'src/lib.ts' })] }),
  ]);
  expect(imports.indexedSources.map(source => source.path).sort()).toEqual(['feature/main.ts', 'src/lib.ts']);
  const symbols = subject.analyze(captured, { operation: 'symbols', prefix: 'feature' }, signal());
  expect(symbols.results.length).toBeGreaterThan(0);
  expect(symbols.results.every(result => result['path'] === 'feature/main.ts')).toBe(true);
  expect(subject.analyze(captured, { operation: 'calls', prefix: 'feature' }, signal()).results).toEqual([
    expect.objectContaining({ path: 'feature/main.ts', resolution: 'static_candidate', target: expect.objectContaining({ path: 'src/lib.ts' }) }),
  ]);
});

it('rejects a cancelled analysis without preventing later analysis of the same capture', async () => {
  const captured = await captureProjectSource(memoryProject().access, signal());
  const subject = analyzer();
  const abort = new AbortController();
  abort.abort();
  expect(() => subject.analyze(captured, { operation: 'definitions', path: 'src/use.ts', line: 2, column: 2 }, abort.signal)).toThrow();
  expect(subject.analyze(captured, { operation: 'definitions', path: 'src/use.ts', line: 2, column: 2 }, signal()).results).toEqual([
    expect.objectContaining({ path: 'src/lib.ts' }),
  ]);
});

it('discovers over 64 sources from real files, honors tsconfig include and aliases, and returns source-bound cross-file results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typescript-source-query-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', paths: { '@lib/*': ['./src/*'] }, plugins: [{ name: 'MUST_NOT_EXECUTE' }] }, include: ['src/**/*.ts'] }));
  await writeFile(join(root, 'src/a.ts'), 'export function chosen() { return 1; }\n');
  await writeFile(join(root, 'src/b.ts'), 'import { chosen } from "@lib/a";\nchosen();\n');
  for (let n = 0; n < 70; n++) await writeFile(join(root, `src/unit${n}.ts`), `export const v${n} = ${n};\n`);
  await writeFile(join(root, 'excluded.ts'), 'export const excluded = 1;\n');
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  const access: ProjectSourceAccess = { read: (path, bytes) => ws.read(path, bytes), allowed: path => !path.startsWith('private'), inventory: signal => ws.listFiles(10000, { signal }), sourceIdentity: async () => ({ workspace: ws.identity, commit: 'a'.repeat(40) }) };
  const captured = await captureProjectSource(access, signal());
  const subject = analyzer();
  const result = subject.analyze(captured, { operation: 'definitions', path: 'src/b.ts', line: 2, column: 2 }, signal());
  expect(result.results).toEqual([expect.objectContaining({ path: 'src/a.ts', digest: expect.any(String), symbolId: expect.any(String) })]);
  expect(result.coverage).toMatchObject({ projectConfiguration: 'tsconfig.json', indexedSourceCount: 72 });
  const symbols = subject.analyze(captured, { operation: 'symbols' }, signal());
  expect(symbols.results.some(r => r['path'] === 'src/unit69.ts')).toBe(true);
  expect(symbols.results.some(r => r['path'] === 'excluded.ts')).toBe(false);
  expect(subject.analyze(captured, { operation: 'references', path: 'src/a.ts', line: 1, column: 18 }, signal()).results).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/b.ts', line: 2 })]));
  expect(subject.analyze(captured, { operation: 'calls', path: 'src/b.ts' }, signal()).results).toEqual([expect.objectContaining({ resolution: 'static_candidate', target: expect.objectContaining({ path: 'src/a.ts' }) })]);
});

it('reports incremental changes for a repeat read, an addition, a rename and an edit of real files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typescript-source-query-changes-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler' },
    include: ['src/**/*.ts'] }));
  await writeFile(join(root, 'src/a.ts'), 'export const a = 1;\n');
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  const access: ProjectSourceAccess = { read: (path, bytes) => ws.read(path, bytes),
    allowed: path => !path.startsWith('private'), inventory: sig => ws.listFiles(10000, { signal: sig }),
    sourceIdentity: async () => ({ workspace: ws.identity, commit: 'a'.repeat(40) }) };
  const subject = analyzer();
  const first = await captureProjectSource(access, signal());
  subject.analyze(first, { operation: 'symbols' }, signal());

  // A repeat read of the same capture changes nothing.
  expect(subject.analyze(first, { operation: 'symbols' }, signal()).changes).toMatchObject({ total: 0 });

  await writeFile(join(root, 'src/new.ts'), 'export const fresh = 1;\n');
  const addedCapture = await captureProjectSource(access, signal());
  expect(subject.analyze(addedCapture, { operation: 'symbols' }, signal()).changes)
    .toMatchObject({ added: ['src/new.ts'], total: 1 });

  await rename(join(root, 'src/new.ts'), join(root, 'src/renamed.ts'));
  const renamedCapture = await captureProjectSource(access, signal());
  expect(subject.analyze(renamedCapture, { operation: 'symbols' }, signal()).changes)
    .toMatchObject({ added: ['src/renamed.ts'], deleted: ['src/new.ts'], total: 2 });

  await writeFile(join(root, 'src/a.ts'), 'export const changed = 2;\n');
  const editedCapture = await captureProjectSource(access, signal());
  expect(subject.analyze(editedCapture, { operation: 'symbols' }, signal()).changes)
    .toMatchObject({ modified: ['src/a.ts'], total: 1 });
});

it('honors a non-wildcard tsconfig include without indexing sibling files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'typescript-source-query-include-'));
  roots.push(root);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'lib'));
  await writeFile(join(root, 'src/a.ts'), 'export function chosen() { return 1; }\n');
  await writeFile(join(root, 'src/b.ts'), 'export const sibling = 2;\n');
  await writeFile(join(root, 'lib/c.ts'), 'export const library = 3;\n');
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler' },
    include: ['src/a.ts'] }));
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  const access: ProjectSourceAccess = { read: (path, bytes) => ws.read(path, bytes),
    allowed: path => !path.startsWith('private'), inventory: sig => ws.listFiles(10000, { signal: sig }),
    sourceIdentity: async () => ({ workspace: ws.identity, commit: 'a'.repeat(40) }) };
  const captured = await captureProjectSource(access, signal());
  const result = analyzer().analyze(captured, { operation: 'symbols' }, signal());
  // The literal include names exactly one root. Only src/a.ts matches, so the
  // non-wildcard startsWith arm must not pull in its siblings.
  expect(result.results.every(r => r['path'] === 'src/a.ts')).toBe(true);
  expect(result.indexedSources.map(source => source.path)).toEqual(['src/a.ts']);
  expect(result.coverage.projectConfiguration).toBe('tsconfig.json');
  expect(result.coverage.indexedSourceCount).toBe(1);
  expect(result.results.some(r => r['path'] === 'src/b.ts' || r['path'] === 'lib/c.ts')).toBe(false);
});
