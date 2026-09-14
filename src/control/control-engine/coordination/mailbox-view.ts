import type { CommitCursor } from '../../../contracts/command-event.js';
import type { DomainEvent } from '../../../contracts/events.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { StateLedger } from '../../../contracts/ledger.js';
import type {
  DeliveryRecordedEvent,
  DeliveryRef,
  DeliverySnapshot,
  DirectedRequestCancelledEvent,
  DirectedRequestRef,
  DirectedRequestRespondedEvent,
  DirectedRequestSentEvent,
  DirectedRequestSnapshot,
  SubscriptionCancelledEvent,
  SubscriptionCreatedEvent,
  SubscriptionRef,
  SubscriptionSnapshot,
  WaitConditionCancelledEvent,
  WaitConditionObservedEvent,
  WaitConditionRef,
  WaitConditionRegisteredEvent,
  WaitConditionSatisfiedEvent,
  WaitConditionSnapshot,
  WaitConditionTimedOutEvent,
  WorkParticipationEndedEvent,
  WorkParticipationRef,
  WorkParticipationSnapshot,
  WorkParticipationStartedEvent,
} from '../../../contracts/coordination.js';
import type { MailboxViewQuery, MailboxViewResult } from '../../../contracts/modules.js';
import {
  deliveryRefFor,
  directedRequestRefFor,
  subscriptionRefFor,
  waitConditionRefFor,
  workParticipationRefFor,
} from '../../../contracts/coordination.js';

export const MAILBOX_SCAN_PAGE_SIZE = 1_000;
export const MAILBOX_MAX_SCAN_PAGES = 200;

type MailboxRefCollector = {
  participations: Map<string, WorkParticipationRef>;
  requests: Map<string, DirectedRequestRef>;
  subscriptions: Map<string, SubscriptionRef>;
  waits: Map<string, WaitConditionRef>;
  deliveries: Map<string, DeliveryRef>;
};

/** Rebuild one work mailbox from canonical events and current snapshots. */
export async function readMailboxView(
  ledger: Pick<StateLedger, 'events' | 'load'>,
  query: MailboxViewQuery,
): Promise<MailboxViewResult> {
  const projectId = query?.projectId ?? '';
  const workspaceId = query?.workspaceId ?? '';
  const workId = query?.workId ?? '';
  if (!projectId || !workspaceId || !workId) {
    return { status: 'unavailable', reason: '邮箱查询不完整：projectId/workspaceId/workId 都必须明确' };
  }
  const refs: MailboxRefCollector = {
    participations: new Map(), requests: new Map(), subscriptions: new Map(), waits: new Map(), deliveries: new Map(),
  };
  let cursor: CommitCursor | null = null;
  let pages = 0;
  try {
    for (;;) {
      const page = await ledger.events({ afterCursor: cursor, limit: MAILBOX_SCAN_PAGE_SIZE });
      for (const positioned of page.events) collectMailboxRefs(positioned.event, { projectId, workspaceId, workId }, refs);
      if (!page.hasMore) break;
      if (page.throughCursor === null || page.throughCursor === cursor) {
        return { status: 'unavailable', reason: '账本事件页游标没有推进，读不完整' };
      }
      cursor = page.throughCursor;
      pages++;
      if (pages >= MAILBOX_MAX_SCAN_PAGES) {
        return { status: 'unavailable', reason: `邮箱扫描超过上限 ${MAILBOX_MAX_SCAN_PAGES} 页，读不完整不当作完整答案` };
      }
    }
  } catch (error) {
    return { status: 'unavailable', reason: `账本事件不可读：${error instanceof Error ? error.message : String(error)}` };
  }
  const [participations, requests, subscriptions, waits, deliveries] = await Promise.all([
    loadAll<WorkParticipationSnapshot>(ledger, refs.participations, 'WorkParticipation'),
    loadAll<DirectedRequestSnapshot>(ledger, refs.requests, 'DirectedRequest'),
    loadAll<SubscriptionSnapshot>(ledger, refs.subscriptions, 'Subscription'),
    loadAll<WaitConditionSnapshot>(ledger, refs.waits, 'WaitCondition'),
    loadAll<DeliverySnapshot>(ledger, refs.deliveries, 'Delivery'),
  ]);
  return {
    status: 'ready',
    view: {
      workContextRef: { aggregateType: 'WorkContextBinding', projectId, workspaceId, workId },
      participations: sortByRefKey(participations),
      requests: sortByRefKey(requests),
      subscriptions: sortByRefKey(subscriptions),
      waits: sortByRefKey(waits),
      deliveries: sortByRefKey(deliveries),
    },
  };
}

