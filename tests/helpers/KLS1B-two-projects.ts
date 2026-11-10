/**
 * KLS-1b two-project Host fixture: two real project roots on one Host, either a
 * project opened over the public settings route (the default) or a second
 * command-line workspace (`cliB`). The project-store helpers are loaded by path:
 * they land with the builder's batch, so while absent the row fails at its own
 * first assertion or at the missing public entry, never at this import.
 */
import { join } from 'node:path';
import {
  createLocalWorkbenchHost, type LocalWorkbenchHost, type LocalWorkbenchHostOptions,
} from '../../src/app/host.js';
import type { CoreScope } from '../../src/app/core-http-types.js';
import { projectRef, settingsPost, workspaceRef } from '../app/support/S8A-L8-host.js';
import { initGitWorkspace } from '../scenarios/support/git-workspace.js';
import { cleanupRestart, publicDirectory, tempDir } from './A2-restart-fixture.js';
import { corePost, graphWrite, readPageToken } from './AG2b-collaboration-fixture.js';

export type KLS1BBackend = 'memory' | 'sqlite';
/** A command-line workspace: the Host option carries the scope and the root. */
export type KLS1BCliWorkspace = { scope: CoreScope; root: string };
export type KLS1BOpenOptions = { backend: KLS1BBackend; gitA?: boolean; cliB?: boolean };
/** A route answer: the HTTP status and the decoded body. */
export type KLS1BReply = { status: number; body: any };
export type KLS1BStartOptions = {
  /** Defaults to the workspaces of the first start. */
  cli?: readonly KLS1BCliWorkspace[];
  /** Extra Host options layered on the fixture's own (e.g. `kernelStores`). */
  extra?: Partial<LocalWorkbenchHostOptions>;
};

export type KLS1BTwoProjects = {
  readonly A: CoreScope;
  readonly B: CoreScope;
  readonly rootA: string;
  readonly rootB: string;
  readonly host: LocalWorkbenchHost;
  readonly base: string;
  readonly token: string;
  post(scope: CoreScope, suffix: string, body: unknown): Promise<KLS1BReply>;
  settings(suffix: string, body: unknown): Promise<KLS1BReply>;
  createGoal(scope: CoreScope, goalId: string): Promise<KLS1BReply>;
  close(): Promise<void>;
  start(options?: KLS1BStartOptions): Promise<void>;
  restart(options?: KLS1BStartOptions): Promise<void>;
  dispose(): Promise<void>;
};

type LoadedModule = Record<string, any>;

let hostStoreModule: LoadedModule | null = null;

/** Loads the builder's `KLS1B-host-store.ts` once; an absent module leaves a row failing at its first use. */
export async function prepareKLS1BHostStore(): Promise<void> {
  if (hostStoreModule !== null) return;
  const path = './KLS1B-host-store.js';
  try {
    hostStoreModule = await import(/* @vite-ignore */ path) as LoadedModule;
  } catch {
    hostStoreModule = {};
  }
}

/** The builder's frozen helper; sync because the fixture loads it before the rows use it. */
export function hostReconcile(host: unknown, projectId: string): any {
  const reconcile = hostStoreModule?.['hostReconcile'];
  if (typeof reconcile !== 'function') throw new Error('hostReconcile is not available in this tree');
  return reconcile(host, projectId);
}

/** The Host's directory for one project's store (the builder's frozen helper). */
export async function hostProjectStoreDirectory(projectId: string, root: string): Promise<string> {
  await prepareKLS1BHostStore();
  const directoryOf = hostStoreModule?.['hostProjectStoreDirectory'];
  if (typeof directoryOf !== 'function') throw new Error('hostProjectStoreDirectory is not available in this tree');
  return await directoryOf(projectId, root) as string;
}

