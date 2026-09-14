import type { DomainEvent } from '../../contracts/events.js';
import type { QueryJobAnswerV1, QueryJobV1, QueryRunV1 } from '../../contracts/query-job.js';
import { consoleWorkspaceKey } from '../../contracts/console-views.js';

export type QueryProjectionChange =
  | { kind: 'job'; key: string; job: QueryJobV1 }
  | { kind: 'run'; key: string; run: QueryRunV1 }
  | { kind: 'answer-appended'; key: string; answer: QueryJobAnswerV1 };

/** Interpret query lifecycle facts; adapters decide Map versus SQL writes. */
export function projectQueryEvent(event: DomainEvent): QueryProjectionChange[] {
  if (event.eventType === 'QueryJobSubmitted') {
    const job = event.payload.job;
    return [{ kind: 'job', key: `${consoleWorkspaceKey(event.projectId, event.workspaceId)}\u0000${job.queryJobId}`, job }];
  }
  if (event.eventType === 'QueryRunStarted') {
    const prefix = consoleWorkspaceKey(event.projectId, event.workspaceId);
    return [
      ...(event.payload.job ? [{ kind: 'job' as const, key: `${prefix}\u0000${event.payload.job.queryJobId}`, job: event.payload.job }] : []),
      { kind: 'run', key: `${prefix}\u0000${event.payload.run.runId}`, run: event.payload.run },
    ];
  }
  if (event.eventType === 'QueryJobAnswerRecorded') {
    const prefix = consoleWorkspaceKey(event.projectId, event.workspaceId);
    return [
      { kind: 'job', key: `${prefix}\u0000${event.payload.job.queryJobId}`, job: event.payload.job },
      { kind: 'run', key: `${prefix}\u0000${event.payload.run.runId}`, run: event.payload.run },
      { kind: 'answer-appended', key: `${prefix}\u0000${event.payload.job.queryJobId}`, answer: event.payload.answer },
    ];
  }
  if (event.eventType === 'QueryJobClosed') {
    const prefix = consoleWorkspaceKey(event.projectId, event.workspaceId);
    return [
      { kind: 'job', key: `${prefix}\u0000${event.payload.job.queryJobId}`, job: event.payload.job },
      { kind: 'run', key: `${prefix}\u0000${event.payload.run.runId}`, run: event.payload.run },
    ];
  }
  return [];
}
