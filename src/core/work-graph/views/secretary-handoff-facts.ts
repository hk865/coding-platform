/**
 * The secretary handoff's read-only facts: the coverage of a source line, the routing set of the requests it still
 * owns, the successor's brief and the archive condition. Each is a complete read with one first-read horizon; a later
 * complete read is a new attempt, never a patch of the old one. A failed or damaged read is `unavailable`, never an
 * empty coverage, an empty routing set or `none`.
 *
 * The coverage, routing, brief and archive-condition reads share the same source facts.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { CurrentPointerRef } from '../../../contracts/note.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { ConditionCheckV1, SecretaryHandoffFactsPort } from '../model/secretary-lifecycle-contracts.js';
import type {
  CoverageFactsV1, CoverageGoalV1, HandoffBriefGoalV1,
  HandoffBriefNoteV1, HandoffBriefStateV1, RoutingRootV1,
  RoutingSetFactsV1, SecretaryHandoffFactsPort as FactsPort,
} from '../model/secretary-lifecycle-contracts.js';
import type {
  HandoffBriefGoalRefV1, HandoffBriefGoalRefsV1, HandoffBriefRefsReadPort,
} from '../model/session-handoff-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import type { RequestFactsPort } from '../tasks/request-facts.js';
import { readAllOrdered } from '../persistence/lookup-ordered-all.js';
import {
  currentPointerRefKey, decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot,
  noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { anchorKeyOf } from '../notes/note-anchors.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { sessionActivityCodec, sessionActivityRefOf } from '../sessions/session-activity.js';
import { operationRefKey, plainSessionRefKey } from '../sessions/session-record-codecs.js';
import { isSecretaryDuty, successorOperationsOf } from '../sessions/session-handoff-service.js';
import { briefReady } from '../state/session-handoff.js';
import { secretaryHandoffClaimKey } from '../sessions/session-handoff-fence.js';
import { QUERY_OPEN_BY_WORKSPACE_INDEX } from '../model/request-contracts.js';

export type SecretaryHandoffFactsReads = {
  records: Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & RecordOrderedLookupPort;
  requests: Pick<RequestFactsPort, 'readRequest'>;
  sessions: Pick<SessionDirectoryPort, 'readSession' | 'getSessionOperation'>;
  duty: SessionDutyReadPort;
};

function unavailable(reason: string): CoreRejection {
  return rejected('unavailable', reason);
}

function recordOf(records: readonly EncodedRecord[], key: string): EncodedRecord | null {
  return records.find(record => record.refKey === key) ?? null;
}

/** The open request roots of the workspace and one stable first read's horizon. */
async function openRequestRoots(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext):
  Promise<{ status: 'ready'; roots: QueryJobRef[]; horizon: CommitCursor | null } | CoreRejection> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const roots = new Map<string, QueryJobRef>();
    let horizon: CommitCursor | null = null;
    let first = true;
    let stable = true;
    for (const status of ['pending', 'running', 'answered', 'closed'] as const) {
      let read;
      try {
        read = await readAllOrdered(reads.records, { index: QUERY_OPEN_BY_WORKSPACE_INDEX,
          values: [ctx.projectId, ctx.workspaceId ?? '', 'request', status], direction: 'asc' });
      } catch (error) {
        return unavailable(`the open request rounds could not be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') {
        return unavailable(`the open request rounds read failed: ${read.code}: ${read.reason}`);
      }
      if (first) { horizon = read.value.readThrough; first = false; }
      else if (read.value.readThrough !== horizon) stable = false;
      for (const record of read.value.records) {
        const decoded = decodeQueryJobSnapshot(record);
        if (decoded.status !== 'decoded') return unavailable(`an open request round is damaged: ${decoded.reason}`);
        const root = decoded.value.job.requestRoot;
        if (root !== null) roots.set(canonicalKey(root), root);
      }
    }
    // One horizon belongs to one complete attempt: a page that observed a later commit discards this attempt.
    if (stable) return { status: 'ready', roots: [...roots.values()], horizon };
  }
  return unavailable('the open request roots did not yield one stable read window');
}

/** The ledger position before the first fact: one complete pass may not observe a later commit. */
async function readHorizon(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext):
  Promise<{ status: 'ready'; horizon: CommitCursor | null } | CoreRejection> {
  let read;
  try {
    read = await reads.records.lookupOrdered({ index: QUERY_OPEN_BY_WORKSPACE_INDEX,
      values: [ctx.projectId, ctx.workspaceId ?? '', 'request', 'pending'], direction: 'asc', limit: 1 });
  } catch (error) {
    return unavailable(`the coverage horizon could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return unavailable(`the coverage horizon read failed: ${read.code}: ${read.reason}`);
  return { status: 'ready', horizon: read.value.readThrough };
}

/** The source's last QueryRun that entered and ended, by session generation. */
async function lastEnteredEndedRun(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext, source: SessionRef):
  Promise<{ status: 'ready'; run: QueryRunRef | null } | CoreRejection> {
  let read;
  try {
    read = await readAllOrdered(reads.records, { index: S2C_QUERY_RUN_BY_SESSION_GENERATION_LOOKUP,
      values: [ctx.projectId, ctx.workspaceId ?? '', source.sessionId], direction: 'asc' });
  } catch (error) {
    return unavailable(`the source's QueryRuns could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return unavailable(`the source's QueryRuns read failed: ${read.code}: ${read.reason}`);
  }
  let last: { ref: QueryRunRef; generation: number } | null = null;
  for (const record of read.value.records) {
    const decoded = decodeQueryRunSnapshotRecord(record);
    if (decoded.status !== 'decoded') return unavailable(`a source QueryRun is damaged: ${decoded.reason}`);
    const snapshot = decoded.value;
    const state = snapshot.run.executionState;
    if (state === undefined || state.entry === null || snapshot.run.endedAt === null) continue;
    if (last === null || state.sessionGeneration >= last.generation) {
      last = { ref: { ...snapshot.ref }, generation: state.sessionGeneration };
    }
  }
  return { status: 'ready', run: last === null ? null : last.ref };
}

/** The note version a current-understanding read names; its text is decoded once, in that same read. */
type UnderstandingNoteRefV1 = { noteId: string; version: number };
type CurrentUnderstandingV1 = {
  pointerRevision: number; note: UnderstandingNoteRefV1 | null;
  textSource: SessionRef | null; textRound: QueryRunRef | null;
  /** The text of `note`; the brief assembles its current note from it instead of reading that version again. */
  text: string | null;
};

/** A goal with no understanding yet: no pointer, no note and no text. */
const noUnderstanding = (pointerRevision: number): CurrentUnderstandingV1 =>
  ({ pointerRevision, note: null, textSource: null, textRound: null, text: null });

/** One record of one key, or `null`; a failed read is `unavailable`, never "nothing to read". */
async function readKeyedFact(reads: SecretaryHandoffFactsReads, key: string, what = `the note fact ${key}`):
  Promise<{ status: 'ready'; record: EncodedRecord | null } | CoreRejection> {
  let read;
  try {
    read = await reads.records.readMany([key]);
  } catch (error) {
    return unavailable(`${what} could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return unavailable(`${what} read failed: ${read.code}: ${read.reason}`);
  return { status: 'ready', record: recordOf(read.value.records, key) };
}

/** The source's own SessionActivity key and revision, or a `null` revision when it has written none. */
async function readSourceActivity(reads: SecretaryHandoffFactsReads, source: SessionRef):
  Promise<{ status: 'ready'; key: string; revision: number | null } | CoreRejection> {
  const key = canonicalKey(sessionActivityRefOf(source));
  const read = await readKeyedFact(reads, key, 'the source activity');
  if (read.status !== 'ready') return read;
  if (read.record === null) return { status: 'ready', key, revision: null };
  const decoded = sessionActivityCodec.decode(read.record);
  if (decoded.status !== 'decoded') return unavailable(`the source activity is damaged: ${decoded.reason}`);
  return { status: 'ready', key, revision: decoded.value.revision };
}

/** One goal's current understanding: its pointer, the version it names, that version's text and its source. */
async function readCurrentUnderstanding(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext,
  pointer: CurrentPointerRef): Promise<{ status: 'ready'; value: CurrentUnderstandingV1 } | CoreRejection> {
  const pointerRead = await readKeyedFact(reads, currentPointerRefKey(pointer));
  if (pointerRead.status !== 'ready') return pointerRead;
  if (pointerRead.record === null) return { status: 'ready', value: noUnderstanding(0) };
  const pointerValue = decodeCurrentPointerSnapshot(pointerRead.record);
  if (pointerValue.status !== 'decoded') {
    return unavailable(`the understanding pointer is damaged: ${pointerValue.reason}`);
  }
  const pointerRevision = pointerValue.value.revision;
  const noteId = pointerValue.value.noteId;
  if (noteId === null) return { status: 'ready', value: noUnderstanding(pointerRevision) };
  const headRead = await readKeyedFact(reads,
    noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId, noteId }));
  if (headRead.status !== 'ready') return headRead;
  if (headRead.record === null) return { status: 'ready', value: noUnderstanding(pointerRevision) };
  const headValue = decodeNoteHeadSnapshot(headRead.record);
  if (headValue.status !== 'decoded') return unavailable(`the understanding note head is damaged: ${headValue.reason}`);
  const version = headValue.value.version;
  if (version < 1) return { status: 'ready', value: noUnderstanding(pointerRevision) };
  const versionRead = await readKeyedFact(reads,
    noteVersionRefKey({ aggregateType: 'NoteVersion', projectId: ctx.projectId, noteId, version }));
  if (versionRead.status !== 'ready') return versionRead;
  if (versionRead.record === null) {
    return unavailable(`the understanding note version ${noteId}@${String(version)} is missing`);
  }
  const versionValue = decodeNoteVersionSnapshot(versionRead.record);
  if (versionValue.status !== 'decoded') {
    return unavailable(`the understanding note version is damaged: ${versionValue.reason}`);
  }
  const source = versionValue.value.source;
  return { status: 'ready', value: { pointerRevision, note: { noteId, version },
    textSource: source.kind === 'agent' ? source.sessionRef : null,
    textRound: source.kind === 'agent' ? source.queryRunRef : null,
    text: versionValue.value.conclusion } };
}

/** One goal's current understanding pointer, the version it names and the source of that version's text. */
async function goalCoverage(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext, goalId: string):
  Promise<{ goal: CoverageGoalV1 } | CoreRejection> {
  const pointerRef = { aggregateType: 'CurrentPointer' as const, projectId: ctx.projectId,
    anchorKey: anchorKeyOf({ kind: 'goal', goalId }) };
  const read = await readCurrentUnderstanding(reads, ctx, pointerRef);
  if (read.status !== 'ready') return read;
  return { goal: { goalRef: { aggregateType: 'Goal', projectId: ctx.projectId, goalId }, pointer: pointerRef,
    pointerRevision: read.value.pointerRevision, textVersion: read.value.note?.version ?? 0,
    textSource: read.value.textSource, textRound: read.value.textRound } };
}

/** The text of one stored note version; the brief holds refs and reads a version's text at most once. */
async function noteTextOf(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext, note: UnderstandingNoteRefV1):
  Promise<HandoffBriefNoteV1 | CoreRejection> {
  const read = await readKeyedFact(reads,
    noteVersionRefKey({ aggregateType: 'NoteVersion', projectId: ctx.projectId, noteId: note.noteId,
      version: note.version }));
  if (read.status !== 'ready') return read;
  if (read.record === null) return unavailable(`the note version ${note.noteId}@${String(note.version)} is missing`);
  const decoded = decodeNoteVersionSnapshot(read.record);
  if (decoded.status !== 'decoded') return unavailable(`the note version is damaged: ${decoded.reason}`);
  return { noteId: decoded.value.noteId, version: decoded.value.version, text: decoded.value.conclusion };
}

/** The note text the goal's current pointer names, and the predecessor's stored version beside it. */
async function briefGoal(reads: SecretaryHandoffFactsReads, ctx: CoreCallContext, goalId: string,
  source: SessionRef, stored: UnderstandingNoteRefV1 | null): Promise<{ status: 'ready'; value: HandoffBriefGoalV1 }
  | CoreRejection> {
  const pointerRef = { aggregateType: 'CurrentPointer' as const, projectId: ctx.projectId,
    anchorKey: anchorKeyOf({ kind: 'goal', goalId }) };
  const goalRef = { aggregateType: 'Goal' as const, projectId: ctx.projectId, goalId };
  const read = await readCurrentUnderstanding(reads, ctx, pointerRef);
  if (read.status !== 'ready') return read;
  const { note } = read.value;
  // The current note comes from the text this read already decoded; the written one is the same version whenever the
  // predecessor wrote the current one, and only a different stored version is read again.
  const current: HandoffBriefNoteV1 | null = note === null || read.value.text === null ? null
    : { noteId: note.noteId, version: note.version, text: read.value.text };
  let written: HandoffBriefNoteV1 | null = null;
  if (stored !== null && (note?.noteId !== stored.noteId || note.version !== stored.version)) {
    const other = await noteTextOf(reads, ctx, stored);
    if ('status' in other) return other;
    written = other;
  } else if (stored !== null || (read.value.textSource !== null
    && canonicalKey(read.value.textSource) === canonicalKey(source))) {
    written = current;
  }
  return { status: 'ready', value: { goalRef, written, current } };
}

export function createSecretaryHandoffFacts(reads: SecretaryHandoffFactsReads):
  Pick<FactsPort, 'readCoverage' | 'readRoutingSet' | 'readBriefState' | 'checkArchiveCondition'>
  & HandoffBriefRefsReadPort {
  /** The brief's saved goal refs: one understanding read per covered goal, the text is never stored. */
  async function readBriefGoalRefs(ctx: CoreCallContext, input: { source: SessionRef; goals: CoverageGoalV1[] }):
    Promise<{ status: 'ready'; value: HandoffBriefGoalRefsV1 } | CoreRejection> {
    const goals: HandoffBriefGoalRefV1[] = [];
    for (const goal of input.goals) {
      const read = await readCurrentUnderstanding(reads, ctx, goal.pointer);
      if (read.status !== 'ready') return read;
      const written = read.value.textSource !== null
        && canonicalKey(read.value.textSource) === canonicalKey(input.source) ? read.value.note : null;
      goals.push({ goalRef: goal.goalRef, written, current: read.value.note });
    }
    return { status: 'ready', value: goals };
  }

  async function ownedRoots(ctx: CoreCallContext, source: SessionRef):
    Promise<{ status: 'ready'; roots: { requestRoot: QueryJobRef; owner: SessionRef; effectiveGoalId: string | null }[];
      horizon: CommitCursor | null } | CoreRejection> {
    const opened = await openRequestRoots(reads, ctx);
    if (opened.status !== 'ready') return opened;
    const roots: { requestRoot: QueryJobRef; owner: SessionRef; effectiveGoalId: string | null }[] = [];
    for (const root of opened.roots) {
      let view;
      try {
        view = await reads.requests.readRequest(ctx, { requestRoot: root });
      } catch (error) {
        return unavailable(`the request ${root.queryJobId} could not be read: ${messageOf(error)}`);
      }
      if (view.status === 'not_found') continue;
      if (view.status === 'not_ready') return unavailable(`the request ${root.queryJobId} read is not ready`);
      if (view.status !== 'ready') return unavailable(`the request ${root.queryJobId} read failed: ${view.reason}`);
      if (!view.value.processing || view.value.owner === null) continue;
      if (canonicalKey(view.value.owner) !== canonicalKey(source)) continue;
      roots.push({ requestRoot: root, owner: view.value.owner, effectiveGoalId: view.value.effectiveGoalId });
    }
    return { status: 'ready', roots, horizon: opened.horizon };
  }

  return {
    readBriefGoalRefs,

    async checkArchiveCondition(ctx, input): Promise<ReadResult<ConditionCheckV1>> {
      const operationRef = input.condition.operation;
      if (typeof operationRef !== 'object' || operationRef === null) {
        return rejected('invalid', 'the archive condition names no operation');
      }
      let operationRead;
      try {
        operationRead = await reads.sessions.getSessionOperation(ctx, operationRef);
      } catch (error) {
        return unavailable(`the archive operation could not be read: ${messageOf(error)}`);
      }
      if (operationRead.status === 'not_found') return operationRead;
      if (operationRead.status !== 'ready') {
        return operationRead.status === 'rejected' ? operationRead
          : unavailable('the archive operation read is not ready');
      }
      const operation = operationRead.value;
      if (operation.action.kind !== 'handoff' && operation.action.kind !== 'secretary_archive') {
        return rejected('invalid', 'the archive condition names no handoff or archive operation');
      }
      const source = input.session;
      const session = await reads.sessions.readSession(ctx, source);
      if (session.status === 'not_found') return session;
      if (session.status !== 'ready') {
        return session.status === 'rejected' ? session
          : rejected('unavailable', 'the source Session read is not ready');
      }
      if (session.value.record.lifecycle !== 'active') {
        return { status: 'ready', value: { ok: false, reason: 'the source Session is not active' } };
      }
      const activity = await readSourceActivity(reads, source);
      if (activity.status !== 'ready') return activity;
      // The core predicate: no request the source still owns is processing.
      const owned = await ownedRoots(ctx, source);
      if (owned.status !== 'ready') return owned;
      if (owned.roots.length > 0) {
        return { status: 'ready', value: { ok: false,
          reason: 'a request the source still owns is processing' } };
      }
      if (operation.phase === 'completed' || operation.phase === 'failed') {
        return { status: 'ready', value: { ok: false, reason: 'the archive operation is no longer unfinished' } };
      }
      if (operation.action.progress.stage !== 'archive') {
        return { status: 'ready', value: { ok: false, reason: 'the archive operation has not reached its archive stage' } };
      }
      const guards = [
        { refKey: plainSessionRefKey(source), expectedRevision: session.value.record.revision },
        { refKey: activity.key, expectedRevision: activity.revision },
      ];
      // The handoff holds its fence through the final commit; the manual archive holds none.
      const fence = operation.action.kind === 'handoff'
        ? { claimKey: secretaryHandoffClaimKey(source),
            expectedOwner: operationRefKey(operationRef), nextOwner: operationRefKey(operationRef) }
        : null;
      return { status: 'ready', value: { ok: true,
        commit: { guards, fence, ledgerHorizon: owned.horizon } } };
    },

    async readCoverage(ctx, input): Promise<ReadResult<CoverageFactsV1>> {
      const raw = input?.source as unknown;
      if (typeof raw !== 'object' || raw === null) return rejected('invalid', 'readCoverage requires a SessionRef');
      // The window opens before the first fact. The advance reads the basis after every fact and discards the whole
      // attempt unless the basis reports this same ledger position: a commit between any two facts is caught.
      const window = await readHorizon(reads, ctx);
      if (window.status !== 'ready') return window;
      const source = input.source;
      const session = await reads.sessions.readSession(ctx, source);
      if (session.status === 'not_found') return session;
      if (session.status !== 'ready') {
        return session.status === 'rejected' ? session : rejected('unavailable', 'the source Session read is not ready');
      }
      const activity = await readSourceActivity(reads, source);
      if (activity.status !== 'ready') return activity;
      const last = await lastEnteredEndedRun(reads, ctx, source);
      if (last.status !== 'ready') return last;
      const owned = await ownedRoots(ctx, source);
      if (owned.status !== 'ready') return owned;
      const goalIds = new Map<string, string>();
      for (const root of owned.roots) {
        if (root.effectiveGoalId !== null) goalIds.set(root.effectiveGoalId, root.effectiveGoalId);
      }
      const goals: CoverageGoalV1[] = [];
      for (const goalId of goalIds.values()) {
        const goal = await goalCoverage(reads, ctx, goalId);
        if ('status' in goal) return goal;
        goals.push(goal.goal);
      }
      return { status: 'ready', value: { source, activityRevision: activity.revision ?? 0,
        lastRound: last.run, goals, horizon: window.horizon } };
    },

    async readBriefState(ctx, input): Promise<ReadResult<HandoffBriefStateV1>> {
      const raw = input?.session as unknown;
      if (typeof raw !== 'object' || raw === null) return rejected('invalid', 'readBriefState requires a SessionRef');
      const found = await successorOperationsOf(reads.records, ctx.projectId, ctx.workspaceId ?? '', input.session);
      if (found.status !== 'ready') return found;
      const secretary: typeof found.value = [];
      for (const match of found.value) {
        if (match.record.action.kind !== 'handoff') continue;
        const card = await reads.sessions.readSession(ctx, match.record.action.input.source);
        if (card.status !== 'ready') {
          return card.status === 'rejected' ? card : unavailable('the handoff source Session read is not ready');
        }
        const duty = await reads.duty(card.value.record.role, ctx);
        if (duty.status !== 'ready') {
          return duty.status === 'rejected' ? duty : unavailable('the handoff source duty read is not ready');
        }
        if (isSecretaryDuty(duty.value)) secretary.push(match);
      }
      const best = secretary.reduce<typeof secretary[number] | null>((left, right) =>
        left === null || right.revision > left.revision ? right : left, null);
      if (best === null) return { status: 'ready', value: { state: 'none' } };
      const operation = best.record;
      if (operation.action.kind !== 'handoff') return rejected('invalid', 'the successor operation is not a handoff');
      const action = operation.action;
      const consumedBy = action.progress.brief?.consumedBy ?? null;
      if (consumedBy !== null) {
        return { status: 'ready', value: { state: 'consumed', operation: operation.ref, by: consumedBy } };
      }
      const routing = action.progress.routing;
      // Only the final after write sets `brief.ready`; a partial registration receipt is not the archive's success.
      if (!briefReady({ archiveCommitted: action.progress.brief?.ready === true, routing })) {
        // The operation exists and names this Session, so an unfinished archive or routing set blocks preparation.
        return { status: 'ready', value: { state: 'waiting', operation: operation.ref } };
      }
      if (routing === null) return { status: 'ready', value: { state: 'waiting', operation: operation.ref } };
      const requests: { requestRoot: QueryJobRef; text: string; lastAnswer: string | null }[] = [];
      for (const root of routing.roots) {
        // An owner-changed root was deliberately not handed over; the successor does not own it.
        if (root.skipped !== null) continue;
        let view;
        try {
          view = await reads.requests.readRequest(ctx, { requestRoot: root.requestRoot });
        } catch (error) {
          return unavailable(`the request ${root.requestRoot.queryJobId} could not be read: ${messageOf(error)}`);
        }
        if (view.status !== 'ready') {
          return unavailable(`the request ${root.requestRoot.queryJobId} read failed: ${view.status}`);
        }
        const rootRound = view.value.rounds.find(round => canonicalKey(round.ref) === canonicalKey(root.requestRoot));
        const original = rootRound ?? view.value.rounds[view.value.rounds.length - 1];
        let lastAnswer: string | null = null;
        for (let index = view.value.rounds.length - 1; index >= 0; index -= 1) {
          const answer = view.value.rounds[index]!.answer;
          if (answer !== null) { lastAnswer = answer; break; }
        }
        requests.push({ requestRoot: root.requestRoot, text: original?.input ?? '', lastAnswer });
      }
      const stored = new Map((action.progress.brief?.goals ?? []).map(goal =>
        [canonicalKey(goal.goalRef), goal.written] as const));
      const goals: HandoffBriefGoalV1[] = [];
      for (const goal of action.progress.coverage?.goals ?? []) {
        const material = await briefGoal(reads, ctx, goal.goalRef.goalId, action.input.source,
          stored.get(canonicalKey(goal.goalRef)) ?? null);
        if (material.status !== 'ready') return material;
        goals.push(material.value);
      }
      return { status: 'ready', value: { state: 'ready', operation: operation.ref,
        brief: { operation: operation.ref, source: action.input.source, line: action.input.source, requests, goals } } };
    },

    async readRoutingSet(ctx, input): Promise<ReadResult<RoutingSetFactsV1>> {
      const raw = input?.source as unknown;
      if (typeof raw !== 'object' || raw === null) return rejected('invalid', 'readRoutingSet requires a SessionRef');
      const owned = await ownedRoots(ctx, input.source);
      if (owned.status !== 'ready') return owned;
      const roots: RoutingRootV1[] = owned.roots.map(root => ({ ...root }));
      return { status: 'ready', value: { roots, closed: true, horizon: owned.horizon } };
    },
  };
}
