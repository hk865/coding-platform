本次审计得到 **12 项候选，预计净减 src 约 430 行，tests 0 行**。其中约 100 行是注释；另有三项主要减少重复读取，净删行数保守记为 0。没有找到证据充分、可以整块删除的模块。

基线为 `1e0b1383`。全程只读，没有修改文件、运行测试或构建、联网、调用模型。`rg` 不可用，调用关系以 `git grep` 检索 `src/`、`tests/`，再沿组合根和路由核对。日历、工作线、悬停等已有生产入口，不能因为界面尚未接完就判死代码：`src/composition/create-platform.ts:838–843`、`src/app/core-routes.ts:412–423`。

以下行数均为**扣除新增共享实现后的净减粗估**，不重复计算被其他项删除的注释。tests 为 0 表示没有证据支持删除测试；部分夹具仍需调整装配参数。

**VW-1｜类别 4：三份相同的 2B 存储读取辅助实现**

- **位置与证据：**

  | 职责 | 第一处 | 重复处 |
  |---|---|---|
  | 读预算、超限异常 | `src/core/work-graph/views/activity-read-model.ts:144–161` | `src/core/work-graph/views/track-read-model.ts:158–182`；`src/core/work-graph/views/task-state-timeline.ts:88–108` |
  | 等值索引翻到底 | `src/core/work-graph/views/activity-read-model.ts:206–226` | `src/core/work-graph/views/track-read-model.ts:187–207`；`src/core/work-graph/views/task-state-timeline.ts:135–155` |
  | 按键读取，未命中也计一次 | `src/core/work-graph/views/activity-read-model.ts:229–240` | `src/core/work-graph/views/track-read-model.ts:210–221`；`src/core/work-graph/views/task-state-timeline.ts:158–169` |
  | 水位读取 | `src/core/work-graph/views/activity-read-model.ts:242–248` | `src/core/work-graph/views/track-read-model.ts:223–227`；`src/core/work-graph/views/task-state-timeline.ts:171–177` |
  | 整刻时间校验 | `src/core/work-graph/views/activity-read-model.ts:254–260` | `src/core/work-graph/views/track-read-model.ts:239–245` |

- **建议：** 合并为 views 内的 2B 共用读取辅助模块；有序全读也可复用现有扫描器，重复位置为 `src/core/work-graph/views/activity-read-model.ts:173–204` 与 `src/core/work-graph/views/task-state-timeline.ts:113–133`。
- **估计可删：** src **110 行**；tests **0 行**。
- **行为影响：** 无。必须保留按记录计费、未命中计费、故障传播和四次稳定窗口尝试；这些是明确要求，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md:778`。
- **风险：中；把握：高。** 只统一这组相同计费语义，不扩大成通用存储框架。
- **依赖：** 无；VW-3 可随后复用。

**VW-2｜类别 8：施工历史和复述实现的注释**

- **位置与证据：** 本区这类注释估计约 **100 行，误差约 ±40 行**，不含纯分隔线，也不含其他发现连带删除的注释。三个例子：
  1. `src/core/work-graph/model/claim-contracts.ts:76–80`：把 codec 描述成“实现阶段才会改”的施工过程说明。保留内外状态必须一致的约束即可。
  2. `src/core/work-graph/queries/query-record-codecs.ts:1–8`：保留“stage-1 skeleton”冻结历史并重复记录形状；后面的旧记录兼容规则仍有价值，应保留，见同文件 `10–15`。
  3. `src/core/work-graph/views/work-line-reader.ts:2645–2646`：“sixth round”加一句复述紧随其后的循环。可以删这句；不要连带删除同文件 `2628–2630` 关于重试必须重新解析线头的原因。
- **建议：** 删施工阶段、审查轮次和纯复述；保留业务原因、兼容约束、计费与稳定窗口规则。
- **估计可删：** src **100 行**；tests **0 行**。
- **行为影响：** 无。调用者证据不适用于注释。
- **风险：低；把握：中。** 数量是抽查估算，执行前仍须逐块判断。
- **依赖：** 最后做，扣除其他项已经删掉的注释。

**VW-3｜类别 4：日历与轨道各自实现同一套活动事实投影**

- **位置与证据：**

  | 逻辑 | 日历侧 | 轨道侧 |
  |---|---|---|
  | 已计数、未知、补记的活动投影 | `src/core/work-graph/views/activity-read-model.ts:941–959` | `src/core/work-graph/views/track-read-model.ts:331–349` |
  | 空活动结果 | `src/core/work-graph/views/activity-read-model.ts:961–969` | `src/core/work-graph/views/track-read-model.ts:351–359` |
  | 从执行历史或派工记录确定领取 Session | `src/core/work-graph/views/activity-read-model.ts:749–763` | `src/core/work-graph/views/track-read-model.ts:362–376` |
  | 门任务识别及开放负责关系读取 | `src/core/work-graph/views/activity-read-model.ts:821–859` | `src/core/work-graph/views/track-read-model.ts:733–765` |

- **建议：** 合并活动投影和归属事实读取。门负责人排序仍由调用侧保留：目前一处按 `sessionId`，另一处按完整规范键排序，不能直接整段互换，见上述两处 `853–854`、`760`。
- **估计可删：** src **80 行**；tests **0 行**。
- **行为影响：** 无。日历与横条采用同一门检查归属，规格本来就明确要求，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md:777`。
- **风险：中；把握：高。** 共享事实投影，不合并两种分页算法或权限处理。
- **依赖：** 涉及存储读取的部分宜接在 VW-1 后；纯投影可独立做。

