/**
 * The one value that decides whether a Query round may write notes: preparation freezes it, the start re-check reads
 * the same frozen value, and the declaration and tool group follow it. `none` means no note tool and no note
 * declaration. Its one declaration and the pure rule `secretaryNoteAdmission` are in `state/secretary-note.ts`.
 */
export type { QueryNoteAdmissionV1 } from '../state/secretary-note.js';
