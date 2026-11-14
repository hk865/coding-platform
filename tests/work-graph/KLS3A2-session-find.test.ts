/**
 * KLS-3a2 (test writer, decision 117): `sessions/find` takes an optional `lineFolder` and reads one line's Sessions
 * (start rulings draft v2 §2.5; the lead's ruling: the workspace scan filtered by `lineRef.folder`, no line index).
 * Rows 3A2-07 and 3A2-07b of the draft's §3, a storage row (S3: the filter with the page cursor), on memory and SQLite:
 * `openKLS2AWorld`'s real git root plus a second checkout (`addGitWorktree`), both lines through the public owner
 * `projects.registerLine` (`registerKLS2ALine`), the second line's own Kernel store registered as the Host registers
 * one for each line it holds (`kernelStores.registerCurrent` with `lineFolder`; the KLS2A world has no Host), two
 * Sessions on each line (`runtime.createSession`, behind `sessions/create`), then `sessions.findSessions` (behind
 * `sessions/find`).
 *
 * Red today (ac44fed7): the Kernel registry keys a store by `[projectId, workspaceId]`, so the second line's store is
 * refused as the workspace's second one, and `findSessions` has no `lineFolder`. Green when KLS-3a2 keys Kernel stores
 * by line (`KernelStoreEntry.lineFolder`, `forLine`) and the directory scan filters by `lineFolder`.
 * 3A2-07b binds both page cursors to `lineFolder`: a cursor read on one line is refused `invalid` on another line,
 * while the same line continues normally, on the directory and target paths.
 */
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { kls3a1Checkout, openKLS2AWorld, registerKLS2ALine, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';
import { addGitWorktree } from '../scenarios/support/git-workspace.js';
import type { WorkLinkTarget } from '../../src/contracts/core/identity.js';

const worlds: KLS2AWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe.each(['memory', 'sqlite'] as const)('KLS-3a2 sessions/find by line (%s)', storage => {
  it('3A2-07 `lineFolder` pages through the second line\'s two Sessions only; without it all four', async () => {
    /* Named mutation: drop the `lineFolder` filter in the directory scan — the line read answers all four. Red today
     * at the line's `registerCurrent` (the workspace already has a store); green with a store per line and the filter. */
    const world = await openKLS2AWorld({ storage });
    worlds.push(world);
    const scope = { projectId: world.projectId, workspaceId: world.workspaceId };
    const folder = addGitWorktree(world.root, join(dirname(world.root), 'wt'), 'wt');
    for (const [checkout, requestId] of [[world.root, 'kls3a2-07-main'], [folder, 'kls3a2-07-wt']] as const) {
      expect((await registerKLS2ALine(world, checkout, requestId)).status).toBe('committed');
    }
    await world.platform.kernelStores.registerCurrent!({ adapterId: 'kls3a2-07-line', storeKey: 'kls3a2-07-line',
      workspace: scope, databasePath: join(dirname(world.root), 'kls3a2-07-line.sqlite'), lineFolder: folder });
    const ids: string[] = [];
    for (const [index, lineFolder] of [undefined, undefined, folder, folder].entries()) {
      const created = await world.platform.runtime.createSession(world.ctx(), { workspace: scope,
        role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' }, recommendedRefs: [],
        initialLinks: [], meta: { requestId: `kls3a2-07-${index}`, expected: [] }, ...(lineFolder === undefined ? {} : { lineFolder }) });
      if (created.status !== 'completed') throw new Error(`createSession ${index}: ${JSON.stringify(created)}`);
      ids.push(created.value.ref.sessionId);
    }
    const page = async (input: { lineFolder?: string; limit: number; cursor: string | null }) => {
      const found = await world.platform.sessions.findSessions(world.ctx(), { workspace: scope, includeArchived: false,
        ...(input.lineFolder === undefined ? {} : { lineFolder: input.lineFolder }),
        page: input.cursor === null ? { limit: input.limit } : { limit: input.limit, cursor: input.cursor } });
      if (found.status !== 'ready') throw new Error(`findSessions: ${JSON.stringify(found)}`);
      return { ids: found.value.items.map(card => card.record.ref.sessionId), next: found.value.nextCursor };
    };
    const onLine: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 6 && (pages === 0 || cursor !== null); pages += 1) {
      const read = await page({ lineFolder: folder, limit: 1, cursor });
      onLine.push(...read.ids);
      cursor = read.next;
    }
    expect([onLine.sort(), cursor]).toEqual([ids.slice(2).sort(), null]);
    expect((await page({ limit: 50, cursor: null })).ids.sort()).toEqual([...ids].sort());
  });

  it('3A2-07b a directory or target page cursor refuses another line and continues on its own', async () => {
    /* Named mutation: drop the cursor's `lineFolder` comparison in `findSessions` — the other line's page is answered. */
    const world = await openKLS2AWorld({ storage });
    worlds.push(world);
    const scope = { projectId: world.projectId, workspaceId: world.workspaceId };
    const folder = addGitWorktree(world.root, join(dirname(world.root), 'wt-b'), 'wt-b');
    for (const [checkout, requestId] of [[world.root, 'kls3a2-07b-main'], [folder, 'kls3a2-07b-wt']] as const) {
      expect((await registerKLS2ALine(world, checkout, requestId)).status).toBe('committed');
    }
    await world.platform.kernelStores.registerCurrent!({ adapterId: 'kls3a2-07b-line', storeKey: 'kls3a2-07b-line',
      workspace: scope, databasePath: join(dirname(world.root), 'kls3a2-07b-line.sqlite'), lineFolder: folder });
    const target: WorkLinkTarget = { kind: 'project', ref: { projectId: world.projectId } };
    const ids: string[] = [];
    for (const [index, lineFolder] of [undefined, undefined, folder, folder].entries()) {
      const created = await world.platform.runtime.createSession(world.ctx(), { workspace: scope,
        role: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' }, recommendedRefs: [],
        initialLinks: [{ target, relation: 'participates' }],
        meta: { requestId: `kls3a2-07b-${index}`, expected: [] }, ...(lineFolder === undefined ? {} : { lineFolder }) });
      if (created.status !== 'completed') throw new Error(`createSession ${index}: ${JSON.stringify(created)}`);
      ids.push(created.value.ref.sessionId);
    }
    const mainFolder = kls3a1Checkout(world.root).line.folder;
    const find = async (input: { lineFolder: string; target?: WorkLinkTarget; limit: number; cursor: string | null }) => {
      const found = await world.platform.sessions.findSessions(world.ctx(), { workspace: scope, includeArchived: false,
        ...(input.target === undefined ? {} : { target: input.target }), lineFolder: input.lineFolder,
        page: input.cursor === null ? { limit: input.limit } : { limit: input.limit, cursor: input.cursor } });
      if (found.status !== 'ready' && found.status !== 'rejected') throw new Error(`findSessions: ${JSON.stringify(found)}`);
      return found;
    };
    for (const targetFilter of [null, target] as const) {
      const filter = targetFilter === null ? {} : { target: targetFilter };
      const first = await find({ lineFolder: folder, ...filter, limit: 1, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.nextCursor).not.toBeNull();
      const cursor = first.value.nextCursor!;
      expect(await find({ lineFolder: mainFolder, ...filter, limit: 1, cursor }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
      const second = await find({ lineFolder: folder, ...filter, limit: 1, cursor });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      const onLine = [first.value.items[0]!.record.ref.sessionId, ...second.value.items.map(card => card.record.ref.sessionId)];
      expect(onLine.sort()).toEqual(ids.slice(2).sort());
      const other = await find({ lineFolder: mainFolder, ...filter, limit: 50, cursor: null });
      expect(other.status).toBe('ready');
      if (other.status === 'ready') expect(other.value.items.map(card => card.record.ref.sessionId).sort()).toEqual(ids.slice(0, 2).sort());
    }
  });
});
