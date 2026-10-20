/**
 * Host start-up reconcile (STATE-MACHINES-SPEC §12.1 steps 1..7 and the
 * start-up re-drive selection of step 6b; S8, A8; A.2 step 5.6).
 *
 * Runs once per Host start, only on the Host that holds the instance lease
 * (D-18, L-10), before any execution driver starts; a workspace the Host opens
 * later is reconciled the same way before it serves an execution:
 *
 * 1. probe the Sessions an unsettled execution occupies and every active
 *    Session whose health is not `available` (SES-12/13/19; L-8: before any
 *    Run is classified);
 * 2. classify each `Entering`/`Running` Run and each `outcome_unknown` end
 *    (RUN-16..21, RUN-23, RUN-24, W-05..W-20);
 * 3. settle each unsettled QueryRun (QRR-01..05, Q-01..Q-07);
 * 4. interrupt each `executing` check of an open round (VR-04);
 * 5. settle the queued intents a Run still carries without another end
 *    (CTL-08(a) through RUN-09..11 (R), CTL-08(d)/(e));
 * 6. re-drive the Goal fan-out (GOAL-16, GOAL-14, GOAL-29);
 * 6b. select the active Goals the start-up re-drive starts a driver for
 *    (LA-6): (a) a required active Task whose automation verdict the Workflow
 *    acts on (`requeue`, `reverify`, `claim_requeued`; W-21,
 *    RUN-19), (b) a not-entered Run the same claim re-drives (W-01..W-03);
 * 7. return the report: what moved and what was left, with the reason.
 *
 * Reconcile only reads the Kernel Store and the platform records and books
 * conclusions; it never starts a Kernel Turn, re-runs a tool or a check, or
 * resends a message. Every write is one owner commit judged by its machine; a
 * refused or failed object is reported, never skipped silently.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { HostTakeoverProofV1, UnknownCallReviewRef, UnknownCallReviewV1 } from '../contracts/unknown-call-review.js';
import type { UnknownCallReviewReadPort } from '../core/work-graph/model/unknown-call-review-contracts.js';
import type { ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { DecisionSourceV1 } from '../contracts/goal-decisions.js';
import { decisionSourceKey } from '../contracts/goal-decisions.js';
import type { SessionRecord } from '../contracts/core/session.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../contracts/ledger.js';
import type { RoundSnapshot } from '../contracts/verification.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import type { SessionMappingProbe } from '../core/agent-runtime/session-operations.js';
import type { QueryReconcileReport, RunReconcileReport } from '../core/agent-runtime/run-reconcile.js';
import type { InterruptCheckInput } from '../core/work-graph/model/evidence-contracts.js';
import type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
import type { DecisionMessagePort } from '../core/work-graph/model/decision-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type { SessionHealthResult } from '../core/work-graph/sessions/session-health.js';
import { isPendingVerdict } from '../core/work-graph/state/goal-machine.js';
import type { GraphWrite } from '../core/work-graph/model/task-contracts.js';
import type { PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
import type { ReconcileCandidateReader } from '../core/work-graph/tasks/reconcile-reads.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { WriteResult } from '../contracts/core/results.js';
import type { GoalFanOutPassOptions, GoalFanOutReportV1 } from './goal-fan-out-driver.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type { RedriveAnswerV1 } from '../business/workflow/contracts.js';
import type { UnappliedAnswersReadV1 } from '../core/work-graph/tasks/unknown-call-review-answers.js';

type Scope = { projectId: string; workspaceId: string };

/**
 * The Host's own system actor every start-up reconcile write is recorded under
 * (the R source, §12.1; VR-04: "Host system actor + hostInstanceId"), never the
 * operator configured for the Host's requests.
 */
export const HOST_RECONCILE_ACTOR = { kind: 'system', id: 'host-start-up-reconcile' } as const;

