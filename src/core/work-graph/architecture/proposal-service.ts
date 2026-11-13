/**
 * The structural-proposal owner: the exploration line writes a pinned proposal,
 * the batch freeze groups compatible proposals behind one card, and the person's
 * answer applies or closes the batch. It is the only writer of
 * `ArchitectureProposal`/`ArchitectureProposalBatch` records and the only caller of
 * the catalog planner on behalf of a proposal.
 *
 * The write trial reuses G2's `planCatalogRevision` (the same op, delete and move
 * rules as the human revision path) and discards its contribution; the approval
 * commits that contribution whole, with the proposal state records and the
 * proposal proof joined to it. The planner's catalog event stays the commit's last
 * event, because the revision restore path depends on that order.
 */
import type {
  ArchitectureProposalBatchRef, ArchitectureProposalBatchV1, ArchitectureProposalRef,
  ArchitectureProposalV1, ApplyBatchResult, ProposalRead, ProposalResult,
  ProposeArchitectureRevisionInputV1, StructuralApprovalV1,
} from '../../../contracts/architecture-proposal.js';
import type { ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import {
  ARCHITECTURE_FILE_PATH, type KnowledgeConflictV1, type ProposalBatchFileV1,
} from '../../../contracts/knowledge.js';
import { STRUCTURAL_AUTO_APPROVAL_ACTOR } from '../../../contracts/task-requeue.js';
import { truncateUtf8 } from '../../../contracts/utf8.js';
import type { CatalogRepairOpV1 } from '../../../contracts/note.js';
import { qualifyProjectPath } from '../../../contracts/workspace-path.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { principalIdentity } from '../../../contracts/core/call-context.js';
import type { ProjectScope, RoleConfigurationRef, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { NotifyProjectInputV1 } from '../../../contracts/role-lines.js';
import type { DecisionChangeProofV1, DecisionSourceV1, UserDecisionBodyV1 } from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, canonicalKey, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import { OperationRefShape } from '../../../contracts/data-format-refs.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreFailure,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { hostSystemContext, platformCheckContext } from '../model/platform-check-context.js';
import type { KnowledgeDiskFileV1, LineKnowledge } from '../model/line-knowledge.js';
import {
  knowledgeCommit, knowledgeFilesNotWritten, writeKnowledge, type KnowledgePrepared, type KnowledgeWritePlan,
} from '../knowledge/knowledge-write.js';
import type { RoleExplorationSegmentV1 } from '../state/role-exploration.js';
import { commandKeys, type CommitFragment } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { lookupCommittedReceipt, type CommittedReceipt } from '../persistence/receipt-lookup.js';
import {
  newArchitectureProposalRecord, transitionArchitectureProposal,
  type ArchitectureProposalRecordV1,
} from '../state/architecture-proposal-machine.js';
import {
  ARCHITECTURE_PROPOSAL_CHANGED_EVENT, decodeArchitectureProposalBatchRecord,
  decodeArchitectureProposalChangedEvent, decodeArchitectureProposalRecord,
  encodeArchitectureProposalBatchRecord, encodeArchitectureProposalChangedEvent,
  encodeArchitectureProposalRecord, S8C_PROPOSAL_BATCH_BY_PROJECT_LOOKUP, S8C_PROPOSAL_BY_PROJECT_LOOKUP,
} from './proposal-record-codecs.js';
import type { ArchitectureRevision } from './catalog-contracts.js';
import {
  decodeArchitectureCatalogRevisedEvent, encodeArchitectureCatalogRevisedEvent,
} from './catalog-record-codecs.js';
import {
  architectureWritePlansOf, catalogPinOf, knowledgeBaselineOf, opsInProjectView, readCurrentCatalogWindow,
  readRecordedCatalogWindow, reframeRepairOps, type CurrentCatalogWindow,
} from './catalog-service.js';
import { architectureFilesOf, knowledgeConflictsOf, platformFileSource } from './architecture-file.js';
import { exactKeys } from './architecture-service.js';
import {
  catalogRevisionMovesProblem, catalogRevisionPinProblem, draftCatalogRevision, finishCatalogRevision,
  planCatalogRevision, type CatalogRevisionDependencies,
} from './revision-planner.js';
import { parseRepairOps } from './repair-ops.js';

/**
 * The window read: `open` is the owning exploration operation's phase-and-pin verdict; `operationRef`/`revision`
 * are that record's own, and the proposal commit guards them, so a lifecycle pass that moves the record between this
 * read and the commit makes the proposal re-read the (now closed) window (`book-7d2-frozen.md:796`, `ports.ts:125`).
 */
export type ProposalBatchWindowReadV1 = {
  open: boolean; operationRef: OperationRef | null; revision: number | null;
};

/**
 * The optional exploration window fact; absent means the immediate single-member freeze. The window takes the
 * proposal's own base pin: an exploration batch binds one pin, so a proposal on any other pin freezes alone
 * (`book-7d2-frozen.md:792`, `:796`).
 */
export type ProposalBatchWindowPort = {
  isOpen(ctx: CoreCallContext, input: { projectRef: ProjectScope; baseCatalogPin: ArchitectureCatalogPinV1;
    /** M6: the trusted operation ref the proposer facts resolved, so a follow-up's own window is found exactly. */
    operationRef?: OperationRef | null }):
    Promise<ReadResult<ProposalBatchWindowReadV1>>;
};

/** The trusted Run→Session facts the composition resolves for a `work_run` proposer. */
export type ProposalRunFactResolver = (ctx: CoreCallContext, runRef: RunRef) =>
  Promise<ReadResult<{ sessionRef: SessionRef; role: RoleConfigurationRef }>>;

/**
 * The trusted QueryRun facts the composition resolves for a `query_run` proposer; `segment` is the round's entry in
 * the operation that opened it (null when the operation names no entry for it).
 */
export type ProposalQueryRunFactResolver = (ctx: CoreCallContext, queryRunRef: QueryRunRef) =>
  Promise<ReadResult<{ sessionRef: SessionRef; role: RoleConfigurationRef; kind: 'role_exploration';
    operationRef: OperationRef | null; queryRunRef: QueryRunRef; segment: RoleExplorationSegmentV1 | null }>>;

/** The decision-message owner's answer read; the answer's selection and captured pins are the approval's facts. */
export type ProposalDecisionMessageRead = {
  readDecisionAnswer(ctx: CoreCallContext, input: { source: DecisionSourceV1 }):
    Promise<ReadResult<{ message: SessionMessage | null; body: UserDecisionBodyV1 | null }>>;
};

/**
 * The proposal owner's dependencies. The G2 `CatalogRevisionDependencies` are the
 * same records/clock/ports the human revision path uses, so the write trial and the
 * approval plan cannot drift from it. `proposalBatchWindow` is read once, after the
 * trial and before the pending write; a read failure writes nothing.
 */
export type ProposalServiceDeps = CatalogRevisionDependencies & {
  proposalBatchWindow?: ProposalBatchWindowPort;
  decisionMessages: ProposalDecisionMessageRead;
  runFacts: ProposalRunFactResolver;
  /** The `query_run` proposer's facts (the planning QueryRun resolver's `readProposerFacts`). */
  queryRunFacts: ProposalQueryRunFactResolver;
  /** The project's main workspace; absent treats the caller's workspace as main. */
  mainWorkspaceOf?: (projectId: string) => Promise<ReadResult<string | null>>;
  /** R-16/R-17: the exploration control's repropose entry; the answer path creates the follow-up before closing. */
  repropose?: (ctx: CoreCallContext, input: { batchRef: ArchitectureProposalBatchRef; reason: string }) =>
    Promise<WriteResult<{ target: 'coarse_split' | 'followup'; operation: OperationRef }>>;
  /** 121-109: the project's structural auto-approval, read once before a freeze; absent never approves. */
  structuralApproval?: (projectId: string) => StructuralApprovalV1;
};

export type ArchitectureProposalService = {
  proposeArchitectureRevision(ctx: CoreCallContext,
    input: ProposeArchitectureRevisionInputV1 & { commandId: string }): Promise<ProposalResult>;
  freezeArchitectureProposalBatch(ctx: CoreCallContext,
    input: { baseCatalogPin: ArchitectureCatalogPinV1; proposalRefs: ArchitectureProposalRef[] }):
    Promise<ReadResult<ArchitectureProposalBatchV1[]>>;
  applyArchitectureProposalBatch(ctx: CoreCallContext,
    input: { batchRef: ArchitectureProposalBatchRef; answerMessageRef: SessionMessageRef }):
    Promise<ApplyBatchResult<ArchitectureRevision>>;
  readArchitectureProposal(ctx: CoreCallContext,
    input: { proposalRef: ArchitectureProposalRef }): Promise<ReadResult<ProposalRead>>;
  /** KC-1 G2 (ruling 4-9): the files this batch would create, change or delete if approved now; a read-time hint. */
  readProposalBatchFiles(ctx: CoreCallContext, input: { batchRef: ArchitectureProposalBatchRef }):
    Promise<ReadResult<{ files: readonly ProposalBatchFileV1[] }>>;
  /** Every pending, unbatched proposal of the project, in proposal-id order. */
  readPendingArchitectureProposals(ctx: CoreCallContext, input: { projectRef: ProjectScope }):
    Promise<ReadResult<ArchitectureProposalRef[]>>;
  /** The project's frozen batches on one pin, by the freeze's own pin rule. */
  readFrozenArchitectureBatches(ctx: CoreCallContext,
    input: { projectRef: ProjectScope; baseCatalogPin: ArchitectureCatalogPinV1 }):
    Promise<ReadResult<ArchitectureProposalBatchRef[]>>;
};

type Clock = { now: string; eventId: string };

/** The read revision is store metadata, not proposal content. */
function proposalOf(record: ArchitectureProposalRecordV1): ArchitectureProposalV1 {
  const { revision: _revision, ...proposal } = record;
  return proposal;
}

function rejectionOf(failure: StoreFailure): CoreRejection {
  return storeFailureToRejection(failure, 'current' in failure ? failure.current : undefined);
}

function readFailure(read: { status: string; code?: string; reason?: string }): CoreRejection {
  return read.status === 'rejected'
    ? rejected(read.code as CoreRejection['code'], read.reason ?? 'the read failed')
    : rejected('unavailable', 'the record read is not ready');
}

/**
 * The planner admits a catalog revision only through the Host principal. A proposal
 * write is a read-only trial whose contribution is discarded, so it runs under a
 * fixed internal system identity; the real proposer is stored on the proposal from
 * the trusted Run or `role_exploration` QueryRun facts, never from the model.
 */
const TRIAL_ACTOR: { kind: 'system'; id: string } = Object.freeze({ kind: 'system', id: 'architecture-proposal-trial' });

function hostActorOf(ctx: CoreCallContext): ActorRef | null {
  return ctx.principal.kind === 'host' ? ctx.principal.actor : null;
}

function workActorOf(ctx: CoreCallContext, sessionRef: SessionRef): ActorRef | null {
  if (ctx.principal.kind !== 'work_run') return null;
  return { kind: 'agent', id: sessionRef.sessionId, runRef: ctx.principal.runRef };
}

function operationRefProblem(value: unknown): string | null {
  if (value === undefined) return null;
  return checkShape(OperationRefShape, value, 'pending');
}

function messageRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !exactKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])) {
    return 'the answer message ref is incomplete';
  }
  if (value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return 'the answer message ref is incomplete';
  }
  return null;
}

function proposalRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !exactKeys(value, ['aggregateType', 'projectId', 'proposalId'])) {
    return 'the proposal ref is incomplete';
  }
  if (value['aggregateType'] !== 'ArchitectureProposal' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['proposalId'])) {
    return 'the proposal ref is incomplete';
  }
  return null;
}

function batchRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !exactKeys(value, ['aggregateType', 'projectId', 'batchId'])) {
    return 'the batch ref is incomplete';
  }
  if (value['aggregateType'] !== 'ArchitectureProposalBatch' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['batchId'])) {
    return 'the batch ref is incomplete';
  }
  return null;
}

// --------------------------------------------------------------------------
// Record reads
// --------------------------------------------------------------------------

async function readProposal(deps: ProposalServiceDeps, ref: ArchitectureProposalRef):
Promise<ReadResult<ArchitectureProposalRecordV1>> {
  const key = canonicalKey(ref);
  let read;
  try {
    read = await deps.records.readMany([key]);
  } catch (error) {
    return rejected('unavailable', `the proposal record could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejectionOf(read);
  }
  const record = read.value.records.find(entry => entry.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key) ? { status: 'not_found' }
      : rejected('unavailable', 'the proposal record read neither returned nor reported the record missing');
  }
  const decoded = decodeArchitectureProposalRecord(record);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the proposal record is damaged: ${decoded.reason}`);
  }
  return { status: 'ready', value: decoded.value };
}

async function readProposals(deps: ProposalServiceDeps, refs: readonly ArchitectureProposalRef[]):
Promise<ReadResult<ArchitectureProposalRecordV1[]>> {
  const byKey = new Map<string, ArchitectureProposalRef>();
  for (const ref of refs) byKey.set(canonicalKey(ref), ref);
  const keys = [...byKey.keys()];
  if (keys.length === 0) return { status: 'ready', value: [] };
  let read;
  try {
    read = await deps.records.readMany(keys);
  } catch (error) {
    return rejected('unavailable', `the proposal records could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejectionOf(read);
  }
  const byRefKey = new Map(read.value.records.map(record => [record.refKey, record]));
  const proposals: ArchitectureProposalRecordV1[] = [];
  for (const key of keys) {
    const encoded = byRefKey.get(key);
    if (encoded === undefined) {
      return read.value.missing.includes(key) ? { status: 'not_found' }
        : rejected('unavailable', `the proposal record ${key} read neither returned nor reported missing`);
    }
    const decoded = decodeArchitectureProposalRecord(encoded);
    if (decoded.status !== 'decoded') {
      return rejected('unavailable', `a proposal record is damaged: ${decoded.reason}`);
    }
    proposals.push(decoded.value);
  }
  return { status: 'ready', value: proposals };
}

async function readBatch(deps: ProposalServiceDeps, ref: ArchitectureProposalBatchRef):
Promise<ReadResult<ArchitectureProposalBatchV1>> {
  const key = canonicalKey(ref);
  let read;
  try {
    read = await deps.records.readMany([key]);
  } catch (error) {
    return rejected('unavailable', `the proposal batch could not be read: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejectionOf(read);
  }
  const record = read.value.records.find(entry => entry.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key) ? { status: 'not_found' }
      : rejected('unavailable', 'the proposal batch read neither returned nor reported the record missing');
  }
  const decoded = decodeArchitectureProposalBatchRecord(record);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the proposal batch is damaged: ${decoded.reason}`);
  }
  const { revision: _revision, ...batch } = decoded.value;
  return { status: 'ready', value: batch };
}

async function readBatchMembers(deps: ProposalServiceDeps, batch: ArchitectureProposalBatchV1):
Promise<ReadResult<ArchitectureProposalRecordV1[]>> {
  return readProposals(deps, batch.members);
}

// --------------------------------------------------------------------------
// Identity, proof and commit helpers
// --------------------------------------------------------------------------

function receiptOf(keys: { identityKey: string; fingerprint: string }, cursor: CommittedReceipt['cursor']):
{ identityKey: string; fingerprint: string; cursor: CommittedReceipt['cursor'] } {
  return { identityKey: keys.identityKey, fingerprint: keys.fingerprint, cursor };
}

function answerPins(message: SessionMessage): VersionPin[] {
  if (message.response === null || !('decision' in message.response)) return [];
  return message.response.decision.source.pins.map(pin => structuredClone(pin));
}

function changeProof(message: SessionMessage, changes: { before: VersionPin; after: VersionPin }[]):
DecisionChangeProofV1 {
  return {
    acknowledgementRef: structuredClone(message.ref),
    capturedPins: answerPins(message),
    changes: changes.map(change => ({
      before: structuredClone(change.before), after: structuredClone(change.after),
    })),
    basisRebases: [],
  };
}

function proposalPins(records: readonly ArchitectureProposalRecordV1[]):
{ before: VersionPin; after: VersionPin }[] {
  return records.map(record => ({
    before: { ref: structuredClone(record.ref), revision: record.revision },
    after: { ref: structuredClone(record.ref), revision: record.revision + 1 },
  }));
}

function baselinePinOf(pin: ArchitectureCatalogPinV1, revision: number): VersionPin {
  return { ref: structuredClone(pin.baseline.ref), revision };
}

function activePinOf(projectId: string, revision: number): VersionPin {
  return { ref: { aggregateType: 'ProjectArchitectureBaselineActive', projectId }, revision };
}

function proposalBatchReason(members: readonly ArchitectureProposalRecordV1[]): string {
  return members.map(member => member.reason).join('\n');
}

function batchOf(projectId: string, members: readonly ArchitectureProposalRecordV1[],
  baseCatalogPin: ArchitectureCatalogPinV1): ArchitectureProposalBatchV1 {
  const memberRefs = members.map(member => structuredClone(member.ref));
  const ops = members.flatMap(member => member.ops.map(op => structuredClone(op)));
  const responsibilityMoves = members.flatMap(member => member.responsibilityMoves.map(move => structuredClone(move)));
  const batchId = sha256Hex(canonicalJson({ baseCatalogPin, members: memberRefs } as unknown as JsonValue));
  const digest = sha256Hex(canonicalJson({
    members: memberRefs, baseCatalogPin, ops, responsibilityMoves,
  } as unknown as JsonValue));
  return {
    ref: { aggregateType: 'ArchitectureProposalBatch', projectId, batchId },
    members: memberRefs, baseCatalogPin: structuredClone(baseCatalogPin), ops, responsibilityMoves, digest,
  };
}

async function trialCatalogRevision(deps: ProposalServiceDeps, ctx: CoreCallContext,
  pin: ArchitectureCatalogPinV1, ops: readonly unknown[], moves: readonly unknown[], reason: string,
  commandId: string): Promise<CoreRejection | null> {
  const input = {
    expected: pin,
    ops: ops as ProposeArchitectureRevisionInputV1['ops'],
    responsibilityMoves: moves as ProposeArchitectureRevisionInputV1['responsibilityMoves'],
    reason,
    commandId,
  };
  let planned;
  try {
    planned = await planCatalogRevision(deps, platformCheckContext(ctx, TRIAL_ACTOR), input);
  } catch (error) {
    return rejected('unavailable', `the catalog revision trial failed: ${messageOf(error)}`);
  }
  if (planned.status === 'ready') return null;
  return planned.status === 'rejected' ? planned
    : rejected('unavailable', 'the catalog revision trial is not ready');
}

// --------------------------------------------------------------------------
// The proposal write
// --------------------------------------------------------------------------

async function proposalWriteKeys(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: ProposeArchitectureRevisionInputV1 & { commandId: string }): Promise<{
  identityKey: string; fingerprint: string;
}> {
  return commandKeys({
    operation: 'architecture-proposal-propose',
    scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
    principal: principalIdentity(ctx.principal),
    commandId: input.commandId,
    fingerprintInput: {
      baseCatalogPin: input.baseCatalogPin, ops: input.ops,
      responsibilityMoves: input.responsibilityMoves, reason: input.reason,
      operationRef: input.operationRef ?? null,
    } as unknown as JsonValue,
  });
}

/**
 * The original result is the one the command's own receipt names: a `pending_batch`
 * write carries `batchRef: null`, an immediate freeze carries the batch. The
 * proposal's later `batchRef` is not the replay's source.
 */
async function replayPropose(deps: ProposalServiceDeps, receipt: CommittedReceipt): Promise<ProposalResult> {
  let located;
  try {
    located = await deps.records.eventAt(receipt.cursor);
  } catch (error) {
    return rejected('unavailable', `the proposal receipt event could not be read: ${messageOf(error)}`);
  }
  if (located.status !== 'ready' || located.value.cursor !== receipt.cursor) {
    return rejected('unavailable', 'the proposal receipt event is not readable at its cursor');
  }
  const event = located.value.event;
  if (!receipt.eventIds.includes(event.eventId)) {
    return rejected('unavailable', 'the proposal receipt does not name its last event');
  }
  if (event.eventType !== ARCHITECTURE_PROPOSAL_CHANGED_EVENT) {
    return rejected('unavailable', 'the proposal receipt names no proposal event');
  }
  const decoded = decodeArchitectureProposalChangedEvent(event);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the proposal event is damaged: ${decoded.reason}`);
  }
  if (decoded.value.batchRef === null) return { status: 'pending_batch', proposalRef: decoded.value.proposalRef };
  // 121-109: a batch the structural auto-approval applied answers `applied` again, with the same pin.
  const auto = await priorApproval(deps, autoApplyKeys(decoded.value.batchRef));
  if (auto?.status === 'applied') {
    return { status: 'applied', proposalRef: decoded.value.proposalRef, catalogPin: catalogPinOf(auto.revision) };
  }
  if (auto?.status === 'rejected' && 'code' in auto) return auto;
  return { status: 'needs_decision', proposalRef: decoded.value.proposalRef,
    cardKey: decisionSourceKey({ kind: 'structural_proposal', batch: decoded.value.batchRef }) };
}

