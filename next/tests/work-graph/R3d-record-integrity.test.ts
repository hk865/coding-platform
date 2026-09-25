/** Direct R3d codec integrity checks. The production stub does not yet export
 * decodeObservedArchitectureBody; this test becomes typecheckable when the
 * already-selected codec implementation is imported from the DSH candidate. */
import { expect, it } from 'vitest';
import { architectureSourceIssues } from '../../src/contracts/architecture-source.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS,
  decodeObservedArchitectureBody } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { actor, context, fixture, mappings, projectId, workspace, workspaceId } from './R3d-fixture.js';

it('rejects observed records whose persisted source identity disagrees with their full ref', async () => {
  const fx = await fixture('memory');
  try {
    const captured = await fx.workspaceTools.captureSourceChanges(context, {
      workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1,
      provider: 'typescript', configPath: 'tsconfig.json',
    });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const body = await fx.workspaceTools.exportCapture(context, captured.value.ref);
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') return;
    const stored = await fx.deps().bodies.put({
      body: JSON.stringify(body.value), contentType: 'application/json',
      sourceRefs: [{ kind: 'workspace', refId: workspaceId, revision: '1', digest: captured.value.ref.sourceDigest }],
      origin: { kind: 'platform_operation', projectId, workspaceId, requestId: 'codec-record', actor },
      requestedAt: '2026-09-24T00:00:00.000Z',
    });
    expect(stored.status).toBe('ready');
    if (stored.status !== 'ready') return;
    const ref = { aggregateType: 'ObservedArchitecture', projectId, workspaceId,
      captureId: captured.value.ref.captureId };
    const source = { capture: captured.value.ref, material: stored.value.ref };
    const record = (capture: typeof captured.value.ref): EncodedRecord => ({
      refKey: canonicalJson(ref as JsonValue), schemaId: 'ObservedArchitecture@1', revision: 1,
      json: JSON.stringify({ ref, revision: 1, schemaVersion: 1, source: { ...source, capture },
        observedAt: '2026-09-24T00:00:00.000Z' }),
    });
    const codec = OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records.find(entry => entry.aggregateType === 'ObservedArchitecture');
    expect(codec).toBeDefined();
    if (codec === undefined) return;
    expect(codec.validate(record(source.capture)).status).toBe('decoded');
    for (const changed of [
      { ...source.capture, projectId: 'other-project' },
      { ...source.capture, workspaceId: 'other-workspace' },
      { ...source.capture, captureId: 'other-capture' },
    ]) expect(codec.validate(record(changed)).status).toBe('invalid');
  } finally { await fx.close(); }
});

it('rejects a frozen body whose scope, engine, Git basis or permission file manifest differs from its real capture', async () => {
  const fx = await fixture('memory');
  try {
    const captured = await fx.workspaceTools.captureSourceChanges(context, {
      workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1,
      provider: 'typescript', configPath: 'tsconfig.json',
    });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const exported = await fx.workspaceTools.exportCapture(context, captured.value.ref);
    const mapped = await fx.workspaceTools.captureArchitectureSource(context, {
      capture: captured.value.ref, mappings,
    });
    expect(exported.status).toBe('ready');
    expect(mapped.status).toBe('ready');
    if (exported.status !== 'ready' || mapped.status !== 'ready') return;
    const body = { schemaVersion: 1, capture: captured.value.ref,
      observedAt: '2026-09-24T00:00:00.000Z', summary: exported.value.summary,
      files: exported.value.files, architecture: mapped.value };
    expect(mapped.value.indexedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/alpha.ts' }),
    ]));
    expect(architectureSourceIssues(mapped.value)).toEqual([]);
    expect(decodeObservedArchitectureBody(JSON.stringify(body)).status).toBe('decoded');
    const variants = [
      { ...body, architecture: { ...body.architecture, workspaceRevision: 2 } },
      { ...body, architecture: { ...body.architecture, indexVersion: 'other-engine@1' } },
      { ...body, architecture: { ...body.architecture, commitHash: 'a'.repeat(40) } },
      { ...body, architecture: { ...body.architecture, configPath: 'other.json' } },
      { ...body, files: body.files.filter(file => file.path !== 'src/alpha.ts') },
      { ...body, architecture: { ...body.architecture, indexedSources: undefined } },
      { ...body, architecture: { ...body.architecture, indexedSources: body.architecture.indexedSources?.filter(file => file.path !== 'src/alpha.ts') } },
      { ...body, architecture: { ...body.architecture, indexedSources: body.architecture.indexedSources?.map(file =>
        file.path === 'src/alpha.ts' ? { ...file, digest: '0'.repeat(64) } : file) } },
      { ...body, architecture: { ...body.architecture, nodes: body.architecture.nodes.map(node =>
        node.nodeId === 'module:Alpha' ? { ...node, contentDigest: '0'.repeat(64) } : node) } },
    ];
    for (const changed of variants) {
      expect(decodeObservedArchitectureBody(JSON.stringify(changed)).status).toBe('invalid');
    }
  } finally { await fx.close(); }
});

