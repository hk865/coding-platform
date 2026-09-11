/* global document, window */
import { calculateScore, createBoard, isMatch } from "./game-logic.mjs";

const boardElement = document.querySelector("#board");
const movesElement = document.querySelector("#moves");
const matchesElement = document.querySelector("#matches");
const timerElement = document.querySelector("#timer");
const scoreElement = document.querySelector("#score");
const statusElement = document.querySelector("#status");
const victoryElement = document.querySelector("#victory");
const victorySummaryElement = document.querySelector("#victory-summary");
const restartButton = document.querySelector("#restart");
const playAgainButton = document.querySelector("#play-again");

const TOTAL_PAIRS = 8;
let board = [];
let firstIndex = null;
let moves = 0;
let matches = 0;
let seconds = 0;
let locked = false;
let timerId = null;

function cardButton(index) {
  return boardElement.querySelector(`[data-index="${index}"]`);
}

function updateStats() {
  movesElement.textContent = String(moves);
  matchesElement.textContent = String(matches);
  timerElement.textContent = String(seconds);
  scoreElement.textContent = String(calculateScore(moves, TOTAL_PAIRS));
}

function startTimer() {
  if (timerId !== null) return;
  timerId = window.setInterval(() => {
    seconds += 1;
    timerElement.textContent = String(seconds);
  }, 1_000);
}

function stopTimer() {
  if (timerId !== null) window.clearInterval(timerId);
  timerId = null;
}

function reveal(index) {
  const card = cardButton(index);
  card.classList.add("revealed");
  card.setAttribute("aria-pressed", "true");
  card.setAttribute("aria-label", `牌 ${index + 1}，${board[index].symbol}，已翻开`);
}

function hide(index) {
  const card = cardButton(index);
  card.classList.remove("revealed");
  card.setAttribute("aria-pressed", "false");
  card.setAttribute("aria-label", `牌 ${index + 1}，未翻开`);
}

function markMatched(index) {
  const card = cardButton(index);
  card.classList.remove("revealed");
  card.classList.add("matched");
  card.disabled = true;
  card.setAttribute("aria-label", `牌 ${index + 1}，${board[index].symbol}，已配对`);
}

function finishGame() {
  stopTimer();
  locked = true;
  statusElement.textContent = "全部配对完成！";
  victorySummaryElement.textContent = `${moves} 次移动 · ${seconds} 秒 · ${calculateScore(moves, TOTAL_PAIRS)} 分`;
  victoryElement.hidden = false;
  playAgainButton.focus();
}

function chooseCard(index) {
  if (locked) return;
  const card = cardButton(index);
  if (!card || card.disabled || index === firstIndex || card.classList.contains("revealed")) return;
  startTimer();
  reveal(index);
  if (firstIndex === null) {
    firstIndex = index;
    statusElement.textContent = "选择第二张牌";
    return;
  }

  const first = firstIndex;
  firstIndex = null;
  moves += 1;
  locked = true;
  if (isMatch(board, first, index)) {
    markMatched(first);
    markMatched(index);
    matches += 1;
    updateStats();
    statusElement.textContent = "配对成功";
    window.setTimeout(() => {
      if (matches === TOTAL_PAIRS) finishGame();
      else {
        locked = false;
        statusElement.textContent = "选择第一张牌";
      }
    }, 260);
    return;
  }

  updateStats();
  statusElement.textContent = "不匹配，稍后翻回";
  window.setTimeout(() => {
    hide(first);
    hide(index);
    locked = false;
    statusElement.textContent = "选择第一张牌";
  }, 620);
}

function renderBoard() {
  boardElement.replaceChildren();
  board.forEach((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card";
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `牌 ${index + 1}，未翻开`);
    const symbol = document.createElement("span");
    symbol.className = "symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = card.symbol;
    button.append(symbol);
    button.addEventListener("click", () => chooseCard(index));
    boardElement.append(button);
  });
}

function restart() {
  stopTimer();
  board = createBoard(4);
  firstIndex = null;
  moves = 0;
  matches = 0;
  seconds = 0;
  locked = false;
  victoryElement.hidden = true;
  statusElement.textContent = "选择第一张牌";
  renderBoard();
  updateStats();
}

restartButton.addEventListener("click", restart);
playAgainButton.addEventListener("click", restart);
restart();
