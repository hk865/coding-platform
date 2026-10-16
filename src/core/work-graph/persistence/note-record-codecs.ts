/**
 * Slice 4 §2/L1/L3/L6: the ONE owner of the `NoteHead@1`, `NoteVersion@1` and
 * `CurrentPointer@1` records, the `NoteWritten` / `NoteDispositionChanged` /
 * `CurrentPointerMoved` replay events, and the three index groups of L3 (five
 * anchor indexes, the review-status index, the staged-run index). It performs no
 * I/O: the note service and its readers go through these functions. Event shape
 * and strict decoders follow `persistence/run-activity-codecs.ts`.
 */
import type {
  CurrentPointerRef, CurrentPointerSnapshot, NoteHeadRef, NoteHeadSnapshot, NoteKind, NoteReviewReason,
  NoteState, NoteVersionRef, NoteVersionSnapshot, PendingNoteHeadSnapshot, PendingNoteVersionSnapshot,
} from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../../contracts/note.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { WriteNoteResult } from '../model/note-contracts.js';
import { NOTE_EXISTING_TOPICS_MAX } from '../model/note-contracts.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';

export const NOTE_HEAD_SCHEMA_ID = 'NoteHead@1' as const;
export const NOTE_VERSION_SCHEMA_ID = 'NoteVersion@1' as const;
export const CURRENT_POINTER_SCHEMA_ID = 'CurrentPointer@1' as const;
export const NOTE_WRITTEN_EVENT_TYPE = 'NoteWritten' as const;
export const NOTE_DISPOSITION_CHANGED_EVENT_TYPE = 'NoteDispositionChanged' as const;
export const CURRENT_POINTER_MOVED_EVENT_TYPE = 'CurrentPointerMoved' as const;
export const NOTE_EVENT_SCHEMA_VERSION = 1 as const;

/** L3: five by-anchor equality indexes, the review-status index and the staged-run index. */
export const S4_NOTE_BY_ANCHOR_LOOKUPS: readonly string[] = [
  's4-note-by-anchor-0', 's4-note-by-anchor-1', 's4-note-by-anchor-2', 's4-note-by-anchor-3', 's4-note-by-anchor-4',
];
export const S4_NOTE_BY_REVIEW_STATUS_LOOKUP = 's4-note-by-review-status';
export const S4_NOTE_BY_STAGED_RUN_LOOKUP = 's4-note-by-staged-run';
/** Slice 4B P7: five ordered path indexes (one per anchor slot), by `ref.projectId`. */
export const S4B_NOTE_BY_PATH_LOOKUPS: readonly string[] = [
  's4b-note-by-path-0', 's4b-note-by-path-1', 's4b-note-by-path-2', 's4b-note-by-path-3', 's4b-note-by-path-4',
];
/** Slice 4B L10: the one full-text index, on the `NoteHead` comparison text. */
export const S4_NOTE_TEXT_LOOKUP = 's4-note-text';

/** Event header copied from the Slice 2B run-activity codec. */
export type NoteEventHeaderV1 = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  projectId: string; workspaceId: string;
};

/**
 * P9 (R4, item 5): `NoteWritten { head; version; result }`. The head/version are
 * the PRE-BIND snapshots: an event is written before the Store knows the commit
 * cursor, so its `since` is always null. The commit cursor is the receipt cursor
 * (and the bound `since` of the NoteHead/NoteVersion records of the same commit).
 */
export type NoteWrittenEventV1 = NoteEventHeaderV1 & {
  eventType: 'NoteWritten'; head: PendingNoteHeadSnapshot; version: PendingNoteVersionSnapshot; result: NoteWriteSuccessV1;
};

/**
 * Item 5 step 7: the full success `WriteNoteResult` stored verbatim in the
 * NoteWritten event, so a replay returns the ORIGINAL overQuota / warnings /
 * existingTopics instead of rebuilding them (R4).
 */
export type NoteWriteSuccessV1 = Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }>;

/**
 * P9: `NoteDispositionChanged { head; version; acknowledgementRef }` (null in 4A).
 * As in `NoteWrittenEventV1`, the snapshots are pre-bind (`since: null`); the
 * commit cursor is the receipt cursor / the records' bound `since`.
 */
export type NoteDispositionChangedEventV1 = NoteEventHeaderV1 & {
  eventType: 'NoteDispositionChanged'; head: PendingNoteHeadSnapshot; version: PendingNoteVersionSnapshot;
  acknowledgementRef: SessionMessageRef | null;
};

