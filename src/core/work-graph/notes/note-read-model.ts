/**
 * Slice 4A L18/P8/P9: the minimal note read port. It answers `readNote` by id
 * (optionally one immutable version) and `listByAnchor` (the five anchor indexes
 * merged and deduped, ascending by `createdAt` then `noteId`, with the current
 * pointer for goal/stage anchors). The fields that need 4B's L11/L22/L23 take the
 * unchecked values of P8; `conflicting` and `overQuota` are computed from the
 * stored heads because N-06 and N-07 assert them. The database is never read to
 * answer a test: every assertion goes through this port.
 *
 * Round 2 item 3: a read failure is never flattened into a definite answer.
 * `readAllHeads`/`readAllRecords` page an index to the end and return any
 * failure; a page that is not ready is mapped through `mapStoreFailure`, and an
 * undecodable record is `unavailable`. Every head/version/pointer read tells a
 * miss apart from a failure, and `readNote`/`listByAnchor` return the failure.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteHeadSnapshot, NoteState, NoteVersionSnapshot } from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../../contracts/note.js';
import type { GoalRecordTransactionPort, EncodedRecord } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort, RecordTextSearchPort } from '../../record-store/lookup-ports.js';
import { normalizeSearchText } from '../../record-store/lookup-index.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type {
  MemoryConflictsRequest, MemoryFindRequest, MemoryHistoryRequest, MemoryHistoryResultV1, MemoryLookupRequest,
  MemoryLookupResultV1, MemoryNeighborsRequest, MemoryReadBasis, MemoryResultV1, MemoryStaleRequest, NoteCheckPort,
  NoteHistoryItemV1, NoteItemV1, NoteMemoryReadPort, NotePageV1, NoteReadPort, NoteFileObservationV1,
  NoteAnchorNotFoundV1, NoteAnchorCandidateV1,
  UnderstandingStatusV1,
} from '../model/note-contracts.js';
import { MEMORY_PAGE_MAX, MEMORY_PAGE_DEFAULT, MEMORY_RESULT_MAX_BYTES, MEMORY_TOPICS_MAX, NOTE_ANCHOR_QUOTA,
  NOTE_BODY_PAGE_BYTES, NOTE_GOAL_QUOTA, NOTE_RANK_WEIGHT_BODY,
  NOTE_RANK_WEIGHT_CONCLUSION, NOTE_RANK_WEIGHT_TOPIC, NOTE_SIMILAR_MAX,
  NOTE_SIMILAR_MIN, TEXT_SEARCH_CANDIDATE_MAX, TEXT_SEARCH_MAX_TERMS, NOTE_TEXT_TERM_MAX,
  NOTE_TEXT_TERM_MIN } from '../model/note-contracts.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { NoteAnchorWorkspace } from './note-anchors.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, S4B_NOTE_BY_PATH_LOOKUPS, S4_NOTE_TEXT_LOOKUP,
  currentPointerRefKey, decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot,
  noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { GOAL_BY_WORKSPACE_INDEX } from '../tasks/plan-readers.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { anchorKeyOf, resolveNoteAnchors, topicKeyOf, type NoteAnchorFactsDeps } from './note-anchors.js';

export type NoteReadDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordTextSearchPort;
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  workspace?: NoteAnchorWorkspace;
  /** Slice 4B L22: the injected derived-field implementation (`views` owns it). */
  check?: NoteCheckPort;
  anchorQuota?: number;
  goalQuota?: number;
  /** Slice 4B P14/T-09: bounds the match set the read model ranks (injectable). */
  textSearchCandidateMax?: number;
  textSearchMaxTerms?: number;
  /** Slice 4B L12: the whole-result JSON byte bound (injectable; default 48 KiB). */
  resultMaxBytes?: number;
};

/** The note-port failure codes a store/record read can produce (all in NoteErrorCode). */
export type ReadFailureCode = 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

type ReadOutcome<T> = { ok: true; value: T } | { ok: false; code: ReadFailureCode; reason: string };

/** R9: the not-found answer the three anchor-scoped reads share, with candidates. */
export function anchorNotFound(candidates?: NoteAnchorCandidateV1[], unavailable?: boolean): NoteAnchorNotFoundV1 {
  return { status: 'rejected', code: 'not_found', reason: 'anchor_not_found',
    ...(candidates === undefined ? {} : { anchorCandidates: candidates }),
    ...(unavailable === true ? { candidatesUnavailable: true } : {}) };
}

type AnchorExistence = { ok: true; exists: true }
  | { ok: true; exists: false; anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean }
  | { ok: false; code: ReadFailureCode | 'forbidden'; reason: string };

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function isGeneral(kind: string): boolean { return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind); }

/** Item 3 fix 1: the one store-failure mapping shared by the note reads and the writer. */
export type MappedStoreFailure = { status: 'rejected'; code: ReadFailureCode; reason: string };

export function mapStoreFailure(failure: { code: string; reason: string }): MappedStoreFailure {
  switch (failure.code) {
    case 'revision_conflict': return { status: 'rejected', code: 'revision_conflict', reason: failure.reason };
    case 'invalid': return { status: 'rejected', code: 'invalid', reason: failure.reason };
    case 'not_found': return { status: 'rejected', code: 'not_found', reason: failure.reason };
    default: return { status: 'rejected', code: 'unavailable', reason: failure.reason };
  }
}

function asOutcome(failure: { code: string; reason: string }): { ok: false; code: ReadFailureCode; reason: string } {
  const mapped = mapStoreFailure(failure);
  return { ok: false, code: mapped.code, reason: mapped.reason };
}

/**
 * Item 3 fix 1: page one lookup index to completion (`next` to the end). Any
 * page that is not `ready` is returned as the mapped store failure; a partial
 * set is never handed back.
 */
export async function readAllRecords(records: RecordLookupPort, index: string,
  values: readonly (string | null)[]): Promise<ReadOutcome<EncodedRecord[]>> {
  const found: EncodedRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await records.lookup({ index, values, ...(after === undefined ? {} : { after }), limit: 200 });
    if (page.status !== 'ready') return asOutcome(page);
    found.push(...page.value.records);
    if (page.value.next === null) return { ok: true, value: found };
    after = page.value.next;
  }
}

/** Item 3 fix 1: every note head on one index, or the failure; an undecodable head is `unavailable`. */
export async function readAllHeads(records: RecordLookupPort, index: string,
  values: readonly (string | null)[]): Promise<{ ok: true; heads: NoteHeadSnapshot[] } | { ok: false; code: ReadFailureCode; reason: string }> {
  const page = await readAllRecords(records, index, values);
  if (!page.ok) return page;
  const heads: NoteHeadSnapshot[] = [];
  for (const record of page.value) {
    const decoded = decodeNoteHeadSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
    heads.push(decoded.value);
  }
  return { ok: true, heads };
}

async function readRecord(records: GoalRecordTransactionPort, refKey: string): Promise<ReadOutcome<EncodedRecord | null>> {
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') return asOutcome(read);
  return { ok: true, value: read.value.records.find(candidate => candidate.refKey === refKey) ?? null };
}

async function readHeadRecord(records: GoalRecordTransactionPort, projectId: string, noteId: string):
Promise<ReadOutcome<NoteHeadSnapshot | null>> {
  const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId });
  const outcome = await readRecord(records, refKey);
  if (!outcome.ok) return outcome;
  if (outcome.value === null) return { ok: true, value: null };
  const decoded = decodeNoteHeadSnapshot(outcome.value);
  if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
  return { ok: true, value: decoded.value };
}

async function readVersionRecord(records: GoalRecordTransactionPort, projectId: string, noteId: string,
  version: number): Promise<ReadOutcome<NoteVersionSnapshot | null>> {
  const refKey = noteVersionRefKey({ aggregateType: 'NoteVersion', projectId, noteId, version });
  const outcome = await readRecord(records, refKey);
  if (!outcome.ok) return outcome;
  if (outcome.value === null) return { ok: true, value: null };
  const decoded = decodeNoteVersionSnapshot(outcome.value);
  if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note version' };
  return { ok: true, value: decoded.value };
}

/**
 * should-3 (L1, §4 rule 9): `confirmedByUser` is stored only on the head; a
 * historical version is confirmed iff some version u ≤ v has
 * `change.by.kind === 'user'` and `change.kind ∈ {write, accept, review}`. It is
 * never stored per version. `v === head.version` may use the head value. A needed
 * version read that fails — or is missing — is `unavailable`, never `false`.
 */
const CONFIRMING_CHANGE_KINDS: readonly NoteVersionSnapshot['change']['kind'][] = ['write', 'accept', 'review'];

async function confirmedByUserOfVersion(records: GoalRecordTransactionPort, projectId: string, noteId: string,
  version: number, head: NoteHeadSnapshot | null): Promise<ReadOutcome<boolean>> {
  if (head !== null && head.version === version) return { ok: true, value: head.confirmedByUser };
  for (let u = 1; u <= version; u += 1) {
    const read = await readVersionRecord(records, projectId, noteId, u);
    if (!read.ok) return read;
    if (read.value === null) {
      return { ok: false, code: 'unavailable', reason: 'a note version needed to confirm the note cannot be read' };
    }
    if (read.value.change.by.kind === 'user' && CONFIRMING_CHANGE_KINDS.includes(read.value.change.kind)) {
      return { ok: true, value: true };
    }
  }
  return { ok: true, value: false };
}

