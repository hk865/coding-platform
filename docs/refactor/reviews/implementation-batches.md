# dsh 实施批次与独立验收

> 当前 next 最新子集见 [R4c.1 Task 原子领取](next-r4c-claim-2026-09-24.md)：60文件/422项物理隔离验收通过。已按用户最新要求执行 DSH骨架/测试 → Astra审核冻结 → DSH实现 → Astra审阅 → 隔离测试。后续复用TaskClaim接真实执行；完整R4c仍未完成。以下原工程批次保留历史范围，不能作为 next 完整产品验收。

2026-09-23。用户授权：主 Agent 负责架构、骨架、测试与验收，本地 dsh 按真实依赖及文件范围并行实现代码。独立验收通过后才接通依赖该批的生产路径，不限制无依赖任务并行准备。总计划见 [refactor-plan](../refactor-plan.md)。

## R2a — WorkspaceTools 所有权迁移：通过

任务：[R2a](../tasks/R2a-workspace-ownership.md)。dsh Session：`session-b1f94780-085b-43e3-a1d6-40b391dfcba2`。本地实施记录：`/tmp/coding-platform-dsh-run/R2a-01/`；这些临时运行日志不作为唯一持久交接依据，本页记录必要结论。

- 18 个 TS 文件与 README 从 `src/data/workspace-reader/` 移至 `src/core/workspace/`；旧目录不存在，没有转发层。18 个 TS 与本批开始前的工作树副本逐字节一致，包含 R1 修改。
- 11 个生产直接 import/re-export 消费者以及测试、动态加载和 dist 脚本切到新路径。相关注释/README同步。
- 实际 `module-map` 以 WorkspaceTools 替代 WorkspaceReader，当前仍为 12 个实际模块；目标仍为最终 5 个模块。精确 fixture 白名单仅替换原文件路径，没有扩大。
- 用户既有集成测试、工作目录辅助文件、重构日志未被覆盖；R1 测试仅改 import。AGENTS 顶部当前任务说明由主 Agent 添加。

主 Agent 独立执行：

| 检查 | 结果 |
| --- | --- |
| typecheck | 通过 |
| check-module-boundaries | 通过，issues=[] |
| data/source/Python/C++/路径/用途读取、架构来源、探索工具、context、vault、verification、模块归属相关测试 | 56 文件、441 测试全部通过 |
| tsc -p tsconfig.app.json + verify-source-index | 通过，真实 dist 路径与新源码定位正确 |
| 移动前后及消费者差异审阅 | TS 实现逐字节一致，测试行为未被放宽 |

测试使用已有 Node24/Vitest；Python 缓存使用 `/tmp/coding-platform-dsh-run/root-cache`。首次通过 Corepack 启动测试因缓存目录变化触发包管理器下载，已停止该启动进程并改为直接运行已安装 Vitest；没有安装项目依赖或修改锁文件。

dsh 额外运行过全量测试，自报 2532 通过、23 失败，涉及其环境不可写缓存/配置、用户已有工作目录路径及并发进程测试。该全量结果没有作为“全仓通过”证据；本批独立相关测试全部通过。测试生成的 `evidence/collaboration-memory/batch/integration/` 文件保留，不作为生产实现改动。

本批仅完成所有权与消费者迁移；尚未实现新 capture/cursor，未宣称新性能收益或代码量减少。

## R2b — 冻结材料分析：通过

任务：[R2b](../tasks/R2b-frozen-source-query.md)。沿用 R2a 的真实 dsh Session，初版和两次返修记录为 `/tmp/coding-platform-dsh-run/R2b-01/`、`R2b-02/`、`R2b-03/`。

- 唯一 live 捕获迁入 `project-source-snapshot.ts`，冻结分析迁入 `typescript-source-query.ts`；原 `ProjectSourceIndex.query/architectureMaterials` 实际共同消费，原算法副本删除。
- 主 Agent 提供三份新测试，先运行到明确失败，再由 dsh 修复。初版每个新 snapshot 重建服务，复用序列测得6次；修复后正文/HEAD/撤权/恢复/旧快照切换保持1个服务。依赖声明入口变化正确失效；配置拒绝后未处理的失效继续保留，真正同步 program 后才清除。
- 捕获立即拷贝 Host 身份，旧捕获不受可变对象污染；analyzer只保存一份 installed 输入，门面重复 Map 已删除；异步核验前结果已脱离共享状态。
- R1 的401条imports仍是两次捕获、一次关系分析；同一冻结材料上的多类查询不读源文件。旧模型公开分页仍逐请求核验，本批不冒称已接跨页复用。