/** P9: `CurrentPointerMoved { pointer }`. */
export type CurrentPointerMovedEventV1 = NoteEventHeaderV1 & {
  eventType: 'CurrentPointerMoved'; pointer: CurrentPointerSnapshot;
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

const NOTE_KINDS: readonly NoteKind[] = [...NOTE_GENERAL_KINDS, 'understanding', 'repair'];
const NOTE_STATES: readonly NoteState[] = ['staged', 'accepted', 'reviewed', 'pending_review', 'rejected', 'superseded',
  'withdrawn'];
const REVIEW_REASONS: readonly NoteReviewReason[] = ['structural', 'contradiction', 'quota_full'];
const DUTIES: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];
const CHANGE_KINDS: readonly NoteVersionSnapshot['change']['kind'][] = ['write', 'review', 'accept', 'reject',
  'withdraw', 'supersede', 'coexist', 'merge'];
const BODY_KEYS: readonly string[] = ['kind', 'topic', 'topicKey', 'conclusion', 'body', 'sections', 'anchor',
  'extraAnchors', 'facts', 'basis', 'structural', 'replaces', 'contradicts', 'coexistWith'];
const HEAD_KEYS: readonly string[] = [...BODY_KEYS, 'ref', 'noteId', 'version', 'state', 'goalId', 'source',
  'stagedRunKey', 'reviewReasons', 'confirmedByUser', 'anchorKey0', 'anchorKey1', 'anchorKey2', 'anchorKey3',
  'anchorKey4', 'createdAt', 'since', 'revision'];
const VERSION_KEYS: readonly string[] = [...BODY_KEYS, 'ref', 'noteId', 'version', 'state', 'goalId', 'source',
  'reviewReasons', 'change', 'at', 'since', 'revision'];

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function invalid<T>(reason: string): DecodeResult<T> {
  return { status: 'invalid', reason };
}
function isCursorOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^c\d{10}$/.test(value));
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
function sessionRefProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return `${label} must be a complete SessionRef`;
  }
  return null;
}
function runRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['runId'])) {
    return 'runRef must be a complete RunRef';
  }
  return null;
}
function sessionMessageRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
    || value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])
    || !nonEmpty(value['messageId'])) {
    return 'acknowledgementRef must be a complete SessionMessageRef';
  }
  return null;
}

// --------------------------------------------------------------------------
// Anchor, source, body
// --------------------------------------------------------------------------

function symbolLocatorProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['language', 'qualifiedName', 'signatureDigest', 'range', 'fileDigest'])) {
    return 'file anchor symbol carries unknown fields';
  }
  if (!nonEmpty(value['language']) || !nonEmpty(value['qualifiedName']) || !nonEmpty(value['signatureDigest'])
    || !nonEmpty(value['fileDigest'])) {
    return 'file anchor symbol needs language, qualifiedName, signatureDigest and fileDigest';
  }
  return rangeProblem(value['range'], 'file anchor symbol range');
}
function rangeProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['startLine', 'endLine'])) return `${label} must be a range`;
  const start = value['startLine'];
  const end = value['endLine'];
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 1 || end < start) {
    return `${label} must be a positive, ordered line range`;
  }
  return null;
}
function noteAnchorProblem(value: unknown): string | null {
  if (!isObject(value) || typeof value['kind'] !== 'string') return 'anchor must be an object with a kind';
  switch (value['kind']) {
    case 'module':
      return nonEmpty(value['moduleId']) && hasOnlyKeys(value, ['kind', 'moduleId']) ? null : 'module anchor is invalid';
    case 'interface':
      return nonEmpty(value['moduleId']) && nonEmpty(value['interfaceId'])
        && hasOnlyKeys(value, ['kind', 'moduleId', 'interfaceId']) ? null : 'interface anchor is invalid';
    case 'file': {
      if (!nonEmpty(value['path'])) return 'file anchor path is required';
      if (value['deleted'] !== undefined && value['deleted'] !== true) return 'file anchor deleted must be true';
      if (!hasOnlyKeys(value, ['kind', 'path', 'symbol', 'deleted'])) return 'file anchor carries unknown fields';
      return value['symbol'] === undefined ? null : symbolLocatorProblem(value['symbol']);
    }
    case 'goal':
      return nonEmpty(value['goalId']) && hasOnlyKeys(value, ['kind', 'goalId']) ? null : 'goal anchor is invalid';
    case 'stage':
      return nonEmpty(value['goalId']) && nonEmpty(value['stageId']) && isPositiveSafeInteger(value['planRevision'])
        && hasOnlyKeys(value, ['kind', 'goalId', 'planRevision', 'stageId']) ? null : 'stage anchor is invalid';
    case 'task':
      return nonEmpty(value['goalId']) && nonEmpty(value['taskId']) && hasOnlyKeys(value, ['kind', 'goalId', 'taskId'])
        ? null : 'task anchor is invalid';
    case 'project':
      return hasOnlyKeys(value, ['kind']) ? null : 'project anchor carries unknown fields';
    default:
      return 'anchor kind is not recognized';
  }
}
function sourceProblem(value: unknown, label: string): string | null {
  if (!isObject(value)) return `${label} must be a NoteSourceV1`;
  if (value['kind'] === 'platform') return hasOnlyKeys(value, ['kind']) ? null : `${label} platform carries unknown fields`;
  if (value['kind'] === 'user') {
    return nonEmpty(value['principalId']) && hasOnlyKeys(value, ['kind', 'principalId']) ? null : `${label} user is invalid`;
  }
  if (value['kind'] === 'agent') {
    if (!hasOnlyKeys(value, ['kind', 'sessionRef', 'runRef', 'duty'])) return `${label} agent carries unknown fields`;
    const session = sessionRefProblem(value['sessionRef'], `${label} agent sessionRef`);
    if (session !== null) return session;
    if (value['runRef'] !== null) {
      const run = runRefProblem(value['runRef']);
      if (run !== null) return run;
    }
    if (!DUTIES.includes(value['duty'] as PlatformDutyV1)) return `${label} agent duty is not recognized`;
    return null;
  }
  return `${label} kind is not recognized`;
}
export function factProblem(value: unknown): string | null {
  if (!isObject(value) || typeof value['kind'] !== 'string') return 'facts entries must be objects with a kind';
  switch (value['kind']) {
    case 'record':
      return isObject(value['ref']) && nonEmpty((value['ref'] as UnknownRecord)['aggregateType'])
        && isPositiveSafeInteger(value['revision'])
        && (value['digest'] === null || typeof value['digest'] === 'string') ? null : 'record fact is invalid';
    case 'artifact':
      return isObject(value['ref']) && isObject(value['provenance']) ? null : 'artifact fact is invalid';
    case 'kernel_history':
      return nonEmpty(value['adapterId']) && nonEmpty(value['kernelSessionId']) && nonEmpty(value['kernelRunId'])
        && nonEmpty(value['turnId']) && typeof value['fromPosition'] === 'number' && typeof value['throughPosition'] === 'number'
        && isObject(value['runRef']) && isObject(value['sessionRef']) ? null : 'kernel_history fact is invalid';
    case 'note':
      return nonEmpty(value['noteId']) && isPositiveSafeInteger(value['version']) ? null : 'note fact is invalid';
    case 'file':
      return nonEmpty(value['path']) && typeof value['digest'] === 'string' ? null : 'file fact is invalid';
    case 'commit':
      // L22: the codec and the write gate check only the pointer's SHAPE; the
      // 40/64-hex format is 4B's check (`invalid_commit_format`), never 4A's.
      return typeof value['sha'] === 'string' && hasOnlyKeys(value, ['kind', 'sha'])
        ? null : 'commit fact sha is invalid';
    default:
      return 'fact kind is not recognized';
  }
}
function sectionsProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['status', 'decided', 'open', 'next', 'risks'])) {
    return 'understanding sections carry unknown fields';
  }
  for (const key of ['status', 'decided', 'open', 'next', 'risks'] as const) {
    if (!nonEmpty(value[key])) return `understanding sections.${key} must be a non-empty string`;
  }
  return null;
}
function basisProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['planRevision', 'catalogRevision', 'files'])) return 'basis is invalid';
  if (!(value['planRevision'] === null || isPositiveSafeInteger(value['planRevision']))) return 'basis.planRevision is invalid';
  if (!(value['catalogRevision'] === null || isPositiveSafeInteger(value['catalogRevision']))) return 'basis.catalogRevision is invalid';
  if (!Array.isArray(value['files'])) return 'basis.files must be an array';
  for (const file of value['files']) {
    if (!isObject(file) || !nonEmpty(file['path']) || typeof file['digest'] !== 'string') return 'basis.files entries are invalid';
  }
  return null;
}
function bodyProblem(body: UnknownRecord, label: string): string | null {
  const kind = body['kind'];
  if (!NOTE_KINDS.includes(kind as NoteKind)) return `${label}.kind is not recognized`;
  if (!nonEmpty(body['topic']) || !nonEmpty(body['topicKey']) || !nonEmpty(body['conclusion'])) {
    return `${label} needs non-empty topic, topicKey and conclusion`;
  }
  if (typeof body['body'] !== 'string') return `${label}.body must be a string`;
  if (body['sections'] !== undefined) {
    if (kind !== 'understanding') return `${label}.sections is only for understanding`;
    const sections = sectionsProblem(body['sections']);
    if (sections !== null) return sections;
  } else if (kind === 'understanding') {
    return `${label}.sections is required for understanding`;
  }
  const anchor = noteAnchorProblem(body['anchor']);
  if (anchor !== null) return `${label}.anchor: ${anchor}`;
  if (!Array.isArray(body['extraAnchors'])) return `${label}.extraAnchors must be an array`;
  for (const extra of body['extraAnchors']) {
    const problem = noteAnchorProblem(extra);
    if (problem !== null) return `${label}.extraAnchors: ${problem}`;
  }
  if (!Array.isArray(body['facts'])) return `${label}.facts must be an array`;
  for (const fact of body['facts']) {
    const problem = factProblem(fact);
    if (problem !== null) return `${label}.facts: ${problem}`;
  }
  const basis = basisProblem(body['basis']);
  if (basis !== null) return `${label}.${basis}`;
  if (typeof body['structural'] !== 'boolean') return `${label}.structural must be a boolean`;
  for (const field of ['replaces', 'contradicts', 'coexistWith'] as const) {
    if (!isStringArray(body[field])) return `${label}.${field} must be a string array`;
  }
  return null;
}
function reviewReasonsProblem(value: unknown, label: string): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`;
  for (const reason of value) {
    if (!REVIEW_REASONS.includes(reason as NoteReviewReason)) return `${label} has an unrecognized reason`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Record bodies and encode/decode (pure; no Store access)
// --------------------------------------------------------------------------

export function noteHeadRefKey(ref: NoteHeadRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
export function noteVersionRefKey(ref: NoteVersionRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
export function currentPointerRefKey(ref: CurrentPointerRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

function noteHeadBodyProblem(body: UnknownRecord, sinceMode: 'bound' | 'null', requireEnvelopeRevision: boolean): string | null {
  if (!hasOnlyKeys(body, HEAD_KEYS)) return 'NoteHead record carries unknown fields';
  const ref = body['ref'];
  if (!isObject(ref) || ref['aggregateType'] !== 'NoteHead' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['noteId'])
    || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'noteId'])) return 'NoteHead ref is invalid';
  if (!nonEmpty(body['noteId']) || body['noteId'] !== ref['noteId']) return 'NoteHead noteId disagrees with its ref';
  if (!isPositiveSafeInteger(body['version'])) return 'NoteHead version must be a positive safe integer';
  // The RecordStore envelope (record-codec.ts) needs a top-level `revision`; the
  // head binds it to its own version so the RecordGuard CAS is the version guard.
  if (requireEnvelopeRevision && (!isPositiveSafeInteger(body['revision']) || body['revision'] !== body['version'])) {
    return 'NoteHead revision must be a positive safe integer equal to its version';
  }
  if (!NOTE_STATES.includes(body['state'] as NoteState)) return 'NoteHead state is not recognized';
  if (!(body['goalId'] === null || nonEmpty(body['goalId']))) return 'NoteHead goalId must be null or a string';
  const source = sourceProblem(body['source'], 'NoteHead source');
  if (source !== null) return source;
  if (!(body['stagedRunKey'] === null || nonEmpty(body['stagedRunKey']))) return 'NoteHead stagedRunKey must be null or a string';
  // L3: only a `staged` head carries the staging run; every other state is null.
  // Item 9a has landed (a human repair is forbidden), so the converse holds too:
  // a staged head (an agent/scribe repair) always names the run that staged it.
  if (body['state'] !== 'staged' && body['stagedRunKey'] !== null) {
    return 'NoteHead stagedRunKey is only for a staged note';
  }
  if (body['state'] === 'staged' && body['stagedRunKey'] === null) {
    return 'NoteHead stagedRunKey is required for a staged note';
  }
  const reasons = reviewReasonsProblem(body['reviewReasons'], 'NoteHead reviewReasons');
  if (reasons !== null) return reasons;
  if (typeof body['confirmedByUser'] !== 'boolean') return 'NoteHead confirmedByUser must be a boolean';
  for (const field of ['anchorKey0', 'anchorKey1', 'anchorKey2', 'anchorKey3', 'anchorKey4'] as const) {
    if (!(field === 'anchorKey0' ? nonEmpty(body[field]) : body[field] === null || nonEmpty(body[field]))) {
      return `NoteHead ${field} is invalid`;
    }
  }
  if (!nonEmpty(body['createdAt'])) return 'NoteHead createdAt is required';
  // A record carries the bound commit cursor; an event's pre-bind snapshot is
  // strictly null (item 11c — the commit cursor is the receipt cursor instead).
  if (sinceMode === 'bound') {
    if (!isCursorOrNull(body['since']) || !nonEmpty(body['since'])) {
      return 'NoteHead since must be a ledger commit cursor';
    }
  } else if (body['since'] !== null) {
    return 'NoteHead event snapshot since must be null';
  }
  return bodyProblem(body, 'NoteHead');
}

function noteVersionBodyProblem(body: UnknownRecord, sinceMode: 'bound' | 'null', requireEnvelopeRevision: boolean): string | null {
  if (!hasOnlyKeys(body, VERSION_KEYS)) return 'NoteVersion record carries unknown fields';
  const ref = body['ref'];
  if (!isObject(ref) || ref['aggregateType'] !== 'NoteVersion' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['noteId'])
    || !isPositiveSafeInteger(ref['version']) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'noteId', 'version'])) {
    return 'NoteVersion ref is invalid';
  }
  if (!nonEmpty(body['noteId']) || body['noteId'] !== ref['noteId']) return 'NoteVersion noteId disagrees with its ref';
  if (!isPositiveSafeInteger(body['version']) || body['version'] !== ref['version']) {
    return 'NoteVersion version disagrees with its ref';
  }
  // A version row is immutable, so its envelope revision is always 1.
  if (requireEnvelopeRevision && body['revision'] !== 1) {
    return 'NoteVersion revision must be 1';
  }
  if (!NOTE_STATES.includes(body['state'] as NoteState)) return 'NoteVersion state is not recognized';
  if (!(body['goalId'] === null || nonEmpty(body['goalId']))) return 'NoteVersion goalId must be null or a string';
  const source = sourceProblem(body['source'], 'NoteVersion source');
  if (source !== null) return source;
  const reasons = reviewReasonsProblem(body['reviewReasons'], 'NoteVersion reviewReasons');
  if (reasons !== null) return reasons;
  const change = body['change'];
  if (!isObject(change) || !hasOnlyKeys(change, ['kind', 'by', 'reason', 'decisionMessageRef'])
    || !CHANGE_KINDS.includes(change['kind'] as NoteVersionSnapshot['change']['kind'])) return 'NoteVersion change is invalid';
  const by = sourceProblem(change['by'], 'NoteVersion change.by');
  if (by !== null) return by;
  if (!(change['reason'] === null || nonEmpty(change['reason']))) return 'NoteVersion change.reason must be null or a string';
  if (change['decisionMessageRef'] !== null) {
    const decision = sessionMessageRefProblem(change['decisionMessageRef']);
    if (decision !== null) return `NoteVersion change.${decision}`;
  }
  if (!nonEmpty(body['at'])) return 'NoteVersion at is required';
  // A record carries the bound commit cursor; an event's pre-bind snapshot is
  // strictly null (item 11c — the commit cursor is the receipt cursor instead).
  if (sinceMode === 'bound') {
    if (!isCursorOrNull(body['since']) || !nonEmpty(body['since'])) {
      return 'NoteVersion since must be a ledger commit cursor';
    }
  } else if (body['since'] !== null) {
    return 'NoteVersion event snapshot since must be null';
  }
  return bodyProblem(body, 'NoteVersion');
}

function currentPointerBodyProblem(body: UnknownRecord): string | null {
  if (!hasOnlyKeys(body, ['ref', 'anchorKey', 'noteId', 'revision'])) return 'CurrentPointer record carries unknown fields';
  const ref = body['ref'];
  if (!isObject(ref) || ref['aggregateType'] !== 'CurrentPointer' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['anchorKey'])
    || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'anchorKey'])) return 'CurrentPointer ref is invalid';
  if (!nonEmpty(body['anchorKey']) || body['anchorKey'] !== ref['anchorKey']) {
    return 'CurrentPointer anchorKey disagrees with its ref';
  }
  if (!(body['noteId'] === null || nonEmpty(body['noteId']))) return 'CurrentPointer noteId must be null or a string';
  if (!isPositiveSafeInteger(body['revision'])) return 'CurrentPointer revision must be a positive safe integer';
  return null;
}

export function encodeNoteHeadSnapshot(snapshot: PendingNoteHeadSnapshot): EncodedRecord {
  return {
    refKey: noteHeadRefKey(snapshot.ref),
    schemaId: NOTE_HEAD_SCHEMA_ID,
    revision: snapshot.version,
    // Wire-only envelope revision, required by record-codec.ts; the head keeps
    // the version guard through it and the strict decoder reads it back.
    json: JSON.stringify({ ...snapshot, revision: snapshot.version }),
  };
}

export function decodeNoteHeadSnapshot(record: EncodedRecord): DecodeResult<NoteHeadSnapshot> {
  if (record.schemaId !== NOTE_HEAD_SCHEMA_ID) return invalid(`expected schemaId ${NOTE_HEAD_SCHEMA_ID}, got ${record.schemaId}`);
  const body = parseObject(record.json);
  if (body === null) return invalid('NoteHead record json is not an object');
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) return invalid('NoteHead refKey disagrees with the record body');
  if (body['version'] !== record.revision) return invalid('NoteHead record revision disagrees with its version');
  const problem = noteHeadBodyProblem(body, 'bound', true);
  if (problem !== null) return invalid(`NoteHead record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as NoteHeadSnapshot };
}