async function headsByAnchorKey(records: RecordLookupPort, projectId: string, anchorKey: string):
Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const index of S4_NOTE_BY_ANCHOR_LOOKUPS) {
    const page = await readAllHeads(records, index, [projectId, anchorKey]);
    if (!page.ok) return page;
    for (const head of page.heads) {
      if (head.anchorKey0 === anchorKey || head.anchorKey1 === anchorKey || head.anchorKey2 === anchorKey
        || head.anchorKey3 === anchorKey || head.anchorKey4 === anchorKey) seen.set(head.noteId, head);
    }
  }
  return { ok: true, value: [...seen.values()] };
}

async function currentHeadsForGoal(records: RecordLookupPort, projectId: string, goalId: string):
Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const seen = new Map<string, NoteHeadSnapshot>();
  for (const state of ['accepted', 'reviewed', 'pending_review', 'staged'] as const) {
    const page = await readAllHeads(records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [projectId, goalId, state]);
    if (!page.ok) return page;
    for (const head of page.heads) seen.set(head.noteId, head);
  }
  return { ok: true, value: [...seen.values()] };
}

/**
 * Item 4 fix 2: within one port call the anchor-keyed and goal-keyed head sets
 * are read once and memoised, so `conflictingOf`/`overQuotaOf` do not re-read
 * the store for every item of a page.
 */
export type HeadCache = {
  anchors: Map<string, ReadOutcome<NoteHeadSnapshot[]>>;
  goals: Map<string, ReadOutcome<NoteHeadSnapshot[]>>;
};

export function newHeadCache(): HeadCache { return { anchors: new Map(), goals: new Map() }; }

async function cachedHeadsByAnchorKey(cache: HeadCache, records: RecordLookupPort, projectId: string, anchorKey: string):
Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const key = `${projectId}\u0000${anchorKey}`;
  const hit = cache.anchors.get(key);
  if (hit !== undefined) return hit;
  const value = await headsByAnchorKey(records, projectId, anchorKey);
  cache.anchors.set(key, value);
  return value;
}

async function cachedCurrentHeadsForGoal(cache: HeadCache, records: RecordLookupPort, projectId: string, goalId: string):
Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const key = `${projectId}\u0000${goalId}`;
  const hit = cache.goals.get(key);
  if (hit !== undefined) return hit;
  const value = await currentHeadsForGoal(records, projectId, goalId);
  cache.goals.set(key, value);
  return value;
}

/** The head fields the conflict/quota derivations need (head or one version). */
export type NoteHeadLike = { noteId: string; kind: NoteHeadSnapshot['kind']; state: NoteHeadSnapshot['state'];
  topicKey: string; contradicts: readonly string[]; replaces: readonly string[]; coexistWith: readonly string[];
  anchorKey0: string; anchorKey1: string | null; anchorKey2: string | null; anchorKey3: string | null; anchorKey4: string | null };

export type NoteHeadDerivations = {
  conflictingOf(projectId: string, head: NoteHeadLike, cache: HeadCache): Promise<ReadOutcome<boolean>>;
  overQuotaOf(projectId: string, head: NoteHeadSnapshot, cache: HeadCache): Promise<ReadOutcome<boolean>>;
};

/**
 * Slice 4B: `conflicting`/`overQuota` are stored-head derivations shared by the
 * read model and the injected `NoteCheckPort` (one implementation, L22).
 */
