本区核实到 **10 项候选，预计净减 src 625–895 行、tests 6–10 行**。其中约 300–450 行是注释。没有核实到可以整块删除的业务模块；主要成本来自重复校验、重复解析、旧接口和中间结果类型。

基于 `1e0b1383`，全程只读，未改文件、运行测试或构建、联网或调用其他模型。环境没有 `rg`，引用检索使用 `git grep`。生产入口核到 `src/app/host.ts:466` → `src/composition/create-platform.ts:501`，材料和证据服务分别在后者 `:588`、`:809–821` 装配。

下文 `persistence/`、`evidence/`、`materials/` 等路径均相对 `src/core/work-graph/`；以 `src/`、`tests/`、`docs/` 开头的路径相对仓库根。行数是净节省估计，扣除必要替代代码；注释统一计入 PE-1，避免重复计数。测试流程仍有价值的，只迁移调用，不计作可删除测试。

**PE-1｜类别 8｜压缩复述实现和施工历史的注释**

- **位置、证据：** 本区约 1,447 行整行注释，估计其中 **300–450 行**可删除或缩短。三个例子：
  1. `persistence/execution-history-codecs.ts:17–25` 逐项列出字段和大小关系，下面 `:100–127` 已直接表达这些判断。
  2. `materials/record-readers.ts:1–21` 混合模块职责、已删除材料授权的历史、禁止哪些依赖；可保留职责和持久化不改写语义，删去施工经过。
  3. `evidence/evidence-service.ts:765–770` 仍写着自动重查策略“行为在第二部分落地”；实际策略已在 `src/composition/create-platform.ts:804–816` 注入。
- **建议：** 删复述和过期施工说明；保留解释历史兼容、并发顺序、权限边界的注释。
- **估计可删：** src **300–450**；tests **0**。
- **行为影响：** 无。
- **风险／把握：** 低／中。注释总数是静态统计，可删比例是人工估计。
- **依赖：** 无；其余条目删除的注释也归这里，不重复加总。

**PE-2｜类别 4｜持久化 codec 重复实现基础字段工具**

- **位置、重复证据：**
  
  | 第一处 | 重复处 |
  |---|---|
  | `rework-codecs.ts:23–40`：对象、非空串、整数、摘要、允许字段集合 | `execution-entry-codecs.ts:54–74`、`run-activity-codecs.ts:61–93` |
  | `decision-record-codecs.ts:109–132` | `line-settings-codecs.ts:79–102` |
  | `control-record-codecs.ts:141–148`：解析对象，失败返回 null | `evidence-record-codecs.ts:142–149`、`execution-history-codecs.ts:78–85`、`execution-entry-codecs.ts:653–660` |
  | `record-codecs.ts:100–109`：带标签的对象解析 | `plan-record-codecs.ts:110–119` |

  这组基础函数定义合计约 **256 行**，尚未包含业务字段校验。
- **建议：** 合并同义实现，优先复用 `rework-codecs.ts:23–40` 已有工具；两种解析错误约定分别保留一个实现。不要把“正整数”“非负整数”或不同未知字段策略强行合成同一规则。
- **估计可删：** src **150–190**；tests **0**。
- **行为影响：** 无；保留现有错误文字和判断顺序。
- **风险／把握：** 低至中／高。
- **依赖：** 无。PE-3 可随后复用这些工具；schema 专项估算与本项重叠。

**PE-3｜类别 4｜置顶设置事件复制了决定事件的公共校验**

- **位置、重复证据：**
  - 事件外壳：`persistence/line-settings-codecs.ts:109–118` 对照 `decision-record-codecs.ts:136–143`。
  - 内外事件字段一致性：前者 `:121–126` 对照后者 `:151–160`。
  - Actor 校验：前者 `:130–144` 对照后者 `:164–178`，判断及错误文字基本相同。
  - 公共正文身份字段：前者 `:147–158` 对照后者 `:404–421`。
- **建议：** 合并公共事件校验到 `decision-record-codecs.ts` 的共用函数；置顶文件只保留自己的 payload 规则、事件名称、编解码入口和注册。
- **估计可删：** src **55–75**；tests **0**。不包含 PE-2 的基础函数。
- **行为影响：** 无，三个事件类型及其存储格式保留。
- **风险／把握：** 低至中／高。
- **依赖：** 无；与 PE-2 一起做可减少重复编辑。

