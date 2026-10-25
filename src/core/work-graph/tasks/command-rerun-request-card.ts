/**
 * K3 L19a: the ONE pure projection of a `CommandRerunRequest` record onto its
 * decision card (`source`, pins, objects, options and summary).
 *
 * Both the read model's card source (`views/decision-read-model.ts`) and the
 * answerability facts (`communication/decision-source-facts.ts`) call this
 * function; neither keeps a second copy. It reads nothing and writes nothing:
 * the blocked command's full text, the original Run and the sibling requests
 * are read by the caller and passed in. The card shows the request record's
 * stored `match`; it never re-expands a script and never re-reads
 * `package.json` (K8-7, B2-15).
 */
import type {
  DecisionObjectV1, DecisionOptionV1, DecisionSourceV1,
} from '../../../contracts/goal-decisions.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot, AggregateRef } from '../../../contracts/ledger.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { ExecutionReadPort } from '../model/execution-read-contracts.js';
import type { CommandRerunRequestReadPort } from '../model/command-rerun-request-contracts.js';
import type { KernelCommandReader } from '../model/kernel-command-read-contracts.js';
import type { UnknownCallReviewReadPort } from '../model/unknown-call-review-contracts.js';
import type { S5RecordPort } from '../model/decision-contracts.js';
import { goalDecisionBasis } from './goal-basis.js';
import { nestedSourceObject, parseDecisionSourceKey } from './decision-source-identity.js';

/** L19a: the three fixed labels, in the fixed order. */
export const COMMAND_RERUN_REQUEST_OPTION_LABELS = {
  allow_rerun: '允许重跑',
  deny: '不允许',
  deny_final: '不允许，也别再问',
} as const;

/** L19a: the card's (and continuation's) fixed sentence. */
export const COMMAND_RERUN_REQUEST_FIXED_SENTENCE =
  '平台按文字和静态解析认出改写；没认出的，agent 要注明以后才请求。允许只放行这一种写法。';

/** L19a: a `declared` match writes this wording instead of a matched action. */
export const COMMAND_RERUN_REQUEST_DECLARED_MATCH_TEXT = 'agent 注明是改写';

/** How many earlier requests/answers one card shows. */
export const COMMAND_RERUN_REQUEST_EARLIER_MAX = 5;

/** The request's own aggregate pin (`CommandRerunRequestRef` is in `AggregateRef`). */
function requestPin(request: CommandRerunRequestV1): { ref: AggregateRef; revision: number } {
  return { ref: structuredClone(request.ref), revision: request.revision };
}

export type CommandRerunRequestCardFactsV1 = {
  /** The request's canonical natural identity at this revision. */
  source: DecisionSourceV1;
  goalRef: GoalRef;
  requestRef: CommandRerunRequestV1['ref'];
  revision: number;
  /** The request's Task is not closed by the ONE canonical Task closure (ruling 4). */
  taskActive: boolean;
  objects: DecisionObjectV1[];
  options: DecisionOptionV1[];
  summary: string;
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
};

export type CommandRerunRequestCardInputV1 = {
  request: CommandRerunRequestV1;
  /** The request's own review record (the record that blocked the alias). */
  review: UnknownCallReviewV1;
  /** The Goal window's Goal (the card's Goal pin and basis). */
  goal: GoalSnapshot;
  /**
   * The blocked command's FULL text, read from the Kernel by the caller. A
   * missing/unreadable read is a rejection at the caller; the projection never
   * falls back to the request's own command or the 512-character summary.
   */
  blockedCommandText: string;
  /**
   * Every request of this alias in this review record, including `request`
   * itself, in any order. The card keeps the ones before `request`, newest
   * first, at most `COMMAND_RERUN_REQUEST_EARLIER_MAX`.
   */
  aliasRequests: readonly CommandRerunRequestV1[];
  taskActive: boolean;
};

function workspaceOf(request: CommandRerunRequestV1): { projectId: string; workspaceId: string } {
  return { projectId: request.ref.projectId, workspaceId: request.workspaceId };
}

