/** Direct R3d codec integrity checks. The production stub does not yet export
 * decodeObservedArchitectureBody; this test becomes typecheckable when the
 * already-selected codec implementation is imported from the DSH candidate. */
import { expect, it } from 'vitest';
import { architectureSourceIssues } from '../../src/contracts/architecture-source.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS,
  decodeObservedArchitectureBody } from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { actor, capture, context, fixture, mappings, projectId, workspace, workspaceId } from './R3d-fixture.js';

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
        observedAt: '2026-09-24T00:00:00.000Z',
        fileGraph: { schemaVersion: 2, chunks: [], nodeCount: 0, edgeCount: 0, unresolvedCount: 0 },
        languages: [], inventory: { source: 'skip_list', reason: '不是 git 仓库' } }),
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

it('rejects a v2 frozen body whose scope, engine, config or indexed member manifest differs from its real capture', async () => {
  const fx = await fixture('memory');
  try {
    const captured = await fx.workspaceTools.captureObservation(context, {
      workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1,
      provider: 'typescript', configPath: 'tsconfig.json',
    });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const exported = await fx.workspaceTools.exportCapture(context, captured.value.ref);
    const mapped = await fx.workspaceTools.captureArchitectureSource(context, {
      capture: captured.value.ref, mappings,
    });
    const fileGraph = await fx.workspaceTools.captureFileGraph(context, { capture: captured.value.ref });
    expect(exported.status).toBe('ready');
    expect(mapped.status).toBe('ready');
    expect(fileGraph.status).toBe('ready');
    if (exported.status !== 'ready' || mapped.status !== 'ready' || fileGraph.status !== 'ready') return;
    // §10 item 2: a new capture's body is v2 (counts-only summary, no `files`,
    // no `indexedSources`); membership is checked against the path-sorted chunk
    // node table, which carries path + digest per file.
    const summary = {
      files: exported.value.files.length,
      languages: fileGraph.value.languages.map(language => ({ language: language.language, files: language.files })),
      changes: {
        added: exported.value.summary.changes.added.length,
        modified: exported.value.summary.changes.modified.length,
        deleted: exported.value.summary.changes.deleted.length,
      },
    };
    const body = { schemaVersion: 2, capture: captured.value.ref,
      observedAt: '2026-09-24T00:00:00.000Z', summary,
      architecture: mapped.value };
    const nodes = fileGraph.value.nodes;
    expect(architectureSourceIssues(mapped.value)).toEqual([]);
    expect(decodeObservedArchitectureBody(JSON.stringify(body), nodes).status).toBe('decoded');
    const variants = [
      { body: { ...body, architecture: { ...body.architecture, workspaceRevision: 2 } }, nodes },
      { body: { ...body, architecture: { ...body.architecture, indexVersion: 'other-engine@1' } }, nodes },
      { body: { ...body, architecture: { ...body.architecture, sourceDigest: '0'.repeat(64) } }, nodes },
      { body: { ...body, architecture: { ...body.architecture, projectId: 'other-project' } }, nodes },
      { body: { ...body, architecture: { ...body.architecture, configPath: 'other.json' } }, nodes },
      { body, nodes: nodes.filter(node => node.path !== 'src/alpha.ts') },
      { body, nodes: nodes.map(node => node.path === 'src/alpha.ts' ? { ...node, digest: '0'.repeat(64) } : node) },
      { body: { ...body, architecture: { ...body.architecture, nodes: body.architecture.nodes.map(node =>
        node.nodeId === 'module:Alpha' ? { ...node, contentDigest: '0'.repeat(64) } : node) } }, nodes },
    ];
    for (const changed of variants) {
      expect(decodeObservedArchitectureBody(JSON.stringify(changed.body), changed.nodes).status).toBe('invalid');
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
    const captured = await fx.workspaceTools.captureObservation(context, {
      workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1,
      provider: 'typescript', configPath: 'tsconfig.json',
    });
    expect(captured.status).toBe('ready');
    if (captured.status !== 'ready') return;
    const exported = await fx.workspaceTools.exportCapture(context, captured.value.ref);
    const mapped = await fx.workspaceTools.captureArchitectureSource(context, {
      capture: captured.value.ref, mappings: [{ id: 'Data', kind: 'module', paths: ['src/data.json'] }],
    });
    const fileGraph = await fx.workspaceTools.captureFileGraph(context, { capture: captured.value.ref });
    expect(exported.status).toBe('ready');
    expect(mapped.status).toBe('ready');
    expect(fileGraph.status).toBe('ready');
    if (exported.status !== 'ready' || mapped.status !== 'ready' || fileGraph.status !== 'ready') return;
    // The compact module snapshot no longer carries `indexedSources`; the file
    // graph nodes are the same frozen path+digest manifest (spec §10 item 2).
    const indexed = fileGraph.value.nodes.map(node => ({ path: node.path, digest: node.digest }));
    expect(indexed).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/data.json' })]));
    const summary = {
      files: exported.value.files.length,
      languages: fileGraph.value.languages.map(language => ({ language: language.language, files: language.files })),
      changes: { added: exported.value.summary.changes.added.length,
        modified: exported.value.summary.changes.modified.length,
        deleted: exported.value.summary.changes.deleted.length },
    };
    const body = { schemaVersion: 2, capture: captured.value.ref,
      observedAt: '2026-09-24T00:00:00.000Z', summary,
      architecture: mapped.value };
    const nodes = fileGraph.value.nodes;
    expect(decodeObservedArchitectureBody(JSON.stringify(body), nodes).status).toBe('decoded');
    expect(decodeObservedArchitectureBody(JSON.stringify(body),
      nodes.filter(node => node.path !== 'src/data.json')).status).toBe('invalid');
    expect(decodeObservedArchitectureBody(JSON.stringify(body),
      nodes.map(node => node.path === 'src/data.json' ? { ...node, digest: '0'.repeat(64) } : node)).status).toBe('invalid');
    expect(decodeObservedArchitectureBody(JSON.stringify({ ...body,
      architecture: { ...body.architecture, nodes: body.architecture.nodes.map(node =>
        node.nodeId === 'module:Data' ? { ...node, contentDigest: '0'.repeat(64) } : node) },
    }), nodes).status).toBe('invalid');
    expect(architectureSourceIssues({ ...mapped.value, indexedSources: [...indexed, indexed[0]] })).toContain('duplicate indexed source');
  } finally { await fx.close(); }
});

it('opens one Host access and reads the observation record once per public read', async () => {
  const fx = await fixture('memory');
  try {
    // Reach the committed observation through the public capture, never by
    // encoding a record: only the platform writes the record and its chunks.
    const writer = createObservedArchitecture(fx.deps());
    const captured = await writer.captureSourceChanges(context, capture('one-access-one-read'));
    expect(captured.status).toBe('committed');
    if (captured.status !== 'committed') return;
    const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
      captureId: captured.value.capture.captureId };
    const deps = fx.deps();
    let opens = 0;
    let recordReads = 0;
    const counted = {
      ...deps,
      access: { open: async (...args: Parameters<typeof deps.access.open>) => {
        opens += 1; return deps.access.open(...args);
      } },
      records: { ...deps.records, readMany: async (...args: Parameters<typeof deps.records.readMany>) => {
        recordReads += 1; return deps.records.readMany(...args);
      } },
    };
    const reader = createObservedArchitecture(counted);
    // The page entry does the one record read and one access open; the chunk
    // helper it calls must not repeat either.
    const page = await reader.listFiles(context, { captureRef, cursor: null });
    expect(page.status).toBe('ready');
    expect({ opens, recordReads }).toEqual({ opens: 1, recordReads: 1 });
    // `queryArchitecture` goes through loadObservation, which already has the
    // record and the access before it hands them to the same chunk helper.
    opens = 0; recordReads = 0;
    const selection = { kind: 'observed' as const, capture: captured.value };
    const neighborhood = await reader.queryArchitecture(context,
      { selection, depth: 0, relations: ['dependency'], page: { limit: 10 } });
    expect(neighborhood.status).toBe('ready');
    expect({ opens, recordReads }).toEqual({ opens: 1, recordReads: 1 });
  } finally { await fx.close(); }
});
