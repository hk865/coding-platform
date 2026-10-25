/**
 * The two `CoreOperation` arms beside the hand-written create arm: a handoff of a line's work to successors, and the
 * manual archive of a secretary with a choice per open request. Each is a field table
 * (`src/contracts/data-format.ts`) the operation codec dispatches to by `action.kind`; its rules run after its fields.
 *
 * Every field is required; a step not reached yet is `null` (an empty list for a list). `input` is the accepted
 * command and never changes; `progress` is written only by `state/session-handoff.ts` and the later advance steps.
 */
import { defineShape, f, type InferShape } from '../../../contracts/data-format.js';
import {
  CurrentPointerRefShape, GoalRefShape, id, OperationRefShape, QueryJobAnswerRefShape, QueryJobRefShape, QueryRunRefShape,
  RunRefShape, SessionRefShape, TaskTripleShape, WorkspaceScopeShape,
} from '../../../contracts/data-format-refs.js';
import { CORE_ERRORS } from '../../../contracts/core/results.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { PLATFORM_DUTIES } from '../../../contracts/platform-duty.js';
import { sameRef } from '../state/ref-equality.js';

/** `ActorRef` (`src/contracts/command-event.ts`). */
const ActorRefField = f.union('kind', {
  human: { kind: f.literal('human'), id }, system: { kind: f.literal('system'), id },
  agent: { kind: f.literal('agent'), id, runRef: f.ref(RunRefShape) },
});
/** A work Run or a QueryRun. */
const ExecutionRefField = f.union('aggregateType', { Run: RunRefShape.fields, QueryRun: QueryRunRefShape.fields });
const NoteVersionField = f.object({ noteId: id, version: f.integer({ min: 1 }) });
/** The source's archive request: its id and, once sent, its receipt. */
const ArchiveRequestField = f.nullable(f.object({
  requestId: id, receipt: f.nullable(f.object({ identityKey: id, fingerprint: id })),
}));
/** The last refusal a step met, kept so the next advance can read why it stopped. */
const LastRefusalField = <const S extends readonly [string, ...string[]]>(stages: S) => f.nullable(f.object({
  stage: f.enumOf(stages), code: f.enumOf(CORE_ERRORS), reason: id, at: f.isoTime(),
}));

/** No task in two assignments; an `existing` target is in the source's project and is not the source. */
function handoffAssignmentProblem(value: unknown): string | null {
  const { input } = value as HandoffActionV1;
  const seen = new Set<string>();
  for (const [index, assignment] of input.assignments.entries()) {
    for (const [taskIndex, task] of assignment.tasks.entries()) {
      const key = canonicalKey(task);
      if (seen.has(key)) return `HandoffAction.input.assignments[${index}].tasks[${taskIndex}] repeats a task of the handoff`;
      seen.add(key);
    }
    const target = assignment.target;
    if (target.kind !== 'existing') continue;
    if (target.session.projectId !== input.source.projectId) {
      return `HandoffAction.input.assignments[${index}].target belongs to another project`;
    }
    if (sameRef(target.session, input.source)) return `HandoffAction.input.assignments[${index}].target is the source Session`;
  }
  return null;
}

/**
 * Progress follows the input: one assignment per input assignment, one transfer per task in the task order; a receipt
 * (a transfer's or a routed root's) only after its saved input.
 */
function handoffReceiptProblem(value: unknown): string | null {
  const { input, progress } = value as HandoffActionV1;
  if (progress.assignments.length !== input.assignments.length) {
    return 'HandoffAction.progress.assignments does not match input.assignments';
  }
  for (const [index, assignment] of progress.assignments.entries()) {
    const tasks = input.assignments[index]!.tasks;
    if (assignment.transfers.length !== tasks.length
      || assignment.transfers.some((transfer, taskIndex) => canonicalKey(transfer.task) !== canonicalKey(tasks[taskIndex]))) {
      return `HandoffAction.progress.assignments[${index}].transfers does not match the assignment's tasks`;
    }
    const early = assignment.transfers.findIndex(transfer => transfer.receipt !== null && transfer.input === null);
    if (early >= 0) return `HandoffAction.progress.assignments[${index}].transfers[${early}].receipt has no saved input`;
  }
  const early = progress.routing?.roots.findIndex(root => root.receipt !== null && root.input === null) ?? -1;
  return early >= 0 ? `HandoffAction.progress.routing.roots[${early}].receipt has no saved input` : null;
}

