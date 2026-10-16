/**
 * Slice 4B G2 fixture (round 2, R16).
 *
 * What it builds and through which public calls: the complete real 4A fixture
 * `createS4ANoteFixture('memory' | 'sqlite')` (project, workspace, active
 * catalog, goal + accepted plan, real Sessions/Runs) and the real production
 * `platform.notes` holder the composition root built. `notes`, `check`
 * (`checkNotes`), `memory` (the six memory reads), and both version lists are
 * members of that one holder — no read-model factory spy, no separately built
 * reader or check. Every assertion goes through the public holder.
 *
 * The only doubles are the spec §7/§9 read-fault spies: the storage
 * `records.readMany` error on BOTH backends (the interleave-fixture pattern:
 * the memory and SQLite factories are wrapped while the fixture is composed,
 * then restored), the 4A-allowed catalog `readArchitectureRevision` error, and
 * the workspace-tools-unavailable switch (write and read, M-03/M-11). Nothing
 * reads the database or the record store to answer an assertion.
 *
 * The workspace is a real temporary directory whose files the tests change
 * directly (that is the point of the freshness rows); plans and catalogs are
 * changed only through the real `platform.plans`/`platform.architecture`
 * services.
 */
import { vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type {
  NoteCheckPort, NoteReadPort, NoteWritePort, NoteScopeReadPort, NoteMemoryReadPort, VersionListPageV1,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteCheckLimits } from '../../src/core/work-graph/views/note-views.js';
import type { RecordBatchRead, StoreResult } from '../../src/core/record-store/ports.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { WorkspaceToolsPort } from '../../src/core/workspace/ports.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import * as catalogServiceModule from '../../src/core/work-graph/architecture/catalog-service.js';
import * as workspaceToolsModule from '../../src/core/workspace/workspace-tools.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind, type S4ANoteLimits } from './S4A-note-fixture.js';

export type S4BNoteCheckFixture = {
  kind: S4ANoteFixtureKind;
  inner: S4ANoteFixture;
  /** The production holder: write, the 4A reads, the six memory reads and checkNotes. */
  notes: NoteWritePort & NoteReadPort & NoteScopeReadPort & NoteCheckPort;
  /** The holder's own `checkNotes` (the real L22 call site). */
  check: NoteCheckPort;
  /** Slice 4B G3: the holder's six memory reads. */
  memory: NoteMemoryReadPort;
  /** Slice 4B L19: the holder's public version-list reads. */
  planVersions(input: { goalId: string; limit: number; cursor: string | null }): Promise<ReadResult<VersionListPageV1>>;
  catalogVersions(input: { limit: number; cursor: string | null }): Promise<ReadResult<VersionListPageV1>>;
  root: string;
  ctx(): CoreCallContext;
  /** The one allowed read-fault double (spec §7): a storage `readMany` error on either backend. */
  armReadManyFault(needle: string): void;
  disarmReadManyFault(): void;
  /** The 4A-allowed read-fault double on the catalog read. */
  armArchitectureFault(): void;
  disarmArchitectureFault(): void;
  /** The §7-allowed workspace-tools-unavailable double (write and read). */
  armWorkspaceFault(): void;
  disarmWorkspaceFault(): void;
  close(): Promise<void>;
};

/** The independent digest a test computes (never the product's helper). */
export async function fileDigestOf(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function createS4BNoteCheckFixture(kind: S4ANoteFixtureKind = 'memory',
  options: { anchorQuota?: number; goalQuota?: number; check?: NoteCheckLimits;
    textSearchCandidateMax?: number; textSearchMaxTerms?: number; resultMaxBytes?: number;
    symbolHitsMax?: number; fullTextUnavailable?: boolean } = {}): Promise<S4BNoteCheckFixture> {
  let faultNeedle: string | null = null;
  let architectureFault = false;
  let workspaceFault = false;
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const originalCatalog = catalogServiceModule.createArchitectureCatalogService;
  const originalWorkspaceTools = workspaceToolsModule.createWorkspaceTools;
  // The read-fault double on both backends (spec §7; the interleave-fixture
  // pattern). The wrapper is captured by the composed backend, so it stays
  // armed after the factory spies are restored.
  const observe = <T,>(backend: T): T => {
    const records = (backend as { records: { readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> } }).records;
    const wrapped = { ...records,
      async readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> {
        const needle = faultNeedle;
        if (needle !== null && refKeys.some(refKey => refKey.includes(needle))) {
          return { status: 'rejected', code: 'unavailable', reason: 's4b injected readMany failure' };
        }
        return records.readMany(refKeys);
      } };
    return { ...(backend as object), records: wrapped } as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(memoryOptions => observe(originalMemory(memoryOptions)));
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(sqliteOptions => observe(originalSqlite(options.fullTextUnavailable === true
      ? { ...sqliteOptions, fullTextProbe: () => false }
      : sqliteOptions)));
  const catalogSpy = vi.spyOn(catalogServiceModule, 'createArchitectureCatalogService').mockImplementation(stores => {
    const catalog = originalCatalog(stores);
    const wrapped: ArchitectureCatalogPort = { ...catalog,
      async readArchitectureRevision(...args: Parameters<ArchitectureCatalogPort['readArchitectureRevision']>):
      Promise<Awaited<ReturnType<ArchitectureCatalogPort['readArchitectureRevision']>>> {
        if (architectureFault) return { status: 'rejected', code: 'unavailable', reason: 's4b injected architecture failure' };
        return catalog.readArchitectureRevision(...args);
      } };
    return wrapped;
  });
  // The §7-allowed workspace-tools-unavailable double: the wrapper is captured
  // by the composed note service, so it stays armed after the factory spies are
  // restored.
  const workspaceSpy = vi.spyOn(workspaceToolsModule, 'createWorkspaceTools').mockImplementation(deps => {
    const handle = originalWorkspaceTools(deps);
    const tools: WorkspaceToolsPort = { ...handle.tools,
      async readWorkspace(...args: Parameters<WorkspaceToolsPort['readWorkspace']>):
      ReturnType<WorkspaceToolsPort['readWorkspace']> {
        if (workspaceFault) {
          return { status: 'rejected', code: 'unavailable', reason: 's4b injected workspace failure' };
        }
        return handle.tools.readWorkspace(...args);
      } };
    return { ...handle, tools };
  });
  // R16/R4: every injected limit must reach the production holder through the
  // single `noteLimits` option; the old read-model factory spy is gone.
  const noteLimits: S4ANoteLimits = {
    ...(options.anchorQuota === undefined ? {} : { anchorQuota: options.anchorQuota }),
    ...(options.goalQuota === undefined ? {} : { goalQuota: options.goalQuota }),
    ...(options.symbolHitsMax === undefined ? {} : { symbolHitsMax: options.symbolHitsMax }),
    ...(options.check ?? {}),
    ...(options.textSearchCandidateMax === undefined ? {} : { textSearchCandidateMax: options.textSearchCandidateMax }),
    ...(options.textSearchMaxTerms === undefined ? {} : { textSearchMaxTerms: options.textSearchMaxTerms }),
    ...(options.resultMaxBytes === undefined ? {} : { resultMaxBytes: options.resultMaxBytes }),
  };
  let inner: S4ANoteFixture;
  try {
    inner = await createS4ANoteFixture(kind, Object.keys(noteLimits).length === 0 ? {} : { noteLimits });
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
    catalogSpy.mockRestore();
    workspaceSpy.mockRestore();
  }
  const holder = inner.platform.notes;
  const notes = holder as unknown as NoteWritePort & NoteReadPort & NoteScopeReadPort & NoteCheckPort;
  const check: NoteCheckPort = holder;
  const memory: NoteMemoryReadPort = holder;
  return {
    kind, inner, notes, check, memory,
    planVersions: input => holder.listPlanVersions(inner.ctx(), input),
    catalogVersions: input => holder.listCatalogVersions(inner.ctx(), input),
    root: inner.root, ctx: inner.ctx,
    armReadManyFault(needle) { faultNeedle = needle; },
    disarmReadManyFault() { faultNeedle = null; },
    armArchitectureFault() { architectureFault = true; },
    disarmArchitectureFault() { architectureFault = false; },
    armWorkspaceFault() { workspaceFault = true; },
    disarmWorkspaceFault() { workspaceFault = false; },
    close: () => inner.close(),
  };
}

/** Read the current head version through the public read port (for check inputs). */
export async function currentVersion(fixture: S4BNoteCheckFixture, noteId: string): Promise<number> {
  const read = await fixture.notes.readNote(fixture.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`readNote(${noteId}) failed: ${JSON.stringify(read)}`);
  return read.value.version;
}

export type { NoteDraftV1 };
