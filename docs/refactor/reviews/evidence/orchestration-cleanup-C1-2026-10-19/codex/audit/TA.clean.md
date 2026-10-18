本次形成 **11 项发现**，估计可净减生产代码 **326–471 行**，测试暂计 **0 行**。没有找到足够证据支持整文件或整模块删除。主要成本来自重复读取、重复投影和重复的边界处理。

审查基线为 `1e0b1383`。仅做静态读取和检索，没有修改文件、运行测试或构建、联网或调用模型。生产入口沿 `src/app/main.ts:210` → `src/app/host.ts:466` → `src/composition/create-platform.ts:501` 核对。

以下未写目录的源码文件均在 **`src/core/work-graph/tasks/`**；`S/` 表示 **`docs/refactor/design/orchestration-2026-10/slices/`**。行数估算扣除了新增共享实现，不计区域外其他副本的潜在删除收益；各项不重复计数。“行为影响：无”是保留现有语义后的预期，不是测试验证结论。

**TA-1｜类别 4：Host 上下文绑定、写请求隔离重复**

位置及对照证据：

| 职责 | 重复位置 |
|---|---|
| 绑定项目、工作区、Host 身份及材料读取身份；复制身份、保留取消信号 | `claim-service.ts:439–480`；`execution-history-service.ts:151–200`；`run-state-service.ts:202–250`；`execution-entry-service.ts:232–275` |
| 检查并复制 `GraphWrite.input/meta.expected` | `claim-service.ts:485–506`；`execution-history-service.ts:206–227`；`execution-entry-service.ts:279–300` |

建议：把相同核心合并到 tasks 内的公共实现，保留各入口的错误文案、返回形状和校验差异。尤其不能直接机械替换：claim 的 signal 判断与其余实现略有不同（`claim-service.ts:449–453`；`execution-entry-service.ts:242–244`）。

`S/slice-3-SPEC.md:356` 明确要求保留 `bindTrustedContext/isolateWrite/checkRunPin` 及准入顺序，因此保留这些入口，将内部重复实现下沉。

估计可删：**src 120–160 行；tests 0 行**。行为影响：无。风险：中，涉及授权边界和错误优先级。把握：高。依赖：无，不要求与 TA-7 同做。

**TA-2｜类别 8：施工历史和已失效的阶段说明**

本区估计有 **80–120 行**可以删除或缩短的历史说明、重复叙述；不包括规则理由、并发约束、兼容要求，也不重复计算其他发现涉及的注释。

三个例子：

1. `plan-service.ts:18–28` 仍称只实现初始计划、未来计划统一返回 `unsupported`；实际已有未来计划分派和编译路径（`plan-service.ts:1638`、`:2861`、`:3028`）。
2. `plan-readers.ts:578–579` 仍说明“第一部分只声明，第二部分再实现”，实现已经从 `plan-readers.ts:581` 开始。
3. `model-call-contracts.ts:2–6` 的“skeleton”和从旧目录迁入的历史可以去掉；紧接着的一次性 permit 语义应保留（`model-call-contracts.ts:7–8`）。

建议：删过时施工说明，压缩仅复述代码的段落；保留解释“为什么必须这样”的注释。

估计可删：**src 80–120 行；tests 0 行**。行为影响：无。风险：低。把握：中，数量为人工估算。依赖：无。

**TA-3｜类别 5：一次目标决定读取，重复读取并投影任务事实**

证据：

- `readGoalDecisionCauses` 先取任务行，再取目标显示（`goal-decision-reader.ts:430–434`）。
- 两步分别调用 `queryTaskGraph` 和 `queryGoalDisplay`（`goal-decision-reader.ts:210`、`:266`）。
- 前者读取 Goal/Plan、canonical task facts、GoalPhase，计算 phases、rework 和任务行（`plan-service.ts:1913–1973`）。
- 后者重复这些读取和投影，再形成显示事实（`plan-service.ts:2100–2143`）。
- 生产组合把同一个 planService 注入该读者（`src/composition/create-platform.ts:696`、`:746`）。

建议：在 plan owner 内提供一次事实读取、两种投影的内部组合入口；目标决定读者使用组合结果。保留公开查询接口，以及各自权限、无计划分支、候选计划读取和游标确认。不要用跨调用缓存替代。

