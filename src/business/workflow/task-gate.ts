import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../contracts/dispatch.js';
import type { AggregateRef, GoalSnapshot } from '../../contracts/ledger.js';
import { revisionAssignments, type DependencyRequirement, type PlanRevisionRef, type PlanRevisionSnapshot, type RuntimeTask } from '../../contracts/plan.js';
import type { VersionPin } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { canonicalJson, sameJson as sameCanonical, type JsonValue } from '../../contracts/fingerprint.js';
import { rejected as rejection } from '../../contracts/core/rejections.js';
import { isRecord } from '../../contracts/validation/common.js';
import { decisionSourceKey, type DecisionSourceV1, type UserDecisionBodyV1 } from '../../contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type { TaskGraph, TaskRow } from '../../core/work-graph/model/plan-contracts.js';
import type { TaskInputUpstreamV1, TaskInputUpstreamsV1 } from '../../core/work-graph/model/context-input-contracts.js';
import { lastHolderOf } from '../../core/work-graph/state/unknown-call-review.js';
import { automationConfirmationCause } from '../../core/work-graph/state/decision-policy.js';
import { reverifyExemptionOfFacts, successorAutoCount } from '../../core/work-graph/state/verification-machine.js';
import { isUnenteredReviewRoundForCancellation, reviewRoundEndedKnown } from '../../core/work-graph/state/review-lease.js';
import type {
  GoalWaitBasisV1, WorkflowAdvanceResult, WorkflowOperation, WorkflowSessionRequeue, WorkflowSessionReview,
} from './contracts.js';
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
      decisionSource?: DecisionSourceV1;
      waitBasis?: GoalWaitBasisV1 }
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
    'unknownCallReviews' | 'sourceAuthority' | 'decisionMessages' | 'runtime' | 'claims' | 'evidence' | 'plans'
    | 'taskInputs' | 'decisionReads'>;
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
  taskBlocks(owned: Owned, base: Base, config: WorkflowHostConfiguration, goal: GoalSnapshot,
    graph: TaskGraph, ordered: readonly RuntimeTask[]): Promise<ReadResult<TaskBlocksV1>>;
  gatePerform(owned: Owned, base: Base, operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null>;
};

/**
 * One L46 block (§3.13 item 1): the card that holds one Task's own automatic rework.
 */
export type L46BlockV1 = {
  /** The Task the card stands on (the branch root). */
  task: TaskTriple;
  /** The ready `waiting` result the existing gate returns for this Task, verbatim (reason + `decisionCause`). */
  gate: Extract<WorkflowAdvanceResult, { status: 'ready' }>;
  /** What the driver registers (§3.8 item 2): the card's source kinds plus `Goal`. */
  wakeBasis: GoalWaitBasisV1;
  /** The rework the card gates; the all-blocked reason names it. */
  action: 'system_requeue' | 'auto_reverify';
};

/** One Task waiting behind a block, directly or through the exact-input closure. */
export type L46WaitV1 = {
  block: L46BlockV1;
  /** The waiting Task itself (equal to `block.task` for the block's own Task). */
  task: TaskTriple;
  /** A named dependent's reason; the root returns `block.gate` verbatim. */
  reason: string;
};

export type TaskBlocksV1 = {
  blocks: readonly L46BlockV1[];
  waiting: ReadonlyMap<string, L46WaitV1>;
};

/** One formal dependency edge (§3.13 item 2). `environment-revision` is never one: it is a workspace input. */
export type FormalDependencyEdgeV1 = {
  consumerTaskId: string; upstreamTaskId: string;
  kind: 'output-contract' | 'artifact' | 'decision' | 'gate-result';
};

const FORMAL_DEPENDENCY_KINDS: ReadonlySet<DependencyRequirement['kind']> =
  new Set(['output-contract', 'artifact', 'decision', 'gate-result']);

/** The ONE table (row G-L46-rules): every formal kind, the workspace exclusion, the legacy exact artifact, the
 *  soft relations never read. Pure; no business scenario re-proves it. */
