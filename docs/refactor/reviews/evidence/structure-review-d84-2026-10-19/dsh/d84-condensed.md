# 决定 84 结构审查合并表（C1 之后）

依据：第一轮 `d84-struct-A/B/C/D.out.md`，第二轮 `d84-refute-A/B/C/D.out.md`。编号 `A1`…`D12` 沿用第一轮；行数均为新增＋删除，搬移计两次；归类、片次和行数以第二轮为准。第二轮判“不成立”的 7 项见 §2，不进表。

引用写法：`A#1/RA#1` 指 `d84-struct-A.out.md` 第 1 条发现及 `d84-refute-A.out.md` 第 1 条；B、C、D 同。`S6/S7/S8` 指三份冻结规格。

第 1 类按施工顺序分组：6A 7 项、6B 2 项、7B 2 项、7C 1 项、7D1 1 项；7A 和 6C 没有第 1 类项。第 2 类 6 项，第 3 类 12 项。

## 1. 合并表

| 编号 | 问题（一句，平白，带 file:line） | 哪一片会碰到（规格和节） | 改法（一句） | 动不动行为 | 估计行数（修正后） | 归类（修正后） | 第二轮结论（成立／部分成立，部分成立写改了什么） | 把握 |
|---|---|---|---|---|---|---|---|---|
| A6 | `run-activity-service.ts:151` 把 Work/Query 共用的活动替换规则放在 Run 专用 owner 里，输入却要整个 `RunActivitySnapshot`，实际只读 `facts`。 | 6A；S6 §0.3 L16、§6（终态写入、补算、替换）。 | 只抽纯替换策略，参数收窄到 `facts`、`incoming facts`、终态提交标记；Run/Query 各自管身份和事务。 | 不会；保留七行判断顺序和终态补全例外。 | 85 | 1（6A 前） | 成立；确认 `queries → tasks` 依赖不允许，须放到两边都能依赖的纯模块。`A#6/RA#6` | 高 |
| B1 | 同一事件协议的格式知识散在类型、解码流水线、正文检查和登记里；`decision-record-codecs.ts:64`、`:84`、`line-settings-codecs.ts:56` 是三份现成流水线。 | 6A；S6:184（L16）、§6:396（`QueryActivity`、`QueryRunRef` 编解码）。 | 按决定 70-3，先用 2 个 decision 事件＋1 个 line-settings 事件做有界“格式说明→编解码及登记”试验，不扩成全库。 | 不会；保留序列化结果、检查顺序、错误文字、返回协议、回放结果。 | 350–600 | 1（6A 前，有界试验） | 成立；只认可有界试验，RunActivity 先解析再查 envelope，不能照套这三个事件的检查顺序。`B#1/RB#1` | 高 |
| C1 | `note-read-model.ts:58` 运行时导入写服务的渲染函数，`note-service.ts:36` 反向导入读模型，形成读写依赖环。 | 6A；S6:14（无目标记忆分支）、`note-read-model.ts:1907`。 | 只把 `readAllRecords`、`readAllHeads` 及窄类型下移到注记底层 reader，纯渲染移入纯函数模块。 | 不会；保留分页到底、失败映射、解码顺序、渲染字节。 | 110–160 | 1（6A 前） | 部分成立；原 180–280 偏大，只下移全量扫描和纯渲染，不扩为读模型拆分或 principal 清理。`C#1/RC#1` | 高 |
| C2 | 活动族“新预算→前水位→读取→后水位→最多四次”的控制流程在 `activity-read-model.ts:780`、`:805`、`track-read-model.ts:1186`、`task-state-timeline.ts:556` 有四份。 | 6A；S6:189（`readQueryActivities`、`activity/queries`）、S6:396（日历、轨道扩展）。 | 活动族内抽稳定窗口执行器，调用方提供窗口读取和错误映射；输入检查、游标、错误文字、`ForbiddenError` 留调用方。 | 不会；保留四次上限、每次新预算、`now()` 时机、失败立即返回、水位顺序。 | 120–200 | 1（6A 活动部分前） | 成立；四段连失败返回共 77 行，新入口可复用。`C#2/RC#2` | 高 |
| D1 | 路由信息在 `core-http-types.ts:145`、`core-routes.ts:91`、`:367`、`:626`、`:1048` 反复登记（suffix、binding 类型、元数据、绑定、分派）。 | 6A；S6:209（§1.1 `requests/*`）、S7:361、S8:132/153。 | 按业务域拆 route/DTO 登记，从类型化请求响应映射派生可派生信息，保留显式 owner 调用。 | 不会；保留 URL、body 容器、错误映射、owner 方法、解析检查顺序、`this`、缺能力错误、注册顺序。 | 2200–3000 | 1（6A 前） | 部分成立；原 650–950 偏低，五块加 DTO 约 1,230 行原文，全面按域拆要 2,200–3,000 行。`D#1/RD#1` | 中 |
| D2 | 工具的可选名称、依赖、工厂、最终注册列表散在 Work/Query 两条装配路径：`execution-driver.ts:246`、`query-execution.ts:218`、`observed-model-run.ts:288`。 | 6A；S6:123/132/138、S7:168/181、S8:133。 | 抽工具组装配模块，统一输出 `{names, create}`；调用类资格策略独立显式。 | 不会；保持 Work/copy/review 原白名单、失败方式、资格判断、事实读取、最终列表顺序。 | 500–750 | 1（6A Query 工具扩展前，最迟 6B 前） | 成立；主要相关代码 270–300 行，六组名称筛选和装配属实。`D#2/RD#2` | 高 |
| D3 | `context-assembler.ts:266`、`:973`、`:1256` 把渲染、工作区读取、Kernel 命令事实和调用配方混在一起；初始化 guide 在 `query-preparation.ts:50`。 | 6A；决定 83 补充规格；HANDOFF:659、S6:131/398、S8:165/457。 | 拆成纯渲染/模板、历史与工作区事实读取、Work/Query 调用配方；guide 归模板资源，assembler 留薄编排。 | 不会；先原样搬文本、顺序、裁剪、拒绝结果；83 的新策略另实现。 | 3200–3800 | 1（83 补充规格冻结后、相关实现及 6A 前） | 部分成立；原 1,900–2,600 不足，渲染约 760 行＋事实/brief 约 700 行＋guide 84 行，搬移约 3,090 行。`D#3/RD#3` | 高 |
| A1 | `plan-service.ts:1077`、`:1236`、`:1808` 把初始回答事实读取、采用复核与计划写服务、展示查询混在 3,506 行文件里。 | 6B；S6:10（初始化提议/采用/读取提前到 6B）、§0.3 L8/L11、§2 `InitializationBindingV1`。 | 只抽“初始回答事实读取＋采用复核”，保持现有公开门面；其他查询和请求候选迁移不列为已证明前置。 | 不会；保留逐次读取、错误映射、原回执先于回答读取的顺序。 | 420 | 1（6B 前） | 部分成立；从整文件 2,100 行收窄到 185 行主体、含接线约 420 行。`A#1/RA#1` | 高 |
| C3 | `decision-source-facts.ts:473` 八个实分支共同给外围变量赋值，来源事实读取和展示、特例分发混在 `decision-read-model.ts:188`。 | 6B；S6:11（通知和卡的主体底座）、S7:361、:170/:180/:365、S8:458。 | 只拆来源事实处理器，保留公共校验；展示侧沿已有注入机制扩展。 | 不会；保留公共入口检查、`:921` 后置 pin 校验、数组顺序、返回字段，不提前统一读 Goal。 | 1100–1400 | 1（6B 主体扩展前） | 部分成立；原 1,800–2,400 把展示侧障碍夸大了，收窄到事实侧 441 行＋专属辅助约 530 行。`C#3/RC#3` | 中 |
| A2 | `record-readers.ts:150`、`:186`、`:280` 维护 Run 持久化校验，`run-snapshot-decoder.ts:18` 再从材料注册表取 validator；执行协议校验归在 materials。 | 7B；S7:126、§0.3 L7、§2 `RunContinuationV1`、`ConsumedWaitV1`。 | 把 Run/QueryRun validator、decoder、schema 移到 `persistence/` 协议模块；materials 只留读取和权限事实适配。 | 不会；原 validator 整体迁移，不改字段校验、缺字段处理、错误文本。 | 690 | 1（7B 前） | 成立；本区域 8 个 task 文件导入该 decoder，7B 新增 `expiry`、`intervention` 必须改这里。`A#2/RA#2` | 高 |
| D5 | `workflow.ts:1371` 任务门、`:1577` 自动化确认、`:1007` 挑人藏在同一 2,945 行闭包，辅助函数和 `selectNext` 跨段。 | 7B（任务门）/7C（挑人）；S7:16、S7:166、§6。 | 先提任务门/自动化判定和执行者选择两个内聚模块；规划桥不在 6B 前拆。 | 不会；保留选择顺序、失败卡排除、request ID、回执、继续位置、整目标返回。 | 1100–1500 | 1（任务门 7B 前、挑人 7C 前） | 部分成立；撤回“规划桥 6B 前拆”，收窄门/选择器及直接辅助 500–650 行；修正后 1,100–1,500 行。`D#5/RD#5` | 高 |
| B4 | `continuation-brief.ts:169`、`:299`、`:343`、`:382`、`:1108` 一个 1,703 行文件同时做格式、校验、摘要、中文模板和截断布局；`unknown-call-review.ts:850` 用中文渲染算字节预算。 | 7C；S7:178（接任者 continuation brief）、决定 83。 | 同层拆成格式/校验、摘要与标记、确定性版本化渲染；保留共同预算计算和逐字节输出。 | 不会；不改输出字节、截断次序、预算、摘要算法。 | 1400–1600 | 1（7C 相关扩展前，与 83 冻结边界对齐） | 部分成立；只移 336–984 行渲染及少量摘要入口，约 1,300 行搬迁，加导入/转出口 1,400–1,600；不迁整个校验区。`B#4/RB#4` | 中 |
| B8 | `session-responsibility.ts:53` 机器已拿到 destination，却只收 boolean；`session-responsibility-service.ts:98` 的 7 行资格判断留在 owner。 | 7D1；S7:195（L25 新增纯 `planReanchor`、扩 transfer）、§6。 | 只把 7 行接任资格移到 state 共享，保留现有 guard 接口、调用次数和转移流程。 | 不会；保留 owner 408/428/627 调用位置，408 在 417 basis 读取之前。 | 25–45 | 1（7D1 前） | 部分成立；原 160–300 高估，只移 7 行资格函数并加导入导出。`B#8/RB#8` | 高 |
| A5 | `execution-entry-service.ts:130`、`:203` 等把跨 owner 用的协议支持函数放在执行入口模块；本区域 13 个文件从这里导入。 | 无明确分片；S6:398 只列计划功能，未要求这些 helper 新增规则。 | 把与执行语义无关的 owner 支持函数移到中立模块，真正执行准入和效果编译留下；原名可转发。 | 不会；保留 `loadReplayEvent:1245` 严格核对、B2 文本、`mergeGuards:2080` 首次出现顺序。 | 240 | 2（合拢后） | 部分成立；出口位置成立，但 6B 前置依据不足，helper 主体 60–90 行、含导入约 240 行，改列第 2 类。`A#5/RA#5` | 高 |
| A7 | UCR `unknown-call-review-service.ts:158`、`:1378` 和 CRR `command-rerun-request-service.ts:348`、`:434` 各自混入列表读取协议；UCR 还内嵌命令事实读取、展开和封顶。 | 无；S7:16 的 K3 接缝是 Workflow 任务门。 | K3 模块内分 UCR/CRR readers 和 blocked-command facts builder；写 owner 保留状态机与 commit。 | 不会；保留 UCR 同水位重试、先定窗口后过滤、CRR 每页一次 lookup、每次调用一次 closure、封顶删除次序。 | 1240 | 2（合拢后） | 成立；“无”成立，只读列表仍要写服务形状，586 行主体、约 1,240 行迁移。`A#7/RA#7` | 高 |
| D7 | `create-platform.ts:1660`（46 行）＋`:338`（24 行）把注记答复落实的选项、身份解析、重读、重放 ID、pointer pin、`source_stale` 放在组合根。 | 无；S8:122（修补卡不是 `note_review`）、S8:11（按来源适配）；8C/6B 不要求扩此适配器。 | 把注记 application 及专用解析移到 `business/workflow` 适配器，组合根只构造登记。 | 不会；保留答复重读、pointer pin、空条件、`source_stale` 转换。 | 140–220 | 2（合拢后） | 部分成立；业务位置成立，但 8C/6B 关联被扩大，新增登记不扩此适配器。`D#7/RD#7` | 高 |
| D9 | `query-observation.ts:77`、`:88`、`:98`、`:109`、`:119` 重复 `kernel-turn-facts.ts:28`、`:39`、`:62` 的解码、起点查找、事件归约；完整性和 unknown 约 10 行也与 `execution-observation.ts:122`、`:172` 重复。 | 6A 会碰活动；S6:182（L1 算法不变）、S6:185（增量在终态提交），不要求先合并。 | 只合纯 Kernel 事实函数，需要的 start position 一并返回；Work/Query 终态、Answer、平台事件映射继续分开。 | 不会；只合纯函数，不合分页、缓存、平台终态映射，不减读取。 | 100–160 | 2（合拢后） | 部分成立；原 6A 前置依据不足，32 行解码＋约 10 行判断重复。`D#9/RD#9` | 高 |
| D11 | `core-routes.ts:922` 75 行在 HTTP 路由层做重放、Run/control/Goal 读取、`reworkFenceOf` 围栏、CAS pins 和重排 ID；入口组合在 `:822`。 | 无；S7:180 的 7C 返工工具包已有返工服务，不扩 release-hold。 | 移入业务层的有限组合动作，路由只调用并保留响应包装；两个提交不合并。 | 不会；保持“先查重放再读新 pins”、两个独立提交、重排失败仍返回 hold 已提交。 | 210–280 | 2（合拢后） | 成立；75 行主体＋接线 210–280 行。`D#11/RD#11` | 高 |
| D12 | `capture.ts:317`–`:467` 151 行做语言覆盖、去重、索引状态、排序，和授权、过期、释放的 registry 同文件。 | 无；S8:457/458 是正式目录、负责关系、修补；8A/8D/L8 已合入。 | 抽只接收冻结 observation、scan、provider、限额的文件图组装器，registry 留授权、版本、生命周期。 | 不会；显式传 `workspaceIdentity/commitHash`、`hostRoot/hostRealRoot`、`requestedConfigPath`、signal，保留授权、取消、排序。 | 360–440 | 2（合拢后） | 部分成立；原 500–620 偏高，主体 302 行，加辅助、类型和包装 360–440 行。`D#12/RD#12` | 高 |
| A3 | `plan-readers.ts:2210` 的 `createSessionResponsibilityBasisReader` 埋在 2,323 行 Plan 读取集合末尾，非 task 在 `:2231` 统一返回 incomplete。 | 7D1；S7:200（非任务 basis）、§6；不构成前置。 | 抽独立 responsibility-basis reader，继续注入现有窄端口，复用 Plan 和 canonical task readers。 | 不会；保持非 task 原拒绝，新目标类型由 7D1 功能提交完成。 | 265 | 3 | 部分成立；工厂和窄端口已存在，主体 114 行，收益主要是组织上的。`A#3/RA#3` | 高 |
| A4 | `evidence-service.ts:1459`–`:1618` 把轮次开立、check 收束、定案、重新检查混在 2,036 行；`:1618` 是 `replayReverify`，定案从 `:1459` 起。 | 7C、8C；S7:180、S8:347；不构成前置。 | 分“轮次开立准备”和“重新检查请求 owner”；保留唯一提交贡献汇总。 | 不会；保留来源读取和拒绝顺序，复用 `prepareRoundOpening:897`。 | 1340 | 3 | 部分成立；共享开轮已覆盖复用，准备段 107 行＋重新检查段 415 行＋辅助 120 行。`A#4/RA#4` | 高 |
| A8 | `project-bootstrap-service.ts:528`、`:699`、`:812` 项目/工作区登记和完成标准安装、激活共用 1,145 行文件。 | 6C；S6:178（`ProjectCompletionPolicyActivated` 带 `acknowledgementRef`）；不构成前置。 | 可分出 completion-policy configuration 服务，保留公共 admission/replay；不为这次证明字段先搬。 | 不会；仅职责迁移。 | 1000 | 3 | 成立，仍第 3 类；政策安装/激活 257 行＋政策读取 72 行，为一个证明字段先搬收益有限。`A#8/RA#8` | 中 |
| B2 | `state/query-run-recovery.ts:449`、`:516` 主要提供构造器；正常准入散在 `queries/query-execution.ts:889`、`:1058`、`:1198`、`:1490`。 | 6A；S6:6（复用已有 Query 阶段驱动）、:86/:102/:111/:118；不构成前置。 | 只原位抽纯判断，不把公开准入、构造器断言、恢复规则合成一套。 | 不会；保留拒绝顺序、读取短路、构造器防错。 | 180–300 | 3 | 部分成立；原 300–500 偏宽，统一 phase 检查会提前拒绝、少读 manifest。`B#2/RB#2` | 高 |
| B6 | `message-machine.ts:516` 自认 capacity reason 不是业务结果；常量在 `message-record-codecs.ts:98`，实际检查在 `mailbox-service.ts:453`，`:3678` 还有空串文字。 | 7A；S7:91、§6:700；不构成前置。 | 只共享正文限额和分类谓词；各入口保留自己的错误码、文字、检查位置。 | 不会；保留 16 KiB、UTF-8 计数、空串规则、错误码和文字。 | 40–70 | 3 | 部分成立；三处不是同一拒绝协议（`capacity`、`invalid`、`storeBody` 文字），只共享十余行。`B#6/RB#6` | 高 |
| B9 | `decision-contracts.ts:361` 用 `needsGoal` 加可选 goal；`decision-read-model.ts:226` 的 collection spec 要求 Goal，`:269` 无 Goal 空页，candidate 在 `:939` 被排除；`goal_cause`、`planning_question`、candidate 是三条不同接法。 | 6B/7A/7D2/8C；S6:11、S7:361/365、S8:458；不构成前置。 | 只记录 candidate 枚举和直接读取绕过登记的成本；保留现有分页适配差异。 | 不会；复用已读 Goal，保持先全部 live 后全部 closed 的顺序和水位。 | 160–260 | 3 | 部分成立；原“没有完整扩展入口”过重，`goal_cause`、`planning_question` 已返回同一端口，项目主体按 6B 规格。`B#9/RB#9` | 中 |
| B10 | `in-memory-record-store.ts:71` 660 行、`sqlite-record-store.ts:111` 843 行两套物理事务和查询；共同 schema 在 `create-platform.ts:676` 只登记一份。 | 无；S6:99 新增索引走共同登记，不要求 backend 私有扩展。 | 记录成本；若换 SQLite `:memory:` 须先证明事件字节、回调和失败协议等价。 | 会：memory 保存解析后事件、读取时 `JSON.stringify`，SQLite 写原 JSON；关闭错误文字不同；SQLite `:287` 拒绝事务内读取。 | 无可信总估计（原 700–900 撤回） | 3 | 部分成立；原第 2 类撤回，直接替换不是已证明行为不变。`B#10/RB#10` | 中 |
| C4 | `mailbox-service.ts:1042` 的工厂同时包历史读取、当前写授权、正文写入、消息动作、咨询答复、等待处置；共享写者在 `:3640`。 | 6B/7A/7B/7C；S7:700/701、S6:11；不构成前置。 | 只归拢共享持久化实现并收窄依赖；现有独立写者继续复用。 | 不会；不改提交边界、回执重放、正文来源、同步快照、历史/当前授权区别；不先移除 `:380` 的 Query 拒绝。 | 1100–1400 | 3 | 部分成立；原 2,000–2,800 片前拆分证据不足，只归拢 408 行＋上下文约 500–600 行。`C#4/RC#4` | 中 |
| C6 | `decision-read-model.ts:188`、`:206` 两个旧卡源与通用 collection adapter 协议不等价；`planning-question-reader.ts:123` 每页先读/校验 Goal 再查缓存，通用工厂在缓存未命中才读。 | 6A 和 6B 会扩下层；S7:361 新建 `message_release`；不要求迁这两个旧源。 | 暂不强迁；若迁，先显式保留页元数据和旧分页、定位协议。 | 直接替换会改分页、水位、`availability`、`sourceCursor`、缓存和失败范围。 | 400–660 | 3 | 部分成立；实际只有两个现行卡源，不是三个；单卡读取命中当前页即返回，不是完整枚举。`C#6/RC#6` | 高 |
| C7 | `session-directory.ts:111` 与 `mailbox-service.ts:141` 各 4 行运行时等价的完整 Run 身份判断，只差声明类型谓词和 boolean。 | 6/7 会碰文件；S7:181、:708；无已确认的新副本需求。 | 只记下；出现第三个同语义消费者再抽具名判断，保留 codec 严格字段校验。 | 不会；保留额外字段容忍；换严格 codec 会变。 | 24–40 | 3 | 成立，仍第 3 类；8 行删除，加共享声明和导入调整 24–40 行。`C#7/RC#7` | 高 |
| D6 | `create-platform.ts:628`、`:629`–`:664` 24 个 bundle 各展开 records/events/lookups 三次，另有 execution-history events-only，共 73 次。 | 7A；S7:700；其他新记录见 S7:706、S8:458；无新增独立 bundle 的规格依据。 | 一份有序 bundle 清单统一展开三集合，events-only 显式声明；保留索引完整性检查。 | 不会；保留登记顺序和 events-only 例外；execution-history 事件保持原位置。 | 90–140 | 3 | 部分成立；原第 1 类撤回，规格不要求新增独立 bundle，收益限于一处短登记表。`D#6/RD#6` | 中 |
| D8 | `runtime.ts:524` 15 行与 `create-platform.ts:1485` 13 行重复 Host/项目检查、Session 读取、completed boundary 翻译；真正边界验证已共用 `session-operations.ts:925`。 | 7B；S7:162（`platform_facts` 派生）；决定 83 未指定此端口。 | 留一个 Runtime 边界读取实现，组合根只加关闭准入包装；无完整 Runtime 时抽共同工厂。 | 不会；保留关闭拒绝、Host 检查、失败结果、注入能力；不加 drain。 | 70–110 | 3 | 部分成立；原第 1 类撤回，只重复约 28 行边界读取包装，低收益。`D#8/RD#8` | 高 |

