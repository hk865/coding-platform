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

**后注（8A 合入，lead 2026-10-17）：** 8A 已合入（ce4369b1）。施工和三轮审查中定下的读法写在 [§9](#9-8a-施工和验收中的限定lead2026-10-17)，和前面各节冲突时以 §9 为准：一次观测一份冻结材料、一个分析结果；`other` 语言的文件不让依赖变 `unknown`；完整目录 pin 的四项核对；根路径在共用的归属函数里（搜 `.` 返回所有模块）；旧观测按旧成员规则读；覆盖信息在三个文件页；收窄授权的拒绝不带路径。L8 在 4C-2 合入后补。

**后注（8A 的观测规模，lead 2026-10-17，决定 77）：** lead 对本仓库自己做观测时抓取退回 `capacity`（模块级正文 555 KB，超过 256 KiB；平均路径 40 字节时约 790 个文件就会超），观测的 TS 分析在 10,000 条引用处停、模块层是空的；按真实代码量，一次观测建两份 TS 程序，约 3,000 个程序文件就超过这台机器 Node 默认的堆。修正接在 8D 的代码上做一段、和 8D 一起合入，规则在 [§10](#10-8a-观测规模的修正lead2026-10-17决定-77)：按 `.gitignore` 定项目文件；模块快照和正文不再逐文件列出，逐文件的数据只在文件层存一份；一次观测一次分析、两层共用；分析的上限按冻结材料里 TS/JS/JSON 的大小；分析出错不能记成成功；文件层的边存节点序号。和 L12、§9 冲突时以 §10 为准。

**后注（决定 78，lead 2026-10-17）：** 架构观测改用轻型扫描读引用：TS/JS 逐个文件只解析语法、用 TypeScript 自带的模块解析对到文件；Python 只用标准库的语法树、照 CPython 的规则一级一级对到文件；C/C++ 另开只读 `#include` 的 libclang 操作。agent 查源码的工具照旧用重型分析器。规则在 [§11](#11-观测用轻型扫描读引用lead2026-10-17决定-78)，含 §2 的三处改动（覆盖多 `notes`、提供者给出覆盖状态；没解析的引用带原因；交给提供者的冻结材料多带被跳过的文件和只当配置读的文件）。和前面各节冲突时以 §11 为准：§0.3 的 L12、L13，§1 的 8D 一行，§2，§4 第 13 条，§5.1 的 AE6，§5.2 的 A-06，§5.3，§6 的 8D 一行，§9，§10。分两段做：8D 返工做 C/C++、Python、共用的执行器、覆盖的约定和拿掉 8D 对查源码工具的改动；§10 的规模修正那一段做 TS 的轻型扫描、被忽略的编译数据库和没解析引用的原因的存法。两段一起合入。

**后注（决定 79，lead 2026-10-17 夜）：** 发布前不兼容旧数据：代码只读当前格式，开发时旧版本写的库重建。§10 段照现在的规则施工；Codex 审完返工时删掉只为读之前格式写的部分：
- §10 第 2 条“旧正文照读”（v1 正文的解码分支和它当 `previous` 的读法）；
- §9 第 4 条“8A 之前的旧观测”（文件图三页的 `notCaptured` 只为这一种就一起去掉）；
- §11.6 的“旧记录”一条（没有 `notes` 读作 `[]`、没有原因读作 `reason: null`）；
- §10 第 8 条的 A-16 和它的旧账本夹具。

和正文冲突时以本后注为准。

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

## 9. 8A 施工和验收中的限定（lead，2026-10-17）

本节记下 8A 施工、审查和三次返工中定下的读法，对 8B–8D 同样有效；和前面各节冲突时以本节为准。经过和证据见[证据](../../../reviews/evidence/orchestration-slice-8A-2026-10-17/README.md)；合入提交 ce4369b1。8A 不含 L8（自动抓、失败记录、重试和过时提醒），L8 在 4C-2 合入后补上（决定 74）。

1. **一次观测只有一份冻结材料（L12）。**
   - 观测走一个容错的读取（`captureObservationSource`）：二进制、超过 2 MiB、读不了的文件逐个跳过，记进该语言覆盖的 `issues`，不让整次观测失败。原来严格的 `captureProjectSource` 留给别的调用方。
   - 模块层的 TS 分析和文件层都用这份冻结材料，文件层不再重读工作树；`verify` 核对整份材料的摘要（摘要还包括引擎和工作区身份）。
   - TS 分析用这次捕获指定的 `configPath`。
   - 一次观测只有一个分析结果：分析失败（配置文件被跳过、结果数到上限等）时，文件层不换上限重新分析；TS 覆盖记为失败并带原因，模块层是空的，文件层照样有文件和行数。严格捕获照旧报错，也不偷换别的配置。失败的观测 `projectConfiguration` 为 null。
2. **正式和观测的比较（L7）：**
   - 同一模块内的引用不算发现。
   - `other` 语言的文件（文档、配置、资源，本来没有引用）不会让模块的依赖变成 `unknown`。
   - 下面几种会：源码语言没有可用的解析器（不支持、失败、没配置、只解析了一部分，例如 8D 之前的 C/C++、Python，以及 Rust、Go）；引用指向不归任何模块或并列的文件；本模块的文件被跳过或失败。路径并列时，并列的每个模块都算 `unknown`。
   - 完整目录 pin 要核对项目范围、pin 和目录的关联、版本（导出的 `readRevisionByRef`）和摘要；别的项目的 pin 是 `forbidden`，关联不对或摘要不对是 `invalid`，版本不存在是 `not_found`，都不会是 `ready`。
   - 环检测只有一个函数（`architecture-delta.ts`），比较直接调用它。
3. **根路径 `.`（L7，第 4 片 §12 第 7 条）：**
   - `pathOwnershipOf` 同时返回胜出的前缀；图上下文、正式比较各自的前缀匹配和跳过 `.` 的写法都删了。
   - 按路径搜索时，目录里只有根模块，搜任何非空路径都返回根模块；两个根模块都返回；搜 `.` 返回所有模块（它们都在根目录下）。其他调用方照旧“并列不归任何模块”。
   - 文件锚点按全部映射判归属（和写入时一样），再只留有节点的模块；并列而没有节点的，锚点不属于任何模块。
4. **8A 之前的旧观测：** 没有 `fileGraph` 的记录按当时的规则核对成员（文件属于任何一个前缀匹配的模块），新记录按最长前缀；旧记录也能当下一次捕获的 `previous`。文件图三页对旧观测返回 `notCaptured: true` 的空页；这一支在服务层测，平台入口造不出旧记录，不另做二进制旧库夹具。
5. **文件图的读（L12）：**
   - `listFiles`、`neighbors`、`impact` 三页都返回 `languages`，读的人能看出“引用未支持”。§7.2 说的“捕获结果和读取”就是指这三页。
   - 先核对游标身份，再走旧观测的分支。
   - 三页共用一个读取助手；Host 授权收窄后，节点路径或覆盖里的问题路径有一条不在授权内就 `forbidden`，原因是一句通用的话，不带路径。
6. **没有目录也能抓：** `mappings: []` 合法，TS 项目照样有文件层，模块层是空的。
7. **上限和分块：** 文件图的上限（20,000 节点、100,000 边）可经平台选项注入（测试用）；分块大小只经服务的依赖注入。打包是线性的；零个节点也写一个空块，用来和旧观测区分。
8. **已知限制：** 模块级记录正文有 256 KiB 的上限，约 900 个 TS/JSON 文件会超；这在 8A 之前就有，合入后由 lead 实测再定。
9. **行数：** 生产代码施工 +1,460/−109，四次返工共 +503/−298；合起来 +1,722/−166，净增约 1,556 行，在估的约 1,600 行以内。

## 10. 8A 观测规模的修正（lead，2026-10-17，决定 77）

8A 合入后 lead 请 Claude 子 agent 实测了两次，Codex 只读核对（HANDOFF 决定 77）：

- **本仓库自己**（2,196 个 TS/JS/JSON 文件，平均路径 62 字节）：模块级正文 555,020 字节，是 256 KiB 的 2.1 倍，抓取退回 `capacity`。正文里每个文件的路径存了三份（`files`、首抓的 `changes.added`、模块快照的 `indexedSources`），没解析的引用存两份（`summary.coverage.unresolved`、`architecture.unresolved`）；模块快照自己也超过它的 240 KiB 上限。按“3 × 路径 + 210 字节”一个文件算，平均路径 40 字节约 790 个文件就超。观测的 TS 分析在 10,000 条引用处停（这棵树约 12,100 条），按 §9 第 1 条记为失败，模块层是空的。
- **规模**（合成的 2k–20k 个文件和真实代码）：
  - 合成的小文件（每个约 350 字节）到 20,000 个文件、99,980 条引用也能抓，143 秒、1.7 GB；时间的约 86% 是三遍整份读取（抓取一遍、两次核对各一遍）。
  - 真实代码每个程序文件约 0.65 MB 内存，一次观测**建两份 TS 程序**（模块层一份，文件层又建一份），两份都留到捕获释放。1,099 个程序文件（约 20 MB）峰值 2.14 GB；3,126 个（62.5 MB）在 Node 默认的堆（这台机器 2,240 MiB）下第一次分析就内存不够，调高堆以后峰值 4.73 GB。平台没有传堆参数。
  - 引用多少不是成本：100,000 条引用的遍历只要 1.6 秒；成本是程序里的源码量。
  - 文件层今天每条边 `{"from","to"}` 存两条路径（约 2 × 路径 + 20 字节）：20,000 个节点、100,000 条边在平均路径 49.5 字节时要 54 块，平均路径超过约 60 字节就超过 64 块。
  - **出错记成了成功：** 2,000 个文件、有循环引用的合成项目，第二次分析在 TypeScript 里栈溢出，观测照样提交，文件边是 0、模块层是空的。今天文件层的提供者已经把第二次分析的异常记为失败（`architecture-language-provider.ts:126`），但模块层沿用第一次的成功结果（`capture.ts:598`），两层的说法对不上。

下面各条改 L12 和 §9；和它们冲突时以本节为准。只改观测这一条路：第 4 片的严格捕获（`captureProjectSource`）、别的调用方的查询上限、核对（`verify`）照旧。

1. **哪些文件算项目文件（决定 77，用户定）。**
   - **观测有自己的文件枚举**，在读观测材料的地方（`access.ts` 的观测读取）做，不套用核对读取器（`verification-workspace-reader.ts`）“工作区必须是仓库根”的限制。
   - **在 git 工作树里：** 文件清单是 git 不忽略的文件：已跟踪的加没跟踪、没被忽略的（`git ls-files --cached --others --exclude-standard -z`）。git 在工作区根下跑（工作区可以是仓库的子目录），列出的路径相对工作区根。忽略规则读仓库里的 `.gitignore` 和 `.git/info/exclude`；git 在沙箱的环境里跑（`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_NOSYSTEM=1`，同 `workspace-sandbox.ts` 的 `#gitStatus`），所以用户全局配置里的排除文件不读。跟踪了但磁盘上已删的不算；子模块不进；符号链接照旧跳过。只复用现有 git 读取起进程的那一层（`git-read.ts`、`access.ts` 的 `createWorkspaceGitReadAccess` 下面的进程和环境），不走它“工作区必须是仓库根”的检查（`git-read.ts:173`）。
   - **不在 git 工作树里、或 git 不能用**（找不到、出错）：用固定的跳过名单，任何一层名字是 `.git`、`node_modules`、`.venv`、`venv`、`__pycache__`、`.mypy_cache`、`.pytest_cache`、`.tox` 的目录都不进；**在递归时就不进这些目录**，不是全扫完再筛。`dist`、`build`、`out`、`target` 不在名单里（有的项目源码就放在这些目录）。观测读取里今天已有的硬跳过和这张名单对齐，只留一份。
   - **不回退的情况：** 取消照旧是 `cancelled`；git 列出的超过 60,000 项的枚举上限时整次 `capacity`、给出数到多少；这两种都不换用跳过名单。
   - 观测记录记下用的是哪一种：`inventory: { source: 'git' | 'skip_list', reason: string | null }`，`skip_list` 时 `reason` 是“不是 git 仓库”或“git 不能用：<原因>”。三个文件页把它和 `languages` 一起返回（页上只多这一个字段）；没有这个字段的旧观测读作 `null`。
   - 清单在冻结材料之前定；冻结材料、分析、文件层都只用这份清单里的文件（§9 第 1 条）。被忽略的文件不进材料，所以分析解析不到 `node_modules` 里的包，这些引用照旧记为没解析。

2. **模块快照和正文不再逐文件列出（改 L12 的“模块级的不变”）。**
   - **逐文件的数据只在文件层存一份：** 路径、摘要、字节数、语言、`nonBlankLines`、这次分析是否解析了它（`indexed`）。
   - **模块快照先变紧凑**（`architecture-source.ts` 今天在建快照时就查 240 KiB，`:75`）：不再带 `indexedSources`，其余不变；`architecture.unresolved` 留在快照里（带行号，模块查询要用，`graph-index.ts:147`），契约里它的条数上限照旧（`contracts/architecture-source.ts:67`）。
   - **模块级正文（`schemaVersion: 2`）** 不再有 `files`、`changes` 的路径列表；`summary.coverage.unresolved` 不再在正文里重复（文件层的没解析引用给正式比较用，`formal-comparison.ts:48`，见第 6 条）。正文放：捕获身份、`observedAt`、汇总（文件数、各语言的数、改动的三个数）、映射、紧凑的模块快照。正文不再随文件数增长，但仍随模块、模块边和模块层没解析的引用增长；256 KiB、240 KiB 两个上限照旧，超了照旧 `capacity`。
   - **改动的范围照旧：** 和上一次观测比的新增、改了、删了，照今天只算捕获导出的文件（TS/JS/JSON，`architecture-service.ts:755`），只存三个数；路径列表不再存（今天没有公开的读者，`architecture-service.ts:655` 的三页不返回它）。
   - **读正文的地方改读块：** Host 授权的逐路径核对和读上一次观测（`architecture-service.ts:522`、`:718`）合成一个读块的助手，三个文件页也用它；解码时的成员核对（`architecture-record-codecs.ts:273`、`:369`）改按块里的节点。
   - **旧正文照读：** `schemaVersion: 1` 的正文（8A 合入以后、本段之前写的）按 v1 解码、核对成员，也能当下一次抓取的 `previous`；8A 之前没有文件层的旧观测照 §9 第 4 条。

3. **一次观测一次分析，两层共用。**
   - 模块层和文件层用同一次分析的结果，文件层不再建第二份程序；两层的覆盖出自同一个结果，说法一致（§9 第 1 条“一个分析结果”现在也是一次计算）。
   - 程序在两层都建好以后释放，不留到捕获释放；冻结材料的核对照旧。

4. **分析的上限按冻结材料里 TS/JS 的大小，不按引用条数。**
   - 观测的分析不再用 10,000 条的查询上限（`workspace-tools.ts:10`，`capture.ts:563`、`:205`、`:236`）。
   - 建程序之前，数冻结材料里 TS/JS 和 `.json` 文件的数目和总字节数（程序最多只能装进这些文件，加上 TS 自带的库：配置的根文件会经 import 带进别的文件，TS 也能 import JSON，所以不按根文件数，也不能漏 JSON）。超过**默认 2,000 个文件或 40 MiB** 时不建程序：TS 覆盖记为失败，原因写“程序太大：<文件数> 个文件、<字节数> 字节，上限 2,000 个、40 MiB”；模块层是空的，文件层照样有全部文件和行数（§9 第 1 条）。两个上限可经平台选项注入（测试用）。
   - 默认值的来由：真实代码一份程序约 0.65 MB 一个文件，2,000 个约 1.3 GB，加上进程本身，在这台机器 Node 默认的堆里放得下；3,126 个放不下。调高堆或把分析放进子进程以后再放宽，不在本段做。
   - 原始引用超过 100,000 条时同样记为失败，原因带条数；去重后的边超过 100,000 照 L12 退回 `capacity`。8D 的 C/C++、Python 的边和 TS 的合在一起算这 100,000。

5. **分析出错不能记成成功。** 任何一门语言的分析里出异常或被拒（栈溢出、程序建不起来、分析器回 `rejected`、脚本输出读不了），这门语言的覆盖都记为失败，原因带异常的类型和消息的前 200 个字符，`complete: false`；别的语言不受影响（L13）。TS 失败时模块层是空的，文件层照样有文件和行数。分析失败时不能提交“0 条边、模块层空”而覆盖说成功的观测（一个真没有引用的项目，0 条边、覆盖成功是对的）。8D 的两个提供者已经把 `rejected` 记为失败，保留它们的分支，只补上异常类型和 200 个字符的截断。

6. **文件层的存法（改 L12 的“存法”和 §9 第 7 条的打包）。**
   - 块和观测记录里的清单都带版本号（`schemaVersion: 2`）；节点按路径排序，块里的边存成节点序号对 `[i, j]`，序号指这次观测排好序的整张节点表，可以跨块；解码时核对序号都在范围内、节点和清单里的数、成员的摘要对得上。
   - 文件层没解析的引用（今天在观测记录里的 `fileGraph.unresolved`，没有上限）挪进块里，记录里只留条数；正式比较从块里读。
   - 64 块、每块 256 KiB 的上限照旧，节点、边、没解析的引用都算在里面，超了 `capacity`。按实测，20,000 个节点（带摘要和字节数）加 100,000 条边约 5.2 MB、约 20–22 块（平均路径 69 字节时也在 64 块以内）；没解析的引用多时会更多。
   - 三个文件页**显式**只取路径、`nonBlankLines`、`language` 和边（`file-graph-index.ts:74` 今天整个节点照搬），新加的摘要、字节数、`indexed` 不出现在页里；页上只多第 1 条的 `inventory`。

7. **还没做、留作已知限制的：**
   - 三个文件页每次调用都读全部的块（54 块时约 265 毫秒一次）；按块建索引以后再做。
   - 一次观测读三遍整份材料（抓取、两次核对），是时间的大头；核对要防抓的时候源码挪了，不在本段改。
   - 分析仍在 Host 进程里跑，上限靠第 4 条的预检；调高堆或放进子进程以后按实际用量再做。

8. **测试（新增 A-07–A-16，经公开入口，内存和 SQLite 各跑一遍，另说明的除外；期望值是手算的字面量）：**
   - **A-07 git 仓库：** `.gitignore` 忽略 `node_modules/`、`dist/`，另有一个没跟踪也没被忽略的源文件；工作区是仓库的子目录时同样 → 文件页里没有被忽略的，有那个没跟踪的；`inventory.source` 是 `git`。
   - **A-08 不是 git 仓库：** `node_modules/`、两层深的 `a/b/.venv/` 都不进，`dist/` 进；`inventory` 是 `skip_list`、原因“不是 git 仓库”。
   - **A-09 规模：** 1,500 个文件、平均路径 60 字节以上、没有没解析引用的 TS 项目能抓（今天会退回 `capacity`）；`listFiles` 翻页拿到全部 1,500 个；引用超过 10,000 条的项目模块层不空（今天会空）。
   - **A-10 程序太大：** 经平台选项把上限设成 50 个文件，60 个 TS 文件的项目 → TS 覆盖失败、原因带“60 个文件”，模块层空，文件层 60 个文件和行数都有；字节上限一例；40 个 TS 文件加 20 个 `.json` 文件同样超 50 个一例。
   - **A-11 分析出错：** 经分析器的注入让它抛出（允许的故障注入）→ 该语言覆盖失败、`complete: false`、原因带异常消息，观测提交，文件层有文件；断言的是语言覆盖的 `complete`，不是页的 `complete`（那只是分页）。
   - **A-12 跨块：** 经服务注入把块大小设小，节点和边分在多块、有跨块的边 → 三个文件页读到的节点、边是手算的字面量（不和一块时的输出互比）；把节点、边、没解析的引用的块数加起来超过 64 → `capacity`。
   - **A-13 多语言合计：** 经平台选项把边上限设小，TS 和 Python 的边各自没超、合起来超 → `capacity`，给出数到多少（8D 的环境）。
   - **A-14 授权收窄：** 抓完以后收窄 Host 授权，块里有一个节点路径不在授权内 → 三页都 `forbidden`，原因不带路径（§9 第 5 条）。
   - **A-15 和上一次比：** 四个 TS 文件，抓一次；经真实的文件写入改一个（多两行）、加一个、删一个、另一个不动，再抓并把第一次当 `previous` → 第二次抓取成功；`listFiles` 的字面量里有新加的、没有删掉的，改的那个 `nonBlankLines` 多 2，不动的那个和第一次一样。改动的三个数今天没有公开的读者，不另断言。
   - **A-16 的夹具：** 在本段施工之前的提交上，经公开入口抓一次、关库，把 `ledger.sqlite`、`artifacts.sqlite`、捕获引用和那份源码存进 `tests/fixtures/s8-observation-v1/`，附生成时的提交号和一次性的生成脚本；`.gitignore` 给这两个库文件加精确的例外；每个用例把夹具复制到自己的临时目录，库和工作区分开，不互相改。
   - **A-16 旧正文当 `previous`：** 用本段之前的代码真实写出一个带 v1 正文的 SQLite 账本（经公开的抓取入口，不手写记录），放进测试夹具；新代码打开它，三页能读，把它当 `previous` 再抓能成功。只有 SQLite（内存后端没有能带进来的旧账本）。
   - **改断言的旧测试：** `R3d-record-integrity`、`S8A-file-layer`、`S8A-root-path`、架构编解码的测试里读 `body.files`、`indexedSources`、边的路径形状的断言；断言整页的旧测试只补 `inventory` 一项。

9. **行数和时机：** 生产代码粗估 600–900 行：观测的文件枚举（新的进程调用和跳过名单）约 150–200，正文 v2、紧凑快照、块的编解码和 v1 分支约 250–350，一次分析和上限约 100–150，读块助手、授权和接线约 100–150，8D 两个提供者补异常类型和截断约 10–20。接在 8D 的审查返工完之后（8D 的代码上）做，和 8D 一起合入；验收和合入前的全量跑在合起来的那棵树上。施工一轮，返工照决定 75 不限轮数。

## 11. 观测用轻型扫描读引用（lead，2026-10-17，决定 78）

用户定的在 HANDOFF 决定 78。调研、挑错、Codex 的核对、代码事实、C/C++ 的实测和对第三稿的核对放进 8D 的证据。下面各条改头部后注列的那些节，冲突时以本节为准。每条后面写明属于哪一段：〔8D 返工〕或〔§10 段〕。

### 11.1 分工：观测和查源码各用各的

- **观测**（L12 的文件层和模块层）只用本节的轻型扫描。轻型扫描只读语法、把引用对到文件，不做类型检查、不做名字推断。模块层照旧只用 TS/JS 的结果；C/C++、Python 只进文件层。
- **agent 查源码的工具**（`project_index`、`python_index`、`cpp_index` 和严格捕获 `captureSourceChanges` 的语义查询）照旧用 8D 之前的重型分析器。〔8D 返工〕
  - **拿掉 8D 为观测加的（回到 8D 之前）：**
    - `scripts/cpp-source-query.py` 的逐文件覆盖、读 `#include` 的绑定和编译单元容错：解析不了的编译单元照旧让整次查询 `unsupported`；
    - `scripts/python-source-query.py` 的逐文件覆盖（`importCoverage`）；
    - `cpp-source-index.ts` 的 `imports` 缓存；
    - `python-source-index.ts` 新加的“分析器包缺文件 → `unsupported`”（`MissingAnalyzers`）：缺文件照旧 `rejected`；
    - 两个提供者里的翻页收集和行转换（观测不再翻页）。
  - **保留：** 两个索引的构造选项（`pythonPath`、Python 的分析器目录、`libraryPath`）；从平台选项到探索工具的 `sourceAnalyzers` 接线；`python_index` 8D 之前就有的结果缓存（最多 32 份，快照变了就清）；捕获登记非 TS 提供者的构造参数；两个脚本的摘要照旧写进 `runtime-assets.json`。
  - **`python_index` 只改三处**（8D 审查第 3 条）：分析器目录作为脚本的第一个命令行参数传进去，脚本的摘要核对、解开、导入都用它；解释器加 `-S`；导入不了 Jedi 时消息是 `Python semantic provider missing: jedi is not in <目录>/analyzers.zip`。
  - `sourceAnalyzers.directory` 只给探索工具；观测的提供者只用 `pythonPath`、`cppLibraryPath` 和 §11.5 的两个限时（`unitTimeoutMs`、`languageTimeoutMs`）。
  - 核实时发现：8D 把每个文件的结果放进 `imports` 的每一页，Python 约 1,300 个文件以上（C/C++ 更少）时工具输出超过 60 KiB 的上限（`exploration-tools.ts:160`），`imports` 整个用不了；拿掉以后恢复。
- **观测的捕获不带分析器。**〔§10 段〕观测用的捕获（`architecture-service.ts` 里建、用完就释放的那一份）不再建 TS 程序；扫描结果存成自己的类型，不拼 `SourceRelation`；对它做语义查询（含 `imports`）回 `unsupported`。
  - §10 第 3 条改成：扫描在捕获时做一次，模块层和文件层共用这一个结果；文件层不再另建提供者重扫（今天另建，`architecture-language-provider.ts:101`）。
  - §10 第 4 条的预检（2,000 个文件、40 MiB）删掉：观测里没有程序可建。观测里的三处 10,000 条上限也去掉：`capture.ts:565` 的查询上限、`:207` 的 `exportMaterial`（relations 和 files 两项）、`:238` 的 `architectureSource`。只留两个 100,000（原始引用、去重后的边，§10 第 4 条后两句；三种语言的边合起来算）。
  - §10 别的几条跟着改：第 2 条里模块快照的 `unresolved` 照 §11.2 的“模块快照的没解析”截短；第 5 条最后两句作废（两个提供者改接 §11.5 的执行器，不再有 `rejected` 的分支）；第 7 条第 3 点改成“TS 的轻型扫描仍在 Host 进程里跑，内存跟冻结材料（最多 128 MiB）走，一次只留一个文件的语法树，不再有预检”；第 8 条 A-16 的夹具照 §11.6 的“旧记录”生成；第 9 条的行数以 §11.7 为准。
  - 严格捕获和 `project_index` 仍在 Host 里建不设上限的 TS 程序：记为已知限制，不在这两段改。

### 11.2 TS/JS〔§10 段〕

- **读配置：** 把 `TypeScriptSourceAnalyzer.configure`（`typescript-source-query.ts:237–265`）里定配置的一段抽成一个导出函数，`configure` 和轻型扫描都调它；建 LanguageService 宿主的一段（`:266–285`）留在 `configure`。行为不变：
  - 没给路径时依次用根上的 `tsconfig.json`、`jsconfig.json`；都没有时用今天的默认选项（`module`、`moduleResolution` 都是 `NodeNext`，`allowJs: true`），根文件是全部 TS/JS 源文件，去掉路径里含 `/node_modules/`、`/dist/`、`/build/` 的；
  - `extends`、`paths`、`baseUrl`、`rootDir`、`outDir` 由 `ts.parseJsonConfigFileContent` 处理；
  - 选配置照 §11.5 的“选配置看存在”：根上的 `tsconfig.json` 被跳过时不退到 `jsconfig.json`，也不退到默认选项；
  - 配置有错（含 `extends` 指向材料里没有的包；§10 以后 `node_modules` 不在材料里）→ 这门语言 `failed`，原因 `配置错误：<消息的前 200 个字符>`（消息里的路径先照 §11.5 换成文件名），不换配置。
- **带 `references` 的配置：** 只要有 `references`（有没有自己的文件都一样，同今天 `:262` 的条件）→ 这门语言 `edges: 'unsupported'`、`parsed: 0`，原因 `根配置带 references，观测还不跟进`；模块层是空的。严格捕获和 `project_index` 照旧。
- **分析哪些文件：** 从根文件出发，用显式队列沿引用走，不递归。一条引用对到材料里、而且能装进的文件，就把那个文件放进队列；走到的文件就是分析的文件；`.json` 走到了只记下（模块层的 `sources` 要用），不扫。除了“已知的差别”，这和今天程序装进的文件相同，`parsed` 的意思不变。归 TS 但没走到的文件记 `skipped`，原因 `不在 TS 分析的范围里`（只有行数）。
- **能不能装进（照 TS 程序的规则）：** `.ts`、`.mts`、`.cts` 和声明文件都能装；`.tsx` 要配置里有 `jsx`；`.js`、`.mjs`、`.cjs` 要 `allowJs`（没写时等于 `checkJs`），`.jsx` 两样都要；`.json` 要 `resolveJsonModule`；别的扩展名要 `allowArbitraryExtensions`，写引用的文件是声明文件时不要。这些选项没写时照 TS 的计算值（例如 `module` 是 `node20`、`nodenext`，或 `moduleResolution` 是 `bundler` 时 `resolveJsonModule` 为真，`typescript.js:22109–22123`）：施工时用 `ts.getResolutionDiagnostic(选项, 解析结果, 写引用的文件)` 判能不能装进，`allowJs` 用 `ts.getAllowJSCompilerOption(选项)`，不自己重写默认值。装不进的读作没解析；配置开了 `noResolve` 时只分析根文件。
- **每个文件：** 先取格式 `ts.getImpliedNodeFormatForFile(文件名, 缓存.getPackageJsonInfoCache(), 宿主, 选项)`；再解析语法 `ts.createSourceFile(文件名, 内容, { languageVersion: 选项.target ?? ts.ScriptTarget.Latest, impliedNodeFormat }, true)`（第四个参数必须是 `true`，取解析方式时要读父节点）；用显式的栈遍历语法树，不递归。
- **收哪些引用：** `import … from`、`export … from`（含只导入、只导出类型的）、`import "…"`；`import x = require("…")`；`import("…")`（第一个参数是字符串或不带替换的模板字符串）；`require("…")`，只在 `.js`、`.jsx`、`.mjs`、`.cjs` 文件里收，只有一个参数，参数是字符串或不带替换的模板字符串；类型里的 `import("…")`；`/// <reference path="…">`、`/// <reference types="…">`。不收 `/// <reference lib>`。决定 78-2 的“TS 的 `require`”按 TS 程序的做法读：JS 文件里的 `require("…")` 和 TS 的 `import x = require("…")` 算边，TS 文件里单独的 `require(…)` 不算。
- **模块引用对到文件：** 每条先取方式 `ts.getModeForUsageLocation(语法树, 说明符节点, 选项)`，再调 `ts.resolveModuleName(说明符, 文件名, 选项, 宿主, 缓存, undefined, 方式)`。方式不能省：`nodenext` 下省了会按 CommonJS 解析，ESM 文件里不带扩展名的相对引用会被解析出来，多出今天没有的边。整门语言共用一个 `ts.createModuleResolutionCache('/workspace/', 名字 => 名字, 选项)`。宿主：`fileExists`、`readFile` 读冻结材料；`directoryExists` 查一个预先算好的目录集合（今天的宿主每次扫全部键，`:280`，2 万个文件时是平方级）；`useCaseSensitiveFileNames` 是 `true`；当前目录 `/workspace/`；不给 `realpath`。
- **三斜线对到文件：** `path` 不走模块解析，用 `ts.resolveTripleslashReference(写的路径, 文件名)`：带扩展名时扩展名要是 TS 的（开 `allowJs` 加 JS 的，开 `resolveJsonModule` 加 `.json`，都照计算值）、文件在材料里；不带扩展名时依次试 `.ts`、`.tsx`、`.d.ts`，开 `allowJs` 再试 `.js`、`.jsx`。`types` 用 `ts.resolveTypeReferenceDirective(名字, 文件名, 选项, 宿主, undefined, 类型缓存, ts.getModeForFileReference(引用, 语法树.impliedNodeFormat))`，类型缓存是一个 `ts.createTypeReferenceDirectiveResolutionCache`。
- **一条引用的结果：** 对到材料里能装进的文件 → 一条边，并把那个文件放进队列；对不到、对到材料外、或装不进 → 一条没解析的引用，说明符照写的记（不带引号）。每条都记所在文件、行号、说明符、目标文件或“没解析”。
- **行号：** 节点开始处（`node.getStart(语法树)`）所在的行，和今天一样：声明取声明的开始；`require(…)`、`import(…)` 取调用的开始；类型里的 `import("…")` 取它自己的开始；三斜线取写的路径或名字所在的行。
- **出错：** 每个文件一个 try/catch，包住这个文件的语法解析、遍历和解析调用。catch 里先看取消信号，已取消就原样抛出；别的异常（含栈溢出的 `RangeError`）让这个文件 `failed`，原因 `<异常类型>: <消息的前 200 个字符>`，这个文件收到的引用丢掉，别的文件照常。原始引用的计数在 try 外面加、外面查：超过上限（默认 100,000，经 `lightScan.maxRawReferences` 注入）就停，这门语言 `failed`，原因 `原始引用超过 <上限> 条`。配置、队列这些文件以外的地方抛出 → 这门语言 `failed`（§10 第 5 条改成这两层）。整门语言失败时 `issues` 照 §11.5；TS 带显式配置（捕获请求里的 `configPath`）失败时，照 8A 在 `issues` 里另记这份配置一条 `failed`，原因同 `reason`（`capture.ts:350`）。
- **不卡 Host：** 大约每 50 毫秒 `await` 让出一次事件循环，再 `signal.throwIfAborted()`；这两步在逐文件的 try 外面。
- **两层共用的结果（§10 第 3 条）：** 模块层取走到的文件（含失败的和走到的 `.json`）作为 `sources`（失败的文件照样进，今天程序也装着有语法错误的文件；失败记在文件层的 `issues`，正式比较据此把它的模块读作 `unknown`，§9 第 2 条），每条引用的所在文件和摘要、行号、说明符、`resolved` 或 `unknown`、目标的路径和摘要，以及用的配置路径。文件层取去重的边、去重的没解析引用和每个文件的状态。
- **模块快照的没解析（改 §10 第 2 条）：** 快照的 `unresolved` 照旧逐行（`mapping has no indexed TS/JS source: …`、`unmapped source: <路径>`、`unresolved import: <文件>:<行> -> <说明符>`），去重、按字符串排；超过 500 行或累计 64 KiB 时，只留前面不超过这两个数的行，再加一行 `另有 <n> 条没列出，逐条见文件层`（n 是去掉的行数）。逐条的没解析引用都在文件层的块里，正式比较读的就是那一份。为什么：决定 77 以后 `node_modules` 不在材料里，包名和 `node:` 开头的引用都没解析；本仓库非相对的引用约 1,521 处，已是契约 2,048 行上限（`contracts/architecture-source.ts:67`）的 74%；超了是 `invalid unresolved relations`，而 `capture.ts:247` 只把带 capacity 的消息映射成 `capacity`，整次观测会退回 `invalid`。
- **捕获的引擎身份：** 观测捕获的 `engine`、`engineVersion` 照旧是 `SOURCE_ENGINE`（`typescript-language-service@<TS 版本>`），捕获引用的 `indexVersion` 和模块快照的 `indexVersion` 一起用它（`architecture-record-codecs.ts:356` 要求两者相等）；`projectConfiguration` 是扫描用的配置路径，TS `failed` 或 `unsupported` 时是 null；`indexedSourceCount` 是走到的 TS/JS 文件数；`complete` 等于 TS 的 `edges` 是 `supported`。
- **故障钩子（测试用）：** 平台选项 `lightScan?: { fault?: (event: { phase: 'language' } | { phase: 'file'; path: string }) => void; maxRawReferences?: number }`，经 `workspace-tools` 进捕获的登记（先例是 `fileGraph`）。轻型扫描在整门语言开始时调一次 `{ phase: 'language' }`，在每个文件开始时调 `{ phase: 'file', path }`（在逐文件的 try 里）。返回值不看；它只能抛出，不能改结果；正常的文件照样真解析。测试可以在钩子里中止这次请求的 `AbortController` 再抛出，用来确定地测取消。
- **已知的差别（写在这里和工具说明里，不进每次观测的 `notes`，不当错误）：**
  - 环境里 `declare module "x"` 满足的引用读作没解析；今天的目标是写这个声明的文件。
  - 被别的文件用 `declare module "./x"` 扩充的模块，今天的目标多一个扩充它的文件，轻型扫描没有。
  - JS 文件里 JSDoc 的 `@import` 和 JSDoc 里的 `import("…")` 不收，只靠它们走到的文件不分析。
  - TS 文件里的 `require`、`importHelpers` 的 `tslib`、jsx 运行时、配置 `types` 里的名字不收。
  - 被局部变量遮住的 `require` 会多算（今天的程序也照样跟进）。
  - 多包仓库里按包名的引用（`@org/lib`）在没有 `node_modules` 时读作没解析，以后做（决定 78-2）。
  - `baseUrl` 在 TS 6.0.3 里仍是非相对名字的查找根（`typescript.js:45105–45110`），留一条测试确认。

### 11.3 Python〔8D 返工〕

- **新操作 `import_graph`：** 放在 `scripts/python-source-query.py` 里，按命令行参数分路：带 `import_graph` 时在解开分析器包（今天 `:115–137`）之前分出去，只用标准库；`import tomllib` 挪到版本检查之后（Python 低于 3.11 时报 `unavailable`）。读配置复用 `project_configuration`，加一个观测模式的参数。经 §11.5 的执行器运行，一个单元是一个文件。改了脚本要更新 `runtime-assets.json` 里它的摘要。
- **每个文件：** `ast.parse` 一次。`SyntaxError`、`RecursionError`、`MemoryError`、`ValueError` 让这个文件 `failed`，原因 `<异常类型>: <消息>`（`SyntaxError` 取 `msg`，别的取 `str(e)`，截前 200 个字符；WSL 的 Python 3.12 对 `def broken(:` 给 `SyntaxError: invalid syntax`）。收语法树里所有 `Import`、`ImportFrom`（含函数里、`try` 里、`if TYPE_CHECKING` 下的）；不收 `importlib.import_module` 和 `__import__`。用的 Python 解析不了更新版本语法的文件时，逐个失败。
- **查找根：** 选配置照 L13（`pyrightconfig.json` → `pyproject.toml` → `setup.cfg`，都没有时没有配置），并照 §11.5 的“选配置看存在”。根的顺序照今天的代码（`python-source-query.py:81–109`），按配置分开：
  - `pyrightconfig.json`：配置所在目录 `.`；`autoSearchPaths` 不是 `false`、且 `src/` 下有 Python 文件时加 `src`；`extraPaths`；`stubPath`。
  - `pyproject.toml`：`.`；`[tool.setuptools]` 的 `package-dir` 里空包名那一项；`[tool.setuptools.packages.find]` 的 `where`；然后 `[tool.pyright]` 的 `src`、`extraPaths`、`stubPath`，规则同上（没有 `[tool.pyright]` 时也照 `autoSearchPaths` 的默认加 `src`）。
  - `setup.cfg`：`.`；`[options]` 的 `package_dir` 里 `=` 开头的行；`[options.packages.find]` 的 `where`（逗号或换行分开）；不加 `src`。
  - 没有配置：`.`；`src/` 下有 Python 文件时再加 `src`。

  观测模式下：
  - **`pyrightconfig.json` 照 pyright 的写法读：** 先去掉字符串外面的 `//` 行注释（到行尾）和 `/* */` 块注释（每个换成一个空格；没收尾的块注释算解析不了），再去掉字符串外面、后面只隔着空白就是 `}` 或 `]` 的逗号，然后按 JSON 解析（pyright 自己接受这种写法，真实项目里有写注释的；不这样读整门 Python 就失败）。`python_index` 不变。
  - **不用、写进 `notes`：** `pythonVersion`、`pythonPlatform`、`venv`、`venvPath`、`typeshedPath`；`executionEnvironments`（里面的 `root`、`extraPaths` 也不用，靠它们才对得上的引用读作没解析）；`include`、`exclude`、`ignore`（只看 `pyrightconfig.json` 和 `[tool.pyright]` 里的；`[tool.setuptools.packages.find]` 的 `include` 这类不记，Django 5.1 就有）；有包名的 `package-dir`（`package_dir`）。别的字段照旧不看、不记。
  - **用不了的查找根去掉、写进 `notes`：** 先去掉结尾所有的 `/`（`src/`、`src//` 都照 `src` 用；只剩空串时算空段；写进 `notes` 时照配置里原样写）；然后是绝对路径；含 `\`、`:`、`$`、`~`、`*`、`?`；有一段是空的或者是 `..`（按段算，`a..b` 不算；同今天 `python-source-query.py:29` 的判法）；在跳过的目录里；下面没有认领的 Python 文件（§10 以后被 git 忽略的 `extraPaths` 就是这样）。
  - **仍让这门语言 `failed`，原因只用这些字面量：** `配置错误：<文件名> 解析不了`（JSON、TOML、`setup.cfg` 解析不了）；`配置错误：pyproject.toml 的 package-dir 的空包名不是字符串`；`配置错误：pyrightconfig.json 不是对象`；`配置错误：pyproject.toml 的 <tool|tool.setuptools|tool.setuptools.package-dir> 不是表`；`配置错误：pyproject.toml 的 tool.pyright 不是对象`；`配置错误：<文件名> 的 extraPaths 不是字符串列表`；`配置错误：<文件名> 的 stubPath 不是非空字符串`；`配置错误：pyproject.toml 的 packages.find.where 不是字符串列表`；`配置错误：<文件名> 的 extends 观测还不跟进`（基础配置里常有查找根，不跟进就等于换了配置；在材料里跟进 `extends` 以后再做）。`<文件名>` 是 `pyrightconfig.json`、`pyproject.toml` 或 `setup.cfg`（`setup.cfg` 只会出现在“解析不了”这一条）。
  - 这个放宽只对 `import_graph`。`python_index` 不放宽：那 7 个 pyright 字段和有包名的 `package-dir` 照旧回 `unsupported`，查找根用不了照旧回 `rejected`（要有测试）。
- **对到文件（照 CPython 的规则，一级一级解析）：** 名字和后缀要和材料里的路径完全一致，包括大小写。
  - **在一组目录里找名字 `n`：** 按顺序逐个目录 `d` 看：有 `d/n/__init__.py` → 正规包，停；有 `d/n.py` → 模块，停；有 `d/n/__init__.pyi` → 正规包，停；有 `d/n.pyi` → 模块，停；`d/n` 是材料里某个 Python 文件的祖先目录（任意一层）→ 记一个命名空间部分，接着看下一个目录。都看完还没停：记过命名空间部分的，结果是命名空间包（它的目录是记下的那些部分）；一个也没记的，是找不到。
  - **`import a.b.c`：** 第一段在查找根里找，之后每段只在上一段的目录里找（正规包是它自己的目录，命名空间包是它的全部部分），不回到别的查找根重找。结果按下面的顺序取第一种成立的：第一段只找到命名空间包、而且名字在 `sys.stdlib_module_names` 里 → 没解析，原因 `命名空间目录和标准库重名`（所以 `import email` 是这一种）；某段是模块、后面还有段 → 没解析，原因 `<到这一段为止的点号全名> 是模块，不是包`（如 `a.b 是模块，不是包`）；某段找不到 → 没解析，原因 null，第一段找不到而且名字在 `sys.stdlib_module_names` 里时原因 `标准库`（Django 5.1 的 2,500 条没解析里有 2,278 条是这一种）；最后一段是正规包或模块 → 一条边，指向它的文件；最后一段是命名空间包 → 没解析，原因 `命名空间包，没有文件`。不给中间各级的 `__init__.py` 加边。
  - **第一段只找到命名空间包（名字不在 `sys.stdlib_module_names` 里）：** 照上面和下面两条算，结果是没解析时，原因（含 null）一律换成 `命名空间目录，可能是同名的外部包`；结果是边的照旧是边。为什么：观测看不到装在别处的包，项目里一个同名的、没有 `__init__.py` 的目录可能只是挡住了它（工作区只是一个 ROS 包时，包里的 `launch/` 目录挡住 `launch` 包：这条在 ros2/demos 逐包扫时换掉 10 条（5 条 `from launch import …` 原是 `命名空间包，没有文件`，5 条 `import launch.…` 原是 null），SLAM 换掉 14 条（3 + 11）；整个仓库当根时 0 条；不换的话同一批文件里两种写法的原因前后不一致）。这一条和上面的“标准库”两条都只用于绝对导入：相对导入的名字带着包名，外部的包和标准库都挡不住它。
  - **`from X import n`：** 先照上面解析 `X`，只看前三种结果（第一段只找到命名空间包、而且和标准库重名；某段是模块、后面还有段；某段找不到）：是这三种时整句没解析，原因同 `X` 的；`X` 的最后一段是命名空间包时不算没解析，照下面“`X` 是包”走。`X` 是模块 → 边指向 `X` 的文件。`X` 是包时在 `X` 的目录里（命名空间包是它的全部部分）找 `n`：是模块或正规包 → 边指向它的文件；是命名空间包 → 没解析，原因 `命名空间包，没有文件`；找不到时，`X` 是正规包 → 边指向 `X` 的文件，`X` 是命名空间包 → 没解析，原因 `命名空间包，没有文件`。同一句导入几个名字，各自算。
  - **`from X import *`：** 边指向 `X` 的文件；`X` 是命名空间包 → 没解析，原因 `命名空间包，没有文件`。
  - **相对导入（PEP 328）：** 文件的模块名取包含它的最长的查找根算出的相对路径，去掉后缀；`__init__.py(i)` 的模块名是它所在的目录。文件所在的包是模块名去掉最后一段，`__init__.py(i)` 所在的包是它自己。有 k 个点、而所在的包少于 k 段 → 没解析，原因 `相对导入越过了顶层包`（根目录下的 `mod.py` 里写 `from . import x` 也算）。起点目录是文件所在目录往上 k−1 级。`from .a.b import n`：在起点目录里找 `a`，之后同 `import a.b`（标准库和外部包那几条不用），再照 `from X import n`；`from . import n` 的 `X` 就是起点目录（有 `__init__.py` 时是正规包、文件是它；没有而有 `__init__.pyi` 时是正规包、文件是 `__init__.pyi`；都没有时当只有这一个目录的命名空间包）。原因里的点号全名照源码写、带前面的点（`.a.b 是模块，不是包`）。
  - **没解析的说明符：** `import` 记整个名字（`a.b.c`）；`from` 记模块部分，带前面的点（`..pkg`、`.`）。同一个 `(文件, 说明符)` 既有边又有没解析时两样都记（C/C++ 的“有边就不记没解析”只用于跨编译单元的合并，§11.5）。
- **边的意思（决定 78-2）：** 边指向被导入模块的文件，不指向定义那个名字的文件。
- **限时：** 每个文件 20 秒、整门语言 120 秒（§11.5 的执行器）。
- **分析器不可用：** 观测不再需要 `.local/source-analyzers` 的分析器包。解释器找不到或不能执行、或脚本报 `unavailable`（Python 低于 3.11）→ 这门语言 `failed`，原因 `分析器不可用`。

### 11.4 C/C++

- **编译数据库（决定 78-3）：**〔8D 返工；被忽略的那部分〔§10 段〕〕位置规则照 L13，在“被忽略的 + 不被忽略的”所有数据库里一起选：根目录的优先，否则用唯一的一个；有多个、其中一份是 `B/compile_commands.json`、其余全是 `B/<子目录>/compile_commands.json`（`B` 不是工作区根）→ 只选 `B/compile_commands.json`，不合并（`colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON` 默认就写这一份，内容是各包那几份按路径拼起来的：colcon-cmake 0.2.30 的 `compile_commands` 事件处理器，默认开；实测 ros2/demos 只用它和合并 15 份结果相同）；有多个、而且全都在同一个目录 `B` 下各占一个子目录（`B/<子目录>/compile_commands.json`，`B` 不是工作区根，每个子目录一份）→ 全部选中、合并（用户 2026-10-17 定：catkin_tools、关掉汇总的 colcon 和逐包跑 cmake 的 ROS 工作区是 `build/<包>/compile_commands.json`，用户自己的 ROS 2 工作区就是这种结构）；别的多个（如工作区根下并排的 `build-debug/`、`build-release/`，同一份源码的两套配置）→ 这门语言 `failed`，原因 `有多个编译数据库`。选中的里有一份读不了，照 §11.5 失败（几份都读不了时原因取按路径排第一份读不了的），不换别的、不少合一份。一个都没有时 `没有 compile_commands.json`；认领清单或材料里有 `package.xml`（任何一层）时原因写 `没有 compile_commands.json；可以用 colcon build --cmake-args -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成`，否则有 `CMakeLists.txt`（任何一层）时写 `没有 compile_commands.json；可以用 cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON 生成`（ros2/demos 和 SLAM 的根上都没有 `CMakeLists.txt`）。观测自己不跑任何构建工具；agent 要生成，用平常的命令工具。
  - **合并：** 选中的几份按路径排、照顺序拼成一个条目列表，之后的“条目和路径”“编号”都在拼起来的列表上做；每个条目的相对 `directory` 仍相对于它自己那份数据库所在的目录；`notes` 记 `合并了 <n> 个编译数据库`（只选中一份时不记）。条目出错的 `第 <n> 条` 是拼起来以后的序号。实测（合并以后）：ros2/demos 15 份、78 个编译单元，0 个失败，90 条边和 GCC 真编译逐条相同；SLAM 4 份，86 条边。真跑 colcon 时还有第 16 份 `build/compile_commands.json`，照上面只用它，结果相同。
- **被忽略的编译数据库只当配置冻结（改 §10 第 1 条“被忽略的文件不进材料”）：**〔§10 段〕在 git 工作树里另跑一次 `git ls-files --others --ignored --exclude-standard -z -- ':(glob)**/compile_commands.json'`，不加 `--directory`（git 2.43.0 实测：这样能列出被 `/build/` 忽略的 `build/compile_commands.json`；加了只返回 `build/`），路径里有 §10 第 1 条跳过名单目录的不算；不在 git 里时 `build/` 本来就在清单里，不用另找。找到的只当配置冻结：读之前照样查 Host 授权；读进内容和摘要，或者记下跳过原因。名为 `compile_commands.json` 的文件不论被不被忽略，读上限都是 32 MiB（实测：CMake 3.30.5 的 1,064 个编译单元 1.27 MB，ROS 2 工作区每个编译单元约 3.7 KB），单独定，算进整次的 128 MiB；不被忽略的那份照旧也是文件层的节点、数行数。被忽略的那份不进文件层，不算任何语言的文件，不进 `other` 的 `issues`。观测的摘要加上这一部分（路径和摘要，或路径和跳过原因）；所有核对（`capture.ts:221`、`:623`）重找、重读一次，变了就 `source_stale`。
- **数据库的条目和路径：**〔8D 返工〕
  - **整个文件和条目：** 解析不了 → 这门语言 `failed`，原因 `配置错误：compile_commands.json 解析不了`；不是数组 → `配置错误：compile_commands.json 不是数组`（空数组不算错，没有编译单元）；第 n 条（从 1 起）不对 → `配置错误：compile_commands.json 的第 <n> 条<问题>`，问题是 `不是对象`、`没有 file`、`没有 directory`、`的 file 不是字符串`、`的 directory 不是字符串`、`的 arguments 不是字符串列表`、`没有 arguments 也没有 command` 之一，取第一条不对的。
  - **参数：** 有 `arguments` 用它；没有时把 `command` 按 POSIX shell 的规则拆开（同今天 `cpp-source-query.py:169` 的 `shlex.split`），拆不开 → 这个编译单元失败，原因 `编译命令拆不开`。
  - **路径：** `directory` 是相对路径时相对于数据库所在的目录；`file`、查找目录、`-include` 和 `-imacros` 的文件是相对路径时相对于 `directory`；都规范化（去掉 `.`、`..`，不碰磁盘、不跟符号链接）。规范化以后落在工作区根的 Host 绝对路径下、或它的 realpath 下的，去掉这个前缀，就是工作区里的路径；别的都在工作区外。这两个写法由执行器放进头一行（§11.5）。`directory` 在工作区外不算错（两个实测数据库的 `directory` 全在工作区外）。
  - **主文件不在观测的文件里**（在工作区外，或在工作区里但被 git 忽略、不在材料里）的编译单元不解析、不算没做完，`notes` 记 `<n> 个编译单元的主文件不在观测的文件里`（n 数去重以后的条目；CMake 有 11 个，都是构建目录里生成的测试驱动）。
  - **编号：**（主文件、过滤后的参数）相同的条目只留第一条（CMake 3.30.5 有 9 个源文件重复）；去掉主文件不在观测文件里的；剩下的按数据库里的顺序编号，从 0 起、连续，就是 `ready` 里的 `units`。编译单元的个数不设上限（8D 的树里 `cpp-source-query.py:121` 的 512 个不带过来）。
  - **默认目标：** 参数里没有 `-target`、`--target`、`--target=…` 时加 `-target x86_64-pc-linux-gnu`，结果不随运行的 Host 变（决定 78-2“换一台机器结果一样”）；写进工具说明。
- **新操作 `import_graph`：**〔8D 返工〕放在 `scripts/cpp-source-query.py` 里，按命令行参数分路，和别的操作分开（8D 加在别的操作上的容错全部拿掉）；经 §11.5 的执行器运行，一个单元是一个编译单元。每个编译单元：
  - 用 libclang 解析，选项 `DetailedPreprocessingRecord | Incomplete | SkipFunctionBodies | KeepGoing`，参数加 `-w -ferror-limit=0 -fno-modules -fno-implicit-modules -fsyntax-only`；保留今天的虚拟文件系统和 `-nostdinc -nostdinc++`（不读本机的系统头文件，决定 78-2）。虚拟文件系统里放这门语言认领的文件（L12 的扩展名，大小写不敏感），也放只能被包含、不认领的文本文件（今天就放的 `.def` 和不带扩展名的，`cpp-source-index.ts:8`）。`KeepGoing` 不能去：没有它，第一条找不到的 `#include` 是致命错误，后面的诊断都不报。`SkipFunctionBodies` 下函数体里的 `#include` 照样记下、照样进入那个文件，函数体里的预处理错误照样报；函数体里的语法和语义错误不报，它们不影响边。
  - 只访问最外层的 `InclusionDirective`（含头文件里的），不改用 `clang_findIncludesInFile`（它会漏掉同一文件第二次进入才生效的指令）；每个文件的行首偏移只算一次。尖括号还是引号从冻结的源码里重读这条指令得出（libclang 不给）。
  - **说明符：** 照源码写，带定界符：`<vector>`、`"x.h"`；`#include` 后面是宏的（不论有没有定义）写 `#include` 后面的文字（`HDR`、`MACRO`）。
  - **`#include` 后面跟宏：** 宏有定义时 libclang 照常展开、对到文件，照普通的 `#include` 记（CMake 的 kwsys 有 56 处）；宏没定义时 clang 不给指令游标、只报 `expected "FILENAME" or <FILENAME>`，在这条诊断的位置记一条没解析的引用，原因 `include 后面跟宏`。
  - **对到文件：** 找到的头文件在冻结材料里 → 一条边；找不到 → 一条没解析的引用（原因 null），不让文件失败。clang 找不到时的两种退路不算找到（GCC 没有这两种退路）：尖括号的 `<x>` 在包含它的文件旁边按引号规则找到（诊断 `'x' file not found with <angled> include; use "quotes" instead`）→ 没解析，原因 `尖括号引用只能按引号规则找到`；拼写纠正后找到（诊断带 `did you mean`）→ 没解析，原因 `拼写纠正后才找到`。尖括号退路找到的是写这条指令的文件自己时，原因记 null：这其实是系统头文件没读到（libuv 的 `include/uv/errno.h:25` 写 `#include <errno.h>`，441 个编译单元里 429 个这样，真编译指向 `/usr/include/errno.h`；CMake 的 26 处里有 14 处）。这两种都不连边；一个文件在某个编译单元里的每一次进入，包含链（`clang_getInclusions` 给的栈）上都有一条这两种退路的指令时，这个编译单元不算读到它，也不记它里面的指令：经退路进入的文件，和经它再包含进来的文件，都是这样。实测：CMake 上尖括号退路有 3,859 条诊断、26 处指令，照连边的话 26 条全是错边（14 条指向文件自己）。
  - **文件什么时候算失败：** 落在这个文件里（诊断的文件位置）、严重度是 Error 或 Fatal、类别是 `Lexical or Preprocessor Issue`（`clang_getDiagnosticCategoryText`）的诊断，去掉四种对引用的诊断（`file not found`，含上面两种退路的；`expected "FILENAME" or <FILENAME>`），有一条就让这个文件 `failed`，原因 `预处理出错：<消息的前 200 个字符>`；这个文件在这个编译单元里的边和没解析的引用丢掉。`#error`（类别 `User-Defined Issue`）、语法错误、语义错误都不让文件失败。不看同一个编译单元里之前有没有找不到的 `#include`。
    - 为什么：这一类正是会改变走哪一支、读哪些 `#include` 的错误（没收尾的条件指令、没收尾的注释、条件里用了没定义的函数式宏）；语法和语义错误不改变预处理，不影响边。实测（CMake 3.30.5 的 1,064 个、用户 ROS 2 工作区的 23 个编译单元，另一个 Claude 子 agent 用自己写的扫描器复核）：真实代码上 0 个文件失败；注入的 33 个预处理错误都失败；60 个括号和函数体里的错误都不失败，CMake 的 100 次注入运行边一条不变。对照：草稿 1 的规则（之前没有找不到的 `#include`）实测等于从不失败（每个编译单元前几条 `#include` 里就有一条找不到的），30 个注入的错误抓到 0–1 个；只要有错误就失败，CMake 上 74% 的文件误判；算上 `#error`，CMake 多出 12 个误判。
    - 已知：条件里用了系统头文件里的函数式宏（如 `#if __GLIBC_PREREQ(2,17)`）时，没有系统头文件就会报错、这个文件失败；真编译不报，但扫描走的那一支确实错了，所以原因写“预处理出错”，不说源码有错。两个项目的生效分支里都没有这种写法。头文件和系统头文件同名、自己写 `#include <同名>`、又没有 include guard 或 `#pragma once` 时，尖括号退路反复找到它自己，报 `#include nested too deeply`，这个文件 `failed`；真编译不会。四个实测项目里没有这种写法（libuv 的 `uv/errno.h` 有 guard）。
  - **编译单元整个做不出来：** 主文件 `failed`，这个单元的 `done` 里 `files` 只有主文件。原因：编译器不认识 `不认识的编译器：<编译器的文件名>`；命令拆不开 `编译命令拆不开`；参数不认识 `不认识的编译参数：<参数>`；libclang 不给结果 `libclang 解析不了（code <n>）`；超时 `超时`；崩溃 `分析进程崩溃`（后两种见 §11.5 的执行器）。
  - **条件编译：** 只记生效的那一支。系统头文件、工作区外的头文件和被 git 忽略的构建产物（configure 生成的头文件、colcon 的 `install/`）都不在材料里；由它们的宏决定的分支和 `__has_include` 可能和真编译不同，没有诊断，失败规则也抓不到。写进已知限制和工具说明。实测：CMake 默认布局（构建目录在源码树外、不在材料里）的 12,961 处指令里，503 处的边和真编译不同，读到的 1,969 个文件里 86 个的边不同，几乎全来自 configure 生成的头文件（`cmConfigure.h`、`curl_config.h` 等）；构建目录看得见时，由系统头文件的宏决定的分支只有 1 处；用户的 ROS 2 工作区 266 处指令里只有 1 对 `__has_include` 不同，项目内的 86 条边不变，换成真实的 colcon 布局（跨包的查找目录在被 git 忽略的 `install/`）会丢 9 条。
- **头文件和不在数据库里的源文件的结果：** 这些文件不单独解析。有一个编译单元读到它、并且照上面的规则它不算失败，它就 `parsed`；读到它的编译单元都让它失败时 `failed`，原因取主文件按路径排第一个（同一个主文件取编号小的）编译单元的；没有被任何编译单元读到时 `skipped`：编译单元都做完了，源文件（L12 里的 `.c`、`.cc`、`.cpp`、`.cxx`，大小写不敏感）原因 `源文件不在编译数据库里`，别的原因 `没有编译单元包含它`（libuv 的 105 个 `skipped` 里 71 个是只在别的平台编译的、34 个是没进根数据库的子项目 `docs/code`，分开写读的人才看得出是平台或子项目没进图）；有编译单元没做完（这个单元没有给出 `done`：超时、崩溃、重启后的进程在新单元前退出、整门语言到时；或者给出的 `done` 里只有主文件：上面“整个做不出来”的那几种），原因 `有编译单元没有做完`。只经尖括号退路或拼写纠正进入的不算读到；主文件不在观测文件里而没解析的编译单元不算没做完。主文件也照这条合并（同一个主文件在两个参数不同的编译单元里，有一个让它 `parsed` 它就 `parsed`）。同一条 `#include` 在几个编译单元里读到，去重后一条边；不同编译单元解析到不同文件时各成一条边；一对 `(文件, 说明符)` 在任何编译单元里有边，就不记它的没解析。
- **编译参数（照实测原型 `light_include_scan.py:70–151` 的表搬进脚本，按本条改动的几处改：`-idirafter` 从忽略表挪到照用，`-fopenmp`、`-mmmx`、`-msse…`、`-fno-math-errno` 由第 2 步先接住；表写进代码注释，测试照表抽例）：**
  - **编译器：** 参数的第一个，取文件名，认 `cc`、`c++`、`gcc`、`g++`、`clang`、`clang++`（可带 `-<版本>`）；别的（含 `ccache`、`sccache`、`distcc`、`icecc` 这类包装和交叉编译器）→ 这个编译单元失败，原因 `不认识的编译器：<文件名>`。
  - **其余参数从前往后逐个判，先对上的算：**
    1. 带 shell 语法（换行、`` ` ``、`$(`、`;`、`&&`、`||`）或是响应文件 `@…` → 失败。
    2. **照用**（原型的 A 表，加 lead 定的几个）：`-I`、`-isystem`、`-iquote`、`-idirafter`、`-include`、`-imacros`、`-D`、`-U`（带 1 个值；`-I`、`-D`、`-U` 可连写）；`-x`、`-target`、`--target`（带 1 个值，值只能有字母、数字和 `_+.-`，`-x` 只收 `c`、`c++`；不合 → 失败）；`-std=<c|gnu|c++|gnu++ 加版本>`（原型的正则 `-std=(c|gnu)(\+\+)?[0-9a-z]+`）、`--target=…`、`-O0`/`-O1`/`-O2`/`-O3`/`-Os`/`-Oz`/`-Og`、`-g`、`-g0`–`-g3`、`-gdwarf-2`–`-gdwarf-5`、`-W<名字>`（`-W(no-)?[A-Za-z0-9=-]+`，不含逗号）；`-pthread`、`-m32`、`-m64`、`-fshort-wchar`、`-fexceptions`、`-fno-exceptions`、`-frtti`、`-fno-rtti`、`-fms-extensions`、`-fms-compatibility`、`-fPIC`、`-fpic`、`-fPIE`、`-fpie`、`-fno-builtin`、`-funsigned-char`、`-fsigned-char`、`-nostdinc`、`-nostdinc++`；lead 加的 `-fopenmp`、`-mmmx`、`-msse`、`-msse2`、`-msse3`、`-mssse3`、`-fno-math-errno`（会改预定义宏；用户的 ROS 2 工作区用到，照用以后指令一条没变）。`-o`、`-MF`、`-MT`、`-MQ`（带 1 个值）和 `-c`、`-MD`、`-MMD`、`-MP`、`-pipe` 忽略、不记。
    3. 不以 `-` 开头的：规范化后就是主文件 → 跳过；别的 → 失败，原因 `不认识的编译参数：多出的位置参数`。
    4. **拒绝表**（原型的 C 表：会加载代码、读配置或响应文件、改虚拟文件系统）→ 失败：`-Xclang`、`-Xpreprocessor`、`-Wp,…`、`-fplugin…`、`-fpass-plugin…`、`-load`、`-ivfsoverlay`、`--config`、`--config=…`、`-specs…`、`-include-pch`、`-fmodule-file…`、`-fmodule-map-file…`、`-fprebuilt-module-path…`、`-Xarch_host`、`-Xopenmp-target`、`-fprofile-use…`、`-fprofile-instr-use…`、`-fsanitize-blacklist…`、`-fsanitize-ignorelist…`。
    5. **忽略表**（原型的 B 表；整词先比，再取最长的前缀，所以 `-gcc-toolchain` 不会被 `-g` 接走、`-load` 先被拒绝表接住）→ 忽略。表里每项标了去掉它会改什么：`none`（只管输出、生成代码、链接、诊断、调试信息：`-pedantic`、`-shared`、`-static`、`-L`（可连写）、`-l…`、`-Wl,…`、`-Wa,…`、`-mtune=…`、约 120 个只管生成代码的 `-f…` 等）不记；`macros`（其余 `-O…` 如 `-Ofast`、`-ansi`、`-march=…`、`-mcpu=…`、其余 `-m…`、`-arch`、`-ffast-math`、`-fsanitize…`、`-fcoroutines`、`-fchar8_t` 等）、`language`（`-fpermissive`、`-fno-operator-names` 等）、`include-paths`（`-stdlib=…`、`--sysroot`、`--sysroot=…`、`-isysroot`、`-iprefix`、`-F` 等）三类写进 `notes`。
    6. 别的一律失败，原因 `不认识的编译参数：<参数>`。
  - **失败原因里的参数：** 写第一个失败的参数；`=` 后面的不写（可能是路径，如 `-fplugin=/x.so` 写 `-fplugin`）；响应文件只写 `@`；`-x`、`-target`、`--target` 的值不合时写参数和值（`-x objective-c`）。
  - **`notes` 的 `忽略的编译参数：…`：** 只看编号了的编译单元（`ready` 的 `units`）的参数；列第 5 步里 `macros`、`language`、`include-paths` 三类；写参数本身，带 `=` 的照写（`-march=native`），`include-paths` 一类只写表里的拼写（`-F`、`--sysroot`、`-isysroot`…），不写连写或 `=` 后面的值（值是路径）；后面单独跟的值不写；去重、按字符串排、用“、”连。
  - 实测：按这张表，两个数据库里不认识的参数都是 0 个；按今天的过滤，CMake 整次被拒（超过 512 个编译单元），ROS 2 工作区 23 个编译单元全都失败（`-march=native`、`-fopenmp`、`-msse3`，和工作区外的 `directory`）。两个项目都没用到 `-pedantic`、`-ffast-math` 这类，所以表照原型整体搬，不按两个项目删减。
- **工作区外的查找目录和读不到的强制包含文件：** 查找目录（`-I`、`-isystem`、`-iquote`、`-idirafter`）在工作区外 → 忽略这个目录，经它才找得到的头文件读作没解析，编译单元照常解析；`notes` 记 `忽略了 <n> 个工作区外的查找目录`（n 是整门语言编号了的编译单元（`ready` 的 `units`）里去重以后的目录个数，不数去掉的重复条目和主文件不在观测文件里的条目；不写路径。ros2/demos 数全部条目是 76、只数编号的 78 个是 55，取后者）。`-include`、`-imacros` 的文件不在观测的文件里（在工作区外，或被 git 忽略的构建产物，如 CMake 的 `cmake_pch.hxx`）→ 忽略这个参数，`notes` 记 `忽略了 <n> 个读不到的强制包含文件`（同样只数编号了的编译单元、去重）。实测：CMake 每个编译单元都有 `-I <构建目录>`（共 2,444 处），忽略时都能解析，让编译单元失败时 1,064 个全部失败；ROS 2 工作区有 65 个工作区外的目录，忽略以后项目内的边一条没丢。
- **限时：** 每个编译单元 20 秒，整门语言 300 秒（§11.5 的执行器）。实测（单进程）：CMake 每个编译单元 p50 26 毫秒、最长 157 毫秒，1,053 个合计墙钟 45.7 秒，进程内存 72 MB 涨到 118 MB；ROS 2 工作区 23 个合计 0.42 秒；超时、崩溃、libclang 不给结果都是 0 次。按这个速度 300 秒约能做 6,900 个编译单元；更大的项目到时，没做完的主文件 `failed`、原因 `超时`，记为已知限制（多进程以后做）。对照：读系统头文件时 ROS 2 工作区每个编译单元 1.5 秒以上，2,000 个约 97 分钟，这也是不读系统头文件（决定 78-2）的理由。引用计数只数去重以后的边。

### 11.5 三种语言共同的〔8D 返工，另注明的除外〕

- **覆盖的约定（改 §2）：**
  ```ts
  export type LanguageCoverageV1 = { language: string; files: number; parsed: number;
    edges: 'supported' | 'unsupported' | 'failed';
    reason: string | null;   // edges 不是 supported 时是整门语言的原因（下面的字面量）；supported 时是 null
    notes: string[];         // 近似说明，不是错误；最多 10 条，每条最多 200 个字符，去重后按字符串排；旧记录读作 []
    issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[]; issueCount: number; complete: boolean };
  // complete = edges 是 supported、parsed 等于 files、issueCount 是 0；reason、notes 不进公式。
  // 提供者接口：
  //   extractImports(input: { source: 冻结访问器（照旧只管读到的文本：inventory、allowed、sourceIdentity、read）;
  //     skipped: { path: string; reason: string }[];                          // 捕获跳过的文件
  //     configOnly: ReadonlyMap<string, { content: string; digest: string }>; // 只当配置读的文件
  //     signal: AbortSignal })
  //   → { edges: { from: string; to: string }[];
  //       unresolved: { from: string; specifier: string; reason: string | null }[];
  //       coverage: { parsed: number; edges: 'supported' | 'unsupported' | 'failed'; reason: string | null; notes: string[];
  //         issues: { path: string; kind: 'skipped' | 'failed'; reason: string }[] } }
  //   files、complete 由捕获 owner 算（今天提供者给的这两个就没用上，capture.ts:305、:357）；
  //   analyzerSnapshot 删掉（观测不翻页）。8D 返工加 skipped，configOnly 是空的；§10 段把读到的被忽略的数据库放进 configOnly，读不了的（Host 不授权、超过 32 MiB、二进制）连同跳过原因放进 skipped（只供选配置，捕获不把它记进任何语言的 issues）。
  ```
  - 捕获照抄提供者给的 `edges`，不再按“`reason` 不是 null 就算失败”推（`capture.ts:327`）。没有提供者的语言照旧 `unsupported`、`引用关系未支持`；提供者抛出的异常照旧 `failed`。
  - 记录里 `languages` 的每一项多 `notes`：解码接受有和没有两种，没有的读作 `[]`，别的键照旧封闭；不升 `schemaVersion`（8A 加键时也没升）。三个文件页原样返回 `languages`，所以看得到 `notes`。正式比较不读 `reason`、`notes`、`complete`。整对象断言的旧测试加 `notes`：C/C++ 是 `supported` 的（S8D-PROV-02 第一例、A-06 情形 2）是 `['近似：不读系统头文件和观测以外的头文件']`，S8D-PROV-05 是 `['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件']`，别的是 `[]`（含 S8A-file-graph 的 `:160`、`:188`）。
- **整门语言的原因（`reason`）只用这些字面量：** `引用关系未支持`（没有提供者的语言，`unsupported`）；`没有 compile_commands.json`（有 `package.xml`、`CMakeLists.txt` 时用 §11.4 的 colcon、CMake 那两句）；`有多个编译数据库`；`<文件名> 读不了：<跳过原因>`（选中的配置被跳过）；`配置错误：…`（TS 是诊断的前 200 个字符；Python、C/C++ 是 §11.3、§11.4 列的字面量）；`根配置带 references，观测还不跟进`（TS，`unsupported`）；`原始引用超过 <上限> 条`；`分析器不可用`；`分析运行失败：输出读不了`；`分析运行失败：输出超过 64 MiB`；`分析运行失败：进程在第一个单元前退出（<退出码 n 或信号名>）`；`分析运行失败：没有给出单元清单就到时`。表里没有的异常写 `<异常类型>: <消息的前 200 个字符>`。
- **单个文件的原因（`issues[].reason`）：** 捕获自己跳过的照 8A 的英文；TS、Python 解析时抛出的 `<异常类型>: <消息的前 200 个字符>`；`不在 TS 分析的范围里`；C/C++ 和 Python 的单元：`超时`、`分析进程崩溃`、`分析运行失败：重启后的进程在新单元前退出（<退出码 n 或信号名>）`；C/C++ 的编译单元：`不认识的编译器：<文件名>`、`编译命令拆不开`、`不认识的编译参数：<参数>`、`libclang 解析不了（code <n>）`、`预处理出错：<消息的前 200 个字符>`；C/C++ 不单独解析的文件：`源文件不在编译数据库里`、`没有编译单元包含它`、`有编译单元没有做完`；认领了但扫描没给结果的 `扫描没有给出结果`。
- **原因和说明里只写文件名，不写路径**（授权收窄以后原因不过路径核对）：TS 的配置诊断写进原因之前，把 `/workspace/<路径>` 换成路径的最后一段；脚本的 stderr 不进原因（可能带 Host 路径）；`<退出码 n 或信号名>` 写成 `退出码 3`、`信号 SIGKILL` 这样。
- **`notes`（近似说明，不当错误，不影响 `complete`）只用这些：** C/C++ 的 `edges` 是 `supported`、而且读到的认领文件不是 0 个时都写 `近似：不读系统头文件和观测以外的头文件`（决定 78-2；一句话覆盖系统头文件、工作区外的目录、被 git 忽略或在跳过名单里的构建产物；第五稿以前写的“git 不忽略”在不在 git 里的工作区说错了，libuv 实测）；`合并了 <n> 个编译数据库`；`忽略的编译参数：<§11.4 的列法>`；`忽略了 <n> 个工作区外的查找目录`；`忽略了 <n> 个读不到的强制包含文件`；`<n> 个编译单元的主文件不在观测的文件里`；Python 的 `<配置文件名> 里观测不用的字段：<字段名，按字符串排、用“、”连>`、`<配置文件名> 里用不了的查找根：<根，按字符串排、用“、”连>`。TS 的已知差别不进 `notes`。查找根是配置里写的名字，可以写；超过 200 个字符的截到 200 个。整门语言 `failed` 或 `unsupported` 时 `notes` 是 `[]`。
- **没解析的引用带原因：** 每条 `{ from, specifier, reason }`，`reason` 是 null（找不到，或解析到冻结材料以外）或这些字面量：Python 的 `<点号全名> 是模块，不是包`、`标准库`、`命名空间目录和标准库重名`、`命名空间目录，可能是同名的外部包`、`命名空间包，没有文件`、`相对导入越过了顶层包`；C/C++ 的 `include 后面跟宏`（只在宏没定义时）、`尖括号引用只能按引号规则找到`、`拼写纠正后才找到`。说明符的写法见 §11.2、§11.3、§11.4。照旧按 `(from, specifier)` 去重；同一对原因不同时，留按字符串排在前面的非 null 原因。〔§10 段〕存在 §10 第 6 条的块里（块本来就是 `schemaVersion: 2`），v1 记录里的读作 `reason: null`；正式比较的 `unresolved` 发现：`reason` 是 null 时 `detail` 照旧是说明符，不是 null 时是 `<说明符>（<原因>）`。8D 返工里提供者就给出原因，捕获在 §10 段之前先不存。
- **自己到自己（三种语言都照这条；TS 那部分〔§10 段〕）：** 对到文件的边，起点和终点相同时，文件层不记边，也不记没解析（C/C++ 故意包含自己的 X 宏文件也是这样）；模块层照旧拿这条引用。尖括号退路找到写这条指令的文件自己时不是边，照 §11.4 记一条原因为 null 的没解析（A-22 (m)）。
- **没有读到的认领文件不起分析：** 一门语言在材料里有文件、但全被捕获跳过（交给扫描的认领清单是空的；被跳过的不算，同“选配置看存在”）时，不读配置、不找数据库、不起进程：`edges: 'supported'`、`parsed: 0`、`reason: null`、`notes: []`、`issues` 只有捕获自己跳过的（`files` 照旧由捕获 owner 按扩展名算，含被跳过的），同今天 TS 的提供者（`architecture-language-provider.ts:94–96`）。材料里没有这门语言的文件时，`languages` 里没有这一项（今天 `capture.ts:270–273`、`:302` 只给认出文件的语言建覆盖，同 A-06 的纯非 TS 项目），也不起分析。所以 `.py` 全被跳过、根上的 `pyproject.toml` 又是坏的时候，Python 不算失败。旧测试有断言这种语言失败的，期望跟着改，施工时报出。
- **取消和容量不算出错：** 逐文件、逐编译单元的捕错不接住取消和容量：取消让整次请求 `cancelled`，边超过 100,000 让整次 `capacity`（同今天 `capture.ts:332`、`:344`）。
- **选配置看存在（8D 审查第 1 条，三种语言都照这条）：** 捕获交给提供者的冻结材料，除了读到的文件，还带被跳过的文件（路径和原因）和只当配置读的文件（形状见上面的提供者接口）；这两种都不算认领的文件，不放进清单的路径里（否则一个被跳过的 `.py` 会让整个 Python 失败）。选配置时在“读到的 + 被跳过的 + 只当配置的”里按优先级选；选中的被跳过 → 这门语言 `failed`，原因 `<文件名> 读不了：<跳过原因>`；不换下一个，不退到没有配置，用同一份材料、不重读。符号链接不进材料，按“没有”算（§10 第 1 条）。
- **认领的每个文件都有结果：** 这门语言 `edges` 是 `supported` 时，认领的文件（按扩展名，大小写不敏感，L12 的列表）每个都有 `parsed`、`failed` 或 `skipped` 之一；提供者把认领清单原样（原来的大小写）交给扫描，没有结果的补 `skipped`、`扫描没有给出结果`（8D 审查第 5 条）。整门语言 `failed` 或 `unsupported` 时不补：`parsed` 是 0，`issues` 只有捕获自己跳过的（TS 另照 §11.2 记显式配置那一条），`notes` 是 `[]`，没有边，也没有没解析的引用。
- **NDJSON 执行器（C/C++、Python 共用一个 TS 侧的执行器，不各写一份）：**
  - **起进程：** `<解释器> -I -S <脚本> import_graph`，环境只留 `PATH=/usr/bin:/bin`、`LANG=C.UTF-8`，不经 shell；用新的进程组起，杀的时候杀整个组。
  - **标准输入：** 每行一个 JSON，`write` 返回 false 时等 `drain`。第 1 行 `{"t":"header","v":1,"paths":[…],"config":{…},"resumeFrom":0}`：`paths` 是认领清单（原样大小写、按路径排）；C/C++ 的 `config` 是 `{ libraryPath, databases: [{ path, content }, …], workspaceRoot, workspaceRealRoot }`（`databases` 是选中的数据库，按路径排，只有一份时也是列表；后两个是工作区根的 Host 绝对路径和它的 realpath，捕获 owner 从解析工作区根的地方取），Python 的是选中配置的 `{ path, content }`（没有时 `null`）。之后每个文件一行 `{"t":"file","path":…,"content":…}`（顺序同 `paths`；C/C++ 另加只能被包含的文本文件），写完关闭。
  - **标准输出：** 每行一个 JSON。
    - 先是 `{"t":"ready","engine":…,"engineVersion":…,"units":[<主文件>,…],"notes":[…]}`。`units` 是这次的全部单元，序号就是它在 `units` 里的位置：Python 就是 `paths`；C/C++ 照 §11.4 的编号。`notes` 是脚本从配置或数据库算出的 §11.5 字面量（Python 配置的两种；C/C++ 合并的数据库个数（两份以上时）、忽略的参数、工作区外的目录数、读不到的强制包含文件数、主文件不在观测文件里的编译单元数），不含近似那一句（那一句由执行器在 `supported` 时加）。重启后的进程给出同样的 `ready`，执行器用第一次的，不同就是 `输出读不了`。
    - 或者 `{"t":"unavailable","message":…}` → `分析器不可用`；或者 `{"t":"failed","reason":…}` → 这门语言 `failed`，原因就是 `reason`（§11.3、§11.4 的配置错误字面量）。
    - 每个单元先 `{"t":"start","i":<序号>,"path":<主文件>}`，做完 `{"t":"done","i":…,"files":[{"path":…,"status":"parsed"|"failed","reason":…}],"edges":[[from,to,specifier],…],"unresolved":[{"from","specifier","reason"}]}`。`files` 是这个单元读到的文件和它们在这个单元里的结果（`failed` 的带原因；只经尖括号退路或拼写纠正进入的不列）；编译单元整个做不出来时只有主文件。`files` 只列头一行 `paths` 里的认领文件；只能被包含、不认领的文件可以做边的终点，不进 `files`，不进覆盖。
    - 最后 `{"t":"end"}`，退出码 0。
  - **合并（执行器做，重启以后脚本记不得之前的）：** 文件结果照 §11.4“头文件和不在数据库里的源文件的结果”合并（Python 一个文件只出现在自己的单元里）；边按 `(from, to)` 去重；C/C++ 的一对 `(from, specifier)` 在任何单元里有边，就不记它的没解析；没解析照上面去重、取原因；最后照“认领的每个文件都有结果”补齐。
  - **限时：** 每个单元从 `start` 起 `unitTimeoutMs`（默认 20,000）；整门语言 `languageTimeoutMs`（默认 C/C++ 300,000、Python 120,000；注入时两门语言都用注入的值），从第一次起进程算起。两个都经 `sourceAnalyzers` 注入（测试用）。
  - **超时、崩溃和退出：**
    - 单元超时 → 杀进程组，主文件 `failed`、原因 `超时`；进程在 `start` 和 `done` 之间退出 → 主文件 `failed`、原因 `分析进程崩溃`。这两种都重启：发同样的头和文件，`resumeFrom` 是下一个单元的序号；没有剩下的单元就不重启，直接收尾。
    - 进程在两个单元之间（`ready` 或 `done` 之后、下一个 `start` 之前，含还没给 `ready`）没给 `end` 就退出：这次启动给过 `start` 的 → 照上面从下一个没做的单元重启，不记谁失败；没给过 `start` 的，第一次启动 → 这门语言 `failed`，原因 `分析运行失败：进程在第一个单元前退出（…）`；重启后的 → 不再重启，没做完的单元的主文件 `failed`，原因 `分析运行失败：重启后的进程在新单元前退出（…）`。没有剩下的单元时同样直接收尾。
    - 不另设重启次数，整门语言的限时管住总时间。整门语言到时 → 杀进程组，没做完的单元（含正在做的）的主文件 `failed`，原因 `超时`。第一次启动还没给出 `ready`（C/C++ 还不知道单元清单）就到了整门语言的限时 → 杀进程组，这门语言 `failed`，原因 `分析运行失败：没有给出单元清单就到时`，照“认领的每个文件都有结果”的失败那一半。
  - **分清错误（8D 审查第 6 条）：** `分析器不可用`：解释器找不到或不能执行（`ENOENT`、`EACCES`），或脚本给出 `unavailable`（libclang 打不开、不是 18 版、Python 低于 3.11）。`分析运行失败：输出读不了`：一行不是 JSON、`t` 不认识、序号对不上、重启后的 `ready` 和第一次不同、一行超过 16 MiB。`分析运行失败：输出超过 64 MiB`。这几种和 `进程在第一个单元前退出` 都让这门语言 `failed`、不重启，已经收到的边、没解析和逐文件结果都丢掉（照“认领的每个文件都有结果”的失败那一半）。进程退出时先把标准输出读完再判，读不了的优先。单元的超时和崩溃只让那个单元的主文件失败。
  - **输出上限：** 一门语言的输出按到达的字节累计最多 64 MiB，超过就杀进程组；单行最多 16 MiB（第一个编译单元的 `done` 带它读到的全部头文件，大项目可能过 1 MiB）。stderr 读了就丢，不进原因。
  - **去重：** 脚本在一个进程里按 `(from, to, specifier)` 去重边、按 `(from, specifier, reason)` 去重没解析，只发没发过的；执行器再照“合并”去重。
  - **取消：** 杀进程组，照旧报 `cancelled`，不记成失败。
  - **大小：** 单个文件仍是 L12 的 2 MiB（捕获时就把超过的记成 `skipped`）；Python 不再有 64 MiB 的总上限，整个观测仍受捕获的 128 MiB 限制。

### 11.6 测试（改 A-06、A-11、AE6，新增 A-17–A-24 和回归行；经公开入口，内存和 SQLite 各跑一遍，另说明的除外；期望值是手算的字面量；每一例单独一个工作区）

- **A-06 改**〔8D 返工〕：情形 3 改成经 `sourceAnalyzers.pythonPath` 给一个不存在的解释器，`python { files: 4, parsed: 0, edges: 'failed', reason: '分析器不可用', notes: [], issues: [], issueCount: 0, complete: false }`；C/C++ 同情形 1（没有编译数据库，在起进程之前就失败，不受这个共用的 `pythonPath` 影响，返工时这个先后要保住）。情形 1、2 里 `f.py` 的原因是 `SyntaxError: invalid syntax`；每条覆盖加 `notes`（TS、Python 是 `[]`，情形 2 的 cpp 是 `['近似：不读系统头文件和观测以外的头文件']`）。去掉“翻过分析器的第二页、全程同一个 `expectedSnapshot`”，`many.py` 仍是一条边。情形 1 另跑一次，`sourceAnalyzers.directory` 给一个空目录 → 结果同情形 1（观测不用这个目录）。S8D-PROV-03 同样改。AE6 的“是什么”列：“跨分页”改成“跨 `listFiles` 分页”，“本机分析器（`.local/source-analyzers`）可装/不可装两种”改成“Python 解释器可用/不可用两种”；“能抓到”列：“Python 提供者（要 `.local/source-analyzers`）按冻结的 ProjectSourceAccess 材料、同一 expectedSnapshot 抽出的 import 边”改成“Python 提供者（只要系统 Python 3.11 以上）经 §11.5 的执行器从冻结材料抽出的 import 边，观测不翻分析器的页”。
- **A-11 改：** 只测文件以外的一层（文件里的一层由 A-18、A-21、A-22 测）。(1)〔§10 段〕TS：经 `lightScan.fault` 在 `{ phase: 'language' }` 时抛出 `TypeError('injected')` → `typescript { edges: 'failed', reason: 'TypeError: injected', parsed: 0, notes: [], complete: false }`，`issues` 只有捕获跳过的（没有显式配置），模块层空，文件层有全部文件和行数；另一次不抛出的观测里，`{ phase: 'language' }` 恰好调 1 次（一次观测只扫一次）。(2)〔8D 返工〕Python：工作区里只有 TS 和 Python 文件；经 `sourceAnalyzers.pythonPath` 给一个包装，打出一行 `garbage` 后挂住（不退出）→ `python { edges: 'failed', reason: '分析运行失败：输出读不了', parsed: 0, notes: [], issues: [], issueCount: 0, complete: false }`，没有 Python 的边；TS 照常。
- **A-17 TS 的引用形式**〔§10 段〕（期望值按 TS 6.0.3 的解析手算；施工时对不上要报，不改期望）：
  - `tsconfig.json` = `{"compilerOptions":{"module":"nodenext","allowJs":true,"typeRoots":["./types"]}}`；根 `package.json` = `{"name":"p","exports":{".":{"import":"./lib/p.d.mts","require":"./lib/p.d.cts"}}}`（包 `p` 用自引用，不靠 `node_modules`）。
  - `src/main.ts` = `/// <reference path="./ref.ts" />\n/// <reference path="./ref2" />\n/// <reference types="t" />\nimport type { T } from "./t";\nimport r = require("./r");\nimport type { P } from "p" with { "resolution-mode": "import" };\nexport const d = import("./d.js");\nexport type Q = import("./q").Q;\n`；`src/t.ts`、`src/r.ts`、`src/d.ts`、`src/ref.ts`、`src/ref2.ts`、`src/z.ts` 都是 `export {};\n`，`src/q.ts` 是 `export type Q = 1;\n`；`types/t/index.d.ts` = `declare const t: number;\n`；`lib/p.d.mts`、`lib/p.d.cts` = `export type P = 1;\n`；`src/c.js` = `const a = require("./a2");\n`、`src/a2.js` = `module.exports = 1;\n`；`src/req.ts` = `const z = require("./z");\n`；`esm/package.json` = `{"type":"module"}`、`esm/a.ts` = `export {};\n`、`esm/m.ts` = `import "./a";\n`、`esm/n.cts` = `import "./a";\n`。
  - 边恰好这 10 条：`(src/main.ts, src/ref.ts)`、`(src/main.ts, src/ref2.ts)`、`(src/main.ts, types/t/index.d.ts)`、`(src/main.ts, src/t.ts)`、`(src/main.ts, src/r.ts)`、`(src/main.ts, lib/p.d.mts)`（这个文件本身是 CommonJS，属性写 `import` 才看得出属性起了作用）、`(src/main.ts, src/d.ts)`、`(src/main.ts, src/q.ts)`、`(src/c.js, src/a2.js)`、`(esm/n.cts, esm/a.ts)`；没解析恰好 1 条：`(esm/m.ts, ./a)`；`src/req.ts` 没有边也没有没解析；`typescript` 的 `edges` 是 `supported`。
- **A-18 TS 的出错**〔§10 段〕：经 `lightScan.fault` 在 `{ phase: 'file', path: 'src/b.ts' }` 时抛出 `RangeError('injected')` → `src/b.ts` `failed`、原因 `RangeError: injected`，别的文件真解析、边照常；钩子在 `src/c.ts` 时先中止这次请求的 `AbortController` 再抛出 `Error('x')` → 整次 `cancelled`，不是一个文件 `failed`；300 个文件 `m0.ts`…`m299.ts`、每个 `import "./m<(i+1) mod 300>";` 的循环能抓，恰好 300 条边；`lightScan.maxRawReferences` 设成 5、两个文件各 3 条 → `failed`、`原始引用超过 5 条`。
- **A-19 TS 的配置**〔§10 段〕（每一例都至少有一个认领的 TS 文件，没另写的是 `a.ts` = `export {};\n`）：带 `references` 的根配置（有、没有自己的文件各一例）→ `unsupported`、原因字面量；`extends` 指向不存在的包 → `failed`、`配置错误：…`（不带 `/workspace/`），不换配置；根上的 `tsconfig.json` 带 NUL、另有 `jsconfig.json` → `failed`、`tsconfig.json 读不了：binary source`，没有边；`paths` 别名能解析；`baseUrl` 下非相对的名字能解析；不在 tsconfig 范围里的 TS 文件 `skipped`、`不在 TS 分析的范围里`；没有 tsconfig、`a.ts` = `import c = require("./c.json");\n`、`c.json` = `{}` → 一条边 `(a.ts, c.json)`（默认选项下 `resolveJsonModule` 的计算值为真）。失败的几例 `notes: []`，`issues` 只有捕获跳过的（没有显式配置）。
- **A-20 Python 的对法**〔8D 返工；原因的 `detail` 断言〔§10 段〕〕：`pyrightconfig.json` = `{"extraPaths": ["lib"]}`（查找根 `.`、`lib`）。文件：`app.py` = `import a.b.c\nimport a.b.c.d\nimport mod.x\nimport email\nimport ns\nimport ns.mod\nimport fast\nimport native\nimport plug\nimport shared.util\nfrom shared import util\nfrom pkg import sub, name\nfrom pkg import *\nimport os\nfrom tools import run\n`；`a/__init__.py`、`a/b/__init__.py`（空）、`a/b/c.py`；`mod.py`、`mod/x.py`；`email/utils.py`、`ns/mod.py`（两个目录都没有 `__init__.py`）；`nsuser.py` = `from ns import nothere\nfrom ns import mod\n`；`fast.py`、`fast.pyi`、`native.pyi`；`plug/x.py`（没有 `__init__.py`）、`lib/plug/__init__.py`；`shared/__init__.py`、`lib/shared/util.py`；`pkg/__init__.py` = `from . import sub\nfrom . import helper\nfrom .. import top\nhelper = 1\n`；`pkg/sub.py` = `from .inner import k\nfrom .deep.leaf import z\nfrom .json import y\n`、`pkg/inner.py`、`pkg/deep/__init__.py`（空）、`pkg/deep/leaf.py`、`pkg/json/data.py`（没有 `__init__.py`）；`tools/cfg.py`（没有 `__init__.py`）；`solo.py` = `from . import x\n`。
  - 边恰好这 12 条：`(app.py, a/b/c.py)`、`(app.py, fast.py)`、`(app.py, lib/plug/__init__.py)`、`(app.py, native.pyi)`、`(app.py, ns/mod.py)`、`(app.py, pkg/__init__.py)`、`(app.py, pkg/sub.py)`、`(app.py, shared/__init__.py)`、`(nsuser.py, ns/mod.py)`、`(pkg/__init__.py, pkg/sub.py)`、`(pkg/sub.py, pkg/deep/leaf.py)`、`(pkg/sub.py, pkg/inner.py)`。
  - 没解析恰好这 11 条：`app.py` 的 `a.b.c.d`（`a.b.c 是模块，不是包`）、`email`（`命名空间目录和标准库重名`）、`mod.x`（`mod 是模块，不是包`）、`ns`（`命名空间目录，可能是同名的外部包`）、`shared.util`（原因 null）、`os`（`标准库`）、`tools`（`命名空间目录，可能是同名的外部包`）；`nsuser.py` 的 `ns`（`命名空间目录，可能是同名的外部包`；同一个说明符另有一条边，两样都记）；`pkg/sub.py` 的 `.json`（`命名空间包，没有文件`：相对导入不用标准库和外部包那几条）；`pkg/__init__.py` 的 `..`、`solo.py` 的 `.`（都是 `相对导入越过了顶层包`）。
  - 覆盖 `python { files: 24, parsed: 24, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true }`。8D 返工断言边和说明符（经 `compare-formal` 的 `unresolved` 发现，`detail` 是说明符）；§10 段再断言 `detail`（有原因的是 `<说明符>（<原因>）`，原因 null 的只有说明符）。
- **A-21 Python 的出错和配置**〔8D 返工〕（`python_index` 的断言要装好 `.local/source-analyzers`，同现有的 `python_index` 测试）：文件 `a.py` = `import b\n`、`b.py`、`d.py` = `import c\n`、`lib/c.py`、`bad.py` = `def broken(:\n`。
  - `pyproject.toml` = `[tool.pyright]\npythonVersion = "3.11"\nextraPaths = ["lib"]\n` → 观测 `python { files: 5, parsed: 4, edges: 'supported', reason: null, notes: ['pyproject.toml 里观测不用的字段：pythonVersion'], issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }], issueCount: 1, complete: false }`，边 `[('a.py','b.py'), ('d.py','lib/c.py')]`；同一份配置给 `python_index` 的 `imports` → 工具 `success`，内层 `{ status: 'unsupported', message: 'pythonVersion is not supported by the isolated Jedi provider; select a configuration with workspace import roots' }`。
  - `extraPaths` 改成 `"lib"` → `python { files: 5, parsed: 0, edges: 'failed', reason: '配置错误：pyproject.toml 的 extraPaths 不是字符串列表', notes: [], issues: [], issueCount: 0, complete: false }`，没有 Python 的边。
  - `pyproject.toml` = `[tool.pyright]\nextraPaths = ["vendor"]\n`（去掉 `pythonVersion`；`vendor/` 下没有文件）→ `python { files: 5, parsed: 4, edges: 'supported', reason: null, notes: ['pyproject.toml 里用不了的查找根：vendor'], issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }], issueCount: 1, complete: false }`，边 `[('a.py','b.py')]`，`d.py` 的 `c` 没解析（原因 null）；`python_index` 回 `rejected`、`Python configuration: configuration import root unavailable in readable snapshot: vendor`。
  - 根上的 `pyrightconfig.json` 带 NUL → `python { parsed: 0, edges: 'failed', reason: 'pyrightconfig.json 读不了：binary source', notes: [], issues: [], issueCount: 0, complete: false }`，没有 Python 的边。
  - `pyrightconfig.json` = `{"extends": "base.json"}` → `failed`、`配置错误：pyrightconfig.json 的 extends 观测还不跟进`。
  - 根的顺序：文件 `x.py` = `import m\n`、`a/m.py`、`b/m.py`，`pyproject.toml` = `[tool.setuptools.packages.find]\nwhere = ["a"]\n[tool.pyright]\nextraPaths = ["b"]\n` → 边 `[('x.py','a/m.py')]`。
  - `pyrightconfig.json` = `{\n  // roots\n  "extraPaths": ["lib/",], /* x */\n}\n`（注释、多余的逗号、结尾带 `/` 的根）→ `python { files: 5, parsed: 4, edges: 'supported', reason: null, notes: [], issues: [{ path: 'bad.py', kind: 'failed', reason: 'SyntaxError: invalid syntax' }], issueCount: 1, complete: false }`，边 `[('a.py','b.py'), ('d.py','lib/c.py')]`。
  - 没有读到的认领文件：工作区只有 `a.ts` = `export {};\n`、`pyproject.toml` = `[tool\n`（解析不了）和带 NUL 的 `x.py` → `python { files: 1, parsed: 0, edges: 'supported', reason: null, notes: [], issues: [{ path: 'x.py', kind: 'skipped', reason: 'binary source' }], issueCount: 1, complete: false }`；`pythonPath` 给一个记启动次数的包装，启动 0 次。
- **A-22 C/C++ 的 include**〔8D 返工；没解析引用的原因断言〔§10 段〕〕（期望的消息是 libclang 18 的；数据库没另写的都是 `[{"directory":".","file":"main.cpp","arguments":["c++","-c","main.cpp"]}]`；改了主文件的例子，`arguments` 里的主文件跟着改成同一个路径：(e) 是 `["c++","-c","src/main.cpp"]`，(i) 是 `["c++","-c","a.cpp","-DA"]`、`["c++","-c","b.cpp"]`）：
  - (a) `main.cpp` = `#include <vector>\n#include "x.h"\n`、`x.h` → 两个都 `parsed`，边 `[('main.cpp','x.h')]`，没解析 `<vector>`（原因 null），`notes: ['近似：不读系统头文件和观测以外的头文件']`。
  - (b) `main.cpp` = `#include "h.h"\n`、`h.h` = `#include "y.h"\n#if 1\n`、`y.h` → `h.h` `failed`、`预处理出错：unterminated conditional directive`，它的边丢掉；边 `[('main.cpp','h.h')]`；`main.cpp`、`y.h` `parsed`。
  - (c) `main.cpp` = `#error stop\n#include "x.h"\n}\n`、`x.h` → 都 `parsed`，边 `[('main.cpp','x.h')]`。
  - (d) 参数加 `-DHDR="x.h"`，`main.cpp` = `#include HDR\n#include NOPE\n`、`x.h` → 边 `[('main.cpp','x.h')]`，没解析 `NOPE`（`include 后面跟宏`）。
  - (e) 数据库的主文件是 `src/main.cpp`，`src/main.cpp` = `#include <local.h>\n`、`src/local.h` = `#include "z.h"\n`、`src/z.h`，没有 `-I` → 没有边；没解析 `<local.h>`（`尖括号引用只能按引号规则找到`）；`src/local.h`、`src/z.h` `skipped`、`没有编译单元包含它`。
  - (f) `main.cpp` = `void f() {\n#include "f.h"\n}\n`、`f.h` = `int x = 1;\n` → 边 `[('main.cpp','f.h')]`。
  - (g) 参数加 `-I/outside`（工作区外），`main.cpp` = `#include "o.h"\n` → `main.cpp` `parsed`，没解析 `"o.h"`（原因 null），`notes: ['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件']`。
  - (h) `main.cpp` = `#if 0\n#include "x.h"\n#endif\n`、`x.h` → 没有边，`x.h` `skipped`、`没有编译单元包含它`。
  - (i) 两个编译单元：`a.cpp` 带 `-DA`、`b.cpp` 不带，都是 `#include "h.h"\n`；`h.h` = `#ifdef A\n#if FOO(1)\n#endif\n#endif\n#include "k.h"\n`、`k.h`；数据库里 `b.cpp` 那一条再重复一次（参数相同）→ `h.h`、`k.h` `parsed`（`a.cpp` 里 `h.h` 失败，`b.cpp` 里不失败）；边 `[('a.cpp','h.h'), ('b.cpp','h.h'), ('h.h','k.h')]`；经 `pythonPath` 包装（转发真解释器的输入输出）数 `start` 行，恰好 2 行。
  - (j) 数据库多一条主文件 `gen/x.cpp`（工作区里没有这个文件）→ `notes` 有 `1 个编译单元的主文件不在观测的文件里`，`main.cpp` 照常。
  - (k) S8D-CPP-01 的夹具（绝对路径）挪进来 → `src/broken.cpp` `failed`、`libclang 解析不了（code 1）`；`include/orphan.hpp` `skipped`、`有编译单元没有做完`；`src/main.cpp`、`include/used.hpp` `parsed`，边 `[('src/main.cpp','include/used.hpp')]`。
  - (l) S8D-CPP-02 的夹具（头文件里是语义错误 `undeclared_name`）挪进来，期望翻转：`include/bad.hpp` `parsed`，边 `src/main.cpp → include/bad.hpp` 照常（头文件的预处理错误由 (b) 测）。
  - (m) 尖括号退路找到自己：`main.cpp` = `#include "uv/errno.h"\n`、`uv/errno.h` = `#ifndef E_H\n#define E_H\n#include <errno.h>\n#endif\n` → 都 `parsed`，边 `[('main.cpp','uv/errno.h')]`，没解析 `<errno.h>`（原因 null，不是 `尖括号引用只能按引号规则找到`）。
  - (n) 不在数据库里的源文件：`main.cpp` = `#include "x.h"\n`、`x.h`、`orphan.cpp` = `int o;\n`、`orphan.h` = `int p;\n` → `orphan.cpp` `skipped`、`源文件不在编译数据库里`；`orphan.h` `skipped`、`没有编译单元包含它`；边 `[('main.cpp','x.h')]`。
  - 8D 返工断言边、文件状态、`notes` 和没解析引用的说明符（经 `compare-formal` 的 `unresolved` 发现，`detail` 是说明符）；§10 段再断言 `detail`：`<vector>`、`NOPE（include 后面跟宏）`、`<local.h>（尖括号引用只能按引号规则找到）`、`"o.h"`、(m) 的 `<errno.h>`。
- **A-23 C/C++ 的配置和参数**（每一例都至少有一个认领的 C/C++ 文件，没另写的是 `main.cpp` = `int m;\n`；没有的话 `languages` 里没有 `cpp`）：〔§10 段〕被 `.gitignore` 忽略的 `build/compile_commands.json` 被读到，它不是节点、也不在 `other` 的 `issues` 里；只改被忽略的数据库再抓一次 → 两次的 `sourceDigest` 不同。`.gitignore` = `build/\n`，`build/p1/compile_commands.json`、`build/p2/compile_commands.json` 照下面 8D 返工那一例的写法（`directory` 是 `../../p1`、`../../p2`）→ 合并，边和 `notes` 同那一例；再加一份 `build/compile_commands.json`（colcon 的汇总，内容是两份按路径拼起来的，`directory` 改成 `../p1`、`../p2`）→ 只用它，边同上，`notes` 只有近似那一句；没有汇总、`build/p2/compile_commands.json` 带 NUL → `failed`、`compile_commands.json 读不了：binary source`，没有 C/C++ 的边（不只合 `p1`）。〔8D 返工〕有 `CMakeLists.txt`、没有数据库 → CMake 那句字面量；`pkg/package.xml`、`pkg/CMakeLists.txt`、`pkg/a.cpp`，没有数据库 → colcon 那句字面量；两个数据库都不在根上（`a/compile_commands.json`、`b/compile_commands.json`；父目录是工作区根）→ `有多个编译数据库`；合并：`dbs/p1/compile_commands.json` = `[{"directory":"../../p1","file":"a.cpp","arguments":["c++","-c","a.cpp"]}]`、`dbs/p2/compile_commands.json` = `[{"directory":"../../p2","file":"b.cpp","arguments":["c++","-c","b.cpp"]}]`，`p1/a.cpp` = `#include "a.h"\n`、`p1/a.h`、`p2/b.cpp` = `#include "b.h"\n`、`p2/b.h` → `cpp { files: 4, parsed: 4, edges: 'supported', reason: null, notes: ['合并了 2 个编译数据库', '近似：不读系统头文件和观测以外的头文件'], issues: [], issueCount: 0, complete: true }`，边 `[('p1/a.cpp','p1/a.h'), ('p2/b.cpp','p2/b.h')]`；同样两份、第二份挪到 `other/p2/compile_commands.json`（父目录不同）→ `有多个编译数据库`；两份之外再加 `dbs/compile_commands.json` = `[{"directory":"../p1","file":"a.cpp","arguments":["c++","-c","a.cpp"]},{"directory":"../p2","file":"b.cpp","arguments":["c++","-c","b.cpp"]}]` → 只用它，边同合并那一例，`notes` 是 `['近似：不读系统头文件和观测以外的头文件']`；根上的数据库带 NUL、另有一个能读的 → `failed`、`compile_commands.json 读不了：binary source`，不换另一个；数据库是 `{}` → `配置错误：compile_commands.json 不是数组`；第 1 条没有 `file` → `配置错误：compile_commands.json 的第 1 条没有 file`；数据库里 `main.cpp` 那一条加 `-Xclang -load`，另有一条 `{"directory":".","file":"b.cpp","arguments":["c++","-c","b.cpp"]}`、`b.cpp` = `int b;\n` → `main.cpp` `failed`、`不认识的编译参数：-Xclang`，`b.cpp` `parsed`；只有 `-load x` → `不认识的编译参数：-load`；`-march=native` 和 `-o x.o -c` → 照常，`notes` 有 `忽略的编译参数：-march=native`（`-o`、`-c` 不列）；`-include /nonexistent/pch.hxx` → 照常，`notes` 有 `忽略了 1 个读不到的强制包含文件`；`directory` 是工作区外的绝对路径，`file` 和 `arguments` 里的主文件都写工作区里的绝对路径（`["c++","-c","<根>/main.cpp"]`）→ 照常；编译器是 `ccache` → `不认识的编译器：ccache`；`command` 是 `c++ -DX=1 -c main.cpp` → 照常；`command` 是 `c++ 'unclosed -c main.cpp` → `编译命令拆不开`；`arguments` 多一个 `other.cpp` → `不认识的编译参数：多出的位置参数`；`main.cpp` = `#if defined(__x86_64__) && defined(__linux__)\n#include "x.h"\n#endif\n`、不写 `-target` → 在任何 Host 上都有边 `('main.cpp','x.h')`。
- **A-24 执行器的超时、崩溃和退出**〔8D 返工〕：只跑内存后端（和存储无关）。工作区只有 C/C++ 文件；数据库有 `a.cpp`、`b.cpp`、`c.cpp`、`d.cpp`：`a.cpp` = `#include "a.h"\n`、`b.cpp` = `#include "b.h"\n`、`c.cpp` = `int c;\n`、`d.cpp` = `#include "d.h"\n`，另有 `a.h`、`b.h`、`d.h`（7 个文件）。经 `sourceAnalyzers.pythonPath` 给一个包装，转发真解释器的输入输出；(1)(2)(4) 的包装按 `start` 行里的主文件路径认（不按第几次），(3) 的包装按自己被启动的次数认（次数记在一个计数文件里）；每例都记下启动次数。
  - (1) 单元限时 1,000 毫秒；看到 `b.cpp` 的 `start`：先把这一行转发出去，再停止转发、挂住；看到 `c.cpp` 的 `start`：先转发，再杀掉自己的子进程和自己 → 边 `[('a.cpp','a.h'), ('d.cpp','d.h')]`，`cpp { files: 7, parsed: 4, edges: 'supported', reason: null, notes: ['近似：不读系统头文件和观测以外的头文件'], issues: [{ path: 'b.cpp', kind: 'failed', reason: '超时' }, { path: 'b.h', kind: 'skipped', reason: '有编译单元没有做完' }, { path: 'c.cpp', kind: 'failed', reason: '分析进程崩溃' }], issueCount: 3, complete: false }`，启动 3 次（从 S8D-CPP-03 挪来）。
  - (2) 单元限时 60,000 毫秒、整门语言限时 5,000 毫秒；`b.cpp` 的 `start` 转发后挂住 → `a.cpp`、`a.h` `parsed`；`b.cpp`、`c.cpp`、`d.cpp` `failed`、`超时`；`b.h`、`d.h` `skipped`、`有编译单元没有做完`；边 `[('a.cpp','a.h')]`；启动 1 次。
  - (3) 第一次启动看到 `b.cpp` 的 `start`：转发后杀掉自己；第二次启动什么也不输出、以退出码 3 退出 → `b.cpp` `分析进程崩溃`；`c.cpp`、`d.cpp` `failed`、`分析运行失败：重启后的进程在新单元前退出（退出码 3）`；`b.h`、`d.h` `skipped`、`有编译单元没有做完`；`a.cpp`、`a.h` `parsed`；启动 2 次。
  - (4) `b.cpp` 的 `start` 转发后挂住，并写一个标记文件；测试看到标记后中止请求 → 整次 `cancelled`；包装的进程组已经结束。
- **查源码不变（回归行，经 `createExplorationTools` 的工具调用）**〔8D 返工〕：`python_index` 1,500 个文件（`pkg/module_0001.py` 到 `pkg/module_1500.py`），`imports` 带 `path: 'pkg/module_0001.py'`、`limit: 10` → 工具 `success`（8D 的代码上是 `Analysis output too large; narrow paths or result limit`）；`cpp_index` 用 S8D-CPP-01 的夹具，`symbols` 回 `unsupported`、`libclang could not parse configured translation unit: src/broken.cpp (code 1)`；`python_index` 的目录：给一个目录，放 22 字节的空 zip、和它摘要相符的 `analyzers.sha256`、一个 `manifest.json` → `imports` 回工具 `success`，值 `{ status: 'unsupported', message: 'Python semantic provider missing: jedi is not in <目录>/analyzers.zip' }`，不给目录时同一个查询回 `sourced`（只给空目录不行：缺文件在起脚本之前就报错）。
- **8D 的测试去留**〔8D 返工〕：S8D-CPP-01、02 改写进 A-22 的 (k)、(l)；S8D-CPP-03、S8D-PY-01 删掉；S8D-PY-03、S8D-PROV-06 改成上面的目录回归行；S8D-CPP-04、S8D-PY-02、S8D-PY-04、S8D-PROV-01、02、04 留着；S8D-PROV-05（`-I /etc`）改成：编译单元照常解析，`notes` 是 `['忽略了 1 个工作区外的查找目录', '近似：不读系统头文件和观测以外的头文件']`；整对象断言的旧测试照 §11.5 加 `notes`。
- **旧记录**〔§10 段〕：A-16 的夹具改在 8D 返工之前的提交上生成（lead 分支，例如 `da633d89`：记录里没有 `notes`，也没有没解析引用的原因），这样“没有就读作 `[]`、读作 `reason: null`”两个分支真被走到；夹具源码里至少有一个 TS 文件带一条没解析的引用（例如 `import "missing-pkg";`），测试在新代码上采用一份目录，再对旧捕获跑 `compare-formal`；读出来 `notes: []`，它的 `unresolved` 发现的 `detail` 只有说明符。
- §10 的 A-10（程序太大）删掉。

### 11.7 时机、行数、实测、限制

- **8D 返工**（先做）：§11.1 的拿掉和 `python_index` 的三处、§11.3、§11.4（被忽略的编译数据库除外）、§11.5（没解析原因的存法除外）、§11.6 里标〔8D 返工〕的行。估新增生产代码约 920–1,380 行，另删约 200 行（C/C++ 脚本 335–475，Python 脚本 230–320，执行器 160–240（含单元清单、合并和退出规则），两个提供者改接执行器 90–140，选配置看存在、汇总或合并数据库和提供者的输入 50–100，没有读到的认领文件不起分析 10–20，覆盖加 `edges`/`notes` 30–60，`python_index` 的三处 10–15，限时注入 5–10；第六稿比第五稿多约 75–125 行：汇总或合并数据库 35–65、JSONC 和 Python 的新原因 30–40、没有读到的认领文件不起分析 10–20）。
- **§10 段**（接在 8D 返工之后，在 8D 返工的代码上）：§10 原有各条（照 §11.1 改），加 §11.2 的 TS 轻型扫描、故障钩子和模块快照的截短、被忽略的编译数据库、没解析原因的存法，§11.6 里标〔§10 段〕的行。估 750–1,150 行，另加 TS 扫描替换分析器后的契约、协议成本 50–100 行，模块快照截短 20–40 行。两段一起合入，合入前在合起来的树上跑全量。
- **实测：** C/C++ 的实测已做（2026-10-17；CMake 3.30.5 源码，用户同意下载，官方发布包核过 SHA-256 `9f55e1a4…a86d`，只配置不构建，1,064 个编译单元；用户自己的 ROS 2 工作区的一份副本，ROS jazzy 真跑了 configure，23 个编译单元；两个项目各一个 Claude 子 agent 量、另一个用自己写的扫描器复核；报告和脚本放进 8D 的证据），结论进 §11.4。第二轮（2026-10-17 晚，用户要求测运行时依赖，用户同意下载）：libuv 1.48.0（官方发布包，CMake 只配置，441 个编译单元，三种布局）、ros2/demos jazzy（git 克隆 `37e25e0d`，16 个包逐个只配置，78 个编译单元，69 个 `.py`）、Django 5.1.15（PyPI sdist，SHA-256 和 PyPI 一致，2,788 个 `.py`）、用户 SLAM 副本（23 个编译单元、10 个 `.py`），另写了 Python 轻型扫描的原型（照第四稿：第四稿的 A-20、A-21 和自加的 17 例全过，和 CPython 的 `find_spec` 对照一致）；每个项目由另一个 Claude 子 agent 用自己的脚本复核，结论都一致；报告 `impl/s8d/measure-runtime/report.md` 放进 8D 的证据。结果：C/C++ 四个项目 0 个误判失败，项目内的边和 GCC 真编译逐条相同（libuv 475 条，441/441 个编译单元读到的项目文件和 `gcc -E -H` 一致；ros2/demos 合并以后 90 条），libuv 换 Windows、Darwin 目标再扫 258 次也是 0；条件编译走得和真编译不同的有 270 处，含 `#include` 的 1 组，目标是系统头文件；Python 和 CPython 自己的查找逐条一致（Django 2,787 个文件 parsed，唯一失败的是 Django 故意写错的），3–3.5 秒、74 MB。第六稿的核对（三个 Claude 子 agent，`impl/s8a-scale/d78-draft6-check/`）：把 Python 原型改到第六稿跑第六稿的 A-20、A-21 全过，Django、ros2/demos、SLAM 的边和没解析的条目不变，只有原因照第六稿换了（Django 2,278 条换成 `标准库`）；C/C++ 原型改到第六稿跑 A-22、A-23 的 31 例全对；真跑了一次 colcon（colcon-cmake 0.2.30），发现它另写汇总的 `build/compile_commands.json`，选法因此加了“只用汇总那一份”。实测的局限：R2lex 的“0 误判”来自四个项目（CMake、SLAM、libuv、ros2/demos；Qt 这类没量），第二轮没有新做注入；用的是原型，不是生产执行器；Python 只在 3.12 上跑；没量用 Django 写的应用项目；拼写纠正这条退路两个项目里都是 0 次，没有夹具，施工时找到 libclang 18 能触发的写法再加一例。合入前（Claude 子 agent）：TS 在本仓库、3 倍真实代码、2 万个合成文件、有循环的 2,000 个文件上量时间和内存；一个真实的 Python 项目经真实的执行器量；C/C++ 两个项目经真实的执行器再量一次。再要下载别的项目要先经用户同意。
- **边是什么（写进工具说明，不进每次的 `notes`）：** 边只来自源码里的 `import`、`#include`（和 §11.2 列的 TS 引用形式）。运行时才连上的都不算边：ROS 的话题、服务、动作、参数、TF、launch 起的进程、组件和 `class_loader`、`pluginlib`、rosidl 生成的接口；Django 的设置和点号字符串、按目录约定加载的模块（`commands`、`migrations`、`apps.py`、locale formats）、模板、迁移的依赖；C 的 `dlopen`、测试登记表（X 宏）、按名字起子进程、数据文件；CMake 的链接和 `package.xml` 的依赖。实测（第二轮）：ros2/demos 的 117 对通信文件里 114 对和图毫无关系，21 个包之间 0 条边；SLAM 的 35 对运行时文件对 0 对连上；Django 的加载关系 253 对里 107 对在目录层完全没连上（84 对是 locale formats 这一种）；libuv 的这些依赖在目录层只多 4 对。`complete` 只说明解析覆盖完整，不说明没有依赖（SLAM 的 10 个 `.py` 全部 parsed、`complete`，边是 0，它们其实经话题、launch、参数文件全都连着）。
- **已知限制（写进工具说明）：**
  - C/C++ 的系统头文件和 Python 的标准库、外部包都读作没解析，按 L7 这些模块缺的依赖几乎都是 `unknown`。
  - C/C++ 只按一个平台读：没写目标的数据库一律按 `x86_64-pc-linux-gnu`，预定义宏永远是 clang 的；只在别的平台编译的文件是 `skipped`，它们的引用不进图（libuv 71 个文件、约 199 对引用、34 个目录对，`src/win` 整个是孤点）。
  - 在别的机器上生成的编译数据库（路径不在这个工作区根下）全部编译单元的主文件都不在观测的文件里，什么也不解析；用 clang 时 CMake 的预编译头（`-Xclang -include-pch`）让那些编译单元失败。
  - 合并以后，colcon 跨包要经被 git 忽略的 `install/` 才找到的头文件读作没解析（SLAM 少 9 条）；嵌套的独立 CMake 项目（例子、第三方子项目）进不了根数据库，文件是 `skipped`（libuv `docs/code` 的 34 个），把它也配置了，而工作区根上没有数据库、几份又不合 §11.4 的汇总或合并两种摆法时，是 `有多个编译数据库`，根上有数据库时只用根上的，子项目的文件照旧 `skipped`；ROS 接口头和 rosidl 生成的头文件读作没解析；不 `#include` 自己头文件的 `.cpp` 在图上是孤点（SLAM 的 `utils.cpp`）。
  - Python：运行时才有的查找根读不到（脚本所在目录、改 `sys.path`；Django 的 `tests/runtests.py` 让 17 条项目内引用没解析）；多包仓库只读根上的配置（ROS ament_python 每个包有自己的 `setup.py`，ros2/demos 4 条包内引用没解析）；没有扩展名的脚本不认领；往 `sys.modules` 塞的子模块（`os.path`）和 meta path importer（`six.moves`）在项目里有同名文件时读成 `是模块，不是包`；名字不是字面量的 `importlib.import_module`、`__import__` 看不到；中间各级的 `__init__.py` 不加边（Django 有 135 个包标记文件是孤点）；`sys.stdlib_module_names` 跟着运行扫描的 Python 版本走。
- **以后做（不在这两段）：** 多包仓库的包名映射；按文件就近的 tsconfig、跟进 `references`；JSDoc 的引用和环境模块；引用的种类字段；工作区外的引用（系统头文件、标准库、外部包）单独处理；C/C++ 的多进程；colcon `install/` 到 `src/` 的头文件映射；嵌套的独立 CMake 项目；按内容摘要的缓存；用文件状态代替重读做核对（先在 drvfs 上量）；严格捕获和查源码的 `imports` 改用轻型扫描；程序放进 `worker_threads` 并限内存；Rust、Go 和没有编译数据库时 C/C++ 的近似模式（tree-sitter）；`extends` 链走到的文件也只当配置读；agent 填参数给 C/C++ 扫描的工具（决定 78-3）。
- **运行时依赖的候选（第二轮实测提出，做不做由用户定；成本是子 agent 的粗估，没量过；都要先有“引用的种类字段”）：**
  - ROS 通信图（话题名当节点、带 launch 的上下文），价值最大：名字能静态定下来的 ros2/demos 99/103、SLAM 34/34；难点是同名端点多（`chatter` 有 7 个发布方、8 个订阅方）、`SkipFunctionBodies` 看不到函数体里的 `create_*`，要另做一遍扫描；中到大。
  - ROS 便宜的三样：rosidl 接口对到接口文件（估几十行，出现第一批跨包边）；`package.xml` 的依赖当包之间的关系；launch 和入口点对到文件（ros2/demos launch 43/46、入口点 25/25，SLAM 16/16）；便宜到中等。
  - CMake 链接图：配置前放 CMake File API 的 codemodel-v2 查询文件，要 agent 先跑配置（决定 78-3）；中等。
  - Python 按包、按子目录补查找根（有 `setup.py`、`setup.cfg`、`package.xml` 的目录作根，或由 agent 按子目录填）：ros2/demos +4 条，Django `tests/` +17 条；小到中等。
  - 字符串路径引用（Django 的设置、`INSTALLED_APPS`、`include()`、字面量的 `import_string`、迁移的 `dependencies`）：价值在用 Django 写的应用项目，这次没量；中等偏小。
  - 第二遍扫没被读到的源文件（借邻近单元的参数、换平台目标，边标成近似）：libuv +196～201 条；中等。
  - 不建议：字面量的 `importlib` 边（Django 库里 0 处）；框架约定加载和 Django 模板（只按框架开关做）；`pluginlib`（四个项目都是 0 处，量不出价值）。
