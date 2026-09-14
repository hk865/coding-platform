import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PythonSourceIndex } from '../../src/data/workspace-reader/python-source-index.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'python-index-')); roots.push(root);
  await mkdir(join(root, 'pkg')); await writeFile(join(root, 'pkg/__init__.py'), '');
  await writeFile(join(root, 'pkg/a.py'), 'def chosen():\n    return 1\n');
  await writeFile(join(root, 'pkg/b.py'), 'from .a import chosen as local\nlocal()\n');
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  let commit = 'a'.repeat(40);
  return { root, setCommit: (value: string) => { commit = value; }, index: new PythonSourceIndex({ read: (p, n) => ws.read(p, n), allowed: p => !p.startsWith('private'), inventory: signal => ws.listFiles(10000, { signal }), sourceIdentity: async () => ({ workspace: ws.identity, commit }) }) };
}
it('resolves Python aliases across project files without executing source and invalidates dirty code', async () => {
  const { root, index } = await fixture();
  await writeFile(join(root, 'dangerous.py'), `from pathlib import Path\nPath(${JSON.stringify(join(root, 'MUST_NOT_EXIST'))}).write_text('bad')\n`);
  const result = await index.query({ operation: 'definitions', path: 'pkg/b.py', line: 2, column: 2 });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'sourced', engine: 'jedi', results: expect.arrayContaining([expect.objectContaining({ path: 'pkg/a.py', name: 'chosen', line: 1 })]) });
  if (result.status !== 'sourced') throw Error('missing Python semantic provider');
  const digestOf = async (path: string) => createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
  expect(result.provenance.toolchain).toEqual({
    scriptDigest: await digestOf('../../scripts/python-source-query.py'),
    dependencyArchiveDigest: await digestOf('../../.local/source-analyzers/analyzers.zip'),
    dependencyManifestDigest: await digestOf('../../.local/source-analyzers/manifest.json'),
  });
  expect(await index.query({ operation: 'references', path: 'pkg/a.py', line: 1, column: 6 })).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'pkg/b.py', line: 2 })]) });
  expect(await index.query({ operation: 'calls', path: 'pkg/b.py' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ resolution: 'static_candidate', targets: expect.arrayContaining([expect.objectContaining({ path: 'pkg/a.py' })]) })] });
  await expect(access(join(root, 'MUST_NOT_EXIST'))).rejects.toThrow();
  await writeFile(join(root, 'pkg/a.py'), 'def replacement():\n    return 2\n');
  expect(await index.query({ operation: 'symbols', expectedSnapshot: result.snapshot })).toMatchObject({ status: 'stale' });
  expect(await index.query({ operation: 'symbols', path: 'pkg/a.py' })).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ name: 'replacement' })]) });
}, 60000);
it('rejects Python scope escapes and keeps unresolved dependencies unknown', async () => {
  const { root, index } = await fixture();
  expect(await index.query({ operation: 'symbols', path: '../secret.py' })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ operation: 'symbols', path: 'private/secret.py' })).toMatchObject({ status: 'rejected' });
  await writeFile(join(root, 'pkg/b.py'), 'from missing_library import unknown\nunknown()\n');
  expect(await index.query({ operation: 'imports', path: 'pkg/b.py' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ resolution: 'unknown', targets: [] })] });
}, 60000);

it.each([
  ['pyproject.toml', '[tool.setuptools.package-dir]\n"" = "lib"\n[tool.pyright]\nextraPaths = ["vendor"]\n'],
  ['pyrightconfig.json', JSON.stringify({ extraPaths: ['lib', 'vendor'] })],
  ['setup.cfg', '[options]\npackage_dir =\n    = lib\n[options.packages.find]\nwhere = lib, vendor\n'],
])('resolves configured package and workspace dependency roots from %s', async (configPath, content) => {
  const { root, index } = await fixture();
  for (const [path, text] of Object.entries({
    [configPath]: content,
    'lib/app/__init__.py': '',
    'lib/app/main.py': 'from dependency.api import original as imported\ndef chosen():\n    return imported()\n',
    'vendor/dependency/__init__.py': '',
    'vendor/dependency/api.py': 'def original():\n    return 1\n',
    'client.py': 'from app.main import chosen\nchosen()\n',
  })) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  expect(await index.query({ operation: 'definitions', path: 'client.py', line: 2, column: 2, configPath })).toMatchObject({
    status: 'sourced', results: [expect.objectContaining({ path: 'lib/app/main.py', name: 'chosen' })],
    coverage: { projectConfiguration: configPath, importRoots: expect.arrayContaining(['lib', 'vendor']), projectCodeExecuted: false },
  });
  expect(await index.query({ operation: 'imports', path: 'lib/app/main.py', configPath })).toMatchObject({
    status: 'sourced', results: [expect.objectContaining({ resolution: 'resolved', targets: [expect.objectContaining({ path: 'vendor/dependency/api.py', name: 'original' })] })],
  });
  const references = await index.query({ operation: 'references', path: 'vendor/dependency/api.py', line: 1, column: 6, configPath });
  expect(references, JSON.stringify(references)).toMatchObject({
    status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'lib/app/main.py', line: 3 })]),
  });
}, 60000);

