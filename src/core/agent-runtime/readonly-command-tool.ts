/**
 * K slice part B (L12): the platform `run_readonly_command` extension tool.
 *
 * It never falls back to a host shell: every call builds a fresh read-only
 * `ProcessSandbox` (L14) from the same trusted workspace handle and runs inside
 * bubblewrap. The tool declares `effectClass: 'process'` so the frozen
 * dispatcher checks the real `isolated_process`/`network_isolated` capabilities
 * before the handler ever starts, and it is registered as a Host-authorized
 * extension tool by name instead of claiming `read_only` (a tool that self-
 * reports read-only must never unlock a process).
 *
 * Result status precedence (L16) and the two output caps (32 KiB per stream,
 * 128 KiB total serialized) are implemented here; the frozen dispatcher's
 * cancellation/timeout/sandbox overlays are outside this handler.
 */
import { ProcessSandbox, ProcessSandboxError, normalizeWorkspacePath, toolSchema as z } from '../../../vendor/coding-agent/dist/public-api.js';
import type {
  ResourceCapSource, ResourceCapsReport, ToolDefinition, ToolResult, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

export const READONLY_COMMAND_TOOL_NAME = 'run_readonly_command';

/** Each captured stream keeps the first 32 KiB; the handler caps the total
 * serialized result at the Kernel tool definition's `outputLimitBytes`. */
export const READONLY_OUTPUT_STREAM_LIMIT_BYTES = 32 * 1024;
export const READONLY_OUTPUT_LIMIT_BYTES = 128 * 1024;
export const READONLY_DEFAULT_TIMEOUT_MS = 30_000;
export const READONLY_MIN_TIMEOUT_MS = 1_000;
export const READONLY_MAX_TIMEOUT_MS = 120_000;
/** The frozen dispatcher's own (non-hard) cancel point. */
export const READONLY_DISPATCHER_TIMEOUT_MS = 130_000;
/** L15: at most 100 external changed paths are named; the rest are counted. */
export const READONLY_MAX_EXTERNAL_PATHS = 100;
/**
 * D-CODES (spec §9 M10): the frozen Kernel tool-error enum has no `forbidden`,
 * so the permission refusal keeps the compatible `permission_denied` code and a
 * stable `forbidden:` message prefix.
 */
const FORBIDDEN_MESSAGE = 'forbidden: Host 的读权限已变';
/**
 * D-CODES/D-BOUND (spec §9 M10/M11): the frozen enum has no
 * `workspace_changed_during_readonly_command`; the external-change result keeps
 * the compatible `execution_failed` code, `retryable:false`, this fixed short
 * message (never a path list) and the structured `reason` discriminator.
 */
const WORKSPACE_CHANGED_MESSAGE =
  'workspace_changed_during_readonly_command: the workspace was changed by another writer during the command; the changed paths are in the output';
const WORKSPACE_CHANGED_REASON = 'workspace_changed_during_readonly_command';

const NONE_EFFECTS = {
  sideEffect: 'none' as const,
  changedPaths: [] as string[],
  workspaceRevision: null,
  artifactRefs: [] as string[],
};

const inputSchema = z
  .object({
    command: z.string().min(1).describe('Non-interactive bash command to run in the read-only sandbox'),
    cwd: z.string().optional().describe('Workspace-relative working directory; defaults to the workspace root'),
    timeoutMs: z.number().int().min(READONLY_MIN_TIMEOUT_MS).max(READONLY_MAX_TIMEOUT_MS)
      .describe('Command timeout in milliseconds, 1000-120000; defaults to 30000').optional(),
  })
  .strict();
type ReadonlyCommandArguments = z.infer<typeof inputSchema>;

export type ReadonlyCommandAuthorization = {
  /** The workspace read grant revision this Run was authorized under. */
  permissionRevision: string;
  /** Re-reads the current Host workspace read grant. */
  current(): Promise<
    | { status: 'ready'; permissionRevision: string; wholeWorkspaceRead: boolean }
    | { status: 'rejected'; reason: string }
  >;
};

export type ReadonlyCommandToolInput = {
  workspace: WorkspaceSandbox;
  workspaceRoot: string;
  readOnlyPaths?: readonly string[];
  executablePath?: string;
  /** L13: the Host's live resource-cap source; read once per `execute`. */
  resourceCaps?: ResourceCapSource;
  authorization: ReadonlyCommandAuthorization;
};

/**
 * U5/D-PROBE: the ONE sandbox options object the capability probe and the real
 * read-only command share. Extracted so `reviewCapability` probes with exactly
 * the mount/executable/resource options `run_readonly_command` would run with,
 * instead of an optimistic default. A `resourceCaps` entry is ignored by
 * `ProcessSandbox.probe` (its signature has no such key) exactly as before.
 */
export type ReadonlyCommandSandboxOptions = {
  workspaceMode: 'read_only';
  readOnlyPaths?: string[];
  executablePath?: string;
  resourceCaps?: ResourceCapSource;
};

export function readonlyCommandSandboxOptions(input: {
  readOnlyPaths?: readonly string[];
  executablePath?: string;
  resourceCaps?: ResourceCapSource;
}): ReadonlyCommandSandboxOptions {
  return {
    workspaceMode: 'read_only' as const,
    ...(input.readOnlyPaths === undefined ? {} : { readOnlyPaths: [...input.readOnlyPaths] }),
    ...(input.executablePath === undefined ? {} : { executablePath: input.executablePath }),
    ...(input.resourceCaps === undefined ? {} : { resourceCaps: input.resourceCaps }),
  };
}

type ReadonlyToolErrorCode = Extract<ToolResult, { status: 'error' }>['error']['code'];

/** L10：非 0 退出和自己超时的消息末尾按上限事件加尾注；成功、取消和 M10 固定消息不加。 */
function resourceCapTail(report: ResourceCapsReport | undefined): string {
  if (report === undefined || report.status !== 'applied') return '';
  return `${report.memory === 'cap_hit' ? '（超出内存上限）' : ''}${
    report.processes === 'cap_hit' ? '（有新进程或线程被任务数上限拒绝）' : ''}`;
}

function toolError(callId: string, code: ReadonlyToolErrorCode, message: string, output: ToolResult['output'] = [{ kind: 'text', text: message }]): ToolResult {
  return {
    schemaVersion: 1,
    callId,
    status: 'error',
    error: { code, message, retryable: code === 'timeout' || code === 'execution_failed' },
    output,
    effects: NONE_EFFECTS,
  };
}

/**
 * D-BOUND/L16: the COMPLETE serialized result (D-ID: measured with the provider
 * `callId` excluded) must fit `outputLimitBytes`. Captured output text is
 * trimmed from the tail first (stderr text, then the stdout text part, marking
 * the affected stream truncated), then — only if the result is still too large —
 * the named external paths are reduced to a byte-ordered prefix and the omitted
 * count grows. The only remaining fallback trims a caller-input error message,
 * never the fixed `WORKSPACE_CHANGED_MESSAGE`.
 */
function serializeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * D-ID (spec §9 M11 qualification): the 128 KiB budget measures everything the
 * tool produces EXCEPT the provider-supplied `callId`. The ID is not part of the
 * budget — the lead accepts that an oversized provider ID falls outside it — so
 * the measurement substitutes an empty ID while the returned result keeps the
 * original identity. Without this, a huge provider ID would shrink the tool's
 * own payload (and even a two-character diagnostic) to nothing.
 */
function measuredBytes(result: object): number {
  return serializeBytes({ ...result, callId: '' });
}

type MutableOutputPart = { kind: string; text?: string; value?: unknown };

function boundResult<T extends { output: ToolResult['output'] }>(result: T): T {
  if (measuredBytes(result) <= READONLY_OUTPUT_LIMIT_BYTES) return result;
  const parts = result.output as unknown as MutableOutputPart[];
  const fits = (): boolean => measuredBytes(result) <= READONLY_OUTPUT_LIMIT_BYTES;
  const textPart = parts.find(part => part.kind === 'text');
  const jsonPart = parts.find(part => part.kind === 'json');
  const value = jsonPart !== undefined && typeof jsonPart.value === 'object' && jsonPart.value !== null
    ? jsonPart.value as Record<string, unknown> : undefined;
  const stdout = value !== undefined && typeof value['stdout'] === 'object' && value['stdout'] !== null
    ? value['stdout'] as Record<string, unknown> : undefined;
  const stderr = value !== undefined && typeof value['stderr'] === 'object' && value['stderr'] !== null
    ? value['stderr'] as Record<string, unknown> : undefined;
  const largestPrefix = (original: string, test: (candidate: string) => boolean): string => {
    let low = 0;
    let high = original.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (test(original.slice(0, middle))) low = middle; else high = middle - 1;
    }
    return original.slice(0, low);
  };
  // 1. Captured output first: the JSON stderr text, then the stdout text part.
  if (stderr !== undefined && typeof stderr['text'] === 'string' && stderr['text'].length > 0) {
    const original = stderr['text'];
    stderr['text'] = largestPrefix(original, candidate => {
      stderr['text'] = candidate;
      const ok = fits();
      stderr['text'] = original;
      return ok;
    });
    if (stderr['text'] !== original) stderr['truncated'] = true;
  }
  if (textPart !== undefined && typeof textPart.text === 'string' && textPart.text.length > 0 && !fits()) {
    const original = textPart.text;
    textPart.text = largestPrefix(original, candidate => {
      textPart.text = candidate;
      const ok = fits();
      textPart.text = original;
      return ok;
    });
    if (textPart.text !== original && stdout !== undefined) stdout['truncated'] = true;
  }
  // 2. Then the named paths: keep the first byte-ordered prefix that fits.
  if (!fits() && value !== undefined && Array.isArray(value['externalChangedPaths'])) {
    const named = value['externalChangedPaths'] as unknown[];
    const omitted = typeof value['externalChangedPathsOmitted'] === 'number' ? value['externalChangedPathsOmitted'] : 0;
    const total = named.length + omitted;
    let low = 0;
    let high = named.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      value['externalChangedPaths'] = named.slice(0, middle);
      value['externalChangedPathsOmitted'] = total - middle;
      if (fits()) low = middle; else high = middle - 1;
    }
    value['externalChangedPaths'] = named.slice(0, low);
    value['externalChangedPathsOmitted'] = total - low;
  }
  // 3. Last resort (D-BOUND: "the result always validates"): the error message
  // is part of the complete result and can embed caller input (a hostile `cwd`
  // for example), so it is trimmed rather than letting the frozen dispatcher
  // reject an oversized result. The schema requires a non-empty message. The
  // FIXED external-change message is never shortened (D-BOUND/D-CODES): it is a
  // stable discriminator the model and tests match verbatim, so it is excluded
  // from this fallback.
  const error = (result as unknown as { error?: { message?: string } }).error;
  if (!fits() && error !== undefined && typeof error.message === 'string' && error.message.length > 1
    && error.message !== WORKSPACE_CHANGED_MESSAGE) {
    const original = error.message;
    let low = 1;
    let high = original.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      error.message = original.slice(0, middle);
      if (fits()) low = middle; else high = middle - 1;
    }
    error.message = original.slice(0, low);
  }
  return result;
}

