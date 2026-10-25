import type { RunRef, RunSnapshot, TaskBudgetV1 } from '../../contracts/dispatch.js';
import type { GoalSnapshot } from '../../contracts/ledger.js';
import { revisionAssignments, type PlanRevisionRef, type PlanRevisionSnapshot, type RuntimeTask } from '../../contracts/plan.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import { canonicalJson, sameJson as sameCanonical, type JsonValue } from '../../contracts/fingerprint.js';
import { rejected as rejection } from '../../contracts/core/rejections.js';
import { isRecord } from '../../contracts/validation/common.js';
import { decisionSourceKey, type DecisionSourceV1, type UserDecisionBodyV1 } from '../../contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type { TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import { lastHolderOf } from '../../core/work-graph/state/unknown-call-review.js';
import { automationConfirmationCause } from '../../core/work-graph/state/decision-policy.js';
import { reverifyExemptionOfFacts, successorAutoCount } from '../../core/work-graph/state/verification-machine.js';
import { isUnenteredReviewRoundForCancellation, reviewRoundEndedKnown } from '../../core/work-graph/state/review-lease.js';
import type { WorkflowAdvanceResult, WorkflowOperation, WorkflowSessionRequeue, WorkflowSessionReview } from './contracts.js';
import type { WorkflowDependencies, WorkflowHostConfiguration } from './ports.js';
import {
  cancelReviewRoundStep, graphWrite, prepareStep, readyValue, requeueTaskStep, reverifyRoundStep, settleReviewStep, waiting,
  type Base, type Binding, type Owned,
} from './workflow.js';

/**
 * K3 U4 (decision 72): one finite result per Task before any automatic rework.
 * `pass` goes on to today's selection; `skip` blocks this Task with its source
 * (for a named Task it becomes `waiting`; UR6 also carries the card's formal
 * `decisionSource`); `review` carries the one review step to perform
 * (`claim_task{review}`, `close_open_turn`, `create_session{review}` or
 * `settle_review`). UR8 (`held`) is built here; UR3h and UR7/UR7b are left to
 * session A's other parts / session B.
 */
export type TaskGateSource = 'review_unreadable' | 'review_round_in_flight' | 'review_round_unknown' | 'review_session_busy'
  | 'review_binding_missing' | 'held' | 'needs_decision' | 'awaiting_approval'
  /** K3-46: this advance already failed this card's ②; never select it again in the same advance. */
  | 'review_application_failed';
export type TaskGate =
  | { kind: 'pass' }
  | { kind: 'skip'; source: TaskGateSource;
      /** K3 UR6/ruling 6: the review card's formal source when one is blocked on. */
      decisionSource?: DecisionSourceV1 }
  | { kind: 'review'; step: WorkflowOperation };
/** The internal UR1 Session-selection outcome (not part of the finite gate union). */
export type ReviewGate =
  | TaskGate
  | { kind: 'waiting'; reason: string }
  | { kind: 'rejection'; rejection: CoreRejection };

