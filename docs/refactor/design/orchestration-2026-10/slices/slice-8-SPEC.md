# 第 8 片规格：架构随工作演进

**后注（4A 合入，lead 2026-10-16）：** 4A 的书记范围（`src/core/work-graph/notes/scribe-scope.ts` 的 `matchingPrefixLength`）把根目录前缀 `"."` 当作不匹配（-1）。8A 改根路径时一起改成长度 0，让负责根模块 R 的书记管 `src/loose.ts` 这类文件，并加一例：书记负责 R，`src/loose.ts` 上的注记被收下、归这个书记管。在那之前注记的范围和 `mapExecutedFilesToModules` 一致。正文原样保留。

**后注（4B 合入，lead 2026-10-16）：** 8A 改目录修订时一起做两件事。① 把每次目录修订的提交和它的 `ArchitectureCatalogRevised` 事件连上（例如目录修订记录上一个提交时绑定的 `since` 游标），这样第 4 片的目录版本列表（`notes.listCatalogVersions`）才能显示每一版的原因和时间；今天它的 `at` 是 `null`，原因显示“原因记在目录修订里，第 8 片接上后显示”（第 4 片规格 §10）。② 目录修订能删模块以后，补测第 4 片里因为删不了模块而跳过的三处：M-15 的 `module_removed`、M-16 的“模块没了但还有头”、M-02 的删除一半（`catalog-service.ts:671–673` 今天拒绝删模块）。

