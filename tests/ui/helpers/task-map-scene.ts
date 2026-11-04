import type { BootstrapReply } from '../../../src/ui/host-client.js';
import type { CommitCursor } from '../../../src/contracts/command-event.js';
import type { GoalSnapshot } from '../../../src/contracts/ledger.js';
import type {
  Disposition, Phase, PlanRevisionSnapshot, RuntimeTask, TaskKind, TaskScope,
} from '../../../src/contracts/plan.js';
import type { GoalDisplayRead, GoalDetail, TaskGraph, TaskRow } from '../../../src/core/work-graph/model/plan-contracts.js';
import type {
  ArchivedLinePageV1, LineBriefV1, LineRowV1, LineStatusV1, NodeDetailV1, WorkLineDetailV1,
  WorkLineListV1, GraphHoverReadV1, GroupHoverV1, TaskHoverV1,
} from '../../../src/contracts/work-line.js';
import type { GraphNodeRefV1 } from '../../../src/contracts/graph-context.js';
import type { GoalSettingsV1 } from '../../../src/contracts/goal-decisions.js';
import type { TaskExecutionPage } from '../../../src/core/work-graph/model/execution-read-contracts.js';
import type { TaskAutomationStopReason, TaskFailureFactsV1, TaskPhaseCauseV1 } from '../../../src/contracts/task-failure.js';
import type {
  ActivityCalendarV1, ActivityCellV1, QueryActivityViewV1, RunActivityViewV1,
} from '../../../src/core/work-graph/views/activity-read-model.js';
import type {
  TrackBarV1, TrackBarsPageV1, TrackCheckBarV1, TrackQueryBarV1, TrackRunBarV1,
} from '../../../src/core/work-graph/views/track-read-model.js';
import type { TaskStateTimelinePageV1 } from '../../../src/core/work-graph/views/task-state-timeline.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../../src/contracts/ledger.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../../src/contracts/query-job.js';
import type { VerificationRoundRef } from '../../../src/contracts/verification.js';
import type { SessionRef } from '../../../src/contracts/core/identity.js';
import raw from '../fixtures/task-map-scene.json' with { type: 'json' };

/** One route reply the page reads; the values below satisfy the route contracts. */
type Ready<T> = { status: 'ready'; value: T };
type Rejected = { status: 'rejected'; code: string; reason: string };
type SceneReply = Ready<unknown> | Rejected | BootstrapReply;

const PROJECT = raw.scope.projectId;
const WORKSPACE = raw.scope.workspaceId;
const GOAL = raw.goal.goalId;
const PLAN = raw.plan.planId;
const CURSOR = 'c0000000001' as CommitCursor;
const lit = <T extends string>(value: string): T => value as T;

const goalRef = { aggregateType: 'Goal', projectId: PROJECT, goalId: GOAL } as const;
const planRef = { aggregateType: 'PlanRevision', projectId: PROJECT, planId: PLAN } as const;
const workspaceRef = { aggregateType: 'Workspace', projectId: PROJECT, workspaceId: WORKSPACE } as const;
const sessionRef = (sessionId: string): SessionRef => ({ projectId: PROJECT, sessionId });
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: PROJECT, goalId: GOAL, runId });
const roundRef = (runId: string): VerificationRoundRef => ({
  aggregateType: 'VerificationRound', projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL,
  taskId: '', runId, roundId: runId,
});
const queryRef = (queryJobId: string, runId: string): QueryRunRef => ({
  aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId, runId,
});
const sceneScopeOf = (scope: { kind: string; stageId?: string }): TaskScope =>
  scope.kind === 'goal' ? { kind: 'goal' } : { kind: 'stage', stageId: scope.stageId ?? '' };
const one = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const taskOf = (id: string): typeof raw.tasks[number] | undefined => raw.tasks.find((task) => task.taskId === id);
const sceneRunOf = (id: string): typeof raw.runs[number] | undefined => raw.runs.find((run) => run.id === id);
const lineOfId = (id: string): typeof raw.lines[number] | undefined => raw.lines.find((line) => line.id === id);
const lineOfTask = (id: string): typeof raw.lines[number] | undefined =>
  raw.lines.find((line) => line.task === id) ?? raw.lines.find((line) => line.name === '审阅者 · 规格');