估计可删：**src 20–40 行；tests 0 行**。行为影响：无，前提是保留原有失败处理和并发确认。风险：中，组合入口本身有成本，游标处理不能直接拼接。把握：中。依赖：无。

**TA-4｜类别 4：输入声明生成有四份实现**

对照位置：

- 本区：`context-input-service.ts:364–396`、`execution-entry-service.ts:1065–1093`。
- 区域外：`src/core/agent-runtime/context-assembler.ts:442–472`、`src/core/work-graph/views/graph-context-reader.ts:857–886`。

这些位置重复生成 `legacy:` 声明、边声明的 canonical JSON/hash、consumer/upstream 和来源字段。两份本区实现仍有边界差异：entry 对非 v2 直接返回空；context-input 只限制旧 inputRequirements，随后仍处理边（`execution-entry-service.ts:1067`；`context-input-service.ts:364–365`、`:381`）。

建议：合并声明构造的纯函数，调用方保留版本门槛、排列顺序和复制要求。旧声明转换本身必须保留，规格有明确要求（`S/slice-3-SPEC.md:234`），不能以合并为由移除兼容路径。

估计可删：**src 25–35 行；tests 0 行**，未计两个区域外副本的收益。行为影响：无。风险：中，声明 ID 和顺序可能影响已保存的绑定。把握：高。依赖：无；4C 使用的 graph reader 继续保留。

**TA-5｜类别 4：TaskPhaseFacts 的选定事实装配重复**

对照位置：

- `claim-service.ts:233–248`
- `completion.ts:148–161`
- `requeue-service.ts:417–436`
- `plan-readers.ts:1818–1840`

共同部分是寻找 selected Run、取得 applicable reduction，并拼装 taskKind、round、coveringRequeue、originUnresolvable。完成服务的注释甚至要求手工与 claim 实现保持同步（`completion.ts:144–146`）。

建议：共享事实装配函数，保留调用方的差异判断。claim 对缺少已选 Run/reduction 返回空（`claim-service.ts:237–239`）；requeue 还会补读轮次链（`requeue-service.ts:421–428`），这些不属于可删除的重复。状态判断仍交给 state 层。

估计可删：**src 20–30 行；tests 0 行**。行为影响：无。风险：中，不能把几处缺失处理强行统一。把握：中。依赖：无。

**TA-6｜类别 5：决定队列分别扫描同一目标的活动候选和关闭候选**

证据：

- 活动候选枚举读取索引、读取记录、解码（`plan-readers.ts:623–656`）。
- 关闭候选枚举再次执行同一索引与记录读取、解码（`plan-readers.ts:670–705`）。
- 生产调用方为 **1 个模块**，同一次队列读取分别调用两者（`src/core/work-graph/views/decision-read-model.ts:361`、`:378`）。
- 直接测试调用：活动枚举 **1 处、1 文件**，关闭枚举 **0 处**（`tests/work-graph/S5-request-candidates.test.ts:47`）。

建议：一次读取候选记录窗口，再分别生成活动集合与关闭集合。保留关闭链推导和各自错误处理：活动路径跳过解码失败，关闭路径明确拒绝，当前并不完全相同（`plan-readers.ts:638–639`、`:692–697`）。

估计可删：**src 15–25 行；tests 0 行**，区域外调用代码的潜在减少未计入。行为影响：无。风险：中，不能改变关闭历史及失败传播。把握：高。依赖：需同步改调用方；`views/decision-read-model.ts` **K3 会改**，宜协调实施。

**TA-7｜类别 4：版本冲突 current → VersionPin 的转换重复三份**

完全相同的核心循环位于：

- `claim-service.ts:133–143`
- `execution-entry-service.ts:153–163`
- `execution-history-service.ts:107–117`

三处都跳过空 revision、解析 refKey、要求解析结果为对象，并跳过无法解析的键。

建议：合并到 work-graph 的公共持久化读取辅助函数。只合并转换，不合并各服务的整个错误映射。

区域外还有近似实现，但缺少上述对象检查，不能直接视为等价副本（`src/core/work-graph/queries/query-execution.ts:170–181`；`src/core/work-graph/queries/query-job-service.ts:584–595`）。

估计可删：**src 18–22 行；tests 0 行**。行为影响：无。风险：低。把握：高。依赖：无。