export function formalDependencies(rows: readonly TaskRow[],
  upstreams: TaskInputUpstreamsV1 | null): FormalDependencyEdgeV1[] {
  const seen = new Set<string>();
  const edges: FormalDependencyEdgeV1[] = [];
  const add = (consumerTaskId: string, upstreamTaskId: string,
    kind: FormalDependencyEdgeV1['kind']): void => {
    const key = `${consumerTaskId}\n${upstreamTaskId}`;
    if (seen.has(key) || consumerTaskId === upstreamTaskId) return;
    seen.add(key);
    edges.push({ consumerTaskId, upstreamTaskId, kind });
  };
  const goalOf = new Map(rows.map(row => [row.ref.taskId, row.ref.goalId] as const));
  for (const row of rows) {
    for (const edge of row.legacyDependencies) {
      if (!FORMAL_DEPENDENCY_KINDS.has(edge.requires.kind)) continue;
      add(row.ref.taskId, edge.dependsOnId, edge.requires.kind as FormalDependencyEdgeV1['kind']);
    }
    // `row.relations` (`coordination`, `expected_dependency`) is deliberately never read: advisory, never a gate.
  }
  for (const entry of upstreams?.upstreams ?? []) {
    if (goalOf.get(entry.consumerTaskId) !== entry.upstream.goalId) continue;
    add(entry.consumerTaskId, entry.upstream.taskId, 'artifact');
  }
  return edges;
}

/** The transitive closure over the table: every Task reachable from a block is one wait row. Pure. */
export function closeBranches(edges: readonly FormalDependencyEdgeV1[], blocks: readonly L46BlockV1[],
  taskOf: (taskId: string) => TaskTriple | undefined): Map<string, L46WaitV1> {
  const consumers = new Map<string, string[]>();
  for (const edge of edges) {
    const list = consumers.get(edge.upstreamTaskId);
    if (list === undefined) consumers.set(edge.upstreamTaskId, [edge.consumerTaskId]);
    else if (!list.includes(edge.consumerTaskId)) list.push(edge.consumerTaskId);
  }
  const waiting = new Map<string, L46WaitV1>();
  for (const block of blocks) {
    waiting.set(block.task.taskId,
      { block, task: block.task, reason: block.gate.value.reason ?? 'automation_confirmation_required' });
  }
  let frontier = [...waiting.keys()];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const upstreamTaskId of frontier) {
      const cause = waiting.get(upstreamTaskId)!;
      for (const consumerTaskId of consumers.get(upstreamTaskId) ?? []) {
        if (waiting.has(consumerTaskId)) continue;
        const task = taskOf(consumerTaskId);
        if (task === undefined) continue;
        waiting.set(consumerTaskId, { block: cause.block, task,
          reason: `l46_dependency_blocked: the Task ${consumerTaskId} waits on ${cause.block.task.taskId}` });
        next.push(consumerTaskId);
      }
    }
    frontier = next;
  }
  return waiting;
}