/**
 * One commit writes the proposal, and — unless the exploration window is open — its
 * single-member batch. The batch's trial already ran, so no second trial can see a
 * moved catalog between the two records.
 */
async function writeProposal(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: ProposeArchitectureRevisionInputV1 & { commandId: string },
  proposer: { sessionRef: SessionRef; operationRef: OperationRef | null; queryRunRef: QueryRunRef | null },
  keys: { identityKey: string; fingerprint: string },
  write: Clock, immediate: boolean,
  guard: { operationRef: OperationRef; revision: number } | null, autoApply: boolean): Promise<ProposalResult> {
  const proposalId = sha256Hex(canonicalJson({ projectId: ctx.projectId, commandId: input.commandId } as unknown as JsonValue));
  const ref: ArchitectureProposalRef = {
    aggregateType: 'ArchitectureProposal', projectId: ctx.projectId, proposalId,
  };
  const created = newArchitectureProposalRecord({
    ref,
    baseCatalogPin: structuredClone(input.baseCatalogPin),
    ops: structuredClone(input.ops),
    responsibilityMoves: structuredClone(input.responsibilityMoves),
    reason: input.reason,
    proposer: structuredClone(proposer.sessionRef),
    // M6: both source fields come from the platform's trusted proposer facts, never from the model's arguments.
    operationRef: proposer.operationRef === null ? null : structuredClone(proposer.operationRef),
    queryRunRef: proposer.queryRunRef === null ? null : structuredClone(proposer.queryRunRef),
  });
  const actor = workActorOf(ctx, proposer.sessionRef) ?? hostActorOf(ctx) ?? TRIAL_ACTOR;
  const records: EncodedRecord[] = [];
  const guards: RecordGuard[] = [];
  let record = created;
  let batch: ArchitectureProposalBatchV1 | null = null;
  if (immediate) {
    batch = batchOf(ctx.projectId, [created], input.baseCatalogPin);
    const entered = transitionArchitectureProposal(created, { kind: 'enter_batch', batchRef: batch.ref });
    if (!entered.ok) return rejected(entered.code, entered.detail);
    record = entered.next;
    records.push(encodeArchitectureProposalBatchRecord({ ...batch, revision: 1 }));
    guards.push({ refKey: canonicalKey(batch.ref), expectedRevision: null });
  }
  records.push(encodeArchitectureProposalRecord(record));
  guards.push({ refKey: canonicalKey(ref), expectedRevision: null });
  // A proposal that read the window open guards the exploration operation revision it read; a lifecycle pass that
  // moves that record (freeze save or completion) makes this commit conflict, and the caller re-reads the window.
  if (guard !== null) {
    guards.push({ refKey: canonicalKey(guard.operationRef as unknown as JsonValue),
      expectedRevision: guard.revision });
  }
  const event = encodeArchitectureProposalChangedEvent({
    eventId: write.eventId, eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT, schemaVersion: 1,
    occurredAt: write.now, projectId: ctx.projectId, proposalRef: ref, revision: record.revision,
    state: record.state, batchRef: record.batchRef, actor,
  });
  let receipt;
  try {
    receipt = await deps.records.commit({
      identityKey: keys.identityKey, fingerprint: keys.fingerprint,
      guards, records, claims: [], indexGuards: [], indexChanges: [], events: [event],
    });
  } catch (error) {
    return rejected('unavailable', `the proposal write outcome is unknown: ${messageOf(error)}`);
  }
  if (receipt.status !== 'committed') {
    const looked = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (looked.status === 'found') return replayPropose(deps, looked.receipt);
    if (looked.status === 'conflict') return rejected('idempotency_conflict', looked.reason);
    return rejectionOf(receipt);
  }
  // A concurrent commit of the same command won the identity: its event is the original result.
  if (receipt.replayed) return replayPropose(deps, receipt);
  if (batch === null) return { status: 'pending_batch', proposalRef: ref };
  // 121-109: the batch this commit froze is applied in the same call when the switch read before it was on.
  const revision = autoApply ? await autoApplyBatch(deps, ctx, batch, 0) : null;
  if (revision !== null && 'code' in revision) return revision;
  if (revision !== null) return { status: 'applied', proposalRef: ref, catalogPin: catalogPinOf(revision) };
  return { status: 'needs_decision', proposalRef: ref,
    cardKey: decisionSourceKey({ kind: 'structural_proposal', batch: batch.ref }) };
}

// --------------------------------------------------------------------------
// Freeze
// --------------------------------------------------------------------------

type FreezePlan = {
  batch: ArchitectureProposalBatchV1;
  members: ArchitectureProposalRecordV1[];
  existing: boolean;
};

async function freezePlan(deps: ProposalServiceDeps, ctx: CoreCallContext,
  pin: ArchitectureCatalogPinV1, proposals: readonly ArchitectureProposalRecordV1[]):
Promise<ReadResult<FreezePlan[]>> {
  const sorted = [...proposals].sort((left, right) => left.ref.proposalId < right.ref.proposalId ? -1
    : left.ref.proposalId > right.ref.proposalId ? 1 : 0);
  const compatible: ArchitectureProposalRecordV1[][] = [];
  let current: ArchitectureProposalRecordV1[] = [];
  let accumulatedOps: ProposeArchitectureRevisionInputV1['ops'] = [];
  let accumulatedMoves: ProposeArchitectureRevisionInputV1['responsibilityMoves'] = [];
  for (const proposal of sorted) {
    const nextOps = [...accumulatedOps, ...proposal.ops];
    const nextMoves = [...accumulatedMoves, ...proposal.responsibilityMoves];
    const reason = proposalBatchReason([...current, proposal]);
    const trial = await trialCatalogRevision(deps, ctx, pin, nextOps, nextMoves, reason,
      `freeze-trial:${proposal.ref.proposalId}`);
    if (trial === null) {
      current.push(proposal);
      accumulatedOps = nextOps;
      accumulatedMoves = nextMoves;
      continue;
    }
    // Only a content conflict closes the current batch; a read failure is returned as it is.
    if (trial.code !== 'invalid') return trial;
    if (current.length > 0) {
      compatible.push(current);
      current = [];
      accumulatedOps = [];
      accumulatedMoves = [];
    }
    const alone = await trialCatalogRevision(deps, ctx, pin, proposal.ops, proposal.responsibilityMoves,
      proposal.reason, `freeze-trial:${proposal.ref.proposalId}`);
    if (alone !== null) return alone.status === 'rejected' ? alone : rejected('unavailable', 'the proposal trial is not ready');
    current.push(proposal);
    accumulatedOps = [...proposal.ops];
    accumulatedMoves = [...proposal.responsibilityMoves];
  }
  if (current.length > 0) compatible.push(current);

  const plans: FreezePlan[] = [];
  for (const members of compatible) {
    const batch = batchOf(pin.catalogRef.projectId, members, pin);
    const existing = await readBatch(deps, batch.ref);
    if (existing.status === 'rejected') return existing;
    if (existing.status === 'not_found') {
      plans.push({ batch, members, existing: false });
      continue;
    }
    if (existing.status !== 'ready') return rejected('unavailable', 'the stored proposal batch is not readable');
    if (canonicalJson(existing.value.members as unknown as JsonValue)
      !== canonicalJson(batch.members as unknown as JsonValue)
      || existing.value.digest !== batch.digest) {
      return rejected('unavailable', 'the stored proposal batch differs from the content its batch id names');
    }
    plans.push({ batch: existing.value, members, existing: true });
  }
  return { status: 'ready', value: plans };
}

/** The one pin equality of a freeze: the catalog ref and the baseline. */
function sameCatalogPin(left: ArchitectureCatalogPinV1, right: ArchitectureCatalogPinV1): boolean {
  return canonicalJson(left.catalogRef as unknown as JsonValue) === canonicalJson(right.catalogRef as unknown as JsonValue)
    && canonicalJson(left.baseline as unknown as JsonValue) === canonicalJson(right.baseline as unknown as JsonValue);
}

/** One project's frozen batches in batch-id order; the `structural_proposal` card source reads the same list. */
export async function readProjectBatches(records: Pick<RecordLookupPort, 'lookup'>, projectId: string):
Promise<ReadResult<ArchitectureProposalBatchV1[]>> {
  let batch;
  try {
    batch = await lookupAll(records, S8C_PROPOSAL_BATCH_BY_PROJECT_LOOKUP, [projectId]);
  } catch (error) {
    return storeFailureToRejection(error);
  }
  const batches: ArchitectureProposalBatchV1[] = [];
  for (const encoded of batch.items) {
    const decoded = decodeArchitectureProposalBatchRecord(encoded);
    if (decoded.status !== 'decoded') {
      return { status: 'rejected', code: 'unavailable', reason: `a proposal batch is damaged: ${decoded.reason}` };
    }
    const { revision: _revision, ...value } = decoded.value;
    batches.push(value);
  }
  return { status: 'ready', value: batches };
}

