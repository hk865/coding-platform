/**
 * Workflow's request commands and the drain.
 *
 * `submit` is the one command that needs both a pick and a line creation:
 * `W/tasks/request-service.ts` owns the round, the receipt, the tail and the
 * intake commit path, but a new line is `business/workflow/line-creation.ts`,
 * which WorkGraph cannot import. So this file decides who gets the new round
 * through the service's one assignment-row function, reads the selection facts,
 * retries a fresh pick on an intake / Session-revision conflict, calls
 * `ensureLine` when no candidate remains, and hands the service a
 * `RequestPlanV1`. `route`, `selectIdea` and `ask` need no line of their own
 * and go through the same service port; `selectIdea` and `ask` append a
 * follow-up that may still need a pick (a waiting or dropped request).
 *
 * The drain (`drainUnassigned`) visits `s6-query-unassigned` in order, re-reads
 * each request, skips it unless it still reads `waiting` / `owner_archived`,
 * picks (or creates a line with the drain's stable identity) and asks the
 * service's internal `assigned` append to write the routing round.
 *
 * Ordering that matters:
 * - `precheck` runs first, before any pick or line, and a stored receipt wins;
 * - a retried submit (no receipt yet) asks `findLine` BEFORE it picks, so a line
 *   created before a crash is replayed, never created twice; the plan guard is
 *   the Session's current revision read through the real Session facts;
 * - one command spends at most `SECRETARY_PICK_RETRIES` retries in total: a
 *   no-pick plan the request facts made stale re-runs precheck and the plan,
 *   and a fresh pick's conflict re-picks without the conflicted Session, both
 *   from the same budget; an `@` recipient is never re-picked (its conflict is
 *   the service's `busy`);
 * - a profile or line read that does not answer `ready` is `unavailable`: only
 *   a ready "no profile" is `no_secretary_binding` and only a ready "no line"
 *   lets the pick run;
 * - a read failure in the drain is an explicit `unavailable`, never `blocked`;
 * - `wake(..., 'request_command')` runs only after a commit returns, never on
 *   a replay.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { VersionedRef } from '../../contracts/ledger.js';
import type { QueryJobRef } from '../../contracts/query-job.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type {
  RequestCoreViewV1, SecretaryProfilePort, SecretaryProfileV1, SecretarySelectionFactsV1,
} from '../../core/work-graph/model/request-contracts.js';
import { REQUEST_DRAINED_PER_PASS, SECRETARY_PICK_RETRIES } from '../../core/work-graph/model/request-contracts.js';
import type { SessionFactsPort, SessionFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import type { RequestRoundsFactsV1 } from '../../core/work-graph/queries/request-rounds-read.js';
import { oldestPendingRound } from '../../core/work-graph/queries/request-rounds-read.js';
import { plainSessionRefToAggregate } from '../../core/work-graph/sessions/session-record-codecs.js';
import type {
  RequestAppendResultV1, RequestFactsReader, RequestPlanV1, RequestPublicCommandV1, RequestRejectionV1,
  RequestRoundPort,
} from '../../core/work-graph/tasks/request-service.js';
import { requestAssignmentRow, workspaceOf } from '../../core/work-graph/tasks/request-service.js';
import { orderCandidates, type SecretarySelectionPort } from '../../core/work-graph/tasks/secretary-selection.js';
import type { LineCreationInput, LineCreationPort, LineCreationResultV1 } from './line-creation.js';

// ------------------------------------------------------------------------ //
// The public port (spec §2's shapes)                                        //
// ------------------------------------------------------------------------ //

export type RequestSubmitResultV1 =
  | { status: 'queued'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'assigned';
      secretary: SessionRef; created: boolean; waitReason: null }
  | { status: 'queued'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'unassigned';
      secretary: null; created: false; waitReason: 'secretary_open_cap' }
  | RequestRejectionV1;

export type RequestRouteResultV1 = { status: 'routed'; routingRound: QueryJobRef } | RequestRejectionV1;

export type RequestSelectIdeaResultV1 = { status: 'queued'; followupRound: QueryJobRef } | RequestRejectionV1;

/** `ask` queues a follow-up exactly as `selectIdea` does. */
export type RequestAskResultV1 = { status: 'queued'; followupRound: QueryJobRef } | RequestRejectionV1;