## 2. 第二轮判“不成立”的条目

- **A9**：`planning-question-reader.ts:137` 与 `decision-read-model.ts:257` 只是分页外壳相似；真正相同的 offset 和切片仅数行，Goal 读取时机、`sourceCursor`、limit 不同，迁移会改 store reads、拒绝结果和返回字段，220 行主要是该 reader 特有的代码；剩余规格未要求扩写它。`RA#9`
- **B3**：`plan-machine.ts:32`、`message-machine.ts:43` 写明单一声明、model 转引；`SessionOperationRecord` 在 `session-contracts.ts:24` 也是单一定义，没有维护副本；约 250 行声明的迁移可达 600–900 行，不能证明减少分片工作。`RB#3`
- **B5**：`note-service.ts:1595` 的 dispose 已串作者、书记范围、版本、冲突和转移；`note-machine.ts:88` 的 `noteWriteAuthority` 是写入修补权限，不是重复的处置授权；先备齐事实会把 `:1644` 的拒绝移到 `:1649` 的读取之后。`RB#5`
- **B7**：`plan-validation.ts:1` 的纯校验只有一份，两条采用路径调用同一组校验，`plan-machine.ts:948` 统一解释结果；owner 分步调用是为短路，不是两份算法；S8:457 明确在现有文件加目录核对。`RB#7`
- **C5**：`catalog-service.ts:697` 构造、`:730` 提交确实绑死，但 S8:9 已规定 8C 的目录修订规划器是唯一写入方、返回提交贡献；首轮改法就是冻结规格，按第二轮第 7 条排除。`RC#5`
- **D4**：`consultation.ts:207` 的 28 行阶段驱动确实绑咨询身份，但 S6:6 已规定 6A 建共用入口并复用已有 Query 阶段驱动，S7:703 明确探索不经 `consultation.ts`；与冻结规格安排重叠。`RD#4`
- **D10**：`host.ts:1277`–`:1440` 的书记投递与 `:1448` 的注意力确认语义不同，但 S7:15 已逐项规定复用 4C-2 提醒投递外壳、7D 换正式负责范围、7C 改注意力时改用该外壳，S8:12 也指定修补待办使用它。`RD#10`

