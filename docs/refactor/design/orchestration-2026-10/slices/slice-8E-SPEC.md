# 第 8E 片规格：语义联系（决定 87）

**状态：已冻结（2026-10-22）。** lead 起草，经 Codex 两轮完整审查和一次快速核对，lead 逐行审后冻结（决定 56）。施工排在 8C 之后（§7）。

代码事实在 `994b69e2` 上核对。

**一句话。** agent 用“记”写下扫描看不到的联系（调用、注入、回调、数据、消息、起进程）和有先后的流程。每条联系带证据：代码里接线、登记、收发的位置，和两边共用的名字。平台在写入时查格式、核对两头，并用现有的源码工具在代码里找到每条证据；代码改了再核，读出“对得上”“断了（哪一条）”或“查不了（为什么）”。架构图把联系作为单独一层读出来，标明是 agent 写的，不当确定的代码依赖。来历见 [HANDOFF 决定 87](../../../HANDOFF.md)。

## 0. 冻结说明

### 0.1 要你定的

**1. 联系写下就生效，还是等检查通过才生效？** 用户 2026-10-22 定：写下就生效（`accepted`）。
- 写入时平台已经在代码里找到了每条证据（L3b）：指定的引用和文字在指定的范围里共现。这是共现，不是证明接线（L3e）；等这次执行的正式检查，不会多证明什么。
- 联系不改架构目录，也不改依赖图，只是挂在节点上的理解；代码以后变了，平台重核证据，断了就读作 `broken`，说清是哪一条，进书记的待办（L3c、L12）。
- agent 只读探索时也能写；这时没有代码改动，也就没有可等的检查。
- 不采用 (b) 先暂存、等这次执行的正式检查通过才生效：只在证据指向这次执行刚写、可能被返工的代码时有用；代价是只读探索时写的要另定规则，要用 8C 的暂存和生效机制。

**2. 告知（lead 的做法，你可以改）：联系进 agent 的上下文。** agent 在某个模块或文件上干活时，不用调用工具，就能在执行输入的“注记”一段看到挂在这些节点上的联系，和一般注记共用这一段的预算。证据断了的联系只出一行警告，不当结论。流程不自动带，要用“看”“找”读。

### 0.2 代码事实（`994b69e2`；✓ 是 lead 核过的）

| # | 事实 | 位置 |
| --- | --- | --- |
| F1 ✓ | 注记的种类有八种：六个一般种类，加 `understanding`、`repair`。种类表分散在五处：合同、工具参数、写入服务、编解码，以及“找”的种类过滤（过滤多一个 `'general'`） | `contracts/note.ts:46`；`agent-runtime/note-tool.ts:149`；`work-graph/notes/note-service.ts:326`；`work-graph/persistence/note-record-codecs.ts:103`；`agent-runtime/graph-tools.ts:283` |
| F2 ✓ | 写入的闸门顺序：形状 → 幂等 → 调用方 → 种类权限（`noteWriteAuthority`）→ 锚点（`resolveNoteAnchors`，L2a 第 1、2、4 类）→ 当前理解和目标的规则 → 依据文件 → 关系（`readMany` 批量读一次）→ 同话题 → 额度 → 状态 | `note-service.ts:1152–1475` |
| F3 ✓ | 一个主锚点加最多 4 个附加锚点（`NOTE_EXTRA_ANCHORS_MAX = 4`）；附加锚点和主锚点重复是第 1 类格式错。头上有 5 个按锚点的等值索引，还有 5 个按路径的有序索引 | `work-graph/model/note-contracts.ts:29`；`note-record-codecs.ts:39–47`、`659–678` |
| F4 ✓ | 文件锚点的 `symbolRequest` 由源码分析器解析：恰好一个命中才记定位（限定名、范围、文件摘要、签名摘要）；多个命中退回 `symbol_ambiguous` 并列出候选；没有命中或语言不支持，只存文件锚点并警告 `symbol_unresolved` | 第 4 片规格 L14；`notes/note-anchors.ts:475` |
| F5 ✓ | 每个锚点的额度（5）只算六个一般种类；每个目标的额度（200）算所有种类、四个计数状态。新写入的状态由 `admitNoteWrite` 定：`repair` → `staged`；你写的 → `accepted`；有矛盾、取代了你确认过的、额度满了 → `pending_review`；其余 → `accepted` | `note-service.ts:1416–1439`；`work-graph/state/note-machine.ts:59` |
| F6 ✓ | 取代只能在同一家族里：`sameKindFamily` 分“一般”和“非一般”两家，所以今天 `understanding` 和 `repair` 算同一家 | `note-service.ts:328` |
| F7 ✓ | 默认可见：别的目标写的 `accepted`，只有你确认过才看得到；`reviewed` 到处看得到；`pending_review` 只有本目标看得到；Host 和查询的执行不分目标 | `notes/note-read-model.ts:569` |
| F8 ✓ | 执行输入的“注记”一段只收一般种类（`isGeneral` 过滤）；行的类型是 `NoteIndexRowV1` | `note-read-model.ts:2030`；`contracts/graph-context.ts:79` |
| F9 ✓ | `queryArchitecture` 只读观测图，`relations` 只有 `dependency` 和 `interface`。文件归模块只有一条规则 `pathOwnershipOf`（目录边界、最长前缀、并列报歧义） | `work-graph/architecture/architecture-service.ts:1560`；`contracts/path-ownership.ts:36` |
| F10 ✓ | 注记没有按种类的索引 | `note-record-codecs.ts:659` |
| F11 ✓ | 注记的显示行是 `renderNoteHeader`：`<类名>(<锚点显示>)<!>：<结论>`，类名来自平台包的 `note.kind.*` | `contracts/note.ts:110` |
| F12 ✓ | “有联系的范围”：一个模块的锚点键是这个模块、它的接口、它路径下的文件，再加 `project`（`project` 只对一般种类算）；按路径前缀读头有现成函数 | `notes/note-related-scope.ts:151`、`166`、`205` |
| F13 | 8C 给 `repair` 加专用字段 `repair`，写入时解析（规格已冻结，没施工）。8E 的字段照这个写法 | [第 8 片规格](slice-8-SPEC.md) L1 |
| F14 ✓ | 人写注记走 Host 路由 `notes/write`（只认人） | `app/core-routes.ts:506` |
| F15 ✓ | 源码查询 `querySource` 有这几类：`paths`；`text`（字面子串，`caseSensitive`，可选 `prefix`）；`symbols`；`definitions`、`references`（给路径、行、列）；`imports`、`calls`。命中分文件、文字、符号、位置、关系五种 | `core/workspace/ports.ts:65–76`、`:179` |
| F16 ✓ | `text` 查询一行一行按字面找，不跨行；文字 1–512 个码点、≤2,048 个 UTF-8 字节、不含回车换行；`prefix` 等于一个文件路径时只查这个文件 | `workspace/source-query.ts:43–45`、`:53–75`；`ports.ts:236–244` |
| F17 ✓ | 捕获只有 `typescript` 和 `text` 两种，`python`、`cpp` 退回 `unsupported`；`symbols`、`references` 这些语义查询只在 TypeScript 的捕获上有。Python、C++ 的分析器只给 agent 的探索工具用，不经 `querySource`。所以今天注记里只有 TS/JS 的符号解析得出来，Python、C++ 的 `symbolRequest` 都落成 `symbol_unresolved` | `workspace/capture.ts:611`；`source-query.ts:105–111`；`workspace/python-source-index.ts:17`、`workspace/cpp-source-index.ts:16`；`agent-runtime/exploration-tools.ts:112`、`:119`；`note-anchors.ts:317–319` |
| F18 ✓ | 符号命中的位置是名字那几行（`nameSpan`），不是整个函数；存下的 `SymbolLocatorV1.range` 就是这几行。一个导航项可以带多个声明段（重载、合并声明）；今天只取 `item.nameSpan ?? item.spans[0]`，没有把各段都带出来 | `workspace/typescript-source-query.ts:204`；`note-anchors.ts:374–376`；`contracts/note.ts:19–20` |
| F19 ✓ | 捕获的上限（Host 默认，可配）：一次查询最多 10,000 个结果；同时留 8 个捕获；一个捕获最多 16 种查询。查询按完整参数缓存，同参数的第二次查询不再计数。超了是 `capacity` | `workspace/workspace-tools.ts:11–21`；`source-query.ts:83`、`:86`、`:100`、`:149` |
| F20 ✓ | 文件锚点的键只到路径，不含符号；同一条注记里两个锚点的键重复是第 1 类格式错。所以同一个文件里的两个函数，今天不能同时当一条注记的两个锚点 | `note-anchors.ts:409–414`、`:497–502`、`:570–574` |
| F21 ✓ | 写入时：形状在第一步（`writeInputProblem`）；重放在调用方之前答复；锚点、第 3 类检查和警告在一起；之后按工作树读依据文件的摘要（`raw_bytes`） | `note-service.ts:1157`、`:1164–1166`、`:1184–1252`、`:1254–1272` |
| F22 ✓ | 读时的核对在 `createNoteCheck`，读法经 `withCheck` 调它。文件锚点的文件摘要变了才重新解析符号：按名字找，同名多个时用存下的行挑；一次调用最多重解析 `NOTE_SYMBOL_RECHECK_MAX = 20` 个，每个开一个捕获，超了记 `unchecked`；另加最多 `NOTE_LINK_RECHECK_MAX` 条联系的重核，每条最多开一个捕获。一次调用最多读 `NOTE_READ_FILES_MAX = 256` 个文件 | `work-graph/views/note-views.ts:214`、`:321–392`、`:709–727`；`note-read-model.ts:389`；`note-contracts.ts:37`、`:39` |
| F23 ✓ | L8 的自动抓在 Host 里：工作区登记、目录采用或修订、检查 PASS 之后各触发一次；全 Host 一个串行队列，同一工作区的等待合并；没有租约的 Host 不写任何东西 | `app/auto-capture-driver.ts:54–64`、`:81`、`:141`；`app/host.ts:546`；[第 8 片规格](slice-8-SPEC.md) §13 |
| F24 ✓ | 文件按扩展名分语言：`typescript`（含 `.js` 等）、`cpp`、`python`、`rust`、`go`、`other` | `workspace/architecture-language-provider.ts:84–101` |
| F25 ✓ | 运行时拼名字的地方静态找不到：8D 实测 Django 的 `django/` 里 importlib 43 处、`import_string` 41 处，名字都不是字面量；ros2/demos 上 117 对按名字通信的文件里，114 对在依赖图上毫无关系 | 8D 实测报告（已归档：`docs/refactor/reviews/evidence/orchestration-slice-8D-2026-10-18/checks/measure-runtime/report.md`）第 26、88、101 行 |

### 0.3 lead 定的技术选择

- **T1 两个新种类：`link`（一条联系）和 `flow`（一条流程）。**
  - 它们不是一般注记：不进每个锚点 5 条的额度，也不和一般注记互相取代。
  - `link` 只取代 `link`，`flow` 只取代 `flow`。
  - `understanding` 和 `repair` 之间今天的规则（F6）不动。
- **T2 用锚点的位置表示方向。**
  - `anchor` 是“从”，`extraAnchors[0]` 是“到”，`extraAnchors[1]` 是“经过”。`injects`、`callback` 一定有“经过”，别的关系可选（L1）。
  - 这样不用加新索引：从任何一头按锚点查，都找得到这条联系。
  - 三个端（从、到、经过）都走现有的锚点闸门和过时检查（F3、F4）。`link` 的符号解析不在这里做，放进 L3b 的那一个捕获（C4，L3）；别的种类照旧的逐个锚点解析。
- **T3 专用字段照 8C 的写法**（F13）。
  - 写入给 `link: LinkInputV1` 或 `flow: FlowPayloadV1`，只在各自种类上必填，别的种类不许有。
  - 存下的 `link` 是 `LinkPayloadV1`：多了每条证据的原始范围选择器和解析出的位置（解析不出时只留选择器）、文件摘要、写时的核对结果。同 8C 的 `RepairInputV1` 和 `RepairPayloadV1`。
  - 三个端和符号 key 也各存一份原样请求（`ends`、`key.symbolRequest`），解析出的定位另存（N1）；端点的定位就是第 4 片 L14 的 `SymbolLocatorV1`（M2）。
  - 不把格式写进正文：正文写理由，给人和模型看。
- **T4 写下就生效**（用户 2026-10-22 定，§0.1 第 1 条）；不暂存。
- **T5 额度单独算**（L5）。初值没有实测，做成可注入的常量。
- **T6 加一个索引：`s8e-note-by-kind-state`**（项目、种类、状态）。读整个项目的联系层、列流程时用它。
- **T7 读法分两路：**
  - 人走两条新 Host 路由；
  - agent 走现有的“看”“找”记忆分支，加种类过滤，结果项带上专用字段和核对结果。
  - 不改 `queryArchitecture`（它只管观测图，F9）。
- **T8 联系进执行输入的“注记”一段**（§0.1 第 2 条）；流程不进。
- **T9 平台核对证据，不核对运行时。**
  - 动态连接在代码里总留下静态的痕迹：一处接线、登记或订阅，和一个两边共用的名字（接口、登记名、话题、路径、常量）。联系要带这些位置，平台去找（L3a、L3b）。
  - 平台保证：三个端存在、格式对、指定的引用和文字在指定的范围里共现、门里的文件改了以后下一次读重核并说清哪一条断了（L3c、L3d）。
  - 平台不保证运行时真的走这条线，也不证明接线（L3e）。这一半由书记核对，你挑着看。
- **T10 核对用现有的工作区端口。** 和第 4 片 L14 一样，经 `capture`、`querySource`、`readWorkspace`、`releaseCapture`（`note-anchors.ts:40–45`），不加新端口。引用只在 TS/JS 上查（F17）；字面在任何文本文件上查。

