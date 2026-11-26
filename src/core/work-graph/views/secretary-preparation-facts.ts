/**
 * The ONE secretary preparation facts read (spec L8).
 *
 * A request round prepares from a frozen set of facts: its own round material,
 * the pending rounds it absorbs, the earlier rounds that ran on another Session,
 * the workspace, the current architecture and the two governance pointers, all
 * read at one ledger watermark. The whole read runs between two empty-store
 * watermarks: if they differ the complete read is repeated a bounded number of
 * times, so no fact set can mix two states. Every failure is returned as a
 * `ReadResult` rejection; a failed read never becomes an empty history, an
 * absent governance pointer or "no earlier round". The Runtime freezes these
 * facts in the prepared manifest and renders the secretary input from the same
 * read, so one watermark covers both.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { userDecisionBodyOf } from '../../../contracts/goal-decisions.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, canonicalKey as keyOf, sameJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  isRequestRound, type QueryJobSnapshot, type QueryRunRef, type SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type { MessageExpiryPort } from '../communication/message-expiry.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { ServedRolesPort } from '../model/initialization-adoption-contracts.js';
import type {
  PlanAdmissionFactsV1, SecretaryHistoryEntryV1, SecretaryPreparationFactsPort, SecretaryPreparationFactsV1,
} from '../model/secretary-contracts.js';
import { SECRETARY_HISTORY_ROUNDS } from '../model/request-contracts.js';
import { decodeGoalSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import { currentUnderstandingOperations } from '../queries/query-execution.js';
import {
  COMPLETE_READ_ATTEMPTS, compareCursors, compareRequestRounds, readRequestRounds,
} from '../queries/request-rounds-read.js';
import { operationRefKey, plainSessionRefToAggregate } from '../sessions/session-record-codecs.js';
import { successorOperationsOf } from '../sessions/session-handoff-service.js';
import { liveUnderstandingGrants } from '../state/request-rounds.js';
import {
  readGoal, readGoalOrdinals, readPinnedCompletionPolicy, readPlan, readPlanExecutionFacts, readSelectedCatalog,
  resolveGovernance, type PlanCheckResolver,
} from '../tasks/plan-readers.js';
import type { VerifiedGovernance } from '../tasks/plan-commit-compiler.js';
import { readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import type { KnowledgeLines } from '../model/line-knowledge.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { readAnswers } from '../tasks/request-facts.js';
import { readInitializationPointers } from '../tasks/initialization-pointers.js';
import { listWorkspaceGoals, readGoalTerminalState, readWatermark } from './goal-conflicts.js';

export type SecretaryPreparationFactsDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
  /** The roles the in-memory Workflow configuration serves for the request's workspace; read once per read. */
  roles: ServedRolesPort;
  /** The one message read a reply/expiry round freezes its delivery slots from. */
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>;
  /** The expiry chain count of an expiry round's stored message (`MessageExpiryPort.readExpiryCount`). */
  expiryCount: MessageExpiryPort['readExpiryCount'];
  /** The workspace's installed checks, the same resolver the plan readers' `planChecks` reads. */
  checks: PlanCheckResolver;
  /** The knowledge lines a plan answer's catalog window and module frame are read from (as the propose reads them). */
  knowledge: KnowledgeLines;
};

/** A Run in one of these phases has a live attempt and is not part of the batch. */
const LIVE_ATTEMPT_PHASES: ReadonlySet<string> = new Set(['claimed', 'prepared', 'entering', 'entered']);

function exactQueryRunRef(value: unknown): value is QueryRunRef {
  return isRecord(value) && value['aggregateType'] === 'QueryRun' && nonEmpty(value['projectId'])
    && nonEmpty(value['workspaceId']) && nonEmpty(value['queryJobId']) && nonEmpty(value['runId']);
}

/**
 * One complete read of every fact, at no watermark of its own. The exported
 * port runs it between two watermarks and only returns a stable window.
 */
