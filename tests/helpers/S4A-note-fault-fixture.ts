/**
 * Slice 4A item 3 read-fault fixture (N-02, N-04, N-07, N-08, N-10, N-11, N-20).
 *
 * What it builds and through which public calls: the complete real
 * `createS4ANoteScopeFixture('memory')` — project, workspace, active catalog,
 * goals/plans, real Sessions and Runs, the production duty resolver — so every
 * fact comes from the real public services. The ONLY double is the read-fault
 * switch allowed by spec §7 / round-2 §4 exception 2: while the fixture is
 * composed, the in-memory record backend's `records` object is wrapped so its
 * `lookup`/`readMany` can return an injected `unavailable`, and the two
 * scope-fact ports (`createSessionDirectory().findSessions`,
 * `createArchitectureCatalogService().readArchitectureRevision`) are wrapped
 * the same way. The spies are restored right after composition; the returned
 * platform is the real one, and the switch only injects failures.
 *
 * The caller is a host user only. Goal `s4a-goal` and its plan are made through
 * the public services with the switch off. Only project and goal anchors are
 * used by the tests (a module anchor is only ever written under an all-readMany
 * fault in N-02).
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type {
  NoteReadPort, NoteScopeReadPort, NoteWritePort, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { RecordLookupPage, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { RecordBatchRead, StoreFailure, StoreResult } from '../../src/core/record-store/ports.js';
import type { SessionCard, SessionDirectoryPort, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import type { ArchitectureCatalogPort, ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sessionDirectoryModule from '../../src/core/work-graph/sessions/session-directory.js';
import * as catalogServiceModule from '../../src/core/work-graph/architecture/catalog-service.js';
import { createS4ANoteScopeFixture, type S4ANoteScopeFixture } from './S4A-note-scope-fixture.js';

/** The read the switch injects a failure into. */
export type S4ANoteFaultTarget =
  | { readonly kind: 'lookup'; readonly index: string }
  | { readonly kind: 'readMany'; readonly refKeyIncludes?: string }
  | { readonly kind: 'findSessions' }
  | { readonly kind: 'readArchitectureRevision' };

export type S4ANoteFaultFixture = {
  platform: S4ANoteScopeFixture['platform'];
  notes: NoteWritePort & NoteReadPort & NoteScopeReadPort;
  root: string;
  goalRef: GoalRef;
  ctx(): CoreCallContext;
  arm(target: S4ANoteFaultTarget): void;
  disarm(): void;
  write(ctx: CoreCallContext, draft: NoteDraftV1, goalId: string | null,
    options?: { commandId?: string; expectedPointerRevision?: number | null }): Promise<WriteNoteResult>;
  close(): Promise<void>;
};

export async function createS4ANoteFaultFixture(): Promise<S4ANoteFaultFixture> {
  let target: S4ANoteFaultTarget | null = null;
  const lookupArmed = (index: string): boolean => target?.kind === 'lookup' && target.index === index;
  const readManyArmed = (refKeys: readonly string[]): boolean => {
    if (target?.kind !== 'readMany') return false;
    if (target.refKeyIncludes === undefined) return true;
    const needle = target.refKeyIncludes;
    return refKeys.some(refKey => refKey.includes(needle));
  };
  const portArmed = (kind: 'findSessions' | 'readArchitectureRevision'): boolean => target?.kind === kind;

  const injected: StoreFailure = { status: 'rejected', code: 'unavailable', reason: 'injected' };
  const injectedRead: CoreRejection = { status: 'rejected', code: 'unavailable', reason: 'injected' };

  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend').mockImplementation(options => {
    const backend = originalMemory(options);
    const records = backend.records;
    const wrapped = {
      ...records,
      async lookup(request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>> {
        if (lookupArmed(request.index)) return injected;
        return records.lookup(request);
      },
      async readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> {
        if (readManyArmed(refKeys)) return injected;
        return records.readMany(refKeys);
      },
    };
    return { ...backend, records: wrapped };
  });

  const originalDirectory = sessionDirectoryModule.createSessionDirectory;
  const sessionSpy = vi.spyOn(sessionDirectoryModule, 'createSessionDirectory').mockImplementation(stores => {
    const directory = originalDirectory(stores);
    const wrapped: SessionDirectoryPort = {
      ...directory,
      async findSessions(...args: Parameters<SessionDirectoryPort['findSessions']>): Promise<ReadResult<SessionPage<SessionCard>>> {
        if (portArmed('findSessions')) return injectedRead;
        return directory.findSessions(...args);
      },
    };
    return wrapped;
  });

  const originalCatalog = catalogServiceModule.createArchitectureCatalogService;
  const catalogSpy = vi.spyOn(catalogServiceModule, 'createArchitectureCatalogService').mockImplementation(stores => {
    const catalog = originalCatalog(stores);
    const wrapped: ArchitectureCatalogPort = {
      ...catalog,
      async readArchitectureRevision(...args: Parameters<ArchitectureCatalogPort['readArchitectureRevision']>): Promise<ReadResult<ArchitectureRevision>> {
        if (portArmed('readArchitectureRevision')) return injectedRead;
        return catalog.readArchitectureRevision(...args);
      },
    };
    return wrapped;
  });

  let scope: S4ANoteScopeFixture;
  try {
    scope = await createS4ANoteScopeFixture('memory');
  } finally {
    memorySpy.mockRestore();
    sessionSpy.mockRestore();
    catalogSpy.mockRestore();
  }

  return {
    platform: scope.platform,
    notes: scope.notes,
    root: scope.root,
    goalRef: scope.goalRef,
    ctx: scope.ctx,
    arm(next) { target = next; },
    disarm() { target = null; },
    write: scope.write,
    close: scope.close,
  };
}
