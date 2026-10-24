/**
 * Picking a secretary (`SecretaryCandidateFactsV1` /
 * `SecretarySelectionFactsV1`).
 *
 * `readSecretarySelectionFacts` returns the workspace's ADMISSIBLE secretary
 * Sessions with their picking facts. `admitRequestSecretary` is the one
 * admission check a request's secretary passes: the caller's scope, lifecycle
 * `active` and health `available` (the shared occupancy availability rule), the
 * Query dispatch admission (the same check the Query claim runs), duty
 * `secretary` (the injected real resolver), and a Host secretary profile. A
 * held occupancy does not exclude a Session; it makes it busy.
 *
 * Per candidate: `busy` (occupancy, owner of a request with a pending round, or
 * a live attempt), `ranGoal` (`s6-query-ran-by-session-goal`), the newest
 * measured model input (`s2c-query-run-by-session-generation`), `tooLong`, and
 * the line clock (`latestActivityAt` with the same instants the line reader
 * gathers). The owner rule is the frozen `readRequestRounds`; this file never
 * re-implements it. The facts carry a `guards` entry for every candidate
 * Session and every open request read, and their watermark.
 *
 * Every read failure is `unavailable`: a Session, copy, usage or open-round read
 * that fails never becomes "admissible", "no usage" or "not busy".
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { QueryJobSnapshot } from '../../../contracts/query-job.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey as keyOf, canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { SessionFactsPort, SessionWorkWaitV1 } from '../model/session-facts-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import {
  LIVE_ATTEMPT_PHASES, QUERY_OPEN_BY_WORKSPACE_INDEX, QUERY_RAN_BY_SESSION_GOAL_INDEX, REQUEST_PAGE_SIZE,
  SECRETARY_HANDOFF_INPUT_TOKENS,
  type SecretaryProfilePort, type SecretaryProfileV1, type SecretaryScopePort,
} from '../model/request-contracts.js';
import type { SecretaryCandidateFactsV1, SecretarySelectionFactsV1 } from '../model/request-contracts.js';

import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import {
  decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord, S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
} from '../queries/query-record-codecs.js';
import { readRequestRounds, type RequestRoundsStore } from '../queries/request-rounds-read.js';
import {
  copyPhase, latestActivityAt, readActiveCopies, readClaimedAtForRun, readQueryRunByRef,
  type ActiveCopies, type LineClockFailure,
} from './line-clock.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { laterCursor } from './plan-readers.js';
import {
  SESSION_BY_WORKSPACE_LOOKUP, decodeSessionRecord, plainSessionRefKey, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  sessionAvailabilityAdmissionProblem, sessionDispatchAdmissionProblem,
} from '../state/session-availability.js';

export type { SecretaryCandidateFactsV1, SecretarySelectionFactsV1 };

/** The store surface the selection read needs (the complete request read included). */
export type SecretarySelectionStore =
  Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & RecordOrderedLookupPort
  & Pick<RequestRoundsStore, 'eventAt'>;

/** The ports the composition root injects. */
export type SecretarySelectionDependencies = {
  records: SecretarySelectionStore;
  /** The trusted `readSessionFacts` port (the work-wait fact and the canonical record). */
  sessionFacts: SessionFactsPort;
  /** `A/secretary-profiles.ts` in production; a test builds one over the Host's published profiles. */
  profiles: SecretaryProfilePort;
  /** Each secretary's scope; the project-scope adapter answers `project` for every one. */
  scope: SecretaryScopePort;
  /** The real `SessionDutyResolver` (composition/session-duty.ts). */
  duty: SessionDutyReadPort;
};

export interface SecretarySelectionPort {
  /** The §3.12 function: only admissible workspace Sessions with a profile. */
  readSecretarySelectionFacts(
    ctx: CoreCallContext,
    input: { scope: WorkspaceScope; goalId: string | null; exclude: SessionRef[] },
  ): Promise<ReadResult<SecretarySelectionFactsV1>>;
}

