/**
 * ONE workspace-read layer fixture for the entries that observe a real temporary
 * root through `createWorkspaceAccessFactory` and `captureObservationSource`.
 *
 * Callers pass their own scope, actor, workspace revision and read grant; the
 * helper keeps the real git commands (temp directories only), the real Host
 * bindings and the production `projectAccess` adapter, and always releases the
 * opened access after an observation.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import {
  createWorkspaceAccessFactory,
  type WorkspaceHostBindings,
  type WorkspaceReadAccess,
} from '../../src/core/workspace/access.js';
import {
  captureObservationSource,
  type ObservedProjectSource,
  type ProjectSourceAccess,
} from '../../src/core/workspace/project-source-snapshot.js';

const run = promisify(execFile);
export const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

/** The caller's Workspace identity and the Host values it authorizes. */
export type ObservationWorld = {
  workspace: WorkspaceRef;
  actor: { kind: 'human'; id: string };
  workspaceRevision: number;
  subjectKey: string;
  permissionRevision: string;
};

export async function tempRoot(prefix: string, roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', args, { cwd, env: gitEnv });
}

export async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

export function context(world: ObservationWorld): CoreCallContext {
  const actor = world.actor;
  return {
    projectId: world.workspace.projectId,
    workspaceId: world.workspace.workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: world.workspace.projectId, workspaceId: world.workspace.workspaceId, actor },
    signal: new AbortController().signal,
  };
}

export function bindingsFor(world: ObservationWorld, root: string,
  allowsRead: (path: string) => boolean = () => true): WorkspaceHostBindings {
  return {
    resolveRoot: async ref => ref.projectId === world.workspace.projectId && ref.workspaceId === world.workspace.workspaceId
      ? { status: 'ready', value: { root, workspaceRevision: world.workspaceRevision } }
      : { status: 'rejected', code: 'not_found', reason: 'Unknown test workspace' },
    authorize: async (ctx, ref) => ctx.projectId === ref.projectId && ctx.workspaceId === ref.workspaceId
      ? { status: 'ready', value: {
        subjectKey: world.subjectKey, permissionRevision: world.permissionRevision, allowsRead,
      } }
      : { status: 'rejected', code: 'forbidden', reason: 'Reader scope does not match workspace' },
  };
}

/** The production adapter shape (`capture.ts` `projectAccess`) plus the two optional seams. */
export function projectAccessOf(access: WorkspaceReadAccess): ProjectSourceAccess {
  return {
    allowed: path => access.authorization.allowsRead(path),
    read: (path, maxBytes) => access.read(path, maxBytes),
    inventory: () => access.listFiles(60000),
    sourceIdentity: () => access.sourceIdentity(),
    ...(access.hostRoot === undefined ? {} : { hostRoot: access.hostRoot }),
    listObservationFiles: listed => access.listObservationFiles!(listed),
    listIgnoredCompileDatabases: listed => access.listIgnoredCompileDatabases!(listed),
  };
}

export async function open(world: ObservationWorld, root: string,
  allowsRead?: (path: string) => boolean): Promise<WorkspaceReadAccess> {
  const factory = createWorkspaceAccessFactory(bindingsFor(world, root, allowsRead));
  const opened = await factory.open(context(world), world.workspace);
  if (opened.status !== 'ready') throw new Error(`Expected readable workspace: ${opened.code}: ${opened.reason}`);
  return opened.value;
}

export async function observe(world: ObservationWorld, root: string,
  allowsRead?: (path: string) => boolean): Promise<ObservedProjectSource> {
  const access = await open(world, root, allowsRead);
  try { return await captureObservationSource(projectAccessOf(access), new AbortController().signal); }
  finally { await access.release(); }
}
