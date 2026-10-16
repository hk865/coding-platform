# 第 4 片规格：记忆核心（注记、当前理解、确定的查找、接进工作）

**后注（4B 合入，lead 2026-10-16）：** 4A、4B 施工和验收中定下的读法在 §9、§10，对 4C 同样有效；和前面各节冲突时以它们为准。**4C 施工前的补充在 §11**（决定 66–71：有联系的范围、默认状态和先筛再核对、项目的当前理解、该更新和书记提醒、少让人看的规则、成本上界，4C 分两轮），和前面各节冲突时以 §11 为准。

**后注（注记查找提速第一轮合入，lead 2026-10-16）：** 决定 66 的第一轮已合入。L9 的全文端口不再用 FTS5 和两个码点的窗口：两个后端在内存里按注记键顺序扫，SQLite 写入时存规范化的比较文字，打开时换掉 4B 的表；端口加了 `match`（缺省 `'all'`），去掉了每次调用的候选上限；全文扫描最后一个非空页报 `complete: true`；不再有“FTS5 不可用 → `unsupported`”；不是合法 UTF-16 的词报 `invalid`。读模型带锚点或路径前缀的查找只在那些注记里找。排序和分数不变。§10 里讲 FTS5 和窗口的句子按这条读。见[证据](../../../reviews/evidence/orchestration-note-speed-1-2026-10-16/lead-acceptance.md)。

> **2026-10-15 晚：按决定 60、61、62 和 7D 第二稿改了书记范围、提醒身份、按范围计数和 61-5 指引；冻结前 lead 逐行审；又按 7D 勘误 E1–E11 和决定 63 改；又按审查二（19 条）的 lead 裁定改；lead 逐行审过这一稿，补的地方标“审查二 lead 补”；Codex 最后一次快速核对的必改由 lead 改完（标“审查二快速核对第 n 条”）；经你同意又加了一次只看改动的额外核对，它的必改由 lead 改完（标“审查二额外核对 Dn”）。**已冻结（2026-10-15 晚，你确认了测试入口）；2C 合入后 lead 只重核 §0.2、§6 的行号和事实，不改规则。**
> **2C 合入后的重核（lead，2026-10-15 夜）：** §0.2 各条照旧成立，只是行号移动。4A 施工前的 DSH 通读在 e8b3edae 上逐条核过：F3 的文件在 `src/core/agent-runtime/`，F13 的 `note_review` 在 `src/contracts/goal-decisions.ts`（不在 `decision-contracts.ts:318`），这两处 4C 用时按符号找。lead 在合入 2C 的树上补核了 2C 碰过的：F5 `resolvePath` 在 `lookup-index.ts:445`、`lookupIndexKeyOf` 在 `:476`；F6 `upsertSnapshot` 仍在；F7 `indexGuards`、`indexChanges` 在 `record-store/ports.ts:117`、`:119`；F1 `AggregateRef` 仍没有注记的引用；F13 组合根注入决定来源在 `create-platform.ts:658`。L21 的前提成立：2C 的节点详情里 `notes` 是 `not_available`、原因 `slice_4`（`views/node-detail-reader.ts:1142-1178`）。§6 的文件归属不变：2C 的计数端口已合入，4B 的 RecordStore 改动可以开始排。
> **状态（2026-10-15 下午）：你已定 §0.1，并对注记格式、查找和校验提了意见（标“用户 2026-10-15 第 n 条”，第 1–12 条，含决定 59）。DSH 照改（`D:/cc-lead-notes/specs/s4/s4-spec-edit-3.md`），lead 逐行审过、改了交叉引用和几处接口（写入结果带 `existingTopics`、核对带 `withSimilar`、`NoteDraftV1` 按种类严格分型、事实解析的每页上限 `NOTE_READ_FACTS_MAX`、`deleted` 字段），并通读了全稿。剩下：2C 合入后重核 §0.2 和 §6，然后冻结。**
> Codex 两次完整审查加一次快速核对已用完（决定 56 的上限），最后一次结论“改完后冻结”，两处已由 lead 改。下面是经过：lead 第一稿，2026-10-15 夜；同夜按 Codex 第一轮审查（`D:/cc-lead-notes/codex2/s4specrev.out.md`，14 条必须改、2 条建议，结论“还不能冻结”）改了一轮：lead 逐条裁定（`D:/cc-lead-notes/specs/s4/s4-spec-edit-1.md`），DSH 照改，lead 逐行审过、补了三处。按决定 58，和第 2 片的施工并行起草。
> - 冻结前还要：你定 §0.1 的两件事（拆成三小片、测试入口）；Codex 审（最多两次完整审查加一次快速核对，决定 56）；lead 在 2B、2C 合入后的基线上重核 §0.2 和 §6。
> - 同夜 Codex 第二轮审查（`.dsh-ref/s4specrev2.out.md`，7 条必须改、3 条建议）后，lead 第二次裁定 8 条（2026-10-15），本稿逐条照改；改动行标“（第二轮审查第 n 条）”。
> - 代码事实：Codex 只读事实清单（`D:/cc-lead-notes/codex2/s4facts.out.md`，HEAD 5c7a3258：第 0、1、3、5 片、接线包 1、2、K 片 A、B、2A 已合入；2B、2C 在施工，不在这个树里），lead 核过 F1–F6、F9、F12。
> - 依据：
>   - HANDOFF 决定 20、21、22、23、35（Q6、Q7、Q8、Q9、Q11、Q23）、37、49（Q1、Q2、Q7、Q8、Q9 和答复页第 04–08 项）、50、56；
>   - DESIGN §1.7（L340–353）、§3（L596–727）、§5.1（L1039）、§5.3 工具表（L1076–1084）、§6（L1139–1143）、§7.2、§8.2 第 4 行（L1247）、§9.3、附录 C（新记录 4 种里的前两种；索引第 5、6、7、15 个）；
>   - [MEMORY-LOOKUP](../MEMORY-LOOKUP.md)（方案已定，接口由本规格冻结）；
>   - MODEL O34–O37、R43–R46、R48；答复页第 04–08 项；
>   - MVP 行为 B09、E06、E12。

## 0. 冻结说明（lead）

### 0.1 要你定的

**1. 拆成三小片（建议拆）。你选了 (a) 拆成 4A、4B、4C（2026-10-15）。（用户 2026-10-15）** 第 4 片是目前最大的一片：要新做两种记录、一套状态规则、RecordStore 的全文端口（两个后端都改）、六种读法、“看”“找”的记忆分支、“记”工具、你的注记接口、装配器分路、书记提醒、决定队列的注记卡、节点详情的注记一栏、两个版本列表。一个 DSH Session 做不完。照第 2 片拆成 2A/2B/2C 的做法（决定 50）：
- **4A 注记的记录和写入：** 两种记录、状态规则、谁能写什么、额度和同话题规则、取代和撤下、当前理解的版本核对、三个索引、写入时读依据文件的摘要和解析符号（L11 写时一段、L14 的符号规则）、写入和读取的服务入口。
- **4B 查找和新鲜度：** RecordStore 的全文端口和两个后端、六种读法、需复查和来源不可用（读时核对文件和定义）、两个版本列表。
- **4C 接进工作：** “看”“找”的记忆分支和“记”工具、你的注记接口（路由）、装配器分路、书记提醒、决定队列的注记卡、节点详情的注记一栏（要 2C 先合入）。

顺序 4A → 4B → 4C。4A 只依赖已合入的代码，现在就能做；4B 在 2B、2C 合入以后（版本列表用 2B 的 `s2b-plan-revision-by-goal` 索引，RecordStore 文件 2C 也改计数端口）；4C 在 4A、4B、2C 合入以后（节点详情接 2C）。（第一轮审查第 14 条）
- (a) **拆成 4A、4B、4C，三份规格（建议）。** 每片一个 DSH Session 能做完，各自审查、验收、合入。
- (b) 不拆，一份规格分三段施工。审查和验收一次做完，但一次改动很大，返工代价也大。

**2. 测试入口（§5.1 的 NE1–NE7）。你确认了 NE1–NE7（2026-10-15），本次在原入口里加了行。（用户 2026-10-15）** 和第 2 片一样，先确认入口，再按 TDD 一条一条做。

**告知（lead 的技术取舍，不用你定，你可以改）：**
1. **注记分“头”和“版本”两种存法**（L1）。头每条注记一条，记当前文字和状态；每改一次文字或状态，另存一份不再改的版本。头上另存 `reviewReasons`、`confirmedByUser`，版本里也存 `reviewReasons`；`coexistWith` 作为写入证据存进头和版本（第一轮审查第 1、2 条）。仍是附录 C 的“注记”这一种新记录，只是物理上两个键。这样历史能按版本读，索引只看头，不会查出旧版本。
2. **额度是软上限**（L7）。每个锚点 5 条、每个目标 200 条；写入时用投影计数核对（当前计数减去这次写入会取代掉的条目），两个 agent 同时写，可能多出一两条。读的时候如实报“超额度”，交书记整理。不为额度加锁：锁要把同一目标的写入全排成队，代价比偶尔超一条大。（第一轮审查第 4 条）
3. **同处同话题**（L4）：写的时候查，按“声明矛盾 → 取代 → 声明并存 → 退回”的先后判；两个同时写漏过去的，读的时候当作“同话题冲突”给警示、交书记，不默默挑一条当现行结论。（第一轮审查第 1 条）
4. **全文只查每条注记的当前文字**（L10）。历史版本不进全文，按注记编号读历史。
5. **秘书的“记”**：写入一方在本片就认秘书来源（只写当前理解和自己的注记），工具注册在第 6 片（DESIGN §5.2 把秘书的工具放在第 6 片）。
6. **修补（repair）**：本片只做暂存和“作废”的读法；随检查和架构修订生效在第 8 片（决定 21）。
7. **节点详情的注记一栏**接 2C 的节点详情读取，所以放在 4C，等 2C 合入。

### 0.2 代码事实（5c7a3258；lead 核过的标 ✓）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 ✓ | 没有注记的记录、编解码和写入方。`AggregateRef` 没有注记和当前指针两种引用；生产组合登记的记录里没有记忆 | `src/contracts/ledger.ts` `AggregateRef`；`create-platform.ts` 的 schemas |
| F2 ✓ | 装配槽已留：`createContextExtensionsReader` 的 `notes` 恒为 `not_implemented`、空行 | `views/context-extensions.ts:310-312` |
| F3 ✓ | 装配器今天有两条路径都会用 `notes.rows`：`goalPayload` 把全部行放进不裁的 Goal 卡，`optionalRowsFromExtensions` 又把全部行放进预算区。只是现在为空 | `agent-runtime/context-assembler.ts:417-421`、`:535-545` |
| F4 ✓ | `ContextSourceV1` 能描述一条注记的编号、版本、摘要和图节点，只是引用，不存取注记。执行准备的消费时检查 `contextConsumptionGuards` 跳过非记录来源（含 `kind:'note'`）：注记变了不会挡住已绑定的执行 | `src/contracts/graph-context.ts:36`；`tasks/execution-entry-service.ts:1193` |
| F5 ✓ | 等值查找只认标量路径，数组（例如附加锚点列表）不能直接建索引 | `record-store/lookup-index.ts` `resolvePath`、`lookupIndexKeyOf` |
| F6 ✓ | SQLite 每个键只存一份快照，更新时覆盖；存储没有“列出某条记录全部历史版本”的接口 | `sqlite-record-store.ts` `upsertSnapshot`；`ports.ts:188` |
| F7 | `PreparedCommit` 支持带版本守卫的记录、事件和唯一认领；`indexGuards`、`indexChanges` 非空明确不支持。`ledgerHorizon` 有 | `record-store/ports.ts:110-116` |
| F8 | 版本守卫：`RecordGuard` 按读到的版本核对，`expectedRevision: null` 表示必须不存在；两个后端都先核守卫再写，重放先回原回执 | `ports.ts:82`；`record-codec.ts:748`；两个后端的提交 |
| F9 ✓ | “看”“找”只有两个工具 `look_graph`、`find_graph`；“找”的参数严格是 `{ needle, page }`；可信的范围、身份、目标由适配层带，不由模型给 | `agent-runtime/graph-tools.ts:39`、`:196`、`:236` |
| F10 ✓ | “找”今天对名字、路径、说明做区分大小写的包含匹配；模块路径完整相等才算，不按目录前缀 | `views/graph-context-reader.ts` `findGraph`、`modulesMatchingPath`；lead 核过：`graph-context-reader.ts:1379`（模块路径完全相等）、`:1550`（区分大小写的包含）（用户 2026-10-15） |
| F11 | 图分页按目标、工作区、计划、架构、Session、Run、轮次绑依据（`basisKeyOf`），不含注记版本和文件观测 | `graph-context-reader.ts:800` |
| F12 ✓ | 工作区工具能按路径读文件、给摘要（区分原始字节和 UTF-8 解码）、按语言查符号；符号命中带路径、摘要、范围、名字、种类，没有限定名和签名摘要；覆盖说明写明文件观测不是原子的 | `src/core/workspace/ports.ts` `WorkspaceFile`、`SourceQuery`、`SourceHit`、`SourceCoverage`、`WorkspaceToolsPort` |
| F13 | 决定队列的卡和请知悉里已有 `note_review` 这个来源词，读口可以注入；生产组合没注入；`readSource` 遇到 `note_review` 报 `unsupported`，所以只加显示接不上答复和落实 | `model/decision-contracts.ts:318`；`create-platform.ts:688`；`communication/decision-source-facts.ts:620` |
| F14 | 注意力心跳今天只带待处理输入数和消息游标 | `src/app/attention-observer.ts:75`；`host.ts:1135-1153` |
| F15 | 执行（Work）的工具注册选邮箱、决定、白板、发现、图工具；没有“记”。Query 的协作注册只注入图读取 | `execution-driver.ts:214`；`query-execution.ts:213` |
| F16 | 架构目录的模块定义有模块和接口的路径；目录修订事件带原因；目录的记录组没有登记索引。计划版本按目标读的索引由 2B 加（`s2b-plan-revision-by-goal`） | `architecture-catalog.ts:18`；`catalog-record-codecs.ts:57`、`:509`；2B 规格 L14 |
| F17 | `notes` 子模块的位置已定（WorkGraph L5.5，依赖 model、state、persistence、architecture、sessions、tasks；被 evidence、views 用），`module-target.json` 写明“首个文件落地时声明” | `docs/refactor/module-target.json:26`；`reviews/evidence/workgraph-split-2026-10-07/target.json:19` |
| F18 | 异常锚点是不再改的记录，带任务、目标、Session、Run、归档原因、改过的文件、没核对的结果；按目标、按任务列 | `src/contracts/session-anomaly.ts:21`；`tasks/session-anomaly-service.ts:58` |

### 0.3 lead 定的技术选择

- **L1 存法：头和版本。**【lead 定，待审】
  - `NoteHead`（键：项目、注记编号）每条注记一条，可变：当前版本号、当前文字（种类、话题、结论、正文）、锚点、状态、所属目标、来源、暂存它的执行、`replaces`、`contradicts`、`coexistWith`、`structural`、`reviewReasons`、`confirmedByUser`、额度用的锚点键（L3）。
  - `NoteVersion`（键：项目、注记编号、版本号）每版一条，写下以后不再改：这一版的全部内容，加上 `reviewReasons` 和 `coexistWith` 这两项**写入证据**，再加**这一版为什么出现**（写入、审、拒绝、撤下、被取代、合并）、谁做的、哪次提交。
  - 每次改文字或状态：头的版本号加 1，同一次提交写新的版本记录；每一次改动的头都用当时读到的 `expectedVersion` 做版本守卫写回（F8），对不上 → `revision_conflict`、什么都不写（第一轮审查第 3 条）。版本号从 1 起。读历史按“注记编号 + 版本号”读，不靠存储的版本号（F6）。
  - `coexistWith` 不是独立的关系记录，也不是 O34 的关系字段，只是这一版的写入证据和头上的当前并存声明；lead 在冻结时把这一点写进 MODEL O34。（第一轮审查第 1 条）
  - `reviewReasons` 是 `('structural'|'contradiction'|'quota_full')[]`，头上存当前待处理的原因，每一版存那一版当时的原因；`confirmedByUser: boolean` 只在头上，你写的、你收下的、你审过的都为 true。（第一轮审查第 2 条）
  - 两种都属于附录 C 的“注记”这一种新记录；加上 `CurrentPointer` 一共两种（附录 C 的前两种）。
  - `AggregateRef` 加 `NoteHead`、`NoteVersion`、`CurrentPointer` 三种引用（F1）。
- **L2 锚点。**【lead 定，待审】O37 的七种：模块、接口、文件、目标、阶段、任务、项目。
  - 每个锚点算出一个**锚点键**（规范的文字，写入时由平台算，不信模型给的显示名）：`module:<模块 id>`、`interface:<模块 id>/<接口 id>`、`file:<工作区内规范路径>`、`goal:<目标 id>`、`stage:<目标 id>/<计划版本>/<阶段 id>`、`task:<目标 id>/<任务 id>`、`project`。
  - 阶段带计划版本：跨计划不能只凭阶段编号认同一个阶段（MEMORY-LOOKUP §3.1）。
  - 文件锚点可以带一个**符号定位**（决定 49 · Q7）：语言、限定名、签名摘要、捕获时的范围、捕获时的文件摘要。它不进锚点键（锚点键只到文件），只是正文的定位；改名不跟着走，要么新写，要么用取代。
  - 锚点必须存在：模块、接口在当前采用的架构目录里；文件路径在工作区内、不越界；文件要存在，除非锚点带 `deleted: true`（见 L2a；用户 2026-10-15 第 6 条）；目标、任务、阶段在当前计划里。工作线、成员不能当锚点（决定 35 · Q9）。
- **L2a 锚点问题的七类。**【用户 2026-10-15 第 6 条】按这个表判：第 1–3 类在写入前按表的先后核，碰到第一个不合的就退回；第 4 类收下并警告；第 5–7 类不拦写入：

  | 类 | 例子 | 谁判、何时 | 处理 |
  | --- | --- | --- | --- |
  | 1 格式错 | 种类不认识、缺字段、路径带 `..` 越出工作区或反斜杠、附加锚点和主锚点重复 | 平台，写入前 | 退回 `invalid`，指出字段 |
  | 2 对象不存在 | 模块或接口 id 不在当前目录（含写成名字、拼错）、任务或阶段不在当前计划、目标不在项目、文件不存在且没标已删除 | 平台，写入前 | 退回 `invalid`、原因 `anchor_not_found`，带 `anchorCandidates`（≤5） |
  | 3 搭配不对 | 当前理解挂在目标、阶段以外；越出自己目标的目标/阶段/任务锚点；书记越出自己负责范围的模块类锚点（见下） | 平台，写入前 | 退回 `invalid`（理解）或 `forbidden`、原因 `anchor_out_of_goal`（书记越出自己负责范围的是 `anchor_out_of_scope`） |
  | 4 对象已结束 | 任务已取消或被替代 | 平台，写入前 | 收下，`warnings` 加 `anchor_ended` |
  | 5 可疑但不一定错 | 依据文件没有一个归到锚点的模块（`basis_outside_anchor`）；文件锚点所属模块和这次执行的任务声明的模块不同（`file_module_mismatch`）；标了已删除但没有事实证明（`deleted_path_unverified`） | 平台，写入后的核对（L22） | 只提示，不拦 |
  | 6 语义判断 | 该挂模块还是任务；内容和锚点不相干；话题其实和已有的一样 | 写的人；书记审；你在节点详情里看 | 平台不判；相近注记提示（L22）帮忙 |
  | 7 写时对、后来过时 | 模块或接口被删、文件删了、任务取消或被替代、阶段不在当前计划、符号找不到 | 平台，读时算（L23） | 锚点状态 `retired` 和原因；不当现行结论；进 `stale` 读（书记的待办）；平台不自动改挂、不猜改名 |

  - **自己的目标（第 3 类）**：执行者和参谋只能用这次执行目标里的目标/阶段/任务锚点；书记在它管的范围里用；秘书只能用请求的有效目标（第 6 片 L3；为 null 时不能用目标/阶段/任务锚点）；你能用项目里任何目标。模块、接口、文件、项目锚点不受这条限制（这句是对执行者、参谋、秘书、你；书记的模块类锚点按下面“锚点归到范围”管）。
  - **锚点归到范围（第 3 类，7D L23/L35；决定 60-5）**：先把锚点归到范围：模块、接口锚点按它的 `moduleId`，文件锚点按路径（最长前缀）归到模块；目标、阶段、任务锚点归到那个目标；项目锚点归到项目。**写入准入（能不能用这个锚点）按书记自己带的范围**（E8）：项目范围的书记能用项目里所有锚点；区域书记能用它那个模块的 **containment 子树**里的模块类锚点（子树里另有更深的区域书记，它也照样能写；containment 不知道时区域只含这个模块自己）；目标书记能用它目标的目标类锚点。越出 → `forbidden`、原因 `anchor_out_of_scope`。**写得进去不等于归它管**：管理归属（审、整理、合并、标过时、撤下别人的条目）按 L5 的负责范围，那里扣掉了同职责更深的负责区域（7D1 L23 的有效负责范围）。（审查二第 6 条；审查二 lead 补）
  - **候选（第 2 类），确定性的**：候选全集 = 当前目录的模块/接口、当前计划里这个写的人能用的目标下的任务和阶段、项目的目标。给定的串和每个候选的 id、显示名都规范化（NFC + ASCII 小写）。排序：(1) 规范化名字相等；(2) id 以它开头或它以 id 开头；(3) id 或名字包含它；(4) 在 id 上按码点算 Levenshtein 距离 ≤2；并列按 id。最多 `NOTE_ANCHOR_CANDIDATES_MAX = 5`。缺文件：用写入本来就会建的捕获（L14）和 `querySource` 的 `{ kind: 'paths' }`：先同名 basename 的路径，再按到给定路径的 Levenshtein 距离排最近已存在父目录下的路径；最多扫 `NOTE_ANCHOR_CANDIDATE_SCAN = 2,000` 条；并列按路径。捕获建不起来 → 不给文件候选并写明（`candidatesUnavailable: true`）。
  - **缺文件（第 2 类和第 7 类）**：文件锚点的路径要在工作树里存在，除非锚点带 `deleted: true`；带 `deleted: true` 时路径现在必须**不**存在（存在 → `invalid`、原因 `file_exists`），且注记至少带一条事实（否则 `invalid`、`deleted_needs_fact`）。写入后的核对（L22）报 `deleted_path_unverified`，除非有一条事实是 2B 的 `RunActivity` 把该路径列进改动的文件，或是一条 `file` 事实指向该路径。这条替换 L2 的“不要求文件存在”。
- **L3 三个索引（附录 C 第 5、6、7 个）。**【lead 定，待审】都只建在 `NoteHead` 上（所以查不出旧版本）：
  - **按锚点**：头上存 `anchorKey0`…`anchorKey4` 五个标量字段（主锚点在 0，附加锚点按写入顺序，**空位为 `null` 并进等值索引**——等值索引会索引 `null`，见 `lookup-index.ts:380`；读的时候从不拿 `null` 当锚点键去查），登记五个等值索引（项目、`anchorKeyN`）。按锚点读就是五个查找合并、按注记编号去重（F5：数组不能直接建索引）。逻辑上仍是附录 C 的一个“按锚点”索引。（第一轮审查第 15 条）
  - **按审查状态**：（项目、目标或 `'project'`、状态）。书记读待审、收下待审成已审的。
  - **按暂存它的执行**：（项目、执行引用），只有 `staged` 的头有这个字段，别的为 `null`；标量 `null` 也进等值索引（`lookup-index.ts:380`），只是读的时候从不拿 `null` 去查。（第二轮审查第 8 条）
  - 第 15 个（全文）见 L10。
- **L4 写入的先后和规则。**【lead 定，待审】照 DESIGN §3.6、R43：
  1. 格式：字段类型严格；种类八种（六个一般注记 `convention | pitfall | tradeoff | open_question | preference | decision`，加 `understanding`、`repair`）；话题 1–40 个码点、不含换行，规范化后的 `topicKey` 不能为空；结论 1–200 个 Unicode 码点；正文按 UTF-8 字节：一般注记和修补 ≤3,072，当前理解渲染出来的正文 ≤6,144；`kind: 'understanding'` 给 `sections`、不给 `body`，别的 kind 给 `body`、不给 `sections`（按 kind 严格分型，给错 → `invalid`），每个 section 至少 1 个码点（可以是“无”）；事实指针 ≤16（写入只存指针，解析在核对里，L22），依据文件 ≤32；附加锚点 ≤4，和主锚点不重复。（用户 2026-10-15 第 1、2、4、9 条）
  2. 锚点（L2、L2a）和来源（L5）。当前理解只能挂目标或阶段（O35）。（用户 2026-10-15 第 6 条）
  3. 关系：`replaces`、`contradicts`、`coexistWith` 里的每条注记必须存在，并和新项至少共享一个锚点键（主、附加都算）；不能指向自己。`replaces` 可以跨六个一般注记（例如 `open_question` 被 `decision` 取代），一般注记和 `understanding`/`repair` 之间不能互相 `replaces` → `invalid`、原因 `replaces_kind_mismatch`。（第一轮审查第 1 条；用户 2026-10-15 第 1 条）
  4. 同处同话题的准入先后：同一个锚点键上已有 `topicKey` 相同的**现行项**（当前状态 `accepted` 或 `reviewed`）时，按这个先后判：（用户 2026-10-15 第 2 条）
     - 新项在 `contradicts` 里点了它 → 声明的矛盾：新项进 `pending_review`，原因只写 `contradiction`，绝不写 `same_topic_unresolved`；
     - 否则在 `replaces` 里点了它 → 取代，照 L6 的取代规则走；
     - 否则在 `coexistWith` 里点了它 → 共存，两条都保持现行；
     - 都没有 → 退回 `invalid`、原因 `same_topic_unresolved`，带上那几条的编号和版本。
     已拒绝、已撤下、已取代的不挡。
  5. 额度（L7）。
  - 不合格的一律退回，不写任何记录，回执里原样带回提交的草稿（`draft`），不截断保存（DESIGN §3.6 第 1 行）。
  - `coexistWith` 是写入请求的 `note` 里的字段；命中的并存关系作为**写入证据**存进头和这一版（L1），不是独立的关系记录。（第一轮审查第 1 条）
