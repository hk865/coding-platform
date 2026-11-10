/**
 * One runtime per project: its own store directory, its own lease and its own
 * platform. A commit therefore writes one project's store only, by construction.
 *
 * `open` checks, in this order: an already open project (returned as it is);
 * the memory store (no location, no directory, no layout check); the location
 * of the store (`projectStoreLocation` on the main workspace root, the first
 * workspace); the old single-store layout (a `ledger.sqlite` directly in the
 * Host's storage directory while the project store is absent: refused as
 * `unsupported`, never loaded or migrated, decision 79-1, and checked before any
 * directory is made so a later start cannot take the old store for the new
 * layout); a missing store when it may not be created (`unavailable`, nothing
 * made, no lease); then it makes the store directory (and, for a
 * `workspace-local` store made now, the `local/` line of
 * `<root>/.workbench/.gitignore`), makes sure the Kernel store directory exists
 * (the Kernel registry resolves its real parent), takes the lease and opens the
 * platform once. A lease held by another process still opens: the runtime
 * reports it, and its owner decides what the project may do.
 *
 * The registry never registers a Kernel store entry: it hands the Kernel
 * directory to the caller, which registers a workspace's entry only when the
 * platform has none for it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rejected } from '../contracts/core/rejections.js';
import { messageOf } from '../contracts/error-message.js';
import type { HostTakeoverProofV1 } from '../contracts/unknown-call-review.js';
import type { GoalRecordTransactionPort, StoreResult } from '../core/record-store/ports.js';
import type { createTargetPlatform } from './create-platform.js';
import { projectStoreLocation, type ProjectStoreLocation } from './project-store-location.js';
import { kernelStoreDirectory, projectStorePaths, type ProjectStorePaths } from './project-store-paths.js';

export type ProjectPlatform = Awaited<ReturnType<typeof createTargetPlatform>>;
export type ProjectRuntimeWorkspace = { workspaceId: string; root: string };
/** Structurally the Host's instance lease (`src/app/host-instance-lease.ts`), which this layer may not import. */
export type ProjectStoreLease = {
  hostInstanceId: string;
  lease: 'owned' | 'held_by_other';
  row: string;
  reason: string;
  takeover: HostTakeoverProofV1 | null;
  release(): Promise<void>;
};
export type ProjectRuntime = {
  readonly projectId: string;
  readonly platform: ProjectPlatform;
  /** The records the platform itself writes through, as its factory handed them back; a read port across projects. */
  readonly records: GoalRecordTransactionPort;
  /** Null for the memory store. */
  readonly paths: ProjectStorePaths | null;
  readonly lease: ProjectStoreLease;
  /** Null for the memory store. */
  readonly storeLocation: ProjectStoreLocation | null;
  /** `platform.close()`, then `lease.release()`; a second call returns the same promise. */
  close(): Promise<void>;
};
export type ProjectPlatformInput = {
  projectId: string;
  workspaces: readonly ProjectRuntimeWorkspace[];
  /** `directory` is the project store directory (`paths.directory`). */
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  /** SQLite: `kernelStoreDirectory(paths)`, already made by `open`; memory: null. */
  kernelDirectory: string | null;
  lease: ProjectStoreLease;
};
export type ProjectRuntimeRegistryOptions = {
  /** `legacyDirectory` is the Host's storage directory, where the old single store kept its ledger. */
  storage: { kind: 'memory' } | { kind: 'sqlite'; legacyDirectory: string };
  /** Called with the project store directory, or null for the memory store. */
  acquireLease(directory: string | null): Promise<ProjectStoreLease>;
  /** Opens one project's platform; `records` must be the ones that same platform writes through. */
  createPlatform(input: ProjectPlatformInput):
    Promise<{ platform: ProjectPlatform; records: GoalRecordTransactionPort }>;
  /** A test seam; production leaves it out and uses `projectStoreLocation`. */
  location?: (projectId: string, root: string) => Promise<StoreResult<ProjectStoreLocation>>;
};
export type ProjectRuntimeRegistry = {
  open(projectId: string, workspaces: readonly ProjectRuntimeWorkspace[], opts: { create: boolean }):
    Promise<StoreResult<ProjectRuntime>>;
  get(projectId: string): ProjectRuntime | null;
  projectIds(): string[];
  closeAll(): Promise<void>;
};