/** The platform's internal reconcile seam (`createTargetPlatform().reconcile`), restated narrowly. */
export type StartupReconcilePlatform = {
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  controls: Pick<RunControlPort, 'readControl'>;
  /** Step 6b condition (a): the Task facts and their automation verdicts, read again after steps 1..6. */
  plans: Pick<PlanTaskPort, 'queryTaskGraph'>;
  reconcile: {
    candidates: ReconcileCandidateReader;
    probe(session: SessionRecord, signal: AbortSignal): Promise<SessionMappingProbe>;
    recordSessionHealth(ctx: CoreCallContext, input: { sessionRef: { projectId: string; sessionId: string };
      probe: { verdict: SessionMappingProbe['verdict']; activeRunId: string | null } }): Promise<SessionHealthResult>;
    reconcileRun(ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string;
      takeover?: HostTakeoverProofV1 | null; probe: SessionMappingProbe }):
      Promise<RunReconcileReport>;
    reconcileQuery(ctx: CoreCallContext, input: { record: QueryExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe }):
      Promise<QueryReconcileReport>;
    readQueryExecution(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryExecutionRecord>>;
    /** Step 5 (CTL-08(a)/(d)/(e)): the classifier reads the accepted steers of an ended Run's Turn. */
    reconcileControls(ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string; queuedSteers: boolean }):
      Promise<RunReconcileReport>;
    interruptCheck(ctx: CoreCallContext, request: GraphWrite<InterruptCheckInput>): Promise<WriteResult<RoundSnapshot>>;
    /**
     * Slice 1 (spec §4.2): after the Goal fan-out, the Workflow processes at
     * most one maintenance page before the start-up re-drive. The hook is the
     * exact optional `WorkflowPort.maintainSessions`; a platform that does not
     * publish it skips the step.
     */
    maintainSessions?: NonNullable<WorkflowPort['maintainSessions']>;
    /**
     * K3 (L28 step 2b): the `open = 'yes'` review records, through the existing
     * `UnknownCallReviewReadPort.listReviews` owner (index
     * `k3-ucr-by-workspace-open`, 100 per page). Optional: a platform that does
     * not publish it reports that in `problems` and lists no reviews; the step
     * never throws.
     */
    reviews?: Pick<UnknownCallReviewReadPort, 'listReviews'> & {
      /**
       * K3 L28 step 6b (c) kind 4 / M2: the Goal's answers whose ② is
       * committed and whose ③ is not recorded, read once per active Goal.
       * Optional (the answer seam is optional): a platform that does not
       * publish it lists no answers, so the `{ listReviews }`-only seam keeps
       * working.
       */
      listUnappliedAnswers?: UnknownCallReviewReadPort['listUnappliedAnswers'];
      /**
       * K3 L19a (ruling 4, answer 7): the Goal's unapplied answers of the
       * `command_rerun_request` kind through the SAME
       * `k3-decision-answer-by-source-goal` index (`readUnappliedAnswers`).
       * Optional like the UCR seam.
       */
      readCommandRerunRequestAnswers?: (ctx: CoreCallContext, input: { goalRef: GoalRef }) =>
        Promise<ReadResult<UnappliedAnswersReadV1>>;
      /**
       * K3 L18/L28 step 6b (c) kind 3: read the current card's answer by its
       * canonical source. Optional as above; an absent read selects no answered
       * record.
       */
      readDecisionAnswer?: DecisionMessagePort['readDecisionAnswer'];
    };
  };
};

export type StartupReconcileDependencies = {
  platform: StartupReconcilePlatform;
  hostInstanceId: string;
  /**
   * K3 (L2): this Host instance's takeover proof (`HostInstanceFacts.takeover`),
   * copied into every Run classification so a Run-25 candidate can be judged.
   * Absent/null means no proof and every candidate is blocked.
   */
  takeover?: HostTakeoverProofV1 | null;
  /** The workspaces this Host serves (its Kernel Stores are registered before the reconcile runs). */
  scopes: readonly Scope[];
  /** The Host's own context for one workspace (the Host actor, a never-aborted signal). */
  context(scope: Scope): CoreCallContext;
  /** Step 6: one idempotent fan-out pass for the Goal's current epoch (GOAL-16/14, then GOAL-29 on a resume). */
  fanOut(ctx: CoreCallContext, goalRef: GoalRef, options: GoalFanOutPassOptions): Promise<GoalFanOutReportV1>;
};

export type ReconcileLine = { ref: string; row: string; status: 'reconciled' | 'left' | 'failed'; reason: string;
  /** K3 (L25): the automatic-closure outcome of a Run line, copied from `RunReconcileReport.autoCleanup`. */
  autoCleanup?: { applied: true } | { applied: false; blockedBy: string } };

/**
 * K3 L28/UR7b (B3 ruling 4/answer 7): one answer the start-up hands to the
 * Workflow, keyed by its decision source ref (M2): a review record or a
 * `CommandRerunRequest`.
 */
