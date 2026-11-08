/**
 * The `module_maintainer_assignment` decision source: the pending maintainer operation, re-read by identity.
 *
 * The formal request is one existing `SessionOperationRecord` with the `maintainer_assignment` action arm; this file
 * reads it, never a second request record. The card's only text slot is the object label, so the stored `input.reason`
 * appears there and no new `DecisionCardV1` field is added. `openedAt` is the operation's own stored `requestedAt`,
 * never the read's clock.
 *
 * `readCollection` scans the existing operation-by-workspace-phase index over all five phases and keeps only the
 * card (`verdict === 'needs_decision'`), ordered by `requestedAt` then operation id; the read model closes a terminal one.
 * `readByKey` reads exactly one operation through `records.readMany` + the operation codec, never the host-gated
 * operation read. Neither adds an index, a record or an empty source.
 */
import type { CoreCallContext } from '../../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../../contracts/core/identity.js';
import type { OperationRef } from '../../../../contracts/core/operations.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1, DecisionSourceV1, DecisionSubjectV1,
} from '../../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import { checkShape } from '../../../../contracts/validation/data-format.js';
import { OperationRefShape } from '../../../../contracts/data-format-refs.js';
import type { EncodedRecord, GoalRecordTransactionPort } from '../../../record-store/ports.js';
import type { RecordLookupPort } from '../../../record-store/lookup-ports.js';
import type { DecisionCardV1 } from '../../model/decision-contracts.js';
import type { MaintainerAssignmentOperationV1 } from '../../model/session-contracts.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord,
  readMaintainerAssignmentOperation,
} from '../../sessions/session-record-codecs.js';
import { lookupAll } from '../../persistence/lookup-all.js';
import { storeFailureToRejection } from '../../persistence/read-result-failures.js';
import { nestedSourceObject, parseDecisionSourceKey } from '../../tasks/decision-source-identity.js';
import { clonePins } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** The two store reads the card source uses: the phase index and one point read by operation key. */
export type MaintainerAssignmentCardRecords =
  Pick<GoalRecordTransactionPort, 'readMany'> & Pick<RecordLookupPort, 'lookup'>;

export type MaintainerAssignmentCardFactsV1 = {
  source: DecisionSourceV1;
  operation: MaintainerAssignmentOperationV1;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  closedReason: 'source_resolved' | null;
  /** The operation's own requested time. */
  openedAt: string;
};

/** `done`/`rejected`/`stale` are the three terminal maintainer stages; every other stage is still open. */
export function maintainerAssignmentClosedReason(
  op: MaintainerAssignmentOperationV1,
): 'source_resolved' | null {
  const stage = op.action.progress.stage;
  return stage === 'done' || stage === 'rejected' || stage === 'stale' ? 'source_resolved' : null;
}

/** The operation's canonical identity: the operation ref alone. */
export function maintainerAssignmentIdentity(
  op: MaintainerAssignmentOperationV1,
): Extract<DecisionSourceIdentityV1, { kind: 'module_maintainer_assignment' }> {
  return { kind: 'module_maintainer_assignment', operationRef: structuredClone(op.ref) };
}

/** The card's stable key; the registration and the by-key read both derive it from the same identity. */
export function maintainerAssignmentCardKey(op: MaintainerAssignmentOperationV1): string {
  return decisionSourceKey(maintainerAssignmentIdentity(op));
}

/** The one pure projection of a maintainer operation onto its card facts. */
export function maintainerAssignmentCardFacts(
  op: MaintainerAssignmentOperationV1,
): MaintainerAssignmentCardFactsV1 {
  const pin: VersionPin = { ref: structuredClone(op.ref), revision: op.revision };
  const closedReason = maintainerAssignmentClosedReason(op);
  return {
    source: {
      kind: 'module_maintainer_assignment', key: maintainerAssignmentCardKey(op),
      subject: { kind: 'project', projectRef: { projectId: op.ref.projectId } },
      pins: [pin], goalBases: [],
    },
    operation: op,
    // DecisionCardV1 has no free-text reason field; the only text slot is the object label.
    objects: [{ kind: 'aggregate', pin: structuredClone(pin),
      label: `模块维护者：${op.action.input.reason}` }],
    options: closedReason === null
      ? [{ id: 'approve', label: '同意', effect: 'apply' },
        { id: 'reject', label: '拒绝', effect: 'reject' }]
      : [],
    closedReason,
    openedAt: op.requestedAt,
  };
}

