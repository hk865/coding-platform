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
import type { ReadResult, CoreRejection } from '../../../contracts/core/results.js';
import type { NoteAnchorV1, NoteDraftAnchorV1, NoteHeadSnapshot, NoteState, NoteVersionSnapshot } from '../../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../../contracts/note.js';
import type { GoalRecordTransactionPort, EncodedRecord } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { PlanTaskPort } from '../model/plan-contracts.js';
import type { NoteItemV1, NotePageV1, NoteReadPort } from '../model/note-contracts.js';
import { MEMORY_PAGE_MAX, NOTE_ANCHOR_QUOTA, NOTE_GOAL_QUOTA } from '../model/note-contracts.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { NoteAnchorWorkspace } from './note-anchors.js';
import {
  S4_NOTE_BY_ANCHOR_LOOKUPS, S4_NOTE_BY_REVIEW_STATUS_LOOKUP, currentPointerRefKey, decodeCurrentPointerSnapshot,
  decodeNoteHeadSnapshot, decodeNoteVersionSnapshot, noteHeadRefKey, noteVersionRefKey,
} from '../persistence/note-record-codecs.js';
import { anchorKeyOf, resolveNoteAnchors, type NoteAnchorFactsDeps } from './note-anchors.js';

export type NoteReadDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  plans: Pick<PlanTaskPort, 'queryGoal' | 'queryTaskGraph'>;
  architecture?: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  workspace?: NoteAnchorWorkspace;
  anchorQuota?: number;
  goalQuota?: number;
};

/** The note-port failure codes a store/record read can produce (all in NoteErrorCode). */
export type ReadFailureCode = 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

type ReadOutcome<T> = { ok: true; value: T } | { ok: false; code: ReadFailureCode; reason: string };
type ExistenceOutcome<T> = { ok: true; value: T } | { ok: false; code: ReadFailureCode | 'forbidden'; reason: string };

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
type HeadCache = {
  anchors: Map<string, ReadOutcome<NoteHeadSnapshot[]>>;
  goals: Map<string, ReadOutcome<NoteHeadSnapshot[]>>;
};

function newHeadCache(): HeadCache { return { anchors: new Map(), goals: new Map() }; }

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

export function createNoteReadModel(deps: NoteReadDependencies): NoteReadPort {
  const anchorQuota = deps.anchorQuota ?? NOTE_ANCHOR_QUOTA;
  const goalQuota = deps.goalQuota ?? NOTE_GOAL_QUOTA;
  const anchorFacts: NoteAnchorFactsDeps = { records: deps.records,
    ...(deps.architecture === undefined ? {} : { architecture: deps.architecture }),
    ...(deps.workspace === undefined ? {} : { workspace: deps.workspace }) };

  async function conflictingOf(projectId: string, head: { noteId: string; kind: NoteHeadSnapshot['kind'];
    state: NoteHeadSnapshot['state'];
    topicKey: string; contradicts: readonly string[]; replaces: readonly string[]; coexistWith: readonly string[];
    anchorKey0: string; anchorKey1: string | null; anchorKey2: string | null; anchorKey3: string | null; anchorKey4: string | null },
    cache: HeadCache): Promise<ReadOutcome<boolean>> {
    for (const other of head.contradicts) {
      const otherHead = await readHeadRecord(deps.records, projectId, other);
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
      const others = await cachedHeadsByAnchorKey(cache, deps.records, projectId, key);
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
        const heads = await cachedHeadsByAnchorKey(cache, deps.records, projectId, key);
        if (!heads.ok) return heads;
        const count = heads.value.filter(candidate => isGeneral(candidate.kind)
          && (candidate.state === 'accepted' || candidate.state === 'reviewed')).length;
        if (count > anchorQuota) return { ok: true, value: true };
      }
    }
    const goalCounted = head.state === 'accepted' || head.state === 'reviewed'
      || head.state === 'pending_review' || head.state === 'staged';
    if (head.goalId !== null && goalCounted) {
      const heads = await cachedCurrentHeadsForGoal(cache, deps.records, projectId, head.goalId);
      if (!heads.ok) return heads;
      if (heads.value.length > goalQuota) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }

  async function itemOfHead(head: NoteHeadSnapshot, projectId: string, cache: HeadCache): Promise<ReadOutcome<NoteItemV1>> {
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
    } };
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

  /** L2a class 2 (without candidates): is this anchor key backed by a real object now? */
  async function anchorExistsNow(ctx: CoreCallContext, anchor: NoteAnchorV1): Promise<ExistenceOutcome<boolean>> {
    const draft: NoteDraftAnchorV1 = anchor.kind === 'file'
      ? { kind: 'file', path: anchor.path, ...(anchor.deleted === true ? { deleted: true as const } : {}) }
      : anchor;
    const goalId = 'goalId' in anchor ? anchor.goalId : null;
    // Item 7: the same narrow anchor-facts reader as the writer, with no L11
    // basis reads (an existence check needs none).
    const resolved = await resolveNoteAnchors(ctx,
      { main: draft, extraAnchors: [], goalId, includeBasis: false }, anchorFacts);
    if (resolved.status === 'ok') return { ok: true, value: true };
    if (resolved.code === 'invalid' && resolved.reason === 'anchor_not_found') return { ok: true, value: false };
    return { ok: false, code: resolved.code, reason: resolved.reason };
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
        return { status: 'ready', value: itemOfVersion(version.value, confirmed.value) };
      }
      const head = await readHeadRecord(deps.records, ctx.projectId, input.noteId);
      if (!head.ok) return rejected(head.code, head.reason);
      if (head.value === null) return { status: 'not_found' };
      const item = await itemOfHead(head.value, ctx.projectId, newHeadCache());
      if (!item.ok) return rejected(item.code, item.reason);
      return { status: 'ready', value: item.value };
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
        if (!exists.value) return rejected('not_found', 'anchor_not_found');
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
      const next = start + input.limit < all.length
        ? JSON.stringify({ v: 1, anchorKey, limit: input.limit, after: page[page.length - 1]!.noteId })
        : null;
      const pointer = await pointerOf(ctx.projectId, input.anchor);
      if (!pointer.ok) return rejected(pointer.code, pointer.reason);
      const result: NotePageV1 = { items, next, complete: next === null, pointer: pointer.value };
      return { status: 'ready', value: result };
    },
  };
}
