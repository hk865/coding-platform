/**
 * The trusted rework-request application (`book-7c.md:707–:726`, LD-25): the read port L1's tool and
 * card need, the person's approved application through the two owners' own `*ApprovedByCard` paths, and
 * the ONE standalone close command.
 *
 * The application never re-admits the requester: it reads the stored request, rebuilds the requester's
 * provenance from the persisted Run V2 entry, and lets the owner run its normal path with the stored
 * agent and its pending revision. The owner merges `ReworkRequest@2` in its own successful commit
 * (B-08); a fence that moved closes the request through the request owner's own close record. This
 * service writes no record itself for the apply.
 *
 * The close is one `executeWriteCommand`: its build calls neither `requeueTask` nor `reverifyRound`, so
 * it can never be a second owner commit. Replay is the executor's strict receipt replay.
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { TaskRequeueOutcomeV1 } from '../../../contracts/task-requeue.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { EffectWriteResultV1 } from '../../../contracts/core/session-message.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { ReworkRequestRef } from '../../../contracts/rework-request.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../contracts/keyset-cursor.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { GoalRecordTransactionPort, PreparedCommit, RecordGuard } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { EvidencePort } from '../model/evidence-contracts.js';
import type { RequeueTaskInput, TaskClaimPort } from '../model/claim-contracts.js';
import type { ReverifyOutcomeV1, ReverifyRoundInput } from '../model/evidence-contracts.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { ExecutionEntryDependencies } from '../model/execution-entry-contracts.js';
import { isExecutionAuthorizationV2 } from '../persistence/execution-entry-codecs.js';
import { executeWriteCommand, type WriteCommand } from '../persistence/command-executor.js';
import { readStoredManifest } from './execution-entry-service.js';
import { readOwnerRecord } from './owner-record-read.js';
import { closeReworkRequestRecord, type ReworkRequestV1 } from '../state/rework-request.js';
import {
  reworkRequestClosedCodec, reworkRequestClosedEventFromEvent, reworkRequestCodec,
  type ReworkRequestClosed,
} from './rework-request-codecs.js';

/** The Store capabilities the request read, the ordered page and the one write executor need. */
export type ReworkRequestRecords =
  GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
/** Both approved owner entries are required: the service exists only to call them. */
export type RequeueOwner = Required<Pick<TaskClaimPort, 'requeueApprovedByCard'>>;
export type EvidenceOwner = Required<Pick<EvidencePort, 'reverifyApprovedByCard'>>;

/** The frozen read port (`7c1-start-rulings-v2.md:1419–1435`), with the card source's all-state page. */
export type ReworkRequestReadPort = {
  readRequest(ctx: CoreCallContext, input: { ref: ReworkRequestRef }): Promise<ReadResult<ReworkRequestV1>>;
  listPending(ctx: CoreCallContext, input: { goalRef: GoalRef; page: { limit: number; cursor?: string } })
    : Promise<ReadResult<{ items: ReworkRequestV1[]; nextCursor: string | null }>>;
  /** The card source's page: the same ordered lookup, every state, filtered by the caller when needed. */
  listByGoal(ctx: CoreCallContext, input: { goalRef: GoalRef; page: { limit: number; cursor?: string } })
    : Promise<ReadResult<{ items: ReworkRequestV1[]; nextCursor: string | null }>>;
};

export type ReworkRequestService = ReworkRequestReadPort & {
  applyApprovedReworkRequest(ctx: CoreCallContext, input: { request: ReworkRequestRef; commandId: string })
    : Promise<EffectWriteResultV1<ReworkRequestV1 | TaskRequeueOutcomeV1 | ReverifyOutcomeV1>>;
  closeReworkRequest(ctx: CoreCallContext,
    input: { request: ReworkRequestRef; commandId: string; outcome: 'rejected' | 'stale'; reason: string })
    : Promise<EffectWriteResultV1<ReworkRequestV1>>;
};