export type { RedriveAnswerV1 } from '../business/workflow/contracts.js';

/** §12.1 step 7: the report; every object left as recorded is listed with its reason. */
export type StartupReconcileReportV1 = {
  hostInstanceId: string;
  sessions: ReconcileLine[];
  runs: ReconcileLine[];
  queries: ReconcileLine[];
  checks: ReconcileLine[];
  controls: ReconcileLine[];
  /**
   * K3 (L28 step 2b): one `UCR` / `left` line per `open = 'yes'` review record,
   * with the status, its decision reasons and whether a round is still open.
   */
  reviews: ReconcileLine[];
  fanOut: { goalId: string; control: string | null; problem: string | null; runs: number; continuations: number }[];
  /**
   * Step 6b (LA-6): the active Goals the start-up re-drive starts a driver for, with the Tasks that
   * selected them: (a) a required active Task whose automation verdict is pending, (b) a Task whose
   * not-entered Run the same claim re-drives.
   */
  redriveGoals: { goalRef: GoalRef; scope: Scope; taskIds: string[]; answers?: RedriveAnswerV1[] }[];
  /** Candidates whose record could not be decoded, and scans that could not complete. */
  problems: string[];
};

const SESSION_PAGE_LIMIT = 100;
const MAX_SESSION_PAGES = 100;
/** L28 step 2b: the same page bound as step 1's scan. */
const REVIEW_PAGE_LIMIT = 100;
const MAX_REVIEW_PAGES = 100;

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function rejectionText(result: CoreRejection | { status: string }): string {
  return 'reason' in result ? `${(result as CoreRejection).code}: ${(result as CoreRejection).reason}` : result.status;
}
function refText(ref: object): string { return JSON.stringify(ref); }
function sessionKey(ref: { projectId: string; sessionId: string }): string { return `${ref.projectId}\u0000${ref.sessionId}`; }

/**
 * How a `starting` Run stands for the reconcile: never entered (no
 * authorization, W-01; a V2 binding `authorized`/`revoked`, W-02/W-03) or
 * `entering` (step 2 classifies it, W-05..W-08).
 */
function startingEntryOf(run: RunSnapshot): 'not_entered' | 'entering' | 'other' {
  if (run.status !== 'starting') return 'other';
  const auth = run.executionAuthorization;
  if (auth === undefined) return 'not_entered';
  if (auth.phase === 'authorized' || auth.phase === 'revoked') return 'not_entered';
  return auth.phase === 'entering' ? 'entering' : 'other';
}
/** W-17, CI-09: a yielded wait keeps its queued intents as the continuation fence. */
function isYieldedWait(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome === 'yielded' && run.continuation !== undefined;
}

/**
 * L28 step 6b (c): the four kinds of open review that hand a Goal to the
 * start-up re-drive. This classifier decides the record-only kinds 1 and 2;
 * the answer-driven kinds 3 and 4 need I/O (the card-answer read and the
 * answer index, UR7b) and are read by the callers below.
 */
type ReviewRedriveKind = 1 | 2 | 3 | 4;

/**
 * Which L28 step 6b (c) kind this open record is, or `null`:
 * 1. open, `pending_review`/`awaiting_proposal` and not `held` (an
 *    `activeRound` claimed but not entered included);
 * 2. open with an `activeRound`, whatever its status and hold: the round must
 *    be closed (an ended one through `settle_review`, a held claimed-not-entered
 *    one through UR3h), and a held record never opens a new round (L21).
 * A `held` record with no round (`open = 'no'`) is not handed off: it waits
 * for "continue" (L29 row 10). Kinds 3-4 are not decided here: they are answer
 * reads, so `null` means "not kind 1 or 2" and the caller probes the answer
 * seam separately.
 */
function reviewRedriveKindOf(record: UnknownCallReviewV1): ReviewRedriveKind | null {
  if (record.open !== 'yes') return null;
  if (record.activeRound !== null) return 2;
  if ((record.disposition?.hold ?? null) !== 'held'
    && (record.status === 'pending_review' || record.status === 'awaiting_proposal')) return 1;
  return null;
}

/**
 * L28 6b (c) kind 3: the answered current card's canonical source. The
 * revision is the record's CURRENT one (the card identity carries it), so an
 * answer to an older card is never mistaken for this card's answer.
 */
