/**
 * K3 group 2 part 3, work item 2 (L6, spec lines 213–222; §2 render; L20 required
 * lines / "不是必需"): the continuation note's unknown-call review section.
 *
 * Pure: no RecordStore, no Kernel, no clock. The section is built by the pure
 * `assembleUnknownCallReviewSection` from hand-built facts, the rendered brief
 * from `renderContinuationBriefZh`.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import {
  continuationBriefDigest, continuationBriefShapeProblem, renderContinuationBriefZh,
  type ContinuationBriefV1, type ContinuationUnknownCallReviewV1,
} from '../../src/contracts/continuation-brief.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { WORKFLOW_AUTOMATION_ACTOR, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type {
  UnknownCallDispositionV1, UnknownCallReviewItemV1, UnknownCallReviewV1, WorkspaceCaptureV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  assembleUnknownCallReviewSection, type ReviewFileRead,
} from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import {
  assembleContinuationBrief,
} from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';

const P = 'k3r-project', G = 'k3r-goal', T = 'k3r-task', W = 'k3r-workspace';
const sha = (char: string): string => char.repeat(64);
const at = (minute: number): string => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
const task: TaskTriple = { projectId: P, goalId: G, taskId: T };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1, policyRevision: 'policy-1',
};
const SESSION: SessionRef = { projectId: P, sessionId: 'session-1' };
const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });

function runOf(runId: string, over: Partial<RunSnapshot>): RunSnapshot {
  return {
    ref: runRef(runId), revision: 4, schemaVersion: 1, task: { ...task }, attemptId: `${runId}-attempt`, planRef: PLAN,
    roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null }, workspaceSnapshot: { workspaceId: W, revision: 3 },
    status: 'ended', outcome: 'completed', exitCode: 0, lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`,
    lastFactEventId: `ev-${runId}`, envelope: null, startedAt: at(1), endedAt: at(5), ...over,
  };
}
const recordOf = (run: RunSnapshot): TaskExecutionRecord => ({ run,
  attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: run.attemptId } },
  outbox: { claim: { sessionRef: SESSION } } }) as unknown as TaskExecutionRecord;

const KEY: NoProgressKeyV1 = { taskRef: task, actionKind: 'requeue',
  failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('1') }, plan: PLAN, newInputDigest: null, digest: sha('2') };
function requeueOf(afterRunId: string): TaskRequeueSnapshotV1 {
  return {
    ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: T, afterRunId }, revision: 1, schemaVersion: 1, task,
    planRef: PLAN, afterRunRef: runRef(afterRunId),
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: T, attemptId: `${afterRunId}-attempt` },
    afterOutcome: 'completed', afterRoundRef: null, failureClass: 'check_failed', interruption: null, stopIntentRef: null,
    stopRequester: 'none', basis: KEY, basisComparison: 'compared', supersededEvidenceIds: [], newInputRefs: [], budget: null,
    reason: 'auto-rework:check_failed#1', requestedBy: { ...WORKFLOW_AUTOMATION_ACTOR }, requestedAt: at(6),
    agentProvenance: null, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 }, historySource: null,
  };
}

/** A minimal, valid brief assembled by the real pure assembler; the review section is added by the test. */
function baseInput() {
  const run1 = runOf('run-1', {});
  const requeue1 = requeueOf('run-1');
  const run2 = runOf('run-2', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null, requeueRef: requeue1.ref });
  const basis: ContinuationBasis = { run: run2, requeue: requeue1, allRequeues: [requeue1], previous: recordOf(run1),
    previousIntents: { pointer: null, steers: [] }, previousWait: null, round: null, newInputBodies: [], replyBodies: [],
    factsChain: [], readThrough: null };
  return { basis, factsRecord: recordOf(run1), factsHops: 0, factsTruncated: false,
    turn: { kernel: 'unavailable' as const, reason: 'the Kernel store is not registered' },
    workspace: { briefCheckpoint: { kind: 'brief' as const, at: at(7), workspaceRevision: 3, sourceDigest: sha('1'), unavailableReason: null },
      uncommitted: { status: 'not_git' as const, baseCommit: null, paths: [], omitted: 0, reason: null } },
    claimSessionRef: SESSION };
}
function baseBrief(): ContinuationBriefV1 {
  return assembleContinuationBrief(baseInput());
}

