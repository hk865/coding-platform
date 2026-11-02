/**
 * PL-14 (spec §10.3–§10.5, §13.2): the stage reading and the plan-loop limits.
 *
 * The expected values are the spec's literals: the run sums, the boundary
 * budgets (2,000 lines, 600,000,000 tokens) and the 64-token growth unit
 * (600,000,000 / 64 = 9,375,000). They are never read back from production.
 */
import { describe, expect, it } from 'vitest';
import type { LineReadingV1, RunUsageReadingV1 } from '../../src/contracts/run-activity.js';
import {
  DEFAULT_PLAN_LOOP_LIMITS, GROWTH_UNIT_TOKENS, growthUnitsOf,
} from '../../src/contracts/plan-loop-limits.js';
import { stageOverLine, stageReadingOf } from '../../src/core/work-graph/model/plan-loop-readings.js';

function runUsage(
  tokens: number | null,
  growth: number | null,
  complete = true,
  reason: string | null = null,
): RunUsageReadingV1 {
  return { tokens, complete, growth: { tokens: growth, complete }, reason };
}

function runLines(
  added: number | null,
  deleted: number | null,
  complete = true,
  reason: string | null = null,
): LineReadingV1 {
  return { added, deleted, complete, reason };
}

describe('PL-14 stage readings', () => {
  it('PL-14 a: aggregates two runs on usage, growth and lines', () => {
    const reading = stageReadingOf([{
      estimatedLines: 100,
      readings: [
        { usage: runUsage(100, 20), lines: runLines(3, 1) },
        { usage: runUsage(50, 10), lines: runLines(1, 0) },
      ],
    }]);

    expect(reading.usage.tokens).toBe(150);
    expect(reading.usage.growth.tokens).toBe(30);
    expect(reading.usage.complete).toBe(true);
    expect(reading.usage.growth.complete).toBe(true);
    expect(reading.lines.added).toBe(4);
    expect(reading.lines.deleted).toBe(1);
    expect(reading.lines.complete).toBe(true);
  });

  const unknownAggregation = [
    {
      name: 'mixed: the known sum survives and the aggregate stays incomplete',
      readings: [
        { usage: runUsage(100, 20), lines: runLines(2, 0) },
        { usage: runUsage(null, null, false, 'turn_not_found'), lines: runLines(null, null, false, 'turn_not_found') },
      ],
      tokens: 100, growth: 20, added: 2, deleted: 0, complete: false,
    },
    {
      name: 'all unknown: the aggregate field is null, never zero',
      readings: [
        { usage: runUsage(null, null, false, 'turn_not_found'), lines: runLines(null, null, false, 'turn_not_found') },
      ],
      tokens: null, growth: null, added: null, deleted: null, complete: false,
    },
    {
      name: 'empty: an empty set is the complete zero',
      readings: [],
      tokens: 0, growth: 0, added: 0, deleted: 0, complete: true,
    },
  ];

  it.each(unknownAggregation)('PL-14 b: $name', ({ readings, tokens, growth, added, deleted, complete }) => {
    const reading = stageReadingOf([{ estimatedLines: 10, readings }]);

    expect(reading.usage.tokens).toBe(tokens);
    expect(reading.usage.growth.tokens).toBe(growth);
    expect(reading.usage.complete).toBe(complete);
    expect(reading.usage.reason).toBe(complete ? null : 'turn_not_found');
    expect(reading.lines.added).toBe(added);
    expect(reading.lines.deleted).toBe(deleted);
    expect(reading.lines.complete).toBe(complete);
    expect(reading.lines.reason).toBe(complete ? null : 'turn_not_found');
  });

  it('PL-14 c: an incomplete run sums the known part and stays incomplete', () => {
    const reading = stageReadingOf([{
      estimatedLines: 10,
      readings: [
        { usage: runUsage(100, 20), lines: runLines(2, 0) },
        { usage: runUsage(50, 10, false), lines: runLines(1, 0, false) },
      ],
    }]);

    expect(reading.usage.tokens).toBe(150);
    expect(reading.usage.growth.tokens).toBe(30);
    expect(reading.usage.complete).toBe(false);
    expect(reading.lines.added).toBe(3);
    expect(reading.lines.complete).toBe(false);
  });

  it('PL-14 d: estimatedLines is a sum when every task has one and null when one lacks it', () => {
    const complete = stageReadingOf([
      { estimatedLines: 1_500, readings: [] },
      { estimatedLines: 500, readings: [] },
    ]);
    expect(complete.estimatedLines).toBe(2_000);

    const missing = stageReadingOf([
      { estimatedLines: 1_500, readings: [] },
      { readings: [] },
    ]);
    expect(missing.estimatedLines).toBeNull();
  });

  it('PL-14 e: the stage line is strict and never fires on unknown or incomplete readings', () => {
    expect(stageOverLine(stageReadingOf([{ estimatedLines: 2_000, readings: [] }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(false);
    expect(stageOverLine(stageReadingOf([{ estimatedLines: 2_001, readings: [] }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(true);

    expect(stageOverLine(stageReadingOf([{
      estimatedLines: 0,
      readings: [{ usage: runUsage(600_000_000, 0), lines: runLines(0, 0) }],
    }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(false);
    expect(stageOverLine(stageReadingOf([{
      estimatedLines: 0,
      readings: [{ usage: runUsage(600_000_001, 0), lines: runLines(0, 0) }],
    }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(true);

    expect(stageOverLine(stageReadingOf([{
      readings: [{ usage: runUsage(600_000_001, 0), lines: runLines(1, 0) }],
    }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(false);

    expect(stageOverLine(stageReadingOf([{
      estimatedLines: 1,
      readings: [{ usage: runUsage(150, 20, false), lines: runLines(1, 0) }],
    }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(false);

    // The stage line reads the complete estimated lines and cumulative tokens
    // only; incomplete changed lines do not suppress a real over-line.
    expect(stageOverLine(stageReadingOf([{
      estimatedLines: 2_001,
      readings: [{ usage: runUsage(150, 20), lines: runLines(null, null, false) }],
    }]), DEFAULT_PLAN_LOOP_LIMITS)).toBe(true);
  });
});

describe('PL-14 plan loop limits', () => {
  it('PL-14 f: growth units divide by 64 and the defaults are the spec literals', () => {
    expect(GROWTH_UNIT_TOKENS).toBe(64);
    expect(growthUnitsOf(0)).toBe(0);
    expect(growthUnitsOf(64)).toBe(1);
    expect(growthUnitsOf(600_000_000)).toBe(9_375_000);

    expect(DEFAULT_PLAN_LOOP_LIMITS).toEqual({
      schemaVersion: 1,
      taskReminderTokens: { small: 1_000_000, medium: 2_500_000, large: 4_000_000, explore: 4_000_000 },
      taskTwoTimesTokens: { small: 2_000_000, medium: 5_000_000, large: 8_000_000, explore: 8_000_000 },
      lineMultiplier: 2,
      stageLineBudget: 2_000,
      stageTokenBudget: 600_000_000,
    });
  });
});
