/**
 * Slice 1 §2.6: the AgentRuntime reader of the changed files beside an archive
 * anomaly anchor.
 *
 * The platform keeps no execution-start baseline (T1). The reader reuses the
 * continuation brief's own Kernel-turn read (`readPreviousTurn` and the same
 * `selfChanged` extraction) for the confirmed/possible split, and falls back to
 * the current HEAD → worktree capture of `briefWorkspaceFacts` when the Kernel
 * window cannot be read. Every path stays an honest snapshot: the Kernel
 * confirmed paths are `confirmed`, the worktree paths are `possible` with
 * `runBaselineKnown: false`, and a window that cannot be read at all is
 * `unavailable` with a reason, never an empty "no changes".
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { ArchiveChangedFilesV1 } from '../../contracts/session-anomaly.js';
import { CONTINUATION_BRIEF_LIMITS } from '../../contracts/continuation-brief.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import { readPreviousTurn, selfChangedFactsOf, type PreviousTurnFacts, type PreviousTurnRetry }
  from './continuation-brief-assembly.js';
import { createSessionHistoryCursorOwner } from './session-operations.js';
import { briefWorkspaceFacts } from './execution-preparation.js';

/**
 * The trusted reads the reader needs: the Run/Session facts (`executions`), the
 * Kernel stores for the previous-turn window, and the workspace host/source for
 * the current worktree fallback. `now` is the owner-provided clock.
 */
export type ArchiveChangedFilesReaderDependencies = Pick<
  RuntimeExecutionDependencies, 'executions' | 'kernelStores' | 'workspaceHost' | 'now'
> & Partial<Pick<RuntimeExecutionDependencies, 'workspaceSource'>>;

/** The narrow port `RuntimeExecutionPort.readArchiveChangedFiles` publishes. */
export interface ArchiveChangedFilesReader {
  readArchiveChangedFiles(
    ctx: CoreCallContext,
    input: { runRef: RunRef },
  ): Promise<ReadResult<ArchiveChangedFilesV1>>;
}

/** The fixed mixed-ownership warning of a worktree-sourced read (§2.6). */
const MIXED_OWNERSHIP_WARNING = '工作区里还没提交的改动，可能混有别的执行的改动，不一定是这次执行改的';
const REASON_LIMIT = 2000;
const PATHS_LIMIT = CONTINUATION_BRIEF_LIMITS.paths;

function rejected(code: 'invalid' | 'unavailable', reason: string): { status: 'rejected'; code: 'invalid' | 'unavailable'; reason: string } {
  return { status: 'rejected', code, reason };
}

function isRunRef(value: unknown): value is RunRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return ref['aggregateType'] === 'Run'
    && typeof ref['projectId'] === 'string' && ref['projectId'].length > 0
    && typeof ref['goalId'] === 'string' && ref['goalId'].length > 0
    && typeof ref['runId'] === 'string' && ref['runId'].length > 0;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every path is a stable, forward-slash, workspace-relative string. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Dedup and lexicographically sort the normalized paths of one source. */
function distinctSorted(paths: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized.length > 0) unique.add(normalized);
  }
  return [...unique].sort();
}

/**
 * The contract's confirmed-first 64-path cap (§2.6): confirmed paths win, then
 * possible paths that are not already confirmed; the distinct remainder is
 * `omitted`.
 */
function capPaths(confirmedRaw: readonly string[], possibleRaw: readonly string[]): {
  confirmed: string[]; possible: string[]; omitted: number;
} {
  const confirmedAll = distinctSorted(confirmedRaw);
  const confirmedSet = new Set(confirmedAll);
  const possibleAll = distinctSorted(possibleRaw).filter((path) => !confirmedSet.has(path));
  const confirmed = confirmedAll.slice(0, PATHS_LIMIT);
  const possible = possibleAll.slice(0, PATHS_LIMIT - confirmed.length);
  const omitted = confirmedAll.length + possibleAll.length - confirmed.length - possible.length;
  return { confirmed, possible, omitted: Math.max(0, omitted) };
}

function clampReason(reason: string): string {
  return reason.length > REASON_LIMIT ? reason.slice(0, REASON_LIMIT) : reason;
}

