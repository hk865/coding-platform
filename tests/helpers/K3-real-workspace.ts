/**
 * F-021/F-097: ONE real workspace over a real temp directory.
 *
 * The platform's own `createWorkspaceAccessFactory` + `createWorkspaceTools`
 * serve `readWorkspace`; the Host inputs are the test's real root, its Workspace
 * ref and a current authorization that admits paths inside that root (A8). The
 * optional wrappers below count or fail the REAL reader's calls and return its
 * result unchanged (A2/A3) — they never build a `WorkspaceFile`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { WorkspaceFileReader } from '../../src/core/work-graph/model/kernel-command-read-contracts.js';
import type { WorkspaceFile, WorkspaceResult } from '../../src/core/workspace/ports.js';
import { createWorkspaceAccessFactory } from '../../src/core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../../src/core/workspace/workspace-tools.js';

export type RealWorkspaceOptions = {
  /** An existing test-created directory; omitted, the helper creates one. */
  root?: string;
  /** Literal file contents written into the root (nested paths are created). */
  files?: Record<string, string>;
  /** The Workspace ref the Host resolves; default `{ projectId: 'P', workspaceId: 'W' }`. */
  workspace?: WorkspaceRef;
  /** The Host clock used for each read's `readAt`. */
  now?: () => string;
};

export type RealWorkspace = {
  root: string;
  workspace: WorkspaceRef;
  /** A trusted Host context for this workspace (A8), for readers that need one. */
  ctx: CoreCallContext;
  /** The production reader bound to the Host's real root and authorization. */
  readWorkspace: WorkspaceFileReader['readWorkspace'];
  close(): Promise<void>;
};

const defaultWorkspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'P', workspaceId: 'W' };

/** A readable path is a normalized workspace-relative path; the Kernel sandbox re-checks it. */
function insideRoot(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\0');
}

export async function openRealWorkspace(options: RealWorkspaceOptions = {}): Promise<RealWorkspace> {
  const workspace = options.workspace ?? defaultWorkspace;
  const ownsRoot = options.root === undefined;
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'k3-real-workspace-'));
  try {
    for (const [path, content] of Object.entries(options.files ?? {})) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content, 'utf8');
    }
    const access = createWorkspaceAccessFactory({
      async resolveRoot(requested: WorkspaceRef): Promise<WorkspaceResult<{ root: string; workspaceRevision: number }>> {
        return requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
          ? { status: 'ready', value: { root, workspaceRevision: 1 } }
          : { status: 'rejected', code: 'not_found', reason: 'the real workspace is not registered' };
      },
      async authorize(ctx: CoreCallContext, requested: WorkspaceRef): Promise<
      WorkspaceResult<{ subjectKey: string; permissionRevision: string; allowsRead(path: string): boolean }>> {
        return ctx.projectId === workspace.projectId && ctx.workspaceId === workspace.workspaceId
          && requested.projectId === workspace.projectId && requested.workspaceId === workspace.workspaceId
          ? { status: 'ready', value: {
            subjectKey: `host:${workspace.projectId}:${workspace.workspaceId}`,
            permissionRevision: 'k3-real-workspace@1',
            allowsRead: insideRoot,
          } }
          : { status: 'rejected', code: 'forbidden', reason: 'the Host authorization does not cover this workspace' };
      },
    });
    const handle = createWorkspaceTools({
      access,
      now: options.now ?? (() => '2026-10-18T00:00:00.000Z'),
      limits: DEFAULT_WORKSPACE_LIMITS,
    });
    const ctx: CoreCallContext = {
      projectId: workspace.projectId,
      workspaceId: workspace.workspaceId,
      principal: { kind: 'host', actor: { kind: 'human', id: 'k3-real-workspace' } },
      materialReader: { kind: 'none' },
      signal: new AbortController().signal,
    } as unknown as CoreCallContext;
    return {
      root,
      workspace,
      ctx,
      readWorkspace: (readCtx, input) => handle.tools.readWorkspace(readCtx, input),
      close: async () => {
        await handle.close();
        if (ownsRoot) await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (ownsRoot) await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export type CountedWorkspaceReader = WorkspaceFileReader & {
  /** Every path the real reader was asked for, in order. */
  paths: string[];
  reset(): void;
};

/** A3: count the calls and return the real reader's result unchanged. */
export function countWorkspaceReads(reader: WorkspaceFileReader['readWorkspace']): CountedWorkspaceReader {
  const paths: string[] = [];
  return {
    paths,
    reset: () => { paths.length = 0; },
    readWorkspace: async (ctx, input) => {
      paths.push(input.path);
      return reader(ctx, input);
    },
  };
}

export type FailingWorkspaceReader = WorkspaceFileReader & {
  /** Every path whose real read was replaced by the injected failure. */
  failed: string[];
};

/** A2: fail the named (or every) path once/always, delegating everything else. */
export function failWorkspaceReads(
  reader: WorkspaceFileReader['readWorkspace'],
  options: { path?: string; reason?: string; once?: boolean } = {},
): FailingWorkspaceReader {
  const failed: string[] = [];
  let remaining = 1;
  return {
    failed,
    readWorkspace: async (ctx, input): Promise<WorkspaceResult<WorkspaceFile>> => {
      const matches = options.path === undefined || options.path === input.path;
      if (matches && (options.once !== true || remaining > 0)) {
        if (options.once === true) remaining -= 1;
        failed.push(input.path);
        throw new Error(options.reason ?? `injected workspace read failure: ${input.path}`);
      }
      return reader(ctx, input);
    },
  };
}
