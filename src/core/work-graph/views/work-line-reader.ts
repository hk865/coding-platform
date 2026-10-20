/**
 * Slice 2C work-line read model (spec §2, L1–L11, L18, L20).
 *
 * One assembly path builds every `LineRowV1`; `assembleLineBriefs` projects the
 * same rows down to the four `LineBriefV1` fields the list returns, and
 * `node-detail-reader.ts` calls it for the hover's `owners`, so the hover is
 * byte-identical to `lines/list` by construction (P4).
 *
 * L1b: the historical parts of one line (written anchors, undelivered replies,
 * done evidence) are read through a per-line counting wrapper. It counts
 * `lookup` pages, `lookupOrdered` pages, each `readMany` record, each `eventAt`
 * and each `countLookup`; once the budget is exhausted every further read for
 * that line is rejected without reading. The anchor and undelivered readers are
 * built from the wrapper through the factories the composition root injects, so
 * their nested reads are counted too. The order is fixed: written anchors →
 * undelivered → done evidence.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreError, CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionProvenanceV1, SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../../contracts/dispatch.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, WorkspaceLineSettingsV1, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryRunSnapshot } from '../../../contracts/query-job.js';
import type { GoalRecordTransactionPort, StoreFailure } from '../../record-store/ports.js';
import type {
  RecordCountPort, RecordCountRequest, RecordLookupPort, RecordLookupRequest,
  RecordOrderedLookupPort, OrderedLookupRequest,
} from '../../record-store/lookup-ports.js';
import type { TaskRow } from '../model/plan-contracts.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type {
  LineBriefV1, LineChainEntryV1, LineConversationSourceV1, LineCountV1, LineExecutionItemV1,
  LineGateCheckV1, LineMessageStateV1, LineNameV1, LineParticipationV1, LineReasonV1,
  LineRowV1, LineSegmentV1, NotYetV1, WorkLineDetailV1, WorkLineListV1, WorkLineSectionPageV1,
} from '../../../contracts/work-line.js';
import type { QueryExecutionStateV1, QueryRunRef } from '../../../contracts/query-job.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import type { SessionDutyReadPort, WorkLineReadPort } from '../model/work-line-contracts.js';
import type { DecisionCardV1, DecisionReadPort } from '../model/decision-contracts.js';
import type { SessionMailboxPort, SessionMessage } from '../model/communication-contracts.js';
import type { SessionAnomalyPort } from '../tasks/session-anomaly-service.js';
import { decodeDispatchOutboxEntry, S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP } from '../tasks/claim-record-codecs.js';
import { decodeSessionAnomalyAnchor, sessionAnomalyRefKey, S2C_ANOMALY_BY_SESSION_LOOKUP } from '../tasks/session-anomaly-codecs.js';
import { RUN_BY_TASK_INDEX, taskRecordRefKey } from '../tasks/plan-readers.js';
import { readRequeueWindow } from '../tasks/requeue-service.js';
import { decodeSessionMessageRecord, sessionMessageRefKey, SESSION_MESSAGE_BY_RECIPIENT_LOOKUP } from '../sessions/message-record-codecs.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import { storeFailureCode } from '../persistence/read-result-failures.js';
import {
  decodeVerificationRoundSnapshot, VERIFICATION_ROUND_BY_TASK_LOOKUP,
  VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT, VERIFICATION_ROUND_ORIGINAL_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import { sessionResponsibilityChangedEventFromEvent } from '../sessions/lifecycle-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import { decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord, S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP } from '../queries/query-record-codecs.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import {
  S2C_CLOSED_TASK_LINKS_LOOKUP, S2C_OPEN_LINKS_BY_SESSION_LOOKUP, S2C_SESSION_ARCHIVED_AT_LOOKUP,
  S2C_SESSION_BY_KIND_FROM_LOOKUP, S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP,
  SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP, SESSION_WORK_LINKS_LOOKUP,
  decodeSessionRecord, decodeSessionWorkLink, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  cardLineKeys, deriveAttentionAll, deriveLineControls, deriveLineStatus, lineSortKey, type LineCardFactV1, type LineCardInputV1,
  type LineClosureModeV1, type LineDoneEvidenceV1, type LineFactsV1, type LineOwnerIndexV1,
  type LinePausedTaskFactsV1, type LineRunFactsV1, type LineTaskArchiveNextV1, type LineTaskFactV1,
} from '../state/line-status.js';
import { stopRequesterOf } from '../state/task-failure.js';

/**
 * L1b: the per-line budget for the historical parts. The lead set this number
 * to 100 from the measured m=4, r=78, w=63 on the 2C-25 data (§15); it stays
 * injectable for tests. The A2 printout on this build reports w=73 accepted
 * calls: the written anchors' shared archive-state `next` read is a shared,
 * unbudgeted cost (L1b), so it no longer consumes this allowance.
 */
export const LINE_HISTORY_READ_BUDGET = 100;

/** The store surface the reader needs (L3: lookup + ordered lookup + count). */
export type WorkLineStore = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort;

/**
 * Reader dependencies (spec §2 and the L1 table). The two `*For` factories take
 * the line's counting wrapper and build the nested readers from it (P12), so
 * reads inside the mailbox and anomaly services are counted too. `plans` is
 * optional so the older read-only doubles keep type-checking; the real
 * composition root injects it.
 */
export type WorkLineReaderDeps = {
  records: WorkLineStore;
  dutyFor: SessionDutyReadPort;
  undeliveredRepliesFor: (records: GoalRecordTransactionPort & RecordLookupPort) => SessionMailboxPort['readUndeliveredReplies'];
  sessionAnomaliesFor: (records: GoalRecordTransactionPort & RecordLookupPort) => SessionAnomalyPort;
  historyReadBudget?: number;
  plans?: PlanTaskPort;
  /**
   * L8: the real decision queue (2A). Optional only so the older read-only test
   * doubles keep compiling; a port that is absent reads as "no queue in this
   * read", while a present port that fails marks every row `attentionComplete:
   * false` (rule 5). The composition root injects the real read model.
   */
  decisions?: Pick<DecisionReadPort, 'queryDecisionQueue'>;
};

// -------------------------------------------------------------------------- //
// L1b counting wrapper (P12)                                                 //
// -------------------------------------------------------------------------- //

type Budget = { remaining: number };

function budgetExhausted(): StoreFailure {
  return { status: 'rejected', code: 'unavailable', reason: 'history_budget' };
}

/** Counts exactly the L1b calls; rejects the whole `readMany` request when it would exceed the budget. */
function countingStore(store: WorkLineStore, budget: Budget): WorkLineStore {
  // L1b: exhaustion is sticky. The FIRST request that does not fit latches the
  // budget, so every later budgeted read for this line is rejected too.
  let exhausted = false;
  const spend = (amount: number): boolean => {
    if (exhausted || amount > budget.remaining) {
      exhausted = true;
      budget.remaining = 0;
      return false;
    }
    budget.remaining -= amount;
    return true;
  };
  const allow = (amount: number): StoreFailure | null => (spend(amount) ? null : budgetExhausted());
  return {
    readMany: async (refKeys): Promise<Awaited<ReturnType<WorkLineStore['readMany']>>> => {
      const denied = allow(refKeys.length);
      if (denied !== null) return denied;
      return store.readMany(refKeys);
    },
    lookupCommit: (input) => store.lookupCommit(input),
    commit: (input) => store.commit(input),
    eventAt: async (cursor) => {
      const denied = allow(1);
      if (denied !== null) return denied;
      return store.eventAt(cursor);
    },
    lookup: async (request: RecordLookupRequest): Promise<Awaited<ReturnType<WorkLineStore['lookup']>>> => {
      const denied = allow(1);
      if (denied !== null) return denied;
      return store.lookup(request);
    },
    lookupOrdered: async (request: OrderedLookupRequest): Promise<Awaited<ReturnType<WorkLineStore['lookupOrdered']>>> => {
      const denied = allow(1);
      if (denied !== null) return denied;
      return store.lookupOrdered(request);
    },
    countLookup: async (request: RecordCountRequest): Promise<Awaited<ReturnType<WorkLineStore['countLookup']>>> => {
      const denied = allow(1);
      if (denied !== null) return denied;
      return store.countLookup(request);
    },
  };
}

// -------------------------------------------------------------------------- //
// Failure propagation (rule 3, §8, 2C-14)                                    //
// -------------------------------------------------------------------------- //

/**
 * A line-level read problem: the row keeps its slot but `bucket` is `null`
 * (B4) and the active counts report `partial`. Reads that enumerate the lines
 * (the active page, the archived page) propagate their rejection to the whole
 * read instead; a line-specific read (its Run, its closed links, its copies)
 * records the first failure here and never falls back to "none".
 */
type LineProblem = { code: CoreError | 'source_moving'; reason: string };
type LineReadState = { problem: LineProblem | null };

/** A store read that either succeeds or returns the port rejection (rule 3). */
export type StoreRead<T> = { status: 'ready'; value: T } | CoreRejection;

/** A failed store read, as the port rejection the whole read returns. */
function rejectionOf(failure: { code: string; reason: string }): CoreRejection {
  return { status: 'rejected', code: storeFailureCode({ code: failure.code }), reason: failure.reason };
}

/** Record the first failed read for one line without overwriting an earlier one. */
function noteProblem(state: LineReadState | null, failure: { code: string; reason: string }): void {
  if (state === null || state.problem !== null) return;
  state.problem = { code: storeFailureCode({ code: failure.code }), reason: failure.reason };
}

/**
 * L1b: only the per-line history budget reports `history_budget`. The injected
 * nested readers (the undelivered-reply mailbox) read through `readBatch`
 * (plan-readers), which prefixes the store code onto the reason
 * (`unavailable: history_budget`); accept both forms so a budget exhaustion is
 * never mistaken for a hard read failure and reported as `unavailable`
 * (book rule 3, 2C-25 (4)).
 */
function isBudgetFailure(failure: { code: string; reason: string }): boolean {
  return failure.code === 'unavailable'
    && (failure.reason === 'history_budget' || failure.reason.endsWith(': history_budget'));
}

// -------------------------------------------------------------------------- //
// Assembly                                                                   //
// -------------------------------------------------------------------------- //

/**
 * P4: the one line assembly, shared by `lines/list` and the hover. Given the
 * reader dependencies, the call context and the set of line heads, it returns
 * the same `LineBriefV1` values `lines/list` returns for those heads.
 */
export async function assembleLineBriefs(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  input: { workspace: WorkspaceScope; heads: readonly SessionRef[] },
): Promise<ReadResult<LineBriefV1[]>> {
  const rows = await assembleLineRows(deps, ctx, input.workspace, input.heads);
  if (rows.status !== 'ready') return rows;
  return { status: 'ready', value: rows.value.rows.map(toBrief) };
}

export function toBrief(row: LineRowV1): LineBriefV1 {
  return { key: row.key, duty: row.duty, name: row.name, status: row.status };
}

/** Per-list cache of the shared, unbudgeted goal/task reads (L1b shared costs). */
type SharedReads = {
  goals: Map<string, GoalFacts>;
  workspace: WorkspaceSnapshot | null;
};

type GoalFacts = {
  goalRef: GoalRef;
  objective: string;
  desiredState: import('../../../contracts/ledger.js').GoalDesiredState;
  /** The Goal's revision when it was read (the `tasks/requeue` Goal pin; L16). */
  revision: number | null;
  /** The active Plan of the shared task-graph read (the effective basis; L16). */
  plan: import('../../../contracts/plan.js').PlanRevisionSnapshot | null;
  tasks: Map<string, TaskRow>;
  order: string[];
  read: boolean;
  /**
   * Rule 3 / B4: the Goal or task-graph read failed. The affected Tasks have no
   * fact (their responsibility must not silently disappear), so the line is
   * marked with a problem and takes no bucket (review item 2).
   */
  failed: { code: string; reason: string } | null;
  /**
   * §3.12 task anchors: the unclaimed anchors per task, read once per Goal
   * through `listSessionAnomalies` (shared cost). `complete` is false when the
   * anchor read or a `readTaskArchiveState` failed (L8/§3.4).
   */
  anomalies: Map<string, TaskAnomalyFacts>;
  anomaliesLoaded: boolean;
  anomaliesComplete: boolean;
};

/** §3.12: the unclaimed-anchor facts of one Task, from the shared per-Goal read. */
type TaskAnomalyFacts = { task: TaskTriple; count: number; next: LineTaskArchiveNextV1 | null | undefined; problem: boolean };

async function assembleLineRows(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  heads: readonly SessionRef[],
  /** L10: the active list sorts by `sortKey`; the archived page keeps the archive-time order L5 read. */
  order: 'sort-key' | 'given' = 'sort-key',
  /** L1/N1 (review item 4a): the already-enumerated active copies, by source Session. */
  activeCopies?: ActiveCopies,
): Promise<ReadResult<{ rows: LineRowV1[]; facts: Map<string, LineFactsV1>; attentionProblem: string | null; legacyUnchecked: LineCountV1 }>> {
  const budgetValue = deps.historyReadBudget ?? LINE_HISTORY_READ_BUDGET;
  const shared: SharedReads = { goals: new Map(), workspace: null };
  const queue = await readDecisionQueue(deps, ctx, workspace);
  // L6: one workspace-wide legacy count (active + archived), read once per list
  // and shared by every line's M7 marker. Not part of any line's L1b budget.
  const legacyUnchecked = await readLegacyUnchecked(deps.records, workspace);
  // L1/N1 (review item 4a): read the active copies once per list (the active list
  // already enumerated them and passes the index in). Bounded by current work.
  let copiesIndex: ActiveCopies;
  if (activeCopies !== undefined) copiesIndex = activeCopies;
  else {
    const read = await readActiveCopies(deps.records, workspace);
    if (read.status !== 'ready') return read;
    copiesIndex = read.value;
  }
  const rows: LineRowV1[] = [];
  const facts = new Map<string, LineFactsV1>();
  for (const head of heads) {
    const state = readBudgetState(deps, budgetValue);
    const row = await assembleOneLine(deps, ctx, workspace, head, state, shared, queue, copiesIndex);
    if (row.status === 'rejected') return row;
    if (row.status === 'ready') {
      rows.push(row.value.row);
      facts.set(canonicalJson(row.value.row.key as unknown as JsonValue), row.value.facts);
    }
  }
  if (order === 'sort-key') rows.sort(compareRows);
  return { status: 'ready', value: { rows, facts, attentionProblem: queue.problem, legacyUnchecked } };
}

/** L6: the workspace Sessions without provenance, active and archived counted once each. */
async function readLegacyUnchecked(records: WorkLineStore, workspace: WorkspaceScope): Promise<LineCountV1> {
  const active = await countKinds(records, workspace, 'active', [null]);
  const archived = await countKinds(records, workspace, 'archived', [null]);
  if (active.failed || archived.failed) return { status: 'unavailable', reason: 'count_failed' };
  const a = active.count.status === 'exact' ? active.count.value : 0;
  const b = archived.count.status === 'exact' ? archived.count.value : 0;
  return { status: 'exact', value: a + b };
}

function compareRows(left: LineRowV1, right: LineRowV1): number {
  if (left.sortKey < right.sortKey) return -1;
  if (left.sortKey > right.sortKey) return 1;
  return 0;
}

function readBudgetState(deps: WorkLineReaderDeps, value: number): { records: WorkLineStore; budget: Budget } {
  const budget: Budget = { remaining: value };
  return { records: countingStore(deps.records, budget), budget };
}

