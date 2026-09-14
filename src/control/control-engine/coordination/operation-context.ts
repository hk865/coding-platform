import type { CommunicationIntentV1, RouteIntentPlanV1, WorkParticipationRef } from '../../../contracts/coordination.js';
import type { WorkContextBindingSnapshot, WorkContextRef } from '../../../contracts/context-continuity.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { AggregateRef } from '../../../contracts/ledger.js';
import type { ControlEngineDeps } from '../control-engine.js';
import type { CoordinationFoldDeps } from '../records/coordination.js';

/**
 * Dependencies shared by the coordination responsibility modules.
 *
 * This class deliberately exposes only canonical reads, fold inputs and the
 * route-intent plan. Each responsibility module still owns its command
 * validation, reference reads, permission checks, expected versions and the
 * single commit it submits.
 */
export class CoordinationOperationContext {
  constructor(readonly deps: ControlEngineDeps) {}

  foldDeps(workspaceId: string): CoordinationFoldDeps {
    return { eventId: this.deps.eventId, now: this.deps.now, workspaceId };
  }

  async loadTyped<T>(ref: AggregateRef, aggregateType: string): Promise<T | null> {
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== 'found') return null;
    if (String(loaded.snapshot.ref.aggregateType) !== aggregateType) return null;
    return loaded.snapshot as unknown as T;
  }

  async routeIntentPlanFor(
    topic: string,
    _workspaceId: string,
    now: string,
    _projectId: string,
  ): Promise<RouteIntentPlanV1> {
    return {
      schemaVersion: 1,
      anchorEventType: topic,
      topic,
      subscriptionScope: [],
      scopeMode: 'canonical_active',
      plannedAt: now,
    };
  }
}

export function isTerminalIntentStatus(status: CommunicationIntentV1['status']): boolean {
  return status === 'done' || status === 'cancelled' || status === 'quarantined' || status === 'outcome_unknown';
}

export function workContextRefOfParticipation(ref: WorkParticipationRef): WorkContextRef {
  return {
    aggregateType: 'WorkContextBinding',
    projectId: ref.projectId,
    workspaceId: ref.workspaceId,
    workId: ref.workId,
  };
}

export function runLinkedInBinding(binding: WorkContextBindingSnapshot, runRef: RunSnapshot['ref']): boolean {
  const key = canonicalJson(runRef);
  if (canonicalJson(binding.binding.initialRunRef) === key) return true;
  return binding.binding.linkedRunRefs.some((linked) => canonicalJson(linked) === key);
}
