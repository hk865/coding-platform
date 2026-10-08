// Slice 1: the immutable Session anomaly anchor (the only new formal aggregate)
// and its read views.
import type { ActorRef } from './command-event.js';
import type { RoleConfigurationRef, SessionRef } from './core/identity.js';
import type { SessionArchiveRequestV1 } from './core/session-archive.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import type { PlanRevisionRef } from './plan.js';

export type SessionAnomalyAnchorRef = {
  aggregateType: 'SessionAnomalyAnchor'; projectId: string; goalId: string; runId: string;
};
export type ArchiveChangedFilesV1 = {
  source: 'kernel' | 'worktree' | 'unknown';
  status: 'known' | 'partial' | 'not_entered' | 'unavailable';
  confirmed: string[]; possible: string[]; omitted: number;
  baseCommit: string | null;
  runBaselineKnown: false;
  reason: string | null;
};
export type SessionAnomalyAnchorV1 = {
  ref: SessionAnomalyAnchorRef; revision: 1; schemaVersion: 1;
  workspaceId: string; task: TaskTriple; planRef: PlanRevisionRef;
  lineHead: SessionRef; sessionRef: SessionRef; role: RoleConfigurationRef;
  runRef: RunRef; attemptRef: TaskAttemptRef;
  cause: 'archive_interrupted' | 'retired_archive';
  archiveRequestId: string;
  archiveRequestReceipt: SessionArchiveRequestV1['receipt'];
  archivedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
  recordedAt: string;
  changedFiles: ArchiveChangedFilesV1;
  resultVerification: 'not_checked';
};
export type SessionAnomalyViewV1 = {
  anchor: SessionAnomalyAnchorV1;
  pickedUpBy: RunRef | null;
};
export type ArchiveRequeueOriginV1 =
  | { kind: 'execution'; anchorRef: SessionAnomalyAnchorRef;
      archiveSessionRef: SessionRef; archiveRequestId: string }
  | { kind: 'wait'; runRef: RunRef; messageRef: SessionMessageRef;
      archiveSessionRef: SessionRef; archiveRequestId: string };
