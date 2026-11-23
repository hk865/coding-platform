/**
 * P2 T37 (frozen row :351): the original request detail carries the `feedback`
 * derived from the actions, holds and plan version under its `requestRoot`. The
 * person submits a change request; a candidate carrying that root moves one
 * Task and is adopted; `requests/read` with the original root must show
 * `feedback` with the affected Task and the plan version.
 *
 * Field names are UNSPECIFIED in the frozen row; S-2 fixes `affectedTasks/actions/
 * planRevision`. The first row reads the version and tasks; the second row adds the
 * named actions (hold/stop/dispatch) and reports that entry shape as UNSPECIFIED.
 */
import { describe, expect, it } from 'vitest';
import { plPlanChangeDraft, adoptPLTwoStageSkeleton, openPLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { P2_COORDINATION_TOOL_NAMES, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, holdS7AQueryRound, ready } from '../helpers/S7A-fixture.js';
import { p1Worlds, write } from '../helpers/P1-reads.js';

const LONG = 240_000;

type ReadBody = { requestRoot: { queryJobId: string } };
type Detail = { status: string; value?: { feedback?: unknown } };

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

describe('P2 T37: the original request detail shows the change feedback', () => {
  it('reads feedback with affectedTasks and planRevision under the original requestRoot', async () => {
    const workflow = await openPLWorkflowWorld({ label: 'p2-t37', tools: P2_COORDINATION_TOOL_NAMES });
    try {
      const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal,
        { label: 'p2-t37', stageOneTaskIds: ['pl-a', 'pl-b'] });
      const request = await workflow.main.submit({ label: 'p2-t37', goalId: workflow.goal.goalId,
        text: 'P2 T37 change request' });
      expect(request, 'the person request is queued').toMatchObject({ requestRoot: expect.anything() });

      const changed = skeleton.plan.tasks.find(task => task.taskId === 'pl-a');
      if (changed === undefined) throw new Error('P2 T37: the skeleton has no pl-a');
      const draft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
        planId: 'p2-t37-plan-v2',
        tasks: skeleton.plan.tasks.map(task => task.taskId === 'pl-a'
          ? { ...task, title: 'P2 T37 changed title' } : task),
        assignments: skeleton.plan.assignments ?? [],
        obligations: skeleton.plan.obligations,
      });
      const proposed = committed<{ ref: unknown; revision: number }>(await workflow.main.post('plans/propose',
        graphWrite(S6A_SCOPE, { goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
          requestRef: request.requestRoot,
          reason: { text: 'P2 T37 request change', sources: [], affectedTaskIds: ['pl-a'] } }, 'p2-t37-propose')),
      'the request candidate');
      committed(await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
      }, 'p2-t37-apply')), 'the person adopts the change');

      const detailBody: unknown = (await workflow.world.post('requests/read', plain(S6A_SCOPE,
        { requestRoot: request.requestRoot }))).body;
      const detail = recordOf(detailBody);
      expect(detail['status'], 'requests/read with the original requestRoot').toBe('ready');
      // P2's `RequestReadV1.feedback` lives in the detail `value`, not at the envelope top level.
      // `actions` is UNSPECIFIED in wording here; assert it is present without inventing its entries.
      expect(recordOf(detail['value'])['feedback'], 'the original request detail carries feedback under value')
        .toMatchObject({
          affectedTasks: expect.arrayContaining([
            { projectId: 'ag2b-collab-project', goalId: 'ag2b-goal', taskId: 'pl-a' },
          ]),
          actions: expect.any(Array),
          planRevision: {
            aggregateType: 'PlanRevision', projectId: 'ag2b-collab-project', planId: 'p2-t37-plan-v2',
          },
        });
      const graph = ready<{ plan: { planRevision: number } }>(await workflow.main.route('tasks/query',
        { goalRef: workflow.goal }), 'the adopted plan');
      expect(graph.plan.planRevision, 'the feedback names the adopted version').toBe(2);
    } finally {
      await workflow.close();
    }
  }, 180_000);

  it('the feedback actions name the held, stopped and dispatched Tasks with the plan version', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open({ running: true });
    try {
      // A real held request round; the actions are placed from its own context, so their stored
      // intake root is this request's `requestRoot` (not another held round's).
      const feedback = await holdS7AQueryRound(p1.world, { label: 'p2-t37-actions', goalId: p1.goal.goalId },
        async (ctx, round) => {
          expect(await p1.world.platform.claimHolds.place(ctx,
            write({ taskRef: p1.task.tA, reason: 'P2 T37 hold tA' }, 'p2-t37-hold')))
            .toMatchObject({ status: 'committed' });
          expect(await p1.world.platform.actionRequests.requestDispatch(ctx,
            write({ taskRef: p1.task.tA, reason: 'P2 T37 dispatch tA' }, 'p2-t37-dispatch')))
            .toMatchObject({ status: 'requested' });
          expect(await p1.world.platform.actionRequests.requestStop(ctx,
            write({ taskRef: p1.task.tB, reason: 'P2 T37 stop tB' }, 'p2-t37-stop')))
            .toMatchObject({ status: expect.any(String) });
          const detail = (await p1.world.post('requests/read', plain(S6A_SCOPE,
            { requestRoot: round.request.requestRoot }))).body as { status: string; value?: { feedback?: unknown } };
          expect(detail.status, 'requests/read with the original requestRoot').toBe('ready');
          return recordOf(detail.value)['feedback'];
        });
      expect(feedback, 'the original request detail carries feedback').toMatchObject({
        planRevision: null,
        actions: expect.arrayContaining([
          expect.objectContaining({ task: expect.objectContaining({ taskId: 'p1-ta' }) }),
          expect.objectContaining({ task: expect.objectContaining({ taskId: 'p1-tb' }) }),
        ]),
      });
    } finally {
      await worlds.closeAll();
    }
  }, LONG);
});
