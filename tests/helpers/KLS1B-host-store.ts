/**
 * KLS-1b: where a Host keeps a project's store, and that project's start-up reconcile report, read the way the Host
 * reads them. The store directory comes from the production location rule over the real mount table (`/proc/mounts`),
 * with the project's main workspace root; every test root here comes from `mkdtemp(tmpdir())`.
 *
 * The old tests name a Host by its storage directory (`database`), where the single store used to live. A fixture
 * that starts a Host remembers where that Host keeps its project's store (`rememberHostStore`), and the old readers of
 * the ledger, the artifacts and the lock take the directory through `storeDirOf(database)` (V14: the path change lives
 * in the helpers). A directory no Host was started on (a platform's own store) is its own store directory.
 */
import { existsSync } from 'node:fs';
import { mkdir, symlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { projectStoreLocation } from '../../src/composition/project-store-location.js';
import type { HostReconcileReportV1 } from '../../src/app/core-routes.js';
import type { LocalWorkbenchHost } from '../../src/app/host.js';

/** The store directory a Host uses for this project, whose main workspace root is `root`. */
export async function hostProjectStoreDirectory(projectId: string, root: string): Promise<string> {
  const location = await projectStoreLocation(projectId, root);
  if (location.status !== 'ready') throw new Error(`no store location for ${projectId}: ${location.reason}`);
  return location.value.directory;
}

/** One project's start-up reconcile report; a Host that answers null for it fails the test (V7). */
export function hostReconcile(host: Pick<LocalWorkbenchHost, 'reconcileOf'>, projectId: string): HostReconcileReportV1 {
  const report = host.reconcileOf(projectId);
  if (report === null) throw new Error(`the Host has no reconcile report for the project ${projectId}`);
  return report;
}

const hostStores = new Map<string, string>();

/** Remembers the project store of a Host started over `database` (its storage directory) and returns it. */
export async function rememberHostStore(database: string, projectId: string, root: string): Promise<string> {
  const directory = await hostProjectStoreDirectory(projectId, root);
  hostStores.set(resolve(database), directory);
  return directory;
}

/** The directory holding the ledger, the artifacts and the lock for `database`: a Host's project store, else itself. */
export function storeDirOf(database: string): string {
  return hostStores.get(resolve(database)) ?? database;
}

/**
 * An old fixture wrote its store into `directory` through its own platform before a Host starts over it: the project
 * store location is linked to that directory (a directory symlink), so the Host opens the fixture's store there instead
 * of refusing the old single-store layout. Once per location; a second call leaves the link as it is.
 */
export async function linkHostStore(projectId: string, root: string, directory: string): Promise<void> {
  const store = await hostProjectStoreDirectory(projectId, root);
  if (existsSync(store)) return;
  await mkdir(dirname(store), { recursive: true });
  await symlink(directory, store, 'dir');
}