主 Agent 最终独立执行：9文件/56测试全部通过，覆盖新增行为、R1、真实架构/探索入口、路径和模块归属；typecheck、模块边界（issues=[]）、应用编译通过。最终小修后再次执行对应检查，日志前缀 `R2b-root-final-`。

19个旧/新完整响应对照中16个逐字段一致；3个差异是旧实现撤权后恢复依赖仍错误unknown/漏符号，新版已正确恢复。18个query观察均与对当前材料新建的原分析器结果相同（排除有状态changes字段），图响应不变；所有来源、摘要、版本和changes保持兼容。不为匹配旧结果恢复已证实的缓存缺陷。

生产行数：旧213行变为门面126＋捕获85＋分析266＝477行，净+264，包含新增精确类型、独立组件接口与说明。本批取得数据/算法边界和缓存正确性，**尚未取得总代码量精简**；后续共享捕获与旧实现退役继续按实际净量核对，不用文件变小冒充全仓缩小。

## R2c — 有界捕获与真实 Host 接线：通过

任务：[R2c](../tasks/R2c-capture-registry.md)。接口、真实主体、授权/根/版本来源与关闭流程已冻结。独立捕获测试25例、真实Sandbox访问6例、真实Host桥8例、完整图兼容1例、真实服务生命周期3例；dsh不能修改这些独立断言。模型跨页协议仍属于R2d，本批通过仅限下列内部能力及Host架构读取。

首轮 `/tmp/coding-platform-dsh-run/R2c-01/` 在真实Host接线途中因 `TRANSPORT` 退出，exitCode=1；其“13/13”只是途中自报，**不是本批通过**。主Agent初步独立执行22项时19过、3失败：额外读取政策未落实到access、返回DTO污染保留材料、并发捕获突破数量上限；类型检查另有4项错误。审阅还发现缓存字节计费、完整imports范围、previous作用域和Host关闭/注册接线缺口，均已加入返修任务。`R2c-02` 沿同一Session继续，不重做源码调查、不覆盖工作树。

`R2c-02` 正常退出，dsh自报106项通过；主Agent此前独立复现的权限版本、根改绑、身份分隔符碰撞、首次open异常名额泄漏、过期在途名额及capture→平台关闭，现已补上对应源码修复，仍待最终统一复跑。最后静态复核仍发现长查询键/墓碑实际字节计费遗漏；独立生命周期测试增加最外层profile关闭观察后，3项中1项失败：前序service关闭抛错跳过profile。因此继续 `R2c-03` 两项收尾，不用中间自报替代最终验收。

后续 [R2d](../tasks/R2d-model-source-tools.md) 已拆成工具协议/释放、Work与Reviewer、Query三子批；[R2d.1骨架](../tasks/R2d-1-tool-protocol.md)和[R2d.2真实绑定骨架](../tasks/R2d-2-work-source-binding.md)已冻结，测试先放临时目录，不使未实施的接口打断R2c类型检查。R2c通过之前不派发依赖它的生产修改。


R2c最终独立验收（R2c-03完成之后）：

| 检查 | 结果 |
|---|---|
| 16个相关测试文件 | 110项全部通过，含43项新增capture/Host/完整图/生命周期行为 |
| typecheck、模块边界、app编译 | 全部通过，边界issues=[]；当前实际仍12模块，WorkspaceTools含25个TS文件 |
| 图兼容与成本 | 新旧图逐字段及摘要一致，保留真实环/unresolved；真实reader两次来源捕获、一次imports分析、读取字节为两份来源正文总量；冻结分页/导出/映射不增加来源读取 |
| 资源上限及异常清理复核 | 哈希查询键，实际元数据计费，墓碑数量/字节双重上限；所有权与关闭顺序有限只读复核通过 |
| 受保护文件 | 8份独立测试的冻结hash不变；5份用户已有集成/工作目录文件及日志hash不变 |

最终日志前缀 `/tmp/coding-platform-dsh-run/R2c-root-final-`；实现最后轮为 `R2c-03`，正常exit0。独立验收才是本批通过依据，前轮自报不替代它。

本批生产源码净增加1161行（含新契约/端口、注册表、访问桥、分页、清理与Host装配；不含测试、文档）。这是新冻结捕获能力的增量，**尚不能称为总代码量精简**。保留旧project_index为明确实时兼容入口，正式模型退出该入口在R2d执行。来源当前性只保证明确核验时点，不变成代码验收或未来未变化的保证。