export type ReworkRequestServiceDependencies = {
  records: ReworkRequestRecords;
  requeues: RequeueOwner;
  evidence: EvidenceOwner;
  reads: ExecutionReadPort;
  /** The persisted manifest reader R-01 needs; never a second admission. */
  bodies: ExecutionEntryDependencies['bodies'];
  now: () => string;
  eventId: () => string;
};

const MAX_PAGE_LIMIT = 200;
const CLOSE_OPERATION = 'rework_request.close';

function reworkRequestRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'ReworkRequest'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['taskId']) || !nonEmpty(value['requestId'])) {
    return 'a complete ReworkRequestRef';
  }
  return null;
}
function reworkGoalRefProblem(value: unknown): string | null {
  if (!isRecord(value) || value['aggregateType'] !== 'Goal'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])) {
    return 'a complete GoalRef';
  }
  return null;
}
function reworkPlainSessionRef(session: { projectId: string; sessionId: string }): { projectId: string; sessionId: string } {
  return { projectId: session.projectId, sessionId: session.sessionId };
}

/** The one standalone close body's data; each caller supplies the record it already read and its own guards. */
export type ReworkRequestCloseInput = {
  records: GoalRecordTransactionPort;
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue;
  commandId: string;
  fingerprintInput: JsonValue;
  current: ReworkRequestV1;
  outcome: 'rejected' | 'stale';
  code: string;
  reason: string;
  guards: readonly RecordGuard[];
  now: () => string;
  eventId: () => string;
};

/**
 * The ONE standalone close body (`7c1-start-rulings-v2.md:1444–1445`): one `executeWriteCommand` whose build never
 * calls `requeueTask`/`reverifyRound`. The service and both owners pass their already-computed record, outcome and
 * guards; the owner keeps only its own business result mapping.
 */
export async function executeReworkRequestClose(
  input: ReworkRequestCloseInput,
): Promise<WriteResult<ReworkRequestV1> | { status: 'refused'; refusal: CoreRejection }> {
  type CloseDecision = { before: ReworkRequestV1; at: string };
  const command: WriteCommand<{ record: ReworkRequestV1 }, CloseDecision, CoreRejection,
    ReworkRequestClosed, ReworkRequestV1> = {
    operation: CLOSE_OPERATION,
    scope: input.scope,
    principal: input.principal,
    commandId: input.commandId,
    fingerprintInput: input.fingerprintInput,
    read: async () => ({ status: 'ready', facts: { record: input.current } }),
    decide: (facts) => facts.record.state === 'pending'
      ? { decision: { before: facts.record, at: input.now() } }
      : { refuse: rejectedWithNonEmptyCurrent('revision_conflict',
        `the rework request is ${facts.record.state}`,
        [{ ref: facts.record.ref, revision: facts.record.revision }]) },
    build: (decision, keys) => {
      const refKey = canonicalKey(decision.before.ref);
      const closed = closeReworkRequestRecord(decision.before, input.outcome, input.code, input.reason,
        { commandId: input.commandId, at: decision.at });
      const event: ReworkRequestClosed = {
        eventId: input.eventId(), eventType: 'ReworkRequestClosed', schemaVersion: 1,
        occurredAt: decision.at,
        identityKey: keys.identityKey,
        actor: closed.requester.actor as Extract<ActorRef, { kind: 'agent' }>,
        fingerprint: keys.fingerprint,
        request: closed.ref,
        state: input.outcome,
        outcome: closed.outcome ?? { code: input.code, reason: input.reason },
      };
      const prepared: PreparedCommit = {
        identityKey: event.identityKey,
        fingerprint: event.fingerprint,
        guards: [...input.guards, { refKey, expectedRevision: decision.before.revision }],
        records: [reworkRequestCodec.encode(closed)],
        claims: [],
        indexGuards: [],
        indexChanges: [],
        events: [reworkRequestClosedCodec.encode(event)],
        commitCursorBindings: [{ refKey, field: 'since' }],
      };
      return prepared;
    },
    result: {
      eventType: 'ReworkRequestClosed',
      schemaVersion: 1,
      decode: reworkRequestClosedEventFromEvent,
      validate: (decoded, receipt, keys): string | null => {
        if (decoded.identityKey !== keys.identityKey) return 'the close identity does not match the receipt';
        if (decoded.fingerprint !== keys.fingerprint) return 'the close fingerprint does not match the receipt';
        if (canonicalKey(decoded.request) !== canonicalKey(input.current.ref)) return 'the close names another request';
        if (decoded.state !== input.outcome) return 'the close state disagrees with the command';
        void receipt;
        return null;
      },
      // The committed event is the one close result, on the fresh call and on a strict replay alike: the record's
      // stable identity and input come from the pre-read, while `revision`, `state`, `outcome` and `closedBy` are the
      // close's, and `since` is this write result's cursor.
      project: (event, cursor): ReworkRequestV1 => ({
        ...input.current,
        revision: 2,
        state: event.state,
        outcome: event.outcome,
        closedBy: { commandId: input.commandId, at: event.occurredAt },
        since: cursor,
      }),
    },
  };
  return executeWriteCommand(input.records, command);
}

