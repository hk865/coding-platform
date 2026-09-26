/**
 * R4c.2c SourceAuthority exact-fact reader.
 *
 * This factory adapts the already assembled `MaterialAuthorityReads` to the
 * snapshot-only `SourceSnapshotReads` port that the Runtime source consumers
 * need, so they do not each re-scan or re-decode accepted facts.
 *
 * Boundaries owned here:
 *  - reuse `deps.authority.load` once per supported ref; the injected material
 *    reader keeps its own exact `readMany` and canonical decoding, so this file
 *    never opens a second Store connection, codec, cache, index or fact source;
 *  - Workspace / Run / QueryRun are delegated to that reader; QueryJob is read
 *    through the SAME records and the query codecs (the material reader has no
 *    QueryJob provider) and ReviewWork stays `unsupported`;
 *  - a genuine absence stays `not_found`; damaged/unreadable reads stay
 *    `unavailable`, and a thrown provider error is explicit `unavailable`.
 *  - the caller ref is snapshotted and validated before the first await, a
 *    found result must carry the complete requested ref, and the returned
 *    snapshot is an independent copy.
 *
 * This port has no `events` member: Query-origin consumers keep the real
 * `SourceAuthorityReads` event capability. The exact `readQuerySubmission`
 * locator read is the O(1) alternative to scanning events: it re-reads the
 * QueryJob's own locator and uses the Store's exact identity/fingerprint
 * `lookupCommit` -> `eventAt`, never a full-history scan.
 */
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { QueryJobRef, QueryJobSnapshot } from '../../contracts/query-job.js';
import type { MaterialCanonicalRef } from './materials/record-ports.js';
import { decodeQueryJobSnapshot, decodeQueryJobSubmittedEvent } from './queries/query-record-codecs.js';
import type {
  SourceCanonicalRef,
  SourceCanonicalSnapshot,
  SourceSnapshotReadDependencies,
  SourceSnapshotReads,
  SourceSnapshotResult,
} from './source-authority-ports.js';

/** The exact key set of every accepted kind. An unexpected or missing key is an
 * ambiguous request that must not be widened into another stored fact. */
const REF_KEYS = {
  Workspace: ['projectId', 'workspaceId'],
  Run: ['projectId', 'goalId', 'runId'],
  QueryRun: ['projectId', 'workspaceId', 'queryJobId', 'runId'],
  ReviewWork: ['projectId', 'workspaceId', 'goalId', 'reviewId'],
  QueryJob: ['projectId', 'workspaceId', 'queryJobId'],
} as const;

type RefKind = keyof typeof REF_KEYS;
type SupportedSourceRef = Extract<SourceCanonicalRef, { aggregateType: 'Workspace' | 'Run' | 'QueryRun' }>;
type QueryJobSourceRef = Extract<SourceCanonicalRef, { aggregateType: 'QueryJob' }>;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const unavailable = (reason: string): SourceSnapshotResult => ({ status: 'unavailable', reason });

function isRefKind(value: unknown): value is RefKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REF_KEYS, value);
}

/**
 * Snapshot the caller's ref synchronously (before the first await), reject every
 * malformed/ambiguous shape, and rebuild the exact canonical ref that will be delegated.
 * Returns `null` for an unusable request so the caller can answer `unavailable` without
 * consulting a provider or guessing at a related fact.
 */
function copyExactRef(ref: SourceCanonicalRef): SourceCanonicalRef | null {
  let cloned: unknown;
  try {
    cloned = structuredClone(ref);
  } catch {
    return null;
  }
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) return null;
  const record = cloned as Record<string, unknown>;
  const kind = record['aggregateType'];
  if (!isRefKind(kind)) return null;
  const keys = REF_KEYS[kind] as readonly string[];
  const own = Object.keys(record);
  if (own.length !== keys.length + 1) return null;
  for (const key of own) {
    if (key !== 'aggregateType' && !keys.includes(key)) return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) return null;
  }
  // Non-finite/unsupported members are a damaged request, never another fact.
  try {
    canonicalJson(cloned as JsonValue);
  } catch {
    return null;
  }
  const clean: Record<string, JsonValue> = { aggregateType: kind };
  for (const key of keys) clean[key] = record[key] as string;
  return clean as unknown as SourceCanonicalRef;
}

