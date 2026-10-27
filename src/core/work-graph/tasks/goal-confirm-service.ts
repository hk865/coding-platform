/** `goals/confirm-draft`'s two constructors: the initialization-binding reader, and the confirm service,
 *  which returns only the write port and makes one `records.commit` whose last event is the receipt's source. */
import type { CommitCursor, CreateGoalCommand } from '../../../contracts/command-event.js';
import { hostPrincipalOf, principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { defineEvent, f } from '../../../contracts/data-format.js';
import { QueryJobRefShape } from '../../../contracts/data-format-refs.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  GoalConfirmDraftInputV1, GoalConfirmDraftReceiptV1, GoalConfirmFactsV1,
} from '../../../contracts/goal-card.js';
import {
  INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP, INITIALIZATION_BINDING_BY_GOAL_LOOKUP,
  InitializationBindingFormat, type InitializationBindingV1,
} from '../../../contracts/initialization-binding.js';
import { makeCommitCursor, type PendingGoalSnapshot } from '../../../contracts/ledger.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../../contracts/query-job.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { InitializationBindingReadPort, GoalConfirmPort } from '../model/goal-card-contracts.js';
import { latestAnsweredRound, REQUEST_TAIL_PREFIX } from '../model/request-contracts.js';
import type { RequestRoundsFactsV1 } from '../queries/request-rounds-read.js';
import { executeWriteCommand, commandIdentity, type CommittedReceipt, type Keys } from '../persistence/command-executor.js';
import {
  compileGoalCreate, goalRefFor, projectRefFor, workspaceRefFor,
} from '../persistence/commit-compiler.js';
import { createEventCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { createGoalGraphRepository } from '../persistence/graph-repository.js';
import { initializationBindingCodec } from '../persistence/initialization-binding-codecs.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { canonicalRefKey, decodeGoalSnapshot, goalSnapshotValueProblem } from '../persistence/record-codecs.js';
import { decideGoalConfirm, newInitializationBinding } from '../state/goal-confirm.js';
import { newGoalSnapshot } from '../state/goal-machine.js';
import { GOAL_BY_WORKSPACE_INDEX } from './plan-readers.js';
import { createRequestFacts, readAnswers, resolveRequestRoot } from './request-facts.js';
import type { PrepareRequestTail } from './request-tail-fragment.js';

/** The complete birth data of one confirmed draft; the receipt is projected from it and the cursor. */
type GoalDraftConfirmedEventV1 = {
  eventId: string;
  eventType: 'GoalDraftConfirmed';
  schemaVersion: 1;
  occurredAt: string;
  requestRef: QueryJobRef;
  round: QueryJobRef;
  index: number;
  goal: PendingGoalSnapshot;
  binding: InitializationBindingV1;
  attributionRound: QueryJobRef;
};

/**
 * The event snapshot is pre-bind: its `since` stays null and the receipt's cursor fills it. The
 * shared Goal check requires a real cursor, so it runs over the same snapshot with one legal
 * placeholder, and the stored placeholder itself must be null.
 */
function pendingGoalValueProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'GoalDraftConfirmed.goal must be an object';
  if (value['since'] !== null) return 'GoalDraftConfirmed.goal.since must stay null';
  return goalSnapshotValueProblem({ ...value, since: makeCommitCursor(1) });
}

/** The one cross-shape check: the binding this event carries is a complete `InitializationBinding@1`. */
function goalDraftConfirmedProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'GoalDraftConfirmed must be an object';
  const goal = pendingGoalValueProblem(value['goal']);
  if (goal !== null) return goal;
  return checkShape(InitializationBindingFormat, value['binding'], 'stored');
}

const goalDraftConfirmedFormat = defineEvent({
  name: 'GoalDraftConfirmed',
  eventType: 'GoalDraftConfirmed',
  schemaVersion: 1,
  fields: {
    requestRef: f.ref(QueryJobRefShape),
    round: f.ref(QueryJobRefShape),
    index: f.integer({ min: 0 }),
    goal: f.json(),
    binding: f.json(),
    attributionRound: f.ref(QueryJobRefShape),
  },
  rules: [goalDraftConfirmedProblem],
});

const goalDraftConfirmedCodec = createEventCodec(goalDraftConfirmedFormat);

/** The one registration group the composition root adds for this event. */
export const GOAL_CONFIRM_SCHEMAS: RecordBackendSchemas = formatSchemas([goalDraftConfirmedCodec]);

