/**
 * K3-16 pure renderer/codec extremes (rework item 4): the combinations the real
 * serial Kernel path cannot reach, tested as input -> output only.
 *
 *   1. the mixed two-process + one-platform proposal display through
 *      `buildUnknownCallReviewInputV1` + `renderUnknownCallReviewZh`;
 *   2. multi-alias approved-method ordering through the pure card summary and
 *      the literal `approvedMethodLinesZh` line format (28 bytes + command + 2
 *      per embedded newline);
 *   3. the 32-item (L7 maximum) structured review input and its full render;
 *   4. a 12-item, `itemsOmitted: 3`, exactly 12,000-byte record through the
 *      record codec (`encodeUnknownCallReview` / `decodeUnknownCallReview`).
 *
 * No record is committed, no store is opened and no Run is started. Every
 * record here is constructed input to a pure function.
 */
import { describe, expect, it } from 'vitest';
import type {
  UnknownCallObservationV1, UnknownCallReviewItemV1, UnknownCallReviewV1,
} from '../../src/contracts/unknown-call-review.js';
import { approvedMethodLinesZh } from '../../src/contracts/continuation-brief.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import { buildUnknownCallReviewInputV1 } from '../../src/core/agent-runtime/context-assembler.js';
import { unknownCallReviewSummary } from '../../src/core/work-graph/tasks/unknown-call-review-card.js';
import {
  decodeUnknownCallReview, encodeUnknownCallReview,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { newUnknownCallReview, transitionUnknownCallReview,
  type UnknownCallReviewContextV1 } from '../../src/core/work-graph/state/unknown-call-review.js';

const PROJECT = 'P';
const GOAL = 'g1';
const WORKSPACE = 'W';
const TASK = 't1';
const AT = '2026-10-17T00:00:00.000Z';
const RUN_REF = { aggregateType: 'Run' as const, projectId: PROJECT, goalId: GOAL, runId: 'run-1234abcd' };

function processItem(alias: number, command: string, callId = `call-${String(alias)}`): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'shell', kind: 'process', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1', callId,
      declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'd'.repeat(64),
    summary: { command, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed: { verdict: 'pending', by: null },
  };
}

function platformItem(
  alias: number, callId = `platform-${String(alias)}`,
  observed: UnknownCallObservationV1 = { verdict: 'undetermined', by: 'platform',
    evidence: { kind: 'lookup_failed', reason: 'the platform lookup could not read the receipt' } },
): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName: 'send_user_message', kind: 'platform', contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 'turn-1', callId,
      declaredPosition: alias, startedPosition: alias },
    argumentsDigest: 'e'.repeat(64),
    summary: { command: null, cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: null, observed,
  };
}

function recordOf(
  items: UnknownCallReviewItemV1[], inventoryProblem: 'kernel_unreadable' | null = null,
  itemsOmitted = 0,
): UnknownCallReviewV1 {
  const built = newUnknownCallReview({
    ref: { aggregateType: 'UnknownCallReview', projectId: PROJECT, goalId: GOAL, runId: RUN_REF.runId },
    workspaceId: WORKSPACE, task: { projectId: PROJECT, goalId: GOAL, taskId: TASK }, runRef: RUN_REF,
    sessionRef: { projectId: PROJECT, sessionId: 's' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'operator' }, reason: 'k3-16 pure' },
    inventory: inventoryProblem === null ? 'complete' : 'incomplete', inventoryProblem,
    items, itemsOmitted,
    workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured',
      detail: 'the pure K3-16 extremes test' },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    createdAt: AT,
  });
  if (!built.ok) throw new Error(JSON.stringify(built));
  return built.next;
}

const utf8BytesOf = (text: string): number => new TextEncoder().encode(text).length;

function transitionContext(
  record: UnknownCallReviewV1, overrides: Partial<UnknownCallReviewContextV1> = {},
): UnknownCallReviewContextV1 {
  return {
    expectedRevision: record.revision, updatedAt: AT, actor: { kind: 'human', id: 'operator' },
    activeRunEnded: false, activeRunCompleted: false, fenceHumanOnly: false, reviewUnavailable: false,
    autonomy: 'every_step', incompleteCommandAliases: [], missingSelfCheckAliases: [], originalRunSelected: true,
    ...overrides,
  };
}

