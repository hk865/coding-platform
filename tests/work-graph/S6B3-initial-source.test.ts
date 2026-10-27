/** Row 31 (deferred to L): a real no-goal answer's confirmations give a binding, both propose entries carry it, and the
 * adopt side re-checks the source, the Goal revision and the pins; `goals/confirm-draft` is unpublished, so the last statement is its named error. */
import { describe, expect, it } from 'vitest';
import type { AdoptionGovernancePinsV1 } from '../../src/contracts/initialization-adoption.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { InitializationSourceV1, InitialPlanOriginSourceV1 } from '../../src/contracts/initial-planning.js';
import type { InitializationBindingV1 } from '../../src/contracts/initialization-binding.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  InitialPlanAnswerFacts, QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef,
} from '../../src/contracts/query-job.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { VersionListPageV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { activatePolicy } from '../helpers/S8B-catalog-steps.js';
import {
  callS6B3LateRoute, holdS6B3DraftAnswer, holdS6B3PreparedGoalAnswer, openS6B3World, readS6B3BindingPort,
  releaseS6B3DraftAnswer,
} from '../helpers/S6B3-fixture.js';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The `value` of a route answer with `status`; any other answer throws with what the platform said. */
function valueOf<T>(body: unknown, status: 'ready' | 'committed', what: string): T {
  const answer = asRecord(body);
  if (answer['status'] !== status) throw new Error(`row 31: ${what} is not ${status}: ${JSON.stringify(body)}`);
  return answer['value'] as T;
}

