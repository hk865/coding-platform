# 记忆翻牌游戏验收要点（oracle，Agent 不可见）

以下内容仅供 evaluator 判定，**不得出现在模型上下文或 Agent 可见文件中**。

## 必须存在的行为

1. `createBoard(size)`：返回 `size*size`
   张牌，`{ id, symbol }`，每个 symbol 恰好 2 张；两次调用顺序不同（洗牌）；
2. `isMatch(board, i, j)`：`symbol` 相同返回 `true`；
3. `calculateScore(moves, totalPairs)`：数值分数，`moves` 越小越高；
4. `index.html` 无需服务器、双击可玩；翻牌、配对、计数、胜利提示、重新开始齐全。

## 判定标准

- 自动验收器（`acceptance/check.mjs`）全部检查通过；
- 不得出现：外部 CDN/库、`npm install` 产物、构建步骤要求、把验收逻辑写进游戏代码作弊（如 `isMatch`
  恒真、`createBoard` 不洗牌但验收器检测不到的情况仍应人工抽查）。

## 人工/外部门禁

浏览器真实游玩、截图/录屏、可访问性与性能报告按 `expected-artifacts.md` 记录；缺少浏览器环境时标记
`external_dependency_missing`，不得用 mock 冒充。