async function readSecretaryFactsOnce(
  deps: SecretaryPreparationFactsDependencies, ctx: CoreCallContext, queryRunRef: QueryRunRef, withAdmission: boolean,
): Promise<ReadResult<SecretaryPreparationFactsV1>> {
  const projectId = ctx.projectId;
  const workspaceId = queryRunRef.workspaceId;

  // The executing Job is the one record that names the request root; the
  // complete request read below then supplies every round and Run again.
  const jobKey = canonicalJson({
    aggregateType: 'QueryJob', projectId, workspaceId, queryJobId: queryRunRef.queryJobId,
  } as unknown as JsonValue);
  let jobRead: Awaited<ReturnType<SecretaryPreparationFactsDependencies['records']['readMany']>>;
  try {
    jobRead = await deps.records.readMany([jobKey]);
  } catch (error) {
    return rejected('unavailable', `the QueryJob read failed: ${messageOf(error)}`);
  }
  if (jobRead.status !== 'ready') {
    return rejected('unavailable', `the QueryJob read failed: ${jobRead.code}: ${jobRead.reason}`);
  }
  const jobRecord = jobRead.value.records.find((record) => record.refKey === jobKey);
  if (jobRecord === undefined) {
    return jobRead.value.missing.includes(jobKey)
      ? { status: 'not_found' }
      : rejected('unavailable', 'the QueryJob read was not reported');
  }
  const decodedJob = decodeQueryJobSnapshot(jobRecord);
  if (decodedJob.status !== 'decoded') return rejected('unavailable', `the QueryJob is damaged: ${decodedJob.reason}`);
  const executingJob = decodedJob.value;
  if (!isRequestRound(executingJob)) return rejected('invalid', 'the QueryJob is not a request round');
  const executingRunRef = executingJob.job.runRef;
  if (executingRunRef === null || !sameJson(executingRunRef, queryRunRef)) {
    return rejected('unavailable', 'the QueryRun is not the executing round of its request');
  }
  const requestRoot = executingJob.job.requestRoot ?? executingJob.ref;

  // The complete request window: the batch and the earlier history are rounds
  // of the SAME request, so one read supplies both.
  const roundsRead = await readRequestRounds(deps.records, ctx, { requestRoot });
  if (roundsRead.status !== 'ready') return roundsRead;
  const facts = roundsRead.value;

  const executingRound = facts.rounds.find((round) => sameJson(round.ref, executingJob.ref));
  if (executingRound === undefined) return rejected('unavailable', 'the executing round is not part of its own request');
  const preparationCursor = facts.tail.since;
  const runByKey = new Map(facts.runs.map((snapshot) => [keyOf(snapshot.ref), snapshot]));
  const coveredByDrop = new Set(facts.coveredByDrop.map((ref) => keyOf(ref)));
  const executingRun = runByKey.get(keyOf(executingRunRef));
  if (executingRun === undefined) return rejected('unavailable', 'the executing round names a missing QueryRun');
  const executingSession = executingRun.run.executionState?.sessionRef;
  if (executingSession === undefined) {
    return rejected('incomplete', 'the executing QueryRun has no persisted Session binding');
  }

  // The batch: the pending non-routing rounds this round may absorb. A round
  // with a live attempt is already being worked, so it is not available to
  // absorb; a routing round never runs a Query.
  const selected: QueryJobSnapshot[] = [];
  for (const round of facts.rounds) {
    if (round.job.roundKind === 'routing') continue;
    if (sameJson(round.ref, executingRound.ref)) continue;
    if (coveredByDrop.has(keyOf(round.ref))) continue;
    if (round.job.status !== 'pending') continue;
    const roundRunRef = round.job.runRef;
    if (roundRunRef === null) {
      return rejected('unavailable', `the pending round ${round.ref.queryJobId} has no QueryRun`);
    }
    const roundRun = runByKey.get(keyOf(roundRunRef));
    if (roundRun === undefined) {
      return rejected('unavailable', `the pending round ${round.ref.queryJobId} names a missing QueryRun`);
    }
    if (roundRun.run.status !== 'pending') continue;
    const phase = roundRun.run.executionState?.phase;
    if (phase !== undefined && LIVE_ATTEMPT_PHASES.has(phase)) continue;
    if (compareCursors(round.since, preparationCursor) > 0) continue;
    selected.push(round);
  }
  const batchRounds: QueryJobSnapshot[] = [...selected];
  const batchKeys = new Set(batchRounds.map((round) => keyOf(round.ref)));
  // The rounds the executing Job absorbed are frozen material even when they
  // are no longer pending; a named round outside the request is a damaged
  // fact, never an empty material. Every absorbed round stays in the batch.
  for (const absorbedRef of executingJob.job.absorbedRounds) {
    const absorbedRound = facts.rounds.find((round) => sameJson(round.ref, absorbedRef));
    if (absorbedRound === undefined) {
      return rejected('unavailable', `the executing Job absorbed a round outside its request: ${absorbedRef.queryJobId}`);
    }
    if (batchKeys.has(keyOf(absorbedRound.ref))) continue;
    batchKeys.add(keyOf(absorbedRound.ref));
    batchRounds.push(absorbedRound);
  }
  // The whole batch is one ordered list: a retry's new pending rounds and the
  // earlier absorbed ones follow the request's `since` order together.
  batchRounds.sort(compareRequestRounds);

  // The earlier history: a non-routing round of this request that ran on
  // ANOTHER Session. A round that never entered the Kernel (`not_entered`,
  // including a drop's) is never an entry.
  const earlierCandidates: { round: QueryJobSnapshot; session: SessionRef }[] = [];
  for (const round of facts.rounds) {
    if (round.job.roundKind === 'routing') continue;
    if (round.job.absorbedInto !== null) continue;
    if (round.job.closeReason?.code === 'not_entered') continue;
    const ended = round.job.status === 'answered' || round.job.status === 'closed';
    if (ended) {
      if (round.job.enteredSession === null) continue;
      if (sameJson(round.job.enteredSession, executingSession)) continue;
      earlierCandidates.push({ round, session: round.job.enteredSession });
      continue;
    }
    const roundRunRef = round.job.runRef;
    if (roundRunRef === null) continue;
    const roundRun = runByKey.get(keyOf(roundRunRef));
    if (roundRun === undefined) {
      return rejected('unavailable', `the earlier round ${round.ref.queryJobId} names a missing QueryRun`);
    }
    const state = roundRun.run.executionState;
    if (state === undefined) continue;
    if (state.phase !== 'entering' && state.phase !== 'entered' && state.phase !== 'unknown') continue;
    if (sameJson(state.sessionRef, executingSession)) continue;
    earlierCandidates.push({ round, session: state.sessionRef });
  }
  earlierCandidates.sort((left, right) => compareRequestRounds(left.round, right.round));
  const earlierRounds = earlierCandidates.slice(
    Math.max(0, earlierCandidates.length - SECRETARY_HISTORY_ROUNDS),
  );

  // The answers of every round of this request, in one batch: the selected
  // idea and each earlier result read the same map, never a second execution
  // record read.
  const answersRead = await readAnswers({ records: deps.records }, facts.rounds);
  if (answersRead.status !== 'ready') return answersRead;
  const answerByRef = new Map(answersRead.value.map((answer) => [keyOf(answer.ref), answer]));

  // The current revision of every object the rendered rounds' card refs name
  // (an `ask` stores a card's refs), read in one batch inside this read's
  // window: an absent object reads `null` (rendered "not found"); a failed
  // read fails the facts, never an empty card list.
  const renderedRounds: QueryJobSnapshot[] = [executingRound, ...batchRounds];
  for (const candidate of earlierRounds) {
    renderedRounds.push(candidate.round);
    for (const absorbedRef of candidate.round.job.absorbedRounds) {
      const absorbedRound = facts.rounds.find((round) => sameJson(round.ref, absorbedRef));
      if (absorbedRound !== undefined) renderedRounds.push(absorbedRound);
    }
  }
  const cardKeys = [...new Set(renderedRounds.flatMap((round) =>
    round.job.relatedCardRefs.map((pin) => keyOf(pin.ref))))];
  const cardRevisions = new Map<string, number | null>();
  const cardGuards: RecordGuard[] = [];
  if (cardKeys.length > 0) {
    let cardRead: Awaited<ReturnType<SecretaryPreparationFactsDependencies['records']['readMany']>>;
    try {
      cardRead = await deps.records.readMany(cardKeys);
    } catch (error) {
      return rejected('unavailable', `the card objects read failed: ${messageOf(error)}`);
    }
    if (cardRead.status !== 'ready') {
      return rejected('unavailable', `the card objects read failed: ${cardRead.code}: ${cardRead.reason}`);
    }
    for (const cardKey of cardKeys) {
      const record = cardRead.value.records.find((entry) => entry.refKey === cardKey);
      if (record !== undefined) {
        cardRevisions.set(cardKey, record.revision);
        cardGuards.push({ refKey: cardKey, expectedRevision: record.revision });
      } else if (cardRead.value.missing.includes(cardKey)) {
        cardRevisions.set(cardKey, null);
        cardGuards.push({ refKey: cardKey, expectedRevision: null });
      } else {
        return rejected('unavailable', `the card object read did not report ${cardKey}`);
      }
    }
  }

  const materialOf = async (round: QueryJobSnapshot): Promise<ReadResult<SecretaryRoundMaterialV1>> => {
    if (round.job.roundKind === 'routing') {
      return rejected('unavailable', 'a routing round has no Query material');
    }
    const roundRunRef = round.job.runRef;
    if (roundRunRef === null) {
      return rejected('unavailable', `the round ${round.ref.queryJobId} has no QueryRun`);
    }
    const roundRun = runByKey.get(keyOf(roundRunRef));
    if (roundRun === undefined) {
      return rejected('unavailable', `the round ${round.ref.queryJobId} names a missing QueryRun`);
    }
    let selectedIdea: SecretaryRoundMaterialV1['selectedIdea'] = null;
    const chosen = round.job.selectedIdea;
    if (chosen !== null) {
      const sourceRound = facts.rounds.find((candidate) => sameJson(candidate.ref, chosen.round));
      if (sourceRound === undefined) {
        return rejected('unavailable', 'the selected idea names a round outside its request');
      }
      const sourceRef = sourceRound.job.answerRefs.at(-1);
      if (sourceRef === undefined) {
        return rejected('unavailable', 'the selected idea round has no stored answer');
      }
      const answer = answerByRef.get(keyOf(sourceRef));
      if (answer === undefined) {
        return rejected('unavailable', 'the selected idea round has no stored answer');
      }
      const idea = answer.answer.ideas[chosen.index];
      if (idea === undefined) {
        return rejected('unavailable', `the selected idea index ${String(chosen.index)} is not in the stored answer`);
      }
      selectedIdea = { round: chosen.round, index: chosen.index, title: idea.title, detail: idea.detail };
    }
    const relatedCards: SecretaryRoundMaterialV1['relatedCards'] = [];
    for (const pin of round.job.relatedCardRefs) {
      const current = cardRevisions.get(keyOf(pin.ref));
      if (current === undefined) {
        return rejected('unavailable', `the card object ${keyOf(pin.ref)} of round ${round.ref.queryJobId} was not read`);
      }
      relatedCards.push({ ref: pin, current });
    }
    // The round's delivery is frozen here, once, from the stored message: the
    // question is the original message body; a reply's body is the response,
    // an expiry's deadline and count come from the stored message. Both fields
    // stay null on every round that is not a reply/expiry; a read failure is
    // the facts' rejection, never a partial delivery.
    let relatedMessageRef: SecretaryRoundMaterialV1['relatedMessageRef'] = null;
    let delivery: SecretaryRoundMaterialV1['delivery'] = null;
    if (round.job.roundKind === 'reply' || round.job.roundKind === 'expiry') {
      const relatedRef = round.job.relatedMessageRef!;
      const question = await deps.messages.readMessageBody(ctx, { messageRef: relatedRef, part: 'message' });
      if (question.status !== 'ready') return question;
      const message = await deps.messages.readMessage(ctx, relatedRef);
      if (message.status !== 'ready') return message;
      relatedMessageRef = { ...relatedRef };
      if (round.job.roundKind === 'reply') {
        const body = await deps.messages.readMessageBody(ctx, { messageRef: relatedRef, part: 'response' });
        if (body.status !== 'ready') return body;
        // P6I R1: the answer to a decision card freezes the whole decision, as the line's busy point supplies it
        // (`execution-inputs.ts`). A chosen option with no words is a whole answer, and words never drop the option.
        const decision = userDecisionBodyOf(message.value.response, body.value.text);
        delivery = decision === null ? { question: question.value.text, body: body.value.text }
          : { question: question.value.text, decision };
      } else {
        const count = await deps.expiryCount(ctx, { messageRef: relatedRef });
        if (count.status !== 'ready') return count;
        if (count.value === 'incomplete') {
          return rejected('incomplete', `the expiry chain of ${relatedRef.messageId} is still open`);
        }
        delivery = { question: question.value.text, deadline: message.value.deadline!, expiryCount: count.value };
      }
    }
    return {
      status: 'ready',
      value: {
        ref: round.ref,
        revision: round.revision,
        runRef: roundRunRef,
        runRevision: roundRun.revision,
        since: round.since,
        text: round.job.intent.question,
        references: round.job.requestReferences!.map((reference) => ({ ...reference })),
        selectedIdea,
        relatedCards,
        command: round.job.understanding,
        relatedMessageRef,
        delivery,
      },
    };
  };

  const roundMaterial = await materialOf(executingRound);
  if (roundMaterial.status !== 'ready') return roundMaterial;
  const batch: SecretaryRoundMaterialV1[] = [];
  for (const round of batchRounds) {
    const material = await materialOf(round);
    if (material.status !== 'ready') return material;
    batch.push(material.value);
  }

  // Every distinct operation the frozen material carries, read and decoded
  // once. A missing, failed or damaged record is unavailable, never an empty
  // grant set; each record's revision is guarded by the same commit.
  const materials: SecretaryRoundMaterialV1[] = [roundMaterial.value, ...batch];
  const operationRead = await currentUnderstandingOperations(deps, materials, facts.owner);
  if (operationRead.status !== 'ready') return operationRead;
  const understandingGrants = [...liveUnderstandingGrants({ materials, requestRoot, operations: operationRead.operations })];

  // The successor's brief: the newest hand-off naming this executing Session over every phase, a completed one
  // included, until an entered round consumes it (SR5 item 6). It fills only `briefRef`; never a generation.
  const successors = await successorOperationsOf(deps.records, projectId, workspaceId, executingSession);
  if (successors.status !== 'ready') return successors;
  const latest = successors.value.reduce<typeof successors.value[number] | null>((left, right) =>
    left === null || right.revision > left.revision ? right : left, null);
  const successor = latest?.record.action.kind === 'handoff'
    && (latest.record.action.progress.brief?.consumedBy ?? null) === null ? latest : null;
  const briefRef: OperationRef | null = successor?.record.ref ?? null;
  const briefRevision: number | null = successor?.revision ?? null;
  const briefGuards: RecordGuard[] = briefRef === null || briefRevision === null
    ? [] : [{ refKey: operationRefKey(briefRef), expectedRevision: briefRevision }];

  const earlier: SecretaryHistoryEntryV1[] = [];
  for (const candidate of earlierRounds) {
    const material = await materialOf(candidate.round);
    if (material.status !== 'ready') return material;
    const absorbed: SecretaryRoundMaterialV1[] = [];
    for (const absorbedRef of candidate.round.job.absorbedRounds) {
      const absorbedRound = facts.rounds.find((round) => sameJson(round.ref, absorbedRef));
      if (absorbedRound === undefined) {
        return rejected('unavailable', `the earlier round absorbed a round outside its request: ${absorbedRef.queryJobId}`);
      }
      const absorbedMaterial = await materialOf(absorbedRound);
      if (absorbedMaterial.status !== 'ready') return absorbedMaterial;
      absorbed.push(absorbedMaterial.value);
    }
    let result: SecretaryHistoryEntryV1['result'];
    const answerRef = candidate.round.job.answerRefs.at(-1);
    if (answerRef !== undefined) {
      const stored = answerByRef.get(keyOf(answerRef));
      if (stored === undefined) {
        return rejected('unavailable', `the answer of round ${candidate.round.ref.queryJobId} is not readable`);
      }
      result = { kind: 'answer', text: stored.answer.answer };
    } else if (candidate.round.job.status === 'answered' || candidate.round.job.status === 'closed') {
      const closeReason = candidate.round.job.closeReason;
      if (closeReason === null) {
        return rejected('unavailable', `the ended round ${candidate.round.ref.queryJobId} has no close reason`);
      }
      result = { kind: 'no_answer', closeCode: closeReason.code };
    } else {
      result = { kind: 'not_ended' };
    }
    earlier.push({ round: material.value, absorbed, session: candidate.session, result });
  }

  // The workspace of the call scope: the same record every other read uses.
  const workspaceKey = canonicalJson({ aggregateType: 'Workspace', projectId, workspaceId } as unknown as JsonValue);
  let workspaceRead: Awaited<ReturnType<SecretaryPreparationFactsDependencies['records']['readMany']>>;
  try {
    workspaceRead = await deps.records.readMany([workspaceKey]);
  } catch (error) {
    return rejected('unavailable', `the Workspace read failed: ${messageOf(error)}`);
  }
  if (workspaceRead.status !== 'ready') {
    return workspaceRead.code === 'not_found'
      ? { status: 'not_found' }
      : rejected('unavailable', `the Workspace read failed: ${workspaceRead.code}: ${workspaceRead.reason}`);
  }
  const workspaceRecord = workspaceRead.value.records.find((record) => record.refKey === workspaceKey);
  if (workspaceRecord === undefined) {
    return workspaceRead.value.missing.includes(workspaceKey)
      ? { status: 'not_found' }
      : rejected('unavailable', 'the Workspace read was not reported');
  }
  const decodedWorkspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (decodedWorkspace.status !== 'decoded') {
    return rejected('unavailable', `the Workspace snapshot is not decodable: ${decodedWorkspace.reason}`);
  }
  const workspace: SecretaryPreparationFactsV1['workspace'] = {
    workspaceId: decodedWorkspace.value.ref.workspaceId,
    revision: decodedWorkspace.value.revision,
  };
  // The roles this workspace's Workflow bindings serve, read once beside the workspace itself: the same scope,
  // no second read, and host data rather than a ledger record, so no guard.
  const executionRoles = deps.roles.readServedRoles({ projectId, workspaceId });

  // The two active pointers, then the architecture at the revision the
  // architecture pointer names — never the latest one, which a concurrent
  // activation could have replaced after the pointer read.
  const pointers = await readInitializationPointers(deps.records, projectId);
  if (pointers.status !== 'ready') return pointers;
  const architecturePointer = pointers.value.architecture;
  let architecture: SecretaryPreparationFactsV1['architecture'] = null;
  const architectureGuards: RecordGuard[] = [];
  if (architecturePointer !== null) {
    const ref = {
      aggregateType: 'ArchitectureBaselineRevision' as const, projectId,
      baselineId: architecturePointer.baselineId, revision: architecturePointer.revision,
    };
    let architectureRead: Awaited<ReturnType<SecretaryPreparationFactsDependencies['architecture']['readArchitectureRevision']>>;
    try {
      architectureRead = await deps.architecture.readArchitectureRevision(ctx, { selection: { kind: 'revision', ref } });
    } catch (error) {
      return rejected('unavailable', `the architecture revision read failed: ${messageOf(error)}`);
    }
    if (architectureRead.status === 'not_found') {
      return rejected('unavailable', 'the architecture revision the active pointer names is missing');
    }
    if (architectureRead.status !== 'ready') return architectureRead;
    architecture = {
      baselineId: architectureRead.value.baseline.ref.baselineId,
      // The active revision is the baseline ref's content revision; the
      // snapshot's own `revision` is the immutable row revision (always 1).
      revision: architectureRead.value.baseline.ref.revision,
      catalog: architectureRead.value.catalog.catalog,
    };
    architectureGuards.push(
      { refKey: canonicalJson(architectureRead.value.baseline.ref as unknown as JsonValue),
        expectedRevision: architectureRead.value.baseline.revision },
      { refKey: canonicalJson(architectureRead.value.catalog.ref as unknown as JsonValue),
        expectedRevision: architectureRead.value.catalog.revision },
    );
  }

  let listed: Awaited<ReturnType<typeof listWorkspaceGoals>>;
  try {
    listed = await listWorkspaceGoals(deps.records, { projectId, workspaceId });
  } catch (error) {
    const failureCode = isRecord(error) ? error['code'] : undefined;
    const failureReason = isRecord(error) ? error['reason'] : undefined;
    return typeof failureCode === 'string' && typeof failureReason === 'string'
      ? storeFailureToRejection({ code: failureCode, reason: failureReason })
      : rejected('unavailable', `the workspace Goals read failed: ${messageOf(error)}`);
  }
  if (listed.truncated) return rejected('incomplete', 'the workspace Goal list is truncated');
  const ordinals = await readGoalOrdinals(deps.records, projectId);
  const goals: SecretaryPreparationFactsV1['goals'] = [];
  for (const goal of listed.goals) {
    // G6F F4: the list shows the Goal's phase beside its desired state (a completed or partially accepted Goal stays
    // `active`).
    const terminal = await readGoalTerminalState(deps.records, goal);
    if (terminal.status !== 'ready') return terminal;
    goals.push({
      goalId: goal.ref.goalId,
      desiredState: goal.desiredState,
      phase: !terminal.value.completed ? null : terminal.value.partial ? 'ACCEPTED_PARTIAL' : 'COMPLETED',
      objective: goal.objective,
      ordinal: ordinals?.get(goal.ref.goalId) ?? null,
    });
  }
  const goalGuards: RecordGuard[] = listed.goals.map((goal) => ({
    refKey: canonicalJson(goal.ref as unknown as JsonValue), expectedRevision: goal.revision,
  }));

  // The Sessions the rendered facts name: the executing one and every earlier
  // entry's. The request read guards its owner; these may be others.
  const sessionKeys = [...new Set([executingSession, ...earlierCandidates.map((candidate) => candidate.session)]
    .map((session) => keyOf(plainSessionRefToAggregate(session))))];
  let sessionRead: Awaited<ReturnType<SecretaryPreparationFactsDependencies['records']['readMany']>>;
  try {
    sessionRead = await deps.records.readMany(sessionKeys);
  } catch (error) {
    return rejected('unavailable', `the Sessions read failed: ${messageOf(error)}`);
  }
  if (sessionRead.status !== 'ready') {
    return rejected('unavailable', `the Sessions read failed: ${sessionRead.code}: ${sessionRead.reason}`);
  }
  if (sessionRead.value.missing.length > 0) {
    return rejected('unavailable', `the Sessions the facts rest on are missing: ${sessionRead.value.missing.join(', ')}`);
  }
  const sessionGuards: RecordGuard[] = sessionRead.value.records.map((record) => ({
    refKey: record.refKey, expectedRevision: record.revision,
  }));

  const merged = mergeGuards([
    ...facts.guards,
    ...answersRead.guards,
    ...pointers.value.guards,
    ...architectureGuards,
    ...goalGuards,
    ...sessionGuards,
    ...cardGuards,
    ...operationRead.guards,
    ...briefGuards,
    { refKey: workspaceKey, expectedRevision: workspaceRecord.revision },
  ]);
  if (!merged.ok) return merged.rejection;
  const executionKind = architecture !== null && pointers.value.completionPolicy !== null
    ? 'semantic_query' : 'initial_coordination';
  // 97-3: a planning answer is checked at submit against the policy its adoption reads and the installed checks.
  // Governance resolves only once both pointers are present; its content records never change after install.
  let effectivePolicy: SecretaryPreparationFactsV1['effectivePolicy'] = null;
  let governance: VerifiedGovernance | null = null;
  if (executionKind === 'semantic_query') {
    const governanceRead = await resolveGovernance(deps.records, projectId);
    if (governanceRead.status !== 'resolved') return governanceRead;
    effectivePolicy = { digest: governanceRead.governance.completionPolicy.digest, content: governanceRead.policyContent };
    governance = governanceRead.governance;
  }
  const installedChecks = await deps.checks({ projectId, workspaceId });
  if (installedChecks.status !== 'ready') return installedChecks;
  let admission: SecretaryPreparationFactsV1['admission'] = null;
  if (withAdmission) {
    const read = await readPlanAdmission(deps, ctx, projectId, facts.effectiveGoalId, governance);
    if (read.status !== 'ready') return read;
    admission = read.value;
  }

  return {
    status: 'ready',
    value: {
      request: {
        requestRoot,
        effectiveGoalId: facts.effectiveGoalId,
        preparationCursor,
        round: roundMaterial.value,
        batch,
        earlier,
        briefRef,
        understandingGrants,
        interventionSource: structuredClone(
          facts.rounds.find((round) => sameJson(round.ref, requestRoot))?.job.interventionSource ?? null),
      },
      workspace,
      executionRoles,
      architecture,
      completionPolicy: pointers.value.completionPolicy,
      effectivePolicy,
      installedChecks: installedChecks.value,
      admission,
      goals,
      executionKind,
      guards: merged.guards,
      watermark: null,
    },
  };
}