**后注（决定 72 的复用盘点，lead 2026-10-16 夜）：** Codex 把第 6、7、8 片和 K3、4C 剩下的部分放在一起找共用机制，两个 Claude 子 agent 逐条核过引用和代码，lead 裁定。和正文冲突时以本后注为准；产品范围不变。和本片有关的：
- **目录 pin 的类型（§2、L7）：** 完整目录 pin 的纯类型从 8C 前移到 8A（§2 写在 8C），因为 8A 的比较（L7）和 8B 的计划提案已经用它。
- **唯一的目录修订写入方（L5、L6）：** 8C 的目录修订规划器是唯一写入方，返回目录变更和负责关系迁移的提交贡献；人工修订、修补、结构提议只各自提供授权和门槛；第 7 片 7D2 只决定什么时候冻结批次。第 7 片里结构批次的文字是引用本片。
- **根路径（L7）：** 4C-1 合入后，文件归模块只有一个纯函数（目录边界、最长前缀、并列报歧义）。8A 在这一处加入 `.`，再搜一遍漏网的前缀匹配：模板字符串写法 `` startsWith(`${…}/`) `` 用 `startsWith(path + '/')` 搜不到；`node-detail-reader.ts` 那份还认 `\`。
- **落实证明（L4、L6）：** 修补和结构提议的落实在 K3 第 4 组或 4C-2 建的证明表上加行，按来源的落实适配走共同的推进函数；“批准已记、还没生效”是合法状态。
- **书记待办（L4）：** 过时的修补进书记待办，走 4C-2 的提醒投递外壳。

**后注（决定 74，lead 2026-10-16 夜）：** 8A（不含 L8 的过时提醒）在 4C-1 合入后施工，随后 8D，和 4C-2、清理、6A 并行；L8 在 4C-2 合入后补上。8B、8C 的位置不变（要 7D1）。8A 的根目录 `.` 加在 4C-1 统一的文件归模块函数上（本片开头决定 72 的后注）。

> **2026-10-15 晚：按决定 60、61、62 和 7D 第二稿改了文件级观测、自动抓、根路径、区域和修订负责去向、结构修订提议；冻结前 lead 逐行审；又按 7D 勘误 E1–E11 和决定 63 改；又按审查二（19 条）的 lead 裁定改；lead 逐行审过这一稿，补的地方标“审查二 lead 补”；Codex 最后一次快速核对的必改由 lead 改完（标“审查二快速核对第 n 条”）；经你同意又加了一次只看改动的额外核对，它的必改由 lead 改完（标“审查二额外核对 Dn”）。**已冻结（2026-10-15 晚，你确认了测试入口）。**
> **状态（2026-10-15 凌晨）：内容定稿，等你定 §0.1 后冻结。** Codex 两次完整审查加一次快速核对都用完了（决定 56 的上限），最后一次结论“改完后冻结”，那几处已照改（标“最后核对第 n 条”）。冻结前 lead 还要通读全稿一遍。下面原来的状态说明保留作记录。

> **状态：lead 第一稿，2026-10-15 夜。** 按决定 58，和第 2 片的施工并行起草。
> - 冻结前还要：你定 §0.1 的几件事；Codex 审（最多两次完整审查加一次快速核对，决定 56）；lead 在第 4 片、2B、2C 合入后的基线上重核 §0.2 和 §6。
> - 代码事实：Codex 只读事实清单（`D:/cc-lead-notes/codex2/s8facts.out.md`，HEAD 5c7a3258），lead 核过 F1、F3、F5。
> - 依据：HANDOFF 决定 12、20、21、25、35（Q12、Q23）、49、56；DESIGN §1.3 自治表（L160–177）、J11（L475）、§4.9 按模块分组（L941）、§8.2 第 8 行（L1251）；MODEL R47；第 4 片规格草稿（修补暂存、作废、注记卡）。
> - 第一轮审查（Codex，2026-10-15）14 条由 lead 2026-10-15 逐条裁；本稿照裁定改，改动行带（第一轮审查第 n 条）。（第一轮审查第 1–14 条）
> - 第二轮审查（Codex，2026-10-15）6 条由 lead 2026-10-15 逐条裁；本稿照裁定改，改动行带（第二轮审查第 n 条）。（第二轮审查第 1–6 条）
> - 最后核对（Codex，2026-10-15，`.dsh-ref/s8specquick.out.md`）6 条必须改，lead 2026-10-15 全部按原样收下；本稿照改，改动行带（最后核对第 n 条）。（最后核对第 1–6 条）

## 0. 冻结说明（lead）

### 0.1 要你定的

**1. 拆成四小片（建议拆）。**
- **8A 观测和提醒：** 文件级观测图、正式和观测的比较、准备执行时的过时提醒。
- **8B 归属：** 任务所属模块的检查、模块负责人、冷启动时声明包含关系。
- **8C 修补生效：** 修补的内容格式、小改和结构改动的界线、随检查通过和架构修订一起生效、修订接口、删模块规则。
- **8D 多语言引用：** C/C++、Python 的引用关系按 8A 的提供者接口接现有解析器（决定 63-2）。

顺序 8A → 8B → 8C → 8D（全局顺序 `4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C`；8D 在 7D2 之前），是集成顺序，不是内在依赖链。8A 的提醒要第 4 片的装配器分路（4C）合入；8B 的投影要 2C 合入；8C 要第 4 片（修补暂存）、第 5 片（卡）、2B（执行活动）和 7D1 共享基础。删模块规则在 8C。参谋的指定工具是第 7 片的，调 8B 的写入规则。（第一轮审查第 13 条；决定 63；审查二第 18 条）
- (a) **拆成 8A、8B、8C、8D（建议）。**
- (b) 不拆。

**用户 2026-10-15 晚定：(a) 拆。**

**2. 测试入口（§5.1 的 AE1–AE6）。**

**3. 谁能指定模块负责人。** 今天没有谁写模块负责人，所以“按模块分组”里模块维护的线一直是空的（DESIGN §4.9 L941）。
- (a) **你，和参谋（建议）。** 参谋在「每步确认」下指定，先出一张“要决定”的卡；「方案确认后自动」下直接生效，进“请知悉”。和参谋“建成员”同一个口径（第 7 片）。
- (b) 只有你。

**用户 2026-10-15 晚定：由参谋指定**（「每步确认」下先出卡，「方案确认后自动」下直接生效、进“请知悉”）。你随时能改任何角色线的范围（决定 60-7），所以 `modules/assign-maintainer` 仍留给你作人工调整。

**告知（lead 的技术取舍，不用你定，你可以改）：**
1. **小改和结构改动的界线**（L2，设计把界线交给 lead）：增删模块、增删依赖、增删 forbid 规则、改模块的上下级（包含关系）是结构改动；改职责说明、改依赖理由、增删接口、改接口说明或路径、给已有模块增删路径是小改。路径改动会改变文件归哪个模块，所以按 L3 的路径规则只许动本次足迹里的文件。接口的 id 稳定，没有改名的 op（换 id = remove + add）。（第一轮审查第 1、2 条）
2. **修补和别的修补撞了**：两个修补钉的是同一个目录版本，先按轮次定案游标、再按 note id 排；先生效的那个让后一个“过时”：后一个不自动合并，保持暂存，提醒写它的 agent 或书记重提（L4）。（第一轮审查第 5 条）
3. **删模块**：还有没终结的任务声明属于它就还不能删；模块上开着的负责关系要写明去向（维护者、区域参谋、区域书记都算），缺去向不能删；碰它的边（依赖、forbid 规则、包含关系）必须在同一次修订里删掉；并发采用要守住（L5）。（第一轮审查第 7 条）
4. **观测图的语言**：引用关系按语言接入（决定 63 修改）：TS/JS 是 8A 的第一个提供者，C/C++、Python 在 8D，Rust、Go 留接口（见下）。
5. **提醒用最近一次成功的观测**，准备执行时不重新抓取；自动抓的触发（工作区登记后、每次正式架构采用后、检查通过后）、没有目录时只抓文件层、失败重试见 L8（第一轮审查第 9 条）。
6. **决定 63 已定（2026-10-15）：代码量所有语言都数；C/C++、Python 的引用关系在 8D；Rust、Go 留接口。**

### 0.2 代码事实（5c7a3258；lead 核过的标 ✓）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 ✓ | 自治策略已分小改和结构性修补：结构的两档都要你决定，小改在「每步确认」下要你决定 | `state/decision-policy.ts:31` |
| F2 | 目录修订 `reviseArchitectureCatalog` 已有：钉住基线、换整个目录、带原因；校验、版本核对、重放；写不再改的目录和基线版本、改当前指针。今天拒绝删模块、拒绝带依赖规则的基线，基线内容原样照抄 | `architecture/catalog-service.ts:589`、`:656-666`、`:728` |
| F3 ✓ | 检查的定案和目录修订各自一次提交；顺序调用做不到“目录和注记一起生效” | `evidence/evidence-service.ts` `finalizeChecks:1550-1569`；`catalog-service.ts:728` |
| F4 | 观测已有：抓取存下、观测对观测的差异和强连通、邻域、反向影响；`compareArchitecture` 只收两个观测；比较和影响在组合里有，没有路由；结果故意带 `noVerdict: true` | `architecture/architecture-service.ts:629`、`:650`；`architecture-delta.ts:74` |
| F5 ✓ | 观测快照只认模块和接口节点（通用的 `CodeGraphNode` 有 `file`，但校验不收）；上限 512 个节点、1,024 条边、240 KiB；映射把 import 并到模块 | `src/contracts/architecture-source.ts:47`；`architecture/graph-index.ts:91` |
| F6 | 抓取给出没归组的源文件、解析不到的 import、有映射没源文件的缺口；装配器有提醒段 | `src/core/workspace/architecture-source.ts:24`；`context-assembler.ts:854` |
| F7 | `SessionWorkLink` 支持模块目标和 `responsible`；建和挂都按当前目录校验、有版本核对；`sessions/link`、按目标找、转移、归档处置已有；Workflow 只建任务的负责关系 | `src/contracts/core/identity.ts:44`；`sessions/session-targets.ts:142`；`workflow.ts:1105` |
| F8 | 任务的 `moduleRef` 只校验是非空字符串，不核对目录里有没有 | `persistence/plan-record-codecs.ts:333`；`tasks/plan-validation.ts:37` |
| F9 | 冷启动的包含关系（`containment.parentOf`）契约、校验、传递、显示都有；初始化的回答格式里没写它 | `architecture-catalog.ts:26`；`catalog-record-codecs.ts:337`；`query-preparation.ts:61` |
| F10 | 源码映射只支持 TS/JS | `architecture-source.ts:26` |

### 0.3 lead 定的技术选择

- **L1 修补的内容格式（8C）。**【lead 定，待审】（第一轮审查第 1 条）第 4 片的注记 `kind: 'repair'` 加一个只对修补有的字段 `repair`。这个字段在第 4 片的 `NoteDraftV1` 和 `record_note` 的 `write` 输入里也是必填（`kind === 'repair'` 时）、别的 `kind` 不许有；输入用不带 `structural` 的 `RepairInputV1`（就是 `{ pin, ops, responsibilityMoves }`；`responsibilityMoves` 纳入保存内容、摘要、轮次绑定和批准对象），写入方和 codecs 照 `NoteBodyV1` 存下带平台算的 `structural` 的 `RepairPayloadV1`（第二轮审查第 2 条；最后核对第 1 条；审查二第 13 条）：
  - `pin`：完整的目录身份 `ArchitectureCatalogPinV1`（`ArchitectureCatalogRef` 加 `ArchitectureBaselinePin`），写的时候读到的目录 ref 和基线 pin（钉住）（第二轮审查第 2、3 条）；
  - `ops: CatalogRepairOpV1[]`（1–20 个）：`set_responsibility`、`set_module_name`、`set_dependency_reason`、`add_path`、`remove_path`、`add_interface`、`set_interface`、`remove_interface`、`add_module`、`remove_module`、`add_dependency`、`remove_dependency`、`add_forbid_rule`、`remove_forbid_rule`、`set_parent`，各带它要的字段；接口就是 `{ id, description, paths }`（`architecture-catalog.ts:23`），id 稳定，没有改名的 op（换 id = remove + add）；
  - `structural: boolean`：由平台按 L2 算，是唯一权威值；写入方算好一起存，存下的 `repair.structural` 和顶层 `structural` 相等；输入 `RepairInputV1` 里没有它，调用方给的不看（第二轮审查第 2 条；最后核对第 1 条）；
  - `ops` 按数组顺序应用；一条改动不了任何值的 → 退回 `invalid`、原因 `noop_op`；重复的 op / 重复端点同此；
  - 写的时候平台只解析 `ops`、把它们试套到钉住的目录上（同修订的校验）；足迹检查不在这里（L3）。
- **L2 小改和结构改动（§0.1 告知 1）。**【lead 定，待审】（第一轮审查第 1、2 条）结构：`add_module`、`remove_module`、`add_dependency`、`remove_dependency`、`add_forbid_rule`、`remove_forbid_rule`、`set_parent`；其余是小改。**改名（`set_module_name`）从小改里拿出来单列：两档都出卡、规则放不开；它保留 `moduleId` 和负责关系，不要去向，不触发删除限制，旧锚点**不**读成“模块已删”**（决定 62-3；审查二第 14 条）。一个修补里有一条结构或改名的就按要出卡算。
- **L3 范围：只在本次足迹里（决定 21）。**【lead 定，待审】（第一轮审查第 3、4 条）
  - 影响模块 = 这个任务声明的模块 ∪ 这个执行确定的文件（2B 的 `RunActivity` 里 `definite` 的路径）按钉住的目录归到的模块 ∪ 这次修补新增的模块。
  - 文字和接口的 op：只能动影响模块。
  - `add_path`、`remove_path`：路径要是这个执行确定改过的文件，或者是“最新一次观测量里这个前缀下每个文件都是这个执行确定改过的文件”的目录前缀；否则退回 `forbidden`、原因 `outside_footprint`。
  - 依赖和 forbid 规则的 op：两端都要是影响模块。
  - `set_parent`：模块要在影响模块里；`parentId` 非 null 时父模块要存在，`parentId: null` 是摘掉包含边、不查父模块（第二轮审查第 6 条）。
  - `add_module`：允许（结构）；它的 paths 按上面的路径规则。
  - `remove_module`：模块要在影响模块里（结构）。
  - 时机：写的时候只解析、只试套到 pin 上；足迹检查放在生效的时候，在那个执行的活动记下来（2B 的 `RunActivity`，这个执行的）以后。没有这条记录、记录是 unknown 或不完整 → 生效 `not_ready`、原因 `footprint_unknown`，并按第 6 条进你的卡（不论自治档位）；证实的越界是 `forbidden`、原因 `outside_footprint`。两种都保持 `staged`（第二轮审查第 5 条）。
- **L4 什么时候生效（R47）。**【lead 定，待审】（第一轮审查第 5、6 条）
  - 绑定：一轮检查开轮的时候，轮次的主体快照（`RoundSnapshot`）加 `stagedRepairs` 字段，记下这个执行暂存的修补组 `{ noteId, version, digest }[]`。生效只认这一轮对**这些确切版本**的适用 PASS；开轮以后版本变了的修补不能被这一轮生效 → `source_stale`，要新的一轮。
  - 条件全齐才生效：修补是 `staged`；所属执行的那一轮正式检查定案为通过、而且适用；要你决定的已经答复“收下”（结构的两档都要；小改在「每步确认」下要）；足迹检查过（L3）；钉住的目录身份还是现在的；目标没暂停。批准从卡答复（决定应用）读，不算新的注记版本（第二轮审查第 1 条）。
  - 答复晚到：生效前重新验目录 pin 和轮次来源（同一轮、同一组版本）。
  - 生效是**一次提交**（解决 F3）：新的目录和基线版本、当前指针、注记 `staged → accepted`（第 4 片的 S4-NOTE-09）、事件。由 notes 的写入方加一个操作 `activateRepair` 做；激活的提交守注记头版本、目录当前指针版本、轮次版本，目录的写在同一个 `PreparedCommit` 里（不调两次服务）。
  - 竞争：同一个目录 pin 上的多个修补，按轮次定案游标排、再按 note id 排；第一个赢，其余 `source_stale`，保持暂存。
  - 重启：Host 启动扫一遍 PASS 定案、还有没生效的绑定修补的轮次，加上按执行暂存的索引。
  - 重放身份：`commandId = activate:<noteId>:<version>`。
  - 暂停目标：`not_ready`、原因 `goal_paused`；恢复后重试，不是一个错误。
  - 谁触发：Workflow 在检查定案以后、和你的答复落实以后各试一次（哪个后到哪个触发）；中途重启再试；幂等。
  - 不生效的情况：检查没通过或不适用 → 保持暂存，任务返工时新的执行可以重提；目录版本变了（别的修补或你改过）→ 报 `source_stale`，保持暂存，进书记的待办和写它的 agent 下一次的提醒（§0.1 告知 2）；任务取消或被替代 → 第 4 片的“作废”，永远不生效。
  - 生效后在本目标先用（`accepted`），书记审过才跨目标（第 4 片 L6）。
  - 卡：新的来源 `repair_approval`（不是 `note_review`）：结构的修补、每步确认下的小改、**改名（`set_module_name`，两档都出卡、规则放不开）**、还有 `footprint_unknown`（审查二第 14 条）。选项 `approve` / `reject`。你的答复记在卡的消息上（决定应用），**不写新的注记版本**（没有 `change.kind: 'approve'`）、不直接生效；被检查的注记版本不变，PASS 仍覆盖它；生效时从答复里读批准。拒绝 → `staged → withdrawn`、原因 `rejected_by_user`。落实回执是答复的提交（答复本身就让条件全齐时，是激活的提交）。（第二轮审查第 1 条）
  - 修补不因你的答复变成跨目标：修补的 `confirmedByUser` 一直是 false（R47：先过书记审）——这一条覆盖第 4 片的捷径。
- **L5 修订和删模块（8C）。**【lead 定，待审】（第一轮审查第 2、7 条）
  - 删模块：还有没终结的任务声明属于它就不能删。活引用 = 这个项目里任何目标没终结的当前计划里，有没终结的任务（终结 = satisfied、cancelled、superseded）声明 `moduleRef` 是它；不能删 → 退回 `invalid`、原因 `module_in_use`，列出是谁在用。模块上开着的负责关系**不再一律挡住删除**：这次修订必须给每个受影响的开着的负责关系写明去向（模块维护者、区域参谋、区域书记都算），去向是哪个新模块、或转待命；缺去向 → 退回 `invalid`、原因 `responsibility_destination_missing`。平台在同一次提交里用 7D1 的 `planReanchor` 挪这些关系，目标模块按这次提交里的新目录验证（审查二第 18 条）。碰模块的边（依赖、forbid 规则、包含关系）必须在同一次修订里用 op 删掉；否则退回 `invalid`、原因 `module_has_edges`。（第二轮审查第 6 条）
  - 改显示名和换身份：改显示名用 `set_module_name`（`{ op: 'set_module_name'; moduleId: string; name: string }`，`name` 的规则同目录里的模块名），保留 `moduleId` 和负责关系，不算结构改动、不要去向，**不触发删除限制、旧锚点不读成“模块已删”**；换身份 = `remove_module` + `add_module`，按上面带去向，**只有 `remove_module`/换身份才查删除限制、处置去向、旧锚点读作已删**。（审查二第 14 条）
  - 拆、合模块没有专门的 op：拆、合用 `add_module`、`remove_module`、`add_path`/`remove_path`、`set_parent` 组合表达；`responsibilityMoves` 覆盖这次被 `remove_module` 的每个模块上开着的负责关系。
  - 竞态：生效的时候重读引用，并守它读到的每个目标当前计划指针版本；有并发的采用就让提交失败，生效重试。
  - 历史不改：旧计划、旧注记的锚点照旧，读的时候标“模块已删”。
  - 依赖规则：修订按 `add_forbid_rule` / `remove_forbid_rule` 改基线里的 `dependencyRules`；规则由 `(from, to)` 定身份，端点必须存在。
  - DAG：`requireDag` 在 MVP 一直是真，今天的校验器直接拒绝 `false`（`catalog-record-codecs.ts:263`）；本片不放开，也不设 `set_require_dag`。
- **L6 修订接口。**【lead 定，待审】（第一轮审查第 1、5 条）路由 `architecture/revise`：只认人，请求 `{ commandId, expected: ArchitectureCatalogPinV1, ops, reason, responsibilityMoves }`（完整的目录身份，不再是裸 number；`responsibilityMoves` 是每个受影响的开着负责关系的去向，L5，用 7D1 的 `planReanchor` 表达），和 `reviseArchitectureCatalog` 同样的守（项目/工作区/基线 pin）、同样的校验、同样的重放。agent 改目录只有两条路：修补（L1–L4）和结构修订提议；两条路都带 `responsibilityMoves`。界面以后做。（第二轮审查第 3 条；审查二第 18 条）
  - **结构修订提议通路（8C，接冷启动 61-4）。** 工具 `propose_architecture_revision { baseCatalogPin, ops, responsibilityMoves, reason, operationRef? }`（参谋；只读探索的线也能提），覆盖这次被删、换身份、拆、合的模块上每个开着的负责关系。提议时平台把 `ops` 和 `responsibilityMoves` 试套到 `baseCatalogPin` 上，校验和 `architecture/revise` 完全相同（op 合法、去向齐全、去向模块存在、同职责一个模块一个负责人）；不过就当场回 `invalid`（原因同修订），不出卡；通过就保存 `ArchitectureProposalV1`（§2），回执按下面的冻结阶段返回（单成员批次回 `needs_decision` 带 `cardKey`，冷启动 `proposals` 阶段冻结前回 `pending_batch`）。**展示合并批准前先冻结一个批次 `ArchitectureProposalBatchV1`（§2）：批次身份 `batchRef`、完整成员 `proposalRef`、`baseCatalogPin`、合并后的 `ops`、`responsibilityMoves`、摘要；平台按稳定顺序（提议键升序）把完整修订和负责关系试套，全部通过才能合；冲突的 op 不覆盖、各自另成一批。**平台出一张卡（卡源 `structural_proposal { batchRef }`，主体 `project`；7D2 定的名字）给你批；**批准绑定这个冻结批次，一次提交落实它的全部效果；晚到的提议另成批次；批次内容或 `baseCatalogPin` 变了不复用旧批准**；落实由**第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的 `baseCatalogPin` 落实**（目录、负责关系、唯一性，用 `planReanchor`，目标模块按这次的新目录验证）；批准时再按冻结的 `baseCatalogPin` 核一次：目录已经变了回 `source_stale`，卡读作“已过时，要重提”，不落实；**不走修补的 PASS 和足迹门槛**（那条路是 L1–L4 的修补，修补照旧）。同一个冷启动里同时在等的提议合成一个批次、一张卡（冻结时机见 7D2 L41 第 6 段）；粗分（7D2 L41 第 4 段）、冷启动以外的提议、和冷启动批次冻结后才到的提议，各自立即冻成只有它一个成员的批次，回 `{ status: 'needs_decision'; proposalRef; cardKey }`；冷启动 `proposals` 阶段冻结前提的回 `{ status: 'pending_batch'; proposalRef }`（没有 `cardKey`），冻结出卡以后经 `architecture/proposals/read { proposalRef }` 读到 `{ proposal, batchRef, cardKey }`（审查二快速核对第 5 条）；拒绝不落实，批次里的提议都记 `rejected`。（审查二第 12 条；单成员批次是审查二 lead 补）
- **L7 正式和观测的比较（8A）。**【lead 定，待审】（第一轮审查第 8 条）`compareFormalObserved({ catalog: ArchitectureCatalogPinV1, captureRef: ObservedCaptureRef })`，`ObservedCaptureRef` 用已有观测记录的 ref（第二轮审查第 3 条）：
  - 模块的形式文件集 = 这次观测里的文件按模块 paths 的最长前缀归到它（同 `mapExecutedFilesToModules` 的最长前缀规则）；等长的并列 → 这个文件算 `ambiguous`（不知道）。
  - 声明的依赖和观测到的 import 按模块汇总（声明了没看到、看到了没声明）；一个模块沾到没归组的文件或解析不到的 import，它的“缺”一律报 `unknown`，不当“没有”；**unsupported、failed、没配置、解析不全的文件涉及的依赖只能是 `unknown`，不能报成确定的 `dependency_missing`；部分失败照实汇总**（审查二第 16 条）。
  - 观测到的环照实报，不套正式的无环规则。
  - 只读、不采用任何东西，带 `noVerdict: true` 和覆盖说明（同 F4）。
  - 比较按 `(catalog pin, captureRef)` 定身份（第二轮审查第 3 条）。
  - 根路径统一用 `.`：路径是 `.` 的模块覆盖所有相对路径，匹配长度算 0、在所有具体前缀里优先级最低（没有更长前缀命中时才归它）。**根路径规则覆盖全链：contracts（`architecture-source.ts:34`）、`architecture-service.ts:98/135` 的输入映射、工作区侧 `workspace/architecture-source.ts:27/38`、WorkGraph 的所有前缀匹配，至少这几处：`goal-conflicts.ts:470/492`（`mapExecutedFilesToModules`、`matchingPrefixLength`）、`graph-index.ts:96`（`resolveAnchorNodes`）、`architecture-record-codecs.ts:265`，以及 F5 引的 `graph-index.ts:91`、`catalog-record-codecs.ts:263`；施工时按 `startsWith(path + '/')` 这种写法在 `src/core/work-graph/` 里找全。只有模块前缀／映射节点允许 `.`，文件和配置路径的校验不放宽；模块归属统一最长前缀，`.` 长度为 0；等长歧义统一报 `unknown`；观测的模块节点和边用同一个归属结果**（审查二第 17 条）。源码映射的 `safeRelativePath` 额外接受 `.`（原来相对路径不能是 `.`）。
  - 新路由 `architecture/compare-formal`，和今天的观测对观测比较分开；`architecture/impact` 把 F4 的影响接上路由。
- **L8 准备执行时的过时提醒（决定 21；8A）。**【lead 定，待审】（第一轮审查第 9 条）
  - 自动抓：工作区登记后、每次正式架构采用（初次和修订）后、每轮正式检查通过定案后，各抓一次观测（按已有的抓取）；准备执行时不抓。还没有采用目录时也能抓，只抓文件层（L12），模块层结果为空；“没被任何模块路径覆盖”的文件集合由正式和观测的比较算出（L7），不靠目录里有没有模块。失败记一条，下一次 Host 启动或下一个触发时重试；设置页的手动按钮保留。提醒只用最近一次成功的观测。
  - 移动：把最新一次观测和它的前一次（按观测时刻排的前一个）比。某条路径在最新里没了、同样的摘要恰好在一个新路径出现 → “可能移动”；出现在好几个新路径 → 什么都不说。
  - 一个任务的未归组文件：最新一次观测里没归组、且和这个任务模块的某条 path 共享最长目录前缀的文件。
  - 提醒这几类：声明的依赖没有 import、import 没有声明的依赖、新文件没归组、可能移动；写进装配器的提醒段，最多 10 行，多的进省略行；每行带观测的时刻（“3 小时前的观测”）；没有观测就写“还没有观测”。
  - 顺序：先按种类、再按路径。
  - 不另存“过时”的标记（读的时候算）。
- **L9 模块负责人（8B）。**【lead 定，待审】（第一轮审查第 10 条）
  - 负责人是一条长期线（决定 25）对模块目标的 `responsible` 负责关系（F7），不放进注记（决定 49 · Q8）。
  - 唯一：每个开负责关系的写入方（建、挂、转移、接续）都要取一条唯一的 claim `module-maintainer:<module key>`，owner 是 link key；同一个 owner 再来一次是幂等；转移把 claim 一起搬。
  - **区域参谋和维护者分开占位（7D1 L24）**：区域参谋（负责一块模块区域的长期线）用角色范围的占位 `role-scope:` + duty + target，和 `module-maintainer:` 是两条 claim；同一个模块上可以同时有一个维护者和一个区域参谋，互不抢 claim。**区域 = 这个模块加 containment 下的全部子模块（containment 子树）；有效负责范围还要按 7D1 L23 减去同职责更深的负责区域；有更深负责人时归更深的那个，没有才归这条线**（审查二第 6 条）；区域参谋只做判断（接口约定、这块的架构修订、对结构改动的意见），维护者才是模块的负责人。
  - 谁能指定：按 §0.1 第 3 条。路由 `modules/assign-maintainer`（你）；参谋的指定经第 7 片的工具，本片只做写入方和规则。
  - 一条线维护好几个模块时，归到 id 最小的那个模块下，其余模块显示“也负责”。
  - 负责人的线归档时，照已有的归档处置：交给另一条线或放下（放下以后模块没有负责人）。
  - 2C 的“按模块分组”读这些负责关系，模块维护的线分到它维护的模块下；8B 在 2C 合入后把 2C 的 `maintainer: none` 换成真的负责人。
- **L10 任务所属模块的检查（8B）。**【lead 定，待审】（第一轮审查第 11 条）
  - 一份提案记 `catalogPin: ArchitectureCatalogPinV1 | null`：有活动目录时是提案时活动的目录身份，没有活动目录时是 `null`（第二轮审查第 3、4 条）。
  - 提计划时：`catalogPin` 不是 null，每个任务的 `moduleRef` 必须在这份 `catalogPin` 里存在；`catalogPin` 是 null 时这项成员检查推迟到采用（第二轮审查第 4 条）。
  - 采用时：不是 null 的对着采用时活动的目录核一次；提案 `catalogPin` 是 null 的（还没有活动目录的初次采用）由治理决定选出目录、对着这个选中的目录核并绑定它。不存在 → 退回 `invalid`、原因 `unknown_module`，列出任务。没有验收的未来意图也一样核对。（第一轮审查第 11 条；第二轮审查第 4 条；最后核对第 2 条）
  - 初次采用：`catalogPin` 是 null（还没有活动目录），绑定的就是这次治理决定选中的目录（第二轮审查第 4 条）。
  - 最小初始架构（61-2）：整个工作区一个根模块，paths 是 `['.']`。没摸清之前也能采用第一个计划（例如“摸清现状”的探索任务），之后再拆；采用前必须有初始架构这条不变。**“未细分”是读出来的**：一个模块 path 是 `.` 且没有子模块，读的时候标“未细分”；不加目录字段（目录的精确键校验会拒绝新字段）。
  - 已经采用的旧计划不回头核。
  - 这是引用检查，不是派工闸门（决定 49）。
- **L11 冷启动声明包含关系（8B）。**【lead 定，待审】初始化的回答格式里加可选的 `containment.parentOf`（F9 的契约已有）；没给就是“不知道”，不当成“全是平的”；不按目录猜上下级。**区域 = 一个模块加 containment 下的全部子模块（containment 子树）**（读法；7D1 L23 的 `RoleScopeV1` region）；**有效负责范围不等于 containment 子树：统一按 7D1 L23 减去同职责更深的负责区域**（审查二第 6 条）；**containment 不知道时区域只算这个模块自己，不推断子孙**。
- **L12 文件级观测图（8A）。**【lead 定，待审】（第一轮审查第 12 条）
  - 抓取加文件节点和文件到文件的 import 边（引用关系按决定 63 的提供者接口接入：TS/JS 是第一个提供者，C/C++、Python 在 8D）。**捕获的 owner 先形成一份按权限过滤、冻结的材料（源码、需要的配置、身份、摘要）；提供者只用这份材料（或它冻结的 `ProjectSourceAccess` 适配器），不各自去读不同时间的工作树**（审查二第 15 条）。
  - 存法：文件级的图存在分块的 artifact 里，每块最多 256 KiB（artifact 容量），最多 64 块，块列表写在观测记录里；和模块级的分开存，模块级的不变。
  - 上限（没实测，DESIGN §9.3）：一次观测最多 20,000 个文件、100,000 条边；超了退回 `capacity`，并给出数到多少，不截断当全部。
  - 身份：文件节点 = 工作区相对路径；边 = `(from, to)`。每个文件节点带 `nonBlankLines`（非空行数；**所有文本源码文件都数**，二进制、超过读上限的文件不当文件节点，记进它那门语言覆盖的 `issues`（`kind: 'skipped'`）并写原因（读上限每个文件 2 MiB，同现有的 C/C++、Python 解析器；含 NUL 字节算二进制），不用解析器）和 `language`（按扩展名认：typescript 是 .ts .tsx .mts .cts .js .jsx .mjs .cjs；cpp 是 .c .cc .cpp .cxx .h .hh .hpp .hxx .inc .ipp .inl .tcc；python 是 .py .pyi；rust 是 .rs；go 是 .go；认不出是 `other`），供 7D2 L28 按区域位置读（`REGION_SLOT_LINE_BUDGET`，非空行）；不另存一套代码量；**解析器失败不抹掉已经读到的 `nonBlankLines`**（审查二第 16 条）。
  - **语言覆盖（决定 63）**：观测结果加每种语言的覆盖 `languages: LanguageCoverageV1[]`（§2：文件数、解析成功数、失败/跳过的文件和原因、`edges` 覆盖状态、是否完整）；**逐语言把 unsupported、stale、cancelled、分析失败、容量映射成覆盖状态，公开读出文件数、解析成功数、失败/跳过的文件和原因、是否完整；部分失败照实汇总**（审查二第 16 条）；没有提供者的语言 `unsupported`，读的时候写“引用关系未支持”，不当成“没有引用”；**unsupported、failed、没配置、解析不全的文件涉及的依赖只能是 `unknown`，不能报成确定的 `dependency_missing`**（审查二第 16 条）；引用关系只影响“未探索”和比较，不影响区域位置。TS/JS 的提供者把今天 `capture.ts` 用的 `TypeScriptSourceAnalyzer` 包进 §2 的 `ArchitectureLanguageProviderV1`；**没有 TS 文件不能让纯 Python/C++ 项目整体失败（`capture.ts:207`、`project-source-snapshot.ts:48/70` 要改）**（审查二第 15 条）。
  - 旧观测没有文件级图 → 读的时候报 `not_captured`。
  - 公开读：`neighbors(file)`、`impact(file, depth ≤ 3)`、架构页用的 `listFiles(page)`；一页 200。都回 `FileGraphPageV1`：`nodes` 按工作区相对路径排，只返回这一页节点之间的 `(from, to)` 边，游标只对同一 `captureRef` 和同一查询有效（对不上 → `invalid`、`cursor_mismatch`）。（第二轮审查第 3 条）
- **L13 C/C++、Python 的引用关系（8D，决定 63-2）。**【lead 定】
  - C/C++ 提供者复用 `src/core/workspace/cpp-source-index.ts`（libclang，靠项目的 `compile_commands.json`；没有它就 `failed`，原因写明）；**真实依赖分开写：C/C++ 要系统 Python 和 libclang（`cpp-source-index.ts:61/66`，可注入 `libraryPath`、`pythonPath`）；配置选择沿现有规则冻结：C/C++ 用根上的 `compile_commands.json`，没有就用唯一的一个，有多个这门语言 `failed`（原因“有多个编译数据库”）；Python 依次找根上的 `pyrightconfig.json`、`pyproject.toml`、`setup.cfg`，都没有时用工作区根（`src/` 下有 `.py` 再加 `src`）；每个分析器第一次查询拿到它自己的 snapshot，之后翻页一律带这个值（`expectedSnapshot`），捕获身份由捕获 owner 另核；转换结果、去重、保留 unresolved**（审查二第 15 条；审查二快速核对第 6 条）；
  - Python 提供者复用 `src/core/workspace/python-source-index.ts`，要 `.local/source-analyzers` 的分析器包（审查二第 15 条）；
  - 两者都按冻结材料工作，装不上时这门语言读作 `failed`，不影响别的语言；观测的 `languages` 覆盖照 L12 记（审查二第 15 条）；
  - **覆盖从哪里来（审查二快速核对第 6 条）**：今天两个分析器只回前 30/40 条诊断（`python-source-index.ts:91`、`cpp-source-index.ts:79`），Python 的语法失败只在诊断里（`python-source-query.py:232`），从这些推不出完整的失败文件数和 `parsed`。8D 给两个分析器补上截断以前的逐文件解析结果和全量统计（改两个 `*-source-index.ts` 和 `scripts/python-source-query.py`、`scripts/cpp-source-query.py`），再按 §2 的口径生成 `LanguageCoverageV1`；只截存进记录的 `issues`，不从截断的诊断推算成功数；`complete` 按 §2 的公式算，不照抄底层的 `coverage.complete`（C/C++ 底层那个是语义覆盖声明，`cpp-source-query.py:344`）。
  - 单独验收（新测试入口 AE6 多语言引用（8D）），和其他测试入口一起等用户确认；Rust、Go 不在这一轮做（§8）。

### 0.4 和别的片的接缝

- **第 4 片：** 修补暂存、作废、注记卡（8C 的生效、答复）；`NoteDraftV1` 和 `record_note` 的 `write` 输入加不带 `structural` 的 `RepairInputV1`，写入方和 codecs 存下带 `structural` 的 `RepairPayloadV1`（L1）；装配器提醒段（8A）。（第一轮审查第 5、6 条；第二轮审查第 2 条；最后核对第 1 条）
- **第 5 片：** 自治策略和决定队列（L4 的卡）。（第一轮审查第 6 条）
- **2B：** `RunActivity` 的 `definite` 文件（L3 的足迹）；没有就是 `footprint_unknown`。（第一轮审查第 3 条）
- **2C：** 按模块分组、节点详情（L9 显示负责人）；8B 把 `maintainer: none` 换成真负责人。（第一轮审查第 10 条）
- **第 7 片（7D1、7D2）：** 参谋指定负责人的工具、建成员、`planReanchor` 和 `role-scope:` 占位属 7D1（在 8C 之前）；区域位置读 8A 的 `nonBlankLines` 和 8B 的 containment、修订和复制目标的负责去向、冷启动两步和结构修订提议的合卡属 7D2（在 8D 之后）。（第一轮审查第 10、13 条；审查二第 18 条）
- **第 1 片/正式检查：** 轮次主体记这个执行的修补组（L4 的绑定）。（第一轮审查第 5 条）
- **目录/计划：** 提案记 `catalogPin: ArchitectureCatalogPinV1 | null`（L10）；没有活动目录时是 null；采用时非 null 的对着采用时活动的目录核，null 的（初次采用）绑治理决定选中的目录。（第一轮审查第 11 条；第二轮审查第 4 条；最后核对第 2 条）

## 1. 范围

> 顺序（审查二第 18 条）：`4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C`。7D 拆成 **7D1 共享基础**（在 8C 之前：`WorkLinkTarget` 加 `goal`/`project` 整套、`planReanchor`/`reanchorSessionResponsibility` 和 transfer 扩展、`role-scope:` 占位、项目主体卡源、`SessionRoleFactsV1`、`RoleLineAllocationV1` 和保留准入）和 **7D2 角色线编排**（在 8D 之后：开局线、你开线、位置、拆分、运行准入、上限卡、队列、规则、冷启动、L46 以外的 7D 规则；L46 仍属 7B）。本节各线以“7D1 可验”或“7D2 联动补验”标注。

- **8A：** L7、L8、L12；路由 `architecture/compare`（观测对观测，接 F4）、`architecture/compare-formal`（正式对观测，新）、`architecture/impact`；文件级观测的 `nonBlankLines`（所有语言都数）和 `language`、按语言的 `languages` 覆盖和 `ArchitectureLanguageProviderV1`（TS/JS 第一个提供者）、根路径 `.` 和最长前缀匹配、自动抓（工作区登记后、正式采用后、检查通过后）和无目录时的文件层抓取、失败重试。（第一轮审查第 8、12 条；决定 63；审查二第 18 条）（7D1 可验）
- **8B：** L9、L10、L11；路由 `modules/assign-maintainer`；区域（containment 子树）和有效负责范围分开（有效负责范围按 7D1 L23 减去同职责更深的负责区域）；区域参谋和维护者分开占位；最小根模块 `.`。（第一轮审查第 10 条；审查二第 6 条；审查二第 18 条）（7D1 可验）
- **8C：** L1–L6（含删模块 L5）；路由 `architecture/revise`、`architecture/proposals/read`；结构修订提议通路（agent 提、你批、第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的基线 pin 落实，提议校验同修订、不过当场回 `invalid`、批准时 pin 变了回 `source_stale`，不走修补的 PASS 和足迹门槛）和冷启动合卡；修订和提议都带负责去向 `responsibilityMoves`；换身份 = 删加带去向（只有它和删模块才查删除限制、处置去向、旧锚点读作已删），改显示名用 `set_module_name` 保留 `moduleId` 和负责关系、两档都出卡、不触发删除限制、旧锚点**不**读作已删；拆、合用组合 op 表达；Workflow 的生效触发和 Host 启动扫。（第一轮审查第 7、13 条；决定 63；审查二第 14 条；审查二第 18 条）（修补生效和单成员批次的结构提议 7D1 可验；冷启动合卡和探索编排 7D2 联动补验；审查二快速核对第 5 条）
- **8D：** L13；C/C++ 提供者复用 `src/core/workspace/cpp-source-index.ts`（libclang、`compile_commands.json`，要系统 Python 和 libclang，可注入 `libraryPath`、`pythonPath`），Python 提供者复用 `src/core/workspace/python-source-index.ts`（要 `.local/source-analyzers` 的分析器包）；都按冻结的 `ProjectSourceAccess` 材料、同一 `expectedSnapshot` 工作，装不上时这门语言读作 `failed`、不影响别的语言；测试入口 AE6。（决定 63；审查二第 15 条；审查二第 18 条）（7D1 可验）

**不在本片：** Rust、Go 的引用关系（不在这一轮做，留 8A 的提供者接口，§8）；按名字猜文件改名；修补的自动合并；界面（E3：完整架构图页的文件级数据、结构改动的卡）。

## 2. 接口（第一稿，冻结时细调）

```ts
// src/contracts/architecture-catalog.ts（8C 把目录身份的纯类型从 WorkGraph 提上来；第二轮审查第 3 条）
export type ArchitectureCatalogRef = Omit<ArchitectureBaselineRevisionRef, 'aggregateType'> & { aggregateType: 'ArchitectureCatalog' };
export type ArchitectureCatalogPinV1 = { catalogRef: ArchitectureCatalogRef; baseline: ArchitectureBaselinePin };