function goalSettings(): GoalSettingsV1 {
  return {
    schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0,
    waitForGoalRef: null, parallelRisks: [],
  };
}

function goalSnapshot(): GoalSnapshot {
  return {
    ref: goalRef, workspaceRef, objective: raw.goal.objective,
    desiredState: 'active', desiredStateRevision: 1, desiredStateRequestedBy: null,
    activePlanRevision: planRef, revision: 1, settings: goalSettings(),
    continuedFrom: null, copiedInterventions: [], since: CURSOR,
  };
}

function runtimeTask(task: typeof raw.tasks[number]): RuntimeTask {
  return {
    taskId: task.taskId,
    ...(task.stageId === null ? {} : { stageId: task.stageId }),
    title: task.title,
    requirementLevel: 'required',
    taskKind: lit<TaskKind>(task.taskKind),
    disposition: lit<Disposition>(task.disposition),
    phase: lit<Phase>(task.phase),
    scope: sceneScopeOf(task.scope),
    executionIntent: lit<'plan_only' | 'request_execution'>(task.intent),
  };
}

function reworkSummary(task: typeof raw.tasks[number]): TaskRow['rework'] {
  if (task.rework === null) return undefined;
  const after = raw.runs.find((run) => run.task === task.taskId && run.kind === 'run');
  return {
    entries: task.rework.entries.map((entry) => ({
      ref: { aggregateType: 'TaskRequeue', projectId: PROJECT, goalId: GOAL, taskId: task.taskId,
        afterRunId: after?.id ?? task.taskId },
      afterRunRef: runRef(after?.id ?? task.taskId),
      failureClass: lit(entry.failureClass === '执行失败' ? 'run_failed' : entry.failureClass === '检查未通过' ? 'check_failed' : 'check_incomplete'),
      requestedBy: entry.automatic ? { kind: 'system', id: 'scene' } : { kind: 'human', id: 'scene' },
      automatic: entry.automatic, autoCount: entry.index, reason: entry.reason, requestedAt: entry.requestedAt,
    })),
    requeueAutoCount: task.rework.requeueAutoCount, cap: task.rework.cap,
  };
}


/** The scene's JSON strings narrowed to the formal phase-cause codes without a
 * generic assertion: an unknown code is a fixture error, never a silent cast. */
function phaseCauseCode(value: string): TaskPhaseCauseV1['code'] {
  switch (value) {
    case 'requeued': case 'run_outcome_unknown': case 'run_failed': case 'check_failed':
    case 'round_inconclusive': case 'check_interrupted': case 'round_ambiguous':
    case 'awaiting_verification': case 'verification_running': case 'awaiting_completion':
    case 'origin_unresolvable': case 'continuation_cancelled': case 'continuation_paused':
    case 'paused_interrupted':
      return value;
    default:
      throw new Error('scene has no phase cause ' + value);
  }
}

const sceneStopReason = (value: string): TaskAutomationStopReason | null =>
  value === 'auto_rework_cap_reached' ? value : null;

/** The real shape of an automation stop: a `failed + check_failed` task whose
 * verdict carries the stop reason (`failure.automation.verdict.reason`). */
function failureFactsOf(task: typeof raw.tasks[number]): TaskFailureFactsV1 | undefined {
  const stop = raw.failures.find((entry) => entry.taskId === task.taskId);
  const reason = stop === undefined ? null : sceneStopReason(stop.reason);
  if (reason === null) return undefined;
  return {
    subjectKind: task.gate ? 'gate' : 'work',
    runRef: null, runRevision: null, attemptRef: null, sessionRef: null,
    failureClass: 'check_failed', notReworkableCause: null,
    run: null, interruption: null, stop: null, round: null,
    source: { atFailure: null, lastChecked: null, sinceFailure: 'unknown' },
    requeueActors: [], reverifyActors: [],
    automation: {
      cap: task.rework?.cap ?? 3, requeueAutoCount: task.rework?.requeueAutoCount ?? 0,
      coveringRequeue: null, lastRefusal: null, lastReverifyRefusal: null,
      verdict: { kind: 'stopped', reason, detail: {} },
    },
  };
}

