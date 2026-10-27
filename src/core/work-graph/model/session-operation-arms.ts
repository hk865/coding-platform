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
  RunRefShape, SessionAggregateRefShape, SessionMessageRefShape, SessionRefShape, TaskTripleShape, WorkspaceScopeShape,
} from '../../../contracts/data-format-refs.js';
import { CORE_ERRORS } from '../../../contracts/core/results.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { PLATFORM_DUTIES } from '../../../contracts/platform-duty.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { sameRef } from '../state/ref-equality.js';

const HumanActorFields = { kind: f.literal('human'), id };
const SystemActorFields = { kind: f.literal('system'), id };
/** `ActorRef` (`src/contracts/command-event.ts`). */
export const ActorRefField = f.union('kind', {
  human: HumanActorFields, system: SystemActorFields,
  agent: { kind: f.literal('agent'), id, runRef: f.ref(RunRefShape) },
});
/** A saved trusted actor: an agent is never a command principal. */
const SavedActorField = f.union('kind', { human: HumanActorFields, system: SystemActorFields });
/** A work Run or a QueryRun. */
const ExecutionRefField = f.union('aggregateType', { Run: RunRefShape.fields, QueryRun: QueryRunRefShape.fields });
const NoteVersionField = f.object({ noteId: id, version: f.integer({ min: 1 }) });
const RoleSpecRevisionRefShape = defineShape({ name: 'RoleSpecRevisionRef', fields: {
  aggregateType: f.literal('RoleSpecRevision'), projectId: id, roleId: id, revision: f.integer({ min: 1 }),
} });
/** `SessionProvenanceV1` (`src/contracts/core/session.ts`). */
const SessionProvenanceField = f.union('kind', {
  new: { schemaVersion: f.literal(1), kind: f.literal('new') },
  continuation: { schemaVersion: f.literal(1), kind: f.literal('continuation'), from: f.ref(SessionRefShape),
    reason: f.enumOf(['interrupted', 'archived', 'damaged', 'role_mismatch'] as const), task: f.ref(TaskTripleShape) },
  handoff: { schemaVersion: f.literal(1), kind: f.literal('handoff'), from: f.ref(SessionRefShape) },
  readonly_copy: { schemaVersion: f.literal(1), kind: f.literal('readonly_copy'), from: f.ref(SessionRefShape),
    messageRef: f.ref(SessionMessageRefShape) },
});
/** `RoleConfigurationRef` (`src/contracts/core/identity.ts`). */
const RoleConfigurationField = f.union('kind', {
  role_spec: { kind: f.literal('role_spec'), pin: f.object({ ref: f.ref(RoleSpecRevisionRefShape), digest: id }) },
  legacy_template: { kind: f.literal('legacy_template'), templateId: id, templateRevision: id },
});
/** The exact `ensureLine` child input a resume replays; `W` cannot import `B`'s `LineCreationInput`. */
const HandoffSavedCreateInputField = f.object({
  commandId: id, duty: f.enumOf(PLATFORM_DUTIES), scope: f.object({ kind: f.literal('project') }), reason: id,
  provenance: SessionProvenanceField, roleConfiguration: RoleConfigurationField,
  replaces: f.nullable(f.ref(SessionRefShape)), parentOperation: f.nullable(f.ref(OperationRefShape)),
});
/** `RequestUnderstandingCommandV1` (`src/contracts/query-job.ts`); the operation replays it as saved. */
const RequestUnderstandingCommandField = f.object({
  kind: f.literal('request_understanding'), commandId: id, operation: f.ref(OperationRefShape),
  generation: f.integer({ min: 1 }), requestRoot: f.ref(QueryJobRefShape),
  goals: f.array(f.object({ goalRef: f.ref(GoalRefShape), pointer: f.ref(CurrentPointerRefShape),
    pointerRevision: f.integer({ min: 0 }) })),
  checkedRound: f.nullable(f.ref(QueryRunRefShape)),
  state: f.enumOf(['live', 'closed', 'consumed'] as const),
});
const WorkContextRefField = f.object({ aggregateType: f.literal('WorkContextBinding'), projectId: id, workspaceId: id,
  workId: id });
const ArchiveTaskChoiceField = f.object({
  target: f.union('kind', {
    task: { kind: f.literal('task'), ref: f.ref(TaskTripleShape) },
    work: { kind: f.literal('work'), ref: WorkContextRefField },
  }),
  disposition: f.union('kind', {
    drop: { kind: f.literal('drop') },
    transfer: { kind: f.literal('transfer'), to: f.ref(SessionRefShape) },
  }),
});
const ArchiveWaitChoiceField = f.union('kind', {
  cancel: { kind: f.literal('cancel'), runRef: f.ref(RunRefShape), messageRef: f.ref(SessionMessageRefShape) },
  transfer: { kind: f.literal('transfer'), runRef: f.ref(RunRefShape), messageRef: f.ref(SessionMessageRefShape),
    to: f.ref(SessionRefShape) },
});
const SessionArchiveConditionField = f.union('kind', {
  secretary_handoff: { kind: f.literal('secretary_handoff'), operation: f.ref(OperationRefShape) },
});
const ARCHIVE_MODES = ['operator', 'executor_idle', 'retired', 'answered_copy', 'handoff_complete',
  'secretary_handoff'] as const;
