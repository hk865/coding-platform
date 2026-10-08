/**
 * A1 Session lifecycle contracts.
 *
 * The user's Agent working entity is expressed with the EXISTING SessionRecord
 * plus its RoleConfigurationRef. There is no permanent Agent table, no second
 * member directory and no new module: link/archive/reactivate maintain the
 * records the Session directory already owns.
 *
 * `busy`/`idle` remain derived from occupancy/health/lifecycle; this port never
 * stores a `working`/`standby` copy. A module association is a discovery
 * relation, not a permission, lock or long-term expert proof.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { ArchiveStepRefV1, RequestSessionArchiveInput } from '../../../contracts/core/session-archive.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionFactsPort } from '../model/session-facts-contracts.js';
import type { GraphWrite } from '../model/session-contracts.js';

/** The existing Session directory stores; this service adds no store of its own. */
export type SessionLifecycleStores = {
  records: GoalRecordTransactionPort;
  lookups: RecordLookupPort;
  /** Slice 1 §3.3: injected by the composition root; absent leaves the new archive entries unsupported. */
  sessionFacts?: SessionFactsPort;
};

export type LinkSessionWorkInput = {
  sessionRef: SessionRef;
  target: WorkLinkTarget;
  relation: WorkLinkRelation;
  /** `true` opens a new effective interval; `false` closes the effective link by
   * setting `until` while keeping `since`. Closing an already-closed link or an
   * nonexistent link is a typed failure, not a silent no-op. A formerly valid
   * target may be absent now: closing its existing link remains allowed. */
  active: boolean;
};

export type ArchiveSessionInput = {
  sessionRef: SessionRef;
  reason: string;
};

export type ReactivateSessionInput = {
  sessionRef: SessionRef;
  reason: string;
};

/**
 * Independent SessionLifecyclePort. The composition root merges this with the
 * existing session directory; this does not change
 * `SessionDirectoryPort` required methods (which would break narrow real
 * consumers).
 */
export interface SessionLifecyclePort {
  linkSessionWork(
    ctx: CoreCallContext,
    request: GraphWrite<LinkSessionWorkInput>,
  ): Promise<WriteResult<SessionWorkLink>>;
  archiveSession(
    ctx: CoreCallContext,
    request: GraphWrite<ArchiveSessionInput>,
  ): Promise<WriteResult<SessionRecord>>;
  reactivateSession(
    ctx: CoreCallContext,
    request: GraphWrite<ReactivateSessionInput>,
  ): Promise<WriteResult<SessionRecord>>;
  /** Slice 1 §3.3: request the durable archive of a Session. */
  requestSessionArchive(
    ctx: CoreCallContext,
    request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<WriteResult<SessionRecord>>;
  /** Slice 1 §2.3: the original receipt of a request, by the same stable identity. */
  readSessionArchiveRequestReceipt(
    ctx: CoreCallContext,
    request: GraphWrite<RequestSessionArchiveInput>,
  ): Promise<ReadResult<{ session: SessionRecord; cursor: CommitCursor }>>;
  /** Slice 1 §3.3: one internal archive step (stop/anchor/requeue/responsibility/reply_handler/wait_cancel/archive). */
  finishSessionArchive(
    ctx: CoreCallContext,
    step: ArchiveStepRefV1,
  ): Promise<WriteResult<SessionRecord>>;
  /** Slice 1 §3.3: explicitly release a pending archive request after a failed disposal. */
  releaseSessionArchiveRequest(
    ctx: CoreCallContext,
    request: GraphWrite<{ sessionRef: SessionRef; archiveRequestId: string; reason: string }>,
  ): Promise<WriteResult<SessionRecord>>;
}
