这份副本上的 C1 仍可做，但需要收窄几项旧建议。**去重后复核 59 项：43 项保留为 C1，16 项撤出本轮；另列 `atLeastCursor` 修复。C1 预计净减约 1,900–2,510 行，27 项包含 K3 文件。**

全程只读，未修改文件，未运行测试、构建、网络请求或额外模型调用。没有旧版源码或 Git 历史，因此“新增”依据合入功能的位置和原审查范围确认，不冒充逐提交 diff 结论。

以下路径默认相对 `src/core/work-graph/`；写出 `src/` 的是仓库根路径。行号均为当前副本。净减行数已扣除共用实现和接线，重叠项只计一次，不计测试。表中 **K＝“K3 合入后再核”**，依据 `.lead-ref/k3-all-files.txt:31、47–113`。

**一、共用小工具**

| 项目、现状 | 唯一共用位置及接线 | 必须保留的差异和边界 | 净减行数 | K3 |
|---|---|---|---:|:---:|
| XX-1：仍在。原 153 处之外，补审范围另有 10 处，位置见后表 | 复用 `src/contracts/validation/common.ts:11–13` 的对象判断；同文件增加非空字符串、安全正整数、允许字段集合判断，分别搬用 `persistence/rework-codecs.ts:26–28`、`sessions/lifecycle-record-codecs.ts:131–136`。位置表内同名调用改为导入；已有导出保留转出 | 不增加 trim；正整数仍是安全整数且 ≥1；允许字段集合只排除额外键，不要求所有键存在。不能换掉要求键数相等的 `notes/note-read-model.ts:117–120` | 320–360 | K |
| XX-2／SE-1：仍在。旧 46 个事件外壳保留，注记及 L8 另计 N3 | 新建 `persistence/event-envelope.ts`，原样搬用 `configuration/project-bootstrap-record-codecs.ts:383–391`；位置表 E 中各编码出口保留原参数类型，内部调用共用函数。邮箱选择编码器的 `communication/mailbox-service.ts:3559–3570` 随原出口接线 | 外层字段顺序、`schemaVersion`、`occurredAt` 和 `JSON.stringify(event)` 原样保留；不能改成 canonical JSON，不能重新投影事件正文。消息领域出口 `sessions/message-record-codecs.ts:1170–1210` 继续存在 | 190–225 | K |
| XX-5：仍在，旧 26 处 | 在 `src/contracts/fingerprint.ts:25–27` 旁增加 nullable 包装，搬用 `communication/decision-service.ts:62–68`；位置表 C 全部接线 | 只捕获 canonical JSON 失败并返回 `null`；不吞掉原来直接抛出的异常，例如 `architecture/architecture-service.ts:154–156` | 90–105 | K |
| XX-6：仍在，旧 16 处 | 在 `src/contracts/validation/common.ts` 增加对象解析助手，搬用 `materials/run-snapshot-decoder.ts:23–30`；位置表 J 全部接线 | JSON 错误、数组、null、标量均仍返回 `null`；带详细错误文字的解析器留给 PE-2，不改变解码结果协议 | 75–90 | K |
| XX-7／TA-7：仍在 | 在现有 `persistence/read-result-failures.ts:30–37` 所在模块增加独立的写失败映射及 pin 解码；分别搬用 `sessions/session-directory.ts:125–165`。切换 mailbox、directory、lifecycle、responsibility 四份完整映射；claim、entry、history 只接相同 pin 部分。entry/history 的另一套相同映射单独保留一个实现 | 四服务的 unique 冲突仍变成 `revision_conflict`，附加 ` (the unique slot is held by another owner)`；corrupt 仍加 `the record store reported damage: `。entry/history 的 unique 冲突仍是 `busy`，附加 ` (the Kernel identity slot is held by another Run)`，unsupported 仍变 unavailable。claim 的 corrupt 不加前缀，不能整体换用四服务版本。空 pins 仍省略 `current`；现有通用读映射却允许 `current: []`，两者不能混用。证据：`communication/mailbox-service.ts:171–192`、`tasks/claim-service.ts:133–159`、`tasks/execution-entry-service.ts:153–177`、`tasks/execution-history-service.ts:107–133`、`persistence/read-result-failures.ts:35` | 80–100 | K |
| 拒绝结果助手：仍在，但不能把旧“148 个”当成一种协议 | 新建 `src/contracts/core/rejections.ts`，按形状分别提供普通 Core rejection、非空 current 版本和 `{ok:false,code,reason}` 版本；原型分别取 `tasks/context-input-service.ts:104–106`、`queries/query-execution.ts:83–87`、`views/note-views.ts:82`。codec 的 `{status:'invalid',reason}` 单独放在校验公共层，原型为 `persistence/record-codecs.ts:96–98`。接线范围见 R 表 | 固定 code、reason 参数、属性存在性和构造顺序保持。`state/transition.ts:38–49` 的 `{ok:false,reason,detail,code}` 是另一协议，保留；`tasks/context-input-service.ts:108–110` 等带业务固定文字的包装也保留。`queries/query-job-service.ts:91–95`、`tasks/requeue-service.ts:188–190` 继续省略空 current | 100–140 | K |

共用工具的当前接线位置如下。O/S/N/K 分别表示对象、非空串、安全正整数、允许字段集合，数字是起始行，**均连续三行**；C/J/E 给完整范围。切换的是这些定义在各自文件中的全部引用；类型出口保留，不要求修改测试调用。

