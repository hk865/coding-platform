本次确认 **9 项候选，估计净减 src 约 238 行、tests 约 29 行**。其中 ST-1 的约 95 行来自 state/model 跨目录合并，不能全部算成 state 自身缩减。没有找到证据足够的整文件删除项。

只做了读取和检索；没有修改文件、运行测试或构建、访问网络、调用模型。以下行号对应 `1e0b1383`。生产调用从 `src/app/host.ts:466`、`src/composition/create-platform.ts:501` 向下核对；计数指调用位置，不是运行次数。行数均为扣除替代代码后的估计，尚未经补丁验证。

**ST-1｜类别 4：消息和计划记录类型各维护两份**

- **位置及重复证据：**
  - `src/core/work-graph/state/message-machine.ts:71-167` ↔ `src/core/work-graph/model/communication-contracts.ts:42-180`：发送者、响应、消息记录及接收输入、咨询派生、归档处置等字段重复声明。
  - `src/core/work-graph/state/plan-machine.ts:67-107` ↔ `src/core/work-graph/model/plan-contracts.ts:34-78`：候选引用、变更原因、请求扩展及候选记录联合重复声明。
  - 两组另外各用一个测试维持类型相等：`tests/state/message-machine.test.ts:924-928`、`tests/state/plan-machine.test.ts:298-302`。
- **建议：** 合并为单一定义。可保留 state 定义，model 使用类型别名或转出，保留现有导出名；把仍有价值的字段说明集中到定义处。该方向符合已有 `model → state` 例外，不能反向引入依赖，见 `docs/refactor/module-target.json:32-38`。
- **估计可删行数：** src **95**；tests **10**。主要收益在 model，类型搬移本身不计收益。
- **行为影响：** 无；不改记录字段、可选性、编码和构造器。
- **风险：** 中。需要保留联合类型的区别及字段上的规格说明，不能只按名字批量替换。**把握：高。**
- **依赖：** 无；两组可分别做。

**ST-2｜类别 2：Attempt 生成了一份生产方完全不读取的副作用结果｜K3 会改**

- **位置：** `src/core/work-graph/state/attempt-machine.ts:203-207`、`:507-512`、`:571-690` 中生成副作用数组的部分。
- **证据：**
  - `transitionAttempt` 有 **2 个生产调用位置**：`src/core/work-graph/tasks/claim-service.ts:399-401`、`src/core/work-graph/tasks/execution-entry-service.ts:965-968`。两处都检查成功与否、取 `next`，不读取它的 `effects`。
  - 真正的 Outbox、租约和 Session 操作由另一份 Run 副作用驱动：`src/core/work-graph/tasks/execution-entry-service.ts:954-992`；释放选择已在 `src/core/work-graph/state/run-machine.ts:1873-1883` 推导。
  - 测试直接调用共 **25 处、1 个文件**，分布在 `tests/state/attempt-machine.test.ts:289-736`。其中纯副作用所有权组合断言在 `:580-594`，对应常量在 `:197-200`。
- **建议：** 删无人消费的 `AttemptEffect` 输出及其组装，保留 Attempt 状态迁移和守卫；实际副作用继续由 Run/state 路径负责。
- **估计可删行数：** src **35**；tests **19**。其他迁移、配对、Outbox、租约测试保留。
- **行为影响：** 无。规格确实要求这些副作用，见 `docs/refactor/STATE-MACHINES-SPEC.md:1388-1398`；本项只删第二份未被执行的描述，不删规格要求的写入或检查。
- **风险：** 中。必须逐项确认 Run 输出覆盖原副作用，并保留所有权条件。**把握：高。**
- **依赖：** 无；应与 K3 对该文件的修改协调，避免两次改接口。

**ST-3｜类别 4：暂停时的自动化卡片重新实现了一部分 AV/GV 判断｜K3 会改**

- **位置及重复证据：**
  - 暂停卡片判断：`src/core/work-graph/state/decision-policy.ts:214-255`。
  - 执行准入判断：`src/core/work-graph/state/task-failure.ts:808-884`。
  - 两边都判断自动次数上限、轮次链上限、宿主中断豁免，以及仍有效的 `no_new_basis`、`verification_uncovered`、`source_unchanged` 拒绝；后一处已经有局部共用的 `reverifyHeadStop`，见 `:842-851`。
  - 暂停判断有 **1 个生产调用位置**：`src/core/work-graph/tasks/goal-decision-reader.ts:361-371`。测试没有直接调用该函数；相关业务覆盖在 `tests/business/S5R2-automation-cards.test.ts:143` 所在用例。
- **建议：** 合并相同的资格与停止原因判断；保留执行入口和暂停展示入口各自的外围规则。
- **估计可删行数：** src **25**；tests **0**。
- **行为影响：** 无。不能直接用现有 `automationVerdict` 替换暂停入口：它在目标不活跃时提前返回，见 `src/core/work-graph/state/task-failure.ts:766`、`:859`。暂停不能使卡消失是明确要求，见 `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md:1365`。
- **风险：** 中。须保留暂停展示、开放轮次先定稿、预算耗尽等差异，不能合并成一个无区别的布尔判断。**把握：中。**
- **依赖：** 无；适合随 K3 一起处理，其规格也要求多处卡片推导共用规则，见 `.lead-ref/slice-K3-SPEC.v7.md:544-546`。