**VW-4｜类别 4：输入声明构造规则有四份实现**

- **位置与证据：**
  - `src/core/work-graph/views/graph-context-reader.ts:857–885`
  - `src/core/agent-runtime/context-assembler.ts:442–472`
  - `src/core/work-graph/tasks/context-input-service.ts:364–396`
  - `src/core/work-graph/tasks/execution-entry-service.ts:1065–1093`

  四处都把依赖边转换成 `InputDeclarationV1`，重复生成相同字段组合的哈希编号及 `legacy:` 编号。前两处基本相同；后两处先放旧声明，执行入口还先排除非 V2，并复制对象，分别见上述位置。
- **建议：** 合并声明构造规则到输入声明所属模块；调用侧保留顺序、版本准入和复制语义。先合并前两份完全对应的实现，再处理另外两份。
- **估计可删：** src **70 行**，其中约 **45 行在本审计区外**；tests **0 行**。
- **行为影响：** 无；不改变编号、数组顺序、V1 准入或对象隔离。
- **风险：中；把握：中。** 四处差异必须保留，不能机械替换成同一个完整函数。
- **依赖：** 无。只合并纯转换规则，保留 4C 要复用的图读取和邻居查找。

**VW-5｜类别 4：候选链终态选择在两个入口各算一遍；K3 会改**

- **位置与证据：**
  - 单卡入口排除被替换候选、按链位置选择终态：`src/core/work-graph/views/decision-read-model.ts:1123–1146`。
  - 闭合候选枚举重复同一规则：`src/core/work-graph/tasks/plan-readers.ts:724–751`。

  两处都建立被替换集合，再从 `accepted`／`not_adopted` 中用 `compareProposalChainPositions` 选终态。
- **建议：** 合并到候选读取所属模块的纯选择函数。活跃候选处理和单卡兜底仍留在调用侧，分别见 `src/core/work-graph/views/decision-read-model.ts:1121–1122`、`1146`，以及 `src/core/work-graph/tasks/plan-readers.ts:731–733`。
- **估计可删：** src **20 行**；tests **0 行**。
- **行为影响：** 无。
- **风险：中；把握：高。** 只能提取终态选择，不能直接用只处理活跃候选的读口替代。
- **依赖：** 两个入口一起改；与 K3 对该文件的修改协调。

**VW-6｜类别 5：四个 Query 解码器先解析校验，再解析同一份 JSON**

- **位置与证据：**

  | 对象 | 第一次解析、校验 | 随后的第二次解析 |
  |---|---|---|
  | QueryJob | `src/core/work-graph/queries/query-record-codecs.ts:456–480` | 同文件 `494–502` |
  | Submitted 事件 | 同文件 `508–544` | 同文件 `558–566` |
  | QueryJobAnswer | 同文件 `582–600` | 同文件 `603–611` |
  | ExecutionRecorded 事件 | 同文件 `625–655` | 同文件 `658–666` |

- **建议：** 简化为“解析并校验一次，返回已校验对象”；schema 注册需要原始编码对象时，在适配层保持原返回形状。
- **估计可删：** src **15 行**；tests **0 行**。
- **行为影响：** 无；保留全部格式校验、错误信息和历史记录兼容处理。
- **风险：低；把握：高。**
- **依赖：** 无；不涉及排除范围内的 RecordStore 修改。

