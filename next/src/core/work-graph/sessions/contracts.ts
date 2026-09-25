/** R4b Session creation and directory boundary. Formal creation records and
 * directory links share one atomic Store commit; Kernel effects remain outside. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommandMeta, RoleConfigurationRef, SessionRef, WorkspaceScope, WorkLinkRelation, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';

export type GraphWrite<T> = { input: T; meta: CommandMeta };
export type SessionPageRequest = { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
export type SessionPage<T> = { items: T[]; nextCursor: string | null; sourceCursor: CommitCursor };
export type SessionCreationInput = {
  workspace: WorkspaceScope;
  /** Trusted Host route selected before admission and pinned by the first durable operation. */
  kernelStore: { adapterId: string; storeKey: string };
  role: RoleConfigurationRef;
  recommendedRefs: ArtifactRef[];
  initialLinks: { target: WorkLinkTarget; relation: WorkLinkRelation }[];
};
export type SessionOperationRecord = {
  ref: OperationRef;
  revision: number;
  action: { kind: 'create'; plannedSessionRef: SessionRef } & SessionCreationInput;
  phase: 'accepted' | 'running' | 'completed' | 'failed' | 'unknown';
  requestedAt: string;
  updatedAt: string;
  observation: null | {
    observedAt: string; adapterId: string; kernelSessionId: string;
    beforeCursor: string | null; afterCursor: string | null;
    resultRef: ArtifactRef | null;
  };
  failure: null | { code: string; reason: string };
};
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
  admitSessionCreation(ctx: CoreCallContext, request: GraphWrite<SessionCreationInput>): Promise<WriteResult<SessionOperationRecord>>;
  recordSessionCreated(ctx: CoreCallContext, request: GraphWrite<SessionCreationResult>): Promise<WriteResult<SessionRecord>>;
  getSessionOperation(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<SessionOperationRecord>>;
  readSession(ctx: CoreCallContext, ref: SessionRef): Promise<ReadResult<SessionCard>>;
  findSessions(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; target?: WorkLinkTarget; role?: RoleConfigurationRef;
    includeArchived: boolean; page: SessionPageRequest;
  }): Promise<ReadResult<SessionPage<SessionCard>>>;
}
