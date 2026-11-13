/**
 * WDT-06 (`wd-tests.frozen.md` §1): a successful `workspaces/remove` unregisters the second workspace, drops its
 * module from the project catalog, leaves its already completed join alone, closes the region line's
 * responsibility link and writes exactly
 * one `workspace_removed` project notice; a second remove answers `not_found` and writes no second notice.
 *
 * World: `tests/helpers/S7D2-DWD-world.ts` over `XWS2A-world.ts` (the real Host, the second workspace, its join and
 * its Goal). Every prior state is a public step; the saved registration, the region link and the join are public
 * reads (`workspaces/registration`, `sessions/read`, `sessions/operation`). No store is read or written.
 *
 * Today RED at line 69 `expect(response.status).toBe('ready')`: the Host has no `workspaces/remove` route (its
 * settings answer is the unknown-route `not_found`, "unpublished settings route workspaces/remove"). After WD lands
 * GREEN because `remove` marks the registration removed, closes the region link, releases the claim and skips
 * the already completed join (WD-10/WD-11), then the route unmounts the descriptor (WD-17/WD-18) and writes one
 * `workspace_removed` notice (WD-14); a retry is the descriptor-gone `not_found`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { sameJson } from '../../src/contracts/fingerprint.js';
import type { WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  cancelSecondGoal, fullJoin, openDwdWorld, projectNotices, remove, secondId, snapshotWorkspaces,
} from '../helpers/S7D2-DWD-world.js';
import type { XWS2AWorld } from '../helpers/XWS2A-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

const opened = async (): Promise<XWS2AWorld> => {
  const world = await openDwdWorld({ backend: 'memory', withModule: true });
  worlds.push(world);
  return world;
};

/** The one `workspace_removed` notice's literal summary (the Host `workspaces/open` name is a public input). */
const REMOVED = 'the workspace S7D2 second workspace was removed from this project';

describe('S7D2 DWD: a successful remove', () => {
  it('WDT-06 remove unregisters the workspace, keeps its completed join, closes the region link and announces it once', async () => {
    const world = await opened();
    await cancelSecondGoal(world);
    // Cancelling the second Goal ends the join's region round, so the join completes before the removal; wait for
    // that completed pre-state instead of reading whichever phase the detached drive happens to be in.
    await waitFor(() => fullJoin(world), join => join.phase === 'completed', 'the completed join');
    expect((await world.catalog(S6A_SCOPE)).catalog.catalog.modules.some(module =>
      module.ref.moduleId === secondId(world))).toBe(true);

    const beforeRegistration = valueOf<{ workspace: WorkspaceSnapshot }>(
      (await world.base.world.post('workspaces/registration',
        plain(world.second.scope, { ...world.second.scope }))).body, 'ready', 'the registration');
    expect(beforeRegistration.workspace.revision).toBeGreaterThan(0);
    // The join's region line already holds the second module's adviser scope, so a second `sessions/link` from the
    // main adviser is the real `scope_owned` conflict. The open link that WD-11 must close is that region line's own
    // responsible link; save it (and its card) through the public reads.
    const join = await world.join();
    const region = join?.explorations?.find(entry => entry.segment === 'region');
    if (region === undefined) throw new Error('WDT-06: the join has no region exploration');
    const regionSession = region.sessionRef;
    const regionCard = await world.base.world.readSession(regionSession);
    const openLink = regionCard.links.find(entry => entry.until === null
      && entry.ref.relation === 'responsible' && entry.ref.target.kind === 'module'
      && entry.ref.target.ref.moduleId === secondId(world));
    expect(openLink).toBeDefined();
    if (openLink === undefined) throw new Error('WDT-06: the region line has no open module link');
    const linkRef = openLink.ref;
    const beforeJoin = await fullJoin(world);
    expect(beforeJoin.phase).toBe('completed');

    const response = await remove(world, 'remove');
    expect(response.status).toBe('ready');
    if (response.status !== 'ready') throw new Error(`WDT-06: the remove was not ready: ${JSON.stringify(response)}`);
    // Lead Q2: the route answers the sibling `{settings, bootstrap}` shape, both without the removed workspace.
    expect(response.value.settings.workspaces.some(entry =>
      entry.scope.workspaceId === world.second.scope.workspaceId)).toBe(false);
    expect(response.value.bootstrap.workspaces.some(entry =>
      entry.scope.workspaceId === world.second.scope.workspaceId)).toBe(false);

    expect((await snapshotWorkspaces(world)).some(entry =>
      entry.scope.workspaceId === world.second.scope.workspaceId)).toBe(false);
    const catalog = await world.catalog(S6A_SCOPE);
    expect(catalog.catalog.catalog.modules.some(module => module.ref.moduleId === secondId(world))).toBe(false);
    expect(catalog.catalog.catalog.modules.some(module => module.ref.moduleId === 'src')).toBe(true);

    const afterJoin = await fullJoin(world);
    expect(afterJoin.phase).toBe('completed');
    if (afterJoin.action.kind !== 'role_line') throw new Error(`WDT-06: the join is a ${afterJoin.action.kind} record`);
    expect(afterJoin.action.result).toBeNull();
    expect(afterJoin.revision).toBe(beforeJoin.revision);

    const afterCard = await world.base.world.readSession(regionSession);
    const afterLink = afterCard.links.find(entry => sameJson(entry.ref, linkRef));
    expect(afterLink).toBeDefined();
    expect(afterLink?.until).not.toBeNull();

    const notices = await projectNotices(world);
    const removed = notices.filter(notice => notice.summary === REMOVED);
    expect(removed).toHaveLength(1);
    const itemKey = removed[0]!.itemKey;

    const again = await remove(world, 'remove');
    expect(again.status).toBe('rejected');
    if (again.status !== 'rejected') throw new Error(`WDT-06: the second remove was not rejected: ${JSON.stringify(again)}`);
    expect(again.code).toBe('not_found');
    const afterNotices = await projectNotices(world);
    expect(afterNotices.filter(notice => notice.summary === REMOVED)).toHaveLength(1);
    expect(afterNotices.filter(notice => notice.itemKey === itemKey)).toHaveLength(1);
  });
});