async function assembleOneLine(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  headRef: SessionRef,
  state: { records: WorkLineStore; budget: Budget },
  shared: SharedReads,
  queue: QueueRead,
  activeCopies: ActiveCopies,
  /** T5x: true on the single consistency reread, so an occupied ended execution is not retried forever. */
  reread = false,
): Promise<ReadResult<{ row: LineRowV1; facts: LineFactsV1 }>> {
  const lineState: LineReadState = { problem: null };
  const headRead = await readSession(deps.records, workspace, headRef);
  if (headRead.status !== 'ready') return headRead;
  if (headRead.value === null) return { status: 'not_found' };
  const headRecord = headRead.value;
  const { chain, omitted } = await readChain(deps.records, workspace, headRecord, lineState);

  // L1b order: written anchors -> undelivered -> done evidence. The written
  // anchors and undelivered parts are read through the line's own wrapper; the
  // anchor/undelivered readers are built from that wrapper by the injected
  // factories, so their nested reads are counted too.
  const history = await readHistoryParts(deps, ctx, workspace, chain, headRecord, state);
  const earlyProblem = lineState.problem ?? history.problem;

  const duty = await resolveDuty(deps.dutyFor, ctx, headRecord.role);
  const openLinks = earlyProblem === null ? await readOpenResponsibleLinks(deps.records, workspace, chain, lineState) : emptyOpenLinks();
  const responsibleTriples = dedupeTasks(openLinks.taskLinks.map((entry) => entry.link.ref.target as { ref: TaskTriple }).map((target) => target.ref));

  const holder = earlyProblem === null ? await readHolder(deps.records, workspace, headRecord, lineState) : null;
  // T5x (L11): an execution that already ended with a known result must not still
  // occupy its Session. Reread the line once; if it persists, mark `source_moving`.
  const inconsistentOccupancy = holder !== null && (
    (holder.kind === 'run' && holder.run.run.status === 'ended' && holder.run.run.outcome !== 'outcome_unknown')
    || (holder.kind === 'query' && holder.query.run.executionState?.phase === 'settled'));
  if (inconsistentOccupancy && !reread) {
    const fresh = readBudgetState(deps, deps.historyReadBudget ?? LINE_HISTORY_READ_BUDGET);
    return assembleOneLine(deps, ctx, workspace, headRef, fresh, shared, queue, activeCopies, true);
  }
  const latestWork = earlyProblem === null && holder === null
    ? await readLatestWork(deps.records, workspace, headRecord, lineState) : null;

  // Titles for the line name come from the same task graph read (shared cost).
  const nameTaskTriples = dedupeTasks([
    ...(holder !== null && holder.kind === 'run' ? [holder.run.run.task] : []),
    ...(latestWork !== null ? [latestWork.run.task] : []),
  ]);
  const taskFacts = await readTaskFacts(deps, ctx, workspace, dedupeTasks([...responsibleTriples, ...nameTaskTriples]), shared, lineState);
  // Review item 2: a responsible Task the TaskGraph does not know must not silently
  // disappear from `responsibleNow`; the line keeps its slot with a problem (B4).
  if (deps.plans !== undefined) {
    for (const task of responsibleTriples) {
      if (!taskFacts.has(taskCanonicalKey(task))) {
        noteProblem(lineState, { code: 'incomplete',
          reason: `the responsible Task ${task.goalId}/${task.taskId} is absent from the task graph` });
        break;
      }
    }
  }
  const responsibleOpen: LineTaskFactV1[] = responsibleTriples
    .map((task) => taskFacts.get(taskCanonicalKey(task)))
    .filter((task): task is LineTaskFactV1 => task !== undefined);
  const responsibleOpenOther = openLinks.otherLinks.map((entry) => entry.link.ref.target.kind === 'work' ? 'work' : 'module');
  // L16: the Run's Goal desired state (D-9) comes from the same task-graph read.
  if (holder !== null && holder.kind === 'run') holder.run.goalDesiredState = goalDesiredStateIn(shared, holder.run.run.task.goalId);
  if (latestWork !== null) latestWork.goalDesiredState = goalDesiredStateIn(shared, latestWork.run.task.goalId);

  // The chain entries show which Sessions are still responsible per Session (E1).
  for (const entry of chain) {
    entry.responsibleOpen = openLinks.taskLinks
      .filter((link) => sameSession(link.session, entry.session))
      .map((link) => link.link.ref.target as { ref: TaskTriple })
      .map((target) => target.ref);
  }

  const doneEvidence = duty === 'executor' && earlyProblem === null && responsibleOpen.every((task) => task.terminal)
    ? await readDoneEvidence(state.records, workspace, headRecord, responsibleOpen, taskFacts, lineState)
    : { status: 'not_applicable' as const };
  // L1b: the done-evidence part also stops on the budget, so it is reported as a
  // partial part (never silently omitted).
  if (doneEvidence.status === 'read' && doneEvidence.budgetExhausted) {
    history.partialParts.push({ part: 'done_evidence', reason: 'history_budget' });
  }

  const copies = earlyProblem === null ? await readCopies(deps.records, workspace, chain, activeCopies, lineState) : [];
  const latestQuery = earlyProblem === null && needsLatestQuery(duty, holder, latestWork, headRecord)
    ? await readLatestQuery(deps.records, workspace, headRecord, lineState) : null;
  // L20 (review item 10): the secretary's interim name uses the latest Query's
  // Goal title, not the Goal id.
  let secretaryGoalTitle: string | null = null;
  if (duty === 'secretary' && latestQuery !== null && latestQuery.goalId !== null) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: workspace.projectId, goalId: latestQuery.goalId };
    const goalRead = deps.plans === undefined ? null : await deps.plans.queryGoal(ctx, goalRef);
    if (goalRead !== null && goalRead.status === 'ready') secretaryGoalTitle = goalRead.value.goal.objective;
    else if (goalRead !== null && goalRead.status === 'rejected') noteProblem(lineState, goalRead);
  }

  const pinnedEntries = await readPins(shared, deps.records, workspace, lineState);
  const chainKeys = new Set(chain.map((entry) => refKey(entry.session)));
  const pinnedBy = pinnedEntries.filter((entry) => chainKeys.has(refKey(entry.sessionRef))).map((entry) => entry.sessionRef);

  const earliest = chain[chain.length - 1];
  let handoffFrom: SessionRef | null = null;
  let handoffFromLine: SessionRef | null = null;
  if (earliest !== undefined && earliest.provenance?.kind === 'handoff') {
    handoffFrom = earliest.provenance.from;
    const fromLine = await findHeadOf(deps.records, workspace, earliest.provenance.from);
    if (fromLine.status !== 'ready') noteProblem(lineState, fromLine);
    handoffFromLine = fromLine.status === 'ready' ? (fromLine.value ?? earliest.provenance.from) : earliest.provenance.from;
  }
  // L22: an archived head's handoff successor is its "已交给 <线>" target.
  let handedTo: SessionRef | null = null;
  if (headRecord.lifecycle === 'archived') {
    const successors = await deps.records.lookup({ index: S2C_SESSION_BY_KIND_FROM_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, 'handoff', headRecord.ref.sessionId], limit: 1 });
    if (successors.status !== 'ready') noteProblem(lineState, successors);
    else if (successors.value.records.length > 0) {
      const decoded = decodeSessionRecord(successors.value.records[0]!);
      if (decoded.status === 'decoded') {
        handedTo = { projectId: decoded.value.ref.projectId, sessionId: decoded.value.ref.sessionId };
      }
    }
  }

  const writtenAnchorsPending = history.writtenAnchorsPending;
  const undelivered = headRecord.health === 'unavailable' ? history.undelivered : ({ status: 'not_applicable' } as const);

  // L8 / §3.4: a waiting-answer card lands on this line once when its sender (or
  // the forwarded original sender) is on the chain, or one of its task pins is a
  // task this line now owns. The §2 function `cardLineKeys` does the landing; the
  // line's own owner index maps the chain's Sessions and its responsible Tasks to
  // this head, so a non-empty result means the card lands on this line (P4).
  const headLineRef: SessionRef = { projectId: headRecord.ref.projectId, sessionId: headRecord.ref.sessionId };
  const lineOwners: LineOwnerIndexV1 = {
    lineOfSession: new Map(chain.map((entry) => [refKey(entry.session), [headLineRef]])),
    linesOfTask: new Map(responsibleOpen.map((task) => [taskCanonicalKey(task.task), [headLineRef]])),
  };
  const lineCards: LineCardFactV1[] = [];
  for (const entry of queue.cards) {
    const card: LineCardInputV1 = { senderSessionRef: entry.senderSessionRef,
      forwardedFromSender: entry.forwardedFromSender, taskPins: entry.taskPins, excluded: entry.excluded };
    if (cardLineKeys(card, lineOwners).length > 0) lineCards.push(entry.card);
  }
  for (const task of responsibleOpen) {
    const key = taskCanonicalKey(task.task);
    task.cards = queue.cards
      .filter((entry) => !entry.excluded && entry.taskPins.some((pin) => taskCanonicalKey(pin) === key))
      .map((entry) => entry.card);
  }

  // L16: the paused-interrupted Tasks of this line give the "continue" control
  // and T3(c)'s own word. Empty without a paused-interrupted responsibility.
  const pausedTasks = earlyProblem === null
    ? await readPausedTaskFacts(deps, workspace, responsibleOpen, lineState)
    : [];

  // B4 (review item 2): `problem` is settled AFTER every fact read, so a failed
  // paused-task requeue-window read (which drops the Task's continue control at
  // line 926) is reported as the incomplete fact, not silently lost behind an
  // earlier `null`. B4 then puts the row in no bucket.
  const problem = lineState.problem ?? history.problem ?? (inconsistentOccupancy
    ? { code: 'source_moving' as const, reason: 'the occupancy is inconsistent with an ended execution' } : null);

  const facts: LineFactsV1 = {
    head: headRecord,
    chain,
    omitted,
    duty,
    holder,
    latestWork,
    responsibleOpen,
    responsibleOpenOther,
    doneEvidence,
    pausedTasks,
    lineCards,
    writtenAnchorsPending,
    writtenAnchorsNext: history.writtenAnchorsNext,
    copies,
    undelivered,
    partialParts: history.partialParts,
    handoffFrom,
    handoffFromLine,
    handedTo,
    unknownCallReviewsPending: 0,
    queueComplete: queue.complete,
    pinned: pinnedBy.length > 0,
    lastActivityAt: deriveLastActivity(headRecord, holder, latestWork, copies, latestQuery),
    problem,
  };
  const status = deriveLineStatus(facts);
  const name = deriveName(duty, holder, latestWork, latestQuery, responsibleOpen, taskFacts, headRecord, secretaryGoalTitle);
  const sessionCount: LineCountV1 = omitted.status === 'exact'
    ? { status: 'exact', value: chain.length }
    : { status: 'partial', atLeast: chain.length + 1, reason: 'the chain exceeds 32 predecessors (L2)' };
  const row: LineRowV1 = {
    key: { projectId: headRecord.ref.projectId, sessionId: headRecord.ref.sessionId },
    duty,
    name,
    status,
    responsibleNow: responsibleOpen.map(toTaskBrief),
    doneTasks: deriveDoneTasks(facts, taskFacts),
    retired: headRecord.health === 'unavailable'
      ? { conclusion: headRecord.healthConclusion ?? null,
          history: isHistoryNotReadable(headRecord) ? 'not_readable' : 'readable',
          since: headRecord.unavailableSince ?? null }
      : null,
    groups: deriveGroups(duty, name, taskFacts),
    sessionCount,
    chainSessions: chain.map((entry) => entry.session),
    pinned: pinnedBy.length > 0,
    pinnedBy,
    lastActivityAt: facts.lastActivityAt,
    sortKey: '',
    controls: deriveLineControls(facts, status),
    problem,
  };
  row.sortKey = lineSortKey({
    pinned: row.pinned,
    attention: status.attention?.code ?? null,
    attentionComplete: status.attentionComplete,
    lastActivityAt: row.lastActivityAt,
    headRefKey: canonicalJson(row.key as unknown as JsonValue),
  });
  return { status: 'ready', value: { row, facts } };
}

function toTaskBrief(task: LineTaskFactV1) {
  return { task: task.task, title: task.title, phase: task.phase, disposition: task.disposition,
    phaseCause: task.phaseCause, attention: null };
}

function deriveDoneTasks(facts: LineFactsV1, taskFacts: Map<string, LineTaskFactV1>) {
  const evidence = facts.doneEvidence;
  if (evidence.status !== 'read') return null;
  const entries = [...evidence.openTerminal, ...evidence.recent.filter((entry) => entry.closure === 'terminal')].slice(0, 20);
  const briefs: import('../../../contracts/work-line.js').LineTaskBriefV1[] = [];
  for (const entry of entries) {
    const fact = taskFacts.get(taskCanonicalKey(entry.task));
    briefs.push(fact !== undefined ? toTaskBrief(fact)
      : { task: entry.task, title: entry.title, phase: 'pending', disposition: 'active', phaseCause: null, attention: null });
  }
  const listed = briefs.length;
  const positive = evidence.openTerminal.length + evidence.recent.filter((entry) => entry.closure === 'terminal').length;
  // §3.2 T8's omitted formula (L1a): P = open terminal evidence, T = terminals in
  // the read window, K = unknown closures in it, N = transfer/drop in it.
  const unknown = evidence.recent.filter((entry) => entry.closure === 'unknown').length;
  const other = evidence.recent.filter((entry) => entry.closure === 'transfer' || entry.closure === 'drop').length;
  const total = evidence.total.status === 'exact' ? evidence.total.value : null;
  const atLeast = Math.max(0, positive - listed);
  let omitted: LineCountV1;
  if (total !== null && total <= 21 && unknown === 0 && !evidence.budgetExhausted) {
    omitted = { status: 'exact', value: atLeast };
  } else if (evidence.budgetExhausted) {
    omitted = { status: 'partial', atLeast, reason: 'the closed responsible links were not read in full (L1a/L1b)' };
  } else {
    omitted = total === null
      ? { status: 'partial', atLeast, reason: 'the closed responsible links were not read in full (L1a/L1b)' }
      : { status: 'partial', atLeast, atMost: Math.max(0, evidence.openTerminal.length + total - listed - other),
          reason: 'the closed responsible links were not read in full (L1a/L1b)' };
  }
  return { tasks: briefs, omitted };
}

function deriveGroups(duty: LineFactsV1['duty'], name: LineNameV1, taskFacts: Map<string, LineTaskFactV1>) {
  const task = name.tasks[0];
  const fact = task === undefined ? undefined : taskFacts.get(taskCanonicalKey(task));
  return { duty, module: fact?.module ?? null, task: task ?? null };
}

// -------------------------------------------------------------------------- //
// Reads                                                                      //
// -------------------------------------------------------------------------- //

function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
const refKey = refKeyOf;
function taskCanonicalKey(task: TaskTriple): string {
  return canonicalJson(task as unknown as JsonValue);
}

function sameSession(left: SessionRef, right: SessionRef): boolean {
  return left.projectId === right.projectId && left.sessionId === right.sessionId;
}

function decodeLink(record: { json: string; refKey: string }): SessionWorkLink | null {
  const decoded = decodeSessionWorkLink(record as never);
  return decoded.status === 'decoded' ? decoded.value : null;
}

async function readSession(records: WorkLineStore, workspace: WorkspaceScope, ref: SessionRef,
  /** L11: receives the read watermark so a detail source cursor is never a fabricated zero. */
  cursorSink?: { cursor: CommitCursor | null }): Promise<StoreRead<SessionRecord | null>> {
  const key = sessionAggregateRefKey(plainSessionRefToAggregate(ref));
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return rejectionOf(read);
  if (cursorSink !== undefined) cursorSink.cursor = read.value.readThrough;
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) return { status: 'ready', value: null };
  const decoded = decodeSessionRecord(record);
  if (decoded.status !== 'decoded') return { status: 'ready', value: null };
  const session = decoded.value;
  if (session.ref.projectId !== workspace.projectId || session.workspaceId !== workspace.workspaceId) return { status: 'ready', value: null };
  return { status: 'ready', value: session };
}

async function readChain(records: WorkLineStore, workspace: WorkspaceScope, head: SessionRecord,
  state: LineReadState): Promise<{ chain: LineChainEntryV1[]; omitted: LineCountV1; readThrough: CommitCursor | null }> {
  const chain: LineChainEntryV1[] = [chainEntry(head)];
  const seen = new Set<string>([head.ref.sessionId]);
  let current = head;
  let truncated = false;
  // L11: the real watermark of the chain reads (never a fabricated zero).
  let readThrough: CommitCursor | null = null;
  for (let step = 0; step < 32; step += 1) {
    const provenance = current.provenance;
    if (provenance.kind !== 'continuation') break;
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(provenance.from));
    const read = await records.readMany([key]);
    if (read.status !== 'ready') { noteProblem(state, rejectionOf(read)); break; }
    readThrough = read.value.readThrough ?? readThrough;
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) break;
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') break;
    const predecessor = decoded.value;
    if (predecessor.ref.projectId !== workspace.projectId || predecessor.workspaceId !== workspace.workspaceId) break;
    // N9: a provenance cycle is corrupt data; keep the row and report it (defensive).
    if (seen.has(predecessor.ref.sessionId)) {
      noteProblem(state, { code: 'invalid', reason: 'the continuation provenance contains a cycle' });
      break;
    }
    seen.add(predecessor.ref.sessionId);
    chain.push(chainEntry(predecessor));
    current = predecessor;
    if (step === 31) {
      truncated = current.provenance.kind === 'continuation';
    }
  }
  const omitted: LineCountV1 = truncated
    ? { status: 'partial', atLeast: 1, reason: 'the chain exceeds 32 predecessors (L2)' }
    : { status: 'exact', value: 0 };
  return { chain, omitted, readThrough };
}

function chainEntry(session: SessionRecord): LineChainEntryV1 {
  return {
    session: { projectId: session.ref.projectId, sessionId: session.ref.sessionId },
    provenance: session.provenance,
    lifecycle: session.lifecycle,
    health: session.health,
    healthConclusion: session.healthConclusion ?? null,
    createdAt: session.createdAt,
    archivedAt: session.archivedAt,
    responsibleOpen: [],
  };
}

async function resolveDuty(dutyFor: SessionDutyReadPort, ctx: CoreCallContext, role: RoleConfigurationRef) {
  const resolved = await dutyFor(role, ctx);
  return resolved.status === 'ready' ? resolved.value : ('unknown' as const);
}

// --- open responsible links (L1 table; index 4) ---------------------------- //

type OpenLinks = {
  taskLinks: { session: SessionRef; link: SessionWorkLink }[];
  otherLinks: { session: SessionRef; link: SessionWorkLink }[];
};

function emptyOpenLinks(): OpenLinks {
  return { taskLinks: [], otherLinks: [] };
}

