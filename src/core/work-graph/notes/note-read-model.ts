/**
 * Slice 4A L18/P8/P9: the minimal note read port. It answers `readNote` by id
 * (optionally one immutable version) and `listByAnchor` (the five anchor indexes
 * merged and deduped, ascending by `createdAt` then `noteId`, with the current
 * pointer for goal/stage anchors). The fields that need 4B's L11/L22/L23 take the
 * unchecked values of P8; `conflicting` and `overQuota` are computed from the
 * stored heads because N-06 and N-07 assert them. The database is never read to
 * answer a test: every assertion goes through this port.
 *
 * A read failure is never flattened into a definite answer.
 * `readAllHeads`/`readAllRecords` page an index to the end and return any
 * failure; a page that is not ready is mapped through `mapStoreFailure`, and an
 * undecodable record is `unavailable`. Every head/version/pointer read tells a
 * miss apart from a failure, and `readNote`/`listByAnchor` return the failure.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { NoteIndexRowV1, NotesUnderstandingRowV1 } from '../../../contracts/graph-context.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteHeadSnapshot, NoteState, NoteVersionSnapshot } from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS, renderNoteHeader } from '../../../contracts/note.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort, EncodedRecord } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort, RecordTextSearchPort } from '../../record-store/lookup-ports.js';
import { decodeTextSearchAfter, normalizeSearchText, searchTextFrom } from '../../record-store/lookup-index.js';
import { compareRefKeysFast, decodeTextTerms, textMatches } from '../../record-store/text-scan.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type {
  MemoryFindRelatedRequestV1, MemoryFindRequest, MemoryHistoryResultV1,
  MemoryLookupRequest,
  MemoryLookupResultV1, MemoryProjectHeaderV1, MemoryReadBasis,
  MemoryResultV1, NoteHeadCheckItemV1,
  NoteHeadCheckPort, NoteRunTaskResolver,
  NoteHistoryItemV1, NoteItemV1, NoteListRequestV1, NoteListResultV1, NoteMemoryReadPort, NoteMemoryReadResult,
  NoteMemoryMaterialInputV1, NoteMemoryMaterialV1, NoteCheckV1,
  NotePageV1, NoteReadPort,
  NoteFileObservationV1,
  NoteAnchorNotFoundV1, NoteAnchorCandidateV1,
  UnderstandingStatusV1,
} from '../model/note-contracts.js';
import { FIND_RELATED_FILES_MAX, MEMORY_PAGE_MAX, MEMORY_PAGE_DEFAULT, MEMORY_RESULT_MAX_BYTES, MEMORY_TOPICS_MAX,
  NOTE_ANCHOR_QUOTA, NOTE_BODY_PAGE_BYTES, NOTE_GOAL_QUOTA, NOTE_RANK_WEIGHT_BODY,
  NOTE_RANK_WEIGHT_CONCLUSION, NOTE_RANK_WEIGHT_TOPIC,
  PROJECT_NORMS_CHECK_MAX, PROJECT_NORMS_MAX, TEXT_SEARCH_CANDIDATE_MAX,
  TEXT_SEARCH_MAX_TERMS } from '../model/note-contracts.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { NoteAnchorWorkspace } from './note-anchors.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, S4_NOTE_TEXT_LOOKUP,
  NOTE_TEXT_PATHS,
  currentPointerRefKey, decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot, decodeNoteVersionSnapshot,
  noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { GOAL_BY_WORKSPACE_INDEX, readGoalPlanWindow } from '../tasks/plan-readers.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { anchorKeyOf, resolveNoteAnchors, topicKeyOf, type NoteAnchorFactsDeps } from './note-anchors.js';
import { readAllHeads, readAllRecords, type ReadFailureCode, type ReadOutcome } from './note-base-reader.js';
import { renderUnderstandingBody } from './note-rendering.js';
import { anchorSlots, headsOnKeyPrefix, isRelatedHead, matchesPathPrefix, resolveRelatedScope, resolveTaskScopeWithPlan,
  stageIdOf, type RelatedScope, type RelatedScopeDeps } from './note-related-scope.js';
import { readPointerAndHeadBatch } from './note-batch-reader.js';
import { asOutcome, mapStoreFailure } from './store-failures.js';

export { readAllHeads, readAllRecords, type ReadFailureCode } from './note-base-reader.js';
export { mapStoreFailure, type MappedStoreFailure } from './store-failures.js';

export type NoteReadDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordTextSearchPort;
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  workspace?: NoteAnchorWorkspace;
  /** Slice 4B L22 / S2.5: the injected derived-field implementation. */
  check?: NoteHeadCheckPort;
  anchorQuota?: number;
  goalQuota?: number;
  /** Slice 4B P14/T-09: bounds the match set the read model ranks (injectable). */
  textSearchCandidateMax?: number;
  textSearchMaxTerms?: number;
  /** Slice 4B L12: the whole-result JSON byte bound (injectable; default 48 KiB). */
  resultMaxBytes?: number;
  /** Slice 4C §11.2: the narrow work-Run task resolver (one read). */
  runTask?: NoteRunTaskResolver;
  /** Slice 4C §11.2: `FIND_RELATED_FILES_MAX`, injectable (default 32). */
  relatedFilesMax?: number;
};

/**
 * Slice 4C C1.4 (`notes/list`): the route-facing side of the existing reads.
 * It adds no reader and no index; the anchor form is the `lookup` read, the
 * `pending_review` form is the per-goal review-status bucket and the
 * accepted/reviewed form is that goal's current heads. Every row is labelled
 * with `renderNoteHeader`, so the underlying heads (which carry `structural`)
 * are rendered before the row is returned.
 */
export type NoteListReadPort = {
  listNotes(ctx: CoreCallContext, request: NoteListRequestV1): Promise<NoteMemoryReadResult<NoteListResultV1>>;
};

/** R9: the not-found answer the three anchor-scoped reads share, with candidates. */
export function anchorNotFound(candidates?: NoteAnchorCandidateV1[], unavailable?: boolean): NoteAnchorNotFoundV1 {
  return { status: 'rejected', code: 'not_found', reason: 'anchor_not_found',
    ...(candidates === undefined ? {} : { anchorCandidates: candidates }),
    ...(unavailable === true ? { candidatesUnavailable: true } : {}) };
}

type AnchorExistence = { ok: true; exists: true }
  | { ok: true; exists: false; anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean }
  | { ok: false; code: ReadFailureCode | 'forbidden'; reason: string };

function isGeneral(kind: string): boolean { return (NOTE_GENERAL_KINDS as readonly string[]).includes(kind); }

/** RW-7: a request object carries exactly the named keys, no extras. */
function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
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
 * Within one port call the anchor-keyed and goal-keyed head sets
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
    const keys = anchorSlots(head);
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
      const keys = anchorSlots(head);
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

export type NoteMemoryMaterialReadPort = {
  readMemoryMaterial(ctx: CoreCallContext, input: NoteMemoryMaterialInputV1):
    Promise<ReadResult<NoteMemoryMaterialV1>>;
};

