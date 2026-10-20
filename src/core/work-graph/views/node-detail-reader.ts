/**
 * Slice 2C node-detail and hover read model (spec §2, §3.12, L14, L15, LR5, LR6).
 *
 * `readGraphHover` reads one Goal's whole node set once (decision 17: the hover
 * only shows already-read data); `readNodeDetail` pages one node's section.
 * Both build their lines through the one shared `assembleLineBriefs` from
 * `work-line-reader.ts`: every read resolves its heads once with
 * `resolveContinuationLine` (L2/N2: either lifecycle, branch-aware) and calls
 * the assembly exactly once, so the hover's `owners` are byte-identical to
 * `lines/list` by construction (P4) and no shared Goal/task read is repeated.
 *
 * The `GoalExecutedFilesPort` mapping is frozen here (L15): a `not_available`
 * port answer becomes `unavailable`/`not_recorded` (never an empty list), a
 * read failure becomes `unavailable`/`read_failed` with the error code, and an
 * `available` answer is grouped per field. `possiblyIncomplete` is carried
 * through and makes the derived counts `partial` (never exact).
 *
 * Rule 3 / review item 2: a failed Run, archive-state or link read is never
 * turned into an empty fact. The hover keeps the affected node and records a
 * `problem`; the single-node reads propagate the rejection.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { AggregateRef, GoalDesiredState, GoalRef } from '../../../contracts/ledger.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { RunRef, RunSnapshot, TaskTriple, DispatchOutboxRef } from '../../../contracts/dispatch.js';
import type { ModuleContainment, ModuleDefinition } from '../../../contracts/architecture-catalog.js';
import type { PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GraphNodeRefV1 } from '../../../contracts/graph-context.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  ExecutedFileV1, FromExecutedFilesV1, GraphHoverReadV1, GroupHoverV1, LineBriefV1, LineCountV1,
  LineParticipationV1, ModuleHoverV1, NodeDetailRequestV1, NodeDetailV1, NodeNoteRowV1, NodeNotesV1, NodeRiskV1,
  TaskDisplayFactsV1,
  TaskHoverV1,
} from '../../../contracts/work-line.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { NoteAnchorV1 } from '../../../contracts/note.js';
import type { NoteListRequestV1, NoteListResultV1, NoteMemoryReadResult } from '../model/note-contracts.js';
import type { GoalExecutedFilesPort } from '../model/decision-contracts.js';
import type { PlanTaskPort, TaskRow } from '../model/plan-contracts.js';
import type { NodeDetailReadPort } from '../model/work-line-contracts.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { SessionAnomalyPort } from '../tasks/session-anomaly-service.js';
import {
  decodeSessionRecord, decodeSessionWorkLink, SESSION_LINKS_BY_TASK_LOOKUP,
  SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
} from '../sessions/session-record-codecs.js';
import { laterCursor, readCanonicalTaskFacts, RUN_BY_TASK_INDEX } from '../tasks/plan-readers.js';
import { decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../tasks/claim-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { storeFailureCode } from '../persistence/read-result-failures.js';
import { deriveTaskDisplayFacts, type LineTaskArchiveNextV1, type LineTaskFactV1 } from '../state/line-status.js';
import { pathOwnershipOf } from '../notes/note-path-ownership.js';
import {
  assembleLineBriefs, resolveContinuationLine, type StoreRead, type WorkLineReaderDeps, type WorkLineStore,
} from './work-line-reader.js';

/**
 * The notes read the node-detail column and the hover counts
 * call. The composition root wires the real `platform.notes.listNotes` (a model
 * contract read); `views` never imports the notes implementation.
 */
export type NodeNotesLookup = (ctx: CoreCallContext, request: NoteListRequestV1) =>
  Promise<NoteMemoryReadResult<NoteListResultV1>>;

export type NodeDetailReaderDeps = {
  records: WorkLineStore;
  plans: PlanTaskPort;
  catalog: ArchitectureCatalogPort;
  anomalies: SessionAnomalyPort;
  executedFiles: GoalExecutedFilesPort;
  /** P4: the line assembly deps; the hover's owners go through the same function as lines/list. */
  line: WorkLineReaderDeps;
  /** The `notes/list` read (the same `platform.notes` surface). */
  notes?: NodeNotesLookup;
};

const PAGE = 200;
const ZERO_CURSOR = 'c0000000000' as CommitCursor;
/** L1b-style guard: the anomaly index is paged to the end, but never unbounded. */
const MAX_ANOMALY_PAGES = 1000;

function keyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

/** A failed read as the port rejection the whole read returns (rule 3 / item 2). */
function storeRejection(read: { status: string; code?: string; reason?: string }): CoreRejection {
  if (read.status === 'rejected') {
    return { status: 'rejected', code: storeFailureCode({ code: read.code ?? 'unavailable' }),
      reason: read.reason ?? 'the read failed' };
  }
  if (read.status === 'not_found') return { status: 'rejected', code: 'not_found', reason: 'the record was not found' };
  return { status: 'rejected', code: 'incomplete', reason: 'the read is not ready' };
}

type NodeCursorSection = 'participants' | 'risks' | 'executions';

/**
 * The opaque `nextCursor` payloads of the node-detail sections. `executions`
 * carries the underlying `r4c-run-by-task` lookup `after` cursor; `participants`
 * carries the position in the current source sequence (the underlying
 * `session-links-by-task` lookup cursor, or the `r4c-run-by-task` lookup cursor
 * while the `claimed` source is paged — a cursor, never an offset over a whole
 * list built in memory) plus the line keys already emitted, preserving the
 * cross-source dedup; `risks` stays an offset because its item list is
 * genuinely derived from the shared in-memory task graph (`queryTaskGraph`)
 * plus the shared canonical Run read, where no per-item index produces the
 * order (`otherTasks` walks `graph.rows`).
 */
type NodeCursor =
  | { section: 'executions'; after: string | null }
  | { section: 'participants'; source: number; after: string | null; seen: string[] }
  | { section: 'risks'; offset: number };

const CURSOR_MISMATCH = 'cursor_mismatch' as const;

function encodeNodeCursor(cursor: NodeCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), 'utf8').toString('base64url');
}

/**
 * A malformed cursor and a cursor issued for another section are both
 * `invalid`/`cursor_mismatch` (the review residual's exact contract). The caller
 * turns the literal into the rejection.
 */
function decodeNodeCursor(cursor: string, section: 'participants'): Extract<NodeCursor, { section: 'participants' }> | typeof CURSOR_MISMATCH;
function decodeNodeCursor(cursor: string, section: 'risks'): Extract<NodeCursor, { section: 'risks' }> | typeof CURSOR_MISMATCH;
function decodeNodeCursor(cursor: string, section: 'executions'): Extract<NodeCursor, { section: 'executions' }> | typeof CURSOR_MISMATCH;
function decodeNodeCursor(cursor: string, section: NodeCursorSection): NodeCursor | typeof CURSOR_MISMATCH {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch { return CURSOR_MISMATCH; }
  if (typeof parsed !== 'object' || parsed === null || parsed['v'] !== 1 || parsed['section'] !== section) {
    return CURSOR_MISMATCH;
  }
  if (section === 'risks') {
    const offset = parsed['offset'];
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) return CURSOR_MISMATCH;
    return { section, offset };
  }
  if (section === 'executions') {
    const after = parsed['after'];
    if (after !== null && typeof after !== 'string') return CURSOR_MISMATCH;
    return { section, after: after as string | null };
  }
  const source = parsed['source'];
  const after = parsed['after'];
  const seen = parsed['seen'];
  if (typeof source !== 'number' || !Number.isInteger(source) || source < 0) return CURSOR_MISMATCH;
  if (after !== null && typeof after !== 'string') return CURSOR_MISMATCH;
  if (!Array.isArray(seen) || seen.some((entry) => typeof entry !== 'string')) return CURSOR_MISMATCH;
  return { section, source, after: after as string | null, seen: seen as string[] };
}

/** The `invalid`/`cursor_mismatch` rejection every section returns for a bad cursor. */
function cursorMismatch(): CoreRejection {
  return { status: 'rejected', code: 'invalid', reason: CURSOR_MISMATCH };
}

// -------------------------------------------------------------------------- //
// Executed files (L15)                                                       //
// -------------------------------------------------------------------------- //

type ExecutedFilesFacts =
  | { availability: 'available'; files: ExecutedFileV1[]; possiblyIncomplete: boolean; sourceCursor: CommitCursor | null }
  | { availability: 'unavailable'; cause: 'not_recorded' | 'read_failed'; reason: string };

async function readExecutedFiles(
  port: GoalExecutedFilesPort, ctx: CoreCallContext, goalRef: GoalRef,
): Promise<ExecutedFilesFacts> {
  const read = await port.readGoalExecutedFiles(ctx, { goalRef });
  if (read.status !== 'ready') {
    const reason = read.status === 'rejected' ? `${read.code}: ${read.reason}`
      : 'the executed-files port did not return a value';
    return { availability: 'unavailable', cause: 'read_failed', reason };
  }
  if (read.value.availability === 'not_available') {
    return { availability: 'unavailable', cause: 'not_recorded', reason: '执行改过的文件还没有记录（2B）' };
  }
  return { availability: 'available',
    files: read.value.files.map((file) => ({ runRef: file.runRef, path: file.path, certainty: file.certainty })),
    possiblyIncomplete: read.value.possiblyIncomplete, sourceCursor: read.value.sourceCursor };
}

function filesView<T>(facts: ExecutedFilesFacts, project: (files: ExecutedFileV1[], incomplete: boolean) => T): FromExecutedFilesV1<T> {
  if (facts.availability === 'unavailable') return facts;
  return { availability: 'available', value: project(facts.files, facts.possiblyIncomplete),
    possiblyIncomplete: facts.possiblyIncomplete, sourceCursor: facts.sourceCursor };
}