// ------------------------------------------------------------------------ //
// The project-scope adapter                                                 //
// ------------------------------------------------------------------------ //

/** The project-scope adapter (spec §7): every secretary is project-scoped. */
export function createProjectSecretaryScope(): SecretaryScopePort {
  return {
    async scopeOf() {
      return { status: 'ready', value: { kind: 'project' } };
    },
  };
}

// ------------------------------------------------------------------------ //
// Pure helpers                                                              //
// ------------------------------------------------------------------------ //

function unavailable(reason: string): { status: 'rejected'; code: 'unavailable'; reason: string } {
  return { status: 'rejected', code: 'unavailable', reason };
}

/** First-wins append for read windows: it must keep the copy behaviour and is not the mergeGuards submit-time merger. */
function appendGuardCopyFirstWins(guards: RecordGuard[], guard: RecordGuard): void {
  if (!guards.some((existing) => existing.refKey === guard.refKey)) guards.push({ ...guard });
}

/**
 * Filter, then order: project scope always, a goal scope only when
 * it covers the request's goal (a no-goal request takes project scope only);
 * then idle and not too long; then spec L4's four keys.
 */
export function orderCandidates(
  facts: SecretarySelectionFactsV1,
  input: { goalId: string | null },
): SecretaryCandidateFactsV1[] {
  const eligible = facts.candidates.filter((candidate) => {
    if (candidate.scope.kind === 'project') return true;
    return input.goalId !== null && candidate.scope.goalId === input.goalId;
  }).filter((candidate) => !candidate.busy && !candidate.tooLong);
  return eligible.sort(compareCandidates);
}

function compareCandidates(left: SecretaryCandidateFactsV1, right: SecretaryCandidateFactsV1): number {
  // (1) ran this goal first.
  if (left.ranGoal !== right.ranGoal) return left.ranGoal ? -1 : 1;
  // (2) a known measured input before no usage.
  const leftKnown = left.lastInputTokens !== null;
  const rightKnown = right.lastInputTokens !== null;
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  // (3) later activity first.
  if (left.lastActivityAt !== right.lastActivityAt) return left.lastActivityAt > right.lastActivityAt ? -1 : 1;
  // (4) canonical Session key ascending.
  return plainSessionRefKey(left.session).localeCompare(plainSessionRefKey(right.session));
}

// ------------------------------------------------------------------------ //
// The one secretary admission check                                         //
// ------------------------------------------------------------------------ //

/** The ports the admission check reads through (the caller's own instances). */
export type RequestSecretaryAdmissionDependencies = {
  /** The trusted Session facts read: the canonical record and its Work wait. */
  sessionFacts: Pick<SessionFactsPort, 'readSessionFacts'>;
  /** The real `SessionDutyResolver` (`composition/session-duty.ts`). */
  duty: SessionDutyReadPort;
  /** `forSession` over the caller's published secretary profiles. */
  profiles: Pick<SecretaryProfilePort, 'forSession'>;
};

/** Admitted facts, or a rule refusal the caller answers as it must (`busy`, `unavailable`). */
export type RequestSecretaryAdmissionV1 =
  | {
    status: 'admitted';
    session: SessionRecord;
    wait: SessionWorkWaitV1 | null;
    profile: SecretaryProfileV1;
    /** The Session record guard this read carries. */
    guards: RecordGuard[];
  }
  | {
    status: 'refused'; code: CoreError; reason: string;
    /**
     * The revision of the Session the refusal judged; null when it was refused
     * before its record was read. A caller holding an older revision of the
     * Session sees that the Session changed, not only that it is refused now.
     */
    revision: number | null;
  };

