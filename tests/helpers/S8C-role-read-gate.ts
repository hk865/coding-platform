/**
 * Row 4: a local store/read gate for the RoleSpec key, plus a capture of every
 * prepared commit. It is the A3 delegating-wrapper pattern narrowed to what the
 * parallel-catalog-revision row needs: the test file installs the `vi.mock`
 * factory for the real in-memory backend factory, and the platform's own
 * `readMany`/`commit` still run. There is no production hook.
 *
 * `holdRead(match)` waits the first `readMany` whose ref keys the predicate
 * accepts, resolves `reached`, and lets the real read run only after
 * `release()`. `commits()` is a copy of the prepared commits the platform has
 * handed to the real store (before the store answers).
 */
import type { GoalRecordTransactionPort, PreparedCommit } from '../../src/core/record-store/ports.js';

type InMemoryModule = typeof import('../../src/core/record-store/in-memory-record-store.js');

export type RoleReadHold = {
  /** Resolves once one matching `readMany` is waiting at the gate. */
  readonly reached: Promise<void>;
  release(): void;
};

type HoldEntry = {
  readonly match: (refKeys: readonly string[]) => boolean;
  matched: boolean;
  released: boolean;
  readonly resolveReached: () => void;
  readonly gate: Promise<void>;
  readonly open: () => void;
};

class RoleReadGate {
  private entries: HoldEntry[] = [];
  private captured: PreparedCommit[] = [];

  /** Hold the first matching `readMany` until `release()`. */
  holdRead(match: (refKeys: readonly string[]) => boolean): RoleReadHold {
    let resolveReached!: () => void;
    const reached = new Promise<void>(resolve => { resolveReached = resolve; });
    let open!: () => void;
    const gate = new Promise<void>(resolve => { open = resolve; });
    const entry: HoldEntry = { match, matched: false, released: false, resolveReached, gate, open };
    this.entries.push(entry);
    return { reached, release: () => { entry.released = true; entry.open(); } };
  }

  /** The wrapped `readMany`: wait on the first matching hold, then the real read. */
  async read<T>(refKeys: readonly string[], real: (keys: readonly string[]) => Promise<T>): Promise<T> {
    for (const entry of this.entries) {
      if (entry.matched || entry.released || !entry.match(refKeys)) continue;
      entry.matched = true;
      entry.resolveReached();
      await entry.gate;
    }
    return real(refKeys);
  }

  /** The wrapped `commit`: capture the prepared commit, then the real commit. */
  record(commit: PreparedCommit): void {
    this.captured.push(structuredClone(commit));
  }

  commits(): readonly PreparedCommit[] {
    return [...this.captured];
  }

  /** Release every open hold and forget the holds and captured commits. */
  reset(): void {
    for (const entry of this.entries) { entry.released = true; entry.open(); }
    this.entries = [];
    this.captured = [];
  }
}

export const roleReadGate = new RoleReadGate();

type GateBackend = {
  readonly records: Pick<GoalRecordTransactionPort, 'commit' | 'readMany'>;
};

function withGate<B extends GateBackend>(backend: B): B {
  const real = backend.records;
  return { ...backend, records: { ...real,
    readMany: (refKeys: readonly string[]) => roleReadGate.read(refKeys, keys => real.readMany(keys)),
    commit: async (input: PreparedCommit) => {
      roleReadGate.record(input);
      return real.commit(input);
    } } };
}

/** `vi.mock` factory for `src/core/record-store/in-memory-record-store.js`. */
export async function inMemoryRoleGateModule(importOriginal: () => Promise<unknown>): Promise<InMemoryModule> {
  const actual = await importOriginal() as InMemoryModule;
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<InMemoryModule['createInMemoryRecordBackend']>[0]) =>
      withGate(actual.createInMemoryRecordBackend(options)) };
}
