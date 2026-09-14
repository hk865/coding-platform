/**
 * Handoff Control contracts — WorkerRuntime.HandoffControlPort.
 *
 * Authority:
 *   - dev_docs/modules/execution/worker-runtime.md (control plane minimal shape)
 *   - dev_docs/interfaces/runtime-collaboration.md (public snapshots/reports
 *     only — never hidden context; snapshot is read-only, does not inject
 *     messages into the source run)
 *   - dev_docs/modules/control/dispatch-engine.md
 *
 * Semantics:
 *   - MINIMAL control face: pause / stop via a safe point (NO cancel in
 *     handoff — retry/cancel is control intent).
 *   - snapshot() returns ONLY a public report (status, facts, public report
 *     ref) and NEVER reads the run's hidden context (noHiddenContextRead is an
 *     explicit field on the state/report shapes).
 *   - Review/verification semantic runs still go through the formal dispatch
 *     path (dispatch RunPort); this port is the control/snapshot face only.
 */
import type { ArtifactRef } from "./artifact.js";
import type { RunOutcome, RunRef } from "./dispatch.js";

export const HANDOFF_CONTROL_MAX_REPORT_BYTES = 32 * 1024;

export type HandoffControlCommandV1 = {
  schemaVersion: 1;
  kind: "pause" | "stop";
  reason: string;
  correlationId: string;
  submittedAt: string;
};

export type HandoffControlStateV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  status: "running" | "paused" | "stopped";
  pausedSince: string | null;
  stoppedSince: string | null;
  lastReason: string | null;
  /** Vault ref of the PUBLIC report (compact; never hidden context). */
  reportRef: ArtifactRef | null;
  /** Explicit guarantee: the control face never reads hidden context. */
  noHiddenContextRead: true;
};

export type PublicRuntimeReportV1 = {
  schemaVersion: 1;
  runRef: RunRef;
  status: "running" | "paused" | "stopped";
  lastEventSeq: number;
  terminalOutcome: RunOutcome | null;
  /** Compact public report body; full material stays behind the reportRef. */
  summary: string;
  reportRef: ArtifactRef | null;
  noHiddenContextRead: true;
};

export type HandoffControlCommandResultV1 =
  | { status: "accepted"; state: HandoffControlStateV1 }
  | { status: "rejected"; code: "invalid" | "forbidden" | "run_not_found" | "already_stopped"; issues: string[] };

export type HandoffSnapshotQueryV1 = {
  schemaVersion: 1;
  runRef: RunRef;
};

export type HandoffSnapshotResultV1 =
  | { status: "ready"; state: HandoffControlStateV1; report: PublicRuntimeReportV1 }
  | { status: "unsupported"; reason: string }
  | { status: "rejected"; code: "invalid" | "forbidden"; issues: string[] };

/** HandoffControlPort — versioned WorkerRuntime control interface. */
export interface HandoffControlPort {
  control(command: HandoffControlCommandV1): Promise<HandoffControlCommandResultV1>;
  snapshot(query: HandoffSnapshotQueryV1): Promise<HandoffSnapshotResultV1>;
}
