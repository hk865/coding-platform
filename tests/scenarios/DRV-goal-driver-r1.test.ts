/** DRV §5.1 D-R1: a refinement adopted while A runs starts B before A ends. */
// Named mutation: make the decision loop wait for the watch it just started (`await lane.done` after `startLaneLoop`) → B has no Run while A is held.

import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { refinementPlan } from '../helpers/S7B-V-fixture.js';
import { openDrvWorld, runsOf, startGoalDriver } from '../helpers/DRV-fixture.js';
import { limitHold } from '../helpers/hold-limit.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('DRV goal driver refinement while a Task runs (memory)', () => {
  it('D-R1 adopts a Plan that adds B while A is held and B starts before A finishes', async () => {
    const { world, main, goal, tasks } = await openDrvWorld('drv-r1', ['drv-r1-a'],
      'DRV D-R1 refinement while A runs');
    worlds.push(world);
    const lineA = await createS6BLine(main, { label: 'drv-r1-a', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    // An idle line is where the Workflow claims the newly added B; it is not
    // linked to a Task yet because the first Plan does not name B.
    const lineB = await createS6BLine(main, { label: 'drv-r1-b', role: S6A_WORK_ROLE });
    const sessionA = await sessionOf(world, lineA);
    const sessionB = await sessionOf(world, lineB);
    await world.scripted.script(sessionA, [{ kind: 'text', text: 'DRV D-R1 A done' }]);
    await world.scripted.script(sessionB, [{ kind: 'text', text: 'DRV D-R1 B done' }]);
    const gateA = await world.gates.modelRequest(sessionA);
    const gateB = await world.gates.modelRequest(sessionB);
    await startGoalDriver(world, goal, 'drv-r1');
    await limitHold(gateA.reached, 'D-R1 A model request');
    expect((await runsOf(world, goal, 'drv-r1-a')).some(record => record.run.status === 'running')).toBe(true);

    // The public refinement path: read the active Plan, propose revision 2 with
    // B prepended, then adopt it.
    const draft = (JSON.parse(await refinementPlan(world, goal, { label: 'drv-r1',
      taskId: 'drv-r1-b', role: S6A_WORK_ROLE.templateId })) as { plan: Record<string, unknown> }).plan;
    const current = await main.activePlan(goal);
    if (current === null) throw new Error('D-R1: the Goal has no adopted Plan to refine');
    const goalRevision = ready<{ goal: GoalSnapshot }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
      'D-R1 the Goal').goal.revision;
    const proposed = committed<{ ref: unknown; revision: number }>(await world.post('plans/propose',
      graphWrite(S6A_SCOPE, {
        goalRef: goal, basedOn: current.ref, draft,
        reason: { text: 'DRV D-R1 refinement', sources: [] },
      }, 'drv-r1-propose', [{ ref: goal, revision: goalRevision }])), 'the refinement proposal');
    committed(await world.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, 'drv-r1-apply')), 'the refinement adoption');

    // B's Run starts while A's model request is still held: it does not wait for
    // A to finish.
    await limitHold(gateB.reached, 'D-R1 B model request');
    expect(await runsOf(world, goal, 'drv-r1-b')).toHaveLength(1);
    expect((await runsOf(world, goal, 'drv-r1-a')).some(record => record.run.status === 'running')).toBe(true);
    gateB.release();
    gateA.release();
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 120_000);
});
