/** Independent reviewer cases. These exercise existing ports and real Stores;
 * no alternate lifecycle or catalog implementation is supplied by the tests. */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import {
  createGraphSessionFixture, GRAPH_MODULE_ONE, linkRequest,
  type GraphSessionFixture,
} from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function make(kind: 'memory' | 'sqlite') {
  const f = await createGraphSessionFixture(kind); fixtures.push(f); return f;
}
const key = (ref: unknown) => canonicalJson(ref as JsonValue);

describe.each(['memory', 'sqlite'] as const)('A1 independent %s review', kind => {
  it('rechecks a current catalog pointer that changes between pointer and revision reads', async () => {
    const f = await make(kind);
    const adopted = await f.adopt('before-reader-race');
    expect(adopted.status).toBe('committed');
    if (adopted.status !== 'committed') return;
    const currentCatalog = adopted.value.catalog;
    expect(currentCatalog).not.toBeNull();
    if (currentCatalog === null) return;
    const pointerKey = key({ aggregateType: 'ProjectArchitectureBaselineActive', projectId: f.projectId });
    let moved = false;
    let advanced: ArchitectureRevision | undefined;
    const records = { ...f.records, async readMany(refs: readonly string[]) {
      const read = await f.records.readMany(refs);
      // Mutation occurs after the real pointer read has completed, before the
      // service can fetch the pointed-to immutable revision. A readMany that
      // already contains all related facts is a coherent window and needs no
      // extra gate; this seam only targets the discovery read.
      if (!moved && refs.includes(pointerKey) && !refs.some(ref => JSON.parse(ref).aggregateType === 'ArchitectureBaselineRevision')) {
        moved = true;
        const revised = await f.catalog.reviseArchitectureCatalog(f.ctx, {
          input: { basedOn: { ref: adopted.value.baseline.ref, digest: adopted.value.baseline.contentDigest },
            catalog: currentCatalog.catalog, reason: 'advance the pointer between reads' },
          meta: { requestId: 'after-reader-race',
            expected: [{ ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
        });
        expect(revised.status).toBe('committed');
        if (revised.status === 'committed') advanced = revised.value;
      }
      return read;
    } };
    const result = await createArchitectureCatalogService({ records }).readArchitectureRevision(f.ctx,
      { selection: { kind: 'current' } });
    expect(moved).toBe(true);
    expect(advanced).toBeDefined();
    if (result.status === 'rejected') expect(result.code).toBe('source_stale');
    else {
      expect(result.status).toBe('ready');
      if (result.status !== 'ready' || advanced === undefined) return;
      expect(result.value.baseline.ref).toEqual(advanced.baseline.ref);
      expect(result.value.catalog).not.toBeNull();
      expect(result.value.catalog?.ref).toEqual(advanced.catalog?.ref);
    }
  });

  it('paginates distributed relations without rescanning the complete target on every page', async () => {
    const f = await make(kind);
    expect(await f.adopt('bounded-pages-adopt')).toMatchObject({ status: 'committed' });
    const target = { kind: 'module' as const, ref: f.moduleRef(GRAPH_MODULE_ONE) };
    const expected = new Set<string>();
    const relations = ['responsible', 'participates', 'investigated'] as const;
    for (let i = 0; i < 64; i++) {
      const session = await f.createSession(`bounded-page-${i}`); expected.add(session.sessionId);
      for (const relation of relations) {
        expect(await f.lifecycle.linkSessionWork(f.ctx,
          await linkRequest(f, session, target, relation, true, `bounded-link-${i}-${relation}`)))
          .toMatchObject({ status: 'committed' });
      }
    }
    const all: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      f.resetSpy();
      const result = await f.sessionsPort.findSessions(f.ctx, { workspace: f.scope, target, includeArchived: false,
        page: { limit: 5, ...(cursor === undefined ? {} : { cursor }) } });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') return;
      // 192 target links exist. A generous fixed budget of 96 returned rows
      // includes lookup streams, fetched Session facts and SessionCard links;
      // even one complete target scan exceeds it. No index names or timing
      // thresholds are assumed. Small pages must do bounded candidate work.
      expect(f.spy.lookupRecords + f.spy.readManyRecords).toBeLessThanOrEqual(96);
      expect(result.value.items.length).toBeLessThanOrEqual(5);
      all.push(...result.value.items.map(card => card.record.ref.sessionId));
      if (result.value.nextCursor === null) break;
      expect(result.value.nextCursor).not.toBe(cursor);
      cursor = result.value.nextCursor;
    }
    expect(all).toHaveLength(expected.size);
    expect(new Set(all)).toEqual(expected);
  });
});
