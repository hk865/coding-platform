/**
 * Slice 6A-1 fixture (book §5.1; rows R-02, R-03a and the concurrency rows of
 * book §3.6.10): a commit barrier at the record-store backend boundary.
 *
 * What it is (rule sheet v1 A3 delegating wrapper, with A2 faults that fail
 * once or always, placed at the A4 backend seam): `vi.mock` factories for the
 * two real backend factories that `createTargetPlatform` calls
 * (`src/composition/create-platform.ts:678–680`),
 * `createInMemoryRecordBackend` (`src/core/record-store/in-memory-record-store.ts`)
 * and `createSqliteRecordBackend` (`src/core/record-store/sqlite-record-store.ts`).
 * Every real export survives. The factory builds the real backend and wraps
 * `records.commit`, the one store entry every owner's prepared commit
 * reaches (the Host's commit observer wraps the same object afterwards,
 * `src/composition/commit-observer.ts:79–90`, with the same spread), and
 * `records.readMany`, which is the real closure unless an armed read fault
 * names one of its keys, and `records.lookupOrdered`, whose index name is the
 * same fault's key. `lookupCommit`, `eventAt`, counts and text search are the
 * real closures, untouched.
 *
 * The control, `commitBarrier`:
 *   - `hold(match)` → `{ reached, release }`. The first commit that matches
 *     (once per hold; holds are tried in creation order and one commit takes at
 *     most one hold) resolves `reached` with a copy of its prepared commit, then
 *     waits until `release()`; then the real commit runs and the caller gets
 *     the real receipt (or the real throw) unchanged. `release()` before the
 *     commit arrives lets it through at once (`reached` still resolves).
 *   - `holdAfter(match)` → the same handle on the other side of the store: the
 *     matching commit runs at once, `reached` resolves after the real commit
 *     has answered, and the caller gets that real receipt (or throw) unchanged
 *     only after `release()`. A pre-commit `hold` never stands in for it.
 *   - A commit that no open hold matches goes straight to the real commit,
 *     also while another commit is held.
 *   - `failReads(refKey, effect)` → `{ calls, release }`. Every `readMany` that
 *     asks for `refKey`, and every `lookupOrdered` whose index is `refKey`,
 *     while the fault is armed is counted; `throw-once` makes the first of them
 *     throw an I/O error, `throw-always` every one, and a thrown read reaches
 *     no store. Every other read is the real one.
 *   - `failCommitOnce(match)` → `{ release }`. The first matching commit throws
 *     an I/O error instead of reaching the store, so it does not land; every
 *     other commit is the real one.
 *   - `reset()` releases every held commit, forgets every hold, disarms every
 *     fault and returns the labels of the holds that were still unreleased
 *     (`[]` when the test released everything). Call it before closing the
 *     platform: a held commit keeps a tracked call open and `platform.close()`
 *     waits for it.
 *   - `unreleased()` lists them without releasing; `assertAllReleased()`
 *     throws listing them.
 * So the platform produces every fact itself; the test only chooses where one
 * real store call the platform made waits or fails, in three plain cases:
 *   - before the commit: a `hold` stops a prepared commit after the owner's
 *     reads (for a request command: after the picking reads) and before the
 *     store's compare-and-swap;
 *   - after its answer: a `holdAfter` lets the commit run and holds the
 *     store's answer, a receipt or a rejection, until `release()`;
 *   - one failed store call: an armed fault fails a matching `readMany`,
 *     `lookupOrdered` or commit with an I/O error, and that call reaches no store.
 *
 * Predicates over the prepared commit's own fields (`PreparedCommit`,
 * `src/core/record-store/ports.ts:110`; `claims` are `UniqueClaimChange`s,
 * `:85`, checked by `validateUniqueClaims`, `commit-extensions.ts:56`):
 *   - `byIdentityPrefix(prefix)`: `identityKey` starts with `prefix`;
 *   - `byClaimPrefix(prefix)`: some claim change's `claimKey` starts with `prefix`;
 *   - `byClaimMove(prefix)`: the same, and that change moves the owner
 *     (`expectedOwner !== nextOwner`); a no-op claim CAS does not match;
 *   - `allOf(...matches)`.
 * This fixture names no 6A claim key or identity: the rows pass the prefixes.
 *
 * Wiring (`vi.mock` is hoisted per test file, so the test file owns the mocks,
 * as `tests/app/RL-33-workbench-resource-caps.test.ts:21` does; the factory
 * imports this module dynamically and so shares the test's `commitBarrier`):
 *
 *   import { commitBarrier, byClaimMove } from '../helpers/S6A-commit-barrier.js';
 *   vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
 *     (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
 *   vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
 *     (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
 *   afterEach(async () => {
 *     const left = commitBarrier.reset();   // first: releases anything still held
 *     await closeWorlds();
 *     expect(left).toEqual([]);
 *   });
 *
 * Every backend built while the mocks are installed is wrapped (the
 * platform's, and any a helper builds directly); without a hold or a fault
 * they behave exactly as the real ones.
 */