export type DrainUnassignedResultV1 = {
  progressed: number;
  more: boolean;
  continuation: string | null;
  wrapped: boolean;
  blocked: number;
};

export interface RequestSubmitPort {
  submitRequest(ctx: CoreCallContext, input: {
    commandId: string; goalId: string | null; text: string;
    continues: QueryJobRef | null; recipient: SessionRef | null;
  }): Promise<RequestSubmitResultV1>;
  route(ctx: CoreCallContext, input: {
    commandId: string; round: QueryJobRef; to: SessionRef | null;
    reason: 'manual' | 'dropped';
  }): Promise<RequestRouteResultV1>;
  selectIdea(ctx: CoreCallContext, input: {
    commandId: string; round: QueryJobRef; index: number;
  }): Promise<RequestSelectIdeaResultV1>;
  /**
   * A card question or a candidate's regeneration on the request of `round`
   * (slice-6 spec L6): a follow-up carrying the card's refs.
   */
  ask(ctx: CoreCallContext, input: {
    commandId: string; round: QueryJobRef; cardRefs: VersionedRef[]; regenerate: boolean; text: string;
  }): Promise<RequestAskResultV1>;
}

export type DrainReadResultV1 = ReadResult<DrainUnassignedResultV1>;

export interface RequestIntakePort extends RequestSubmitPort {
  /** `rounds.unassigned` is the named read: oldest first, one request per waiting episode. */
  drainUnassigned(ctx: CoreCallContext, scope: WorkspaceScope, input: {
    maxRequests: number; continuation: string | null;
  }): Promise<DrainReadResultV1>;
}

/** The request owners this Workflow drives, injected by the composition root. */
export type RequestIntakeDependencies = {
  rounds: RequestRoundPort;
  facts: RequestFactsReader;
  selection: SecretarySelectionPort;
  lineCreation: LineCreationPort;
  profiles: SecretaryProfilePort;
  /** The trusted Session facts read the replayed line's current guard comes from. */
  sessionFacts: Pick<SessionFactsPort, 'readSessionFacts'>;
  wake?: (scope: WorkspaceScope, source: 'request_command') => void;
};

