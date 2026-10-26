// Slice 1 (Session facts, corrections and archive): the immutable Session
// archive request and the internal step commit identity derived from it.
import { canonicalJson, sha256Hex, type JsonValue } from '../fingerprint.js';
import type { ActorRef } from '../command-event.js';
import type { SessionRef, VersionPin, WorkLinkTarget, WorkspaceScope } from './identity.js';
import type { OperationRef } from './operations.js';
import type { SessionMessageRef } from './session-message.js';
import type { QueryRunRef } from '../query-job.js';
import type { RunRef, TaskAttemptRef } from '../dispatch.js';

export type ArchiveTaskChoiceV1 = {
  target: Extract<WorkLinkTarget, { kind: 'task' | 'work' }>;
  disposition: { kind: 'drop' } | { kind: 'transfer'; to: SessionRef };
};
export type ArchiveWaitChoiceV1 =
  | { kind: 'cancel'; runRef: RunRef; messageRef: SessionMessageRef }
  | { kind: 'transfer'; runRef: RunRef; messageRef: SessionMessageRef; to: SessionRef };
export type ArchiveExecutionV1 =
  | { kind: 'none' }
  | { kind: 'work'; runRef: RunRef; attemptRef: TaskAttemptRef }
  | { kind: 'query'; queryRunRef: QueryRunRef };
/**
 * The trusted condition of an archive: the handoff or manual-archive operation the archive belongs to; a handoff's
 * holds the fence. The request field, its builders and the passthrough are the archive owner's; the final commit
 * merges the condition's checked fragment.
 */
export type SessionArchiveConditionV1 = { kind: 'secretary_handoff'; operation: OperationRef };
export type SessionArchiveRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
  requestedAt: string;
  reason: string;
  mode: 'operator' | 'executor_idle' | 'retired' | 'answered_copy' | 'handoff_complete'
    | 'secretary_handoff';
  /**
   * The trusted condition the final archive re-checks. `null` for every mode that takes none, so a reader of a
   * stored request is never left guessing between "no condition" and "the field was dropped". It is part of the
   * request's immutable identity: the owner's fingerprint and the recovered request both carry the original
   * value, never one recomputed from the current state.
   */
  condition: SessionArchiveConditionV1 | null;
  tasks: ArchiveTaskChoiceV1[];
  wait: ArchiveWaitChoiceV1 | null;
  execution: ArchiveExecutionV1;
  executionPins: VersionPin[];
  confirmUnknownStopped: boolean;
  receipt: { identityKey: string; fingerprint: string };
};
export type ArchiveStepRefV1 = {
  sessionRef: SessionRef; archiveRequestId: string;
  requestReceipt: SessionArchiveRequestV1['receipt'];
  step: 'stop' | 'anchor' | 'requeue' | 'responsibility' | 'reply_handler' | 'wait_cancel' | 'archive';
  subjectKey: string;
};
export type RequestSessionArchiveInput = {
  sessionRef: SessionRef; reason: string;
  tasks: ArchiveTaskChoiceV1[]; wait: ArchiveWaitChoiceV1 | null;
  confirmUnknownStopped?: boolean;
  mode?: SessionArchiveRequestV1['mode']; // 默认operator，其他mode仅可信Workflow可选。
  /** The trusted condition of a secretary archive; absent is the same as `null` on the request. */
  condition?: SessionArchiveConditionV1 | null;
};

/**
 * Internal archive-step commit identity derived from the immutable archive
 * request: the identity key, fingerprint and event id (spec §2.3).
 */
export function deriveArchiveStepCommitIdentityV1(
  scope: WorkspaceScope, request: SessionArchiveRequestV1, step: ArchiveStepRefV1,
): { identityKey: string; fingerprint: string; eventId: string } {
  // The step is only meaningful for the exact stored request it was read from:
  // its request id and recorded receipt must agree before any identity is
  // derived. A mismatched step is a caller bug, never a valid archive step.
  if (step.archiveRequestId !== request.requestId
    || step.requestReceipt.identityKey !== request.receipt.identityKey
    || step.requestReceipt.fingerprint !== request.receipt.fingerprint) {
    throw new Error('deriveArchiveStepCommitIdentityV1: the step does not belong to the archive request');
  }
  const material = {
    schemaVersion: 1 as const,
    actor: request.requestedBy,
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    sessionRef: step.sessionRef,
    archiveRequestId: request.requestId,
    step: step.step,
    subjectKey: step.subjectKey,
  };
  const identityKey = 's1-archive-step:' + sha256Hex(canonicalJson(material as unknown as JsonValue));
  const fingerprint = sha256Hex(canonicalJson({
    ...material,
    requestReceipt: request.receipt,
    reason: request.reason,
    mode: request.mode,
    tasks: request.tasks,
    wait: request.wait,
    execution: request.execution,
    executionPins: request.executionPins,
    confirmUnknownStopped: request.confirmUnknownStopped,
  } as unknown as JsonValue));
  return { identityKey, fingerprint, eventId: sha256Hex(`${identityKey}|${step.step}`) };
}
