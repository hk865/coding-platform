核对完成；未修改文件，未运行测试或构建。按你指定的 a23e6229 工作树核对；此副本没有 `.git`，不能独立验证提交号。没有发现本轮点名的既有文件被删除；下文“仍未实现”不算“已删”。

路径缩写：`C=src/contracts`，`W=src/core/workspace`，`WG=src/core/work-graph`，`A=WG/architecture`，`V=WG/views`，`N=WG/notes`，`RT=src/core/agent-runtime`。旧位置来自规格和 `.lead-ref/s8facts.out.md`。

**1．§0.2 事实、§0.3 选择、§0.4 接缝**

| 项目 | 核对结果 |
|---|---|
| F1 自治分类 | **未变**：小改按档位、结构改动始终需决定，`WG/state/decision-policy.ts:43、58`。属后续修补流程，不是本轮前置。 |
| F2 目录修订 | **未变**：入口 `A/catalog-service.ts:589`；仍拒删模块 `:671`、拒非空依赖规则 `:681`，复制旧基线 `:697`，独立提交 `:728`。原 `:656–666` 不是这两项限制的准确位置。 |
| F3 分开提交 | **已变（定位）**：旧定案段 `evidence-service.ts:1550–1569` → `WG/evidence/evidence-service.ts:1607`，实际提交在 `:402`；目录提交仍在 `A/catalog-service.ts:728`。分开提交的事实未变。 |
| F4 比较、影响 | **未变**：`compareArchitecture` 只收两个观测，`A/architecture-service.ts:629、642`；影响入口 `:650`；`noVerdict`、差异和环在 `A/architecture-delta.ts:74、99`。**已有的是服务方法，不是 `architecture/compare` HTTP 路由**：路由表仍只有 adopt/read/capture/query，`src/app/core-routes.ts:317`。compare、compare-formal、impact 均待接。 |
| F5 文件图与上限 | **未变**：通用节点有 `file`，`C/architecture-inspection.ts:5`；实际快照只收模块/接口，512 节点、1,024 边、240 KiB，`C/architecture-source.ts:47、51、62`。文件锚点仍解析成映射节点，`A/graph-index.ts:91`。 |
| F6 缺口与提醒 | **未变**：未归组、无源码映射、未解析 import 在 `W/architecture-source.ts:32、33、37`；提醒段仍在 `RT/context-assembler.ts:854`。旧清单 `context-extensions.ts:310` 所指占位现见 `V/context-extensions.ts:312、314`，notes/footprint 仍未接。 |
| F7 负责关系 | **未变，局部扩展**：模块目标及 responsible 仍在 `C/core/identity.ts:44`，当前目录校验在 `WG/sessions/session-targets.ts:151`。Workflow 原 `:1105` → `src/business/workflow/workflow.ts:1111`；另已补复用 Session 领取时开任务负责关系 `:862`。不提供 8B 的模块维护者机制。 |
| F8、F9 | **未变**：任务 moduleRef 仍只检查非空，`WG/persistence/plan-record-codecs.ts:343`。containment 类型声明在 `C/architecture-catalog.ts:32`、校验旧 `:337` → `A/catalog-record-codecs.ts:340`；初始化提示 `RT/query-preparation.ts:61` 仍没列它。均属 8B。 |
| F10、L12 | **未变，待扩展**：映射仍仅 TS/JS，`W/architecture-source.ts:26`；捕获仍过滤 TS/JS/JSON，`W/project-source-snapshot.ts:48、53、70`；文本捕获不能生成架构图，`W/capture.ts:210`。纯非 TS 还会碰到分析器拒绝，`W/typescript-source-query.ts:129`。 |
| L13 | **未变**：C/C++ 配置选择、系统 Python/libclang、snapshot 校验、分页及40条诊断在 `W/cpp-source-index.ts:52、61、66、70、78、79`；Python 包依赖、snapshot、分页及30条诊断在 `W/python-source-index.ts:26、60、90、91`。Python 配置优先级和 src 回退在 `scripts/python-source-query.py:22、108`。逐文件完整解析统计仍缺；语法失败只进诊断 `:234`，C++ 的 `coverage.complete` 固定 false 是底层语义声明，`scripts/cpp-source-query.py:344`。 |

接缝按后注调整：**4C-1 的统一归属函数尚未在本树出现**，当前仍是 `V/goal-conflicts.ts:470`、`N/scribe-scope.ts:88` 等各算各的。8A 开工时复用其合入结果，不能提前另写一份（`.lead-ref/reuse-rulings.md:15`）。L8 等 4C-2；7D2 是代码量的下游消费者，不是 8A/8D 前置（规格后注 `slice-8-SPEC.md:14`、`HANDOFF.md:512`）。