const WAITING_PLAN: RequestPlanV1 = { assignTo: null, createdLine: false, capacityBlocked: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refusal(code: RequestRejectionV1['code'], reason: string): RequestRejectionV1 {
  return { status: 'rejected', code, reason };
}

function unavailable(reason: string): RequestRejectionV1 {
  return refusal('unavailable', reason);
}

function isRefusal(value: { status: string }): value is RequestRejectionV1 {
  return value.status === 'rejected';
}

/** The two line outcomes that leave a request waiting for a later drain; every other refusal is a failure. */
function blockedReason(rejection: RequestRejectionV1): boolean {
  return rejection.reason === 'no_secretary_binding' || rejection.reason === 'line_pending';
}

function versionedRefOf(session: SessionRef, revision: number): VersionedRef {
  return { ref: plainSessionRefToAggregate(session), revision };
}

function mapLineRejection(line: Extract<LineCreationResultV1, { status: 'rejected' }>): RequestRejectionV1 {
  const code = line.code;
  if (code === 'invalid' || code === 'forbidden' || code === 'unavailable' || code === 'busy'
    || code === 'not_found' || code === 'revision_conflict' || code === 'idempotency_conflict') {
    return refusal(code, line.reason);
  }
  return unavailable(line.reason);
}

/** The oldest pending non-routing round: the one rule the request service also uses. */
function oldestPending(facts: RequestRoundsFactsV1): QueryJobRef | null {
  const oldest = oldestPendingRound(facts);
  return oldest === null ? null : { ...oldest.ref };
}

function rootKey(root: QueryJobRef): string {
  return canonicalJson(root as unknown as JsonValue);
}

function pickPlanOf(candidate: { session: SessionRef; revision: number }): RequestPlanV1 {
  return {
    assignTo: { session: { ...candidate.session }, guard: versionedRefOf(candidate.session, candidate.revision), fresh: true },
    createdLine: false,
    capacityBlocked: false,
  };
}

/**
 * The retries one command may still spend. Re-planning a stale no-pick plan and
 * re-picking after a fresh pick's conflict draw on the same budget, so a
 * request whose facts keep changing cannot multiply its picks.
 */
type PickBudget = { left: number };

export function createRequestIntake(deps: RequestIntakeDependencies): RequestIntakePort {
  // ---------------------------------------------------------------------- //
  // A new line                                                             //
  // ---------------------------------------------------------------------- //

  /**
   * Plan with the Session `ensureLine` returned. Its guard is the Session's
   * current revision read through the real Session facts: a line created
   * before a failed append may legitimately change before the retry.
   */
  async function planForLine(
    ctx: CoreCallContext, input: LineCreationInput,
  ): Promise<{ status: 'ready'; plan: RequestPlanV1 } | RequestRejectionV1> {
    let line: LineCreationResultV1;
    try {
      line = await deps.lineCreation.ensureLine(ctx, input);
    } catch (error) {
      return unavailable(`the line creation failed: ${messageOf(error)}`);
    }
    if (line.status === 'rejected') return mapLineRejection(line);
    if (line.status === 'accepted') return unavailable('line_pending');
    if (line.status === 'capacity_blocked') {
      return { status: 'ready', plan: { ...WAITING_PLAN, capacityBlocked: true } };
    }
    let facts: ReadResult<SessionFactsV1>;
    try {
      facts = await deps.sessionFacts.readSessionFacts(ctx, line.session);
    } catch (error) {
      return unavailable(`the secretary line read failed: ${messageOf(error)}`);
    }
    if (facts.status !== 'ready') {
      return unavailable(`the secretary line read failed: ${facts.status === 'rejected' ? facts.reason : facts.status}`);
    }
    return {
      status: 'ready',
      plan: {
        assignTo: { session: { ...line.session }, guard: versionedRefOf(line.session, facts.value.session.revision),
          fresh: true },
        createdLine: true, capacityBlocked: false,
      },
    };
  }

  async function planForNewLine(
    ctx: CoreCallContext, scope: WorkspaceScope, lineCommandId: string,
  ): Promise<{ status: 'ready'; plan: RequestPlanV1 } | RequestRejectionV1> {
    let profile: ReadResult<SecretaryProfileV1 | null>;
    try {
      profile = await deps.profiles.forNewLine(ctx, { workspace: scope });
    } catch (error) {
      return unavailable(`the secretary profile read failed: ${messageOf(error)}`);
    }
    if (profile.status === 'rejected') return unavailable(`the secretary profile read failed: ${profile.reason}`);
    // Only a ready read that found no profile means "no binding"; a read that
    // is not ready is a failure, never a blocked request.
    if (profile.status !== 'ready') return unavailable(`the secretary profile read is not available (${profile.status})`);
    if (profile.value === null) return unavailable('no_secretary_binding');
    return planForLine(ctx, {
      commandId: lineCommandId,
      duty: 'secretary',
      scope: { kind: 'project' },
      reason: 'secretary_needed',
      provenance: { schemaVersion: 1, kind: 'new' },
      roleConfiguration: profile.value.sessionRole,
    });
  }

  /**
   * The line a pre-crash attempt may already have created: found -> replay
   * `ensureLine` with the stored input; a ready "none" -> `none`. A lookup that
   * is not ready is a failure: picking on it could create a second line.
   */
  async function replayLineIfAny(
    ctx: CoreCallContext, lineCommandId: string,
  ): Promise<{ status: 'none' } | { status: 'ready'; plan: RequestPlanV1 } | RequestRejectionV1> {
    let found: ReadResult<{ status: 'none' } | { status: 'found'; input: LineCreationInput }>;
    try {
      found = await deps.lineCreation.findLine(ctx, { commandId: lineCommandId });
    } catch (error) {
      return unavailable(`the line lookup failed: ${messageOf(error)}`);
    }
    if (found.status === 'rejected') return unavailable(`the line lookup failed: ${found.reason}`);
    if (found.status !== 'ready') return unavailable(`the line lookup is not available (${found.status})`);
    if (found.value.status === 'none') return { status: 'none' };
    return planForLine(ctx, found.value.input);
  }

  // ---------------------------------------------------------------------- //
  // The pick, and the append that may make it conflict                     //
  // ---------------------------------------------------------------------- //

  /**
   * One fresh pick: line replay first, then a re-pick (excluding the
   * conflicted Session) for each conflict while the budget lasts, then one new
   * line.
   */
  async function appendWithPick(
    ctx: CoreCallContext, command: RequestPublicCommandV1, goalId: string | null, budget: PickBudget,
  ): Promise<RequestAppendResultV1> {
    const lineCommandId = `${command.commandId}:line`;
    const replayed = await replayLineIfAny(ctx, lineCommandId);
    if (isRefusal(replayed)) return replayed;
    if (replayed.status === 'ready') return deps.rounds.append(ctx, { command, plan: replayed.plan });

    const scope = workspaceOf(ctx);
    const excluded: SessionRef[] = [];
    for (;;) {
      let selection: ReadResult<SecretarySelectionFactsV1>;
      try {
        selection = await deps.selection.readSecretarySelectionFacts(ctx, { scope, goalId, exclude: excluded });
      } catch (error) {
        return unavailable(`the secretary selection read failed: ${messageOf(error)}`);
      }
      if (selection.status === 'rejected') return unavailable(`the secretary selection read failed: ${selection.reason}`);
      if (selection.status !== 'ready') return unavailable('the secretary selection read is unavailable');
      const first = orderCandidates(selection.value, { goalId })[0];
      if (first === undefined) break;
      const appended = await deps.rounds.append(ctx, { command, plan: pickPlanOf(first) });
      if (appended.status === 'appended') return appended;
      // Only a fresh pick's Session/intake conflict re-picks. `busy` is the
      // exhausted tail retry and ends the command; it never starts a new line.
      if (appended.status !== 'rejected' || appended.code !== 'revision_conflict') return appended;
      if (budget.left === 0) break;
      budget.left -= 1;
      excluded.push({ ...first.session });
    }
    const line = await planForNewLine(ctx, scope, lineCommandId);
    if (isRefusal(line)) return line;
    return deps.rounds.append(ctx, { command, plan: line.plan });
  }

  /** The goal a fresh pick orders by: the continued request's effective goal, else the new root's. */
  function pickGoalOf(command: RequestPublicCommandV1, facts: RequestCoreViewV1 | null): string | null {
    if (facts !== null) return facts.effectiveGoalId;
    return command.kind === 'submit' ? command.goalId : null;
  }

  /**
   * Append one command after its precheck's one decision: the assignment row
   * says whether a pick is needed. A no-pick plan that the service now reads as
   * a pick row answers `revision_conflict`; the request facts changed under the
   * plan, so precheck and the plan are re-run for the same command. Each re-run
   * and each later re-pick spends the one `SECRETARY_PICK_RETRIES` budget.
   */
  async function appendAfterPrecheck(
    ctx: CoreCallContext, command: RequestPublicCommandV1,
    first: Exclude<Awaited<ReturnType<RequestRoundPort['precheck']>>, RequestRejectionV1>,
  ): Promise<RequestAppendResultV1> {
    const budget: PickBudget = { left: SECRETARY_PICK_RETRIES };
    let pre = first;
    for (;;) {
      if (pre.status === 'replay') return pre.result;
      const row = requestAssignmentRow(command, pre.facts);
      const appended = row === 'pick'
        ? await appendWithPick(ctx, command, pickGoalOf(command, pre.facts), budget)
        : await deps.rounds.append(ctx, { command, plan: { ...WAITING_PLAN } });
      if (appended.status === 'rejected' && appended.code === 'revision_conflict' && row !== 'pick'
        && budget.left > 0) {
        budget.left -= 1;
        const next = await deps.rounds.precheck(ctx, command);
        if (next.status === 'rejected') return next;
        pre = next;
        continue;
      }
      return appended;
    }
  }

  // ---------------------------------------------------------------------- //
  // submit                                                                 //
  // ---------------------------------------------------------------------- //

  async function submitRequest(
    ctx: CoreCallContext, input: { commandId: string; goalId: string | null; text: string;
      continues: QueryJobRef | null; recipient: SessionRef | null },
  ): Promise<RequestSubmitResultV1> {
    const command: RequestPublicCommandV1 = { kind: 'submit', commandId: input.commandId, goalId: input.goalId,
      text: input.text, continues: input.continues, recipient: input.recipient };
    const pre = await deps.rounds.precheck(ctx, command);
    if (pre.status === 'rejected') return pre;
    if (pre.status === 'fresh' && command.continues !== null && pre.facts === null) {
      return unavailable('the continued request has no facts');
    }
    const appended = await appendAfterPrecheck(ctx, command, pre);
    const result = submitResultOf(appended);
    if (result.status === 'queued' && appended.status === 'appended' && !appended.replayed) {
      deps.wake?.(workspaceOf(ctx), 'request_command');
    }
    return result;
  }

  function submitResultOf(result: RequestAppendResultV1): RequestSubmitResultV1 {
    if (result.status === 'rejected') return result;
    if (result.status !== 'appended') return unavailable('the submit did not append a round');
    const receipt = result.receipt;
    if (receipt.kind !== 'submit') return unavailable('the submit receipt names no request round');
    if (receipt.assignment === 'assigned') {
      return { status: 'queued', requestRoot: { ...receipt.requestRoot }, round: { ...receipt.round },
        assignment: 'assigned', secretary: { ...receipt.secretary }, created: receipt.created, waitReason: null };
    }
    return { status: 'queued', requestRoot: { ...receipt.requestRoot }, round: { ...receipt.round },
      assignment: 'unassigned', secretary: null, created: false, waitReason: 'secretary_open_cap' };
  }

  // ---------------------------------------------------------------------- //
  // route                                                                  //
  // ---------------------------------------------------------------------- //

  async function route(
    ctx: CoreCallContext,
    input: { commandId: string; round: QueryJobRef; to: SessionRef | null;
      reason: 'manual' | 'dropped' },
  ): Promise<RequestRouteResultV1> {
    const command: RequestPublicCommandV1 = { kind: 'route', commandId: input.commandId, round: input.round,
      to: input.to, reason: input.reason };
    // The public surface is `manual`/`dropped` by type; the identity-first
    // precheck is the one place that refuses anything else, so a non-person
    // is refused before its input is judged.
    const pre = await deps.rounds.precheck(ctx, command);
    if (pre.status === 'rejected') return pre;
    if (pre.status === 'replay') return routeResultOf(pre.result);
    const appended = await deps.rounds.append(ctx, { command, plan: { ...WAITING_PLAN } });
    const result = routeResultOf(appended);
    if (result.status === 'routed' && appended.status === 'appended' && !appended.replayed) {
      deps.wake?.(workspaceOf(ctx), 'request_command');
    }
    return result;
  }

  function routeResultOf(result: RequestAppendResultV1): RequestRouteResultV1 {
    if (result.status === 'rejected') return result;
    if (result.status !== 'appended') return unavailable('the route did not append a round');
    if (result.receipt.kind !== 'route') return unavailable('the route receipt names no routing round');
    return { status: 'routed', routingRound: { ...result.receipt.routingRound } };
  }

  // ---------------------------------------------------------------------- //
  // selectIdea                                                             //
  // ---------------------------------------------------------------------- //

  async function selectIdea(
    ctx: CoreCallContext, input: { commandId: string; round: QueryJobRef; index: number },
  ): Promise<RequestSelectIdeaResultV1> {
    return followup(ctx, { kind: 'select_idea', commandId: input.commandId, round: input.round, index: input.index });
  }

  // ---------------------------------------------------------------------- //
  // ask                                                                    //
  // ---------------------------------------------------------------------- //

  async function ask(
    ctx: CoreCallContext,
    input: { commandId: string; round: QueryJobRef; cardRefs: VersionedRef[]; regenerate: boolean; text: string },
  ): Promise<RequestAskResultV1> {
    return followup(ctx, { kind: 'ask', commandId: input.commandId, round: input.round, cardRefs: input.cardRefs,
      regenerate: input.regenerate, text: input.text });
  }

  /**
   * The one follow-up path of `selectIdea` and `ask`: precheck, then the
   * assignment row's pick when the request needs one, then the wake after a
   * commit (never on a replay).
   */
  async function followup(
    ctx: CoreCallContext, command: Extract<RequestPublicCommandV1, { kind: 'select_idea' | 'ask' }>,
  ): Promise<{ status: 'queued'; followupRound: QueryJobRef } | RequestRejectionV1> {
    const pre = await deps.rounds.precheck(ctx, command);
    if (pre.status === 'rejected') return pre;
    if (pre.status === 'fresh' && pre.facts === null) return unavailable('the round the follow-up names has no facts');
    const appended = await appendAfterPrecheck(ctx, command, pre);
    const result = followupResultOf(appended, command.kind);
    if (result.status === 'queued' && appended.status === 'appended' && !appended.replayed) {
      deps.wake?.(workspaceOf(ctx), 'request_command');
    }
    return result;
  }

  function followupResultOf(result: RequestAppendResultV1, kind: 'select_idea' | 'ask'):
    { status: 'queued'; followupRound: QueryJobRef } | RequestRejectionV1 {
    if (result.status === 'rejected') return result;
    if (result.status !== 'appended') return unavailable('the follow-up did not append a round');
    const receipt = result.receipt;
    if ((receipt.kind !== 'select_idea' && receipt.kind !== 'ask') || receipt.kind !== kind) {
      return unavailable('the follow-up receipt names no follow-up round');
    }
    return { status: 'queued', followupRound: { ...receipt.followupRound } };
  }

  // ---------------------------------------------------------------------- //
  // The drain                                                              //
  // ---------------------------------------------------------------------- //

  async function drainUnassigned(
    ctx: CoreCallContext, scope: WorkspaceScope,
    input: { maxRequests: number; continuation: string | null },
  ): Promise<DrainReadResultV1> {
    const limit = Math.min(input.maxRequests, REQUEST_DRAINED_PER_PASS);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      return { status: 'rejected', code: 'invalid', reason: 'maxRequests must be a positive integer' };
    }
    const read = await deps.rounds.unassigned(ctx, scope, { limit, continuation: input.continuation });
    if (read.status !== 'ready') return read;

    let progressed = 0;
    let blocked = 0;
    for (const root of read.value.requests) {
      // A drained request is one commit, so a stop requested while the page is
      // being worked returns what was already committed and leaves the rest of
      // the page to the next pass. Continuing would start work nobody waits for.
      if (ctx.signal.aborted) {
        return {
          status: 'ready',
          value: {
            progressed,
            more: read.value.continuation !== null,
            continuation: read.value.continuation,
            wrapped: read.value.wrapped,
            blocked,
          },
        };
      }
      // A failed or thrown facts read is `unavailable` at once, never
      // `blocked`; every round committed before it stays committed.
      let factsRead: ReadResult<RequestRoundsFactsV1>;
      try {
        factsRead = await deps.facts.readFacts(ctx, { requestRoot: root });
      } catch (error) {
        return unavailable(`the request facts read failed: ${messageOf(error)}`);
      }
      if (factsRead.status !== 'ready') {
        return unavailable(`the request facts read failed: ${
          factsRead.status === 'rejected' ? factsRead.reason : factsRead.status}`);
      }
      const facts = factsRead.value;
      // Already owned (a concurrent append, a replayed call) is not blocked.
      if (facts.ownerState !== 'waiting' && facts.ownerState !== 'owner_archived') continue;
      const oldest = oldestPending(facts);
      if (oldest === null) { blocked += 1; continue; }
      // Stable for this request's waiting episode, so a retried drain replays
      // the line it created instead of creating another.
      const operationId = `drain:${rootKey(root)}:${rootKey(oldest)}`;

      const decision = await drainPlan(ctx, scope, operationId, facts);
      if (isRefusal(decision)) {
        // Only no_secretary_binding and line_pending are a blocked request; a
        // failed read is a failure the caller must back off from.
        if (!blockedReason(decision)) return { status: 'rejected', code: 'unavailable', reason: decision.reason };
        blocked += 1;
        continue;
      }
      const plan = decision.plan;
      if (plan.assignTo === null) { blocked += 1; continue; }
      const appended = await deps.rounds.append(ctx, { command: {
        kind: 'assigned', operationId, requestRoot: { ...root }, to: { ...plan.assignTo.session },
        guard: plan.assignTo.guard,
      } });
      if (appended.status === 'appended' && !appended.replayed) progressed += 1;
      else if (appended.status === 'rejected') {
        // A conflict on the assigned append leaves the request waiting (blocked).
        if (appended.code !== 'busy' && appended.code !== 'revision_conflict') {
          return { status: 'rejected', code: 'unavailable', reason: appended.reason };
        }
        blocked += 1;
      }
    }
    return {
      status: 'ready',
      value: {
        progressed,
        more: read.value.continuation !== null,
        continuation: read.value.continuation,
        wrapped: read.value.wrapped,
        blocked,
      },
    };
  }

  /** The drain's pick, with its own identity before the line. */
  async function drainPlan(
    ctx: CoreCallContext, scope: WorkspaceScope, operationId: string, facts: RequestRoundsFactsV1,
  ): Promise<{ status: 'ready'; plan: RequestPlanV1 } | RequestRejectionV1> {
    const replayed = await replayLineIfAny(ctx, operationId);
    if (isRefusal(replayed)) return replayed;
    if (replayed.status === 'ready') return replayed;

    const goalId = facts.effectiveGoalId ?? facts.requestGoalId;
    let selection: ReadResult<SecretarySelectionFactsV1>;
    try {
      selection = await deps.selection.readSecretarySelectionFacts(ctx, { scope, goalId, exclude: [] });
    } catch (error) {
      return unavailable(`the secretary selection read failed: ${messageOf(error)}`);
    }
    if (selection.status === 'rejected') return unavailable(`the secretary selection read failed: ${selection.reason}`);
    if (selection.status !== 'ready') return unavailable('the secretary selection read is unavailable');
    const first = orderCandidates(selection.value, { goalId })[0];
    if (first === undefined) return planForNewLine(ctx, scope, operationId);
    // The `assigned` append re-reads the facts and guards the Session: a
    // conflict there leaves the request waiting for the next drain.
    return { status: 'ready', plan: pickPlanOf(first) };
  }

  return { submitRequest, route, selectIdea, ask, drainUnassigned };
}
