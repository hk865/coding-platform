/**
 * SMK-1 (§1/§2), SMK-2 (§3), SMK-3 (§5): the input names the project and served roles; adoption refuses an unserved
 * role; two first-plan adoptions start the Goal driver without advance/driver-start, each Task claimed once, the same
 * adopt body replays. UNSPECIFIED: the main scope is read-only (`S6A-request-fixture.ts:560`; `host.ts:1335-1343`
 * cannot widen it), so its `setup` stops at `checks` with `forbidden: approving command checks requires the workspace
 * real write and command grant` (`host-settings.ts:961-963`); the Host settings-opened workspace has those grants.
 */
import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskExecutionPage } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
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
const taskRuns = async (world: S6B3World, scope: { projectId: string; workspaceId: string }, goal: GoalRef): Promise<unknown[]> =>
  ((await world.host.post('executions/list', plain(scope, { goalRef: goal, taskId: SMK_TASK_ID, page: { afterCursor: null, limit: 2 } })))
    .body as { value?: TaskExecutionPage }).value?.items ?? [];
async function adoptFirstPlan(world: S6B3World, scope: { projectId: string; workspaceId: string },
  planDraftIndex: 0 | 1, label: string): Promise<void> {
  const held = await holdS6B3RequestAnswer(world, { scope, label, goalId: null, executionKind: 'initial_coordination',
    reply: () => ({ kind: 'text', text: smkPlanText({ label, planDraftIndex, role: 'local-workbench' }) }) });
  const answer = await releaseS6B3DraftAnswer(world, held);
  expect(answer.drafts[planDraftIndex]?.autonomy).toBe(planDraftIndex === 0 ? 'every_step' : 'after_plan_confirmation');
  const confirmed = await world.host.post('goals/confirm-draft', plain(scope, { commandId: `${label}-confirm-0`, round: held.round, index: planDraftIndex }));
  expect(confirmed.body).toMatchObject({ status: 'committed' });
  const goal = (confirmed.body as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref;
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
