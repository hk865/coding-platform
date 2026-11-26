import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../contracts/core/identity.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import { isUserMessageRecipient, type SessionMessageRef } from '../../contracts/core/session-message.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { TaskClaim } from '../../contracts/core/task-claim.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../contracts/plan.js';
import type { PlanningAnswerShapeV1, QueryJobAnswerRef, QueryJobIntentV1 } from '../../contracts/query-job.js';
import { endedOnPurposeBeforeEntry, interventionPlanningQueryRefs, queryJobRefFor } from '../../contracts/query-job.js';
import type { SystemRoundV1 } from '../../contracts/plan-round.js';
import { commandReviewSubjectOfText, planningReplyTextOf } from '../../contracts/plan-round.js';
import { parseCommandReviewAnswer, type CommandReviewAnswerV1 } from '../../contracts/scribe-review.js';
import { isRoleLineOpenDuty } from '../../contracts/role-lines.js';
import { sameJson } from '../../contracts/fingerprint.js';
import { parseInitialPlanningResponseV2 } from '../../contracts/initial-planning-parse.js';
import type { PlanProposal, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { SessionCard } from '../../core/work-graph/model/session-contracts.js';
import { interventionGoalRefOf, planningDutyOnly, type SessionMessage }
  from '../../core/work-graph/model/communication-contracts.js';
import { plainSessionRefToAggregate } from '../../core/work-graph/sessions/session-record-codecs.js';
import { sessionMessageRefKey } from '../../core/work-graph/sessions/message-record-codecs.js';
import { decisionActionPolicy } from '../../core/work-graph/state/decision-policy.js';
import { isEndedGoalDisplayPhase } from '../../core/work-graph/state/goal-machine.js';
import { isMessageAgentSender, waitFactsOfRecord, waitStateOf } from '../../core/work-graph/state/message-machine.js';
import { normalizeInitialPlanningResponseV2 } from '../../core/work-graph/tasks/initial-plan.js';
import { reviewQueryEnded } from '../../core/work-graph/model/evidence-contracts.js';
import { chainTailIsSource, hostContextIn, interventionProposalRefOf, interventionProposalRequestIdOf,
  interventionQueryWorkspaceOf, overlapNoteOf, planSourceLineageOf, requestCandidateChainEndOf, trustedSystemRoundOf,
  type CandidateChainEndDeps,
} from '../../core/work-graph/tasks/plan-lineage.js';
import { mergeStageRefinement } from '../../core/work-graph/tasks/stage-segment.js';
import { planInCallerView } from '../../core/work-graph/tasks/plan-validation.js';
import { applyCommandReview } from './command-review.js';
import { asRejection } from './consultation.js';
import { planningAnswerShapeOf } from './plan-round.js';
import { createQueryStageDriver, queryRunEndedWithoutAnswer } from './query-stage-driver.js';
import type { QueryJobRecord } from '../../core/work-graph/queries/contracts.js';
import type { CheckApproval } from './check-approval.js';
import type { HandleInterventionResultV1, InterventionInput, WorkflowDependencies } from './ports.js';
import { autoAdoptCandidate, automationContext, ownContext, ownedInWorkspace, type Base, type Owned }
  from './workflow.js';

// The closing reasons and the notice's fixed request identity live in `contracts/core/session-message.ts` (the one
// declaration both Workflow and WorkGraph read); re-exported here so existing callers keep this import site.
export { INTERVENTION_CLOSING_REASONS, interventionClosingNoticeRequestId,
  type InterventionClosingReasonV1 } from '../../contracts/core/session-message.js';

/** The propose refusals another pass could change; any other refusal is about the plan itself. */
export const PROPOSE_RETRIED_CODES: ReadonlySet<CoreRejection['code']> = new Set([
  'unavailable', 'cancelled', 'busy', 'revision_conflict', 'source_stale',
]);

/** The one frozen sender fact of a planning source: the person, the platform, or the sending line. */
function sourceSenderOf(message: SessionMessage):
  NonNullable<QueryJobIntentV1['execution']['sourceSender']> {
  if (message.sender.kind === 'host') {
    return message.sender.actor.kind === 'human' ? { kind: 'person' } : { kind: 'platform' };
  }
  return { kind: 'line', sessionId: message.sender.sessionRef.sessionId };
}

export type InterventionDependencies = {
  /** createWorkflow's own deps object, by reference, never spread (the task-gate rule, book `:258`). */
  workflow: Pick<WorkflowDependencies,
    'consultations' | 'plans' | 'requestIntake' | 'runtime' | 'sessions' | 'sessionDuty' | 'sessionFacts'
    | 'controls' | 'executions' | 'messages' | 'requests' | 'recipients' | 'commandReview' | 'overlap'
    | 'unknownCallReviews' | 'readCandidateCard' | 'latestAgentCandidate' | 'candidateSuccessorsOf'>;
  /** The one ordinary claim builder, passed by createWorkflow (`buildClaimOperation`, workflow.ts:1041). */
  claimIntervention(owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow, session: SessionCard, messageRef: SessionMessageRef):
    Promise<{ claim: TaskClaim } | CoreRejection>;
  /** G8B B1：批检查（请批和收尾），createWorkflow 用自己的闭包构造后按引用传进来。 */
  checkApproval?: CheckApproval;
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
      const queryGoalDisplay = plans.queryGoalDisplay;
      const projects = consultations.projects;
      /** A12's one chain-end read: the candidate reads and, when wired, the trusted successor relation. */
      const chainDeps: CandidateChainEndDeps = { plans,
        ...(deps.workflow.candidateSuccessorsOf === undefined ? {} : { successors: deps.workflow.candidateSuccessorsOf }) };
      /** P1's one source-lineage walk over the three frozen read ports (DR-P2-02). */
      const lineageDeps = { messages: mailbox, queries: queryOwner, plans,
        ...(deps.workflow.unknownCallReviews === undefined
          ? {} : { readReview: deps.workflow.unknownCallReviews.readReview }) };
      // Two Host scopes of one project: the message, its body and its reply live in the message's workspace
      // (`messageOwned`); the line, its facts and its Session live where the line lives (`lineOwned`); the Goal,
      // its graph, plans, candidates and the message's one planning Query live in the Goal's (`goalOwned`). A
      // joined workspace's round to a main-workspace line keeps the three apart.
      const messageOwned = ownedInWorkspace(owned, input.messageRef.workspaceId);
      const read = await mailbox.readMessage(messageOwned.ctx, input.messageRef);
      if (read.status !== 'ready') return asRejection(read, 'the intervention message');
      const message = read.value;
      // Safety: another project's message is never handled. Another workspace of this project is: the Host is
      // trusted project-wide (104-1), and the Goal's Workflow closes a main-workspace line's round.
      if (message.ref.projectId !== owned.projectId) {
        return { status: 'rejected', code: 'forbidden',
          reason: 'the intervention message is outside the bound project' };
      }
      // The source message is the Query's provenance; a withdrawn one is stale, never planned from.
      if (message.withdrawnAt !== null) {
        return { status: 'rejected', code: 'source_stale', reason: 'the intervention message is withdrawn' };
      }
      // §2.3 source split, before any side effect: only the person's direct intervention (`entry`, written by the
      // Host entry alone) may claim, adopt or request a new Goal. An answered agent `ask_person` card addressed to
      // the user is its own `decision_answer` round on the CARD SENDER's line; every other message opens its round
      // on the recipient line. Both facts are stored, never the body or the intent.
      // This is the ONE card-answer judgment: the closing's association step takes its `sourcePart` from here too.
      const cardAnswer = message.decision !== undefined && message.response !== null
        && isMessageAgentSender(message.sender) && isUserMessageRecipient(message.recipient);
      const sourcePart: 'message' | 'decision_answer' = cardAnswer ? 'decision_answer' : 'message';
      // The Host's second step of a closing: the notice is already committed, so only the formal Answer's
      // association with this message is missing. The same deterministic Query and its last Answer are re-derived.
      // SMK3b (97-9; v3.4 B-01): a Host restart's pending GoalInterruption is resolved only when a person starts the
      // Goal driver (onStarted fires for a Goal-scoped start only, A/collaboration-driver.ts:1064). No pass on that Goal
      // runs under it, whoever sent the message (B-36) and whatever is left of its close-out; the message stays queued.
      const restartHeld = (display: { causes: readonly object[] } | null): HandleInterventionResultV1 | null =>
        display !== null && display.causes.some((cause) => 'interruption' in cause)
          ? { status: 'rejected', code: 'busy',
            reason: 'a Host restart interrupted the Goal; a person continues it by starting the Goal' }
          : null;
      if (input.completion === 'associate_answer') {
        return associateAnswer(owned, input, message, sourcePart);
      }
      // The settle-only close-out (§2.4) runs the ordinary reads below but stops before every new effect: no person
      // claim, no new-Goal request, no new or unfinished round, no adoption or claim after a candidate.
      const settleOnly = input.completion === 'settle_existing';
      if (input.completion === undefined && input.part === 'decision_answer' && !cardAnswer) {
        return { status: 'rejected', code: 'invalid',
          reason: 'a decision_answer round requires an answered agent card' };
      }
      const person = message.entry === 'person_intervention'
        && message.sender.kind === 'host' && message.sender.actor.kind === 'human';
      // A plain user-recipient message is not a line; an answered agent card is the one exception, and it takes
      // the card's own sender line below.
      let line: SessionRef;
      if ('kind' in message.recipient) {
        if (!cardAnswer || !isMessageAgentSender(message.sender)) {
          return { status: 'rejected', code: 'unsupported', reason: 'a user-recipient message is not a line' };
        }
        line = message.sender.sessionRef;
      } else {
        line = message.recipient;
      }
      // A SessionRef is workspace-less; the message records the workspace its recipient line and facts live in.
      const lineOwned = messageOwned;
      const facts = await sessionFacts.readSessionFacts(lineOwned.ctx, line);
      if (facts.status !== 'ready') return asRejection(facts, 'the intervention line facts');
      // The recipient line's duty is a read through the existing resolver; an uninstalled or `unknown` duty keeps
      // today's path and never guesses a review. A non-ready read is the existing rejection mapping, no new code.
      const dutyRead = deps.workflow.sessionDuty === undefined
        ? null : await deps.workflow.sessionDuty(facts.value.session.role, lineOwned.ctx);
      if (dutyRead !== null && dutyRead.status !== 'ready') {
        return asRejection(dutyRead, 'the intervention line duty');
      }
      const duty = dutyRead !== null && dutyRead.value !== 'unknown' ? dutyRead.value : null;
      // The card-answer round reads the saved answer body (`part:'response'`); every other round reads the message.
      const bodyPart = sourcePart === 'decision_answer' ? 'response' as const : 'message' as const;
      const body = await mailbox.readMessageBody(messageOwned.ctx,
        { messageRef: input.messageRef, part: bodyPart });
      if (body.status !== 'ready') return asRejection(body, 'the intervention message body');
      const text = body.value.text;
      // The two system sources are read from stored facts only: the Host's own sent-round receipt (via
      // `trustedSystemRoundOf`) and, for a new round only, the overlap gate's saved `noteRequest.messageRef`
      // (`planOnIdleLine`). The body head alone proposes.
      let trusted: SystemRoundV1 | null = null;
      if (message.sender.kind === 'host' && message.sender.actor.kind === 'system') {
        const goalWorkspace = await interventionQueryWorkspaceOf(messageOwned.ctx, plans, message);
        if (goalWorkspace.status !== 'ready') return asRejection(goalWorkspace, 'the message Goal');
        const accepted = await trustedSystemRoundOf(messageOwned.ctx, lineageDeps, message, text,
          goalWorkspace.value);
        if (accepted.status !== 'ready') return asRejection(accepted, 'the trusted system round');
        trusted = accepted.value;
      }
      // Only the person's B20 message may reach the claim, the adoption and the new-Goal request. Every other
      // source is a planning round: its addressee is the message's own `taskRef`, never the line's newest Work. B20
      // itself is unchanged (design 2.3/4.1): the person's message to an adviser or reviewer line plans only, too.
      const planning = !person || planningDutyOnly(duty);
      let addressed = planning
        ? message.taskRef ?? null
        : message.taskRef ?? facts.value.latestWork?.task ?? null;
      // The branch is decided by the FORMAL Goal phase, not by a Task row (a Task row is a separate projection):
      // read the Goal and the display before the graph, so a completed Goal never reaches the unfinished-task claim.
      let goalRef = planning
        ? message.goalRef ?? null
        : addressed !== null
          ? { aggregateType: 'Goal' as const, projectId: addressed.projectId, goalId: addressed.goalId }
          : message.goalRef ?? null;
      let goalRead = goalRef === null ? null : await plans.queryGoal(messageOwned.ctx, goalRef, { scope: 'project' });
      if (goalRead !== null && goalRead.status !== 'ready') return asRejection(goalRead, 'the message Goal');
      // A Goal the person names wins over the line's newest Work, in any workspace: the line page sends the Goal its
      // subtitle shows, so the message counts toward the Goal the person saw there. With none named the newest Work's
      // Goal stands, unless it lives in another workspace: every reader finds a message's one Query from the message
      // alone, in the workspace of the Goal it names (`interventionGoalRefOf`), else its own, so the message stays
      // queued.
      const named = interventionGoalRefOf(message);
      if (goalRead !== null && goalRef !== null && !planning && message.taskRef === null && addressed !== null
        && named?.goalId !== goalRef.goalId) {
        if (named === null) {
          const otherWorkspace = goalRead.value.goal.workspaceRef.workspaceId !== message.ref.workspaceId;
          if (otherWorkspace) return { status: 'queued', reason: 'no_task' };
        } else {
          const namedRead = await plans.queryGoal(messageOwned.ctx, named, { scope: 'project' });
          if (namedRead.status !== 'ready') return asRejection(namedRead, 'the message Goal');
          addressed = null;
          goalRef = named;
          goalRead = namedRead;
        }
      }
      const goal = goalRead === null ? null : goalRead.value.goal;
      const goalOwned = goal === null ? messageOwned : ownedInWorkspace(owned, goal.workspaceRef.workspaceId);
      const displayRead = goalRef === null ? null : await queryGoalDisplay(goalOwned.ctx, { goalRef });
      if (displayRead !== null && displayRead.status !== 'ready') return asRejection(displayRead, 'the Goal display');
      const display = displayRead === null ? null : displayRead.value.display;
      // A Task-scoped intervention start must not run under a pending restart interruption either.
      const held = restartHeld(display);
      if (held !== null) return held;
      // Window 3 (§5.5.2, slice 9 §3.7): the terminal settlement a settlement offer stands for runs BEFORE the Goal's
      // branches. An ended `execreview:` Query's source always settles here (a completed Goal's reviewer line is never
      // routed to `requestNewGoal`), and so does an adviser's ended `ucr:` or `crr:` Query (K3 layering, 009, 121-110:
      // only the platform closes it; the round has no mailbox tools) and a scribe's ended `scr:` Query (121-112: the
      // platform applies its conclusion); any other ended Query's source settles here once its Goal takes no
      // new work for good (cancelled, COMPLETED or ACCEPTED_PARTIAL), where the branches below would leave it open
      // and its line unarchivable.
      const goalOpen = goal !== null && goal.desiredState !== 'cancelled' && !isEndedGoalDisplayPhase(display?.phase);
      if (!goalOpen || (trusted !== null && (duty === 'reviewer' || duty === 'adviser' || duty === 'scribe'))) {
        const settled = await closeSettledSource(goalOwned, message, goalOpen);
        if (settled !== null) return settled;
      }
      // An ended Goal (COMPLETED, or ACCEPTED_PARTIAL by the person) is checked BEFORE any claim. Only the person's
      // message starts a new goal-less request; every other source leaves the message readable and opens no round
      // (design 2.3, "目标已结束，不开轮").
      if (goal !== null && display !== null && isEndedGoalDisplayPhase(display.phase)) {
        if (!person || settleOnly) return { status: 'queued', reason: 'no_task' };
        return requestNewGoal(goalOwned, message, goal, text);
      }
      if (goal === null) return { status: 'queued', reason: 'no_task' };
      // Rule W (`session-chooser.ts` `projectReusable`): only a project-level duty line runs another workspace's Task.
      // Any other line outside the Goal's workspace plans only: its Query, candidate and reply stay, and the work
      // goes to the Goal's own line selection; neither claim below hands it this line.
      const planningOnly = planning
        || (lineOwned.workspaceId !== goalOwned.workspaceId && !isRoleLineOpenDuty(duty));
      const target = addressed;
      // Only the person's direct intervention claims an unfinished Task; an agent wake on an idle executor with
      // unfinished work is a text round and claims nothing.
      if (person && !planningOnly && !settleOnly && target !== null) {
        const graph = await plans.queryTaskGraph(goalOwned.ctx, { goalRef: goal.ref });
        if (graph.status !== 'ready') return asRejection(graph, 'the Task graph');
        const task = graph.value.plan.tasks.find((candidate) => candidate.taskId === target.taskId);
        const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === target.taskId);
        // Unfinished = active and not satisfied; the open wait is deliberately not consulted (D-04).
        const unfinished = task !== undefined && row !== undefined && row.disposition === 'active'
          && row.effectivePhase !== 'satisfied';
        if (unfinished && task !== undefined && row !== undefined) {
          const card = await sessions.readSession(lineOwned.ctx,
            { projectId: line.projectId, sessionId: line.sessionId });
          if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
          const base: Base = { goalRef: goal.ref, flowId: '', sessionHint: line,
            actor: owned.actor, taskId: target.taskId, failedCardRefs: [] };
          const claimed = await deps.claimIntervention(goalOwned, base, goal, graph.value.plan,
            task, row, card.value, input.messageRef);
          if ('status' in claimed) return claimed;       // CoreRejection; its `status` is 'rejected'
          return { status: 'claimed', branch: 'existing_task', claim: claimed.claim };
        }
      }
      // A Goal that is neither active nor completed (paused/cancelled) has no planning branch.
      if (goal.desiredState !== 'active') return { status: 'queued', reason: 'no_task' };
      return planOnIdleLine(goalOwned, input, message, goal, text, planningOnly, sourcePart);

      /**
       * Window 3's one terminal settlement, for every planning round: the source of an ended `intervention_planning`
       * Query closes through the Host's existing endings — the reply (`answer_ready`), or the fixed notice and
       * withdrawal (`no_answer`) when the ended Query has no answer that gives a reply. A card answer is the round's
       * input, not its reply (design 2.3/2.6), so a card-answer round closes here by the same endings. An ordinary
       * source that already has its reply still closes here: only its one fixed notice can be missing, and the Host
       * skips the reply write. While the
       * Goal is open only an exec review or an adviser's unknown-call answer closes here (any other answer keeps
       * `planOnIdleLine`, which may still write its candidate); on a Goal that takes no new work a review or an
       * unknown-call answer closes `answered`, a text answer `answered` (it is never parsed as a plan), an answer that
       * is no plan `invalid_plan`, a plan whose candidate the person adopted before the Goal ended `adopted` (the
       * reply `planOnIdleLine` gives an accepted candidate), and any other plan `declined` (it can no longer be
       * taken). `null` keeps today's path: no Query yet, another Query, or not ended.
       */
      async function closeSettledSource(owned: Owned, message: SessionMessage, goalOpen: boolean):
      Promise<HandleInterventionResultV1 | null> {
        const read = await queryOwner.readQueryJob(owned.ctx,
          interventionPlanningQueryRefs(message.ref, owned.workspaceId, sourcePart).queryJobRef);
        if (read.status === 'not_found') return null;
        if (read.status !== 'ready') return asRejection(read, 'the ended planning Query');
        const job = read.value.job.job;
        const execution = job.intent.execution;
        if (execution.kind !== 'intervention_planning'
          || sessionMessageRefKey(execution.sourceMessageRef as SessionMessageRef) !== sessionMessageRefKey(message.ref)) {
          return null;
        }
        const shape = execution.answerShape ?? 'text';

        if (goalOpen && shape !== 'exec_review' && shape !== 'unknown_call_advice' && shape !== 'scribe_review'
          && shape !== 'command_rerun_advice' && shape !== 'check_review') {
          return null;
        }
        // An existing reply does not skip the round: its one fixed notice may still be missing, and the Host then
        // sends only that notice.
        if (!reviewQueryEnded(job)) return null;
        if (shape === 'scribe_review') return settleCommandReview(owned, message, read.value);
        if (shape === 'check_review') return settleCheckReview(owned, read.value);
        const answerRef = job.answerRefs.at(-1);
        if (answerRef === undefined) return { status: 'no_answer', branch: 'no_task' };
        const answer = await queryOwner.readQueryAnswer(owned.ctx, answerRef);
        if (answer.status !== 'ready') return asRejection(answer, 'the ended planning answer');
        const answerText = answer.value.answer.answer;
        if (shape === 'exec_review' || shape === 'plan_review' || shape === 'unknown_call_advice'
          || shape === 'command_rerun_advice') {
          if (planningReplyTextOf({ shape, answerText, queryJobId: job.queryJobId }) === null) {
            return { status: 'no_answer', branch: 'no_task' };
          }
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
        }
        // Every remaining non-plan shape is `text`: its answer is the reply itself and is never parsed as a plan
        // (design 2.3). Only a `plan_round` Answer is a plan, so only it can owe a candidate or be `invalid_plan`.
        if (shape !== 'plan_round') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
        }
        if (parseInitialPlanningResponseV2(answerText).status !== 'parsed') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'invalid_plan' };
        }
        // The commit entry admits an intervention Query only with its real Goal, so `goalId` is present.
        const proposal = await plans.readPlanProposal(owned.ctx,
          interventionProposalRefOf(message.ref, owned.workspaceId, job.goalId as string,
            execution.sourcePart === 'decision_answer' ? 'decision_answer' : 'message'));
        if (proposal.status !== 'ready' && proposal.status !== 'not_found') {
          return asRejection(proposal, 'the intervention plan proposal');
        }
        if (proposal.status === 'not_found') {
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'declined' };
        }
        return chainEndingOf(owned, message, execution.sourcePart === 'decision_answer' ? 'decision_answer' : 'message',
          answerRef, proposal.value, execution.repliesToMessageRef, goalOpen, isEndedGoalDisplayPhase(display?.phase));
      }

      /**
       * A12: one round's ending from its candidate chain's end, read the same way as the consumable view. An
       * unreadable chain waits for the next pass. An adopted end is `adopted`; when the adopted tail is another
       * round, its adoption recovery replies M, so only R is associated here (`replySlot: 'source'`). A pending end is
       * this round's `candidate` close-out while the Goal takes work or has ended (COMPLETED or ACCEPTED_PARTIAL): the
       * candidate is still undecided, so its notice is filled and M stays unanswered until the ended-Goal exit takes
       * the abandoned tail's Answer back to M. A cancelled Goal keeps the abandoned close-out. An abandoned end is `declined`: M by this round's
       * own Answer when it is the tail; otherwise the Goal loop replies M with the tail's Answer, so this round waits
       * while M is still an open wait and then closes only R. No notice is resent and no round opens.
       */
      async function chainEndingOf(owned: Owned, message: SessionMessage, part: 'message' | 'decision_answer',
        answerRef: QueryJobAnswerRef, proposal: PlanProposal, repliesTo: SessionMessageRef | undefined,
        goalOpen: boolean, goalEnded: boolean): Promise<HandleInterventionResultV1> {
        const end = await requestCandidateChainEndOf(owned.ctx, chainDeps, proposal);
        if (end.status !== 'ready') return asRejection(end, 'the candidate chain');
        if (end.value.kind === 'incomplete') {
          return rejected('incomplete', 'a candidate source of the chain is not readable; the next pass reads it again');
        }
        const own = chainTailIsSource(end.value, message.ref, part);
        const ending = (reason: 'adopted' | 'candidate' | 'declined', sourceOnly: boolean): HandleInterventionResultV1 =>
          ({ status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason,
            ...(sourceOnly ? { replySlot: 'source' as const } : {}) });
        if (end.value.kind === 'accepted') return ending('adopted', !own);
        if (end.value.kind === 'pending' && (goalOpen || goalEnded)) return ending('candidate', false);
        if (own) return ending('declined', false);
        if (goalOpen && repliesTo !== undefined) {
          const wait = await mailbox.readMessage(ownedInWorkspace(owned, repliesTo.workspaceId).ctx, repliesTo);
          if (wait.status !== 'ready') return asRejection(wait, 'the executor wait');
          if (wait.value.response === null && waitStateOf(wait.value, waitFactsOfRecord(wait.value)).state === 'open') {
            return { status: 'queued', reason: 'no_task' };
          }
        }
        return ending('declined', true);
      }

      /**
       * G8B B1e：批检查轮结束后由平台落实结论（批了就采用、装检查、出请知悉；否则交人），然后来源照审阅轮关掉。
       * 拒绝原样返回，Host 下一轮用同一身份重做。
       */
      async function settleCheckReview(owned: Owned, record: QueryJobRecord): Promise<HandleInterventionResultV1> {
        if (deps.checkApproval === undefined) return rejected('unsupported', 'the check approval is not wired');
        const settled = await deps.checkApproval.settle(owned, { record });
        if ('status' in settled) return settled;
        const answerRef = record.job.job.answerRefs.at(-1);
        return !settled.answered || answerRef === undefined ? { status: 'no_answer', branch: 'no_task' }
          : { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
      }

      /**
       * 121-112: the scribe's ended long-command review. The platform applies the conclusion — or, with none that
       * parses, tells the person the command keeps running — and then the source closes like every review round:
       * the derived reply (`answered`) or the `no_answer` close-out. A refused step is returned, and the Host's next
       * pass repeats it under the same identities. The round writes no candidate (009: it is read-only).
       */
      async function settleCommandReview(owned: Owned, message: SessionMessage, record: QueryJobRecord):
      Promise<HandleInterventionResultV1> {
        const job = record.job.job;
        const subject = commandReviewSubjectOfText(job.intent.question);
        if (subject === null) return rejected('invalid', 'the scribe review round names no command subject');
        const answerRef = job.answerRefs.at(-1);
        let answer: CommandReviewAnswerV1 | null = null;
        if (answerRef !== undefined) {
          const stored = await queryOwner.readQueryAnswer(owned.ctx, answerRef);
          if (stored.status !== 'ready') return asRejection(stored, 'the ended review answer');
          const parsed = parseCommandReviewAnswer(stored.value.answer.answer);
          if (parsed.status === 'parsed') answer = parsed.answer;
        }
        const runOwned = ownedInWorkspace(owned, subject.workspaceId);
        const applied = await applyCommandReview(automationContext(runOwned), deps.workflow, {
          subject, answer, recipient: line, answeredBy: record.run.run.executionState?.sessionRef ?? null,
          sourceMessage: message.ref });
        if (applied.status !== 'ready') return applied;
        return answer === null || answerRef === undefined ? { status: 'no_answer', branch: 'no_task' }
          : { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
      }

      /**
       * The closing's association step: the formal Answer of the source Query becomes one reply. `queryMessageRef`
       * is the message whose deterministic Query was answered (the Host's R); `replyToMessageRef` is the one message
       * that gets the reply (R itself, or the executor M through `repliesToMessageRef`/the lineage root). Existing
       * one-message callers pass the same value; the reply is first-wins and the pin is its own revision.
       */
      async function associateAnswer(owned: Owned,
        input: Extract<InterventionInput, { completion: 'associate_answer' }>, message: SessionMessage,
        part: 'message' | 'decision_answer'): Promise<HandleInterventionResultV1> {
        // The Query lives with the Goal the message names; this arm reads no line facts. The Host's association
        // step runs before `lineOwned` exists, so the message's own Host scope locates the Goal.
        const queryWorkspace = await interventionQueryWorkspaceOf(messageOwned.ctx, plans, message);
        if (queryWorkspace.status !== 'ready') return asRejection(queryWorkspace, 'the message Goal');
        // The reply-only close-out (the Host offers it before the profile gate) waits for the person's start too.
        const goalRef = interventionGoalRefOf(message);
        if (goalRef !== null) {
          const shown = await queryGoalDisplay(ownedInWorkspace(owned, queryWorkspace.value).ctx, { goalRef });
          if (shown.status !== 'ready') return asRejection(shown, 'the Goal display');
          const held = restartHeld(shown.value.display);
          if (held !== null) return held;
        }
        // The card-answer judgment is the caller's one `sourcePart`: a card-answer round freezes its own
        // `decision_answer` part, so its Query is read by that part.
        const read = await queryOwner.readQueryJob(ownedInWorkspace(owned, queryWorkspace.value).ctx,
          interventionPlanningQueryRefs(message.ref, queryWorkspace.value, part).queryJobRef);
        if (read.status !== 'ready') return asRejection(read, 'the intervention planning Query');
        // The only production caller runs after `answer_ready`, so the settled Query has its formal Answer.
        const answerRef: QueryJobAnswerRef = read.value.job.job.answerRefs.at(-1)!;
        const execution = read.value.job.job.intent.execution;
        const repliesTo = execution.kind === 'intervention_planning'
          ? execution.repliesToMessageRef : undefined;
        const responded: HandleInterventionResultV1 = { status: 'responded', branch: 'no_task',
          answerRef: { ...answerRef } };
        const slot = input.replySlot ?? 'both';
        // `source` writes R only: the delayed executor close-out leaves its original wait M for the final answer, and
        // the reply-only close-out fills R. Without a separate `repliesTo` the source R is the executor M itself.
        if (slot === 'source') {
          return message.needsReply === true ? associateReply(owned, message.ref, answerRef) : responded;
        }
        // `original` writes only the executor's original wait M; without a separate `repliesTo` that wait is the
        // source itself (`M === R`), so the adopted/abandoned recovery still fills this one slot.
        if (slot === 'original') {
          if (repliesTo === undefined) {
            return message.needsReply === true ? associateReply(owned, message.ref, answerRef) : responded;
          }
          const target = await mailbox.readMessage(ownedInWorkspace(owned, repliesTo.workspaceId).ctx, repliesTo);
          if (target.status !== 'ready') return asRejection(target, 'the intervention message');
          return target.value.needsReply === true ? associateReply(owned, repliesTo, answerRef) : responded;
        }
        if (repliesTo === undefined) {
          return message.needsReply === true ? associateReply(owned, message.ref, answerRef) : responded;
        }
        // §5.2.4: R's end is not M's reply. M's one slot may hold an earlier answer, and R still ends; M goes first so
        // a crash between the two re-offers R and replays M. Only a source written `needsReply:true` has that slot
        // (design 2.4/2.6); a no-slot M is skipped without a write and R follows its own slot rule.
        const target = await mailbox.readMessage(ownedInWorkspace(owned, repliesTo.workspaceId).ctx, repliesTo);
        if (target.status !== 'ready') return asRejection(target, 'the intervention message');
        if (target.value.needsReply === true) {
          const replied = await associateReply(owned, repliesTo, answerRef);
          if (replied.status === 'rejected' && replied.code !== 'source_stale') return replied;
        }
        return message.needsReply === true ? associateReply(owned, message.ref, answerRef) : responded;
      }

      /**
       * One reply write: the same answer replays as `responded`, any other existing reply is `source_stale`. The reply
       * is read and written where its message lives.
       */
      async function associateReply(caller: Owned, replyRef: SessionMessageRef, answerRef: QueryJobAnswerRef):
      Promise<HandleInterventionResultV1> {
        const owned = ownedInWorkspace(caller, replyRef.workspaceId);
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
       * inherits the original Query's value and falls back to the lineage root, except an answered person's card
       * (it only locates the original round); a `planfix:` names its lineage
       * root only when that root is an executor message (not this round's R and not a Host system round). Every
       * other message adds no field and makes no read.
       */
      async function plannedRepliesTo(owned: Owned, message: SessionMessage):
      Promise<{ status: 'ready'; value: SessionMessageRef | undefined } | CoreRejection> {
        const head = trusted;
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
          if (previous !== undefined) return { status: 'ready', value: previous };
          // An answered person's card is the source that opened the card-answer round, not a reply target: its one
          // response slot already holds the answer. The card reference only locates the original round.
          const root = lineage.value.rootMessage;
          const rootRead = await mailbox.readMessage(ownedInWorkspace(owned, root.workspaceId).ctx, root);
          if (rootRead.status !== 'ready') return asRejection(rootRead, 'the planning source lineage root');
          const answeredCard = rootRead.value.decision !== undefined && rootRead.value.response !== null
            && 'decision' in rootRead.value.response;
          return { status: 'ready', value: answeredCard ? undefined : root };
        }
        const lineage = await planSourceLineageOf(owned.ctx, lineageDeps, message.ref);
        if (lineage.status !== 'ready') return asRejection(lineage, 'the planning source lineage');
        const root = lineage.value.rootMessage;
        if (sessionMessageRefKey(root) === sessionMessageRefKey(message.ref)) {
          return { status: 'ready', value: undefined };
        }
        const rootRead = await mailbox.readMessage(ownedInWorkspace(owned, root.workspaceId).ctx, root);
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
      async function planBaseOf(owned: Owned, message: SessionMessage, goal: GoalSnapshot):
      Promise<{ status: 'ready'; base: PlanRevisionSnapshot | PlanRevisionDraft | null;
        basedOn: PlanRevisionRef | null } | CoreRejection> {
        const head = trusted;
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
        input: Extract<InterventionInput, { completion?: undefined | 'settle_existing' }>, message: SessionMessage,
        goal: GoalSnapshot, text: string, planningOnly: boolean,
        part: 'message' | 'decision_answer'):
      Promise<HandleInterventionResultV1> {
        const key = sessionMessageRefKey(message.ref);
        // `owned` is the Goal's workspace: the Query is submitted, claimed and driven there, on the line's Session.
        const refs = interventionPlanningQueryRefs(message.ref, owned.workspaceId, part);
        const proposalRef = interventionProposalRefOf(message.ref, owned.workspaceId, goal.ref.goalId, part);
        // Stage 8: the deterministic Query. A re-run finds the pending pair and continues it.
        const existing = await queryOwner.readQueryJob(owned.ctx, refs.queryJobRef);
        if (existing.status !== 'ready' && existing.status !== 'not_found') {
          return asRejection(existing, 'the intervention planning Query');
        }
        if (existing.status === 'not_found') {
          if (input.completion === 'settle_existing') return { status: 'queued', reason: 'no_task' };
          // A new round's submit shape is frozen from the trusted round (only an already accepted `SystemRoundV1`),
          // the gate's saved overlap-note, the recipient line's duty and the person's B20 entry; the body head gives
          // nothing. The gate is read only here: a gate that later changes its basis clears its current
          // `noteRequest`, never the shape and gate proof an existing round froze.
          let overlapNote = false;
          if (trusted === null && message.sender.kind === 'host' && message.sender.actor.kind === 'system') {
            const note = await overlapNoteOf(messageOwned.ctx, { plans, gates: deps.workflow.overlap }, message);
            if (note.status !== 'ready') return asRejection(note, 'the overlap gate note');
            overlapNote = note.value !== null;
          }
          const answerShape: PlanningAnswerShapeV1 = duty === null ? 'text'
            : planningAnswerShapeOf(message, duty, trusted, overlapNote, person);
          const registration = await projects.readWorkspaceRegistration(owned.ctx,
            { projectId: owned.projectId, workspaceId: owned.workspaceId });
          if (registration.status !== 'ready') {
            return asRejection(registration, 'the Project/Workspace registration');
          }
          const repliesTo = await plannedRepliesTo(owned, message);
          if (repliesTo.status === 'rejected') return repliesTo;
          const intent: QueryJobIntentV1 = {
            schemaVersion: 1, intentId: refs.queryJobRef.queryJobId,
            projectId: owned.projectId, workspaceId: owned.workspaceId, goalId: goal.ref.goalId,
            question: text, focusTaskRefs: [], budget: input.budget, multiTurn: { maxRounds: 1 },
            correlationId: `intervention:${refs.queryRunRef.runId}`,
            execution: { kind: 'intervention_planning', sourceMessageRef: { ...message.ref }, answerShape,
              sourceSender: sourceSenderOf(message),
              ...(part === 'decision_answer' ? { sourcePart: 'decision_answer' as const } : {}),
              ...(repliesTo.value === undefined ? {} : { repliesToMessageRef: { ...repliesTo.value } }),
              ...(overlapNote ? { overlapNote: true as const } : {}),
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
        // An existing round keeps the shape it was submitted with: its continuation and its settlement read the
        // frozen `answerShape` (and preparation/execution the frozen `overlapNote`), never the current classification.
        const answerShape: PlanningAnswerShapeV1 = record.job.job.intent.execution.answerShape ?? 'text';
        if (record.job.job.status !== 'answered' && !queryRunEndedWithoutAnswer(record)) {
          if (input.completion === 'settle_existing') return { status: 'queued', reason: 'no_task' };
          const phase = record.run.run.executionState?.phase;
          if (phase === undefined) {
            // A plain Query is claimed by the caller that chose its line; one claim, then the driver drives it.
            const card = await sessions.readSession(lineOwned.ctx,
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
        if (answerShape === 'scribe_review') return settleCommandReview(owned, message, record);
        // G8B B1e：批检查轮在同一趟里结束时也由平台落实结论（同书记审查），不走下面的回答出口。
        if (answerShape === 'check_review') return settleCheckReview(owned, record);
        // Stage 9: the answer through the narrow intervention source.
        const answerRef = record.job.job.answerRefs.at(-1);
        // A formally ended Query with no saved Answer is the third ending: the Host sends the one fixed notice
        // and withdraws the stale source. Only this proven end reaches it; every read/version failure above returned.
        if (answerRef === undefined) {
          const closeReason = record.job.job.closeReason;
          return { status: 'no_answer', branch: 'no_task',
            ...(endedOnPurposeBeforeEntry(closeReason) ? { notStarted: closeReason!.message } : {}) };
        }
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
        // takes the existing `no_answer` close-out, whose fixed notice covers the missing conclusion. An adviser's
        // unknown-call round closes the same way (009: the round is read-only, the Workflow reads its answer).
        if (duty === 'reviewer' || answerShape === 'unknown_call_advice' || answerShape === 'command_rerun_advice') {
          const reply = planningReplyTextOf({
            shape: facts.value.job.job.intent.execution.answerShape ?? 'text',
            answerText: facts.value.answerText,
            queryJobId: facts.value.job.job.queryJobId,
          });
          if (reply === null) return { status: 'no_answer', branch: 'no_task' };
          return { status: 'answer_ready', branch: 'no_task', answerRef: { ...answerRef }, reason: 'answered' };
        }
        // A text round settles communication only: the formal answer becomes the one reply, and it is never parsed
        // as a plan (design 2.3). Only a planning shape may write a candidate.
        if (answerShape !== 'plan_round') {
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
        // 121-136: the plan's own checks travel on the candidate; the person's adoption installs them.
        const answerChecks = parsed.response.kind === 'plan' ? parsed.response.checks : undefined;
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
          const basis = await planBaseOf(owned, message, goal);
          if (basis.status === 'rejected') return basis;
          let draft: PlanRevisionDraft;
          if (basis.base === null) {
            draft = normalized.draft;
          } else {
            const { origin: _segmentOrigin, ...segment } = normalized.draft;
            // The segment is in the Goal workspace's frame: the base goes back to it, the propose qualifies once.
            const merged = mergeStageRefinement(
              planInCallerView(basis.base, owned.workspaceId, facts.value.mainWorkspaceId),
              { ...segment, planRevision: targetPlanRevision });
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
              requestRef: { ...refs.queryJobRef }, sourceMessageRef: { ...message.ref },
              ...(part === 'decision_answer' ? { sourcePart: 'decision_answer' as const } : {}),
              ...(answerChecks === undefined ? {} : { checks: answerChecks }) },
            meta: { requestId: interventionProposalRequestIdOf(message.ref, part),
              expected: [{ ref: goal.ref, revision: goal.revision }] },
          });
          if (proposed.status !== 'committed') return refusedPlan(proposed);
          // The planning branch writes the candidate and returns; adoption belongs to the goal loop. The Host's
          // closing associates the answer to R after this stage (L's wiring).
          return { status: 'progressed', branch: 'no_task', stage: 'proposal' };
        }
        const proposal = proposalRead.value;
        const repliesTo = record.job.job.intent.execution.repliesToMessageRef;
        // The fourth ending (A12): a replacement is not the person's decline. The candidate chain (formal replacement
        // edges and verified `planfix:` successors) decides the ending, read the same way as the consumable view.
        if (proposal.status === 'not_adopted') {
          return chainEndingOf(owned, message, part, answerRef, proposal, repliesTo, true, false);
        }
        if (planningOnly || input.completion === 'settle_existing') {
          // The planning branch never adopts or claims: an accepted candidate only needs its reply, and a pending
          // (or now stale) one is the `candidate` close-out of the same already-written candidate, unless a verified
          // successor already ended its chain.
          return chainEndingOf(owned, message, part, answerRef, proposal, repliesTo, true, false);
        }
        if (proposal.status !== 'accepted') {
          // Stage 11: the first plan is the person's; a later refinement follows the autonomy level.
          const first = goal.activePlanRevision === null;
          const automatic = decisionActionPolicy({ autonomy: goal.settings.autonomy,
            action: 'refine_future', actorClass: 'system', countedNext: null, cap: 0 }) === 'automatic';
          if (first || !automatic) {
            return { status: 'awaiting_decision', branch: 'no_task', proposalRef: { ...proposalRef } };
          }
          // G8B B1b：带新检查的先请批；发出批准轮、等批或交人都是等决定，批准轮的收尾采用它。
          if (deps.checkApproval !== undefined) {
            const approval = await deps.checkApproval.request(owned, { candidate: proposal, goal, authorDuty: duty });
            if ('status' in approval) return approval;
            if (approval.kind === 'send') {
              const refused = await deps.checkApproval.send(owned, approval);
              if (refused !== null) return refused;
            }
            if (approval.kind !== 'none') {
              return { status: 'awaiting_decision', branch: 'no_task', proposalRef: { ...proposalRef } };
            }
          }
          // 2.5a A13: this automatic adoption goes through the one Workflow wrapper too.
          const adopted = await autoAdoptCandidate(owned, deps.workflow, {
            input: { proposalRef: { ...proposalRef }, expectedProposalRevision: proposal.revision,
              decisionRefs: [] },
            meta: { requestId: `intervention:${key}:adopt`, expected: [
              { ref: goal.ref, revision: goal.revision },
              { ref: proposalRef, revision: proposal.revision },
            ] },
          });
          // A refusal another pass could change is retried; any other refusal (a candidate that brings a check not
          // installed yet, 121-136 A4, or another rule only a person's adoption meets) leaves it to the person's card.
          // A13's card and an unreadable author/base are the same card, with no adoption.
          if (adopted.status !== 'adopted') {
            return adopted.status === 'refused' && PROPOSE_RETRIED_CODES.has(adopted.result.code)
              ? adopted.result
              : { status: 'awaiting_decision', branch: 'no_task', proposalRef: { ...proposalRef } };
          }
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
        const card = await sessions.readSession(lineOwned.ctx,
          { projectId: line.projectId, sessionId: line.sessionId });
        if (card.status !== 'ready') return asRejection(card, 'the intervention Session');
        const base: Base = { goalRef: { ...fresh.ref }, flowId: '', sessionHint: line,
          actor: owned.actor, taskId: task.taskId, failedCardRefs: [] };
        const claimed = await deps.claimIntervention(owned, base, fresh, graph.value.plan,
          task, row, card.value, input.messageRef);
        if ('status' in claimed) return claimed;
        return { status: 'claimed', branch: 'no_task', claim: claimed.claim };
      }
    },
  };
}
