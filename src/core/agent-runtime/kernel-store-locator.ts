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
export type LegacyKernelStoreEntry = {
  adapterId: string;
  storeKey: string;
  databasePath: string;
  expectedSessionId: string;
};
export type KernelStoreLocation = Readonly<KernelStoreEntry>;
export type LegacyKernelStoreLocation = Readonly<LegacyKernelStoreEntry>;

export interface KernelStoreRegistry {
  forWorkspace(workspace: WorkspaceScope): KernelStoreLocation | null;
  byAdapterId(adapterId: string): KernelStoreLocation | LegacyKernelStoreLocation | null;
  /** Explicit, read-only legacy locator. Caller must still verify Kernel data. */
  legacy(adapterId: string, expectedSessionId: string): LegacyKernelStoreLocation | null;
  /** Only current workspace registrations can be used for creation. */
  withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T>;
  withLegacyReader<T>(adapterId: string, expectedSessionId: string,
    use: (reader: Pick<SqliteStores, 'get' | 'read'>) => Promise<T>): Promise<T>;
}

/** Canonicalize existing Host-managed parent directories so aliases/symlinks to
 * one SQLite file cannot be registered under different adapter identities. */
export async function createKernelStoreRegistry(input: {
  entries: readonly KernelStoreEntry[];
  legacyEntries?: readonly LegacyKernelStoreEntry[];
}): Promise<KernelStoreRegistry> {
  const current = new Map<string, KernelStoreLocation>();
  const legacy = new Map<string, LegacyKernelStoreLocation>();
  const workspaceOwners = new Map<string, string>();
  const pathOwners = new Map<string, string>();
  const all = [...input.entries.map(entry => ({ kind: 'current' as const, entry })),
    ...(input.legacyEntries ?? []).map(entry => ({ kind: 'legacy' as const, entry }))];
  for (const { kind, entry } of all) {
    if (!entry.adapterId || !entry.storeKey || !path.isAbsolute(entry.databasePath)) {
      throw new Error('Kernel Store registry requires non-empty IDs and an absolute Host database path');
    }
    if (current.has(entry.adapterId) || legacy.has(entry.adapterId)) {
      throw new Error(`duplicate Kernel adapterId ${entry.adapterId}`);
    }
    const parentPath = await realpath(path.dirname(entry.databasePath));
    const normalizedPath = path.join(parentPath, path.basename(entry.databasePath));
    const databasePath = await realpath(normalizedPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return normalizedPath;
      throw error;
    });
    const prior = pathOwners.get(databasePath);
    if (prior !== undefined) throw new Error(`Kernel database path already registered as ${prior}`);
    pathOwners.set(databasePath, entry.adapterId);
    if (kind === 'current') {
      if (!entry.workspace.projectId || !entry.workspace.workspaceId) throw new Error('Kernel workspace identity is incomplete');
      const key = JSON.stringify([entry.workspace.projectId, entry.workspace.workspaceId]);
      if (workspaceOwners.has(key)) throw new Error(`Kernel workspace already registered as ${workspaceOwners.get(key)}`);
      workspaceOwners.set(key, entry.adapterId);
      current.set(entry.adapterId, Object.freeze({ ...entry, workspace: Object.freeze({ ...entry.workspace }), databasePath }));
    } else {
      if (!entry.expectedSessionId) throw new Error('legacy Kernel locator requires expectedSessionId');
      legacy.set(entry.adapterId, Object.freeze({ ...entry, databasePath }));
    }
  }
  return Object.freeze({
    forWorkspace(workspace: WorkspaceScope) {
      const owner = workspaceOwners.get(JSON.stringify([workspace.projectId, workspace.workspaceId]));
      return owner === undefined ? null : current.get(owner) ?? null;
    },
    byAdapterId(adapterId: string) { return current.get(adapterId) ?? legacy.get(adapterId) ?? null; },
    legacy(adapterId: string, expectedSessionId: string) {
      const location = legacy.get(adapterId);
      return location?.expectedSessionId === expectedSessionId ? location : null;
    },
    async withStore<T>(adapterId: string, use: (store: SqliteStores) => Promise<T>): Promise<T> {
      const location = current.get(adapterId);
      if (!location) throw new Error(`unregistered Kernel adapterId ${adapterId}`);
      const store = await SqliteStores.open(location.databasePath);
      try { return await use(store); } finally { await store.close(); }
    },
    async withLegacyReader<T>(adapterId: string, expectedSessionId: string,
      use: (reader: Pick<SqliteStores, 'get' | 'read'>) => Promise<T>): Promise<T> {
      const location = legacy.get(adapterId);
      if (!location || location.expectedSessionId !== expectedSessionId) {
        throw new Error('unregistered or mismatched legacy Kernel Session locator');
      }
      const store = await SqliteStores.open(location.databasePath);
      try {
        return await use(Object.freeze({
          get: (sessionId, options) => {
            if (sessionId !== expectedSessionId) throw new Error('legacy locator Session ID mismatch');
            return store.get(sessionId, options);
          },
          read: (sessionId, afterPosition, limit, options) => {
            if (sessionId !== expectedSessionId) throw new Error('legacy locator Session ID mismatch');
            return store.read(sessionId, afterPosition, limit, options);
          },
        }));
      } finally { await store.close(); }
    },
  });
}
