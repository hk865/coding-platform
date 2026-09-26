# R4c.2a 精确执行事实与定向历史读取

日期：2026-09-25。状态：R4c.2a 子集通过独立验收。前序基线为 [R4c.1](next-r4c-claim-2026-09-24.md) 的 60 文件 / 422 项。

## 范围与复用

本批是 R4c.2 的读取子集，先闭合后续 prepare/entry/reconcile 需要的两项真实查询。不是完整启动、恢复或释放协议，不增加模块/表/锁，也不把 Task Graph 的信息关系升级为硬调度门槛。

| 并行 lane | 真实操作与消费者 | 复用 owner | 未承诺 |
| --- | --- | --- | --- |
| A WorkGraph | `platform.executions.readExecution`；后续 prepare/entry 消费 | RecordStore.readMany 与既有 Run/Attempt/outbox/Plan/Session/Lease codecs | 查询不授予启动权；不做 QueryRun 或入口状态写入 |
| B AgentRuntime | `platform.runtime.readExecutionHistory`；后续 entry/reconcile 与 Host 查证消费 | 已授权的 SessionOperations.readSessionHistory、Kernel 公共 sessionRecordSchema | 原始记录不等于完整终态投影；不输出 completedHistoryBoundary |

A 用前两次精确读取发现引用，最终一次六记录批读返回同窗口事实；无关提交不要求重试。B 每次最多调用一次既有历史页面，稀疏页仍保留底层前进游标，不追读凑满结果。现有 Kernel 每次读取仍全 Session 物化，这项物理成本尚未消除；本子批也尚未接通图中的执行关联与历史区间定位，不能把按身份过滤页面称为已实现索引直达。

**2026-09-25 意图核对：** [用户原话 DLG-037](../intent/ORIGINAL-DIALOGUE.md#dlg-037-用户)已经要求两图组织当前/历史文件、Session、工具结果及编排关系，由原子操作维护并供后续查找和决策。“不复制完整 Kernel 日志”不限制 WorkGraph 保存自身的正式关系、结果、摘要及原历史位置索引；此前“平台不另建投影”的笼统表述收回。图减少重复发现和筛选，原历史读取器按定位结果取原文，两者共同实现性能目标，不把全部优化推给 Kernel。

## 施工顺序

Astra 冻结接口与本批语义 → 两个独立 DSH 4.1F Session 并行做骨架和测试 → Astra 中间审核并冻结测试 → 两个 DSH 实现 lane（仅生产文件可写）→ 主审阅 → next 物理隔离验收。

任务书：[A](../tasks/R4c2a-reads-skeleton-prompt.md)、[B](../tasks/R4c2a-history-skeleton-prompt.md)。模块页已写明本子集与完整目标的区别。主目录组合根接线和集成断言由主审维护，不交两 lane 竞争修改。

## 中间审核

两 lane 各只更改允许的生产骨架和测试文件，audit 无越界/主目录竞争。主审及两位只读审阅者确认复用与边界；修正 B 向底层透传 executionIdentity 的错误断言、A 把缺失误作重试的错误断言，补 actor/深层输入隔离、原始页污染、partial identity、固定扫描上界、明确缺失与未交代键、真实最终窗口与无关提交反例。47 项行为测试在真实 fixtures 完成后因 unsupported 变红，类型检查通过；无跳过或伪实现。

只读冻结清单见 [frozen-tests-and-contracts.json](evidence/next-r4c-execution-reads-2026-09-25/frozen-tests-and-contracts.json)。实现阶段每 lane 仅允许一个生产文件。

## 验收结果

- 最终物理隔离工程：**62 文件 / 473 项测试通过**，类型、构建、模块边界、编译产物实际 create/close 通过。日志：[isolated.log](evidence/next-r4c-execution-reads-2026-09-25/isolated.log)。
- 两条新增套件共 **51 项**：执行读取43、原始历史8；另扩展真实平台装配、关闭排空与公开面断言。两 lane 自检不是唯一依据。
- 主审发现并返修：Run workspace错链漏核、非法cursor容错、最终outbox缺失被误判为引用变化、重复中间读取、损坏历史外壳错误分类；最后严格拒绝可被String转换成游标的数组。每次测试增量均由主审修订并重冻结，见[审核变更](evidence/next-r4c-execution-reads-2026-09-25/reviewed-test-amendments.json)。末次源改动后重新跑完整隔离，先前通过日志单独保留。
- 原工程受保护 **1313 文件零变化**；实现阶段冻结 **134 文件零越权变化**（主审增量在上述变更记录中）；模块仍为5，实际5条/允许8条边。
- 生产 TypeScript：**151 文件 / 25,234 行**，含共享契约56文件/3772行；测试TypeScript65文件/13,911行。比前序生产24412行增加822行；这是新增读取能力，不能据此声称整体代码量或复杂度已下降。冻结Kernel产物另计。[统计与保护](evidence/next-r4c-execution-reads-2026-09-25/metrics-and-protection.json)。

## 后续直接复用与未完成项

后续 `prepare/entry` 消费 WG11 的正式执行事实，再复用原 `readTaskInput`、角色/材料规则和 `runObservedModel`。正式入口仍须按已有模块设计核当前许可并 fresh-begin，固定平台Run与Kernel身份绑定；本批没有发布这种授权或驱动能力。

RT7 给出有界原始页面，不是完整 Turn投影或完成边界证明。首次 afterCursor=null 仍从 Session 开头查起；其 afterCursor 只接收本操作的续页游标，尚无消费图中任意历史起点的入口。后续应复用 WorkGraph 的执行/Session/证据关联与 RecordStore 索引，在真实进入及结果回流时维护可信 Kernel 身份和历史位置，读取时使用这些位置，避免重复发现。原始日志正文及物理区间读取仍由 Kernel 负责，当前每页全 Session 物化的问题也要在该实现处消除；两项工作不能互相替代，不另造整份 transcript 或平行的图系统。

当前返回完整 Plan，其解码成本也仍受 Plan 大小影响，固定三次读取不能宣传为所有数据处理成本恒定。以上定位与性能接线未包含在本次 473 项验收完成范围内。

Query、观察归约与释放、R3其余业务、R4后续控制/恢复/并行结果处理、R5 Workflow、R6 Host/UI仍未全部完成。
