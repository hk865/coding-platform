/**
 * WD's remove-targets rows WDT-04, WDT-05 and WDT-12 (`wd-tests.frozen.md` §1): a workspace that still has an
 * unfinished Goal (`active` or `paused`) or a `running` Run refuses `workspaces/remove` with the targets listed.
 *
 * The world is `tests/helpers/S7D2-DWD-world.ts` over `tests/helpers/XWS2A-world.ts`: the second workspace and its
 * Goal, the join and the Host settings routes are all real public steps. WDT-05 holds the Run at its model request
 * through the world's existing `gates.modelRequest` (the shape of `tests/scenarios/S7D2-XWS2A-work.test.ts:251`).
 * Nothing here reads or writes a store, and no expected value comes from `src`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsResponse } from '../../src/app/host-settings-types.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { readRun, type XWS2AWorld } from '../helpers/XWS2A-world.js';
import {
  controlSecondGoal, fullJoin, openDwdWorld, remove, snapshotWorkspaces,
} from '../helpers/S7D2-DWD-world.js';

const worlds: XWS2AWorld[] = [];
afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

async function opened(): Promise<XWS2AWorld> {
  const world = await openDwdWorld({ backend: 'memory', withModule: true });
  worlds.push(world);
  return world;
}

const mounted = async (world: XWS2AWorld): Promise<boolean> => {
  const workspaces = await snapshotWorkspaces(world);
  return workspaces.some(entry => entry.scope.workspaceId === world.second.scope.workspaceId);
};

describe('WD remove targets', () => {
  // Today RED at the `remove(world,'remove')` code/reason assertion (the Host answers `not_found`: "unpublished
  // settings route workspaces/remove"): the Host has no workspaces/remove route; after WD lands GREEN because
  // WD-08 lists every non-`cancelled` Goal (here `active`) and WD-29 maps the core `busy` to `invalid`.
  it('WDT-04 a remove with an active Goal is rejected and names the goal', async () => {
    const world = await opened();
    const goal = valueOf<{ goal: { desiredState: string } }>(
      await world.second.workspace.route('goals/read', world.second.goal), 'ready', 'the second workspace Goal');
    expect(goal.goal.desiredState).toBe('active');

    const response = await remove(world, 'remove');
    expect(response.status).toBe('rejected');
    if (response.status !== 'rejected') throw new Error(`WDT-04: the remove was not rejected: ${JSON.stringify(response)}`);
    expect(response.code).toBe('invalid');
    expect(response.reason).toBe(`the workspace still has unfinished targets: goals ${world.second.goal.goalId} (active)`);
    expect(await mounted(world)).toBe(true);
    expect((await fullJoin(world)).phase).not.toBe('failed');
  });

  // Today RED at the `remove(world,'remove')` code/reason assertion taken while the model request is held (the Host
  // answers `not_found`: "unpublished settings route workspaces/remove"): the Host has no workspaces/remove route;
  // after WD lands GREEN because WD-09 lists `starting`/`running` Runs (here `running`) and WD-29 maps `busy` to
  // `invalid`. The gate is released and the pending Work Run awaited in `finally`, so the fixture is not left held.
  it('WDT-05 a remove with a running Run is rejected and names the run', async () => {
    const world = await opened();
    const gate = await world.base.world.gates.modelRequest(world.adviser);
    const pending = world.workRun({ label: 'dwd-run', replies: [{ kind: 'text', text: 'DWD run done' }] });
    await gate.reached;
    const run = await world.second.workspace.taskRun(world.second.goal, 'xws2a-dwd-run');
    expect(run).not.toBeNull();
    if (run === null) throw new Error('WDT-05: the dwd-run Work Run is not readable');

    let response: SettingsResponse<unknown> | null = null;
    try {
      response = await remove(world, 'remove');
    } finally {
      gate.release();
      await pending;
    }
    expect(response).not.toBeNull();
    if (response === null) throw new Error('WDT-05: the remove route answered nothing');
    expect(response.status).toBe('rejected');
    if (response.status !== 'rejected') throw new Error(`WDT-05: the remove was not rejected: ${JSON.stringify(response)}`);
    expect(response.code).toBe('invalid');
    expect(response.reason).toContain(`runs ${run.runId} (running)`);
    expect((await readRun(world, run)).run.status).toBe('ended');
    expect(await mounted(world)).toBe(true);
  });

  // Today RED at the `remove(world,'remove')` code/reason assertion after the Goal is paused (the Host answers
  // `not_found`: "unpublished settings route workspaces/remove"): the Host has no workspaces/remove route; after WD
  // lands GREEN because WD-08 treats `paused` as unfinished and WD-29 maps `busy` to `invalid`.
  it('WDT-12 a remove with a paused Goal is rejected and names the goal', async () => {
    const world = await opened();
    const paused = await controlSecondGoal(world, 'pause');
    expect(paused.goal.desiredState).toBe('paused');

    const response = await remove(world, 'remove');
    expect(response.status).toBe('rejected');
    if (response.status !== 'rejected') throw new Error(`WDT-12: the remove was not rejected: ${JSON.stringify(response)}`);
    expect(response.code).toBe('invalid');
    expect(response.reason).toContain(`${world.second.goal.goalId} (paused)`);
    expect(await mounted(world)).toBe(true);
  });
});
