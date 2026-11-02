import { describe, expect, it } from 'vitest';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { serializeTree } from './helpers/render.js';
import { BoardView } from '../../src/ui/runtime.js';

/**
 * E31-3: each board's own `data-props` defaults are enough for a first render:
 * it does not throw, leaves no `{{` hole behind, and renders no literal
 * `undefined` or `NaN` text.
 */
describe('E31-3 first render with the board defaults', () => {
  it.each(BOARD_NAMES)('%s renders cleanly', (name) => {
    const view = new BoardView(loadBoard(name));
    expect(() => view.render()).not.toThrow();
    const html = serializeTree(view.tree);
    expect(html).not.toContain('{{');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });
});
