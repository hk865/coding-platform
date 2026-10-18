/**
 * Shared real-Host helpers for the L8 automatic-capture rows.
 *
 * Every prior state is reached the way production reaches it: a real workspace
 * on disk, the settings `workspaces/open` route or the `workspaces/register`
 * route, the real `architecture/adopt-initial` trigger, and the one public
 * `architecture/observation-state` read. No record, observation or request is
 * written by hand; `lightScan.fault` only schedules a real route request while
 * the platform is already scanning (the platform's own trusted injection).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import {
  createLocalWorkbenchHost, type LocalWorkbenchHost, type WorkbenchWorkspaceConfig,
} from '../../../src/app/host.js';
import {
  CORE_API_PREFIX, PLATFORM_TOKEN_HEADER, PLATFORM_TOKEN_PLACEHOLDER,
  type CoreScope,
} from '../../../src/app/core-http-types.js';
import { SETTINGS_API_PREFIX, UI_PLATFORM_TOKEN_META_NAME } from '../../../src/ui/api/protocol.js';
import type { ArchitectureObservationStateV1 } from '../../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { WorkspaceHostBindings } from '../../../src/core/workspace/access.js';
import { createTargetPlatform, type TargetPlatformOptions } from '../../../src/composition/create-platform.js';
import * as architectureServiceModule from '../../../src/core/work-graph/architecture/architecture-service.js';
import * as inMemoryRecordStore from '../../../src/core/record-store/in-memory-record-store.js';
import type { InMemoryRecordBackend } from '../../../src/core/record-store/in-memory-record-store.js';

export type Backend = 'memory' | 'sqlite';
export type Started = { host: LocalWorkbenchHost; base: string; token: string };

const temporary: string[] = [];
let publicDirectoryPath = '';

/** Create the real public directory whose page exposes the runtime token. */
export async function setupPublicDir(): Promise<string> {
  publicDirectoryPath = await mkdtemp(join(tmpdir(), 's8a-l8-public-'));
  temporary.push(publicDirectoryPath);
  await writeFile(join(publicDirectoryPath, 'index.html'),
    `<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  return publicDirectoryPath;
}

/** Create one temporary directory that the teardown removes. */
export async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

/** Remove every temporary directory this module created. */
export async function cleanupTemporary(): Promise<void> {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
}

export const delay = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

export const scopeOf = (projectId: string, workspaceId: string): CoreScope => ({ projectId, workspaceId });
export const projectRef = (scope: CoreScope) => ({ aggregateType: 'Project' as const, projectId: scope.projectId });
export const workspaceRef = (scope: CoreScope) => ({ aggregateType: 'Workspace' as const, ...scope });

/** One real workspace on disk with a small TypeScript source tree. */
export async function makeWorkspace(files = 3): Promise<string> {
  const root = await temporaryDirectory('s8a-l8-ws-');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    include: ['src/**/*.ts'],
  }));
  for (let index = 0; index < files; index += 1) {
    const name = `f${String(index).padStart(3, '0')}.ts`;
    await writeFile(join(root, 'src', name), `export const v${index} = ${index};\n`);
  }
  return root;
}

export function workspaceConfig(scope: CoreScope, root: string): WorkbenchWorkspaceConfig {
  return { scope, name: 'L8 workspace', root, workspaceRevision: 1, readPrefixes: ['.'] };
}

/**
 * A4: the one real in-memory record backend that both Hosts (and the
 * post-close public read) share. The wrapper around the real
 * `createInMemoryRecordBackend` factory hands the platform that ONE backend and
 * a no-op `close`, so the Host's logical close runs as usual while the physical
 * backend stays open; the world closes it last through `close()`.
 */
export type SharedMemoryBackend = {
  /** Install the A4 factory wrapper for exactly one platform construction. */
  install(): () => void;
  /** Close the physical backend for good (after every platform has closed). */
  close(): Promise<void>;
};

export function createSharedMemoryBackend(): SharedMemoryBackend {
  let physical: InMemoryRecordBackend | null = null;
  return {
    install() {
      const original = inMemoryRecordStore.createInMemoryRecordBackend;
      const spy = vi.spyOn(inMemoryRecordStore, 'createInMemoryRecordBackend').mockImplementation(options => {
        physical ??= original(options);
        const backend = physical;
        // The platform's logical close must not physically close the one backend
        // the rest of the world still reads (in-memory refuses after close).
        return { records: backend.records, close: async () => undefined };
      });
      return () => spy.mockRestore();
    },
    async close() {
      const backend = physical;
      physical = null;
      await backend?.close();
    },
  };
}

export async function startHost(input: {
  backend: Backend;
  workspaces: WorkbenchWorkspaceConfig[];
  settingsDirectory?: string;
  database?: string;
  lightScan?: TargetPlatformOptions['lightScan'];
  /** A4: the memory world's one real backend (memory backend only). */
  sharedMemoryBackend?: SharedMemoryBackend;
}): Promise<Started & { database: string }> {
  if (input.sharedMemoryBackend !== undefined && input.backend !== 'memory')
    throw new Error('a shared memory backend belongs to the memory backend');
  const database = input.database ?? await temporaryDirectory('s8a-l8-db-');
  if (publicDirectoryPath === '') throw new Error('setupPublicDir() must run before startHost()');
  const restore = input.sharedMemoryBackend?.install();
  let host: LocalWorkbenchHost;
  try {
    host = await createLocalWorkbenchHost({
      storage: input.backend === 'sqlite' ? { kind: 'sqlite', directory: database } : { kind: 'memory' },
      actor: { kind: 'human', id: 's8a-l8-operator' },
      publicDir: publicDirectoryPath,
      workspaces: input.workspaces,
      architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
      ...(input.settingsDirectory === undefined ? {} : { settings: { settingsDirectory: input.settingsDirectory } }),
      ...(input.lightScan === undefined ? {} : { lightScan: input.lightScan }),
    });
  } finally {
    restore?.();
  }
  const address = await host.listen();
  const response = await fetch(address.url);
  const html = await response.text();
  const match = new RegExp(`<meta name="${UI_PLATFORM_TOKEN_META_NAME}" content="([^"]+)">`).exec(html);
  if (match?.[1] === undefined) throw new Error('the page did not expose the runtime token meta');
  return { host, base: address.url, token: match[1], database };
}

