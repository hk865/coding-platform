/** Independent acceptance of the catalog's idempotency windows. The controlled
 * interleaving uses two services over the same real backend, never a fabricated
 * successful receipt. No sleeps, global locks or production test hooks.
 * KLS-2b: knowledge writes of one project run one at a time (the write queue), so
 * the peer started inside the outer write waits for it and commits second. */
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
  it('an identical request started inside the first one replays its result once it has committed', async () => {
    const f = await createGraphSessionFixture(kind);
    fixtures.push(f);
    const request = requestFor(f, 'same-identity-same-input');
    let peer: ReturnType<typeof f.catalog.adoptInitialArchitecture> | undefined;
    const records: GraphRecords = { ...f.records,
      async readMany(keys) {
        // The outer service's early lookup already returned not_found; the peer
        // starts here and waits in the write queue behind the outer write.
        peer ??= f.catalog.adoptInitialArchitecture(f.ctx, request);
        return f.records.readMany(keys);
      },
    };
    const service = createArchitectureCatalogService({ records, knowledge: f.knowledge });
    const result = await service.adoptInitialArchitecture(f.ctx, request);
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    expect(peer).toBeDefined();
    expect(await peer).toEqual({ ...result, replayed: true });
    // The same retry must not manufacture a second adoption event or write.
    expect(f.spy.prepared.filter(batch => batch.events.some(event =>
      event.eventType === 'ArchitectureCatalogAdopted'))).toHaveLength(1);
  });

  it.each(['before_scope_read', 'before_commit'] as const)(
    'a different input with the same identity started %s commits second and is an idempotency_conflict', async window => {
      const f = await createGraphSessionFixture(kind);
      fixtures.push(f);
      const originalRequest = requestFor(f, `same-identity-different-input-${window}`);
      const changedRequest = structuredClone(originalRequest);
      changedRequest.input.description = 'A different proposed architecture';
      let peer: ReturnType<typeof f.catalog.adoptInitialArchitecture> | undefined;
      const startPeer = (): void => { peer ??= f.catalog.adoptInitialArchitecture(f.ctx, originalRequest); };
      const records: GraphRecords = { ...f.records,
        async readMany(keys) {
          if (window === 'before_scope_read') startPeer();
          return f.records.readMany(keys);
        },
        async commit(batch) {
          if (window === 'before_commit') startPeer();
          return f.records.commit(batch);
        },
      };
      const service = createArchitectureCatalogService({ records, knowledge: f.knowledge });
      expect(await service.adoptInitialArchitecture(f.ctx, changedRequest))
        .toMatchObject({ status: 'committed', replayed: false });
      expect(peer).toBeDefined();
      expect(await peer).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      const current = await f.catalog.readArchitectureRevision(f.ctx, { selection: { kind: 'current' } });
      expect(current).toMatchObject({ status: 'ready', value: {
        baseline: { content: { description: changedRequest.input.description } },
      } });
    },
  );
});