**VW-7｜类别 4：错误码映射已有共享实现，2C 又复制了两份**

- **位置与证据：**
  - `src/core/work-graph/views/node-detail-reader.ts:74–87`
  - `src/core/work-graph/views/work-line-reader.ts:186–199`
  - 已有共享实现：`src/core/work-graph/persistence/read-result-failures.ts:30–36`

  三处允许的错误码集合及未知错误码回退为 `unavailable` 的规则一致。
- **建议：** 合并到现有 `storeFailureToRejection`。节点读取对 `not_found`、未就绪的特殊处理保留，见 `src/core/work-graph/views/node-detail-reader.ts:89–90`。
- **估计可删：** src **15 行**；tests **0 行**。
- **行为影响：** 无；保留调用侧的默认原因文字。
- **风险：低；把握：高。**
- **依赖：** 无。

**VW-8｜类别 2：三个只装配或只写入、没有消费者的成员；部分 K3 会改**

- **位置与证据：**
  1. **`DecisionReadModelDependencies.positions`，K3 会改。** 声明在 `src/core/work-graph/views/decision-read-model.ts:89`，生产装配 **1 处**：`src/composition/create-platform.ts:760`；该 reader 内读取 **0 处**，实际直接导入比较函数，见 `src/core/work-graph/views/decision-read-model.ts:77`。  
     工厂直接测试调用 **11 处、11 文件**：`tests/app/S5-decision-routes.test.ts:220`、`tests/helpers/S2A-notices-support.ts:79`、`tests/helpers/S2A-window-fixture.ts:43`、`tests/helpers/S2C-L-line-support.ts:175`、`tests/helpers/S5-application-support.ts:104`、`tests/helpers/S5R2-b-support.ts:77`、`tests/helpers/WP2-notices-fixture.ts:109`、`tests/work-graph/S5-decision-queue.test.ts:39`、`tests/work-graph/S5-goal-settings.test.ts:329`、`tests/work-graph/S5-notices.test.ts:54`、`tests/work-graph/WP2-context-extensions.test.ts:204`。这些装配不构成该依赖的运行时消费者。
  2. **`ownerProblem`。** 全 `src/` 只有声明、初始化、写入、返回这 **4 处**：`src/core/work-graph/views/node-detail-reader.ts:605`、`627`、`643`、`702`；读取 **0 处**，`tests/` 引用 **0 处**。实际错误已经放入 `problems`，并由详情消费，见同文件 `642`、`1119`。
  3. **`GoalFacts.revision/plan`。** 声明在 `src/core/work-graph/views/work-line-reader.ts:253–256`，初始化及赋值在 `877`、`891`、`900`；这两个缓存成员的后续读取 **0 处**，测试引用 **0 处**。重新入队使用的是另一个实际读取窗口的版本，见同文件 `942–952`。
- **建议：** 删上述成员和对应装配、赋值；保留真正使用的错误集合及重新入队版本钉。
- **估计可删：** src **12 行**；tests **0 行**，测试装配参数需调整。
- **行为影响：** 无。
- **风险：低；把握：高。**
- **依赖：** 无；若 VW-12 设计复用事实容器，先统一决定字段归属，避免删后又加。

**VW-9｜类别 3：2A 替换路径后留下的空壳参数与标志**

- **位置与证据：**
  - 未送达通知仍要求注入 `sessions.findSessions`，注释明确说已经不用，见 `src/core/work-graph/views/undelivered-reply-notices.ts:26–38`；实际走 Session 索引，见同文件 `234`。
  - 生产工厂调用 **1 处**：`src/composition/create-platform.ts:753–754`。直接测试工厂调用 **13 处、2 文件**：`tests/helpers/S2A-notices-overbound-fixture.ts:123`；`tests/work-graph/WP2-undelivered-notices.test.ts:28`、`56`、`194`、`228`、`354`、`489`、`506`、`526`、`641`、`671`、`708`、`746`。实现中读取该依赖 **0 处**。
  - `LookupBatch.truncated` 固定为 `false`，然后仅转抄给目标列表，见 `src/core/work-graph/views/goal-conflicts.ts:76`、`123–124`、`148`、`158–169`；全局检索没有该返回标志的业务消费者或测试断言。
