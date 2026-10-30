/**
 * The goal-wait registry and the `goal_waits` queue handler.
 *
 * A goal's wait is registered once, with the record kinds it waits on and the commit cursor its facts
 * were read at. A commit notice raises a per-(project, kind) high-water cursor and marks every goal of
 * that project whose read is behind, so a pass re-reads the goal through the Workflow's one advance
 * instead of a second wait read.
 *
 * The queue handler is the loop's adapter over one registry per workspace scope. The Host creates the
 * registries and gives the same instances to this handler and to the driver; the handler never owns a
 * registry of its own. A drain is one bounded page, and the loop's `more` starts the next page at once.
 */
import type { GoalWaitBasisV1 } from '../business/workflow/contracts.js';
import type { RecordCommitNotice } from '../composition/commit-observer.js';
import type { CommitCursor } from '../contracts/command-event.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { WorkspaceScope } from '../contracts/core/identity.js';
import { canonicalKey } from '../contracts/fingerprint.js';
import { compareCursors, type AggregateRef, type GoalRef } from '../contracts/ledger.js';
import type { MessageReleasedActionsPort } from '../core/work-graph/model/decision-contracts.js';
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import { plainSessionRefKey } from '../core/work-graph/sessions/session-record-codecs.js';
import { notReady, type QueueHandler } from './wake-loop.js';

export const GOAL_WAITS_QUEUE = 'goal_waits';
/** The queue's own page budget. */
export const WAKE_LIMIT = 16;

/** The aggregate types whose commit can change a goal's wait. */
export const GOAL_WAIT_WAKE_AGGREGATE_TYPES: readonly AggregateRef['aggregateType'][] = Object.freeze([
  'SessionMessage', 'VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'PlanRevision', 'PlanProposal',
  'TaskLease', 'DispatchOutboxEntry', 'Run', 'Goal', 'Session',
]);

type GoalWaitRegistrationV1 = {
  goalRef: GoalRef;
  recordKinds: ReadonlySet<string>;
  cursorAtRead: CommitCursor;
};

/** One instance per workspace scope, created by the Host; the loop handler and the driver share that same instance. */
export type GoalWaitWakes = {
  register(basis: GoalWaitBasisV1, cursorAtRead: CommitCursor): void;
  leave(goalRef: GoalRef): void;
  onCommitted(notice: RecordCommitNotice): void;
  /** The next bounded drain candidates, goal-key order; the caller re-reads each goal's facts. */
  nextDrainBatch(limit: number): { goals: readonly GoalRef[]; more: boolean };
  /** A start-up registration is queued at once (nothing was "seen" in this fresh registry). */
  queueAll(): void;
};

export function createGoalWaitWakes(): GoalWaitWakes {
  /** One registration per goal, keyed by `canonicalKey(goalRef)`. */
  const registrations = new Map<string, GoalWaitRegistrationV1>();
  /** The highest commit cursor seen per (project, kind). */
  const seen = new Map<string, CommitCursor>();
  /** Registrations whose read is behind a seen cursor. */
  const marked = new Set<string>();

  const seenKey = (projectId: string, kind: string): string => `${projectId}\u0000${kind}`;

  /** Mark when any of the goal's kinds has a seen cursor past its read. */
  function markIfPast(key: string, registration: GoalWaitRegistrationV1): void {
    for (const kind of registration.recordKinds) {
      const cursor = seen.get(seenKey(registration.goalRef.projectId, kind));
      if (cursor !== undefined && compareCursors(cursor, registration.cursorAtRead) > 0) {
        marked.add(key);
        return;
      }
    }
  }

  /** Raise the (project, kind) high-water and answer the raised value; an older notice never lowers it. */
  function raise(projectId: string, kind: string, cursor: CommitCursor): CommitCursor {
    const key = seenKey(projectId, kind);
    const current = seen.get(key);
    if (current === undefined || compareCursors(cursor, current) > 0) seen.set(key, cursor);
    return seen.get(key)!;
  }

  return {
    register(basis, cursorAtRead) {
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: basis.projectId, goalId: basis.goalId };
      const key = canonicalKey(goalRef);
      const existing = registrations.get(key);
      const recordKinds = new Set(existing?.recordKinds);
      for (const kind of basis.recordKinds) recordKinds.add(kind);
      const earlier = existing !== undefined && compareCursors(existing.cursorAtRead, cursorAtRead) <= 0
        ? existing.cursorAtRead : cursorAtRead;
      const registration: GoalWaitRegistrationV1 = { goalRef, recordKinds, cursorAtRead: earlier };
      registrations.set(key, registration);
      markIfPast(key, registration);
    },

    leave(goalRef) {
      const key = canonicalKey(goalRef);
      registrations.delete(key);
      marked.delete(key);
    },

    onCommitted(notice) {
      for (const aggregate of notice.aggregates) {
        if (aggregate.projectId === null) continue;
        const cursor = raise(aggregate.projectId, aggregate.aggregateType, notice.cursor);
        for (const [key, registration] of registrations) {
          if (registration.goalRef.projectId !== aggregate.projectId) continue;
          if (!registration.recordKinds.has(aggregate.aggregateType)) continue;
          if (compareCursors(cursor, registration.cursorAtRead) > 0) marked.add(key);
        }
      }
    },

    nextDrainBatch(limit) {
      const keys = [...marked].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
      const taken = keys.slice(0, limit);
      for (const key of taken) marked.delete(key);
      return {
        goals: taken.map(key => registrations.get(key)!.goalRef),
        more: marked.size > 0,
      };
    },

    queueAll() {
      for (const key of registrations.keys()) marked.add(key);
    },
  };
}

