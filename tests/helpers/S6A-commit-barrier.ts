/**
 * Slice 6A-1 fixture (book §5.1; rows R-02, R-03a and the concurrency rows of
 * book §3.6.10): a commit barrier at the record-store backend boundary.
 *
 * What it is (rule sheet v1 A3 delegating wrapper, placed at the A4 backend
 * seam): `vi.mock` factories for the two real backend factories that
 * `createTargetPlatform` calls (`src/composition/create-platform.ts:678–680`),
 * `createInMemoryRecordBackend` (`src/core/record-store/in-memory-record-store.ts`)
 * and `createSqliteRecordBackend` (`src/core/record-store/sqlite-record-store.ts`).
 * Every real export survives. The factory builds the real backend and wraps
 * only `records.commit`, the one store entry every owner's prepared commit
 * reaches (the Host's commit observer wraps the same object afterwards,
 * `src/composition/commit-observer.ts:79–90`, with the same spread). Reads,
 * `lookupCommit`, lookups, counts and text search are the real closures,
 * untouched.
 *
 * The control, `commitBarrier`:
 *   - `hold(match)` → `{ reached, release }`. The first commit that matches
 *     (once per hold; holds are tried in creation order and one commit takes at
 *     most one hold) resolves `reached` with a copy of its prepared commit, then
 *     waits until `release()`; then the real commit runs and the caller gets
 *     the real receipt (or the real throw) unchanged. `release()` before the
 *     commit arrives lets it through at once (`reached` still resolves).
 *   - A commit that no open hold matches goes straight to the real commit,
 *     also while another commit is held.
 *   - `reset()` releases every held commit, forgets every hold and returns the
 *     labels of the holds that were still unreleased (`[]` when the test
 *     released everything). Call it before closing the platform: a held commit
 *     keeps a tracked call open and `platform.close()` waits for it.
 *   - `unreleased()` lists them without releasing; `assertAllReleased()`
 *     throws listing them.
 * So the platform produces every fact itself; the test only chooses when a
 * commit the platform prepared reaches the store, which is after the owner's
 * reads (for a request command: after the picking reads) and before the
 * store's compare-and-swap.
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
 * platform's, and any a helper builds directly); without a hold they behave
 * exactly as the real ones.
 */
import type { PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';

type InMemoryModule = typeof import('../../src/core/record-store/in-memory-record-store.js');
type SqliteModule = typeof import('../../src/core/record-store/sqlite-record-store.js');

export type CommitMatch = (commit: PreparedCommit) => boolean;

export type CommitHold = {
  /** Resolves with a copy of the held prepared commit once one matches. */
  readonly reached: Promise<PreparedCommit>;
  /** Lets the held commit (or the next match, if none arrived yet) reach the real store. */
  release(): void;
};

type HoldEntry = {
  readonly label: string;
  readonly match: CommitMatch;
  matched: boolean;
  released: boolean;
  readonly resolveReached: (commit: PreparedCommit) => void;
  readonly gate: Promise<void>;
  readonly open: () => void;
};

export class CommitBarrier {
  private entries: HoldEntry[] = [];
  private created = 0;

  /** Hold the first commit `match` accepts until `release()`; `label` names it in reports. */
  hold(match: CommitMatch, label?: string): CommitHold {
    let resolveReached!: (commit: PreparedCommit) => void;
    const reached = new Promise<PreparedCommit>(resolve => { resolveReached = resolve; });
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    this.created += 1;
    const entry: HoldEntry = { label: label ?? `hold #${this.created}`, match, matched: false, released: false,
      resolveReached, gate, open };
    this.entries.push(entry);
    return { reached, release: () => { entry.released = true; entry.open(); } };
  }

  /** The labels of the holds not yet released (reached or not). */
  unreleased(): string[] {
    return this.entries.filter(entry => !entry.released).map(entry => entry.label);
  }

  assertAllReleased(): void {
    const left = this.unreleased();
    if (left.length > 0) throw new Error(`S6A commit barrier: holds left unreleased: ${left.join(', ')}`);
  }

  /** Release every held commit, forget every hold; returns the labels that were still unreleased. */
  reset(): string[] {
    const left = this.unreleased();
    for (const entry of this.entries) { entry.released = true; entry.open(); }
    this.entries = [];
    this.created = 0;
    return left;
  }

  /** The wrapped `records.commit` body: hold a matching commit, then always run the real one. */
  async pass(input: PreparedCommit, real: (input: PreparedCommit) => Promise<StoreCommitReceipt>):
    Promise<StoreCommitReceipt> {
    const entry = this.entries.find(candidate => !candidate.matched && candidate.match(input));
    if (entry === undefined) return real(input);
    entry.matched = true;
    // The real backend copies its input on entry; copy here too, so neither the
    // caller nor the test can change the commit while it waits.
    const held = structuredClone(input);
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

type CommitBackend = { readonly records: { commit(input: PreparedCommit): Promise<StoreCommitReceipt> } };

/** Both backends build `records` from closures without `this`, so the spread keeps every other method. */
function withBarrier<B extends CommitBackend>(backend: B): B {
  const real = backend.records;
  return { ...backend, records: { ...real, commit: (input: PreparedCommit) => commitBarrier.pass(input, next => real.commit(next)) } };
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
