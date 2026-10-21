/**
 * The base note readers: paging one lookup index to the end, plus the failure
 * and outcome shapes the note read model, writer and scribe scope share. This
 * module depends on neither the read model nor the writer.
 */
import type { NoteHeadSnapshot } from '../../../contracts/note.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { decodeNoteHeadSnapshot } from '../persistence/note-record-codecs.js';
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
