/**
 * K3 L18: the ONE pure projection of an `UnknownCallReview` record onto its
 * decision card (`source`, pins, objects, options, summary and closed reason).
 *
 * Both the read model's card source (`views/decision-read-model.ts`) and the
 * answerability facts (`communication/decision-source-facts.ts`) call this
 * function; neither keeps a second copy. It reads nothing, writes nothing and
 * makes no decision the record does not already carry: `dispositionTargets`,
 * `proposalTargets` and `rounds` were fixed when the card appeared (D7). The
 * one impure input, the current per-path digests, is read by the caller and
 * passed in, so the projection stays pure (L18).
 */
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceV1,
} from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import { approvedMethodLinesZh } from '../../../contracts/continuation-brief.js';
import { goalDecisionBasis } from './goal-basis.js';

/** D7/L18: the fixed labels (spec line 66, the user's own words). */
export const UNKNOWN_CALL_REVIEW_OPTION_LABELS = {
  rerun_as_is: '照原样重跑',
  safer_method: '换个稳妥的跑法再跑',
  skip_as_done: '跳过，当作已做',
  handle_myself: '我来处理',
} as const;

/**
 * L20/lead answer 1: the approval card's own fixed headings. It stays a
 * SEPARATE map: `UNKNOWN_CALL_REVIEW_OPTION_LABELS` is exactly the four
 * disposition labels (K3-18 asserts that set).
 */
export const UNKNOWN_CALL_APPROVAL_OPTION_LABELS = {
  approve: '同意',
  decline: '不同意',
} as const;

/** L18/D7: the mixed card's fixed line. */
export const UNKNOWN_CALL_REVIEW_MIXED_LINE =
  '选“换个稳妥的跑法再跑”并同意方案以后，查不清的平台条目在接续说明里写“结果查不清，重做前先核实”。';

export type UnknownCallReviewCardFactsV1 = {
  /** The record's canonical natural identity at this revision. */
  source: DecisionSourceV1;
  goalRef: GoalRef;
  reviewRef: UnknownCallReviewV1['ref'];
  revision: number;
  runRef: UnknownCallReviewV1['runRef'];
  runRevision: number;
  /** The record's Task is still `active` in the Goal's current plan window. */
  taskActive: boolean;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  /** The card's one visible summary (the record object's label). */
  summary: string;
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
};

export type UnknownCallReviewCardInputV1 = {
  record: UnknownCallReviewV1;
  goal: GoalSnapshot;
  /** The ORIGINAL Run snapshot pinned by `record.runRef` (the card's run pin). */
  run: RunSnapshot;
  taskActive: boolean;
  /**
   * L18: the CURRENT working-tree digest of each target path, read by the
   * caller (`readReviewTargetDigests`). The projection itself stays pure; a path
   * missing from the map, or mapped to `null`, is not readable and gets `null`.
   */
  fileDigests: ReadonlyMap<string, string | null>;
};

/**
 * Slice 5's `objects <= 32` includes the record object, so at most 31 target
 * paths become file objects: the first 31 distinct paths in item order.
 */
export const UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX = 31;

/**
 * L18: one file object per unknown edit target path. The paths come from the
 * record's `file_edit` items (`summary.paths`), deduplicated in item order; the
 * workspace change sample is never used as a source of card objects.
 */