**lead 定的（2026-10-22）：**
1. 证据的范围从函数名来（L3a，F18）：一个导航项带全部声明段（`declarationRanges`）；证据范围就是这些段，命中落在任何一段都算，不静默取第一段。行号范围在上面插一行就失效。端口上这个字段可选，TypeScript 提供者总是给；消费端保留 L3a 的回退（N11）。
2. 证据要落在端点里（L3a）：不然不相干的代码也能让联系读作 `verified`。
3. 同一个文件里的两个锚点（L1，F20）：`link` 按端点身份判重（N1、C13），即规范化路径 + 请求的符号名，请求给了行号范围时也带上（原样比较）；没给符号时只看路径。行号、摘要不参与。回调和注入的槽常和“从”在同一个文件。lead 核过索引，同一个键落在两个槽不冲突。
4. 代码改了以后重核（L3d）：(a) 读时按文件摘要重核；已有同样的做法，不加记录。门里的文件改了，下一次读就看得到（C3）；门外的文件不在承诺里（L3e）。每次调用最多 `NOTE_LINK_RECHECK_MAX = 10` 条。
5. 读时加 `unchecked`。`accepted`/`reviewed` 是状态现行；`broken`、`unchecked` 不构成现行结论（`currentEligible` 为假，L3c）：没核过的不能当作还对。
6. Python、C++ 的引用（L3b）：读作 `unverifiable`（`language_unsupported`），不退成按名字找文字；同名的注释和变量会算进去。

### 0.4 和别的片的接缝

- **第 4 片：** 在注记上加种类；写入闸门、读法、书记的 `stale` 读照用。找证据接在写入闸门的锚点之后（F21）；读时重核和符号重解析共用一次调用的观测预算（F22）：最多 20 次符号重解析，加上最多 `NOTE_LINK_RECHECK_MAX` 条联系重核，每条最多一个捕获。`link` 的端点和符号 key 解析成第 4 片 L14 存的那种 `SymbolLocatorV1`（限定名、范围、文件摘要、签名摘要），所以第 4 片的读时重解析和退役（F22、L23）原样适用于联系的端点（M2）。核对按锚点槽位留状态和原因（N2），`retiredExtraAnchors` 只是兼容投影。
- **工作区：** 只读，经现有端口（T10）。按 lead 2026-10-22 的决定，要给 `SourceHit` 的符号命中加一个可选字段 `declarationRanges: { startLine: number; endLine: number }[]`（C8）：端口上可选，TypeScript 提供者总是给（N11）。`project_source` 工具把查询结果原样交给模型（`agent-runtime/project-source-tool.ts:205–206`），模型会多看到这个字段，相关字节测试要改。
- **8C：** 两片都改注记的写入合同（8C 加 `repair` 字段，8E 加 `link`、`flow` 字段），所以 8E 排在 8C 之后，免得冲突。这是集成顺序：8E 的代码只依赖第 4 片和 8A（文件归模块的根路径）。
- **第 8 片 L8：** L3d 选了 (a)，不接自动抓（F23）。
- **PC-2：**
  - `record_note` 的工具说明、参数说明和平台包字符串都在提示词包里。8E 改的是包里的文字，平台包版本加一，规则照 PC-2。
  - `record_note` 的参数表加字段，照 W 组让工具工厂收 `texts` 的做法。
- **第 9 片：** 冲突发现以后可以读联系（不在本片）。
- **E3：** 界面项 [E3-UI-ITEMS](../E3-UI-ITEMS.md) D87-1。界面要显示核对结果（`verified`；`broken` 和哪一条；`unverifiable` 和原因；`unchecked` 和原因），lead 补进 D87-1，§6 列了这个文件（N12）。

## 1. 范围

### 1.1 交付

1. 注记的两个新种类 `link`、`flow`，带专用字段和写入检查（L1–L4）。第一段只开 `link`，第二段开 `flow`（N11）。
2. 联系的证据：每种关系要哪些证据，写入时在代码里找（L3a、L3b）。
3. 读时的核对结果，和代码改了以后的重核（L3c、L3d）。
4. 额度和状态（L5、§3）。
5. 两条 Host 路由读联系层和流程（L7–L9）。
6. agent 的“看”“找”加种类过滤，结果带专用字段和核对结果（L11）。
7. 执行输入的“注记”一段收联系（L10）。
8. 工具说明、平台 Skill 和平台包字符串（L3e、L11、L13）。

### 1.2 不在本片

- **界面**：E3 的 D87-1。
- **改架构目录、进依赖图**：联系不参与 `architecture/compare-formal` 和 `architecture/impact`。影响分析要不要把语义联系算进去，以后定。
- **从代码自动推出联系；用运行记录确认联系。**
- **证明运行时走哪条分支、配置装的是哪个实现**（L3e）。
- **Python、C++ 的引用核对**：等这两门语言的分析器接进 `querySource`（F17）。字面的核对照做。
- **流程跟着取代自动更新**：步骤里的联系被取代后，流程读作需复查，由人或书记重写。
- **跨工作区的联系。**

## 2. 接口（新名字以此为准）

```ts
// src/contracts/note.ts
export type NoteKind = 'convention' | 'pitfall' | 'tradeoff' | 'open_question' | 'preference' | 'decision'
  | 'understanding' | 'repair' | 'link' | 'flow';
// 施工分两段：第一段 NoteKind 只加 'link'，第二段再加 'flow'（N11）。旧八种的行为不变。

/** 方向 = 运行时控制或数据流动的方向：from → to。 */
export type SemanticRelationV1 =
  | 'calls'     // from 在运行时按名字或路径找到并调用 to：登记表、动态导入、插件、dlopen、设置字符串
  | 'injects'   // from 只认一个槽，运行时由别处把 to 的实现装进去；槽写在“经过”：接口、方法或依赖对象的字段
  | 'callback'  // to 把自己的函数交给 from，from 在运行时回调它；回调的槽写在“经过”
  | 'data'      // from 写、to 读同一份数据：文件、表、正文、配置
  | 'message'   // from 发、to 收：话题、事件、邮箱、HTTP
  | 'spawns';   // from 起 to 这个进程：launch、子进程

/** 两边共用的名字（L1、L3a）。 */
export type LinkKeyV1 =
  | { kind: 'symbol'; anchor: { kind: 'file'; path: string; symbolRequest: SymbolRequestV1 } }  // 常量或类型，照第 4 片 L14 解析
  | { kind: 'literal'; text: string };   // 代码里照字写着的名字：登记名、话题、路径、程序名

export type LinkEvidenceRoleV1 = 'use' | 'wire' | 'register' | 'emit' | 'receive' | 'launch' | 'entry';
export type LinkEvidenceV1 = {
  role: LinkEvidenceRoleV1;
  // symbolRequest 和 range 至多给一个；都不给，范围是整个文件（L3a）
  at: { path: string; symbolRequest?: SymbolRequestV1; range?: { startLine: number; endLine: number } };
};

/** 写入时给的（record_note 的 write、notes/write）。 */
export type LinkInputV1 = {
  relation: SemanticRelationV1;
  key?: LinkKeyV1 | null;        // injects、callback 不给；其余必给，名字是运行时拼的给 null
  evidence: LinkEvidenceV1[];    // 1–8 条（NOTE_LINK_EVIDENCE_MAX = 8），角色按 L3a
};

/** 核对结果（L3b、L3c）。 */
export type LinkVerificationV1 =
  | { status: 'verified' }
  | { status: 'broken'; missing: number[] }     // 找不到的证据的下标，从 0 数；只在读时出现
  | { status: 'unverifiable'; reason: 'key_not_literal' | 'language_unsupported' | 'analyzer_unavailable' }
  | { status: 'unchecked'; reason: 'budget' | 'unavailable' };   // 只在读时出现

/** 存下的（NoteBodyV1.link）：原始选择器、解析出的位置、文件摘要和写时的结果。
 *  摘要口径：捕获内容是 decoded_utf8，工作树读是 raw_bytes（ports.ts:39–41）；只同口径比。 */
export type LinkEvidenceStoredV1 = {
  role: LinkEvidenceRoleV1;
  at: {
    path: string;
    symbolRequest?: SymbolRequestV1;   // 写时给的原样选择器；没解析成功也留着（C1）
    range?: { startLine: number; endLine: number };   // 写时给的行号范围
    symbol?: SymbolLocatorV1;          // 解析结果；没解析成功时没有
    // symbolRequest 和 range 至多一个；都不给是整个文件
  };
  fileDigest: string | null;           // 写时按工作树读的 raw_bytes；文件读不到时 null（C1、C2）
  digestBasis: 'raw_bytes';            // 和捕获内容的 decoded_utf8 不直接比（C2）
};
/** 端点的原样请求（N1）：文件端带 symbolRequest，模块、接口端就是它自己。 */
export type LinkEndRequestV1 = Extract<NoteDraftAnchorV1, { kind: 'module' | 'interface' | 'file' }>;

/** 存下的符号 key（N1）：请求原样保存，解析结果另存。 */
export type LinkKeyStoredV1 =
  | { kind: 'symbol'; path: string; symbolRequest: SymbolRequestV1; symbol?: SymbolLocatorV1 }
  | { kind: 'literal'; text: string };

export type LinkPayloadV1 = {
  relation: SemanticRelationV1;
  /** 三个端各自的原样请求（“经过”没有时是 null）。解析出的锚点另存在 body 的 anchor/extraAnchors。 */
  ends: { from: LinkEndRequestV1; to: LinkEndRequestV1; via: LinkEndRequestV1 | null };
  key?: LinkKeyStoredV1 | null;   // injects、callback 是 null
  evidence: LinkEvidenceStoredV1[];
  /** 捕获的 `coverage.projectConfiguration` 和配置内容在捕获里的 `decoded_utf8` 摘要；没用捕获时都是 null，不设配置门（D1）。 */
  analysisConfig: { path: string | null; digest: string | null };
  verification: Extract<LinkVerificationV1, { status: 'verified' | 'unverifiable' }>;   // 写时的结果
};
export type FlowPayloadV1 = { steps: { link: string /* link 注记的 noteId */ }[] };   // 2–20 步

export type NoteDraftV1 =
  | NoteDraftCommonV1 & { kind: Exclude<NoteKind, 'understanding' | 'repair' | 'link' | 'flow'>; body: string }
  | NoteDraftCommonV1 & { kind: 'understanding'; sections: NoteSectionsV1 }
  | NoteDraftCommonV1 & { kind: 'link'; body: string; link: LinkInputV1 }
  | NoteDraftCommonV1 & { kind: 'flow'; body: string; flow: FlowPayloadV1 };
// 8C 另加 repair 那一支（规格 L1）；通用支照旧排除 repair，别的种类不许带 repair。
// 第一段只有 link 支；flow 支在第二段加（N11）。

// NoteBodyV1（从而 NoteHeadSnapshot、NoteVersionSnapshot）加：
//   link?: LinkPayloadV1   kind === 'link' 时必有，其余种类没有
//   flow?: FlowPayloadV1   kind === 'flow' 时必有，其余种类没有

// 写入的回执（第 4 片 §2 的 WriteNoteResult）：
//   warnings 加 'evidence_unverifiable'；
//   退回时只新增一个结构化字段 evidenceIndexes?: number[]（evidence_missing、evidence_outside_end 时）；
//   字段路径写在 reason 的文字里，写法同第 4 片的 anchor_invalid: <path>，不回 field（C12）。
// 新的退回原因（code 都是 invalid）：
//   link_anchor_count、link_anchor_kind、link_key_mismatch、link_key_invalid、
//   evidence_count、evidence_roles、evidence_invalid: <字段路径>、evidence_outside_end、evidence_missing、
//   link_end_unresolved、structural_not_allowed、payload_kind_mismatch、
//   flow_step_count、flow_step_duplicate、flow_step_not_link、flow_step_not_current、flow_anchor_mismatch。
// 证据、三个端或符号 key 的 symbolRequest 多个命中，照第 4 片退回 symbol_ambiguous，reason 里写字段路径；
// 同一级按字段顺序取第一个：anchor、extraAnchors[0]、extraAnchors[1]、link.key，证据按下标（N3）。
// 只有规则需要的端（L1）和符号 key 的确定没有命中是 link_end_unresolved；别的端没有命中只警告
//   symbol_unresolved，照第 4 片的做法（N3）。
// 证据的 symbolRequest 只能用在 TS/JS 文件（按扩展名，F24）；文件不是 TS/JS 时是
//   evidence_invalid: link.evidence[i].at.symbolRequest，改给 range 或整个文件（K2、C7）。
// 读证据文件时工作区报 forbidden，写入退回 evidence_invalid: link.evidence[i].at.path（M1）。
```

```ts
// src/core/workspace/ports.ts 的 SourceHit 符号命中加：
//   declarationRanges?: { startLine: number; endLine: number }[]   // 这个导航项的全部声明段（C8）
// 端口上可选；TypeScript 提供者总是给，消费端一个段都没有时退回名字那几行（N11）。
```

