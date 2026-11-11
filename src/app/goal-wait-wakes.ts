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
import type { ReadResult } from '../contracts/core/results.js';
import { compareCursors, type AggregateRef, type GoalRef } from '../contracts/ledger.js';
import { interventionPlanningQueryRefs, type QueryRunRef } from '../contracts/query-job.js';
import type { SessionMailboxPort } from '../core/work-graph/model/communication-contracts.js';
import type { MessageReleasedActionsPort } from '../core/work-graph/model/decision-contracts.js';
import type { PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type { QueryJobPort } from '../core/work-graph/queries/contracts.js';
import { plainSessionRefKey } from '../core/work-graph/sessions/session-record-codecs.js';
import { waitFactsOfRecord, waitStateOf } from '../core/work-graph/state/message-machine.js';
import { planSourceLineageOf } from '../core/work-graph/tasks/plan-lineage.js';
import type { PlanReaders } from '../core/work-graph/tasks/plan-readers.js';
import { notReady, type QueueHandler } from './wake-loop.js';

export const GOAL_WAITS_QUEUE = 'goal_waits';
/** The queue's own page budget. */
export const WAKE_LIMIT = 16;

/** The aggregate types whose commit can change a goal's wait. */
export const GOAL_WAIT_WAKE_AGGREGATE_TYPES: readonly AggregateRef['aggregateType'][] = Object.freeze([
  'SessionMessage', 'VerificationRound', 'Evidence', 'TaskEvidenceIndex', 'PlanRevision', 'PlanProposal',
  'TaskLease', 'DispatchOutboxEntry', 'Run', 'Goal', 'Session', 'TaskRequeue', 'UnknownCallReview',
  // A claim's Workspace pin (`claim-service.ts`): a claim that conflicted on it waits for its next write.
  'Workspace',
  'CoreOperation',
  'NoteHead',
  'NoteVersion', 'CurrentPointer', 'ModuleOverlapGate',
]);

/** One marked Goal wait with its read cursor (frozen drain shape; no slice, no removal). */
export type GoalWaitCandidateV1 = { goalRef: GoalRef; cursorAtRead: CommitCursor };

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
  /** Every marked Goal wait with its read cursor, goal-key order; no slice, no removal. */
  nextDrainBatch(): readonly GoalWaitCandidateV1[];
  /** Remove exactly the Goals this page started; every unstarted Goal stays marked for the next page. */
  takeDrainBatch(goalRefs: readonly GoalRef[]): void;
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

    nextDrainBatch() {
      return [...marked].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map(key => ({ goalRef: registrations.get(key)!.goalRef,
          cursorAtRead: registrations.get(key)!.cursorAtRead }));
    },

    takeDrainBatch(goalRefs) {
      for (const goalRef of goalRefs) marked.delete(canonicalKey(goalRef));
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
  /** The goal loop's candidate read (`createPlanReaders(...).planCandidates`); the same facts step 3b uses. */
  planCandidates: PlanReaders['planCandidates'];
  /** Every accepted candidate of one Goal (`createPlanReaders(...).acceptedCandidatesOf`). */
  acceptedCandidatesOf: PlanReaders['acceptedCandidatesOf'];
  /** The source-lineage reads (slice-PL-SPEC §6.3.1) the accepted-candidate arm walks the chain with. */
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
};

/**
 * The restart composition: the three published reads that rebuild a fresh registry after a Host start.
 *
 * The wait half walks every Session of the scope (archived included) page by page and registers each
 * wait's own `originalRun.goalId` at the facts read's cursor; a wait with no Work Run is a secretary
 * round's, which R's reply round answers, so it wakes no Goal. The released half walks 7A's released,
 * unprocessed action requests page by page and registers each page's Goals at that page's read-through
 * cursor. The candidate half reads the goal loop's own candidate facts and registers only the Goals
 * that still have something to continue: a pending candidate, an unanswered question group, a fully
 * answered group whose `planresume:` was never created, or an accepted candidate whose source message
 * is still an open wait. It never registers a Goal merely because it is active, writes no recovery
 * record, and does not read completed/cancelled Goals (the read returns active ones only). All halves
 * may name the same Goal; `register` merges them, so it is woken once. A Goal with a pending restart
 * interruption is held, because in `ask`/`off` only a person continues it (decision 97-9). A read that
 * is not `ready` is the failure, never an empty result.
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
    await rebuildCandidateWaits(ctx, scope, registry);
  };

  /**
   * The candidate half (§6.1.6). A Goal is registered only when one of its own facts still waits:
   * a pending candidate, a question group with an unanswered card, a fully answered group whose
   * continuation was never created, or an accepted candidate whose expected executor message is an
   * open wait. `planCandidates`' own read failure propagates like every other half's.
   */
  async function rebuildCandidateWaits(
    ctx: CoreCallContext, scope: WorkspaceScope, registry: GoalWaitWakes,
  ): Promise<void> {
    const read = await deps.planCandidates(scope, ctx);
    if (read.status !== 'ready') throw notReady('the planning-candidate read', read);
    for (const goal of read.value.goals) {
      const goalRef = goal.goalRef;
      if (await deps.held(ctx, goalRef)) continue;
      let basis: GoalWaitBasisV1 | null = null;
      if (goal.pending !== null) {
        basis = { projectId: scope.projectId, goalId: goalRef.goalId,
          recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['restart'] };
      } else if (goal.questionGroups.some(group => !group.allAnswered)) {
        basis = { projectId: scope.projectId, goalId: goalRef.goalId,
          recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['restart'] };
      } else if (goal.questionGroups.some(group => group.allAnswered && !group.resumeMessageExists)) {
        basis = { projectId: scope.projectId, goalId: goalRef.goalId,
          recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['restart'] };
      } else if (await hasUnansweredAcceptedCandidate(ctx, goalRef)) {
        basis = { projectId: scope.projectId, goalId: goalRef.goalId,
          recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES, reasons: ['restart'] };
      }
      if (basis === null) continue;
      registry.register(basis, goal.readThrough!);
    }
  }

  /**
   * (d): every accepted candidate of this Goal, not only the active Plan's version. The candidate's
   * source is the start of the §6.3.1 chain; its planned executor message is the original
   * deterministic Query's `repliesToMessageRef`, else the chain root (a `planresume:` Query froze
   * that same `repliesToMessageRef ?? rootMessage` when it was created).
   */
  async function hasUnansweredAcceptedCandidate(ctx: CoreCallContext, goalRef: GoalRef): Promise<boolean> {
    const accepted = await deps.acceptedCandidatesOf(goalRef);
    if (accepted.status !== 'ready') throw notReady('the accepted-candidate read', accepted);
    for (const proposal of accepted.value) {
      if (proposal.sourceMessageRef === null) continue;
      const lineage = await planSourceLineageOf(ctx, deps, proposal.sourceMessageRef);
      if (lineage.status !== 'ready') throw notReady('the accepted candidate source lineage', lineage);
      const query = await deps.queries.readQueryJob(ctx,
        interventionPlanningQueryRefs(proposal.sourceMessageRef).queryJobRef);
      if (query.status !== 'ready') throw notReady('the accepted candidate planning Query', query);
      const message = await deps.messages.readMessage(ctx,
        query.value.job.job.intent.execution.repliesToMessageRef ?? lineage.value.rootMessage);
      if (message.status !== 'ready') throw notReady('the accepted candidate wait message', message);
      if (message.value.response === null
        && waitStateOf(message.value, waitFactsOfRecord(message.value)).state === 'open') return true;
    }
    return false;
  }
}