**PE-4｜类别 6｜材料服务只剩一个消费者，却保留两套读取结果协议**

- **位置：** `materials/material-service.ts:25–52`、`:82–113`、`:176–213`。
- **证据：**
  - `createMaterialCore` 只有 **1 个生产调用、0 个测试直接调用**，就在同文件 `:117`。
  - 内层先造 `MaterialReadOutcome`／`MaterialReadFailure`，外层在 `:177` 再转换成公开的 `ReadResult`。
  - 存储失败又先经 `fromStoreFailure`（`:203–213`），再经 `coreReadFailure`（`:182–192`）。说明这一分层用于兼容旧 `ArtifactPort` 的注释仍在 `:25–26`，本文件实际只导出 `createMaterialService`（`:116`）。
- **建议：** 将内层读写函数并入材料服务，直接返回公开结果；合并失败映射。保留授权、输入隔离、取消检查和正文上限。
- **估计可删：** src **45–60**；tests **0**。
- **行为影响：** 无。
- **风险／把握：** 中／高。尤其要保留 await 前后取消检查；相关行为已有 `tests/data/R3b-material-await-boundaries.test.ts:31–50` 的服务入口覆盖。
- **依赖：** 无。

**PE-5｜类别 5｜一次 codec 解码重复解析相同 JSON**

- **位置、重复证据：**
  
  | 首次解析 | 随后再次解析 |
  |---|---|
  | `persistence/control-record-codecs.ts:410` | 同文件 `:434–436` |
  | `persistence/evidence-record-codecs.ts:353` | 同文件 `:388–390` |
  | `persistence/plan-record-codecs.ts:913` | 同文件 `:1069–1071` |
  | `materials/record-readers.ts:194` | `materials/run-snapshot-decoder.ts:38–41` |
  | `materials/record-readers.ts:387` 调用对应 validator | 同文件 `:391` |

  区外也有同形路径：`queries/query-record-codecs.ts:725–729`、`sessions/message-record-codecs.ts:1216–1220`。后者 **K3 会改**，本项行数不计这两个区外文件。
- **建议：** 用一个内部函数返回“已检查的正文”；RecordStore 注册回调仍返回原 EncodedRecord，公开 decoder 从同一正文构造 DTO。Run decoder 直接调用这个函数，取消从注册表寻找 validator 再解析的绕行。
- **估计可删：** src **25–45**；tests **0**。主要收益是减少解析和分配，行数收益有限。
- **行为影响：** 无。公开 DTO 的默认值、旧格式转换、隐藏 origin 字段仍保留。
- **风险／把握：** 中／高。不能直接把所有 decoder 改成返回原始正文：Goal 有历史默认值，轮次会去掉 wire 字段，见 `record-codecs.ts:791–819`、`evidence-record-codecs.ts:363–390`。
- **依赖：** 无；可作为 schema 改造的前置步骤。

**PE-6｜类别 3｜旧轮次查询只是新链头查询的别名，调用方仍走双路径**

- **位置：** `evidence/evidence-service.ts:1215–1230`；区外联动 `model/evidence-contracts.ts:49–53,132–135`、`src/business/workflow/workflow.ts:927–935`。
- **证据：**
  - 旧口只额外检查可选 `planRef`，最后调用 `queryRoundChainHead`（`:1230`）。
  - 新口已接受具体 Run 或 gate 的 null Run（`:1180–1205`）。
  - 生产业务调用 **1 处**：Workflow `:932`，不传 `planRef`；组合根另有 **1 处转发**：`src/composition/create-platform.ts:1109`。
  - 测试引用 **6 文件**：  
    `tests/business/A2-workflow-auto-rework.test.ts:234`、`A2-workflow-reverify.test.ts:205`；  
    `tests/composition/A2-verification-chain-platform.test.ts:320`、`R5c-workflow-platform.test.ts:507–508`；  
    `tests/work-graph/A2-verification-chain.test.ts:205–209`、`R3e-reverify.test.ts:325`。  
    共 5 次实际调用、2 个 mock 定义、1 个属性存在断言。
