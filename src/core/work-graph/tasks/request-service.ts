/**
 * The shared request-round entry (`RequestRoundPort`).
 *
 * One identity, one replay, one tail, one state and one commit path serve the
 * person's commands (`submit`, `route`, `select_idea`, `ask`) and the trusted
 * internal ones (`assigned`, `end_unbound`). A command never writes a round by
 * hand: `state/request-rounds.ts` builds the records,
 * `queries/request-rounds-read.ts` supplies the facts and their guards, and
 * this file only decides which row applies and commits under `request-tail`
 * and `secretary-intake`.
 *
 * Order (`precheck`): (1) only a person; (2) pure input checks, nothing
 * read; (3) the identity/fingerprint; (4) the replay lookup, before any pick or
 * line; (5) the fresh current-fact checks. `append` re-checks the facts it
 * guards and retries a `request-tail` conflict `SECRETARY_TAIL_RETRIES` times,
 * then answers `busy`.
 *
 * Nothing here is a Host route: the composition root wires the factory with the
 * real store, the Session facts, the real duty resolver and the profile port
 * (see `RequestRoundDependencies`).
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import {
  hostPrincipalOf, principalIdentity, type CoreCallContext, type HostPrincipal,
} from '../../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { GoalRef, VersionedRef } from '../../../contracts/ledger.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey as keyOf, canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  queryJobRefFor, type QueryJobIntentV1, type QueryJobRef, type QueryJobSnapshot,
  type QueryRunRef, type QueryRunSnapshot, type RequestCommandReceiptV1,
  type RequestUnderstandingCommandV1,
} from '../../../contracts/query-job.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
  UniqueClaimChange,
} from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import {
  latestAnsweredRound,
  QUERY_OPEN_BY_WORKSPACE_INDEX, REQUEST_PAGE_SIZE, REQUEST_TAIL_PREFIX, SECRETARY_INTAKE_PREFIX,
  SECRETARY_TAIL_RETRIES, secretaryIntakeKey,
  type RequestCoreViewV1, type RequestOwnerStateV1, type SecretaryProfilePort, type SecretaryProfileV1,
  HANDOFF_SYSTEM_PRINCIPAL, type InternalRouteCommandV1, type RequestCommandReceiptReadV1,
} from '../model/request-contracts.js';
import type { SessionFactsPort } from '../model/session-facts-contracts.js';
import type { SessionOperationRecord } from '../model/session-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { resolveRequestRoot, type RequestFactsPort } from './request-facts.js';
import { oldestPendingRound, type RequestRoundsFactsV1 } from '../queries/request-rounds-read.js';
import { noopTailClaim } from '../queries/request-round-claims.js';
import {
  decodeQueryJobSnapshot, decodeQueryJobSubmittedEvent, encodeQueryExecutionRecordedEvent, encodeQueryJobSnapshot,
  encodeQueryJobSubmittedEvent, encodeQueryRunSnapshotRecord, type QueryJobSubmittedEventV1,
} from '../queries/query-record-codecs.js';
import { queryTextProblem, lookupCommittedReceipt } from '../queries/query-job-service.js';
import { buildRecordedEvent } from '../queries/query-execution.js';
import { S5_MESSAGE_BY_WORKSPACE_STATUS, decodeSessionMessageRecord } from '../sessions/message-record-codecs.js';
import {
  decodeSessionOperationRecord, decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { activityGuardOf, planSessionActivityAdvance } from '../sessions/session-activity.js';
import {
  currentUnderstandingGeneration, endUnstartedRound, newRequestRound, setIntake,
  transitionUnderstandingCommand,
} from '../state/request-rounds.js';
import { releaseUnenteredQuerySession } from '../state/session-availability.js';
import { commandIdentity } from '../persistence/command-executor.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { aggregateRefProblem } from '../persistence/decision-record-codecs.js';
import { sessionRefProblem } from '../persistence/rework-codecs.js';
import { readOwnerRecord } from './owner-record-read.js';
import { validIdeaCount } from '../model/request-ideas.js';
import { ownerWriteStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { replayCommittedReceipt, type ReceiptReplayFailure } from './receipt-replay.js';
import { admitRequestSecretary } from './secretary-selection.js';
import {
  guardList, moveTailClaim, nullGuard, preparedGuards, prepareRoutingRequestTail, requestTailSubmissionOf, submittedEvent,
  targetConflict, type RequestTailActivityV1, type RequestTailAssignmentSourceV1 as AssignmentSource,
  type RequestTailCommitFragmentV1,
} from './request-tail-fragment.js';

// ------------------------------------------------------------------------ //
// The command, plan and result unions                                        //
// ------------------------------------------------------------------------ //

/** Declared in the model so the handoff's `sessions` and `state` files can name them; re-exported for importers here. */
export {
  HANDOFF_SYSTEM_PRINCIPAL, type InternalRouteCommandV1, type RequestCommandReceiptReadV1,
} from '../model/request-contracts.js';

export type RequestPublicCommandV1 =
  | { kind: 'submit'; commandId: string; goalId: string | null; text: string; continues: QueryJobRef | null;
      recipient: SessionRef | null }
  | { kind: 'route'; commandId: string; round: QueryJobRef; to: SessionRef | null; reason: 'manual' | 'dropped' }
  | { kind: 'select_idea'; commandId: string; round: QueryJobRef; index: number }
  | { kind: 'ask'; commandId: string; round: QueryJobRef; cardRefs: VersionedRef[]; regenerate: boolean; text: string };

export type RequestInternalCommandV1 =
  | { kind: 'reply' | 'expiry'; operationId: string; requestRoot: QueryJobRef; messageRef: SessionMessageRef }
  | { kind: 'assigned'; operationId: string; requestRoot: QueryJobRef; to: SessionRef; guard: VersionedRef }
  | { kind: 'end_unbound'; operationId: string; round: QueryJobRef }
  | InternalRouteCommandV1
  | (RequestUnderstandingCommandV1 & { kind: 'request_understanding' });

export type RequestPlanV1 = {
  assignTo: { session: SessionRef; guard: VersionedRef; fresh: boolean } | null;
  createdLine: boolean;
  /** True only when Workflow's `ensureLine` answered `capacity_blocked`; a no-pick plan is not a blocked pick. */
  capacityBlocked: boolean;
};

/** A row that reads no plan (the owner row decides from the facts alone) passes this one. */
const NO_PLAN: RequestPlanV1 = { assignTo: null, createdLine: false, capacityBlocked: false };

export type RequestRejectionV1 = {
  status: 'rejected';
  code: 'invalid' | 'forbidden' | 'unavailable' | 'busy' | 'not_found' | 'revision_conflict' | 'idempotency_conflict';
  reason: string;
};

export type RequestAppendResultV1 =
  | { status: 'appended'; receipt: RequestCommandReceiptV1; replayed: boolean }
  | { status: 'ended'; round: QueryJobRef; replayed: boolean }
  | RequestRejectionV1;

/** The two methods the request port gains beside `append`. */
export type CloseUnderstandingInputV1 = { round: QueryJobRef; commandId: string };
/**
 * Close only ensures the command is no longer `live`. A fresh `live -> closed`
 * commit says `committed`; an already terminal command says `already_terminal`
 * and nothing is written or regressed.
 */
export type CloseUnderstandingResultV1 =
  | { status: 'committed'; commandId: string; state: 'closed'; replayed: boolean; cursor: CommitCursor }
  | { status: 'already_terminal'; commandId: string; state: 'closed' | 'consumed' }
  | CoreRejection;

export type ReadRequestCommandReceiptV1 = (
  ctx: CoreCallContext, command: RequestInternalCommandV1,
) => Promise<RequestCommandReceiptReadV1>;

export interface RequestRoundPort {
  precheck(ctx: CoreCallContext, command: RequestPublicCommandV1):
    Promise<{ status: 'replay'; result: RequestAppendResultV1 }
      | { status: 'fresh'; command: RequestPublicCommandV1; facts: RequestCoreViewV1 | null }
      | RequestRejectionV1>;
  append(ctx: CoreCallContext,
    input: { command: RequestPublicCommandV1; plan: RequestPlanV1 } | { command: RequestInternalCommandV1 }):
    Promise<RequestAppendResultV1>;
  closeUnderstanding(ctx: CoreCallContext, input: CloseUnderstandingInputV1): Promise<CloseUnderstandingResultV1>;
  readRequestCommandReceipt: ReadRequestCommandReceiptV1;
  unassigned(ctx: CoreCallContext, scope: WorkspaceScope, input: { limit: number; continuation: string | null }):
    Promise<ReadResult<{ requests: QueryJobRef[]; continuation: string | null; wrapped: boolean }>>;
  /**
   * One page of the request roots with an open round in one status partition
   * of the workspace, each root once. The queue handler reads the roots it must
   * advance from here; it is a named read like `unassigned`, not an index name.
   */
  open(ctx: CoreCallContext, scope: WorkspaceScope,
    input: { status: 'pending' | 'running'; limit: number; continuation: string | null }):
    Promise<ReadResult<{ requests: QueryJobRef[]; continuation: string | null; wrapped: boolean }>>;
  /**
   * One page of the workspace messages that name a request root and carry a
   * response (`responded`) or an expiry (`pending`), each with the kind of round
   * it makes. The queue's reply/expiry driver reads every page; it is a named
   * read like `unassigned`/`open`, not a new store dependency.
   */
  sources(ctx: CoreCallContext, scope: WorkspaceScope,
    input: { status: 'pending' | 'responded'; limit: number; continuation: string | null }):
  Promise<ReadResult<{
    sources: { requestRoot: QueryJobRef; messageRef: SessionMessageRef; kind: 'reply' | 'expiry' }[];
    continuation: string | null;
    wrapped: boolean;
  }>>;
}

// ------------------------------------------------------------------------ //
// Dependencies                                                              //
// ------------------------------------------------------------------------ //

/** The store surface every append reads and commits through (the three ports plus the ordered read). */
export type RequestServiceStore = GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;

/**
 * The request facts reader the composition passes: `createRequestFacts(...)`'s object. The
 * extra `readFacts` is the facts owner's complete one-request read; this file never re-implements it.
 */
export type RequestFactsReader = RequestFactsPort & {
  readFacts(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestRoundsFactsV1>>;
};

export type RequestRoundDependencies = {
  records: RequestServiceStore;
  facts: RequestFactsReader;
  /** The trusted Session facts read the one admission check uses. */
  sessionFacts: Pick<SessionFactsPort, 'readSessionFacts'>;
  /** The real `SessionDutyResolver` the Host composition passes. */
  duty: SessionDutyReadPort;
  profiles: SecretaryProfilePort;
  now(): string;
  /** A fresh QueryJob id (the run id is derived from it). */
  operationId(): string;
};

// ------------------------------------------------------------------------ //
// Claim keys and small helpers                                              //
// ------------------------------------------------------------------------ //

/** The slot prefixes stay importable here for the existing callers; the keys live in `model/request-contracts`. */
export { REQUEST_TAIL_PREFIX, SECRETARY_INTAKE_PREFIX };

function unavailable(reason: string): RequestRejectionV1 {
  return rejected('unavailable', reason);
}

/**
 * The normalized PUBLIC input only: never a pick, a read revision or a created
 * line, so a line created between two attempts replays to the same receipt.
 */
function commandFingerprint(command: RequestPublicCommandV1): string {
  let content: unknown;
  switch (command.kind) {
    case 'submit':
      content = { kind: 'submit', goalId: command.goalId, text: command.text, continues: command.continues,
        recipient: command.recipient };
      break;
    case 'route':
      content = { kind: 'route', round: command.round, to: command.to, reason: command.reason };
      break;
    case 'select_idea':
      content = { kind: 'select_idea', round: command.round, index: command.index };
      break;
    case 'ask':
      content = { kind: 'ask', round: command.round, cardRefs: command.cardRefs, regenerate: command.regenerate,
        text: command.text };
      break;
  }
  return sha256Hex(canonicalJson(content as JsonValue));
}

/** The caller's workspace: the scope every request read, round and secretary check uses. */
export function workspaceOf(ctx: CoreCallContext): WorkspaceScope {
  return { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
}

// ------------------------------------------------------------------------ //
// Pure input checks (shape, text, refs; nothing read)                       //
// ------------------------------------------------------------------------ //

function queryJobRefProblem(value: unknown, what: string): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'QueryJob') return `${what} must name a complete QueryJobRef`;
  return aggregateRefProblem(value) === null ? null : `${what} must name a complete QueryJobRef`;
}

