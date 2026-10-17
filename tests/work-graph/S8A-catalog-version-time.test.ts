/**
 * Slice 8A (decision 72 post-note 4B ①): a catalog revision record binds the
 * commit cursor of its own `ArchitectureCatalogRevised` event, so
 * `notes.listCatalogVersions` shows the real `occurredAt` and reason instead of
 * the 4B placeholder nulls. Old records without the binding still read
 * `at: null, reason: null`.
 *
 * The fixture is the real 4A one (public `reviseArchitectureCatalog` and the
 * production `platform.notes` holder). Everything is checked through the public
 * reads only: the catalog writer takes the wall clock (`new Date()`), so the
 * bound `at` is bracketed by ISO timestamps taken just before and after the
 * revise call. No record port, no event decode and no database read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createS4ANoteFixture, type S4ANoteFixture } from '../helpers/S4A-note-fixture.js';

describe.each(['memory', 'sqlite'] as const)('S8A catalog version time over real %s RecordStore', kind => {
  let fixture: S4ANoteFixture | null = null;
  afterEach(async () => { await fixture?.close(); fixture = null; });

  it('binds the revised record to its event cursor so the list shows that event time and reason', async () => {
    fixture = await createS4ANoteFixture(kind);
    const f = fixture;
    const ctx = f.ctx();

    const current = await f.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
    // The initial adoption has no binding: the legacy placeholder is null.
    expect(current.value.catalog.since).toBe(null);

    const t0 = new Date().toISOString();
    const revised = await f.platform.architecture.reviseArchitectureCatalog(ctx, {
      meta: { requestId: 's8a-catalog-time', expected: [{ ref: f.projectRef, revision: 1 },
        { ref: f.workspaceRef, revision: 1 }] },
      input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
        catalog: structuredClone(current.value.catalog.catalog), reason: 's8a bound reason' } });
    const t1 = new Date().toISOString();
    expect(revised.status).toBe('committed');
    if (revised.status !== 'committed') return;

    // The stored revision row binds exactly this commit's cursor.
    const after = await f.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.catalog?.since).toBe(revised.cursor);

    const page = await f.platform.notes.listCatalogVersions(ctx, { limit: 50, cursor: null });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    expect(page.value.items.map(item => item.revision)).toEqual([2, 1]);
    const newest = page.value.items[0]!;
    expect(newest.revision).toBe(2);
    // The writer took the wall clock, so the bound event time must fall between
    // the timestamps taken around the revise call (both are ISO strings).
    const at = newest.at;
    if (typeof at !== 'string') throw new Error('the newest catalog version has no bound time');
    expect(t0 <= at && at <= t1).toBe(true);
    expect(newest.reason).toBe('s8a bound reason');
    // The cursor stays opaque: the public item never carries it.
    expect(JSON.stringify(newest)).not.toContain(String(revised.cursor));

    const legacy = page.value.items[1]!;
    expect([legacy.revision, legacy.at, legacy.reason]).toEqual([1, null, null]);
    expect(legacy.reasonLabel).toBe('原因记在目录修订里，第 8 片接上后显示');
    expect(page.value.complete).toBe(true);
  });

  it('returns the bound cursor in the revision write result, equal to the current read', async () => {
    fixture = await createS4ANoteFixture(kind);
    const f = fixture;
    const ctx = f.ctx();

    const current = await f.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
    expect(current.value.catalog.since).toBe(null);

    const revised = await f.platform.architecture.reviseArchitectureCatalog(ctx, {
      meta: { requestId: 's8a-catalog-write-since', expected: [{ ref: f.projectRef, revision: 1 },
        { ref: f.workspaceRef, revision: 1 }] },
      input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
        catalog: structuredClone(current.value.catalog.catalog), reason: 's8a write since' } });
    expect(revised.status).toBe('committed');
    if (revised.status !== 'committed') return;
    expect(revised.value.catalog?.since).not.toBeNull();

    const after = await f.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(revised.value.catalog?.since).toBe(after.value.catalog?.since);
  });
});
