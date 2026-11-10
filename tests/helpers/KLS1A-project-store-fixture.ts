/**
 * KLS-1a project store fixture: real temporary roots, the real instance lease and
 * the real platform factory for the registry's callbacks. The new composition
 * modules land in a parallel tree, so each is loaded by path; while a module is
 * absent its exports are empty and the row fails at its own expectation.
 */
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { cleanupRestart, tempDir } from './A2-restart-fixture.js';

export { cleanupRestart, tempDir };

const AT = '2026-11-10T00:00:00.000Z';
const ACTOR = { kind: 'human' as const, id: 'kls1a-test-human' };

export const PROJECT_ID = 'kls1a-project';
export const WORKSPACE_ID = 'kls1a-workspace';
/** sha256('kls1a-project') first 16 hex digits (hand-computed, not derived from src). */
export const PROJECT_HASH = '4e9d4e77964b55ba';
/** sha256('kls1a-project\0kls1a-workspace') first 32 hex digits (hand-computed). */
export const WORKSPACE_HASH = '07b8a35c9bd4349b699b7d1b35223815';

export type LoadedModule = Record<string, any>;

async function load(path: string): Promise<LoadedModule> {
  try {
    return await import(/* @vite-ignore */ path) as LoadedModule;
  } catch {
    return {};
  }
}

export const pathsModule = (): Promise<LoadedModule> => load('../../src/composition/project-store-paths.js');
export const locationModule = (): Promise<LoadedModule> => load('../../src/composition/project-store-location.js');
export const runtimeModule = (): Promise<LoadedModule> => load('../../src/composition/project-runtime.js');
export const platformModule = (): Promise<LoadedModule> => load('../../src/composition/create-platform.js');
export const workspaceModule = (): Promise<LoadedModule> =>
  load('../../src/core/workspace/workspace-change-capture.js');

/** The canonical key `records.readMany` takes for one Project (W4). */
export function projectKey(projectId: string): string {
  return canonicalJson({ aggregateType: 'Project', projectId });
}

/** The public Host principal shape (`tests/composition/platform.test.ts:16`-`:21`). */
export function hostCtx(projectId: string, workspaceId: string): CoreCallContext {
  return {
    projectId, workspaceId,
    principal: { kind: 'host', actor: ACTOR },
    materialReader: { kind: 'host', projectId, workspaceId, actor: ACTOR },
    signal: new AbortController().signal,
  };
}

export type WorkspaceSpec = { projectId: string; workspaceId: string; root: string };

/** The real Host bindings over the roots the registry was opened with. */
export function bindingsForWorkspaces(workspaces: readonly WorkspaceSpec[]): WorkspaceHostBindings {
  const find = (requested: WorkspaceRef): WorkspaceSpec | undefined =>
    workspaces.find(entry => entry.projectId === requested.projectId
      && entry.workspaceId === requested.workspaceId);
  return {
    async resolveRoot(requested) {
      const found = find(requested);
      return found === undefined
        ? { status: 'rejected', code: 'forbidden', reason: 'unregistered workspace' }
        : { status: 'ready', value: { root: found.root, workspaceRevision: 1 } };
    },
    async authorize(ctx, requested) {
      const found = find(requested);
      const reader = ctx.materialReader;
      return found === undefined || ctx.projectId !== found.projectId
        || ctx.workspaceId !== found.workspaceId || reader.kind !== 'host'
        || reader.projectId !== found.projectId || reader.workspaceId !== found.workspaceId
        ? { status: 'rejected', code: 'forbidden', reason: 'no matching Host read grant' }
        : { status: 'ready', value: { subjectKey: `trusted-human:${ACTOR.id}`,
          permissionRevision: 'host-policy-1', allowsRead: () => true } };
    },
  };
}

export type FactoryInput = {
  projectId: string;
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  workspaces: readonly { workspaceId: string; root: string }[];
  kernelDirectory: string | null;
  lease: { hostInstanceId: string; lease: 'owned' | 'held_by_other'; takeover: unknown };
};

export type CreatePlatform = (input: FactoryInput) => Promise<{ platform: any; records: any }>;

/** A delegating factory: real bindings, the real `openTargetPlatform`, and the input recorded (A3). */
export function realFactory(seen: FactoryInput[]): CreatePlatform {
  return async (input) => {
    seen.push(input);
    const { openTargetPlatform } = await platformModule();
    const bindings = bindingsForWorkspaces(input.workspaces.map(workspace =>
      ({ projectId: input.projectId, workspaceId: workspace.workspaceId, root: workspace.root })));
    return await openTargetPlatform({
      storage: input.storage,
      workspace: bindings,
      kernelStores: { entries: [] },
      hostInstance: { hostInstanceId: input.lease.hostInstanceId, lease: input.lease.lease,
        takeover: input.lease.takeover },
      now: () => AT,
    });
  };
}

/** The real Host instance lease, keyed by the project store directory. */
export async function realLease(directory: string | null): Promise<any> {
  const { acquireHostInstanceLease } = await load('../../src/app/host-instance-lease.js');
  return await acquireHostInstanceLease({ directory, now: () => AT });
}

/** The location function with a reliable mount table, so rows do not read the machine's mounts. */
export async function reliableLocation(projectId: string, root: string): Promise<any> {
  const { projectStoreLocation } = await locationModule();
  return await projectStoreLocation?.(projectId, root, { mountReliability: async () => 'reliable' });
}

export type RegistryOptions = {
  createPlatform?: CreatePlatform;
  storage?: { kind: 'memory' } | { kind: 'sqlite'; legacyDirectory: string };
  location?: (projectId: string, root: string) => Promise<any>;
  root?: string;
  legacyDirectory?: string;
};

export type RegistryFixture = {
  root: string;
  legacyDirectory: string;
  seen: FactoryInput[];
  registry: any;
  D: string;
};

/** R1-R9's common opening: two temporary roots, the real callbacks and the registry. */
export async function openRegistry(options: RegistryOptions = {}): Promise<RegistryFixture> {
  const root = options.root ?? await tempDir('kls1a-root-');
  const legacyDirectory = options.legacyDirectory ?? await tempDir('kls1a-legacy-');
  const seen: FactoryInput[] = [];
  const { createProjectRuntimeRegistry } = await runtimeModule();
  const registry = await createProjectRuntimeRegistry?.({
    storage: options.storage ?? { kind: 'sqlite', legacyDirectory },
    acquireLease: realLease,
    createPlatform: options.createPlatform ?? realFactory(seen),
    location: options.location ?? reliableLocation,
  });
  return { root, legacyDirectory, seen, registry,
    D: join(root, '.workbench', 'local', 'projects', PROJECT_HASH) };
}
