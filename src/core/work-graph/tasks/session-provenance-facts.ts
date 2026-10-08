/**
 * Slice 1 §3.3/§3.5: the trusted legacy-provenance reader. It may import the
 * Query/TaskRequeue/message codecs because it lives in `tasks`; `sessions` gets
 * its result through the narrow `LegacySessionProvenancePort`.
 *
 * The derivation follows spec §2.2: first the fixed consultation derivation on
 * the original message (cross-checked with the QueryJob when it exists); then
 * the first claim's `TaskRequeue.historySource` together with the exact
 * creation `CoreOperation` located through the initial link's `since` cursor
 * and `records.eventAt`; with a pinned task-execution manifest the brief's
 * `seededFrom` is cross-checked with the same creation operation. There is no
 * event scan. Two conflicting reliable results are
 * `incomplete/legacy_provenance_ambiguous:`; no reliable evidence is
 * `{kind:'new'}` with basis `no_reliable_predecessor`; a predecessor cycle is
 * `cycle/session_provenance_cycle:`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type {
  LegacyProvenanceBasisV1, SessionProvenanceV1, SessionRecord, SessionWorkLink,
} from '../../../contracts/core/session.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { QueryJobRef, QueryJobSnapshot } from '../../../contracts/query-job.js';
import { consultationQueryRefs } from '../../../contracts/query-job.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { artifactBodyDigest, artifactBodySize } from '../../../contracts/artifact.js';
import type { ContinuationBriefV1 } from '../../../contracts/continuation-brief.js';
import { continuationBriefShapeProblem } from '../../../contracts/continuation-brief.js';
import { MANIFEST_CONTENT_TYPE } from '../../../contracts/no-progress.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { LookupValue, RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  SESSION_BY_WORKSPACE_LOOKUP, SESSION_WORK_LINKS_LOOKUP, decodeSessionOperationRecord,
  decodeSessionRecord, decodeSessionWorkLink, plainSessionRefToAggregate, sessionAggregateRefKey,
  sessionCreatedPayloadFromEvent,
} from '../sessions/session-record-codecs.js';
import {
  SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP, decodeSessionMessageRecord,
} from '../sessions/message-record-codecs.js';
import { decodeDispatchOutboxEntry, decodeTaskRequeueSnapshot } from './claim-record-codecs.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import type {
  LegacySessionProvenancePort, SessionFactsPort,
} from '../model/session-facts-contracts.js';
import type { SessionPageRequest } from '../model/session-contracts.js';

const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 25;
const CLAIM_SCAN_MAX_PAGES = 25;
const LINK_SCAN_MAX_PAGES = 25;
const CYCLE_MAX_DEPTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return refKeyOf(left) === refKeyOf(right); } catch { return false; }
}
function laterCursor(left: CommitCursor | null, right: CommitCursor | null): CommitCursor | null {
  if (left === null) return right;
  if (right === null) return left;
  return seqOfCommitCursor(right) > seqOfCommitCursor(left) ? right : left;
}
function incomplete(reason: string): CoreRejection { return { status: 'rejected', code: 'incomplete', reason }; }
function unavailable(reason: string): CoreRejection { return { status: 'rejected', code: 'unavailable', reason }; }

/** The same predecessor classification every reliable continuation source uses. */
function continuationReasonOf(session: SessionRecord): 'archived' | 'damaged' | 'interrupted' {
  return session.lifecycle === 'archived' ? 'archived'
    : session.health === 'unavailable' ? 'damaged' : 'interrupted';
}

type OneRead =
  | { status: 'found'; record: EncodedRecord; readThrough: CommitCursor | null }
  | { status: 'missing' }
  | { status: 'error'; reason: string };

type Derivation = { provenance: SessionProvenanceV1; basis: LegacyProvenanceBasisV1 };

/**
 * §3.4 S:630: the evidence of one derivation is kept per call. A reader
 * instance serves concurrent derivations, so the guard map and the watermark
 * never live on the factory closure.
 */