function versionedRefProblem(value: unknown, what: string): string | null {
  if (!isRecord(value)) return `${what} must be a VersionedRef`;
  const refProblem = aggregateRefProblem(value['ref']);
  if (refProblem !== null) return `${what}.ref ${refProblem}`;
  if (!Number.isSafeInteger(value['revision']) || (value['revision'] as number) < 1) {
    return `${what}.revision must be a positive safe integer`;
  }
  return null;
}

/** An `ask` names at most this many card refs (slice-6 spec L6: the refs of one card). */
const ASK_CARD_REFS_MAX = 20;

/** What a regeneration asks for; the person's words, when any, follow after a blank line. */
const ASK_REGENERATE_TEXT = '请按当前事实重新出这个候选计划。';

/**
 * The input an `ask` stores on its follow-up round: the question as given, or
 * for a regeneration the request to redo the candidate from the current facts
 * followed by the person's words when there are any. The shared Query text
 * rule applies to this stored text.
 */
export function askInputText(input: { regenerate: boolean; text: string }): string {
  if (!input.regenerate) return input.text;
  return input.text.length === 0 ? ASK_REGENERATE_TEXT : `${ASK_REGENERATE_TEXT}\n\n${input.text}`;
}

/**
 * The answer to the read of the card objects an `ask` names: a type the store
 * keeps no records of is `invalid` (asking again cannot help); any other failed
 * read is `unavailable`; a read the store answered lets the `ask` through.
 */
export function cardRefsReadRefusal(
  read: { status: 'ready' } | { status: 'rejected'; code: string; reason: string },
): RequestRejectionV1 | null {
  if (read.status === 'ready') return null;
  if (read.code === 'unsupported') return rejected('invalid', `a card ref is not a stored object: ${read.reason}`);
  return unavailable(`the card objects read failed: ${read.code}: ${read.reason}`);
}

/**
 * The card objects an `ask` names, read once before a round is added. The
 * secretary's preparation reads their current revisions in one batch, and the
 * store fails such a batch whole when one type is not a stored object, which
 * would stop every later preparation of the request. Missing objects pass (the
 * context shows them as not found); the pinned revision is not compared with
 * the current one.
 */
async function readCardObjects(records: RequestServiceStore,
  cardRefs: readonly VersionedRef[]): Promise<RequestRejectionV1 | null> {
  const keys = cardRefs.map((pin) => canonicalJson(pin.ref as unknown as JsonValue));
  try {
    return cardRefsReadRefusal(await records.readMany(keys));
  } catch (error) {
    return unavailable(`the card objects read failed: ${messageOf(error)}`);
  }
}

/**
 * The card refs of an `ask`: 1 to `ASK_CARD_REFS_MAX` well-formed VersionedRefs
 * of the caller's project, no object named twice (whatever the revisions).
 */
function cardRefsProblem(cardRefs: unknown, projectId: string): string | null {
  if (!Array.isArray(cardRefs)) return 'cardRefs must be an array';
  if (cardRefs.length < 1 || cardRefs.length > ASK_CARD_REFS_MAX) {
    return `cardRefs must name 1 to ${String(ASK_CARD_REFS_MAX)} refs`;
  }
  const seen = new Set<string>();
  for (const [index, entry] of cardRefs.entries()) {
    const problem = versionedRefProblem(entry, `cardRefs[${index}]`);
    if (problem !== null) return problem;
    const ref = (entry as VersionedRef).ref as unknown as Record<string, unknown>;
    if (ref['projectId'] !== projectId) return `cardRefs[${index}].ref must name an object of this project`;
    const key = keyOf(ref);
    if (seen.has(key)) return `cardRefs[${index}] names the same object as an earlier ref`;
    seen.add(key);
  }
  return null;
}

/**
 * The pure input check of a public command (precheck step 2): shape, text and
 * refs, with the caller's project the only context; nothing is read.
 */
export function publicCommandProblem(command: RequestPublicCommandV1, projectId: string): string | null {
  if (!isRecord(command) || !nonEmpty(command.commandId)) return 'the command requires a commandId';
  switch (command.kind) {
    case 'submit': {
      if (!(command.goalId === null || nonEmpty(command.goalId))) return 'goalId must be null or a non-empty string';
      const text = queryTextProblem(command.text);
      if (text !== null) return `text ${text}`;
      if (command.continues !== null) {
        const problem = queryJobRefProblem(command.continues, 'continues');
        if (problem !== null) return problem;
      }
      if (command.recipient !== null) {
        const problem = sessionRefProblem(command.recipient, 'recipient');
        if (problem !== null) return problem;
      }
      return null;
    }
    case 'route': {
      const problem = queryJobRefProblem(command.round, 'round');
      if (problem !== null) return problem;
      if (command.reason !== 'manual' && command.reason !== 'dropped') return 'reason must be manual or dropped';
      if (command.reason === 'dropped' && command.to !== null) return 'a dropped route has no recipient';
      if (command.reason === 'manual' && command.to === null) return 'a manual route requires a recipient';
      return command.to === null ? null : sessionRefProblem(command.to, 'to');
    }
    case 'select_idea': {
      const problem = queryJobRefProblem(command.round, 'round');
      if (problem !== null) return problem;
      if (!Number.isSafeInteger(command.index) || command.index < 0) return 'index must be a non-negative integer';
      return null;
    }
    case 'ask': {
      const problem = queryJobRefProblem(command.round, 'round');
      if (problem !== null) return problem;
      const refs = cardRefsProblem(command.cardRefs, projectId);
      if (refs !== null) return refs;
      if (typeof command.regenerate !== 'boolean') return 'regenerate must be a boolean';
      if (typeof command.text !== 'string') return 'text must be a string';
      const text = queryTextProblem(askInputText(command));
      if (text !== null) return `text ${text}`;
      return null;
    }
    default:
      return `unknown request command ${String((command as { kind?: unknown }).kind)}`;
  }
}

// ------------------------------------------------------------------------ //
// Reads                                                                     //
// ------------------------------------------------------------------------ //

type OneRecord<T> =
  | { status: 'ready'; value: T; guard: RecordGuard }
  | { status: 'not_found' }
  | { status: 'rejected'; reason: string };

async function readOne<T>(
  records: RequestServiceStore,
  ref: unknown,
  decode: (record: EncodedRecord) => { status: 'decoded'; value: T } | { status: 'invalid'; reason: string },
): Promise<OneRecord<T>> {
  const refKey = keyOf(ref);
  let damage: string | null = null;
  let guard: RecordGuard | null = null;
  const read = await readOwnerRecord({
    store: records,
    refKey,
    decode: (record) => {
      const decoded = decode(record);
      if (decoded.status !== 'decoded') { damage = decoded.reason; return decoded; }
      guard = { refKey: record.refKey, expectedRevision: record.revision };
      return decoded;
    },
    readError: (message) => rejected('unavailable', `the read failed: ${message}`),
  });
  if (!read.ok) {
    if ('notFound' in read) return { status: 'not_found' };
    if (damage !== null) return { status: 'rejected', reason: `the record is damaged: ${damage}` };
    return { status: 'rejected', reason: `the read failed: ${read.rejection.code}: ${read.rejection.reason}` };
  }
  return { status: 'ready', value: read.value, guard: guard! };
}

const decodeJob = (record: EncodedRecord) => decodeQueryJobSnapshot(record);

async function readRequestFacts(
  deps: RequestRoundDependencies, ctx: CoreCallContext, root: QueryJobRef,
): Promise<{ status: 'ready'; facts: RequestRoundsFactsV1 } | RequestRejectionV1> {
  let read: ReadResult<RequestRoundsFactsV1>;
  try {
    read = await deps.facts.readFacts(ctx, { requestRoot: root });
  } catch (error) {
    return unavailable(`the request facts could not be read: ${messageOf(error)}`);
  }
  if (read.status === 'not_found') return rejected('not_found', 'the ref is not a request root of this workspace');
  if (read.status === 'rejected') return unavailable(`the request facts read failed: ${read.reason}`);
  if (read.status !== 'ready') return unavailable('the request facts are not readable');
  return { status: 'ready', facts: read.value };
}

async function readRequestView(
  deps: RequestRoundDependencies, ctx: CoreCallContext, root: QueryJobRef,
): Promise<{ status: 'ready'; view: RequestCoreViewV1 } | RequestRejectionV1> {
  let read: ReadResult<RequestCoreViewV1>;
  try {
    read = await deps.facts.readRequest(ctx, { requestRoot: root });
  } catch (error) {
    return unavailable(`the request view could not be read: ${messageOf(error)}`);
  }
  if (read.status === 'not_found') return rejected('not_found', 'the ref is not a request root of this workspace');
  if (read.status === 'rejected') return unavailable(`the request view read failed: ${read.reason}`);
  if (read.status !== 'ready') return unavailable('the request view is not readable');
  return { status: 'ready', view: read.value };
}

/** The workspace Goal must exist, belong here and not be cancelled: `active` and `paused` are live
 *  (DESIGN :341, slice-6 :213: a paused Goal can still be read, explained and drafted for). */
async function readLiveGoal(
  deps: RequestRoundDependencies, ctx: CoreCallContext, goalId: string,
): Promise<{ status: 'ready'; guard: RecordGuard } | RequestRejectionV1> {
  const ref: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId };
  const read = await readOne(deps.records, ref, decodeGoalSnapshot);
  if (read.status === 'not_found') return rejected('not_found', 'the Goal does not exist');
  if (read.status === 'rejected') return unavailable(`the Goal could not be read: ${read.reason}`);
  if (read.value.workspaceRef.projectId !== ctx.projectId || read.value.workspaceRef.workspaceId !== ctx.workspaceId) {
    return rejected('invalid', 'the Goal belongs to another workspace');
  }
  if (read.value.desiredState === 'cancelled') return rejected('invalid', 'the Goal is not live');
  return { status: 'ready', guard: read.guard };
}

// ------------------------------------------------------------------------ //
// The one secretary admission check and the profiles it returns             //
// ------------------------------------------------------------------------ //

type AdmittedTarget = { session: SessionRecord; profile: SecretaryProfileV1; guards: RecordGuard[] };

/** A rule refusal, with the revision of the Session it judged (null when refused before the read). */
type RefusedTarget = { status: 'refused'; reason: string; revision: number | null };

/** Every target the service assigns, routes to or prepares must pass this one check. */
async function admitTarget(
  deps: RequestRoundDependencies, ctx: CoreCallContext, session: SessionRef,
): Promise<{ status: 'ready'; value: AdmittedTarget } | RefusedTarget | RequestRejectionV1> {
  let admission;
  try {
    admission = await admitRequestSecretary(deps, ctx, { caller: workspaceOf(ctx), session });
  } catch (error) {
    return unavailable(`the target Session facts could not be read: ${messageOf(error)}`);
  }
  if (admission.status === 'rejected') {
    return unavailable(`the target Session could not be read: ${admission.code}: ${admission.reason}`);
  }
  if (admission.status !== 'ready') return unavailable('the target Session facts are not readable');
  if (admission.value.status === 'refused') {
    return { status: 'refused', reason: admission.value.reason, revision: admission.value.revision };
  }
  return { status: 'ready', value: {
    session: admission.value.session, profile: admission.value.profile, guards: admission.value.guards,
  } };
}

/** The submit-time profile of an existing owner: the one admission check, then its profile. */
async function profileForOwner(
  deps: RequestRoundDependencies, ctx: CoreCallContext, owner: SessionRef,
): Promise<{ status: 'ready'; profile: SecretaryProfileV1; guards: RecordGuard[] } | RequestRejectionV1> {
  const admitted = await admitTarget(deps, ctx, owner);
  if (admitted.status === 'refused') return unavailable(admitted.reason);
  if (admitted.status !== 'ready') return admitted;
  return { status: 'ready', profile: admitted.value.profile, guards: admitted.value.guards };
}