## R2d.1 — 模型源码协议与资源释放：通过

任务：[R2d.1](../tasks/R2d-1-tool-protocol.md)。从源码捕获模块转向运行工具模块，本批使用新的本地dsh会话 `session-f5c2b6c6-58f6-4f3f-9427-07abe0d24d69`；骨架和规则从落盘任务书接手，不依赖旧对话记忆。实现记录 `/tmp/coding-platform-dsh-run/R2d-1-01/`；其后的本批修复继续复用该会话。

主Agent已冻结 `tests/app/project-source-tool.test.ts` 10项协议测试与 `tests/runtime/source-tool-lifecycle.test.ts` 11项运行/资源测试。先独立运行协议测试，10项因旧工厂无tools/close及新协议而失败（`R2d-1-root-red.log`），没有把当前未实现当通过。实现前保留了源码hash及本批文件副本。R2d.2真实Work/Reviewer与R2d.3 Query尚未实施，本批完成也不代表生产入口已全部切换。


最终独立验收：原21项通过后，主Agent另补两项真实边界测试，先复现pinned=true/无read仍暴露read_source，以及实际TS dispose错误被吞。dsh在同一轮中读到新测试并修正；最终为23项新增（协议10＋生命周期13）。主Agent修正了自己协议测试166行的TypeScript推断，未改断言。

- 主Agent最终运行14文件/102项全部通过，覆盖新协议/关闭、旧TS与C++/Reviewer工具、Query说明/Reviewer JSON准入、R2c捕获/Host/图/生命周期；类型、边界issues=[]、应用编译全通过。日志前缀 `/tmp/coding-platform-dsh-run/R2d-1-root-final-`。
- 真工具401条imports三页仍仅2次捕获/1次imports；旧wire完整对照及页间stale保持。没有read时不open、不创建源码组，包括pinned配置；真实dispose失败尝试其余清理后报错，close幂等。
- 新生产文件project-source-tool.ts；另外3个生产文件仅做类型/装配/资源所有权。本批源码净+370行，尚未体现总代码精简。3份旧fixture仅迁tools/close，精确归属只增加真实文件；R2b/R2c独立测试及5份用户WIP hash不变。
- dsh正常exit0，自报更大相关回归通过；其Python缓存/Host配置目录/本机locale相关失败没有用于声明全仓通过。本批以上独立限定范围验收通过。

生产普通Work/explore/Reviewer/Query尚未接新工厂；这是R2d.2/3的明确剩余工作。本批不修改Run/Query/Kernel/Session/UI。

## R2d.2 — Work、探索与Reviewer真实绑定：通过

任务：[R2d.2](../tasks/R2d-2-work-source-binding.md)。主Agent提供15项独立测试：runtime-source-binding 10项、真实Reviewer来源3项、普通/探索真实Dispatch→Leased→Runtime→Kernel模型工具闭环2项。模型均为本地夹具，无外部调用。

先运行Host绑定测试：9项失败于尚未导出的工厂，1项输入拒绝例通过；对应日志`R2d-2-root-red.log`。新增测试导致的缺工厂/未来DI类型错误属于待实现接口，不能声称当前全仓类型通过。R2d.1的验收在加入这些新测试前已完成；本批源码基线另存，待dsh派发后独立复核。

R2d.2已实际调用本地dsh，同一运行工具Session `session-f5c2b6c6-58f6-4f3f-9427-07abe0d24d69`，记录`/tmp/coding-platform-dsh-run/R2d-2-01/`。写入串行，不与其他批次并发；只允许任务书中的5个生产文件。


R2d.1后续窄复核：独立review发现真实Kernel以resolved failed结果返回时，finally清理异常可能遮住原模型失败。主Agent新增第24项“原模型失败＋两个close失败”并运行到RED（`R2d-1-root-failed-result-red.log`）。修复语义已写入R2d.1任务书：保留非completed原结果、仍清理全部；completed的cleanup失败不能报成功。已在同一串行写批修复，主Agent随后24项复测及下列最终检查通过；未另起生产写者。原14文件102PASS仍为当时限定事实。

R2d.2主审补充第16项：返回context/workspace DTO污染私有绑定，已在初版独立复现（`R2d-2-root-alias-red.log`）；要求值隔离。Reviewer负向矩阵补当前Run.envelope.reviewInput及实际read-only权限的重核，沿原同一it，不替换正向真实受理记录。主Agent更新受保护hash，dsh不修改测试。