/**
 * May this Session receive a request round for this caller?
 * The caller's project, the shared occupancy availability rule,
 * the Query dispatch admission (no pending archive, not a read-only copy, no
 * Work wait), duty `secretary` through the resolver, and a `forSession`
 * profile. Occupancy is not a refusal here; it only makes the Session busy.
 * A rule refusal is a ready `refused`; a missing or unreadable Session is
 * `unavailable`, and the caller never turns it into a candidate.
 * The workspace is checked once, by the Session facts read: it is bound to the
 * call's workspace and answers a Session of another workspace as not found, so
 * such a Session is `unavailable` here.
 */
export async function admitRequestSecretary(
  deps: RequestSecretaryAdmissionDependencies,
  ctx: CoreCallContext,
  input: { caller: WorkspaceScope; session: SessionRef },
): Promise<ReadResult<RequestSecretaryAdmissionV1>> {
  const caller = input?.caller;
  const target = input?.session;
  if (caller === null || caller === undefined || !caller.projectId || !caller.workspaceId
    || target === null || target === undefined || !target.projectId || !target.sessionId) {
    return unavailable('a request secretary check needs the caller workspace and a complete SessionRef');
  }
  if (target.projectId !== caller.projectId) {
    return { status: 'ready', value: { status: 'refused', code: 'forbidden',
      reason: 'the target Session belongs to another project', revision: null } };
  }
  let facts: Awaited<ReturnType<SessionFactsPort['readSessionFacts']>>;
  try {
    facts = await deps.sessionFacts.readSessionFacts(ctx, target);
  } catch (error) {
    return unavailable(`the target Session facts could not be read: ${messageOf(error)}`);
  }
  if (facts.status === 'not_found') return unavailable('the target Session does not exist');
  if (facts.status === 'not_ready') return unavailable('the target Session facts are not ready');
  if (facts.status === 'rejected') {
    return unavailable(`the target Session facts could not be read: ${facts.code}: ${facts.reason}`);
  }
  const session = facts.value.session;
  const revision = session.revision;
  const availability = sessionAvailabilityAdmissionProblem(session);
  if (availability !== null && !availability.ok) {
    return { status: 'ready', value: { status: 'refused', code: availability.code, reason: availability.detail, revision } };
  }
  const dispatch = sessionDispatchAdmissionProblem(session, {
    purpose: 'query', waiting: facts.value.wait, consumedWait: null, readonlyQueryMatches: false,
  });
  if (dispatch !== null && !dispatch.ok) {
    return { status: 'ready', value: { status: 'refused', code: dispatch.code, reason: dispatch.detail, revision } };
  }
  let duty: Awaited<ReturnType<SessionDutyReadPort>>;
  try {
    duty = await deps.duty(session.role, ctx);
  } catch (error) {
    return unavailable(`the target Session duty could not be resolved: ${messageOf(error)}`);
  }
  if (duty.status !== 'ready') {
    return unavailable(`the target Session duty could not be resolved: ${duty.status === 'rejected' ? duty.reason : duty.status}`);
  }
  if (duty.value !== 'secretary') {
    return { status: 'ready', value: { status: 'refused', code: 'forbidden',
      reason: 'the target Session duty is not secretary', revision } };
  }
  let profile: SecretaryProfileV1 | null;
  try {
    profile = deps.profiles.forSession({ workspace: caller, sessionRole: session.role });
  } catch (error) {
    return unavailable(`the target Session profile could not be read: ${messageOf(error)}`);
  }
  if (profile === null) {
    return { status: 'ready', value: { status: 'refused', code: 'forbidden', reason: 'no_secretary_binding', revision } };
  }
  return { status: 'ready', value: {
    status: 'admitted', session, wait: facts.value.wait, profile,
    guards: [{ refKey: sessionAggregateRefKey(session.ref), expectedRevision: session.revision }],
  } };
}

// ------------------------------------------------------------------------ //
// The complete workspace reads                                              //
// ------------------------------------------------------------------------ //

