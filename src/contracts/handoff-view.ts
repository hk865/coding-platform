/**
 * P1-06 Handoff provenance view (ReadModel) — display-only timeline of
 * handoff / replacement / evidence references for ONE Task. NEVER judges
 * completion: facts come only from committed events; the timeline shows the
 * A -> packet -> B (and evidence source runs) reference chain so a subsequent
 * result can be traced to the two Runs under the SAME Task revision.
 */
import type { CommitCursor } from "./command-event.js";
import type { EvidenceKind, EvidenceOutcome, EvidenceRef } from "./evidence.js";
import type { PlanRevisionRef } from "./plan.js";
import type { HandoffPacketRef, ReplacementAttemptRef } from "./handoff.js";
import type { RunRef, TaskAttemptRef } from "./dispatch.js";

export type HandoffProvenanceEntry =
  | {
      kind: "packet_recorded";
      packetRef: HandoffPacketRef;
      packetId: string;
      sourceRunRef: RunRef;
      sourceAttemptRef: TaskAttemptRef;
      predecessorPacketRef: HandoffPacketRef | null;
      taskRevision: number;
      workspaceSnapshot: { workspaceId: string; revision: number };
      recordedAt: string;
      sourceCursor: CommitCursor;
    }
  | {
      kind: "replacement_claimed";
      packetRef: HandoffPacketRef;
      replacementRef: ReplacementAttemptRef;
      priorRunRef: RunRef;
      priorAttemptRef: TaskAttemptRef;
      runRef: RunRef;
      attemptRef: TaskAttemptRef;
      reason: "run_crashed" | "run_ended" | "outcome_unknown" | "context_rollover" | "manual";
      claimedAt: string;
      sourceCursor: CommitCursor;
    }
  | {
      kind: "evidence_admitted";
      evidenceRef: EvidenceRef;
      evidenceId: string;
      outcome: EvidenceOutcome;
      evidenceKind: EvidenceKind;
      sourceRunRef: RunRef | null;
      planRef: PlanRevisionRef | null;
      planRevision: number | null;
      admittedAt: string;
      sourceCursor: CommitCursor;
    };

export type HandoffProvenanceView = {
  projectId: string;
  goalId: string;
  taskId: string;
  /** Packets in admission order (the latest is the current packet). */
  packetRefs: HandoffPacketRef[];
  /** Replacement attempts in claim order. */
  replacementRefs: ReplacementAttemptRef[];
  /** Full-scope task revision the task is being evolved under (planned value). */
  taskRevision: number | null;
  planRef: PlanRevisionRef | null;
  /** Display-only timeline, ordered by event order. */
  timeline: HandoffProvenanceEntry[];
  /** Display-only note: outcome_unknown is preserved and NEVER auto-retried. */
  outcomeUnknownPreserved: true;
  sourceCursor: CommitCursor;
};

export type HandoffProvenanceViewQuery = {
  projectId: string;
  goalId: string;
  taskId: string;
  atLeastCursor?: CommitCursor;
};

export type HandoffProvenanceViewResult =
  | { status: "ready"; provenance: HandoffProvenanceView; observedCursor: CommitCursor }
  | { status: "not_found"; observedCursor: CommitCursor }
  | { status: "not_ready"; requiredCursor: CommitCursor; observedCursor: CommitCursor };