R2d.2后续主审与独立代码复核确认：仅凭spec.mode选择Reviewer排除存在组合漏检，非review模式但实际绑定ReviewWork可走普通Host范围。已在现有Reviewer输入拒绝矩阵及普通Run每请求变化矩阵补断言，并冻结准备/fresh授权两层拒绝规则；不自动推断profile。当前实现已在准备和每请求授权两处拒绝，精准代码复核及最终独立测试通过。


最终独立验收（2026-09-23）：

- 本批16项＋R2d.1补充后的24项＋真实explore旧回归10项，合计6文件/50项通过（`R2d-2-root-final-tests.log`）。Reviewer mode伪装、当前Run工作身份变化、DTO污染、当前reviewInput/read-only变更和根在resolve/authorize间替换均覆盖。主Agent只把正式explore旧工具清单断言从project_index更新为project_source；无factory的显式兼容fixture仍保持旧清单。
- 相关独立回归11文件/74项通过（`R2d-2-root-regression-tests.log`），覆盖独立审核、explore、Reviewer JSON/准入、材料门禁及R2c核心/Host/架构/关闭/归属。最后生产版本typecheck、边界issues=[]和app构建均exit0，日志前缀`R2d-2-root-final-`。不是全仓验收。
- 正式ordinary/explore经service→Leased→Runtime→ObservedModel→project_source，Reviewer同一路但以审核者自身Run/Work/只读范围绑定。真实模型清单都无project_index；Query仍留R2d.3。
- 5个本批生产文件净+275行；另observed-model-run仅作R2d.1错误优先级窄修复。没有新增模块/边/持久schema，R2b/c/d1/d2独立测试及5份原用户WIP hash核对未被dsh改写。全部实际生产改动符合这6文件范围。
- 原Reviewer currentness及JSON/模型准入/预算/材料/租约守卫保留，新Host桥不再次调用完整Reviewer扫描。保留成本不能算作已优化；冻结TS捕获和分页成本沿R2b/c/d1证据，不声称端到端提速或总代码减少。

## R2d.3 — Query源码绑定：已验收

任务：[R2d.3](../tasks/R2d-3-query-source-binding.md)。主Agent准备9项Host绑定、4项真实Control/Context/Runtime/Kernel闭环、1项真实HTTP服务装配；生产基线已保存。先运行缺接口RED，再串行派发同一dsh Session。原发起者来自精确QueryJobSubmitted；当前存储无按aggregate的事件接口，暂需每模型启动一次O(历史)扫描，不在每页重扫。此过渡成本待后续RecordStore/受理能力贯通，不能伪造actor来避免。

主Agent初始Host绑定8项因缺工厂失败、1项负向拒绝通过，日志`R2d-3-root-red.log`；另修正自写测试的SourcePage推断类型，不改断言。R2d.2验收完成后串行派发，记录`/tmp/coding-platform-dsh-run/R2d-3-01/`，同一Session。生产仅3文件。

R2d.3第一次调用`R2d-3-01`发生TRANSPORT错误，exit1，只有部分Host桥落盘；主Agent保留工作树并沿同一Session续接`R2d-3-02`。初审要求原actor候选只保留常量空间，游标用现有序号函数严格前进；不把最后出现final事件当成功。

R2d.3主Agent首轮真实Host/Runtime/Kernel共3文件15项通过，types通过；新增第15项游标回退覆盖在实现已修复后PASS（日志名`R2d-3-root-cursor-red.log`不是失败证据）。后续第16项复现末页await期间取消仍缓存origin（`R2d-3-root-origin-cancel-red.log`，RED）；已在任务书明确await后取消检查和失败初始化不得缓存，已经dsh修复并由主Agent独立复测。原probe会阻断取消后的源码读取，不表述成权限绕过。


R2d.3最终独立验收：

