/**
 * Reads the Goal's active Plan revision, understanding-pointer revision and dispatch sequence at one ledger
 * watermark, together with the guards the send owner must commit against.
 *
 * A failure is the failure: a failed read is never "no plan", "no pointer" or 0. The plan window, the pointer
 * (through its port, so this folder imports no `notes/` module) and the counter are compared by their
 * read-through cursors; a window that does not agree is re-read exactly once.
 * A mismatch fixes the last counter read's watermark for one full retry. The retry must agree at that
 * watermark; any further move is `revision_conflict`.
 * The guards are built literally here (no `guardOf` helper): the Goal's read revision, the pointer's
 * revision or "must not exist", and the counter's revision or "must not exist".
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { DispatchBasisV1, DispatchCounterV1, GoalRef } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type {
  DispatchBasisFactsPort, DispatchBasisFactsV1, DispatchBasisReadPort, GoalUnderstandingPointerFactsV1,
  GoalUnderstandingPointerPort,
} from '../model/dispatch-basis-contracts.js';
import { dispatchCounterCodec } from '../persistence/dispatch-counter-codecs.js';
import { mergeGuards } from '../persistence/record-guards.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { readBatch, readGoalPlanWindow, sameCursor, type GoalPlanWindow } from './plan-readers.js';

type CounterFact = {
  record: DispatchCounterV1 | null;
  refKey: string;
  expectedRevision: number | null;
  readThrough: CommitCursor | null;
};

/** One pass over the three reads; the cursors are compared before its facts are accepted. */
type BasisPass = {
  window: Extract<GoalPlanWindow, { status: 'ready' }>;
  pointer: GoalUnderstandingPointerFactsV1;
  counter: CounterFact;
};

type CursorCheck =
  | { kind: 'agree'; cursor: CommitCursor }
  | { kind: 'null' }
  | { kind: 'disagree' };

/** The counter's address: its full ref, never the bare goal id (`canonicalJson` keys the record). */
function counterRefKey(goalRef: GoalRef): string {
  return canonicalJson({
    aggregateType: 'DispatchCounter', projectId: goalRef.projectId, goalId: goalRef.goalId,
  } as unknown as JsonValue);
}

function checkCursors(pass: BasisPass): CursorCheck {
  const windowCursor = pass.window.readThrough;
  if (!sameCursor(windowCursor, pass.pointer.readCursor) || !sameCursor(windowCursor, pass.counter.readThrough)) {
    return { kind: 'disagree' };
  }
  return windowCursor === null ? { kind: 'null' } : { kind: 'agree', cursor: windowCursor };
}

