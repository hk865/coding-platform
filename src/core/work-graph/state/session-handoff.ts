/**
 * The pure admission of a handoff operation and of a secretary archive operation, and the accepted record each starts
 * from. The owner reads the facts and writes the record in one commit; nothing here reads, mints an id or reads a
 * clock. A refusal writes nothing.
 *
 * A handoff is refused at the first failing step: the caller (a `manual` handoff is the Host person's, a `too_long`
 * one the trusted Host system's), the scope, the shape of the built action, the source (in the workspace, not
 * archived, not a read-only copy) and each `existing` target (in the workspace), the duty (every target's duty is the
 * source's), and unfinished work (another handoff or archive of the same source). The owner runs the first three
 * steps before it reads (`read: null`), then all of them on its facts.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError } from '../../../contracts/core/results.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import type { QueryJobRef, QueryRunRef, RequestUnderstandingCommandV1 } from '../../../contracts/query-job.js';
import { sameRef } from './ref-equality.js';
import { reject, type Rejected } from './transition.js';

/** The caller as the owner classified its principal. */
export type OperationCallerV1 = 'host_human' | 'host_system' | 'not_host';
/** A Session the operation names, as the owner read it in the call's workspace; `unknown` is a duty that did not resolve. */
export type OperationSessionFactV1 =
  | { kind: 'missing' }
  | { kind: 'present'; archived: boolean; readonlyCopy: boolean; duty: PlatformDutyV1 | 'unknown' };
export type HandoffAdmissionFactsV1 = {
  caller: OperationCallerV1;
  /** As the caller sent it; a value the shape does not know is the shape step's. */
  trigger: unknown;
  inScope: boolean;
  /** The field-table problem of the built action, or `null`. */
  shapeProblem: string | null;
  read: null | {
    source: OperationSessionFactV1;
    /** One per assignment, in its order. */
    targets: readonly ({ kind: 'create'; duty: PlatformDutyV1 } | { kind: 'existing'; session: OperationSessionFactV1 })[];
    /** The unfinished handoff and archive operations of the same source. */
    unfinished: readonly VersionPin[];
  };
};
export type SecretaryArchiveAdmissionFactsV1 = {
  caller: OperationCallerV1;
  inScope: boolean;
  shapeProblem: string | null;
  read: null | { source: OperationSessionFactV1; unfinished: readonly VersionPin[] };
};
type Refusal = Extract<Rejected, { ok: false }>;
/** A refusal; `busy` names the unfinished operations. */
export type OperationAdmissionV1 = { ok: true } | (Refusal & { current?: VersionPin[] });

const PASS: OperationAdmissionV1 = { ok: true };

function guardRefusal(code: CoreError, detail: string): Refusal {
  return reject('guard_failed', code, detail) as Refusal;
}

function callerRefusal(trigger: unknown, caller: OperationCallerV1): Refusal | null {
  if (trigger === 'manual') return caller === 'host_human' ? null : guardRefusal('forbidden', 'a manual handoff needs the Host person');
  if (trigger === 'too_long') {
    return caller === 'host_system' ? null : guardRefusal('forbidden', 'a too_long handoff needs the trusted Host system');
  }
  return caller === 'not_host' ? guardRefusal('forbidden', 'a handoff needs a Host caller') : null;
}

/** The source's duty when it may hand over or be archived, else the refusal. */
function sourceRefusal(source: OperationSessionFactV1): Refusal | { duty: PlatformDutyV1 | 'unknown' } {
  if (source.kind === 'missing') return guardRefusal('not_found', "the source Session is not in the call's workspace");
  if (source.archived) return guardRefusal('invalid', 'the source Session is archived');
  return source.readonlyCopy ? guardRefusal('invalid', 'the source Session is a read-only copy') : { duty: source.duty };
}

function busyRefusal(unfinished: readonly VersionPin[]): OperationAdmissionV1 {
  if (unfinished.length === 0) return PASS;
  return { ...guardRefusal('busy', 'the source Session has an unfinished handoff or archive operation'), current: [...unfinished] };
}

export function admitHandoff(facts: HandoffAdmissionFactsV1): OperationAdmissionV1 {
  const early = callerRefusal(facts.trigger, facts.caller)
    ?? (facts.inScope ? null : guardRefusal('forbidden', "the handoff workspace is not the call's workspace"))
    ?? (facts.shapeProblem === null ? null : guardRefusal('invalid', facts.shapeProblem));
  if (early !== null) return early;
  if (facts.read === null) return PASS;
  const { targets, unfinished } = facts.read;
  const source = sourceRefusal(facts.read.source);
  if ('ok' in source) return source;
  const missing = targets.findIndex(target => target.kind === 'existing' && target.session.kind === 'missing');
  if (missing >= 0) return guardRefusal('not_found', `assignments[${missing}].target is not a Session of the workspace`);
  if (source.duty === 'unknown') return guardRefusal('invalid', 'the source Session has no known duty, so no target can share it');
  for (const [index, target] of targets.entries()) {
    const duty = target.kind === 'create' ? target.duty : target.session.kind === 'present' ? target.session.duty : 'unknown';
    if (duty === 'unknown') return guardRefusal('invalid', `assignments[${index}].target has no known duty`);
    if (duty !== source.duty) {
      return guardRefusal('invalid', `assignments[${index}].target's duty ${duty} is not the source Session's duty ${source.duty}`);
    }
  }
  return busyRefusal(unfinished);
}