| 文件 | O/S/N/K 起始行 | C／J／E 范围 |
|---|---|---|
| `architecture/architecture-record-codecs.ts` | O99 S102 | E770–772；新增 E776–778 |
| `architecture/architecture-service.ts` | O119 S127 | — |
| `architecture/catalog-record-codecs.ts` | O86 S89 | E572–574、576–578 |
| `architecture/catalog-service.ts` | O105 S108 | — |
| `architecture/file-graph-index.ts` | 新增 O44 | — |
| `communication/decision-application.ts` | — | C32–38 |
| `communication/decision-service.ts` | O49 S52 N55 | C62–68 |
| `communication/decision-source-facts.ts` | O86 | C94–100 |
| `communication/mailbox-service.ts` | O120 S123 N126 | C133–139 |
| `configuration/decision-settings-service.ts` | O29 S32 | C38–44 |
| `configuration/line-settings-service.ts` | O48 S51 | C57–63 |
| `configuration/project-bootstrap-record-codecs.ts` | O84 S87 N90 | E383–391、392–400、401–411、412–422 |
| `configuration/project-bootstrap-service.ts` | O135 S138 N144 | — |
| `configuration/role-memory-service.ts` | O87 S90 N93 | — |
| `configuration/role-record-codecs.ts` | O46 S49 N52 | C71–77；E459–462、463–466 |
| `evidence/evidence-service.ts` | — | C148–150 |
| `materials/run-snapshot-decoder.ts` | O20 | J23–30 |
| `notes/note-anchors.ts` | 补审 O584 S588 N592 | — |
| `notes/note-service.ts` | 补审 O98 N278 | — |
| `persistence/commit-compiler.ts` | O141 | — |
| `persistence/control-record-codecs.ts` | O82 S85 N132 K135 | C149–151；J141–148；E440–443、498–501 |
| `persistence/decision-record-codecs.ts` | O109 S112 K118 | E53–61、77–87 |
| `persistence/evidence-record-codecs.ts` | O130 S133 K153 | C150–152；J142–149；E498–501 |
| `persistence/execution-entry-codecs.ts` | O54 S57 N60 K69 | J653–660；E716–719、737–740、768–771、783–786、802–805 |
| `persistence/execution-history-codecs.ts` | O66 S69 N72 K75 | J78–85；E130–140 |
| `persistence/line-settings-codecs.ts` | O79 S82 K88 | E49–57 |
| `persistence/note-record-codecs.ts` | 补审 O118 S121 N124 K127 | 补审 C138–144；J130–137；E553–556、629–632、674–677 |
| `persistence/plan-record-codecs.ts` | O86 S90 N98 | E1110–1113、1115–1118 |
| `persistence/record-codecs.ts` | O83 S87 | E754–762、895–903 |
| `persistence/rework-codecs.ts` | O23 S26 K38 | — |
| `persistence/run-activity-codecs.ts` | O61 S64 N70 K73 | C84–90；J76–83；E431–439、458–466 |
| `queries/query-execution.ts` | O94 S97 | — |
| `queries/query-job-service.ts` | O79 S83 | — |
| `queries/query-record-codecs.ts` | O136 S140 N144 | E547–555、615–623、669–677 |
| `sessions/lifecycle-record-codecs.ts` | O125 S128 N131 K134 | J137–144；E593–601、603–611、613–621、623–631、633–641、643–651 |
| `sessions/message-body-envelope.ts` | O52 S60 K56 | C184–190 |
| `sessions/message-record-codecs.ts` | O199 S202 N205 K208 | C211–217；E1170–1178、1202–1210 |
| `sessions/session-directory.ts` | O101 S104 | C110–116 |
| `sessions/session-lifecycle.ts` | O90 S93 K96 | C126–132 |
| `sessions/session-record-codecs.ts` | O115 S118 K142 | C145–151；J152–159；E1031–1039、1041–1049 |
| `sessions/session-responsibility-service.ts` | O67 S70 | C73–79 |
| `sessions/session-targets.ts` | O29 | C32–38 |
| `state/context-input.ts` | O80 | C93–95 |
| `state/run-machine.ts` | O2340 S2344 | — |
| `tasks/claim-record-codecs.ts` | O128 S131 | J137–144；E346–349、757–760、780–783 |
| `tasks/claim-service.ts` | O103 S106 N112 | — |
| `tasks/completion-record-codecs.ts` | O77 S80 N83 K100 | C97–99；J89–96；E233–236 |
| `tasks/completion.ts` | N111 | C104–106 |
| `tasks/context-input-service.ts` | S156 | — |
| `tasks/control-service.ts` | N399 | C189–191 |
| `tasks/execution-entry-service.ts` | O117 S120 N123 | C144–146；J147–152 |
| `tasks/execution-history-service.ts` | O76 S79 N82 | — |
| `tasks/initial-plan.ts` | O42 S45 | — |
| `tasks/model-request-codecs.ts` | O51 S54 N57 K63 | C77–79；J69–76；E193–196 |
| `tasks/plan-readers.ts` | O115 S118 | J130–137 |
| `tasks/plan-service.ts` | O252 S293 | — |
| `tasks/plan-validation.ts` | O18 | — |
| `tasks/plan-write-admission.ts` | O94 S97 | — |
| `tasks/request-facts-reader.ts` | O22 S25 | — |
| `tasks/requeue-service.ts` | O152 S155 | — |
| `tasks/run-activity-service.ts` | O83 S86 | — |
| `tasks/run-state-service.ts` | O104 S107 | C123–125；J126–133 |
| `tasks/session-anomaly-codecs.ts` | O42 S45 K51 | C62–68；J54–61；E325–333 |
| `tasks/session-anomaly-service.ts` | O91 S94 | J107–112 |
| `tasks/session-facts.ts` | O52 S55 | — |
| `tasks/session-provenance-facts.ts` | O60 S63 | — |
| `tasks/task-service.ts` | O304 S300 | — |
| `views/context-extensions.ts` | O54 | — |
| `views/decision-read-model.ts` | O1480 | — |
| `views/graph-context-reader.ts` | O95 S98 | — |
| `views/notice-display-token.ts` | O18 | — |

