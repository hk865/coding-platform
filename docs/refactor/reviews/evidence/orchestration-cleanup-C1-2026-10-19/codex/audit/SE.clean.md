本区确认 **13 项候选，预计可净减 src 约 447–487 行，tests 6 行**。其中注释约 50–80 行；测试删减仅为允许清单元数据，不建议删除业务测试。没有找到证据充分、可以整模块删除的项目。

基线为 `1e0b1383`。全程只读，未运行测试、构建、网络或模型调用。环境没有 `rg`，调用检索使用 `git grep`，覆盖 `src/` 和 `tests/`。以下是静态审计结论，行数已粗略扣除共享实现和接线成本，移动文件本身不算节省。

下文 `sessions/`、`communication/`、`configuration/`、`architecture/`、`persistence/`、`views/`、`tasks/` 均相对 `src/core/work-graph/`；规格文件名相对 `docs/refactor/design/orchestration-2026-10/slices/`。

**SE-1｜类别 4，兼有类别 6：事件编码重复，消息编码还绕了一层选择器**

- **位置与证据：** `sessions/message-record-codecs.ts:1170–1200` 已有一个实际编码器，外面七个函数只转发；`communication/mailbox-service.ts:3559–3570` 又按事件种类选择这七个壳。`sessions/lifecycle-record-codecs.ts:593–651` 的六个编码器逐项复制同样五个字段。区外同形实现还见 `persistence/decision-record-codecs.ts:53–60、77–85`。
- **调用证据：** 七个消息壳各有一个生产调用，全部在 `communication/mailbox-service.ts:3561–3567`。测试共 13 个调用点、5 个文件：`tests/helpers/S5-decision-fixture.ts:881、892、908`，`tests/helpers/S5-goal-settings-support.ts:606、617、634`，`tests/helpers/S5R2-c-support.ts:643、654、671`，`tests/helpers/S5R2-d-support.ts:652、663、679`，`tests/work-graph/S5-user-messages.test.ts:298`。
- **建议：** 合并为接收明确事件联合类型的编码器，删转发壳和选择器；保留各事件的校验和注册。
- **估计可删：** src **70 行**；tests **0 行**，调整导入和调用即可。
- **行为影响：** 预期无，编码字段和 JSON 字节规则保持。
- **风险：低；把握：高。依赖：无。K3 会改** `message-record-codecs.ts`。

**SE-2｜类别 4：四种邮箱读取重复分页与读取进度检查**

- **位置与证据：** 收件箱、发件箱各有 page 字段和 limit 校验，见 `communication/mailbox-service.ts:2202–2217、2345–2358`；回复读取已有共享函数 `:3094–3105`。`atLeastCursor` 解析重复在 `:2228–2233、2368–2373、3154–3159、3241–3246`；相同的 `readThrough/not_ready/MIN_CURSOR` 分支重复在 `:2274–2287、2408–2421、3177–3190、3290–3303`。
- **建议：** 合并 page 基础校验、提交位置解析及读取进度结果构造；各入口继续处理自己的令牌绑定、身份和过滤条件。区外已有 `persistence/read-result-failures.ts:19–26` 可核对复用，但不能直接丢掉这里的输入校验和空进度规则。
- **估计可删：** src **70 行**；tests **0 行**。
- **行为影响：** 预期无；保留调用者输入快照、错误映射及四类查询的权限差异。
- **风险：中；把握：高。依赖：无。**

**SE-3｜类别 4：两个 Workspace 设置服务重复整套基础操作**

- **位置与证据：** `configuration/decision-settings-service.ts:29–59、66–83、91–124`，对应 `configuration/line-settings-service.ts:48–78、85–102、122–158`：上下文取值、actor 比较、canonical 包装、Workspace pin 校验、同键读取和回执恢复基本相同。主要差异是错误文案、事件解码器和 pin 返回形状。
- **建议：** 合并到 configuration 内的 Workspace 设置辅助实现；两个业务状态转换及各自提交条件继续独立。
- **估计可删：** src **65 行**；tests **0 行**。
- **行为影响：** 预期无；回放仍读原事件，不改成读取当前 Workspace。
- **风险：低；把握：高。依赖：无。**

**SE-4｜类别 8：施工历史和复述代码的注释**

