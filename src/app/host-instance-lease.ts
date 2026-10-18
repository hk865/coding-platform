/**
 * Host instance lease (STATE-MACHINES-SPEC §12.8 HL-01..HL-07, D-18, lead
 * decisions L-1 and L-10; A.2 step 5.6).
 *
 * One lock file beside the SQLite ledger, created with `O_EXCL`, holding
 * `{pid, hostInstanceId, startedAt}`:
 *
 * - HL-01: absent → created; this Host holds the lease. The content is
 *   written to this instance's own file and linked into place, so the lock is
 *   created exclusively (like `O_EXCL`) and is never seen half written;
 * - HL-02/HL-05: present and its pid answers `kill(pid, 0)` (alive, or a
 *   reused pid) → held by another Host;
 * - HL-03: present and its pid is gone → stale; it is moved aside with one
 *   `rename` (only one contender can move a given file), checked to be the
 *   stale lock that was read, removed, and the lock is created again
 *   exclusively, so two Hosts starting at once never both hold it (the
 *   takeover is the "old process is gone" proof D-5/D-6/D-11/D-12 need). A
 *   contender that moved a lock another Host had just created links it back
 *   and answers held. (Three or more Hosts started in the same instant can
 *   still interleave around that link-back; this local lock does not try to
 *   close that window, §12.8);
 * - HL-04: unreadable or damaged → held (the safe direction: never reconcile
 *   on a guess); a person deletes it after checking;
 * - HL-06: `release()` deletes the lock only when it still names this
 *   instance; a Host that never held it never touches it.
 *
 * A Host on an in-memory store has no other Host that could share it: it holds
 * the lease without a file. This is a local single-machine lock, never a
 * distributed one (§12.8).
 */
import { randomUUID } from 'node:crypto';
import { link, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostTakeoverProofV1 } from '../contracts/unknown-call-review.js';

export const HOST_INSTANCE_LOCK_FILE = 'host-instance.lock';

export type HostInstanceLockContent = { pid: number; hostInstanceId: string; startedAt: string };

export type HostInstanceLease = {
  hostInstanceId: string;
  /** `owned`: this Host reconciles and drives execution; otherwise reads and owner writes only (L-10). */
  lease: 'owned' | 'held_by_other';
  /** HL row of the acquisition, for the reconcile report. */
  row: 'HL-01' | 'HL-02' | 'HL-03' | 'HL-04' | 'memory';
  /** Who holds the lock when this Host does not (HL-02/HL-05); null when unreadable (HL-04) or owned. */
  heldBy: HostInstanceLockContent | null;
  /**
   * K3 (L2): the labeled proof that the previous Host is gone. HL-01 (no lock
   * existed) and HL-03 (a stale lock was taken over, with the old instance id
   * and pid) prove it; an in-memory store (`memory_store`) does not (L2); a
   * held lease has no proof (`null`).
   */
  takeover: HostTakeoverProofV1 | null;
  reason: string;
  /** HL-06: removes the lock file only while it still names this instance. */
  release(): Promise<void>;
};

export type HostInstanceLeaseOptions = {
  /** The SQLite ledger directory; null for an in-memory store. */
  directory: string | null;
  now(): string;
  /** Injectable for tests; defaults to this process. */
  pid?: number;
  /** HL-02 liveness: true when the pid answers signal 0 (alive or reused, HL-05). */
  isAlive?(pid: number): boolean;
};

/** Bounded retries of the create → inspect → move-aside loop when other Hosts race on the same lock. */
const MAX_ACQUIRE_ROUNDS = 4;

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to another user, so it is alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseLock(text: string): HostInstanceLockContent | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const pid = record['pid'];
  const hostInstanceId = record['hostInstanceId'];
  const startedAt = record['startedAt'];
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || typeof hostInstanceId !== 'string'
    || hostInstanceId.length === 0 || typeof startedAt !== 'string' || startedAt.length === 0) {
    return null;
  }
  return { pid, hostInstanceId, startedAt };
}

async function readLock(path: string): Promise<{ status: 'absent' } | { status: 'read'; content: HostInstanceLockContent | null }> {
  try {
    return { status: 'read', content: parseLock(await readFile(path, 'utf8')) };
  } catch (error) {
    return codeOf(error) === 'ENOENT' ? { status: 'absent' } : { status: 'read', content: null };
  }
}