const captureRef: ArtifactRef = { kind: 'artifact', contentType: 'application/json', digest: sha('c'), sizeBytes: 10,
  source: { kind: 'workspace', refId: `${W}:c1`, revision: '1' } };
function captured(over: Partial<Extract<WorkspaceCaptureV1, { status: 'captured' }>> = {}): WorkspaceCaptureV1 {
  return { status: 'captured', runBaselineKnown: true, baseCommit: sha('b'), headNow: sha('h'), captureRef,
    changedCount: 1, sample: [], notVisible: [], notVisibleOmitted: 0, ...over };
}

function reviewOf(items: UnknownCallReviewItemV1[], over: Partial<UnknownCallReviewV1> = {}): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'run-1' },
    schemaVersion: 1, revision: 2, workspaceId: W, task: { ...task }, runRef: runRef('run-1'), sessionRef: SESSION,
    origin: { kind: 'takeover_unresolved', hostInstanceId: 'host-1', proof: { kind: 'hl01_no_lock' } },
    inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0, workspace: captured(),
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'resolved', open: 'no', decisionReasons: [], dispositionTargets: null, proposalTargets: null,
    stateEntry: 1, activeRound: null, rounds: [], proposals: [], blockedCommands: [], disposition: null,
    createdAt: at(5), updatedAt: at(6), ...over,
  };
}

function kernelRef(callId: string) {
  return { adapterId: 'adapter-1', kernelSessionId: 'ks-1', kernelRunId: 'run-1', turnId: 'turn-1',
    callId, declaredPosition: 1, startedPosition: 1 };
}

function platformItem(alias: number, verdict: 'done' | 'not_done' | 'undetermined'): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'send_session_message', kind: 'platform', contained: true,
    kernel: kernelRef(`call-${String(alias)}`), argumentsDigest: sha('a'),
    summary: { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false }, startedAt: at(2),
    observed: { verdict, by: 'platform', evidence: { kind: 'not_committed' } },
  };
}

/** L20 continuation half: a process item with a full command and a settled conclusion. */
function processItem(alias: number, command: string): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'shell', kind: 'process', contained: true,
    kernel: kernelRef(`call-${String(alias)}`), argumentsDigest: sha('a'),
    summary: { command, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false }, startedAt: at(2),
    observed: { verdict: 'done', by: 'review_round', evidence: '命令正常结束', roundRunRef: null,
      crashSuspicion: { verdict: 'unlikely', evidence: '退出码 0，没有崩溃迹象' }, reviewerConclusion: null },
  };
}

/** K3 L20: an applied `safer_method` disposition carrying the approved methods. */
function dispositionOf(
  approvedMethods: Array<{ alias: number; command: string; cwd: string | null }>,
  over: Partial<UnknownCallDispositionV1> = {},
): UnknownCallDispositionV1 {
  return {
    choice: 'safer_method', source: 'card', targets: [], answerMessageRef: null, answeredRevision: 2,
    appliedBy: { kind: 'human', id: 'operator' }, appliedAt: at(6), text: null, annotations: [], approval: null,
    approvedMethods: approvedMethods.map((method, index) => ({ proposalId: `proposal-${String(index + 1)}`,
      callId: `call-${String(method.alias)}`, ...method })), hold: null, ...over,
  };
}

function fileEditItem(alias: number, paths: string[], mode: 'replace' | 'create' = 'replace'): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'edit', kind: 'file_edit', contained: true,
    kernel: kernelRef(`call-${String(alias)}`), argumentsDigest: sha('a'),
    summary: { command: null, cwd: null, mode, paths, pathsOmitted: 0, truncated: false }, startedAt: at(2),
    observed: { verdict: 'compare_in_continuation', by: 'platform' },
  };
}

function renderWith(brief: ContinuationBriefV1, review: ContinuationUnknownCallReviewV1 | null): string {
  const withReview: ContinuationBriefV1 = review === null ? brief : { ...brief, unknownCallReview: review };
  return renderContinuationBriefZh(withReview, continuationBriefDigest(withReview));
}