- **位置与证据：** 全区保守估计 **50–80 行**，不计其他发现随实现一起删除的注释。三个例子：
  1. `communication/mailbox-service.ts:144–151` 解释第 5 片第一段、第二段和当时的桩，主要是施工历史。
  2. `configuration/project-bootstrap-service.ts:1025–1033` 混入“第一阶段冻结、第二阶段实现”的过程；当前读取实现就在 `:1044–1049`。
  3. `sessions/message-record-codecs.ts:1234–1235` 再次说明顶部已经声明的转出，见 `:71–80`。
- **建议：** 删历史过程和重复说明；保留权限边界、并发窗口、兼容规则及解释“为什么必须这样”的注释。
- **估计可删：** src **50–80 行**；tests **0 行**。
- **行为影响：** 无。
- **风险：低；把握：中。依赖：与其余项去重统计。K3 会改** 第三个例子所在文件。

**SE-5｜类别 4：决定来源读取辅助函数在同一文件写了两套**

- **位置与证据：** `communication/decision-source-facts.ts:149–203` 的错误映射、范围检查、记录读取及解码，对应 `:659–715` 的 `readerScopeProblem/readerReadRecord/readerDecode`。两套都执行 canonical key → `readMany` → 区分 missing 与未交代遗漏 → 解码；差别主要是错误前缀及闭包参数。
- **建议：** 合并底层读取辅助函数，保留两条业务入口。历史答案的读者资格不能改用当前来源的“仍可回答”判断；这一区别明确写在 `:717–725`。
- **估计可删：** src **50 行**；tests **0 行**。
- **行为影响：** 预期无；已解决来源的历史答案仍可读取。
- **风险：低；把握：高。依赖：无。**

**SE-6｜类别 4：决定服务再次实现消息回执恢复**

- **位置与证据：** `communication/decision-service.ts:357–389` 和 `communication/mailbox-service.ts:249–303` 都执行回执核对、`eventAt`、原消息解码、回复位置绑定及同身份补查。邮箱版本另外处理 `ArchiveWaitDisposed` 和回执版本，见 `mailbox-service.ts:269–284`，所以不能直接整函数替换。
- **建议：** 合并原事件读取、公共一致性核对及消息恢复部分；特殊事件、版本检查和错误映射留在各入口。`slice-5-SPEC.md:635、665、692` 已要求共享原回执规则。
- **估计可删：** src **25 行**；tests **0 行**。
- **行为影响：** 预期无；仍在新业务读取之前恢复原结果。
- **风险：中；把握：高。依赖：无。**

**SE-7｜类别 4：Session 链接完整读取重复**

- **位置与证据：** `sessions/session-directory.ts:1181–1215` 与 `sessions/session-lifecycle.ts:353–379` 使用同一索引、同样分页循环、解码和容量错误。前者额外提供读取进度观察回调，后者只把返回字段 `value` 改成 `links`。
- **调用证据：** 生产内部调用共 5 处：`session-directory.ts:1318、1489、1675`，`session-lifecycle.ts:716、1300`。
- **建议：** 合并到 sessions 内的链接读取函数，保留进度观察参数和完整读取上限。
- **估计可删：** src **25 行**；tests **0 行**。
- **行为影响：** 预期无；不改变索引、链接事实或 state/ 状态迁移入口。
- **风险：低；把握：高。依赖：无。**

**SE-8｜类别 4：CompletionPolicy 的当前读取再次手工解析已存在的快照结构**

- **位置与证据：** `configuration/project-bootstrap-record-codecs.ts:221–280` 已解析策略快照、active 指针并计算摘要；`configuration/project-bootstrap-service.ts:1086–1098、1107–1133` 再做一套。区外 `tasks/plan-readers.ts:775–797、838–854` 也有对应 ref、内容及摘要解析。
- **建议：** 合并共同的值解析和摘要校验；各入口保留自己的外层记录核对、缺失含义和错误映射。两套校验目前严格程度不同，不能直接互换。也不能用 `resolveGovernance` 替代单独策略读取，它还要求架构激活存在，见 `tasks/plan-readers.ts:811–825`。
- **估计可删：** 本区 src **20 行**；tests **0 行**；区外潜在节省未计。
- **行为影响：** 预期无，前提是保留各入口现有约束。
- **风险：中；把握：中。依赖：无。**

**SE-9｜类别 4：决定选择的形状校验重复**

