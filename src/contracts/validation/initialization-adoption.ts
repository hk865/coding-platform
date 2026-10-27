// src/contracts/validation/initialization-adoption.ts
import {
  INITIALIZATION_ADOPT_STAGES,
  type AdoptionStageProgressV1,
  type InitializationAdoptionRecordV1,
} from '../initialization-adoption.js';
import { sameJson } from '../fingerprint.js';
import { defineShape, f } from '../data-format.js';
import { QueryJobAnswerRefShape } from '../data-format-refs.js';
import { isRecord } from './common.js';
import { checkShape } from './data-format.js';

/** The saved-Answer source a checks configuration pin may carry. */
export const ChecksSettingsSourceShape = defineShape({
  name: 'ChecksSettingsSourceV1', fields: {
    answerRef: f.ref(QueryJobAnswerRefShape), answerDigest: f.sha256(),
  },
});

/** A complete frozen checks configuration pin; both identity fields are nullable because the pin also names the
 *  static fallback and the absence of a configuration. */
export const ChecksConfigurationPinShape = defineShape({
  name: 'ChecksConfigurationPinV1', fields: {
    configurationRevision: f.nullable(f.string({ min: 1, unit: 'codePoints' })),
    contentDigest: f.nullable(f.sha256()), checksRevision: f.integer({ min: 0 }),
    settings: f.nullable(f.ref(ChecksSettingsSourceShape)),
  },
});

export function checksConfigurationPinProblem(value: unknown): string | null {
  return checkShape(ChecksConfigurationPinShape, value, 'stored');
}

/**
 * R1 checks the fields first. This rule checks their progress relationships:
 * completed prefix; optional before-mark or stopped mark; final commitment.
 * An installed CHECKS mark always needs its matching real confirmation.
 */
export function adoptionProgressProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'the adoption record is not an object';

  const record = value as Partial<InitializationAdoptionRecordV1>;
  const completed = record.completedSteps;
  const stages = record.stages;
  const result = record.result;
  const order = INITIALIZATION_ADOPT_STAGES;

  if (!Array.isArray(completed)) return 'completedSteps is not an array';
  if (!Array.isArray(stages)) return 'stages is not an array';
  if (result === undefined) return 'the record result is missing';

  const prefix = completed.length;
  if (prefix > order.length) return 'the completed prefix is too long';

  for (let index = 0; index < prefix; index += 1) {
    if (completed[index] !== order[index]) {
      return 'completedSteps is not a prefix of the stage order';
    }
  }

  if (stages.length < prefix || stages.length > prefix + 1) {
    return 'the marks do not match the completed prefix';
  }
  if (prefix === order.length && stages.length !== prefix) {
    return 'a completed operation has an extra mark';
  }

  for (let index = 0; index < stages.length; index += 1) {
    const raw: unknown = stages[index];
    if (!isRecord(raw)) return 'a stage mark is not an object';

    const mark = raw as unknown as AdoptionStageProgressV1;
    if (mark.stage !== order[index]) {
      return 'stage marks are missing, repeated, unknown or out of order';
    }

    const before = mark.outcome === null && mark.result === null;
    if (index < prefix) {
      if (
        mark.outcome !== 'skipped'
        && mark.outcome !== 'reused'
        && mark.outcome !== 'installed'
      ) {
        return 'a completed stage has no successful outcome';
      }
      if (!isRecord(mark.result)) {
        return 'a completed stage has no result';
      }
    } else if (!before) {
      if (
        mark.outcome !== 'failed'
        && mark.outcome !== 'not_saved'
        && mark.outcome !== 'saved_unconfirmed'
      ) {
        return 'the current mark is neither before nor stopped';
      }
      if (!isRecord(mark.result)) {
        return 'the stopped stage has no result';
      }
    }

    if (mark.stage === 'checks' && mark.outcome === 'installed') {
      if (
        mark.result === null
        || mark.result.kind !== 'checks'
        || mark.result.save.status === 'not_saved'
        || mark.result.confirmation === null
      ) {
        return 'an installed checks stage has no real confirmation';
      }

      const saved = mark.result.save.value;
      const confirmed = mark.result.confirmation;
      if (
        confirmed.configurationRevision === null
        || confirmed.contentDigest === null
        || confirmed.configurationRevision
          !== saved.configuration.configurationRevision
        || confirmed.contentDigest !== saved.contentDigest
        || !sameJson(confirmed.checks, saved.configuration.checks)
        || (
          confirmed.settings !== null
          && !sameJson(confirmed.settings, saved.settings)
        )
      ) {
        return 'the checks confirmation does not match the saved configuration';
      }
    }
  }

  if (prefix === order.length) {
    return result !== null && result.status === 'committed'
      ? null
      : 'a completed operation needs its committed result';
  }

  if (stages.length === prefix) {
    return result === null
      ? null
      : 'a completed prefix without a current mark has a result';
  }

  const current = stages[prefix]!;
  if (current.outcome === null && current.result === null) {
    return result === null
      ? null
      : 'a before-mark must have no record result';
  }

  if (result === null || result.status !== 'pending') {
    return 'a stopped mark needs a pending record result';
  }
  if (result.stage !== current.stage) {
    return 'the pending result names another stage';
  }
  if (!sameJson(result.operationRef, record.ref)) {
    return 'the pending result names another operation';
  }
  if (!sameJson(result.completedSteps, completed)) {
    return 'the pending result has another completed prefix';
  }
  if (result.retryable && current.outcome !== 'failed') {
    return 'only a failed stage may be retryable';
  }
  return null;
}
