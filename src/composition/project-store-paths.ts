/**
 * The one spelling of a project store's file names and of a workspace's Kernel
 * store entry. Every project has its own store directory; the files in it are
 * named here only, so the platform factory, the per-project registry and the
 * Host never write a file name of their own.
 */
import { join } from 'node:path';
import { sha256Hex } from '../contracts/fingerprint.js';
import type { KernelStoreEntry } from '../core/agent-runtime/kernel-store-locator.js';

/** One project's store directory and the four files in it. A composition-root type, not a public contract. */
export type ProjectStorePaths = {
  /** The project store directory (absolute). */
  directory: string;
  /** `<directory>/ledger.sqlite`: the record store. */
  ledger: string;
  /** `<directory>/artifacts.sqlite`: the raw artifact bodies. */
  artifacts: string;
  /** `<directory>/index.sqlite`: the search index (built by its own owner, not here). */
  index: string;
  /** `<directory>/knowledge-snapshots.sqlite`: the knowledge snapshots (built by their own owner, not here). */
  snapshots: string;
};

export function projectStorePaths(directory: string): ProjectStorePaths {
  return {
    directory,
    ledger: join(directory, 'ledger.sqlite'),
    artifacts: join(directory, 'artifacts.sqlite'),
    index: join(directory, 'index.sqlite'),
    snapshots: join(directory, 'knowledge-snapshots.sqlite'),
  };
}

/** `<paths.directory>/kernel-stores`: the Kernel stores of the project's workspaces. */
export function kernelStoreDirectory(paths: ProjectStorePaths): string {
  return join(paths.directory, 'kernel-stores');
}

/** One workspace's Kernel store entry. The suffix is the first 32 hex digits of
 * sha256(projectId NUL workspaceId); the adapter id and the store key are both
 * `host-settings-kernel-<suffix>`, and the database is `<kernelDirectory>/<suffix>.sqlite`. */
export function kernelStoreEntry(kernelDirectory: string, projectId: string, workspaceId: string): KernelStoreEntry {
  const suffix = sha256Hex(`${projectId}\u0000${workspaceId}`).slice(0, 32);
  return {
    adapterId: `host-settings-kernel-${suffix}`,
    storeKey: `host-settings-kernel-${suffix}`,
    workspace: { projectId, workspaceId },
    databasePath: join(kernelDirectory, `${suffix}.sqlite`),
  };
}
