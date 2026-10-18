/**
 * K3-15 (L19/L20) pure disposition assembler and renderer (F-057, F-046).
 *
 * The pre-B3 service rows asserted the rendered mandatory lines of a mixed
 * record (a process item and a platform item): D1:194 and D1:200 the two
 * `- 作用对象：#1、#2。` / `- 平台条目 #2` existence checks, D1:202 and D1:203
 * the two position checks. They are restored here on the exported pure
 * `assembleUnknownCallReviewSection` / `renderContinuationBriefZh`: each line
 * is asserted non-null and equal to a hand-written L20 literal BEFORE any
 * position comparison, so a missing line cannot pass as `indexOf(...) === -1`.
 * The remaining L20 wording rows (no targets, auto-settled, the 60-unit note
 * clip, annotations and the blocked-command sentence) moved here from
 * `tests/work-graph/K3-15-disposition-effects.test.ts` with F-046.
 *
 * A5: built review and brief values only; no store, platform, Host, Workflow,
 * Runtime, fixture or stub port is imported.
 */
import { describe, expect, it } from 'vitest';
import {
  continuationBriefDigest, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { NoProgressKeyV1 } from '../../src/contracts/no-progress.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type {
  UnknownCallBlockedCommandV1, UnknownCallDispositionV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { assembleUnknownCallReviewSection, assembleContinuationBrief } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import { decodeUnknownCallReview, encodeUnknownCallReview } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';

const P = 'k3p-project';
const G = 'k3p-goal';
const AT = (minute: number): string => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
const sha = (char: string): string => char.repeat(64);

const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'plan-1' };
const ROLE: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1', bindingVersion: 1,
  policyRevision: 'policy-1',
};
const TASK: TaskTriple = { projectId: P, goalId: G, taskId: 'k3p-task' };
const SESSION = { projectId: P, sessionId: 'session-1' };

const runRef = (runId: string): RunRef => ({ aggregateType: 'Run', projectId: P, goalId: G, runId });

function runOf(runId: string, over: Partial<RunSnapshot>): RunSnapshot {
  return {
    ref: runRef(runId), revision: 4, schemaVersion: 1, task: { ...TASK }, attemptId: `${runId}-attempt`,
    planRef: PLAN, roleBinding: ROLE, budget: { tokenBudget: 1000, deadline: null },
    workspaceSnapshot: { workspaceId: 'w', revision: 3 }, status: 'ended', outcome: 'completed', exitCode: 0,
    lastEventSeq: 2, lastRuntimeEventId: `rt-${runId}`, lastFactEventId: `ev-${runId}`, envelope: null,
    startedAt: AT(1), endedAt: AT(5), ...over,
  };
}
const recordOf = (run: RunSnapshot): TaskExecutionRecord => ({ run,
  attempt: { ref: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: TASK.taskId,
    attemptId: run.attemptId } },
  outbox: { claim: { sessionRef: SESSION } } }) as unknown as TaskExecutionRecord;

const KEY: NoProgressKeyV1 = { taskRef: TASK, actionKind: 'requeue',
  failure: { outcome: 'completed', origin: 'observed', exhaustedTokenBudget: null, checks: [], gapCodes: [] },
  source: { workspaceRevision: 3, sourceDigest: sha('1') }, plan: PLAN, newInputDigest: null, digest: sha('2') };

function requeueOf(afterRunId: string): TaskRequeueSnapshotV1 {
  return {
    ref: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: TASK.taskId, afterRunId },
    revision: 1, schemaVersion: 1, task: { ...TASK }, planRef: PLAN, afterRunRef: runRef(afterRunId),
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: TASK.taskId,
      attemptId: `${afterRunId}-attempt` },
    afterOutcome: 'completed', afterRoundRef: null, failureClass: 'check_failed', interruption: null,
    stopIntentRef: null, stopRequester: 'none', basis: KEY, basisComparison: 'compared', supersededEvidenceIds: [],
    newInputRefs: [], budget: null, reason: 'auto-rework:check_failed#1',
    requestedBy: { kind: 'system', id: 'workflow:auto-rework' },
    requestedAt: AT(6), agentProvenance: null, automation: { automatic: true, counted: true, autoCount: 1, cap: 3 },
    historySource: null,
  };
}

