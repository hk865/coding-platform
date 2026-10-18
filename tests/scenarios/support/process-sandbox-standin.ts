/**
 * The shared KE6 `KProcessSandbox` stand-in used by the sandbox-execution
 * scenario helpers: read-only probing as before. `executeChecks` is switched
 * on only by the tests that need the registered formal check to run: the check
 * then executes its real command (the fixture passes `process.execPath`) and
 * reports the real exit status, so PASS still comes from the check itself.
 *
 * Each test file keeps its own `vi.hoisted` state object (mock factories are
 * hoisted and cannot read ordinary top-level variables) and passes it here.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export interface ProcessSandboxStandinState {
  available: boolean;
  executeChecks: boolean;
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
        return state.executeChecks
          ? { available: true, version: 'stub-check-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
          : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return state.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(request: { command: string; cwd?: string; timeoutMs?: number; outputLimitBytes?: number }): Promise<unknown> {
      if (!state.executeChecks) {
        throw new actual.ProcessSandboxError('sandbox_unavailable', 'stub: no process execution here');
      }
      const limit = request.outputLimitBytes ?? 32 * 1024;
      const captured = (text: string | null): { text: string; totalBytes: number; truncated: boolean } => {
        const value = text ?? '';
        const totalBytes = Buffer.byteLength(value);
        return { text: value.slice(0, limit), totalBytes, truncated: totalBytes > limit };
      };
      const before = await this.workspace.snapshot();
      const run = spawnSync(request.command, { cwd: join(this.workspaceRoot, request.cwd ?? '.'), shell: true,
        encoding: 'utf8', timeout: request.timeoutMs ?? 30_000, env: process.env, maxBuffer: 4 * 1024 * 1024 });
      const after = await this.workspace.snapshot();
      const changedPaths = this.workspace.diff(before, after);
      const accepted = await this.workspace.acceptAgentChanges(after, changedPaths);
      return { exitCode: run.status, signal: run.signal, timedOut: (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
        cancelled: false, stdout: captured(run.stdout), stderr: captured(run.stderr),
        effects: { workspaceRevision: accepted.revision, changedPaths }, sandboxProfileVersion: this.profile.version };
    }
  };
}