it('requires a real indexed JSON member for a JSON-only mapped node', async () => {
  const fx = await fixture('memory');
  try {
    await fx.edit('tsconfig.json', JSON.stringify({ compilerOptions: {
      module: 'esnext', moduleResolution: 'bundler', noLib: true, resolveJsonModule: true,
    }, include: ['src/**/*.ts'] }));
    await fx.edit('src/data.json', JSON.stringify({ value: 1 }));
    await fx.edit('src/alpha.ts', 'import * as data from "./data.json";\nexport const alpha = data.value;\n');
    const captured = await fx.workspaceTools.captureSourceChanges(context, {
      workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1,
      provider: 'typescript', configPath: 'tsconfig.json',
    });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const exported = await fx.workspaceTools.exportCapture(context, captured.value.ref);
    const mapped = await fx.workspaceTools.captureArchitectureSource(context, {
      capture: captured.value.ref, mappings: [{ id: 'Data', kind: 'module', paths: ['src/data.json'] }],
    });
    expect(exported.status).toBe('ready');
    expect(mapped.status).toBe('ready');
    if (exported.status !== 'ready' || mapped.status !== 'ready') return;
    const indexed = mapped.value.indexedSources ?? [];
    expect(indexed).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/data.json' })]));
    const body = { schemaVersion: 1, capture: captured.value.ref,
      observedAt: '2026-09-24T00:00:00.000Z', summary: exported.value.summary,
      files: exported.value.files, architecture: mapped.value };
    expect(decodeObservedArchitectureBody(JSON.stringify(body)).status).toBe('decoded');
    expect(decodeObservedArchitectureBody(JSON.stringify({ ...body,
      architecture: { ...mapped.value, indexedSources: indexed.filter(file => file.path !== 'src/data.json') },
    })).status).toBe('invalid');
    expect(decodeObservedArchitectureBody(JSON.stringify({ ...body,
      architecture: { ...mapped.value, indexedSources: indexed.map(file =>
        file.path === 'src/data.json' ? { ...file, digest: '0'.repeat(64) } : file) },
    })).status).toBe('invalid');
    expect(decodeObservedArchitectureBody(JSON.stringify({ ...body,
      architecture: { ...mapped.value, nodes: mapped.value.nodes.map(node =>
        node.nodeId === 'module:Data' ? { ...node, contentDigest: '0'.repeat(64) } : node) },
    })).status).toBe('invalid');
    expect(decodeObservedArchitectureBody(JSON.stringify({ ...body,
      files: exported.value.files.filter(file => file.path !== 'src/data.json'),
    })).status).toBe('invalid');
    expect(architectureSourceIssues({ ...mapped.value, indexedSources: [...indexed, indexed[0]] })).toContain('duplicate indexed source');
  } finally { await fx.close(); }
});
