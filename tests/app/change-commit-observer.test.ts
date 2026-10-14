/**
 * Task E commit observation through the real composition root: the head is
 * reported once (null for an empty ledger, the SQLite `events` head after a
 * reopen), every non-replayed commit is reported with its exact receipt cursor
 * and aggregate refs, a replay is not reported, and a throwing observer never
 * changes a receipt. The last case runs the real Host: a write over HTTP reaches
 * an open change stream as a `change` whose id is the receipt cursor.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import {
  observeRecordCommits, type RecordCommitNotice, type RecordCommitObserver,
} from '../../src/composition/commit-observer.js';
import type { PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import {
  CORE_API_PREFIX,
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_PLACEHOLDER,
} from '../../src/app/core-http-types.js';
import { UI_PLATFORM_TOKEN_META_NAME } from '../../src/ui/api/protocol.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { openChangeStream } from '../helpers/change-stream-reader.js';

const scope = { projectId: 'observer-project', workspaceId: 'observer-workspace' };
const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
const actor = { kind: 'human' as const, id: 'observer-operator' };
const context = (): CoreCallContext => ({
  projectId: scope.projectId,
  workspaceId: scope.workspaceId,
  principal: { kind: 'host', actor: { ...actor } },
  materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
  signal: new AbortController().signal,
});
/** No workspace is read in these tests; every workspace access is refused. */
const noWorkspace: WorkspaceHostBindings = {
  async resolveRoot() { return { status: 'rejected', code: 'not_found', reason: 'no workspace in this test' }; },
  async authorize() { return { status: 'rejected', code: 'forbidden', reason: 'no workspace in this test' }; },
};
const createProject = (requestId: string) =>
  ({ input: { projectId: scope.projectId }, meta: { requestId, expected: [{ ref: projectRef, revision: 0 }] } });