// src/contracts/note.ts（第 4 片的文件，8C 加）
// 接口形状就是 { id, description, paths }（architecture-catalog.ts:23）；id 稳定，没有 rename。
export type CatalogInterfaceV1 = { id: string; description: string; paths: string[] };
export type CatalogRepairOpV1 =
  | { op: 'set_responsibility'; moduleId: string; text: string }
  | { op: 'set_module_name'; moduleId: string; name: string }
  | { op: 'add_path' | 'remove_path'; moduleId: string; path: string }
  | { op: 'add_interface'; moduleId: string; interface: CatalogInterfaceV1 }
  | { op: 'set_interface'; moduleId: string; interfaceId: string; description?: string; paths?: string[] }
  | { op: 'remove_interface'; moduleId: string; interfaceId: string }
  | { op: 'set_dependency_reason'; from: string; to: string; reason: string }
  | { op: 'add_module'; module: ModuleDefinition }
  | { op: 'remove_module'; moduleId: string }
  | { op: 'add_dependency'; from: string; to: string; reason: string }
  | { op: 'remove_dependency'; from: string; to: string }
  | { op: 'add_forbid_rule'; from: string; to: string; reason: string }
  | { op: 'remove_forbid_rule'; from: string; to: string }
  | { op: 'set_parent'; moduleId: string; parentId: string | null };
