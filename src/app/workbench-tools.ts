/**
 * MVP workbench Host tools: the ONE Host-layer adapter over the frozen Kernel
 * `WorkspaceSandbox` CAS write and `ProcessSandbox` command execution.
 *
 * Ownership: this file only adapts the Kernel. It owns no ledger, Session, Task
 * or Agent, and it never exposes a root or a prefix list to a browser DTO. The
 * trusted startup configuration (workspace root, read/write prefixes, command
 * authorization) comes from `host.ts`, is snapshotted before the first await and
 * is never request input.
 *
 * Permission boundaries:
 *   - an absent `writePrefixes` denies every write and an absent `allowCommands`
 *     denies every command; neither is ever inferred from `readPrefixes`;
 *   - a path is canonicalized and any traversal is rejected BEFORE the prefix
 *     check, so `src/../secret` can never borrow the `src` prefix;
 *   - the Kernel `WorkspaceSandbox` is created with the platform
 *     `WORKSPACE_DENIED_PREFIXES`, so its own symlink/path boundary still runs.
 *
 * A save uses the USER's `expectedRevision` for the Kernel CAS and returns the
 * Kernel's actual `newRevision`; `null` is an exclusive create. A background
 * command keeps its own Host handle and never depends on the HTTP request signal
 * after it is accepted; the stop is observed as `settled`/`cancelled`.
 */
import { ProcessSandbox, ProcessSandboxError, WorkspaceSandbox, WorkspaceSandboxError } from '../../vendor/coding-agent/dist/public-api.js';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { MaterialSourceScope } from '../contracts/material-access.js';
import { WORKSPACE_DENIED_PREFIXES } from '../core/workspace/denied-prefixes.js';
import type { WorkspaceError, WorkspaceResult } from '../core/workspace/ports.js';

/** One trusted workspace this helper may write/execute in. `root`,
 * `readPrefixes`, `writePrefixes` and `allowCommands` are frozen startup facts,
 * never request input. */
export type WorkbenchToolsWorkspace = {
  scope: MaterialSourceScope;
  root: string;
  readPrefixes: readonly string[];
  /** Normalized relative path prefixes a CAS save may write. Absence (or an
   * empty list) denies every write. A writable path must ALSO be readable. */
  writePrefixes?: readonly string[];
  /** Explicit whole-workspace command authorization. Absence denies commands.
   * This is never inferred from `readPrefixes`. */
  allowCommands?: boolean;
};

export type WorkbenchToolsOptions = {
  workspaces: readonly WorkbenchToolsWorkspace[];
  /** Kernel `WorkspaceSandbox` file ceiling; the Kernel default applies when omitted. */
  maxFileBytes?: number;
  /** Default command ceiling used when the request does not carry its own. */
  commandTimeoutMs?: number;
  commandOutputLimitBytes?: number;
};

export type SaveWorkbenchFileRequest = {
  /** Normalized workspace-relative path. */
  path: string;
  /** The exact Kernel content revision the editor draft was based on; `null`
   * requests an exclusive create. A guessed revision is never accepted. */
  expectedRevision: string | null;
  content: string;
};

/** The real Kernel write receipt: `oldRevision` is null for an exclusive
 * create, `revision`/`byteLength` are the Kernel's own post-write facts. */
export type SaveWorkbenchFileResult = {
  path: string;
  oldRevision: string | null;
  revision: string;
  byteLength: number;
};

/** One bounded directory inventory read. `prefix` is a normalized
 * workspace-relative directory; ABSENT (or an empty string) enumerates the
 * readable workspace root, so the browser never sends a `'.'` root marker. It
 * is a display selector, never a permission grant: the returned paths are still
 * projected through the trusted `readPrefixes`. */
export type ListWorkbenchFilesRequest = { prefix?: string };

/** The bounded inventory result. `partial` is the Kernel's OWN truncation fact:
 * the 60000-entry scan ceiling, the directory-depth ceiling or a child that
 * could not be read all set it. It means the listing is not complete (narrow the
 * directory range), never a silently empty page. A binary or oversized file is
 * listed by PATH without reading its bytes, so the original text-capture/read
 * ceiling is unchanged. */
