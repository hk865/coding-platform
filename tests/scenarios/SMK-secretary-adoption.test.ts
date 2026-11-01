/**
 * SMK-1 (§1/§2), SMK-2 (§3), SMK-3 (§5): the input names the project and served roles; adoption refuses an unserved
 * role; two first-plan adoptions start the Goal driver without advance/driver-start, each Task claimed once, the same
 * adopt body replays. UNSPECIFIED: the main scope is read-only (`S6A-request-fixture.ts:560`; `host.ts:1335-1343`
 * cannot widen it), so its `setup` stops at `checks` with `forbidden: approving command checks requires the workspace
 * real write and command grant` (`host-settings.ts:961-963`); the Host settings-opened workspace has those grants.
 */
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskExecutionPage, TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { graphWrite, plain, readBootstrap } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer,
  type S6B3World } from '../helpers/S6B3-fixture.js';
import { waitFor } from './harness.js';
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
const SMK_TASK_ID = 'smk-initial-work';
const smkSetup = (): InitialPlanningSetupV2 => ({ architecture: { baselineId: 'smk-baseline', description: 'SMK governance', constraints: [], catalog: { requireDag: true, dependencies: [], modules: [] } }, completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 }, checks: [] });
/** One whole v2 `kind: 'plan'` answer: two card drafts, the legal setup, the named `planDraftIndex`, one required
 *  executable work Task assigned to `role`. */
const smkPlanText = (input: { label: string; planDraftIndex: 0 | 1; role: string }): string => JSON.stringify({
  schemaVersion: 2, kind: 'plan', summary: `SMK ${input.label} coordination`,
  plan: { schemaVersion: 2, stages: [], tasks: [{ taskId: SMK_TASK_ID, title: `SMK ${input.label} work`,
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'request_execution' }],
    assignments: [{ taskId: SMK_TASK_ID, role: input.role, instruction: `SMK ${input.label} work` }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } },
  goalCardDrafts: [
    { objective: `SMK ${input.label} draft 0`, completion: [`SMK ${input.label} criterion 0`], autonomy: 'every_step', screening: null },
    { objective: `SMK ${input.label} draft 1`, completion: [`SMK ${input.label} criterion 1`], autonomy: 'after_plan_confirmation', screening: null },
  ],
  planDraftIndex: input.planDraftIndex, setup: smkSetup(),
});
const taskRuns = async (world: S6B3World, scope: { projectId: string; workspaceId: string }, goal: GoalRef): Promise<TaskExecutionRecord[]> =>
  ((await world.host.post('executions/list', plain(scope, { goalRef: goal, taskId: SMK_TASK_ID, page: { afterCursor: null, limit: 2 } })))
    .body as { value?: TaskExecutionPage }).value?.items ?? [];