**ST-4｜类别 4：工作线摘要和详情各枚举一次同样的关注来源**

- **位置及重复证据：**
  - `src/core/work-graph/state/line-status.ts:699-732`。
  - `src/core/work-graph/state/line-status.ts:748-761`。
  - 两处依次处理任务、卡片、线级未知状态和待接手锚点，重复卡片原因及锚点是否存在的判断。
  - 两个出口各有 **1 个生产调用位置**：`src/core/work-graph/views/work-line-reader.ts:533`、`:3095`。
  - `deriveLineStatus` 在 `tests/state/S2C-line-status.test.ts:137-208` 有 **7 个直接调用位置**；`deriveAttentionAll` 无直接测试调用。
- **建议：** 合并为一个关注候选枚举函数；摘要从候选计算优先项和计数，详情从候选生成完整列表。
- **估计可删行数：** src **25**；tests **0**。
- **行为影响：** 无。保留摘要的完整性标志、优先级和稳定排序，也保留详情的真实来源。完整关注列表是要求，不能删除，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:716`。
- **风险：** 中。摘要中的不可读标志与详情中的来源引用不同，需随候选一起保留。**把握：高。**
- **依赖：** 无；ST-9 可独立先做。

**ST-5｜类别 8：少量施工历史和过期审查说明可以清除**

- **位置与三个例子：**
  1. `src/core/work-graph/state/message-machine.ts:210`：仍说字段名将在第一阶段审查时冻结。
  2. `src/core/work-graph/state/plan-machine.ts:417`：同样的待冻结说明。
  3. `src/core/work-graph/state/session-availability.ts:244-247`：说明逻辑原来复制在哪两个旧行号；保留当前归属判断和职责说明即可。
- **建议：** 删过期施工安排、审查轮次身份和纯搬迁历史；压缩只复述相邻代码的说明。
- **估计可删行数：** 全区域约 **20 行 src**；tests **0**。不包括其他发现已计入的重复声明注释。
- **行为影响：** 无。
- **风险：** 低。规格映射长注释明确要求保留，不能把它们算入收益，见 `docs/refactor/HANDOFF.md:125`。**把握：中**，这里是区域估算，不是逐行删除清单。
- **依赖：** 无。

**ST-6｜类别 5：一次重排迁移重复派生和校验同一组事实**

- **位置及重复证据：**
  - `src/core/work-graph/state/task-machine.ts:1243-1256` 计算操作者类别、返工分类、权限、预算与自动次数。
  - 随后 `:1261` 调用 `newTaskRequeueRecord`；构造器在 `:702-718` 再计算操作者、分类、组合合法性、自动次数及上限。
  - 自动次数并非纯字段读取：`src/core/work-graph/state/task-failure.ts:467-510` 包含历史链查找。
  - 构造器有 **1 个生产调用位置**，就是上述 `:1261`；测试有 **18 个直接调用位置、1 个文件**，见 `tests/state/task-machine.test.ts:1226-1422`。
- **建议：** 简化为 state 内一次派生、一次准入，然后用已经核准的事实构造记录。保留构造器独有的主体、触发与依据检查。
- **估计可删行数：** src **15**；tests **0**。
- **行为影响：** 无；TaskRequeue 字段、编码和索引不变。
- **风险：** 中。两层现在使用不同的拒绝表达，合并时必须保留外部拒绝码及判断顺序。**把握：高。**
- **依赖：** 无；不涉及删除 4C 复用的数据。

**ST-7｜类别 4：两个逐字相同的递归引用比较器**

- **位置及重复证据：**
  - `src/core/work-graph/state/session-anomaly.ts:93-105`。
  - `src/core/work-graph/state/session-availability.ts:1044-1056`。
  - 两者都处理同一引用、空值、数组、对象键数和递归值比较。前者有 **2 个非递归使用位置**，见 `:63-64`；后者有 **3 个**，见 `:252`、`:513`、`:1036`。两者均为私有函数，无外部直接测试调用。
- **建议：** 合并成 state 内一个共用比较函数，保留原语义。
- **估计可删行数：** src **11**，已扣除共用实现及导入；tests **0**。
- **行为影响：** 无。
- **风险：** 低。不要未经核对改用 `sameJson`：它对不能编码的值返回 false，语义并不完全相同，见 `src/contracts/fingerprint.ts:50-57`。**把握：高。**
- **依赖：** 无。

**ST-8｜类别 5：生成同一任务的失败事实时，重复构造 WorkView/GateView**

- **位置及重复证据：**
  - 唯一生产调用把两个计算直接嵌套：`src/core/work-graph/tasks/plan-service.ts:882`。
  - 内层 `automationVerdict` 在 `src/core/work-graph/state/task-failure.ts:690-695` 构造视图；外层 `buildTaskFailureFacts` 在 `:907-923` 再构造一次。
  - WorkView 又进行分类、围栏判断、重排查找、拒绝有效性计算和历史自动次数计算，见 `:735-749`。
  - `buildTaskFailureFacts` 有 **1 个生产调用位置、1 个测试直接调用位置**；测试同样嵌套调用，见 `tests/state/task-failure.test.ts:1041`。
- **建议：** 合并为一次事实归约，在同一视图上同时生成自动化判断、失败事实和返工摘要。
- **估计可删行数：** src **8**；tests **0**。主要收益是少做一次遍历，减行数很小。
- **行为影响：** 无。
- **风险：** 低；保持判断结果和失败事实来自同一输入即可。**把握：高。**
- **依赖：** 无；不要求先做 ST-3。

**ST-9｜类别 2：未知 Run 的退役判断分支永远到不了**

- **位置：** `src/core/work-graph/state/line-status.ts:778-781`。
- **证据：** `:771-774` 已对“Run 已结束且 outcome_unknown”无条件返回；`:778-781` 再加 `health === unavailable` 判断同一条件，并返回完全相同结果。因此后一分支生产、测试均不可达。该私有函数有两个调用位置，见 `:717`、`:756`；无外部直接测试调用。
- **建议：** 删后一分支。
- **估计可删行数：** src **4**；tests **0**。
- **行为影响：** 无。退役线占用者结果未知仍由前一分支覆盖，符合 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1092` 的 AT4。
- **风险：** 低。**把握：高。**
- **依赖：** 无。

