/**
 * Slice 2C row 2C-14 (LE3): the hand-written D1 dataset and its literal counts
 * (spec §3.5, L5, L10, L24, B4).
 *
 * The dataset is built by the exported `buildD1` fixture in
 * `tests/helpers/S2C-L-line-support.ts` (also used by group W's route test)
 * through the real public services; the one storage-boundary exception is the
 * legacy Session L (§7). A failed read is injected only through the storage
 * wrappers. Assertions read only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import {
  buildD1, failingLookup, failingLookupOrdered, failingReadMany, openLineFixture, rowOf, type LineFixture,
} from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('2C-14 D1 counts and ordering (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-14 (1) the literal D1 counts are working 3, standby 6 and the archived range', async () => {
    const f = await lineFixture();
    const d1 = await buildD1(f);
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.counts.working).toEqual({ status: 'exact', value: 3 });
    expect(list.counts.standby).toEqual({ status: 'exact', value: 6 });
    expect(list.counts.archived).toEqual({ status: 'partial', atLeast: 1, atMost: 2,
      reason: '1 legacy Session(s) without provenance', asOf: expect.any(String) });

    const row = (ref: SessionRef) => rowOf(list.rows, ref);
    expect(row(d1.a)?.status.bucket).toBe('working');
    expect(row(d1.b)?.status.bucket).toBe('working');
    expect(row(d1.g)?.status.bucket).toBe('working');
    expect(row(d1.g)?.status.own).toBe('standby');
    expect(row(d1.g)?.status.markers).toContainEqual({ kind: 'copy_answering', copies: [d1.gCopy] });
    expect(row(d1.c)?.status.own).toBe('waiting_reply');
    expect(row(d1.d)?.status.own).toBe('done');
    expect(row(d1.e)?.status.own).toBe('retired');
    expect(row(d1.f2)?.status.bucket).toBe('standby');
    expect(row(d1.h)?.status.own).toBe('paused');
    expect(row(d1.l)?.status.own).toBe('standby');
    // Copies and the retired predecessor are not separate lines.
    expect(row(d1.gCopy)).toBeUndefined();
    expect(row(d1.k)).toBeUndefined();
    expect(row(d1.f1)).toBeUndefined();
    expect(list.rows).toHaveLength(9);
  });

  it('2C-14 (2) a pinned line sorts first and the rest follow by attention then latest activity', async () => {
    const f = await lineFixture();
    const d1 = await buildD1(f);
    await f.setPins([d1.l], []);
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    expect(list.rows[0]?.key.sessionId).toBe(d1.l.sessionId);
    expect(list.rows[0]?.pinned).toBe(true);
    const unpinned = list.rows.slice(1);
    for (let index = 1; index < unpinned.length; index += 1) {
      const earlier = unpinned[index - 1]!;
      const later = unpinned[index]!;
      expect(earlier.lastActivityAt >= later.lastActivityAt).toBe(true);
    }
  });

  it('2C-14 (3) a failed occupancy Run read makes A a problem row and the active counts partial', async () => {
    const f = await lineFixture();
    const d1 = await buildD1(f);
    const wrapped = failingReadMany(f.records, (keys) => keys.includes(d1.aRunKey));
    const reader = f.readerWith(wrapped.records);
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const a = rowOf(list.rows, d1.a);
    expect(a?.problem).toEqual({ code: 'unavailable', reason: 'injected readMany failure' });
    expect(a?.status.bucket).toBeNull();
    expect(list.counts.working.status).toBe('partial');
    expect(list.counts.standby.status).toBe('partial');
    if (list.counts.working.status !== 'partial' || list.counts.standby.status !== 'partial') throw new Error('partial expected');
    expect(list.counts.working.atLeast).toBeLessThan(3);
  });

  it('2C-14 (4) B4 precedes B1: a failed closed-links read makes archived I a problem row', async () => {
    const f = await lineFixture();
    const d1 = await buildD1(f);
    const wrapped = failingLookupOrdered(f.records, 's2c-closed-task-links');
    const reader = f.readerWith(wrapped.records);
    const page = ready(await reader.listArchivedLines(f.ctx, { workspace: f.base.scope, page: { limit: 10 } }));
    const i = rowOf(page.rows, d1.i);
    expect(i?.problem).toEqual({ code: 'unavailable', reason: 'injected s2c-closed-task-links ordered read failure' });
    expect(i?.status.bucket).toBeNull();
    expect(i?.status.archivedTag).not.toBe('retired');
  });

  it('2C-14 (5) a whole failed active page returns the rejection, never an empty list', async () => {
    const f = await lineFixture();
    await buildD1(f);
    const wrapped = failingLookup(f.records, 'session-by-workspace-lifecycle');
    const result = await f.readerWith(wrapped.records).listWorkLines(f.ctx, { workspace: f.base.scope });
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('rejection expected');
    expect(result.code).toBe('unavailable');
  });
});
