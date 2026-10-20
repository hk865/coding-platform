T 轮 TP 组已完成并提交。回复、计划与 ledger 均已写入 `.dsh-ref/`。

## 结果概览

- **提交：** `efa65cd T TP`，`336 files changed, 4059 insertions(+), 11394 deletions(-)`。
- **173 项：** 147 项 `done`，11 项 `partial`，15 项 `BLOCKED`（含被吸收条目；详见回复 §1）。
- **检查：**
  - `flock ./.typecheck.lock npm run typecheck` 通过（两套 tsc 配置 0 错误）。
  - `npm run check:architecture` 通过（`next source boundaries: OK`）。
  - 最终扫全部 155 个改动测试文件（13 批，`--maxWorkers=2`）：约 4,000+ 项通过；55 条失败全部可归因——47 条为容器缺 `/usr/bin/bwrap` 或 t-base 既有失败，8 条为已冻结 BLOCKED（TP-025 3、TP-030/118 1、TP-165 4）。
  - D1 ledger：533 行待核 + 3 个删除文件，逐文件映射到条目，**无未映射行**；`D3 hits: 0`。
- **删除文件：** `session-provenance-facts.ts`、`project-source-index.ts`、`project-source-index.test.ts`、`S5-goal-settings-support.ts`、`S2B-r2-s-preentry-control.test.ts`。
- **白名单外（规则 1 编译例外，回复 §3 已列）：** `WP1-start-refusal.test.ts`、`S3-context-inputs.test.ts`、`W1-future-plan.test.ts`、`W2-future-intent.test.ts`、`W2-agent-whiteboard.test.ts`。

## 需要 lead 注意

1. **TP-165 AD08 是书误**：真实 binding 不含 Workspace source，`execution-entry-service.ts:1073-1078` 只比较 `binding.sources`，@7→@8 后 authorize 会成功而非 `revision_conflict`。
2. **TP-025 的“两个旧根” BLOCKED 与 chain 必填冲突**：保留的 3 条旧形状用例现在被存储层拒绝，需 lead 冻结其输入或允许改为当前根。
3. **TP-081/TP-054**：C1 夹具的真实 Runtime start 只到 `entering`，A3 entered 闸门不可达；WP1-units 的 Runtime double 也无法走真实 prepare。
4. **TP-101**：夹具的 `builder` 模板不在生产五模板内，`legacyDuty` 需一条 fixture 专用映射到 adviser，请 lead 确认。
5. **类型检查锁偏差**：`/home/han001/dsh-work/t-typecheck.lock` 在本沙箱不可创建（无审批通道），改用工作区内 `./.typecheck.lock` 的同一 flock 串行化；已在回复 §4 记录。

**产出文件：** `.dsh-ref/t-plan-TP.md`、`.dsh-ref/t-reply-TP.md`、`.dsh-ref/ledger-TP.txt`。