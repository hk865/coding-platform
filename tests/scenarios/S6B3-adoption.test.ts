/**
 * R-14 (acceptance, memory): a project's first planning answer is set up through `initialization/adopt`. The single-owner
 * rows prove each rule (the source chain row 31, the cards rows 33 and 34, the adoption rows 35a/35b and the checks rows
 * 36a/36b); this scenario strings them into what the person sees: the plan card's binding adopted end to end, the other
 * card refused and planned on the ordinary path, a no-setup answer that keeps the checks, and checks replaced after the
 * checks stage stopping the final adopt.
 */
import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import { initializationAdoptionOperationId, type InitializationAdoptionRef } from '../../src/contracts/initialization-adoption.js';
import type { InitializationSourceV1, InitialPlanningSetupV2 } from '../../src/contracts/initial-planning.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { RegisteredCommandCheck } from '../../src/contracts/verification.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  configureS6B3SecondWorkspace, holdS6B3AdoptionGate, holdS6B3DraftAnswer, holdS6B3PreparedGoalAnswer, openS6B3World,
  readS6B3DecisionQuestionKeys, releaseS6B3DraftAnswer, runS6B3PlanningQuery,
} from '../helpers/S6B3-fixture.js';

// The adoption stage gate is the commit barrier, so the file owns its two backend mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const check = (checkId: string): RegisteredCommandCheck =>
  ({ checkId, kind: 'static', command: 'node --test', cwd: '.', timeoutMs: 60_000, taskIds: 'all' });
const setupWith = (checks: RegisteredCommandCheck[]): InitialPlanningSetupV2 => ({
  architecture: { baselineId: 'r14-baseline', description: 'R-14 governance', constraints: [],
    catalog: { requireDag: true, dependencies: [], modules: [] } },
  completionPolicy: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 },
  checks,
});

describe('R-14: the first planning answer is set up through initialization/adopt (memory)', () => {
  it('adopts the plan card end to end, plans the other card on the ordinary path and guards the checks', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const second = await configureS6B3SecondWorkspace(world, { name: 'r14', goals: 2 });
      const scope = second.scope;
      const route = async (suffix: string, input: unknown) => (await world.host.post(suffix, plain(scope, input))).body;
      const adoptRoute = (commandId: string, source: InitializationSourceV1, text: string, goal: { ref: GoalRef; revision: number }) =>
        route('initialization/adopt', { commandId, source, expectedAnswerDigest: sha256Hex(text), expectedGoal: goal });
      const plans = async (goal: GoalRef) => ((await route('plans/versions', { goalId: goal.goalId, limit: 50, cursor: null })) as
        { value: { items: { revision: number }[] } }).value.items.map(item => item.revision);
      const installed = async () => await world.host.platform.confirmInstalledChecks(world.host.humanContext(), { scope });

      // A no-goal answer with two cards; its plan and its setup belong to card 0. The person confirms both cards.
      const held = await holdS6B3DraftAnswer(world, { scope, label: 'r14', drafts: 2, setup: setupWith([check('r14-a')]) });
      const answer = await releaseS6B3DraftAnswer(world, held);
      const goals: GoalRef[] = [];
      for (const index of [0, 1]) {
        const confirmed = await route('goals/confirm-draft', { commandId: `r14-confirm-${String(index)}`, round: held.round, index });
        goals.push((confirmed as { value: GoalConfirmDraftReceiptV1 }).value.goal.ref);
      }
      const [goalA, goalB] = goals as [GoalRef, GoalRef];
      // Two goal requests answered while the governance is still missing: one with no setup, one with other checks.
      const [goalC, goalD] = second.goals as [GoalSnapshot, GoalSnapshot];
      const noSetup = await releaseS6B3DraftAnswer(world, await holdS6B3PreparedGoalAnswer(world, { scope, goal: goalC.ref }));
      const other = await releaseS6B3DraftAnswer(world, await holdS6B3PreparedGoalAnswer(world,
        { scope, goal: goalD.ref, setup: setupWith([check('r14-d')]) }));
      const binding =(draftIndex: number): InitializationSourceV1 => ({ kind: 'binding', answerRef: answer.answerRef, draftIndex });
      // Card 1's binding is not the plan's card: the adoption stops `invalid` at the proposal and adopts no plan.
      expect(await adoptRoute('r14-card-1', binding(1), answer.answerText, { ref: goalB, revision: 1 })).toMatchObject({
        status: 'pending', stage: 'propose', failure: { code: 'invalid', reason: "the answer's plan is not for this draft" } });
      // Card 0: binding → propose → adopt in one call; the Goal now runs the adopted plan with the setup's checks,
      // and the adopted Goal's collaboration driver starts.
      expect(await adoptRoute('r14-card-0', binding(0), answer.answerText, { ref: goalA, revision: 1 }))
        .toMatchObject({ status: 'committed', replayed: false });
      expect([await plans(goalA), await plans(goalB)]).toEqual([[1], []]);
      const afterSetup = await installed();
      expect(afterSetup).toMatchObject({ status: 'ready', value: { checks: [check('r14-a')] } });
      // Card 1's Goal is planned on the ordinary path: its own planning round gives its own question card.
      await runS6B3PlanningQuery(world, { scope, goalRef: goalB, label: 'r14-card-1' });
      expect(await readS6B3DecisionQuestionKeys(world, { scope, goals: [goalB] })).toHaveLength(1);

      // The answer with no setup, the governance now complete: adopted, and the checks stay as they were.
      expect(await adoptRoute('r14-no-setup', { kind: 'prepared_goal', answerRef: noSetup.answerRef }, noSetup.answerText,
        { ref: goalC.ref, revision: goalC.revision })).toMatchObject({ status: 'committed' });
      expect(await installed()).toEqual(afterSetup);

      // The other answer's setup brings other checks; a direct approval replaces them after the checks stage, so the
      // final adopt stops with a conflict and no plan is adopted.
      const source: InitializationSourceV1 = { kind: 'prepared_goal', answerRef: other.answerRef };
      const expectedGoal = { ref: goalD.ref, revision: goalD.revision };
      const operationRef: InitializationAdoptionRef = { aggregateType: 'InitializationAdoption', projectId: scope.projectId,
        operationId: initializationAdoptionOperationId({ ...scope, source, expectedGoal }) };
      const gate = holdS6B3AdoptionGate(world, { operationRef, stage: 'checks', point: 'after-after' }, async () => {
        expect(await world.host.settings('checks/approve', { scope, answerRef: answer.answerRef, checks: [check('r14-a')] }))
          .toMatchObject({ status: 'ready' });
      });
      const [, stopped] = await Promise.all([gate, adoptRoute('r14-replaced', source, other.answerText, expectedGoal)]);
      expect(stopped).toMatchObject({ status: 'pending', stage: 'apply', failure: { code: 'revision_conflict' },
        completedSteps: ['admission', 'freeze', 'architecture', 'policy_install', 'policy_activate', 'checks', 'propose'] });
      expect(await plans(goalD.ref)).toEqual([]);
    } finally {
      await world.close();
    }
  });
});
