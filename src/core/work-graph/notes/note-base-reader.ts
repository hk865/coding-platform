/**
 * The base note readers: paging one lookup index to the end, plus the failure
 * and outcome shapes the note read model, writer and scribe scope share. This
 * module depends on neither the read model nor the writer.
 */
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { decodeNoteHeadSnapshot, S4_NOTE_BY_ANCHOR_LOOKUPS } from '../persistence/note-record-codecs.js';
import type { KnowledgeRead } from '../architecture/catalog-service.js';
import { isKnowledgeAnchor } from './note-file.js';
import { indexedNotes, isKnowledgeAnchorKey, type HeadlessNote } from './note-knowledge.js';
import { asOutcome } from './store-failures.js';

/** The note-port failure codes a store/record read can produce (all in NoteErrorCode). */
export type ReadFailureCode = 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

export type ReadOutcome<T> = { ok: true; value: T } | { ok: false; code: ReadFailureCode; reason: string };

/**
 * Page one lookup index to completion (`next` to the end). Any page that is not
 * `ready` is returned as the mapped store failure; a partial set is never handed
 * back.
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

/** Every note head on one index, or the failure; an undecodable head is `unavailable`. */
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

/**
 * Every note that carries `anchorKey` in one of the five anchor slots, deduped
 * by noteId. The whole index is read through `readAllHeads`, so a failed or
 * damaged page is returned, never skipped into a partial set. KLS-2b: a note
 * whose primary anchor is a module, interface or file is found through the
 * knowledge index of every line and read from its file (the record keeps its
 * runtime state); the record lookup answers only the other notes, and the
 * filed heads it listed are not read again. A filed note with no record head
 * is `headless` ([2B-16]).
 */
export async function notesByAnchorKey(records: RecordLookupPort, knowledge: KnowledgeRead,
  anchorKey: string): Promise<ReadOutcome<{ heads: NoteHeadSnapshot[]; headless: HeadlessNote[] }>> {
  const seen = new Map<string, NoteHeadSnapshot>();
  const filedHeads = new Map<string, NoteHeadSnapshot>();
  for (const index of S4_NOTE_BY_ANCHOR_LOOKUPS) {
    const page = await readAllHeads(records, index, [knowledge.caller.projectId, anchorKey]);
    if (!page.ok) return page;
    for (const head of page.heads) {
      if (isKnowledgeAnchor(head.anchor)) { filedHeads.set(head.noteId, head); continue; }
      if (head.anchorKey0 === anchorKey || head.anchorKey1 === anchorKey || head.anchorKey2 === anchorKey
        || head.anchorKey3 === anchorKey || head.anchorKey4 === anchorKey) seen.set(head.noteId, head);
    }
  }
  if (!isKnowledgeAnchorKey(anchorKey)) return { ok: true, value: { heads: [...seen.values()], headless: [] } };
  const filed = await indexedNotes(knowledge, (index, lineRef) => index.noteIdsByAnchor(lineRef, anchorKey), filedHeads);
  if (filed.status !== 'ready') return asOutcome(filed);
  for (const head of filed.value.heads) seen.set(head.noteId, head);
  return { ok: true, value: { heads: [...seen.values()], headless: filed.value.headless } };
}

/** `notesByAnchorKey` for the callers that need the state: the heads only. */
export async function headsByAnchorKey(records: RecordLookupPort, knowledge: KnowledgeRead,
  anchorKey: string): Promise<ReadOutcome<NoteHeadSnapshot[]>> {
  const notes = await notesByAnchorKey(records, knowledge, anchorKey);
  return notes.ok ? { ok: true, value: notes.value.heads } : notes;
}
