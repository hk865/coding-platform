/** Independent acceptance of the catalog's idempotency windows. The controlled
 * interleaving uses two services over the same real backend, never a fabricated
 * successful receipt. No sleeps, global locks or production test hooks. */
import { afterEach, describe, expect, it } from 'vitest';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { AdoptInitialArchitectureInput } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/architecture/contracts.js';
import { createGraphSessionFixture, sampleCatalog,
  type GraphRecords, type GraphSessionFixture } from '../helpers/graph-session-fixture.js';

const fixtures: GraphSessionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function requestFor(f: GraphSessionFixture, requestId: string): GraphWrite<AdoptInitialArchitectureInput> {
  return { input: { baselineId: 'independent-baseline', description: 'Original adopted architecture',
    constraints: [], catalog: sampleCatalog(f.projectId) }, meta: { requestId, expected: [
    { ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 },
  ] } };
}

describe.each(['memory', 'sqlite'] as const)('A1 independent catalog interleavings over %s', kind => {
  it('replays the original result when an identical request commits after lookup and before the scope read', async () => {
    const f = await createGraphSessionFixture(kind);
    fixtures.push(f);
    const request = requestFor(f, 'same-identity-same-input');
    let interleaved = false;
    let original: Awaited<ReturnType<typeof f.catalog.adoptInitialArchitecture>> | undefined;
    const records: GraphRecords = { ...f.records,
      async readMany(keys) {
        if (!interleaved) {
          interleaved = true;
          // The outer service's early lookup already returned not_found. The
          // peer now creates the active pointer before the outer scope read.
          original = await f.catalog.adoptInitialArchitecture(f.ctx, request);
          expect(original).toMatchObject({ status: 'committed', replayed: false });
        }
        return f.records.readMany(keys);
      },
    };
    const service = createArchitectureCatalogService({ records });
    const result = await service.adoptInitialArchitecture(f.ctx, request);
    expect(interleaved).toBe(true);
    expect(result).toEqual({ ...original, replayed: true });
    // The same retry must not manufacture a second adoption event or write.
    expect(f.spy.prepared.filter(batch => batch.events.some(event =>
      event.eventType === 'ArchitectureCatalogAdopted'))).toHaveLength(1);
  });

  it.each(['before_scope_read', 'before_commit'] as const)(
    'preserves idempotency_conflict for different input that commits %s', async window => {
      const f = await createGraphSessionFixture(kind);
      fixtures.push(f);
      const originalRequest = requestFor(f, `same-identity-different-input-${window}`);
      const changedRequest = structuredClone(originalRequest);
      changedRequest.input.description = 'A different proposed architecture';
      let interleaved = false;
      const acceptPeer = async () => {
        if (interleaved) return;
        interleaved = true;
        expect(await f.catalog.adoptInitialArchitecture(f.ctx, originalRequest))
          .toMatchObject({ status: 'committed', replayed: false });
      };
      const records: GraphRecords = { ...f.records,
        async readMany(keys) {
          if (window === 'before_scope_read') await acceptPeer();
          return f.records.readMany(keys);
        },
        async commit(batch) {
          if (window === 'before_commit') await acceptPeer();
          return f.records.commit(batch);
        },
      };
      const service = createArchitectureCatalogService({ records });
      expect(await service.adoptInitialArchitecture(f.ctx, changedRequest))
        .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      expect(interleaved).toBe(true);
      const current = await f.catalog.readArchitectureRevision(f.ctx, { selection: { kind: 'current' } });
      expect(current).toMatchObject({ status: 'ready', value: {
        baseline: { content: { description: originalRequest.input.description } },
      } });
    },
  );
});
