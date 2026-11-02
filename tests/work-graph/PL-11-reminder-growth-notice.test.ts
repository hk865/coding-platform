/**
 * PL-11 (spec §15.3, v3 §9-11): the task reminder line and the 2x growth line.
 *
 * The real consume Host has one adviser line and its consumer. Task A is
 * `small` (reminder 1M / two-times 2M). A's first Work Run reports 1.2M growth,
 * so the goal loop sends the ordinary `notify` and opens no round. A's second
 * Run (after a v3 that changes only B) lifts the same Task to 2.1M, so the loop
 * sends one `deviation:…:growth:3` with the Host system actor; the Host consumes
 * it at `plan_round` with `submit_plan_round`, and the adviser's plain-text answer
 * becomes the person's `plan_notice`. A stays active and B still runs.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import { advanceUntil, post, readExecution } from '../helpers/A2-restart-fixture.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, committed, ready } from '../helpers/S7A-fixture.js';
import {
  heartbeatUntil, readBody, readPlanningQuery, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import {
  openPLDeviationConsumptionWorld, type PLDeviationConsumptionWorld,
} from '../helpers/PL-deviation-fixture.js';

// The composition generates Run ids with randomUUID; a descending id makes the
// SECOND Run's reference key smaller than the first's, so the execution page
// (ascending by ref key) puts the older Run last. The Runs themselves stay real.
vi.mock('node:crypto', async importOriginal => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  let next = 0xffffffffffff;
  return { ...actual, randomUUID: () =>
    `00000000-0000-4000-8000-${(next--).toString(16).padStart(12, '0')}` };
});

let opened: PLDeviationConsumptionWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

async function advanceTo(world: PLDeviationConsumptionWorld, flowId: string, kind: string) {
  return await advanceUntil(world.world.ag2b, { schemaVersion: 1, goalRef: world.goal,
    flowId, sessionHint: null, kind: 'select_work' }, kind);
}

it('PL-11: 1.2M sends one notify, a real rerun lifts the same Task to 2.1M and sends one growth round on v3', async () => {
  // The real check passes once this Run creates the marker: the first Run
  // fails, the rerun succeeds, so the Task's failure clears after the rerun.
  const staticChecks = checkConfiguration({ ...OPERATOR, kind: 'human' });
  const fixture = opened = await openPLDeviationConsumptionWorld({
    label: 'pl11', taskIds: ['pl11-a', 'pl11-b'], write: true,
    sizes: [{ taskId: 'pl11-a', sizeClass: 'small' }, { taskId: 'pl11-b', sizeClass: 'small' }],
    checks: { ...staticChecks, checks: staticChecks.checks.map(check =>
      ({ ...check, command: 'test -f pl11-pass-marker.txt' })) },
  });
  const { world, goal, tasks, line, adviser } = fixture;
  const [a, b] = tasks;
  if (a === undefined || b === undefined) throw new Error('PL-11: the Plan needs two Tasks');

  // Run 1 on A: 1.2M growth reaches the reminder line only.
  const first = await fixture.runTask({ line, taskId: a.taskId, flowId: 'pl11-a1',
    replies: [{ kind: 'text', text: 'PL-11 first Run without the marker', usage: usage(0, 1_200_000) }] });
  expect((await readExecution(world.ag2b, first)).run.status).toBe('ended');
  const notifyInput = await advanceTo(fixture, 'pl11-notify', 'notify_plan_reminder');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, notifyInput)), 'the reminder notify');

  const inbox = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
    plain(S6A_SCOPE, { recipient: adviser.ref, page: { limit: 50 } })), 'the adviser inbox');
  const reminders = inbox.items.filter(message => message.intent === 'notify');
  expect(reminders).toHaveLength(1);
  const reminderText = await readBody(world, reminders[0]!.ref, 'message');
  expect(reminderText).toContain(`plan-reminder:${goal.goalId}:${a.taskId}:2`);
  expect(reminderText).toContain('1200000');
  const noRound = systemRoundMessageRef(S6A_SCOPE, `deviation:${goal.goalId}:${a.taskId}:growth:2`);
  if (noRound.status !== 'ready') throw new Error('PL-11: no growth message ref');
  expect((await world.post('messages/read', plain(S6A_SCOPE, noRound.value))).body)
    .toMatchObject({ status: 'not_found' });

  // v3 changes only B, then the person's real requeue gives A its second Run.
  const plan1 = await fixture.main.activePlan(goal);
  if (plan1 === null) throw new Error('PL-11: the sized Plan is not active');
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: `${plan1.planId}-v3`, planRevision: plan1.planRevision + 1,
    goalId: goal.goalId, stages: structuredClone(plan1.stages),
    tasks: structuredClone(plan1.tasks).map(task => task.taskId === b.taskId
      ? { ...task, title: `${task.title} v3 only` } : task),
    assignments: structuredClone(plan1.assignments ?? []),
    obligations: structuredClone(plan1.obligations), taskHierarchy: structuredClone(plan1.taskHierarchy),
    executionDag: structuredClone(plan1.executionDag),
    taskRelations: structuredClone(plan1.taskRelations ?? []),
    inputRequirements: structuredClone(plan1.inputRequirements ?? []),
  };
  const proposed = committed<{ ref: unknown; revision: number }>(await fixture.main.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: plan1.ref, draft,
      reason: { text: 'PL-11 v3 only changes B', sources: [] } }, 'pl11-v3-propose')), 'the v3 proposal');
  committed(await fixture.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, 'pl11-v3-apply')), 'the v3 adoption');
  const second = await fixture.runTask({ line, taskId: a.taskId, flowId: 'pl11-a2', replies: [
    { kind: 'calls', calls: [{ callId: 'pl11-a2-marker', name: 'edit',
      args: { mode: 'create', path: 'pl11-pass-marker.txt', newText: 'PL-11 check passes\n' } }], usage: usage(0, 0) },
    { kind: 'text', text: 'PL-11 second Run', usage: usage(900_000, 0) },
  ] });
  const secondRead = await readExecution(world.ag2b, second);
  expect(secondRead.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  expect(secondRead.plan.planRevision, 'the second Run claims v3').toBe(3);
  expect(second.runId < first.runId, 'the newer Run sorts before the older one').toBe(true);

  // The growth trigger is the selected (newest) Run's revision, never the
  // execution page's last item (the older Run).
  const growthRef = systemRoundMessageRef(S6A_SCOPE, `deviation:${goal.goalId}:${a.taskId}:growth:3`);
  if (growthRef.status !== 'ready') throw new Error('PL-11: no growth message ref');
  const sendInput = await advanceTo(fixture, 'pl11-growth', 'send_system_round');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, sendInput)), 'the growth round');
  const message = ready<SessionMessage>((await world.post('messages/read', plain(S6A_SCOPE, growthRef.value))).body,
    'the growth message');
  expect(message.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });

  // The adviser's plain-text answer makes the person's notice.
  await world.scripted.script(adviser, [{ kind: 'text', text: 'PL-11: the adviser does not change the plan' }]);
  const query = await heartbeatUntil(world, () => readPlanningQuery(world, growthRef.value),
    value => value?.job.job.status === 'answered');
  expect(query?.job.job.intent.execution).toMatchObject({ kind: 'intervention_planning', answerShape: 'plan_round' });
  const modelRequests = await world.scripted.requests(adviser);
  expect(modelRequests.at(-1)?.tools.map(tool => tool.name)).toContain('submit_plan_round');
  await waitForResponse(world, growthRef.value);
  expect(await readBody(world, growthRef.value, 'response')).toBe('PL-11: the adviser does not change the plan');

  const queue = await fixture.main.readNotices({ goal, categories: ['plan_notice'], limit: 100 });
  const notices = queue.notices.filter(notice =>
    notice.itemKey === `deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:growth:3`);
  expect(notices).toHaveLength(1);
  expect(notices[0]!.summary).toContain('参谋不改计划');
  expect(notices[0]!.summary).toContain('PL-11: the adviser does not change the plan');

  // A is not stopped and B still runs.
  const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string; disposition: string }> }>(
    (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body, 'the task graph');
  for (const taskId of [a.taskId, b.taskId]) {
    const row = graph.tasks.find(candidate => candidate.ref.taskId === taskId);
    expect(row).toMatchObject({ disposition: 'active' });
    expect(row?.effectivePhase).not.toBe('stopped');
  }
}, 180_000);
