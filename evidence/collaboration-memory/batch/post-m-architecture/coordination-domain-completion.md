# S02 协调领域局部性完成记录

日期：2026-09-14。

本记录以[原始架构对话](../2026-09-14-post-c-architecture-conversation.md)中“业务行为 → 责任模块 → 公开接口 → 内部实现”的要求为验收依据。它只记录 S02 的协调 Control 整理，不宣称 S01–S05 全部完成，也不进入 I01–I04。

## 结果

`CoordinationEngineImpl` 的公开方法、命令类型、回执类型和调用顺序保持不变。原来集中在 `coordination.ts` 的完整受理操作，现按共同维护的业务规则进入五个具名内部模块。每个内部模块包含该行为的结构校验、canonical 状态读取、权限与归因、expected version／竞争条件、提交计划和回执映射；它们不是只转发调用，也不只保存形状校验。

| 业务行为 | 完整操作的新维护位置 | 该位置拥有的规则 |
| --- | --- | --- |
| Agent 注册、参与建立、参与结束／换手 | `coordination/participation-operations.ts` | Workspace、AgentInstance、Work binding、Run 与当前 participation 读取；agent 归因；active／link／唯一性预检；参与与 binding 的版本；开始、结束及 route intent 的原子提交计划 |
| 定向请求、响应 | `coordination/directed-request-operations.ts` | 发送者和响应者的 participation／Run／binding；目标 Work 与 expected participation 的换手保护；正文 ref 形状；请求 CAS；请求事件与 route intent 同事务计划 |
| 订阅、历史 catchup、route page | `coordination/subscription-routing-operations.ts` | owner participation 权限；start cursor；canonical 订阅范围重读与归一化；分页位置推进；Delivery／Subscription／Wait／后续 intent 的 expected versions；整页原子提交 |
| 等待登记、复查 intent、唯一后继 | `coordination/waiting-successor-operations.ts` | wait 条件精确事实、前驱 Run、当前 participation 与 RoleBinding 资格、有效权限、替代报告、TaskLease／admission intent；等待与换手 CAS；successor TaskAttempt／Run／outbox／wait 的单次提交 |
| 通信取消、intent 取消请求、领取与结算 | `coordination/intent-lifecycle-operations.ts` | desired-state-first 取消、派生 wait intent 取消、consumer／lease generation、租约过期、side-effect started、终态与重试规则、intent revision；非路由结果的提交 |

route page 和 catchup 的接口只在 intent lifecycle 已验证当前 intent 的 owner、lease generation、outcome 形状和 intent revision 后调用。之后订阅／路由模块自己重读业务聚合、建立全部业务 expected versions 并执行唯一一次 commit。这条内部接口把机械 intent 权限与路由业务规则分开，但没有新增第二个启动者或第二条提交路径。

`coordination/operation-context.ts` 是五个模块共享的最小上下文，只提供：

- 精确聚合 ref 的 typed canonical load；
- records fold 所需的 `eventId`、`now`、`workspaceId`；
- 源事件同事务登记 route intent 所需的确定性计划。

它不判断业务权限，不接受控制行为的布尔开关，也不隐藏第二份状态。删除任一 operation 模块后，该领域的状态读取、权限、版本和提交复杂度会完整回到 facade，因此这些模块通过了“不是浅转发层”的删除检查。

## 必须保留的不变量

- Control 仍负责根据当前 canonical 状态决定请求能否受理；StateLedger 仍在 commit 时复核提交形状、CAS、幂等与跨连接竞争。此次没有删除或替代 Ledger 校验。
- agent、scheduler／system、订阅 owner、请求响应者和 wait successor 的权限规则分别留在所属行为，未统一为万能执行函数。
- `CoordinationEngine` 的外部消费者仍只调用原公开接口；`control-engine.ts`、Dispatch 和 Runtime 不需要知道五个内部模块。
- route page 的 scope、position、hasMore、Delivery 去重、Wait 观察和 next intent 仍在同一个原子提交中；catchup 仍从 durable cursor 重读事件。
- mailbox 继续由 `mailbox-view.ts` 从正式事件与当前快照重建；形状与归因纯判断继续由 `admission-support.ts` 维护。

## 文件与接口差分

- `src/control/control-engine/coordination.ts`：保留 13 个写入／受理方法与 `mailboxView` 的稳定 facade，并装配五个内部 operation 模块。
- 新增 `coordination/operation-context.ts` 与五个 `*-operations.ts`。
- `src/control/control-engine/README.md`：说明每个内部模块负责的完整规则及 intent／routing 内部调用前提。
- `tests/contracts/module-ownership.test.ts`：把新增文件加入 ControlEngine 精确库存；没有放宽 owner 或依赖检查。

源码文件行数从集中到分组只作为导航事实：facade 124 行，五个 operation 文件分别约 242、281、529、630、794 行。验收依据是行为规则的局部性和调用方知识减少，不是行数下降。

## 定向验证

1. `./node_modules/.bin/tsc --noEmit`：0 诊断；机器可读结果见 [coordination-domain-typecheck.json](coordination-domain-typecheck.json)。
2. `node scripts/check-module-boundaries.mjs`：523 个解析源码文件，ControlEngine 95 个文件，`issues: []`。原始输出见 [coordination-domain-boundaries.json](coordination-domain-boundaries.json)。
3. 定向 Vitest：32 suites、98 tests，全部通过。原始报告见 [coordination-domain-targeted-final.json](coordination-domain-targeted-final.json)。覆盖：
   - `tests/coordination/control.test.ts`
   - `tests/coordination/control.sqlite.test.ts`
   - `tests/coordination/participation-uniqueness.test.ts`
   - `tests/coordination/route-continuity.test.ts`
   - `tests/coordination/route-drive.test.ts`
   - `tests/coordination/handoff-successor.test.ts`
   - `tests/contracts/module-ownership.test.ts`

其中跨连接 participation 唯一性、内存／SQLite 同结论、路由翻页连续性、等待与换手竞争、唯一后继、非法提交零写入均由现有行为测试从未改变的公开接口验证。

按用户要求，本阶段没有运行全量回归。全量应在 S01–S04 的计划内源码全部完成并固定之后集中执行。