/** The binding reader's one store; the same reader also serves the request facts and the adoption. */
export type InitializationBindingReaderDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
};

/** The real stores and services this owner is assembled with (`X/create-platform.ts`). */
export type GoalConfirmServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  tail: PrepareRequestTail;
  bindings: InitializationBindingReadPort;
  now(): string;
};

/**
 * The `InitializationBindingReadPort` over the format's two lookups. A missing answer+draft
 * binding is `not_found` (an error); a Goal with no binding is a normal empty array; a store
 * failure is `unavailable` and a damaged record stays `unavailable`, never an empty result.
 */
export function createInitializationBindingReader(
  deps: InitializationBindingReaderDependencies,
): InitializationBindingReadPort {
  /** The one damaged-record answer: `unavailable`, never an empty or ignored binding. */
  function decode(record: EncodedRecord):
    { status: 'ready'; value: InitializationBindingV1 } | CoreRejection {
    const decoded = initializationBindingCodec.decode(record);
    return decoded.status === 'decoded' ? { status: 'ready', value: decoded.value }
      : rejected('unavailable', `the initialization binding is damaged: ${decoded.reason}`);
  }

  /** The store failure of a read is never "no such record": the whole read is unavailable. */
  function bindingReadFailure(what: string, failure: { code: string; reason: string }): CoreRejection {
    return rejected('unavailable', `${what} (${failure.code}: ${failure.reason})`);
  }

  return {
    async readBindingByAnswerDraft(_ctx, input): Promise<
      { status: 'ready'; value: InitializationBindingV1 } | { status: 'not_found' } | CoreRejection
    > {
      let page;
      try {
        page = await deps.records.lookup({
          index: INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP,
          values: [input.answerRef.projectId, input.answerRef.workspaceId, input.answerRef.queryJobId,
            input.answerRef.answerId, input.draftIndex],
          limit: 1,
        });
      } catch (error) {
        return rejected('unavailable', `the initialization binding could not be read: ${messageOf(error)}`);
      }
      if (page.status !== 'ready') return bindingReadFailure('the initialization binding lookup failed', page);
      const record = page.value.records[0];
      if (record === undefined) return { status: 'not_found' };
      return decode(record);
    },
    async readBindingByGoal(_ctx, input): Promise<
      { status: 'ready'; value: readonly InitializationBindingV1[] } | CoreRejection
    > {
      let page;
      try {
        page = await lookupAll(deps.records, INITIALIZATION_BINDING_BY_GOAL_LOOKUP,
          [input.goalRef.projectId, input.goalRef.goalId]);
      } catch (failure) {
        const detail = isRecord(failure) && typeof failure['reason'] === 'string'
          ? failure['reason'] : messageOf(failure);
        return rejected('unavailable', `the Goal's initialization bindings could not be read: ${detail}`);
      }
      const value: InitializationBindingV1[] = [];
      for (const record of page.items) {
        const decoded = decode(record);
        if (decoded.status !== 'ready') return decoded;
        value.push(decoded.value);
      }
      return { status: 'ready', value };
    },
  };
}

/** The facts one attempt read: the request basis the tail commit guards, plus the pure decision's facts. */
type ConfirmReadFacts = {
  requestRoot: QueryJobRef;
  requestFacts: RequestRoundsFactsV1;
  answerRef: QueryJobAnswerRef | null;
  answerText: string | null;
  latestAnswered: QueryJobRef | null;
  drafts: GoalConfirmFactsV1['drafts'];
  activeOrder: number[];
  confirmed: GoalConfirmFactsV1['confirmed'];
  goalId: string;
  guards: { refKey: string; expectedRevision: number | null }[];
  /** The record guards a conflict may re-read: the request window and the scope pins, never the new Goal. */
  retryableGuardRefs: string[];
};

/** The row's one decision plus the facts its build must not read again. */
type ConfirmDecision = {
  facts: ConfirmReadFacts;
  decision: Extract<ReturnType<typeof decideGoalConfirm>, { outcome: 'create' }>;
};

/** The workspace's active Goal orders; order is the next position after them (0 when none). A damaged or
 *  incomplete listing is `unavailable`, never a short order list. */