// -------------------------------------------------------------------------- //
// Task graph / runs / links                                                  //
// -------------------------------------------------------------------------- //

type Graph = { plan: PlanRevisionSnapshot; rows: TaskRow[] };

type GoalScope = { scope: WorkspaceScope; desiredState: GoalDesiredState };

/** The Goal's workspace and desired state (L19): a failed read is never `active`. */
async function goalScope(deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef): Promise<GoalScope | null> {
  const read = await deps.plans.queryGoal(ctx, goalRef);
  if (read.status !== 'ready') return null;
  return { scope: { projectId: goalRef.projectId, workspaceId: read.value.goal.workspaceRef.workspaceId } as WorkspaceScope,
    desiredState: read.value.goal.desiredState };
}

async function readGraph(deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef): Promise<Graph | null> {
  const read = await deps.plans.queryTaskGraph(ctx, { goalRef });
  if (read.status !== 'ready') return null;
  return { plan: read.value.plan, rows: read.value.tasks };
}

type TaskRuns = Map<string, RunSnapshot[]>;
/** The Task's canonical Runs plus the ledger watermark of that read (item 3(c)). */
type TaskRunsRead = { runs: TaskRuns; readThrough: CommitCursor };

/** Item 2: a failed canonical task-facts read is propagated, never an empty Run set. */
async function readRunsByTask(records: WorkLineStore, goalRef: GoalRef, plan: PlanRevisionSnapshot): Promise<ReadResult<TaskRunsRead>> {
  const read = await readCanonicalTaskFacts(records, goalRef, plan);
  if (read.status !== 'ready') return storeRejection(read);
  const out: TaskRuns = new Map();
  for (const [taskId, runs] of read.value.runsByTaskId) out.set(taskId, [...runs]);
  return { status: 'ready', value: { runs: out, readThrough: read.value.readThrough } };
}

function moduleOf(row: TaskRow): ModuleRef | null {
  const scope = row.definition.scope;
  return scope.kind === 'module' ? { projectId: row.ref.projectId, moduleId: scope.moduleRef } : null;
}

/** §3.12 stages group every scoped Task (module scope carries its stage too). */
function stageIdOf(row: TaskRow): string | null {
  const scope = row.definition.scope;
  return scope.kind === 'goal' ? null : scope.stageId;
}

/**
 * One bounded page of the `executions` section, straight from the
 * `r4c-run-by-task` index (the underlying lookup cursor). `after` is the index's
 * own exclusive `refKey` cursor, so a later page never re-reads earlier pages.
 */
type RunRefPage = { refs: RunRef[]; next: string | null; readThrough: CommitCursor | null };

async function runRefsByTask(
  records: WorkLineStore, goalRef: GoalRef, taskId: string, limit: number, after: string | null,
): Promise<ReadResult<RunRefPage>> {
  const page = await records.lookup({ index: RUN_BY_TASK_INDEX,
    values: [goalRef.projectId, goalRef.goalId, taskId], limit,
    ...(after === null ? {} : { after }) });
  if (page.status !== 'ready') return storeRejection(page);
  const refs: RunRef[] = [];
  for (const record of page.value.records) {
    try { refs.push(JSON.parse(record.refKey) as RunRef); } catch { /* not a Run refKey */ }
  }
  return { status: 'ready', value: { refs, next: page.value.next, readThrough: page.value.readThrough } };
}

/**
 * One bounded page of the `claimed` participant source, straight from the
 * `r4c-run-by-task` index. The page reads only its own Run records (for the
 * attempt id) and only their `DispatchOutboxEntry` records, so a later page
 * never touches an earlier page's Runs and the whole canonical Run history is
 * never loaded (item 5). Sessions are deduped within the page; the line keys
 * already emitted ride in the cursor so the cross-source dedup survives paging.
 */
type ClaimedCandidate = { session: SessionRef; via: 'claimed'; runKey: string };

async function claimedCandidatesByTask(
  records: WorkLineStore, task: TaskTriple, limit: number, after: string | null,
): Promise<ReadResult<{ candidates: ClaimedCandidate[]; next: string | null; readThrough: CommitCursor | null }>> {
  const page = await records.lookup({ index: RUN_BY_TASK_INDEX,
    values: [task.projectId, task.goalId, task.taskId], limit,
    ...(after === null ? {} : { after }) });
  if (page.status !== 'ready') return storeRejection(page);
  const pageKeys = [...new Set(page.value.records.map((record) => record.refKey))];
  let readThrough: CommitCursor | null = page.value.readThrough;
  const runKeys: string[] = [];
  const outboxByRun = new Map<string, DispatchOutboxRef>();
  if (pageKeys.length > 0) {
    const runsRead = await records.readMany(pageKeys);
    if (runsRead.status !== 'ready') return storeRejection(runsRead);
    readThrough = laterCursor(readThrough, runsRead.value.readThrough);
    const byKey = new Map(runsRead.value.records.map((record) => [record.refKey, record]));
    for (const key of pageKeys) {
      const record = byKey.get(key);
      if (record === undefined) continue;
      const decoded = decodeRun(record);
      if (!decoded.ok) continue;
      const run = decoded.value;
      if (run.task.projectId !== task.projectId || run.task.goalId !== task.goalId
        || run.task.taskId !== task.taskId) continue;
      runKeys.push(key);
      outboxByRun.set(key, { aggregateType: 'DispatchOutboxEntry', projectId: task.projectId,
        goalId: task.goalId, taskId: task.taskId, attemptId: run.attemptId });
    }
  }
  const candidates: ClaimedCandidate[] = [];
  if (runKeys.length > 0) {
    const outboxKeys = runKeys.map((key) => dispatchOutboxRefKey(outboxByRun.get(key)!));
    const outboxRead = await records.readMany(outboxKeys);
    if (outboxRead.status !== 'ready') return storeRejection(outboxRead);
    readThrough = laterCursor(readThrough, outboxRead.value.readThrough);
    const sessionByOutbox = new Map<string, SessionRef>();
    for (const record of outboxRead.value.records) {
      const decoded = decodeDispatchOutboxEntry(record);
      if (decoded.status !== 'decoded') continue;
      const session = decoded.value.claim.sessionRef;
      sessionByOutbox.set(record.refKey, { projectId: session.projectId, sessionId: session.sessionId });
    }
    const emittedSessions = new Set<string>();
    for (const runKey of runKeys) {
      const session = sessionByOutbox.get(dispatchOutboxRefKey(outboxByRun.get(runKey)!));
      if (session === undefined) continue;
      const sessionKey = keyOf(session);
      if (emittedSessions.has(sessionKey)) continue;
      emittedSessions.add(sessionKey);
      candidates.push({ session, via: 'claimed', runKey });
    }
  }
  return { status: 'ready', value: { candidates, next: page.value.next, readThrough } };
}

function terminalOf(row: TaskRow): boolean {
  return row.effectivePhase === 'satisfied' || row.disposition === 'cancelled' || row.disposition === 'superseded';
}

/** The last automatic/human requeue covering the task (AT2/AT3 of §3.4). */
function lastRequeueOf(row: TaskRow): LineTaskFactV1['lastRequeue'] {
  if (row.phaseCause?.code !== 'requeued' || row.rework === undefined) return null;
  const entry = row.rework.entries[row.rework.entries.length - 1];
  if (entry === undefined) return null;
  return { automatic: entry.automatic, failureClass: entry.failureClass, autoCount: entry.autoCount, cap: row.rework.cap };
}

/**
 * The one Task's archive-state fact. `count` is the outstanding-anchor count
 * (from the shared per-Goal `listSessionAnomalies` read, §3.12), `next` is the
 * authoritative `readTaskArchiveState` answer; a read failure is a `problem`,
 * never "no anchor".
 */
type TaskAnomalyFact = { count: number; next: LineTaskArchiveNextV1 | null; problem: { code: CoreError; reason: string } | null };

function anomalyFactOfRead(read: Awaited<ReturnType<SessionAnomalyPort['readTaskArchiveState']>>): TaskAnomalyFact {
  if (read.status !== 'ready') {
    const rejection = storeRejection(read);
    return { count: 0, next: null, problem: { code: rejection.code, reason: rejection.reason } };
  }
  return { count: read.value.pending.length, next: read.value.next, problem: null };
}

/**
 * §3.12 / L1b shared cost: the Goal's outstanding anchors are read once through
 * `listSessionAnomalies`; `readTaskArchiveState` runs only for Tasks that
 * actually have one (the same rule `work-line-reader.ts`'s `loadGoalAnomalies`
 * applies to a line). Without the shared index the hover called
 * `readTaskArchiveState` once per Task row. A failed list read returns `null`
 * so the caller can fall back to the exact per-Task read instead of inventing
 * "no anchors".
 */
async function readGoalAnomalyIndex(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef,
): Promise<Map<string, TaskAnomalyFact> | null> {
  const index = new Map<string, TaskAnomalyFact>();
  let after: string | undefined;
  for (let page = 0; page < MAX_ANOMALY_PAGES; page += 1) {
    const read = await deps.anomalies.listSessionAnomalies(ctx, { goalRef,
      page: { limit: 100, ...(after === undefined ? {} : { cursor: after }) } });
    if (read.status !== 'ready') return null;
    for (const item of read.value.items) {
      if (item.pickedUpBy !== null) continue;
      const key = keyOf(item.anchor.task);
      const current = index.get(key);
      if (current === undefined) index.set(key, { count: 1, next: null, problem: null });
      else current.count += 1;
    }
    if (read.value.nextCursor === null) break;
    after = read.value.nextCursor;
    if (page === MAX_ANOMALY_PAGES - 1) return null;
  }
  for (const [key, fact] of index) {
    const read = await deps.anomalies.readTaskArchiveState(ctx, JSON.parse(key) as TaskTriple);
    const resolved = anomalyFactOfRead(read);
    index.set(key, { count: fact.count, next: resolved.next, problem: resolved.problem });
  }
  return index;
}

