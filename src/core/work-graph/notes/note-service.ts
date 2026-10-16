/**
 * Slice 4A L4–L8/L18: the ONE note writer. It resolves the trusted caller and
 * source (L5), runs the format/anchor/relation/same-topic/quota gates (L4), asks
 * the pure `state/note-machine.ts` for the admission disposition and writes the
 * head, its version, the superseded heads' versions, the current pointer and the
 * three event kinds in ONE RecordStore commit. Reads go through
 * `notes/note-read-model.ts`; this file never reads the database to answer a test.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  CurrentPointerRef, CurrentPointerSnapshot, NoteDraftV1, NoteHeadSnapshot, NoteReviewReason,
  NoteSourceV1, NoteState, NoteVersionSnapshot,
} from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../../contracts/note.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RoleConfigurationRef, SessionRef } from '../../../contracts/core/identity.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type {
  NoteAnchorFactsDeps, NoteAnchorWorkspace, ResolvedNoteAnchors,
} from './note-anchors.js';
import { anchorFormatProblem, anchorKeyOf, conclusionProblem, isSafeRelativePath, normalizePath, resolveNoteAnchors, topicKeyOf, topicProblem } from './note-anchors.js';
import type { ScribeScope } from './scribe-scope.js';
import { sourceIsAuthorOf } from './scribe-scope.js';
import { mapStoreFailure, readAllHeads, type ReadFailureCode } from './note-read-model.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type {
  NoteDispositionResult, NoteDutyResolver, NoteErrorCode, NoteExistingTopicV1, NoteWritePort, WriteNoteInput,
  WriteNoteResult,
} from '../model/note-contracts.js';
import {
  NOTE_ANCHOR_QUOTA, NOTE_BASIS_FILES_MAX, NOTE_BASIS_FILE_MAX_BYTES, NOTE_BODY_MAX_BYTES, NOTE_EXISTING_TOPICS_MAX,
  NOTE_EXTRA_ANCHORS_MAX, NOTE_FACTS_MAX, NOTE_GOAL_QUOTA, NOTE_SYMBOL_HITS_MAX, UNDERSTANDING_BODY_MAX_BYTES,
} from '../model/note-contracts.js';
import type { GoalRecordTransactionPort, EncodedRecord, EncodedDomainEvent, PreparedCommit, RecordGuard, StoreCommitReceipt } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import {
  CURRENT_POINTER_MOVED_EVENT_TYPE, CURRENT_POINTER_SCHEMA_ID, NOTE_DISPOSITION_CHANGED_EVENT_TYPE,
  NOTE_EVENT_SCHEMA_VERSION, NOTE_WRITTEN_EVENT_TYPE, S4_NOTE_BY_ANCHOR_LOOKUPS,
  S4_NOTE_BY_REVIEW_STATUS_LOOKUP, currentPointerRefKey, decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot,
  encodeCurrentPointerMovedEvent, encodeCurrentPointerSnapshot,
  encodeNoteDispositionChangedEvent, encodeNoteHeadSnapshot, encodeNoteVersionSnapshot, encodeNoteWrittenEvent,
  factProblem, noteDispositionChangedEventFromEvent, noteHeadRefKey, noteVersionRefKey, noteWrittenEventFromEvent,
} from '../persistence/note-record-codecs.js';
import {
  admitNoteWrite, moveCurrentPointerRecord, newCurrentPointerRecord, newNoteHeadRecord, newNoteVersionRecord,
  noteWriteAuthority, transitionNote, type NoteDispositionEventV1,
} from '../state/note-machine.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { reworkActorClassOf } from '../../../contracts/task-requeue.js';

/**
 * The trusted Run→Session facts the composition root resolves for a work_run
 * caller (the public execution reader is Host-only). `notes` may not import
 * `materials`, so the composition injects the reader; it returns the bounded,
 * already-scoped facts and never a Host capability.
 */
export type NoteRunFactResolver = (ctx: CoreCallContext, runRef: RunRef) =>
  Promise<ReadResult<{ goalId: string; sessionRef: SessionRef; role: RoleConfigurationRef; planRef: PlanRevisionRef }>>;

export type NoteServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  duties: NoteDutyResolver;
  runFacts: NoteRunFactResolver;
  workspace: NoteAnchorWorkspace;
  workspaceMaxFileBytes: number;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  scopes?: ScribeScope;
  now(): string;
  eventId(): string;
  newId(): string;
  /** P4 injection points (tests shrink the soft quota); production uses the spec constants. */
  anchorQuota?: number;
  goalQuota?: number;
  /** Item 14: the injectable L14 symbol-scan cap; production uses `NOTE_SYMBOL_HITS_MAX`. */
  symbolHitsMax?: number;
  basisFileMaxBytes?: number;
};

type Rejected = { status: 'rejected'; code: NoteErrorCode; reason: string };
const rejected = (code: NoteErrorCode, reason: string): Rejected => ({ status: 'rejected', code, reason });
const forbidden = (reason: string): Rejected => rejected('forbidden', reason);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow a core error to the note port's closed code set (unknown → unavailable). */
function noteCodeOf(code: string): NoteErrorCode {
  return code === 'invalid' || code === 'forbidden' || code === 'not_found' || code === 'revision_conflict'
    || code === 'unavailable' || code === 'unsupported' ? code : 'unavailable';
}

function codepointLength(value: string): number { return [...value].length; }

// --------------------------------------------------------------------------
// Trusted caller and source (L5)
// --------------------------------------------------------------------------

type Caller = {
  source: NoteSourceV1;
  isUser: boolean;
  goalId: string | null;
  duty: string | null;
  sessionRef: SessionRef | null;
  /** Item 6: the Run-bound plan for a work_run caller, `null` for a user. */
  planRef: PlanRevisionRef | null;
};

async function resolveCaller(ctx: CoreCallContext, input: WriteNoteInput, deps: NoteServiceDependencies):
Promise<{ ok: true; value: Caller } | { ok: false; rejection: Rejected }> {
  const principal = ctx.principal;
  if (principal.kind === 'query_run') return { ok: false, rejection: forbidden('a read-only copy cannot write a note') };
  if (principal.kind === 'host') {
    const actor = principal.actor;
    const actorClass = reworkActorClassOf(principal, actor);
    if (actorClass !== 'human') return { ok: false, rejection: forbidden('a system actor cannot write a note') };
    return { ok: true, value: { source: { kind: 'user', principalId: actor.id }, isUser: true,
      goalId: input.goalId, duty: null, sessionRef: null, planRef: null } };
  }
  // work_run: the trusted execution fixes the goal, the Session and the duty.
  // The public execution reader is Host-only, so the composition root injects
  // the Run's own claim-linked Session facts (`NoteRunFactResolver`).
  const runRef = principal.runRef;
  const facts = await deps.runFacts(ctx, runRef);
  if (facts.status !== 'ready') {
    return { ok: false, rejection: facts.status === 'rejected'
      ? rejected(facts.code === 'forbidden' ? 'forbidden' : 'unavailable', facts.reason)
      : rejected('unavailable', 'the caller Run is not readable') };
  }
  // Item 3 fix 4: a resolver rejection or a throw is a read failure, never
  // `forbidden`; only a ready `'unknown'` (R12: the frozen resolver maps a
  // failed RoleSpec read to `'unknown'`) stays `forbidden`.
  let resolved: Awaited<ReturnType<NoteServiceDependencies['duties']>>;
  try {
    resolved = await deps.duties(facts.value.role, ctx);
  } catch {
    return { ok: false, rejection: rejected('unavailable', 'the caller duty cannot be read') };
  }
  if (resolved.status !== 'ready') {
    return { ok: false, rejection: resolved.status === 'rejected'
      ? rejected('unavailable', resolved.reason)
      : rejected('unavailable', 'the caller duty cannot be read') };
  }
  const duty = resolved.value;
  if (duty === 'reviewer' || duty === 'unknown') {
    return { ok: false, rejection: forbidden('the caller has no duty that may write a note') };
  }
  return { ok: true, value: { source: { kind: 'agent', sessionRef: facts.value.sessionRef, runRef,
    duty: duty as never }, isUser: false, goalId: facts.value.goalId, duty, sessionRef: facts.value.sessionRef,
    planRef: facts.value.planRef } };
}