- **位置与证据：** `sessions/message-body-envelope.ts:74–110` 与 `sessions/message-record-codecs.ts:356–365、546–578` 重复判断五种 selection、允许字段及其中的 GoalRef。
- **建议：** 合并纯形状校验，错误映射留在入口。`communication/decision-service.ts:513–520` 判断选择是否适合当前来源、option 是否真实存在，属于另一层业务规则，应保留。
- **估计可删：** src **20 行**；tests **0 行**。
- **行为影响：** 预期无；不扩大合法 selection 集合。
- **风险：中；把握：高。依赖：无。K3 会改** `message-record-codecs.ts`。

**SE-10｜类别 3：冲突来源核对仍保留“执行文件为空”的旧路径**

- **位置与证据：** `communication/decision-source-facts.ts:232–261` 自己读取计划模块，并固定返回 `executedFiles: []`；`:595–600` 用这个结果决定冲突是否存在。另一条生产读取 `views/goal-conflicts.ts:422–462` 已读取真实执行文件。共享冲突算法明确计算两边执行文件的交集，见 `src/core/work-graph/state/goal-settings-machine.ts:276–296`。
- **建议：** 把共同的冲突事实装配放到两方都能依赖的下层，或由 composition 注入；删来源核对里的空文件旧实现。不要新增 communication → views 依赖，也不要重复读取已经取得的 Goal。
- **估计可删：** src **20 行**；tests **0 行**。
- **行为影响：** **有。静态推导：** 两目标仅实际文件相交、计划模块不相交时，冲突读取可以发现它，答复来源核对却可能返回 `not_found`。合并后应认可同一冲突。依据是 `slice-2B-SPEC.md:446` 的真实文件接线要求和 `:955` 明确的执行文件交集语义；已有对应公开读取用例见 `tests/work-graph/S2B-34-executed-files.test.ts:259–264`。
- **风险：中；把握：中。依赖：必须连同生产依赖接线及两方读取规则一起处理。**

**SE-11｜类别 5：一次解码内，同一 JSON 校验后再次解析**

- **位置与证据：** 下列左右位置分别是第一次和第二次解析：
  
  | 文件 | 校验中解析 | 解码时再解析 |
  |---|---:|---:|
  | `sessions/session-record-codecs.ts` | 817 | 1058、1066、1080 |
  | `sessions/lifecycle-record-codecs.ts` | 523 | 662、676、686、700、710、720 |
  | `sessions/message-record-codecs.ts` | 1080、1101 | 1219、1252 |
  | `architecture/architecture-record-codecs.ts` | 284 | 374 |
  | `architecture/catalog-record-codecs.ts` | 398 | 553 |

- **建议：** 校验内核返回已经解析、验证的值；注册适配仍返回它要求的外壳。可参考已经这样做的 `configuration/role-record-codecs.ts:297–312`。
- **估计可删：** src **10–20 行**；tests **0 行**。主要收益是消除重复解析，行数收益有限。
- **行为影响：** 预期无；记录解码补 null、事件回放保留原字段的区别必须保留，见 `sessions/message-record-codecs.ts:1221–1231、1254–1258`。
- **风险：中；把握：高。依赖：与 SE-4 注释统计去重。K3 会改** 消息编解码文件。

**SE-12｜类别 2：可选 plans 及跳过真实原因核对的分支只服务旧测试构造**

- **位置与证据：** `communication/decision-source-facts.ts:43–52、138–143、306` 明说为旧构造保留可选依赖，并在未提供时直接通过原因核对。生产只有一个构造点，始终传入 plans：`src/composition/create-platform.ts:703`。
- **测试证据：** 构造点共 9 处、9 文件。其中 7 处省略 plans：`tests/helpers/S5-application-support.ts:98`、`S5-user-message-support.ts:71`、`WP2-notices-fixture.ts:102`，`tests/runtime/S5R2-agent-application.test.ts:233`，`tests/work-graph/S5-decision-queue.test.ts:60`、`S5-goal-settings.test.ts:326`、`WP2-context-extensions.test.ts:229`。另外两处已提供：`tests/helpers/S5R2-b-support.ts:58`、`S5R2-c-support.ts:867`。这些是构造点计数，不表示全部执行了跳过分支。
- **建议：** plans 改为必需依赖，删空依赖分支；测试显式提供所测读取能力。只测落实证明的夹具可直接使用已有专用入口 `communication/decision-application.ts:79–82`。
- **估计可删：** src **12 行**；tests **0 行**。
- **行为影响：** 生产无；测试构造需要调整。
- **风险：低；把握：高。依赖：无。**