const OLD_LAYOUT = 'store layout changed: the old single-store layout is not loaded or migrated';

export function createProjectRuntimeRegistry(options: ProjectRuntimeRegistryOptions): ProjectRuntimeRegistry {
  const runtimes = new Map<string, ProjectRuntime>();
  const locate = options.location ?? ((projectId: string, root: string) => projectStoreLocation(projectId, root));

  async function openRuntime(projectId: string, workspaces: readonly ProjectRuntimeWorkspace[], paths: ProjectStorePaths | null,
    storeLocation: ProjectStoreLocation | null): Promise<StoreResult<ProjectRuntime>> {
    let lease: ProjectStoreLease;
    try {
      lease = await options.acquireLease(paths === null ? null : paths.directory);
    } catch (error) {
      return rejected('unavailable', `the project store lease could not be taken: ${messageOf(error)}`);
    }
    try {
      const made = await options.createPlatform({
        projectId, workspaces, lease,
        storage: paths === null ? { kind: 'memory' } : { kind: 'sqlite', directory: paths.directory },
        kernelDirectory: paths === null ? null : kernelStoreDirectory(paths),
      });
      let closing: Promise<void> | undefined;
      const runtime: ProjectRuntime = {
        projectId, platform: made.platform, records: made.records, paths, lease, storeLocation,
        close: () => closing ??= (async () => {
          try {
            await made.platform.close();
          } finally {
            await lease.release().catch(() => undefined);
          }
        })(),
      };
      runtimes.set(projectId, runtime);
      return { status: 'ready', value: runtime };
    } catch (error) {
      // A platform that failed to open must not keep the lease until the process ends.
      await lease.release().catch(() => undefined);
      return rejected('unavailable', `the project store could not be opened: ${messageOf(error)}`);
    }
  }

  return {
    async open(projectId, workspaces, opts) {
      const existing = runtimes.get(projectId);
      if (existing !== undefined) return { status: 'ready', value: existing };
      const storage = options.storage;
      if (storage.kind === 'memory') return openRuntime(projectId, workspaces, null, null);
      // The caller passes at least one workspace; the first is the main one.
      const root = workspaces[0]!.root;
      const located = await locate(projectId, root);
      if (located.status !== 'ready') return rejected('unavailable', located.reason);
      const paths = projectStorePaths(located.value.directory);
      const present = existsSync(paths.directory);
      if (!present && existsSync(projectStorePaths(storage.legacyDirectory).ledger)) return rejected('unsupported', OLD_LAYOUT);
      if (!present && !opts.create) return rejected('unavailable', `the project store is missing: ${paths.directory}`);
      if (!present) {
        mkdirSync(paths.directory, { recursive: true });
        if (located.value.place === 'workspace-local') ensureLocalIgnore(root);
      }
      mkdirSync(kernelStoreDirectory(paths), { recursive: true });
      return openRuntime(projectId, workspaces, paths, located.value);
    },
    get: projectId => runtimes.get(projectId) ?? null,
    projectIds: () => [...runtimes.keys()],
    async closeAll() {
      const all = [...runtimes.values()];
      runtimes.clear();
      await Promise.allSettled(all.map(runtime => runtime.close()));
    },
  };
}

/** A workspace-local store stays out of git through `<root>/.workbench/.gitignore`: a `local/` line is added when
 * missing and the rest of the file is kept as it is; the root's own `.gitignore` is never touched. */
function ensureLocalIgnore(root: string): void {
  const directory = join(root, '.workbench');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).includes('local/')) return;
  writeFileSync(file, `${current}${current !== '' && !current.endsWith('\n') ? '\n' : ''}local/\n`);
}
