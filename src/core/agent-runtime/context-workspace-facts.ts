import { messageOf } from '../../contracts/error-message.js';
import {
  CONTINUATION_BRIEF_LIMITS, type ContinuationSourceCheckpointV1,
} from '../../contracts/continuation-brief.js';
import type {
  CapturedPathV1, UnknownCallReviewV1, WorkspaceBaselineV1,
} from '../../contracts/unknown-call-review.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import { isProtectedWorkspacePath } from '../workspace/continuation-diff-reads.js';
import {
  readWorkspaceBaselineFromBundle, readWorkspaceCaptureChanges,
} from '../workspace/workspace-baseline-artifact.js';
import type { BriefWorkspaceFacts, ReviewFileRead } from './continuation-brief-assembly.js';
import type { ContextAssemblerDependencies } from './context-types.js';
import type { ContinuationWorkspaceBytes, RuntimeExecutionDependencies } from './execution-contracts.js';

/**
 * Ruling 4: the workspace facts helper has no business-failure result of its
 * own, so it returns a small discriminated union and never downgrades a
 * dependency's explicit cancellation (or the caller's signal) into
 * `unavailable` facts.
 */
export type BriefWorkspaceFactsOutcome =
  | { status: 'ready'; value: BriefWorkspaceFacts }
  | { status: 'cancelled' };

export async function briefWorkspaceFactsFor(
  deps: Partial<Pick<RuntimeExecutionDependencies, 'workspaceHost' | 'workspaceSource'>>, now: () => string,
  record: TaskExecutionRecord, signal: AbortSignal,
): Promise<BriefWorkspaceFactsOutcome> {
  const at = now();
  const cancelled = (): BriefWorkspaceFactsOutcome => ({ status: 'cancelled' });
  const ready = (facts: BriefWorkspaceFacts): BriefWorkspaceFactsOutcome => ({ status: 'ready', value: facts });
  const unavailable = (reason: string): BriefWorkspaceFactsOutcome => ready({
    briefCheckpoint: { kind: 'brief', at, workspaceRevision: null, sourceDigest: null, unavailableReason: reason },
    uncommitted: { status: 'unavailable', baseCommit: null, paths: [], omitted: 0, reason },
  });
  const source = deps.workspaceSource;
  if (source === undefined || deps.workspaceHost === undefined || record?.run === undefined) {
    return unavailable('the workspace source reader is not configured');
  }
  if (signal.aborted) return cancelled();
  let resolved;
  try {
    resolved = await deps.workspaceHost.resolveRoot({ aggregateType: 'Workspace', projectId: record.run.ref.projectId,
      workspaceId: record.session.workspaceId });
  } catch (error) {
    if (signal.aborted) return cancelled();
    return unavailable(`the workspace root could not be resolved: ${messageOf(error)}`);
  }
  // A dependency that names cancellation ends the read as cancelled even when
  // the caller's own signal is still clear.
  if (resolved.status === 'rejected' && resolved.code === 'cancelled') return cancelled();
  if (signal.aborted) return cancelled();
  if (resolved.status !== 'ready') return unavailable(`the workspace root could not be resolved: ${resolved.reason}`);
  const digest = await source.captureDigest(resolved.value.root);
  // `captureDigest` has no cancelled result of its own: judge it by the signal.
  if (signal.aborted) return cancelled();
  const briefCheckpoint: ContinuationSourceCheckpointV1 = digest.status === 'ready'
    ? { kind: 'brief', at, workspaceRevision: resolved.value.workspaceRevision, sourceDigest: digest.sourceDigest, unavailableReason: null }
    : { kind: 'brief', at, workspaceRevision: resolved.value.workspaceRevision, sourceDigest: null, unavailableReason: digest.reason };
  const captured = await source.capture(resolved.value.root);
  if (signal.aborted) return cancelled();
  let uncommitted: BriefWorkspaceFacts['uncommitted'];
  if (captured.status !== 'ready') {
    uncommitted = { status: 'unavailable', baseCommit: null, paths: [], omitted: 0,
      reason: `the workspace capture is ${captured.status}` };
  } else if (captured.sourceProof.kind === 'git-head-worktree') {
    // K3-04/L5: a Host-denied path is never named anywhere in the brief, so the
    // older whole-workspace reader's changed list is filtered here too.
    const paths = captured.sourceProof.changedFiles.filter((path) => !isProtectedWorkspacePath(path));
    uncommitted = { status: 'git', baseCommit: captured.sourceProof.baseCommit,
      paths: paths.slice(0, CONTINUATION_BRIEF_LIMITS.paths), omitted: Math.max(0, paths.length - CONTINUATION_BRIEF_LIMITS.paths),
      reason: null };
  } else {
    uncommitted = { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null };
  }
  return ready({ briefCheckpoint, uncommitted });
}

/** L6: either side of a file diff is capped at 1 MiB. */
const REVIEW_DIFF_MAX_BYTES = 1024 * 1024;