type DerivationState = { guards: Map<string, RecordGuard>; watermark: CommitCursor | null };

export function createLegacySessionProvenanceReader(
  records: GoalRecordTransactionPort & RecordLookupPort, facts: SessionFactsPort,
  bodies?: RawArtifactStorePort,
): LegacySessionProvenancePort {
  function addGuard(state: DerivationState, record: EncodedRecord): void {
    if (!state.guards.has(record.refKey)) {
      state.guards.set(record.refKey, { refKey: record.refKey, expectedRevision: record.revision });
    }
  }

  async function readOne(state: DerivationState, refKey: string): Promise<OneRead> {
    let read;
    try {
      read = await records.readMany([refKey]);
    } catch (error) {
      return { status: 'error', reason: String(error) };
    }
    if (read.status !== 'ready') {
      if (read.code === 'not_found') return { status: 'missing' };
      return { status: 'error', reason: `${read.code}: ${read.reason}` };
    }
    state.watermark = laterCursor(state.watermark, read.value.readThrough);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) {
      return read.value.missing.includes(refKey) ? { status: 'missing' } : { status: 'error', reason: `the read did not return or report missing ${refKey}` };
    }
    return { status: 'found', record, readThrough: read.value.readThrough };
  }

  async function readSession(state: DerivationState, ref: SessionRef): Promise<
    | { status: 'found'; session: SessionRecord; record: EncodedRecord }
    | { status: 'missing' }
    | { status: 'error'; reason: string }
  > {
    const key = sessionAggregateRefKey(plainSessionRefToAggregate(ref));
    const read = await readOne(state, key);
    if (read.status !== 'found') return read;
    const decoded = decodeSessionRecord(read.record);
    if (decoded.status !== 'decoded') return { status: 'error', reason: `the Session ${key} is damaged: ${decoded.reason}` };
    return { status: 'found', session: decoded.value, record: read.record };
  }

  /** One bounded key-ordered sweep of a candidate index, re-read canonically. */
  async function sweep(
    state: DerivationState, index: string, values: readonly LookupValue[], maxPages: number,
  ): Promise<{ status: 'ready'; records: EncodedRecord[]; budgetHit: boolean } | { status: 'error'; rejection: CoreRejection }> {
    const found: EncodedRecord[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      let result;
      try {
        result = await records.lookup(after === undefined
          ? { index, values, limit: SCAN_PAGE_SIZE }
          : { index, values, after, limit: SCAN_PAGE_SIZE });
      } catch (error) {
        return { status: 'error', rejection: unavailable(`the legacy provenance lookup failed: ${String(error)}`) };
      }
      if (result.status !== 'ready') {
        if (result.code === 'unsupported') return { status: 'ready', records: found, budgetHit: true };
        return { status: 'error', rejection: unavailable(`${result.code}: ${result.reason}`) };
      }
      const keys = result.value.records.map(record => record.refKey);
      if (keys.length > 0) {
        const read = await readOneBatch(state, keys);
        if (read.status === 'error') return { status: 'error', rejection: unavailable(read.reason) };
        for (const record of read.records) found.push(record);
      }
      if (result.value.next === null) return { status: 'ready', records: found, budgetHit: false };
      after = result.value.next;
    }
    return { status: 'ready', records: found, budgetHit: true };
  }

  async function readOneBatch(
    state: DerivationState, keys: readonly string[],
  ): Promise<{ status: 'ready'; records: EncodedRecord[] } | { status: 'error'; reason: string }> {
    let read;
    try {
      read = await records.readMany(keys);
    } catch (error) {
      return { status: 'error', reason: String(error) };
    }
    if (read.status !== 'ready') return { status: 'error', reason: `${read.code}: ${read.reason}` };
    state.watermark = laterCursor(state.watermark, read.value.readThrough);
    const present = new Map(read.value.records.map(record => [record.refKey, record]));
    const ordered: EncodedRecord[] = [];
    for (const key of keys) {
      const record = present.get(key);
      if (record === undefined) return { status: 'error', reason: `candidate ${key} was not confirmed by the canonical read` };
      ordered.push(record);
    }
    return { status: 'ready', records: ordered };
  }

  /**
   * The fixed consultation derivation: find the original message that records
   * `consultationDerivation.childSessionRef = child` in a bounded complete
   * window. Messages have no derivation index, so every workspace Session's
   * sender-session and recipient message streams are swept (an old Query may
   * not have `executionState` yet).
   */
  async function consultationEvidence(state: DerivationState, projectId: string, workspaceId: string, sessionId: string): Promise<
    | { status: 'ready'; candidates: Derivation[] }
    | { status: 'error'; rejection: CoreRejection }
  > {
    const sessions = await sweep(state, SESSION_BY_WORKSPACE_LOOKUP, [projectId, workspaceId], SCAN_MAX_PAGES);
    if (sessions.status === 'error') return sessions;
    if (sessions.budgetHit) return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the workspace Session window was not read completely') };
    const candidates: Derivation[] = [];
    const seen = new Set<string>();
    for (const sessionRecord of sessions.records) {
      const decoded = decodeSessionRecord(sessionRecord);
      if (decoded.status !== 'decoded') return { status: 'error', rejection: unavailable(`a workspace Session is damaged: ${decoded.reason}`) };
      const source = decoded.value;
      if (source.workspaceId !== workspaceId) continue;
      for (const index of [SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP, SESSION_MESSAGE_BY_RECIPIENT_LOOKUP]) {
        const stream = await sweep(state, index, [projectId, workspaceId, source.ref.sessionId], SCAN_MAX_PAGES);
        if (stream.status === 'error') return stream;
        if (stream.budgetHit) return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: a Session message window was not read completely') };
        for (const messageRecord of stream.records) {
          if (seen.has(messageRecord.refKey)) continue;
          seen.add(messageRecord.refKey);
          const messageDecoded = decodeSessionMessageRecord(messageRecord);
          if (messageDecoded.status !== 'decoded') return { status: 'error', rejection: unavailable(`a Session message is damaged: ${messageDecoded.reason}`) };
          const message = messageDecoded.value;
          const derivation = message.consultationDerivation;
          if (derivation === undefined) continue;
          if (message.ref.projectId !== projectId || message.ref.workspaceId !== workspaceId) continue;
          if (derivation.childSessionRef.projectId !== projectId || derivation.childSessionRef.sessionId !== sessionId) continue;
          if (derivation.sourceSessionRef.projectId !== projectId) continue;
          // Cross-check the QueryJob that names this message when it exists.
          const refs = consultationQueryRefs(message.ref);
          const jobKey = refKeyOf(refs.queryJobRef);
          const jobRead = await readOne(state, jobKey);
          if (jobRead.status === 'error') return { status: 'error', rejection: unavailable(jobRead.reason) };
          if (jobRead.status === 'found') {
            const jobDecoded = decodeQueryJobSnapshot(jobRead.record);
            if (jobDecoded.status !== 'decoded') return { status: 'error', rejection: unavailable(`the consultation QueryJob is damaged: ${jobDecoded.reason}`) };
            const job = jobDecoded.value;
            const consultation = job.job.intent.execution?.consultation;
            if (consultation === undefined || consultation.derivation === undefined
              || !sameRef(consultation.derivation, derivation)
              || !sameRef(consultation.messageRef, message.ref)) {
              return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the message derivation disagrees with its QueryJob') };
            }
            addGuard(state, jobRead.record);
          }
          addGuard(state, messageRecord);
          candidates.push({
            provenance: { schemaVersion: 1, kind: 'readonly_copy', from: derivation.sourceSessionRef, messageRef: message.ref },
            basis: { kind: 'consultation', messageRef: message.ref },
          });
        }
      }
    }
    return { status: 'ready', candidates };
  }

  /** The first Work claim of a Session by the minimum `claim.generation`. */
  async function firstClaim(ctx: CoreCallContext, projectId: string, workspaceId: string, sessionId: string): Promise<
    | { status: 'ready'; claim: TaskClaim | null }
    | { status: 'error'; rejection: CoreRejection }
  > {
    let after: string | undefined;
    let best: TaskClaim | null = null;
    for (let page = 0; page < CLAIM_SCAN_MAX_PAGES; page += 1) {
      const request: { sessionRef: SessionRef; page: SessionPageRequest } = {
        sessionRef: { projectId, sessionId },
        page: after === undefined ? { limit: SCAN_PAGE_SIZE } : { limit: SCAN_PAGE_SIZE, cursor: after },
      };
      const result = await facts.listSessionExecutions(ctx, request);
      if (result.status === 'not_found') return { status: 'ready', claim: best };
      if (result.status !== 'ready') {
        if (result.status === 'not_ready') return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the first claim window was not readable') };
        return { status: 'error', rejection: result };
      }
      for (const claim of result.value.items) {
        if (best === null || claim.generation < best.generation) best = claim;
      }
      if (result.value.nextCursor === null) return { status: 'ready', claim: best };
      after = result.value.nextCursor;
    }
    return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the claim window was not read completely') };
  }

  async function requeueEvidence(state: DerivationState, ctx: CoreCallContext, projectId: string, workspaceId: string, sessionId: string): Promise<
    | { status: 'ready'; derivation: Derivation | null }
    | { status: 'error'; rejection: CoreRejection }
  > {
    const first = await firstClaim(ctx, projectId, workspaceId, sessionId);
    if (first.status === 'error') return first;
    if (first.claim === null) return { status: 'ready', derivation: null };
    const claim = first.claim;
    // The first claim's Run carries the TaskRequeue it consumed.
    const runRead = await readOne(state, refKeyOf(claim.runRef));
    if (runRead.status === 'error') return { status: 'error', rejection: unavailable(runRead.reason) };
    if (runRead.status === 'missing') return { status: 'ready', derivation: null };
    const run = decodeRun(runRead.record);
    if (!run.ok) return { status: 'error', rejection: unavailable(`the first claim Run is damaged: ${run.reason}`) };
    if (run.value.requeueRef === undefined) return { status: 'ready', derivation: null };
    addGuard(state, runRead.record);
    const requeueKey = refKeyOf(run.value.requeueRef);
    const requeueRead = await readOne(state, requeueKey);
    if (requeueRead.status === 'error') return { status: 'error', rejection: unavailable(requeueRead.reason) };
    if (requeueRead.status === 'missing') return { status: 'ready', derivation: null };
    const requeue = decodeTaskRequeueSnapshot(requeueRead.record);
    if (requeue.status !== 'decoded') return { status: 'error', rejection: unavailable(`the TaskRequeue is damaged: ${requeue.reason}`) };
    // §3.4 S:614: the proof read the requeue record, so it joins the guards.
    addGuard(state, requeueRead.record);
    const historySource = requeue.value.historySource;
    if (historySource === null) return { status: 'ready', derivation: null };
    if (historySource.sessionRef.projectId !== projectId) return { status: 'ready', derivation: null };
    const sourceRead = await readSession(state, historySource.sessionRef);
    if (sourceRead.status === 'error') return { status: 'error', rejection: unavailable(sourceRead.reason) };
    if (sourceRead.status === 'missing') return { status: 'ready', derivation: null };
    addGuard(state, sourceRead.record);

    // The exact creation operation: the initial responsible link's `since`
    // cursor must locate the child's SessionCreated event, whose operation is a
    // completed CoreOperation created for this very Task.
    const links = await sweep(state, SESSION_WORK_LINKS_LOOKUP, [projectId, sessionId], LINK_SCAN_MAX_PAGES);
    if (links.status === 'error') return links;
    if (links.budgetHit) return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the creation link window was not read completely') };
    const task = claim.task;
    const located = await locateCreation(state, projectId, sessionId, task, links.records);
    if (located.status === 'error') return located;
    if (located.status === 'missing') return { status: 'ready', derivation: null };
    addGuard(state, located.operationRecord);
    if (located.linkRecord !== null) addGuard(state, located.linkRecord);

    // A reused Session already existed before the requeue; only a Session
    // created at or after the requeue proves a continuation.
    const createdAt = sourceRead.session.createdAt;
    const childCreatedAt = located.session.createdAt;
    const requeueAt = requeue.value.requestedAt;
    const childMs = Date.parse(childCreatedAt);
    const requeueMs = Date.parse(requeueAt);
    const claimMs = Date.parse(claim.claimedAt);
    if (!Number.isFinite(childMs) || !Number.isFinite(requeueMs) || !Number.isFinite(claimMs)) {
      return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the creation/requeue instants are not readable') };
    }
    if (childMs < requeueMs || childMs > claimMs) return { status: 'ready', derivation: null };

    const reason = continuationReasonOf(sourceRead.session);
    return {
      status: 'ready',
      derivation: {
        provenance: { schemaVersion: 1, kind: 'continuation', from: historySource.sessionRef, reason, task },
        basis: {
          kind: 'requeue_creation', operationRef: located.operationRef, creationCursor: located.creationCursor,
          requeueRef: run.value.requeueRef, firstClaimRef: claim.outboxRef,
        },
      },
    };
  }

  /**
   * §2.2 S:183-188: the reliable `manifest_seed` basis. The first claim's Run
   * pins a task-execution manifest; its brief's `session.seededFrom` names the
   * predecessor, and the SAME creation operation (the initial link's `since`
   * locates the child's `SessionCreated`) must back it. When the Run pins a real
   * task-execution manifest but no body store is injected, the source is an
   * explicit `unavailable`, never a fabricated `new` (B2).
   */
  async function manifestEvidence(
    state: DerivationState, ctx: CoreCallContext, projectId: string, workspaceId: string, sessionId: string,
  ): Promise<
    | { status: 'ready'; derivation: Derivation | null }
    | { status: 'error'; rejection: CoreRejection }
  > {
    const first = await firstClaim(ctx, projectId, workspaceId, sessionId);
    if (first.status === 'error') return first;
    if (first.claim === null) return { status: 'ready', derivation: null };
    const claim = first.claim;
    const runRead = await readOne(state, refKeyOf(claim.runRef));
    if (runRead.status === 'error') return { status: 'error', rejection: unavailable(runRead.reason) };
    if (runRead.status === 'missing') return { status: 'ready', derivation: null };
    const run = decodeRun(runRead.record);
    if (!run.ok) return { status: 'error', rejection: unavailable(`the first claim Run is damaged: ${run.reason}`) };
    // §3.4 S:614: the proof read this Run, so it joins the guards.
    addGuard(state, runRead.record);
    const bundleRef: ArtifactRef | null = run.value.envelope?.bundleRef ?? null;
    if (bundleRef === null) return { status: 'ready', derivation: null };
    // Any non-manifest bundle is not evidence; only the exact task-execution
    // manifest content type can carry a continuation brief.
    if (bundleRef.contentType !== MANIFEST_CONTENT_TYPE
      || !nonEmpty(bundleRef.digest) || !Number.isSafeInteger(bundleRef.sizeBytes) || bundleRef.sizeBytes < 0) {
      return { status: 'ready', derivation: null };
    }
    // The binding pins the manifest digest; a disagreement is damage, not a
    // silently discarded source.
    if (run.value.inputBinding !== undefined && run.value.inputBinding.manifestDigest !== bundleRef.digest) {
      return { status: 'error', rejection: unavailable('the manifest seed Run binding disagrees with the pinned manifest digest') };
    }
    // §2.2 S:183-188 / B2: once a real task-execution manifest is pinned, its
    // absence from a reader is an explicit failure, never "no evidence" (which
    // would fall through to a fabricated `new`).
    if (bodies === undefined) {
      return { status: 'error', rejection: unavailable('the pinned task-execution manifest is not readable: no body store is injected') };
    }
    let stored;
    try {
      stored = await bodies.read(bundleRef);
    } catch (error) {
      return { status: 'error', rejection: unavailable(`reading the seed manifest failed: ${String(error)}`) };
    }
    if (stored.status !== 'ready') {
      return { status: 'error', rejection: unavailable(`the seed manifest is not readable: ${stored.code}: ${stored.reason}`) };
    }
    const record = stored.value;
    if (!sameRef(record.ref, bundleRef) || artifactBodyDigest(record.body) !== bundleRef.digest
      || artifactBodySize(record.body) !== bundleRef.sizeBytes) {
      return { status: 'error', rejection: unavailable('the seed manifest bytes do not match their pinned digest') };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.body);
    } catch {
      return { status: 'error', rejection: unavailable('the seed manifest is not valid JSON') };
    }
    if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'task_execution'
      || typeof parsed['input'] !== 'string' || !nonEmpty(parsed['inputDigest'])) {
      return { status: 'error', rejection: unavailable('the seed manifest is not a complete task-execution manifest') };
    }
    if (!sameRef(parsed['claim'], claim)) {
      return { status: 'error', rejection: unavailable('the seed manifest claim disagrees with the first claim') };
    }
    const brief = parsed['continuationBrief'];
    if (brief === undefined) return { status: 'ready', derivation: null };
    const briefProblem = continuationBriefShapeProblem(brief);
    if (briefProblem !== null) {
      return { status: 'error', rejection: unavailable(`the seed manifest continuation brief is invalid: ${briefProblem}`) };
    }
    const seededFrom = (brief as ContinuationBriefV1).session.seededFrom;
    if (seededFrom === null || seededFrom === undefined) return { status: 'ready', derivation: null };
    if (seededFrom.sessionRef.projectId !== projectId) return { status: 'ready', derivation: null };
    const predecessor = await readSession(state, seededFrom.sessionRef);
    if (predecessor.status === 'error') return { status: 'error', rejection: unavailable(predecessor.reason) };
    if (predecessor.status === 'missing') return { status: 'ready', derivation: null };
    addGuard(state, predecessor.record);
    // The same creation operation every other reliable source must agree on.
    const links = await sweep(state, SESSION_WORK_LINKS_LOOKUP, [projectId, sessionId], LINK_SCAN_MAX_PAGES);
    if (links.status === 'error') return links;
    if (links.budgetHit) return { status: 'error', rejection: incomplete('legacy_provenance_ambiguous: the creation link window was not read completely') };
    const task = claim.task;
    const located = await locateCreation(state, projectId, sessionId, task, links.records);
    if (located.status === 'error') return located;
    if (located.status === 'missing') return { status: 'ready', derivation: null };
    addGuard(state, located.operationRecord);
    if (located.linkRecord !== null) addGuard(state, located.linkRecord);
    return {
      status: 'ready',
      derivation: {
        provenance: { schemaVersion: 1, kind: 'continuation', from: seededFrom.sessionRef,
          reason: continuationReasonOf(predecessor.session), task },
        basis: { kind: 'manifest_seed', operationRef: located.operationRef, creationCursor: located.creationCursor,
          runRef: run.value.ref, manifestRef: bundleRef },
      },
    };
  }

  async function locateCreation(
    state: DerivationState, projectId: string, sessionId: string, task: TaskClaim['task'], links: readonly EncodedRecord[],
  ): Promise<
    | { status: 'ready'; operationRef: OperationRef; creationCursor: CommitCursor; operationRecord: EncodedRecord;
        session: SessionRecord; linkRecord: EncodedRecord | null }
    | { status: 'missing' }
    | { status: 'error'; rejection: CoreRejection }
  > {
    const matching: { link: SessionWorkLink; record: EncodedRecord }[] = [];
    for (const record of links) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') return { status: 'error', rejection: unavailable(`a Session work link is damaged: ${decoded.reason}`) };
      const link = decoded.value;
      if (link.ref.relation !== 'responsible' || link.ref.target.kind !== 'task') continue;
      if (!sameRef(link.ref.target.ref, task)) continue;
      matching.push({ link, record });
    }
    for (const { link, record: linkRecord } of matching) {
      const located = await records.eventAt(link.since);
      if (located.status !== 'ready') {
        // §2.2 S:190: a failed read reports incomplete/unavailable; it never
        // falls through to a fabricated `new`.
        return { status: 'error', rejection: located.code === 'not_found'
          ? incomplete(`legacy_provenance_ambiguous: the creation cursor of link ${linkRecord.refKey} does not locate an event`)
          : unavailable(`the creation event of link ${linkRecord.refKey} is not readable: ${located.code}: ${located.reason}`) };
      }
      state.watermark = laterCursor(state.watermark, located.value.cursor);
      // A `since` that locates another event type (a reopened link) is not a
      // creation proof, but it is not a read failure either.
      if (located.value.event.eventType !== 'SessionCreated') continue;
      const payload = sessionCreatedPayloadFromEvent(located.value.event);
      if (payload.status !== 'decoded') {
        return { status: 'error', rejection: unavailable(`the SessionCreated event is damaged: ${payload.reason}`) };
      }
      if (payload.value.session.ref.projectId !== projectId || payload.value.session.ref.sessionId !== sessionId) continue;
      if (payload.value.session.workspaceId === undefined) continue;
      const operationKey = refKeyOf(payload.value.operationRef);
      const operationRead = await readOne(state, operationKey);
      if (operationRead.status === 'error') return { status: 'error', rejection: unavailable(operationRead.reason) };
      if (operationRead.status === 'missing') continue;
      const operation = decodeSessionOperationRecord(operationRead.record);
      if (operation.status !== 'decoded') return { status: 'error', rejection: unavailable(`the creation operation is damaged: ${operation.reason}`) };
      const record = operation.value;
      if (record.phase !== 'completed' || record.action.kind !== 'create') continue;
      if (!sameRef(record.action.plannedSessionRef, { projectId, sessionId })) continue;
      const taskLink = record.action.initialLinks.some(entry => entry.relation === 'responsible'
        && entry.target.kind === 'task' && sameRef(entry.target.ref, task));
      if (!taskLink) continue;
      addGuard(state, operationRead.record);
      addGuard(state, linkRecord);
      return {
        status: 'ready', operationRef: payload.value.operationRef, creationCursor: link.since,
        operationRecord: operationRead.record, session: payload.value.session, linkRecord,
      };
    }
    return { status: 'missing' };
  }

  async function cycleProblem(state: DerivationState, from: SessionRef, sessionId: string): Promise<CoreRejection | null> {
    const seen = new Set<string>([sessionId]);
    let current: SessionRef | null = from;
    for (let depth = 0; current !== null; depth += 1) {
      if (seen.has(current.sessionId)) {
        return { status: 'rejected', code: 'cycle', reason: `session_provenance_cycle: the predecessor chain of Session ${sessionId} closes a loop` };
      }
      seen.add(current.sessionId);
      const read = await readSession(state, current);
      // N4: a failed or missing predecessor read is not "no cycle": propagate it.
      if (read.status === 'error') {
        return unavailable(`the predecessor Session ${current.sessionId} is not readable: ${read.reason}`);
      }
      if (read.status === 'missing') {
        return { status: 'rejected', code: 'not_found', reason: `the predecessor Session ${current.sessionId} does not exist` };
      }
      addGuard(state, read.record);
      const provenance = read.session.provenance ?? null;
      current = provenance !== null && provenance.kind !== 'new' ? provenance.from : null;
      // A completed acyclic chain ends at a Session without a readable
      // predecessor; reaching the read bound with the chain still open is an
      // unfinished proof, not a proven absence of a cycle.
      if (current !== null && depth + 1 >= CYCLE_MAX_DEPTH) {
        return incomplete('session_provenance_cycle: the predecessor chain exceeds the read bound');
      }
    }
    return null;
  }

  return {
    async deriveLegacySessionProvenance(
      ctx: CoreCallContext, sessionRef: SessionRef,
    ): Promise<ReadResult<{ provenance: SessionProvenanceV1; basis: LegacyProvenanceBasisV1; guards: readonly RecordGuard[]; sourceCursor: CommitCursor }>> {
      // §3.4 S:630: each call keeps its own evidence; concurrent derivations on
      // one reader instance never share a guard or a watermark.
      const state: DerivationState = { guards: new Map<string, RecordGuard>(), watermark: null };
      if (ctx?.signal?.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the legacy provenance derivation was cancelled' };
      const projectId = ctx?.projectId;
      const workspaceId = ctx?.workspaceId;
      if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !isRecord(sessionRef) || !nonEmpty(sessionRef.sessionId)) {
        return { status: 'rejected', code: 'invalid', reason: 'the legacy provenance derivation requires a bound SessionRef' };
      }
      if (sessionRef.projectId !== projectId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
      }
      const sessionId = sessionRef.sessionId;
      const child = await readSession(state, sessionRef);
      if (child.status === 'missing') return { status: 'not_found' };
      if (child.status === 'error') return unavailable(child.reason);
      addGuard(state, child.record);
      if (child.session.workspaceId !== workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another workspace' };
      }
      const recorded = child.session.provenance ?? null;
      if (recorded !== null) {
        return {
          status: 'ready',
          value: { provenance: recorded, basis: { kind: 'no_reliable_predecessor' }, guards: [...state.guards.values()],
            sourceCursor: state.watermark ?? makeCommitCursor(1) },
        };
      }

      const consultations = await consultationEvidence(state, projectId, workspaceId, sessionId);
      if (consultations.status === 'error') return consultations.rejection;
      const requeue = await requeueEvidence(state, ctx, projectId, workspaceId, sessionId);
      if (requeue.status === 'error') return requeue.rejection;
      const manifest = await manifestEvidence(state, ctx, projectId, workspaceId, sessionId);
      if (manifest.status === 'error') return manifest.rejection;

      const distinct = new Map<string, Derivation>();
      for (const candidate of consultations.candidates) distinct.set(refKeyOf(candidate.provenance), candidate);
      if (requeue.derivation !== null) distinct.set(refKeyOf(requeue.derivation.provenance), requeue.derivation);
      if (manifest.derivation !== null) distinct.set(refKeyOf(manifest.derivation.provenance), manifest.derivation);
      if (distinct.size > 1) {
        return incomplete('legacy_provenance_ambiguous: two reliable legacy provenance sources disagree');
      }
      const chosen = requeue.derivation ?? manifest.derivation
        ?? (consultations.candidates.length > 0 ? consultations.candidates[0]! : null);
      if (chosen === null) {
        return {
          status: 'ready',
          value: { provenance: { schemaVersion: 1, kind: 'new' }, basis: { kind: 'no_reliable_predecessor' },
            guards: [...state.guards.values()], sourceCursor: state.watermark ?? makeCommitCursor(1) },
        };
      }
      if (chosen.provenance.kind === 'new') {
        return incomplete('legacy_provenance_ambiguous: a reliable legacy provenance cannot be a fresh Session');
      }
      const cycle = await cycleProblem(state, chosen.provenance.from, sessionId);
      if (cycle !== null) return cycle;
      return {
        status: 'ready',
        value: { provenance: chosen.provenance, basis: chosen.basis, guards: [...state.guards.values()],
          sourceCursor: state.watermark ?? makeCommitCursor(1) },
      };
    },
  };
}