async function readOpenResponsibleLinks(records: WorkLineStore, workspace: WorkspaceScope,
  chain: readonly LineChainEntryV1[], state: LineReadState): Promise<OpenLinks> {
  const result = emptyOpenLinks();
  for (const entry of chain) {
    let after: string | undefined;
    for (;;) {
      const page = await records.lookup({ index: S2C_OPEN_LINKS_BY_SESSION_LOOKUP,
        values: [workspace.projectId, entry.session.sessionId, 'responsible', null],
        ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') { noteProblem(state, page); break; }
      for (const record of page.value.records) {
        const link = decodeLink(record);
        if (link === null) {
          // Review item 2: a damaged open link must not silently vanish; the line
          // keeps its slot and takes a problem (B4), never a clean "no responsibility".
          noteProblem(state, { code: 'unavailable',
            reason: `the open responsible link ${record.refKey} is not decodable` });
          continue;
        }
        const target = link.ref.target;
        if (target.kind === 'task') result.taskLinks.push({ session: entry.session, link });
        else result.otherLinks.push({ session: entry.session, link });
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
  }
  // §3.8: the line name lists the now-responsible tasks by link `since`, oldest first.
  result.taskLinks.sort((left, right) => {
    const a = String(left.link.since);
    const b = String(right.link.since);
    if (a < b) return -1;
    if (a > b) return 1;
    return refKey(left.link.ref) < refKey(right.link.ref) ? -1 : 1;
  });
  return result;
}

function dedupeTasks(tasks: readonly TaskTriple[]): TaskTriple[] {
  const seen = new Set<string>();
  const result: TaskTriple[] = [];
  for (const task of tasks) {
    const key = taskCanonicalKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(task);
  }
  return result;
}

// --- task facts (shared, unbudgeted; L1b) ---------------------------------- //

async function readTaskFacts(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  tasks: readonly TaskTriple[],
  shared: SharedReads,
  state: LineReadState,
): Promise<Map<string, LineTaskFactV1>> {
  const result = new Map<string, LineTaskFactV1>();
  if (deps.plans === undefined) return result;
  const byGoal = new Map<string, { goalRef: GoalRef; tasks: TaskTriple[] }>();
  for (const task of tasks) {
    const goalId = task.goalId;
    const current = byGoal.get(goalId);
    if (current === undefined) byGoal.set(goalId, { goalRef: { aggregateType: 'Goal', projectId: workspace.projectId, goalId }, tasks: [task] });
    else current.tasks.push(task);
  }
  for (const [goalId, entry] of byGoal) {
    const goal = await loadGoal(deps, ctx, shared, goalId, entry.goalRef);
    if (goal === null) {
      // Rule 3 / B4: a failed Goal read is a line problem, not "no responsibility".
      const failed = shared.goals.get(goalId)?.failed ?? null;
      if (failed !== null) noteProblem(state, failed);
      continue;
    }
    for (const task of entry.tasks) {
      const row = goal.tasks.get(task.taskId);
      if (row === undefined) continue;
      const fact = toTaskFact(row, goal);
      await applyTaskAnomaly(deps, ctx, goal, fact);
      result.set(taskCanonicalKey(task), fact);
    }
  }
  return result;
}

/**
 * §3.12 / §3.4 AT4: the unclaimed anchors of this Goal, read once per Goal
 * through `listSessionAnomalies` (shared cost, L1b); only tasks with at least
 * one unclaimed anchor call `readTaskArchiveState` for `label`/`next`. A failed
 * read makes the Task's `anomalyComplete` false, never "no anchor".
 */
async function loadGoalAnomalies(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  goal: GoalFacts,
): Promise<void> {
  if (goal.anomaliesLoaded) return;
  goal.anomaliesLoaded = true;
  const port = deps.sessionAnomaliesFor(deps.records);
  if (port === undefined || typeof port.listSessionAnomalies !== 'function') {
    goal.anomaliesComplete = false;
    return;
  }
  try {
    let after: string | undefined;
    for (let page = 0; page < 25; page += 1) {
      const read = await port.listSessionAnomalies(ctx, { goalRef: goal.goalRef,
        page: { limit: 100, ...(after === undefined ? {} : { cursor: after }) } });
      if (read.status !== 'ready') { goal.anomaliesComplete = false; return; }
      for (const item of read.value.items) {
        if (item.pickedUpBy !== null) continue;
        const key = taskCanonicalKey(item.anchor.task);
        const current = goal.anomalies.get(key);
        if (current === undefined) goal.anomalies.set(key, { task: item.anchor.task, count: 1, next: undefined, problem: false });
        else current.count += 1;
      }
      if (read.value.nextCursor === null) break;
      after = read.value.nextCursor;
      if (page === 24) goal.anomaliesComplete = false;
    }
    for (const entry of goal.anomalies.values()) {
      const state = await port.readTaskArchiveState(ctx, entry.task);
      if (state.status !== 'ready') { entry.problem = true; goal.anomaliesComplete = false; continue; }
      entry.next = state.value.next;
    }
  } catch {
    goal.anomaliesComplete = false;
  }
}

async function applyTaskAnomaly(
  deps: WorkLineReaderDeps, ctx: CoreCallContext, goal: GoalFacts, fact: LineTaskFactV1,
): Promise<void> {
  await loadGoalAnomalies(deps, ctx, goal);
  const entry = goal.anomalies.get(taskCanonicalKey(fact.task));
  if (entry === undefined) {
    fact.anomaly = null;
    fact.anomalyComplete = goal.anomaliesComplete;
    return;
  }
  fact.anomaly = entry.problem
    ? null
    : { pending: { status: 'exact', value: entry.count }, next: entry.next ?? null };
  fact.anomalyComplete = goal.anomaliesComplete && !entry.problem;
}

async function loadGoal(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  shared: SharedReads,
  goalId: string,
  goalRef: GoalRef,
): Promise<GoalFacts | null> {
  const cached = shared.goals.get(goalId);
  if (cached !== undefined) return cached.read ? cached : null;
  const facts: GoalFacts = { goalRef, objective: goalId, desiredState: 'active', revision: null, plan: null,
    tasks: new Map(), order: [], read: false, failed: null, anomalies: new Map(), anomaliesLoaded: false, anomaliesComplete: true };
  shared.goals.set(goalId, facts);
  if (deps.plans === undefined) return null;
  const goalRead = await deps.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') {
    facts.failed = {
      code: goalRead.status === 'rejected' ? goalRead.code : 'unavailable',
      reason: goalRead.status === 'rejected' ? goalRead.reason : `the Goal read returned ${goalRead.status}`,
    };
    return null;
  }
  facts.objective = goalRead.value.goal.objective;
  facts.desiredState = goalRead.value.goal.desiredState;
  facts.revision = goalRead.value.goal.revision;
  const graph = await deps.plans.queryTaskGraph(ctx, { goalRef });
  if (graph.status !== 'ready') {
    facts.failed = {
      code: graph.status === 'rejected' ? graph.code : 'unavailable',
      reason: graph.status === 'rejected' ? graph.reason : `the task-graph read returned ${graph.status}`,
    };
    return null;
  }
  facts.plan = graph.value.plan;
  for (const row of graph.value.tasks) {
    facts.tasks.set(row.definition.taskId, row);
    facts.order.push(row.definition.taskId);
  }
  facts.read = true;
  return facts;
}

/** L16: a Goal's desired state from the shared task-graph read; `active` when unknown. */
function goalDesiredStateIn(shared: SharedReads, goalId: string): import('../../../contracts/ledger.js').GoalDesiredState {
  return shared.goals.get(goalId)?.desiredState ?? 'active';
}

// --- paused-interrupted task facts (L16 / T0, T3c) ------------------------- //

/**
 * L16 / §3.2 T0, T3(c): one `LinePausedTaskFactsV1` per currently-responsible
 * Task whose cause is `paused_interrupted`. The read window follows
 * `tasks/requeue-service.ts` `readRequeueWindow` (a private function; the same
 * exported readers are called here): the afterRun Run and its pointer intent,
 * the Task state and the requeue guard facts (selected Run, whether it is the
 * afterRun, the selected Run's round chain, the resolved effective basis, the
 * Goal desired state). `pins` are the Goal and afterRun versions the real
 * `tasks/requeue` submission must carry. These reads are not part of the L1b
 * history budget (L1b lists only written anchors, undelivered replies and done
 * evidence), so they use the unwrapped store.
 */
async function readPausedTaskFacts(
  deps: WorkLineReaderDeps,
  workspace: WorkspaceScope,
  responsibleOpen: readonly LineTaskFactV1[],
  state: LineReadState,
): Promise<LinePausedTaskFactsV1[]> {
  const paused: LinePausedTaskFactsV1[] = [];
  for (const task of responsibleOpen) {
    if (task.phaseCause?.code !== 'paused_interrupted') continue;
    const afterRunRef = task.phaseCause.detail?.afterRunRef;
    if (afterRunRef === undefined) continue;
    // L16: share the canonical requeue window instead of a reduced copy, so the
    // projected "continue" facts are exactly the submission's.
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: workspace.projectId, goalId: task.task.goalId };
    const windowRead = await readRequeueWindow(deps.records, goalRef, task.task.taskId, afterRunRef);
    if (!windowRead.ok) { noteProblem(state, windowRead.rejection); continue; }
    const window = windowRead.value;
    const afterRunSnapshot = (window.facts.runsByTaskId.get(task.task.taskId) ?? [])
      .find((run) => refKeyOf(run.ref) === refKeyOf(afterRunRef));
    const afterRun = await readRunByRef(deps.records, workspace, afterRunRef, state);
    if (afterRun === null || afterRunSnapshot === undefined) continue;
    afterRun.goalDesiredState = window.goal.desiredState;
    const pins: VersionPin[] = [
      { ref: window.goal.ref, revision: window.goal.revision },
      { ref: afterRunRef, revision: afterRunSnapshot.revision },
    ];
    paused.push({ task: task.task, afterRun, state: window.state, rework: window.rework, pins });
  }
  return paused;
}

function toTaskFact(row: TaskRow, goal: GoalFacts): LineTaskFactV1 {
  const phase = row.effectivePhase;
  const disposition = row.disposition;
  const terminal = phase === 'satisfied' || disposition === 'cancelled' || disposition === 'superseded';
  const everRan = row.execution !== null || row.currentAttempt !== null;
  const module = row.definition.scope.kind === 'module'
    ? { projectId: row.ref.projectId, moduleId: row.definition.scope.moduleRef }
    : null;
  const lastRequeue = row.phaseCause?.code === 'requeued' && row.rework !== undefined
    ? lastReworkEntry(row.rework)
    : null;
  return {
    task: row.ref,
    title: row.definition.title,
    planOrder: goal.order.indexOf(row.definition.taskId),
    goalDesiredState: goal.desiredState,
    phase,
    phaseCause: row.phaseCause ?? null,
    disposition,
    everRan,
    terminal,
    lastRequeue,
    module,
    anomaly: null,
    anomalyComplete: true,
    cards: [],
  };
}

function lastReworkEntry(rework: NonNullable<TaskRow['rework']>): LineTaskFactV1['lastRequeue'] {
  const entry = rework.entries[rework.entries.length - 1];
  if (entry === undefined) return null;
  return { automatic: entry.automatic, failureClass: entry.failureClass, autoCount: entry.autoCount, cap: rework.cap };
}

// --- done evidence (L1a truth table; index 5 + eventAt) -------------------- //

async function readDoneEvidence(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  head: SessionRecord,
  responsibleOpen: readonly LineTaskFactV1[],
  taskFacts: Map<string, LineTaskFactV1>,
  state: LineReadState,
): Promise<LineDoneEvidenceV1> {
  const openTerminal = responsibleOpen
    .filter((task) => task.terminal)
    .map((task) => ({ task: task.task, title: task.title }));

  const recent: { task: TaskTriple; title: string; closure: LineClosureModeV1; archiveStep: boolean }[] = [];
  let budgetExhausted = false;
  const page = await records.lookupOrdered({ index: S2C_CLOSED_TASK_LINKS_LOOKUP,
    values: [workspace.projectId, head.ref.sessionId, 'responsible', 'task'], direction: 'desc', limit: 21 });
  if (page.status === 'ready') {
    for (const record of page.value.records) {
      const link = decodeLink(record);
      if (link === null) {
        recent.push({ task: unknownTask(workspace), title: '', closure: 'unknown', archiveStep: false });
        continue;
      }
      const closure = await readClosure(records, workspace, head, link);
      if (closure.exhausted) { budgetExhausted = true; break; }
      const known = taskFacts.get(taskCanonicalKey(targetTaskOf(link)));
      recent.push({ task: targetTaskOf(link), title: known?.title ?? targetTaskOf(link).taskId,
        closure: closure.mode, archiveStep: closure.archiveStep });
    }
  } else if (isBudgetFailure(page)) {
    budgetExhausted = true;
  } else {
    // Rule 3 / B4: a failed closed-links read is a row-level problem, not 0.
    noteProblem(state, page);
    budgetExhausted = true;
  }

  const totalResult = await records.countLookup({ index: S2C_CLOSED_TASK_LINKS_LOOKUP,
    values: [workspace.projectId, head.ref.sessionId, 'responsible', 'task'] });
  if (totalResult.status !== 'ready' && isBudgetFailure(totalResult)) budgetExhausted = true;
  else if (totalResult.status !== 'ready') noteProblem(state, totalResult);
  const total: LineCountV1 = totalResult.status === 'ready'
    ? { status: 'exact', value: totalResult.value.count }
    : { status: 'unavailable', reason: totalResult.status === 'rejected' ? totalResult.reason : 'count failed' };
  return { status: 'read', openTerminal, recent, total, budgetExhausted };
}

function unknownTask(workspace: WorkspaceScope): TaskTriple {
  return { projectId: workspace.projectId, goalId: '', taskId: '' };
}

function targetTaskOf(link: SessionWorkLink): TaskTriple {
  // The ordered index fixes `ref.target.kind = 'task'` (session-record-codecs.ts:951).
  return (link.ref.target as { ref: TaskTriple }).ref;
}

async function readClosure(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  head: SessionRecord,
  link: SessionWorkLink,
): Promise<{ mode: LineClosureModeV1; archiveStep: boolean; exhausted: boolean }> {
  void workspace;
  if (link.until === null) return { mode: 'unknown', archiveStep: false, exhausted: false };
  const at = await records.eventAt(link.until);
  if (at.status !== 'ready') {
    return { mode: 'unknown', archiveStep: false, exhausted: at.status === 'rejected' && at.reason === 'history_budget' };
  }
  const event = sessionResponsibilityChangedEventFromEvent(at.value.event);
  if (event.status !== 'decoded') return { mode: 'unknown', archiveStep: false, exhausted: false };
  if (event.value.closed.ref.aggregateType !== 'SessionWorkLink'
    || refKey(event.value.closed.ref) !== refKey(link.ref)) return { mode: 'unknown', archiveStep: false, exhausted: false };
  if (refKey(event.value.source.ref) !== refKey(head.ref)) return { mode: 'unknown', archiveStep: false, exhausted: false };
  return { mode: event.value.mode, archiveStep: event.value.archiveStep !== null, exhausted: false };
}

// --- holder / latest work / latest query ----------------------------------- //

async function readHolder(records: WorkLineStore, workspace: WorkspaceScope, head: SessionRecord,
  state: LineReadState): Promise<LineFactsV1['holder']> {
  const occupancy = head.occupancy;
  if (occupancy === null || occupancy === undefined) return null;
  if (occupancy.kind === 'maintenance') return { kind: 'maintenance' };
  const ref = occupancy.executionRef;
  const key = refKeyOf(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) { noteProblem(state, { code: 'not_found', reason: `the occupancy record ${key} is absent` }); return null; }
  if (ref.aggregateType === 'QueryRun') {
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: `the occupancy QueryRun is not decodable: ${decoded.reason}` }); return null; }
    if (decoded.value.ref.workspaceId !== workspace.workspaceId) return null;
    return { kind: 'query', query: decoded.value };
  }
  const decoded = decodeRun(record);
  if (!decoded.ok) { noteProblem(state, { code: 'unavailable', reason: 'the occupancy Run is not decodable' }); return null; }
  const run = decoded.value;
  // L10 (review item 4): a Run that never started and has not ended still has a
  // real activity time, its claim time; read the claim the same bounded way.
  const claimedAt = run.startedAt === null && run.endedAt === null
    ? await readClaimedAtForRun(records, workspace, head, run.ref, state) : null;
  return { kind: 'run', run: lineRunFacts(run, await readPointerOf(records, run, state),
    await readContinuationConsumed(records, run, state), claimedAt) };
}

async function readLatestWork(records: WorkLineStore, workspace: WorkspaceScope, head: SessionRecord,
  state: LineReadState): Promise<(LineRunFactsV1 & { waitRecipient: SessionRef | 'user' | null }) | null> {
  // L1: no occupancy; lastExecutionRef is a Run when it is one; otherwise the
  // generation-ordered Work-claim index gives the latest claim (L4 index 6).
  if (head.lastExecutionRef !== null && head.lastExecutionRef !== undefined
    && head.lastExecutionRef.aggregateType === 'Run') {
    const latest = await readRunByRef(records, workspace, head.lastExecutionRef, state);
    // L10 (review item 4): the usual `lastExecutionRef === Run` path skipped the
    // claim read that supplies `claimedAt`. When the Run has neither start nor
    // end time, read that claim (bounded: the generation-ordered index's top row).
    if (latest !== null && latest.run.startedAt === null && latest.run.endedAt === null) {
      latest.claimedAt = await readClaimedAtForRun(records, workspace, head, head.lastExecutionRef, state);
    }
    return latest;
  }
  const page = await records.lookupOrdered({
    index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, head.ref.sessionId],
    direction: 'desc',
    limit: 1,
  });
  if (page.status !== 'ready') { noteProblem(state, page); return null; }
  if (page.value.records.length === 0) return null;
  const decoded = decodeDispatchOutboxEntry(page.value.records[0]!);
  if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: 'the latest work claim is not decodable' }); return null; }
  const latest = await readRunByRef(records, workspace, decoded.value.claim.runRef, state);
  // L10: the claim time is the last fallback when the Run has no start/end time.
  if (latest !== null) latest.claimedAt = decoded.value.claim.claimedAt ?? null;
  return latest;
}

/**
 * L10 (review item 4): the claim time recorded for a specific `lastExecutionRef`
 * Run, read only when the Run has neither `startedAt` nor `endedAt`. The
 * generation-ordered claim index's top row is that Run's claim when the Run is
 * the Session's latest work execution; it is trusted only when it names this Run
 * (bounded: one ordered page + one decode, no history scan).
 */