export async function openKLS1BTwoProjects(options: KLS1BOpenOptions): Promise<KLS1BTwoProjects> {
  await prepareKLS1BHostStore();
  const actor = { kind: 'human' as const, id: 'kls1b-operator' };
  const A: CoreScope = { projectId: 'kls1b-a', workspaceId: 'kls1b-a-ws' };
  const B: CoreScope = options.cliB === true
    ? { projectId: 'kls1b-b', workspaceId: 'kls1b-b-ws' }
    : { projectId: '', workspaceId: '' };
  const rootA = await tempDir('kls1b-a-root-');
  const rootB = await tempDir('kls1b-b-root-');
  if (options.gitA === true) await initGitWorkspace(rootA);
  const storageDirectory = await tempDir('kls1b-store-');
  const publicDir = await publicDirectory();
  const storage: LocalWorkbenchHostOptions['storage'] = options.backend === 'sqlite'
    ? { kind: 'sqlite', directory: storageDirectory }
    : { kind: 'memory' };
  const settings = options.backend === 'memory'
    ? { settingsDirectory: join(storageDirectory, 'host-settings') }
    : undefined;
  let cli: KLS1BCliWorkspace[] = options.cliB === true
    ? [{ scope: A, root: rootA }, { scope: B, root: rootB }]
    : [{ scope: A, root: rootA }];
  let host: LocalWorkbenchHost | undefined;
  let base = '';
  let token = '';

  const postRoute = async (scope: CoreScope, suffix: string, body: unknown): Promise<KLS1BReply> => {
    const response = await corePost(base, suffix, token, body);
    return { status: response.status, body: await response.json() as any };
  };
  const settingsReply = async (suffix: string, body: unknown): Promise<KLS1BReply> => {
    const response = await settingsPost(base, suffix, token, body);
    return { status: response.status, body: await response.json() as any };
  };

  async function createRecords(scope: CoreScope): Promise<void> {
    const project = await postRoute(scope, 'projects/create', graphWrite(scope, { projectId: scope.projectId },
      `kls1b-fixture-${scope.projectId}-project`, [{ ref: projectRef(scope), revision: 0 }]));
    if (project.status !== 200 || project.body.status !== 'committed') {
      throw new Error(`the project record did not commit: ${JSON.stringify(project.body)}`);
    }
    const workspace = await postRoute(scope, 'workspaces/register', graphWrite(scope, { workspace: scope },
      `kls1b-fixture-${scope.workspaceId}-workspace`,
      [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 0 }]));
    if (workspace.status !== 200 || workspace.body.status !== 'committed') {
      throw new Error(`the workspace record did not commit: ${JSON.stringify(workspace.body)}`);
    }
  }

  async function startHostRound(startOptions: KLS1BStartOptions = {}): Promise<void> {
    const workspaces = (startOptions.cli ?? cli).map(workspace => ({
      scope: workspace.scope, name: workspace.scope.workspaceId, root: workspace.root,
      workspaceRevision: 1, readPrefixes: ['.'],
    }));
    const created = await createLocalWorkbenchHost({
      storage, actor, publicDir, workspaces,
      ...(settings === undefined ? {} : { settings }),
      ...startOptions.extra,
    });
    const address = await created.listen();
    host = created;
    base = address.url;
    token = await readPageToken(address.url);
  }

  async function close(): Promise<void> {
    const closing = host;
    host = undefined;
    if (closing !== undefined) await closing.close();
  }

  await startHostRound();
  await createRecords(A);
  if (options.cliB === true) {
    await createRecords(B);
  } else {
    const opened = await settingsReply('workspaces/open', { path: rootB, writeAllowed: false, commandsAllowed: false });
    if (opened.status !== 200 || opened.body.status !== 'ready') {
      throw new Error(`the second project did not open: ${JSON.stringify(opened.body)}`);
    }
    Object.assign(B, opened.body.value.scope as CoreScope);
  }
  cli = options.cliB === true ? [{ scope: A, root: rootA }, { scope: B, root: rootB }] : [{ scope: A, root: rootA }];

  return {
    A, B, rootA, rootB,
    get host(): LocalWorkbenchHost {
      if (host === undefined) throw new Error('the KLS-1b Host is not running');
      return host;
    },
    get base(): string { return base; },
    get token(): string { return token; },
    post: postRoute, settings: settingsReply,
    createGoal: (scope, goalId) => postRoute(scope, 'goals/create', graphWrite(scope,
      { goalId, workspace: scope, objective: `KLS-1b ${goalId}` }, `kls1b-goal-${goalId}`,
      [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 1 }])),
    close,
    start: startHostRound,
    async restart(restartOptions?: KLS1BStartOptions): Promise<void> {
      await close();
      await startHostRound(restartOptions);
    },
    async dispose(): Promise<void> {
      await close();
      await cleanupRestart();
    },
  };
}