**TA-8｜类别 2：没有消费方的返回字段和依赖选项**

对字段名及全部相关调用点检索 `src/`、`tests/` 后：

| 可删部分 | 生产证据 | 测试消费方 |
|---|---|---|
| `VerifiedGovernance` 的四个 revision 副本 | 声明于 `plan-commit-compiler.ts:43–47`，仅在 `plan-readers.ts:861–864` 填入；消费方 **0** | **0** |
| `OriginPlanRead.missing` 及额外 Set | 声明、构造和填充位于 `plan-readers.ts:1848–1853`、`:1870–1885`。`readOriginPlans` 有 **3 个生产调用、2 文件**，均用 `plansByRefKey` 判断缺失：`entry-plan-reader.ts:44–63`、`plan-readers.ts:1506–1515`；missing 消费方 **0** | 直接调用及 missing 消费方 **0** |
| `RunActivityServiceDependencies.batchRuns` | 仅声明于 `run-activity-service.ts:71`；读取和设置它的本服务生产调用方 **0**，组合调用未传它（`src/composition/create-platform.ts:833`） | 本服务该选项的使用方 **0** |

建议：删除上述字段和无用 Set。四个 revision 的本地读取及并发 guards 要保留（`plan-readers.ts:817–820`、`:868–869`）。工作流里真正使用的同名 `batchRuns` 也保留（`src/business/workflow/activity-backfill.ts:110–111`、`:151`）。

估计可删：**src 14 行；tests 0 行**。行为影响：无。风险：低。把握：高。依赖：无。

**TA-9｜类别 5：Proposal DTO 与 origin 分别读取同一条记录**

`readProposal` 和 `readProposalOrigin` 分别计算同一个键、调用 readBatch、查找同一记录（`plan-readers.ts:452–485`）。

`readProposalOrigin` 的生产调用为 **4 处、1 文件**，每处前面已经读过 Proposal：

| 路径 | 首次读取 / 再读 origin |
|---|---|
| Host 替换 | `plan-service.ts:1349` / `:1353` |
| 放弃候选 | `plan-service.ts:2356` / `:2364` |
| 采用读取 | `plan-service.ts:2807` / `:2817` |
| Agent 替换 | `plan-service.ts:3247` / `:3251` |

直接测试调用 `readProposalOrigin`：**0**。

建议：内部读取结果保留同一份 EncodedRecord，在原有判断位置解码 origin，取消第二次存储读取。不要把 wire origin 混入公开 DTO，也不要提前改变 origin 错误的优先级。保留原 `since` 是规格硬要求（`S/slice-5-SPEC.md:299`）。

估计可删：**src 8–15 行；tests 0 行**。行为影响：无。风险：中，需保持采用/替换前的状态判断顺序。把握：高。依赖：无。

**TA-10｜类别 4：目标等待链查环重复**

设置目标等待关系和处理目标冲突，分别实现同一套最多 64 层的 predecessor 遍历：

- `goal-settings-service.ts:389–407`
- `goal-settings-service.ts:777–794`

两处都维护 seen 集合，逐个读后继，传播读取失败，未在上限内结束则返回 capacity。

建议：合并为本文件的局部函数，参数为待设置目标和起始 predecessor。保留 64 层上限、错误传播和 state 调用；无等待环是正式规则（`S/slice-5-SPEC.md:506`）。

估计可删：**src 6–10 行；tests 0 行**。行为影响：无。风险：低。把握：高。依赖：无。

**TA-11｜类别 5：一次进入授权，manifest 正文读取和校验两次**

证据：

- 先为 continuation brief 读取 manifest（`execution-entry-service.ts:1528–1535`）。
- 随后调用 authorizeAdmission，内部再次用相同 envelope、RunRef 读取（`execution-entry-service.ts:1536–1538`、`:1232`）。
- 每次读取都检查正文摘要、大小、来源并解析、验证 manifest（`execution-entry-service.ts:407–429`）。
- authorizeAdmission 只有上述 **1 个生产调用**，直接测试调用 **0**；底层 manifest reader 的直接测试有 **3 处、2 文件**（`tests/work-graph/A2-step1-manifest.test.ts:22`、`:34`；`tests/work-graph/C2-mailbox-admission.test.ts:55`）。