async function readWorkspaceSessions(
  records: SecretarySelectionStore, scope: WorkspaceScope,
): Promise<ReadResult<{ sessions: SessionRecord[]; watermark: CommitCursor | null }>> {
  const sessions: SessionRecord[] = [];
  let after: string | undefined;
  let watermark: CommitCursor | null = null;
  type LookupResult = Awaited<ReturnType<SecretarySelectionStore['lookup']>>;
  for (;;) {
    let page: LookupResult;
    try {
      page = await records.lookup({ index: SESSION_BY_WORKSPACE_LOOKUP,
        values: [scope.projectId, scope.workspaceId], limit: REQUEST_PAGE_SIZE,
        ...(after === undefined ? {} : { after }) });
    } catch (error) {
      return unavailable(`the workspace Sessions could not be read: ${messageOf(error)}`);
    }
    if (page.status !== 'ready') return unavailable(`the workspace Sessions read failed: ${page.code}: ${page.reason}`);
    watermark = laterCursor(watermark, page.value.readThrough);
    for (const record of page.value.records) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') return unavailable(`a Session record is damaged: ${decoded.reason}`);
      sessions.push(decoded.value);
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { status: 'ready', value: { sessions, watermark } };
}

/**
 * The open request rounds: the complete `pending` and `running` partitions of
 * `s6-query-open-by-workspace`, grouped by request root and read through
 * `readRequestRounds` (the one owner rule).
 */
type OpenRequestFacts = {
  pendingOwners: Set<string>;
  liveAttempts: Set<string>;
  guards: RecordGuard[];
  watermark: CommitCursor | null;
};

async function readOpenRequestFacts(
  records: SecretarySelectionStore, ctx: CoreCallContext, scope: WorkspaceScope,
): Promise<ReadResult<OpenRequestFacts>> {
  const pendingOwners = new Set<string>();
  const liveAttempts = new Set<string>();
  const guards: RecordGuard[] = [];
  let watermark: CommitCursor | null = null;

  const roots = new Map<string, QueryJobSnapshot['job']['requestRoot']>();
  type OrderedAll = Awaited<ReturnType<typeof readAllOrdered>>;
  for (const status of ['pending', 'running'] as const) {
    let read: OrderedAll;
    try {
      read = await readAllOrdered(records, { index: QUERY_OPEN_BY_WORKSPACE_INDEX,
        values: [scope.projectId, scope.workspaceId, 'request', status], direction: 'asc' });
    } catch (error) {
      return unavailable(`the open request rounds could not be read: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`the open request rounds read failed: ${read.code}: ${read.reason}`);
    watermark = laterCursor(watermark, read.value.readThrough);
    for (const record of read.value.records) {
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') return unavailable(`an open request round is damaged: ${decoded.reason}`);
      const root = decoded.value.job.requestRoot;
      // The index's `request` slot derives from the stored Job; a row that says
      // otherwise is not an open request of this workspace.
      if (root === null) return unavailable('the open request index names a non-request QueryJob');
      roots.set(keyOf(root), root);
    }
  }

  for (const root of roots.values()) {
    if (root === null) continue;
    let facts: Awaited<ReturnType<typeof readRequestRounds>>;
    try {
      facts = await readRequestRounds(records, ctx, { requestRoot: root });
    } catch (error) {
      return unavailable(`the request rounds could not be read: ${messageOf(error)}`);
    }
    if (facts.status !== 'ready') {
      return unavailable(facts.status === 'rejected'
        ? `the request rounds read failed: ${facts.reason}`
        : 'an open request round no longer reads as a request root');
    }
    for (const guard of facts.value.guards) appendGuardCopyFirstWins(guards, guard);
    watermark = laterCursor(watermark, facts.value.watermark);

    const covered = new Set(facts.value.coveredByDrop.map((ref) => keyOf(ref)));
    const hasPendingRound = facts.value.rounds.some((round) =>
      round.job.status === 'pending' && !covered.has(keyOf(round.ref)));
    if (hasPendingRound && facts.value.owner !== null) pendingOwners.add(plainSessionRefKey(facts.value.owner));
    for (const run of facts.value.runs) {
      const phase = run.run.executionState?.phase;
      const attempt = run.run.executionState?.sessionRef;
      if (phase !== undefined && attempt !== undefined && LIVE_ATTEMPT_PHASES.has(phase)) {
        liveAttempts.add(plainSessionRefKey(attempt));
      }
    }
  }
  return { status: 'ready', value: { pendingOwners, liveAttempts, guards, watermark } };
}

/**
 * How many model inputs this Session's QueryRuns recorded, newest generation
 * first and inside a run last-to-first until one is non-null; `null` = no usage.
 */
async function readLastInputTokens(
  records: SecretarySelectionStore, scope: WorkspaceScope, session: SessionRef,
): Promise<{ status: 'ready'; value: number | null; watermark: CommitCursor | null } | { status: 'rejected'; reason: string }> {
  type OrderedAll = Awaited<ReturnType<typeof readAllOrdered>>;
  let read: OrderedAll;
  try {
    read = await readAllOrdered(records, { index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
      values: [scope.projectId, scope.workspaceId, session.sessionId], direction: 'desc' });
  } catch (error) {
    return { status: 'rejected', reason: `the Session QueryRuns could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return { status: 'rejected', reason: `the Session QueryRuns read failed: ${read.code}: ${read.reason}` };
  }
  for (const record of read.value.records) {
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', reason: `a Session QueryRun is damaged: ${decoded.reason}` };
    const run = decoded.value;
    if (run.ref.workspaceId !== scope.workspaceId) continue;
    const requests = run.run.executionState?.requests ?? [];
    for (let index = requests.length - 1; index >= 0; index -= 1) {
      const tokens = requests[index]!.inputTokens;
      if (tokens !== null) return { status: 'ready', value: tokens, watermark: read.value.readThrough };
    }
  }
  return { status: 'ready', value: null, watermark: read.value.readThrough };
}

/** Whether any entered round of this Session ran the goal's request (`s6-query-ran-by-session-goal`). */
async function readRanGoal(
  records: SecretarySelectionStore, scope: WorkspaceScope, session: SessionRef, goalId: string | null,
): Promise<{ status: 'ready'; value: boolean; watermark: CommitCursor | null } | { status: 'rejected'; reason: string }> {
  if (goalId === null) return { status: 'ready', value: false, watermark: null };
  const enteredSlot = `s:${canonicalJson(session as unknown as JsonValue)}`;
  type OrderedAll = Awaited<ReturnType<typeof readAllOrdered>>;
  let read: OrderedAll;
  try {
    read = await readAllOrdered(records, { index: QUERY_RAN_BY_SESSION_GOAL_INDEX,
      values: [scope.projectId, scope.workspaceId, enteredSlot, `g:${goalId}`], direction: 'asc' });
  } catch (error) {
    return { status: 'rejected', reason: `the ran-goal index could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return { status: 'rejected', reason: `the ran-goal index read failed: ${read.code}: ${read.reason}` };
  }
  for (const record of read.value.records) {
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', reason: `a ran-goal row is damaged: ${decoded.reason}` };
    const job = decoded.value.job;
    if (job.requestRoot === null || job.enteredSession === null) continue;
    if (job.requestGoalId !== goalId) continue;
    if (plainSessionRefKey(job.enteredSession) !== plainSessionRefKey(session)) continue;
    return { status: 'ready', value: true, watermark: read.value.readThrough };
  }
  return { status: 'ready', value: false, watermark: read.value.readThrough };
}

// ------------------------------------------------------------------------ //
// The line clock's instants for one Session                                 //
// ------------------------------------------------------------------------ //

async function readOccupancyStart(
  records: SecretarySelectionStore, scope: WorkspaceScope, session: SessionRecord, onProblem: (failure: LineClockFailure) => void,
): Promise<string | null> {
  const occupancy = session.occupancy;
  if (occupancy === null || occupancy === undefined || occupancy.kind !== 'execution') return null;
  if (occupancy.executionRef.aggregateType === 'QueryRun') {
    const run = await readQueryRunByRef(records, scope, occupancy.executionRef, onProblem);
    return run?.run.startedAt ?? null;
  }
  const run = await readRunByRef(records, scope, occupancy.executionRef, onProblem);
  return run?.startedAt ?? null;
}

async function readRunByRef(
  records: SecretarySelectionStore, scope: WorkspaceScope, ref: RunRef, onProblem: (failure: LineClockFailure) => void,
): Promise<import('../../../contracts/dispatch.js').RunSnapshot | null> {
  const key = keyOf(ref);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') { onProblem(read); return null; }
  const record = read.value.records.find((entry) => entry.refKey === key);
  if (record === undefined) { onProblem({ code: 'not_found', reason: `the Run record ${key} is absent` }); return null; }
  const decoded = decodeRun(record);
  if (!decoded.ok) { onProblem({ code: 'unavailable', reason: `the Run is not decodable: ${decoded.reason}` }); return null; }
  if (decoded.value.workspaceSnapshot.workspaceId !== scope.workspaceId) return null;
  return decoded.value;
}

async function readActivityInstants(
  records: SecretarySelectionStore, scope: WorkspaceScope, session: SessionRecord, copies: ActiveCopies,
  onProblem: (failure: LineClockFailure) => void,
): Promise<string[]> {
  const instants: (string | null | undefined)[] = [];

  // The last execution record: Run `endedAt ?? startedAt ?? claimedAt`,
  // QueryRun `endedAt ?? startedAt`.
  const last = session.lastExecutionRef;
  if (last !== null && last !== undefined) {
    if (last.aggregateType === 'QueryRun') {
      const run = await readQueryRunByRef(records, scope, last, onProblem);
      if (run !== null) instants.push(run.run.endedAt ?? run.run.startedAt);
    } else {
      const run = await readRunByRef(records, scope, last, onProblem);
      if (run !== null) {
        const claimedAt = run.startedAt === null && run.endedAt === null
          ? await readClaimedAtForRun(records, scope, session, run.ref, onProblem) : null;
        instants.push(run.endedAt ?? run.startedAt ?? claimedAt);
      }
    }
  }

  // The current occupancy holder's start.
  instants.push(await readOccupancyStart(records, scope, session, onProblem));

  // Every active read-only copy whose provenance points at this Session. A copy
  // does not occupy its source, so `busy` alone would miss its activity.
  for (const copy of copies.get(session.ref.sessionId) ?? []) {
    if (copy.provenance.kind !== 'readonly_copy') continue;
    const from = copy.provenance.from;
    if (from.projectId !== session.ref.projectId || from.sessionId !== session.ref.sessionId) continue;
    const info = await copyPhase(records, scope, copy, onProblem);
    instants.push(info.startedAt);
  }
  return instants.filter((instant): instant is string => instant !== null && instant !== undefined);
}

// ------------------------------------------------------------------------ //
// The read                                                                  //
// ------------------------------------------------------------------------ //

export function createSecretarySelection(deps: SecretarySelectionDependencies): SecretarySelectionPort {
  async function readSecretarySelectionFacts(
    ctx: CoreCallContext,
    input: { scope: WorkspaceScope; goalId: string | null; exclude: SessionRef[] },
  ): Promise<ReadResult<SecretarySelectionFactsV1>> {
    const scope = input?.scope;
    if (scope === undefined || scope === null || !scope.projectId || !scope.workspaceId) {
      return unavailable('secretary selection needs the request workspace');
    }
    const sessionRead = await readWorkspaceSessions(deps.records, scope);
    if (sessionRead.status !== 'ready') return sessionRead;
    let watermark: CommitCursor | null = sessionRead.value.watermark;

    const excluded = new Set((input.exclude ?? []).map(plainSessionRefKey));
    const guards: RecordGuard[] = [];
    type Admitted = { ref: SessionRef; session: SessionRecord; profile: SecretaryProfileV1 };
    const admitted: Admitted[] = [];

    for (const record of sessionRead.value.sessions) {
      if (record.workspaceId !== scope.workspaceId) continue;
      const ref: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
      if (excluded.has(plainSessionRefKey(ref))) continue;
      // The page is only a candidate list: the one admission check decides on the
      // canonical record. A rule refusal is not a candidate; a failed read is
      // `unavailable`, never skipped.
      const admission = await admitRequestSecretary(deps, ctx, { caller: scope, session: ref });
      if (admission.status !== 'ready') return admission;
      if (admission.value.status === 'refused') continue;
      const admittedFacts = admission.value;
      for (const guard of admittedFacts.guards) appendGuardCopyFirstWins(guards, guard);
      admitted.push({ ref, session: admittedFacts.session, profile: admittedFacts.profile });
    }

    if (admitted.length === 0) {
      return { status: 'ready', value: { candidates: [], guards, watermark } };
    }

    const openRead = await readOpenRequestFacts(deps.records, ctx, scope);
    if (openRead.status !== 'ready') return openRead;
    for (const guard of openRead.value.guards) appendGuardCopyFirstWins(guards, guard);
    watermark = laterCursor(watermark, openRead.value.watermark);

    const copiesRead = await readActiveCopies(deps.records, scope);
    if (copiesRead.status !== 'ready') {
      return unavailable(`the active read-only copies read failed: ${copiesRead.code}: ${copiesRead.reason}`);
    }
    const copies = copiesRead.value;

    const candidates: SecretaryCandidateFactsV1[] = [];
    for (const entry of admitted) {
      const sessionKeyOfEntry = plainSessionRefKey(entry.ref);
      const session = entry.session;
      const scopeRead = await deps.scope.scopeOf(ctx, { session: entry.ref });
      if (scopeRead.status !== 'ready') {
        return unavailable(scopeRead.status === 'rejected'
          ? `the Session scope read failed: ${scopeRead.reason}`
          : 'the Session scope is unavailable');
      }

      // A read failure inside the activity gathers is kept here (a callback
      // cannot narrow a local); the first one makes the whole read unavailable.
      const problems: LineClockFailure[] = [];
      const note = (failure: LineClockFailure): void => { if (problems.length === 0) problems.push(failure); };
      const usage = await readLastInputTokens(deps.records, scope, entry.ref);
      if (usage.status !== 'ready') return unavailable(usage.reason);
      watermark = laterCursor(watermark, usage.watermark);
      const ran = await readRanGoal(deps.records, scope, entry.ref, input.goalId);
      if (ran.status !== 'ready') return unavailable(ran.reason);
      watermark = laterCursor(watermark, ran.watermark);
      const instants = await readActivityInstants(deps.records, scope, session, copies, note);
      const problem = problems[0];
      if (problem !== undefined) {
        return unavailable(`the Session activity could not be read: ${problem.reason}`);
      }

      const lastInputTokens = usage.value;
      const threshold = Math.min(
        SECRETARY_HANDOFF_INPUT_TOKENS,
        Math.floor(0.8 * entry.profile.runtimeBudget.contextWindowTokens),
      );
      candidates.push({
        session: { projectId: entry.ref.projectId, sessionId: entry.ref.sessionId },
        revision: session.revision,
        scope: scopeRead.value,
        profile: entry.profile,
        busy: (session.occupancy !== null && session.occupancy !== undefined)
          || openRead.value.pendingOwners.has(sessionKeyOfEntry)
          || openRead.value.liveAttempts.has(sessionKeyOfEntry),
        ranGoal: ran.value,
        lastInputTokens,
        tooLong: lastInputTokens !== null && lastInputTokens >= threshold,
        lastActivityAt: latestActivityAt(session.createdAt, instants),
      });
    }
    return { status: 'ready', value: { candidates, guards, watermark } };
  }

  return { readSecretarySelectionFacts };
}
