/**
 * §10 item 1 / §11.2 "模块快照的没解析" (§10 段, Codex review items 1 and 8):
 * strict capture stays as it was — its export capacity check, `indexedSources`
 * and the uncut unresolved list — and only the explicit observation mode
 * compacts. Every capture here is reached through the public workspace tools on
 * a real temporary root; every expected number is hand-computed from the spec
 * caps (500 kept lines / 64 KiB, one summary line).
 */
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import { ready, workspaceToolsFixture } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const fixture = workspaceToolsFixture({
  projectId: 's8e-a25',
  actorId: 's8e-a25-reader',
  permissionRevision: 's8e-a25-policy-v1',
  tempPrefix: 's8e-a25-',
  now: '2026-10-18T00:00:00.000Z',
  cleanups,
});

it('A25-1 strict capture keeps the export capacity check (two files, maxQueryResults 1)', async () => {
  const f = await fixture([
    ['a.ts', 'export const a = 1;\n'],
    ['b.ts', 'export const b = 1;\n'],
  ], { limits: { ...DEFAULT_WORKSPACE_LIMITS, maxQueryResults: 1 } });
  const captured = ready(await f.strictCapture());

  // Neither file imports anything, so only the file count can exceed the limit.
  const exported = await f.exportCapture(captured.ref);
  expect(exported).toMatchObject({ status: 'rejected', code: 'capacity' });
});

it('A25-2 strict capture keeps all 501 unresolved lines and indexedSources', async () => {
  // 501 files, one unresolved bare import each: 501 distinct unresolved lines,
  // under the 2,048-line contract limit but over the 500-line observation cap.
  const entries: [string, string][] = Array.from({ length: 501 }, (_, index) => {
    const id = String(index).padStart(3, '0');
    return [`m${id}.ts`, 'import "missing";\n'];
  });
  const f = await fixture(entries);
  const captured = ready(await f.strictCapture());
  const snapshot = ready(await f.architectureSource(captured.ref));

  expect(snapshot.unresolved).toHaveLength(501);
  expect(snapshot.unresolved.every(line => line.startsWith('unresolved import: '))).toBe(true);
  expect(snapshot.unresolved.some(line => line.includes('另有 '))).toBe(false);
  expect(snapshot.indexedSources).toHaveLength(501);
  // The strict snapshot carries the capture's own full source list, same order/content.
  const exported = ready(await f.exportCapture(captured.ref));
  expect(snapshot.indexedSources).toEqual(exported.files.map(file => ({ path: file.path, digest: file.digest })));
});

it('A25-3 observation mode still compacts the module snapshot and keeps the file layer whole', async () => {
  // One file with 501 distinct unresolved imports: over the 500-line cap without
  // 501 files. The file layer keeps all 501; the module snapshot keeps 500 + summary.
  const imports = Array.from({ length: 501 }, (_, index) =>
    'import "missing-' + String(index).padStart(3, '0') + '";').join('\n') + '\n';
  const f = await fixture([['all.ts', imports]]);
  const captured = ready(await f.observationCapture());
  const snapshot = ready(await f.architectureSource(captured.ref));

  expect('indexedSources' in snapshot).toBe(false);
  expect(snapshot.unresolved).toHaveLength(501);
  expect(snapshot.unresolved[500]).toBe('另有 1 条没列出，逐条见文件层');

  const graph = ready(await f.fileGraph(captured.ref));
  expect(graph.unresolved).toHaveLength(501);
});