it('recognizes a src namespace layout and safely parses setuptools discovery metadata', async () => {
  const { root, index } = await fixture();
  await mkdir(join(root, 'src/namespace'), { recursive: true });
  await writeFile(join(root, 'src/namespace/api.py'), 'def exported():\n    return 1\n');
  await writeFile(join(root, 'client.py'), 'from namespace.api import exported\nexported()\n');
  const query = { operation: 'definitions' as const, path: 'client.py', line: 2, column: 2 };
  expect(await index.query(query)).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ path: 'src/namespace/api.py' })] });
  await writeFile(join(root, 'pyproject.toml'), '[build-system]\nrequires = ["untrusted-backend"]\nbuild-backend = "dangerous"\n[tool.setuptools.packages.find]\nwhere = ["src"]\n[tool.setuptools.dynamic]\nversion = {attr = "dangerous.run"}\n');
  await writeFile(join(root, 'setup.py'), `from pathlib import Path\nPath(${JSON.stringify(join(root, 'SETUP_MUST_NOT_RUN'))}).write_text('bad')\n`);
  expect(await index.query(query)).toMatchObject({ status: 'sourced', coverage: { projectCodeExecuted: false, importRoots: expect.arrayContaining(['src']) }, results: [expect.objectContaining({ path: 'src/namespace/api.py' })] });
  await expect(access(join(root, 'SETUP_MUST_NOT_RUN'))).rejects.toThrow();
}, 60000);

it('invalidates configuration, dependency content, manifests, deletes and source identity without reusing stale results', async () => {
  const { root, index, setCommit } = await fixture();
  for (const directory of ['dep-one', 'dep-two']) {
    await mkdir(join(root, directory)); await writeFile(join(root, directory, 'api.py'), 'def chosen():\n    return 1\n');
  }
  await writeFile(join(root, 'client.py'), 'from api import chosen\nchosen()\n');
  await writeFile(join(root, 'pyrightconfig.json'), JSON.stringify({ extraPaths: ['dep-one'] }));
  await writeFile(join(root, 'requirements.txt'), 'example==1.0\n');
  const query = { operation: 'definitions' as const, path: 'client.py', line: 2, column: 2 };
  const first = await index.query(query);
  expect(first).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ path: 'dep-one/api.py' })], index: { reusedResult: false } });
  if (first.status !== 'sourced') throw Error(JSON.stringify(first));
  expect(await index.query(query)).toMatchObject({ status: 'sourced', snapshot: first.snapshot, index: { reusedResult: true } });
  await writeFile(join(root, 'pyrightconfig.json'), JSON.stringify({ extraPaths: ['dep-two'] }));
  expect(await index.query({ ...query, expectedSnapshot: first.snapshot })).toMatchObject({ status: 'stale' });
  const changed = await index.query(query);
  expect(changed).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ path: 'dep-two/api.py' })], index: { reusedResult: false, changed: expect.arrayContaining([{ path: 'pyrightconfig.json', kind: 'configuration' }]) } });
  if (changed.status !== 'sourced') throw Error(JSON.stringify(changed));
  await writeFile(join(root, 'dep-two/api.py'), 'def chosen():\n    return 2\n');
  expect(await index.query({ ...query, expectedSnapshot: changed.snapshot })).toMatchObject({ status: 'stale' });
  const dirty = await index.query(query);
  if (dirty.status !== 'sourced') throw Error(JSON.stringify(dirty));
  await writeFile(join(root, 'requirements.txt'), 'example==2.0\n');
  expect(await index.query({ ...query, expectedSnapshot: dirty.snapshot })).toMatchObject({ status: 'stale' });
  expect(await index.query(query)).toMatchObject({ status: 'sourced', index: { changed: [{ path: 'requirements.txt', kind: 'dependency_manifest' }] }, coverage: { dependencyManifests: [expect.objectContaining({ path: 'requirements.txt' })] } });
  await rm(join(root, 'dep-one/api.py'));
  const deleted = await index.query(query);
  expect(deleted).toMatchObject({ status: 'sourced', index: { removed: [{ path: 'dep-one/api.py', kind: 'source' }] } });
  if (deleted.status !== 'sourced') throw Error(JSON.stringify(deleted));
  setCommit('b'.repeat(40));
  expect(await index.query({ ...query, expectedSnapshot: deleted.snapshot })).toMatchObject({ status: 'stale' });
  expect(await index.query(query)).toMatchObject({ status: 'sourced', provenance: { commit: 'b'.repeat(40) }, index: { reusedResult: false } });
}, 60000);

