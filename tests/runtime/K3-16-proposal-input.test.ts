/**
 * K3 row K3-16 (L20, lead answer 3): the proposal round's structured input and
 * its `### 提方案` block.
 *
 * The review phase renders byte-for-byte as before: the block exists only in
 * the proposal phase. The proposal block lists each `proposalTargets` item by
 * alias (ascending) with its original command (a newline becomes a newline plus
 * two spaces), the person's note, every annotation in answer order, and the
 * mixed card's platform line. The review-only item list and its two questions
 * are not rendered in the proposal phase.
 *
 * Pure: the exported builder and renderer only, no database, no model.
 */
import { describe, expect, it } from 'vitest';
import {
  renderUnknownCallReviewZh, type UnknownCallReviewInputV1,
} from '../../src/contracts/core/prepared-execution.js';
import type {
  CapturedPathV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import {
  buildUnknownCallReviewInputV1, trimUnknownCallReviewInput,
} from '../../src/core/agent-runtime/context-assembler.js';

const P = 'p';
const G = 'g';
const REVIEW_REF = { aggregateType: 'UnknownCallReview' as const, projectId: P, goalId: G, runId: 'origin' };

function kernel(alias: number, declaredPosition: number) {
  return {
    adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
    callId: `call-${String(alias)}`, declaredPosition, startedPosition: declaredPosition + 1,
  };
}

function processItem(alias: number, toolName: string, command: string, cwd: string | null,
  declaredPosition: number, summaryTruncated = false): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName, kind: 'process', contained: false,
    kernel: kernel(alias, declaredPosition),
    argumentsDigest: 'sha',
    summary: { command, cwd, mode: null, paths: [], pathsOmitted: 0, truncated: summaryTruncated },
    startedAt: `2026-10-16T00:00:0${String(alias)}.000Z`,
    observed: { verdict: 'pending', by: null },
  };
}

function platformItem(alias: number, callId: string, declaredPosition: number): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'send_message', kind: 'platform', contained: false,
    kernel: kernel(alias, declaredPosition),
    argumentsDigest: 'sha',
    summary: { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: `2026-10-16T00:00:0${String(alias)}.000Z`,
    observed: { verdict: 'undetermined', by: 'platform',
      evidence: { kind: 'lookup_failed', reason: 'the record could not be read' } },
  };
}

const CAPTURED: CapturedPathV1[] = [
  { path: 'a.ts', change: 'modified' },
  { path: 'b.ts', change: 'added' },
];

const NOTE = '注'.repeat(2000);
const ANNOTATIONS = [
  { path: 'a.ts', text: '看这里' },
  { path: null, text: '记一笔' },
];

function review(): UnknownCallReviewV1 {
  return {
    ref: REVIEW_REF, schemaVersion: 1, revision: 9, workspaceId: 'w',
    task: { projectId: P, goalId: G, taskId: 't1' },
    runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'origin' },
    sessionRef: { projectId: P, sessionId: 's-origin' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'op' }, reason: 'crashed' },
    inventory: 'complete', inventoryProblem: null,
    items: [
      processItem(1, 'run_readonly_command', 'echo one\n--flag', '/w', 10),
      processItem(2, 'shell', 'echo two', '/w', 10),
      platformItem(3, 'call-3', 20),
    ],
    itemsOmitted: 0,
    workspace: { status: 'captured', runBaselineKnown: true, baseCommit: 'base', headNow: 'head',
      captureRef: { kind: 'artifact', contentType: 'application/json', digest: 'd', sizeBytes: 1,
        source: { kind: 'artifact', refId: 'r', revision: '1' } },
      changedCount: 4, sample: CAPTURED, notVisible: ['secret', '.env'], notVisibleOmitted: 2 },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'awaiting_proposal', open: 'yes', decisionReasons: [],
    dispositionTargets: ['call-1', 'call-2', 'call-3'], proposalTargets: ['call-1', 'call-2'],
    stateEntry: 2, activeRound: null, rounds: [], proposals: [], blockedCommands: [],
    disposition: {
      choice: 'safer_method', source: 'card', targets: ['call-1', 'call-2', 'call-3'],
      answerMessageRef: { aggregateType: 'SessionMessage', projectId: P, workspaceId: 'w', messageId: 'm-1' },
      answeredRevision: 8, appliedBy: { kind: 'human', id: 'op' }, appliedAt: '2026-10-16T00:00:00.000Z',
      text: NOTE, annotations: ANNOTATIONS, approval: null, approvedMethods: null, hold: null,
    },
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

function proposalInput(): UnknownCallReviewInputV1 {
  return buildUnknownCallReviewInputV1({
    review: review(), reviewRef: REVIEW_REF, phase: 'proposal', round: 1,
    // Deliberately out of order: the renderer must sort the target aliases.
    targets: [2, 1], personText: NOTE, annotations: ANNOTATIONS, platformTargets: [3],
  });
}

const WORKSPACE_LINES = [
  '### 工作区采集',
  '状态：captured；基准已知：是',
  '看不见的部分：secret、.env（另有 2 条）',
  '变了的前 200 条：a.ts（modified）、b.ts（added）（另有 2 条）',
  '不在清单里不证明没做。',
].join('\n');

const HEADER = [
  '## Unknown-call review',
  '这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。',
].join('\n');