/** The submit-time profile for a round that waits: the new line's profile builds its intent. */
async function profileForWaiting(
  deps: RequestRoundDependencies, ctx: CoreCallContext,
): Promise<{ status: 'ready'; profile: SecretaryProfileV1 } | RequestRejectionV1> {
  let read: ReadResult<SecretaryProfileV1 | null>;
  try {
    read = await deps.profiles.forNewLine(ctx, { workspace: workspaceOf(ctx) });
  } catch (error) {
    return unavailable(`the secretary profile could not be read: ${messageOf(error)}`);
  }
  if (read.status === 'rejected') return unavailable(`the secretary profile read failed: ${read.reason}`);
  // Only a ready read that found no profile means "no binding"; any other
  // answer is a failed read.
  if (read.status !== 'ready') return unavailable(`the secretary profile read is not available (${read.status})`);
  if (read.value === null) return unavailable('no_secretary_binding');
  return { status: 'ready', profile: read.value };
}

// ------------------------------------------------------------------------ //
// Commit plumbing                                                           //
// ------------------------------------------------------------------------ //

/** The input an append lands on a Session; the one activity shape is `request-tail-fragment.ts`'s. */
export type PreparedAppendActivityV1 = RequestTailActivityV1;

/** The fragment one ordinary append carries: the frozen request side with the caller's activity; `end_unbound` leaves two nulls. */
type PreparedAppend = Omit<RequestTailCommitFragmentV1, 'activity' | 'receipt' | 'sinceRefKey'> & {
  receipt: RequestCommandReceiptV1 | null;
  sinceRefKey: string | null;
  activity: PreparedAppendActivityV1 | null;
};

type CommitOutcome =
  | { status: 'done'; result: RequestAppendResultV1 }
  | { status: 'tail_conflict' };

type PreparedOutcome =
  | { status: 'ready'; value: PreparedAppend }
  | { status: 'retry' }
  | RequestRejectionV1;

// ------------------------------------------------------------------------ //
// Replay                                                                    //
// ------------------------------------------------------------------------ //

/**
 * The stored result of a committed public command: the receipt is inside the
 * created round's `QueryJobSubmitted` event, so a replay never rebuilds it from
 * the later snapshot and never runs a pick or a line.
 */
async function replayPublic(
  deps: RequestRoundDependencies, identityKey: string, fingerprint: string,
): Promise<{ status: 'ready'; result: RequestAppendResultV1 } | { status: 'none' } | RequestRejectionV1> {
  const found = await lookupCommittedReceipt(deps.records, identityKey, fingerprint);
  switch (found.status) {
    case 'found': return { status: 'ready', result: await receiptOf(deps, found.receipt, identityKey, fingerprint) };
    case 'missing': return { status: 'none' };
    case 'conflict': return rejected('idempotency_conflict', found.reason);
    case 'invalid': return rejected('invalid', found.reason);
    default: return unavailable(`the idempotency lookup failed: ${found.reason}`);
  }
}

/** The one committed-request replay: event type, decoder, identity, receipt projection and request wording. */
function requestReplayFailure(failure: ReceiptReplayFailure): RequestRejectionV1 {
  switch (failure.kind) {
    case 'event_unreadable':
      return unavailable(`the original request event could not be read: ${messageOf(failure.error)}`);
    case 'event_rejected':
      return unavailable(`the original request event is not readable: ${failure.rejection.code}: ${failure.rejection.reason}`);
    case 'wrong_event_type':
      return unavailable(`the original request event is damaged: not a ${failure.expectedEventType} event`);
    case 'receipt_mismatch':
      return unavailable('the original request event disagrees with its receipt');
    case 'undecodable':
      return unavailable(`the original request event is damaged: ${failure.reason}`);
    case 'identity_mismatch':
      return unavailable('the original request event carries another identity');
  }
}

async function receiptOf(
  deps: RequestRoundDependencies,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  identityKey: string, fingerprint: string,
): Promise<RequestAppendResultV1> {
  const replayed = await replayCommittedReceipt<QueryJobSubmittedEventV1, RequestAppendResultV1>({
    receipt,
    eventAt: (cursor) => deps.records.eventAt(cursor),
    expectedEventType: 'QueryJobSubmitted',
    decode: decodeQueryJobSubmittedEvent,
    expected: { identityKey, fingerprint },
    identityKey: (decoded) => decoded.identityKey,
    fingerprint: (decoded) => decoded.fingerprint,
    validate: (decoded) => decoded.payload.job.receipt === null
      ? unavailable('the original request event carries no receipt') : null,
    project: (decoded) => ({ status: 'appended', receipt: decoded.payload.job.receipt!, replayed: true }),
    onFailure: requestReplayFailure,
  });
  return replayed.status === 'committed' ? replayed.value : unavailable(replayed.reason);
}

// ------------------------------------------------------------------------ //
// Intake changes (the one-change-per-key rule)                              //
// ------------------------------------------------------------------------ //

type IntakeInput = {
  /** The pending round that currently holds an intake, if any. */
  holder: QueryJobSnapshot | null;
  /** The Session whose intake this commit should take. */
  desire: SessionRef;
  /** Which round holds it after this commit: the new round, or an existing holder (the drain). */
  next: { kind: 'new'; key: string } | { kind: 'existing'; job: QueryJobSnapshot };
};

type IntakeChanges = { claims: UniqueClaimChange[]; records: EncodedRecord[]; guards: RecordGuard[] };

/**
 * One change per intake key (`commit-extensions.ts:77`): a release and a take of
 * the SAME Session merge into one move; only different Sessions get two changes.
 * `setIntake` never rewrites a round whose field already matches.
 */
function intakeChanges(input: IntakeInput): IntakeChanges {
  const claims: UniqueClaimChange[] = [];
  const records: EncodedRecord[] = [];
  const guards: RecordGuard[] = [];
  const holder = input.holder;
  const oldKey = holder === null || holder.job.intakeSession === null ? null : secretaryIntakeKey(holder.job.intakeSession);
  const oldHolderKey = holder === null ? null : keyOf(holder.ref);
  const desiredKey = secretaryIntakeKey(input.desire);
  const nextKey = input.next.kind === 'new' ? input.next.key : keyOf(input.next.job.ref);

  // The FINAL intakeSession of every round this commit touches, keyed by ref:
  // a release and a take on the same holder round are ONE record, never two
  // (the store refuses a ref twice; one change per intake key).
  const writes: { job: QueryJobSnapshot; session: SessionRef | null }[] = [];
  const queueWrite = (job: QueryJobSnapshot, session: SessionRef | null): void => {
    const existing = writes.find((entry) => keyOf(entry.job.ref) === keyOf(job.ref));
    if (existing !== undefined) {
      existing.session = session;
      return;
    }
    writes.push({ job, session });
  };

  const sameHolder = oldHolderKey !== null && oldHolderKey === nextKey;
  if (oldKey === desiredKey && oldHolderKey !== null) {
    // The same Session keeps the key: one move of one key, never release + take.
    claims.push({ claimKey: desiredKey, expectedOwner: oldHolderKey, nextOwner: nextKey });
    if (!sameHolder) {
      // A different existing round becomes the holder: BOTH records change.
      queueWrite(holder!, null);
      if (input.next.kind === 'existing') queueWrite(input.next.job, input.desire);
    }
  } else {
    if (oldKey !== null && oldHolderKey !== null) {
      claims.push({ claimKey: oldKey, expectedOwner: oldHolderKey, nextOwner: null });
      // The same holder round both releases X and takes S: one record with S.
      queueWrite(holder!, sameHolder ? input.desire : null);
    }
    claims.push({ claimKey: desiredKey, expectedOwner: null, nextOwner: nextKey });
    if (input.next.kind === 'existing' && !sameHolder) queueWrite(input.next.job, input.desire);
  }

  for (const entry of writes) {
    const next = setIntake(entry.job, entry.session);
    if (next.revision === entry.job.revision && sameJson(next.job, entry.job.job)) continue;
    records.push(encodeQueryJobSnapshot(next));
    guards.push({ refKey: keyOf(entry.job.ref), expectedRevision: entry.job.revision });
  }
  return { claims, records, guards };
}

/** The pending round that currently holds an intake, if any (the invariant allows at most one). */
function intakeHolder(facts: RequestRoundsFactsV1): QueryJobSnapshot | null {
  return facts.rounds.find((round) => round.job.intakeSession !== null) ?? null;
}

/** A round that has not entered the Kernel: pending or running Job, pending/claimed/prepared Run. */
function unstarted(facts: RequestRoundsFactsV1): QueryJobSnapshot[] {
  const runByKey = new Map(facts.runs.map((run) => [keyOf(run.ref), run]));
  return facts.rounds.filter((round) => {
    if (round.job.status !== 'pending' && round.job.status !== 'running') return false;
    const runRef = round.job.runRef;
    if (runRef === null) return false;
    const run = runByKey.get(keyOf(runRef));
    if (run === undefined) return false;
    if (run.run.status === 'answered' || run.run.status === 'closed' || run.run.outcome !== null) return false;
    const phase = run.run.executionState?.phase;
    return phase === undefined || phase === 'claimed' || phase === 'prepared';
  });
}

// ------------------------------------------------------------------------ //
// Round and event builders                                                  //
// ------------------------------------------------------------------------ //

function intentOf(input: {
  scope: WorkspaceScope; queryJobId: string; goalId: string | null; text: string;
  profile: SecretaryProfileV1; correlationId: string;
}): QueryJobIntentV1 {
  return {
    schemaVersion: 1,
    intentId: input.queryJobId,
    projectId: input.scope.projectId,
    workspaceId: input.scope.workspaceId,
    goalId: input.goalId,
    question: input.text,
    focusTaskRefs: [],
    budget: structuredClone(input.profile.budget),
    multiTurn: { maxRounds: 1 },
    correlationId: input.correlationId,
    execution: {
      kind: 'semantic_query',
      roleBinding: structuredClone(input.profile.roleBinding),
      runtimeBudget: structuredClone(input.profile.runtimeBudget),
    },
  };
}

// ------------------------------------------------------------------------ //
// select_idea validation                                                   //
// ------------------------------------------------------------------------ //

function selectIdeaProblemOf(view: RequestCoreViewV1, round: QueryJobRef, index: number): RequestRejectionV1 | null {
  const target = view.rounds.find((candidate) => sameJson(candidate.ref, round));
  if (target === undefined) return rejected('not_found', 'the round does not belong to its request');
  if (target.answer === null) return rejected('invalid', 'the round has no answer yet');
  // An answer with no idea leaves nothing to select; any other count outside the idea rule is refused too.
  if (target.ideas.length === 0 || !validIdeaCount(target.ideas.length)) {
    return rejected('invalid', 'the answer does not carry 2-3 ideas');
  }
  if (index >= target.ideas.length) return rejected('invalid', 'index is outside the answer ideas');
  const latest = latestAnsweredRound(view.rounds, (candidate) => candidate.answer !== null);
  if (latest === null || !sameJson(latest, round)) {
    return rejected('revision_conflict', 'the round is no longer the request latest answered round');
  }
  return null;
}

/**
 * The one assignment-row decision (the submit rows and `route`'s
 * from-state rows). Pure: the caller supplies the command and the facts this
 * owner reads. Workflow calls it to decide whether to pick; `append` calls it
 * to review the plan it was handed.
 */
export function requestAssignmentRow(
  command: RequestPublicCommandV1,
  facts: { ownerState: RequestOwnerStateV1 } | null,
): 'follow_owner' | 'wait' | 'pick' | 'recipient' {
  if (command.kind === 'route') return command.reason === 'dropped' ? 'wait' : 'recipient';
  if (command.kind === 'submit' && command.recipient !== null) return 'recipient';
  if (facts === null) return 'pick';
  if (facts.ownerState === 'owned') return 'follow_owner';
  if (facts.ownerState === 'waiting') return 'wait';
  return 'pick';
}

// ------------------------------------------------------------------------ //
// Ending a claimed or prepared attempt                                      //
// ------------------------------------------------------------------------ //

/** The Session a claimed or prepared QueryRun names: its read guard and, while it still holds it, the release. */
type ClaimedSession = { guard: RecordGuard; released: SessionRecord | null };

/**
 * The Session a claimed or prepared QueryRun names. Ending the run reads it, so
 * its guard always joins the commit; the released record is written only while
 * the run still holds the occupancy. The release is the Query terminal's own
 * Session rule (SES-08): the claim generation, the run's phase, and the same
 * guard facts the terminal passes.
 */
