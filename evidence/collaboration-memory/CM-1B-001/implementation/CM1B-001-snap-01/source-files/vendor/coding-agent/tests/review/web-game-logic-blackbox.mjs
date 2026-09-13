import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = process.argv[2];
if (!workspace) throw new Error("usage: web-game-logic-blackbox.mjs <workspace>");

const { calculateScore, createBoard, isMatch } = await import(
  `${pathToFileURL(path.resolve(workspace, "game-logic.mjs")).href}?review=${Date.now()}`
);
const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
}

const board = createBoard(4);
const counts = new Map();
for (const card of board) counts.set(card.symbol, (counts.get(card.symbol) ?? 0) + 1);
check("4x4 board has exactly 16 cards", board.length === 16, `length=${board.length}`);
check(
  "board has 8 symbols and every symbol occurs exactly twice",
  counts.size === 8 && [...counts.values()].every((count) => count === 2),
  JSON.stringify(Object.fromEntries(counts)),
);
check("all card ids are unique", new Set(board.map((card) => card.id)).size === 16);

const firstPair = [...counts.keys()][0];
const pairIndexes = board
  .map((card, index) => ({ card, index }))
  .filter((item) => item.card.symbol === firstPair)
  .map((item) => item.index);
const differentIndex = board.findIndex((card) => card.symbol !== firstPair);
check(
  "isMatch accepts a real pair and rejects a different symbol",
  isMatch(board, pairIndexes[0], pairIndexes[1]) === true &&
    isMatch(board, pairIndexes[0], differentIndex) === false,
);
check("isMatch rejects clicking the same card twice", isMatch(board, 0, 0) === false);

const perfect = calculateScore(8, 8);
const average = calculateScore(16, 8);
const slow = calculateScore(64, 8);
check(
  "score is finite, non-negative, and strictly decreases as moves increase",
  [perfect, average, slow].every(Number.isFinite) &&
    perfect > average &&
    average > slow &&
    slow >= 0,
  `perfect=${perfect} average=${average} slow=${slow}`,
);

const arrangements = new Set();
for (let index = 0; index < 20; index += 1) {
  arrangements.add(
    createBoard(4)
      .map((card) => card.symbol)
      .join(""),
  );
}
check(
  "restart source can produce a fresh shuffle",
  arrangements.size > 1,
  `unique=${arrangements.size}`,
);

const failed = checks.filter((item) => !item.pass);
process.stdout.write(
  JSON.stringify({ status: failed.length === 0 ? "pass" : "fail", checks }, null, 2),
);
process.exit(failed.length === 0 ? 0 : 1);
