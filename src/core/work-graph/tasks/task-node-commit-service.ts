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
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import { GoalRefShape, TaskTripleShape, id } from '../../../contracts/data-format-refs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type { TaskReductionRef } from '../../../contracts/reduction.js';
import {
  TASK_NODE_COMMIT_BY_GOAL_LOOKUP, type TaskNodeCommittedEventV1, type TaskNodeCommitV1,
} from '../../../contracts/task-node-commit.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { DecisionReadPort, GoalExecutedFilesPort } from '../model/decision-contracts.js';
import type {
  TaskNodeCommitPort, TaskNodeCommitWorkspacePort, TaskNodeReviewRowV1,
} from '../model/task-node-commit-contracts.js';
import { commandKeys, executeWriteCommand } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { taskNodeCommitCodec, taskNodeCommittedCodec } from '../persistence/task-node-commit-codecs.js';
import {
  nodeReviewProblem, reviewedContentProblem, taskAwaitsReview, taskNodeCommitOf, taskNodeCommitRefOf,
  taskNodeFilesOf, taskNodePending, type ExecutedFileV1, type TaskNodeCommitDraftV1,
} from '../state/task-node-commit.js';
import { bindTrustedContext, isolateWrite, operatorProblem } from './execution-entry-service.js';
import { readCanonicalTaskFacts, readGoalPlanWindow } from './plan-readers.js';
import { liveRunsOf } from './plan-service.js';
import { pinRevision } from './revision-guard.js';

const OPERATION = 'node-commit';

export type TaskNodeCommitServiceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  executedFiles: GoalExecutedFilesPort;
  /** E3-8's per-file conflict read (NR-21): only its cards' file objects mark a shared path. */
  conflicts: Pick<DecisionReadPort, 'queryGoalConflicts'>;
  workspace: TaskNodeCommitWorkspacePort;
  operatorActor?: { kind: 'human' | 'system'; id: string };
  now(): string;
};

type CommitNodeInput = Parameters<TaskNodeCommitPort['commitNode']>[1]['input'];

/** The person's write as it arrives; refs and the reviewed list are checked whole before any read. */
const CommitNodeInputShape = defineShape({ name: 'nodes/commit input', fields: {
  goalRef: f.ref(GoalRefShape), taskRef: f.ref(TaskTripleShape), decision: f.enumOf(['commit', 'acknowledge']),
  message: f.nullable(f.string()), reviewed: f.array(f.object({ path: id, blob: f.nullable(id) })),
} });

