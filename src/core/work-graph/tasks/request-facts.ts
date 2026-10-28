/**
 * The request facts projection and the candidate adapter (book-6a §3.3, §3.12's
 * `RequestFactsPort`).
 *
 * Two layers (rule 10): `queries/request-rounds-read.ts` reads the records and
 * decides the owner rule; this file adds the rounds' answers, the per-request
 * candidate head and the processing reasons, then derives `RequestCoreViewV1`
 * purely. `readRequest` returns `not_found` only for a ref that is not a request
 * root of this workspace; every read failure is `unavailable`, never "not the
 * operator".
 *
 * The candidate adapter keeps the frozen `CandidateRequestFactsPort` rules: the
 * root is a request root whose EFFECTIVE goal equals the candidate's goal
 * (RC07 by effective goal), the initiator is the creation actor compared with
 * the bound human operator, and an unreadable locator never guesses.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { sameActorKindAndId as sameActor } from '../../../contracts/actor-equality.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey as keyOf, canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef, QueryJobSnapshot, QueryRoundKind, QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { CandidateRequestFactsPort } from '../model/decision-contracts.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type {
  RequestCoreViewV1, RequestOwnerStateV1, RequestRoundStatus, RequestRoundViewV1,
} from '../model/request-contracts.js';
import type { RecordOrderedLookupPort, RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { derivePlanProposalReadVerdict, type PlanProposalRef } from '../state/plan-machine.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import {
  compareRequestRounds, deriveCoveredByDrop, deriveEffectiveGoalId, readRequestRounds,
  type RequestRoundsFactsV1, type RequestRoundsStore,
} from '../queries/request-rounds-read.js';
import { readRequestCandidateHead } from './plan-readers.js';
import { readOwnerRecord } from './owner-record-read.js';

export { deriveCoveredByDrop, deriveEffectiveGoalId } from '../queries/request-rounds-read.js';

// ------------------------------------------------------------------------ //
// Pure projection: status, drafts, reasons                                  //
// ------------------------------------------------------------------------ //

function roundStatus(
  round: QueryJobSnapshot, run: QueryRunSnapshot | undefined, covered: boolean,
): RequestRoundStatus {
  const phase = run?.run.executionState?.phase;
  if (round.job.status === 'answered' || round.job.status === 'closed') return 'ended';
  if (phase === 'unknown') return 'unknown';
  if (round.job.status === 'running') return 'running';
  if (phase !== undefined && phase !== 'settled') return 'running';
  if (covered) return 'ended';
  return 'queued';
}

function answerOf(
  round: QueryJobSnapshot, answers: ReadonlyMap<string, QueryJobAnswerSnapshot>,
): QueryJobAnswerSnapshot | null {
  const ref = round.job.answerRefs.at(-1);
  if (ref === undefined) return null;
  return answers.get(answerKey(ref)) ?? null;
}

function answerKey(ref: QueryJobAnswerRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export type RequestCoreFactsV1 = {
  requestRoot: QueryJobRef;
  requestGoalId: string | null;
  effectiveGoalId: string | null;
  owner: SessionRef | null;
  ownerState: RequestOwnerStateV1;
  coveredByDrop: readonly QueryJobRef[];
  answers: readonly QueryJobAnswerSnapshot[];
  candidate: { proposalRef: PlanProposalRef; state: string; stale: boolean } | null;
};

/** The map key of one `(answerRef, draftIndex)` initialization binding; canonical JSON keeps the pair unambiguous. */
function draftBindingKey(answerRef: QueryJobAnswerRef, draftIndex: number): string {
  return canonicalJson({ answerRef, draftIndex } as unknown as JsonValue);
}

/**
 * The pure `RequestCoreViewV1` projection (§3.12): status, session, drafts,
 * selected idea, close code/detail, reasons, assignment and wait reason.
 */