export function createNoteHeadDerivations(records: GoalRecordTransactionPort & RecordLookupPort,
  anchorQuota: number, goalQuota: number): NoteHeadDerivations {
  async function conflictingOf(projectId: string, head: NoteHeadLike, cache: HeadCache): Promise<ReadOutcome<boolean>> {
    for (const other of head.contradicts) {
      const otherHead = await readHeadRecord(records, projectId, other);
      if (!otherHead.ok) return otherHead;
      if (otherHead.value !== null && (otherHead.value.state === 'accepted' || otherHead.value.state === 'reviewed')) {
        return { ok: true, value: true };
      }
    }
    const keys = [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
      .filter((key): key is string => key !== null);
    // L9/should-2: the inferred same-topic conflict needs BOTH general notes to be
    // current; the contradicts branch above keeps L9's own wording (the other is
    // current) and is not guarded by the subject's state.
    const headCurrent = head.state === 'accepted' || head.state === 'reviewed';
    for (const key of keys) {
      const others = await cachedHeadsByAnchorKey(cache, records, projectId, key);
      if (!others.ok) return others;
      for (const other of others.value) {
        if (other.noteId === head.noteId) continue;
        if (other.state !== 'accepted' && other.state !== 'reviewed') continue;
        if (other.contradicts.includes(head.noteId)) return { ok: true, value: true };
        if (headCurrent && isGeneral(other.kind) && isGeneral(head.kind) && other.topicKey === head.topicKey
          && !head.contradicts.includes(other.noteId) && !head.replaces.includes(other.noteId)
          && !head.coexistWith.includes(other.noteId) && !other.contradicts.includes(head.noteId)
          && !other.replaces.includes(head.noteId) && !other.coexistWith.includes(head.noteId)) return { ok: true, value: true };
      }
    }
    return { ok: true, value: false };
  }

  async function overQuotaOf(projectId: string, head: NoteHeadSnapshot, cache: HeadCache): Promise<ReadOutcome<boolean>> {
    // L7/R6: each quota counts its own population. The anchor quota flags only a
    // current general note (accepted/reviewed); the goal quota flags any counted
    // state (accepted/reviewed/pending_review/staged) of a note that has a goal.
    if (isGeneral(head.kind) && (head.state === 'accepted' || head.state === 'reviewed')) {
      const keys = [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
        .filter((key): key is string => key !== null);
      for (const key of keys) {
        const heads = await cachedHeadsByAnchorKey(cache, records, projectId, key);
        if (!heads.ok) return heads;
        const count = heads.value.filter(candidate => isGeneral(candidate.kind)
          && (candidate.state === 'accepted' || candidate.state === 'reviewed')).length;
        if (count > anchorQuota) return { ok: true, value: true };
      }
    }
    const goalCounted = head.state === 'accepted' || head.state === 'reviewed'
      || head.state === 'pending_review' || head.state === 'staged';
    if (head.goalId !== null && goalCounted) {
      const heads = await cachedCurrentHeadsForGoal(cache, records, projectId, head.goalId);
      if (!heads.ok) return heads;
      if (heads.value.length > goalQuota) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }
  return { conflictingOf, overQuotaOf };
}

export function createNoteReadModel(deps: NoteReadDependencies): NoteReadPort & NoteMemoryReadPort {
  const anchorQuota = deps.anchorQuota ?? NOTE_ANCHOR_QUOTA;
  const goalQuota = deps.goalQuota ?? NOTE_GOAL_QUOTA;
  const anchorFacts: NoteAnchorFactsDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }) };
  const derivations = createNoteHeadDerivations(deps.records, anchorQuota, goalQuota);
  const conflictingOf = derivations.conflictingOf;
  const overQuotaOf = derivations.overQuotaOf;

  function itemOfHead(head: NoteHeadSnapshot, projectId: string,
    cache: HeadCache): Promise<ReadOutcome<NoteItemV1>> {
    return (async () => {
      const conflicting = await conflictingOf(projectId, head, cache);
      if (!conflicting.ok) return conflicting;
      const overQuota = await overQuotaOf(projectId, head, cache);
      if (!overQuota.ok) return overQuota;
      return { ok: true, value: {
        noteId: head.noteId, version: head.version, storedState: head.state, kind: head.kind, topic: head.topic,
        topicKey: head.topicKey, conclusion: head.conclusion, anchor: head.anchor, extraAnchors: head.extraAnchors,
        source: head.source, goalId: head.goalId, replaces: [...head.replaces], contradicts: [...head.contradicts],
        coexistWith: [...head.coexistWith], confirmedByUser: head.confirmedByUser,
        freshness: 'unchecked', changedFiles: [], observedFiles: [], staleReasons: [],
        sourceUnavailable: false, invalid: false, conflicting: conflicting.value,
        overQuota: overQuota.value, updateDue: null, currentEligible: false, crossGoal: false,
        anchorStatus: 'live', anchorRetiredReasons: [], retiredExtraAnchors: [],
        unresolvedFacts: [], uncheckedFacts: head.facts.map((_, index) => index), hints: [], matchedTerms: [], score: 0,
        ...(head.sections === undefined ? {} : { sections: head.sections }),
      } } satisfies ReadOutcome<NoteItemV1>;
    })();
  }

  function itemOfVersion(version: NoteVersionSnapshot, confirmedByUser: boolean): NoteItemV1 {
    return {
      noteId: version.noteId, version: version.version, storedState: version.state, kind: version.kind,
      topic: version.topic, topicKey: version.topicKey, conclusion: version.conclusion, anchor: version.anchor,
      extraAnchors: version.extraAnchors, source: version.source, goalId: version.goalId,
      replaces: [...version.replaces], contradicts: [...version.contradicts], coexistWith: [...version.coexistWith],
      confirmedByUser,
      freshness: 'unchecked', changedFiles: [], observedFiles: [], staleReasons: [],
      sourceUnavailable: false, invalid: false, conflicting: false, overQuota: false, updateDue: null,
      currentEligible: false, crossGoal: false, anchorStatus: 'live', anchorRetiredReasons: [],
      retiredExtraAnchors: [], unresolvedFacts: [], uncheckedFacts: version.facts.map((_, index) => index),
      hints: [], matchedTerms: [], score: 0,
      ...(version.sections === undefined ? {} : { sections: version.sections }),
    };
  }

  /**
   * Slice 4B R3/L22: replace an item's 4A unchecked fields with the injected
   * check's derived fields, including the check-owned `observedFiles` (the read
   * model no longer reads files itself). A rejected check is returned, never
   * flattened into the unchecked defaults. `headVersions` names the head version
   * of each item's note; any other version is a historical item (R11: only the
   * head version can be `currentEligible`).
   */
  async function withCheck<T extends NoteItemV1>(ctx: CoreCallContext, items: T[],
    headVersions?: ReadonlyMap<string, number>): Promise<ReadOutcome<T[]>> {
    if (deps.check === undefined || items.length === 0) return { ok: true, value: items };
    const result = await deps.check.checkNotes(ctx,
      { items: items.map(item => ({ noteId: item.noteId, version: item.version })) });
    if (result.status !== 'ready') {
      if (result.status === 'rejected') {
        const mapped = mapStoreFailure(result);
        return { ok: false, code: mapped.code, reason: mapped.reason };
      }
      if (result.status === 'not_found') return { ok: false, code: 'not_found', reason: 'the check target does not exist' };
      return { ok: false, code: 'unavailable', reason: 'the note check is not ready' };
    }
    const out = items.map((item, index) => {
      const check = result.value[index]!;
      const headVersion = headVersions?.get(item.noteId);
      const currentEligible = headVersion === undefined || headVersion === item.version
        ? check.currentEligible : false;
      return { ...item, freshness: check.freshness, changedFiles: check.changedFiles, staleReasons: check.staleReasons,
        observedFiles: check.observedFiles,
        sourceUnavailable: check.sourceUnavailable, invalid: check.invalid, conflicting: check.conflicting,
        overQuota: check.overQuota, updateDue: check.updateDue, currentEligible,
        anchorStatus: check.anchorStatus, anchorRetiredReasons: check.anchorRetiredReasons,
        retiredExtraAnchors: check.retiredExtraAnchors, unresolvedFacts: check.unresolvedFacts,
        uncheckedFacts: check.uncheckedFacts, hints: check.hints };
    });
    return { ok: true, value: out as T[] };
  }

  async function pointerOf(projectId: string, anchor: NoteAnchorV1):
  Promise<ReadOutcome<{ noteId: string | null; revision: number | null } | null>> {
    if (anchor.kind !== 'goal' && anchor.kind !== 'stage') return { ok: true, value: null };
    const anchorKey = anchorKeyOf(anchor);
    const refKey = currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId, anchorKey });
    const read = await deps.records.readMany([refKey]);
    if (read.status !== 'ready') return asOutcome(read);
    const record = read.value.records.find(candidate => candidate.refKey === refKey);
    if (record === undefined) return { ok: true, value: { noteId: null, revision: null } };
    const decoded = decodeCurrentPointerSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged current pointer' };
    return { ok: true, value: { noteId: decoded.value.noteId, revision: decoded.value.revision } };
  }

  /** L2a class 2/R9: is this anchor key backed by a real object now? Failed reads carry no candidates. */
  async function anchorExistsNow(ctx: CoreCallContext, anchor: NoteAnchorV1): Promise<AnchorExistence> {
    const draft: NoteDraftAnchorV1 = anchor.kind === 'file'
      ? { kind: 'file', path: anchor.path, ...(anchor.deleted === true ? { deleted: true as const } : {}) }
      : anchor;
    const goalId = 'goalId' in anchor ? anchor.goalId : null;
    // Item 7: the same narrow anchor-facts reader as the writer, with no L11
    // basis reads (an existence check needs none).
    const resolved = await resolveNoteAnchors(ctx,
      { main: draft, extraAnchors: [], goalId, includeBasis: false }, anchorFacts);
    if (resolved.status === 'ok') return { ok: true, exists: true };
    if (resolved.code === 'invalid' && resolved.reason === 'anchor_not_found') {
      return { ok: true, exists: false,
        ...(resolved.anchorCandidates === undefined ? {} : { anchorCandidates: resolved.anchorCandidates }),
        ...(resolved.candidatesUnavailable === true ? { candidatesUnavailable: true } : {}) };
    }
    return { ok: false, code: resolved.code as ReadFailureCode | 'forbidden', reason: resolved.reason };
  }

  // ========================================================================
  // Slice 4B G3: the six memory reads (L9–L12). Every candidate comes from the
  // existing head indexes; the full-text port is only consulted when terms are
  // given. Reads go to the end of the candidate set and page over candidates
  // with L12's stable cursor (request + record cursor + last key).
  // ========================================================================

  const textSearchCandidateMax = deps.textSearchCandidateMax ?? TEXT_SEARCH_CANDIDATE_MAX;
  const textSearchMaxTerms = deps.textSearchMaxTerms ?? TEXT_SEARCH_MAX_TERMS;
  const RULE_VERSION = 1;
  const resultMaxBytes = deps.resultMaxBytes ?? MEMORY_RESULT_MAX_BYTES;
  const ALL_STATES: readonly NoteState[] = ['staged', 'accepted', 'reviewed', 'pending_review', 'rejected',
    'superseded', 'withdrawn'];

  function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

  async function ledgerCursor(): Promise<ReadOutcome<string | null>> {
    const read = await deps.records.readMany([]);
    if (read.status !== 'ready') return asOutcome(read);
    return { ok: true, value: read.value.readThrough };
  }

  function currentGoalIdOf(ctx: CoreCallContext): string | null {
    return ctx.principal.kind === 'work_run' ? ctx.principal.runRef.goalId : null;
  }

  /**
   * R10/MF10: exactly 4A's `principalOf` projection (copied; `note-service`
   * imports this module, so it cannot be shared by import). A cursor from a
   * different caller, goal or actor kind cannot replay.
   */
  function principalProjection(ctx: CoreCallContext): unknown {
    const principal = ctx.principal;
    if (principal.kind === 'host') {
      return { kind: 'host', actor: { kind: principal.actor.kind, id: principal.actor.id } };
    }
    if (principal.kind === 'work_run') {
      return { kind: 'work_run', runRef: { projectId: principal.runRef.projectId,
        goalId: principal.runRef.goalId, runId: principal.runRef.runId } };
    }
    return { kind: 'query_run', queryRunRef: { ...principal.queryRunRef } };
  }

  /** L12: the cursor binds the call's identity (project, workspace, principal). */
  function callerIdentityOf(ctx: CoreCallContext): string {
    return `${ctx.projectId}\u0000${ctx.workspaceId ?? ''}\u0000${JSON.stringify(principalProjection(ctx))}`;
  }

  function isCrossGoal(head: NoteHeadSnapshot, currentGoalId: string | null): boolean {
    return currentGoalId !== null && head.goalId !== currentGoalId;
  }

  function lookupTier(head: NoteHeadSnapshot, currentGoalId: string | null): number {
    if (!isCrossGoal(head, currentGoalId)) return 0;
    return head.confirmedByUser ? 1 : 2;
  }

  function anchorKeysOf(head: NoteHeadSnapshot): string[] {
    return [head.anchorKey0, head.anchorKey1, head.anchorKey2, head.anchorKey3, head.anchorKey4]
      .filter((key): key is string => key !== null);
  }

  function matchesPathPrefix(key: string, prefix: string): boolean {
    const base = `file:${prefix}`;
    return key === base || key.startsWith(`${base}/`);
  }

  /**
   * P7/R6/MF6a: range-read the five ordered path indexes from the file key of
   * the prefix. The ordered text order is UTF-8 byte order, so `file:src/a-b/y.ts`
   * and `file:src/a.ts` sort between `file:src/a` and `file:src/a/x.ts`. Stop only
   * when the key leaves the whole `file:<prefix>*` range; a sibling that merely
   * fails the directory boundary is skipped, not treated as the end.
   */
  async function headsOnPathPrefix(projectId: string, prefix: string): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
    const wanted = `file:${prefix}`;
    const seen = new Map<string, NoteHeadSnapshot>();
    for (const [ordinal, index] of S4B_NOTE_BY_PATH_LOOKUPS.entries()) {
      let after: { order: string | number; refKey: string } | undefined;
      for (;;) {
        const page = await deps.records.lookupOrdered({ index, values: [projectId], direction: 'asc',
          bound: { value: wanted, inclusive: true }, ...(after === undefined ? {} : { after }), limit: 200 });
        if (page.status !== 'ready') return asOutcome(page);
        let leftRange = false;
        for (const record of page.value.records) {
          const decoded = decodeNoteHeadSnapshot(record);
          if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
          const slot = (decoded.value as unknown as Record<string, unknown>)[`anchorKey${String(ordinal)}`];
          if (typeof slot !== 'string' || !slot.startsWith(wanted)) { leftRange = true; break; }
          if (!matchesPathPrefix(slot, prefix)) continue;
          seen.set(decoded.value.noteId, decoded.value);
        }
        if (leftRange || page.value.next === null) break;
        after = page.value.next;
      }
    }
    return { ok: true, value: [...seen.values()] };
  }

  async function headsOnReviewStatus(projectId: string, goalId: string | null,
    states: readonly NoteState[]): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
    const seen = new Map<string, NoteHeadSnapshot>();
    for (const state of states) {
      const page = await readAllHeads(deps.records, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, [projectId, goalId, state]);
      if (!page.ok) return page;
      for (const head of page.heads) seen.set(head.noteId, head);
    }
    return { ok: true, value: [...seen.values()] };
  }

  /** P7: the project's goals (the `a2-goal-by-workspace` index) plus the project slot. */
  async function projectGoalIds(ctx: CoreCallContext): Promise<ReadOutcome<string[]>> {
    const page = await readAllRecords(deps.records, GOAL_BY_WORKSPACE_INDEX, [ctx.projectId, ctx.workspaceId ?? '']);
    if (!page.ok) return page;
    const ids: string[] = [];
    for (const record of page.value) {
      const decoded = decodeGoalSnapshot(record);
      // §9: a damaged Goal record is `unavailable`, never a silently shorter list.
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'a goal record is damaged' };
      ids.push(decoded.value.ref.goalId);
    }
    return { ok: true, value: ids };
  }

  type MemoryCursor = { after: string | null; recordCursor: string | null; identity: string };

  function encodeMemoryCursor(ctx: CoreCallContext, op: string, request: unknown,
    state: { after: string | null; recordCursor: string | null }): string {
    return JSON.stringify({ v: 1, op, id: callerIdentityOf(ctx), rule: RULE_VERSION, request,
      after: state.after, cursor: state.recordCursor });
  }

  function parseMemoryCursor(ctx: CoreCallContext, cursor: string | null, op: string, request: unknown):
  { ok: true; value: MemoryCursor } | { ok: false; code: ReadFailureCode; reason: string } {
    const identity = callerIdentityOf(ctx);
    if (cursor === null) return { ok: true, value: { after: null, recordCursor: null, identity } };
    try {
      const parsed = JSON.parse(cursor) as Record<string, unknown>;
      if (parsed['v'] !== 1 || parsed['op'] !== op) return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      // L12: the cursor binds the caller's identity; another identity is a mismatch.
      if (parsed['id'] !== identity) return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      // R10: the cursor binds the actual rule-version constant, not a literal.
      if (parsed['rule'] !== RULE_VERSION) return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      if (JSON.stringify(parsed['request']) !== JSON.stringify(request)) {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
      const after = parsed['after'];
      const record = parsed['cursor'];
      if (!(after === null || typeof after === 'string') || !(record === null || typeof record === 'string')) {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
      return { ok: true, value: { after: after as string | null, recordCursor: record as string | null, identity } };
    } catch {
      return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
    }
  }

  async function checkedPage(ctx: CoreCallContext, heads: readonly NoteHeadSnapshot[],
    currentGoalId: string | null): Promise<ReadOutcome<NoteItemV1[]>> {
    const cache = newHeadCache();
    const built: NoteItemV1[] = [];
    for (const head of heads) {
      const item = await itemOfHead(head, ctx.projectId, cache);
      if (!item.ok) return item;
      built.push(item.value);
    }
    const checked = await withCheck(ctx, built);
    if (!checked.ok) return checked;
    return { ok: true, value: checked.value.map(item => ({ ...item,
      crossGoal: currentGoalId !== null && item.goalId !== currentGoalId })) };
  }

  function observedFilesOf(items: readonly NoteItemV1[]): NoteFileObservationV1[] {
    const seen = new Map<string, NoteFileObservationV1>();
    for (const item of items) for (const observation of item.observedFiles) seen.set(observation.path, observation);
    return [...seen.values()];
  }

  /** R3: `filesRead` counts distinct paths actually read; a budget-exhausted path was not. */
  function filesReadOf(items: readonly NoteItemV1[]): number {
    const seen = new Set<string>();
    for (const item of items) {
      for (const observation of item.observedFiles) if (observation.outcome !== 'unchecked') seen.add(observation.path);
    }
    return seen.size;
  }

  function coverageOf(items: readonly NoteItemV1[]): MemoryResultV1['coverage'] {
    let checked = 0;
    let unchecked = 0;
    for (const item of items) {
      if (item.freshness === 'unchecked') unchecked += 1;
      else checked += 1;
    }
    return { checkedItems: checked, uncheckedItems: unchecked, filesRead: filesReadOf(items) };
  }

  /**
   * R12/L12: the whole result JSON stays under the byte bound. Drop trailing
   * items, recomputing `readBasis.observedFiles` and `coverage` over the kept
   * items; a single item that alone exceeds the bound is returned alone with the
   * `result_over_byte_bound` warning and `complete: false` when more remain.
   */
  function fitToByteBound<T extends NoteItemV1, R extends { items: T[]; next: string | null;
    complete: boolean; coverage: MemoryResultV1['coverage']; readBasis: MemoryReadBasis; warnings: string[] }>(
    result: R, maxBytes: number,
    afterOf: (kept: T[]) => string | null, cursorFor: (after: string) => string,
  ): R {
    let current = result;
    let dropped = false;
    const bytes = (candidate: R): number => Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    while (current.items.length > 1 && bytes(current) > maxBytes) {
      const kept = current.items.slice(0, current.items.length - 1);
      const last = afterOf(kept);
      current = { ...current, items: kept, complete: false,
        next: last === null ? current.next : cursorFor(last),
        readBasis: { ...current.readBasis, observedFiles: observedFilesOf(kept) },
        coverage: coverageOf(kept) };
      dropped = true;
    }
    if (bytes(current) > maxBytes) {
      const kept = current.items;
      const last = kept.length === 0 ? null : afterOf(kept);
      const more = dropped || result.items.length > 1 || result.next !== null;
      const next = more && last !== null ? cursorFor(last) : (more ? result.next : null);
      current = { ...current,
        warnings: current.warnings.includes('result_over_byte_bound') ? current.warnings
          : [...current.warnings, 'result_over_byte_bound'],
        ...(more ? { next, complete: false } : {}) };
    }
    return current;
  }

  function basisOf(recordCursor: string | null, items: readonly NoteItemV1[]): MemoryReadBasis {
    return { recordCursor, ruleVersion: RULE_VERSION, observedFiles: observedFilesOf(items) };
  }

  function sliceByCursor<T extends { noteId: string }>(all: readonly T[], after: string | null, limit: number):
  { ok: true; page: T[]; complete: boolean; last: string | null } | { ok: false; code: ReadFailureCode; reason: string } {
    let start = 0;
    if (after !== null) {
      const index = all.findIndex(item => item.noteId === after);
      if (index < 0) return { ok: false, code: 'revision_conflict', reason: 'the cursor target changed' };
      start = index + 1;
    }
    const page = all.slice(start, start + limit);
    const complete = start + limit >= all.length;
    return { ok: true, page, complete, last: page.length === 0 ? null : page[page.length - 1]!.noteId };
  }

  // --- L10 text matching / scoring (P1) ----------------------------------

  type SearchSegments = { topicKey: string; conclusion: string; body: string; all: string };

  function segmentsOf(head: { topic: string; topicKey: string; conclusion: string; body: string }): SearchSegments {
    const topic = normalizeSearchText(head.topic);
    const conclusion = normalizeSearchText(head.conclusion);
    const body = normalizeSearchText(head.body);
    // L10: the weight asks the stored `topicKey` literally; the substring match
    // itself still uses the normalized comparison text.
    return { topicKey: head.topicKey, conclusion, body, all: `${topic}\n${conclusion}\n${body}` };
  }

  function weightOf(segments: SearchSegments, term: string): number {
    if (segments.topicKey.includes(term)) return NOTE_RANK_WEIGHT_TOPIC;
    if (segments.conclusion.includes(term)) return NOTE_RANK_WEIGHT_CONCLUSION;
    if (segments.body.includes(term)) return NOTE_RANK_WEIGHT_BODY;
    return 0;
  }

  function normalizeTerms(terms: readonly string[]):
  { ok: true; value: string[] } | { ok: false; reason: string } {
    if (terms.length < 1 || terms.length > textSearchMaxTerms) {
      return { ok: false, reason: `terms must be 1–${String(textSearchMaxTerms)}` };
    }
    const out: string[] = [];
    for (const raw of terms) {
      if (typeof raw !== 'string') return { ok: false, reason: 'each term must be a string' };
      const normalized = normalizeSearchText(raw);
      const length = [...normalized].length;
      if (length < NOTE_TEXT_TERM_MIN || length > NOTE_TEXT_TERM_MAX || /\s/.test(normalized)) {
        return { ok: false, reason: `each term must be ${String(NOTE_TEXT_TERM_MIN)}–${String(NOTE_TEXT_TERM_MAX)} code points without whitespace` };
      }
      out.push(normalized);
    }
    return { ok: true, value: out };
  }

  function kindMatches(kind: string, filter: NoteItemV1['kind'] | 'general' | undefined): boolean {
    if (filter === undefined) return true;
    if (filter === 'general') return isGeneral(kind);
    return kind === filter;
  }

  function headMatchesFilters(head: NoteHeadSnapshot, input: MemoryFindRequest): boolean {
    if (!kindMatches(head.kind, input.kind)) return false;
    if (input.state !== undefined && head.state !== input.state) return false;
    if (input.topic !== undefined && head.topicKey !== topicKeyOf(input.topic)) return false;
    return true;
  }

  /**
   * R6/MF6b: one scope predicate used by every `find` candidate source. An
   * anchor needs the exact key in a slot; a pathPrefix needs a file slot on the
   * directory boundary; a supplied filter applies (AND).
   */
  function headInScope(head: NoteHeadSnapshot, input: MemoryFindRequest): boolean {
    if (!headMatchesFilters(head, input)) return false;
    if (input.anchor !== undefined && !anchorKeysOf(head).includes(anchorKeyOf(input.anchor))) return false;
    if (input.pathPrefix !== undefined) {
      const prefix = input.pathPrefix;
      if (!anchorKeysOf(head).some(key => key.startsWith('file:') && matchesPathPrefix(key, prefix))) return false;
    }
    return true;
  }

  type Ranked = { head: NoteHeadSnapshot; matchedTerms: string[]; score: number };

  function rankMatches(heads: readonly NoteHeadSnapshot[], terms: readonly string[]):
  { ranked: Ranked[]; partial: boolean } {
    const scoped = [...heads].sort((l, r) => compareText(l.noteId, r.noteId));
    const partial = scoped.length > textSearchCandidateMax;
    const capped = partial ? scoped.slice(0, textSearchCandidateMax) : scoped;
    const segments = new Map<string, SearchSegments>();
    for (const head of capped) segments.set(head.noteId, segmentsOf(head));
    const documentFrequency = new Map<string, number>();
    for (const term of terms) {
      let count = 0;
      for (const head of capped) if (segments.get(head.noteId)!.all.includes(term)) count += 1;
      documentFrequency.set(term, count);
    }
    const U = capped.length;
    const ranked = capped.map(head => {
      const segmentsOfHead = segments.get(head.noteId)!;
      const matchedTerms = terms.filter(term => segmentsOfHead.all.includes(term));
      let score = 0;
      for (const term of matchedTerms) {
        const df = documentFrequency.get(term) ?? 0;
        if (df > 0) score += weightOf(segmentsOfHead, term) * Math.log(1 + U / df);
      }
      return { head, matchedTerms, score };
    });
    ranked.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.matchedTerms.length !== right.matchedTerms.length) return right.matchedTerms.length - left.matchedTerms.length;
      return compareText(left.head.noteId, right.head.noteId);
    });
    return { ranked, partial };
  }

  /**
   * R7/MF7a: for `match:'all'` every term is in every match, so `df === U` and
   * `r(t) = ln(1 + U/U) = ln 2`; the score needs no match-set size and nothing is
   * truncated. Terms are stored per head in byte order.
   */
  function rankAll(heads: readonly NoteHeadSnapshot[], terms: readonly string[]):
  Map<string, { matchedTerms: string[]; score: number }> {
    const scores = new Map<string, { matchedTerms: string[]; score: number }>();
    for (const head of heads) {
      const segments = segmentsOf(head);
      const matchedTerms = terms.filter(term => segments.all.includes(term));
      let score = 0;
      for (const term of matchedTerms) {
        const weight = weightOf(segments, term);
        if (weight > 0) score += weight * Math.LN2;
      }
      scores.set(head.noteId, { matchedTerms, score });
    }
    return scores;
  }

  type SearchPageOutcome = { ok: true; records: EncodedRecord[]; next: string | null; complete: boolean }
    | { ok: false; code: ReadFailureCode | 'unsupported'; reason: string };

  /** MF7b: an FTS5 `unsupported` page stays `unsupported`, never `unavailable`. */
  async function searchPage(projectId: string, terms: readonly string[], limit: number,
    after: string | undefined): Promise<SearchPageOutcome> {
    const page = await deps.records.searchText({ index: S4_NOTE_TEXT_LOOKUP, values: [projectId], terms,
      limit, ...(after === undefined ? {} : { after }) });
    if (page.status !== 'ready') {
      if (page.code === 'unsupported') return { ok: false, code: 'unsupported', reason: page.reason };
      return asOutcome(page);
    }
    return { ok: true, records: page.value.records, next: page.value.next, complete: page.value.complete };
  }

  /**
   * R7 lead ruling: `'all'` pages the port in refKey order with exactly ONE
   * port call per memory page, from the caller's last examined refKey. The
   * page returns the filtered matches of that port page (fewer than `limit` is
   * fine, as is empty); whenever the port page was not complete the memory page
   * is `complete: false` with the port's next cursor. The old short-page
   * heuristic is removed: a short page is not evidence of candidate-budget
   * exhaustion.
   */
  async function allTermHeads(ctx: CoreCallContext, input: MemoryFindRequest, terms: readonly string[],
    limit: number, cursorAfter: string | null):
  Promise<{ ok: true; value: { items: NoteHeadSnapshot[]; next: string | null } }
    | { ok: false; code: ReadFailureCode | 'unsupported'; reason: string }> {
    const page = await searchPage(ctx.projectId, terms, limit, cursorAfter ?? undefined);
    if (!page.ok) return page;
    const collected: NoteHeadSnapshot[] = [];
    const seen = new Set<string>();
    for (const record of page.records) {
      const decoded = decodeNoteHeadSnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
      const head = decoded.value;
      if (seen.has(head.noteId)) continue;
      seen.add(head.noteId);
      if (headInScope(head, input)) collected.push(head);
    }
    return { ok: true, value: { items: collected, next: page.complete ? null : page.next } };
  }

  type TermStream = { term: string; buffer: EncodedRecord[]; after: string | undefined; done: boolean };

  async function fillStream(projectId: string, stream: TermStream):
  Promise<{ ok: false; code: ReadFailureCode | 'unsupported'; reason: string } | null> {
    while (stream.buffer.length === 0 && !stream.done) {
      const page = await searchPage(projectId, [stream.term], 100, stream.after);
      if (!page.ok) return page;
      stream.buffer.push(...page.records);
      if (page.complete || page.next === null || page.next === stream.after) stream.done = true;
      else stream.after = page.next;
    }
    return null;
  }

  /**
   * R7/should-fix: `'any'` opens one port stream per term, merges them by
   * `compareText` (refKey order), dedupes, applies the non-text filters and stops
   * at the first `cap` in-scope matches (`cap+1` seen -> `partial`). The result
   * is identical to sorting the whole filtered set by noteId and taking `cap`.
   */
  async function anyTermHeads(ctx: CoreCallContext, input: MemoryFindRequest, terms: readonly string[]):
  Promise<{ ok: true; value: { items: NoteHeadSnapshot[]; partial: boolean } }
    | { ok: false; code: ReadFailureCode | 'unsupported'; reason: string }> {
    const streams: TermStream[] = terms.map(term => ({ term, buffer: [], after: undefined, done: false }));
    const collected: NoteHeadSnapshot[] = [];
    const seen = new Set<string>();
    let partial = false;
    for (;;) {
      for (const stream of streams) {
        if (stream.buffer.length === 0 && !stream.done) {
          const failure = await fillStream(ctx.projectId, stream);
          if (failure !== null) return failure;
        }
      }
      let minKey: string | null = null;
      for (const stream of streams) {
        const key = stream.buffer[0]?.refKey;
        if (key !== undefined && (minKey === null || compareText(key, minKey) < 0)) minKey = key;
      }
      if (minKey === null) break;
      let head: NoteHeadSnapshot | null = null;
      for (const stream of streams) {
        while (stream.buffer[0]?.refKey === minKey) {
          const record = stream.buffer.shift()!;
          if (head === null) {
            const decoded = decodeNoteHeadSnapshot(record);
            if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
            head = decoded.value;
          }
        }
      }
      if (head === null || seen.has(head.noteId)) continue;
      seen.add(head.noteId);
      if (!headInScope(head, input)) continue;
      if (collected.length >= textSearchCandidateMax) { partial = true; break; }
      collected.push(head);
    }
    return { ok: true, value: { items: collected, partial } };
  }

  // --- body paging (L12) --------------------------------------------------

  function sliceUtf8(text: string, offsetBytes: number, budgetBytes: number): { text: string; nextOffset: number | null } {
    const characters = [...text];
    const total = Buffer.byteLength(text, 'utf8');
    let bytes = 0;
    let index = 0;
    while (index < characters.length) {
      const length = Buffer.byteLength(characters[index]!, 'utf8');
      if (bytes + length > offsetBytes) break;
      bytes += length;
      index += 1;
    }
    const startIndex = index;
    let consumed = bytes;
    let out = '';
    for (let cursor = startIndex; cursor < characters.length; cursor += 1) {
      const length = Buffer.byteLength(characters[cursor]!, 'utf8');
      if (consumed + length - bytes > budgetBytes) break;
      out += characters[cursor];
      consumed += length;
    }
    return { text: out, nextOffset: consumed >= total ? null : consumed };
  }

  /**
   * R10/MF10: a body cursor binds the caller, noteId, requested version, rule,
   * offset and the note's HEAD version — even when the request pins a version.
   * A later head change is a `revision_conflict` for both pinned and unpinned
   * reads.
   */
  function bodyCursorOf(ctx: CoreCallContext, spec: { noteId: string; version?: number },
    readOp: 'lookup' | 'history', resolvedVersion: number, headVersion: number, offset: number): string {
    return JSON.stringify({ v: 1, op: 'body', id: callerIdentityOf(ctx), readOp, noteId: spec.noteId,
      requestedVersion: spec.version ?? null, rule: RULE_VERSION, at: resolvedVersion, head: headVersion, offset });
  }

  /** R10: an offset inside a code point (or past the end) is `cursor_mismatch`. */
  function isUtf8Boundary(text: string, offset: number): boolean {
    let bytes = 0;
    for (const character of text) {
      if (bytes === offset) return true;
      bytes += Buffer.byteLength(character, 'utf8');
      if (bytes > offset) return false;
    }
    return bytes === offset;
  }

  async function bodyPageOf(ctx: CoreCallContext, spec: { noteId: string; version?: number; cursor: string | null },
    readOp: 'lookup' | 'history'):
  Promise<ReadOutcome<{ noteId: string; version: number; text: string; next: string | null }>> {
    const head = await readHeadRecord(deps.records, ctx.projectId, spec.noteId);
    if (!head.ok) return head;
    if (head.value === null) return { ok: false, code: 'not_found', reason: 'the note does not exist' };
    const headVersion = head.value.version;
    let body = head.value.body;
    let resolved = headVersion;
    if (spec.version !== undefined && spec.version !== headVersion) {
      const read = await readVersionRecord(deps.records, ctx.projectId, spec.noteId, spec.version);
      if (!read.ok) return read;
      if (read.value === null) return { ok: false, code: 'not_found', reason: 'the note version does not exist' };
      body = read.value.body;
      resolved = read.value.version;
    }
    const requestedVersion = spec.version ?? null;
    let offset = 0;
    if (spec.cursor !== null) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(spec.cursor) as Record<string, unknown>;
      } catch {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
      if (parsed['v'] !== 1 || parsed['op'] !== 'body' || parsed['id'] !== callerIdentityOf(ctx)
        || parsed['readOp'] !== readOp || parsed['noteId'] !== spec.noteId
        || parsed['requestedVersion'] !== requestedVersion || parsed['rule'] !== RULE_VERSION
        || !Number.isSafeInteger(parsed['at']) || !Number.isSafeInteger(parsed['head'])
        || !Number.isSafeInteger(parsed['offset'])) {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
      // R10: the body cursor binds the head version even when the request pins a
      // version; a head change between pages is a revision conflict.
      if (headVersion !== parsed['head']) {
        return { ok: false, code: 'revision_conflict', reason: 'the note changed between pages' };
      }
      offset = parsed['offset'] as number;
      const total = Buffer.byteLength(body, 'utf8');
      if (offset < 0 || offset > total || !isUtf8Boundary(body, offset)) {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
    }
    const sliced = sliceUtf8(body, offset, NOTE_BODY_PAGE_BYTES);
    const next = sliced.nextOffset === null
      ? null : bodyCursorOf(ctx, spec, readOp, resolved, headVersion, sliced.nextOffset);
    return { ok: true, value: { noteId: spec.noteId, version: resolved, text: sliced.text, next } };
  }

  function topicGroups(heads: readonly NoteHeadSnapshot[], currentGoalId: string | null):
  { topics: { topic: string; count: number }[]; complete: boolean } {
    const groups = new Map<string, { topic: string; count: number; at: string }>();
    for (const head of heads) {
      if (head.state !== 'accepted' && head.state !== 'reviewed') continue;
      if (isCrossGoal(head, currentGoalId) && !(head.state === 'reviewed' || head.confirmedByUser)) continue;
      const entry = groups.get(head.topicKey);
      if (entry === undefined) groups.set(head.topicKey, { topic: head.topic, count: 1, at: head.createdAt });
      else {
        entry.count += 1;
        if (head.createdAt > entry.at) { entry.topic = head.topic; entry.at = head.createdAt; }
      }
    }
    const ordered = [...groups.entries()].sort((left, right) => compareText(left[0], right[0]))
      .map(([, value]) => value);
    return { topics: ordered.slice(0, MEMORY_TOPICS_MAX).map(entry => ({ topic: entry.topic, count: entry.count })),
      complete: ordered.length <= MEMORY_TOPICS_MAX };
  }

  async function understandingOf(ctx: CoreCallContext, anchor: NoteAnchorV1):
  Promise<ReadOutcome<UnderstandingStatusV1 | null>> {
    if (anchor.kind !== 'goal' && anchor.kind !== 'stage') return { ok: true, value: null };
    const pointer = await pointerOf(ctx.projectId, anchor);
    if (!pointer.ok) return pointer;
    return { ok: true, value: { anchorKey: anchorKeyOf(anchor),
      pointer: pointer.value ?? { noteId: null, revision: null }, updateDue: null, latestTriggerCursor: null } };
  }

  /** L12: a page defaults to 20 and is capped at 100. */
  function resolveMemoryLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) return MEMORY_PAGE_DEFAULT;
    return Math.min(limit, MEMORY_PAGE_MAX);
  }

  return {
    async readNote(ctx, input) {
      if (typeof input.noteId !== 'string' || input.noteId.length === 0) return rejected('invalid', 'a note id is required');
      if (input.version !== undefined) {
        const version = await readVersionRecord(deps.records, ctx.projectId, input.noteId, input.version);
        if (!version.ok) return rejected(version.code, version.reason);
        if (version.value === null) return { status: 'not_found' };
        // should-3: derive the historical confirmation from change.by; the head
        // value may stand in when the requested version IS the head version.
        const headRead = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
        if (!headRead.ok) return rejected(headRead.code, headRead.reason);
        const confirmed = await confirmedByUserOfVersion(deps.records, ctx.projectId, input.noteId, input.version,
          headRead.value);
        if (!confirmed.ok) return rejected(confirmed.code, confirmed.reason);
        // R11: only the note's head version can be a current conclusion.
        const checked = await withCheck(ctx, [itemOfVersion(version.value, confirmed.value)],
          new Map([[input.noteId, headRead.value === null ? -1 : headRead.value.version]]));
        if (!checked.ok) return rejected(checked.code, checked.reason);
        return { status: 'ready', value: checked.value[0]! };
      }
      const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
      if (!head.ok) return rejected(head.code, head.reason);
      if (head.value === null) return { status: 'not_found' };
      const item = await itemOfHead(head.value, ctx.projectId, newHeadCache());
      if (!item.ok) return rejected(item.code, item.reason);
      const checked = await withCheck(ctx, [item.value]);
      if (!checked.ok) return rejected(checked.code, checked.reason);
      return { status: 'ready', value: checked.value[0]! };
    },
    async listByAnchor(ctx, input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MEMORY_PAGE_MAX) {
        return rejected('invalid', 'limit must be 1–100');
      }
      const anchorKey = anchorKeyOf(input.anchor);
      let after: string | null = null;
      if (input.cursor !== null) {
        try {
          const parsed = JSON.parse(input.cursor) as { v?: unknown; anchorKey?: unknown; limit?: unknown; after?: unknown };
          if (parsed.v !== 1 || parsed.anchorKey !== anchorKey || parsed.limit !== input.limit
            || !(parsed.after === null || typeof parsed.after === 'string')) {
            return rejected('invalid', 'cursor_mismatch');
          }
          after = parsed.after as string | null;
        } catch {
          return rejected('invalid', 'cursor_mismatch');
        }
      }
      const headSet = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
      if (!headSet.ok) return rejected(headSet.code, headSet.reason);
      const all = headSet.value
        .filter(head => head.anchorKey0 === anchorKey || head.anchorKey1 === anchorKey || head.anchorKey2 === anchorKey
          || head.anchorKey3 === anchorKey || head.anchorKey4 === anchorKey)
        .sort((left, right) => left.createdAt === right.createdAt
          ? left.noteId.localeCompare(right.noteId) : left.createdAt.localeCompare(right.createdAt));
      if (all.length === 0) {
        const exists = await anchorExistsNow(ctx, input.anchor);
        if (!exists.ok) return rejected(exists.code, exists.reason);
        if (!exists.exists) return rejected('not_found', 'anchor_not_found');
      }
      let start = 0;
      if (after !== null) {
        const index = all.findIndex(head => head.noteId === after);
        // Item 4 fix 2: a cursor naming a note not on this anchor is a mismatch;
        // never silently restart at the first page.
        if (index < 0) return rejected('invalid', 'cursor_mismatch');
        start = index + 1;
      }
      const page = all.slice(start, start + input.limit);
      const items: NoteItemV1[] = [];
      const cache = newHeadCache();
      for (const head of page) {
        const item = await itemOfHead(head, ctx.projectId, cache);
        if (!item.ok) return rejected(item.code, item.reason);
        items.push(item.value);
      }
      const checked = await withCheck(ctx, items);
      if (!checked.ok) return rejected(checked.code, checked.reason);
      const next = start + input.limit < all.length
        ? JSON.stringify({ v: 1, anchorKey, limit: input.limit, after: page[page.length - 1]!.noteId })
        : null;
      const pointer = await pointerOf(ctx.projectId, input.anchor);
      if (!pointer.ok) return rejected(pointer.code, pointer.reason);
      const result: NotePageV1 = { items: checked.value, next, complete: next === null, pointer: pointer.value };
      return { status: 'ready', value: result };
    },

    async memoryLookup(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      // R10: the outer cursor binds the body TARGET, not the body cursor, so the
      // item page and the body page advance independently.
      const request = { op: 'lookup', anchor: input.anchor, limit,
        body: input.body === undefined ? null : { noteId: input.body.noteId, version: input.body.version ?? null } };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'lookup', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      const anchorKey = anchorKeyOf(input.anchor);
      const headSet = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
      if (!headSet.ok) return rejected(headSet.code, headSet.reason);
      const onAnchor = headSet.value.filter(head => anchorKeysOf(head).includes(anchorKey));
      if (onAnchor.length === 0) {
        const exists = await anchorExistsNow(ctx, input.anchor);
        if (!exists.ok) return rejected(exists.code, exists.reason);
        if (!exists.exists) return anchorNotFound(exists.anchorCandidates, exists.candidatesUnavailable);
      }
      const currentGoalId = currentGoalIdOf(ctx);
      const ordered = [...onAnchor].sort((left, right) => {
        const tiers = lookupTier(left, currentGoalId) - lookupTier(right, currentGoalId);
        return tiers !== 0 ? tiers : compareText(left.noteId, right.noteId);
      });
      const slice = sliceByCursor(ordered, cursor.value.after, limit);
      if (!slice.ok) return rejected(slice.code, slice.reason);
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalId);
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      // R9: list the anchor's heads by stored state, never filter by
      // `currentEligible` (a stale or retired head is still listed). Cross-goal
      // visibility keeps L9's rule (other goals only when reviewed or confirmed).
      let items = pageBuilt.value.filter(item => {
        const listed = item.storedState === 'accepted' || item.storedState === 'reviewed'
          || item.storedState === 'pending_review' || item.storedState === 'staged';
        if (!listed) return false;
        const cross = currentGoalId !== null && item.goalId !== currentGoalId;
        return !cross || item.storedState === 'reviewed' || item.confirmedByUser;
      });
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'lookup', request,
        { after: slice.last, recordCursor: current.value });
      const understanding = await understandingOf(ctx, input.anchor);
      if (!understanding.ok) return rejected(understanding.code, understanding.reason);
      const groups = topicGroups(onAnchor, currentGoalId);
      const warnings: string[] = [];
      let bodyTarget: { noteId: string; version: number } | null = null;
      if (input.body !== undefined) {
        const body = await bodyPageOf(ctx, input.body, 'lookup');
        if (!body.ok) return rejected(body.code, body.reason);
        bodyTarget = { noteId: body.value.noteId, version: body.value.version };
        items = items.map(item => {
          if (item.noteId !== body.value.noteId || item.version !== body.value.version) return item;
          return { ...item, body: { text: body.value.text, next: body.value.next } };
        });
      }
      const result: MemoryLookupResultV1 = { readBasis: basisOf(current.value, items), items,
        warnings, next, complete: next === null, coverage: coverageOf(pageBuilt.value),
        understanding: understanding.value, topics: groups.topics, topicsComplete: groups.complete };
      const fitted = fitToByteBound(result, resultMaxBytes,
        kept => kept[kept.length - 1]!.noteId,
        after => encodeMemoryCursor(ctx, 'lookup', request, { after, recordCursor: current.value }));
      // R11: the warning is computed AFTER the byte trim removed items, so a
      // body target whose item was trimmed is still reported.
      if (bodyTarget !== null
        && !fitted.items.some(item => item.noteId === bodyTarget!.noteId && item.version === bodyTarget!.version)
        && !fitted.warnings.includes('body_target_not_on_page')) {
        fitted.warnings.push('body_target_not_on_page');
      }
      return { status: 'ready', value: fitted };
    },

    async memoryHistory(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      const request = { op: 'history', noteId: input.noteId, limit,
        body: input.body === undefined ? null : { noteId: input.body.noteId, version: input.body.version ?? null } };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'history', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
      if (!head.ok) return rejected(head.code, head.reason);
      if (head.value === null) return { status: 'not_found' };
      const headVersion = head.value.version;
      // R11: list and slice the version numbers first; only the page's versions
      // are read, confirmed, observed and checked (the per-page budgets stay per
      // page).
      const versions: number[] = [];
      for (let version = headVersion; version >= 1; version -= 1) versions.push(version);
      let start = 0;
      if (cursor.value.after !== null) {
        const target = Number(cursor.value.after);
        const index = versions.indexOf(target);
        if (index < 0) return rejected('revision_conflict', 'the cursor target changed');
        start = index + 1;
      }
      const pageVersions = versions.slice(start, start + limit);
      const complete = start + limit >= versions.length;
      const base: NoteHistoryItemV1[] = [];
      for (const version of pageVersions) {
        const read = await readVersionRecord(deps.records, ctx.projectId, input.noteId, version);
        if (!read.ok) return rejected(read.code, read.reason);
        if (read.value === null) return rejected('unavailable', 'a note version is missing');
        const confirmed = await confirmedByUserOfVersion(deps.records, ctx.projectId, input.noteId, version, head.value);
        if (!confirmed.ok) return rejected(confirmed.code, confirmed.reason);
        base.push({ ...itemOfVersion(read.value, confirmed.value),
          change: read.value.change, since: read.value.since });
      }
      const checked = await withCheck(ctx, base, new Map([[input.noteId, headVersion]]));
      if (!checked.ok) return rejected(checked.code, checked.reason);
      const historyGoalId = currentGoalIdOf(ctx);
      let items = checked.value.map(item => ({ ...item,
        crossGoal: historyGoalId !== null && item.goalId !== historyGoalId }));
      const next = complete ? null : encodeMemoryCursor(ctx, 'history', request,
        { after: String(pageVersions[pageVersions.length - 1]!), recordCursor: current.value });
      const warnings: string[] = [];
      let bodyTarget: { noteId: string; version: number } | null = null;
      if (input.body !== undefined) {
        const body = await bodyPageOf(ctx, input.body, 'history');
        if (!body.ok) return rejected(body.code, body.reason);
        bodyTarget = { noteId: body.value.noteId, version: body.value.version };
        items = items.map(item => {
          if (item.noteId !== body.value.noteId || item.version !== body.value.version) return item;
          return { ...item, body: { text: body.value.text, next: body.value.next } };
        });
      }
      const result: MemoryHistoryResultV1 = { readBasis: basisOf(current.value, items), items, warnings,
        next, complete: next === null, coverage: coverageOf(items) };
      const fitted = fitToByteBound(result, resultMaxBytes,
        kept => String(kept[kept.length - 1]!.version),
        after => encodeMemoryCursor(ctx, 'history', request, { after, recordCursor: current.value }));
      // R11: the warning is computed AFTER the byte trim removed items.
      if (bodyTarget !== null
        && !fitted.items.some(item => item.noteId === bodyTarget!.noteId && item.version === bodyTarget!.version)
        && !fitted.warnings.includes('body_target_not_on_page')) {
        fitted.warnings.push('body_target_not_on_page');
      }
      return { status: 'ready', value: fitted };
    },

    async memoryConflicts(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      if (input.noteId === undefined && input.anchor === undefined) {
        return rejected('invalid', 'conflicts needs a noteId or an anchor');
      }
      const request = { op: 'conflicts', noteId: input.noteId ?? null, anchor: input.anchor ?? null, limit };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'conflicts', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      const seen = new Map<string, NoteHeadSnapshot>();
      if (input.noteId !== undefined) {
        const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
        if (!head.ok) return rejected(head.code, head.reason);
        if (head.value === null) return { status: 'not_found' };
        seen.set(head.value.noteId, head.value);
        for (const key of anchorKeysOf(head.value)) {
          const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          for (const candidate of heads.value) seen.set(candidate.noteId, candidate);
        }
      } else {
        const anchorKey = anchorKeyOf(input.anchor!);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        for (const candidate of heads.value) {
          if (anchorKeysOf(candidate).includes(anchorKey)) seen.set(candidate.noteId, candidate);
        }
        // R9: an anchor with no heads still owes the caller its existence answer.
        if (seen.size === 0) {
          const exists = await anchorExistsNow(ctx, input.anchor!);
          if (!exists.ok) return rejected(exists.code, exists.reason);
          if (!exists.exists) return anchorNotFound(exists.anchorCandidates, exists.candidatesUnavailable);
        }
      }
      const ordered = [...seen.values()].sort((left, right) => compareText(left.noteId, right.noteId));
      const slice = sliceByCursor(ordered, cursor.value.after, limit);
      if (!slice.ok) return rejected(slice.code, slice.reason);
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx));
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const items = pageBuilt.value.filter(item => item.conflicting);
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'conflicts', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, items), items, warnings: [],
        next, complete: next === null, coverage: coverageOf(pageBuilt.value) };
      const fitted = fitToByteBound(result, resultMaxBytes,
        kept => kept[kept.length - 1]!.noteId,
        after => encodeMemoryCursor(ctx, 'conflicts', request, { after, recordCursor: current.value }));
      return { status: 'ready', value: fitted };
    },

    async memoryNeighbors(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      const request = { op: 'neighbors', noteId: input.noteId, version: input.version ?? null, limit };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'neighbors', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
      if (!head.ok) return rejected(head.code, head.reason);
      if (head.value === null) return { status: 'not_found' };
      // R11: a requested version's own relations and anchors drive the read.
      let references: Set<string>;
      let anchorsOfSubject: string[];
      if (input.version !== undefined) {
        const version = await readVersionRecord(deps.records, ctx.projectId, input.noteId, input.version);
        if (!version.ok) return rejected(version.code, version.reason);
        if (version.value === null) return { status: 'not_found' };
        references = new Set<string>([...version.value.replaces, ...version.value.contradicts]);
        anchorsOfSubject = [version.value.anchor, ...version.value.extraAnchors].map(anchorKeyOf);
      } else {
        references = new Set<string>([...head.value.replaces, ...head.value.contradicts]);
        anchorsOfSubject = anchorKeysOf(head.value);
      }
      const seen = new Map<string, NoteHeadSnapshot>();
      for (const reference of references) {
        if (reference === input.noteId) continue;
        const target = await readHeadRecord(deps.records, ctx.projectId, reference);
        if (!target.ok) return rejected(target.code, target.reason);
        if (target.value !== null) seen.set(target.value.noteId, target.value);
      }
      for (const key of anchorsOfSubject) {
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        for (const other of heads.value) {
          if (other.noteId === input.noteId) continue;
          if (other.replaces.includes(input.noteId) || other.contradicts.includes(input.noteId)) {
            seen.set(other.noteId, other);
          }
        }
      }
      const ordered = [...seen.values()].sort((left, right) => compareText(left.noteId, right.noteId));
      const slice = sliceByCursor(ordered, cursor.value.after, limit);
      if (!slice.ok) return rejected(slice.code, slice.reason);
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx));
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'neighbors', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, pageBuilt.value),
        items: pageBuilt.value, warnings: [], next, complete: next === null,
        coverage: coverageOf(pageBuilt.value) };
      const fitted = fitToByteBound(result, resultMaxBytes,
        kept => kept[kept.length - 1]!.noteId,
        after => encodeMemoryCursor(ctx, 'neighbors', request, { after, recordCursor: current.value }));
      return { status: 'ready', value: fitted };
    },

    async memoryStale(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      if (input.goalId === undefined && input.anchor === undefined) {
        return rejected('invalid', 'stale needs a goalId or an anchor');
      }
      const request = { op: 'stale', goalId: input.goalId ?? null, anchor: input.anchor ?? null, limit };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'stale', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      let candidates: NoteHeadSnapshot[];
      if (input.goalId !== undefined && input.anchor !== undefined) {
        // R6/MF6b: both fields apply (AND). Candidates come from the anchor
        // indexes, then the goal and the accepted/reviewed state are required.
        const anchorKey = anchorKeyOf(input.anchor);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        candidates = heads.value.filter(head => anchorKeysOf(head).includes(anchorKey)
          && head.goalId === input.goalId && (head.state === 'accepted' || head.state === 'reviewed'));
      } else if (input.goalId !== undefined) {
        const heads = await headsOnReviewStatus(ctx.projectId, input.goalId, ['accepted', 'reviewed']);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        candidates = heads.value;
      } else {
        const anchorKey = anchorKeyOf(input.anchor!);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        // R6: anchor-scoped stale covers accepted and reviewed, like the goal route.
        candidates = heads.value.filter(head => anchorKeysOf(head).includes(anchorKey)
          && (head.state === 'accepted' || head.state === 'reviewed'));
      }
      const ordered = [...candidates].sort((left, right) => compareText(left.noteId, right.noteId));
      const slice = sliceByCursor(ordered, cursor.value.after, limit);
      if (!slice.ok) return rejected(slice.code, slice.reason);
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx));
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const items = pageBuilt.value.filter(item => item.freshness !== 'fresh' || item.sourceUnavailable
        || item.unresolvedFacts.length > 0 || item.anchorStatus === 'retired' || item.invalid);
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'stale', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, items), items, warnings: [],
        next, complete: next === null, coverage: coverageOf(pageBuilt.value) };
      const fitted = fitToByteBound(result, resultMaxBytes,
        kept => kept[kept.length - 1]!.noteId,
        after => encodeMemoryCursor(ctx, 'stale', request, { after, recordCursor: current.value }));
      return { status: 'ready', value: fitted };
    },

    async memoryFind(ctx, input) {
      const limit = resolveMemoryLimit(input.limit);
      // L10: an explicitly supplied term list is still 1–N terms; an empty list
      // is a class-1 shape problem, never a silently unfiltered listing.
      const rawTerms = input.terms === undefined ? null : input.terms;
      if (rawTerms !== null && rawTerms.length === 0) {
        return rejected('invalid', `terms must be 1–${String(textSearchMaxTerms)}`);
      }
      const match = input.match ?? 'any';
      if (match !== 'any' && match !== 'all') return rejected('invalid', 'match must be any or all');
      const isAll = rawTerms !== null && match === 'all';
      // R6/MF6b: strip exactly one trailing `/`; an empty prefix is a class-1
      // shape problem. The stripped value goes into the cursor-bound request.
      let pathPrefix: string | null = null;
      if (input.pathPrefix !== undefined) {
        const stripped = input.pathPrefix.endsWith('/') ? input.pathPrefix.slice(0, -1) : input.pathPrefix;
        if (stripped.length === 0) return rejected('invalid', 'path_prefix_empty');
        pathPrefix = stripped;
      }
      const scopeInput: MemoryFindRequest = pathPrefix === null ? input : { ...input, pathPrefix };
      const request = { op: 'find', terms: rawTerms, match, anchor: input.anchor ?? null,
        pathPrefix, kind: input.kind ?? null, topic: input.topic ?? null,
        state: input.state ?? null, limit };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'find', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      let scores = new Map<string, { matchedTerms: string[]; score: number }>();
      let ranking: 'full' | 'partial' = 'full';
      const warnings: string[] = [];
      // R7/R12: the `'all'` cursor carries the last PORT refKey (matched notes
      // are paged by the port), so a byte trim must re-encode a refKey, not a
      // noteId; every other `find` path pages by noteId.
      let afterOf = (kept: NoteItemV1[]): string | null => kept[kept.length - 1]!.noteId;

      // R9/MF9: an anchor is checked independently of the term matches; one
      // anchor-index read serves both the existence answer and the anchor-only
      // candidate source.
      let anchorOnAnchor: NoteHeadSnapshot[] | null = null;
      if (input.anchor !== undefined) {
        const key = anchorKeyOf(input.anchor);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorOnAnchor = heads.value.filter(head => anchorKeysOf(head).includes(key));
        if (anchorOnAnchor.length === 0) {
          const exists = await anchorExistsNow(ctx, input.anchor);
          if (!exists.ok) return rejected(exists.code, exists.reason);
          if (!exists.exists) return anchorNotFound(exists.anchorCandidates, exists.candidatesUnavailable);
        }
      }

      let pageHeads: NoteHeadSnapshot[];
      let next: string | null;
      if (rawTerms !== null && match === 'all') {
        const terms = normalizeTerms(rawTerms);
        if (!terms.ok) return rejected('invalid', terms.reason);
        const heads = await allTermHeads(ctx, scopeInput, terms.value, limit, cursor.value.after);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        pageHeads = heads.value.items;
        scores = rankAll(pageHeads, terms.value);
        // The port's `after` is a raw refKey, so a trimmed page must resume from
        // the kept note's canonical NoteHead refKey.
        afterOf = kept => noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId,
          noteId: kept[kept.length - 1]!.noteId });
        next = heads.value.next === null ? null
          : encodeMemoryCursor(ctx, 'find', request, { after: heads.value.next, recordCursor: current.value });
      } else {
        let ordered: NoteHeadSnapshot[];
        if (rawTerms !== null) {
          const terms = normalizeTerms(rawTerms);
          if (!terms.ok) return rejected('invalid', terms.reason);
          const heads = await anyTermHeads(ctx, scopeInput, terms.value);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          const ranked = rankMatches(heads.value.items, terms.value);
          ranking = heads.value.partial ? 'partial' : 'full';
          if (heads.value.partial) warnings.push('匹配集合超过候选上限；请按锚点、路径前缀、种类或加词缩小范围');
          for (const entry of ranked.ranked) {
            scores.set(entry.head.noteId, { matchedTerms: entry.matchedTerms, score: entry.score });
          }
          ordered = ranked.ranked.map(entry => entry.head);
        } else if (input.anchor !== undefined) {
          ordered = anchorOnAnchor!.filter(head => headInScope(head, scopeInput));
        } else if (pathPrefix !== null) {
          const heads = await headsOnPathPrefix(ctx.projectId, pathPrefix);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          ordered = heads.value.filter(head => headInScope(head, scopeInput));
        } else {
          const goalIds = await projectGoalIds(ctx);
          if (!goalIds.ok) return rejected(goalIds.code, goalIds.reason);
          const states = input.state !== undefined ? [input.state] : ALL_STATES;
          const union = new Map<string, NoteHeadSnapshot>();
          for (const goalId of [null, ...goalIds.value] as (string | null)[]) {
            const heads = await headsOnReviewStatus(ctx.projectId, goalId, states);
            if (!heads.ok) return rejected(heads.code, heads.reason);
            for (const head of heads.value) union.set(head.noteId, head);
          }
          ordered = [...union.values()].filter(head => headInScope(head, scopeInput));
        }
        if (rawTerms === null) {
          ordered.sort((left, right) => left.createdAt === right.createdAt
            ? compareText(left.noteId, right.noteId) : compareText(left.createdAt, right.createdAt));
        }
        const slice = sliceByCursor(ordered, cursor.value.after, limit);
        if (!slice.ok) return rejected(slice.code, slice.reason);
        pageHeads = slice.page;
        next = slice.complete ? null : encodeMemoryCursor(ctx, 'find', request,
          { after: slice.last, recordCursor: current.value });
      }
      const pageBuilt = await checkedPage(ctx, pageHeads, currentGoalIdOf(ctx));
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const items = pageBuilt.value.map(item => {
        const rank = scores.get(item.noteId);
        return { ...item, matchedTerms: rank?.matchedTerms ?? [], score: rank?.score ?? 0 };
      });
      // R7: an `'all'` result carries no `ranking` field at all; several
      // `'any'` results carry `'full'`/`'partial'` as before.
      const result: MemoryResultV1 = isAll
        ? { readBasis: basisOf(current.value, items), items, warnings, next, complete: next === null,
          coverage: coverageOf(pageBuilt.value) }
        : { readBasis: basisOf(current.value, items), items, warnings, next,
          complete: next === null && ranking === 'full', ranking, coverage: coverageOf(pageBuilt.value) };
      const fitted = fitToByteBound(result, resultMaxBytes, afterOf,
        after => encodeMemoryCursor(ctx, 'find', request, { after, recordCursor: current.value }));
      return { status: 'ready', value: fitted };
    },
  };
}
