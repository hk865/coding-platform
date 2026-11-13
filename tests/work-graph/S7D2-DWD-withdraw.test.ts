/**
 * WDT-01/02/03/13: the Host's workspace withdraw/remove settings routes.
 *
 * World: `tests/helpers/S7D2-DWD-world.ts` (the XWS2A second-workspace world plus the two removal routes). Every
 * state is a public step: the Host's `workspaces/open`, the scripted coarse exploration and the person's
 * `decisions/answer`, then the removal route itself. Reads are `snapshot`, `sessions/operation`,
 * `role-lines/operations`, `architecture/read` and `decisions/queue`.
 *
 * WDT-01: Today RED at `expect(response.status).toBe('ready')`: the Host has no `workspaces/withdraw` route (settings
 *   answers the unknown-route result `not_found`, "unpublished settings route workspaces/withdraw"); after WD lands it
 *   is GREEN because `withdraw` ends the join with `failedRoleLineRecordOf` (`cancelled`/`the join was withdrawn`) and
 *   marks the registration removed (WD-03/WD-06, wd-build §3.4).
 * WDT-02: Today RED at `expect(code).toBe('invalid')`: the Host has no `workspaces/withdraw` route (settings answers
 *   the unknown-route `not_found`); after WD lands it is GREEN because `withdraw` refuses an in-graph workspace with
 *   `invalid` and "the workspace is already in the architecture graph; remove it instead" (WD-07, wd-build §3.1).
 * WDT-03: Today RED at `expect(code).toBe('invalid')`: the Host has no `workspaces/withdraw`/`workspaces/remove`
 *   route (the unknown-route `not_found`); after WD lands it is GREEN because the shared main-workspace check rejects
 *   with `invalid` and "the main workspace cannot be removed" (WD-02, wd-build §3.1).
 * WDT-13: Today RED at `expect(code).toBe('invalid')` (the first code assertion): the Host has no
 *   `workspaces/remove`/`workspaces/withdraw` route (the unknown-route `not_found`); after WD lands it is GREEN because
 *   the routes validate the body's scope before looking it up (`invalid` for a missing/empty scope, `not_found` for an
 *   unopened one), with no snapshot or notice change (WD-20, wd-build §3.7).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  fullJoin, openDwdWorld, projectNotices, remove, removeRaw, secondId, snapshotWorkspaces,
  type DwdRemovalResponse, type DwdWorld,
} from '../helpers/S7D2-DWD-world.js';

const worlds: DwdWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

async function opened(options: Parameters<typeof openDwdWorld>[0] = { backend: 'memory' }): Promise<DwdWorld> {
  const world = await openDwdWorld(options);
  worlds.push(world);
  return world;
}

/** A settings answer's rejection; any other answer is a fixture/behaviour failure with the real answer in the message. */
function rejectionOf(response: DwdRemovalResponse): { code: string; reason: string } {
  if (response.status !== 'rejected') {
    throw new Error(`DWD: expected a rejected settings answer, got ${JSON.stringify(response)}`);
  }
  return { code: response.code, reason: response.reason };
}

/** The target workspace's operation rows, named inside the main workspace's envelope (its HTTP stays open). */
async function joinRows(world: DwdWorld): Promise<readonly RoleLineOperationReadV1[]> {
  return valueOf<readonly RoleLineOperationReadV1[]>((await world.base.world.post('role-lines/operations',
    plain(S6A_SCOPE, { workspace: world.second.scope }))).body, 'ready', 'the join operations');
}

describe('S7D2 DWD: withdraw and remove a workspace', () => {
  it('WDT-01 withdrawing a join before it is adopted removes the workspace and fails the join', async () => {
    const world = await opened();
    // Not approved: the coarse proposal's card is still waiting, so `second-mod` is not in the graph.
    const before = await fullJoin(world);

    const response = await remove(world, 'withdraw');
    expect(response.status).toBe('ready');

    const snapshot = await snapshotWorkspaces(world);
    expect(snapshot.some(entry => entry.scope.workspaceId === world.second.scope.workspaceId)).toBe(false);

    const after = await fullJoin(world);
    expect(after.phase).toBe('failed');
    expect(after.failure).toEqual({ code: 'cancelled', reason: 'the join was withdrawn' });
    if (after.action.kind !== 'role_line') throw new Error(`DWD: the join is a ${after.action.kind} record`);
    expect(after.action.result).toEqual({ status: 'failed', reason: 'the join was withdrawn' });
    expect(after.revision).toBe(before.revision + 1);

    // The join is no longer accepted/running (the public operations read names the target workspace from main).
    const rows = await joinRows(world);
    expect(rows.filter(row => row.operation.operationId === after.ref.operationId)
      .some(row => row.phase === 'accepted' || row.phase === 'running')).toBe(false);
  });

  it('WDT-02 withdraw is rejected once the workspace is in the architecture graph', async () => {
    const world = await opened();
    await world.approveCoarse();
    expect((await world.catalog(S6A_SCOPE)).catalog.catalog.modules.some(module =>
      module.ref.moduleId === secondId(world))).toBe(true);

    const rejection = rejectionOf(await remove(world, 'withdraw'));
    expect(rejection.code).toBe('invalid');
    expect(rejection.reason).toBe('the workspace is already in the architecture graph; remove it instead');

    expect((await snapshotWorkspaces(world)).some(entry =>
      entry.scope.workspaceId === world.second.scope.workspaceId)).toBe(true);
    expect((await fullJoin(world)).phase).not.toBe('failed');
  });

  it('WDT-03 the main workspace cannot be withdrawn or removed', async () => {
    const world = await opened();
    const beforeCatalog = await world.catalog(S6A_SCOPE);

    const withdraw = rejectionOf(await remove(world, 'withdraw', S6A_SCOPE));
    expect(withdraw.code).toBe('invalid');
    expect(withdraw.reason).toBe('the main workspace cannot be removed');

    const removed = rejectionOf(await remove(world, 'remove', S6A_SCOPE));
    expect(removed.code).toBe('invalid');
    expect(removed.reason).toBe('the main workspace cannot be removed');

    expect((await snapshotWorkspaces(world)).some(entry =>
      entry.scope.workspaceId === S6A_SCOPE.workspaceId)).toBe(true);
    expect(await world.catalog(S6A_SCOPE)).toEqual(beforeCatalog);
  });

  it('WDT-13 a missing, empty or unknown scope is rejected with nothing changed', async () => {
    const world = await opened();
    const beforeSnapshot = await snapshotWorkspaces(world);
    const beforeNotices = (await projectNotices(world)).length;

    const missing = rejectionOf(await removeRaw(world, 'remove', {}));
    expect(missing.code).toBe('invalid');
    expect(missing.reason.length).toBeGreaterThan(0);

    const empty = rejectionOf(await removeRaw(world, 'remove', { scope: { projectId: '', workspaceId: '' } }));
    expect(empty.code).toBe('invalid');
    expect(empty.reason.length).toBeGreaterThan(0);

    const unknown = rejectionOf(await removeRaw(world, 'withdraw',
      { scope: { projectId: S6A_SCOPE.projectId, workspaceId: 'does-not-exist' } }));
    expect(unknown.code).toBe('not_found');
    expect(unknown.reason.length).toBeGreaterThan(0);

    expect(await snapshotWorkspaces(world)).toEqual(beforeSnapshot);
    expect((await projectNotices(world)).length).toBe(beforeNotices);
  });
});
