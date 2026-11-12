import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { PlanningAnswerShapeV1, QueryJobAnswerRef, QueryJobIntentV1 } from '../../contracts/query-job.js';
import { interventionPlanningQueryRefs, queryJobRefFor } from '../../contracts/query-job.js';
import { planningReplyTextOf, systemRoundOfText } from '../../contracts/plan-round.js';
import { sameJson } from '../../contracts/fingerprint.js';
import { parseInitialPlanningResponseV2 } from '../../contracts/initial-planning-parse.js';
import type { PlanProposal, PlanProposalRef, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import { plainSessionRefToAggregate } from '../../core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../../core/work-graph/sessions/message-record-codecs.js';
import { decisionActionPolicy } from '../../core/work-graph/state/decision-policy.js';
import { normalizeInitialPlanningResponseV2 } from '../../core/work-graph/tasks/initial-plan.js';
import { reviewQueryEnded } from '../../core/work-graph/model/evidence-contracts.js';
import { planSourceLineageOf } from '../../core/work-graph/tasks/plan-lineage.js';
import { planProposalIdFor } from '../../core/work-graph/tasks/plan-service.js';
import { mergeStageRefinement } from '../../core/work-graph/tasks/stage-segment.js';
import { asRejection } from './consultation.js';
import { planningAnswerShapeOf } from './plan-round.js';
import { createQueryStageDriver, queryRunEndedWithoutAnswer } from './query-stage-driver.js';
import type { HandleInterventionResultV1, InterventionInput, WorkflowDependencies } from './ports.js';
import { automationContext, ownContext, type Base, type Owned } from './workflow.js';

/** The propose refusals another pass could change; any other refusal is about the plan itself. */
const PROPOSE_RETRIED_CODES: ReadonlySet<CoreRejection['code']> = new Set([
  'unavailable', 'cancelled', 'busy', 'revision_conflict', 'source_stale',
]);

export type InterventionDependencies = {
  /** createWorkflow's own deps object, by reference, never spread (the task-gate rule, book `:258`). */
  workflow: Pick<WorkflowDependencies,
    'consultations' | 'plans' | 'requestIntake' | 'runtime' | 'sessions' | 'sessionDuty' | 'sessionFacts'>;
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
      /** P1's one source-lineage walk over the three frozen read ports (DR-P2-02). */
      const lineageDeps = { messages: mailbox, queries: queryOwner, plans };
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
      // The Host's second step of a closing: the notice is already committed, so only the formal Answer's
      // association with this message is missing. The same deterministic Query and its last Answer are re-derived.
      if (input.completion === 'associate_answer') return associateAnswer(owned, input, message);
      // The line is the recipient Session; the named Task wins over the line's newest Work Task. A message
      // without `taskRef` is allowed: its effective line is the Session below (book `:445`; 7b1rd-07). The
      // allowed sender is L's dispatch gate (person or `action_request`, SR9 L3); this handler does not restate it.
      const line = message.recipient;
      const facts = await sessionFacts.readSessionFacts(owned.ctx, line);
      if (facts.status !== 'ready') return asRejection(facts, 'the intervention line facts');
      // The recipient line's duty is a read through the existing resolver; an uninstalled or `unknown` duty keeps
      // today's path and never guesses a review. A non-ready read is the existing rejection mapping, no new code.
      const dutyRead = deps.workflow.sessionDuty === undefined
        ? null : await deps.workflow.sessionDuty(facts.value.session.role, owned.ctx);
      if (dutyRead !== null && dutyRead.status !== 'ready') {
        return asRejection(dutyRead, 'the intervention line duty');
      }
      const duty = dutyRead !== null && dutyRead.value !== 'unknown' ? dutyRead.value : null;
      const systemRound = message.sender.kind === 'host' && message.sender.actor.kind === 'system'
        && message.intent === 'action_request';
      const planningLine = duty === 'adviser' || duty === 'reviewer';
      // The planning branch never treats the line's newest Work as the message's addressee: a Host system round
      // and an adviser/reviewer line carry only the message's own `taskRef` as planning context. Every other
      // line keeps today's `taskRef ?? latestWork` claim path.
      const planning = systemRound || planningLine;
      const addressed = planning
        ? message.taskRef ?? null
        : message.taskRef ?? facts.value.latestWork?.task ?? null;
      // The branch is decided by the FORMAL Goal phase, not by a Task row (a Task row is a separate projection):
      // read the Goal and the display before the graph, so a completed Goal never reaches the unfinished-task claim.
      const goalRef = planning
        ? message.goalRef ?? null
        : addressed !== null
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
      // Window 3 (§5.5.2, slice 9 §3.7): the terminal settlement a settlement offer stands for runs BEFORE the Goal's
      // branches. An ended `execreview:` Query's source always settles here (a completed Goal's reviewer line is never
      // routed to `requestNewGoal`); any other ended Query's source settles here once its Goal takes no new work for
      // good (cancelled or COMPLETED), where the branches below would leave it open and its line unarchivable.
      const goalOpen = goal !== null && goal.desiredState !== 'cancelled' && display?.phase !== 'COMPLETED';
      if (!goalOpen || (systemRound && duty === 'reviewer')) {
        const settled = await closeSettledSource(owned, message, goalOpen);
        if (settled !== null) return settled;
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
      if (!planning && addressed !== null) {
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
      // The submit shape is frozen from the trusted sender, the recipient line's duty and the system round's head
      // kind (slice 9: only `execreview:` makes a reviewer's shape `exec_review`); the body gives nothing else.
      const answerShape: PlanningAnswerShapeV1 = duty === null ? 'text'
        : planningAnswerShapeOf(message, duty, systemRoundOfText(body.value.text)?.kind);
      return planOnIdleLine(owned, input, message, goal, body.value.text, planning, answerShape);

      /**
       * Window 3's one terminal settlement, for every planning round: the source of an ended `intervention_planning`
       * Query that still has no reply closes through the Host's existing endings — the reply (`answer_ready`), or the
       * fixed notice and withdrawal (`no_answer`) when the ended Query has no answer that gives a reply. While the
       * Goal is open only an exec review closes here (any other answer keeps `planOnIdleLine`, which may still write
       * its candidate); on a Goal that takes no new work a review closes `answered`, an answer that is no plan
       * `invalid_plan`, a plan whose candidate the person adopted before the Goal ended `adopted` (the reply
       * `planOnIdleLine` gives an accepted candidate), and any other plan `declined` (it can no longer be taken).
       * `null` keeps today's path: no Query yet, another Query, not ended, or the source already replied.
       */
      async function closeSettledSource(owned: Owned, message: SessionMessage, goalOpen: boolean):
      Promise<HandleInterventionResultV1 | null> {
        const read = await queryOwner.readQueryJob(owned.ctx, interventionPlanningQueryRefs(message.ref).queryJobRef);
        if (read.status === 'not_found') return null;
        if (read.status !== 'ready') return asRejection(read, 'the ended planning Query');
        const job = read.value.job.job;
        const execution = job.intent.execution;
        if (execution.kind !== 'intervention_planning'
          || sessionMessageRefKey(execution.sourceMessageRef as SessionMessageRef) !== sessionMessageRefKey(message.ref)) {
          return null;
        }
        const shape = execution.answerShape ?? 'text';
        if (goalOpen && shape !== 'exec_review') return null;
        if (!reviewQueryEnded(job) || message.response !== null) return null;
        const answerRef = job.answerRefs.at(-1);
        if (answerRef === undefined) return { status: 'no_answer', branch: 'no_task' };
        const answer = await queryOwner.readQueryAnswer(owned.ctx, answerRef);
        if (answer.status !== 'ready') return asRejection(answer, 'the ended planning answer');
        const answerText = answer.value.answer.answer;
        if (planningReplyTextOf({ shape, answerText, queryJobId: job.queryJobId }) === null) {
          return { status: 'no_answer', branch: 'no_task' };
        }
        if (shape === 'exec_review' || shape === 'plan_review') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
        }
        if (parseInitialPlanningResponseV2(answerText).status !== 'parsed') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'invalid_plan' };
        }
        // The commit entry admits an intervention Query only with its real Goal, so `goalId` is present.
        const proposal = await plans.readPlanProposal(owned.ctx,
          interventionProposalRefOf(owned, message, job.goalId as string));
        if (proposal.status !== 'ready' && proposal.status !== 'not_found') {
          return asRejection(proposal, 'the intervention plan proposal');
        }
        const adopted = proposal.status === 'ready' && proposal.value.status === 'accepted';
        return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef },
          reason: adopted ? 'adopted' : 'declined' };
      }

      /** The intervention's one candidate address for its source: the propose identity `intervention:<key>:propose`. */
      function interventionProposalRefOf(owned: Owned, message: SessionMessage, goalId: string): PlanProposalRef {
        return { aggregateType: 'PlanProposal', projectId: owned.projectId, workspaceId: owned.workspaceId,
          proposalId: planProposalIdFor({ projectId: owned.projectId, workspaceId: owned.workspaceId, goalId,
            requestId: `intervention:${sessionMessageRefKey(message.ref)}:propose` }) };
      }

      /**
       * The closing's association step: the formal Answer of the source Query becomes one reply. `queryMessageRef`
       * is the message whose deterministic Query was answered (the Host's R); `replyToMessageRef` is the one message
       * that gets the reply (R itself, or the executor M through `repliesToMessageRef`/the lineage root). Existing
       * one-message callers pass the same value; the reply is first-wins and the pin is its own revision.
       */
      async function associateAnswer(owned: Owned,
        input: Extract<InterventionInput, { completion: 'associate_answer' }>, message: SessionMessage):
      Promise<HandleInterventionResultV1> {
        const refs = interventionPlanningQueryRefs(message.ref);
        const read = await queryOwner.readQueryJob(owned.ctx, refs.queryJobRef);
        if (read.status !== 'ready') return asRejection(read, 'the intervention planning Query');
        // The only production caller runs after `answer_ready`, so the settled Query has its formal Answer.
        const answerRef: QueryJobAnswerRef = read.value.job.job.answerRefs.at(-1)!;
        const execution = read.value.job.job.intent.execution;
        const repliesTo = execution.kind === 'intervention_planning'
          ? execution.repliesToMessageRef : undefined;
        // `replyToOriginal=false` is the delayed executor close-out: only a planresume/planfix R (a Query that
        // carries `repliesToMessageRef`) is associated now; the source message itself is left open. A message that
        // is its own Query source (no planresume R yet) is the empty `responded` no-op.
        if (input.replyToOriginal === false) {
          if (repliesTo === undefined) {
            return { status: 'responded', branch: 'no_task', answerRef: { ...answerRef } };
          }
          return associateReply(owned, message.ref, answerRef);
        }
        if (repliesTo === undefined) return associateReply(owned, message.ref, answerRef);
        // §5.2.4: R's end is not M's reply. M's one slot may hold an earlier answer, and R still ends; M goes first so
        // a crash between the two re-offers R and replays M.
        const replied = await associateReply(owned, repliesTo, answerRef);
        if (replied.status === 'rejected' && replied.code !== 'source_stale') return replied;
        return associateReply(owned, message.ref, answerRef);
      }

      /** One reply write: the same answer replays as `responded`, any other existing reply is `source_stale`. */
      async function associateReply(owned: Owned, replyRef: SessionMessageRef, answerRef: QueryJobAnswerRef):
      Promise<HandleInterventionResultV1> {
        // Re-read the current reply target: the reply is first-wins and the pin is its own revision.
        const current = await mailbox.readMessage(owned.ctx, replyRef);
        if (current.status !== 'ready') return asRejection(current, 'the intervention message');
        const existing = current.value.response;
        if (existing !== null) {
          const same = existing.sender.kind === 'query_run'
            && sameJson(existing.sender.answerRef, answerRef);
          return same
            ? { status: 'responded', branch: 'no_task', answerRef: { ...answerRef } }
            : { status: 'rejected', code: 'source_stale', reason: 'the intervention message already has another reply' };
        }
        const associated = await mailbox.respondFromQueryAnswer(owned.ctx, {
          input: { messageRef: { ...replyRef }, answerRef: { ...answerRef } },
          meta: { requestId: `intervention:${sessionMessageRefKey(replyRef)}:respond`,
            expected: [{ ref: current.value.ref, revision: current.value.revision }] },
        });
        if (associated.status !== 'committed') return associated;
        return { status: 'responded', branch: 'no_task', answerRef: { ...answerRef } };
      }

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

      /**
       * The one `execution.repliesToMessageRef` a new planning Query freezes (§5.2.3, DR-P2-04). A `planresume:`
       * inherits the original Query's value and falls back to the lineage root; a `planfix:` names its lineage
       * root only when that root is an executor message (not this round's R and not a Host system round). Every
       * other message adds no field and makes no read.
       */
      async function plannedRepliesTo(owned: Owned, message: SessionMessage, text: string):
      Promise<{ status: 'ready'; value: SessionMessageRef | undefined } | CoreRejection> {
        const head = systemRoundOfText(text);
        if (head?.kind !== 'planresume' && head?.kind !== 'planfix') return { status: 'ready', value: undefined };
        if (head.kind === 'planresume') {
          const original = await queryOwner.readQueryJob(owned.ctx,
            queryJobRefFor(owned.projectId, owned.workspaceId, head.queryJobId));
          if (original.status !== 'ready') return asRejection(original, 'the original planning Query');
          const execution = original.value.job.job.intent.execution;
          const previous = execution.kind === 'intervention_planning'
            ? execution.repliesToMessageRef : undefined;
          const lineage = await planSourceLineageOf(owned.ctx, lineageDeps, message.ref);
          if (lineage.status !== 'ready') return asRejection(lineage, 'the planning source lineage');
          return { status: 'ready', value: previous ?? lineage.value.rootMessage };
        }
        const lineage = await planSourceLineageOf(owned.ctx, lineageDeps, message.ref);
        if (lineage.status !== 'ready') return asRejection(lineage, 'the planning source lineage');
        const root = lineage.value.rootMessage;
        if (sessionMessageRefKey(root) === sessionMessageRefKey(message.ref)) {
          return { status: 'ready', value: undefined };
        }
        const rootRead = await mailbox.readMessage(owned.ctx, root);
        if (rootRead.status !== 'ready') return asRejection(rootRead, 'the planning source lineage root');
        const hostSystemRound = rootRead.value.sender.kind === 'host'
          && rootRead.value.sender.actor.kind === 'system';
        return { status: 'ready', value: hostSystemRound ? undefined : root };
      }

      /**
       * The base a segment refines and the `basedOn` written with it (§5.1.2, §5.2.4(3) addition 3): the fixed
       * candidate's draft for `planfix:`, the lineage's `fixBase` for `planresume:`, else the active plan snapshot.
       * A Goal with no adopted plan has no base (the first-plan path keeps the normalized draft).
       */
      async function planBaseOf(owned: Owned, message: SessionMessage, text: string, goal: GoalSnapshot):
      Promise<{ status: 'ready'; base: PlanRevisionSnapshot | PlanRevisionDraft | null;
        basedOn: PlanRevisionRef | null } | CoreRejection> {
        const head = systemRoundOfText(text);
        if (head?.kind === 'planfix') {
          const parent = await plans.readPlanProposal(owned.ctx, {
            aggregateType: 'PlanProposal', projectId: owned.projectId, workspaceId: owned.workspaceId,
            proposalId: head.proposalId,
          });
          if (parent.status !== 'ready') return asRejection(parent, 'the planfix parent candidate');
          return { status: 'ready', base: parent.value.draft, basedOn: parent.value.basedOn };
        }
        if (head?.kind === 'planresume' || message.followupOf !== null) {
          const lineage = await planSourceLineageOf(owned.ctx, lineageDeps, message.ref);
          if (lineage.status !== 'ready') return asRejection(lineage, 'the planning source lineage');
          if (lineage.value.fixBase !== null) {
            return { status: 'ready', base: lineage.value.fixBase.draft,
              basedOn: lineage.value.fixBase.basedOn };
          }
        }
        if (goal.activePlanRevision === null) return { status: 'ready', base: null, basedOn: null };
        const graph = await plans.queryTaskGraph(owned.ctx, { goalRef: goal.ref });
        if (graph.status !== 'ready') return asRejection(graph, 'the active Plan');
        return { status: 'ready', base: graph.value.plan, basedOn: graph.value.plan.ref };
      }

      /** No task, active Goal: one read-only Query -> one proposal -> the policy's adoption (book `:672`-`:699`). */
      async function planOnIdleLine(owned: Owned,
        input: Extract<InterventionInput, { completion?: undefined }>, message: SessionMessage,
        goal: GoalSnapshot, text: string, planning: boolean, answerShape: PlanningAnswerShapeV1):
      Promise<HandleInterventionResultV1> {
        const key = sessionMessageRefKey(message.ref);
        const refs = interventionPlanningQueryRefs(message.ref);
        const proposalRef = interventionProposalRefOf(owned, message, goal.ref.goalId);
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
          const repliesTo = await plannedRepliesTo(owned, message, text);
          if (repliesTo.status === 'rejected') return repliesTo;
          const intent: QueryJobIntentV1 = {
            schemaVersion: 1, intentId: refs.queryJobRef.queryJobId,
            projectId: owned.projectId, workspaceId: owned.workspaceId, goalId: goal.ref.goalId,
            question: text, focusTaskRefs: [], budget: input.budget, multiTurn: { maxRounds: 1 },
            correlationId: `intervention:${refs.queryRunRef.runId}`,
            execution: { kind: 'intervention_planning', sourceMessageRef: { ...message.ref }, answerShape,
              ...(repliesTo.value === undefined ? {} : { repliesToMessageRef: { ...repliesTo.value } }),
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
        // A formally ended Query with no saved Answer is the third ending: the Host sends the one fixed notice
        // and withdraws the stale source. Only this proven end reaches it; every read/version failure above returned.
        if (answerRef === undefined) return { status: 'no_answer', branch: 'no_task' };
        const readFacts = plans.readInitialPlanAnswerFacts;
        if (readFacts === undefined) {
          return { status: 'rejected', code: 'unsupported',
            reason: 'the Plan owner does not publish readInitialPlanAnswerFacts' };
        }
        const facts = await readFacts.call(plans, owned.ctx, answerRef,
          { kind: 'intervention', messageRef: { ...message.ref } });
        if (facts.status !== 'ready') return asRejection(facts, 'the intervention planning answer');
        // A reviewer line writes no candidate, whoever asked: the goal loop reads a review round's conclusion from the
        // same Query. The message closes through the derived reply; a review that no longer parses has no reply and
        // takes the existing `no_answer` close-out, whose fixed notice covers the missing conclusion.
        if (duty === 'reviewer') {
          const reply = planningReplyTextOf({
            shape: facts.value.job.job.intent.execution.answerShape ?? 'text',
            answerText: facts.value.answerText,
            queryJobId: facts.value.job.job.queryJobId,
          });
          if (reply === null) return { status: 'no_answer', branch: 'no_task' };
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
        }
        const parsed = parseInitialPlanningResponseV2(facts.value.answerText);
        // An answer that cannot form an adoptable plan is the second ending: the original answer stays the formal
        // Answer and becomes the reply; the Host adds the one fixed notice. No proposal is written.
        if (parsed.status !== 'parsed') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'invalid_plan' };
        }
        // The model's own change reason travels unchanged; the platform only adds the empty source list (book `:495`).
        const answerReason = parsed.response.kind === 'plan' ? parsed.response.reason : undefined;
        const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts.value);
        if (normalized.status === 'rejected') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'invalid_plan' };
        }
        if (normalized.status === 'needs_decision') {
          // The answer and its question cards are the end of this turn; answering a card saves the answer only.
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'questions' };
        }
        // A plan its owner refuses is the second ending as well; only what another pass could change stays a rejection.
        const refusedPlan = (refusal: CoreRejection): HandleInterventionResultV1 => (
          PROPOSE_RETRIED_CODES.has(refusal.code) ? refusal
            : { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'invalid_plan' });
        // Stage 10: the proposal is read first; its receipt identity makes a re-run return the same candidate.
        const proposalRead = await plans.readPlanProposal(owned.ctx, proposalRef);
        if (proposalRead.status !== 'ready' && proposalRead.status !== 'not_found') {
          return asRejection(proposalRead, 'the intervention plan proposal');
        }
        if (proposalRead.status === 'not_found') {
          // The segment merges into the base it refines; the target revision is the fixed source Plan's +1, and
          // the initial normalizer fixes 1 for a first plan (there is no base and no merge to do).
          const targetPlanRevision = (facts.value.manifest.focusPlan?.revision ?? 0) + 1;
          const basis = await planBaseOf(owned, message, text, goal);
          if (basis.status === 'rejected') return basis;
          let draft: PlanRevisionDraft;
          if (basis.base === null) {
            draft = normalized.draft;
          } else {
            const { origin: _segmentOrigin, ...segment } = normalized.draft;
            const merged = mergeStageRefinement(basis.base, { ...segment, planRevision: targetPlanRevision });
            if (merged.status !== 'merged') return refusedPlan(merged);
            draft = merged.draft;
          }
          const proposed = await plans.proposePlan(owned.ctx, {
            input: { goalRef: facts.value.resolution.goal, basedOn: basis.basedOn,
              draft,
              reason: {
                ...(answerReason ?? { text: normalized.summary, affectedTaskIds: [] }),
                sources: [],
              },
              requestRef: { ...refs.queryJobRef }, sourceMessageRef: { ...message.ref } },
            meta: { requestId: `intervention:${key}:propose`,
              expected: [{ ref: goal.ref, revision: goal.revision }] },
          });
          if (proposed.status !== 'committed') return refusedPlan(proposed);
          // The planning branch writes the candidate and returns; adoption belongs to the goal loop. The Host's
          // closing associates the answer to R after this stage (L's wiring).
          return { status: 'progressed', branch: 'no_task', stage: 'proposal' };
        }
        const proposal = proposalRead.value;
        // The fourth ending: a proposal the person did not adopt replies the original answer, whether it was
        // abandoned or replaced. A replacement is never followed; the person's decision closed this turn.
        if (proposal.status === 'not_adopted') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'declined' };
        }
        if (planning) {
          // The planning branch never adopts or claims: an accepted candidate only needs its reply, and a pending
          // (or now stale) one is the `candidate` close-out of the same already-written candidate.
          return proposal.status === 'accepted'
            ? { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'adopted' }
            : { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'candidate' };
        }
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
      async function claimFirstReady(owned: Owned,
        input: Extract<InterventionInput, { completion?: undefined }>, message: SessionMessage,
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
