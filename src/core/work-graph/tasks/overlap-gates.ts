// src/core/work-graph/tasks/overlap-gates.ts (new; N appends the service below them in its run)
import { hostPrincipalOf, principalIdentity, type CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, canonicalKey, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../contracts/keyset-cursor.js';
import { compareCursors } from '../../../contracts/ledger.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { ModuleOverlapGateRef } from '../../../contracts/module-overlap-gate.js';
import type { NoteVersionSnapshot } from '../../../contracts/note.js';
import type { Phase } from '../../../contracts/plan.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionMessageSendInputV1, SendMessageResultV1 } from '../model/communication-contracts.js';
import { commandKeys, executeWriteCommand, readCommittedEvent } from '../persistence/command-executor.js';
import { lookupCommittedReceipt } from '../persistence/receipt-lookup.js';
import {
  moduleOverlapGateCodec, moduleOverlapGateOpenedCodec, moduleOverlapGateReleasedCodec,
  moduleOverlapNoteRequestedCodec, type ModuleOverlapGateOpenedEventV1, type ModuleOverlapGateReleasedEventV1,
  type ModuleOverlapGateV1, type ModuleOverlapNoteRequestedEventV1,
} from '../persistence/module-overlap-gate-codecs.js';
import { goalRefFor } from '../persistence/commit-compiler.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { readOwnerRecord } from './owner-record-read.js';

/** One task as the overlap rule reads it: its triple, its declared module (none without the module arm), its phase. */
export type ModuleOverlapTaskFactsV1 = {
  task: TaskTriple;
  moduleId: string | null;
  effectivePhase: Phase;
  /** The task's planned files (decision 121-10); absent when its plan lists none. */
  plannedFiles?: readonly string[];
};
export type ModuleOverlapFactsV1 = {
  waiting: ModuleOverlapTaskFactsV1;
  /** Every task the caller read, any Goal; the rule keeps the waiting task's Goal and the running ones. */
  others: readonly ModuleOverlapTaskFactsV1[];
};
export type ModuleOverlapV1 =
  | { overlaps: false }
  | { overlaps: true; moduleId: string; running: TaskTriple[] };

/** A-12 (decision 49 第 16 项, decision 121-10): the waiting task overlaps when another running task of its Goal declares the same module; when both tasks list planned files, only a shared path makes it an overlap. Planned files never add an overlap across modules: the gate stays a module gate. */
export function moduleOverlapOf(facts: ModuleOverlapFactsV1): ModuleOverlapV1 {
  const moduleId = facts.waiting.moduleId;
  if (moduleId === null) return { overlaps: false };
  const own = facts.waiting.plannedFiles;
  const running = facts.others
    .filter(other => other.task.goalId === facts.waiting.task.goalId
      && other.effectivePhase === 'running'
      && other.moduleId === moduleId
      && (own === undefined || other.plannedFiles === undefined
        || other.plannedFiles.some((path) => own.includes(path))))
    .map(other => other.task);
  return running.length === 0 ? { overlaps: false } : { overlaps: true, moduleId, running };
}

/** A stable partition on the per-candidate overlap; each segment keeps the caller's order (`orderTasks`, A-12). */
export type ModuleOverlapCandidateV1<T> = { candidate: T; overlap: ModuleOverlapV1 };
export function splitNonOverlapping<T>(candidates: readonly ModuleOverlapCandidateV1<T>[]):
  { nonOverlapping: ModuleOverlapCandidateV1<T>[]; overlapping: ModuleOverlapCandidateV1<T>[] } {
  const nonOverlapping: ModuleOverlapCandidateV1<T>[] = [];
  const overlapping: ModuleOverlapCandidateV1<T>[] = [];
  for (const candidate of candidates) {
    if (candidate.overlap.overlaps) overlapping.push(candidate);
    else nonOverlapping.push(candidate);
  }
  return { nonOverlapping, overlapping };
}

/** A2-04: the canonical basis is exactly the gate's `planRevision`, `waitingAttempt` and conflict set. */
export type OverlapBasisV1 = Pick<ModuleOverlapGateV1, 'planRevision' | 'waitingAttempt' | 'running'>;
export function overlapBasisDigest(basis: OverlapBasisV1): string {
  const running = basis.running.map(entry => ({ task: entry.task, run: entry.run, startCursor: entry.startCursor }));
  running.sort((left, right) => {
    const leftKey = canonicalJson([left.task, left.run]);
    const rightKey = canonicalJson([right.task, right.run]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return sha256Hex(canonicalJson({
    planRevision: basis.planRevision, waitingAttempt: basis.waitingAttempt, running,
  }));
}

export type OverlapGateStatusV1 =
  | { status: 'satisfied'; by: 'note' | 'release' }
  | { status: 'not_satisfied' }
  | { status: 'not_computable'; reason: 'start_cursor' };
/** `book-7c.md:973–:977`; the lead ruled it early (E-SR17-L3). */
export function overlapGateSatisfied(
  gate: ModuleOverlapGateV1, notes: readonly NoteVersionSnapshot[]): OverlapGateStatusV1 {
  if (gate.release !== null) return { status: 'satisfied', by: 'release' };
  const cursors = gate.running.map(entry => entry.startCursor);
  if (cursors.some(cursor => cursor === null)) return { status: 'not_computable', reason: 'start_cursor' };
  const satisfied = notes.some(note => {
    const state = note.state === 'accepted' || note.state === 'reviewed';
    const kind = note.kind === 'convention' || note.kind === 'decision';
    const anchored = (note.anchor.kind === 'module' || note.anchor.kind === 'interface')
      && note.anchor.moduleId === gate.moduleId;
    return state && kind && anchored
      && cursors.every(cursor => cursor !== null && compareCursors(note.since, cursor) > 0);
  });
  return satisfied ? { status: 'satisfied', by: 'note' } : { status: 'not_satisfied' };
}

// ---------------------------------------------------------------------------
// The overlap gate owner: open, one note request, the satisfaction read, the
// person's release and the goal's paged gates. Record 4 has no `state/` file
// (E-SR17-L11): the three record builders stay internal here.
// ---------------------------------------------------------------------------

export type OpenOverlapGateInputV1 = { goalRef: GoalRef; task: TaskTriple; moduleId: string;
  running: OverlapBasisV1['running']; planRevision: number; waitingAttempt: string };
export type OpenOverlapGateResultV1 = { status: 'opened'; gate: ModuleOverlapGateV1; replayed: boolean;
  noteRequest: 'sent' | 'none' | 'unavailable' } | CoreRejection;
export type RequestOverlapNoteInputV1 = { gate: ModuleOverlapGateRef; revision: number; basisDigest: string };
export type RequestOverlapNoteResultV1 = { status: 'sent' | 'none' | 'unavailable'; gate: ModuleOverlapGateV1 };
export type ReleaseOverlapGateInputV1 = { commandId: string; gate: ModuleOverlapGateRef; revision: number; reason: string };
export type ReadOverlapGatesInputV1 = { goalRef: GoalRef; page: { limit: number; cursor?: string } };
export type OverlapGateServiceDependencies = {
  records: GoalRecordTransactionPort & RecordOrderedLookupPort;
  resolveRecipient(ctx: CoreCallContext, goalRef: GoalRef, duty: 'adviser' | 'secretary'):
    Promise<ReadResult<SessionRef | null>>;
  sendMessage(ctx: CoreCallContext, write: SessionMessageSendInputV1): Promise<SendMessageResultV1>;
  /** The note service's current-version read, injected by L1; N adds no note reader or codec. */
  readNotes(ctx: CoreCallContext, input: { goalRef: GoalRef; moduleId: string }):
    Promise<ReadResult<readonly NoteVersionSnapshot[]>>;
  /** The pack's one-line prefix, like SCRIBE_REMINDER_MARKER (src/app/host.ts:248); the service appends the module id. */
  noteRequestText: string;
  now(): string;
};
export type OverlapGatePort = {
  openOverlapGate(ctx: CoreCallContext, input: OpenOverlapGateInputV1): Promise<OpenOverlapGateResultV1>;
  requestOverlapNote(ctx: CoreCallContext, input: RequestOverlapNoteInputV1):
    Promise<RequestOverlapNoteResultV1 | CoreRejection>;
  readOverlapGate(ctx: CoreCallContext, input: { gate: ModuleOverlapGateRef }):
    Promise<ReadResult<ModuleOverlapGateV1>>;
  checkOverlapGate(ctx: CoreCallContext, input: { gate: ModuleOverlapGateRef }):
    Promise<ReadResult<OverlapGateStatusV1>>;
  releaseOverlapGate(ctx: CoreCallContext, input: ReleaseOverlapGateInputV1):
    Promise<{ status: 'released'; gate: ModuleOverlapGateV1 } | CoreRejection>;
  readOverlapGates(ctx: CoreCallContext, input: ReadOverlapGatesInputV1):
    Promise<ReadResult<{ gates: ModuleOverlapGateV1[]; nextCursor: string | null }>>;
};

const OPEN_OPERATION = 'overlap.open';
const NOTE_OPERATION = 'overlap.note';
const RELEASE_OPERATION = 'overlap.release';
const GATE_BY_GOAL_LOOKUP = 'overlap-gate-by-goal';
const NOTE_COMMAND_PREFIX = 'overlap-note';

type NonReadyRead = Exclude<ReadResult<unknown>, { status: 'ready' }>;

/** A non-ready gate read in the rejection vocabulary the write and request results speak. */
function readRejection(read: NonReadyRead): CoreRejection {
  if (read.status === 'rejected') return read;
  if (read.status === 'not_found') return rejected('not_found', 'the overlap gate was not found');
  return rejected('unavailable', 'the overlap gate read is not ready');
}

export function createOverlapGateService(deps: OverlapGateServiceDependencies): OverlapGatePort {
  async function readGate(ref: ModuleOverlapGateRef): Promise<ReadResult<ModuleOverlapGateV1>> {
    const read = await readOwnerRecord({
      store: deps.records,
      refKey: canonicalKey(ref),
      decode: moduleOverlapGateCodec.decode,
      readError: message => rejected('unavailable', `the overlap gate could not be read: ${message}`),
    });
    if (read.ok) return { status: 'ready', value: read.value };
    return 'rejection' in read ? read.rejection : { status: 'not_found' };
  }

  async function requestOverlapNote(ctx: CoreCallContext, input: RequestOverlapNoteInputV1):
  Promise<RequestOverlapNoteResultV1 | CoreRejection> {
    const key = canonicalKey(input.gate);
    const commandId = `${NOTE_COMMAND_PREFIX}:${key}:${input.basisDigest}`;
    const scope = { projectId: input.gate.projectId, workspaceId: ctx.workspaceId ?? null };
    const principal = principalIdentity(ctx.principal);
    // The note write's fingerprint is the same stable pair as the open: gate and basis, never the recipient or the
    // revision it will move.
    const fingerprintInput = { gate: input.gate, basisDigest: input.basisDigest } as unknown as JsonValue;
    const resultOf = {
      eventType: 'ModuleOverlapNoteRequested',
      schemaVersion: 1,
      decode: moduleOverlapNoteRequestedCodec.decode,
      validate: (decoded: ModuleOverlapNoteRequestedEventV1) =>
        canonicalKey(decoded.gate) === key ? null : 'the event records another overlap gate',
      project: (decoded: ModuleOverlapNoteRequestedEventV1) => decoded,
    };
    // R2 order: the committed receipt comes before the current gate. A note already written for this gate and
    // basis replays its own record; only a miss resolves a recipient, sends and writes.
    const keys = commandKeys({ operation: NOTE_OPERATION, scope, principal, commandId, fingerprintInput });
    const receipt = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (receipt.status === 'conflict') return rejected('idempotency_conflict', receipt.reason);
    if (receipt.status !== 'found' && receipt.status !== 'missing') {
      return rejected(receipt.status === 'invalid' ? 'invalid' : 'unavailable', receipt.reason);
    }
    if (receipt.status === 'found') {
      const replayed = await readCommittedEvent(deps.records, receipt.receipt, resultOf);
      if (replayed.status !== 'ready') return rejected('unavailable', `strict replay: ${replayed.reason}`);
      const problem = resultOf.validate(replayed.value);
      if (problem !== null) return rejected('unavailable', `strict replay: the result does not validate: ${problem}`);
      const current = await readGate(input.gate);
      if (current.status !== 'ready') return readRejection(current);
      const noteRequest = replayed.value.noteRequest;
      return { status: noteRequest === null || noteRequest.recipient === null ? 'none' : 'sent',
        gate: current.value };
    }
    const read = await readGate(input.gate);
    if (read.status !== 'ready') return readRejection(read);
    const gate = read.value;
    // The caller asked about the revision it saw; a moved gate is never sent a second note.
    if (gate.revision !== input.revision) {
      return rejected('revision_conflict', 'the overlap gate moved since the note request was prepared');
    }
    const goalRef = goalRefFor(gate.ref.projectId, gate.ref.goalId);
    let resolved: SessionRef | null = null;
    let duty: 'adviser' | 'secretary' = 'adviser';
    const adviser = await deps.resolveRecipient(ctx, goalRef, 'adviser');
    if (adviser.status === 'ready' && adviser.value !== null) {
      resolved = adviser.value;
    } else if (adviser.status === 'rejected' || adviser.status === 'not_ready') {
      return { status: 'unavailable', gate };
    } else {
      const secretary = await deps.resolveRecipient(ctx, goalRef, 'secretary');
      if (secretary.status === 'ready' && secretary.value !== null) {
        resolved = secretary.value;
        duty = 'secretary';
      } else if (secretary.status === 'rejected' || secretary.status === 'not_ready') {
        return { status: 'unavailable', gate };
      }
    }
    // DR-01: the resolver returns the directory's record ref; the send and the saved noteRequest take one plain
    // {projectId, sessionId} projection here.
    const recipient: SessionRef | null = resolved === null ? null
      : { projectId: resolved.projectId, sessionId: resolved.sessionId };
    let noteRequest: ModuleOverlapGateV1['noteRequest'];
    if (recipient === null) {
      noteRequest = { recipient: null, reason: 'no_adviser_or_secretary' };
    } else {
      const send = await deps.sendMessage(ctx, {
        input: { recipient, text: `${deps.noteRequestText}${gate.moduleId}`, intent: 'action_request', goalRef },
        meta: { requestId: `${NOTE_COMMAND_PREFIX}:${canonicalKey(gate.ref)}:${input.basisDigest}`, expected: [] },
      });
      // A rejected send leaves the gate's noteRequest null: never a fabricated recipient (E28).
      if (send.status !== 'committed') return { status: 'unavailable', gate };
      noteRequest = { recipient, duty, messageRef: send.value.ref };
    }
    // The record write and its event are ONE commit under the note operation's own identity; the same gate and
    // basis replays the receipt instead of writing a new revision.
    const result = await executeWriteCommand<ModuleOverlapGateV1, { next: ModuleOverlapGateV1; expectedRevision: number },
      CoreRejection, ModuleOverlapNoteRequestedEventV1, ModuleOverlapNoteRequestedEventV1>(deps.records, {
      operation: NOTE_OPERATION,
      scope,
      principal,
      commandId,
      fingerprintInput,
      read: async () => {
        const current = await readGate(gate.ref);
        if (current.status === 'ready') return { status: 'ready' as const, facts: current.value };
        return readRejection(current);
      },
      decide(facts) {
        if (facts.revision !== input.revision) {
          return { refuse: rejected('revision_conflict', 'the overlap gate moved since the note request was prepared') };
        }
        return { decision: { next: { ...facts, revision: facts.revision + 1, noteRequest, since: null as never },
          expectedRevision: facts.revision } };
      },
      build({ next, expectedRevision }, keys) {
        const event: ModuleOverlapNoteRequestedEventV1 = {
          eventId: `${keys.identityKey}:note-requested`, eventType: 'ModuleOverlapNoteRequested', schemaVersion: 1,
          occurredAt: deps.now(), gate: next.ref, revision: next.revision, basisDigest: next.basisDigest,
          noteRequest: next.noteRequest,
        };
        return {
          records: [moduleOverlapGateCodec.encode(next)],
          guards: [{ refKey: key, expectedRevision }],
          claims: [],
          events: [moduleOverlapNoteRequestedCodec.encode(event)],
          commitCursorBindings: [{ refKey: key, field: 'since' as const }],
        };
      },
      result: resultOf,
    });
    if (result.status === 'refused') return result.refusal;
    if (result.status === 'rejected') {
      if (result.code !== 'revision_conflict') return result;
      // A release that raced the note write: report the newer gate and let the caller re-read (List B 1).
      const current = await readGate(gate.ref);
      return current.status === 'ready' ? { status: 'unavailable', gate: current.value } : readRejection(current);
    }
    const written = await readGate(gate.ref);
    if (written.status !== 'ready') return readRejection(written);
    return { status: recipient === null ? 'none' : 'sent', gate: written.value };
  }

  async function checkOverlapGate(ctx: CoreCallContext, input: { gate: ModuleOverlapGateRef }):
  Promise<ReadResult<OverlapGateStatusV1>> {
    const read = await readGate(input.gate);
    if (read.status !== 'ready') return read;
    const gate = read.value;
    const notes = await deps.readNotes(ctx, { goalRef: goalRefFor(gate.ref.projectId, gate.ref.goalId),
      moduleId: gate.moduleId });
    if (notes.status !== 'ready') return notes;
    return { status: 'ready', value: overlapGateSatisfied(gate, notes.value) };
  }

  return {
    async openOverlapGate(ctx, input) {
      if (hostPrincipalOf(ctx, 'system') === null) {
        return rejected('forbidden', 'the overlap gate opens under the platform system principal');
      }
      const gateRef: ModuleOverlapGateRef = { aggregateType: 'ModuleOverlapGate',
        projectId: input.goalRef.projectId, goalId: input.goalRef.goalId, taskId: input.task.taskId,
        moduleId: input.moduleId };
      const key = canonicalKey(gateRef);
      const basisDigest = overlapBasisDigest({ planRevision: input.planRevision,
        waitingAttempt: input.waitingAttempt, running: input.running });
      const incomplete: ModuleOverlapGateV1['incomplete'] = input.running.some(entry => entry.startCursor === null)
        ? ['start_cursor'] : [];
      const workspaceId = ctx.workspaceId as string;
      const result = await executeWriteCommand<ModuleOverlapGateV1 | null,
        { next: ModuleOverlapGateV1; expectedRevision: number | null },
        CoreRejection, ModuleOverlapGateOpenedEventV1, ModuleOverlapGateOpenedEventV1>(deps.records, {
        operation: OPEN_OPERATION,
        scope: { projectId: gateRef.projectId, workspaceId: ctx.workspaceId ?? null },
        principal: principalIdentity(ctx.principal),
        commandId: `overlap-open:${key}:${basisDigest}`,
        // The identity is the canonical digest: a reordered conflict set is the same open, so the fingerprint
        // cannot carry the caller's unsorted `running` order.
        fingerprintInput: { gate: gateRef, basisDigest } as unknown as JsonValue,
        read: async () => {
          const read = await readGate(gateRef);
          if (read.status === 'ready') return { status: 'ready' as const, facts: read.value };
          if (read.status === 'not_found') return { status: 'ready' as const, facts: null };
          return readRejection(read);
        },
        decide(facts) {
          const next: ModuleOverlapGateV1 = {
            ref: gateRef, revision: facts === null ? 1 : facts.revision + 1, workspaceId, waiting: input.task,
            waitingAttempt: input.waitingAttempt, moduleId: input.moduleId, running: input.running,
            planRevision: input.planRevision, basisDigest, incomplete, noteRequest: null, release: null,
            since: null as never,
          };
          return { decision: { next, expectedRevision: facts === null ? null : facts.revision } };
        },
        build({ next, expectedRevision }, keys) {
          const event: ModuleOverlapGateOpenedEventV1 = {
            eventId: `${keys.identityKey}:opened`, eventType: 'ModuleOverlapGateOpened', schemaVersion: 1,
            occurredAt: deps.now(), gate: next.ref, revision: next.revision, basisDigest,
            planRevision: input.planRevision, waitingAttempt: input.waitingAttempt,
          };
          return {
            records: [moduleOverlapGateCodec.encode(next)],
            guards: [{ refKey: key, expectedRevision }],
            claims: [],
            events: [moduleOverlapGateOpenedCodec.encode(event)],
            commitCursorBindings: [{ refKey: key, field: 'since' as const }],
          };
        },
        result: {
          eventType: 'ModuleOverlapGateOpened',
          schemaVersion: 1,
          decode: moduleOverlapGateOpenedCodec.decode,
          validate: decoded => canonicalKey(decoded.gate) === key ? null : 'the event records another overlap gate',
          project: decoded => decoded,
        },
      });
      if (result.status === 'rejected') return result;
      if (result.status === 'refused') return result.refusal;
      const replayed = result.replayed;
      const opened = await readGate(gateRef);
      if (opened.status !== 'ready') return readRejection(opened);
      const request = await requestOverlapNote(ctx, { gate: gateRef, revision: opened.value.revision, basisDigest });
      if (request.status === 'rejected') return request;
      return { status: 'opened', gate: request.gate, replayed, noteRequest: request.status };
    },

    requestOverlapNote,

    async readOverlapGate(_ctx, input) {
      return readGate(input.gate);
    },

    checkOverlapGate,

    async releaseOverlapGate(ctx, input) {
      if (hostPrincipalOf(ctx, 'human') === null) {
        return rejected('forbidden', 'the overlap gate is released by the person');
      }
      const key = canonicalKey(input.gate);
      const actor = hostPrincipalOf(ctx, 'human')!.actor;
      const release: NonNullable<ModuleOverlapGateV1['release']> = { by: actor, at: deps.now(), reason: input.reason,
        commandId: input.commandId, revision: input.revision };
      // The revision and satisfaction checks live inside the executor's receipt-miss read, so the same input
      // replays its own release instead of meeting a moved gate before the receipt lookup.
      const result = await executeWriteCommand<{ gate: ModuleOverlapGateV1; check: OverlapGateStatusV1 },
        { next: ModuleOverlapGateV1; expectedRevision: number },
        CoreRejection, ModuleOverlapGateReleasedEventV1, ModuleOverlapGateReleasedEventV1>(deps.records, {
        operation: RELEASE_OPERATION,
        scope: { projectId: input.gate.projectId, workspaceId: ctx.workspaceId ?? null },
        principal: principalIdentity(ctx.principal),
        commandId: input.commandId,
        fingerprintInput: input as unknown as JsonValue,
        read: async () => {
          const current = await readGate(input.gate);
          if (current.status !== 'ready') return readRejection(current);
          const check = await checkOverlapGate(ctx, { gate: input.gate });
          if (check.status !== 'ready') return check.status === 'rejected' ? check : readRejection(check);
          return { status: 'ready' as const, facts: { gate: current.value, check: check.value } };
        },
        decide(facts) {
          // DS-07: the old revision is a revision conflict even on a released gate; only the read-back revision meets
          // the satisfaction refusal.
          if (facts.gate.revision !== input.revision) {
            return { refuse: rejected('revision_conflict', 'the overlap gate moved since the release was prepared') };
          }
          if (facts.check.status === 'satisfied') {
            return { refuse: rejected('invalid', 'the overlap gate is already satisfied') };
          }
          return { decision: { next: { ...facts.gate, revision: facts.gate.revision + 1, release, since: null as never },
            expectedRevision: facts.gate.revision } };
        },
        build({ next, expectedRevision }, keys) {
          const event: ModuleOverlapGateReleasedEventV1 = {
            eventId: `${keys.identityKey}:released`, eventType: 'ModuleOverlapGateReleased', schemaVersion: 1,
            occurredAt: deps.now(), gate: next.ref, revision: next.revision, basisDigest: next.basisDigest,
            reason: input.reason, commandId: input.commandId,
          };
          return {
            records: [moduleOverlapGateCodec.encode(next)],
            guards: [{ refKey: key, expectedRevision }],
            claims: [],
            events: [moduleOverlapGateReleasedCodec.encode(event)],
            commitCursorBindings: [{ refKey: key, field: 'since' as const }],
          };
        },
        result: {
          eventType: 'ModuleOverlapGateReleased',
          schemaVersion: 1,
          decode: moduleOverlapGateReleasedCodec.decode,
          validate: decoded => canonicalKey(decoded.gate) === key && decoded.commandId === input.commandId
            ? null : 'the event records another release',
          project: decoded => decoded,
        },
      });
      if (result.status === 'refused') return result.refusal;
      if (result.status === 'rejected') return result;
      const written = await readGate(input.gate);
      if (written.status !== 'ready') return readRejection(written);
      return { status: 'released', gate: written.value };
    },

    async readOverlapGates(ctx, input) {
      // The page is a required input: a read without it is `invalid`, like a bad cursor.
      if (!isRecord(input.page)) return rejected('invalid', 'the gates read requires a page');
      const goalId = input.goalRef.goalId;
      let after: { order: string | number; refKey: string } | undefined;
      if (input.page.cursor !== undefined) {
        const decoded = decodeKeysetCursor(input.page.cursor, goalId);
        if (decoded === null) return rejected('invalid', 'cursor_mismatch');
        after = decoded;
      }
      let page: Awaited<ReturnType<RecordOrderedLookupPort['lookupOrdered']>>;
      try {
        page = await deps.records.lookupOrdered({
          index: GATE_BY_GOAL_LOOKUP,
          values: [input.goalRef.projectId, ctx.workspaceId as string, goalId],
          direction: 'asc',
          ...(after === undefined ? {} : { after }),
          limit: input.page.limit,
        });
      } catch (error) {
        return rejected('unavailable', `the overlap gates could not be read: ${messageOf(error)}`);
      }
      if (page.status !== 'ready') return ownerReadStoreFailureToRejection(page);
      const gates: ModuleOverlapGateV1[] = [];
      for (const record of page.value.records) {
        const decoded = moduleOverlapGateCodec.decode(record);
        if (decoded.status !== 'decoded') {
          return rejected('unavailable', `an overlap gate is damaged: ${decoded.reason}`);
        }
        gates.push(decoded.value);
      }
      return { status: 'ready', value: { gates,
        nextCursor: page.value.next === null ? null : encodeKeysetCursor(goalId, page.value.next) } };
    },
  };
}