async function readClaimedAtForRun(records: WorkLineStore, workspace: WorkspaceScope, head: SessionRecord,
  runRef: RunRef, state: LineReadState): Promise<string | null> {
  const page = await records.lookupOrdered({
    index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, head.ref.sessionId],
    direction: 'desc',
    limit: 1,
  });
  if (page.status !== 'ready') { noteProblem(state, page); return null; }
  if (page.value.records.length === 0) return null;
  const decoded = decodeDispatchOutboxEntry(page.value.records[0]!);
  if (decoded.status !== 'decoded') return null;
  return refKeyOf(decoded.value.claim.runRef) === refKeyOf(runRef)
    ? (decoded.value.claim.claimedAt ?? null) : null;
}

async function readRunByRef(records: WorkLineStore, workspace: WorkspaceScope, ref: RunRef,
  state: LineReadState): Promise<(LineRunFactsV1 & { waitRecipient: SessionRef | 'user' | null }) | null> {
  const key = refKeyOf(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) { noteProblem(state, { code: 'not_found', reason: `the Run record ${key} is absent` }); return null; }
  const decoded = decodeRun(record);
  if (!decoded.ok) { noteProblem(state, { code: 'unavailable', reason: 'the latest work Run is not decodable' }); return null; }
  if (decoded.value.workspaceSnapshot.workspaceId !== workspace.workspaceId) return null;
  const run = decoded.value;
  const continuationConsumed = await readContinuationConsumed(records, run, state);
  const waitRecipient = await readWaitRecipient(records, run, state);
  return { ...lineRunFacts(run, await readPointerOf(records, run, state), continuationConsumed), waitRecipient };
}

/** L1 table: the occupancy Run's own control intent (`controlState.intentRef`), batch-read. */
async function readPointerOf(records: WorkLineStore, run: RunSnapshot,
  state: LineReadState): Promise<ControlIntentSnapshotV1 | null> {
  const ref = run.controlState?.intentRef;
  if (ref === undefined || ref === null) return null;
  const key = refKeyOf(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) { noteProblem(state, { code: 'not_found', reason: `the control intent record ${key} is absent` }); return null; }
  const decoded = decodeControlIntentSnapshot(record);
  if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: 'the control intent is not decodable' }); return null; }
  return decoded.value;
}

function lineRunFacts(run: RunSnapshot, pointer: ControlIntentSnapshotV1 | null,
  continuationConsumed = false, claimedAt: string | null = null): LineRunFactsV1 {
  return { run, pointer, pointerFromGoal: pointer !== null && stopRequesterOf(pointer) === 'goal_fan_out',
    continuationConsumed, goalDesiredState: 'active', claimedAt };
}

/**
 * RD-8 (L16): a `YieldedWait` Run's continuation is consumed when the TaskLease
 * names another holder Run (the successor re-held it). Reads the raw lease record
 * the same way `TaskExecutionRecord.lease` does; absent lease = not consumed.
 */
async function readContinuationConsumed(records: WorkLineStore, run: RunSnapshot,
  state: LineReadState): Promise<boolean> {
  if (run.status !== 'ended' || run.outcome !== 'yielded') return false;
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: run.ref.projectId, goalId: run.ref.goalId };
  const key = taskRecordRefKey('TaskLease', goalRef, run.task.taskId);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return false; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) return false;
  try {
    const lease = JSON.parse(record.json) as { holderRunId?: unknown };
    return typeof lease.holderRunId === 'string' && lease.holderRunId !== run.ref.runId;
  } catch {
    return false;
  }
}

/** L1 table (T7): the continuation message's recipient, the one this line waits for. */
async function readWaitRecipient(records: WorkLineStore, run: RunSnapshot,
  state: LineReadState): Promise<SessionRef | 'user' | null> {
  const messageRef = run.continuation?.messageRef;
  if (messageRef === undefined || messageRef === null) return null;
  const key = sessionMessageRefKey(messageRef);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) return null;
  const decoded = decodeSessionMessageRecord(record);
  if (decoded.status !== 'decoded') return null;
  const recipient = decoded.value.recipient;
  if ('kind' in recipient) return 'user';
  return { projectId: recipient.projectId, sessionId: recipient.sessionId };
}

function needsLatestQuery(duty: LineFactsV1['duty'], holder: LineFactsV1['holder'],
  latestWork: LineFactsV1['latestWork'], head: SessionRecord): boolean {
  // L10: a QueryRun lastExecutionRef contributes its activity time even when the
  // line is not a secretary.
  if (head.lastExecutionRef !== null && head.lastExecutionRef !== undefined
    && head.lastExecutionRef.aggregateType === 'QueryRun') return true;
  if (duty !== 'secretary') return false;
  if (latestWork !== null && latestWork.run.status === 'running') return false;
  // L20 (review item 10): an occupied secretary Query IS the latest Query; it is
  // read through the occupancy branch of `readLatestQuery`, not skipped.
  void holder;
  return true;
}

async function readLatestQuery(records: WorkLineStore, workspace: WorkspaceScope, head: SessionRecord,
  state: LineReadState): Promise<LatestQuery | null> {
  if (head.occupancy !== null && head.occupancy !== undefined && head.occupancy.kind === 'execution'
    && head.occupancy.executionRef.aggregateType === 'QueryRun') {
    return readQueryByRef(records, workspace, head.occupancy.executionRef, state);
  }
  if (head.lastExecutionRef !== null && head.lastExecutionRef !== undefined
    && head.lastExecutionRef.aggregateType === 'QueryRun') {
    return readQueryByRef(records, workspace, head.lastExecutionRef, state);
  }
  const page = await records.lookupOrdered({ index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, head.ref.sessionId], direction: 'desc', limit: 1 });
  if (page.status !== 'ready') { noteProblem(state, page); return null; }
  if (page.value.records.length === 0) return null;
  const decoded = decodeQueryRunSnapshotRecord(page.value.records[0]!);
  if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: 'the latest QueryRun is not decodable' }); return null; }
  return { query: decoded.value, goalId: await readQueryJobGoal(records, workspace, decoded.value, state) };
}

type LatestQuery = { query: QueryRunSnapshot; goalId: string | null };

async function readQueryByRef(records: WorkLineStore, workspace: WorkspaceScope, ref: { aggregateType: string },
  state: LineReadState): Promise<LatestQuery | null> {
  const key = refKeyOf(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) { noteProblem(state, { code: 'not_found', reason: `the QueryRun record ${key} is absent` }); return null; }
  const decoded = decodeQueryRunSnapshotRecord(record);
  if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: 'the QueryRun is not decodable' }); return null; }
  if (decoded.value.ref.workspaceId !== workspace.workspaceId) return null;
  return { query: decoded.value, goalId: await readQueryJobGoal(records, workspace, decoded.value, state) };
}

async function readQueryJobGoal(records: WorkLineStore, workspace: WorkspaceScope, run: QueryRunSnapshot,
  state: LineReadState): Promise<string | null> {
  const jobRef = run.run.queryJobRef;
  if (jobRef === undefined || jobRef === null) return null;
  const key = refKeyOf(jobRef);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { noteProblem(state, read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) return null;
  const decoded = decodeQueryJobSnapshot(record);
  if (decoded.status !== 'decoded') { noteProblem(state, { code: 'unavailable', reason: 'the QueryJob is not decodable' }); return null; }
  const goalId = decoded.value.job.goalId;
  return typeof goalId === 'string' ? goalId : null;
}

// --- copies (N1, M6) ------------------------------------------------------- //

/**
 * L1/N1 (review item 4a): the ACTIVE copies of a workspace, indexed by the
 * source Session they were copied from. Active Sessions are set by current work,
 * not history, so this is bounded; the previous read paginated every historical
 * `readonly_copy` of a chain Session just to drop the archived ones. Used for
 * the M6 marker on every assembly path.
 */
type ActiveCopies = Map<string, SessionRecord[]>;

function indexActiveCopies(sessions: readonly SessionRecord[]): ActiveCopies {
  const bySource: ActiveCopies = new Map();
  for (const session of sessions) {
    const provenance = session.provenance;
    if (provenance.kind !== 'readonly_copy') continue;
    if (session.lifecycle !== 'active') continue;
    const source = provenance.from.sessionId;
    const list = bySource.get(source);
    if (list === undefined) bySource.set(source, [session]);
    else list.push(session);
  }
  return bySource;
}

async function readActiveCopies(records: WorkLineStore, workspace: WorkspaceScope): Promise<StoreRead<ActiveCopies>> {
  const sessions: SessionRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({ index: S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, 'active', 'readonly_copy'], limit: 200,
      ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') return rejectionOf(page);
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status === 'decoded') sessions.push(decoded.value);
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: indexActiveCopies(sessions) };
}

async function readCopies(records: WorkLineStore, workspace: WorkspaceScope,
  chain: readonly LineChainEntryV1[], activeCopies: ActiveCopies, state: LineReadState): Promise<LineFactsV1['copies']> {
  const copies: LineFactsV1['copies'] = [];
  const seen = new Set<string>();
  for (const entry of chain) {
    // L1/N1 (review item 4a): take the already-enumerated ACTIVE copies of this
    // chain Session; no historical `readonly_copy` scan.
    for (const copy of activeCopies.get(entry.session.sessionId) ?? []) {
      const key = refKey(copy.ref);
      if (seen.has(key)) continue;
      seen.add(key);
      const info = await copyPhase(records, workspace, copy, state);
      copies.push({ session: { projectId: copy.ref.projectId, sessionId: copy.ref.sessionId },
        phase: info.phase, startedAt: info.startedAt });
    }
  }
  return copies;
}

async function copyPhase(records: WorkLineStore, workspace: WorkspaceScope, copy: SessionRecord,
  state: LineReadState): Promise<{ phase: import('../../../contracts/query-job.js').QueryExecutionStateV1['phase'] | null;
    startedAt: string | null }> {
  const latest = await readLatestQuery(records, workspace, copy, state);
  return { phase: latest?.query.run.executionState?.phase ?? null, startedAt: latest?.query.run.startedAt ?? null };
}

// --- workspace pins (L9) --------------------------------------------------- //

async function readPins(shared: SharedReads, records: WorkLineStore, workspace: WorkspaceScope,
  state: LineReadState): Promise<WorkspaceLineSettingsV1['pinned']> {
  if (shared.workspace === null) {
    const key = canonicalRefKey({ aggregateType: 'Workspace', projectId: workspace.projectId, workspaceId: workspace.workspaceId });
    const read = await records.readMany([key]);
    if (read.status !== 'ready') {
      noteProblem(state, read);
      return [];
    }
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record !== undefined) {
      const decoded = decodeWorkspaceSnapshot(record);
      if (decoded.status === 'decoded') shared.workspace = decoded.value;
    }
  }
  return shared.workspace?.lineSettings?.pinned ?? [];
}

// --- line identification helpers ------------------------------------------- //

async function hasContinuationSuccessor(records: WorkLineStore, workspace: WorkspaceScope, sessionId: string): Promise<StoreRead<boolean>> {
  const page = await records.lookup({
    index: S2C_SESSION_BY_KIND_FROM_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, 'continuation', sessionId],
    limit: 1,
  });
  if (page.status !== 'ready') return rejectionOf(page);
  return { status: 'ready', value: page.value.records.length > 0 };
}

/**
 * L2/N9: the outcome of the one shared `continuation` walk. A branch (N3)
 * returns every head explicitly; a provenance cycle (N9, corrupt data) returns
 * its members so the caller can report the problem instead of dropping the line.
 */
export type ContinuationResolution =
  | { kind: 'head'; head: SessionRef }
  | { kind: 'branched'; heads: SessionRef[] }
  | { kind: 'cycle'; members: SessionRef[] };

/**
 * L2/N9: one bounded, cycle-aware resolver shared by the work-line reader and
 * the node-detail reader. From any Session on a line it follows `continuation`
 * successors (either lifecycle, N2) to the line head(s), at most 32 steps (L2).
 * A branch returns all heads; a provenance cycle returns its members. The store
 * failure is propagated.
 */
export async function resolveContinuationLine(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  ref: SessionRef,
  /** L11 (review item 3a): receives each successor-resolution page's watermark. */
  cursorSink?: (cursor: CommitCursor | null) => void,
): Promise<StoreRead<ContinuationResolution>> {
  const seen = new Map<string, SessionRef>();
  const heads = new Map<string, SessionRef>();
  const cycle = new Map<string, SessionRef>();
  // N9 (review item 1): track the discovery path so a revisit reconstructs the
  // FULL cycle, not just the re-encountered node; the representative is the same
  // min-sessionId member the list/archived predecessor walk chooses.
  const parentOf = new Map<string, string>();
  const byKey = new Map<string, SessionRef>();
  const queue: { session: SessionRef; depth: number }[] = [{ session: ref, depth: 0 }];
  const rootKey = plainSessionKey(ref);
  seen.set(rootKey, ref);
  byKey.set(rootKey, ref);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= 32) {
      // L2: the head of a full 32-predecessor chain; the chain walk reports the truncation.
      heads.set(plainSessionKey(current.session), current.session);
      continue;
    }
    const successors: SessionRef[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await records.lookup({ index: S2C_SESSION_BY_KIND_FROM_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, 'continuation', current.session.sessionId],
        ...(after === undefined ? {} : { after }), limit: 200 });
      if (page.status !== 'ready') return rejectionOf(page);
      cursorSink?.(page.value.readThrough);
      for (const record of page.value.records) {
        const decoded = decodeSessionRecord(record);
        if (decoded.status !== 'decoded' || decoded.value.workspaceId !== workspace.workspaceId) continue;
        successors.push({ projectId: decoded.value.ref.projectId, sessionId: decoded.value.ref.sessionId });
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
    if (successors.length === 0) {
      heads.set(plainSessionKey(current.session), current.session);
      continue;
    }
    for (const successor of successors) {
      const key = plainSessionKey(successor);
      if (seen.has(key)) {
        // Reconstruct the full cycle along the discovery path from `current` to `successor`.
        cycle.set(key, successor);
        let nodeKey = plainSessionKey(current.session);
        for (let guard = 0; guard < 32 && nodeKey !== key; guard += 1) {
          const node = byKey.get(nodeKey);
          if (node !== undefined) cycle.set(nodeKey, node);
          const parentKey = parentOf.get(nodeKey);
          if (parentKey === undefined) break;
          nodeKey = parentKey;
        }
        continue;
      }
      seen.set(key, successor);
      parentOf.set(key, plainSessionKey(current.session));
      byKey.set(key, successor);
      queue.push({ session: successor, depth: current.depth + 1 });
    }
  }
  if (cycle.size > 0) return { status: 'ready', value: { kind: 'cycle', members: [...cycle.values()] } };
  const unique = [...heads.values()];
  if (unique.length > 1) return { status: 'ready', value: { kind: 'branched', heads: unique } };
  return { status: 'ready', value: { kind: 'head', head: unique[0] ?? ref } };
}

/**
 * N9 (review item 1): the min-sessionId representative of every `continuation`
 * provenance cycle reachable from `candidates` (corrupt data; the service cannot
 * create one). Unlike the old synchronous scan this walks `from` BACKWARDS with
 * batched `readMany`, reading records OUTSIDE the supplied page/window, at most
 * 32 steps. A revisit inside one walk is a cycle; its smallest refKey member is
 * the representative. With `filterToCandidates`, a representative is returned
 * only when it is itself a candidate, so an archived cycle split across pages is
 * emitted exactly once, by the page that contains the representative.
 */
async function cycleRepresentativesByWalk(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  candidates: readonly SessionRecord[],
  filterToCandidates: boolean,
): Promise<StoreRead<SessionRecord[]>> {
  const cache = new Map<string, SessionRecord>();
  const candidateIds = new Set(candidates.map((session) => session.ref.sessionId));
  // Seed the candidates with one batched read so their provenance is available.
  if (candidates.length > 0) {
    const keys = candidates.map((session) => sessionAggregateRefKey(plainSessionRefToAggregate({
      projectId: session.ref.projectId, sessionId: session.ref.sessionId })));
    const read = await records.readMany(keys);
    if (read.status !== 'ready') return rejectionOf(read);
    for (const record of read.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status === 'decoded' && decoded.value.workspaceId === workspace.workspaceId) {
        cache.set(decoded.value.ref.sessionId, decoded.value);
      }
    }
  }
  type Walk = { path: string[]; onPath: Map<string, number>; current: SessionRecord; done: boolean };
  const walks: Walk[] = candidates.map((session) => ({
    path: [session.ref.sessionId], onPath: new Map([[session.ref.sessionId, 0]]), current: session, done: false,
  }));
  const representatives = new Map<string, SessionRecord>();
  for (let step = 0; step < 32; step += 1) {
    // Batch the predecessor records the still-active walks need this step.
    const needed = new Map<string, SessionRef>();
    for (const walk of walks) {
      if (walk.done) continue;
      const provenance = walk.current.provenance;
      if (provenance.kind !== 'continuation') { walk.done = true; continue; }
      if (!cache.has(provenance.from.sessionId)) needed.set(provenance.from.sessionId, provenance.from);
    }
    if (needed.size > 0) {
      const keys = [...needed.values()].map((ref) =>
        sessionAggregateRefKey(plainSessionRefToAggregate(ref)));
      const read = await records.readMany(keys);
      if (read.status !== 'ready') return rejectionOf(read);
      for (const record of read.value.records) {
        const decoded = decodeSessionRecord(record);
        if (decoded.status === 'decoded' && decoded.value.workspaceId === workspace.workspaceId) {
          cache.set(decoded.value.ref.sessionId, decoded.value);
        }
      }
    }
    for (const walk of walks) {
      if (walk.done) continue;
      const provenance = walk.current.provenance;
      if (provenance.kind !== 'continuation') { walk.done = true; continue; }
      const predecessor = cache.get(provenance.from.sessionId);
      if (predecessor === undefined) { walk.done = true; continue; }
      const onPathIndex = walk.onPath.get(predecessor.ref.sessionId);
      if (onPathIndex !== undefined) {
        const members = walk.path.slice(onPathIndex);
        const representativeId = members.reduce((left, right) => (left <= right ? left : right));
        const representative = cache.get(representativeId);
        if (representative !== undefined) representatives.set(representativeId, representative);
        walk.done = true;
        continue;
      }
      walk.onPath.set(predecessor.ref.sessionId, walk.path.length);
      walk.path.push(predecessor.ref.sessionId);
      walk.current = predecessor;
    }
    if (walks.every((walk) => walk.done)) break;
  }
  const values = [...representatives.values()];
  return { status: 'ready', value: filterToCandidates
    ? values.filter((session) => candidateIds.has(session.ref.sessionId)) : values };
}