const NO_ANCHOR_FACT: TaskAnomalyFact = { count: 0, next: null, problem: null };

async function displayOf(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, row: TaskRow, runs: readonly RunSnapshot[],
  planOrder: number, goalDesiredState: GoalDesiredState, anomalyFact?: TaskAnomalyFact,
): Promise<{ display: TaskDisplayFactsV1; problem: { code: CoreError; reason: string } | null }> {
  const fact = anomalyFact ?? anomalyFactOfRead(await deps.anomalies.readTaskArchiveState(ctx, row.ref));
  const anomaly: LineTaskFactV1['anomaly'] = fact.problem === null && fact.count > 0
    ? { pending: { status: 'exact', value: fact.count }, next: fact.next }
    : null;
  // §3.12 / L21 / item 8: the same production rule `lines/list` uses, with the
  // real Goal desired state, plan order and requeue facts (never hardcoded).
  const display = deriveTaskDisplayFacts({
    task: row.ref, title: row.definition.title, planOrder, goalDesiredState,
    phase: row.effectivePhase, phaseCause: row.phaseCause ?? null, disposition: row.disposition,
    everRan: runs.length > 0, terminal: terminalOf(row), lastRequeue: lastRequeueOf(row),
    module: moduleOf(row), anomaly, anomalyComplete: true, cards: [],
  });
  return { display, problem: fact.problem };
}

/** The open `responsible` Sessions of one Task. */
async function responsibleSessions(records: WorkLineStore, scope: WorkspaceScope, task: TaskTriple): Promise<ReadResult<SessionRef[]>> {
  return linkedSessions(records, scope, task, 'responsible', true);
}

async function linkedSessions(
  records: WorkLineStore, scope: WorkspaceScope, task: TaskTriple,
  relation: 'responsible' | 'participates' | 'investigated', openOnly: boolean,
): Promise<ReadResult<SessionRef[]>> {
  const refs: SessionRef[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({
      index: SESSION_LINKS_BY_TASK_LOOKUP,
      values: [scope.projectId, 'task', task.goalId, task.taskId, relation],
      ...(after === undefined ? {} : { after }),
      limit: PAGE,
    });
    // Item 2: a failed link page is propagated; it never becomes a shorter list.
    if (page.status !== 'ready') return storeRejection(page);
    for (const record of page.value.records) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') continue;
      if (openOnly && decoded.value.until !== null) continue;
      refs.push({ projectId: scope.projectId, sessionId: decoded.value.ref.sessionId });
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: refs };
}

type ClaimingSessions = { sessions: SessionRef[]; byRun: Map<string, SessionRef> };

/**
 * §3.12: the Sessions that claimed one Task's Runs, through their
 * `DispatchOutboxEntry`. `byRun` maps each Run refKey to its claiming Session so
 * file attribution can follow the writing Run forward to its line.
 */
async function claimingSessions(records: WorkLineStore, task: TaskTriple, runs: readonly RunSnapshot[]): Promise<ReadResult<ClaimingSessions>> {
  const outboxKeys = new Map<string, DispatchOutboxRef>();
  const runToOutbox = new Map<string, string>();
  for (const run of runs) {
    const ref: DispatchOutboxRef = { aggregateType: 'DispatchOutboxEntry', projectId: task.projectId,
      goalId: task.goalId, taskId: task.taskId, attemptId: run.attemptId };
    const outboxKey = dispatchOutboxRefKey(ref);
    outboxKeys.set(outboxKey, ref);
    runToOutbox.set(keyOf(run.ref), outboxKey);
  }
  if (outboxKeys.size === 0) return { status: 'ready', value: { sessions: [], byRun: new Map() } };
  const read = await records.readMany([...outboxKeys.keys()]);
  if (read.status !== 'ready') return storeRejection(read);
  const byOutbox = new Map<string, SessionRef>();
  for (const record of read.value.records) {
    const decoded = decodeDispatchOutboxEntry(record);
    if (decoded.status !== 'decoded') continue;
    const session = decoded.value.claim.sessionRef;
    byOutbox.set(record.refKey, { projectId: session.projectId, sessionId: session.sessionId });
  }
  const sessions = new Map<string, SessionRef>();
  const byRun = new Map<string, SessionRef>();
  for (const [runKey, outboxKey] of runToOutbox) {
    const session = byOutbox.get(outboxKey);
    if (session === undefined) continue;
    sessions.set(keyOf(session), session);
    byRun.set(runKey, session);
  }
  return { status: 'ready', value: { sessions: [...sessions.values()], byRun } };
}

type TaskParticipants = { sessions: SessionRef[]; byRun: Map<string, SessionRef> };

/** §3.12 `participatedLines`: every `session-links-by-task` Session (any relation, open or closed) plus claimed Sessions. */
async function participantsOf(
  records: WorkLineStore, scope: WorkspaceScope, task: TaskTriple, runs: readonly RunSnapshot[],
): Promise<ReadResult<TaskParticipants>> {
  const sessions = new Map<string, SessionRef>();
  for (const relation of ['responsible', 'participates', 'investigated'] as const) {
    const read = await linkedSessions(records, scope, task, relation, false);
    if (read.status !== 'ready') return read;
    for (const session of read.value) sessions.set(keyOf(session), session);
  }
  const claimed = await claimingSessions(records, task, runs);
  if (claimed.status !== 'ready') return claimed;
  for (const session of claimed.value.sessions) sessions.set(keyOf(session), session);
  return { status: 'ready', value: { sessions: [...sessions.values()], byRun: claimed.value.byRun } };
}

// -------------------------------------------------------------------------- //
// Shared line assembly (P4 / should-fix 1)                                   //
// -------------------------------------------------------------------------- //

/** One duty resolution per role reference for the whole read (should-fix 1). */
function memoDuty(line: WorkLineReaderDeps): WorkLineReaderDeps {
  const cache = new Map<string, ReturnType<WorkLineReaderDeps['dutyFor']>>();
  const dutyFor: WorkLineReaderDeps['dutyFor'] = (role, ctx) => {
    const key = keyOf(role);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const started = line.dutyFor(role, ctx);
    cache.set(key, started);
    return started;
  };
  return { ...line, dutyFor };
}

type HeadCache = Map<string, Promise<StoreRead<SessionRef[]>>>;

/**
 * L2/N2: the line head(s) of one Session through the shared
 * `resolveContinuationLine` (either lifecycle; a branch returns both heads).
 * Resolved at most once per session per read.
 */
function headsOf(records: WorkLineStore, scope: WorkspaceScope, session: SessionRef, cache: HeadCache): Promise<StoreRead<SessionRef[]>> {
  const key = keyOf(session);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const started = resolveContinuationLine(records, scope, session).then((read): StoreRead<SessionRef[]> => {
    if (read.status !== 'ready') return read;
    if (read.value.kind === 'cycle') return { status: 'ready', value: read.value.members };
    if (read.value.kind === 'branched') return { status: 'ready', value: read.value.heads };
    return { status: 'ready', value: [read.value.head] };
  });
  cache.set(key, started);
  return started;
}

async function resolveSessionHeads(
  records: WorkLineStore, scope: WorkspaceScope, sessions: Iterable<SessionRef>, cache: HeadCache,
): Promise<ReadResult<Map<string, SessionRef[]>>> {
  const out = new Map<string, SessionRef[]>();
  for (const session of sessions) {
    const key = keyOf(session);
    if (out.has(key)) continue;
    const read = await headsOf(records, scope, session, cache);
    if (read.status !== 'ready') return read;
    out.set(key, read.value);
  }
  return { status: 'ready', value: out };
}

type SessionBriefIndex = { bySession: Map<string, LineBriefV1[]>; byHead: Map<string, LineBriefV1> };

/** The one `assembleLineBriefs` call of a read, for every head any field needs. */
async function assembleSessionBriefs(
  line: WorkLineReaderDeps, ctx: CoreCallContext, workspace: WorkspaceScope, sessionHeads: Map<string, SessionRef[]>,
): Promise<ReadResult<SessionBriefIndex>> {
  const heads = new Map<string, SessionRef>();
  for (const list of sessionHeads.values()) for (const head of list) heads.set(keyOf(head), head);
  if (heads.size === 0) return { status: 'ready', value: { bySession: new Map(), byHead: new Map() } };
  const read = await assembleLineBriefs(line, ctx, { workspace, heads: [...heads.values()] });
  if (read.status !== 'ready') return read;
  const byHead = new Map(read.value.map((brief) => [keyOf(brief.key), brief]));
  const bySession = new Map<string, LineBriefV1[]>();
  for (const [sessionKey, list] of sessionHeads) {
    const briefs = list.map((head) => byHead.get(keyOf(head))).filter((brief): brief is LineBriefV1 => brief !== undefined);
    bySession.set(sessionKey, briefs);
  }
  return { status: 'ready', value: { bySession, byHead } };
}

function dedupeBriefs(briefs: Iterable<LineBriefV1>): LineBriefV1[] {
  const seen = new Map<string, LineBriefV1>();
  for (const brief of briefs) seen.set(keyOf(brief.key), brief);
  return [...seen.values()].sort((left, right) => (keyOf(left.key) < keyOf(right.key) ? -1 : keyOf(left.key) > keyOf(right.key) ? 1 : 0));
}