function value(input: {
  source: ArchiveChangedFilesV1['source']; status: ArchiveChangedFilesV1['status'];
  confirmed: string[]; possible: string[]; omitted: number; baseCommit: string | null; reason: string | null;
}): ArchiveChangedFilesV1 {
  return { source: input.source, status: input.status, confirmed: input.confirmed, possible: input.possible,
    omitted: input.omitted, baseCommit: input.baseCommit, runBaselineKnown: false,
    reason: input.reason === null ? null : clampReason(input.reason) };
}

/** Slice 1 §2.6: the changed-file snapshot beside one archive anomaly anchor. */
export function createArchiveChangedFilesReader(
  deps: ArchiveChangedFilesReaderDependencies,
): ArchiveChangedFilesReader {
  /**
   * The Kernel window is the only source of confirmed ownership: it is reused
   * verbatim from the brief reader (K7). Only when the Kernel cannot be read
   * does the current HEAD → worktree capture supply paths, all `possible`.
   */
  const kernelFacts = async (ctx: CoreCallContext, record: TaskExecutionRecord):
  Promise<PreviousTurnFacts | PreviousTurnRetry> => {
    try {
      const owner = createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores });
      return await readPreviousTurn(owner, record, ctx.signal);
    } catch (error) {
      return { kernel: 'retry', code: 'unavailable', reason: `the Turn history read failed: ${reasonOf(error)}` };
    }
  };

  const worktreeFacts = async (record: TaskExecutionRecord): Promise<ArchiveChangedFilesV1> => {
    let facts;
    try {
      facts = await briefWorkspaceFacts(deps, record);
    } catch (error) {
      return value({ source: 'unknown', status: 'unavailable', confirmed: [], possible: [], omitted: 0, baseCommit: null,
        reason: `the workspace capture failed: ${reasonOf(error)}` });
    }
    const uncommitted = facts.uncommitted;
    if (uncommitted.status === 'git') {
      const capped = capPaths([], uncommitted.paths);
      // The 64-cap omission plus any the capture already reported.
      return value({ source: 'worktree', status: 'known', confirmed: [], possible: capped.possible,
        omitted: capped.omitted + uncommitted.omitted, baseCommit: uncommitted.baseCommit,
        reason: MIXED_OWNERSHIP_WARNING });
    }
    const detail = uncommitted.status === 'not_git'
      ? 'the workspace is not a git repository, so the HEAD-to-worktree changes cannot be listed'
      : (uncommitted.reason ?? 'the workspace capture is unavailable');
    return value({ source: 'unknown', status: 'unavailable', confirmed: [], possible: [], omitted: 0, baseCommit: null,
      reason: `the changed files are unknown: ${detail}` });
  };

  return {
    async readArchiveChangedFiles(ctx, input): Promise<ReadResult<ArchiveChangedFilesV1>> {
      const raw = input?.runRef;
      if (!isRunRef(raw)) return rejected('invalid', 'readArchiveChangedFiles requires a complete RunRef');
      let runRef: RunRef;
      try { runRef = structuredClone(raw); } catch { return rejected('invalid', 'the RunRef cannot be isolated from the caller'); }
      let read;
      try {
        read = await deps.executions.readExecution(ctx, runRef);
      } catch (error) {
        return rejected('unavailable', `the execution read failed: ${reasonOf(error)}`);
      }
      if (read.status !== 'ready') return read;
      const record = read.value;
      const turn = await kernelFacts(ctx, record);
      if (turn.kernel === 'not_entered') {
        return { status: 'ready', value: value({ source: 'kernel', status: 'not_entered', confirmed: [], possible: [],
          omitted: 0, baseCommit: null, reason: null }) };
      }
      if (turn.kernel === 'read') {
        const facts = selfChangedFactsOf(turn.state);
        const capped = capPaths(facts.confirmed, facts.possible);
        const partial = facts.unobserved > 0 || facts.unknownCount > 0 || turn.window.omittedRecords > 0;
        return { status: 'ready', value: value({ source: 'kernel', status: partial ? 'partial' : 'known',
          confirmed: capped.confirmed, possible: capped.possible, omitted: capped.omitted, baseCommit: null, reason: null }) };
      }
      // The Kernel window cannot be read (unavailable or a transient retry):
      // fall back to the current HEAD → worktree capture, all paths possible.
      return { status: 'ready', value: await worktreeFacts(record) };
    },
  };
}