/** L2: walk `continuation` successors to the line head; null on a branch (N3) or a cycle (N9). */
async function findHeadOf(records: WorkLineStore, workspace: WorkspaceScope, ref: SessionRef): Promise<StoreRead<SessionRef | null>> {
  const resolved = await resolveContinuationLine(records, workspace, ref);
  if (resolved.status !== 'ready') return resolved;
  return { status: 'ready', value: resolved.value.kind === 'head' ? resolved.value.head : null };
}

// -------------------------------------------------------------------------- //
// Active list                                                                //
// -------------------------------------------------------------------------- //

type ActiveWindow = {
  sessions: SessionRecord[];
  from: CommitCursor | null;
  to: CommitCursor | null;
  withSuccessor: number;
};

async function readActiveSessions(records: WorkLineStore, workspace: WorkspaceScope): Promise<StoreRead<ActiveWindow>> {
  const active: SessionRecord[] = [];
  let first: CommitCursor | null = null;
  let last: CommitCursor | null = null;
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({
      index: SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, 'active'],
      ...(after === undefined ? {} : { after }),
      limit: 200,
    });
    if (page.status !== 'ready') return rejectionOf(page);
    if (first === null) first = page.value.readThrough;
    last = page.value.readThrough;
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status === 'decoded') active.push(decoded.value);
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  let withSuccessor = 0;
  for (const session of active) {
    if (session.provenance.kind === 'readonly_copy') continue;
    const successor = await hasContinuationSuccessor(records, workspace, session.ref.sessionId);
    if (successor.status !== 'ready') return successor;
    if (successor.value) withSuccessor += 1;
  }
  return { status: 'ready', value: { sessions: active, from: first, to: last, withSuccessor } };
}

async function listActiveHeads(records: WorkLineStore, workspace: WorkspaceScope): Promise<StoreRead<ActiveWindow & { heads: SessionRecord[] }>> {
  const windowResult = await readActiveSessions(records, workspace);
  if (windowResult.status !== 'ready') return windowResult;
  const window = windowResult.value;
  const heads: SessionRecord[] = [];
  const added = new Set<string>();
  for (const session of window.sessions) {
    if (session.provenance.kind === 'readonly_copy') continue;
    const successor = await hasContinuationSuccessor(records, workspace, session.ref.sessionId);
    if (successor.status !== 'ready') return successor;
    if (successor.value) continue;
    heads.push(session);
    added.add(session.ref.sessionId);
  }
  // N9 (review item 1): a provenance cycle's members all have successors, so N2
  // removed them all. Walk `from` backwards (batched, reading records outside the
  // window) and add the cycle's min-refKey representative back as a head
  // (problem `invalid`). All active candidates are present, so no filter is needed.
  const nonCopies = window.sessions.filter((session) => session.provenance.kind !== 'readonly_copy');
  const cycleHeads = await cycleRepresentativesByWalk(records, workspace, nonCopies, false);
  if (cycleHeads.status !== 'ready') return cycleHeads;
  for (const representative of cycleHeads.value) {
    if (added.has(representative.ref.sessionId)) continue;
    heads.push(representative);
    added.add(representative.ref.sessionId);
  }
  return { status: 'ready', value: { ...window, heads } };
}

// -------------------------------------------------------------------------- //
// Archived page (L5)                                                         //
// -------------------------------------------------------------------------- //

type ArchivedWindow = { heads: SessionRecord[]; nextCursor: string | null; sourceCursor: CommitCursor };

/** L5: one bounded candidate page of archived Sessions by `archivedAt` desc, filtered to heads. */
async function readArchivedPage(records: WorkLineStore, workspace: WorkspaceScope, limit: number, cursor: string | undefined): Promise<StoreRead<ArchivedWindow>> {
  if (cursor !== undefined && decodeArchivedCursor(cursor) === null) {
    // L5: a malformed cursor is invalid; never silently restart at page one.
    return { status: 'rejected', code: 'invalid', reason: 'the archived cursor is not readable' };
  }
  const afterValue = cursor === undefined ? undefined : decodeArchivedCursor(cursor)!;
  // L5: fetch ONE bounded candidate page, filter it, and advance its cursor even
  // when the returned page is short (copies and non-heads are dropped).
  const page = await records.lookupOrdered({ index: S2C_SESSION_ARCHIVED_AT_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, 'archived'], direction: 'desc', limit,
    ...(afterValue === undefined ? {} : { after: afterValue }) });
  if (page.status !== 'ready') return rejectionOf(page);
  const heads: SessionRecord[] = [];
  const nonCopies: SessionRecord[] = [];
  for (const record of page.value.records) {
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') continue;
    const session = decoded.value;
    if (session.provenance.kind === 'readonly_copy') continue;
    nonCopies.push(session);
    const successor = await hasContinuationSuccessor(records, workspace, session.ref.sessionId);
    if (successor.status !== 'ready') return successor;
    if (!successor.value) heads.push(session);
  }
  // N9 (review item 1): a provenance cycle's members all have a continuation
  // successor, so N2 dropped them all. Walk `from` backwards (batched, reading
  // records OUTSIDE this page) and add the min-refKey representative back
  // (problem `invalid`). Filter to this page's candidates so a cycle split across
  // archived pages is emitted exactly once, by the page holding the representative.
  const added = new Set(heads.map((session) => session.ref.sessionId));
  const cycleHeads = await cycleRepresentativesByWalk(records, workspace, nonCopies, true);
  if (cycleHeads.status !== 'ready') return cycleHeads;
  for (const representative of cycleHeads.value) {
    if (added.has(representative.ref.sessionId)) continue;
    heads.push(representative);
    added.add(representative.ref.sessionId);
  }
  const nextCursor = page.value.next === null ? null : encodeArchivedCursor(page.value.next);
  return { status: 'ready', value: { heads, nextCursor, sourceCursor: page.value.readThrough ?? ('c0000000000' as CommitCursor) } };
}

function encodeArchivedCursor(after: { order: string | number; refKey: string }): string {
  return Buffer.from(JSON.stringify({ v: 1, order: after.order, refKey: after.refKey }), 'utf8').toString('base64url');
}

function decodeArchivedCursor(cursor: string): { order: string | number; refKey: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as { order?: unknown; refKey?: unknown };
    if ((typeof value.order !== 'string' && typeof value.order !== 'number') || typeof value.refKey !== 'string') return null;
    return { order: value.order, refKey: value.refKey };
  } catch {
    return null;
  }
}

async function countWithoutArchivedAt(records: WorkLineStore, workspace: WorkspaceScope): Promise<LineCountV1> {
  const archived = await records.countLookup({ index: SESSION_BY_WORKSPACE_LIFECYCLE_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, 'archived'] });
  const withAt = await records.countLookup({ index: S2C_SESSION_ARCHIVED_AT_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, 'archived'] });
  if (archived.status !== 'ready') {
    return { status: 'unavailable', reason: `count_failed: ${archived.reason}` };
  }
  if (withAt.status !== 'ready') {
    return { status: 'unavailable', reason: `count_failed: ${withAt.reason}` };
  }
  if (String(archived.value.readThrough) !== String(withAt.value.readThrough)) {
    return { status: 'unavailable', reason: `source_moving: archived counts at ${String(archived.value.readThrough)} and ${String(withAt.value.readThrough)} differ` };
  }
  return { status: 'exact', value: Math.max(0, archived.value.count - withAt.value.count) };
}

// -------------------------------------------------------------------------- //
// Counts (L5)                                                                //
// -------------------------------------------------------------------------- //

async function countKinds(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  lifecycle: 'active' | 'archived',
  kinds: readonly (string | null)[],
): Promise<{ count: LineCountV1; cursors: (CommitCursor | null)[]; failed: boolean }> {
  let sum = 0;
  const cursors: (CommitCursor | null)[] = [];
  for (const kind of kinds) {
    const result = await records.countLookup({ index: S2C_SESSION_BY_LIFECYCLE_KIND_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, lifecycle, kind] });
    if (result.status !== 'ready') return { count: { status: 'unavailable', reason: 'count_failed' }, cursors: [...cursors, null], failed: true };
    cursors.push(result.value.readThrough);
    sum += result.value.count;
  }
  return { count: { status: 'exact', value: sum }, cursors, failed: false };
}

type ArchivedCountResult = {
  archived: LineCountV1 & { asOf: CommitCursor | null };
};

async function countArchived(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  activeFrom: CommitCursor | null,
  activeWithSuccessor: number,
): Promise<ArchivedCountResult> {
  const S = await countKinds(records, workspace, 'archived', ['new', 'continuation', 'handoff']);
  const F = await records.countLookup({ index: S2C_SESSION_BY_KIND_FROM_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, 'continuation'],
    distinctPath: 'provenance.from.sessionId' });
  const allCursors = [...S.cursors,
    F.status === 'ready' ? F.value.readThrough : null];
  const sameInstant = activeFrom !== null && allCursors.every((cursor) => cursor !== null && String(cursor) === String(activeFrom));
  if (S.failed || F.status !== 'ready') {
    return { archived: { status: 'unavailable', reason: 'count_failed', asOf: null } };
  }
  if (!sameInstant) {
    return { archived: { status: 'unavailable', reason: `source_moving: ${describeMoving(activeFrom, allCursors)}`, asOf: F.value.readThrough } };
  }
  const s = S.count.status === 'exact' ? S.count.value : 0;
  const f = F.value.count;
  const c = s - (f - activeWithSuccessor);
  if (c < 0 || c > s) {
    return { archived: { status: 'unavailable', reason: `source_moving: archived count ${String(c)} is outside 0..${String(s)}`, asOf: F.value.readThrough } };
  }
  return { archived: { status: 'exact', value: c, asOf: F.value.readThrough } };
}

function describeMoving(activeFrom: CommitCursor | null, cursors: (CommitCursor | null)[]): string {
  const mismatch = cursors.find((cursor) => cursor === null || String(cursor) !== String(activeFrom));
  return `active window ${String(activeFrom)} and a count at ${String(mismatch)} differ`;
}

// -------------------------------------------------------------------------- //
// Name, last activity                                                        //
// -------------------------------------------------------------------------- //

function deriveName(
  duty: LineFactsV1['duty'],
  holder: LineFactsV1['holder'],
  latestWork: LineFactsV1['latestWork'],
  latestQuery: LatestQuery | null,
  responsibleOpen: readonly LineTaskFactV1[],
  taskFacts: Map<string, LineTaskFactV1>,
  head: SessionRecord,
  secretaryGoalTitle: string | null,
): LineNameV1 {
  const titleOf = (task: TaskTriple): string => taskFacts.get(taskCanonicalKey(task))?.title ?? task.taskId;
  if (duty === 'secretary') {
    if (latestQuery !== null && latestQuery.goalId !== null) {
      const goal = latestQuery.goalId;
      return { source: 'secretary_interim', primary: secretaryGoalTitle ?? goal, extraCount: 0, tasks: [], goalRef: { aggregateType: 'Goal', projectId: head.ref.projectId, goalId: goal }, complete: true };
    }
    const complete = !(head.provenance === null || head.provenance === undefined);
    return { source: 'secretary_interim', primary: '秘书 · 未定话题', extraCount: 0, tasks: [], goalRef: null, complete };
  }
  if (holder !== null && holder.kind === 'run') {
    const task = holder.run.run.task;
    return { source: 'running_task', primary: titleOf(task), extraCount: 0, tasks: [task],
      goalRef: { aggregateType: 'Goal', projectId: head.ref.projectId, goalId: task.goalId }, complete: true };
  }
  if (responsibleOpen.length > 0) {
    const first = responsibleOpen[0]!;
    return { source: 'open_tasks', primary: titleOf(first.task), extraCount: responsibleOpen.length - 1,
      tasks: responsibleOpen.map((task) => task.task),
      goalRef: { aggregateType: 'Goal', projectId: head.ref.projectId, goalId: first.task.goalId }, complete: true };
  }
  if (latestWork !== null) {
    const task = latestWork.run.task;
    return { source: 'recent_task', primary: titleOf(task), extraCount: 0, tasks: [task],
      goalRef: { aggregateType: 'Goal', projectId: head.ref.projectId, goalId: task.goalId }, complete: true };
  }
  if (duty === 'unknown') return { source: 'duty_only', primary: 'unknown', extraCount: 0, tasks: [], goalRef: null, complete: true };
  return { source: 'duty_only', primary: duty, extraCount: 0, tasks: [], goalRef: null, complete: true };
}

function deriveLastActivity(
  head: SessionRecord,
  holder: LineFactsV1['holder'],
  latestWork: LineFactsV1['latestWork'],
  copies: LineFactsV1['copies'],
  latestQuery: LatestQuery | null,
): string {
  // L10: the latest of the head's creation, the last execution's endedAt →
  // startedAt → claim time, and each active copy's Query start.
  const candidates: string[] = [head.createdAt];
  const push = (at: string | null | undefined): void => {
    if (at !== null && at !== undefined) candidates.push(at);
  };
  const runFacts = holder !== null && holder.kind === 'run' ? holder.run : latestWork;
  if (runFacts !== null) {
    push(runFacts.run.endedAt ?? runFacts.run.startedAt ?? runFacts.claimedAt ?? null);
  }
  if (holder !== null && holder.kind === 'query') push(holder.query.run.endedAt ?? holder.query.run.startedAt);
  if (latestQuery !== null) push(latestQuery.query.run.endedAt ?? latestQuery.query.run.startedAt);
  for (const copy of copies) push(copy.startedAt);
  return candidates.sort().at(-1) ?? head.createdAt;
}

// -------------------------------------------------------------------------- //
// The read port                                                              //
// -------------------------------------------------------------------------- //

async function readHistoryParts(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  chain: readonly LineChainEntryV1[],
  head: SessionRecord,
  state: { records: WorkLineStore; budget: Budget },
): Promise<{
  writtenAnchorsPending: LineCountV1;
  writtenAnchorsNext: LineTaskArchiveNextV1 | null;
  undelivered: LineCountV1 | { status: 'not_applicable' };
  partialParts: { part: 'written_anchors' | 'undelivered' | 'done_evidence'; reason: string }[];
  problem: LineProblem | null;
}> {
  // L1b fixed order: written anchors -> undelivered -> done evidence. Every read
  // below goes through the line's own counting wrapper, so once the budget is
  // exhausted the rest of the historical parts fail as `partial` (never 0).
  const partialParts: { part: 'written_anchors' | 'undelivered' | 'done_evidence'; reason: string }[] = [];
  let problem: LineProblem | null = null;
  const note = (failure: { code: string; reason: string }): void => {
    if (problem === null) problem = { code: storeFailureCode({ code: failure.code }), reason: failure.reason };
  };

  // §3.4 AT4: the outstanding written anchors' `next` comes from the authoritative
  // archive-state read, never a guess. L1b lists `readTaskArchiveState` as a
  // shared, unbudgeted cost, so it is built on the raw store: charging its reads
  // to the line's L1b budget made an ordinary 30-anchor line (2C-25's W) exhaust
  // exactly at the default 100 and wrongly report `done_evidence` partial.
  const anomalyPort = deps.sessionAnomaliesFor(deps.records);
  const nextOf = async (task: TaskTriple): Promise<LineTaskArchiveNextV1 | null> => {
    if (typeof anomalyPort.readTaskArchiveState !== 'function') return null;
    try {
      const read = await anomalyPort.readTaskArchiveState(ctx, task);
      return read.status === 'ready' ? read.value.next : null;
    } catch {
      return null;
    }
  };
  const anchors = await readWrittenAnchors(state.records, workspace, chain, nextOf);
  // L1b (review item 8): a budget stop records `history_budget`, the same token
  // the done-evidence part uses; other partials keep their prose reason.
  if (anchors.partial) partialParts.push({ part: 'written_anchors',
    reason: anchors.budget ? 'history_budget' : anchors.reason });
  if (anchors.hardFailure !== null) note(anchors.hardFailure);

  const headRef: SessionRef = { projectId: head.ref.projectId, sessionId: head.ref.sessionId };
  let undelivered: LineCountV1 | { status: 'not_applicable' };
  if (head.health === 'unavailable') {
    const read = await readUndelivered(deps, ctx, headRef, state);
    undelivered = read.count;
    if (read.partial) partialParts.push({ part: 'undelivered',
      reason: read.budget ? 'history_budget' : read.reason });
    if (read.hardFailure !== null) note(read.hardFailure);
  } else {
    undelivered = { status: 'not_applicable' };
  }

  return { writtenAnchorsPending: anchors.count, writtenAnchorsNext: anchors.next ?? null,
    undelivered, partialParts, problem };
}

// --- L1b 1/3: anchors written by the Sessions on this line (index 8) -------- //

type PartRead = { count: LineCountV1; partial: boolean; reason: string;
  /** L1b (review item 8): the partial stop was the per-line history budget. */
  budget: boolean;
  hardFailure: { code: string; reason: string } | null; next?: LineTaskArchiveNextV1 | null };