export function deriveRequestCore(
  rounds: readonly QueryJobSnapshot[],
  runs: readonly QueryRunSnapshot[],
  facts: RequestCoreFactsV1,
  bindingByAnswerDraft?: ReadonlyMap<string, GoalRef>,
): RequestCoreViewV1 {
  const roundsByKey = new Map(runs.map((run) => [canonicalJson(run.ref as unknown as JsonValue), run]));
  const answersByKey = new Map(facts.answers.map((answer) => [answerKey(answer.ref), answer]));
  const coveredKeys = new Set(facts.coveredByDrop.map((ref) => canonicalJson(ref as unknown as JsonValue)));
  const ordered = [...rounds].sort(compareRequestRounds);

  const views: RequestRoundViewV1[] = [];
  for (const round of ordered) {
    const runRef = round.job.runRef;
    const run = runRef === null ? undefined : roundsByKey.get(canonicalJson(runRef as unknown as JsonValue));
    const answer = answerOf(round, answersByKey);
    const kind = round.job.roundKind;
    if (kind === null) throw new Error('deriveRequestCore: a request round has no roundKind');
    views.push({
      ref: { ...round.ref },
      kind: kind as QueryRoundKind,
      status: roundStatus(round, run, coveredKeys.has(canonicalJson(round.ref as unknown as JsonValue))),
      input: round.job.intent.question,
      answer: answer?.answer.answer ?? null,
      ideas: answer === null ? [] : answer.answer.ideas.map((idea) => ({ ...idea })),
      goalCardDrafts: answer === null ? [] : answer.answer.goalCardDrafts.map((draft, index) => ({
        index,
        draft: structuredClone(draft),
        confirmedGoalRef: bindingByAnswerDraft?.get(draftBindingKey(answer.ref, index)) ?? null,
      })),
      selectedIdea: round.job.selectedIdea === null ? null : { round: { ...round.job.selectedIdea.round }, index: round.job.selectedIdea.index },
      assignedSession: round.job.assignedSession === null ? null : { ...round.job.assignedSession },
      session: run === undefined || run.run.executionState === undefined
        ? null : { ...run.run.executionState.sessionRef },
      absorbedInto: round.job.absorbedInto === null ? null : { ...round.job.absorbedInto },
      closeCode: round.job.closeReason?.code ?? null,
      closeDetail: round.job.closeReason?.detail ?? null,
      closeMessage: round.job.closeReason?.message ?? null,
      since: round.since,
    });
  }

  const reasons: RequestCoreViewV1['reasons'] = [];
  const roundReason = views.some((view, index) =>
    view.status === 'running'
    || (view.status === 'queued' && !coveredKeys.has(canonicalJson(ordered[index]!.ref as unknown as JsonValue))));
  if (roundReason) reasons.push('round');
  if (facts.candidate !== null) reasons.push('candidate');

  return {
    requestRoot: { ...facts.requestRoot },
    goalId: facts.requestGoalId,
    effectiveGoalId: facts.effectiveGoalId,
    owner: facts.owner === null ? null : { ...facts.owner },
    ownerState: facts.ownerState,
    processing: reasons.length > 0,
    assignment: facts.ownerState === 'owned' ? 'assigned' : 'unassigned',
    waitReason: facts.ownerState === 'waiting' ? 'secretary_open_cap'
      : facts.ownerState === 'owner_archived' ? 'owner_archived' : null,
    reasons,
    rounds: views,
    candidate: facts.candidate === null ? null : {
      proposalRef: facts.candidate.proposalRef, state: facts.candidate.state, stale: facts.candidate.stale,
    },
  };
}

// ------------------------------------------------------------------------ //
// The read layer                                                            //
// ------------------------------------------------------------------------ //

export type RequestFactsDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** The complete ordered read; production's records implements it, a narrow test double may inject it. */
  ordered?: RecordOrderedLookupPort;
  /** The initialization binding read; without it every draft reads `confirmedGoalRef: null`. */
  bindings?: InitializationBindingReadPort;
};

