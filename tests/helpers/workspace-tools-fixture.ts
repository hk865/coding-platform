/**
 * ONE tools-layer fixture for the entries that reach `createWorkspaceTools` over a
 * real temporary root behind the real permission-filtered sandbox.
 *
 * The three callers used to carry the same skeleton (`createWorkspaceAccessFactory`
 * with one explicit Host grant plus `createWorkspaceTools`); they differ only in
 * their Workspace/actor/policy identity, their clock, and which options they inject:
 * `denied` paths, `fileGraph` caps, `sourceAnalyzers` and capture `limits`. The
 * returned case exposes every wrapper method the three callers use.
 */
import { expect } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceCaptureRef } from '../../src/contracts/core/source.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import type { WorkspaceCaptureLimits, WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

export type Entry = [path: string, content: string | Uint8Array];
export type SourceAnalyzers = {
  directory?: string;
  pythonPath?: string;
  cppLibraryPath?: string;
  unitTimeoutMs?: number;
  languageTimeoutMs?: number;
};
export type FileGraphLimits = { maxNodes: number; maxEdges: number };

/** The architecture-source module mapping only the A25 caller needs. */
const MAPPINGS = [{ id: 'Root', kind: 'module' as const, paths: ['.'] }];

/** The ready value, asserting the status first so a failure names its code and reason. */
export function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw Error(`${result.code}: ${result.reason}`);
  return result.value;
}

export type WorkspaceToolsFixtureDefaults = {
  projectId: string;
  actorId: string;
  permissionRevision: string;
  tempPrefix: string;
  /** The Host clock literal; defaults to the 2026-10-17 clock of the first callers. */
  now?: string;
  /** The caller's afterEach cleanup list: receives the root removal and the handle close. */
  cleanups: Array<() => Promise<void>>;
};

export type WorkspaceToolsCaseOptions = {
  denied?: string[];
  fileGraph?: FileGraphLimits;
  sourceAnalyzers?: SourceAnalyzers;
  limits?: WorkspaceCaptureLimits;
};

export function workspaceToolsFixture(defaults: WorkspaceToolsFixtureDefaults) {
  const now = defaults.now ?? '2026-10-17T00:00:00.000Z';
  const workspace: WorkspaceRef = {
    aggregateType: 'Workspace', projectId: defaults.projectId, workspaceId: 'main',
  };
  const workspaceRevision = 1;
  const actor = { kind: 'human' as const, id: defaults.actorId };

  return async function fixture(entries: Entry[], options: WorkspaceToolsCaseOptions = {}) {
    const root = await mkdtemp(join(tmpdir(), defaults.tempPrefix));
    defaults.cleanups.push(() => rm(root, { recursive: true, force: true }));
    const files = new Map<string, string | Uint8Array>(entries);
    for (const [path, content] of entries) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    const denied = new Set(options.denied ?? []);
    const access = createWorkspaceAccessFactory({
      resolveRoot: async requested => requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision } }
        : { status: 'rejected', code: 'not_found', reason: 'unknown test workspace' },
      authorize: async (ctx, requested) => {
        if (requested.projectId !== workspace.projectId || requested.workspaceId !== workspace.workspaceId ||
            ctx.projectId !== workspace.projectId || ctx.workspaceId !== workspace.workspaceId ||
            ctx.principal.kind !== 'host' || ctx.principal.actor.id !== actor.id ||
            ctx.materialReader.kind !== 'host' || ctx.materialReader.projectId !== workspace.projectId ||
            ctx.materialReader.workspaceId !== workspace.workspaceId || ctx.materialReader.actor.id !== actor.id)
          return { status: 'rejected', code: 'forbidden', reason: 'no matching explicit test grant' };
        return { status: 'ready', value: {
          subjectKey: canonicalJson(['host', actor]), permissionRevision: defaults.permissionRevision,
          allowsRead: path => files.has(path) && !denied.has(path),
        } };
      },
    });
    const handle = createWorkspaceTools({
      access, now: () => now, limits: options.limits ?? DEFAULT_WORKSPACE_LIMITS,
      ...(options.fileGraph === undefined ? {} : { fileGraph: options.fileGraph }),
      ...(options.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: options.sourceAnalyzers }),
    });
    defaults.cleanups.push(() => handle.close());
    const context: CoreCallContext = {
      projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor },
      materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor },
      signal: new AbortController().signal,
    };
    const request = { workspace, workspaceRevision, provider: 'typescript' as const };
    const capture = (configPath?: string) => handle.tools.captureObservation(context, {
      ...request, ...(configPath === undefined ? {} : { configPath }),
    });
    const strictCapture = () => handle.tools.captureSourceChanges(context, request);
    const observationCapture = () => handle.tools.captureObservation(context, request);
    const graphOf = (captureRef: SourceCaptureRef) => handle.tools.captureFileGraph(context, { capture: captureRef });
    const graph = async () => graphOf(ready(await capture()).ref);
    const edit = async (path: string, content: string | Uint8Array) => {
      files.set(path, content);
      await writeFile(join(root, path), content);
    };
    return {
      root, workspace, files, denied, handle, context, request,
      capture, strictCapture, observationCapture, graph, graphOf, edit,
      exportCapture: (ref: SourceCaptureRef) => handle.tools.exportCapture(context, ref),
      architectureSource: (ref: SourceCaptureRef) =>
        handle.tools.captureArchitectureSource(context, { capture: ref, mappings: MAPPINGS }),
      fileGraph: (ref: SourceCaptureRef) => handle.tools.captureFileGraph(context, { capture: ref }),
    };
  };
}
