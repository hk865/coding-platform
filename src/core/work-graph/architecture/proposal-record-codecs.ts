/**
 * The `ArchitectureProposal@1` and `ArchitectureProposalBatch@1` record codecs
 * and the `ArchitectureProposalChanged@1` event codec: one field table each, the
 * record store registration and the two project lookups the proposal service and
 * the structural-proposal card source read.
 *
 * The proposal's content is immutable; only `state` and `batchRef` change, so the
 * machine (`state/architecture-proposal-machine.ts`) owns those transitions and the
 * codec only persists the result. The batch is immutable after its freeze. The ops
 * and moves are stored as JSON arrays and checked by the existing op/move rules
 * (`parseRepairOps`, `catalogRevisionMovesProblem`) rather than a second shape copy.
 * Every proposal commit carries at least one state event (entering a batch, or a
 * terminal state); a reject/stale proof rides on that commit's last state event.
 */
import type {
  ArchitectureProposalBatchRef, ArchitectureProposalBatchV1, ArchitectureProposalRef,
} from '../../../contracts/architecture-proposal.js';
import { architectureCatalogPinShape } from '../../../contracts/architecture-catalog.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import { defineEvent, defineRecord, defineShape, f } from '../../../contracts/data-format.js';
import { OperationRefShape, QueryRunRefShape, SessionRefShape, id } from '../../../contracts/data-format-refs.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas } from '../../record-store/ports.js';
import { decisionChangeProofProblem } from '../persistence/decision-record-codecs.js';
import { actorProblem } from '../persistence/event-validation.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
import {
  ARCHITECTURE_PROPOSAL_STATES, type ArchitectureProposalRecordV1, type ArchitectureProposalStateV1,
} from '../state/architecture-proposal-machine.js';
import { parseRepairOps } from './repair-ops.js';
import { catalogRevisionMovesProblem } from './revision-planner.js';

/** The two aggregate refs the proposal records are keyed by; both are closed `AggregateRef` arms. */
export const ArchitectureProposalRefShape = defineShape({
  name: 'ArchitectureProposalRef',
  fields: { aggregateType: f.literal('ArchitectureProposal'), projectId: id, proposalId: id },
});

export const ArchitectureProposalBatchRefShape = defineShape({
  name: 'ArchitectureProposalBatchRef',
  fields: { aggregateType: f.literal('ArchitectureProposalBatch'), projectId: id, batchId: id },
});

/** The moves are checked by the planner's one shape rule, against no catalog (the trial is the freeze's). */
function movesProblem(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const moves = value['responsibilityMoves'];
  const ref = value['ref'];
  if (!Array.isArray(moves) || !isRecord(ref) || typeof ref['projectId'] !== 'string') return null;
  const problem = catalogRevisionMovesProblem(moves, ref['projectId'], null);
  return problem === null ? null : `responsibilityMoves: ${problem}`;
}

/** One proposal's ops are the op engine's array (1..20, no duplicate); the batch is the freeze's merged trial. */
function proposalContentProblem(value: unknown): string | null {
  if (isRecord(value) && Array.isArray(value['ops'])) {
    const parsed = parseRepairOps(value['ops']);
    if (!parsed.ok) return `ops: ${parsed.problem.detail}`;
  }
  return movesProblem(value);
}

export const ArchitectureProposalFields = {
  ref: f.ref(ArchitectureProposalRefShape),
  revision: f.revision({ min: 1 }),
  batchRef: f.nullable(f.ref(ArchitectureProposalBatchRefShape)),
  baseCatalogPin: f.ref(architectureCatalogPinShape),
  ops: f.array(f.json(), { min: 1, max: 20 }),
  responsibilityMoves: f.array(f.json()),
  reason: f.string(),
  proposer: f.ref(SessionRefShape),
  operationRef: f.nullable(f.ref(OperationRefShape)),
  queryRunRef: f.optional(f.nullable(f.ref(QueryRunRefShape))),
  state: f.enumOf(ARCHITECTURE_PROPOSAL_STATES),
};

export const ArchitectureProposalBatchFields = {
  ref: f.ref(ArchitectureProposalBatchRefShape),
  revision: f.literal(1),
  members: f.array(f.ref(ArchitectureProposalRefShape), { min: 1 }),
  baseCatalogPin: f.ref(architectureCatalogPinShape),
  ops: f.array(f.json(), { min: 1 }),
  responsibilityMoves: f.array(f.json()),
  digest: f.sha256(),
};

/** One project's proposals in proposal-id order, for the pending set and the read. */
export const S8C_PROPOSAL_BY_PROJECT_LOOKUP = 's8c-architecture-proposal-by-project';
/** One project's frozen batches in batch-id order; the card source lists the card-bearing ones. */
export const S8C_PROPOSAL_BATCH_BY_PROJECT_LOOKUP = 's8c-architecture-proposal-batch-by-project';