- **建议：** 删未用的 Session 目录依赖及 `truncated` 字段、转抄和历史说明。
- **估计可删：** src **8 行**；tests **0 行**，夹具参数需调整。
- **行为影响：** 无。规格明确要求通知改走 Session 索引，并要求 `lookupAll` 不再给 `truncated`，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md:198`、`173`。
- **风险：低；把握：高。**
- **依赖：** 无。

**VW-10｜类别 5：一次决定队列装配重复读取目标、终态和架构目录；K3 会改**

- **位置与证据：**
  - 冲突装配已经取得解码后的目标，却逐个调用足迹读取再读一次目标：`src/core/work-graph/views/goal-conflicts.ts:155–169`、`268–281`、`390–396`。
  - 每个目标的足迹又读取相同的当前架构目录：同文件 `408`。
  - 冲突装配读取目标终态后，外层决定队列再读一遍：`src/core/work-graph/views/goal-conflicts.ts:287–291` 对照 `src/core/work-graph/views/decision-read-model.ts:423–436`。
  - 单卡刷新 Goal pin 再按卡读取目标记录：`src/core/work-graph/views/decision-read-model.ts:440–443`、`1156–1166`。
- **建议：** 同一次稳定尝试内共享已授权的目标快照、终态和当前目录。已有目标用于 pin 刷新；未加载的引用仍正常读取。保留独立 `readGoalFootprint` 入口，其直接测试调用有 **4 处、2 文件**：`tests/work-graph/S2B-34-executed-files.test.ts:259–260`、`tests/work-graph/S2B-r2-conflict-catalog.test.ts:97–98`。
- **估计可删：** src **0 行**；tests **0 行**。需要内部传参，不能预先承诺净减代码。
- **行为影响：** 拟保持无；不能跨尝试缓存或取消窗口复核。现有冲突窗口检查在 `src/core/work-graph/views/goal-conflicts.ts:294–299`。
- **风险：中；把握：高（重复读取），中（合并边界）。**
- **依赖：** 无；与 K3 协调。

**VW-11｜类别 5：同一任务的负责链接，在一次节点装配里翻两遍**

- **位置与证据：**
  - `buildLineIndexes` 先读当前负责人，后读参与者：`src/core/work-graph/views/node-detail-reader.ts:639–649`。
  - 当前负责人通过 `linkedSessions(..., 'responsible', true)` 读取：同文件 `408–410`。
  - 参与者又通过同一函数读取全部 `responsible`：同文件 `480–489`。
  - 两者的索引、索引参数和分页过程相同，区别是是否过滤已关闭链接：同文件 `412–435`。
- **建议：** 一次成功读取负责链接后，分别投影“当前负责”和“曾参与”。保留历史关闭关系及领取过的 Session；首次读取失败时仍保留原有各栏错误处理。
- **估计可删：** src **0 行**；tests **0 行**。
- **行为影响：** 无；不能把“曾参与”缩成当前负责人。两者必须分开是明确要求，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1325`。
- **风险：中；把握：高。**
- **依赖：** 无；可并入 VW-12 的同次读取设计，但重复量不能再算一次。

**VW-12｜类别 5：节点投影已经读过规范任务事实，后续又重新读取**

- **位置与证据：**
  - 悬停、详情、风险分节都先 `readGraph` 再 `readRunsByTask`：`src/core/work-graph/views/node-detail-reader.ts:847–849`、`1107–1109`、`1244–1248`。
  - 前者调用 `queryTaskGraph`，后者直接调用 `readCanonicalTaskFacts`：同文件 `205–221`。
  - `queryTaskGraph` 自己已经调用 `readCanonicalTaskFacts`：`src/core/work-graph/tasks/plan-service.ts:1937–1939`。
  - 节点装配继续读取线摘要，见 `src/core/work-graph/views/node-detail-reader.ts:672`、`557`；线装配创建新的目标缓存，再调用 `queryTaskGraph`，见 `src/core/work-graph/views/work-line-reader.ts:229–234`、`290`、`875–892`。
