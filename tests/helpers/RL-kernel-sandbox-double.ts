/**
 * RE2 Kernel `ProcessSandbox` double (spec §5.1 RE2, §7).
 *
 * Builds: one process-wide mutable double for the Kernel module
 * `vendor/coding-agent/dist/sandbox/process/process-sandbox.js`. A test file
 * calls `vi.mock(...)` with `mockRLKernelSandboxModule` as the factory; every
 * real export survives and only `ProcessSandbox` (and the settable
 * `resourceCapStatus`) is swapped. The double:
 *   - `probe` records its options and answers `available` / `unavailable`;
 *   - the constructor records the instance options (including `resourceCaps`);
 *   - `execute` records the command and reads `resourceCaps.current()` at call
 *     time, then either returns the scripted result or — when `settleOnAbort`
 *     is set — waits for the handler signal to abort (or the test release),
 *     so it never hangs the frozen dispatcher (F23a);
 *   - `resourceCapStatus()` returns the settable cache status.
 * Rows: RL-30 … RL-36.
 */
import type {
  ProcessExecutionResult,
  ResourceCapRequest,
  ResourceCapSource,
} from '../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js';

export type RLSandboxResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: { text: string; totalBytes: number; truncated: boolean };
  stderr: { text: string; totalBytes: number; truncated: boolean };
  effects: { sideEffect: string; changedPaths: string[]; workspaceRevision: string | null; artifactRefs: string[];
    externalChangedPaths?: string[]; externalChangedPathsOmitted?: number };
  sandboxProfileVersion: string;
  timings: { snapshotBeforeMs: number; executionMs: number; snapshotAfterMs: number };
  resourceCaps?: unknown;
};

export type RLResourceCapStatus =
  | { readonly status: 'unknown' }
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: string; readonly detail: string };

export type RLSandboxProbe = { available: boolean; version: string; bwrapPath: string | null; reason: string | null };

export function defaultRLSandboxResult(overrides: Partial<RLSandboxResult> = {}): RLSandboxResult {
  return {
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'rl-stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
    ...overrides,
  };
}

export const rlSandbox = {
  available: true,
  probeReason: 'rl-stub: bubblewrap unavailable',
  /** Every command the double was asked to run. */
  commands: [] as string[],
  /** Every `ProcessSandbox.probe` option object, in call order. */
  probeOptions: [] as Array<Record<string, unknown>>,
  /** Every constructor option object, in call order. */
  constructorOptions: [] as Array<Record<string, unknown> | undefined>,
  /** The `current()` value read at each `execute`, in call order. */
  currentReads: [] as ResourceCapRequest[],
  /** The settable Kernel cache status `resourceCapStatus()` returns. */
  status: { status: 'unknown' } as RLResourceCapStatus,
  /** The next result (or a function of the command). */
  next: (() => defaultRLSandboxResult()) as (command: string) => RLSandboxResult,
  /** When true, `execute` settles only on abort or an explicit release. */
  settleOnAbort: false,
  /** Called at the start of `execute`, after the command was recorded. */
  onExecute: undefined as ((command: string) => void) | undefined,
  /** Pending releases while `settleOnAbort` is set. */
  releases: [] as Array<() => void>,
  /** How many aborted executions the double settled. */
  aborted: 0,
  asResourceCapsSource(): ResourceCapSource | undefined {
    return this.source;
  },
  /** When set, a constructed sandbox hands this same source to `current()`. */
  source: undefined as ResourceCapSource | undefined,
  reset(): void {
    this.available = true;
    this.probeReason = 'rl-stub: bubblewrap unavailable';
    this.commands = [];
    this.probeOptions = [];
    this.constructorOptions = [];
    this.currentReads = [];
    this.status = { status: 'unknown' };
    this.next = () => defaultRLSandboxResult();
    this.settleOnAbort = false;
    this.onExecute = undefined;
    this.releases = [];
    this.aborted = 0;
    this.source = undefined;
  },
};

class RLProcessSandbox {
  private readonly instanceOptions: Record<string, unknown> | undefined;
  constructor(_profile: unknown, _root: string, _workspace: unknown, options?: Record<string, unknown>) {
    this.instanceOptions = options;
    rlSandbox.constructorOptions.push(options);
  }
  get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
    return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
  }
  static async probe(_root: unknown, _workspace: unknown, options?: Record<string, unknown>): Promise<RLSandboxProbe> {
    rlSandbox.probeOptions.push(options ?? {});
    return rlSandbox.available
      ? { available: true, version: 'rl-stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
      : { available: false, version: 'rl-stub-v1', bwrapPath: null, reason: rlSandbox.probeReason };
  }
  async execute(request: {
    command: string; cwd: string; timeoutMs: number; outputLimitBytes: number; signal?: AbortSignal;
  }): Promise<RLSandboxResult & ProcessExecutionResult> {
    rlSandbox.commands.push(request.command);
    const source = (this.instanceOptions?.['resourceCaps'] ?? rlSandbox.source) as ResourceCapSource | undefined;
    if (source !== undefined) rlSandbox.currentReads.push(source.current());
    rlSandbox.onExecute?.(request.command);
    if (!rlSandbox.settleOnAbort) return rlSandbox.next(request.command) as RLSandboxResult & ProcessExecutionResult;
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: RLSandboxResult): void => {
        if (settled) return;
        settled = true;
        if (request.signal !== undefined) request.signal.removeEventListener('abort', onAbort);
        rlSandbox.releases = rlSandbox.releases.filter(entry => entry !== release);
        resolve(result as RLSandboxResult & ProcessExecutionResult);
      };
      const onAbort = (): void => {
        rlSandbox.aborted += 1;
        finish({ ...rlSandbox.next(request.command), cancelled: true, exitCode: null, timedOut: false });
      };
      const release = (): void => { finish(rlSandbox.next(request.command)); };
      if (request.signal?.aborted === true) { onAbort(); return; }
      request.signal?.addEventListener('abort', onAbort, { once: true });
      rlSandbox.releases.push(release);
    });
  }
}

/** The `vi.mock` factory: keep every real export, swap the sandbox class. */
export async function mockRLKernelSandboxModule(
  importOriginal: <T>() => Promise<T>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ProcessSandbox: RLProcessSandbox, resourceCapStatus: () => rlSandbox.status };
}