R 接线表只涵盖结果构造助手；表内有几种协议，必须按上述形状分别接线，不能共用一个会补字段的万能函数。注记部分计入 N4，不重复计入旧项。

| 区域 | 当前定义／接线范围 |
|---|---|
| architecture | `architecture-record-codecs.ts:115–117`；`architecture-service.ts:103–114`；`catalog-record-codecs.ts:103–105`；`catalog-service.ts:74–79` |
| communication | `decision-application.ts:40–42`；`decision-service.ts:72–74`；`decision-source-facts.ts:166–168`；`mailbox-service.ts:168–170` |
| configuration | `decision-settings-service.ts:45–47`；`line-settings-service.ts:64–66`；`message-duties-adapter.ts:31–33`；`project-bootstrap-record-codecs.ts:96–98`；`project-bootstrap-service.ts:88–99`；`role-memory-service.ts:96–98`；`role-record-codecs.ts:58–60` |
| evidence、materials | `evidence/evidence-service.ts:136–145`；`evidence/verification-plan.ts:53–55`；`materials/applicability.ts:105–107`；`materials/record-readers.ts:62–64` |
| persistence | `control-record-codecs.ts:138–140`；`decision-record-codecs.ts:121–123`；`evidence-record-codecs.ts:139–141`；`execution-entry-codecs.ts:72–74`；`execution-history-codecs.ts:86–88`；`line-settings-codecs.ts:91–93`；`plan-record-codecs.ts:106–108`；`record-codecs.ts:96–98`；`run-activity-codecs.ts:91–93` |
| queries | `query-execution.ts:83–87`；`query-job-service.ts:91–95`；`query-record-codecs.ts:152–154` |
| sessions | `lifecycle-record-codecs.ts:145–147`；`message-record-codecs.ts:218–220`；`session-directory.ts:122–124`；`session-health.ts:72–74`；`session-lifecycle.ts:136–138`；`session-record-codecs.ts:160–162`；`session-responsibility-service.ts:80–82`；`session-targets.ts:39–41` |
| tasks，领取／执行／完成 | `claim-record-codecs.ts:145–147`；`claim-service.ts:115–121`；`completion-record-codecs.ts:86–88`；`completion.ts:90–98`；`context-input-service.ts:104–106`；`control-service.ts:104–111`；`execution-entry-service.ts:132–140`；`execution-history-service.ts:85–92` |
| tasks，目标／计划 | `goal-control.ts:49–53`；`goal-decision-reader.ts:82–90`；`goal-executed-files-reader.ts:49–51`；`goal-settings-service.ts:76–81`；`initial-plan.ts:39–41`；`model-request-codecs.ts:66–68`；`plan-readers.ts:109–114、124–126`；`plan-service.ts:299–304`；`plan-task-basis.ts:69–71`；`plan-write-admission.ts:100–111` |
| tasks，其余 | `reconcile-intents.ts:82–84`；`reconcile-reads.ts:47–49`；`request-facts-reader.ts:31–39`；`requeue-service.ts:188–190`；`run-activity-service.ts:89–94`；`run-reconcile-service.ts:98–103`；`run-state-service.ts:113–119`；`session-anomaly-codecs.ts:69–71`；`session-anomaly-service.ts:100–105`；`session-facts.ts:66–68`；`session-provenance-facts.ts:77–78`；`task-service.ts:66–68` |
| views | `activity-read-model.ts:146–151`；`automatic-rework-notices.ts:136–138`；`context-extensions.ts:169–171`；`graph-context-reader.ts:104–106`；`task-state-timeline.ts:90–95`；`track-read-model.ts:164–172` |
| notes 补审 | `notes/note-decision-source.ts:69–71`；`notes/note-read-model.ts:110–112`；`notes/note-related-scope.ts:179–185`；`notes/note-scribe-todos.ts:53–55`；`notes/note-update-due.ts:131–133`；`notes/note-version-lists.ts:40–42`；`persistence/note-record-codecs.ts:145–147`；`views/note-review-notices.ts:92–94`；`views/note-views.ts:82` |

**二、区域内重复：保留的 C1 部分**