const sessionsIn = async (world: S6B3World, scope: { projectId: string; workspaceId: string }): Promise<SessionCard[]> => {
  const read = await world.host.post('sessions/find', plain(scope, {
    workspace: scope, includeArchived: false, page: { limit: 50 },
  }));
  const body = read.body as { status?: string; value?: { items?: SessionCard[] } };
  if (body.status !== 'ready') throw new Error(`the second workspace Session read is not ready: ${JSON.stringify(body)}`);
  return body.value?.items ?? [];
};
const memberCardIn = async (world: S6B3World, scope: { projectId: string; workspaceId: string }): Promise<DecisionCardV1> => {
  const queue = await waitFor(async () => {
    const read = await world.host.post('decisions/queue', plain(scope, {
      workspace: scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const body = read.body as { status?: string; value?: DecisionQueueReadV1 };
    if (body.status !== 'ready' || body.value === undefined) {
      throw new Error(`the decision queue is not readable: ${JSON.stringify(body)}`);
    }
    return body.value;
  }, value => value.waitingAnswer.some(card => card.source.kind === 'member_creation'),
  'the host-pick member_creation card');
  const card = queue.waitingAnswer.find(candidate => candidate.source.kind === 'member_creation');
  if (card === undefined) throw new Error('the member_creation card disappeared from the waiting queue');
  return card;
};
async function adoptFirstPlan(world: S6B3World, scope: { projectId: string; workspaceId: string },
  planDraftIndex: 0 | 1, label: string): Promise<void> {
  const held = await holdS6B3RequestAnswer(world, { scope, label, goalId: null, executionKind: 'initial_coordination',
    reply: () => ({ kind: 'text', text: smkPlanText({ label, planDraftIndex, role: 'local-workbench' }) }) });
  const answer = await releaseS6B3DraftAnswer(world, held);
  expect(answer.drafts[planDraftIndex]?.autonomy).toBe(planDraftIndex === 0 ? 'every_step' : 'after_plan_confirmation');
  const confirmed = await world.host.post('goals/confirm-draft', plain(scope, { commandId: `${label}-confirm-0`, round: held.round, index: planDraftIndex }));
  expect(confirmed.body).toMatchObject({ status: 'committed' });
  const goal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
  // A-25: picking no longer makes a line, so the workspace holds one idle executor line before the adoption.
  expect((await world.host.post('sessions/create', plain(scope, { workspace: scope, role: LOCAL_WORKBENCH_ROLE, recommendedRefs: [],
    initialLinks: [], meta: { requestId: `${label}-line`, expected: [] } }))).body).toMatchObject({ status: 'completed' });
  world.host.scriptReplies([{ kind: 'text', text: `SMK ${label} work done` }]);
  const body = { commandId: `${label}-adopt`, expectedAnswerDigest: sha256Hex(answer.answerText), source: { kind: 'binding', answerRef: answer.answerRef, draftIndex: planDraftIndex }, expectedGoal: { ref: goal, revision: 1 } };
  const first = (await world.host.post('initialization/adopt', plain(scope, body))).body;
  expect(first).toMatchObject({ status: 'committed', replayed: false });
  await waitFor(() => taskRuns(world, scope, goal), runs => runs.length === 1, `${label}: the Task claim`);
  expect((await world.host.post('workflow/driver-read', plain(scope, { goalRef: goal }))).body)
    .toMatchObject({ status: 'ready' });
  // The stored result's `replayed` is the plan apply's false (`initialization-adoption.ts:355`); replay is the same receipt.
  expect((await world.host.post('initialization/adopt', plain(scope, body))).body).toEqual(first);
  expect(await taskRuns(world, scope, goal)).toHaveLength(1);
}
describe('SMK-1: the secretary input names the project and the roles the workspace serves (memory)', () => {
  it('shows the scope projectId and served roles in the main and the settings-opened workspace', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const reply = (label: string, role: string) => ({ kind: 'text' as const, text: smkPlanText({ label, planDraftIndex: 0, role }) });
      const main = await holdS6BRequestRound(world.host, { label: 'smk1-main', goalId: null, replies: () => [reply('smk1-main', 'builder')] },
        async round => round.secretary);
      const second = await configureS6B3SecondWorkspace(world, { name: 'smk1', goals: 2 });
      const held = await holdS6B3RequestAnswer(world, { scope: second.scope, label: 'smk1-second', goalId: null,
        executionKind: 'initial_coordination', reply: () => reply('smk1-second', 'local-workbench') });
      await held.release();
      const mainRequest = (await world.host.scripted.requests(main.value)).at(-1);
      const request = world.host.model.lastRequest();
      if (mainRequest === undefined || request === undefined) throw new Error('SMK-1: a round served no model request');
      for (const [scope, role, entry] of [[world.mainScope, 'builder', mainRequest], [second.scope, 'local-workbench', request]] as const) {
        const text = entry.messages.flatMap(message => message.role === 'user' ? [message.content] : []).join('\n');
        expect(text).toContain(`projectId: ${scope.projectId}`);
        expect(text).toContain(`available roles: ${role}`);
      }
    } finally { await world.close(); }
  });
});
describe('SMK-2: adoption refuses a role no execution binding serves (memory)', () => {
  it('rejects invalid and writes nothing', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const scope = world.mainScope;
      const held = await holdS6B3RequestAnswer(world, { scope, label: 'smk2', goalId: null, executionKind: 'initial_coordination',
        reply: () => ({ kind: 'text', text: smkPlanText({ label: 'smk2', planDraftIndex: 0, role: 'platform-engineer' }) }) });
      const answer = await releaseS6B3DraftAnswer(world, held);
      const confirmed = await world.host.post('goals/confirm-draft', plain(scope, { commandId: 'smk2-confirm', round: held.round, index: 0 }));
      expect(confirmed.body).toMatchObject({ status: 'committed' });
      const goal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
      const adopted = (await world.host.post('initialization/adopt', plain(scope, { commandId: 'smk2-adopt', expectedAnswerDigest: sha256Hex(answer.answerText),
        source: { kind: 'binding', answerRef: answer.answerRef, draftIndex: 0 }, expectedGoal: { ref: goal, revision: 1 } }))).body;
      expect(adopted).toMatchObject({ status: 'rejected', code: 'invalid',
        reason: 'the plan assigns role platform-engineer, which no execution binding of this workspace serves (served: builder)' });
      const read = (await world.host.post('goals/read', plain(scope, goal))).body as { value: { goal: { activePlanRevision: unknown } } };
      expect(read.value.goal.activePlanRevision).toBeNull();
      expect((await world.host.post('architecture/read', plain(scope, { selection: { kind: 'current' } }))).body)
        .toMatchObject({ status: 'not_found' });
    } finally { await world.close(); }
  });
});
describe('SMK-3: adoption starts the Goal driver without advance or driver-start (memory)', () => {
  it.each([[0, 'smk-a'], [1, 'smk-b']] as const)('starts draft %i in its own world', async (planDraftIndex, label) => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const second = await configureS6B3SecondWorkspace(world, { name: label, goals: 2 });
      await adoptFirstPlan(world, second.scope, planDraftIndex, label);
    } finally { await world.close(); }
  });
});
describe('L1-24: adoption with no seeded line reaches the host pick and runs the Task (memory)', () => {
  // L1-24b is a cold-start Host: no `workflow` option at start; the workspace opened through settings registers
  // its binding afterwards (`host.ts` `registerWorkspace` -> `platform.registerWorkflowBinding`), and both the
  // executor-role read and the default duty resolver must see that live dependency.
  it.each([
    { row: 'L1-24', label: 'l1-24', coldStart: false },
    { row: 'L1-24b', label: 'l1-24b', coldStart: true },
  ])('$row: creates the member line on approval and the Task starts', async ({ label, coldStart }) => {
    const world = await openS6B3World(coldStart
      ? { backend: 'memory', omitStartupWorkflow: true }
      : { backend: 'memory' });
    try {
      if (coldStart) expect((await readBootstrap(world.host.ag2b)).execution.workflowScopes).toEqual([]);
      const scope = (await configureS6B3SecondWorkspace(world, { name: label, goals: 2 })).scope;
      if (coldStart) expect((await readBootstrap(world.host.ag2b)).execution.workflowScopes).toEqual([scope]);

      // The same real steps as `adoptFirstPlan`, minus its `sessions/create` seed.
      const held = await holdS6B3RequestAnswer(world, { scope, label, goalId: null, executionKind: 'initial_coordination',
        reply: () => ({ kind: 'text', text: smkPlanText({ label, planDraftIndex: 0, role: 'local-workbench' }) }) });
      const answer = await releaseS6B3DraftAnswer(world, held);
      expect(answer.drafts[0]?.autonomy).toBe('every_step');
      const confirmed = await world.host.post('goals/confirm-draft', plain(scope, {
        commandId: `${label}-confirm-0`, round: held.round, index: 0,
      }));
      expect(confirmed.body).toMatchObject({ status: 'committed' });
      const goal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
      world.host.scriptReplies([{ kind: 'text', text: `SMK ${label} work done` }]);
      const adopted = (await world.host.post('initialization/adopt', plain(scope, {
        commandId: `${label}-adopt`, expectedAnswerDigest: sha256Hex(answer.answerText),
        source: { kind: 'binding', answerRef: answer.answerRef, draftIndex: 0 },
        expectedGoal: { ref: goal, revision: 1 },
      }))).body;
      expect(adopted).toMatchObject({ status: 'committed', replayed: false });

      // The adoption driver reaches `host_pick_member`; the person approves through the public decision route.
      const card = await memberCardIn(world, scope);
      expect(card.options.map(option => option.id)).toEqual(['approve', 'reject']);
      const answered = await world.host.post('decisions/answer', graphWrite(scope, {
        source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
      }, `${label}-approve`, card.source.pins));
      expect(answered.body).toMatchObject({ status: 'ready', value: { answer: { status: 'committed' } } });

      const runs = await waitFor(() => taskRuns(world, scope, goal),
        value => value.length === 1 && value[0]!.run.startedSince !== null, `${label}: the Task start`);
      expect(runs[0]?.run.startedSince).not.toBeNull();

      const localWorkbenchRole = { kind: 'legacy_template', templateId: 'local-workbench', templateRevision: '1' } as const;
      const members = (await sessionsIn(world, scope))
        .filter(session => JSON.stringify(session.record.role) === JSON.stringify(localWorkbenchRole));
      expect(members).toHaveLength(1);
      const member = members[0]!;
      expect(member.record.role).toEqual(localWorkbenchRole);
      expect(member.links.some(link => link.until === null && link.ref.relation === 'responsible'
        && JSON.stringify(link.ref.target) === JSON.stringify({ kind: 'task', ref: {
          projectId: scope.projectId, goalId: goal.goalId, taskId: SMK_TASK_ID } }))).toBe(true);
    } finally { await world.close(); }
  });
});