async function freezeProposals(deps: ProposalServiceDeps, ctx: CoreCallContext,
  pin: ArchitectureCatalogPinV1, refs: readonly ArchitectureProposalRef[]): Promise<ReadResult<ArchitectureProposalBatchV1[]>> {
  const read = await readProposals(deps, refs);
  if (read.status !== 'ready') return read;
  const samePin = (record: ArchitectureProposalRecordV1): boolean => sameCatalogPin(record.baseCatalogPin, pin);
  const existingRefs: ArchitectureProposalBatchRef[] = [];
  const seenBatches = new Set<string>();
  for (const record of read.value) {
    if (record.batchRef === null || !samePin(record)) continue;
    const key = canonicalKey(record.batchRef);
    if (seenBatches.has(key)) continue;
    seenBatches.add(key);
    existingRefs.push(record.batchRef);
  }
  const existingBatches: ArchitectureProposalBatchV1[] = [];
  for (const ref of existingRefs) {
    const batch = await readBatch(deps, ref);
    if (batch.status === 'rejected') return batch;
    if (batch.status !== 'ready') return rejected('unavailable', 'a frozen proposal batch is not readable');
    existingBatches.push(batch.value);
  }
  const pending = read.value.filter(record => record.state === 'pending' && record.batchRef === null && samePin(record));
  if (pending.length === 0) return { status: 'ready', value: existingBatches };
  const planned = await freezePlan(deps, ctx, pin, pending);
  if (planned.status === 'rejected' && planned.code === 'source_stale') {
    return await closeStalePending(deps, ctx, pin, pending) ?? { status: 'ready', value: existingBatches };
  }
  if (planned.status !== 'ready') return planned;
  const all = new Map<string, ArchitectureProposalBatchV1>();
  for (const batch of existingBatches) all.set(batch.ref.batchId, batch);
  for (const plan of planned.value) all.set(plan.batch.ref.batchId, plan.batch);
  const fresh = planned.value.filter(plan => !plan.existing);
  if (fresh.length === 0) return { status: 'ready', value: [...all.values()] };

  // 121-109 / 62-6: the switch is read once, before the freeze; only the batches this commit freezes are tried.
  const autoApply = deps.structuralApproval?.(ctx.projectId).proposals === 'auto';
  const clock: Clock = { now: deps.now(), eventId: deps.eventId() };
  const actor = hostActorOf(ctx) ?? TRIAL_ACTOR;
  const guards: RecordGuard[] = [];
  const records: EncodedRecord[] = [];
  const events = [];
  for (const plan of fresh) {
    guards.push({ refKey: canonicalKey(plan.batch.ref), expectedRevision: null });
    records.push(encodeArchitectureProposalBatchRecord({ ...plan.batch, revision: 1 }));
    for (const member of plan.members) {
      const entered = transitionArchitectureProposal(member, { kind: 'enter_batch', batchRef: plan.batch.ref });
      if (!entered.ok) return rejected(entered.code, entered.detail);
      guards.push({ refKey: canonicalKey(member.ref), expectedRevision: member.revision });
      records.push(encodeArchitectureProposalRecord(entered.next));
      events.push(encodeArchitectureProposalChangedEvent({
        eventId: deps.eventId(), eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT, schemaVersion: 1,
        occurredAt: clock.now, projectId: ctx.projectId, proposalRef: member.ref,
        revision: entered.next.revision, state: entered.next.state,
        batchRef: plan.batch.ref, actor,
      }));
    }
  }
  const merged = mergeGuards(guards);
  if (!merged.ok) return merged.rejection;
  const keys = commandKeys({
    operation: 'architecture-proposal-freeze',
    scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
    principal: principalIdentity(ctx.principal),
    commandId: canonicalJson(fresh.map(plan => plan.batch.ref.batchId).sort() as unknown as JsonValue),
    fingerprintInput: { pin, proposals: pending.map(record => record.ref).sort((left, right) =>
      left.proposalId < right.proposalId ? -1 : left.proposalId > right.proposalId ? 1 : 0) } as unknown as JsonValue,
  });
  let committed;
  try {
    committed = await deps.records.commit({
      identityKey: keys.identityKey, fingerprint: keys.fingerprint,
      guards: merged.guards, records, claims: [], indexGuards: [], indexChanges: [], events,
    });
  } catch (error) {
    const again = await freezePlan(deps, ctx, pin, pending);
    if (again.status === 'ready' && again.value.every(plan => plan.existing)) {
      return { status: 'ready', value: again.value.map(plan => plan.batch) };
    }
    return rejected('unavailable', `the batch freeze outcome is unknown: ${messageOf(error)}`);
  }
  if (committed.status !== 'committed') {
    const again = await freezePlan(deps, ctx, pin, pending);
    if (again.status === 'ready' && again.value.every(plan => plan.existing)) {
      return { status: 'ready', value: again.value.map(plan => plan.batch) };
    }
    return rejectionOf(committed);
  }
  if (autoApply && !committed.replayed) {
    // 4-20: in batch-id order, and one at most: once one is applied the catalog moved, so the others stay cards.
    const order = fresh.map(plan => plan.batch)
      .sort((left, right) => left.ref.batchId < right.ref.batchId ? -1 : left.ref.batchId > right.ref.batchId ? 1 : 0);
    for (const batch of order) {
      const applied = await autoApplyBatch(deps, ctx, batch, fresh.length - 1);
      if (applied !== null && 'code' in applied) return applied;
      if (applied !== null) break;
    }
  }
  return { status: 'ready', value: [...all.values()] };
}

/**
 * The pin moved (a batch on it was applied: under the structural auto-approval, by the same freeze that froze the
 * first batch), so these pending proposals can never freeze or apply on it. They close as `stale` in one commit rather
 * than failing every later freeze, which would hold the cold start, the join or the follow-up at their freeze forever
 * (coordination: a proposal is a change against one catalog pin; the adviser proposes again on the new one).
 */
async function closeStalePending(deps: ProposalServiceDeps, ctx: CoreCallContext, pin: ArchitectureCatalogPinV1,
  pending: readonly ArchitectureProposalRecordV1[]): Promise<CoreRejection | null> {
  const actor = hostActorOf(ctx) ?? TRIAL_ACTOR;
  const guards: RecordGuard[] = [];
  const records: EncodedRecord[] = [];
  const events = [];
  for (const member of pending) {
    const closed = transitionArchitectureProposal(member, { kind: 'stale' });
    if (!closed.ok) return rejected(closed.code, closed.detail);
    guards.push({ refKey: canonicalKey(member.ref), expectedRevision: member.revision });
    records.push(encodeArchitectureProposalRecord(closed.next));
    events.push(encodeArchitectureProposalChangedEvent({
      eventId: deps.eventId(), eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT, schemaVersion: 1,
      occurredAt: deps.now(), projectId: ctx.projectId, proposalRef: member.ref,
      revision: closed.next.revision, state: closed.next.state, batchRef: null, actor,
    }));
  }
  const keys = commandKeys({
    operation: 'architecture-proposal-close-stale',
    scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
    principal: principalIdentity(ctx.principal),
    commandId: canonicalJson(pending.map(record => record.ref.proposalId).sort() as unknown as JsonValue),
    fingerprintInput: { pin } as unknown as JsonValue,
  });
  try {
    const committed = await deps.records.commit({ identityKey: keys.identityKey, fingerprint: keys.fingerprint,
      guards, records, claims: [], indexGuards: [], indexChanges: [], events });
    return committed.status === 'committed' ? null : rejectionOf(committed);
  } catch (error) {
    return rejected('unavailable', `the stale proposal close outcome is unknown: ${messageOf(error)}`);
  }
}

/** The one proposer gate: a Work Run, or a trusted role_exploration QueryRun. */
async function proposerOf(deps: ProposalServiceDeps, ctx: CoreCallContext):
Promise<ReadResult<{ sessionRef: SessionRef; role: RoleConfigurationRef;
  operationRef: OperationRef | null; queryRunRef: QueryRunRef | null; segment: RoleExplorationSegmentV1 | null }>
  | CoreRejection> {
  if (ctx.principal.kind === 'work_run') {
    const facts = await deps.runFacts(ctx, ctx.principal.runRef);
    if (facts.status !== 'ready') return facts;
    return { status: 'ready', value: { ...facts.value, operationRef: null, queryRunRef: null, segment: null } };
  }
  if (ctx.principal.kind === 'query_run') {
    const facts = await deps.queryRunFacts(ctx, ctx.principal.queryRunRef);
    if (facts.status !== 'ready') return facts;
    // The resolver's ready value is always a stored `role_exploration` round; it already checked the real Job.
    return { status: 'ready', value: { sessionRef: { ...facts.value.sessionRef }, role: structuredClone(facts.value.role),
      operationRef: facts.value.operationRef === null ? null : structuredClone(facts.value.operationRef),
      queryRunRef: structuredClone(facts.value.queryRunRef), segment: facts.value.segment } };
  }
  return rejected('forbidden', 'a structural proposal is written by an adviser Work Run or a role_exploration QueryRun');
}

// --------------------------------------------------------------------------
// The four public entries (bare form; the factory binds deps)
// --------------------------------------------------------------------------

/** Write-side path qualification for every op that declares module/interface paths. */
export function qualifyOps(ops: readonly CatalogRepairOpV1[], requestWorkspaceId: string,
  mainWorkspaceId: string): CatalogRepairOpV1[] {
  return reframeRepairOps(ops, id => id, path => qualifyProjectPath(requestWorkspaceId, path, mainWorkspaceId));
}

