import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceIndex } from '../../src/data/workspace-reader/source-index.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-index-')); roots.push(root);
  await writeFile(join(root, 'a.ts'), 'export function chosen() { return 1; }\n');
  await writeFile(join(root, 'b.ts'), 'import { chosen as local } from "./a.js";\nlocal();\n// chosen is only a comment\n');
  await writeFile(join(root, 'c.ts'), 'function chosen() {}\nchosen();\n');
  const ws = await WorkspaceSandbox.create(root);
  const index = new SourceIndex({ read: (p, n) => ws.read(p, n), allowed: p => !p.startsWith('private') });
  return { index, root };
}
const paths = ['a.ts', 'b.ts', 'c.ts'];
it('resolves renamed imports across real files, excludes same-name unrelated functions and comments', async () => {
  const { index } = await fixture();
  const result = await index.query({ paths, operation: 'references', path: 'a.ts', line: 1, column: 18 });
  expect(result.status).toBe('sourced');
  if (result.status !== 'sourced') throw Error('missing index');
  expect(result.results.some(r => r['path'] === 'b.ts' && r['line'] === 2)).toBe(true);
  expect(result.results.some(r => r['path'] === 'c.ts' || r['line'] === 3)).toBe(false);
  expect(result.coverage.fullCallGraph).toBe(false);
  const definition = await index.query({ paths, operation: 'definitions', path: 'b.ts', line: 2, column: 2 });
  expect(definition).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ path: 'a.ts' })] });
});
it('binds source excerpts and index reuse to content versions, including dirty edits and deletion', async () => {
  const { index, root } = await fixture();
  const first = await index.query({ paths, operation: 'symbols' });
  if (first.status !== 'sourced') throw Error('missing index');
  const digest = first.sources[0]!.digest;
  expect(await index.excerpt('a.ts', digest, 1, 1)).toMatchObject({ status: 'sourced', content: expect.stringContaining('chosen') });
  await writeFile(join(root, 'a.ts'), 'export function replacement() {}\n');
  expect(await index.query({ paths, operation: 'symbols', expectedSnapshot: first.snapshot })).toMatchObject({ status: 'stale' });
  expect(await index.excerpt('a.ts', digest, 1, 1)).toMatchObject({ status: 'stale' });
  expect(await index.query({ paths, operation: 'symbols' })).toMatchObject({ status: 'sourced', snapshot: expect.not.stringMatching(first.snapshot) });
  await rm(join(root, 'a.ts'));
  expect(await index.query({ paths, operation: 'symbols' })).toMatchObject({ status: 'rejected' });
});
it('rejects scope escape, forbidden paths and invalid positions; declares unsupported languages', async () => {
  const { index } = await fixture();
  for (const path of ['../a.ts', 'C:/a.ts', 'private.ts']) expect(await index.query({ paths: [path], operation: 'symbols' })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ paths: ['a.py'], operation: 'symbols' })).toMatchObject({ status: 'unsupported' });
  expect(await index.query({ paths, operation: 'references', path: 'a.ts', line: 99, column: 1 })).toMatchObject({ status: 'rejected' });
});
it('reports stale if a source changes during index construction', async () => {
  let reads = 0;
  const index = new SourceIndex({ allowed: () => true, read: async () => ({ content: ++reads === 1 ? 'const before = 1;' : 'const after = 2;' }) });
  expect(await index.query({ paths: ['a.ts'], operation: 'symbols' })).toMatchObject({ status: 'stale' });
});
it('reports result truncation and unresolved dependencies instead of claiming full coverage', async () => {
  const { index } = await fixture();
  const result = await index.query({ paths: ['b.ts'], operation: 'symbols', limit: 1 });
  expect(result).toMatchObject({ status: 'sourced', coverage: { partial: true, externalDependencies: false }, diagnostics: expect.arrayContaining([expect.objectContaining({ code: 2307 })]) });
  const limited = await index.query({ paths, operation: 'symbols', limit: 1 });
  expect(limited).toMatchObject({ status: 'sourced', truncated: true });
});

it('does not read symlinks or execute project configuration, and reconstructs the same snapshot after reopening', async () => {
  const { index, root } = await fixture();
  await symlink(join(root, 'a.ts'), join(root, 'linked.ts'));
  expect(await index.query({ paths: ['linked.ts'], operation: 'symbols' })).toMatchObject({ status: 'rejected' });
  await writeFile(join(root, 'tsconfig.json'), '{ "compilerOptions": { "plugins": [{ "name": "MUST_NOT_LOAD" }] } }');
  const before = await index.query({ paths, operation: 'symbols' });
  const ws = await WorkspaceSandbox.create(root);
  const restored = new SourceIndex({ read: (p, n) => ws.read(p, n), allowed: () => true });
  expect(await restored.query({ paths, operation: 'symbols' })).toEqual(before);
});