## 3. 四个区必答问题的答案（按第二轮修正）

**A 区**

- **A-问1**：`tasks/` 确有按不同变更原因分开的部分，但不需要先整搬 65 个文件；claim、执行入口/历史、run state/reconcile、plans/readers、goal settings、K3 应各自成组。剩余片分别在 7B（claim continuation）、6B/8B/6C（plan）、6B/7D2（goal）、7B（session facts）、6A（activity）加代码。`A 问答1/A#1/A#2/A#6`
- **A-问2**：当前是 21 个 owner 实现文件、35 个 `.commit` 位置，但不存在 21 段可整段互换的八步代码；最接近的是两个 workspace settings owner 约 70 行相似外壳，K3 共享尾段只有个位数到十余行，不建议全局 owner 骨架。剩余片新增 12 类持久记录，但不能算成 12 个新事务 owner。`A 问答2`
- **A-问3**：store-failure mappings 保留命名明确的策略入口，不合成带许多开关的通用 mapping；差异在 `busy` 与 `revision_conflict`、有无 current、是否保留 `unsupported`/`corrupt`。`A 问答3`
- **A-问4**：look-alikes 多数应保留：47 行 safe-integer 不是同一谓词；6 个 `isRunRef` 前 5 个可共用一个允许额外字段的完整谓词，reconcile 的弱检查不同；17 个 `refKeyOf` 抛错和 nullable 语义不同；6 个 `sameRef` 语义相同，可复用 `sameJson`；`sameTask` 是领域身份；K3 的 `sameReviewRef`/`sameRunRef` 在区域外；codec 交给生成试点。`A 问答4`