export function createReadonlyCommandTool(input: ReadonlyCommandToolInput): ToolDefinition {
  const handler: ToolDefinition['handler'] = {
    async execute(call, options): Promise<ToolResult> {
      const parsed = inputSchema.safeParse(call.arguments);
      if (!parsed.success) return boundResult(toolError(call.callId, 'invalid_arguments', 'run_readonly_command 参数非法'));
      const args: ReadonlyCommandArguments = parsed.data;
      let cwd: string;
      try {
        cwd = normalizeWorkspacePath(args.cwd ?? '.', true);
      } catch {
        return boundResult(toolError(call.callId, 'invalid_arguments', 'cwd 不是工作区内的相对目录'));
      }
      // L18 layer 3: the handler re-reads the Host grant before launching and
      // refuses when the read permission is no longer current. The spec calls
      // this `forbidden`; the frozen Kernel tool-error enum has no such code, so
      // the closest valid code is `permission_denied`.
      let current;
      try {
        current = await input.authorization.current();
      } catch {
        return boundResult(toolError(call.callId, 'permission_denied', FORBIDDEN_MESSAGE));
      }
      if (current.status !== 'ready' || current.permissionRevision !== input.authorization.permissionRevision
        || !current.wholeWorkspaceRead) {
        return boundResult(toolError(call.callId, 'permission_denied', FORBIDDEN_MESSAGE));
      }

      let result;
      try {
        // L13/L14, D-PROBE: the capability probe and the sandbox the command
        // actually runs in share ONE options object, so `probe` proves the real
        // read-only mount/executable configuration instead of an optimistic
        // default. The same trusted workspace handle carries the denied
        // prefixes; the tool sets no custom protected paths or bwrapPath.
        const sandboxOptions = readonlyCommandSandboxOptions(input);
        const profile = await ProcessSandbox.probe(input.workspaceRoot, input.workspace, sandboxOptions);
        const process = new ProcessSandbox(profile, input.workspaceRoot, input.workspace, sandboxOptions);
        result = await process.execute({
          command: args.command,
          cwd,
          timeoutMs: args.timeoutMs ?? READONLY_DEFAULT_TIMEOUT_MS,
          outputLimitBytes: READONLY_OUTPUT_STREAM_LIMIT_BYTES,
          signal: options.signal,
        });
      } catch (error) {
        if (error instanceof ProcessSandboxError) {
          const code = error.code === 'sandbox_unavailable' ? 'sandbox_unavailable'
            : error.code === 'invalid_arguments' ? 'invalid_arguments' : 'execution_failed';
          // D-BOUND: a launch failure message can embed caller input (the cwd),
          // so it is routed through the same complete-result bound.
          return boundResult(toolError(call.callId, code, error.message));
        }
        return boundResult(toolError(call.callId, 'execution_failed', 'run_readonly_command 执行失败'));
      }

      // S/L15: the read-only sandbox already reports the byte-sorted external
      // change list (first 100) plus its omitted count and never accepts a
      // workspace change. The tool keeps its own 100-cap as a second guard.
      const external = [...(result.effects.externalChangedPaths ?? [])]
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      const named = external.slice(0, READONLY_MAX_EXTERNAL_PATHS);
      const omitted = Math.max(result.effects.externalChangedPathsOmitted ?? 0, external.length - named.length);
      // 旧替身的结果没有这一项；原样抄进 JSON（L10）。
      const resourceCaps = (result as { resourceCaps?: ResourceCapsReport }).resourceCaps;
      const tail = resourceCapTail(resourceCaps);
      const stdout = { totalBytes: result.stdout.totalBytes, truncated: result.stdout.truncated };
      const stderr = { text: result.stderr.text, totalBytes: result.stderr.totalBytes, truncated: result.stderr.truncated };
      const baseValue = {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout,
        stderr,
        timedOut: result.timedOut,
        externalChangedPaths: named,
        externalChangedPathsOmitted: omitted,
        timings: result.timings,
        ...(resourceCaps === undefined ? {} : { resourceCaps }),
      };
      const outputWith = (value: unknown): ToolResult['output'] =>
        [{ kind: 'text', text: result.stdout.text }, { kind: 'json', value: value as never }];
      if (external.length > 0) {
        // D-CODES/L16 item 4: the fixed message never lists the paths; the JSON
        // output item carries the structured reason, the named paths and the
        // omitted count. D-BOUND measures the COMPLETE serialized result.
        const changed: ToolResult = {
          schemaVersion: 1, callId: call.callId, status: 'error',
          error: { code: 'execution_failed', message: WORKSPACE_CHANGED_MESSAGE, retryable: false },
          output: outputWith({ reason: WORKSPACE_CHANGED_REASON, ...baseValue }),
          effects: NONE_EFFECTS,
        };
        return boundResult(changed);
      }
      if (result.cancelled) {
        // D-DESC/L16: a cancellation replaces the captured output with an empty
        // list (a subprocess timeout keeps it), matching the frozen dispatcher's
        // cancellation overlay.
        const cancelled: ToolResult = { schemaVersion: 1, callId: call.callId, status: 'cancelled',
          reason: 'run_readonly_command 已取消', output: [], effects: NONE_EFFECTS };
        return boundResult(cancelled);
      }
      if (result.timedOut) {
        return boundResult(toolError(call.callId, 'timeout', `run_readonly_command 执行超时${tail}`, outputWith({ ...baseValue })));
      }
      if (result.exitCode !== 0) {
        return boundResult(toolError(call.callId, 'execution_failed', `命令退出码 ${String(result.exitCode)}${tail}`, outputWith({ ...baseValue })));
      }
      const succeeded: ToolResult = { schemaVersion: 1, callId: call.callId, status: 'success', output: outputWith({ ...baseValue }), effects: NONE_EFFECTS };
      return boundResult(succeeded);
    },
  };
  return {
    name: READONLY_COMMAND_TOOL_NAME,
    description: 'Run a non-interactive bash command in a network-disabled, read-only bubblewrap sandbox. '
      + 'The workspace is mounted read-only at /workspace; Host-denied paths are hidden (for example .env, credentials and the Host hidden prefixes), and ordinary .git is readable but read-only. '
      + 'Git can read history and diffs, but any operation that writes .git (for example commit) fails with git\'s own error, and a linked worktree (.git is a file) has no usable git. '
      + 'A subprocess timeout keeps the captured output; a cancellation or the dispatcher timeout replaces it with empty output. '
      + 'Only paths under the workspace root are visible; deeper files with a protected basename are still readable, exactly as with the read tool. '
      + 'There is no host-shell fallback: when bubblewrap or the read-only mounts are unavailable the call fails.',
    inputSchema,
    handler,
    effectClass: 'process',
    requiredCapabilities: ['workspace_read', 'isolated_process', 'network_isolated'],
    independentReadOnly: false,
    defaultTimeoutMs: READONLY_DISPATCHER_TIMEOUT_MS,
    outputLimitBytes: READONLY_OUTPUT_LIMIT_BYTES,
    summarize: (argumentsValue: Readonly<Record<string, unknown>>) => ({
      paths: [],
      cwd: typeof argumentsValue['cwd'] === 'string' ? argumentsValue['cwd'] : '.',
      commandPreview: typeof argumentsValue['command'] === 'string' ? argumentsValue['command'].slice(0, 512) : '',
    }),
  };
}

