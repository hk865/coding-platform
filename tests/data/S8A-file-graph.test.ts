import { afterEach, expect, it } from 'vitest';
import type { ProjectFileGraphV1 } from '../../src/core/workspace/architecture-language-provider.js';
import {
  ready,
  workspaceToolsFixture,
  type Entry,
} from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A real temporary workspace behind the real permission-filtered sandbox. The unique
 * grant is explicit (no production Host policy is implied); every read is filtered by
 * `allowsRead`, so a denied path is invisible to both capture and the file graph.
 */
const fixture = workspaceToolsFixture({
  projectId: 's8a-file-graph',
  actorId: 's8a-file-graph-reader',
  permissionRevision: 's8a-file-graph-policy-v1',
  tempPrefix: 's8a-file-graph-',
  cleanups,
});

it('A-01 builds one node per readable file and only resolved import edges over the frozen capture', async () => {
  const entries: Entry[] = [
    ['src/a.ts', 'import { b } from "./b";\n\nexport const a = b;\n'],
    ['src/b.ts', 'export const b = 1;\n'],
    ['src/c.ts', 'import { d } from "./d";\n'],
    ['src/d.ts', 'export const d = 1;\n'],
    ...Array.from({ length: 201 }, (_, index): Entry => {
      const id = String(index + 1).padStart(3, '0');
      return [`src/f${id}.ts`, `export const f${id} = 1;\n`];
    }),
    // Present on disk but outside the reader's grant: must never become a node.
    ['src/denied.ts', 'export const denied = 1;\n'],
  ];
  const f = await fixture(entries, { denied: ['src/denied.ts'] });
  const graph = ready(await f.graph());

  expect(graph.nodes).toHaveLength(205);
  // §10 item 2: the file layer also stores the digest, byte size and whether the
  // scan walked the file; the three file pages keep only path/lines/language.
  expect(graph.nodes.find(node => node.path === 'src/a.ts')).toEqual({
    path: 'src/a.ts', digest: 'a021c796ff5b0d4497e3cb8e06f7dc3ff98836ba2f3657c71b828271f03dc416',
    byteSize: 46, language: 'typescript', nonBlankLines: 2, indexed: true,
  });
  expect(graph.nodes.some(node => node.path === 'src/denied.ts')).toBe(false);
  expect(graph.edges).toEqual([
    { from: 'src/a.ts', to: 'src/b.ts' },
    { from: 'src/c.ts', to: 'src/d.ts' },
  ]);
  expect(graph.unresolved).toEqual([]);
  expect(graph.languages).toEqual([
    { language: 'typescript', files: 205, parsed: 205, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true },
  ]);
  expect(graph.complete).toBe(true);
  expect(graph.inventory).toEqual({ source: 'skip_list', reason: '不是 git 仓库' });
});

it('S8A-01 records a binary file as a skipped issue of its language instead of a node', async () => {
  const f = await fixture([
    ['src/a.ts', 'export const a = 1;\n'],
    ['docs/logo.png', Buffer.from([0, 1, 2, 3, 4])],
  ]);
  const graph = ready(await f.graph());

  expect(graph.nodes.map(node => node.path)).toEqual(['src/a.ts']);
  const other = graph.languages.find(language => language.language === 'other');
  expect(other).toEqual({
    language: 'other', files: 1, parsed: 0, edges: 'unsupported', reason: '引用关系未支持', notes: [],
    issues: [{ path: 'docs/logo.png', kind: 'skipped', reason: 'binary source' }], issueCount: 1, complete: false,
  });
  expect(graph.languages.find(language => language.language === 'typescript')).toMatchObject({
    files: 1, parsed: 1, edges: 'supported', reason: null, issues: [], issueCount: 0, complete: true,
  });
  expect(graph.complete).toBe(false);
});

it('S8A-02 keeps nonBlankLines when the parser cannot make sense of the source', async () => {
  const f = await fixture([
    ['src/f.ts', 'const broken = ;\n\nexport const ok = 1;\n'],
  ]);
  const graph = ready(await f.graph());

  expect(graph.nodes).toEqual([{
    path: 'src/f.ts', digest: 'dfd1e9aa338dc839ea5f14c8ebcc5d224fce07bcf4af0db90c0d996f67f87b86',
    byteSize: 39, language: 'typescript', nonBlankLines: 2, indexed: true,
  }]);
});

it('S8A-03 captures a project with no TS files: nodes survive and other languages read unsupported', async () => {
  const f = await fixture([
    ['e.py', 'import g\n\nprint(g)\n'],
    ['g.py', 'x = 1\n'],
  ]);
  const capture = ready(await f.capture());
  expect(capture.ref.indexVersion).toContain('typescript');
  const graph = ready(await f.graph());

  expect(graph.nodes).toEqual([
    { path: 'e.py', digest: '14bf2775fb8a0a7e078dc0b38ccda0d22fe4c500ebe24811b8447cb5492704f0',
      byteSize: 19, language: 'python', nonBlankLines: 2, indexed: true },
    { path: 'g.py', digest: '9e26bf369911c45c243c684147b23fc9e1dcfcf257d299a1c632016a6fcd33f4',
      byteSize: 6, language: 'python', nonBlankLines: 1, indexed: true },
  ]);
  expect(graph.languages).toEqual([
    { language: 'python', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true },
  ]);
  expect(graph.edges).toEqual([{ from: 'e.py', to: 'g.py' }]);
  expect(graph.unresolved).toEqual([]);
});

