# MVP 候选版本清单

候选版本只有在以下项目全部完成后才能标记为 M6 complete：

- [x] 建立可追溯 Git commit（`a91cde6`）并推送；发布 tag 在外部门禁关闭后创建；
- [x] `npm run check` 全部通过；
- [x] 支持 bubblewrap 的 Linux runner 上 `npm run test:e2e:bwrap` 通过（本地 WSL，6/6）；
- [ ] OpenAI 与 DeepSeek 分别完成纯文本和无副作用 function ToolCall smoke；
  - acceptance 工具与脱敏 summary schema 已完成；只有真实凭据运行结果可勾选本项。
  - [x] DeepSeek `deepseek-v4-flash` text + ToolCall，commit `f2f8f40`；
  - [ ] OpenAI text + ToolCall。
- [x] 4 个 canary 的 base/oracle/near-miss/repeat preflight 通过；
- [x] 固定 replay baseline 生成完整 schema、trace、diff 和 evaluator log；
- [x] 固定真实模型 baseline 完成并保存 Provider/model/prompt/预算/commit；
  - DeepSeek `deepseek-v4-flash`、`thinking=disabled`、commit `bbf1be1`、run
    `m6-real-deepseek-bbf1be1`：4/4
    resolved，`resolvedAt1=1`，无 Agent/timeout/环境/evaluator/Policy error。
- [x] README、architecture、interfaces、data-flow、development、testing 与当前候选代码复核一致；
- [x] 没有未记录的 P0 安全问题或阻塞缺陷。

Replay 结果不得冒充真实模型成绩。环境或 evaluator 错误不得计为模型未解决，但必须阻止不可信的版本比较。
