import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { SqliteStores } from '../../../vendor/coding-agent/dist/public-api.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';

/** Supplied only by the trusted Host at startup. Neither request nor model
 * input can add an entry or choose a database path. */
export type KernelStoreEntry = {
  adapterId: string;
  storeKey: string;
  workspace: WorkspaceScope;
  databasePath: string;
};
export type KernelStoreLocation = Readonly<KernelStoreEntry>;

export interface KernelStoreRegistry {
  forWorkspace(workspace: WorkspaceScope): KernelStoreLocation | null;
  byAdapterId(adapterId: string): KernelStoreLocation | null;
  /** Only current workspace registrations can be used for creation. */
  withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T>;
  /**
   * Register ONE additional CURRENT workspace location after startup (a newly
   * opened directory). It performs the SAME canonical database-path and
   * identity uniqueness checks as the constructor and throws on a duplicate
   * adapterId, workspace or database path. Existing readers see the new location
   * immediately; no Host restart and no second registry is created.
   *
   * Optional on the interface only so an existing narrow test double keeps
   * compiling; the real composition always publishes it.
   */
  registerCurrent?(entry: KernelStoreEntry): Promise<KernelStoreLocation>;
}

/** Canonicalize an EXISTING Host-managed parent directory so aliases/symlinks to
 * one SQLite file cannot be registered under different adapter identities. The
 * final file itself may not exist yet. */
async function canonicalDatabasePath(databasePath: string): Promise<string> {
  const parentPath = await realpath(path.dirname(databasePath));
  const normalizedPath = path.join(parentPath, path.basename(databasePath));
  return await realpath(normalizedPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalizedPath;
    throw error;
  });
}

export async function createKernelStoreRegistry(input: {
  entries: readonly KernelStoreEntry[];
}): Promise<KernelStoreRegistry> {
  const current = new Map<string, KernelStoreLocation>();
  const workspaceOwners = new Map<string, string>();
  const pathOwners = new Map<string, string>();

  const registerCurrentEntry = (entry: KernelStoreEntry, databasePath: string): KernelStoreLocation => {
    if (current.has(entry.adapterId)) {
      throw new Error(`duplicate Kernel adapterId ${entry.adapterId}`);
    }
    const prior = pathOwners.get(databasePath);
    if (prior !== undefined) throw new Error(`Kernel database path already registered as ${prior}`);
    if (!entry.workspace.projectId || !entry.workspace.workspaceId) throw new Error('Kernel workspace identity is incomplete');
    const key = JSON.stringify([entry.workspace.projectId, entry.workspace.workspaceId]);
    if (workspaceOwners.has(key)) throw new Error(`Kernel workspace already registered as ${workspaceOwners.get(key)}`);
    pathOwners.set(databasePath, entry.adapterId);
    workspaceOwners.set(key, entry.adapterId);
    const location = Object.freeze({ ...entry, workspace: Object.freeze({ ...entry.workspace }), databasePath });
    current.set(entry.adapterId, location);
    return location;
  };

  for (const entry of input.entries) {
    if (!entry.adapterId || !entry.storeKey || !path.isAbsolute(entry.databasePath)) {
      throw new Error('Kernel Store registry requires non-empty IDs and an absolute Host database path');
    }
    const databasePath = await canonicalDatabasePath(entry.databasePath);
    registerCurrentEntry(entry, databasePath);
  }

  return Object.freeze({
    forWorkspace(workspace: WorkspaceScope) {
      const owner = workspaceOwners.get(JSON.stringify([workspace.projectId, workspace.workspaceId]));
      return owner === undefined ? null : current.get(owner) ?? null;
    },
    byAdapterId(adapterId: string) { return current.get(adapterId) ?? null; },
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      const location = current.get(adapterId);
      if (!location) throw new Error(`unregistered Kernel adapterId ${adapterId}`);
      const store = await SqliteStores.open(location.databasePath);
      try { return await use(store); } finally { await store.close(); }
    },
    async registerCurrent(entry: KernelStoreEntry): Promise<KernelStoreLocation> {
      if (!entry.adapterId || !entry.storeKey || !path.isAbsolute(entry.databasePath)) {
        throw new Error('Kernel Store registry requires non-empty IDs and an absolute Host database path');
      }
      const databasePath = await canonicalDatabasePath(entry.databasePath);
      return registerCurrentEntry(entry, databasePath);
    },
  });
}