**B 区**

- **B-问1**：剩余片新增 12 种持久记录（6A `QueryActivity`；6B `InitializationBindingV1`；7A `DispatchCounter`；7D1 `SessionRoleFactsV1`、`ProjectRoleLimitsV1`、`RoleLineAllocationV1`；7D2 `GoalAdviserQueueV1`、`AutonomyRuleV1`、`AutonomyRuleSetV1`、`RoleCapacityEpisodeV1`；8C `ArchitectureProposalV1`、`ArchitectureProposalBatchV1`），明确命名的新事件只有 `ProjectRoleLimitsChanged`。以 RunActivity 为例端到端有 17 个生产维护入口、3 个代表性测试文件；试点应在 6A 前做有界试验（2 个 decision 事件＋1 个 line-settings 事件），因为 6A 是第一个新增持久记录的片。`B#1/B 问答1/RB#1`
- **B-问1（续）**：格式说明必须能表达校验顺序和首错、严格字段/额外字段/投影、数值域、null/缺省/union/跨字段、抛错/nullable/boolean、结构相等与领域身份、store failure 业务映射；不能同时生成实现和全部测试期望。`B 问答1`
- **B-问2**：双后端是 2 个主实现 1,503 行，加 SQLite 支撑 6 文件 2,195 行（保留 SQLite 时大部分不能删），7 类读取和 1 类提交各有两条路径，13 个测试 3,700 行，69 处参数化声明跨 8 个文件，81 个测试或 helper 引用两个 factory。剩余片 12 种记录只登记一份共同 schema，新增 4 个具名索引，7D1/7D2 有嵌套 cursor；没有 backend 私有扩展，但 memory 换 SQLite `:memory:` 会改事件 JSON 字节、关闭错误和事务内读取，不能算行为不变，因此只记成本。`B 问答2/RB#10`
- **B-问3**：state 和 owner 的划分总体清楚；例外是 Query 正常准入（B2，第 3 类）、消息正文（B6，第 3 类）、责任接任资格（B8，第 1 类）、注记处置（B5 不成立）、Plan 纯校验（B7 不成立）。`B 问答3/RB#2/RB#5/RB#6/RB#7/RB#8`
- **B-问4**：contracts 与 model 的原则可用（跨模块共享的纯记录、事件、引用放 contracts，owner 端口和依赖放 model，机器输入、effects 放 state），但三组声明位置没有完全贯彻；不过它们都是单一定义加 model 转引，第二轮不认为必须搬，也没有证明存在重复副本；`GraphContextFactsV1`、各类 `*Dependencies` 留 model 合理。`B 问答4/RB#3`

