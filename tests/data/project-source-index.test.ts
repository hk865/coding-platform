import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectSourceIndex, type ProjectSourceAccess } from '../../src/core/workspace/project-source-index.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const roots: string[] = [];
const indexes: ProjectSourceIndex[] = [];
afterEach(async () => { indexes.splice(0).forEach(i => i.dispose()); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'project-index-')); roots.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'esnext', module: 'esnext', moduleResolution: 'bundler', paths: { '@lib/*': ['./src/*'] }, plugins: [{ name: 'MUST_NOT_EXECUTE' }] }, include: ['src/**/*.ts'] }));
  await writeFile(join(root, 'src/a.ts'), 'export function chosen() { return 1; }\n');
  await writeFile(join(root, 'src/b.ts'), 'import { chosen } from "@lib/a";\nchosen();\n');
  for (let n = 0; n < 70; n++) await writeFile(join(root, `src/unit${n}.ts`), `export const v${n} = ${n};\n`);
  await writeFile(join(root, 'excluded.ts'), 'export const excluded = 1;\n');
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  let commit = 'a'.repeat(40);
  const access = { read: (p: string, n: number) => ws.read(p, n), allowed: (p: string) => !p.startsWith('private'), inventory: (signal: AbortSignal) => ws.listFiles(10000, { signal }), sourceIdentity: async () => ({ workspace: ws.identity, commit }) };
  const index = new ProjectSourceIndex(access); indexes.push(index);
  return { root, index, access, changeCommit: () => { commit = 'b'.repeat(40); } };
}
it('discovers over 64 sources, honors tsconfig include and aliases, returns source-bound cross-file results', async () => {
  const { index } = await fixture();
  const result = await index.query({ operation: 'definitions', path: 'src/b.ts', line: 2, column: 2 });
  expect(result).toMatchObject({ status: 'sourced', provenance: { commit: 'a'.repeat(40) }, results: [expect.objectContaining({ path: 'src/a.ts', digest: expect.any(String), symbolId: expect.any(String) })], coverage: { projectConfiguration: 'tsconfig.json', indexedSourceCount: 72 } });
  const symbols = await index.query({ operation: 'symbols', limit: 200 });
  expect(symbols.status).toBe('sourced');
  if (symbols.status !== 'sourced') throw Error('missing index');
  expect(symbols.results.some(r => r['path'] === 'src/unit69.ts')).toBe(true);
  expect(symbols.results.some(r => r['path'] === 'excluded.ts')).toBe(false);
  expect(await index.query({ operation: 'references', path: 'src/a.ts', line: 1, column: 18 })).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'src/b.ts', line: 2 })]) });
  expect(await index.query({ operation: 'calls', path: 'src/b.ts' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ resolution: 'static_candidate', target: expect.objectContaining({ path: 'src/a.ts' }) })] });
});
it('invalidates additions, edits, renames, config and branch identity; reuses unchanged files and reconstructs after reopen', async () => {
  const { root, index, access, changeCommit } = await fixture();
  const first = await index.query({ operation: 'symbols', limit: 1 });
  if (first.status !== 'sourced') throw Error('missing index');
  expect(await index.query({ operation: 'symbols', limit: 1, expectedSnapshot: first.snapshot })).toMatchObject({ status: 'sourced', changes: { total: 0 } });
  await writeFile(join(root, 'src/new.ts'), 'export const fresh = 1;');
  expect(await index.query({ operation: 'symbols', expectedSnapshot: first.snapshot })).toMatchObject({ status: 'stale' });
  const added = await index.query({ operation: 'symbols' });
  expect(added).toMatchObject({ status: 'sourced', changes: { added: ['src/new.ts'] } });
  await rename(join(root, 'src/new.ts'), join(root, 'src/renamed.ts'));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'sourced', changes: { added: ['src/renamed.ts'], deleted: ['src/new.ts'] } });
  await writeFile(join(root, 'src/a.ts'), 'export function changed() {}');
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'sourced', changes: { modified: ['src/a.ts'] } });
  const before = await index.query({ operation: 'symbols' });
  if (before.status !== 'sourced') throw Error('missing index');
  changeCommit();
  expect(await index.query({ operation: 'symbols', expectedSnapshot: before.snapshot })).toMatchObject({ status: 'stale' });
  const restored = new ProjectSourceIndex(access); indexes.push(restored);
  const current = await index.query({ operation: 'symbols' });
  expect(await restored.query({ operation: 'symbols' })).toMatchObject({ status: 'sourced', snapshot: current.status === 'sourced' ? current.snapshot : '' });
  await writeFile(join(root, 'tsconfig.json'), '{"include":["src/a.ts"]}');
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'sourced', coverage: { indexedSourceCount: 1 } });
});
it('reports denied/config escape, unsupported languages, incomplete discovery and unknown imports honestly', async () => {
  const { root, index, access } = await fixture();
  expect(await index.query({ operation: 'symbols', prefix: '../src' })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ operation: 'definitions', path: 'private/file.ts', line: 1, column: 1 })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ operation: 'symbols', path: 'example.py' })).toMatchObject({ status: 'unsupported' });
  await writeFile(join(root, 'src/b.ts'), 'import { missing } from "unavailable";\nmissing();');
  expect(await index.query({ operation: 'imports', path: 'src/b.ts' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ module: 'unavailable', resolution: 'unknown', targets: [] })] });
  const incomplete = new ProjectSourceIndex({ ...access, inventory: async () => ({ paths: ['src/a.ts'], truncated: true }) }); indexes.push(incomplete);
  expect(await incomplete.query({ operation: 'symbols' })).toMatchObject({ status: 'rejected', message: expect.stringContaining('inventory incomplete') });
  await writeFile(join(root, 'tsconfig.json'), '{"extends":"../outside.json"}');
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'rejected' });
});

