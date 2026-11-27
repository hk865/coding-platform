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
import type { QueryRunRef } from '../contracts/query-job.js';
import type { ActionRequestPort } from '../core/work-graph/model/action-request-contracts.js';
import type { SessionMailboxPort } from '../core/work-graph/model/communication-contracts.js';
import type { PlanProposal, PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type { QueryJobPort } from '../core/work-graph/queries/contracts.js';
import type { UnknownCallReviewReadPort } from '../core/work-graph/model/unknown-call-review-contracts.js';
import { plainSessionRefKey } from '../core/work-graph/sessions/session-record-codecs.js';
import { waitFactsOfRecord, waitStateOf } from '../core/work-graph/state/message-machine.js';
import { candidateReplyTargetOf, hostContextIn } from '../core/work-graph/tasks/plan-lineage.js';
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
  // 2.5: a dispatch request's receipt/approval/settlement, a claim hold's release and the dispatch counter's increment
  // all change whether this Goal's wait can advance; the goal loop's own waits name these same types.
  'DispatchCounter', 'ActionRequest', 'TaskClaimHold',
  // Node-level review (121-45): a node's review fact releases an `every_step` Goal's next node, and a TaskReduction
  // commit is when a node becomes pending (NR-17); both wake this queue, not the lifecycle one.
  'TaskNodeCommit', 'TaskReduction',
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
  /** Queue exactly this registered Goal for the next drain, without waiting for a commit cursor. */
  enqueue(goalRef: GoalRef): void;
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

    enqueue(goalRef) {
      const key = canonicalKey(goalRef);
      // A Goal with no registration has no wait to start: `register` is the caller's own step.
      if (registrations.has(key)) marked.add(key);
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
  /** The Goal's own pending restart interruption, read through its display; `ask`/`off` hold such a Goal. */
  held(ctx: CoreCallContext, goalRef: GoalRef): Promise<boolean>;
  /** The goal loop's candidate read (`createPlanReaders(...).planCandidates`); the same facts step 3b uses. */
  planCandidates: PlanReaders['planCandidates'];
  /** Every accepted candidate of one Goal (`createPlanReaders(...).acceptedCandidatesOf`). */
  acceptedCandidatesOf: PlanReaders['acceptedCandidatesOf'];
  /**
   * A12: the Goal's abandoned chain tails (`createPlanReaders(...).abandonedCandidateTailsOf`), whose M the goal
   * loop replies with the tail's Answer. Required: the rebuild always reads this arm; a failed read fails it.
   */
  abandonedCandidateTailsOf: PlanReaders['abandonedCandidateTailsOf'];
  /**
   * A12: the workspace's COMPLETED Goals (`createPlanReaders(...).completedGoalsOf`): one still owing an abandoned
   * chain's M is registered too, because its goal loop settles that reply before it reports completion. Required:
   * the rebuild always reads completed Goals; a failed read fails it.
   */
  completedGoalsOf: PlanReaders['completedGoalsOf'];
  /**
   * RSR-2 (P2 §2.5, frozen `:186`): one Goal's dispatch requests, read only for a Goal nothing else registers; one
   * with an `open` request is registered by the same restart rule.
   */
  actionRequests: Pick<ActionRequestPort, 'listOpenDispatches'>;
  /** The source-lineage reads (slice-PL-SPEC §6.3.1) the accepted-candidate arm walks the chain with. */
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  queries: Pick<QueryJobPort, 'readQueryJob'>;
  plans: Pick<PlanTaskPort, 'readPlanProposal'>;
  /** The existing `UnknownCallReview` read: an `unknown_call` round's formally carried Task is the named record's. */
  readReview?: UnknownCallReviewReadPort['readReview'];
};

/**
 * The restart composition: the two published halves that rebuild a fresh registry after a Host start.
 *
 * The wait half walks every Session of the scope (archived included) page by page and registers each
 * wait's own `originalRun.goalId` at the facts read's cursor; a wait with no Work Run is a secretary
 * round's, which R's reply round answers, so it wakes no Goal. The candidate half reads the goal loop's
 * own candidate facts and registers only the Goals
 * that still have something to continue: a pending candidate, an unanswered question group, a fully
 * answered group whose `planresume:` was never created, or an accepted candidate whose source message
 * is still an open wait, or an abandoned chain tail whose M is still an open wait with no reply (A12: the goal
 * loop replies it; a message may have no deadline, so an unregistered Goal would leave M unanswered for good),
 * or, with none of these, an `open` dispatch request (RSR-2, frozen P2 `:186`): so in `ask`/`off` a Goal no
 * interruption holds (one with only optional work) still claims its approved request once.
 * It never registers a Goal merely because it is active and writes no recovery
 * record. The candidate read skips cancelled and completed Goals and keeps paused ones, which the same rule
 * registers (their loop waits on the Goal until it is resumed); a required completed-Goal read below also
 * covers a completed Goal still owing an abandoned chain's M. All halves
 * may name the same Goal; `register` merges them, so it is woken once. A Goal with a pending restart
 * interruption is held, because in `ask`/`off` only a person continues it (decision 97-9). Every mode runs this
 * read-only rebuild at start; `off` only leaves the queue undrained until the workspace is armed. Three person
 * commands arm it and wake `goal_waits` at once (`armWorkspace`): a Goal resume, a ready `workflow/advance`, an
 * approved action-release card; a request command (request driver on) arms it but wakes only the request and
 * lifecycle queues, so `goal_waits` drains at its next subscribed commit. A Goal registered here starts its loop like
 * every restart registration, so
 * the loop's start retries its staged repairs and answered repairs first. A read that
 * is not `ready` is the failure, never an empty result, except one accepted or abandoned candidate's own reads
 * and one Goal's dispatch request read: that candidate or Goal cannot be judged this time, the others still are,
 * and the Goal is registered so its next pass (the goal loop's own recovery or selection) retries it.
 */
export function createGoalWaitRebuild(deps: GoalWaitRebuildDependencies):
  (scope: WorkspaceScope, registry: GoalWaitWakes) => Promise<void> {
  return async (scope, registry) => {
    const ctx = deps.ctx(scope);
    // The Goals this rebuild already registered from a Session wait: their dispatch requests are not read (Astra row 5).
    const sessionWaitGoals = new Set<string>();
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
          sessionWaitGoals.add(wait.originalRun.goalId);
        }
        afterSessionKey = plainSessionRefKey(card.record.ref);
      }
      if (page.value.nextCursor === null) break;
    }
    await rebuildCandidateWaits(ctx, scope, registry, sessionWaitGoals);
  };

  /**
   * The candidate half (§6.1.6). A Goal is registered only when one of its own facts still waits:
   * a pending candidate, a question group with an unanswered card, a fully answered group whose
   * continuation was never created, an accepted candidate whose expected executor message is an
   * open wait, an abandoned chain tail's open M (A12), or, read last and per Goal, an `open` dispatch request
   * (RSR-2). That one Goal's request read failing registers it (`open_dispatch_undetermined`), so it never fails
   * the rebuild of every other Goal; a Goal the wait half already registered is not read. `planCandidates`' own read
   * failure propagates like every other half's.
   */
  async function rebuildCandidateWaits(
    ctx: CoreCallContext, scope: WorkspaceScope, registry: GoalWaitWakes, sessionWaitGoals: ReadonlySet<string>,
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
      } else {
        const accepted = await acceptedCandidateWaitOf(ctx, goalRef);
        if (accepted !== 'none') {
          basis = { projectId: scope.projectId, goalId: goalRef.goalId, recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES,
            reasons: accepted === 'open' ? ['restart'] : ['restart', 'accepted_candidate_undetermined'] };
        } else {
          const abandoned = await abandonedCandidateWaitOf(ctx, goalRef);
          if (abandoned !== 'none') {
            basis = { projectId: scope.projectId, goalId: goalRef.goalId, recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES,
              reasons: abandoned === 'open' ? ['restart', 'abandoned_candidate_reply_open']
                : ['restart', 'abandoned_candidate_undetermined'] };
          }
        }
      }
      if (basis === null && !sessionWaitGoals.has(goalRef.goalId)) {
        const open = await deps.actionRequests.listOpenDispatches(ctx, { goalRef });
        if (open.status !== 'ready') {
          basis = { projectId: scope.projectId, goalId: goalRef.goalId, recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES,
            reasons: ['restart', 'open_dispatch_undetermined'] };
        } else if (open.value.some(entry => entry.request.state === 'open')) {
          basis = { projectId: scope.projectId, goalId: goalRef.goalId, recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES,
            reasons: ['restart'] };
        }
      }
      if (basis === null) continue;
      registry.register(basis, goal.readThrough!);
    }
    // A12: the candidate read above skips COMPLETED Goals; one still owing an abandoned chain's M is registered here,
    // by the same per-Goal judgment, so a restart cannot leave that M unanswered for good.
    const completed = await deps.completedGoalsOf(scope);
    if (completed.status !== 'ready') throw notReady('the completed-Goal read', completed);
    for (const goal of completed.value) {
      if (await deps.held(ctx, goal.goalRef)) continue;
      const abandoned = await abandonedCandidateWaitOf(ctx, goal.goalRef);
      if (abandoned === 'none') continue;
      registry.register({ projectId: scope.projectId, goalId: goal.goalRef.goalId,
        recordKinds: GOAL_WAIT_WAKE_AGGREGATE_TYPES,
        reasons: abandoned === 'open' ? ['restart', 'abandoned_candidate_reply_open']
          : ['restart', 'abandoned_candidate_undetermined'] }, goal.readThrough!);
    }
  }

  /**
   * (d): every accepted candidate of this Goal, not only the active Plan's version. Its planned executor
   * message is read through the Workflow's own `candidateReplyTargetOf`: the original deterministic
   * Query's `repliesToMessageRef` first, the §6.3.1 chain root only without one (a `planresume:` Query
   * froze that same `repliesToMessageRef ?? rootMessage` when it was created). `open`: one such message
   * is still an open wait. `undetermined`: none is open, but one candidate's own reads failed, so it
   * cannot be judged this time; the other candidates are still read (B3-03's rule for one candidate).
   */
  async function acceptedCandidateWaitOf(ctx: CoreCallContext, goalRef: GoalRef):
    Promise<'open' | 'none' | 'undetermined'> {
    const accepted = await deps.acceptedCandidatesOf(goalRef);
    if (accepted.status !== 'ready') throw notReady('the accepted-candidate read', accepted);
    return candidateReplyWaitOf(ctx, accepted.value);
  }

  /**
   * (e) A12: the Goal's abandoned chain tails, judged by the same per-candidate rule as (d). A failed list read is
   * the whole rebuild's failure; a candidate whose source could not be read makes the Goal `undetermined` when no
   * tail's M is found open, so the Goal is still registered.
   */
  async function abandonedCandidateWaitOf(ctx: CoreCallContext, goalRef: GoalRef):
    Promise<'open' | 'none' | 'undetermined'> {
    const abandoned = await deps.abandonedCandidateTailsOf(goalRef);
    if (abandoned.status !== 'ready') throw notReady('the abandoned-candidate read', abandoned);
    const found = await candidateReplyWaitOf(ctx, abandoned.value.tails);
    return found === 'none' && abandoned.value.incomplete.length > 0 ? 'undetermined' : found;
  }

  /**
   * One candidate list's planned executor messages, each read through `candidateReplyTargetOf`: `open` when one is
   * still an open wait with no reply, `undetermined` when none is but one candidate's own reads failed.
   */
  async function candidateReplyWaitOf(ctx: CoreCallContext, proposals: readonly PlanProposal[]):
    Promise<'open' | 'none' | 'undetermined'> {
    let undetermined = false;
    for (const proposal of proposals) {
      if (proposal.sourceMessageRef === null) continue;
      // `ctx` is the Goal's workspace, where its candidates and Queries live; each message is read where it lives.
      const waitRef = await candidateReplyTargetOf(ctx, deps, proposal.sourceMessageRef, proposal.sourcePart,
        proposal.ref.workspaceId);
      if (waitRef.status !== 'ready') { undetermined = true; continue; }
      const message = await deps.messages.readMessage(hostContextIn(ctx, waitRef.value.workspaceId), waitRef.value);
      if (message.status !== 'ready') { undetermined = true; continue; }
      if (message.value.response === null
        && waitStateOf(message.value, waitFactsOfRecord(message.value)).state === 'open') return 'open';
    }
    return undetermined ? 'undetermined' : 'none';
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
  /**
   * The restart composition: registers every open/answered/expired wait, and every Goal with a released (`open`)
   * dispatch request that no restart interruption holds.
   */
  rebuild(scope: WorkspaceScope, registry: GoalWaitWakes): Promise<void>;
  /**
   * 121-173: after a drain wakes a Goal, each of its nodes waiting for the person gets the secretary's draft of its
   * note, asked once per node, by `ensureDrafts` (the wake loop's pass only). Each Goal on its own (NR-B 8): one that
   * throws stays owed and the others go on; the first throw then goes to that pass's failure path.
   */
  ensureNodeReviewDrafts?(scope: WorkspaceScope, goalRef: GoalRef): Promise<void>;
};

