# DEF-17-core 实现与有界验证交接

日期：2026-09-10。范围来自 DEF-17-reviewer-product-recovery Ticket；本页是实现者交接，不替代独立审查或本批最终验收。

## 修改范围

- `src/contracts/reviewer-context.ts`：受限恢复资格端口、持久观察所需字段；缺失历史字段不默认补成未启动证明。
- `src/contracts/reviewer-verification.ts`：recoverReview、恢复视图与公开授权追溯字段。
- `src/context/reviewer-context.ts`：持久唯一观察与 canonical Work/Run/Protocol、会话、精确事件、来源/配置/授权的交叉复核。
- `src/control/reviewer-work.ts`：完整冻结命令指纹先重放，首次替代再检查当前材料、原失败及协议尾项 CAS；不修改原 Work/Run/Result/Evidence。
- `src/verification/reviewer-record.ts`、`reviewer-verification.ts`、`verification-service.ts`：持久授权意图、冻结替代命令、回执，替代 Work 回到原 advance/current/Result/Evidence/归约链。
- `tests/verification/reviewer-fixture.ts`：完成观察按精确 Run ID 更新，以支持原失败和替代 Run 同时保留。
- `tests/verification/reviewer-recovery.test.ts`：11 项有界恢复验证；PASS/FAIL 两项还通过 `advanceProjection` 与公开 `consoleActiveAgents` 检查内存后端替代 Reviewer 可见。

`contracts/reviewer-work.ts` 沿用原受限替代命令和证明类型，本票未改；app、UI、ReadModel、HTTP/浏览器集成及独立审查由其他明确分工承担。未修改 vendor。

## 11 项专项边界

1. 原失败可证明时显式恢复，正常 PASS 报告、Evidence、归约、重开与旧事实保留。
2. 同一路径的真实 FAIL 资格仍阻断，不能通过新请求清除；原失败事实保留。
3. 同键并发重放、变更原因冲突、跨 start/recover 身份冲突及竞争授权拒绝。
4. 两个不同授权身份并发，协议 CAS 最多接纳一个 Work。
5. Control 提交后丢响应，重开原样重放冻结命令并补持久回执；变更命令指纹拒绝。
6. 命令已冻结但未提交，观察后来变成 unknown：拒绝执行，不重写证明。
7. 命令已冻结但未提交，原证明仍有效：重开沿原授权受理。
8. 连续 journal 保存失败时，不因内存已有 command 而提交 Control；保存恢复后才受理。
9. 授权意图已落盘但冻结命令保存失败：重开完成资格核对和受理。
10. canonical outcome_unknown 与运行观察声称 failed 矛盾：保持未知、零替代。
11. 缺事件/trace/usage/session、重复观察、错误作用域/配置、已启动事件、非空 trace/usage、错误事件身份/序号/时间、空失败理由和配置变化均拒绝。

这些测试使用真实 Control、Context、Vault 和 Verification，持久 journal 重开；运行观察部分为明确测试输入。真实 Runtime、租约冲突、HTTP 与 SQLite 全链证据见同目录 HTTP 交接，不把 fixture 报告当成实际模型执行证据。

## 验证命令与日志

在 WSL 的产品根执行：

```sh
node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit
bash scripts/test-wsl.sh tests/verification/reviewer-recovery.test.ts --maxWorkers=2
```

保存日志：`core-types.log` 保留此次集成类型失败（HTTP 测试新增代码的 TS2683，exit 2）；修复后重验另存 `core-types-final.log`。`core-recovery.log` 是含最终内存 ActiveAgents 公共投影断言的专项日志。日志尾部记录实际退出码，类型失败与环境入口失败分开。

最终结果：`core-types-final.log` exit 0；`core-recovery.log` 1 文件 / 11 项通过、0 skipped、exit 0，30.96s。

此前有界回归实际通过：`reviewer-recovery`、`reviewer-verification`、`reviewer-context`、`reviewer-work`、`reviewer-work-persistence` 五文件 64 项，34.34s；此前真实租约回归两项通过。这些早轮结果位于工具输出，不冒充本页所附最终日志；最终全仓适用检查由主 Agent 冻结源码后执行。

环境入口：Windows 直接 `node node_modules/typescript/bin/tsc --noEmit` 返回 MODULE_NOT_FOUND；沙箱内 WSL 服务访问返回 E_ACCESSDENIED。获批访问已配置 WSL 服务后使用仓库 Node 24 和 `test-wsl.sh`，未关闭测试沙箱、未跳过测试。core 各实际测试轮次未出现产品断言失败。

限定结论以最终源码、独立审查及主 Agent 集成验收为准；本实现者不将 Ticket、Runtime Task 或整个产品自行标为完成。