async function loadAll<T>(
  ledger: Pick<StateLedger, 'load'>,
  refs: Map<string, Parameters<StateLedger['load']>[0]>,
  aggregateType: string,
): Promise<T[]> {
  const result: T[] = [];
  for (const key of [...refs.keys()].sort()) {
    const loaded = await ledger.load(refs.get(key)!);
    if (loaded.status === 'found' && loaded.snapshot.ref.aggregateType === aggregateType) result.push(loaded.snapshot as T);
  }
  return result;
}

function collectMailboxRefs(
  event: DomainEvent,
  scope: { projectId: string; workspaceId: string; workId: string },
  out: MailboxRefCollector,
): void {
  const inScope = (projectId: string | undefined, workspaceId: string | undefined): boolean =>
    projectId === scope.projectId && workspaceId === scope.workspaceId;
  switch (event.eventType) {
    case 'WorkParticipationStarted':
    case 'WorkParticipationEnded': {
      const participation = (event as WorkParticipationStartedEvent | WorkParticipationEndedEvent).payload.participation;
      const work = participation.workContextRef;
      if (!inScope(work.projectId, work.workspaceId) || work.workId !== scope.workId) return;
      const ref = workParticipationRefFor(work.projectId, work.workspaceId, work.workId, participation.participationId);
      out.participations.set(canonicalJson(ref), ref);
      return;
    }
    case 'DirectedRequestSent':
    case 'DirectedRequestResponded':
    case 'DirectedRequestCancelled': {
      const request = (event as DirectedRequestSentEvent | DirectedRequestRespondedEvent | DirectedRequestCancelledEvent).payload.request;
      if (!inScope(request.projectId, request.workspaceId)) return;
      if (request.fromWorkContextRef.workId !== scope.workId && request.toWorkContextRef.workId !== scope.workId) return;
      const ref = directedRequestRefFor(request.projectId, request.workspaceId, request.requestId);
      out.requests.set(canonicalJson(ref), ref);
      return;
    }
    case 'SubscriptionCreated':
    case 'SubscriptionCancelled': {
      const subscription = (event as SubscriptionCreatedEvent | SubscriptionCancelledEvent).payload.subscription;
      if (!inScope(subscription.projectId, subscription.workspaceId) || subscription.ownerWorkContextRef.workId !== scope.workId) return;
      const ref = subscriptionRefFor(subscription.projectId, subscription.workspaceId, subscription.subscriptionId);
      out.subscriptions.set(canonicalJson(ref), ref);
      return;
    }
    case 'DeliveryRecorded': {
      const delivery = (event as DeliveryRecordedEvent).payload.delivery;
      if (!inScope(delivery.projectId, delivery.workspaceId) || delivery.targetWorkContextRef.workId !== scope.workId) return;
      const ref = deliveryRefFor(delivery.projectId, delivery.workspaceId, delivery.deliveryId);
      out.deliveries.set(canonicalJson(ref), ref);
      return;
    }
    case 'WaitConditionRegistered':
    case 'WaitConditionObserved':
    case 'WaitConditionSatisfied':
    case 'WaitConditionTimedOut':
    case 'WaitConditionCancelled': {
      const wait = (event as WaitConditionRegisteredEvent | WaitConditionObservedEvent | WaitConditionSatisfiedEvent | WaitConditionTimedOutEvent | WaitConditionCancelledEvent).payload.wait;
      if (!inScope(wait.projectId, wait.workspaceId) || wait.ownerWorkContextRef.workId !== scope.workId) return;
      const ref = waitConditionRefFor(wait.projectId, wait.workspaceId, wait.waitId);
      out.waits.set(canonicalJson(ref), ref);
      return;
    }
  }
}

function sortByRefKey<T extends { ref: { aggregateType: string } }>(snapshots: T[]): T[] {
  return [...snapshots].sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)));
}
