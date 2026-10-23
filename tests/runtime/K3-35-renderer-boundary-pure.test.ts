/**
 * K3 group 4 session B3, K3-35 — the PURE renderer contract boundary.
 *
 * Public steps cannot produce a 16-digit `itemsOmitted` (the 512 KiB record
 * admission bounds the inventory long before that), and cannot put 8 rendered
 * anchors plus 10 omitted anchors on one Task (the archive path records only
 * the real interrupted Runs), so both unreachable extremes are pinned here on
 * pure brief values: no store, no state machine, no owner, no test helper. The
 * 32-item review extreme also stays here: the public path reaches exactly the
 * one blocked `shell` call.
 *
 * Every expected line and byte below is hand-derived from the literal input
 * values and L20's table; the renderer is never the source of an expectation.
 */
import { describe, expect, it } from 'vitest';
import type {
  ContinuationAnomalySectionV1, ContinuationBriefV1, ContinuationUnknownCallReviewItemV1,
  ContinuationUnknownCallReviewV1,
} from '../../src/contracts/continuation-brief.js';
import {
  ContinuationBriefCapacityError, continuationBriefDigest, renderContinuationBriefZh,
} from '../../src/contracts/continuation-brief.js';
import { APPROVED_COMMAND, sha } from '../helpers/K3-continuation-pure-fixture.js';

const P = 'k3r-project';
const G = 'k3r-goal';
/** 16 digits, still an exactly representable safe integer (2^53 - 1). */
const SIXTEEN_DIGITS = 9_007_199_254_740_991;
const SENTENCE = '- 平台拦下原命令；要再跑先请求并得到允许。';
const NOT_LISTED = '- 不在变动清单里，不证明没做。';
const HEADING = '### 被拦的命令';
const ANOMALY_TITLE = '### 异常锚点';
const REVIEW_TITLE = '### 结果未知的调用：核对和处置';
const ANOMALY_LAST = '这些改动在工作区里，没撤销，也没核对；先看清它们再接着做。';
const OMITTED_LINE = '- 另有 10 条异常锚点没有装入本说明。';
const MIXED_OWNERSHIP = '工作区里还没提交的改动，可能混有别的执行的改动，不一定是这次执行改的';
const TAIL = [
  '', '### 继续之前',
  '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
  '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
  '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。',
];
/** 249 + T first anchor line, 238 changed-files line, 118 mixed-ownership line, 16 title, 87 last. */
const MANDATORY_512 = 15_635;
const MANDATORY_606 = 16_387;

/** The constructed base brief: input, not a platform record. */
const BASE_BRIEF: ContinuationBriefV1 = {
  schemaVersion: 1,
  runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-2' },
  task: { projectId: P, goalId: G, taskId: 'k3r-task' },
  requeueRef: { aggregateType: 'TaskRequeue', projectId: P, goalId: G, taskId: 'k3r-task', afterRunId: 'run-1' },
  mode: 'rework', failureClass: 'check_failed',
  trigger: { actorClass: 'system', goalResume: false, requeueNumber: 1,
    autoRework: { count: 1, cap: 3 }, earlierRequeues: [] },
  previous: {
    runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-1' },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: P, goalId: G, taskId: 'k3r-task',
      attemptId: 'run-1-attempt' },
    sessionRef: { projectId: P, sessionId: 'session-1' },
    outcome: 'completed', origin: 'observed', interruption: null, cancelledBy: null,
    error: null, limit: null, budget: null, wait: null, unacceptedSteers: [],
    endedAt: '2026-10-07T10:05:00.000Z',
  },
  factsFrom: { runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'run-1' },
    hops: 0, truncated: false },
  stoppedAt: { kernel: 'unavailable', reason: 'the Kernel store is not registered', turnStatus: null,
    lastPosition: null, lastToolGroup: null, lastAssistant: null, window: null },
  toolCalls: { confirmed: [], notExecuted: [], unknown: [],
    confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 },
  acceptedInputs: { steers: [], steersOmitted: 0, messages: [], messagesOmitted: 0 },
  checks: null,
  requeue: { reason: { text: 'auto-rework:check_failed#1', truncated: false },
    reasonAuthor: 'system', newInputs: [] },
  workspace: {
    selfChanged: { status: 'unavailable', confirmed: [], possible: [], omitted: 0 },
    checkpoints: [
      { kind: 'requeue', at: '2026-10-07T10:06:00.000Z', workspaceRevision: 3,
        sourceDigest: sha('1'), unavailableReason: null },
      { kind: 'brief', at: '2026-10-07T10:07:00.000Z', workspaceRevision: 3,
        sourceDigest: sha('1'), unavailableReason: null },
    ],
    segments: [{ from: 0, to: 1, verdict: 'unchanged', reason: 'the workspace source digest is identical' }],
    unobserved: { from: 'previous_run_end', to: 0, previousEndedAt: '2026-10-07T10:05:00.000Z' },
    uncommitted: { status: 'not_git', baseCommit: null, paths: [], omitted: 0, reason: null },
  },
  session: { continuity: 'same_session_without_previous_turn', sessionRef: { projectId: P, sessionId: 'session-1' },
    seededFrom: null, boundaryPosition: null },
  standingInstructionVersion: 1,
};

