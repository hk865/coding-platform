/**
 * K3 L13 review build/render/trim (F-046): the pure `UnknownCallReviewInputV1`
 * builder, the Chinese renderer and the two trim/fit rows.
 *
 * Moved out of `K3-review-preparation.test.ts` (the scenario file keeps its
 * prepare rows over the real preparation/Run): these rows call the exported
 * pure functions directly with built input and assert fixed spec texts. No store,
 * platform, Host, Workflow, Runtime, fixture or stub port is imported (A5);
 * nullable fit results are asserted before their fields are read.
 */
import { describe, expect, it } from 'vitest';
import type { CapturedPathV1, UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  renderUnknownCallReviewZh, type UnknownCallReviewInputV1,
} from '../../src/contracts/core/prepared-execution.js';
import {
  buildUnknownCallReviewInputV1, trimUnknownCallReviewInput,
} from '../../src/core/agent-runtime/context-assembler.js';
import { fitUnknownCallReviewForManifest } from '../../src/core/agent-runtime/execution-preparation.js';

const P = 'p';
const G = 'g';
const REVIEW_REF = { aggregateType: 'UnknownCallReview' as const, projectId: P, goalId: G, runId: 'origin' };

function kernel(alias: number, declaredPosition: number, startedPosition: number | null = declaredPosition + 1) {
  return {
    adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
    callId: `call-${String(alias)}`, declaredPosition, startedPosition,
  };
}

function processItem(alias: number, command: string, cwd: string | null, declaredPosition: number,
  overrides: Partial<UnknownCallReviewItemV1> = {}): UnknownCallReviewItemV1 {
  return {
    alias, callId: `call-${String(alias)}`, toolName: 'run_readonly_command', kind: 'process', contained: false,
    kernel: kernel(alias, declaredPosition),
    argumentsDigest: 'sha',
    summary: { command, cwd, mode: null, paths: [], pathsOmitted: 0, truncated: false },
    startedAt: `2026-10-16T00:00:0${String(alias)}.000Z`,
    observed: { verdict: 'pending', by: null },
    ...overrides,
  };
}

const CAPTURED: CapturedPathV1[] = [
  { path: 'a.ts', change: 'modified' },
  { path: 'b.ts', change: 'added' },
  { path: 'c.ts', change: 'deleted' },
];