export function createSourceAuthorityReader(deps: SourceSnapshotReadDependencies): SourceSnapshotReads {
  /** One delegate call to the injected exact material reader for a supported ref. */
  async function loadSupported(ref: SupportedSourceRef): Promise<SourceSnapshotResult> {
    const refKey = canonicalJson(ref as unknown as JsonValue);
    let result;
    try {
      result = await deps.authority.load(ref as MaterialCanonicalRef);
    } catch (error) {
      return unavailable(`material authority read failed: ${messageOf(error)}`);
    }
    if (result.status === 'not_found') return { status: 'not_found', ref: structuredClone(ref) };
    if (result.status === 'unavailable') return { status: 'unavailable', reason: result.reason };
    // A provider may only answer `found` for the complete requested ref; anything else is
    // treated as unreadable rather than silently accepted as the requested fact.
    try {
      if (canonicalJson(result.snapshot.ref as unknown as JsonValue) !== refKey) {
        return unavailable('the stored fact does not match the complete requested ref');
      }
    } catch (error) {
      return unavailable(`the stored fact ref is not readable: ${messageOf(error)}`);
    }
    return { status: 'found', snapshot: structuredClone(result.snapshot) as SourceCanonicalSnapshot };
  }

  /**
   * QueryJob has no provider on the material reader; it is loaded through the
   * SAME records with the query codec, so the source factory can re-read the
   * bound Job (running + immutable execution) exactly.
   */
  async function loadQueryJob(ref: QueryJobSourceRef): Promise<SourceSnapshotResult> {
    if (deps.records === undefined) {
      return { status: 'unsupported', reason: 'QueryJob load requires the same WorkGraph records' };
    }
    const refKey = canonicalJson(ref as unknown as JsonValue);
    let read;
    try {
      read = await deps.records.readMany([refKey]);
    } catch (error) {
      return unavailable(`the QueryJob read failed: ${messageOf(error)}`);
    }
    if (read.status !== 'ready') return unavailable(`${read.code}: ${read.reason}`);
    const record = read.value.records.find((candidate) => candidate.refKey === refKey);
    if (record === undefined) {
      if (read.value.missing.includes(refKey)) return { status: 'not_found', ref: structuredClone(ref) };
      return unavailable('the read batch neither returned nor reported missing the QueryJob');
    }
    const decoded = decodeQueryJobSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`the QueryJob snapshot is not decodable: ${decoded.reason}`);
    if (canonicalJson(decoded.value.ref as unknown as JsonValue) !== refKey) {
      return unavailable('the stored QueryJob does not match the complete requested ref');
    }
    return { status: 'found', snapshot: structuredClone(decoded.value) as SourceCanonicalSnapshot };
  }

  return {
    async load(ref) {
      const clean = copyExactRef(ref);
      if (clean === null) return unavailable('the requested source ref is incomplete, ambiguous or not serializable');
      if (clean.aggregateType === 'QueryJob') return loadQueryJob(clean);
      // ReviewWork has no provider here; `unsupported` is a distinct answer,
      // never an empty scan whose absence would look like a missing real fact.
      if (clean.aggregateType === 'ReviewWork') {
        return { status: 'unsupported', reason: 'no source snapshot provider for ReviewWork' };
      }
      return loadSupported(clean);
    },
    async readQuerySubmission(ref) {
      if (deps.records === undefined) {
        return { status: 'rejected', code: 'unsupported', reason: 'readQuerySubmission requires the same WorkGraph records' };
      }
      if (ref === null || ref === undefined || ref.aggregateType !== 'QueryJob'
        || typeof ref.projectId !== 'string' || ref.projectId.length === 0
        || typeof ref.workspaceId !== 'string' || ref.workspaceId.length === 0
        || typeof ref.queryJobId !== 'string' || ref.queryJobId.length === 0) {
        return { status: 'rejected', code: 'invalid', reason: 'readQuerySubmission requires a complete QueryJobRef' };
      }
      const queryJobRef: QueryJobRef = {
        aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId,
      };
      const jobKey = canonicalJson(queryJobRef as unknown as JsonValue);
      let jobRead;
      try {
        jobRead = await deps.records.readMany([jobKey]);
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `the QueryJob read failed: ${messageOf(error)}` };
      }
      if (jobRead.status !== 'ready') {
        return jobRead.code === 'not_found'
          ? { status: 'not_found' }
          : { status: 'rejected', code: 'unavailable', reason: `${jobRead.code}: ${jobRead.reason}` };
      }
      const jobRecord = jobRead.value.records.find((candidate) => candidate.refKey === jobKey);
      if (jobRecord === undefined) {
        if (jobRead.value.missing.includes(jobKey)) return { status: 'not_found' };
        return { status: 'rejected', code: 'unavailable', reason: 'the read batch neither returned nor reported missing the QueryJob' };
      }
      const decodedJob = decodeQueryJobSnapshot(jobRecord);
      if (decodedJob.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `the QueryJob snapshot is not decodable: ${decodedJob.reason}` };
      }
      const job: QueryJobSnapshot = decodedJob.value;
      const submission = job.submission;
      if (submission === undefined) {
        return { status: 'rejected', code: 'unsupported', reason: 'the QueryJob has no exact submission locator' };
      }
      let found;
      try {
        found = await deps.records.lookupCommit({ identityKey: submission.identityKey, fingerprint: submission.fingerprint });
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `the submission idempotency lookup failed: ${messageOf(error)}` };
      }
      if (found.status !== 'ready') {
        if (found.code === 'not_found') return { status: 'not_found' };
        if (found.code === 'idempotency_conflict' || found.code === 'invalid') {
          return { status: 'rejected', code: 'invalid', reason: found.reason };
        }
        return { status: 'rejected', code: 'unavailable', reason: `${found.code}: ${found.reason}` };
      }
      const receipt = found.value;
      if (receipt.eventIds.length !== 1 || receipt.eventIds[0] !== submission.eventId) {
        return { status: 'rejected', code: 'unavailable', reason: 'the submission receipt does not reference the recorded event' };
      }
      let located;
      try {
        located = await deps.records.eventAt(receipt.cursor);
      } catch (error) {
        return { status: 'rejected', code: 'unavailable', reason: `the original QueryJobSubmitted event could not be read: ${messageOf(error)}` };
      }
      if (located.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable', reason: `the original QueryJobSubmitted event is not readable: ${located.code}: ${located.reason}` };
      }
      if (String(located.value.cursor) !== String(receipt.cursor)) {
        return { status: 'rejected', code: 'unavailable', reason: 'eventAt returned a different cursor for the submission receipt' };
      }
      const decoded = decodeQueryJobSubmittedEvent(located.value.event);
      if (decoded.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `the original event is not a legal QueryJobSubmitted@1: ${decoded.reason}` };
      }
      const event = decoded.value;
      if (event.eventId !== submission.eventId) {
        return { status: 'rejected', code: 'unavailable', reason: 'the submission locator points at another event' };
      }
      if (event.identityKey !== submission.identityKey || event.fingerprint !== submission.fingerprint) {
        return { status: 'rejected', code: 'unavailable', reason: 'the original event carries another submission identity' };
      }
      if (event.payload.job.queryJobId !== queryJobRef.queryJobId
        || event.payload.job.projectId !== queryJobRef.projectId
        || event.payload.job.workspaceId !== queryJobRef.workspaceId) {
        return { status: 'rejected', code: 'unavailable', reason: 'the original event belongs to another QueryJob scope' };
      }
      return { status: 'ready', value: event };
    },
  };
}