import type {
  GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt,
} from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';

type InMemoryModule = typeof import('../../src/core/record-store/in-memory-record-store.js');
type SqliteModule = typeof import('../../src/core/record-store/sqlite-record-store.js');

export type CommitMatch = (commit: PreparedCommit) => boolean;

export type CommitHold = {
  /** Resolves with a copy of the held prepared commit once one matches (after it ran, for `holdAfter`). */
  readonly reached: Promise<PreparedCommit>;
  /** Lets the held commit (or the next match, if none arrived yet) reach the real store, or its answer return. */
  release(): void;
};

/** A read fault on one record key (or one ordered-lookup index name); `calls()` counts the reads that asked for it while armed. */
type ReadFault = { calls(): number; release(): void };

/** A one-shot commit fault; `release()` disarms it if it has not fired. */
type CommitFault = { release(): void };

type HoldEntry = {
  readonly label: string;
  readonly match: CommitMatch;
  /** The real commit runs first and only its answer waits. */
  readonly afterCommit: boolean;
  matched: boolean;
  released: boolean;
  readonly resolveReached: (commit: PreparedCommit) => void;
  readonly gate: Promise<void>;
  readonly open: () => void;
};

type ReadFaultEntry = { readonly refKey: string; readonly always: boolean; calls: number; released: boolean };
type CommitFaultEntry = { readonly match: CommitMatch; fired: boolean; released: boolean };

export class CommitBarrier {
  private entries: HoldEntry[] = [];
  private readFaults: ReadFaultEntry[] = [];
  private commitFaults: CommitFaultEntry[] = [];
  private created = 0;

  /** Hold the first commit `match` accepts until `release()`; `label` names it in reports. */
  hold(match: CommitMatch, label?: string): CommitHold {
    return this.add(match, label, false);
  }

  /** Let the first commit `match` accepts run, then hold its answer until `release()`. */
  holdAfter(match: CommitMatch, label?: string): CommitHold {
    return this.add(match, label, true);
  }

  private add(match: CommitMatch, label: string | undefined, afterCommit: boolean): CommitHold {
    let resolveReached!: (commit: PreparedCommit) => void;
    const reached = new Promise<PreparedCommit>(resolve => { resolveReached = resolve; });
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    this.created += 1;
    const entry: HoldEntry = { label: label ?? `hold #${this.created}`, match, afterCommit, matched: false,
      released: false, resolveReached, gate, open };
    this.entries.push(entry);
    return { reached, release: () => { entry.released = true; entry.open(); } };
  }

  /**
   * Fail the `readMany` calls that ask for `refKey`, or the `lookupOrdered` calls naming it as their index: the first
   * one (`throw-once`) or every one (`throw-always`).
   */
  failReads(refKey: string, effect: 'throw-once' | 'throw-always'): ReadFault {
    const entry: ReadFaultEntry = { refKey, always: effect === 'throw-always', calls: 0, released: false };
    this.readFaults.push(entry);
    return { calls: () => entry.calls, release: () => { entry.released = true; } };
  }

  /** Fail the first commit `match` accepts before it reaches the store. */
  failCommitOnce(match: CommitMatch): CommitFault {
    const entry: CommitFaultEntry = { match, fired: false, released: false };
    this.commitFaults.push(entry);
    return { release: () => { entry.released = true; } };
  }

  /** The labels of the holds not yet released (reached or not). */
  unreleased(): string[] {
    return this.entries.filter(entry => !entry.released).map(entry => entry.label);
  }

  assertAllReleased(): void {
    const left = this.unreleased();
    if (left.length > 0) throw new Error(`S6A commit barrier: holds left unreleased: ${left.join(', ')}`);
  }

  /** Release every held commit, forget every hold and fault; returns the hold labels that were still unreleased. */
  reset(): string[] {
    const left = this.unreleased();
    for (const entry of this.entries) { entry.released = true; entry.open(); }
    for (const fault of [...this.readFaults, ...this.commitFaults]) fault.released = true;
    this.entries = [];
    this.readFaults = [];
    this.commitFaults = [];
    this.created = 0;
    return left;
  }

