/**
 * The `structural_proposal` card source: one card per frozen architecture proposal
 * batch while any of its members is still pending. It is a read projection over the
 * batch and member records — no card record, no decision-source fact and no
 * re-trial on read. A batch that does not exist yet (a `pending_batch` proposal)
 * has no card; a batch whose members all reached a terminal state is closed.
 *
 * The card's pins are the batch record, its frozen baseline revision and the
 * current `ProjectArchitectureBaselineActive` pointer: the approval guards those
 * three records. A changed batch content or base pin is a different batch id and
 * therefore a different key; an old answer cannot point at it.
 */
import type { ArchitectureProposalBatchRef, ArchitectureProposalBatchV1,
  ArchitectureProposalRef } from '../../../contracts/architecture-proposal.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { decisionSourceKey, type DecisionObjectV1, type DecisionOptionV1,
  type DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey, canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { DecisionCardSourcePort, DecisionCardV1 } from '../model/decision-contracts.js';
import { createCollectionCardSource } from './decision-read-model.js';
import { runRefOfPins, taskRefOfPins } from './decision-card-refs.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { parseDecisionSourceKey, nestedSourceObject } from '../tasks/decision-source-identity.js';
import {
  ArchitectureProposalBatchRefShape,
  decodeArchitectureProposalBatchRecord, decodeArchitectureProposalRecord,
  type ArchitectureProposalRecordV1,
} from '../architecture/proposal-record-codecs.js';
import { readProjectBatches } from '../architecture/proposal-service.js';
import { readCurrentCatalogWindow, type CurrentCatalogWindow } from '../architecture/catalog-service.js';
import { STRUCTURAL_PROPOSAL_OPTIONS } from '../communication/decision-source-facts.js';

/** The batch, its members and the active pointer revision read once for one projection. */
export type StructuralProposalCardFactsV1 = {
  batch: ArchitectureProposalBatchV1;
  members: ArchitectureProposalRecordV1[];
  activeRevision: number;
  /** M6: every member resolves to its exploration round; only then does the card show “不对，重新提”. */
  repropose: boolean;
};

export type StructuralProposalSourceDependencies = {
  records: {
    readMany(refKeys: readonly string[]): ReturnType<import('../../record-store/ports.js').GoalRecordTransactionPort['readMany']>;
    lookup: import('../../record-store/lookup-ports.js').RecordLookupPort['lookup'];
  };
  /** The same judgement and function the answer facts call; absent keeps the two original options. */
  reproposeAdmits?: (ctx: CoreCallContext, batchRef: ArchitectureProposalBatchRef,
    members: readonly ArchitectureProposalRef[]) => Promise<boolean>;
};

function batchRefOfSource(source: DecisionSourceV1): ArchitectureProposalBatchRef | null {
  if (source.kind !== 'structural_proposal') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'structural_proposal') return null;
  const raw = nestedSourceObject(parsed.body, 'batch');
  if (raw === null || checkShape(ArchitectureProposalBatchRefShape, raw, 'stored') !== null) return null;
  return raw as unknown as ArchitectureProposalBatchRef;
}