export async function proposeArchitectureRevision(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: ProposeArchitectureRevisionInputV1 & { commandId: string }): Promise<ProposalResult> {
  if (!isRecord(input)) return rejected('invalid', 'a proposal requires an input object');
  if (!nonEmpty(input.commandId)) return rejected('invalid', 'a proposal requires a command id');
  const pinProblem = catalogRevisionPinProblem(input.baseCatalogPin);
  if (pinProblem !== null) return { status: 'invalid', reason: pinProblem };
  if (input.baseCatalogPin.catalogRef.projectId !== ctx.projectId) {
    return rejected('forbidden', 'the proposal base pin is outside the call context project');
  }
  if (!nonEmpty(input.reason)) return { status: 'invalid', reason: 'a proposal requires a non-empty reason' };
  const operationProblem = operationRefProblem(input.operationRef);
  if (operationProblem !== null) return { status: 'invalid', reason: operationProblem };
  const parsed = parseRepairOps(input.ops);
  if (!parsed.ok) return { status: 'invalid', reason: parsed.problem.reason };
  const movesProblem = catalogRevisionMovesProblem(input.responsibilityMoves, ctx.projectId, null);
  if (movesProblem !== null) return { status: 'invalid', reason: movesProblem };
  if (ctx.principal.kind !== 'work_run' && ctx.principal.kind !== 'query_run') {
    return rejected('forbidden', 'a structural proposal is written by an adviser Work Run or a role_exploration QueryRun');
  }
  // The proposal owner may live in the main workspace while an exploration
  // Query reads a second one; the module paths belong to the CALLER's workspace.
  const requestWorkspaceId = ctx.workspaceId ?? '';
  let mainWorkspaceId = requestWorkspaceId;
  if (deps.mainWorkspaceOf !== undefined) {
    const main = await deps.mainWorkspaceOf(ctx.projectId);
    // A failed main read refuses the proposal as `unavailable`; a ready `null`
    // (no workspace yet) keeps the caller's workspace as main.
    if (main.status !== 'ready') {
      return rejected('unavailable', main.status === 'rejected' ? main.reason : 'the main workspace cannot be read');
    }
    mainWorkspaceId = main.value ?? requestWorkspaceId;
  }
  // KLS-2b: the ops' module ids are in the caller's frame too; the proposal stores the project view.
  let qualifiedOps: CatalogRepairOpV1[];
  try {
    qualifiedOps = opsInProjectView(qualifyOps(parsed.ops, requestWorkspaceId, mainWorkspaceId), requestWorkspaceId,
      mainWorkspaceId);
  } catch (error) {
    return { status: 'invalid', reason: `a module id cannot be read in the caller's frame: ${messageOf(error)}` };
  }
  const qualifiedInput = { ...input, ops: qualifiedOps };
  const keys = await proposalWriteKeys(deps, ctx, input);
  const prior = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
  if (prior.status === 'conflict') return rejected('idempotency_conflict', prior.reason);
  if (prior.status !== 'missing' && prior.status !== 'found') return rejected('unavailable', prior.reason);
  if (prior.status === 'found') return replayPropose(deps, prior.receipt);
  const facts = await proposerOf(deps, ctx);
  if (facts.status !== 'ready') return readFailure(facts);
  if (deps.duty === undefined) return rejected('unavailable', 'the proposal owner has no Session duty reader');
  const duty = await deps.duty(facts.value.role, platformCheckContext(ctx, TRIAL_ACTOR));
  if (duty.status !== 'ready') return readFailure(duty);
  if (duty.value !== 'adviser') {
    return rejected('forbidden', 'a structural proposal is written by an adviser');
  }
  // 121-109 / 62-6: the switch is read once, before the window read and the freeze. A coarse split is the initial
  // architecture and still asks the person (4-18, PRODUCT §7).
  const autoApply = deps.structuralApproval?.(ctx.projectId).proposals === 'auto'
    && facts.value.segment !== 'coarse_split';

  const trial = await trialCatalogRevision(deps, ctx, qualifiedInput.baseCatalogPin, qualifiedInput.ops,
    qualifiedInput.responsibilityMoves, qualifiedInput.reason, `${input.commandId}:trial`);
  if (trial !== null) return trial.code === 'invalid' ? { status: 'invalid', reason: trial.reason } : trial;

  const readBatchWindow = async (): Promise<ProposalBatchWindowReadV1 | CoreRejection> => {
    if (deps.proposalBatchWindow === undefined) return { open: false, operationRef: null, revision: null };
    const read = await deps.proposalBatchWindow.isOpen(ctx,
      { projectRef: { projectId: ctx.projectId }, baseCatalogPin: input.baseCatalogPin,
        operationRef: facts.value.operationRef });
    if (read.status === 'ready') return read.value;
    if (read.status === 'rejected') return read;
    return rejected('unavailable', `proposal batch window is not readable (${read.status})`);
  };
  const writeWith = (verdict: ProposalBatchWindowReadV1) => {
    // A window without its own record/revision (never a production verdict) carries no guard, like the closed one.
    const guard = verdict.open && verdict.operationRef !== null && verdict.revision !== null
      ? { operationRef: verdict.operationRef, revision: verdict.revision } : null;
    return writeProposal(deps, ctx, qualifiedInput, facts.value,
      keys, { now: deps.now(), eventId: deps.eventId() }, !verdict.open, guard, autoApply);
  };
  let window = await readBatchWindow();
  if ('status' in window) return window;
  let result = await writeWith(window);
  // The exploration record moved between the window read and this commit: re-read; the window is closed now, so
  // the proposal freezes as its own single-member batch.
  if (window.open && result.status === 'rejected' && result.code === 'revision_conflict') {
    const again = await readBatchWindow();
    if ('status' in again) return again;
    window = again;
    result = await writeWith(window);
  }
  return result;
}

export async function freezeArchitectureProposalBatch(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: { baseCatalogPin: ArchitectureCatalogPinV1; proposalRefs: ArchitectureProposalRef[] }):
Promise<ReadResult<ArchitectureProposalBatchV1[]>> {
  if (!isRecord(input)) return rejected('invalid', 'a batch freeze requires an input object');
  const pinProblem = catalogRevisionPinProblem(input.baseCatalogPin);
  if (pinProblem !== null) return rejected('invalid', pinProblem);
  if (input.baseCatalogPin.catalogRef.projectId !== ctx.projectId) {
    return rejected('forbidden', 'the freeze base pin is outside the call context project');
  }
  if (!Array.isArray(input.proposalRefs)) return rejected('invalid', 'a batch freeze requires proposal refs');
  for (const ref of input.proposalRefs) {
    const problem = proposalRefProblem(ref);
    if (problem !== null) return rejected('invalid', problem);
    if (ref.projectId !== ctx.projectId) return rejected('forbidden', 'a proposal ref is outside the call context project');
  }
  return freezeProposals(deps, ctx, input.baseCatalogPin, input.proposalRefs);
}