function taskRow(task: typeof raw.tasks[number]): TaskRow {
  const definition = runtimeTask(task);
  const failure = failureFactsOf(task);
  const row: TaskRow = {
    ref: { projectId: PROJECT, goalId: GOAL, taskId: task.taskId },
    definition,
    effectivePhase: definition.phase,
    disposition: definition.disposition,
    currentAttempt: null,
    execution: null,
    eligibilityScope: 'task_state',
    eligibility: { eligible: false, reasons: [] },
    relations: [],
    inputRequirements: [],
    legacyDependencies: [],
    ...(task.phaseCause === null ? {} : { phaseCause: { code: phaseCauseCode(task.phaseCause.code) } }),
    ...(failure === undefined ? {} : { failure }),
  };
  const rework = reworkSummary(task);
  if (rework === undefined) return row;
  return { ...row, rework };
}

function planSnapshot(): PlanRevisionSnapshot {
  return {
    schemaVersion: 2,
    ref: planRef,
    revision: 1,
    goalRef,
    planId: PLAN,
    planRevision: 1,
    acceptedAt: raw.plan.acceptedAt,
    effectiveCompletionPolicy: {
      ref: { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT, policyId: raw.plan.policyId, revision: 1 },
      digest: 'scene-policy-digest',
    },
    effectiveArchitectureBaseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: raw.plan.baselineId, revision: 1 },
      digest: 'scene-baseline-digest',
    },
    stages: raw.stages.map((stage) => ({
      stageId: stage.stageId, title: stage.title, ...(stage.description === '' ? {} : { description: stage.description }),
    })),
    tasks: raw.tasks.map(runtimeTask),
    obligations: [],
    taskHierarchy: { parentOf: [] },
    executionDag: {
      dependsOn: raw.edges.map((edge) => ({
        taskId: edge.taskId, dependsOnId: edge.dependsOnId,
        requires: { kind: lit(edge.requires.kind), label: edge.requires.label },
      })),
    },
  };
}

function taskGraph(): TaskGraph {
  return { plan: planSnapshot(), tasks: raw.tasks.map(taskRow), sourceCursor: CURSOR };
}

function goalDetail(): GoalDetail {
  return { goal: goalSnapshot(), pendingPlan: null, continuedBy: [] };
}

function goalDisplay(): GoalDisplayRead {
  return {
    goal: goalSnapshot(),
    display: { phase: 'RUNNING', row: 'GOAL-27', cause: null, causes: [], runStops: null },
    liveRuns: [], resumePending: [], sourceCursor: CURSOR,
  };
}

/* ------------------------------------------------------------------ lines */

function lineOwn(line: typeof raw.lines[number]): LineStatusV1['own'] {
  if (line.archived) return 'done';
  const task = line.task === null ? undefined : taskOf(line.task);
  if (task !== undefined) {
    if (task.st === 'running') return 'working';
    if (task.st === 'verifying') return 'checking';
    if (task.st === 'failed' || task.st === 'blocked' || task.st === 'decide') return 'standby';
    if (task.st === 'satisfied') return 'done';
  }
  return raw.runs.some((run) => run.lineId === line.id && run.endAt === null) ? 'working' : 'standby';
}

function lineStatus(line: typeof raw.lines[number]): LineStatusV1 {
  const task = line.task === null ? undefined : taskOf(line.task);
  const attention = task !== undefined && (task.st === 'decide' || task.st === 'failed' || task.st === 'blocked')
    ? { code: lit<'decide' | 'failed' | 'blocked'>(task.st), reason: { code: 'idle' as const, params: {}, refs: [] } }
    : null;
  return {
    own: lineOwn(line),
    ownReason: { code: 'idle', params: {}, refs: [] },
    attention,
    attentionCounts: { decide: 0, failed: 0, blocked: 0, unknown: 0 },
    attentionComplete: true,
    doneEvidence: 'not_applicable',
    partialParts: [],
    markers: [],
    bucket: line.archived ? 'archived' : 'working',
    archivedTag: line.archived ? 'done' : null,
    readOnly: false,
  };
}