async function readActiveGoalOrder(
  records: Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>,
  scope: { projectId: string; workspaceId: string },
): Promise<{ status: 'ready'; value: number[] } | CoreRejection> {
  let page;
  try {
    page = await lookupAll(records, GOAL_BY_WORKSPACE_INDEX, [scope.projectId, scope.workspaceId]);
  } catch (failure) {
    const detail = isRecord(failure) && typeof failure['reason'] === 'string'
      ? failure['reason'] : messageOf(failure);
    return rejected('unavailable', `the workspace Goal list could not be read: ${detail}`);
  }
  const order: number[] = [];
  for (const record of page.items) {
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `a workspace Goal is damaged: ${decoded.reason}`);
    }
    if (decoded.value.desiredState === 'active') order.push(decoded.value.settings.order);
  }
  return { status: 'ready', value: order };
}

/** The person/invocation check; the business refusal order is `state/goal-confirm.ts`'s, so the draft index is
 *  not judged here. */
function confirmInputProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'goal.confirmDraft requires an input object';
  if (!nonEmpty(value['commandId'])) return 'goal.confirmDraft requires a commandId';
  const roundProblem = checkShape(QueryJobRefShape, value['round'], 'stored');
  if (roundProblem !== null) return roundProblem;
  return typeof value['index'] === 'number' ? null : 'goal.confirmDraft requires a numeric draft index';
}

