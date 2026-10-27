// src/core/work-graph/state/initialization-adoption.ts (pure; imports contracts and state only)
import {
  INITIALIZATION_ADOPT_STAGES,
  type AdoptionSaveAfterInputV1, type AdoptionSaveBeforeInputV1, type AdoptionStageProgressV1,
  type InitializationAdoptInputV1, type InitializationAdoptionRecordV1, type InitializationAdoptionRef,
} from '../../../contracts/initialization-adoption.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { CommitCursor } from '../../../contracts/command-event.js';

export type NewInitializationAdoptionInput = {
  ref: InitializationAdoptionRef;
  scope: { projectId: string; workspaceId: string };
  principal: JsonValue; commandId: string; fingerprint: string; generation: number;
  source: InitializationAdoptInputV1['source'];
  expectedAnswerDigest: string;
  expectedGoal: InitializationAdoptInputV1['expectedGoal'];
};

/** The birth: revision 1, no prefix, no marks, no result. */
export function newInitializationAdoptionRecord(
  input: NewInitializationAdoptionInput,
): InitializationAdoptionRecordV1 {
  return {
    ref: input.ref,
    revision: 1,
    scope: { ...input.scope },
    principal: input.principal,
    commandId: input.commandId,
    fingerprint: input.fingerprint,
    generation: input.generation,
    source: input.source,
    expectedAnswerDigest: input.expectedAnswerDigest,
    expectedGoal: input.expectedGoal,
    completedSteps: [],
    stages: [],
    result: null,
    since: null,
  };
}

export type AcceptExistingAdoptionInput = {
  commandId: string; fingerprint: string; principal: JsonValue;
  source: InitializationAdoptInputV1['source'];
  expectedAnswerDigest: string;
  expectedGoal: InitializationAdoptInputV1['expectedGoal'];
};

/** The accept of an existing operation: a new authorized submission raises the generation by one and rewrites
 *  only the accept identity; the prefix, the marks and the stored result stay exactly as they were. The service
 *  has already compared the basis (source, digest, expected Goal) before calling this. */
export function acceptExistingInitializationAdoption(
  record: InitializationAdoptionRecordV1,
  input: AcceptExistingAdoptionInput,
): InitializationAdoptionRecordV1 {
  return {
    ...record,
    revision: record.revision + 1,
    principal: input.principal,
    commandId: input.commandId,
    fingerprint: input.fingerprint,
    generation: record.generation + 1,
    source: input.source,
    expectedAnswerDigest: input.expectedAnswerDigest,
    expectedGoal: input.expectedGoal,
    since: null,
  };
}

/** The before-mark: one current mark with the frozen child/input/pins, outcome and result null, the prefix
 *  unchanged, and the record result cleared (it replaces a stopped mark). */
export function nextAdoptionStage(
  record: InitializationAdoptionRecordV1,
  input: AdoptionSaveBeforeInputV1,
): InitializationAdoptionRecordV1 {
  const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
  if (index < 0 || record.completedSteps.length !== index) {
    throw new Error('the before-mark is not for the current stage');
  }
  const mark: AdoptionStageProgressV1 = {
    stage: input.stage,
    child: { ...input.child },
    savedInput: input.savedInput,
    pins: input.pins,
    generation: input.generation,
    outcome: null,
    result: null,
  };
  const stages = [...record.stages];
  if (stages.length > index) stages[index] = mark;
  else stages.push(mark);
  return { ...record, revision: record.revision + 1, stages, result: null, since: null };
}

/** `advance`: the child finished; the prefix extends by exactly this stage and no record result is written. */
export function advanceInitializationAdoption(
  record: InitializationAdoptionRecordV1,
  input: Extract<AdoptionSaveAfterInputV1, { branch: 'advance' }>,
): InitializationAdoptionRecordV1 {
  const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
  const current = record.stages[index];
  if (index < 0 || current === undefined || current.stage !== input.stage) {
    throw new Error('the advance is not for the current stage');
  }
  const stages = [...record.stages];
  stages[index] = { ...current, generation: input.generation, outcome: input.outcome, result: input.result };
  return {
    ...record,
    revision: record.revision + 1,
    completedSteps: [...record.completedSteps, input.stage],
    stages,
    result: null,
    since: null,
  };
}

/** `stop`: the real outcome/result stay on the mark, the prefix does NOT extend, and the record result is the
 *  pending stop naming this stage and the unextended prefix. */
export function stopInitializationAdoption(
  record: InitializationAdoptionRecordV1,
  input: Extract<AdoptionSaveAfterInputV1, { branch: 'stop' }>,
): InitializationAdoptionRecordV1 {
  const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
  const current = record.stages[index];
  if (index < 0 || current === undefined || current.stage !== input.stage) {
    throw new Error('the stop is not for the current stage');
  }
  const stages = [...record.stages];
  stages[index] = { ...current, generation: input.generation, outcome: input.outcome, result: input.result };
  return {
    ...record,
    revision: record.revision + 1,
    stages,
    result: {
      status: 'pending',
      operationRef: record.ref,
      stage: input.stage,
      completedSteps: [...record.completedSteps],
      retryable: input.retryable,
      failure: input.failure,
    },
    since: null,
  };
}

/** `complete`: the apply mark, every stage completed, and the committed plan receipt. */
export function completeInitializationAdoption(
  record: InitializationAdoptionRecordV1,
  input: Extract<AdoptionSaveAfterInputV1, { branch: 'complete' }>,
): InitializationAdoptionRecordV1 {
  const index = INITIALIZATION_ADOPT_STAGES.indexOf(input.stage);
  const current = record.stages[index];
  if (input.stage !== 'apply' || current === undefined || current.stage !== input.stage) {
    throw new Error('the complete branch is not for the apply stage');
  }
  const stages = [...record.stages];
  stages[index] = { ...current, generation: input.generation, outcome: input.outcome, result: input.result };
  return {
    ...record,
    revision: record.revision + 1,
    completedSteps: [...INITIALIZATION_ADOPT_STAGES],
    stages,
    result: { status: 'committed', receipt: input.receipt, replayed: input.replayed },
    since: null,
  };
}

/** The advanced event carries the record's fields plus the event envelope; the committed record is those fields
 *  only, with `since` filled from this commit's cursor. The envelope must never reach the record's own codec. */
export function committedAdoptionRecord(
  event: Omit<InitializationAdoptionRecordV1, 'since'> & {
    eventId: string; eventType: string; schemaVersion: number; occurredAt: string;
  },
  since: CommitCursor,
): InitializationAdoptionRecordV1 {
  const {
    eventId: _eventId, eventType: _eventType, schemaVersion: _schemaVersion, occurredAt: _occurredAt,
    ...fields
  } = event;
  return { ...fields, since };
}