function sceneDutyOf(line: typeof raw.lines[number]): 'executor' | 'secretary' | 'adviser' | 'reviewer' | 'unknown' {
  return line.role === 'executor' ? 'executor' : line.role === 'secretary' ? 'secretary'
    : line.role === 'advisor' ? 'adviser' : line.role === 'reviewer' ? 'reviewer' : 'unknown';
}

function lineName(line: typeof raw.lines[number]): LineRowV1['name'] {
  return {
    source: line.role === 'secretary' ? 'secretary_ordinal' : 'running_task',
    primary: line.name, extraCount: 0, ordinal: line.role === 'secretary' ? 1 : null,
    tasks: line.task === null ? [] : [{ projectId: PROJECT, goalId: GOAL, taskId: line.task }],
    goalRef: line.role === 'secretary' ? goalRef : null, complete: true,
  };
}

function lineRow(line: typeof raw.lines[number]): LineRowV1 {
  return {
    key: sessionRef(line.sessionIds[0] ?? line.id.replace(/^L:/, '')),
    duty: sceneDutyOf(line),
    name: lineName(line),
    status: lineStatus(line),
    runningCap: null,
    responsibleNow: [],
    doneTasks: null,
    retired: null,
    groups: {
      duty: sceneDutyOf(line),
      module: line.area === null ? null : { projectId: PROJECT, moduleId: line.area },
      task: line.task === null ? null : { projectId: PROJECT, goalId: GOAL, taskId: line.task },
      alsoMaintains: [],
    },
    sessionCount: { status: 'exact', value: line.sessionIds.length },
    chainSessions: line.sessionIds.map(sessionRef),
    pinned: false, pinnedBy: [],
    lastActivityAt: line.last, sortKey: line.last,
    controls: [], problem: null,
  };
}

function lineBrief(line: typeof raw.lines[number]): LineBriefV1 {
  return { key: sessionRef(line.sessionIds[0] ?? line.id.replace(/^L:/, '')), duty: sceneDutyOf(line), name: lineName(line), status: lineStatus(line) };
}

function activeLines(): WorkLineListV1 {
  const rows = raw.lines.filter((line) => !line.archived).map(lineRow);
  const archived = raw.lines.filter((line) => line.archived).length;
  return {
    rows,
    counts: {
      working: { status: 'exact', value: rows.filter((row) => row.status.own === 'working' || row.status.own === 'checking').length },
      standby: { status: 'exact', value: rows.filter((row) => row.status.own !== 'working' && row.status.own !== 'checking').length },
      archived: { status: 'exact', value: archived, asOf: CURSOR },
    },
    legacyUnchecked: { status: 'exact', value: 0 },
    attentionComplete: true, attentionProblem: null,
    readWindow: { from: CURSOR, to: CURSOR },
  };
}

function archivedLines(): ArchivedLinePageV1 {
  return {
    rows: raw.lines.filter((line) => line.archived).map(lineRow),
    nextCursor: null, sourceCursor: CURSOR,
    withoutArchivedAt: { status: 'exact', value: 0 },
  };
}

/* ------------------------------------------------------------------ hover */

function ownerLineOfTask(taskId: string): typeof raw.lines[number] | undefined {
  const bar = raw.runs.filter((run) => run.task === taskId && (run.kind === 'run' || run.kind === 'check'))
    .sort((a, b) => (a.startAt < b.startAt ? 1 : -1))[0];
  return bar === undefined ? undefined : lineOfId(bar.lineId);
}

function groupHover(): GroupHoverV1 {
  const secretary = raw.lines.find((line) => line.role === 'secretary');
  return {
    node: { kind: 'goal', ref: goalRef },
    tasks: { status: 'exact', value: raw.tasks.length },
    neverRanTerminal: { status: 'exact', value: 0 },
    participatedLines: { status: 'exact', value: raw.lines.length },
    workingLines: { status: 'exact', value: 1 },
    pausedLines: { status: 'exact', value: 0 },
    owners: secretary === undefined ? [] : [lineBrief(secretary)],
  };
}

