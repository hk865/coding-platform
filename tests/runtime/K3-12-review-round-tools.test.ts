/**
 * K3 row K3-12 (L13): the read-only command's failure mapping when the
 * command tries to change a file.
 *
 * The test drives the real `run_readonly_command` handler with the Kernel
 * `ProcessSandbox` capability stand-in (same stand-in as K's KB-10): the
 * simulated read-only mount refuses the write with a non-zero exit and the
 * handler maps it to `execution_failed` without reporting any workspace change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadonlyCommandTool } from '../../src/core/agent-runtime/readonly-command-tool.js';

// -------------------------------------------------------------------------- //
// run_readonly_command: a write attempt in the read-only sandbox              //
// -------------------------------------------------------------------------- //

const sandbox = vi.hoisted(() => ({
  available: true as boolean,
  commands: [] as string[],
  next: ((): unknown => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  })) as (command: string) => unknown,
}));

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(_profile: unknown, _root: string, _workspace: unknown, _options?: Record<string, unknown>) {}
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(): Promise<unknown> {
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(request: { command: string }): Promise<unknown> {
      // The stand-in never touches the host: it records the attempt and returns
      // the result the read-only mount would produce.
      sandbox.commands.push(request.command);
      return sandbox.next(request.command);
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

afterEach(() => {
  sandbox.available = true;
  sandbox.commands = [];
  sandbox.next = () => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  });
});

function writeAttemptTool() {
  return createReadonlyCommandTool({
    workspace: {} as never,
    workspaceRoot: '/k3-12/workspace',
    authorization: {
      permissionRevision: 'k3-12-read@1',
      current: async () => ({ status: 'ready', permissionRevision: 'k3-12-read@1', wholeWorkspaceRead: true }),
    },
  });
}

describe('K3-12 read-only command write attempt', () => {
  it('K3-12 maps a file-changing command to execution_failed and reports no workspace change', async () => {
    const command = 'echo written > out.txt';
    // The read-only mount refuses the redirect: shell exit 1 with the
    // "Read-only file system" diagnostic (the KB-10 non-zero-exit mapping).
    sandbox.next = () => ({
      exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: '', totalBytes: 0, truncated: false },
      stderr: { text: 'bash: line 1: out.txt: Read-only file system\n', totalBytes: 48, truncated: false },
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      sandboxProfileVersion: 'stub-v1',
      timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 },
    });
    const tool = writeAttemptTool();
    const result = await tool.handler.execute(
      { schemaVersion: 1, callId: 'k3-12-write-call', name: 'run_readonly_command', arguments: { command } } as never,
      { signal: new AbortController().signal } as never);
    // The write attempt was attempted only inside the read-only sandbox.
    expect(sandbox.commands).toEqual([command]);
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('the write attempt was not rejected');
    expect(result.error.code).toBe('execution_failed');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('命令退出码 1');
    const json = result.output.find(part => part.kind === 'json');
    if (json?.kind !== 'json') throw new Error('no json part');
    expect(json.value).toMatchObject({ stderr: { text: 'bash: line 1: out.txt: Read-only file system\n' } });
    // Nothing was written: no changed path and no side effect is reported.
    expect(result.effects.changedPaths).toEqual([]);
    expect(result.effects.sideEffect).toBe('none');
  });
});