export const ArchitectureProposalFormat = defineRecord({
  name: 'ArchitectureProposal',
  schemaId: 'ArchitectureProposal@1',
  aggregateType: 'ArchitectureProposal',
  fields: ArchitectureProposalFields,
  rules: [proposalContentProblem],
  lookups: [{
    name: S8C_PROPOSAL_BY_PROJECT_LOOKUP,
    equal: ['ref.projectId'],
    orderBy: { path: 'ref.proposalId', valueType: 'text' },
  }],
});

export const ArchitectureProposalBatchFormat = defineRecord({
  name: 'ArchitectureProposalBatch',
  schemaId: 'ArchitectureProposalBatch@1',
  aggregateType: 'ArchitectureProposalBatch',
  fields: ArchitectureProposalBatchFields,
  rules: [movesProblem],
  lookups: [{
    name: S8C_PROPOSAL_BATCH_BY_PROJECT_LOOKUP,
    equal: ['ref.projectId'],
    orderBy: { path: 'ref.batchId', valueType: 'text' },
  }],
});

/** The record as stored: the contract content plus the store revision. */
export type ArchitectureProposalBatchRecordV1 = ArchitectureProposalBatchV1 & { revision: 1 };
export type { ArchitectureProposalRecordV1 };

/** One proposal state change (entering a batch or a terminal state); a reject/stale proof rides on the last one. */
export const ARCHITECTURE_PROPOSAL_CHANGED_EVENT = 'ArchitectureProposalChanged' as const;

export type ArchitectureProposalChangedEventV1 = {
  eventId: string;
  eventType: typeof ARCHITECTURE_PROPOSAL_CHANGED_EVENT;
  schemaVersion: 1;
  occurredAt: string;
  projectId: string;
  proposalRef: ArchitectureProposalRef;
  revision: number;
  state: ArchitectureProposalStateV1;
  batchRef: ArchitectureProposalBatchRef | null;
  actor: ActorRef;
  proof?: DecisionChangeProofV1;
};

function proposalChangedProblem(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const actor = actorProblem(value['actor']);
  if (actor !== null) return `actor: ${actor}`;
  const proof = value['proof'];
  if (proof !== undefined) {
    const problem = decisionChangeProofProblem(proof);
    if (problem !== null) return `proof: ${problem}`;
  }
  return null;
}

export const ArchitectureProposalChangedFormat = defineEvent({
  name: 'ArchitectureProposalChanged',
  eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT,
  schemaVersion: 1,
  fields: {
    projectId: id,
    proposalRef: f.ref(ArchitectureProposalRefShape),
    revision: f.revision({ min: 1 }),
    state: f.enumOf(ARCHITECTURE_PROPOSAL_STATES),
    batchRef: f.nullable(f.ref(ArchitectureProposalBatchRefShape)),
    actor: f.json(),
    proof: f.optional(f.json()),
  },
  rules: [proposalChangedProblem],
});

export const architectureProposalCodec = createRecordCodec(ArchitectureProposalFormat);
export const architectureProposalBatchCodec = createRecordCodec(ArchitectureProposalBatchFormat);
export const architectureProposalChangedEventCodec = createEventCodec(ArchitectureProposalChangedFormat);

/** Both proposal records and their state event in one registration group. */
export const ARCHITECTURE_PROPOSAL_SCHEMAS: RecordBackendSchemas =
  formatSchemas([architectureProposalCodec, architectureProposalBatchCodec, architectureProposalChangedEventCodec]);

export function encodeArchitectureProposalRecord(record: ArchitectureProposalRecordV1): EncodedRecord {
  return architectureProposalCodec.encode(record);
}

export function encodeArchitectureProposalBatchRecord(record: ArchitectureProposalBatchRecordV1): EncodedRecord {
  return architectureProposalBatchCodec.encode(record);
}

export function decodeArchitectureProposalRecord(
  record: EncodedRecord,
): DecodeResult<ArchitectureProposalRecordV1> {
  const decoded = architectureProposalCodec.decode(record);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: decoded.value as ArchitectureProposalRecordV1 };
}

export function decodeArchitectureProposalBatchRecord(
  record: EncodedRecord,
): DecodeResult<ArchitectureProposalBatchRecordV1> {
  const decoded = architectureProposalBatchCodec.decode(record);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: decoded.value as ArchitectureProposalBatchRecordV1 };
}

export function encodeArchitectureProposalChangedEvent(
  event: ArchitectureProposalChangedEventV1,
): EncodedDomainEvent {
  return architectureProposalChangedEventCodec.encode(event);
}

export function decodeArchitectureProposalChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<ArchitectureProposalChangedEventV1> {
  const decoded = architectureProposalChangedEventCodec.decode(event);
  if (decoded.status !== 'decoded') return decoded;
  return { status: 'decoded', value: decoded.value as ArchitectureProposalChangedEventV1 };
}