/** The card projection of the same facts; `subject` is the subject the source was read for. */
export function maintainerAssignmentCard(
  facts: MaintainerAssignmentCardFactsV1,
  subject?: DecisionSubjectV1,
): DecisionCardV1 {
  return {
    cardKey: facts.source.key,
    source: { ...structuredClone(facts.source), pins: clonePins(facts.source.pins) },
    state: facts.closedReason === null ? 'waiting_answer' : 'closed',
    subject: structuredClone(subject ?? facts.source.subject),
    senderSessionRef: null, requestRef: null,
    objects: facts.objects.map((object) => structuredClone(object)),
    options: facts.options.map((option) => structuredClone(option)),
    answerMessageRef: null, answer: null, application: null,
    candidateStatus: null, staleReason: null,
    closedReason: facts.closedReason, openedAt: facts.openedAt,
    taskRef: null, runRef: null,
    readOnly: facts.closedReason !== null,
    actions: facts.closedReason === null ? ['answer'] : [],
  };
}

/**
 * Every pending `maintainer_assignment` operation of one workspace, in every phase, ordered by its own requested
 * time and then its operation id.
 */
export async function readCollection(
  records: MaintainerAssignmentCardRecords,
  input: { workspace: WorkspaceScope; subject: DecisionSubjectV1 },
): Promise<ReadResult<readonly MaintainerAssignmentCardFactsV1[]>> {
  const { workspace } = input;
  const cards: MaintainerAssignmentCardFactsV1[] = [];
  for (const phase of ['accepted', 'running', 'completed', 'failed', 'unknown'] as const) {
    let items: readonly EncodedRecord[];
    try {
      items = (await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [workspace.projectId, workspace.workspaceId, phase])).items;
    } catch (error) {
      return storeFailureToRejection(error);
    }
    for (const encoded of items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') {
        return rejectedWithCurrent('unavailable', `a maintainer assignment operation is damaged: ${decoded.reason}`);
      }
      if (decoded.value.action.kind !== 'maintainer_assignment') continue;
      const operation = decoded.value as unknown as MaintainerAssignmentOperationV1;
      if (operation.action.progress.decision?.verdict !== 'needs_decision') continue;
      cards.push(maintainerAssignmentCardFacts(operation));
    }
  }
  cards.sort((left, right) => {
    const byTime = left.openedAt < right.openedAt ? -1 : left.openedAt > right.openedAt ? 1 : 0;
    if (byTime !== 0) return byTime;
    const leftId = left.operation.ref.operationId;
    const rightId = right.operation.ref.operationId;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return { status: 'ready', value: cards };
}

/**
 * The one operation named by a `decisionSourceKey`, read through the operation codec and proved against the bound
 * project/workspace. A real absence is `null`; a damaged record is `unavailable`; a foreign operation is `forbidden`.
 */
export async function readByKey(
  records: MaintainerAssignmentCardRecords,
  input: { workspace: WorkspaceScope; source: DecisionSourceV1 },
): Promise<ReadResult<MaintainerAssignmentCardFactsV1 | null>> {
  const parsed = parseDecisionSourceKey(input.source);
  if (parsed === null || parsed.kind !== 'module_maintainer_assignment') {
    return rejectedWithCurrent('invalid', 'a module_maintainer_assignment source key names no operation');
  }
  const raw = nestedSourceObject(parsed.body, 'operationRef');
  if (raw === null || checkShape(OperationRefShape, raw, 'stored') !== null) {
    return rejectedWithCurrent('invalid', 'the module_maintainer_assignment source names no operation ref');
  }
  const operationRef = raw as unknown as OperationRef;
  const read = await readMaintainerAssignmentOperation(records, operationRef);
  if (read.status !== 'ready') return read;
  if (read.value === null) return { status: 'ready', value: null };
  const operation = read.value;
  if (operation.ref.projectId !== input.workspace.projectId
    || operation.workspaceId !== input.workspace.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the maintainer assignment operation is outside the bound workspace');
  }
  return { status: 'ready', value: maintainerAssignmentCardFacts(operation) };
}

/** The `createCollectionCardSource` spec this source publishes; `views/` supplies the adapter. */
export type MaintainerAssignmentCardSourceSpec = {
  kind: 'module_maintainer_assignment';
  serves: readonly ['project'];
  readCollection(ctx: CoreCallContext, input: { workspace: WorkspaceScope; subject: DecisionSubjectV1 })
    : Promise<ReadResult<readonly MaintainerAssignmentCardFactsV1[]>>;
  keyOf(facts: MaintainerAssignmentCardFactsV1): string;
  closedReasonOf(facts: MaintainerAssignmentCardFactsV1): DecisionCardV1['closedReason'];
  project(facts: MaintainerAssignmentCardFactsV1, subject: DecisionSubjectV1, goal: null): DecisionCardV1;
  readByKey(ctx: CoreCallContext, input: { workspace: WorkspaceScope; source: DecisionSourceV1 })
    : Promise<ReadResult<{ item: MaintainerAssignmentCardFactsV1 }
      | { closed: DecisionCardV1['closedReason']; openedAt: string | null } | null>>;
};

/** Builds the one `createCollectionCardSource` spec the views registration wraps. */
export function maintainerAssignmentCardSourceSpec(
  records: MaintainerAssignmentCardRecords,
): MaintainerAssignmentCardSourceSpec {
  return {
    kind: 'module_maintainer_assignment',
    serves: ['project'],
    readCollection: (_ctx, { workspace, subject }) => readCollection(records, { workspace, subject }),
    keyOf: (facts) => facts.source.key,
    closedReasonOf: (facts) => facts.closedReason,
    project: (facts, subject) => maintainerAssignmentCard(facts, subject),
    async readByKey(_ctx, { workspace, source }) {
      const read = await readByKey(records, { workspace, source });
      if (read.status !== 'ready') return read;
      if (read.value === null) return { status: 'ready', value: null };
      const facts = read.value;
      return { status: 'ready', value: facts.closedReason === null
        ? { item: facts }
        : { closed: facts.closedReason, openedAt: facts.openedAt } };
    },
  };
}

/**
 * The answerability branch: re-read the operation by its identity arm, prove its scope, then rebuild the same facts
 * the card source projects. A missing/damaged operation is propagated, never an empty source.
 */
export async function readMaintainerAssignmentSource(
  support: SourceReadSupport,
  source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'module_maintainer_assignment' }>,
): Promise<SourceReadResult> {
  const operationProblem = support.scopeProblem(identity.operationRef);
  if (operationProblem !== null) return operationProblem;
  const read = await support.readDecoded(identity.operationRef, decodeSessionOperationRecord,
    'maintainer assignment operation');
  if (read.status !== 'ready') return read;
  const decoded = read.value;
  if (decoded.action.kind !== 'maintainer_assignment') {
    return rejectedWithCurrent('invalid', 'the decision source operation is not a maintainer assignment');
  }
  const operation = decoded as unknown as MaintainerAssignmentOperationV1;
  if (operation.ref.projectId !== support.scope.projectId
    || operation.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the maintainer assignment operation is outside the bound scope');
  }
  if (source.subject.kind !== 'project' || source.subject.projectRef.projectId !== operation.ref.projectId) {
    return rejectedWithCurrent('invalid', 'the maintainer assignment card is read under another project');
  }
  const facts = maintainerAssignmentCardFacts(operation);
  return { status: 'ready', value: {
    goal: null,
    objects: facts.objects.map((object) => structuredClone(object)),
    options: facts.options.map((option) => structuredClone(option)),
    pins: clonePins(facts.source.pins),
    goalBases: [],
    closed: facts.closedReason !== null,
    allowedReaderSessionRefs: [],
  } };
}