describe('K3-16 the proposal round input', () => {
  it('K3-16 builds the proposal fields (targets, note, annotations, platform aliases) into the input', () => {
    const input = proposalInput();
    expect(input.phase).toBe('proposal');
    expect(input.targets).toEqual([2, 1]);
    expect(input.personText).toBe(NOTE);
    expect(input.annotations).toEqual(ANNOTATIONS);
    expect(input.platformTargets).toEqual([3]);
  });

  it('K3-16 renders the exact `### 提方案` block in alias order with newline indentation, the 2,000-char note and the mixed line, and not the review questions', () => {
    const expected = [
      HEADER,
      '',
      WORKSPACE_LINES,
      '',
      '### 已经写过的结论',
      '（无）',
      '',
      '### 提方案',
      '- 这一轮只给下面的条目提方案：每条调用一次 propose_safer_method，命令要能原样执行；不要跑原命令。',
      '- #1（run_readonly_command）原命令：echo one\n  --flag',
      '- #2（shell）原命令：echo two',
      `- 附言：${NOTE}`,
      '- 批注（a.ts）：看这里',
      '- 批注（记录）：记一笔',
      '- 平台条目 #3：结果查不清，不提方案；接续说明里写“结果查不清，重做前先核实”。',
    ].join('\n');
    const text = renderUnknownCallReviewZh(proposalInput());
    expect(text).toBe(expected);
    // The review-only questions would ask the model to review, not to propose.
    expect(text).not.toContain('### 要核对的调用');
    expect(text).not.toContain('### 每条要回答两件事');
  });

  it('K3-16 keeps rendering a full Kernel command cut by the 4 KiB display as the cut command, without the summary sentence', () => {
    const full = 'x'.repeat(5000);
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'proposal', round: 1, targets: [1],
      commandFacts: new Map([[1, { command: full, cwd: '/w' }]]),
    });
    const item = input.items.find(entry => entry.alias === 1)!;
    expect(item.display).toBe('truncated');
    expect(item.command?.text).toBe('x'.repeat(4094));
    const text = renderUnknownCallReviewZh(input);
    expect(text).toContain(`- #1（run_readonly_command）原命令：${'x'.repeat(4094)}`);
    expect(text).not.toContain('只是摘要');
  });

  it('K3-16 renders summary.command plus the summary sentence when trimming makes a target item unexpanded', () => {
    let input = proposalInput();
    while (input.items.find(entry => entry.alias === 1)?.display !== 'unexpanded') {
      const next = trimUnknownCallReviewInput(input);
      expect(next).not.toBeNull();
      input = next as UnknownCallReviewInputV1;
    }
    expect(input.items.find(entry => entry.alias === 2)?.display).toBe('unexpanded');
    const text = renderUnknownCallReviewZh(input);
    expect(text).toContain('- #1（run_readonly_command）原命令：echo one\n  --flag（只是摘要：全文太长，没有放进这一轮的说明）');
    expect(text).toContain('- #2（shell）原命令：echo two（只是摘要：全文太长，没有放进这一轮的说明）');
    expect(text).not.toContain('原命令：（无）');
  });

  it('K3-16 renders the record cut as a truncated proposal command without the summary sentence when the Kernel fact is unreadable', () => {
    const cut = 'z'.repeat(512);
    const record = review();
    record.items[0] = processItem(1, 'run_readonly_command', cut, '/w', 10, true);
    const input = buildUnknownCallReviewInputV1({
      review: record, reviewRef: REVIEW_REF, phase: 'proposal', round: 1, targets: [1],
    });
    const item = input.items.find(entry => entry.alias === 1)!;
    expect(item.display).toBe('truncated');
    expect(item.command?.text).toBe(cut);
    const text = renderUnknownCallReviewZh(input);
    expect(text).toContain(`- #1（run_readonly_command）原命令：${cut}`);
    expect(text).not.toContain('只是摘要');
  });

  it('K3-16 renders the review phase of the same record byte-identically to the pre-change output and fills no proposal fields', () => {
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    expect(input.targets).toBeNull();
    expect(input.personText).toBeNull();
    expect(input.annotations).toEqual([]);
    expect(input.platformTargets).toEqual([]);
    // The proposal-only summary field must not widen the review structured bytes.
    expect(input.items.every(item => !('summaryCommand' in item))).toBe(true);
    const expected = [
      HEADER,
      '',
      WORKSPACE_LINES,
      '',
      '### 已经写过的结论',
      '（无）',
      '',
      '### 要核对的调用',
      '- #1 run_readonly_command：命令 echo one\n--flag；cwd /w；开始时间 2026-10-16T00:00:01.000Z；同批调用：#2',
      '- #2 shell：命令 echo two；cwd /w；开始时间 2026-10-16T00:00:02.000Z；同批调用：#1',
      '',
      '### 每条要回答两件事',
      '1. 做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据；',
      '2. 会不会就是 Host 崩溃的原因：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）。',
    ].join('\n');
    expect(renderUnknownCallReviewZh(input)).toBe(expected);
    expect(expected).not.toContain('只是摘要');
  });

  it('K3-16 keeps the review phase of a record whose proposal input has an unexpanded item byte-identical (no summary sentence)', () => {
    let input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    while (input.items.find(entry => entry.alias === 1)?.display !== 'unexpanded') {
      const next = trimUnknownCallReviewInput(input);
      expect(next).not.toBeNull();
      input = next as UnknownCallReviewInputV1;
    }
    expect(input.items.every(item => !('summaryCommand' in item))).toBe(true);
    const text = renderUnknownCallReviewZh(input);
    expect(text).toContain('- #1 run_readonly_command：没展开，按判断不了处理。');
    expect(text).not.toContain('只是摘要');
  });
});
