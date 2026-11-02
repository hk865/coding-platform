import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';

/**
 * Browser entry for one frozen board page. The Host serves the original
 * `.dc.html` at this URL; boot fetches that source and parses it, because the
 * DOM lowercases attribute names (`onClick` becomes `onclick`).
 * `parseBoard` hoists `<helmet>` into `<head>` and mounts the rendered tree.
 */
export async function bootBoardPage(): Promise<void> {
  const root = document.querySelector('x-dc');
  if (!root) return;
  const board = parseBoard(document.title, await (await fetch(location.href)).text());
  if (board.helmetHtml.length > 0) hoistHelmet(board.helmetHtml);
  new BoardView(board).mount(root);
}

function hoistHelmet(html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  document.head.append(template.content);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootBoardPage, { once: true });
  else void bootBoardPage();
}
