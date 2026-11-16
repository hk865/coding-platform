/**
 * GP-3 (lead 11-16 `gpt-brief.md` row GP-3; `docs/MVP-BEHAVIOR.md:174`, `:217`, `:318`): a change of requirement on an
 * `every_step` Goal, in one `it`, from the person's request to the person's adoption.
 *
 * World: G6F G3's (`G6F-new-goal-plan-round.test.ts`): the S6A Host world with its request driver, the project
 * initialized (`initializeProject`), plus the Host's echo check for every Task (`checkConfiguration`, Host input as in
 * the S9 world). Before the request (public steps): goal 1's plan is adopted through `plans/propose` + `plans/apply`
 * with two work Tasks — `gp3-keep` (unrelated to the change) and `gp3-change` (the part the person changes) — and the
 * Goal gate; the Goal is set to `every_step`; `gp3-keep` runs to `satisfied` on its line (`workflow/advance`). The
 * flow: `requests/submit` on goal 1 → the secretary answers with three ideas → `requests/select-idea` → the plan round's
 * `submit_plan_round` (cancel `gp3-change`, add `gp3-change-2` with its own obligation) → `plans/request-candidate`
 * reads the candidate → the person's `plans/apply`. End products: ① the receipt commits and the Goal points at the
 * new plan revision; ② `gp3-change` is cancelled and `gp3-change-2` is active; ③ `gp3-keep` keeps its phase, its one
 * Run and its round with the same evidence; ④ before the person's apply nothing was adopted. Memory only (rule S3).
 *
 * Green today (b9444921); the plan round's plan is a legal one, so G7P-2 does not touch it.
 * Mutation shown: the adoption writes a disposition-only Task with its source disposition, so the changed part is not
 * cancelled (`plan-commit-compiler.ts` `compileFuturePlanAdoption`) → red at ②.
 */
import { expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RoundSnapshot } from '../../src/contracts/verification.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { plToolPlanOf, adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { answeredRound, initializeProject, secretaryAnswer, threeIdeas } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, committed, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { waitFor } from './harness.js';

const work = (taskId: string, disposition: 'active' | 'cancelled' = 'active') => ({ taskId, title: `GP-3 ${taskId}`,
  requirementLevel: 'required' as const, taskKind: 'work' as const, disposition, phase: 'pending' as const,
  scope: { kind: 'goal' as const }, executionIntent: 'request_execution' as const });
const obligation = (taskIds: string[], id: string) => ({ obligationId: id, title: `GP-3 ${id}`,
  requirementLevel: 'required' as const, taskIds, verificationRequirements: [{ requirementId: `${id}-static`,
    requirementLevel: 'required' as const, kind: 'static', description: `GP-3 ${id} static check` }] });
