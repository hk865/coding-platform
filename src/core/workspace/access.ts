import { WorkspaceSandbox, DefaultPermissionPolicy } from '../../../vendor/coding-agent/dist/public-api.js';
import type { WorkspaceRef } from '../../contracts/ledger.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { GitFileIdentity, WorkspaceResult } from './ports.js';
import { createWorkspaceGitReadAccess } from './git-read.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';
import { readSourceIdentity } from './source-identity.js';

/**
 * Host bindings for one workspace read access. The Host resolves the real root and the
 * current authorization; the returned identity/authorization is what the registry binds
 * a capture to. Nothing here is model-supplied.
 */
export type WorkspaceAuthorization = {
  subjectKey: string;
  permissionRevision: string;
  allowsRead(path: string): boolean;
};
export type WorkspaceHostBindings = {
  resolveRoot(workspace: WorkspaceRef): Promise<WorkspaceResult<{ root: string; workspaceRevision: number }>>;
  authorize(ctx: CoreCallContext, workspace: WorkspaceRef): Promise<WorkspaceResult<WorkspaceAuthorization>>;
};
/**
 * Trusted Git capability bound to one already-authorized access. It never accepts a root,
 * argv, environment or permission from the model; the real factory supplies the exact root
 * handle getter and the same allowed predicate used for ordinary reads.
 */
export interface WorkspaceGitReadAccess {
  readFile(input: { commit: string; path: string; maxBytes: number }):
    Promise<WorkspaceResult<{ commit: string; bytes: Uint8Array }>>;
  readTree(input: { commit: string; prefix: string | null; maxEntries: number; maxBytes: number }):
    Promise<WorkspaceResult<{ commit: string; files: readonly ({ path: string } & GitFileIdentity)[] }>>;
}
export interface WorkspaceReadAccess {
  readonly workspace: WorkspaceRef;
  /** Workspace registration revision from the trusted Host record. */
  readonly workspaceRevision: number;
  /** Canonical bound-root identity; a rebound root must change it. */
  readonly workspaceIdentity: string;
  readonly authorization: WorkspaceAuthorization;
  /** Present only when the access can derive a trusted, root-bound Git reader. */
  readonly git?: WorkspaceGitReadAccess;
  listFiles(limit: number): Promise<{ paths: string[]; truncated: boolean }>;
  /** `byteLength`/`revision` are the Kernel's real raw-byte facts, not a re-hash of `content`.
   * `mode` is the Kernel's real file mode when the reader exposes it; a mixed comparison treats a
   * missing mode as unsupported rather than guessing 100644. */
  read(path: string, maxBytes: number): Promise<{ content: string; revision: string; byteLength: number; mode?: number }>;
  sourceIdentity(): Promise<{ workspace: string; commit: string | null }>;
  /** Releases this adapter's own resources; the Kernel sandbox has no same-named method. */
  release(): Promise<void>;
}
export interface WorkspaceAccessFactory {
  open(ctx: CoreCallContext, workspace: WorkspaceRef): Promise<WorkspaceResult<WorkspaceReadAccess>>;
}

const rejected = (code: 'cancelled' | 'forbidden' | 'unavailable', reason: string): WorkspaceResult<never> => ({ status: 'rejected', code, reason });

/**
 * Every `open` re-runs resolveRoot + authorize and creates a fresh sandbox; the kernel
 * still enforces denied prefixes and symlink/path boundaries, and `allowsRead` adds the
 * current authorization domain on top. The returned access is bound to `ctx.signal`.
 */
export function createWorkspaceAccessFactory(bindings: WorkspaceHostBindings): WorkspaceAccessFactory {
  return {
    async open(ctx: CoreCallContext, workspace: WorkspaceRef): Promise<WorkspaceResult<WorkspaceReadAccess>> {
      if (ctx.signal.aborted) return rejected('cancelled', 'request cancelled');
      const resolved = await bindings.resolveRoot(workspace);
      if (resolved.status !== 'ready') return resolved;
      if (ctx.signal.aborted) return rejected('cancelled', 'request cancelled');
      const authorized = await bindings.authorize(ctx, workspace);
      if (authorized.status !== 'ready') return authorized;
      if (ctx.signal.aborted) return rejected('cancelled', 'request cancelled');
      const root = resolved.value.root;
      let sandbox: WorkspaceSandbox;
      try { sandbox = await WorkspaceSandbox.create(root, { deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES] }); }
      catch (error) { return rejected('unavailable', 'workspace root unavailable: ' + messageOf(error)); }
      const policy = new DefaultPermissionPolicy({ hiddenPrefixes: sandbox.deniedPrefixes });
      const allowed = (path: string) => authorized.value.allowsRead(path) && policy.evaluate({ runId: 'source-capture', callId: 'source-read', tool: 'read', effectClass: 'read_only', arguments: { path }, paths: [path], cwd: null, commandPreview: null,
        capabilities: ['workspace_read'], workspaceIdentity: sandbox.identity, workspaceRevision: 'current', sandboxProfileVersion: 'source-v1' }).decision === 'allow';
      let released = false;
      const live = () => { if (released) throw Error('workspace read access released'); ctx.signal.throwIfAborted(); };
      // Built lazily: the bound object only stores the root-handle getter, so ordinary
      // reads/captures never probe Git and no handle is acquired before a real Git call.
      const git = createWorkspaceGitReadAccess({ acquireRootHandle: () => sandbox.acquireRootHandleForProcess(),
        allowsRead: allowed, signal: ctx.signal, live });
      return { status: 'ready', value: {
        workspace, workspaceRevision: resolved.value.workspaceRevision, workspaceIdentity: sandbox.identity, git,
        authorization: { subjectKey: authorized.value.subjectKey, permissionRevision: authorized.value.permissionRevision, allowsRead: allowed },
        async listFiles(limit) {
          live();
          const listed = await sandbox.listFiles(limit, { signal: ctx.signal });
          // Intersect the trusted read scope with the sandbox's own path/link policy: a revoked
          // path must not be visible through inventory either.
          return { paths: listed.paths.filter(path => allowed(path)), truncated: listed.truncated };
        },
        async read(path, maxBytes) {
          live();
          if (!allowed(path)) throw Error('path outside readable scope');
          const file = await sandbox.read(path, maxBytes);
          ctx.signal.throwIfAborted();
          return { content: file.content, revision: file.revision, byteLength: file.byteLength, mode: file.mode };
        },
        async sourceIdentity() { live(); return readSourceIdentity(root, sandbox.identity); },
        async release() { released = true; },
      } };
    },
  };
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
