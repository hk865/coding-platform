仅静态核对，未修改文件、未运行测试或构建。

1. **部分完成。** 当次重选会排除失败卡，指定任务仍返回 `waiting`；但排除集没有跨后续步骤保留，不能保证整个连续推进不重复选卡（`workflow.ts:1255`、`workflow.ts:2440`）。详见下面的必须改。
2. **完成。** 用导出常量 `UNKNOWN_CALL_REVIEW_T02_REASON` 识别 T02，值沿用原拒绝文字；其他版本冲突报告真实原因，第5片契约未改（`unknown-call-review.ts:195`、`unknown-call-review-service.ts:986`、`workflow.ts:2123`）。
3. **完成。** 作用对象行无条件输出，自动定下或空集合均为“作用对象：无。”（`continuation-brief.ts:772`）。
4. **完成。** 检查夹具执行实际命令、采用真实退出码，没有注入通过事实；两例达到任务终态，再验证静默重启（`K3-29-disposition-recovery.test.ts:93`、`K3-29-disposition-recovery.test.ts:310`、`K3-29-disposition-recovery.test.ts:313`；`K3-44-recovery-answers.test.ts:351`、`K3-44-recovery-answers.test.ts:388`）。
5. **完成。** 两张真卡经公开入口答复，调用真实②及回执读取；存储包装器让两次③分别失败，并断言首个失败文本（`K3-review-workflow-rows.test.ts:1009`、`K3-review-workflow-rows.test.ts:1035`、`K3-review-workflow-rows.test.ts:1053`、`K3-review-workflow-rows.test.ts:1065`）。

返工2引入的问题：

- **必须改：两张失败卡会造成忙循环。** 每次失败只重新建立当前卡的排除集，返回的 `next` 不携带此前集合（`workflow.ts:2441`、`workflow.ts:398`）。Host 连续执行这些下一步（`collaboration-driver.ts:793`、`collaboration-driver.ts:884`），因此 A、B 都持续失败时形成 A→B→A，后面的可执行任务 C 永远选不到。修改思路：在一次连续选取期间累积、传递失败卡集合，到选取结束再清空；补 A/B 持续失败、C 可领取的连续驱动回归。现有测试只检查下一步指向 B，抓不到该循环（`K3-46-review-advance-failures.test.ts:322`）。
- **建议：合并重复检查夹具。** 两份新增沙箱执行逻辑基本相同，后续修正需要同步两处；可抽测试专用公共实现（`K3-29-disposition-recovery.test.ts:55`、`K3-44-recovery-answers.test.ts:56`）。

UNSPECIFIED：

- **(i) 可接受**，整批未运行②时保留等待（`workflow.ts:2623`）。
- **(ii) 可接受**，保留后续选择的状态并报告首错；不能据此接受上述循环（`workflow.ts:1817`）。
- **(iii) 可接受**，启动重驱已经完成任务，后续确认终态即可（`K3-29-disposition-recovery.test.ts:305`）。
- **(iv) 可接受**，故障文字参数可选，默认值不变（`K3-review-card-fixture.ts:222`）。
- **(v) 可接受**，通过真实计划采用调整顺序，且发生在答复之前（`K3-46-review-advance-failures.test.ts:128`、`K3-46-review-advance-failures.test.ts:308`）。

先改完列出的几处