/** One marker Query kept at `prepared` + `running_cap`, with the cursor its record was read at. */
export type MarkerQueryCandidateV1 = { queryRunRef: QueryRunRef; startCursor: CommitCursor };

export type GoalWaitQueueDependencies = {
  /** The Workflow's one advance for a goal: no model call, no content. */
  wake(scope: WorkspaceScope, goalRef: GoalRef): Promise<void>;
  /** The Host's one registry per workspace scope: this adapter drains it and the driver registers into the same instances. */
  registries: GoalWaitRegistries;
  /** The Host's own trusted context for the scope; every read below runs as the Host. */
  ctx(scope: WorkspaceScope): CoreCallContext;
  /** One Session page's marker Queries, read at the drain's own cursor; a non-ready read is the failure. */
  readMarkerQueries(ctx: CoreCallContext, scope: WorkspaceScope, cursor: string | null):
    Promise<ReadResult<{ items: readonly MarkerQueryCandidateV1[]; nextCursor: string | null }>>;
  /** One marker Query's original driver, started under the pass's signal and never awaited here. */
  startMarkerQuery(ctx: CoreCallContext, candidate: MarkerQueryCandidateV1): Promise<void>;
  /** `0` person, `1` yielded reply/expiry, `2` agent send; read with the waiting call's own facts, no new field. */
  l5PriorityOf(ctx: CoreCallContext, call: WaitingCallV1): Promise<0 | 1 | 2>;
  /** The restart composition: registers every open/answered/expired wait and every released action. */
  rebuild(scope: WorkspaceScope, registry: GoalWaitWakes): Promise<void>;
};

export type WaitingCallV1 =
  | { kind: 'goal'; goalRef: GoalRef; startCursor: CommitCursor }
  | { kind: 'query'; queryRunRef: QueryRunRef; startCursor: CommitCursor };