- **L5 谁能写什么。**【lead 定，待审】来源由平台按可信身份定，模型不能自报（F9 的做法）；“注记”在这里指六个一般注记种类（用户 2026-10-15 第 1 条）：

  | 写的人 | 能写 | 写下以后的状态 |
  | --- | --- | --- |
  | 执行中的 agent（执行者、参谋） | 一般注记（六种）、当前理解；修补只能暂存 | 一般注记、当前理解：`accepted`（本目标）；结构性的（`structural: true`）或点了 `contradicts` 的：`pending_review`；修补：`staged` |
  | 书记（按范围，L5/L23/L35） | 同上；另能在自己负责范围里审（L6） | 同上 |
  | 秘书（工具在第 6 片注册） | 当前理解、自己的一般注记；不能写修补 | 同执行中的 agent |
  | 你（经 `notes/write` 路由，只认人，同 2B 的 `reworkActorClassOf === 'human'`） | 一般注记、当前理解 | `accepted`、`confirmedByUser: true`；你写的不进待审（你就是审的人）；结构性的也直接收下 |
  | 只读副本、独立审阅者 | 不能写 | — |

  - **你的话只由你记下**：agent 可以起草“你的话”，但它写下的永远是 agent 来源；只有经你调 `notes/write`（界面上你点“记下”）才是用户来源（决定 49）。
  - **书记按范围整理（决定 60-5、60-9；7D L23/L35）**：一条注记归它的**负责范围**的书记管。负责范围 = 包含这条注记全部锚点、以及它 `replaces`/`contradicts` 的注记全部锚点的、**最深的有书记负责的范围**：模块类锚点按 containment 子树判包含（8B 以后；containment 不知道时一个区域只含它自己的模块）；目标类锚点归那个目标；模块类和目标类混在一起、或跨不同目标的，归项目。只有一个锚点时，这就是包含它的有效负责范围（7D1 L23：containment 子树减去同职责更深的负责区域）。管理、现行计数、待审计数和提醒都用这一个结果，每条注记只算给一个负责人（N-10 的 n2 只算给 `SA`）；写入准入另按 L2a 的 containment 子树，不扣更深的书记区域（审查二快速核对第 1 条）。那个范围上没有书记就逐级往上，最后是**项目范围的书记**（每个项目至少一条，7D L38）。管 = 审、整理、合并、标过时、撤下**别人的**条目。**书记**写带 `replaces`/`contradicts` 的注记去处置别人的条目时，另核它管得着被处置的那条，管不着 → `forbidden`、原因 `outside_managed_scope`、不写；执行者、参谋、秘书照 L4、L6 写（不受书记范围限制）。一般写入只按 L2a 的写入准入。范围外的条目交给那个范围的书记（7D L35 的 `resolveResponsibleLine`）。**作者撤自己的注记、你改任何注记的权利照旧单列**（`notes/withdraw`、`notes/write`、`notes/review` 不受范围限制）；结构性和矛盾项仍由你收下。今天只有开局书记、它是项目范围，所以行为不变；多书记的范围事实由本片写、7D 接线。例子见 N-10 的书记范围夹具。（审查二第 6 条；审查二 lead 补）
  - 所属目标：agent 写的是它这次执行的目标；你写的由请求带（可以为 null，表示项目级，只能挂项目、模块、接口、文件锚点）。
- **L6 状态和谁能改（第 4 片的状态行，§3）。**【lead 定，待审】存下的七种：`staged`、`accepted`、`reviewed`、`pending_review`、`rejected`、`superseded`、`withdrawn`。
  - **审**（书记在自己负责范围里、或你）：`accepted → reviewed`（全项目可参考）；`pending_review → accepted` 或 `rejected`（要原因）。待审原因决定谁收：有 `structural`/`contradiction` 的只能你收或拒；只剩 `quota_full` 的书记（或你）也能收或拒。书记范围外的条目按 L5 的最窄共同范围交给那个范围的书记（那个范围没有书记就是项目范围书记），不在这里审。你收下以后，若还挂着 `quota_full`，不回到待审：保持 `accepted`，L7 给书记报 `overQuota`。已审项不能再审成拒绝，要纠正就新写取代或撤下（DESIGN §3.6）。（第一轮审查第 2 条）
  - **撤下**（作者、书记、你）：`staged | accepted | reviewed | pending_review → withdrawn`。保留正文、来源、经过。它是当前理解时，指针照旧指着它，读的时候显示“当前理解不可用”，**不自动回到旧版**（决定 49 第 05 项 (a)）。
  - **取代**：新项进入 `accepted` 的那一次提交里，把 `replaces` 里状态是 `accepted`/`reviewed` 的旧项改成 `superseded`；旧项已是 `rejected`、`withdrawn`、`superseded` 的不动，关系只留在新项的 `replaces` 里。新项进 `pending_review` 时**不**提前取代，等它被收下的那次提交才取代。并存的项（`coexistWith`）不取代。矛盾卡选 `supersede` 时，应用先写一条新版本：`replaces` 加上解析出的目标、`contradicts` 去掉它们，再收下新项并把这些目标改成 `superseded`，全在一次提交里。（第二轮审查第 1 条）
  - **当前理解**的取代：同一锚点上新的一版理解收下时，指针改指新项，旧项 `superseded`（同一次提交，L8）。收下待审的当前理解也走同一次提交的指针 CAS：`reviewNote` 和卡的应用都带当时读到的 `expectedPointerRevision`，对不上 → `revision_conflict`、什么都不写，卡上显示当前指针（第一轮审查第 3 条）。
  - 每次改状态都写新的 `NoteVersion`（L1），头的版本号加 1，并在这条头的 `expectedVersion` 守卫下写回（第一轮审查第 3 条）；带谁、为什么。
  - 修补的生效（`staged → accepted`）在第 8 片；本片只有 `staged → withdrawn`。
- **L7 额度（软上限）。**【lead 定，待审】初值都是没实测的数字（DESIGN §9.3），做成可注入的常量：
  - 目标活动计数算这四种状态：`accepted`、`reviewed`、`pending_review`、`staged`；每个目标最多 `NOTE_GOAL_QUOTA = 200`。每个锚点键上当前的**一般注记**（六个一般种类、状态 `accepted`、`reviewed`，不含当前理解，也不含修补）最多 `NOTE_ANCHOR_QUOTA = 5`；目标是 `null` 的项目级注记只算锚点额度，不算目标额度。（用户 2026-10-15 第 1 条）
  - 准入时用的是**投影计数**：读到的当前计数减去这次写入会取代掉的条目（`replaces` 命中的现行项）。满了靠额度**不拒绝**：新项进 `pending_review`，原因 `quota_full`，交书记整理（DESIGN §3.6“条数超限交书记”）。但**你的写入从不为额度进待审**：直接准入，并在结果里报 `overQuota`。修补在额度满时保持 `staged`，读的时候报 `overQuota`。
  - 一个原因同时有结构性和额度时两个都记，先你后书记（决定 49 第 07 项）：你先收，剩下的 `quota_full` 不把它送回待审（L6）。
  - 并发写可能让一个锚点多出几条：读的时候算出现行项数，超了在结果里报 `overQuota`，书记的待办计数也算上它（L16）。不为额度加锁（§0.1 告知 2）。（第一轮审查第 4 条）
  - **给 7D 的按范围计数**：本片给读口提供按范围的现行注记数（**按注记身份去重**；一个目标、或一个模块区域，区域按 containment 展开，8B 以后），7D L28 用它算书记的位置。**两个数字不要混**：`NOTE_GOAL_QUOTA = 200` 是每个目标的额度（本条的软上限，不变）；7D 的 `SCRIBE_SLOT_NOTE_LIMIT = 500` 是一个书记位置管得动的现行注记量、超过就按子模块或目标拆范围（7D L28），它不替换 `NOTE_GOAL_QUOTA`（500 ≠ 200）。
- **L8 当前理解的版本核对。**【lead 定，待审】`CurrentPointer`（键：项目、锚点键；只有目标、阶段锚点）只记 `noteId`（可为 null），不记 `noteVersion`：读的人想看处置就去读头（第一轮审查第 3 条）。
  - 写当前理解的请求必须带它读到的指针版本 `expectedPointerRevision`（指针还不存在时为 null）。新理解的头、版本、旧理解变 `superseded`、指针改指新项，全在**一次提交**里，指针用版本守卫（F8）。
  - 版本对不上 → `revision_conflict`，什么都不写，回执带回草稿和现在的指针（编号、版本、结论），写的人重读、合并再写。
  - 读的人不等写的人：只读已提交的版本（决定 49 第 05 项 (a)）。
  - 新理解进 `pending_review`（结构性或矛盾）时，指针不动；收下它的那次提交里挪指针，用的 `expectedPointerRevision` 是收下时读到的值（`reviewNote` 和卡的应用都带它）。对不上 → `revision_conflict`、什么都不写，卡上显示当前指针。（第一轮审查第 3 条）
  - 当前理解被新理解按普通 `replaces` 取代时，指针的挪法同这一条（和 L6 的取代同一次提交）。（第一轮审查第 3 条）
- **L9 读出来是什么（派生，不存）。**【lead 定，待审】每条读出来的注记带：
  - `storedState`（存下的七种之一）；
  - `freshness`：`fresh | stale | unchecked`（L11 的核对）；`stale` 带变了的文件和定义；
  - `sourceUnavailable`：事实指针指向的原记录读不到（在 views 里算，DESIGN §3.3）；
  - `invalid`：暂存的修补所属执行的任务已取消或被替代；
  - `conflicting`：和它互相 `contradicts` 的另一条仍是现行项；或**同话题冲突**：同一个锚点键上两条现行 `accepted`/`reviewed`、`topicKey` 相同的一般注记，互相没有 `replaces`/`contradicts`/`coexistWith` 任一方向的连接（L4 第 4 条并发漏过的也算）。（第一轮审查第 1 条；用户 2026-10-15 第 2 条）
  - `overQuota`（L7）；
  - `updateDue`：只对当前理解，且从它最后一版**文字**版本算起（审不重置），它所在的目标或阶段又有任务结束、返工、采用新计划、Session 归档或重新分组（L16、R48）；没有当前理解的目标或阶段也有锚点级的状态（见 L16、§2 `UnderstandingStatusV1`）。（第一轮审查第 12 条；第二轮审查第 7 条）
  - `currentEligible`：`storedState` 是 `accepted`（只在本目标，或你确认过的）、`reviewed`，`fresh`，不 `conflicting`、不 `invalid`、来源可用、锚点不是 `retired`（L23）。只有它为真的才当“现行结论”（DESIGN §3.6 末段）；
  - `crossGoal`：不在本目标的条目。你确认过的标“你确认过”，只经书记审过的标“书记已审 · 未经你确认”。跨目标可见的是 `reviewed` **或** `confirmedByUser` 的条目；排序是**你确认的在前**，然后 `reviewed`（“书记已审 · 未经你确认”）。（第一轮审查第 2 条）
- **L10 全文（附录 C 第 15 个索引）。**【lead 定，待审】
  - RecordStore 加一个窄端口 `RecordTextSearchPort.searchText`，两个后端都做（决定 49 · Q1、Q9）。登记的全文索引写明聚合种类、等值前缀路径（项目）、要搜的文字路径（`topic`、`conclusion`、`body`）。只建在 `NoteHead` 上（当前文字；§0.1 告知 4）。（第一轮审查第 5 条）
  - **比较文字**：`topic`、`conclusion`、`body` 用 `\n` 连起来；NFC；ASCII 字母变小写；再按 Unicode 码点逐个迭代。之后不做驼峰拆分、不套单词规则。当前理解的 `body` 是渲染出来的正文（L4 第 1 条）。（用户 2026-10-15 第 4 条）
  - **词（term）**：同一个规范化后长度 2–64 个码点、不含空白；一次 1–8 个词；否则 `invalid`。
  - **`match`**：默认 `'any'`：至少一个词是比较文字的子串；`'all'`：每个词都是子串（今天的规则，与）。`urn` 能匹配 `readTurnBounds`。（第一轮审查第 5 条；用户 2026-10-15 第 3 条）
  - **分（在代码里算，候选读完、核对完以后算，两个后端排序一致）**：`score(note) = Σ 匹配到的词 t 的 w(t, note) × r(t)`；`w(t, note)` 按先后只取一个：t 在 `topicKey` 里得 `NOTE_RANK_WEIGHT_TOPIC = 3`，否则在规范化的结论里得 `NOTE_RANK_WEIGHT_CONCLUSION = 2`，否则（只在正文里）得 `NOTE_RANK_WEIGHT_BODY = 1`；`r(t) = ln(1 + U / df(t))`，`U` = 匹配集合里的注记数（做完所有非文字筛选、至少命中一个词的），`df(t)` = 其中含 t 的条数。顺序：分降序、匹配词数降序、`noteId` 升序。每项带 `matchedTerms` 和 `score`。（用户 2026-10-15 第 3 条）
  - **排序要整个匹配集合**：匹配集合不超过 `TEXT_SEARCH_CANDIDATE_MAX` 个已核对候选时，整份排序、按排序分页（游标绑 L12 已有的加排序位置；两页之间变了 → `revision_conflict`，照今天）。超过时：返回已核对的、它们之间排序，`complete: false`、`ranking: 'partial'`，并提示按锚点、路径前缀、种类或加词缩小——绝不把部分排序当全部；这时续读游标只翻这份已排好的部分，不再往后读候选。`match: 'all'` 时 L10/L12 照旧。（用户 2026-10-15 第 3 条）
  - **SQLite 候选**：FTS5 表（`tokenize = 'unicode61'`），给每条记录写进去重后的**比较文字里所有互相重叠、且不含空白的两个码点窗口**，每个窗口编成一个 ASCII token `b<hex1>_<hex2>`（码点的小写十六进制）。查的时候取每个词自己的窗口、AND 起来查候选：任何子串匹配都包含它全部窗口，所以候选是全部匹配的超集；再读出记录按上面的子串规则核对。两个后端结果相同。
  - **内存后端**：按前缀筛出候选，逐条按上面的子串规则核对（同一套规范化纯函数放在 `lookup-index.ts` 旁边）。
  - **跟提交一起改**：SQLite 在写快照的同一个事务里改 FTS 表（写、改、删头记录时）；内存后端不用另存。
  - **启动**：打开 SQLite 时检查 FTS5 可用（建一张临时表查一次中英文样本）；不可用就让全文端口报 `unsupported`（不退成全表扫描，MEMORY-LOOKUP §4.1）。FTS 表不存在或代号不对时，在打开时从头记录重建，重建完以前全文报 `unavailable`、原因 `index_not_ready`。
  - **上限**：一页最多 100 条；一次查找最多核对 1,000 个候选，没核完就返回已核到的、`complete: false` 和续读游标（不把部分当全部）。
- **L11 需复查：按代码版本、按定义。**【lead 定，待审】照 DESIGN §3.7：
  - 写输入只带 `basisFiles: string[]`（路径）和文件锚点里的 `symbolRequest`；写的时候平台解析成 `NoteBodyV1` 的 `basis`（计划版本、目录版本、最多 32 个文件的“路径 + 摘要”，摘要用工作区工具按工作树读的 `raw_bytes`）和符号定位（L14）。存下的 `NoteBodyV1` 不再有 `symbolRequest`。（第二轮审查第 3 条）
  - 读的时候：按路径读当前摘要（`WorkspaceToolsPort`），对不上 → `stale`，列出变了的文件（含已删）；锚定的任务在当前计划里的定义和 `basis.planRevision` 里的定义比（按定义对象的规范 JSON 比），不同或没了 → `stale`、原因 `task_definition_changed`；锚定的模块或接口在当前目录版本里的定义和 `basis.catalogRevision` 比，不同或没了 → `stale`、原因 `module_definition_changed`。（第一轮审查第 6 条）
  - **方案采用**：目标或阶段的当前理解的 `basis.planRevision` 和当前采用的计划版本不同 → `stale`、原因 `plan_changed`（和 `updateDue` 分开报）。（第一轮审查第 6 条）
  - **依据注记退役**：`facts` 里 `kind: 'note'` 的引用，读那条注记的**头**：头状态 `superseded`、`withdrawn`、`rejected` → 这条 `stale`、原因 `basis_note_retired`；引用里的版本只用来显示文字。只看一层，不往下递归。（第一轮审查第 6 条）
  - **工作区观测**（`WorkspaceToolsPort.readWorkspace`；版本固定 `{ kind: 'working_tree' }`，读当前工作树不是某个提交；`maxBytes = NOTE_BASIS_FILE_MAX_BYTES = 1 MiB`，这个常量可注入、且从不超过工作区配置的上限；摘要用 `raw_bytes`）（第二轮审查第 4 条）：
    - 写的时候平台读每个依据文件的摘要：文件不存在 → 退回 `invalid`、原因 `basis_file_missing`；禁止读或路径在工作区外 → `invalid`；文件大于 `NOTE_BASIS_FILE_MAX_BYTES` → 退回 `invalid`、原因 `basis_file_too_large`；工具不可用/容量不够 → 退回 `unavailable`，带回草稿。（第二轮审查第 4 条）
    - 读的时候：文件不存在 → 这条 `stale`，并在 `changedFiles` 里标 `deleted: true`；禁止读、工具不可用 → 这条 `unchecked`，原因码照结果种类给（`forbidden`、`unavailable`）；文件大于 `NOTE_BASIS_FILE_MAX_BYTES`（或超出工作区配置上限）→ 这条 `unchecked`、原因 `capacity`。（第二轮审查第 4 条）
  - **预算**：按结果顺序逐条查，每条按存下的依据文件顺序；读满 256 个不同文件为止，这一页剩下的条目 `unchecked`，写“未核对 n 条”，不当作仍然有效。（第一轮审查第 7 条）
- **L12 六种读法、两个入口（决定 49 · Q2）。**【lead 定，待审】都在 WorkGraph 的 `notes` 读口（L18）：
  - “看”的记忆分支：`lookup`（锚点 → 当前理解指针和挂着的注记）、`neighbors`（一条注记 → 它 `replaces`/`contradicts` 的、反过来点它的；反查只在它的锚点候选里找）、`history`（注记编号 → 各版本和经过）、`conflicts`（注记或锚点 → 互相矛盾和未决同话题的双方）；
  - “找”的记忆分支：`find`（词、锚点或路径、种类（`kind` 可给 `'general'`）、话题、状态的组合；词走 L10 和 `match`，`'any'` 时按本节的分排序）、`stale`（目标或锚点范围内需复查、未核对、来源不可用、事实解析不了、锚点已失效的条目和原因；书记的待办读它）。（用户 2026-10-15 第 1、2、3 条）
  - 共同的返回：`readBasis`（记录游标、规则版本、本次文件观测的摘要集）、`items`、`warnings`、`next`、`complete`、`coverage`（核对了多少、没核对多少）。每项带编号、版本、锚点、种类、话题（`topic` 和 `topicKey`）、结论、L9 的各项、来源、关系字段、结构化的 `changedFiles` 和每项的 `observedFiles`，以及 L23 的 `anchorStatus`/`anchorRetiredReasons`/`retiredExtraAnchors`；`find` 的每项另带 `matchedTerms`、`score`。`lookup` 另带 `understanding: UnderstandingStatusV1 | null`，加 `topics`（这个锚点上当前的各话题，按 `topicKey` 去重、显示最近写入的写法，最多 `MEMORY_TOPICS_MAX = 50`）和 `topicsComplete`；`history` 的每项另带这一版的 `change` 和 `since`。`understanding` 项的 `sections` 照 L4 第 1 条给。正文默认不带，`lookup`/`history` 的 `body: { noteId; version?; cursor }` 指定一条时按页带（每页 2 KiB，最多 4 KiB，按 UTF-8 字符边界切）。（第二轮审查第 5 条；用户 2026-10-15 第 2、3、4、10 条）
  - 一页默认 20 条，最多 100 条；整个返回的 JSON 不超过 48 KiB，超了少放几条、给续读游标。
  - 续读游标绑定：调用的身份、完整请求、规则版本、记录游标。文件观测是**每一页各自做、按条目报**的（不是原子，F12）。游标越过已经看过、但没命中筛选的条目，所以 `items` 为空、`complete: false` 还是有效的一页：没读完不是“没有”。（第一轮审查第 7 条）
  - 跨页之间注记变了 → `revision_conflict`（重读）；参数和游标对不上 → `invalid`、原因 `cursor_mismatch`。六种请求的具体字段和返回见 §2。
  - **模块关系**：模块或接口上的 `lookup` 返回挂在这个锚点上的注记；模块下文件上的注记用 `find` 加路径前缀条件找（目录里最长的路径赢，和 `mapExecutedFilesToModules` 同一条规则）。（第一轮审查第 8 条）
  - **锚点不存在**：`lookup`、`conflicts`、`find` 带锚点时，若没有任何头有这个锚点键**且**这个锚点现在不存在（L2a 第 2 类的规则，不套“自己的目标”那一条）→ `not_found`、原因 `anchor_not_found`，带 `anchorCandidates`；有头（例如已删的模块）→ 照常返回，按 L23 标 `retired`；锚点存在但没有注记 → `items` 为空、`complete: true`。“不存在”和“这里没有”永远不是同一个答复。（用户 2026-10-15 第 8 条）
  - 读不写：读从不改注记、消息、执行状态或已读位置。
- **L13 “看”“找”的记忆分支。**【lead 定，待审】不加新的公开工具（Q2）。两个工具的参数加一个有版本的分支：`look_graph` 收 `{ memory: { v: 1, op: 'lookup' | 'neighbors' | 'history' | 'conflicts', … } }`，`find_graph` 收 `{ memory: { v: 1, op: 'find' | 'stale', … } }`；schema 是**旧图参数和 `{ memory: … }` 的严格 union**，先按 `memory` 在不在分派，再走旧校验；参数和返回形状不变；匹配规则按本条改（G-02；用户 2026-10-15 第 11 条）。可信的范围、身份、目标照旧由适配层带（F9）。具体字段和返回见 §2 的六个请求类型。（第一轮审查第 16 条）
  - **“找”的匹配（改第 3 片的行为）**：名字、路径、说明两边都先 NFC + ASCII 小写（不再区分大小写）。路径查询时，模块的某条路径和查询相等、或是查询的最长前缀归属者（按目录边界，和 `mapExecutedFilesToModules` 同一条规则）、或者位于查询目录之下（`查询 + '/'` 前缀），都算命中；参数和结果形状不变。（用户 2026-10-15 第 11 条）