export interface RequestFactsPort {
  readRequest(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestCoreViewV1>>;
  ownerOf(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<SessionRef | null>>;
  effectiveGoalOf(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<string | null>>;
}

function unavailable(reason: string): { status: 'rejected'; code: 'unavailable'; reason: string } {
  return { status: 'rejected', code: 'unavailable', reason };
}

/**
 * The request root a round belongs to: the round's own record names it, and a plain Query (or a
 * foreign ref) is `not_found`. The one resolver the request owner and the confirm owner share.
 */
export async function resolveRequestRoot(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, ctx: CoreCallContext, round: QueryJobRef,
): Promise<{ status: 'ready'; root: QueryJobRef } | { status: 'not_found' }
  | { status: 'rejected'; code: 'unavailable'; reason: string }> {
  if (round.projectId !== ctx.projectId || round.workspaceId !== (ctx.workspaceId ?? '')) {
    return { status: 'not_found' };
  }
  const read = await readOwnerRecord({
    store: records,
    refKey: keyOf(round),
    decode: decodeQueryJobSnapshot,
    readError: (message) => unavailable(message),
  });
  if (!read.ok) {
    return 'rejection' in read
      ? unavailable(`the request round could not be read: ${read.rejection.reason}`) : { status: 'not_found' };
  }
  const root = read.value.job.requestRoot;
  return root === null ? { status: 'not_found' } : { status: 'ready', root: { ...root } };
}

function orderedStoreOf(deps: RequestFactsDependencies): RecordOrderedLookupPort | null {
  if (deps.ordered !== undefined) return deps.ordered;
  const candidate = deps.records as unknown as Partial<RecordOrderedLookupPort>;
  return typeof candidate.lookupOrdered === 'function' ? candidate as RecordOrderedLookupPort : null;
}

function roundsStoreOf(deps: RequestFactsDependencies, ordered: RecordOrderedLookupPort): RequestRoundsStore {
  return {
    readMany: (refKeys) => deps.records.readMany(refKeys),
    eventAt: (cursor) => deps.records.eventAt(cursor),
    lookup: (request) => deps.records.lookup(request),
    lookupOrdered: (request) => ordered.lookupOrdered(request),
  };
}

/** The latest answer ref of each round, once each: the read only needs that one. */
function latestAnswerRefs(rounds: readonly QueryJobSnapshot[]): QueryJobAnswerRef[] {
  const refs: QueryJobAnswerRef[] = [];
  for (const round of rounds) {
    const ref = round.job.answerRefs.at(-1);
    if (ref === undefined) continue;
    if (!refs.some((existing) => keyOf(existing) === keyOf(ref))) refs.push(ref);
  }
  return refs;
}

/**
 * The latest answer of each held round, in one batch. The one reader the request
 * view and the secretary preparation share; it never re-reads the rounds' Job,
 * Run or Session.
 */
export async function readAnswers(
  deps: { records: Pick<GoalRecordTransactionPort, 'readMany'> }, rounds: readonly QueryJobSnapshot[],
): Promise<{ status: 'ready'; value: QueryJobAnswerSnapshot[]; guards: RecordGuard[] }
  | { status: 'rejected'; code: 'unavailable'; reason: string }> {
  const refs = latestAnswerRefs(rounds);
  if (refs.length === 0) return { status: 'ready', value: [], guards: [] };
  let read;
  try {
    read = await deps.records.readMany(refs.map((ref) => keyOf(ref)));
  } catch (error) {
    return unavailable(`the round answers could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return unavailable(`the round answers read failed: ${read.code}: ${read.reason}`);
  if (read.value.missing.length > 0) return unavailable(`the round answers are missing: ${read.value.missing.join(', ')}`);
  const answers: QueryJobAnswerSnapshot[] = [];
  const guards: RecordGuard[] = [];
  for (const record of read.value.records) {
    const decoded = decodeQueryJobAnswerSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`a round answer is damaged: ${decoded.reason}`);
    answers.push(decoded.value);
    guards.push({ refKey: record.refKey, expectedRevision: record.revision });
  }
  return { status: 'ready', value: answers, guards };
}

/**
 * Each draft's confirmed Goal, from the injected binding read. A `not_found`
 * binding is the normal unconfirmed draft; any other failed read rejects the
 * whole request read instead of quietly reading the draft as unconfirmed.
 */
async function readConfirmedGoalRefs(
  deps: RequestFactsDependencies, ctx: CoreCallContext, answers: readonly QueryJobAnswerSnapshot[],
): Promise<{ status: 'ready'; value: ReadonlyMap<string, GoalRef> }
  | { status: 'rejected'; code: 'unavailable'; reason: string }> {
  const bindings = deps.bindings;
  if (bindings === undefined) return { status: 'ready', value: new Map() };
  const confirmed = new Map<string, GoalRef>();
  for (const answer of answers) {
    for (let index = 0; index < answer.answer.goalCardDrafts.length; index += 1) {
      let read;
      try {
        read = await bindings.readBindingByAnswerDraft(ctx, { answerRef: answer.ref, draftIndex: index });
      } catch (error) {
        return unavailable(`the draft binding could not be read: ${messageOf(error)}`);
      }
      if (read.status === 'not_found') continue;
      if (read.status !== 'ready') {
        return unavailable(`the draft binding read failed: ${
          read.status === 'rejected' ? `${read.code}: ${read.reason}` : read.status}`);
      }
      confirmed.set(draftBindingKey(answer.ref, index), { ...read.value.goalRef });
    }
  }
  return { status: 'ready', value: confirmed };
}

async function readCandidate(
  deps: RequestFactsDependencies,
  ctx: CoreCallContext,
  input: { requestRoot: QueryJobRef; effectiveGoalId: string | null },
): Promise<{ status: 'ready'; value: RequestCoreViewV1['candidate'] } | { status: 'rejected'; code: 'unavailable'; reason: string }> {
  if (input.effectiveGoalId === null) return { status: 'ready', value: null };
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: input.effectiveGoalId };
  let headRead;
  try {
    headRead = await readRequestCandidateHead(deps.records, { goalRef, requestRef: input.requestRoot });
  } catch (error) {
    return unavailable(`the request candidate could not be read: ${messageOf(error)}`);
  }
  if (headRead.status !== 'ready') return unavailable(`the request candidate read failed: ${headRead.code}: ${headRead.reason}`);
  const head = headRead.head;
  if (head === null) return { status: 'ready', value: null };
  const goalKey = keyOf(goalRef);
  let goalRead;
  try {
    goalRead = await deps.records.readMany([goalKey]);
  } catch (error) {
    return unavailable(`the candidate's Goal could not be read: ${messageOf(error)}`);
  }
  if (goalRead.status !== 'ready') return unavailable(`the candidate's Goal read failed: ${goalRead.code}: ${goalRead.reason}`);
  const record = goalRead.value.records.find((candidate) => candidate.refKey === goalKey);
  if (record === undefined) return unavailable('the candidate names a missing Goal');
  const goal = decodeGoalSnapshot(record);
  if (goal.status !== 'decoded') return unavailable(`the candidate's Goal is damaged: ${goal.reason}`);
  const verdict = derivePlanProposalReadVerdict(head, goal.value.activePlanRevision, goal.value.desiredState);
  if (verdict.status === 'closed') return { status: 'ready', value: null };
  return {
    status: 'ready',
    value: {
      proposalRef: head.ref,
      state: verdict.status,
      stale: verdict.status === 'stale',
    },
  };
}

export function createRequestFacts(deps: RequestFactsDependencies): RequestFactsPort & {
  readFacts(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestRoundsFactsV1>>;
} {
  async function factsOf(
    ctx: CoreCallContext, input: { requestRoot: QueryJobRef },
  ): Promise<ReadResult<RequestRoundsFactsV1>> {
    const store = storeOrNullFor(deps);
    if (store === null) return unavailable('this store cannot read the ordered request index');
    return readRequestRounds(store, ctx, input);
  }

  async function readRequest(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestCoreViewV1>> {
    const facts = await factsOf(ctx, input);
    if (facts.status === 'not_found') return { status: 'not_found' };
    if (facts.status !== 'ready') {
      return unavailable(facts.status === 'rejected' ? facts.reason : 'the request facts are unavailable');
    }
    const answers = await readAnswers(deps, facts.value.rounds);
    if (answers.status !== 'ready') return { status: 'rejected', code: answers.code, reason: answers.reason };
    const confirmed = await readConfirmedGoalRefs(deps, ctx, answers.value);
    if (confirmed.status !== 'ready') return { status: 'rejected', code: confirmed.code, reason: confirmed.reason };
    const candidate = await readCandidate(deps, ctx, {
      requestRoot: input.requestRoot, effectiveGoalId: facts.value.effectiveGoalId,
    });
    if (candidate.status !== 'ready') return { status: 'rejected', code: candidate.code, reason: candidate.reason };
    return {
      status: 'ready',
      value: deriveRequestCore(facts.value.rounds, facts.value.runs, {
        requestRoot: input.requestRoot,
        requestGoalId: facts.value.requestGoalId,
        effectiveGoalId: facts.value.effectiveGoalId,
        owner: facts.value.owner,
        ownerState: facts.value.ownerState,
        coveredByDrop: facts.value.coveredByDrop,
        answers: answers.value,
        candidate: candidate.value,
      }, confirmed.value),
    };
  }

  return {
    readRequest,
    async ownerOf(ctx, input) {
      const facts = await factsOf(ctx, input);
      if (facts.status === 'not_found') return { status: 'not_found' };
      if (facts.status !== 'ready') {
        return unavailable(facts.status === 'rejected' ? facts.reason : 'the request facts are unavailable');
      }
      return { status: 'ready', value: facts.value.owner === null ? null : { ...facts.value.owner } };
    },
    async effectiveGoalOf(ctx, input) {
      const facts = await factsOf(ctx, input);
      if (facts.status === 'not_found') return { status: 'not_found' };
      if (facts.status !== 'ready') {
        return unavailable(facts.status === 'rejected' ? facts.reason : 'the request facts are unavailable');
      }
      return { status: 'ready', value: facts.value.effectiveGoalId };
    },
    readFacts: factsOf,
  };
}

// ------------------------------------------------------------------------ //
// The narrow candidate adapter (the four plan-service call sites)           //
// ------------------------------------------------------------------------ //

/**
 * The trusted operator the bound context names, if any.
 */
function boundOperator(ctx: CoreCallContext): { kind: 'human' | 'system'; id: string } | null {
  const principal = (ctx as unknown as { principal?: unknown }).principal;
  if (!isRecord(principal)) return null;
  if (principal['kind'] !== 'host' && principal['kind'] !== 'session') return null;
  const actor = principal['actor'];
  if (!isRecord(actor) || !nonEmpty(actor['id'])) return null;
  if (actor['kind'] !== 'human' && actor['kind'] !== 'system') return null;
  return { kind: actor['kind'], id: actor['id'] };
}

/**
 * The request facts the plan service's four candidate call sites need: whether
 * the ref is a request ROOT of this workspace, its EFFECTIVE goal, whether the
 * operator initiated it, and the record guards to commit against. The root,
 * initiator, effective goal and guards all come from the one complete read.
 */
export function createCandidateRequestFactsReader(deps: RequestFactsDependencies): CandidateRequestFactsPort {
  return {
    async readCandidateRequestFacts(ctx, input) {
      const requestRef = input.requestRef;
      const requestKey = keyOf(requestRef);
      let rootRead;
      try {
        rootRead = await deps.records.readMany([requestKey]);
      } catch (error) {
        return unavailable(`the request facts could not be read: ${messageOf(error)}`);
      }
      if (rootRead.status !== 'ready') return unavailable(`the request facts read failed: ${rootRead.code}: ${rootRead.reason}`);
      const record = rootRead.value.records.find((candidate) => candidate.refKey === requestKey);
      if (record === undefined) return { status: 'not_found' };
      const decoded = decodeQueryJobSnapshot(record);
      if (decoded.status !== 'decoded') return unavailable(`the request QueryJob is corrupt: ${decoded.reason}`);
      const job = decoded.value;
      const rootGuard: RecordGuard = { refKey: record.refKey, expectedRevision: record.revision };

      // A QueryJob that does not name itself as the request root is not a
      // request: no creation event and no round set are read for it.
      const isOwnRoot = job.job.requestRoot !== null && keyOf(job.job.requestRoot) === requestKey
        && job.job.roundKind === 'request';
      if (!isOwnRoot) {
        return {
          status: 'ready',
          value: { root: false, initiatedByOperator: false, currentSecretary: null, guards: [rootGuard] },
        };
      }
      const store = storeOrNullFor(deps);
      if (store === null) return unavailable('this store cannot read the ordered request index');
      const facts = await readRequestRounds(store, ctx, { requestRoot: input.requestRef });
      if (facts.status !== 'ready') {
        return facts.status === 'not_found' ? { status: 'not_found' }
          : unavailable(facts.status === 'rejected' ? facts.reason : 'the request facts are unavailable');
      }
      const bound = boundOperator(ctx);
      const initiatedByOperator = bound !== null && sameActor(facts.value.initiator, bound);
      const root = input.requestRef.projectId === input.goalRef.projectId
        && facts.value.effectiveGoalId !== null
        && facts.value.effectiveGoalId === input.goalRef.goalId;
      return {
        status: 'ready',
        value: {
          root,
          initiatedByOperator,
          currentSecretary: facts.value.owner === null ? null : { ...facts.value.owner },
          guards: facts.value.guards,
        },
      };
    },
  };
}

function storeOrNullFor(deps: RequestFactsDependencies): RequestRoundsStore | null {
  const ordered = orderedStoreOf(deps);
  return ordered === null ? null : roundsStoreOf(deps, ordered);
}