export type ListWorkbenchFilesResult = { paths: string[]; partial: boolean };

export type StartWorkbenchCommandRequest = {
  /** Caller-visible idempotency key; replaying the same request id with the same
   * command/cwd returns the same handle instead of starting a second process. */
  requestId: string;
  command: string;
  cwd: string;
};

export type WorkbenchCommandRef = { commandId: string };

/** `stopping` is a requested stop that has not been observed as settled yet.
 * A `settled` handle keeps its output and its real exit/timed-out facts. */
export type WorkbenchCommandState = 'running' | 'stopping' | 'settled';

export type WorkbenchCommandSnapshot = {
  /** A saved execution/launch failure, never fabricated process stderr. */
  error: { code: string; reason: string } | null;
  commandId: string;
  state: WorkbenchCommandState;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
};

export interface WorkbenchToolsPort {
  saveFile(ctx: CoreCallContext, request: SaveWorkbenchFileRequest):
    Promise<WorkspaceResult<SaveWorkbenchFileResult>>;
  listFiles(ctx: CoreCallContext, request: ListWorkbenchFilesRequest):
    Promise<WorkspaceResult<ListWorkbenchFilesResult>>;
  startCommand(ctx: CoreCallContext, request: StartWorkbenchCommandRequest):
    Promise<WorkspaceResult<WorkbenchCommandSnapshot>>;
  readCommand(ctx: CoreCallContext, request: WorkbenchCommandRef):
    Promise<WorkspaceResult<WorkbenchCommandSnapshot>>;
  stopCommand(ctx: CoreCallContext, request: WorkbenchCommandRef):
    Promise<WorkspaceResult<WorkbenchCommandSnapshot>>;
}

/** The per-workspace Kernel handles this factory owns. */
export type WorkbenchKernelHandles = {
  workspace: WorkspaceSandbox;
  process: ProcessSandbox | null;
};

export type WorkbenchToolsHandle = {
  tools: WorkbenchToolsPort;
  /**
   * Register ONE additional trusted workspace at runtime (a newly opened
   * directory) with the SAME validation as startup. It is idempotent for an
   * identical existing scope and rejects a conflicting definition for the same
   * scope; it never widens an existing workspace grant.
   */
  addWorkspace(workspace: WorkbenchToolsWorkspace): void;
  /** Refuses new starts, aborts every owned handle and awaits its real drain. */
  close(): Promise<void>;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 1_048_576;

const scopeKey = (scope: MaterialSourceScope): string => `${scope.projectId}\u0000${scope.workspaceId}`;

/** Segment-aware prefix match, identical to the Host read rule: `'.'` means the
 * whole workspace and an empty prefix never matches. */
function prefixMatches(prefix: string, path: string): boolean {
  if (prefix === '.') return true;
  const normalized = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized.length === 0) return false;
  return path === normalized || path.startsWith(`${normalized}/`);
}

const readable = (workspace: WorkbenchToolsWorkspace, path: string): boolean =>
  workspace.readPrefixes.some(prefix => prefixMatches(prefix, path));
const writable = (workspace: WorkbenchToolsWorkspace, path: string): boolean =>
  (workspace.writePrefixes ?? []).some(prefix => prefixMatches(prefix, path));

/** Strict already-canonical workspace-relative path. Every `..`/`.`/empty
 * segment, a backslash, a NUL or an absolute path is rejected, so the prefix
 * authorization below can never be borrowed through a traversal. */
function normalizeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  if (value.includes('\\') || value.includes('\u0000') || value.startsWith('/')) return null;
  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  return value;
}

/** The command cwd is the workspace root (`'.'`) or the same canonical path. */
function normalizeCommandCwd(value: unknown): string | null {
  if (value === '.') return '.';
  return normalizeRelativePath(value);
}