function memoryProject(importCount: number, beforeCapture?: (capture: number) => void | Promise<void>) {
  const files = new Map([
    ['tsconfig.json', '{"compilerOptions":{"module":"esnext","moduleResolution":"bundler"},"include":["src/*.ts"]}'],
    ['src/base.ts', 'export const chosen = 1;'],
    ['excluded.ts', 'export const excluded = 1;'],
    ['private/secret.ts', 'export const secret = 1;'],
  ]);
  for (let n = 0; n < importCount; n++) files.set(`src/unit${n}.ts`, 'import { chosen } from "./base"; export const result = chosen;');
  const denied = new Set(['private/secret.ts']);
  let captures = 0, reads = 0, commit = 'a'.repeat(40), failRead = false;
  const access: ProjectSourceAccess = {
    allowed: path => !denied.has(path),
    read: async path => {
      reads++;
      if (denied.has(path) || failRead || !files.has(path)) throw Error('source unavailable');
      return { content: files.get(path)! };
    },
    inventory: async () => ({ paths: [...files.keys()], truncated: false }),
    sourceIdentity: async () => {
      captures++;
      await beforeCapture?.(captures);
      return { workspace: 'memory-project', commit };
    },
  };
  const index = new ProjectSourceIndex(access); indexes.push(index);
  return { index, files, denied, captures: () => captures, reads: () => reads,
    changeCommit: () => { commit = 'b'.repeat(40); }, failReads: () => { failRead = true; } };
}

it('captures all architecture imports and indexed sources with one capture/verification pair, independently of display pages', async () => {
  const project = memoryProject(401);
  const material = await project.index.architectureMaterials();
  expect(material.imports).toHaveLength(401);
  expect(material.imports.every(relation => relation['resolution'] === 'resolved')).toBe(true);
  expect(material.sources).toHaveLength(402);
  expect(material.sources.some(source => source.path === 'src/unit400.ts')).toBe(true);
  expect(material.sources.some(source => ['excluded.ts', 'tsconfig.json', 'private/secret.ts'].includes(source.path))).toBe(false);
  expect(project.captures()).toBe(2);
  expect(project.reads()).toBe(2 * (project.files.size - project.denied.size));

  // The public tool still revalidates each separate request and limits its display manifest.
  for (const offset of [0, 200, 400]) {
    const page = await project.index.query({ operation: 'imports', expectedSnapshot: material.snapshot, offset, limit: 200 });
    expect(page).toMatchObject({ status: 'sourced', totalResults: 401, results: material.imports.slice(offset, offset + 200),
      nextOffset: offset < 400 ? offset + 200 : null, sourceCount: 404, sourcesTruncated: true });
    if (page.status !== 'sourced') throw Error('missing page');
    expect(page.sources).toHaveLength(200);
    expect(page).not.toHaveProperty('indexedSources');
  }
  expect(project.captures()).toBe(8);
});

it('keeps architecture sources bound to their analysis while another query selects a different config', async () => {
  let resumeVerification!: () => void, reachedVerification!: () => void;
  const gate = new Promise<void>(resolve => { resumeVerification = resolve; });
  const reached = new Promise<void>(resolve => { reachedVerification = resolve; });
  const project = memoryProject(1, capture => {
    if (capture === 2) { reachedVerification(); return gate; }
  });
  project.files.set('other.json', '{"files":["src/base.ts"]}');
  const pending = project.index.architectureMaterials();
  await reached;
  try {
    expect(await project.index.query({ operation: 'symbols', configPath: 'other.json' })).toMatchObject({
      status: 'sourced', coverage: { projectConfiguration: 'other.json', indexedSourceCount: 1 },
    });
  } finally { resumeVerification(); }
  expect(await pending).toMatchObject({ configPath: 'tsconfig.json', sources: [
    { path: 'src/base.ts', digest: expect.any(String) }, { path: 'src/unit0.ts', digest: expect.any(String) },
  ] });
});

it.each(['content', 'inventory', 'permissions', 'commit', 'read_failure', 'cancelled'] as const)(
  'does not publish architecture material after %s changes during capture', async change => {
    const abort = new AbortController();
    const project = memoryProject(1, capture => {
      if (capture !== 2) return;
      if (change === 'content') project.files.set('src/base.ts', 'export const chosen = 2;');
      if (change === 'inventory') project.files.set('src/new.ts', 'export const added = 1;');
      if (change === 'permissions') project.denied.add('src/base.ts');
      if (change === 'commit') project.changeCommit();
      if (change === 'read_failure') project.failReads();
      if (change === 'cancelled') abort.abort();
    });
    const status = change === 'read_failure' ? 'rejected' : change === 'cancelled' ? 'cancelled' : 'stale';
    await expect(project.index.architectureMaterials(undefined, abort.signal)).rejects.toThrow(`"status":"${status}"`);
    expect(project.captures()).toBe(2);
  },
);

it('preserves architecture import capacity and public pagination bounds', async () => {
  const project = memoryProject(1);
  project.files.set('src/unit0.ts', 'import "./base";\n'.repeat(10001));
  await expect(project.index.architectureMaterials()).rejects.toThrow('architecture import capacity exceeded');
  expect(project.captures()).toBe(2);
  expect(await project.index.query({ operation: 'imports', limit: 201 })).toMatchObject({ status: 'rejected' });
  expect(await project.index.query({ operation: 'imports', offset: -1 })).toMatchObject({ status: 'rejected' });
  expect(project.captures()).toBe(2);
});
