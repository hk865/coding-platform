/**
 * The handoff composite: one child call between two advances, and the four Workflow entries. It never writes the
 * RecordStore and holds no stage engine; every parent write, child call and receipt read runs under the operation's
 * saved Host principal, and only the internal request commands use the fixed system principal. L9: the archive actor
 * is shared — maintenance, H and the person's manual archive all request as `workflow:session-archive` — so the
 * archive selects by `condition.kind`/`mode`, never by requester.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { OperationRef } from '../../contracts/core/operations.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { rejected } from '../../contracts/core/rejections.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type {
  HandoffProgressV1, HandoffSavedInputV1, SecretaryArchiveProgressV1,
  SessionHandoffWorkflowPort,
} from '../../core/work-graph/model/session-handoff-contracts.js';
import type { SecretaryArchiveActionV1, HandoffActionV1 } from '../../core/work-graph/model/session-operation-arms.js';
import type { SessionOperationRecordOf } from '../../core/work-graph/model/session-contracts.js';
import {
  advanceCommandId, archiveContextOf, handoffContextOf, savedHostPrincipal, successorOf,
} from '../../core/work-graph/sessions/session-handoff-service.js';
import { sameRef } from '../../core/work-graph/state/ref-equality.js';
import { transferPinsOf } from '../../core/work-graph/sessions/session-responsibility-service.js';
import { HANDOFF_SYSTEM_PRINCIPAL } from '../../core/work-graph/model/request-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/task-contracts.js';
import type { RequestSessionArchiveInput } from '../../contracts/core/session-archive.js';
import type { ArchiveLineResultV1 } from './session-archive.js';
import type { HandoffCompositeDependencies } from './contracts.js';
import { appendUnderstanding } from './secretary-handoff.js';

function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }

export function createSecretaryHandoffWorkflow(deps: HandoffCompositeDependencies): SessionHandoffWorkflowPort {
  async function readHandoff(ctx: CoreCallContext, ref: OperationRef):
    Promise<ReadResult<SessionOperationRecordOf<HandoffActionV1>>> {
    const read = await deps.operations.getSessionOperation(ctx, ref);
    if (read.status !== 'ready') return read;
    if (read.value.action.kind !== 'handoff') return rejected('invalid', 'the operation is not a handoff');
    return { status: 'ready', value: read.value as SessionOperationRecordOf<HandoffActionV1> };
  }

  async function progressOf(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<HandoffProgressV1>> {
    const read = await deps.operations.getSessionOperation(ctx, ref);
    if (read.status !== 'ready') return read;
    const record = read.value;
    if (record.action.kind !== 'handoff') return rejected('invalid', 'the operation is not a handoff');
    const progress = record.action.progress;
    const phase = record.phase === 'unknown' ? 'accepted' as const : record.phase;
    return { status: 'ready', value: { operation: record.ref as OperationRef, revision: record.revision,
      stage: progress.stage, phase, trigger: record.action.input.trigger, successor: successorOf(record.action),
      archived: progress.stage === 'notice' || progress.stage === 'finished',
      noticeItemKey: progress.noticeItemKey, lastRefusal: progress.lastRefusal?.reason ?? null } };
  }

  /**
   * One child call for a stage whose saved input is stored, in the saved-principal context. L9: the archive actor is
   * shared, so the archive child's context follows `condition.kind`, not the requester.
   */
  async function callChild(ctx: CoreCallContext, principal: ReturnType<typeof savedHostPrincipal>,
    action: HandoffActionV1, write: { stage: string; item: string; savedInput: unknown }):
    Promise<{ status: 'done' } | CoreRejection> {
    if (principal === null) return rejected('invalid', 'the operation has no saved Host actor');
    const savedCtx = handoffContextOf(ctx, principal);
    const saved = write.savedInput;
    // A child stage always carries the arm its before write saved; no owner is called with an empty input.
    if (saved === null || typeof saved !== 'object') {
      return rejected('invalid', `the ${write.stage} step has no saved input to call its owner with`);
    }
    if (write.stage === 'successor' && (saved as { kind: string }).kind === 'create') {
      const input = (saved as { input: Parameters<typeof deps.lines.ensureLine>[1] }).input;
      const created = await deps.lines.ensureLine(savedCtx, input);
      if (created.status === 'capacity_blocked') {
        return rejected('busy', 'the successor line is at capacity; the same saved input is retried later');
      }
      if (created.status === 'created' || created.status === 'replayed' || created.status === 'accepted') {
        return { status: 'done' };
      }
      if (created.status === 'rejected') return rejected(created.code as CoreRejection['code'], created.reason);
      return rejected('invalid', `the create child answered ${String(created.status)}`);
    }
    if (write.stage === 'transfer' && (saved as { kind: string }).kind === 'transfer') {
      const input = saved as { requestId: string; from: SessionRef; to: SessionRef;
        target: { kind: 'task'; ref: { projectId: string; goalId: string; taskId: string } };
        expected: { fromSession: number; toSession: number; sourceLink: number; destinationLink: number } };
      const pins = transferPinsOf(input);
      const writeResult = await deps.responsibilities.transferSessionResponsibility(savedCtx, {
        input: { from: input.from, to: input.to, target: input.target },
        meta: { requestId: input.requestId, expected: pins } });
      return writeResult.status === 'committed' ? { status: 'done' } : writeResult;
    }
    if (write.stage === 'routing' && (saved as { kind: string }).kind === 'route') {
      // The root is identified by the write's own item, and the input is the item's saved input after that write;
      // comparing an arm against the before write's action would always miss and would pass the wrong action.
      const rootId = write.item.startsWith('root:') ? write.item.slice('root:'.length) : null;
      const root = action.progress.routing?.roots.find(entry => entry.requestRoot.queryJobId === rootId);
      if (root === undefined || root.input === null) {
        return rejected('invalid', 'the saved routing input names no root');
      }
      const appended = await deps.requests.append(handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL), {
        command: { kind: 'handoff', operationId: root.input.operationId, requestRoot: root.requestRoot,
          to: root.input.to, expectedSource: root.input.expectedSource } });
      return appended.status === 'rejected' ? appended : { status: 'done' };
    }
    if (write.stage === 'understanding' && (saved as { kind: string }).kind === 'understanding') {
      const appended = await appendUnderstanding(savedCtx, deps.requests,
        saved as Extract<HandoffSavedInputV1, { kind: 'understanding' }>);
      return 'ok' in appended ? { status: 'done' } : appended;
    }
    if (write.stage === 'archive' && (saved as { kind: string }).kind === 'archive') {
      const request = (saved as { request: GraphWrite<RequestSessionArchiveInput> }).request;
      const archived = await deps.archiveOwner.archiveLineInternal(archiveContextOf(savedCtx), request);
      if (archived.status === 'ready') return { status: 'done' };
      if (archived.status === 'rejected') return archived;
      return unavailable('the archive child read is not ready');
    }
    return rejected('invalid', `the ${write.stage} step has no child owner`);
  }

  /**
   * One child call for a saved arm. A refusal is recorded once on its item when it differs from the stored mark by
   * stage, code or reason (`at` is not part of the rule); the child's own answer is always returned.
   */
  async function callAndRecord(ctx: CoreCallContext, principal: NonNullable<ReturnType<typeof savedHostPrincipal>>,
    record: SessionOperationRecordOf<HandoffActionV1>,
    write: { stage: string; item: string; savedInput: unknown; commandId: string }): Promise<CoreRejection | null> {
    const called = await callChild(ctx, principal, record.action, write);
    if (called.status !== 'rejected') return null;
    // The child's exact answer is kept: one refusal write records it on the item, the progress is read again after
    // the mark (even when the mark itself was refused), and this drive answers with the child's own result. The
    // refusal mark is a commit that wakes the lifecycle queue, so writing an identical one again would be the
    // loop's own wake: only a different refusal is recorded.
    const stored = record.action.progress.lastRefusal;
    const unchanged = stored !== null && stored.stage === write.stage && stored.code === called.code
      && stored.reason === called.reason;
    if (!unchanged) {
      await deps.handoff.advanceHandoff(ctx, { kind: 'refusal', operation: record.ref as OperationRef,
        expectedRevision: record.revision, commandId: write.commandId,
        refusal: { code: called.code, reason: called.reason } });
      await progressOf(ctx, record.ref as OperationRef);
    }
    return called;
  }

  /**
   * The understanding write-before window: its before write committed and its child has no receipt. A `continue`
   * never answers it (it only knows the append's own receipt), so the composite replays that exact write first.
   */
  function savedUnderstandingWindow(action: HandoffActionV1): string | null {
    if (action.progress.stage !== 'understanding') return null;
    const entry = action.progress.understanding.findLast(item => item.round === null && item.command !== null);
    return entry?.command === undefined || entry.command === null ? null : `understanding:${entry.generation}`;
  }

  async function advance(ctx: CoreCallContext, input: { operation: OperationRef }): Promise<ReadResult<HandoffProgressV1>> {
    const attempted = new Set<string>();
    for (;;) {
      const read = await readHandoff(ctx, input.operation);
      if (read.status !== 'ready') return read;
      const record = read.value;
      if (record.phase === 'completed' || record.phase === 'failed') return progressOf(ctx, input.operation);
      const action = record.action;
      const principal = savedHostPrincipal(action.input.actor);
      if (principal === null) return rejected('invalid', 'the operation has no saved Host actor');
      const savedCtx = handoffContextOf(ctx, principal);
      // The composite closes a superseded understanding command, with the round the append confirmed, and only
      // once that round really ended. A close that does not succeed stops the drive; the next generation waits.
      // The close is an internal request command: it runs under the fixed system principal, never the saved human.
      if (action.progress.stage === 'understanding') {
        const last = action.progress.understanding[action.progress.understanding.length - 1];
        if (last?.round !== null && last?.round !== undefined && last?.command !== null && last?.command !== undefined) {
          const coverage = await deps.facts.readCoverage(savedCtx, { source: action.input.source });
          if (coverage.status !== 'ready') {
            return coverage.status === 'rejected' ? coverage : unavailable('the coverage read is not ready');
          }
          if (coverage.value.lastRound?.queryJobId === last.round.queryJobId) {
            const closed = await deps.requests.closeUnderstanding(
              handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL),
              { round: last.round, commandId: last.command.commandId });
            if (closed.status === 'rejected') return closed;
          }
        }
      }
      // The recovery window comes before the ordinary continue: the understanding before write committed and its
      // child has no receipt yet, so the exact saved arm is restored by its own identity and called once.
      const window = savedUnderstandingWindow(action);
      if (window !== null && !attempted.has(window)) {
        attempted.add(window);
        const restored = await deps.handoff.advanceHandoff(ctx, { kind: 'replay', operation: input.operation,
          commandId: advanceCommandId(input.operation, 'understanding', window, 'before',
            action.progress.advanceGeneration) });
        if (restored.status === 'rejected') return restored;
        if (restored.status === 'committed' && restored.value.write.savedInput !== null) {
          const refused = await callAndRecord(ctx, principal, record, { stage: 'understanding', item: window,
            savedInput: restored.value.write.savedInput, commandId: restored.value.write.commandId });
          if (refused !== null) return refused;
        }
      }
      const result = await deps.handoff.advanceHandoff(ctx, { kind: 'continue', operation: input.operation,
        expectedRevision: record.revision });
      if (result.status === 'rejected') return result;
      // L1: a stopped continue writes nothing and this branch calls no child; the drive only re-reads the progress.
      if (result.status === 'stopped') return progressOf(ctx, input.operation);
      const value = result.value;
      if (value.stop === 'finished') return progressOf(ctx, input.operation);
      const stage = value.write.stage;
      const item = value.write.item;
      const key = `${stage}:${item}`;
      const childStage = stage === 'successor' || stage === 'transfer' || stage === 'routing'
        || stage === 'archive' || stage === 'understanding';
      // A before write always names the child that has not run. A refusal write names a child that did not commit:
      // the drive that records it stops here, and a later drive resumes the arm once that mark replays.
      const callable = childStage && !attempted.has(key) && (value.write.phase === 'before'
        || (value.stop === 'refused' && value.write.savedInput !== null && result.replayed));
      if (callable) {
        attempted.add(key);
        const current = await readHandoff(ctx, input.operation);
        if (current.status !== 'ready') return current;
        const refused = await callAndRecord(ctx, principal, current.value,
          { stage, item, savedInput: value.write.savedInput, commandId: value.write.commandId });
        if (refused !== null) return refused;
        continue;
      }
      if (value.stop === 'advanced' || value.stop === 'replayed') continue;
      // A wait, a held fence, a short coverage or a recorded refusal stops the loop with the record after the stop.
      return progressOf(ctx, input.operation);
    }
  }

  async function archiveProgressOf(ctx: CoreCallContext, ref: OperationRef):
    Promise<ReadResult<SecretaryArchiveProgressV1>> {
    const read = await deps.operations.getSessionOperation(ctx, ref);
    if (read.status !== 'ready') return read;
    const record = read.value;
    if (record.action.kind !== 'secretary_archive') {
      return rejected('invalid', 'the operation is not a secretary archive');
    }
    const archiveRecord = record as SessionOperationRecordOf<SecretaryArchiveActionV1>;
    const progress = archiveRecord.action.progress;
    return { status: 'ready', value: { operation: archiveRecord.ref as OperationRef, revision: archiveRecord.revision,
      stage: progress.stage, phase: archiveRecord.phase === 'unknown' ? 'accepted' : archiveRecord.phase,
      generation: progress.advanceGeneration,
      items: progress.items.map(item => ({ requestRoot: item.requestRoot, outcome: item.outcome,
        to: item.input?.to ?? null, routingRound: item.routingRound, reason: item.reason, receipt: item.cursor })),
      archiveRequest: progress.archiveRequest === null ? null : {
        aggregateType: 'CoreOperation', projectId: archiveRecord.ref.projectId,
        operationId: progress.archiveRequest.requestId },
      lastRefusal: progress.lastRefusal?.reason ?? null } };
  }

  /** Release a manual archive's proven failed final condition; a failed release is the caller's answer. */
  async function releaseFailedManualArchive(savedCtx: CoreCallContext, result: ArchiveLineResultV1) {
    const rejection = result.rejection, pending = result.session.archiveRequest ?? null;
    if (rejection?.code !== 'revision_conflict' || !rejection.reason.startsWith('archive_condition_failed:')
      || pending === null) return null;
    const session = result.session.ref;
    const released = await deps.releaseArchiveRequest(archiveContextOf(savedCtx), {
      input: { sessionRef: session, archiveRequestId: pending.requestId, reason: rejection.reason },
      meta: { requestId: `s1-manual-archive-release:${session.projectId}:${session.sessionId}:${pending.requestId}`,
        expected: [{ ref: session, revision: result.session.revision }] } });
    return released.status === 'committed' ? null : released;
  }

  async function manualArchive(ctx: CoreCallContext, input: { operation: OperationRef }):
    Promise<ReadResult<SecretaryArchiveProgressV1>> {
    const attempted = new Set<string>();
    for (;;) {
      const read = await deps.operations.getSessionOperation(ctx, input.operation);
      if (read.status !== 'ready') return read;
      const record = read.value;
      if (record.action.kind !== 'secretary_archive') return rejected('invalid', 'the operation is not a secretary archive');
      const archiveRecord = record as SessionOperationRecordOf<SecretaryArchiveActionV1>;
      const action = archiveRecord.action;
      if (record.phase === 'completed' || record.phase === 'failed') {
        return archiveProgressOf(ctx, input.operation);
      }
      const result = await deps.archive.advanceArchive(ctx, { kind: 'continue', operation: input.operation,
        expectedRevision: archiveRecord.revision });
      if (result.status === 'rejected') return result;
      const value = result.value;
      if (value.stop === 'finished') return archiveProgressOf(ctx, input.operation);
      const principal = savedHostPrincipal(action.input.actor);
      if (principal === null) return rejected('invalid', 'the archive operation has no saved Host actor');
      const savedCtx = handoffContextOf(ctx, principal);
      const itemKey = `items:${value.item.requestRoot.queryJobId}`;
      if (value.stage === 'items' && value.item.savedInput !== null && !attempted.has(itemKey)) {
        attempted.add(itemKey);
        const saved = value.item.savedInput;
        await deps.requests.append(handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL), {
          command: { kind: 'archived', operationId: saved.operationId, requestRoot: value.item.requestRoot,
            to: saved.to, expectedSource: saved.expectedSource } });
        // A refusal is the next advance's parent write; this drive never re-appends the same item.
        continue;
      }
      const archiveKey = 'archive:-';
      if (value.stage === 'archive' && result.replayed && !attempted.has(archiveKey)) {
        // The saved GraphWrite is the one the before write stored: the unregistered window and a partial mark both
        // resume it, and this drive calls the owner once.
        const saved = action.progress.archiveRequest?.savedInput;
        if (saved !== null && saved !== undefined) {
          attempted.add(archiveKey);
          const archived = await deps.archiveOwner.archiveLineInternal(archiveContextOf(savedCtx), saved);
          const refused = archived.status === 'ready' ? await releaseFailedManualArchive(savedCtx, archived.value) : null;
          if (refused !== null) return refused;
          // A pending/partial result is the next advance's parent write; this drive stops after one owner call.
          continue;
        }
      }
      if (value.stop === 'advanced') continue;
      return archiveProgressOf(ctx, input.operation);
    }
  }

  return {
    async startHandoff(ctx, input) {
      const basis = input?.basis;
      if (basis === undefined || basis === null || typeof basis !== 'object') {
        return rejected('invalid', 'startHandoff requires the threshold basis');
      }
      const scope: WorkspaceScope = ctx.workspaceId === undefined
        ? { projectId: ctx.projectId } as WorkspaceScope
        : { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
      /** The one unfinished handoff of this source, read from the real operation index. */
      const unfinishedOfSource = async (): Promise<{ operation: OperationRef } | CoreRejection | null> => {
        const unfinished = await deps.unfinishedOperations(ctx, input.source);
        if (unfinished.status !== 'ready') {
          return unfinished.status === 'rejected' ? unfinished
            : rejected(unfinished.status === 'not_found' ? 'not_found' : 'unavailable',
              'the unfinished operation read is not ready');
        }
        const existing = unfinished.value.find(record => record.action.kind === 'handoff'
          && sameRef(record.action.input.source, input.source));
        return existing === undefined ? null : { operation: existing.ref as OperationRef };
      };
      // An unfinished operation of the same source is continued before the threshold is looked at; a new basis
      // never blocks it and never accepts a second operation.
      const running = await unfinishedOfSource();
      if (running !== null && !('status' in running)) return advance(ctx, { operation: running.operation });
      if (running !== null) return running;
      if (basis.tooLong !== true) {
        return rejected('incomplete', 'the source is not too long and has no unfinished handoff');
      }
      const identity = sha256Hex(canonicalJson({ source: input.source, run: basis.run,
        requestIndex: basis.requestIndex } as unknown as JsonValue));
      const commandId = `handoff-auto-${identity}`;
      const accepted = await deps.handoff.acceptHandoff(ctx, { commandId, workspace: scope as { projectId: string;
        workspaceId: string }, source: input.source, trigger: 'too_long',
        assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }] });
      if (accepted.status === 'committed') return advance(ctx, { operation: accepted.value.operation as OperationRef });
      if (accepted.status === 'rejected' && accepted.code === 'busy') {
        // The busy answer is only a pointer: re-read the real unfinished operations and continue only a handoff
        // of this source. An unfinished secretary archive remains busy and is never returned as a handoff.
        const found = await unfinishedOfSource();
        if (found !== null && !('status' in found)) return advance(ctx, { operation: found.operation });
        if (found !== null) return found;
      }
      return accepted;
    },
    async continueHandoff(ctx, input) {
      return advance(ctx, input);
    },
    advance,
    manualArchive,
  };
}