function snapshotWorkspaces(source: readonly WorkbenchToolsWorkspace[]): WorkbenchToolsWorkspace[] {
  return source.map(workspace => ({
    scope: { projectId: workspace.scope.projectId, workspaceId: workspace.scope.workspaceId },
    root: workspace.root,
    readPrefixes: [...workspace.readPrefixes],
    ...(workspace.writePrefixes === undefined ? {} : { writePrefixes: [...workspace.writePrefixes] }),
    ...(workspace.allowCommands === undefined ? {} : { allowCommands: workspace.allowCommands }),
  }));
}

function validateWorkspaces(workspaces: WorkbenchToolsWorkspace[]): void {
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    if (typeof workspace.scope.projectId !== 'string' || workspace.scope.projectId.length === 0
      || typeof workspace.scope.workspaceId !== 'string' || workspace.scope.workspaceId.length === 0)
      throw new Error('every workbench tools workspace requires a non-empty projectId and workspaceId');
    const key = scopeKey(workspace.scope);
    if (seen.has(key)) throw new Error(`duplicate workbench tools workspace scope ${key}`);
    seen.add(key);
    if (typeof workspace.root !== 'string' || workspace.root.length === 0)
      throw new Error('every workbench tools workspace requires a trusted root');
    if (!Array.isArray(workspace.readPrefixes) || workspace.readPrefixes.some(value => typeof value !== 'string'))
      throw new Error('readPrefixes must be an array of strings');
    if (workspace.writePrefixes !== undefined
      && (!Array.isArray(workspace.writePrefixes) || workspace.writePrefixes.some(value => typeof value !== 'string')))
      throw new Error('writePrefixes must be an array of strings when present');
    if (workspace.allowCommands !== undefined && typeof workspace.allowCommands !== 'boolean')
      throw new Error('allowCommands must be a boolean when present');
  }
}

const rejected = (code: WorkspaceError, reason: string): WorkspaceResult<never> =>
  ({ status: 'rejected', code, reason });

/** Map one real Kernel sandbox failure onto the closed WorkspaceError
 * vocabulary. `file_changed`/`already_exists` are CAS conflicts, never a
 * successful write. */
function mapSandboxError(error: unknown): WorkspaceResult<never> {
  if (error instanceof WorkspaceSandboxError) {
    switch (error.code) {
      case 'invalid_path':
      case 'permission_denied':
        return rejected('forbidden', error.message);
      case 'not_found':
      case 'parent_missing':
        return rejected('not_found', error.message);
      case 'file_changed':
      case 'already_exists':
        return rejected('source_stale', error.message);
      case 'too_large':
        return rejected('capacity', error.message);
      case 'io_error':
        return rejected('unavailable', error.message);
      default:
        return rejected('invalid', error.message);
    }
  }
  return rejected('unavailable', error instanceof Error ? error.message : String(error));
}

function commandErrorOf(error: unknown): { code: string; reason: string } {
  if (error instanceof ProcessSandboxError) return { code: error.code, reason: error.message };
  return { code: 'command_failed', reason: error instanceof Error ? error.message : String(error) };
}

/** One background command handle. Its own AbortController is the ONLY stop
 * signal; the HTTP request signal is not retained after acceptance. */
type CommandHandle = {
  commandId: string;
  requestId: string;
  scope: MaterialSourceScope;
  command: string;
  cwd: string;
  controller: AbortController;
  snapshot: WorkbenchCommandSnapshot;
  execution: Promise<void>;
};

function commandSnapshotOf(handle: CommandHandle): WorkbenchCommandSnapshot {
  return { ...handle.snapshot, error: handle.snapshot.error === null ? null : { ...handle.snapshot.error } };
}

type WorkspaceRuntime = {
  config: WorkbenchToolsWorkspace;
  sandbox: Promise<WorkspaceSandbox> | null;
  process: Promise<ProcessSandbox | null> | null;
};