function review(overrides: Partial<UnknownCallReviewV1> = {}): UnknownCallReviewV1 {
  return {
    ref: REVIEW_REF, schemaVersion: 1, revision: 7, workspaceId: 'w',
    task: { projectId: P, goalId: G, taskId: 't1' }, runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'origin' },
    sessionRef: { projectId: P, sessionId: 's-origin' },
    origin: { kind: 'human_attested', attestedBy: { kind: 'human', id: 'op' }, reason: 'crashed' },
    inventory: 'complete', inventoryProblem: null,
    items: [
      processItem(1, 'echo one', '/w', 10),
      processItem(2, 'echo two', '/w', 10),
      processItem(3, 'echo three', '/w', 20, {
        observed: { verdict: 'done', by: 'review_round', evidence: 'saw it finish', roundRunRef: null,
          crashSuspicion: { verdict: 'unlikely', evidence: 'clean' }, reviewerConclusion: null },
      }),
    ],
    itemsOmitted: 0,
    workspace: { status: 'captured', runBaselineKnown: true, baseCommit: 'base', headNow: 'head',
      captureRef: { kind: 'artifact', contentType: 'application/json', digest: 'd', sizeBytes: 1,
        source: { kind: 'artifact', refId: 'r', revision: '1' } },
      changedCount: 5, sample: CAPTURED, notVisible: ['secret', '.env'], notVisibleOmitted: 2 },
    streak: { priorAutoCleanup: false, priorUnknownProcess: false, resetRunRef: null },
    status: 'pending_review', open: 'yes', decisionReasons: [],
    dispositionTargets: null, proposalTargets: null, stateEntry: 1,
    activeRound: { runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'round-1' }, phase: 'review',
      round: 1, stateEntry: 1, startedRevision: 7 },
    rounds: [], proposals: [], blockedCommands: [], disposition: null,
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('K3 L13 review instruction (pure)', () => {
  it('K3-L13-1 builds process items by alias without a Kernel callId', () => {
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    expect(input.reviewRef).toEqual({ aggregateType: 'UnknownCallReview', projectId: 'p', goalId: 'g', runId: 'origin' });
    expect(input.revision).toBe(7);
    expect(input.phase).toBe('review');
    expect(input.round).toBe(1);
    expect(input.targets).toBeNull();
    expect(input.personText).toBeNull();
    // Only the three process items, in Kernel order, by alias.
    expect(input.items.map(item => item.alias)).toEqual([1, 2, 3]);
    // D8: no Kernel callId anywhere in the structured items.
    expect(JSON.stringify(input)).not.toContain('call-');
    expect(input.items[0]).toMatchObject({
      alias: 1, toolName: 'run_readonly_command', display: 'full', cwd: '/w',
      startedAt: '2026-10-16T00:00:01.000Z', sameBatch: [2], current: null,
    });
    expect(input.items[2]!.sameBatch).toEqual([]);
    // The written conclusion is carried as `current`.
    expect(input.items[2]!.current).toMatchObject({ verdict: 'done', by: 'review_round', evidence: 'saw it finish' });
    expect(input.workspace).toEqual({
      status: 'captured', runBaselineKnown: true, notVisible: ['secret', '.env'], notVisibleOmitted: 2,
      changedSample: [
        { path: 'a.ts', change: 'modified' },
        { path: 'b.ts', change: 'added' },
        { path: 'c.ts', change: 'deleted' },
      ],
      changedOmitted: 2,
    });
  });

  it('K3-L13-2 marks a command whose command+cwd exceeds 4 KiB as truncated', () => {
    const long = 'x'.repeat(5000);
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
      commandFacts: new Map([[1, { command: long, cwd: '/w' }]]),
    });
    const first = input.items[0]!;
    const command = first.command;
    expect(command).not.toBeNull();
    if (command === null) throw new Error('the first item has no command');
    expect(first.display).toBe('truncated');
    expect(command.truncated).toBe(true);
    expect(Buffer.byteLength(command.text, 'utf8') + Buffer.byteLength('/w', 'utf8')).toBeLessThanOrEqual(4096);
    // The other items keep the full command.
    expect(input.items[1]).toMatchObject({ display: 'full', command: { text: 'echo two', truncated: false } });
  });

  it('K3-L13-3 renders the two questions and the workspace caution', () => {
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    const text = renderUnknownCallReviewZh(input);
    expect(text).toContain('这一轮只核对，不做任务，不改工作区；不许重跑下面的命令。');
    expect(text).toContain('不在清单里不证明没做。');
    expect(text).toContain('做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据');
    expect(text).toContain('会不会就是 Host 崩溃的原因：不太可能 / 可能 / 判断不了，附依据（命令本身、留下的痕迹）');
    expect(text).toContain('- #1 run_readonly_command');
    expect(text).toContain('同批调用：#2');
    expect(text).toContain('已经写过的结论');
    expect(text).toContain('saw it finish');
  });

  it('K3-L13-4 trims the changed sample, then notVisible, then items from the back', () => {
    let current: UnknownCallReviewInputV1 | null = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    const seen: string[] = [];
    while (current !== null) {
      seen.push(`${String(current.workspace.changedSample.length)}/${String(current.workspace.changedOmitted)}`
        + `-${String(current.workspace.notVisible.length)}/${String(current.workspace.notVisibleOmitted)}`
        + `-${current.items.map(item => item.display[0]).join('')}`);
      current = trimUnknownCallReviewInput(current);
    }
    expect(seen).toEqual([
      '3/2-2/2-fff',
      '2/3-2/2-fff',
      '1/4-2/2-fff',
      '0/5-2/2-fff',
      '0/5-1/3-fff',
      '0/5-0/4-fff',
      '0/5-0/4-ffu',
      '0/5-0/4-fuu',
      '0/5-0/4-uuu',
    ]);
    // The floor is null: nothing left to trim, every item keeps alias + tool.
    expect(current).toBeNull();
  });

  it('K3-L13-8 cuts a cwd longer than 4 KiB so command+cwd fit the per-command budget', () => {
    const longCwd = '中'.repeat(3000); // 9000 UTF-8 bytes
    const input = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
      commandFacts: new Map([[1, { command: 'echo hi', cwd: longCwd }]]),
    });
    const first = input.items[0]!;
    expect(first.display).toBe('truncated');
    expect(first.cwd).not.toBeNull();
    expect(first.command).not.toBeNull();
    if (first.cwd === null || first.command === null) throw new Error('the truncated command/cwd is missing');
    const cwdBytes = Buffer.byteLength(first.cwd, 'utf8');
    const commandBytes = Buffer.byteLength(first.command.text, 'utf8');
    expect(cwdBytes).toBeLessThanOrEqual(4096);
    expect(commandBytes + cwdBytes).toBeLessThanOrEqual(4096);
  });

  it('K3-L13-6 trims the instruction to fit the manifest and reports capacity only at the floor', () => {
    const initial = buildUnknownCallReviewInputV1({
      review: review(), reviewRef: REVIEW_REF, phase: 'review', round: 1,
    });
    const render = (candidate: UnknownCallReviewInputV1): string => JSON.stringify(candidate);
    const size = (candidate: UnknownCallReviewInputV1): number => render(candidate).length;
    const oneTrim = fitUnknownCallReviewForManifest({ review: initial, render, measure: candidate => size(candidate),
      instructionMaxBytes: size(initial) - 1, manifestMaxBytes: Number.MAX_SAFE_INTEGER });
    expect(oneTrim.ok).toBe(true);
    if (!oneTrim.ok) throw new Error(`the one-step fit failed: ${oneTrim.reason}`);
    expect(oneTrim.review.workspace.changedSample).toHaveLength(2);
    expect(oneTrim.review.workspace.changedOmitted).toBe(3);
    const floor = fitUnknownCallReviewForManifest({ review: initial, render, measure: candidate => size(candidate),
      instructionMaxBytes: 1, manifestMaxBytes: Number.MAX_SAFE_INTEGER });
    expect(floor.ok).toBe(true);
    if (!floor.ok) throw new Error(`the floor fit failed: ${floor.reason}`);
    expect(floor.review.workspace.notVisible).toEqual([]);
    expect(floor.review.items.every(item => item.display === 'unexpanded')).toBe(true);
    const overflow = fitUnknownCallReviewForManifest({ review: initial, render,
      measure: () => Number.MAX_SAFE_INTEGER, instructionMaxBytes: 1, manifestMaxBytes: 100 });
    expect(overflow).toEqual({ ok: false, reason: 'capacity' });
  });
});
