import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { CandidateWorkspaceReader, candidateWorkspaceIncludesPath } from './candidate-workspace-reader.js';
import { CHANGE_SCOPE_MAX_FILES } from '../../contracts/verification.js';
import type { VerificationRoundSourcePort, VerificationRoundSourceResult } from '../../contracts/verification-context.js';

const execute = promisify(execFile);

/** Real current source and a labelled comparison where Git supplies a base.
 * Commands only read Git metadata; no source code, hooks, external diff or checks run. */
export class VerificationWorkspaceReader implements VerificationRoundSourcePort {
  private readonly source = new CandidateWorkspaceReader();

  private async git(root: string, args: string[]): Promise<string> {
    const result = await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args], {
      timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return result.stdout;
  }

  async capture(root: string): Promise<VerificationRoundSourceResult> {
    try {
      const before = await this.source.snapshot(root);
      let baseCommit: string | null = null;
      let baseline: Map<string, { mode: string; objectId: string }> | null = null;
      // Non-Git (including an enclosing repository) has no registered-root base.
      try {
        const top = (await this.git(root, ['rev-parse', '--show-toplevel'])).trim();
        if (await realpath(top) === await realpath(root)) {
          const head = (await this.git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
          if (/^[a-f0-9]{40,64}$/.test(head)) {
            const entries = (await this.git(root, ['ls-tree', '-r', '-z', '--full-tree', head])).split('\0').filter(Boolean);
            const tree = new Map<string, { mode: string; objectId: string }>();
            for (const entry of entries) {
              const match = /^([0-9]{6}) blob ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(entry);
              // A gitlink/submodule is not a file comparison base. Keep the
              // current snapshot useful, but do not claim a complete diff.
              if (!match) throw Error('Git tree has no complete file comparison.');
              if (candidateWorkspaceIncludesPath(match[3]!)) tree.set(match[3]!, { mode: match[1]!, objectId: match[2]! });
            }
            baseCommit = head; baseline = tree;
          }
        }
      } catch { /* The current workspace snapshot remains useful without Git. */ }
      let changedFiles: string[] = [];
      if (baseCommit !== null && baseline !== null) {
        // Compare raw Git blob identities ourselves. Even `git diff` with
        // --no-ext-diff may run repository clean filters; ls-tree cannot.
        // No rename folding: changed names remain deletion plus addition.
        const current = new Map(before.gitEntries.map(entry => [entry.path, entry]));
        const objectFormat = baseCommit.length === 40 ? 'sha1' : 'sha256';
        changedFiles = [...new Set([...baseline.keys(), ...current.keys()])].filter(path => {
          const previous = baseline!.get(path), actual = current.get(path);
          return !previous || !actual || previous.mode !== actual.mode || previous.objectId !== actual[objectFormat];
        }).sort();
        if (changedFiles.length > CHANGE_SCOPE_MAX_FILES) return { status: 'incomplete', code: 'source_unavailable', missing: [`Observed change scope exceeds ${CHANGE_SCOPE_MAX_FILES} files; no truncated scope is used.`] };
      }
      const after = await this.source.snapshot(root);
      const currentHead = baseCommit === null ? null : (await this.git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
      if (before.digest !== after.digest || baseCommit !== currentHead) return { status: 'rejected', code: 'source_changed', issues: [{ path: 'sourceDigest', message: 'Workspace source or comparison base changed during material capture.' }] };
      const gaps = ['No persisted Run-before-state file manifest is available; this material cannot prove semantic no-change.'];
      if (baseCommit === null) return {
        status: 'ready', sourceDigest: after.digest,
        sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
        changeScope: { diffClass: 'unclassified-current-workspace', changedFiles: [], writeSummary: 'Actual current workspace captured; changed-file scope is unknown, not empty.' },
        gaps,
      };
      return {
        status: 'ready', sourceDigest: after.digest,
        sourceProof: { kind: 'git-head-worktree', baseCommit, changedFiles, comparison: 'current-head-to-worktree', runBaselineKnown: false },
        changeScope: { diffClass: 'git-head-worktree', changedFiles, writeSummary: 'Observed changes against current Git HEAD; not a Run-before-state or semantic no-change proof.' },
        gaps,
      };
    } catch (error) {
      return { status: 'incomplete', code: 'source_unavailable', missing: [error instanceof Error ? error.message : 'Current workspace source could not be read completely.'] };
    }
  }
}