describe('K3-16 pure renderer: mixed proposal display (L18/D7)', () => {
  it('K3-16: two process targets and one undetermined platform target render as two command lines plus the platform line', () => {
    const record = recordOf([
      processItem(1, 'npm run build\nnpm run test'),
      processItem(2, 'pnpm db:migrate', 'call-2'),
      platformItem(3),
    ]);
    const input = buildUnknownCallReviewInputV1({
      review: record, reviewRef: record.ref, phase: 'proposal', round: 1,
      targets: [1, 2], personText: 'use a safer method', platformTargets: [3],
    });
    // Only process items are proposal/structured items; the platform alias is
    // carried by the dedicated `platformTargets` field (D7).
    expect(input.items.map(item => item.alias)).toEqual([1, 2]);
    expect(input.targets).toEqual([1, 2]);
    expect(input.platformTargets).toEqual([3]);
    const rendered = renderUnknownCallReviewZh(input);
    expect(rendered).toContain('- #1（shell）原命令：npm run build\n  npm run test');
    expect(rendered).toContain('- #2（shell）原命令：pnpm db:migrate');
    expect(rendered).toContain('- 平台条目 #3：结果查不清，不提方案；接续说明里写“结果查不清，重做前先核实”。');
    // The review phase lists every process item and no platform item.
    const review = buildUnknownCallReviewInputV1({
      review: record, reviewRef: record.ref, phase: 'review', round: 1,
    });
    expect(review.items.map(item => item.alias)).toEqual([1, 2]);
    expect(review.platformTargets).toEqual([]);
  });
});

describe('K3-16 pure renderer: multi-alias approved-method order (L20)', () => {
  it('K3-16: proposals stored alias-descending render alias-ascending with the literal 28-byte prefix', () => {
    const base = recordOf([processItem(1, 'one'), processItem(2, 'two', 'call-2')]);
    const awaiting: UnknownCallReviewV1 = {
      ...base, status: 'awaiting_approval', proposalTargets: ['call-1', 'call-2'],
      proposals: [
        { proposalId: 'ucr-proposal:2', callId: 'call-2', alias: 2,
          command: 'second', cwd: null, rationale: 'r2', roundRunRef: RUN_REF },
        { proposalId: 'ucr-proposal:1', callId: 'call-1', alias: 1,
          command: 'first', cwd: 'packages/db', rationale: 'r1', roundRunRef: RUN_REF },
      ],
    };
    const summary = unknownCallReviewSummary(awaiting);
    // The stored array is alias 2,1; the rendering is alias-ascending.
    expect(summary).toBe([
      '核对记录 run-1234：需要你决定',
      '- 原命令 #1：one',
      '- 原命令 #2：two',
      '- 方案 #1，目录 packages/db：',
      '  first',
      '- 方案 #2，目录 .：',
      '  second',
    ].join('\n'));

    const lines = approvedMethodLinesZh([
      { alias: 2, command: 'second', cwd: null },
      { alias: 1, command: 'first', cwd: 'packages/db' },
    ]);
    expect(lines).toEqual([
      '- 方案 #2，目录 .：\n  second',
      '- 方案 #1，目录 packages/db：\n  first',
    ]);
    // Literal L20 prefix: `- 方案 #1，目录 .：\n  ` is 28 UTF-8 bytes.
    expect(utf8BytesOf('- 方案 #1，目录 .：\n  ')).toBe(28);
    expect(utf8BytesOf(lines[0]!)).toBe(28 + utf8BytesOf('second'));
  });
});

describe('K3-16 pure renderer: the 32-item L7 maximum', () => {
  it('K3-16: all 32 process items are structured and rendered in Kernel order', () => {
    const items = Array.from({ length: 32 }, (_unused, index) =>
      processItem(index + 1, `echo item-${String(index + 1)}`));
    const record = recordOf(items);
    expect(record.items).toHaveLength(32);
    const input = buildUnknownCallReviewInputV1({
      review: record, reviewRef: record.ref, phase: 'review', round: 1,
    });
    expect(input.items.map(item => item.alias)).toEqual(
      Array.from({ length: 32 }, (_unused, index) => index + 1));
    const rendered = renderUnknownCallReviewZh(input);
    expect(rendered).toContain('- #1 shell：命令 echo item-1');
    expect(rendered).toContain('- #32 shell：命令 echo item-32');
    // Every alias appears exactly once in the item list.
    for (let alias = 1; alias <= 32; alias += 1) {
      expect(rendered.split(`- #${String(alias)} shell：`)).toHaveLength(2);
    }
  });
});

