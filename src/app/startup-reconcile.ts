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
 *    acts on (`requeue`, `claim_requeued`; `reverify` from step 5.9; W-21,
 *    RUN-19), (b) a not-entered Run the same claim re-drives (W-01..W-03);
 * 7. return the report: what moved and what was left, with the reason.
 *
 * Reconcile only reads the Kernel Store and the platform records and books
 * conclusions; it never starts a Kernel Turn, re-runs a tool or a check, or
 * resends a message. Every write is one owner commit judged by its machine; a
 * refused or failed object is reported, never skipped silently.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { SessionRecord } from '../contracts/core/session.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../contracts/ledger.js';
import type { RoundSnapshot } from '../contracts/verification.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import type { SessionMappingProbe } from '../core/agent-runtime/session-operations.js';
import type { QueryReconcileReport, RunReconcileReport } from '../core/agent-runtime/run-reconcile.js';
import type { InterruptCheckInput } from '../core/work-graph/evidence/contracts.js';
import type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import type { SessionHealthResult } from '../core/work-graph/sessions/session-health.js';
import { isPendingVerdict } from '../core/work-graph/state/goal-machine.js';
import type { GraphWrite } from '../core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../core/work-graph/tasks/plan-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { ReconcileCandidateReader } from '../core/work-graph/tasks/reconcile-reads.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { WriteResult } from '../contracts/core/results.js';
import type { GoalFanOutPassOptions, GoalFanOutReportV1 } from './goal-fan-out-driver.js';

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
    reconcileRun(ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe }):
      Promise<RunReconcileReport>;
    reconcileQuery(ctx: CoreCallContext, input: { record: QueryExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe }):
      Promise<QueryReconcileReport>;
    readQueryExecution(ctx: CoreCallContext, ref: QueryRunRef): Promise<ReadResult<QueryExecutionRecord>>;
    /** Step 5 (CTL-08(a)/(d)/(e)): the classifier reads the accepted steers of an ended Run's Turn. */
    reconcileControls(ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string; queuedSteers: boolean }):
      Promise<RunReconcileReport>;
    interruptCheck(ctx: CoreCallContext, request: GraphWrite<InterruptCheckInput>): Promise<WriteResult<RoundSnapshot>>;
  };
};

export type StartupReconcileDependencies = {
  platform: StartupReconcilePlatform;
  hostInstanceId: string;
  /** The workspaces this Host serves (its Kernel Stores are registered before the reconcile runs). */
  scopes: readonly Scope[];
  /** The Host's own context for one workspace (the Host actor, a never-aborted signal). */
  context(scope: Scope): CoreCallContext;
  /** Step 6: one idempotent fan-out pass for the Goal's current epoch (GOAL-16/14, then GOAL-29 on a resume). */
  fanOut(ctx: CoreCallContext, goalRef: GoalRef, options: GoalFanOutPassOptions): Promise<GoalFanOutReportV1>;
};

export type ReconcileLine = { ref: string; row: string; status: 'reconciled' | 'left' | 'failed'; reason: string };

/** §12.1 step 7: the report; every object left as recorded is listed with its reason. */
export type StartupReconcileReportV1 = {
  hostInstanceId: string;
  sessions: ReconcileLine[];
  runs: ReconcileLine[];
  queries: ReconcileLine[];
  checks: ReconcileLine[];
  controls: ReconcileLine[];
  fanOut: { goalId: string; control: string | null; problem: string | null; runs: number; continuations: number }[];
  /**
   * Step 6b (LA-6): the active Goals the start-up re-drive starts a driver for, with the Tasks that
   * selected them: (a) a required active Task whose automation verdict is pending, (b) a Task whose
   * not-entered Run the same claim re-drives.
   */
  redriveGoals: { goalRef: GoalRef; scope: Scope; taskIds: string[] }[];
  /** Candidates whose record could not be decoded, and scans that could not complete. */
  problems: string[];
};

