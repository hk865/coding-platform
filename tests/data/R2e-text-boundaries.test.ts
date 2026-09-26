import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import { compareCapturedFiles } from '../../src/core/workspace/workspace-read.js';
import type { CaptureEntry } from '../../src/core/workspace/capture.js';
import type { TextSourceFile } from '../../src/core/workspace/text-source-snapshot.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

it('rejects a text scope containing a readable regular path it cannot represent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'r2e-special-path-'));
  temporary.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root);
  await writeFile(join(root, 'normal.txt'), 'regular text');
  await writeFile(join(root, 'foo:bar.txt'), 'colon path text');
  const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'project', workspaceId: 'workspace' };
  const actor = { kind: 'human' as const, id: 'authorized-reader' };
  const context: CoreCallContext = {
    projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
    signal: new AbortController().signal,
  };
  const access = createWorkspaceAccessFactory({
    resolveRoot: async () => ({ status: 'ready', value: { root, workspaceRevision: 1 } }),
    authorize: async () => ({ status: 'ready', value: {
      subjectKey: 'reader', permissionRevision: 'grant-1', allowsRead: () => true,
    } }),
  });
  const handle = createWorkspaceTools({ access, now: () => '2026-09-24T00:00:00.000Z',
    limits: { ...DEFAULT_WORKSPACE_LIMITS, maxRetainedCaptures: 1 } });
  try {
    const opened = await access.open(context, workspace);
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready') return;
    try {
      expect(opened.value.authorization.allowsRead('foo:bar.txt')).toBe(true);
      expect(await opened.value.read('foo:bar.txt', 4096)).toMatchObject({ content: 'colon path text' });
      expect((await opened.value.listFiles(100)).paths).toContain('foo:bar.txt');
    } finally { await opened.value.release(); }
    const captured = await handle.tools.captureSourceChanges(context, {
      workspace, workspaceRevision: 1, provider: 'text',
    });
    expect(captured).toMatchObject({ status: 'rejected', code: 'unsupported' });
    // The failed attempt must not retain a partial handle or consume its capture slot.
    await rm(join(root, 'foo:bar.txt'));
    const later = await handle.tools.captureSourceChanges(context, {
      workspace, workspaceRevision: 1, provider: 'text',
    });
    expect(later).toMatchObject({ status: 'ready', value: { coverage: { sourceCount: 1, complete: true } } });
  } finally { await handle.close(); }
});

it('short-circuits guaranteed over-capacity when the before capture is empty', () => {
  const scope = { kind: 'text_files' as const, selectionVersion: 'readable-regular-utf8-no-nul-v1' as const,
    prefix: null, digestBasis: 'raw_bytes' as const };
  let visited = 0;
  const afterFiles = new Map<string, TextSourceFile>();
  for (let index = 0; index < 100; index++) {
    const path = `file-${String(index).padStart(3, '0')}.txt`;
    afterFiles.set(`/workspace/${path}`, { path, content: 'a', digest: String(index).padStart(64, '0'), byteLength: 1 });
  }
  const guarded = new Proxy(afterFiles, {
    get(target, property) {
      if (property === Symbol.iterator) return function* () {
        for (const item of target) {
          if (++visited > 4) throw new Error('empty-before comparison traversed past its provable capacity bound');
          yield item;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const ref = { projectId: 'project', workspaceId: 'workspace', captureId: 'before', workspaceRevision: 1,
    sourceDigest: '0'.repeat(64), configDigest: '0'.repeat(64), indexVersion: 'workspace-text@1' };
  const entry = (captureId: string, text: ReadonlyMap<string, TextSourceFile>) => ({
    ref: { ...ref, captureId }, scope, material: { provider: 'text' as const, analyzer: null, text,
      identity: { workspace: 'workspace', commit: null }, snapshot: 'snapshot' },
  }) as CaptureEntry;
  // With no prior file there can be no rename pair: every after path is an addition.
  // A change limit of two is provably exceeded from the manifest cardinality alone.
  expect(compareCapturedFiles(entry('before', new Map()), entry('after', guarded), { maxQueryResults: 2 }))
    .toMatchObject({ status: 'rejected', code: 'capacity' });
  expect(visited).toBeLessThanOrEqual(4);
});
