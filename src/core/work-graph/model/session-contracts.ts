/** R4b Session creation and directory boundary. Formal creation records and
 * directory links share one atomic Store commit; Kernel effects remain outside. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope, WorkLinkRelation, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRecord, SessionProvenanceV1, SessionWorkLink } from '../../../contracts/core/session.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { KnowledgeReadBaseV1 } from '../../../contracts/knowledge.js';
import type { RoleLineAllocationRef, RoleLineAllocationReportV1, RoleLineDutyV1, SessionRoleFactsV1 } from '../../../contracts/role-lines.js';
import type { HandoffActionV1, RoleLineActionV1, SecretaryArchiveActionV1 } from './session-operation-arms.js';
import type { MemberCreateActionV1 } from '../state/member-creation.js';
import type { MaintainerAssignmentActionV1 } from '../state/module-maintainer-assignment.js';
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
  scope: { kind: 'project' } | { kind: 'task'; task: TaskTriple };
  reason: string;
  creator: ActorRef;
  delegationCeiling?: { tools: string[]; writeScope: string[]; createMember: boolean };
  secretaryCreated?: true;
  /** L27: the only name writer; absent/null means no stored name. */
  name?: string | null;
  /**
   * KC-3 (Astra 2): a line a knowledge_conflict repair round opens checks its module links on the catalog the records
   * last adopted (`recorded`); absent is the current files, as every other creation.
   */
  base?: KnowledgeReadBaseV1;
};
/** The admission saves what it decided once, on the create operation; registration reads it and never re-resolves. */
export type CreateSeatDecisionV1 = {
  duty: RoleLineDutyV1 | 'unknown';                    // the counted duty; reviewer is saved as executor
  mode: 'reserved' | 'borrowed' | 'not_counted';       // how the seat was taken
  notCountedReason: 'unknown_duty' | 'readonly_copy' | null;   // exactly when mode is 'not_counted'
  allocationRef: RoleLineAllocationRef | null;         // the counted record; null only for not_counted
  handoff: OperationRef | null;                        // the parent, when the seat was borrowed
  source: SessionRef | null;                           // the borrowed seat's line
  decidedAt: string;
};
export type SessionCreationInput = {
  workspace: WorkspaceScope;
  /**
   * The Kernel store to pin, named by a caller that passes no `SessionAdmissionPorts`; with the ports the admission
   * chooses it from the line (and a named one is not read).
   */
  kernelStore?: { adapterId: string; storeKey: string };
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
  /** KLS-3a: the folder of the line the Session works on; absent is the workspace's main line. */
  lineFolder?: string;
};
export type SessionCreateActionV1 = { kind: 'create'; plannedSessionRef: SessionRef; parentOperation: OperationRef | null }
  & Omit<SessionCreationInput, 'provenance' | 'creation' | 'parentOperation' | 'consultation' | 'lineFolder' | 'kernelStore'>
  & { provenance: SessionProvenanceV1; creation: SessionCreationIntentV1 | null;
      /** The Kernel store the admission pinned with the line; execution and recovery read it from here, never again. */
      kernelStore: { adapterId: string; storeKey: string };
      /** The line the admission resolved (the Session record takes it); null when the workspace has no line. */
      lineRef: import('../../../contracts/line.js').LineRef | null;
      /** Required; `null` on every create that is not a consultation copy. */
      consultation: ConsultationCreateV1 | null;
      /** Required; the construction object supplies it (`null` for a caller that supplies no decision). */
      seatDecision: CreateSeatDecisionV1 | null };
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
/** The six arms of a `CoreOperation` record; every reader judges `kind` first. */
export type SessionOperationActionV1 =
  | SessionCreateActionV1 | HandoffActionV1 | SecretaryArchiveActionV1 | MemberCreateActionV1
  | MaintainerAssignmentActionV1 | RoleLineActionV1;
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
export type MaintainerAssignmentOperationV1 = SessionOperationRecordOf<MaintainerAssignmentActionV1>;
export type RoleLineOperationV1 = SessionOperationRecordOf<RoleLineActionV1>;
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
  /** a17: the stored facts row, or null when it is absent; never a second record or write. */
  roleFacts: SessionRoleFactsV1 | null;
};
/**
 * Passed with each admission by the Runtime that owns the Kernel stores (not a directory store): the admission reads
 * its receipt, then the line, then asks for that line's store, and pins both on the operation (kls-design §2.3.3).
 */
export type SessionAdmissionPorts = {
  /** `line`: the Session's line when it is not the workspace's main line; `null` for the main line or no line, both
   *  on the workspace's own store. `null` back: no store is registered for it. */
  kernelStoreFor(scope: WorkspaceScope, line: import('../../../contracts/line.js').LineRef | null):
    { adapterId: string; storeKey: string } | null;
};
export interface SessionDirectoryPort {
  admitSessionCreation(ctx: CoreCallContext, request: GraphWrite<SessionCreationInput>, ports?: SessionAdmissionPorts):
    Promise<WriteResult<SessionCreateOperationRecord>>;
  recordSessionCreated(ctx: CoreCallContext, request: GraphWrite<SessionCreationResult>): Promise<WriteResult<SessionRecord>>;
  getSessionOperation(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<SessionOperationRecord>>;
  readSession(ctx: CoreCallContext, ref: SessionRef, scope?: 'workspace' | 'project'): Promise<ReadResult<SessionCard>>;
  findSessions(ctx: CoreCallContext, input: {
    workspace: { projectId: string; workspaceId?: string }; target?: WorkLinkTarget; role?: RoleConfigurationRef;
    includeArchived: boolean; page: SessionPageRequest & { afterSessionKey?: string };
    /**
     * With a module target, also the main workspace's lines holding an open `responsible` link to it (kls-design
     * §2.3.4: role lines live in the main workspace and answer for the project's regions). No other workspace's
     * Session is added; the call stays bound to its own workspace.
     */
    projectRegionLines?: true;
    /** Only the Sessions of the line in this folder (kls-design §2.3.4); absent reads every line. */
    lineFolder?: string;
  }): Promise<ReadResult<SessionPage<SessionCard>>>;
}
/** The allocation report read: declared beside the directory port, never a member of it. */
export interface RoleLineAllocationReadPort {
  readRoleLineAllocation(ctx: CoreCallContext, input: Record<string, never>):
    Promise<ReadResult<RoleLineAllocationReportV1>>;
}