| 项目、当前位置和状态 | 共用版本、调用方及必须保留的差异 | 净减行数 | K3 |
|---|---|---:|:---:|
| TA-1，仍在：`tasks/claim-service.ts:439–506`、`execution-history-service.ts:151–227`、`run-state-service.ts:202–250`、`execution-entry-service.ts:232–300` | 新建 `tasks/trusted-context.ts`，搬用 entry 的共同校验段，保留各入口包装。顺序仍是空上下文→scope→signal→克隆身份→principal→actor→materialReader。各入口的 `a Task claim`、`recordExecutionHistory`、`readExecution`、`a B2 execution write` 文案原样参数化。**claim 的 signal 判断允许带相应属性的数组，另外三份排除数组**，这一步留在入口。成功结果的 scope/signal 字段差异也留在包装。写请求仍按 input→requestId→expected→克隆顺序检查，克隆失败文案各自保留 | 100–140 | K |
| SE 补充，仍在：`sessions/session-directory.ts:180–204`、`session-lifecycle.ts:168–219`、`session-responsibility-service.ts:111–176` | 新建 `sessions/trusted-context.ts`，搬用 directory 的可信上下文；三个调用方传入各自完整文案前缀。生命周期和责任服务的请求隔离合用 lifecycle `:203–219`；directory `:166–173` 的任意值克隆不混入。scope→signal→principal→actor 顺序保持，不能新增 null 上下文保护或身份克隆。身份／指纹辅助搬用 lifecycle `:381–413`，保持 expected 排序和展开顺序 | 60–80 | — |
| VW-1／XX-8，仍在：`views/activity-read-model.ts:144–260`、`track-read-model.ts:158–245`、`task-state-timeline.ts:88–177` | 新建 `views/activity-read-helpers.ts`，搬用 activity 中 Budget、等值分页、keyed read 和有序迭代；三读口接线。每返回一条索引记录扣预算、keyed miss 也扣一次、失败页原样抛出、惰性迭代可提前停止，均保持。各读口水位核对和重试仍留原处。`automatic-rework-notices.ts:91–134` 无预算；`tasks/goal-executed-files-reader.ts:113–148` 有自己的解码／失败协议，**不硬并入 2B 助手**；新增通知的同形循环另计 N9 | 110–140 | — |
| SE-2，仍在：`communication/mailbox-service.ts:2202–2233、2274–2287、2345–2373、2408–2421、3094–3105、3154–3159、3177–3190、3241–3246、3290–3303` | 同文件复用 `:3094–3105` 的分页校验骨架；水位助手由 `:2274–2287` 原样抽出。四读口各自传文案。对象→额外字段→整数 limit 1–100→cursor 的顺序保持；`atLeastCursor is not a ledger commit cursor` 不变。数值游标校验和 null 时的最低水位规则保持，**不能直接换 `persistence/read-result-failures.ts:19–27` 的字符串比较** | 45–65 | K |
| SE-3，仍在：`configuration/decision-settings-service.ts:29–124`、`line-settings-service.ts:48–158` | 新建 `configuration/workspace-settings-reads.ts`，搬用 decision 的 `loadWorkspace :91–105` 和共同 pin 校验。scope 错误仍分别称 decision-settings owner／line-settings owner；四条 Workspace pin 错误文字不改。decision 返回 null、line 返回 `{pin}` 的包装保持。重放依旧先 receipt→原事件→原 payload，不能读当前 Workspace 代替原值 | 35–50 | — |
| SE-5，已扩展但重复仍在：`communication/decision-source-facts.ts:170–224、738–794` | 同文件从 `readEncoded/readDecoded :193–224` 抽出局部读助手；当前来源及历史已保存答案分别传错误模板。`the decision source`、`a saved answer source`、`the saved answer source` 和损坏记录前缀不得统一；missing 与“既没返回也没报告 missing”继续分别处理。历史答案读法不能改成当前可应用性检查 | 30–45 | K |
| PE-2／PE-3，仍在：`persistence/record-codecs.ts:100–109`、`plan-record-codecs.ts:110–119`；`decision-record-codecs.ts:124–178、410–426`；`line-settings-codecs.ts:94–164` | 基础原语、nullable 解析已计共用项，这里只计带标签解析和事件共同校验。标签解析搬用 record `:100–109`；新建 `persistence/event-validation.ts`，搬用 decision `:136–178` 的外壳、内外一致性和 actor 校验，两个 codec 接线。校验顺序保持 eventType→schema→eventId→time，正文保持 identityKey→fingerprint→project→workspace→requestId→actor→payload。`a WorkspaceLinePinsChanged proof must be null` 留在 line codec `:163`。不让 line codec 依赖整个 decision codec | 50–70 | K |
| TA-4／VW-4，仍在：`tasks/context-input-service.ts:368–396`、`execution-entry-service.ts:1065–1093`、`views/graph-context-reader.ts:905–934`、`src/core/agent-runtime/context-assembler.ts:579–609` | 只抽纯编号构造到新的 `src/contracts/input-declaration-id.ts`，搬用 graph-context `:910–912`。四处改调它；`edge:`、`legacy:`、canonical 输入字段和 hash 不变。**不合并整个列表函数**：两个 task 服务先 legacy 后 edge，两个展示／装配函数先 edge 后 legacy；entry 的版本门槛及复制行为也保留 | 15–25 | K |
| TA-5，仍在且不能整组统一：`tasks/claim-service.ts:233–248`、`completion.ts:148–161`、`plan-readers.ts:1970–1998`、`requeue-service.ts:417–436` | 新建 `tasks/task-phase-facts.ts`，搬用 completion `:153–160` 的纯对象拼装；claim 的缺 Run／Reduction 返回 null 检查保留，plan-readers 的错误和额外读取保留。**requeue `:433` 判断的是 `reductionRevision===null`，其他路径判断实际 Reduction 是否为 null；requeue 不接这个统一公式** | 10–15 | K |
| TA-10，仍在：`tasks/goal-settings-service.ts:392–407、779–794` | 同文件抽出第一段等待链遍历，两个入口分别传起点和目标。64 链上限、读取顺序、失败传播及 `the wait-predecessor chain exceeds the 64-link read window` 不变 | 10–14 | K |
| ST-1，仍在，部分基础类型已共用：`state/message-machine.ts:71–167` ↔ `model/communication-contracts.ts:42–180`；`state/plan-machine.ts:67–107` ↔ `model/plan-contracts.ts:34–78` | 记录类型保留在 state，model 改类型别名／转出；现有导出名、联合成员、可选性保持。Host sender 已有 `model/communication-contracts.ts:42` 的共享别名，不再造一份；state 的 Host 类型可复用同一 contracts 定义。保留字段规则注释，搬迁不算删注释收益 | 90–115 | K |
| ST 补充一，仍在：`state/attempt-machine.ts:49–66` ↔ `model/claim-contracts.ts:82–104` | 保留 attempt 的 dispatch/outbox 类型，model 保留原名别名。V1/V2、可选字段和 claim 结构不变 | 16–20 | K |
| ST 补充二，部分已共用：`state/run-machine.ts:343–360` ↔ `model/execution-entry-contracts.ts:32–43` | Kernel binding 两边已引用 `RunExecutionHistoryV1['kernel']`，不再计其收益；仅把 `TaskEntryPermit` 指向 `RunEntryPermit :354–360`，保留五个字段和导出名 | 5–7 | K |
| ST-4，仍在：`state/line-status.ts:686–763` | 同文件抽共同候选枚举，两个投影分别保留。摘要的 complete、rank/order/key 比较保持；详情的 headSource 保持，不能拿摘要的 null source 直接输出详情。任务→卡片→线级 unknown→anchors 顺序保持 | 12–18 | — |
| ST-6，只保留很小一部分：`state/task-machine.ts:655–657、699–718、1202–1206、1243–1259` | `:655–656` 改调已有 `requeueBudgetIncreased :1202–1206`，错误文字及位置不动。构造器自校验和 transition 的拒绝继续各自存在；不改构造器参数、不删 throws、不共享预先计算结果 | 1–2 | K |
| ST-7，仍在：`state/session-anomaly.ts:93–105` ↔ `state/session-availability.ts:1044–1056` | 新建 `state/ref-equality.ts`，原样搬用 anomaly 的递归比较；两文件接线。保持 `===` 短路、数组顺序、对象自有键递归规则；不能换成 `src/contracts/fingerprint.ts:51–57` 的 canonical 比较 | 10–12 | K |
| ST-9，仍在：`state/line-status.ts:769–781` | 保留 `:771–774`，删掉被其覆盖的 `:778–781`。保留 `unknown_run`、`occupancy` 和后续 query/copy 分支顺序 | 4 | — |
| VW-3，仍在：`views/activity-read-model.ts:749–763、821–859、941–969` ↔ `track-read-model.ts:331–376、733–765` | 共用 activity 的 `activityViewOf`、`emptyView`、claimingSession 逻辑，可与 2B 助手同文件。保持 history 优先于 outbox、未知／迟到字段、null 字段及损坏 outbox 错误。**gate 汇总不整段合并**：两个入口排序方式及 track 的 scope 拒绝不同，保留原处 | 40–55 | — |
| VW-5，仍在：`tasks/plan-readers.ts:726–752` ↔ `views/decision-read-model.ts:1314–1335` | 在 plan-readers 的终态选择段保留一个助手，view 调用。活候选选择和 view 后备分支留原处；继续用 proposal chain position 比较，严格 `>0`，相等时保留先遇到的候选，不能改按时间排序 | 12–18 | K |
| VW-7，仍在：`views/node-detail-reader.ts:88–105`、`work-line-reader.ts:186–204` | 复用 `persistence/read-result-failures.ts:30–37`；从其中提取同一 code 归一函数供 noteProblem 用。node 的外层包装保留：缺 reason 为 `the read failed`，not_found 为 `the record was not found`，其余未就绪为 `incomplete / the read is not ready` | 15–20 | — |
| SE-7，仍在：`sessions/session-directory.ts:1181–1215` ↔ `session-lifecycle.ts:353–379` | 新建 `sessions/session-links.ts`，搬用 directory 版本；directory `:1318、1489、1675` 和 lifecycle `:716、1300` 接线。observer 仍在 ready 页返回后、逐记录容量／解码前调用；页大小、总上限、`Session ${sessionId} exceeds the bounded work-link read budget`、`session work link ${record.refKey} is damaged: ${decoded.reason}` 保持。两个返回包装分别保留 value／links | 20–25 | — |

