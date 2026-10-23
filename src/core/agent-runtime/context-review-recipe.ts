import type { CoreCallContext } from '../../contracts/core/call-context.js';
import {
  renderUnknownCallReviewZh,
  type PreparedTaskManifestV1, type UnknownCallReviewInputV1,
} from '../../contracts/core/prepared-execution.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { UnknownCallReviewRef, UnknownCallReviewV1 } from '../../contracts/unknown-call-review.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import { readKernelCommandFacts, reviewSessionBasis } from './context-history-facts.js';
import { buildUnknownCallReviewInputV1, type ReviewCommandFactV1 } from './context-review-input.js';
import { isRecord, mapRead, messageOf, rejected } from './context-support.js';
import type { ContextAssemblerDependencies } from './context-types.js';
import { readReviewCaptureChanges } from './context-workspace-facts.js';

/**
 * K3 L13: the full command/cwd of each `process` item from the ORIGINAL Run's
 * Kernel facts (the record only keeps a 512-char summary). Best-effort for an
 * unreadable Kernel (the alias stays absent and the builder falls back to the
 * record's own summary), but F-076/F-101: a cancellation is not "unreadable" —
 * it keeps its `cancelled` rejection so prepare ends cancelled.
 */
async function reviewCommandFacts(
  deps: ContextAssemblerDependencies, review: UnknownCallReviewV1, original: TaskExecutionRecord, signal: AbortSignal,
): Promise<{ status: 'ready'; value: ReadonlyMap<number, ReviewCommandFactV1> } | CoreRejection> {
  const facts = new Map<number, ReviewCommandFactV1>();
  const processItems = review.items.filter(item => item.kind === 'process');
  const first = processItems[0];
  if (first === undefined
    || original.session.kernel.kernelSessionId !== first.kernel.kernelSessionId) {
    return { status: 'ready', value: facts };
  }
  const read = await readKernelCommandFacts(
    { ...(deps.kernelStores === undefined ? {} : { kernelStores: deps.kernelStores }),
      ...(deps.kernel === undefined ? {} : { kernel: deps.kernel }) },
    { signal },
    { session: original.session, calls: processItems.map(item => item.kernel) },
  );
  if (read.status !== 'ready') {
    return read.status === 'rejected' && read.code === 'cancelled'
      ? read : { status: 'ready', value: facts };
  }
  for (const item of processItems) {
    const fact = read.value.get(item.kernel.callId);
    if (fact === undefined) continue;
    facts.set(item.alias, {
      command: fact.command ?? item.summary.command,
      cwd: fact.cwd ?? item.summary.cwd,
    });
  }
  return { status: 'ready', value: facts };
}

/**
 * K3 L13: read the review record the round's `purpose.reviewRef` names, read the
 * original Run for its Kernel command facts and its history source, and build the
 * structured instruction and its rendered text. The record read is fail-closed
 * exactly like every other must-read in `prepare`.
 */
export async function assembleReviewForContext(
  deps: ContextAssemblerDependencies, ctx: CoreCallContext, record: TaskExecutionRecord,
  purpose: { reviewRef: UnknownCallReviewRef; phase: 'review' | 'proposal'; round: number },
  texts: PromptTextsV1,
  toolNames: readonly string[],
): Promise<{ ok: true; review: UnknownCallReviewInputV1; text: string; sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined }
  | { ok: false; rejection: CoreRejection }> {
  const owner = deps.unknownCallReviews;
  if (owner === undefined) {
    return { ok: false, rejection: rejected('unavailable', 'the UnknownCallReview owner is not wired for a review round') };
  }
  let read;
  try { read = await owner.readReview(ctx, { ref: purpose.reviewRef }); }
  catch (error) { return { ok: false, rejection: rejected('unavailable', `the review record read failed: ${messageOf(error)}`) }; }
  if (read.status !== 'ready') return { ok: false, rejection: mapRead(read) };
  const review = read.value;
  // A `ready` record is a complete `UnknownCallReviewV1` by contract; a narrow
  // double that returns less fails closed instead of fabricating an instruction.
  if (!isRecord(review.ref) || !isRecord(review.workspace) || !Array.isArray(review.items)) {
    return { ok: false, rejection: rejected('invalid', 'the stored review record is not a complete review') };
  }
  const originalRef: RunRef = { aggregateType: 'Run', projectId: review.ref.projectId,
    goalId: review.ref.goalId, runId: review.ref.runId };
  let original;
  try { original = await deps.executions.readExecution(ctx, originalRef); }
  catch (error) { return { ok: false, rejection: rejected('unavailable', `the original Run read failed: ${messageOf(error)}`) }; }
  if (original.status !== 'ready') return { ok: false, rejection: mapRead(original) };
  const sessionBasis = await reviewSessionBasis(deps, record, original.value, ctx.signal);
  if (sessionBasis === 'cancelled') {
    return { ok: false, rejection: rejected('cancelled', 'the preparation was cancelled during the review session basis read') };
  }
  const commandFacts = await reviewCommandFacts(deps, review, original.value, ctx.signal);
  // F-076/F-101: a cancelled Kernel command read is carried to prepare, which
  // then ends `cancelled`; every other unreadable Kernel keeps the fallback.
  if (commandFacts.status !== 'ready') return { ok: false, rejection: commandFacts };
  // F/L6: read the full capture Artifact; null (unreadable) falls back to the sample.
  const fullChanges = await readReviewCaptureChanges(deps, review);
  // L20/lead answer 3: only the proposal phase carries the person's text and
  // annotations; `targets` and the mixed card's platform aliases stay null/empty
  // in the review phase, whose instruction is unchanged.
  const proposal = purpose.phase === 'proposal';
  const aliasOf = (callIds: readonly string[] | null): number[] => {
    const wanted = new Set(callIds ?? []);
    return review.items.filter(item => wanted.has(item.callId))
      .map(item => item.alias).sort((left, right) => left - right);
  };
  const targets = proposal ? aliasOf(review.proposalTargets) : null;
  const personText = proposal ? review.disposition?.text ?? null : null;
  const annotations = proposal ? review.disposition?.annotations ?? [] : [];
  const platformTargets = proposal
    ? aliasOf(review.items
      .filter(item => item.kind === 'platform' && item.observed.verdict === 'undetermined'
        && (review.dispositionTargets ?? []).includes(item.callId)
        && !(review.proposalTargets ?? []).includes(item.callId))
      .map(item => item.callId))
    : [];
  const structured = buildUnknownCallReviewInputV1({ review, reviewRef: purpose.reviewRef,
    phase: purpose.phase, round: purpose.round, commandFacts: commandFacts.value, fullChanges,
    targets, personText, annotations, platformTargets });
  return { ok: true, review: structured, text: renderUnknownCallReviewZh(structured, texts, toolNames), sessionBasis };
}
