/**
 * P2 T30 (frozen `p2-frozen.md:344`; Q1a; lead 11-21): an adviser planning round without the manifest grant
 * is refused by the `dispatch_task` owner with `forbidden` "这一轮没有授予这个动作". The binding below
 * deliberately leaves `dispatch_task` out of the adviser grant.
 *
 * Two sides, each where the frozen text puts it: the mount follows the grant (§2.6 :234 "按上表把 Host 授予、
 * 准备时上限、启动侧工厂和最终组装对齐"), so the model's own `dispatch_task` call reaches no tool and gets
 * the Kernel's error envelope; the owner reads the same round's frozen grant (§2.6 :235), so the action
 * owner called with that held round's own `query_run` context (rule sheet A3, `captureAnswerContexts`) is
 * `forbidden` with the frozen sentence. lead 11-23 accepted this two-sided reading; the earlier KNOWN GAP note
 * (the row kept red as unreachable) no longer applies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { committed } from '../helpers/S7A-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, openPLWorkflowWorld, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { toolResultOf } from '../helpers/P2-tool-result.js';
import { write } from '../helpers/P1-reads.js';
import { captureAnswerContexts } from '../helpers/query-context-capture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: PLWorkflowWorld[] = [];
afterEach(async () => { commitBarrier.reset(); for (const world of worlds.splice(0)) await world.close(); });
const LONG = 600_000;

describe('T30 adviser dispatch_task manifest grant', () => {
  it('without the grant: forbidden "这一轮没有授予这个动作"', async () => {
    // The adviser binding's grant is exactly `read`; `dispatch_task` is not in the frozen round.
    const workflow = await openPLWorkflowWorld({ label: 'p30', tools: ['read'] });
    worlds.push(workflow);
    const { tasks } = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal,
      { stageOneTaskIds: ['p30-a'] });
    const adviser = await createPLAdviserLine(workflow.world, 'p30-adviser');
    await workflow.world.scripted.script(adviser, [
      { kind: 'calls', calls: [{ callId: 'p30-nogrant', name: 'dispatch_task',
        args: { taskRef: tasks[0]!, reason: 'P2 T30 no grant' } }] },
      { kind: 'text', text: 'P2 T30 no grant done' },
    ]);
    const model = await workflow.world.gates.modelRequest(adviser);
    const capture = captureAnswerContexts();
    try {
      committed(await workflow.world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: adviser.ref, text: 'P2 T30 open the adviser round', entry: 'person_intervention',
        needsReply: true, goalRef: workflow.goal,
      }, 'p30-open')), 'the P30 opening message');
      const { settled } = await heartbeatUntilModel(workflow.world, model);
      // The round is held at its model request: its own context, as the Runtime handed it to the round's tools.
      const occupancy = (await workflow.world.readSession(adviser)).record.occupancy;
      const ctx = occupancy?.kind === 'execution' ? capture.ofRun(occupancy.executionRef.runId) : undefined;
      if (ctx === undefined) throw new Error('T30: no held adviser round context');
      expect(await workflow.world.platform.actionRequests.requestDispatch(ctx,
        write({ taskRef: tasks[0]!, reason: 'P2 T30 no grant' }, 'p30-nogrant-owner'))).toMatchObject({
        status: 'rejected', code: 'forbidden', reason: '这一轮没有授予这个动作',
      });
      model.release();
      await settled;
    } finally {
      capture.restore();
    }
    // The ungranted tool is not mounted: the model's call gets the Kernel's error, not an owner receipt.
    expect(toolResultOf(await workflow.world.scripted.requests(adviser), 'p30-nogrant')).toMatchObject({
      status: 'error',
    });
  }, LONG);
});