/** L20: the active, non-copy Sessions whose role resolves to `secretary`. */
async function secretaryCandidates(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, scope: WorkspaceScope, line: WorkLineReaderDeps,
): Promise<ReadResult<SessionRef[]>> {
  const found: SessionRef[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await deps.records.lookup({
      index: SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
      values: [scope.projectId, scope.workspaceId, 'active'],
      ...(after === undefined ? {} : { after }),
      limit: PAGE,
    });
    if (page.status !== 'ready') return storeRejection(page);
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded' || (decoded.value.provenance ?? null)?.kind === 'readonly_copy') continue;
      const duty = await line.dutyFor(decoded.value.role, ctx);
      if (duty.status !== 'ready') return storeRejection(duty);
      if (duty.value === 'secretary') found.push({ projectId: scope.projectId, sessionId: decoded.value.ref.sessionId });
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: found };
}

type LineIndexes = {
  ownerIndex: Map<string, LineBriefV1[]>;
  participationIndex: Map<string, LineBriefV1[]>;
  participationProblem: Map<string, string>;
  ownerProblem: Map<string, { code: CoreError; reason: string }>;
  sessionBriefs: Map<string, LineBriefV1[]>;
  runClaimer: Map<string, SessionRef>;
  goalOwners: LineBriefV1[];
  problems: GraphHoverReadV1['problems'];
};

/**
 * One read's line facts: every Task's owners and participants, the Goal's
 * secretary owners, and the one shared assembly. A per-Task link failure is
 * recorded as a problem and leaves an empty (never silently shorter) list; a
 * failure of the shared head walk or assembly is propagated.
 */
async function buildLineIndexes(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, scope: WorkspaceScope, goalRef: GoalRef,
  graph: Graph, runs: TaskRuns, line: WorkLineReaderDeps, headCache: HeadCache,
  extraSessions: readonly SessionRef[] = [],
): Promise<ReadResult<LineIndexes>> {
  const problems: GraphHoverReadV1['problems'] = [];
  const ownerSessions = new Map<string, SessionRef[]>();
  const participationSessions = new Map<string, SessionRef[]>();
  const participationProblem = new Map<string, string>();
  const ownerProblem = new Map<string, { code: CoreError; reason: string }>();
  const runClaimer = new Map<string, SessionRef>();
  const allSessions = new Map<string, SessionRef>();

  const addAll = (sessions: readonly SessionRef[]): void => {
    for (const session of sessions) allSessions.set(keyOf(session), session);
  };
  addAll(extraSessions);

  for (const row of graph.rows) {
    const node: GraphNodeRefV1 = { kind: 'task', ref: row.ref, planRef: graph.plan.ref };
    const taskKey = keyOf(row.ref);
    const owners = await responsibleSessions(deps.records, scope, row.ref);
    if (owners.status !== 'ready') {
      const problem = storeRejection(owners);
      problems.push({ node, code: problem.code, reason: problem.reason });
      ownerProblem.set(taskKey, { code: problem.code, reason: problem.reason });
      ownerSessions.set(taskKey, []);
    } else {
      ownerSessions.set(taskKey, owners.value);
      addAll(owners.value);
    }
    const participated = await participantsOf(deps.records, scope, row.ref, runs.get(row.ref.taskId) ?? []);
    if (participated.status !== 'ready') {
      const problem = storeRejection(participated);
      problems.push({ node, code: problem.code, reason: problem.reason });
      participationProblem.set(taskKey, problem.reason);
      participationSessions.set(taskKey, []);
    } else {
      participationSessions.set(taskKey, participated.value.sessions);
      addAll(participated.value.sessions);
      for (const [runKey, claimer] of participated.value.byRun) runClaimer.set(runKey, claimer);
    }
  }

  const secretary = await secretaryCandidates(deps, ctx, scope, line);
  if (secretary.status !== 'ready') {
    const problem = storeRejection(secretary);
    problems.push({ node: { kind: 'goal', ref: goalRef }, code: problem.code, reason: problem.reason });
  } else {
    addAll(secretary.value);
  }

  const resolved = await resolveSessionHeads(deps.records, scope, allSessions.values(), headCache);
  if (resolved.status !== 'ready') return resolved;
  const assembled = await assembleSessionBriefs(line, ctx, scope, resolved.value);
  if (assembled.status !== 'ready') return assembled;
  const { bySession } = assembled.value;
  const briefsOf = (session: SessionRef): LineBriefV1[] => bySession.get(keyOf(session)) ?? [];

  const ownerIndex = new Map<string, LineBriefV1[]>();
  for (const row of graph.rows) {
    const taskKey = keyOf(row.ref);
    ownerIndex.set(taskKey, dedupeBriefs((ownerSessions.get(taskKey) ?? []).flatMap(briefsOf)));
  }
  const participationIndex = new Map<string, LineBriefV1[]>();
  for (const row of graph.rows) {
    const taskKey = keyOf(row.ref);
    participationIndex.set(taskKey, dedupeBriefs((participationSessions.get(taskKey) ?? []).flatMap(briefsOf)));
  }

  // L20: the Goal's owners are the secretary lines whose latest Query targets
  // this Goal, read from the shared assembly's `name`, never every secretary.
  const goalOwners = new Map<string, LineBriefV1>();
  if (secretary.status === 'ready') {
    for (const session of secretary.value) {
      for (const brief of briefsOf(session)) {
        if (brief.name.source === 'secretary_interim' && brief.name.goalRef?.goalId === goalRef.goalId) {
          goalOwners.set(keyOf(brief.key), brief);
        }
      }
    }
  }

  return { status: 'ready', value: {
    ownerIndex, participationIndex, participationProblem, ownerProblem,
    sessionBriefs: bySession, runClaimer, goalOwners: dedupeBriefs(goalOwners.values()), problems,
  } };
}

// -------------------------------------------------------------------------- //
// Modules                                                                    //
// -------------------------------------------------------------------------- //

type ModuleCatalog = { modules: ModuleDefinition[]; containment: ModuleContainment };

async function readCatalog(deps: NodeDetailReaderDeps, ctx: CoreCallContext): Promise<ModuleCatalog | null> {
  const read = await deps.catalog.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  // No adopted architecture is a legitimate empty catalog (§3.12), not a read failure.
  if (read.status === 'not_found') return { modules: [], containment: { parentOf: [] } };
  if (read.status === 'rejected') {
    return read.code === 'not_found' ? { modules: [], containment: { parentOf: [] } } : null;
  }
  if (read.status === 'not_ready') return null;
  const adopted = read.value.catalog.catalog;
  return { modules: adopted.modules, containment: adopted.containment ?? { parentOf: [] } };
}

// RW-13/RW-16: the same all-module longest-prefix rule as `mapExecutedFilesToModules`
// and `moduleOfAnchor`, plus the module's declared containment children. A file is
// under the module when its single path owner is the module itself or one of
// `childrenOf(module, catalog)`; an equal-longest tie (or no owner) owns nothing.
type OwnershipScope = { candidates: { value: ModuleRef; paths: readonly string[] }[]; childKeys: ReadonlySet<string> };

function ownershipScopeOf(module: ModuleDefinition, catalog: ModuleCatalog): OwnershipScope {
  return { candidates: catalog.modules.map((candidate) => ({ value: candidate.ref, paths: candidate.paths })),
    childKeys: new Set(childrenOf(module, catalog).map((child) => keyOf(child.ref))) };
}

function underModule(path: string, module: ModuleDefinition, ownership: OwnershipScope): boolean {
  const result = pathOwnershipOf(path, ownership.candidates);
  if (result.status !== 'owner') return false;
  const ownerKey = keyOf(result.owner);
  return ownerKey === keyOf(module.ref) || ownership.childKeys.has(ownerKey);
}

/** §3.12: the declared children of a module (containment, never path inference). */
function childrenOf(parent: ModuleDefinition, catalog: ModuleCatalog): ModuleDefinition[] {
  const childKeys = new Set(catalog.containment.parentOf
    .filter((entry) => keyOf(entry.parent) === keyOf(parent.ref)).map((entry) => keyOf(entry.child)));
  return catalog.modules.filter((candidate) => childKeys.has(keyOf(candidate.ref)));
}

/** §3.12: the declared parent of a module (containment, never path inference). */
function parentOf(module: ModuleDefinition, containment: ModuleContainment): ModuleRef | null {
  const entry = containment.parentOf.find((candidate) => keyOf(candidate.child) === keyOf(module.ref));
  return entry?.parent ?? null;
}

function distinctRuns(runs: RunRef[]): RunRef[] {
  const seen = new Map<string, RunRef>();
  for (const run of runs) seen.set(keyOf(run), run);
  return [...seen.values()];
}

function moduleFiles(module: ModuleDefinition, ownership: OwnershipScope, facts: ExecutedFilesFacts): ModuleHoverV1['files'] {
  if (facts.availability === 'unavailable') return facts;
  const byPath = new Map<string, { certainty: 'definite' | 'possible'; runs: RunRef[] }>();
  for (const file of facts.files) {
    if (!underModule(file.path, module, ownership)) continue;
    const current = byPath.get(file.path);
    if (current === undefined) byPath.set(file.path, { certainty: file.certainty, runs: [file.runRef] });
    else { if (file.certainty === 'definite') current.certainty = 'definite'; current.runs.push(file.runRef); }
  }
  const value = [...byPath.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([path, entry]) => ({ path, certainty: entry.certainty, runs: distinctRuns(entry.runs) }));
  return { availability: 'available', value, possiblyIncomplete: facts.possiblyIncomplete, sourceCursor: facts.sourceCursor };
}