export function unknownCallReviewTargetPaths(record: UnknownCallReviewV1): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const item of record.items) {
    if (item.kind !== 'file_edit') continue;
    for (const path of item.summary.paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

/** L18: at most four options, in the fixed order; `safer_method` only with a proposable target and two free slots. */
export function unknownCallReviewOptions(record: UnknownCallReviewV1): DecisionOptionV1[] {
  if (record.status === 'awaiting_approval') {
    return [
      { id: 'approve', label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.approve, effect: 'apply' },
      { id: 'decline', label: UNKNOWN_CALL_APPROVAL_OPTION_LABELS.decline, effect: 'apply' },
    ];
  }
  if (record.status !== 'needs_decision') return [];
  const options: DecisionOptionV1[] = [{ id: 'rerun_as_is', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.rerun_as_is, effect: 'apply' }];
  const proposalTargets = record.proposalTargets ?? [];
  const freeSlots = 8 - record.rounds.length;
  if (proposalTargets.length > 0 && freeSlots >= 2) {
    options.push({ id: 'safer_method', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.safer_method, effect: 'apply' });
  }
  options.push({ id: 'skip_as_done', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.skip_as_done, effect: 'apply' },
    { id: 'handle_myself', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.handle_myself, effect: 'apply' });
  return options;
}

/** L18: does the card mix a proposable command with an entry the check could not settle? */
export function unknownCallReviewIsMixed(record: UnknownCallReviewV1): boolean {
  if ((record.proposalTargets ?? []).length === 0) return false;
  const targets = new Set(record.dispositionTargets ?? []);
  return record.items.some(item => item.kind === 'platform'
    && item.observed.verdict === 'undetermined' && targets.has(item.callId));
}

export function unknownCallReviewSummary(record: UnknownCallReviewV1): string {
  const base = `核对记录 ${record.runRef.runId.slice(0, 8)}：需要你决定`;
  if (record.status === 'awaiting_approval') {
    const lines = [base];
    // Lead answer 2: each proposable item's ORIGINAL command in alias order,
    // its newlines written as `\n` plus two spaces exactly like the approved
    // methods; then the one pure approved-method block the continuation will
    // render; then the mixed-card sentence.
    for (const callId of record.proposalTargets ?? []) {
      const item = record.items.find(candidate => candidate.callId === callId);
      if (item === undefined) continue;
      const command = (item.summary.command ?? '').replace(/\r\n|\n/g, '\n  ');
      lines.push(`- 原命令 #${String(item.alias)}：${command}`);
    }
    lines.push(approvedMethodLinesZh(
      [...record.proposals].sort((left, right) => left.alias - right.alias)).join('\n'));
    if (unknownCallReviewIsMixed(record)) lines.push(UNKNOWN_CALL_REVIEW_MIXED_LINE);
    return lines.join('\n');
  }
  return unknownCallReviewIsMixed(record) ? `${base}\n${UNKNOWN_CALL_REVIEW_MIXED_LINE}` : base;
}

function workspaceOf(record: UnknownCallReviewV1): { projectId: string; workspaceId: string } {
  return { projectId: record.ref.projectId, workspaceId: record.workspaceId };
}

export function unknownCallReviewCardFacts(input: UnknownCallReviewCardInputV1): UnknownCallReviewCardFactsV1 {
  const { record, goal, run, taskActive } = input;
  const source: DecisionSourceV1 = {
    kind: 'unknown_call_review',
    key: decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision }),
    subject: { kind: 'goal', goalRef: { ...goal.ref } },
    pins: [
      { ref: structuredClone(record.ref), revision: record.revision },
      { ref: structuredClone(record.runRef), revision: run.revision },
      { ref: structuredClone(goal.ref), revision: goal.revision },
    ],
    goalBases: [goalDecisionBasis(goal)],
  };
  const summary = unknownCallReviewSummary(record);
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: { ref: structuredClone(record.ref), revision: record.revision }, label: summary },
  ];
  const workspace = workspaceOf(record);
  for (const path of unknownCallReviewTargetPaths(record).slice(0, UNKNOWN_CALL_REVIEW_FILE_OBJECTS_MAX)) {
    objects.push({ kind: 'file', workspace: { ...workspace }, path,
      digest: input.fileDigests.get(path) ?? null, label: path });
  }
  const closedReason: UnknownCallReviewCardFactsV1['closedReason'] =
    goal.desiredState === 'cancelled' ? 'goal_cancelled'
      : record.status === 'resolved' || record.open === 'no'
        || record.disposition?.hold === 'held' || !taskActive ? 'source_resolved'
        : null;
  return {
    source, goalRef: { ...goal.ref }, reviewRef: record.ref, revision: record.revision,
    runRef: record.runRef, runRevision: run.revision, taskActive,
    objects, options: unknownCallReviewOptions(record), summary, closedReason,
  };
}