```ts
// src/contracts/semantic-layer.ts（新，纯类型）
// 端点身份（L1、L2、L9 共用，N1、C13）：模块按 moduleId；接口按 moduleId + interfaceId；
// 文件端按规范化路径，给了 symbolRequest 时再加请求的 name，和请求给了的 range（原样，
// 不用解析出的行号或摘要）。三个端和符号 key 都存原始请求，身份只看存下的请求，不看解析是否成功。
export type SemanticEndV1 = {
  anchor: NoteAnchorV1;                         // 存下的锚点（文件锚点带 L14 的符号定位）
  request: LinkEndRequestV1;                    // 原样请求；身份从这里算（N1）
  moduleId: string | null;                      // 按当前目录归到的模块（L7）
  unresolved: 'ambiguous' | 'not_owned' | null; // moduleId 为 null 时说明原因
  anchorStatus: 'live' | 'retired';             // 这个锚点槽位自己的状态，由第 4 片按槽位的核对结果给（N2）
  anchorRetiredReasons: ('module_removed' | 'interface_removed' | 'file_deleted'
    | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing')[];
};
export type SemanticLinkV1 = {
  noteId: string; version: number; state: 'accepted' | 'reviewed' | 'pending_review';
  relation: SemanticRelationV1; from: SemanticEndV1; to: SemanticEndV1; via: SemanticEndV1 | null;
  key: Exclude<LinkPayloadV1['key'], undefined>;           // injects、callback 读作 null
  evidence: Omit<LinkEvidenceStoredV1, 'fileDigest' | 'digestBasis'>[];
  verification: LinkVerificationV1;             // 读时的结果（L3c）
  currentEligible: boolean;                     // 状态现行、fresh、不冲突、来源可用、端不 retired，证据不 broken/unchecked（C12、C14）
  topic: string; conclusion: string; source: NoteSourceV1; goalId: string | null; confirmedByUser: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked';   // 第 4 片的核对
};
/** 读取时的联系载荷（N10）：存储的 verification 只有写时的两种，读时可能是四种。
 *  不要把存储的窄联合加宽来放读结果。 */
export type LinkReadPayloadV1 = Omit<LinkPayloadV1, 'verification'> & { verification: LinkVerificationV1 };

export type SemanticFlowStepV1 = {
  link: string;
  item: SemanticLinkV1 | null;                  // 只有步骤不再状态现行（not_current）时为 null；broken 保留 item（N6）
  problem: 'not_current' | 'broken' | 'stale' | 'unchecked' | null;   // 按这个先后取第一个（C14、N6）
};
export type SemanticFlowV1 = {
  noteId: string; version: number; state: 'accepted' | 'reviewed' | 'pending_review';
  topic: string; conclusion: string; source: NoteSourceV1; goalId: string | null;
  steps: SemanticFlowStepV1[];
  gapsAfter: number[];                          // 第 i 步的“到”不是第 i+1 步的“从”（端点身份，从 1 数，只是提示；N1、C13）
  currentEligible: boolean;                     // 流程自己的检查通过，且每一步的 currentEligible 都为真（N6）
  freshness: 'fresh' | 'stale' | 'unchecked';   // 流程自己的核对和步骤的问题一起给（N6）
};
/** NoteItemV1.flow（N10）：展开的步骤（含 item、problem）和缺口。 */
export type NoteFlowReadV1 = { steps: SemanticFlowStepV1[]; gapsAfter: number[] };

export type SemanticScopeV1 = { kind: 'project' } | { kind: 'module'; moduleId: string } | { kind: 'file'; path: string };
```

```ts
// src/core/work-graph/model/note-contracts.ts 的 NoteItemV1（:296）加（N2、N10）：
//   link?: LinkReadPayloadV1   kind === 'link' 时必有
//   flow?: NoteFlowReadV1      kind === 'flow' 时必有
//   anchorSlots: { status: 'live' | 'retired'; reasons: [...同上] }[]   主锚点在前，附加锚点按 extraAnchors 顺序
// 第 4 片的 NoteCheckV1 也带 anchorSlots；retiredExtraAnchors 保留为兼容投影。
// link、flow 项的 freshness/currentEligible 用 L3c/L9 的派生（证据、步骤），不用第 4 片按单条算的值。
```

```ts
// WorkGraph 读口（src/core/work-graph/notes/semantic-layer-read.ts，新）
// 每个范围都返回 accepted、reviewed、pending_review 三个可见状态（C16）。
readSemanticLinks(ctx, input: { scope: SemanticScopeV1; cursor: string | null; limit: number /* 1–100 */ }):
  Promise<ReadResult<{ items: SemanticLinkV1[]; next: string | null; catalogRevision: number | null }>>;
readSemanticFlows(ctx, input: { scope: SemanticScopeV1; cursor: string | null; limit: number /* 1–50 */ }):
  Promise<ReadResult<{ items: SemanticFlowV1[]; next: string | null; catalogRevision: number | null }>>;
// 项目流程一页最多核对 NOTE_FLOW_CANDIDATE_MAX 个候选，没走完给 cursor（C16，L9）。
// links、flows 都按 noteId 排序；重核预算按流程结果顺序、步骤顺序，第一次遇到一条联系时消耗（N9）。

// Host 路由（和别的架构读一样的门）
//   architecture/semantic-links  { scope, cursor?, limit? } → 上面的 links 结果
//   architecture/semantic-flows  { scope, cursor?, limit? } → 上面的 flows 结果

// agent：record_note 的 write 收 kind 'link' | 'flow' 和对应字段；
//   find_graph 记忆分支的 kind 过滤加 'link'、'flow'（'general' 不含它们）；
//   lookup、find 的结果项（NoteItemV1）带 link? / flow?，都是读类型（LinkReadPayloadV1、NoteFlowReadV1；N10）；
//   link 里的 verification 换成读时的结果（L3c）。
```

## 3. 状态行（写进 STATE-MACHINES-SPEC 的 S4-NOTE）

| 行 | 来自 | 到 | 谁 | 条件 |
| --- | --- | --- | --- | --- |
| S8E-01 | （无） | `accepted` | agent、书记、你 | `link` 或 `flow`，过了 L1–L4 和 L3b。你写的：通过写入检查就收下，之后不看矛盾、取代和额度（C17）。agent、书记写的：没有矛盾、没有取代你确认过的、额度没满 |
| S8E-02 | （无） | `pending_review` | agent、书记 | 同上，但有矛盾、取代了你确认过的，或额度满了（`quota_full`）；只对非人调用方（C17） |
| — | — | — | — | `link` 和 `flow` 从不 `staged`（§0.1 第 1 条，用户 2026-10-22 定） |

- 审查、撤下、取代以后的状态照第 4 片。
- 流程不跟随它引用的联系变：联系被取代或撤下，流程不改，读作需复查（L9）。
- 证据的核对结果（L3c）是读出来的，不是状态：`broken` 不改存下的状态，只让这条不算现行结论。写时查不了的（`unverifiable`）照常 `accepted`。

## 4. 规则

- **L1 形状**（第 4 片 L2a 第 1 类，在写入的第一步，F21；退回 `invalid` 并写明原因）：
  - **`link`**：
    - 必有 `link` 和 `body`；`link.relation` 是六种之一。
    - **锚点个数**（`link_anchor_count`）：`injects`、`callback` 的 `extraAnchors` 正好 2 个（“到”和“经过”）；别的关系 1 个或 2 个。
    - **锚点种类**（`link_anchor_kind`）：
      - “从”是模块、接口或文件锚点；
      - `injects`、`callback`、`calls` 的“到”，和 `injects`、`callback` 的“经过”，是带 `symbolRequest` 的文件锚点：核对要从它们的定义查引用（L3a）；
      - 其余的“到”是模块、接口或文件锚点，其余的“经过”是接口或文件锚点。
    - **`key`**（`link_key_mismatch`）：
      - `injects`、`callback` 不给：两边共用的名字就是“经过”；
      - `calls`、`data`、`message` 必给，可以是字面、符号或 `null`；
      - `spawns` 必给，只能是字面或 `null`。
      - 符号 key 的身份也按 N1 从请求算：规范化路径 + 请求的 `name`，请求给了范围时也带上；解析出的定位不参与。
    - 字面 key 1–512 个码点、≤2,048 个 UTF-8 字节、不含回车换行，同 `text` 查询（F16），否则 `link_key_invalid`；符号 key 的形状同文件锚点的 `symbolRequest`。`symbolRequest.language` 和文件扩展名不一致时：端 → `anchor_invalid: <字段>`，符号 key → `link_key_invalid`，证据 → `evidence_invalid: <字段>`（C7；F24 的扩展名是唯一权威）。
    - **`evidence`** 1–8 条（`evidence_count`）；角色的组合按 L3a 的表（`evidence_roles`）。
    - 每条证据的 `at`：
      - `path` 照文件锚点的路径规则；`symbolRequest` 照文件锚点；`range` 的行从 1 数，`startLine ≤ endLine`；
      - `symbolRequest` 和 `range` 至多给一个；
      - `symbolRequest` 只能用在扩展名是 TS/JS 的文件上（F24）；别的文件 → `evidence_invalid: link.evidence[i].at.symbolRequest`，改给 `range` 或整个文件，不静默放宽（K2）；
      - 错了退回 `evidence_invalid: <字段路径>`，写法同锚点的 `anchor_invalid`，例如 `evidence_invalid: link.evidence[1].at.range`。证据的下标从 0 数，同字段路径。`reason` 的文字里带字段路径；结构化字段只加 `evidenceIndexes`（C12）。
    - `structural` 必须是 `false`（`structural_not_allowed`）。
    - `basisFiles` 同一般注记，可给可不给：证据的位置已经写在 `evidence` 里，由 L3b 核对。
  - **`flow`**：
    - 必有 `flow` 和 `body`；
    - `steps` 2–20 步（`flow_step_count`），同一条联系不重复（`flow_step_duplicate`）；
    - `structural` 必须是 `false`。
  - **别的种类**带了 `link` 或 `flow` 字段 → `payload_kind_mismatch`；`link`、`flow` 缺自己的字段，同此。
  - **同一个文件里的两个锚点（lead 2026-10-22 定）。** 文件锚点的键只到路径，两个锚点在同一个文件里，今天是第 1 类的重复（F20）。可是回调的槽常是“从”那个类的字段；本仓库的注入槽也常是“从”那个文件里选项类型的字段（L3a 例子的第 1 步）。
    - `link` 的锚点按端点身份判重（N1、C13）：规范化路径 + 请求的符号名，请求给了行号范围时也带上（原样比较）；没给符号时只看路径。解析出的行号、摘要不参与。锚点键照旧只到路径；按锚点读本来就按注记编号去重（第 4 片 L3），额度也按注记数算。改动只在判重一处：`resolveNoteAnchors` 收一个开关，`note-service` 只在 `draft.kind === 'link'` 时打开；别的种类照旧按路径判重（旧八种行为不变）。lead 核过索引：每个锚点槽各有等值索引和有序路径索引（`note-record-codecs.ts:39–47`、`:659–678`），同一个键落在两个槽不冲突。
    - 不采用“从”只能退到模块锚点：`use` 照样落在模块里，但联系挂不到函数上。
- **L2 流程的步骤**（在 F2 的“关系”那一步，和关系一起批量读一次）：
  - 每步必须是本项目的 `link` 注记（`flow_step_not_link`），并且状态现行，即 `accepted` 或 `reviewed`（`flow_step_not_current`，C14 的“状态现行”）。
  - `anchor` 必须等于第一步那条联系的“从”（按端点身份比，N1、C13；`flow_anchor_mismatch`）。
  - `extraAnchors` 最多 4 个，每个必须是某一步的端点：从、到或经过（按端点身份比，N1、C13；`flow_anchor_mismatch`）。
  - 步骤不要求首尾相接：读的时候在 `gapsAfter` 里按端点身份提示（N1、C13）。
- **L3 三个端的核对。** 照第 4 片 L14（F4）：
  - 文件锚点带 `symbolRequest` 时由分析器解析；多个命中退回；没有命中只存文件锚点，并给警告 `symbol_unresolved`。
  - **定位同第 4 片（M2）。** `link` 的端点和符号 key 解析成第 4 片 L14 存的那种 `SymbolLocatorV1`（限定名、范围、文件摘要、签名摘要），存进端的 `symbol` 和 `key.symbol`；所以第 4 片的读时重解析和退役（F22、L23）原样适用于联系的端点。原样请求另存，身份不从解析结果算（N1）。
  - **`link` 的解析位置（C4）。** 三个端的 `symbolRequest` 和符号 key 都在 L3b 的那一个捕获里解析，规则同第 4 片 L14，不走锚点一步的逐个 `resolveSymbol`；锚点一步照旧查形状、路径和第 1–3 类。别的种类不变。
  - L1 要求给到符号的那几头（`injects`、`callback`、`calls` 的“到”，`injects`、`callback` 的“经过”）和符号 key，平台要从它们的定义查引用：
    - 在 TS/JS 文件里（按扩展名，F24）却没有命中 → 退回 `link_end_unresolved`，`reason` 写成 `link_end_unresolved: <字段路径>`，例如 `link_end_unresolved: extraAnchors[0]`、`link_end_unresolved: link.key`（C12）。只有这些规则需要的端和符号 key 是退回；别的端没有命中只给警告 `symbol_unresolved`（N3）；
    - 多个命中 → 照第 4 片退回 `symbol_ambiguous`，`reason` 写 `symbol_ambiguous: <字段路径>`；所有端和符号 key 的歧义都在这里（N3）；
    - 请求里的 `language` 和扩展名不一致 → 端是 `anchor_invalid: <字段>`，符号 key 是 `link_key_invalid`（C7）；
    - 在别的语言的文件里，今天解析不了（F17）→ 照收，给 `symbol_unresolved`；要查引用的证据读作 `unverifiable`（`language_unsupported`）。
  - 读时同一个名字有多个候选、存下的行挑不出一个 → `unchecked`（`unavailable`），不是 `broken`（N3）。
  - 工具说明里写：两头尽量给到函数。
  - 联系是不是真的在运行时发生，平台不判（T9、L3e）。
