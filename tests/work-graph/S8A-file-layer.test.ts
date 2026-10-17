/**
 * Slice 8A file-level observation layer (spec L12; lead answers 1 and 7).
 *
 * Storage: one artifact per chunk, the chunk list + languages on the observation
 * record, the module-level body unchanged. Reads: listFiles 200, neighbors one
 * direction, impact reverse reachability depth <= 3, cursors bound to the capture
 * and the query, edges only between the page's nodes. Item 8: a capture with no
 * TS files still succeeds with an empty module layer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { FileGraphNodeV1, LanguageCoverageV1 } from '../../src/contracts/architecture-inspection.js';
import type { ArchitectureSourceMapping } from '../../src/contracts/architecture-source.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createObservedArchitecture } from '../../src/core/work-graph/architecture/architecture-service.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import {
  OBSERVED_ARCHITECTURE_RECORD_SCHEMAS, encodeObservedArchitecture,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import {
  GOAL_RECORD_SCHEMAS, canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';
import type { WorkspaceCaptureLimits } from '../../src/core/workspace/ports.js';

const projectId = 's8a-file-layer';
const workspaceId = 'main';
const workspace: WorkspaceScope = { projectId, workspaceId };
const actor = { kind: 'human' as const, id: 's8a-file-layer-reader' };
const context: CoreCallContext = {
  projectId, workspaceId, principal: { kind: 'host', actor },
  materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
};
const mappings: ArchitectureSourceMapping[] = [
  { id: 'E', kind: 'module', paths: ['src/e'] },
  { id: 'F', kind: 'module', paths: ['src/f'] },
  { id: 'A', kind: 'module', paths: ['src/a.ts'] },
  { id: 'B', kind: 'module', paths: ['src/b.ts'] },
  { id: 'C', kind: 'module', paths: ['src/c.ts'] },
  { id: 'D', kind: 'module', paths: ['src/d.ts'] },
];
const hex = (c: string): string => c.repeat(64);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(
  files: Record<string, string>,
  options: { fileGraph?: { maxNodes: number; maxEdges: number }; limits?: Partial<WorkspaceCaptureLimits> } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 's8a-file-layer-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  const access = createWorkspaceAccessFactory({
    resolveRoot: async requested => requested.projectId === projectId && requested.workspaceId === workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: 1 } }
      : { status: 'rejected', code: 'not_found', reason: 'unknown workspace' },
    authorize: async (ctx, requested) => ctx.projectId === projectId && ctx.workspaceId === workspaceId &&
      requested.projectId === projectId && requested.workspaceId === workspaceId &&
      ctx.principal.kind === 'host' && ctx.principal.actor.id === actor.id &&
      ctx.materialReader.kind === 'host' && ctx.materialReader.actor.id === actor.id
      ? { status: 'ready', value: { subjectKey: canonicalJson(['host', actor]),
        permissionRevision: 's8a-file-layer-v1', allowsRead: (name: string) => Object.prototype.hasOwnProperty.call(files, name) } }
      : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' },
  });
  const handle = createWorkspaceTools({ access, now: () => '2026-10-17T00:00:00.000Z',
    limits: { ...DEFAULT_WORKSPACE_LIMITS, ...(options.limits ?? {}) },
    ...(options.fileGraph ? { fileGraph: options.fileGraph } : {}) });
  cleanups.push(() => handle.close());
  const schemas: RecordBackendSchemas = {
    records: [...GOAL_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records],
    events: [...GOAL_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      { eventType: 'TrustedArchitectureScopeSeeded', schemaVersion: 1,
        validate: event => ({ status: 'decoded', value: event }) }],
    lookups: [...(OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [])],
  };
  const backend = createInMemoryRecordBackend({ schemas });
  const bodies: RawArtifactStorePort = new RawArtifactBodyStore();
  const workspaceRef = { aggregateType: 'Workspace' as const, ...workspace };
  const project: ProjectSnapshot = { ref: { aggregateType: 'Project', projectId }, revision: 1 };
  const workspaceRecord: WorkspaceSnapshot = { ref: workspaceRef, revision: 1 };
  const seeded = await backend.records.commit({ identityKey: 's8a-seed', fingerprint: 's8a-seed',
    guards: [{ refKey: canonicalRefKey(project.ref), expectedRevision: null },
      { refKey: canonicalRefKey(workspaceRecord.ref), expectedRevision: null }],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspaceRecord)],
    events: [{ eventId: 's8a-scope-seed', eventType: 'TrustedArchitectureScopeSeeded', schemaVersion: 1,
      occurredAt: '2026-10-17T00:00:00.000Z',
      json: JSON.stringify({ eventId: 's8a-scope-seed', eventType: 'TrustedArchitectureScopeSeeded',
        schemaVersion: 1, occurredAt: '2026-10-17T00:00:00.000Z' }) }],
    claims: [], indexChanges: [], indexGuards: [] });
  if (seeded.status !== 'committed') throw Error('s8a seed failed: ' + seeded.reason);
  const deps = () => ({ workspace: handle.tools, access, bodies,
    records: backend.records as GoalRecordTransactionPort & RecordLookupPort,
    source: { provider: 'typescript' as const, configPath: null as string | null } });
  let commitSeq = 0;
  return {
    root, handle, deps,
    async commit(records: Parameters<GoalRecordTransactionPort['commit']>[0]['records']) {
      commitSeq += 1;
      const eventId = 's8a-commit-seed-' + commitSeq;
      return backend.records.commit({ identityKey: 's8a-commit-' + commitSeq,
        fingerprint: 's8a-commit-' + commitSeq,
        guards: records.map(record => ({ refKey: record.refKey, expectedRevision: null })),
        records, claims: [], indexChanges: [], indexGuards: [],
        events: [{ eventId, eventType: 'TrustedArchitectureScopeSeeded', schemaVersion: 1,
          occurredAt: '2026-10-17T00:00:00.000Z',
          json: JSON.stringify({ eventId, eventType: 'TrustedArchitectureScopeSeeded',
            schemaVersion: 1, occurredAt: '2026-10-17T00:00:00.000Z' }) }] });
    },
    async readRecord(ref: object) { return backend.records.readMany([canonicalJson(ref as JsonValue)]); },
    async readBody(ref: Parameters<RawArtifactStorePort['read']>[0]) { return bodies.read(ref); },
    async close() { await handle.close(); await backend.close(); await rm(root, { recursive: true, force: true }); },
  };
}

const captureRequest = (requestId: string) => ({
  input: { workspace, mappings, previous: null }, meta: { requestId, expected: [] as const },
});

const A_01_FILES = (): Record<string, string> => {
  const files: Record<string, string> = {
    'src/a.ts': 'import { b } from "./b";\n\nexport const a = b;\n',
    'src/b.ts': 'export const b = 1;\n',
    'src/c.ts': 'import { d } from "./d";\n',
    'src/d.ts': 'export const d = 1;\n',
  };
  for (let index = 1; index <= 201; index += 1) {
    const id = String(index).padStart(3, '0');
    files[`src/f${id}.ts`] = `export const f${id} = 1;\n`;
  }
  return files;
};

const A_01_LANGUAGES: LanguageCoverageV1[] = [
  { language: 'typescript', files: 205, parsed: 205, edges: 'supported', reason: null,
    issues: [], issueCount: 0, complete: true },
];

describe('A-01 file-level observation layer', () => {
  it('A-01a reads all 205 nodes, the exact 2 edges and the languages through the public listFiles pages', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('a01-store'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const nodes: FileGraphNodeV1[] = [];
      const edges: { from: string; to: string }[] = [];
      let languages: LanguageCoverageV1[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const read = await service.listFiles(context, { captureRef, cursor });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        nodes.push(...read.value.nodes);
        edges.push(...read.value.edges);
        languages = read.value.languages;
        cursor = read.value.nextCursor;
        if (cursor === null) break;
      }
      expect(nodes).toHaveLength(205);
      expect(nodes.find(node => node.path === 'src/a.ts')).toEqual({ path: 'src/a.ts', nonBlankLines: 2, language: 'typescript' });
      expect(edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/c.ts', to: 'src/d.ts' }]);
      expect(languages).toEqual(A_01_LANGUAGES);
    } finally { await fx.close(); }
  });

  it('A-01b pages listFiles 200 + cursor then 5 + null, with edges only between the page nodes', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('a01-pages'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const first = await service.listFiles(context, { captureRef, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.nodes).toHaveLength(200);
      expect(first.value.languages).toEqual(A_01_LANGUAGES);
      expect(first.value.nextCursor).not.toBeNull();
      expect(first.value.complete).toBe(false);
      expect(first.value.edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/c.ts', to: 'src/d.ts' }]);
      const second = await service.listFiles(context, { captureRef, cursor: first.value.nextCursor });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.nodes).toHaveLength(5);
      expect(second.value.nextCursor).toBeNull();
      expect(second.value.complete).toBe(true);
      expect(second.value.edges).toEqual([]);
      const all = [...first.value.nodes, ...second.value.nodes].map(node => node.path);
      expect(new Set(all).size).toBe(205);
    } finally { await fx.close(); }
  });

  it('A-01c returns the direct neighbours of the two A-01 edges in one direction', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('a01-neighbors'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const outA = await service.neighbors(context, { captureRef, file: 'src/a.ts', direction: 'out', limit: 200, cursor: null });
      expect(outA.status).toBe('ready');
      if (outA.status === 'ready') {
        expect(outA.value.nodes.map(node => node.path)).toEqual(['src/b.ts']);
        expect(outA.value.edges).toEqual([]);
        expect(outA.value.languages).toEqual(A_01_LANGUAGES);
      }
      const outC = await service.neighbors(context, { captureRef, file: 'src/c.ts', direction: 'out', limit: 200, cursor: null });
      expect(outC.status).toBe('ready');
      if (outC.status === 'ready') expect(outC.value.nodes.map(node => node.path)).toEqual(['src/d.ts']);
      const inB = await service.neighbors(context, { captureRef, file: 'src/b.ts', direction: 'in', limit: 200, cursor: null });
      expect(inB.status).toBe('ready');
      if (inB.status === 'ready') expect(inB.value.nodes.map(node => node.path)).toEqual(['src/a.ts']);
      const none = await service.neighbors(context, { captureRef, file: 'src/a.ts', direction: 'in', limit: 200, cursor: null });
      expect(none.status).toBe('ready');
      if (none.status === 'ready') expect(none.value.nodes).toEqual([]);
    } finally { await fx.close(); }
  });

  it('A-01d rejects a cursor reused with another capture or another query as invalid/cursor_mismatch', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const first = await service.captureSourceChanges(context, captureRequest('a01-cursor-1'));
      const second = await service.captureSourceChanges(context, captureRequest('a01-cursor-2'));
      expect(first.status).toBe('committed');
      expect(second.status).toBe('committed');
      if (first.status !== 'committed' || second.status !== 'committed') return;
      const firstRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId, captureId: first.value.capture.captureId };
      const secondRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId, captureId: second.value.capture.captureId };
      const page = await service.listFiles(context, { captureRef: firstRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready' || page.value.nextCursor === null) return;
      const cursor = page.value.nextCursor;
      expect(await service.listFiles(context, { captureRef: secondRef, cursor }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
      expect(await service.neighbors(context, { captureRef: firstRef, file: 'src/a.ts', direction: 'out', limit: 200, cursor }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
    } finally { await fx.close(); }
  });

  it('A-01e walks reverse reachability within depth <= 3 and rejects a deeper request', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('a01-impact'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const impactB = await service.impact(context, { captureRef, file: 'src/b.ts', depth: 1, limit: 200, cursor: null });
      expect(impactB.status).toBe('ready');
      if (impactB.status === 'ready') {
        expect(impactB.value.nodes.map(node => node.path)).toEqual(['src/a.ts']);
        expect(impactB.value.edges).toEqual([]);
        expect(impactB.value.languages).toEqual(A_01_LANGUAGES);
      }
      const impactD = await service.impact(context, { captureRef, file: 'src/d.ts', depth: 3, limit: 200, cursor: null });
      expect(impactD.status).toBe('ready');
      if (impactD.status === 'ready') expect(impactD.value.nodes.map(node => node.path)).toEqual(['src/c.ts']);
      expect(await service.impact(context, { captureRef, file: 'src/b.ts', depth: 4, limit: 200, cursor: null }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally { await fx.close(); }
  });

  it('A-01f reports the workspace capacity rejection with the count when the injected file cap is exceeded', async () => {
    const fx = await fixture(A_01_FILES(), { fileGraph: { maxNodes: 2, maxEdges: 100000 } });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('a01-capacity'));
      expect(captured).toMatchObject({ status: 'rejected', code: 'capacity' });
      if (captured.status === 'rejected') expect(captured.reason).toMatch(/\b2\b/);
    } finally { await fx.close(); }
  });

  it('A-01g reads an observation without the chunk list as not_captured', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture(fx.deps());
      const captureId = 'legacy-capture';
      const sourceCapture = { projectId, workspaceId, captureId, workspaceRevision: 1,
        sourceDigest: hex('a'), configDigest: hex('b'), indexVersion: 'typescript@1' };
      const record = {
        ref: { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId, captureId },
        revision: 1 as const, schemaVersion: 1 as const,
        source: { capture: sourceCapture, material: { kind: 'artifact' as const, contentType: 'application/json',
          digest: hex('c'), sizeBytes: 0, source: { kind: 'workspace' as const, refId: workspaceId, revision: '1', digest: hex('a') } } },
        observedAt: '2026-10-17T00:00:00.000Z',
      };
      const committed = await fx.commit([encodeObservedArchitecture(record)]);
      expect(committed.status).toBe('committed');
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId, captureId };
      const page = await service.listFiles(context, { captureRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') {
        expect(page.value).toMatchObject({ notCaptured: true, nodes: [], edges: [], nextCursor: null, complete: true, languages: [] });
      }
      // Item 7: a cursor sent to an old capture (which never issued one) is a mismatch, not a blank page.
      expect(await service.listFiles(context, { captureRef, cursor: 'legacy-cursor' }))
        .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
    } finally { await fx.close(); }
  });

  it('A-01h reassembles a split file graph through listFiles and rejects a graph over the 64-chunk cap', async () => {
    const fx = await fixture(A_01_FILES());
    try {
      const service = createObservedArchitecture({ ...fx.deps(), fileGraph: { chunkBytes: 1024 } });
      const captured = await service.captureSourceChanges(context, captureRequest('a01-chunks'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const nodes: FileGraphNodeV1[] = [];
      const edges: { from: string; to: string }[] = [];
      let cursor: string | null = null;
      do {
        const read = await service.listFiles(context, { captureRef, cursor });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        nodes.push(...read.value.nodes);
        edges.push(...read.value.edges);
        cursor = read.value.nextCursor;
      } while (cursor !== null);
      expect(nodes).toHaveLength(205);
      expect(edges).toEqual([{ from: 'src/a.ts', to: 'src/b.ts' }, { from: 'src/c.ts', to: 'src/d.ts' }]);

      const capped = createObservedArchitecture({ ...fx.deps(), fileGraph: { chunkBytes: 1 } });
      const result = await capped.captureSourceChanges(context, captureRequest('a01-chunks-cap'));
      expect(result).toMatchObject({ status: 'rejected', code: 'capacity' });
      if (result.status === 'rejected') expect(result.reason).toMatch(/64/);
    } finally { await fx.close(); }
  });

  it('S8A-06 captures a project with no TS files: file nodes survive and the module layer is empty', async () => {
    const fx = await fixture({ 'e.py': 'import g\n\nprint(g)\n', 'g.py': 'x = 1\n' });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('s8a-no-ts'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const page = await service.listFiles(context, { captureRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') {
        expect(page.value.nodes).toEqual([
          { path: 'e.py', nonBlankLines: 2, language: 'python' },
          { path: 'g.py', nonBlankLines: 1, language: 'python' },
        ]);
      }
      const module = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 10 } });
      expect(module.status).toBe('ready');
      if (module.status === 'ready') expect(module.value.nodes).toEqual([]);
    } finally { await fx.close(); }
  });

  it('S8A-06b captures a TS project without a catalog (mappings: []) with the file layer and an empty module layer', async () => {
    const fx = await fixture({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, {
        input: { workspace, mappings: [], previous: null }, meta: { requestId: 's8a-no-catalog', expected: [] } });
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const page = await service.listFiles(context, { captureRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') {
        expect(page.value.nodes).toEqual([
          { path: 'src/a.ts', nonBlankLines: 1, language: 'typescript' },
          { path: 'src/b.ts', nonBlankLines: 1, language: 'typescript' },
        ]);
      }
      const module = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 10 } });
      expect(module.status).toBe('ready');
      if (module.status === 'ready') expect(module.value.nodes).toEqual([]);
    } finally { await fx.close(); }
  });

  it('S8A-07 compareFormalObserved uses a real recorded baseline and returns the formal findings', async () => {
    const fx = await fixture({ 'src/e/one.ts': 'export const one = 1;\n', 'src/f/lib.ts': 'export const lib = 1;\n' });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('s8a-compare'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const module = (moduleId: string, paths: string[]) => ({ ref: { projectId, moduleId }, name: moduleId,
        responsibility: moduleId, paths, interfaces: [] as { id: string; description: string; paths: string[] }[] });
      const catalogService = createArchitectureCatalogService({ records: fx.deps().records });
      const adopted = await catalogService.adoptInitialArchitecture(context, {
        input: { baselineId: 'base-1', description: 'S8A comparison', constraints: [],
          catalog: { modules: [module('E', ['src/e']), module('F', ['src/f'])],
            dependencies: [{ from: { projectId, moduleId: 'E' }, to: { projectId, moduleId: 'F' }, reason: 'E uses F' }],
            requireDag: true } },
        meta: { requestId: 's8a-07-adopt', expected: [
          { ref: { aggregateType: 'Project', projectId }, revision: 1 },
          { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 },
        ] },
      });
      expect(adopted.status).toBe('committed');
      if (adopted.status !== 'committed') return;
      const revision = await catalogService.readArchitectureRevision(context, { selection: { kind: 'current' } });
      expect(revision.status).toBe('ready');
      if (revision.status !== 'ready' || revision.value.catalog === null) return;
      const pin: ArchitectureCatalogPinV1 = { catalogRef: revision.value.catalog.ref,
        baseline: { ref: revision.value.baseline.ref, digest: revision.value.baseline.contentDigest } };
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const comparison = await service.compareFormalObserved(context, { catalog: pin, captureRef });
      expect(comparison.status).toBe('ready');
      if (comparison.status !== 'ready') return;
      expect(comparison.value.noVerdict).toBe(true);
      expect(comparison.value.catalog).toEqual(pin);
      expect(comparison.value.captureRef).toEqual(captureRef);
      expect(comparison.value.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'dependency_missing', moduleRef: { projectId, moduleId: 'E' }, path: 'src/e' }),
      ]));
    } finally { await fx.close(); }
  });

  it('S8A-07b rejects a foreign catalogRef, a wrong digest, a broken pin linkage and a missing baseline', async () => {
    const fx = await fixture({ 'src/e/one.ts': 'export const one = 1;\n' });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, captureRequest('s8a-compare-guards'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const module = (moduleId: string, paths: string[]) => ({ ref: { projectId, moduleId }, name: moduleId,
        responsibility: moduleId, paths, interfaces: [] as { id: string; description: string; paths: string[] }[] });
      const catalogService = createArchitectureCatalogService({ records: fx.deps().records });
      const adopted = await catalogService.adoptInitialArchitecture(context, {
        input: { baselineId: 'base-1', description: 'S8A comparison guards', constraints: [],
          catalog: { modules: [module('E', ['src/e'])], dependencies: [], requireDag: true } },
        meta: { requestId: 's8a-07b-adopt', expected: [
          { ref: { aggregateType: 'Project', projectId }, revision: 1 },
          { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: 1 },
        ] },
      });
      expect(adopted.status).toBe('committed');
      if (adopted.status !== 'committed') return;
      const revision = await catalogService.readArchitectureRevision(context, { selection: { kind: 'current' } });
      expect(revision.status).toBe('ready');
      if (revision.status !== 'ready' || revision.value.catalog === null) return;
      const pin: ArchitectureCatalogPinV1 = { catalogRef: revision.value.catalog.ref,
        baseline: { ref: revision.value.baseline.ref, digest: revision.value.baseline.contentDigest } };
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      expect(await service.compareFormalObserved(context, { catalog: pin, captureRef })).toMatchObject({ status: 'ready' });

      const wrongDigest = { ...pin, baseline: { ...pin.baseline, digest: hex('d') } };
      expect(await service.compareFormalObserved(context, { catalog: wrongDigest, captureRef }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });

      const foreign = { catalogRef: { ...pin.catalogRef, projectId: 'other-project' }, baseline: pin.baseline };
      expect(await service.compareFormalObserved(context, { catalog: foreign, captureRef }))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });

      const linkage = { catalogRef: pin.catalogRef, baseline: { ref: { ...pin.baseline.ref, revision: 99 }, digest: pin.baseline.digest } };
      expect(await service.compareFormalObserved(context, { catalog: linkage, captureRef }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });

      const missing = { catalogRef: { ...pin.catalogRef, baselineId: 'missing-baseline' },
        baseline: { ref: { ...pin.baseline.ref, baselineId: 'missing-baseline' }, digest: pin.baseline.digest } };
      expect(await service.compareFormalObserved(context, { catalog: missing, captureRef })).toEqual({ status: 'not_found' });
    } finally { await fx.close(); }
  });

  it('S8A-08 decodes a pre-8A observation with the legacy any-prefix rule and uses it as previous', async () => {
    const fx = await fixture({ 'src/a.ts': 'export const a = 1;\n', 'src/b/x.ts': 'export const x = 1;\n' });
    try {
      const tools = fx.handle.tools;
      const legacyMappings: ArchitectureSourceMapping[] = [
        { id: 'A', kind: 'module', paths: ['src'] },
        { id: 'B', kind: 'module', paths: ['src/b'] },
      ];
      const live = await tools.captureObservation(context, { workspace: { aggregateType: 'Workspace', ...workspace },
        workspaceRevision: 1, provider: 'typescript' });
      expect(live.status).toBe('ready');
      if (live.status !== 'ready') return;
      const capture = live.value.ref;
      expect((await tools.verifyCapture(context, capture)).status).toBe('ready');
      const exported = await tools.exportCapture(context, capture);
      expect(exported.status).toBe('ready');
      if (exported.status !== 'ready') return;
      const mapped = await tools.captureArchitectureSource(context, { capture, mappings: legacyMappings });
      expect(mapped.status).toBe('ready');
      if (mapped.status !== 'ready') return;
      // The 8A builder uses the longest-prefix rule; a pre-8A record's digests
      // cover every mapping whose path is ANY prefix (the old writer's rule).
      const indexedSources = mapped.value.indexedSources ?? [];
      const legacyMembers = (paths: readonly string[], path: string): boolean => paths.some(raw => {
        const prefix = raw.endsWith('/') ? raw.slice(0, -1) : raw;
        return prefix.length > 0 && (path === prefix || path.startsWith(prefix + '/'));
      });
      const legacyNodes = mapped.value.nodes.map(node => {
        const mapping = mapped.value.mappings.find(entry => entry.kind + ':' + entry.id === node.structuralKey);
        const members = indexedSources.filter(source => mapping !== undefined && legacyMembers(mapping.paths, source.path))
          .map(source => ({ path: source.path, digest: source.digest }));
        return { ...node, contentDigest: sha256Hex(canonicalJson(members as unknown as JsonValue)) };
      });
      const body = JSON.stringify({ schemaVersion: 1, capture, observedAt: '2026-10-17T00:00:00.000Z',
        summary: exported.value.summary, files: exported.value.files,
        architecture: { ...mapped.value, nodes: legacyNodes } });
      const put = await fx.deps().bodies.put({ body, contentType: 'application/json',
        sourceRefs: [{ kind: 'workspace', refId: workspaceId, revision: '1', digest: capture.sourceDigest }],
        origin: { kind: 'platform_operation', projectId, workspaceId, requestId: 's8a-legacy', actor },
        requestedAt: '2026-10-17T00:00:00.000Z' });
      expect(put.status).toBe('ready');
      if (put.status !== 'ready') return;
      await tools.releaseCapture(context, capture);
      const observedRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId, captureId: capture.captureId };
      const committed = await fx.commit([encodeObservedArchitecture({ ref: observedRef, revision: 1, schemaVersion: 1,
        source: { capture, material: put.value.ref }, observedAt: '2026-10-17T00:00:00.000Z' })]);
      expect(committed.status).toBe('committed');

      const service = createObservedArchitecture(fx.deps());
      const selection = { kind: 'observed' as const, capture: { capture, material: put.value.ref } };
      const page = await service.queryArchitecture(context, { selection, depth: 1, relations: ['dependency'], page: { limit: 20 } });
      expect(page.status).toBe('ready');
      if (page.status === 'ready') expect(page.value.nodes.map(node => node.nodeId).sort()).toEqual(['module:A', 'module:B']);

      const again = await service.captureSourceChanges(context, {
        input: { workspace, mappings: legacyMappings, previous: { capture, material: put.value.ref } },
        meta: { requestId: 's8a-legacy-previous', expected: [] } });
      expect(again.status).toBe('committed');
    } finally { await fx.close(); }
  });

  it('S8A-14 keeps an observation whose explicit config was skipped and reports the config as a failed issue', async () => {
    const fx = await fixture({
      'src/good.ts': 'export const good = 1;\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }) + '\u0000',
    });
    try {
      const service = createObservedArchitecture({
        ...fx.deps(), source: { provider: 'typescript' as const, configPath: 'tsconfig.json' } });
      const captured = await service.captureSourceChanges(context, captureRequest('s8a-config-skip'));
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const page = await service.listFiles(context, { captureRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.nodes).toEqual([{ path: 'src/good.ts', nonBlankLines: 1, language: 'typescript' }]);
      const coverage = page.value.languages.find(language => language.language === 'typescript');
      expect(coverage).toBeDefined();
      if (coverage === undefined) return;
      expect(coverage.complete).toBe(false);
      expect(typeof coverage.reason).toBe('string');
      expect(coverage.reason).not.toBe('');
      expect(coverage.issues).toContainEqual({ path: 'tsconfig.json', kind: 'failed', reason: coverage.reason });
      const module = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 10 } });
      expect(module.status).toBe('ready');
      if (module.status === 'ready') expect(module.value.nodes).toEqual([]);
      // The strict capture still rejects the unreadable explicit configuration.
      const strict = await fx.handle.tools.captureSourceChanges(context, {
        workspace: { aggregateType: 'Workspace', ...workspace }, workspaceRevision: 1, provider: 'typescript', configPath: 'tsconfig.json' });
      expect(strict.status).toBe('rejected');
    } finally { await fx.close(); }
  });

  it('S8A-21 keeps the one failed analysis outcome with the frozen observation instead of re-analysing', async () => {
    const fx = await fixture({
      'src/a.ts': 'import { b } from "./b";\nimport { c } from "./c";\nexport const a = b + c;\n',
      'src/b.ts': 'import { c } from "./c";\nexport const b = c;\n',
    }, { limits: { maxQueryResults: 2 } });
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, {
        input: { workspace, mappings: [{ id: 'M', kind: 'module', paths: ['.'] }], previous: null },
        meta: { requestId: 's8a-analysis-cap', expected: [] } });
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const page = await service.listFiles(context, { captureRef, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.nodes).toEqual([
        { path: 'src/a.ts', nonBlankLines: 3, language: 'typescript' },
        { path: 'src/b.ts', nonBlankLines: 2, language: 'typescript' },
      ]);
      const coverage = page.value.languages.find(language => language.language === 'typescript');
      expect(coverage).toMatchObject({ files: 2, parsed: 0, edges: 'failed', complete: false });
      expect(typeof coverage?.reason).toBe('string');
      expect(coverage?.reason).not.toBe('');
      const module = await service.queryArchitecture(context, { selection: { kind: 'observed', capture: captured.value },
        depth: 1, relations: ['dependency'], page: { limit: 10 } });
      expect(module.status).toBe('ready');
      if (module.status === 'ready') expect(module.value.nodes).toEqual([]);
    } finally { await fx.close(); }
  });

  it('S8A-20 rejects all three file pages when a narrowed grant no longer covers a skipped issue path', async () => {
    const files: Record<string, string> = {
      'src/good.ts': 'export const good = 1;\n',
      'private/bad.ts': 'export const bad = "\0";\n',
    };
    const fx = await fixture(files);
    try {
      const service = createObservedArchitecture(fx.deps());
      const captured = await service.captureSourceChanges(context, {
        input: { workspace, mappings: [{ id: 'G', kind: 'module', paths: ['src'] }], previous: null },
        meta: { requestId: 's8a-grant-narrow', expected: [] } });
      expect(captured.status).toBe('committed');
      if (captured.status !== 'committed') return;
      const captureRef = { aggregateType: 'ObservedArchitecture' as const, projectId, workspaceId,
        captureId: captured.value.capture.captureId };
      const before = await service.listFiles(context, { captureRef, cursor: null });
      expect(before.status).toBe('ready');
      // The Host grant narrows to the only frozen node path; `private/bad.ts`
      // survives only as a skipped TS issue, and the loader must recheck it.
      delete files['private/bad.ts'];
      const listFiles = await service.listFiles(context, { captureRef, cursor: null });
      const neighbors = await service.neighbors(context, { captureRef, file: 'src/good.ts', direction: 'out', limit: 200, cursor: null });
      const impact = await service.impact(context, { captureRef, file: 'src/good.ts', depth: 1, limit: 200, cursor: null });
      expect(listFiles).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(neighbors).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(impact).toMatchObject({ status: 'rejected', code: 'forbidden' });
      expect(JSON.stringify(listFiles)).not.toContain('private/bad.ts');
      expect(JSON.stringify(neighbors)).not.toContain('private/bad.ts');
      expect(JSON.stringify(impact)).not.toContain('private/bad.ts');
    } finally { await fx.close(); }
  });
});