export async function acquireHostInstanceLease(options: HostInstanceLeaseOptions): Promise<HostInstanceLease> {
  const hostInstanceId = randomUUID();
  const noop = async (): Promise<void> => { /* nothing held */ };
  if (options.directory === null) {
    return { hostInstanceId, lease: 'owned', row: 'memory', takeover: { kind: 'memory_store' },
      heldBy: null, reason: 'an in-memory store has no other Host', release: noop };
  }
  const directory = options.directory;
  const path = join(directory, HOST_INSTANCE_LOCK_FILE);
  const content: HostInstanceLockContent = { pid: options.pid ?? process.pid, hostInstanceId, startedAt: options.now() };
  const text = JSON.stringify(content);
  const isAlive = options.isAlive ?? defaultIsAlive;
  const release = async (): Promise<void> => {
    const current = await readLock(path);
    if (current.status === 'read' && current.content?.hostInstanceId === hostInstanceId) await rm(path, { force: true });
  };
  const held = (row: 'HL-02' | 'HL-04', heldBy: HostInstanceLockContent | null, reason: string): HostInstanceLease =>
    ({ hostInstanceId, lease: 'held_by_other', row, takeover: null, heldBy, reason, release: noop });
  /** The answer when another Host's lock is (now) in place. */
  const heldByCurrent = async (reason: string): Promise<HostInstanceLease> => {
    const current = await readLock(path);
    if (current.status === 'read' && current.content !== null && isAlive(current.content.pid)) {
      return held('HL-02', current.content, `another live process (pid ${String(current.content.pid)}) holds the store`);
    }
    return held('HL-04', current.status === 'read' ? current.content : null, reason);
  };

  // The lock content is written to this instance's own file first and then linked into place:
  // `link` creates the lock exclusively (EEXIST when present) and never exposes a half-written lock.
  const own = join(directory, `.${HOST_INSTANCE_LOCK_FILE}.${hostInstanceId}.new`);
  try {
    await writeFile(own, text, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    await rm(own, { force: true }).catch(() => undefined);
    return held('HL-04', null, `the lock file could not be written: ${messageOf(error)}`);
  }
  try {
    let takenOver: HostInstanceLockContent | null = null;
    for (let round = 0; round < MAX_ACQUIRE_ROUNDS; round += 1) {
      // HL-01 (and the second half of HL-03): create the lock exclusively.
      try {
        await link(own, path);
        if (takenOver === null) return { hostInstanceId, lease: 'owned', row: 'HL-01', takeover: { kind: 'hl01_no_lock' },
          heldBy: null, reason: 'the lock file was created', release };
        return { hostInstanceId, lease: 'owned', row: 'HL-03', takeover: { kind: 'hl03_stale_lock',
          previousInstanceId: takenOver.hostInstanceId, previousPid: takenOver.pid }, heldBy: null,
          reason: `the stale lock of pid ${String(takenOver.pid)} was taken over`, release };
      } catch (error) {
        if (codeOf(error) !== 'EEXIST') return held('HL-04', null, `the lock file could not be created: ${messageOf(error)}`);
      }
      const outcome = await inspect();
      if (outcome.kind === 'answer') return outcome.lease;
      if (outcome.kind === 'taken_over') takenOver = outcome.stale;
    }
    return await heldByCurrent('the lock kept changing while it was taken over; start again after checking no other Host runs');
  } finally {
    await rm(own, { force: true }).catch(() => undefined);
  }

  /**
   * The lock exists: answer HL-02/HL-04, or move a stale lock aside (HL-03) for
   * the next create; `retry` when it changed under this call.
   */
  async function inspect(): Promise<{ kind: 'answer'; lease: HostInstanceLease } | { kind: 'retry' }
    | { kind: 'taken_over'; stale: HostInstanceLockContent }> {
    const answer = (lease: HostInstanceLease) => ({ kind: 'answer' as const, lease });
    const existing = await readLock(path);
    if (existing.status === 'absent') return { kind: 'retry' };   // removed between the create and the read
    if (existing.content === null) {
      return answer(held('HL-04', null, 'the lock file is unreadable or damaged; delete it after checking no Host runs'));
    }
    const stale = existing.content;
    if (isAlive(stale.pid)) return answer(held('HL-02', stale, `another live process (pid ${String(stale.pid)}) holds the store`));
    // HL-03: move the stale lock aside; a rename moves a given file for exactly one contender.
    const aside = join(directory, `.${HOST_INSTANCE_LOCK_FILE}.${hostInstanceId}.stale`);
    try {
      await rename(path, aside);
    } catch (error) {
      if (codeOf(error) === 'ENOENT') return { kind: 'retry' };   // another contender moved it first
      return answer(held('HL-04', stale, `the stale lock could not be moved aside: ${messageOf(error)}`));
    }
    const moved = await readLock(aside);
    if (moved.status !== 'read' || moved.content?.hostInstanceId !== stale.hostInstanceId) {
      // What was moved is not the stale lock read above: another Host already took it over and
      // created its own. Put that lock back (`link` never replaces a newer one) and answer held.
      await link(aside, path).catch(() => undefined);
      await rm(aside, { force: true }).catch(() => undefined);
      return answer(await heldByCurrent('another Host took over the stale lock first'));
    }
    await rm(aside, { force: true });
    return { kind: 'taken_over', stale };
  }
}
