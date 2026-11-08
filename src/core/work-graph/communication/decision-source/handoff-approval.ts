/**
 * The `handoff_approval` decision source: the handoff operation's own pending approval fragment, re-read by identity.
 * It is the one pure projection of that operation onto the card's facts, so the queue source and the answerability read
 * cannot disagree.
 *
 * The source's canonical identity is `{ kind: 'handoff_approval', operationRef }` (the contract's identity arm). The
 * card subject follows the assignments' distinct Goals: exactly one Goal is that Goal, and two or more Goals (or no
 * handed Task) are the project. `openedAt` is the operation's own stored `requestedAt`, never the read's clock. Every
 * stage is listed, so a handled card stays in `history`: `closedReasonOf` answers `source_resolved` once the approval
 * is approved/rejected or the operation ended, and only a pending approval is open.
 */
import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1, DecisionSourceV1, DecisionSubjectV1,
  GoalDecisionBasisV1,
} from '../../../../contracts/goal-decisions.js';
import { decisionSourceKey, decisionSubjectKey } from '../../../../contracts/goal-decisions.js';
import type { OperationRef } from '../../../../contracts/core/operations.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import { canonicalJson, canonicalKey, type JsonValue } from '../../../../contracts/fingerprint.js';
import { checkShape } from '../../../../contracts/validation/data-format.js';
import { OperationRefShape } from '../../../../contracts/data-format-refs.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { messageOf } from '../../../../contracts/error-message.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../../record-store/ports.js';
import type { RecordLookupPort } from '../../../record-store/lookup-ports.js';
import type { DecisionCardV1 } from '../../model/decision-contracts.js';
import type { SessionOperationRecordOf } from '../../model/session-contracts.js';
import type { HandoffActionV1 } from '../../model/session-operation-arms.js';
import type { HandoffApprovalV1 } from '../../../../contracts/handoff.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord,
} from '../../sessions/session-record-codecs.js';
import { lookupAll } from '../../persistence/lookup-all.js';
import { storeFailureToRejection } from '../../persistence/read-result-failures.js';
import { nestedSourceObject, parseDecisionSourceKey } from '../../tasks/decision-source-identity.js';
import { clonePins, goalBasis } from './read-support.js';
import type { SourceDependencies, SourceReadResult, SourceReadSupport } from './types.js';

/** The record shell of one `handoff` operation. */
export type HandoffApprovalOperationV1 = SessionOperationRecordOf<HandoffActionV1>;

export type HandoffApprovalCardFactsV1 = {
  source: DecisionSourceV1;
  operation: HandoffApprovalOperationV1;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  closedReason: 'source_resolved' | null;
  /** The operation's own requested time. */
  openedAt: string;
  required: HandoffApprovalV1['required'];
};

/** `approved`, `rejected` and any ended operation are resolved; a pending approval is the only open card. */
export function handoffApprovalClosedReason(operation: HandoffApprovalOperationV1): 'source_resolved' | null {
  const approval = operation.action.progress.approval;
  if (approval === null || approval.state !== 'pending') return 'source_resolved';
  return operation.phase === 'completed' || operation.phase === 'failed' ? 'source_resolved' : null;
}

/** The operation's canonical identity: the operation ref alone. */
export function handoffApprovalSourceIdentity(
  operation: HandoffApprovalOperationV1,
): Extract<DecisionSourceIdentityV1, { kind: 'handoff_approval' }> {
  return { kind: 'handoff_approval', operationRef: structuredClone(operation.ref) };
}

/** The one handoff subject rule: exactly one distinct Goal among the assignments' Tasks is that Goal; otherwise the project. */
export function handoffApprovalSubjectOf(
  operation: HandoffApprovalOperationV1,
): DecisionSubjectV1 {
  const goals = new Map<string, GoalRef>();
  for (const assignment of operation.action.input.assignments) {
    for (const task of assignment.tasks) {
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
      goals.set(canonicalKey(goalRef), goalRef);
    }
  }
  const only = [...goals.values()][0];
  return goals.size === 1 && only !== undefined
    ? { kind: 'goal', goalRef: only }
    : { kind: 'project', projectRef: { projectId: operation.ref.projectId } };
}

/** The one pure projection of a handoff operation onto its card facts. */
export function handoffApprovalCardFacts(operation: HandoffApprovalOperationV1): HandoffApprovalCardFactsV1 {
  const approval = operation.action.progress.approval;
  if (approval === null) throw new Error('handoffApprovalCardFacts: the operation has no approval fragment');
  const identity = handoffApprovalSourceIdentity(operation);
  const key = decisionSourceKey(identity);
  const pin: VersionPin = { ref: structuredClone(operation.ref), revision: operation.revision };
  const closedReason = handoffApprovalClosedReason(operation);
  const source: DecisionSourceV1 = {
    kind: 'handoff_approval',
    key,
    subject: handoffApprovalSubjectOf(operation),
    pins: [pin],
    goalBases: [],
  };
  return {
    source,
    operation,
    objects: [{ kind: 'aggregate', pin: structuredClone(pin), label: '交接审批' }],
    options: closedReason === null
      ? [{ id: 'approve', label: '同意', effect: 'apply' }, { id: 'reject', label: '拒绝', effect: 'reject' }]
      : [],
    closedReason,
    openedAt: operation.requestedAt,
    required: approval.required,
  };
}

/** The card's stable key; the registration and the by-key read both derive it from the same identity. */
export function handoffApprovalCardKey(operation: HandoffApprovalOperationV1): string {
  return decisionSourceKey(handoffApprovalSourceIdentity(operation));
}

