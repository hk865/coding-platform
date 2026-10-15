/**
 * Slice 2C row 2C-15 (LE3): the answering copy of a line (M6, §3.4, L24).
 *
 * A real consultation message is sent through the mailbox, the readonly copy is
 * admitted through the Session directory, and its QueryRun is claimed through
 * the real Query owners (`beginConsultationCopy`); the answer or the unknown
 * outcome is recorded through the real `recordQueryObservation`. Assertions read
 * only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { WorkLineStore } from '../../src/core/work-graph/views/work-line-reader.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

/** L1/N1 (review item 4a): record every `lookup` so the copy branch's reads are observable. */
function recordingLookups(store: WorkLineStore): { records: WorkLineStore; calls: { index: string; values: readonly unknown[] }[] } {
  const calls: { index: string; values: readonly unknown[] }[] = [];
  return { calls, records: { ...store,
    async lookup(request) {
      calls.push({ index: request.index, values: request.values });
      return store.lookup(request);
    } } };
}

describe.each(['memory', 'sqlite'] as const)('2C-15 answering copies (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-15 (1) an answering copy keeps the asked line standby, marks copy_answering and counts it working', async () => {
    const f = await lineFixture();
    const asked = (await f.createSession('s15-asked')).ref;
    const consultation = await f.runs.beginConsultationCopy(asked, 's15-c1');
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, asked);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.markers).toContainEqual({ kind: 'copy_answering', copies: [consultation.copy] });
    expect(row?.status.bucket).toBe('working');
    expect(rowOf(list.rows, consultation.copy)).toBeUndefined();
    expect(list.counts.working).toEqual({ status: 'exact', value: 1 });
  });

  it('2C-15 (2) after the answer the archived copy is standby and not counted', async () => {
    const f = await lineFixture();
    const asked = (await f.createSession('s15-answered-asked')).ref;
    const consultation = await f.runs.beginConsultationCopy(asked, 's15-c2');
    await f.runs.completeConsultation(consultation.queryRunRef, consultation.copy, 'answered', 's15-c2');
    await f.archive(consultation.copy);
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, asked);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.markers.some((marker) => marker.kind === 'copy_answering')).toBe(false);
    expect(row?.status.bucket).toBe('standby');
    expect(rowOf(list.rows, consultation.copy)).toBeUndefined();
    expect(list.counts.working).toEqual({ status: 'exact', value: 0 });
    expect(rowOf(list.rows, asked)?.status.bucket).toBe('standby');
  });

  it('2C-15 (3) an unknown copy outcome gives the line the unknown attention while it stays standby', async () => {
    const f = await lineFixture();
    const asked = (await f.createSession('s15-unknown-asked')).ref;
    const consultation = await f.runs.beginConsultationCopy(asked, 's15-c3');
    await f.runs.completeConsultation(consultation.queryRunRef, consultation.copy, 'unknown', 's15-c3');
    const list = ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, asked);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.attention?.code).toBe('unknown');
    expect(row?.status.attention?.reason.code).toBe('copy_unknown');
    expect(row?.status.bucket).toBe('standby');
    expect(rowOf(list.rows, consultation.copy)).toBeUndefined();
  });

  it('2C-15 (4) an answering copy Query start counts as the line last activity (L10)', async () => {
    const f = await lineFixture();
    const asked = (await f.createSession('s15-activity-asked')).ref;
    const consultation = await f.runs.beginConsultationCopy(asked, 's15-activity');
    // A future instant beats the fixture's real "now" createdAt.
    const at = '2027-06-01T12:00:00.000Z';
    await f.runs.completeConsultation(consultation.queryRunRef, consultation.copy, 'entered', 's15-activity',
      at, { now: () => at });
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, asked);
    expect(row?.lastActivityAt).toBe(at);
  });

  // L1/N1 (review item 4a): archived copies must not be enumerated at all. The
  // copy branch indexes the already-enumerated ACTIVE copies by source Session
  // instead of paging every historical `readonly_copy` of the chain.
  it('L1 (review item 4a) the copy branch does not scan the historical copy index', async () => {
    const f = await lineFixture();
    const asked = (await f.createSession('s15-bounded-asked')).ref;
    for (let index = 0; index < 3; index += 1) {
      const consultation = await f.runs.beginConsultationCopy(asked, `s15-bounded-${String(index)}`);
      await f.runs.completeConsultation(consultation.queryRunRef, consultation.copy, 'answered',
        `s15-bounded-${String(index)}`);
      await f.archive(consultation.copy);
    }

    const listRecorder = recordingLookups(f.records);
    ready(await f.readerWith(listRecorder.records).listWorkLines(f.ctx, { workspace: f.base.scope }));
    const listCopyScans = listRecorder.calls.filter((call) =>
      call.index === 's2c-session-by-kind-from' && call.values[2] === 'readonly_copy');
    expect(listCopyScans).toHaveLength(0);

    const detailRecorder = recordingLookups(f.records);
    ready(await f.readerWith(detailRecorder.records).readWorkLine(f.ctx, { workspace: f.base.scope, key: asked }));
    const detailCopyScans = detailRecorder.calls.filter((call) =>
      call.index === 's2c-session-by-kind-from' && call.values[2] === 'readonly_copy');
    expect(detailCopyScans).toHaveLength(0);
    // The non-list path reads the ACTIVE copies once through the lifecycle index.
    const activeCopyIndex = detailRecorder.calls.filter((call) =>
      call.index === 's2c-session-by-lifecycle-kind' && call.values[2] === 'active' && call.values[3] === 'readonly_copy');
    expect(activeCopyIndex).toHaveLength(1);
  });
});