const coreUrl = (base: string, suffix: string): string => new URL(CORE_API_PREFIX + suffix, base).toString();
const settingsUrl = (base: string, suffix: string): string => new URL(SETTINGS_API_PREFIX + suffix, base).toString();

export async function corePost(base: string, suffix: string, token: string, body: unknown): Promise<Response> {
  return fetch(coreUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
}
export async function settingsPost(base: string, suffix: string, token: string, body: unknown): Promise<Response> {
  return fetch(settingsUrl(base, suffix), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify(body),
  });
}

export const graphWrite = (scope: CoreScope, input: unknown, requestId: string, expected: unknown[]) =>
  ({ scope, request: { input, meta: { requestId, expected } } });
export const plain = (scope: CoreScope, input: unknown) => ({ scope, input });

export type StateReply = { status: 'ready'; value: ArchitectureObservationStateV1 }
  | { status: 'rejected'; code: string; reason: string };

export async function observationState(base: string, token: string, scope: CoreScope): Promise<StateReply> {
  const response = await corePost(base, 'architecture/observation-state', token, plain(scope, { workspace: scope }));
  return await response.json() as StateReply;
}

/** Bounded polling on the one public read (book ruling 8): the wait, no hook. */
export async function waitState(base: string, token: string, scope: CoreScope,
  predicate: (state: ArchitectureObservationStateV1) => boolean, timeoutMs = 30_000): Promise<ArchitectureObservationStateV1> {
  const deadline = Date.now() + timeoutMs;
  let last: StateReply | null = null;
  while (Date.now() < deadline) {
    const reply = await observationState(base, token, scope);
    last = reply;
    if (reply.status === 'ready' && predicate(reply.value)) return reply.value;
    await delay(10);
  }
  throw new Error(`observation-state did not reach the expected state: ${JSON.stringify(last)}`);
}

/** Resolve on the signal's `abort` event; `aborted` first, so a synchronous abort is not missed. */
export function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>(resolve => { signal.addEventListener('abort', () => resolve(), { once: true }); });
}

export type ObservationStorage =
  | { readonly backend: 'sqlite'; readonly database: string }
  | { readonly backend: 'memory'; readonly sharedMemoryBackend: SharedMemoryBackend };

/**
 * Read the one public observation state of each scope through a real
 * composition root over the SAME store (the remembered ruling 1(3) read). It
 * starts no capture and writes nothing. For memory this is the world's one
 * shared backend, so the read sees what the closed Host persisted.
 */
export async function observationPoint(storage: ObservationStorage,
  workspaces: readonly WorkbenchWorkspaceConfig[],
  scopes: readonly CoreScope[]): Promise<Record<string, ArchitectureObservationStateV1>> {
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      const found = workspaces.find(workspace => workspace.scope.projectId === requested.projectId
        && workspace.scope.workspaceId === requested.workspaceId);
      return found === undefined
        ? { status: 'rejected', code: 'not_found', reason: 'the workspace is not bound by this Host' }
        : { status: 'ready', value: { root: found.root, workspaceRevision: found.workspaceRevision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's8a-l8-observation-reader',
        permissionRevision: 's8a-l8-observation-v1', allowsRead: () => true } };
    },
  };
  const operator = { kind: 'human' as const, id: 's8a-l8-observation-reader' };
  const contextOf = (scope: CoreScope): CoreCallContext => ({
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: operator },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: operator },
    signal: new AbortController().signal,
  });
  const restore = storage.backend === 'memory' ? storage.sharedMemoryBackend.install() : undefined;
  let platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  try {
    platform = await createTargetPlatform({
      storage: storage.backend === 'sqlite'
        ? { kind: 'sqlite', directory: storage.database }
        : { kind: 'memory' },
      workspace: host,
      architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    });
  } finally {
    restore?.();
  }
  try {
    const states: Record<string, ArchitectureObservationStateV1> = {};
    for (const scope of scopes) {
      const read = await platform.architecture.observationState(contextOf(scope), { workspace: scope });
      if (read.status !== 'ready') throw new Error('observation-state was not ready: ' + JSON.stringify(read));
      states[scope.workspaceId] = read.value;
    }
    return states;
  } finally {
    await platform.close();
  }
}