async function readWrittenAnchors(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  chain: readonly LineChainEntryV1[],
  /** §3.4 AT4 (L1b): the authoritative archive-state `next` of an outstanding anchor's task. */
  nextOf: (task: TaskTriple) => Promise<LineTaskArchiveNextV1 | null>,
): Promise<PartRead> {
  const anchors: import('../../../contracts/session-anomaly.js').SessionAnomalyAnchorV1[] = [];
  let partial = false;
  let hard: { code: string; reason: string } | null = null;
  let stop = false;
  for (const entry of chain) {
    let after: string | undefined;
    for (;;) {
      const page = await records.lookup({ index: S2C_ANOMALY_BY_SESSION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, entry.session.sessionId], limit: 100,
        ...(after === undefined ? {} : { after }) });
      if (page.status !== 'ready') {
        if (isBudgetFailure(page)) { partial = true; stop = true; }
        else hard = { code: page.code, reason: page.reason };
        break;
      }
      for (const record of page.value.records) {
        const decoded = decodeSessionAnomalyAnchor(record);
        if (decoded.status !== 'decoded') {
          hard = { code: 'unavailable', reason: `the SessionAnomalyAnchor ${record.refKey} is damaged: ${decoded.reason}` };
          stop = true;
          break;
        }
        anchors.push(decoded.value);
      }
      if (stop || page.value.next === null) break;
      after = page.value.next;
    }
    if (stop) break;
  }
  if (hard !== null) {
    return { count: { status: 'unavailable', reason: hard.reason }, partial: true, budget: false,
      reason: hard.reason, hardFailure: hard };
  }

  // A written anchor counts as outstanding only once its Task's entered
  // successors were read and none carries it (§3.12).
  const groups = new Map<string, { task: TaskTriple; anchors: typeof anchors }>();
  for (const anchor of anchors) {
    const key = taskCanonicalKey(anchor.task);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { task: anchor.task, anchors: [anchor] });
    else group.anchors.push(anchor);
  }
  let unclaimed = 0;
  let outstandingTask: TaskTriple | null = null;
  for (const group of groups.values()) {
    const entered = await readEnteredAnchors(records, group.task);
    if (entered.hardFailure !== null) {
      return { count: { status: 'unavailable', reason: entered.hardFailure.reason }, partial: true, budget: false,
        reason: entered.hardFailure.reason, hardFailure: entered.hardFailure };
    }
    if (entered.exhausted) { partial = true; break; }
    for (const anchor of group.anchors) {
      const pickers = entered.pickers.get(sessionAnomalyRefKey(anchor.ref));
      // §3.12: only a later, DIFFERENT Session can pick an anchor up.
      const picked = pickers !== undefined && [...pickers].some((sessionKey) => sessionKey !== anchorSessionKey(anchor));
      if (!picked) { unclaimed += 1; if (outstandingTask === null) outstandingTask = group.task; }
    }
  }
  const next = outstandingTask === null ? null : await nextOf(outstandingTask);
  if (partial) {
    const reason = 'the history read budget was exhausted before the written anchors were read in full (L1b)';
    return { count: { status: 'partial', atLeast: unclaimed, reason }, partial: true, budget: true, reason, hardFailure: null, next };
  }
  return { count: { status: 'exact', value: unclaimed }, partial: false, budget: false, reason: '', hardFailure: null, next };
}

async function readEnteredAnchors(
  records: WorkLineStore,
  task: TaskTriple,
): Promise<{ pickers: Map<string, Set<string>>; exhausted: boolean; hardFailure: { code: string; reason: string } | null }> {
  const pickers = new Map<string, Set<string>>();
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({ index: RUN_BY_TASK_INDEX,
      values: [task.projectId, task.goalId, task.taskId], limit: 100,
      ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') {
      if (isBudgetFailure(page)) return { pickers, exhausted: true, hardFailure: null };
      return { pickers, exhausted: false, hardFailure: { code: page.code, reason: page.reason } };
    }
    const keys = [...new Set(page.value.records.map((record) => record.refKey))];
    if (keys.length > 0) {
      const read = await records.readMany(keys);
      if (read.status !== 'ready') {
        if (isBudgetFailure(read)) return { pickers, exhausted: true, hardFailure: null };
        return { pickers, exhausted: false, hardFailure: { code: read.code, reason: read.reason } };
      }
      for (const record of read.value.records) {
        const decoded = decodeRun(record);
        if (!decoded.ok) {
          return { pickers, exhausted: false,
            hardFailure: { code: 'unavailable', reason: `a Run of the Task is not decodable: ${decoded.reason}` } };
        }
        const run = decoded.value;
        if (run.task.taskId !== task.taskId || run.task.goalId !== task.goalId
          || run.task.projectId !== task.projectId) continue;
        const anchorRefs = run.inputBinding?.anomalyAnchorRefs;
        if (anchorRefs === undefined || anchorRefs.length === 0) continue;
        if (run.executionHistory === undefined) continue;
        const pickerSession = plainSessionKey(run.executionHistory.sessionRef);
        for (const ref of anchorRefs) {
          const key = sessionAnomalyRefKey(ref);
          const set = pickers.get(key);
          if (set === undefined) pickers.set(key, new Set([pickerSession]));
          else set.add(pickerSession);
        }
      }
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { pickers, exhausted: false, hardFailure: null };
}

/** The canonical key of a plain Session identity, whether or not it carries `aggregateType`. */
function plainSessionKey(ref: unknown): string {
  const value = ref as { projectId?: unknown; sessionId?: unknown };
  return canonicalJson({ projectId: String(value.projectId ?? ''), sessionId: String(value.sessionId ?? '') } as unknown as JsonValue);
}

function anchorSessionKey(anchor: import('../../../contracts/session-anomaly.js').SessionAnomalyAnchorV1): string {
  return canonicalJson({ projectId: anchor.sessionRef.projectId, sessionId: anchor.sessionRef.sessionId } as unknown as JsonValue);
}

// --- L1b 2/3: undelivered replies of an unavailable head ------------------- //

async function readUndelivered(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  headRef: SessionRef,
  state: { records: WorkLineStore; budget: Budget },
): Promise<PartRead> {
  const reader = deps.undeliveredRepliesFor(state.records);
  if (reader === undefined) {
    const reason = 'the undelivered-reply reader is not injected (L1b)';
    return { count: { status: 'unavailable', reason }, partial: true, budget: false, reason, hardFailure: null };
  }
  let items = 0;
  let cursor: string | undefined;
  for (;;) {
    const read = await reader(ctx, { sessionRef: headRef,
      page: cursor === undefined ? { limit: 100 } : { limit: 100, cursor } });
    if (read.status !== 'ready') {
      if (read.status === 'rejected' && !isBudgetFailure(read) && read.code !== 'incomplete') {
        return { count: { status: 'unavailable', reason: read.reason }, partial: true, budget: false, reason: read.reason,
          hardFailure: { code: read.code, reason: read.reason } };
      }
      const budget = read.status === 'rejected' && isBudgetFailure(read);
      const reason = read.status === 'rejected'
        ? (budget
          ? 'the history read budget was exhausted before the undelivered replies were read in full (L1b)'
          : `the undelivered-reply reader is incomplete: ${read.reason}`)
        : read.status === 'not_ready'
          ? 'the undelivered replies are not readable at the required watermark'
          : 'the undelivered replies were not found';
      return { count: { status: 'partial', atLeast: items, reason }, partial: true, budget, reason, hardFailure: null };
    }
    items += read.value.items.length;
    if (read.value.nextCursor === null) break;
    cursor = read.value.nextCursor;
  }
  return { count: { status: 'exact', value: items }, partial: false, budget: false, reason: '', hardFailure: null };
}

// --- L8: the real decision queue (2A) and the cards that land on a line ----- //

type QueueCard = {
  card: LineCardFactV1;
  senderSessionRef: SessionRef | null;
  forwardedFromSender: SessionRef | null;
  taskPins: TaskTriple[];
  excluded: boolean;
};
type QueueRead = { cards: QueueCard[]; complete: boolean; problem: string | null };

const EXCLUDED_GOAL_CAUSES: ReadonlySet<string> = new Set([
  'required_task_deferred', 'initial_plan_pending', 'change_pending',
]);

/** A present-but-failed queue read is a read-incomplete, never "no cards" (rule 5). */
async function readDecisionQueue(deps: WorkLineReaderDeps, ctx: CoreCallContext, workspace: WorkspaceScope): Promise<QueueRead> {
  if (deps.decisions === undefined) return { cards: [], complete: true, problem: null };
  const cards: DecisionCardV1[] = [];
  try {
    let cursor: string | undefined;
    for (;;) {
      const read = await deps.decisions.queryDecisionQueue(ctx, { workspace, sections: ['waiting_answer'],
        page: cursor === undefined ? { limit: 100 } : { limit: 100, cursor } });
      if (read.status !== 'ready') {
        return { cards: [], complete: false,
          problem: `decision_queue_read_failed: ${read.status === 'rejected' ? read.reason : read.status}` };
      }
      for (const card of read.value.waitingAnswer) {
        if (card.state === 'waiting_answer') cards.push(card);
      }
      if (read.value.nextCursor === null) break;
      cursor = read.value.nextCursor;
    }
  } catch (error) {
    return { cards: [], complete: false, problem: `decision_queue_read_failed: ${String(error instanceof Error ? error.message : error)}` };
  }

  const keys = new Set<string>();
  for (const card of cards) {
    if (card.source.kind !== 'message') continue;
    const ref = parseMessageKey(card.source.key);
    if (ref !== null) keys.add(sessionMessageRefKey(ref));
  }
  const messages = new Map<string, SessionMessage>();
  if (keys.size > 0) {
    const read = await deps.records.readMany([...keys]);
    if (read.status !== 'ready') {
      return { cards: [], complete: false, problem: `decision_queue_message_read_failed: ${read.reason}` };
    }
    for (const record of read.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status === 'decoded') messages.set(record.refKey, decoded.value);
    }
  }
  // A forwarded card's original message gives the executor line (L8).
  const forwardedKeys = new Set<string>();
  for (const message of messages.values()) {
    const forwarded = message.decision?.forwardedFrom ?? null;
    if (forwarded !== null) forwardedKeys.add(sessionMessageRefKey(forwarded));
  }
  if (forwardedKeys.size > 0) {
    const read = await deps.records.readMany([...forwardedKeys]);
    if (read.status !== 'ready') {
      return { cards: [], complete: false, problem: `decision_queue_message_read_failed: ${read.reason}` };
    }
    for (const record of read.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status === 'decoded') messages.set(record.refKey, decoded.value);
    }
  }
  return { cards: cards.map((card) => toQueueCard(card, messages)), complete: true, problem: null };
}

function toQueueCard(card: DecisionCardV1, messages: ReadonlyMap<string, SessionMessage>): QueueCard {
  let code: string | null = null;
  let codeReadable = true;
  const taskPins: TaskTriple[] = [];
  if (card.source.kind === 'goal_cause') {
    const parsed = parseGoalCauseKey(card.source.key);
    if (parsed === null) {
      codeReadable = false;
    } else {
      code = parsed.code;
      for (const pin of parsed.affected) {
        const task = asTaskTriple(pin.ref);
        if (task !== null) taskPins.push(task);
      }
    }
  } else {
    for (const object of card.objects) {
      if (object.kind !== 'aggregate') continue;
      const task = asTaskTriple(object.pin.ref);
      if (task !== null) taskPins.push(task);
    }
  }
  let forwardedFromSender: SessionRef | null = null;
  if (card.source.kind === 'message') {
    const ref = parseMessageKey(card.source.key);
    const message = ref === null ? undefined : messages.get(sessionMessageRefKey(ref));
    const forwarded = message?.decision?.forwardedFrom ?? null;
    if (forwarded !== null) {
      const original = messages.get(sessionMessageRefKey(forwarded));
      if (original !== undefined && original.sender.kind === 'work_run') forwardedFromSender = original.sender.sessionRef;
    }
  }
  return {
    card: { source: card.source, cardKey: card.cardKey, code, codeReadable },
    senderSessionRef: card.senderSessionRef,
    forwardedFromSender,
    taskPins: dedupeTasks(taskPins),
    excluded: code !== null && EXCLUDED_GOAL_CAUSES.has(code),
  };
}

/** A stored-absent `Task` pin (`{aggregateType:'Task',...}`) as the plain TaskTriple. */
function asTaskTriple(ref: unknown): TaskTriple | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const value = ref as { aggregateType?: unknown; projectId?: unknown; goalId?: unknown; taskId?: unknown };
  if (value.aggregateType !== 'Task' || typeof value.projectId !== 'string'
    || typeof value.goalId !== 'string' || typeof value.taskId !== 'string') return null;
  return { projectId: value.projectId, goalId: value.goalId, taskId: value.taskId };
}

function parseGoalCauseKey(key: string): { code: string; affected: VersionPin[] } | null {
  try {
    const parsed = JSON.parse(key) as { kind?: unknown; code?: unknown; affected?: unknown };
    if (parsed.kind !== 'goal_cause' || typeof parsed.code !== 'string' || !Array.isArray(parsed.affected)) return null;
    const affected: VersionPin[] = [];
    for (const entry of parsed.affected) {
      if (typeof entry !== 'object' || entry === null) return null;
      const pin = entry as { ref?: unknown; revision?: unknown };
      if (typeof pin.ref !== 'object' || pin.ref === null || typeof pin.revision !== 'number') return null;
      affected.push({ ref: pin.ref as VersionPin['ref'], revision: pin.revision });
    }
    return { code: parsed.code, affected };
  } catch {
    return null;
  }
}

