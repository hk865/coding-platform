/** R3d observed-source boundary acceptance, using the same real fixture as the main tests. */
import { describe, expect, it } from 'vitest';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { capture, context, fixture, mappings, workspace } from './R3d-fixture.js';

describe.each(['memory', 'sqlite'] as const)('R3d observed boundaries %s', kind => {
  it('binds a graph cursor to its source and query, while permitting a later page size', async () => {
    const fx = await fixture(kind);
    try {
      const service = createObservedArchitecture(fx.deps());
      const first = await service.captureSourceChanges(context, capture('cursor-first'));
      expect(first.status).toBe('committed');
      if (first.status !== 'committed') return;
      const firstSelection = { kind: 'observed' as const, capture: first.value };
      const page = await service.queryArchitecture(context, { selection: firstSelection,
        depth: 2, relations: ['dependency'], page: { limit: 1 } });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.nextCursor).not.toBeNull();
      const cursor = page.value.nextCursor!;
      expect(await service.queryArchitecture(context, { selection: firstSelection,
        depth: 2, relations: ['dependency'], page: { limit: 20, cursor } })).toMatchObject({ status: 'ready' });
      expect(await service.queryArchitecture(context, { selection: firstSelection,
        depth: 1, relations: ['dependency'], page: { limit: 20, cursor } })).toMatchObject({ status: 'rejected' });
      expect(await service.queryArchitecture(context, { selection: firstSelection,
        depth: 2, relations: ['interface'], page: { limit: 20, cursor } })).toMatchObject({ status: 'rejected' });
      await fx.edit('src/beta.ts', 'export function beta() { return 2; }\n');
      const second = await service.captureSourceChanges(context, { ...capture('cursor-second'),
        input: { ...capture('cursor-second').input, previous: first.value } });
      expect(second.status).toBe('committed');
      if (second.status !== 'committed') return;
      expect(await service.queryArchitecture(context, { selection: { kind: 'observed', capture: second.value },
        depth: 2, relations: ['dependency'], page: { limit: 20, cursor } })).toMatchObject({ status: 'rejected' });
    } finally { await fx.close(); }
  });

  it('walks reverse dependencies through a cycle and terminates without duplicate impact', async () => {
    const fx = await fixture(kind);
    try {
      await fx.edit('src/gamma.ts', 'import { alpha } from "./alpha";\nexport function gamma() { return alpha(); }\n');
      const graphMappings = [...mappings, { id: 'Gamma', kind: 'module' as const, paths: ['src/gamma.ts'] }];
      const service = createObservedArchitecture(fx.deps());
      const observed = await service.captureSourceChanges(context, { ...capture('impact-direction'),
        input: { workspace, mappings: graphMappings, previous: null } });
      expect(observed.status).toBe('committed');
      if (observed.status !== 'committed') return;
      const selection = { kind: 'observed' as const, capture: observed.value };
      const beta = await service.queryImpact(context, { selection,
        changed: [{ kind: 'node', nodeId: 'module:Beta' }], page: { limit: 20 } });
      expect(beta.status).toBe('ready');
      if (beta.status !== 'ready') return;
      const impacted = beta.value.affected.filter(anchor => anchor.kind === 'node').map(anchor => anchor.nodeId);
      expect(impacted).toEqual(expect.arrayContaining(['module:Alpha', 'module:Gamma']));
      expect(new Set(impacted).size).toBe(impacted.length);
      expect(beta.value.nextCursor).toBeNull();
      const gamma = await service.queryImpact(context, { selection,
        changed: [{ kind: 'node', nodeId: 'module:Gamma' }], page: { limit: 20 } });
      expect(gamma.status).toBe('ready');
      if (gamma.status === 'ready') {
        const downstream = gamma.value.affected.filter(anchor => anchor.kind === 'node').map(anchor => anchor.nodeId);
        expect(downstream).not.toContain('module:Alpha');
        expect(downstream).not.toContain('module:Beta');
      }
    } finally { await fx.close(); }
  });

  it('rechecks current path grants even when Host authorization still succeeds', async () => {
    const fx = await fixture(kind);
    try {
      const service = createObservedArchitecture(fx.deps());
      const observed = await service.captureSourceChanges(context, capture('path-revocation'));
      expect(observed.status).toBe('committed');
      if (observed.status !== 'committed') return;
      fx.allowOnly(['tsconfig.json', 'src/beta.ts']);
      const access = await fx.deps().access.open(context,
        { aggregateType: 'Workspace', ...workspace });
      expect(access.status).toBe('ready');
      if (access.status === 'ready') {
        expect(access.value.authorization.allowsRead('src/alpha.ts')).toBe(false);
        await access.value.release();
      }
      const history = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: observed.value },
        depth: 2, relations: ['dependency'], page: { limit: 20 } });
      expect(history).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await fx.close(); }
  });

  it('rejects any changed field of the complete persisted capture reference', async () => {
    const fx = await fixture(kind);
    try {
      const service = createObservedArchitecture(fx.deps());
      const observed = await service.captureSourceChanges(context, capture('tamper-source'));
      expect(observed.status).toBe('committed');
      if (observed.status !== 'committed') return;
      const source = observed.value;
      const altered = [
        { ...source, capture: { ...source.capture, sourceDigest: '0'.repeat(64) } },
        { ...source, capture: { ...source.capture, configDigest: '0'.repeat(64) } },
        { ...source, capture: { ...source.capture, indexVersion: 'other-engine' } },
        { ...source, material: { ...source.material, digest: '0'.repeat(64) } },
      ];
      for (const changed of altered) {
        const result = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: changed },
          depth: 1, relations: ['dependency'], page: { limit: 20 } });
        expect(result.status).toBe('rejected');
      }
    } finally { await fx.close(); }
  });

  it('freezes request mappings and scope before its first asynchronous boundary', async () => {
    const fx = await fixture(kind);
    try {
      const service = createObservedArchitecture(fx.deps());
      const request = structuredClone(capture('mutated-during-await'));
      const pending = service.captureSourceChanges(context, request);
      request.input.mappings[0]!.id = 'Injected';
      request.input.mappings[0]!.paths[0] = 'src/other.ts';
      request.input.workspace.workspaceId = 'other-workspace';
      const created = await pending;
      expect(created.status).toBe('committed');
      if (created.status !== 'committed') return;
      const graph = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: created.value },
        depth: 1, relations: ['dependency'], page: { limit: 20 } });
      expect(graph.status).toBe('ready');
      if (graph.status === 'ready') {
        expect(graph.value.nodes.map(node => node.nodeId)).toContain('module:Alpha');
        expect(graph.value.nodes.map(node => node.nodeId)).not.toContain('module:Injected');
      }
      expect(created.value.capture.workspaceId).toBe(workspace.workspaceId);
    } finally { await fx.close(); }
  });

  it('ignores an unrelated ledger event during capture when all exact scope guards still match', async () => {
    const fx = await fixture(kind);
    try {
      const underlying = fx.deps().bodies;
      let inserted = false;
      const bodies: RawArtifactStorePort = {
        async put(input) {
          const saved = await underlying.put(input);
          if (!inserted) {
            inserted = true;
            const eventId = 'unrelated-event-during-observation';
            const occurredAt = '2026-09-24T00:00:01.000Z';
            const extra = await fx.deps().records.commit({
              identityKey: eventId, fingerprint: eventId, guards: [], records: [],
              claims: [], indexGuards: [], indexChanges: [], events: [{ eventId,
                eventType: 'TrustedArchitectureScopeSeeded', schemaVersion: 1, occurredAt,
                json: JSON.stringify({ eventId, eventType: 'TrustedArchitectureScopeSeeded',
                  schemaVersion: 1, occurredAt }) }],
            });
            expect(extra.status).toBe('committed');
          }
          return saved;
        },
        read: ref => underlying.read(ref),
      };
      const result = await createObservedArchitecture({ ...fx.deps(), bodies })
        .captureSourceChanges(context, capture('unrelated-write-does-not-stale'));
      expect(result.status).toBe('committed');
      expect(inserted).toBe(true);
    } finally { await fx.close(); }
  });

  it('checks revoked Host access before reading a previous persisted observation body', async () => {
    const fx = await fixture(kind);
    try {
      const first = await createObservedArchitecture(fx.deps())
        .captureSourceChanges(context, capture('previous-authorized'));
      expect(first.status).toBe('committed');
      if (first.status !== 'committed') return;
      let bodyReads = 0;
      const underlying = fx.deps().bodies;
      const bodies: RawArtifactStorePort = {
        put: input => underlying.put(input),
        async read(ref) { bodyReads++; return underlying.read(ref); },
      };
      fx.revoke();
      const second = await createObservedArchitecture({ ...fx.deps(), bodies })
        .captureSourceChanges(context, { ...capture('previous-after-revoke'),
          input: { ...capture('previous-after-revoke').input, previous: first.value } });
      expect(second).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(bodyReads).toBe(0);
    } finally { await fx.close(); }
  });

  it('authorizes mapped frozen files without requiring separate grants for directory or missing display paths', async () => {
    for (const mapping of [
      { id: 'All', kind: 'module' as const, paths: ['src'] },
      { id: 'Alpha', kind: 'module' as const, paths: ['src/missing.ts', 'src/alpha.ts'] },
    ]) {
      const fx = await fixture(kind);
      try {
        const service = createObservedArchitecture(fx.deps());
        const observed = await service.captureSourceChanges(context, { ...capture(`mapping-${mapping.id}`),
          input: { workspace, mappings: [mapping], previous: null } });
        expect(observed.status).toBe('committed');
        if (observed.status !== 'committed') continue;
        // The Host grants real frozen files, not the mapping's directory or missing display path.
        fx.allowOnly([...fx.sourceFiles.keys()]);
        const selection = { kind: 'observed' as const, capture: observed.value };
        const allowed = await service.queryArchitecture(context, { selection, depth: 1,
          relations: ['dependency'], page: { limit: 20 } });
        expect(allowed.status).toBe('ready');
        if (allowed.status === 'ready') expect(allowed.value.nodes.map(node => node.nodeId)).toContain(`module:${mapping.id}`);
        fx.allowOnly([...fx.sourceFiles.keys()].filter(path => path !== 'src/alpha.ts'));
        expect(await service.queryArchitecture(context, { selection, depth: 1,
          relations: ['dependency'], page: { limit: 20 } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
      } finally { await fx.close(); }
    }
  });

  it('persists and reads a JSON-only mapping when TypeScript really indexed that JSON module', async () => {
    const fx = await fixture(kind);
    try {
      await fx.edit('tsconfig.json', JSON.stringify({ compilerOptions: {
        module: 'esnext', moduleResolution: 'bundler', noLib: true, resolveJsonModule: true,
      }, include: ['src/**/*.ts'] }));
      await fx.edit('src/data.json', JSON.stringify({ value: 1 }));
      await fx.edit('src/alpha.ts', 'import * as data from "./data.json";\nexport const alpha = data.value;\n');
      const service = createObservedArchitecture(fx.deps());
      const observed = await service.captureSourceChanges(context, { ...capture('indexed-json-mapping'),
        input: { workspace, mappings: [{ id: 'Data', kind: 'module', paths: ['src/data.json'] }], previous: null } });
      expect(observed.status).toBe('committed');
      if (observed.status !== 'committed') return;
      const selection = { kind: 'observed' as const, capture: observed.value };
      const graph = await service.queryArchitecture(context, { selection, depth: 1,
        relations: ['dependency'], page: { limit: 20 } });
      expect(graph.status).toBe('ready');
      if (graph.status === 'ready') expect(graph.value.nodes.map(node => node.nodeId)).toContain('module:Data');
      fx.allowOnly([...fx.sourceFiles.keys()].filter(path => path !== 'src/data.json'));
      expect(await service.queryArchitecture(context, { selection, depth: 1,
        relations: ['dependency'], page: { limit: 20 } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await fx.close(); }
  });

  it('releases each capture when cancellation arrives during body persistence', async () => {
    const fx = await fixture(kind);
    try {
      const underlying = fx.deps().bodies;
      for (let index = 0; index < 9; index++) {
        const controller = new AbortController();
        const bodies: RawArtifactStorePort = {
          async put(input) {
            const saved = await underlying.put(input);
            controller.abort();
            return saved;
          },
          read: ref => underlying.read(ref),
        };
        const result = await createObservedArchitecture({ ...fx.deps(), bodies })
          .captureSourceChanges({ ...context, signal: controller.signal }, capture(`cancel-during-body-${index}`));
        expect(result.status).toBe('rejected');
      }
      const healthy = await createObservedArchitecture(fx.deps())
        .captureSourceChanges(context, capture('after-cancelled-captures'));
      expect(healthy.status).toBe('committed');
    } finally { await fx.close(); }
  });
});
