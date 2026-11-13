/**
 * WDT-09: after a removal the same root opens again as a NEW workspace with a new `workspace_join`, while the old
 * join is not left running (failed if the removal found it running, completed if it had already ended) and the
 * registration snapshot no longer carries the old scope.
 *
 * Today RED at `expect(opened.value.scope.workspaceId).not.toBe(oldScope.workspaceId)` (this file:40):
 * `workspaces/remove` is not a published settings route (404 `not_found`, "unpublished settings route
 * workspaces/remove"), so the root is still mounted and the idempotent `workspaces/open` answers the same scope.
 * After WD lands GREEN because the route drops the descriptor and unmounts the old Host workspace, so the same root
 * is a new workspace with its own join.
 *
 * The new join is read through the new scope's `role-lines/operations` (the `operation`/`actionPhase` DTO); the old
 * join is read through `sessions/operation` (`fullJoin`: the record's `ref`/`phase`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  cancelSecondGoal, fullJoin, openDwdWorld, remove, snapshotWorkspaces,
} from '../helpers/S7D2-DWD-world.js';
import { waitFor } from '../scenarios/harness.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map(close => close()));
});

describe('WDT-09 a removed workspace opens again as a new workspace with a new join', () => {
  it('WDT-09 the same root opens as a new workspace; the old join is not left running; the snapshot has only the new scope',
    async () => {
      const world = await openDwdWorld({ backend: 'memory', withModule: true });
      closers.push(() => world.close());
      await cancelSecondGoal(world);
      const oldScope = world.second.scope;
      const root = await world.secondRoot();
      // The detached join drive may end the join before the removal reads it; assert the phase the removal
      // actually found rather than whichever one a held model call would have produced.
      const before = await fullJoin(world);
      await remove(world, 'remove');
      const after = await fullJoin(world, oldScope);
      // The detached drive may end the join between the read above and the removal's own read. The removal either
      // ends a running join (failed) or skips an ended one (completed); it must never leave it running.
      if (before.phase === 'completed') {
        expect(after.phase).toBe('completed');
      } else {
        expect(['accepted', 'running']).toContain(before.phase);
        expect(['failed', 'completed']).toContain(after.phase);
      }
      const opened = await world.base.world.settings('workspaces/open', { path: root, name: 'again',
        projectId: S6A_SCOPE.projectId, writeAllowed: false, commandsAllowed: false });
      if (opened.status !== 'ready') {
        throw new Error(`WDT-09: workspaces/open did not open: ${JSON.stringify(opened)}`);
      }
      expect(opened.value.scope.workspaceId).not.toBe(oldScope.workspaceId);
      const newScope = opened.value.scope;
      const joinId = `workspace_join:${newScope.workspaceId}`;
      await world.base.world.settleDetached();
      const join = (await waitFor(() => world.operations(newScope), rows => rows.some(row =>
        row.action === 'role_line' && row.operation.operationId === joinId), 'the new workspace join'))
        .find(row => row.action === 'role_line' && row.operation.operationId === joinId);
      expect(join).toMatchObject({ action: 'role_line', actionPhase: 'coarse_split',
        operation: { operationId: joinId } });
      const scopes = (await snapshotWorkspaces(world)).map(workspace => workspace.scope.workspaceId);
      expect(scopes).toContain(newScope.workspaceId);
      expect(scopes).not.toContain(oldScope.workspaceId);
    });
});