const SESSION_PAGE_LIMIT = 100;
const MAX_SESSION_PAGES = 100;

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function rejectionText(result: CoreRejection | { status: string }): string {
  return 'reason' in result ? `${(result as CoreRejection).code}: ${(result as CoreRejection).reason}` : result.status;
}
function refText(ref: object): string { return JSON.stringify(ref); }
function sessionKey(ref: { projectId: string; sessionId: string }): string { return `${ref.projectId}\u0000${ref.sessionId}`; }

/**
 * How a `starting` Run stands for the reconcile: never entered (no
 * authorization, W-01; a V2 binding `authorized`/`revoked`, W-02/W-03),
 * `entering` (step 2 classifies it, W-05..W-08), or a legacy V1 binding the
 * reconcile does not migrate (reported unsupported, §12.2 note).
 */
function startingEntryOf(run: RunSnapshot): 'not_entered' | 'entering' | 'legacy' | 'other' {
  if (run.status !== 'starting') return 'other';
  const auth = run.executionAuthorization;
  if (auth === undefined) return 'not_entered';
  if (!('schemaVersion' in auth) || auth.schemaVersion !== 2) return 'legacy';
  if (auth.phase === 'authorized' || auth.phase === 'revoked') return 'not_entered';
  return auth.phase === 'entering' ? 'entering' : 'other';
}
/** W-17, CI-09: a yielded wait keeps its queued intents as the continuation fence. */
function isYieldedWait(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome === 'yielded' && run.continuation !== undefined;
}

export function emptyStartupReport(hostInstanceId: string): StartupReconcileReportV1 {
  return { hostInstanceId, sessions: [], runs: [], queries: [], checks: [], controls: [], fanOut: [], redriveGoals: [], problems: [] };
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
      if (entry === 'legacy') {
        out.runs.push({ ref: refText(run.ref), row: 'V1', status: 'left',
          reason: 'unsupported: a legacy V1 authorization is read only and never reconciled' });
        continue;
      }
      const read = await platform.executions.readExecution(ctx, run.ref);
      if (read.status !== 'ready') {
        out.runs.push({ ref: refText(run.ref), row: 'W-*', status: 'failed', reason: `the Run is not readable (${rejectionText(read)})` });
        continue;
      }
      const result = await platform.reconcile.reconcileRun(ctx, { record: read.value, hostInstanceId,
        probe: await probeOf(read.value.session) });
      out.runs.push({ ref: refText(result.runRef), row: result.row, status: result.status, reason: result.reason });
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
          out.controls.push({ ref: refText(runRef), row: 'W-04/W-16/W-19', status: 'failed',
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
      if ((goal.desiredStateRevision ?? 1) <= 1 && goal.desiredState === 'active') continue;
      try {
        const pass = await deps.fanOut(ctx, goal.ref, { startup: true });
        out.fanOut.push({ goalId: goal.ref.goalId, control: pass.control, problem: pass.problem, runs: pass.runs.length,
          continuations: pass.continuations?.length ?? 0 });
      } catch (error) {
        out.fanOut.push({ goalId: goal.ref.goalId, control: null, problem: messageOf(error), runs: 0, continuations: 0 });
      }
    }

    // Step 6b (LA-6): the active Goals with (a) a required active Task whose automation verdict the
    // Workflow acts on, read again after steps 1..6 (a Run step 2 ended is judged here, W-21, RUN-19), or
    // (b) a not-entered Run whose pointer is not paused/cancelled (W-01..W-03).
    const afterSteps = await listed('starting', platform.reconcile.candidates.listRuns(scope, 'starting', ctx.signal));
    const notEntered = afterSteps.filter(run => startingEntryOf(run) === 'not_entered'
      && run.controlState?.desiredState !== 'paused' && run.controlState?.desiredState !== 'cancelled');
    for (const goal of goalRecords) {
      if (goal.desiredState !== 'active') continue;
      const taskIds = [...await pendingAutomationTaskIds(ctx, goal, out),
        ...notEntered.filter(run => run.ref.goalId === goal.ref.goalId).map(run => run.task.taskId)];
      if (taskIds.length > 0) out.redriveGoals.push({ goalRef: goal.ref, scope: { ...scope }, taskIds: [...new Set(taskIds)] });
    }
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