- **建议：** 让同次读取的节点、规范 Run 事实和线摘要复用一个内部事实窗口；权限检查、规范状态折叠、错误传播及水位一起保留。不要用全局缓存，也不要绕过状态模块。
- **估计可删：** src **0 行**；tests **0 行**。收益是省掉重复扫描、解码，接口成本尚不能确定。
- **行为影响：** 拟保持无。规格已采用“同次读取共享每目标事实”的方向，见 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:228–232`。
- **风险：高；把握：高（重复读取），中（具体合并方案）。**
- **依赖：** 与 VW-8 的字段归属、VW-11 的链接读取一起规划；不要求同时施工。

**按类别汇总**

| 类别 | 项目 | src 净减估计 | tests 净减估计 |
|---|---|---:|---:|
| 1 整模块无必要或重复 | 无充分证据 | 0 | 0 |
| 2 死成员 | VW-8 | 12 | 0 |
| 3 被替代路径的残留 | VW-9 | 8 | 0 |
| 4 重复逻辑 | VW-1、3、4、5、7 | 295 | 0 |
| 5 同次调用重复工作 | VW-6、10、11、12 | 15 | 0 |
| 6 纯转发层 | 未列独立项 | 0 | 0 |
| 7 仅数据库篡改能触发的防御 | 未列删除项 | 0 | 0 |
| 8 冗余注释 | VW-2 | 100 | 0 |
| **合计** | **12 项** | **约 430** | **0** |

这是跨 `src/` 的净减估计，包含 VW-4 约 45 行区外重复实现；没有把搬到共享模块的代码当作全部删除。没有超过 50 项而省略的发现。

**留给后面的片**

| 保留内容及代码位置 | 后续用途、规格位置 |
|---|---|
| 上下文 `notes`、`footprint` 扩展槽：`src/core/work-graph/views/context-extensions.ts:311–315` | 扩展槽及未接入时的真实状态由第 3 片明确规定：`docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:55`。notes 由 4C 接入：`docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:48`、`689`。不能因当前返回未实现而删除整个扩展槽。 |
| `note_review`、`message_release` 来源及可用性处理：`src/core/work-graph/views/decision-read-model.ts:95–100`、`1238–1249` | 注记决定：第 4 片 L17、§6，`docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:220–227`、`689`；待放行决定：第 7 片 L3、7A，`docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:92–94`、`345`。 |
| 节点详情的注记占位：`src/core/work-graph/views/node-detail-reader.ts:1142`、`1155`、`1168`、`1178` | 第 4 片明确核对过这些位置，并指定 4C 接入：`docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:6`、`689`。 |
| 秘书临时线名及目标负责人投影：`src/core/work-graph/views/work-line-reader.ts:1811–1817`；`src/core/work-graph/views/node-detail-reader.ts:688–695` | 第 2C 片 L20 明确要求第 6 片之前采用此临时口径，随后换成请求归属：`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:444`；界面要求见 `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:291`。 |
| 模块维护者 `none`：`src/core/work-graph/views/node-detail-reader.ts:795–796` | 第 8 片 L9、8B 明确替换为真实负责人：`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:122–129`、`430`。 |
| 查询横条和活动扩展：`src/core/work-graph/views/track-read-model.ts:104`、`927–957` | 第 6 片 L16 明确增加查询活动及横条活动字段：`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:170–178`；界面 fork 展示见 `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:340`。 |
| 通知位置比较、图邻居读取：`src/core/work-graph/views/notice-position.ts:43–59`；`src/core/work-graph/views/graph-context-reader.ts:1092–1190`、`1446–1447` | 本次任务明确列入 4C 复用清单；游标事实另见 `.lead-ref/updatedue-facts.md:3`。图下钻本身也是第 3 片职责，见 `docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:82`。VW-4 不删除这些读取。 |

另有两处看起来值得删、实际不能据此删除：接续环处理被 `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:246–250` 明确要求；节点执行分页中逐条读取失败仍保留条目的行为，也被同规格 `1327` 明确要求。因此没有把它们列作第 7 类或重复读取删除项。

**优先做的五项**

| 顺序 | 项目 | 原因 |
|---|---|---|
| 1 | VW-8 死成员 | 消费者为零，改动小；`positions` 随 K3 一起处理。 |
| 2 | VW-9 2A 残留 | 替代路径和撤除要求都有明确规格依据。 |
| 3 | VW-7 错误映射 | 已有共享实现，几乎不需要设计新接口。 |
| 4 | VW-6 重复 JSON 解析 | 重复工作明确，局限在一个文件，容易核对兼容行为。 |
| 5 | VW-1 2B 读取辅助 | 节省最多的实质代码，三份计费语义一致；完成后再推进 VW-3。 |