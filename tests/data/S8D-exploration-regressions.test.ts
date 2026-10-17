/**
 * 8D rework "查源码不变" rows (spec §11.6): the exploration side goes back to
 * before 8D. These rows exercise the real `createExplorationTools` handlers over
 * a `WorkspaceSandbox`; they carry no storage and run once (no memory/SQLite
 * pair). Expected values are literal from §11.6.
 */
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createExplorationTools, type ExplorationToolsHandle } from '../../src/core/agent-runtime/exploration-tools.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

type Entry = [path: string, content: string | Uint8Array];
type SourceAnalyzers = { directory?: string; pythonPath?: string; cppLibraryPath?: string };

const roots: string[] = [];
const groups: ExplorationToolsHandle[] = [];
afterEach(async () => {
  for (const group of groups.splice(0)) await group.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** A real temporary workspace; `build` receives the root for absolute paths inside fixtures. */
async function fixture(build: Entry[] | ((root: string) => Entry[] | Promise<Entry[]>), options: SourceAnalyzers = {}) {
  const root = await mkdtemp(join(tmpdir(), 's8d-exploration-regressions-'));
  roots.push(root);
  const entries = typeof build === 'function' ? await build(root) : build;
  for (const [path, content] of entries) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const workspace = await WorkspaceSandbox.create(root);
  const group = createExplorationTools(workspace, { sourceAnalyzers: options });
  groups.push(group);
  return { root, workspace, group };
}

type ToolResult = { status: string; output: Array<{ kind: string; value?: unknown }> };

async function call(group: ExplorationToolsHandle, name: string, callId: string, args: Record<string, unknown>) {
  const tool = group.tools.find(candidate => candidate.name === name);
  expect(tool, name).toBeDefined();
  return await tool!.handler.execute({
    schemaVersion: 1, callId, name, arguments: args,
  } as never, { signal: new AbortController().signal } as never) as unknown as ToolResult;
}

it('python_index over 1,500 files answers a scoped imports query instead of exceeding the analysis output cap', async () => {
  const files: Entry[] = Array.from({ length: 1500 }, (_, index): Entry => {
    const id = String(index + 1).padStart(4, '0');
    return [`pkg/module_${id}.py`, 'x = 1\n'];
  });
  const f = await fixture(files);

  const result = await call(f.group, 'python_index', 'regression-python-index-1500', {
    operation: 'imports', path: 'pkg/module_0001.py', limit: 10,
  });

  expect(result.status, JSON.stringify(result)).toBe('success');
  expect(JSON.stringify(result)).not.toContain('Analysis output too large');
  expect(result.output[0]?.value).toMatchObject({ status: 'sourced', totalResults: 0, results: [] });
}, 120000);

it('cpp_index on the S8D-CPP-01 fixture reports the unparseable translation unit through the tool', async () => {
  const f = await fixture(root => {
    const config = [
      { directory: root, file: join(root, 'src/main.cpp'), arguments: ['clang++', '-std=c++20', '-I', join(root, 'include'), '-c', 'src/main.cpp', '-o', 'src/main.cpp.o'] },
      { directory: root, file: join(root, 'src/broken.cpp'), arguments: ['clang++', '--target=bogus', '-std=c++20', '-I', join(root, 'include'), '-c', 'src/broken.cpp', '-o', 'src/broken.cpp.o'] },
    ];
    return [
      ['include/used.hpp', '#pragma once\nint used();\n'],
      ['include/orphan.hpp', '#pragma once\nint orphan();\n'],
      ['src/main.cpp', '#include "used.hpp"\nint main() { return 0; }\n'],
      ['src/broken.cpp', 'int broken( { return 1; }\n'],
      ['compile_commands.json', JSON.stringify(config)],
    ];
  });

  const result = await call(f.group, 'cpp_index', 'regression-cpp-index-01', { operation: 'symbols' });

  expect(result.status).toBe('success');
  expect(result.output[0]?.value).toEqual({
    status: 'unsupported', message: 'libclang could not parse configured translation unit: src/broken.cpp (code 1)',
  });
}, 60000);

it('python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory', async () => {
  const emptyZip = Buffer.concat([Buffer.from('PK\x05\x06', 'latin1'), Buffer.alloc(18)]);
  expect(emptyZip).toHaveLength(22);
  const analyzers = await mkdtemp(join(tmpdir(), 's8d-empty-analyzers-'));
  roots.push(analyzers);
  await writeFile(join(analyzers, 'analyzers.zip'), emptyZip);
  await writeFile(join(analyzers, 'analyzers.sha256'), createHash('sha256').update(emptyZip).digest('hex'));
  await writeFile(join(analyzers, 'manifest.json'), '{}\n');

  const f = await fixture([
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
  ], { directory: analyzers });

  const missing = await call(f.group, 'python_index', 'regression-empty-analyzers', {
    operation: 'imports', path: 'e.py',
  });
  expect(missing.status).toBe('success');
  expect(missing.output[0]?.value).toEqual({
    status: 'unsupported',
    message: `Python semantic provider missing: jedi is not in ${join(analyzers, 'analyzers.zip')}`,
  });

  const defaults = await fixture([
    ['e.py', 'import g\n'],
    ['g.py', 'x = 1\n'],
  ]);
  const sourced = await call(defaults.group, 'python_index', 'regression-default-analyzers', {
    operation: 'imports', path: 'e.py',
  });
  expect(sourced.status).toBe('success');
  expect(sourced.output[0]?.value).toMatchObject({ status: 'sourced' });
  expect(JSON.stringify(sourced.output[0]?.value)).not.toContain('analyzers.zip');
}, 120000);