/** The container brief: built values only, so the renderer can be called directly. */
function baseBrief(): ContinuationBriefV1 {
  const run1 = runOf('run-1', {});
  const requeue1 = requeueOf('run-1');
  const run2 = runOf('run-2', { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null,
    requeueRef: requeue1.ref });
  return assembleContinuationBrief({
    basis: { run: run2, requeue: requeue1, allRequeues: [requeue1],
      previous: recordOf(run1), previousIntents: { pointer: null, steers: [] }, previousWait: null,
      round: null, newInputBodies: [], replyBodies: [], factsChain: [], readThrough: null },
    factsRecord: recordOf(run1), factsHops: 0, factsTruncated: false,
    turn: { kernel: 'unavailable', reason: 'the Kernel store is not registered' },
    workspace: { briefCheckpoint: { kind: 'brief', at: AT(7), workspaceRevision: 3, sourceDigest: sha('1'),
      unavailableReason: null },
      uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null } },
    claimSessionRef: SESSION,
  });
}

const UNAVAILABLE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const,
  detail: 'the pure K3-15 disposition test',
};

/** One mixed record item: #1 is a process call, #2 is a platform call. */
function item(alias: number): UnknownCallReviewItemV1 {
  const callId = `call-${String(alias)}`;
  const process = alias === 1;
  return {
    alias, callId, toolName: process ? 'shell' : 'send_user_message', kind: process ? 'process' : 'platform',
    contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1', callId,
      declaredPosition: alias, startedPosition: alias },
    argumentsDigest: process ? 'd'.repeat(64) : 'e'.repeat(64),
    summary: { command: process ? 'echo hi' : null, cwd: null, mode: null, paths: [], pathsOmitted: 0,
      truncated: false },
    startedAt: null,
    observed: process
      ? { verdict: 'pending' as const, by: null }
      : { verdict: 'undetermined' as const, by: 'platform' as const,
        evidence: { kind: 'lookup_failed' as const, reason: 'k3-15' } },
  };
}

function dispositionOf(
  choice: UnknownCallDispositionV1['choice'],
  text: string | null,
  over: Partial<UnknownCallDispositionV1> = {},
): UnknownCallDispositionV1 {
  return {
    choice, source: 'card', targets: ['call-1', 'call-2'], answerMessageRef: null, answeredRevision: 2,
    appliedBy: { kind: 'human', id: 'operator' }, appliedAt: AT(2), text, annotations: [], approval: null,
    approvedMethods: [], hold: choice === 'handle_myself' ? 'held' : null, ...over,
  };
}

/** The record the assembler projects: #1 is the process item, #2 the platform item. */
function reviewOf(
  disposition: UnknownCallDispositionV1 | null,
  over: Partial<UnknownCallReviewV1> = {},
): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'run-1' },
    schemaVersion: 1, revision: 2, workspaceId: 'w', task: { ...TASK }, runRef: runRef('run-1'),
    sessionRef: SESSION,
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' },
      reason: 'the pure K3-15 disposition test' },
    inventory: 'complete', inventoryProblem: null,
    items: [item(1), item(2)], itemsOmitted: 0, workspace: UNAVAILABLE,
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: disposition === null ? 'resolved' : 'needs_decision',
    open: disposition === null ? 'no' : 'yes', decisionReasons: [],
    dispositionTargets: disposition === null ? null : ['call-1', 'call-2'],
    proposalTargets: disposition === null ? null : ['call-1'],
    stateEntry: 1, activeRound: null, rounds: [], proposals: [], blockedCommands: [],
    disposition, createdAt: AT(0), updatedAt: AT(1), ...over,
  };
}

/** L20 wording, written here from the spec (never imported from production). */
const OPTION_TEXT: Readonly<Record<UnknownCallDispositionV1['choice'], string>> = {
  rerun_as_is: '照原样重跑',
  skip_as_done: '跳过，当作已做：不要重跑这些命令',
  handle_myself: '由人处理：操作者自己处理过这几条，先看当前状态',
  safer_method: '换个稳妥的跑法：不要跑原命令，照下面的方案原样跑',
};

function render(review: UnknownCallReviewV1): {
  section: ReturnType<typeof assembleUnknownCallReviewSection>;
  rendered: string;
  lines: string[];
} {
  const section = assembleUnknownCallReviewSection({ review });
  const brief: ContinuationBriefV1 = { ...baseBrief(), unknownCallReview: section };
  const rendered = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
  return { section, rendered, lines: rendered.split('\n') };
}

const ONE_LINE = (line: string | undefined): string => {
  expect(line).toBeDefined();
  if (line === undefined) throw new Error('the mandatory disposition line must render');
  return line;
};

