/**
 * G-08 (slice-PL-SPEC §6.4.1–§6.4.3): the pure text of one `plan_adoption`
 * notice.
 *
 * Every expected string is the spec's literal: the adoption line, the delta
 * and impact ids, the exact review clause and the taskbook line for each file
 * state. Nothing is read back from production.
 */
import { describe, expect, it } from 'vitest';
import type {
  PlanAdoptionSummaryInputV1, PlanAdoptionDeltaV1,
} from '../../src/core/work-graph/views/plan-adoption-notices.js';
import { planAdoptionSummaryOf } from '../../src/core/work-graph/views/plan-adoption-notices.js';
import type { PlanReviewReadV1 } from '../../src/contracts/plan-review.js';
import type { TaskbookExportReadV1 } from '../../src/contracts/plan-round.js';
import type { ReadResult } from '../../src/contracts/core/results.js';

type ReviewRead = ReadResult<PlanReviewReadV1>;

const pass: ReviewRead = { status: 'ready', value: { status: 'decided', verdict: 'pass', findings: [] } };
const fix: ReviewRead = { status: 'ready', value: { status: 'decided', verdict: 'fix',
  findings: [{ taskId: 'a', text: 'tidy the edge' }] } };
const notSent: ReviewRead = { status: 'ready', value: { status: 'not_sent' } };
const waiting: ReviewRead = { status: 'ready', value: { status: 'waiting' } };
const terminalInvalid: ReviewRead = { status: 'ready', value: { status: 'terminal_invalid', reason: 'bad-answer' } };
const unreadable: ReviewRead = { status: 'rejected', code: 'unavailable', reason: 'query_unreadable' };

const written: TaskbookExportReadV1 = { status: 'ready', stages: [
  { state: 'written', stageId: 's1', path: '/books/s1.md', bytes: 42 },
] };
const missing: TaskbookExportReadV1 = { status: 'ready', stages: [
  { state: 'missing', stageId: 's1', path: '/books/s1.md' },
] };
const incomplete: TaskbookExportReadV1 = { status: 'ready', stages: [
  { state: 'incomplete', stageId: 's1', path: '/books/s1.md', actualBytes: 10, expectedBytes: 20 },
] };
const notConfigured: TaskbookExportReadV1 = { status: 'not_configured' };
const exportUnavailable: TaskbookExportReadV1 = { status: 'unavailable', reason: 'probe_failed' };
const twoStages: TaskbookExportReadV1 = { status: 'ready', stages: [
  { state: 'written', stageId: 's1', path: '/books/s1.md', bytes: 42 },
  { state: 'missing', stageId: 's2', path: '/books/s2.md' },
] };

const supported = (taskIds: readonly string[]): PlanAdoptionDeltaV1 => ({ status: 'supported', taskIds });

function inputOf(overrides: Partial<PlanAdoptionSummaryInputV1> = {}): PlanAdoptionSummaryInputV1 {
  return {
    planRevision: 7,
    delta: supported(['a', 'b']),
    affectedTaskIds: ['a'],
    review: pass,
    exportRead: written,
    ...overrides,
  };
}

describe('G-08 plan adoption notice text', () => {
  const rows: { name: string; input: PlanAdoptionSummaryInputV1; expected: string }[] = [
    {
      name: 'a written taskbook and the pass verdict',
      input: inputOf(),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'b a missing file keeps the adoption and says there is no retry',
      input: inputOf({ exportRead: missing }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass'
        + ' · 任务书 s1 导出失败：未写出（/books/s1.md）；采用不受影响，不自动重试',
    },
    {
      name: 'c an incomplete file names both byte counts',
      input: inputOf({ exportRead: incomplete }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass'
        + ' · 任务书 s1 导出不完整（/books/s1.md，10/20 字节）；采用不受影响',
    },
    {
      name: 'd no settings directory',
      input: inputOf({ exportRead: notConfigured }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass · 任务书未导出：没有设置目录',
    },
    {
      name: 'e an unreadable taskbook state is not "not configured"',
      input: inputOf({ exportRead: exportUnavailable }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass · 任务书状态读不到：probe_failed',
    },
    {
      name: 'f multiple stages join with the full-width semicolon',
      input: inputOf({ exportRead: twoStages }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅 pass'
        + ' · 任务书 s1 已导出（/books/s1.md）；任务书 s2 导出失败：未写出（/books/s2.md）；采用不受影响，不自动重试',
    },
    {
      name: 'g a fix verdict',
      input: inputOf({ review: fix }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅要求返修 · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'h a review never sent',
      input: inputOf({ review: notSent }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 尚未审阅 · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'i a review still waiting',
      input: inputOf({ review: waiting }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅中 · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'j a terminal invalid review carries its reason',
      input: inputOf({ review: terminalInvalid }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅结论无效：bad-answer'
        + ' · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'k an unreadable review is its own clause and the notice stays',
      input: inputOf({ review: unreadable }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 a · 审阅结论读不到：query_unreadable'
        + ' · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'l the impact list is only the declared affected ids, never merged with the delta',
      input: inputOf({ affectedTaskIds: ['z', 'a', 'z'], delta: supported(['a', 'b']) }),
      expected: '已采用 · 计划 v7 · 改 2 个任务（a、b） · 影响 z、a、z · 审阅 pass · 任务书 s1 已导出（/books/s1.md）',
    },
    {
      name: 'n no changed or affected task reads 无',
      input: inputOf({ affectedTaskIds: [], delta: supported([]) }),
      expected: '已采用 · 计划 v7 · 改 0 个任务（无） · 影响 无 · 审阅 pass · 任务书 s1 已导出（/books/s1.md）',
    },
  ];

  it.each(rows)('$name', ({ input, expected }) => {
    expect(planAdoptionSummaryOf(input)).toBe(expected);
  });
});
