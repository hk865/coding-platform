/**
 * P2 T29 (frozen `p2-frozen.md:343`; Q7c/M9): the secretary request round may call the four action tools;
 * after the request's owner changes the same call is `revision_conflict` with the current owner version.
 * The tools are absent on this tree, so the first failure is the P2 assertion (expected success / conflict
 * vs the Kernel's `unknown_tool`), never a setup error. No owner stand-in and no store read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { adoptPLTwoStageSkeleton, openPLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { P2_COORDINATION_TOOL_NAMES } from '../helpers/S6A-request-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { toolResultOf } from '../helpers/P2-tool-result.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: Array<Awaited<ReturnType<typeof openPLWorkflowWorld>>> = [];
afterEach(async () => { commitBarrier.reset(); for (const w of worlds.splice(0)) await w.close(); });
const LONG = 600_000;

describe('T29 secretary request-round action admission', () => {
  it('a secretary request round calls dispatch_task: the tool is mounted and the dispatch is accepted', async () => {
    const world = await openPLWorkflowWorld({ label: 'p29', tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(world);
    const { tasks } = await adoptPLTwoStageSkeleton(world.main, world.goal, { stageOneTaskIds: ['p29-a', 'p29-b'] });
    const tA = tasks[0]!;
    const held = await holdS6BRequestRound(world.world, { label: 'p29-ok', goalId: world.goal.goalId,
      replies: () => [{ kind: 'calls', calls: [{ callId: 'p29-dispatch', name: 'dispatch_task',
        args: { taskRef: tA, reason: 'P2 T29 dispatch' } }] }, { kind: 'text', text: 'P2 T29 ok done' }] },
    async inner => inner.secretary);
    const served = await world.world.scripted.requests(held.value);
    /* `toolResultOf` unwraps the Kernel success envelope to the owner's JSON body. */
    expect(toolResultOf(served, 'p29-dispatch')).toMatchObject({ status: 'requested' });
  }, LONG);

  it('after the request owner changes, the same action call is revision_conflict with the current owner version', async () => {
    const world = await openPLWorkflowWorld({ label: 'p29-c', tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(world);
    const { tasks } = await adoptPLTwoStageSkeleton(world.main, world.goal, { stageOneTaskIds: ['p29-c-a'] });
    const tA = tasks[0]!;
    const held = await holdS6BRequestRound(world.world, { label: 'p29-conflict', goalId: world.goal.goalId,
      replies: () => [{ kind: 'calls', calls: [{ callId: 'p29-conflict-call', name: 'dispatch_task',
        args: { taskRef: tA, reason: 'P2 T29 conflict' } }] }, { kind: 'text', text: 'P2 T29 conflict done' }] },
    async inner => {
      const other = await world.world.createSecretary('p29-other');
      await world.world.route({ commandId: 'p29-route', round: inner.request.round, to: other });
      return inner.secretary;
    });
    const served = await world.world.scripted.requests(held.value);
    // The Kernel's error shell wraps the owner's JSON body in output[0]; unwrap it before the assertion.
    const call = served.flatMap(request => request.messages)
      .find(message => message.role === 'tool' && message.callId === 'p29-conflict-call');
    if (call === undefined || call.role !== 'tool') throw new Error('P2 T29: no tool result for p29-conflict-call');
    const part = call.result.output[0];
    expect(part !== undefined && part.kind === 'json' ? part.value : undefined).toMatchObject({
      status: 'rejected', code: 'revision_conflict',
    });
  }, LONG);
});
