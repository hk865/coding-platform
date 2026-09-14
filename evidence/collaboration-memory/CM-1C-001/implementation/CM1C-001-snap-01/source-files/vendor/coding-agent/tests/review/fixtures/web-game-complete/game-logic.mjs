const SYMBOLS = ["☾", "✦", "♜", "❖", "♬", "⚘", "☁", "⚡", "☀", "♣", "◆", "●"];

export function createBoard(size) {
  if (!Number.isInteger(size) || size <= 0 || (size * size) % 2 !== 0) {
    throw new RangeError("size 必须产生正偶数张牌");
  }
  const pairCount = (size * size) / 2;
  if (pairCount > SYMBOLS.length) throw new RangeError("size 超出可用符号数量");
  const cards = SYMBOLS.slice(0, pairCount).flatMap((symbol, pairIndex) => [
    { id: `${pairIndex}-a`, symbol },
    { id: `${pairIndex}-b`, symbol },
  ]);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[selected]] = [cards[selected], cards[index]];
  }
  return cards;
}

export function isMatch(board, firstIndex, secondIndex) {
  if (!board[firstIndex] || !board[secondIndex] || firstIndex === secondIndex) return false;
  return board[firstIndex].symbol === board[secondIndex].symbol;
}

export function calculateScore(moves, totalPairs) {
  if (!Number.isFinite(moves) || !Number.isFinite(totalPairs) || totalPairs <= 0) return 0;
  return Math.max(0, Math.round(totalPairs * 100 - Math.max(0, moves - totalPairs) * 12));
}
