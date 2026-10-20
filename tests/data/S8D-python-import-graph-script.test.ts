import { afterEach, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Script-level tracer tests for slice-8 §11.3: the frozen `import_graph` NDJSON
 * operation. Expected values are the literal §11.6 rows, not this script's own
 * output.
 */
const SCRIPT = fileURLToPath(new URL('../../scripts/python-source-query.py', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

type Json = Record<string, any>;
type Run = { code: number | null; stdout: string; stderr: string };

function run(args: string[], input: string, extraEnv: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-I', '-S', SCRIPT, ...args], {
      cwd: REPO, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', ...extraEnv },
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 's8d-python-import-graph-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function ndjson(stdout: string): Json[] {
  return stdout.split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as Json);
}

async function scan(files: Record<string, string>, config: { path: string; content: string } | null) {
  const root = await workspace(files);
  const paths = Object.keys(files).sort();
  const input = [
    JSON.stringify({ t: 'header', v: 1, paths, config, resumeFrom: 0 }),
    ...paths.map(path => JSON.stringify({ t: 'file', path, content: files[path] })),
  ].join('\n') + '\n';
  const result = await run(['import_graph'], input);
  expect(result.code, result.stderr).toBe(0);
  const lines = ndjson(result.stdout);
  const ready = lines.find(line => line.t === 'ready');
  const failed = lines.find(line => line.t === 'failed');
  const done = lines.filter(line => line.t === 'done');
  const edges = done.flatMap(line => (line.edges as [string, string, string][]));
  const unresolved = done.flatMap(line => (line.unresolved as { from: string; specifier: string; reason: string | null }[]));
  const statuses = done.flatMap(line => (line.files as { path: string; status: string; reason?: string }[]));
  return { root, lines, ready, failed, done, edges, unresolved, statuses };
}

const pairs = (edges: [string, string, string][]) => edges.map(([from, to]) => [from, to]);
const sorted = <T,>(items: T[]) => [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

/** A-20 material, copied literally from §11.6. */
const A20: Record<string, string> = {
  'app.py': [
    'import a.b.c', 'import a.b.c.d', 'import mod.x', 'import email', 'import ns', 'import ns.mod',
    'import fast', 'import native', 'import plug', 'import shared.util', 'from shared import util',
    'from pkg import sub, name', 'from pkg import *', 'import os', 'from tools import run', '',
  ].join('\n'),
  'a/__init__.py': '', 'a/b/__init__.py': '', 'a/b/c.py': '',
  'mod.py': '', 'mod/x.py': '',
  'email/utils.py': '', 'ns/mod.py': '',
  'nsuser.py': 'from ns import nothere\nfrom ns import mod\n',
  'fast.py': '', 'fast.pyi': '', 'native.pyi': '',
  'plug/x.py': '', 'lib/plug/__init__.py': '',
  'shared/__init__.py': '', 'lib/shared/util.py': '',
  'pkg/__init__.py': 'from . import sub\nfrom . import helper\nfrom .. import top\nhelper = 1\n',
  'pkg/sub.py': 'from .inner import k\nfrom .deep.leaf import z\nfrom .json import y\n',
  'pkg/inner.py': '', 'pkg/deep/__init__.py': '', 'pkg/deep/leaf.py': '',
  'pkg/json/data.py': '', 'tools/cfg.py': '',
  'solo.py': 'from . import x\n',
};

it('A-20 resolves the twelve Python edges and the eleven unresolved specifiers with the frozen reasons', async () => {
  const { ready, edges, unresolved, statuses } = await scan(A20, { path: 'pyrightconfig.json', content: '{"extraPaths": ["lib"]}' });

  expect(ready?.units).toEqual(Object.keys(A20).sort());
  expect(ready?.notes).toEqual([]);
  expect(sorted(pairs(edges))).toEqual(sorted([
    ['app.py', 'a/b/c.py'], ['app.py', 'fast.py'], ['app.py', 'lib/plug/__init__.py'],
    ['app.py', 'native.pyi'], ['app.py', 'ns/mod.py'], ['app.py', 'pkg/__init__.py'],
    ['app.py', 'pkg/sub.py'], ['app.py', 'shared/__init__.py'], ['nsuser.py', 'ns/mod.py'],
    ['pkg/__init__.py', 'pkg/sub.py'], ['pkg/sub.py', 'pkg/deep/leaf.py'], ['pkg/sub.py', 'pkg/inner.py'],
  ]));
  expect(sorted(edges)).toEqual(sorted([
    ['app.py', 'a/b/c.py', 'a.b.c'], ['app.py', 'fast.py', 'fast'], ['app.py', 'lib/plug/__init__.py', 'plug'],
    ['app.py', 'native.pyi', 'native'], ['app.py', 'ns/mod.py', 'ns.mod'], ['app.py', 'pkg/__init__.py', 'pkg'],
    ['app.py', 'pkg/sub.py', 'pkg'], ['app.py', 'shared/__init__.py', 'shared'], ['nsuser.py', 'ns/mod.py', 'ns'],
    ['pkg/__init__.py', 'pkg/sub.py', '.'], ['pkg/sub.py', 'pkg/deep/leaf.py', '.deep.leaf'],
    ['pkg/sub.py', 'pkg/inner.py', '.inner'],
  ]));
  expect(sorted(unresolved)).toEqual(sorted([
    { from: 'app.py', specifier: 'a.b.c.d', reason: 'a.b.c 是模块，不是包' },
    { from: 'app.py', specifier: 'email', reason: '命名空间目录和标准库重名' },
    { from: 'app.py', specifier: 'mod.x', reason: 'mod 是模块，不是包' },
    { from: 'app.py', specifier: 'ns', reason: '命名空间目录，可能是同名的外部包' },
    { from: 'app.py', specifier: 'os', reason: '标准库' },
    { from: 'app.py', specifier: 'shared.util', reason: null },
    { from: 'app.py', specifier: 'tools', reason: '命名空间目录，可能是同名的外部包' },
    { from: 'nsuser.py', specifier: 'ns', reason: '命名空间目录，可能是同名的外部包' },
    { from: 'pkg/__init__.py', specifier: '..', reason: '相对导入越过了顶层包' },
    { from: 'pkg/sub.py', specifier: '.json', reason: '命名空间包，没有文件' },
    { from: 'solo.py', specifier: '.', reason: '相对导入越过了顶层包' },
  ]));
  expect(statuses).toHaveLength(24);
  expect(statuses.every(status => status.status === 'parsed')).toBe(true);
});

const A21: Record<string, string> = {
  'a.py': 'import b\n', 'b.py': '', 'd.py': 'import c\n', 'lib/c.py': '', 'bad.py': 'def broken(:\n',
};

it('A-21 fails on extraPaths as a string with the frozen configuration literal', async () => {
  const config = '[tool.pyright]\nextraPaths = "lib"\n';
  const { ready, failed, edges, statuses } = await scan(A21, { path: 'pyproject.toml', content: config });
  expect(ready).toBeUndefined();
  expect(failed).toEqual({ t: 'failed', reason: '配置错误：pyproject.toml 的 extraPaths 不是字符串列表' });
  expect(edges).toEqual([]);
  expect(statuses).toEqual([]);
});

it('turns a RecursionError from deeply nested selected configuration JSON into one failed line', async () => {
  const config = '['.repeat(10000) + ']'.repeat(10000);
  const { lines, ready, failed } = await scan(A21, { path: 'pyrightconfig.json', content: config });
  expect(ready).toBeUndefined();
  expect(lines).toHaveLength(1);
  expect(failed?.t).toBe('failed');
  expect(failed?.reason).toMatch(/^RecursionError: maximum recursion depth exceeded/);
});

it('python_index keeps the shared root order: packages.find where before pyright extraPaths', async () => {
  const ANALYZERS = join(REPO, '.local', 'source-analyzers');
  const files = [
    { path: 'x.py', content: 'import m\n', digest: 'x', kind: 'source' },
    { path: 'a/m.py', content: '', digest: 'a', kind: 'source' },
    { path: 'b/m.py', content: '', digest: 'b', kind: 'source' },
    { path: 'pyproject.toml', content: '[tool.setuptools.packages.find]\nwhere = ["a"]\n[tool.pyright]\nextraPaths = ["b"]\n', digest: 'c', kind: 'configuration' },
  ];
  const cache = await mkdtemp(join(tmpdir(), 's8d-python-cache-'));
  roots.push(cache);
  const result = await run([ANALYZERS], JSON.stringify({ files, query: { operation: 'imports', path: 'x.py' } }), { XDG_CACHE_HOME: cache });
  expect(result.code, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.status).toBe('sourced');
  expect(parsed.results).toContainEqual(expect.objectContaining({
    module: 'm', resolution: 'resolved', targets: [expect.objectContaining({ path: 'a/m.py' })],
  }));
});
