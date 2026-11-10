/**
 * DEXC-09 (`exc-tests.frozen.md` §2; R-13), a pure table, hand-computed: `map` is 1 round, `split` 1 + (depth − 1)·N₁.
 * The state module is loaded by path, so a tree without it reds on the rows, not on the import.
 */
import { describe, expect, it } from 'vitest';

type Planned = (input: { depth: 1 | 2 | 3; route: 'map' | 'split'; topLevelModuleCount: number }) => number;
const STATE = '../../src/core/work-graph/state/exploration-control.js';

describe('DEXC-09: plannedExplorationRounds', () => {
  it.each([[1, 'split', 3, 1], [2, 'split', 3, 4], [3, 'split', 3, 7], [2, 'map', 3, 1], [3, 'split', 0, 1]] as const)(
    'depth %i, route %s, N₁ %i → %i rounds', async (depth, route, topLevelModuleCount, rounds) => {
      const state = await import(/* @vite-ignore */ STATE).catch(() => ({})) as { plannedExplorationRounds?: Planned };
      expect(state.plannedExplorationRounds?.({ depth, route, topLevelModuleCount })).toBe(rounds);
    });
});