- **L3a 证据：每种关系要什么。** 一条证据是代码里的一个位置和它的角色。平台只在这个位置的范围里找。
  - **范围**，按先后取一个：
    1. `at.symbolRequest` 解析出的导航项的全部声明段；
    2. `at.range`；
    3. 整个文件。
  - **范围从函数名来（lead 2026-10-22 定；C8）。** 今天符号命中只带名字那几行（F18），给了函数名也框不住函数体；一个导航项还可能带多个声明段（重载、合并声明）。
    - TS 的符号命中加 `declarationRanges?: { startLine: number; endLine: number }[]`，取这个导航项的 `item.spans` 全部，不是 `spans[0]`，也不能静默取第一段；`typescript-source-query.ts:204` 现在取 `item.nameSpan ?? item.spans[0]`，改成另收全部 `spans`；`SourceHit` 的符号命中加这个字段，`source-query.ts:39` 照转。已有的 `location` 仍是名字那几行，不改。端口上可选，TypeScript 提供者总是给；消费端一个段都没有时退回名字那几行（N11）。
    - 证据的范围从函数名来时，就是这些声明段的并集；引用或文字落在任何一段里都算。一个段都没有时退回名字那几行。
    - 不采用 (b) 不改工作区、函数体只给 `range`：行号在上面插一行就错位（§5.2 E-26），代码没坏也读成 `broken`。
  - **落在哪里（lead 2026-10-22 定：要）。**
    - `use`、`emit`、`launch` 落在“从”里；`receive` 落在“到”里；`entry` 落在“到”所属的模块里（“到”是文件时，取它按 L7 归到的模块）；`wire`、`register` 可以在任何地方，例如不归任何模块的组合根。
    - “落在端点里”：端点是文件锚点，就是同一个文件；是模块，`at.path` 按 L7 归到它（并列时，并列里有它就算）；是接口，`at.path` 等于这个接口的某条路径，或在它下面。
    - 不落在 → 退回 `evidence_outside_end`，`evidenceIndexes` 列出全部不合的下标。
  - **“有 key”**：
    - 字面 key：直接扫描已经读进来的这段内容（不算一次 `text` 查询），一行一行找，不跨行，同 `text` 查询的文字规则（F16）。
    - 符号 key：范围里有对它的引用（下一条）。
    - `key: null`：这一项查不了（L3b）。
  - **“引用 X”**：从 X 的定义位置查一次 `references`（F15），结果里有一处落在这条证据的文件和范围里。X 自己的定义那一处不算。只在 TS/JS 上查（F17）。证据文件不是 TS/JS（按扩展名，F24）时，这一部分读作 `unverifiable`（`language_unsupported`），不算“找不到”；字面 key 照旧检查，两件事分开判。
  - **每种关系要的证据**见下表。每种角色至少一条，不许有表外的角色；每条证据自己满足它那一格。
  - 接线分在两处时（例如一处造出实现、一处交给“从”），给包住两处的函数做范围（下面例子的第 1 步）。

| 关系 | 要的角色 | 每条要找到什么 |
| --- | --- | --- |
| `injects` | `use`、`wire` | `use`：引用“经过”。`wire`：引用“到”（实现），也引用“经过”（装实现的槽） |
| `callback` | `wire`、`use` | `wire`：引用“到”（交出去的函数），也引用“经过”（回调的槽）。`use`：引用“经过”，就是“从”在这里调它 |
| `calls`（按名字） | `register`、`use` | `register`：有 key，也引用“到”。`use`：有 key |
| `data` | `emit`、`receive` | 都有 key（路径、表名、内容类型常量）。`emit` 是写的一方，`receive` 是读的一方 |
| `message` | `emit`、`receive` | 都有 key（话题、事件名）。`emit` 是发的一方，`receive` 是收的一方 |
| `spawns` | `launch`、`entry` | 都有 key（程序名）。`entry` 是“到”的入口声明（package.xml、setup.py、CMakeLists.txt），常给整个文件 |

  **例子：平台自己的模型调用授权。** Runtime 每次调模型前，要 WorkGraph 签一张一次性的许可。中间隔着一个适配层，一条联系写不下：第 1 跳的槽是 Runtime 选项里的 `modelCalls`，第 2 跳的槽是 Runtime 依赖里的 `modelRequests`，用的地方和接线的地方各不相同。所以写成两条 `injects` 和一条两步的流程。
  - **前提（C9）：** 捕获要用项目里的 TypeScript 配置（`tsconfig.json` 或 `jsconfig.json`）。没有配置时分析器用 `noLib`（`typescript-source-query.ts:290–292`），经 `Pick` 这类映射类型的引用可能解析不出来；这时第 2 步的引用证据找不到，写时是 `evidence_missing`。施工在本仓库实测这个例子；查不到就报 lead，改例子或查法。`broken` 只用于已经保存的联系，不用于首次写入。

| | 第 1 步 | 第 2 步 |
| --- | --- | --- |
| 从 | `src/core/agent-runtime/observed-model-run.ts`，`runObservedModel`（:177–377） | `src/core/agent-runtime/model-call-access.ts`，`createRuntimeModelCallAccess`（:41–102） |
| 到 | `model-call-access.ts`，`createRuntimeModelCallAccess`（:41） | `src/core/work-graph/tasks/model-call-service.ts`，`createModelCallService`（:84） |
| 经过 | `observed-model-run.ts`，选项的字段 `modelCalls`（:33）。和“从”同一个文件（按 L1 的判重，可以同时当锚点） | `src/core/agent-runtime/execution-contracts.ts`，Runtime 依赖的字段 `modelRequests`（:213） |
| `use` | `observed-model-run.ts`，范围是函数 `runObservedModel`：:245 `o.modelCalls!.beforeCall(...)` | `model-call-access.ts`，范围是函数 `createRuntimeModelCallAccess`：:76 `deps.modelRequests.authorizeModelRequest(...)` |
| `wire` | `src/core/agent-runtime/execution-driver.ts`，范围是函数 `createExecutionDriver`（:303–1092）：:844 造出 `createRuntimeModelCallAccess(...)`，:966 作为 `modelCalls` 交给 `runObservedModel` | `src/composition/create-platform.ts`，范围 1179–1183 行：:1179 `createModelCallService(entryDependencies)`，:1183 作为 `modelRequests` 放进 Runtime 的依赖 |

  - 表里的八个位置 lead 2026-10-22 都核过（✓）。
  - 第 1 步的“到”和第 2 步的“从”是同一个文件，流程没有缺口（`gapsAfter: []`）。
  - 施工时要实测三件事：
    - 类型别名里的字段（`modelCalls`、`modelRequests`）能不能被 `symbols` 查到；
    - 从 `modelRequests` 查引用，能不能查到经 `Pick<…>` 读它的 :76（`model-call-access.ts:18–19`）；
    - 能不能查到 :1183、:966 的简写属性。
  - 查不到就报 lead，改例子或改查法；首次写入按 L3b 退回或记 `evidence_missing`，`broken` 只用于已经保存的联系（C9）。
- **L3b 写入时找证据。**
  - **位置**（F21）：
    - L1 的形状在写入的第一步。
    - 找证据放在锚点一步和第 3 类检查之后（`note-service.ts:1184–1252`）、依据文件之前：先确认路径和锚点合法，再解析三个端。`link` 的符号解析放在这里，锚点一步不为它解析；别的种类照旧在锚点一步解析。
    - 这是第 4 片 L2a 第 3 类之后新增的一道语义闸门，不算第 1、2 类；退回不写任何记录，回执带回草稿（C6）。
    - 重放的写入在闸门之前已经答复（`note-service.ts:1164–1166`），不重找。
  - **步骤：**
    1. 先按 L3a 算每条证据落在哪里（不用捕获），结果留着；退回时按下面的结果表取第一个，`link_end_unresolved` 在 `evidence_outside_end` 之前。同一级的错误按字段顺序取第一个：`anchor`、`extraAnchors[0]`、`extraAnchors[1]`、`link.key`，证据按下标（N3）。
    2. 只有字面 key 和 `range`/整个文件、没有符号或引用要查时，不开捕获，直接按工作树读内容（C5）。否则开一个 `typescript` 捕获，这条联系的查找都用它，用完释放（同第 4 片 L14，`note-anchors.ts:308–382`）。
       - `link` 的“到”“经过”和符号 key 也在这一个捕获里解析（C4）；锚点一步不再为 `link` 开自己的符号捕获。写一条联系最多开这一个捕获；别的种类照旧。
       - 解析出的定位写回存下的锚点：`anchor`、`extraAnchors[0]`、`extraAnchors[1]` 的 `symbol`，和 `key.symbol`；这些就是第 4 片 L14 的 `SymbolLocatorV1`（C4、M2）。三个端和符号 key 的原样请求另存在 `LinkPayloadV1.ends`、`key.symbolRequest`（N1）。
       - 写时把这次捕获的 `coverage.projectConfiguration` 存进 `analysisConfig.path`，配置内容在捕获里的 `decoded_utf8` 摘要存进 `analysisConfig.digest`；没用捕获、没有配置时两个都是 `null`，这条联系没有配置门（C3、D1）。
       - 每个文件一次 `symbols`：证据最多 8 个文件，加“到”“经过”和 key 最多 3 个；
       - 每个要引用的定义一次 `references`，最多 3 个；证据文件不是 TS/JS 时，这一条不用为它查引用（直接记 `language_unsupported`）；
       - 字面 key 只扫已经读进来的内容，不另发 `text` 查询（C5）；
       - 一共最多 14 种查询，在一个捕获的 16 种以内（F19）。
    3. 证据的 `symbolRequest` 照第 4 片 L14 解析，语言按路径的扩展名定（F24，C7）：结果先记下，按下面的表取第一个。多个命中记 `symbol_ambiguous`，带候选；TS/JS 里没有命中记这条证据找不到；扩展名不是 TS/JS 的已经在 L1 退回（K2），这里不再把 `symbolRequest` 放宽成整个文件。三个端和符号 key 在同一次捕获里解析（M2）：规则需要的端（L1）和符号 key 确定没有命中才是 `link_end_unresolved`，别的端没有命中只给警告 `symbol_unresolved`，存普通文件锚点（N3）。
    4. 读每个证据文件：TS/JS 的从同一个捕获读（同 `note-anchors.ts:364–366`），别的按工作树读。捕获里没有这个文件而工作树有 → 按结果表的 `source_stale`（N5）；两处都没有、`range` 超出文件 → 这条找不到。
       - **摘要和内容同源（C2）。** 核对的材料和存下的摘要要来自同一份内容。捕获里的内容口径是 `decoded_utf8`，工作树读的摘要是 `raw_bytes`（`ports.ts:39–41`）；两者不直接比摘要，先比解码后的文字。另读工作树取摘要时，如果内容和捕获里的这份不同，就是 `source_stale`：这次不核，`fileDigest` 记 `null`，写时记 `analyzer_unavailable`，读时记 `unchecked`（`unavailable`）。
       - 内容一致时，存工作树读的 `raw_bytes` 摘要；工作树读不了时 `fileDigest` 记 `null`，读证据文件报 `forbidden` 的按结果表退回（M1）。
    5. 落在端点里的证据，在范围里按 L3a 的表找；不落的不找，按结果表退回。
  - **存下没解析成功的请求（C1）。** 分析器这次不可用时，证据的 `at`、三个端的 `ends`、符号 key 的 `symbolRequest` 都保留原始选择器（`symbolRequest` 或 `range`；都不给就是整个文件），解析结果留空；不把请求扩大成整个文件。`fileDigest` 没读到就是 `null`。读时 `fileDigest` 为 `null` 或端/key 没有定位的一律重试；重试成功按结果给 `verified`/`broken`，仍因分析器不可用而失败读作 `unverifiable`（`analyzer_unavailable`）；预算用尽、C2 的内容不一致和文件读取失败另按结果表（N4）。
  - **结果**（先一条一条判，再按下面这张表取第一个）：
    - 一条证据的“有 key”和“引用 X”分开判：字面 key 找不到 → 这条证据找不到（进 `evidence_missing`）；引用部分在非 TS/JS 的文件里查不了 → 记 `language_unsupported`，不算找不到。
    - 查不了的项不挡能查的项。例如 `calls` 给 `key: null`：`register` 还要引用“到”，找不到照样退回。

    | 顺序 | 写时的结果 | 说明 |
    | --- | --- | --- |
    | 1 | L1 的形状错 | `link_*`、`evidence_*`、`payload_kind_mismatch` 等；在第一步 |
    | 2 | 锚点第 1–3 类 | 形状、路径、存在、搭配 |
    | 3 | 三个端和符号 key：多个命中 `symbol_ambiguous`；规则需要的端或符号 key 确定没有命中 `link_end_unresolved`；别的端没有命中只警告 `symbol_unresolved` | 按字段顺序取第一个（N3）；`reason` 写字段路径（C12） |
    | 4 | `evidence_outside_end` | `evidenceIndexes` 列出全部不合的下标 |
    | 5 | 证据的 `symbol_ambiguous` | 多个命中，带候选；`reason` 写 `symbol_ambiguous: link.evidence[i].at.symbolRequest`（C12） |
    | 6 | `evidence_missing` | 确定找不到；`evidenceIndexes` 列出全部下标 |
    | 7 | `unverifiable` | 查不了，照收；`warnings` 加一次 `evidence_unverifiable` |

    - 原因按这个先后取第一个：`key_not_literal`（给了 `key: null`，名字是运行时拼的，F25 的 Django）；`language_unsupported`（要查的符号或引用在 TS/JS 以外的文件里，F17）；`analyzer_unavailable`（捕获、查询或读文件失败，或者工作树和捕获的内容对不上，C2；读证据文件报 `forbidden` 除外，见 M1）。这里和第 4 片 L14 不同，不退回整个写入：联系可用，读的时候再试（L3d）。
    - **工作区结果怎么算（C6、N5）。** 按操作分开。查询的 `ready` 只表示这一页取到了；`complete: false` 只表示还有下一页（`source-query.ts:198–202`），不是失败。有 `nextCursor` 就接着取下一页、累计命中，同第 4 片的符号解析（`note-anchors.ts:330–350`），最多取到 `NOTE_SYMBOL_HITS_MAX`（200，`note-contracts.ts:28`）条命中。下表的“取完”指 `nextCursor` 为 `null`；到上限还有下一页才算查不全：

    | 操作 | 结果 | 写时 | 读时 |
    | --- | --- | --- | --- |
    | 工作树读取 | `ready` | 读到内容，继续 | 读到内容，继续 |
    | 工作树读取 | `not_found` | 文件不在 → 这条证据找不到 | 文件不在 → 这条确定找不到（`broken`） |
    | 工作树读取 | `forbidden` | 退回：`evidence_invalid: link.evidence[i].at.path`（M1） | `unchecked`（`unavailable`） |
    | 工作树读取 | `unsupported`、`capacity`、`unavailable`、`source_stale`、`cancelled` | 查不了 → `analyzer_unavailable` | `unchecked`（`unavailable`） |
    | 工作树读取 | `invalid` | 查不了 → `analyzer_unavailable` | `unchecked`（`unavailable`） |
    | 捕获读取 | `ready` | 读到内容，继续 | 读到内容，继续 |
    | 捕获读取 | `not_found`（捕获里没有这个文件） | 工作树有 → `source_stale`，按查不了；工作树也没有 → 确定找不到 | 工作树有 → `unchecked`（`unavailable`）；工作树也没有 → 确定找不到（`broken`） |
    | 捕获读取 | `forbidden` | 退回：`evidence_invalid: link.evidence[i].at.path`（M1） | `unchecked`（`unavailable`） |
    | 捕获读取 | `unsupported`、`capacity`、`unavailable`、`cancelled`、`invalid`、`capture_expired`（`workspace-read.ts:78`、`capture.ts:566`） | 查不了 → `analyzer_unavailable` | `unchecked`（`unavailable`） |
    | 符号查询 | 取完、一个命中 | 用这个命中 | 用这个命中 |
    | 符号查询 | 取完、多个命中 | `symbol_ambiguous` | 用存下的范围挑；挑不出 → `unchecked`（`unavailable`） |
    | 符号查询 | 取完、没有命中 | 规则需要的端或符号 key → `link_end_unresolved`；别的端 → 警告 `symbol_unresolved`；证据自己的 `symbolRequest` → 这条证据找不到（`evidence_missing`） | 已有定位的端，不论是不是规则需要的 → 这一槽 `retired`（`symbol_missing`），同第 4 片 L23；只有要引用它的证据并进 `broken`。符号 key 的定义没了 → 要引用它的证据 `broken`。从没定位过的非必需端 → 仍只警告 `symbol_unresolved`。证据自己的 `symbolRequest` → 这条证据确定找不到 |
    | 符号查询、引用查询 | 取到命中上限还有 `nextCursor`（没取完） | 查不全 → `analyzer_unavailable` | `unchecked`（`unavailable`） |
    | 符号查询、引用查询 | `rejected` 的 `forbidden` | 退回：`evidence_invalid: link.evidence[i].at.path`（M1） | `unchecked`（`unavailable`） |
    | 符号查询、引用查询 | 其余 `rejected`（`capacity`、`unavailable`、`source_stale`、`capture_expired`、`cancelled`、`unsupported`、`invalid`、`cursor_mismatch`） | 查不了 → `analyzer_unavailable` | `unchecked`（`unavailable`；预算用尽是 `budget`） |
    | 引用查询 | 取完、范围里有命中 | 找到 | 找到 |
    | 引用查询 | 取完、范围里没有命中 | 这条证据找不到 | 确定找不到（`broken`） |
    | 读时（C1 的例外） | 从没解析成功的请求，重试仍因分析器不可用而失败 | — | `unverifiable`（`analyzer_unavailable`），不变成 `unchecked`（N4） |

    - 读证据文件或查询证据时 `forbidden`，写入一律退回 `evidence_invalid: link.evidence[i].at.path`（M1）。
    - **C1 的例外（N4）。** 存下的请求从没解析成功（`fileDigest` 是 `null`，或端/key 没有定位）的，读时重试；重试仍因分析器不可用而失败，读作 `unverifiable`（`analyzer_unavailable`），不按读时列变成 `unchecked`。预算用尽是 `unchecked`（`budget`）；C2 的内容不一致和文件读取失败是 `unchecked`（`unavailable`）。确定缺失始终先判。

  - **Python、C++ 的引用（lead 2026-10-22 定）。**
    - 读作 `unverifiable`（`language_unsupported`）；字面的核对照做；等分析器接进 `querySource` 再查引用。
    - 不采用：退成“范围里有这个名字的文字”，同名的注释、字符串和别的变量都会算进去，`verified` 就不可信了。