/** The exact pre-K3 bytes of `baseBrief()` (captured before the section existed). */
const BASE_RENDER = [
  '## 接续说明',
  '[continuation-brief v1 sha256:a3a9706587bb68975b7a35962c82aa4c961ef75116ff189d11a7ce3e0580a9d6]',
  '这是任务 k3r-task 的接续执行（返工）：第 1 次重新入队，失败类别：检查未通过，发起方：系统自动，自动返工 1/3。',
  '接续方式：在同一 Session session-1 中继续，但上一次执行的 Turn 不在模型历史中。',
  '',
  '### 上一次执行',
  '- 执行 run-1（Session session-1）依据执行记录以 completed 结束。',
  '- 结束时间：2026-10-07T10:05:00.000Z。',
  '',
  '### 停在哪里',
  '- 执行记录无法读取，停在哪里无法确定。',
  '- 原因：the Kernel store is not registered',
  '',
  '### 工具调用',
  '- 执行记录无法读取，工具调用无法确定。',
  '',
  '### 重新入队',
  '- 原因（系统自动）：auto-rework:check_failed#1',
  '- 没有新输入。',
  '',
  '### 工作区',
  '- 上一次执行经工具改动的文件：无法确定。',
  '- 上一次执行结束（2026-10-07T10:05:00.000Z）到“重新入队”之间：无法从持久记录确定是否有改动。',
  '- 重新入队 → 本次执行开始前：源码摘要相同',
  '- 工作区不是 git 仓库，未提交的改动无法列出。',
  '',
  '### 继续之前',
  '- 文件可能已经变化，编辑前先重新读取。',
  '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
  '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
  '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。',
].join('\n');