**三、旧清单中撤出本轮的 16 项**

这些条目都检查了当前位置。表中“无”表示本轮不创建共用版本、不切换调用方，净减均为 0。

| 项目、状态及位置 | 本轮裁定、必须保留的内容 | 共用／接线 | K3 |
|---|---|---|:---:|
| TA-8，仍在：`tasks/plan-commit-compiler.ts:40–48`；`plan-readers.ts:860–875、2001–2038`；`run-activity-service.ts:71` | 删 governance revision、`OriginPlanRead.missing` 会改返回形状；删未用依赖声明也不是机械合并。留 T 轮。实际 revision 读取和 guards 更不能删 | 无 | K |
| ST-2，仍在：`state/attempt-machine.ts:203–207、507–512、600–605、619、634、647、690` | 不删 effects：会改 transition 返回内容及既有验证入口 | 无 | K |
| ST-3，仍在：`state/decision-policy.ts:214–255`、`state/task-failure.ts:808–884` | 输入和检查顺序不同；paused work 路径、budget、cap 的处理不能按相似分支统一。已有共同基础继续用 `state/verification-machine.ts:563–596` | 不新增 | K |
| ST-8，仍在：`state/task-failure.ts:690–695、907–924`；`tasks/plan-service.ts:882` | 共享已经计算的 work/gate view 属于减少重复计算，且会改参数协作方式；不混入机械 C1 | 无 | K |
| VW-6，仍在：`queries/query-record-codecs.ts:494–502、558–566、603–611、658–666、725–733` | validator→decoder 的重复解析属于原 XX-9 路径；此次不改内部解析结果协议，不删除各出口错误分支 | 无 | — |
| VW-8，仍在：`views/decision-read-model.ts:92`；`node-detail-reader.ts:619、641、657、716`；`work-line-reader.ts:249–257、877、891、900` | positions 依赖和 ownerProblem／GoalFacts 字段删除属于接口／返回形状清理，留 T 轮 | 无 | K |
| VW-9，仍在：`views/undelivered-reply-notices.ts:26–38`；`goal-conflicts.ts:77、149、159、170` | sessions 依赖删除和 truncated 字段删除不符合本轮形状冻结要求 | 无 | K |
| VW-11，位置已移动：`views/node-detail-reader.ts:422–449、494–503、653–663` | 合并 responsible/participant 读取就是少读，属于 C2；保留两次读取及各自失败结果 | 无 | — |
| SE-9，仍在：`sessions/message-body-envelope.ts:74–110` ↔ `message-record-codecs.ts:355–365、546–578` | 直接复用会改错误文字：如 `a decision selection must be an object` 对 `decision selection must be an object`；codec 还有 earlier/later/goalOrder 前缀。撤下整段合并，不“顺手统一” | 无 | K |
| SE-11，新增架构分支后仍在：`sessions/session-record-codecs.ts:1055–1083`、`lifecycle-record-codecs.ts:662–720`、`message-record-codecs.ts:1216–1259`；`architecture/architecture-record-codecs.ts:779–823`、`catalog-record-codecs.ts:580–598` | 与 XX-9 一样是复用解析结果。保留消息默认 null、wire 字段剥离、重放原值和历史架构格式规则 | 无 | K |
| SE-12，仍在：`communication/decision-source-facts.ts:44–52、163–164、327–330` | 删除可选 plans 和绕过分支会改变无 plans 构造的行为；不是 C1 | 无 | K |
| SE-13，仍在：`sessions/message-body-envelope.ts:12、33–41` | 删除旧类型属于无依赖导出清理；旧核实还要求同步改测试 allowlist，本轮不做 | 无 | — |
| PE-4，仍在：`materials/material-service.ts:27–50、52–117、176–214` | 原建议是消除内部结果协议再改接线。按本次“返回形状保持”的严格口径撤下。保留 open/read 两种取消文字，以及 corrupt／unique 等到 unavailable 的现有映射 | 无 | — |
| PE-8，仍在：`evidence/verification-plan.ts:25–46`；`evidence/evidence-service.ts:945–953`；`persistence/read-result-failures.ts:30–35` | 不删结果 union／输入字段，不删 current 支持；后者收到数组时仍须带 current，包括空数组。unused 字段留 T 轮 | 无 | — |
| PE-9，仍在：`evidence/evidence-service.ts:797–803、1031–1036` | 静态 configuration 是实际 fallback。删掉会改变只传静态配置的构造行为；workspace mismatch 仍为 forbidden | 无 | — |
| `graph-repository.ts`，仍在：`persistence/graph-repository.ts:39–95、149–157、275–340`；`tasks/task-service.ts:190–273` | 不能当成“纯转发”直接扁平化：scope、lookup、commit 的失败形状不同；lookup 默认 unavailable 不加 code 前缀，commit 默认分支却加 `${code}: `。返回协议和 reason 冻结后，原整层删除建议撤下 | 无 | — |

