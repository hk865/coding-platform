import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board } from '../../../src/ui/board.js';
export const BOARD_NAMES = [
  'ArchOverview', 'Chain', 'Decide', 'Done', 'Goals', 'Main', 'Member', 'Phone', 'Plan', 'Settings', 'TaskMap',
] as const;
export type BoardName = (typeof BOARD_NAMES)[number];
export const BOARDS_DIR = fileURLToPath(new URL('../../../docs/ui-reference/workbench-2026-10/', import.meta.url));
export const WORKING_BOARDS_DIR = fileURLToPath(new URL('../../../src/ui/boards/', import.meta.url));
export function loadBoard(name: BoardName, directory: string = BOARDS_DIR): Board {
  const file = directory === BOARDS_DIR && !existsSync(`${directory}/${name}.dc.html`)
    ? `${WORKING_BOARDS_DIR}/${name}.dc.html` : `${directory}/${name}.dc.html`;
  return parseBoard(name, readFileSync(file, 'utf8'));
}