export type WaitingCallV1 =
  | { kind: 'goal'; goalRef: GoalRef; startCursor: CommitCursor }
  | { kind: 'query'; queryRunRef: QueryRunRef; startCursor: CommitCursor };
type AdmissionCandidateV1 = WaitingCallV1 & { priority: 0 | 1 | 2 };
const admissionOrder = (left: AdmissionCandidateV1, right: AdmissionCandidateV1): number =>
  left.priority - right.priority || compareCursors(left.startCursor, right.startCursor);

export function createGoalWaitQueue(deps: GoalWaitQueueDependencies):
  QueueHandler & { settle(): Promise<void>; ensureDrafts(scope: WorkspaceScope): Promise<void> } {
  /** Scope keys whose rebuild has not finished; a failed rebuild stays for the loop's retry pass. */
  const unbuilt = new Set<string>();
  /** Each marker Query's launched start, keyed by its QueryRun; `settle()` waits for them. */
  const inFlight = new Map<string, Promise<void>>();
  /** A marker Query dispatched since its project's last commit (QueryRun key → projectId); it is not
   *  dispatched again before the next commit, so a refused page never re-runs at once. */
  const tried = new Map<string, string>();
  /** After `settle()` the Host is closing: nothing new is launched. */
  let closed = false;
  /** NR-B 8: per scope, the woken Goals whose node drafts are still owed. A Goal leaves only when its drafts are done,
   *  so a failed one is tried again by the next drain without being woken again. Each wake gives the Goal a new mark
   *  (NR-B r2-5): a drain removes it only when the mark it worked from is still the Goal's, so a drain that started
   *  earlier never clears a later wake's drafts. */
  const draftsDue = new Map<string, Map<string, { goalRef: GoalRef; mark: number }>>();
  let lastDraftMark = 0;
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
      // Every drain only records the woken Goals' drafts as owed; `ensureDrafts` asks them.
      const due = draftsDue.get(canonicalKey(scope)) ?? new Map<string, { goalRef: GoalRef; mark: number }>();
      draftsDue.set(canonicalKey(scope), due);
      for (const goalRef of startedGoals) {
        lastDraftMark += 1;
        due.set(canonicalKey(goalRef), { goalRef, mark: lastDraftMark });
      }
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

    async ensureDrafts(scope) {
      const due = draftsDue.get(canonicalKey(scope));
      if (deps.ensureNodeReviewDrafts === undefined || due === undefined) return;
      let failure: unknown = null;
      for (const [key, { goalRef, mark }] of [...due]) {
        try {
          await deps.ensureNodeReviewDrafts(scope, goalRef);
          if (due.get(key)?.mark === mark) due.delete(key);
        } catch (thrown) {
          failure ??= thrown;
        }
      }
      if (failure !== null) throw failure;
    },

    async settle() {
      closed = true;
      // Never throws: allSettled absorbs every result; a launch that settles during the wait is waited for too.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
    },
  };
}
