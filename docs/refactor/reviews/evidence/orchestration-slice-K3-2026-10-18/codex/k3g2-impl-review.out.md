本次仅做静态只读审查，未修改文件，未运行测试或构建。以下不计第 3、4 组尚未施工的内容。

1. **必须改：L4 的查询分发停在第一个 owner。**  
   [tool-commit-lookup.ts:18](D:/cxt/k3g2-review/src/composition/tool-commit-lookup.ts:18) 只跳过 `lookup_not_published`，但“不归本 owner 管”实际返回 `unknown_tool: …`（[tool-commit-arguments.ts:153](D:/cxt/k3g2-review/src/core/work-graph/model/tool-commit-arguments.ts:153)）；组合又把 mailbox 放在首位（[create-platform.ts:1498](D:/cxt/k3g2-review/src/composition/create-platform.ts:1498)）。反例：已提交的 `propose_future_plan` 在结果落盘前崩溃，查找不会到计划 owner，被记成 `undetermined`。最小修复：按工具名直接分发，或统一“不归我管”的返回契约。

2. **必须改：修好分发后，决定和计划查询仍会错判“没做”。**  
   草稿使用带 `aggregateType` 的 Session 引用（[unknown-call-draft.ts:152](D:/cxt/k3g2-review/src/core/agent-runtime/unknown-call-draft.ts:152)），真实执行计算请求号时只取 `projectId/sessionId`（[execution-driver.ts:455](D:/cxt/k3g2-review/src/core/agent-runtime/execution-driver.ts:455)）。决定查询直接散列原输入（[decision-service.ts:1194](D:/cxt/k3g2-review/src/core/work-graph/communication/decision-service.ts:1194)），计划查询连 actor 的 Session 散列也未规范化（[plan-service.ts:2287](D:/cxt/k3g2-review/src/core/work-graph/tasks/plan-service.ts:2287)）。同一真实调用因此查成 `not_committed`，可能诱发重复操作。最小修复：统一规范化来历及请求号算法，供执行与全部 owner 共用。

3. **必须改：RUN-22 owner 漏掉 L8 的原记录校验。**  
   [run-reconcile-service.ts:199](D:/cxt/k3g2-review/src/core/work-graph/tasks/run-reconcile-service.ts:199) 的校验不接收原 Run，[892 行](D:/cxt/k3g2-review/src/core/work-graph/tasks/run-reconcile-service.ts:892) 也未补查。反例：Run 已记录未知调用 X，直接认定却传 `complete/items:[]/itemsOmitted:0`，仍可在 [925 行](D:/cxt/k3g2-review/src/core/work-graph/tasks/run-reconcile-service.ts:925) 建成空的 `resolved` 记录；曾走 RUN-20(ii) 的 Run 也能谎报完整。应在回执未命中后，按 L8 校验停止时不可读、调用覆盖及 `too_large` 数量守恒，不符返回 `invalid`。

4. **必须改：连续恢复计数会错误清零。**  
   本组在 [run-reconcile-service.ts:463](D:/cxt/k3g2-review/src/core/work-graph/tasks/run-reconcile-service.ts:463) 接入的 `streakOf`，遇正常终态立即返回两个 `false`（[task-failure.ts:594](D:/cxt/k3g2-review/src/core/work-graph/state/task-failure.ts:594)）。合法反例：X 正常 yielded → A 接续后 RUN-25 → B 再次中断；扫描 B→A→X 时，A 被清掉，B 可以再次自动收尾。违反 L23/G9。应遇重置点停止扫描，仍按已收集的区间计算。此为第一组遗留、第二组接线后影响真实路径的问题。

5. **必须改：L6 新读口可跟随符号链接读取保护区。**  
   保护检查只比较原始路径文字（[context-assembler.ts:676](D:/cxt/k3g2-review/src/core/agent-runtime/context-assembler.ts:676)），随后使用会跟随链接的 `stat/readFile`（[continuation-diff-reads.ts:89](D:/cxt/k3g2-review/src/core/workspace/continuation-diff-reads.ts:89)）。反例：原合法编辑路径在接续前变为指向 `.env` 的链接，其内容会进入 diff。应复用工作区路径边界，规范化并检查实际目标；链接及越界路径不得读取正文。

6. **必须改：L6 有两处把不完整信息写成确定事实。**  
   [continuation-brief-assembly.ts:225](D:/cxt/k3g2-review/src/core/agent-runtime/continuation-brief-assembly.ts:225) 只查前 50 条样本，未命中就写 `unchanged`：第 51 个实际修改文件会被误报。应读取捕获 Artifact 全文判断。另 [context-assembler.ts:752](D:/cxt/k3g2-review/src/core/agent-runtime/context-assembler.ts:752) 对开始时已删的路径仍读取 HEAD；反例：开始前删除、执行中重建，会显示以旧 HEAD 为基准的错误 diff。所有开始时脏路径都应按 L6 标 `baseline_dirty`，不读旧正文。