async function readClaimedSession(
  deps: RequestRoundDependencies, run: QueryRunSnapshot,
): Promise<{ status: 'ready'; claimed: ClaimedSession | null } | RequestRejectionV1> {
  const state = run.run.executionState;
  if (state === undefined || (state.phase !== 'claimed' && state.phase !== 'prepared')) {
    return { status: 'ready', claimed: null };
  }
  const read = await readOne(deps.records, plainSessionRefToAggregate(state.sessionRef), decodeSessionRecord);
  if (read.status === 'not_found') return unavailable('the claimed Session does not exist');
  if (read.status === 'rejected') return unavailable(`the claimed Session could not be read: ${read.reason}`);
  const released = releaseUnenteredQuerySession(read.value, run);
  if (!released.ok) return unavailable(`the claimed Session occupancy could not be released: ${released.detail}`);
  return { status: 'ready', claimed: { guard: read.guard, released: released.released } };
}

// ------------------------------------------------------------------------ //
// One page of the open-rounds index                                         //
// ------------------------------------------------------------------------ //

/** One cursor position of the open-rounds index: the ordered value and the record key after it. */
type OpenIndexCursor = { order: string | number; refKey: string };

/** One decoded page of the open-rounds index: the rows, the cursor it resumed after, and the store's next. */
type OpenIndexPage = {
  rows: { snapshot: QueryJobSnapshot; refKey: string }[];
  after: OpenIndexCursor | null;
  next: OpenIndexCursor | null;
};

/**
 * One bounded page of `s6-query-open-by-workspace` and the continuation around
 * it, shared by the two named reads (`unassigned`, `open`): both walk the same
 * index of the same workspace and differ only in the status partition and in
 * what they project from each round.
 *
 * The continuation is the cursor the previous call resumed after; an unreadable
 * one is `invalid`. One call reads exactly one index page (`REQUEST_PAGE_SIZE`):
 * the page budget belongs to the caller, so a read never fills `limit` across
 * pages. A damaged candidate is the whole read's failure, never a skipped row.
 */
async function readOpenIndexPage(
  deps: RequestRoundDependencies, scope: WorkspaceScope, status: 'pending' | 'running',
  continuation: string | null, labels: { read: string; damaged: string },
): Promise<ReadResult<OpenIndexPage>> {
  let after: OpenIndexCursor | undefined;
  if (continuation !== null) {
    try {
      const parsed = JSON.parse(continuation) as { order?: unknown; refKey?: unknown };
      if (typeof parsed.order !== 'string' || typeof parsed.refKey !== 'string') throw new Error('shape');
      after = { order: parsed.order, refKey: parsed.refKey };
    } catch {
      return { status: 'rejected', code: 'invalid', reason: 'continuation is not a readable cursor' };
    }
  }
  let page: Awaited<ReturnType<RequestServiceStore['lookupOrdered']>>;
  try {
    page = await deps.records.lookupOrdered({
      index: QUERY_OPEN_BY_WORKSPACE_INDEX,
      values: [scope.projectId, scope.workspaceId, 'request', status],
      direction: 'asc',
      ...(after === undefined ? {} : { after }),
      limit: REQUEST_PAGE_SIZE,
    });
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: `the ${labels.read} read failed: ${messageOf(error)}` };
  }
  if (page.status !== 'ready') {
    return { status: 'rejected', code: 'unavailable',
      reason: `the ${labels.read} read failed: ${page.code}: ${page.reason}` };
  }
  const rows: OpenIndexPage['rows'] = [];
  for (const record of page.value.records) {
    let decoded;
    try {
      decoded = decodeQueryJobSnapshot(record);
    } catch (error) {
      return { status: 'rejected', code: 'unavailable',
        reason: `${labels.damaged} is damaged: ${messageOf(error)}` };
    }
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `${labels.damaged} is damaged: ${decoded.reason}` };
    }
    rows.push({ snapshot: decoded.value, refKey: record.refKey });
  }
  return { status: 'ready', value: { rows, after: after ?? null, next: page.value.next } };
}

// ------------------------------------------------------------------------ //
// The factory                                                               //
// ------------------------------------------------------------------------ //