export function createWorkbenchTools(options: WorkbenchToolsOptions): WorkbenchToolsHandle {
  const workspaces = snapshotWorkspaces(options.workspaces);
  validateWorkspaces(workspaces);
  const byScope = new Map<string, WorkspaceRuntime>(
    workspaces.map(workspace => [scopeKey(workspace.scope), { config: workspace, sandbox: null, process: null }] as const),
  );
  const handlesById = new Map<string, CommandHandle>();
  const handlesByRequest = new Map<string, CommandHandle>();
  let commandSeq = 0;

  function addWorkspace(workspace: WorkbenchToolsWorkspace): void {
    const snapshot = snapshotWorkspaces([workspace]);
    validateWorkspaces(snapshot);
    const next = snapshot[0]!;
    const key = scopeKey(next.scope);
    const existing = byScope.get(key);
    if (existing !== undefined) {
      if (canonicalJson(existing.config as unknown as JsonValue) !== canonicalJson(next as unknown as JsonValue)) {
        throw new Error(`conflicting workbench tools workspace ${key}`);
      }
      return;
    }
    byScope.set(key, { config: next, sandbox: null, process: null });
  }
  let closed = false;
  let closePromise: Promise<void> | undefined;

  /** Bind the trusted Host scope before any Kernel capability is acquired. */
  function bind(ctx: CoreCallContext): WorkspaceRuntime | WorkspaceResult<never> {
    if (closed) return rejected('unsupported', 'the workbench tools are closed');
    const raw = ctx as unknown as { principal?: unknown } | null | undefined;
    if (raw === null || raw === undefined || typeof raw.principal !== 'object' || raw.principal === null
      || (raw.principal as { kind?: unknown }).kind !== 'host') {
      return rejected('forbidden', 'workbench tools require a trusted Host call context');
    }
    if (typeof ctx.projectId !== 'string' || ctx.projectId.length === 0
      || typeof ctx.workspaceId !== 'string' || ctx.workspaceId.length === 0) {
      return rejected('forbidden', 'workbench tools require a bound project/workspace scope');
    }
    const runtime = byScope.get(scopeKey({ projectId: ctx.projectId, workspaceId: ctx.workspaceId }));
    if (runtime === undefined) {
      return rejected('forbidden', 'the workspace is not part of the trusted workbench tools configuration');
    }
    return runtime;
  }

  const isRejection = (value: WorkspaceRuntime | WorkspaceResult<never>): value is WorkspaceResult<never> =>
    'status' in value && value.status === 'rejected';

  /** The SAME Kernel workspace sandbox the reads use, protected by the platform
   * denied prefixes. Created once per workspace on first use. */
  function workspaceSandbox(runtime: WorkspaceRuntime): Promise<WorkspaceSandbox> {
    runtime.sandbox ??= WorkspaceSandbox.create(runtime.config.root, {
      deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES],
      ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    });
    return runtime.sandbox;
  }

  /** The real bubblewrap command sandbox, or null when the Kernel profile is not
   * available. It never falls back to the host shell. */
  function processSandbox(runtime: WorkspaceRuntime): Promise<ProcessSandbox | null> {
    runtime.process ??= (async () => {
      const sandbox = await workspaceSandbox(runtime);
      const profile = await ProcessSandbox.probe(runtime.config.root, sandbox);
      if (!profile.available) return null;
      return new ProcessSandbox(profile, runtime.config.root, sandbox);
    })();
    return runtime.process;
  }

  const tools: WorkbenchToolsPort = {
    async saveFile(ctx, request) {
      const bound = bind(ctx);
      if (isRejection(bound)) return bound;
      const path = normalizeRelativePath(request.path);
      if (path === null) return rejected('invalid', 'the path must be a normalized workspace-relative path');
      if (!readable(bound.config, path) || !writable(bound.config, path)) {
        return rejected('forbidden', 'the path is outside the authorized readable AND writable scope');
      }
      if (typeof request.content !== 'string') return rejected('invalid', 'the file content must be a string');
      if (request.expectedRevision !== null && typeof request.expectedRevision !== 'string') {
        return rejected('invalid', 'expectedRevision must be a string or null');
      }
      let sandbox: WorkspaceSandbox;
      try { sandbox = await workspaceSandbox(bound); }
      catch (error) { return mapSandboxError(error); }
      try {
        if (request.expectedRevision === null) {
          const write = await sandbox.createFile(path, request.content);
          return { status: 'ready', value: {
            path: write.path, oldRevision: null, revision: write.newRevision,
            byteLength: Buffer.byteLength(request.content, 'utf8'),
          } };
        }
        // Read the current FULL content only to give the Kernel replace its
        // oldText. The CAS decision is the USER's expectedRevision and is made
        // inside the Kernel; the current revision is never substituted for it.
        const current = await sandbox.read(path);
        const write = await sandbox.replace(path, current.content, request.content, request.expectedRevision);
        return { status: 'ready', value: {
          path: write.path, oldRevision: write.oldRevision, revision: write.newRevision,
          byteLength: Buffer.byteLength(request.content, 'utf8'),
        } };
      } catch (error) {
        return mapSandboxError(error);
      }
    },

    async listFiles(ctx, request) {
      const bound = bind(ctx);
      if (isRejection(bound)) return bound;
      let prefix: string | undefined;
      if (request.prefix !== undefined && request.prefix !== '') {
        const normalized = normalizeRelativePath(request.prefix);
        if (normalized === null) {
          return rejected('invalid', 'the prefix must be a normalized workspace-relative directory');
        }
        // The prefix may NARROW the read scope, never widen it; a directory
        // outside the trusted readPrefixes is forbidden, not silently ignored.
        if (!readable(bound.config, normalized)) {
          return rejected('forbidden', 'the prefix is outside the authorized readable scope');
        }
        prefix = normalized;
      }
      if (ctx.signal.aborted) return rejected('cancelled', 'the listing was cancelled before it started');
      let sandbox: WorkspaceSandbox;
      try { sandbox = await workspaceSandbox(bound); }
      catch (error) { return mapSandboxError(error); }
      try {
        // Reuse the existing Kernel bounded inventory at its own 60000-entry
        // ceiling. It only lstats entries and never reads a body, so a binary or
        // oversized member is still listed by path. `truncated` also covers the
        // depth ceiling and a child that could not be read, and is surfaced
        // verbatim as `partial`.
        const page = await sandbox.listFiles(60000, {
          ...(prefix === undefined ? {} : { prefix }),
          signal: ctx.signal,
        });
        return { status: 'ready', value: {
          // The Kernel already applies its denied/symlink boundary; project the
          // result through the trusted readPrefixes so only authorized paths are
          // ever published, at the root or any narrowed prefix.
          paths: page.paths.filter(path => readable(bound.config, path)),
          partial: page.truncated,
        } };
      } catch (error) {
        if (ctx.signal.aborted) return rejected('cancelled', 'the listing was cancelled');
        return mapSandboxError(error);
      }
    },

    async startCommand(ctx, request) {
      const bound = bind(ctx);
      if (isRejection(bound)) return bound;
      if (bound.config.allowCommands !== true) {
        return rejected('forbidden', 'the workspace has no trusted command authorization');
      }
      if (typeof request.requestId !== 'string' || request.requestId.length === 0
        || typeof request.command !== 'string' || request.command.length === 0) {
        return rejected('invalid', 'a non-empty requestId and command are required');
      }
      const cwd = normalizeCommandCwd(request.cwd);
      if (cwd === null) return rejected('invalid', 'cwd must be "." or a normalized workspace-relative path');
      if (ctx.signal.aborted) return rejected('cancelled', 'the command start was cancelled before it was accepted');
      const requestKey = `${scopeKey(bound.config.scope)}\u0000${request.requestId}`;
      const existing = handlesByRequest.get(requestKey);
      if (existing !== undefined) {
        if (existing.command !== request.command || existing.cwd !== cwd) {
          return rejected('invalid', 'the requestId was already accepted with a different command');
        }
        return { status: 'ready', value: commandSnapshotOf(existing) };
      }
      const process = await processSandbox(bound);
      // Probe acquisition yields: another identical start or close may have
      // completed while awaiting it. Reserve the handle without another await.
      if (closed) return rejected('unsupported', 'the workbench tools are closed');
      if (ctx.signal.aborted) return rejected('cancelled', 'the command start was cancelled before it was accepted');
      const concurrent = handlesByRequest.get(requestKey);
      if (concurrent !== undefined) {
        if (concurrent.command !== request.command || concurrent.cwd !== cwd) {
          return rejected('invalid', 'the requestId was already accepted with a different command');
        }
        return { status: 'ready', value: commandSnapshotOf(concurrent) };
      }
      if (process === null) {
        return rejected('unsupported', 'the Kernel ProcessSandbox profile is not available; no host shell fallback');
      }
      commandSeq += 1;
      const handle: CommandHandle = {
        commandId: `workbench-command-${commandSeq.toString(36)}`,
        requestId: request.requestId,
        scope: { projectId: bound.config.scope.projectId, workspaceId: bound.config.scope.workspaceId },
        command: request.command,
        cwd,
        controller: new AbortController(),
        snapshot: {
          error: null, commandId: '', state: 'running', stdout: '', stderr: '',
          outputTruncated: false, exitCode: null, signal: null, timedOut: false, cancelled: false,
        },
        execution: Promise.resolve(),
      };
      handle.snapshot.commandId = handle.commandId;
      handlesById.set(handle.commandId, handle);
      handlesByRequest.set(requestKey, handle);
      // The background execution owns its own signal; a browser disconnect after
      // acceptance never stops it.
      handle.execution = (async () => {
        try {
          const result = await process.execute({
            command: handle.command,
            cwd: handle.cwd,
            timeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
            outputLimitBytes: options.commandOutputLimitBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES,
            signal: handle.controller.signal,
            captureWorkspaceEffects: false,
          });
          handle.snapshot = {
            ...handle.snapshot,
            state: 'settled',
            stdout: result.stdout.text,
            stderr: result.stderr.text,
            outputTruncated: result.stdout.truncated || result.stderr.truncated,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            cancelled: result.cancelled,
            error: null,
          };
        } catch (error) {
          // A post-acceptance failure is a structured saved error, never fake stderr.
          handle.snapshot = { ...handle.snapshot, state: 'settled', error: commandErrorOf(error) };
        }
      })();
      return { status: 'ready', value: commandSnapshotOf(handle) };
    },

    async readCommand(ctx, request) {
      const bound = bind(ctx);
      if (isRejection(bound)) return bound;
      if (typeof request.commandId !== 'string' || request.commandId.length === 0) {
        return rejected('invalid', 'a command handle id is required');
      }
      const handle = handlesById.get(request.commandId);
      if (handle === undefined) return rejected('not_found', 'no command handle with that id in this Host');
      if (scopeKey(handle.scope) !== scopeKey(bound.config.scope)) {
        return rejected('forbidden', 'the command handle belongs to another workspace');
      }
      return { status: 'ready', value: commandSnapshotOf(handle) };
    },

    async stopCommand(ctx, request) {
      const bound = bind(ctx);
      if (isRejection(bound)) return bound;
      if (typeof request.commandId !== 'string' || request.commandId.length === 0) {
        return rejected('invalid', 'a command handle id is required');
      }
      const handle = handlesById.get(request.commandId);
      if (handle === undefined) return rejected('not_found', 'no command handle with that id in this Host');
      if (scopeKey(handle.scope) !== scopeKey(bound.config.scope)) {
        return rejected('forbidden', 'the command handle belongs to another workspace');
      }
      if (handle.snapshot.state !== 'settled') {
        handle.snapshot = { ...handle.snapshot, state: 'stopping' };
        handle.controller.abort();
      }
      return { status: 'ready', value: commandSnapshotOf(handle) };
    },
  };

  return {
    tools,
    addWorkspace,
    close(): Promise<void> {
      closePromise ??= (async () => {
        closed = true;
        const owned = [...handlesById.values()];
        for (const handle of owned) {
          if (handle.snapshot.state !== 'settled') {
            handle.snapshot = { ...handle.snapshot, state: 'stopping' };
            handle.controller.abort();
          }
        }
        // Every caller awaits the SAME real drain of background execution.
        await Promise.allSettled(owned.map(handle => handle.execution));
        handlesById.clear();
        handlesByRequest.clear();
        for (const runtime of byScope.values()) {
          runtime.sandbox = null;
          runtime.process = null;
        }
      })();
      return closePromise;
    },
  };
}