/** The accepted handoff: revision 1, every step ahead `null` (`[]` for a list), one transfer per task. */
export function newHandoffOperationRecord<Ref, Input extends {
  workspace: { workspaceId: string }; assignments: readonly { tasks: readonly unknown[] }[];
}>(facts: { ref: Ref; at: string; input: Input }) {
  type Task = Input['assignments'][number]['tasks'][number];
  return {
    ref: facts.ref, revision: 1, workspaceId: facts.input.workspace.workspaceId,
    action: {
      kind: 'handoff' as const, input: facts.input,
      progress: {
        stage: 'accepted' as const, advanceGeneration: 1, fence: null, stoppedWriter: null,
        assignments: facts.input.assignments.map(assignment => ({ successor: null, createOperation: null,
          createInput: null,
          transfers: assignment.tasks.map(task => ({ task: task as Task, input: null, receipt: null })) })),
        coverage: null, understanding: [], brief: null, routing: null, archiveRequest: null, noticeItemKey: null,
        lastRefusal: null,
      },
    },
    phase: 'accepted' as const, requestedAt: facts.at, updatedAt: facts.at, observation: null, failure: null,
  };
}

/**
 * A secretary archive is the Host person's, in the call's workspace, of a secretary source that is in the workspace,
 * not archived, not a read-only copy, and has no unfinished handoff or archive.
 */
export function admitSecretaryArchive(facts: SecretaryArchiveAdmissionFactsV1): OperationAdmissionV1 {
  const early = (facts.caller === 'host_human' ? null : guardRefusal('forbidden', 'a secretary archive needs the Host person'))
    ?? (facts.inScope ? null : guardRefusal('forbidden', "the archive workspace is not the call's workspace"))
    ?? (facts.shapeProblem === null ? null : guardRefusal('invalid', facts.shapeProblem));
  if (early !== null) return early;
  if (facts.read === null) return PASS;
  const source = sourceRefusal(facts.read.source);
  if ('ok' in source) return source;
  if (source.duty !== 'secretary') return guardRefusal('invalid', `the source Session's duty ${source.duty} is not secretary`);
  return busyRefusal(facts.read.unfinished);
}

/** The accepted archive: revision 1, one item per choice with every step ahead `null`. */
export function newSecretaryArchiveOperationRecord<Ref, Input extends {
  choices: readonly { requestRoot: unknown }[];
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
}>(facts: { ref: Ref; workspaceId: string; at: string; input: Input }) {
  type Root = Input['choices'][number]['requestRoot'];
  return {
    ref: facts.ref, revision: 1, workspaceId: facts.workspaceId,
    action: {
      kind: 'secretary_archive' as const, input: facts.input,
      progress: {
        stage: 'accepted' as const, advanceGeneration: 1,
        items: facts.input.choices.map(choice => ({ requestRoot: choice.requestRoot as Root, input: null, outcome: null,
          routingRound: null, reason: null, cursor: null })),
        archiveRequest: null, lastRefusal: null,
      },
    },
    phase: 'accepted' as const, requestedAt: facts.at, updatedAt: facts.at, observation: null, failure: null,
  };
}

/**
 * The structural record the saved-position writes read and copy. State is pure
 * and imports no model type, so the exact saved inputs stay the caller's types
 * and are written by name only.
 */
