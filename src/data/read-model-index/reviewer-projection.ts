import type { DomainEvent } from '../../contracts/events.js';
import type { ReviewProjectionSnapshot, ReviewProjectionFacts } from '../../contracts/read-model.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import { isTerminalRuntimeEvent, runtimeEventTerminalOutcome } from '../../contracts/dispatch.js';

export const reviewProjectionEventTypes = ['ReviewWorkCreated', 'FailedReviewWorkReplaced', 'TaskReviewProtocolAdopted', 'ReviewInputBound', 'ReviewOutputBound', 'ReviewResultRecorded'];
/** Projection-only event fold; it never calls Control or reads canonical state. */
export function reviewProjectionChanges(event: DomainEvent, records: ReviewProjectionSnapshot[]): ReviewProjectionSnapshot[] {
  if (event.eventType === 'ReviewWorkCreated') return [event.payload.work, event.payload.run];
  if (event.eventType === 'TaskReviewProtocolAdopted') return [event.payload.protocol];
  if (event.eventType === 'FailedReviewWorkReplaced') return [event.payload.work, event.payload.protocol, event.payload.run];
  if (event.eventType === 'ReviewInputBound' || event.eventType === 'ReviewOutputBound') return [event.payload.work];
  if (event.eventType === 'ReviewResultRecorded') return [event.payload.work, event.payload.result];
  if (!['RunStarted','RunEventRecorded','RunOutcomeUnknown'].includes(event.eventType)) return [];
  const run = records.find((r): r is RunSnapshot => r.ref.aggregateType === 'Run' && r.ref.projectId === event.projectId && r.ref.runId === event.aggregateId);
  if (!run) return [];
  if (event.eventType === 'RunStarted') return [{ ...run, revision: event.aggregateRevision, status: 'running', envelope: event.payload.envelope, startedAt: event.payload.startedAt }];
  if (event.eventType === 'RunOutcomeUnknown') return [{ ...run, revision: event.aggregateRevision, status: 'ended', outcome: 'outcome_unknown', endedAt: event.payload.observedAt }];
  if (event.eventType === 'RunEventRecorded') {
    const rt = event.payload.runtimeEvent, terminal = isTerminalRuntimeEvent(rt);
    return [{ ...run, revision: event.aggregateRevision, status: terminal ? 'ended' : 'running', outcome: terminal ? runtimeEventTerminalOutcome(rt) : run.outcome, exitCode: rt.payload.kind === 'completed' ? rt.payload.exitCode : run.exitCode, lastEventSeq: rt.sequence, lastRuntimeEventId: rt.eventId, lastFactEventId: event.eventId, endedAt: terminal ? rt.occurredAt : run.endedAt }];
  }
  return [];
}
export function reviewProjectionFacts(records: ReviewProjectionSnapshot[]): ReviewProjectionFacts {
  return {
    works: records.filter(r => r.ref.aggregateType === 'ReviewWork') as ReviewProjectionFacts['works'], results: records.filter(r => r.ref.aggregateType === 'ReviewResult') as ReviewProjectionFacts['results'],
    protocols: records.filter(r => r.ref.aggregateType === 'TaskReviewProtocol') as ReviewProjectionFacts['protocols'], runs: records.filter(r => r.ref.aggregateType === 'Run') as ReviewProjectionFacts['runs'],
  };
}