/** Classify raw read bytes into the assembly's read-only union; a read failure degrades to no diff. */
function classifyReviewBytes(result: ContinuationWorkspaceBytes): ReviewFileRead {
  if (result.status !== 'ready') {
    const reason = result.reason;
    if (reason === 'too_large' || reason === 'not_text' || reason === 'protected') return { status: 'unavailable', reason };
    return { status: 'unavailable', reason: 'read_failed' };
  }
  const bytes = result.bytes;
  if (bytes.byteLength > REVIEW_DIFF_MAX_BYTES) return { status: 'unavailable', reason: 'too_large' };
  for (const byte of bytes) if (byte === 0) return { status: 'unavailable', reason: 'binary' };
  try {
    return { status: 'ready', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { status: 'unavailable', reason: 'not_text' };
  }
}
/** L5: the afterRun's prepared manifest baseline, or null when there is none/unreadable. */
async function readRunStartBaseline(
  bodies: NonNullable<ContextAssemblerDependencies['bodies']>, previous: TaskExecutionRecord,
): Promise<WorkspaceBaselineV1 | null> {
  const bundleRef = previous.run.envelope?.bundleRef;
  if (bundleRef === undefined) return null;
  return (await readWorkspaceBaselineFromBundle(bodies, bundleRef))?.baseline ?? null;
}
/** L6 (item 6a): the FULL changed list from the capture Artifact, or null when it cannot be read. */
export async function readReviewCaptureChanges(
  deps: ContextAssemblerDependencies, review: UnknownCallReviewV1 | null,
): Promise<CapturedPathV1[] | null> {
  const capture = review?.workspace;
  if (capture === undefined || capture.status !== 'captured' || deps.bodies === undefined) return null;
  return readWorkspaceCaptureChanges(deps.bodies, capture.captureRef);
}
/**
 * K3 L6: the run-start baseline and current content for every file-edit path of
 * the afterRun's review. Every read is read-only and degrades; a missing reader
 * or workspace yields an empty map (no diff), never a failure of the brief.
 * Cancellation is not a failure (slice 8 §13.8): the signal, or a `resolveRoot`
 * that names cancellation, answers `cancelled`.
 */
export async function unknownCallReviewFilesFor(
  deps: ContextAssemblerDependencies, record: TaskExecutionRecord, previous: TaskExecutionRecord,
  review: UnknownCallReviewV1 | null, signal: AbortSignal,
): Promise<ReadonlyMap<string, { baseline: ReviewFileRead; current: ReviewFileRead }> | null | 'cancelled'> {
  if (review === null) return null;
  const paths = [...new Set(review.items.flatMap((item) => item.kind === 'file_edit' ? item.summary.paths : []))];
  if (paths.length === 0) return null;
  const source = deps.workspaceSource;
  if (source?.readBaselineBlob === undefined || source.readCurrentFile === undefined
    || deps.workspaceHost === undefined || deps.bodies === undefined) return new Map();
  if (signal.aborted) return 'cancelled';
  let root: string;
  try {
    const resolved = await deps.workspaceHost.resolveRoot({ aggregateType: 'Workspace', projectId: record.run.ref.projectId,
      workspaceId: record.session.workspaceId });
    if (resolved.status === 'rejected' && resolved.code === 'cancelled') return 'cancelled';
    if (signal.aborted) return 'cancelled';
    if (resolved.status !== 'ready') return new Map();
    root = resolved.value.root;
  } catch {
    return signal.aborted ? 'cancelled' : new Map();
  }
  const baseline = await readRunStartBaseline(deps.bodies, previous);
  // The body and file reads have no cancelled result of their own: judge them by the signal.
  if (signal.aborted) return 'cancelled';
  const files = new Map<string, { baseline: ReviewFileRead; current: ReviewFileRead }>();
  for (const path of paths) {
    if (isProtectedWorkspacePath(path)) {
      files.set(path, { baseline: { status: 'unavailable', reason: 'protected' },
        current: { status: 'unavailable', reason: 'protected' } });
      continue;
    }
    const entry = baseline?.dirty.find((candidate) => candidate.path === path);
    // L6 (spec 220): a dirty `present` entry stores only a blob id and a
    // `deleted` entry stores no content, so either is status only: never read
    // `HEAD:<path>` or a baseline blob for a path the baseline already names.
    // A path clean at Run start has no dirty entry: its old side is the start
    // HEAD blob, read by tree ref (`<headCommit>:<path>`) with `git cat-file
    // blob` (line 215).
    const baselineRead: ReviewFileRead = entry !== undefined || baseline === null
      ? { status: 'unavailable', reason: 'baseline_dirty' }
      : classifyReviewBytes(await source.readBaselineBlob(root, `${baseline.headCommit}:${path}`));
    const currentRead = classifyReviewBytes(await source.readCurrentFile(root, path));
    if (signal.aborted) return 'cancelled';
    files.set(path, { baseline: baselineRead, current: currentRead });
  }
  return files;
}
