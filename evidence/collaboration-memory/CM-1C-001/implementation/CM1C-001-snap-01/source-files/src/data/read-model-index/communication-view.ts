/** One rebuildable event projection for either ledger adapter. No Control/Runtime calls. */
import type { StateLedger, EventPage } from '../../contracts/ledger.js';
import { compareCommitCursor, seqOfCommitCursor } from '../../contracts/ledger.js';
import type { CommitCursor } from '../../contracts/command-event.js';
import type { CommunicationViewQuery, CommunicationViewResult } from '../../contracts/communication-view.js';
import type { WaitConditionV1, CommunicationIntentV1, DirectedRequestV1, DeliveryV1 } from '../../contracts/coordination.js';
import type { WorkContextBindingV1 } from '../../contracts/context-continuity.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { isTerminalRuntimeEvent } from '../../contracts/dispatch.js';
import { isKnownEventType } from '../../contracts/events.js';

export class CommunicationViewIndex {
  constructor(private readonly ledger: Pick<StateLedger, 'events'>) {}

  async view(query: CommunicationViewQuery): Promise<CommunicationViewResult> {
    const result: CommunicationViewResult = { status: 'not_ready', sourceCursor: null, reason: null, waits: [],
      backlog: { pending: 0, leased: 0, retry: 0, blocked: 0 }, failures: [], timeline: [] };
    const waits = new Map<string, WaitConditionV1>(), intents = new Map<string, CommunicationIntentV1>();
    const requests = new Map<string, DirectedRequestV1>(), deliveries = new Map<string, DeliveryV1>();
    const works = new Map<string, WorkContextBindingV1>(), ended = new Set<string>();
    const responses = new Map<string, DirectedRequestV1>();
    let cursor: CommitCursor | null = null;
    let expectedSequence = 1;
    try {
      for (let pages = 0; pages < 200; pages++) {
        const page: EventPage = await this.ledger.events({ afterCursor: cursor, limit: 1000 });
        for (const row of page.events) {
          const event = row.event;
          if (event.schemaVersion !== 1 || !isKnownEventType(event.eventType) || seqOfCommitCursor(row.cursor) !== expectedSequence++) throw Error('event history schema or sequence gap');
          if (event.projectId !== query.projectId || !('workspaceId' in event) || event.workspaceId !== query.workspaceId) continue;
          const payload = event.payload as unknown as Record<string, unknown>;
          if (payload['binding'] && ['WorkContextBound', 'WorkRunLinked', 'WorkParticipationStarted'].includes(event.eventType)) {
            const binding = payload['binding'] as WorkContextBindingV1;
            works.set(binding.workId, binding);
          }
          if (event.eventType === 'RunOutcomeUnknown' || event.eventType === 'RunReconciled') ended.add(event.aggregateId);
          if (event.eventType === 'RunEventRecorded' && isTerminalRuntimeEvent(event.payload.runtimeEvent)) ended.add(event.aggregateId);
          if (event.eventType === 'DirectedRequestResponded') responses.set(String(row.cursor), event.payload.request);
          if (payload['wait']) { const wait = payload['wait'] as WaitConditionV1; waits.set(wait.waitId, wait); }
          if (payload['intent'] && event.eventType.startsWith('CommunicationIntent')) { const intent = payload['intent'] as CommunicationIntentV1; intents.set(intent.intentId, intent); }
          if (payload['request'] && event.eventType.startsWith('DirectedRequest')) { const request = payload['request'] as DirectedRequestV1; requests.set(request.requestId, request); }
          if (event.eventType === 'DeliveryRecorded') deliveries.set(canonicalJson({ aggregateType: 'Delivery', projectId: event.projectId, workspaceId: event.workspaceId, deliveryId: event.payload.delivery.deliveryId }), event.payload.delivery);
          if (/^(WaitCondition|DirectedRequest|DeliveryRecorded|Subscription|CommunicationIntent|CommunicationAdmission)/.test(event.eventType)) {
            result.timeline.push({ cursor: row.cursor, type: event.eventType, id: event.aggregateId, at: event.occurredAt });
            if (result.timeline.length > 80) result.timeline.shift();
          }
        }
        result.sourceCursor = page.throughCursor;
        if (!page.hasMore) { result.status = 'ready'; break; }
        if (!page.throughCursor || page.throughCursor === cursor) { result.reason = 'event_cursor_not_advancing'; break; }
        cursor = page.throughCursor;
      }
    } catch (error) { result.reason = 'event_history_unavailable: ' + String(error); }
    if (result.status !== 'ready') { result.reason ??= 'event_history_incomplete'; return result; }
    if (query.atLeastCursor && (!result.sourceCursor || compareCommitCursor(result.sourceCursor, query.atLeastCursor) < 0)) {
      result.status = 'not_ready'; result.reason = 'projection_behind_required_cursor'; return result;
    }
    for (const wait of waits.values()) {
      if (query.goalId && works.get(wait.ownerWorkContextRef.workId)?.goalId !== query.goalId) continue;
      const matched = wait.conditions.filter(term => term.kind === 'delivery_present' ? deliveries.has(canonicalJson(term.deliveryRef))
        : term.kind === 'request_responded' ? !!requests.get(term.requestRef.requestId)?.response
        : ['responded', 'cancelled', 'closed', 'expired'].includes(requests.get(term.requestRef.requestId)?.status ?? '')).length;
      // A response event alone is not a delivered report. This count describes
      // routing facts only; material applicability is checked at admission.
      const delivered = wait.conditions.filter(term => [...deliveries.entries()].some(([ref, delivery]) => {
        if (!delivery.bodyRef || canonicalJson(delivery.targetWorkContextRef) !== canonicalJson(wait.ownerWorkContextRef) ||
            delivery.origin.kind !== 'subscription' || delivery.origin.sourceTopic !== 'DirectedRequestResponded') return false;
        const response = responses.get(String(delivery.origin.sourceCursor));
        if (!response?.response || canonicalJson(response.fromWorkContextRef) !== canonicalJson(wait.ownerWorkContextRef) ||
            canonicalJson(response.response.bodyRef) !== canonicalJson(delivery.bodyRef)) return false;
        return term.kind === 'delivery_present' ? ref === canonicalJson(term.deliveryRef) : term.kind === 'request_responded' &&
          response.projectId === term.requestRef.projectId && response.workspaceId === term.requestRef.workspaceId && response.requestId === term.requestRef.requestId;
      })).length;
      const observed = wait.mode === 'any' ? delivered > 0 : matched === wait.conditions.length;
      result.waits.push({ waitId: wait.waitId, workId: wait.ownerWorkContextRef.workId, mode: wait.mode, status: wait.status, matched, delivered, total: wait.conditions.length,
        reason: wait.status !== 'active' ? wait.status : !observed ? 'waiting_for_report' : !ended.has(wait.predecessorRunRef.runId) ? 'waiting_for_predecessor' : 'waiting_for_admission_checks',
        winnerDeliveryId: wait.selectedReport?.deliveryRef.deliveryId ?? null });
    }
    // Routing backlog is workspace-wide and labelled as such by the consumer.
    for (const intent of intents.values()) {
      if (intent.status === 'pending') result.backlog.pending++;
      if (intent.status === 'leased') result.backlog.leased++;
      if (intent.status === 'retry_scheduled') result.backlog.retry++;
      if (['quarantined', 'outcome_unknown', 'cancel_requested'].includes(intent.status)) result.backlog.blocked++;
      if (intent.lastFailureClass || ['quarantined', 'outcome_unknown'].includes(intent.status)) result.failures.push({ intentId: intent.intentId, status: intent.status, reason: intent.lastFailureClass });
    }
    result.failures = result.failures.slice(-32);
    return result;
  }
}
