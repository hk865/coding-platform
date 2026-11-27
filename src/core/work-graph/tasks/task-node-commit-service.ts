/**
 * Node-level review (decision 121-45; nr): the owner of `TaskNodeCommit@1`.
 *
 * `readNodeRows` gives one row per Task of the Goal's active Plan: its applicable reduction, its Runs, its own files
 * with the work-tree blob now and the other Goals whose conflict card names the same file, its review fact, whether
 * it waits for the person (`pending`), and whether the Goal has live work. The Workflow's `every_step` gate reads it.
 *
 * `commitNode` is the person's one action on a pending node: `commit` has the platform make one git commit of the
 * node's own paths with the person's message, `acknowledge` records that the files no longer differ from HEAD and
 * makes none. Either way the person must have read exactly the content that is there now (N1). A git commit that
 * landed when its store commit did not is found again by its trailers and only recorded (N3, NR-14).
 *
 * `reworkNode` (121-173) is the person's other action: send the pending node back with a reason. It checks the node
 * and the person's two pins here, then the requeue owner writes the TaskRequeue that makes the reviewed reduction stop
 * applying. `readNodeReceipts` gives the review facts the main conversation keeps.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import { GoalRefShape, TaskTripleShape, id } from '../../../contracts/data-format-refs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalSnapshot, GoalRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TaskReductionRef } from '../../../contracts/reduction.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import {
  TASK_NODE_COMMIT_BY_GOAL_LOOKUP, type TaskNodeCommittedEventV1, type TaskNodeCommitV1,
} from '../../../contracts/task-node-commit.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { DecisionReadPort, GoalExecutedFilesPort } from '../model/decision-contracts.js';
import type { DutyRecipientPort } from '../sessions/duty-recipient.js';
import type {
  NodeReviewReceiptV1, TaskNodeCommitPort, TaskNodeCommitWorkspacePort, TaskNodeReviewRowV1,
} from '../model/task-node-commit-contracts.js';
import { commandKeys, executeWriteCommand, readCommittedEvent } from '../persistence/command-executor.js';
import { lookupCommittedReceipt } from '../persistence/receipt-lookup.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { taskNodeCommitCodec, taskNodeCommittedCodec } from '../persistence/task-node-commit-codecs.js';
import {
  taskNodeReviewDraftCodec, taskNodeReviewDraftRecordedCodec,
} from '../persistence/task-node-review-draft-codecs.js';
import {
  TASK_NODE_REVIEW_DRAFT_BY_GOAL_LOOKUP, type TaskNodeReviewDraftRecordedEventV1, type TaskNodeReviewDraftV1,
} from '../../../contracts/task-node-review-draft.js';
import {
  newTaskNodeReviewDraft, nodeReviewDraftCommandId, nodeReviewProblem, sendsBack, reviewedContentProblem, taskAwaitsReview, taskNodeCommitOf, taskNodeCommitRefOf,
  taskNodeFilesOf, taskNodePending, type ExecutedFileV1, type NodeReviewFactsV1, type TaskNodeCommitDraftV1,
} from '../state/task-node-commit.js';
import {
  TASK_REQUEUED_EVENT_TYPE, TASK_REWORK_EVENT_SCHEMA_VERSION, taskRequeuedEventFromEvent, taskRequeueRefKey,
} from './claim-record-codecs.js';
import { bindTrustedContext, isolateWrite, operatorProblem } from './execution-entry-service.js';
import {
  readCanonicalTaskFacts, readGoalPlanWindow, type CanonicalTaskFacts, type CanonicalTaskState,
} from './plan-readers.js';
import { liveRunsOf } from './plan-service.js';
import type { NodeReviewRequeuePort } from './requeue-service.js';
import { pinRevision } from './revision-guard.js';

const OPERATION = 'node-commit';
/** The send-back's own command identity: its replay is found from the person's request before any read. */
const REWORK_OPERATION = 'node-rework';
/** The draft ask's record: one command per (Goal, Task, reduction revision). */
const DRAFT_OPERATION = 'node-review-draft';

export type TaskNodeCommitServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  executedFiles: GoalExecutedFilesPort;
  /** E3-8's per-file conflict read (NR-21): only its cards' file objects mark a shared path. */
  conflicts: Pick<DecisionReadPort, 'queryGoalConflicts'>;
  workspace: TaskNodeCommitWorkspacePort;
  /** 121-173: the requeue owner's node-review entry; a send-back is that owner's TaskRequeue. */
  requeue: NodeReviewRequeuePort;
  /** 121-173: the one duty read (`resolveDutyRecipient`); the draft is asked of the workspace's secretary. */
  duties: Pick<DutyRecipientPort, 'resolveDutyRecipient'>;
  operatorActor?: { kind: 'human' | 'system'; id: string };
  now(): string;
};

type CommitNodeInput = Parameters<TaskNodeCommitPort['commitNode']>[1]['input'];