- 同一Session的 `R2d-3-02` 完成接线及取消缓存修复；`R2d-3-03` 补完整request派生JobRef和await后取消检查后发生TRANSPORT错误，修改已落盘。主Agent等写入停止，固定版本6文件25项通过（`R2d-3-root-final-tests.log`）；其中新16项及先前受并发超时影响的3文件9项全部通过。此前并发回归另8文件54项已通过；11文件63项首次结果58通过/5超时，不能记录成全绿。一次串行复测读到写入中的中间版本，不作为最终验收。
- `R2d-3-04` 正常exit0，将初始化与每请求的Query资格规则收敛为 `loadCurrentQueryState` 一份。每个资格检查仍只读一组Run/Job，初始化、扫描后probe、每个操作各自保持fresh；不减少授权检查时点，不加入第二缓存。主Agent随后在固定树再次运行3文件16项全部通过，类型、边界issues=[]、app构建均exit0（`R2d-3-04-root-*.log`）。
- 正式四类调用均完成：ordinary/explore/Reviewer走service→Leased→Runtime；Query走service→ReadOnlyQueryRuntime；共同经ObservedModel→project_source→同一WorkspaceTools。Query原actor来自精确QueryJobSubmitted，Role/request/root/current Run/Job每操作重核，材料、最终baseline、重放及关闭语义保留。显式旧兼容入口仍保留project_index。
- 相对本批基线仅3个生产文件变化，净+325行；其余前批源码和独立测试hash核对未被dsh修改。具名辅助函数消除规则副本，代码量仍增加，不宣称本批总代码减少或已测端到端提速。
- 原actor确认暂为每实际模型循环一次O(历史)事件读取、常量附加内存；分页工具不重复扫描。明确退出条件已写入refactor-plan R4c：原来源版本化/精确索引、旧数据兼容、运行期零全历史events扫描。Git、text/read/compare、Python/C++冻结接线仍是R2e工作。


R2d.3最终边界补充复核：独立审阅发现同物理root的两个真实Workspace可通过底层Port混用ctx/request scope，模型wire没有该字段。先前16项未覆盖这一组合，追加第17项真实Host登记负例；精确补验完成前不派发R2e，结果续记于此。


第17项补验已闭环：真实同根双Workspace负例得到RED（`R2d-3-root-cross-scope-red.log`），dsh `R2d-3-05` 在Query身份入口补ctx与原binding.scope显式匹配，正常exit0。主Agent随后固定版本3文件17项及类型检查均通过（`R2d-3-05-root-tests.log`、`...-types.log`）。最后生产只在原文件加6行判断/说明，最终本批3文件净+331行。前一固定版本边界/app构建结果仍适用；未增加依赖或改装配。原独立测试未被dsh改写。至此R2d.3已验收，允许进入R2e.1。


## R2e.1 — 文本捕获、精确读取及同范围比较：dsh已返回，待独立验收

任务：[R2e.1](../tasks/R2e-1-text-read-compare.md)。主Agent已冻结core14项和真实Work→Kernel/Host模型闭环2项。源代码基线独立保存；旧3份fixture由主Agent补真实byteLength/完整Port或更新已变化的invalid样本，保留原断言强度与0访问约束。全测试hash受保护，仅module-ownership允许登记新文件。

初始2文件16项均失败（`R2e-1-root-red.log`）：缺read方法、text不支持、scope未发布、模型wire拒绝新动作，非环境故障。R2d.3第17项通过后，回到源码核心实现Session `session-b1f94780-085b-43e3-a1d6-40b391dfcba2` 串行派发 `R2e-1-01`；只允许任务§4九个生产文件及归属登记，不重做R2b/c/d，不触及Git/GUI/非TS语义。


2026-09-23 文档整理时核对：`R2e-1-01/result.json`为exit0且turn_end=completed，代码保留，未继续派发。dsh完成报告不等于独立验收。进行中预审曾报告text特殊路径静默漏项和比较限额检查过晚，需在最终固定版本核对/复现；本次按用户要求只清理文档，不把未复测代码记为通过。

## R3a / R4a — 用户已交付实现，独立验收未通过

2026-09-23。对应[首批并行任务](../tasks/DSH-PARALLEL-IMPLEMENTATION.md)。Goal 已进入真实 WorkGraph / RecordStore 链，受管 Kernel 公共扩展已实现；本轮主 Agent 没有修改生产源码，补充并运行独立反例。完整结论、事务归属图及测量限制见[独立验收报告](R3a-R4a-independent-acceptance.md)，证据与冻结 hash 见[证据目录](evidence/r3a-r4a-2026-09-23/README.md)。