it('S8A-04 rejects with capacity and the count reached when the injected file cap is exceeded', async () => {
  const f = await fixture([
    ['src/a.ts', 'export const a = 1;\n'],
    ['src/b.ts', 'export const b = 1;\n'],
    ['src/c.ts', 'export const c = 1;\n'],
  ], { fileGraph: { maxNodes: 2, maxEdges: 100000 } });
  const result = await f.graph();
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw Error('unreachable');
  expect(result.code).toBe('capacity');
  expect(result.reason).toMatch(/\b2\b/);
});

it('S8A-05 reports the supported typescript coverage entry alongside an unsupported language', async () => {
  const f = await fixture([
    ['src/a.ts', 'export const a = 1;\n'],
    ['src/b.ts', 'export const b = 1;\n'],
    ['native/c.cpp', 'int f() { return 0; }\n'],
  ]);
  const graph: ProjectFileGraphV1 = ready(await f.graph());

  expect(graph.languages).toEqual([
    { language: 'cpp', files: 1, parsed: 0, edges: 'failed', reason: '没有 compile_commands.json', notes: [], issues: [], issueCount: 0, complete: false },
    { language: 'typescript', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true },
  ]);
});

it('S8A-09 keeps the surviving TS nodes and records a binary TS file as a skipped issue', async () => {
  const f = await fixture([
    ['src/good.ts', 'export const good = 1;\n'],
    ['src/bad.ts', 'export const bad = "\0";\n'],
  ]);
  const graph = ready(await f.graph());

  expect(graph.nodes).toEqual([{
    path: 'src/good.ts', digest: '69e6ea1e2f4725eab818e2815f2e083544136eb8b2c267afbc0b0b804c91af52',
    byteSize: 23, language: 'typescript', nonBlankLines: 1, indexed: true,
  }]);
  expect(graph.languages).toEqual([
    { language: 'typescript', files: 2, parsed: 1, edges: 'supported', reason: null, notes: [],
      issues: [{ path: 'src/bad.ts', kind: 'skipped', reason: 'binary source' }], issueCount: 1, complete: false },
  ]);
  expect(graph.complete).toBe(false);
});

it('S8A-10 consumes the frozen observation material and verify detects a later non-TS change', async () => {
  const f = await fixture([
    ['script.py', 'x = 1\n'],
    ['src/good.ts', 'export const good = 1;\n'],
  ]);
  const capture = ready(await f.capture());
  await f.edit('script.py', 'x = 1\ny = 2\nz = 3\n');
  const graph = ready(await f.graphOf(capture.ref));

  // The file graph never re-reads the worktree: the edited Python file stays as captured.
  expect(graph.nodes).toEqual([
    { path: 'script.py', digest: '9e26bf369911c45c243c684147b23fc9e1dcfcf257d299a1c632016a6fcd33f4',
      byteSize: 6, language: 'python', nonBlankLines: 1, indexed: true },
    { path: 'src/good.ts', digest: '69e6ea1e2f4725eab818e2815f2e083544136eb8b2c267afbc0b0b804c91af52',
      byteSize: 23, language: 'typescript', nonBlankLines: 1, indexed: true },
  ]);
  // The tolerant digest covers every observed file, so verify reports the Python edit as stale.
  expect(await f.handle.tools.verifyCapture(f.context, capture.ref))
    .toMatchObject({ status: 'rejected', code: 'source_stale' });
});

it('S8A-11 resolves the capture config alias in the file layer and counts only TS indexed sources', async () => {
  const f = await fixture([
    ['tsconfig.app.json', JSON.stringify({
      compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true, paths: { '@lib/*': ['src/lib/*'] } },
      include: ['src/**/*.ts'],
    })],
    ['src/a.ts', 'import { b } from "@lib/b";\nexport const a = b;\n'],
    ['src/lib/b.ts', 'export const b = 1;\n'],
  ]);
  const capture = ready(await f.capture('tsconfig.app.json'));
  const graph = ready(await f.graphOf(capture.ref));

  expect(graph.edges).toEqual([{ from: 'src/a.ts', to: 'src/lib/b.ts' }]);
  expect(graph.languages.find(language => language.language === 'typescript'))
    .toMatchObject({ files: 2, parsed: 2, edges: 'supported', reason: null, complete: true });
});

it('S8A-12 never counts JSON modules as parsed TS sources', async () => {
  const f = await fixture([
    ['tsconfig.json', JSON.stringify({
      compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noLib: true, resolveJsonModule: true },
      include: ['src/**/*.ts'],
    })],
    ['src/a.ts', 'import data from "./data.json";\nexport const a = data;\n'],
    ['src/data.json', '{"value":1}\n'],
  ]);
  const capture = ready(await f.capture('tsconfig.json'));
  const graph = ready(await f.graphOf(capture.ref));

  const typescript = graph.languages.find(language => language.language === 'typescript')!;
  expect(typescript.files).toBe(1);
  expect(typescript.parsed).toBe(1);
  expect(typescript.parsed).toBeLessThanOrEqual(typescript.files);
});

it('S8A-13 rejects a file graph over a strict capture as unsupported', async () => {
  const f = await fixture([['src/a.ts', 'export const a = 1;\n']]);
  const strict = ready(await f.strictCapture());

  expect(await f.graphOf(strict.ref)).toMatchObject({ status: 'rejected', code: 'unsupported' });
});