/**
 * U5: the result shape of the handler's layer-3 grant re-read, structurally the
 * `WorkspaceHostBindings.authorize` result. Kept local so this module owns no
 * Host import.
 */
export type ReadonlyCommandCurrentAuthorization =
  | { status: 'ready'; value: { permissionRevision: string; allowsRead(path: string): boolean } }
  | { status: 'rejected'; code: string; reason: string };

/**
 * U5: the trusted inputs the Work driver, the Query driver and the review
 * capability all resolve before a tool is built.
 */
export type ReadonlyCommandRegistrationInput = {
  /** The Run/Query selected `run_readonly_command` in its manifest intersection. */
  requested: boolean;
  /** The resolved Host grant's explicit read-only command switch. */
  access: 'all_except_denied' | undefined;
  /** The already-read Host workspace authorization, when it was ready. */
  authorization: { permissionRevision: string; allowsRead(path: string): boolean } | undefined;
  workspaceRoot: string;
  processSandboxOptions: { readOnlyPaths?: string[]; executablePath?: string };
  resourceCaps?: ResourceCapSource;
  /** Re-reads the current Host read grant at the handler boundary (layer 3). */
  authorizeCurrent: () => Promise<ReadonlyCommandCurrentAuthorization>;
};

/**
 * U5: the ONE construction the Work driver, the Query driver and the review
 * round call. It applies the same L18 layer-1 gate (explicit switch, whole
 * workspace readable) and returns a `(workspace) => ToolDefinition` factory, or
 * `undefined` when any layer is absent — the caller keeps its own authorization
 * choice by supplying `authorizeCurrent` and the revision it read.
 */
