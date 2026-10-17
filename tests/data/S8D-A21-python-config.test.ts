import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExplorationTools } from '../../src/core/agent-runtime/exploration-tools.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { BACKENDS, fixture, type Entry, type GraphShape } from '../helpers/S8D-platform-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const coverageOf = (graph: GraphShape, language: string) => graph.languages.find(entry => entry.language === language);

/** Compare reference sets by value; the capture sorts into its own order. */
function byKey<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left), b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
const edgePairs = (graph: GraphShape) => byKey(graph.edges.map(edge => [edge.from, edge.to] as [string, string]), pair => pair.join('\0'));
const unresolvedPairs = (graph: GraphShape) => byKey(graph.unresolved.map(item => [item.from, item.specifier] as [string, string]), pair => pair.join('\0'));

const ANALYZERS = fileURLToPath(new URL('../../.local/source-analyzers', import.meta.url));

/** Call the exploration tool the same way the model loop does; returns the wrapped inner value. */
async function pythonIndex(root: string, args: Record<string, unknown>) {
  const workspace = await WorkspaceSandbox.create(root);
  const group = createExplorationTools(workspace, { sourceAnalyzers: { directory: ANALYZERS } });
  cleanups.push(() => group.close());
  const tool = group.tools.find(candidate => candidate.name === 'python_index');
  expect(tool).toBeDefined();
  const result = await tool!.handler.execute({
    schemaVersion: 1, callId: 's8d-a21-python-config', name: 'python_index', arguments: args,
  } as never, { signal: new AbortController().signal } as never) as unknown as { status: string; output?: Array<{ value?: unknown }> };
  return { status: result.status, value: result.output?.[0]?.value };
}

/** A real executable `pythonPath` wrapper that records that the analyzer was started. */
async function countingPythonPath() {
  const directory = await mkdtemp(join(tmpdir(), 's8d-a21-counting-wrapper-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const counter = join(directory, 'starts.txt');
  const path = join(directory, 'python');
  await writeFile(path, `#!/bin/sh\nprintf 'started\\n' >> ${JSON.stringify(counter)}\nexec /usr/bin/python3 "$@"\n`);
  await chmod(path, 0o755);
  return { path, counter };
}

const BASE: Entry[] = [
  ['a.py', 'import b\n'],
  ['b.py', ''],
  ['d.py', 'import c\n'],
  ['lib/c.py', ''],
  ['bad.py', 'def broken(:\n'],
];

describe.each(BACKENDS)('A-21 Python errors and configuration [%s]', backend => {
  const projectId = `s8d-a21-python-config-${backend}`;

  it('A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyproject.toml', '[tool.pyright]\npythonVersion = "3.11"\nextraPaths = ["lib"]\n']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 4, edges: 'supported', reason: null,
        notes: ['pyproject.toml 里观测不用的字段：pythonVersion'],
        issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }],
        issueCount: 1, complete: false,
      });
      expect(edgePairs(graph)).toEqual([['a.py', 'b.py'], ['d.py', 'lib/c.py']]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 python_index returns the pythonVersion unsupported message for the same configuration', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyproject.toml', '[tool.pyright]\npythonVersion = "3.11"\nextraPaths = ["lib"]\n']]);
    try {
      const result = await pythonIndex(f.root, { operation: 'imports', path: 'a.py' });
      expect(result.status).toBe('success');
      expect(result.value).toMatchObject({
        status: 'unsupported',
        message: 'pythonVersion is not supported by the isolated Jedi provider; select a configuration with workspace import roots',
      });
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 fails the language when pyproject extraPaths is not a string list', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyproject.toml', '[tool.pyright]\nextraPaths = "lib"\n']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 0, edges: 'failed',
        reason: '配置错误：pyproject.toml 的 extraPaths 不是字符串列表', notes: [], issues: [], issueCount: 0, complete: false,
      });
      expect(graph.edges).toEqual([]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 notes an unusable vendor root and leaves its imports unresolved', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyproject.toml', '[tool.pyright]\nextraPaths = ["vendor"]\n']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 4, edges: 'supported', reason: null,
        notes: ['pyproject.toml 里用不了的查找根：vendor'],
        issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }],
        issueCount: 1, complete: false,
      });
      expect(edgePairs(graph)).toEqual([['a.py', 'b.py']]);
      expect(unresolvedPairs(graph)).toEqual([['d.py', 'c']]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 python_index rejects an unusable vendor import root', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyproject.toml', '[tool.pyright]\nextraPaths = ["vendor"]\n']]);
    try {
      const result = await pythonIndex(f.root, { operation: 'imports', path: 'a.py' });
      expect(result.status).toBe('success');
      expect(result.value).toMatchObject({
        status: 'rejected',
        message: 'Python configuration: configuration import root unavailable in readable snapshot: vendor',
      });
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 fails the language when the root pyrightconfig.json is binary', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyrightconfig.json', '{"extraPaths": ["lib"]}\0']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 0, edges: 'failed',
        reason: 'pyrightconfig.json 读不了：binary source', notes: [], issues: [], issueCount: 0, complete: false,
      });
      expect(graph.edges).toEqual([]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 fails the language when pyrightconfig.json extends another configuration', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyrightconfig.json', '{"extends": "base.json"}']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 0, edges: 'failed',
        reason: '配置错误：pyrightconfig.json 的 extends 观测还不跟进', notes: [], issues: [], issueCount: 0, complete: false,
      });
      expect(graph.edges).toEqual([]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 uses the setuptools find.where root before the pyright extraPaths root', async () => {
    const f = await fixture(backend, projectId, [
      ['x.py', 'import m\n'],
      ['a/m.py', ''],
      ['b/m.py', ''],
      ['pyproject.toml', '[tool.setuptools.packages.find]\nwhere = ["a"]\n[tool.pyright]\nextraPaths = ["b"]\n'],
    ]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 3, parsed: 3, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
      });
      expect(edgePairs(graph)).toEqual([['x.py', 'a/m.py']]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root', async () => {
    const f = await fixture(backend, projectId, [...BASE, ['pyrightconfig.json', '{\n  // roots\n  "extraPaths": ["lib/",], /* x */\n}\n']]);
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 5, parsed: 4, edges: 'supported', reason: null, notes: [],
        issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }],
        issueCount: 1, complete: false,
      });
      expect(edgePairs(graph)).toEqual([['a.py', 'b.py'], ['d.py', 'lib/c.py']]);
    } finally {
      await f.close();
    }
  }, 120000);

  it('A-21 does not read configuration or start the analyzer when every claimed Python file was skipped', async () => {
    const wrapper = await countingPythonPath();
    const f = await fixture(backend, projectId, [
      ['a.ts', 'export {};\n'],
      ['pyproject.toml', '[tool\n'],
      ['x.py', 'x = 1\0\n'],
    ], { sourceAnalyzers: { pythonPath: wrapper.path } });
    try {
      const graph = await f.graph();

      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 1, parsed: 0, edges: 'supported', reason: null, notes: [],
        issues: [{ path: 'x.py', kind: 'skipped', reason: 'binary source' }], issueCount: 1, complete: false,
      });
      expect(coverageOf(graph, 'typescript')).toEqual({
        language: 'typescript', files: 1, parsed: 1, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
      });
      expect(graph.edges).toEqual([]);
      expect(await readFile(wrapper.counter, 'utf8').catch(() => '')).toBe('');
    } finally {
      await f.close();
    }
  }, 120000);
});