**四、合入代码及注记补审：11 项**

这里与上面的旧项分开计数；同一基础助手的新增调用不再计一份共用实现。

| 编号、当前位置及状态 | 共用位置和切换点；逐字节边界 | 净减行数 | K3 |
|---|---|---:|:---:|
| N1，新增／补审原语仍在：`architecture/file-graph-index.ts:44–46`；`notes/note-anchors.ts:584–594`；`notes/note-service.ts:98–100、278–280`；`persistence/note-record-codecs.ts:118–129` | 接 XX-1 的同一公共版本。正整数 `>0` 与安全整数条件一起保留；note-read-model 的“键数必须相等”版本 `:117–120` 不接 | 20–25 | K |
| N2，注记 nullable 解析／canonical 副本：`persistence/note-record-codecs.ts:130–144` | 分别接 XX-6、XX-5；捕获范围、null 返回和非数组对象要求不变 | 9–12 | — |
| N3，三个注记事件及 L8 事件外壳：`persistence/note-record-codecs.ts:553–556、629–632、674–677`；`architecture/architecture-record-codecs.ts:776–778` | 接 XX-2。原事件 JSON 字节、外壳字段和原类型出口保持；不把 note 的旧字段默认规则 `persistence/note-record-codecs.ts:148–151、422–425` 搬入编码器 | 6–10 | — |
| N4，注记拒绝结果助手：见 R 表 notes 行 | 接同一结果公共模块，按 Core rejection／ok-false／codec-invalid 三种协议分别接。`notes/note-service.ts:443–446` 的 rejectedInput 带请求相关结果，保留，不能替成普通 rejection | 14–20 | — |
| N5，五槽 anchor 和路径前缀副本：`notes/note-related-scope.ts:81–89`；`note-read-model.ts:305–306、332–333、689–697`；`note-service.ts:1250–1252`；`views/note-views.ts:1061` | 保留并导出 related-scope `:81–89` 的两个助手。上述调用接线。槽位顺序 0→4、只排除 null、精确键或 `${base}/` 前缀保持；不排序、不去重、不把 `file:src/a-b` 算成 `file:src/a` 子路径。service 的 `invalid / anchor_not_found` 保持 | 5–8 | K |
| N6，符号文本截取副本：`notes/note-anchors.ts:280–289` ↔ `views/note-views.ts:212–220` | 保留 note-anchors 的算法，参数收口为 start/end，原 hit 调用包装保持；views `:399` 接线，anchors `:371` 调用同实现。一基 UTF-16 行列、结束列不包含、按 `\n` 切分并重连不变；不规范化 CRLF、不加越界 fallback | 6–8 | — |
| N7，8A 游标编码副本：`architecture/file-graph-index.ts:54–56` ↔ `architecture/graph-index.ts:46–48` | 保留 graph-index 的纯编码实现并共用，file-graph 接线。仍为 `JSON.stringify`→UTF-8→base64url，输入对象的字段顺序由原调用方决定。**解码不合并**：两类异常和错误文字不同，见 file-graph `:57–70`、graph-index `:49–60` | 1–2 | — |
| N8，4C-2 应用输入类型副本：`model/note-contracts.ts:106–116` ↔ `model/decision-contracts.ts:201–204` | 保留 `NoteDecisionApplicationInputV1 :106–113`，decision port 的 input 改引用它。option union、pin、nullable 字段、answerMessageRef 不变；沿 model 类型依赖，不导入 notes 实现 | 2–3 | K |
| N9，4C-2 通知有序分页副本：`views/note-review-notices.ts:68–90` ↔ `automatic-rework-notices.ts:91–116` | 保留 automatic 的通用 `readOrderedToEnd`，导出供 note-review 使用，传注记索引。`lookupOrdered.call(records, …)` 的 receiver、asc、limit 200、bound/after 的省略规则、失败页原样 throw、next 到底均保持。不要换成带预算或稳定窗口重试的另一分页器 | 18–22 | — |
| N10，注记 store code 映射副本：`notes/note-read-model.ts:125–137` ↔ `note-related-scope.ts:188–195` | 新建 `notes/store-failures.ts`，搬用 note-read-model 的 map 和 asOutcome；read-model 保留现有转出，related-scope 接 ok-false 包装。只保留 revision_conflict／invalid／not_found，其余一律 unavailable；reason 原样。不能换成允许 14 个 code 的通用读映射 | 4–6 | — |
| N11，新增／补审注释：`notes/note-continuity.ts:1–7`；`note-read-model.ts:139–143、699–707` 等 | 只清施工经过，三个具体例子见下一表。此估算不包含上面删函数时一并消失的注释 | 15–25 | — |

