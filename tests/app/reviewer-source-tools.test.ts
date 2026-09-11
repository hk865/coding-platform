import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { CandidateWorkspaceReader, candidateWorkspaceIncludesPath } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import { createExplorationTools } from '../../src/execution/worker-runtime/exploration-tools.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'review-source-tools-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export const readable = "needle";\n');
  const ignored = ['.git', '.platform-runtime', 'node_modules', 'dist', 'coverage', 'test-results', '.cache'];
  for (const directory of ignored) {
    await mkdir(join(root, 'src', directory));
    await writeFile(join(root, 'src', directory, 'excluded.ts'), 'export const PIN_EXCLUDED_SECRET = "needle";\n');
  }
  const workspace = await WorkspaceSandbox.create(root, { deniedPrefixes: ['.git'] });
  const reader = new CandidateWorkspaceReader(), pinned = await reader.digest(root);
  const tools = createExplorationTools(workspace, {
    includeReadSource: true, allowedPath: candidateWorkspaceIncludesPath,
    assertCurrent: async () => { if (await reader.digest(root) !== pinned) throw Error('Pinned review source changed'); },
  });
  const run = async (name: string, args: Record<string, unknown>) => tools.find(tool => tool.name === name)!.handler.execute(
    { schemaVersion: 1, callId: name, name, arguments: args } as never,
    { signal: new AbortController().signal } as never,
  );
  return { root, workspace, ignored, run };
}

it('applies the candidate pin to nested read, search, list and index inputs without changing exploration defaults', async () => {
  const t = await fixture();
  expect((await t.run('read_source', { path: 'src/main.ts' })).status).toBe('success');
  for (const directory of t.ignored) {
    const path = 'src/' + directory + '/excluded.ts';
    expect((await t.run('read_source', { path })).status).toBe('error');
    expect((await t.run('symbols', { path })).status).toBe('error');
    expect((await t.run('search', { query: 'needle', paths: [path] })).status).toBe('error');
    expect((await t.run('code_index', { operation: 'symbols', paths: [path] })).status).toBe('error');
  }
  const listed = JSON.stringify(await t.run('list_files', {}));
  expect(listed).toContain('src/main.ts');
  expect(listed).not.toContain('excluded.ts');
  expect(JSON.stringify(await t.run('search', { query: 'needle' }))).not.toContain('PIN_EXCLUDED_SECRET');
  const exploration = createExplorationTools(t.workspace).find(tool => tool.name === 'symbols')!;
  const original = await exploration.handler.execute({ schemaVersion: 1, callId: 'original', name: 'symbols', arguments: { path: 'src/dist/excluded.ts' } } as never, { signal: new AbortController().signal } as never);
  expect(original.status).toBe('success');
});

it('rejects source changed before a tool and withholds content when source changes during the read', async () => {
  const before = await fixture();
  await writeFile(join(before.root, 'src/main.ts'), 'export const changed = true;\n');
  expect((await before.run('read_source', { path: 'src/main.ts' })).status).toBe('error');
  const during = await fixture(), read = during.workspace.read.bind(during.workspace);
  vi.spyOn(during.workspace, 'read').mockImplementation(async (path, maxBytes) => {
    const result = await read(path, maxBytes);
    await writeFile(join(during.root, 'src/main.ts'), 'export const changedDuringRead = true;\n');
    return result;
  });
  const result = await during.run('read_source', { path: 'src/main.ts' });
  expect(result.status).toBe('error');
  expect(JSON.stringify(result)).toContain('Pinned review source changed');
  expect(JSON.stringify(result)).not.toContain('export const readable');
});