describe('K3-16 pure codec: the 12-item omitted serialization extreme', () => {
  it('K3-16: a 12,000-byte, 12-item/itemsOmitted-3 record round-trips byte-identically', () => {
    const items = Array.from({ length: 12 }, (_unused, index) =>
      processItem(index + 1, `echo item-${String(index + 1)}`));
    const base = recordOf(items, 'kernel_unreadable', 3);
    // Pad one unbounded summary field so the serialized body is EXACTLY 12,000
    // bytes; the pad is constructed input, not a platform fact.
    // Replacing `cwd: null` (4 JSON bytes) with `"…"` (2 quotes + pad) adds
    // `pad - 2` bytes, so the pad length is the deficit plus 2.
    const deficit = 12_000 - utf8BytesOf(JSON.stringify(base)) + 2;
    expect(deficit).toBeGreaterThan(2);
    const padded: UnknownCallReviewV1 = {
      ...base,
      items: base.items.map((item, index) => index === 0
        ? { ...item, summary: { ...item.summary, cwd: 'x'.repeat(deficit) } }
        : item),
    };
    expect(utf8BytesOf(JSON.stringify(padded))).toBe(12_000);
    const encoded = encodeUnknownCallReview(padded);
    expect(encoded.revision).toBe(padded.revision);
    expect(utf8BytesOf(encoded.json)).toBe(12_000);
    const decoded = decodeUnknownCallReview(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(padded);
    expect(decoded.value.items).toHaveLength(12);
    expect(decoded.value.itemsOmitted).toBe(3);
    expect(decoded.value.inventory).toBe('incomplete');
    expect(decoded.value.inventoryProblem).toBe('kernel_unreadable');
  });
});

describe('K3-16 pure card summary: the mixed final hint (F-060)', () => {
  it('K3-16: a mixed set ends with the complete fixed mixed sentence, after the methods when approval is pending', () => {
    const created = recordOf([
      processItem(1, 'npm run build\nnpm run test'),
      processItem(2, 'pnpm db:migrate', 'call-2'),
      platformItem(3),
    ]);
    const settled = transitionUnknownCallReview(created, { kind: 'settled' },
      transitionContext(created, { reviewUnavailable: true }));
    if (!settled.ok) throw new Error(JSON.stringify(settled));
    expect(settled.next.status).toBe('needs_decision');
    expect(settled.next.proposalTargets).toEqual(['call-1', 'call-2']);
    expect(settled.next.dispositionTargets).toEqual(['call-1', 'call-2', 'platform-3']);

    // The frozen sentence, written here by hand (never the production constant).
    const mixed = '选“换个稳妥的跑法再跑”并同意方案以后，查不清的平台条目在接续说明里写“结果查不清，重做前先核实”。';
    expect(unknownCallReviewSummary(settled.next)).toBe(`核对记录 run-1234：需要你决定\n${mixed}`);

    const disposition = transitionUnknownCallReview(settled.next, {
      kind: 'disposition_applied', choice: 'safer_method', answerMessageRef: null,
      answeredRevision: settled.next.revision, text: null,
    }, transitionContext(settled.next));
    if (!disposition.ok) throw new Error(JSON.stringify(disposition));
    const claimed = transitionUnknownCallReview(disposition.next, {
      kind: 'round_claimed', runRef: RUN_REF, phase: 'proposal', round: 1,
    }, transitionContext(disposition.next));
    if (!claimed.ok) throw new Error(JSON.stringify(claimed));

    let current = claimed.next;
    for (const [alias, command, cwd] of [
      [2, 'pnpm db:migrate', 'packages/db'],
      [1, 'npm run build\nnpm run test', null],
    ] as const) {
      const recorded = transitionUnknownCallReview(current, {
        kind: 'proposal_recorded',
        proposal: {
          proposalId: `proposal-${String(alias)}`, callId: `call-${String(alias)}`, alias, command, cwd,
          rationale: `reason ${String(alias)}`, roundRunRef: RUN_REF,
        },
      }, transitionContext(current));
      if (!recorded.ok) throw new Error(JSON.stringify(recorded));
      current = recorded.next;
    }

    const approved = transitionUnknownCallReview(current, { kind: 'settled' },
      transitionContext(current, { activeRunEnded: true, activeRunCompleted: true }));
    if (!approved.ok) throw new Error(JSON.stringify(approved));
    expect(approved.next.status).toBe('awaiting_approval');

    // Complete independent expected text: originals, alias-ordered methods, then
    // the one fixed mixed sentence as the FINAL line.
    const summary = unknownCallReviewSummary(approved.next);
    expect(summary).toBe([
      '核对记录 run-1234：需要你决定',
      '- 原命令 #1：npm run build',
      '  npm run test',
      '- 原命令 #2：pnpm db:migrate',
      '- 方案 #1，目录 .：',
      '  npm run build',
      '  npm run test',
      '- 方案 #2，目录 packages/db：',
      '  pnpm db:migrate',
      mixed,
    ].join('\n'));
    expect(summary.endsWith(`\n${mixed}`)).toBe(true);
  });
});
