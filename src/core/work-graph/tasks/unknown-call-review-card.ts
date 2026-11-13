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
import type {
  UnknownCallDispositionV1, UnknownCallEscalationCauseV1, UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import type { UnknownCallAdviceEscalationKindV1 } from '../../../contracts/unknown-call-advice.js';
import { approvedMethodLinesZh } from '../../../contracts/continuation-brief.js';
import { unknownCallReviewSaferMethodOpen } from '../state/unknown-call-review.js';
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

/**
 * K3 layering, the second layer: the person's card keeps the four technical
 * ids and their labels except `handle_myself`, which reads "pause this Task";
 * `follow_suggestion` comes first when the adviser's suggestion can be taken.
 */
export const UNKNOWN_CALL_REVIEW_SECOND_LAYER_LABELS = {
  handle_myself: '先暂停这项任务',
  follow_suggestion: '照建议（推荐）',
} as const;

/** K3 layering: one fixed plain sentence per escalation cause (the card's first line; K3L-4 reuses it). */
export function unknownCallEscalationPlainLine(cause: UnknownCallEscalationCauseV1): string {
  switch (cause) {
    case 'no_adviser': return '任务中断时有一步操作不知道做完没有，没有参谋可以帮着判断，要你来定怎么继续。';
    case 'adviser_failed': return '任务中断时有一步操作不知道做完没有，参谋没能给出判断，要你来定怎么继续。';
    case 'adviser_escalated': return '任务中断时有一步操作不知道做完没有，参谋认为这件事要你来定。';
    case 'second_consecutive': return '这项任务在同一步连续第二次中断，要你来定怎么继续。';
    case 'advised_failed_again': return '照参谋定的处理接着做以后，这项任务又中断了，要你来定怎么继续。';
  }
}

/**
 * The review record's own name: the card summary and the notice object label
 * share it, so the person sees one word for the record in both places.
 */
export function unknownCallReviewRecordName(record: UnknownCallReviewV1): string {
  return `核对记录 ${record.runRef.runId.slice(0, 8)}`;
}

/**
 * K3 layering (121-109): the plain line the person reads in 请知悉 when the adviser decided the record; null
 * otherwise. The words are the card's own option labels; the adviser's `plain` follows when the last applied
 * adviser answer carries one (an approval phase the person answered has none).
 */
export function unknownCallReviewAdvisedLine(record: UnknownCallReviewV1): string | null {
  const disposition = record.disposition;
  if (disposition === null || disposition.source !== 'adviser') return null;
  const head = `中断时有 ${String(disposition.targets.length)} 步操作不知道做完没有，`
    + `参谋定为“${UNKNOWN_CALL_REVIEW_OPTION_LABELS[disposition.choice]}”`;
  const plain = record.advice?.answer?.plain;
  return plain === undefined ? head : `${head}：${plain}`;
}

const ESCALATION_KIND_WORDS: Readonly<Record<UnknownCallAdviceEscalationKindV1, string>> = {
  requirement: '需求', product_tradeoff: '产品取舍', architecture: '架构选择',
};

/**
 * K3 layering: the technical choice "follow the suggestion" stands for, or
 * null. Only on a disposition card, only before any person disposition, and
 * only when that choice is itself on the card (`applyDisposition` maps the
 * option through this same function).
 */
export function unknownCallReviewSuggestedChoice(
  record: UnknownCallReviewV1,
): Exclude<UnknownCallDispositionV1['choice'], 'handle_myself'> | null {
  const suggestion = record.escalation?.suggestion ?? null;
  if (record.status !== 'needs_decision' || suggestion === null || suggestion.phase !== 'disposition') return null;
  if (record.disposition !== null && record.disposition.source !== 'adviser') return null;
  switch (suggestion.choice) {
    case 'rerun_as_is':
    case 'skip_as_done':
      return suggestion.choice;
    case 'safer_method':
      return unknownCallReviewSaferMethodOpen(record) ? 'safer_method' : null;
    default:
      return null;
  }
}

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
  /** The review record's own creation time. */
  openedAt: string;
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
  const options: DecisionOptionV1[] = [];
  if (unknownCallReviewSuggestedChoice(record) !== null) {
    options.push({ id: 'follow_suggestion', label: UNKNOWN_CALL_REVIEW_SECOND_LAYER_LABELS.follow_suggestion, effect: 'apply' });
  }
  options.push({ id: 'rerun_as_is', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.rerun_as_is, effect: 'apply' });
  if (unknownCallReviewSaferMethodOpen(record)) {
    options.push({ id: 'safer_method', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.safer_method, effect: 'apply' });
  }
  options.push({ id: 'skip_as_done', label: UNKNOWN_CALL_REVIEW_OPTION_LABELS.skip_as_done, effect: 'apply' },
    { id: 'handle_myself', label: record.escalation === undefined ? UNKNOWN_CALL_REVIEW_OPTION_LABELS.handle_myself
      : UNKNOWN_CALL_REVIEW_SECOND_LAYER_LABELS.handle_myself, effect: 'apply' });
  return options;
}

/** L18: does the card mix a proposable command with an entry the check could not settle? */
export function unknownCallReviewIsMixed(record: UnknownCallReviewV1): boolean {
  if ((record.proposalTargets ?? []).length === 0) return false;
  const targets = new Set(record.dispositionTargets ?? []);
  return record.items.some(item => item.kind === 'platform'
    && item.observed.verdict === 'undetermined' && targets.has(item.callId));
}

/** K3 layering: the adviser's suggestion line, or null when the record carries none. */
function suggestionLine(record: UnknownCallReviewV1): string | null {
  const suggestion = record.escalation?.suggestion ?? null;
  if (suggestion === null) return null;
  return suggestion.escalationKind === null ? `参谋的建议：${suggestion.plain}`
    : `参谋说（${ESCALATION_KIND_WORDS[suggestion.escalationKind]}）：${suggestion.plain}`;
}

export function unknownCallReviewSummary(record: UnknownCallReviewV1): string {
  const base = `${unknownCallReviewRecordName(record)}：需要你决定`;
  const suggestion = suggestionLine(record);
  if (record.status === 'awaiting_approval') {
    const lines = suggestion === null ? [base] : [base, suggestion];
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
  // The second layer opens with the cause's plain sentence, then the adviser's suggestion.
  const lines = record.escalation === undefined ? [base]
    : [unknownCallEscalationPlainLine(record.escalation.cause), ...(suggestion === null ? [] : [suggestion])];
  if (unknownCallReviewIsMixed(record)) lines.push(UNKNOWN_CALL_REVIEW_MIXED_LINE);
  return lines.join('\n');
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
    objects, options: unknownCallReviewOptions(record), summary, openedAt: record.createdAt, closedReason,
  };
}