type AdmissionCandidateV1 = WaitingCallV1 & { priority: 0 | 1 | 2 };
const admissionOrder = (left: AdmissionCandidateV1, right: AdmissionCandidateV1): number =>
  left.priority - right.priority || compareCursors(left.startCursor, right.startCursor);

export function createGoalWaitQueue(deps: GoalWaitQueueDependencies): QueueHandler & { settle(): Promise<void> } {
  /** Scope keys whose rebuild has not finished; a failed rebuild stays for the loop's retry pass. */
  const unbuilt = new Set<string>();
  /** Each marker Query's launched start, keyed by its QueryRun; `settle()` waits for them. */
  const inFlight = new Map<string, Promise<void>>();
  /** A marker Query dispatched since its project's last commit (QueryRun key → projectId); it is not
   *  dispatched again before the next commit, so a refused page never re-runs at once. */
  const tried = new Map<string, string>();
  /** After `settle()` the Host is closing: nothing new is launched. */
  let closed = false;
  /** The scope's one registry; the Host creates it before registering this queue. */
  function registryFor(scope: WorkspaceScope): GoalWaitWakes {
    const entry = deps.registries.all().find(candidate =>
      candidate.scope.projectId === scope.projectId && candidate.scope.workspaceId === scope.workspaceId)!;
    return entry.waits;
  }

  /** One marker Query's original driver, launched and never awaited here; the entry leaves when it settles. */
  function launch(ctx: CoreCallContext, candidate: MarkerQueryCandidateV1): void {
    const key = canonicalKey(candidate.queryRunRef);
    tried.set(key, candidate.queryRunRef.projectId);
    if (closed || inFlight.has(key)) return;
    let settled: () => void = () => undefined;
    inFlight.set(key, new Promise<void>(resolve => { settled = resolve; }));
    void (async () => {
      try {
        await deps.startMarkerQuery(ctx, candidate);
      } catch {
        // A throw keeps the persisted marker: the next commit dispatches it again.
      }
      inFlight.delete(key);
      settled();
    })();
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
      // A closing Host starts nothing; the markers and the Goal marks stay.
      if (closed || input.signal.aborted) {
        return { progressed: 0, more: false, continuation: input.continuation, wrapped: false, blocked: 0 };
      }
      if (unbuilt.has(canonicalKey(scope))) await build(scope);
      const waits = registryFor(scope);
      // The launched start runs under the pass's signal, so the Host close aborts it.
      const ctx: CoreCallContext = { ...deps.ctx(scope), signal: input.signal };
      const markers = await deps.readMarkerQueries(ctx, scope, input.continuation);
      if (markers.status !== 'ready') throw notReady('the marker Query page', markers);
      const candidates: AdmissionCandidateV1[] = [];
      for (const goal of waits.nextDrainBatch()) {
        const call: WaitingCallV1 = { kind: 'goal', goalRef: goal.goalRef, startCursor: goal.cursorAtRead };
        candidates.push({ ...call, priority: await deps.l5PriorityOf(ctx, call) });
      }
      for (const marker of markers.value.items) {
        if (tried.has(canonicalKey(marker.queryRunRef))) continue;    // waits for the next commit
        const call: WaitingCallV1 = { kind: 'query', queryRunRef: marker.queryRunRef, startCursor: marker.startCursor };
        candidates.push({ ...call, priority: await deps.l5PriorityOf(ctx, call) });
      }
      candidates.sort(admissionOrder);
      const page = candidates.slice(0, input.maxItems);
      const startedGoals: GoalRef[] = [];
      for (const candidate of page) {
        if (candidate.kind === 'goal') {
          await deps.wake(scope, candidate.goalRef);                  // queues the driver only
          startedGoals.push(candidate.goalRef);
        } else {
          launch(ctx, candidate);                                      // dispatched in (L5, startCursor) order, not awaited
        }
      }
      waits.takeDrainBatch(startedGoals);
      const pendingOnPage = candidates.length > page.length;
      return {
        progressed: page.length,
        more: pendingOnPage || markers.value.nextCursor !== null,
        continuation: pendingOnPage ? input.continuation : markers.value.nextCursor,
        wrapped: false, blocked: 0,
      };
    },

    onCommitted(notice) {
      // A commit of the project lets its tried marker Queries be dispatched again, as a commit re-marks a Goal.
      for (const aggregate of notice.aggregates) {
        if (aggregate.projectId === null) continue;
        for (const [key, projectId] of tried) if (projectId === aggregate.projectId) tried.delete(key);
      }
      for (const entry of deps.registries.all()) {
        if (notice.aggregates.some(aggregate => aggregate.projectId === entry.scope.projectId)) {
          entry.waits.onCommitted(notice);
        }
      }
    },

    async settle() {
      closed = true;
      // Never throws: allSettled absorbs every result; a launch that settles during the wait is waited for too.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
    },
  };
}