describe('row 31 (deferred to L: the source-aware initial plan end to end)', () => {
  it('runs the plan service business case once goals/confirm-draft is published', async () => {
    const exercise = async () => {
      const world = await openS6B3World({ backend: 'memory' });
      try {
        const scope = world.mainScope;
        const ctx = world.host.humanContext();
        const workspace = s6aCardsWorkspace(world.host, scope);
        const plans = world.host.platform.plans;
        const factsOf = plans.readInitialPlanAnswerFacts;
        const proposeFromAnswer = plans.proposeInitialPlanFromAnswer;
        if (factsOf === undefined || proposeFromAnswer === undefined) {
          throw new Error('row 31: the plan owner does not publish its source-aware readers');
        }

        const held = await holdS6B3DraftAnswer(world, { scope, label: 'source-row31', drafts: 2 });
        const released = await releaseS6B3DraftAnswer(world, held);
        const answerRef = released.answerRef;
        expect(released.drafts.map(draft => draft.index)).toEqual([0, 1]);

        const confirmDraft = async (index: number): Promise<GoalConfirmDraftReceiptV1> => valueOf<GoalConfirmDraftReceiptV1>(
          await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
            plain(scope, { commandId: `row31-confirm-${String(index)}`, round: held.round, index })),
          'committed', `draft ${String(index)} confirmation`);
        const draft0 = await confirmDraft(0);
        const goal0 = draft0.goal.ref;
        expect(draft0.binding.draftIndex).toBe(0);
        expect(draft0.binding.goalRef).toEqual(goal0);
        expect(draft0.binding.goalRevision).toBe(1);
        const bindingPort = readS6B3BindingPort(world);
        const binding0 = valueOf<InitializationBindingV1>(await bindingPort.readBindingByAnswerDraft(ctx, { answerRef, draftIndex: 0 }), 'ready',
          'the binding by answer and draft');
        expect(binding0.ref).toEqual(draft0.binding.ref);
        expect(binding0.goalRef).toEqual(goal0);
        expect(binding0.answerRef).toEqual(answerRef);
        expect(binding0.revision).toBe(1);
        const source0: InitializationSourceV1 = { kind: 'binding', answerRef, draftIndex: 0 };
        const facts0 = valueOf<InitialPlanAnswerFacts>(await factsOf(ctx, answerRef, source0), 'ready', 'the binding source facts');
        expect(facts0.resolution).toEqual({ kind: 'binding', source: source0, bindingRef: binding0.ref,
          goal: goal0, goalRevision: 1 });

        // ---- Step 6: a real goal request's prepared_goal answer, frozen at the Goal's revision 1. ----
        const goalBRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'row31-prepared-goal' };
        await workspace.createGoal(goalBRef.goalId, 'Adopt one source-aware initial plan');
        const heldB = await holdS6B3PreparedGoalAnswer(world, { scope, goal: goalBRef });
        const releasedB = await releaseS6B3DraftAnswer(world, heldB);
        const preparedAnswerRef = releasedB.answerRef;
        const sourceB: InitializationSourceV1 = { kind: 'prepared_goal', answerRef: preparedAnswerRef };
        const factsB = valueOf<InitialPlanAnswerFacts>(await factsOf(ctx, preparedAnswerRef, sourceB), 'ready', 'the prepared_goal source facts');
        expect(factsB.resolution).toEqual({ kind: 'prepared_goal', source: sourceB, bindingRef: null,
          goal: goalBRef, goalRevision: 1 });

        // ---- The public governance prerequisite: read the current pointers, install only what is missing. ----
        await world.host.settleDetached();
        const registration = async () => valueOf<{ project: { revision: number }; workspace: { revision: number } }>(
          await workspace.route('workspaces/registration', scope), 'ready', 'the workspace registration');
        const scopePins = async (): Promise<VersionPin[]> => {
          const pins = await registration();
          return [{ ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: pins.project.revision },
            { ref: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
              revision: pins.workspace.revision }];
        };
        const projectPin = async (): Promise<VersionPin> => ({
          ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: (await registration()).project.revision });
        const readPins = async (): Promise<AdoptionGovernancePinsV1> => {
          const architecture = valueOf<{ baseline: { ref: AdoptionGovernancePinsV1['architecture']['ref'];
            revision: number; contentDigest: string } }>(
            await workspace.route('architecture/read', { selection: { kind: 'current' } }), 'ready', 'the architecture read');
          const policy = valueOf<{ policy: { ref: AdoptionGovernancePinsV1['policy']['ref'];
            revision: number; contentDigest: string } }>(
            await workspace.route('completion-policies/read', { projectId: scope.projectId }), 'ready', 'the policy read');
          return {
            architecture: { ref: architecture.baseline.ref, revision: architecture.baseline.revision,
              digest: architecture.baseline.contentDigest },
            policy: { ref: policy.policy.ref, revision: policy.policy.revision, digest: policy.policy.contentDigest },
          };
        };
        const policyContent = { schemaVersion: 1 as const, requirementKinds: ['static'],
          minimumRequiredRequirementsPerObligation: 1 };
        const architectureRead = await workspace.route('architecture/read', { selection: { kind: 'current' } });
        if (asRecord(architectureRead)['status'] === 'not_found') {
          const catalog = { requireDag: true, dependencies: [], modules: [{
            ref: { projectId: scope.projectId, moduleId: 'row31-core' }, name: 'Row 31 core',
            responsibility: 'The source-aware initial plan', paths: ['src'], interfaces: [],
          }] };
          valueOf(await workspace.post('architecture/adopt-initial', graphWrite(scope, {
            baselineId: 'row31-baseline', description: 'Row 31 governance', constraints: [], catalog,
          }, 'row31-architecture', await scopePins())), 'committed', 'the architecture adoption');
          await world.host.settleDetached();
        }
        const policyRead = await workspace.route('completion-policies/read', { projectId: scope.projectId });
        // The policy owner answers a project with no active pointer with its explicit `not_found` rejection.
        if (asRecord(policyRead)['code'] === 'not_found') {
          await activatePolicy(world.host.platform, ctx, policyContent, 'row31-policy');
        }
        const pins = await readPins();
        expect(pins.architecture.revision).toBe(1);
        expect(pins.policy.revision).toBe(1);
        expect(pins.architecture.ref.baselineId.length).toBeGreaterThan(0);
        expect(pins.policy.ref.policyId.length).toBeGreaterThan(0);
        expect(pins.architecture.digest.length).toBeGreaterThan(0);
        expect(pins.policy.digest.length).toBeGreaterThan(0);

        const queryRefOf = (answer: QueryJobAnswerRef): QueryJobRef => ({ aggregateType: 'QueryJob',
          projectId: answer.projectId, workspaceId: answer.workspaceId, queryJobId: answer.queryJobId });
        const queryBefore = valueOf<QueryJobRecord>(await workspace.route('queries/read', queryRefOf(preparedAnswerRef)), 'ready',
          'the prepared Query read');
        const answerBefore = valueOf<QueryJobAnswerSnapshot>(await workspace.route('queries/answer', preparedAnswerRef), 'ready',
          'the prepared answer read');
        const bundleBefore = queryBefore.run.run.executionState?.prepared?.bundleRef;
        if (bundleBefore === undefined) throw new Error('row 31: the prepared Query carries no frozen bundle');
        const manifestBefore = valueOf<{ body: string }>(await workspace.route('materials/open',
          { ref: bundleBefore, usage: 'historical_explanation' }), 'ready', 'the frozen manifest').body;

        const assertCandidate = (proposal: PlanProposal, expected: {
          goalRef: GoalRef; summary: string; source: InitialPlanOriginSourceV1;
        }) => {
          expect(proposal).toMatchObject({ kind: 'candidate_v2', revision: 1, schemaVersion: 2, status: 'candidate',
            goalRef: expected.goalRef, basedOn: null });
          expect(proposal.requestRef ?? null).toBeNull();
          if (proposal.kind !== 'candidate_v2') throw new Error('row 31: the owner did not return a v2 candidate');
          expect(proposal.draft.goalId).toBe(expected.goalRef.goalId);
          expect(proposal.draft.origin?.goalRevision).toBe(1);
          expect(proposal.draft.origin?.summary).toBe(expected.summary);
          expect(proposal.draft.origin?.source).toEqual(expected.source);
        };
        const reason = { text: 'row 31 source proposal', sources: [] };
        const sourceRequest = (requestId: string, source: InitializationSourceV1) => ({
          meta: { requestId, expected: [] as VersionPin[] },
          input: { source, reason, requestRef: null, basedOn: null },
        });
        const bindingProposal = await plans.proposePlan(ctx, sourceRequest('row31-propose-binding', source0));
        expect(bindingProposal).toMatchObject({ status: 'committed', replayed: false });
        const bindingCandidate = valueOf<PlanProposal>(bindingProposal, 'committed', 'the binding source proposal');
        assertCandidate(bindingCandidate, { goalRef: goal0, summary: 'S6B3 source-row31 coordination',
          source: { kind: 'binding', selector: source0, bindingRef: binding0.ref } });
        const answerProposal = await proposeFromAnswer(ctx, {
          meta: { requestId: 'row31-answer-propose', expected: [] as VersionPin[] },
          input: { answerRef, reason, source: source0 },
        });
        expect(answerProposal).toMatchObject({ status: 'committed', replayed: false });
        const answerCandidate = valueOf<PlanProposal>(answerProposal, 'committed', 'the source-aware initial-answer proposal');
        assertCandidate(answerCandidate, { goalRef: goal0, summary: 'S6B3 source-row31 coordination',
          source: { kind: 'binding', selector: source0, bindingRef: binding0.ref } });
        const preparedProposal = await plans.proposePlan(ctx, sourceRequest('row31-propose-prepared', sourceB));
        expect(preparedProposal).toMatchObject({ status: 'committed', replayed: false });
        const preparedCandidate = valueOf<PlanProposal>(preparedProposal, 'committed', 'the prepared_goal source proposal');
        assertCandidate(preparedCandidate, { goalRef: goalBRef,
          summary: 'S6B3 row31-prepared-goal prepared goal', source: { kind: 'prepared_goal', selector: sourceB } });
        const preparedAnswerProposal = await proposeFromAnswer(ctx, {
          meta: { requestId: 'row31-answer-prepared', expected: [] as VersionPin[] },
          input: { answerRef: preparedAnswerRef, reason, source: sourceB },
        });
        expect(preparedAnswerProposal).toMatchObject({ status: 'committed', replayed: false });
        assertCandidate(valueOf<PlanProposal>(preparedAnswerProposal, 'committed', 'the prepared_goal initial-answer proposal'),
          { goalRef: goalBRef, summary: 'S6B3 row31-prepared-goal prepared goal',
            source: { kind: 'prepared_goal', selector: sourceB } });

        const bindingRequest = sourceRequest('row31-propose-binding', source0);
        expect(await plans.proposePlan(ctx, bindingRequest))
          .toMatchObject({ status: 'committed', replayed: true, value: bindingCandidate });
        expect(await plans.proposePlan(ctx, sourceRequest('row31-propose-binding', sourceB)))
          .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
        expect(await proposeFromAnswer(ctx, {
          meta: { requestId: 'row31-answer-propose', expected: [] as VersionPin[] },
          input: { answerRef, reason, source: source0 },
        })).toMatchObject({ status: 'committed', replayed: true, value: answerCandidate });
        expect(await proposeFromAnswer(ctx, {
          meta: { requestId: 'row31-answer-propose', expected: [] as VersionPin[] },
          input: { answerRef: preparedAnswerRef, reason, source: sourceB },
        })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
        expect(await plans.proposePlan(ctx, sourceRequest('row31-propose-prepared', sourceB)))
          .toMatchObject({ status: 'committed', replayed: true, value: preparedCandidate });

        // ---- Step 5's route again: the real draft 1 confirmation, then its selector against the draft-0 plan. ----
        const draft1 = await confirmDraft(1);
        expect(draft1.binding.draftIndex).toBe(1);
        expect(draft1.goal.ref).not.toEqual(goal0);
        const source1: InitializationSourceV1 = { kind: 'binding', answerRef, draftIndex: 1 };
        expect(await plans.proposePlan(ctx, sourceRequest('row31-propose-draft1', source1)))
          .toEqual({ status: 'rejected', code: 'invalid', reason: "the answer's plan is not for this draft" });
        // A binding that does not exist for this answer draft is stale, never a second answer's facts.
        const sourceMissing: InitializationSourceV1 = { kind: 'binding', answerRef, draftIndex: 2 };
        expect(await plans.proposePlan(ctx, sourceRequest('row31-propose-stale', sourceMissing)))
          .toMatchObject({ status: 'rejected', code: 'source_stale' });
        // A selector that does not name the requested answer is stale at the formal read itself.
        expect(await factsOf(ctx, answerRef, { kind: 'prepared_goal',
          answerRef: { ...answerRef, answerId: 'row31-other-answer' } }))
          .toMatchObject({ status: 'rejected', code: 'source_stale' });
        const planVersions = async (goal: GoalRef): Promise<VersionListPageV1> => valueOf(
          await workspace.route('plans/versions', { goalId: goal.goalId, limit: 50, cursor: null }), 'ready',
          `the Plan history of ${goal.goalId}`);
        const apply = (input: { requestId: string; proposal: PlanProposal;
          governancePins: AdoptionGovernancePinsV1; expected: VersionPin[] }) =>
          plans.applyPlanChange(ctx, { meta: { requestId: input.requestId, expected: input.expected },
            input: { proposalRef: input.proposal.ref, expectedProposalRevision: input.proposal.revision,
              decisionRefs: [], governancePins: input.governancePins } });
        expect((await planVersions(goal0)).items).toEqual([]);

        // ---- The pins must still be the governance read NOW: ref, record revision or digest drift is a conflict. ----
        // The Goal is still at revision 1 here, so the only conflict these rows can see is the pin drift.
        const driftRows: { key: string; pins: AdoptionGovernancePinsV1; reason: string }[] = [
          { key: 'ref', reason: 'the architecture governance moved since the adoption captured its pin',
            pins: { ...pins, architecture: { ...pins.architecture,
              ref: { ...pins.architecture.ref, revision: pins.architecture.ref.revision + 1 } } } },
          { key: 'record-revision', reason: 'the policy governance moved since the adoption captured its pin',
            pins: { ...pins, policy: { ...pins.policy, revision: pins.policy.revision + 1 } } },
          { key: 'digest', reason: 'the policy governance moved since the adoption captured its pin',
            pins: { ...pins, policy: { ...pins.policy, digest: 'row31-different-digest' } } },
        ];
        for (const row of driftRows) {
          expect(await apply({ requestId: `row31-apply-drift-${row.key}`, proposal: bindingCandidate,
            governancePins: row.pins, expected: [{ ref: goal0, revision: 1 }] }))
            .toMatchObject({ status: 'rejected', code: 'revision_conflict', reason: row.reason });
          // No PlanRevision was written and the newer governance was never adopted.
          expect((await planVersions(goal0)).items).toEqual([]);
          expect(await readPins()).toEqual(pins);
        }
        // A pin without its content digest is refused before any proposal or governance read.
        const malformed = { architecture: { ref: pins.architecture.ref, revision: pins.architecture.revision },
          policy: pins.policy } as unknown as AdoptionGovernancePinsV1;
        expect(await apply({ requestId: 'row31-apply-malformed', proposal: bindingCandidate,
          governancePins: malformed, expected: [{ ref: goal0, revision: 1 }] }))
          .toMatchObject({ status: 'rejected', code: 'invalid' });

        // ---- The Goal moves: a new source is a revision conflict; the original receipt still restores. ----
        expect((await world.host.post('goals/control', graphWrite(scope, {
          goalRef: goal0, control: 'pause', reason: 'Move the Goal past its frozen source',
        }, 'row31-goal-move', [{ ref: goal0, revision: 1 }, { ref: { aggregateType: 'GoalPhase',
          projectId: scope.projectId, goalId: goal0.goalId }, revision: 0 }]))).body)
          .toMatchObject({ status: 'committed' });
        expect(await plans.queryGoal(ctx, goal0)).toMatchObject({ status: 'ready',
          value: { goal: { revision: 2, desiredState: 'paused' } } });
        expect(await plans.proposePlan(ctx, bindingRequest))
          .toMatchObject({ status: 'committed', replayed: true, value: bindingCandidate });
        expect(await proposeFromAnswer(ctx, {
          meta: { requestId: 'row31-answer-moved', expected: [] as VersionPin[] },
          input: { answerRef, reason, source: source0 },
        })).toMatchObject({ status: 'rejected', code: 'revision_conflict' });

        // The adopt re-check: a source frozen at revision 1 cannot be adopted onto revision 2.
        expect(await apply({ requestId: 'row31-apply-binding-moved', proposal: bindingCandidate,
          governancePins: pins, expected: [{ ref: goal0, revision: 2 }] }))
          .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
        expect((await planVersions(goal0)).items).toEqual([]);
        const adoptionRequest = { requestId: 'row31-apply-prepared', proposal: preparedCandidate,
          governancePins: pins, expected: [{ ref: goalBRef, revision: 1 }] };
        const adopted = await apply(adoptionRequest);
        expect(adopted).toMatchObject({ status: 'committed', replayed: false });
        const adoptedPlan = valueOf<PlanRevisionSnapshot>(adopted, 'committed', 'the prepared_goal adoption');
        expect(adoptedPlan).toMatchObject({ schemaVersion: 2, revision: 1, planRevision: 1,
          goalRef: goalBRef, planId: preparedCandidate.draft.planId });
        expect(adoptedPlan.origin?.source).toEqual({ kind: 'prepared_goal', selector: sourceB });
        expect(adoptedPlan.origin?.goalRevision).toBe(1);
        expect(adoptedPlan.effectiveArchitectureBaseline).toEqual({ ref: pins.architecture.ref,
          digest: pins.architecture.digest });
        expect(adoptedPlan.effectiveCompletionPolicy).toEqual({ ref: pins.policy.ref, digest: pins.policy.digest });
        const history = await planVersions(goalBRef);
        expect(history.items.map(item => item.revision)).toEqual([1]);
        expect(history.items[0]?.reason).toBe(reason.text);
        expect(history.complete).toBe(true);

        expect(await apply(adoptionRequest))
          .toMatchObject({ status: 'committed', replayed: true, value: adoptedPlan });
        expect((await planVersions(goalBRef)).items.map(item => item.revision)).toEqual([1]);

        // ---- The receipt precedes the comparison: move the governance, then replay the original request. ----
        const nextPolicyRevision = pins.policy.ref.revision + 1;
        const installed2 = valueOf<{ ref: AdoptionGovernancePinsV1['policy']['ref']; contentDigest: string }>(
          await workspace.post('completion-policies/install', graphWrite(scope, {
            policyId: pins.policy.ref.policyId, contentRevision: nextPolicyRevision,
            content: { ...policyContent, minimumRequiredRequirementsPerObligation: 2 },
          }, 'row31-policy-install-2', [await projectPin(),
            { ref: { ...pins.policy.ref, revision: nextPolicyRevision }, revision: 0 }])),
          'committed', 'the second policy install');
        const activeBefore = valueOf<{ active: { revision: number } }>(await workspace.route('completion-policies/read',
          { projectId: scope.projectId }), 'ready', 'the active policy read');
        valueOf(await workspace.post('completion-policies/activate', graphWrite(scope, {
          target: { ref: installed2.ref, digest: installed2.contentDigest },
        }, 'row31-policy-activate-2', [await projectPin(),
          { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId },
            revision: activeBefore.active.revision }])), 'committed', 'the second policy activation');
        const movedPins = await readPins();
        expect(movedPins.architecture).toEqual(pins.architecture);
        expect(movedPins.policy.digest).not.toBe(pins.policy.digest);
        expect(await apply(adoptionRequest))
          .toMatchObject({ status: 'committed', replayed: true, value: adoptedPlan });

        // A different selector under the same request identity is an idempotency conflict, not a second adoption.
        expect(await apply({ requestId: adoptionRequest.requestId, proposal: bindingCandidate,
          governancePins: pins, expected: [{ ref: goalBRef, revision: 1 }] }))
          .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
        expect((await planVersions(goalBRef)).items.map(item => item.revision)).toEqual([1]);

        // ---- The original Job, answer and manifest were not written back. ----
        expect(valueOf(await factsOf(ctx, answerRef, source0), 'ready', 'the binding source facts again')).toEqual(facts0);
        expect(valueOf(await factsOf(ctx, preparedAnswerRef, sourceB), 'ready', 'the prepared_goal facts again')).toEqual(factsB);
        expect(valueOf(await workspace.route('queries/read', queryRefOf(preparedAnswerRef)), 'ready',
          'the prepared Query read again')).toEqual(queryBefore);
        expect(valueOf(await workspace.route('queries/answer', preparedAnswerRef), 'ready',
          'the prepared answer read again')).toEqual(answerBefore);
        expect(valueOf<{ body: string }>(await workspace.route('materials/open',
          { ref: bundleBefore, usage: 'historical_explanation' }), 'ready', 'the frozen manifest again').body)
          .toBe(manifestBefore);
      } finally {
        await world.close();
      }
    };
    await exercise();
  });
});