**C 区**

- **C-问1**：三个手写卡源实际只有两个：`goal_cause`、`planning_question`；`message_release` 尚未实现，迁移成本为 0，7A 新建时直接登记通用源。两个旧源保留旧协议约 400–660 行（`goal_cause` 100–180，`planning_question` 220–360，公共适配 80–120）；迁移会改分页、水位、`availability`、`sourceCursor`、缓存，`planning_question` 每页先读 Goal 并核工作区，通用工厂在缓存未命中才读，所以不强迁，先做 C3 的来源事实模块，且排在 6B 前。`C 问答1/RC#3/RC#6`
- **C-问1（续）**：剩余片卡源：6B 主体底座（没有新的命名 kind），7A `message_release`，7C `member_creation`、`rework_request`（换手批准卡没有独立字面量），7D2 `role_capacity`、`role_line_change`，8C `repair_approval`、`structural_proposal`。`C 问答1`
- **C-问2**：活动、track、timeline 已共享 Budget、扫描和活动投影，剩四份稳定窗口流程（C2，第 1 类）；decision cards 三个 collection 源共享组装、缓存和 offset，两个旧源保留自己的协议；notices 有位置和分组公共模块，work-line/node-detail 共享 brief 和 continuation，note reads 有自己的游标，queries 还没有请求列表分页。新增读口是 6A `main/read`、`requests/read`、`activity/queries`，7D1 角色上限和 allocation，7D2 `role-lines/read`、`operations`、参谋队列、自治规则，8B 维护者投影，8C 提议和批次；可确定避免的是第五份稳定窗口流程，不是统一分页器。`C 问答2/RC#2`
- **C-问3**：sessions 和 communication 已有可继续用的 owner 和端口，跨多个文件改动本身不是缺陷。6A 新 `queries/request-service.ts`、`views/main-surface-read-model.ts`，并动 queries contracts、job service、codecs、execution，state recovery、request-facts-reader、Runtime preparation/observation、Host 和路由；6B 扩 `session-record-codecs` 的 operation（当前只接受 create）、model 契约和状态迁移，并接 `session-responsibility-service`、`session-lifecycle`、目录操作，跨区新增 handoff driver、`workflow/secretary-handoff.ts`、`session-maintenance.ts`、`session-archive.ts`；7A/7B/7C 分别扩 mailbox、message codecs、decision application、state machine、路由和多处调用入口。要避免的是各片另写一套建线、换手或提交流程。`C 问答3`
- **C-问4**：notes 不需要再整体拆；已有 batch reader、continuity、update-due、related-scope、note-decision-source、scribe-todos 等结构。剩余是 6A 无目标记忆分支（`note-memory-material.ts:21`、`note-read-model.ts:1907`），6B/7D2 的 Query 写注记与 role scope（`note-service.ts:135`、`scribe-scope.ts`），6B 不挂目标的通知和待审卡（`note-review-notices.ts:122`、`decision-read-model.ts:269`），7D2 汇总通知（`notice-grouping.ts`），8B 维护者（`node-detail-reader.ts:814`），8C 修补（C5 已由规格安排）。`architecture-service.ts` 1,749 行没有仅因大而列项，8B/8C 的重点是正式目录和负责关系。`C 问答4/RC#5`