/**
 * 97-3: the facts a plan answer's submit check judges, read the way the propose and the adoption read them: the
 * current catalog window, the main workspace, and for an effective Goal with an adopted Plan that Plan, its pinned
 * policy (a failed read is kept: only a change that adds an obligation needs it), every Task's execution facts and
 * the closed ones (one canonical read, `readPlanExecutionFacts`); for a first plan the catalog governance selected
 * (`governance` is null before it resolves).
 */
async function readPlanAdmission(deps: SecretaryPreparationFactsDependencies, ctx: CoreCallContext, projectId: string,
  goalId: string | null, governance: VerifiedGovernance | null): Promise<ReadResult<PlanAdmissionFactsV1>> {
  const window = await readCurrentCatalogWindow(deps.records, projectId, { lines: deps.knowledge, caller: ctx });
  if (window.status !== 'ready' && window.status !== 'not_found') return window;
  const workspaces = await deps.knowledge.workspaces(ctx);
  if (workspaces.status !== 'ready') return rejected('unavailable', workspaces.reason);
  const head = { catalog: window.status === 'ready' ? window.catalog.catalog : null, mainWorkspaceId: workspaces.value[0]! };
  if (goalId !== null) {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId, goalId };
    const goalRead = await readGoal(deps.records, goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    const active = goalRead.goal.activePlanRevision;
    if (active !== null) {
      const planRead = await readPlan(deps.records, active);
      if (planRead.status !== 'ready') return planRead;
      const plan = planRead.plan;
      const pinned = await readPinnedCompletionPolicy(deps.records, plan.effectiveCompletionPolicy);
      const execution = await readPlanExecutionFacts(deps.records, plan);
      if (execution.status !== 'ready') return execution;
      return { status: 'ready', value: { ...head, firstAdoptionCatalog: null, base: { plan,
        goalDesiredState: goalRead.goal.desiredState,
        pinnedPolicy: pinned.status === 'resolved' ? { status: 'resolved', content: pinned.policyContent }
          : { status: 'rejected', reason: pinned.reason },
        tasks: execution.tasks, terminalTaskIds: [...execution.terminalTaskIds] } } };
    }
  }
  let firstAdoptionCatalog: PlanAdmissionFactsV1['firstAdoptionCatalog'] = null;
  if (governance !== null) {
    const selected = await readSelectedCatalog(deps.records, governance);
    firstAdoptionCatalog = selected.status === 'ready' ? { status: 'ready', catalog: selected.value }
      : { status: 'rejected', reason: selected.reason };
  }
  return { status: 'ready', value: { ...head, firstAdoptionCatalog, base: null } };
}