function answeredCardSource(record: UnknownCallReviewV1): DecisionSourceV1 {
  return {
    kind: 'unknown_call_review',
    key: decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision }),
    goalRef: { aggregateType: 'Goal', projectId: record.ref.projectId, goalId: record.ref.goalId },
    pins: [],
  };
}

export function emptyStartupReport(hostInstanceId: string): StartupReconcileReportV1 {
  return { hostInstanceId, sessions: [], runs: [], queries: [], checks: [], controls: [], reviews: [], fanOut: [],
    redriveGoals: [], problems: [] };
}

export async function runStartupReconcile(deps: StartupReconcileDependencies): Promise<StartupReconcileReportV1> {
  const { platform, hostInstanceId } = deps;
  const report = emptyStartupReport(hostInstanceId);
  for (const scope of deps.scopes) {
    const ctx = deps.context(scope);
    try {
      await reconcileScope(scope, ctx, report);
    } catch (error) {
      report.problems.push(`${scope.projectId}/${scope.workspaceId}: the reconcile stopped: ${messageOf(error)}`);
    }
  }
  return report;

  async function reconcileScope(scope: Scope, ctx: CoreCallContext, out: StartupReconcileReportV1): Promise<void> {
    // Step 1: probe and record health (SES-12/13/19).
    const probes = new Map<string, SessionMappingProbe>();
    const sessions: SessionRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
      const found = await platform.sessions.findSessions(ctx, { workspace: scope, includeArchived: false,
        page: { limit: SESSION_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) } });
      // An empty ledger (no commit yet: a first start) has nothing to reconcile in any step.
      if (found.status === 'not_ready' && found.observed === null && page === 0) return;
      if (found.status !== 'ready') {
        out.problems.push(`${scope.workspaceId}: the Sessions are not readable (${rejectionText(found)})`);
        cursor = undefined;
        break;
      }
      sessions.push(...found.value.items.map(card => card.record));
      cursor = found.value.nextCursor ?? undefined;
      if (cursor === undefined) break;
    }
    if (cursor !== undefined) {
      out.problems.push(`${scope.workspaceId}: the Session scan stopped at ${String(sessions.length)} Sessions; `
        + 'Sessions and QueryRuns beyond it were not probed or reconciled');
    }
    for (const session of sessions) {
      const pending = session.occupancy !== null && session.occupancy.kind === 'execution';
      if (!pending && session.health === 'available') continue;   // H-04: an idle available Session is not probed.
      const probe = await platform.reconcile.probe(session, ctx.signal);
      probes.set(sessionKey(session.ref), probe);
      const sessionRef = { projectId: session.ref.projectId, sessionId: session.ref.sessionId };
      const written = await platform.reconcile.recordSessionHealth(ctx, { sessionRef,
        probe: { verdict: probe.verdict, activeRunId: probe.activeRunId } });
      const ref = refText(sessionRef);
      if (written.status === 'observed') out.sessions.push({ ref, row: probe.verdict === 'ready' ? 'H-01' : 'H-02', status: 'reconciled',
        reason: `health ${written.session.health}` });
      else if (written.status === 'unchanged') out.sessions.push({ ref, row: probe.verdict === 'ready' ? 'H-01'
        : probe.verdict === 'missing' || probe.verdict === 'damaged' ? 'H-02' : 'H-03', status: 'left', reason: written.reason });
      else out.sessions.push({ ref, row: 'H-*', status: 'failed', reason: rejectionText(written) });
    }
    const probeOf = async (session: SessionRecord): Promise<SessionMappingProbe> =>
      probes.get(sessionKey(session.ref)) ?? await platform.reconcile.probe(session, ctx.signal);

    // Step 2: Work Runs (the live ones and the unknown ends; never the workspace's ended history).
    const listed = async (what: string, read: Promise<ReadResult<{ records: RunSnapshot[]; damaged: string[] }>>):
      Promise<RunSnapshot[]> => {
      const result = await read;
      if (result.status !== 'ready') {
        out.problems.push(`${scope.workspaceId}: the ${what} Runs are not readable (${rejectionText(result)})`);
        return [];
      }
      for (const key of result.value.damaged) out.problems.push(`a damaged Run record ${key} is left as recorded`);
      return result.value.records;
    };
    const starting = await listed('starting', platform.reconcile.candidates.listRuns(scope, 'starting', ctx.signal));
    const running = await listed('running', platform.reconcile.candidates.listRuns(scope, 'running', ctx.signal));
    const unknownEnds = await listed('outcome_unknown', platform.reconcile.candidates.listUnknownRuns(scope, ctx.signal));
    for (const run of [...starting, ...running, ...unknownEnds]) {
      const entry = startingEntryOf(run);
      if (entry === 'not_entered') continue;   // W-01..W-03: the same claim is re-driven by the Workflow (step 6b).
      const read = await platform.executions.readExecution(ctx, run.ref);
      if (read.status !== 'ready') {
        out.runs.push({ ref: refText(run.ref), row: 'W-*', status: 'failed', reason: `the Run is not readable (${rejectionText(read)})` });
        continue;
      }
      const result = await platform.reconcile.reconcileRun(ctx, { record: read.value, hostInstanceId,
        takeover: deps.takeover ?? null, probe: await probeOf(read.value.session) });
      out.runs.push({ ref: refText(result.runRef), row: result.row, status: result.status, reason: result.reason,
        ...(result.autoCleanup === undefined ? {} : { autoCleanup: result.autoCleanup }) });
    }

    // Step 2b (L28): the `open = 'yes'` review records, after step 2 (which may
    // have just created one), read only, 100 per page and at most 100 pages.
    const openReviews = await readOpenReviews(scope, ctx, out);
    for (const record of openReviews) {
      const reasons = record.decisionReasons.length === 0 ? '' : ` ${record.decisionReasons.join(',')}`;
      const round = record.activeRound === null ? '' : ' active_round';
      out.reviews.push({ ref: refText(record.ref), row: 'UCR', status: 'left',
        reason: `${record.status}${reasons}${round}` });
    }

    // Step 3: QueryRuns, found through the Sessions they occupy.
    for (const session of sessions) {
      const occupancy = session.occupancy;
      if (occupancy === null || occupancy.kind !== 'execution' || occupancy.executionRef.aggregateType !== 'QueryRun') continue;
      const queryRunRef = occupancy.executionRef;
      const read = await platform.reconcile.readQueryExecution(ctx, queryRunRef);
      if (read.status !== 'ready') {
        out.queries.push({ ref: refText(queryRunRef), row: 'Q-*', status: 'failed', reason: `the QueryRun is not readable (${rejectionText(read)})` });
        continue;
      }
      const result = await platform.reconcile.reconcileQuery(ctx, { record: read.value, hostInstanceId, probe: await probeOf(session) });
      out.queries.push({ ref: refText(result.queryRunRef), row: result.row, status: result.status, reason: result.reason });
    }

    // Step 4: executing checks (VR-04).
    const rounds = await platform.reconcile.candidates.listOpenRounds(scope, ctx.signal);
    if (rounds.status !== 'ready') out.problems.push(`${scope.workspaceId}: the open rounds are not readable (${rejectionText(rounds)})`);
    else {
      for (const key of rounds.value.damaged) out.problems.push(`a damaged round record ${key} is left as recorded`);
      for (const round of rounds.value.records) {
        let current = round;
        for (const check of round.checks) {
          if (check.phase !== 'executing' || check.invocationId === null) continue;
          const written = await platform.reconcile.interruptCheck(ctx, {
            input: { roundRef: current.ref, checkId: check.checkId, invocationId: check.invocationId, cause: 'host_restart', hostInstanceId },
            meta: { requestId: `a2-reconcile-check:${hostInstanceId}:${current.ref.roundId}:${check.checkId}:${check.invocationId}`,
              expected: [{ ref: current.ref, revision: current.revision }] } });
          const ref = `${refText(current.ref)}#${check.checkId}`;
          if (written.status === 'committed') {
            current = written.value;
            out.checks.push({ ref, row: 'C-01', status: 'reconciled', reason: 'interrupted (host_restart)' });
          } else {
            out.checks.push({ ref, row: 'C-01', status: 'failed', reason: rejectionText(written) });
          }
        }
      }
    }

    // Step 5: the Runs a queued intent names, settled without another end: never entered (CTL-08(a)),
    // an unknown end (CTL-08(d)) or an ended Run whose acks a crash lost (CTL-08(e)).
    const queuedRuns = await platform.reconcile.candidates.listQueuedControlRuns(scope, ctx.signal);
    if (queuedRuns.status !== 'ready') {
      out.problems.push(`${scope.workspaceId}: the queued control intents are not readable (${rejectionText(queuedRuns)})`);
    } else {
      for (const key of queuedRuns.value.damaged) out.problems.push(`a damaged control intent record ${key} is left as recorded`);
      for (const runRef of queuedRuns.value.records) {
        const read = await platform.executions.readExecution(ctx, runRef);
        if (read.status !== 'ready') {
          out.controls.push({ ref: refText(runRef), row: 'W-16/W-19', status: 'failed',
            reason: `the Run is not readable (${rejectionText(read)})` });
          continue;
        }
        const run = read.value.run;
        if (isYieldedWait(run)) {
          out.controls.push({ ref: refText(run.ref), row: 'W-17', status: 'left',
            reason: 'a yielded wait keeps its queued intents as the continuation fence (CI-09)' });
          continue;
        }
        // Step 2 settles the intents of a Run it ends, or leaves an open Run (W-07) with them.
        if (run.status === 'running' || (run.status === 'starting' && startingEntryOf(run) !== 'not_entered')) continue;
        const pointer = await queuedIntent(ctx, run.controlState === undefined ? [] : [run.controlState.intentRef]);
        const steers = await queuedIntent(ctx, run.controlInputs ?? []);
        // A not-entered Run settles only its queued pointer intent; a queued steer is delivered when it enters.
        if (run.status === 'starting' && !pointer) continue;
        if (!pointer && !steers) continue;
        const result = await platform.reconcile.reconcileControls(ctx, { record: read.value, hostInstanceId, queuedSteers: steers });
        out.controls.push({ ref: refText(result.runRef), row: result.row, status: result.status, reason: result.reason });
      }
    }

    // Step 6: the Goal fan-out re-drive (GOAL-16 for a paused/cancelled Goal, GOAL-14 then GOAL-29 for a resumed one).
    const goals = await platform.reconcile.candidates.listGoals(scope, ctx.signal);
    let goalRecords: GoalSnapshot[] = [];
    if (goals.status !== 'ready') out.problems.push(`${scope.workspaceId}: the Goals are not readable (${rejectionText(goals)})`);
    else {
      for (const key of goals.value.damaged) out.problems.push(`a damaged Goal record ${key} is left as recorded`);
      goalRecords = goals.value.records;
    }
    for (const goal of goalRecords) {
      if (goal.desiredStateRevision <= 1 && goal.desiredState === 'active') continue;
      try {
        const pass = await deps.fanOut(ctx, goal.ref, { startup: true });
        out.fanOut.push({ goalId: goal.ref.goalId, control: pass.control, problem: pass.problem, runs: pass.runs.length,
          continuations: pass.continuations?.length ?? 0 });
      } catch (error) {
        out.fanOut.push({ goalId: goal.ref.goalId, control: null, problem: messageOf(error), runs: 0, continuations: 0 });
      }
    }

    // Step 6c (slice 1 §4.2): after the Goal fan-out, the Workflow processes at
    // most one maintenance page before the start-up re-drive. This is a stub
    // seam only: the Host does not now publish it (the Workflow implementation
    // and its composition wiring land in part 2), and when it does the Workflow
    // starts no Kernel Turn, check or model call. A throw or a real per-Session
    // maintenance failure is visible in `problems` and never blocks another
    // Session's work (E17).
    if (platform.reconcile.maintainSessions !== undefined) {
      try {
        const page = await platform.reconcile.maintainSessions(ctx, { workspace: scope, after: null });
        if (page.status === 'ready') {
          for (const failure of page.value.failures) {
            // §0.1 U1 (IT34): a retired line whose Run outcome is still unknown
            // is a by-design skip that needs human attestation, not a reconcile
            // problem; IT34 already locks the `busy` failure on the maintenance
            // owner, and A8 W-07/W-14 expect an otherwise clean report.
            if (failure.rejection.code === 'busy'
              && failure.rejection.reason.startsWith('archive_unknown_confirmation_required:')) continue;
            out.problems.push(`${scope.workspaceId}: maintenance left ${failure.sessionRef.sessionId} `
              + `(${failure.rejection.code}): ${failure.rejection.reason}`);
          }
        } else {
          out.problems.push(`${scope.workspaceId}: the Workflow maintenance is not ready (${rejectionText(page)})`);
        }
      } catch (error) {
        out.problems.push(`${scope.workspaceId}: the Workflow maintenance failed: ${messageOf(error)}`);
      }
    }

    // Step 6b (LA-6): the active Goals with (a) a required active Task whose automation verdict the
    // Workflow acts on, read again after steps 1..6 (a Run step 2 ended is judged here, W-21, RUN-19),
    // (b) a not-entered Run whose pointer is not paused/cancelled (W-01..W-03), or (c) an open review
    // record (L28): a kind-1 waiting record or a kind-2 record whose round still has to be closed.
    const afterSteps = await listed('starting', platform.reconcile.candidates.listRuns(scope, 'starting', ctx.signal));
    const notEntered = afterSteps.filter(run => startingEntryOf(run) === 'not_entered'
      && run.controlState?.desiredState !== 'paused' && run.controlState?.desiredState !== 'cancelled');
    const readDecisionAnswer = platform.reconcile.reviews?.readDecisionAnswer;
    const listUnappliedAnswers = platform.reconcile.reviews?.listUnappliedAnswers;
    const readCommandRerunRequestAnswers = platform.reconcile.reviews?.readCommandRerunRequestAnswers;
    for (const goal of goalRecords) {
      if (goal.desiredState !== 'active') continue;
      const goalReviews = openReviews.filter(record => record.ref.goalId === goal.ref.goalId);
      const taskIds = [...await pendingAutomationTaskIds(ctx, goal, out),
        ...notEntered.filter(run => run.ref.goalId === goal.ref.goalId).map(run => run.task.taskId),
        ...goalReviews.filter(record => reviewRedriveKindOf(record) !== null).map(record => record.task.taskId)];
      // Kind 3 (L28): a `needs_decision`/`awaiting_approval` record with no
      // round and an answer to its CURRENT card. Reading the answer selects the
      // record's Task; nothing is applied here (UR7 does that on the advance).
      if (readDecisionAnswer !== undefined) {
        for (const record of goalReviews) {
          if (record.status !== 'needs_decision' && record.status !== 'awaiting_approval') continue;
          if (reviewRedriveKindOf(record) !== null) continue;
          let read: Awaited<ReturnType<typeof readDecisionAnswer>>;
          try {
            read = await readDecisionAnswer(ctx, { source: answeredCardSource(record) });
          } catch (error) {
            out.problems.push(`${scope.workspaceId}: the card answer of review ${record.ref.runId} `
              + `is not readable (${messageOf(error)})`);
            continue;
          }
          if (read.status === 'not_found') continue;
          if (read.status !== 'ready') {
            out.problems.push(`${scope.workspaceId}: the card answer of review ${record.ref.runId} `
              + `is not readable (${rejectionText(read)})`);
            continue;
          }
          if (read.value.message !== null) taskIds.push(record.task.taskId);
        }
      }
      // Kind 4 (L28, M2): ONE read per active Goal; each answer is handed over
      // by its own `reviewRef`, independent of the Task ids and the record's
      // `open`. A read failure is a problem line, never a throw.
      const answers: RedriveAnswerV1[] = [];
      if (listUnappliedAnswers !== undefined) {
        try {
          const read = await listUnappliedAnswers(ctx, { goalRef: goal.ref });
          if (read.status === 'ready') {
            for (const answer of read.value.answers) {
              answers.push({ kind: 'unknown_call_review', reviewRef: answer.reviewRef,
                answerMessageRef: answer.answerMessageRef });
            }
          } else if (read.status !== 'not_found') {
            out.problems.push(`${scope.workspaceId}: the unapplied answers of ${goal.ref.goalId} `
              + `are not readable (${rejectionText(read)})`);
          }
        } catch (error) {
          out.problems.push(`${scope.workspaceId}: the unapplied answers of ${goal.ref.goalId} `
            + `are not readable (${messageOf(error)})`);
        }
      }
      // Kind 4 for the CRR source (K3 L19a, ruling 4): the SAME answer index
      // read per Goal; each answer is handed over by its own request ref.
      if (readCommandRerunRequestAnswers !== undefined) {
        try {
          const read = await readCommandRerunRequestAnswers(ctx, { goalRef: goal.ref });
          if (read.status === 'ready') {
            for (const answer of read.value.answers) {
              if (answer.kind !== 'command_rerun_request') continue;
              answers.push({ kind: 'command_rerun_request', requestRef: answer.requestRef,
                answerMessageRef: answer.answerMessageRef });
            }
          } else if (read.status !== 'not_found') {
            out.problems.push(`${scope.workspaceId}: the unapplied command-rerun answers of ${goal.ref.goalId} `
              + `are not readable (${rejectionText(read)})`);
          }
        } catch (error) {
          out.problems.push(`${scope.workspaceId}: the unapplied command-rerun answers of ${goal.ref.goalId} `
            + `are not readable (${messageOf(error)})`);
        }
      }
      const uniqueTaskIds = [...new Set(taskIds)];
      if (uniqueTaskIds.length > 0 || answers.length > 0) {
        out.redriveGoals.push({ goalRef: goal.ref, scope: { ...scope }, taskIds: uniqueTaskIds,
          ...(answers.length > 0 ? { answers } : {}) });
      }
    }
  }

  /**
   * L28 step 2b: the `open = 'yes'` records through the platform's review read
   * (the same owner the routes use). Never throws: a missing read or a failed
   * page is a `problems` line; after the 100-page bound the unread rest is one.
   */
  async function readOpenReviews(scope: Scope, ctx: CoreCallContext, out: StartupReconcileReportV1):
  Promise<UnknownCallReviewV1[]> {
    const read = platform.reconcile.reviews;
    if (read === undefined) {
      out.problems.push(`${scope.workspaceId}: the open reviews are not readable (the review read is not wired)`);
      return [];
    }
    const records: UnknownCallReviewV1[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_REVIEW_PAGES; page += 1) {
      let found: Awaited<ReturnType<UnknownCallReviewReadPort['listReviews']>>;
      try {
        found = await read.listReviews(ctx, { workspace: { ...scope }, filter: { open: 'yes' },
          page: { limit: REVIEW_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) } });
      } catch (error) {
        out.problems.push(`${scope.workspaceId}: the open reviews are not readable (${messageOf(error)})`);
        return records;
      }
      if (found.status !== 'ready') {
        out.problems.push(`${scope.workspaceId}: the open reviews are not readable (${rejectionText(found)})`);
        return records;
      }
      records.push(...found.value.items);
      cursor = found.value.nextCursor ?? undefined;
      if (cursor === undefined) return records;
    }
    out.problems.push(`${scope.workspaceId}: the open-review scan stopped at ${String(records.length)} records; `
      + 'the unread rest was not listed');
    return records;
  }

  /**
   * §12.1 step 6b condition (a): the required active Tasks of the Goal's adopted Plan whose automation
   * verdict is pending (`isPendingVerdict`). An unreadable Task graph is reported and selects nothing.
   */
  async function pendingAutomationTaskIds(ctx: CoreCallContext, goal: GoalSnapshot, out: StartupReconcileReportV1): Promise<string[]> {
    if (goal.activePlanRevision === null) return [];
    let graph: Awaited<ReturnType<PlanTaskPort['queryTaskGraph']>>;
    try {
      graph = await platform.plans.queryTaskGraph(ctx, { goalRef: goal.ref });
    } catch (error) {
      out.problems.push(`${goal.ref.goalId}: the Task facts are not readable for the start-up re-drive (${messageOf(error)})`);
      return [];
    }
    if (graph.status !== 'ready') {
      out.problems.push(`${goal.ref.goalId}: the Task facts are not readable for the start-up re-drive (${rejectionText(graph)})`);
      return [];
    }
    const { plan, tasks } = graph.value;
    return plan.tasks.filter(task => task.requirementLevel === 'required' && task.disposition === 'active')
      .filter(task => {
        const verdict = tasks.find(row => row.ref.taskId === task.taskId)?.failure?.automation.verdict;
        return verdict !== undefined && isPendingVerdict(verdict);
      })
      .map(task => task.taskId);
  }

  /** Whether any of the intents is still queued (a failed read counts as not queued: the Run is reconciled next start). */
  async function queuedIntent(ctx: CoreCallContext, refs: readonly ControlIntentSnapshotV1['ref'][]): Promise<boolean> {
    for (const ref of refs) {
      const intent: ReadResult<ControlIntentSnapshotV1> = await platform.controls.readControl(ctx, ref);
      if (intent.status === 'ready' && intent.value.status === 'queued') return true;
    }
    return false;
  }
}