async function moduleHover(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, scope: WorkspaceScope, module: ModuleDefinition,
  catalog: ModuleCatalog, graph: Graph, runs: TaskRuns, facts: ExecutedFilesFacts,
  ownerIndex: Map<string, LineBriefV1[]>, sessionBriefs: Map<string, LineBriefV1[]>, runClaimer: Map<string, SessionRef>,
): Promise<ModuleHoverV1> {
  const ownership = ownershipScopeOf(module, catalog);
  const inScope = [module, ...childrenOf(module, catalog)];
  const selected = graph.rows.filter((row) => moduleOf(row) !== null
    && inScope.some((candidate) => keyOf(candidate.ref) === keyOf(moduleOf(row))));
  const unfinished = selected.filter((row) => !terminalOf(row));
  const lines = new Map<string, LineBriefV1>();
  for (const row of unfinished) for (const brief of ownerIndex.get(keyOf(row.ref)) ?? []) lines.set(keyOf(brief.key), brief);
  const working = [...lines.values()].filter((brief) => brief.status.bucket === 'working').length;

  // L15: `changedByLines` maps the writing Runs' CLAIMING Sessions to their
  // lines (same mapping as `participatedLines`), not the Task's current owners.
  let changedByLines: ModuleHoverV1['changedByLines'];
  if (facts.availability === 'unavailable') changedByLines = facts;
  else {
    const changed = new Map<string, LineBriefV1>();
    for (const file of facts.files) {
      if (!underModule(file.path, module, ownership)) continue;
      const claimer = runClaimer.get(keyOf(file.runRef));
      if (claimer === undefined) continue;
      for (const brief of sessionBriefs.get(keyOf(claimer)) ?? []) changed.set(keyOf(brief.key), brief);
    }
    const count: LineCountV1 = facts.possiblyIncomplete
      ? { status: 'partial', atLeast: changed.size, reason: '执行改过的文件可能不全' }
      : { status: 'exact', value: changed.size };
    changedByLines = { availability: 'available', value: count, possiblyIncomplete: facts.possiblyIncomplete, sourceCursor: facts.sourceCursor };
  }

  return { module: module.ref, parent: parentOf(module, catalog.containment), name: module.name,
    paths: module.paths, responsibility: module.responsibility, maintainer: { status: 'none' },
    unfinishedTasks: { status: 'exact', value: unfinished.length },
    workingLines: { status: 'exact', value: working }, lines: { status: 'exact', value: lines.size },
    changedByLines, files: moduleFiles(module, ownership, facts) };
}

function taskOfRun(run: RunRef, rows: readonly TaskRow[], runs: TaskRuns): TaskTriple | null {
  for (const row of rows) {
    if ((runs.get(row.ref.taskId) ?? []).some((candidate) => keyOf(candidate.ref) === keyOf(run))) return row.ref;
  }
  return null;
}

// -------------------------------------------------------------------------- //
// Hover                                                                      //
// -------------------------------------------------------------------------- //

function buildGroups(
  goalRef: GoalRef, planRef: PlanRevisionRef, rows: readonly TaskRow[], runs: TaskRuns,
  participationIndex: Map<string, LineBriefV1[]>, goalOwners: LineBriefV1[],
): GroupHoverV1[] {
  const build = (node: GroupHoverV1['node'], select: (row: TaskRow) => boolean): GroupHoverV1 => {
    const selected = rows.filter(select);
    let tasks = 0;
    let neverRan = 0;
    const lines = new Map<string, LineBriefV1>();
    for (const row of selected) {
      if (terminalOf(row) && (runs.get(row.ref.taskId) ?? []).length === 0) { neverRan += 1; continue; }
      tasks += 1;
      // §3.12: participatedLines is "lines that did tasks here", not just current owners.
      for (const brief of participationIndex.get(keyOf(row.ref)) ?? []) lines.set(keyOf(brief.key), brief);
    }
    return { node, tasks: { status: 'exact', value: tasks }, neverRanTerminal: { status: 'exact', value: neverRan },
      participatedLines: { status: 'exact', value: lines.size },
      workingLines: { status: 'exact', value: [...lines.values()].filter((b) => b.status.bucket === 'working').length },
      pausedLines: { status: 'exact', value: [...lines.values()].filter((b) => b.status.own === 'paused').length },
      owners: node.kind === 'goal' ? goalOwners : [] };
  };
  const stages = [...new Set(rows.flatMap((row) => { const stageId = stageIdOf(row); return stageId === null ? [] : [stageId]; }))].sort();
  return [
    build({ kind: 'goal', ref: goalRef }, () => true),
    ...stages.map((stageId) => build(
      { kind: 'stage', planRef, stageId },
      (row) => stageIdOf(row) === stageId)),
  ];
}

async function assembleHover(deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef): Promise<ReadResult<GraphHoverReadV1>> {
  const goal = await goalScope(deps, ctx, goalRef);
  if (goal === null) return { status: 'rejected', code: 'unavailable', reason: 'queryGoal did not return the Goal' };
  const scope = goal.scope;
  const graph = await readGraph(deps, ctx, goalRef);
  if (graph === null) return { status: 'rejected', code: 'unavailable', reason: 'queryTaskGraph did not return the goal task graph' };
  const runsRead = await readRunsByTask(deps.records, goalRef, graph.plan);
  if (runsRead.status !== 'ready') return runsRead; // item 2: propagate the shared Run failure
  const runs = runsRead.value.runs;
  const facts = await readExecutedFiles(deps.executedFiles, ctx, goalRef);
  const line = memoDuty(deps.line);
  const indexes = await buildLineIndexes(deps, ctx, scope, goalRef, graph, runs, line, new Map());
  if (indexes.status !== 'ready') return indexes;
  const { ownerIndex, participationIndex, participationProblem, goalOwners, sessionBriefs, runClaimer, problems } = indexes.value;

  const catalog = await readCatalog(deps, ctx);
  if (catalog === null) return { status: 'rejected', code: 'unavailable', reason: 'the architecture catalog read failed' };

  // §3.12 / L1b shared cost: one per-Goal anchor index; `readTaskArchiveState`
  // is called from the index only for Tasks with an outstanding anchor. A
  // failed index read falls back to the exact per-Task read (never "no anchor").
  const anomalyIndex = await readGoalAnomalyIndex(deps, ctx, goalRef);

  const tasks: TaskHoverV1[] = [];
  for (const row of graph.rows) {
    const taskRuns = runs.get(row.ref.taskId) ?? [];
    const participated = participationIndex.get(keyOf(row.ref)) ?? [];
    const failure = participationProblem.get(keyOf(row.ref));
    const anomalyFact = anomalyIndex === null ? undefined : (anomalyIndex.get(keyOf(row.ref)) ?? NO_ANCHOR_FACT);
    const display = await displayOf(deps, ctx, row, taskRuns, graph.rows.indexOf(row), goal.desiredState, anomalyFact);
    if (display.problem !== null) problems.push({ node: { kind: 'task', ref: row.ref, planRef: graph.plan.ref }, ...display.problem });
    tasks.push({ task: row.ref, planRef: graph.plan.ref, title: row.definition.title, phase: row.effectivePhase,
      phaseCause: row.phaseCause ?? null, disposition: row.disposition, display: display.display,
      module: moduleOf(row), owners: ownerIndex.get(keyOf(row.ref)) ?? [],
      participatedLines: failure === undefined
        ? { status: 'exact', value: participated.length }
        : { status: 'partial', atLeast: participated.length, reason: failure } });
  }

  const moduleHovers: ModuleHoverV1[] = [];
  for (const module of catalog.modules) {
    moduleHovers.push(await moduleHover(deps, ctx, scope, module, catalog, graph, runs, facts, ownerIndex, sessionBriefs, runClaimer));
  }

  const files = filesView(facts, (entries) => {
    const byPath = new Map<string, TaskTriple[]>();
    for (const entry of entries) {
      const task = taskOfRun(entry.runRef, graph.rows, runs);
      if (task === null) continue;
      const list = byPath.get(entry.path) ?? [];
      if (!list.some((candidate) => keyOf(candidate) === keyOf(task))) list.push(task);
      byPath.set(entry.path, list);
    }
    return [...byPath.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1)).map(([path, list]) => ({ path, tasks: list }));
  });

  const groups = buildGroups(goalRef, graph.plan.ref, graph.rows, runs, participationIndex, goalOwners);
  // L21: the hover card only shows a note count per hovered node.
  const noteCounts = await collectHoverNoteCounts(deps, ctx, goalRef, graph.plan, graph.rows, catalog.modules);
  return { status: 'ready', value: { goalRef, groups, tasks, modules: moduleHovers, files, noteCounts, problems, sourceCursor: ZERO_CURSOR } };
}

// -------------------------------------------------------------------------- //
// Node detail                                                                //
// -------------------------------------------------------------------------- //

function pinOf(ref: unknown): { ref: AggregateRef; revision: number } {
  return { ref: ref as AggregateRef, revision: 0 };
}

function taskRefOf(node: GraphNodeRefV1): { task: TaskTriple; planRef: PlanRevisionRef } | null {
  return node.kind === 'task' ? { task: node.ref, planRef: node.planRef } : null;
}

// -------------------------------------------------------------------------- //
// The node notes column and the hover note counts                            //
// -------------------------------------------------------------------------- //

/** The note anchor a node maps to, or null for Session, Run and round nodes. */
function noteAnchorOf(node: GraphNodeRefV1, goalRef: GoalRef, planRevision: number): NoteAnchorV1 | null {
  if (node.kind === 'goal') return { kind: 'goal', goalId: goalRef.goalId };
  if (node.kind === 'stage') {
    // The stage anchor takes the goal's CURRENT plan revision (answer 6).
    return { kind: 'stage', goalId: goalRef.goalId, planRevision, stageId: node.stageId };
  }
  if (node.kind === 'task') return { kind: 'task', goalId: node.ref.goalId, taskId: node.ref.taskId };
  if (node.kind === 'module') return { kind: 'module', moduleId: node.ref.moduleId };
  return null;
}