/** No request root chosen twice; a choice never routes to the source. */
function archiveChoiceProblem(value: unknown): string | null {
  const { input } = value as SecretaryArchiveActionV1;
  const seen = new Set<string>();
  for (const [index, choice] of input.choices.entries()) {
    const key = canonicalKey(choice.requestRoot);
    if (seen.has(key)) return `SecretaryArchiveAction.input.choices[${index}].requestRoot repeats a request`;
    seen.add(key);
    if (choice.to !== null && sameRef(choice.to, input.source)) {
      return `SecretaryArchiveAction.input.choices[${index}].to is the source Session`;
    }
  }
  return null;
}

/** One item per choice, same roots in the same order; an outcome only after its saved input. */
function archiveItemsProblem(value: unknown): string | null {
  const { input, progress } = value as SecretaryArchiveActionV1;
  if (progress.items.length !== input.choices.length
    || progress.items.some((item, index) => canonicalKey(item.requestRoot) !== canonicalKey(input.choices[index]!.requestRoot))) {
    return 'SecretaryArchiveAction.progress.items does not match input.choices';
  }
  const early = progress.items.findIndex(item => item.outcome !== null && item.input === null);
  return early >= 0 ? `SecretaryArchiveAction.progress.items[${early}].outcome has no saved input` : null;
}

/** The handoff's steps, in the order an advance runs them. */
export const HANDOFF_STAGES = ['accepted', 'understanding', 'fence', 'wait_writer', 'recheck', 'successor', 'transfer',
  'routing', 'archive', 'notice', 'finished'] as const;

