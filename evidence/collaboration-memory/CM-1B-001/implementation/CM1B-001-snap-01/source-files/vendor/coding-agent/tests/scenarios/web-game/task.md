# 任务：从零实现「记忆翻牌」网页小游戏

请从**空目录**开始实现一个可玩的记忆翻牌（Memory / Concentration）网页游戏。

## 功能要求

1. 棋盘为 4×4（16 张牌，8 对相同图案）；
2. 点击翻牌：每次翻开两张，图案相同则配对保留，不同则翻回；
3. 记录并展示：翻牌次数、已配对数量、用时；
4. 全部配对后显示胜利提示，并提供「重新开始」按钮；
5. 纯 HTML/CSS/JS，**不得引入外部库、CDN 或构建工具**，浏览器直接打开 `index.html` 即可玩。

## 工程要求（可被自动验收器检查）

- `index.html`：引用 `style.css` 与 `script.js`；包含 `id="board"` 的棋盘容器与 `id="restart"`
  的重启按钮；
- `script.js`：通过 `import` 使用 `game-logic.mjs` 中的纯逻辑；
- `game-logic.mjs`：导出以下纯函数（无 DOM 依赖，供 Node 直接测试）：
  - `createBoard(size)` → 洗牌后的 `size*size` 张牌数组，每张牌
    `{ id, symbol }`，每个 symbol 恰好出现 2 次；
  - `isMatch(board, firstIndex, secondIndex)` → 两张牌 symbol 相同返回 `true`；
  - `calculateScore(moves, totalPairs)` → 翻牌次数越少分数越高（返回数字）。

## 完成标准

- 用浏览器打开 `index.html` 可以完整玩一局并获胜（无法本机跑浏览器时，如实记录该验收为外部门禁）；
- 自动验收器（`acceptance/check.mjs`）通过。

请在**工作区副本**中实现，不要改动 `tests/scenarios/web-game/base/` 原始目录。