function recordingObserver(): RecordCommitObserver & { heads: unknown[]; commits: RecordCommitNotice[] } {
  const heads: unknown[] = [];
  const commits: RecordCommitNotice[] = [];
  return { heads, commits, started: head => { heads.push(head); }, committed: notice => { commits.push(notice); } };
}

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('RecordStore commit observer', () => {
  it('reports the empty head once, each new commit with its receipt cursor, and no replay', async () => {
    const observer = recordingObserver();
    const platform = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace, commitObserver: observer });
    try {
      expect(observer.heads).toEqual([null]);
      const created = await platform.projects.createProject(context(), createProject('observer-project-1'));
      expect(created).toMatchObject({ status: 'committed', replayed: false });
      if (created.status !== 'committed') throw new Error('project creation failed');
      expect(observer.commits).toEqual([{ cursor: created.cursor, aggregates: [{ aggregateType: 'Project', projectId: scope.projectId }] }]);
      const replay = await platform.projects.createProject(context(), createProject('observer-project-1'));
      expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: created.cursor });
      expect(observer.commits).toHaveLength(1);
      expect(observer.heads).toEqual([null]);
    } finally { await platform.close(); }
  });

  it('never lets a throwing observer change a receipt', async () => {
    const throwing: RecordCommitObserver = {
      started() { throw new Error('observer start failure'); },
      committed() { throw new Error('observer commit failure'); },
    };
    const now = () => '2026-10-04T00:00:00.000Z';
    const observed = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace, now, commitObserver: throwing });
    const plain = await createTargetPlatform({ storage: { kind: 'memory' }, workspace: noWorkspace, now });
    try {
      const withObserver = await observed.projects.createProject(context(), createProject('observer-project-2'));
      const without = await plain.projects.createProject(context(), createProject('observer-project-2'));
      expect(withObserver).toMatchObject({ status: 'committed', replayed: false, cursor: 'c0000000001',
        value: { ref: projectRef, revision: 1 } });
      if (withObserver.status !== 'committed' || without.status !== 'committed') throw new Error('project creation failed');
      expect(withObserver.value).toEqual(without.value);
      expect(withObserver.cursor).toBe(without.cursor);
    } finally { await observed.close(); await plain.close(); }
  });

  it('reports only committed non-replayed receipts, with the type and project of each written ref', async () => {
    const receipts: StoreCommitReceipt[] = [
      { status: 'committed', replayed: false, identityKey: 'k1', versions: [], eventIds: ['e1'], cursor: 'c0000000007' as never },
      { status: 'committed', replayed: true, identityKey: 'k1', versions: [], eventIds: ['e1'], cursor: 'c0000000007' as never },
      { status: 'rejected', code: 'revision_conflict', reason: 'stale', current: [] },
    ];
    const raw = {
      records: {
        readMany: async () => ({ status: 'ready' as const, value: { records: [], missing: [], readThrough: 'c0000000006' as never } }),
        lookupCommit: async () => { throw new Error('not used'); },
        commit: async () => receipts.shift()!,
        eventAt: async () => { throw new Error('not used'); },
        lookup: async () => { throw new Error('not used'); },
        lookupOrdered: async () => { throw new Error('not used'); },
      },
      close: async () => undefined,
    };
    const observer = recordingObserver();
    const observed = await observeRecordCommits(raw, observer);
    expect(observer.heads).toEqual(['c0000000006']);
    const prepared = { records: [
      { refKey: JSON.stringify({ aggregateType: 'Task', goalId: 'g1', projectId: 'p1', taskId: 't1' }), schemaId: 'Task@1', revision: 1, json: '{}' },
      { refKey: JSON.stringify({ aggregateType: 'CoreOperation', operationId: 'o1' }), schemaId: 'CoreOperation@1', revision: 1, json: '{}' },
      { refKey: 'not json', schemaId: 'X@1', revision: 1, json: '{}' },
    ] } as unknown as PreparedCommit;
    const first = await observed.records.commit(prepared);
    const replay = await observed.records.commit(prepared);
    const failure = await observed.records.commit(prepared);
    expect([first.status, replay.status, failure.status]).toEqual(['committed', 'committed', 'rejected']);
    expect(observer.commits).toEqual([{ cursor: 'c0000000007', aggregates: [
      { aggregateType: 'Task', projectId: 'p1' }, { aggregateType: 'CoreOperation', projectId: null },
    ] }]);
    expect(await observeRecordCommits(raw, undefined)).toBe(raw);
  });

  it('reports the SQLite events head after a reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'change-observer-db-'));
    temporary.push(directory);
    const first = recordingObserver();
    const platform = await createTargetPlatform({ storage: { kind: 'sqlite', directory }, workspace: noWorkspace, commitObserver: first });
    let cursor: string;
    try {
      expect(first.heads).toEqual([null]);
      const created = await platform.projects.createProject(context(), createProject('observer-project-3'));
      if (created.status !== 'committed') throw new Error('project creation failed');
      cursor = created.cursor;
      expect(first.commits.map(commit => commit.cursor)).toEqual([cursor]);
    } finally { await platform.close(); }
    const second = recordingObserver();
    const reopened = await createTargetPlatform({ storage: { kind: 'sqlite', directory }, workspace: noWorkspace, commitObserver: second });
    try {
      expect(second.heads).toEqual([cursor]);
      expect(second.commits).toEqual([]);
    } finally { await reopened.close(); }
  });
});

describe('Host change stream over real commits', () => {
  it('pushes a project write as a change whose id is the receipt cursor, and closes with the stream open', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'change-observer-public-'));
    const root = await mkdtemp(join(tmpdir(), 'change-observer-ws-'));
    temporary.push(publicDir, root);
    await writeFile(join(publicDir, 'index.html'),
      `<!doctype html><meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
    const host = await createLocalWorkbenchHost({
      storage: { kind: 'memory' },
      actor,
      publicDir,
      workspaces: [{ scope, name: 'observer workspace', root, workspaceRevision: 1, readPrefixes: ['.'] }],
    });
    let closed = false;
    try {
      const address = await host.listen(0);
      const page = await (await fetch(address.url)).text();
      const token = new RegExp(`<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(page)?.[1];
      if (token === undefined) throw new Error('the page did not carry the token');
      const origin = `http://${address.host}:${address.port}`;
      const stream = await openChangeStream(origin, token);
      expect((await stream.nextEvent())?.event).toBe('ready');
      const written = await fetch(new URL(`${CORE_API_PREFIX}projects/create`, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
        body: JSON.stringify({ scope, request: createProject('observer-host-project') }),
      });
      const receipt = await written.json() as { status: string; cursor: string };
      expect(receipt).toMatchObject({ status: 'committed' });
      expect(await stream.nextEvent()).toEqual({ comment: false, event: 'change', id: receipt.cursor,
        data: { cursor: receipt.cursor, kinds: ['project'], projects: [scope.projectId] } });
      const started = Date.now();
      await host.close();
      closed = true;
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(await stream.next(1_000)).toBeNull();
    } finally {
      if (!closed) await host.close();
    }
  });
});