- **L14 “记”工具。**【lead 定，待审】一个新的平台工具 `record_note`，参数按 `op` 严格分三支：
  - `op: 'write'`（执行者、参谋、书记、秘书）：`kind`（八种之一，见 L4 第 1 条）、`anchor`、`extraAnchors`（文件锚点可带 `symbolRequest: { language, name, range? }`，平台解析成 `NoteBodyV1` 的 `symbol` 定位）、`topic`、`conclusion`、`body`（非 understanding）或 `sections`（understanding；给错 → `invalid`，见 L4 第 1 条）、`facts`、`basisFiles`（路径列表，摘要和符号由平台读，不信模型给）、`replaces`、`contradicts`、`coexistWith`、`structural`、`expectedPointerRevision`（只对当前理解）。（第二轮审查第 3 条；用户 2026-10-15 第 1、4 条）
  - `op: 'review'`（**只有书记**）：`noteId`、`expectedVersion`、`verdict: 'review' | 'accept' | 'reject'`、`reason`、`expectedPointerRevision`（注记是当前理解时）。`review` = `accepted → reviewed`；`accept`/`reject` 只对 `pending_review` 且只剩 `quota_full` 的收下/拒绝；有 `structural`/`contradiction` 的书记收不了（`forbidden`）。（第二轮审查第 6 条）
  - `op: 'withdraw'`（作者或书记）：`noteId`、`expectedVersion`、`reason`。
  - 合并就是一次 `write` 带多条 `replaces`。
  - 注册给：执行（Work）里的执行者、参谋、书记（F15 的工具组装处）；执行者和参谋拿 `write` 和 `withdraw`（只动自己的注记）。**区域参谋、开局参谋的探索查询（第 6 片的 `role_exploration` 调用类，无 Goal 的 Query）也注册 `record_note`，按本片 L2a 的范围准入写注记**；只读副本、独立审阅者不注册。秘书的注册在第 6 片（§0.1 告知 5）。（第一轮审查第 10 条；审查二第 11 条）

  | 谁 | `write` | `review` | `withdraw` |
  | --- | --- | --- | --- |
  | 执行者、参谋 | 有 | 无 | 有（自己的注记） |
  | 书记 | 有 | 有 | 有 |
  | 秘书（第 6 片注册） | 有（自己的注记和当前理解） | 无 | 有（自己的注记） |
  | 只读副本、独立审阅者 | 无 | 无 | 无 |

  - 返回：`write` 回 `WriteNoteEnvelopeV1` = `{ write: WriteNoteResult; check: NoteCheckV1 | { status: 'unavailable'; reason } }`（`write` 的 `status` 是 `accepted | pending_review | staged | rejected`，加原因、编号、版本、`warnings`、`existingTopics`；`rejected` 带回草稿，L4；提交成功后工具调 `NoteCheckPort.checkNotes`（`withSimilar: true`）填 `check`，见 L22）；`review`/`withdraw` 回 `NoteDispositionResult`（成功带正式提交回执）。（第二轮审查第 6 条；用户 2026-10-15 第 2、3、9 条）
  - **符号**：写输入的文件锚点给 `symbolRequest: { language, name, range? }`；平台为这个文件用已有的捕获 API 建一次工作区捕获（`captureSourceChanges`），用 `querySource` 的 `symbols`（`path` 是这个文件）翻页取命中（最多 `NOTE_SYMBOL_HITS_MAX = 200` 条），只留名字等于请求的（请求带 `range` 时范围也要对上）。恰好一条 → 记录 `NoteBodyV1.symbol` 定位：`qualifiedName` 用命中的名字（命中带容器时拼上容器）、`range`、`fileDigest`、`signatureDigest` = 从这次捕获的文件内容里取命中范围文字、把连续空白折成一个空格后的 sha256。多条命中 → 退回 `invalid`、原因 `symbol_ambiguous`，列出候选（名字、范围），写的人带 `range` 重发。没有命中、语言不支持或捕获里没有这个文件 → 只存文件锚点，不带符号，成功结果里带警告 `symbol_unresolved`（语言不支持是警告，不是错误）。不追改名：改名的符号新写一条 `replaces` 旧的。（第一轮审查第 8 条；第二轮审查第 3 条）
  - 计划版本、目录版本由平台从这次执行的绑定里填，不让模型给。阶段锚点的 `planRevision` 也由平台填：agent 用它这次执行的绑定（它目标）的计划版本；你用该目标当前采用的计划版本。存下的 `NoteAnchorV1` 和锚点键都保留这个版本（阶段 id 可能跨计划版本重复，MEMORY-LOOKUP §3.1）。写入的提交位置本来就记下登记的先后。（用户 2026-10-15 第 7 条）
  - **工具说明和技能文字（4C；lead 在 4C 冻结时写）**：`record_note` 的工具说明和 `resources/skills/platform-work/content.md`、`platform-adviser/content.md`、`platform-scribe/content.md`、`platform-secretary/content.md` 里的“注记”一段要说清：什么时候写（任务结束、返工、采用计划、归档——MVP B09）；挂哪儿（问“这个任务明天取消，这条还对吗”，还成立就挂架构锚点）；八种里选哪一种；先 look/find、复用已有话题（L12 `lookup` 的 `topics`）；结论一句话；事实只给指针、从不抄原文；`open_question` 由点它的 `decision` 用 `replaces` 收掉；写后读核对（L22）并改掉它报的问题。秘书的工具注册留在第 6 片，文字可以先落在这里。（用户 2026-10-15 第 5 条）
  - **秘书的 61-5 指引（写进 `platform-secretary/content.md` 的“注记”一段）**：接手已有项目、要重构到新架构时，按这套做：**先采用现状架构**作为初始正式架构（就是初始化那一步得出的地图），不要一开始就采用目标架构（现有代码会全部报“没归组、不符”，提醒成噪音）。第一个目标定成“摸清现状、定下目标架构和迁移路线”，完成标准是**能检查的产物**：你确认过的目标架构文档、迁移顺序、秘书起草的后续目标卡。目标架构先写成文档，**关键取舍记成项目级的 `decision` 注记**，不急着改正式架构。之后按迁移路线**一块一个目标**；每块完成时，正式架构按这块做一次修订（结构改动，出卡给你）；**“还剩多少没迁”看迁移路线里目标的完成数**，“正式对观测”的差异只作参考、不当成完成比例。（61-5、61-6）
- **L15 你的注记接口（DESIGN §6：一读三写）。**【lead 定，待审】路由，只认人（同 L5）：
  - `notes/list`（读）：按锚点、目标、状态列，带 L9 的各项；就是 L12 的 `lookup`/`find` 给界面的那一面；每行的 `label` 用 `renderNoteHeader`（§2）；（用户 2026-10-15 第 1 条）
  - `notes/write`：写或改（改 = 新写一条取代旧的，同时 `replaces` 旧项；你要“改”的是自己的话也一样，旧的留在历史里）；
  - `notes/withdraw`：撤下；
  - `notes/review`：审（`accepted → reviewed`；对 `pending_review` 的收下或拒绝，见 L17），带只对当前理解的 `expectedPointerRevision`。
  - 每次写都带 `commandId` 幂等键，经存储的幂等提交（同 WorkGraph 别的写）；重放回原回执（N-12）。每个操作的错误码见 §2。（第一轮审查第 13 条）
  - 还有两个版本列表的读（L19）。都加进界面路由标签表。
- **L16 书记提醒。**【lead 定，待审】注意力心跳（F14）加两个计数：**待审条数**（按审查状态索引数 `pending_review`，加 `overQuota` 的锚点数）和**该更新的当前理解条数**（目标、阶段锚点的 `UnderstandingStatusV1.updateDue`，没有当前理解也算）。（第二轮审查第 7 条）
  - 发给书记的条件：任一计数达到阈值（`SCRIBE_PENDING_THRESHOLD = 10`、`SCRIBE_UPDATE_DUE_THRESHOLD = 5`，没实测，可配置），或你手动归档、在场没有 agent 的那个目标出现了 `updateDue`（DESIGN §3.5“书记补写”）。心跳按 `(anchorKey, latestTriggerCursor, ownerSessionKey)` 的集合去重，不按计数去重（相同的计数可能是不同的工作）；**管理归属、按范围计数和待审提醒一律按“整条注记及它 `replaces`/`contradicts` 的注记的全部锚点”求最窄共同负责范围，只有“没有当前理解的 `updateDue`”按单个锚点找**（审查二第 6 条）；**这不是新字段：这个去重键本来就是一个字符串身份，`ownerSessionKey` 在发提醒时按 L35/L23 算出的负责书记线的键；负责线换了，键就不同，新书记收到还没处理的那条**。（第一轮审查第 12 条；第二轮审查第 7 条）
  - **发给哪个书记（决定 60-5；7D L35/L23）**：按 7D 的 `resolveResponsibleLine(范围, 'scribe')` 发给 L5 求出的负责范围的书记：待审提醒和按范围计数按整条注记（含它 `replaces`/`contradicts` 的注记）的全部锚点求负责范围，只有“没有当前理解的 `updateDue`”按那一个目标锚点找。负责范围上没有书记就逐级往上，最后是项目范围的书记（只有开局书记时它就是项目范围）。每个项目至少有一条书记、由它负责项目范围（7D L38），所以总找得到；确切收件人见 D-03。计数和待办也按这个范围算（L7 的按范围现行注记数）。（审查二第 6 条；审查二 lead 补）
  - Workflow 不写文字，也不存“该更新了”的标记（DESIGN §3.5 末尾）。
- **L17 决定队列的注记卡（F13）。**【lead 定，待审】
  - 进“要决定”的：`pending_review` 里结构性的、点了 `contradicts` 的。只是额度满了的不进（那交书记）。
  - 选项 id：结构性卡 `accept` / `reject`；矛盾卡 `supersede` / `coexist` / `reject`。钉子（pin）：注记编号和头版本。
  - 落实由 notes 写入方做（收下时照 L6 取代、改指针），提交的最后一条事件 `NoteDispositionChanged` 是证明（`supersede` 用新注记被收下的那条事件，事件带 `acknowledgementRef` = 你答复的消息），应用返回这次提交的正式回执（identity、fingerprint、cursor），记在答复上，同第 5 片的落实；`decision-application.ts` 照第 5 片 `readApplicationReceiptFacts` 的读法认回执和 `acknowledgementRef`。重试重放原回执。（第一轮审查第 9 条；第二轮审查第 2 条）
  - 注入：在 `work-graph/model/decision-contracts.ts` 定义 `NoteDecisionSourcePort`；notes 实现它；组合根把它注入 communication（communication 从不 import notes）。（第一轮审查第 9 条）
  - 在矛盾卡上选 `supersede` 时，应用写一条**新版本**的新注记：`replaces` 加上解析出的目标、`contradicts` 去掉它们，再收下新项并把这些目标改成 `superseded`，全在一次提交里；证明事件是这次提交的最后一条 `NoteDispositionChanged`。（第二轮审查第 1 条）
  - 在矛盾卡上选“并存”时，应用写一条**新版本**的新注记：`contradicts` 去掉那一条，`coexistWith` 加上它，并写一条指向你答复消息的事实；你写的适用条件进这一版的 `change.reason`。旧版本保留原来的 `contradicts`（历史）。（第一轮审查第 1 条）
  - `readSource` 认 `note_review`（补上 F13 的 `unsupported`），钉住注记编号和头版本；注记在卡出来以后又变了 → 落实报 `source_stale`，卡上重读。读和落实都带当时读到的 `expectedPointerRevision`；理解卡上带当前指针（注记编号、版本）。（第一轮审查第 3 条；第二轮审查第 2 条）
  - 书记整理的结果（合并、标过时、撤下）进“请知悉”（决定 35 · Q23）。
- **L18 模块放置和读口。**【lead 定，待审】
  - 新建 WorkGraph 子模块 `src/core/work-graph/notes/`，第一个文件落地时在 `module-target.json` 声明它和依赖（model、state、persistence、architecture、sessions、tasks），并给 `views`、`evidence` 加 `notes` 依赖（F17）。
  - 状态迁移的纯规则在 `state/note-machine.ts`（AGENTS.md 第 9 条）。
  - 写入方 `notes/note-service.ts`（唯一写入口）；读口 `notes/note-read-model.ts`（六种读法，每项字段经 `NoteCheckPort` 算）；`views/note-views.ts` 实现 `NoteCheckPort`（含 `sourceUnavailable`，要读消息、检查记录，DESIGN §7.2）；端口类型在 `model/note-contracts.ts`，组合根把实现注入 notes 读口和 4C 的工具、路由（notes 不 import views）。（用户 2026-10-15 第 9 条）
  - 核对端口的两个调用点：六种读，和写入提交后的核对；只读，不写不存（L22）。（用户 2026-10-15 第 9 条）
  - **文件归属**：`notes/note-read-model.ts` 由 4A 新建、4B 扩展；每个小片只在 `create-platform.ts` 加自己的登记；4B 对 RecordStore 的改动排在 2C 的计数端口合入以后；4C 对节点详情的改动排在 2C 以后。（第一轮审查第 14 条）
- **L19 两个版本列表（DESIGN §6）。**【lead 定，待审】
  - 计划各版本及原因：按目标读计划版本（用 2B 加的 `s2b-plan-revision-by-goal` 索引，该索引按 `acceptedAt` 排），列表按 `acceptedAt` 倒序并显示修订号（修订号在收下时分配，所以顺序对得上；lead 在冻结时再核一次）。原因取候选计划上的改动原因；没有原因的旧版本写“没有记下原因”，不编。（第一轮审查第 14 条）
  - 架构目录各版本及原因：给目录修订登记一个按项目、版本号排序的索引，原因取目录修订事件；旧的没有就同上。
  - 两个都分页（每页最多 50）、按版本倒序。
- **L20 装配器分路（DESIGN §5.1 L1039 已定）。**【lead 定，待审】
  - 注记行用 notes 扩展自己的类型 `NoteIndexRowV1 { anchorKey, noteId, version, kind, conclusion, freshness, label }`，不用 `ContextIndexRowV1`（后者要求 `GraphNodeRefV1`，放不下文件、接口、项目行）。（第一轮审查第 11 条）
  - `notes` 扩展拆成两部分：`understanding`（这个任务所在目标、阶段的 `UnderstandingStatusV1`，最多 2 行：指针、版本、结论、可用性；没有当前理解也给出锚点状态）和 `general`（一般注记的索引行）。（第二轮审查第 7 条）
  - Goal 卡只放 `understanding`；预算区放 `general`，排除已在 Goal 卡里的那一条；同一条注记从几个锚点读到只放一次。
  - 一般注记的来源和顺序：本任务、阶段、目标，再到任务涉及的模块、接口、文件的锚点；按“你确认的 → 本目标收下的 → 书记已审跨目标的”，同一档按话题、编号排。
  - **区域参谋的约定注记（7D；8B 以后）**：任务所属模块的**上级模块**（containment 祖先）上的模块注记也算，特别是区域参谋写的 `convention`（接口、这块的约定）；按 containment 从近到远收，和任务自己模块的注记同档处理，**仍守 `currentEligible` 和跨目标可见性**。8B 提供 containment 以后才生效。
  - **结论行和警示行**：只有 `currentEligible` 的才有结论行。`accepted`/`reviewed` 的条目若 stale、conflicting 或来源不可用，各得**一条警示行**：“需复查/冲突/来源不可用：<编号> <结论>，不能当现行结论”。结论行和它的警示行不许拆开：一条条目要么出结论，要么出警示，不能两样都算。放不下的行计入这一段的省略行，用 `state/context-input.ts` 已有的省略措辞。（第一轮审查第 11 条）
  - **提醒段**：装配器的提醒段对工作 agent 写明“当前理解该更新了”，针对它所在的目标/阶段（DESIGN §3.5 第 1 行），用它锚点的 `UnderstandingStatusV1.updateDue`（没有当前理解也算）。（第一轮审查第 12 条；第二轮审查第 7 条）
  - 每行都带编号、版本、锚点、新鲜度；装配记录里只记**实际渲染的**行（`ContextSourceV1` 的 `kind: 'note'`），没放的不记。（第一轮审查第 11 条）
  - `ContextSourceV1` 的 `note` 一支今天带 `node: GraphNodeRefV1`，而 `GraphNodeRefV1` 没有文件、接口、项目三种（F4）。4C 把这一支改成 `{ kind: 'note'; anchorKey: string; noteId: string; version: number; digest: string }`：今天没有任何写入方写这一支（notes 没接线），改它不碰已存的数据；冻结前 lead 再核一次没有写入方。
  - 已绑定的执行重放时不重拼（F4：注记变了不挡已绑定的执行，规格不把它说成“记忆变更会挡住旧执行”）。
  - Query 的装配（今天的规划、副本）只放 `understanding`，不放 `general`；秘书的装配由第 6 片定。
- **L21 节点详情的注记一栏（4C，要 2C 合入）。**【lead 定，待审】2C 的节点详情（`NodeDetailReadPort.readNodeDetail`）里 `notes` 今天是 `not_available`、原因 `slice_4`；4C 换成真实的：这个节点上的当前理解、注记（L12 的 `lookup` 第一页），和已有的异常锚点并列（异常锚点不变，不当注记写，F18）。悬停卡只显示条数（决定 35 · Q23）。“看”下钻到节点详情走同一个读取。
- **L22 一个核对，两个调用点。**【用户 2026-10-15 第 9 条】新增读层端口 `NoteCheckPort.checkNotes(ctx, { items })`，返回每项的 `NoteCheckV1`：L9 的派生字段（`freshness` 和 `changedFiles`、`sourceUnavailable`、`invalid`、`conflicting`、`overQuota`、`updateDue`、`currentEligible`）、L23 的锚点状态、`unresolvedFacts: { index; reason }[]`、第 5 类提示。只读，不写记录、不存东西。L12 的六种读都**走同一个函数**算每项字段——一个实现，两个调用点。
  - **事实在核对里解析，不在写入时**：每条记录指针读那条记录的那个版本；`note` 指针要有头且版本 ≤ 头的当前版本；产物和历史区段指针走已有的读法；`file` 指针要路径在工作区内、`digest` 是 64 位十六进制，当前内容报 `same`/`changed`；`commit` 只看格式（40 或 64 位十六进制），永远 `unchecked`（工作区可能没有 git）：`commit` 指针进 `uncheckedFacts`，不影响 `currentEligible`。一页最多解析 `NOTE_READ_FACTS_MAX = 256` 个事实指针（初值没实测、可注入），超出的进 `uncheckedFacts`，所在那一项 `freshness: 'unchecked'`、不当现行结论（同 L11 的文件预算）。这留在 views，因为 notes 读不了消息和检查记录（DESIGN §7.2；`evidence` 依赖 `notes`）。
  - **写 = 闸门、写、核对**：提交前只跑格式和锚点闸门（L2a 第 1–3 类，和种类、话题、分型、锚点、阶段版本填法）。`existingTopics` 由写入方在 `WriteNoteResult` 里给（4A）。提交成功后 `record_note` 和 `notes/write`（4C）调 `checkNotes` 核对新项（`withSimilar: true`，另给 `similar`），返回 `{ write: WriteNoteResult; check: NoteCheckV1 | { status: 'unavailable'; reason } }`。核对失败从不算撤销写入；核对有问题的一项按已有规则不当现行结论、进 `stale` 读；工具文字让写的人撤下或重写。事实不再在写入时“只计数”（据此改 L4 第 1 条和 §2 的 `not_found` 注释）。
  - **`existingTopics`（在写入结果 `WriteNoteResult` 里，由写入方给，4A）**：新注记的 `topicKey` 在某个锚点键上是新的、而该锚点键已有别的话题的现行项时，给出这些现行项的不同 `topicKey`（显示最近写入的写法）和条数，按锚点键、`topicKey` 排，总共最多 `NOTE_EXISTING_TOPICS_MAX = 20`。是提示，不退回；给写的人下次复用一个话题。
  - **相近注记（写侧，`checkNotes` 带 `withSimilar: true` 时给，4B）**：相似度 = 对 `normalized(topic) + "\n" + normalized(conclusion)` 的 `bigramWindows` 算 Jaccard。候选：和新注记共享至少一个锚点键的现行项（`accepted`、`reviewed`、`pending_review`），排除自己和已在 `replaces`/`contradicts`/`coexistWith` 点名的；只读锚点查找的第一页（有界）。返回最多 `NOTE_SIMILAR_MAX = 3`、相似度 ≥ `NOTE_SIMILAR_MIN = 0.3`（没实测、可注入），每条 `noteId`、`version`、`header`（`renderNoteHeader`）、`similarity`；并列按 `noteId`。它从不拦写入，写的人自己决定取代/并存/矛盾。
- **L23 读时的锚点状态（第 7 类）。**【用户 2026-10-15 第 10 条】`NoteItemV1`/`NoteCheckV1` 加 `anchorStatus: 'live' | 'retired'`、`anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing')[]`、`retiredExtraAnchors: string[]`（锚点键）。**主锚点** retired 时这条才 `retired`；retired 的附加锚点只列出来。带 `deleted: true` 的文件锚点不适用 `file_deleted`。`task_ended` 指取消或被替代（已满足的任务不算）。`retired` → `currentEligible: false`；历史照读。
  - **符号**：文件当前摘要等于存下的 `fileDigest` 时，符号不重新解析就算 live；否则按 `qualifiedName` 重新解析（捕获 + `querySource` 在这个文件上的 symbols）：找不到 → `symbol_missing`；找到但 `signatureDigest` 不同 → `stale`、原因 `symbol_signature_changed`。每页最多重解 `NOTE_SYMBOL_RECHECK_MAX = 20` 次，且计入 `NOTE_READ_FILES_MAX`；超出的那项 `unchecked`。
  - 平台从不自动改挂、不猜改名；第 8 片 A 的“可能移动”仍只是装配器里的提示。

### 0.4 和别的片的接缝

- **2A（已合入）：** 按顺序查找（版本列表、按版本读历史可以用）。
- **2B（已合入，84f728d5）：** 计划版本按目标的索引由 2B 加；4B 的计划版本列表用它，所以 4B 在 2B 合入以后施工。
- **2C（施工中）：** 2C 在 RecordStore 那几个文件里加计数端口，4B 在同样的文件里加全文端口：4B 在 2C 合入以后施工，避免并行冲突。节点详情（L21）接 2C 的读取。
- **第 3 片：** 装配器、“看”“找”工具、职责配置（谁能用“记”）。L13 的“找”匹配改成不区分大小写和新的路径规则，会改第 3 片已有的行为（用户 2026-10-15 第 11 条）。
- **第 5 片：** 决定队列和答复、落实（L17）。
- **第 6 片：** 秘书的“记”工具注册、“记下你的话”的界面流程、按目标取记忆、换手时的交接。
- **第 7 片：** 换手前必须写当前理解（DESIGN §3.5），要本片的写入方。
- **第 7 片（7D）：** 书记的负责范围（L5/L6）和按范围找书记（L16）用 7D 的 `RoleScopeV1`、`resolveResponsibleLine`；按范围的现行注记数（L7）供 7D L28 算书记位置（`SCRIBE_SLOT_NOTE_LIMIT`）；区域参谋的约定注记（L20）要 8B 的 containment。今天只有开局书记、范围整个项目，所以本片的行为不变，范围事实写下来给 7D 用。
- **第 8 片：** 修补随检查和架构修订生效（R47）。 第 8 片会扩展本片的 `NoteDraftV1` 和 `record_note` 的 `write` 分支：`kind: 'repair'` 时必须带 `repair: { pin; ops; responsibilityMoves }`（每个受影响的开着负责关系的去向，审查二第 13 条），`structural` 由平台算（第 8 片 L1、第二轮审查第 2 条）；本片施工时先留这个字段的位置，不实现修补的内容（lead 2026-10-15）。
- **K2：** 压缩时保留注记链接；检索不调模型。

## 1. 范围

### 1.1 交付（按 §0.1 第 1 条 (a) 分三小片）

**4A 注记的记录和写入：** L1–L8、L2a、L18 的写入方和不含 `sourceUnavailable` 的读口最小面（按编号读、按锚点列头）；八种种类、`topicKey`、understanding 的 `sections`、写入闸门；三个索引；按范围的现行注记数（L7）；书记范围事实（L5，给 7D 写；今天只有开局书记、范围整个项目）；状态行（§3）；`module-target.json` 声明 notes。（用户 2026-10-15 第 1、2、4、6、7 条）

**4B 查找和新鲜度：** L9–L12、L22、L23（全文端口、两个后端和排序、六种读法、新鲜度、`sourceUnavailable`、核对端口、锚点状态）、L19 两个版本列表。（用户 2026-10-15 第 3、8、9、10 条）

**4C 接进工作：** L13–L17、L20、L21；路由；书记按范围审、按 `resolveResponsibleLine` 发提醒（L6、L16）；区域参谋的约定注记按 containment 进装配（L20，8B 以后）；`record_note` 的工具说明和四个 skill 文件的“注记”段（L14 末项，含 61-5 的秘书指引）；E3-UI-ITEMS 加注记一栏的界面条目（lead 写文档）。（用户 2026-10-15 第 5、11、12 条）

### 1.2 不在本片

- 修补生效（第 8 片）；秘书的“记”工具注册和“记下你的话”的界面流程（第 6 片）；换手的动作本身（第 7 片）。
- 跟着长期成员走的记忆（决定 35 · Q9，MVP 不做）；把注记导出到仓库（Q11，以后）。
- 近义词、跨语言、向量检索、模型参与的查找（决定 49）；受控别名词表（MEMORY-LOOKUP §3.4，可选，未采用）。（用户 2026-10-15 第 3 条）
- 词的共现统计（把常一起出现的词，如“auth”和“认证”，联系起来）：只有等真实注记出现并量过以后再做；本片只做字面子串和排序（MEMORY-LOOKUP；用户 2026-10-15 第 3 条）。
- 按词查历史版本（§0.1 告知 4）；独立的关系记录、标签、时间或邻接索引（决定 49 · Q8、Q9）。
- 真删除（决定 35 · Q23：删就是撤下）。
- 性能尺子的实测（MEMORY-LOOKUP §1、第 9 片）；本片验收时 lead 在基准规模上量一次，只记不断言。

## 2. 接口（新名字以此为准，冻结时可能细调）

