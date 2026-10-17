/**
 * Slice 4C-2 rework item 4 (Codex 4): the ONE internal batched pointer/head
 * reader the read model, the scribe to-dos and the update-due reader share.
 *
 * It imports only the record-store codecs (never another notes module), so it
 * adds no cycle. Semantics are explicit per caller:
 * - every anchor gets a pointer entry, a missing pointer is
 *   `{ noteId: null, revision: null }`;
 * - a missing pointed head is simply absent, unless `requireHeads` is set (the
 *   scribe to-dos' current-pointer heads fail on a missing or damaged head);
 * - an undecodable pointer/head is always a failure, never an empty answer.
 */
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import {
  currentPointerRefKey, decodeCurrentPointerSnapshot, decodeNoteHeadSnapshot, noteHeadRefKey,
} from '../persistence/note-record-codecs.js';

export type BatchPointerV1 = { noteId: string | null; revision: number | null };

export type BatchFailure = { ok: false; code: string; reason: string };

export type PointerBatchOutcome = { ok: true; value: Map<string, BatchPointerV1> } | BatchFailure;

export type HeadBatchOutcome = { ok: true; value: Map<string, NoteHeadSnapshot> } | BatchFailure;

export type PointerHeadBatchOutcome = {
  ok: true;
  value: { pointers: Map<string, BatchPointerV1>; heads: Map<string, NoteHeadSnapshot> };
} | BatchFailure;

/** ONE batched pointer read; a missing pointer is `{ noteId: null, revision: null }`. */
export async function readPointerBatch(records: GoalRecordTransactionPort, projectId: string,
  anchorKeys: readonly string[]): Promise<PointerBatchOutcome> {
  const unique = [...anchorKeys];
  const pointers = new Map<string, BatchPointerV1>();
  if (unique.length === 0) return { ok: true, value: pointers };
  const refKeys = unique.map(anchorKey =>
    currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId, anchorKey }));
  const read = await records.readMany(refKeys);
  if (read.status !== 'ready') return { ok: false, code: read.code, reason: read.reason };
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  for (let index = 0; index < unique.length; index += 1) {
    const anchorKey = unique[index]!;
    const record = byKey.get(refKeys[index]!);
    if (record === undefined) {
      pointers.set(anchorKey, { noteId: null, revision: null });
      continue;
    }
    const decoded = decodeCurrentPointerSnapshot(record);
    if (decoded.status !== 'decoded') return { ok: false, code: 'unavailable', reason: 'damaged current pointer' };
    pointers.set(anchorKey, { noteId: decoded.value.noteId, revision: decoded.value.revision });
  }
  return { ok: true, value: pointers };
}

/**
 * ONE batched head read of arbitrary note ids. A missing head is absent unless
 * `requireAll` is set; an undecodable head always fails.
 */
export async function readHeadBatch(records: GoalRecordTransactionPort, projectId: string,
  noteIds: readonly string[], options: { requireAll?: boolean } = {}): Promise<HeadBatchOutcome> {
  const unique = [...new Set(noteIds)];
  const heads = new Map<string, NoteHeadSnapshot>();
  if (unique.length === 0) return { ok: true, value: heads };
  const refKeys = unique.map(noteId => noteHeadRefKey({ aggregateType: 'NoteHead', projectId, noteId }));
  const read = await records.readMany(refKeys);
  if (read.status !== 'ready') return { ok: false, code: read.code, reason: read.reason };
  const byKey = new Map(read.value.records.map(record => [record.refKey, record]));
  for (let index = 0; index < unique.length; index += 1) {
    const noteId = unique[index]!;
    const record = byKey.get(refKeys[index]!);
    if (record === undefined) {
      if (options.requireAll === true) {
        return { ok: false, code: 'unavailable', reason: `the note head ${noteId} cannot be read` };
      }
      continue;
    }
    const decoded = decodeNoteHeadSnapshot(record);
    if (decoded.status !== 'decoded') {
      return { ok: false, code: 'unavailable', reason: options.requireAll === true
        ? `the note head ${noteId} is damaged: ${decoded.reason}` : 'damaged note head' };
    }
    heads.set(noteId, decoded.value);
  }
  return { ok: true, value: heads };
}

/**
 * ONE pointer batch and ONE pointed-head batch over the same anchors. This is
 * the single function the three callers use for their anchor snapshots.
 */
export async function readPointerAndHeadBatch(records: GoalRecordTransactionPort, projectId: string,
  anchorKeys: readonly string[], options: { requireHeads?: boolean } = {}): Promise<PointerHeadBatchOutcome> {
  const pointers = await readPointerBatch(records, projectId, anchorKeys);
  if (!pointers.ok) return pointers;
  const noteIds = new Set<string>();
  for (const pointer of pointers.value.values()) {
    if (pointer.noteId !== null) noteIds.add(pointer.noteId);
  }
  const heads = await readHeadBatch(records, projectId, [...noteIds], { requireAll: options.requireHeads === true });
  if (!heads.ok) return heads;
  return { ok: true, value: { pointers: pointers.value, heads: heads.value } };
}