function nodeNoteRow(row: NoteListResultV1['items'][number]): NodeNoteRowV1 {
  return row;
}

/**
 * The node's notes column (L21): the anchor's current understanding (goal/stage
 * only, `null` otherwise) plus the first `lookup` page. Session/Run/round nodes
 * have no anchor. A missing or non-ready notes read is `unavailable`, never an
 * empty `available` page (RW-11), matching `hoverNoteCount`.
 */
async function nodeNotesOf(deps: NodeDetailReaderDeps, ctx: CoreCallContext, node: GraphNodeRefV1,
  goalRef: GoalRef, planRevision: number, limit: number): Promise<NodeNotesV1> {
  const anchor = noteAnchorOf(node, goalRef, planRevision);
  if (anchor === null) return { status: 'not_available', reason: 'no_note_anchor' };
  if (deps.notes === undefined) return { status: 'unavailable', reason: 'the notes read is not wired' };
  const read = await deps.notes(ctx, { anchor, limit, cursor: null });
  if (read.status !== 'ready') return { status: 'unavailable', reason: 'the notes read failed' };
  return { status: 'available', understanding: read.value.understanding ?? null,
    items: read.value.items.map(nodeNoteRow), next: read.value.next, complete: read.value.complete };
}

/** The hover card's per-node note count (决定 35 · Q23); full rows are never read. */
async function hoverNoteCount(deps: NodeDetailReaderDeps, ctx: CoreCallContext, node: GraphNodeRefV1,
  goalRef: GoalRef, planRevision: number): Promise<LineCountV1> {
  const anchor = noteAnchorOf(node, goalRef, planRevision);
  if (anchor === null) return { status: 'unavailable', reason: 'no_note_anchor' };
  if (deps.notes === undefined) return { status: 'unavailable', reason: 'the notes read is not wired' };
  const read = await deps.notes(ctx, { anchor, limit: 1, cursor: null });
  if (read.status !== 'ready') return { status: 'unavailable', reason: 'the notes read failed' };
  return read.value.complete
    ? { status: 'exact', value: read.value.items.length }
    : { status: 'partial', atLeast: read.value.items.length, reason: 'notes continue past this page' };
}

async function collectHoverNoteCounts(deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef,
  plan: PlanRevisionSnapshot, rows: readonly TaskRow[], modules: readonly ModuleDefinition[]):
Promise<{ node: GraphNodeRefV1; count: LineCountV1 }[]> {
  const nodes: GraphNodeRefV1[] = [];
  nodes.push({ kind: 'goal', ref: goalRef });
  for (const stage of plan.stages) nodes.push({ kind: 'stage', planRef: plan.ref, stageId: stage.stageId });
  for (const row of rows) nodes.push({ kind: 'task', ref: row.ref, planRef: plan.ref });
  for (const module of modules) nodes.push({ kind: 'module', ref: module.ref });
  const out: { node: GraphNodeRefV1; count: LineCountV1 }[] = [];
  for (const node of nodes) {
    out.push({ node, count: await hoverNoteCount(deps, ctx, node, goalRef, plan.planRevision) });
  }
  return out;
}

/**
 * §3.12: the Goal's anchor count, read by indexed pagination to the end. A
 * truncated first page is never an exact total; a failed later page is
 * `partial` with the confirmed lower bound.
 */
async function anomalyCount(deps: NodeDetailReaderDeps, ctx: CoreCallContext, goalRef: GoalRef, taskId?: string): Promise<LineCountV1> {
  let total = 0;
  let after: string | undefined;
  for (let page = 0; page < MAX_ANOMALY_PAGES; page += 1) {
    const read = await deps.anomalies.listSessionAnomalies(ctx, { goalRef,
      ...(taskId === undefined ? {} : { taskId }),
      page: { limit: 100, ...(after === undefined ? {} : { cursor: after }) } });
    if (read.status !== 'ready') {
      const problem = storeRejection(read);
      return { status: 'partial', atLeast: total, reason: `${problem.code}: ${problem.reason}` };
    }
    total += read.value.items.length;
    if (read.value.nextCursor === null) return { status: 'exact', value: total };
    after = read.value.nextCursor;
  }
  return { status: 'partial', atLeast: total, reason: 'the anomaly index did not end' };
}

/** The relevant Task rows of a non-task participant node. */
function tasksOfNode(node: GraphNodeRefV1, rows: readonly TaskRow[]): TaskRow[] {
  if (node.kind === 'goal') return [...rows];
  if (node.kind === 'stage') return rows.filter((row) => stageIdOf(row) === node.stageId);
  return [];
}

/**
 * One source of the `participants` item order: the `session-links-by-task`
 * lookup for one (Task, relation), or the Task's claimed Sessions. The order is
 * exactly the item order: `graph.rows` order, then responsible → participates →
 * investigated → claimed.
 */
type ParticipantSource = { task: TaskRow; relation: 'responsible' | 'participates' | 'investigated' | 'claimed'; openOnly: boolean };
const PARTICIPANT_RELATIONS = ['responsible', 'participates', 'investigated'] as const;
type ParticipantCandidate = { session: SessionRef; via: LineParticipationV1['relation'] };

function participantSources(
  node: GraphNodeRefV1, graph: Graph, catalog: ModuleCatalog | null,
): { sources: ParticipantSource[] } | { notFound: true } {
  const withClaims = (task: TaskRow): ParticipantSource[] => [
    ...PARTICIPANT_RELATIONS.map((relation) => ({ task, relation, openOnly: false })),
    { task, relation: 'claimed' as const, openOnly: false },
  ];
  if (node.kind === 'task') {
    const task = graph.rows.find((row) => keyOf(row.ref) === keyOf(node.ref));
    return task === undefined ? { notFound: true } : { sources: withClaims(task) };
  }
  if (node.kind === 'module') {
    if (catalog === null) return { notFound: true };
    const module = catalog.modules.find((candidate) => keyOf(candidate.ref) === keyOf(node.ref));
    if (module === undefined) return { notFound: true };
    const inScope = [module, ...childrenOf(module, catalog)];
    const selected = graph.rows.filter((row) => moduleOf(row) !== null
      && inScope.some((candidate) => keyOf(candidate.ref) === keyOf(moduleOf(row))));
    // §3.12: module participants are the lines with an OPEN responsible link to
    // a task planned here (same `responsibleSessions` filter the old path used).
    return { sources: selected.map((task) => ({ task, relation: 'responsible' as const, openOnly: true })) };
  }
  if (node.kind === 'goal' || node.kind === 'stage') {
    return { sources: tasksOfNode(node, graph.rows).flatMap(withClaims) };
  }
  return { sources: [] };
}

/**
 * Assemble the candidate Sessions of one source and append the line briefs that
 * were not emitted before (`seen`, carried in the cursor so the cross-source
 * dedup survives paging). Returns how many candidates were consumed; a prefix
 * when `limit` was reached mid-candidate.
 */
async function appendParticipantBriefs(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, scope: WorkspaceScope, line: WorkLineReaderDeps,
  candidates: readonly ParticipantCandidate[], seen: Set<string>,
  items: (LineBriefV1 & { via: LineParticipationV1['relation'] })[], limit: number,
): Promise<ReadResult<number>> {
  if (candidates.length === 0) return { status: 'ready', value: 0 };
  const resolved = await resolveSessionHeads(deps.records, scope, candidates.map((candidate) => candidate.session), new Map());
  if (resolved.status !== 'ready') return resolved;
  const assembled = await assembleSessionBriefs(line, ctx, scope, resolved.value);
  if (assembled.status !== 'ready') return assembled;
  const bySession = assembled.value.bySession;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    for (const brief of bySession.get(keyOf(candidate.session)) ?? []) {
      if (items.length >= limit) return { status: 'ready', value: index };
      const key = keyOf(brief.key);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...brief, via: candidate.via });
    }
  }
  return { status: 'ready', value: candidates.length };
}

/**
 * §3.12 participants, paged by the current source's underlying index cursor
 * (one bounded lookup page per source, `r4c-run-by-task` while the `claimed`
 * source is walked), never an offset over a whole list built in memory. The
 * line keys already emitted ride in the cursor, and the returned `sourceCursor`
 * is the real watermark of this page's own reads (item 3(c)).
 */