// --------------------------------------------------------------------------
// Record reads
// --------------------------------------------------------------------------

async function readHead(deps: NoteServiceDependencies, projectId: string, noteId: string):
Promise<{ ok: true; record: EncodedRecord | null; head: NoteHeadSnapshot | null } | { ok: false; rejection: Rejected }> {
  const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
  const read = await deps.records.readMany([refKey]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find(candidate => candidate.refKey === refKey) ?? null;
  if (record === null) return { ok: true, record: null, head: null };
  const decoded = decodeNoteHeadSnapshot(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: rejected('unavailable',
    `the note head is damaged: ${decoded.reason}`) };
  return { ok: true, record, head: decoded.value };
}

async function readPointer(deps: NoteServiceDependencies, projectId: string, anchorKey: string):
Promise<{ ok: true; record: EncodedRecord | null; pointer: CurrentPointerSnapshot | null } | { ok: false; rejection: Rejected }> {
  const ref: CurrentPointerRef = { aggregateType: 'CurrentPointer', projectId, anchorKey };
  const refKey = currentPointerRefKey(ref);
  const read = await deps.records.readMany([refKey]);
  if (read.status !== 'ready') return { ok: false, rejection: mapStoreFailure(read) };
  const record = read.value.records.find(candidate => candidate.refKey === refKey) ?? null;
  if (record === null) return { ok: true, record: null, pointer: null };
  const decoded = decodeCurrentPointerSnapshot(record);
  if (decoded.status !== 'decoded') return { ok: false, rejection: rejected('unavailable',
    `the current pointer is damaged: ${decoded.reason}`) };
  return { ok: true, record, pointer: decoded.value };
}

/**
 * Item 1 (L8): a pointer read that carries both the `{ noteId, revision }`
 * payload a rejected write/disposition returns AND the FULL decoded snapshot.
 * The snapshot is threaded to `supersessionOf` so `moveCurrentPointerRecord`
 * receives the readable pointer record instead of a freshly built literal
 * (AGENTS.md rule 9 / state-writes R1). An absent pointer is
 * `{ noteId: null, revision: null, snapshot: null }`; a read failure is `null` —
 * never a fabricated `{ null, null }`. The stored pointer record's revision and
 * the snapshot `revision` advance together, so the payload's `revision` is also
 * the CAS guard for the pointer record.
 */
type PointerRead = { noteId: string | null; revision: number | null; snapshot: CurrentPointerSnapshot | null };

async function currentPointerRead(deps: NoteServiceDependencies, projectId: string, anchorKey: string):
Promise<PointerRead | null> {
  const read = await readPointer(deps, projectId, anchorKey);
  if (!read.ok) return null;
  return { noteId: read.pointer?.noteId ?? null, revision: read.pointer?.revision ?? null, snapshot: read.pointer };
}

/** The public `{ noteId, revision }` payload of a pointer read (never a protected literal). */
function pointerPayload(pointer: PointerRead | null): { noteId: string | null; revision: number | null } | null {
  return pointer === null ? null : { noteId: pointer.noteId, revision: pointer.revision };
}

/**
 * R4: the trusted caller folded into the replay identity and fingerprint, built
 * from `ctx.principal` only (the model can never name another caller). The same
 * shape as the WorkGraph peers so two principals never replay each other.
 */
function principalOf(ctx: CoreCallContext): unknown {
  const principal = ctx.principal;
  if (principal.kind === 'host') return { kind: 'host', actor: { kind: principal.actor.kind, id: principal.actor.id } };
  if (principal.kind === 'work_run') {
    return { kind: 'work_run', runRef: { projectId: principal.runRef.projectId, goalId: principal.runRef.goalId,
      runId: principal.runRef.runId } };
  }
  return { kind: 'query_run', queryRunRef: { ...principal.queryRunRef } };
}

/**
 * Every head that carries `anchorKey` in one of the five anchor slots, deduped
 * by noteId. Item 3 fix 1: the whole index is read through `readAllHeads`, so a
 * failed or damaged page is returned, never skipped into a partial set.
 */
async function headsByAnchorKey(deps: NoteServiceDependencies, projectId: string, anchorKey: string):
Promise<{ ok: true; heads: NoteHeadSnapshot[] } | { ok: false; code: ReadFailureCode; reason: string }> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const index of S4_NOTE_BY_ANCHOR_LOOKUPS) {
    const page = await readAllHeads(deps.records, index, [projectId, anchorKey]);
    if (!page.ok) return page;
    for (const head of page.heads) {
      if (head.anchorKey0 === anchorKey || head.anchorKey1 === anchorKey || head.anchorKey2 === anchorKey
        || head.anchorKey3 === anchorKey || head.anchorKey4 === anchorKey) seen.set(head.noteId, head);
    }
  }
  return { ok: true, heads: [...seen.values()] };
}

async function headsByGoalState(deps: NoteServiceDependencies, projectId: string, goalId: string,
  state: NoteState): Promise<{ ok: true; heads: NoteHeadSnapshot[] } | { ok: false; code: ReadFailureCode; reason: string }> {
  const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [projectId, goalId, state]);
  if (!page.ok) return page;
  return { ok: true, heads: page.heads };
}

// --------------------------------------------------------------------------
// Draft validation (L4.1–L4.3)
// --------------------------------------------------------------------------

function isGeneral(kind: string): boolean { return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind); }

const NOTE_KINDS: readonly string[] = [...NOTE_GENERAL_KINDS, 'understanding', 'repair'];

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function sameKindFamily(left: string, right: string): boolean { return isGeneral(left) === isGeneral(right); }

/**
 * Item 2/item 8: the ONE supersession target rule, shared by the accepted-write
 * supersession and the quota projection. The ordered, deduplicated union of
 * `replaces` and — for an understanding — the current pointer's note, minus the
 * subject itself and any id also listed in `coexistWith`
 * (R1/S4-NOTE-08: an id in both is not superseded).
 */
function supersessionTargetsOf(subject: { noteId: string; kind: NoteHeadSnapshot['kind'];
  replaces: readonly string[]; coexistWith: readonly string[] }, pointerNoteId: string | null): string[] {
  const coexisting = new Set(subject.coexistWith);
  const targets: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | null | undefined): void => {
    if (candidate === null || candidate === undefined || candidate === '' || candidate === subject.noteId) return;
    if (seen.has(candidate) || coexisting.has(candidate)) return;
    seen.add(candidate);
    targets.push(candidate);
  };
  for (const target of subject.replaces) add(target);
  if (subject.kind === 'understanding') add(pointerNoteId);
  return targets;
}

/** The stored body of an understanding is the rendered five sections (L4.1). */
export function renderUnderstandingBody(sections: { status: string; decided: string; open: string; next: string; risks: string }): string {
  return `现状\n${sections.status}\n\n已定\n${sections.decided}\n\n未决\n${sections.open}\n\n下一步\n${sections.next}\n\n风险\n${sections.risks}`;
}