/** L19a: the three options, always in this order; `effect` is `apply` for all. */
export function commandRerunRequestOptions(): DecisionOptionV1[] {
  return [
    { id: 'allow_rerun', label: COMMAND_RERUN_REQUEST_OPTION_LABELS.allow_rerun, effect: 'apply' },
    { id: 'deny', label: COMMAND_RERUN_REQUEST_OPTION_LABELS.deny, effect: 'apply' },
    { id: 'deny_final', label: COMMAND_RERUN_REQUEST_OPTION_LABELS.deny_final, effect: 'apply' },
  ];
}

/** L19a: the alias's declared forms in this review record, in declaration order, no repeats. */
export function commandRerunRequestDeclaredForms(
  aliasRequests: readonly CommandRerunRequestV1[],
): string[] {
  const seen = new Set<string>();
  const forms: string[] = [];
  for (const request of [...aliasRequests].sort(compareRequestOrder)) {
    for (const form of request.declaredForms) {
      if (seen.has(form.sha256)) continue;
      seen.add(form.sha256);
      forms.push(form.text);
    }
  }
  return forms;
}

/** The stored state as the card's answer word (a repeated answer is visible as stored). */
function answerWordOf(request: CommandRerunRequestV1): string {
  switch (request.state) {
    case 'allowed': return COMMAND_RERUN_REQUEST_OPTION_LABELS.allow_rerun;
    case 'denied': return COMMAND_RERUN_REQUEST_OPTION_LABELS.deny;
    case 'denied_final': return COMMAND_RERUN_REQUEST_OPTION_LABELS.deny_final;
    case 'used': return '已用';
    case 'closed': return '已关闭';
    case 'pending': return '等答复';
  }
}

/** Creation time first, then requestId: the stored order of one alias's requests. */
function compareRequestOrder(left: CommandRerunRequestV1, right: CommandRerunRequestV1): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  return left.ref.requestId < right.ref.requestId ? -1 : left.ref.requestId > right.ref.requestId ? 1 : 0;
}

/** The stored natural ref key; every field of one alias's refs but the id is equal. */
function requestRefKey(request: CommandRerunRequestV1): string {
  return [request.ref.projectId, request.ref.goalId, request.ref.taskId, request.ref.requestId].join('\u0000');
}

/**
 * L19a "earlier requests ... newest first": newest `createdAt` first. The spec
 * is silent on equal timestamps, so the deterministic tie rule is the stored
 * ref key descending (UNSPECIFIED). F-098: the continuation brief imports this
 * ONE comparator for its `requestState`, never a second copy.
 */
export function compareCommandRerunRequestNewestFirst(
  left: CommandRerunRequestV1, right: CommandRerunRequestV1,
): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
  const leftKey = requestRefKey(left);
  const rightKey = requestRefKey(right);
  return leftKey < rightKey ? 1 : leftKey > rightKey ? -1 : 0;
}

/** L19a: exactly the card text, joined by `\n`, in the spec's order. */
export function commandRerunRequestSummary(input: CommandRerunRequestCardInputV1): string {
  const { request, review, blockedCommandText, aliasRequests } = input;
  const lines: string[] = [
    `#${String(request.alias)}@${request.reviewRef.runId.slice(0, 8)}`,
    `原命令：${blockedCommandText}`,
    `这次请求：${request.command}`,
  ];
  const action = request.match.action;
  if (request.match.kind === 'exact' || request.match.kind === 'action') {
    lines.push(`命中：${action === undefined ? request.command : action.text}`);
  } else {
    lines.push(`命中：${COMMAND_RERUN_REQUEST_DECLARED_MATCH_TEXT}`);
  }
  const declared = commandRerunRequestDeclaredForms(
    aliasRequests.filter(candidate => candidate.reviewRef.runId === review.ref.runId
      && candidate.alias === request.alias));
  if (declared.length > 0) lines.push(`注明过的写法：${declared.join('；')}`);
  lines.push(`原因：${request.reason}`);
  const earlier = aliasRequests
    // "Earlier" is created BEFORE this request (strictly), never "all except
    // this one": a sibling created later is not an earlier request/answer.
    .filter(candidate => candidate.ref.requestId !== request.ref.requestId
      && candidate.createdAt < request.createdAt
      && candidate.reviewRef.runId === review.ref.runId && candidate.alias === request.alias)
    .sort(compareCommandRerunRequestNewestFirst)
    .slice(0, COMMAND_RERUN_REQUEST_EARLIER_MAX);
  for (const previous of earlier) {
    lines.push(`以前：${previous.state}；${previous.command}；${answerWordOf(previous)}`);
  }
  lines.push(COMMAND_RERUN_REQUEST_FIXED_SENTENCE);
  return lines.join('\n');
}