**D 区**

- **D-问1**：加一条路由今天至少改 2 个已有文件（`core-http-types.ts`、`core-routes.ts`），5 处同步表示，当前 POST 路由 120 条；加一个 Work 工具组最小 2 个文件（工具定义/工厂＋`execution-driver.ts`），进 Query 通常 4 个；K3 的 `request_command_rerun` 追到 6 个生产文件；owner 进 Host 单纯创建和发布 1 个 composition 文件，同时供 Runtime/Workflow/HTTP 通常 4 个接线文件；加一个 Workflow step 2 个文件（`contracts.ts`、`workflow.ts`），带新 owner 4 个，当前 18 种 `WorkflowCalls`。剩余片明确 34 条新路由、7 个新工具名。`D 问答1/RD#1/RD#2/RD#5`
- **D-问2**：决定 83 的代码应落在 `context-assembler.ts` 及邻居：模板、变量、版本在 `role-profiles.ts`；provider/model 选择在 `runtime-configuration.ts`；最终请求记录在 `observed-model-run.ts`；初始化 guide 在 `query-preparation.ts`；秘书请求历史边界在 `session-operations.ts`。先按 D3 拆现有渲染、事实读取和调用配方（3,200–3,800 行，83 补规格冻结后、6A 前），再实现 83 的新模板、裁剪、thinking 和记录，不把新功能算进结构搬移。`D 问答2/RD#3`
- **D-问3**：N0 归 T，不是 6A/7 的结构项：6A 用新的 request-round 提交和 Query 驱动，不建在 N0 goal input 上；6B/6C 用真实规划桥（`planning_answer` 调 `proposeInitialPlanFromAnswer`，`adopt_initial_plan` 调 `applyPlanChange`）。T 删的是 N0 类型、导出和无实现的旧输入形状，不能删整个 `handleGoalInput`；D5 只提任务门和挑人，不包含规划桥。`D 问答3/RD#5`
- **D-问4**：Host 的 owner 接线是“一处创建、多处接入”：`host.ts:509` 调一次 `createTargetPlatform`，`:1576` 用同一 platform 建路由，没有 Host 和 composition 各建一套 work-graph owner。组合根把每个 owner 依次接 schema、其他 owner、Runtime、Workflow、读模型、公开 platform；新 owner 的成本主要是窄端口、卡源/application adapter、后台 Host 生命周期、关闭/排空，不是把 2,343 行拆成几个“第几部分接线”。结构上明确要迁的是 D7（第 2 类）；D8 只记下（第 3 类）；D10 因规格已安排复用而不成立。`D 问答4/RD#7/RD#8/RD#10`

