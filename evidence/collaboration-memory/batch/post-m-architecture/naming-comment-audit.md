# S04 命名与注释全范围处置

本轮检查覆盖 `src` 的 12 Module、contracts、Host/composition、UI、storage、fixtures/testing 和 vendor 边界。历史证据目录没有改写。宽扫描结果用于发现候选，每一类按语义处理，未机械删除数字或协议字符串。

| 候选类型 | 处置 |
| --- | --- |
| ReadModel 的 `p108`–`p118`、`applyP*`、Lane A/B/C 私有名 | 改为 console、query、control intent、plan change、architecture inspection/evolution、baseline evolution、collaboration、work context、material access 等业务名；两个 adapter 同步 |
| 当前策略常量中的票号 | 改为 `COORDINATION_AUTONOMOUS_REWORK_BUDGET_MAX`、`COORDINATION_POLICY_REVISION_V1`、`INITIAL_DESIGN_*`，值与持久数据不变 |
| “尚未实现／no-op／冻结／某 lane 将补齐”等失实说明 | 按当前实现改写；WorkspaceReader 的 C++ 说明改为“配置 libclang 时可用，否则明确 unsupported”；已实现投影不再称占位 |
| 生产装配中的 harness 命名 | 正式入口为 `createProductPlatform`，要求显式产品能力；`createPersistentPlatform` 明确用于持久测试／演示。`src/harness` 与 `InMemoryHarness` 保留为测试宿主术语 |
| `p107-*`、`p1-03-*`、`p1-06-*`、`rw12-*` idempotency key 前缀 | 保留。它们已经参与持久去重，改名会让升级后的重放产生不同命令身份；源码注释不再要求读者理解票号 |
| SQLite `p111_*`／`p114_*`／`p115_*` 表名 | 保留。它们是已有数据库 schema，普通源码重命名不能代替兼容迁移 |
| fixtures／tests 中的 P1、RW 和 frozen scenario 名 | 保留为历史场景定位和已验输入身份；这些名称不对外宣称生产职责 |
| `FakeWorkspaceReaderAdapter` 对 P112 fixture builder 的导入 | 保留在测试／演示 adapter。正式产品装配显式提供 `WorkspaceReader`，不会把该 fixture reader 当作缺省生产能力 |
| `contracts/notices/CM-1B-001` | 保留 provenance，指向固定上游来源和摘要，不属于当前业务命名 |
| `interfaces_to_freeze`／`first consumer freeze` 等旧开发流程标签 | 从生产 contracts 注释移除，改为实际的 public／versioned module interface 及职责名称；不会改变协议或导出 |
| 协议里的 `no-op` | 保留两处准确语义：取消订阅在该路由页不产生状态变化、空投递列表不产生投递；不是未实现占位 |
| vendor/coding-agent | 不改写上游内部命名；本地适配仍按其 AGENTS/INTEGRATION 管理来源 |

批量处理的机器记录为 `current-comment-rewrite-map.json`、`current-policy-rename-map.json`、`current-terminology-files.json` 和 `read-model-rename-map.json`。`current-terminology-files.json.secondPass.files` 逐项记录最初 39 个机械改写文件的复核结论，不能再用“脚本执行过”代替人工语义核对。

README 现在说明协调内部职责、StateLedger 正式治理读取入口、ArtifactVault runtime observation 的单 writer 条件，以及产品装配对真实能力的显式要求。注释保留不变量、拒绝原因和兼容理由，删除旧分工过程说明。

## 第二轮漏项与修复

第一轮把票号、lane 和 freeze 字样做了机械替换，留下了会误导读者的残句。这不是单纯的格式问题：`// ：` 丢失了规则名称，`沿用  之前` 丢失了兼容边界，`fact/detail projection` 把旧分工误写成当前职责，`／ 期间` 丢失了历史字段保留理由。第二轮逐项复核并完成以下修复：

- 角色矩阵、角色规格、任务工作身份、指派一致性、返工处置和验证轮次改用实际业务规则名称；兼容语义明确为“引入角色矩阵前”“唯一身份守卫生效前”或“门禁语义调整前”。
- Control、Ledger 和 Runtime 注释中由 lane 替换产生的 `fact projection`／`detail projection` 改为候选物化、命令准入、持久校验、运行事实等当前职责。
- VerificationEngine 与 ContextCompiler README 恢复完整章节名和历史字段兼容理由；用户可见的角色产出缺口说明从损坏的“按 ，”修为“按当前规则”。
- `/legacy` 明确成为停止扩展的兼容界面。它不再用“尚未提供管理接口”“模型尚未连接”等文案推断整个平台能力；页面直接指向新版工作台，并说明 legacy 项目对话固定走样例适配器，真实任务与探索仍可使用已保存模型。
- 持久幂等键、SQLite 表名、fixtures 的历史场景标识和 notices 上游 provenance 均未改名。

静态复核输出分为 [naming-comment-remaining-excluding-concurrent.txt](naming-comment-remaining-excluding-concurrent.txt) 与 [concurrent-files-comment-findings.txt](concurrent-files-comment-findings.txt)。前者在本轮负责范围内为空；两个 ReadModel 主适配器由其单一修改者并行收口后，后者也已为空。`naming-comment-remaining-current.txt` 只保留 fixtures 历史场景、兼容幂等键／表名和 notices provenance 等有意保留项。

## 独立检查后的第三轮语义复核