- **L3c 读出来的核对结果。**
  - 每条联系带 `verification`，和第 4 片的 `freshness` 并列，不替换它：
    - `verified`：证据都还找得到；
    - `broken`：`missing` 列出确定找不到的下标；
    - `unverifiable`：查不了，带原因（L3b）；
    - `unchecked`（lead 2026-10-22 定）：这次没核，带原因（预算用完，或文件、分析器这次读不了）。
  - 比摘要的“需复查”细：摘要只说文件变了，核对说指定的引用和文字还在不在、哪一条断了。依据文件的新鲜度照第 4 片 L11 算，不变。
  - **读时的优先级（C6、N4）：** 先看有没有确定找不到。至少一条确定找不到 → `broken`，`missing` 列出全部确定的下标；没有确定找不到、但有读不了或超预算的 → `unchecked`；都没有、但有 `language_unsupported` 等 → `unverifiable`；都找到 → `verified`。确定缺失压过查不了。从没解析成功的请求重试仍因分析器不可用而失败的那一条是 `unverifiable`，不并进 `unchecked`；读时同名多个候选、存下的行挑不出一个的那一条是 `unchecked`（`unavailable`），不是 `broken`（N3、N4）。
  - **状态现行和现行结论分开（C14）。**
    - “状态现行”只看存下的状态：`accepted`、`reviewed`（L2 的写入规则）。
    - “现行结论”由 `currentEligible` 表示：状态现行、`freshness` 是 `fresh`、不冲突、来源可用、三端都不 `retired`、各端自己的读时核对没有 stale（签名摘要变了算 stale，M2；各端自己的状态，N2、C12），并且证据不是 `broken`、`unchecked`。
    - `broken`、`unchecked` 不构成现行结论（`currentEligible` 为假），同第 4 片 L9 对 `stale`、`unchecked` 的做法；`unverifiable` 照常算，它是查不了，不是不对。
    - `broken` 进书记的 `stale` 读，原因 `link_evidence_broken`，带下标（L12）；执行输入里的行照 L10、L13。
    - 流程的每一步也用这一份派生；一次调用里步骤的联系去重，共用重核预算和可见性规则（L9，C14）。
- **L3d 代码改了以后重核（lead 2026-10-22 定）。** 选 (a)：读时按摘要重核；已有同样的做法和预算，不加记录和触发。
  - **门（C3、D1、M2）：** 证据文件存下的 `fileDigest`；“到”“经过”和符号 key 的 `SymbolLocatorV1.fileDigest`；写时存下的 `analysisConfig` 的路径和摘要。
    - **配置门不为判门开捕获。** 读时在工作树上按捕获的默认选择规则找配置：先 `tsconfig.json`，再 `jsconfig.json`（`typescript-source-query.ts:99–100`；写时的捕获不传显式配置路径，`note-anchors.ts:317`）。读它的文字，按 `decoded_utf8` 的口径算摘要（`ports.ts:96–97`）。路径或摘要和存下的不同，都算门变了；门变了才开重核捕获。
    - 写时的摘要取捕获里这份配置的文字，读时取工作树读出的文字，两边都按解码后的文字算。两边解码有出入时，只会多判一次“变了”、多开一个捕获，不会漏判。
    - 没用捕获、没有配置门（两个都是 `null`）时不比配置。
    - 门的读取（证据文件、端和 key 的定义文件、最多两个配置文件）都算进和第 4 片的观测共用的一次调用 256 个文件的预算（F22），没有不计预算的捕获。
  - 都没变 → 用存下的结果。证据文件删了 → 那条找不到，不开捕获。有变 → 照 L3b 在当前工作树上重找一遍；证据的符号按名字重新解析，同名多个时用存下的行挑（同 F22）；找不到不退回，读作 `broken`。端点和符号 key 的重新解析照第 4 片 L23：按 `qualifiedName` 重解，同名多个用存下的行挑，挑不出 → `unchecked`（`unavailable`）；找不到 → 端 `retired`（`symbol_missing`），需要它的证据 `broken`（M2、N3）。
  - 要引用的“到”“经过”或符号 key 的定义找不到了 → 要引用它的证据都算找不到（锚点另按第 4 片 L23 读作 `retired`，§5.2 E-15）。
  - 存下的是 `unverifiable`（`analyzer_unavailable`）的，文件没变也重找；从没解析成功的请求（C1）重试仍因分析器不可用而失败时读作 `unverifiable`（`analyzer_unavailable`）；预算用尽 → `unchecked`（`budget`）；C2 的内容不一致和文件读取失败 → `unchecked`（`unavailable`）（N4）。`fileDigest` 是 `null` 的也一律重找。
  - 只有字面 key 和 `range`/整个文件的联系，重核直接读工作树，不开捕获（C5）。
  - 预算：一次调用最多重核 `NOTE_LINK_RECHECK_MAX = 10` 条（初值没实测，可注入），按结果的顺序；超了 → `unchecked`（`budget`）。按 N9，流程读里按流程结果顺序、步骤顺序，第一次遇到一条联系时消耗。
  - 结果不存，每次读时算，同新鲜度。
  - 先例：读时的符号重解析就是这样，按摘要、有预算、超了记未核对（F22）。
  - 代价：一次重核开一个 TS 捕获（要分析整个项目的 import）和最多 14 种查询；路由一页 100 条，最多 10 个捕获。一次读的总捕获数：第 4 片最多 20 次符号重解析，加最多 `NOTE_LINK_RECHECK_MAX` 条联系重核，每条最多一个捕获（C4）。写工具写完之后自己那次核对（`note-tool.ts:210`、`:221`）也是一次读，同样付这笔。好处：没有新记录；门里的文件改了，下一次读就看得到（C3）。
  - 不采用 (b) L8 的自动抓之后重核、存结果：一种新记录（编解码、索引、`module-target.json`）和一个新写口；照第 8 片 §13 要租约和“启动时自动续做”；一次触发可能要重核很多条，要另定上限；读便宜，但会滞后，执行中途的改动、你在平台外的改动要等下一个触发。
  - 以后读慢了，可以加 (c) 当全部重核的按钮，用同一个核对函数。
- **L3e 静态核对做不到的**（写进工具说明和平台 Skill）：
  - **哪条分支真的跑、配置装的是哪个实现。** `if` 两边各接一个实现，两条联系都会 `verified`。静态核对只证明指定的引用和文字在指定的范围里共现，不证明接线。
  - **共现的假阳性。** 把 K1 的 `wire` 写成 `{ beforeCall: other, unused: authorize }`，同一个范围仍同时包含槽和实现的引用，按表照样 `verified`，实际没有把该实现装进槽（C10）。
  - **重核的门的边界（C3）。** 门只看证据文件、三个端的定义文件和符号 key 的定义文件，加项目 TypeScript 配置文件。转导出文件、配置外的路径别名等改了，引用可能已经变了，但门里的文件都没变，重核还是 `verified`，直到门里的某个文件变了。这是“共现”而不是“接线”的边界。
  - **运行时拼出来的名字。** 只能给 `key: null`，读作 `unverifiable`。8D 实测 Django 的 `django/` 里，importlib 43 处、`import_string` 41 处，名字都不是字面量（F25）。
  - **多发多收的话题**（ROS 等）。两边写了同一个话题名，只证明它们用这个名字；哪几对真的一起跑，要看 launch 的命名空间和重映射。8D 在 ros2/demos 上量到 117 对按名字通信的文件，其中 114 对在依赖图上毫无关系（F25）。
  - **范围是整个文件时**，import 那一行也算引用，只能证明“这个文件用到了”。
  - **TS 分析器不认的引用**：`any`、按字符串取属性、反射都不算引用；这时改用字面 key。只有收 key 的关系（`calls`、`data`、`message`、`spawns`）能这样做；`injects`、`callback` 按 L1 不给 key。
  - **行号范围**在上面插一行就会错位；能给函数名就给函数名（L3a）。
- **L4 取代和同话题。**
  - `link` 只能取代 `link`，`flow` 只能取代 `flow`，否则退回 `replaces_kind_mismatch`。`sameKindFamily` 改成按家族判断：一般；`understanding` 和 `repair`（今天的规则不动）；`link`；`flow`。
  - 同话题规则照第 4 片 L4.4：同一锚点上，同话题的现行注记要声明取代、矛盾或并存。
- **L5 额度**（初值没实测，都可注入）：
  - 每个锚点键上现行的 `link`（`accepted`、`reviewed`）最多 `NOTE_ANCHOR_LINK_QUOTA = 30`。
  - 每个目标里 `link` 加 `flow`（四个计数状态）最多 `NOTE_GOAL_LINK_QUOTA = 300`；它们不再算进 `NOTE_GOAL_QUOTA = 200`。
  - 项目里现行的 `flow` 最多 `NOTE_PROJECT_FLOW_QUOTA = 100`。这是软额度，人的写入和后续收下可以超过，不拿它当整表扫描的界；L9 的项目流程列表用 T6 的索引分页，一次调用有候选上限和续读位置（C16）。
  - 满了的处理同第 4 片 L7：不拒绝，进 `pending_review`（`quota_full`），交书记；你的写入不为额度挡。
