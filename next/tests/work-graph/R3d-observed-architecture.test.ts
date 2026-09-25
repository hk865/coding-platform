/** R3d acceptance against real WorkspaceTools, body stores and record backends. */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { WorkspaceToolsPort } from '../../src/core/workspace/ports.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { actor, capture, context, fixture, projectId, workspace, mappings } from './R3d-fixture.js';

describe.each(['memory', 'sqlite'] as const)('R3d observed architecture %s', kind => {
  it('persists a source graph and reads its cycle and unresolved edges after capture expiry or restart', async () => {
    const fx = await fixture(kind);
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, capture('graph-a'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      await fx.workspaceTools.releaseCapture(context, captured.value.capture);
      await fx.reopen();
      const fresh = createObservedArchitecture(fx.deps());
      const selection = { kind: 'observed' as const, capture: captured.value };
      const page = await fresh.queryArchitecture(context, { selection, depth: 2,
        relations: ['dependency'], page: { limit: 1 } });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.noVerdict).toBe(true);
      expect(page.value.nodes.length).toBeLessThanOrEqual(1);
      expect(page.value.nextCursor).not.toBeNull();
      const second = await fresh.queryArchitecture(context, { selection, depth: 2,
        relations: ['dependency'], page: { limit: 20, cursor: page.value.nextCursor! } });
      expect(second.status).toBe('ready');
      if (second.status === 'ready') {
        const all = [...page.value.nodes, ...second.value.nodes];
        expect(all.map(node => node.nodeId).sort()).toEqual(['module:Alpha', 'module:Beta']);
        expect([...page.value.edges, ...second.value.edges].map(edge => [edge.fromNode, edge.toNode])).toEqual(
          expect.arrayContaining([['module:Alpha', 'module:Beta'], ['module:Beta', 'module:Alpha']]));
        expect([...page.value.unresolved, ...second.value.unresolved]).toContain('unresolved import: src/alpha.ts:2 -> ./missing');
      }
      const formal = await fx.readRecord({ aggregateType: 'ProjectArchitectureBaselineActive', projectId });
      expect(formal.status).toBe('ready');
      if (formal.status === 'ready') expect(formal.value.records).toEqual([]);
    } finally { await fx.close(); }
  });

  it('replays the first observed receipt without recapturing and compares only mechanical changes', async () => {
    const fx = await fixture(kind);
    try {
      let captureCalls = 0;
      const original = fx.workspaceTools;
      const counting: WorkspaceToolsPort = { ...original,
        async captureSourceChanges(ctx, input) { captureCalls++; return original.captureSourceChanges(ctx, input); } };
      const service = createObservedArchitecture({ ...fx.deps(), workspace: counting });
      const first = await service.captureSourceChanges(context, capture('same-request'));
      expect(first.status).toBe('committed');
      if (first.status !== 'committed') return;
      const count = captureCalls;
      await fx.edit('src/beta.ts', 'export function beta() { return 2; }\n');
      const replay = await service.captureSourceChanges(context, capture('same-request'));
      expect(replay).toMatchObject({ status: 'committed', replayed: true, value: first.value });
      expect(captureCalls).toBe(count);
      const changed = await service.captureSourceChanges(context, {
        ...capture('changed-request'), input: { ...capture('changed-request').input, previous: first.value },
      });
      expect(changed.status).toBe('committed');
      if (changed.status !== 'committed') return;
      const comparison = await service.compareArchitecture(context, {
        before: { kind: 'observed', capture: first.value },
        after: { kind: 'observed', capture: changed.value },
      });
      expect(comparison.status).toBe('ready');
      if (comparison.status === 'ready') {
        expect(comparison.value.noVerdict).toBe(true);
        expect(comparison.value.changes.length).toBeGreaterThan(0);
      }
      const impact = await service.queryImpact(context, { selection: { kind: 'observed', capture: first.value },
        changed: [{ kind: 'node', nodeId: 'module:Beta' }], page: { limit: 1 } });
      expect(impact.status).toBe('ready');
      if (impact.status === 'ready') expect(impact.value.affected.length).toBeGreaterThan(0);
    } finally { await fx.close(); }
  });

  it('checks current Host scope and read permission before opening a persisted body', async () => {
    const fx = await fixture(kind);
    try {
      const created = await createObservedArchitecture(fx.deps()).captureSourceChanges(context, capture('private-graph'));
      expect(created.status).toBe('committed');
      if (created.status !== 'committed') return;
      let bodyReads = 0;
      const bodyPort: RawArtifactStorePort = { ...fx.deps().bodies,
        async read(ref) { bodyReads++; return fx.deps().bodies.read(ref); } };
      const service = createObservedArchitecture({ ...fx.deps(), bodies: bodyPort });
      const other: CoreCallContext = { ...context, workspaceId: 'another-workspace',
        materialReader: { kind: 'host', projectId, workspaceId: 'another-workspace', actor } };
      const selection = { kind: 'observed' as const, capture: created.value };
      expect(await service.queryArchitecture(other, { selection, depth: 1, relations: ['dependency'],
        page: { limit: 10 } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(bodyReads).toBe(0);
      fx.revoke();
      expect(await service.queryArchitecture(context, { selection, depth: 1, relations: ['dependency'],
        page: { limit: 10 } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(bodyReads).toBe(0);
    } finally { await fx.close(); }
  });

  it('does not publish an observation if source changes after the immutable body is saved', async () => {
    const fx = await fixture(kind);
    try {
      const underlying = fx.deps().bodies;
      const changingBodies: RawArtifactStorePort = {
        async put(input) {
          const saved = await underlying.put(input);
          await fx.edit('src/beta.ts', 'export function beta() { return 3; }\n');
          return saved;
        },
        read: ref => underlying.read(ref),
      };
      const service = createObservedArchitecture({ ...fx.deps(), bodies: changingBodies });
      const result = await service.captureSourceChanges(context, capture('source-changed-before-commit'));
      expect(result).toMatchObject({ status: 'rejected', code: 'source_stale' });
      const current = await fx.readRecord({ aggregateType: 'WorkspaceArchitectureObservationCurrent', ...workspace });
      expect(current.status).toBe('ready');
      if (current.status === 'ready') expect(current.value.records).toEqual([]);
    } finally { await fx.close(); }
  });

  it('rejects a damaged persisted graph body instead of treating it as an empty graph', async () => {
    const fx = await fixture(kind);
    try {
      const created = await createObservedArchitecture(fx.deps()).captureSourceChanges(context, capture('body-integrity'));
      expect(created.status).toBe('committed');
      if (created.status !== 'committed') return;
      const underlying = fx.deps().bodies;
      const damagedBodies: RawArtifactStorePort = {
        put: input => underlying.put(input),
        async read(ref) {
          const stored = await underlying.read(ref);
          if (stored.status !== 'ready') return stored;
          // Fault injection at the physical read boundary; the Store and the
          // original committed bytes are otherwise real in both backends.
          return { status: 'ready', value: { ...stored.value, body: '{"truncated":' } };
        },
      };
      const reader = createObservedArchitecture({ ...fx.deps(), bodies: damagedBodies });
      const result = await reader.queryArchitecture(context, { selection: { kind: 'observed', capture: created.value },
        depth: 1, relations: ['dependency'], page: { limit: 10 } });
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await fx.close(); }
  });
});