function hoverTask(task: typeof raw.tasks[number]): TaskHoverV1 {
  const owner = ownerLineOfTask(task.taskId);
  return {
    task: { projectId: PROJECT, goalId: GOAL, taskId: task.taskId },
    planRef: planRef,
    title: task.title,
    phase: lit<Phase>(task.phase),
    phaseCause: task.phaseCause === null ? null : { code: phaseCauseCode(task.phaseCause.code) },
    disposition: lit<Disposition>(task.disposition),
    display: { neverRanTerminal: null, anomaly: null, attention: null },
    module: null,
    owners: owner === undefined ? [] : [lineBrief(owner)],
    participatedLines: { status: 'exact', value: owner === undefined ? 0 : 1 },
  };
}

function graphHover(): GraphHoverReadV1 {
  return {
    goalRef, groups: [groupHover()], tasks: raw.tasks.map(hoverTask), modules: [],
    files: { availability: 'unavailable', cause: 'not_recorded', reason: 'scene' },
    noteCounts: [], problems: [], sourceCursor: CURSOR,
  };
}

/* ------------------------------------------------------------------ track */

const RUN_RESULT: Record<string, TrackRunBarV1['result']> = {
  ended: 'completed', handoff: 'completed', running: 'running', paused: 'paused',
  execfail: 'failed', budget: 'budget_exhausted', interrupted: 'interrupted',
  cancelled: 'cancelled', unknown: 'outcome_unknown', yielded: 'yielded',
};
const CHECK_RESULT: Record<string, TrackCheckBarV1['result']> = {
  passed: 'PASS', failed: 'FAIL', incomplete: 'INCONCLUSIVE', checking: 'open',
};
const QUERY_RESULT: Record<string, TrackQueryBarV1['result']> = {
  answered: 'answered', running: 'running', failed: 'failed', cancelled: 'cancelled', unknown: 'unknown',
};

function runActivity(run: typeof raw.runs[number]): RunActivityViewV1 {
  const ref = runRef(run.id);
  return {
    runRef: ref, status: 'counted', reason: null, error: false,
    totals: { steps: run.counts.st, edits: run.counts.ed, editsUnknown: 0 },
    changedFiles: null, usage: null,
    readings: {
      usage: { tokens: null, complete: false, growth: { tokens: null, complete: false }, reason: null },
      lines: { added: null, deleted: null, complete: false, reason: null },
    },
    recordedBy: 'run_end', recordedAt: null, countedThroughTurnEnd: null, unresolvedCalls: null,
  };
}

function queryActivity(run: typeof raw.runs[number]): QueryActivityViewV1 {
  return {
    queryRunRef: queryRef(run.id, run.id), status: 'counted', reason: null, error: false,
    totals: { steps: run.counts.st, edits: run.counts.ed, editsUnknown: 0 },
    changedFiles: null, usage: null, recordedBy: 'query_end', recordedAt: null,
    countedThroughTurnEnd: null, unresolvedCalls: null,
    sessionRef: sessionRef(run.session.sessionId), askedSessionRef: sessionRef(run.session.sessionId), goalId: GOAL,
  };
}

function previousRef(bar: typeof raw.runs[number]): RunRef | VerificationRoundRef | QueryRunRef | null {
  if (bar.previous === null) return null;
  const prev = sceneRunOf(bar.previous);
  if (prev === undefined) return null;
  if (prev.kind === 'run') return runRef(prev.id);
  if (prev.kind === 'check') return { ...roundRef(prev.id), taskId: prev.task ?? '' };
  return queryRef(prev.id, prev.id);
}

