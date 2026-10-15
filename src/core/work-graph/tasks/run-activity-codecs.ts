/**
 * Slice 2B §6 path: the `RunActivity`/`ActivityRecording` record, event and
 * ordered-index codecs.
 *
 * Architecture (integration fix): the canonical implementation lives in
 * `persistence/run-activity-codecs.ts` because `persistence/execution-entry-codecs.ts`
 * folds the registration group into `EXECUTION_ENTRY_RECORD_SCHEMAS` and the
 * boundary checker forbids the `persistence -> tasks` edge. This file keeps the
 * spec §6 import path used by the task services and the views.
 */
export * from '../persistence/run-activity-codecs.js';