- **建议：** 合并到 `queryRoundChainHead`；Workflow 统一传 `{subject, subjectRunRef}`，删除旧类型、转发和仅为旧参数存在的断言。
- **估计可删：** src **25–35**，其中约 9–15 行在区外；tests **6–10**。
- **行为影响：** 工作流和用户可见行为无变化；平台 TypeScript 对象删去旧别名。后续界面明确使用新口，见 `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:74`。
- **风险／把握：** 中／高。若 lead 另有未记录的外部 TypeScript API 兼容承诺，应暂留别名；本仓库未发现其他消费者。
- **依赖：** 旧口、Workflow 分支、平台转发和测试替身必须一起迁移。

**PE-7｜类别 5｜轮次更新为了保留 origin，再读一次刚读过的记录**

- **位置：** `evidence/evidence-service.ts:296–319,350–354,418–431`。
- **证据：**
  - 开始检查、记录结果、中断／放弃、定案都先调用 `readRoundRecord`：`:1260`、`:1343`、`:1434`、`:1494`。
  - 随后更新提交在 `:352` 调用 `preservedRoundNoticeOrigin`，它在 `:302` 再读同一个 ref。
  - 第一次解码在 `persistence/evidence-record-codecs.ts:363–390` 去掉 origin，导致提交阶段重新取回它。
- **建议：** 内部读取同时返回 `{round, origin}`；公开接口仍只返回 round。提交使用第一次读取的 origin，保留现有 revision guard。
- **估计可删：** src **15–25**；tests **0**。
- **行为影响：** 无。保留字段是硬要求，省的是第二次读取：`docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md:415–421` 明确要求保留 `finalizedAt`。
- **风险／把握：** 低至中／高。origin 必须和被 guard 的轮次来自同一次读取，不能跨调用缓存。
- **依赖：** 无；PE-5 可以共用“正文与公开 DTO 分开”的内部结果。

**PE-8｜类别 2｜少量参数和错误码只有声明，没有消费**

- **位置、调用证据：**
  - `evidence/verification-plan.ts:25–46`：`unknown_check`、`no_check_coverage` 从未返回；`selection`、输入 `schemaVersion`、`policy.fastPathDiffClasses` 未被函数读取。生产调用 **1 处**：`evidence-service.ts:945–953`；测试调用 **1 处**：`tests/work-graph/R3e-evidence-coverage.test.ts:92–100`。生产还在 `:949–951` 复制无人消费的 fast-path 配置。
  - `persistence/read-result-failures.ts:30–36`：可选 `current` 及其分支没有调用者。全 src 的 **34 个调用、8 个文件**均只传第一参，tests 直接调用 **0**。调用文件为 `tasks/goal-executed-files-reader.ts:93`，以及 `views/` 下 `activity-read-model.ts:246`、`automatic-rework-notices.ts:316`、`decision-read-model.ts:295`、`goal-conflicts.ts:110`、`task-state-timeline.ts:175`、`track-read-model.ts:225`、`undelivered-reply-notices.ts:122`。
- **建议：** 删上述未消费字段、复制代码、不可产生的错误码和 `current` 分支。不删其他模块实际使用的 fast-path 配置。
- **估计可删：** src **6–9**；tests **0**，只需调整编译器输入夹具。
- **行为影响：** 无。
- **风险／把握：** 低／高。
- **依赖：** 无。

**PE-9｜类别 3｜证据服务的静态配置回退已被组合根的统一解析器覆盖**

- **位置：** `evidence/evidence-service.ts:797–803,1031–1033,1988`。
- **证据：**
  - 唯一生产装配在 `src/composition/create-platform.ts:809–821`，始终传 `configurationFor`，同时还传旧 `configuration`。
  - 服务选择规则是“有解析器就只调用解析器”，不是“解析器没有结果再回退”。
  - 解析器自身已经按作用域回退到 `options.checks`，见组合根 `:680–684`。
  - 测试仍使用旧参数，例如 `tests/helpers/R3e-evidence-fixture.ts:325`、`tests/helpers/S2A-notices-support.ts:313`、`tests/work-graph/R3e-reverify.test.ts:497–499`。