8A／8D／L8 的记录格式部分保留现状：旧 chunk 格式不读取的规则在 `architecture/architecture-record-codecs.ts:38–43、293–348`，分块序列化在 `architecture/architecture-service.ts:373–394`，L8 请求／事件校验在 `architecture/architecture-record-codecs.ts:634–737`。本轮没有把这些业务格式代码算成可机械合并的收益。

**五、注释：按决定 35 保留规则映射**

以下估算只计独立注释清理，已排除类型／函数合并带走的注释。不是按 `Slice`、`Stage`、`RW` 或“长注释”批删。

| 区域／旧编号 | 可净删 | 三个例子及保留边界 | K3 |
|---|---:|---|:---:|
| tasks，TA-2 | 60–90 | ① `tasks/plan-service.ts:18–28` 的旧施工阶段说明；② `tasks/plan-readers.ts:580–581` 的“part 1 声明、part 2 实现”；③ `tasks/model-call-contracts.ts:2–6` 的 skeleton／旧目录迁移经过。保留 plan-service `:9–16` 的状态机及检查顺序映射，保留 model-call `:7–8` 的一次消费语义 | K |
| views／queries／相关 model，VW-2 | 45–70 | ① `model/claim-contracts.ts:79–80` 的“codec 尚待实现”，保留 `:77–78` 的状态一致性要求；② `queries/query-record-codecs.ts:4–8` 压缩阶段叙述，保留 `:10–15` 的历史兼容解释；③ `views/work-line-reader.ts:2645` 只删“sixth round”，保留重新检查已走过分段的原因。第三例本身不产生整行收益 | K |
| communication／configuration／sessions，SE-4 | 40–65 | ① `communication/mailbox-service.ts:144–151` 的 part-1 stub 经过；② `configuration/project-bootstrap-service.ts:1029–1032` 的分阶段叙述，保留 `:1026–1029` 的 Project/Workspace 缺失区别；③ `sessions/message-record-codecs.ts:1234–1235` 重复说明顶端转出。保留 `:1224–1225` 的 wire/public DTO 边界 | K |
| persistence／materials／evidence，PE-1 | 100–170 | ① `persistence/execution-history-codecs.ts:17–25` 可压缩逐字段复述，保留 `:5–15` 的共用、重放和所有权边界；② `materials/record-readers.ts:10–11` 的已删除 grants 历史，保留 `:18–20` 的编码校验／业务准入分界；③ `evidence/evidence-service.ts:770` 的“Behaviour lands in part 2”，保留 `:766–769` 的政策作用 | K |
| state，ST-5 | 8–15 | ① `state/message-machine.ts:210`；② `state/plan-machine.ts:417`：删待冻结经过，保留紧邻的规则编号和字段含义；③ `state/session-availability.ts:244–245` 删旧调用位置迁移经过，保留 `:246–247` 的 occupancy 与 lifecycle/health 分工 | K |
| notes 及补审，N11 | 15–25 | ① `notes/note-continuity.ts:4–7` 删旧副本位置及迁移计划，保留 `:2–4` 的跨采用版本连续性规则；② `notes/note-read-model.ts:140` 去掉 “Item 3 fix 1”，保留 `:141–142` 的失败页不得返回部分集合；③ `:700–702` 压缩搬迁经过，完整保留 `:703–706` 的 UTF-8 排序与目录边界解释 | — |

特别保留 `state/note-machine.ts:111–116` 的实际处置目标集合规则，以及 `state/task-machine.ts:1197–1201` 的 G-BUDGET 映射；它们属于决定 35 保护的规则说明，不能因代码看起来能说明同一件事就删。

**六、给施工 agent 的六组文件分工**

先按文件分组，再在每组内接线。**同一个文件只属于一组；跨区域共用项按调用文件拆开执行，不允许各组都修改公共助手。** 这只是施工拆组，C1 开工时点仍服从现有“等 K3”决定，见 `.lead-ref/2026-10-16-cleanup-list.md:42–48`。