## 4. 每类合计与行为 bug

| 归类 | 项数 | 行数（修正后） | 依据 |
|---|---:|---:|---|
| 第 1 类（片前做） | 13 | 11,300–14,250 | A 3 项 1,195；B 3 项 1,775–2,245；C 3 项 1,330–1,760；D 4 项 7,000–9,050。`RA 末行/RB 末行/RC 末行/RD 末行` |
| 第 2 类（合拢后做） | 6 | 2,290–2,580 | A 2 项 1,480；D 4 项 810–1,100；B、C 无。`RA 末行/RD 末行` |
| 第 3 类（只记下） | 12 | 4,669–5,585，另 B10 无可信总估计 | A 3 项 2,605；B 3 项 380–630，加 B10；C 3 项 1,524–2,100；D 2 项 160–250。`RA 末行/RB 末行/RC 末行/RD 末行` |
| 合计 | 31 | — | 7 项不成立另列，见 §2。`RA 末行/RB 末行/RC 末行/RD 末行` |

按区核对：A 区 3/2/3，B 区 3/0/4，C 区 3/0/3，D 区 4/4/2；合计第 1 类 13、第 2 类 6、第 3 类 12。`RA 末行/RB 末行/RC 末行/RD 末行`

行为 bug（两轮单列，不计结构发现）：

- `src/core/work-graph/tasks/goal-decision-reader.ts:425` 接收 `atLeastCursor`，实际读取路径未使用；C1 裁定第 9 条已交独立修复，属已知、非本轮新增。`A 行为单列`
- `src/contracts/ledger.ts:103` 接受 `10_000_000_000` 并生成 11 位数字 cursor，但同文件 `:109` 的解析器只接受 10 位，生成值不能被自身解析器接受；静态可确定，未运行复现。`B 行为单列`

