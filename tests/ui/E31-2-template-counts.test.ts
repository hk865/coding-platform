import { describe, expect, it } from 'vitest';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';

/** §1.5's per-board template counts, copied from the frozen wiring table. */
const EXPECTED = {
  ArchOverview: { scIf: 31, scFor: 23, holes: 252, events: 41 },
  Chain: { scIf: 116, scFor: 26, holes: 590, events: 76 },
  Decide: { scIf: 191, scFor: 53, holes: 1066, events: 189 },
  Done: { scIf: 212, scFor: 57, holes: 1173, events: 203 },
  Goals: { scIf: 76, scFor: 29, holes: 476, events: 88 },
  Main: { scIf: 267, scFor: 73, holes: 1402, events: 231 },
  Member: { scIf: 161, scFor: 38, holes: 837, events: 126 },
  Phone: { scIf: 68, scFor: 22, holes: 362, events: 56 },
  Plan: { scIf: 225, scFor: 57, holes: 1190, events: 201 },
  TaskMap: { scIf: 80, scFor: 49, holes: 644, events: 110 },
} as const;

/**
 * E31-2: the parse result reports the same directive, hole and event counts as
 * the frozen §1.5 table, one entry per board so a single divergence fails alone.
 */
describe('E31-2 template counts', () => {
  it.each(BOARD_NAMES)('%s counts match §1.5', (name) => {
    const { stats } = loadBoard(name);
    expect({ scIf: stats.scIf, scFor: stats.scFor, holes: stats.interpolations, events: stats.events })
      .toEqual(EXPECTED[name]);
  });
});
