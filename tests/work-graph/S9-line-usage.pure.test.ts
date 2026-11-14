/**
 * S9 G7 M2/M3/M5 — pure line-usage rules (draft §2.1/§3; lead `next1113c-lead-rulings.md:163-165`).
 * M2 newest reported sample (gen2/r2/600000, complete:false); M3 equal-generation new head (h2/100000,
 * complete:true); M5 frequency (insufficient below 10; often iff over*4 >= observed).
 * Today all red: `activity-read-model.js` exports no `latestSampledRoundOf`/`frequencyVerdictOf` (G7 not
 * landed); green when it does. Mutations: max/unknown-as-0 (M2); sum/older round (M3); one-round, `>`,
 * single threshold (M5).
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore -- activity-read-model.js does not export these yet; red at collection until G7 lands.
import { frequencyVerdictOf, latestSampledRoundOf } from '../../src/core/work-graph/views/activity-read-model.js';
import { overCompactionTriggerOf, p50p95Of } from '../../scripts/measure/line-usage.mjs';

describe('S9 M2 latestSampledRoundOf picks the newest reported sample', () => {
  it('M2-pick: generation 2 wins over the older 700000 and the newer unknown round', () => {
    // Named mutations: scanning all requests and taking the maximum gives 700000; treating unknown
    // as 0 and taking the last gives 0; counting the unknown round as sampled/observed gives gen 3.
    expect(latestSampledRoundOf([
      { sessionGeneration: 1, requests: [{ requestId: 'r1', inputTokens: 700000,
        cachedInputTokens: 0, usageStatus: 'reported' }] },
      { sessionGeneration: 2, requests: [{ requestId: 'r2', inputTokens: 600000,
        cachedInputTokens: 60000, usageStatus: 'reported' }] },
      { sessionGeneration: 3, requests: [{ requestId: 'r3', inputTokens: null,
        cachedInputTokens: null, usageStatus: 'unknown' }] },
    ])).toEqual({
      sessionGeneration: 2, requestId: 'r2', inputTokens: 600000,
      cachedInputTokens: 60000, usageStatus: 'reported', complete: false,
    });
  });
});

describe('S9 M3 latestSampledRoundOf takes the new head round, never the sum', () => {
  it('M3-handoff: the newer same-generation round is 100000, not the summed 140000', () => {
    // Named mutations: summing the two rounds gives 140000; taking the older round gives 40000.
    expect(latestSampledRoundOf([
      { sessionGeneration: 2, requests: [{ requestId: 'h2', inputTokens: 100000,
        cachedInputTokens: 20000, usageStatus: 'reported' }] },
      { sessionGeneration: 2, requests: [{ requestId: 'h1', inputTokens: 40000,
        cachedInputTokens: 10000, usageStatus: 'reported' }] },
    ])).toEqual({
      sessionGeneration: 2, requestId: 'h2', inputTokens: 100000,
      cachedInputTokens: 20000, usageStatus: 'reported', complete: true,
    });
  });
});

describe('S9 M5 frequencyVerdictOf reads frequency, not one round or one threshold', () => {
  // Named mutations: concluding from one round never yields `insufficient`; `>` instead of `>=`
  // turns the 25% boundary rows into `not_often`; a single 500K threshold ignores these counts.
  it.each([
    { observed: 0, over: 0, verdict: 'insufficient' },
    { observed: 9, over: 9, verdict: 'insufficient' },
    { observed: 10, over: 2, verdict: 'not_often' },
    { observed: 10, over: 3, verdict: 'often' },
    { observed: 12, over: 3, verdict: 'often' },
    { observed: 11, over: 2, verdict: 'not_often' },
    { observed: 11, over: 3, verdict: 'often' },
  ])('M5-frequency: ($observed, $over) is $verdict', ({ observed, over, verdict }) => {
    expect(frequencyVerdictOf(observed, over)).toBe(verdict);
  });
});

describe('S9 p50/p95 and over-compaction trigger (script pure exports)', () => {
  it('p50p95 of 10..100 is nearest rank 50/100, not floor 50/90', () => {
    // Mutation: `Math.ceil` → `Math.floor` in the script's `nearestRank` gives p95 90.
    expect(p50p95Of([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({ p50: 50, p95: 100, n: 10, verdict: 'ok' });
  });

  // Mutation: deleting `turns === 0` makes the 0-turn entry `1 / 0 = Infinity`.
  it.each([
    { compacted: 3, turns: 10, expected: 0.3 },
    { compacted: 1, turns: 0, expected: null },
  ])('overCompactionTriggerOf($compacted, $turns) is $expected', ({ compacted, turns, expected }) => {
    expect(overCompactionTriggerOf(compacted, turns)).toBe(expected);
  });
});