export function createGoalConfirmService(deps: GoalConfirmServiceDependencies): GoalConfirmPort {
  const requestFacts = createRequestFacts({ records: deps.records, bindings: deps.bindings });

  async function read(ctx: CoreCallContext, input: GoalConfirmDraftInputV1, goalId: string):
    Promise<{ status: 'ready'; facts: ConfirmReadFacts } | CoreRejection> {
    const scope = { projectId: input.round.projectId, workspaceId: input.round.workspaceId };
    const resolved = await resolveRequestRoot(deps.records, ctx, input.round);
    if (resolved.status === 'not_found') {
      return rejected('not_found', 'the round is not a request round of this workspace');
    }
    if (resolved.status === 'rejected') return resolved;

    // ONE complete request facts read; `latest` and the guards derive from it, and the executor maps a throw.
    const factsRead = await requestFacts.readFacts(ctx, { requestRoot: resolved.root });
    if (factsRead.status === 'not_found') {
      return rejected('not_found', 'the request is not a request of this workspace');
    }
    if (factsRead.status !== 'ready') {
      return rejected('unavailable', factsRead.status === 'rejected' ? factsRead.reason
        : 'the request facts are unavailable');
    }
    const requestFactsValue = factsRead.value;
    const factsRound = requestFactsValue.rounds.find((candidate) => sameJson(candidate.ref, input.round));
    if (factsRound === undefined) return rejected('not_found', 'the round does not belong to its request');
    const answerRef = factsRound.job.answerRefs.at(-1) ?? null;

    // Only the target round's answers: the decision consumes this round's drafts and its one answer ref.
    const answers = await readAnswers(deps, [factsRound]);
    if (answers.status !== 'ready') return rejected('unavailable', answers.reason);
    const answer = answerRef === null ? null : answers.value[0] ?? null;
    const drafts = answer === null ? [] : answer.answer.goalCardDrafts.map((draft, index) => ({
      index, draft: structuredClone(draft),
    }));

    // At most one binding read, for the target index: an unconfirmed draft is `not_found`, any failed read refuses.
    const confirmed: { answerRef: QueryJobAnswerRef; draftIndex: number }[] = [];
    if (answerRef !== null) {
      const bindingRead = await deps.bindings.readBindingByAnswerDraft(ctx, { answerRef, draftIndex: input.index });
      if (bindingRead.status === 'rejected') return bindingRead;
      if (bindingRead.status === 'ready') confirmed.push({ answerRef, draftIndex: input.index });
    }

    const activeOrder = await readActiveGoalOrder(deps.records, scope);
    if (activeOrder.status === 'rejected') return activeOrder;

    // The Goal's birth guards are the same read `createGoalFromHost` makes: the Project and
    // Workspace revisions read in this call plus the minted Goal's absence (a null guard).
    const projectRef = projectRefFor(scope.projectId);
    const workspaceRef = workspaceRefFor(scope.projectId, scope.workspaceId);
    const goalRef = goalRefFor(scope.projectId, goalId);
    const repository = createGoalGraphRepository(deps.records);
    const scopeRead = await repository.readGoalScope({ projectRef, workspaceRef, goalRef });
    if (scopeRead.status === 'not_found') return rejected('not_found', scopeRead.reason);
    if (scopeRead.status !== 'ready') return rejected('unavailable', scopeRead.reason);
    const guards = [
      { refKey: canonicalRefKey(projectRef), expectedRevision: scopeRead.scope.project.revision },
      { refKey: canonicalRefKey(workspaceRef), expectedRevision: scopeRead.scope.workspace.revision },
      { refKey: canonicalRefKey(goalRef), expectedRevision: null },
    ];

    // The request window and the scope pins may be re-read after a conflict; the person's input
    // (the round and index) is never a pin, so nothing else is declared retryable.
    const retryableGuardRefs = [...requestFactsValue.guards.map((guard) => guard.refKey),
      guards[0]!.refKey, guards[1]!.refKey];

    const latestAnswered = latestAnsweredRound(requestFactsValue.rounds, (round) => round.job.answerRefs.length > 0);
    return {
      status: 'ready',
      facts: {
        requestRoot: { ...resolved.root },
        requestFacts: requestFactsValue,
        answerRef,
        answerText: answer === null ? null : answer.answer.answer,
        latestAnswered,
        drafts,
        activeOrder: activeOrder.value,
        confirmed,
        goalId,
        guards,
        retryableGuardRefs,
      },
    };
  }

  async function confirmDraft(ctx: CoreCallContext, rawInput: GoalConfirmDraftInputV1):
    Promise<WriteResult<GoalConfirmDraftReceiptV1>> {
    const principal = hostPrincipalOf(ctx, 'human');
    if (principal === null) return rejected('forbidden', 'only the person may confirm a goal draft');
    let input: GoalConfirmDraftInputV1;
    try {
      input = structuredClone(rawInput);
    } catch {
      return rejected('invalid', 'the goal confirm input cannot be copied');
    }
    const problem = confirmInputProblem(input);
    if (problem !== null) return rejected('invalid', problem);
    if (input.round.projectId !== ctx.projectId || input.round.workspaceId !== (ctx.workspaceId ?? '')) {
      return rejected('forbidden', 'the call context does not match the round workspace scope');
    }

    // The Goal's aggregate id is a deterministic derived id: seeded by the R2 identity (subject and
    // commandId), never the raw commandId, so two persons with one commandId never share a Goal.
    const identityKey = commandIdentity({
      operation: 'goal.confirmDraft',
      scope: { projectId: input.round.projectId, workspaceId: input.round.workspaceId },
      principal: principalIdentity(principal),
      commandId: input.commandId,
    });
    const goalId = `goal-confirm:${identityKey}`;

    // Per command: the guards the latest attempt read, so two concurrent confirms never share a
    // retry decision.
    let retryableGuards: ReadonlySet<string> = new Set();

    const result = await executeWriteCommand<ConfirmReadFacts, ConfirmDecision, CoreRejection,
      GoalDraftConfirmedEventV1, GoalConfirmDraftReceiptV1>(deps.records, {
      operation: 'goal.confirmDraft',
      scope: { projectId: input.round.projectId, workspaceId: input.round.workspaceId },
      principal: principalIdentity(principal),
      commandId: input.commandId,
      fingerprintInput: { round: input.round, index: input.index } as unknown as JsonValue,
      read: async () => {
        const readResult = await read(ctx, input, goalId);
        if (readResult.status === 'ready') retryableGuards = new Set(readResult.facts.retryableGuardRefs);
        return readResult;
      },
      decide(facts) {
        const decision = decideGoalConfirm({
          rounds: facts.requestFacts.rounds,
          latestAnswered: facts.latestAnswered,
          round: { ...input.round },
          drafts: facts.drafts,
          activeOrder: facts.activeOrder,
          confirmed: facts.confirmed,
        }, input);
        if (decision.outcome === 'refuse') return { refuse: rejected(decision.code, decision.reason) };
        return { decision: { facts, decision } };
      },
      async build({ facts, decision }, keys: Keys) {
        const scope = { projectId: input.round.projectId, workspaceId: input.round.workspaceId };
        const goalRef = goalRefFor(scope.projectId, facts.goalId);
        const goal = newGoalSnapshot({
          ref: goalRef,
          workspaceRef: workspaceRefFor(scope.projectId, scope.workspaceId),
          objective: decision.objective,
          settings: decision.settings,
          continuedFrom: null,
          copiedInterventions: [],
        });
        const at = deps.now();
        const command: CreateGoalCommand = {
          commandId: input.commandId,
          commandType: 'CreateGoal',
          schemaVersion: 1,
          identity: {
            projectId: scope.projectId,
            actor: { kind: principal.actor.kind, id: principal.actor.id },
            idempotencyKey: input.commandId,
          },
          aggregateId: facts.goalId,
          expectedRevision: 0,
          correlationId: input.commandId,
          submittedAt: at,
          payload: { workspaceId: scope.workspaceId, objective: decision.objective },
        };
        const compiled = compileGoalCreate({ command, goal, guards: facts.guards, birthEvent: 'none' });
        // `create` means the target draft exists, and drafts come from a non-null answer.
        const binding = newInitializationBinding({
          answerRef: facts.answerRef!,
          answerDigest: sha256Hex(facts.answerText!),
          requestRef: facts.requestRoot,
          draftIndex: input.index,
          goalRef,
          screening: decision.draft.screening,
        });
        const tail = await deps.tail(ctx, principal, {
          facts: facts.requestFacts,
          command: { kind: 'attribution', goalAttribution: goalRef },
          identity: { commandId: input.commandId, identityKey: keys.identityKey, fingerprint: keys.fingerprint },
          scope,
          submittedAt: at,
        });
        if ('status' in tail) return tail;
        const confirmed: GoalDraftConfirmedEventV1 = {
          eventId: `${keys.identityKey}:confirmed`,
          eventType: 'GoalDraftConfirmed',
          schemaVersion: 1,
          occurredAt: at,
          requestRef: { ...facts.requestRoot },
          round: { ...input.round },
          index: input.index,
          goal: { ...goal },
          binding,
          attributionRound: { ...tail.round },
        };
        return {
          records: [...compiled.records, initializationBindingCodec.encode(binding), ...tail.records],
          // The result event is last: the executor projects the receipt from it. The Goal's birth is
          // its snapshot record, not a second event: this commit's cursor fills the snapshot's since.
          events: [...tail.events, goalDraftConfirmedCodec.encode(confirmed)],
          guards: [
            ...compiled.guards,
            { refKey: canonicalKey(binding.ref), expectedRevision: null },
            ...tail.guards,
          ],
          claims: [...tail.claims],
          commitCursorBindings: [
            ...(compiled.commitCursorBindings ?? []),
            { refKey: tail.sinceRefKey, field: 'since' },
          ],
        };
      },
      result: {
        eventType: 'GoalDraftConfirmed',
        schemaVersion: 1,
        decode(event: EncodedDomainEvent): DecodeResult<GoalDraftConfirmedEventV1> {
          const decoded = goalDraftConfirmedCodec.decode(event);
          return decoded.status === 'decoded'
            ? { status: 'decoded', value: decoded.value as unknown as GoalDraftConfirmedEventV1 }
            : decoded;
        },
        validate(decoded: GoalDraftConfirmedEventV1, _receipt: CommittedReceipt, _keys: Keys): string | null {
          if (!sameJson(decoded.round, input.round)) return 'the event records another round';
          if (decoded.index !== input.index) return 'the event records another draft';
          if (decoded.requestRef.projectId !== input.round.projectId
            || decoded.requestRef.workspaceId !== input.round.workspaceId) {
            return 'the event request is in another scope';
          }
          if (decoded.attributionRound.projectId !== input.round.projectId
            || decoded.attributionRound.workspaceId !== input.round.workspaceId) {
            return 'the event attribution round is in another scope';
          }
          if (decoded.goal.ref.projectId !== input.round.projectId
            || decoded.goal.workspaceRef.workspaceId !== input.round.workspaceId) {
            return 'the event Goal is in another scope';
          }
          if (decoded.binding.answerRef.queryJobId !== input.round.queryJobId
            || !sameJson(decoded.binding.requestRef, decoded.requestRef)
            || !sameJson(decoded.binding.goalRef, decoded.goal.ref)
            || decoded.binding.draftIndex !== decoded.index) {
            return 'the event binding disagrees with the event';
          }
          return null;
        },
        project(decoded: GoalDraftConfirmedEventV1, cursor): GoalConfirmDraftReceiptV1 {
          return {
            requestRef: { ...decoded.requestRef },
            round: { ...decoded.round },
            index: decoded.index,
            goal: { ...decoded.goal, since: cursor },
            binding: decoded.binding,
            attributionRound: { ...decoded.attributionRound },
            cursor,
          };
        },
      },
      retryable: {
        claim: (claimKey) => claimKey.startsWith(REQUEST_TAIL_PREFIX),
        guard: (refKey) => retryableGuards.has(refKey),
      },
    });
    if (result.status === 'committed') return result;
    if (result.status === 'refused') return result.refusal;
    return rejectedWithCurrent(result.code, result.reason, result.current);
  }

  return { confirmDraft };
}