// 改显示名的 op 是 `set_module_name`（保留 `moduleId` 和负责关系，不算结构改动、不要去向，不触发删除限制）；换身份 = `remove_module` + `add_module` 带去向（L5；审查二第 14 条）
// 完整 pin：目录 ref 和基线 pin 都在（第一轮审查第 1 条；第二轮审查第 3 条）
// 输入（NoteDraftV1 和 `record_note` 的 `write` 输入）没有 structural，就是 { pin, ops, responsibilityMoves }（最后核对第 1 条；审查二第 13 条）
export type RepairInputV1 = { pin: ArchitectureCatalogPinV1; ops: CatalogRepairOpV1[]; responsibilityMoves: ResponsibilityMoveV1[] };   // 每个受影响的开着负责关系的去向，纳入保存内容、摘要、轮次绑定和批准对象（审查二第 13 条）
// 存下的完整载荷带平台按 L2 算的 structural（最后核对第 1 条）
export type RepairPayloadV1 = { pin: ArchitectureCatalogPinV1; ops: CatalogRepairOpV1[]; responsibilityMoves: ResponsibilityMoveV1[]; structural: boolean };   // 责任去向纳入保存内容（审查二第 13 条）
// 第 4 片的 NoteDraftV1 和 `record_note` 的 `write` 输入加 repair?: RepairInputV1：
// kind === 'repair' 时必填，别的 kind 不许有；写入方和 codecs 照 NoteBodyV1 存下 repair?: RepairPayloadV1（第二轮审查第 2 条）。
// 写入方算好同一个 structural，放进存下的 repair.structural 和顶层 structural；调用方给的值不看（第二轮审查第 2 条；最后核对第 1 条）
// NoteBodyV1 加 repair?: RepairPayloadV1（只 kind === 'repair' 有）

// architecture：新的修订路由请求（只认人，第一轮审查第 1、5 条）
// 每个受影响的开着负责关系的去向（L5：模块维护者、区域参谋、区域书记都算），缺去向 → invalid/responsibility_destination_missing
export type ResponsibilityMoveV1 = { link: SessionWorkLinkRef;
  to: { kind: 'standby' } | { kind: 'modules'; destinations: ModuleRef[] } };   // destinations 非空、去重；每个源负责关系恰好一项；一次关闭原链接、开启全部新链接，最后核唯一性（审查二第 13 条）
export type ReviseArchitectureCatalogOpsInput = {
  commandId: string;
  expected: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[];
  reason: string;
};
// 结构修订提议（8C，L6；E6）：agent（参谋、只读探索的线）提、你批、第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的基线 pin 落实
export type ArchitectureProposalRef = { projectId: string; proposalId: string; aggregateType: 'ArchitectureProposal' };
// state：pending（提议时写）→ applied（你批后，在同一次修订提交里写）/ rejected（你答“不采用”的落实写）/ stale（批准时发现目录变了，落实写）
export type ArchitectureProposalV1 = {   // 提议记录（E6）
  ref: ArchitectureProposalRef; baseCatalogPin: ArchitectureCatalogPinV1; ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[]; reason: string; proposer: SessionRef;
  operationRef: OperationRef | null; state: 'pending' | 'applied' | 'rejected' | 'stale';
};
// 展示合并批准前冻结的批次（审查二第 12 条）：完整成员、合并后的 ops 和负责关系、摘要；批准绑定它、一次提交落实全部
export type ArchitectureProposalBatchRef = { projectId: string; batchId: string; aggregateType: 'ArchitectureProposalBatch' };
export type ArchitectureProposalBatchV1 = {
  ref: ArchitectureProposalBatchRef; members: ArchitectureProposalRef[]; baseCatalogPin: ArchitectureCatalogPinV1;
  ops: CatalogRepairOpV1[]; responsibilityMoves: ResponsibilityMoveV1[]; digest: string;   // 批准绑定这个冻结批次（审查二第 12 条）
};
// 返回：提议时平台把 ops 和 responsibilityMoves 试套到 baseCatalogPin 上，校验和 architecture/revise 完全相同；不过就当场回 invalid（原因同修订）、不出卡；
// 成功回 { status: 'needs_decision'; proposalRef; cardKey }。批准时按冻结的 baseCatalogPin 再核一次：目录变了回 source_stale，卡读作“已过时，要重提”，不落实。
// 卡源 structural_proposal { batchRef }（主体 project）；冷启动同批合成一个批次、一张卡；内容或 pin 变了不复用旧批准；不走修补的 PASS 和足迹门槛（审查二第 12 条）
propose_architecture_revision(ctx, input: { baseCatalogPin: ArchitectureCatalogPinV1; ops: CatalogRepairOpV1[];
  responsibilityMoves: ResponsibilityMoveV1[]; reason: string; operationRef?: OperationRef }):
  Promise<{ status: 'needs_decision'; proposalRef: ArchitectureProposalRef; cardKey: string   /* 第 5 片 DecisionCardV1.cardKey */ }
        | { status: 'pending_batch'; proposalRef: ArchitectureProposalRef }   // 冷启动 proposals 阶段、批次冻结以前（审查二快速核对第 5 条）
        | { status: 'invalid'; reason: string }>;
// 读（只读，人和 agent 都能调）：architecture/proposals/read { proposalRef } →
//   { proposal: ArchitectureProposalV1; batchRef: ArchitectureProposalBatchRef | null; cardKey: string | null }（冻结以前两者是 null；审查二快速核对第 5 条）

// src/contracts/verification.ts（8C 加，第一轮审查第 5 条）
// RoundSnapshot（轮次主体快照）加 stagedRepairs: { noteId: string; version: number; digest: string }[]

// work-graph：notes 写入方加
activateRepair(ctx, input: { commandId: string; noteId: string; expectedVersion: number }): Promise<ActivateRepairResult>;
// 'activated' | 'not_ready'（reason: footprint_unknown | goal_paused | 缺的别的条件；证据缺）| 'forbidden'（reason: outside_footprint；证实的越界）| 'source_stale' | 'invalid'（作废）
// 批准从卡答复（决定应用）读，不写新注记版本（第二轮审查第 1 条）；not_ready 和 forbidden 都保持 staged（第二轮审查第 5 条）

