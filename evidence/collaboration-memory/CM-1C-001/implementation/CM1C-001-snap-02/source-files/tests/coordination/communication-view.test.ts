import { describe, expect, it } from 'vitest';
import { CommunicationViewIndex } from '../../src/data/read-model-index/communication-view.js';
import { makeCommitCursor, type PositionedEvent } from '../../src/contracts/ledger.js';
import type { DomainEvent } from '../../src/contracts/events.js';

// Projection fixtures deliberately exercise persisted event reading only.
// Control admission and body authorization are covered by coordination tests.
const projectId = 'view-project', workspaceId = 'view-workspace';
const work = { aggregateType: 'WorkContextBinding', projectId, workspaceId, workId: 'coordinator' };
const requestRef = { aggregateType: 'DirectedRequest', projectId, workspaceId, requestId: 'report' };
const bodyRef = { kind: 'artifact', digest: 'a'.repeat(64), sizeBytes: 1, contentType: 'text/plain' };
const request = { projectId, workspaceId, requestId: 'report', fromWorkContextRef: work, status: 'responded', response: { bodyRef } };
const query = { projectId, workspaceId, goalId: 'goal' };
function fixture(terminal = 'run_budget_exhausted', delivery = true): PositionedEvent[] {
  const row = (eventType: string, aggregateId: string, payload: unknown) => ({ schemaVersion: 1, projectId, workspaceId,
    eventType, aggregateId, occurredAt: '2026-09-13T00:00:00Z', payload }) as DomainEvent;
  const events = [
    row('WorkContextBound', 'coordinator', { binding: { workId: 'coordinator', goalId: 'goal' } }),
    row('WaitConditionRegistered', 'wait', { wait: { waitId: 'wait', ownerWorkContextRef: work, mode: 'any', status: 'active',
      predecessorRunRef: { runId: 'predecessor' }, conditions: [{ kind: 'request_responded', requestRef }] } }),
    row('DirectedRequestResponded', 'report', { request }),
    row('RunEventRecorded', 'predecessor', { runtimeEvent: { eventType: terminal } }),
  ];
  if (delivery) events.push(row('DeliveryRecorded', 'delivery', { delivery: { projectId, workspaceId, deliveryId: 'delivery',
    targetWorkContextRef: work, bodyRef, origin: { kind: 'subscription', sourceTopic: 'DirectedRequestResponded', sourceCursor: makeCommitCursor(3) } } }));
  return events.map((event, index) => ({ cursor: makeCommitCursor(index + 1), event }));
}
function view(events: PositionedEvent[]) {
  return new CommunicationViewIndex({ events: async () => ({ afterCursor: null, throughCursor: events.at(-1)?.cursor ?? null, events, hasMore: false }) }).view(query);
}

describe('persistent communication view', () => {
  it.each(['run_completed', 'run_cancelled', 'run_crashed', 'run_budget_exhausted'])('recognizes canonical predecessor terminal %s', async terminal => {
    expect((await view(fixture(terminal))).waits[0]).toMatchObject({ reason: 'waiting_for_admission_checks', matched: 1, delivered: 1 });
  });
  it('keeps an active predecessor distinct from a delivered report', async () => {
    expect((await view(fixture('run_started'))).waits[0]?.reason).toBe('waiting_for_predecessor');
  });
  it('does not count a response without a Delivery as a delivered alternative', async () => {
    expect((await view(fixture('run_budget_exhausted', false))).waits[0]).toMatchObject({ reason: 'waiting_for_report', matched: 1, delivered: 0 });
  });
  it('does not count a Delivery whose actual response position is unrelated', async () => {
    const rows = fixture();
    const event = rows.at(-1)!.event;
    if (event.eventType !== 'DeliveryRecorded' || event.payload.delivery.origin.kind !== 'subscription') throw Error('fixture');
    event.payload.delivery.origin.sourceCursor = makeCommitCursor(1);
    expect((await view(rows)).waits[0]).toMatchObject({ reason: 'waiting_for_report', delivered: 0 });
  });
  it('marks a missing event position unavailable instead of showing an empty mailbox', async () => {
    const rows = fixture(); rows.splice(2, 1);
    expect(await view(rows)).toMatchObject({ status: 'not_ready', waits: [] });
  });
  it('does not mix another workspace into this view', async () => {
    const rows = fixture();
    for (const row of rows) Object.assign(row.event, { workspaceId: 'other' });
    expect(await view(rows)).toMatchObject({ status: 'ready', waits: [], timeline: [] });
  });
  it.each([{ schemaVersion: 2 }, { eventType: 'FutureCommunicationEvent' }])('refuses unknown event semantics %j', async mutation => {
    const rows = fixture(); Object.assign(rows[2]!.event, mutation);
    expect(await view(rows)).toMatchObject({ status: 'not_ready', waits: [] });
  });
});