按类别汇总，以下不重复计数：

| 类别 | 编号 | src 净减估计 | tests 净减估计 |
|---|---|---:|---:|
| 1 整文件／模块 | 无确证项 | 0 | 0 |
| 2 无生产消费／死分支 | ST-2、ST-9 | 39 | 19 |
| 3 被替代的旧路径 | 无独立确证项 | 0 | 0 |
| 4 重复逻辑／声明 | ST-1、ST-3、ST-4、ST-7 | 156 | 10 |
| 5 单次调用内重复工作 | ST-6、ST-8 | 23 | 0 |
| 6 纯转发层 | 无确证项 | 0 | 0 |
| 7 仅数据库篡改可达的检查 | 无足够依据的删除项 | 0 | 0 |
| 8 注释 | ST-5 | 20 | 0 |
| **合计** | **9 项** | **238** | **29** |

留给后面的片：

| 保留项及代码位置 | 后续用途／规格依据 |
|---|---|
| K3 待核对数量和原因分支：`src/core/work-graph/state/line-status.ts:87`、`:785-787` | K3 的 `pending_review`；2C §L8、AT4，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:337`、`:954`、`:1092`。不能因为当前恒为零而删。 |
| 结构修改、目标修改、预算、升级和换职责等动作：`src/core/work-graph/state/decision-policy.ts:58-64` | 第 7 片 L36 明列仍须用户决定的动作，见 `docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:260-266`。 |
| 干预及退役线咨询的未接通状态：`src/core/work-graph/state/line-status.ts:492-537`、`:620-637` | 第 7 片接入；2C §3.10 明确要求当前返回 `not_yet`，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1204-1215`。 |
| 部分验收显示状态：`src/core/work-graph/state/goal-machine.ts:783`、`:1081` | E3 5.5-4 明列该状态，即使当前不产生；见 `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:122`。产品要求也保留明确接受部分结果，见 `docs/MVP-BEHAVIOR.md:150`。 |
| Attempt 领取依据和接续租约判断：`src/core/work-graph/state/attempt-machine.ts:127-130`、`:722-758` | K3 L10 将加 review 依据，并建立共用 `state/review-lease.ts`；见 `.lead-ref/slice-K3-SPEC.v7.md:312-316`。不能把现有接续判断当作整块废弃。 |
| TaskRequeue 的时间、来源及关联记录：`src/core/work-graph/state/task-machine.ts:719-747` | 4C 复用 requestedAt 及经 Run 查找的重排记录；见 `.lead-ref/updatedue-facts.md:6`、`:12`。ST-6 只合并计算。 |

另有一些测试才触达的分支没有列成删除项：候选计划的只读／不支持迁移在规格中有明确行，见 `docs/refactor/STATE-MACHINES-SPEC.md:557-558`、`docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md:524`。不能仅凭没有生产调用就删除规定的拒绝行为。

最先做的五项：

1. **ST-9**：四行确定死分支，影响最容易核对。
2. **ST-8**：唯一生产组合入口已经证明重复计算，改动集中。
3. **ST-6**：减少同次迁移的重复派生；需重点核对拒绝顺序。
4. **ST-1**：收益最大，且可按消息、计划分两次合并；不涉及运行行为。
5. **ST-4**：统一关注来源，减少摘要与详情以后出现分歧的机会。

ST-2、ST-3 留到 K3 修改相关文件时一起裁定更合适；不把 K3 所需的判断本身列入删除收益。