**2．§2 接口、§6 文件与根路径**

| 项目 | 核对结果／施工书应写 |
|---|---|
| 完整目录 pin | **新增可复用**：`ArchitectureCatalogRef` 确实仍在 `A/catalog-contracts.ts:68`；公共 `C/architecture-catalog.ts:18` 尚只有结构契约。按后注在8A上提原类型并增加 `ArchitectureCatalogPinV1`，不要复制第二份。 |
| 观测身份 | **新增可复用**：拟议 `ObservedCaptureRef` 与现有 `ObservedArchitectureRef` 字段一致，`A/contracts.ts:13`。但现有查询输入用的是带持久材料引用的 selection，`:27、56`；新 ref 不能直接当旧 selection 传。 |
| 新 DTO、方法 | **未变（仍待新增）**：`FormalObservedComparisonV1/FindingV1`、`FileGraphPageV1`、`LanguageCoverageV1`、`ArchitectureLanguageProviderV1`、`nonBlankLines/language/languages`、`compareFormalObserved/neighbors/impact/listFiles` 均未落地；当前契约见 `C/architecture-inspection.ts:5`、`C/architecture-source.ts:9`、`A/contracts.ts:56`。 |
| 捕获与提供者 | **新增可复用**：`ProjectSourceAccess` 在 `W/project-source-snapshot.ts:15`，由 `W/project-source-index.ts:4` 重导出；TS 分析器在 `W/typescript-source-query.ts:91`，捕获复用它的位置是 `W/capture.ts:403`。现 `projectAccess` 接的是实时读取，`:71`；给多语言提供者用的冻结适配器仍须8A建。`WorkspaceToolsPort` 在 `W/ports.ts:184`。 |
| 目录读 | **新增可复用**：当前/指定版本读 `A/catalog-service.ts:757`，模块事实读 `:792`。4B 已有版本索引 `A/catalog-record-codecs.ts:513` 和 `N/note-version-lists.ts:125`，不要再造版本扫描。 |
| 版本原因与时间 | **已变／新增可复用**：目录列表已存在，但仍返回 null 和占位文案，`N/note-version-lists.ts:141`。事件已有原因和时间，`A/catalog-service.ts:710`；目录记录仍无提交关联，`A/catalog-contracts.ts:73`，codec 精确键也不收新字段，`A/catalog-record-codecs.ts:400`。可复用 `src/core/record-store/ports.ts:91` 的游标绑定，现成写法在 `N/note-service.ts:934`。 |

根路径全链必须覆盖：

- **未变**：观测契约 `C/architecture-source.ts:34、47`、输入映射 `A/architecture-service.ts:98、135` 仍拒绝 `.`。同一校验还服务文件/配置路径，不能整体放宽。
- **未变**：工作区映射 `W/architecture-source.ts:27、38`、锚点解析 `A/graph-index.ts:96`、持久图摘要复核 `A/architecture-record-codecs.ts:265` 都按“所有命中前缀”处理，尚非统一最长前缀；节点、边和摘要复核必须同改。
- **未变／新增可复用**：最长前缀及并列归 null 已在 `V/goal-conflicts.ts:470、492`；4A 新增的 `N/scribe-scope.ts:79` 明确把 `.` 判为不匹配；2C 的 `V/node-detail-reader.ts:728` 另有模板字符串及反斜线匹配。均应接4C-1共用函数。
- **定位纠正**：`A/catalog-record-codecs.ts:263` 是精确键错误文案；requireDag 检查在 `:266`。模块路径实际只要求非空字符串，`:117、286`，**正式目录已经接受 `.`**。
- **定位纠正**：`W/architecture-source.ts:24` 没有名为 `safeRelativePath` 的函数；该名字在 `A/architecture-service.ts:98`、`A/architecture-record-codecs.ts:71`。
- 其他前缀命中须区分用途：`A/architecture-record-codecs.ts:272` 是配置文件核验，`N/note-read-model.ts:522` 是注记路径筛选，`N/note-anchors.ts:183、186` 是邻近文件查找；不能一律套模块根规则。

§6 点名的8A/8D现有文件均在。施工清单还需补 `N/scribe-scope.ts:79`、`N/note-version-lists.ts:125`。组合入口旧 `create-platform.ts:947` → `src/composition/create-platform.ts:1029`。无目录手动抓取还受 `src/ui/views/setup/requests.ts:202、204`、`setup/panels.ts:118`、`graphs/tabs.ts:84` 阻挡，不能只改已列出的 `setup/actions.ts:43`。

**3．§5.2 验收行**

“可施工”表示现有公开入口足以造基础事实，目标行为仍须本片实现。