C、D 两轮未报有足够证据的行为 bug。`RC 末段/RD 末段`

## 5. 两轮或两区之间的矛盾，以及重叠

**两轮之间的矛盾（第二轮覆盖第一轮）**

- A1 从 2,100 行缩到 420 行，范围从整文件收窄到“初始回答事实读取＋采用复核”；A3、A4 从第 1 类降到第 3 类，A5 从第 1 类降到第 2 类，A9 从第 3 类改为不成立。`A#1/RA#1/A#3/RA#3/A#4/RA#4/A#5/RA#5/A#9/RA#9`
- B2 从第 1 类 300–500 行降到第 3 类 180–300 行；B4 从“6A 前 1,500–1,800 行”改成“7C 前 1,400–1,600 行”；B8 从 160–300 行降到 25–45 行；B9 从第 1 类 450–800 行降到第 3 类 160–260 行；B10 从第 2 类 700–900 行“行为不变”改成第 3 类且不能证明行为不变；B3、B5、B7 改为不成立。`B#2/RB#2/B#4/RB#4/B#8/RB#8/B#9/RB#9/B#10/RB#10/RB#3/RB#5/RB#7`
- C1 从 180–280 行降到 110–160 行；C3 从 1,800–2,400 行收窄到事实侧 1,100–1,400 行；C4 从第 1 类 2,000–2,800 行降到第 3 类 1,100–1,400 行；C5 改为不成立；C 区还纠正“三个手写卡源”为两个。`C#1/RC#1/C#3/RC#3/C#4/RC#4/RC#5/C 问答1`
- D1 从 650–950 行升到 2,200–3,000 行；D3 从 1,900–2,600 行升到 3,200–3,800 行，并把时点改到 83 补规格冻结后；D5 从 1,500–2,000 行且“规划桥 6B 前拆”改为 1,100–1,500 行并撤回规划桥；D6、D8 从第 1 类降到第 3 类，D7、D9 从第 1 类降到第 2 类，D4、D10 改为不成立。`D#1/RD#1/D#3/RD#3/D#5/RD#5/D#6/RD#6/D#7/RD#7/D#8/RD#8/D#9/RD#9/RD#4/RD#10`
- 最直接的对立是 B10：第一轮说 memory 换 SQLite `:memory:`“不会改变领域行为”，第二轮列出事件 JSON 字节、关闭错误文字、SQLite 事务内读取拒绝三处差异，判定不能证明行为不变，并撤回 700–900 行估计。`B#10/RB#10`

**跨区重叠（同一处改动不能重复相加）**

- B1 的 codec 生成试点和 D6 的 schema bundle 展开都经过注册链，但不是同一项：D6 只处理 `create-platform.ts` 的一次短登记表，B1 处理编解码和 envelope/ref 检查；D6 明确说与决定 70 的试点不是同一项。`B#1/RB#1/D#6/RD#6`
- C3、B9、C6 都在卡源和 `decision-read-model.ts`、`decision-source-facts.ts` 一带，但范围已拆开：C3 只算来源事实处理器 1,100–1,400 行，不含展示侧；B9 只算 candidate 适配 160–260 行；C6 只算两个旧源 400–660 行，三者不能相加成一次迁移。`C#3/RC#3/B#9/RB#9/C#6/RC#6`
- A6、C2、D9 都叫“活动”，但是三件不同的事：A6 是纯活动替换策略，C2 是读取重试的稳定窗口外壳，D9 是 Kernel 记录解码和 Turn 事实；行数分别 85、120–200、100–160。`A#6/RA#6/C#2/RC#2/D#9/RD#9`
- B4 和 D3 都涉及提示词和渲染，也都与决定 83 相连，但是不同文件、不同时点：B4 在 `continuation-brief.ts`，7C 前；D3 在 `context-assembler.ts`，6A 前。两者不能合并成一次搬迁。`B#4/RB#4/D#3/RD#3`
- A1 已把范围收窄到初始回答事实读取和采用复核，明确不包含请求候选；B9 的 candidate 适配在 `views/`，两者不重复。`A#1/RA#1/B#9/RB#9`
- A2 和 B3 都涉及持久协议的位置，但对象不同：A2 是 Run/QueryRun validator 和 decoder，B3 是 Plan/Session 记录声明；B3 已被判不成立，两者不能互算。`A#2/RA#2/RB#3`
- A3 和 B8 都在责任关系上，但 A3 是 basis reader 的放置和读取，B8 是 7 行接任资格的纯函数；前者第 3 类 265 行，后者第 1 类 25–45 行，不能互算。`A#3/RA#3/B#8/RB#8`
- C4 和 B6 都改 `mailbox-service.ts`，但 C4 是共享持久化写者的归拢，B6 是正文限额和分类谓词；C4 第 3 类 1,100–1,400 行，B6 第 3 类 40–70 行。`C#4/RC#4/B#6/RB#6`
- A4 和 C5 都落在 8C 的事务组合上，但 A4 是 evidence 开轮和重新检查，C5 是 catalog 修订规划器；C5 已由 S8:9 的冻结规格安排，不能算作与 A4 同一次结构清理。`A#4/RA#4/RC#5`
