# Agent Platform 当前交接

更新：2026-09-12。产品根 D:/1.project/Software/agent_platform；权威根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

当前开发批次：可扩展 RoleSpec 多版本模板、创建/展示/激活、规划可见目录及 Runtime 按实际授权组装工具；跨工作协调事实选材；带来源工作记忆的更新/废止和 Context 版本过滤。详见[本批实现与验证](evidence/2026-09-12-agent-templates-memory/verification.md)。持续联合协商、自动记忆提炼与产品维护入口尚未完成，不能称完整多 Agent/长期记忆产品已验收。本批尚未提交或推送。

以下为已提交的上一批语义闭环基线事实。

用户确认清理完成后继续最小语义协作实现。清理基线经源码摘要核对复用了1953项/299文件、26项浏览器及类型/边界/构建验证，已按用户追加授权提交并推送 b7fa329178a1474933c9dd1a4a812285cec04cf3 到 origin/main。该提交不包含下述后续功能；历史记录和真实失败日志保留。清理细节见[协议收敛证据](evidence/2026-09-11-source-cleanup/protocol-convergence/verification.md)。

当前增量已接正式工具及 Reviewer FAIL→只读协调调查→精确答案绑定的语义返工提案→Control原受理路径→后继实际消费→当前工具重验→必要独立Reviewer→Evidence及Task归约。必要目标澄清复用普通提案/UserDecision/PlanRevision，UI提交精确答案和选项，决定正文进入后续调查与执行Context。调查刷新使用精确supersedes关系，旧FAIL、旧答案、旧计划及原报告不删除。

组合根从持久决定及终态运行恢复后续动作，不新增状态系统。真实HTTP/SQLite/内核的五条样例已验证正常链、Reviewer FAIL保留阻塞、人的选择、决定已记录未应用、计划已应用未投递。替身模型只证明流程与真实工具/材料调用，不证明真实模型语义质量；样例Task达到satisfied，Goal保留原正式归约结果，不能把Task完成冒充Goal完成。

本次最小闭环验收完成：302文件/1994项行为测试、27项真实浏览器、前后端类型、12 Module边界和文档13/13全部通过；构建产物与HTTP返回字节一致。首轮及后续真实失败日志保留，独立复核发现的来源、替代、隔离和UI问题已修。完整范围、身份、原始数据和限制见[本次验收](evidence/2026-09-11-semantic-completion/verification.md)。功能增量和验收材料已纳入本次用户授权的本地Git检查点；语义功能检查点83000c9已按用户授权推送至origin/main。当时的 Agent 模板讨论为候选；当前增量及未完成项以上述 2026-09-12 记录为准。

保持12 Module及原DAG：Verification问题经组合根输入；Dispatch→PlanCompiler→Context核对实际来源，Control只核对持久事实及原权限/义务，不反调Context或WorkspaceReader。文件来源核对不是外部文件系统原子事务。此入口只处理不改变验收义务的目标澄清，验收/架构基线变更仍走各自正式入口。

[唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)保留范围外有效义务：持续跨工作角色协作、更多角色路由、一般强杀/未知副作用恢复、暂停/换手、长期记忆、一般来源失效和完整架构演进等。不因本次有界样例取消这些工作。

## CM-1A-001 第 1 工作段当前事实（2026-09-13）

CM-1A-001 第 1 工作段完成的是**契约与账本层**：新增 `src/contracts/coordination.ts`、`src/contracts/coordination-events.ts`、`src/control/control-engine/records/coordination.ts`、`src/control/control-engine/policies/coordination-rules.ts` 4 个文件，并在 10 个既有文件上做追加式改动，登记 10 个协作聚合、14 个 commit kind（`COMMUNICATION_COMMIT_KINDS`）与 20 个事件；两个账本适配器共用同一份 `validateCommunicationCommit`。既有 commit kind 的语义、守卫与用例未改，未替代任何旧入口。

**未实现**：Control handler、Dispatch 路由 handler、Context 侧 Delivery 材料接入三段消费者；新契约没有生产调用者，D01–D05 只在契约面落地。**A01–A12 无一项验证通过，Gate A 未成立，本票未可交验。** 证据目录：`evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-01/`（verification.md、handoff.md、decision-log.md、logs/）。

本快照上的构建与回归全部通过（`pnpm kernel:build`、`pnpm build`、`pnpm ui:typecheck`、全量 `bash scripts/test-wsl.sh` 303 文件 / 1998 用例，退出码均为 0），只证明既有行为未退化，不构成协作通信可用或本票通过的证据。

**测试入口必须为 `bash scripts/test-wsl.sh <路径...>`**；不要用 `npx vitest run`（缺 bwrap 路径与 sandbox preflight，会产生大量假失败）。本环境 `~/.local/bin` 只链接了 node / npx / pnpm，**没有 npm**：`pnpm kernel:build` 与 `pnpm build` 需把 node 工具链 bin（`/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin`，其中含 npm）加入 PATH，否则以 `sh: 1: npm: not found` 退出 1。
