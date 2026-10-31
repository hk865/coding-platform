import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { QueryJobIntentV1 } from '../../contracts/query-job.js';
import { interventionPlanningQueryRefs } from '../../contracts/query-job.js';
import { parseInitialPlanningResponseV2 } from '../../contracts/initial-planning-parse.js';
import type { PlanProposalRef, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import { plainSessionRefToAggregate } from '../../core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../../core/work-graph/sessions/message-record-codecs.js';
import { decisionActionPolicy } from '../../core/work-graph/state/decision-policy.js';
import { normalizeInitialPlanningResponseV2 } from '../../core/work-graph/tasks/initial-plan.js';
import { planProposalIdFor } from '../../core/work-graph/tasks/plan-service.js';
import { asRejection } from './consultation.js';
import { createQueryStageDriver, queryRunEndedWithoutAnswer } from './query-stage-driver.js';
import type { HandleInterventionResultV1, InterventionInput, WorkflowDependencies } from './ports.js';
import { automationContext, ownContext, type Base, type Owned } from './workflow.js';

/** The plan-change reason the intervention's proposal records (the answer it came from is its source). */
const INTERVENTION_PLAN_REASON = 'an intervention on the line asks for the next plan';

export type InterventionDependencies = {
  /** createWorkflow's own deps object, by reference, never spread (the task-gate rule, book `:258`). */
  workflow: Pick<WorkflowDependencies,
    'consultations' | 'plans' | 'requestIntake' | 'runtime' | 'sessions' | 'sessionFacts'>;
  /** The one ordinary claim builder, passed by createWorkflow (`buildClaimOperation`, workflow.ts:1041). */
  claimIntervention(owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow, session: SessionCard, messageRef: SessionMessageRef):
    Promise<{ claim: TaskClaim } | CoreRejection>;
};
export type InterventionHandler = {
  handleIntervention(ctx: CoreCallContext, input: InterventionInput): Promise<HandleInterventionResultV1>;
};
export function createInterventionHandler(deps: InterventionDependencies): InterventionHandler {
  const { consultations, plans, runtime, sessions, sessionFacts } = deps.workflow;
  return {
    async handleIntervention(ctx, input) {
      const owned = ownContext(ctx);
      if ('rejection' in owned) return owned.rejection;
      if (consultations === undefined || sessionFacts === undefined || plans.queryGoalDisplay === undefined) {
        return { status: 'rejected', code: 'unsupported',
          reason: 'the intervention handler needs the mailbox, the Session facts and the Goal display' };
      }
      // The consultation owner is the one QueryJobPort this Workflow composes; the top-level dependency bag has no
      // separate `queries` member on this tree.
      const mailbox = consultations.messages;
      const queryOwner = consultations.queries;
      const projects = consultations.projects;
      const read = await mailbox.readMessage(owned.ctx, input.messageRef);
      if (read.status !== 'ready') return asRejection(read, 'the intervention message');
      const message = read.value;
      if (message.ref.projectId !== owned.projectId || message.ref.workspaceId !== owned.workspaceId) {
        return { status: 'rejected', code: 'forbidden',
          reason: 'the intervention message is outside the bound project/workspace' };
      }
      if ('kind' in message.recipient) {
        return { status: 'rejected', code: 'unsupported', reason: 'a user-recipient message is not a line' };
      }
      // The source message is the Query's provenance; a withdrawn one is stale, never planned from.
      if (message.withdrawnAt !== null) {
        return { status: 'rejected', code: 'source_stale', reason: 'the intervention message is withdrawn' };
      }
      // The line is the recipient Session; the named Task wins over the line's newest Work Task. A message
      // without `taskRef` is allowed: its effective line is the Session below (book `:445`; 7b1rd-07). The
      // allowed sender is L's dispatch gate (person or `action_request`, SR9 L3); this handler does not restate it.
      const line = message.recipient;
      const facts = await sessionFacts.readSessionFacts(owned.ctx, line);
      if (facts.status !== 'ready') return asRejection(facts, 'the intervention line facts');
      const addressed = message.taskRef ?? facts.value.latestWork?.task ?? null;
      // The branch is decided by the FORMAL Goal phase, not by a Task row (a Task row is a separate projection):
      // read the Goal and the display before the graph, so a completed Goal never reaches the unfinished-task claim.
      const goalRef = addressed !== null
        ? { aggregateType: 'Goal' as const, projectId: addressed.projectId, goalId: addressed.goalId }
        : message.goalRef ?? null;
      const goalRead = goalRef === null ? null : await plans.queryGoal(owned.ctx, goalRef);
      if (goalRead !== null && goalRead.status !== 'ready') return asRejection(goalRead, 'the message Goal');
      const goal = goalRead === null ? null : goalRead.value.goal;
      const queryGoalDisplay = plans.queryGoalDisplay;
      const displayRead = goalRef === null ? null : await queryGoalDisplay(owned.ctx, { goalRef });
      if (displayRead !== null && displayRead.status !== 'ready') return asRejection(displayRead, 'the Goal display');
      const display = displayRead === null ? null : displayRead.value.display;
      // SMK3b (97-9; v3.4 B-01): a Host restart's pending GoalInterruption is resolved only when a person starts the
      // Goal driver (onStarted fires for a Goal-scoped start only, A/collaboration-driver.ts:1064). A Task-scoped
      // intervention start must not run under it, whoever sent the message (B-36); the message stays queued.
      if (display !== null && display.causes.some((cause) => 'interruption' in cause)) {
        return { status: 'rejected', code: 'busy',
          reason: 'a Host restart interrupted the Goal; a person continues it by starting the Goal' };
      }
      // COMPLETED is checked BEFORE any claim: a completed Goal's dead line starts a new goal-less request, never
      // a planning Query or a claim on an old Task.
      if (goal !== null && display !== null && display.phase === 'COMPLETED') {
        const body = await mailbox.readMessageBody(owned.ctx,
          { messageRef: input.messageRef, part: 'message' });
        if (body.status !== 'ready') return asRejection(body, 'the intervention message body');
        return requestNewGoal(owned, message, goal, body.value.text);
      }
      if (goal === null) return { status: 'queued', reason: 'no_task' };
      if (addressed !== null) {
        const graph = await plans.queryTaskGraph(owned.ctx, { goalRef: goal.ref });
        if (graph.status !== 'ready') return asRejection(graph, 'the Task graph');
        const task = graph.value.plan.tasks.find((candidate) => candidate.taskId === addressed.taskId);
        const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === addressed.taskId);
        // Unfinished = active and not satisfied; the open wait is deliberately not consulted (D-04).
        const unfinished = task !== undefined && row !== undefined && row.disposition === 'active'
          && row.effectivePhase !== 'satisfied';
        if (unfinished && task !== undefined && row !== undefined) {
          const card = await sessions.readSession(owned.ctx,
            { projectId: line.projectId, sessionId: line.sessionId });
          if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
          const base: Base = { goalRef: goal.ref, flowId: '', sessionHint: line,
            actor: owned.actor, taskId: addressed.taskId, failedCardRefs: [], releaseSkip: new Set<string>() };
          const claimed = await deps.claimIntervention(owned, base, goal, graph.value.plan,
            task, row, card.value, input.messageRef);
          if ('status' in claimed) return claimed;       // CoreRejection; its `status` is 'rejected'
          return { status: 'claimed', branch: 'existing_task', claim: claimed.claim };
        }
      }
      // A Goal that is neither active nor completed (paused/cancelled) has no planning branch.
      if (goal.desiredState !== 'active') return { status: 'queued', reason: 'no_task' };
      const body = await mailbox.readMessageBody(owned.ctx,
        { messageRef: input.messageRef, part: 'message' });
      if (body.status !== 'ready') return asRejection(body, 'the intervention message body');
      return planOnIdleLine(owned, input, message, goal, body.value.text);

      /** No unfinished task on a completed Goal: the separate internal command (book `:700`-`:706`). */
      async function requestNewGoal(owned: Owned, message: SessionMessage, goal: GoalSnapshot, text: string):
      Promise<HandleInterventionResultV1> {
        const intake = deps.workflow.requestIntake;
        if (intake === undefined) {
          return { status: 'queued', reason: 'no_task' };   // absent wiring behaves as today, never a rejection
        }
        const appended = await intake.submitInterventionGoal(automationContext(owned), {
          operationId: `intervention:${sessionMessageRefKey(message.ref)}:new_goal`,
          sourceMessageRef: { ...message.ref }, goalRef: { ...goal.ref }, text,
        });
        if (appended.status === 'rejected') return appended;
        return { status: 'requested', branch: 'goal_completed', requestRef: appended.round };
      }

      /** No task, active Goal: one read-only Query -> one proposal -> the policy's adoption (book `:672`-`:699`). */
      async function planOnIdleLine(owned: Owned, input: InterventionInput, message: SessionMessage,
        goal: GoalSnapshot, text: string): Promise<HandleInterventionResultV1> {
        const key = sessionMessageRefKey(message.ref);
        const refs = interventionPlanningQueryRefs(message.ref);
        const proposalRef: PlanProposalRef = {
          aggregateType: 'PlanProposal', projectId: owned.projectId, workspaceId: owned.workspaceId,
          proposalId: planProposalIdFor({ projectId: owned.projectId, workspaceId: owned.workspaceId,
            goalId: goal.ref.goalId, requestId: `intervention:${key}:propose` }),
        };
        // Stage 8: the deterministic Query. A re-run finds the pending pair and continues it.
        const existing = await queryOwner.readQueryJob(owned.ctx, refs.queryJobRef);
        if (existing.status !== 'ready' && existing.status !== 'not_found') {
          return asRejection(existing, 'the intervention planning Query');
        }
        if (existing.status === 'not_found') {
          const registration = await projects.readWorkspaceRegistration(owned.ctx,
            { projectId: owned.projectId, workspaceId: owned.workspaceId });
          if (registration.status !== 'ready') {
            return asRejection(registration, 'the Project/Workspace registration');
          }
          const intent: QueryJobIntentV1 = {
            schemaVersion: 1, intentId: refs.queryJobRef.queryJobId,
            projectId: owned.projectId, workspaceId: owned.workspaceId, goalId: goal.ref.goalId,
            question: text, focusTaskRefs: [], budget: input.budget, multiTurn: { maxRounds: 1 },
            correlationId: `intervention:${refs.queryRunRef.runId}`,
            execution: { kind: 'intervention_planning', sourceMessageRef: { ...message.ref },
              roleBinding: input.roleBinding, runtimeBudget: input.runtimeBudget },
          };
          const expected: VersionPin[] = [
            { ref: { aggregateType: 'Project', projectId: owned.projectId },
              revision: registration.value.project.revision },
            { ref: { aggregateType: 'Workspace', projectId: owned.projectId, workspaceId: owned.workspaceId },
              revision: registration.value.workspace.revision },
            { ref: goal.ref, revision: goal.revision },
            { ref: refs.queryJobRef, revision: 0 },
            { ref: refs.queryRunRef, revision: 0 },
          ];
          const submitted = await queryOwner.submitQueryJob(owned.ctx, {
            input: { queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId, intent },
            meta: { requestId: `intervention:${key}:query`, expected },
          });
          if (submitted.status !== 'committed') return submitted;
          return { status: 'progressed', branch: 'no_task', stage: 'query' };
        }
        let record = existing.value;
        if (record.job.job.status !== 'answered' && !queryRunEndedWithoutAnswer(record)) {
          const phase = record.run.run.executionState?.phase;
          if (phase === undefined) {
            // A plain Query is claimed by the caller that chose its line; one claim, then the driver drives it.
            const card = await sessions.readSession(owned.ctx,
              { projectId: line.projectId, sessionId: line.sessionId });
            if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
            const sessionAggregate = plainSessionRefToAggregate(line);
            const claimed = await queryOwner.claimQuery(owned.ctx, {
              input: { queryRunRef: record.run.ref,
                sessionRef: { projectId: line.projectId, sessionId: line.sessionId } },
              meta: { requestId: `intervention:${key}:query-claim`, expected: [
                { ref: record.job.ref, revision: record.job.revision },
                { ref: record.run.ref, revision: record.run.revision },
                { ref: sessionAggregate, revision: card.value.record.revision },
              ] },
            });
            if (claimed.status !== 'committed') return claimed;
            return { status: 'progressed', branch: 'no_task', stage: 'query' };
          }
          // The consultation's one-line rejecting `facts` stub: a plain Query never drives a request round.
          const stageDriver = createQueryStageDriver({
            queries: queryOwner, runtime,
            facts: { readFacts: async () =>
              rejected('unavailable', 'the intervention planning Query does not drive a request round') },
            consumerId: input.consumerId,
          });
          const advanced = await stageDriver.advance(owned.ctx, {
            queryJobRef: record.job.ref, expectedRunRef: record.run.ref, profile: null,
          });
          if (advanced.status === 'blocked') return { status: 'queued', reason: 'no_task' };
          if (advanced.status === 'progressed') return { status: 'progressed', branch: 'no_task', stage: 'query' };
          const current = await queryOwner.readQueryJob(owned.ctx, refs.queryJobRef);
          if (current.status !== 'ready') return asRejection(current, 'the intervention planning Query');
          record = current.value;
        }
        // Stage 9: the answer through the narrow intervention source.
        const answerRef = record.job.job.answerRefs.at(-1);
        if (answerRef === undefined) return { status: 'queued', reason: 'no_task' };
        const readFacts = plans.readInitialPlanAnswerFacts;
        if (readFacts === undefined) {
          return { status: 'rejected', code: 'unsupported',
            reason: 'the Plan owner does not publish readInitialPlanAnswerFacts' };
        }
        const facts = await readFacts.call(plans, owned.ctx, answerRef,
          { kind: 'intervention', messageRef: { ...message.ref } });
        if (facts.status !== 'ready') return asRejection(facts, 'the intervention planning answer');
        const parsed = parseInitialPlanningResponseV2(facts.value.answerText);
        if (parsed.status !== 'parsed') return parsed;
        const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts.value);
        if (normalized.status === 'rejected') return normalized;
        if (normalized.status === 'needs_decision') {
          return { status: 'needs_decision', branch: 'no_task', answerRef: { ...answerRef },
            questions: [...normalized.questions] };
        }
        // Stage 10: the proposal is read first; its receipt identity makes a re-run return the same candidate.
        const proposalRead = await plans.readPlanProposal(owned.ctx, proposalRef);
        if (proposalRead.status !== 'ready' && proposalRead.status !== 'not_found') {
          return asRejection(proposalRead, 'the intervention plan proposal');
        }
        if (proposalRead.status === 'not_found') {
          // A refinement is based on the active Plan, so its target revision is that source's +1; the initial-plan
          // normalizer fixes 1 for a first plan, and every other writer has no source.
          const targetPlanRevision = (facts.value.manifest.focusPlan?.revision ?? 0) + 1;
          // A refinement inherits the source Plan's origin (it may not replace it); a first plan keeps the
          // normalized model-coordination origin.
          const { origin: modelOrigin, ...refinementDraft } = normalized.draft;
          const draft = goal.activePlanRevision === null
            ? normalized.draft : { ...refinementDraft, planRevision: targetPlanRevision };
          const proposed = await plans.proposePlan(owned.ctx, {
            input: { goalRef: facts.value.resolution.goal, basedOn: goal.activePlanRevision,
              draft,
              reason: { text: INTERVENTION_PLAN_REASON, sources: [facts.value.answer.bodyRef] },
              requestRef: { ...refs.queryJobRef }, sourceMessageRef: { ...message.ref } },
            meta: { requestId: `intervention:${key}:propose`,
              expected: [{ ref: goal.ref, revision: goal.revision }] },
          });
          if (proposed.status !== 'committed') return proposed;
          return { status: 'progressed', branch: 'no_task', stage: 'proposal' };
        }
        const proposal = proposalRead.value;
        if (proposal.status !== 'accepted') {
          // Stage 11: the first plan is the person's; a later refinement follows the autonomy level.
          const first = goal.activePlanRevision === null;
          const automatic = decisionActionPolicy({ autonomy: goal.settings.autonomy,
            action: 'refine_future', actorClass: 'system', countedNext: null, cap: 0 }) === 'automatic';
          if (first || !automatic) {
            return { status: 'awaiting_decision', branch: 'no_task', proposalRef: { ...proposalRef } };
          }
          const adopted = await plans.applyPlanChange(automationContext(owned), {
            input: { proposalRef: { ...proposalRef }, expectedProposalRevision: proposal.revision,
              decisionRefs: [] },
            meta: { requestId: `intervention:${key}:adopt`, expected: [
              { ref: goal.ref, revision: goal.revision },
              { ref: proposalRef, revision: proposal.revision },
            ] },
          });
          if (adopted.status !== 'committed') return adopted;
          const claimed = await claimFirstReady(owned, input, message, goal);
          if (claimed !== null) return claimed;
          return { status: 'progressed', branch: 'no_task', stage: 'adoption' };
        }
        // The proposal already reads `accepted`: the person's card or an earlier pass adopted it. Only the claim
        // is left; no second propose and no second adoption.
        const claimed = await claimFirstReady(owned, input, message, goal);
        return claimed ?? { status: 'queued', reason: 'no_task' };
      }

      /** The post-adoption claim: the proposal's first ready task for this line's role, else the ordinary next pick. */
      async function claimFirstReady(owned: Owned, input: InterventionInput, message: SessionMessage,
        goal: GoalSnapshot): Promise<HandleInterventionResultV1 | null> {
        // The claim pins the Goal's CURRENT revision: the adoption may have moved it on this call, and a person's
        // card adoption may have moved it between the handler's Goal read and this claim.
        const currentGoal = await plans.queryGoal(owned.ctx, { ...goal.ref });
        if (currentGoal.status !== 'ready') return asRejection(currentGoal, 'the intervened Goal');
        const fresh = currentGoal.value.goal;
        const ready = await plans.queryReadyTasks(owned.ctx, { goalRef: { ...fresh.ref },
          roleIds: [input.roleBinding.templateId], includeBlocked: false, page: { limit: 1 } });
        if (ready.status !== 'ready') return asRejection(ready, 'the ready Tasks');
        const first = ready.value.items[0];
        if (first === undefined) return null;
        // The ready page carries the Task row and its plan ref; the claim takes the plan snapshot and the
        // Task definition the ready read already proved.
        const graph = await plans.queryTaskGraph(owned.ctx,
          { goalRef: { ...fresh.ref }, planRef: first.planRef });
        if (graph.status !== 'ready') return asRejection(graph, 'the ready Task graph');
        const task = first.task.definition;
        const row = first.task;
        const card = await sessions.readSession(owned.ctx,
          { projectId: line.projectId, sessionId: line.sessionId });
        if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
        const base: Base = { goalRef: { ...fresh.ref }, flowId: '', sessionHint: line,
          actor: owned.actor, taskId: task.taskId, failedCardRefs: [], releaseSkip: new Set<string>() };
        const claimed = await deps.claimIntervention(owned, base, fresh, graph.value.plan,
          task, row, card.value, input.messageRef);
        if ('status' in claimed) return claimed;
        return { status: 'claimed', branch: 'no_task', claim: claimed.claim };
      }
    },
  };
}