- **L6 可见。** 照第 4 片 §11.3（F7）：别的目标写的，书记审过或你确认过才默认可见。Host 路由给人看，不分目标；每个范围都返回 `accepted`、`reviewed`、`pending_review` 三个可见状态，每条带状态（C16）。
- **L7 归到模块**（按当前采用的目录，不按观测图猜）：
  - 模块锚点就是它自己，接口锚点归它的模块；
  - 文件锚点用 `pathOwnershipOf`（F9）：并列 → `moduleId: null`、`ambiguous`；不归任何模块 → `moduleId: null`、`not_owned`；
  - 没有采用的目录时，`catalogRevision: null`，所有文件端都是 `not_owned`。
- **L8 读联系层**（`readSemanticLinks`）：
  - **范围**：
    - `project`：用 T6 的索引，读种类 `link`、三个状态；
    - `module`：用这个模块的锚点键，即模块、它的接口、它路径下的文件（复用 F12 的函数，不含 `project`）；
    - `file`：用这个文件的键。
  - **排序和分页**：按 `noteId` 排序；`cursor` 绑定请求和范围；`limit` 1–100。
  - **核对**：一页只核对一次；重核按 L3d。每条带第 4 片的 `freshness`、三端各自的 `anchorStatus` 和 `anchorRetiredReasons`，以及证据的核对结果（L3c）、`currentEligible`（C12）。三端的状态从同一次核对的按槽位结果来（N2）：主端用第一个槽位，附加端按 `extraAnchors` 的顺序用后面的槽位；`retiredExtraAnchors` 只是兼容投影，不再用来还原端的状态。原因按这个槽位能判出的给，判不出时是空数组（不编造；已知的原因如 `symbol_missing` 一定传出来）。端点身份从存下的请求算（N1），不看解析是否成功。
- **L9 读流程**（`readSemanticFlows`）：
  - **范围**：`project` 用 T6 的索引，返回三个可见状态，一页最多核对 `NOTE_FLOW_CANDIDATE_MAX = 500` 个候选（初值没实测，可注入），没走完给 `cursor`（C16）。
  - `module`、`file`：先取范围里的联系（不先按现行状态过滤；范围索引里保留被取代、撤下的头），再在项目的流程里找引用了这些联系的（C15）。归属判完以后才把不再现行的步骤标 `not_current`。
  - **排序和分页**：按 `noteId` 排序；`cursor` 绑定请求和范围；`limit` 1–50（N9，同 L8）。
  - **展开**：每步展开成 `SemanticLinkV1`；问题按这个先后取第一个（C14、N6）：
    1. 步骤的联系状态不是 `accepted`/`reviewed` → `item: null`、`not_current`；
    2. 证据 `broken` → `broken`（保留 `item`）；
    3. 需复查（`freshness: 'stale'`）、任一端 `retired`、`conflicting`、`sourceUnavailable` → `stale`（保留 `item`）；
    4. 新鲜度或证据 `unchecked` → `unchecked`；
    5. 都没有 → `null`。
  - **流程自己的核对**（依据文件、来源、冲突）和步骤的问题一起给流程的结果（N6）：有一步是 `not_current`、`broken` 或 `stale`，或流程自己是 `stale` → `stale`；上面都不适用，但有一步是 `unchecked` 或流程自己没核 → `unchecked`；否则 `fresh`。只有流程自己的检查通过（状态现行、`fresh`、不冲突、来源可用、锚点不 `retired`）、并且每一步的 `currentEligible` 都为真，流程的 `currentEligible` 才是真；不另按 freshness 推。
  - 这一份派生同时供 Host 路由、`lookup`/`find` 和书记的 `stale` 读用；一次调用里步骤的联系去重，共用重核预算和可见性规则；重核预算按流程结果顺序、步骤顺序，第一次遇到一条联系时消耗（C14、N9）。
  - `gapsAfter` 按端点身份比第 i 步的“到”和第 i+1 步的“从”（N1、C13），只是提示。
- **L10 执行输入**（T8）：
  - 收哪些：“注记”一段收 `link` 行，选法照第 4 片 §11.4 和 L20（有联系的范围、默认可见、按类别、层级、话题排序），和一般注记共用这一段的预算。
  - 怎么显示：行文字用 L13 的格式。只有 `currentEligible` 出结论行。不构成现行结论时按原因出行（第 4 片 L20 的警示行）：
    - 证据 `broken` → 一行 `note.warning.link_broken`（L13）；
    - 否则 `freshness: 'stale'`、`conflicting`、`sourceUnavailable` 各出一行；
    - 只有“证据 `unchecked` 是唯一原因”时才完全不出行；它同时有 `stale`、`conflicting` 或 `sourceUnavailable` 时仍出那一行；同时有 `broken` 时只出 `broken` 那一行（C18）。
    - 代码见 `note-read-model.ts:2044–2057`；结论行和警示行不拆开。
  - `flow` 不进。查询的输入今天不收一般注记行（`agent-runtime/context-query-recipe.ts:91` 只记来源），联系也不收。
- **L11 agent 的工具：**
  - `record_note` 的 `write` 收 `link`、`flow` 两个种类和字段；
  - `find_graph` 记忆分支的 `kind` 过滤加 `link`、`flow`；
  - `lookup`、`find` 的结果项带 `link` 或 `flow` 字段；`link.verification` 是读时的结果（L3c）。
  - **工具说明和平台 Skill**（work、adviser、scribe、secretary）加一段，写清什么时候记、怎么记：
    - 发现静态引用看不到的调用、注入、回调、消息、起进程时，记一条联系；
    - 按 L3a 的表给证据：TS/JS 给函数名，别的语言给行号范围或整个文件；证据的 `symbolRequest` 只能用在 TS/JS 文件上；
    - 名字是运行时拼的，给 `key: null`；只有收 key 的关系能改用字面 key；
    - 回执是 `evidence_missing` 时，按 `evidenceIndexes` 改那几条再写；
    - 读懂一条业务流程时，先记各步的联系，再记流程；
    - 两头尽量给到函数；
    - L3e 的几条限制，特别是：核对只证明指定的引用和文字在指定范围里共现，不证明接线。
- **L12 书记。** 联系和流程照第 4 片进 `stale` 读；证据 `broken` 的也进，原因 `link_evidence_broken`（L3c）。Host、`lookup`/`find` 和这里的 `stale` 读共用 L3c/L9 的同一份派生（C14）。书记合并重复、标过时、重写流程，不加新的触发。
- **L13 显示：**
  - `renderNoteHeader` 加两种格式：
    - 联系：`<类名>·<关系名>(<从的显示>→<到的显示>)：<结论>`；
    - 流程：`<类名>(<第一步的从的显示>)：<结论>`。
  - `renderNoteHeader` 的调用点（`note-views.ts:1060` 等）要给联系行多传关系和“到”那一端，给流程行传第一步的“从”（C19）；只传四个字段的调用点要一起改。
  - 显示映射是完整的 `Record<NoteKind, string>`（`contracts/note.ts:112`）：第一段给 `link` 补一项，第二段给 `flow` 补一项，否则编译不过（N11）。
  - 平台包加字符串：类名“联系”“流程”；关系名“调用”“注入”“回调”“数据”“消息”“起进程”；警告“证据对不上”（`note.warning.link_broken`）。平台包版本加一。

## 5. 测试（TDD，测试由 DSH 一条一条写）

### 5.1 测试入口（用户 2026-10-22 确认）

- **E1** agent 经 `record_note`（执行者、参谋、书记的执行）写联系和流程，再从公开读法读回。找证据经真实的工作区端口（TS 捕获和源码查询），做法同第 4 片的 `S4A-note-symbol`。
- **E2** 你经 `notes/write` 写。
- **E3** Host 路由 `architecture/semantic-links`、`architecture/semantic-flows`。
- **E4** 工作执行的输入（“注记”一段），经第 3 片的准备入口。
- **E5** 记忆的 `lookup`、`find`（agent 的工具）。
- 少量纯函数：L1 的形状检查、L3a 的角色表和“合起来”的规则、L7 的归到模块。
- 数捕获次数（E-31、E-32、E-46）用包在真实工作区端口外面的计数，同第 8 片 §13 的做法；只数联系重核开的捕获，不读库核对。
- E-15、E-25 的端状态和 `currentEligible` 分别经 E3 的路由、E5 的 `stale`、E4 的执行输入断言（C12）。
- 以上 E1–E5、少量纯函数和数捕获次数，用户 2026-10-22 确认。

### 5.2 验收行为

手算的世界（行号从 1 数）：
- 目录里的模块：`runtime`（路径 `src/runtime`）、`wg`（`src/wg`）、`contracts`（`src/contracts`）、`robot`（`src/robot`）、`launch`（`launch`）。
- `src/compose.ts`、`src/wire2.ts`、`config/handlers.json` 不归任何模块。
- 文件（`bus.ts` 只给 E-33 用，`wire2.ts` 只给 E-31、E-33 用；`handlers.json` 只给 E-35 用）：

```text
src/contracts/access.ts
  1  export interface Access {
  2    beforeCall(id: string): Promise<void>;
  3  }
src/contracts/hooks.ts
  1  export interface Hooks {
  2    onSelected(id: string): void;
  3  }
src/runtime/run.ts
  1  import type { Access } from '../contracts/access.js';
  2  import { handlers } from '../wg/registry.js';
  3  export async function runModel(access: Access, id: string) {
  4    await access.beforeCall(id);
  5  }
  6  export function dispatch(id: string) {
  7    handlers.get('wg.audit')?.(id);
  8  }
  9  export function saveReport(write: (path: string, text: string) => void) {
 10    write('reports/latest.json', '{}');
 11  }
src/runtime/kernel.ts
  1  import type { Hooks } from '../contracts/hooks.js';
  2  export function select(hooks: Hooks, id: string) {
  3    hooks.onSelected(id);
  4  }
src/runtime/bus.ts
  1  export class Bus {
  2    onSelected: (id: string) => void = () => {};
  3    select(id: string) { this.onSelected(id); }
  4  }
src/wg/permit.ts
  1  export async function authorize(id: string): Promise<void> {
  2    if (id === '') throw new Error('empty');
  3  }
  4  export function onPicked(id: string) {}
  5  export function loadReport(read: (path: string) => string) {
  6    return read('reports/latest.json');
  7  }
src/wg/registry.ts
  1  export const handlers = new Map<string, (id: string) => void>();
src/wg/audit.ts
  1  export function audit(id: string) {}
src/wg/dual.ts
  1  export class First {
  2    authorize(): void {}
  3  }
  4  export class Second {
  5    authorize(): void {}
  6  }
src/wg/overload.ts
  1  export function pick(id: string): string;
  2  export function pick(id: number): string;
  3  export function pick(id: string | number): string {
  4    return String(id) + 'overload-key';
  5  }
src/wg/overload_use.ts
  1  export function runPicked(id: string) {
  2    return id + 'overload-key';
  3  }
src/compose.ts
  1  import { runModel } from './runtime/run.js';
  2  import { authorize, onPicked } from './wg/permit.js';
  3  import { handlers } from './wg/registry.js';
  4  import { audit } from './wg/audit.js';
  5  import type { Access } from './contracts/access.js';
  6  import type { Hooks } from './contracts/hooks.js';
  7  const access: Access = { beforeCall: authorize };
  8  export const hooks: Hooks = { onSelected: onPicked };
  9  handlers.set('wg.audit', audit);
 10  export const start = (id: string) => runModel(access, id);
src/wire2.ts
  1  import { Bus } from './runtime/bus.js';
  2  import { onPicked } from './wg/permit.js';
  3  const bus = new Bus(); bus.onSelected = bus.select;
config/handlers.json
  1  {"wg.audit": "src/wg/audit.ts#audit"}
src/robot/teleop.py
  1  def start(node):
  2      node.create_publisher(Twist, '/cmd_vel', 10)
src/robot/drive.py
  1  def main(node):
  2      node.create_subscription(Twist, '/cmd_vel', on_twist, 10)
src/robot/ports.py
  1  class Publisher:
  2      pass
src/robot/setup.py
  1  entry_points = {'console_scripts': ['drive_node = robot.drive:main']}
launch/bringup.launch.py
  1  Node(package='robot', executable='drive_node')
```

- 七条联系。文件名省了目录；“函数 X”是 `symbolRequest`，按 lead 2026-10-22 的决定算（从函数名取这个导航项的全部声明段；括号里的行号只作说明）：