export const HandoffActionShape = defineShape({ name: 'HandoffAction', fields: {
  kind: f.literal('handoff'),
  input: f.object({
    workspace: f.ref(WorkspaceScopeShape),
    source: f.ref(SessionRefShape),
    trigger: f.enumOf(['too_long', 'manual'] as const),
    actor: ActorRefField,
    assignments: f.array(f.object({
      target: f.union('kind', {
        create: { kind: f.literal('create'), duty: f.enumOf(PLATFORM_DUTIES) },
        existing: { kind: f.literal('existing'), session: f.ref(SessionRefShape) },
      }),
      tasks: f.array(f.ref(TaskTripleShape)),
    }), { min: 1 }),
    commandId: id,
    // The write command's input fingerprint.
    fingerprint: f.sha256(),
  }),
  progress: f.object({
    stage: f.enumOf(HANDOFF_STAGES),
    advanceGeneration: f.integer({ min: 1 }),
    fence: f.nullable(f.object({ claimKey: id, state: f.enumOf(['held', 'released'] as const), changedAt: f.isoTime() })),
    stoppedWriter: f.nullable(f.object({ lastExecution: f.nullable(ExecutionRefField), observedAt: f.isoTime() })),
    // One per input assignment, in the same order.
    assignments: f.array(f.object({
      successor: f.nullable(f.ref(SessionRefShape)),
      createOperation: f.nullable(f.ref(OperationRefShape)),
      // One per task of the assignment, in the same order.
      transfers: f.array(f.object({
        task: f.ref(TaskTripleShape),
        // Saved before the first transfer call.
        input: f.nullable(f.object({
          requestId: id,
          from: f.ref(SessionRefShape), to: f.ref(SessionRefShape),
          // The revisions of the four pinned records; their refs follow from `from`, `to` and the task.
          expected: f.object({ fromSession: f.integer({ min: 0 }), toSession: f.integer({ min: 0 }),
            sourceLink: f.integer({ min: 0 }), destinationLink: f.integer({ min: 0 }) }),
        })),
        receipt: f.nullable(f.object({ cursor: f.cursor('ledgerNonZero') })),
      })),
    })),
    // A secretary source only.
    coverage: f.nullable(f.object({
      horizon: f.nullable(f.cursor('ledger')), activityRevision: f.integer({ min: 0 }),
      lastRound: f.nullable(f.ref(QueryRunRefShape)),
      goals: f.array(f.object({ goalRef: f.ref(GoalRefShape), pointer: f.ref(CurrentPointerRefShape), pointerRevision: f.integer({ min: 0 }) })),
    })),
    // One entry per understanding generation.
    understanding: f.array(f.object({
      generation: f.integer({ min: 1 }), requestRoot: f.ref(QueryJobRefShape), round: f.nullable(f.ref(QueryJobRefShape)),
    })),
    brief: f.nullable(f.object({
      requests: f.array(f.object({ requestRoot: f.ref(QueryJobRefShape), lastAnswer: f.nullable(f.ref(QueryJobAnswerRefShape)) })),
      goals: f.array(f.object({ goalRef: f.ref(GoalRefShape), written: f.nullable(NoteVersionField), current: f.nullable(NoteVersionField) })),
      ready: f.boolean(), consumedBy: f.nullable(f.ref(QueryRunRefShape)),
    })),
    routing: f.nullable(f.object({
      closed: f.boolean(), horizon: f.nullable(f.cursor('ledger')),
      roots: f.array(f.object({
        requestRoot: f.ref(QueryJobRefShape),
        input: f.nullable(f.object({ operationId: id, to: f.ref(SessionRefShape), expectedSource: f.ref(SessionRefShape) })),
        receipt: f.nullable(f.object({ routingRound: f.ref(QueryJobRefShape), cursor: f.cursor('ledgerNonZero') })),
        skipped: f.nullable(f.literal('owner_changed')),
      })),
    })),
    archiveRequest: ArchiveRequestField,
    noticeItemKey: f.nullable(id),
    lastRefusal: LastRefusalField(HANDOFF_STAGES),
  }),
}, rules: [handoffAssignmentProblem, handoffReceiptProblem] });

/** The archive's steps, in the order an advance runs them. */
export const SECRETARY_ARCHIVE_STAGES = ['accepted', 'items', 'archive', 'finished'] as const;
export const SecretaryArchiveActionShape = defineShape({ name: 'SecretaryArchiveAction', fields: {
  kind: f.literal('secretary_archive'),
  input: f.object({
    source: f.ref(SessionRefShape),
    choices: f.array(f.object({ requestRoot: f.ref(QueryJobRefShape), to: f.nullable(f.ref(SessionRefShape)) }), { min: 1 }),
    commandId: id, fingerprint: f.sha256(),
  }),
  progress: f.object({
    stage: f.enumOf(SECRETARY_ARCHIVE_STAGES),
    advanceGeneration: f.integer({ min: 1 }),
    // One per choice, in the same order.
    items: f.array(f.object({
      requestRoot: f.ref(QueryJobRefShape),
      input: f.nullable(f.object({ operationId: id, to: f.nullable(f.ref(SessionRefShape)), expectedSource: f.ref(SessionRefShape) })),
      // An owner that changed is a `failed` item with its reason.
      outcome: f.nullable(f.enumOf(['routed', 'dropped', 'failed'] as const)),
      routingRound: f.nullable(f.ref(QueryJobRefShape)), reason: f.nullable(id), cursor: f.nullable(f.cursor('ledgerNonZero')),
    })),
    archiveRequest: ArchiveRequestField,
    lastRefusal: LastRefusalField(SECRETARY_ARCHIVE_STAGES),
  }),
}, rules: [archiveChoiceProblem, archiveItemsProblem] });
export type HandoffActionV1 = InferShape<(typeof HandoffActionShape)['fields']>;
export type SecretaryArchiveActionV1 = InferShape<(typeof SecretaryArchiveActionShape)['fields']>;
