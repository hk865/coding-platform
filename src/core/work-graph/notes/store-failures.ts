import { okFalse, rejected } from '../../../contracts/core/rejections.js';

/** The note-port failure codes a store/record read can produce (all in NoteErrorCode). */
export type MappedReadCode = 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

export type MappedStoreFailure = { status: 'rejected'; code: MappedReadCode; reason: string };

/** The one store-failure mapping shared by the note reads and the writer. */
export function mapStoreFailure(failure: { code: string; reason: string }): MappedStoreFailure {
  switch (failure.code) {
    case 'revision_conflict': return rejected('revision_conflict', failure.reason);
    case 'invalid': return rejected('invalid', failure.reason);
    case 'not_found': return rejected('not_found', failure.reason);
    default: return rejected('unavailable', failure.reason);
  }
}

export function asOutcome(failure: { code: string; reason: string }): { ok: false; code: MappedReadCode; reason: string } {
  const mapped = mapStoreFailure(failure);
  return okFalse(mapped.code, mapped.reason);
}