/** One codec-legal review item; `callId` is a constructed input. */
function item(alias: number, callId = `call-${String(alias)}`): ContinuationUnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'shell', kind: 'process',
    summary: { text: '', truncated: false }, verdict: 'done', evidence: null, crashSuspicion: null,
    reviewerConclusion: null, files: [],
  };
}

function section(itemsOmitted: number, withBlocked = false): ContinuationUnknownCallReviewV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: P, goalId: G, runId: 'run-1' },
    revision: 1, origin: 'takeover_unresolved', inventory: 'complete', items: [item(1)], itemsOmitted,
    disposition: null,
    workspace: { status: 'unavailable', runBaselineKnown: false, notVisible: [], changedSample: [], changedOmitted: 0 },
    ...(withBlocked ? { blockedCommands: [{ alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') }] } : {}),
  };
}

function briefWith(itemsOmitted: number, withBlocked = false): ContinuationBriefV1 {
  return { ...BASE_BRIEF, unknownCallReview: section(itemsOmitted, withBlocked) };
}

function rendered(itemsOmitted: number, withBlocked = false): string {
  const brief = briefWith(itemsOmitted, withBlocked);
  return renderContinuationBriefZh(brief, continuationBriefDigest(brief));
}

/** The 32-item review extreme: 32 real L7 callIds, one 5,120-byte method block. */
function heavySection(): ContinuationUnknownCallReviewV1 {
  const aliases = Array.from({ length: 32 }, (_, index) => index + 1);
  return {
    ...section(0),
    items: aliases.map(alias => ({ ...item(alias, `k335-callid-${String(alias).padStart(2, '0')}-`.padEnd(512, 'q')),
      // One optional excerpt line over the T = 512 slack: the renderer must drop
      // every optional review line, so no Kernel callId reaches the output.
      files: [{ path: 'src/a.ts', mode: 'replace', change: 'modified', oldText: { text: 'x'.repeat(1_000), truncated: true }, newText: null, diff: null, diffOmittedReason: null }] })),
    blockedCommands: [{ alias: 1, reviewRunId: 'run-1', commandSha256: sha('a') }],
    disposition: {
      choice: 'safer_method', source: 'card',
      text: { text: `${'稳'.repeat(60)}…（已截断）`, truncated: true },
      targets: aliases, platformTargets: aliases.slice(1),
      approvedMethods: [{ alias: 1, command: APPROVED_COMMAND, cwd: null }],
      annotations: [],
    },
  };
}

/** 8 anchors of a T-byte Task, each with its own Run, plus 10 omitted anchors. */
function heavyAnomalies(taskIdBytes: number): ContinuationAnomalySectionV1 {
  const taskTriple = { projectId: P, goalId: G, taskId: 't'.repeat(taskIdBytes) };
  const anchors = Array.from({ length: 8 }, (_, index) => ({
    ref: { aggregateType: 'SessionAnomalyAnchor' as const, projectId: P, goalId: G,
      runId: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}` },
    revision: 1 as const, schemaVersion: 1 as const, workspaceId: 'W', task: taskTriple,
    planRef: { aggregateType: 'PlanRevision' as const, projectId: P, planId: 'plan-1' },
    lineHead: { projectId: P, sessionId: `session-${'a'.repeat(63)}${String(index)}` },
    sessionRef: { projectId: P, sessionId: `session-${'a'.repeat(63)}${String(index)}` },
    role: { kind: 'role_spec' as const, pin: { ref: { aggregateType: 'RoleSpecRevision' as const, projectId: P,
      roleId: 'worker', revision: 1 }, digest: sha('r') } },
    runRef: { aggregateType: 'Run' as const, projectId: P, goalId: G,
      runId: `00000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}` },
    attemptRef: { aggregateType: 'TaskAttempt' as const, projectId: P, goalId: G, taskId: taskTriple.taskId,
      attemptId: `attempt-${String(index)}` },
    cause: 'archive_interrupted' as const, archiveRequestId: `archive-${String(index)}`,
    archiveRequestReceipt: { identityKey: `archive-identity-${String(index)}`, fingerprint: sha('f') },
    archivedBy: { kind: 'human' as const, id: 'operator' },
    recordedAt: `2026-10-07T10:${String(8 + index).padStart(2, '0')}:00.000Z`,
    // The L20 worst case: an unavailable capture with the worktree source (the
    // 118-byte warning) and a reason over 60 UTF-16 units, clipped to 60+`…（已截断）`.
    changedFiles: { source: 'worktree' as const, status: 'unavailable' as const, confirmed: [], possible: [], omitted: 0,
      baseCommit: null, runBaselineKnown: false as const, reason: '归'.repeat(64) },
    resultVerification: 'not_checked' as const,
  }));
  return { anchors, omitted: 10, instructionVersion: 1 };
}

function heavyBrief(taskIdBytes: number): ContinuationBriefV1 {
  return {
    ...BASE_BRIEF,
    anomalies: heavyAnomalies(taskIdBytes),
    task: { projectId: P, goalId: G, taskId: 't'.repeat(taskIdBytes) },
    unknownCallReview: heavySection(),
    blockedCommands: [{ alias: 1, reviewRunId: 'run-1', requestState: null, declaredForms: [] }],
  };
}

/** `#from、#from+1、…#to` (the literal targets/platform spelling). */
function aliases(from: number, to: number): string {
  return Array.from({ length: to - from + 1 }, (_, index) => `#${String(from + index)}`).join('、');
}

/** The eight anchor lines, written from the literal anchor values. */
function anchorLines(taskIdBytes: number): string[] {
  const clipped = `${'归'.repeat(60)}…（已截断）`;
  const lines: string[] = [ANOMALY_TITLE];
  for (const anchor of heavyAnomalies(taskIdBytes).anchors) {
    lines.push(`- 锚点执行 ${anchor.runRef.runId}（Session ${anchor.sessionRef.sessionId}，任务 ${anchor.task.taskId}）：`
      + `原因：归档中断了这次执行，记录时间：${anchor.recordedAt}，结果没核对。`);
    lines.push(`  - 改动的文件无法确定（${clipped}）。`);
    lines.push(`  - 注意：${MIXED_OWNERSHIP}。`);
  }
  lines.push(OMITTED_LINE);
  lines.push(ANOMALY_LAST);
  return lines;
}

/** The optional lines that fit at the 60-char cap: conclusions #1-#3, files for #1-#3, excerpts for #1-#2. */
function optionalLines(): string[] {
  const lines: string[] = [];
  heavySection().items.slice(0, 3).forEach((entry, index) => {
    lines.push(`- #${String(index + 1)} = ${entry.callId.slice(0, 60)}…（已截断）（shell）：已做`);
    lines.push('  - 文件 src/a.ts（替换）：有改动。');
    if (index < 2) lines.push(`    - 旧摘录：${'x'.repeat(60)}…（已截断）`);
  });
  return lines;
}

/** L20's mandatory review lines: 43 + 128 + 314 + 200 + 5,120 + 232 + 44 + 62 = 6,143. */
function reviewLines(items: number): string[] {
  return [
    REVIEW_TITLE,
    `- 共 ${String(items)} 条（#1–#${String(items)}），另有 0 条没有列出；各条的结论和依据见上文“核对结论”，可能被略去。`,
    ...optionalLines(),
    `- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）；附言：${'稳'.repeat(60)}…（已截断）。`,
    `- 作用对象：${aliases(1, items)}。`,
    `- 方案 #1，目录 .：\n  ${APPROVED_COMMAND.replace(/\r\n|\n/g, '\n  ')}`,
    `- 平台条目 ${aliases(2, items)}：结果查不清，重做前先核实。`,
    NOT_LISTED,
    SENTENCE,
  ];
}

const utf8Bytes = (lines: readonly string[]): number =>
  lines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8'), 0) + lines.length - 1;

describe('K3-35: the pure renderer bounds the 16-digit omitted counter', () => {
  it('renders the L20 count line with a 16-digit omitted count and exactly 15 more bytes than 0', () => {
    const text = rendered(SIXTEEN_DIGITS);
    const line = text.split('\n').find(candidate => candidate.startsWith('- 共 '))!;
    expect(line).toBe('- 共 1 条（#1–#1），另有 9007199254740991 条没有列出；'
      + '各条的结论和依据见上文“核对结论”，可能被略去。');
    // L20's table counts 143 bytes for "条目数 2 位、略去数 16 位"; with a
    // one-digit item count the count appears twice (`共 1`, `#1–#1`), so the
    // same line is 141 bytes.
    expect(Buffer.byteLength(line, 'utf8')).toBe(141);
    expect(String(SIXTEEN_DIGITS)).toHaveLength(16);
    expect(Buffer.byteLength(rendered(SIXTEEN_DIGITS), 'utf8')
      - Buffer.byteLength(rendered(0), 'utf8')).toBe(15);
    expect(rendered(0)).toContain('另有 0 条没有列出');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16_384);
  });

  it('adds the 62-byte required sentence (plus its newline) only when the record blocked a command', () => {
    const before = rendered(0, false);
    const after = rendered(0, true);
    expect(after).toContain(`${NOT_LISTED}\n${SENTENCE}`);
    expect(after).not.toContain(HEADING);
    // The only new bytes are the sentence and the join before it.
    expect(Buffer.byteLength(after, 'utf8') - Buffer.byteLength(before, 'utf8')).toBe(63);
  });
});

describe('K3-35: the whole L20 extreme renders verbatim on pure input', () => {
  it('renders the eight anchors with long reasons, the 51-byte omitted line and the complete text', () => {
    const brief = heavyBrief(512);
    expect(brief.anomalies!.anchors).toHaveLength(8);
    expect(new Set(brief.anomalies!.anchors.map(anchor => anchor.runRef.runId)).size).toBe(8);
    expect(brief.anomalies!.anchors.every(anchor => anchor.task.taskId === 't'.repeat(512))).toBe(true);
    expect(brief.anomalies!.omitted).toBe(10);
    expect('归'.repeat(64).length).toBeGreaterThan(60);
    const text = renderContinuationBriefZh(brief, continuationBriefDigest(brief));
    const expected = [
      '## 接续说明',
      `[continuation-brief v1 sha256:${continuationBriefDigest(brief)}]`,
      '',
      ...anchorLines(512),
      '',
      ...reviewLines(32),
      ...TAIL,
    ];
    // Complete output, not a substring or a review-block extract.
    expect(text).toBe(expected.join('\n'));
    // Hand total of the complete output: mandatory 15,635 + the 51-byte
    // omitted-anchor line and its join = 15,687, plus the optional lines that
    // fit at the 60-char cap.
    expect(Buffer.byteLength(text, 'utf8')).toBe(15_687 + utf8Bytes(optionalLines()) + 1);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16_384);
    // D8 on the WHOLE output: no Kernel callId, and no review conclusion line.
    for (const callId of heavySection().items.map(entry => entry.callId)) {
      expect(text).not.toContain(callId);
    }
    expect(text).not.toContain(heavySection().items[3]!.callId);
  });

  it('T = 512 fits under 16 KiB; T = 606 refuses capacity with the mandatory part 3 bytes over', () => {
    const under = heavyBrief(512);
    const text = renderContinuationBriefZh(under, continuationBriefDigest(under));
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(text).not.toContain(HEADING);
    expect(text).toContain(SENTENCE);
    expect(text).not.toContain('- 另有 1 条被拦的命令');

    // L20 hand arithmetic: head 110 + anomaly 16 + 8 × (249 + T + 238 + 118)
    // + last sentence 87 + review 6,143 + tail 301 + 42 joins.
    expect(MANDATORY_512).toBe(110 + 16 + 8 * (249 + 512 + 238 + 118) + 87 + 6_143 + 301 + 42);
    expect(MANDATORY_606 - MANDATORY_512).toBe(8 * (606 - 512));
    expect(MANDATORY_606 - MANDATORY_512).toBe(752);
    expect(MANDATORY_606 - 16_384).toBe(3);
    // The same complete lines without the 51-byte omitted line and its join.
    const mandatoryLines = [
      '## 接续说明',
      `[continuation-brief v1 sha256:${continuationBriefDigest(under)}]`,
      '',
      ...anchorLines(512),
      '',
      ...reviewLines(32),
      ...TAIL,
    ].filter(line => line !== OMITTED_LINE && !line.startsWith('- #')
      && !line.startsWith('  - 文件') && !line.startsWith('    - 旧摘录'));
    expect(utf8Bytes(mandatoryLines)).toBe(15_635);

    const over = heavyBrief(606);
    expect(() => renderContinuationBriefZh(over, continuationBriefDigest(over)))
      .toThrow(ContinuationBriefCapacityError);
  });
});