```ts
// src/contracts/note.ts（新）
export type NoteAnchorV1 =
  | { kind: 'module'; moduleId: string }
  | { kind: 'interface'; moduleId: string; interfaceId: string }
  | { kind: 'file'; path: string; symbol?: SymbolLocatorV1; deleted?: true }   // deleted 见 L2a（用户 2026-10-15 第 6 条）
  | { kind: 'goal'; goalId: string }
  | { kind: 'stage'; goalId: string; planRevision: number; stageId: string }
  | { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'project' };
export type SymbolLocatorV1 = { language: string; qualifiedName: string; signatureDigest: string;
  range: { startLine: number; endLine: number }; fileDigest: string };
export type SymbolRequestV1 = { language: string; name: string; range?: { startLine: number; endLine: number } };
export type NoteDraftAnchorV1 =                      // 写输入：文件锚点给请求，不给已解析的定位；阶段不带 planRevision，平台填（用户 2026-10-15 第 7 条）
  | { kind: 'module'; moduleId: string }
  | { kind: 'interface'; moduleId: string; interfaceId: string }
  | { kind: 'file'; path: string; symbolRequest?: SymbolRequestV1; deleted?: true }
  | { kind: 'goal'; goalId: string }
  | { kind: 'stage'; goalId: string; stageId: string }
  | { kind: 'task'; goalId: string; taskId: string }
  | { kind: 'project' };
export type NoteSectionsV1 = { status: string; decided: string; open: string; next: string; risks: string };   // 当前理解专用，每段至少 1 个码点（用户 2026-10-15 第 4 条）
type NoteDraftCommonV1 = { topic: string; conclusion: string; anchor: NoteDraftAnchorV1; extraAnchors: NoteDraftAnchorV1[];
  facts: NoteFactV1[]; basisFiles: string[]; structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[] };
export type NoteDraftV1 =   // 按 kind 严格分型：understanding 只给 sections，别的只给 body，给错 → invalid；平台解析成 NoteBodyV1（符号定位、依据摘要）（第二轮审查第 3 条；用户 2026-10-15 第 4 条）
  | NoteDraftCommonV1 & { kind: Exclude<NoteKind, 'understanding'>; body: string }
  | NoteDraftCommonV1 & { kind: 'understanding'; sections: NoteSectionsV1 };
export type NoteKind = 'convention' | 'pitfall' | 'tradeoff' | 'open_question' | 'preference' | 'decision'
  | 'understanding' | 'repair';                              // 前六个是一般注记，类名依次为 约定、坑、取舍、待解问题、偏好、决定；understanding 当前理解；repair 修补（用户 2026-10-15 第 1 条）
export const NOTE_GENERAL_KINDS: readonly NoteKind[] = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision'];   // 一般注记六种（用户 2026-10-15 第 1 条）
// 头部一行，平台用纯函数从字段渲染；模型从不写这个串（用户 2026-10-15 第 1 条）
export function renderNoteHeader(note: { kind: NoteKind; anchor: NoteAnchorV1; structural: boolean; conclusion: string }): string;
// 形如 `<类名>(<锚点显示>)<!>：<结论>`；`!` 只在 structural 时出现。
// 锚点显示：模块 `模块 <id>`；接口 `接口 <moduleId>/<interfaceId>`；文件 `<path>`（有符号时加 `#<qualifiedName>`，`deleted` 时加 `（已删）`）；
// 目标 `目标 <goalId>`；阶段 `阶段 <stageId>`；任务 `任务 <taskId>`；项目 `项目`。
export type NoteState = 'staged' | 'accepted' | 'reviewed' | 'pending_review' | 'rejected' | 'superseded' | 'withdrawn';
export type NoteSourceV1 =
  | { kind: 'agent'; sessionRef: SessionRef; runRef: RunRef | null; duty: PlatformDutyV1 } // 执行或秘书
  | { kind: 'user'; principalId: string }                                                    // 只经 notes/write
  | { kind: 'platform' };                                                                     // 本片不写，留给第 8 片
export type NoteFactV1 =                       // 指向固定版本（DESIGN §3.3“事实”）
  | Exclude<ContextSourceV1, { kind: 'note' }>  // 记录（计划版本、目录版本、检查轮次、消息…）、产物、原历史区段：沿用已有的形状
  | { kind: 'note'; noteId: string; version: number }
  | { kind: 'file'; path: string; digest: string }
  | { kind: 'commit'; sha: string };
export type NoteReviewReason = 'structural' | 'contradiction' | 'quota_full';
export type NoteBodyV1 = { kind: NoteKind; topic: string; topicKey: string; conclusion: string; body: string;
  sections?: NoteSectionsV1; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; facts: NoteFactV1[];
  basis: { planRevision: number | null; catalogRevision: number | null; files: { path: string; digest: string }[] };
  structural: boolean; replaces: string[]; contradicts: string[];
  coexistWith: string[] };                                   // topicKey 平台算，头和版本各存一份（用户 2026-10-15 第 2 条）；sections 只有 understanding 有（用户 2026-10-15 第 4 条）；并存写入证据：存进头和版本，不是关系记录，不是 O34 关系字段
export type NoteHeadSnapshot = NoteBodyV1 & { ref: NoteHeadRef; noteId: string; version: number; state: NoteState;
  goalId: string | null; source: NoteSourceV1; stagedRunKey: string | null;
  reviewReasons: NoteReviewReason[]; confirmedByUser: boolean;
  anchorKey0: string; anchorKey1: string | null; anchorKey2: string | null; anchorKey3: string | null; anchorKey4: string | null;
  createdAt: string; since: CommitCursor };
export type NoteVersionSnapshot = NoteBodyV1 & { ref: NoteVersionRef; noteId: string; version: number; state: NoteState;
  goalId: string | null; source: NoteSourceV1; reviewReasons: NoteReviewReason[];
  change: { kind: 'write' | 'review' | 'accept' | 'reject' | 'withdraw' | 'supersede' | 'coexist' | 'merge';
            by: NoteSourceV1; reason: string | null; decisionMessageRef: SessionMessageRef | null };
  at: string; since: CommitCursor };
export type CurrentPointerSnapshot = { ref: CurrentPointerRef; anchorKey: string; noteId: string | null; revision: number };

// src/core/work-graph/model/note-contracts.ts（新）
export type NoteErrorCode = 'invalid' | 'forbidden' | 'not_found' | 'revision_conflict' | 'unavailable' | 'unsupported';
// 原因码（`reason` 字段）：replaces_kind_mismatch、anchor_not_found、anchor_out_of_goal、file_exists、deleted_needs_fact、
// same_topic_unresolved、basis_file_missing、basis_file_too_large、symbol_ambiguous、cursor_mismatch、source_stale、
// basis_note_retired、task_definition_changed、module_definition_changed、plan_changed、anchor_ended、
// basis_outside_anchor、file_module_mismatch、deleted_path_unverified、symbol_missing、symbol_signature_changed、anchor_out_of_scope、outside_managed_scope。（用户 2026-10-15 第 1、3、4、6、8、9、10、11 条；后两个审查二 lead 补）
export type NoteAnchorCandidateV1 = { kind: NoteAnchorV1['kind']; id: string; displayName: string };   // 文件候选的 id 是路径（用户 2026-10-15 第 6 条）
export type NoteCommitReceiptV1 = { identityKey: string; fingerprint: string; cursor: CommitCursor };
export type WriteNoteInput = { commandId: string; note: NoteDraftV1; expectedPointerRevision: number | null;
  goalId: string | null };                                            // 来源、目标、执行由调用上下文定；coexistWith 在 note 里；符号和依据由写入方解析（第二轮审查第 3 条）
export type WriteNoteResult =
  | { status: 'accepted' | 'pending_review' | 'staged'; noteId: string; version: number;
      reasons: NoteReviewReason[]; overQuota: boolean; confirmedByUser: boolean;
      warnings: ('symbol_unresolved' | 'anchor_ended')[]; existingTopics: NoteExistingTopicV1[] }                       // 语言不支持是警告，不是错误；任务已结束是警告（第二轮审查第 3 条；用户 2026-10-15 第 6 条）
  | { status: 'rejected'; code: NoteErrorCode; reason: string; draft: WriteNoteInput;
      conflicts?: { noteId: string; version: number; conclusion: string }[];
      symbolCandidates?: { name: string; range: { startLine: number; endLine: number } }[];
      anchorCandidates?: NoteAnchorCandidateV1[]; candidatesUnavailable?: boolean;   // 锚点候选见 L2a（用户 2026-10-15 第 6 条）
      pointer?: { noteId: string | null; revision: number | null } };
export type NoteSimilarV1 = { noteId: string; version: number; header: string; similarity: number };   // header = renderNoteHeader（用户 2026-10-15 第 3 条）
export type NoteExistingTopicV1 = { anchorKey: string; topic: string; count: number };   // 用户 2026-10-15 第 2 条
export type NoteCheckV1 = { noteId: string; version: number;   // 用户 2026-10-15 第 9、10 条
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  retiredExtraAnchors: string[];
  unresolvedFacts: { index: number; reason: 'not_found' | 'version_ahead' | 'kind_mismatch'
    | 'invalid_commit_format' | 'forbidden' | 'unavailable' }[];
  uncheckedFacts: number[];   // commit 指针（只核格式）和因预算没核的事实的下标（L22）
  hints: NoteHintV1[];
  similar?: NoteSimilarV1[] };   // similar 只在 checkNotes 带 withSimilar: true 时给（写侧）（用户 2026-10-15 第 3、9 条）
export type NoteHintV1 = 'basis_outside_anchor' | 'file_module_mismatch' | 'deleted_path_unverified';   // L2a 第 5 类
export interface NoteCheckPort {   // 类型在这里，实现在 views/note-views.ts，组合根注入（notes 不 import views）；只读，不写不存；六个读和写后核对走同一个实现（用户 2026-10-15 第 9 条）
  checkNotes(ctx: CoreCallContext, input: { items: { noteId: string; version: number }[]; withSimilar?: boolean }): Promise<ReadResult<NoteCheckV1[]>>;
}
export type WriteNoteEnvelopeV1 = { write: WriteNoteResult;
  check: NoteCheckV1 | { status: 'unavailable'; reason: string } };   // record_note 和 notes/write（4C）的返回：先 writeNote，成功后 checkNotes({ withSimilar: true })（用户 2026-10-15 第 9 条）
export type NoteDispositionResult =
  | { status: 'done'; noteId: string; version: number; state: NoteState; receipt: NoteCommitReceiptV1 }
  | { status: 'rejected'; code: NoteErrorCode; reason: string; noteId: string;
      pointer?: { noteId: string | null; revision: number | null } };   // 成功回正式提交回执，不是事件引用（第二轮审查第 2 条）
export interface NoteWritePort {
  writeNote(ctx: CoreCallContext, input: WriteNoteInput): Promise<WriteNoteResult>;
  reviewNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number;
    expectedPointerRevision: number | null; verdict: 'review' | 'accept' | 'reject';
    reason: string | null }): Promise<NoteDispositionResult>;   // coexist 只走 applyNoteDecision（第二轮审查第 6 条）
  withdrawNote(ctx: CoreCallContext, input: { commandId: string; noteId: string; expectedVersion: number; reason: string | null }):
    Promise<NoteDispositionResult>;
}
// 出错的码：写/审/撤下都从 NoteErrorCode 取；`invalid`（格式、锚点、关系、同话题、符号歧义、文件过大）、`forbidden`（身份、越出自己目标的锚点）、
// `not_found`（注记不存在；或带锚点的读里锚点不存在且没有头，原因 anchor_not_found）、`revision_conflict`（头版本或指针 CAS）、
// `unavailable`（工作区等）、`unsupported`（只指 FTS5；语言不支持是成功结果里的警告 `symbol_unresolved`，不是错误）。（第二轮审查第 3 条；用户 2026-10-15 第 8、9 条）
// 事实按指针在核对里解析，不在写入时“只计数”（用户 2026-10-15 第 9 条）。
// 你的写入从不为额度退回：`status` 是 accepted，结果里 `overQuota: true`。
export interface NoteReadPort {        // 4A 的最小面；4B 加 L12 的六种
  readNote(ctx: CoreCallContext, input: { noteId: string; version?: number }): Promise<ReadResult<NoteItemV1>>;
  listByAnchor(ctx: CoreCallContext, input: { anchor: NoteAnchorV1; limit: number; cursor: string | null }):
    Promise<ReadResult<NotePageV1>>;
}
export interface NoteMemoryReadPort {  // 4B
  memoryLookup(ctx: CoreCallContext, input: MemoryLookupRequest): Promise<ReadResult<MemoryLookupResultV1>>;
  memoryNeighbors(ctx: CoreCallContext, input: MemoryNeighborsRequest): Promise<ReadResult<MemoryResultV1>>;
  memoryHistory(ctx: CoreCallContext, input: MemoryHistoryRequest): Promise<ReadResult<MemoryHistoryResultV1>>;
  memoryConflicts(ctx: CoreCallContext, input: MemoryConflictsRequest): Promise<ReadResult<MemoryResultV1>>;
  memoryFind(ctx: CoreCallContext, input: MemoryFindRequest): Promise<ReadResult<MemoryResultV1>>;
  memoryStale(ctx: CoreCallContext, input: MemoryStaleRequest): Promise<ReadResult<MemoryResultV1>>;
}
export type MemoryLookupRequest = { v: 1; op: 'lookup'; anchor: NoteAnchorV1;
  body?: { noteId: string; version?: number; cursor: string | null }; limit: number; cursor: string | null };
export type MemoryNeighborsRequest = { v: 1; op: 'neighbors'; noteId: string; version?: number; limit: number; cursor: string | null };
export type MemoryHistoryRequest = { v: 1; op: 'history'; noteId: string;
  body?: { noteId: string; version?: number; cursor: string | null }; limit: number; cursor: string | null };
export type MemoryConflictsRequest = { v: 1; op: 'conflicts'; noteId?: string; anchor?: NoteAnchorV1; limit: number; cursor: string | null };
export type MemoryFindRequest = { v: 1; op: 'find'; terms?: string[]; match?: 'any' | 'all'; anchor?: NoteAnchorV1; pathPrefix?: string;
  kind?: NoteKind | 'general'; topic?: string; state?: NoteState; limit: number; cursor: string | null };   // match 默认 'any'；kind 给 'general' 指六个一般种类；topic 按 topicKey 比（用户 2026-10-15 第 1、2、3 条）
export type MemoryStaleRequest = { v: 1; op: 'stale'; goalId?: string; anchor?: NoteAnchorV1; limit: number; cursor: string | null };
export type NoteFileOutcome = 'same' | 'changed' | 'deleted' | 'forbidden' | 'capacity' | 'unavailable' | 'unchecked';
export type NoteFileObservationV1 = { path: string; digest: string | null; outcome: NoteFileOutcome };
export type MemoryReadBasis = { recordCursor: string | null; ruleVersion: number;
  observedFiles: NoteFileObservationV1[] };
export type MemoryResultV1 = { readBasis: MemoryReadBasis; items: NoteItemV1[]; warnings: string[];
  next: string | null; complete: boolean; ranking?: 'full' | 'partial';
  coverage: { checkedItems: number; uncheckedItems: number; filesRead: number } };   // ranking 只有 find 有（用户 2026-10-15 第 3 条）
export type UnderstandingStatusV1 = { anchorKey: string;
  pointer: { noteId: string | null; revision: number | null };
  updateDue: boolean; latestTriggerCursor: string | null };   // 目标、阶段锚点都有；没有当前理解也给（第二轮审查第 7 条）
export type MemoryLookupResultV1 = MemoryResultV1 & { understanding: UnderstandingStatusV1 | null;
  topics: { topic: string; count: number }[]; topicsComplete: boolean };   // 这个锚点上当前的各话题（按 topicKey 去重，显示最近写入的写法），最多 MEMORY_TOPICS_MAX（用户 2026-10-15 第 2 条）
export type NoteHistoryItemV1 = NoteItemV1 & { change: NoteVersionSnapshot['change']; since: CommitCursor };
export type MemoryHistoryResultV1 = Omit<MemoryResultV1, 'items'> & { items: NoteHistoryItemV1[] };
export type NoteItemV1 = { noteId: string; version: number; storedState: NoteState; kind: NoteKind; topic: string;
  topicKey: string; conclusion: string; anchor: NoteAnchorV1; extraAnchors: NoteAnchorV1[]; source: NoteSourceV1; goalId: string | null;
  replaces: string[]; contradicts: string[]; coexistWith: string[]; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked'; changedFiles: { path: string; deleted: boolean }[];
  observedFiles: NoteFileObservationV1[]; staleReasons: string[];
  sourceUnavailable: boolean; invalid: boolean; conflicting: boolean; overQuota: boolean; updateDue: boolean | null;
  currentEligible: boolean; crossGoal: boolean;
  anchorStatus: 'live' | 'retired';
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted' | 'task_ended'
    | 'stage_not_in_current_plan' | 'symbol_missing')[];
  retiredExtraAnchors: string[];
  unresolvedFacts: NoteCheckV1['unresolvedFacts']; uncheckedFacts: number[]; hints: NoteHintV1[];   // 同 NoteCheckV1，经 NoteCheckPort 算（L22）
  matchedTerms: string[]; score: number;                       // find 才填，别的读给 [] 和 0（用户 2026-10-15 第 3 条）
  sections?: NoteSectionsV1;                                   // understanding 才有（用户 2026-10-15 第 4 条）
  body?: { text: string; next: string | null } };   // 结构化的文件观测（第二轮审查第 5 条）；锚点状态见 L23（用户 2026-10-15 第 10 条）

// src/contracts/graph-context.ts（4C 加；注记行不用 ContextIndexRowV1）
export type NoteIndexRowV1 = { anchorKey: string; noteId: string; version: number; kind: NoteKind;
  conclusion: string; freshness: 'fresh' | 'stale' | 'unchecked'; label: string };   // label = renderNoteHeader(...)（用户 2026-10-15 第 1 条）

// src/core/work-graph/model/decision-contracts.ts（4C 加）
export type NoteDecisionCardV1 = { cardId: string; source: 'note_review'; noteId: string; version: number; kind: NoteKind;
  optionIds: ('accept' | 'reject' | 'supersede' | 'coexist')[]; summary: string;   // summary = renderNoteHeader(...)（用户 2026-10-15 第 1 条）
  pointer: { noteId: string | null; revision: number | null } | null };   // 理解卡带当前指针（第二轮审查第 2 条）
export interface NoteDecisionSourcePort {   // notes 实现；组合根注入 communication，communication 不 import notes
  readNoteDecisions(ctx: CoreCallContext): Promise<readonly NoteDecisionCardV1[]>;
  applyNoteDecision(ctx: CoreCallContext, input: { commandId: string; cardId: string;
    optionId: 'accept' | 'reject' | 'supersede' | 'coexist';
    pin: { noteId: string; version: number }; expectedPointerRevision: number | null;
    answerMessageRef: SessionMessageRef; conditions: string | null }): Promise<NoteDispositionResult>;   // 第二轮审查第 2 条
}

// src/core/record-store/lookup-ports.ts（4B 加）
export type TextSearchRequest = { index: string; values: readonly string[]; terms: readonly string[];
  limit: number; after?: string };
export type TextSearchPage = { records: EncodedRecord[]; next: string | null; complete: boolean;
  readThrough: CommitCursor | null };
export interface RecordTextSearchPort {
  searchText(request: TextSearchRequest): Promise<StoreResult<TextSearchPage>>;
}
// 登记：RecordLookupRegistry 的条目加 `text: { paths: string[] }`（只对全文索引）。
// 规范化纯函数 normalizeSearchText（`topic\nconclusion\nbody` → NFC + ASCII 小写，按码点迭代）和 bigramWindows
// （所有互相重叠、不含空白的两个码点窗口，编成 `b<hex1>_<hex2>`）导出给两个后端共用。

