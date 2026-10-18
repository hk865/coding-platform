/**
 * K3 continuation brief: the PURE part only (F-014 / A5 default deny).
 *
 * This module holds the constructed continuation-basis input, the pure
 * `assembleContinuationBrief` call (`baseBrief`), the fixed brief literals and
 * `requiredReviewBlock`. It imports no store, platform, Host, Workflow, Runtime
 * or stub port, so a `*-pure.test.ts` may import it; the heavy public-world
 * helper (`K3-35-continuation-fixture.ts`) re-exports these symbols for its
 * non-pure consumers.
 *
 * Every value here is the same literal the heavy helper used before the move:
 * this file is a move, not a rewrite.
 */
import type { ContinuationBriefV1 } from '../../src/contracts/continuation-brief.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { assembleContinuationBrief } from '../../src/core/agent-runtime/continuation-brief-assembly.js';

export const P = 'P';
export const G = 'B';
export const W = 'W';
export const sha = (char: string): string => char.repeat(64);
export const at = (minute: number): string => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1,
  policyRevision: 'policy-1',
};
/** The pure-renderer fixture's default task (no public world is involved there). */
export const task: TaskTriple = { projectId: 'k3r-project', goalId: 'k3r-goal', taskId: 'k3r-task' };
const SESSION: { projectId: string; sessionId: string } = { projectId: task.projectId, sessionId: 'session-1' };
const runRef = (taskTriple: TaskTriple, runId: string): RunRef =>
  ({ aggregateType: 'Run', projectId: taskTriple.projectId, goalId: taskTriple.goalId, runId });