/**
 * The exact `GraphWrite<RequestSessionArchiveInput>` a resume replays: its
 * original request id and the Session pin the archive owner reads. The
 * condition member is the archive owner's and absent until it lands.
 */
const SessionArchiveGraphWriteField = f.object({
  input: f.object({
    sessionRef: f.ref(SessionRefShape), reason: id, tasks: f.array(ArchiveTaskChoiceField),
    wait: f.nullable(ArchiveWaitChoiceField),
    confirmUnknownStopped: f.optional(f.boolean()),
    mode: f.optional(f.enumOf(ARCHIVE_MODES)),
    condition: f.optional(f.nullable(SessionArchiveConditionField)),
  }),
  meta: f.object({
    requestId: id,
    expected: f.array(f.object({ ref: f.ref(SessionAggregateRefShape), revision: f.revision({ min: 0 }) })),
  }),
});
/** The source's archive request: its id, the exact saved write and, once sent, its receipt. */
const ArchiveRequestField = f.nullable(f.object({
  requestId: id,
  savedInput: f.nullable(SessionArchiveGraphWriteField),
  receipt: f.nullable(f.object({ identityKey: id, fingerprint: id })),
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

/**
 * A step the operation already reached keeps its original input: a record whose saved position reads `null` cannot be
 * recovered, and rebuilding one would replay a command the operation never made. An `existing` target's assignment
 * saves no create input, so it is not a reached create step.
 */
export function handoffReachedInputProblem(action: HandoffActionV1): string | null {
  const { input, progress } = action;
  for (const [index, assignment] of progress.assignments.entries()) {
    if (input.assignments[index]?.target.kind !== 'create') continue;
    if ((assignment.successor !== null || assignment.createOperation !== null) && assignment.createInput === null) {
      return `HandoffAction.progress.assignments[${index}] is reached but has no saved create input`;
    }
  }
  const round = progress.understanding.findIndex(entry => entry.command === null);
  if (round >= 0) return `HandoffAction.progress.understanding[${round}] has no saved command`;
  return archiveSavedInputProblem('HandoffAction', progress.archiveRequest);
}

/**
 * An archive request the operation already saved keeps its exact `GraphWrite`; without it a recovery would rebuild a
 * request the operation never made. The handoff and the manual archive both run this one rule.
 */
export function archiveSavedInputProblem(arm: 'HandoffAction' | 'SecretaryArchiveAction',
  archive: { savedInput: unknown | null } | null): string | null {
  return archive === null || archive.savedInput !== null ? null
    : `${arm}.progress.archiveRequest has no saved input`;
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
      // Saved before the create child is called; an old record reads null.
      createInput: f.nullable(HandoffSavedCreateInputField),
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
      // Saved before the understanding append; an old entry reads null.
      command: f.nullable(RequestUnderstandingCommandField),
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
    // The trusted actor saved at accept; an old operation reads null.
    actor: f.nullable(SavedActorField),
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

/**
 * The one compatible read for the three saved positions and the archive actor: a
 * record or event written before a field existed reads it as `null`. Pure;
 * returns the input unchanged when there is nothing to upgrade.
 */
export function upgradeSessionOperationActionV1(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value['kind'] === 'handoff') {
    const progress = value['progress'];
    if (!isRecord(progress)) return value;
    let changed = false;
    const assignments = Array.isArray(progress['assignments'])
      ? progress['assignments'].map((entry) => {
          if (!isRecord(entry) || Object.hasOwn(entry, 'createInput')) return entry;
          changed = true;
          return { ...entry, createInput: null };
        })
      : progress['assignments'];
    const understanding = Array.isArray(progress['understanding'])
      ? progress['understanding'].map((entry) => {
          if (!isRecord(entry) || Object.hasOwn(entry, 'command')) return entry;
          changed = true;
          return { ...entry, command: null };
        })
      : progress['understanding'];
    const archive = progress['archiveRequest'];
    const archiveRequest = isRecord(archive) && !Object.hasOwn(archive, 'savedInput')
      ? (() => { changed = true; return { ...archive, savedInput: null }; })()
      : archive;
    if (!changed) return value;
    return { ...value, progress: { ...progress, assignments, understanding, archiveRequest } };
  }
  if (value['kind'] === 'secretary_archive') {
    let changed = false;
    const input = value['input'];
    const nextInput = isRecord(input) && !Object.hasOwn(input, 'actor')
      ? (() => { changed = true; return { ...input, actor: null }; })() : input;
    const progress = value['progress'];
    const archive = isRecord(progress) ? progress['archiveRequest'] : null;
    const nextArchive = isRecord(archive) && !Object.hasOwn(archive, 'savedInput')
      ? (() => { changed = true; return { ...archive, savedInput: null }; })() : archive;
    if (!changed) return value;
    return { ...value, input: nextInput,
      ...(isRecord(progress) ? { progress: { ...progress, archiveRequest: nextArchive } } : {}) };
  }
  return value;
}