/** The Host's one registry per workspace scope; the adapter and the driver hold the same instances. */
export type GoalWaitRegistries = {
  /** Every scope and its registry, in start order; one instance per scope, never forked. */
  all(): readonly { scope: WorkspaceScope; waits: GoalWaitWakes }[];
};

export type GoalWaitRebuildDependencies = {
  /** The Host's own trusted context for the scope; every read below runs as the Host. */
  ctx(scope: WorkspaceScope): CoreCallContext;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  facts: Pick<SessionFactsPort, 'readSessionFacts'>;
  released: Pick<MessageReleasedActionsPort, 'readReleasedActions'>;
  /** The Goal's own pending restart interruption, read through its display; `ask`/`off` hold such a Goal. */
  held(ctx: CoreCallContext, goalRef: GoalRef): Promise<boolean>;
};

/**
 * The restart composition: the two published reads that rebuild a fresh registry after a Host start.
 *
 * The wait half walks every Session of the scope (archived included) page by page and registers each
 * wait's own `originalRun.goalId` at the facts read's cursor; a wait with no Work Run is a secretary
 * round's, which R's reply round answers, so it wakes no Goal. The released half walks 7A's released,
 * unprocessed action requests page by page and registers each page's Goals at that page's read-through
 * cursor. Both halves may name the same Goal; `register` merges them, so it is woken once. A Goal with a
 * pending restart interruption is held, because in `ask`/`off` only a person continues it (decision 97-9).
 * A read that is not `ready` is the failure, never an empty result.
 */
export function createGoalWaitRebuild(deps: GoalWaitRebuildDependencies):
  (scope: WorkspaceScope, registry: GoalWaitWakes) => Promise<void> {
  return async (scope, registry) => {
    const ctx = deps.ctx(scope);
    let afterSessionKey: string | null = null;
    for (;;) {
      const page = await deps.sessions.findSessions(ctx, {
        workspace: scope, includeArchived: true,
        page: { limit: 200, ...(afterSessionKey === null ? {} : { afterSessionKey }) },
      });
      if (page.status !== 'ready') throw notReady('the Session directory read', page);
      for (const card of page.value.items) {
        const facts = await deps.facts.readSessionFacts(ctx, card.record.ref);
        if (facts.status !== 'ready') {
          throw notReady(`the Session facts of ${card.record.ref.sessionId}`, facts);
        }
        for (const wait of facts.value.waits) {
          if (wait.originalRun === null) continue;
          if (await deps.held(ctx, { aggregateType: 'Goal', projectId: scope.projectId, goalId: wait.originalRun.goalId })) continue;
          registry.register({
            projectId: scope.projectId, goalId: wait.originalRun.goalId,
            recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['restart'],
          }, facts.value.sourceCursor);
        }
        afterSessionKey = plainSessionRefKey(card.record.ref);
      }
      if (page.value.nextCursor === null) break;
    }
    let after: string | null = null;
    do {
      const page = await deps.released.readReleasedActions(ctx, { scope, after, limit: 100 });
      if (page.status !== 'ready') throw notReady('the released-action read', page);
      for (const goal of page.value.goals) {
        if (await deps.held(ctx, { aggregateType: 'Goal', projectId: scope.projectId, goalId: goal.goalId })) continue;
        registry.register({
          projectId: scope.projectId, goalId: goal.goalId,
          recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['released_action'],
        }, page.value.readThrough);
      }
      after = page.value.nextCursor;
    } while (after !== null);
  };
}

export type GoalWaitQueueDependencies = {
  /** The Workflow's one advance for a goal: no model call, no content. */
  wake(scope: WorkspaceScope, goalRef: GoalRef): Promise<void>;
  /** The Host's one registry per workspace scope: this adapter drains it and the driver registers into the same instances. */
  registries: GoalWaitRegistries;
  /** The restart composition: registers every open/answered/expired wait and every released action. */
  rebuild(scope: WorkspaceScope, registry: GoalWaitWakes): Promise<void>;
};

export function createGoalWaitQueue(deps: GoalWaitQueueDependencies): QueueHandler {
  /** Scope keys whose rebuild has not finished; a failed rebuild stays for the loop's retry pass. */
  const unbuilt = new Set<string>();
  /** The scope's one registry; the Host creates it before registering this queue. */
  function registryFor(scope: WorkspaceScope): GoalWaitWakes {
    const entry = deps.registries.all().find(candidate =>
      candidate.scope.projectId === scope.projectId && candidate.scope.workspaceId === scope.workspaceId)!;
    return entry.waits;
  }

  async function build(scope: WorkspaceScope): Promise<void> {
    const key = canonicalKey(scope);
    unbuilt.add(key);
    const waits = registryFor(scope);
    await deps.rebuild(scope, waits);
    waits.queueAll();
    unbuilt.delete(key);
  }

  return {
    rebuild: build,

    async drain(scope, input) {
      if (unbuilt.has(canonicalKey(scope))) await build(scope);
      const waits = registryFor(scope);
      const { goals, more } = waits.nextDrainBatch(input.maxItems);
      for (const goal of goals) await deps.wake(scope, goal);
      return { progressed: goals.length, more, continuation: null, wrapped: false, blocked: 0 };
    },

    onCommitted(notice) {
      for (const entry of deps.registries.all()) {
        if (notice.aggregates.some(aggregate => aggregate.projectId === entry.scope.projectId)) {
          entry.waits.onCommitted(notice);
        }
      }
    },
  };
}
