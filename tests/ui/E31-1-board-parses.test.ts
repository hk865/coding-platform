import { describe, expect, it } from 'vitest';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';

/**
 * E31-1: every frozen board parses. `parseTemplate` refuses an unknown `sc-*`
 * tag, so the parse succeeding is the evidence that none is silently accepted.
 */
describe('E31-1 boards parse', () => {
  it.each(BOARD_NAMES)('%s parses', (name) => {
    expect(loadBoard(name).name).toBe(name);
  });
});