snap-03 独立检查发现 `rework-plan-compiler.ts` 仍有一处机械替换残句 `（ 的 triggerSourceIssues）`。它已改为“返工触发来源的 triggerSourceIssues”，保持原校验含义和执行逻辑不变。随后没有只搜索票号或 lane，而是增加了损坏语法模式 `（\s*的`、`按\s*[，。]`、`沿用\s+之前`、空规则标题 `//\s*：`，并复查旧接口冻结标签；[第三轮扫描](naming-comment-third-pass-scan.txt)为零命中。

同一轮复核还逐项处置生产 contracts 中遗留的 `interfaces_to_freeze`／`first consumer freeze` 标签：这些标签描述旧开发流程，现已改为相应的公开、版本化 Module interface 和实际职责。仍保留的 `freeze` 只表达不可变版本语义；`Object.freeze` 是语言 API；fixture 名、持久幂等键、SQLite schema 和 notices provenance 继续按上表理由保留。

## snap-04 失败后的全量语义复读

snap-04 独立验收以四个反例证明上述固定模式仍不足以支持“全范围完成”。本轮因此没有继续追加几个关键词后直接宣称通过，而是逐目录复读生产 contracts、Control、Dispatch、Ledger、ReadModel、WorkspaceReader、WorkerRuntime、composition、app 与 UI 注释，并用重复英文词、孤立施工编号、旧 handoff 权威引用、破损中英文连接和失实能力陈述做交叉扫描。

处置包括 95 个注释或 README 文件：修复 `Architecture inspection Architecture inspection`、`architecture evolution/14`、孤立验收计数、`from a architecture` 等验收反例；清除运行时代码中的 ADR/P 编号和旧 `IMPLEMENTATION-HANDOFF` 施工权威，改为当前契约、Module 与业务规则；修复 `governance and plan plan`、`handoff Handoff`、`/** :` 等重复或残句。两条内容性失实说明也已纠正：后继 Run 的准备入口已由 `composition/persistent-platform.ts` 接入生产装配；当前订阅路由在首页固定 `subscriptionScope`，只对旧空范围 intent 保留兼容边界。UI README 不再声称架构、Reviewer、返工、记忆、续跑和语义查询均未接通。

复读后，损坏模式、重复业务标题、施工编号和旧 handoff 权威引用扫描均无生产源码命中。唯一有意保留的 `CM-1B-001` 位于 `contracts/notices` 的上游来源说明；日期字面量、幂等键、数据库表名、协议状态文字和真实未覆盖能力继续保留。`git diff --check` 无空白错误，根/UI TypeScript 为 0 诊断，模块边界为 523/524 且 `issues: []`。精确输入是 `final-source-snapshot-05.json`，相对 snap-04 的 95 文件变化均为注释/README 语义修正。

## snap-05 失败后的第五轮同类清理

snap-05 独立报告以 `console projection console`、`query/15`、`versioned contract 6/8/9/12`、`Acceptance 1/5/6/8`、`ADR D1` 和 `small P1 scale` 证明第四轮仍有漏项，AC-S05-01 成立。第五轮先逐条修复，再沿相同问题类别检查当前源码，而不是只把报告字符串加入正则。

扩展处置包括：重复的 work-context/workspace lease/workspace patch 标题，ControlIntent 与 goal-change validator 标题，StateLedger 的 `R-1` 施工标签，治理类型序数，旧决策/验收编号，以及可以直接改成业务语义的 fixture 注释和展示标题。`P112`／`P113` 导出 fixture 标识继续保留，因为大量既有契约套件和重启场景直接消费这些稳定测试 API；它们不充当生产职责名称。持久键、SQLite schema、协议序号和 notices provenance 的保留边界不变。

[第五轮扫描](naming-comment-fifth-pass-scan.txt)记录了范围、精确零命中和保留项。snap-06 相对 snap-05 无文件增删，28 个文件变化；其中 3 个 fixture 文件改变展示文案，其余是注释。根/UI TypeScript 为 0 诊断，模块边界为 523/524 且 `issues: []`，8 个受影响测试文件 93 例通过，完整构建与构建后源码复算通过。最终是否接纳仍由独立方对 `final-source-snapshot-06.json` 裁决。

## snap-06 失败后的第六轮分域语义复核

snap-06 独立报告关闭 AC-S05-01，但以重复规则名、缺失主体、空 Context-continuity 标题、拼接投影标题和机械空格确认 AC-S06-01。第五轮“0 actionable matches”因此只能作为当时固定模式的输出，不能作为完成结论。

第六轮按用户建议先以规则族寻找候选，再手工补全。两个分域检查者分别复读 Control/contracts/运行装配和 data/fixtures/harness/UI；第三个只读检查者跨全部 `src` 反查文件头、依赖说明、生产消费者和内部命名。除报告九类反例外，还修正了 ReadModel、SQLite StateLedger 和 CodeGraphPort 的失实或不完整职责说明，明确 SQLite ReadModel 对 ControlEngine 公开纯规则的许可依赖，并把一个仅限 SQLite adapter 内部的旧票号常量改为业务名。持久 schema、协议值和公开接口均未变化。

[第六轮记录](naming-comment-sixth-pass-scan.txt)保存检查方法、扩大类别和保留边界。精确反例与扩大连接词扫描为零；剩余重复词候选逐句核为正常语言或标识符上下文。snap-07 相对 snap-06 无文件增删，59 个源码文件变化，主要为说明性内容；根/UI TypeScript、523/524 边界、ReadModel 4 文件 7 测试、完整构建和构建后源码复算通过。独立方再次扩大抽查相同类别、文件头职责、跨 Module 依赖说明、生产消费者和内部旧票号，关闭 AC-S06-01 并判定 S04/S05 PASS，见 [snap-07 报告](acceptance/snap-07/acceptance.md)。