async function participantsSection(
  deps: NodeDetailReaderDeps, ctx: CoreCallContext, scope: WorkspaceScope, input: NodeDetailRequestV1,
  graph: Graph, line: WorkLineReaderDeps, cursor: Extract<NodeCursor, { section: 'participants' }>,
): Promise<ReadResult<NodeDetailV1>> {
  const node = input.node;
  const catalog = node.kind === 'module' ? await readCatalog(deps, ctx) : null;
  if (node.kind === 'module' && catalog === null) {
    return { status: 'rejected', code: 'unavailable', reason: 'the architecture catalog read failed' };
  }
  const built = participantSources(node, graph, catalog);
  if ('notFound' in built) return { status: 'not_found' };
  const sources = built.sources;
  const limit = input.page.limit;
  const seen = new Set(cursor.seen);
  const items: (LineBriefV1 & { via: LineParticipationV1['relation'] })[] = [];
  let sourceIndex = cursor.source;
  let after = cursor.after;
  let readThrough: CommitCursor | null = null;
  let nextCursor: string | null = null;

  while (sourceIndex < sources.length && items.length < limit) {
    const source = sources[sourceIndex]!;
    if (source.relation === 'claimed') {
      // Item 5: the claiming source pages through its own `r4c-run-by-task`
      // index cursor; each page reads only that page's Run and outbox records.
      while (items.length < limit) {
        const page = await claimedCandidatesByTask(deps.records, source.task.ref, limit - items.length, after);
        if (page.status !== 'ready') return page;
        readThrough = laterCursor(readThrough, page.value.readThrough);
        const emitted = await appendParticipantBriefs(deps, ctx, scope, line, page.value.candidates, seen, items, limit);
        if (emitted.status !== 'ready') return emitted;
        if (items.length >= limit) {
          // Resume after the last consumed candidate's Run; a duplicate session
          // re-scanned by the next page is deduped through `seen`.
          const last = page.value.candidates[emitted.value - 1];
          const resumeAfter = emitted.value < page.value.candidates.length
            ? last?.runKey ?? after
            : page.value.next;
          if (resumeAfter !== null) {
            nextCursor = encodeNodeCursor({ section: 'participants', source: sourceIndex, after: resumeAfter, seen: [...seen] });
          }
          break;
        }
        if (page.value.next === null) break;
        after = page.value.next;
      }
      if (nextCursor !== null) break;
      sourceIndex += 1; after = null;
      continue;
    }
    const page = await deps.records.lookup({ index: SESSION_LINKS_BY_TASK_LOOKUP,
      values: [scope.projectId, 'task', source.task.ref.goalId, source.task.ref.taskId, source.relation],
      limit: limit - items.length, ...(after === null ? {} : { after }) });
    if (page.status !== 'ready') return storeRejection(page);
    readThrough = laterCursor(readThrough, page.value.readThrough);
    const candidates: (ParticipantCandidate & { refKey: string })[] = [];
    for (const record of page.value.records) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') continue;
      if (source.openOnly && decoded.value.until !== null) continue;
      candidates.push({ session: { projectId: scope.projectId, sessionId: decoded.value.ref.sessionId },
        via: source.relation, refKey: record.refKey });
    }
    const emitted = await appendParticipantBriefs(deps, ctx, scope, line, candidates, seen, items, limit);
    if (emitted.status !== 'ready') return emitted;
    if (items.length >= limit) {
      if (emitted.value < candidates.length) {
        const resumeAfter = emitted.value === 0 ? after : candidates[emitted.value - 1]!.refKey;
        nextCursor = encodeNodeCursor({ section: 'participants', source: sourceIndex, after: resumeAfter, seen: [...seen] });
      } else if (page.value.next !== null) {
        nextCursor = encodeNodeCursor({ section: 'participants', source: sourceIndex, after: page.value.next, seen: [...seen] });
      } else if (sourceIndex + 1 < sources.length) {
        nextCursor = encodeNodeCursor({ section: 'participants', source: sourceIndex + 1, after: null, seen: [...seen] });
      }
      break;
    }
    if (page.value.next !== null) after = page.value.next;
    else { sourceIndex += 1; after = null; }
  }
  return { status: 'ready', value: { section: 'participants', items, nextCursor, sourceCursor: readThrough ?? ZERO_CURSOR } };
}

async function readSummary(deps: NodeDetailReaderDeps, ctx: CoreCallContext, input: NodeDetailRequestV1): Promise<ReadResult<NodeDetailV1>> {
  const goalRef = input.goalRef;
  const goal = await goalScope(deps, ctx, goalRef);
  if (goal === null) return { status: 'rejected', code: 'unavailable', reason: 'queryGoal did not return the Goal' };
  const scope = goal.scope;
  const graph = await readGraph(deps, ctx, goalRef);
  if (graph === null) return { status: 'rejected', code: 'unavailable', reason: 'queryTaskGraph did not return the goal task graph' };
  const runsRead = await readRunsByTask(deps.records, goalRef, graph.plan);
  if (runsRead.status !== 'ready') return runsRead;
  const runs = runsRead.value.runs;
  const facts = await readExecutedFiles(deps.executedFiles, ctx, goalRef);
  const line = memoDuty(deps.line);
  const extraSessions = input.node.kind === 'session' ? [input.node.ref] : [];
  const indexes = await buildLineIndexes(deps, ctx, scope, goalRef, graph, runs, line, new Map(), extraSessions);
  if (indexes.status !== 'ready') return indexes;
  const { ownerIndex, participationIndex, goalOwners, sessionBriefs, runClaimer, problems } = indexes.value;
  // A single-node read propagates the first per-Task problem (rule 3 / item 2).
  if (problems.length > 0) return { status: 'rejected', code: problems[0]!.code, reason: problems[0]!.reason };

  if (input.node.kind === 'task') {
    const row = graph.rows.find((candidate) => keyOf(candidate.ref) === keyOf(input.node.kind === 'task' ? input.node.ref : null));
    if (row === undefined) return { status: 'not_found' };
    const taskRuns = runs.get(row.ref.taskId) ?? [];
    const actualFiles = filesView(facts, (entries) => entries
      .filter((entry) => taskRuns.some((run) => keyOf(run.ref) === keyOf(entry.runRef)))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : keyOf(left.runRef) < keyOf(right.runRef) ? -1 : 1)));
    const risks = fileRisksView(row, graph.rows, runs, facts, graph.plan);
    const owners = ownerIndex.get(keyOf(row.ref)) ?? [];
    const display = await displayOf(deps, ctx, row, taskRuns, graph.rows.indexOf(row), goal.desiredState);
    if (display.problem !== null) return { status: 'rejected', code: display.problem.code, reason: display.problem.reason };
    return { status: 'ready', value: {
      section: 'summary', node: input.node, pin: pinOf(row.ref),
      task: {
        task: row.ref, planRef: graph.plan.ref, title: row.definition.title, phase: row.effectivePhase,
        phaseCause: row.phaseCause ?? null, disposition: row.disposition, display: display.display,
        module: moduleOf(row), owners, participatedLines: { status: 'exact', value: (participationIndex.get(keyOf(row.ref)) ?? []).length },
        plannedModules: moduleOf(row) === null ? [] : [moduleOf(row)!],
        actualFiles, responsibleNow: owners, responsibility: owners.length === 0 ? 'none' : 'has_responsibility',
      },
      group: null, goal: null, module: null, line: null,
      notes: await nodeNotesOf(deps, ctx, input.node, goalRef, graph.plan.planRevision, input.page.limit),
      fileRisks: risks, sourceCursor: ZERO_CURSOR,
    } };
  }

  if (input.node.kind === 'goal' || input.node.kind === 'stage') {
    const groups = buildGroups(goalRef, graph.plan.ref, graph.rows, runs, participationIndex, goalOwners);
    const group = groups.find((candidate) => input.node.kind === 'goal'
      ? candidate.node.kind === 'goal'
      : candidate.node.kind === 'stage' && candidate.node.stageId === (input.node.kind === 'stage' ? input.node.stageId : '')) ?? groups[0]!;
    const count = await anomalyCount(deps, ctx, goalRef);
    return { status: 'ready', value: {
      section: 'summary', node: input.node, pin: pinOf(goalRef), task: null, group,
      goal: { anomalyCount: count, workingLines: group.workingLines }, module: null, line: null,
      notes: await nodeNotesOf(deps, ctx, input.node, goalRef, graph.plan.planRevision, input.page.limit),
      fileRisks: filesView(facts, () => ({ riskCount: { status: 'exact', value: 0 } })), sourceCursor: ZERO_CURSOR,
    } };
  }

  if (input.node.kind === 'module') {
    const catalog = await readCatalog(deps, ctx);
    if (catalog === null) return { status: 'rejected', code: 'unavailable', reason: 'the architecture catalog read failed' };
    const module = catalog.modules.find((candidate) => keyOf(candidate.ref) === keyOf(input.node.kind === 'module' ? input.node.ref : null));
    if (module === undefined) return { status: 'not_found' };
    return { status: 'ready', value: {
      section: 'summary', node: input.node, pin: pinOf(module.ref), task: null, group: null, goal: null,
      module: await moduleHover(deps, ctx, scope, module, catalog, graph, runs, facts, ownerIndex, sessionBriefs, runClaimer),
      line: null,
      notes: await nodeNotesOf(deps, ctx, input.node, goalRef, graph.plan.planRevision, input.page.limit),
      fileRisks: filesView(facts, () => ({ riskCount: { status: 'exact', value: 0 } })), sourceCursor: ZERO_CURSOR,
    } };
  }

  if (input.node.kind === 'session') {
    // The target Session was included in the one shared assembly above.
    const brief = (sessionBriefs.get(keyOf(input.node.ref)) ?? [])[0] ?? null;
    return { status: 'ready', value: {
      section: 'summary', node: input.node, pin: pinOf(input.node.ref), task: null, group: null, goal: null,
      module: null, line: brief,
      notes: await nodeNotesOf(deps, ctx, input.node, goalRef, graph.plan.planRevision, input.page.limit),
      fileRisks: filesView(facts, () => ({ riskCount: { status: 'exact', value: 0 } })), sourceCursor: ZERO_CURSOR,
    } };
  }

  return { status: 'rejected', code: 'unsupported', reason: `the ${input.node.kind} summary is not part of slice 2C` };
}

/** §3.12 risks: non-terminal, no direct edge, same planned module or shared file. */
function fileRisksView(
  row: TaskRow, rows: readonly TaskRow[], runs: TaskRuns, facts: ExecutedFilesFacts, plan: PlanRevisionSnapshot,
): FromExecutedFilesV1<{ riskCount: LineCountV1 }> {
  if (facts.availability === 'unavailable') return facts;
  const ownRuns = runs.get(row.ref.taskId) ?? [];
  const ownPaths = new Set(facts.files.filter((file) => ownRuns.some((run) => keyOf(run.ref) === keyOf(file.runRef)))
    .map((file) => file.path));
  const shared = otherTasks(row, rows).filter((candidate) => {
    if (directEdge(row, candidate, plan)) return false;
    const candidateRuns = runs.get(candidate.ref.taskId) ?? [];
    return facts.files.some((file) => ownPaths.has(file.path)
      && candidateRuns.some((run) => keyOf(run.ref) === keyOf(file.runRef)));
  });
  const value: LineCountV1 = facts.possiblyIncomplete
    ? { status: 'partial', atLeast: shared.length, reason: '执行改过的文件可能不全' }
    : { status: 'exact', value: shared.length };
  return { availability: 'available', value: { riskCount: value }, possiblyIncomplete: facts.possiblyIncomplete, sourceCursor: facts.sourceCursor };
}

