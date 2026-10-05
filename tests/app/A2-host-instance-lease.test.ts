/**
 * The Host instance lease file (docs/refactor/STATE-MACHINES-SPEC.md §12.8
 * HL-01..HL-06, A.2 step 5.6). The Host-level rows HL-02/HL-03/HL-07 run end to
 * end in `A2-host-restart.test.ts`; this file covers the lock-file rows a real
 * Host cannot reach on demand: a damaged lock (HL-04), a pid reused by a live
 * process (HL-05), a release after another Host took the lock over (HL-06),
 * two Hosts taking over one stale lock at the same time (HL-03 exclusive) and
 * a lock that cannot be written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireHostInstanceLease, HOST_INSTANCE_LOCK_FILE } from '../../src/app/host-instance-lease.js';

const AT = '2026-10-05T00:00:00.000Z';
const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function directory(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), 'a2-lease-'));
  temporary.push(created);
  return created;
}

describe('the Host instance lease file (HL-01..HL-06)', () => {
  it('an in-memory store has no other Host: owned without a file', async () => {
    const lease = await acquireHostInstanceLease({ directory: null, now: () => AT });
    expect(lease).toMatchObject({ lease: 'owned', row: 'memory', heldBy: null });
    await lease.release();
  });

  it('HL-01 creates the lock; HL-02/HL-05 a live (or reused) pid holds it; HL-06 only the holder removes it', async () => {
    const dir = await directory();
    const path = join(dir, HOST_INSTANCE_LOCK_FILE);
    const owner = await acquireHostInstanceLease({ directory: dir, now: () => AT, pid: 4242, isAlive: () => true });
    expect(owner).toMatchObject({ lease: 'owned', row: 'HL-01', heldBy: null });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ pid: 4242, hostInstanceId: owner.hostInstanceId, startedAt: AT });
    const other = await acquireHostInstanceLease({ directory: dir, now: () => AT, pid: 4343, isAlive: pid => pid === 4242 });
    expect(other).toMatchObject({ lease: 'held_by_other', row: 'HL-02',
      heldBy: { pid: 4242, hostInstanceId: owner.hostInstanceId } });
    await other.release();
    expect(existsSync(path), 'a Host that never held the lock leaves it').toBe(true);
    await owner.release();
    expect(existsSync(path)).toBe(false);
  });

  it('HL-03 takes over a lock whose pid is gone; the old instance can no longer remove it (HL-06)', async () => {
    const dir = await directory();
    const path = join(dir, HOST_INSTANCE_LOCK_FILE);
    const crashed = await acquireHostInstanceLease({ directory: dir, now: () => AT, pid: 5000, isAlive: () => true });
    const next = await acquireHostInstanceLease({ directory: dir, now: () => AT, pid: 6000, isAlive: pid => pid !== 5000 });
    expect(next).toMatchObject({ lease: 'owned', row: 'HL-03', reason: 'the stale lock of pid 5000 was taken over' });
    await crashed.release();
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ pid: 6000, hostInstanceId: next.hostInstanceId });
    await next.release();
    expect(existsSync(path)).toBe(false);
  });

  it('HL-03 is exclusive: two Hosts starting together on one stale lock leave exactly one owner, whose lock stays in place', async () => {
    for (let round = 0; round < 16; round += 1) {
      const dir = await directory();
      const path = join(dir, HOST_INSTANCE_LOCK_FILE);
      await writeFile(path, JSON.stringify({ pid: 5000, hostInstanceId: 'a2-crashed', startedAt: AT }));
      const contenders = await Promise.all([6001, 6002].map(pid =>
        acquireHostInstanceLease({ directory: dir, now: () => AT, pid, isAlive: candidate => candidate !== 5000 })));
      const owners = contenders.filter(lease => lease.lease === 'owned');
      expect(owners, `round ${String(round)}: ${JSON.stringify(contenders.map(lease => [lease.row, lease.reason]))}`).toHaveLength(1);
      const [owner] = owners;
      // The owner either moved the stale lock itself (HL-03) or created the lock right after the other Host moved it.
      expect(['HL-01', 'HL-03']).toContain(owner!.row);
      for (const other of contenders.filter(lease => lease !== owner)) {
        expect(other).toMatchObject({ lease: 'held_by_other', row: 'HL-02', heldBy: { hostInstanceId: owner!.hostInstanceId } });
        await other.release();
      }
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ hostInstanceId: owner!.hostInstanceId });
      await owner!.release();
      expect(existsSync(path)).toBe(false);
      expect(await readdir(dir), 'no own, moved-aside or stale file is left behind').toEqual([]);
    }
  });

  it.skipIf(process.getuid?.() === 0)('a lock that cannot be written is never left behind half written: HL-04, and the next start creates it', async () => {
    const dir = await directory();
    const path = join(dir, HOST_INSTANCE_LOCK_FILE);
    await chmod(dir, 0o555);
    try {
      const refused = await acquireHostInstanceLease({ directory: dir, now: () => AT });
      expect(refused).toMatchObject({ lease: 'held_by_other', row: 'HL-04', heldBy: null });
      expect(refused.reason).toMatch(/^the lock file could not be written: /);
      expect(existsSync(path)).toBe(false);
    } finally {
      await chmod(dir, 0o755);
    }
    const next = await acquireHostInstanceLease({ directory: dir, now: () => AT });
    expect(next).toMatchObject({ lease: 'owned', row: 'HL-01' });
    await next.release();
  });

  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['a non-positive pid', JSON.stringify({ pid: 0, hostInstanceId: 'h', startedAt: AT })],
    ['an empty instance id', JSON.stringify({ pid: 7, hostInstanceId: '', startedAt: AT })],
  ])('HL-04: a lock holding %s is held (never reconciled on a guess) and left in place', async (_label, content) => {
    const dir = await directory();
    const path = join(dir, HOST_INSTANCE_LOCK_FILE);
    await writeFile(path, content);
    const lease = await acquireHostInstanceLease({ directory: dir, now: () => AT, isAlive: () => false });
    expect(lease).toMatchObject({ lease: 'held_by_other', row: 'HL-04', heldBy: null });
    await lease.release();
    expect(await readFile(path, 'utf8')).toBe(content);
  });
});