async function readMembers(deps: StructuralProposalSourceDependencies,
  batch: ArchitectureProposalBatchV1): Promise<ReadResult<ArchitectureProposalRecordV1[]>> {
  const keys = batch.members.map(member => canonicalKey(member));
  let read;
  try {
    read = await deps.records.readMany(keys);
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: `the proposal members could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' }
      : storeFailureToRejection(read, 'current' in read ? read.current : undefined);
  }
  const byKey = new Map(read.value.records.map((record: EncodedRecord) => [record.refKey, record]));
  const members: ArchitectureProposalRecordV1[] = [];
  for (const key of keys) {
    const encoded = byKey.get(key);
    if (encoded === undefined) {
      return read.value.missing.includes(key) ? { status: 'not_found' }
        : { status: 'rejected', code: 'unavailable', reason: `the proposal member ${key} was not read` };
    }
    const decoded = decodeArchitectureProposalRecord(encoded);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `a proposal member is damaged: ${decoded.reason}` };
    }
    members.push(decoded.value);
  }
  return { status: 'ready', value: members };
}

/** A card exists while at least one member is pending; every terminal member closes the batch's card. */
function isOpen(facts: { members: readonly ArchitectureProposalRecordV1[] }): boolean {
  return facts.members.some(member => member.state === 'pending');
}

function windowRejection(window: Exclude<CurrentCatalogWindow, { status: 'ready' }>) {
  return window.status === 'rejected' ? window
    : { status: 'rejected' as const, code: 'unavailable' as const, reason: 'the current architecture catalog is not readable' };
}

function pinsOf(facts: StructuralProposalCardFactsV1): VersionPin[] {
  return [
    { ref: structuredClone(facts.batch.ref), revision: 1 },
    { ref: structuredClone(facts.batch.baseCatalogPin.baseline.ref), revision: 1 },
    { ref: { aggregateType: 'ProjectArchitectureBaselineActive', projectId: facts.batch.ref.projectId },
      revision: facts.activeRevision },
  ];
}

/**
 * The one construction of a structural proposal's decision objects: the frozen
 * batch content (digest, ops, responsibility moves) and its member reasons in
 * member order. The card projection and the answer facts both call this; a
 * second label-only construction is what let an annotated answer name no card
 * object.
 */
export function structuralProposalObjects(
  facts: Pick<StructuralProposalCardFactsV1, 'batch' | 'members'>,
): DecisionObjectV1[] {
  const batchObject: DecisionObjectV1 = {
    kind: 'aggregate',
    pin: { ref: structuredClone(facts.batch.ref), revision: 1 },
    label: canonicalJson({
      digest: facts.batch.digest, ops: facts.batch.ops,
      responsibilityMoves: facts.batch.responsibilityMoves,
    } as unknown as JsonValue),
  };
  const members = facts.members.map(member => ({
    kind: 'aggregate' as const,
    pin: { ref: structuredClone(member.ref), revision: member.revision },
    label: member.reason,
  }));
  return [batchObject, ...members];
}

/**
 * The answer-facts read of the same objects for a source's pinned batch. It
 * needs only `records`, so the composition binds it directly and
 * `decision-source-facts.ts` stays free of architecture imports.
 */
export async function readStructuralProposalObjects(
  records: StructuralProposalSourceDependencies['records'],
  source: DecisionSourceV1,
): Promise<ReadResult<DecisionObjectV1[]>> {
  const ref = batchRefOfSource(source);
  if (ref === null) {
    return { status: 'rejected', code: 'invalid', reason: 'a structural_proposal source names no batch' };
  }
  const batch = await readBatchByRef({ records }, ref);
  if (batch.status !== 'ready') return batch;
  if (batch.value === null) {
    return { status: 'rejected', code: 'invalid', reason: 'the structural_proposal source batch does not exist' };
  }
  const members = await readMembers({ records }, batch.value);
  if (members.status !== 'ready') return members;
  return { status: 'ready', value: structuralProposalObjects({ batch: batch.value, members: members.value }) };
}

function optionsOf(facts: StructuralProposalCardFactsV1): DecisionOptionV1[] {
  return STRUCTURAL_PROPOSAL_OPTIONS.filter(option => facts.repropose || option.id !== 'repropose')
    .map(option => ({ ...option }));
}

function projectCard(facts: StructuralProposalCardFactsV1, subject: DecisionSourceV1['subject']): DecisionCardV1 {
  const source: DecisionSourceV1 = {
    kind: 'structural_proposal',
    key: decisionSourceKey({ kind: 'structural_proposal', batch: facts.batch.ref }),
    subject: structuredClone(subject),
    pins: pinsOf(facts),
    goalBases: [],
  };
  return {
    cardKey: source.key,
    source,
    state: 'waiting_answer',
    subject: structuredClone(subject),
    senderSessionRef: null,
    requestRef: null,
    objects: structuralProposalObjects(facts),
    options: optionsOf(facts),
    answerMessageRef: null,
    answer: null,
    application: null,
    candidateStatus: null,
    staleReason: null,
    closedReason: null,
    openedAt: null,
    taskRef: taskRefOfPins(source.pins), runRef: runRefOfPins(source.pins),
    readOnly: false,
    actions: ['answer'],
  };
}

async function readBatchByRef(deps: StructuralProposalSourceDependencies, ref: ArchitectureProposalBatchRef):
Promise<ReadResult<ArchitectureProposalBatchV1 | null>> {
  const key = canonicalKey(ref);
  let read;
  try {
    read = await deps.records.readMany([key]);
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: `the proposal batch could not be read: ${messageOf(error)}` };
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'ready', value: null }
      : storeFailureToRejection(read, 'current' in read ? read.current : undefined);
  }
  const encoded = read.value.records.find((record: EncodedRecord) => record.refKey === key);
  if (encoded === undefined) {
    return read.value.missing.includes(key) ? { status: 'ready', value: null }
      : { status: 'rejected', code: 'unavailable', reason: 'the proposal batch was not read' };
  }
  const decoded = decodeArchitectureProposalBatchRecord(encoded);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `the proposal batch is damaged: ${decoded.reason}` };
  }
  const { revision: _revision, ...batch } = decoded.value;
  return { status: 'ready', value: batch };
}

async function readFacts(deps: StructuralProposalSourceDependencies, ctx: CoreCallContext,
  batch: ArchitectureProposalBatchV1, activeRevision: number): Promise<ReadResult<StructuralProposalCardFactsV1>> {
  const members = await readMembers(deps, batch);
  if (members.status !== 'ready') return members;
  // A closed batch never needs its sources: the same members decide the gate before any proposal/operation read.
  const repropose = isOpen({ members: members.value }) && deps.reproposeAdmits !== undefined
    && await deps.reproposeAdmits(ctx, batch.ref, members.value.map(member => member.ref));
  return { status: 'ready', value: { batch, members: members.value, activeRevision, repropose } };
}

export function createStructuralProposalSource(
  deps: StructuralProposalSourceDependencies,
): DecisionCardSourcePort {
  return createCollectionCardSource<StructuralProposalCardFactsV1>({
    kind: 'structural_proposal',
    serves: ['project'],
    async readCollection(ctx: CoreCallContext, { workspace }) {
      const projectId = workspace.projectId;
      // §3.7 item 3: a project with no frozen batch has no card, so a missing
      // current catalog must not make the whole queue unreadable.
      const batches = await readProjectBatches(deps.records, projectId);
      if (batches.status !== 'ready') return batches;
      if (batches.value.length === 0) return { status: 'ready', value: [] };
      const window = await readCurrentCatalogWindow(deps.records, projectId);
      if (window.status !== 'ready') return windowRejection(window);
      const items: StructuralProposalCardFactsV1[] = [];
      for (const batch of batches.value) {
        const facts = await readFacts(deps, ctx, batch, window.activeRevision);
        if (facts.status !== 'ready') return facts;
        if (isOpen(facts.value)) items.push(facts.value);
      }
      return { status: 'ready', value: items };
    },
    keyOf: (facts) => decisionSourceKey({ kind: 'structural_proposal', batch: facts.batch.ref }),
    project: (facts, subject) => projectCard(facts, subject),
    async readByKey(ctx, { workspace, source }) {
      const projectId = workspace.projectId;
      const ref = batchRefOfSource(source);
      if (ref === null || ref.projectId !== projectId) {
        return { status: 'rejected', code: 'invalid',
          reason: 'a structural_proposal source key is not a batch of this project' };
      }
      const batch = await readBatchByRef(deps, ref);
      if (batch.status !== 'ready') return batch;
      if (batch.value === null) return { status: 'ready', value: null };
      const window = await readCurrentCatalogWindow(deps.records, projectId);
      if (window.status !== 'ready') return windowRejection(window);
      const facts = await readFacts(deps, ctx, batch.value, window.activeRevision);
      if (facts.status !== 'ready') return facts;
      if (!isOpen(facts.value)) return { status: 'ready', value: { closed: 'source_resolved', openedAt: null } };
      return { status: 'ready', value: { item: facts.value } };
    },
  });
}