7. **必须改：L5 把新近被忽略的文件算作删除。**  
   遍历跳过 git 忽略路径（[workspace-change-capture.ts:165](D:/cxt/k3g2-review/src/core/workspace/workspace-change-capture.ts:165)），比较阶段却只排除固定目录及保护前缀（[289 行](D:/cxt/k3g2-review/src/core/workspace/workspace-change-capture.ts:289)）。反例：开始时存在未跟踪文件，执行中把它加入 `.gitignore`；它仍存在，却在 [307 行](D:/cxt/k3g2-review/src/core/workspace/workspace-change-capture.ts:307) 被记为 `deleted`。应把本次 git 忽略集合用于比较过滤，仅在 `notVisible` 表示不可见。

8. **必须改：G11 未通过时仍进行后续采集和查询。**  
   [run-reconcile.ts:463](D:/cxt/k3g2-review/src/core/agent-runtime/run-reconcile.ts:463) 先构造草稿，再检查完整性；草稿内部先采集工作区，再查各工具回执（[unknown-call-draft.ts:149](D:/cxt/k3g2-review/src/core/agent-runtime/unknown-call-draft.ts:149)、[169 行](D:/cxt/k3g2-review/src/core/agent-runtime/unknown-call-draft.ts:169)）。33 条调用必然不满足 G11，却仍触发完整遍历及查询，违反 L25 的短路顺序并增加启动成本。最小修复：先做纯清单校验，通过后才采集、查回执。

9. **必须改：若干测试的入口或断言弱于声明。**
   - **K3-39** 用被测查询侧的 `toolCommitRequestId` 制造原提交身份（[测试:58](D:/cxt/k3g2-review/tests/work-graph/K3-39-tool-commit-lookup.test.ts:58)），所以身份算法漂移仍能通过。应通过真实工具提交，或使用独立手算的固定身份，并覆盖 Host 分发。
   - **K3-01/02/04** 的说明读取借 `manifestOf` 直接 SELECT SQLite（[brief.ts:97](D:/cxt/k3g2-review/tests/scenarios/support/brief.ts:97)）；K3-01 的“没有再发”也查内部事件表（[测试:183](D:/cxt/k3g2-review/tests/scenarios/K3-R1-restart-flows.test.ts:183)）。公共读取坏了仍可能通过，须改用材料、邮箱公开读口。K3-01 还只验回执种类和关闭状态，未验规定的 cursor、关闭目标（[168 行](D:/cxt/k3g2-review/tests/scenarios/K3-R1-restart-flows.test.ts:168)、[177 行](D:/cxt/k3g2-review/tests/scenarios/K3-R1-restart-flows.test.ts:177)）。
   - **K3-04 双在途替身不能算真实 R1 验收。** 测试把 edit 改为独立只读调用（[测试:83](D:/cxt/k3g2-review/tests/scenarios/K3-R1-file-change.test.ts:83)），真实 edit 是非独立的写调用（[edit-tool.js:124](D:/cxt/k3g2-review/vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js:124)）。应分别验证真实调度语义的 replace/create；双条目保留为注入例，并由 lead 修订不可达的规格部分。

10. **建议：精简明确重复，勿为软预算删规则。**  
    请求号算法两份（[execution-driver.ts:464](D:/cxt/k3g2-review/src/core/agent-runtime/execution-driver.ts:464)、[tool-commit-arguments.ts:57](D:/cxt/k3g2-review/src/core/work-graph/model/tool-commit-arguments.ts:57)）可合并，净减约 5–10 行；基准 Artifact 的读取、解码、降级重复（[context-assembler.ts:695](D:/cxt/k3g2-review/src/core/agent-runtime/context-assembler.ts:695)、[create-platform.ts:1528](D:/cxt/k3g2-review/src/composition/create-platform.ts:1528)）可合并，净减约 10–15 行。当前证据不足以把超预算的约 1,700 行全部认作可删冗余。

其余三项 UNSPECIFIED：`<headCommit>:<path>` 仍通过固定提交的 `cat-file blob` 读取，可接受（[continuation-diff-reads.ts:72](D:/cxt/k3g2-review/src/core/workspace/continuation-diff-reads.ts:72)）；`shell-work-root` 使用公开组合根，且仍经场景 Host 重启，可接受（[helper:35](D:/cxt/k3g2-review/tests/scenarios/support/shell-work-root.ts:35)、[测试:143](D:/cxt/k3g2-review/tests/scenarios/K3-R1-second-cleanup.test.ts:143)）；applied pause 在途例不应伪造，有在途调用时状态机拒绝该干净收尾（[run-machine.ts:2110](D:/cxt/k3g2-review/src/core/work-graph/state/run-machine.ts:2110)）。

模块边界未发现确定的转导绕行：`ContinuationWorkspaceBytes` 归 WorkspaceTools，Runtime 仅转出该类型，依赖方向正确（[定义:23](D:/cxt/k3g2-review/src/core/workspace/continuation-diff-reads.ts:23)、[转出:310](D:/cxt/k3g2-review/src/core/agent-runtime/execution-contracts.ts:310)）。

先改完列出的几处