function runOf(taskTriple: TaskTriple, runId: string, over: Partial<RunSnapshot>): RunSnapshot {
  return {
    ref: runRef(taskTriple, runId), revision: 4, schemaVersion: 1, task: { ...taskTriple }, attemptId: `${runId}-attempt`,
    planRef: PLAN, roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null },
    workspaceSnapshot: { workspaceId: W, revision: 3 }, status: 'ended', outcome: 'completed', exitCode: 0,
    lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`, lastFactEventId: `ev-${runId}`, envelope: null,
    startedAt: at(1), endedAt: at(5), ...over,
  };
}
const recordOf = (taskTriple: TaskTriple, run: RunSnapshot): TaskExecutionRecord => ({ run,
  attempt: { ref: { aggregateType: 'TaskAttempt', projectId: taskTriple.projectId, goalId: taskTriple.goalId,
    taskId: taskTriple.taskId, attemptId: run.attemptId } },
  outbox: { claim: { sessionRef: SESSION } } }) as unknown as TaskExecutionRecord;

const KEY = (taskTriple: TaskTriple): NoProgressKeyV1 => ({ taskRef: taskTriple, actionKind: 'requeue',
  failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('1') }, plan: PLAN, newInputDigest: null, digest: sha('2') });
function requeueOf(taskTriple: TaskTriple, afterRunId: string): TaskRequeueSnapshotV1 {
  return {
    ref: { aggregateType: 'TaskRequeue', projectId: taskTriple.projectId, goalId: taskTriple.goalId,
      taskId: taskTriple.taskId, afterRunId }, revision: 1, schemaVersion: 1, task: taskTriple,
    planRef: PLAN, afterRunRef: runRef(taskTriple, afterRunId),
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: taskTriple.projectId, goalId: taskTriple.goalId,
      taskId: taskTriple.taskId, attemptId: `${afterRunId}-attempt` },
    afterOutcome: 'completed', afterRoundRef: null, failureClass: 'check_failed', interruption: null, stopIntentRef: null,
    stopRequester: 'none', basis: KEY(taskTriple), basisComparison: 'compared', supersededEvidenceIds: [],
    newInputRefs: [], budget: null, reason: 'auto-rework:check_failed#1', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR },
    requestedAt: at(6), agentProvenance: null, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 },
    historySource: null,
  };
}

/** The minimal valid basis the pure assembler accepts; the review/anomalies are added by the row. */
function baseInput(taskTriple: TaskTriple = task) {
  const run1 = runOf(taskTriple, 'run-1', {});
  const requeue1 = requeueOf(taskTriple, 'run-1');
  const run2 = runOf(taskTriple, 'run-2', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null,
    requeueRef: requeue1.ref });
  const basis: import('../../src/core/work-graph/model/execution-read-contracts.js').ContinuationBasis = {
    run: run2, requeue: requeue1, allRequeues: [requeue1],
    previous: recordOf(taskTriple, run1), previousIntents: { pointer: null, steers: [] }, previousWait: null,
    round: null, newInputBodies: [], replyBodies: [], factsChain: [], readThrough: null };
  return { basis, factsRecord: recordOf(taskTriple, run1), factsHops: 0, factsTruncated: false,
    turn: { kernel: 'unavailable' as const, reason: 'the Kernel store is not registered' },
    workspace: { briefCheckpoint: { kind: 'brief' as const, at: at(7), workspaceRevision: 3, sourceDigest: sha('1'),
      unavailableReason: null },
      uncommitted: { status: 'not_git' as const, baseCommit: null, paths: [], omitted: 0, reason: null } },
    claimSessionRef: SESSION };
}
export function baseBrief(taskTriple: TaskTriple = task): ContinuationBriefV1 {
  return assembleContinuationBrief(baseInput(taskTriple));
}

// ------------------------------------------------------------------------ //
// The one approved method: exactly 5,120 UTF-8 bytes.                       //
// ------------------------------------------------------------------------ //
/**
 * Command bytes: 3,892 = 600 newlines (600) + 600 five-byte lines (3,000) +
 * the final 292-byte line. L20's `approvedMethodLinesZh` header is 25 bytes
 * (`- 方案 #1，目录 .：`) plus the `\n  ` 3-byte continuation start; every one
 * of the 600 newlines becomes `\n  `, adding 2 bytes each (1,200).
 * 25 + 3 + 3,892 + 1,200 = 5,120 (≤ the 5,120 owner budget, command ≤ 4,000).
 */
export const APPROVED_COMMAND = `${Array.from({ length: 600 }, () => 'aaaaa').join('\n')}\n${'b'.repeat(292)}`;

/** The UTF-8 length of the whole approved-method block as `approvedMethodLinesZh` joins it. */
export function approvedMethodBlockBytes(): number {
  return Buffer.byteLength(`- 方案 #1，目录 .：\n  ${APPROVED_COMMAND.replace(/\r\n|\n/g, '\n  ')}`, 'utf8');
}

/**
 * The whole required review part of the REAL one-process-item record, hand
 * derived from L20 and this fixture's literals. The renderer test keeps the
 * 32-item extreme; the public path can only reach the one blocked `shell` call,
 * so its mandatory lines are these (the optional `- #1 = …` conclusion is
 * excluded by `requiredReviewBlock`).
 */
export const K3_35_REQUIRED_REVIEW_BLOCK_ONE = [
  '### 结果未知的调用：核对和处置',
  '- 共 1 条（#1–#1），另有 0 条没有列出；各条的结论和依据见上文“核对结论”，可能被略去。',
  `- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）；附言：${'稳'.repeat(60)}…（已截断）。`,
  '- 作用对象：#1。',
  `- 方案 #1，目录 .：\n  ${APPROVED_COMMAND.replace(/\r\n|\n/g, '\n  ')}`,
  '- 不在变动清单里，不证明没做。',
  '- 平台拦下原命令；要再跑先请求并得到允许。',
].join('\n');

// ------------------------------------------------------------------------ //
// The required review block, one literal (optional `- #n = …` excluded).   //
// ------------------------------------------------------------------------ //
const REVIEW_TITLE = '### 结果未知的调用：核对和处置';
const NOT_LISTED = '- 不在变动清单里，不证明没做。';
const SENTENCE = '- 平台拦下原命令；要再跑先请求并得到允许。';

function aliases(from: number, to: number): string {
  return Array.from({ length: to - from + 1 }, (_, index) => `#${String(from + index)}`).join('、');
}

/** The whole required review part, one literal (the optional `- #n = …` lines excluded). */
export const REQUIRED_REVIEW_BLOCK = [
  REVIEW_TITLE,
  '- 共 32 条（#1–#32），另有 0 条没有列出；各条的结论和依据见上文“核对结论”，可能被略去。',
  '- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）；附言：' + '稳'.repeat(60) + '…（已截断）。',
  `- 作用对象：${aliases(1, 32)}。`,
  `- 方案 #1，目录 .：\n  ${APPROVED_COMMAND.replace(/\r\n|\n/g, '\n  ')}`,
  `- 平台条目 ${aliases(2, 32)}：结果查不清，重做前先核实。`,
  NOT_LISTED,
  SENTENCE,
].join('\n');

/** Extracts the required block from a rendered brief, ignoring optional conclusion lines. */
export function requiredReviewBlock(text: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(REVIEW_TITLE);
  const end = lines.indexOf(SENTENCE);
  if (start < 0 || end < start) throw new Error('the review required block is not present');
  return lines.slice(start, end + 1).filter(line => !/^- #\d+ = /.test(line)).join('\n');
}
