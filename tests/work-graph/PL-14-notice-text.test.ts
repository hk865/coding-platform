/**
 * PL-14 (slice-PL-SPEC §5.8, §10.4–§10.5, §13.2.3): the pure text of one
 * stage-end `plan_notice`.
 *
 * The expected strings carry the six readings literally: the token, growth and
 * line text (unknown/incomplete never written as 0), the completed and replaced
 * task ids, the rework count, the next stage's size classes and the two stage
 * budgets (2,000 lines and 600,000,000 tokens).
 */
import { describe, expect, it } from 'vitest';
import type { PlanLoopLimitsV1 } from '../../src/contracts/plan-loop-limits.js';
import type { StageReadingV1 } from '../../src/core/work-graph/model/plan-loop-readings.js';
import type { StageEndSummaryInputV1 } from '../../src/core/work-graph/views/plan-notices.js';
import { stageEndSummaryOf } from '../../src/core/work-graph/views/plan-notices.js';

const limits: PlanLoopLimitsV1 = {
  schemaVersion: 1,
  taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
  taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
  lineMultiplier: 2,
  stageLineBudget: 2_000,
  stageTokenBudget: 600_000_000,
};

function readingOf(input: {
  tokens: number | null; tokensComplete: boolean;
  growth: number | null; growthComplete: boolean;
  added: number | null; deleted: number | null; linesComplete: boolean;
  estimatedLines: number | null; reason: string | null;
}): StageReadingV1 {
  return {
    usage: {
      tokens: input.tokens,
      complete: input.tokensComplete,
      growth: { tokens: input.growth, complete: input.growthComplete },
      reason: input.reason,
    },
    lines: {
      added: input.added,
      deleted: input.deleted,
      complete: input.linesComplete,
      reason: input.reason,
    },
    estimatedLines: input.estimatedLines,
  };
}

const fullReading = readingOf({
  tokens: 1_500, tokensComplete: true, growth: 300, growthComplete: true,
  added: 4, deleted: 2, linesComplete: true, estimatedLines: 100, reason: null,
});

function inputOf(overrides: Partial<StageEndSummaryInputV1> = {}): StageEndSummaryInputV1 {
  return {
    stageId: 's1',
    reading: fullReading,
    completedTaskIds: ['A', 'B'],
    replacedTaskIds: ['C'],
    reworkCount: 2,
    nextStage: { sizeClasses: ['small', 'medium'] },
    overLine: false,
    limits,
    ...overrides,
  };
}

describe('PL-14 stage-end notice text', () => {
  const rows: { name: string; input: StageEndSummaryInputV1; expected: string }[] = [
    {
      name: 'a all six readings with literals',
      input: inputOf(),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'b an unknown token carries its reason, never 0',
      input: inputOf({
        reading: readingOf({ tokens: null, tokensComplete: false, growth: 300, growthComplete: true,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 10, reason: 'turn_not_found' }),
        completedTaskIds: [], replacedTaskIds: [], reworkCount: 0, nextStage: { sizeClasses: [] },
      }),
      expected: '阶段 s1 结束 · token 未知：turn_not_found · 增长 300 · 行数 6 行 · 已完成 无 · 已替代 无'
        + ' · 返工 0 次 · 下一阶段档位 未分档',
    },
    {
      name: 'c an incomplete token keeps the known part',
      input: inputOf({
        reading: readingOf({ tokens: 100, tokensComplete: false, growth: 300, growthComplete: true,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 10, reason: null }),
      }),
      expected: '阶段 s1 结束 · token 至少 100，不全 · 增长 300 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'd a Run with known tokens and no growth reads 不全 without a reason',
      input: inputOf({
        reading: readingOf({ tokens: 1_500, tokensComplete: true, growth: null, growthComplete: false,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 100, reason: 'turn_not_found' }),
      }),
      expected: '阶段 s1 结束 · token 1500 · 增长 不全 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'd2 an unknown Run reads 未知：<reason> for tokens and growth alike',
      input: inputOf({
        reading: readingOf({ tokens: null, tokensComplete: false, growth: null, growthComplete: false,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 100, reason: 'turn_not_found' }),
      }),
      expected: '阶段 s1 结束 · token 未知：turn_not_found · 增长 未知：turn_not_found · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'e an incomplete growth keeps the known part',
      input: inputOf({
        reading: readingOf({ tokens: 1_500, tokensComplete: true, growth: 100, growthComplete: false,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 100, reason: null }),
      }),
      expected: '阶段 s1 结束 · token 1500 · 增长 至少 100，不全 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'f unknown changed lines carry the reason',
      input: inputOf({
        reading: readingOf({ tokens: 1_500, tokensComplete: true, growth: 300, growthComplete: true,
          added: null, deleted: null, linesComplete: false, estimatedLines: 100, reason: 'turn_not_found' }),
      }),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 未知：turn_not_found · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'g incomplete changed lines keep the known part',
      input: inputOf({
        reading: readingOf({ tokens: 1_500, tokensComplete: true, growth: 300, growthComplete: true,
          added: 4, deleted: 2, linesComplete: false, estimatedLines: 100, reason: null }),
      }),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 至少 6 行，不全 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium',
    },
    {
      name: 'h a next stage without a size class reads 未分档',
      input: inputOf({ nextStage: { sizeClasses: [] } }),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 未分档',
    },
    {
      name: 'h2 a known class and an unclassified placeholder stay in the same tier list',
      input: inputOf({ nextStage: { sizeClasses: ['small', 'unclassified'] } }),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、未分档',
    },
    {
      name: 'i no next stage reads 没有下一阶段',
      input: inputOf({ nextStage: null }),
      expected: '阶段 s1 结束 · token 1500 · 增长 300 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 没有下一阶段',
    },
    {
      name: 'j both stage budgets over append their own numbers',
      input: inputOf({
        reading: readingOf({ tokens: 700_000_000, tokensComplete: true, growth: 1_000, growthComplete: true,
          added: 4, deleted: 2, linesComplete: true, estimatedLines: 3_000, reason: null }),
        overLine: true,
      }),
      expected: '阶段 s1 结束 · token 700000000 · 增长 1000 · 行数 6 行 · 已完成 A、B · 已替代 C'
        + ' · 返工 2 次 · 下一阶段档位 small、medium'
        + ' · 阶段线超线：预估 3000 行 > 2000；累计 token 700000000 > 600000000',
    },
  ];

  it.each(rows)('$name', ({ input, expected }) => {
    expect(stageEndSummaryOf(input)).toBe(expected);
  });
});
