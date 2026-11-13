/**
 * WDT-10 (SQLite only): a removal whose settings save fails still commits the removed mark; after the Host crashes
 * and restarts, the descriptor is dropped and the root opens again as a new workspace. The old join is not driven
 * again (same revision, still failed).
 *
 * Today RED at `expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' })` (this file:43):
 * `workspaces/remove` is not published (404 `not_found`), so the first removal never reaches the settings save.
 * After WD lands GREEN because the route commits the mark, maps the failed persist to `unavailable`, and the
 * restart's restore loop drops the descriptor. Crash entry: `world.base.world.crash()`
 * (`S6A-host-fixture.ts:695`).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { DwdRemovalResponse } from '../helpers/S7D2-DWD-world.js';
import {
  blockSettingsSave, cancelSecondGoal, fullJoin, openDwdWorld, remove, snapshotWorkspaces, unblockSettingsSave,
} from '../helpers/S7D2-DWD-world.js';

const closers: Array<() => Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map(close => close()));
  await Promise.allSettled(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('WDT-10 a removal whose settings save fails is not restored after the Host restarts', () => {
  it('WDT-10 SQLite only: failed save still marks; the restart drops the descriptor; the root opens as a new workspace',
    async () => {
      const settingsDirectory = await mkdtemp(join(tmpdir(), 'dwd-settings-'));
      directories.push(settingsDirectory);
      const world = await openDwdWorld({ backend: 'sqlite', withModule: true, settingsDirectory });
      closers.push(() => world.close());
      await cancelSecondGoal(world);
      const oldScope = world.second.scope;
      const root = await world.secondRoot();
      const failed = await (async (): Promise<DwdRemovalResponse> => {
        await blockSettingsSave(settingsDirectory);
        try { return await remove(world, 'remove'); } finally { await unblockSettingsSave(settingsDirectory); }
      })();
      expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const marked = await fullJoin(world, oldScope);
      // Same detached-drive race as WDT-09: the removal ends a running join (failed) or skips an ended one
      // (completed, wd-build.frozen.md:385); it must never leave it running, and the restart keeps what it found.
      expect(['failed', 'completed']).toContain(marked.phase);
      await world.base.world.crash();
      expect(await fullJoin(world, oldScope)).toMatchObject({ phase: marked.phase, revision: marked.revision });
      const scopes = (await snapshotWorkspaces(world)).map(workspace => workspace.scope.workspaceId);
      expect(scopes).not.toContain(oldScope.workspaceId);
      const opened = await world.base.world.settings('workspaces/open', { path: root, projectId: S6A_SCOPE.projectId,
        writeAllowed: false, commandsAllowed: false });
      if (opened.status !== 'ready') {
        throw new Error(`WDT-10: workspaces/open did not open: ${JSON.stringify(opened)}`);
      }
      expect(opened.value.scope.workspaceId).not.toBe(oldScope.workspaceId);
    });
});
