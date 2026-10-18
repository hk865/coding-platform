仅静态核对，未修改文件、未运行测试或构建。

1. **已完成。** 记录和本次读取的 Goal 守卫都在②的实际提交中，未误用答复捕获的 Goal 版本（`unknown-call-review-service.ts:1042`、`unknown-call-review-service.ts:1048`）。
2. **未完成，必须改。** 已按②结果判断成功，但失败仍无条件结束整个推进（`workflow.ts:2070`、`workflow.ts:2390`）。排前任务遇持续 unavailable/T02，会挡住其他独立任务。修改思路：普通推进在本次跳过失败任务、保留原因并继续选择；指定该任务才 waiting，避免重新选中同一卡。
3. **已完成。** ③使用独立 applicationCtx，UR7传入 Host 操作者，②保留自动化身份（`decision-actions.ts:426`、`workflow.ts:2380`）。
4. **已完成。** 保存批注、缺少文字读取接缝时拒绝、批注作为可裁剪行进入说明均已接上（`unknown-call-review-service.ts:991`、`unknown-call-review-service.ts:1024`、`continuation-brief.ts:723`）。
5. **未完成，必须改。** 附言已固定缩到60单位，但自动定下或空 targets 时仍缺“作用对象”必需行（`continuation-brief.ts:764`、`continuation-brief.ts:768`）。这违反裁定5。修改思路：空集合也输出固定行，并覆盖该情况。未见预算扩大：批注可略，必需部分放不下仍报 capacity（`continuation-brief.ts:408`、`continuation-brief.ts:413`）。
6. **已完成。** 路径取自 file_edit、顺序去重后取前31个，摘要共用工作区 owner，没有另开文件读取路径（`unknown-call-review-card.ts:78`、`unknown-call-review-card.ts:141`、`unknown-call-review-target-digests.ts:49`）。
7. **已完成。** 证明测试改为真实答复A的回执配真实答复B，经公开入口拒绝；旧造假文件已删除（`K3-41-disposition-proof.test.ts:99`、`K3-41-disposition-proof.test.ts:110`、`.lead-ref/rework1.diff:3603`）。
8. **部分完成，必须改。** 暂停恢复和分页终点已补（`K3-17-review-answer-shape.test.ts:249`、`K3-20-review-card-paging.test.ts:132`）。但 K3-44（三）接受 waiting和Run ended，L29第5行只等驱动停止（`K3-44-recovery-answers.test.ts:325`、`K3-44-recovery-answers.test.ts:331`、`K3-29-disposition-recovery.test.ts:258`）。任务卡在 verifying 也能通过。修改思路：修正检查夹具，完成检查及 complete_task、确认任务终点后，再断言静默重启和空 redriveGoals。
9. **主体已完成。** 三变体使用真实核对轮、公开答复和 Host 重启；safer_method停在 awaiting_proposal，符合此次边界（`review-card-round.ts:103`、`review-card-round.ts:124`、`K3-29-startup-variants.test.ts:148`、`K3-29-startup-variants.test.ts:187`）。
10. **已完成。** lookupAll保留200项分页、四次稳定窗口重试及原错误行为，未见搬移引起行为变化（`persistence/lookup-all.ts:22`、`persistence/lookup-all.ts:37`、`unknown-call-review-answers.ts:144`）。

另外发现两处新问题：

- **必须改：普通版本竞争被误报为T02。** `workflow.ts:2079`把不能证明记录已变的 revision_conflict全部解释为“目标的内容变了”。但新守卫也会因并发暂停失败；现有用例证明恢复后仍可落实（`K3-17-goal-guard.test.ts:110`、`K3-17-goal-guard.test.ts:171`）。这会给用户错误处理方向。修改思路：明确区分内容基础不符与存储版本竞争，后者保留真实拒绝原因。
- **必须改：新“两答复失败”测试仍注入事实。** 它手造记录和答复，并重复同一个答复引用（`K3-review-workflow-rows.test.ts:1002`、`K3-review-workflow-rows.test.ts:1004`、`K3-review-workflow-rows.test.ts:1009`）；②成功也是桩返回（`K3-review-workflow-rows.test.ts:240`）。不能证明两份真实答复下首个失败被保留。修改思路：公开创建两份答复和②回执，用存储故障包装分别令③失败，再检查首个原因。

五项 UNSPECIFIED：

- **(a) 不接受**：已有明确裁定，按第5项改。
- **(b) 可接受到B2**：safer_method进入 awaiting_proposal，未解决时自动化停止，不会提前普通接续（`state/unknown-call-review.ts:504`、`state/task-failure.ts:864`）。
- **(c) 不接受**：按第8项补齐终点，不能用 verifying替代。
- **(d) 可接受**：8→9包含夹具既有四张卡，新增第五条记录后的总数有明确断言（`K3-20-review-card-paging.test.ts:100`、`K3-20-review-card-paging.test.ts:173`）。
- **(e) 可接受**：按键读取仍调用同一摘要助手；无需为此次另扩缓存接口（`decision-read-model.ts:475`）。

A8-3n的基线复现说法**代码上合理，尚未独立证实**。它等待Goal完成，检查仍需执行真实命令，沙箱不可用可使流程无法完成（`A8-host-restart-paused.test.ts:357`、`harness.ts:261`、`check-execution.ts:169`）。未找到此次返工直接导致该超时的路径；但现有材料不足以确认具体归因。**建议**保留前后同一变体的超时位置和原始日志，再认定环境原因。

先改完列出的几处