function trackBar(bar: typeof raw.runs[number]): TrackBarV1 {
  const owner = sessionRef(bar.session.sessionId);
  if (bar.kind === 'check') {
    return {
      kind: 'check', roundRef: { ...roundRef(bar.id), taskId: bar.task ?? '' }, taskId: bar.task ?? '',
      sessionRef: owner, ownerSessionRefs: [owner],
      startAt: bar.startAt, endAt: bar.endAt, result: CHECK_RESULT[bar.result] ?? 'INCONCLUSIVE',
      ordinal: bar.round ?? 1, checksBegun: bar.counts.ck, previous: previousRef(bar) as VerificationRoundRef | null,
    };
  }
  if (bar.kind === 'query' || bar.kind === 'talk') {
    const via = bar.kind === 'talk' ? 'turn' : (bar as { via?: string }).via === 'consultation' ? 'consultation' : 'turn';
    return {
      kind: 'query', queryRunRef: queryRef(bar.id, bar.id), sessionRef: owner,
      askedSessionRef: via === 'consultation' ? owner : null,
      via, startAt: bar.startAt, endAt: bar.endAt,
      result: QUERY_RESULT[bar.result] ?? 'unknown', activity: queryActivity(bar),
    };
  }
  return {
    kind: 'run', runRef: runRef(bar.id), taskId: bar.task ?? '', sessionRef: owner,
    startAt: bar.startAt, endAt: bar.endAt, result: RUN_RESULT[bar.result] ?? 'running',
    reason: bar.reason === '' ? null : bar.reason, pauses: [],
    attempt: {
      attemptId: bar.id + '-attempt', via: bar.attempt > 1 ? 'requeue' : 'first', ordinal: bar.attempt,
      requeue: bar.attempt > 1 ? { actorClass: 'human', automaticCount: null, reason: bar.gap ?? '',
        failureClass: 'check_failed', goalResume: false, requestedAt: bar.startAt, interruption: null } : null,
    },
    previous: previousRef(bar) as RunRef | null, activity: runActivity(bar),
  };
}

function trackPage(input: Record<string, unknown>): TrackBarsPageV1 {
  /* The real producer returns early with no Query bars when there is no
     `sessionRefs` filter (`scanQueries`: `refs === null`); only a filtered pass
     returns those Sessions' Query/talk bars and says `queriesIncluded:true`. */
  const refs = Array.isArray(input.sessionRefs) ? input.sessionRefs : null;
  const wanted = refs === null ? null : new Set(refs.map((ref) => String(one(ref).sessionId)));
  const bars = raw.runs
    .filter((bar) => wanted === null
      ? bar.kind !== 'query' && bar.kind !== 'talk'
      : (bar.kind === 'query' || bar.kind === 'talk') && wanted.has(bar.session.sessionId))
    .map(trackBar);
  return {
    goalRef,
    from: typeof input.from === 'string' ? input.from : raw.runs[0]?.startAt ?? raw.moments.main,
    to: typeof input.to === 'string' ? input.to : raw.moments.main,
    bars, next: null,
    hostRestarts: wanted === null
      ? raw.events.filter((event) => event.kind === 'restart').map((event) => ({ at: event.at, approximate: true }))
      : [],
    queriesIncluded: wanted !== null, unplaced: { runs: 0, rounds: 0, gateRounds: 0 },
  };
}

/* ------------------------------------------------------------------ calendar */

function calendarCell(cell: typeof raw.calendar.hours[number] | typeof raw.calendar.days[number], hour: boolean): ActivityCellV1 {
  return {
    localDate: cell.localDate, localHour: hour ? (cell as typeof raw.calendar.hours[number]).localHour : null,
    startAt: cell.startAt, endAt: cell.endAt, future: cell.future,
    steps: cell.steps, querySteps: 0, edits: cell.edits, editsUnknown: 0, checks: cell.checks,
    uncountedRuns: 0, inProgressRuns: 0, uncountedQueries: 0, inProgressQueries: 0, complete: cell.complete,
    tasks: cell.tasks.map((task) => ({ taskId: task.taskId, goalId: task.goalId, steps: 0, edits: 0, checks: 0 })),
    moreTasks: 0,
    sessions: (cell as { sessions?: SessionRef[] }).sessions
      ?? cell.lines.flatMap((name) => {
        const line = raw.lines.find((entry) => entry.name === name);
        return line === undefined ? [] : [sessionRef(line.sessionIds[0] ?? line.id.replace(/^L:/, ''))];
      }),
    moreSessions: 0,
  };
}