/** The person's write as it arrives; refs and the reviewed list are checked whole before any read. */
const CommitNodeInputShape = defineShape({ name: 'nodes/commit input', fields: {
  goalRef: f.ref(GoalRefShape), taskRef: f.ref(TaskTripleShape), decision: f.enumOf(['commit', 'acknowledge']),
  message: f.nullable(f.string()), reviewed: f.array(f.object({ path: id, blob: f.nullable(id) })),
} });

/** The send-back as it arrives; the reason's bounds are the requeue's own (`TASK_REWORK_REASON_MAX_CHARS`). */
const ReworkNodeInputShape = defineShape({ name: 'nodes/rework input', fields: {
  goalRef: f.ref(GoalRefShape), taskRef: f.ref(TaskTripleShape), reason: f.string(),
} });

/** 121-173: the selected Run's TaskRequeue as read; the review commit guards it, so a send-back of the same version
 *  committed meanwhile fails the review. Null without a selected Run (no send-back can cover the version then). */
type SendBackGuard = { refKey: string; expectedRevision: number | null } | null;

type CommitFacts =
  /** NR-14: the git commit of this identity and fingerprint already landed; only the record is missing. */
  | { kind: 'recovered'; draft: TaskNodeCommitDraftV1; sha: string; sendBackGuard: SendBackGuard }
  | { kind: 'fresh'; draft: TaskNodeCommitDraftV1; workspace: WorkspaceRef; paths: string[]; sendBackGuard: SendBackGuard };

/** The stable ledger half of a Goal's node review: records only (no work-tree blob, no conflict graph, 121-93). */
type NodeReviewLedgerV1 =
  | { plan: null; goal: GoalSnapshot }
  | { plan: PlanRevisionSnapshot; goal: GoalSnapshot; facts: CanonicalTaskFacts;
      nodeFiles: Map<string, ReturnType<typeof taskNodeFilesOf>>;
      reviews: Map<string, TaskNodeCommitV1>;
      pendingByTaskId: Map<string, boolean> };