export type TaskGateDependencies = {
  /** createWorkflow's own deps object, the same reference (never spread or copied): the bodies read
   *  `deps.<port>` at call time, and the composition may set a field later (X/create-platform.ts:2446). */
  workflow: Pick<WorkflowDependencies,
    'unknownCallReviews' | 'sourceAuthority' | 'decisionMessages' | 'runtime' | 'claims' | 'evidence' | 'plans'>;
  bindingForRole(config: WorkflowHostConfiguration, projectId: string, workspaceId: string, role: string): Binding | null;
  isUnadmittedStarting(owned: Owned, runRef: RunRef): Promise<boolean>;
  claimContinuation(owned: Owned, base: Base, goal: GoalSnapshot, planRef: PlanRevisionRef, task: RuntimeTask,
    row: TaskRow, binding: Binding, afterRunRef: RunRef,
    continuation: { requeue?: WorkflowSessionRequeue; review?: WorkflowSessionReview }): Promise<WorkflowAdvanceResult | null>;
};
export type TaskGateFunctions = {
  reviewGate(owned: Owned, base: Base, config: WorkflowHostConfiguration, goal: GoalSnapshot,
    plan: PlanRevisionSnapshot, task: RuntimeTask, row: TaskRow): Promise<ReviewGate>;
  automaticRequeue(config: WorkflowHostConfiguration, owned: Owned, base: Base, goal: GoalSnapshot,
    plan: PlanRevisionSnapshot, task: RuntimeTask, row: TaskRow): WorkflowOperation | null;
  automaticReverify(base: Base, row: TaskRow): WorkflowOperation | null;
  automationConfirmation(base: Base, goal: GoalSnapshot, row: TaskRow,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null>;
  gatePerform(owned: Owned, base: Base, operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null>;
};

export function createTaskGate(gate: TaskGateDependencies): TaskGateFunctions {
  const deps = gate.workflow;
  const { bindingForRole, isUnadmittedStarting, claimContinuation } = gate;

  /**
   * K3 §3.4 UR table (U4, decision 72): the one finite result per Task,
   * evaluated before `automaticRequeue`. The record read is fail-closed (UR0);
   * the round's Run is read through the source authority and classified
   * starting (UR3a) / in flight (UR3) / ended (UR4) / unknown (UR5). UR3h, UR6,
   * UR7, UR7b and UR8 are group 4: a `held` record or a decided status falls
   * through here and the owner guards still block the claim.
   */
  async function reviewGate(
    owned: Owned, base: Base, config: WorkflowHostConfiguration, goal: GoalSnapshot,
    plan: PlanRevisionSnapshot, task: RuntimeTask, row: TaskRow,
  ): Promise<ReviewGate> {
    const port = deps.unknownCallReviews;
    if (port === undefined || row.execution === null) return { kind: 'pass' };
    let read;
    try { read = await port.readReview(owned.ctx, { runRef: row.execution }); }
    catch { return { kind: 'skip', source: 'review_unreadable' }; }
    if (read.status === 'not_found') return { kind: 'pass' };
    if (read.status !== 'ready') return { kind: 'skip', source: 'review_unreadable' };
    const review = read.value;
    // K3 UR7 rework 1: one card whose ② already failed in this continuous
    // selection is never selected again; the discriminated set comes in as
    // `advanceWork`'s internal third argument and goes out beside `next`.
    if (base.failedCardRefs.some(card => card.kind === 'unknown_call_review'
      && canonicalJson(card.reviewRef as unknown as JsonValue) === canonicalJson(review.ref as unknown as JsonValue))) {
      return { kind: 'skip', source: 'review_application_failed' };
    }
    const active = review.activeRound;
    if (active !== null) {
      const runRead = await deps.sourceAuthority.load(active.runRef);
      const run = runRead.status === 'found' && isRecord(runRead.snapshot)
        && 'status' in runRead.snapshot ? runRead.snapshot as unknown as RunSnapshot : null;
      if (run === null) return { kind: 'skip', source: 'review_round_unknown' };
      const held = review.disposition?.hold === 'held';
      // UR3h (L21, M1): a held record whose round was claimed but never entered
      // (including paused before entry) is cancelled. UR8 is a later row, so a
      // held record whose round ended still reaches UR4 and is settled.
      if (held && isUnenteredReviewRoundForCancellation(run, active.runRef)) {
        return { kind: 'review', step: cancelReviewRoundStep(base, run) };
      }
      // UR3a: claimed but never entered -> prepare with the SAME claim, then start.
      // A `starting` Run that is NOT the one recoverable unadmitted execution
      // (paused, entered, another phase) is already in flight and is skipped.
      // A held round is never started; only its (unentered) cancel above applies.
      if (run.status === 'starting') {
        if (held) return { kind: 'skip', source: 'held' };
        return await isUnadmittedStarting(owned, active.runRef)
          ? { kind: 'review', step: { kind: 'prepare', request: prepareStep(base, active.runRef) } }
          : { kind: 'skip', source: 'review_round_in_flight' };
      }
      // UR3: entered or running (including a person's safe-point pause).
      if (run.status === 'running') return { kind: 'skip', source: 'review_round_in_flight' };
      // UR5/UR4 (item C): one "known end" rule; an unknown outcome waits.
      if (!reviewRoundEndedKnown(run)) return { kind: 'skip', source: 'review_round_unknown' };
      // UR4: any known end (completed, crashed, failed, cancelled, budget, yielded).
      return { kind: 'review', step: settleReviewStep(base, review, 'round_ended') };
    }
    // UR8 (L11): a `resolved`+held record is "I will handle it"; skip (AV-4c).
    if (review.disposition?.hold === 'held') return { kind: 'skip', source: 'held' };
    // UR7 (L19, L29 row 5): a card that is already answered applies its
    // disposition first; only an unanswered card reaches today's UR6 skip.
    // The current card's canonical source uses the record's CURRENT revision;
    // the saved answer's own captured source/selection is authoritative, so ②
    // replays by the answer-derived identity whatever an earlier answer said.
    if (review.status === 'needs_decision' || review.status === 'awaiting_approval') {
      const source: DecisionSourceV1 = {
        kind: 'unknown_call_review',
        key: decisionSourceKey({ kind: 'unknown_call_review', reviewRef: review.ref, revision: review.revision }),
        subject: { kind: 'goal', goalRef: goal.ref },
        pins: [{ ref: review.ref, revision: review.revision }],
      };
      let solved: { message: SessionMessage; body: UserDecisionBodyV1 } | null = null;
      if (deps.decisionMessages !== undefined) {
        try {
          const read = await deps.decisionMessages.readDecisionAnswer(owned.ctx, { source });
          if (read.status !== 'ready') return { kind: 'skip', source: 'review_unreadable' };
          if (read.value.message !== null && read.value.body !== null
            && read.value.body.selection.kind === 'option') {
            solved = { message: read.value.message, body: read.value.body };
          }
        } catch {
          return { kind: 'skip', source: 'review_unreadable' };
        }
      }
      if (solved !== null) {
        // L19's ② guard compares the caller's source pins/subject with the
        // saved answer's CAPTURED source (record@revision, original Run, Goal
        // content basis). The request therefore carries that captured source,
        // not the minimal lookup source built above, or a real owner would
        // refuse it `invalid`.
        const response: unknown = solved.message.response;
        const captured = isRecord(response) && isRecord(response['decision']) && isRecord(response['decision']['source'])
          ? response['decision']['source'] as unknown as DecisionSourceV1 : source;
        const expected = Array.isArray(captured.pins)
          ? captured.pins as VersionPin[] : [{ ref: review.ref, revision: review.revision }];
        return { kind: 'review', step: { kind: 'apply_review_disposition', request: graphWrite(base,
          'apply_review_disposition',
          { source: captured, selection: solved.body.selection, decisionMessageRef: solved.message.ref },
          [...expected]) } };
      }
      // UR6 (L11): no answer yet — the card waits for the user; a named Task
      // waits with the card's formal source.
      return { kind: 'skip', source: review.status, decisionSource: source };
    }
    if (review.status !== 'pending_review' && review.status !== 'awaiting_proposal') return { kind: 'pass' };
    // UR1/UR2: no active round, the record still awaits a round. R3: the
    // capability takes the binding's Role, exactly as the round's prepare/start will.
    // B2: the assignment/binding is looked up ONCE here; a missing binding never
    // falls through to the ordinary selection and never settles `review_unavailable`
    // (a missing model binding does not prove the read-only command unusable), so
    // the named Task waits with `review_binding_missing` and the record stays.
    const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === task.taskId);
    const binding = assignment === undefined ? null
      : bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
    if (binding === null) return { kind: 'skip', source: 'review_binding_missing' };
    const capability = deps.runtime.reviewCapability;
    let available = false;
    if (capability !== undefined) {
      try {
        available = (await capability.call(deps.runtime, owned.ctx, {
          workspace: { projectId: owned.projectId, workspaceId: goal.workspaceRef.workspaceId },
          role: binding.sessionRole,
        })).status === 'available';
      } catch { available = false; }
    }
    if (!available) return { kind: 'review', step: settleReviewStep(base, review, 'review_unavailable') };
    return await planReviewRound(owned, base, goal, plan, task, row, review, binding);
  }

  /**
   * K3 §3.4 UR1 (L12/L13): open the round in the record's last holder's Session
   * (close a dangling Turn / create the continuation Session / claim), with
   * `afterRunRef = lastHolderOf(record)` and the review budget. B2: the caller
   * looked the binding up once and passes it in; this function has no missing
   * binding branch.
   */
  async function planReviewRound(
    owned: Owned, base: Base, goal: GoalSnapshot,
    plan: PlanRevisionSnapshot, task: RuntimeTask, row: TaskRow, review: UnknownCallReviewV1,
    binding: Binding,
  ): Promise<ReviewGate> {
    const afterRunRef = lastHolderOf(review);
    // L13: the review round takes the binding's model; the token budget is the
    // smaller of the binding's and 200,000; the deadline is the binding's.
    const budget: TaskBudgetV1 = { ...binding.budget, tokenBudget: Math.min(binding.budget.tokenBudget, 200_000) };
    const sessionReview: WorkflowSessionReview = {
      reviewRef: review.ref, expectedRevision: review.revision,
      phase: review.status === 'awaiting_proposal' ? 'proposal' : 'review', afterRunRef, budget,
    };
    const claimed = await claimContinuation(owned, base, goal, plan.ref, task, row, binding, afterRunRef,
      { review: sessionReview });
    if (claimed === null) return { kind: 'skip', source: 'review_session_busy' };
    if (claimed.status !== 'ready') return { kind: 'rejection', rejection: claimed };
    if (claimed.value.state !== 'advance' || claimed.value.next === null || claimed.value.next.kind !== 'perform') {
      return { kind: 'waiting', reason: claimed.value.reason ?? 'the review continuation selected no step' };
    }
    return { kind: 'review', step: claimed.value.next.operation };
  }

  /**
   * C8 (§4.3 "Workflow", §15.2 5.8): the automatic requeue a work Task's
   * verdict asks for, or `null`. `requeue` (AV-12) requeues with no budget;
   * `stopped/budget_exhausted` (AV-11) requeues only with the Task's binding
   * budget when that is larger than the exhausted one (§13.4 #19), and the
   * claim then carries it (TASK-03). Every other verdict, and a Host whose
   * claim owner publishes no `requeueTask`, requeues nothing. The verdict is an
   * admissibility fact; the owner judges the request again (C8).
   */
  function automaticRequeue(
    config: WorkflowHostConfiguration, owned: Owned, base: Base, goal: GoalSnapshot, plan: PlanRevisionSnapshot,
    task: RuntimeTask, row: TaskRow,
  ): WorkflowOperation | null {
    const failure = row.failure;
    if (deps.claims.requeueTask === undefined || failure === undefined
      || failure.runRef === null || failure.runRevision === null) return null;
    const verdict = failure.automation.verdict;
    if (verdict.kind === 'requeue') {
      return requeueTaskStep(base, goal, row.ref, failure, failure.runRef, failure.runRevision, verdict.failureClass, null);
    }
    if (verdict.kind !== 'stopped' || verdict.reason !== 'budget_exhausted' || failure.failureClass === null) return null;
    const exhausted = verdict.detail.minTokenBudgetExclusive;
    const assignment = revisionAssignments(plan).find((candidate) => candidate.taskId === task.taskId);
    const binding = assignment === undefined ? null
      : bindingForRole(config, owned.projectId, goal.workspaceRef.workspaceId, assignment.role);
    if (exhausted === undefined || binding === null || binding.budget.tokenBudget <= exhausted) return null;
    return requeueTaskStep(base, goal, row.ref, failure, failure.runRef, failure.runRevision, failure.failureClass,
      binding.budget);
  }

  /**
   * C5 (§4 AV-7d, §15.2 5.9): the automatic successor round a work Task's
   * `reverify` verdict asks for on its finalized chain head, or `null`. With
   * `needsFinalize` (FC-13) the open head is finalized by the round chain
   * first and the next selection reverifies; a Host whose evidence owner
   * publishes no `reverifyRound` reverifies nothing. The owner judges the
   * request again (C8).
   */
  function automaticReverify(base: Base, row: TaskRow): WorkflowOperation | null {
    const failure = row.failure;
    if (deps.evidence.reverifyRound === undefined || failure === undefined) return null;
    const verdict = failure.automation.verdict;
    if (verdict.kind !== 'reverify' || verdict.needsFinalize) return null;
    return reverifyRoundStep(base, row.ref, failure, verdict);
  }

  /**
   * §4.5 (rule 16): the automation policy is shared by `select_work` and
   * `perform`. Before an automatic requeue/reverify the current Goal settings
   * decide; when the action needs a person the step returns a formal
   * `waiting`/`next=null` result carrying the derived source-2 cause and starts
   * nothing. `post_process`/`after_plan_confirmation` keeps the historical
   * behavior. The helper reads no clock, writes nothing and fabricates no
   * GoalPhase.
   */
  async function automationConfirmation(base: Base, goal: GoalSnapshot, row: TaskRow,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null> {
    const failure = row.failure;
    if (failure === undefined) return null;
    // Lead (accept review, known #7): a requeue already covering this failure means the action was committed;
    // the owner's original receipt decides, never a new card under a changed autonomy.
    if (operation.kind === 'requeue_task' && failure.automation.coveringRequeue !== null) return null;
    let action: 'system_requeue' | 'auto_reverify';
    let countedNext: number;
    if (operation.kind === 'requeue_task') {
      action = 'system_requeue';
      countedNext = failure.automation.requeueAutoCount + (failure.failureClass === 'interrupted' ? 0 : 1);
    } else if (operation.kind === 'reverify_round') {
      const head = failure.round;
      if (head === null) return null;
      const exemption = reverifyExemptionOfFacts({ checks: head.failingChecks, gapCodes: head.gapCodes });
      action = 'auto_reverify';
      countedNext = successorAutoCount(head.autoCount, 'system', exemption);
    } else {
      return null;
    }
    // Lead (rebase, A11 #15 / ND-7): past the automatic cap the existing fence
    // stays — the requeue/reverify owner commits its cap refusal and the Goal
    // shows that cause; the gate adds only the autonomy rule (spec §3.2
    // "countedNext>cap ... existing fences stay").
    if (countedNext > failure.automation.cap) return null;
    const settings = goal.settings;
    // §4.5 line 888 / F8: decide with the shared pure policy FIRST, before the
    // Run revision read below. Under the default `after_plan_confirmation`
    // autonomy no card is needed (`automatic_notice`), and that read must not be
    // able to refuse a step the existing owner would have performed; no card
    // needed means no new read (brief section 5, §8.2 line 1363). The probe uses
    // the same `automationConfirmationCause` with no Run revision, so it only
    // asks whether a card is derived.
    if (automationConfirmationCause({
      autonomy: settings.autonomy, action, countedNext, cap: failure.automation.cap,
      goalRef: goal.ref, taskId: row.ref.taskId, runRef: null, runRevision: null,
      // K3 L22: a review answer already confirmed this system requeue; the
      // probe and the final derivation must agree.
      requeueConfirmedByReview: failure.unknownCallReview?.requeueConfirmed ?? false,
    }) === null) return null;
    // §3.3 line 629 / defect-1: a Run is a STORED aggregate, so its pin must be
    // its formal revision, never a fabricated 0 (the §3.3 pin check would then
    // reject the card with `revision_conflict`). The failure facts of a gate
    // whose anchored producer Run was not in the read window carry a `runRef`
    // with a null `runRevision`; read that Run's formal revision through the
    // SAME source-authority reader this Workflow already uses for pins. A read
    // failure is returned (`unavailable`/`incomplete`), never folded into a
    // fabricated pin. The §4.2 source-2 reader resolves the same canonical Run
    // revision, so both entries produce the same `decisionSourceKey`.
    let runRevision = failure.runRevision;
    if (failure.runRef !== null && runRevision === null) {
      let loaded;
      try { loaded = await deps.sourceAuthority.load(failure.runRef); }
      catch { return rejection('unavailable', 'the failure Run source read failed'); }
      if (loaded.status === 'not_found') {
        return rejection('incomplete', 'the failure Run record does not exist');
      }
      if (loaded.status !== 'found') {
        return rejection(loaded.status === 'unsupported' ? 'unsupported' : 'unavailable',
          'the failure Run record is not readable');
      }
      runRevision = loaded.snapshot.revision;
    }
    // §3.3 line 629: the automation cause's affected set is the Task/Run pins of
    // the failure (a Task is not a stored aggregate, so its pin is the §2.1
    // absence revision 0). The ONE shared derivation keeps this identical to the
    // §4.2 source-2 reader's `source.key`.
    const cause = automationConfirmationCause({
      autonomy: settings.autonomy, action, countedNext, cap: failure.automation.cap,
      goalRef: goal.ref, taskId: row.ref.taskId, runRef: failure.runRef, runRevision,
      requeueConfirmedByReview: failure.unknownCallReview?.requeueConfirmed ?? false,
    });
    if (cause === null) return null;
    const goalPin: VersionPin = { ref: goal.ref, revision: goal.revision };
    // N-R2-1(a) / §2.8 line 345: every new source used for answering carries the
    // canonical content basis of the formal Goal this step read, built exactly
    // like the §4.2 source-2 reader's `basisOf` (goalRef, workspaceRef,
    // objective, activePlanRef, normalized settings). The read model resolves
    // the answer's Workspace through `goalBases[0]`. Key and pins unchanged.
    const goalBasis = {
      goalRef: goal.ref,
      workspaceRef: goal.workspaceRef,
      objective: goal.objective,
      activePlanRef: goal.activePlanRevision,
      settings: goal.settings,
    };
    return readyValue({
      state: 'waiting', receipt: null, next: null,
      reason: `automation_confirmation_required:${cause.action}`,
      decisionCause: {
        source: {
          kind: 'goal_cause',
          key: decisionSourceKey({ kind: 'goal_cause', goalRef: goal.ref, code: cause.code, affected: cause.affected }),
          subject: { kind: 'goal', goalRef: goal.ref },
          pins: [goalPin, ...cause.affected],
          goalBases: [goalBasis],
        },
        code: cause.code, taskRef: { ...row.ref }, runRef: failure.runRef,
        action: cause.action, objects: [], options: [],
      },
    });
  }

  /** The `perform` half of the shared policy: recover the row by Task or round. */
  async function gatePerform(owned: Owned, base: Base,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null> {
    if (operation.kind !== 'requeue_task' && operation.kind !== 'reverify_round') return null;
    // Lead (rebase, A2-workflow-auto-rework): a malformed perform request is
    // judged by the existing step (owner presence, input checks), never here.
    const requestInput: unknown = (operation.request as { input?: unknown } | undefined)?.input;
    if (!isRecord(requestInput)) return null;
    if (operation.kind === 'requeue_task' && !isRecord(requestInput['taskRef'])) return null;
    const goalRead = await deps.plans.queryGoal(owned.ctx, base.goalRef);
    if (goalRead.status !== 'ready') return null;
    const graphRead = await deps.plans.queryTaskGraph(owned.ctx, { goalRef: base.goalRef });
    if (graphRead.status !== 'ready') return null;
    const row = graphRead.value.tasks.find((candidate) => operation.kind === 'requeue_task'
      ? candidate.ref.taskId === operation.request.input.taskRef.taskId
      : sameCanonical(candidate.failure?.round?.roundRef, operation.request.input.predecessorRoundRef));
    if (row === undefined) return null;
    // K3 L11/§3.4 `gatePerform`: a `requeue_task` on a Task whose selected Run
    // has a record that is not `resolved` waits and writes nothing; an
    // unreadable record is fail-closed (a `not_found` record passes).
    if (operation.kind === 'requeue_task' && row.execution !== null && deps.unknownCallReviews !== undefined) {
      let read;
      try { read = await deps.unknownCallReviews.readReview(owned.ctx, { runRef: row.execution }); }
      catch { return waiting(null, 'unknown_call_review_unreadable: the review record read failed; the requeue writes nothing'); }
      if (read.status === 'ready') {
        const record = read.value;
        if ((record.disposition?.hold ?? null) === 'held') {
          return waiting(null, 'unknown_call_review_held: the selected Run\'s review record blocks this requeue');
        }
        if (record.status !== 'resolved') {
          return waiting(null, 'unknown_call_review_pending: the selected Run\'s review record blocks this requeue');
        }
      } else if (read.status !== 'not_found') {
        return waiting(null, 'unknown_call_review_unreadable: the selected Run\'s review record blocks this requeue');
      }
    }
    return await automationConfirmation(base, goalRead.value.goal, row, operation);
  }

  return { reviewGate, automaticRequeue, automaticReverify, automationConfirmation, gatePerform };
}