describe('K3 L6: the continuation note review section', () => {
  it('renders a platform item with verdict done as an 已做-class line and the fixed sentence', () => {
    const section = assembleUnknownCallReviewSection({ review: reviewOf([platformItem(1, 'done')]) });
    const text = renderWith(baseBrief(), section);
    expect(text).toContain('### 结果未知的调用：核对和处置');
    expect(text).toContain('- 不在变动清单里，不证明没做。');
    expect(text).toContain('- 共 1 条（#1–#1），另有 0 条没有列出；各条的结论和依据见上文“核对结论”，可能被略去。');
    expect(text).toContain('#1 = call-1（send_session_message）：已做');
  });

  it('renders a platform item with verdict not_done as 没做', () => {
    const section = assembleUnknownCallReviewSection({ review: reviewOf([platformItem(1, 'not_done')]) });
    const text = renderWith(baseBrief(), section);
    expect(text).toContain('没做');
    expect(text).not.toContain('已做');
  });

  it('renders a file edit with its mode, path, change and a unified diff', () => {
    const callArguments = new Map<string, Record<string, unknown>>([
      ['call-2', { path: 'src/a.ts', oldText: 'const a = 1;\n', newText: 'const a = 2;\n' }],
    ]);
    const files = new Map<string, { baseline: ReviewFileRead; current: ReviewFileRead }>([
      ['src/a.ts', { baseline: { status: 'ready', text: 'const a = 1;\n' }, current: { status: 'ready', text: 'const a = 2;\n' } }],
    ]);
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(2, ['src/a.ts'])], {
        workspace: captured({ sample: [{ path: 'src/a.ts', change: 'modified' }], changedCount: 1 }),
      }),
      callArguments, files,
    });
    expect(section.items[0]!.files[0]).toMatchObject({ path: 'src/a.ts', mode: 'replace', change: 'modified' });
    const diff = section.items[0]!.files[0]!.diff;
    expect(diff).not.toBeNull();
    expect(diff!.text).toContain('--- a/src/a.ts');
    expect(diff!.text).toContain('+++ b/src/a.ts');
    expect(diff!.text).toContain('-const a = 1;');
    expect(diff!.text).toContain('+const a = 2;');
    const text = renderWith(baseBrief(), section);
    expect(text).toContain('src/a.ts');
    expect(text).toContain('替换');
    expect(text).toContain('有改动');
  });

  it('marks a path whose capture lists no change as unchanged and a notVisible path as not_visible', () => {
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(3, ['src/clean.ts', 'secret/x.ts'])], {
        workspace: captured({ sample: [{ path: 'secret/x.ts', change: 'modified' }], notVisible: ['secret/'] }),
      }),
    });
    const files = section.items[0]!.files;
    expect(files.find(file => file.path === 'src/clean.ts')!.change).toBe('unchanged');
    expect(files.find(file => file.path === 'secret/x.ts')!.change).toBe('modified');
  });

  it('bounds oldText and newText excerpts to 1,000 UTF-16 units each', () => {
    const long = 'x'.repeat(5_000);
    const callArguments = new Map<string, Record<string, unknown>>([['call-4', { oldText: long, newText: long }]]);
    const section = assembleUnknownCallReviewSection({ review: reviewOf([fileEditItem(4, ['src/a.ts'])]), callArguments });
    const file = section.items[0]!.files[0]!;
    expect(file.oldText!.text.length).toBeLessThanOrEqual(1_000);
    expect(file.newText!.text.length).toBeLessThanOrEqual(1_000);
    expect(file.oldText!.truncated).toBe(true);
  });

  it('omits diffs once the whole section is over 8 KiB UTF-8, with diffOmittedReason section_limit', () => {
    const paths = Array.from({ length: 12 }, (_, index) => `src/f${String(index)}.ts`);
    const callArguments = new Map<string, Record<string, unknown>>();
    const files = new Map<string, { baseline: ReviewFileRead; current: ReviewFileRead }>();
    for (const path of paths) {
      const oldText = 'a'.repeat(900);
      const newText = 'b'.repeat(900);
      callArguments.set('call-5', { path, oldText, newText });
      files.set(path, { baseline: { status: 'ready', text: oldText }, current: { status: 'ready', text: newText } });
    }
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(5, paths)]), callArguments, files,
    });
    const rendered = section.items[0]!.files.filter(file => file.diff !== null);
    const omitted = section.items[0]!.files.filter(file => file.diff === null && file.diffOmittedReason === 'section_limit');
    expect(rendered.length).toBeGreaterThan(0);
    expect(omitted.length).toBeGreaterThan(0);
  });

  it('degrades a path whose baseline has no stored content to baseline_dirty without a diff', () => {
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(6, ['src/a.ts'])], {
        workspace: captured({ sample: [{ path: 'src/a.ts', change: 'modified' }] }),
      }),
      files: new Map([['src/a.ts', { baseline: { status: 'unavailable', reason: 'baseline_dirty' },
        current: { status: 'ready', text: 'new' } }]]),
    });
    const file = section.items[0]!.files[0]!;
    expect(file.diff).toBeNull();
    expect(file.diffOmittedReason).toBe('baseline_dirty');
  });

  it('K3-04 (L6 unknown): a path outside a truncated sample with no readable capture is unknown and renders 不知道', () => {
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(7, ['src/deep.ts'])], {
        workspace: captured({ sample: [], changedCount: 60 }),
      }),
    });
    const file = section.items[0]!.files[0]!;
    expect(file.change).toBe('unknown');
    expect(continuationBriefShapeProblem({ ...baseBrief(), unknownCallReview: section })).toBeNull();
    expect(renderWith(baseBrief(), section)).toContain('不知道');
  });

  it('K3-04 (L6 unknown): the full capture artifact changes classify every path', () => {
    const section = assembleUnknownCallReviewSection({
      review: reviewOf([fileEditItem(8, ['src/deep.ts', 'src/clean.ts'])], {
        workspace: captured({ sample: [{ path: 'src/deep.ts', change: 'added' }], changedCount: 60 }),
      }),
      captureChanges: [{ path: 'src/deep.ts', change: 'added' }],
    });
    const files = section.items[0]!.files;
    expect(files.find(file => file.path === 'src/deep.ts')!.change).toBe('added');
    expect(files.find(file => file.path === 'src/clean.ts')!.change).toBe('unchanged');
  });

  it('accepts the new field in the shape validator and rejects a malformed one', () => {
    const section = assembleUnknownCallReviewSection({ review: reviewOf([platformItem(1, 'done')]) });
    const brief = baseBrief();
    expect(continuationBriefShapeProblem({ ...brief, unknownCallReview: section })).toBeNull();
    expect(continuationBriefShapeProblem({ ...brief, unknownCallReview: { bogus: true } })).not.toBeNull();
  });

  it('leaves a brief without unknownCallReview byte-identical to the pre-K3 bytes', () => {
    const brief = baseBrief();
    const before = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    expect(before).toBe(BASE_RENDER);
    // The explicit null spelling behaves exactly like the absent field.
    expect(renderContinuationBriefZh({ ...brief, unknownCallReview: null }, continuationBriefDigest(brief))).toBe(BASE_RENDER);
  });

  it('leaves the review section out when the review is absent', () => {
    const text = renderWith(baseBrief(), null);
    expect(text).not.toContain('结果未知的调用');
    expect(text).not.toContain('不在变动清单里');
  });

  it('passes the review record through assembleContinuationBrief into the brief section', () => {
    const review = reviewOf([platformItem(1, 'done')]);
    const brief = assembleContinuationBrief({ ...baseInput(), unknownCallReview: review });
    expect(brief.unknownCallReview).toBeDefined();
    expect(brief.unknownCallReview!.items[0]!.verdict).toBe('done');
    expect(brief.unknownCallReview!.workspace.status).toBe('captured');
    expect(renderContinuationBriefZh(brief, continuationBriefDigest(brief)))
      .toContain('### 结果未知的调用：核对和处置');
  });

  it('K3-16 (L20 continuation): an approved safer_method keeps the fixed wording and the methods after the targets line', () => {
    const review = reviewOf([processItem(1, 'npm run build')], {
      dispositionTargets: ['call-1'], proposalTargets: ['call-1'],
      disposition: dispositionOf([{ alias: 1, command: 'npm run build 2>&1', cwd: null }], { targets: ['call-1'] }),
    });
    const section = assembleUnknownCallReviewSection({ review });
    const text = renderWith(baseBrief(), section);
    const dispositionLine = '- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）。';
    const targetsLine = '- 作用对象：#1。';
    const methodLine = '- 方案 #1，目录 .：\n  npm run build 2>&1';
    expect(text).toContain(dispositionLine);
    // L20's exact bytes: fixed prefix 11 + the 72-byte option + 18 bytes of source + 3.
    expect(Buffer.byteLength(dispositionLine, 'utf8')).toBe(104);
    expect(Buffer.byteLength(targetsLine, 'utf8')).toBe(22);
    expect(Buffer.byteLength(methodLine, 'utf8')).toBe(46);
    expect(text).toContain(targetsLine);
    expect(text).toContain(methodLine);
    expect(text).not.toContain('- 平台条目');
    expect(text.indexOf(methodLine)).toBeGreaterThan(text.indexOf(targetsLine));
    expect(text.indexOf('- 不在变动清单里，不证明没做。')).toBeGreaterThan(text.indexOf(methodLine));
  });

  it('K3-46 (二 continuation): an approved mixed card carries the method lines and the platform line', () => {
    const review = reviewOf([processItem(1, 'npm run build'), platformItem(2, 'undetermined')], {
      dispositionTargets: ['call-1', 'call-2'], proposalTargets: ['call-1'],
      disposition: dispositionOf([{ alias: 1, command: 'npm run build:safe', cwd: 'src' }], {
        targets: ['call-1', 'call-2'],
      }),
    });
    const section = assembleUnknownCallReviewSection({ review });
    expect(section.disposition!.platformTargets).toEqual([2]);
    const text = renderWith(baseBrief(), section);
    const methodLine = '- 方案 #1，目录 src：\n  npm run build:safe';
    const platformLine = '- 平台条目 #2：结果查不清，重做前先核实。';
    expect(text).toContain('- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）。');
    expect(text).toContain(methodLine);
    expect(text).toContain(platformLine);
    expect(text.indexOf(methodLine)).toBeGreaterThan(text.indexOf('- 作用对象：#1、#2。'));
    expect(text.indexOf(platformLine)).toBeGreaterThan(text.indexOf(methodLine));
  });

});