/** A workspace registered through the route path: project create + workspace register. */
export async function routeRegistered(started: Started, scope: CoreScope): Promise<void> {
  const project = await corePost(started.base, 'projects/create', started.token,
    graphWrite(scope, { projectId: scope.projectId }, `l8-project:${scope.projectId}`, [{ ref: projectRef(scope), revision: 0 }]));
  if ((await project.json() as { status?: string }).status !== 'committed')
    throw new Error('the project route did not commit');
  const workspace = await corePost(started.base, 'workspaces/register', started.token,
    graphWrite(scope, { workspace: scope }, `l8-workspace:${scope.workspaceId}`,
      [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 0 }]));
  if ((await workspace.json() as { status?: string }).status !== 'committed')
    throw new Error('the workspace route did not commit');
}

export async function adoptInitial(started: Started, scope: CoreScope, baselineId: string): Promise<unknown> {
  const response = await corePost(started.base, 'architecture/adopt-initial', started.token,
    graphWrite(scope, {
      baselineId,
      description: 'L8 adopted structure',
      constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [
        { ref: { projectId: scope.projectId, moduleId: 'core' }, name: 'Core', responsibility: 'The source tree', paths: ['src'], interfaces: [] },
      ] },
    }, `l8-adopt:${baselineId}`,
    [{ ref: projectRef(scope), revision: 1 }, { ref: workspaceRef(scope), revision: 1 }]));
  return await response.json();
}

export const completed = (state: ArchitectureObservationStateV1): boolean =>
  state.current !== null && state.autoCapture !== null && state.autoCapture.pending === false;

/** One real `workspace.captureObservation` call seen by the gate, in call order. */
export type CaptureGateEntry = { workspaceId: string; signal: AbortSignal };
export type CaptureGate = {
  entries: CaptureGateEntry[];
  /** Resolves with the first real entry for the workspace (or its recorded entry). */
  entered(workspaceId: string): Promise<CaptureGateEntry>;
  /** Release every held call and stop holding calls that have not entered yet. */
  open(): void;
  /** Restore the spied module export. */
  restore(): void;
};

/**
 * A3 delegate gate around the REAL `createObservedArchitecture` factory. The
 * spy builds the real service from the same dependencies and replaces only the
 * `workspace.captureObservation` delegate: it records the call and the caller's
 * original signal, waits while the workspace is held, then returns the real
 * call's result unchanged. No production test hook and no `lightScan` fault.
 */
export function installCaptureGate(heldWorkspaces: readonly string[] = []): CaptureGate {
  const held = new Set(heldWorkspaces);
  const waiting: Array<() => void> = [];
  const entries: CaptureGateEntry[] = [];
  const entryWaiters = new Map<string, Array<(entry: CaptureGateEntry) => void>>();
  const entered = (workspaceId: string): Promise<CaptureGateEntry> => {
    const recorded = entries.find(entry => entry.workspaceId === workspaceId);
    if (recorded !== undefined) return Promise.resolve(recorded);
    return new Promise<CaptureGateEntry>(resolve => {
      const waiters = entryWaiters.get(workspaceId) ?? [];
      waiters.push(resolve);
      entryWaiters.set(workspaceId, waiters);
    });
  };
  const original = architectureServiceModule.createObservedArchitecture;
  const spy = vi.spyOn(architectureServiceModule, 'createObservedArchitecture').mockImplementation(deps => {
    const workspace = deps.workspace;
    const gated = {
      ...workspace,
      async captureObservation(ctx: CoreCallContext, input: Parameters<typeof workspace.captureObservation>[1]) {
        const workspaceId = ctx.workspaceId ?? '';
        const entry = { workspaceId, signal: ctx.signal };
        entries.push(entry);
        for (const resolve of entryWaiters.get(workspaceId) ?? []) resolve(entry);
        entryWaiters.delete(workspaceId);
        if (held.has(workspaceId)) {
          await new Promise<void>(resolve => { waiting.push(resolve); });
        }
        return workspace.captureObservation(ctx, input);
      },
    };
    return original({ ...deps, workspace: gated });
  });
  return {
    entries,
    entered,
    open() {
      held.clear();
      for (const release of waiting.splice(0)) release();
    },
    restore() { spy.mockRestore(); },
  };
}
