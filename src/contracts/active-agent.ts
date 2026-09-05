/**
 * ActiveAgentView + TaskDetail run-state contracts (P1-03 ReadModel surface).
 * Authority: modules/data/read-model-index.md + ticket acceptance — views are
 * rebuildable event projections; freshness uses the opaque CommitCursor
 * (not_ready != not_found); the run state NEVER originates from a command.
 */
import type { CommitCursor } from "./command-event.js";
import type {
  RoleBindingRefV1,
  RunOutcome,
  RunRef,
  RunStatus,
  TaskAttemptRef,
  TaskAttemptStatus,
  TaskBudgetV1,
} from "./dispatch.js";

export type ActiveAgentQuery = {
  projectId: string;
  goalId: string;
  taskId: string;
  atLeastCursor?: CommitCursor;
};

/** Run-state part projected onto a TaskDetail row (same events as ActiveAgent). */
export type TaskRunState = {
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  status: RunStatus;
  outcome: RunOutcome | null;
  exitCode: number | null;
  lastEventSeq: number;
  startedAt: string | null;
  endedAt: string | null;
  budget: TaskBudgetV1;
  binding: RoleBindingRefV1;
  sourceCursor: CommitCursor;
};

export type ActiveAgentView = {
  projectId: string;
  goalId: string;
  taskId: string;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  binding: RoleBindingRefV1;
  lease: {
    holderRunId: string;
    grantedAt: string;
    expiresAt: string | null;
    sourceCursor: CommitCursor;
  };
  attempt: {
    attemptId: string;
    status: TaskAttemptStatus;
    startedAt: string | null;
    endedAt: string | null;
    endOutcome: RunOutcome | null;
    sourceCursor: CommitCursor;
  };
  run: {
    status: RunStatus;
    outcome: RunOutcome | null;
    exitCode: number | null;
    lastEventSeq: number;
    startedAt: string | null;
    endedAt: string | null;
    budget: TaskBudgetV1;
    sourceCursor: CommitCursor;
  };
  sourceCursor: CommitCursor;
};

export type ActiveAgentViewResult =
  | { status: "ready"; agent: ActiveAgentView; observedCursor: CommitCursor }
  | {
      status: "not_ready";
      requiredCursor: CommitCursor;
      observedCursor: CommitCursor | null;
    }
  | { status: "not_found"; observedCursor: CommitCursor | null };