// 常量（初值没实测，DESIGN §9.3；都可注入）
export const NOTE_CONCLUSION_MAX_CODEPOINTS = 200;
export const NOTE_BODY_MAX_BYTES = 3072;
export const UNDERSTANDING_BODY_MAX_BYTES = 6144;
export const NOTE_FACTS_MAX = 16;
export const NOTE_BASIS_FILES_MAX = 32;
export const NOTE_BASIS_FILE_MAX_BYTES = 1024 * 1024;       // 1 MiB；可注入，从不超过工作区配置的上限（第二轮审查第 4 条）
export const NOTE_SYMBOL_HITS_MAX = 200;                    // 符号命中翻页上限（第二轮审查第 3 条）
export const NOTE_EXTRA_ANCHORS_MAX = 4;
export const NOTE_ANCHOR_QUOTA = 5;
export const NOTE_GOAL_QUOTA = 200;
export const NOTE_READ_FILES_MAX = 256;
export const MEMORY_PAGE_DEFAULT = 20, MEMORY_PAGE_MAX = 100, MEMORY_RESULT_MAX_BYTES = 48 * 1024;
export const NOTE_BODY_PAGE_BYTES = 2048, NOTE_BODY_PAGE_MAX_BYTES = 4096;
export const TEXT_SEARCH_MAX_TERMS = 8, TEXT_SEARCH_CANDIDATE_MAX = 1000;
export const NOTE_TEXT_TERM_MIN = 2, NOTE_TEXT_TERM_MAX = 64;
export const NOTE_EXISTING_TOPICS_MAX = 20;                 // 初值没实测、可注入（用户 2026-10-15 第 2 条）
export const MEMORY_TOPICS_MAX = 50;                        // 初值没实测、可注入（用户 2026-10-15 第 2 条）
export const NOTE_RANK_WEIGHT_TOPIC = 3, NOTE_RANK_WEIGHT_CONCLUSION = 2, NOTE_RANK_WEIGHT_BODY = 1;   // 初值没实测、可注入（用户 2026-10-15 第 3 条）
export const NOTE_SIMILAR_MAX = 3, NOTE_SIMILAR_MIN = 0.3;  // 初值没实测、可注入（用户 2026-10-15 第 3 条）
export const NOTE_ANCHOR_CANDIDATES_MAX = 5;                // 初值没实测、可注入（用户 2026-10-15 第 6 条）
export const NOTE_ANCHOR_CANDIDATE_SCAN = 2000;             // 初值没实测、可注入（用户 2026-10-15 第 6 条）
export const NOTE_SYMBOL_RECHECK_MAX = 20;                  // 初值没实测、可注入（用户 2026-10-15 第 10 条）
export const NOTE_READ_FACTS_MAX = 256;                    // 初值没实测、可注入（用户 2026-10-15 第 9 条）
export const SCRIBE_PENDING_THRESHOLD = 10, SCRIBE_UPDATE_DUE_THRESHOLD = 5;
// 写信封：每次写都带 `commandId`，提交走存储的幂等提交（同 WorkGraph 别的写）；重放原样回原回执。
```

```ts
// 路由（4C；CORE_ROUTE_SPECS 新增，拥有者 notes 在组合根里不可枚举）
'notes/list':      { kind: 'plain', binding: 'listNotes',      owner: 'notes.listNotes' },
'notes/write':     { kind: 'plain', binding: 'writeNote',      owner: 'notes.writeNote' },      // 只认人
'notes/withdraw':  { kind: 'plain', binding: 'withdrawNote',   owner: 'notes.withdrawNote' },   // 只认人
'notes/review':    { kind: 'plain', binding: 'reviewNote',     owner: 'notes.reviewNote' },     // 只认人
'plans/versions':  { kind: 'plain', binding: 'listPlanVersions',    owner: 'notes.listPlanVersions' },
'architecture/versions': { kind: 'plain', binding: 'listCatalogVersions', owner: 'notes.listCatalogVersions' },
```

账本事件：`NoteWritten`、`NoteDispositionChanged`、`CurrentPointerMoved`（每次写入、改状态、改指针各一条，和记录同一次提交）。`NoteDispositionChanged` 是一次处置提交的最后一条事件。经 `applyNoteDecision` 的处置，它带 `acknowledgementRef`（你答复的消息），用作决定答复的证明（L17）；书记或你直接审、撤下的普通处置，`acknowledgementRef` 为 null，不能当决定落实的证明；两种都回正式回执（快速核对第 2 条）。`commandId` 幂等键随记录保存，重放回原回执（N-12）。（第一轮审查第 9、13 条；第二轮审查第 2 条）

## 3. 状态行（写进 STATE-MACHINES-SPEC，新一节 S4-NOTE）

| 行 | 从 | 到 | 谁 | 条件 |
| --- | --- | --- | --- | --- |
| S4-NOTE-01 | （无） | `accepted` | agent、书记、秘书、你 | L4 全过；不结构、不矛盾、额度的**投影计数**没满。你写的不看后两条，直接收下并在结果里报 `overQuota`（第一轮审查第 4 条） |
| S4-NOTE-02 | （无） | `pending_review` | agent、书记、秘书 | 结构性、点了 `contradicts`，或额度满（L7）；`reviewReasons` 记下命中的原因（第一轮审查第 2 条） |
| S4-NOTE-03 | （无） | `staged` | agent、书记 | `kind: 'repair'`；额度满时也留下，读时报 `overQuota`（第一轮审查第 4 条） |
| S4-NOTE-04 | `accepted` | `reviewed` | 书记（限自己负责范围）、你 | 你审的 `confirmedByUser` 为 true；审不重置 L9 的 `updateDue`（第一轮审查第 12 条；决定 60-9） |
| S4-NOTE-05 | `pending_review` | `accepted` | 你（有 `structural`/`contradiction` 的）；书记（限自己负责范围）或你（只剩 `quota_full` 的） | 收下的那次提交照 L6 取代 `replaces` 里的现行项；矛盾卡选 `supersede` 时先在这次提交里写一条新版本（`replaces` 加上解析出的目标、`contradicts` 去掉它们）再取代；是当前理解时同一次提交挪指针，用当时读到的 `expectedPointerRevision`，对不上 → `revision_conflict`。收下后还剩 `quota_full` 不回到待审，保持 `accepted` 并报 `overQuota`（第一轮审查第 2、3、4 条；第二轮审查第 1、2 条；决定 60-9） |
| S4-NOTE-06 | `pending_review` | `rejected` | 同 S4-NOTE-05 的收下权 | 要原因；书记不能拒有 `structural`/`contradiction` 的（`forbidden`） |
| S4-NOTE-07 | `staged`、`accepted`、`reviewed`、`pending_review` | `withdrawn` | 作者、书记、你 | — |
| S4-NOTE-08 | `accepted`、`reviewed` | `superseded` | 写入方（取代它的新项生效的那次提交） | 只在 S4-NOTE-01、05 的同一次提交里；有 `coexistWith` 指向它的不取代 |
| S4-NOTE-09 | `staged` | `accepted` | 第 8 片 | 不在本片 |
| S4-NOTE-10 | `pending_review` | `accepted` | 你（矛盾卡选“并存”） | 同一次提交写新版本：`contradicts` 去掉那一条、`coexistWith` 加上它，`change.reason` 记适用条件，并写指向答复消息的事实；旧版本保留原 `contradicts`（第一轮审查第 1 条） |

`rejected`、`withdrawn`、`superseded` 是终态。已审项不能到 `rejected`（DESIGN §3.6）。每一行的头版本号加 1，并在该头的 `expectedVersion` 守卫下写回；对不上 → `revision_conflict`、什么都不写（第一轮审查第 3 条）。

## 4. 规则

1. 记忆从不改任务、执行、目标的状态，也不授予任何工具或路径（DESIGN §3.1）。
2. 拒绝不写任何记录，回执带回草稿；“没有”和“没读全”分开报。
3. 只读的读取从不写。
4. 来源由平台定；用户来源只经 `notes/write`、只认人。
5. 同样的请求、权限、记录依据、文件观测和规则版本，得到同样的结果和顺序（含 `find` 的排序）；不调模型。（用户 2026-10-15 第 3 条）
6. 两个后端对同一组数据的全文结果相同（含 `'any'` 的排序）。（用户 2026-10-15 第 3 条）
7. 每次写带 `commandId`，经存储的幂等提交；重放原样回原回执（第一轮审查第 13 条）。
8. 每次改文字或状态都把头的版本号加 1，并在该头的 `expectedVersion` 守卫下写回；指针改动用 `expectedPointerRevision` 守卫；对不上 → `revision_conflict`、什么都不写（第一轮审查第 3 条）。
9. `coexistWith`、`reviewReasons` 按 L1 存成头和版本的写入证据；`confirmedByUser` 只在头上（版本用 `change.by` 保留是谁做的）；它们不是独立的关系记录（第一轮审查第 1、2 条；第二轮审查第 8 条）。
10. 额度准入用投影计数（当前数减这次会取代的条目）；目标活动算 `accepted`、`reviewed`、`pending_review`、`staged`；目标为 `null` 的项目级注记只算锚点额度（第一轮审查第 4 条）。
11. 全文 `match:'all'` 时每个词都被比较文字包含（AND）；`'any'` 时至少一个词命中、按 L10 算分排序；SQLite 候选必须是全部子串匹配的超集，读出后按子串规则核对；两个后端结果和排序相同（第一轮审查第 5 条；用户 2026-10-15 第 3 条）。
12. 新鲜度按依据注记的**头**状态、和任务/模块定义的规范 JSON 比较；方案采用单独报 `plan_changed`，和 `updateDue` 分开（第一轮审查第 6 条）。
13. 工作区观测读当前工作树（不是某个提交）、`maxBytes = NOTE_BASIS_FILE_MAX_BYTES = 1 MiB`（可注入，从不超过工作区配置上限）；缺失/禁止/容量/不可用按 L11 的映射；文件大于上限时写退回 `invalid`、`basis_file_too_large`，读报 `unchecked`、原因 `capacity`；一次读最多 256 个不同文件，超出 `unchecked`（第一轮审查第 7 条；第二轮审查第 4 条）。
14. 写输入的文件锚点给 `symbolRequest: { language, name, range? }`；平台建工作区捕获、用工作区源码查询翻页取命中（最多 200），按名字（带范围时也按范围）筛，`signatureDigest` 从捕获内容里取；多条命中 `symbol_ambiguous`，没命中或语言不支持只存文件锚点并在成功结果里回警告 `symbol_unresolved`（第一轮审查第 8 条；第二轮审查第 3 条）。
15. 决定落实的证明是提交的最后一条 `NoteDispositionChanged`（取代用新注记被收下的那条事件），事件带 `acknowledgementRef` = 答复消息；应用返回这次提交的正式回执（identity、fingerprint、cursor）；`decision-application.ts` 照第 5 片的读法认回执和 `acknowledgementRef`（第一轮审查第 9 条；第二轮审查第 2 条）。
16. 注记决定源经 `NoteDecisionSourcePort` 注入 communication；communication 从不 import notes（第一轮审查第 9 条）。
17. 注记行用 `NoteIndexRowV1`（`label` 用 `renderNoteHeader` 渲染）；装配记录只记**实际渲染**的行，放不下的进省略行（第一轮审查第 11 条；用户 2026-10-15 第 1 条）。
18. `record_note` 按 `op` 严格分三支；审只有书记，撤下作者或书记；执行者和参谋只动自己的注记（第一轮审查第 10 条）。
19. 目标、阶段锚点都有 `UnderstandingStatusV1`（没有当前理解也给 `pointer.noteId: null`）；提醒和心跳用它，按 `(anchorKey, latestTriggerCursor, ownerSessionKey)` 去重（`ownerSessionKey` 不是新字段，是发提醒时按 L35/L23 算出的负责书记线的键）（第二轮审查第 7 条）。
20. 读结果按操作分型：`lookup` 带 `understanding`、`history` 项带 `change`/`since`；`lookup`/`history` 的 `body` 按页读一条正文；`changedFiles` 和每项 `observedFiles` 是结构化的（第二轮审查第 5 条）。
21. 话题按 `topicKey` 比：NFC、ASCII 字母变小写、每段 Unicode `White_Space` 折成一个 U+0020、去首尾；平台算，头和每个版本各存一份；写入的话题原文照旧显示；`topicKey` 为空 → `invalid`；长度规则（1–40 个码点、不含换行）仍管写入的话题。同话题准入（L4 第 4 条）、L9 的同话题 `conflicting`、`find` 的 `topic` 筛选都比 `topicKey`。（用户 2026-10-15 第 2 条）
22. `replaces` 可以跨六个一般注记，一般注记和 `understanding`/`repair` 之间不能互相 `replaces`（`replaces_kind_mismatch`）；`find` 的 `kind` 可给 `'general'`（用户 2026-10-15 第 1 条）。
23. 锚点问题按 L2a 的七类判：写入前只跑第 1–3 类；第 4 类收下并警告 `anchor_ended`；第 5 类只在写后核对里提示；第 6 类平台不判；第 7 类在读时算 `retired` 和原因（用户 2026-10-15 第 6、10 条）。
24. 写后核对走 `NoteCheckPort`，六个读也走它；事实在核对里解析，`commit` 只看格式、永远 `unchecked`；核对失败不撤销写入（用户 2026-10-15 第 9 条）。
25. 头部一行由 `renderNoteHeader` 从字段渲染，模型从不写这个串；`NoteIndexRowV1.label`、列表行、`notes/list`、决定卡的 `summary`、相近注记提示都用它（用户 2026-10-15 第 1 条）。
26. `find_graph` 的名字、路径、说明匹配两边都 NFC + ASCII 小写；路径查询按相等、最长前缀归属（目录边界）、或位于查询目录之下来判；参数和返回形状不变（用户 2026-10-15 第 11 条）。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 2A、2B、2C §5：用 `.dsh-ref/tdd/` 的 TDD skill；在确认过的入口上先写失败的测试、再写刚好通过的实现；不读数据库核对；期望值来自规格或手算的例子；测试名以行号开头；服务级的例子两个后端各跑一遍。

### 5.1 测试入口（已确认 NE1–NE7，2026-10-15）（用户 2026-10-15 第 12 条）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| NE1 | **注记的写入和读取（4A）。** 公开的 `NoteWritePort`、`NoteReadPort`，两个后端；目标、计划、任务、Session、执行都经真实服务造，agent 来源用真实执行的调用上下文 | 格式和上限（含依据文件过大 → `basis_file_too_large`）、锚点、来源和谁能写、额度、同话题、共享锚点、状态迁移、取代（含矛盾卡 `supersede`）和撤下同次提交、当前理解的版本核对和竞写、历史版本、重放、八种种类和 `replaces_kind_mismatch`、`topicKey` 和 `existingTopics`、当前理解的五段和渲染正文、锚点七类里写入前判的第 1–4 类、阶段锚点由平台填版本、**按范围的现行注记数（L7，按注记身份去重）和书记范围事实**（第二轮审查第 1、4 条；用户 2026-10-15 第 1、2、4、6、7、9 条） | 工具注册、装配出来的文字 |
| NE2 | **全文端口（4B）。** RecordStore 公开的 `searchText`，两个后端各一份；登记一个测试用的全文索引 | 中文子串、`urn` 命中 `readTurnBounds`（没有驼峰/整词规则）、大小写、与的语义、窗口候选是全部匹配的超集、核对掉片段误中、1 个码点或 65 个码点被拒、续读、写改删以后的结果、重开和重建、FTS5 不可用报 `unsupported`、`'any'` 时候选是全部匹配的超集（用户 2026-10-15 第 3 条） | 权限和现行结论（NE3 管） |
| NE3 | **六种读法和新鲜度（4B）。** 公开的 `NoteMemoryReadPort`，真实的工作区工具和临时工作区里的文件；真实服务造计划、目录改动 | 文件改了或删了 → 需复查并列出、定义按规范 JSON 比、方案采用 `plan_changed`、256 文件预算、依据注记退役、来源不可用、作废、同话题冲突（含并发漏过的）、现行结论的过滤、跨目标标记和顺序、分页和续读游标、跨页变化、空页 `complete: false`、`'any'` 的算分排序和部分排序、相近注记、写后核对、锚点状态（`retired`，含符号）、`not_found` 对空（用户 2026-10-15 第 3、8、9、10 条） | 模型怎么用这些结果 |
| NE4 | **“看”“找”的记忆分支和“记”（4C）。** 平台模式：真实 Runtime、真实冻结 Kernel、脚本模型；工具经真实注册调用 | 记忆分支的严格 union 和先按 `memory` 分派、原图分支逐字不变、可信身份不能被参数冒充、“记”的三支 `op` 和回执（`write` 用 `NoteDraftV1`/`symbolRequest`；`review` 的三档 verdict；处置回 `NoteDispositionResult`）、符号解析（建捕获、翻页取命中、唯一命中、`symbol_ambiguous`、`symbol_unresolved` 是成功警告）、书记审/撤下、执行者和参谋只动自己的、只读副本没有“记”、`write` 回 `{ write, check }`、`find_graph` 的不区分大小写和路径前缀匹配（第二轮审查第 3、6 条；用户 2026-10-15 第 9、11 条） | 真实模型 |
| NE5 | **装配（4C）。** 公开的执行准备 `createExecutionPreparation.prepare`，数据经 NE1 的服务写 | Goal 卡只有当前理解、预算区去重、结论行和警示行二选一、放不下进省略行、装配记录只记实际渲染的行、重放不重拼、Query 只放当前理解、**任务所属模块的上级模块上的区域参谋约定注记也算（containment，8B 以后；仍守 `currentEligible` 和跨目标可见性）** | 模型是否照着记忆做 |
| NE6 | **决定队列的注记卡和书记提醒（4C）。** 公开的决定队列、答复、落实；主机场景框架（真实 Host、注入时钟）看心跳 | 卡出来、选项 id 和钉子、答复以后落实（收下、取代、并存、拒绝；`supersede` 写新版本）、`NoteDispositionChanged` 证明事件带 `acknowledgementRef`、应用返回正式回执、钉住的版本过期报 `source_stale`、书记结果进请知悉、两个计数和阈值、**按 L5 的最窄范围找书记（`resolveResponsibleLine`；那个范围没有书记由项目范围书记管）**、按范围的计数（L7）、按 (锚点键, 触发游标, 负责线) 去重（第二轮审查第 1、2 条） | 书记的语义判断 |
| NE7 | **路由和节点详情（4C）。** HTTP 路由（`CORE_ROUTE_SPECS` 的六个）背后是真实的读写；2C 的 `readNodeDetail` | 只认人、你写的是用户来源、版本列表、节点详情里注记和异常锚点并列、“看”下钻到同一个读取、`notes/write` 返回 `{ write, check }`（用户 2026-10-15 第 9 条） | 界面怎么画 |

### 5.2 验收行为（第一稿，冻结时逐条补全期望值；2026-10-15 按你的意见补了手算行）（用户 2026-10-15 第 12 条）

**4A（NE1）**
- N-01 格式和上限：结论 200 个码点收下、201 个退回；正文 3,072 字节收下、3,073 退回；当前理解 6,144 / 6,145；事实 16 / 17；依据文件 32 / 33；附加锚点 4 / 5；依据文件大于 1 MiB → `invalid`、`basis_file_too_large`；退回都带原样的草稿，没有任何记录（经 `listByAnchor` 看）。（第二轮审查第 4 条）
- N-02 锚点：模块、接口、文件、目标、阶段、任务、项目各一条收下；不存在的模块、越界的路径、别的计划的阶段编号退回；当前理解挂在任务上退回。
- N-03 来源：agent 写的是 agent 来源，参数里自报“用户”无效；你经路由写的是用户来源；只读副本写被拒 `forbidden`。
- N-04 同话题准入：现行项同话题、新项在 `contradicts` 里点了它 → 新项 `pending_review`、原因 `contradiction`（不是 `same_topic_unresolved`）；在 `replaces` 里点了它 → 新项收下、旧项 `superseded`（同一次提交：读旧项的历史，最后一版的提交游标和新项的相同）；在 `coexistWith` 里点了它 → 收下，两条都现行，`coexistWith` 进头和这一版；都没写 → 退回 `invalid`、`same_topic_unresolved`，带那条的编号和版本。已拒绝、已撤下、已取代的不挡。（第一轮审查第 1 条）
- N-05 共享锚点：`replaces`、`contradicts` 指向没有共同锚点的注记 → 退回；把那个锚点加进附加锚点以后收下。
- N-06 结构性和矛盾进待审，不提前取代：点了 `contradicts` 的新项 `pending_review`、`contradicts` 指着旧项，旧项仍现行；你在矛盾卡选 `supersede` 以后（S4-NOTE-05），新项写一条新版本（`replaces` 加上旧项、`contradicts` 去掉旧项）并被收下，旧项在同一次提交变 `superseded`。（第二轮审查第 1 条）
- N-07 额度：一个锚点第 6 条现行项进 `pending_review`、原因 `quota_full`；已审项也算目标活动；被这次取代掉的现行项从**投影计数**里扣掉，所以已满 5 条时第 6 条取代其中一条仍收下；额度满时修补保持 `staged` 并报 `overQuota`；你的写入不因额度进待审，回执 `accepted` + `overQuota`；两个调用者同时写第 5、6 条（夹具在存储边界让两次提交交错）→ 都收下，读的时候 `overQuota`。（第一轮审查第 4 条）
- N-08 当前理解竞写：两个 agent 都读到指针版本 r；先提交的收下、指针改指它；后提交的 `revision_conflict`，带回草稿和现在的指针；它重读、带新版本再写 → 收下，前一条 `superseded`。收下待审的当前理解时 `expectedPointerRevision` 对不上 → `revision_conflict`、什么都不写。（第一轮审查第 3 条）
- N-09 撤下：当前理解被撤下 → 读的时候“当前理解不可用”，不回到旧版；作者、书记、你能撤，别的 agent `forbidden`。
- N-10 审：书记把 `accepted` 审成 `reviewed`（`confirmedByUser` 不变）；已审项不能审成拒绝；只有 `quota_full` 的待审书记能收或拒，有 `structural`/`contradiction` 的书记不能收（`forbidden`）；你收下带 `quota_full` 的结构性项后它保持 `accepted`、报 `overQuota`，不回待审。**书记只审归它管的条目（L5），审范围外的 `forbidden`、原因 `outside_managed_scope`；你审任何条目都可以**（决定 60-9）。**书记范围夹具**（N-21、N-22、G-01、D-03 共用）：模块 `R`（path `.`）包含 `A`（`src/a`）和 `B`（`src/b`），`A` 包含 `A1`（`src/a/one`）；书记 `S0` 负责项目、`SA` 负责区域 `A`、`SA1` 负责区域 `A1`、`SG` 负责目标 `g1`，`B` 没有区域书记。注记 n1 锚 `src/a/one/x.ts` → 归 `SA1`（`SA` 审它 `forbidden`）；n2 锚模块 `A` 和 `src/a/one/x.ts` → 归 `SA`（`SA1` 审它 `forbidden`）；n3 锚 `src/a/one/x.ts` 和 `src/b/y.ts` → 归 `S0`；n4 锚 `src/b/y.ts` → `B` 没有书记，上到 `S0`；n5 锚 `g1` 的任务 `t1` → 归 `SG`；n6 锚 `t1` 和 `src/a/x.ts` → 模块类和目标类混在一起，归 `S0`；`SA` 写一条 `replaces: [n1]` 的注记 → `forbidden`、`outside_managed_scope`、不写，`SA1` 写同样的 → 收下、n1 `superseded`；`SA1` 完整换手给 `SA1b` → n1 由 `SA1b` 审，`SA1` 审它 `forbidden`；`SA1` 归档（不是换手）→ n1 上到 `SA`。（第一轮审查第 2 条；审查二第 6、19 条；审查二 lead 补）
- N-11 历史：一条注记写、审、撤下三版，按版本号读到三份不同的状态和经过；改文字产生新版本，旧版本不变。
- N-12 重放：同一 `commandId` 的请求重放回原回执，不多写版本。
- N-13 修补：agent 写 `repair` → `staged`，按暂存执行索引能列出；撤下可以；不能经本片收下。
- N-14 同话题竞写：两个调用者在同一个锚点上同时写同话题、都不带关系（夹具在存储边界让两次提交交错）→ 都准入；读的时候两条都 `conflicting`（M-07 引这一条，不引 N-07）。（第一轮审查第 1、13 条）
- N-15 种类和 `replaces_kind_mismatch`：八种各写一条都收下（六个一般种类 `accepted`；`understanding` 挂目标；`repair` `staged`）；`open_question` 被 `decision` 用 `replaces` 点中 → 收下、旧项 `superseded`；`decision` 的 `replaces` 点一条 `understanding` → 退回 `invalid`、`replaces_kind_mismatch`（反向同理）。（用户 2026-10-15 第 1 条）
- N-16 头部渲染（每条一个锚点种类，再一条带 `!`）：`renderNoteHeader` 分别给 `坑(模块 M1)：不要重试`、`约定(接口 M1/I1)：先判空`、`坑(src/a.ts)：会越界`、`坑(src/a.ts#run)：会越界`、`决定(目标 g1)：拆分`、`决定(阶段 s1)：先做读取`、`坑(任务 t1)：接口会变`、`约定(项目)：都用 POSIX 路径`；`structural: true` 的 `决定(任务 t1)!：先冻结接口` 带 `!`。（用户 2026-10-15 第 1 条）
- N-17 `topicKey`：`"  Auth  Flow "` 和 `"auth flow"` 的 `topicKey` 都是 `auth flow`（NFC、ASCII 小写、连续空白折成一个空格、去首尾）；`"认证流程"` 的 `topicKey` 不同；全空白 → `invalid`；41 个码点 → `invalid`；`topic` 原文照旧显示。（用户 2026-10-15 第 2 条）
- N-18 `existingTopics`：`module:M1` 上已有现行注记、话题 `a` 和 `b` 各一条，再写话题 `c` → `write.status` 是 `accepted`，`existingTopics` 是 `[{ anchorKey: 'module:M1', topic: 'a', count: 1 }, { anchorKey: 'module:M1', topic: 'b', count: 1 }]`（按锚点键、`topicKey` 排，最多 20）；再写话题 `a` 且不带关系 → 退回 `same_topic_unresolved`、不写，`existingTopics` 不出。（用户 2026-10-15 第 2 条）
- N-19 当前理解五段：`kind:'understanding'` 带 `sections: { status:'无', decided:'无', open:'无', next:'无', risks:'无' }`、不带 `body` → 收下，存下的 `body` 是 `现状\n无\n\n已定\n无\n\n未决\n无\n\n下一步\n无\n\n风险\n无`，`sections` 也存；`kind:'pitfall'` 带 `sections` → `invalid`；`kind:'understanding'` 带 `body` → `invalid`；某段空串 → `invalid`；渲染 body 6,144 字节收下、6,145 退回；全文能查到渲染 body 里的词。（用户 2026-10-15 第 4 条）
- N-20 锚点七类（写入前）：模块 id 写成名字 → `invalid`、`anchor_not_found`，候选第一条是规范化名字相等的那个模块；一位拼错 → Levenshtein ≤2 的候选进列表，最多 5 条；缺文件 `src/old.ts`、别处有同名 `tests/old.ts` → 文件候选第一条是 `tests/old.ts`；执行者用别的目标的任务锚点 → `forbidden`、`anchor_out_of_goal`（项目范围的书记用同一个可以；区域书记的写入准入见 N-21、N-22）；任务已取消 → 收下、`warnings` 含 `anchor_ended`；`deleted:true` 而路径存在 → `invalid`、`file_exists`，路径不存在但没有事实 → `invalid`、`deleted_needs_fact`，有指向它的 `file` 事实 → 收下；写输入不带阶段 `planRevision`，存下的 `NoteAnchorV1.planRevision` 由平台从这次执行的绑定（你从当前采用的计划版本）填。（用户 2026-10-15 第 6、7 条；审查二第 6 条；审查二第 19 条）
- N-21 区域书记的写入准入（containment 子树）：用 N-10 的夹具，`SA` 写一条挂 `src/a/one/x.ts` 的注记 → 收下（`accepted`；`A1` 在 `A` 的 containment 子树里，另有 `SA1` 也照样能写），这条归 `SA1` 管（`SA` 审它 `forbidden`）；`SA` 写一条挂 `src/a/x.ts` 的 → 收下、归 `SA` 管；containment 不知道时 `SA` 的区域只含 `A` 自己，写挂 `src/a/one/x.ts` 的 → 退回 `forbidden`、`anchor_out_of_scope`、不写。（决定 60-5；7D L23/L35；审查二第 6、19 条；审查二 lead 补）
- N-22 区域书记用区域外的锚点：`SA` 写一条挂 `src/b/y.ts`（模块 `B`，不在 `A` 的 containment 子树里）的注记 → 退回 `forbidden`、原因 `anchor_out_of_scope`（L2a 第 3 类），不写任何记录；`S0` 写同一条 → 收下，归 `S0` 管（`B` 没有区域书记）；`SG` 写挂 `src/a/x.ts` 的 → `forbidden`、`anchor_out_of_scope`（目标书记只用它目标的目标类锚点）。（决定 60-5；7D L23/L35；审查二第 6、19 条；审查二 lead 补）

**4B（NE2、NE3）**
- T-01 中文：“架构图需要重画”能用“架构”“构图”“重画”查到（子串，不是片段相等）；用两个词“架构”“重画”查到；文字 `abXbc`、查询 `abc` 查不到（两个窗口 `ab`、`bc` 都命中、子串不命中，被核对掉）。（第二轮审查第 8 条）
- T-02 英文和标识符：`readTurnBounds` 能用 `urn`、`bounds`、`readturnbounds` 查到；大小写不敏感；`graph-context` 用 `graph-context` 子串查到；没有驼峰或整词规则。（第一轮审查第 5 条）
- T-03 1 个码点的词、65 个码点的词、含空白的词、9 个词被拒 `invalid`。
- T-04 改正文以后旧词查不到、新词查到；撤下的头仍能被全文查到（全文只给候选，现行过滤在 NE3），删头不发生（没有真删）。
- T-05 顺序和续读：结果按 refKey 字节序；每页 2 条翻到底，不重不漏；两个后端逐条相同。
- T-06 重开和重建：SQLite 关掉再开结果不变；用公开的索引登记或重开触发一次重建（不改存储内部表；要造“FTS 表不存在或代号不对”的条件就用允许的存储迁移夹具）→ 重建以后结果相同；模拟 FTS5 不可用 → `unsupported`（保留既定替身）。（审查二第 19 条）
- T-07 `'any'` 排序（手算）：三条注记都在匹配集合里（`U=3`），两个词 `t1`、`t2`。`t1` 在三条里都出现 → `df(t1)=3`、`r(t1)=ln(1+3/3)=ln2=0.6931`；`t2` 在两条里 → `df(t2)=2`、`r(t2)=ln(1+3/2)=ln2.5=0.9163`。n1：`t1` 在 topic（w3）、`t2` 在结论（w2）→ `3×0.6931 + 2×0.9163 = 3.9120`；n2：`t1` 在结论（w2）、`t2` 在正文（w1）→ `2×0.6931 + 1×0.9163 = 2.3026`；n3：只有 `t1` 在正文（w1）→ `0.6931`。顺序 n1、n2、n3；n1 和 n2 的 `matchedTerms` 都是两个词，n3 一个；分和词数都一样时按 `noteId` 升序。（用户 2026-10-15 第 3 条）
- T-08 `'all'` 不变：`match:'all'`、`terms:['auth','flow']` 时，只有两个词都是子串的注记入选，顺序仍按 refKey 字节序，和今天相同。（用户 2026-10-15 第 3 条）
- T-09 部分排序：匹配集合超过 `TEXT_SEARCH_CANDIDATE_MAX = 1000` 个已核对候选 → 返回已核对的、它们之间有序，`complete: false`、`ranking: 'partial'`，警告写明按锚点、路径前缀、种类或加词缩小。（用户 2026-10-15 第 3 条）
- M-01 文件改了：注记依据两个文件，改一个 → `stale`，`changedFiles` 是那一个（`{ path, deleted: false }`）；删一个 → `{ path, deleted: true }`，`observedFiles` 里 `outcome: 'deleted'`。（第二轮审查第 5 条）
- M-02 定义变了：锚定任务的定义在新计划里改了（规范 JSON 不同）、锚定模块在新目录里没了 → `stale`，原因 `task_definition_changed`、`module_definition_changed`；方案采用的 `plan_changed` 单独报。（第一轮审查第 6 条）
- M-03 未核对：一次读要读 257 个不同文件 → 第 256 个以后的条目 `unchecked`，`coverage` 写明；工作区不可用 → `unchecked`。（第一轮审查第 7 条）
- M-04 依据注记退役：依据里引用的注记的**头**被取代（引用版本本身不变）→ `stale`、`basis_note_retired`；只看一层。（第一轮审查第 6 条）
- M-05 来源不可用：事实指针指向的消息读不到 → `sourceUnavailable`，条目还在。
- M-06 作废：暂存的修补所属任务被取消 → `invalid`。
- M-07 冲突：两条互相 `contradicts` 都现行 → 两条 `conflicting`，`conflicts` 列出双方；同话题竞写（N-14）造出的两条现行也各自 `conflicting`。（第一轮审查第 1、13 条）
- M-08 现行过滤：本目标收下的、你确认过的（跨目标）、跨目标已审的（`crossGoal`、排后面）、跨目标只收下的（不出现）、需复查的（不算现行）各一条，`lookup` 的 `currentEligible` 和顺序照 L9。
- M-09 分页和游标：20 条一页翻到底；中间写一条新的 → 下一页 `revision_conflict`；改参数用旧游标 → `cursor_mismatch`；`lookup`/`history` 的 `body: { noteId, version?, cursor }` 按 2 KiB 分页读一条正文、不切坏多字节字；筛选后空页 `complete: false` 有效。（第一轮审查第 7 条；第二轮审查第 5 条）
- M-10 版本列表：三版计划（两版有原因、一版旧的没有）→ 按 `acceptedAt` 倒序、显示修订号、没有的写“没有记下原因”；目录两版同理；`history` 的每项带这一版的 `change`（含 `by`）和 `since`。（第一轮审查第 14 条；第二轮审查第 5 条）
- M-11 工作区观测：写的时候依据文件不存在 → `invalid`、`basis_file_missing`；禁止读或越界 → `invalid`；文件大于 `NOTE_BASIS_FILE_MAX_BYTES`（1 MiB）→ `invalid`、`basis_file_too_large`；工作区工具不可用/容量不够 → `unavailable`、带草稿；读的时候删掉的文件列 `{ path, deleted: true }`，文件大于上限 → `unchecked`、原因 `capacity`，禁止/不可用 → `unchecked`，原因码照种类给，逐项写进 `observedFiles`。（第一轮审查第 7 条；第二轮审查第 4、5 条）
- M-12 该更新：当前理解的最后一版**文字**以后，任务结束、返工、采用新计划、Session 归档、重新分组各造一次 → `UnderstandingStatusV1.updateDue`；只审一次、文字没变 → 不触发；有任务结束但没有当前理解的目标或阶段也算 `updateDue`（`pointer.noteId = null`）；阶段只数本阶段的任务，目标数全部；`lookup` 返回这个状态。（第一轮审查第 12 条；第二轮审查第 7 条）
- M-13 相近注记：新注记的两段拼成 `"auth flow\nuse jwt"`，一条候选 `"auth flow\nuse jwt now"` 的 Jaccard = 10/11 ≈ 0.909 ≥ 0.3 进列表；一条 `"认证流程\n用令牌"` = 0 不进；最多 3 条，并列按 `noteId`；候选只取和新注记共享锚点键的现行项（`accepted`/`reviewed`/`pending_review`），排除自己和已在 `replaces`/`contradicts`/`coexistWith` 点名的；它从不拦写入。（用户 2026-10-15 第 3 条）
- M-14 写后核对：一条合法 `commit`（40 位十六进制）不出现在 `unresolvedFacts`，进 `uncheckedFacts`，这一项仍可当现行结论；一页 257 个事实指针 → 第 257 个进 `uncheckedFacts`、所在那一项 `freshness: 'unchecked'`；3 个字符的 `commit` → `unresolvedFacts` 有它、原因 `invalid_commit_format`；`note` 指针版本大于头 → `version_ahead`；指向不存在的记录 → `not_found`；指针种类和记录种类不同 → `kind_mismatch`；禁止读或工具不可用 → `forbidden`、`unavailable`；`file` 指针当前摘要不同 → `changed`（进 `changedFiles`，不算 unresolved）；消息事实读不到 → `sourceUnavailable`；第 5 类（`basis_outside_anchor`、`file_module_mismatch`、`deleted_path_unverified`）进 `hints`；核对失败不撤销写入、这条不当现行结论、进 `stale` 读。（用户 2026-10-15 第 9 条）
- M-15 锚点状态：模块被删 → `anchorStatus: 'retired'`、`anchorRetiredReasons: ['module_removed']`、`currentEligible: false`、历史照读；任务取消或被替代 → `task_ended`（已满足的任务不算）；文件当前摘要等于存下的 `fileDigest` → 符号 live、不重解，摘要变了但符号找不到 → `symbol_missing`，找到但 `signatureDigest` 不同 → `stale`、原因 `symbol_signature_changed`（不是 retired）；retired 的附加锚点只进 `retiredExtraAnchors`，主锚点 live 时这条仍 live；一页最多重解 20 次并计入 `NOTE_READ_FILES_MAX`，超出 `unchecked`。（用户 2026-10-15 第 10 条）
- M-16 `not_found` 对空：`lookup` 一个不存在的模块 id、没有头 → `not_found`、原因 `anchor_not_found`、带 `anchorCandidates`；一个存在但没有注记的锚点 → `items: []`、`complete: true`；一个已删但还有头的模块 → 返回这些头、标 `retired`。（用户 2026-10-15 第 8 条）

**4C（NE4–NE7）**
- G-01 “记”：执行里的 agent 用 `record_note` 的 `write` 写一条，文件锚点带 `symbolRequest`，回执 `accepted`、`warnings` 空；下一次执行的准备里能看到它的索引行；写入只给依据文件的路径（`basisFiles`），存下的 `basis` 里是平台读的摘要（快速核对第 1 条）；平台建捕获、翻页取符号命中并按名字/范围筛（唯一命中给 `qualifiedName`/`signatureDigest`/`range`/`fileDigest`，多条 `symbol_ambiguous` 带候选，没命中或语言不支持成功并回警告 `symbol_unresolved`）；**区域参谋、开局参谋的探索 Query（`role_exploration`）也注册 `record_note`，按 L2a 的范围准入写注记**（审查二第 11 条）；书记用 `review`（`accepted → reviewed`）、`accept`/`reject`（只剩 `quota_full` 的待审）、`withdraw`，**书记只能审归它管的条目（负责范围按 L5），范围外的直接审它 `forbidden`、原因 `outside_managed_scope`；用 N-10 的书记范围夹具：n1 由 `SA1` 审、`SA` 审它 `forbidden`，n2 由 `SA` 审，n3、n4 由 `S0` 审，换手后由接任者审**（审查二 lead 补）；执行者不能审别人的注记；撤下自己的可以；你始终能审、能改任何条目（不受范围限制）。（第一轮审查第 8、10 条；第二轮审查第 3、6 条；审查二第 6 条；审查二第 11 条；审查二第 19 条）
- G-02 记忆分支：`look_graph` 的 `memory.lookup` 和原图参数一起给 → 拒绝；先按 `memory` 在不在分派、旧校验在分派之后；原图参数的结果和本片以前逐字相同（**除了决定 59/4C 改掉的 `find_graph` 匹配：名字、路径、说明不区分大小写、路径按最长前缀归属，见 G-04；那一部分不逐字相同**）。（第一轮审查第 16 条）
- G-03 只读副本、独立审阅者的工具里没有 `record_note`。
- G-04 图的“找”（改第 3 片）：`find_graph` 用 `needle: 'b'` 现在能命中名字、路径或说明里含 `b`/`B` 的节点（以前区分大小写、`'b'` 为空）；查询 `src` 命中路径 `src/b` 的模块（位于查询目录下）；查询 `src/b/c` 也命中它（`src/b` 是最长前缀归属者，按目录边界）；查询 `src/shared` 不因 `src/b` 命中；参数和返回形状不变。（用户 2026-10-15 第 11 条）
- G-05 写入信封：`record_note` 的 `write` 成功时回 `{ write, check }`；`write` 带 `existingTopics`，`check` 带 `freshness`、`anchorStatus`、`unresolvedFacts`、`uncheckedFacts`、`hints` 和 `similar`。（用户 2026-10-15 第 9 条）
- C-01 装配：目标有当前理解、阶段有当前理解、任务和模块各有两条注记（其中一条同时挂任务和模块）→ Goal 卡两行理解；预算区三条注记（去重）；装配记录里五条注记的版本。**夹具：任务所属模块 M 的上级模块（containment 祖先）上有一条区域参谋的 `convention` 注记 → 8B 以后也进预算区，仍守 `currentEligible` 和跨目标可见性；没有 containment 时不进**（L20）。
- C-02 警示：一条需复查的注记，预算放不下它的警示行 → 结论行和警示行都不放，省略行按 `state/context-input.ts` 的措辞计 1；一条条目不会同时出结论和警示。（第一轮审查第 11 条）
- C-03 重放：执行绑定以后注记被取代，重放准备的输入不变。
- C-04 Query：规划的 Query 只有当前理解，没有一般注记。
- D-01 注记卡：矛盾的新项进“要决定”；选项 id 是 `supersede`/`coexist`/`reject`，理解卡带当前指针（编号、版本）；你选 `supersede` → 应用写一条新版本（`replaces` 加上旧项、`contradicts` 去掉旧项）并收下，旧项在同一次提交 `superseded`、新项 `accepted`，证明事件是提交最后一条 `NoteDispositionChanged`（带 `acknowledgementRef` = 你答复的消息），应用返回这次提交的正式回执；选 `coexist` → 写新版本、`contradicts` 去掉那条、`coexistWith` 加上它、适用条件进 `change.reason`、旧版本保留 `contradicts`，两条都现行；选 `reject` → 新项 `rejected`。（第一轮审查第 1、9 条；第二轮审查第 1、2 条）
- D-02 卡出来以后注记又被撤下 → 落实 `source_stale`。
- D-03 书记提醒：待审达到 10 条 → 心跳带计数、发一次；同一 `(anchorKey, latestTriggerCursor, ownerSessionKey)` 集合不变时不重发，**负责线换了新书记收到还没处理的**；你手动归档、没人在场的目标出现 `updateDue`（`UnderstandingStatusV1`，没有当前理解也算）→ 发。**按 L5 的负责范围找书记（`resolveResponsibleLine(范围, 'scribe')`）：待审提醒和按范围计数按整条注记（含它 `replaces`/`contradicts` 的注记）的负责范围，只有“没有当前理解的 `updateDue`”按那一个目标锚点找。用 N-10 的书记范围夹具：n1 待审 → 发给 `SA1`；n2 → `SA`；n3、n4 → `S0`；`g1` 没有当前理解的 `updateDue` → `SG`；`SA1` 归档后 n1 的提醒发给 `SA`（`ownerSessionKey` 变了，`SA` 收到还没处理的那条）**（审查二 lead 补）（7D L35；每个项目至少有一条书记，7D L38）；计数按范围算（L7）。（第一轮审查第 12 条；第二轮审查第 7 条；审查二第 6 条；审查二第 19 条）
- R-01 路由：`notes/write` 由成员身份调 `forbidden`；你写的读出来是用户来源；同一 `commandId` 重放回原回执；`plans/versions`、`architecture/versions` 原样传出。
- R-02 节点详情（2C 合入后）：任务节点上一条注记、一条异常锚点并列；悬停卡只有条数；“看”下钻读到同样的内容。
- R-03 `notes/write` 返回 `{ write, check }`：成功时 `check` 是 `NoteCheckV1`；核对器不可用时是 `{ status: 'unavailable'; reason }`；`write` 被拒时不写记录，`check` 不假装成功。（用户 2026-10-15 第 9 条）

### 5.3 要改断言的旧测试（冻结时 lead 按合入后的基线核一遍）

- `tests/architecture/state-writes.test.ts`：受保护类型表、解码允许表加注记的几行（同 2C §5.3 的写法）。
- `tests/architecture/production-reach-allowlist.json`：新路由的 Body、Response 类型别名（每个路由两条 `wire-format`）。
- `tests/composition/platform.test.ts` 的公开键：`notes` 不可枚举，不翻转。
- 装配器的测试（`tests/runtime/S3-context-assembler.test.ts` 等）里断言 `notes` 为 `not_implemented` 或把注记放进 Goal 卡的：lead 冻结时逐条列出前后断言。
- 图工具的严格参数测试（`tests/runtime/S3-graph-tools.test.ts`）：参数 schema 是旧图参数和 `{ memory }` 的严格 union，且先按 `memory` 在不在分派、旧校验在分派之后；原有断言不变，DSH 跑一遍确认。（第一轮审查第 16 条）
- **第 3 片图“找”的测试（用户 2026-10-15 第 11 条）：** 匹配规则改了，下面这些要重核期望值：
  - `tests/work-graph/S3-graph-context.test.ts`：GR07（标题就写“find b is empty because matching is case-sensitive”，必改：现在 `b` 会命中含 `b`/`B` 的节点）；GR06（`B` 现在也匹配小写 `b`，会话 `sb` 等会多进来，期望列表要重算）；GR05（路径查询从完整相等改成“相等或最长前缀归属或位于查询目录之下”，`src/shared` 仍相等，跑一遍确认）；GR17（`'b'` 的命中集合会变，但它只断言续读游标和身份，确认即可）。
  - `tests/runtime/S3-graph-tools.test.ts`：GT04 只核对分页和原样转发，匹配规则不经过这里，断言应不变，跑一遍确认。
  - `tests/scenarios/S3-context-and-inputs.test.ts`（sc01-find，`needle: 'A.out'`）和 `tests/scenarios/S3-query-graph.test.ts`（sc02-find，`needle: 'tB'`）：不区分大小写可能扩大命中集合，需按夹具重核。
  - `tests/app/S3-graph-routes.test.ts`（spy 路由，`needle: 'B'`）和 `tests/helpers/WP1-units-fixture.ts`（`findGraph` 替身）不涉匹配，不改。
  - 在 `tests/` 里搜 `findGraph`/`find_graph` 命中的就是上面几个文件；图节点候选的 `presentation.name/paths/summary` 还影响哪些夹具，只看名字我不能断定，施工时 DSH 在真实树上跑一遍，逐条列前后断言。
- 书记权限的旧断言（`record_note` 的 `review` 路径、决定队列的注记卡）：加“范围外的书记审 `forbidden`、你审任何都行”的用例（范围按 L5 的最窄共同范围，没有则由项目范围书记管）；今天只有开局书记、范围整个项目，旧断言应照过，lead 冻结时列前后断言（决定 60-9；7D L35）。
- 书记提醒的旧断言（`attention-observer`、心跳）：加“按 L35/L23 的最窄范围找书记、没有则由项目范围书记管”和“负责线进提醒去重身份 `(anchorKey, latestTriggerCursor, ownerSessionKey)`；`ownerSessionKey` 不是新字段”的用例（L16）。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **4A：** 新 `src/contracts/note.ts`；`src/contracts/ledger.ts`（三种引用）；新 `work-graph/model/note-contracts.ts`、`state/note-machine.ts`、`persistence/note-record-codecs.ts`（两种记录、指针、三种事件、三组索引）、`notes/note-service.ts`（写时按工作树读依据摘要、建捕获解析 `symbolRequest`，注入 `WorkspaceToolsPort`）、新建 `notes/note-read-model.ts`（含按范围的现行注记数，L7）；书记范围事实的写入（L5，给 7D）；`docs/refactor/module-target.json`、`module-dag.md`（lead 写）；组合根登记记录组（只加 4A 自己的）。（第二轮审查第 3、4 条）
- **4B：** `record-store/lookup-ports.ts`、`lookup-index.ts`（`normalizeSearchText`、`bigramWindows`、全文登记）、`in-memory-record-store.ts`、`sqlite-record-store.ts`、`migrations.ts`（FTS 表）；`notes/note-read-model.ts`（4B 扩展：六种读法、新鲜度、符号定位的读侧、`UnderstandingStatusV1`、结构化的 `observedFiles`）；新 `views/note-views.ts`（`sourceUnavailable`、`NoteCheckPort`）；目录修订的排序索引（`architecture/catalog-record-codecs.ts`）；版本列表的读取。RecordStore 的文件改动排在 2C 的计数端口合入以后。（第二轮审查第 5、7 条；用户 2026-10-15 第 9 条）
- **4C：** `agent-runtime/graph-tools.ts`（记忆分支的严格 union）、新 `agent-runtime/note-tool.ts`（`record_note` 三支 `op`、书记按范围审，工具说明见 L14 末项）、`execution-driver.ts`（注册）；`resources/skills/platform-work/content.md`、`resources/skills/platform-adviser/content.md`、`resources/skills/platform-scribe/content.md`、`resources/skills/platform-secretary/content.md`（“注记”一段，L14 末项；秘书那份含 61-5 的完整指引）；`context-assembler.ts`、`src/contracts/graph-context.ts`（`NoteIndexRowV1`）、`views/context-extensions.ts`（分路；区域参谋在上层模块上的约定注记，L20，8B 以后）；`work-graph/model/decision-contracts.ts`（`NoteDecisionSourcePort`）、`communication/decision-source-facts.ts`、`communication/decision-application.ts`（照第 5 片读 `NoteDispositionChanged` 的正式回执和 `acknowledgementRef` 证明）、决定的读和落实（注记卡）；`src/app/attention-observer.ts`、`host.ts`（书记提醒按 `resolveResponsibleLine` 找书记，L16）；`create-platform.ts`、`core-routes.ts`、`core-http-types.ts`、`src/ui/api/routes.ts`；2C 的 `views/node-detail-reader.ts`、`model/work-line-contracts.ts`（注记一栏，排在 2C 以后）。（第二轮审查第 2 条；用户 2026-10-15 第 5 条）
- **文档（lead 写）：** STATE-MACHINES-SPEC 新一节 S4-NOTE；DESIGN §3.3（存法：头和版本；八种注记种类、头部一行、当前理解五段、`find` 的排序）、§3.6（额度是软上限）、§5.1、§9.3（初值）、附录 C（第 5 个索引的物理写法、`topicKey`）；MODEL O34（把 `'note'` 拆成六个一般种类，加 `topicKey`、`sections`）、O34–O37 的接口表示；MEMORY-LOOKUP（排序和 `match`、共现以后再做、状态行）；HANDOFF 决定 59（改决定 49 的“不做相关性排名”）；第 6 片规格 L9（秘书写六个一般种类，不是 `kind: 'note'`）；E3-UI-ITEMS（注记一栏、版本列表、注记卡）；STATUS、能力索引。（用户 2026-10-15 第 1、2、3、4、11、12 条）

## 7. 施工

- **前提：** 4A 现在就能做（只依赖已合入的代码）。4B 在 2B、2C 合入以后（版本列表用 2B 的索引；RecordStore 文件 2C 也改）。4C 在 4A、4B、2C 合入以后。
- **决定 60–62 的接缝：** 本片写书记范围事实（L5）、按范围的现行注记数（L7，按注记身份去重）、按 L5/L23 的最窄范围发提醒（L16）、上层模块的区域参谋约定注记（L20）；实际的书记范围、`SCRIBE_SLOT_NOTE_LIMIT` 拆分、区域 containment 在 7D/8B 跑通。今天只有开局书记、范围整个项目（它就是项目范围书记），本片行为不变。
- **61-5 的秘书指引（L14）：** 4C 写进 `platform-secretary/content.md`（“注记”一段）；这是内容，不是新的行为断言。
- 每小片一个副本、一个新的 DSH Session；施工前 DSH 先通读任务书和规格、报看不懂的地方（决定 56）；任务书带 lead 推荐的分组和“可以调整、写明理由”，以及“子任务没回报完之前不要结束回合”。
- 夹具由 DSH 写（Codex 这一阶段只做只读审查，同 2A、2B、2C 的做法），只经公开服务造数据；例外只有：N-07/N-14 的存储边界交错提交替身、T-06 的 FTS5 不可用模拟、M-03/M-11 的工作区不可用/容量替身、G-01 的符号解析（真实工作区捕获和源码查询）。（第二轮审查第 3 条）
- 规模：lead 验收时在 MEMORY-LOOKUP §1 的基准规模上量一次（20,000 条注记、100,000 个历史版本），只记不断言。
- DSH 只在可用时段跑，重的放 18:00 以后（AGENTS 第 5 条）。

## 8. 不做的事

- 不改执行、任务、目标的任何状态；不授予工具或路径。
- 不做模型参与的查找、近义词、跨语言、向量检索；`find` 只做字面子串、`'any'` 的算分排序和相近注记；词的共现统计等真实注记量过以后再做（§1.2）；不建标签、时间、邻接索引或独立关系记录。（用户 2026-10-15 第 3 条）
- 不把注记变更说成会挡住已绑定的执行（F4）。
- 平台不自动改挂、不猜改名（L23）。（用户 2026-10-15 第 10 条）
- 不做真删；不导出到仓库。
- 不在本片注册秘书的“记”、不做“记下你的话”的界面流程（第 6 片）；不做修补生效（第 8 片）。
- 不在本片接多书记的线：书记范围、按 `resolveResponsibleLine` 找书记、按范围计数、区域祖先的约定注记只把事实和读取写出来，实际行为今天只有开局书记、范围整个项目，多书记的范围和拆分在 7D/8B 跑通（决定 60-5、60-9）。

## 9. 4A 施工和验收中的限定（lead，2026-10-16）

4A 施工两轮、Codex 一次实现审查加一次快速核对、审查意见的逐条核实（lead 委托的子 agent，决定 65）和 lead 的验收里定下的读法，对 4A 和以后的 4B、4C 同等有效；有冲突时以本节为准。逐条的原文在证据目录 `reviews/evidence/orchestration-slice-4A-2026-10-16/` 的说明书里（第 1 轮的 P1–P14、第 2 轮的 R1–R13）。

- **按范围计数（L7）有自己的读口：** `NoteScopeV1 = { kind: 'project' } | { kind: 'region'; moduleId } | { kind: 'goal'; goalId }`，`NoteScopeReadPort.countCurrentNotes(ctx, { scope }) → ReadResult<{ scope; current }>`，数管辖范围正好是它的、`accepted`/`reviewed` 的注记（一条注记只数一次）。没有书记的范围数 0，它的注记归上一级；Session、职责、目录或查找读失败回 `unavailable`，不回 0。这里的“现行”按存下的状态数，不按 L9 的 `currentEligible` 收窄：这个数用来定书记管多少，需复查的注记照样是书记的事，按新鲜度收窄又要为一个计数读文件、没有上界（lead 2026-10-16 在 4B 通读后改定）。
- **组合：** 平台上加不可枚举的 `notes` 持有者（`writeNote`、`reviewNote`、`withdrawNote`、`readNote`、`listByAnchor`、`countCurrentNotes`），4C 的路由接它；Workflow、2C 的线读和注记服务共用同一个职责解析器实例。
- **调用方（L5）**只从可信的调用上下文来：人（host、人的动作）是用户来源；`work_run` 是 agent 来源，目标是这次执行的目标，职责 `reviewer`/`unknown` 拒绝；4A 里 `query_run` 拒绝（秘书和角色探索的来源第 6 片加）。人写“修补”拒绝。注记的作者是来源里的 Session：同一个 Session 的后来的执行可以撤回它；换手的后继不是作者（第 7 片）。
- **收下和取代：** 收下待审的注记要写原因（L6 的“要原因”，收和拒都要；审成已审和撤回不要）。收下那一次提交按 L6 取代 `replaces` 里现行的项；同时出现在 `replaces` 和 `coexistWith` 里的，按 S4-NOTE-08 不取代。只有收下“当前理解”才挪指针，收下一般注记不碰指针；提交时指针版本对不上，回执带回现在的指针 `{ noteId, revision }`（§2 的类型为准，L8 正文说的“结论”不带）。
- **配额（L7）各数各的：** 锚点配额只管一般注记、只数 `accepted`/`reviewed`；目标配额管所有种类、数四种计数状态。准入（哪个配额拦、`reasons`）照 L7 先减掉被替换的现行项来估算；写入回执的 `overQuota`（和重放存下的那份）按这次提交以后的实际情况算：算上新项，只减这次提交真的取代了的项（进待审或暂存的还没取代任何项），所以总和刚写完的 `readNote` 一致。
- **L2a 的先后：** 第一类查整个输入的形状（含重复的锚点），第二类查每个锚点存不存在，第三类才查当前理解能不能挂、是不是自己的目标、书记范围。锚点形状不对：`{ code: 'invalid', reason: 'anchor_invalid: <字段路径>' }`（例如 `anchor_invalid: extraAnchors[1].path`），和第二类的 `anchor_not_found` 分开。
- **读失败：** 查找、指针、范围、职责和目录的读失败一律回 `unavailable`（职责解析被拒或抛错时整个范围计算回 `unavailable`；解析成功、结果是 `unknown` 的照接线包 1 的规则），从不当成空、0 或“没有”，也不据此放行写入。文件锚点读到 `forbidden`：`{ code: 'invalid', reason: 'anchor_forbidden' }`。4A 内部不设读的上限，计数和列表读到底；读不全回 `unavailable`。
- **重放：** 命令身份是（操作、项目、工作区、可信的调用者、commandId）；先查重放、再读会变的状态，原样返回第一次的结果。写入提交里 `NoteWritten` 是最后一个事件并带上成功回执（`overQuota`、`warnings`、`existingTopics`）；读不回这个事件时回 `unavailable`。同一个 commandId 不同请求：`{ code: 'invalid', reason: 'idempotency_conflict' }`。每个事件各有自己的 `eventId`；不是 `staged` 的注记没有 `stagedRunKey`。
- **依据的版本（L14）：** agent 的依据用执行绑定的计划（`RunSnapshot.planRef`）和那份计划的架构基线版本；人用目标现在采用的计划和现在的目录版本；阶段锚点要在绑定的计划和现在的计划里都有，否则 `anchor_not_found`。项目书记写别的目标的锚点，经注记自己的窄读口（`notes/note-anchor-facts.ts`）读那个目标的事实，不放宽计划服务的限制。
- **事实指针：** 写入只查形状（种类、字段类型）；SHA 长度、摘要格式、路径在不在工作区、注记存不存在是 4B 的检查。
- **符号（L14 写入这一半，4A 做）：** 语言只认 `typescript`、`python`、`cpp`，别的当不支持，警告 `symbol_unresolved`；扫到 `NOTE_SYMBOL_HITS_MAX` 还有下一页时不存定位（0 或 1 个命中 → `symbol_unresolved`，2 个以上 → `symbol_ambiguous`）；捕获或查询失败（`unavailable`、`capacity`、`cancelled`、`capture_expired`、`source_stale`）整个写入回 `unavailable`；`unsupported` 只是警告。定位的范围是源码查询给的名字所在的行（冻结的 `typescript-source-query.ts` 给的是 `nameSpan`）；4B 读侧按这个比。测试在 NE1 的 `S4A-note-symbol.test.ts`（`G-01(4A)`），4C 的 G-01 经 `record_note` 再跑一遍。
- **审阅的项目级槽位**存成 `goalId: null`，读时用 null 查（4C 的待审计数也是）；不加字段。
- **允许表**只有一组 `kept-for` 第 4 片的条目：`renderNoteHeader`（N-16 测它，读者是 4B 的 `NoteSimilarV1.header` 和 4C）。`MEMORY_PAGE_DEFAULT` 等 4B 有读者时再加。
- **测试的例外**（§7 以外，验收时接受）：存储边界的提交闸门（N-07、N-14，另用于 N-08 的提交时指针冲突和重放的并发情形），只排先后、不造执行、职责、计划或 Session 的事实；一个只让读失败的替身（存储的 `lookup`、`readMany`，范围事实的 `findSessions`、`readArchitectureRevision`）。书记和执行者都按生产的职责解析器认得出的方式建，不注入职责。
- **留给后面的：** 根目录前缀 `"."` 的书记范围留给 8A（`notes/scribe-scope.ts` 的 `matchingPrefixLength`）；RoleSpec 读失败时职责解析器回 `unknown`（接线包 1 冻结的行为）记为 7D1 的一项；矛盾卡的 `supersede` 一半在 4C；N-13 按暂存的执行列出在第 8 片。

## 10. 4B 施工和验收中的限定（lead，2026-10-16）

4B 施工三轮：DSH 通读后 lead 答复 P1–P14；Codex 一次实现审查、一次快速核对，审查意见由 lead 委托的子 agent 逐条核实（决定 65），lead 裁定 R1–R16 和第 3 轮的两条。下面是定下的读法，对 4B 和以后的 4C 同等有效；和前面各节冲突时以本节为准。原文在证据目录 `reviews/evidence/orchestration-slice-4B-2026-10-16/` 的 `books/`。

- **全文端口只做“与”（P1）：** `searchText` 的结果是每个词都是子串的记录，按 refKey 字节序；`TextSearchRequest`/`TextSearchPage` 照 §2 不加字段。`'any'`、分、`matchedTerms`、`ranking` 都在 `memoryFind` 里算：每个词各查一次端口再合并。T-07、T-09 因此是 NE3 的行。`'all'` 的每一页只调一次端口（从游标里记的最后一个 refKey 往后），返回这一页里筛出来的，不足 `limit` 也行，端口没读完就 `complete: false` 带游标；`'all'` 的结果没有 `ranking` 字段。`'any'` 读到 `TEXT_SEARCH_CANDIDATE_MAX` 条已核对的匹配就停，部分集合是按 refKey 序的前 `cap` 条，两个后端一样。`terms: []` 是 `invalid`。
- **FTS 表（P5、R8）：** 建表、代号、重建放在 `record-store/sqlite-text-search.ts`，`migrations.ts` 不动。代号存在 `next_fts_meta` 表里：登记的摘要、规则版本，以及这张表维护到的账本游标（每次写索引时在同一个事务里更新）。打开时代号或游标不对 → 在一个事务里从头记录重建；读的时候发现落后 → `unavailable`、原因 `index_not_ready`。FTS5 不可用 → `unsupported`；SQLite 后端多一个可选的 `fullTextProbe`，只有 T-06 和 `memoryFind` 的 `unsupported` 一行用它。
- **候选从哪来（P7）：** 有锚点读五个锚点索引；有 `pathPrefix` 读 `NoteHead` 上新加的五个有序索引（`anchorKey0`…`anchorKey4`），按目录边界核对；只有种类、话题、状态时读审查状态索引，范围是项目的各目标加项目级槽位。给了几个条件就都要满足。`pathPrefix` 去掉一个结尾的 `/`；空的 → `invalid`、原因 `path_prefix_empty`。
- **`lookup` 列哪些（R9）：** 这个锚点上 `accepted`、`reviewed`、`pending_review`、`staged` 的头，跨目标的只列 `reviewed` 或你确认过的；不按 `currentEligible` 筛（需复查的照列，`currentEligible: false`），已退役的照列、标 `retired`。`lookup`、`conflicts`、`find` 带锚点时先查锚点在不在。锚点不存在：`NoteMemoryReadResult<T>` 的拒绝带 `anchorCandidates`（最多 `NOTE_ANCHOR_CANDIDATES_MAX` 个），类型在 `model/note-contracts.ts`，`results.ts` 不改。
- **事实（R1）：** 记录指针在记录存在、当前版本 ≥ 指针版本时算解析得了（旧版本读不到，F6），指针版本更大 → `version_ahead`，`SessionMessage` 也一样；不比摘要。`file` 事实的摘要不是 64 位小写十六进制 → 新原因 `invalid_file_digest`；路径在工作区外 → `forbidden`。`artifact` 事实查原始产物存储里有没有（不读正文、不按授权）：没有 → `not_found`。`kernel_history` 事实查 Run 和它的执行历史定位：没有 Run 或没有定位 → `not_found`，位置超出已观察的范围 → `version_ahead`。读失败一律 `unavailable`。只有格式对的 `commit` 留在 `uncheckedFacts` 而不影响现行结论（P6）。
- **一次观察、一份预算（R3）：** `NoteCheckV1` 加 `observedFiles`：这一项读过的每个文件（依据文件、文件锚点含符号重解、`file` 事实）和结果。所有这些共用每页 `NOTE_READ_FILES_MAX` 个不同路径的预算，读口传给核对；读口自己不读文件。`coverage` 数这一页看过的全部候选（含被筛掉的），`filesRead` 数尝试过的不同路径（含 `forbidden`、`capacity`、`unavailable`）。
- **符号（R4）：** 按 `qualifiedName` 重解；存下的范围只用来在同名的几个命中里挑一个，挑不出 → `unchecked`。扫到上限、语言不支持、分析失败或捕获里读不到这个文件 → `unchecked`，不是 `symbol_missing`。`symbol_signature_changed` 照 §9 的名字范围比，公开输入走不到（4A 的已知限制）。
- **任务和阶段锚点（R5）：** 每个锚点按它自己目标的计划判断。阶段锚点从它的 `planRevision` 到当前的每一个已采用的计划版本里都有这个 `stageId` 才算 live；中间删过、后来同名再加的不算。
- **游标（R10）：** 普通游标绑完整的调用身份、整份请求（不含游标）、规则版本常量和记录游标；正文游标绑调用身份、`{ noteId, version }`、规则版本和这条注记的头版本，头变了 → `revision_conflict`（钉了版本的也一样），别的对不上 → `cursor_mismatch`，偏移不在 UTF-8 边界 → `cursor_mismatch`。外层游标只绑正文目标 `{ noteId, version }`，不绑正文游标。
- **历史版本（R11）：** 只有头版本能 `currentEligible: true`（`checkNotes` 本身就这样判）；历史项的存下状态、关系、`confirmedByUser` 取那一版，`conflicting`、`overQuota`、新鲜度和锚点状态按现在算。`history` 先分页再核对。正文挂在 `noteId` 和版本都对的那一项上；正文目标不在这一页（包括被字节上限裁掉）→ 警告 `body_target_not_on_page`。
- **48 KiB（R12）：** 裁到放得下为止，`readBasis.observedFiles` 和 `coverage` 只按返回的项重算；一项单独就超过 → 只返回它，带警告 `result_over_byte_bound`。
- **第 5 类提示（R13）：** 文件归哪个模块照 `mapExecutedFilesToModules` 的最长前缀；根目录 `"."` 在 8A 以前不认领任何文件。`file_module_mismatch` 只看 agent 写的注记，比的是写它的 Run 在它绑定的计划里的任务范围。删除的证明是同路径的 `file` 事实，或 `counted` 的执行活动里列了这个路径（`possible` 不算）；证明用的 `file` 事实结果是“已删”时不算需复查；读失败 → `unavailable`。
- **版本列表（P8、R14、P2）：** `notes.listPlanVersions(ctx, { goalId, limit, cursor })`、`notes.listCatalogVersions(ctx, { limit, cursor })`，每页最多 50（超过 → `invalid`），新的在前。`VersionListPageV1.items[].at` 是 `string | null`：计划给收下时间，目录给 `null`；计划的原因取收下的候选里记的，最初采用的有原因就显示；目录的原因和时间都等 8A 把修订提交和它的事件连上（第 8 片规格后注），现在显示“原因记在目录修订里，第 8 片接上后显示”。
- **挪到 4C 的（P3）：** `updateDue` 和 `latestTriggerCursor`（M-12）：4B 里 `NoteItemV1.updateDue` 一律 `null`，`UnderstandingStatusV1.updateDue` 是 `boolean | null`、4B 给 `null`。触发的来源由 lead 在 4C 的说明书里定（代码里只有返工带提交游标，任务结束、采用计划、Session 归档只有时间，“重新分组”还没有）。
- **平台上的 `notes`（R16）：** 持有者多了六种读、`checkNotes`（L22 的第二个调用点，4C 接 `record_note` 和 `notes/write`）和两个版本列表；`noteLimits` 放宽到核对和读法的常量。写入时依据路径带 `../` → `invalid`、原因 `basis_file_forbidden`（R15，改了 4A 的 `note-service.ts`）。
- **测不到的（验收时接受）：** 删模块（M-15 的 `module_removed`、M-16 的“模块没了但有头”、M-02 的删除一半）：今天的目录修订不让删模块（`catalog-service.ts:671–673`），第 8 片接上以后补测，不放松这道守卫；`counted` 执行活动作删除证明的一例：没有公开的入口造它；消息事实的 `version_ahead`：公开的夹具造不出一条已有的消息，改法 lead 看过代码；M-10“旧版本没有原因”的一半：公开服务造不出来。
- **测试的例外：** §7 的几个替身照旧；T-06 和 `memoryFind` 的 `unsupported` 用 `fullTextProbe`；M-07 的并发一半复用 4A 的交错提交夹具（没改它）；4A 的 `tests/helpers/S4A-note-fixture.ts` 加了一处只转发选项的改动，4A 的测试照过。

## 11. 4C 施工前的补充（lead，2026-10-16；§11.1 用户已定，决定 71）

依据：决定 66–71（HANDOFF 顶部）；lead 委托的五份按代码核过的事实；提速第一轮的说明书（4C 在它合入后施工）；Codex 两次完整审查、一次快速核对（23 条全部改进去）。本节和前面各节冲突时以本节为准；§9、§10 仍然有效。行号是 1e0b1383 的，提速第一轮改写的地方按它的说明书写。

### 11.1 用户定的（决定 71，10-16“按建议”）

1. **“找”按有联系的范围分两段（决定 67 第 1 条）。** 在一个工作 Run 里调“找”、没给锚点或路径前缀时，默认按它自己的任务分段，`related: null` 可以关掉。查询 Run 和你调的“找”默认不分段，要分段就指明一个任务或模块。
2. **“找”默认不给别的目标里只是“已收下”的注记**（项目的当前理解除外，见第 3 条）。和“看一个节点”（第 4 片 §10 R9）、L9 一样，别的目标的注记要书记审过或你确认过才给。要历史时用 `state` 指明哪一种状态。
3. **项目的当前理解（决定 67 第 3 条）。**
   - 谁能写：管项目的书记，和你（经 `notes/write`）。别的 agent 写挂在项目上的普通注记，由书记收进来。
   - 拼上下文时整篇正文带上（不是只带一句结论）；所以它比目标的短（长度见 §11.4）。
   - 你写的版本被书记改写时：直接生效，原版留在历史里。给你的“请知悉”要等第 7 片 D2 有了不挂目标的卡和通知才能发（今天每张卡、每条通知都要挂一个目标）。
4. **“该更新”的触发。**
   - 归档只在它停下了正在跑的任务或等待时才算触发（这时会留下一条返工记录）。归档一个空闲的 Session 不算。
   - 刚采用计划的新目标还没有当前理解时，不算“该更新”；之后该目标里任务结束、返工才算。
5. **矛盾只在涉及你的注记时给你。** 两条 agent 注记互相矛盾，交负责的书记，书记有和你一样的三种处理（取代、并存、拒绝）。被矛盾的一方已经不是现行结论（被取代、撤下、拒绝，或锚点已退役）时不算矛盾。
6. **你的注记受保护。**
   - agent 的注记真要取代你确认过的注记时（列在“并存”里的不算），先进待审，给你一张卡。你的卡一律三个选项：取代（新的收下，你的那条被取代）、并存（新的收下，你的那条照旧现行，记成并存）、拒绝。当前理解除外：它改写得勤，给“请知悉”就够。
   - 书记不能撤下你确认过的注记，只能写一条新的去取代（走上一条）。你和作者本人照旧能撤。
7. **“结构性”的普通注记。** 今天这个标记是写的人自己填的，填了就进你的队列。改成：在它自己的目标里照常收下，标题保留“!”，给你一条“请知悉”；真正的结构改动照旧在提出架构修订时出卡（第 8 片）。
8. **书记的处理结果进“请知悉”的范围。** 只有动了你写的或你确认过的注记才单独列；其余的每个目标折成一行计数。这改了决定 35 · Q23 甲（“书记的结果都进请知悉”）。

### 11.2 有联系的范围（决定 67 第 1 条）

- **请求。** `MemoryFindRequest` 加 `related?: { kind: 'task'; goalId: string; taskId: string } | { kind: 'module'; moduleId: string } | null`。工具 `find_graph` 的记忆分支照样是严格 union，多这一个字段。给了 `anchor` 或 `pathPrefix` 时不分段（已经是按范围找，第一轮 S2.1），这时给 `related` 是 `invalid`、`related_with_scope`。
- **解析（按这个顺序，前一步失败就停）：**

  | 情况 | 怎么解析 | 失败 |
  | --- | --- | --- |
  | 没给，调用方是工作 Run | 当作 `caller_task`：用新的窄端口 `NoteRunTaskResolver.resolve(ctx)`（1 次 `readMany` 读 Run 快照，回 `{ goalId, taskId, planRef }`，只认可信的 `ctx.principal.runRef`），计划用 Run 绑定的 `planRef` | Run 读不到或解码失败 → `unavailable` |
  | 没给，主机或查询 Run | 不分段 | — |
  | `null` | 不分段 | — |
  | 显式任务 | 目标必须在调用方绑定的项目和工作区里，计划用该目标现行的计划（`readGoalPlanWindow`）；任务必须在这个计划里 | 目标或任务不存在 → `not_found`、`related_not_found`；读失败 → `unavailable` |
  | 显式模块 | 现行目录里要有这个模块 | 不存在 → `not_found`、`related_not_found` |

  检查顺序：形状（`invalid`，同 G-02 的严格 union）→ 游标（规则版本、调用方、整个请求的绑定，§10 R10；`cursor_mismatch`）→ 账本游标（两页之间变了是 `revision_conflict`，所以跨页的计划变化先报这个，不会报 `related_not_found`）→ 上表的解析 → 读。解析出的节点规范成 `{ kind: 'task'; goalId; taskId; planRevision } | { kind: 'module'; moduleId; catalogRevision }`，放进结果的 `related.node`。
- **任务 T（目标 g，计划版本 p）的有联系的锚点键：**
  - `task:g/T`、`goal:g`；
  - T 的阶段：`T.stageId`，没有时取 `T.scope.stageId`（goal 范围的任务没有阶段）；版本 r ≤ p、阶段号相同的 `stage:g/r/<stageId>` 都算；
  - T 的模块（`scope.kind === 'module'` 的 `moduleRef`）和这个模块现在的接口（任务本身不声明接口，`plan.ts:33-60`）；
  - T 已结束的 Run 改过的文件：读 T 的 Run（`RUN_BY_TASK_INDEX`）和它们的 RunActivity（1 次批量读）；先 `definite` 后 `possible`，Run 按结束时间从新到旧，同一 Run 内按路径字节序，去重，去掉 `"."`，最多 `FIND_RELATED_FILES_MAX = 32` 个（可注入）。结果的 `related.filesOmitted` 是超出上限没算进的个数。RunActivity 还没写（Run 刚结束或正在跑）→ 这个 Run 不贡献文件，不算失败；`changedFiles` 是 `unknown`（`run-activity.ts:60`）→ 不贡献文件，`related.filesUnknownRuns` 加一；记录损坏 → 整次 `unavailable`；
  - `project`，只算六种普通种类。
- **模块 M：** `module:M`、它的接口、最长前缀归属是 M 的文件（导出 `scribe-scope.ts` 的 `moduleOfAnchor`）、`project`。下级模块等第 8 片 B。
- **分段。** 一条注记的任何一个锚点槽（主锚点和最多 4 个附加锚点）落在上面的集合里，就属于“有联系”。第一段是这些锚点键读出来的注记头再按同一判断筛；第二段是原来的不分段读法去掉所有属于“有联系”的注记（按同一判断，不只是第一段给出来的）。两段不重。种类、话题、状态和 §11.3 的可见判断两段一样用。
- **顺序。** 没有词：两段内各按 `createdAt`、`noteId`。`'all'`：各段按 refKey 字节序。`'any'`：各段各自照 L10 先按 refKey 取至多 1,000 个候选、再在这些候选上算 U、df 和分数、排序；第一段给完就转第二段。
- **结果。** 每项多 `segment: 'related' | 'project'`；结果多 `related: { node, filesOmitted, filesUnknownRuns }` 和 `boundary: { relatedEnded: boolean; projectStartsAt: number | null }`。`projectStartsAt` 是本页从第几项开始是第二段（从 0 数），本页没有第二段的项时是 null；`relatedEnded` 是这一页（裁剪之后）结束时第一段是否已经给完，空页也照这个算。`ranking`：任何一段被截过候选就是 `'partial'`（第一段的截断在第一页就知道；第二段的在翻到它时才知道）；照 L10，部分排序的结果始终 `complete: false`，翻到最后可以是 `next: null` 加缩小范围的警告。不分段时这些新字段都没有，4B 的结果逐字不变。
- **翻页。** `RULE_VERSION` 升到 2（§11.3 同一次）。游标多 `seg`；`after` 的含义各路径照旧。解析出的 `related` 节点绑进请求。一页可以同时有第一段的末尾和第二段的开头。每页重算有联系的集合，账本游标保证两页之间没变。48 KiB 裁剪后从最后一个留下的项接着翻：留下的最后一项在第一段，下一页接着第一段；第一段的项都留下了，下一页才从第二段开头。`boundary` 按留下的项重算。
- **读失败。** 建集合的任何一次读失败，整次查找 `unavailable`（同 §9）。
- **复用。** 新文件 `notes/note-related-scope.ts`：读事实的一段和纯函数的集合构造、判断分开。L20 的装配用同一个纯函数（装配已有的事实加同样的 RunActivity 读），不另写一套。不复用 `views/graph-context-reader.ts`（notes 不能 import views，而且它读得太宽）。

### 11.3 各读法默认给哪些状态；先筛再核对（决定 67 第 2 条，(b11)）

- **一个可见判断** `visibleByDefault(head, g)`，“找”和 `lookup` 共用；`g` 是调用方可信的目标（`currentGoalIdOf`，不是请求字段）；`own = g === null || head.goalId === g`。
  - 项目的当前理解（`kind === 'understanding'` 且主锚点是项目）：已收下、书记已审都给（§11.4）；
  - 其余的已收下：`own || confirmedByUser`；书记已审：都给；待审：`own`；
  - “找”另外：暂存、被拒、已取代、已撤下只在请求里用 `state` 指明那一种时给；指明的 `state` 覆盖默认、只给那一种；待审、暂存仍守 `own`，退役的三种不分目标（同“历史”）。`lookup` 照 §10 R9 另给暂存。
  - 主机调用（你和 `notes/list`）、查询 Run 没有目标，`own` 恒真，和今天的 `checkNotes` 一致。
- **筛在哪儿。** 放进第一轮的共用范围判断 `headInScope`：所有来源在算 U、df、`'any'` 上限、`'all'` 翻页和切页之前就筛掉。分数按筛后的集合算（L10 的 U 本来就是“非文本条件筛完剩下的”）。没词的按状态读，只读可见的那几种状态。`lookup` 里今天的筛选（`note-read-model.ts:1160-1166`）换成这个判断。
- **标记。** 不加字段：`storedState` 是已收下或已审而 `currentEligible: false` 的，就是“读时算出有问题的”，原因看已有字段。顺序不变（不为把现行的排前面去核对每个候选）。工具说明写明：只有 `currentEligible: true` 的才能当现行结论。
- **`lookup`（b11）：** 筛选挪到排序、切页之前，只看存的字段，不多读；存在性检查仍用没筛过的集合，锚点上的注记都被筛掉时回 `items: []`、`complete: true`。
- **`conflicts`（b11）：** 候选和切页照旧；每个候选先用本次调用的缓存算 `conflicting`（第一轮 S2.3、S2.6），只把矛盾的交 `checkHeads`，并把算好的 `conflicting` 一起传进去，核对不再重算。空页加 `complete: false` 仍然可能。
- **改 §10 R3：** `coverage` 只数这一页实际核对的项。`stale` 照旧也数核对后丢掉的新鲜项。`lookup`、“找”、`conflicts` 在核对前按存的字段或注记头的推导丢掉的项哪儿都不数，也不花文件、事实、符号的预算；这些项读文件失败也不再让整次调用失败（`conflicts` 推导时的读失败仍然失败）。
- **`stale`：** 照 L12 的问题列表和 R6 的候选（已收下、已审）；删掉走不到的 `item.invalid` 判断（只有暂存的修复会是 invalid，`note-views.ts:934`）。
- **历史、相邻、冲突：** 不筛状态、不筛目标。
- **游标：** `RULE_VERSION` 升到 2，所有读法一起（同一游标在新规则下页内容会变）。旧游标回 `cursor_mismatch`。

### 11.4 项目的当前理解（决定 67 第 3 条）

- **锚点和指针。** 允许 `kind: 'understanding'` 挂 `{kind: 'project'}`；指针键 `(project, 'project')`，同 L8 的检查和冲突回复。L4 第 2 步、L2a 第 3 类、L8、O34、O35 里的“目标或阶段”改成“目标、阶段或项目”。项目的当前理解不能带附加锚点（`invalid`、`project_understanding_extra_anchors`），免得出现在模块的“看”里。读侧的 `pointerOf`、`understandingOf`（`note-read-model.ts:404`、`:1027`）接受 `project`。代码里写入侧只有 `note-service.ts:649-653` 一处限制；指针的编解码已经接受任何锚点键，不改记录。
- **目标号恒为 null。** 不管谁写，注记头的 `goalId` 是 null，`resolveNoteAnchors` 拿 null，依据计划为 null；`plan_changed` 不适用；不占任何目标的配额。
- **谁能写**（§11.1 第 3 条）：`scopes.manages(ctx, session, {kind:'project'})` 为真的书记，和用户经 `notes/write`。别人 `forbidden`、`project_understanding_scribe_only`。撤下照 L6。
- **到处可用。** 核对的本目标判断（`note-views.ts:973`）和 §11.3 的可见判断对它都成立：已收下就是现行结论，`crossGoal: false`。写的人只有书记和用户，所以不再要一次审。
- **长度。** `PROJECT_UNDERSTANDING_BODY_MAX_BYTES = 4096`（可注入），同样五节。
- **项目规范的选取**（Goal 卡和“找”的第一页用同一个）：读项目锚点（`anchorKey0 = project`）上的注记头；留下已收下或已审、种类是约定、决定或偏好、而且书记审过或用户确认过的；按 `createdAt` 从新到旧、`noteId` 排；取前 `PROJECT_NORMS_CHECK_MAX = 10` 个去核对，留 `currentEligible` 的前 `PROJECT_NORMS_MAX = 5` 个；`omitted` = 筛后的总数减去列出的个数（核对没轮到的也算进去）。L7 是软配额、用户写入可以超，所以这里按实际个数算，不假设最多 5 条。列不下时 Goal 卡写“另有 n 条，用‘看’读项目”。
- **拼上下文**（L20 改）：Goal 卡的“当前理解”最多 3 行，顺序项目、目标、阶段；项目那一行带整篇正文（Goal 卡是必备区、不进预算）；下面按 `renderNoteHeader` 一条一行列项目规范。预算区去掉 Goal 卡里已有的。查询 Run 的上下文同样带（L20 原文“查询也只放当前理解”改成“当前理解和项目规范”）。第 6 片把它们放进秘书的上下文。
- **“找”的第一页**（`cursor === null`）多一个 `project: { understanding: { noteId, version, pointerRevision, conclusion, currentEligible } | null; norms: { noteId, version, header }[]; omitted: number }`（`pointerRevision` 是项目指针的版本），之后的页没有。
  - 核对：和这一页的项合成一次 `checkHeads`，按 noteId@version 去重，同一条只核一次、只花一次预算；顺序是项目理解、规范、页里的项；它们的文件观察照样进 `coverage` 和 `readBasis`。
  - 48 KiB（照 §10 R12 扩展）：先从页里的项从后往前裁，裁到剩 1 项；还超就从规范从后往前裁（裁掉的加进 `omitted`）；项目理解那一项不裁。每裁一次，`readBasis.observedFiles` 和 `coverage` 按“留下的项目部分 + 留下的项”去重重算。还超就照 R12 返回现在这样，带 `result_over_byte_bound`。续读游标照 §11.2 从留下的最后一项接着。
  - 匹配的规范照样出现在结果项里。
- **该更新：** 项目的当前理解在 4C 里不算。`UnderstandingStatusV1.updateDue` 的类型是 `boolean | null`：目标、阶段锚点是 `boolean`，项目锚点是 `null`；`NoteItemV1.updateDue` 对项目理解也是 `null`。以后按实际使用定（后注）。
- **派工：** 项目的指针不进第 7 片 L2 的派工钉子（否则改一次项目理解，所有目标的派工都冲突）。
- **今天做不到的**（写进 §1.2 和第 7 片后注）：书记改写你写的项目理解时给你的“请知悉”，和不挂目标的待审注记的卡，都等第 7 片 D2。

### 11.5 “该更新”和书记提醒（M-12、L9、L16）

- **触发**（目标 g 的现行计划 M，只看 M 里的任务；时间都是平台写的、来自组合根注入的时钟）：
  - T1 任务完成：`TaskReduction.phase === 'satisfied'` 的 `reducedAt`，键 `task_end:<taskId>#r<reduction revision>`；重新归约再触发一次。
  - T2 任务取消或被取代：第一次把它定成取消或取代的那个计划的 `acceptedAt`，键 `task_end:<taskId>@p<rev>`（规则同 `plan-readers.ts:1964-1978`）。
  - T3 返工：该目标已结束的 Run 的每条 `TaskRequeue` 的 `requestedAt`，键 `rework:<taskId>/<afterRunId>`；带 `archiveOrigin` 的键是 `archive:<taskId>/<afterRunId>`（§11.1 第 4 条：只有这种归档算触发）。
  - T4 采用计划：`acceptedAt(M)`，键 `plan:p<M>`，只对目标锚点。
  - “重新分组”还没有（`src/` 里没有），不算，后注。
- **阶段 s：** T1–T3，只看 M 里属于 s 的任务（同 §11.2 的阶段归属）。阶段没有 T4：重新规划后阶段锚点键换了版本，旧的当前理解由 L11 的 `plan_changed` 标成需复查。
- **基线 B：** 有现行当前理解时，B 是它的 `createdAt`（注记的正文写下就不变，改就是写新的一条，所以“最后一个正文版本”就是注记头的创建时间）。指针指向的注记不是已收下或已审时，当作没有。没有当前理解时：目标 B 取负无穷、不算 T4（§11.1 第 4 条）；`stage@M` 的 B 取 `acceptedAt(M)`。
- **规则：** 有触发的时间严格大于 B 就是该更新。`latestTriggerCursor` 字段名不变，值改成最新那个触发的键（按时间从新到旧、键的字节序），没有时 null。读失败整次 `unavailable`。`NoteItemV1.updateDue` 只对已收下或已审的当前理解的头版本不是 null。
- **读：** 新的 `readGoalTriggerRecords(records, goalRef, plan)`（放 `tasks/plan-readers.ts`，和已有的读法放一起），三步：
  1. `RUN_BY_GOAL_INDEX` 翻页拿 Run 的键（同 `readGoalRunsForCount` 的 `readLookupKeys`，`plan-readers.ts:514`）；
  2. 1 次 `readMany` 读这些 Run，解码（返工键要 Run 里的 `taskId`，`:1316`）；
  3. 1 次 `readMany` 一起读：M 里每个任务的 `TaskReduction`、每个已结束 Run 的 `TaskRequeue`（键同 `readReworkRecords`），和 T2 要的、不在已读计划窗口里的来源计划（`:1971`）。
  - 任何一次读回 `unsupported` 或别的失败都是 `unavailable`（不照 `readReworkRecords` 今天把 `unsupported` 当空集合，`:1324`；那个函数和它现有的调用方不动）。
  - 目标没有现行计划（`:974` 的合法返回）：没有触发；目标锚点 `updateDue: false`，没有阶段锚点。
  - 计划窗口：核对缓存里已有就用；没有（例如空锚点的 `lookup`）就读一次（2–3 次读），算进下面的预算。
- **在哪儿算：** 新文件 `notes/note-update-due.ts`：`foldUpdateDue({ triggers, plan, anchors: [{ anchorKey, baseline }] })` 是纯函数。核对（`note-views.ts`）在第一轮的单次调用缓存里按目标记住读到的触发，挨着已有的现行计划缓存；`lookup` 从同一个缓存拿，`understandingOf` 不再自己读（删掉旧路径，决定 69 第 3 条）。装配（L20 的提醒区）和心跳用一个窄端口：

  ```ts
  interface NoteUpdateDuePort {
    readUpdateDue(ctx: CoreCallContext, input: { goalIds: string[] }): Promise<ReadResult<{ goalId: string;
      anchors: { anchorKey: string; pointer: { noteId: string | null; revision: number | null };
        updateDue: boolean; latestTriggerCursor: string | null }[] }[]>>;
  }
  ```

  背后是同一个读和同一个纯函数；锚点是 `goal:g` 和现行计划的每个阶段。
- **书记提醒**（`host.ts`）：
  - 每个配置的工作区一次单独的提醒检查，不依赖 attention 的配置。目标来自 `GOAL_BY_WORKSPACE`。账本游标没动就不重算（只在内存里记，不存标记）。
  - 收件人：管这个范围的书记（今天都是项目范围）；有几个项目书记时取 `sessionId` 最小的，等第 7 片 D 的 `resolveResponsibleLine` 接替。
  - 待办两种，各有自己的身份：待审 = `noteId@version`；该更新 = `anchorKey@latestTriggerCursor`。待审只数书记能处理的（§11.6 的 `userReasonsOf` 为空的），含因 `quota_full` 待审的和被更新的一版盖过的待审当前理解；已取消目标的不数。来源：待审状态桶（每个目标槽一个，加不挂目标的一个）。
  - 冻结规格 L16 的“待审数 + 超配额锚点数”改成只数待审：agent 在满了的锚点上写入本来就进待审（原因 `quota_full`），已经算在待审里；已收下而超配额的只有用户自己的写入（用户可以超），不算书记的活。这样不必为数超配额去读所有现行注记。
  - 待审数到 10、该更新数到 5 时发；有一条 `archive:` 触发、而它的返工还没有 Run 认领时（`Run.requeueRef`）立即发——这就是 L16 的“没有 agent 在场”。
  - 每个收件人一条消息，请求号 `scribe-reminder:<ws>:<owner>:<sha256(两种待办身份排好序的列表)>`，靠消息的幂等不重复；列计数和最多 20 个锚点名。每个收件人最多一条没处理完的提醒（同 `host.ts:1173-1195` 的规则）。
  - 算和发分开记：账本游标没动时不重算待办集合；但上一次没发成功的（发送失败、`host.ts:1238` 保留重试的那种），下一次心跳照样再发，不等账本动。
  - 时间：心跳的 `Date.now()`（`host.ts:1164`、`:1201`）改走注入的时钟，NE6 才能用注入时钟测。`Session.archivedAt` 用的是墙上时钟（`session-lifecycle.ts:321`），本规则不用它。
- **今天的心跳从不触发**（`attention-observer.ts:716-718` 恒回 `pendingInputs: 0`）：书记提醒是新加的一条检查，不改已有的 attention 逻辑。

### 11.6 少让人看（决定 68）

- **一个函数决定给不给人。** `state/note-machine.ts` 加纯函数 `userReasonsOf(head, targets)`，结果是 {`structural`, `contradiction`, `user_note_replaced`} 的子集，**逐个实际处置目标**按读时的事实算（不看存下的 `reviewReasons`，存下的留作历史）。出卡、状态机的守卫、书记提醒的计数都用它。读不到算它要的事实时整次读 `unavailable`，卡照原样，不因拿不准多出卡（这是决定 68 下 lead 的规则，不另问用户）。
- **实际处置目标：** 收下这条注记时会被取代的集合 = `replaces` 减去 `coexistWith`（同 L6、S4-NOTE-08 和 `note-service.ts:550` 的算法），加上它 `contradicts` 的注记。
- **`contradiction` 进集合的条件：** 某个被矛盾的目标现在仍是已收下或已审、它的主锚点没有因非文件原因退役（L23），而且它是用户确认过或用户写的。被矛盾的现行目标都是 agent 的 → 不进集合，交书记（§11.1 第 5 条）。写入时只有至少一个被矛盾的目标是已收下或已审时才记 `contradiction`（关系注记头写入时已经读了，`note-service.ts:713-721`，不多读）。
- **`user_note_replaced`**（§11.1 第 6 条）：会被取代的集合里有一条现行且用户确认过的注记 → 待审，记这个原因。只看那条被取代的注记自己：待审注记的主锚点退役，不会清掉这个原因。当前理解除外（给“请知悉”）。书记撤下用户确认过的注记 → `forbidden`、`user_confirmed`。
- **你的卡的选项**（§11.1 第 6 条）：只要集合里有 `contradiction` 或 `user_note_replaced`，卡一律三项：取代（这条收下；被矛盾的和会被取代的现行目标都被取代）、并存（这条收下；集合里涉及的你的注记照旧现行，记进 `coexistWith`）、拒绝。只有 `structural`（用户若选冻结规格原来的做法）时两项：收下、拒绝。
- **卡的出和关**（注记卡自己的顺序，不照搬 `finalizeCard` 里目标冲突的那一支，`views/decision-read-model.ts:897-900`）：(1) 目标已取消 → `goal_cancelled`；(2) 已经答复 → 照第 5 片的答复和落实；(3) `userReasonsOf` 为空 → `source_resolved`；(4) 否则出卡。
- **`structural`**（§11.1 第 7 条）：agent 写的结构性普通注记照常收下，标题带“!”，给一条“请知悉”；不进这个集合。结构性的修复（暂存）照旧走第 8 片。
- **书记处理矛盾**（补冻结规格 L5、L6、L14、§3）：`reviewNote` 和 `record_note` 的 `review` 支在 `verdict: 'accept'` 时多一个 `resolution?: 'supersede' | 'coexist'`。
  - 注记有活的矛盾（被矛盾的目标仍现行）而 `userReasonsOf` 为空时，书记收下必须给 `resolution`（缺了 `invalid`、`resolution_required`）；别的情况给了 `invalid`、`resolution_not_applicable`。
  - `supersede`：这条收下、被矛盾的现行目标在同一次提交里被取代（S4-NOTE-05 加 S4-NOTE-08）；`coexist`：这条收下并记 `coexistWith`（S4-NOTE-10 的 `by` 放开为 `'scribe' | 'user'`；书记并存不把 `confirmedByUser` 设为真）；拒绝照旧。
  - 和你的注记卡落实走同一组状态迁移；守卫同 `reviewNote`（`expectedVersion`、`expectedPointerRevision`），被取代目标的版本在同一次提交里按头版本守；回执同 `NoteDispositionResult`。
  - 状态机守卫 `note-machine.ts:219-223` 改用 `userReasonsOf`：集合里有原因时只有用户能收下或拒绝。
- **同一作者改稿：** 写入的 `replaces` 指向同一作者还在待审的注记，那一条在同一次提交里撤下，原因 `revised_while_pending`；只留一条待审。
- **被盖过的待审当前理解：** 同一锚点的现行当前理解的 `createdAt` 晚于这条待审的 `createdAt` → 不给人（当前理解本来就不出“取代你的注记”的卡），留在待审，进书记的待办（§11.5）。它不能被收下（`invalid`、`understanding_outdated`，免得旧稿盖掉新版）；书记拒绝它，或另写一版把它并进去。
- **目标状态：** 已取消的目标照旧关卡（已有规则）；它的待审和该更新不进书记的计数。
- **不挂目标的待审注记**（`goalId` null）：留在待审，不出卡、不是现行结论，`notes/list` 看得到；第 7 片 D2 有了不挂目标的卡再出。L17 写明。
- **请知悉**（§11.1 第 8 条）：书记的结果只有动了你写的或你确认过的注记才单独一条；其余每个目标折成一行计数（用 §1.4 已有的折叠）。
- **落实的回执：** `decision-application.ts:59-76` 的回执白名单加 `NoteDispositionChanged`（本来就要加）。

### 11.7 成本、行数、复用（决定 69）

- **验收行：每次调用最多读几次存储。** 只给本节新加或改了的读写；没改的读法照第一轮合入后的实测。
  - 记号：一次“索引扫描”读一个桶，花 ⌈n/200⌉ 次调用（n 是桶里的条数，空桶也算 1 次）；“锚点集合”= 5 个锚点槽各扫一次；`C(k)` = 一次核对 k 项的读：1 次批量读这些项的头和版本、1 次批量读它们引用的事实、文件读至多 `min(Σ 依据文件 + Σ 文件事实 + 文件锚点, NOTE_READ_FILES_MAX = 256)` 次（§10 的每页文件预算，`note-views.ts:727`、`:733`），符号复查至多 `NOTE_SYMBOL_RECHECK_MAX = 20` 次，每个涉及的不同目标的计划窗口 2–3 次（冷缓存，`plan-readers.ts:971-981`；单次调用里每个目标只读一次），目录 1 次。
  - 验收时按测试数据的实际桶大小算出数字，经公开端口外面套一层只数调用、不看内容的计数包装来量（§7 的夹具例外，lead 同意）。“每条记录只解码一次”数调用量不出来，不当验收行，放进 Codex 实现审查的成本项。
  - **建有联系的集合（工作 Run）**：Run 解析 1 + 计划 1–3 + 目录 1 + 任务的 Run 索引扫描 + 1 次批量读 RunActivity + 每个锚点键一组锚点集合 + 阶段前缀扫描 5 次 + 每条模块路径的前缀扫描 5 次。
  - **“找”一页**：上面一项（分段时）+ 1 次账本 + 第一段的注记头已在锚点集合里 + 到第二段时原来不分段读法的读 + 第一页的项目部分（见下）+ `C(本页项数 + 项目部分项数)`。页停在第一段时，文本端口一次都不调。按状态读：工作 Run 读 2(G+1)+1 个状态桶，主机或查询 Run 读 3(G+1) 个，指明 `state` 时 G+1 个（今天 7(G+1) 个）。
  - **`lookup` 一页**：1 次账本 + 1 组锚点集合 + 1 次指针 + `C(本页项数)` + 该更新（目标或阶段锚点）：计划窗口不在缓存时 2–3 + Run 索引扫描 + 2 次批量读（§11.5 的三步）。
  - **Goal 卡的项目部分**：1 次批量读三个指针、1 次批量读指向的注记头、项目锚点一次扫描、`C(1 + 10)`。
  - **心跳一次检查**：账本游标没动 → 1 次读（加上次没发成功的重发）。动了 → 目标索引一次扫描；每个目标：计划窗口 2–3 + §11.5 的三步；1 次批量读所有指针、1 次批量读它们指向的注记头；待审状态桶 G+1 个扫描；每个待审 1 次批量读它的关系目标（算 `userReasonsOf`，所有待审合成一次）；书记范围的事实一次（Session 翻页 + 目录 1，这次检查里共用，不是每条注记一次）。
  - **注记卡源一次读**：待审状态桶 G+1 个扫描 + 1 次批量读所有关系目标 + 每个目标的计划和目录各 1 次（单次调用缓存）。
  - **写**：`record_note` 和 `notes/write` = 4A 的写入路径 + 写后 `checkNotes` 的 `C(1)`；写项目理解多一次书记范围的事实。书记的收下、撤下、并存 = 4A 的处置路径 + 书记范围的事实一次 + 被取代目标 1 次批量读。
  - **书记范围的事实**：今天 `manages` 每次重新派生（`scribe-scope.ts:369`），关系锚点一条一读（`:305`）。改成每次调用派生一次（单次调用记忆），关系锚点批量读；算进行数预算。
- **行数预算是软的。** 上面这些改造（共用的范围事实、批量读关系、注记卡自己的关卡顺序）都算在两轮各 1,400 行里；预算是按复用清单估的，施工中超了在验收里写原因，不为凑数省掉规则。
- **合入前在 2 万条注记的数据上实测一次**（第一、二轮之后的数据和代码）：带分段的“找”第一页、`lookup`、`stale`、Goal 卡装配、心跳一次检查的时间和读次数；尺子：“找”第一页 ≤ 100 毫秒、`lookup` ≤ 50 毫秒、`stale` ≤ 250 毫秒，超了在验收里写原因。
- **行数预算**（新增源码，不含 skill 文字和测试）：4C-1 约 1,400 行，4C-2 约 1,400 行（§11.9），超了在验收里说明。
- **复用，不另起一套：** `headsByAnchorKey`、`headsOnPathPrefix`（推广到任何键前缀）、`headInScope`、`sliceByCursor`、`fitToByteBound`、`rankMatches`、游标编解码、`anchorExistsNow`、`readPlan`/`readGoalPlanWindow`、`RUN_BY_TASK_INDEX`、`RUN_BY_GOAL_INDEX` 的索引读、`decodeRunActivitySnapshot`、`moduleOfAnchor`（导出）、`ScribeScope.manages`、`checkHeads` 和第一轮的单次调用缓存、`conflictingOf`、`renderNoteHeader`、`renderUnderstandingBody`、`decisionSourceKey`、消息的请求号幂等、4C 本来要做的注记卡落实迁移（书记处理矛盾用同一组）。注记卡的关卡顺序是自己的（§11.6），不复用 `finalizeCard` 里目标冲突的那一支。
- **删掉的旧路径：** `understandingOf` 自己的读；`updateDue: null` 的占位；`stale` 里走不到的 `invalid` 判断；状态机守卫里看存下原因的那段（`note-machine.ts:219-223`）。

### 11.8 测试（在 NE3–NE7 下加，期望值手算，两个后端都跑）

- 有联系的范围：F-01 任务 t1 分段翻三页；F-02 模块 M；F-03 `'any'` 两段各自排序（r1 = 3·ln3 + ln2 = 3.9890，r2 = 2·ln2 = 1.3863，p1 = 3·ln2 = 2.0794，顺序 r1、r2、p1）；F-04 筛选两段一样；F-05 游标和裁剪（旧规则游标 `cursor_mismatch`、换 `related` 也是、两页间新 RunActivity `revision_conflict`、小字节上限把 r1、r2、p1 一页裁到只剩 r1 时下一页从 r2 接着、第一段全部留下只裁掉第二段的项时下一页从第二段接着、`projectStartsAt` 从 0 数）；F-06 工具路径和解析表（工作 Run 默认分段、`null` 不分段、有锚点再给 `related` 是 `related_with_scope`、查询 Run 不分段、任务不存在 `related_not_found`）；F-07 文件（上限注入 2 时 `filesOmitted: 1`、正在跑的 Run 不加文件、`unknown` 的 Run 记进 `filesUnknownRuns`）；F-08 第一段超过 1,000 个候选时只给前 1,000 个再转第二段，`ranking` 到第二段时是 `'partial'`。
- 默认状态：DS-01（g1 的工作 Run 和主机各看到哪些）、DS-02（指明 `state`）、DS-03（退役的注记不进 U：T-07 的分数仍是 3.9120 / 2.3026 / 0.6931）、DS-04（`lookup` 的 b11）、DS-05（`coverage` 和预算只算核对的项）、DS-06（`stale` 空页 `complete: false`，接 M-09 的空页断言）、DS-07（g2 的工作 Run 在“找”和 `lookup` 里都看到已收下的项目理解）。
- 项目理解：PU-01（谁能写、长度边界 4,096 / 4,097、附加锚点 `invalid`、N-02 仍拒绝任务锚点）、PU-02（别的目标里现行、不占目标配额）、PU-03（Goal 卡三行的顺序和规范的筛选；7 条合格规范时列 5 条、`omitted: 2`；预算为 0 时规范仍在；预算区不重复）、PU-04（“找”第一页带 `project`、第二页不带；规范也在页里时只核一次；小文件预算时先花在项目部分）。
- 该更新：M-12a–f（完成、只审不算、返工、采用计划、没有当前理解、同一时刻不算）、M-12g（项目锚点 `updateDue: null`）、M-12h（`unsupported` 的读是 `unavailable`）；D-03 补：归档停下正在跑的任务时立即发、被认领后不发、同一集合只发一次、新触发发一条列全部、换收件人换键、**同一锚点、同样的计数、换了一条待审（旧的处理完、新的进来）发新的一条**。
- 少让人看：D-04（矛盾的目标已不现行：收下、不进集合）、D-05（卡出来后对方被撤下：卡关；书记不带 `resolution` 的 `accept` 成功，带了是 `resolution_not_applicable`；撤下前书记收下是 `forbidden`）、D-06（取代你的注记：待审、卡、收下后你的那条被取代、证明事件带 `acknowledgementRef`）、D-07（书记撤你的注记 `forbidden`）、D-08（同作者改稿只留一条待审）、D-09（不挂目标的待审不出卡）、D-10（计数 10 条发 / 9 + 1 条用户原因的不发）、D-11（取消目标后计数下降）、D-12（被盖过的待审理解：卡关、进书记待办）、D-13（一条既矛盾一个已退役的目标、又取代你确认过的注记：前一个原因没了卡仍在，后一个也没了才关）、D-14（书记处理 agent 之间的矛盾：`supersede` 后目标被取代、`coexist` 后两条都在且 `confirmedByUser` 不变、缺 `resolution` 是 `resolution_required`）、D-15（被盖过的待审理解收下是 `understanding_outdated`，拒绝成功）、D-16（`replaces` 你确认过的注记但它也在 `coexistWith` 里：直接收下、不出卡）、D-17（你的卡三项各自的效果：取代、并存、拒绝）、D-18（提醒发送失败后账本没动，下一次心跳重发成功）。
- **要改断言或改造数据的旧测试**（保留原来要验证的事，经公开服务重造待审数据，例如改用超配额或取代用户确认的注记）：`S4B-memory-paging.test.ts:108`（M-09 的 `lookup` 空页变 `complete: true`，空页点挪到 DS-06）；`S4B-memory-l12-bounds.test.ts:173`（别的目标的已收下注记不再出现在“找”里，“不现行”的断言改用 `checkNotes` 直接调）；`S4A-note-write.test.ts:336`、`:486`、`:502`、`:653`、`:676`、`:890` 和 `S4A-note-history.test.ts:475`、`:499`（用结构性造待审；逐条按原来验证的事换待审来源，例如 `:336` 验证的是投影配额扣掉被取代项，换数据时被取代项仍在同一锚点；配额、指针、拒绝原因的验证都保留）；`S4B-memory-similar.test.ts:22`（要求候选是待审）；D-01 的矛盾夹具要用现行且用户确认过的目标。提速第一轮新加的 `SP-` 测试以合入后的为准，冻结时 lead 核。

### 11.9 分两轮

- **4C-1（读、写和守卫）：** §11.2、§11.3；§11.4 里写入、“找”“看”的部分；§11.6 里所有写入和处置的规则和守卫（`userReasonsOf`、矛盾和结构性的准入、取代你的注记进待审、书记不能撤你的注记、书记处理矛盾、同作者改稿）；`record_note` 和“看”“找”的记忆分支（L13–L15）、路由（NE7）、节点详情的注记一栏（L21）。合入后：要你定的待审注记照样待审，只是还没有卡；没有通知；`updateDue` 还没接（M-12 在 4C-2），4C-1 的验收写明这一点。冻结规格 §5.2 G-01 里“下一次准备能看到索引行”的装配断言归 4C-2。
- **4C-2（装配、卡和提醒）：** L20 的装配（含项目理解和规范进 Goal 卡）、§11.5、注记卡和关卡（L17）、请知悉。
- 4C-2 在 4C-1 合入后施工；两轮各自审查、验收、合入。

### 11.10 本节改了前面哪些地方

O34、O35、L2a 第 3 类、L4 第 2 步、L8（项目的当前理解）；L5、L6、L14 和 §3 的 S4-NOTE-05、08、10（书记处理矛盾、`resolution`、并存放开给书记、守卫看 `userReasonsOf`）；L9（该更新的触发和基线）；L12 和 §10 R3、R9、R12（默认状态、先筛再核对、`coverage`、带项目部分的 48 KiB 裁剪）；L16（提醒的收件人、只数待审不数超配额、待办身份、立即发的条件、发送失败重试）；L17（卡的出和关、矛盾、你的注记、结构性、不挂目标的待审）；L20（Goal 卡三行和项目规范、查询 Run）；决定 35 · Q23 甲（请知悉的范围，待用户定）；§1.2（推到第 7 片 D2 的两项）。
