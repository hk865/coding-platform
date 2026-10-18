/**
 * L8 automatic-capture request record (book ruling 3; spec §1 L8).
 *
 * This is the only writer of `ArchitectureAutoCapture@1`: the request record is
 * created with `requestSeq + 1` when a trigger is accepted, and the same record
 * is rewritten with `status: 'failed'` and the capture's failure when that
 * capture fails. The service never assembles this record itself. Pure: inputs
 * only, no clock; the caller passes `requestedAt`.
 */
import { AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS, type ArchitectureAutoCaptureFailureV1,
  type ArchitectureAutoCaptureRecordV1, type ArchitectureObservationStateV1,
  type AutoCaptureTriggerV1 } from '../../../contracts/architecture-observation.js';

export type NewArchitectureCaptureRequestInputV1 = {
  current: ArchitectureAutoCaptureRecordV1 | null;
  workspace: { projectId: string; workspaceId: string };
  trigger: AutoCaptureTriggerV1;
  requestedAt: string;
};

export type NewArchitectureCaptureFailureInputV1 = {
  /** The START SNAPSHOT record read when the capture began, not a fresh read. */
  current: ArchitectureAutoCaptureRecordV1;
  failure: ArchitectureAutoCaptureFailureV1;
};

function assertWorkspace(current: ArchitectureAutoCaptureRecordV1,
  workspace: { projectId: string; workspaceId: string }): void {
  if (current.workspace.projectId !== workspace.projectId
    || current.workspace.workspaceId !== workspace.workspaceId) {
    throw new Error('newArchitectureCaptureRecord: the current record belongs to another workspace');
  }
}

/** `revision = current ? current.revision + 1 : 1`;
 *  `requestSeq = current ? current.requestSeq + 1 : 1`; status `requested`; failure null. */
export function newArchitectureCaptureRequestRecord(input: NewArchitectureCaptureRequestInputV1): ArchitectureAutoCaptureRecordV1 {
  const { current, workspace } = input;
  if (current !== null) assertWorkspace(current, workspace);
  return {
    ref: { aggregateType: 'ArchitectureAutoCapture', projectId: workspace.projectId, workspaceId: workspace.workspaceId },
    revision: current === null ? 1 : current.revision + 1,
    schemaVersion: 1,
    workspace: { projectId: workspace.projectId, workspaceId: workspace.workspaceId },
    requestSeq: current === null ? 1 : current.requestSeq + 1,
    trigger: input.trigger,
    requestedAt: input.requestedAt,
    status: 'requested',
    failure: null,
  };
}

/** The public `autoCapture` projection (book ruling 8): `pending` is computed,
 * never stored. Living here keeps the record's `status`/`failure`/`requestSeq`
 * written only by the state layer (the state-writes checker enforces it). */
export function architectureAutoCaptureState(record: ArchitectureAutoCaptureRecordV1 | null,
  satisfiedRequestSeq: number): ArchitectureObservationStateV1['autoCapture'] {
  if (record === null) return null;
  return {
    requestSeq: record.requestSeq,
    trigger: record.trigger,
    requestedAt: record.requestedAt,
    status: record.status,
    failure: record.failure === null ? null : { code: record.failure.code, reason: record.failure.reason },
    pending: record.requestSeq > satisfiedRequestSeq,
  };
}

/** Same ref/workspace/requestSeq/trigger/requestedAt; `revision = current.revision + 1`;
 *  status `failed`; the failure copied with its reason truncated to the shared 2000-character limit. */
export function newArchitectureCaptureFailureRecord(input: NewArchitectureCaptureFailureInputV1): ArchitectureAutoCaptureRecordV1 {
  const { current, failure } = input;
  return {
    ref: { ...current.ref },
    revision: current.revision + 1,
    schemaVersion: 1,
    workspace: { ...current.workspace },
    requestSeq: current.requestSeq,
    trigger: current.trigger,
    requestedAt: current.requestedAt,
    status: 'failed',
    failure: {
      code: failure.code,
      reason: failure.reason.length > AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS
        ? failure.reason.slice(0, AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS)
        : failure.reason,
    },
  };
}
