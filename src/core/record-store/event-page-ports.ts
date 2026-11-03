/**
 * The one ordered event page. A separate narrow port on the store object
 * beside `records` (the `RecordCommitIdentityPort` shape), never a sixth
 * member of `GoalRecordTransactionPort`: callers read the store's one event
 * store in commit order and never scan it from the beginning to locate one row.
 */
import type { CommitCursor } from "../../contracts/command-event.js";
import type { EncodedDomainEvent, StoreResult } from "./ports.js";

export interface RecordEventPagePort {
  eventPage(input: { after: CommitCursor | null; limit: number }): Promise<StoreResult<{
    events: { cursor: CommitCursor; event: EncodedDomainEvent }[];
    next: CommitCursor | null;
  }>>;
}