  /** The wrapped `records.readMany` body: count and fail a read of an armed key, else the real read itself. */
  read<T>(refKeys: readonly string[], real: (refKeys: readonly string[]) => Promise<T>): Promise<T> {
    if (this.readFaults.length === 0) return real(refKeys);
    let fail = false;
    for (const fault of this.readFaults) {
      if (fault.released || !refKeys.includes(fault.refKey)) continue;
      fault.calls += 1;
      if (fault.always || fault.calls === 1) fail = true;
    }
    return fail ? Promise.reject(new Error('S6A commit barrier: injected readMany I/O failure')) : real(refKeys);
  }

  /** The wrapped `records.commit` body: fail or hold a matching commit, otherwise run the real one. */
  async pass(input: PreparedCommit, real: (input: PreparedCommit) => Promise<StoreCommitReceipt>):
    Promise<StoreCommitReceipt> {
    const fault = this.commitFaults.find(candidate => !candidate.released && !candidate.fired && candidate.match(input));
    if (fault !== undefined) {
      fault.fired = true;
      throw new Error('S6A commit barrier: injected commit I/O failure');
    }
    const entry = this.entries.find(candidate => !candidate.matched && candidate.match(input));
    if (entry === undefined) return real(input);
    entry.matched = true;
    // The real backend copies its input on entry; copy here too, so neither the
    // caller nor the test can change the commit while it waits.
    const held = structuredClone(input);
    if (entry.afterCommit) {
      const answer = real(held);
      await answer.catch(() => undefined);
      entry.resolveReached(structuredClone(held));
      await entry.gate;
      return answer;
    }
    entry.resolveReached(structuredClone(held));
    await entry.gate;
    return real(held);
  }
}

/** The one shared barrier the mocked factories and the test file use. */
export const commitBarrier = new CommitBarrier();

export function byIdentityPrefix(prefix: string): CommitMatch {
  return commit => typeof commit.identityKey === 'string' && commit.identityKey.startsWith(prefix);
}

export function byClaimPrefix(prefix: string): CommitMatch {
  return commit => Array.isArray(commit.claims)
    && commit.claims.some(claim => typeof claim.claimKey === 'string' && claim.claimKey.startsWith(prefix));
}

export function byClaimMove(prefix: string): CommitMatch {
  return commit => Array.isArray(commit.claims) && commit.claims.some(claim =>
    typeof claim.claimKey === 'string' && claim.claimKey.startsWith(prefix) && claim.expectedOwner !== claim.nextOwner);
}

export function allOf(...matches: CommitMatch[]): CommitMatch {
  return commit => matches.every(match => match(commit));
}

type BarrierBackend = {
  readonly records: Pick<GoalRecordTransactionPort, 'commit' | 'readMany'>
    & Pick<RecordOrderedLookupPort, 'lookupOrdered'>;
};

/** Both backends build `records` from closures without `this`, so the spread keeps every other method. */
function withBarrier<B extends BarrierBackend>(backend: B): B {
  const real = backend.records;
  return { ...backend, records: { ...real,
    readMany: (refKeys: readonly string[]) => commitBarrier.read(refKeys, keys => real.readMany(keys)),
    lookupOrdered: (request: Parameters<RecordOrderedLookupPort['lookupOrdered']>[0]) =>
      commitBarrier.read([request.index], () => real.lookupOrdered(request)),
    commit: (input: PreparedCommit) => commitBarrier.pass(input, next => real.commit(next)) } };
}

/** `vi.mock` factory for `src/core/record-store/in-memory-record-store.js`. */
export async function inMemoryBarrierModule(importOriginal: () => Promise<unknown>): Promise<InMemoryModule> {
  const actual = await importOriginal() as InMemoryModule;
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<InMemoryModule['createInMemoryRecordBackend']>[0]) =>
      withBarrier(actual.createInMemoryRecordBackend(options)) };
}

/** `vi.mock` factory for `src/core/record-store/sqlite-record-store.js`. */
export async function sqliteBarrierModule(importOriginal: () => Promise<unknown>): Promise<SqliteModule> {
  const actual = await importOriginal() as SqliteModule;
  return { ...actual,
    createSqliteRecordBackend: (options: Parameters<SqliteModule['createSqliteRecordBackend']>[0]) =>
      withBarrier(actual.createSqliteRecordBackend(options)) };
}