文件归属按下表从 G6 的排除集开始确定；其余组都排除 G6。估算是上面净减量的分配，不能再与条目总量相加。

| 组 | 文件归属、条目 | 组内顺序 | 预计净减 |
|---|---|---|---:|
| G1 公共基础和持久化 | `src/contracts/validation/common.ts`、`src/contracts/fingerprint.ts`、新 `src/contracts/core/rejections.ts`；非 G6 的 `persistence/`，但 `note-record-codecs.ts` 给 G4；`materials/`、`evidence/`。做 XX-1/2/5/6/7、拒绝助手的定义及本组调用、PE-2 非等待部分、PE-1 本组注释 | 公共原语／结果形状→JSON 助手→事件外壳／失败映射→本组调用→注释 | 350–430 |
| G2 Session 和配置 | 非 G6 的 `sessions/`、`configuration/`；新 Session context/links、workspace settings 助手。做 SE 补充、SE-3、SE-7，共用工具本组接线及 SE-4 注释 | 区域共用 context／request／links→三个 Session 服务→两个设置服务→codec 接线→注释 | 250–330 |
| G3 普通视图和查询 | 非 G6 的 `views/`，但 `note-views.ts` 给 G4；`queries/`。做 VW-1/XX-8、VW-3、VW-7、N9，以及本组共用工具和 VW-2 注释 | 2B 读取助手→活动／轨道／时间线→视图失败映射→通知分页→其余小工具→注释 | 240–310 |
| G4 注记和架构 | 非 G6 的 `notes/`、`architecture/`，另加 `views/note-views.ts`、`persistence/note-record-codecs.ts`。做 N1–N7、N10、N11 的本组部分 | 注记失败映射→anchor/path/range 助手→note/view 调用→事件／原语接线→架构游标编码→注释 | 110–150 |
| G5 其余 task/state/model | 非 G6 的 `tasks/`、`state/`、`model/`。做 ST-4、ST-9，本组共用工具接线及 TA-2/ST-5 注释 | 公共助手接线→line-status 候选枚举→删被覆盖分支→注释 | 约 98–141 |
| **G6 等 K3** | K3 清单内本报告涉及的文件全部归此组；为保证成对改动不跨组，再收进 `tasks/execution-history-service.ts`、`tasks/context-input-service.ts`、`tasks/completion.ts`、`views/graph-context-reader.ts`、`state/message-machine.ts`、`state/plan-machine.ts`、`state/session-anomaly.ts`、`persistence/line-settings-codecs.ts`。包含 TA-1、SE-2/5、PE-3、TA-4/5/10、ST-1 及两补充、ST-6/7、VW-5、N8，以及其他共用项的 K3 调用和注释 | **K3 合入后再核**现有助手→区域 helper／类型别名→原入口包装→调用方→注释。最后单独处理游标修复，不混同 C1 | 850–1,150 |

G6 不应预先创建 K3 已列入的 `persistence/lookup-all.ts` 或 `tasks/codec-fields.ts` 等文件；它们已在 `.lead-ref/k3-all-files.txt:66、84–85` 的待合入范围，合入后优先核对是否已有可复用实现。

**七、单列小修：`goal-decision-reader.atLeastCursor`**

- **仍未使用。** 接口声明在 `tasks/goal-decision-reader.ts:63–67`，实现参数在 `:422`；`:423–442` 没有消费该值。`readGoalRecord :118–131` 读取结果后丢弃水位，`displayCauses :266–269` 也没有传递最低水位并将非 ready 包成 unavailable。
- **共用位置已有：** `persistence/read-result-failures.ts:19–27` 的 `atLeastCursorResult`，输出真实 `observed/required` stamp。接线点是 `goal-decision-reader.ts:422–442`，但要先让参与原因计算的读取保留并核对实际水位；不能在末尾补一次空读取，或取多个水位的最大值来替旧事实背书。
- **边界：** 不带 `atLeastCursor` 时保留现有错误文字、原因拼接顺序和结果形状；带值且未读到时新增 `not_ready`，这是明确的行为修复，不能声称 C1 行为不变。原 project/workspace 授权顺序在 `:423–426`，不得顺手调换。
- **净减：0，修复可能增行，不计 C1。K3 合入后再核。** 规格入口仍为 `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md:817–819`。

**不属于 C1**

- 减少目标事实、Session 链接或 JSON 的重复读取／解析：旧清单已经区分 C2，见 `.lead-ref/2026-10-16-cleanup-list.md:21–23`；本轮的 VW-11、VW-6、SE-11 不再混计。
- 注记 `hasOnlyKeys` 的严格键集合规则不能被宽松助手替换：`notes/note-read-model.ts:117–120`。
- 注记正文投影并非同形对象：`views/note-views.ts:103–117` 与 `state/note-machine.ts:314–331` 的字段及用途不同，不合成一个正文投影器。
- 架构路径校验和直接抛错的 canonical 包装，不因相似就混入 nullable／通用原语：`architecture/architecture-service.ts:133–156`；注记路径规则另在 `notes/note-anchors.ts:397–402`。
- 生成 codec、RecordStore 后端选择、旧清单“不做的”及测试改动继续排除，范围依据 `.lead-ref/2026-10-16-cleanup-list.md:25–29、39–40`。

**总计：复核 59 项，保留 C1 43 项、撤出 16 项；C1 净减约 1,900–2,510 行；27 项含 K3 接线，K3 合入后再核。另有 1 项 `atLeastCursor` 行为修复，也等待 K3，不计 C1 行数。**