function calendarCoverage(): ActivityCalendarV1['coverage']['queries'] {
  return {
    runsCounted: 0, runsRecordedLate: 0, runsNotEntered: 0, runsInProgress: 0,
    runsUncounted: [], runsUnplaced: 0, checksUnplaced: 0,
    runsSessionUnknown: null, checksGateUnplaced: null,
  };
}

function calendar(input: Record<string, unknown>): ActivityCalendarV1 & { complete: true } {
  const hour = input.granularity === 'hour';
  const cells = hour ? raw.calendar.hours.map((cell) => calendarCell(cell, true))
    : raw.calendar.days.map((cell) => calendarCell(cell, false));
  const totals = cells.reduce((sum, cell) => ({
    steps: sum.steps + cell.steps, edits: sum.edits + cell.edits, checks: sum.checks + cell.checks,
  }), { steps: 0, edits: 0, checks: 0 });
  return {
    goalRef, from: typeof input.from === 'string' ? input.from : raw.moments.main,
    to: typeof input.to === 'string' ? input.to : raw.moments.main,
    granularity: hour ? 'hour' : 'day',
    timeZone: typeof input.timeZone === 'string' ? input.timeZone : 'Asia/Shanghai',
    now: raw.moments.main, cells,
    totals: { steps: totals.steps, querySteps: 0, edits: totals.edits, editsUnknown: 0, checks: totals.checks, complete: true },
    coverage: { ...calendarCoverage(), queries: calendarCoverage() },
    recordingSince: null, checksAttribution: 'round_start', complete: true,
  };
}

/* ------------------------------------------------------------------ timeline, executions, detail */

function timeline(): TaskStateTimelinePageV1 {
  return {
    goalRef, approximate: true,
    tasks: raw.timeline.map((task) => ({
      taskId: task.taskId,
      segments: task.segments.map((segment) => ({
        from: segment.from, to: segment.to, state: lit(segment.state), point: null,
      })),
      untimedPoints: [],
    })),
    next: null,
  };
}

function executions(): TaskExecutionPage {
  return { items: [], nextCursor: null, readThrough: null };
}

function nodeDetail(input: Record<string, unknown>): NodeDetailV1 {
  const node = one(input.node);
  const ref = one(node.ref);
  const taskId = String(ref.taskId ?? '');
  const section = String(input.section);
  if (section === 'participants') {
    return { section: 'participants', items: [], nextCursor: null, sourceCursor: CURSOR };
  }
  const task = taskOf(taskId);
  /* the summary's responsible line is the hover's (hoverTask), as one source in production */
  const owner = ownerLineOfTask(taskId);
  const graphNode: GraphNodeRefV1 = { kind: 'task', ref: { projectId: PROJECT, goalId: GOAL, taskId }, planRef };
  return {
    section: 'summary', node: graphNode, pin: { ref: planRef, revision: 1 },
    task: task === undefined ? null : {
      task: { projectId: PROJECT, goalId: GOAL, taskId }, planRef, title: task.title,
      phase: lit<Phase>(task.phase),
      phaseCause: task.phaseCause === null ? null : { code: phaseCauseCode(task.phaseCause.code) },
      disposition: lit<Disposition>(task.disposition),
      display: { neverRanTerminal: null, anomaly: null, attention: null },
      module: null, owners: owner === undefined ? [] : [lineBrief(owner)], participatedLines: { status: 'exact', value: 0 },
      plannedModules: [],
      actualFiles: { availability: 'unavailable', cause: 'not_recorded', reason: 'scene' },
      responsibleNow: owner === undefined ? [] : [lineBrief(owner)], responsibility: owner === undefined ? 'none' : 'has_responsibility',
    },
    group: null, goal: null, module: null, line: null,
    notes: { status: 'not_available', reason: 'no_note_anchor' },
    fileRisks: { availability: 'unavailable', cause: 'not_recorded', reason: 'scene' },
    sourceCursor: CURSOR,
  };
}