export function createRequestRoundService(deps: RequestRoundDependencies): RequestRoundPort {
  // ---------------------------------------------------------------------- //
  // precheck                                                               //
  // ---------------------------------------------------------------------- //

  async function precheck(ctx: CoreCallContext, command: RequestPublicCommandV1):
    Promise<{ status: 'replay'; result: RequestAppendResultV1 }
      | { status: 'fresh'; command: RequestPublicCommandV1; facts: RequestCoreViewV1 | null }
      | RequestRejectionV1> {
    // (1) only the person, before anything is read.
    const principal = hostPrincipalOf(ctx, 'human');
    if (principal === null) return rejected('forbidden', 'only the person may issue a request command');
    // (2) pure input checks, nothing read.
    const shape = publicCommandProblem(command, ctx.projectId);
    if (shape !== null) return rejected('invalid', shape);

    // (3) identity and fingerprint.
    const identityKey = commandIdentity({ operation: `request.${command.kind}`,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(principal), commandId: command.commandId });
    const fingerprint = commandFingerprint(command);

    // (4) a committed receipt replays before any pick, line or time-dependent check.
    const replay = await replayPublic(deps, identityKey, fingerprint);
    if (replay.status === 'ready') return { status: 'replay', result: replay.result };
    if (replay.status === 'rejected') return replay;

    // (5) fresh current-fact checks.
    if (command.kind === 'submit') {
      if (command.goalId !== null) {
        const goal = await readLiveGoal(deps, ctx, command.goalId);
        if (goal.status !== 'ready') return goal;
      }
      if (command.continues === null) return { status: 'fresh', command, facts: null };
      const facts = await readRequestFacts(deps, ctx, command.continues);
      if (facts.status !== 'ready') return facts;
      if (command.goalId !== null && command.goalId !== facts.facts.requestGoalId) {
        return rejected('invalid', 'goalId must be null or the request goal');
      }
      const view = await readRequestView(deps, ctx, command.continues);
      if (view.status !== 'ready') return view;
      return { status: 'fresh', command, facts: view.view };
    }

    const resolved = await resolveRequestRoot(deps.records, ctx, command.round);
    if (resolved.status === 'not_found') {
      return rejected('not_found', 'the round is not a request round of this workspace');
    }
    if (resolved.status === 'rejected') return unavailable(resolved.reason);
    const view = await readRequestView(deps, ctx, resolved.root);
    if (view.status !== 'ready') return view;
    if (command.kind === 'select_idea') {
      const problem = selectIdeaProblemOf(view.view, command.round, command.index);
      if (problem !== null) return problem;
    }
    if (command.kind === 'ask') {
      const cards = await readCardObjects(deps.records, command.cardRefs);
      if (cards !== null) return cards;
    }
    return { status: 'fresh', command, facts: view.view };
  }

  // ---------------------------------------------------------------------- //
  // append                                                                 //
  // ---------------------------------------------------------------------- //

  async function append(ctx: CoreCallContext,
    input: { command: RequestPublicCommandV1; plan: RequestPlanV1 } | { command: RequestInternalCommandV1 },
  ): Promise<RequestAppendResultV1> {
    if ('plan' in input) {
      const person = hostPrincipalOf(ctx, 'human');
      if (person === null) return rejected('forbidden', 'only the person may append a public request command');
      const shape = publicCommandProblem(input.command, ctx.projectId);
      if (shape !== null) return rejected('invalid', shape);
      return appendPublic(ctx, person, input.command, input.plan);
    }
    // Internal commands are authorized by principal kind, not by a human actor.
    const system = hostPrincipalOf(ctx, 'system');
    if (system === null) {
      return rejected('forbidden', 'only the trusted system actor may append an internal request command');
    }
    return appendInternal(ctx, system, input.command);
  }

  async function appendPublic(ctx: CoreCallContext, principal: HostPrincipal, command: RequestPublicCommandV1,
    plan: RequestPlanV1): Promise<RequestAppendResultV1> {
    const identityKey = commandIdentity({ operation: `request.${command.kind}`,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(principal), commandId: command.commandId });
    const fingerprint = commandFingerprint(command);
    const replay = await replayPublic(deps, identityKey, fingerprint);
    if (replay.status === 'ready') return replay.result;
    if (replay.status === 'rejected') return replay;
    return withTailRetries(() => preparePublic(ctx, principal, command, plan, identityKey, fingerprint),
      (prepared) => commitPrepared(identityKey, fingerprint, prepared));
  }

  /** The one replay lookup of an internal append; a found receipt is projected, every failure is the owner's answer. */
  async function replayInternal(identityKey: string, fingerprint: string,
    ended: (() => RequestAppendResultV1) | null): Promise<RequestAppendResultV1 | null> {
    const replay = await lookupCommittedReceipt(deps.records, identityKey, fingerprint);
    if (replay.status === 'found') {
      if (ended !== null) return ended();
      return receiptOf(deps, replay.receipt, identityKey, fingerprint);
    }
    if (replay.status === 'conflict') return rejected('idempotency_conflict', replay.reason);
    if (replay.status === 'invalid') return rejected('invalid', replay.reason);
    if (replay.status !== 'missing') return unavailable(`the idempotency lookup failed: ${replay.reason}`);
    return null;
  }

  async function appendInternal(ctx: CoreCallContext, principal: HostPrincipal, command: RequestInternalCommandV1):
    Promise<RequestAppendResultV1> {
    if (command.kind === 'request_understanding') {
      const { identityKey, fingerprint } = receiptKeysOf(ctx, command)!;
      const replayed = await replayInternal(identityKey, fingerprint, null);
      if (replayed !== null) return replayed;
      return withTailRetries(() => prepareUnderstanding(ctx, command, identityKey, fingerprint),
        (prepared) => commitPrepared(identityKey, fingerprint, prepared));
    }
    if (command.kind === 'handoff' || command.kind === 'archived') {
      const { identityKey, fingerprint } = receiptKeysOf(ctx, command)!;
      const replayed = await replayInternal(identityKey, fingerprint, null);
      if (replayed !== null) return replayed;
      return withTailRetries(() => prepareInternalRoute(ctx, command, identityKey, fingerprint),
        (prepared) => commitPrepared(identityKey, fingerprint, prepared));
    }
    if (command.kind === 'reply' || command.kind === 'expiry') {
      const identityKey = commandIdentity({ operation: `request.${command.kind}`,
        scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
        principal: principalIdentity(principal), commandId: command.operationId });
      // The delivery text is not part of the identity: the message ref is.
      const fingerprint = sha256Hex(canonicalJson({ kind: command.kind,
        requestRoot: command.requestRoot, messageRef: command.messageRef } as unknown as JsonValue));
      const replayed = await replayInternal(identityKey, fingerprint, null);
      if (replayed !== null) return replayed;
      return withTailRetries(() => prepareReplyOrExpiry(ctx, principal, command, identityKey, fingerprint),
        (prepared) => commitPrepared(identityKey, fingerprint, prepared));
    }
    if (command.kind !== 'assigned' && command.kind !== 'end_unbound') {
      return unavailable(`the ${command.kind} operation has no producer on this platform`);
    }
    const identityKey = commandIdentity({ operation: `request.${command.kind}`,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: principalIdentity(principal), commandId: command.operationId });
    const fingerprint = sha256Hex(canonicalJson({ kind: command.kind,
      root: command.kind === 'assigned' ? command.requestRoot : null,
      round: command.kind === 'end_unbound' ? command.round : null,
      to: command.kind === 'assigned' ? command.to : null } as unknown as JsonValue));
    const replayed = await replayInternal(identityKey, fingerprint,
      command.kind === 'end_unbound' ? () => ({ status: 'ended', round: { ...command.round }, replayed: true }) : null);
    if (replayed !== null) return replayed;

    if (command.kind === 'assigned') {
      return withTailRetries(() => prepareAssigned(ctx, principal, command, identityKey, fingerprint),
        (prepared) => commitPrepared(identityKey, fingerprint, prepared));
    }
    return withTailRetries(() => prepareEndUnbound(ctx, principal, command, identityKey, fingerprint),
      (prepared) => commitPrepared(identityKey, fingerprint, prepared));
  }

  /**
   * The internal understanding input: a follow-up round on the named root,
   * carrying the command, run on the operation's source Session, written in one
   * commit with the old secretary's input activity. The operation record is
   * read through the same records port; its guard joins the commit.
   */
  async function prepareUnderstanding(ctx: CoreCallContext,
    command: RequestUnderstandingCommandV1 & { kind: 'request_understanding' },
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const operationRead = await readOne(deps.records, command.operation, decodeSessionOperationRecord);
    if (operationRead.status === 'not_found') return rejected('not_found', 'the understanding operation does not exist');
    if (operationRead.status === 'rejected') return unavailable(`the understanding operation could not be read: ${operationRead.reason}`);
    const operation: SessionOperationRecord = operationRead.value;
    if (operation.action.kind !== 'handoff') {
      return rejected('invalid', 'the understanding command names an operation that is not a handoff');
    }
    if (currentUnderstandingGeneration(operation) !== command.generation) {
      return rejected('busy', "the command generation is not the operation's current understanding generation");
    }
    const source = operation.action.input.source;
    const read = await readRequestFacts(deps, ctx, command.requestRoot);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    if (facts.owner === null || !sameJson(facts.owner, source)) {
      return rejected('invalid', 'the request root is not owned by the operation source');
    }
    const rootJob = facts.rounds.find((round) => sameJson(round.ref, command.requestRoot));
    if (rootJob === undefined) {
      return unavailable('the understanding command names a root that the request facts do not list');
    }
    const profile = await profileForOwner(deps, ctx, source);
    if (profile.status !== 'ready') return profile;

    const scope = workspaceOf(ctx);
    const queryJobId = deps.operationId();
    const roundRef = queryJobRefFor(scope.projectId, scope.workspaceId, queryJobId);
    const occurredAt = deps.now();
    const intent = intentOf({ scope, queryJobId, goalId: rootJob.job.requestGoalId,
      text: rootJob.job.intent.question, profile: profile.profile, correlationId: command.commandId });
    const receipt: Extract<RequestCommandReceiptV1, { kind: 'understanding' }> = {
      kind: 'understanding', round: { ...roundRef },
    };
    const eventId = deps.operationId();
    const pair = newRequestRound({
      queryJobId, runId: `run-${queryJobId}`, scope, intent, kind: 'followup',
      requestRoot: command.requestRoot, requestGoalId: rootJob.job.requestGoalId,
      assignedSession: { ...source }, intakeSession: null, selectedIdea: null, relatedCardRefs: [],
      relatedMessageRef: null, receipt, submission: requestTailSubmissionOf(identityKey, fingerprint, eventId),
      submittedAt: occurredAt,
      understanding: command,
    });
    const guards = preparedGuards([
      facts.guards,
      [operationRead.guard, { refKey: keyOf(rootJob.ref), expectedRevision: rootJob.revision }],
      profile.guards,
      [nullGuard(keyOf(pair.job.ref)), nullGuard(keyOf(pair.run.ref))],
    ], { source: 'none', sessionRefKeys: [] });
    if (guards.status !== 'ready') return guards;
    return {
      status: 'ready',
      value: {
        receipt, records: [encodeQueryJobSnapshot(pair.job), encodeQueryRunSnapshotRecord(pair.run)],
        events: [encodeQueryJobSubmittedEvent(submittedEvent({ principal: HANDOFF_SYSTEM_PRINCIPAL, job: pair.job,
          eventId, identityKey, fingerprint, commandId: command.commandId, occurredAt }))],
        guards: guards.guards,
        claims: [moveTailClaim(facts, command.requestRoot, roundRef)],
        round: roundRef, sinceRefKey: keyOf(pair.job.ref),
        activity: { session: { ...source }, at: occurredAt, source: { ...roundRef } },
        conflict: { source: 'none', sessionRefKeys: [], intakeKey: null },
      },
    };
  }

  /**
   * A reply or expiry round on the request its message names: the request's
   * current secretary (the successor after a handoff) through the one owner
   * row, then the one round builder. The message body is not read here: the
   * round's preparation freezes it from the stored message.
   */
  async function prepareReplyOrExpiry(ctx: CoreCallContext, principal: HostPrincipal,
    command: Extract<RequestInternalCommandV1, { kind: 'reply' | 'expiry' }>,
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const read = await readRequestFacts(deps, ctx, command.requestRoot);
    if (read.status !== 'ready') return read;
    const { facts } = read;
    const root = facts.rounds.find((round) => sameJson(round.ref, command.requestRoot));
    const assignment = await resolveAssignment(ctx, facts, NO_PLAN, 'follow_owner', null);
    if (assignment.status !== 'ready') return assignment;
    return buildRound({
      ctx, principal, commandId: command.operationId, identityKey, fingerprint, occurredAt: deps.now(),
      requestRoot: { ...command.requestRoot }, kind: command.kind, requestGoalId: facts.requestGoalId,
      text: root!.job.intent.question, selectedIdea: null, relatedCardRefs: [],
      relatedMessageRef: { ...command.messageRef }, createdLine: false, receiptKind: command.kind,
      facts, goalGuard: null, assignment: assignment.value,
    });
  }

  /** Re-read and re-commit on every tail conflict, up to SECRETARY_TAIL_RETRIES, then `busy`. */
  async function withTailRetries(
    prepare: () => Promise<PreparedOutcome>,
    commit: (prepared: PreparedAppend) => Promise<CommitOutcome>,
  ): Promise<RequestAppendResultV1> {
    for (let attempt = 0; attempt <= SECRETARY_TAIL_RETRIES; attempt += 1) {
      const prepared = await prepare();
      // A conflict that re-picks or answers `busy` is final; a moved read window
      // and a committed tail conflict re-read it.
      if (prepared.status === 'retry') continue;
      if (prepared.status !== 'ready') return prepared;
      const outcome = await commit(prepared.value);
      if (outcome.status === 'done') return outcome.result;
    }
    return rejected('busy', 'the request tail changed during the append');
  }

  async function preparePublic(
    ctx: CoreCallContext, principal: HostPrincipal, command: RequestPublicCommandV1, plan: RequestPlanV1,
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    switch (command.kind) {
      case 'submit': return prepareSubmit(ctx, principal, command, plan, identityKey, fingerprint);
      case 'route': return prepareRoute(ctx, principal, command, identityKey, fingerprint);
      case 'select_idea':
      case 'ask':
        return prepareFollowup(ctx, principal, command, plan, identityKey, fingerprint);
    }
  }

  // ---------------------------------------------------------------------- //
  // submit                                                                 //
  // ---------------------------------------------------------------------- //

  async function prepareSubmit(
    ctx: CoreCallContext, principal: HostPrincipal, command: Extract<RequestPublicCommandV1, { kind: 'submit' }>,
    plan: RequestPlanV1, identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    // The facts this command guards (a follow-up reads its request).
    let facts: RequestRoundsFactsV1 | null = null;
    if (command.continues !== null) {
      const read = await readRequestFacts(deps, ctx, command.continues);
      if (read.status !== 'ready') return read;
      facts = read.facts;
      if (command.goalId !== null && command.goalId !== facts.requestGoalId) {
        return rejected('invalid', 'goalId must be null or the request goal');
      }
    }
    // Every explicit non-null goalId (a follow-up's request goal included) is
    // re-read, checked live/workspace and guarded at append.
    let goalGuard: RecordGuard | null = null;
    if (command.goalId !== null) {
      const goal = await readLiveGoal(deps, ctx, command.goalId);
      if (goal.status !== 'ready') return goal;
      goalGuard = goal.guard;
    }

    const row = requestAssignmentRow(command, facts);
    const assignment = await resolveAssignment(ctx, facts, plan, row, command.recipient);
    if (assignment.status !== 'ready') return assignment;
    return buildRound({
      ctx, principal, commandId: command.commandId, identityKey, fingerprint, occurredAt: deps.now(),
      requestRoot: command.continues, kind: command.continues === null ? 'request' : 'followup',
      requestGoalId: command.continues === null ? command.goalId : facts!.requestGoalId,
      text: command.text, selectedIdea: null, relatedCardRefs: [], relatedMessageRef: null,
      createdLine: plan.createdLine, receiptKind: 'submit', facts, goalGuard, assignment: assignment.value,
    });
  }

  type Assignment = {
    assignedSession: SessionRef | null;
    takesIntake: boolean;
    /** Always present: a waiting round's intent uses the new line's profile. */
    profile: SecretaryProfileV1;
    guards: RecordGuard[];
    source: AssignmentSource;
    sessionRefKeys: string[];
  };

  async function resolveAssignment(
    ctx: CoreCallContext, facts: RequestRoundsFactsV1 | null, plan: RequestPlanV1,
    row: ReturnType<typeof requestAssignmentRow>, recipient: SessionRef | null,
  ): Promise<{ status: 'ready'; value: Assignment } | RequestRejectionV1> {
    if (row === 'recipient') {
      if (recipient === null) return unavailable('the request command names no recipient');
      // `@ S` on an owned request moves it without an intake; a new root or a
      // waiting / archived / dropped one takes S's intake on the new round.
      return assignTo(ctx, recipient, null, facts === null || facts.ownerState !== 'owned', 'recipient');
    }
    if (row === 'follow_owner') {
      const owner = facts?.owner ?? null;
      if (owner === null) return unavailable('the request has no owner');
      const profile = await profileForOwner(deps, ctx, owner);
      if (profile.status !== 'ready') return profile;
      return { status: 'ready', value: { assignedSession: { ...owner }, takesIntake: false, profile: profile.profile,
        guards: profile.guards, source: 'none', sessionRefKeys: [] } };
    }
    if (row === 'wait' || plan.capacityBlocked) {
      const waiting = await profileForWaiting(deps, ctx);
      if (waiting.status !== 'ready') return waiting;
      return { status: 'ready', value: { assignedSession: null, takesIntake: false, profile: waiting.profile,
        guards: [], source: 'none', sessionRefKeys: [] } };
    }
    // The `pick` row: a plan that made no pick is stale, never a capacity block.
    if (plan.assignTo === null) return rejected('revision_conflict', 'the request changed since the plan');
    return assignTo(ctx, plan.assignTo.session, plan.assignTo.guard, true, 'fresh');
  }

  async function assignTo(
    ctx: CoreCallContext, session: SessionRef, guard: VersionedRef | null, takesIntake: boolean, source: AssignmentSource,
  ): Promise<{ status: 'ready'; value: Assignment } | RequestRejectionV1> {
    if (guard !== null && !sameJson(guard.ref, plainSessionRefToAggregate(session))) {
      return rejected('invalid', 'the assignment guard names another Session');
    }
    const admitted = await admitTarget(deps, ctx, session);
    if (admitted.status === 'rejected') return admitted;
    // A target that changed since the pick (an archive included) is a conflict
    // of its source before it is a refusal: the pick was made on facts that no
    // longer hold.
    const revision = admitted.status === 'ready' ? admitted.value.session.revision : admitted.revision;
    if (guard !== null && revision !== null && guard.revision !== revision) {
      return targetConflict(source, 'the target Session changed since the pick');
    }
    if (admitted.status === 'refused') return unavailable(admitted.reason);
    return { status: 'ready', value: {
      assignedSession: { ...session }, takesIntake, profile: admitted.value.profile, guards: admitted.value.guards,
      source, sessionRefKeys: [sessionAggregateRefKey(plainSessionRefToAggregate(session))],
    } };
  }

  type BuildRoundInput = {
    ctx: CoreCallContext; principal: HostPrincipal; commandId: string; identityKey: string; fingerprint: string;
    occurredAt: string;
    requestRoot: QueryJobRef | null; kind: 'request' | 'followup' | 'reply' | 'expiry'; requestGoalId: string | null;
    text: string; selectedIdea: { round: QueryJobRef; index: number } | null; relatedCardRefs: VersionedRef[];
    createdLine: boolean; receiptKind: 'submit' | 'select_idea' | 'ask' | 'reply' | 'expiry';
    /** The message a reply/expiry round answers: the round's own and its receipt's `relatedMessageRef`. */
    relatedMessageRef: SessionMessageRef | null;
    facts: RequestRoundsFactsV1 | null; goalGuard: RecordGuard | null; assignment: Assignment;
  };

  /** The one round builder: the person's commands, the reply/expiry rounds and the understanding round build through it. */
  async function buildRound(input: BuildRoundInput): Promise<PreparedOutcome> {
    const scope = workspaceOf(input.ctx);
    const queryJobId = deps.operationId();
    const roundRef = queryJobRefFor(scope.projectId, scope.workspaceId, queryJobId);
    const requestRoot = input.requestRoot ?? roundRef;
    const assignment = input.assignment;
    const intent = intentOf({ scope, queryJobId, goalId: input.requestGoalId, text: input.text,
      profile: assignment.profile, correlationId: input.commandId });
    const secretary = assignment.assignedSession === null ? null : { ...assignment.assignedSession };
    let receipt: RequestCommandReceiptV1;
    if (input.receiptKind === 'reply' || input.receiptKind === 'expiry') {
      receipt = { kind: input.receiptKind, round: { ...roundRef },
        relatedMessageRef: { ...input.relatedMessageRef! }, secretary: { ...secretary! } };
    } else if (input.receiptKind === 'submit') {
      receipt = secretary === null
        ? { kind: 'submit', requestRoot: { ...requestRoot }, round: { ...roundRef }, assignment: 'unassigned',
            secretary: null, created: false }
        : { kind: 'submit', requestRoot: { ...requestRoot }, round: { ...roundRef }, assignment: 'assigned',
            secretary, created: input.createdLine };
    } else if (input.receiptKind === 'select_idea') {
      receipt = { kind: 'select_idea', followupRound: { ...roundRef }, secretary };
    } else {
      receipt = { kind: 'ask', followupRound: { ...roundRef }, secretary };
    }
    const eventId = deps.operationId();
    const pair = newRequestRound({
      queryJobId, runId: `run-${queryJobId}`, scope, intent, kind: input.kind, requestRoot: input.requestRoot,
      requestGoalId: input.requestGoalId, assignedSession: assignment.assignedSession,
      // A new pick takes S's intake on THIS round; a waiting round and an owner
      // follow-up take none.
      intakeSession: assignment.takesIntake && assignment.assignedSession !== null ? assignment.assignedSession : null,
      selectedIdea: input.selectedIdea, relatedCardRefs: input.relatedCardRefs,
      relatedMessageRef: input.relatedMessageRef, receipt,
      submission: requestTailSubmissionOf(input.identityKey, input.fingerprint, eventId), submittedAt: input.occurredAt,
      understanding: null,
    });
    const records: EncodedRecord[] = [encodeQueryJobSnapshot(pair.job), encodeQueryRunSnapshotRecord(pair.run)];
    const claims: UniqueClaimChange[] = [moveTailClaim(input.facts, requestRoot, roundRef)];
    const guardGroups: RecordGuard[][] = [input.facts === null ? [] : input.facts.guards, assignment.guards];
    if (assignment.takesIntake && assignment.assignedSession !== null) {
      const changes = intakeChanges({
        holder: input.facts === null ? null : intakeHolder(input.facts),
        desire: assignment.assignedSession,
        next: { kind: 'new', key: keyOf(pair.job.ref) },
      });
      claims.push(...changes.claims);
      records.push(...changes.records);
      guardGroups.push(changes.guards);
    }
    if (input.goalGuard !== null) guardGroups.push([input.goalGuard]);
    const guards = preparedGuards([...guardGroups, [nullGuard(keyOf(pair.job.ref)), nullGuard(keyOf(pair.run.ref))]],
      assignment);
    if (guards.status !== 'ready') return guards;
    return {
      status: 'ready',
      value: {
        receipt, records,
        events: [encodeQueryJobSubmittedEvent(submittedEvent({ principal: input.principal, job: pair.job, eventId,
          identityKey: input.identityKey, fingerprint: input.fingerprint, commandId: input.commandId,
          occurredAt: input.occurredAt }))],
        guards: guards.guards, claims, round: roundRef, sinceRefKey: keyOf(pair.job.ref),
        activity: secretary === null ? null : { session: secretary, at: input.occurredAt, source: { ...roundRef } },
        conflict: { source: assignment.source, sessionRefKeys: assignment.sessionRefKeys,
          intakeKey: assignment.takesIntake && assignment.assignedSession !== null
            ? secretaryIntakeKey(assignment.assignedSession) : null },
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // route                                                                  //
  // ---------------------------------------------------------------------- //

  type RouteRoundInput = {
    ctx: CoreCallContext; principal: HostPrincipal; commandId: string;
    identityKey: string; fingerprint: string;
    facts: RequestRoundsFactsV1; requestRoot: QueryJobRef;
    routing: NonNullable<QueryJobSnapshot['job']['routing']>; target: SessionRef | null;
  };

  /** The one routing-round writer: both the person's route and the trusted internal one build through it. */
  async function buildRouteRound(input: RouteRoundInput): Promise<PreparedOutcome> {
    const { ctx, facts, requestRoot, routing, target } = input;
    const occurredAt = deps.now();
    const roundRef = queryJobRefFor(ctx.projectId, ctx.workspaceId ?? '', deps.operationId());
    const claims: UniqueClaimChange[] = [moveTailClaim(facts, requestRoot, roundRef)];
    const records: EncodedRecord[] = [];
    const guardGroups: RecordGuard[][] = [facts.guards];
    const releasedSessions: SessionRecord[] = [];
    let source: AssignmentSource = 'none';
    let sessionRefKeys: string[] = [];
    let intakeKey: string | null = null;

    if (routing.reason === 'dropped') {
      if (facts.ownerState === 'dropped') return rejected('invalid', 'the request is already dropped');
      const holder = intakeHolder(facts);
      const endedRounds = unstarted(facts);
      for (const round of endedRounds) {
        const runRef = round.job.runRef;
        if (runRef === null) return unavailable('an unstarted round names no QueryRun');
        const run = facts.runs.find((candidate) => sameJson(candidate.ref, runRef));
        if (run === undefined) return unavailable('an unstarted round names a missing QueryRun');
        let ended = endUnstartedRound({ job: round as QueryJobSnapshot, run }, {
          detail: 'dropped', message: 'request_dropped', occurredAt,
        });
        if (holder !== null && sameJson(holder.ref, round.ref)) {
          ended = { job: setIntake(ended.job, null), run: ended.run };
          claims.push({ claimKey: secretaryIntakeKey(holder.job.intakeSession!), expectedOwner: keyOf(round.ref),
            nextOwner: null });
        }
        // A claimed or prepared attempt's Session is guarded; the occupancy its
        // claim generation still holds is released in this commit.
        const claimed = await readClaimedSession(deps, run);
        if (claimed.status !== 'ready') return claimed;
        if (claimed.claimed !== null) {
          guardGroups.push([claimed.claimed.guard]);
          const released = claimed.claimed.released;
          if (released !== null && !releasedSessions.some((session) =>
            sessionAggregateRefKey(session.ref) === sessionAggregateRefKey(released.ref))) {
            releasedSessions.push(released);
          }
        }
        records.push(encodeQueryJobSnapshot(ended.job), encodeQueryRunSnapshotRecord(ended.run));
      }
    } else {
      if (target === null) return rejected('invalid', 'a manual route requires a recipient');
      const assigned = await assignTo(ctx, target, null, false, 'recipient');
      if (assigned.status !== 'ready') return assigned;
      guardGroups.push(assigned.value.guards);
      source = assigned.value.source;
      sessionRefKeys = assigned.value.sessionRefKeys;
      // From `owned` a route takes no intake; otherwise it takes
      // `secretary-intake:<to>` on the oldest pending round as holder when there is one.
      if (facts.ownerState !== 'owned') {
        const holder = oldestPendingRound(facts);
        if (holder !== null) {
          const intake = intakeChanges({ holder: intakeHolder(facts), desire: target,
            next: { kind: 'existing', job: holder } });
          claims.push(...intake.claims);
          records.push(...intake.records);
          guardGroups.push(intake.guards);
          intakeKey = secretaryIntakeKey(target);
        }
      }
    }
    for (const released of releasedSessions) {
      records.push(encodeSessionRecord(released));
      sessionRefKeys = [...sessionRefKeys, sessionAggregateRefKey(released.ref)];
    }

    return prepareRoutingRequestTail(input.principal, {
      facts,
      command: { kind: 'routing', routing },
      identity: { commandId: input.commandId, identityKey: input.identityKey, fingerprint: input.fingerprint },
      scope: workspaceOf(ctx),
      submittedAt: occurredAt,
      roundRef,
      eventId: deps.operationId(),
      claims,
      records,
      guards: guardGroups,
      conflict: { source, sessionRefKeys, intakeKey },
      activity: target === null ? null : { session: { ...target }, at: occurredAt, source: { ...roundRef } },
    });
  }

  async function prepareRoute(
    ctx: CoreCallContext, principal: HostPrincipal, command: Extract<RequestPublicCommandV1, { kind: 'route' }>,
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const resolved = await resolveRequestRoot(deps.records, ctx, command.round);
    if (resolved.status === 'not_found') return rejected('not_found', 'the round is not a request round of this workspace');
    if (resolved.status === 'rejected') return unavailable(resolved.reason);
    const read = await readRequestFacts(deps, ctx, resolved.root);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    if (!facts.rounds.some((round) => sameJson(round.ref, command.round))) {
      return rejected('not_found', 'the round does not belong to the request it names');
    }
    const dropped = command.reason === 'dropped';
    const routing: NonNullable<QueryJobSnapshot['job']['routing']> = {
      from: facts.owner === null ? null : { ...facts.owner },
      to: dropped || command.to === null ? null : { ...command.to },
      reason: dropped ? 'dropped' : 'manual',
    };
    return buildRouteRound({ ctx, principal, commandId: command.commandId, identityKey, fingerprint,
      facts, requestRoot: resolved.root, routing, target: dropped ? null : command.to });
  }

  /** The trusted internal route: the same writer, with the owner pinned to the expected source. */
  async function prepareInternalRoute(
    ctx: CoreCallContext, command: InternalRouteCommandV1, identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const read = await readRequestFacts(deps, ctx, command.requestRoot);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    if (facts.owner === null || !sameJson(facts.owner, command.expectedSource)) {
      return rejected('busy', 'the request owner is not the expected source');
    }
    const routing: NonNullable<QueryJobSnapshot['job']['routing']> = {
      from: { ...facts.owner },
      to: command.to === null ? null : { ...command.to },
      reason: command.to === null ? 'dropped' : command.kind,
    };
    return buildRouteRound({ ctx, principal: HANDOFF_SYSTEM_PRINCIPAL,
      commandId: `${command.operationId}:routing:${command.requestRoot.queryJobId}`,
      identityKey, fingerprint, facts, requestRoot: command.requestRoot, routing, target: command.to });
  }

  // ---------------------------------------------------------------------- //
  // select_idea and ask                                                    //
  // ---------------------------------------------------------------------- //

  /**
   * A follow-up on the request of the round `select_idea` or `ask` names,
   * through the same assignment and round builder as `submit` (`continues: R,
   * recipient: null`): on the owner, waiting, or (with the caller's fresh pick)
   * on a new secretary that then holds the intake.
   */
  async function prepareFollowup(
    ctx: CoreCallContext, principal: HostPrincipal,
    command: Extract<RequestPublicCommandV1, { kind: 'select_idea' | 'ask' }>,
    plan: RequestPlanV1, identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const resolved = await resolveRequestRoot(deps.records, ctx, command.round);
    if (resolved.status === 'not_found') return rejected('not_found', 'the round is not a request round of this workspace');
    if (resolved.status === 'rejected') return unavailable(resolved.reason);
    const requestRoot = resolved.root;
    const read = await readRequestFacts(deps, ctx, requestRoot);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    let text: string;
    let selectedIdea: { round: QueryJobRef; index: number } | null = null;
    if (command.kind === 'select_idea') {
      // The view re-read and the latest-answered validation run inside this
      // retried path, so every tail retry validates against the facts it then
      // builds the follow-up on.
      const view = await readRequestView(deps, ctx, requestRoot);
      if (view.status !== 'ready') return view;
      const problem = selectIdeaProblemOf(view.view, command.round, command.index);
      if (problem !== null) return problem;
      const answered = view.view.rounds.find((round) => sameJson(round.ref, command.round));
      if (answered === undefined) return rejected('not_found', 'the round does not belong to its request');
      text = `选了第 ${command.index + 1} 个思路：${answered.ideas[command.index]!.title}`;
      selectedIdea = { round: { ...command.round }, index: command.index };
    } else {
      text = askInputText(command);
    }
    const assignment = await resolveAssignment(ctx, facts, plan, requestAssignmentRow(command, facts), null);
    if (assignment.status !== 'ready') return assignment;
    return buildRound({
      ctx, principal, commandId: command.commandId, identityKey, fingerprint, occurredAt: deps.now(),
      requestRoot, kind: 'followup', requestGoalId: facts.requestGoalId, text, selectedIdea,
      relatedCardRefs: command.kind === 'ask' ? command.cardRefs.map((ref) => structuredClone(ref)) : [],
      relatedMessageRef: null, createdLine: plan.createdLine, receiptKind: command.kind, facts, goalGuard: null,
      assignment: assignment.value,
    });
  }
  // ---------------------------------------------------------------------- //
  // Internal: assigned (the drain)                                         //
  // ---------------------------------------------------------------------- //

  async function prepareAssigned(
    ctx: CoreCallContext, principal: HostPrincipal, command: Extract<RequestInternalCommandV1, { kind: 'assigned' }>,
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const read = await readRequestFacts(deps, ctx, command.requestRoot);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    if (facts.ownerState !== 'waiting' && facts.ownerState !== 'owner_archived') {
      return rejected('invalid', `an assigned command requires a waiting or archived request (${facts.ownerState})`);
    }
    const holder = oldestPendingRound(facts);
    if (holder === null) return rejected('invalid', 'the request has no pending round to hold the intake');
    // The drain's target is the same single-pin target check `assignTo` runs.
    const target = await assignTo(ctx, command.to, command.guard, false, 'recipient');
    if (target.status !== 'ready') return target;
    const occurredAt = deps.now();
    const roundRef = queryJobRefFor(ctx.projectId, ctx.workspaceId ?? '', deps.operationId());
    const eventId = deps.operationId();
    // The intake is taken on the OLDEST PENDING ROUND, not on the routing round.
    const intake = intakeChanges({ holder: intakeHolder(facts), desire: command.to,
      next: { kind: 'existing', job: holder } });
    return prepareRoutingRequestTail(principal, {
      facts,
      command: { kind: 'routing', routing: {
        from: facts.ownerState === 'owner_archived'
          ? (facts.lastOwner === null ? null : { ...facts.lastOwner })
          : null,
        to: { ...command.to },
        reason: 'assigned',
      } },
      identity: { commandId: command.operationId, identityKey, fingerprint },
      scope: workspaceOf(ctx),
      submittedAt: occurredAt,
      roundRef,
      eventId,
      claims: [moveTailClaim(facts, command.requestRoot, roundRef), ...intake.claims],
      records: [],
      recordsAfterRound: intake.records,
      guards: [facts.guards, target.value.guards, intake.guards],
      conflict: { source: 'recipient', sessionRefKeys: target.value.sessionRefKeys,
        intakeKey: secretaryIntakeKey(command.to) },
      activity: { session: { ...command.to }, at: occurredAt, source: { ...roundRef } },
    });
  }

  // ---------------------------------------------------------------------- //
  // Internal: end_unbound (no round added)                                 //
  // ---------------------------------------------------------------------- //

  async function prepareEndUnbound(
    ctx: CoreCallContext, principal: HostPrincipal, command: Extract<RequestInternalCommandV1, { kind: 'end_unbound' }>,
    identityKey: string, fingerprint: string,
  ): Promise<PreparedOutcome> {
    const resolved = await resolveRequestRoot(deps.records, ctx, command.round);
    if (resolved.status === 'not_found') return rejected('not_found', 'the round is not a request round of this workspace');
    if (resolved.status === 'rejected') return unavailable(resolved.reason);
    const read = await readRequestFacts(deps, ctx, resolved.root);
    if (read.status !== 'ready') return read;
    const facts = read.facts;
    const round = facts.rounds.find((candidate) => sameJson(candidate.ref, command.round));
    if (round === undefined) return rejected('not_found', 'the round does not belong to its request');
    const runRef = round.job.runRef;
    const run = runRef === null ? undefined : facts.runs.find((candidate) => sameJson(candidate.ref, runRef));
    if (run === undefined) return rejected('invalid', 'the round has no QueryRun');
    if (round.job.status !== 'pending' && round.job.status !== 'running') {
      return rejected('invalid', 'end_unbound requires an unstarted round');
    }
    const phase = run.run.executionState?.phase;
    if (phase !== undefined && phase !== 'claimed' && phase !== 'prepared') {
      return rejected('invalid', 'end_unbound requires a round that did not enter the Kernel');
    }
    const occurredAt = deps.now();
    let ended = endUnstartedRound({ job: round as QueryJobSnapshot, run }, {
      detail: 'no_binding', message: 'no_secretary_binding', occurredAt,
    });
    const claims: UniqueClaimChange[] = [noopTailClaim(facts)];
    if (round.job.intakeSession !== null) {
      claims.push({ claimKey: secretaryIntakeKey(round.job.intakeSession), expectedOwner: keyOf(round.ref),
        nextOwner: null });
      ended = { job: setIntake(ended.job, null), run: ended.run };
    }
    // A claimed or prepared attempt's Session is guarded; the occupancy it
    // still holds is released in this commit.
    const claimed = await readClaimedSession(deps, run);
    if (claimed.status !== 'ready') return claimed;
    const records: EncodedRecord[] = [encodeQueryJobSnapshot(ended.job), encodeQueryRunSnapshotRecord(ended.run)];
    const guardGroups: RecordGuard[][] = [facts.guards, [{ refKey: keyOf(round.ref), expectedRevision: round.revision }]];
    const sessionRefKeys: string[] = [];
    if (claimed.claimed !== null) {
      guardGroups.push([claimed.claimed.guard]);
      if (claimed.claimed.released !== null) {
        records.push(encodeSessionRecord(claimed.claimed.released));
        sessionRefKeys.push(sessionAggregateRefKey(claimed.claimed.released.ref));
      }
    }
    const guards = guardList(guardGroups);
    if (guards.status !== 'ready') return guards;
    const event = buildRecordedEvent({
      eventId: deps.operationId(), identityKey, fingerprint, occurredAt,
      actor: { kind: principal.actor.kind, id: principal.actor.id },
      queryRunRef: ended.run.ref, requestId: command.operationId,
      correlationId: round.job.intent.correlationId, operation: 'observed', result: ended.run, run: ended.run,
      endsUnstarted: true,
    });
    return {
      status: 'ready',
      value: {
        receipt: null, records,
        events: [encodeQueryExecutionRecordedEvent(event)],
        guards: guards.guards, claims, round: { ...round.ref }, sinceRefKey: null, activity: null,
        conflict: { source: 'none', sessionRefKeys, intakeKey: null },
      },
    };
  }

  // ---------------------------------------------------------------------- //
  // One commit                                                             //
  // ---------------------------------------------------------------------- //

  async function commitPrepared(
    identityKey: string, fingerprint: string, prepared: PreparedAppend,
  ): Promise<CommitOutcome> {
    const guards = guardList([prepared.guards]);
    if (guards.status !== 'ready') {
      return { status: 'done', result: rejected('revision_conflict', 'the request read window changed during the append') };
    }
    let preparedCommit: PreparedCommit = {
      identityKey,
      fingerprint,
      guards: guards.guards,
      records: prepared.records,
      claims: prepared.claims,
      indexGuards: [],
      indexChanges: [],
      events: prepared.events,
      commitCursorBindings: prepared.sinceRefKey === null ? []
        : [{ refKey: prepared.sinceRefKey, field: 'since' }],
    };
    // The activity record rides this commit: the planner reads the Session and
    // the current record, and its guard joins the same write. A conflict on it
    // is this owner's to re-read and retry, like the request tail.
    let activityKey: string | null = null;
    if (prepared.activity !== null) {
      const planned = await planSessionActivityAdvance(deps.records, {
        sessionRef: prepared.activity.session, at: prepared.activity.at, kind: 'input',
        source: prepared.activity.source,
      });
      if (!planned.ok) {
        return { status: 'done', result: { status: 'rejected',
          code: planned.rejection.code as RequestRejectionV1['code'], reason: planned.rejection.reason } };
      }
      const guard = activityGuardOf(planned.guard);
      const merged = guardList([preparedCommit.guards, [guard]]);
      if (merged.status !== 'ready') {
        return { status: 'done', result: rejected('revision_conflict', 'the activity read window changed during the append') };
      }
      activityKey = guard.refKey;
      preparedCommit = { ...preparedCommit, guards: merged.guards,
        records: [...preparedCommit.records, planned.record] };
    }
    let committed: StoreCommitReceipt;
    try {
      committed = await deps.records.commit(preparedCommit);
    } catch (error) {
      // The recovery is the same command-kind dispatch as a replay, and a
      // failed lookup is `unavailable`, never an escaping promise.
      const recovered = await lookupCommittedReceipt(deps.records, identityKey, fingerprint);
      if (recovered.status === 'found') {
        if (prepared.receipt === null && prepared.sinceRefKey === null) {
          return { status: 'done', result: { status: 'ended', round: { ...prepared.round }, replayed: true } };
        }
        return { status: 'done', result: await receiptOf(deps, recovered.receipt, identityKey, fingerprint) };
      }
      return { status: 'done', result: unavailable(
        `the request commit failed and its receipt could not be confirmed: ${messageOf(error)}`) };
    }
    if (committed.status !== 'committed') {
      if (committed.code === 'unique_conflict') {
        if (committed.current.some((entry) => entry.claimKey.startsWith(REQUEST_TAIL_PREFIX))) {
          return { status: 'tail_conflict' };
        }
        if (committed.current.some((entry) => entry.claimKey.startsWith(SECRETARY_INTAKE_PREFIX))) {
          if (prepared.conflict.intakeKey !== null
            && committed.current.some((entry) => entry.claimKey === prepared.conflict.intakeKey)) {
            return { status: 'done', result: targetConflict(prepared.conflict.source,
              `another request write holds the target secretary intake: ${committed.reason}`) };
          }
          // A release whose holder moved: re-read the request window.
          return { status: 'tail_conflict' };
        }
        return { status: 'done', result: rejected('busy', `another request write holds a claim: ${committed.reason}`) };
      }
      if (committed.code === 'revision_conflict') {
        // The activity guard is re-read and the whole append retried, whether
        // the conflicting current revision is a number or `null`.
        if (activityKey !== null && committed.current.some((entry) => entry.refKey === activityKey)) {
          return { status: 'tail_conflict' };
        }
        const sessionKeys = new Set(prepared.conflict.sessionRefKeys);
        if (committed.current.some((entry) => sessionKeys.has(entry.refKey))) {
          return { status: 'done', result: targetConflict(prepared.conflict.source,
            `the target Session changed during the append: ${committed.reason}`) };
        }
        if (committed.current.some((entry) => entry.revision !== null)) return { status: 'tail_conflict' };
        return { status: 'done', result: rejected('revision_conflict', committed.reason) };
      }
      const mapped = ownerWriteStoreFailureToRejection(committed);
      return { status: 'done', result: rejected(mapped.code as RequestRejectionV1['code'], mapped.reason) };
    }
    if (committed.replayed) {
      if (prepared.sinceRefKey === null && prepared.receipt === null) {
        return { status: 'done', result: { status: 'ended', round: { ...prepared.round }, replayed: true } };
      }
      return { status: 'done', result: await receiptOf(deps, committed, identityKey, fingerprint) };
    }
    if (prepared.sinceRefKey === null) {
      return { status: 'done', result: { status: 'ended', round: { ...prepared.round }, replayed: false } };
    }
    if (prepared.receipt === null) {
      return { status: 'done', result: unavailable('the appended round carries no receipt') };
    }
    return { status: 'done', result: { status: 'appended', receipt: prepared.receipt, replayed: false } };
  }
  // ---------------------------------------------------------------------- //
  // The internal command's close and receipt read                          //
  // ---------------------------------------------------------------------- //

  /** The close identity and fingerprint of one stored command: the same on every replay. */
  function closeKeys(ctx: CoreCallContext, input: CloseUnderstandingInputV1):
  { identityKey: string; fingerprint: string } {
    return {
      identityKey: commandIdentity({ operation: 'request.request_understanding_close',
        scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
        principal: principalIdentity(HANDOFF_SYSTEM_PRINCIPAL), commandId: input.commandId }),
      fingerprint: sha256Hex(canonicalJson({ round: input.round, commandId: input.commandId } as unknown as JsonValue)),
    };
  }

  /** The append identity and fingerprint of one internal command, rebuilt from the command itself. */
  function receiptKeysOf(ctx: CoreCallContext, command: RequestInternalCommandV1):
  { identityKey: string; fingerprint: string } | null {
    if (command.kind === 'request_understanding') {
      return {
        identityKey: commandIdentity({ operation: 'request.request_understanding',
          scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
          principal: principalIdentity(HANDOFF_SYSTEM_PRINCIPAL), commandId: command.commandId }),
        fingerprint: sha256Hex(canonicalJson({ kind: command.kind, commandId: command.commandId,
          operation: command.operation, generation: command.generation, requestRoot: command.requestRoot,
          goals: command.goals, checkedRound: command.checkedRound } as unknown as JsonValue)),
      };
    }
    if (command.kind === 'handoff' || command.kind === 'archived') {
      const childId = `${command.operationId}:routing:${command.requestRoot.queryJobId}`;
      return {
        identityKey: commandIdentity({ operation: `request.${command.kind}`,
          scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
          principal: principalIdentity(HANDOFF_SYSTEM_PRINCIPAL), commandId: childId }),
        fingerprint: sha256Hex(canonicalJson({ kind: command.kind, operationId: command.operationId,
          requestRoot: command.requestRoot, to: command.to, expectedSource: command.expectedSource } as unknown as JsonValue)),
      };
    }
    return null;
  }

  async function readRequestCommandReceipt(ctx: CoreCallContext, command: RequestInternalCommandV1):
    Promise<RequestCommandReceiptReadV1> {
    const keys = receiptKeysOf(ctx, command);
    if (keys === null) return rejected('invalid', 'the receipt read names no internal request command');
    const found = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    switch (found.status) {
      case 'missing': return { status: 'missing' };
      case 'conflict': return rejected('idempotency_conflict', found.reason);
      case 'invalid': return rejected('invalid', found.reason);
      case 'unavailable': return unavailable(`the idempotency lookup failed: ${found.reason}`);
      case 'found': {
        const replayed = await replayCommittedReceipt<QueryJobSubmittedEventV1, RequestCommandReceiptReadV1>({
          receipt: found.receipt,
          eventAt: (cursor) => deps.records.eventAt(cursor),
          expectedEventType: 'QueryJobSubmitted',
          decode: decodeQueryJobSubmittedEvent,
          expected: { identityKey: keys.identityKey, fingerprint: keys.fingerprint },
          identityKey: (decoded) => decoded.identityKey,
          fingerprint: (decoded) => decoded.fingerprint,
          validate: (decoded) => decoded.payload.job.receipt === null
            ? unavailable('the original request event carries no receipt') : null,
          project: (decoded) => ({ status: 'found', receipt: decoded.payload.job.receipt!,
            cursor: found.receipt.cursor }),
          onFailure: requestReplayFailure,
        });
        return replayed.status === 'committed' ? replayed.value : unavailable(replayed.reason);
      }
    }
  }

  async function closeUnderstanding(ctx: CoreCallContext, input: CloseUnderstandingInputV1):
    Promise<CloseUnderstandingResultV1> {
    if (hostPrincipalOf(ctx, 'system') === null) {
      return rejected('forbidden', 'only the trusted system actor may close an understanding command');
    }
    const keys = closeKeys(ctx, input);
    // Its own original close receipt is restored first, without re-reading the later Job.
    const replay = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (replay.status === 'found') {
      return { status: 'committed', commandId: input.commandId, state: 'closed', replayed: true,
        cursor: replay.receipt.cursor };
    }
    if (replay.status === 'conflict') return rejected('idempotency_conflict', replay.reason);
    if (replay.status === 'invalid') return rejected('invalid', replay.reason);
    if (replay.status !== 'missing') return unavailable(`the idempotency lookup failed: ${replay.reason}`);

    const read = await readOne(deps.records, input.round, decodeJob);
    if (read.status === 'not_found') return rejected('not_found', 'the understanding round does not exist');
    if (read.status === 'rejected') return unavailable(`the understanding round could not be read: ${read.reason}`);
    const job = read.value;
    const command = job.job.understanding;
    if (command === null || command.commandId !== input.commandId) {
      return rejected('invalid', 'the round does not carry this understanding command');
    }
    if (command.state !== 'live') {
      return { status: 'already_terminal', commandId: input.commandId, state: command.state };
    }
    const occurredAt = deps.now();
    const next = transitionUnderstandingCommand(job, { commandId: input.commandId, to: 'closed', occurredAt });
    const eventId = deps.operationId();
    const commit: PreparedCommit = {
      identityKey: keys.identityKey, fingerprint: keys.fingerprint,
      guards: [read.guard],
      records: [encodeQueryJobSnapshot(next)],
      claims: [], indexGuards: [], indexChanges: [],
      events: [encodeQueryJobSubmittedEvent(submittedEvent({ principal: HANDOFF_SYSTEM_PRINCIPAL, job: next,
        eventId, identityKey: keys.identityKey, fingerprint: keys.fingerprint, commandId: input.commandId,
        occurredAt }))],
    };
    let committed: StoreCommitReceipt;
    try {
      committed = await deps.records.commit(commit);
    } catch (error) {
      const recovered = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
      if (recovered.status === 'found') {
        return { status: 'committed', commandId: input.commandId, state: 'closed', replayed: true,
          cursor: recovered.receipt.cursor };
      }
      return unavailable(`the close commit failed and its receipt could not be confirmed: ${messageOf(error)}`);
    }
    if (committed.status !== 'committed') {
      const mapped = ownerWriteStoreFailureToRejection(committed);
      return { status: 'rejected', code: mapped.code as RequestRejectionV1['code'], reason: mapped.reason };
    }
    return { status: 'committed', commandId: input.commandId, state: 'closed', replayed: false,
      cursor: committed.cursor };
  }

  // ---------------------------------------------------------------------- //
  // The named read `s6-query-unassigned`                                   //
  // ---------------------------------------------------------------------- //

  async function unassigned(ctx: CoreCallContext, scope: WorkspaceScope,
    input: { limit: number; continuation: string | null },
  ): Promise<ReadResult<{ requests: QueryJobRef[]; continuation: string | null; wrapped: boolean }>> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      return { status: 'rejected', code: 'invalid', reason: 'limit must be a positive integer' };
    }
    // One 200-row index page per call (a bounded traversal): the drain
    // owns the page budget, so this read never fills `limit` across pages.
    const read = await readOpenIndexPage(deps, scope, 'pending', input.continuation,
      { read: 'unassigned', damaged: 'an unassigned candidate' });
    if (read.status !== 'ready') return read;

    const requests: QueryJobRef[] = [];
    let resume: OpenIndexCursor | null = read.value.after;
    let stoppedAtLimit = false;
    for (const row of read.value.rows) {
      resume = { order: String(row.snapshot.since), refKey: row.refKey };
      const root = row.snapshot.job.requestRoot;
      if (root === null) continue;
      // A failed read is the whole read's failure: the queue backs off and keeps
      // the dirty rows; only a successfully read, non-waiting owner is skipped.
      const facts = await readRequestFacts(deps, ctx, root);
      if (facts.status !== 'ready') {
        return { status: 'rejected', code: 'unavailable', reason: facts.reason };
      }
      if (facts.facts.ownerState !== 'waiting' && facts.facts.ownerState !== 'owner_archived') continue;
      // Output a request only for its oldest pending round; every other round
      // only advances the cursor, so one request never appears twice.
      const oldest = oldestPendingRound(facts.facts);
      if (oldest === null || !sameJson(oldest.ref, row.snapshot.ref)) continue;
      requests.push({ ...root });
      if (requests.length >= input.limit) { stoppedAtLimit = true; break; }
    }
    const exhaustedPage = !stoppedAtLimit;
    const wrapped = exhaustedPage && read.value.next === null;
    const continuation = wrapped ? null
      : stoppedAtLimit ? JSON.stringify(resume) : JSON.stringify(read.value.next);
    return { status: 'ready', value: { requests, continuation, wrapped } };
  }

  // ---------------------------------------------------------------------- //
  // The named read `open`: the request roots with an open round              //
  // ---------------------------------------------------------------------- //

  /**
   * One page of the request roots that have an open round in one status
   * partition of the workspace. A request root can have several open rounds, so
   * a page names each root once; the rows of its later rounds only move the
   * cursor. The queue handler uses this to find the rounds it may advance: it
   * does not need the order inside a page, only that every open root is reached
   * exactly once per traversal.
   */
  async function open(ctx: CoreCallContext, scope: WorkspaceScope,
    input: { status: 'pending' | 'running'; limit: number; continuation: string | null },
  ): Promise<ReadResult<{ requests: QueryJobRef[]; continuation: string | null; wrapped: boolean }>> {
    if (input.status !== 'pending' && input.status !== 'running') {
      return { status: 'rejected', code: 'invalid', reason: "status must be 'pending' or 'running'" };
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      return { status: 'rejected', code: 'invalid', reason: 'limit must be a positive integer' };
    }
    const read = await readOpenIndexPage(deps, scope, input.status, input.continuation,
      { read: 'open request round', damaged: 'an open request round' });
    if (read.status !== 'ready') return read;

    const requests: QueryJobRef[] = [];
    const seen = new Set<string>();
    let resume: OpenIndexCursor | null = read.value.after;
    let stoppedAtLimit = false;
    for (const row of read.value.rows) {
      resume = { order: String(row.snapshot.since), refKey: row.refKey };
      const root = row.snapshot.job.requestRoot;
      // The index's `request` slot derives from the stored Job, so a row without
      // a root is not an open request round of this workspace.
      if (root === null) {
        return { status: 'rejected', code: 'unavailable',
          reason: 'the open request index names a non-request QueryJob' };
      }
      const key = keyOf(root);
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push({ ...root });
      if (requests.length >= input.limit) { stoppedAtLimit = true; break; }
    }
    const exhaustedPage = !stoppedAtLimit;
    const wrapped = exhaustedPage && read.value.next === null;
    const continuation = wrapped ? null
      : stoppedAtLimit ? JSON.stringify(resume) : JSON.stringify(read.value.next);
    return { status: 'ready', value: { requests, continuation, wrapped } };
  }

  // ---------------------------------------------------------------------- //
  // The ONE workspace message discovery: the reply/expiry source rows        //
  // ---------------------------------------------------------------------- //

  /**
   * One page of the workspace messages in one status partition that name a
   * request root and carry a response or an expiry. Every record is decoded: a
   * damaged one is the whole read's `unavailable`, never a skipped row. The
   * caller owns the page budget, exactly like `open`.
   */
  async function sources(ctx: CoreCallContext, scope: WorkspaceScope,
    input: { status: 'pending' | 'responded'; limit: number; continuation: string | null },
  ): Promise<ReadResult<{
    sources: { requestRoot: QueryJobRef; messageRef: SessionMessageRef; kind: 'reply' | 'expiry' }[];
    continuation: string | null;
    wrapped: boolean;
  }>> {
    let page: Awaited<ReturnType<RequestServiceStore['lookup']>>;
    try {
      page = await deps.records.lookup({
        index: S5_MESSAGE_BY_WORKSPACE_STATUS,
        values: [scope.projectId, scope.workspaceId, input.status],
        limit: input.limit,
        ...(input.continuation === null ? {} : { after: input.continuation }),
      });
    } catch (error) {
      return { status: 'rejected', code: 'unavailable',
        reason: `the workspace message read failed: ${messageOf(error)}` };
    }
    if (page.status !== 'ready') {
      return { status: 'rejected', code: 'unavailable',
        reason: `the workspace message read failed: ${page.code}: ${page.reason}` };
    }
    const found: { requestRoot: QueryJobRef; messageRef: SessionMessageRef; kind: 'reply' | 'expiry' }[] = [];
    for (const record of page.value.records) {
      let decoded: ReturnType<typeof decodeSessionMessageRecord>;
      try {
        decoded = decodeSessionMessageRecord(record);
      } catch (error) {
        return { status: 'rejected', code: 'unavailable',
          reason: `a workspace message is damaged: ${messageOf(error)}` };
      }
      if (decoded.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable',
          reason: `a workspace message is damaged: ${decoded.reason}` };
      }
      const message = decoded.value;
      if (message.requestRoot === null) continue;
      const kind = message.status === 'responded' ? 'reply'
        : message.status === 'pending' && message.expiredAt !== null ? 'expiry' : null;
      if (kind === null) continue;
      found.push({ requestRoot: { ...message.requestRoot }, messageRef: { ...message.ref }, kind });
    }
    return { status: 'ready', value: {
      sources: found, continuation: page.value.next, wrapped: page.value.next === null,
    } };
  }

  return { precheck, append, closeUnderstanding, readRequestCommandReceipt, unassigned, open, sources };
}