it('reports one-based UTF-16 locations while converting AST UTF-8 byte offsets and Jedi code points', async () => {
  const { root, index } = await fixture();
  const source = '标记 = "😀"; from pkg.a import chosen\n标记 = "😀"; chosen()\n';
  await writeFile(join(root, 'unicode.py'), source);
  const first = source.split('\n')[0]!, second = source.split('\n')[1]!;
  expect(await index.query({ operation: 'definitions', path: 'unicode.py', line: 2, column: second.indexOf('😀') + 2 })).toMatchObject({ status: 'rejected', message: expect.stringContaining('Unicode') });
  expect(await index.query({ operation: 'imports', path: 'unicode.py' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ column: first.indexOf('from') + 1, resolution: 'resolved', targets: [expect.objectContaining({ path: 'pkg/a.py' })] })] });
  expect(await index.query({ operation: 'calls', path: 'unicode.py' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ column: second.indexOf('chosen') + 1, resolution: 'static_candidate', targets: [expect.objectContaining({ path: 'pkg/a.py' })] })] });
  expect(await index.query({ operation: 'definitions', path: 'unicode.py', line: 2, column: second.indexOf('chosen') + 2 })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ path: 'pkg/a.py', line: 1, column: 5 })] });
  const references = await index.query({ operation: 'references', path: 'pkg/a.py', line: 1, column: 6 });
  expect(references, JSON.stringify(references)).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'unicode.py', line: 2, column: second.indexOf('chosen') + 1 })]) });
}, 60000);

it('rejects denied, absolute and traversing configuration roots and declares unsupported environment semantics', async () => {
  const { root, index } = await fixture();
  expect(await index.query({ operation: 'symbols', configPath: '../pyproject.toml' })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ operation: 'symbols', configPath: 'private/pyproject.toml' })).toMatchObject({ status: 'rejected' });
  for (const path of ['../secret', '/tmp', 'C:/source', 'private', '.venv/lib', '${HOME}/lib']) {
    await writeFile(join(root, 'pyrightconfig.json'), JSON.stringify({ extraPaths: [path] }));
    expect(await index.query({ operation: 'symbols' }), path).toMatchObject({ status: 'rejected', message: expect.stringMatching(/configuration/) });
  }
  await writeFile(join(root, 'pyrightconfig.json'), JSON.stringify({ executionEnvironments: [{ root: '.', extraPaths: ['pkg'] }] }));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('executionEnvironments') });
}, 60000);

it('refuses an incomplete inventory and detects source changes during analysis', async () => {
  const identity = async () => ({ workspace: 'isolated-test', commit: null });
  const incomplete = new PythonSourceIndex({ read: async () => ({ content: 'def chosen():\n    pass\n' }), allowed: () => true,
    inventory: async () => ({ paths: ['main.py'], truncated: true }), sourceIdentity: identity });
  expect(await incomplete.query({ operation: 'symbols' })).toMatchObject({ status: 'rejected', message: expect.stringContaining('inventory incomplete') });
  let reads = 0;
  const changing = new PythonSourceIndex({ read: async () => ({ content: reads++ === 0 ? 'def chosen():\n    pass\n' : 'def changed():\n    pass\n' }), allowed: () => true,
    inventory: async () => ({ paths: ['main.py'], truncated: false }), sourceIdentity: identity });
  expect(await changing.query({ operation: 'symbols' })).toMatchObject({ status: 'stale', message: expect.stringContaining('during analysis') });
}, 60000);

it('keeps module file anchors distinct from declarations and isolates cached results from caller mutation', async () => {
  const { root, index } = await fixture();
  await writeFile(join(root, 'api.py'), 'value = 1\n');
  await writeFile(join(root, 'client.py'), 'import api\nprint(api.value)\n');
  const query = { operation: 'references' as const, path: 'api.py', line: 1, column: 2 };
  const first = await index.query(query);
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'client.py', line: 2, column: 11 })]) });
  if (first.status !== 'sourced') throw Error(JSON.stringify(first));
  expect(first.results.some(item => item['path'] === 'client.py' && item['line'] === 1)).toBe(false);
  const expected = structuredClone(first.results);
  if (first.results[0]) first.results[0]['path'] = 'forged.py';
  expect(await index.query(query)).toMatchObject({ status: 'sourced', results: expected, index: { reusedResult: true } });
  await mkdir(join(root, 'nested/src/inner'), { recursive: true });
  await writeFile(join(root, 'nested/src/inner/api.py'), 'def chosen():\n    return 1\n');
  await writeFile(join(root, 'nested/client.py'), 'from inner.api import chosen\nchosen()\n');
  await writeFile(join(root, 'nested/pyrightconfig.json'), '{}');
  expect(await index.query({ operation: 'definitions', path: 'nested/client.py', line: 2, column: 2, configPath: 'nested/pyrightconfig.json' })).toMatchObject({
    status: 'sourced', coverage: { importRoots: ['nested', 'nested/src'] }, results: [expect.objectContaining({ path: 'nested/src/inner/api.py' })],
  });
}, 60000);

it('enforces the per-file byte bound even when a source adapter ignores its requested maximum', async () => {
  const index = new PythonSourceIndex({
    read: async () => ({ content: '😀'.repeat(512 * 1024 + 1) }),
    allowed: () => true,
    inventory: async () => ({ paths: ['large.py'], truncated: false }),
    sourceIdentity: async () => ({ workspace: 'capacity-test', commit: null }),
  });
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'rejected', message: 'Python material exceeds 2 MiB capacity: large.py' });
});
