/** R4b Session creation and directory boundary. Formal creation records and
 * directory links share one atomic Store commit; Kernel effects remain outside. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope, WorkLinkRelation, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRecord, SessionProvenanceV1, SessionWorkLink } from '../../../contracts/core/session.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { HandoffActionV1, SecretaryArchiveActionV1 } from './session-operation-arms.js';
import type { GraphWrite } from './task-contracts.js';

export type { GraphWrite } from './task-contracts.js';
export type SessionPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
export type SessionPage<T> = { items: T[]; nextCursor: string | null; sourceCursor: CommitCursor };
/**
 * Slice 6A §3.4.7: the line-creation intent of the first-phase admission.
 * `null` means the creation opens no line (every non-line creation).
 */
export type SessionCreationIntentV1 = {
  duty: PlatformDutyV1;
  scope: { kind: 'project' };
  reason: string;
  creator: ActorRef;
};
export type SessionCreationInput = {
  workspace: WorkspaceScope;
  /** Trusted Host route selected before admission and pinned by the first durable operation. */
  kernelStore: { adapterId: string; storeKey: string };
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
  /** Slice 1 §2.2: absent is equivalent to `{schemaVersion:1,kind:'new'}` for a new admission. */
  provenance?: SessionProvenanceV1;
  /** Slice 6A §3.4.7: absent or null is a creation that opens no line. */
  creation?: SessionCreationIntentV1 | null;
  /** The handoff operation a successor is created under; absent is null (as `provenance` and `creation`). */
  parentOperation?: OperationRef | null;
  /** §3.15 item 3: present only on a consultation copy; absent is null (as `provenance`/`creation`/`parentOperation`). */
  consultation?: ConsultationCreateV1 | null;
};
export type SessionCreateActionV1 = { kind: 'create'; plannedSessionRef: SessionRef; parentOperation: OperationRef | null }
  & Omit<SessionCreationInput, 'provenance' | 'creation' | 'parentOperation' | 'consultation'>
  & { provenance: SessionProvenanceV1; creation: SessionCreationIntentV1 | null;
      /** Required; `null` on every create that is not a consultation copy. */
      consultation: ConsultationCreateV1 | null };
/** §3.15 item 4 / §3.17 (B-14): one collected fact, frozen with its actual body, never a locator stand-in. */
export type ConsultationFactRefV1 =
  | { kind: 'task'; planRevision: PlanRevisionRef; taskId: string }
  /** No producer in 7B-3 (L25: no by-`eventId` read exists on this tree); the arm stays frozen for a later producer. */
  | { kind: 'event'; eventId: string; ref: VersionPin }
  /** One material body (a message's own `bodyRef`); preparation opens it with `MaterialPort.openArtifact`. */
  | { kind: 'body'; ref: ArtifactRef; sourceRef: VersionPin }
  /** One canonical record body frozen at collection: `body` is its exact text, `sourceRef` its immutable pin
   *  (for a source line record `ref` is its Session aggregate and `revision` the record's position). */
  | { kind: 'record'; sourceRef: VersionPin; body: string };
/** The three lists of §3.15 item 4; `platform_facts` writes this object with empty arrays when it has nothing (B3-04). */
export type ConsultationFactsV1 = {
  facts: ConsultationFactRefV1[];
  omitted: { section: 'records' | 'tasks' | 'messages'; count: number }[];
  unreadable: { fact: ConsultationFactRefV1 | null; reason: 'missing' | 'unreadable' }[];
};
/** The create arm's frozen payload (§3.15 item 3); kernel mode writes `facts: null` only. */
export type ConsultationCreateV1 = {
  messageRef: SessionMessageRef;
  mode: 'kernel' | 'platform_facts';
  facts: ConsultationFactsV1 | null;
  reason: string | null;
  /** §3.15 item 3: the kernel source and the completed boundary, frozen at the first admission; a retry reuses them.
   *  `boundary: null` is the confirmed unreadable/damaged boundary that chose `platform_facts`. */
  sourceRef: SessionRef;
  boundary: { cursor: string | null; position: number } | null;
};
/** The Q-facing read of the frozen create payload; Q's preparation branch calls it (§3.15 item 5). */
export interface ConsultationCreateReadPort {
  readConsultationCreate(ctx: CoreCallContext, input: { operationRef: OperationRef }):
    Promise<ReadResult<ConsultationCreateV1>>;
}
/** The three arms of a `CoreOperation` record; every reader judges `kind` first. */
export type SessionOperationActionV1 = SessionCreateActionV1 | HandoffActionV1 | SecretaryArchiveActionV1;
export type SessionOperationRecordOf<A extends SessionOperationActionV1> = {
  ref: OperationRef;
  revision: number;
  /** The operation's workspace: the create arm's `workspace`, the handoff's `input.workspace`, the archive's only one. */
  workspaceId: string;
  action: A;
  phase: 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';
  requestedAt: string;
  updatedAt: string;
  /** What the Kernel reported for a creation; `null` on every other arm. */
  observation: null | {
    observedAt: string; adapterId: string; kernelSessionId: string;
    beforeCursor: string | null; afterCursor: string | null;
    resultRef: ArtifactRef | null;
  };
  failure: null | { code: string; reason: string };
};
export type SessionOperationRecord = SessionOperationRecordOf<SessionOperationActionV1>;
export type SessionCreateOperationRecord = SessionOperationRecordOf<SessionCreateActionV1>;
export type SessionCreationResult = {
  operationRef: OperationRef;
  sessionRef: SessionRef;
  adapterId: string;
  kernelSessionId: string;
  historyCursor: string | null;
  observedAt: string;
};
export type SessionCard = {
  record: SessionRecord;
  availability: 'idle' | 'busy' | 'recoverable' | 'unavailable';
  links: SessionWorkLink[];
  recommendationReasons: string[];
};
export interface SessionDirectoryPort {
  admitSessionCreation(ctx: CoreCallContext, request: GraphWrite<SessionCreationInput>): Promise<WriteResult<SessionCreateOperationRecord>>;
  recordSessionCreated(ctx: CoreCallContext, request: GraphWrite<SessionCreationResult>): Promise<WriteResult<SessionRecord>>;
  getSessionOperation(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<SessionOperationRecord>>;
  readSession(ctx: CoreCallContext, ref: SessionRef): Promise<ReadResult<SessionCard>>;
  findSessions(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; target?: WorkLinkTarget; role?: RoleConfigurationRef;
    includeArchived: boolean; page: SessionPageRequest & { afterSessionKey?: string };
  }): Promise<ReadResult<SessionPage<SessionCard>>>;
}