function parseMessageKey(key: string): SessionMessageRef | null {
  try {
    const parsed = JSON.parse(key) as { kind?: unknown; messageRef?: unknown };
    if (parsed.kind !== 'message' || typeof parsed.messageRef !== 'object' || parsed.messageRef === null) return null;
    const ref = parsed.messageRef as SessionMessageRef;
    if (ref.aggregateType !== 'SessionMessage' || typeof ref.projectId !== 'string'
      || typeof ref.workspaceId !== 'string' || typeof ref.messageId !== 'string') return null;
    return ref;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------- //
// lines/page sections and the conversation source (2C-18, L12, L17, L23)     //
// -------------------------------------------------------------------------- //

const PAGE_CURSOR_PREFIX = 's2c-page:';

function encodePageCursor(value: unknown): string {
  return PAGE_CURSOR_PREFIX + Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodePageCursor(cursor: string): Record<string, unknown> | null {
  if (!cursor.startsWith(PAGE_CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor.slice(PAGE_CURSOR_PREFIX.length), 'base64url').toString('utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function invalidPage(reason: string): CoreRejection {
  return { status: 'rejected', code: 'invalid', reason };
}

function stalePage(reason: string): CoreRejection {
  return { status: 'rejected', code: 'source_stale', reason };
}

function sameSessionChain(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sessionRefOf(session: SessionRecord): SessionRef {
  return { projectId: session.ref.projectId, sessionId: session.ref.sessionId };
}

/** §3.9: a `missing`/`damaged` unavailable Session's original history is not readable. */
function isHistoryNotReadable(session: SessionRecord): boolean {
  const conclusion = session.healthConclusion ?? null;
  return session.health === 'unavailable' && (conclusion === 'missing' || conclusion === 'damaged');
}

/** L12: one conversation segment header; `missing`/`damaged` histories are not readable. */
function toSegment(session: SessionRecord): LineSegmentV1 {
  const conclusion = session.healthConclusion ?? null;
  const notReadable = isHistoryNotReadable(session);
  const code: LineReasonV1['code'] = conclusion === 'missing' ? 'retired_missing'
    : conclusion === 'damaged' ? 'retired_damaged' : 'retired_unrecorded';
  return {
    session: sessionRefOf(session),
    kernel: { adapterId: session.kernel.adapterId, kernelSessionId: session.kernel.kernelSessionId },
    from: session.createdAt,
    to: session.archivedAt ?? null,
    history: notReadable ? 'not_readable' : 'readable',
    reason: notReadable ? { code, params: {}, refs: [] } : null,
  };
}

/** The chain oldest-first (head last) plus its read horizon, for the section cursors. */
async function readLineChainSessions(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  head: SessionRecord,
): Promise<StoreRead<{ sessions: SessionRecord[]; omitted: LineCountV1; readThrough: CommitCursor | null; cursors: (CommitCursor | null)[] }>> {
  const sessions: SessionRecord[] = [head];
  let current = head;
  let truncated = false;
  let readThrough: CommitCursor | null = null;
  // L11/L12: keep EVERY predecessor watermark, not only the last, so a page's
  // same-instant check covers each chain read (review item 8).
  const cursors: (CommitCursor | null)[] = [];
  for (let step = 0; step < 32; step += 1) {
    const provenance = current.provenance;
    if (provenance.kind !== 'continuation') break;
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(provenance.from));
    const read = await records.readMany([key]);
    if (read.status !== 'ready') return rejectionOf(read);
    readThrough = read.value.readThrough ?? readThrough;
    cursors.push(read.value.readThrough);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) break;
    const decoded = decodeSessionRecord(record);
    if (decoded.status !== 'decoded') break;
    const predecessor = decoded.value;
    if (predecessor.ref.projectId !== workspace.projectId || predecessor.workspaceId !== workspace.workspaceId) break;
    sessions.push(predecessor);
    current = predecessor;
    if (step === 31) {
      truncated = current.provenance.kind === 'continuation';
    }
  }
  const omitted: LineCountV1 = truncated
    ? { status: 'partial', atLeast: 1, reason: 'the chain exceeds 32 predecessors (L2)' }
    : { status: 'exact', value: 0 };
  return { status: 'ready', value: { sessions, omitted, readThrough, cursors } };
}

type ResolvedLine = { head: SessionRecord; sessions: SessionRecord[]; omitted: LineCountV1;
  readThrough: CommitCursor | null; cursors: (CommitCursor | null)[];
  /** The head Session read's real watermark (review item 11: never a fabricated zero). */
  headCursor: CommitCursor | null };

/** N9: the min-sessionId representative of a provenance cycle. */
function cycleRepresentativeOf(members: readonly SessionRef[]): SessionRef {
  return members.reduce((left, right) => (left.sessionId <= right.sessionId ? left : right));
}

async function resolveLine(records: WorkLineStore, workspace: WorkspaceScope, key: SessionRef): Promise<StoreRead<ResolvedLine> | { status: 'not_found' }> {
  // N9: a provenance cycle has no single head; its min-refKey representative
  // stands for the line so sections still resolve (the chain read reports the
  // `invalid` problem). Review item 1.
  // L11 (review item 3a): the successor-resolution reads and the head read are
  // part of the same-instant consistency set, not only the predecessor watermarks.
  const resolutionCursors: (CommitCursor | null)[] = [];
  const resolution = await resolveContinuationLine(records, workspace, key,
    (cursor) => { resolutionCursors.push(cursor); });
  if (resolution.status !== 'ready') return resolution;
  const headRef = resolution.value.kind === 'head'
    ? resolution.value.head
    : resolution.value.kind === 'cycle' ? cycleRepresentativeOf(resolution.value.members) : null;
  if (headRef === null) return { status: 'not_found' };
  const headSink: { cursor: CommitCursor | null } = { cursor: null };
  const headResult = await readSession(records, workspace, headRef, headSink);
  if (headResult.status !== 'ready') return headResult;
  if (headResult.value === null) return { status: 'not_found' };
  const head = headResult.value;
  const chain = await readLineChainSessions(records, workspace, head);
  if (chain.status !== 'ready') return chain;
  const cursors = [headSink.cursor, ...resolutionCursors, ...chain.value.cursors];
  return { status: 'ready', value: { head, ...chain.value, cursors, headCursor: headSink.cursor } };
}

async function readWorkLineConversationSource(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  key: SessionRef,
): Promise<ReadResult<LineConversationSourceV1>> {
  const resolved = await resolveLine(records, workspace, key);
  if (resolved.status !== 'ready') return resolved;
  const oldestFirst = [...resolved.value.sessions].reverse();
  return {
    status: 'ready',
    value: {
      segments: oldestFirst.map(toSegment),
      // Review item 11: a single-Session line has no predecessor watermark, so use
      // the head's own read watermark; never a fabricated zero.
      sourceCursor: resolved.value.readThrough ?? resolved.value.headCursor ?? ('c0000000000' as CommitCursor),
    },
  };
}

// --- L23: the gate checks of the gate tasks this line is responsible for ---- //

async function readGateChecks(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  row: LineRowV1,
): Promise<LineGateCheckV1[]> {
  if (deps.plans === undefined) return [];
  const shared: SharedReads = { goals: new Map(), workspace: null };
  const result: LineGateCheckV1[] = [];
  const seenRounds = new Set<string>();
  const seenTasks = new Set<string>();
  for (const brief of row.responsibleNow) {
    const task = brief.task;
    const taskKey = taskCanonicalKey(task);
    if (seenTasks.has(taskKey)) continue;
    seenTasks.add(taskKey);
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: workspace.projectId, goalId: task.goalId };
    const goal = await loadGoal(deps, ctx, shared, task.goalId, goalRef);
    if (goal === null) continue;
    if (goal.tasks.get(task.taskId)?.definition.taskKind !== 'gate') continue;
    let after: string | undefined;
    for (;;) {
      const page = await deps.records.lookup({ index: VERIFICATION_ROUND_BY_TASK_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, task.goalId, task.taskId], limit: 100,
        ...(after === undefined ? {} : { after }) });
      if (page.status !== 'ready') break;
      for (const record of page.value.records) {
        const decoded = decodeVerificationRoundSnapshot(record);
        if (decoded.status !== 'decoded') continue;
        const round = decoded.value;
        const roundKey = canonicalJson(round.ref as unknown as JsonValue);
        if (seenRounds.has(roundKey)) continue;
        seenRounds.add(roundKey);
        let sinceAt: string | null = null;
        const origin = decodeNoticeOrigin(record);
        if (origin.status === 'decoded' && origin.value.since !== undefined && origin.value.since !== null) {
          const event = await deps.records.eventAt(origin.value.since);
          if (event.status === 'ready') sinceAt = event.value.event.occurredAt;
        }
        result.push({ gateTask: task, roundRef: round.ref, revision: round.revision,
          sinceAt, status: round.status, chainIndex: round.chain?.ordinal ?? 0, producerRunRef: round.subjectRunRef });
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
  }
  result.sort((left, right) => {
    if (left.sinceAt === null && right.sinceAt !== null) return -1;
    if (left.sinceAt !== null && right.sinceAt === null) return 1;
    if (left.sinceAt !== null && right.sinceAt !== null && left.sinceAt !== right.sinceAt) {
      return left.sinceAt < right.sinceAt ? -1 : 1;
    }
    const a = canonicalJson(left.roundRef as unknown as JsonValue);
    const b = canonicalJson(right.roundRef as unknown as JsonValue);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return result;
}

// --- L12 executions: Work claims and QueryRuns by generation ---------------- //

type ExecutionsSeen = { work: number; query: number };
type WorkCandidate = { claim: TaskClaim; sessionRef: SessionRef };
type QueryCandidate = { snapshot: QueryRunSnapshot; sessionRef: SessionRef; generation: number };

function topWorkGeneration(records: readonly { refKey: string; json: string; schemaId: string; revision: number | null }[]): number | null {
  const record = records[0];
  if (record === undefined) return null;
  const decoded = decodeDispatchOutboxEntry(record as never);
  return decoded.status === 'decoded' ? decoded.value.claim.generation : null;
}

function topQueryGeneration(records: readonly { refKey: string; json: string; schemaId: string; revision: number | null }[]): number | null {
  const record = records[0];
  if (record === undefined) return null;
  const decoded = decodeQueryRunSnapshotRecord(record as never);
  if (decoded.status !== 'decoded') return null;
  return decoded.value.run.executionState?.sessionGeneration ?? null;
}

function decodeWorkCandidates(records: readonly { refKey: string; json: string; schemaId: string; revision: number | null }[]): WorkCandidate[] {
  const result: WorkCandidate[] = [];
  for (const record of records) {
    const decoded = decodeDispatchOutboxEntry(record as never);
    if (decoded.status !== 'decoded') continue;
    const claim = decoded.value.claim;
    result.push({ claim, sessionRef: claim.sessionRef });
  }
  return result;
}

function decodeQueryCandidates(records: readonly { refKey: string; json: string; schemaId: string; revision: number | null }[]): QueryCandidate[] {
  const result: QueryCandidate[] = [];
  for (const record of records) {
    const decoded = decodeQueryRunSnapshotRecord(record as never);
    if (decoded.status !== 'decoded') continue;
    const state = decoded.value.run.executionState;
    if (state === undefined) continue;
    result.push({ snapshot: decoded.value, sessionRef: state.sessionRef, generation: state.sessionGeneration });
  }
  return result;
}

function mergeCandidates(work: readonly WorkCandidate[], query: readonly QueryCandidate[]): LineExecutionItemV1[] {
  const merged: LineExecutionItemV1[] = [];
  let wi = 0;
  let qi = 0;
  while (wi < work.length || qi < query.length) {
    const w = work[wi];
    const q = query[qi];
    const takeWork = q === undefined || (w !== undefined && w.claim.generation <= q.generation);
    if (takeWork && w !== undefined) {
      merged.push({ kind: 'execution', session: w.sessionRef, generation: w.claim.generation,
        runRef: w.claim.runRef, revision: 0, task: w.claim.task, startedAt: null, status: 'ended', outcome: null, checks: [] });
      wi += 1;
    } else if (q !== undefined) {
      merged.push({ kind: 'query', session: q.sessionRef, generation: q.generation,
        queryRunRef: q.snapshot.ref, revision: q.snapshot.revision, startedAt: q.snapshot.run.startedAt,
        phase: q.snapshot.run.executionState?.phase ?? 'unknown', outcome: q.snapshot.run.outcome });
      qi += 1;
    } else break;
  }
  return merged;
}

async function readExecutionChecks(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  task: TaskTriple,
  runRef: RunRef,
  cursors: (CommitCursor | null)[],
): Promise<{ roundRef: VerificationRoundRef; revision: number; at: string | null; status: string }[] | null> {
  const checks: { roundRef: VerificationRoundRef; revision: number; at: string | null; status: string }[] = [];
  const page = await records.lookup({ index: VERIFICATION_ROUND_ORIGINAL_LOOKUP,
    values: [workspace.projectId, workspace.workspaceId, task.goalId, task.taskId, runRef.runId],
    limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
  if (page.status !== 'ready') return null;
  cursors.push(page.value.readThrough);
  const rounds: { round: RoundSnapshot; record: { json: string } }[] = [];
  for (const record of page.value.records) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return null;
    rounds.push({ round: decoded.value, record });
  }
  for (const { round, record } of rounds) {
    let at: string | null = null;
    const origin = decodeNoticeOrigin(record as never);
    if (origin.status === 'decoded' && origin.value.since !== undefined && origin.value.since !== null) {
      const event = await records.eventAt(origin.value.since);
      if (event.status !== 'ready') return null;
      at = event.value.event.occurredAt;
    }
    checks.push({ roundRef: round.ref, revision: round.revision, at, status: round.status });
  }
  return checks;
}

function executionsNextCursor(
  key: string,
  chain: string[],
  segment: number,
  after: number | null,
  seen: ExecutionsSeen[],
): string | null {
  if (segment >= chain.length) return null;
  return encodePageCursor({ section: 'executions', key, chain, segment, after, seen });
}

async function readExecutionsSection(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  key: SessionRef,
  limit: number,
  cursorRaw: string | undefined,
): Promise<ReadResult<WorkLineSectionPageV1>> {
  const resolved = await resolveLine(records, workspace, key);
  if (resolved.status !== 'ready') return resolved;
  const head = resolved.value.head;
  const sessionsOldest = [...resolved.value.sessions].reverse();
  const chainKeys = sessionsOldest.map((session) => plainSessionKey(sessionRefOf(session)));
  // L12: the executions cursor binds the resolved line HEAD, not the caller's key
  // (which may be a predecessor, review item 15).
  const keyStr = plainSessionKey(sessionRefOf(head));

  let startSegment = 0;
  let afterGeneration: number | null = null;
  let seen: ExecutionsSeen[] = [];
  if (cursorRaw !== undefined) {
    const cursor = decodePageCursor(cursorRaw);
    if (cursor === null || cursor['section'] !== 'executions') {
      return invalidPage('the executions cursor is not readable');
    }
    // L12: the chain changed (a new head appeared) answers `source_stale` before
    // the head-key comparison, so a stale cursor is never misreported as invalid.
    const chain = cursor['chain'];
    if (!Array.isArray(chain) || !sameSessionChain(chain, chainKeys)) {
      return stalePage('the line chain changed since the cursor was issued');
    }
    if (cursor['key'] !== keyStr) return invalidPage('the executions cursor is not readable');
    const segment = cursor['segment'];
    if (!Number.isSafeInteger(segment) || (segment as number) < 0 || (segment as number) > sessionsOldest.length) {
      return invalidPage('the executions cursor segment is out of range');
    }
    startSegment = segment as number;
    afterGeneration = typeof cursor['after'] === 'number' ? cursor['after'] : null;
    seen = Array.isArray(cursor['seen'])
      ? (cursor['seen'] as unknown[]).filter((entry): entry is ExecutionsSeen =>
        typeof entry === 'object' && entry !== null
        && Number.isSafeInteger((entry as ExecutionsSeen).work) && Number.isSafeInteger((entry as ExecutionsSeen).query))
        .map((entry) => ({ work: entry.work, query: entry.query }))
      : [];
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    // L11/L12 (review item 8): re-resolve the line from the caller's key on every
    // attempt. A retry that reused the original head would miss a head created
    // mid-page; the fresh head/chain reads enter the same-instant check too.
    const lineNow = await resolveLine(records, workspace, key);
    if (lineNow.status !== 'ready') return lineNow;
    const headNow = lineNow.value.head;
    const chainNow = [...lineNow.value.sessions].reverse();
    if (plainSessionKey(sessionRefOf(headNow)) !== keyStr
      || !sameSessionChain(chainNow.map((session) => plainSessionKey(sessionRefOf(session))), chainKeys)) {
      return stalePage('the line chain changed since the cursor was issued');
    }
    const cursors: (CommitCursor | null)[] = [...lineNow.value.cursors];
    const items: LineExecutionItemV1[] = [];
    const seenNow: ExecutionsSeen[] = seen.map((entry) => ({ work: entry.work, query: entry.query }));
    let index = startSegment;
    let after = afterGeneration;

    // L12: recheck every already-walked segment for a newer generation.
    for (let at = 0; at < startSegment; at += 1) {
      const sessionId = chainNow[at]!.ref.sessionId;
      const mark = seenNow[at] ?? { work: 0, query: 0 };
      const workTop = await records.lookupOrdered({ index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'desc', limit: 1 });
      if (workTop.status !== 'ready') return rejectionOf(workTop);
      cursors.push(workTop.value.readThrough);
      const workGeneration = topWorkGeneration(workTop.value.records);
      if (workGeneration !== null && workGeneration > mark.work) {
        return stalePage('a walked segment gained a newer Work execution');
      }
      const queryTop = await records.lookupOrdered({ index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'desc', limit: 1 });
      if (queryTop.status !== 'ready') return rejectionOf(queryTop);
      cursors.push(queryTop.value.readThrough);
      const queryGeneration = topQueryGeneration(queryTop.value.records);
      if (queryGeneration !== null && queryGeneration > mark.query) {
        return stalePage('a walked segment gained a newer Query');
      }
    }

    const markExhausted = async (sessionId: string, atIndex: number): Promise<CoreRejection | null> => {
      // The segment is drained; record the true max generation for the later-page recheck.
      const workTop = await records.lookupOrdered({ index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'desc', limit: 1 });
      if (workTop.status !== 'ready') return rejectionOf(workTop);
      cursors.push(workTop.value.readThrough);
      const queryTop = await records.lookupOrdered({ index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'desc', limit: 1 });
      if (queryTop.status !== 'ready') return rejectionOf(queryTop);
      cursors.push(queryTop.value.readThrough);
      seenNow[atIndex] = { work: topWorkGeneration(workTop.value.records) ?? 0,
        query: topQueryGeneration(queryTop.value.records) ?? 0 };
      return null;
    };

    while (items.length < limit && index < chainNow.length) {
      const session = chainNow[index]!;
      const sessionId = session.ref.sessionId;
      const remaining = limit - items.length;
      const bound = after === null ? {} : { bound: { value: after, inclusive: false } };
      const workPage = await records.lookupOrdered({ index: S2C_WORK_CLAIM_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'asc', limit, ...bound });
      if (workPage.status !== 'ready') return rejectionOf(workPage);
      cursors.push(workPage.value.readThrough);
      const queryPage = await records.lookupOrdered({ index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
        values: [workspace.projectId, workspace.workspaceId, sessionId], direction: 'asc', limit, ...bound });
      if (queryPage.status !== 'ready') return rejectionOf(queryPage);
      cursors.push(queryPage.value.readThrough);

      const work = decodeWorkCandidates(workPage.value.records);
      const query = decodeQueryCandidates(queryPage.value.records);
      const merged = mergeCandidates(work, query);
      if (merged.length === 0) {
        const failure = await markExhausted(sessionId, index);
        if (failure !== null) return failure;
        index += 1;
        after = null;
        continue;
      }

      for (const entry of merged) {
        if (items.length >= limit) break;
        if (entry.kind === 'query') {
          items.push(entry);
          after = entry.generation;
          continue;
        }
        const runKey = refKeyOf(entry.runRef);
        const runRead = await records.readMany([runKey]);
        if (runRead.status !== 'ready') return rejectionOf(runRead);
        cursors.push(runRead.value.readThrough);
        const runRecord = runRead.value.records.find((record) => record.refKey === runKey);
        if (runRecord === undefined) return { status: 'rejected', code: 'unavailable', reason: 'a Work claim Run record is absent' };
        const decodedRun = decodeRun(runRecord);
        if (!decodedRun.ok) return { status: 'rejected', code: 'unavailable', reason: 'a Work claim Run is not decodable' };
        const run = decodedRun.value;
        const checks = await readExecutionChecks(records, workspace, entry.task, run.ref, cursors);
        if (checks === null) return { status: 'rejected', code: 'unavailable', reason: 'a Work execution check round could not be read' };
        items.push({ kind: 'execution', session: entry.session, generation: entry.generation, runRef: run.ref,
          revision: run.revision, task: run.task, startedAt: run.startedAt, status: run.status, outcome: run.outcome, checks });
        after = entry.generation;
      }

      // The page filled exactly at the end of this segment (both indexes have no
      // more candidates beyond what was read): the next page starts after it.
      if (items.length >= limit && merged.length <= remaining
        && workPage.value.next === null && queryPage.value.next === null) {
        const failure = await markExhausted(sessionId, index);
        if (failure !== null) return failure;
        index += 1;
        after = null;
      }
    }

    const distinct = new Set(cursors.filter((cursor) => cursor !== null).map((cursor) => String(cursor)));
    if (distinct.size <= 1) {
      return {
        status: 'ready',
        // L12 (review item 3b): the returned segments are built from the ACCEPTED
        // attempt's chain, never from the first resolution outside the retries, so
        // a write between attempts can never pair stale segments with fresh items.
        value: { section: 'executions', segments: chainNow.map(toSegment), scope: 'indexed', items,
          nextCursor: executionsNextCursor(keyStr, chainKeys, index, after, seenNow.slice(0, index)),
          sourceCursor: cursors[0] ?? lineNow.value.headCursor ?? ('c0000000000' as CommitCursor) },
      };
    }
  }
  return { status: 'rejected', code: 'unavailable',
    reason: 'source_moving: the executions page could not be read at one instant' };
}

// --- L17 messages ----------------------------------------------------------- //

async function readMessagesSection(
  deps: WorkLineReaderDeps,
  ctx: CoreCallContext,
  workspace: WorkspaceScope,
  key: SessionRef,
  limit: number,
  cursorRaw: string | undefined,
): Promise<ReadResult<WorkLineSectionPageV1>> {
  const resolved = await resolveLine(deps.records, workspace, key);
  if (resolved.status !== 'ready') return resolved;
  const sessionsOldest = [...resolved.value.sessions].reverse();
  const chainKeys = sessionsOldest.map((session) => plainSessionKey(sessionRefOf(session)));
  const keyStr = plainSessionKey({ projectId: key.projectId, sessionId: key.sessionId });

  const undelivered = new Set<string>();
  if (resolved.value.head.health === 'unavailable') {
    const reader = deps.undeliveredRepliesFor(deps.records);
    // Rule 3/§3.11: `undelivered` is only knowable when every page read; a
    // missing reader or a failed page must never leave it silently false.
    if (reader === undefined) {
      return { status: 'rejected', code: 'unavailable',
        reason: 'the undelivered-reply reader is not injected (L1b)' };
    }
    let cursor: string | undefined;
    for (;;) {
      const read = await reader(ctx, { sessionRef: sessionRefOf(resolved.value.head),
        page: cursor === undefined ? { limit: 100 } : { limit: 100, cursor } });
      if (read.status !== 'ready') {
        return read.status === 'rejected'
          ? rejectionOf(read)
          : { status: 'rejected', code: 'unavailable',
              reason: 'the undelivered replies are not readable at the required watermark' };
      }
      for (const item of read.value.items) undelivered.add(sessionMessageRefKey(item.messageRef));
      if (read.value.nextCursor === null) break;
      cursor = read.value.nextCursor;
    }
  }

  let sessionIndex = 0;
  let after: string | undefined;
  // Review item 11: an empty section's lookup returns no records and therefore a
  // null `readThrough`; fall back to the head's real watermark, never a zero.
  let sourceCursor: CommitCursor | null = resolved.value.readThrough ?? resolved.value.headCursor;
  if (cursorRaw !== undefined) {
    const cursor = decodePageCursor(cursorRaw);
    if (cursor === null || cursor['section'] !== 'messages' || cursor['key'] !== keyStr) {
      return invalidPage('the messages cursor is not readable');
    }
    const chain = cursor['chain'];
    if (!Array.isArray(chain) || !sameSessionChain(chain, chainKeys)) {
      return stalePage('the line chain changed since the cursor was issued');
    }
    const session = cursor['session'];
    if (!Number.isSafeInteger(session) || (session as number) < 0 || (session as number) > sessionsOldest.length) {
      return invalidPage('the messages cursor session is out of range');
    }
    sessionIndex = session as number;
    after = typeof cursor['after'] === 'string' ? cursor['after'] : undefined;
  }

  const items: LineMessageStateV1[] = [];
  let next: string | null = null;
  while (sessionIndex < sessionsOldest.length && items.length < limit) {
    const session = sessionsOldest[sessionIndex]!;
    const page = await deps.records.lookup({ index: SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, session.ref.sessionId], limit: limit - items.length,
      ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') return rejectionOf(page);
    sourceCursor = page.value.readThrough ?? sourceCursor;
    for (const record of page.value.records) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') continue;
      const message = decoded.value;
      const accepted = (message.acceptedInputs ?? []).find((entry) => entry.part === 'message');
      const deliveredTo = accepted === undefined ? null
        : { executionRef: accepted.executionRef as RunRef | QueryRunRef, acceptedAt: accepted.acceptedAt };
      items.push({
        messageRef: message.ref,
        revision: message.revision,
        createdAt: message.createdAt,
        delivery: accepted === undefined ? 'queued' : 'delivered',
        deliveredTo,
        read: message.status !== 'pending',
        responded: message.response !== null,
        replyHandler: message.replyHandler?.sessionRef ?? null,
        waitDisposition: message.archiveWaitDisposition?.kind ?? null,
        undelivered: undelivered.has(sessionMessageRefKey(message.ref)),
        // NotYetV1 is the intended DTO field type (L17; slice 7 supplies the disposition).
        disposition: { availability: 'not_available', reason: 'slice_7' as const } satisfies NotYetV1,
      });
    }
    if (page.value.next !== null) {
      after = page.value.next;
      next = encodePageCursor({ section: 'messages', key: keyStr, chain: chainKeys, session: sessionIndex, after });
      break;
    }
    sessionIndex += 1;
    after = undefined;
  }
  if (next === null && sessionIndex < sessionsOldest.length) {
    next = encodePageCursor({ section: 'messages', key: keyStr, chain: chainKeys, session: sessionIndex });
  }
  return { status: 'ready', value: { section: 'messages', items, nextCursor: next,
    sourceCursor: sourceCursor ?? ('c0000000000' as CommitCursor) } };
}

// --- participation (all SessionWorkLinks of the chain) --------------------- //

async function readParticipationSection(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  key: SessionRef,
  limit: number,
  cursorRaw: string | undefined,
): Promise<ReadResult<WorkLineSectionPageV1>> {
  const resolved = await resolveLine(records, workspace, key);
  if (resolved.status !== 'ready') return resolved;
  const sessionsOldest = [...resolved.value.sessions].reverse();
  const chainKeys = sessionsOldest.map((session) => plainSessionKey(sessionRefOf(session)));
  const keyStr = plainSessionKey({ projectId: key.projectId, sessionId: key.sessionId });

  let sessionIndex = 0;
  let after: string | undefined;
  // Review item 11: an empty section's lookup returns no records and therefore a
  // null `readThrough`; fall back to the head's real watermark, never a zero.
  let sourceCursor: CommitCursor | null = resolved.value.readThrough ?? resolved.value.headCursor;
  if (cursorRaw !== undefined) {
    const cursor = decodePageCursor(cursorRaw);
    if (cursor === null || cursor['section'] !== 'participation' || cursor['key'] !== keyStr) {
      return invalidPage('the participation cursor is not readable');
    }
    const chain = cursor['chain'];
    if (!Array.isArray(chain) || !sameSessionChain(chain, chainKeys)) {
      return stalePage('the line chain changed since the cursor was issued');
    }
    const session = cursor['session'];
    if (!Number.isSafeInteger(session) || (session as number) < 0 || (session as number) > sessionsOldest.length) {
      return invalidPage('the participation cursor session is out of range');
    }
    sessionIndex = session as number;
    after = typeof cursor['after'] === 'string' ? cursor['after'] : undefined;
  }

  const items: LineParticipationV1[] = [];
  let next: string | null = null;
  while (sessionIndex < sessionsOldest.length && items.length < limit) {
    const session = sessionsOldest[sessionIndex]!;
    const page = await records.lookup({ index: SESSION_WORK_LINKS_LOOKUP,
      values: [workspace.projectId, session.ref.sessionId], limit: limit - items.length,
      ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') return rejectionOf(page);
    sourceCursor = page.value.readThrough ?? sourceCursor;
    for (const record of page.value.records) {
      const link = decodeLink(record);
      if (link === null) continue;
      items.push({ target: link.ref.target, relation: link.ref.relation, session: sessionRefOf(session),
        since: link.since ?? null, until: link.until ?? null });
    }
    if (page.value.next !== null) {
      after = page.value.next;
      next = encodePageCursor({ section: 'participation', key: keyStr, chain: chainKeys, session: sessionIndex, after });
      break;
    }
    sessionIndex += 1;
    after = undefined;
  }
  if (next === null && sessionIndex < sessionsOldest.length) {
    next = encodePageCursor({ section: 'participation', key: keyStr, chain: chainKeys, session: sessionIndex });
  }
  return { status: 'ready', value: { section: 'participation', items, nextCursor: next,
    sourceCursor: sourceCursor ?? ('c0000000000' as CommitCursor) } };
}

// --- copies (all readonly copies of the chain) ----------------------------- //

async function readCopiesSection(
  records: WorkLineStore,
  workspace: WorkspaceScope,
  key: SessionRef,
  limit: number,
  cursorRaw: string | undefined,
): Promise<ReadResult<WorkLineSectionPageV1>> {
  const resolved = await resolveLine(records, workspace, key);
  if (resolved.status !== 'ready') return resolved;
  const sessionsOldest = [...resolved.value.sessions].reverse();
  const chainKeys = sessionsOldest.map((session) => plainSessionKey(sessionRefOf(session)));
  const keyStr = plainSessionKey({ projectId: key.projectId, sessionId: key.sessionId });
  const state: LineReadState = { problem: null };

  let sessionIndex = 0;
  let after: string | undefined;
  // Review item 11: an empty section's lookup returns no records and therefore a
  // null `readThrough`; fall back to the head's real watermark, never a zero.
  let sourceCursor: CommitCursor | null = resolved.value.readThrough ?? resolved.value.headCursor;
  if (cursorRaw !== undefined) {
    const cursor = decodePageCursor(cursorRaw);
    if (cursor === null || cursor['section'] !== 'copies' || cursor['key'] !== keyStr) {
      return invalidPage('the copies cursor is not readable');
    }
    const chain = cursor['chain'];
    if (!Array.isArray(chain) || !sameSessionChain(chain, chainKeys)) {
      return stalePage('the line chain changed since the cursor was issued');
    }
    const session = cursor['session'];
    if (!Number.isSafeInteger(session) || (session as number) < 0 || (session as number) > sessionsOldest.length) {
      return invalidPage('the copies cursor session is out of range');
    }
    sessionIndex = session as number;
    after = typeof cursor['after'] === 'string' ? cursor['after'] : undefined;
  }

  const items: { copy: SessionRef; messageRef: SessionMessageRef; lifecycle: 'active' | 'archived';
    phase: QueryExecutionStateV1['phase'] | null }[] = [];
  let next: string | null = null;
  while (sessionIndex < sessionsOldest.length && items.length < limit) {
    const session = sessionsOldest[sessionIndex]!;
    const page = await records.lookup({ index: S2C_SESSION_BY_KIND_FROM_LOOKUP,
      values: [workspace.projectId, workspace.workspaceId, 'readonly_copy', session.ref.sessionId],
      limit: limit - items.length, ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') return rejectionOf(page);
    sourceCursor = page.value.readThrough ?? sourceCursor;
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') continue;
      const copy = decoded.value;
      const provenance = copy.provenance;
      if (provenance.kind !== 'readonly_copy') continue;
      items.push({ copy: sessionRefOf(copy), messageRef: provenance.messageRef, lifecycle: copy.lifecycle,
        phase: (await copyPhase(records, workspace, copy, state)).phase });
    }
    if (page.value.next !== null) {
      after = page.value.next;
      next = encodePageCursor({ section: 'copies', key: keyStr, chain: chainKeys, session: sessionIndex, after });
      break;
    }
    sessionIndex += 1;
    after = undefined;
  }
  if (next === null && sessionIndex < sessionsOldest.length) {
    next = encodePageCursor({ section: 'copies', key: keyStr, chain: chainKeys, session: sessionIndex });
  }
  return { status: 'ready', value: { section: 'copies', items, nextCursor: next,
    sourceCursor: sourceCursor ?? ('c0000000000' as CommitCursor) } };
}

export function createWorkLineReader(deps: WorkLineReaderDeps): WorkLineReadPort {
  return {
    async listWorkLines(ctx, input): Promise<ReadResult<WorkLineListV1>> {
      const windowResult = await listActiveHeads(deps.records, input.workspace);
      if (windowResult.status !== 'ready') return windowResult;
      const window = windowResult.value;
      const assembled = await assembleLineRows(deps, ctx, input.workspace,
        window.heads.map((session) => ({ projectId: session.ref.projectId, sessionId: session.ref.sessionId })),
        'sort-key', indexActiveCopies(window.sessions));
      if (assembled.status !== 'ready') return assembled;
      const rows = assembled.value.rows;
      const attentionProblem = assembled.value.attentionProblem;
      const broken = rows.filter((row) => row.problem !== null).length;
      const workingRows = rows.filter((row) => row.status.bucket === 'working').length;
      const standbyRows = rows.filter((row) => row.status.bucket === 'standby').length;
      const working: LineCountV1 = broken === 0 ? { status: 'exact', value: workingRows }
        : { status: 'partial', atLeast: workingRows, reason: `${String(broken)} row(s) could not be read` };
      const standby: LineCountV1 = broken === 0 ? { status: 'exact', value: standbyRows }
        : { status: 'partial', atLeast: standbyRows, reason: `${String(broken)} row(s) could not be read` };
      const archived = await countArchived(deps.records, input.workspace, window.from, window.withSuccessor);
      const from = window.from ?? ('c0000000000' as CommitCursor);
      // L11 (review item 8): the read window ends at the LAST read of this list
      // (the archived formula's final count), not only at the active enumeration.
      const to = archived.archived.asOf ?? window.to ?? from;
      return {
        status: 'ready',
        value: {
          rows,
          counts: { working, standby, archived: archived.archived },
          legacyUnchecked: assembled.value.legacyUnchecked,
          attentionComplete: rows.every((row) => row.status.attentionComplete),
          attentionProblem,
          readWindow: { from, to },
        },
      };
    },
    async listArchivedLines(ctx, input): Promise<ReadResult<import('../../../contracts/work-line.js').ArchivedLinePageV1>> {
      const limit = input.page.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return { status: 'rejected', code: 'invalid', reason: 'page.limit must be an integer between 1 and 100' };
      }
      const windowResult = await readArchivedPage(deps.records, input.workspace, limit, input.page.cursor);
      if (windowResult.status !== 'ready') return windowResult;
      const window = windowResult.value;
      // L5: `readArchivedPage` already returns the heads in archive-time
      // descending index order; keep that order instead of re-sorting by the
      // L10 `sortKey`, and paging stays bound to the index's own cursor.
      const assembled = await assembleLineRows(deps, ctx, input.workspace,
        window.heads.map((session) => ({ projectId: session.ref.projectId, sessionId: session.ref.sessionId })),
        'given');
      if (assembled.status !== 'ready') return assembled;
      const withoutArchivedAt = await countWithoutArchivedAt(deps.records, input.workspace);
      return { status: 'ready', value: { rows: assembled.value.rows, nextCursor: window.nextCursor,
        sourceCursor: window.sourceCursor, withoutArchivedAt } };
    },
    async readWorkLine(_ctx, input): Promise<ReadResult<WorkLineDetailV1 | { kind: 'branched'; heads: SessionRef[] }>> {
      const resolved = await resolveContinuationLine(deps.records, input.workspace, input.key);
      if (resolved.status !== 'ready') return resolved;
      // N3: a branch names the heads explicitly instead of collapsing to
      // not_found. N9: a provenance cycle is corrupt data; the min-refKey
      // representative is assembled as the line and its chain walk reports
      // `problem: invalid`, instead of returning a `branched` subset (review item 1).
      if (resolved.value.kind === 'branched') {
        return { status: 'ready', value: { kind: 'branched', heads: resolved.value.heads } };
      }
      const headRef = resolved.value.kind === 'head'
        ? resolved.value.head : cycleRepresentativeOf(resolved.value.members);
      const headCursor: { cursor: CommitCursor | null } = { cursor: null };
      const headResult = await readSession(deps.records, input.workspace, headRef, headCursor);
      if (headResult.status !== 'ready') return headResult;
      const head = headResult.value;
      if (head === null) return { status: 'not_found' };
      const key: SessionRef = { projectId: head.ref.projectId, sessionId: head.ref.sessionId };
      const assembled = await assembleLineRows(deps, _ctx, input.workspace, [key]);
      if (assembled.status !== 'ready') return assembled;
      const row = assembled.value.rows[0];
      if (row === undefined) return { status: 'not_found' };
      const facts = assembled.value.facts.get(canonicalJson(key as unknown as JsonValue));
      const chain = await readChain(deps.records, input.workspace, head, { problem: null });
      const gateChecks = await readGateChecks(deps, _ctx, input.workspace, row);
      return {
        status: 'ready',
        value: {
          kind: 'line',
          row,
          // The assembled chain keeps each Session's `responsibleOpen` (E1); the
          // extra `readChain` only supplies the real source watermark.
          chain: facts?.chain ?? chain.chain,
          omitted: facts?.omitted ?? chain.omitted,
          attentionAll: facts === undefined ? [] : deriveAttentionAll(facts),
          responsibility: row.responsibleNow.length > 0 ? 'has_responsibility' : 'none',
          gateChecks,
          sourceCursor: chain.readThrough ?? headCursor.cursor ?? ('c0000000000' as CommitCursor),
        },
      };
    },
    async readWorkLinePage(ctx, input): Promise<ReadResult<WorkLineSectionPageV1>> {
      const limit = input.page.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return { status: 'rejected', code: 'invalid', reason: 'page.limit must be an integer between 1 and 100' };
      }
      switch (input.section) {
        case 'executions':
          return readExecutionsSection(deps.records, input.workspace, input.key, limit, input.page.cursor);
        case 'messages':
          return readMessagesSection(deps, ctx, input.workspace, input.key, limit, input.page.cursor);
        case 'participation':
          return readParticipationSection(deps.records, input.workspace, input.key, limit, input.page.cursor);
        case 'copies':
          return readCopiesSection(deps.records, input.workspace, input.key, limit, input.page.cursor);
        default:
          return { status: 'rejected', code: 'invalid', reason: `unknown line page section ${String(input.section)}` };
      }
    },
    async readWorkLineConversationSource(_ctx, input): Promise<ReadResult<LineConversationSourceV1>> {
      return readWorkLineConversationSource(deps.records, input.workspace, input.key);
    },
  };
}

// Keep the unused import from being dropped by the type-checker's view of the module.
export type { CoreRejection, PlanRevisionRef };
