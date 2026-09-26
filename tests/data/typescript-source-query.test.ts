import { afterEach, expect, it } from 'vitest';
import type { ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { captureProjectSource } from '../../src/core/workspace/project-source-snapshot.js';
import { TypeScriptSourceAnalyzer } from '../../src/core/workspace/typescript-source-query.js';

const analyzers: TypeScriptSourceAnalyzer[] = [];
afterEach(() => { for (const analyzer of analyzers.splice(0)) analyzer.dispose(); });
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