**SE-13｜类别 2：没有使用者的 UserDecisionBodyEnvelopeV1**

- **位置与证据：** 定义在 `sessions/message-body-envelope.ts:33–41`，专用 import 在 `:12`。检索结果：生产使用者 **0**，可执行测试使用者 **0**；只有 `tests/architecture/production-reach-allowlist.json:868–873` 的允许清单条目。清单称读取器使用该类型，但实际读取器使用 `unknown`、解析结果和 `UserDecisionBodyV1`，见 `sessions/message-body-envelope.ts:156–181`。
- **建议：** 删未使用类型、专用 import 和允许清单条目；保留真实消息正文类型与读取器。
- **估计可删：** src **10 行**；tests **6 行**元数据。
- **行为影响：** 无。
- **风险：低；把握：高。依赖：类型与允许清单同时删。**

**按类别汇总**

| 类别 | 项目 | src 可删行数 | tests 可删行数 |
|---|---|---:|---:|
| 1 整文件／模块 | 无充分证据 | 0 | 0 |
| 2 死代码 | SE-12、13 | 22 | 6 |
| 3 被替代的旧路径 | SE-10 | 20 | 0 |
| 4 重复实现 | SE-1、2、3、5、6、7、8、9 | 345 | 0 |
| 5 单次调用重复工作 | SE-11 | 10–20 | 0 |
| 6 机械转发 | 已并入 SE-1，不重复计算 | 0 | 0 |
| 7 仅防数据库篡改的检查 | 无充分证据 | 0 | 0 |
| 8 注释 | SE-4 | 50–80 | 0 |
| **合计** | **13 项** | **447–487** | **6** |

**留给后面的片**

| 保留内容与代码位置 | 后续用途及依据 |
|---|---|
| `sessions/session-record-codecs.ts:757–758、965–978` 的 archivedAt、任务链接和归档索引 | 4C 复用清单；`.lead-ref/updatedue-facts.md:8、12`。任务链接还被第 7 片挑执行者明确使用：`slice-7-SPEC.md:150`，§0.3 L15。 |
| `architecture/architecture-service.ts:592–627`、`architecture/graph-index.ts:149–185` 的邻域读取 | 本次明确列入 4C 复用；既有图邻居语义见 `slice-3-SPEC.md:448`。 |
| `architecture/architecture-delta.ts:1–100`、`architecture/architecture-service.ts:629–685` 的观测比较和影响读取 | 第 8 片接比较、影响路由并用于过时提醒：`slice-8-SPEC.md:107–119`，§0.3 L7、L8。不能因暂缺路由整删。 |
| `architecture/catalog-service.ts:589–755` 的目录修订 | 第 8 片复用其权限、校验和回放：`slice-8-SPEC.md:105`，§0.3 L6。 |
| `communication/decision-application.ts:71–75` 的初始化证明待支持分支 | 第 6 片补初始架构、策略采用的证明：`slice-6-SPEC.md:163–166`，§0.3 L14。 |
| 消息决定形状及处理能力，如 `sessions/message-record-codecs.ts:546–578、762` | K3 新增 `unknown_call_review` 卡，仍走第 5 片答复流程：`slice-K3-SPEC.md:149–159`，L6。SE-1、4、9、11 涉及该文件，均需与 K3 协调。 |

另有两个**当前规格仍要求**的索引没有计入删减：`sessions/message-record-codecs.ts:65–66、126–137` 的 `S5_USER_MESSAGE_BY_GOAL`、`S5_MESSAGE_BY_WORKSPACE_STATUS`。没有找到生产查询，但 `slice-5-SPEC.md:288–289、1069` 明确要求注册及状态桶测试；`slice-2A-SPEC.md:115` 也明确说前者本片不用。这不足以授权删除。

**最先做的五项**

1. **SE-10**：先核实并裁定。它关系到同一冲突能否展示、能否答复的一致性，价值超过节省行数。
2. **SE-3**：重复范围清楚，业务边界容易保持，风险低。
3. **SE-5**：同文件内即可合并，能减少两套错误和缺失处理长期分叉。
4. **SE-1**：机械重复最多之一；与 K3 排好顺序后一起整理编码入口。
5. **SE-2**：四条读取共用同一套分页基础规则，节省较多；实施时重点保留各自令牌和授权差异。