/** The one card projection of a handoff operation, under the same derived subject as its source. */
export function handoffApprovalCard(operation: HandoffApprovalOperationV1): DecisionCardV1 {
  const facts = handoffApprovalCardFacts(operation);
  return {
    cardKey: facts.source.key, source: facts.source,
    state: facts.closedReason === null ? 'waiting_answer' : 'closed',
    subject: structuredClone(facts.source.subject), senderSessionRef: null, requestRef: null,
    objects: facts.objects, options: facts.options, answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null, closedReason: facts.closedReason, openedAt: facts.openedAt,
    taskRef: null, runRef: null,
    readOnly: facts.closedReason !== null, actions: facts.closedReason === null ? ['answer'] : [],
  };
}

/** The operation ref of one `handoff_approval` source key; null when the key carries no valid ref. */
export function handoffApprovalOperationOfSource(source: DecisionSourceV1): OperationRef | null {
  if (source.kind !== 'handoff_approval') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'handoff_approval') return null;
  const raw = nestedSourceObject(parsed.body, 'operationRef');
  if (raw === null || checkShape(OperationRefShape, raw, 'stored') !== null) return null;
  return raw as unknown as OperationRef;
}

/** One operation read by identity; a real absence is `null`, a damaged record is `unavailable`. */
export async function readHandoffApprovalOperation(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, ref: OperationRef,
): Promise<ReadResult<HandoffApprovalOperationV1 | null>> {
  const key = canonicalJson(ref as unknown as JsonValue);
  let read;
  try {
    read = await records.readMany([key]);
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: messageOf(error) };
  }
  if (read.status !== 'ready') return storeFailureToRejection(read);
  const found = read.value.records.find((record: EncodedRecord) => record.refKey === key);
  if (found === undefined) {
    return read.value.missing.includes(key) ? { status: 'ready', value: null }
      : { status: 'rejected', code: 'unavailable', reason: `the handoff operation ${key} was not read` };
  }
  const decoded = decodeSessionOperationRecord(found);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `the handoff operation is damaged: ${decoded.reason}` };
  }
  return decoded.value.action.kind === 'handoff'
    ? { status: 'ready', value: decoded.value as HandoffApprovalOperationV1 }
    : { status: 'ready', value: null };
}

/**
 * Every handoff operation of the workspace that carries an approval fragment, in every phase (a handled card stays in
 * `history`), ordered by its own requested time and then its operation id.
 */
export async function readHandoffApprovalOperations(
  records: Pick<RecordLookupPort, 'lookup'>, scope: { projectId: string; workspaceId: string },
): Promise<ReadResult<readonly HandoffApprovalOperationV1[]>> {
  const operations: HandoffApprovalOperationV1[] = [];
  for (const phase of ['accepted', 'running', 'completed', 'failed', 'unknown'] as const) {
    let items: readonly EncodedRecord[];
    try {
      items = (await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [scope.projectId, scope.workspaceId, phase])).items;
    } catch (error) {
      return { status: 'rejected', code: 'unavailable', reason: `the handoff operations could not be read: ${messageOf(error)}` };
    }
    for (const encoded of items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `a handoff operation is damaged: ${decoded.reason}` };
      }
      const operation = decoded.value;
      if (operation.action.kind !== 'handoff') continue;
      if (operation.action.progress.approval === null) continue;
      if (operation.ref.projectId !== scope.projectId || operation.workspaceId !== scope.workspaceId) continue;
      operations.push(operation as HandoffApprovalOperationV1);
    }
  }
  operations.sort((left, right) => left.requestedAt < right.requestedAt ? -1 : left.requestedAt > right.requestedAt ? 1
    : left.ref.operationId < right.ref.operationId ? -1 : left.ref.operationId > right.ref.operationId ? 1 : 0);
  return { status: 'ready', value: operations };
}

/**
 * The answerability branch: re-read the operation by its identity arm, prove it against the bound scope, then rebuild
 * the same facts the card source projects. A missing/damaged operation is propagated, never an empty source.
 */
export async function readHandoffApprovalSource(
  support: SourceReadSupport, _ctx: CoreCallContext, source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'handoff_approval' }>,
  _deps: SourceDependencies, goalRef: GoalRef | null,
): Promise<SourceReadResult> {
  const operationProblem = support.scopeProblem(identity.operationRef);
  if (operationProblem !== null) return operationProblem;
  const read = await support.readDecoded(identity.operationRef, decodeSessionOperationRecord, 'handoff operation');
  if (read.status !== 'ready') return read;
  const decoded = read.value;
  if ((decoded.action as { kind: string }).kind !== 'handoff') {
    return rejectedWithCurrent('invalid', 'the decision source operation is not a handoff');
  }
  const operation = decoded as HandoffApprovalOperationV1;
  if (operation.ref.projectId !== support.scope.projectId
    || operation.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the handoff operation is outside the bound scope');
  }
  if (operation.action.progress.approval === null) {
    return rejectedWithCurrent('invalid', 'the handoff operation has no approval card');
  }
  const expected = handoffApprovalSubjectOf(operation);
  if (decisionSubjectKey(source.subject) !== decisionSubjectKey(expected)) {
    return rejectedWithCurrent('invalid', 'the handoff approval is read under another subject');
  }
  let goal: GoalSnapshot | null = null;
  if (goalRef !== null) {
    const goalRead = await support.readGoal(goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    goal = goalRead.value;
  }
  const facts = handoffApprovalCardFacts(operation);
  const pins = clonePins(facts.source.pins);
  const objects = facts.objects.map((object) => structuredClone(object));
  const options = facts.options.map((option) => structuredClone(option));
  const goalBases: GoalDecisionBasisV1[] = goal === null ? [] : [goalBasis(goal)];
  const allowedReaderSessionRefs: SessionRef[] = [];
  return { status: 'ready', value: { goal, objects, options, pins, goalBases,
    closed: facts.closedReason !== null, allowedReaderSessionRefs } };
}