/**
 * L4.1/L2a class 1: the complete shape gate over the WHOLE `WriteNoteInput`.
 * `writeNote` runs it first, before the trusted caller read and before any
 * dereference or read, so a malformed input is refused `invalid` with the draft
 * and can never reach a store/plan/workspace read (item 12a). Anchor object
 * existence and the `symbolRequest` shape are not checked here (classes 2/3 and
 * group GD).
 */
function writeInputProblem(input: unknown): string | null {
  if (!isRecord(input)) return 'the write input must be an object';
  if (typeof input['commandId'] !== 'string' || input['commandId'].length === 0) return 'a write requires a commandId';
  const goalId = input['goalId'];
  if (!(goalId === null || (typeof goalId === 'string' && goalId.length > 0))) {
    return 'goalId must be a non-empty string or null';
  }
  const expectedPointerRevision = input['expectedPointerRevision'];
  if (!(expectedPointerRevision === null || isPositiveSafeInteger(expectedPointerRevision))) {
    return 'expectedPointerRevision must be null or a positive safe integer';
  }
  const draft = input['note'];
  if (!isRecord(draft)) return 'the note draft must be an object';
  const kind = draft['kind'];
  if (typeof kind !== 'string' || !NOTE_KINDS.includes(kind)) return 'the note kind is not recognized';
  const topic = topicProblem(draft['topic']);
  if (topic !== null) return topic;
  const conclusion = conclusionProblem(draft['conclusion']);
  if (conclusion !== null) return conclusion;
  if (kind === 'understanding') {
    if ('body' in draft) return 'an understanding note gives sections, not a body';
    const sections = draft['sections'];
    if (!isRecord(sections)) return 'an understanding note requires five sections';
    for (const field of ['status', 'decided', 'open', 'next', 'risks'] as const) {
      const value = sections[field];
      if (typeof value !== 'string' || codepointLength(value) < 1) {
        return `an understanding section ${field} requires at least one code point`;
      }
    }
    const body = renderUnderstandingBody(sections as never);
    if (Buffer.byteLength(body, 'utf8') > UNDERSTANDING_BODY_MAX_BYTES) return 'the understanding body exceeds its byte limit';
  } else {
    if ('sections' in draft) return 'only an understanding note carries sections';
    const body = draft['body'];
    if (typeof body !== 'string') return 'a note requires a body';
    if (Buffer.byteLength(body, 'utf8') > NOTE_BODY_MAX_BYTES) return 'the note body exceeds its byte limit';
  }
  if (typeof draft['structural'] !== 'boolean') return 'structural must be a boolean';
  const anchor = anchorFormatProblem(draft['anchor'], 'anchor');
  if (anchor !== null) return anchor.reason;
  const extraAnchors = draft['extraAnchors'];
  if (!Array.isArray(extraAnchors)) return 'extraAnchors must be an array';
  if (extraAnchors.length > NOTE_EXTRA_ANCHORS_MAX) return 'too many extra anchors';
  for (const [index, extra] of extraAnchors.entries()) {
    const problem = anchorFormatProblem(extra, `extraAnchors[${String(index)}]`);
    if (problem !== null) return problem.reason;
  }
  const facts = draft['facts'];
  if (!Array.isArray(facts)) return 'facts must be an array';
  if (facts.length > NOTE_FACTS_MAX) return 'too many facts';
  for (const fact of facts) {
    const problem = factProblem(fact);
    if (problem !== null) return problem;
  }
  const basisFiles = draft['basisFiles'];
  if (!Array.isArray(basisFiles)) return 'basisFiles must be an array';
  if (basisFiles.length > NOTE_BASIS_FILES_MAX) return 'too many basis files';
  if (!basisFiles.every(entry => typeof entry === 'string' && entry.length > 0)) {
    return 'basisFiles entries must be non-empty strings';
  }
  for (const field of ['replaces', 'contradicts', 'coexistWith'] as const) {
    const value = draft[field];
    if (!Array.isArray(value)) return `${field} must be an array`;
    if (!value.every(entry => typeof entry === 'string' && entry.length > 0)) {
      return `${field} entries must be non-empty strings`;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createNoteService(deps: NoteServiceDependencies): NoteWritePort {
  const anchorQuota = deps.anchorQuota ?? NOTE_ANCHOR_QUOTA;
  const goalQuota = deps.goalQuota ?? NOTE_GOAL_QUOTA;
  const symbolHitsMax = deps.symbolHitsMax ?? NOTE_SYMBOL_HITS_MAX;
  const basisFileMaxBytes = Math.min(deps.basisFileMaxBytes ?? NOTE_BASIS_FILE_MAX_BYTES, deps.workspaceMaxFileBytes);
  const anchorFacts: NoteAnchorFactsDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }) };

  /**
   * P9/item 11(b): the per-commit envelope fields shared by every event of one
   * commit. Each event mints its OWN eventId (`{ ...base, eventId: deps.eventId() }`),
   * so a commit with several events never reuses one id.
   */
  function eventBase(projectId: string, workspaceId: string, occurredAt: string):
  { schemaVersion: 1; occurredAt: string; projectId: string; workspaceId: string } {
    return { schemaVersion: NOTE_EVENT_SCHEMA_VERSION, occurredAt, projectId, workspaceId };
  }

  function noteCommandIdentity(op: 'write' | 'review' | 'withdraw', ctx: CoreCallContext, commandId: string): string {
    return `s4-note-${op}:` + sha256Hex(canonicalJson({ schemaVersion: 1, op, projectId: ctx.projectId,
      workspaceId: ctx.workspaceId ?? null, principal: principalOf(ctx), commandId } as unknown as JsonValue));
  }
  function fingerprintOf(value: unknown): string { return sha256Hex(canonicalJson(value as JsonValue)); }

  function rejectedInput(input: WriteNoteInput, code: NoteErrorCode, reason: string,
    extra: Partial<Extract<WriteNoteResult, { status: 'rejected' }>> = {}): WriteNoteResult {
    return { status: 'rejected', code, reason, draft: input, ...extra };
  }

  /**
   * R4/item 5 step 3: restore the ORIGINAL write result verbatim from the
   * NoteWritten event at the receipt cursor. Every check failure is
   * `unavailable` with the draft; a constructed success is never returned.
   */
  async function replayWrite(receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, input: WriteNoteInput,
    projectId: string): Promise<WriteNoteResult> {
    let located: Awaited<ReturnType<NoteServiceDependencies['records']['eventAt']>>;
    try {
      located = await deps.records.eventAt(receipt.cursor);
    } catch {
      return rejectedInput(input, 'unavailable', 'the replayed write event could not be read');
    }
    if (located.status !== 'ready') return rejectedInput(input, 'unavailable', located.reason);
    const event = located.value.event;
    if (event.eventType !== NOTE_WRITTEN_EVENT_TYPE) {
      return rejectedInput(input, 'unavailable', 'the replayed write event is not a NoteWritten event');
    }
    if (!receipt.eventIds.includes(event.eventId)) {
      return rejectedInput(input, 'unavailable', 'the replayed write event disagrees with the receipt');
    }
    const decoded = noteWrittenEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return rejectedInput(input, 'unavailable', `the replayed write event is not decodable: ${decoded.reason}`);
    }
    const result = decoded.value.result;
    const refKey = noteVersionRefKey({ aggregateType: 'NoteVersion', projectId, noteId: result.noteId,
      version: result.version });
    const stored = receipt.versions.find(entry => entry.refKey === refKey);
    if (stored === undefined || stored.revision !== 1) {
      return rejectedInput(input, 'unavailable', 'the replayed write receipt does not name its NoteVersion');
    }
    return result;
  }

  /** The mailbox pattern: a lost receipt is re-checked by identity only. */
  async function recheckWrite(identityKey: string, fingerprint: string, input: WriteNoteInput, projectId: string):
  Promise<WriteNoteResult | null> {
    let again: Awaited<ReturnType<NoteServiceDependencies['records']['lookupCommit']>>;
    try {
      again = await deps.records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return rejectedInput(input, 'unavailable', 'the write idempotency receipt could not be re-checked');
    }
    if (again.status === 'ready') return replayWrite(again.value, input, projectId);
    if (again.code === 'idempotency_conflict') return rejectedInput(input, 'invalid', 'idempotency_conflict');
    if (again.code === 'not_found') return null;
    return rejectedInput(input, 'unavailable', again.reason);
  }

  /**
   * R4/item 5 step 6: restore the ORIGINAL disposition from the
   * NoteDispositionChanged event at the receipt cursor, before any mutable read.
   */
  async function replayDisposition(receipt: Extract<StoreCommitReceipt, { status: 'committed' }>, identityKey: string,
    fingerprint: string, noteId: string): Promise<NoteDispositionResult> {
    let located: Awaited<ReturnType<NoteServiceDependencies['records']['eventAt']>>;
    try {
      located = await deps.records.eventAt(receipt.cursor);
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event could not be read', noteId };
    }
    if (located.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: located.reason, noteId };
    const event = located.value.event;
    if (event.eventType !== NOTE_DISPOSITION_CHANGED_EVENT_TYPE) {
      return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event is not a NoteDispositionChanged event', noteId };
    }
    if (!receipt.eventIds.includes(event.eventId)) {
      return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event disagrees with the receipt', noteId };
    }
    const decoded = noteDispositionChangedEventFromEvent(event);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `the replayed disposition event is not decodable: ${decoded.reason}`, noteId };
    }
    const head = decoded.value.head;
    if (head.noteId !== noteId) {
      return { status: 'rejected', code: 'unavailable', reason: 'the replayed disposition event names another note', noteId };
    }
    return { status: 'done', noteId, version: head.version, state: head.state,
      receipt: { identityKey, fingerprint, cursor: receipt.cursor } };
  }

  /** The mailbox pattern: a lost disposition receipt is re-checked by identity only. */
  async function recheckDisposition(identityKey: string, fingerprint: string, noteId: string):
  Promise<NoteDispositionResult | null> {
    let again: Awaited<ReturnType<NoteServiceDependencies['records']['lookupCommit']>>;
    try {
      again = await deps.records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'rejected', code: 'unavailable', reason: 'the disposition idempotency receipt could not be re-checked', noteId };
    }
    if (again.status === 'ready') return replayDisposition(again.value, identityKey, fingerprint, noteId);
    if (again.code === 'idempotency_conflict') {
      return { status: 'rejected', code: 'invalid', reason: 'idempotency_conflict', noteId };
    }
    if (again.code === 'not_found') return null;
    return { status: 'rejected', code: 'unavailable', reason: again.reason, noteId };
  }

  /**
   * L22 existingTopics (item 3 fix 2, item should-1): per anchor key, only when
   * the new `topicKey` is new on that key, group the other current general notes
   * by `topicKey` and keep the latest-written head's spelling (createdAt desc,
   * then noteId desc). Sorted by anchorKey then topicKey, plain code-unit
   * comparison, capped at `NOTE_EXISTING_TOPICS_MAX`. Computed from the
   * pre-commit `currentByAnchor` minus the heads this commit supersedes; no read
   * after the commit, so the answer can never come back partial.
   */
  function existingTopicsOf(currentByAnchor: ReadonlyMap<string, readonly NoteHeadSnapshot[]>,
    superseded: ReadonlySet<string>, ownTopicKey: string): NoteExistingTopicV1[] {
    type Group = { anchorKey: string; topicKey: string; head: NoteHeadSnapshot; count: number };
    const found = new Map<string, Group>();
    for (const [key, heads] of currentByAnchor) {
      const current = heads.filter(head => !superseded.has(head.noteId) && isGeneral(head.kind));
      // L22: no entry for this anchor when a current general note already has the
      // new topicKey on it.
      if (current.some(head => head.topicKey === ownTopicKey)) continue;
      for (const head of current) {
        const mapKey = `${key}\u0000${head.topicKey}`;
        const existing = found.get(mapKey);
        if (existing === undefined) {
          found.set(mapKey, { anchorKey: key, topicKey: head.topicKey, head, count: 1 });
        } else {
          existing.count += 1;
          if (head.createdAt > existing.head.createdAt
            || (head.createdAt === existing.head.createdAt && head.noteId > existing.head.noteId)) {
            existing.head = head;
          }
        }
      }
    }
    const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
    return [...found.values()]
      .sort((left, right) => compare(left.anchorKey, right.anchorKey) || compare(left.topicKey, right.topicKey))
      .slice(0, NOTE_EXISTING_TOPICS_MAX)
      .map(group => ({ anchorKey: group.anchorKey, topic: group.head.topic, count: group.count }));
  }

  type SupersessionSubject = Pick<NoteHeadSnapshot, 'noteId' | 'kind' | 'replaces' | 'coexistWith'>;
  type SupersessionOutcome =
    | { ok: true; records: EncodedRecord[]; guards: Map<string, number | null>; events: EncodedDomainEvent[] }
    | { ok: false; rejection: Rejected };

  /**
   * Item 2 (L6/S4-NOTE-05/08): the ONE supersession builder, used by an accepted
   * write and an accepted disposition. The target set is the ordered, deduped
   * union of `subject.replaces` and — for an understanding — the current
   * pointer's noteId, minus the subject itself (R1/S4-NOTE-08: an id also listed
   * in `coexistWith` is not superseded). Each accepted/reviewed target gets a
   * `supersede` head+version, its guard and its own NoteDispositionChanged event.
   * An understanding additionally moves the pointer under the pointer-record
   * guard. A failed or missing target read aborts with `unavailable` and the
   * caller writes nothing.
   */
  async function supersessionOf(ctx: CoreCallContext, subject: SupersessionSubject, by: NoteSourceV1,
    prereadHeads: ReadonlyMap<string, NoteHeadSnapshot | null> | null, pointerKey: string | null,
    pointer: PointerRead | null, now: string):
  Promise<SupersessionOutcome> {
    const records: EncodedRecord[] = [];
    const guards = new Map<string, number | null>();
    const events: EncodedDomainEvent[] = [];
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);
    const targets = supersessionTargetsOf(subject, pointer?.noteId ?? null);
    for (const target of targets) {
      let head: NoteHeadSnapshot | null | undefined;
      if (prereadHeads !== null) head = prereadHeads.get(target);
      if (head === undefined) {
        const read = await readHead(deps, ctx.projectId, target);
        if (!read.ok) return { ok: false, rejection: read.rejection };
        head = read.head;
      }
      if (head === null) return { ok: false, rejection: rejected('unavailable', 'a replaced note cannot be read') };
      if (head.state !== 'accepted' && head.state !== 'reviewed') continue;
      const transition = transitionNote(head, { kind: 'supersede' });
      if (!transition.ok) continue;
      const bumped = transition.next;
      const version = newNoteVersionRecord(bumped, { kind: 'supersede', by, reason: null,
        decisionMessageRef: null }, now);
      records.push(encodeNoteHeadSnapshot(bumped), encodeNoteVersionSnapshot(version));
      guards.set(encodeNoteHeadSnapshot(bumped).refKey, head.version);
      guards.set(encodeNoteVersionSnapshot(version).refKey, null);
      events.push(encodeNoteDispositionChangedEvent({ ...base, eventId: deps.eventId(),
        eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, head: bumped, version, acknowledgementRef: null }));
    }
    if (subject.kind === 'understanding') {
      if (pointerKey === null || pointer === null) {
        return { ok: false, rejection: rejected('unavailable', 'the current pointer cannot be read') };
      }
      const ref: CurrentPointerRef = { aggregateType: 'CurrentPointer', projectId: ctx.projectId, anchorKey: pointerKey };
      const moved = pointer.snapshot === null
        ? newCurrentPointerRecord(ref, pointerKey, subject.noteId)
        : moveCurrentPointerRecord(pointer.snapshot, subject.noteId);
      records.push(encodeCurrentPointerSnapshot(moved));
      guards.set(encodeCurrentPointerSnapshot(moved).refKey, pointer.revision);
      events.push(encodeCurrentPointerMovedEvent({ ...base, eventId: deps.eventId(),
        eventType: CURRENT_POINTER_MOVED_EVENT_TYPE, pointer: moved }));
    }
    return { ok: true, records, guards, events };
  }

  async function writeNote(ctx: CoreCallContext, input: WriteNoteInput): Promise<WriteNoteResult> {
    // L4 step 1 / L2a class 1: the whole input shape is checked before the
    // trusted caller read (item 12a), so a malformed input never reaches a read.
    const shapeProblem = writeInputProblem(input);
    if (shapeProblem !== null) return rejectedInput(input, 'invalid', shapeProblem);

    // N-12/L15/R4: the idempotent replay is resolved BEFORE the trusted caller
    // read and every admission gate. Identity is scoped to (operation, project,
    // workspace, the trusted principal, commandId); a same identity with another
    // fingerprint is `idempotency_conflict`, not `unavailable` (R2).
    const identityKey = noteCommandIdentity('write', ctx, input.commandId);
    const fingerprint = fingerprintOf({ kind: 's4-note-write', projectId: ctx.projectId, principal: principalOf(ctx),
      commandId: input.commandId, note: input.note, expectedPointerRevision: input.expectedPointerRevision,
      goalId: input.goalId });
    const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (prior.status === 'ready') return replayWrite(prior.value, input, ctx.projectId);
    if (prior.code === 'idempotency_conflict') return rejectedInput(input, 'invalid', 'idempotency_conflict');
    if (prior.code !== 'not_found') return rejectedInput(input, 'unavailable', prior.reason);

    const callerRead = await resolveCaller(ctx, input, deps);
    if (!callerRead.ok) return rejectedInput(input, callerRead.rejection.code, callerRead.rejection.reason);
    const caller = callerRead.value;
    const draft = input.note;
    // L4 step 2 / L5 authority: only an agent or a scribe stages a repair (item 9a).
    const authority = noteWriteAuthority({ kind: draft.kind, isUser: caller.isUser, duty: caller.duty });
    if (authority !== null) return rejectedInput(input, noteCodeOf(authority.code), authority.detail);

    // L2a classes 1–2 and 4, through item 7's narrow reader (item 6 passes the
    // Run-bound plan so an agent's stage key keeps its bound revision).
    const anchorRead = await resolveNoteAnchors(ctx, { main: draft.anchor, extraAnchors: draft.extraAnchors,
      goalId: caller.goalId, facts: draft.facts, boundPlanRef: caller.planRef, symbolHitsMax }, anchorFacts);
    if (anchorRead.status === 'rejected') {
      return rejectedInput(input, anchorRead.code, anchorRead.reason, {
        ...(anchorRead.anchorCandidates === undefined ? {} : { anchorCandidates: anchorRead.anchorCandidates }),
        ...(anchorRead.candidatesUnavailable === true ? { candidatesUnavailable: true } : {}),
        ...(anchorRead.symbolCandidates === undefined ? {} : { symbolCandidates: anchorRead.symbolCandidates }),
      });
    }
    const resolved: ResolvedNoteAnchors = anchorRead.value;
    // L2a class 3 (understanding compatibility, then own goal), after class 2's
    // existence check of every anchor. Scribes use their scope instead; the user
    // may use any goal.
    if (draft.kind === 'understanding') {
      if (draft.anchor.kind !== 'goal' && draft.anchor.kind !== 'stage') {
        return rejectedInput(input, 'invalid', 'an understanding may only hang on a goal or a stage');
      }
    }
    if (!caller.isUser && caller.duty !== 'scribe' && caller.goalId !== null) {
      for (const draftAnchor of [draft.anchor, ...draft.extraAnchors]) {
        if ('goalId' in draftAnchor && draftAnchor.goalId !== caller.goalId) {
          return rejectedInput(input, 'forbidden', 'anchor_out_of_goal');
        }
      }
    }
    // L5/L2a class 3 (item 12b): a human with goalId null may use only project,
    // module, interface and file anchors; a non-null human goalId must exist.
    if (caller.isUser) {
      if (caller.goalId === null && resolved.anchors.some(anchor => anchor.kind === 'goal'
        || anchor.kind === 'stage' || anchor.kind === 'task')) {
        return rejectedInput(input, 'forbidden', 'anchor_out_of_goal');
      }
      if (caller.goalId !== null) {
        const goalRead = await deps.plans.queryGoal(ctx, { aggregateType: 'Goal', projectId: ctx.projectId,
          goalId: caller.goalId });
        if (goalRead.status === 'not_found') {
          return rejectedInput(input, 'invalid', 'the goalId names no goal in this project');
        }
        if (goalRead.status !== 'ready') {
          return rejectedInput(input, 'unavailable', goalRead.status === 'rejected'
            ? goalRead.reason : 'the goalId cannot be read');
        }
      }
    }
    // L2a class 3 (scribe scope): a region scribe may only use module-class
    // anchors inside its region; a project scribe may use every anchor.
    if (caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined) {
      const refusal = await deps.scopes.writeAdmission(ctx, caller.sessionRef, resolved.anchors);
      if (refusal !== null) return rejectedInput(input, refusal.code, refusal.reason);
    }
    const warnings: ('symbol_unresolved' | 'anchor_ended')[] = [];
    if (resolved.anchorEnded) warnings.push('anchor_ended');
    // Item 14/L14: a symbolRequest that resolved to no unique locator keeps the
    // plain file anchor and reports the success warning exactly once.
    if (resolved.symbolUnresolved) warnings.push('symbol_unresolved');

    // Basis files (L11 write half): the platform reads each digest; too large is a refusal.
    const basisFiles: { path: string; digest: string }[] = [];
    for (const rawPath of draft.basisFiles) {
      const path = typeof rawPath === 'string' ? normalizePath(rawPath) : rawPath;
      if (typeof path !== 'string') return rejectedInput(input, 'invalid', 'basis_file_missing');
      // R15/L11: a path that escapes the workspace (`../…`) is a class-1 shape
      // problem, not a transient read failure.
      if (!isSafeRelativePath(path)) return rejectedInput(input, 'invalid', 'basis_file_forbidden');
      const read = await deps.workspace.readWorkspace(ctx, { workspace: { aggregateType: 'Workspace',
        projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' }, path, maxBytes: basisFileMaxBytes,
        version: { kind: 'working_tree' } });
      if (read.status !== 'ready') {
        if (read.code === 'capacity') return rejectedInput(input, 'invalid', 'basis_file_too_large');
        if (read.code === 'not_found') return rejectedInput(input, 'invalid', 'basis_file_missing');
        if (read.code === 'forbidden') return rejectedInput(input, 'invalid', 'basis_file_forbidden');
        return rejectedInput(input, 'unavailable', read.reason);
      }
      basisFiles.push({ path: read.value.path, digest: read.value.digest });
    }

    // L4.3: relations must exist, share an anchor and match the kind family.
    const relations = new Map<string, NoteHeadSnapshot | null>();
    for (const noteId of [...draft.replaces, ...draft.contradicts, ...draft.coexistWith]) {
      if (noteId === '') return rejectedInput(input, 'invalid', 'a relation names an empty noteId');
      if (!relations.has(noteId)) {
        const read = await readHead(deps, ctx.projectId, noteId);
        if (!read.ok) return rejectedInput(input, read.rejection.code, read.rejection.reason);
        if (read.head === null) return rejectedInput(input, 'invalid', 'not_found');
        relations.set(noteId, read.head);
      }
    }
    for (const noteId of [...draft.replaces, ...draft.contradicts, ...draft.coexistWith]) {
      const head = relations.get(noteId)!;
      if (head === null) continue;
      const shares = [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
        .some(key => key !== null && resolved.keys.includes(key));
      if (!shares) return rejectedInput(input, 'invalid', 'anchor_not_found');
      if (draft.replaces.includes(noteId) && !sameKindFamily(draft.kind, head.kind)) {
        return rejectedInput(input, 'invalid', 'replaces_kind_mismatch');
      }
    }

    // L5: a scribe disposing another's current note must manage the target's
    // scope (the author disposing their own note is exempt). Item 3 fix 7: a
    // failed scope read is `unavailable`, never `forbidden`.
    if (caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined) {
      for (const noteId of [...draft.replaces, ...draft.contradicts]) {
        const head = relations.get(noteId);
        if (head === undefined || head === null) continue;
        if (sourceIsAuthorOf(head.source, caller.source)) continue;
        const targetScope = await deps.scopes.managingScopeOf(ctx, head);
        if (targetScope.status !== 'ready') {
          return rejectedInput(input, 'unavailable',
            targetScope.status === 'rejected' ? targetScope.reason : 'the target scope cannot be read');
        }
        const manages = await deps.scopes.manages(ctx, caller.sessionRef, targetScope.value);
        if (manages.status !== 'ready') {
          return rejectedInput(input, 'unavailable',
            manages.status === 'rejected' ? manages.reason : 'the managed scope cannot be read');
        }
        if (!manages.value) return rejectedInput(input, 'forbidden', 'outside_managed_scope');
      }
    }

    // L4.4: current same-topic admission. Item 3 fix 2: any failed anchor read
    // refuses the write before the commit.
    const sameTopicConflicts: { noteId: string; version: number; conclusion: string }[] = [];
    const currentByAnchor = new Map<string, NoteHeadSnapshot[]>();
    for (const key of resolved.keys) {
      if (key === null) continue;
      const page = await headsByAnchorKey(deps, ctx.projectId, key);
      if (!page.ok) return rejectedInput(input, page.code, page.reason);
      const heads = page.heads.filter(head => head.state === 'accepted' || head.state === 'reviewed');
      currentByAnchor.set(key, heads);
    }
    const topicKey = topicKeyOf(draft.topic);
    for (const heads of currentByAnchor.values()) {
      for (const head of heads) {
        if (head.topicKey !== topicKey || head.noteId === undefined) continue;
        const declared = draft.contradicts.includes(head.noteId) || draft.replaces.includes(head.noteId)
          || draft.coexistWith.includes(head.noteId);
        if (!declared) sameTopicConflicts.push({ noteId: head.noteId, version: head.version, conclusion: head.conclusion });
      }
    }
    if (sameTopicConflicts.length > 0) {
      return rejectedInput(input, 'invalid', 'same_topic_unresolved', { conflicts: sameTopicConflicts });
    }

    // L8: the pointer CAS is read before the projection because, for an
    // understanding, the note the pointer leaves is superseded by this write and
    // is therefore subtracted from the projected counts (item 8). The pointer CAS
    // is required for every understanding write and moved only on accept.
    const isUnderstanding = draft.kind === 'understanding';
    const pointerKey = isUnderstanding ? resolved.keys[0] : null;
    let pointerRead: PointerRead | null = null;
    if (pointerKey !== null) {
      const current = await currentPointerRead(deps, ctx.projectId, pointerKey);
      if (current === null) return rejectedInput(input, 'unavailable', 'the current pointer cannot be read');
      pointerRead = current;
      if (input.expectedPointerRevision !== current.revision) {
        return rejectedInput(input, 'revision_conflict', 'the current-understanding pointer moved',
          { pointer: pointerPayload(current)! });
      }
    } else if (input.expectedPointerRevision !== null && input.expectedPointerRevision !== undefined) {
      return rejectedInput(input, 'invalid', 'expectedPointerRevision is only for an understanding write');
    }

    // The pointer target is not in `relations` unless it is also a declared
    // replaces target; read it once so the projection sees it.
    let pointerTargetHead: NoteHeadSnapshot | null = null;
    if (isUnderstanding && pointerRead !== null && pointerRead.noteId !== null) {
      const preread = relations.get(pointerRead.noteId);
      if (preread !== undefined && preread !== null) pointerTargetHead = preread;
      else {
        const read = await readHead(deps, ctx.projectId, pointerRead.noteId);
        if (!read.ok) return rejectedInput(input, read.rejection.code, read.rejection.reason);
        pointerTargetHead = read.head;
      }
    }

    // L7: the projected counts subtract the current items this write would
    // replace, by the same target rule as supersession (item 2/item 8).
    const replacedCurrent = new Map<string, NoteHeadSnapshot>();
    for (const noteId of supersessionTargetsOf({ noteId: '', kind: draft.kind, replaces: draft.replaces,
      coexistWith: draft.coexistWith }, pointerRead?.noteId ?? null)) {
      let head: NoteHeadSnapshot | null | undefined = relations.get(noteId);
      if (head === undefined && noteId === pointerRead?.noteId) head = pointerTargetHead;
      if (head !== undefined && head !== null && (head.state === 'accepted' || head.state === 'reviewed')) {
        replacedCurrent.set(noteId, head);
      }
    }
    // L7/R6: the anchor quota gates only general-kind items, so it is projected
    // only for a general kind; the goal quota counts every kind.
    const anchorFull = isGeneral(draft.kind) && [...resolved.keys].some(key => {
      if (key === null) return false;
      const heads = currentByAnchor.get(key) ?? [];
      const count = heads.filter(head => isGeneral(head.kind) && !replacedCurrent.has(head.noteId)).length;
      return count >= anchorQuota;
    });
    // The goal's counted heads (deduped across the four counted states) are read
    // once: `goalFull` is the admission projection; the committed count below
    // subtracts only what this commit actually supersedes.
    const goalHeads: NoteHeadSnapshot[] = [];
    if (caller.goalId !== null) {
      const seen = new Set<string>();
      for (const state of ['accepted', 'reviewed', 'pending_review', 'staged'] as const) {
        const page = await headsByGoalState(deps, ctx.projectId, caller.goalId, state);
        if (!page.ok) return rejectedInput(input, page.code, page.reason);
        for (const head of page.heads) {
          if (seen.has(head.noteId)) continue;
          seen.add(head.noteId);
          goalHeads.push(head);
        }
      }
    }
    const goalFull = goalHeads.filter(head => !replacedCurrent.has(head.noteId)).length >= goalQuota;

    const admission = admitNoteWrite({ kind: draft.kind, structural: draft.structural,
      contradicts: draft.contradicts, anchorFull, goalFull, isUser: caller.isUser });

    // Fix 1 (L7/R6): the returned and replay-stored `overQuota` is the COMMITTED
    // population, so it always equals `readNote(noteId).overQuota` right after the
    // commit. The new item counts in the state it lands in; only the targets this
    // commit actually supersedes (an `accepted` commit) stop counting — a note
    // that ends `pending_review` or `staged` supersedes nothing yet.
    const supersedesNow = admission.state === 'accepted';
    let committedOverQuota = false;
    if (isGeneral(draft.kind) && supersedesNow) {
      committedOverQuota = [...resolved.keys].some(key => {
        if (key === null) return false;
        const heads = currentByAnchor.get(key) ?? [];
        const count = heads.filter(head => isGeneral(head.kind) && !replacedCurrent.has(head.noteId)).length;
        return count + 1 > anchorQuota;
      });
    }
    if (caller.goalId !== null) {
      const committedGoal = goalHeads.filter(head => !(supersedesNow && replacedCurrent.has(head.noteId))).length + 1;
      if (committedGoal > goalQuota) committedOverQuota = true;
    }

    const noteId = deps.newId();
    const now = deps.now();
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);
    const head = newNoteHeadRecord({
      ref: { aggregateType: 'NoteHead', projectId: ctx.projectId, noteId }, noteId,
      body: {
        kind: draft.kind, topic: draft.topic, topicKey, conclusion: draft.conclusion,
        body: draft.kind === 'understanding' ? renderUnderstandingBody(draft.sections) : draft.body,
        ...(draft.kind === 'understanding' ? { sections: draft.sections } : {}),
        anchor: resolved.anchors[0]!, extraAnchors: resolved.anchors.slice(1), facts: draft.facts,
        basis: { planRevision: resolved.basisPlanRevision,
          catalogRevision: resolved.basisCatalogRevision, files: basisFiles },
        structural: draft.structural, replaces: [...draft.replaces], contradicts: [...draft.contradicts],
        coexistWith: [...draft.coexistWith],
      },
      state: admission.state, goalId: caller.goalId, source: caller.source,
      stagedRunKey: caller.source.kind === 'agent' && draft.kind === 'repair' && caller.source.runRef !== null
        ? `${caller.source.runRef.goalId}/${caller.source.runRef.runId}` : null,
      reviewReasons: admission.reviewReasons, confirmedByUser: admission.confirmedByUser,
      anchorKeys: resolved.keys, createdAt: now, since: null,
    });
    const version1 = newNoteVersionRecord(head, { kind: 'write', by: caller.source, reason: null,
      decisionMessageRef: null }, now);

    const records: EncodedRecord[] = [encodeNoteHeadSnapshot(head), encodeNoteVersionSnapshot(version1)];
    const guards = new Map<string, number | null>([[encodeNoteHeadSnapshot(head).refKey, null],
      [encodeNoteVersionSnapshot(version1).refKey, null]]);
    const events: EncodedDomainEvent[] = [];

    // R4/item 5 step 4: the FULL success result is computed BEFORE the commit —
    // `existingTopics` from the already-read `currentByAnchor` minus the heads
    // this commit supersedes (the projected post-commit state, L7) — and stored
    // verbatim in the NoteWritten event, so a replay never rebuilds it.
    const successResult: Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }> = {
      status: admission.status, noteId, version: head.version, reasons: [...admission.reviewReasons],
      overQuota: committedOverQuota, confirmedByUser: admission.confirmedByUser, warnings,
      existingTopics: existingTopicsOf(currentByAnchor,
        admission.state === 'accepted' ? new Set(replacedCurrent.keys()) : new Set(), topicKey),
    };

    // L6/S4-NOTE-05/08: an accepted write supersedes its current `replaces`
    // targets AND, for an understanding, the note the pointer leaves — in one
    // pass, so a target in both sets is bumped exactly once (item 2).
    if (admission.state === 'accepted') {
      const supersession = await supersessionOf(ctx, head, caller.source, relations, pointerKey, pointerRead, now);
      if (!supersession.ok) return rejectedInput(input, supersession.rejection.code, supersession.rejection.reason);
      records.push(...supersession.records);
      for (const [refKey, revision] of supersession.guards) guards.set(refKey, revision);
      events.push(...supersession.events);
    }

    // P9/R4: the new note's NoteWritten is the LAST event of a write commit and
    // carries the success result.
    events.push(encodeNoteWrittenEvent({ ...base, eventId: deps.eventId(),
      eventType: NOTE_WRITTEN_EVENT_TYPE, head, version: version1, result: successResult }));

    // Replace the placeholder guards with the real CAS revisions.
    const realGuards: RecordGuard[] = records.map(record => {
      const expected = guards.get(record.refKey);
      return { refKey: record.refKey, expectedRevision: expected === undefined ? null : expected };
    });

    const commitCursorBindings = records
      .filter(record => record.schemaId === 'NoteHead@1' || record.schemaId === 'NoteVersion@1')
      .map(record => ({ refKey: record.refKey, field: 'since' as const }));

    if (ctx.signal?.aborted) return rejectedInput(input, 'unavailable', 'the write was cancelled');
    const prepared: PreparedCommit = { identityKey, fingerprint, guards: realGuards, records, claims: [],
      indexGuards: [], indexChanges: [], events, commitCursorBindings };
    let receipt: StoreCommitReceipt;
    try {
      receipt = await deps.records.commit(prepared);
    } catch {
      // The mailbox pattern: a thrown commit is re-checked by identity only.
      const restored = await recheckWrite(identityKey, fingerprint, input, ctx.projectId);
      return restored ?? rejectedInput(input, 'unavailable', 'the write commit could not be re-checked');
    }
    if (receipt.status !== 'committed') {
      const restored = await recheckWrite(identityKey, fingerprint, input, ctx.projectId);
      if (restored !== null) return restored;
      const mapped = mapStoreFailure(receipt);
      // L8: a lost pointer CAS comes back with the pointer it lost to. A failed
      // re-read returns the conflict WITHOUT a fabricated pointer.
      if (mapped.code === 'revision_conflict' && isUnderstanding && pointerKey !== null) {
        const current = await currentPointerRead(deps, ctx.projectId, pointerKey);
        if (current !== null) return rejectedInput(input, mapped.code, mapped.reason, { pointer: pointerPayload(current)! });
      }
      return rejectedInput(input, mapped.code, mapped.reason);
    }
    // Never fall through to the freshly minted noteId: a replayed receipt is
    // answered ONLY from its recorded event.
    if (receipt.replayed) return replayWrite(receipt, input, ctx.projectId);
    return successResult;
  }

  // ------------------------------------------------------------------------
  // Dispositions (L6): review, accept, reject, withdraw
  // ------------------------------------------------------------------------

  async function dispose(ctx: CoreCallContext, commandId: string, noteId: string, expectedVersion: number,
    eventKind: 'review' | 'accept' | 'reject' | 'withdraw', reason: string | null,
    expectedPointerRevision?: number | null): Promise<NoteDispositionResult> {
    // R4/d7: the disposition replay is resolved BEFORE `resolveCaller`, the head
    // read, the scope check, the version check and the transition, and returns
    // the ORIGINAL receipt from the recorded event.
    const op: 'review' | 'withdraw' = eventKind === 'withdraw' ? 'withdraw' : 'review';
    const identityKey = noteCommandIdentity(op, ctx, commandId);
    const fingerprint = fingerprintOf({ kind: 's4-note-disposition', projectId: ctx.projectId, principal: principalOf(ctx),
      commandId, noteId, expectedVersion, eventKind, reason, expectedPointerRevision: expectedPointerRevision ?? null });
    const prior = await deps.records.lookupCommit({ identityKey, fingerprint });
    if (prior.status === 'ready') return replayDisposition(prior.value, identityKey, fingerprint, noteId);
    if (prior.code === 'idempotency_conflict') {
      return { status: 'rejected', code: 'invalid', reason: 'idempotency_conflict', noteId };
    }
    if (prior.code !== 'not_found') return { status: 'rejected', code: 'unavailable', reason: prior.reason, noteId };

    const callerRead = await resolveCaller(ctx, { commandId, note: {} as never, expectedPointerRevision: null, goalId: null }, deps);
    if (!callerRead.ok) return { status: 'rejected', code: callerRead.rejection.code, reason: callerRead.rejection.reason, noteId };
    const caller = callerRead.value;
    const read = await readHead(deps, ctx.projectId, noteId);
    if (!read.ok) return { status: 'rejected', code: read.rejection.code, reason: read.rejection.reason, noteId };
    if (read.head === null) return { status: 'rejected', code: 'not_found', reason: 'the note does not exist', noteId };
    const head = read.head;
    // L6/item 9b: the author is the note's `source.sessionRef`, not the Run; a
    // later Run of the same Session may withdraw it (slice 7 owns real handover).
    const sameAuthor = sourceIsAuthorOf(head.source, caller.source);
    if (!caller.isUser && caller.duty !== 'scribe' && !(eventKind === 'withdraw' && sameAuthor)) {
      return { status: 'rejected', code: 'forbidden', reason: 'only a scribe, the author or the user may change a disposition', noteId };
    }
    // L5/L6: a scribe may only disposition a note managed by its own scope.
    // Withdrawing one's own note stays exempt (the other dispositions do not).
    // Item 3 fix 7: a failed scope read is `unavailable`, never `forbidden`.
    const authorWithdraw = eventKind === 'withdraw' && sameAuthor;
    if (!caller.isUser && caller.duty === 'scribe' && caller.sessionRef !== null && deps.scopes !== undefined
      && !authorWithdraw) {
      const targetScope = await deps.scopes.managingScopeOf(ctx, head);
      if (targetScope.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable',
          reason: targetScope.status === 'rejected' ? targetScope.reason : 'the target scope cannot be read', noteId };
      }
      const manages = await deps.scopes.manages(ctx, caller.sessionRef, targetScope.value);
      if (manages.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable',
          reason: manages.status === 'rejected' ? manages.reason : 'the managed scope cannot be read', noteId };
      }
      if (!manages.value) return { status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope', noteId };
    }
    if (head.version !== expectedVersion) {
      return { status: 'rejected', code: 'revision_conflict', reason: 'the note head moved', noteId };
    }
    const by: 'scribe' | 'user' = caller.isUser ? 'user' : 'scribe';
    const event: NoteDispositionEventV1 = eventKind === 'review' ? { kind: 'review', by }
      : eventKind === 'withdraw' ? { kind: 'withdraw' }
        : { kind: eventKind, by, reasons: head.reviewReasons, reason };
    const transition = transitionNote(head, event);
    if (!transition.ok) return { status: 'rejected', code: noteCodeOf(transition.code), reason: transition.detail, noteId };

    const now = deps.now();
    const records: EncodedRecord[] = [encodeNoteHeadSnapshot(transition.next)];
    const guards = new Map<string, number | null>([[encodeNoteHeadSnapshot(transition.next).refKey, head.version]]);
    const events: EncodedDomainEvent[] = [];
    const base = eventBase(ctx.projectId, ctx.workspaceId ?? '', now);
    const changeKind: NoteVersionSnapshot['change']['kind'] = eventKind;
    const version = newNoteVersionRecord(transition.next, { kind: changeKind, by: caller.source, reason,
      decisionMessageRef: null }, now);
    records.push(encodeNoteVersionSnapshot(version));
    guards.set(encodeNoteVersionSnapshot(version).refKey, null);

    // L6/S4-NOTE-05/08: the accepting commit supersedes its current `replaces`
    // targets and, for an understanding, the note the pointer leaves; the
    // subject's own NoteDispositionChanged is pushed LAST (P9). The pointer CAS
    // reads the accept-time revision (L8).
    if (eventKind === 'accept') {
      const pointerKey = head.kind === 'understanding' ? anchorKeyOf(head.anchor) : null;
      let pointer: PointerRead | null = null;
      if (pointerKey !== null) {
        pointer = await currentPointerRead(deps, ctx.projectId, pointerKey);
        if (pointer === null) {
          return { status: 'rejected', code: 'unavailable', reason: 'the current pointer cannot be read', noteId };
        }
        if ((expectedPointerRevision ?? null) !== pointer.revision) {
          return { status: 'rejected', code: 'revision_conflict', reason: 'the current-understanding pointer moved', noteId,
            pointer: pointerPayload(pointer)! };
        }
      }
      const supersession = await supersessionOf(ctx, transition.next, caller.source, null, pointerKey, pointer, now);
      if (!supersession.ok) {
        return { status: 'rejected', code: supersession.rejection.code, reason: supersession.rejection.reason, noteId };
      }
      records.push(...supersession.records);
      for (const [refKey, revision] of supersession.guards) guards.set(refKey, revision);
      events.push(...supersession.events);
    }

    events.push(encodeNoteDispositionChangedEvent({ ...base, eventId: deps.eventId(),
      eventType: NOTE_DISPOSITION_CHANGED_EVENT_TYPE, head: transition.next, version, acknowledgementRef: null }));

    const realGuards: RecordGuard[] = records.map(record => ({ refKey: record.refKey,
      expectedRevision: guards.get(record.refKey) ?? null }));
    const commitCursorBindings = records
      .filter(record => record.schemaId === 'NoteHead@1' || record.schemaId === 'NoteVersion@1')
      .map(record => ({ refKey: record.refKey, field: 'since' as const }));
    const prepared: PreparedCommit = { identityKey, fingerprint, guards: realGuards, records, claims: [],
      indexGuards: [], indexChanges: [], events, commitCursorBindings };
    let receipt: StoreCommitReceipt;
    try {
      receipt = await deps.records.commit(prepared);
    } catch {
      const restored = await recheckDisposition(identityKey, fingerprint, noteId);
      return restored ?? { status: 'rejected', code: 'unavailable', reason: 'the disposition commit could not be re-checked', noteId };
    }
    if (receipt.status !== 'committed') {
      const restored = await recheckDisposition(identityKey, fingerprint, noteId);
      if (restored !== null) return restored;
      const mapped = mapStoreFailure(receipt);
      // L8: a lost pointer CAS returns the current pointer; a failed re-read does
      // not fabricate one.
      if (mapped.code === 'revision_conflict' && eventKind === 'accept' && head.kind === 'understanding') {
        const current = await currentPointerRead(deps, ctx.projectId, anchorKeyOf(head.anchor));
        if (current !== null) {
          return { status: 'rejected', code: mapped.code, reason: mapped.reason, noteId, pointer: pointerPayload(current)! };
        }
      }
      return { status: 'rejected', code: mapped.code, reason: mapped.reason, noteId };
    }
    if (receipt.replayed) return replayDisposition(receipt, identityKey, fingerprint, noteId);
    return { status: 'done', noteId, version: transition.next.version, state: transition.next.state,
      receipt: { identityKey, fingerprint, cursor: receipt.cursor } };
  }

  return {
    writeNote,
    async reviewNote(ctx, input) {
      return dispose(ctx, input.commandId, input.noteId, input.expectedVersion, input.verdict, input.reason,
        input.expectedPointerRevision);
    },
    async withdrawNote(ctx, input) {
      return dispose(ctx, input.commandId, input.noteId, input.expectedVersion, 'withdraw', input.reason);
    },
  };
}