export function goalWaitBasisOf(goal: GoalSnapshot, reasons: readonly string[],
  recordKinds: readonly AggregateRef['aggregateType'][]): GoalWaitBasisV1 {
  return { projectId: goal.ref.projectId, goalId: goal.ref.goalId, recordKinds, reasons };
}

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
    // a requeue already covering this failure means the action was committed;
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
    // past the automatic cap the existing fence
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
    // §3.3 line 629: a Run is a STORED aggregate, so its pin must be
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
      waitBasis: goalWaitBasisOf(goal, [`automation_confirmation:${action}`], ['UserDecision', 'Goal']),
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

  /** §3.13 items 1–2: one pass over the candidates; the direct block is the SAME `automationConfirmation` result the
   *  loop used to return, and the closure is over the one table. A read failure is a failure. */
  async function taskBlocks(owned: Owned, base: Base, config: WorkflowHostConfiguration, goal: GoalSnapshot,
    graph: TaskGraph, ordered: readonly RuntimeTask[]): Promise<ReadResult<TaskBlocksV1>> {
    let upstreams: TaskInputUpstreamsV1 | null = null;
    if (deps.taskInputs !== undefined && graph.tasks.some(row => row.inputRequirements.length > 0)) {
      const read = await deps.taskInputs.readInputUpstreams(owned.ctx, { goalRef: goal.ref, planRef: graph.plan.ref });
      if (read.status !== 'ready') return read;
      upstreams = read.value;
    }
    const blocks: L46BlockV1[] = [];
    for (const task of ordered) {
      if (task.taskKind !== 'work' || task.disposition !== 'active' || task.executionIntent === 'plan_only') continue;
      const row = graph.tasks.find(candidate => candidate.ref.taskId === task.taskId);
      if (row === undefined) continue;
      const rework = automaticRequeue(config, owned, base, goal, graph.plan, task, row) ?? automaticReverify(base, row);
      if (rework === null) continue;
      const gated = await automationConfirmation(base, goal, row, rework);
      if (gated === null) continue;
      if (gated.status !== 'ready') return gated;
      // §3.13 item 4 (book :805–:807): the card's own terminal state releases the block in this same pass —
      // applied, rejected (`answered_no_application`) or closed because its source became invalid. A waiting card
      // and a formal answer not yet applied still block. `readDecisionCard` is the one card read; the source is the
      // gate's own (`automationConfirmation`'s `decisionCause.source`).
      const source = gated.value.decisionCause?.source;
      if (deps.decisionReads !== undefined && source !== undefined) {
        const card = await deps.decisionReads.readDecisionCard(owned.ctx, { source });
        if (card.status === 'not_found') continue;
        if (card.status === 'rejected') return card;
        if (card.status !== 'ready') {
          return rejection('incomplete', 'the block card is not ready at the required watermark');
        }
        if (card.value.state === 'applied' || card.value.state === 'answered_no_application'
          || card.value.state === 'closed') continue;
      }
      blocks.push({ task: row.ref, gate: gated,
        action: rework.kind === 'requeue_task' ? 'system_requeue' : 'auto_reverify',
        // The gate already composed this basis; take it as-is.
        wakeBasis: gated.value.waitBasis! });
    }
    const table = formalDependencies(graph.tasks, upstreams);
    const waiting = closeBranches(table, blocks,
      (taskId) => graph.tasks.find(candidate => candidate.ref.taskId === taskId)?.ref);
    return { status: 'ready', value: { blocks, waiting } };
  }

  /** The `perform` half of the shared policy: recover the row by Task or round. */
  async function gatePerform(owned: Owned, base: Base,
    operation: WorkflowOperation): Promise<WorkflowAdvanceResult | null> {
    if (operation.kind !== 'requeue_task' && operation.kind !== 'reverify_round') return null;
    // a malformed perform request is
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
      catch { return waiting(null, 'unknown_call_review_unreadable: the review record read failed; the requeue writes nothing',
        undefined, goalWaitBasisOf(goalRead.value.goal, ['unknown_call_review:unreadable'], ['UnknownCallReview', 'Goal'])); }
      if (read.status === 'ready') {
        const record = read.value;
        if ((record.disposition?.hold ?? null) === 'held') {
          return waiting(null, 'unknown_call_review_held: the selected Run\'s review record blocks this requeue',
            undefined, goalWaitBasisOf(goalRead.value.goal, ['unknown_call_review:held'], ['UnknownCallReview', 'Goal']));
        }
        if (record.status !== 'resolved') {
          return waiting(null, 'unknown_call_review_pending: the selected Run\'s review record blocks this requeue',
            undefined, goalWaitBasisOf(goalRead.value.goal, ['unknown_call_review:pending'], ['UnknownCallReview', 'Goal']));
        }
      } else if (read.status !== 'not_found') {
        return waiting(null, 'unknown_call_review_unreadable: the selected Run\'s review record blocks this requeue',
          undefined, goalWaitBasisOf(goalRead.value.goal, ['unknown_call_review:unreadable'], ['UnknownCallReview', 'Goal']));
      }
    }
    return await automationConfirmation(base, goalRead.value.goal, row, operation);
  }

  return { reviewGate, automaticRequeue, automaticReverify, automationConfirmation, taskBlocks, gatePerform };
}