- R3a 原独立 12 项通过；补充的事务内存储身份守卫在 SQLite / Memory 各失败 1 项，程序化不可克隆输入隔离另失败 1 项。真实旧库已有读取 / 重启证据，仍需补指定的 WG 原 Goal 结果重放与后续提交验证。
- R4a 独立 6 项中 3 通过、3 失败：旧 Run 身份返回较新 Run，暂停恢复可提高预算，省略原沙箱限制后能读取原禁止路径。Kernel 完整 44 文件为 193 通过 / 3 失败 / 1 跳过。
- 平台 scoped 首跑 91 文件 / 822 项中 810 通过、12 超时失败；7 个失败文件降低 worker 数后 45 项全部通过，没有改 timeout 或断言。事务边界追踪的 p1-02 四项通过，30 BEGIN / 30 COMMIT，无嵌套 BEGIN / SAVEPOINT；不据此断言全部超时已归因或性能没有回退。
- 平台类型、模块边界 issues=[]、完整 Kernel→平台→UI 构建，以及 Kernel 类型 / 架构检查通过；真实 HTTP 多工作区 Host 窄测试通过。构建通过不替代上述行为修复。

dsh 原报告的“14 项环境失败”与分类合计 15 不一致，缺少完整原始失败明细；仅两项外部路径缺失已独立核实，HOME / locale 原个案未确认。既有统计不能作为独立验收通过依据。

该轮验收结束时[可并行返修任务](../tasks/R3a-R4a-acceptance-fixes.md)尚未派发；2026-09-24 后续结果见下节。目标模块图不因这些实现缺陷改变，未增加数据引擎；R2e.1 验收、平台连续 Session、同工作区范围并行及 UI 仍按各自任务推进。


## R3a / R4a — Sol 骨架 / 独立契约与受限 dsh 返修：通过

2026-09-24。实际执行 GPT‑6 Sol 骨架和测试 → 主 Agent 审阅冻结 → 两个 dsh Session 并行实现 → 原 Session 精确返修 → 独立验收 / 逐文件集成。详细[验收报告](R3a-R4a-sol-dsh-acceptance.md)、[执行能力](../DSH-EXECUTION-HARNESS.md)与[证据](evidence/sol-dsh-2026-09-24/README.md)。

- R3a 四个文件修复两后端事务内身份 / schema 守卫及三种输入路径隔离；真实 RAT-03 原 Goal 重放、后续提交与重启通过，原库字节不变。
- R4a 八个文件（含 INTEGRATION）完成精确恢复、实际约束持久化、原配置 / 工作区核对及 checkpoint 兼容。Sol 另交付实际值 getter 与三个内部骨架函数。SQLite 本文件及三个 sidecar 精确排除出 revision，普通文件仍核对；未接受 dsh 曾提出的跳过 paused revision。
- 独立检查：R3a 契约 24、相关回归 108、Control/Ledger 676、P1-01 集成 6 全通过；R4a 契约 17 全通过；最终新构建上的 Kernel 207 通过 / 1 既有跳过，平台 Kernel 接线及恢复 19 全通过；两端类型 / 架构与完整构建通过。集合有重叠，不相加作全仓总数。
- 原独立测试 hash 不变；审计无越界，测试 / 类型 / 其他源码 / 配置实际只读。5 项 lint 注解问题与派发前相同，本轮未新增。

修复已合入当前工作树，未提交 / 推送。通过范围限 R3a Goal 与 R4a Kernel；平台连续 Session、范围并行、其他 WorkGraph / RecordStore kind、UI 仍待后续实现，R2e.1 仍待独立验收。未测端到端性能，不宣称整体提速或总代码减少。


## R2e.1 / R3b — Sol骨架与受限dsh的后续执行

2026-09-24。R2e.1通过[独立验收](R2e-1-sol-dsh-acceptance.md)：18项契约/工具、56项相关回归及类型/边界通过。严格文本路径不再静默漏项，可证明超限的比较提前退出；一般重命名比较仍保留必要遍历。Git/非TS/GUI文件读取收口未完成。

R3b正文与规则两组dsh同时实施，再单独集成真实Host/Run/Query；[功能验收](R3b-sol-dsh-acceptance.md)31项、相关68项、Query5项通过，主树合并47文件297项通过，类型及完整构建通过。旧Vault规则已迁为共享实现；[其他消费者](R3b-material-consumer-inventory.md)按退出批次保留薄wire。完整模块DAG尚未收口：WG仍借旧canonical reader/候选索引，两条临时边在图与检查输出明确列示。

当前生产120,817行、测试113,545行，见[最终测量](code-size-and-complexity-2026-09-24-final.md)；不宣称全仓代码或复杂度下降。未来沿用Sol骨架/测试→主审冻结→dsh按不冲突范围并行→主审真实路径与退役验收。