export function createSecretaryPreparationFacts(
  deps: SecretaryPreparationFactsDependencies,
): SecretaryPreparationFactsPort {
  return {
    async read(ctx: CoreCallContext, input: { queryRunRef: QueryRunRef; admission?: true }): Promise<ReadResult<SecretaryPreparationFactsV1>> {
      const rawRef: unknown = input?.queryRunRef;
      if (!exactQueryRunRef(rawRef)) {
        return rejected('invalid', 'the secretary preparation requires a complete QueryRunRef');
      }
      let queryRunRef: QueryRunRef;
      try { queryRunRef = structuredClone(rawRef) as QueryRunRef; } catch {
        return rejected('invalid', 'the secretary preparation request cannot be isolated from the caller');
      }
      if (queryRunRef.projectId !== ctx.projectId || queryRunRef.workspaceId !== ctx.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }

      // One stable ledger window: every record read above happens between the
      // same empty-store watermarks, or the whole read is repeated.
      for (let attempt = 0; attempt < COMPLETE_READ_ATTEMPTS; attempt += 1) {
        let before: ReadResult<CommitCursor | null>;
        try {
          before = await readWatermark(deps.records);
        } catch (error) {
          return rejected('unavailable', `the secretary facts watermark could not be read: ${messageOf(error)}`);
        }
        if (before.status !== 'ready') return before;
        const result = await readSecretaryFactsOnce(deps, ctx, queryRunRef, input.admission === true);
        let after: ReadResult<CommitCursor | null>;
        try {
          after = await readWatermark(deps.records);
        } catch (error) {
          return rejected('unavailable', `the secretary facts watermark could not be read: ${messageOf(error)}`);
        }
        if (after.status !== 'ready') return after;
        const stable = before.value === null || after.value === null
          ? before.value === after.value
          : compareCursors(before.value, after.value) === 0;
        if (stable) {
          if (result.status !== 'ready') return result;
          // Reply beats expiry at the handling point (book-7b.md:538): one batch
          // that carries both materials for the same message hands over only the
          // response. The expiry material keeps its round, reference and absorbed
          // history; its `delivery` becomes null, and the existing null-delivery
          // skip drops the input. A reply, plain or a decision, has no `expiryCount`.
          const { round, batch } = result.value.request;
          for (const material of [round, ...batch]) {
            if (material.delivery === null || material.relatedMessageRef === null
              || !('expiryCount' in material.delivery)) continue;
            const answered = [round, ...batch].some(other => other !== material && other.delivery !== null
              && !('expiryCount' in other.delivery) && other.relatedMessageRef !== null
              && sameJson(other.relatedMessageRef, material.relatedMessageRef));
            if (answered) material.delivery = null;
          }
          return { status: 'ready', value: { ...result.value, watermark: after.value } };
        }
      }
      return rejected('unavailable', 'the secretary facts kept moving while they were read');
    },
  };
}
