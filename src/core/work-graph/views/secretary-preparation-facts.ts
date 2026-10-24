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
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, sameJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  isRequestRound, type QueryJobSnapshot, type QueryRunRef, type SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { ArchitectureCatalogPort } from '../architecture/catalog-contracts.js';
import type {
  SecretaryHistoryEntryV1, SecretaryPreparationFactsPort, SecretaryPreparationFactsV1,
} from '../model/secretary-contracts.js';
import { SECRETARY_HISTORY_ROUNDS } from '../model/request-contracts.js';
import { decodeGoalSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { decodeQueryJobSnapshot } from '../queries/query-record-codecs.js';
import {
  COMPLETE_READ_ATTEMPTS, compareCursors, compareRequestRounds, readRequestRounds,
} from '../queries/request-rounds-read.js';
import { plainSessionRefToAggregate } from '../sessions/session-record-codecs.js';
import { readAnswers } from '../tasks/request-facts.js';
import { readInitializationPointers } from '../tasks/initialization-pointers.js';
import { listWorkspaceGoals, readWatermark } from './goal-conflicts.js';

export type SecretaryPreparationFactsDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'> & RecordLookupPort & RecordOrderedLookupPort;
  architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'>;
};

/** A Run in one of these phases has a live attempt and is not part of the batch. */
const LIVE_ATTEMPT_PHASES: ReadonlySet<string> = new Set(['claimed', 'prepared', 'entering', 'entered']);

function keyOf(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exactQueryRunRef(value: unknown): value is QueryRunRef {
  return isRecord(value) && value['aggregateType'] === 'QueryRun' && nonEmpty(value['projectId'])
    && nonEmpty(value['workspaceId']) && nonEmpty(value['queryJobId']) && nonEmpty(value['runId']);
}

/**
 * One complete read of every fact, at no watermark of its own. The exported
 * port runs it between two watermarks and only returns a stable window.
 */
async function readSecretaryFactsOnce(
  deps: SecretaryPreparationFactsDependencies, ctx: CoreCallContext, queryRunRef: QueryRunRef,
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

  const materialOf = (round: QueryJobSnapshot): ReadResult<SecretaryRoundMaterialV1> => {
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
    return {
      status: 'ready',
      value: {
        ref: round.ref,
        revision: round.revision,
        runRef: roundRunRef,
        runRevision: roundRun.revision,
        since: round.since,
        text: round.job.intent.question,
        selectedIdea,
        relatedCards,
      },
    };
  };

  const roundMaterial = materialOf(executingRound);
  if (roundMaterial.status !== 'ready') return roundMaterial;
  const batch: SecretaryRoundMaterialV1[] = [];
  for (const round of batchRounds) {
    const material = materialOf(round);
    if (material.status !== 'ready') return material;
    batch.push(material.value);
  }
  const earlier: SecretaryHistoryEntryV1[] = [];
  for (const candidate of earlierRounds) {
    const material = materialOf(candidate.round);
    if (material.status !== 'ready') return material;
    const absorbed: SecretaryRoundMaterialV1[] = [];
    for (const absorbedRef of candidate.round.job.absorbedRounds) {
      const absorbedRound = facts.rounds.find((round) => sameJson(round.ref, absorbedRef));
      if (absorbedRound === undefined) {
        return rejected('unavailable', `the earlier round absorbed a round outside its request: ${absorbedRef.queryJobId}`);
      }
      const absorbedMaterial = materialOf(absorbedRound);
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
  const goals: SecretaryPreparationFactsV1['goals'] = listed.goals.map((goal) => ({
    goalId: goal.ref.goalId,
    desiredState: goal.desiredState,
    objective: goal.objective,
  }));
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
    { refKey: workspaceKey, expectedRevision: workspaceRecord.revision },
  ]);
  if (!merged.ok) return merged.rejection;
  const executionKind = architecture !== null && pointers.value.completionPolicy !== null
    ? 'semantic_query' : 'initial_coordination';

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
      },
      workspace,
      architecture,
      completionPolicy: pointers.value.completionPolicy,
      goals,
      executionKind,
      guards: merged.guards,
      watermark: null,
    },
  };
}

export function createSecretaryPreparationFacts(
  deps: SecretaryPreparationFactsDependencies,
): SecretaryPreparationFactsPort {
  return {
    async read(ctx: CoreCallContext, input: { queryRunRef: QueryRunRef }): Promise<ReadResult<SecretaryPreparationFactsV1>> {
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
        const result = await readSecretaryFactsOnce(deps, ctx, queryRunRef);
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
          return result.status === 'ready'
            ? { status: 'ready', value: { ...result.value, watermark: after.value } }
            : result;
        }
      }
      return rejected('unavailable', 'the secretary facts kept moving while they were read');
    },
  };
}
