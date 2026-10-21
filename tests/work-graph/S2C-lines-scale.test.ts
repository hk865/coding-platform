/**
 * Slice 2C row 2C-25 (LE5), daily small world: the same four cases as
 * `S2C-lines-scale.scale.test.ts` over a world that crosses every read layer at
 * seam I widths (`lookupPageLimit: 2`, `listPageLimit: 1`) and the public
 * archive `page.limit: 2`. The scale batch keeps the original sizes.
 *
 * Small world: 12 active heads (1 starting Run, 1 continuation successor, X, R,
 * W, Z, the replier, the picker, the two base heads and 2 filler heads), 1
 * active predecessor, 3 active copies (16 active Sessions), 5 archived heads
 * (1 continuation pair successor + 4 plain) plus its pair predecessor and 1
 * archived copy (7 archived Sessions), 8 R messages (last 2 replied), 4 W
 * anchors (last unclaimed), 3 Z Runs and X's 3 open responsible links (1 task +
 * 2 modules). Every count below is hand-written; no production constant or
 * function computes an expected value.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScaleFixture, type ScaleFixture } from '../helpers/S2C-X-scale-fixture.js';
import type { LineRowV1, WorkLineListV1 } from '../../src/contracts/work-line.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import type { RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function rowOf(rows: readonly LineRowV1[], ref: SessionRef): LineRowV1 {
  const row = rows.find((candidate) => candidate.key.sessionId === ref.sessionId);
  if (row === undefined) throw new Error(`no line row for ${ref.sessionId}`);
  return row;
}

function marker(row: LineRowV1, kind: 'undelivered') {
  const found = row.status.markers.find((entry) => entry.kind === kind);
  if (found === undefined || found.kind !== kind) throw new Error(`no ${kind} marker`);
  return found;
}

const KIND = ['memory', 'sqlite'] as const;

/**
 * A3 delegating wrapper: forwards every record-store call and every result
 * unchanged, and only observes the Run-by-task pages of the width-1 read loop.
 */
function recordingRunByTask(records: WorkLineStore, seen: RecordLookupRequest[]): WorkLineStore {
  return {
    readMany: (refKeys) => records.readMany(refKeys),
    lookupCommit: (input) => records.lookupCommit(input),
    commit: (input) => records.commit(input),
    eventAt: (cursor) => records.eventAt(cursor),
    lookup: (request) => {
      if (request.index === 'r4c-run-by-task' && request.limit === 1) {
        seen.push({ index: request.index, values: [...request.values], limit: request.limit,
          ...(request.after === undefined ? {} : { after: request.after }) });
      }
      return records.lookup(request);
    },
    lookupOrdered: (request) => records.lookupOrdered(request),
    countLookup: (request) => records.countLookup(request),
  };
}

/** The daily sizes; every value is deliberately small but crosses a page at the injected widths. */
const SMALL = {
  activeHeads: 12,
  startingHeads: 1,
  activePairs: 1,
  activeCopies: 3,
  archivedHeads: 5,
  archivedPairs: 1,
  archivedCopies: 1,
  xParticipates: 0,
  xResponsibleModules: 2,
  workTasks: 1,
  rMessages: 8,
  wAnchors: 4,
  zRuns: 2,
  lookupPageLimit: 2,
  listPageLimit: 1,
  // Controlled archive clock by the fixture's archive order: pair predecessor,
  // pair successor/head, four plain heads, archived copy. See case (2).
  archiveClock: (index: number) =>
    `2026-09-24T00:00:0${['5', '0', '1', '2', '3', '4', '6'][index] ?? '0'}.000Z`,
} as const;