function lineDetail(input: Record<string, unknown>): WorkLineDetailV1 {
  const key = one(input.key);
  const sessionId = String(key.sessionId ?? '');
  const line = raw.lines.find((entry) => entry.sessionIds.includes(sessionId));
  if (line === undefined) throw new Error('scene has no line ' + sessionId);
  return {
    kind: 'line', row: lineRow(line),
    chain: line.sessionIds.map((id) => ({
      session: sessionRef(id), provenance: null, lifecycle: 'active', health: 'available',
      healthConclusion: null, createdAt: raw.plan.acceptedAt,
      archivedAt: line.archived ? raw.moments.main : null, responsibleOpen: [],
    })),
    omitted: { status: 'exact', value: 0 }, attentionAll: [],
    responsibility: 'none', gateChecks: [], sourceCursor: CURSOR,
  };
}

/* ------------------------------------------------------------------ replies */

function bootstrap(): BootstrapReply {
  return {
    workspaces: [{
      scope: { projectId: PROJECT, workspaceId: WORKSPACE }, name: '场景工作区',
      workspaceRevision: 1, writeAllowed: false, commandsAllowed: false,
    }],
    review: {}, execution: {}, changesHead: null,
  };
}

function registration(): { project: ProjectSnapshot; workspace: WorkspaceSnapshot } {
  return {
    project: { ref: { aggregateType: 'Project', projectId: PROJECT }, revision: 1 },
    workspace: { ref: workspaceRef, revision: 1, lineSettings: { schemaVersion: 1, pinned: [] } },
  };
}

function reply(route: string, input: unknown): SceneReply {
  const body = one(input);
  switch (route) {
    case 'bootstrap': return bootstrap() satisfies BootstrapReply;
    case 'goals/conflicts': return ({
      status: 'ready',
      value: { footprintCompleteness: [{ goalRef }] },
    } satisfies Ready<{ footprintCompleteness: Array<{ goalRef: typeof goalRef }> }>);
    case 'goals/read': return { status: 'ready', value: goalDetail() } satisfies Ready<GoalDetail>;
    case 'goals/display': return { status: 'ready', value: goalDisplay() } satisfies Ready<GoalDisplayRead>;
    case 'tasks/query': return { status: 'ready', value: taskGraph() } satisfies Ready<TaskGraph>;
    case 'lines/list': return { status: 'ready', value: activeLines() } satisfies Ready<WorkLineListV1>;
    case 'lines/archived': return { status: 'ready', value: archivedLines() } satisfies Ready<ArchivedLinePageV1>;
    case 'lines/read': return { status: 'ready', value: lineDetail(body) } satisfies Ready<WorkLineDetailV1>;
    case 'graph/hover': return { status: 'ready', value: graphHover() } satisfies Ready<GraphHoverReadV1>;
    case 'graph/detail': return { status: 'ready', value: nodeDetail(body) } satisfies Ready<NodeDetailV1>;
    case 'activity/track': return { status: 'ready', value: trackPage(body) } satisfies Ready<TrackBarsPageV1>;
    case 'activity/calendar': return { status: 'ready', value: calendar(body) } satisfies Ready<ActivityCalendarV1>;
    case 'tasks/timeline': return { status: 'ready', value: timeline() } satisfies Ready<TaskStateTimelinePageV1>;
    case 'executions/list': return { status: 'ready', value: executions() } satisfies Ready<TaskExecutionPage>;
    case 'workspaces/registration':
      return ({
        status: 'ready', value: registration(),
      } satisfies Ready<{ project: ProjectSnapshot; workspace: WorkspaceSnapshot }>);
    case 'architecture/read': return rejection('unavailable', 'the scene has no formal catalog');
    default: return rejection('not_found', 'the scene has no route ' + route);
  }
}

function rejection(code: string, reason: string): Rejected {
  return { status: 'rejected', code, reason };
}

export const scene = {
  now: '2026-10-04T14:15:00+08:00',
  reply,
};
