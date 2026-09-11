import { execFile } from 'node:child_process';

/** Fixed read-only Git operation; no shell, hooks, source code or history loading. */
export async function readSourceIdentity(root: string, workspace: string): Promise<{ workspace: string; commit: string | null }> {
  const commit = await new Promise<string | null>(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-C', root, 'rev-parse', '--verify', 'HEAD'],
      { timeout: 5000, maxBuffer: 4096, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout) => resolve(!error && /^[a-f0-9]{40,64}$/.test(stdout.trim()) ? stdout.trim() : null));
  });
  return { workspace, commit };
}