- **建议：** 服务只接受配置解析器；静态配置夹具改为返回该配置的函数。组合根继续承担静态配置回退。
- **估计可删：** src **4–6**，含组合根约 1 行；tests **0**。
- **行为影响：** 无；没有配置时仍返回现有不支持结果。
- **风险／把握：** 低／高。夹具迁移数量比节省行数大，优先级较低。
- **依赖：** 服务依赖类型、组合根与夹具同步修改。

**PE-10｜类别 5｜同一轮每个检查重复计算相同的计划适用性**

- **位置：** `evidence/evidence-service.ts:1567–1582`。
- **证据：**
  - 循环中每份候选证据的 subject 都来自同一 round，anchor 都由同一 round 构造，见 `:1569–1572`、`:226–230`。
  - 每次调用 `tasks/evidence-coverage.ts:153–198`，实际用于判定的是 task、两份计划和 anchor；每次又重建两份定义表和两份 basis 表（`:161–167`）。
  - 定义表构造遍历计划集合，见 `tasks/plan-task-basis.ts:158–189`。
  - 此 helper 有 **2 处生产调用**：本处和 `tasks/completion.ts:412`；直接测试 **2 文件、3 处调用**：`tests/scenarios/C7-defer-reactivate.test.ts:251`、`tests/work-graph/R3e-evidence-coverage.test.ts:116,132`。
- **建议：** 仅在本次 finalize 调用内惰性计算一次，供这一轮各 check 使用；保留每个 check 的证据、覆盖和状态机归约。
- **估计可删：** src **0**；tests **0**。这是运行成本项，不把减少遍历冒充删行收益。
- **行为影响：** 无。
- **风险／把握：** 低至中／高。不要将这个缓存推广到不同 subject 或不同计划的证据集合。
- **依赖：** 无。

汇总如下。类别 1、7 没有达到报告门槛的发现；不能据此推断相关代码完全没有简化空间。

| 类别 | 编号 | src 净减行数 | tests 净减行数 |
|---|---|---:|---:|
| 1 整文件／模块 | — | 0 | 0 |
| 2 死代码、未用参数 | PE-8 | 6–9 | 0 |
| 3 被替代的路径 | PE-6、PE-9 | 29–41 | 6–10 |
| 4 重复逻辑 | PE-2、PE-3 | 205–265 | 0 |
| 5 单次调用重复工作 | PE-5、PE-7、PE-10 | 40–70 | 0 |
| 6 中间适配层 | PE-4 | 45–60 | 0 |
| 7 仅数据库篡改可达的防御 | — | 0 | 0 |
| 8 注释 | PE-1 | 300–450 | 0 |
| **合计** | **10 项** | **625–895** | **6–10** |

没有另藏超过 50 项的候选。未将 codec 的坏字段校验普遍算作可删防御：第 5 片明确要求坏 ref、枚举、浮点、负 order、损坏 JSON 返回 unavailable，见 `slice-5-SPEC.md:155`。

“留给后面的片”如下，均不计入节省：

| 保留项 | 代码位置 | 后续用途／规格 |
|---|---|---|
| 计划版本按 Goal、采用时间查询 | `persistence/plan-record-codecs.ts:1155–1161` | 4C 更新提醒；4 片 L9、L16、M-12：`slice-4-SPEC.md:154,216–219,646,749`；索引定义来自 2B L14 `:407` |
| Task 结束事实、返工、归档及图邻接读取 | 用户指定的完整 4C reuse list | 按 `.lead-ref/updatedue-facts.md:3–16` 保留；没有把它们列为低使用率代码 |
| agent 重查的准入和委托依赖 | `evidence/evidence-service.ts:818–820,1796` | 第 7 片 L19：`slice-7-SPEC.md:164`；工具待接线也不能删服务能力 |
| reviewerEvidence 输入及独立审阅接缝 | `evidence/evidence-service.ts:1463–1477` | DESIGN §2.9：`DESIGN.md:549–561` 明确放在第 9 片 |
| 消息记录 codec 的决定／应用字段 | `sessions/message-record-codecs.ts:594–657` | 后续决定流程继续使用；该文件 **K3 会改**，schema 迁移应避开并行施工 |
| 已存在的历史兼容和 origin 字段 | `persistence/record-codecs.ts:791–819`、`evidence-record-codecs.ts:363–390` | 这是当前要求，也不能删：第 5 片 `:164–166`，第 2B 片 `:415–421` |

