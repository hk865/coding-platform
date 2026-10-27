/**
 * The initialization adoption's RecordStore codec: one record format and its two replay events. The record is read by
 * the canonical JSON of its full ref, so it registers no lookup. The shared progress rule is
 * `contracts/validation/initialization-adoption.ts`; this file only describes the fields and wires the codecs.
 */
import { defineEvent, defineRecord, defineShape, f } from '../../../contracts/data-format.js';
import {
  GoalRefShape, PlanRevisionRefShape, ProjectRefShape, WorkspaceRefShape, WorkspaceScopeShape, id,
} from '../../../contracts/data-format-refs.js';
import { architectureBaselineRevisionRefShape } from '../../../contracts/architecture-catalog.js';
import {
  INITIALIZATION_ADOPT_STAGES, InitializationAdoptionRefShape, type InitializationAdoptionRecordV1,
} from '../../../contracts/initialization-adoption.js';
import { InitializationSourceShape } from '../../../contracts/initial-planning.js';
import { CORE_ERRORS } from '../../../contracts/core/results.js';
import {
  ChecksConfigurationPinShape, ChecksSettingsSourceShape, adoptionProgressProblem,
} from '../../../contracts/validation/initialization-adoption.js';
import type { DecodeResult, EncodedRecord } from '../../record-store/ports.js';
import { createEventCodec, createRecordCodec, formatSchemas } from './field-table-codec.js';

// --------------------------------------------------------------------------
// The nested shapes of the record and of the advanced event
// --------------------------------------------------------------------------

const CompletionPolicyRevisionRefShape = defineShape({
  name: 'CompletionPolicyRevisionRef', fields: {
    aggregateType: f.literal('CompletionPolicyRevision'), projectId: id, policyId: id,
    revision: f.integer({ min: 1 }),
  },
});

const CheckHostActorShape = defineShape({
  name: 'CheckHostActor', fields: { kind: f.enumOf(['human', 'system']), id },
});

const RegisteredCommandCheckShape = defineShape({
  name: 'RegisteredCommandCheck', fields: {
    checkId: id, kind: f.enumOf(['static', 'dynamic']), command: f.string(), cwd: f.string(),
    timeoutMs: f.integer({ min: 0 }), taskIds: f.json(),
  },
});

const TrustedCheckConfigurationShape = defineShape({
  name: 'TrustedCheckConfiguration', fields: {
    configurationRevision: f.string({ min: 1, unit: 'codePoints' }),
    workspace: f.ref(WorkspaceRefShape), executor: f.ref(CheckHostActorShape),
    permissionRevision: f.string({ min: 1, unit: 'codePoints' }),
    sourceAccess: f.literal('verification_workspace'), processAccess: f.literal('all_except_denied'),
    deniedPrefixes: f.array(f.string()), checks: f.array(f.ref(RegisteredCommandCheckShape)),
  },
});

const ChecksEntryValueShape = defineShape({
  name: 'ChecksEntryValueV1', fields: {
    configuration: f.ref(TrustedCheckConfigurationShape), settings: f.ref(ChecksSettingsSourceShape),
    contentDigest: f.sha256(),
  },
});

const CoreRejectionShape = defineShape({
  name: 'CoreRejection', fields: {
    status: f.literal('rejected'), code: f.enumOf(CORE_ERRORS), reason: f.string(),
    current: f.optional(f.array(f.json())),
  },
});

const ChecksSaveResult = f.union('status', {
  saved: { status: f.literal('saved'), value: f.ref(ChecksEntryValueShape) },
  saved_unconfirmed: { status: f.literal('saved_unconfirmed'), value: f.ref(ChecksEntryValueShape) },
  not_saved: { status: f.literal('not_saved'), rejection: f.ref(CoreRejectionShape) },
});

const ChecksConfirmationShape = defineShape({
  name: 'ChecksConfirmationV1', fields: {
    configurationRevision: f.nullable(f.string({ min: 1, unit: 'codePoints' })),
    contentDigest: f.nullable(f.sha256()), settings: f.nullable(f.ref(ChecksSettingsSourceShape)),
    checks: f.array(f.ref(RegisteredCommandCheckShape)),
  },
});

const AdoptionChildReceiptShape = defineShape({
  name: 'AdoptionChildReceiptV1', fields: {
    commandId: id, cursor: f.cursor('ledgerNonZero'), value: f.json(),
  },
});

const AdoptionStageResult = f.union('kind', {
  ledger: { kind: f.literal('ledger'), receipt: f.ref(AdoptionChildReceiptShape) },
  checks: {
    kind: f.literal('checks'), save: ChecksSaveResult,
    confirmation: f.nullable(f.ref(ChecksConfirmationShape)),
  },
  none: { kind: f.literal('none') },
});

const AdoptionPinSetShape = defineShape({
  name: 'AdoptionPinSetV1', fields: {
    project: f.object({ ref: f.ref(ProjectRefShape), revision: f.integer({ min: 1 }) }),
    goal: f.object({ ref: f.ref(GoalRefShape), revision: f.integer({ min: 1 }) }),
    architecture: f.nullable(f.object({
      ref: f.ref(architectureBaselineRevisionRefShape), revision: f.integer({ min: 1 }), digest: f.sha256(),
    })),
    policy: f.nullable(f.object({
      ref: f.ref(CompletionPolicyRevisionRefShape), revision: f.integer({ min: 1 }), digest: f.sha256(),
    })),
    checks: f.nullable(f.ref(ChecksConfigurationPinShape)),
  },
});

