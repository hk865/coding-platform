import type { EncodedRecord, StoreResult } from './ports.js';
import type { CommitCursor } from '../../contracts/command-event.js';

/** Trusted schema registration. Paths are dotted JSON object keys, never SQL. */
export type RecordLookupIndex = {
  readonly name: string;
  readonly aggregateType: string;
  readonly paths: readonly string[];
};
export type LookupValue = string | number | boolean | null;
export type RecordLookupRequest = {
  index: string;
  values: readonly LookupValue[];
  /** Exclusive full canonical record key; values/index must remain the same. */
  after?: string;
  limit: number;
};
export type RecordLookupPage = {
  records: EncodedRecord[];
  next: string | null;
  readThrough: CommitCursor | null;
};
/** Candidate index only. WorkGraph rechecks canonical records and domain rules. */
export interface RecordLookupPort {
  lookup(request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>>;
}
