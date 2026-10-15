/**
 * Slice 2C row 2C-25 (LE5, amendment A2): the 5,000-Session workspace.
 *
 * Built once per backend by `buildScaleFixture` through the real public
 * services; the only storage-boundary writes are amendment A2's picker Runs and
 * `T*`'s 2,999 cloned Runs (2A QA-17's coordinator-ruled exception, reported
 * under UNSPECIFIED). Every assertion reads the public `WorkLineReadPort`.
 *
 * Amendment A2 is the last test: one unlimited-budget `lines/list` per backend
 * with the per-line L1b budgeted reads and the shared-cost reads/times printed,
 * not asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildScaleFixture, countAcceptedCalls, countingRecords, measureBudgetedReads, S2C_SCALE_TIMEOUT_MS,
  S2C_UNLIMITED_BUDGET, type ScaleFixture,
} from '../helpers/S2C-X-scale-fixture.js';
import type { LineRowV1, WorkLineListV1 } from '../../src/contracts/work-line.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';

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

describe.each(KIND)('2C-25 scale (%s)', (kind) => {
  let fixture: ScaleFixture;
  beforeAll(async () => { fixture = await buildScaleFixture(kind); }, S2C_SCALE_TIMEOUT_MS);
  afterAll(async () => { if (fixture !== undefined) await fixture.close(); });

  const list = async (reader = fixture.reader) =>
    ready(await reader.listWorkLines(fixture.ctx, { workspace: fixture.scope })) as WorkLineListV1;

  it('2C-25 (1) the four line buckets and the archived formula are the hand-computed counts', async () => {
    const lines = await list();
    expect(lines.rows).toHaveLength(1_100);
    expect(lines.counts.working).toEqual({ status: 'exact', value: 100 });
    expect(lines.counts.standby).toEqual({ status: 'exact', value: 1_000 });
    expect(lines.counts.archived).toMatchObject({ status: 'exact', value: 2_750 });
    expect(lines.counts.archived.asOf).not.toBeNull();
    expect(lines.legacyUnchecked).toEqual({ status: 'exact', value: 0 });
    expect(lines.attentionComplete).toBe(true);

    // X crosses the old 2,000-link card capacity and still reports its one
    // responsible task with no row problem.
    const x = rowOf(lines.rows, fixture.x);
    expect(x.responsibleNow).toHaveLength(1);
    expect(x.problem).toBeNull();
    expect(x.sessionCount).toEqual({ status: 'exact', value: 1 });
  }, S2C_SCALE_TIMEOUT_MS);

  it('2C-25 (2) lines/archived pages all 2,750 rows by archive time descending, no gaps or dupes', async () => {
    const collected: LineRowV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = ready(await fixture.reader.listArchivedLines(fixture.ctx, {
        workspace: fixture.scope,
        page: cursor === undefined ? { limit: 50 } : { limit: 50, cursor },
      }));
      expect(page.withoutArchivedAt).toMatchObject({ status: 'exact', value: 0 });
      collected.push(...page.rows);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(collected).toHaveLength(2_750);
    expect(new Set(collected.map((row) => row.key.sessionId)).size).toBe(2_750);

    const withAt: { head: SessionRef; archivedAt: string }[] = [];
    for (const head of fixture.archivedHeads) {
      const card = await fixture.f.base.sessionsPort.readSession(fixture.ctx, head);
      if (card.status !== 'ready') throw new Error(`archived head read failed: ${JSON.stringify(card)}`);
      const archivedAt = card.value.record.archivedAt;
      if (archivedAt === null || archivedAt === undefined) throw new Error(`archived head ${head.sessionId} has no archivedAt`);
      withAt.push({ head, archivedAt });
    }
    withAt.sort((left, right) => left.archivedAt === right.archivedAt
      ? (left.head.sessionId > right.head.sessionId ? -1 : 1)
      : (left.archivedAt > right.archivedAt ? -1 : 1));
    // L5: `listArchivedLines` keeps the archive-time-descending order of
    // `readArchivedPage` (group X passes `order: 'given'` to the assembly), so
    // the page rows match the archivedAt order read back through the port.
    expect(collected.map((row) => row.key.sessionId)).toEqual(withAt.map((entry) => entry.head.sessionId));
  }, S2C_SCALE_TIMEOUT_MS);

  it('2C-25 (3) at the default budget R reports two undelivered replies and W one pending anchor', async () => {
    const lines = await list();
    const r = rowOf(lines.rows, fixture.r);
    const undelivered = marker(r, 'undelivered');
    expect(undelivered.count).toMatchObject({ status: 'exact', value: 2 });
    expect(r.status.partialParts).toEqual([]);

    const w = rowOf(lines.rows, fixture.w);
    expect(w.status.attention?.code).toBe('unknown');
    expect(w.status.attention?.reason.code).toBe('anomaly_pending');
    expect(w.status.attentionCounts.unknown).toBe(1);
    expect(w.status.attentionComplete).toBe(true);
    expect(w.status.partialParts).toEqual([]);
  }, S2C_SCALE_TIMEOUT_MS);

  it('2C-25 (4) a budget of 10 turns R and W partial, never 0, and leaves Z unchanged', async () => {
    const normal = await list();
    const small = fixture.readerWith(fixture.deps.records, 10);
    const lines = await list(small);

    const r = rowOf(lines.rows, fixture.r);
    const undelivered = marker(r, 'undelivered');
    expect(undelivered.count).toMatchObject({ status: 'partial', atLeast: 0 });
    expect(r.status.partialParts.some((part) => part.part === 'undelivered')).toBe(true);

    const w = rowOf(lines.rows, fixture.w);
    expect(w.status.attention).toBeNull();
    expect(w.status.attentionComplete).toBe(false);
    expect(w.status.partialParts.some((part) => part.part === 'written_anchors')).toBe(true);
    // W's zero is a partial, not "none".
    expect(w.status.attentionCounts.unknown).toBe(0);

    // Z's T* Runs are the shared cost, not this line's budget.
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
  }, S2C_SCALE_TIMEOUT_MS);

  it('A2 measured on this build (printout, not asserted)', async () => {
    const lines = await list(fixture.readerUnlimited);
    const budgeted = new Map<string, number>();
    for (const row of lines.rows) {
      budgeted.set(row.key.sessionId, await measureBudgetedReads(fixture, row.key));
    }
    const ordinary = lines.rows
      .filter((row) => row.key.sessionId !== fixture.r.sessionId && row.key.sessionId !== fixture.w.sessionId)
      .map((row) => budgeted.get(row.key.sessionId) ?? 0);
    const m = Math.max(...ordinary);
    const r = (await countAcceptedCalls(fixture, fixture.r, S2C_UNLIMITED_BUDGET))
      - (await countAcceptedCalls(fixture, fixture.r, 2)) + 2;
    const w = budgeted.get(fixture.w.sessionId) ?? 0;
    const z = budgeted.get(fixture.z.sessionId) ?? 0;
    budgeted.set(fixture.r.sessionId, r);

    const counted = countingRecords(fixture.deps.records);
    const started = performance.now();
    const shared = ready(await fixture.readerWith(counted.records, 1_000_000_000)
      .listWorkLines(fixture.ctx, { workspace: fixture.scope }));
    const sharedMs = performance.now() - started;
    const tally = new Map<string, number>();
    for (const call of counted.calls) {
      const name = call.kind === 'readMany' ? `readMany(${String(call.records)})`
        : `${call.kind}:${'index' in call ? call.index : ''}`;
      tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    // eslint-disable-next-line no-console
    console.log(`[A2 ${kind}] m=${String(m)} r=${String(r)} w=${String(w)} z=${String(z)}`
      + ` sharedCalls=${String(counted.calls.length)} sharedMs=${sharedMs.toFixed(0)} rows=${String(shared.rows.length)}`);
    const totalBudgeted = [...budgeted.values()].reduce((sum, value) => sum + value, 0);
    // eslint-disable-next-line no-console
    console.log(`[A2 ${kind}] perLineBudgeted`, JSON.stringify(Object.fromEntries([...budgeted.entries()].sort())));
    // eslint-disable-next-line no-console
    console.log(`[A2 ${kind}] fullListCalls=${String(counted.calls.length)} budgetedSum=${String(totalBudgeted)}`
      + ` nonBudgeted(sum incl. open work)=${String(counted.calls.length - totalBudgeted)} sharedMs=${sharedMs.toFixed(0)}`);
    // eslint-disable-next-line no-console
    console.log(`[A2 ${kind}] shared tally`, JSON.stringify(Object.fromEntries([...tally.entries()].sort())));
    expect(m).toBeGreaterThan(0);
  }, S2C_SCALE_TIMEOUT_MS);
});