export function createReworkRequestService(deps: ReworkRequestServiceDependencies): ReworkRequestService {
  const records = deps.records;
  const now = deps.now;

  // ---- reads --------------------------------------------------------------

  async function readOneReworkRequest(
    ctx: CoreCallContext,
    input: { ref: ReworkRequestRef },
  ): Promise<ReadResult<ReworkRequestV1>> {
    if (!isRecord(input)) return rejected('invalid', 'readRequest requires { ref }');
    const refProblemText = reworkRequestRefProblem(input.ref);
    if (refProblemText !== null) return rejected('invalid', `readRequest requires ${refProblemText}`);
    const ref = input.ref;
    if (nonEmpty(ctx.projectId) && ctx.projectId !== ref.projectId) {
      return rejected('forbidden', 'the rework request belongs to another project');
    }
    // The ONE owner single-record read: this record's decoder and this read's own failure text.
    const refKey = canonicalKey(ref);
    const loaded = await readOwnerRecord({
      store: records, refKey, decode: reworkRequestCodec.decode,
      readError: message => rejected('unavailable', `the rework request could not be read: ${message}`),
    });
    if ('rejection' in loaded) return loaded.rejection;
    if ('notFound' in loaded) return { status: 'not_found' };
    if (ctx.workspaceId !== undefined && ctx.workspaceId !== loaded.value.workspaceId) {
      return rejected('forbidden', 'the rework request belongs to another workspace');
    }
    return { status: 'ready', value: loaded.value };
  }

  /**
   * One bounded page of `rework-request-by-goal` (all states), decoded in record order. The cursor is
   * the index's own `(order, refKey)` keyset, serialized; a damaged cursor or row is a rejection, never
   * a skipped page.
   */
  async function reworkRequestPage(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; page: { limit: number; cursor?: string } },
  ): Promise<ReadResult<{ items: ReworkRequestV1[]; nextCursor: string | null }>> {
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['goalRef'])) return rejected('invalid', 'a rework request page requires a GoalRef');
    const goalProblemText = reworkGoalRefProblem(raw['goalRef']);
    if (goalProblemText !== null) return rejected('invalid', `a rework request page requires ${goalProblemText}`);
    const goalRef = raw['goalRef'] as unknown as GoalRef;
    if (nonEmpty(ctx.projectId) && ctx.projectId !== goalRef.projectId) {
      return rejected('forbidden', 'the rework requests belong to another project');
    }
    if (!nonEmpty(ctx.workspaceId)) return rejected('invalid', 'a rework request page requires a bound workspace');
    if (!isRecord(raw['page'])) return rejected('invalid', 'a rework request page requires { limit, cursor? }');
    const limit = raw['page']['limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      return rejected('invalid', `page.limit must be an integer between 1 and ${String(MAX_PAGE_LIMIT)}`);
    }
    const cursor = raw['page']['cursor'];
    if (!(cursor === undefined || cursor === null || typeof cursor === 'string')) {
      return rejected('invalid', 'page.cursor must be a string or null');
    }
    let after: { order: string | number; refKey: string } | undefined;
    if (typeof cursor === 'string') {
      const decoded = decodeKeysetCursor(cursor, goalRef.goalId);
      if (decoded === null || typeof decoded !== 'object'
        || !(typeof decoded.order === 'string' || typeof decoded.order === 'number')
        || typeof decoded.refKey !== 'string') {
        return rejected('invalid', 'page.cursor is not a readable rework-request cursor');
      }
      after = { order: decoded.order, refKey: decoded.refKey };
    }
    let page: Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
    try {
      page = await records.lookupOrdered({
        index: 'rework-request-by-goal',
        values: [goalRef.projectId, ctx.workspaceId, goalRef.goalId],
        direction: 'asc',
        ...(after === undefined ? {} : { after }),
        limit,
      });
    } catch (error) {
      return rejected('unavailable', `the rework request page could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (page.status !== 'ready') {
      return page.code === 'invalid'
        ? rejected('invalid', page.reason) : rejected('unavailable', `${page.code}: ${page.reason}`);
    }
    const items: ReworkRequestV1[] = [];
    for (const record of page.value.records) {
      const decoded = reworkRequestCodec.decode(record);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `a stored rework request is not decodable: ${decoded.reason}`);
      }
      items.push(decoded.value);
    }
    return { status: 'ready', value: {
      items, nextCursor: page.value.next === null ? null : encodeKeysetCursor(goalRef.goalId, page.value.next),
    } };
  }

  /** Every request of the Goal, all states: the card source's one collection read. */
  async function listByGoal(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; page: { limit: number; cursor?: string } },
  ): Promise<ReadResult<{ items: ReworkRequestV1[]; nextCursor: string | null }>> {
    return reworkRequestPage(ctx, input);
  }

  /** The tool's pending page: the same all-state lookup, `state === 'pending'` kept in memory. */
  async function listPending(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; page: { limit: number; cursor?: string } },
  ): Promise<ReadResult<{ items: ReworkRequestV1[]; nextCursor: string | null }>> {
    const page = await reworkRequestPage(ctx, input);
    if (page.status !== 'ready') return page;
    return { status: 'ready', value: {
      items: page.value.items.filter(record => record.state === 'pending'),
      nextCursor: page.value.nextCursor,
    } };
  }

  // ---- approved application ----------------------------------------------

  async function applyApprovedReworkRequest(
    ctx: CoreCallContext,
    input: { request: ReworkRequestRef; commandId: string },
  ): Promise<EffectWriteResultV1<ReworkRequestV1 | TaskRequeueOutcomeV1 | ReverifyOutcomeV1>> {
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['request']) || !nonEmpty(raw['commandId'])) {
      return rejected('invalid', 'applyApprovedReworkRequest requires { request, commandId }');
    }
    const commandId = raw['commandId'] as string;
    const requestRead = await readOneReworkRequest(ctx, { ref: raw['request'] as unknown as ReworkRequestRef });
    if (requestRead.status === 'not_found') return rejected('not_found', 'the rework request does not exist');
    if (requestRead.status !== 'ready') return requestRead.status === 'rejected' ? requestRead
      : rejected('unavailable', 'the rework request is not readable');
    const record = requestRead.value;
    const replay = record.state === 'applied' && record.closedBy?.commandId === commandId;
    if (record.state !== 'pending' && !replay) {
      return rejectedWithNonEmptyCurrent('revision_conflict', `the rework request is ${record.state}`,
        [{ ref: record.ref, revision: record.revision }]);
    }
    // Provenance is rebuilt from the persisted Run; never a fresh admission (the requester Run may have ended).
    const executionRead = await deps.reads.readExecution(ctx, record.requester.run);
    if (executionRead.status !== 'ready') {
      return rejected('unavailable', executionRead.status === 'rejected'
        ? executionRead.reason : 'the requester Run is not readable for the approved rework application');
    }
    const execution = executionRead.value;
    const run = execution.run;
    const authorization = run.executionAuthorization;
    if (!isExecutionAuthorizationV2(authorization)) {
      return rejected('unavailable', 'the requester Run has no persisted V2 entry authorization');
    }
    // R-01: the configuration revision is the stored manifest's, the same provenance source the plan-write
    // admission reads; a missing/damaged manifest is `unavailable` and writes nothing.
    const stored = await readStoredManifest({ bodies: deps.bodies }, run);
    if (!stored.ok) {
      return rejected('unavailable',
        `the requester Run manifest is not readable for the approved application: ${stored.rejection.reason}`);
    }
    const provenance = {
      schemaVersion: 1 as const,
      runRef: run.ref,
      sessionRef: reworkPlainSessionRef(execution.session.ref),
      roleBinding: run.roleBinding,
      sessionGeneration: authorization.sessionGeneration,
      entryGeneration: authorization.generation,
      authorizationRevision: authorization.revision,
      configurationRevision: stored.value.manifest.hostConfigurationRevision,
    };
    const actor = record.requester.actor;
    const approval = {
      request: record.ref, revision: record.revision, actor, provenance, commandId,
    };
    const meta = {
      requestId: commandId,
      // The record table stores pins as JSON; the two owners' existing pin checks validate every one, so no
      // second validator is written here.
      expected: record.pins as unknown as readonly VersionPin[],
    };
    const result = record.kind === 'requeue'
      ? await deps.requeues.requeueApprovedByCard(ctx,
        { input: record.input.value as RequeueTaskInput, meta }, approval)
      : await deps.evidence.reverifyApprovedByCard(ctx,
        { input: record.input.value as ReverifyRoundInput, meta }, approval);
    // R-03: a real `source_stale` from the owner applies as a stale close; every other result is returned as-is.
    if (result.status === 'rejected' && result.code === 'source_stale') {
      return await closeReworkRequest(ctx, { request: record.ref, commandId, outcome: 'stale', reason: result.reason });
    }
    return result;
  }

  // ---- standalone close ---------------------------------------------------

  async function closeReworkRequest(
    ctx: CoreCallContext,
    input: { request: ReworkRequestRef; commandId: string; outcome: 'rejected' | 'stale'; reason: string },
  ): Promise<EffectWriteResultV1<ReworkRequestV1>> {
    const raw = input as unknown as Record<string, unknown> | null | undefined;
    if (!isRecord(raw) || !isRecord(raw['request']) || !nonEmpty(raw['commandId'])
      || (raw['outcome'] !== 'rejected' && raw['outcome'] !== 'stale') || typeof raw['reason'] !== 'string') {
      return rejected('invalid', 'closeReworkRequest requires { request, commandId, outcome, reason }');
    }
    const commandId = raw['commandId'] as string;
    const outcome = raw['outcome'] as 'rejected' | 'stale';
    const reason = raw['reason'] as string;
    const requestRead = await readOneReworkRequest(ctx, { ref: raw['request'] as unknown as ReworkRequestRef });
    if (requestRead.status === 'not_found') return rejected('not_found', 'the rework request does not exist');
    if (requestRead.status !== 'ready') return requestRead.status === 'rejected' ? requestRead
      : rejected('unavailable', 'the rework request is not readable');
    const current = requestRead.value;
    // The standalone close's outcome code is the card's result; a person's reject has no owner code, and a
    // standalone stale close keeps the stale code. The record's `code` is optional in the field table.
    const code = outcome === 'stale' ? 'source_stale' : 'rejected';
    const written = await executeReworkRequestClose({
      records, scope: { projectId: current.ref.projectId, workspaceId: current.workspaceId },
      principal: principalIdentity(ctx.principal), commandId,
      fingerprintInput: { request: current.ref, outcome, reason },
      current, outcome, code, reason, guards: [], now, eventId: deps.eventId,
    });
    return written.status === 'committed' ? written : written.status === 'refused' ? written.refusal : written;
  }

  return { readRequest: readOneReworkRequest, listPending, listByGoal, applyApprovedReworkRequest, closeReworkRequest };
}