async function replayApproval(deps: ProposalServiceDeps, keys: { identityKey: string; fingerprint: string },
  receipt: CommittedReceipt): Promise<ApplyBatchResult<ArchitectureRevision>> {
  let located;
  try {
    located = await deps.records.eventAt(receipt.cursor);
  } catch (error) {
    return rejected('unavailable', `the approval receipt event could not be read: ${messageOf(error)}`);
  }
  if (located.status !== 'ready' || located.value.cursor !== receipt.cursor) {
    return rejected('unavailable', 'the approval receipt event is not readable at its cursor');
  }
  const event = located.value.event;
  if (!receipt.eventIds.includes(event.eventId)) {
    return rejected('unavailable', 'the approval receipt does not name its last event');
  }
  const answerReceipt = receiptOf(keys, receipt.cursor);
  if (event.eventType === ARCHITECTURE_PROPOSAL_CHANGED_EVENT) {
    const decoded = decodeArchitectureProposalChangedEvent(event);
    if (decoded.status !== 'decoded') return rejected('unavailable', `the approval event is damaged: ${decoded.reason}`);
    if (decoded.value.state === 'rejected') return { status: 'rejected', receipt: answerReceipt };
    if (decoded.value.state === 'stale') return { status: 'source_stale', receipt: answerReceipt };
    return rejected('unavailable', 'the approval receipt names an unapplied proposal state');
  }
  if (event.eventType !== 'ArchitectureCatalogRevised') {
    return rejected('unavailable', 'the approval receipt names no proposal or catalog event');
  }
  const decoded = decodeArchitectureCatalogRevisedEvent(event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the approval catalog event is damaged: ${decoded.reason}`);
  return { status: 'applied', receipt: answerReceipt, revision: decoded.value.revision };
}

/** The batch's card as a decision source: the project's `structural_proposal` card for this batch. */
function batchDecisionSource(batchRef: ArchitectureProposalBatchRef): DecisionSourceV1 {
  return {
    kind: 'structural_proposal',
    key: decisionSourceKey({ kind: 'structural_proposal', batch: batchRef }),
    subject: { kind: 'project', projectRef: { projectId: batchRef.projectId } },
    pins: [],
  };
}

async function readApprovalAnswer(deps: ProposalServiceDeps, ctx: CoreCallContext,
  batchRef: ArchitectureProposalBatchRef, answerMessageRef: SessionMessageRef):
Promise<ReadResult<{ message: SessionMessage; body: UserDecisionBodyV1 }>> {
  const read = await deps.decisionMessages.readDecisionAnswer(ctx, { source: batchDecisionSource(batchRef) });
  if (read.status !== 'ready') return read;
  if (read.value.message === null || read.value.body === null) {
    return rejected('invalid', 'the structural proposal batch has no saved answer');
  }
  if (canonicalKey(read.value.message.ref) !== canonicalKey(answerMessageRef)) {
    return rejected('invalid', 'the saved answer is another message');
  }
  return { status: 'ready', value: { message: read.value.message, body: read.value.body } };
}

function selectionOption(body: UserDecisionBodyV1): 'approve' | 'reject' | null {
  if (body.selection.kind !== 'option') return null;
  return body.selection.optionId === 'approve' || body.selection.optionId === 'reject'
    ? body.selection.optionId : null;
}

/**
 * The original result of this application command when it already committed (a concurrent copy may have),
 * the failed lookup's rejection, or null when it has not committed.
 */
async function priorApproval(deps: ProposalServiceDeps,
  keys: { identityKey: string; fingerprint: string }): Promise<ApplyBatchResult<ArchitectureRevision> | null> {
  const prior = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
  if (prior.status === 'conflict') return rejected('idempotency_conflict', prior.reason);
  if (prior.status === 'found') return replayApproval(deps, keys, prior.receipt);
  if (prior.status !== 'missing') return rejected('unavailable', prior.reason);
  return null;
}

/**
 * Closes the members `rejected` or `stale` under the application command's own identity. A commit that replays
 * (the same command already committed) answers that command's original result (quick check 5), never this close.
 */
async function writeClosedMembers(deps: ProposalServiceDeps, ctx: CoreCallContext,
  keys: { identityKey: string; fingerprint: string }, batch: ArchitectureProposalBatchV1,
  members: readonly ArchitectureProposalRecordV1[], message: SessionMessage,
  state: 'rejected' | 'stale'): Promise<ApplyBatchResult<ArchitectureRevision>> {
  const actor = hostActorOf(ctx);
  if (actor === null) return rejected('forbidden', 'a proposal answer is applied by the Host');
  const proof = changeProof(message, proposalPins(members));
  const records: EncodedRecord[] = [];
  const guards: RecordGuard[] = [];
  const events = [];
  for (const [index, member] of members.entries()) {
    const next = transitionArchitectureProposal(member, { kind: state === 'rejected' ? 'reject' : 'stale' });
    if (!next.ok) return rejected(next.code, next.detail);
    guards.push({ refKey: canonicalKey(member.ref), expectedRevision: member.revision });
    records.push(encodeArchitectureProposalRecord(next.next));
    events.push(encodeArchitectureProposalChangedEvent({
      eventId: deps.eventId(), eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT, schemaVersion: 1,
      occurredAt: deps.now(), projectId: ctx.projectId, proposalRef: member.ref,
      revision: next.next.revision, state: next.next.state, batchRef: batch.ref, actor,
      ...(index === members.length - 1 ? { proof } : {}),
    }));
  }
  if (events.length === 0) return rejected('invalid', 'the batch has no proposal member to close');
  let committed;
  try {
    committed = await deps.records.commit({
      identityKey: keys.identityKey, fingerprint: keys.fingerprint,
      guards, records, claims: [], indexGuards: [], indexChanges: [], events,
    });
  } catch (error) {
    return rejected('unavailable', `the proposal close outcome is unknown: ${messageOf(error)}`);
  }
  if (committed.status !== 'committed') {
    const prior = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (prior.status === 'found') return replayApproval(deps, keys, prior.receipt);
    return rejectionOf(committed);
  }
  if (committed.replayed) return replayApproval(deps, keys, committed);
  const receipt = receiptOf(keys, committed.cursor);
  return state === 'rejected' ? { status: 'rejected', receipt } : { status: 'source_stale', receipt };
}

export async function applyArchitectureProposalBatch(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: { batchRef: ArchitectureProposalBatchRef; answerMessageRef: SessionMessageRef }):
Promise<ApplyBatchResult<ArchitectureRevision>> {
  if (!isRecord(input)) return rejected('invalid', 'a batch application requires an input object');
  const batchProblem = batchRefProblem(input.batchRef);
  if (batchProblem !== null) return rejected('invalid', batchProblem);
  const messageProblem = messageRefProblem(input.answerMessageRef);
  if (messageProblem !== null) return rejected('invalid', messageProblem);
  if (input.batchRef.projectId !== ctx.projectId) {
    return rejected('forbidden', 'the batch is outside the call context project');
  }
  const keys = commandKeys({
    operation: 'architecture-proposal-apply',
    scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
    principal: principalIdentity(ctx.principal),
    commandId: `${input.batchRef.batchId}:${input.answerMessageRef.messageId}`,
    fingerprintInput: { batchRef: input.batchRef, answerMessageRef: input.answerMessageRef } as unknown as JsonValue,
  });
  const prior = await priorApproval(deps, keys);
  if (prior !== null) return prior;

  const batch = await readBatch(deps, input.batchRef);
  if (batch.status === 'rejected') return batch;
  if (batch.status !== 'ready') return rejected('not_found', 'the proposal batch does not exist');
  const members = await readBatchMembers(deps, batch.value);
  if (members.status === 'rejected') return members;
  if (members.status !== 'ready') return rejected('unavailable', 'the proposal batch members are not readable');
  if (members.value.some(member => member.state !== 'pending')) {
    // The same command may have committed after the receipt lookup above (a copy ahead of this one in the write
    // queue): its result comes first (quick check 5), not `invalid`.
    return await priorApproval(deps, keys) ?? rejected('invalid', 'the proposal batch is no longer pending');
  }
  const answer = await readApprovalAnswer(deps, ctx, batch.value.ref, input.answerMessageRef);
  if (answer.status === 'rejected') return answer;
  if (answer.status !== 'ready') return rejected('unavailable', 'the proposal answer is not readable');
  // R-16/R-17: “不对，重新提” creates the follow-up (or marks the coarse group) BEFORE the old members close; a
  // retry reads the existing follow-up/answer again instead of losing the request. The reason is the answer's `text`.
  if (answer.value.body.selection.kind === 'option' && answer.value.body.selection.optionId === 'repropose') {
    if (answer.value.body.text.trim() === '') {
      return rejected('invalid', 'a reason is required to ask for another proposal');
    }
    if (deps.repropose === undefined) {
      return rejected('unsupported', 'the platform has no exploration control for a re-proposal');
    }
    const begun = await deps.repropose(ctx, { batchRef: batch.value.ref, reason: answer.value.body.text });
    if (begun.status !== 'committed') return begun;
    return writeClosedMembers(deps, ctx, keys, batch.value, members.value, answer.value.message, 'rejected');
  }
  const option = selectionOption(answer.value.body);
  if (option === null) return rejected('invalid', 'a structural proposal answers approve or reject');

  if (option === 'reject') {
    return writeClosedMembers(deps, ctx, keys, batch.value, members.value, answer.value.message, 'rejected');
  }
  return applyWith(deps, ctx, keys, `${input.batchRef.batchId}:${input.answerMessageRef.messageId}`, batch.value,
    members.value, { kind: 'answer', message: answer.value.message });
}

/**
 * Who approves a batch: the person's saved answer (its message is the change proof), or the platform under the
 * project's structural auto-approval (121-109), which writes no answer and no proof. `out` tells the caller why the
 * platform held the batch back (`blocked`), or what it applied (`summary`, the notice's counts and modules).
 */
type ApprovalAuthority =
  | { kind: 'answer'; message: SessionMessage }
  | { kind: 'auto'; out: { blocked: AutoApprovalBlockV1 | null; summary: string | null } };

/**
 * The one approval write, for the person and the platform alike: inside the knowledge write `prepareApproval` plans
 * the batch on the current catalog and commits the revision with the members applied; then the files land. A copy of
 * the same command that committed first answers the command's original result.
 */
async function applyWith(deps: ProposalServiceDeps, ctx: CoreCallContext,
  keys: { identityKey: string; fingerprint: string }, commandId: string, batch: ArchitectureProposalBatchV1,
  members: readonly ArchitectureProposalRecordV1[], authority: ApprovalAuthority): Promise<ApprovalResult> {
  const thrown = { message: null as string | null };
  const applied = { revision: null as ArchitectureRevision | null };
  const outcome = await writeKnowledge(deps.knowledge, ctx, lines => prepareApproval(deps, ctx, keys, commandId, batch,
    members, authority, lines, thrown, applied));
  if (outcome.kind === 'exit') return outcome.value;
  if (outcome.kind === 'rejected') {
    if (thrown.message !== null) return rejected('unavailable', `the proposal application outcome is unknown: ${thrown.message}`);
    const again = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (again.status === 'found') return replayApproval(deps, keys, again.receipt);
    return rejectionOf(outcome.failure);
  }
  // Quick check 8: a commit the store replayed is the same command's original result (a concurrent copy may have
  // closed it stale); this copy's own plan was never committed and wrote no file.
  if (outcome.receipt.replayed) return replayApproval(deps, keys, outcome.receipt);
  if (outcome.files !== null && outcome.files.status !== 'ready') {
    return rejected('unavailable', knowledgeFilesNotWritten(outcome.files));
  }
  if (applied.revision === null) return rejected('unavailable', 'the applied catalog revision was not prepared');
  return { status: 'applied', receipt: receiptOf(keys, outcome.receipt.cursor), revision: applied.revision };
}

type ApprovalResult = ApplyBatchResult<ArchitectureRevision>;

/** The approval's current read, plan, records and file changes, prepared after the knowledge lines are taken. */
async function prepareApproval(deps: ProposalServiceDeps, ctx: CoreCallContext,
  keys: { identityKey: string; fingerprint: string }, commandId: string, batch: ArchitectureProposalBatchV1,
  members: readonly ArchitectureProposalRecordV1[], authority: ApprovalAuthority, lines: readonly LineKnowledge[],
  thrown: { message: string | null }, applied: { revision: ArchitectureRevision | null }):
  Promise<KnowledgePrepared<ApprovalResult>> {
  const exit = (value: ApprovalResult): KnowledgePrepared<ApprovalResult> => ({ kind: 'exit', value });
  // A moved catalog closes the person's batch stale; the platform's approval only steps back and the card stays.
  const closeStale = async (): Promise<KnowledgePrepared<ApprovalResult>> => authority.kind === 'answer'
    ? exit(await writeClosedMembers(deps, ctx, keys, batch, members, authority.message, 'stale'))
    : exit(rejected('source_stale', 'the catalog moved since the batch was frozen'));
  const window = await readCurrentCatalogWindow(deps.records, batch.ref.projectId, { lines: deps.knowledge, caller: ctx });
  if (window.status === 'rejected') return exit(window);
  if (window.status !== 'ready') return exit(rejected('unavailable', 'the current architecture catalog is not readable'));
  const sameBaseline = canonicalKey(batch.baseCatalogPin.baseline.ref)
      === canonicalKey(window.baseline.ref)
    && batch.baseCatalogPin.baseline.digest === window.baseline.contentDigest;
  if (!sameBaseline) return closeStale();

  const approvalRefused = async (planned: Exclude<ReadResult<never>, { status: 'ready' }>):
    Promise<KnowledgePrepared<ApprovalResult>> => {
    if (planned.status !== 'rejected') return exit(rejected('unavailable', 'the catalog revision plan is not ready'));
    if (planned.code === 'invalid') return exit({ status: 'invalid', reason: planned.reason });
    // The planner's re-read, or the pointer behind the files it read, moved after the first window read: the same
    // stale close as above, unless this same command committed meanwhile (quick check 5: its result comes first).
    if (planned.code === 'source_stale') {
      const prior = await priorApproval(deps, keys);
      return prior === null ? closeStale() : exit(prior);
    }
    return exit(planned);
  };
  const reason = proposalBatchReason(members);
  // Stack review 1: the files are read and their changes computed before the planner's ledger half reads the basis.
  const draft = await draftCatalogRevision(deps, ctx, {
    expected: batch.baseCatalogPin,
    ops: batch.ops,
    responsibilityMoves: batch.responsibilityMoves,
    reason,
    commandId,
  });
  if (draft.status !== 'ready') return approvalRefused(draft);
  const plans = await architectureWritePlansOf(lines, draft.value.catalog, knowledgeBaselineOf(draft.value.content));
  if (plans.status !== 'ready') return exit(rejectionOf(plans));
  if (authority.kind === 'auto') {
    // 121-106 item 5: the files are read here, before the planner's ledger half, like the plan's own reads.
    const block = await autoApprovalBlockOf(deps.records, ctx.projectId, plans.value);
    if (block.status !== 'ready') return exit(block);
    if (block.value !== null) {
      authority.out.blocked = block.value;
      return exit(rejected('invalid', 'the structural auto-approval held the batch back; the card stays'));
    }
    authority.out.summary = appliedChangesOf(plans.value, deps.knowledge.write.files);
  }
  const planned = await finishCatalogRevision(deps, ctx, draft.value);
  if (planned.status !== 'ready') return approvalRefused(planned);

  const actor = hostActorOf(ctx);
  if (actor === null) return exit(rejected('forbidden', 'a proposal answer is applied by the Host'));
  const changes: { before: VersionPin; after: VersionPin }[] = [
    { before: baselinePinOf(batch.baseCatalogPin, 1), after: baselinePinOf(catalogPinOf(planned.value.revision), 1) },
    { before: activePinOf(ctx.projectId, window.activeRevision),
      after: activePinOf(ctx.projectId, window.activeRevision + 1) },
    ...proposalPins(members),
  ];
  const proof = authority.kind === 'answer' ? changeProof(authority.message, changes) : null;

  const appliedMembers: ArchitectureProposalRecordV1[] = [];
  for (const member of members) {
    const next = transitionArchitectureProposal(member, { kind: 'apply' });
    if (!next.ok) return exit(rejected(next.code, next.detail));
    appliedMembers.push(next.next);
  }
  const records = [...planned.value.records, ...appliedMembers.map(encodeArchitectureProposalRecord)];
  const proposalEvents = appliedMembers.map(member => encodeArchitectureProposalChangedEvent({
    eventId: deps.eventId(), eventType: ARCHITECTURE_PROPOSAL_CHANGED_EVENT, schemaVersion: 1,
    occurredAt: deps.now(), projectId: ctx.projectId, proposalRef: member.ref,
    revision: member.revision, state: member.state, batchRef: batch.ref, actor,
  }));
  const fragment: CommitFragment = planned.value;
  const catalogEvents = fragment.events;
  const lastCatalog = catalogEvents[catalogEvents.length - 1];
  if (lastCatalog === undefined) return exit(rejected('unavailable', 'the catalog revision contribution has no event'));
  const decodedCatalog = decodeArchitectureCatalogRevisedEvent(lastCatalog);
  if (decodedCatalog.status !== 'decoded') {
    return exit(rejected('unavailable', `the catalog revision event is damaged: ${decodedCatalog.reason}`));
  }
  // The platform's approval has no answer to prove: its catalog event stays as the planner wrote it.
  const catalogEvent = proof === null ? lastCatalog : encodeArchitectureCatalogRevisedEvent({ ...decodedCatalog.value, proof });
  const events = [...catalogEvents.slice(0, -1), ...proposalEvents, catalogEvent];
  const memberGuards: RecordGuard[] = members.map(member => ({
    refKey: canonicalKey(member.ref), expectedRevision: member.revision,
  }));
  const merged = mergeGuards([...fragment.guards, ...memberGuards]);
  if (!merged.ok) return exit(merged.rejection);
  applied.revision = planned.value.revision;
  const prepared: PreparedCommit = {
    identityKey: keys.identityKey, fingerprint: keys.fingerprint,
    guards: merged.guards, records, claims: fragment.claims,
    indexGuards: [], indexChanges: [], events,
    ...(fragment.ledgerHorizon === undefined ? {} : { ledgerHorizon: fragment.ledgerHorizon }),
    ...(fragment.commitCursorBindings === undefined ? {} : { commitCursorBindings: fragment.commitCursorBindings }),
  };
  return { kind: 'ready', plans: plans.value, commit: knowledgeCommit(commit => deps.records.commit(commit), prepared, thrown) };
}

// --------------------------------------------------------------------------
// Structural auto-approval (121-106 item 5, 121-109, PRODUCT §7)
// --------------------------------------------------------------------------

/** Why the platform did not apply a structural change itself (the card stays). */
export type AutoApprovalBlockV1 =
  | { kind: 'not_platform_written'; paths: string[] }
  | { kind: 'new_conflict'; conflicts: KnowledgeConflictV1[] };

/** One line's files as read now, and the projection of the catalog the records last adopted (null when none). */
async function lineFileFacts(recorded: Extract<CurrentCatalogWindow, { status: 'ready' }> | null,
  plan: KnowledgeWritePlan): Promise<{ status: 'ready'; value: {
    files: readonly KnowledgeDiskFileV1[];
    projection: { architecture: Uint8Array; modules: readonly { moduleId: string; bytes: Uint8Array }[] } | null;
  } } | CoreRejection> {
  const disk = await plan.line.readKnowledgeFiles();
  if (disk.status !== 'ready') return storeFailureToRejection(disk);
  const current = disk.value.files.find(file => file.path === ARCHITECTURE_FILE_PATH)?.bytes ?? null;
  const projected = recorded === null ? null
    : architectureFilesOf(recorded.catalog.catalog, knowledgeBaselineOf(recorded.baseline.content), plan.line.scope, current);
  // A recorded catalog is written by the same function (lists B), so an invalid projection is a programming error.
  if (projected !== null && projected.status !== 'decoded') {
    return rejected('unavailable', `the recorded catalog cannot be written as knowledge files: ${projected.reason}`);
  }
  return { status: 'ready', value: { files: disk.value.files, projection: projected === null ? null : projected.value } };
}

/**
 * 121-106 item 5 / PRODUCT §7: whether the platform may apply these planned knowledge writes without the person. It
 * may not when a write would overwrite a file the platform did not write (ruling 4-2 A's one verdict: a hand edit,
 * committed or not, a merge) — an uncommitted edit overwritten is lost; nor when the module files after the write
 * hold a conflict they did not hold before, which would feed the knowledge-conflict round that proposed it. A
 * conflict that was there before the write is no reason. Structural proposals and structural repairs share it.
 */
export async function autoApprovalBlockOf(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string,
  plans: readonly KnowledgeWritePlan[]): Promise<{ status: 'ready'; value: AutoApprovalBlockV1 | null } | CoreRejection> {
  const recorded = await readRecordedCatalogWindow(records, projectId);
  if (recorded.status !== 'ready' && recorded.status !== 'not_found') return recorded;
  const paths: string[] = [];
  const conflicts: KnowledgeConflictV1[] = [];
  for (const plan of plans) {
    if (plan.changes.length === 0) continue;
    const facts = await lineFileFacts(recorded.status === 'ready' ? recorded : null, plan);
    if (facts.status !== 'ready') return facts;
    const byPath = new Map(facts.value.files.map(file => [file.path, file]));
    for (const change of plan.changes) {
      if (change.before !== null && platformFileSource(facts.value.projection,
        { path: change.path, bytes: change.before, committed: byPath.get(change.path)!.committed }) !== 'platform') {
        paths.push(change.path);
      }
    }
    const before = facts.value.files.filter(file => file.kind === 'module');
    const after = new Map(before.map(file => [file.path, file.bytes]));
    for (const change of plan.changes) {
      if (change.path === ARCHITECTURE_FILE_PATH) continue;
      if (change.after === null) after.delete(change.path); else after.set(change.path, change.after);
    }
    // A conflict is new when its (kind, moduleId) was not there before or it now involves a file it did not; the same
    // conflict with fewer files (a claimer removed) is the old one getting smaller.
    const held = new Map(knowledgeConflictsOf(before, plan.line.scope)
      .map(conflict => [`${conflict.kind}\u0000${conflict.moduleId}`, new Set(conflict.paths)]));
    conflicts.push(...knowledgeConflictsOf([...after].map(([path, bytes]) => ({ path, bytes })), plan.line.scope)
      .filter(conflict => {
        const was = held.get(`${conflict.kind}\u0000${conflict.moduleId}`);
        return was === undefined || conflict.paths.some(path => !was.has(path));
      }));
  }
  if (paths.length > 0) return { status: 'ready', value: { kind: 'not_platform_written', paths: paths.sort() } };
  return { status: 'ready', value: conflicts.length === 0 ? null : { kind: 'new_conflict', conflicts } };
}

/** The "没有自动采用" notice text (121-106 item 5); `what` names a structural proposal or a structural repair. */
export function autoApprovalDeclinedSummary(what: '结构提案' | '结构修补', block: AutoApprovalBlockV1): string {
  const why = block.kind === 'not_platform_written'
    ? `会盖掉不是平台写的文件 ${block.paths.join('、')}`
    : `写后会新增 ${String(block.conflicts.length)} 处冲突：${
      [...new Set(block.conflicts.flatMap(conflict => conflict.paths))].sort().join('、')}`;
  return truncateUtf8(`没有自动采用${what}：${why}；卡留着等你决定`, 512);
}

/** The applied notice's counts (created, changed, deleted knowledge files) and the modules they belong to. */
function appliedChangesOf(plans: readonly KnowledgeWritePlan[],
  files: ProposalServiceDeps['knowledge']['write']['files']): string {
  let created = 0;
  let changed = 0;
  let deleted = 0;
  const modules = new Set<string>();
  for (const plan of plans) {
    for (const change of plan.changes) {
      if (change.before === null) created += 1; else if (change.after === null) deleted += 1; else changed += 1;
      if (change.path === ARCHITECTURE_FILE_PATH) continue;
      const moduleId = files.writeLogFileOf(plan.line.scope, change.path, (change.after ?? change.before)!).moduleId;
      if (moduleId !== null) modules.add(moduleId);
    }
  }
  const named = [...modules].sort();
  return `新建 ${String(created)} 个、修改 ${String(changed)} 个、删除 ${String(deleted)} 个知识文件`
    + (named.length === 0 ? '' : `；模块 ${named.join('、')}`);
}

/** The platform's one approval command per batch, whoever froze it: a crash or a second call replays it. */
function autoApplyKeys(batchRef: ArchitectureProposalBatchRef): { identityKey: string; fingerprint: string } {
  return commandKeys({
    operation: 'architecture-proposal-auto-apply',
    scope: { projectId: batchRef.projectId, workspaceId: null },
    principal: principalIdentity({ kind: 'host', actor: STRUCTURAL_AUTO_APPROVAL_ACTOR }),
    commandId: batchRef.batchId,
    fingerprintInput: { batchRef } as unknown as JsonValue,
  });
}

/** A project notice of the structural auto-approval (an `automatic_adjustment` on the project). */
function autoApprovalNotice(projectId: string, operationId: string, summary: string): NotifyProjectInputV1 {
  return { projectRef: { projectId }, subject: { kind: 'project', projectRef: { projectId } },
    kind: 'automatic_adjustment', summary, operation: { aggregateType: 'CoreOperation', projectId, operationId } };
}

/**
 * 121-109: apply one batch the freeze just committed, under the platform's fixed identity, through the same approval
 * write the person's answer uses; the applied revision, or null when the card stays. No step retries: the command
 * already ran, a member is no longer pending, the person already answered (decision 42: the person's answer comes
 * first), the catalog moved, or the protection held it back — then one notice says why. The "已自动采用" notice
 * goes out after the commit; a crash between the two loses only the notice, the revision stays in the history.
 * A commit that landed with its files not written is that `unavailable` (the write log recovers the files).
 */
async function autoApplyBatch(deps: ProposalServiceDeps, ctx: CoreCallContext, batch: ArchitectureProposalBatchV1,
  others: number): Promise<ArchitectureRevision | CoreRejection | null> {
  const auto = hostSystemContext(ctx, STRUCTURAL_AUTO_APPROVAL_ACTOR);
  const keys = autoApplyKeys(batch.ref);
  const prior = await priorApproval(deps, keys);
  if (prior !== null) return prior.status === 'applied' ? prior.revision : null;
  const members = await readBatchMembers(deps, batch);
  if (members.status !== 'ready' || members.value.some(member => member.state !== 'pending')) return null;
  const answer = await deps.decisionMessages.readDecisionAnswer(auto, { source: batchDecisionSource(batch.ref) });
  if (answer.status !== 'ready' || answer.value.message !== null) return null;
  const out: { blocked: AutoApprovalBlockV1 | null; summary: string | null } = { blocked: null, summary: null };
  const result = await applyWith(deps, auto, keys, `auto:${batch.ref.batchId}`, batch, members.value,
    { kind: 'auto', out });
  const projectId = batch.ref.projectId;
  if (result.status === 'applied') {
    // Null only when a copy of this command committed first; that copy sends the notice.
    if (out.summary !== null) {
      const reason = proposalBatchReason(members.value).split('\n')[0]!;
      await deps.knowledge.write.notify(autoApprovalNotice(projectId, `structural-auto:${batch.ref.batchId}`,
        truncateUtf8(`已自动采用结构提案（设置：结构提案自动批准）：${out.summary}；理由：${reason}`
          + (others > 0 ? `；另有 ${String(others)} 份提案留在卡上` : ''), 512)));
    }
    return result.revision;
  }
  if (out.blocked !== null) {
    await deps.knowledge.write.notify(autoApprovalNotice(projectId, `structural-auto-declined:${batch.ref.batchId}`,
      autoApprovalDeclinedSummary('结构提案', out.blocked)));
  }
  // Its members are applied, so no card can show: the call answers as the person's approval would. Nothing committed
  // (a busy lease, a read that failed): the card stays.
  if ('code' in result && result.code === 'unavailable'
    && (await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint)).status === 'found') return result;
  return null;
}

/**
 * KC-1 G2 (ruling 4-9): the files this batch would change if approved now, from a read-only trial of its ops on the
 * current pin (never queued, leased or committed). Each line's files are read for the source verdict (ruling 4-2 A);
 * a new module file has no name yet (`path: null`), because `writeModule` picks one at approval.
 */
export async function readProposalBatchFiles(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: { batchRef: ArchitectureProposalBatchRef }): Promise<ReadResult<{ files: readonly ProposalBatchFileV1[] }>> {
  if (!isRecord(input)) return rejected('invalid', 'a proposal batch files read requires an input object');
  const problem = batchRefProblem(input.batchRef);
  if (problem !== null) return rejected('invalid', problem);
  if (input.batchRef.projectId !== ctx.projectId) return rejected('forbidden', 'the batch is outside the call context project');
  const batch = await readBatch(deps, input.batchRef);
  if (batch.status !== 'ready') return batch;
  const trial = platformCheckContext(ctx, TRIAL_ACTOR);
  const draft = await draftCatalogRevision(deps, trial, { expected: batch.value.baseCatalogPin, ops: batch.value.ops,
    responsibilityMoves: batch.value.responsibilityMoves, reason: 'proposal batch files',
    commandId: `files:${batch.value.ref.batchId}` });
  if (draft.status !== 'ready') return draft;
  const lines = await deps.knowledge.project(trial);
  if (lines.status !== 'ready') return rejectionOf(lines);
  const plans = await architectureWritePlansOf(lines.value, draft.value.catalog, knowledgeBaselineOf(draft.value.content));
  if (plans.status !== 'ready') return rejectionOf(plans);
  const recorded = await readRecordedCatalogWindow(deps.records, ctx.projectId);
  if (recorded.status !== 'ready' && recorded.status !== 'not_found') return recorded;
  const files: ProposalBatchFileV1[] = [];
  for (const plan of plans.value) {
    const facts = await lineFileFacts(recorded.status === 'ready' ? recorded : null, plan);
    if (facts.status !== 'ready') return facts;
    const byPath = new Map(facts.value.files.map(file => [file.path, file]));
    const projection = facts.value.projection;
    const lineFiles: ProposalBatchFileV1[] = plan.changes.map(change => {
      const moduleChange = change.path !== ARCHITECTURE_FILE_PATH;
      const moduleId = moduleChange
        ? deps.knowledge.write.files.writeLogFileOf(plan.line.scope, change.path, (change.after ?? change.before)!).moduleId
        : null;
      return { workspaceId: plan.line.scope.workspaceId,
        path: change.before === null && moduleChange ? null : change.path, moduleId,
        action: change.before === null ? 'create' as const : change.after === null ? 'delete' as const : 'modify' as const,
        source: change.before === null ? null : platformFileSource(projection,
          { path: change.path, bytes: change.before, committed: byPath.get(change.path)!.committed }) };
    });
    lineFiles.sort((left, right) => left.path === null
      ? right.path === null ? (left.moduleId ?? '') < (right.moduleId ?? '') ? -1
        : (left.moduleId ?? '') > (right.moduleId ?? '') ? 1 : 0 : 1
      : right.path === null ? -1 : left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    files.push(...lineFiles);
  }
  return { status: 'ready', value: { files } };
}

export async function readArchitectureProposal(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: { proposalRef: ArchitectureProposalRef }): Promise<ReadResult<ProposalRead>> {
  if (!isRecord(input)) return rejected('invalid', 'a proposal read requires an input object');
  const problem = proposalRefProblem(input.proposalRef);
  if (problem !== null) return rejected('invalid', problem);
  if (input.proposalRef.projectId !== ctx.projectId) {
    return rejected('forbidden', 'the proposal is outside the call context project');
  }
  const record = await readProposal(deps, input.proposalRef);
  if (record.status !== 'ready') return record;
  const batchRef = record.value.batchRef;
  return {
    status: 'ready',
    value: {
      proposal: proposalOf(record.value),
      batchRef: batchRef === null ? null : structuredClone(batchRef),
      cardKey: batchRef === null ? null : decisionSourceKey({ kind: 'structural_proposal', batch: batchRef }),
    },
  };
}

// --------------------------------------------------------------------------
// The project's pending proposals and frozen batches (bare form; the factory binds deps)
// --------------------------------------------------------------------------

/** Every pending, unbatched proposal of the project, in proposal-id order. */
async function readPendingArchitectureProposals(deps: ProposalServiceDeps, ctx: CoreCallContext,
  input: { projectRef: ProjectScope }): Promise<ReadResult<ArchitectureProposalRef[]>> {
  try {
    const page = await lookupAll(deps.records, S8C_PROPOSAL_BY_PROJECT_LOOKUP, [input.projectRef.projectId]);
    const refs: ArchitectureProposalRef[] = [];
    for (const encoded of page.items) {
      const decoded = decodeArchitectureProposalRecord(encoded);
      if (decoded.status !== 'decoded') return rejected('unavailable', 'a stored proposal is damaged');
      if (decoded.value.state === 'pending' && decoded.value.batchRef === null) refs.push({ ...decoded.value.ref });
    }
    return { status: 'ready', value: refs };
  } catch (error) {
    return storeFailureToRejection(error);
  }
}

async function readFrozenArchitectureBatches(deps: ProposalServiceDeps, _ctx: CoreCallContext,
  input: { projectRef: ProjectScope; baseCatalogPin: ArchitectureCatalogPinV1 }):
  Promise<ReadResult<ArchitectureProposalBatchRef[]>> {
  const batches = await readProjectBatches(deps.records, input.projectRef.projectId);
  if (batches.status !== 'ready') return batches;
  return { status: 'ready', value: batches.value
    .filter(batch => sameCatalogPin(batch.baseCatalogPin, input.baseCatalogPin)).map(batch => ({ ...batch.ref })) };
}

export function createArchitectureProposalService(deps: ProposalServiceDeps): ArchitectureProposalService {
  return {
    proposeArchitectureRevision: (ctx, input) => proposeArchitectureRevision(deps, ctx, input),
    freezeArchitectureProposalBatch: (ctx, input) => freezeArchitectureProposalBatch(deps, ctx, input),
    applyArchitectureProposalBatch: (ctx, input) => applyArchitectureProposalBatch(deps, ctx, input),
    readArchitectureProposal: (ctx, input) => readArchitectureProposal(deps, ctx, input),
    readProposalBatchFiles: (ctx, input) => readProposalBatchFiles(deps, ctx, input),
    readPendingArchitectureProposals: (ctx, input) => readPendingArchitectureProposals(deps, ctx, input),
    readFrozenArchitectureBatches: (ctx, input) => readFrozenArchitectureBatches(deps, ctx, input),
  };
}