function otherTasks(row: TaskRow, rows: readonly TaskRow[]): TaskRow[] {
  return rows.filter((candidate) => keyOf(candidate.ref) !== keyOf(row.ref) && !terminalOf(candidate));
}

function directEdge(left: TaskRow, right: TaskRow, plan: PlanRevisionSnapshot): boolean {
  return plan.executionDag.dependsOn.some((edge) =>
    (edge.taskId === left.ref.taskId && edge.dependsOnId === right.ref.taskId)
    || (edge.taskId === right.ref.taskId && edge.dependsOnId === left.ref.taskId));
}

async function readSection(deps: NodeDetailReaderDeps, ctx: CoreCallContext, input: NodeDetailRequestV1): Promise<ReadResult<NodeDetailV1>> {
  const goalRef = input.goalRef;
  const goal = await goalScope(deps, ctx, goalRef);
  if (goal === null) return { status: 'rejected', code: 'unavailable', reason: 'queryGoal did not return the Goal' };
  const scope = goal.scope;
  const line = memoDuty(deps.line);

  if (input.section === 'participants') {
    const decoded: Extract<NodeCursor, { section: 'participants' }> | typeof CURSOR_MISMATCH = input.page.afterCursor === null
      ? { section: 'participants', source: 0, after: null, seen: [] }
      : decodeNodeCursor(input.page.afterCursor, 'participants');
    if (decoded === CURSOR_MISMATCH) return cursorMismatch();
    if (input.node.kind === 'session') return { status: 'ready', value: { section: 'participants', items: [], nextCursor: null, sourceCursor: ZERO_CURSOR } };
    const graph = await readGraph(deps, ctx, goalRef);
    if (graph === null) return { status: 'rejected', code: 'unavailable', reason: 'queryTaskGraph did not return the goal task graph' };
    // No canonical Run-history read here: the `claimed` source pages its own
    // `r4c-run-by-task` index inside `participantsSection` (item 5).
    return participantsSection(deps, ctx, scope, input, graph, line, decoded);
  }

  if (input.section === 'risks') {
    const decoded: Extract<NodeCursor, { section: 'risks' }> | typeof CURSOR_MISMATCH = input.page.afterCursor === null
      ? { section: 'risks', offset: 0 }
      : decodeNodeCursor(input.page.afterCursor, 'risks');
    if (decoded === CURSOR_MISMATCH) return cursorMismatch();
    const offset = decoded.offset;
    const target = taskRefOf(input.node);
    if (target === null) return { status: 'ready', value: { section: 'risks', items: [], nextCursor: null, sourceCursor: ZERO_CURSOR } };
    const graph = await readGraph(deps, ctx, goalRef);
    if (graph === null) return { status: 'rejected', code: 'unavailable', reason: 'queryTaskGraph did not return the goal task graph' };
    const row = graph.rows.find((candidate) => keyOf(candidate.ref) === keyOf(target.task));
    if (row === undefined) return { status: 'not_found' };
    const runsRead = await readRunsByTask(deps.records, goalRef, graph.plan);
    if (runsRead.status !== 'ready') return runsRead;
    const runs = runsRead.value.runs;
    const facts = await readExecutedFiles(deps.executedFiles, ctx, goalRef);
    const items: NodeRiskV1[] = [];
    for (const candidate of otherTasks(row, graph.rows)) {
      if (directEdge(row, candidate, graph.plan)) continue;
      const ownModule = moduleOf(row);
      const candidateModule = moduleOf(candidate);
      if (ownModule !== null && candidateModule !== null && keyOf(ownModule) === keyOf(candidateModule)) {
        items.push({ task: candidate.ref, title: candidate.definition.title, phase: candidate.effectivePhase,
          shared: { kind: 'module', module: ownModule } });
        continue;
      }
      if (facts.availability === 'available') {
        const ownRuns = runs.get(row.ref.taskId) ?? [];
        const ownPaths = new Set(facts.files.filter((file) => ownRuns.some((run) => keyOf(run.ref) === keyOf(file.runRef)))
          .map((file) => file.path));
        const candidateRuns = runs.get(candidate.ref.taskId) ?? [];
        const shared = facts.files.find((file) => ownPaths.has(file.path)
          && candidateRuns.some((run) => keyOf(run.ref) === keyOf(file.runRef)));
        if (shared !== undefined) items.push({ task: candidate.ref, title: candidate.definition.title,
          phase: candidate.effectivePhase, shared: { kind: 'file', path: shared.path, certainty: shared.certainty } });
      }
    }
    // Underlying source: `risks` has no per-item index. The item order is the
    // shared in-memory task graph's `graph.rows` order (`otherTasks`), and every
    // store read on this page is a shared, already-bounded read (`queryTaskGraph`
    // + the canonical task-facts Run read + the one executed-files port call),
    // so the page validates the cursor and does not re-read per offset. The
    // returned cursor is that Run read's real watermark, never a fabricated zero.
    const next = offset + input.page.limit < items.length ? encodeNodeCursor({ section: 'risks', offset: offset + input.page.limit }) : null;
    return { status: 'ready', value: { section: 'risks', items: items.slice(offset, offset + input.page.limit), nextCursor: next,
      sourceCursor: runsRead.value.readThrough } };
  }

  if (input.section === 'anomalies') {
    const target = taskRefOf(input.node);
    const page = await deps.anomalies.listSessionAnomalies(ctx, { goalRef,
      ...(target === null ? {} : { taskId: target.task.taskId }),
      page: { limit: input.page.limit, ...(input.page.afterCursor === null ? {} : { cursor: input.page.afterCursor }) } });
    if (page.status !== 'ready') {
      const problem = storeRejection(page);
      return { status: 'rejected', code: problem.code, reason: problem.reason };
    }
    const sessions = page.value.items.map((view) => view.anchor.sessionRef);
    // Item 2: a failed line read keeps every item and carries its reason.
    const resolved = await resolveSessionHeads(deps.records, scope, sessions, new Map());
    const assembled = resolved.status === 'ready' ? await assembleSessionBriefs(line, ctx, scope, resolved.value) : null;
    const lineBySession = new Map<string, LineBriefV1>();
    if (assembled !== null && assembled.status === 'ready') {
      for (const [sessionKey, briefs] of assembled.value.bySession) if (briefs[0] !== undefined) lineBySession.set(sessionKey, briefs[0]);
    }
    const problem = assembled !== null && assembled.status === 'ready'
      ? null
      : storeRejection(assembled ?? resolved).reason;
    const items = page.value.items.map((view) => {
      const brief = lineBySession.get(keyOf(view.anchor.sessionRef)) ?? null;
      return { ...view, line: brief, problem: brief === null ? problem : null };
    });
    return { status: 'ready', value: { section: 'anomalies', items, nextCursor: page.value.nextCursor, sourceCursor: page.value.sourceCursor } };
  }

  if (input.section === 'executions') {
    const decoded: Extract<NodeCursor, { section: 'executions' }> | typeof CURSOR_MISMATCH = input.page.afterCursor === null
      ? { section: 'executions', after: null }
      : decodeNodeCursor(input.page.afterCursor, 'executions');
    if (decoded === CURSOR_MISMATCH) return cursorMismatch();
    const target = taskRefOf(input.node);
    if (target === null) return { status: 'ready', value: { section: 'executions', items: [], nextCursor: null, sourceCursor: ZERO_CURSOR } };
    // One bounded page of the `r4c-run-by-task` index; `after` is the index's
    // own exclusive lookup cursor, so a later page reads only its own page.
    const page = await runRefsByTask(deps.records, goalRef, target.task.taskId, input.page.limit, decoded.after);
    if (page.status !== 'ready') return page;
    // The Run candidate refs come from the index, so one Run whose body read
    // fails still keeps its item with `problem` (2C-29).
    const items: { runRef: RunRef; revision: number | null; problem: string | null }[] = [];
    for (const runRef of page.value.refs) {
      const read = await deps.records.readMany([keyOf(runRef)]);
      if (read.status === 'ready' && read.value.records.length > 0) {
        const decodedRun = decodeRun(read.value.records[0]!);
        if (decodedRun.ok) { items.push({ runRef, revision: decodedRun.value.revision, problem: null }); continue; }
      }
      const reason = read.status === 'rejected' ? `${read.code}: ${read.reason}` : 'the Run record is not readable';
      items.push({ runRef, revision: null, problem: reason });
    }
    const next = page.value.next === null ? null : encodeNodeCursor({ section: 'executions', after: page.value.next });
    return { status: 'ready', value: { section: 'executions', items, nextCursor: next,
      sourceCursor: page.value.readThrough ?? ZERO_CURSOR } };
  }

  return { status: 'rejected', code: 'unsupported', reason: `the ${input.section} section is not part of slice 2C` };
}

export function createNodeDetailReader(deps: NodeDetailReaderDeps): NodeDetailReadPort {
  return {
    readGraphHover: (ctx, input) => assembleHover(deps, ctx, input.goalRef),
    readNodeDetail: (ctx, input) => input.section === 'summary' ? readSummary(deps, ctx, input) : readSection(deps, ctx, input),
  };
}