export function encodeNoteVersionSnapshot(snapshot: PendingNoteVersionSnapshot): EncodedRecord {
  return {
    refKey: noteVersionRefKey(snapshot.ref),
    schemaId: NOTE_VERSION_SCHEMA_ID,
    revision: 1,
    json: JSON.stringify({ ...snapshot, revision: 1 }),
  };
}

export function decodeNoteVersionSnapshot(record: EncodedRecord): DecodeResult<NoteVersionSnapshot> {
  if (record.schemaId !== NOTE_VERSION_SCHEMA_ID) {
    return invalid(`expected schemaId ${NOTE_VERSION_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('NoteVersion record json is not an object');
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) return invalid('NoteVersion refKey disagrees with the record body');
  if (body['revision'] !== record.revision) return invalid('NoteVersion record revision disagrees with its revision');
  const problem = noteVersionBodyProblem(body, 'bound', true);
  if (problem !== null) return invalid(`NoteVersion record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as NoteVersionSnapshot };
}

export function encodeCurrentPointerSnapshot(snapshot: CurrentPointerSnapshot): EncodedRecord {
  return {
    refKey: currentPointerRefKey(snapshot.ref),
    schemaId: CURRENT_POINTER_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function decodeCurrentPointerSnapshot(record: EncodedRecord): DecodeResult<CurrentPointerSnapshot> {
  if (record.schemaId !== CURRENT_POINTER_SCHEMA_ID) {
    return invalid(`expected schemaId ${CURRENT_POINTER_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('CurrentPointer record json is not an object');
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) return invalid('CurrentPointer refKey disagrees with the record body');
  if (body['revision'] !== record.revision) return invalid('CurrentPointer record revision disagrees with its revision');
  const problem = currentPointerBodyProblem(body);
  if (problem !== null) return invalid(`CurrentPointer record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as CurrentPointerSnapshot };
}

// --------------------------------------------------------------------------
// Replay events (P9)
// --------------------------------------------------------------------------

function eventEnvelopeProblem(event: EncodedDomainEvent, body: UnknownRecord, eventType: string,
  keys: readonly string[]): string | null {
  if (event.eventType !== eventType) return `expected eventType ${eventType}, got ${event.eventType}`;
  if (event.schemaVersion !== NOTE_EVENT_SCHEMA_VERSION) {
    return `expected schemaVersion ${String(NOTE_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return `${eventType} envelope is incomplete`;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return `${eventType} envelope disagrees with the event json`;
  }
  if (!hasOnlyKeys(body, keys)) return `${eventType} carries unknown fields`;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) return `${eventType} requires projectId and workspaceId`;
  return null;
}

export function encodeNoteWrittenEvent(event: NoteWrittenEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

const NOTE_WRITE_STATUSES: readonly NoteState[] = ['accepted', 'pending_review', 'staged'];
const NOTE_WRITE_WARNINGS: readonly string[] = ['symbol_unresolved', 'anchor_ended'];

/**
 * Item 5 step 7 / R4: the strict `NoteWritten.result` check. It must agree with
 * the written head (status, noteId, version, reasons, confirmedByUser) and stay
 * inside the success shape (`overQuota` boolean, the two warning codes, at most
 * `NOTE_EXISTING_TOPICS_MAX` `{anchorKey, topic, count >= 1}` topics).
 */
function noteWriteResultProblem(value: unknown, head: UnknownRecord): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['status', 'noteId', 'version', 'reasons', 'overQuota',
    'confirmedByUser', 'warnings', 'existingTopics'])) {
    return 'NoteWritten result carries unknown fields';
  }
  if (!NOTE_WRITE_STATUSES.includes(value['status'] as NoteState)) {
    return 'NoteWritten result status is not recognized';
  }
  if (value['status'] !== head['state']) return 'NoteWritten result status disagrees with the head';
  if (!nonEmpty(value['noteId']) || value['noteId'] !== head['noteId']) {
    return 'NoteWritten result noteId disagrees with the head';
  }
  if (!isPositiveSafeInteger(value['version']) || value['version'] !== head['version']) {
    return 'NoteWritten result version disagrees with the head';
  }
  if (!Array.isArray(value['reasons']) || !value['reasons'].every(reason => REVIEW_REASONS.includes(reason as NoteReviewReason))
    || canonicalOf(value['reasons']) !== canonicalOf(head['reviewReasons'])) {
    return 'NoteWritten result reasons disagree with the head';
  }
  if (value['confirmedByUser'] !== head['confirmedByUser']) {
    return 'NoteWritten result confirmedByUser disagrees with the head';
  }
  if (typeof value['overQuota'] !== 'boolean') return 'NoteWritten result overQuota must be a boolean';
  const warnings = value['warnings'];
  if (!Array.isArray(warnings) || !warnings.every(warning => NOTE_WRITE_WARNINGS.includes(warning as string))) {
    return 'NoteWritten result warnings are not recognized';
  }
  const topics = value['existingTopics'];
  if (!Array.isArray(topics) || topics.length > NOTE_EXISTING_TOPICS_MAX) {
    return 'NoteWritten result existingTopics is invalid';
  }
  for (const topic of topics) {
    if (!isObject(topic) || !hasOnlyKeys(topic, ['anchorKey', 'topic', 'count']) || !nonEmpty(topic['anchorKey'])
      || !nonEmpty(topic['topic']) || !isPositiveSafeInteger(topic['count'])) {
      return 'NoteWritten result existingTopics entries are invalid';
    }
  }
  return null;
}

export function noteWrittenEventFromEvent(event: EncodedDomainEvent): DecodeResult<NoteWrittenEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('NoteWritten event json is not an object');
  const envelope = eventEnvelopeProblem(event, body, NOTE_WRITTEN_EVENT_TYPE, ['eventId', 'eventType', 'schemaVersion',
    'occurredAt', 'projectId', 'workspaceId', 'head', 'version', 'result']);
  if (envelope !== null) return invalid(envelope);
  const head = body['head'];
  const version = body['version'];
  if (!isObject(head) || !isObject(version)) return invalid('NoteWritten requires the written head and version');
  const headProblem = noteHeadBodyProblem(head, 'null', false);
  if (headProblem !== null) return invalid(`NoteWritten head is invalid: ${headProblem}`);
  const versionProblem = noteVersionBodyProblem(version, 'null', false);
  if (versionProblem !== null) return invalid(`NoteWritten version is invalid: ${versionProblem}`);
  if ((head['ref'] as UnknownRecord)['projectId'] !== body['projectId']) {
    return invalid('NoteWritten head scope disagrees with the event');
  }
  const resultProblem = noteWriteResultProblem(body['result'], head);
  if (resultProblem !== null) return invalid(`NoteWritten result is invalid: ${resultProblem}`);
  return { status: 'decoded', value: body as unknown as NoteWrittenEventV1 };
}

export function encodeNoteDispositionChangedEvent(event: NoteDispositionChangedEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function noteDispositionChangedEventFromEvent(event: EncodedDomainEvent):
DecodeResult<NoteDispositionChangedEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('NoteDispositionChanged event json is not an object');
  const envelope = eventEnvelopeProblem(event, body, NOTE_DISPOSITION_CHANGED_EVENT_TYPE, ['eventId', 'eventType',
    'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'head', 'version', 'acknowledgementRef']);
  if (envelope !== null) return invalid(envelope);
  const head = body['head'];
  const version = body['version'];
  if (!isObject(head) || !isObject(version)) return invalid('NoteDispositionChanged requires the changed head and version');
  const headProblem = noteHeadBodyProblem(head, 'null', false);
  if (headProblem !== null) return invalid(`NoteDispositionChanged head is invalid: ${headProblem}`);
  const versionProblem = noteVersionBodyProblem(version, 'null', false);
  if (versionProblem !== null) return invalid(`NoteDispositionChanged version is invalid: ${versionProblem}`);
  if (body['acknowledgementRef'] !== null) {
    const acknowledgement = sessionMessageRefProblem(body['acknowledgementRef']);
    if (acknowledgement !== null) return invalid(`NoteDispositionChanged ${acknowledgement}`);
  }
  return { status: 'decoded', value: body as unknown as NoteDispositionChangedEventV1 };
}

export function encodeCurrentPointerMovedEvent(event: CurrentPointerMovedEventV1): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function currentPointerMovedEventFromEvent(event: EncodedDomainEvent): DecodeResult<CurrentPointerMovedEventV1> {
  const body = parseObject(event.json);
  if (body === null) return invalid('CurrentPointerMoved event json is not an object');
  const envelope = eventEnvelopeProblem(event, body, CURRENT_POINTER_MOVED_EVENT_TYPE, ['eventId', 'eventType',
    'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'pointer']);
  if (envelope !== null) return invalid(envelope);
  const pointer = body['pointer'];
  if (!isObject(pointer)) return invalid('CurrentPointerMoved requires the moved pointer');
  const problem = currentPointerBodyProblem(pointer);
  if (problem !== null) return invalid(`CurrentPointerMoved pointer is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as CurrentPointerMovedEventV1 };
}

// --------------------------------------------------------------------------
// The single registration group (L3)
// --------------------------------------------------------------------------

/**
 * S2.4/S2.1: the one NoteHead comparison-text path list, shared by the
 * full-text registration and the read model's scoped candidates.
 */
export const NOTE_TEXT_PATHS = ['topic', 'conclusion', 'body'] as const;

const NOTE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  ...S4_NOTE_BY_ANCHOR_LOOKUPS.map((name, ordinal) => ({
    name, aggregateType: 'NoteHead', paths: ['ref.projectId', `anchorKey${String(ordinal)}`],
  })),
  { name: S4_NOTE_BY_REVIEW_STATUS_LOOKUP, aggregateType: 'NoteHead',
    paths: ['ref.projectId', 'goalId', 'state'] },
  { name: S4_NOTE_BY_STAGED_RUN_LOOKUP, aggregateType: 'NoteHead',
    paths: ['ref.projectId', 'stagedRunKey'] },
  // Slice 4B P7: the five ordered path indexes, one per anchor slot. Range-read
  // from a file anchor key and stopped at the directory boundary in code.
  ...S4B_NOTE_BY_PATH_LOOKUPS.map((name, ordinal) => ({
    name, aggregateType: 'NoteHead', paths: ['ref.projectId'], orderBy: { path: `anchorKey${String(ordinal)}` },
  })),
  // Slice 4B L10: the one full-text registration (`topic`/`conclusion`/`body`).
  { name: S4_NOTE_TEXT_LOOKUP, aggregateType: 'NoteHead', paths: ['ref.projectId'],
    text: { paths: NOTE_TEXT_PATHS } },
];

export const NOTE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: NOTE_HEAD_SCHEMA_ID, aggregateType: 'NoteHead', commitCursorFields: ['since'],
      validate: (record) => {
        const decoded = decodeNoteHeadSnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      } },
    { schemaId: NOTE_VERSION_SCHEMA_ID, aggregateType: 'NoteVersion', commitCursorFields: ['since'],
      validate: (record) => {
        const decoded = decodeNoteVersionSnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      } },
    { schemaId: CURRENT_POINTER_SCHEMA_ID, aggregateType: 'CurrentPointer',
      validate: (record) => {
        const decoded = decodeCurrentPointerSnapshot(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      } },
  ],
  events: [
    { eventType: NOTE_WRITTEN_EVENT_TYPE, schemaVersion: NOTE_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = noteWrittenEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      } },
    { eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, schemaVersion: NOTE_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = noteDispositionChangedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      } },
    { eventType: CURRENT_POINTER_MOVED_EVENT_TYPE, schemaVersion: NOTE_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = currentPointerMovedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      } },
  ],
  lookups: NOTE_LOOKUP_INDEXES,
};