// architecture：观察 DTO（8A 加，第二轮审查第 3 条）
// ObservedCaptureRef 就是已有观测记录的 ref，字段不改
export type ObservedCaptureRef = { aggregateType: 'ObservedArchitecture'; projectId: string; workspaceId: string; captureId: string };
// 正式对观测的比较：findings 里“不知道”和“没有”分开，按 path、再按种类排
export type FormalObservedComparisonV1 = {
  catalog: ArchitectureCatalogPinV1; captureRef: ObservedCaptureRef;
  findings: FormalObservedFindingV1[]; noVerdict: true;
};
export type FormalObservedFindingV1 = {
  kind: 'dependency_missing' | 'import_undeclared' | 'ungrouped' | 'unresolved' | 'ambiguous' | 'cycle';
  moduleRef: ModuleRef | null; path: string | null; detail: string;
  certainty: 'proven' | 'unknown';
};
// 文件级图一页：nodes 按 path 排，只返回这一页节点之间的边；游标只对同一 captureRef 和同一查询有效
// 每个节点带 nonBlankLines（所有语言都数；7D2 L28 的区域位置按它算；审查二第 18 条）和 language（按扩展名认，认不出是 other）
export type FileGraphPageV1 = {
  captureRef: ObservedCaptureRef; nodes: { path: string; nonBlankLines: number; language: string }[]; edges: { from: string; to: string }[];
  nextCursor: string | null; complete: boolean; notCaptured?: true;
};
// 观测记录加每种语言的覆盖（决定 63，8A）：文件数、解析成功数、失败/跳过的文件和原因、是否完整；部分失败照实汇总（审查二第 16 条）
export type LanguageCoverageV1 = { language: string; files: number; parsed: number;
  edges: 'supported' | 'unsupported' | 'failed'; reason: string | null;   // reason：整门语言失败或不支持的原因（没有 compile_commands.json、分析器不可用、stale、cancelled、capacity），否则 null
  issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[]; issueCount: number; complete: boolean };
// issues 按 path 排、最多 COVERAGE_ISSUES_MAX = 100 条（存进观测记录），issueCount 是全数；complete = edges 是 supported、parsed 等于 files、issueCount 是 0。
// parsed：TS/JS 是分析器读进的文件；Python 是没有语法错误的文件；C/C++ 是 compile_commands.json 里的编译单元加它们 include 到的工作区头文件，
// 没有编译单元 include 到的头文件记 skipped、原因“没有编译单元包含它”。（审查二第 16 条；字段形状、上限和 parsed 的口径是审查二 lead 补）
// languages: LanguageCoverageV1[]；没有提供者的语言 unsupported，读作“引用关系未支持”，不当成“没有引用”（审查二第 16 条）
// unsupported、failed、未配置或解析不全的文件的依赖只能是 unknown，不报成确定的 dependency_missing（审查二第 16 条）

// 按语言接入的提供者（决定 63-3，8A；TS/JS 是第一个提供者，C/C++、Python 在 8D，Rust、Go 留接口）
// 提供者只消费捕获 owner 冻结的材料（或它冻结的 ProjectSourceAccess 适配器），不各自读不同时间的工作树（审查二第 15 条）
export interface ArchitectureLanguageProviderV1 {
  readonly language: 'typescript' | 'cpp' | 'python' | 'rust' | 'go' | string;
  claims(path: string): boolean;                       // 认哪些文件
  extractImports(input: { source: ProjectSourceAccess; signal: AbortSignal }): Promise<{   // 只用冻结材料；分析器第一次查询拿到自己的 snapshot，翻页都带它（expectedSnapshot）；捕获身份由捕获 owner 在全部提供者结束后另核（审查二第 15 条；审查二快速核对第 6 条）
    analyzerSnapshot: string | null;                   // 这门语言分析器的 snapshot；没有分析器的是 null
    edges: { from: string; to: string }[];             // 都是工作区里的相对路径
    unresolved: { from: string; specifier: string }[]; // 转换结果、去重后保留 unresolved
    coverage: { files: number; parsed: number; issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[]; complete: boolean; reason: string | null };   // 提供者给全量 issues，捕获 owner 存的时候截到 COVERAGE_ISSUES_MAX（审查二 lead 补）
  }>;
}
// ProjectSourceAccess：捕获 owner 冻结的、按权限过滤的材料适配器（源码、需要的配置、身份、摘要）（审查二第 15 条）
// 根路径统一 `.`：path 是 `.` 的模块覆盖所有相对路径，匹配长度 0、优先级最低（L7）

compareFormalObserved(ctx, input: { catalog: ArchitectureCatalogPinV1; captureRef: ObservedCaptureRef }): Promise<ReadResult<FormalObservedComparisonV1>>;
// 文件级图的三条公开读（第一轮审查第 12 条）
neighbors(ctx, input: { captureRef: ObservedCaptureRef; file: string; direction: 'out' | 'in'; limit: number; cursor: string | null }): Promise<ReadResult<FileGraphPageV1>>;
impact(ctx, input: { captureRef: ObservedCaptureRef; file: string; depth: number; limit: number; cursor: string | null }): Promise<ReadResult<FileGraphPageV1>>; // depth ≤ 3，一页 200
listFiles(ctx, input: { captureRef: ObservedCaptureRef; cursor: string | null }): Promise<ReadResult<FileGraphPageV1>>; // 架构页用，一页 200

