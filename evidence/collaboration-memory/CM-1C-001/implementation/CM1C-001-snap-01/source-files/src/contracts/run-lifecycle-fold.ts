import type { RunSnapshot, TaskAttemptSnapshot, DispatchOutboxEntrySnapshot, RuntimeEventV1, RunOutcome } from './dispatch.js';
import { isTerminalRuntimeEvent, runtimeEventTerminalOutcome } from './dispatch.js';

/** Pure fold: the Run snapshot after one accepted runtime event. */
export function nextRunSnapshotForRuntimeEvent(
  current: RunSnapshot,
  event: RuntimeEventV1,
): RunSnapshot {
  const terminal = isTerminalRuntimeEvent(event);
  const next: RunSnapshot = {
    ...current,
    status: terminal ? "ended" : "running",
    outcome: terminal ? runtimeEventTerminalOutcome(event) : current.outcome,
    exitCode: event.payload.kind === "completed" ? event.payload.exitCode : current.exitCode,
    lastEventSeq: event.sequence,
    lastRuntimeEventId: event.eventId,
    lastFactEventId: "FILLED-BY-COMMIT",
    endedAt: terminal ? event.occurredAt : current.endedAt,
  };
  return next;
}


/** Pure fold: the Run snapshot after an outcome_unknown fact. */
export function nextRunSnapshotForOutcomeUnknown(
  current: RunSnapshot,
  deps: { observedAt: string },
): RunSnapshot {
  return {
    ...current,
    status: "ended",
    outcome: "outcome_unknown",
    ...(current.executionAuthorization ? { executionAuthorization: { ...current.executionAuthorization, phase: 'quarantined' as const } } : {}),
    endedAt: deps.observedAt,
  };
}


export function nextAttemptSnapshotForTerminal(
  current: TaskAttemptSnapshot,
  outcome: RunOutcome,
  endedAt: string,
): TaskAttemptSnapshot {
  return { ...current, revision: current.revision + 1, status: "ended", endedAt, endOutcome: outcome };
}


export function nextOutboxSnapshotForTerminal(
  current: DispatchOutboxEntrySnapshot,
  doneAt: string,
): DispatchOutboxEntrySnapshot {
  return { ...current, revision: current.revision + 1, status: "done", doneAt };
}