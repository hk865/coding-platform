/**
 * L8 automatic capture (spec §1 L8, book ruling 3) and the one public
 * observation-state/reminder read (rulings 8 and 12).
 *
 * The request record is the durable "one failure is recorded" fact per
 * workspace: it is rewritten with a new revision by the one request writer
 * (state-layer constructor) and carries the request sequence the observation
 * pointer satisfies. `pending` is never stored; it is computed from the request
 * sequence and the pointer's watermark.
 */
import type { AdoptedArchitecture } from './architecture-catalog.js';
import type { FormalObservedFindingV1, ObservedCaptureRef } from './architecture-inspection.js';
import type { PersistedSourceCaptureRef } from './core/source.js';

/** The one production list of accepted automatic-capture triggers. The type is
 * derived from it and `isAutoCaptureTrigger` is the one validation rule, so the
 * request writer and the record codec cannot drift. */
export const AUTO_CAPTURE_TRIGGERS = ['workspace_registered', 'catalog_adopted', 'catalog_revised',
  'check_passed', 'startup_retry'] as const;

export type AutoCaptureTriggerV1 = (typeof AUTO_CAPTURE_TRIGGERS)[number];

export function isAutoCaptureTrigger(value: unknown): value is AutoCaptureTriggerV1 {
  return typeof value === 'string' && (AUTO_CAPTURE_TRIGGERS as readonly string[]).includes(value);
}

/** The one production limit for a recorded auto-capture failure reason, shared
 * by the state-layer writer (truncation) and the record codec (validation). */
export const AUTO_CAPTURE_FAILURE_REASON_MAX_CHARS = 2000;

export type ArchitectureAutoCaptureFailureV1 = { code: string; reason: string };

export type ArchitectureAutoCaptureRef = {
  aggregateType: 'ArchitectureAutoCapture'; projectId: string; workspaceId: string;
};

export type ArchitectureAutoCaptureRecordV1 = {
  ref: ArchitectureAutoCaptureRef;
  revision: number;
  schemaVersion: 1;
  workspace: { projectId: string; workspaceId: string };
  requestSeq: number;
  trigger: AutoCaptureTriggerV1;
  requestedAt: string;
  status: 'requested' | 'failed';
  failure: ArchitectureAutoCaptureFailureV1 | null;
};

/** Ruling 8. `captureRef` is the ObservedCaptureRef used by the file pages and
 * compare-formal; `observedAt` is the stored observation time. The accepted
 * "persisted ref" suggestion adds the stored `persistedRef` (and the previous
 * observation's one) so a caller can select the graph without a replay. */
export type ArchitectureObservationStateV1 = {
  current: { captureRef: ObservedCaptureRef; persistedRef: PersistedSourceCaptureRef;
    observedAt: string } | null;
  previous: ObservedCaptureRef | null;
  previousPersistedRef: PersistedSourceCaptureRef | null;
  autoCapture: (Omit<ArchitectureAutoCaptureRecordV1,
    'ref' | 'revision' | 'schemaVersion' | 'workspace'> & { pending: boolean }) | null;
};

export type ArchitectureReminderObservationV1 = {
  observedAt: string;
  nodes: { path: string; digest: string }[];
};

/** Ruling 12 read: the two observations are loaded once inside the service;
 * the comparison over `latest` and the moves share that one load. */
export type ArchitectureReminderFactsV1 = {
  state: ArchitectureObservationStateV1;
  catalog: AdoptedArchitecture | null;
  latest: ArchitectureReminderObservationV1 | null;
  previous: ArchitectureReminderObservationV1 | null;
  findings: FormalObservedFindingV1[];
};