type CommitFacts =
  /** NR-14: the git commit of this identity and fingerprint already landed; only the record is missing. */
  | { kind: 'recovered'; draft: TaskNodeCommitDraftV1; sha: string }
  | { kind: 'fresh'; draft: TaskNodeCommitDraftV1; workspace: WorkspaceRef; paths: string[] };

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

  async function readNodeRows(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    ReturnType<TaskNodeCommitPort['readNodeRows']> {
    const goalRef = input.goalRef;
    if (ctx.projectId !== goalRef.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return window;
    const goal = window.goal;
    if (goal.workspaceRef.workspaceId !== ctx.workspaceId) return rejected('forbidden', 'the Goal belongs to another workspace');
    const plan = window.plan;
    if (plan === null) return { status: 'ready', value: { rows: [], pending: [], liveWork: false } };
    const facts = await readCanonicalTaskFacts(records, goalRef, plan);
    if (facts.status !== 'ready') return facts;
    const executed = await readExecuted(ctx, goalRef);
    if (!Array.isArray(executed)) return executed;
    const reviews = await readReviews(goalRef);
    if (!(reviews instanceof Map)) return reviews;
    const nodeFiles = new Map(plan.tasks.map(task => [task.taskId, taskNodeFilesOf(
      new Set((facts.value.runsByTaskId.get(task.taskId) ?? []).map(run => run.ref.runId)), executed)]));
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
    let liveWork = liveRunsOf(plan, facts.value).length > 0;
    for (const task of plan.tasks) {
      const state = facts.value.byTaskId.get(task.taskId)!;
      const runs = facts.value.runsByTaskId.get(task.taskId) ?? [];
      const reduction = state.reductionRevision === null ? undefined : facts.value.reductionsByTaskId.get(task.taskId);
      const node = nodeFiles.get(task.taskId)!;
      const review = state.reductionRevision === null ? null
        : reviews.get(`${task.taskId}:${state.reductionRevision}`) ?? null;
      const pending = taskNodePending({ autonomy: goal.settings.autonomy, taskKind: task.taskKind,
        executionIntent: task.executionIntent, effectivePhase: state.effectivePhase,
        reductionRevision: state.reductionRevision, hasFiles: node.files.length > 0, reviewed: review !== null });
      liveWork ||= taskAwaitsReview({ taskKind: task.taskKind, effectivePhase: state.effectivePhase,
        round: facts.value.roundsByTaskId.get(task.taskId), unknownCallReview: state.unknownCallReview });
      rows.push({
        task: { taskId: task.taskId, title: task.title, taskKind: task.taskKind, requirementLevel: task.requirementLevel,
          disposition: task.disposition, phase: state.effectivePhase,
          ...(task.sizeClass === undefined ? {} : { sizeClass: task.sizeClass }) },
        reduction: reduction === undefined ? null
          : { revision: reduction.revision, phase: reduction.phase, reducedAt: reduction.reducedAt },
        runs: runs.map(run => ({ ...run.ref })),
        files: node.files.map(file => ({ ...file, blob: blobs.get(file.path) ?? null,
          sharedWithGoalRefs: shared.get(file.path) ?? [] })),
        review, pending,
      });
    }
    return { status: 'ready', value: { rows, pending: rows.filter(row => row.pending), liveWork } };
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
    if (goalRef.projectId !== scope.projectId) return rejected('forbidden', 'the Goal belongs to another project');
    if (taskRef.projectId !== goalRef.projectId || taskRef.goalId !== goalRef.goalId) {
      return rejected('invalid', 'the Task belongs to another Goal');
    }
    // NR-12: a commit records the person's own message; an acknowledgement makes no commit and carries none.
    if (decision === 'commit' && (message === null || message.trim() === '')) {
      return rejected('invalid', 'a node commit needs the commit message');
    }
    if (decision === 'acknowledge' && message !== null) {
      return rejected('invalid', 'an acknowledgement makes no commit and carries no message');
    }
    const pins = nodeCommitPins(write.expected, goalRef, { aggregateType: 'TaskReduction', projectId: goalRef.projectId,
      goalId: goalRef.goalId, taskId: taskRef.taskId });
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
            return { status: 'ready', facts: { kind: 'recovered', sha: found.value.sha,
              draft: JSON.parse(found.value.record) as TaskNodeCommitDraftV1 } };
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
            // The node's one review fact: a second write of the same (Task, reduction revision) conflicts.
            guards: [{ refKey: canonicalJson(record.ref as unknown as JsonValue), expectedRevision: null }],
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
    const executed = await readExecuted(ctx, goalRef);
    if (!Array.isArray(executed)) return executed;
    const node = taskNodeFilesOf(new Set((facts.value.runsByTaskId.get(task.taskId) ?? []).map(run => run.ref.runId)),
      executed);
    const notReviewed = nodeReviewProblem({ autonomy: goal.settings.autonomy, taskKind: task.taskKind,
      executionIntent: task.executionIntent, effectivePhase: state.effectivePhase,
      reductionRevision: state.reductionRevision, hasFiles: node.files.length > 0 });
    if (notReviewed !== null) return rejected('invalid', notReviewed);
    const reductionRevision = state.reductionRevision!;
    const existing = await readOwnerRecord({ store: records,
      refKey: canonicalJson(taskNodeCommitRefOf(goalRef, task.taskId, reductionRevision) as unknown as JsonValue),
      decode: taskNodeCommitCodec.decode,
      readError: reason => rejected('unavailable', `the node review could not be read: ${reason}`) });
    // Mirrors the one-time delivery acceptance: a node's review fact is written once.
    if (existing.ok) return rejected('invalid', 'the node was already reviewed');
    if ('rejection' in existing) return existing.rejection;
    if (goal.revision !== pins.goal) {
      return rejectedWithNonEmptyCurrent('revision_conflict', 'the Goal revision changed since it was read',
        [{ ref: goalRef, revision: goal.revision }]);
    }
    if (reductionRevision !== pins.reduction) {
      return rejectedWithNonEmptyCurrent('revision_conflict', 'the TaskReduction changed since the caller read it',
        [{ ref: { aggregateType: 'TaskReduction', projectId: goalRef.projectId, goalId: goalRef.goalId,
          taskId: task.taskId }, revision: reductionRevision }]);
    }
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
    return { kind: 'fresh', workspace: goal.workspaceRef, paths, draft: { goalRef, taskId: task.taskId,
      reductionRevision, planRef: plan.ref, planRevision: plan.planRevision, runRefs: node.runRefs,
      files: node.files.map(file => ({ ...file, blob: blobs.get(file.path) ?? null })),
      reviewedBy: actor, reviewedAt: deps.now(), requestId } };
  }

  return { readNodeRows, commitNode };
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