| 名 | 关系 | 从 → 到（经过） | key | 证据 |
| --- | --- | --- | --- | --- |
| K1 | `injects` | `run.ts` 函数 `runModel` → `permit.ts` 函数 `authorize`（经过 `access.ts` 的 `beforeCall`） | 不给 | [0] `use`：`run.ts` 函数 `runModel`（3–5）；[1] `wire`：`compose.ts` 第 7 行 |
| K2 | `callback` | `kernel.ts` 函数 `select` → `permit.ts` 函数 `onPicked`（经过 `hooks.ts` 的 `onSelected`） | 不给 | [0] `wire`：`compose.ts` 第 8 行；[1] `use`：`kernel.ts` 函数 `select`（2–4） |
| K3 | `calls` | `run.ts` 函数 `dispatch` → `audit.ts` 函数 `audit` | `'wg.audit'` | [0] `register`：`compose.ts` 第 9 行；[1] `use`：`run.ts` 函数 `dispatch`（6–8） |
| K4 | `data` | `run.ts` 函数 `saveReport` → `permit.ts` 函数 `loadReport` | `'reports/latest.json'` | [0] `emit`：`run.ts` 函数 `saveReport`（9–11）；[1] `receive`：`permit.ts` 函数 `loadReport`（5–7） |
| K5 | `message` | `teleop.py` → `drive.py`（文件锚点，不带符号） | `'/cmd_vel'` | [0] `emit`：`teleop.py` 第 2 行；[1] `receive`：`drive.py` 第 2 行 |
| K6 | `spawns` | `launch/bringup.launch.py` → 模块 `robot` | `'drive_node'` | [0] `launch`：`bringup.launch.py` 整个文件；[1] `entry`：`src/robot/setup.py` 整个文件 |
| K7 | `data` | `overload.ts` 函数 `pick` → `overload_use.ts` 函数 `runPicked` | `'overload-key'` | [0] `emit`：`overload.ts` 函数 `pick`（导航项的三个声明段 :1、:2、:3–5）；[1] `receive`：`overload_use.ts` 函数 `runPicked`（1–3）。重载夹具用两个签名加一个实现，就这一条联系用它 |

| # | 做什么 | 期望 |
| --- | --- | --- |
| E-01 | 写 K1 | `accepted`，`verified`，`currentEligible: true`；路由读出 `relation: 'injects'`，三端 `moduleId` 依次是 `runtime`、`wg`、`contracts`，三个符号都有定位，三端 `anchorStatus` 都是 `live` |
| E-02 | K1 的“到”改成 `dual.ts` 的 `authorize`（`dual.ts` 里两个类各有一个同名方法，:2 和 :5） | `invalid`、`symbol_ambiguous`，两个候选 `{ name: 'authorize', range: { startLine: 2, endLine: 2 } }`、`{ name: 'authorize', range: { startLine: 5, endLine: 5 } }` |
| E-03 | `extraAnchors` 给 0 个或 3 个；K1 只给 1 个（没有“经过”） | 都是 `invalid`、`link_anchor_count` |
| E-04 | K1 的“经过”给模块 `contracts`；K1 的“到”给模块 `wg` | 都是 `invalid`、`link_anchor_kind` |
| E-05 | `evidence` 给 0 条或 9 条；K1 不给 `basisFiles` | 前两个 `invalid`、`evidence_count`；K1 照收，同 E-01 |
| E-06 | `structural: true` | `invalid`、`structural_not_allowed` |
| E-07 | 一般种类带 `link` 字段；`link` 不带 `link` 字段 | 都是 `invalid`、`payload_kind_mismatch` |
| E-08 | 同一锚点上 4 条现行一般注记、30 条现行联系：先写第 31 条联系，再写第 5 条一般注记。另一种情形（同一个锚点）：5 条现行一般注记、29 条现行联系，写第 30 条联系 | 第 31 条联系 `pending_review`（`quota_full`）；第 5 条一般注记 `accepted`；第 30 条联系 `accepted`。两种额度互不影响；“每个锚点 5 条”指已有 5 条时第 6 条才满 |
| E-09 | 一个目标里已有 200 条一般注记，再写联系 | 联系 `accepted`（不算进 200）；第 301 条联系或流程 `quota_full` |
| E-10 | 联系取代一般注记；联系取代联系 | 前者 `replaces_kind_mismatch`；后者 `accepted`，旧的 `superseded` |
| E-11 | 写 3 步流程；之后第 2 步的联系被取代 | 写入 `accepted`；读出步骤顺序不变，第 2 步 `item: null`、`not_current`，整条 `stale` |
| E-12 | 步骤引用一般注记 / 同一联系两次 / 1 步或 21 步 / `anchor` 不是第一步的“从” | 依次是 `flow_step_not_link`、`flow_step_duplicate`、`flow_step_count`、`flow_anchor_mismatch` |
| E-13 | 两步：A→B、C→D | `gapsAfter: [1]` |
| E-14 | 只写了 K1 时按模块 `runtime` 读；再写一条从 `src/compose.ts` 出发的 `calls`（到 `audit.ts` 函数 `audit`，key `'wg.audit'`，两条证据都是 `compose.ts` 第 9 行）；目录里两个模块并列认领同一文件时再读 | `runtime` 读到 K1；`src/compose.ts` 那一端 `not_owned`；并列的那一端 `ambiguous` |
| E-15 | K1 写时给 `basisFiles: ['src/compose.ts']`。之后改 `compose.ts` 第 10 行；再删掉 `permit.ts` 里的 `authorize` | 前者 `freshness: 'stale'`，证据重核仍 `verified`（第 7 行没动），三端仍 `live`；后者“到”按第 4 片 L23 重解，`anchorStatus: 'retired'`、`anchorRetiredReasons: ['symbol_missing']`（M2），“从”“经过”`live`，证据 `broken`、`missing: [1]`，`currentEligible: false`，出现在书记的 `stale` 读里。断言入口：E1 写，E3 读路由的端状态，E5 读书记的 `stale` 读（C12、N2） |
| E-16 | 目标 g1 的 agent 写联系，目标 g2 的 agent 去读；书记审过以后再读；Host 路由读 | g2 默认看不到；审过以后看得到；Host 一直看得到，三个可见状态都返回，并带状态（C16） |
| E-17 | g1 的执行在 `src/runtime/run.ts` 上干活 | 输入的“注记”一段有 K1 的行，文字按 L13 的格式（期望值写任务书时按平台包字符串手写）；流程不出现 |
| E-18 | `find` 的 `kind: 'link'`；`kind: 'general'` | 前者只回联系；后者不含联系 |
| E-19a | 项目里 3 条联系，经 `architecture/semantic-links` 读，`limit: 2` | 第一段：第一页 2 条、带 `next`，第二页 1 条、`next: null`；用别的范围带这个 `cursor` → `invalid`（C16、N11） |
| E-19b | 项目里 3 条流程，经 `architecture/semantic-flows` 读，`limit: 2` | 第二段：第一页 2 条、带 `next`，第二页 1 条、`next: null`；用别的范围带这个 `cursor` → `invalid`（C16、N11） |
| E-20 | `lookup` 读“到”那一端的锚点 | 结果里有 K1，带 `link.relation` 和 `link.verification` |
| E-21 | 写 K2、K3、K4、K5、K6、K7 | 都 `accepted`、`verified`；K5 两头没有符号定位；K6 的“从”`moduleId: 'launch'`，“到”是 `robot`；K7 的 [0] 范围是 `pick` 的三个声明段 :1、:2、:3–5，字面 `'overload-key'` 在 :4，落在第三段里（C8） |
| E-22 | K1 的 [1] 改成 `compose.ts` 第 10 行；再把 [0] 也改成 `run.ts` 第 1 行 | 前者 `invalid`、`evidence_missing`、`evidenceIndexes: [1]`；后者 `[0, 1]` |
| E-23 | K1 的证据换成 `use`、`register`；K3 只给 `register` | 都是 `invalid`、`evidence_roles` |
| E-24 | K3 的 key 给 `null`；再把它的 [0] 改成 `compose.ts` 第 10 行 | 前者 `accepted`，`warnings: ['evidence_unverifiable']`，`unverifiable`、`key_not_literal`；后者 `invalid`、`evidence_missing`、`[0]`（`register` 还要引用“到”） |
| E-25 | 写 K1；把 `compose.ts` 第 7 行改成 `const access: Access = { beforeCall: async () => {} };`；按模块 `runtime` 读，书记读 `stale`，g1 在 `run.ts` 上准备执行 | 路由读出 `broken`、`missing: [1]`、`currentEligible: false`，三端 `from`、`to`、`via` 都仍 `live`；书记的 `stale` 读里有它，原因 `link_evidence_broken`；“注记”一段出一行警告（文字写任务书时按平台包字符串手写）。断言入口：E3 读路由，E5 读书记的 `stale`，E4 读执行输入（C12） |
| E-26 | 写 K1、K2；在 `compose.ts` 第 1 行前插一行注释 | K1 `broken`、`[1]`（第 7 行变成 `import type { Hooks }…`）；K2 `broken`、`[0]`（第 8 行变成 `const access…`）；两条的 `use` 给的是函数名，仍找得到 |
| E-27 | Python 的 `injects`：从 `drive.py`（`symbolRequest` 名字 `main`）到 `teleop.py`（`start`），经过 `ports.py`（`Publisher`）；[0] `use`：`drive.py` 第 1–2 行；[1] `wire`：`teleop.py` 第 1–2 行 | `accepted`；`warnings` 有 `symbol_unresolved` 和 `evidence_unverifiable`；`unverifiable`、`language_unsupported` |
| E-28 | K1 的“到”写成 `authorise`（`permit.ts` 里没有） | `invalid`、`link_end_unresolved`，`reason` 是 `link_end_unresolved: extraAnchors[0]` |
| E-29 | K1 的 [0] 改成 `permit.ts` 第 1–3 行 | `invalid`、`evidence_outside_end`、`evidenceIndexes: [0]` |
| E-30 | K1 带 key；K3 不带 `key` 字段；K3 的字面 key 含换行，或 513 个码点；K1 的 [0] 同时给 `symbolRequest` 和 `range`；K1 的 [1] 给 `range: { startLine: 8, endLine: 7 }` | 依次是 `link_key_mismatch`、`link_key_mismatch`、`link_key_invalid`、`evidence_invalid: link.evidence[0].at`、`evidence_invalid: link.evidence[1].at.range`（都写在 `reason` 里） |
| E-31 | 读 K1 两次，文件都没改；改 `compose.ts` 第 10 行（`start` 改名 `begin`）后再读；再改 `wire2.ts` 第 2 行后读 | 前两次 `verified`，没有开联系重核捕获；第三次开 1 个联系重核捕获，仍 `verified`；第四次仍开 1 个联系重核捕获，仍 `verified`（`compose.ts` 仍是第三次改动后的样子，和写入时不同；结果不存，C3、N7）。另一个子例：只改 `wire2.ts`，门里的文件都保持写入时的版本 → 0 个捕获、`verified`。这里的计数只数联系重核开的捕获（C4） |
| E-32 | 注入 `NOTE_LINK_RECHECK_MAX = 1`；写 K1、K3（K1 的 `noteId` 在前）；改 `compose.ts` 第 10 行，按项目读 | K1 重核、`verified`；K3 `unchecked`、`budget`。计数只数联系重核开的捕获，K1 一个（C4） |
| E-33 | `callback`：从 `bus.ts`（文件锚点，不带符号）到 `bus.ts` 函数 `select`，经过同一个文件的 `onSelected`；[0] `wire`：`wire2.ts` 第 3 行（`bus.onSelected = bus.select`）；[1] `use`：`bus.ts` 函数 `select`。写成功后删掉 `bus.ts` 的 `onSelected`（第 2 行），再读 | 先 `accepted`、`verified`；删掉后只有“经过”`retired`、`anchorRetiredReasons: ['symbol_missing']`，“从”和“到”仍 `live`：“到”和“经过”两个附加槽共用一个文件键，按槽位分开（N2）；证据 `broken`、`missing: [0, 1]`，`currentEligible: false` |
| E-34 | 写 K1、K2 和流程 [K1, K2]；再照 E-25 改第 7 行；再写一条证据没坏、取代 K1 的 K1' | 读出 `gapsAfter: [1]`；改后第 1 步 `problem: 'broken'`（`item` 保留），整条 `stale`；K1 被取代后第 1 步 `problem: 'not_current'`（状态压过 broken），`item: null`，整条 `stale`（C14、N6） |
| E-35 | K3 的 [0] 改成 `config/handlers.json` 第 1 行（`register`）；再把第 1 行改成 `{"wg.other": "…"}` | 前者 `accepted`、`warnings: ['evidence_unverifiable']`、`unverifiable`、`language_unsupported`（字面 key 照查，引用部分查不了不算找不到）；后者 `invalid`、`evidence_missing`、`evidenceIndexes: [0]` |
| E-36 | 写 K7（`overload.ts` 的重载 `pick`） | `accepted`、`verified`；[0] 的范围是导航项的三个声明段 :1、:2、:3–5，字面 `'overload-key'` 在 :4，落在第三段；若只取第一段会 `evidence_missing`（C8） |
| E-37 | 写一条 `data`：`run.ts` 文件锚点 → `permit.ts` 文件锚点，key `'reports/latest.json'`，[0] `emit` 给 `saveReport` 的 `symbolRequest`，[1] `receive` 给 `permit.ts` 5–7 行；写时让 [0] 的捕获查询报 `source_stale`（工作树和捕获内容不同），之后让分析器仍不可用读一次，再恢复 | 写 `accepted`，`warnings: ['evidence_unverifiable']`，`unverifiable`、`analyzer_unavailable`；存下的 [0].at 保留 `symbolRequest`（名字 `saveReport`），没有 `symbol`，没有隐式改成整个文件，`fileDigest: null`。分析器仍不可用时读：`unverifiable`（`analyzer_unavailable`），不是 `unchecked`（N4）。恢复后读：因 `fileDigest` 是 null 重试，`verified`（C1、C2） |
| E-38 | 写一条纯字面的 `data`：`run.ts` 文件锚点 → `permit.ts` 文件锚点，key `'reports/latest.json'`，[0] `emit` 给 `run.ts` 9–11 行，[1] `receive` 给 `permit.ts` 5–7 行 | 写和读都 `verified`，开 0 个捕获，也不发 `text` 查询；改 `run.ts` 第 10 行的路径后再读 → `broken`、`missing: [0]`，仍 0 个捕获（C5） |
| E-39 | 写 K1，[0] 改成 `permit.ts` 1–3 行（不在“从”里），[1] 改成 `compose.ts` 第 10 行（找不到）；再把“到”写成 `authorise`，同时 [1] 找不到 | 前者 `invalid`、`evidence_outside_end`、`evidenceIndexes: [0]`（不是 `evidence_missing`）；后者 `invalid`、`link_end_unresolved`（先于 `evidence_missing`）（C6） |
| E-40 | 写 K1；读时让 `compose.ts` 第 7 行确定找不到，让 `run.ts` 读不了（端口报 `forbidden`）；再把第 7 行改回原样，只让 `run.ts` 读不了；再恢复 `run.ts` 可读，只改 `compose.ts` 第 10 行触发重核（第 7 行保持有效），让新捕获里没有 `compose.ts`、工作树有它；另写一次 K1，写时让证据 [1] 的 `compose.ts` 读取报 `forbidden`（`compose.ts` 不是锚点，不会先撞锚点一步） | 第一 `broken`、`missing: [1]`，不是 `unchecked`（确定缺失压过查不了）；第二 `unchecked`、`unavailable`，`currentEligible: false`（C6）；第三，捕获缺文件而工作树有 → `unchecked`（`unavailable`），不是 `broken`（N5）；最后 `invalid`、`evidence_invalid: link.evidence[1].at.path`（M1） |
| E-41 | K1 的 [0].at.symbolRequest.language 改成 `python`（文件是 `.ts`）；K1 的“到”language 改成 `python`；K3 的 key 改成符号 key、language 写 `python`；K5 的证据给 `symbolRequest`（`.py` 文件） | 依次是 `evidence_invalid: link.evidence[0].at.symbolRequest`、`anchor_invalid: extraAnchors[0]`、`link_key_invalid`、`evidence_invalid: link.evidence[0].at.symbolRequest`（K2、C7；扩展名是唯一权威） |
| E-42 | 写 K1、K2 和流程 [K1, K2]；在 `run.ts` 第 1 行前插一行注释；再写一条 `anchor` 与 K1 的“从”相同的流程；再写一条 `anchor` 是 `run.ts` 的 `dispatch` 的流程 | 第三句 `accepted`（端点身份不看行号）；第四句 `invalid`、`flow_anchor_mismatch`（`dispatch` 和 `runModel` 身份不同）；`gapsAfter` 仍是 `[1]`（C13） |
| E-43 | 写 K1、K6 和流程 [K1, K6]；写一条证据同样有效的 K1' 取代 K1；按模块 `runtime` 读流程 | 流程仍出现在 `runtime` 的范围里：归属看它引用的 K1（已被取代），K6 不涉及 `runtime`；第 1 步 `item: null`、`not_current`，整条 `stale`（C15、N8） |
| E-44 | 同一锚点已有 30 条现行联系，且新联系与一条你确认过的注记矛盾；你经 `notes/write` 写一条合法联系 | `accepted`，不是 `pending_review`、不是 `quota_full`；矛盾、取代你确认过的和额度只把 agent、书记的写入送待审（C17） |
| E-45 | K1 带 `basisFiles: ['src/compose.ts']`；注入 `NOTE_LINK_RECHECK_MAX = 0`；改 `compose.ts` 第 10 行；g1 在 `run.ts` 上准备执行。再把上限调回 10，改 `compose.ts` 第 7 行 | 前者证据 `unchecked`（`budget`）、`freshness: 'stale'`；执行输入仍出一行 stale 警告（不是没有行）。后者证据 `broken`，同时仍有 stale；只出 `broken` 那一行警告（C18） |
| E-46 | 注入 `NOTE_LINK_RECHECK_MAX = 2`；写 K1、K2、K3 和两条流程 [K1, K2]、[K1, K3]，夹具让 [K1, K2] 的 `noteId` 在前；改 `compose.ts` 第 10 行，经 `architecture/semantic-flows` 按项目一次读 | K1 只重核一次（两条流程共用），K2 重核，K3 `unchecked`、`budget`；第一条流程 `fresh`、`currentEligible: true`；第二条流程 `unchecked`、`currentEligible: false`；联系重核捕获共 2 个（C14、N6、N9） |
| E-47 | 分析器写时不可用：写 K1 和 K3（两条的“从”都在 `run.ts`：K1 请求 `runModel`，K3 请求 `dispatch`），所有 `symbolRequest` 都解析不出（端都存成普通文件锚点，原样请求另存）。然后恢复分析器（流程的锚点仍按第 4 片在锚点一步解析，分析器不可用时流程写不进），写流程 [K1, K3]（`anchor` 是 `run.ts` 的 `runModel`），再写一条步骤相同、`anchor` 是 `run.ts` 的 `dispatch` 的流程 | 两条联系都 `accepted`、`unverifiable`（`analyzer_unavailable`）；端点身份按存下的请求算，不因都没解析成就并成同一个文件身份；第一条流程 `accepted`；第二条 `invalid`、`flow_anchor_mismatch`（N1） |