const assignment = (taskId: string) => ({ taskId, role: S6A_WORK_ROLE.templateId, instruction: `GP-3 ${taskId}` });
const firstDraft = (goal: GoalRef): PlanRevisionDraft => ({
  schemaVersion: 2, planId: 'gp3-plan', planRevision: 1, goalId: goal.goalId, stages: [],
  tasks: [work('gp3-keep'), work('gp3-change'), { taskId: 'gp3-gate', title: 'GP-3 Goal gate', requirementLevel: 'required',
    taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [assignment('gp3-keep'), assignment('gp3-change')],
  obligations: [obligation(['gp3-keep', 'gp3-gate'], 'gp3-keep-ob'), obligation(['gp3-change', 'gp3-gate'], 'gp3-change-ob')],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] });
/** The plan round's segment: `gp3-change` closes by its disposition, `gp3-change-2` replaces it with its own acceptance. */
const changeSegment = (goal: GoalRef): PlanRevisionDraft => ({ ...firstDraft(goal),
  tasks: [work('gp3-change', 'cancelled'), work('gp3-change-2')], assignments: [assignment('gp3-change-2')],
  obligations: [obligation(['gp3-change-2'], 'gp3-change-2-ob')] });

type TaskRow = { ref: { projectId: string; goalId: string; taskId: string }; effectivePhase: string; disposition: string };

it('GP-3: every_step Goal, the person changes a requirement → ideas → plan round → candidate → the person adopts',
  async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on',
      checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
    try {
      await initializeProject(world);
      const main = s6aCardsWorkspace(world, S6A_SCOPE);
      const goal = world.goals.first;
      const read = async <T>(route: string, input: unknown): Promise<T> =>
        ready<T>(await world.post(route, plain(S6A_SCOPE, input)), route);
      const before = await adoptPLPlanDraft(main, goal, firstDraft(goal), 'gp3');
      await setS7AAutonomy(world, goal, 'every_step');
      const keep = { projectId: goal.projectId, goalId: goal.goalId, taskId: 'gp3-keep' };
      const keepLine = await sessionOf(world, await createS6BLine(main, { label: 'gp3-keep-line', role: S6A_WORK_ROLE,
        tasks: [keep] }));
      await world.scripted.script(keepLine, [{ kind: 'text', text: 'GP-3 keep work done' }]);
      expect((await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'gp3-keep',
        sessionHint: keepLine.ref, kind: 'select_work', taskId: 'gp3-keep' })).at(-1)?.state).toBe('completed');
      const keepFacts = async (planRef: unknown) => ({
        runs: (await read<{ items: { run: { ref: RunRef } }[] }>('executions/list', { goalRef: goal, taskId: 'gp3-keep',
          page: { afterCursor: null, limit: 5 } })).items.map(item => item.run.ref),
        rounds: (await read<{ items: { round: RoundSnapshot }[] }>('graph/look', { goalRef: goal, target: { kind: 'node',
          node: { kind: 'task', ref: keep, planRef } }, relation: 'checks', page: { afterCursor: null, limit: 10 } }))
          .items.map(item => ({ ref: item.round.ref, outcome: item.round.outcome, evidenceRefs: item.round.evidenceRefs })),
      });
      const keepBefore = await keepFacts(before.ref);
      expect(keepBefore.runs).toHaveLength(1);
      expect(keepBefore.rounds).toEqual([expect.objectContaining({ outcome: 'PASS' })]);

      // The person's change request on goal 1; the secretary offers ideas, the person picks one, the plan round plans.
      const secretary = await world.createSecretary('gp3');
      const asked = await answeredRound(world, { session: secretary, answer: secretaryAnswer({ body: 'GP-3 ideas',
        ideas: threeIdeas('gp3') }), submit: { commandId: 'gp3-request', goalId: goal.goalId,
        text: 'GP-3: replace the second part with a new one', continues: null, recipient: secretary } });
      await world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: 'gp3-plan', name: 'submit_plan_round',
        args: { answerKind: 'plan', summary: 'GP-3 replace the second part', plan: plToolPlanOf(changeSegment(goal)) } }] }]);
      const selected = await world.selectIdea({ commandId: 'gp3-select', round: asked.round, index: 0 });
      if (selected.status !== 'queued') throw new Error(`GP-3: the selection was refused: ${JSON.stringify(selected)}`);
      await world.waitForRequest(asked.requestRoot, view => view.rounds.some(round =>
        round.ref.queryJobId === selected.followupRound.queryJobId && round.status === 'ended'), 'GP-3: the plan round');
      const head = (await waitFor(async () => read<{ head: PlanProposal | null }>('plans/request-candidate',
        { goalRef: goal, requestRef: asked.requestRoot }), value => value.head !== null, 'GP-3: the candidate')).head!;

      // ④ every_step: the candidate waits for the person; the Goal still points at the first plan.
      expect(head).toMatchObject({ status: 'candidate', goalRef: goal, requestRef: asked.requestRoot, basedOn: before.ref });
      const goalBefore = (await read<{ goal: { revision: number; activePlanRevision: unknown } }>('goals/read', goal)).goal;
      expect(goalBefore.activePlanRevision).toEqual(before.ref);

      // ① The person adopts: the receipt commits and the Goal points at revision 2.
      const adopted = committed<{ planRevision: number }>(await world.post('plans/apply', graphWrite(S6A_SCOPE, {
        proposalRef: head.ref, expectedProposalRevision: head.revision, decisionRefs: [] }, 'gp3-apply',
      [{ ref: goal, revision: goalBefore.revision }])), 'GP-3: the adoption');
      expect(adopted.planRevision).toBe(2);
      const planRef = (await read<{ goal: { activePlanRevision: unknown } }>('goals/read', goal)).goal.activePlanRevision;
      const graph = await read<{ plan: { ref: unknown; planRevision: number }; tasks: TaskRow[] }>('tasks/query', { goalRef: goal });
      expect(graph.plan).toMatchObject({ ref: planRef, planRevision: 2 });

      // ② The changed part switched; ③ the unrelated part is as it was, with its Run and evidence.
      expect(graph.tasks.map(task => [task.ref.taskId, task.disposition, task.effectivePhase])).toEqual([
        ['gp3-keep', 'active', 'satisfied'], ['gp3-change', 'cancelled', 'pending'], ['gp3-gate', 'active', 'pending'],
        ['gp3-change-2', 'active', 'pending']]);
      expect(await keepFacts(planRef)).toEqual(keepBefore);
    } finally {
      await world.close();
    }
  }, 180_000);