// 提案（8B，第一轮审查第 11 条；第二轮审查第 4 条）
// PlanProposal / PlanRevisionDraft 记 catalogPin: ArchitectureCatalogPinV1 | null
// 有活动目录时是提案时的目录身份；没有时是 null，成员检查推迟到采用。采用时非 null 对着采用时活动的目录核，null（初次采用）对着治理决定选中的目录核并绑定（最后核对第 2 条）
```

路由：`architecture/compare`、`architecture/compare-formal`、`architecture/impact`（8A）；`modules/assign-maintainer`（8B，只认人）；`architecture/revise`（8C，只认人）。（第一轮审查第 8 条）

## 3. 状态行

表列 = 行、from、事件、guard（拒绝）、actor、effect、拒绝码、改。id 不占旧 PLAN/MSG/GOAL 编号；guard 列写守卫上下文的布尔或枚举，具体字段名施工第一段列进 UNSPECIFIED、lead 冻结（同第 5 片 §3.1）。所有拒绝保留 state、不 mint 新业务结果；缺目标/注记/轮次回 `not_found`；损坏 codec/回执回 `unavailable`；容量回 `capacity`。

- 验证时机（审查二第 18 条）：S8-ROUND-01、S8-REPAIR-01、S8-REPAIR-02、S8-CAT-01、S8-CAT-02、S8-LINK-01 标“7D1 可验”；S8-PROP-01 的单成员批次、项目主体卡源和真实批准提交“7D1 可验”，冷启动合卡和探索编排“7D2 联动补验”（审查二快速核对第 5 条）。7D1 共享基础含 `planReanchor`/`reanchorSessionResponsibility` 和 transfer 扩展、`role-scope:` 占位、项目主体卡源、`SessionRoleFactsV1`、`RoleLineAllocationV1` 和保留准入；7D2 含开局线、你开线、位置、拆分、运行准入、上限卡、队列、规则、冷启动。

| # | from | 事件 | guard（拒绝） | actor | effect | 拒绝码 | 改 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S8-ROUND-01 | 开一轮正式检查 | round_open | 有正式检查配置和来源；执行读过 | 平台（evidence） | `RoundSnapshot`（轮次主体快照）加 `stagedRepairs`，记这个执行暂存的修补组 `{ noteId, version, digest }[]` | — | 第 5 条 |
| S8-REPAIR-01 | 注记 `staged` | activateRepair | 这一轮定案 PASS 且适用、版本就是组里的确切版本（`source_stale`）；要你决定的已 approve，批准从答复（决定应用）读、不算新注记版本（`not_ready`）；足迹检查过：证据缺是 `not_ready` / `footprint_unknown`、证实的越界是 `forbidden` / `outside_footprint`，两种都保持 `staged`（第二轮审查第 5 条）；钉住的目录身份还是当前（`source_stale`）；目标没暂停（`not_ready` / `goal_paused`） | 平台（Workflow、Host 启动扫） | 一次提交：新目录 + 基线 + 当前指针、注记 `staged → accepted`、**责任关系一次关闭原链接、开启全部新链接并核唯一性**、事件；守注记头版本、目录当前指针版本、轮次版本；`responsibilityMoves` 在保存内容、摘要、轮次绑定和批准对象里（审查二第 13 条） | `not_ready`、`forbidden`、`source_stale`、`invalid`、`revision_conflict` | 第 3、5、13 条；第二轮审查第 1、5 条 |
| S8-REPAIR-02 | 注记 `staged` | 答复卡 `repair_approval` | 配置的操作者（`forbidden`）；注记头版本（`revision_conflict`）；还是 `staged`（`invalid`）；选项是 `approve` / `reject`（`invalid`） | 你 | `approve`：批准记在答复消息（决定应用）上，不写新注记版本、不激活，被检查的版本不变；`reject`：`staged → withdrawn`、原因 `rejected_by_user`；落实回执 = 答复提交（或它让条件全齐时的激活提交） | `forbidden`、`revision_conflict`、`invalid` | 第 6 条；第二轮审查第 1 条 |
| S8-CAT-01 | 活动目录 | 删模块 op / 换身份（`remove_module`+`add_module`）/ `architecture/revise` | 还有没终结的任务声明属于它（`invalid` / `module_in_use`）；每个受影响的开着负责关系都写了去向（缺 → `invalid` / `responsibility_destination_missing`）；碰模块的边同一修订里删掉（`invalid` / `module_has_edges`）；守每个读到的目标当前计划指针版本（`revision_conflict`） | 你（`architecture/revise`）；平台按修订/提议激活 | 新目录 + 基线版本、当前指针；同一次提交里用 `planReanchor` 挪负责关系；历史锚点不改，读时标“模块已删” | `invalid`、`forbidden`、`revision_conflict`、`source_stale` | 第 7 条；审查二第 14 条 |
| S8-CAT-02 | 活动目录 | 改显示名（`set_module_name`）/ `architecture/revise` | 保留 `moduleId` 和负责关系（`invalid`）；不要去向（`invalid`）；不查删除限制、不处置去向（`invalid`）；守目录当前指针版本（`revision_conflict`） | 你（`architecture/revise`）；平台按修订/提议激活 | 新目录 + 基线版本、当前指针；不改历史锚点、不标“模块已删” | `invalid`、`forbidden`、`revision_conflict` | 审查二第 14 条 |
| S8-LINK-01 | 无 | 指定/转移/接续/归档模块负责人 | 唯一 claim `module-maintainer:<module key>` 的 owner 是这条 link key（冲突 `revision_conflict`）；同一 owner 幂等；模块在活动目录里（`not_found`）；区域参谋用另一个占位（`role-scope:`），和维护者 claim 分开 | 你、参谋（第 7 片工具）、Workflow 接续 | 开/关 `responsible` link，转移搬 claim；一条线维护多模块归到最小 module id，其余显示“也负责”；区域 = 模块 + containment 子树，有效负责范围按 7D1 L23 减去同职责更深区域（审查二第 6 条） | `forbidden`、`revision_conflict`、`not_found`、`busy` | 第 10 条 |
| S8-PROP-01 | 无 | agent 提结构修订提议 | agent（只读探索的参谋、区域参谋）；提议时把 `ops`、`responsibilityMoves` 试套到 `baseCatalogPin`，校验同 `architecture/revise`（结构合法性、负责去向、去向模块存在、同职责一个模块一个负责人、项目/工作区/基线 pin）；不过当场回 `invalid`、不出卡；成功回 `{ status: 'needs_decision'; proposalRef; cardKey }`，保存 `ArchitectureProposalV1`（`state: 'pending'`）；**同批冷启动先冻结 `ArchitectureProposalBatchV1`（完整成员、`baseCatalogPin`、合并 `ops`、`responsibilityMoves`、摘要；稳定顺序试套全过才合，冲突不覆盖、各自成批）** | agent | 出一张 `structural_proposal { batchRef }` 卡（主体 `project`）给你批；批时按冻结的 `baseCatalogPin` 再核，目录变了回 `source_stale`（卡读作“已过时，要重提”），不落实；**批准绑定冻结批次，一次提交落实全部；晚到提议另成批、内容或 pin 变了不复用旧批准**；批了由第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的 `baseCatalogPin` 落实（目录、负责关系，用 `planReanchor`）；不走修补的 PASS 和足迹门槛 | `invalid`、`forbidden`、`revision_conflict`、`source_stale` | 决定 60-7、61-4；审查二第 12 条 |

- 注记：S4-NOTE-09（`staged → accepted`）由本片的 `activateRepair` 做；条件见 L4（S8-REPAIR-01）。
- 目录：修订沿已有的目录修订行；删模块/换身份加条件（S8-CAT-01），改显示名单列（S8-CAT-02，不触发删除限制、旧锚点不读作已删）；结构修订提议见 S8-PROP-01 和 L6。（审查二第 14 条）
- 负责关系：模块目标的指定、转移、关掉沿已有的行（S8-LINK-01 写“一个模块最多一个负责人”和唯一 claim；区域参谋的 `role-scope:` 占位和它分开）。
- 8D：C/C++、Python 的提供者不改目录和状态迁移；观测记录按语言的 `languages` 覆盖照 L12 记，一门语言 `failed` 不影响别的语言（决定 63）。

## 4. 规则

1. 修补只在本次足迹里；生效要适用的 PASS、足迹检查过、目录身份还是当前；结构的总要你决定，每步确认下的小改也要；`footprint_unknown` 一律进你的卡；`not_ready` / `footprint_unknown`（证据缺）和 `forbidden` / `outside_footprint`（证实的越界）都保持暂存。（第一轮审查第 3、4、6 条；第二轮审查第 5 条）
2. 目录和注记的生效在同一次提交。（第一轮审查第 5 条）
3. 激活绑这一轮和这一组确切版本；版本变了 `source_stale`；批准不产生新版本，从答复里读；竞争按轮次定案游标再按 note id，第一个赢。（第一轮审查第 5 条；第二轮审查第 1 条）
4. 比较和提醒只读，不采用、不判对错；“不知道”和“没有”分开；比较按 `(catalog pin, captureRef)` 定身份。（第一轮审查第 8 条；第二轮审查第 3 条）
5. 删模块不改历史；没终结任务引用和边都要清；每个受影响的开着负责关系都要写去向（缺 `invalid`/`responsibility_destination_missing`）；换身份 = `remove_module` + `add_module` 并带去向（只有删模块/换身份才查删除限制、处置去向、旧锚点读作已删）；改显示名用 `set_module_name`（`{ moduleId, name }`），保留 `moduleId` 和负责关系，不算结构改动、不要去向，**两档都出卡、规则放不开，不触发删除限制，旧锚点不读作“模块已删”**；拆、合没有专门的 op，用 `add_module`、`remove_module`、`add_path`/`remove_path`、`set_parent` 组合表达，`responsibilityMoves` 覆盖这次被 `remove_module` 的每个模块上开着的负责关系。（第一轮审查第 7 条；决定 63；审查二第 14 条）
6. 每个模块同时最多一个负责人，所有写入方共用一条 `module-maintainer:` claim；区域参谋用另一条 `role-scope:` 占位，互不抢。（第一轮审查第 10 条）
7. 提案的目录 pin 按提案时活动目录记，没有活动目录时是 `null`；采用时非 null 对着采用时活动的目录核，null（初次采用）由治理决定选目录、对选中的目录核并绑定；引用检查，不是派工闸门。（第一轮审查第 11 条；第二轮审查第 4 条；最后核对第 2 条）
8. 文件级图分块存，一块最多 256 KiB、最多 64 块；旧观测 `not_captured`；每个文件节点带 `nonBlankLines`（所有语言都数）和 `language`；观测再按语言记 `languages` 覆盖（`supported`/`unsupported`/`failed`），没有提供者读作“引用关系未支持”。（第一轮审查第 12 条；决定 63）
9. 根路径统一 `.`：path 是 `.` 的模块覆盖所有相对路径，最长前缀匹配里长度算 0、优先级最低（L7、L12）。
10. 区域 = 模块加 containment 下的全部子模块（containment 子树，L11）；有效负责范围统一按 7D1 L23 减去同职责更深的负责区域；区域参谋只做判断，模块维护者才是负责人。（审查二第 6 条）
11. 结构修订提议（agent 用 `propose_architecture_revision` 提、你批、第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的 `baseCatalogPin` 落实）不走修补的 PASS 和足迹门槛；提议时校验同 `architecture/revise`，不过当场回 `invalid`、不出卡；**展示批准前冻结 `ArchitectureProposalBatchV1`（完整成员、`baseCatalogPin`、合并 ops、`responsibilityMoves`、摘要），批准绑定批次、一次提交落实全部，冲突不覆盖、各自成批；晚到提议另成批、内容或 pin 变了不复用旧批准**；批准时按冻结的 `baseCatalogPin` 再核，目录变了回 `source_stale`、卡读作“已过时，要重提”、不落实；冷启动同批提议合成一个批次、一张卡；拒绝不落实（L6）。（审查二第 12 条）
12. “未细分”读出来（模块 path 是 `.`、没有子模块），不新增目录字段（L10）。
13. 8D：C/C++、Python 的引用关系按 8A 的 `ArchitectureLanguageProviderV1` 从捕获 owner 冻结的 `ProjectSourceAccess` 材料接现有解析器（C/C++ 靠项目的 `compile_commands.json`，要系统 Python 和 libclang，可注入 `libraryPath`、`pythonPath`；Python 要 `.local/source-analyzers`）；按同一 `expectedSnapshot` 翻到底、去重、保留 unresolved；本机分析器装不上或没有配置时这门语言 `failed`、部分失败照实汇总，不影响别的语言；Rust、Go 留接口、不在这一轮做（L13；决定 63；审查二第 15、16 条）。

## 5. 测试（TDD，测试由 DSH 一条一条写）

### 5.1 测试入口（**待你确认**）

（验证时机：AE1–AE4、AE6 标“7D1 可验”；AE5 除冷启动合卡外都“7D1 可验”，冷启动合卡“7D2 联动补验”（审查二快速核对第 5 条）。审查二第 18 条）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| AE1 | **观测和比较（8A）。** 公开的 `platform.architecture` 抓取、查询、`compare-formal`、影响，临时工作区里的真实 TS 文件 | 文件节点和边、每个节点的 `nonBlankLines`（所有语言都数，解析器失败不抹掉已读到的）和 `language`、按语言的 `languages` 覆盖（`LanguageCoverageV1`：文件数、解析成功数、失败/跳过的文件和原因、是否完整；TS/JS `supported`，没有提供者 `unsupported`，读作“引用关系未支持”；部分失败照实汇总）、根路径 `.` 的最长前缀归属（只有模块前缀／映射节点允许 `.`，文件和配置路径校验不放宽，等长歧义 `unknown`，观测节点和边同一归属）、分块存储和上限报 `capacity`、旧观测 `not_captured`、正式和观测的差异、“不知道”单列、观测到的环、自动抓的触发（登记后、采用后、检查通过后）和无目录时只抓文件层、失败重试（第一轮审查第 8、12 条；决定 63；审查二第 16、17 条） | 准备执行的接线 |
| AE2 | **准备执行的提醒（8A）。** 公开的 `createExecutionPreparation.prepare`，停在调模型以前 | 四类提醒、移动、最多 10 行和省略、观测的时刻、没有观测、抓失败下一次 Host 启动或下一个触发时重试（第一轮审查第 9 条） | 模型怎么用 |
| AE3 | **计划和负责人（8B）。** 公开的提计划、采用、`sessions/link`、转移、归档处置、新路由 | 不存在的模块被拒、旧计划不回头核、一个模块一个负责人、唯一 claim、区域参谋和维护者分开占位、区域（containment 子树）和有效负责范围分开（有效负责范围按 7D1 L23 减去同职责更深区域）、最小根模块 `.` 能当 `moduleRef`、指定即转移、归档时交出或放下、只认人（第一轮审查第 10、11 条；审查二第 6 条） | 自动挑负责人 |
| AE4 | **冷启动（8B）。** 保存的结构化初始化回答 → `architecture/adopt-initial` | 包含关系照传、没给是不知道、显式空是平的、最小根模块 `.` 读出来标“未细分”且不加目录字段（第一轮审查第 14 条） | 模型会不会给 |
| AE5 | **修补生效（8C）。** 平台模式：真实 Runtime、冻结 Kernel、脚本模型；执行里写修补（第 4 片的“记”）→ 正式检查 → 决定答复 → 公开读 | 小改随检查通过生效、结构的等你、每步确认下的小改等你、`footprint_unknown` 进卡、`forbidden` / `outside_footprint` 被拒且保持暂存、两个条件哪个后到都能触发、检查没过不生效、开轮后版本变了 `source_stale`、任务取消作废、足迹外被拒、删模块还有没终结任务被拒、负责关系缺去向回 `responsibility_destination_missing`、结构修订提议走你批的路（提议时校验同修订、不过当场 `invalid` 不出卡；批准时按冻结的 `baseCatalogPin` 再核、目录变了回 `source_stale`、卡读作“已过时，要重提”、不落实；批了由第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的基线 pin 落实）、重启后再试、一次提交（第一轮审查第 3、5、6、7 条；第二轮审查第 5 条）；**8C 验收用真实的目录、责任、批准提交，不用替身**（审查二第 18 条） | 真实模型的修补质量 |
| AE6 | **多语言引用（8D）。** 公开的抓取和文件级读，临时工作区里的 C/C++、Python 文件（**含纯非 TS 项目、没有 `compile_commands.json`、解析器不可用、部分解析失败、跨分页**）；本机分析器（`.local/source-analyzers`）可装/不可装两种 | C/C++ 提供者（libclang、项目的 `compile_commands.json`，要系统 Python 和 libclang）和 Python 提供者（要 `.local/source-analyzers`）按冻结的 `ProjectSourceAccess` 材料、同一 `expectedSnapshot` 抽出的 import 边；`languages` 覆盖里 `LanguageCoverageV1` 给出文件数、解析成功数、失败/跳过的文件和原因、是否完整，这两门语言 `supported`；没有 `compile_commands.json`、解析器不可用或部分解析失败时照实映射成 `failed`/部分覆盖、别的语言不受影响；没有 TS 文件不整体失败；和其他测试入口一起等用户确认（决定 63；审查二第 15、16 条） | 分析器本身的解析质量 |

### 5.2 验收行为（第一稿）

（验证时机：A-01–A-05、B-01–B-05、R-01–R-10、R-12、R-13、A-06 标“7D1 可验”；R-11 的提议合卡标“7D2 联动补验”。审查二第 18 条）

- A-01（AE1）抓取一个有 205 个文件的临时工作区，文件固定为 `src/a.ts`、`src/b.ts`、`src/c.ts`、`src/d.ts` 加 `src/f001.ts` 到 `src/f201.ts` 共 201 个别的 TS 文件：`src/a.ts` import `src/b.ts`，`src/c.ts` import `src/d.ts`，别的不 import → 文件节点 205 个（每个是 `{ path, nonBlankLines, language }`，`nonBlankLines` 等于非空行数、`language` 是 `typescript`）、import 边就是 `(src/a.ts, src/b.ts)`、`(src/c.ts, src/d.ts)` 两条，身份按 `(from, to)`；分页读 `listFiles` 一页 200：第 1 页 200 个节点、带游标，第 2 页 5 个节点、不带游标；边只在这一页节点之间返回、按 `(from, to)` 排；邻居只对真正相邻的文件断言：`neighbors(src/a.ts)`（方向 `out`）出 `src/b.ts`、`neighbors(src/c.ts)`（方向 `out`）出 `src/d.ts`，其余文件没有邻居；换个 `captureRef` 用同一游标 → `invalid`、`cursor_mismatch`；把注入的上限压到 2 个文件 → `capacity` 并报数到 2；旧观测读 → `not_captured`。（第一轮审查第 12 条；第二轮审查第 3、6 条；最后核对第 3 条）
- A-02（AE1）正式对观测的比较夹具。先记 `mX = { projectId: "p1", moduleId: "X" }`。目录：模块 `A` paths `["src/a"]`、`B` paths `["src/b"]`、`C` paths `["src/c"]`、`D` paths `["src/d"]`、`P1` paths `["src/dup"]`、`P2` paths `["src/dup"]`；声明依赖 `A→B`。观测文件（每个的 import 都列出）：`src/a/one.ts` 不 import、`src/b/lib.ts` 不 import、`src/c/one.ts` import `src/d/one.ts`、`src/d/one.ts` 不 import、`src/a/broken.ts` import `src/nowhere.ts`（解析不到）、`src/loose.ts` 不 import（没归组）、`src/dup/one.ts` 不 import（`src/dup` 两条等长 path 并列）。期望一个 `FormalObservedFindingV1[]`，按 `path`、再按 `kind` 排（最后核对第 5 条）：
  ```ts
  [
    { kind: 'dependency_missing', moduleRef: mA, path: 'src/a', detail: 'A→B', certainty: 'unknown' },
    { kind: 'unresolved', moduleRef: mA, path: 'src/a/broken.ts', detail: 'src/nowhere.ts', certainty: 'unknown' },
    { kind: 'import_undeclared', moduleRef: mC, path: 'src/c/one.ts', detail: 'src/d/one.ts', certainty: 'proven' },
    { kind: 'ambiguous', moduleRef: null, path: 'src/dup/one.ts', detail: 'src/dup 命中 P1、P2', certainty: 'unknown' },
    { kind: 'ungrouped', moduleRef: null, path: 'src/loose.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
  ]
  ```
  `A` 沾到解析不到的 import，所以缺 `A→B` 是 `unknown`；等长 path 让那个文件也是 `unknown`（最后核对第 4 条）。环不在这里，单独一个完全枚举的 A-02b。结果带 `noVerdict: true`，走 `architecture/compare-formal`，和观测对观测的 `architecture/compare` 分开。（第一轮审查第 8 条；第二轮审查第 3、6 条；最后核对第 4、5 条）
- A-02b（AE1）环夹具，单独一个、完全枚举。目录：模块 `A` paths `["src/a"]`、`B` paths `["src/b"]`（`mA`、`mB` 同上）；声明依赖 `A→B`。观测只有两个文件、两条 import：`src/a/one.ts` import `src/b/lib.ts`，`src/b/lib.ts` import `src/a/one.ts`。期望一个 `FormalObservedFindingV1[]`，按 `path`、再按 `kind` 排：
  ```ts
  [
    { kind: 'cycle', moduleRef: null, path: 'src/a/one.ts', detail: 'src/a/one.ts ⇄ src/b/lib.ts', certainty: 'proven' },
    { kind: 'import_undeclared', moduleRef: mB, path: 'src/b/lib.ts', detail: 'src/a/one.ts', certainty: 'proven' },
  ]
  ```
  没有 `dependency_missing`：`A→B` 观测到了。结果带 `noVerdict: true`，走 `architecture/compare-formal`。（最后核对第 4、5 条）
- A-03（AE2）提醒夹具，两次观测都完全枚举。目录：模块 `A` paths `["src/a/core"]`、`B` paths `["src/b"]`，声明依赖 `A→B`；任务模块是 `A`。前一次观测（完整）：文件 `src/a/core/one.ts`、`src/b/lib.ts`、`src/old.ts`（digest `d`）；import 只有 `src/a/core/one.ts → src/b/lib.ts`。最新一次观测（完整）：文件 `src/a/core/one.ts`、`src/a/core/util.ts`、`src/b/lib.ts`、`src/b/extra.ts`、`src/a/loose.ts`、`src/new.ts`（digest `d`）；import 只有 `src/b/extra.ts → src/a/core/util.ts`。`A` 的 import 空、`B` 的 import 只到 `src/a/core/util.ts`，所以缺 `A→B` 和没声明的 B→A 都算得出来（最后核对第 6 条）。期望四行，先种类再 path：`[声明的依赖没有 import：A→B（src/a/core/one.ts）, import 没有声明的依赖：src/b/extra.ts → src/a/core/util.ts, 新文件没归组：src/a/loose.ts, 可能移动：src/old.ts → src/new.ts]`，每行带观测时刻；12 条时放 10 条加省略行；没有观测写“还没有观测”；抓取失败记一条，下一次 Host 启动或下一个触发时重试，提醒用最近一次成功的观测。（第一轮审查第 9 条；第二轮审查第 6 条；最后核对第 6 条）
- A-04（AE1）自动抓：工作区登记后、第一次正式采用后、每次修订采用后、每次检查 PASS 后各触发一次抓取；还没有目录时只抓文件层、模块层结果为空，“没被任何模块路径覆盖”的文件集合由正式和观测的比较算出；抓失败记一条、下一次 Host 启动或下一个触发时重试；设置页按钮照旧能做手动抓取。（61-3）
- A-05（AE1）根路径和 `nonBlankLines`：目录里一个根模块 path 是 `.`、另一个模块 path 是 `src/a`；观测文件 `src/a/one.ts`（归 `src/a`，更长前缀优先）、`src/b/two.ts`、`src/loose.ts`（归根模块）；每个文件节点的 `nonBlankLines` 等于非空行数、`language` 按扩展名认；`. ` 和具体前缀竞争时归具体前缀、只在没有更长前缀时才归它。（61-2；7D2 L28；决定 63；审查二第 18 条）
- B-01（AE3）提案记 `catalogPin`：有活动目录时记完整目录身份；没有活动目录时是 `null`，提计划时不做成员检查；采用时非 null 对着采用时活动的目录核，null 由治理决定选目录、对选中的目录核并绑定，目录里没有任务的模块 → `invalid`、`unknown_module`。有 pin 时：计划里一个任务声明不在 pin 里的模块 → `invalid`、`unknown_module`；采用前目录删了这个模块 → 采用时活动目录里没有它，采用也 `invalid`、`unknown_module`；已采用的旧计划不报。（第一轮审查第 11 条；第二轮审查第 3、4 条；最后核对第 2 条）
- B-02（AE3）给模块 M 指定负责人 L1，再指定 L2 → L1 的负责关系关掉、L2 开着；L1 和 L2 同时抢同一条 `module-maintainer:<module key>` → 一个赢、一个 `revision_conflict`；同一 owner 再指定一次幂等；一条线维护 M1、M2 → 归到 id 小的那个，另一个显示“也负责”；成员身份调路由 → `forbidden`。（第一轮审查第 10 条）
- B-03（AE4）初始化回答带 `containment.parentOf` → 目录里有；字段缺 → 包含关系是“不知道”；带显式空 `{parentOf: []}` → 每个模块是平的。（第一轮审查第 14 条）
- B-04（AE3）区域和维护者分开：给模块 M 指定负责人 L1（`module-maintainer:M`），同时给包含 M 的区域指定区域参谋 L2（`role-scope:`）；**不直接断言“两条 claim 都在”，而是经公开的负责关系读取证明 L1 读作维护者、L2 读作区域参谋且互不抢占，再用指向 M 的竞争请求结果证明两种职责各自受理、都不被对方挡掉**；L2 的有效负责范围覆盖 M 和它的 containment 子模块（再按 7D1 L23 减去同职责更深的负责区域），有更深负责人时归更深的那个、没有才归 L2，写清确切 owner；**containment 不知道时 L2 的区域只算 M 自己、不推断子孙**；区域参谋不被读成模块维护者。（7D1 L24、8B；审查二第 6 条；审查二第 19 条）
- B-05（AE4）最小根模块：初始化回答只给一个根模块、paths 是 `['.']`，采用后读出来标“未细分”（path `.` 且没有子模块）；目录里不因“未细分”多出字段；提计划用这个根模块当 `moduleRef` 能过（L10）。（61-2）
- R-01（AE5）「方案确认后自动」下，执行写一条改职责说明的修补 → 检查通过 → 目录新版本、注记 `accepted`，同一次提交（读目录和注记的提交游标相同）。（第一轮审查第 5 条）
- R-02（AE5）结构的修补（加模块）：检查通过但你没答 → 修补不能激活（`not_ready`）；你答“收下”（`approve`，记在答复消息上，不写新注记版本，被检查的版本不变、PASS 仍覆盖它）→ 下一触发激活。反过来先答后检查也一样。每步确认下的小改同样要卡；检查通过但没答，修补不能激活，执行本身照旧。（第一轮审查第 6 条；第二轮审查第 1、6 条）
- R-03（AE5）检查不通过 → 保持暂存；任务返工后新执行重提。开轮时冻结的修补版本之后变过 → 这一轮激活 `source_stale`，要新的一轮。（第一轮审查第 5 条）
- R-04（AE5）两个修补钉同一个目录版本：第一个按轮次定案游标（再按 note id）生效，第二个 `source_stale`，保持暂存。（第一轮审查第 5 条）
- R-05（AE5）足迹：写的时候只解析、只试套。那个执行的 `definite` 文件集 = `["src/a/one.ts"]`（2B 的 `RunActivity`）。缺记录、unknown 或不完整 → `not_ready`、`footprint_unknown`，进你的卡不论自治档，保持暂存。有记录时，`add_path` 指到 `src/other/two.ts`（这次没改过，不在 definite 集里，也不在“前缀下每个文件都 definite”的目录前缀里）→ `forbidden`、`outside_footprint`，保持暂存；`add_path` 指向这次新加的模块且路径规则满足 → 允许；依赖或 forbid 规则任一端在足迹外 → 同样 `forbidden`、`outside_footprint`。（第一轮审查第 3、4、6 条；第二轮审查第 5、6 条）
- R-06（AE5）删模块：还有没终结的任务属于它 → `invalid`、`module_in_use`；依赖/forbid/包含边没在同一修订里删掉 → `invalid`、`module_has_edges`；模块上开着的负责关系不再一律挡住删除——每个都写了去向就能删（同一次提交里用 `planReanchor` 挪），漏一个 → `invalid`、`responsibility_destination_missing`；都终结、边清掉、去向写全以后能删，旧注记的锚点读出来标“模块已删”；并发采用让激活的提交失败并重试。**这一条只验删除；改显示名单独验（R-10 的改名段），它不显示“模块已删”**（第一轮审查第 7 条；审查二第 19 条）
- R-07（AE5）生效中途重启 → Host 启动扫 PASS 定案、有没激活绑定修补的轮次，再试成功，只生效一次（`commandId = activate:<noteId>:<version>`）。（第一轮审查第 5 条）
- R-08（AE5）目标暂停时激活 → `not_ready`、原因 `goal_paused`；恢复后重试成功。（第一轮审查第 5 条）
- R-09（AE5）激活后注记是本目标 `accepted`；`confirmedByUser` 一直是 false，不因你的答复变跨目标；书记审过才是 `reviewed`。（第一轮审查第 6 条）
- R-10（AE5）修订带负责去向：模块 A 上有维护者 L1、区域参谋 L2、区域书记 L3；一次 `architecture/revise`（或结构修订提议）删 A、给每个关系写明去向到 A1 → 目录和三条关系在同一次提交里落实（用 `planReanchor`，目标模块按新目录验证）；漏写一个去向 → `invalid`、`responsibility_destination_missing`，目录不变；换身份 = `remove_module` + `add_module` 并带去向上面的去向（只这一路读作“模块已删”）；**改显示名分开验**：`set_module_name` 保留 `moduleId` 和负责关系、不算结构改动、不要去向、不触发删除限制，旧锚点读时**不**标“模块已删”；拆、合没有专门的 op，用组合 op 表达，`responsibilityMoves` 覆盖被 `remove_module` 的每个模块。（决定 60-7；决定 63；审查二第 14 条；审查二第 19 条）
- R-11（AE5；单个提议 7D1 可验，冷启动合卡和 `role_exploration` 身份 7D2 联动补验）结构修订提议，手算：目录 c1 有模块 `R`（`.`）、`A`（`src/a`）、`B`（`src/b`），区域参谋 `QA` 管 `A`、`QB` 管 `B`。冷启动 `proposals` 阶段（探索身份是 `role_exploration` Query，绑 `role_line` 操作和系统“请动手”消息）三个提议都钉 c1，提议键 p1 < p2 < p3：p1（`QA`）`[add_module A1 { paths: ['src/a/one'] }, set_parent A1 → A]`；p2（`QB`）`[add_module B1 { paths: ['src/b/one'] }, set_parent B1 → B]`；p3（`QA`）`[add_module A1 { paths: ['src/a/two'] }]`。每个提议当场校验过，回 `{ status: 'pending_batch'; proposalRef }`（冻结以前没有卡）、存 `pending`。三个探索 Query 都结束时冻结：按提议键试套，p1、p2 兼容 → 批次 b1 `{ members: [p1, p2], ops: p1 的两条接 p2 的两条 }`；p3 和 p1 冲突（`A1` 已加）→ 不覆盖、自成批次 b2 `{ members: [p3] }`；出两张 `structural_proposal { batchRef }` 卡（主体 `project`）；`architecture/proposals/read` 读 p1、p2 都是 `batchRef: b1` 和同一个 `cardKey`，读 p3 是 `b2` 和另一个 `cardKey`（审查二快速核对第 5 条）。批之前目录不变。你批 b1 → 一次修订提交 c2（`A1`、`B1` 都在），p1、p2 `applied`；再批 b2 → 按冻结的 c1 核，目录已是 c2 → `source_stale`、卡读作“已过时，要重提”，p3 `stale`、不落实。冻结后才到的 p4（`QB`，钉 c2，`[set_responsibility B1 "b1 职责"]`）→ 立即自成批次 b3、回执 `needs_decision` 带卡，你批 → 修订 c3，p4 `applied`。**最终修订次数 2（c2、c3）**；同一批次的批准重放不再写修订。批了由第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的 `baseCatalogPin` 落实，不走修补的 PASS 和足迹门槛。（决定 61-4；审查二第 12、19 条；审查二 lead 补）
- R-12（AE5）提议在提交时被拒：agent 提一个 op 不合法、去向不全、去向模块不存在，或同职责一个模块两个负责人的提议 → 当场回 `invalid`（原因同修订）、**不出卡**、不存 `pending` 提议、目录不变。（E6；决定 61-4）
- R-13（AE5）提议在批准时过时：提议保存后、你批准前，目录的 `baseCatalogPin` 变了（别的修订或你改过）→ 批准时按冻结的 `baseCatalogPin` 再核发现目录已变 → 回 `source_stale`，卡读作“已过时，要重提”，不落实、不生成修订提交，提议记 `state: 'stale'`。（E6；决定 61-4）
- A-06（AE6）多语言最小混合项目（期望值手算；审查二第 15、16、19 条；审查二 lead 补）。工作区文件和非空行数：`src/a.ts` = `import { y } from './b';\n\nexport const x = y;\n`（2）、`src/b.ts` = `export const y = 2;\n`（1）、`native/c.cpp` = `#include "d.h"\nint f() { return g(); }\n`（2）、`native/d.h` = `int g();\n`（1）、`e.py` = `import g\nimport os\n\nprint(g.x, os.name)\n`（3）、`g.py` = `x = 1\n`（1）、`f.py` = `def broken(:\n`（1）、`many.py` = 201 行 `import g`（201）、`logo.png`（含 NUL 字节）。目录：模块 `N` paths `['native']`、`S` paths `['src']`，声明依赖 `N→S`（`mN = { projectId: "p1", moduleId: "N" }`）。**情形 1（分析器装好、没有 `compile_commands.json`）**：文件节点 8 个（`logo.png` 不是节点，记在 `other` 的 `issues` 里，`kind: 'skipped'`、原因二进制），`nonBlankLines` 照上，`f.py` 解析失败仍是 1；边集合恰好 `[('e.py','g.py'), ('many.py','g.py'), ('src/a.ts','src/b.ts')]`（`many.py` 的 201 条 import 结果要翻过分析器的第二页、全程同一个 `expectedSnapshot`，去重后一条边）；unresolved 有 `{ from: 'e.py', specifier: 'os' }`；覆盖：`typescript { files: 2, parsed: 2, edges: 'supported', reason: null, issueCount: 0, complete: true }`、`cpp { files: 2, parsed: 0, edges: 'failed', reason: 没有 compile_commands.json, complete: false }`、`python { files: 4, parsed: 3, edges: 'supported', issues: [{ path: 'f.py', kind: 'failed', reason: 语法错误 }], issueCount: 1, complete: false }`；`compare-formal` 里有 `{ kind: 'dependency_missing', moduleRef: mN, path: 'native', detail: 'N→S', certainty: 'unknown' }`（C/C++ 失败，不能说确定没有）。**情形 2（加 `compile_commands.json` = `[{"directory":".","file":"native/c.cpp","arguments":["c++","-c","native/c.cpp"]}]`，libclang 可用）**：多一条边 `('native/c.cpp','native/d.h')`，`cpp { files: 2, parsed: 2, edges: 'supported', reason: null, issueCount: 0, complete: true }`，`N→S` 的那一行变成 `certainty: 'proven'`。**情形 3（`.local/source-analyzers` 里没有 Python 分析器包）**：`python { files: 4, parsed: 0, edges: 'failed', reason: 分析器不可用, complete: false }`，没有 Python 的边，`nonBlankLines` 不变，TS 和 C/C++ 的结果同情形 1。**纯非 TS 项目**：只放 `e.py`、`g.py` → 抓取成功（不因没有 TS 文件失败），`languages` 只有 `python`，边 `[('e.py','g.py')]`。`listFiles` 的分页照 A-01。

### 5.3 要改断言的旧测试

（验证时机：除与 7D2 合卡/项目主体卡源相关的旧断言外，其余标“7D1 可验”。审查二第 18 条）

- 目录修订拒绝删模块、拒绝依赖规则的测试：8C 翻转（lead 冻结时列前后断言）。（第一轮审查第 2、7 条）
- 删模块只被负责关系挡住的测试：8C 翻转成“要写去向”，缺去向回 `responsibility_destination_missing`；没终结任务引用和边的拒绝照旧（L5）。（决定 60-7）
- 改名的旧测试：换身份 = `remove_module` + `add_module` 并按上面带去向（只有它和删模块查删除限制、旧锚点读作已删）；改显示名用 `set_module_name`、保留 `moduleId` 和负责关系、不算结构改动、不要去向、两档都出卡、不触发删除限制、旧锚点不读作“模块已删”（L5；审查二第 14 条）。
- 路径归属的旧测试（`architecture-source.ts:34`、`architecture-service.ts:98/135`、`workspace/architecture-source.ts:27/38`、`goal-conflicts.ts`、`graph-index.ts:91/96`、`architecture-record-codecs.ts:265`、`catalog-record-codecs.ts:263`、源码映射的 `safeRelativePath`）：加 path `.` 的用例；`. ` 覆盖所有相对路径、匹配长度 0、优先级最低；只有模块前缀／映射节点允许 `.`，文件和配置路径的校验不放宽；等长歧义统一 `unknown`；观测的模块节点和边用同一归属结果；施工时按 `startsWith(path + '/')` 在 `src/core/work-graph/` 里找全（E10；7D2 L28 的根路径；审查二第 17 条）。
- 文件级观测节点的旧断言：节点从字符串变成 `{ path, nonBlankLines, language }`，`nonBlankLines` 所有语言都数，`language` 按扩展名认（认不出 `other`）；lead 冻结时列前后断言（同时改 A-01）。（决定 63）
- 语言覆盖的旧断言：观测记录加 `languages` 覆盖（`LanguageCoverageV1`：文件数、解析成功数、失败/跳过的文件和原因、是否完整，`edges` 是 `supported`/`unsupported`/`failed`）；部分失败照实汇总；TS/JS `supported`，没有提供者的语言 `unsupported`、读作“引用关系未支持”；`ArchitectureLanguageProviderV1` 从 `ProjectSourceAccess` 冻结材料接 `TypeScriptSourceAnalyzer`；C/C++、Python 在 8D 加。（决定 63；审查二第 15、16 条）
- 观测快照上限的测试：模块级不变；文件级是新的分块和上限（256 KiB × 64 块，20,000 / 100,000）。（第一轮审查第 12 条）
- 任务 `moduleRef` 只校验非空的测试：8B 改成核对提案 `catalogPin`（可以是 `null`）和采用时活动的目录（`catalogPin` 是 `null` 时是治理决定选中的目录）。（第一轮审查第 11 条；第二轮审查第 4 条；最后核对第 2 条）
- 轮次记录/`RoundSnapshot` 形状的旧测试：加修补组字段，旧轮次缺它当空组。（第一轮审查第 5 条）

## 6. 文件（第一稿）

（验证时机：8A、8B、8C 的修补生效、8D 标“7D1 可验”；8C 的冷启动合卡标“7D2 联动补验”，单成员批次的结构提议“7D1 可验”（审查二快速核对第 5 条）。审查二第 18 条）

- **8A：** `src/contracts/architecture-source.ts`、`architecture-inspection.ts`（`ObservedCaptureRef`、`FormalObservedComparisonV1`、`FileGraphPageV1`、每个节点的 `nonBlankLines` 和 `language`、`languages` 覆盖、`ArchitectureLanguageProviderV1`）；`src/core/workspace/architecture-source.ts`（`safeRelativePath` 额外收 `.`）、`capture.ts`（TS/JS 提供者包 `TypeScriptSourceAnalyzer`）、`ports.ts`；`architecture/contracts.ts`、`architecture-service.ts`（自动抓的触发）、`architecture-record-codecs.ts`（文件图、分块列表、`not_captured`、根路径 `:265`）、`architecture-delta.ts`、`graph-index.ts`（根路径 `:91/96`）、`catalog-record-codecs.ts`（根路径 `:263`）、`views/goal-conflicts.ts`（最长前缀和根路径 `:470/492`）；新的正式对观测比较读取和提醒读取；自动抓的触发点 `configuration/project-bootstrap-service.ts`、`core-routes.ts`、`host.ts` 和设置页按钮（`src/ui/views/setup/actions.ts`、`src/ui/views/graphs/tabs.ts`）；`views/context-extensions.ts`、`context-assembler.ts`（第 4 片也改）；组合根、路由；**`project-source-snapshot.ts`（:48/70 放开非 TS 捕获，纯 Python/C++ 项目不整体失败）、`capture.ts`（:207 同前）、`WorkspaceToolsPort` 的 `ProjectSourceAccess` 冻结适配器；根路径全链见 L7**。（第一轮审查第 8、9、12 条；第二轮审查第 3、6 条；审查二第 15、16、17 条）（7D1 可验）
- **8B：** `query-preparation.ts`（回答格式）；`tasks/plan-service.ts`、`plan-validation.ts`、`plan.ts` 契约和提案 codec（`catalogPin: ArchitectureCatalogPinV1 | null`）；负责人的写入（已有的建/挂/转移/接续写入方加唯一 claim `module-maintainer:`，并给区域参谋的 `role-scope:` 占位）；`src/contracts/architecture-catalog.ts`（`containment.parentOf`，区域的 containment 展开）；`node-detail-reader.ts`（2C 合入后换掉 `maintainer: none`）；组合根、路由。（第一轮审查第 10、11 条；第二轮审查第 3、4 条）
- **8C：** `src/contracts/architecture-catalog.ts`（从 WorkGraph 提目录身份的纯类型）；`architecture/catalog-service.ts`、`catalog-contracts.ts`、`catalog-record-codecs.ts`（依赖规则、删模块、换身份、改显示名 `set_module_name`、负责去向 `responsibilityMoves`）；结构修订提议的工具 `propose_architecture_revision`、`ArchitectureProposalV1` 记录、`ArchitectureProposalBatchV1` 冻结批次、路由/写入方和冷启动合卡（卡源 `structural_proposal { batchRef }`，主体 `project`）；`planReanchor` 的接入（7D1 的实现）；`src/contracts/verification.ts` 和 `persistence/evidence-record-codecs.ts`（轮次主体记修补组）；第 4 片的注记契约、写入方、状态机（`NoteDraftV1`、`record_note` 的 `write` 输入加 `RepairInputV1` 含 `responsibilityMoves`，写入方、codecs 存 `RepairPayloadV1`）；`communication/decision-source-facts.ts` 加 `repair_approval` 和 `structural_proposal` 源、答复（决定应用）记批准；Workflow 的生效触发、Host 启动扫；组合根、路由。（第一轮审查第 1–7 条；第二轮审查第 1、2、5 条；最后核对第 1 条；审查二第 12、13 条）（7D2 联动补验：冷启动合卡）
- **8D：** C/C++ 提供者复用 `src/core/workspace/cpp-source-index.ts`（libclang，靠项目的 `compile_commands.json`；要系统 Python 和 libclang，可注入 `libraryPath`、`pythonPath`）；Python 提供者复用 `src/core/workspace/python-source-index.ts`（要 `.local/source-analyzers` 的分析器包）；两者按 8A 的 `ArchitectureLanguageProviderV1` 从冻结的 `ProjectSourceAccess` 材料接入，按同一 `expectedSnapshot` 翻到底；两个 `*-source-index.ts` 和 `scripts/python-source-query.py`、`scripts/cpp-source-query.py` 补逐文件解析结果和全量统计（审查二快速核对第 6 条）；装不上时这门语言 `failed`、不影响别的语言；测试入口 AE6。（决定 63；审查二第 15 条；审查二第 18 条）（7D1 可验）
- **文档（lead 写）：** STATE-MACHINES-SPEC 新行；DESIGN §1.3（界线写定）、§9.3（上限）；MODEL R47 的接口表示；E3-UI-ITEMS；STATUS、能力索引。

## 7. 施工

- **前提（第一轮审查第 13 条；审查二第 18 条的新顺序）：** 8A 的提醒在 4C 合入以后；8B 的投影在 2C 合入以后；8C 在第 4 片（修补暂存）、第 5 片（卡）、2B（执行活动）和 **7D1 共享基础**都合入以后；8D 在 8A 以后。新顺序 `4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C`；8A、8B、8C（修补生效）、8D 是 **7D1 可验**，8C 的冷启动合卡是 **7D2 联动补验**（单成员批次的结构提议 7D1 可验）；删模块规则在 8C；**8C 的验收要真实的目录、责任、批准提交，不用替身**。（决定 63）
- **决定 60–63 的新依赖（审查二第 18 条）：** 自动抓的登记/采用触发要登记项目和工作区的入口；区域位置读 8A 的 `nonBlankLines`（所有语言都数）和 8B 的 containment，供 7D2 L28；8C 的负责去向（`responsibilityMoves`）、结构修订提议（第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的 `baseCatalogPin` 落实、提议时校验同修订、批准时 pin 变了回 `source_stale`、批次冻结）和改显示名 `set_module_name` 接 7D1 的 `planReanchor` 和卡源 `structural_proposal { batchRef }`；8D 的 C/C++、Python 提供者按 8A 的 `ArchitectureLanguageProviderV1` 从冻结材料接入；冷启动两步（61-4）和提议合卡在 7D2 跑通。前面小片只按“只有开局三条线、范围都是整个项目”的行为不变（7D2 §A）。（7D1 可验：8A/8B/8C（含单成员批次的结构提议）/8D；7D2 联动补验：8C 冷启动合卡）
- 每小片一个副本、一个新的 DSH Session；先通读、报看不懂的地方；任务书带推荐分组、可以调整写明理由、子任务没回报完不结束回合。
- 夹具由 DSH 写，只经公开服务造；例外：R-07 的重启替身。夹具按 §5.2 列清文件、import、期望集合和顺序；分页夹具的文件数要超过 200、分页读用 `listFiles`、邻居只断言相邻文件，环单独一个夹具，两次观测要枚举完整（第二轮审查第 6 条；最后核对第 3、4、6 条）。（第一轮审查第 14 条）

## 8. 不做的事

- 不用模型判断依赖对不对；不按名字猜改名；不自动合并修补。（第一轮审查第 1、9 条）
- 不扩大观测支持的语言：TS/JS 在 8A，C/C++、Python 在 8D；Rust、Go 不在这一轮做，只要 8A 的接口能接上（以后用通用语法解析库，例如 tree-sitter），不改观测图的其他部分。（决定 63）
- 不放开 `requireDag`：MVP 一直为真，今天的校验器直接拒绝 `false`。（第一轮审查第 2 条）
- 修补不因你的答复跨目标；`confirmedByUser` 一直是 false，先过书记审（R47）。（第一轮审查第 6 条）
- 不新增目录的“未探索/未细分”字段；“未细分”读出来（L10）。
- 记忆和修补都不改任务、执行、目标的状态。