export function registerReadonlyCommandTool(
  input: ReadonlyCommandRegistrationInput,
): ((workspace: WorkspaceSandbox) => ToolDefinition) | undefined {
  if (!input.requested || input.access !== 'all_except_denied' || input.authorization === undefined
    || !input.authorization.allowsRead('.')) return undefined;
  const permissionRevision = input.authorization.permissionRevision;
  const root = input.workspaceRoot;
  const readOnlyPaths = input.processSandboxOptions.readOnlyPaths === undefined
    ? undefined : [...input.processSandboxOptions.readOnlyPaths];
  const executablePath = input.processSandboxOptions.executablePath;
  const resourceCaps = input.resourceCaps;
  const authorizeCurrent = input.authorizeCurrent;
  return (workspaceHandle: WorkspaceSandbox): ToolDefinition => createReadonlyCommandTool({
    workspace: workspaceHandle,
    workspaceRoot: root,
    ...(readOnlyPaths === undefined ? {} : { readOnlyPaths }),
    ...(executablePath === undefined ? {} : { executablePath }),
    ...(resourceCaps === undefined ? {} : { resourceCaps }),
    authorization: {
      permissionRevision,
      current: async () => {
        let current;
        try { current = await authorizeCurrent(); }
        catch { return { status: 'rejected' as const, reason: 'the Host read policy could not be verified' }; }
        if (current.status !== 'ready') return { status: 'rejected' as const, reason: current.reason };
        return { status: 'ready' as const, permissionRevision: current.value.permissionRevision,
          wholeWorkspaceRead: current.value.allowsRead('.') };
      },
    },
  });
}