export function createTaskNodeCommitService(deps: TaskNodeCommitServiceDependencies): TaskNodeCommitPort {
  const records = deps.records;

  /** Every review fact of the Goal, keyed `taskId:reductionRevision`. */
  async function readReviews(goalRef: GoalRef): Promise<Map<string, TaskNodeCommitV1> | CoreRejection> {
    let batch;
    try {
      batch = await lookupAll(records, TASK_NODE_COMMIT_BY_GOAL_LOOKUP, [goalRef.projectId, goalRef.goalId]);
    } catch (failure) {
      return storeFailureToRejection(failure);
    }
    const reviews = new Map<string, TaskNodeCommitV1>();
    for (const encoded of batch.items) {
      const decoded = taskNodeCommitCodec.decode(encoded);
      if (decoded.status !== 'decoded') return rejected('unavailable', `a node review is not decodable: ${decoded.reason}`);
      reviews.set(`${decoded.value.ref.taskId}:${decoded.value.ref.reductionRevision}`, decoded.value);
    }
    return reviews;
  }

  /** NR-20: a failed or unavailable executed-files read is never "no files". */
  async function readExecuted(ctx: CoreCallContext, goalRef: GoalRef): Promise<ExecutedFileV1[] | CoreRejection> {
    const read = await deps.executedFiles.readGoalExecutedFiles(ctx, { goalRef });
    if (read.status === 'rejected') return read;
    if (read.status !== 'ready') return rejected('unavailable', "the Goal's executed files are not readable yet");
    if (read.value.availability !== 'available') return rejected('unavailable', "the Goal's executed files are not available");
    return read.value.files;
  }

  async function readNodeReviewLedger(ctx: CoreCallContext, goalRef: GoalRef):
    Promise<ReadResult<NodeReviewLedgerV1>> {
    if (ctx.projectId !== goalRef.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    const goal = window.goal;
    if (goal.workspaceRef.workspaceId !== ctx.workspaceId) return rejected('forbidden', 'the Goal belongs to another workspace');
    const plan = window.plan;
    if (plan === null) return { status: 'ready', value: { plan: null, goal } };
    const facts = await readCanonicalTaskFacts(records, goalRef, plan);
    if (facts.status !== 'ready') return facts;
    const executed = await readExecuted(ctx, goalRef);
    if (!Array.isArray(executed)) return executed;
    const reviews = await readReviews(goalRef);
    if (!(reviews instanceof Map)) return reviews;
    const nodeFiles = new Map(plan.tasks.map(task => [task.taskId, taskNodeFilesOf(
      new Set((facts.value.runsByTaskId.get(task.taskId) ?? []).map(run => run.ref.runId)), executed)]));
    const pendingByTaskId = new Map<string, boolean>();
    for (const task of plan.tasks) {
      const state = facts.value.byTaskId.get(task.taskId)!;
      const node = nodeFiles.get(task.taskId)!;
      const review = state.reductionRevision === null ? null
        : reviews.get(`${task.taskId}:${state.reductionRevision}`) ?? null;
      pendingByTaskId.set(task.taskId, taskNodePending({ ...nodeReviewFactsOf(goal, task, state, facts.value),
        hasFiles: node.files.length > 0, reviewed: review !== null }));
    }
    return { status: 'ready', value: { plan, goal, facts: facts.value, nodeFiles, reviews, pendingByTaskId } };
  }

  async function readNodeRows(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readNodeRows']> {
    const goalRef = input.goalRef;
    const ledger = await readNodeReviewLedger(ctx, goalRef);
    if (ledger.status !== 'ready') return ledger;
    if (ledger.value.plan === null) return { status: 'ready', value: { rows: [], pending: [], liveWork: false } };
    const { plan, goal, facts, nodeFiles, reviews, pendingByTaskId } = ledger.value;
    const paths = [...new Set([...nodeFiles.values()].flatMap(node => node.files.map(file => file.path)))];
    const blobs = new Map<string, string | null>();
    const shared = new Map<string, GoalRef[]>();
    if (paths.length > 0) {
      const read = await deps.workspace.readTaskNodeBlobs({ workspace: goal.workspaceRef, paths });
      if (read.status !== 'ready') return read;
      for (const entry of read.value) blobs.set(entry.path, entry.blob);
      // NR-21: a card of a pair with this Goal names the files both Goals change; an accepted-risk pair has no card.
      const conflicts = await deps.conflicts.queryGoalConflicts(ctx,
        { workspace: { projectId: goal.workspaceRef.projectId, workspaceId: goal.workspaceRef.workspaceId } });
      if (conflicts.status !== 'ready') return conflicts;
      const selfKey = canonicalJson(goalRef as unknown as JsonValue);
      for (const card of conflicts.value.cards) {
        const bases = card.source.goalBases ?? [];
        if (!bases.some(basis => canonicalJson(basis.goalRef as unknown as JsonValue) === selfKey)) continue;
        const others = bases.filter(basis => canonicalJson(basis.goalRef as unknown as JsonValue) !== selfKey);
        for (const object of card.objects) {
          if (object.kind !== 'file' || object.workspace.workspaceId !== goal.workspaceRef.workspaceId) continue;
          shared.set(object.path, [...(shared.get(object.path) ?? []), ...others.map(basis => ({ ...basis.goalRef }))]);
        }
      }
    }
    const rows: TaskNodeReviewRowV1[] = [];
    // The Goal display's live Runs (`starting|running`), and NR-24's node still under review.
    let liveWork = liveRunsOf(plan, facts).length > 0;
    for (const task of plan.tasks) {
      const state = facts.byTaskId.get(task.taskId)!;
      const runs = facts.runsByTaskId.get(task.taskId) ?? [];
      const reduction = state.reductionRevision === null ? undefined : facts.reductionsByTaskId.get(task.taskId);
      const node = nodeFiles.get(task.taskId)!;
      const review = state.reductionRevision === null ? null
        : reviews.get(`${task.taskId}:${state.reductionRevision}`) ?? null;
      const pending = pendingByTaskId.get(task.taskId)!;
      liveWork ||= taskAwaitsReview({ taskKind: task.taskKind, effectivePhase: state.effectivePhase,
        round: facts.roundsByTaskId.get(task.taskId), unknownCallReview: state.unknownCallReview });
      rows.push({
        task: { taskId: task.taskId, title: task.title, taskKind: task.taskKind, requirementLevel: task.requirementLevel,
          disposition: task.disposition, phase: state.effectivePhase,
          ...(task.sizeClass === undefined ? {} : { sizeClass: task.sizeClass }) },
        reduction: reduction === undefined ? null
          : { revision: reduction.revision, phase: reduction.phase, reducedAt: reduction.reducedAt },
        runs: runs.map(run => ({ ...run.ref })),
        files: node.files.map(file => ({ ...file, blob: blobs.get(file.path) ?? null,
          sharedWithGoalRefs: shared.get(file.path) ?? [] })),
        review, pending, draft: null,
      });
    }
    return { status: 'ready', value: { rows, pending: rows.filter(row => row.pending), liveWork } };
  }

  async function readPendingNodeReview(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readPendingNodeReview']> {
    const ledger = await readNodeReviewLedger(ctx, input.goalRef);
    if (ledger.status !== 'ready') return ledger;
    if (ledger.value.plan === null) return { status: 'ready', value: false };
    return { status: 'ready', value: [...ledger.value.pendingByTaskId.values()].some(Boolean) };
  }

  async function commitNode(ctx: CoreCallContext, request: Parameters<TaskNodeCommitPort['commitNode']>[1]):
    ReturnType<TaskNodeCommitPort['commitNode']> {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    const write = isolateWrite(request);
    if (!write.ok) return write.rejection;
    const { scope, actor } = owned;
    // NR-08 (product rule, 121-45): the platform commits FOR the person; an automation never reviews a node.
    const notOperator = operatorProblem(actor, deps.operatorActor, 'review a node');
    if (notOperator !== null) return notOperator;
    const shapeProblem = checkShape(CommitNodeInputShape, write.input, 'stored');
    if (shapeProblem !== null) return rejected('invalid', shapeProblem);
    const input = write.input;
    const { goalRef, taskRef, decision, message, reviewed } = input;
    const targetProblem = nodeTargetProblem(scope, goalRef, taskRef);
    if (targetProblem !== null) return targetProblem;
    // NR-12: a commit records the person's own message; an acknowledgement makes no commit and carries none.
    if (decision === 'commit' && (message === null || message.trim() === '')) {
      return rejected('invalid', 'a node commit needs the commit message');
    }
    if (decision === 'acknowledge' && message !== null) {
      return rejected('invalid', 'an acknowledgement makes no commit and carries no message');
    }
    const pins = nodeCommitPins(write.expected, goalRef, reductionRefOf(goalRef, taskRef.taskId));
    if ('status' in pins) return pins;
    const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
    const command = {
      operation: OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal: { kind: actor.kind, id: actor.id },
      commandId: write.requestId,
      // NR-07: the reduction revision comes from the pin, so the fingerprint is fixed before the first read.
      fingerprintInput: { goalRef, taskRef, reductionRevision: pins.reduction, decision, message, reviewed,
        expected: write.expected } as unknown as JsonValue,
    };
    const keys = commandKeys(command);
    const result = await executeWriteCommand<CommitFacts, CommitFacts, never, TaskNodeCommittedEventV1, TaskNodeCommitV1>(
      records, {
        ...command,
        read: async () => {
          // NR-14: the reachable history first; a commit of this write that landed is only recorded, whatever the
          // state says now (its files are committed, so the state checks below would no longer pass).
          const found = await deps.workspace.findTaskNodeCommit({ workspace, identity: keys.identityKey,
            fingerprint: keys.fingerprint });
          if (found.status !== 'ready') return found;
          if (found.value !== null && 'conflict' in found.value) {
            return rejected('invalid', 'this request id already committed a different review; use a new request id');
          }
          if (found.value !== null) {
            const draft = JSON.parse(found.value.record) as TaskNodeCommitDraftV1;
            // 121-173: a version the person sent back is not recorded as reviewed, not even from its landed commit.
            const fence = await recoveredSendBackFence(goalRef, draft);
            if ('status' in fence) return fence;
            return { status: 'ready', facts: { kind: 'recovered', sha: found.value.sha, draft,
              sendBackGuard: fence.guard } };
          }
          const fresh = await readFresh(ctx, write.requestId, actor, workspace, input, pins);
          return 'status' in fresh ? fresh : { status: 'ready', facts: fresh };
        },
        decide: facts => ({ decision: facts }),
        build: async (facts, built) => {
          let record: TaskNodeCommitV1;
          if (facts.kind === 'recovered') {
            record = taskNodeCommitOf(facts.draft, { kind: 'committed', sha: facts.sha, message: message! });
          } else if (decision === 'acknowledge') {
            record = taskNodeCommitOf(facts.draft, { kind: 'acknowledged' });
          } else {
            const committed = await deps.workspace.commitTaskNodeChanges({ workspace: facts.workspace,
              paths: facts.paths, message: message!,
              trailer: { record: JSON.stringify(facts.draft), identity: built.identityKey, fingerprint: built.fingerprint } });
            if (committed.status !== 'ready') return committed;
            record = taskNodeCommitOf(facts.draft, { kind: 'committed', sha: committed.value.sha, message: message! });
          }
          const event: TaskNodeCommittedEventV1 = { eventId: `${built.identityKey}:committed`,
            eventType: 'TaskNodeCommitted', schemaVersion: 1, occurredAt: deps.now(), result: record };
          return {
            records: [taskNodeCommitCodec.encode(record)],
            // The node's one review fact: a second write of the same (Task, reduction revision) conflicts, and so
            // does a send-back of that version committed since the read (121-173).
            guards: [{ refKey: canonicalJson(record.ref as unknown as JsonValue), expectedRevision: null },
              ...(facts.sendBackGuard === null ? [] : [facts.sendBackGuard])],
            claims: [],
            events: [taskNodeCommittedCodec.encode(event)],
          };
        },
        result: {
          eventType: 'TaskNodeCommitted',
          schemaVersion: 1,
          decode: taskNodeCommittedCodec.decode,
          validate: decoded => decoded.result.requestId === write.requestId
            && decoded.result.ref.goalId === goalRef.goalId && decoded.result.ref.taskId === taskRef.taskId
            ? null : 'the event records another node review',
          project: decoded => decoded.result,
        },
      });
    if (result.status === 'committed') return result;
    if (result.status === 'refused') return result.refusal;
    return rejectedWithNonEmptyCurrent(result.code, result.reason, result.current);
  }

  /** NR-09 steps 3–9: the state reads and guards of a write that has not committed yet. */
  async function readFresh(
    ctx: CoreCallContext, requestId: string, actor: TaskNodeCommitV1['reviewedBy'], workspace: WorkspaceRef,
    input: CommitNodeInput, pins: { goal: number; reduction: number },
  ): Promise<Extract<CommitFacts, { kind: 'fresh' }> | CoreRejection> {
    const { goalRef, taskRef, decision, reviewed } = input;
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    const goal = window.goal;
    if (goal.workspaceRef.workspaceId !== workspace.workspaceId) return rejected('forbidden', 'the Goal belongs to another workspace');
    const plan = window.plan;
    const task = plan?.tasks.find(candidate => candidate.taskId === taskRef.taskId);
    if (plan === null || task === undefined) return rejected('invalid', "the Task is not in the Goal's active Plan");
    const facts = await readCanonicalTaskFacts(records, goalRef, plan, task.taskId);
    if (facts.status !== 'ready') return facts;
    const state = facts.value.byTaskId.get(task.taskId)!;
    // 121-173: checked before any git: the version the person read was sent back meanwhile.
    const fence = sendBackFenceOf(facts.value, task.taskId, pins.reduction);
    if ('status' in fence) return fence;
    const executed = await readExecuted(ctx, goalRef);
    if (!Array.isArray(executed)) return executed;
    const node = taskNodeFilesOf(new Set((facts.value.runsByTaskId.get(task.taskId) ?? []).map(run => run.ref.runId)),
      executed);
    const notReviewed = nodeReviewProblem({ ...nodeReviewFactsOf(goal, task, state, facts.value),
      hasFiles: node.files.length > 0 });
    if (notReviewed !== null) return rejected('invalid', notReviewed);
    const reductionRevision = state.reductionRevision!;
    const existing = await readOwnerRecord({ store: records,
      refKey: canonicalJson(taskNodeCommitRefOf(goalRef, task.taskId, reductionRevision) as unknown as JsonValue),
      decode: taskNodeCommitCodec.decode,
      readError: reason => rejected('unavailable', `the node review could not be read: ${reason}`) });
    // Mirrors the one-time delivery acceptance: a node's review fact is written once.
    if (existing.ok) return rejected('invalid', 'the node was already reviewed');
    if ('rejection' in existing) return existing.rejection;
    const moved = nodePinConflict(goalRef, goal.revision, reductionRefOf(goalRef, task.taskId), reductionRevision, pins);
    if (moved !== null) return moved;
    const paths = node.files.map(file => file.path);
    const current = await deps.workspace.readTaskNodeBlobs({ workspace: goal.workspaceRef, paths });
    if (current.status !== 'ready') return current;
    const stale = reviewedContentProblem(current.value, reviewed);
    if (stale !== null) return rejected('source_stale', stale);
    const differs = await deps.workspace.hasTaskNodeChanges({ workspace: goal.workspaceRef, paths });
    if (differs.status !== 'ready') return differs;
    // N3: a node whose files still differ from HEAD is committed; one whose files no longer differ is acknowledged.
    if (decision === 'commit' && !differs.value) {
      return rejected('source_stale', "the node's files no longer differ from HEAD; re-read the node and acknowledge it");
    }
    if (decision === 'acknowledge' && differs.value) {
      return rejected('source_stale', "the node's files still differ from HEAD; re-read the node and commit it");
    }
    const blobs = new Map(current.value.map(entry => [entry.path, entry.blob]));
    return { kind: 'fresh', workspace: goal.workspaceRef, paths, sendBackGuard: fence.guard, draft: { goalRef, taskId: task.taskId,
      reductionRevision, planRef: plan.ref, planRevision: plan.planRevision, runRefs: node.runRefs,
      files: node.files.map(file => ({ ...file, blob: blobs.get(file.path) ?? null })),
      reviewedBy: actor, reviewedAt: deps.now(), requestId } };
  }

  /**
   * 121-173: the person sends the pending node back. The node must be the one waiting for the person (NR-01/02, the
   * cut point, no review fact) under the person's two pins; the requeue owner then writes the TaskRequeue covering the
   * selected Run with the person's reason, pinned to the Goal and that Run, and guards the absent review fact in the
   * same commit. Nothing touches the work tree.
   */
  async function reworkNode(ctx: CoreCallContext, request: Parameters<TaskNodeCommitPort['reworkNode']>[1]):
    ReturnType<TaskNodeCommitPort['reworkNode']> {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    const write = isolateWrite(request);
    if (!write.ok) return write.rejection;
    const { scope, actor } = owned;
    // Product rule (121-45, 121-173): only the person reviews a node; an automation never sends one back.
    const notOperator = operatorProblem(actor, deps.operatorActor, 'send a node back');
    if (notOperator !== null) return notOperator;
    const shapeProblem = checkShape(ReworkNodeInputShape, write.input, 'stored');
    if (shapeProblem !== null) return rejected('invalid', shapeProblem);
    const { goalRef, taskRef, reason } = write.input;
    const targetProblem = nodeTargetProblem(scope, goalRef, taskRef);
    if (targetProblem !== null) return targetProblem;
    const reductionRef = reductionRefOf(goalRef, taskRef.taskId);
    const pins = nodeCommitPins(write.expected, goalRef, reductionRef);
    if ('status' in pins) return pins;
    const keys = commandKeys({ operation: REWORK_OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal: { kind: actor.kind, id: actor.id }, commandId: write.requestId,
      fingerprintInput: { goalRef, taskRef, reductionRevision: pins.reduction, reason,
        expected: write.expected } as unknown as JsonValue });
    // A send-back this request already committed replays its TaskRequeue; the node is no longer pending by then, so
    // the replay comes before any state read.
    const replay = async (): Promise<Awaited<ReturnType<TaskNodeCommitPort['reworkNode']>> | null> => {
      const lookup = await lookupCommittedReceipt(records, keys.identityKey, keys.fingerprint);
      if (lookup.status === 'missing') return null;
      if (lookup.status === 'conflict') return rejected('idempotency_conflict', lookup.reason);
      if (lookup.status !== 'found') return rejected('unavailable', lookup.reason);
      const replayed = await readCommittedEvent(records, lookup.receipt, { eventType: TASK_REQUEUED_EVENT_TYPE,
        schemaVersion: TASK_REWORK_EVENT_SCHEMA_VERSION, decode: taskRequeuedEventFromEvent });
      return replayed.status === 'ready'
        ? { status: 'committed', value: { kind: 'requeued', requeue: replayed.value.requeue }, replayed: true,
          cursor: lookup.receipt.cursor }
        : rejected('unavailable', `the node send-back cannot be replayed: ${replayed.reason}`);
    };
    const replayed = await replay();
    if (replayed !== null) return replayed;
    const ledger = await readNodeReviewLedger(ctx, goalRef);
    if (ledger.status === 'rejected') return ledger;
    if (ledger.status !== 'ready') {
      return rejected(ledger.status === 'not_found' ? 'not_found' : 'unavailable', 'the node review is not readable');
    }
    const plan = ledger.value.plan;
    const task = plan?.tasks.find(candidate => candidate.taskId === taskRef.taskId);
    if (ledger.value.plan === null || task === undefined) return rejected('invalid', "the Task is not in the Goal's active Plan");
    const { goal, facts, nodeFiles, reviews } = ledger.value;
    // This version was already sent back: the same request that committed meanwhile replays; any other request is a
    // second send-back of it (coordination: one send-back per version).
    const sentBack = sentBackOf(facts, task.taskId, pins.reduction);
    if (sentBack !== undefined) {
      return await replay() ?? rejectedWithNonEmptyCurrent('revision_conflict', 'the node was already sent back',
        [{ ref: sentBack.ref, revision: sentBack.revision }]);
    }
    const state = facts.byTaskId.get(task.taskId)!;
    const notReviewed = nodeReviewProblem({ ...nodeReviewFactsOf(goal, task, state, facts),
      hasFiles: nodeFiles.get(task.taskId)!.files.length > 0 });
    if (notReviewed !== null) return rejected('invalid', notReviewed);
    const reductionRevision = state.reductionRevision!;
    if (reviews.has(`${task.taskId}:${reductionRevision}`)) return rejected('invalid', 'the node was already reviewed');
    const moved = nodePinConflict(goalRef, goal.revision, reductionRef, reductionRevision, pins);
    if (moved !== null) return moved;
    const run = (facts.runsByTaskId.get(task.taskId) ?? []).find(candidate => candidate.ref.runId === state.execution?.runId);
    if (run === undefined) return rejected('unavailable', "the node's selected Run is not readable");
    // The requeue owner pins the Goal and the selected Run; the reduction is held by its own window's guard.
    const requeued = await deps.requeue.requeueForNodeReview(ctx, {
      input: { taskRef, afterRunRef: run.ref, reason },
      meta: { requestId: write.requestId,
        expected: [{ ref: goalRef, revision: pins.goal }, { ref: run.ref, revision: run.revision }] },
    }, { reductionRevision: pins.reduction, identityKey: keys.identityKey, fingerprint: keys.fingerprint });
    // NR-B r2-6: a refusal may be a race lost to this same request (two copies that both missed the receipt above):
    // the receipt read again decides it, so the same body replays and another is `idempotency_conflict`; only an
    // identity that never committed keeps the refusal.
    if (requeued.status !== 'rejected') return requeued;
    return await replay() ?? requeued;
  }

  async function recordNodeReviewDraft(ctx: CoreCallContext,
    input: Parameters<TaskNodeCommitPort['recordNodeReviewDraft']>[1]):
    ReturnType<TaskNodeCommitPort['recordNodeReviewDraft']> {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    const { scope, actor } = owned;
    const { goalRef, taskId, reductionRevision, asked } = input;
    if (goalRef.projectId !== scope.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    const result = await executeWriteCommand<TaskNodeReviewDraftV1, TaskNodeReviewDraftV1, never,
      TaskNodeReviewDraftRecordedEventV1, TaskNodeReviewDraftV1>(records, {
      operation: DRAFT_OPERATION,
      scope: { projectId: scope.projectId, workspaceId: scope.workspaceId },
      principal: { kind: actor.kind, id: actor.id },
      commandId: nodeReviewDraftCommandId(goalRef.goalId, taskId, reductionRevision),
      fingerprintInput: { goalRef, taskId, reductionRevision, asked } as unknown as JsonValue,
      read: async () => ({ status: 'ready', facts: newTaskNodeReviewDraft({ goalRef, taskId, reductionRevision, asked,
        requestedBy: actor, requestedAt: deps.now() }) }),
      decide: draft => ({ decision: draft }),
      build: (draft, built) => ({
        records: [taskNodeReviewDraftCodec.encode(draft)],
        // The node's one ask: a second record of the same (Task, reduction revision) conflicts.
        guards: [{ refKey: canonicalJson(draft.ref as unknown as JsonValue), expectedRevision: null }],
        claims: [],
        events: [taskNodeReviewDraftRecordedCodec.encode({ eventId: `${built.identityKey}:recorded`,
          eventType: 'TaskNodeReviewDraftRecorded', schemaVersion: 1, occurredAt: draft.requestedAt, result: draft })],
      }),
      result: {
        eventType: 'TaskNodeReviewDraftRecorded',
        schemaVersion: 1,
        decode: taskNodeReviewDraftRecordedCodec.decode,
        validate: decoded => decoded.result.ref.goalId === goalRef.goalId && decoded.result.ref.taskId === taskId
          && decoded.result.ref.reductionRevision === reductionRevision ? null : 'the event records another node draft',
        project: decoded => decoded.result,
      },
    });
    if (result.status === 'committed') return result;
    if (result.status === 'refused') return result.refusal;
    return rejectedWithNonEmptyCurrent(result.code, result.reason, result.current);
  }

  async function readNodeReviewDrafts(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readNodeReviewDrafts']> {
    const goalRef = input.goalRef;
    if (ctx.projectId !== goalRef.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    let batch;
    try {
      batch = await lookupAll(records, TASK_NODE_REVIEW_DRAFT_BY_GOAL_LOOKUP, [goalRef.projectId, goalRef.goalId]);
    } catch (failure) {
      return storeFailureToRejection(failure);
    }
    const drafts: TaskNodeReviewDraftV1[] = [];
    for (const encoded of batch.items) {
      const decoded = taskNodeReviewDraftCodec.decode(encoded);
      if (decoded.status !== 'decoded') return rejected('unavailable', `a node draft is not decodable: ${decoded.reason}`);
      drafts.push(decoded.value);
    }
    return { status: 'ready', value: drafts };
  }

  async function readNodeReviewDraftRecipient(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readNodeReviewDraftRecipient']> {
    const owned = bindTrustedContext(ctx);
    if (!owned.ok) return owned.rejection;
    if (input.goalRef.projectId !== owned.scope.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    return deps.duties.resolveDutyRecipient(ctx, { workspace: owned.scope, duty: 'secretary' });
  }

  async function readNodeReceipts(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readNodeReceipts']> {
    const goalRef = input.goalRef;
    if (ctx.projectId !== goalRef.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    if (window.goal.workspaceRef.workspaceId !== ctx.workspaceId) {
      return rejected('forbidden', 'the Goal belongs to another workspace');
    }
    const reviews = await readReviews(goalRef);
    if (!(reviews instanceof Map)) return reviews;
    const titles = new Map((window.plan?.tasks ?? []).map(task => [task.taskId, task.title]));
    const receipts: NodeReviewReceiptV1[] = [...reviews.values()].map(review => ({
      taskRef: { taskId: review.ref.taskId, title: titles.get(review.ref.taskId) ?? null },
      decision: review.review.kind,
      sha: review.review.kind === 'committed' ? review.review.sha : null,
      message: review.review.kind === 'committed' ? review.review.message : null,
      reviewedAt: review.reviewedAt, reviewedBy: { ...review.reviewedBy }, files: review.files.length,
    }));
    const order = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
    receipts.sort((left, right) => order(left.reviewedAt, right.reviewedAt)
      || order(left.taskRef.taskId, right.taskRef.taskId));
    return { status: 'ready', value: { receipts } };
  }

  /** The send-back fence of a commit that landed when its record did not: the Task read again in its active Plan. */
  async function recoveredSendBackFence(goalRef: GoalRef, draft: TaskNodeCommitDraftV1):
    Promise<{ guard: SendBackGuard } | CoreRejection> {
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    const plan = window.plan;
    if (plan === null || !plan.tasks.some(task => task.taskId === draft.taskId)) return { guard: null };
    const facts = await readCanonicalTaskFacts(records, goalRef, plan, draft.taskId);
    if (facts.status !== 'ready') return facts;
    return sendBackFenceOf(facts.value, draft.taskId, draft.reductionRevision);
  }

  return { readNodeRows, readPendingNodeReview, commitNode, reworkNode, recordNodeReviewDraft, readNodeReviewDrafts,
    readNodeReviewDraftRecipient, readNodeReceipts };
}

/**
 * 121-173: one version is either reviewed or sent back. A version already sent back refuses the review
 * (`revision_conflict` with that TaskRequeue); otherwise the review commit guards the selected Run's TaskRequeue as
 * read, which a later send-back of the version would write.
 */
function sendBackFenceOf(facts: CanonicalTaskFacts, taskId: string, reductionRevision: number):
  { guard: SendBackGuard } | CoreRejection {
  const sentBack = sentBackOf(facts, taskId, reductionRevision);
  if (sentBack !== undefined) {
    return rejectedWithNonEmptyCurrent('revision_conflict', 'the node was sent back from review',
      [{ ref: sentBack.ref, revision: sentBack.revision }]);
  }
  const execution = facts.byTaskId.get(taskId)?.execution ?? null;
  if (execution === null) return { guard: null };
  const refKey = taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: execution.projectId,
    goalId: execution.goalId, taskId, afterRunId: execution.runId });
  return { guard: facts.reworkGuards.find(guard => guard.refKey === refKey) ?? null };
}

/** 121-173: the person's send-back of this reduction revision of the Task, read in the same canonical window. */
function sentBackOf(facts: Pick<CanonicalTaskFacts, 'requeuesByTaskId'>, taskId: string, reductionRevision: number):
  TaskRequeueSnapshotV1 | undefined {
  return (facts.requeuesByTaskId.get(taskId) ?? []).find(requeue => sendsBack(requeue, reductionRevision));
}

function reductionRefOf(goalRef: GoalRef, taskId: string): TaskReductionRef {
  return { aggregateType: 'TaskReduction', projectId: goalRef.projectId, goalId: goalRef.goalId, taskId };
}

/** The node the person names belongs to this project and its Task to that Goal. */
function nodeTargetProblem(scope: { projectId: string }, goalRef: GoalRef, taskRef: { projectId: string; goalId: string }):
  CoreRejection | null {
  if (goalRef.projectId !== scope.projectId) return rejected('forbidden', 'the Goal belongs to another project');
  if (taskRef.projectId !== goalRef.projectId || taskRef.goalId !== goalRef.goalId) {
    return rejected('invalid', 'the Task belongs to another Goal');
  }
  return null;
}

/** NR-07: the person's Goal and TaskReduction pins against the revisions read now. */
function nodePinConflict(goalRef: GoalRef, goalRevision: number, reductionRef: TaskReductionRef,
  reductionRevision: number, pins: { goal: number; reduction: number }): CoreRejection | null {
  if (goalRevision !== pins.goal) {
    return rejectedWithNonEmptyCurrent('revision_conflict', 'the Goal revision changed since it was read',
      [{ ref: goalRef, revision: goalRevision }]);
  }
  if (reductionRevision !== pins.reduction) {
    return rejectedWithNonEmptyCurrent('revision_conflict', 'the TaskReduction changed since the caller read it',
      [{ ref: reductionRef, revision: reductionRevision }]);
  }
  return null;
}

/** The review rules' facts of one Task, except its files: the Goal's level and cut point and the applicable reduction. */
function nodeReviewFactsOf(goal: GoalSnapshot, task: PlanRevisionSnapshot['tasks'][number],
  state: CanonicalTaskState, facts: Pick<CanonicalTaskFacts, 'reductionsByTaskId'>):
  Omit<NodeReviewFactsV1, 'hasFiles'> {
  const reduction = state.reductionRevision === null ? undefined : facts.reductionsByTaskId.get(task.taskId);
  return { autonomy: goal.settings.autonomy, taskKind: task.taskKind, executionIntent: task.executionIntent,
    effectivePhase: state.effectivePhase, reductionRevision: state.reductionRevision,
    reducedAt: reduction?.reducedAt ?? null, nodeReviewSince: goal.settings.nodeReviewSince ?? null };
}

/** NR-06: `meta.expected` is exactly the Goal pin and the TaskReduction pin (revision 0 before any reduction). */
function nodeCommitPins(expected: readonly VersionPin[], goalRef: GoalRef, reductionRef: TaskReductionRef):
  { goal: number; reduction: number } | CoreRejection {
  const goal = pinRevision(expected, goalRef);
  const reduction = pinRevision(expected, reductionRef);
  if (expected.length !== 2 || goal === null || goal < 1 || reduction === null) {
    return rejected('invalid',
      'meta.expected must be exactly the Goal pin (a positive revision) and the TaskReduction pin (0 before any reduction)');
  }
  return { goal, reduction };
}