建议：把第一次读取的完整结果，包括失败结果，传给 admission；两处验证仍在各自原位置执行。规格要求守卫顺序不变，并明确 Artifact 是不可变内容地址（`S/slice-3-SPEC.md:267`、`:356`）。

估计可删：**src 约 0 行；tests 0 行**。主要收益是每次少一次正文读取、摘要计算和解析。行为影响：正常行为无；不得提前返回而改变拒绝优先级。风险：中。把握：高。依赖：无；保留导出的 manifest reader，K3 还要使用它（`.lead-ref/slice-K3-SPEC.v7.md:1442`）。

**按类别汇总**

| 类别 | 发现 | src 净减估计 | tests 净减估计 |
|---|---|---:|---:|
| 1 整文件／模块不需要 | — | 0 | 0 |
| 2 死字段／选项 | TA-8 | 14 | 0 |
| 3 被替代的旧路径 | — | 0 | 0 |
| 4 重复逻辑 | TA-1、4、5、7、10 | 189–257 | 0 |
| 5 一次调用内重复工作 | TA-3、6、9、11 | 43–80 | 0 |
| 6 纯转发层 | — | 0 | 0 |
| 7 仅数据库篡改可触发的防御 | — | 0 | 0 |
| 8 注释 | TA-2 | 80–120 | 0 |
| **合计** | **11 项** | **326–471** | **0** |

测试没有计删除收益：这些建议主要合并实现，原有行为断言仍有价值。没有额外凑满 50 项的候选清单。

**留给后面的片**

以下均未计入可删行数。

| 保留部分 | 代码位置 | 后续规格依据 |
|---|---|---|
| 任务终态原因、结束时间；游标比较 | `plan-readers.ts:1953–1980`、`:346–363` | 4C updateDue；`S/slice-4-SPEC.md:749`，`.lead-ref/updatedue-facts.md:3–5`、`:12` |
| TaskRequeue 编解码、项目排序索引、按任务找 Run 的索引 | `claim-record-codecs.ts:58–74`、`:701–719`；`plan-readers.ts:89` | 4C 返工触发来源；`.lead-ref/updatedue-facts.md:6`、`:12` |
| 请求事实读者及 `currentSecretary: null` 过渡值 | `request-facts-reader.ts:84–111` | 6A 替换过渡读取；`S/slice-6-SPEC.md:55`、`:251`、`:382` |
| Session 等待事实及派工衔接 | `session-facts.ts:210–332`；`claim-service.ts:709–807` | 7B 重做等待与唤醒；`S/slice-7-SPEC.md:61`、`:685` |
| Run 核对、未知结果认定契约 | `run-reconcile-contracts.ts:43–78` | **K3 会改**；`.lead-ref/slice-K3-SPEC.v7.md:955–964` |
| manifest reader 的公共入口 | `execution-entry-service.ts:392–429` | K3 定稿复用；`.lead-ref/slice-K3-SPEC.v7.md:1442`。TA-11 只消除一次调用里的重复读取 |
| Task 行、返工历史和目标显示能力 | `plan-service.ts:1964–1982`、`:2087–2181` | E3 接界面；`docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:66`、`:87`、`:119` |

另有两处容易误判，但当前规格已经要求保留：

- `session-provenance-facts.ts:100–616` 的旧 Session 来历取证有正式算法和模块归属要求，不能因名称含 legacy 删除（`S/slice-1-SPEC.md:194`、`:634–636`）。
- `run-activity-codecs.ts:1–11` 虽然是转出层，但规格明确要求保留该路径，并说明模块边界原因（`S/slice-2B-SPEC.md:956`）。

**建议先做的五项**

1. **TA-8**：消费方为零，边界最清楚，能先验证删除成本。
2. **TA-7**：三份核心实现相同，影响范围小。
3. **TA-1**：节省最多；先保留入口和错误差异，再合并共享核心。
4. **TA-4**：声明 ID 生成规则分散在四处，合并能减少后续规则漂移。
5. **TA-9**：四条真实生产路径都有重复记录读取，收益和保留条件明确。

TA-3、TA-6 放在这五项之后：它们需要复核并发窗口和失败传播；TA-6 还应与 K3 的决定读模型改动协调。