describe('K3-15 L20 pure disposition assembler and renderer', () => {
  it.each(['rerun_as_is', 'skip_as_done', 'safer_method', 'handle_myself'] as const)(
    'K3-15 L20 %s: the mixed targets lines exist for the card answer', choice => {
      const { section, rendered, lines } = render(reviewOf(dispositionOf(choice, `answer ${choice}`)));
      const disposition = section.disposition;
      expect(disposition).not.toBeNull();
      if (disposition === null) throw new Error('the disposition must be assembled');
      expect(disposition).toMatchObject({ choice, source: 'card', targets: [1, 2], platformTargets: [2] });

      // D1:194/D1:200: the two mixed lines exist (assert each non-null first).
      expect(ONE_LINE(lines.find(line => line.startsWith('- 处置：'))))
        .toBe(`- 处置：${OPTION_TEXT[choice]}（卡上选的）；附言：answer ${choice}。`);
      expect(ONE_LINE(lines.find(line => line.startsWith('- 作用对象：')))).toBe('- 作用对象：#1、#2。');
      expect(ONE_LINE(lines.find(line => line.startsWith('- 平台条目 ')))).toBe('- 平台条目 #2：结果查不清，重做前先核实。');
      expect(lines).toContain('- 不在变动清单里，不证明没做。');

      // A72 (original :270): the card's one process target renders the single-target line.
      const single = render(reviewOf(
        dispositionOf(choice, `answer ${choice}`, { targets: ['call-1'] }),
        { items: [item(1)], dispositionTargets: ['call-1'], proposalTargets: ['call-1'] },
      ));
      expect(ONE_LINE(single.lines.find(line => line.startsWith('- 作用对象：')))).toBe('- 作用对象：#1。');

      // A74 (original :281): every choice but skip_as_done leaves out the blocked sentence.
      if (choice !== 'skip_as_done') {
        expect(rendered).not.toContain('- 平台拦下原命令；要再跑先请求并得到允许。');
      }
    });

  it('K3-15 (L20): a card rerun_as_is renders the one-line disposition, targets, platform line and fixed sentence',
    () => {
    const { lines } = render(reviewOf(dispositionOf('rerun_as_is', '照写')));
    // D1:202/D1:203: existence first, then position; never compare two -1s.
    expect(ONE_LINE(lines.find(line => line.startsWith('- 作用对象：')))).toBe('- 作用对象：#1、#2。');
    expect(ONE_LINE(lines.find(line => line.startsWith('- 平台条目 ')))).toBe('- 平台条目 #2：结果查不清，重做前先核实。');
    expect(ONE_LINE(lines.find(line => line.startsWith('- 不在变动清单里，')))).toBe('- 不在变动清单里，不证明没做。');
    const targetsIndex = lines.indexOf('- 作用对象：#1、#2。');
    const platformIndex = lines.indexOf('- 平台条目 #2：结果查不清，重做前先核实。');
    const reminderIndex = lines.indexOf('- 不在变动清单里，不证明没做。');
    expect(targetsIndex).toBeGreaterThanOrEqual(0);
    expect(platformIndex).toBeGreaterThanOrEqual(0);
    expect(reminderIndex).toBeGreaterThanOrEqual(0);
    expect(targetsIndex).toBeLessThan(platformIndex);
    expect(platformIndex).toBeLessThan(reminderIndex);

    // A77/A78/A80 (original :314/:315/:317): the card's one process item row.
    const single = render(reviewOf(
      dispositionOf('rerun_as_is', '照写', { targets: ['call-1'] }),
      { items: [item(1)], dispositionTargets: ['call-1'], proposalTargets: ['call-1'] },
    ));
    expect(ONE_LINE(single.lines.find(line => line.startsWith('- 处置：'))))
      .toBe('- 处置：照原样重跑（卡上选的）；附言：照写。');
    expect(ONE_LINE(single.lines.find(line => line.startsWith('- 作用对象：')))).toBe('- 作用对象：#1。');
    expect(single.rendered.indexOf('- 处置：')).toBeLessThan(single.rendered.indexOf('- 作用对象：'));
  });

  it('K3-15 (L20): a released handle_myself renders the human-handled wording', () => {
    const { lines } = render(reviewOf(dispositionOf('handle_myself', 'I handled it', { hold: 'released' })));
    // A84 (original :346): the released card disposition's full rendered line.
    expect(ONE_LINE(lines.find(line => line.startsWith('- 处置：'))))
      .toBe('- 处置：由人处理：操作者自己处理过这几条，先看当前状态（卡上选的）；附言：I handled it。');
  });

  it('K3-15: a disposition with no targets renders - 作用对象：无。',
    () => {
    const review = reviewOf(
      dispositionOf('handle_myself', 'the operator handles it', { source: 'direct', targets: [] }),
      { dispositionTargets: [], proposalTargets: [] },
    );
    const { section, lines } = render(review);
    const disposition = section.disposition;
    expect(disposition).not.toBeNull();
    if (disposition === null) throw new Error('the disposition must be assembled');
    expect(disposition).toMatchObject({ choice: 'handle_myself', source: 'direct', targets: [], platformTargets: [] });
    expect(ONE_LINE(lines.find(line => line.startsWith('- 处置：'))))
      .toBe('- 处置：由人处理：操作者自己处理过这几条，先看当前状态（直接点的）；附言：the operator handles it。');
    expect(lines).toContain('- 作用对象：无。');
    expect(lines.some(line => line.startsWith('- 平台条目 '))).toBe(false);
  });

  it('K3-15 (L20): a review settled by itself still renders the disposition line, from "自动"',
    () => {
    const { section, lines } = render(reviewOf(null));
    expect(section.disposition).toBeNull();
    expect(ONE_LINE(lines.find(line => line.startsWith('- 处置：'))))
      .toBe('- 处置：核对自动定下，不用决定（自动）。');
    expect(lines).toContain('- 作用对象：无。');
    expect(lines).toContain('- 不在变动清单里，不证明没做。');
    expect(lines.some(line => line.startsWith('- 平台条目 '))).toBe(false);
  });

  it('K3-15 (L20): a 61-UTF-16-unit 附言 is clipped to 60 units with the truncation suffix',
    () => {
    const { lines } = render(reviewOf(dispositionOf('rerun_as_is', '字'.repeat(61))));
    const line = ONE_LINE(lines.find(entry => entry.startsWith('- 处置：')));
    const marker = '…（已截断）';
    expect(line).toContain(marker);
    const body = line.slice(line.indexOf('；附言：') + '；附言：'.length, line.indexOf(marker));
    expect(body.length).toBe(60);
    expect(body).toBe('字'.repeat(60));
  });

  it('K3-15 (L20): disposition annotations survive the codec and render one line for the record and one for a file',
    () => {
    const annotations = [
      { path: null, text: '先核实远端迁移' },
      { path: 'src/x.ts', text: '看迁移脚本' },
    ];
    const review = reviewOf(dispositionOf('rerun_as_is', '先核实远端迁移', { annotations }));
    const decoded = decodeUnknownCallReview(encodeUnknownCallReview(review));
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    expect(decoded.value.disposition).not.toBeNull();
    expect(decoded.value.disposition?.annotations).toEqual(annotations);

    const { section, lines } = render(decoded.value);
    expect(section.disposition).not.toBeNull();
    expect(section.disposition?.annotations).toEqual(annotations);
    expect(lines).toContain('- 批注（这份核对记录）：先核实远端迁移');
    expect(lines).toContain('- 批注（src/x.ts）：看迁移脚本');
  });

  it('K3-15 (二): a blocked command adds its sentence after the fixed reminder', () => {
    const blocked: UnknownCallBlockedCommandV1 = {
      reviewRunId: 'run-1', alias: 1, commandSha256: sha('a'),
      kernelCallRef: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1',
        callId: 'call-1', declaredPosition: 1, startedPosition: 1 },
      actions: [], expansions: [], truncated: false,
    };
    const { section, lines } = render(reviewOf(dispositionOf('skip_as_done', 'skip it'),
      { blockedCommands: [blocked] }));
    // A82 (original :326): the fixed skip wording's full line.
    expect(ONE_LINE(lines.find(line => line.startsWith('- 处置：'))))
      .toBe('- 处置：跳过，当作已做：不要重跑这些命令（卡上选的）；附言：skip it。');
    expect(section.blockedCommands).toEqual([{ alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') }]);
    const reminderIndex = lines.indexOf('- 不在变动清单里，不证明没做。');
    expect(reminderIndex).toBeGreaterThanOrEqual(0);
    expect(lines[reminderIndex + 1]).toBe('- 平台拦下原命令；要再跑先请求并得到允许。');
  });
});