export function createNoteReadModel(deps: NoteReadDependencies):
NoteReadPort & NoteMemoryReadPort & NoteListReadPort & NoteMemoryMaterialReadPort {
  const anchorQuota = deps.anchorQuota ?? NOTE_ANCHOR_QUOTA;
  const goalQuota = deps.goalQuota ?? NOTE_GOAL_QUOTA;
  const anchorFacts: NoteAnchorFactsDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }) };
  const derivations = createNoteHeadDerivations(deps.records, anchorQuota, goalQuota);
  const conflictingOf = derivations.conflictingOf;
  const overQuotaOf = derivations.overQuotaOf;
  // Slice 4C §11.2: the related-scope read is one narrow port; the pure key-set
  // builder and predicate live in `note-related-scope.ts` for L20 to reuse.
  const relatedFilesMax = deps.relatedFilesMax ?? FIND_RELATED_FILES_MAX;
  const relatedDeps: RelatedScopeDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.runTask === undefined ? {} : { runTask: deps.runTask }),
    relatedFilesMax };

  function itemOfHead(head: NoteHeadSnapshot, projectId: string,
    cache: HeadCache): Promise<ReadOutcome<NoteItemV1>> {
    return (async () => {
      // S2.4: when the read model has a check (always, in production) the
      // check supplies `conflicting`/`overQuota`; computing them here too would
      // double every derivation read. The no-check construction keeps them.
      let conflicting = false;
      let overQuota = false;
      if (deps.check === undefined) {
        const derivedConflicting = await conflictingOf(projectId, head, cache);
        if (!derivedConflicting.ok) return derivedConflicting;
        const derivedOverQuota = await overQuotaOf(projectId, head, cache);
        if (!derivedOverQuota.ok) return derivedOverQuota;
        conflicting = derivedConflicting.value;
        overQuota = derivedOverQuota.value;
      }
      return { ok: true, value: {
        noteId: head.noteId, version: head.version, storedState: head.state, kind: head.kind, topic: head.topic,
        topicKey: head.topicKey, conclusion: head.conclusion, anchor: head.anchor, extraAnchors: head.extraAnchors,
        source: head.source, goalId: head.goalId, replaces: [...head.replaces], contradicts: [...head.contradicts],
        coexistWith: [...head.coexistWith], confirmedByUser: head.confirmedByUser,
        freshness: 'unchecked', changedFiles: [], observedFiles: [], staleReasons: [],
        sourceUnavailable: false, invalid: false, conflicting,
        overQuota, updateDue: null, currentEligible: false, crossGoal: false,
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
   * check's derived fields, including the check-owned `observedFiles`. A rejected check is returned, never
   * flattened into the unchecked defaults. `headVersions` names the head version
   * of each item's note; any other version is a historical item (R11: only the
   * head version can be `currentEligible`).
   */
  /**
   * The pointers and pointed heads `readMemoryMaterial` already
   * read, keyed `${projectId}\u0000${anchorKey}` exactly as the check's
   * `understandingSeed`. Handing them over lets `computeUnderstandingOfAnchorKey`
   * skip its own per-anchor pointer and head reads.
   */
  type UnderstandingPointerSeed = ReadonlyMap<string, {
    pointer: { noteId: string | null; revision: number | null };
    head: NoteHeadSnapshot | null;
  }>;

  async function withCheck<T extends NoteItemV1>(ctx: CoreCallContext, items: T[],
    headVersions?: ReadonlyMap<string, number>, headSnapshots?: ReadonlyMap<string, NoteHeadSnapshot>,
    anchorSets?: ReadonlyMap<string, NoteHeadSnapshot[]>,
    versionSnapshots?: ReadonlyMap<number, NoteVersionSnapshot>,
    conflictingByNote?: ReadonlyMap<string, boolean>,
    planWindows?: ReadonlyMap<string, PlanRevisionSnapshot | null>,
    understandingAnchors?: string[],
    understandingPointers?: UnderstandingPointerSeed): Promise<ReadOutcome<{ items: T[]; understanding: UnderstandingStatusV1[] }>> {
    if (deps.check === undefined) return { ok: true, value: { items, understanding: [] } };
    const wantsUnderstanding = understandingAnchors !== undefined && understandingAnchors.length > 0;
    if (items.length === 0 && !wantsUnderstanding) return { ok: true, value: { items, understanding: [] } };
    let checked: NoteCheckV1[];
    let understanding: UnderstandingStatusV1[] = [];
    const result = await deps.check.checkHeads(ctx, {
      // F4: the heads (and non-head version snapshots) already
      // read in this call go straight to the check; it never reads them again.
      // §11.3 (b11): a derivation the read model already made (conflicts) is
      // handed over so the check does not recompute it. U-3: understanding
      // anchors ride the same call/caches.
      items: items.map(item => {
        const snapshot = versionSnapshots?.get(item.version);
        const conflicting = conflictingByNote?.get(item.noteId);
        const checkItem: NoteHeadCheckItemV1 & { conflicting?: boolean } = {
          head: headSnapshots!.get(item.noteId)!, version: item.version,
          ...(snapshot === undefined ? {} : { snapshot }),
          ...(conflicting === undefined ? {} : { conflicting }) };
        return checkItem;
      }),
      ...(anchorSets === undefined ? {} : { anchorSets }),
      ...(planWindows === undefined ? {} : { planWindows }),
      ...(understandingAnchors === undefined ? {} : { understandingAnchors }),
      ...(understandingPointers === undefined ? {} : { understandingPointers }),
    });
    if (result.status !== 'ready') return checkFailure(result);
    checked = result.value.items;
    understanding = result.value.understanding;
    const out = items.map((item, index) => {
      const check = checked[index]!;
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
    return { ok: true, value: { items: out as T[], understanding } };
  }

  /** The one mapping from a non-ready check result to the read model's outcome. */
  function checkFailure(result: { status: string; code?: string; reason?: string }): ReadOutcome<never> {
    if (result.status === 'rejected') {
      const mapped = mapStoreFailure(result as { code: string; reason: string });
      return { ok: false, code: mapped.code, reason: mapped.reason };
    }
    if (result.status === 'not_found') return { ok: false, code: 'not_found', reason: 'the check target does not exist' };
    return { ok: false, code: 'unavailable', reason: 'the note check is not ready' };
  }

  async function pointerOf(projectId: string, anchor: NoteAnchorV1):
  Promise<ReadOutcome<{ noteId: string | null; revision: number | null } | null>> {
    // §11.4: the project anchor carries a current understanding too.
    if (anchor.kind !== 'goal' && anchor.kind !== 'stage' && anchor.kind !== 'project') {
      return { ok: true, value: null };
    }
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

  /**
   * §11.7: the ONE batched pointer read of several understanding
   * anchors (project/goal/stage). Every anchor gets an entry; a missing pointer
   * is `{ noteId: null, revision: null }` exactly as `pointerOf`.
   */
  // The batched pointer/head read/decode lives in the shared
  // leaf `note-batch-reader.ts`; this call site keeps its failure mapping.
  async function pointersAndHeadsOf(projectId: string, anchorKeys: readonly string[]):
  Promise<ReadOutcome<{ pointers: Map<string, { noteId: string | null; revision: number | null }>;
    heads: Map<string, NoteHeadSnapshot> }>> {
    const batch = await readPointerAndHeadBatch(deps.records, projectId, anchorKeys);
    if (!batch.ok) {
      const failure = mapStoreFailure({ code: batch.code, reason: batch.reason });
      return { ok: false, code: failure.code, reason: failure.reason };
    }
    return { ok: true, value: batch.value };
  }

  /** L2a class 2/R9: is this anchor key backed by a real object now? Failed reads carry no candidates. */
  async function anchorExistsNow(ctx: CoreCallContext, anchor: NoteAnchorV1): Promise<AnchorExistence> {
    const draft: NoteDraftAnchorV1 = anchor.kind === 'file'
      ? { kind: 'file', path: anchor.path, ...(anchor.deleted === true ? { deleted: true as const } : {}) }
      : anchor;
    const goalId = 'goalId' in anchor ? anchor.goalId : null;
    // The same narrow anchor-facts reader as the writer, with no L11
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
  // Slice 4B: the six memory reads (L9–L12). Every candidate comes from the
  // existing head indexes; the full-text port is only consulted when terms are
  // given. Reads go to the end of the candidate set and page over candidates
  // with L12's stable cursor (request + record cursor + last key).
  // ========================================================================

  const textSearchCandidateMax = deps.textSearchCandidateMax ?? TEXT_SEARCH_CANDIDATE_MAX;
  const textSearchMaxTerms = deps.textSearchMaxTerms ?? TEXT_SEARCH_MAX_TERMS;
  // §11.3: a default-state filter changes the page contents for the same cursor,
  // so all reads move to rule version 2 together; an old cursor is a mismatch.
  const RULE_VERSION = 2;
  const resultMaxBytes = deps.resultMaxBytes ?? MEMORY_RESULT_MAX_BYTES;

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

  /**
   * §11.3: the one default-visibility predicate shared by `find` and `lookup`.
   * `goalId` is the trusted caller goal (`currentGoalIdOf`), never a request
   * field; `own` is true for the host and query Runs (no goal), and for a note
   * in the caller's own goal. The project understanding is visible everywhere
   * (§11.4).
   */
  function visibleByDefault(head: NoteHeadSnapshot, goalId: string | null): boolean {
    if (head.kind === 'understanding' && head.anchor.kind === 'project') {
      return head.state === 'accepted' || head.state === 'reviewed';
    }
    const own = goalId === null || head.goalId === goalId;
    switch (head.state) {
      case 'accepted': return own || head.confirmedByUser;
      case 'reviewed': return true;
      case 'pending_review': return own;
      default: return false;
    }
  }

  /** §10 R9/§11.3: `lookup` also lists `staged`, still under the own-goal rule. `explicitState`
   * is §11.3's explicit state override; pending and staged still obey `own`. */
  function lookupVisible(head: NoteHeadSnapshot, goalId: string | null, explicitState?: NoteState): boolean {
    if (explicitState !== undefined) {
      if (head.state !== explicitState) return false;
      if (explicitState === 'pending_review' || explicitState === 'staged') {
        return goalId === null || head.goalId === goalId;
      }
      return true;
    }
    if (head.state === 'staged') return goalId === null || head.goalId === goalId;
    return visibleByDefault(head, goalId);
  }

  /**
   * §11.3's no-terms status route: the states read per goal slot. A work Run
   * reads accepted + reviewed everywhere and pending_review only for its own
   * slot; the host and query Runs read pending_review for every slot.
   */
  function visibleStatusStates(slotGoalId: string | null, callerGoalId: string | null): readonly NoteState[] {
    if (callerGoalId !== null && slotGoalId !== callerGoalId) return ['accepted', 'reviewed'];
    return ['accepted', 'reviewed', 'pending_review'];
  }

  /**
   * §11.3 `find`: an explicit `state` overrides the defaults and returns exactly
   * that state. Pending and staged still obey `own`; the three retired states
   * carry no goal filter (like history).
   */
  function findVisible(head: NoteHeadSnapshot, input: MemoryFindRequest, goalId: string | null): boolean {
    if (input.state !== undefined) {
      if (head.state !== input.state) return false;
      if (input.state === 'pending_review' || input.state === 'staged') {
        return goalId === null || head.goalId === goalId;
      }
      return true;
    }
    return visibleByDefault(head, goalId);
  }

  /** §11.4: the project understanding is current for every goal (`crossGoal: false`). */
  function crossGoalOf(item: NoteItemV1, goalId: string | null): boolean {
    if (item.kind === 'understanding' && item.anchor.kind === 'project') return false;
    return goalId !== null && item.goalId !== goalId;
  }

  /**
   * P7/R6/MF6a: range-read the five ordered path indexes from the file key of
   * the prefix. This keeps the file directory-boundary filter. The ordered text
   * order is UTF-8 byte order, so `file:src/a-b/y.ts` and `file:src/a.ts` sort
   * between `file:src/a` and `file:src/a/x.ts`. Stop only when the key leaves
   * the whole `file:<prefix>*` range; a sibling that merely fails the directory
   * boundary is skipped, not treated as the end.
   */
  async function headsOnPathPrefix(projectId: string, prefix: string): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
    const scanned = await headsOnKeyPrefix(deps.records, projectId, `file:${prefix}`);
    if (!scanned.ok) return { ok: false, code: scanned.code, reason: scanned.reason };
    return { ok: true, value: scanned.value.filter(head =>
      anchorSlots(head).some(key => key.startsWith('file:') && matchesPathPrefix(key, prefix))) };
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

  type MemoryCursor = { after: string | null; recordCursor: string | null; identity: string;
    seg: 'related' | 'project' | null; resolved: unknown };

  function encodeMemoryCursor(ctx: CoreCallContext, op: string, request: unknown,
    state: { after: string | null; recordCursor: string | null; seg?: 'related' | 'project' | null; resolved?: unknown }): string {
    return JSON.stringify({ v: 1, op, id: callerIdentityOf(ctx), rule: RULE_VERSION, request,
      after: state.after, cursor: state.recordCursor, seg: state.seg ?? null,
      resolved: state.resolved ?? null });
  }

  function parseMemoryCursor(ctx: CoreCallContext, cursor: string | null, op: string, request: unknown):
  { ok: true; value: MemoryCursor } | { ok: false; code: ReadFailureCode; reason: string } {
    const identity = callerIdentityOf(ctx);
    if (cursor === null) return { ok: true, value: { after: null, recordCursor: null, identity, seg: null, resolved: null } };
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
      const seg = parsed['seg'] ?? null;
      if (!(after === null || typeof after === 'string') || !(record === null || typeof record === 'string')
        || !(seg === null || seg === 'related' || seg === 'project')) {
        return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
      }
      return { ok: true, value: { after: after as string | null, recordCursor: record as string | null, identity,
        seg: seg as 'related' | 'project' | null, resolved: parsed['resolved'] ?? null } };
    } catch {
      return { ok: false, code: 'invalid', reason: 'cursor_mismatch' };
    }
  }

  async function checkedPage(ctx: CoreCallContext, heads: readonly NoteHeadSnapshot[],
    currentGoalId: string | null, anchorSets?: ReadonlyMap<string, NoteHeadSnapshot[]>,
    conflictingByNote?: ReadonlyMap<string, boolean>,
    planWindows?: ReadonlyMap<string, PlanRevisionSnapshot | null>,
    understandingAnchors?: string[],
    understandingPointers?: UnderstandingPointerSeed): Promise<ReadOutcome<{ items: NoteItemV1[]; understanding: UnderstandingStatusV1[] }>> {
    const cache = newHeadCache();
    const built: NoteItemV1[] = [];
    const headSnapshots = new Map<string, NoteHeadSnapshot>();
    for (const head of heads) {
      const item = await itemOfHead(head, ctx.projectId, cache);
      if (!item.ok) return item;
      built.push(item.value);
      headSnapshots.set(head.noteId, head);
    }
    const checked = await withCheck(ctx, built, undefined, headSnapshots, anchorSets, undefined, conflictingByNote,
      planWindows, understandingAnchors, understandingPointers);
    if (!checked.ok) return checked;
    return { ok: true, value: {
      items: checked.value.items.map(item => ({ ...item, crossGoal: crossGoalOf(item, currentGoalId) })),
      understanding: checked.value.understanding } };
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

  /**
   * S1.10/S2.1/F2: the shared per-term rule is the one
   * implementation on both the scoped and the port path. Per term, in order:
   * today's type and well-formed checks, the first `decodeTextTerms` pass (the
   * read model's own normalization) and then the second pass (the port's second
   * normalization, S1.10). The first error in term order is the result.
   *
   * The two passes are returned separately: `match` is the second-pass (port)
   * form, so a scoped match equals the port match; `rank` is the first-pass
   * form, so `rankAll`/`rankMatches` scores and `matchedTerms` stay exactly as
   * 4B computed them (which used the read model's one normalization). The read
   * model keeps its own term-count reason (injectable `textSearchMaxTerms`).
   */
  function normalizeTerms(terms: readonly string[]):
  { ok: true; rank: string[]; match: string[] } | { ok: false; reason: string } {
    if (terms.length < 1 || terms.length > textSearchMaxTerms) {
      return { ok: false, reason: `terms must be 1–${String(textSearchMaxTerms)}` };
    }
    const rank: string[] = [];
    const match: string[] = [];
    for (const raw of terms) {
      if (typeof raw !== 'string') return { ok: false, reason: 'text search terms must be strings' };
      if (!raw.isWellFormed()) return { ok: false, reason: 'a text search term must be well-formed UTF-16' };
      const first = decodeTextTerms([raw]);
      if (!first.ok) return { ok: false, reason: first.reason };
      const second = decodeTextTerms(first.terms);
      if (!second.ok) return { ok: false, reason: second.reason };
      rank.push(first.terms[0]!);
      match.push(second.terms[0]!);
    }
    return { ok: true, rank, match };
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
   * R6/MF6b + §11.3: one scope predicate used by every `find` candidate source.
   * The default-state visibility filter runs first, before U/df, the `'any'` cap,
   * `'all'` paging and slicing. An anchor needs the exact key in a slot; a
   * pathPrefix needs a file slot on the directory boundary; a supplied filter
   * applies (AND).
   */
  function headInScope(head: NoteHeadSnapshot, input: MemoryFindRequest, goalId: string | null): boolean {
    if (!findVisible(head, input, goalId)) return false;
    if (!headMatchesFilters(head, input)) return false;
    if (input.anchor !== undefined && !anchorSlots(head).includes(anchorKeyOf(input.anchor))) return false;
    if (input.pathPrefix !== undefined) {
      const prefix = input.pathPrefix;
      if (!anchorSlots(head).some(key => key.startsWith('file:') && matchesPathPrefix(key, prefix))) return false;
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

  /**
   * MF7b, amended by decision 66: `unsupported` stays only for an unregistered
   * or non-text index.
   */
  async function searchPage(projectId: string, terms: readonly string[], limit: number,
    after: string | undefined, match: 'all' | 'any' = 'all'): Promise<SearchPageOutcome> {
    const page = await deps.records.searchText({ index: S4_NOTE_TEXT_LOOKUP, values: [projectId], terms, match,
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
   * is `complete: false` with the port's next cursor. A short page is not
   * evidence of candidate-budget exhaustion.
   */
  async function allTermHeads(ctx: CoreCallContext, input: MemoryFindRequest, terms: readonly string[],
    limit: number, cursorAfter: string | null, skipRelated?: (head: NoteHeadSnapshot) => boolean):
  Promise<{ ok: true; value: { items: NoteHeadSnapshot[]; next: string | null } }
    | { ok: false; code: ReadFailureCode | 'unsupported'; reason: string }> {
    const page = await searchPage(ctx.projectId, terms, limit, cursorAfter ?? undefined);
    if (!page.ok) return page;
    const goalId = currentGoalIdOf(ctx);
    const collected: NoteHeadSnapshot[] = [];
    const seen = new Set<string>();
    for (const record of page.records) {
      const decoded = decodeNoteHeadSnapshot(record);
      if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
      const head = decoded.value;
      if (seen.has(head.noteId)) continue;
      seen.add(head.noteId);
      if (skipRelated !== undefined && skipRelated(head)) continue;
      if (headInScope(head, input, goalId)) collected.push(head);
    }
    return { ok: true, value: { items: collected, next: page.complete ? null : page.next } };
  }

  /**
   * S2.2 (decision 66): unscoped `'any'` is ONE port stream with `match:'any'`,
   * limit 100, looping on `next` until it has `cap+1` in-scope matches or the
   * scan completes (the `next === after` guard stays). This replaces the
   * per-term streams and their UTF-16 merge. The candidate set before ranking
   * is now the first `cap` in refKey byte order, as P1 states: for note ids
   * that are not UUIDs a partial set can differ from 4B's merge, but the
   * production ids are UUIDs so production results do not change.
   */
  async function anyTermHeads(ctx: CoreCallContext, input: MemoryFindRequest, terms: readonly string[],
    skipRelated?: (head: NoteHeadSnapshot) => boolean):
  Promise<{ ok: true; value: { items: NoteHeadSnapshot[]; partial: boolean } }
    | { ok: false; code: ReadFailureCode | 'unsupported'; reason: string }> {
    const goalId = currentGoalIdOf(ctx);
    const collected: NoteHeadSnapshot[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    for (;;) {
      const page = await searchPage(ctx.projectId, terms, 100, after, 'any');
      if (!page.ok) return page;
      for (const record of page.records) {
        const decoded = decodeNoteHeadSnapshot(record);
        if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged note head' };
        const head = decoded.value;
        if (seen.has(head.noteId)) continue;
        seen.add(head.noteId);
        if (skipRelated !== undefined && skipRelated(head)) continue;
        if (!headInScope(head, input, goalId)) continue;
        if (collected.length >= textSearchCandidateMax) {
          return { ok: true, value: { items: collected, partial: true } };
        }
        collected.push(head);
      }
      if (page.complete || page.next === null || page.next === after) break;
      after = page.next;
    }
    return { ok: true, value: { items: collected, partial: false } };
  }

  /**
   * S2.1 (decision 66): with terms and an anchor or a path prefix the
   * candidates are exactly the in-scope heads on that anchor / under that
   * prefix, matched on the shared comparison text and ordered by the NoteHead
   * refKey byte order (precomputed once per head). No port call happens.
   */
  function scopedMatches(projectId: string, input: MemoryFindRequest, goalId: string | null,
    source: readonly NoteHeadSnapshot[], terms: readonly string[], match: 'all' | 'any'): { head: NoteHeadSnapshot; refKey: string }[] {
    const matched: { head: NoteHeadSnapshot; refKey: string }[] = [];
    for (const head of source) {
      if (!headInScope(head, input, goalId)) continue;
      if (!textMatches(searchTextFrom(head, NOTE_TEXT_PATHS), terms, match)) continue;
      matched.push({ head, refKey: noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId: head.noteId }) });
    }
    matched.sort((left, right) => compareRefKeysFast(left.refKey, right.refKey));
    return matched;
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

  /** L12: a page defaults to 20 and is capped at 100. */
  function resolveMemoryLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) return MEMORY_PAGE_DEFAULT;
    return Math.min(limit, MEMORY_PAGE_MAX);
  }

  // ========================================================================
  // Slice 4C §11.2/§11.4: the related-first segments and the project header
  // ========================================================================

  type FindSegment = 'related' | 'project';
  type FindEntry = { head: NoteHeadSnapshot; segment: FindSegment | null };

  /** G-02/RW-7: the strict REQUEST union for `related` — task | module, no extras. */
  function relatedShapeProblem(value: MemoryFindRelatedRequestV1): string | null {
    if (typeof value !== 'object' || value === null) return 'related must be a task or a module';
    if (value.kind === 'task') {
      if (!hasOnlyKeys(value, ['kind', 'goalId', 'taskId'])) return 'related task has an unexpected key';
      return typeof value.goalId === 'string' && value.goalId.length > 0
        && typeof value.taskId === 'string' && value.taskId.length > 0 ? null
        : 'related task needs a goal and a task';
    }
    if (value.kind === 'module') {
      if (!hasOnlyKeys(value, ['kind', 'moduleId'])) return 'related module has an unexpected key';
      return typeof value.moduleId === 'string' && value.moduleId.length > 0 ? null : 'related module needs a module id';
    }
    return 'related must be a task or a module';
  }

  /** Read the union of the related anchor keys; seed the check's head cache. */
  async function readHeadsForKeys(ctx: CoreCallContext, keys: Iterable<string>,
    anchorSets: Map<string, NoteHeadSnapshot[]>): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
    const keyList = [...keys];
    const seen = new Map<string, NoteHeadSnapshot>();
    // RW-12(c): a task's stage anchor keys share `stage:<goalId>/`; one prefix
    // scan per anchor slot serves every revision and stage, filtered in memory
    // by `isRelatedHead` (and per exact key for the check's head cache).
    const stagePrefixes = new Set<string>();
    const exactKeys: string[] = [];
    for (const key of keyList) {
      const match = /^stage:([^/]+)\//.exec(key);
      if (match === null) exactKeys.push(key);
      else stagePrefixes.add(`stage:${match[1]!}/`);
    }
    for (const key of exactKeys) {
      const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
      if (!heads.ok) return heads;
      anchorSets.set(`${ctx.projectId}\u0000${key}`, heads.value);
      for (const head of heads.value) seen.set(head.noteId, head);
    }
    for (const prefix of stagePrefixes) {
      const scanned = await headsOnKeyPrefix(deps.records, ctx.projectId, prefix);
      if (!scanned.ok) return { ok: false, code: scanned.code, reason: scanned.reason };
      for (const key of keyList) {
        if (!key.startsWith(prefix)) continue;
        anchorSets.set(`${ctx.projectId}\u0000${key}`,
          scanned.value.filter(head => anchorSlots(head).includes(key)));
      }
      for (const head of scanned.value) seen.set(head.noteId, head);
    }
    return { ok: true, value: [...seen.values()] };
  }

  /** Unscoped `find` heads (§11.3 status route), already filtered by `headInScope`. */
  async function unscopedHeads(ctx: CoreCallContext, input: MemoryFindRequest,
    goalId: string | null): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
    const goalIds = await projectGoalIds(ctx);
    if (!goalIds.ok) return goalIds;
    const union = new Map<string, NoteHeadSnapshot>();
    for (const slot of [null, ...goalIds.value] as (string | null)[]) {
      const states = input.state !== undefined ? [input.state] : visibleStatusStates(slot, goalId);
      const heads = await headsOnReviewStatus(ctx.projectId, slot, states);
      if (!heads.ok) return heads;
      for (const head of heads.value) union.set(head.noteId, head);
    }
    return { ok: true, value: [...union.values()].filter(head => headInScope(head, input, goalId)) };
  }

  type HeaderSelection = {
    understanding: { head: NoteHeadSnapshot; pointerRevision: number } | null;
    norms: NoteHeadSnapshot[];
    eligibleTotal: number;
  };

  /**
   * §11.7: the project pointer and pointed head
   * `readMemoryMaterial` already read in its one batched pair of reads. Passing
   * them here keeps `selectProjectHeader` from reading the pointer again.
   *
   * §11.7: the project anchor set is read once per call and
   * shared with the check. If a caller already read it (the related read of a
   * segmented find, the unscoped anchor find, or this material's own call), it
   * is taken from `anchorSets`; otherwise the unfiltered 5-slot set (never
   * `main`) is stored there for the check's `conflictingOf` to reuse.
   */
  type ProjectHeaderPreRead = {
    pointer: { noteId: string | null; revision: number | null };
    head: NoteHeadSnapshot | null;
  };

  /** §11.4: the project understanding (pointer's head) and the eligible norms. */
  async function selectProjectHeader(ctx: CoreCallContext, projectId: string,
    anchorSets: Map<string, NoteHeadSnapshot[]>,
    preRead?: ProjectHeaderPreRead): Promise<ReadOutcome<HeaderSelection>> {
    const setKey = `${projectId}\u0000project`;
    let projectSet = anchorSets.get(setKey);
    if (projectSet === undefined) {
      const read = await headsByAnchorKey(deps.records, projectId, 'project');
      if (!read.ok) return read;
      projectSet = read.value;
      // The S2.3 pattern: store the unfiltered 5-slot set, and only on success.
      anchorSets.set(setKey, projectSet);
    }
    const main = projectSet.filter(head => head.anchorKey0 === 'project');
    const pointer = preRead === undefined
      ? await pointerOf(projectId, { kind: 'project' })
      : { ok: true as const, value: preRead.pointer };
    if (!pointer.ok) return pointer;
    let understanding: { head: NoteHeadSnapshot; pointerRevision: number } | null = null;
    if (pointer.value !== null && pointer.value.noteId !== null) {
      const head = preRead !== undefined && preRead.head !== null && preRead.head.noteId === pointer.value.noteId
        ? preRead.head
        : main.find(candidate => candidate.noteId === pointer.value!.noteId);
      if (head !== undefined && head !== null && head.anchorKey0 === 'project'
        && head.kind === 'understanding' && (head.state === 'accepted' || head.state === 'reviewed')) {
        understanding = { head, pointerRevision: pointer.value.revision ?? 0 };
      }
    }
    const normKinds: readonly string[] = ['convention', 'decision', 'preference'];
    const eligible = main.filter(head => (head.state === 'accepted' || head.state === 'reviewed')
      && normKinds.includes(head.kind) && (head.state === 'reviewed' || head.confirmedByUser));
    eligible.sort((left, right) => left.createdAt === right.createdAt
      ? compareText(left.noteId, right.noteId) : compareText(right.createdAt, left.createdAt));
    return { ok: true, value: { understanding, norms: eligible.slice(0, PROJECT_NORMS_CHECK_MAX),
      eligibleTotal: eligible.length } };
  }

  /**
   * The ONE norm projection shared by `buildFindPage` and
   * `readMemoryMaterial`. Keep the `currentEligible` heads up to
   * `PROJECT_NORMS_MAX`; `omitted` counts the eligible remainder.
   */
  function eligibleNorms(norms: readonly NoteHeadSnapshot[], itemByKey: ReadonlyMap<string, NoteItemV1>,
    eligibleTotal: number): { rows: NoteIndexRowV1[]; items: NoteItemV1[]; omitted: number } {
    const rows: NoteIndexRowV1[] = [];
    const items: NoteItemV1[] = [];
    for (const head of norms) {
      if (rows.length >= PROJECT_NORMS_MAX) break;
      const item = itemByKey.get(`${head.noteId}@${String(head.version)}`);
      if (item === undefined || !item.currentEligible) continue;
      rows.push({ anchorKey: head.anchorKey0, noteId: head.noteId, version: head.version, kind: head.kind,
        conclusion: head.conclusion, freshness: item.freshness, label: renderNoteHeader(head) });
      items.push(item);
    }
    return { rows, items, omitted: eligibleTotal - rows.length };
  }

  type BuiltFindPage = { items: NoteItemV1[]; header: MemoryProjectHeaderV1 | null;
    understandingItem: NoteItemV1 | null; normItems: NoteItemV1[];
    /** RW-10: every checked header norm (up to `PROJECT_NORMS_CHECK_MAX`), shown or not. */
    checkedNormItems: NoteItemV1[] };

  /**
   * §11.4: the project understanding + norms + this page's items are checked in
   * ONE `checkHeads` call, deduplicated by `noteId@version`. The page items keep
   * their order and segment labels; the header is rebuilt from the check.
   */
  async function buildFindPage(ctx: CoreCallContext, entries: FindEntry[], currentGoalId: string | null,
    anchorSets: Map<string, NoteHeadSnapshot[]>, firstPage: boolean,
    planWindows?: ReadonlyMap<string, PlanRevisionSnapshot | null>): Promise<ReadOutcome<BuiltFindPage>> {
    let selection: HeaderSelection | null = null;
    if (firstPage) {
      const selected = await selectProjectHeader(ctx, ctx.projectId, anchorSets);
      if (!selected.ok) return selected;
      selection = selected.value;
    }
    const headerHeads: NoteHeadSnapshot[] = selection === null ? [] : [
      ...(selection.understanding === null ? [] : [selection.understanding.head]), ...selection.norms];
    const combined: NoteHeadSnapshot[] = [];
    const index = new Map<string, number>();
    for (const head of [...headerHeads, ...entries.map(entry => entry.head)]) {
      const key = `${head.noteId}@${String(head.version)}`;
      if (index.has(key)) continue;
      index.set(key, combined.length);
      combined.push(head);
    }
    const checked = await checkedPage(ctx, combined, currentGoalId, anchorSets, undefined, planWindows);
    if (!checked.ok) return checked;
    const itemByKey = new Map<string, NoteItemV1>();
    for (const item of checked.value.items) itemByKey.set(`${item.noteId}@${String(item.version)}`, item);
    const items = entries.map(entry => {
      const item = itemByKey.get(`${entry.head.noteId}@${String(entry.head.version)}`)!;
      return entry.segment === null ? item : { ...item, segment: entry.segment };
    });
    if (selection === null) return { ok: true, value: { items, header: null, understandingItem: null, normItems: [], checkedNormItems: [] } };
    const understandingHead = selection.understanding === null ? null : selection.understanding.head;
    const understandingItem = understandingHead === null ? null
      : itemByKey.get(`${understandingHead.noteId}@${String(understandingHead.version)}`)!;
    // RW-10/§11.3: every norm actually checked counts for coverage/observedFiles,
    // even the ones `currentEligible` keeps out of the displayed header.
    const checkedNormItems: NoteItemV1[] = selection.norms.map(head =>
      itemByKey.get(`${head.noteId}@${String(head.version)}`)!);
    const eligible = eligibleNorms(selection.norms, itemByKey, selection.eligibleTotal);
    const normItems = eligible.items;
    const norms: MemoryProjectHeaderV1['norms'] = eligible.rows.map(row =>
      ({ noteId: row.noteId, version: row.version, header: row.label }));
    const header: MemoryProjectHeaderV1 = {
      understanding: selection.understanding === null || understandingItem === null ? null : {
        noteId: selection.understanding.head.noteId, version: selection.understanding.head.version,
        pointerRevision: selection.understanding.pointerRevision,
        conclusion: selection.understanding.head.conclusion, currentEligible: understandingItem.currentEligible },
      norms, omitted: eligible.omitted };
    return { ok: true, value: { items, header, understandingItem, normItems, checkedNormItems } };
  }

  type SegmentedCandidates = {
    entries: FindEntry[];
    next: string | null;
    scores: Map<string, { matchedTerms: string[]; score: number }>;
    ranking: 'full' | 'partial' | undefined;
    warnings: string[];
    seg1Exhausted: boolean;
    seg1Placed: number;
    anchorSets: Map<string, NoteHeadSnapshot[]>;
  };

  /**
   * §11.2: each segment is built and ranked independently (its own U, df,
   * candidate cap). One page may hold the end of segment 1 and the start of
   * segment 2; after segment 1 the next cursor is `{seg:'project', after:null}`.
   */
  async function segmentedCandidates(ctx: CoreCallContext, scopeInput: MemoryFindRequest, scope: RelatedScope,
    rawTerms: string[] | null, match: 'any' | 'all', limit: number, cursorValue: MemoryCursor,
    request: unknown, ledgerCursor: string | null): Promise<ReadOutcome<SegmentedCandidates>> {
    const currentGoalId = currentGoalIdOf(ctx);
    const isAll = rawTerms !== null && match === 'all';
    let terms: string[] | null = null;
    let rankTerms: string[] = [];
    if (rawTerms !== null) {
      const decoded = normalizeTerms(rawTerms);
      if (!decoded.ok) return { ok: false, code: 'invalid', reason: decoded.reason };
      terms = decoded.match;
      rankTerms = decoded.rank;
    }
    const anchorSets = new Map<string, NoteHeadSnapshot[]>();
    const scores = new Map<string, { matchedTerms: string[]; score: number }>();
    const warnings: string[] = [];
    const startSeg: FindSegment = cursorValue.seg ?? 'related';
    const skipRelated = (head: NoteHeadSnapshot): boolean => isRelatedHead(head, scope.keys);
    const encodeNext = (seg: FindSegment | null, after: string | null): string | null =>
      encodeMemoryCursor(ctx, 'find', request, { after, recordCursor: ledgerCursor, seg, resolved: scope.node });

    const seg1Read = await readHeadsForKeys(ctx, scope.keys, anchorSets);
    if (!seg1Read.ok) return seg1Read;
    const seg1Base = seg1Read.value.filter(head => isRelatedHead(head, scope.keys)
      && headInScope(head, scopeInput, currentGoalId));

    if (rawTerms === null) {
      const order = (left: NoteHeadSnapshot, right: NoteHeadSnapshot): number => left.createdAt === right.createdAt
        ? compareText(left.noteId, right.noteId) : compareText(left.createdAt, right.createdAt);
      const segment1 = [...seg1Base].sort(order);
      const readSegment2 = async (): Promise<ReadOutcome<NoteHeadSnapshot[]>> => {
        const seg2Read = await unscopedHeads(ctx, scopeInput, currentGoalId);
        if (!seg2Read.ok) return seg2Read;
        return { ok: true, value: [...seg2Read.value].filter(head => !skipRelated(head)).sort(order) };
      };
      if (startSeg === 'project') {
        const seg2Read = await readSegment2();
        if (!seg2Read.ok) return seg2Read;
        const slice = sliceByCursor(seg2Read.value, cursorValue.after, limit);
        if (!slice.ok) return slice;
        const entries = slice.page.map(head => ({ head, segment: 'project' as const }));
        return { ok: true, value: { entries, scores, ranking: undefined, warnings,
          next: slice.complete ? null : encodeNext('project', entries[entries.length - 1]!.head.noteId),
          seg1Exhausted: true, seg1Placed: 0, anchorSets } };
      }
      const slice1 = sliceByCursor(segment1, cursorValue.after, limit);
      if (!slice1.ok) return slice1;
      const placed1 = slice1.page.map(head => ({ head, segment: 'related' as const }));
      // RW-12(d): a page that stays in segment 1 never reads the second segment.
      if (!slice1.complete) {
        return { ok: true, value: { entries: placed1, scores, ranking: undefined, warnings,
          next: encodeNext('related', placed1[placed1.length - 1]!.head.noteId),
          seg1Exhausted: false, seg1Placed: placed1.length, anchorSets } };
      }
      const seg2Read = await readSegment2();
      if (!seg2Read.ok) return seg2Read;
      const segment2 = seg2Read.value;
      if (placed1.length < limit) {
        const slice2 = sliceByCursor(segment2, null, limit - placed1.length);
        if (!slice2.ok) return slice2;
        const placed2 = slice2.page.map(head => ({ head, segment: 'project' as const }));
        const entries = [...placed1, ...placed2];
        const next = slice2.complete ? null : encodeNext('project', placed2[placed2.length - 1]!.head.noteId);
        return { ok: true, value: { entries, scores, ranking: undefined, warnings, next,
          seg1Exhausted: true, seg1Placed: placed1.length, anchorSets } };
      }
      return { ok: true, value: { entries: placed1, scores, ranking: undefined, warnings,
        next: segment2.length > 0 ? encodeNext('project', null) : null,
        seg1Exhausted: true, seg1Placed: placed1.length, anchorSets } };
    }

    // Terms: segment 2 uses the text port; segment 1 is a local scoped scan.
    let seg1Ordered: NoteHeadSnapshot[] = [];
    let partial1 = false;
    {
      const matched = scopedMatches(ctx.projectId, scopeInput, currentGoalId, seg1Base, terms!, match)
        .filter(entry => isRelatedHead(entry.head, scope.keys));
      if (match === 'any') {
        partial1 = matched.length > textSearchCandidateMax;
        const candidateHeads = (partial1 ? matched.slice(0, textSearchCandidateMax) : matched).map(entry => entry.head);
        const rankedSeg1 = rankMatches(candidateHeads, rankTerms);
        if (partial1) warnings.push('匹配集合超过候选上限；请按锚点、路径前缀、种类或加词缩小范围');
        for (const entry of rankedSeg1.ranked) {
          scores.set(entry.head.noteId, { matchedTerms: entry.matchedTerms, score: entry.score });
        }
        seg1Ordered = rankedSeg1.ranked.map(entry => entry.head);
      } else {
        seg1Ordered = matched.map(entry => entry.head);
      }
    }

    if (startSeg === 'project') {
      const seg2 = await segmentTwoByTerms(ctx, scopeInput, terms!, rankTerms, limit, cursorValue.after,
        skipRelated, scores, warnings, match, isAll, encodeNext);
      if (!seg2.ok) return seg2;
      return { ok: true, value: { entries: seg2.value.entries, scores,
        ranking: isAll ? undefined : (partial1 || seg2.value.ranking === 'partial' ? 'partial' : 'full'),
        warnings, next: seg2.value.next, seg1Exhausted: true, seg1Placed: 0, anchorSets } };
    }

    if (isAll) {
      const after = cursorValue.after;
      let start = 0;
      if (after !== null) {
        start = seg1Ordered.length;
        for (let position = 0; position < seg1Ordered.length; position += 1) {
          const refKey = noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId,
            noteId: seg1Ordered[position]!.noteId });
          if (compareRefKeysFast(refKey, after) > 0) { start = position; break; }
        }
      }
      const page1 = seg1Ordered.slice(start, start + limit);
      const entries = page1.map(head => ({ head, segment: 'related' as const }));
      scoresClearAndFill(scores, page1, rankTerms);
      const seg1Exhausted = start + limit >= seg1Ordered.length;
      if (seg1Exhausted && entries.length < limit) {
        const seg2 = await segmentTwoByTerms(ctx, scopeInput, terms!, rankTerms, limit - entries.length, null,
          skipRelated, scores, warnings, match, isAll, encodeNext);
        if (!seg2.ok) return seg2;
        return { ok: true, value: { entries: [...entries, ...seg2.value.entries], scores,
          ranking: undefined, warnings, next: seg2.value.next, seg1Exhausted: true, seg1Placed: entries.length,
          anchorSets } };
      }
      if (!seg1Exhausted) {
        const lastRef = noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId,
          noteId: page1[page1.length - 1]!.noteId });
        return { ok: true, value: { entries, scores, ranking: undefined, warnings,
          next: encodeNext('related', lastRef), seg1Exhausted: false, seg1Placed: entries.length, anchorSets } };
      }
      return { ok: true, value: { entries, scores, ranking: undefined, warnings,
        next: encodeNext('project', null), seg1Exhausted: true, seg1Placed: entries.length, anchorSets } };
    }

    // `'any'`: each segment is sliced by noteId after its own ranking.
    const slice1 = sliceByCursor(seg1Ordered, cursorValue.after, limit);
    if (!slice1.ok) return slice1;
    const placed1 = slice1.page.map(head => ({ head, segment: 'related' as const }));
    if (slice1.complete && placed1.length < limit) {
      const seg2 = await segmentTwoByTerms(ctx, scopeInput, terms!, rankTerms, limit - placed1.length, null,
        skipRelated, scores, warnings, match, isAll, encodeNext);
      if (!seg2.ok) return seg2;
      return { ok: true, value: { entries: [...placed1, ...seg2.value.entries], scores,
        ranking: partial1 || seg2.value.ranking === 'partial' ? 'partial' : 'full', warnings, next: seg2.value.next,
        seg1Exhausted: true, seg1Placed: placed1.length, anchorSets } };
    }
    if (!slice1.complete) {
      return { ok: true, value: { entries: placed1, scores, ranking: partial1 ? 'partial' : 'full', warnings,
        next: encodeNext('related', placed1[placed1.length - 1]!.head.noteId),
        seg1Exhausted: false, seg1Placed: placed1.length, anchorSets } };
    }
    // Segment 1 ended exactly at the limit; segment 2 starts on the next page.
    return { ok: true, value: { entries: placed1, scores, ranking: partial1 ? 'partial' : 'full', warnings,
      next: encodeNext('project', null), seg1Exhausted: true, seg1Placed: placed1.length, anchorSets } };
  }

  /** Replace the term scores for a page of heads (segment 1's `'all'` page). */
  function scoresClearAndFill(scores: Map<string, { matchedTerms: string[]; score: number }>,
    heads: readonly NoteHeadSnapshot[], rankTerms: readonly string[]): void {
    for (const [noteId, entry] of rankAll(heads, rankTerms)) scores.set(noteId, entry);
  }

  /** Segment 2 under terms: the existing port paths, skipping related notes. */
  async function segmentTwoByTerms(ctx: CoreCallContext, input: MemoryFindRequest, terms: readonly string[],
    rankTerms: readonly string[], limit: number, after: string | null,
    skipRelated: (head: NoteHeadSnapshot) => boolean,
    scores: Map<string, { matchedTerms: string[]; score: number }>, warnings: string[], match: 'any' | 'all',
    isAll: boolean, encodeNext: (seg: FindSegment | null, after: string | null) => string | null):
  Promise<ReadOutcome<{ entries: FindEntry[]; next: string | null; ranking: 'full' | 'partial' }>> {
    if (isAll) {
      const heads = await allTermHeads(ctx, input, terms, limit, after, skipRelated);
      if (!heads.ok) return { ok: false, code: heads.code === 'unsupported' ? 'unavailable' : heads.code, reason: heads.reason };
      for (const [noteId, entry] of rankAll(heads.value.items, rankTerms)) scores.set(noteId, entry);
      const entries = heads.value.items.map(head => ({ head, segment: 'project' as const }));
      return { ok: true, value: { entries,
        next: heads.value.next === null ? null : encodeNext('project', heads.value.next), ranking: 'full' } };
    }
    const heads = await anyTermHeads(ctx, input, terms, skipRelated);
    if (!heads.ok) return { ok: false, code: heads.code === 'unsupported' ? 'unavailable' : heads.code, reason: heads.reason };
    const ranked = rankMatches(heads.value.items, rankTerms);
    if (heads.value.partial) warnings.push('匹配集合超过候选上限；请按锚点、路径前缀、种类或加词缩小范围');
    for (const entry of ranked.ranked) scores.set(entry.head.noteId, { matchedTerms: entry.matchedTerms, score: entry.score });
    const ordered = ranked.ranked.map(entry => entry.head);
    const slice = sliceByCursor(ordered, after, limit);
    if (!slice.ok) return slice;
    const entries: FindEntry[] = slice.page.map(head => ({ head, segment: 'project' as const }));
    const next = slice.complete ? null : encodeNext('project', entries[entries.length - 1]!.head.noteId);
    return { ok: true, value: { entries, next, ranking: heads.value.partial ? 'partial' : 'full' } };
  }

  type FindPageInput = {
    entries: FindEntry[];
    next: string | null;
    scores: Map<string, { matchedTerms: string[]; score: number }>;
    ranking: 'full' | 'partial' | undefined;
    warnings: string[];
    isAll: boolean;
    firstPage: boolean;
    scope: RelatedScope | null;
    seg1Exhausted: boolean;
    seg1Placed: number;
    anchorSets: Map<string, NoteHeadSnapshot[]>;
    /** Plan windows the related-scope resolution already read. */
    planWindows?: ReadonlyMap<string, PlanRevisionSnapshot | null>;
  };

  /**
   * §11.2/§11.4: check the page (plus the first-page project header) once,
   * assemble `segment`/`related`/`boundary`/`project`, then apply R12's trim:
   * page items first (down to 1), then the project norms; the understanding is
   * never trimmed. `coverage` and `readBasis.observedFiles` are recomputed from
   * the kept project part plus the kept items.
   */
  async function finishFind(ctx: CoreCallContext, request: unknown, current: string | null,
    plan: FindPageInput): Promise<ReadOutcome<MemoryResultV1>> {
    const built = await buildFindPage(ctx, plan.entries, currentGoalIdOf(ctx), plan.anchorSets, plan.firstPage,
      plan.planWindows);
    if (!built.ok) return built;
    const items = built.value.items.map(item => {
      const rank = plan.scores.get(item.noteId);
      return { ...item, matchedTerms: rank?.matchedTerms ?? [], score: rank?.score ?? 0 };
    });
    const segmented = plan.scope !== null;
    // RW-10/§11.3: coverage, `filesRead` and `observedFiles` count every header
    // norm actually checked in this page's one `checkHeads`, not only the five
    // displayed ones.
    const headerCoverageItems = built.value.understandingItem === null ? [...built.value.checkedNormItems]
      : [built.value.understandingItem, ...built.value.checkedNormItems];
    // §11.4: the header and the page items are checked once; coverage must not
    // count a norm twice when it also appears as a page item.
    const dedupCoverage = (entries: readonly NoteItemV1[]): NoteItemV1[] => {
      const seen = new Set<string>();
      const out: NoteItemV1[] = [];
      for (const item of entries) {
        const key = `${item.noteId}@${String(item.version)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
      return out;
    };
    const anyPartial = plan.ranking !== undefined && plan.ranking === 'partial';
    const complete = plan.next === null && (plan.isAll || !anyPartial);
    // RW-9/§11.2: `boundary` is part of the measured result, so every rebuild
    // (and the initial result) already carries its bytes.
    const boundaryOf = (kept: readonly NoteItemV1[]): { relatedEnded: boolean; projectStartsAt: number | null } => {
      const seg1Kept = kept.filter(item => item.segment === 'related').length;
      const projectStartsAt = kept.findIndex(item => item.segment === 'project');
      return { relatedEnded: plan.seg1Exhausted && seg1Kept === plan.seg1Placed,
        projectStartsAt: projectStartsAt < 0 ? null : projectStartsAt };
    };
    const result: MemoryResultV1 = {
      readBasis: { recordCursor: current, ruleVersion: RULE_VERSION,
        observedFiles: observedFilesOf(dedupCoverage([...headerCoverageItems, ...items])) },
      items, warnings: [...plan.warnings], next: plan.next, complete,
      ...(plan.ranking === undefined ? {} : { ranking: plan.ranking }),
      ...(segmented ? { related: { node: plan.scope!.node, filesOmitted: plan.scope!.filesOmitted,
        filesUnknownRuns: plan.scope!.filesUnknownRuns } } : {}),
      ...(built.value.header === null ? {} : { project: built.value.header }),
      ...(segmented ? { boundary: boundaryOf(items) } : {}),
      coverage: coverageOf(dedupCoverage([...headerCoverageItems, ...items])),
    };
    const bytes = (candidate: MemoryResultV1): number => Buffer.byteLength(JSON.stringify(candidate), 'utf8');
    const encodeAfterFor = (kept: readonly NoteItemV1[]): string | null => {
      if (kept.length === 0) return null;
      const last = kept[kept.length - 1]!;
      const after = plan.isAll
        ? noteHeadRefKey({ aggregateType: 'NoteHead', projectId: ctx.projectId, noteId: last.noteId })
        : last.noteId;
      const seg: FindSegment = last.segment === 'project' ? 'project' : 'related';
      return encodeMemoryCursor(ctx, 'find', request, { after, recordCursor: current, seg,
        resolved: plan.scope?.node ?? null });
    };
    const rebuild = (keptItems: NoteItemV1[], header: MemoryProjectHeaderV1 | null,
      coverageHeaderItems: readonly NoteItemV1[], next: string | null): MemoryResultV1 => {
      const observed = dedupCoverage([...coverageHeaderItems, ...keptItems]);
      return { ...result, items: keptItems, ...(header === null ? {} : { project: header }),
        next, ...(next === null ? {} : { complete: false }),
        ...(segmented ? { boundary: boundaryOf(keptItems) } : {}),
        readBasis: { ...result.readBasis, observedFiles: observedFilesOf(observed) },
        coverage: coverageOf(observed) };
    };
    let page = result;
    let keptItems = items;
    let header = built.value.header;
    let keptHeaderCoverage: NoteItemV1[] = headerCoverageItems;
    let dropped = false;
    while (keptItems.length > 1 && bytes(page) > resultMaxBytes) {
      keptItems = keptItems.slice(0, -1);
      dropped = true;
      page = rebuild(keptItems, header, keptHeaderCoverage, encodeAfterFor(keptItems));
    }
    // RW-9: `next` is computed once after the item loop and reused by the norm
    // loop, so an empty-items `'all'` page with a non-null port cursor keeps it.
    const nextAfterItems = page.next;
    while (header !== null && header.norms.length > 0 && bytes(page) > resultMaxBytes) {
      header = { ...header, norms: header.norms.slice(0, -1), omitted: header.omitted + 1 };
      dropped = true;
      // RW-10: a norm trimmed from the SHOWN header list is still
      // checked, so it stays in coverage/filesRead/observedFiles. Only when the
      // whole project header is absent (`built.value.header === null`, so
      // `headerCoverageItems` is empty) do no norms count.
      page = rebuild(keptItems, header, keptHeaderCoverage, nextAfterItems);
    }
    if (bytes(page) > resultMaxBytes) {
      const more = dropped || plan.entries.length > 1 || plan.next !== null;
      page = { ...page, warnings: page.warnings.includes('result_over_byte_bound') ? page.warnings
        : [...page.warnings, 'result_over_byte_bound'], ...(more ? { complete: false } : {}) };
    }
    return { ok: true, value: page };
  }

  // --------------------------------------------------------------------------
  // Slice 4C C1.4: the route-facing `notes/list` forms
  // --------------------------------------------------------------------------

  /**
   * The `lookup` read, shared by the public `memoryLookup` and the `notes/list`
   * anchor form. `explicitState` is §11.3's explicit state override; it is also
   * bound into the cursor so a changed state is `cursor_mismatch`. The page
   * heads ride along so the caller can render `renderNoteHeader` (which needs
   * the stored `structural`) for the row labels.
   */
  async function lookupRead(ctx: CoreCallContext, input: MemoryLookupRequest, explicitState: NoteState | undefined):
  Promise<NoteMemoryReadResult<{ result: MemoryLookupResultV1; heads: NoteHeadSnapshot[] }>> {
    const limit = resolveMemoryLimit(input.limit);
    // R10: the outer cursor binds the body TARGET, not the body cursor, so the
    // item page and the body page advance independently.
    const request = { op: 'lookup', anchor: input.anchor, limit,
      body: input.body === undefined ? null : { noteId: input.body.noteId, version: input.body.version ?? null },
      ...(explicitState === undefined ? {} : { state: explicitState }) };
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
    // F4: seed the check's anchor cache with the raw set this read just loaded.
    const anchorSets = new Map<string, NoteHeadSnapshot[]>();
    anchorSets.set(`${ctx.projectId}\u0000${anchorKey}`, headSet.value);
    const onAnchor = headSet.value.filter(head => anchorSlots(head).includes(anchorKey));
    if (onAnchor.length === 0) {
      const exists = await anchorExistsNow(ctx, input.anchor);
      if (!exists.ok) return rejected(exists.code, exists.reason);
      if (!exists.exists) return anchorNotFound(exists.anchorCandidates, exists.candidatesUnavailable);
    }
    const currentGoalId = currentGoalIdOf(ctx);
    // §11.3 (b11): filter by stored fields BEFORE sort and slice, so hidden
    // heads never spend a page slot or the check's budgets. The existence check
    // above still uses the unfiltered set.
    const ordered = [...onAnchor.filter(head => lookupVisible(head, currentGoalId, explicitState))].sort((left, right) => {
      const tiers = lookupTier(left, currentGoalId) - lookupTier(right, currentGoalId);
      return tiers !== 0 ? tiers : compareText(left.noteId, right.noteId);
    });
    const slice = sliceByCursor(ordered, cursor.value.after, limit);
    if (!slice.ok) return rejected(slice.code, slice.reason);
    // U-3: the understanding status comes from the SAME check call/caches now
    // (goal/stage/project anchors only); `understandingOf` no longer reads its
    // own pointer.
    const understandingAnchors = input.anchor.kind === 'goal' || input.anchor.kind === 'stage'
      || input.anchor.kind === 'project' ? [anchorKey] : undefined;
    const pageBuilt = await checkedPage(ctx, slice.page, currentGoalId, anchorSets, undefined, undefined,
      understandingAnchors);
    if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
    let items = pageBuilt.value.items;
    const next = slice.complete ? null : encodeMemoryCursor(ctx, 'lookup', request,
      { after: slice.last, recordCursor: current.value });
    const understanding = understandingAnchors === undefined ? null
      : pageBuilt.value.understanding.find(status => status.anchorKey === anchorKey) ?? null;
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
      warnings, next, complete: next === null, coverage: coverageOf(pageBuilt.value.items),
      understanding, topics: groups.topics, topicsComplete: groups.complete };
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
    return { status: 'ready', value: { result: fitted, heads: slice.page } };
  }

  /**
   * The per-goal review-status bucket the pending reads already use. Order and
   * paging follow `find` without terms (`createdAt`, then `noteId`); the bucket
   * itself is the existing status index read.
   */
  async function goalBucketRead(ctx: CoreCallContext, goalId: string | null, state: NoteState,
    limit: number, cursor: string | null): Promise<NoteMemoryReadResult<NoteListResultV1>> {
    const request = { op: 'notes_list', goalId, state, limit };
    const parsed = parseMemoryCursor(ctx, cursor, 'notes_list', request);
    if (!parsed.ok) return rejected(parsed.code, parsed.reason);
    const current = await ledgerCursor();
    if (!current.ok) return rejected(current.code, current.reason);
    if (parsed.value.recordCursor !== null && current.value !== parsed.value.recordCursor) {
      return rejected('revision_conflict', 'the record cursor moved since the first page');
    }
    const heads = await headsOnReviewStatus(ctx.projectId, goalId, [state]);
    if (!heads.ok) return rejected(heads.code, heads.reason);
    const ordered = [...heads.value].sort((left, right) => left.createdAt === right.createdAt
      ? compareText(left.noteId, right.noteId) : compareText(left.createdAt, right.createdAt));
    const slice = sliceByCursor(ordered, parsed.value.after, limit);
    if (!slice.ok) return rejected(slice.code, slice.reason);
    const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx));
    if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
    const next = slice.complete ? null : encodeMemoryCursor(ctx, 'notes_list', request,
      { after: slice.last, recordCursor: current.value });
    const result: NoteListResultV1 = {
      items: pageBuilt.value.items.map((item, index) => ({ ...item, label: renderNoteHeader(slice.page[index]!) })),
      next, complete: next === null, readBasis: basisOf(current.value, pageBuilt.value.items), warnings: [],
      coverage: coverageOf(pageBuilt.value.items) };
    return { status: 'ready', value: result };
  }

  // ========================================================================
  // U8/§11.4/§11.5/L20: the memory material (one read window, caller picks)
  // ========================================================================

  function isCurrentUnderstanding(head: NoteHeadSnapshot): boolean {
    return head.kind === 'understanding' && (head.state === 'accepted' || head.state === 'reviewed');
  }

  /** L20 source order: own task, stage, goal, then module/interface/file. */
  function generalKeyRank(key: string): number {
    if (key.startsWith('task:')) return 0;
    if (key.startsWith('stage:')) return 1;
    if (key.startsWith('goal:')) return 2;
    if (key.startsWith('module:') || key.startsWith('interface:') || key.startsWith('file:')) return 3;
    return 4;
  }

  /** L20: one warning line or none; the conclusion and its warning never split. */
  function generalWarningLabel(item: NoteItemV1, head: NoteHeadSnapshot): string | null {
    const word = item.freshness === 'stale' ? '需复查'
      : item.conflicting ? '冲突'
      : item.sourceUnavailable ? '来源不可用' : null;
    return word === null ? null : `${word}：${head.noteId} ${head.conclusion}，不能当现行结论`;
  }

  /**
   * U8: one read window per assembly. It reuses `selectProjectHeader`, the
   * shared related-scope key builder (`resolveTaskScopeWithPlan` over the plan
   * window this call already read), ONE batched pointer read, ONE batched head
   * read, `readHeadsForKeys` and ONE `checkedPage` call, so project header,
   * local understandings, general rows and reminders come from the same check
   * caches. The project anchor set is read once per call and shared with the
   * check; an includeInputs Query's general keys never hold
   * `project`, so that one header read is the only project-key scan. A null
   * goal is 6A's branch (`unsupported`, reason `6A`); any read failure is
   * `unavailable`.
   */
  async function readMemoryMaterial(ctx: CoreCallContext, input: NoteMemoryMaterialInputV1):
  Promise<ReadResult<NoteMemoryMaterialV1>> {
    if (input.goalId === null) return rejected('unsupported', '6A');
    const goalId = input.goalId;

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
    const window = await readGoalPlanWindow(deps.records, goalRef);
    if (window.status !== 'ready') return rejected('unavailable', window.reason);
    const plan = window.plan;
    const planWindows = new Map<string, PlanRevisionSnapshot | null>();
    planWindows.set(`${ctx.projectId}\u0000${goalId}`, plan);

    // An explicit stage wins; otherwise the task's stage comes from the
    // plan window this call already read, through the shared `stageIdOf`.
    const goalAnchorKey = `goal:${goalId}`;
    let stageId = input.stageId ?? null;
    if (stageId === null && input.taskId !== undefined && input.taskId !== null && plan !== null) {
      const task = plan.tasks.find(candidate => candidate.taskId === input.taskId);
      stageId = task === undefined ? null : stageIdOf(task);
    }
    const stageAnchorKey = stageId !== null && plan !== null
      && plan.stages.some(stage => stage.stageId === stageId)
      ? `stage:${goalId}/${String(plan.planRevision)}/${stageId}` : null;

    // §11.7: ONE batched pointer read for the project,
    // goal and stage anchors plus ONE batched head read of their pointed notes,
    // through the shared leaf reader.
    const anchorKeys = ['project', goalAnchorKey, ...(stageAnchorKey === null ? [] : [stageAnchorKey])];
    const preRead = await pointersAndHeadsOf(ctx.projectId, anchorKeys);
    if (!preRead.ok) return rejected(preRead.code, preRead.reason);
    const pointerOfAnchor = (anchorKey: string): { noteId: string | null; revision: number | null } =>
      preRead.value.pointers.get(anchorKey) ?? { noteId: null, revision: null };
    const seed: UnderstandingPointerSeed = new Map(anchorKeys.map(anchorKey => {
      const pointer = pointerOfAnchor(anchorKey);
      return [`${ctx.projectId}\u0000${anchorKey}`,
        { pointer, head: pointer.noteId === null ? null : preRead.value.heads.get(pointer.noteId) ?? null }];
    }));
    const seedOf = (anchorKey: string) => seed.get(`${ctx.projectId}\u0000${anchorKey}`)!;
    const projectPreRead = seedOf('project');
    const goalHead = seedOf(goalAnchorKey).head;
    const stageHead = stageAnchorKey === null ? null : seedOf(stageAnchorKey).head;

    // §11.7: the per-call anchor-set map exists BEFORE the
    // header selection, so the one project set it reads is stored here and the
    // check below reuses it instead of scanning the five slots a second time.
    const anchorSets = new Map<string, NoteHeadSnapshot[]>();
    const selected = await selectProjectHeader(ctx, ctx.projectId, anchorSets,
      { pointer: projectPreRead.pointer, head: projectPreRead.head });
    if (!selected.ok) return rejected(selected.code, selected.reason);

    // Ruling 9: a Query assembly (`includeInputs === false`) skips the
    // related scope and the whole general part; understanding + norms remain.
    const generalKeys: string[] = [];
    const generalKeySet = new Set<string>();
    let generalHeads: NoteHeadSnapshot[] = [];
    if (input.includeInputs !== false) {
      if (input.taskId !== undefined && input.taskId !== null) {
        if (plan === null || window.goal.workspaceRef.workspaceId !== ctx.workspaceId) {
          return rejected('not_found', 'related_not_found');
        }
        const scope = await resolveTaskScopeWithPlan(ctx, relatedDeps, goalId, input.taskId, plan);
        if (!scope.ok) return rejected(scope.code, scope.reason);
        if (scope.value !== null) {
          for (const key of scope.value.keys) if (key !== 'project') generalKeys.push(key);
        }
      }
      if (stageAnchorKey !== null && !generalKeys.includes(stageAnchorKey)) generalKeys.push(stageAnchorKey);
      if (!generalKeys.includes(goalAnchorKey)) generalKeys.push(goalAnchorKey);
      // L20 source order: own task, stage(s), goal, module/interface/file.
      generalKeys.sort((left, right) => generalKeyRank(left) - generalKeyRank(right));
      for (const key of generalKeys) generalKeySet.add(key);
      const generalRead = await readHeadsForKeys(ctx, generalKeys, anchorSets);
      if (!generalRead.ok) return rejected(generalRead.code, generalRead.reason);
      // The stage-prefix scan collects every stage AND revision of the
      // goal; keep only the heads whose anchors intersect THIS call's keys.
      generalHeads = generalRead.value.filter(head => isRelatedHead(head, generalKeySet));
    }

    const understandingAnchors = stageAnchorKey === null ? [goalAnchorKey] : [goalAnchorKey, stageAnchorKey];
    // ONE check call for the project header, both local understandings, every
    // general head and the understanding anchors (deduplicated by note).
    const combined = new Map<string, NoteHeadSnapshot>();
    const addHead = (head: NoteHeadSnapshot): void => { if (!combined.has(head.noteId)) combined.set(head.noteId, head); };
    if (selected.value.understanding !== null) addHead(selected.value.understanding.head);
    for (const head of selected.value.norms) addHead(head);
    if (goalHead !== null) addHead(goalHead);
    if (stageHead !== null) addHead(stageHead);
    for (const head of generalHeads) addHead(head);
    const pageBuilt = await checkedPage(ctx, [...combined.values()], goalId, anchorSets, undefined, planWindows,
      understandingAnchors, seed);
    if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
    const itemByKey = new Map<string, NoteItemV1>();
    for (const item of pageBuilt.value.items) itemByKey.set(`${item.noteId}@${String(item.version)}`, item);
    const understandingByAnchor = new Map(pageBuilt.value.understanding.map(status => [status.anchorKey, status]));
    const itemOfHead = (head: NoteHeadSnapshot | null): NoteItemV1 | undefined =>
      head === null ? undefined : itemByKey.get(`${head.noteId}@${String(head.version)}`);

    // Items 2/4: the project row carries the real note version and the check's
    // `currentEligible`; an ineligible row renders no body.
    let projectUnderstanding: NotesUnderstandingRowV1 | null = null;
    if (selected.value.understanding !== null) {
      const head = selected.value.understanding.head;
      const currentEligible = itemOfHead(head)?.currentEligible ?? false;
      projectUnderstanding = { scope: 'project',
        status: { anchorKey: 'project',
          pointer: { noteId: head.noteId, revision: selected.value.understanding.pointerRevision },
          updateDue: null, latestTriggerCursor: null },
        version: head.version, currentEligible, conclusion: head.conclusion,
        body: currentEligible
          ? (head.sections === undefined ? head.body : renderUnderstandingBody(head.sections)) : null };
    }

    const normsResult = eligibleNorms(selected.value.norms, itemByKey, selected.value.eligibleTotal);
    const norms = normsResult.rows;
    const normsOmitted = normsResult.omitted;

    // The goal row is ALWAYS present and the stage row whenever the
    // task's stage is in the plan; each carries its real status even without a
    // current understanding (version/conclusion/body null, currentEligible false).
    const localUnderstanding: NotesUnderstandingRowV1[] = [];
    const localRow = (scope: 'goal' | 'stage', anchorKey: string, head: NoteHeadSnapshot | null):
    NotesUnderstandingRowV1 | null => {
      const status = understandingByAnchor.get(anchorKey);
      if (status === undefined) return null;
      if (head === null || !isCurrentUnderstanding(head)) {
        return { scope, status, version: null, currentEligible: false, conclusion: null, body: null };
      }
      return { scope, status, version: head.version,
        currentEligible: itemOfHead(head)?.currentEligible ?? false, conclusion: head.conclusion, body: null };
    };
    const goalRow = localRow('goal', goalAnchorKey, goalHead);
    if (goalRow !== null) localUnderstanding.push(goalRow);
    const stageRow = stageAnchorKey === null ? null : localRow('stage', stageAnchorKey, stageHead);
    if (stageRow !== null) localUnderstanding.push(stageRow);

    const excluded = new Set<string>();
    if (selected.value.understanding !== null) excluded.add(selected.value.understanding.head.noteId);
    for (const row of norms) excluded.add(row.noteId);

    // The source rank is the CLASS of the matched key (L20 order), not
    // the key's array position; the array order of `generalKeys` only picks the
    // display anchor within the same class. The tier is the L20 tier
    // (confirmed -> own-goal -> cross).
    const classRankOf = (head: NoteHeadSnapshot): number => {
      let rank = Number.MAX_SAFE_INTEGER;
      for (const key of anchorSlots(head)) {
        if (!generalKeySet.has(key)) continue;
        const candidate = generalKeyRank(key);
        if (candidate < rank) rank = candidate;
      }
      return rank;
    };
    const displayAnchorOf = (head: NoteHeadSnapshot): string => {
      const keys = anchorSlots(head);
      for (const key of generalKeys) {
        if (generalKeySet.has(key) && keys.includes(key)) return key;
      }
      return head.anchorKey0;
    };
    const tierOf = (head: NoteHeadSnapshot): number =>
      head.confirmedByUser ? 0 : head.goalId === goalId ? 1 : 2;
    const general: NoteIndexRowV1[] = [];
    for (const head of generalHeads
      .filter(candidate => isGeneral(candidate.kind) && visibleByDefault(candidate, goalId)
        && !excluded.has(candidate.noteId))
      .sort((left, right) => {
        const leftRank = classRankOf(left);
        const rightRank = classRankOf(right);
        if (leftRank !== rightRank) return leftRank - rightRank;
        const leftTier = tierOf(left);
        const rightTier = tierOf(right);
        if (leftTier !== rightTier) return leftTier - rightTier;
        const byTopic = compareText(left.topic, right.topic);
        return byTopic !== 0 ? byTopic : compareText(left.noteId, right.noteId);
      })) {
      const item = itemOfHead(head);
      if (item === undefined) continue;
      // Only a current conclusion, or one warning row for an
      // accepted/reviewed stale/conflicting/source-unavailable head; every
      // other ineligible head contributes no row at all.
      if (item.currentEligible) {
        general.push({ anchorKey: displayAnchorOf(head), noteId: head.noteId, version: head.version, kind: head.kind,
          conclusion: head.conclusion, freshness: item.freshness, label: renderNoteHeader(head) });
        continue;
      }
      const warningState = head.state === 'accepted' || head.state === 'reviewed';
      const warningWord = item.freshness === 'stale' || item.conflicting || item.sourceUnavailable;
      if (!warningState || !warningWord) continue;
      const label = generalWarningLabel(item, head);
      if (label === null) continue;
      general.push({ anchorKey: displayAnchorOf(head), noteId: head.noteId, version: head.version, kind: head.kind,
        conclusion: head.conclusion, freshness: item.freshness, label });
    }

    const reminders = pageBuilt.value.understanding.map(status => ({ anchorKey: status.anchorKey,
      updateDue: status.updateDue, latestTriggerCursor: status.latestTriggerCursor }));

    return { status: 'ready', value: { projectUnderstanding, norms, normsOmitted, localUnderstanding, general,
      reminders } };
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
        // F4: the head and the version snapshot go to the check, which re-reads
        // neither. A version without its head is a hand-edited or damaged store,
        // not a readable note (decision 79).
        if (headRead.value === null) return rejected('unavailable', 'the note head is missing');
        const item = itemOfVersion(version.value, confirmed.value);
        const headVersion = headRead.value.version;
        const checked = await withCheck(ctx, [item], new Map([[input.noteId, headVersion]]),
          new Map([[input.noteId, headRead.value]]), undefined, new Map([[input.version, version.value]]));
        if (!checked.ok) return rejected(checked.code, checked.reason);
        return { status: 'ready', value: checked.value.items[0]! };
      }
      const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
      if (!head.ok) return rejected(head.code, head.reason);
      if (head.value === null) return { status: 'not_found' };
      const item = await itemOfHead(head.value, ctx.projectId, newHeadCache());
      if (!item.ok) return rejected(item.code, item.reason);
      // F4: the head just read goes straight into the check.
      const checked = await withCheck(ctx, [item.value], undefined, new Map([[input.noteId, head.value]]));
      if (!checked.ok) return rejected(checked.code, checked.reason);
      return { status: 'ready', value: checked.value.items[0]! };
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
        // A cursor naming a note not on this anchor is a mismatch;
        // never silently restart at the first page.
        if (index < 0) return rejected('invalid', 'cursor_mismatch');
        start = index + 1;
      }
      const page = all.slice(start, start + input.limit);
      const items: NoteItemV1[] = [];
      const cache = newHeadCache();
      const headSnapshots = new Map<string, NoteHeadSnapshot>();
      for (const head of page) {
        const item = await itemOfHead(head, ctx.projectId, cache);
        if (!item.ok) return rejected(item.code, item.reason);
        items.push(item.value);
        headSnapshots.set(head.noteId, head);
      }
      // F4: the anchor set and the page's heads already read in this call are
      // handed to the check (the raw `headsByAnchorKey` value, never a filter).
      const anchorSets = new Map<string, NoteHeadSnapshot[]>();
      anchorSets.set(`${ctx.projectId}\u0000${anchorKey}`, headSet.value);
      const checked = await withCheck(ctx, items, undefined, headSnapshots, anchorSets);
      if (!checked.ok) return rejected(checked.code, checked.reason);
      const next = start + input.limit < all.length
        ? JSON.stringify({ v: 1, anchorKey, limit: input.limit, after: page[page.length - 1]!.noteId })
        : null;
      const pointer = await pointerOf(ctx.projectId, input.anchor);
      if (!pointer.ok) return rejected(pointer.code, pointer.reason);
      const result: NotePageV1 = { items: checked.value.items, next, complete: next === null, pointer: pointer.value };
      return { status: 'ready', value: result };
    },

    async memoryLookup(ctx, input) {
      const built = await lookupRead(ctx, input, undefined);
      if (built.status !== 'ready') return built;
      return { status: 'ready', value: built.value.result };
    },

    async listNotes(ctx, request) {
      const limit = resolveMemoryLimit(request.limit);
      if (!('anchor' in request)) {
        // §11.3: the explicit state override returns exactly that state; the
        // runtime check also answers any other (untyped) filter combination.
        const state = request.state;
        if (state !== 'pending_review' && state !== 'accepted' && state !== 'reviewed') {
          return rejected('invalid', 'notes_list_filter_unsupported');
        }
        return goalBucketRead(ctx, request.goalId, state, limit, request.cursor);
      }
      const built = await lookupRead(ctx, { v: 1, op: 'lookup', anchor: request.anchor, limit,
        cursor: request.cursor }, request.state);
      if (built.status !== 'ready') return built;
      const { result, heads } = built.value;
      const value: NoteListResultV1 = {
        items: result.items.map((item, index) => ({ ...item, label: renderNoteHeader(heads[index]!) })),
        next: result.next, complete: result.complete, readBasis: result.readBasis, warnings: result.warnings,
        coverage: result.coverage, understanding: result.understanding };
      return { status: 'ready', value };
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
      // F4: every version this history read is kept so the check never reads it
      // again (non-head page versions use the snapshot directly).
      const versionSnapshots = new Map<number, NoteVersionSnapshot>();
      // S2.8: compute the first confirming version ONCE, lazily, at the first
      // version that needs it, scanning ascending up to the largest version
      // listed on this page. `confirmed(v)` is then a comparison, not a fresh
      // 1..v scan per listed version.
      let firstConfirming: number | null | undefined;
      const confirmedFor = async (version: number): Promise<ReadOutcome<boolean>> => {
        if (version === headVersion) return { ok: true, value: head.value!.confirmedByUser };
        if (firstConfirming === undefined) {
          let found: number | null = null;
          const maxListed = pageVersions[0]!;
          for (let u = 1; u <= maxListed; u += 1) {
            const read = await readVersionRecord(deps.records, ctx.projectId, input.noteId, u);
            if (!read.ok) return read;
            if (read.value === null) {
              return { ok: false, code: 'unavailable', reason: 'a note version needed to confirm the note cannot be read' };
            }
            versionSnapshots.set(u, read.value);
            if (read.value.change.by.kind === 'user' && CONFIRMING_CHANGE_KINDS.includes(read.value.change.kind)) {
              found = u;
              break;
            }
          }
          firstConfirming = found;
        }
        return { ok: true, value: firstConfirming !== null && firstConfirming <= version };
      };
      for (const version of pageVersions) {
        const read = await readVersionRecord(deps.records, ctx.projectId, input.noteId, version);
        if (!read.ok) return rejected(read.code, read.reason);
        if (read.value === null) return rejected('unavailable', 'a note version is missing');
        versionSnapshots.set(version, read.value);
        const confirmed = await confirmedFor(version);
        if (!confirmed.ok) return rejected(confirmed.code, confirmed.reason);
        base.push({ ...itemOfVersion(read.value, confirmed.value),
          change: read.value.change, since: read.value.since });
      }
      // F4: hand the head and every version snapshot this read holds to the check.
      const checked = await withCheck(ctx, base, new Map([[input.noteId, headVersion]]),
        new Map([[input.noteId, head.value]]), undefined, versionSnapshots);
      if (!checked.ok) return rejected(checked.code, checked.reason);
      const historyGoalId = currentGoalIdOf(ctx);
      let items = checked.value.items.map(item => ({ ...item, crossGoal: crossGoalOf(item, historyGoalId) }));
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
      // F4: every anchor read below is also seeded into the check's cache.
      const anchorSets = new Map<string, NoteHeadSnapshot[]>();
      if (input.noteId !== undefined) {
        const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
        if (!head.ok) return rejected(head.code, head.reason);
        if (head.value === null) return { status: 'not_found' };
        seen.set(head.value.noteId, head.value);
        for (const key of anchorSlots(head.value)) {
          const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          anchorSets.set(`${ctx.projectId}\u0000${key}`, heads.value);
          for (const candidate of heads.value) seen.set(candidate.noteId, candidate);
        }
      } else {
        const anchorKey = anchorKeyOf(input.anchor!);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorSets.set(`${ctx.projectId}\u0000${anchorKey}`, heads.value);
        for (const candidate of heads.value) {
          if (anchorSlots(candidate).includes(anchorKey)) seen.set(candidate.noteId, candidate);
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
      // §11.3 (b11): keep the candidate set and slicing, but derive `conflicting`
      // first, with the call's seeded HeadCache and the S2.6 memo; only the
      // conflicting candidates go to the check, with `conflicting` handed over so
      // it does not recompute. A derivation read failure still fails the call.
      const currentGoalId = currentGoalIdOf(ctx);
      const deriveCache = newHeadCache();
      for (const [key, heads] of anchorSets) {
        deriveCache.anchors.set(key, { ok: true, value: heads });
      }
      const deriveMemo = new Map<string, boolean>();
      const conflictingByNote = new Map<string, boolean>();
      const conflictingHeads: NoteHeadSnapshot[] = [];
      for (const head of slice.page) {
        const key = `${head.noteId}@${String(head.version)}`;
        let conflicting = deriveMemo.get(key);
        if (conflicting === undefined) {
          const computed = await conflictingOf(ctx.projectId, head, deriveCache);
          if (!computed.ok) return rejected(computed.code, computed.reason);
          conflicting = computed.value;
          deriveMemo.set(key, conflicting);
        }
        if (conflicting) {
          conflictingHeads.push(head);
          conflictingByNote.set(head.noteId, true);
        }
      }
      const pageBuilt = await checkedPage(ctx, conflictingHeads, currentGoalId, anchorSets, conflictingByNote);
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const items = pageBuilt.value.items;
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'conflicts', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, items), items, warnings: [],
        next, complete: next === null, coverage: coverageOf(pageBuilt.value.items) };
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
        anchorsOfSubject = anchorSlots(head.value);
      }
      const seen = new Map<string, NoteHeadSnapshot>();
      // F4: seed every anchor read below into the check's cache.
      const anchorSets = new Map<string, NoteHeadSnapshot[]>();
      for (const reference of references) {
        if (reference === input.noteId) continue;
        const target = await readHeadRecord(deps.records, ctx.projectId, reference);
        if (!target.ok) return rejected(target.code, target.reason);
        if (target.value !== null) seen.set(target.value.noteId, target.value);
      }
      for (const key of anchorsOfSubject) {
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorSets.set(`${ctx.projectId}\u0000${key}`, heads.value);
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
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx), anchorSets);
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'neighbors', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, pageBuilt.value.items),
        items: pageBuilt.value.items, warnings: [], next, complete: next === null,
        coverage: coverageOf(pageBuilt.value.items) };
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
      // F4: only the anchor routes seed the check's cache; the goal route reads
      // a narrower status set and must not seed the all-states goal map.
      const anchorSets = new Map<string, NoteHeadSnapshot[]>();
      if (input.goalId !== undefined && input.anchor !== undefined) {
        // R6/MF6b: both fields apply (AND). Candidates come from the anchor
        // indexes, then the goal and the accepted/reviewed state are required.
        const anchorKey = anchorKeyOf(input.anchor);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorSets.set(`${ctx.projectId}\u0000${anchorKey}`, heads.value);
        candidates = heads.value.filter(head => anchorSlots(head).includes(anchorKey)
          && head.goalId === input.goalId && (head.state === 'accepted' || head.state === 'reviewed'));
      } else if (input.goalId !== undefined) {
        const heads = await headsOnReviewStatus(ctx.projectId, input.goalId, ['accepted', 'reviewed']);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        candidates = heads.value;
      } else {
        const anchorKey = anchorKeyOf(input.anchor!);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, anchorKey);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorSets.set(`${ctx.projectId}\u0000${anchorKey}`, heads.value);
        // R6: anchor-scoped stale covers accepted and reviewed, like the goal route.
        candidates = heads.value.filter(head => anchorSlots(head).includes(anchorKey)
          && (head.state === 'accepted' || head.state === 'reviewed'));
      }
      const ordered = [...candidates].sort((left, right) => compareText(left.noteId, right.noteId));
      const slice = sliceByCursor(ordered, cursor.value.after, limit);
      if (!slice.ok) return rejected(slice.code, slice.reason);
      const pageBuilt = await checkedPage(ctx, slice.page, currentGoalIdOf(ctx), anchorSets);
      if (!pageBuilt.ok) return rejected(pageBuilt.code, pageBuilt.reason);
      // §11.3: the unreachable `item.invalid` test is gone — only a staged
      // repair can be invalid, and `stale` never reads staged candidates.
      const items = pageBuilt.value.items.filter(item => item.freshness !== 'fresh' || item.sourceUnavailable
        || item.unresolvedFacts.length > 0 || item.anchorStatus === 'retired');
      const next = slice.complete ? null : encodeMemoryCursor(ctx, 'stale', request,
        { after: slice.last, recordCursor: current.value });
      const result: MemoryResultV1 = { readBasis: basisOf(current.value, items), items, warnings: [],
        next, complete: next === null, coverage: coverageOf(pageBuilt.value.items) };
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
      // §11.2 shape: `related` is the strict G-02 union; with an anchor or a
      // pathPrefix it is `invalid` / `related_with_scope` (already scoped).
      const relatedInput = input.related;
      if (relatedInput !== undefined && relatedInput !== null) {
        const problem = relatedShapeProblem(relatedInput);
        if (problem !== null) return rejected('invalid', problem);
      }
      if (relatedInput !== undefined && relatedInput !== null && (input.anchor !== undefined || pathPrefix !== null)) {
        return rejected('invalid', 'related_with_scope');
      }
      const scopeInput: MemoryFindRequest = pathPrefix === null ? input : { ...input, pathPrefix };
      const relatedMarker = relatedInput === undefined ? 'auto' : relatedInput;
      const request = { op: 'find', terms: rawTerms, match, anchor: input.anchor ?? null,
        pathPrefix, kind: input.kind ?? null, topic: input.topic ?? null,
        state: input.state ?? null, limit, related: relatedMarker };
      const cursor = parseMemoryCursor(ctx, input.cursor, 'find', request);
      if (!cursor.ok) return rejected(cursor.code, cursor.reason);
      const current = await ledgerCursor();
      if (!current.ok) return rejected(current.code, current.reason);
      if (cursor.value.recordCursor !== null && current.value !== cursor.value.recordCursor) {
        return rejected('revision_conflict', 'the record cursor moved since the first page');
      }
      // §11.2 check order: shape -> cursor -> ledger cursor -> the resolution
      // table -> read. The resolved node is bound into the cursor; a changed
      // `related` is `cursor_mismatch` before any resolution read.
      // One per-call map of the plan windows the related-scope
      // resolution reads, handed to the page's `checkHeads` so each goal's
      // window is read once per call.
      const relatedPlans = new Map<string, PlanRevisionSnapshot | null>();
      let scope: RelatedScope | null = null;
      if (relatedInput !== undefined && relatedInput !== null) {
        const resolved = await resolveRelatedScope(ctx, relatedDeps, relatedInput, relatedPlans);
        if (!resolved.ok) return rejected(resolved.code, resolved.reason);
        scope = resolved.value;
      } else if (relatedInput === undefined && input.anchor === undefined && pathPrefix === null) {
        // §11.2: with an anchor or a pathPrefix the find is already scoped and
        // never segments; only an unscoped call defaults to `caller_task`.
        const resolved = await resolveRelatedScope(ctx, relatedDeps, 'auto', relatedPlans);
        if (!resolved.ok) return rejected(resolved.code, resolved.reason);
        scope = resolved.value;
      }
      if (cursor.value.resolved !== null
        && JSON.stringify(scope?.node ?? null) !== JSON.stringify(cursor.value.resolved)) {
        return rejected('invalid', 'cursor_mismatch');
      }
      if (scope !== null) {
        const built = await segmentedCandidates(ctx, scopeInput, scope, rawTerms, match, limit, cursor.value, request,
          current.value);
        if (!built.ok) return rejected(built.code, built.reason);
        const finished = await finishFind(ctx, request, current.value, { entries: built.value.entries,
          next: built.value.next, scores: built.value.scores, ranking: built.value.ranking,
          warnings: built.value.warnings, isAll, firstPage: input.cursor === null, scope,
          seg1Exhausted: built.value.seg1Exhausted, seg1Placed: built.value.seg1Placed,
          anchorSets: built.value.anchorSets, planWindows: relatedPlans });
        if (!finished.ok) return rejected(finished.code, finished.reason);
        return { status: 'ready', value: finished.value };
      }
      const currentGoalId = currentGoalIdOf(ctx);
      let scores = new Map<string, { matchedTerms: string[]; score: number }>();
      let ranking: 'full' | 'partial' = 'full';
      const warnings: string[] = [];

      // R9/MF9: an anchor is checked independently of the term matches; one
      // anchor-index read serves both the existence answer and the anchor-only
      // candidate source.
      let anchorOnAnchor: NoteHeadSnapshot[] | null = null;
      // S2.3: the exact anchor set this read already loaded, handed to the check
      // so it never re-reads it (keyed exactly as the check's head cache keys).
      const anchorSets = new Map<string, NoteHeadSnapshot[]>();
      if (input.anchor !== undefined) {
        const key = anchorKeyOf(input.anchor);
        const heads = await headsByAnchorKey(deps.records, ctx.projectId, key);
        if (!heads.ok) return rejected(heads.code, heads.reason);
        anchorSets.set(`${ctx.projectId}\u0000${key}`, heads.value);
        anchorOnAnchor = heads.value.filter(head => anchorSlots(head).includes(key));
        if (anchorOnAnchor.length === 0) {
          const exists = await anchorExistsNow(ctx, input.anchor);
          if (!exists.ok) return rejected(exists.code, exists.reason);
          if (!exists.exists) return anchorNotFound(exists.anchorCandidates, exists.candidatesUnavailable);
        }
      }

      // S2.1: validate every term once, after the anchor existence check, with
      // the one shared per-term rule (S1.10).
      let terms: string[] | null = null;
      // F2: matching uses `terms` (the second-pass port form); ranking and
      // `matchedTerms` use `rankTerms` (the first-pass 4B form).
      let rankTerms: string[] = [];
      if (rawTerms !== null) {
        const decoded = normalizeTerms(rawTerms);
        if (!decoded.ok) return rejected('invalid', decoded.reason);
        terms = decoded.match;
        rankTerms = decoded.rank;
      }
      const scoped = terms !== null && (input.anchor !== undefined || pathPrefix !== null);
      // The scoped candidate source, reused by both match modes.
      const scopedSource = async (): Promise<ReadOutcome<NoteHeadSnapshot[]>> => {
        if (input.anchor !== undefined) return { ok: true, value: anchorOnAnchor! };
        const heads = await headsOnPathPrefix(ctx.projectId, pathPrefix!);
        return heads;
      };

      let pageHeads: NoteHeadSnapshot[];
      let next: string | null;
      if (terms !== null && match === 'all') {
        // The `'all'` cursor carries the last matched NoteHead refKey on both the
        // scoped and the port path.
        if (scoped) {
          // S2.1: no port call; filter the anchor/prefix heads, order by refKey
          // and take the first `limit` after the cursor's refKey.
          // Accepted change (decision 66): on this path `index_not_ready` and
          // text-port store failures cannot surface; a damaged head under the
          // prefix, or a failing `lookupOrdered`, is `unavailable`.
          // F3: the scoped `'all'` path bypasses the port, so
          // the port's continuation-key rule is applied here, after the term
          // validation and before the prefix heads are read. A canonical key
          // that names no record is still a valid position.
          if (cursor.value.after !== null) {
            const decodedAfter = decodeTextSearchAfter(cursor.value.after, 'NoteHead');
            if (decodedAfter.status === 'invalid') return rejected('invalid', decodedAfter.reason);
          }
          const source = await scopedSource();
          if (!source.ok) return rejected(source.code, source.reason);
          const matched = scopedMatches(ctx.projectId, scopeInput, currentGoalId, source.value, terms, 'all');
          const after = cursor.value.after;
          let start = 0;
          if (after !== null) {
            start = matched.length;
            for (let position = 0; position < matched.length; position += 1) {
              if (compareRefKeysFast(matched[position]!.refKey, after) > 0) { start = position; break; }
            }
          }
          const page = matched.slice(start, start + limit);
          pageHeads = page.map(entry => entry.head);
          next = start + limit < matched.length
            ? encodeMemoryCursor(ctx, 'find', request,
              { after: page[page.length - 1]!.refKey, recordCursor: current.value })
            : null;
          scores = rankAll(pageHeads, rankTerms);
        } else {
          const heads = await allTermHeads(ctx, scopeInput, terms, limit, cursor.value.after);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          pageHeads = heads.value.items;
          scores = rankAll(pageHeads, rankTerms);
          next = heads.value.next === null ? null
            : encodeMemoryCursor(ctx, 'find', request, { after: heads.value.next, recordCursor: current.value });
        }
      } else {
        let ordered: NoteHeadSnapshot[];
        if (terms !== null) {
          if (scoped) {
            // S2.1 `'any'`: the first `cap` in refKey byte order, then today's
            // ranking; `cap+1` in-scope matches is `partial`.
            const source = await scopedSource();
            if (!source.ok) return rejected(source.code, source.reason);
            const matched = scopedMatches(ctx.projectId, scopeInput, currentGoalId, source.value, terms, 'any');
            const partial = matched.length > textSearchCandidateMax;
            const candidateHeads = (partial ? matched.slice(0, textSearchCandidateMax) : matched).map(entry => entry.head);
            const ranked = rankMatches(candidateHeads, rankTerms);
            ranking = partial ? 'partial' : 'full';
            if (partial) warnings.push('匹配集合超过候选上限；请按锚点、路径前缀、种类或加词缩小范围');
            for (const entry of ranked.ranked) {
              scores.set(entry.head.noteId, { matchedTerms: entry.matchedTerms, score: entry.score });
            }
            ordered = ranked.ranked.map(entry => entry.head);
          } else {
            const heads = await anyTermHeads(ctx, scopeInput, terms);
            if (!heads.ok) return rejected(heads.code, heads.reason);
            const ranked = rankMatches(heads.value.items, rankTerms);
            ranking = heads.value.partial ? 'partial' : 'full';
            if (heads.value.partial) warnings.push('匹配集合超过候选上限；请按锚点、路径前缀、种类或加词缩小范围');
            for (const entry of ranked.ranked) {
              scores.set(entry.head.noteId, { matchedTerms: entry.matchedTerms, score: entry.score });
            }
            ordered = ranked.ranked.map(entry => entry.head);
          }
        } else if (input.anchor !== undefined) {
          ordered = anchorOnAnchor!.filter(head => headInScope(head, scopeInput, currentGoalId));
        } else if (pathPrefix !== null) {
          const heads = await headsOnPathPrefix(ctx.projectId, pathPrefix);
          if (!heads.ok) return rejected(heads.code, heads.reason);
          ordered = heads.value.filter(head => headInScope(head, scopeInput, currentGoalId));
        } else {
          const goalIds = await projectGoalIds(ctx);
          if (!goalIds.ok) return rejected(goalIds.code, goalIds.reason);
          const union = new Map<string, NoteHeadSnapshot>();
          for (const goalId of [null, ...goalIds.value] as (string | null)[]) {
            // §11.3: read only the visible states. A work Run gets accepted +
            // reviewed for every slot and pending_review for its own slot only;
            // the host and query Runs get pending_review for every slot. An
            // explicit `state` reads exactly that one bucket. These narrower
            // reads never seed `HeadCache.goals`.
            const states = input.state !== undefined ? [input.state]
              : visibleStatusStates(goalId, currentGoalId);
            const heads = await headsOnReviewStatus(ctx.projectId, goalId, states);
            if (!heads.ok) return rejected(heads.code, heads.reason);
            for (const head of heads.value) union.set(head.noteId, head);
          }
          ordered = [...union.values()].filter(head => headInScope(head, scopeInput, currentGoalId));
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
      const finished = await finishFind(ctx, request, current.value, {
        entries: pageHeads.map(head => ({ head, segment: null })), next, scores,
        ranking: isAll ? undefined : ranking, warnings, isAll, firstPage: input.cursor === null, scope: null,
        seg1Exhausted: true, seg1Placed: 0, anchorSets });
      if (!finished.ok) return rejected(finished.code, finished.reason);
      return { status: 'ready', value: finished.value };
    },

    readMemoryMaterial,
  };
}