/** L19a: one pure projection of the request card. */
export function commandRerunRequestCardFacts(
  input: CommandRerunRequestCardInputV1,
): CommandRerunRequestCardFactsV1 {
  const { request, review, goal, taskActive } = input;
  const source: DecisionSourceV1 = {
    kind: 'command_rerun_request',
    key: decisionSourceKey({ kind: 'command_rerun_request', requestRef: request.ref, revision: request.revision }),
    subject: { kind: 'goal', goalRef: { ...goal.ref } },
    pins: [
      requestPin(request),
      { ref: structuredClone(review.ref), revision: review.revision },
      { ref: structuredClone(goal.ref), revision: goal.revision },
    ],
    goalBases: [goalDecisionBasis(goal)],
  };
  const summary = commandRerunRequestSummary(input);
  // Item 5: exactly as the UCR card — the record object's label IS the whole
  // card text, not only the blocked command.
  const objects: DecisionObjectV1[] = [
    { kind: 'aggregate', pin: requestPin(request), label: summary },
  ];
  const closedReason: CommandRerunRequestCardFactsV1['closedReason'] =
    goal.desiredState === 'cancelled' ? 'goal_cancelled'
      : request.state !== 'pending' || !taskActive ? 'source_resolved'
        : null;
  return {
    source, goalRef: { ...goal.ref }, requestRef: request.ref, revision: request.revision,
    taskActive, objects, options: commandRerunRequestOptions(), summary, closedReason,
  };
}

/**
 * The reads the card source (and the answerability facts) injects. The
 * projection itself is pure; this seam is the only place the card touches the
 * Kernel, the records and the owners.
 */
export type CommandRerunRequestCardSourceDependencies = {
  /** The Goal/Plan window (`readGoalPlanWindow`) and the original Run record. */
  records: S5RecordPort;
  requests: Pick<CommandRerunRequestReadPort, 'listRequests' | 'readRequest'>;
  reviews: Pick<UnknownCallReviewReadPort, 'readReview'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  /**
   * L19a: the ORIGINAL Run's Kernel call reader (the same K L9 window the
   * continuation brief uses). A missing/unreadable read fails the card closed.
   */
  readKernelCommandFacts: KernelCommandReader;
  /** K3-20: the maximum items one offset page serves (1..200, default SOURCE_PAGE_LIMIT). */
  pageLimit?: number;
};

/** The card's request-source identity, parsed and checked against the kind. */
export function commandRerunRequestCardIdentity(
  source: DecisionSourceV1,
): { requestRef: CommandRerunRequestV1['ref']; revision: number } | null {
  if (source.kind !== 'command_rerun_request') return null;
  const parsed = parseDecisionSourceKey(source);
  if (parsed === null || parsed.kind !== 'command_rerun_request') return null;
  const requestRef = nestedSourceObject(parsed.body, 'requestRef');
  const revision = parsed.body['revision'];
  if (requestRef === null || typeof revision !== 'number') return null;
  return { requestRef: requestRef as unknown as CommandRerunRequestV1['ref'], revision };
}

/** Re-exported so the two callers do not import the workspace shape twice. */
export type CommandRerunRequestCardWorkspace = { projectId: string; workspaceId: string };

export function commandRerunRequestCardWorkspaceOf(
  request: CommandRerunRequestV1,
): CommandRerunRequestCardWorkspace {
  return workspaceOf(request);
}
