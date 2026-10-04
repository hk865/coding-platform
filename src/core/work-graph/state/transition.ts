/**
 * The one shape shared by every pure state machine in this directory
 * (docs/refactor/STATE-MACHINES-SPEC.md §1.1, §1.2).
 *
 * A machine never reads storage, never mints ids and never reads a clock:
 * the owner service reads the current record, builds the state and the guard
 * context, calls `transition*`, and writes `next` plus the translated
 * `effects` in ONE RecordStore commit. Files in this directory import only
 * `src/contracts` (§14.4).
 */
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';

/**
 * - `illegal`: the event does not exist from this state (§N.4 tables);
 * - `guard_failed`: the transition exists but a guard does not hold;
 * - `duplicate`: the record is already in the target state with the same payload;
 * - `stale`: an older pin, an old event sequence, a late ack or a superseded intent.
 */
export type TransitionRejectReason = 'illegal' | 'guard_failed' | 'duplicate' | 'stale';

/**
 * `E` only documents which event union the result answers (the spec's
 * three-parameter form); the value carries no event. `code` keeps today's
 * externally visible CoreError for the same situation (§1.2).
 */
export type Transition<S, E, X> =
  | { ok: true; next: S; effects: readonly X[] }
  | { ok: false; reason: TransitionRejectReason; detail: string; code: CoreError };

/** A legal transition. A legal event with no state change returns `effects: []` (SD-1). */
export function accept<S, X>(next: S, effects: readonly X[] = []): Transition<S, never, X> {
  return { ok: true, next, effects };
}

/** A refusal: it fits every machine's `Transition` because it carries no state and no effect. */
export type Rejected = Transition<never, never, never>;

export function reject(reason: TransitionRejectReason, code: CoreError, detail: string): Rejected {
  return { ok: false, reason, detail, code };
}

/**
 * A row whose 现状 is 新增 before A.2 step 5 (§15.2 step 2): its event stays in
 * the union and is `illegal` with the §1.2 default `invalid`, so step 5 only
 * adds the row.
 */
export function notYet(row: string): Rejected {
  return reject('illegal', 'invalid', `${row} is not implemented before A.2 step 5`);
}

/** A failing read-side check: an old basis is `stale`, every other code a guard failure (§1.2). */
export function failed(code: CoreError, detail: string): Rejected {
  return reject(code === 'revision_conflict' ? 'stale' : 'guard_failed', code, detail);
}

/** `failed` for a rejection a read or admission helper already built, keeping its code and reason. */
export function rejected(rejection: CoreRejection): Rejected {
  return failed(rejection.code, rejection.reason);
}

/** Exhaustiveness guard for `switch` statements over closed state/event unions. */
export function unreachable(value: never, what: string): never {
  throw new Error(`unreachable ${what}: ${JSON.stringify(value)}`);
}
