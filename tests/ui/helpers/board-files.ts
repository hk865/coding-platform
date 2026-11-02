import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board } from '../../../src/ui/board.js';
export const BOARD_NAMES = [
  'ArchOverview', 'Chain', 'Decide', 'Done', 'Goals', 'Main', 'Member', 'Phone', 'Plan', 'TaskMap',
] as const;
export type BoardName = (typeof BOARD_NAMES)[number];
export const BOARDS_DIR = fileURLToPath(new URL('../../../docs/ui-reference/workbench-2026-10/', import.meta.url));
export function loadBoard(name: BoardName, directory: string = BOARDS_DIR): Board {
  return parseBoard(name, readFileSync(`${directory}/${name}.dc.html`, 'utf8'));
}