### 5.3 要改断言的旧测试

写任务书时 lead 按当时的基线逐条列出。会改到的地方：
- 断言八种注记种类的测试；
- `record_note` 工具规格的字节测试（PC-2 W 组的 `PC2-W-*`）；
- 平台包的摘要测试（包里加了字符串）；
- lead 2026-10-22 定了从函数名取范围：断言源码查询的符号命中和 `project_source` 输出的测试（多一个 `declarationRanges`，C8）；断言 `renderNoteHeader` 四个字段调用点的测试或字节测试（联系行要传关系和“到”端，C19）。
- `NoteItemV1` 的完整字段断言（多了 `link?`、`flow?`、`anchorSlots`，N2、N10）。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **合同：** `src/contracts/note.ts`（种类、显示映射、`LinkInputV1`、`LinkEvidenceStoredV1`、`LinkEndRequestV1`、`LinkKeyStoredV1`、`LinkPayloadV1`、`LinkVerificationV1`）；新文件 `src/contracts/semantic-layer.ts`（含 `LinkReadPayloadV1`、`NoteFlowReadV1`）；`src/core/work-graph/model/note-contracts.ts`（常量 `NOTE_LINK_EVIDENCE_MAX`、`NOTE_LINK_RECHECK_MAX`、`NOTE_FLOW_CANDIDATE_MAX` 和额度，`NoteItemV1` 的 `link`/`flow`/`anchorSlots`）。
- **WorkGraph：**
  - `work-graph/notes/note-service.ts`（形状、接入找证据、步骤、取代家族、额度）；
  - 新文件 `work-graph/notes/link-evidence.ts`（L3a 的表、范围、落在哪里、字面查找、引用筛选、合起来的规则；写时和读时共用）；
  - `work-graph/notes/note-anchors.ts`（同一文件两个锚点的判重；`link` 三个端不在锚点一步解析，交给 L3b，C4）；
  - `work-graph/views/note-views.ts`（读时重核和预算，按 L3d；按锚点槽位的状态和原因，N2）；
  - `work-graph/state/note-machine.ts`（状态，AGENTS 第 9 条）；
  - `work-graph/persistence/note-record-codecs.ts`（种类、字段、新索引）；
  - `work-graph/notes/note-read-model.ts`（种类过滤、结果项、执行输入的行、`stale` 读收 `broken`）；
  - 新文件 `work-graph/notes/semantic-layer-read.ts`。
- **工作区：** 不加端口，找证据经 `NoteAnchorWorkspace`（`note-anchors.ts:40–45`）。按 lead 2026-10-22 的决定改：`workspace/ports.ts`（`SourceHit` 的符号命中加可选的 `declarationRanges`）、`workspace/typescript-source-query.ts`（:204 收全部声明段）、`workspace/source-query.ts`（:39 照转）。
- **Runtime：** `agent-runtime/note-tool.ts`、`agent-runtime/graph-tools.ts`。
- **Host：** `app/core-routes.ts`、`app/core-http-types.ts`。不加自动抓，也不加重核路由（L3d 选了 (a)）。
- **组合根：** `composition/create-platform.ts`。
- **平台包：** `resources/prompts/platform/**`（字符串、工具说明、Skill），加上生成的模块；根目录的 `runtime-assets.json` 一起更新（包信息、字符串文件和资源摘要都要同步，C20）。
- **文档：** `docs/refactor/STATE-MACHINES-SPEC.md` 的 S4-NOTE 加 §3 的行（C20）；`docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md` 的 D87-1 补核对结果展示：`verified`、`broken` 和哪一条、`unverifiable` 和原因、`unchecked` 和原因（N12；lead 在规格提交时写）。
- **测试：** 新的 `tests/**/S8E-*.test.ts`，加上 §5.3 列的旧测试。

## 7. 施工

- 排在 8C 之后（§0.4），分两段，各一次 DSH 运行，照 [DSH-WORKFLOW §6.10](../../../DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)。
  - **第一段：`link` 这一种做到最终合同（C19、N11）。**
    - 合同：`NoteKind` 只加 `'link'`；`record_note` 的工具枚举、`find_graph` 的种类过滤加 `'link'`；显示映射（`contracts/note.ts:112` 的 `Record<NoteKind, string>`）加 `link` 一项。类型：`LinkInputV1`、`LinkEvidenceV1`、`LinkEvidenceStoredV1`（原始选择器 + 解析位置）、`LinkEndRequestV1`、`LinkKeyStoredV1`、`LinkPayloadV1`（`ends`、`key.symbolRequest`、`analysisConfig`）、`LinkVerificationV1`（这一段只有 `verified`、`unverifiable`）、`NoteDraftV1` 的 `link` 支；`WriteNoteResult` 的新原因和 `evidenceIndexes`；第 4 片 `NoteCheckV1`/`NoteItemV1` 的 `anchorSlots`；`SemanticEndV1`（`request`、按槽位的状态）、`SemanticLinkV1`（含每端状态和 `currentEligible`）、`LinkReadPayloadV1`、`SemanticScopeV1`、`readSemanticLinks`；`SourceHit.declarationRanges?`（C8）。
    - 规则：L1、L3、L3a、L3b（写时证据核对）、L4–L8、L10（只有联系行，先不查读时重核）、L11、L13。
    - 读出的 `verification` 就是写时存下的结果（`verified` 或 `unverifiable`），这是合法的最终值；这一段不开联系自身的读时重核，也不会出现 `broken`、`unchecked`。端点的读时重解析和退役由第 4 片的现有核对直接生效（M2）。
    - 入口：E1、E2、E3 的 links、E4 的联系行、E5；E-01–E-10、E-14、E-16–E-24（其中 E-19 只做 E-19a）、E-27–E-30、E-33 的写入那一半、E-35–E-39 的写入那一半、E-40 的写入那一半（M1）、E-41。
    - 旧断言：§5.3 的八种种类、`record_note` 规格字节、平台包摘要、源码查询的符号命中和 `project_source` 输出、`NoteItemV1` 的字段；`renderNoteHeader` 的调用点（`note-views.ts:1060` 等）要传关系和“到”那一端（C19）。
    - 行数：2,000–3,000 行（其中写时证据检查 500–750，合同和编解码约 150，工作区字段约 30，测试 400–700）。
  - **第二段：读时重核和 `flow`（C19、N11）。**
    - 合同：`NoteKind` 加 `'flow'`；`record_note` 的工具枚举、`find_graph` 的种类过滤加 `'flow'`；显示映射加 `flow` 一项；`NoteDraftV1` 的 `flow` 支和 `FlowPayloadV1` 的存储。`LinkVerificationV1` 的 `broken`、`unchecked` 开始产出；`LinkReadPayloadV1.verification` 开始出现这两种；`SemanticLinkV1.currentEligible` 从证据来；`SemanticFlowStepV1`、`SemanticFlowV1`、`NoteFlowReadV1`、`readSemanticFlows`；`NoteItemV1.flow`。
    - 规则：L3c、L3d（读时重核、`broken`、`unchecked`、`currentEligible` 从证据来）、L12、L10 的警告行、流程（L2、L9、C14、C15、C16）。
    - 入口：E1、E3 的 flows、E4 的警告行、E5 的 `stale` 读和流程；E-11–E-13、E-15、E-19b、E-25、E-26、E-31、E-32、E-33 的读时那一半（N2）、E-34、E-37 的读时重试、E-38 改文件后的 broken、E-40 的读时那一半、E-42–E-47。
    - 旧断言：书记的 `stale` 读、执行输入“注记”一段的行和预算、Host 的 flows 路由。
    - 行数：900–1,400 行（其中读时重核 300–450，流程 300–450，测试 300–500）。
- 第二段用新 Session（决定 56）。
- §0.3 的 6 条已由 lead 2026-10-22 定下，§5.1 的测试入口已由用户 2026-10-22 确认。规格 2026-10-22 冻结。
- 施工开头实测两件：
  - L3a 的例子（`Pick` 那条）的引用查不查得到，结果报 lead。
  - 在这个仓库上量一次一个 TS 捕获加一次重核的查询（L3a 例子的第 1 步），报 lead；lead 据此保留或调低 `NOTE_LINK_RECHECK_MAX`。
- 写一条联系最多开一个捕获：找证据和解析三个端都在 L3b 的那一个里（C4）；锚点一步不再为 `link` 单独开。读时重核另开，见 L3d 的代价。
- 行数（含测试，都没有量过，施工后报实数）：合计约 2,900–4,400 行。

## 8. 不做的事

- 不改正式目录，不进依赖图，不参与比较和影响分析（§1.2）。
- 不从代码自动推联系，不用运行记录确认。
- 不证明运行时走哪条分支、配置装的是哪个实现（L3e）。
- 不给 Python、C++ 做引用核对，也不退成按名字找文字（L3b）。
- 核对结果不存，每次读时算。
- 流程不跟着取代自动更新，不猜改名。
- 不做界面（E3 的 D87-1）。