type SavedPositionRecord = {
  ref: unknown;
  revision: number;
  updatedAt: string;
  action: {
    progress: {
      assignments?: readonly { createInput: unknown; [key: string]: unknown }[];
      understanding?: readonly { generation: number; requestRoot: unknown; round: unknown; command: unknown;
        [key: string]: unknown }[];
      archiveRequest: null | { requestId: string; savedInput: unknown;
        receipt: { identityKey: string; fingerprint: string } | null; [key: string]: unknown };
      brief?: null | { requests: readonly unknown[]; goals: readonly unknown[]; ready: boolean; consumedBy: unknown;
        [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * The action whose progress is the advance's one write. The owner builds the
 * progress value; this constructor is the only place the protected field is
 * assigned outside the accept constructors.
 */
export function withHandoffProgress<A extends { progress: unknown }>(action: A, progress: A['progress']): A {
  return { ...action, progress };
}

/** Save the successor's exact `ensureLine` input under its assignment, before the child call. */
export function saveHandoffCreateInput<R extends SavedPositionRecord, SavedInput>(
  record: R, index: number, input: SavedInput,
): R {
  const assignment = record.action.progress.assignments?.[index];
  if (assignment === undefined) throw new Error(`saveHandoffCreateInput: assignment ${index} does not exist`);
  const assignments = (record.action.progress.assignments ?? []).map((entry, position) =>
    position === index ? { ...entry, createInput: input } : entry);
  return { ...record, action: { ...record.action,
    progress: { ...record.action.progress, assignments } } } as R;
}

/** Save the understanding command under its generation, before the append; a new generation appends. */
export function saveUnderstandingCommand<R extends SavedPositionRecord>(
  record: R, entry: { generation: number; requestRoot: QueryJobRef; command: RequestUnderstandingCommandV1 },
): R {
  const understanding = record.action.progress.understanding ?? [];
  const found = understanding.findIndex(item => item.generation === entry.generation);
  const next = found < 0
    ? [...understanding, { generation: entry.generation, requestRoot: entry.requestRoot, round: null, command: entry.command }]
    : understanding.map((item, position) => position === found ? { ...item, command: entry.command } : item);
  return { ...record, action: { ...record.action,
    progress: { ...record.action.progress, understanding: next } } } as R;
}

/** Save the archive owner's exact `GraphWrite` before the child call, keeping any existing receipt. */
export function saveArchiveSavedInput<R extends SavedPositionRecord, SavedInput>(
  record: R, requestId: string, savedInput: SavedInput,
): R {
  const current = record.action.progress.archiveRequest;
  return { ...record, action: { ...record.action, progress: { ...record.action.progress,
    archiveRequest: { requestId, savedInput, receipt: current === null ? null : current.receipt } } } } as R;
}

/** Record the archive registration's returned receipt; it is never recomputed here. */
export function saveArchiveReceipt<R extends SavedPositionRecord>(
  record: R, receipt: { identityKey: string; fingerprint: string },
): R {
  const current = record.action.progress.archiveRequest;
  if (current === null) throw new Error('saveArchiveReceipt: the archive request was not saved');
  return { ...record, action: { ...record.action, progress: { ...record.action.progress,
    archiveRequest: { ...current, receipt } } } } as R;
}

/**
 * The entered confirmation's consumption transition: the operation record with
 * `brief.consumedBy` set and the guard that pins the revision it was read at.
 * It writes no event; the caller merges the record and the guard.
 */
export function consumeHandoffBrief<R extends SavedPositionRecord>(
  record: R, run: QueryRunRef, at: string,
): { record: R; guard: { refKey: string; expectedRevision: number } } {
  const brief = record.action.progress.brief;
  if (brief === null || brief === undefined || !brief.ready || brief.consumedBy !== null) {
    throw new Error('consumeHandoffBrief: the operation has no ready unconsumed brief');
  }
  return {
    record: { ...record, revision: record.revision + 1, updatedAt: at,
      action: { ...record.action, progress: { ...record.action.progress,
        brief: { ...brief, consumedBy: run } } } } as R,
    guard: { refKey: canonicalKey(record.ref), expectedRevision: record.revision },
  };
}

/** The structural coverage a `coverageHolds` call judges; state names no model type. */
export type CoverageHoldFacts = {
  source: { projectId: string; sessionId: string };
  lastRound: unknown;
  goals: readonly {
    textSource: unknown;
    textRound: unknown;
  }[];
};

/**
 * The book's coverage rule: every covered goal's current understanding text was written by the old Session in the
 * last entered-and-ended round. A goal whose text has another source or round is not covered; no goal needs nothing.
 */
export function coverageHolds(facts: CoverageHoldFacts): boolean {
  return facts.goals.every(goal => sameRef(goal.textSource, facts.source)
    && facts.lastRound !== null && sameRef(goal.textRound, facts.lastRound));
}

/** The structural routing a `briefReady` call judges; a saved routing set lists every root it read. */
export type BriefReadyFacts = {
  /** The guarded final archive committed; a `pending`/`partial` child is not success. */
  archiveCommitted: boolean;
  /** The complete routing set, or `null` when the set was not saved (a non-secretary handoff keeps none). */
  routing: null | {
    closed: boolean;
    roots: readonly { receipt: unknown; skipped: unknown }[];
  };
};

/**
 * The brief is ready only after the guarded final archive succeeded AND the complete routing set was saved: the set
 * is closed and every root it read is either routed (a receipt) or explicitly skipped. A root still waiting for its
 * routing command is not complete.
 */
export function briefReady(facts: BriefReadyFacts): boolean {
  if (!facts.archiveCommitted) return false;
  if (facts.routing === null || !facts.routing.closed) return false;
  return facts.routing.roots.every(root => root.receipt !== null || root.skipped !== null);
}