const AdoptionStageProgressShape = defineShape({
  name: 'AdoptionStageProgressV1', fields: {
    stage: f.enumOf(INITIALIZATION_ADOPT_STAGES),
    child: f.object({ commandId: id, identityKey: id, fingerprint: f.sha256() }),
    savedInput: f.json(), pins: f.ref(AdoptionPinSetShape), generation: f.integer({ min: 1 }),
    outcome: f.nullable(f.enumOf([
      'skipped', 'reused', 'installed', 'not_saved', 'saved_unconfirmed', 'failed',
    ])),
    result: f.nullable(AdoptionStageResult),
  },
});

const InitializationAdoptFailureShape = defineShape({
  name: 'InitializationAdoptFailureV1', fields: {
    code: f.enumOf(CORE_ERRORS), reason: f.string(),
  },
});

const InitializationAdoptReceiptShape = defineShape({
  name: 'InitializationAdoptReceiptV1', fields: {
    plan: f.ref(PlanRevisionRefShape), cursor: f.cursor('ledgerNonZero'),
  },
});

const AdoptionResult = f.union('status', {
  committed: {
    status: f.literal('committed'), receipt: f.ref(InitializationAdoptReceiptShape), replayed: f.boolean(),
  },
  pending: {
    status: f.literal('pending'), operationRef: f.ref(InitializationAdoptionRefShape),
    stage: f.enumOf(INITIALIZATION_ADOPT_STAGES),
    completedSteps: f.array(f.enumOf(INITIALIZATION_ADOPT_STAGES)),
    retryable: f.boolean(), failure: f.ref(InitializationAdoptFailureShape),
  },
  rejected: {
    ...CoreRejectionShape.fields,
  },
});

// The accept's immutable basis; the accepted event carries exactly these fields (never `since`).
const ACCEPT_FIELDS = {
  ref: f.ref(InitializationAdoptionRefShape),
  scope: f.ref(WorkspaceScopeShape),
  principal: f.json(),
  commandId: id,
  fingerprint: f.sha256(),
  generation: f.integer({ min: 1 }),
  source: InitializationSourceShape.fields.source,
  expectedAnswerDigest: f.sha256(),
  expectedGoal: f.object({ ref: f.ref(GoalRefShape), revision: f.integer({ min: 1 }) }),
};

// The advanced event carries the full next record minus `since`; the Store fills that from the receipt.
const ADVANCED_FIELDS = {
  ...ACCEPT_FIELDS,
  revision: f.revision({ min: 1 }),
  completedSteps: f.array(f.enumOf(INITIALIZATION_ADOPT_STAGES)),
  stages: f.array(f.ref(AdoptionStageProgressShape)),
  result: f.nullable(AdoptionResult),
};

const InitializationAdoptionFormat = defineRecord({
  name: 'InitializationAdoption', schemaId: 'InitializationAdoption@1', aggregateType: 'InitializationAdoption',
  fields: { ...ADVANCED_FIELDS, since: f.nullable(f.boundCursor('since')) },
  rules: [adoptionProgressProblem],
});

const InitializationAdoptionAcceptedFormat = defineEvent({
  name: 'InitializationAdoptionAccepted', eventType: 'InitializationAdoptionAccepted', schemaVersion: 1,
  fields: ACCEPT_FIELDS,
});

const InitializationAdoptionAdvancedFormat = defineEvent({
  name: 'InitializationAdoptionAdvanced', eventType: 'InitializationAdoptionAdvanced', schemaVersion: 1,
  fields: ADVANCED_FIELDS,
});

// --------------------------------------------------------------------------
// Codecs and the one registration
// --------------------------------------------------------------------------

const baseRecordCodec = createRecordCodec(InitializationAdoptionFormat);

export const initializationAdoptionAcceptedCodec = createEventCodec(InitializationAdoptionAcceptedFormat);
export const initializationAdoptionAdvancedCodec = createEventCodec(InitializationAdoptionAdvancedFormat);

export const initializationAdoptionCodec = {
  ...baseRecordCodec,
  /** The record type declares its arrays readonly; the field table infers mutable arrays. Encode checks and
   *  stringifies the caller's value as it stands, so this is a type-level cast only: no field is copied or reshaped. */
  encode(record: InitializationAdoptionRecordV1): EncodedRecord {
    return baseRecordCodec.encode(record as unknown as Parameters<typeof baseRecordCodec.encode>[0]);
  },
  decode(record: EncodedRecord): DecodeResult<InitializationAdoptionRecordV1> {
    return baseRecordCodec.decode(record) as unknown as DecodeResult<InitializationAdoptionRecordV1>;
  },
};

export const INITIALIZATION_ADOPTION_SCHEMAS = formatSchemas([
  baseRecordCodec, initializationAdoptionAcceptedCodec, initializationAdoptionAdvancedCodec,
]);