export function createDispatchBasisReader(deps: {
  records: GoalRecordTransactionPort;
  /** The goal pointer's facts, with the same read's watermark; the notes module is reached only through this port. */
  pointer: GoalUnderstandingPointerPort;
}): DispatchBasisFactsPort & DispatchBasisReadPort {
  /** One ordered read of the plan window, the pointer and the counter; a throw is `unavailable`, never absent. */
  async function readPass(ctx: CoreCallContext, goalRef: GoalRef): Promise<ReadResult<BasisPass>> {
    let window: GoalPlanWindow;
    try {
      window = await readGoalPlanWindow(deps.records, goalRef);
    } catch (error) {
      return rejected('unavailable', `the dispatch basis plan window cannot be read: ${messageOf(error)}`);
    }
    if (window.status !== 'ready') return window;

    let pointer: ReadResult<GoalUnderstandingPointerFactsV1>;
    try {
      pointer = await deps.pointer.readGoalUnderstandingPointer(ctx, { goalRef });
    } catch (error) {
      return rejected('unavailable', `the goal understanding pointer cannot be read: ${messageOf(error)}`);
    }
    if (pointer.status !== 'ready') return pointer;

    const refKey = counterRefKey(goalRef);
    let batch: Awaited<ReturnType<typeof readBatch>>;
    try {
      batch = await readBatch(deps.records, [refKey]);
    } catch (error) {
      return rejected('unavailable', `the dispatch counter cannot be read: ${messageOf(error)}`);
    }
    if (batch.status !== 'ready') return ownerReadStoreFailureToRejection(batch);

    const encoded = batch.batch.present.get(refKey) ?? null;
    let record: DispatchCounterV1 | null = null;
    if (encoded !== null) {
      const decoded = dispatchCounterCodec.decode(encoded);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `the dispatch counter is damaged: ${decoded.reason}`);
      }
      // A record under another counter's key is not this Goal's counter; it is damage, never 0.
      if (canonicalJson(decoded.value.ref as unknown as JsonValue) !== refKey) {
        return rejected('unavailable', 'the dispatch counter record is not the requested one');
      }
      record = decoded.value;
    }
    return { status: 'ready', value: {
      window,
      pointer: pointer.value,
      counter: { record, refKey, expectedRevision: record?.revision ?? null, readThrough: batch.batch.readThrough },
    } };
  }

  function accept(pass: BasisPass, readCursor: CommitCursor): ReadResult<DispatchBasisFactsV1> {
    const { window, pointer, counter } = pass;
    const merged = mergeGuards([
      { refKey: canonicalJson(window.goal.ref as unknown as JsonValue), expectedRevision: window.goal.revision },
      { refKey: pointer.refKey, expectedRevision: pointer.expectedRevision },
      { refKey: counter.refKey, expectedRevision: counter.expectedRevision },
    ] satisfies RecordGuard[]);
    if (!merged.ok) return merged.rejection;
    const values: DispatchBasisV1 = {
      planRevision: window.plan?.planRevision ?? null,
      pointerRevision: pointer.revision,
      dispatchSequence: counter.record?.sequence ?? 0,
    };
    return { status: 'ready', value: {
      goal: window.goal,
      plan: window.plan,
      pointer: {
        revision: pointer.revision,
        anchorRefKey: pointer.anchorKey,
        expectedRevision: pointer.expectedRevision,
      },
      counter: { record: counter.record, refKey: counter.refKey, expectedRevision: counter.expectedRevision },
      values,
      readCursor,
      guards: merged.guards,
    } };
  }

  async function readDispatchFacts(ctx: CoreCallContext, input: { goalRef: GoalRef }):
  Promise<ReadResult<DispatchBasisFactsV1>> {
    // The caller's ref is copied before the awaits so a later caller mutation cannot move the read.
    const goalRef: GoalRef = { ...input.goalRef };
    const first = await readPass(ctx, goalRef);
    if (first.status !== 'ready') return first;
    const firstCheck = checkCursors(first.value);
    if (firstCheck.kind === 'agree') return accept(first.value, firstCheck.cursor);
    if (firstCheck.kind === 'null') return rejected('unavailable', 'the dispatch basis read has no read-through cursor');

    const retryCursor = first.value.counter.readThrough;
    if (retryCursor === null) {
      return rejected('unavailable', 'the dispatch basis read has no read-through cursor');
    }
    const second = await readPass(ctx, goalRef);
    if (second.status !== 'ready') return second;
    const secondCheck = checkCursors(second.value);
    if (secondCheck.kind === 'null') {
      return rejected('unavailable', 'the dispatch basis read has no read-through cursor');
    }
    if (secondCheck.kind === 'agree' && sameCursor(secondCheck.cursor, retryCursor)) {
      return accept(second.value, secondCheck.cursor);
    }
    return rejected('revision_conflict', 'the dispatch basis moved again while the window was re-read');
  }

  return {
    readDispatchFacts,
    async readDispatchBasis(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<DispatchBasisV1>> {
      const facts = await readDispatchFacts(ctx, input);
      if (facts.status !== 'ready') return facts;
      return { status: 'ready', value: facts.value.values };
    },
  };
}