我会先做这五项：

1. **PE-8**：没有消费的参数和错误码，改动小、判断明确。
2. **PE-2**：本区最扎实的代码行收益，可逐组等价合并。
3. **PE-4**：去掉一整套内部结果转换，减少以后维护两种协议的成本。
4. **PE-7**：既简化代码，又少一次实际读取，保持原 revision guard。
5. **PE-5**：先统一“解析一次”的内部接口，为之后的 schema 改造降低难度。

**整体做法问题：按 schema 生成编解码**

我的判断是：**值得做，但放在上述普通删除和合并之后，先试一组，再决定是否扩展。** 不建议一次重写全部 codec。

指定的 12 个文件——持久化层 codec，加 query、message codec，排除 note——共约 **8,300 行**。按函数职责粗估，约 **4,300–5,100 行**属于字段形状、枚举、数组遍历、ref、记录／事件外壳和错误报告的手写检查。估计用声明式 schema 加少量专用校验替代后，**净减手写 src 约 1,500–2,300 行**；这不是可以整段直接删除的数量。

主要依据：

| 检查群 | 代表位置 | 适合声明的部分 |
|---|---|---|
| Goal、Workspace、Plan | `persistence/record-codecs.ts:204–454`；`plan-record-codecs.ts:333–668,884–924` | 字段形状、可选性、枚举、集合及记录外壳 |
| 执行、控制、证据 | `execution-entry-codecs.ts:118–594`；`control-record-codecs.ts:198–421`；`evidence-record-codecs.ts:190–359` | 带判别字段的联合类型、引用、整数、可选历史字段 |
| 决定、置顶、活动 | `decision-record-codecs.ts:297–460`；`line-settings-codecs.ts:109–164`；`run-activity-codecs.ts:125–343` | 公共事件字段、嵌套记录、数组项、顺序约束 |
| Query、消息 | `queries/query-record-codecs.ts:237–482`；`sessions/message-record-codecs.ts:386–922` | 大量重复嵌套字段检查；消息文件 **K3 会改** |

代价不只是写一个 schema 解释器：

- **必须区分存储正文和公开返回。** Workspace 的旧字段不能被默认补写，测试还断言重新编码后的 JSON 不变：`tests/state/S5-notice-settings.test.ts:78–84`。消息记录会补两个 null 默认值，但事件重放保持原字段，见 `sessions/message-record-codecs.ts:1216–1231,1250–1258`。这些转换需要显式保留。
- **不能只保留“合法／非法”。** 现有测试检查错误原因，如 `tests/work-graph/A2-step1-codecs.test.ts:421,499–500,520,536`。schema 要能保留错误码、文字、优先顺序，以及 Plan 的多错误拼接方式：`plan-record-codecs.ts:922–923`。
- **版本规则不能统一成一个整数规则。** 记录外层 revision 必须匹配正文，见 `plan-record-codecs.ts:919–920`；决定证明只有 before pin 接受 revision 0，见 `decision-record-codecs.ts:384–389`。
- **相似检查已有语义差异。** Plan 的 rebase 检查只确认 basis 是对象（`plan-record-codecs.ts:713–721`），决定 codec 会深入检查（`decision-record-codecs.ts:333–358`）；消息 basis 又要求 objective 非空（`sessions/message-record-codecs.ts:450`）。迁移时不能默默选最严格的一份。
- **性能需要后续实测。** PE-5 能直接省掉重复解析；通用解释器若逐字段分配对象、每次重建 schema，可能抵消收益。schema 应在模块初始化时建立，解码时复用。本次没有运行性能测试，不能承诺提速。

建议顺序是：先完成 PE-2、PE-3、PE-5，再以 **决定事件与置顶事件**试点；保留现有测试，验证返回形状、错误结果和历史重放等价。随后扩展到简单记录；Plan、执行记录最后迁移，消息 codec 等 K3 稳定。

上面的 schema 净减数与普通发现有重叠，**不能直接相加**；完成普通清理后，进一步收益粗估 **1,100–1,800 行**，把握中。若生成的展开代码仍提交在 `src/`，总行数未必下降；应分别统计手写维护量和生成物，避免只是把重复代码换了来源。