| 行 | 结论 |
|---|---|
| A-01 | **未变：8A可施工**。复用 `platform.architecture.captureSourceChanges`（`A/architecture-service.ts:446`）；新增文件图、分页、分块、上限注入和旧观测兼容读取。现接口只有模块图查询，`A/contracts.ts:61`。 |
| A-02 | **未变：8A可施工**。公开采用/读目录 `A/catalog-contracts.ts:113、121`，公开抓取同上；正式比较方法和路由由8A补。 |
| A-02b | **新增可复用**。环算法已有 `A/architecture-delta.ts:17`；8A接文件图和正式比较，无需等8B/C。 |
| A-03 | **已变：延期**。属于L8，等4C-2装配接缝；公开准备入口仍在 `RT/execution-preparation.ts:138`，当前扩展仍占位 `V/context-extensions.ts:312`。 |
| A-04 | **已变：拆开**。自动触发、失败记录及启动重试明确写在L8（规格`:125`），按“不含L8”也延期；无目录的手动文件层抓取属于L12，本轮仍做。登记、采用、定案入口已有，分别见 `WG/configuration/project-bootstrap-service.ts:617`、`A/catalog-service.ts:452、589`、`WG/evidence/evidence-service.ts:1463`。 |
| A-05 | **未变：8A可施工，先等4C-1**。根目录采用已可造；归属和计行仍待8A补。证据见上述根路径链。后注的根模块书记例可用现有 scope 写入核验和计数入口，`N/scribe-scope.ts:351、331`。 |
| A-06 | **未变：8D，先等8A** 的冻结材料、提供者接口、文件图和正式比较；再包装两个现有 `query`（`W/cpp-source-index.ts:44`、`python-source-index.ts:49`），补完整解析统计。无需7D1/7D2。 |

B-01～B-05全属8B，R-01～R-13全属8C；“7D1可验”不是8A/8D归属标记（规格`:400–418`）。4B后注的模块删除补验也须等8C，当前公开修订仍拒删模块（`A/catalog-service.ts:673`）。

**4．§5.3 旧测试**

- **已变，必须翻转**：`tests/work-graph/S4B-note-hints.test.ts:69、76`，“`.` 不拥有文件”及 `basis_outside_anchor` 应改成根归属成立、无该提示。
- **已变，必须翻转**：`tests/work-graph/S4B-memory-version-lists.test.ts:120、121`，时间/原因为 null、固定占位文案，应验证已关联版本的真实值。
- **未变，扩充而非替换模块断言**：`tests/data/workspace-capture-architecture.test.ts:111`、`tests/work-graph/R3d-observed-architecture.test.ts:33` 断言模块节点。规格所谓“旧文件节点从字符串变对象”不对应当前实现；它们只是把节点映射为 ID 再断言。文件层应新增断言。
- **未变，按新捕获边界调整**：`tests/data/project-source-snapshot.test.ts:37、38` 锁定仅TS/JSON材料，`:79` 锁定二进制/读取失败整次拒绝；8A新观测链须验证逐文件跳过和覆盖。若保留原TS专用入口，这些原断言应保留。
- **未变，不能误翻底层语义**：`tests/data/workspace-text-operations.test.ts:239` 的文本提供者不支持架构、`project-source-index.test.ts:64` 的TS索引不支持Python、`cpp-source-index.test.ts:91、93` 的底层 unsupported，不能直接改成观测层 supported/failed；状态转换由新提供者验收。
- **仍待8C**：M-15、M-16 的跳过分别在 `tests/work-graph/S4B-note-anchor-status.test.ts:70`、`S4B-memory-not-found.test.ts:46`。M-02 当前只有定义变化例，`S4B-note-definitions.test.ts:96`，删除部分尚未写成跳过用例。

**5．重复建设风险**

| 拟新增处 | 必须复用的现有处 |
|---|---|
| 8A观测比较、环、遍历 | `A/architecture-delta.ts:74、17`；`A/graph-index.ts:149、197`。但旧邻域可带跨页出边 `:172`、旧影响遍历不限定深度 `:215`，不能原样套文件图契约。 |
| 8A文件归属、目录身份与版本列表 | 4C-1统一函数；`A/catalog-contracts.ts:68`；`N/note-version-lists.ts:125`。 |
| 8A TS提供者、8D语言分析 | `W/typescript-source-query.ts:91`、`W/cpp-source-index.ts:16`、`W/python-source-index.ts:16`；新增包装和统计，不另写解析器。 |
| 目录事件关联 | 复用已有提交游标绑定 `src/core/record-store/ports.ts:91`，不要另建时间/原因事实表。 |