describe.each(KIND)('2C-25 small (%s)', (kind) => {
  let fixture: ScaleFixture;
  beforeAll(async () => { fixture = await buildScaleFixture(kind, SMALL); });
  afterAll(async () => { if (fixture !== undefined) await fixture.close(); });

  const list = async (reader = fixture.reader) =>
    ready(await reader.listWorkLines(fixture.ctx, { workspace: fixture.scope })) as WorkLineListV1;

  it('2C-25 (1) (small: 12 active heads, 5 archived) the four buckets and the archived formula are the hand-computed counts', async () => {
    const lines = await list();
    // Active heads: 1 starting + 1 continuation successor + 6 named (X, R, W,
    // Z, replier, picker) + 2 base + 2 filler = 12; only the starting head is
    // working, so standby is 11. The active-Session window holds those 12 heads
    // + 1 predecessor + 3 active copies = 16 Sessions, width 2 => 8 pages, in
    // ascending sessionId bytes (8-hex prefix): [055198e9, 06bb2ace],
    // [22f49bd3, 29866ef0], [2e83e7df, 356f34bb], [42da6590, 6d6c211d],
    // [6edbaa7c, 7f91feec], [83b8fd3e, 89dc9107], [8ab793a2, a63653f9],
    // [c9bd91d8, d8f2952d].
    // The copy index is built in memory from these same 16 Sessions, so this
    // case performs NO dedicated active-copy-index read; the archive-list path
    // in case (2) is the one that reads it (3 copies, width 2 => [2,1]).
    expect(lines.rows).toHaveLength(12);
    expect(lines.counts.working).toEqual({ status: 'exact', value: 1 });
    expect(lines.counts.standby).toEqual({ status: 'exact', value: 11 });
    // Archived formula: S = 6 (4 plain heads + the pair predecessor + the pair
    // successor; the archived readonly copy is not counted); F = 2 (the
    // distinct `from` of the active and the archived continuation successors);
    // A = 1 (the active predecessor is an active Session with a successor)
    // => C = 6 - (2 - 1) = 5.
    expect(lines.counts.archived).toMatchObject({ status: 'exact', value: 5 });
    expect(lines.counts.archived.asOf).not.toBeNull();
    expect(lines.legacyUnchecked).toEqual({ status: 'exact', value: 0 });
    expect(lines.attentionComplete).toBe(true);

    // X has 3 open responsible links: the task plus two modules. Their refKeys
    // are canonicalJson values sorted by UTF-8 bytes, and `target.kind` puts
    // `module` before `task`, so at width 2 the read pages are
    // [module 1, module 2] and [task]; the decisive task link is the only item
    // on page 2. Only the task link appears in `responsibleNow`.
    const x = rowOf(lines.rows, fixture.x);
    expect(x.responsibleNow).toHaveLength(1);
    expect(x.problem).toBeNull();
    expect(x.sessionCount).toEqual({ status: 'exact', value: 1 });
  });

  it('2C-25 (2) (small: 5 archived heads, page 2) pages all five by archive time descending, no gaps or dupes', async () => {
    const collected: LineRowV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = ready(await fixture.reader.listArchivedLines(fixture.ctx, {
        workspace: fixture.scope,
        page: cursor === undefined ? { limit: 2 } : { limit: 2, cursor },
      }));
      expect(page.withoutArchivedAt).toMatchObject({ status: 'exact', value: 0 });
      collected.push(...page.rows);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(collected).toHaveLength(5);
    expect(new Set(collected.map((row) => row.key.sessionId)).size).toBe(5);

    // Controlled clock, not a store read. The fixture's archive order is
    // [pair predecessor(5), pair successor/head(0), plain 1(1), plain 2(2),
    // plain 3(3), plain 4(4), archived copy(6)], so descending archivedAt is
    // [copy(6), predecessor(5), plain 4(4), plain 3(3), plain 2(2), plain 1(1),
    // pair successor(0)]. `readArchivedPage` drops the readonly copy and the
    // predecessor (it has a continuation successor) and keeps the 5 heads:
    // page.limit 2 therefore returns head counts [0, 2, 2, 1] over four
    // candidate pages, and the last head (the pair successor) is on page 4.
    // The times are distinct, so the store's sessionId-descending tie-break is
    // not needed here; an equal pair would order the larger sessionId first.
    const expectedOrder = [4, 3, 2, 1, 0].map((index) => fixture.archivedHeads[index]!.sessionId);
    expect(collected.map((row) => row.key.sessionId)).toEqual(expectedOrder);

    // Every `listArchivedLines` call assembles its page without the active copy
    // index, so each of the four calls performs the dedicated active-copy read:
    // 3 copies at lookupPageLimit 2 => [2, 1] (2 pages).
  });

  it('2C-25 (3) (small: 8 messages, 4 anchors) at the default budget R has two undelivered replies and W one pending anchor', async () => {
    const runLookups: RecordLookupRequest[] = [];
    const lines = await list(fixture.readerWith(recordingRunByTask(fixture.deps.records, runLookups)));
    // Message scan at width 1: [1], [2], [3], [4], [5], [6], [7], [8]. The last
    // two in refKey order (7 and 8) are the replied ones; they are on the last
    // two pages, so the decisive message 8 is on the last page.
    // Budget: R's empty anchor read 1 + 8 message pages x 3 units (source
    // Session read + continuation probe + message page) = 25, below 100.
    const r = rowOf(lines.rows, fixture.r);
    const undelivered = marker(r, 'undelivered');
    expect(undelivered.count).toMatchObject({ status: 'exact', value: 2 });
    expect(r.status.partialParts).toEqual([]);

    // Anchor scan at width 1: [1], [2], [3], [4]; the refKey-last anchor is on
    // the fourth page and has no picker. Entered-Run reads at width 1: the three
    // picked tasks have 2 Runs each, so each reads [original Run] then [picker]
    // (1 lookup + a 1-key read = 2 units per page, 4 per task); the unpicked
    // task has 1 Run, one page, 2 units. Total with the four anchor pages:
    // 4 + 3*4 + 2 = 18, below budget 100.
    const w = rowOf(lines.rows, fixture.w);
    expect(w.status.attention?.code).toBe('unknown');
    expect(w.status.attention?.reason.code).toBe('anomaly_pending');
    expect(w.status.attentionCounts.unknown).toBe(1);
    expect(w.status.attentionComplete).toBe(true);
    expect(w.status.partialParts).toEqual([]);

    // The Run-by-task loop at width 1, in read order, one group per anchored
    // task: each of the three picked tasks has 2 Runs ([original Run] then
    // [picker]) => 2 pages and its continuation request (the one with `after`);
    // the unpicked task has only its original Run => 1 page and no continuation.
    // Pages are therefore 2, 2, 2, 1 (7 lookup requests in all).
    const perTask: { taskId: string; pages: number; continuations: number }[] = [];
    for (const request of runLookups) {
      const taskId = String(request.values[2]);
      let entry = perTask.find((candidate) => candidate.taskId === taskId);
      if (entry === undefined) {
        entry = { taskId, pages: 0, continuations: 0 };
        perTask.push(entry);
      }
      entry.pages += 1;
      if (request.after !== undefined) entry.continuations += 1;
    }
    expect(perTask.map((entry) => entry.taskId).sort()).toEqual(['w-00', 'w-01', 'w-02', 'w-03']);
    expect(perTask.map((entry) => entry.pages)).toEqual([2, 2, 2, 1]);
    expect(perTask.map((entry) => entry.continuations)).toEqual([1, 1, 1, 0]);
    expect(runLookups).toHaveLength(7);
  });

  it('2C-25 (4) (small: budget 10) turns R and W partial, never 0, and leaves Z unchanged', async () => {
    const normal = await list();
    const small = fixture.readerWith(fixture.deps.records, 10);
    const lines = await list(small);

    // R: 1 unit for the empty anchor page, then pages 1-3 cost 3 units each,
    // so the budget is exactly 10 before page 4. Pages 4-8 are denied, and both
    // replied messages (7 and 8) are on pages 7 and 8 => partial, at least 0.
    const r = rowOf(lines.rows, fixture.r);
    const undelivered = marker(r, 'undelivered');
    expect(undelivered.count).toMatchObject({ status: 'partial', atLeast: 0 });
    expect(r.status.partialParts.some((part) => part.part === 'undelivered')).toBe(true);

    // W: four anchor pages cost 1 each; the first picked task's two pages cost
    // 2 each and the second task's first page costs 2, reaching 10; that task's
    // second page (the picker) is denied: 4 + 2 + 2 + 2 = 10. The anchor layer
    // stops partial with no known attention and an incomplete read.
    const w = rowOf(lines.rows, fixture.w);
    expect(w.status.attention).toBeNull();
    expect(w.status.attentionComplete).toBe(false);
    expect(w.status.partialParts.some((part) => part.part === 'written_anchors')).toBe(true);
    // W's zero is a partial, not "none".
    expect(w.status.attentionCounts.unknown).toBe(0);

    // Z's T* Runs are the shared, unbudgeted cost, not this line's budget.
    expect(rowOf(lines.rows, fixture.z).status).toEqual(rowOf(normal.rows, fixture.z).status);

    // L10's read-incomplete tier sits after every known-attention row and before
    // every complete no-attention row.
    const index = lines.rows.findIndex((row) => row.key.sessionId === fixture.w.sessionId);
    expect(index).toBeGreaterThan(-1);
    const before = lines.rows.slice(0, index);
    const after = lines.rows.slice(index + 1);
    expect(before.every((row) => row.status.attention !== null
      || (row.status.attentionComplete === false && row.status.attention === null))).toBe(true);
    expect(after.every((row) => row.status.attention === null && row.status.attentionComplete === true)).toBe(true);
  });
});
