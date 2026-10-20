/**
 * The shared KE6 `KProcessSandbox` stand-in used by the sandbox-execution
 * scenario helpers (rule sheet v2, A7 entry 3): it answers only whether the
 * read-only sandbox is available. It never runs a check or a command: a probe
 * for any other workspace mode reports the sandbox unavailable, and `execute`
 * refuses with `sandbox_unavailable`.
 *
 * A test that runs its formal check uses the real operating-system sandbox
 * instead (R-10): `createProcessSandboxSwitch` below hands over the real
 * `ProcessSandbox` unchanged while its state says `real`, and is this stand-in
 * otherwise.
 *
 * Each test file keeps its own `vi.hoisted` state object (mock factories are
 * hoisted and cannot read ordinary top-level variables) and passes it here.
 */
export interface ProcessSandboxStandinState {
  available: boolean;
}

type ProcessSandboxModule = typeof import('../../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js');

export function createProcessSandboxStandin(actual: ProcessSandboxModule, state: ProcessSandboxStandinState) {
  return class KProcessSandbox {
    readonly profile: { version: string };
    readonly workspaceRoot: string;
    readonly workspace: {
      snapshot(): Promise<unknown>;
      diff(before: unknown, after: unknown): string[];
      acceptAgentChanges(snapshot: unknown, changedPaths: string[]): Promise<{ revision: string }>;
    };
    constructor(profile: { version: string }, workspaceRoot: string, workspace: KProcessSandbox['workspace']) {
      this.profile = profile;
      this.workspaceRoot = workspaceRoot;
      this.workspace = workspace;
    }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return state.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(_request: { command: string; cwd?: string; timeoutMs?: number; outputLimitBytes?: number }): Promise<unknown> {
      throw new actual.ProcessSandboxError('sandbox_unavailable', 'stub: no process execution here');
    }
  };
}

/** The state of a test file whose formal-check tests need the real sandbox. */
export interface ProcessSandboxSwitchState extends ProcessSandboxStandinState {
  /** While true, `probe` and `new` are the real `ProcessSandbox` (bwrap). */
  real: boolean;
}

/**
 * R-10: one test file whose formal-check tests run on the real
 * operating-system sandbox while its other tests keep the probe-only stand-in.
 * While `state.real` is true, `probe` and the constructor are the real
 * `ProcessSandbox`, with their arguments and results unchanged; otherwise they
 * are the stand-in above.
 */
export function createProcessSandboxSwitch(actual: ProcessSandboxModule, state: ProcessSandboxSwitchState) {
  const Real = actual.ProcessSandbox;
  const Standin = createProcessSandboxStandin(actual, state);
  type StandinWorkspace = ConstructorParameters<typeof Standin>[2];
  return class ProcessSandboxSwitch {
    static probe(...args: Parameters<typeof Real.probe>): Promise<unknown> {
      return state.real ? Real.probe(...args) : Standin.probe(...args);
    }
    constructor(...args: ConstructorParameters<typeof Real>) {
      // A constructor that returns an object makes `new` yield that object.
      return state.real ? new Real(...args)
        : new Standin(args[0], args[1], args[2] as unknown as StandinWorkspace);
    }
  };
}
