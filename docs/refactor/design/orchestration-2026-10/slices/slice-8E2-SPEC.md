# 8E-2 片规格：语义层的读和核（两档）

> **状态：已冻结（2026-11-04，lead；决定 117-3）。** 起草方（Opus 5.5）第 4 稿。Codex 第一轮（19 条）、第二轮（a、b 没有问题，c 补三处没有的验收行：E2-30、E2-31a/b、E2-14b）、最后一次快速核对（E2R3-01–03，三条）的意见都已改完。用户 11-04 答了 §0.1 第 3 条（选 A）、第 4 条（选乙），§0.1 第 1、2 条用户 11-03 晚已定。以下是第 4 稿的稿次说明，照留（其中“下一步”“冻结前”两句是第 3 稿当时写的；冻结只改了这一行，本稿自己的行号（§8 备忘）和第 4 稿相同）。第 4 稿（Opus 5.5 起草，2026-11-04 凌晨）照 §3.2 开工先量的结果（`impl/s8e/measure-first-report.md`）和 lead 的裁定 `impl/s8e/measure-rulings.md` 改：“照收”15 条，改法照独立核对 `impl/s8e/measure-wf.json` 每条的 `spec_edits`，CRIT-01…12 改过的以 CRIT 为准；用户 11-04 答了两条（§0.1 第 3、4 条）；逐条改在哪见 §8 备忘的“第 4 稿”一节和答复文件的“第 4 稿：开工先量”。回报之后又照 lead 的 7 条裁定（`measure-rulings.md`“第 4 稿回报之后”一节）就地改过，又照 Codex 快速核对的三条（E2R3-01–03）改过；11-04 又照第一档提速的裁定（`measure-rulings.md` 末节“第一档提速”，综合 `impl/s8e/speed-study-judge.md`）改了 W3、W10、W12、R3、R4、R7、§2.0、§0、§0.1 第 3 条的数、§3.2、§3.3、§3.4、§3.5、§4.1、§4.3（加 E2-34–36）、§5、§7，这一轮加了行，§8.2 前面各行的行号是加行以前的（见 §8.2 末的说明）。第 3 稿留在 `slice-8E2-SPEC.draft.v3.md`。以下是第 3 稿的状态说明，照留。第 2 稿按两份质疑意见 A、B 改过一轮（答复见 `impl/s8e/slice-8E2-SPEC.reply.md`）。第 3 稿照 lead 对 Codex 第一轮（`codex2/egrp/E2R1a/b/c.out.md`，19 条）的裁定 `impl/s8e/e2r1-rulings.md` 改：照改 14 条（第 1–14 条，改法照独立复核 `impl/s8e/e2r1-screen.json` 每行的 fix），判为过度、不加机制、记进 §6 的 3 条（第 15–17 条，§6 第 14–16 条），加 11-03 晚补的第 18 条（核对改成单独的只读工具 `check_links`，所有线都有；第 11、17 条随之作废，H3 整段改写）；逐条改在哪见 §8 备忘和答复文件的“第 3 稿”一节。下一步交 Codex 第二轮（最后一轮完整审查），再快速核对、冻结。冻结前：用户答 §0.1 第 2 条（测试入口）；lead 判断 §0.1 第 1 条要不要回去问用户；lead 答 §6。第 1 稿留在 `slice-8E2-SPEC.draft.v1.md`，第 2 稿留在 `slice-8E2-SPEC.draft.v2.md`。
> - **代码基线：** `D:/cxt/nw-75fe12a` = 主线 `720eb978`（8E-1、8E-2 F1 已落）加 NW 小组（`record_note` 的 `facts` 形状，`.lead-ref/change.diff`，下一个落地）。本稿行号都是这棵树的。设计说明用的是 `D:/cxt/8ef1-56fda08`；两棵树逐个 `cmp` 过本稿引用的文件，只有 `src/core/agent-runtime/note-tool.ts`、`src/core/work-graph/notes/note-service.ts` 不同（NW 改的），这两个文件的行号按本基线重查过。A1a/A1b 的事实另看 `D:/cxt/7da1b-4a792bb`（F25）。第 3 稿按 `D:/cxt/8e2-3642`（主线 `3642b9e3` = 本基线加 A1a/A1b）核：第 3 稿新写的、引到 A1a/A1b 改过的文件的行号按那棵树，后面标“（3642）”；没标的照旧是本基线的。第 4 稿新写的行号也按 `D:/cxt/8e2-3642`。之后落地的 7D2 O1a 和 E3-5 改过的文件，本稿引到的行号第 4 稿回报后都按 `D:/cxt/main-83e72aa2`（主线 `83e72aa2` 的代码加现在的文档）重查过，不另标：O1a 改了 `CP`（`:154` 删一行、`:213` 后加一行，`:214` 以后行号不变）、`tests/architecture/production-reach-allowlist.json` 和几份 README；本稿引到的有 `CP`（F8、F48、§2.0、R7、§3.4 的表；标“（3642）”的那几处两棵树相同）、FR7 的允许清单行、§3.3 R 说明里的 README 行、§4.4 的 `tests/README.md:165`；E3-5 只改 `src/ui` 和 `tests/ui`。TS 库的行号是 TS 6.0.3 的 `node_modules/typescript/lib/typescript.js`（`package.json:18`）。
> - **依据：**
>   - 设计说明 `impl/s8e/design-two-tiers.md`（下称“设计 §n”）。它的 §9 八件全由用户 11-03 晚定（下称“§9-n”；`close-todo.md:55` 记了用户原话和 lead 的归纳，lead 记成决定 116-2，HANDOFF 里还没记）。
>   - 设计的审查回复 `impl/s8e/design-two-tiers-reply.md`（下称“复函第 n 条”）。
>   - HANDOFF 决定 87（`:794` 保证、`:799` 后注）、115-2（`:2081`）、115-3（`:2090`）、115-8（`:2117`，A1a/A1b 先落）、116-1（`:2121`，K2 冻结）。
>   - 8E 规格 `docs/refactor/design/orchestration-2026-10/slices/slice-8E-SPEC.md`（10-22 冻结，下称“8E :行”）；第 4 片规格 `slice-4-SPEC.md`（下称“第 4 片 :行”）；K2 规格 `slice-K2-SPEC.md`（下称“K2 :行”）。
>   - 8E 的书 `impl/s8c/book-8e-frozen.md`、开工裁定 `impl/s8c/8e-start-rulings.v5.md`（下称“开工裁定 :行”）、演练裁定 `impl/s8e/frozen/8e-drill-rulings.md` 和 `impl/s8e/rp/out/DR8eF2.out.md`（下称“F2-0n”）、F2 白名单 `impl/s8e/frozen/8e-f2-whitelist.txt`、F2 开工时 lead 的口头裁定（`close-todo.md:34`）。
>   - 7D2、6C、第 9 片、B06 的冻结开工裁定（`impl/sgl/book/*-start-rulings.frozen.md`）：只用来排共用文件的先后（§3.4）。
>   - 测试规则 `impl/test-rule-sheet-v5.md`、`tests/README.md`、`tests/RULES.md`（下称“规则表 A1–A9、F1–F12、S1–S6”）。
> - **记号：** `NV` = `src/core/work-graph/views/note-views.ts`；`RM` = `src/core/work-graph/notes/note-read-model.ts`；`LE` = `src/core/work-graph/notes/link-evidence.ts`；`NA` = `src/core/work-graph/notes/note-anchors.ts`；`NC` = `src/core/work-graph/model/note-contracts.ts`；`NS` = `src/core/work-graph/notes/note-service.ts`；`CP` = `src/composition/create-platform.ts`；`NT` = `src/core/agent-runtime/note-tool.ts`；`ED` = `src/core/agent-runtime/execution-driver.ts`；`TQ` = `src/core/workspace/typescript-source-query.ts`；`PT` = `src/core/agent-runtime/prompt-set-texts.ts`。凡写“估”的都没有量过，写明哪一项测量定它。
> - **分六组：** W 工作区分析、F2 改形、R 第一档读、G 写入闸门、H 后台和核对操作、S 书记数断了的联系（§3）。W、R、G 由 Opus 5.5 施工；F2、H、S 由 DSH 施工（设计 §7.1；决定 114-7、114-9 的做法）。S 是第 1 稿 H5 拆出来的，理由见 §3.4。
> - **测试入口：** 10-22 用户确认的 E1–E5（8E :590–600），11-03 晚用户确认改一处、加三处（§9-1）。§9-6 的两个新行为要的入口 E9、E10 用户 11-03 晚已确认，见 §0.1 第 2 条。

## 0. 一页说明

**要解决什么。**
- 今天挂在函数上的注记，文件一改，读的时候就开一个全项目 TS 捕获重找函数，每个约 12 秒，而且整段同步跑在 Host 主线程上，别的 Run、工具、页面都被卡住（F5、F15）。
- 冻结的 F2 还要在读的时候每条联系开一个捕获重核（8E :501–516）。读注记的频率接近读文件（设计 §2.1），这样不行。
- 用户 11-03 晚定（115-2、§9）：读和核分两档；先精准，再越快越好；核设计成不常被调用；agent 调工具尽量不受影响。

**两档。**
- **第一档（读）。** 只比文件摘要；变了才在单个文件里查。确定断了的读“断了（哪一条）”；名字还在、要跨文件才判得了的读“存疑：跨文件引用待核”（`unchecked`，新原因 `refs_pending`），不当现行结论。读从不建 TS 程序。要求是典型 ≤100 毫秒、最坏约 450 毫秒（用户 11-04 选 A，§0.1 第 3 条）。按 11-04 的提速（W12 的 Kernel `readMany`、W10 共用一棵树、R4 按摘要记解析结果；`impl/s8e/speed-study-judge.md`）估：典型约 5–15 毫秒；最坏本地盘空闲约 110–150 毫秒、忙时约 160–280 毫秒，Windows 盘约 0.4 秒；页上有改过的 C++ 函数注记时可能到约 300 毫秒（等待上限）；同一状态再读 20–45 毫秒。各部件分别量过，没有一起量过，W 落地前重量（§3.2 末）：
  - 读：今天每个门文件开一次访问约 1.5 毫秒（偏忙 2.1）。W12 改成一次访问、Kernel 的 `readMany` 以后，本地盘（ext4）用同步版：256 个文件空闲 13–28 毫秒、偏忙 18–43 毫秒，另加开一次访问不到 1 毫秒；Windows 盘（WSL 的 `/mnt`，drvfs）用异步版约 0.4 秒（今天 4.3 秒）。
  - 典型：看、找默认一页 20 条（`graph-tools.ts:411`、`:445`），门里估 20–80 个文件，读和改过的文件的单文件解析合计估 5–15 毫秒（解析结果按摘要记下，同一份文字只解析一次，R4）。架构图一页最多 100 条联系（`semantic-layer-read.ts:51`），约 200 个文件，读 10–15 毫秒（偏忙）。
  - 最坏：由几个预算封顶，一次最多读 256 个文件（NC:39，不变）、单文件解析 20 个、解析 1 MiB 文字（`NOTE_READ_PARSE_BYTES_MAX`）；Python/C++ 的单文件查另有等待上限（R3）。最坏的一次（读满 256 个、第一次解析满 1 MiB）本地盘空闲约 110–150 毫秒、忙时约 160–280 毫秒：读 13–43，解析 1 MiB 共用一棵树后空闲 104–121、忙时 153–237（W10；两遍时 176–323）。页上有改过的 C++ 函数注记时可能到约 300 毫秒（R3 的等待上限，和 TS 那部分重叠）。同一状态再读 20–45 毫秒（命中的不再解析）。Host 进程的第一次调用另加约 120–220 毫秒（JIT 还没热，每个进程一次）。
  - 都和仓库大小无关。
- **第二档（核）。** 只加载证据文件和它 import 到的文件，用 TS 自己的引用引擎在整个程序里找，只留证据文件里对那个定义的引用（W6）。在写联系、Run 里改了文件之后、架构图上的“重新核对”、agent 的只读核对工具 `check_links`、Host 空闲时的后台批量里做。每个 Host 一个分析线程，带按内容摘要的解析缓存（上限 24 MiB 源码，堆约 0.75 GiB，W7；线程第一次起约 0.25–0.45 秒，含线程里载入 TypeScript 约 0.3 秒，进程多 30–60 MiB，W1）。
- **结论放哪。** 第二档的结论只放 Host 内存，按“注记版本 + 门里文件的摘要”记。不落记录，重启就丢，下次空闲再核。
- **第 4 片。** 挂在 TS/JS 函数上的注记，读时改成单文件按名字重找，签名摘要照旧比，结果和今天一样，只是不开捕获。（这个摘要只盖名字那一段：函数删了或改了名读得出，读成 `symbol_missing`；改参数、改函数体读不出来，只有构造函数这类没有名字段的会读成 `symbol_signature_changed`。今天也是这样，是第 4 片的已知限制。）Python、C++ 照 §9-7 也做单文件查（Python 常驻 `ast` 进程；C++ 有 `compile_commands.json` 时 libclang 单文件加 preamble 缓存），写的时候用同一套工具存定位（§0.1 第 1 条）。
- **断了谁修。** Run 里每次改了文件，下一次模型请求之前，平台用第一档查这次 Run 改过的文件上的联系，确定断了的当场交给执行者；存疑的平台自己在后台用第二档核，核出断了的在之后的安全点交（不等，§6 第 1 条）。书记兜底：断了的满 5 条，或最早一条断了满 10 分钟（从改它的 Run 结束后算），就提醒书记。

**分六组。**

| 组 | 做什么 | 生产行数（估） | 谁做 |
|---|---|---|---|
| W | 第一档的单文件语法函数；第二档分析线程、解析缓存、先后队列、只留证据文件里命中的引用判断；Python/C++ 单文件查（常驻进程、preamble） | 875–1,320（其中 Python/C++ 200–400，含读系统头文件 50–100；W12 的 Kernel 补丁约 +115/−8（两种读法）、src 约 45；W3 的预取；W10 共用一棵树 ±10–15） | Opus 5.5 |
| F2 | 流程的读、路由和接线；流程的两处额度人口；`isGeneralKind` 旧拷贝；坏 `scope` 回 `invalid` | 350–500 | DSH |
| R | 门和摘要口径；按关系的确定规则；第 4 片换单文件；内存结论、存疑队列、核对入口和“重新核对”路由；`currentEligible`、执行输入的行和合并；Run 里改文件后的检查 | +595–825 / −105 | Opus 5.5 |
| G | 写入闸门不开捕获：符号走第一档，引用走第二档；一般注记的符号走单文件（含 Python/C++）；删掉没人用的扫描上限 | +130–190 / −200 | Opus 5.5 |
| H | 后台批量和在跑计数；只读核对工具 `check_links`（声明、和看、找同一处的装配、未知调用的分类）；工具说明、四个 skill 各一句、包 | 180–260（估；第 3 稿改成单独工具后没重估） | DSH |
| S | 书记提醒数断了的联系（游标门、计时、模板槽） | 60–110 | DSH |

合计生产估 +2,190–3,205、−313（都是估，没量；含 Kernel 补丁约 +115/−8）。冻结的 F2 在 8E §7 估 600–900（8E :808）。多出来的主要是 W 的分析线程、缓存和 Python/C++ 单文件查，以及 §9-6 的 Run 里检查和书记计数。

**改完你能看到什么。**
- 读注记不再卡 Host。挂在 TS/JS 函数上的注记和今天读出一样的结论。挂在 Python/C++ 函数上的注记第一次能存下函数定位，文件改了也能读出还在不在（§0.1 第 1 条）。C++ 有两处打折：没有 `compile_commands.json` 时只认得出不靠头文件的函数（自由函数、写在类里面的成员），写在类外的成员函数照今天只存文件锚点；有的话，平台也只读地读编译器自己的系统头文件目录（§0.1 第 4 条），但这次解析有报错（例如 include 了工作区外别处的文件）时，函数找不到读“存疑”，不读“已没了”。机器上编译器自己的头文件用不了时，退回只看工作区文件，引了系统头文件的文件多半读“存疑”。
- 架构图、“看”“找”、执行输入里多一种“存疑：跨文件引用待核”。执行输入里只因存疑出行的联系超过 3 条，合成一行。
- 架构图后端多一条“重新核对”的路由（按钮的样子归 E3 的 D87-1）；所有线（审阅线、不写注记的 Query 也在内）多一个只读工具 `check_links`，和“看”“找”一起给，说明里写明平时不用调。
- 执行者改代码改断了联系，下一次模型请求时会收到平台消息；书记提醒里多一个“断了的联系 n 条”。
- 写一条要查引用的联系（第二档经平台读口，§3.2 第 2、7、8 项，机器偏忙时量）：同一片代码第二次起（缓存满、预取、同时读 4 个）约 2.2–2.5 秒；缓存空约 4–5 秒；Host 刚启动后的第一次 5–9 秒（量的时候没开同时读，开了估 4.5–8 秒；还没有可预取的；另加起线程约 0.3–0.4 秒）。写的优先级最高，但不打断正在做的核，碰上时再加上那一次剩下的时间（W2）。时间大半花在经读口列全部文件（每次 0.6–1.8 秒）和读 650–1,200 个文件（0.8–1.1 秒），建程序和查引用合计不到 0.3 秒；W3 改用 `readMany` 以后读文件那段估降到约 0.05 秒（718 个文件偏忙时 1,249 毫秒变 35 毫秒），上面各数估少 0.8–1 秒，没有一起量过。空闲时估快 30–40%，W 落地前重量（§3.2 末）。今天中位 12.2 秒。

**已量（§3.2，11-03 晚；结果 `impl/s8e/measure-first-report.md`，脚本和日志 `tools/tmp-m8e2-*`）。** 初值和改法已冻结进 W1、W3、W5、W6、W7、W10、W11、W12、R3、R4、§2.0 的常量、H4 和 §4.3（E2-23d、E2-29c、E2-29d、E2-33）。除第 1 项的重跑外，都是机器偏忙时量的；W 落地前空闲时重量，只改估数（§3.2 末）。

### 0.1 要你定的

**1. 已定（用户 11-03 晚，带着新事实重问后）：做。** lead 把下面的新事实（今天 Python/C++ 的函数名从来存不出定位）告诉用户，问“这次做（A）还是不做（B）”，lead 建议 B；用户答“要做”。所以照 A：W11、R3、G8、E2-24、E2-29a/b 和 §3.2 第 9 项都留。原来的说明照留如下。
- 你 11-03 晚定了 §9-7：Python 用常驻 `ast` 进程、C++ 用 libclang 单文件加 preamble，第一档也给它们做单文件查。本稿照这个写（W11、R3、G8）。
- 设计 §2.4 写这件事时的前提是“今天读时会开 Python/C++ 分析器的捕获重找函数，几秒到十几秒”。代码里不是这样（F6）：平台的源码捕获只做 TS 和文本，Python、C++ 一律回“不支持”，所以写注记时 Python/C++ 的函数名从来解析不出来，只存文件锚点、警告 `symbol_unresolved`；读的时候也就没有可查的函数定位，从来不开捕获。8E 冻结规格 F17 也写过这一点（8E :41）。
- 所以照定的做，写这一侧也要用同一套单文件工具把 Python/C++ 的函数名解析出来、存定位（G8），不然读那一侧没有东西可查。这等于第一次让 Python/C++ 的一般注记能挂到函数上。联系的端和证据仍只收 TS/JS（`LE:273`），不变。
- 如果 lead 判断要回去问你，另一个做法是这次不做 Python/C++ 的单文件查，和今天一样只能挂文件：本稿删 W11、G8、E2-24、E2-29a/b 和 §3.2 第 9 项，W 少估 150–300 行。

**2. §9-6 两个新行为的测试入口。** 你 10-22 确认了 E1–E5，11-03 晚确认了改一处、加三处（§9-1）。§9-6 后加的两个行为不在这些入口里：
- **Run 里改文件后的检查（R12）：入口 E9。** E1 同一个世界里的真实 Work Run：脚本模型调真实的 `edit` 改文件，看它下一次模型请求里收到的平台消息（脚本模型记下的请求）。
- **书记提醒数断了的联系（S）：入口 E10。** Host 的书记提醒心跳（第 4 片 S4C2 已用的那条路），从发给书记的提醒正文读。
- 建议：确认这两个入口。不确认的话，这两个行为只能写进规则、不配验收行（E2-13、E2-19a–c 删掉）。
- 状态（11-03 晚）：用户已确认（问“属于页面吗？开始测试吧”，lead 答不是页面测试：Node 起真实 Host 和 Work Run 看消息）。E7（agent 的核对）按裁定第 18 条换成单独的只读工具 `check_links`，lead 会告诉用户。

**3. 第一档的上限（§3.2 第 1 项量完后加）。已定（用户 11-04）：选 A。** 115-2 定的读“典型 ≤100 毫秒、上限 300 毫秒”是按普通文件读估的。经平台读口，按 11-04 的提速（W12、W10、R4，`impl/s8e/speed-study-judge.md`）估：典型的读（看、找一页 20 条）约 5–15 毫秒；最坏的一次（一次读满 256 个不同的门文件、全都变了、再第一次单文件解析满 1 MiB）本地盘空闲约 110–150 毫秒、忙时约 160–280 毫秒，Windows 盘约 0.4 秒；页上有改过的 C++ 函数注记时可能到约 300 毫秒（等待上限）；同一状态再读 20–45 毫秒。问用户的时候（提速以前）是：典型约 15–70 毫秒，最坏 400–470 毫秒（读约 205–235，解析约 233）。
- A（选了）：接受，写成“典型 ≤100 毫秒，最坏约 450 毫秒”；`NOTE_READ_FILES_MAX`（NC:39）不改。
- B（没选）：一次调用最多读的文件从 256 降到约 80–110（改第 4 片冻结的 `NOTE_READ_FILES_MAX`），架构图一页 100 条时更多联系读“这次没核”。
- 不提降解析字节：读口每个文件最多读 1 MiB（`NOTE_BASIS_FILE_MAX_BYTES`，NC:29），比解析字节大的文件上的函数锚点第一档就永远核不了。

**4. C++ 精确模式读不读系统头文件（§3.2 第 9 项量完后加）。已定（用户 11-04）：选乙。** 现有 C++ 分析器只把经沙箱、按权限过滤过的工作区文件放进虚拟文件系统，加 `-nostdinc`，故意不读工作区外的任何文件（`scripts/cpp-source-query.py:220–221`、`:238`、`:246`），`-resource-dir`、工作区外的 `-I`、`-isystem` 这类参数也被拦下（`:152`、`:182`、`:513`）。
- 甲（没选）：照这条规矩，用了标准库的真实文件多半 `exact: false`，函数删了或改名读“存疑”，读不出“断了”。
- 乙（选了）：精确模式只读地读编译器自己的系统头文件目录（只逐个映射这几个目录里真实路径仍在目录内的文件、不报这些文件里的符号、头文件摘要进复用判断），能读出“断了”。这放宽了“只读工作区文件”这条安全规矩，只放宽到编译器自己的头文件目录，记成决定 117（§7）；W 多约 50–100 行（估，没量）。规则六条见 W11。
- 甲的读法留作退路：机器上编译器自己的头文件用不了（起进程时那个只含 `#include <cstddef>` 的 C++ 内存小文件解析不出）时，这台机器照甲。从甲换到乙不用迁移已存的数据：写时找得到就存，两种一样。
- 重量（装了 `libclang-common-18-dev` 以后，§3.2 第 9 项）：诊断全 0；精确首次 324–1,378 毫秒，有 preamble 重解析 58–208 毫秒；留住 5 个翻译单元，进程多 217 MiB。

## 1. 代码事实（基线 `nw-75fe12a`；✓ 是起草方逐条读过的）

| # | 事实 | 位置 |
|---|---|---|
| F1 ✓ | 所有读注记的地方都走 `createNoteCheck`；读法经 `withCheck` 调它的 `checkHeads`。缓存和预算只活一次调用。一个路径一次调用只读一次，最多 256 个 | `NV:227`；`RM:509–564`；`NV:1275`；`NV:297–310`；`NC:39` |
| F2 ✓ | 读文件经 `readCurrentFile`，按工作树读；比的 `digest` 是原始字节的 sha256。读口同时返回解码后的 `content` | `NV:281–294`；`src/core/workspace/workspace-read.ts:71–72`；`vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js:718`、`:720` |
| F3 ✓ | 符号定位的 `fileDigest` 是写时捕获里的 `hit.location.digest`，即解码文字的 sha256。联系的 `analysisConfig.digest` 也取捕获里的配置文字 | `NA:407`；`TQ:183`；`src/core/workspace/project-source-snapshot.ts:134`；`src/core/workspace/capture.ts:101`；`LE:345–351` |
| F4 ✓ | Kernel 解码用 `TextDecoder('utf-8', { fatal: true })`，默认去掉 BOM。读侧拿原始字节摘要比符号定位的解码摘要，带 BOM 的文件每次都读作“变了” | `workspace-sandbox.js:60`；`NV:712–713`、`:734` |
| F5 ✓ | 文件锚点摘要变了：每个开一个捕获按名字重找（`recheckSymbol`），一次调用最多 20 个（`NOTE_SYMBOL_RECHECK_MAX`），按页扫、有命中上限。定位那一段的摘要变了推 `symbol_signature_changed`、槽仍 `live`（有名字的项，那一段就是名字本身，按名字找到的摘要总相同，所以实际只有 F41 那类没有名字段的项会推；改有名字函数的参数或函数体读不出来。第 4 片 §9 :734、§10 R4 :750）；找不到推 `symbol_missing`、槽 `retired` | `NV:342–413`；循环 `:731–750`（`:743`、`:745`）；`NC:41`；`NV:221–222` |
| F6 ✓ | 捕获只实现 `typescript` 和 `text`，`python`、`cpp` 回 `unsupported`；`resolveSymbol` 按 `request.language` 分派（`SYMBOL_LANGUAGES`），遇 `unsupported` 回 `unresolved`。所以 Python/C++ 的 `symbolRequest` 从来存不出定位；读侧 `anchor.symbol === undefined` 直接跳过，`SYMBOL_RECHECK_LANGUAGES` 里的 `python`、`cpp` 走不到 | `capture.ts:631`；`NA:264`、`:337`、`:342`、`:365`；`NV:733`；8E :41（F17） |
| F7 ✓ | Python/C++ 整项目分析器只在探索工具里用；Python 经 `execFile` 起 python3（Jedi）；C++ 经 Python 脚本用 libclang 18，要 `compile_commands.json`，没有就回不支持；今天的 C++ 脚本没有用 preamble。另有一个单文件的 Python `ast` 访问器（探索工具 `symbols`，每次起一个 python3，给出 def/class 的名字、行、末行）。Python/C++ 的导入扫描共用一个 NDJSON 执行器（重起、超时、输出上限） | `src/core/agent-runtime/exploration-tools.ts:120`、`:21`、`:47–51`、`:220–233`；`src/core/workspace/python-source-index.ts:79`；`src/core/workspace/cpp-source-index.ts:52–53`、`:61`、`:66`；`scripts/cpp-source-query.py`（grep 没有 `PrecompiledPreamble`、`reparse`）；`src/core/workspace/analysis-runner.ts:1–34` |
| F8 ✓ | 联系今天读出的 `verification` 就是写时存的，读侧只做覆盖；`linkRechecksRemaining` 只初始化没用过；`NOTE_LINK_RECHECK_MAX = 10`；`noteLimits.linkRecheckMax` 透传 | `NV:1263`；`RM:559`；`NV:146`、`:205`；`NC:45`；`CP:541` |
| F9 ✓ | `currentEligible` 的 `retired` 只看主锚点那一槽；`freshness` 只因主锚点 `retired` 或 `staleReasons` 变 `stale`；对 `link` 去掉了“只在本目标”那一项 | `NV:751–756`、`:1210–1212`、`:1226–1229` |
| F10 ✓ | `unchecked` 压过 `stale`。执行输入的 `link` 行：现行出结论行；`broken` 只出一行“证据对不上”；只在 `freshness === 'stale'` 时出“需复查”。行的类型 `NoteIndexRowV1` 必带 `anchorKey`、`noteId`、`version`、`kind`、`conclusion`、`freshness`、`label` | `NV:1211–1212`；`RM:2161–2177`（`:2175`）；`src/contracts/graph-context.ts:89–90` |
| F11 ✓ | 书记的 `stale` 读收 `broken` 的联系，原因 `link_evidence_broken:<下标>` | `RM:2614–2629`；`RM:1959–1962` |
| F12 ✓ | 写入闸门：一条联系最多开一个 TS 捕获；引用按 `references` 查询分页；字面 key 扫已读进来的内容；定义自己那一处不算；符号 key 的引用；证据存工作树原始字节摘要；只有捕获里的文字和工作树一致才存摘要（C2） | `LE:257–266`、`:362–641`；`LE:285–306`；`LE:234–243`；`LE:252–254`；`LE:565–576`；`LE:316–342`（`:329`）、`:620–621` |
| F13 ✓ | 一般注记的符号锚点：锚点一步每个 `symbolRequest` 调一次 `resolveSymbol`，没有现成捕获时自己开一个。`link` 在锚点一步不解析。写前的锚点一步用 `maxBytes: 1` 读每个文件锚点确认存在，读失败整个写入回 `unavailable` | `NA:768–769`；`NA:336–347`；`NS:1523`；`NA:819–848` |
| F14 ✓ | 按锚点读、锚点上没注记、文件又不存在时，找候选路径开一个 `text` 捕获 | `NA:221–256`（`:228`）；`NA:843` |
| F15 ✓ | 捕获里的 TS 分析同步跑在主线程；`src` 里没有 `worker_threads` | `capture.ts:705`；grep |
| F16 ✓ | 每次工作树读都新开一次访问；访问的 `open` 每次解析根、授权、`realpath`、新建沙箱 | `capture.ts:189`；`src/core/workspace/access.ts:80–104` |
| F17 ✓ | 导航树：`getNavigationTree` 加一个 `visit`，位置取 `item.nameSpan ?? item.spans[0]`，`declarationRanges` 取全部 `spans`。配置选 `tsconfig.json`，没有再找 `jsconfig.json`；没有配置用 `noLib`；有项目引用回 `unsupported`；引用查询用 `getReferencesAtPosition`；覆盖说明写 `snapshotAtomic: false` | `TQ:206–222`；`TQ:102–103`；`TQ:114`；`TQ:127`；`TQ:198`；`TQ:269` |
| F18 ✓ | 捕获的文件集合：安全路径、不忽略、允许读、项目输入；一个文件读失败整个捕获失败；所有路径映射到 `/workspace/` | `project-source-snapshot.ts:117–121`、`:129`、`:50` |
| F19 ✓ | 同时最多 8 个捕获；一个捕获最多 16 种查询 | `src/core/workspace/workspace-tools.ts:16`、`:19`；`capture.ts:639`；`src/core/workspace/source-query.ts:87` |
| F20 ✓ | 本仓库 `tsconfig.json` 排除 `src/ui`、`tests/ui`；`src`、`tests` 里没有 `declare global`、`declare module '…'` | `tsconfig.json:17`；grep |
| F21 ✓ | `record_note`：`write` 给所有调用方；`review` 只在 `kinds` 含 `repair` 时声明；声明 `workspace_write`、默认超时 10 秒、不是独立只读；按 `op` 分派前先经唯一的请求构造器；写成后调 `checkNotes` | `NT:280–284`（注释 `:241–244`）；`NT:381–391`、`:399–408`；`NT:315` |
| F22 ✓ | Work 装配 `record_note` 只按种类和 `withdraw` 配；秘书 Query 另一处装配；三处 check 依赖的类型都是 `Pick<NoteCheckPort, 'checkNotes'>` | `src/core/agent-runtime/tool-group-assembly.ts:358–366`；`src/core/agent-runtime/query-execution.ts:496–503`；`src/core/agent-runtime/execution-contracts.ts:345`；`query-execution.ts:112`；`NT:55` |
| F23 ✓ | `NoteCheckPort.checkNotes(ctx, { items, withSimilar? })`；`NoteHeadCheckPort` 另有 `checkHeads`；`checkNotes` 接受任何版本，`isHeadVersion` 只用在 `currentEligible` 上 | `NC:249–252`、`:266`；`NV:1218`、`:1273–1287` |
| F24 ✓ | Host：`hostContext(scope)` 用 Host 身份；自动抓的驱动由 `projectChanged` 事件触发、只在拿到租约时接；书记提醒：`runScribeReminderCheck`，周期 60 秒，阈值待审 10、该更新 5，同一 `requestId` 不重发；提醒模板只有待审和该更新两个数 | `src/app/host.ts:1928–1931`；`:847–858`；`:2385–2455`、`:258–260`、`:2441`、`:2444`；`resources/prompts/platform/templates/scribe-reminder.txt`；`src/contracts/prompts/slot-tables.ts:155–160` |
| F25 ✓ | 主线上 Host 没有“在跑的 Run/QueryRun 个数”。两个执行入口是 runtime 端口的 `startRun`、`startQuery`。A1b 落地后有一个按记录现算的在跑计数，每次调用都翻页读全部 Session，只给模型准入用 | `src/core/agent-runtime/runtime.ts:1048`、`:1052` → `ED:313`、`query-execution.ts:222`；`D:/cxt/7da1b-4a792bb/src/core/agent-runtime/model-admission.ts:68–113` |
| F26 ✓ | Kernel 只在 `before_model` 拉平台输入；到 `ready_to_complete` 直接提交 `run.completed`，不拉输入。Work Run 的输入通道在 `ED` 组装（control 来源的 `inputId` 由内容算出、按 `acceptedInputIds` 过滤）。Kernel 的 `after_tool` 钩子可以改写工具结果 | `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:386–394`、`:396–402`；`ED:1034–1061`（`:1035–1039`）；`vendor/coding-agent/dist/core/hooks/protocol/hook-protocol.d.ts:2746–2765` |
| F27 ✓ | “这次 Run 改了哪些文件”有正本：`readRunActivityFacts` 读 Kernel 历史（`through: 'kernel_tail'`），`changedFiles` 分 `definite`、`possible`，处理了 shell 的 `possible` 和 `'.'`。输入来源手上只有 `afterEventSequence` 等几个字段，没有工具结果。`ED` 在进 Kernel 前读过已完成边界 | `src/core/agent-runtime/run-activity-reader.ts:47–57`；`src/core/agent-runtime/run-activity-tally.ts:147`、`:230–250`；`src/core/agent-runtime/execution-inputs.ts:48–57`；`ED:770–775` |
| F28 ✓ | Runtime 拿得到 `platform.notes` 的记忆读、写、核对三个口；按锚点的索引有五个槽（主锚点和四个额外锚点） | `execution-contracts.ts:342–346`；`src/core/work-graph/persistence/note-record-codecs.ts:42`、`:677–679` |
| F29 ✓ | 包里的字符串：`note.warning.stale` 是“需复查”，`note.warning.link_broken` 是“证据对不上”；包字符串是固定文字，没有槽位，带数的行用前后两段拼（先例 `context.omissions.prefix`/`suffix`） | `resources/prompts/platform/strings.json:49–54`；`src/contracts/prompts/pack-string.ts:4`；`RM:1940–1943` |
| F30 ✓ | 7D2 O5b 会把书记提醒改成按范围分桶，游标门照留，模板和发送路径原样 | `impl/sgl/book/7d2-start-rulings.frozen.md:6509–6514`、`:6515–6567`（`:6565`） |
| F31 ✓ | A1a/A1b（`D:/cxt/7da1b-4a792bb`）改 `host.ts`、`CP`、`core-routes.ts`、`core-http-types.ts`、`ED`、`query-execution.ts`、`execution-contracts.ts`；115-8 定 A1a/A1b 先落 | 那棵树 `.lead-ref/change.diff` 的文件头；HANDOFF `:2117` |
| F32 ✓ | 测试世界没有 `tsconfig.json`（建世界时删掉），根下正好是 8E §5.2 的 19 个文件；它把平台共用的 `noteWorkspace` 对象的方法原地包一层，有捕获、查询、读三个故障口和计数；有 `noteLimits` 选项，没有传 Host 选项的口 | `tests/helpers/S8E-semantic-world.ts:599–608`、`:396–449`、`:525–545` |
| F33 ✓ | 注记的工作区读一律经 `noteCheckWorkspace` 换成平台身份（Host 只给自己的身份授权工作区读）；它逐个复制 `readWorkspace`、`capture`、`querySource`、`releaseCapture` 四个方法 | `NA:44–49`、`:851–866`；`RM:423`；`NS:768–769` |
| F34 ✓ | 模型参数只在 `recordNoteRequestOf` 一处变成请求；它只认 write、review，其余一律当 withdraw。“调用结果未知”时的查账 `lookupToolCommit` 用它重建请求；查账结果有 `committed`、`not_committed`、`undetermined` | `NC:162`、`:176–214`；`NT:381–391`；`NS:2285–2310`；`src/contracts/unknown-call-review.ts:84–87` |
| F35 ✓ | 书记提醒检查：账本游标没动就直接返回（只重发待发的）；上一条提醒没处理也记下游标返回 | `host.ts:2400–2405`、`:2420` |
| F36 ✓ | 执行在准备之后可能渲染的每个输入模板都要在投递集合 `DELIVERY_SET_TEMPLATE_IDS` 里，准备时一并冻结，全局包不兜底。手抄这份清单的有 `S7B-preparation-freeze.test.ts` 和 helper `S7B-delivery-samples.ts`（别的测试展开 helper）。K2-P2 也往这里加 `context-summary-request` | `PT:385–391`；`src/contracts/prompts/delivery-input.ts:26`；`tests/runtime/S7B-preparation-freeze.test.ts:23–27`；`tests/helpers/S7B-delivery-samples.ts:12–20`；K2 :553、:761、:777–778 |
| F37 ✓ | Kernel 的输入来源一抛错，整个 Run 记成 `run.failed`（`input_supply_failed`）；同一个 `inputId` 换了文字再交，也是 `run.failed`（`input_conflict`） | `runtime-runner.js:600–606`、`:612–619` |
| F38 ✓ | 生产可达检查：节点是 `src` 的顶层声明和名字以 `Port` 结尾的接口成员；有人读才算走到；`src` 里不按算出来的名字加载模块；被值导入的文件的顶层语句算可达 | `tests/architecture/production-reach.ts:20–29`、`:32–38` |
| F39 ✓ | `check` 是 Kernel 保留的工具名；PC2 扫描测试按行号冻结了 skill 里 `check` 这个词的豁免（work 第 47 行、scribe 第 32 行），工具块外多出的命中会红 | `src/core/agent-runtime/tool-group-assembly.ts:92–93`；`tests/contracts/PC2-platform-scan.test.ts:67–79` |
| F40 ✓ | 五个平台 skill 的 sha256 钉在测试里 | `tests/contracts/S6A-secretary-templates.test.ts:26–37` |
| F41 ✓ | 构造函数这类没有名字节点的导航项，位置取 `spans[0]` 即整段声明，所以它的签名摘要盖住整段，改函数体就变 | `TQ:207–209`；`NA:291–299`（`symbolRangeText`）；`NA:278–280` |
| F42 ✓ | Host 的心跳循环只在拿到租约时跑，每轮对每个工作区调 `runScribeReminderCheck`、`runReworkNoticeCheck`，不另开计时器 | `host.ts:2455–2456`（`!leaseOwned` 不跑）、`:2491`、`:2589–2597` |
| F43 ✓ | `configureTypeScriptProject` 要一张以全部项目路径为键的表（`include`/`exclude` 在这些键上算），配置文件和 `extends` 链上的文件要能同步读到内容 | `TQ:102–131`；`project-source-snapshot.ts:117–121` |
| F44 ✓ | 联系的端：`checkSymbol` 先看扩展名，不是 TS/JS 就回 `unsupported`（`language_unsupported`、`symbol_unresolved`，不读文件）；端读不了是 `unavailable`，只记“查不了”、不加 `symbol_unresolved` | `LE:270–282`（`:273`）；`LE:420–440`（`:430`） |
| F45 ✓ | 流程的额度人口：`overQuotaOf` 的目标人口只看 `link`，没有 `flow`，也没有流程的项目人口；冻结的 F2 要补这两处（代码块已冻结） | `RM:336–347`；开工裁定 :842–866；`NC:49`（`NOTE_PROJECT_FLOW_QUOTA = 100`） |
| F46 ✓ | 必填槽在模板里没出现，解包时就是 `template_invalid`。PC2 的手写包夹具里有一份 `scribe-reminder` 模板 | `src/contracts/prompts/render-template.ts:298–309`；`tests/helpers/PC2-pack-fixture.ts:104`；`tests/contracts/PC2-resolve-pack.test.ts:157` |
| F47 ✓ | links 路由的测试在 `tests/work-graph/S8E-R-route.test.ts`（`:52`）；`tests/app/S8A-architecture-routes.test.ts` 只管 8A 的三个读；没有测试把路由表全部列一遍 | `S8E-R-route.test.ts:52`、`:155`；`tests/app/S8A-architecture-routes.test.ts:53–57`；`tests/helpers/S6B3-route-suffixes.ts:95–96` |
| F48 ✓ | `symbolHitsMax`、`NOTE_SYMBOL_HITS_MAX`、`SYMBOL_SCAN_PAGE` 只给读侧重找、写侧捕获扫描和联系的引用分页用 | grep：`NC:30`；`NA:272`、`:519`、`:528`、`:582`、`:711`、`:769`；`LE:23`、`:290`、`:425`；`NS:127`、`:766`、`:1522`、`:1602`；`NV:64`、`:742`；`CP:537` |
| F49 ✓ | 看、找（`look_graph`、`find_graph`，名字常量 `GRAPH_TOOL_NAMES`）的声明：`effectClass: 'read_only'`、`requiredCapabilities: ['workspace_read']`、默认超时 10 秒、输出 64 KiB、`independentReadOnly: true`，可信上下文创建时冻结。Host 的本地读工具 `LOCAL_READ_TOOL_NAMES = ['read', ...GRAPH_TOOL_NAMES]`，本地 Work 授权（不管有没有写前缀）和秘书都展开它，7D2 的参谋、审阅也展开它；`record_note` 只在有写前缀时给。装配：Work 在 `selectWorkToolGroup` 按名字过滤、缺依赖回 `unsupported`；最终名单 `finalToolNamesOf` 对看、找不看 `noteAdmission`；Query 按授权建看、找，注记读口只给秘书轮。未知调用的分类表第 2 行是“平台只读工具，不查提交回执” | `graph-tools.ts:50`、`:329–359`、`:513–529`；`host.ts:361`、`:366`、`:444–449`（3642）；`7d2-start-rulings.frozen.md:6459–6461`；`tool-group-assembly.ts:75–78`、`:263`、`:295–296`、`:336–351`、`:424`、`:689`、`:714–716`；`query-execution.ts:411`、`:429–431`、`:468–489`、`:571–574`（3642）；`src/core/work-graph/state/unknown-call-kinds.ts:24–26` |
| F50 ✓ | 类型别名（`type X = { … }`）里的字段不是导航项：TS 的导航树把类型别名当叶子，不进它的类型字面量；接口、类、枚举的成员是导航项。写入闸门解析端和符号 key 只在 `symbols`（导航树）里按名字找，这种字段找不到：必需的端回 `link_end_unresolved`，一般注记回 `symbol_unresolved`。捕获的 `symbols` 也没有它们（§3.2 第 3 项逐文件一致）。8E L3a 例子两步的“经过”（`modelCalls`、`modelRequests`）都是这种字段 | TS 6.0.3 `lib/typescript.js:146498–146504`、`:146525–146526`；`TQ:206–222`；`NA:359–360`、`:369`、`:392`；`LE:279`、`:418–419`、`:439–440`；`src/core/agent-runtime/observed-model-run.ts:28`、`:41`；`execution-contracts.ts:221`、`:227`（3642） |

## 2. 规则

每条写明依据：设计的哪一节、哪条决定或裁定。

### 2.0 名字和接口（新名字以此为准）

```ts
// src/contracts/note.ts（R）
export type LinkVerificationV1 =
  | { status: 'verified' }
  | { status: 'broken'; missing: number[] }
  | { status: 'unverifiable'; reason: 'key_not_literal' | 'language_unsupported' | 'analyzer_unavailable' }
  | { status: 'unchecked'; reason: 'budget' | 'unavailable' | 'refs_pending' };
//   refs_pending：存疑，跨文件引用待核（设计 §2.3）。存下的 verification 仍只有 verified / unverifiable（8E :196 不变）。

// src/core/work-graph/model/note-contracts.ts（R）
// 删：NOTE_LINK_RECHECK_MAX（NC:45）。G 删：NOTE_SYMBOL_HITS_MAX（NC:30，F48）。
// NOTE_SYMBOL_RECHECK_MAX = 20 不改名，改义：一次调用最多单文件解析 20 个不同文件，第 4 片的锚点和联系的门共用（设计 §2.4）。
export const NOTE_READ_PARSE_BYTES_MAX = 1024 * 1024;     // 一次调用单文件解析的文字总字节；等于 NOTE_BASIS_FILE_MAX_BYTES（NC:29），能读的单个文件总排得进；§3.2 第 3 项：导航树 149 ms/MiB，加语法树约 233 ms/MiB（负载 6–7）
export const NOTE_LINK_VERIFY_MAX = 20;                   // 一次第二档最多几条联系（设计 §3.4）；§3.2 第 8 项定：1–20 条耗时几乎一样，取决于证据文件的 import 闭包（656–1,164 个文件）
export const NOTE_CHECK_DEADLINE_MS = 8_000;              // agent 的 check_links 等第二档的时限（设计 §3.5）；§3.2 第 8 项定：缓存满时 2–6 秒够用；Host 刚启动、机器偏忙时中位 8.4 秒，这次回 budget（R6）；比 10 秒的工具超时（F49）留约 2 秒
export const NOTE_DOUBT_LINES_MAX = 3;                    // §9-6(b)
export const NOTE_NATIVE_READ_WAIT_MS = 300;              // 一次调用里 Python/C++ 读时的 lookup 一共最多等多久，从发出第一个 lookup 起算，和 TS 的读、解析重叠（R3）；§3.2 第 9 项：Python 每个文件最慢 34 毫秒，C++ 读系统头文件后有 preamble 的重解析 58–208 毫秒（最慢的是大 CMake 编译单元，偏忙），余下留给经读口重读头文件；精确首次解析 324–1,378 毫秒进不了，读时还没有 preamble 的照 W11 退回；空闲重量只报数（§3.2 末）
export type NoteLinkVerifyV1 = { priority: 'run_end' | 'button' | 'agent' | 'background' };
// NoteCheckPort.checkNotes 的输入加两个可选字段（R6、R9）：
//   verifyLinks?: NoteLinkVerifyV1   不带：只做第一档，从不建程序。带：第一档读出存疑的联系交第二档。
//   heldByRun?: string               这次调用替哪个 Run 读（R12 带，值 = canonicalJson(runRef)，R9 用）。
//   用已有的方法加字段，三处 Pick<NoteCheckPort, 'checkNotes'>（F22）都不用改。
// NoteHeadCheckPort 加两个只读内存的方法（给 Host；H、S 读）：
//   doubtfulLinks(scope: { projectId: string; workspaceId: string }, max: number): { noteId: string; version: number }[];
//   brokenLinks(scope: { projectId: string; workspaceId: string }): { noteId: string; version: number; heldByRun: string | null }[];
//   R 落地时 H、S 还没落，这两个成员没人读：R 在允许清单各加一条 kept-for（note 写“8E-2 H/S 读，落地时删”），
//   H 删 doubtfulLinks 那条，S 删 brokenLinks 那条（先例：FR7）。
// NoteCheckLimits（NV:60–74）、CP 的 noteLimits（CP:536–542）：删 linkRecheckMax；加 readParseBytesMax?: number、checkDeadlineMs?: number。
//   G 另删 symbolHitsMax（F48）。
// RecordNoteArgs、RecordNoteRequestV1 不改：第 2 稿 record_note 的 check 一支删掉，
//   核对是单独的只读工具 check_links（下面 link-check-tool.ts，H3；E2R1 裁定 18）。

// src/core/work-graph/notes/note-anchors.ts（R）
// NoteAnchorWorkspace 加 verify?: ReferenceAnalyzerPort['verify']、lookup?: NativeSingleFilePort['lookup'] 和必填的 readWorkspaceFiles: WorkspaceToolsHandle['readWorkspaceFiles']（同 readWorkspace；R4 的门读经它）；noteCheckWorkspace 把 readWorkspaceFiles 写进 checked 的初始化对象，verify、lookup 照另外三个可选方法各加一行（R14；R3 在 NV、G8 在 NA 都经这个包装调 lookup）。

// src/core/workspace/single-file-syntax.ts（W，新，纯函数，主线程）
export type LineRange = { startLine: number; endLine: number };
export type NavItemV1 = {
  name: string; kind: string;                       // TS 导航项的 text、kind
  parentKind: string | null;                        // 外层导航项的 kind；顶层是 null
  start: { line: number; column: number };          // item.nameSpan ?? item.spans[0]，同 TQ:209
  end: { line: number; column: number };
  declarationRanges: LineRange[];                   // 全部 spans，同 TQ:213–217
};
export function navigationItemsOf(path: string, text: string): NavItemV1[];   // = syntaxTreeOf(path, text).navigationItems()；捕获也用它，结果字节不变（W10）
export type FileSyntaxV1 = {
  isModule: boolean;            // 有 import 或 export
  importNames: string[];        // import 的本地名，加 require(…)、动态 import(…) 解构出的绑定名
  boundNames: string[];         // 文件里任何声明或绑定的名字（含 importNames）
  globalAugmented: boolean;     // 有 declare global 或 declare module '…'
};
export type SyntaxTreeV1 = { readonly path: string; readonly sourceFile: import('typescript').SourceFile;   // W10 那个 Syntactic 语言服务自己的树（getNonBoundSourceFile），不另建；同一份文字一次调用只建一次（W10）
  navigationItems(): NavItemV1[] };                                                                         // 从同一个语言服务取导航树，不再解析
export function syntaxTreeOf(path: string, text: string): SyntaxTreeV1;
export function fileSyntaxOf(tree: SyntaxTreeV1): FileSyntaxV1;
export type NameUseV1 = 'free' | 'other';  // free = 代码里的自由标识符（W4）
export function namesInRanges(tree: SyntaxTreeV1, ranges: LineRange[] | null, names: readonly string[]):
  { name: string; textual: boolean; uses: NameUseV1[] }[];   // ranges 为 null 是整个文件；textual = 原文里有这个字（注释、字符串也算）

// src/core/workspace/ports.ts（W）
export type ReferencePriority = 'write' | 'run_end' | 'button' | 'agent' | 'background';
export type ReferenceQuestionV1 = {
  definition: { path: string; name: string; line: number | null };   // X：按名字找导航项，同名多个时按存下的名字行挑
  evidence: { path: string; ranges: LineRange[] | null };            // null 是整个文件
};
export type ReferenceAnswerV1 =
  | { status: 'found' } | { status: 'not_found' }
  | { status: 'unverifiable'; reason: 'not_in_project' | 'project_references' | 'undecided' }
  | { status: 'failed' };   // 读不了、取消、线程崩了、让位没核到。时限不在这里（R6 自己掐）
export type ReferenceCheckRequestV1 = {
  workspace: WorkspaceRef; priority: ReferencePriority;
  groups: ReferenceQuestionV1[][];   // 一组是一条联系的全部问题；最多 NOTE_LINK_VERIFY_MAX 组
};
export type ReferenceCheckResultV1 = {
  answers: ReferenceAnswerV1[][];                     // 和 groups 同形
  analysed: { path: string; digest: string }[];       // 第二档实际分析的每个文件的原始字节摘要（W8）
  config: { path: string; digest: string } | null;    // 这次建程序实际用的配置；digest 是解码文字的 sha256（同 F3 的口径）
};
export interface ReferenceAnalyzerPort {
  verify(ctx: CoreCallContext, request: ReferenceCheckRequestV1): Promise<WorkspaceResult<ReferenceCheckResultV1>>;
  close(): Promise<void>;
}

// src/core/workspace/workspace-tools.ts（W12）：WorkspaceToolsHandle 加一个方法，不加进 WorkspaceToolsPort
//   readWorkspaceFiles(ctx: CoreCallContext, input: { workspace: WorkspaceRef; paths: readonly string[]; maxBytes: number }):
//     Promise<WorkspaceResult<WorkspaceResult<WorkspaceFile>[]>>;
//   外层是开访问的结果；里层和 paths 同序，每项同 readWorkspace（version: working_tree）的结果；一次访问，读经 Kernel 的 readMany（W12）。

// vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox.ts（W12，Kernel 补丁源；`node scripts/build-kernel-patch.mjs --write` 生成 dist 的 4 个产物）
//   WorkspaceSandbox 加 readMany(relativePaths: readonly string[], maxBytes?: number, options?: { signal?: AbortSignal; via?: 'sync' | 'async' }):
//     Promise<({ ok: true; file: WorkspaceFile } | { ok: false; error: WorkspaceSandboxError })[]>;
//   和 relativePaths 同序；每项同 read(path, maxBytes) 的结果或它抛的错（码、消息相同）。via 只给测试（E2-34）：生产不传，按 statfs 自动选（W12）。

// src/core/workspace/native-single-file.ts（W，新；Python/C++ 单文件查，W11）
export type NativeSymbolV1 = { name: string; kind: string;
  start: { line: number; column: number }; end: { line: number; column: number } };   // 名字那一段；kind 给对拍用
export type NativeLookupV1 =
  | { status: 'parsed'; exact: boolean; symbols: NativeSymbolV1[] }
  //   exact：C++ 用了 compile_commands.json 里这个文件的参数做精确解析（工作区头文件，加 W11 第 1 条放进的系统头文件目录），
  //   而且这次解析没有 error/fatal 级诊断（同 scripts/cpp-source-query.py:345 的 hasErrors）；有诊断或退回的单文件解析都是 false；Python 总是 true
  | { status: 'unsupported' } | { status: 'unavailable'; reason: string };   // unsupported：解释器或 libclang 不可用，或这个文件的编译参数认不出（同 cpp_index，W11）；unavailable：超时、进程崩溃、解析失败
export interface NativeSingleFilePort {
  lookup(ctx: CoreCallContext, input: { language: 'python' | 'cpp'; path: string; text: string; digest: string;
    mode: 'read' | 'write' }): Promise<NativeLookupV1>;
  close(): Promise<void>;
}

// Host 路由（R）
//   architecture/semantic-links/check  { items: { noteId: string; version: number }[] }   // 1–NOTE_LINK_VERIFY_MAX 条
//     → { items: { noteId: string; version: number; verification: LinkVerificationV1 | null }[] }   // null：不是 link

// src/core/agent-runtime/link-check-tool.ts（H，新；只读核对工具，E2R1 裁定 18）
export const LINK_CHECK_TOOL_NAMES = ['check_links'] as const;
//   check_links  { items: { noteId: string; version: number }[] }   // 1–NOTE_LINK_VERIFY_MAX 条，strict，顶层 object
//     → { items: { noteId: string; version: number; verification: LinkVerificationV1 | null }[] }   // null：不是 link
export function createLinkCheckTools(config: { context: CoreCallContext; check: Pick<NoteCheckPort, 'checkNotes'>;
  texts?: Readonly<Record<string, ToolTextV1>> }): { names: readonly string[]; create(workspace: WorkspaceSandbox): ToolDefinition[] };
//   handle 的形状同 createGraphTools（graph-tools.ts:329–331）
```

### 2.1 W：工作区分析

- **W1 一个 Host 一个分析线程。** 第二档放进一个 `worker_threads` 线程；第一次要用时才起；崩了以后，那次请求的未答部分回 `failed`，下次要用时重起；Host 关闭时先停它（CP 在平台关闭时调 `close()`）。不开多个线程，跨进程不共用。线程文件的写法要让生产可达检查看得见：分析器模块值导入线程模块（例如导入它导出的自身 URL），起线程时传 `workerData: { role: 'reference-analysis' }`，线程的入口代码放在 `!isMainThread && workerData?.role === 'reference-analysis'` 判断里（F38：被值导入的文件的顶层语句算可达）；不改 `production-reach.ts`。只看 `!isMainThread` 不够：vitest 用 `pool: 'threads'` 时测试文件本身就跑在 worker 里，被值导入的线程模块会把入口挂到 vitest 的 `parentPort` 上（§3.2 第 5 项：5 个未处理错误；`vitest.config.ts` 没设 `pool`，默认 forks，今天能过但脆）。§3.2 第 5 项已验证这个写法：vitest 的 forks、threads 和 tsc 构建后都能起线程，生产可达检查 0 个走不到；第一次问 0.24–0.27 秒（构建后 0.36–0.46 秒，含线程里载入 TypeScript），之后不到 1 毫秒。（设计 §3.3；§1 第 6 条；115-2）
- **W2 先后。** 一次只建一个程序。排队按 `write` > `run_end` > `button` > `agent` > `background`，同级先来先做。`background` 的请求按组（一条联系一组）做，每做完一组看有没有更急的在等；有就停，余下的组回 `failed`。读文件和建程序那一段不打断（一次 `verify` 只建一个程序，W3），所以写最多等一次正在做的核（§3.2 第 8 项：缓存满、预取后约 2.2–2.5 秒；缓存空或 Host 刚启动 4–9 秒）。（设计 §1 第 6 条、§3.4、§4.4；§9-6(a) “排在写入闸门之后”）
- **W3 程序只为这次请求建、用完就丢。**
  - 根 = 这次全部证据文件 + 全部定义文件 + 配置里的 `.d.ts`；其余文件由 TS 沿 import 补齐。库文件也同捕获（TQ:305），经这次访问读。
  - 配置：主线程用这次访问的 `inventory` 列出路径（每次核都重列，不跨次复用，§5），过滤同捕获（`project-source-snapshot.ts:117–121`），拼成 `configureTypeScriptProject` 要的表（F43）：全部路径都是键；只有配置文件和它 `extends` 链上的文件带内容（链上缺的读一次再解析）；其余条目不带内容、也不会被读。为此这个函数的参数从 `ReadonlyMap<string, CapturedProjectFile>`（TQ:102）放宽成 `ReadonlyMap<string, { readonly content?: string }>`（函数只用键和 `content`，TQ:104–109），配置算法一字不改，两个现有调用（TQ:295、`typescript-light-scan.ts:205`）传完整表、不用改；没有内容的条目不放 `content` 字段，不用空字符串代替（空字符串会让链上缺的文件读成空配置、不报错）。链上的文件读不了，这次回 `failed`。配置选择规则就是这个函数里的那一条（先 `tsconfig.json` 再 `jsconfig.json`），线程里不另写配置解析，G5 也不另写（A12）。
  - 文件范围和过滤同捕获（F18）。读文件经主线程，用 `verify` 收到的上下文开一次访问读完这次要的文件（设计 §3.3 “每次核开一次访问”；同 `readWorkspace` 的读口和权限）；平台身份由 R14 的包装给。读的次序（§3.2 第 7 项）：先把这个工作区上一次核读过、这次清单里还在的文件一次读齐（预取：主线程内存里每个工作区只留最近一次读过的路径集合，Host 重启就丢），再按线程报的缺文件补读；每一轮都经 W12 的 `readWorkspaceFiles` 一次读完（Kernel 的 `readMany`，提速裁定第 3 条；718 个文件偏忙时 1,249 毫秒变 35 毫秒，每次核估省约 1 秒，没有和整次核一起量过）。预取只改先读哪些文件：程序仍由 TS 沿 import 补齐，答案不变；它也不是 §5 的“按计划或改动范围预先加载”，只在一次核里读。量的（机器偏忙）：往返 13–19 轮变 1 轮；缓存满时一次核约 4.4–5.5 秒变 2.2–2.5 秒。
  - 不做常驻的整项目服务。（设计 §3.1、§3.3；§1 第 3 条）
- **W4 自由标识符（第一档用，`namesInRanges` 的 `free`）。** 范围原文里按词边界找名字，每找到一处算一处。代码里的标识符，不在 `.`、`?.` 后面、不是属性键、不在限定名里、不在 `import('…')` 类型里、不在 `export … from` 里，算 `free`；其余各处（含注释、字符串里的）都是 `other`。`textual` = 至少一处。（设计 §2.3；复函第 1 条）
- **W5 找 X。** 在 X 的文件里按名字找导航项（`navigationItemsOf`）：恰好一个就用它；同名多个时取名字行等于存下的行的那个；挑不出回 `failed`；一个都没有回 `not_found`。类型别名里的字段不是导航项（F50），写的时候就存不下，这里不另按文字找。位置取 `start`（同写时，TQ:207–209）。（设计 §3.1）
- **W6 判法。** 在这个程序上开语言服务，`getDocumentHighlights(X 的文件, X 的位置, 这个程序的全部源文件)`，只留证据文件里、落在证据范围里的命中，X 自己那一处不算（同 `LE:252–254`）。列表要含整个程序：TS 要求列表里有 X 自己的文件，没有就抛 Debug Failure（TS 6.0.3 `lib/typescript.js:153971`）；TS 的导入追踪只在列表里找导入者（`:172596–172600`），证据经中转文件导入 X 时（`export { X } from`、`export *`、`export * as`、先导入再导出，多层也一样），中转文件不在列表里就一个都找不到，整项目查询却找得到（核对时在内存小程序里试过四种中转）。本仓库常见这种中转（`mailbox-service.ts:79–82`、`agent-runtime/index.ts:1`）。耗时由 §3.2 末的空闲重量量。有命中 → `found`。没有命中时：范围的代码里 X 的名字有一处作属性出现、编译器在那一处又取不到这个属性 → `unverifiable`（`undecided`），否则 → `not_found`。作属性出现：在 `.`、`?.` 后（含类型里的限定名），在 `[…]` 里的字符串，解构里的属性名，有上下文类型的对象字面量里的属性名（后两种含简写）。取不到：前两种是编译器在这一处解析不出符号（`.` 前的对象解析不出来、是 `any`，或它的类型里没有这个属性；`any` 第二档本来不能说，设计 §5 `:256`）；后两种是被解构的值的类型、字面量的上下文类型里没有这个属性（含这个类型解析不出来）。范围里别的解析不出来的名字都不算，包括只作自由标识符出现、解析不出来的 X 的名字（导入没了），和没有配置时（`noLib`，TQ:114）的 `String`、`Map`、`console` 这类全局名：引用 X 要写出 X 的名字（R5 第 4 条的前提），解析不出来的自由标识符不指向 X（R5 第 5 条的前提），程序外的全局声明和模块扩充（设计 §3.1 `:145`）只能经属性所属的类型改变答案。这一条收窄了设计 §3.1 `:145`、§5 `:256` 的“范围里有解析不出来的名字或属性”：§3.2 第 4 项量出，照原写法，没有配置的项目里真的找不到会永远不下结论、写时照收（lead 裁定）。证据文件或 X 的文件不在配置的项目文件里 → `unverifiable`（`not_in_project`）；配置有项目引用 → `unverifiable`（`project_references`，同 TQ:127）。不自己照抄 TS 的关联规则。（设计 §3.1；复函第 3、7 条；§3.2 第 4 项）
- **W7 解析缓存。** 在线程里，所有请求共用。键 = 路径 + 内容摘要 + 规范化后整份编译选项的摘要 + 这个文件的模块格式（最近的 `package.json` 定，每次建程序重算）。按源文字节做 LRU，上限 24 MiB 源文字节（W 的模块内常量，不进 `NoteCheckLimits`）：§3.2 第 6 项量到，缓存里每字节源码绑定后约占 30–32 字节堆，24 MiB 约 0.75 GiB；本仓库一次核的文件集 14–18.8 MiB（约 0.42–0.59 GiB），装得下一次核的全部文件。某个工作区的配置变了，它旧选项下的条目丢掉；模块解析每次建程序重算。几个工作区共用一份（路径都在 `/workspace/` 下，F18）。（设计 §3.2；§1 第 3 条；复函第 14 条）
- **W8 `analysed`、`config`。** `analysed` 回主线程交给线程的每个文件的原始字节摘要（就是那次读口读到的 `digest`）；`config` 回这次实际用的配置路径和解码文字摘要，没有配置回 `null`。（设计 §4.1；A12）
- **W9（第 1 稿的“分析器自己的时限”）删掉。** 时限由 R6 在外面掐；分析器照常答完，答完的结论照 R7 记（设计 §4.2 “只记第二档完整跑完得出的结论”）。
- **W10 第一档的单文件函数。** `navigationItemsOf` 把 TQ:206–222 的访问逻辑抽成纯函数，捕获和第一档共用；捕获的 `symbols` 结果字节不变。单文件取导航树用只含这一个文件的语言服务，开成 `ts.LanguageServiceMode.Syntactic`（只解析、不建程序），`noResolve`、`noLib`，目标 ESNext（同 TQ:335）；行列用公开的 `ts.getLineAndCharacterOfPosition({ text }, 位置)` 算，不调 `getProgram()`（Syntactic 下它回 `undefined`；默认模式下调它会再解析一遍：§3.2 第 3 项实测两遍 342 ms/MiB、一遍 149 ms/MiB，671/671 个文件结果相同）。共用一棵树（11-04 提速，P1）：`syntaxTreeOf` 建这个 Syntactic 语言服务，`sourceFile` 是它自己的那一棵（`getNonBoundSourceFile`，就是 `getNavigationTree` 用的那一棵；TS 6.0.3 `lib/typescript.js:154031–154033`、`:154082–154083`，综合核过，`speed-study-judge.md:61`），`navigationItems()` 从同一个语言服务取导航树，`fileSyntaxOf`、`namesInRanges` 收这棵树，一份文字只解析一遍，不另调 `ts.createSourceFile`；`navigationItemsOf(path, text)` 就是 `syntaxTreeOf(path, text).navigationItems()`。`getNonBoundSourceFile` 不在 `typescript.d.ts` 里：TS 升级时入口没了会直接抛 `TypeError`，E2-03 红，不会悄悄答错；不照抄 TS 建树的选项另建一棵（P1b，抄错一项导航树可能悄悄不同）。量的（1 MiB）：空闲 104–121 毫秒、忙时 153–237（两遍时 176–200、249–323）；671 个文件语法事实和导航树 0 个不同。同一份文字一次调用只建一棵（§2.0）；E2-01、E2-02、E2-03 经它调用，期望不变。（设计 §2.4、§5 末条；提速裁定第 1 条）
- **W11 Python/C++ 的单文件查（§9-7）。**
  - **一个执行器。** 常驻进程在 `analysis-runner.ts` 上加一个常驻模式（同一套重起、超时、输出上限），不另写进程管理（决定 78；F7）。每个 Host 最多两个常驻进程（Python 一个、C++ 一个），第一次要用时才起；解释器或 libclang 不可用，回 `unsupported`；超时、进程崩溃、解析失败，那次回 `unavailable`，崩了的下次要用时重起；Host 关闭时停掉（CP 调 `close()`）。
  - **Python。** `scripts/python-source-query.py` 加一个只用标准库的模式（照 `import_graph` 的做法，argv 分派）：`ast` 单文件按名字找 `def`、`async def`、`class`，规则和探索工具的访问器相同（`exploration-tools.ts:21`：名字、种类、行、末行），另给名字那一段的位置。结果按“路径 + 内容摘要”缓存在进程里，不装新东西。Python 单文件就准，`exact` 总是 `true`。
  - **C++。** `scripts/cpp-source-query.py` 加一个单文件模式。
    - **参数。** 有 `compile_commands.json` 时，用这个文件的真实编译参数和头文件路径只解析这一个文件（精确解析）。参数就是今天 `cpp_index` 的那一套：`compile_unit` 过滤后的参数（`scripts/cpp-source-query.py:124–206`，认不出的参数照旧回 `unsupported`），加 `:246` 那一串（精确解析去掉其中的 `-nostdinc -nostdinc++`，下面第 1 条），虚拟文件系统 `fallthrough: false`（`:238`），只看得见经读口读到的工作区文件和下面第 1 条放进的系统头文件。解析选项照 §3.2 第 9 项量过的：`PrecompiledPreamble`、`CreatePreambleOnFirstParse`、`KeepGoing`（include 找不到时照样往下解析）。`symbols` 只收名字在这个文件里的函数、方法、构造、析构、类、结构和它们的模板（第 9 项对拍的那几种）。libclang 和 python3 的位置同现有分析器（可信注入的 `sourceAnalyzers`，`CP:428–433`；没给用 `cpp-source-index.ts:61`、`:66` 的默认），不是 libclang 18 回 `unsupported`（`scripts/cpp-source-query.py:42`、`:62–63`）。
    - **系统头文件（用户 11-04 选乙，§0.1 第 4 条）。** 精确解析也读编译器自己的头文件目录，六条：
      1. 只读，只放进工具链默认 include 搜索列表里的目录（含 libclang 自己的资源目录和 C++ 标准库的目录）。列表从加载的 libclang 问出来，不猜路径，不拿别的编译器的目录顶替：用第 4 条探测那次解析带 `-v`，读出 “#include <...> search starts here” 之后的目录；或者取那次解析实际包含到的文件所在的目录。W 选一种，施工回复里写出本机的列表。精确解析去掉 `:246` 里的 `-nostdinc -nostdinc++`；虚拟文件系统照旧 redirect-only（`fallthrough: false`，`:238`），系统头文件也逐个文件映射（`file` 条目，同 `:220–239` 工作区文件的拼法），只收真实路径（解开符号链接后）仍在列表里某个目录下的文件；不用 `directory-remap`：它会跟着目录里指到外面的符号链接走，`fallthrough: false` 和参数过滤都挡不住（E2R3-01）。别的路径照旧看不见（`:220–221` 的规矩只放宽到这些文件）；`compile_commands.json` 里指到工作区外的 `-isystem`、`-I`、`-resource-dir` 照旧拦下（`:182`、`:511–513`）。这几个目录里的文件由进程只读地直接读，不经读口。
      2. 只报工作区文件里的符号，系统头文件里的不报。
      3. 一个翻译单元用到的全部头文件（含系统头文件）的摘要进 preamble 复用判断（下面“头文件怎么到进程”的口径，E2-31a），变了就重建。
      4. 能不能用：起进程时用一个只含 `#include <cstddef>` 的 C++ 内存小文件解析一次（同时用到资源目录和 C++ 标准库）；解析不出（有 error、fatal 级诊断，同第 5 条）就记“精确模式不可用”，这台机器上照甲的读法（只看工作区文件，照旧带 `-nostdinc -nostdinc++`，同 `cpp_index`），不猜路径。
      5. 这次解析有 error、fatal 级诊断（同 `:345` 的 `hasErrors`）就 `exact: false`：找到照常读，找不到照 R3 读 `unchecked`，不读 `symbol_missing`。§3.2 第 9 项：只看工作区时，本机 CMake 的 5 个编译单元每个 26–39 个错误，用了系统类型的声明认不出；读系统头文件后诊断全 0。
      6. 这一条放宽记成决定 117（§7）：用户 11-04 放宽了 C++ 分析器“只读工作区文件”的规矩，只放宽到编译器自己的头文件目录，只读。
    - **宏。** 工作区头文件和放进来的系统头文件里的宏、`-D` 和 `#ifdef` 照真实编译展开；没有诊断时 `exact: true`。
    - **复用。** 头文件那部分用 libclang 的 preamble（`CXTranslationUnit_PrecompiledPreamble` 加 `clang_reparseTranslationUnit`）。翻译单元按“路径 + 这个文件这次的编译参数”留在进程里，参数身份就用 `scripts/cpp-source-query.py:211` 的 `json.dumps(args)`，不另写；参数变了或头文件改了，就丢掉重建。`lookup` 每次都带上这个文件当前的编译参数（这次读到的 `compile_commands.json` 里它那一条；W 在主线程这一侧用收到的上下文读，平台身份由 R14 的包装给）。
    - **退回。** 没有 `compile_commands.json`，或读的时候这个文件的 preamble 还没建好（含参数变了、刚丢掉的）：退回不带头文件的单文件解析（`CXTranslationUnit_SingleFileParse`，§3.2 第 9 项量的就是它，每个 2–6 毫秒），`exact: false`；有 `compile_commands.json` 时并在后台用精确解析的参数为它预热一次 preamble（读不等）。退回的解析认不出写在类外的成员定义（`void Foo::bar() {}`；第 9 项两个文件里全没认出）：没有 `compile_commands.json` 的项目，这类成员写时照今天存成文件锚点、警告 `symbol_unresolved`（G8），读时没有函数定位可查；有 `compile_commands.json` 但翻译单元还没建好时读到的，找不到照 R3 读 `unchecked`。
    - **写。** 写的时候（`mode: 'write'`）不受 R3 的读时等待上限，有 `compile_commands.json` 就照真实参数解析：留着的翻译单元参数相同、头文件摘要都没变就复用它（`clang_reparseTranslationUnit`），否则丢掉重建、留下新的 preamble。读和写用同一个复用判断（E2-31a、b 用两次写测它）。
  - **头文件怎么到进程（lead 11-03 晚，回第 3 稿起草方第 2 问）。** 编译参数由 W 的 `lookup` 实现每次自己读 `compile_commands.json`（用收到的上下文），把这个文件那一条交给进程，公开的 `lookup` 输入不加字段；工作区头文件的内容（系统头文件见上面第 1 条）照分析线程的做法（设计 §3.3）由主线程经读口取：进程报缺哪些文件，主线程读了交过去，照今天脚本的虚拟文件系统拼法（`scripts/cpp-source-query.py:219–239`）。preamble 按“这些头文件的摘要”判断还能不能用：摘要都没变就复用，有一个变了就重建。
  - **位置。** 都取名字那一段（同 TS 的 `nameSpan`，TQ:207–209），所以签名摘要照 `signatureDigestOf(symbolRangeText(…))` 算，和 TS 同一个口径。
  - **对拍。** 单文件结果和现有整项目分析器（`python_index`、`cpp_index`）逐个对拍（§3.2 第 9 项）。Python 照旧含签名摘要（`python_index` 本来就取名字那一段，`scripts/python-source-query.py:676–678`）；`python_index` 一侧只留种类是 `function`、`class`，而且名字前面紧挨着 `def`、`class` 的项，先去掉 import 名（它用 Jedi 的 `get_names(definitions=True)`，会把 import 进来的名字也列进去，`:715`；§3.2 第 9 项就是这样比的，40/40 一致）。C++ 比名字、种类和名字起点（行、列）；`cpp_index` 的结束位置是声明 extent 的末尾（`scripts/cpp-source-query.py:109–114`），不拿来比；签名摘要按名字那一段用同一套算法（`signatureDigestOf(symbolRangeText(…))`）两边重算再比，不直接用 `cpp_index` 的范围算的摘要。`cpp_index` 的公开结果不改。
  - （§9-7；设计 §9-7 改过的做法；F6、F7）
- **W12 一次访问读多个文件（§3.2 第 1 项超了，要做；11-04 提速定成 Kernel 的 `readMany`，提速裁定第 1、2 条）。** `createWorkspaceTools` 返回的句柄（`workspace-tools.ts:49–56`）加 `readWorkspaceFiles`（§2.0）：开一次访问，读完给的 `paths`；每个路径的结果和单个 `readWorkspace`（`working_tree`）一样，一个读不了不影响别的。不加进 `WorkspaceToolsPort`（`tests/runtime/B1-kernel-assembly.test.ts:117` 手写了整个端口）。第一档的门读（R4）和第二档主线程那一侧的读（W3）都经它。
  - **为什么改 Kernel。** 今天每读一个文件，Kernel 都从根逐级打开目录（`#openRoot`、`#openParent`，补丁源 `vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox.ts:792–835`），再对文件 open、fstat、read、fstat、close（`#readAt`，`:837–883`）：每个文件约 18 次异步 fs 调用，时间几乎都花在线程池往返上，同时读 4 个也要约 168 毫秒/200 个文件。逐级打开、核根身份、单文件检查都是沙箱的私有成员，放在 src 做就要把约 100 行边界代码抄一份。这个补丁源已是受管源（`scripts/build-kernel-patch.mjs:33`）：改它，跑 `node scripts/build-kernel-patch.mjs --write` 生成 dist 的 4 个产物（`.js`、`.js.map`、`.d.ts`、`.d.ts.map`），不手改生成物（AGENTS 第 6 条）；`vendor/coding-agent/patches/README.md` 照先例加一节。
  - **Kernel 的 `readMany`（§2.0）。** 放在 `read`（`:337–351`）旁边，用同一个沙箱实例。每个路径照旧过 `#normalize`（`:779–790`）；只开一次根（`#openRoot`，`:792–808`，核 dev:ino）；结果按输入顺序逐路径给读到的文件，或同一个 `WorkspaceSandboxError`（码、消息同 `read`，`mapIoError` `:139`），一个坏了不影响别的；读到的文件和 `read` 一样记进 `#sessionExpected`（`:346`）。`#readAt` 打开文件之后的检查（是不是普通文件、大小上限、读后再 fstat 比 dev:ino、size、mtime、解码、摘要）抽成一个模块内函数，两种读法都调它，检查只有一份。
  - **两种读法，按文件系统自动选（用户 11-04：“自动看目录或者磁盘格式就行……两种都会用……linux 也算”）。** 第一次 `readMany` 时对工作区根做一次 `fs.statfs`，这个实例记下结果（平台每开一次访问就建一个新沙箱，`src/core/workspace/access.ts:102`，所以是每次访问一次）。`type` 在本地盘名单里（ext2/3/4 `0xEF53`、xfs `0x58465342`、btrfs `0x9123683E`、tmpfs `0x01021994`）用同步版；不在名单里的（WSL 的 drvfs/9p、NFS、FUSE、overlay、认不出的）和 `statfs` 失败的用异步版。`via` 只给测试强制选一种（§2.0），生产不传，写法同 CP 的 `sourceAnalyzers`“生产不传”（`CP:428–433`）。
    - 同步版：同步系统调用；路径排序后按目录栈走，每个目录只开一次（从父目录句柄经 `/proc/self/fd/<fd>/<名字>`，`O_RDONLY|O_DIRECTORY|O_NOFOLLOW`，fstat 确认是目录），离开这段子树就关，最多同时开“深度 + 1”个句柄；某一级目录开不了，它下面的文件都回同一个错，消息按各自的路径给；连续做满约 1–2 毫秒就用 `setImmediate` 让出一次事件循环（按时间让，不按个数），让出时看 `signal`。
    - 异步版：目录句柄按前缀缓存，同时读 4 个，直接调 `#readAt`。
    - 批末复核，两种都做：从根按名字、用 `O_NOFOLLOW` 把这批开过的每个目录和根再走一遍，比 dev:ino；对不上的，这批里经过它的路径都回读不了（第一档读 `unchecked`/`unavailable`），不会把改名后别的目录里的内容记在原名下。约 10 行、约 0.1 毫秒。
  - **src 一侧。** `access.ts` 的 `WorkspaceReadAccess`（`:47`）加 `readMany?`：逐路径判 `allowed`（同 `:142`），判不过的回 `forbidden`，其余交给 `sandbox.readMany`。照 `listObservationFiles?` 的先例写成可选（`access.ts:60–61`：手写的访问对象照样过类型检查；测试里手写的至少有 `tests/data/S8D-capture-error.test.ts:16`、`tests/data/workspace-capture.test.ts:78`、`:521`）；没有它时下面的入口逐个调 `read`，只给手写的测试替身，生产的访问总有它（同 `project-source-snapshot.ts:249–250`）。capture 的登记处加一个读多个工作树文件的入口：只 `withAccess` 一次（`capture.ts:617`），逐路径做 `readWorkingTreeFile` 同样的前置检查（`workspace-read.ts:59–63`），每条错误用 `readFailure`（`:45–54`）映射成今天同样的码。`ports.ts`、`workspace-tools.ts` 挂上它；`noteCheckWorkspace` 的包装见 R14。
  - **量的（提速研究方向 1，ext4，每项 5 次）。** 43 个刁难用例，两种读法都和 `read` 逐路径相同（内容、摘要、字节数、mode、身份、错误码、消息）；200、256、718 个真实文件的摘要相同。256 个文件：同步版空闲 13–28 毫秒、偏忙 18–43 毫秒，最长卡事件循环 3–10 毫秒；异步版 42–113 毫秒。drvfs 上同步版 1.0–1.1 秒、异步版约 0.4 秒（今天 4.3 秒），所以那里用异步版。
  - 自动选那一步和批末复核没有验收行（要 drvfs 挂载、要造改名竞态），只靠审查；`read` 对 `readMany` 是 E2-34。估 Kernel 约 +115/−8，src 约 45。（设计 §2.7；提速裁定第 1、2 条）

### 2.2 F2：改形（流程的读）

冻结的 F2 去掉读时重核以后剩下的部分（设计 §6.5；开工裁定 §2.2 F2 那一段去掉闸门、预算、`verifyStoredLink`）。

- **FR1 `readSemanticFlows`。** `limit` 1–50；`project` 范围翻 `(project, kind, state)` 索引，`kind = 'flow'`，三个可见状态，一页最多核 `NOTE_FLOW_CANDIDATE_MAX = 500` 个候选，没走完给 `cursor`；`module`、`file` 范围先取范围里的联系头（不先按现行过滤），再找引用了它们的流程；`cursor` 绑定请求和范围。（8E L9 :546–558；开工裁定 §2.2）
- **FR2 `expandFlowForHead`。** 步骤的联系去重，流程头和所有不同的步骤头一次 `checkHeads`；每步的问题按 `not_current`、`broken`、`stale`、`unchecked`、`null` 取第一个；流程的 `freshness` 和 `currentEligible` 照 8E :556 合成；`gapsAfter` 按端点身份比。不开捕获、不建程序。（8E :550–558；开工裁定 §2.2）
- **FR3** `withCheck` 产出 flow 项；`NoteReadDependencies.expandFlowForHead?`，没绑定时遇到 flow 项回 `unavailable`；`flowCandidateMax?` 透传。（开工裁定 §2.2）
- **FR4** 路由 `architecture/semantic-flows`，和 links 同一个门；`core-http-types.ts` 的别名；CP 接线。（8E :297–304；开工裁定 §2.2）
- **FR5** 删 `note-related-scope.ts:81` 的 `isGeneralKind`，`:170` 改用 `src/contracts/note.ts:55` 的 `isGeneral`。（开工裁定 §2.5）
- **FR6** links、flows 两个读口的坏 `scope` 回 `invalid`（今天是 500）；`limit` 越界的原因文字不改。（`close-todo.md:34`；决定 113-1；书 :729–731）
- **FR7** 允许清单删 `SemanticFlowV1`、`NOTE_FLOW_CANDIDATE_MAX` 两条 `kept-for`（`tests/architecture/production-reach-allowlist.json:1440`、`:1452`）。（`close-todo.md:27`）
- **FR8 流程的两处额度人口。** 照开工裁定 :845–858 冻结的代码改 `RM` 的 `overQuotaOf`（F45）：目标人口 `link`、`flow` 合算（阈值 `goalLink`），一般注记的目标人口不算 `link`、`flow`；`flow` 的项目人口按 `(projectId, 'flow', 'accepted'|'reviewed')` 读全，超过 `projectFlow`（软额度 100）读 `overQuota: true`，不拒写。（开工裁定 :842–866；`DR8eF2.out.md:21`）
- F2 不碰 `NV`、`LE`，不加 `refs_pending`。（设计 §6.5）

### 2.3 R：第一档读、内存结论、核对入口

**R1 读从不建 TS 程序。** 不带 `verifyLinks` 的 `checkNotes`、全部 `checkHeads` 只做第一档。读侧删 `recheckSymbol`（NV:342–413）、它的循环、`SYMBOL_RECHECK_LANGUAGES`、`SYMBOL_RECHECK_PAGE`、`symbolHitsMax` 的读侧用法、`linkRechecksRemaining`。按锚点读找候选路径的文本捕获（F14）不在这条里，不动。（设计 §0、§2.4；复函第 12 条；115-2）

**R2 摘要口径。** 一次读同时拿到原始字节摘要和解码文字；对解码文字再算一次 sha256。按存下的字段各比各的口径：
- 证据的 `fileDigest`、依据文件：比原始字节摘要；
- 符号定位的 `fileDigest`、`analysisConfig.digest`：比解码文字摘要。
- `observedFiles[].digest` 照旧给原始字节摘要。
- 每条证据只比它自己存下的摘要，不拿这个路径第一次观察的结论（F2-02）。
（设计 §2.2；复函第 1 条；8E C2 :439）

**R3 第 4 片的锚点（文件锚点带定位的）。** 文件没变 → 不解析，照旧 `live`。文件删了 → `retired`（`file_deleted`），不变。变了 → 按定位的 `language` 单文件解析，按存下的 `qualifiedName` 找：
- `typescript`：`navigationItemsOf`；`python`、`cpp`：W11 的 `lookup`（`mode: 'read'`）。
- 恰好一个，或同名多个时存下的名字行挑得出一个 → 比签名摘要（`signatureDigestOf(symbolRangeText(…))`，取定位那一段，同写时；有名字的项那一段就是名字，所以只有 F41 那类会不同）：相同 `live`，不同推 `symbol_signature_changed`（槽仍 `live`，`freshness: 'stale'`，同今天 F5）；一个都没有 → `retired`（`symbol_missing`）；挑不出 → `unchecked`。
- C++ 的结果 `exact: false` 时：找到照上面算；找不到读 `unchecked`（存疑），不读 `symbol_missing`（§9-7 “找不到读作存疑”）。
- W11 回 `unsupported` 或 `unavailable`、读不了、超文件数或字节预算 → `unchecked`。
- **等待上限。** 一次调用里 Python/C++ 的 `lookup`（`mode: 'read'`）一共最多等 `NOTE_NATIVE_READ_WAIT_MS`（300 毫秒），从这次调用发出第一个 `lookup` 起算，含 W 在主线程读头文件的时间（头文件的读不算进 R4 的 256 个文件和字节预算，由这个上限封顶）。先发出：Python/C++ 定位所在的文件先读（R4 分两次读时的第一次），变了的马上发 `lookup`，不等回答就接着读其余的门文件、做 TS 的单文件解析，所以等待和 TS 的读、解析重叠。11-04 提速以后 TS 那部分最坏约 110–280 毫秒，盖不住这个上限：页上有改过的 C++ 函数注记时，第一档最坏就是约 300 毫秒（§0），仍在 §0.1 第 3 条之内。300 毫秒盖得住读系统头文件后有 preamble 的重解析（§3.2 第 9 项最慢 208 毫秒）；精确首次解析（324–1,378 毫秒）照旧进不了，读时还没有 preamble 的照 W11 退回。到点时先让出一次事件循环（`setImmediate`），收下已经到的回答（主线程在做第一档的同步解析时，进程的回答会排在计时器之后），再把还没回的读 `unchecked`，不读 `symbol_missing`，也不读 `live`。只在这里按时钟封顶：TS 那部分有文件数和字节两个确定的预算（R4），Python/C++ 每次都要经读口重读头文件比摘要（W11），头文件数没有预算。不取消那次 `lookup`、不杀进程：进程照常做完，留下的翻译单元和 preamble、Python 按“路径 + 内容摘要”记下的结果，下次读复用。写（G8）不设这个上限，只受执行器自己的超时（W11）。写法同 R6 的时限；不加注入口。
（设计 §2.4；第 4 片 L23 :266；§9-7；§3.2 第 1、9 项）

**R4 预算。** 一次调用：最多读 256 个文件（不变）；最多单文件解析 `NOTE_SYMBOL_RECHECK_MAX = 20` 个不同文件；解析的文字总字节不超过 `NOTE_READ_PARSE_BYTES_MAX`。同一个文件一次调用只取一次导航树、只建一棵语法树（W10），字节只计一次；第 4 片的锚点（含 Python/C++）和联系的门共用。按摘要记下的解析结果（R7 的第二个例外）命中时不算解析：不占 20 个文件，也不占字节预算，仍算进 256 个读（摘要要读了才有）。超了的那一项读 `unchecked`（`budget`）。门的读经 W12：一次调用先照项的顺序列出这次判断要读的门路径（去重；哪些算进 256、第 257 个起读 `budget`，照今天的 `readPathOnce`，`NV:297–310`），调一次 `readWorkspaceFiles` 读完（有 Python/C++ 定位时分两次：先读这些定位所在的文件，好让 `lookup` 先发出，R3；再读其余的。只改读的先后，哪些算进 256 仍按项的顺序），之后只用这批结果。（设计 §2.4、§2.7；复函第 13 条；§3.2 第 1 项）

**R5 联系的门和第一档的判法。** 先查 R7 的内存结论：版本和门里每个文件现在的摘要都和记下的相等，就用它，不解析。没命中才做下面的。
- **门：** 每条证据的文件；“到”“经过”和符号 key 的定义文件；存下的 `analysisConfig` 的路径和摘要（路径和摘要都是 `null` 时没有配置门，8E :505）。门的读都算进 256 的预算。（设计 §2.2）
- **哪些要重查：** 一条证据，自己的文件、它要引用的定义文件（`referenceFieldsOf`，`LE:225–231`）、配置都没变，就沿用写时的结果。下面三种不沿用、每次读都重做单文件那部分：证据 `fileDigest` 是 `null`；端或 key 有请求却没有定位；存下的是 `unverifiable`（`analyzer_unavailable`）。（设计 §2.3、§4.3）
- **确定断了（列下标），全是单文件语法事实：**
  1. 证据文件没了；按函数名给的范围，函数在这个文件里找不到了；行号范围超出文件末尾。
  2. 字面 key（`data`、`message`、`spawns`，`calls` 的字面 key）：范围里逐行找不到这个字面（复用 `literalInScope`，`LE:234–243`）。
  3. 要引用的 X（“到”“经过”、符号 key）：X 的文件没了；或在 X 的文件里按存下的名字找不到 X。同时这一端读 `retired`（`file_deleted` / `symbol_missing`），照第 4 片。
  4. 接线的字没了：X 是类、接口或枚举的成员（`parentKind` 是 `class`、`interface`、`enum`；类型字面量不出导航项，F50），范围原文里没有 X 的名字（`textual` 为假）；X 是顶层声明，范围原文里既没有 X 的名字，也没有证据文件的任何 `importNames`。
  5. 导入没了：X 的文件是模块（`isModule`）、X 是顶层声明、X 的文件没有 `globalAugmented`；范围里有 X 的名字，每一处都是 `free`；证据文件的 `boundNames` 里没有这个名字；范围里也没有别的 `importNames`。
  - X 的名字是 `constructor`、`default`，或不是普通标识符（计算属性名、索引、调用和构造签名），不走 4、5，直接读存疑。（复函第 1 条）
- **说不准（存疑）：** 引用那部分门变了、1–5 都不成立，一律存疑（第一档从不读出“对得上”，设计 §5）。包括：名字（或可能的别名）还在；X 的名字作为属性出现；配置门变了（字面 key 的检查和配置无关）。
- **照存下的：** `key: null` 的引用部分照存下的 `unverifiable`（`key_not_literal`）；非 TS/JS 文件里的引用部分照存下的 `unverifiable`（`language_unsupported`）。
- **其他：** 同名多个、存下的行挑不出 → `unchecked`（`unavailable`）（8E N3）；读不了 → `unavailable`；超预算 → `budget`。
- **为了判断 X 是成员还是顶层、X 的文件是不是模块，需要时也解析 X 的定义文件**，算进 R4 的预算。
- **合起来（8E C6 的先后不变）：** 有确定断的 → `broken`，`missing` 列全部确定下标；否则有读不了或超预算 → `unchecked`（`unavailable` / `budget`）；否则有存疑 → `unchecked`（`refs_pending`）；否则有照存下的 → `unverifiable`（那个原因）；否则 `verified`。存下的 `analyzer_unavailable` 在这里读作存疑，不读 `unverifiable`（§9-8）。
（设计 §2.3、§2.5；复函第 1、6、15 条；§9-8）

**R6 核对入口（`checkNotes` 带 `verifyLinks`）。**
- 先照 R5 做第一档。只对头版本的项交第二档：`item.version !== head.version` 的项只回第一档，不调第二档、不写内存结论（F23；A17）。
- 读出 `refs_pending`、内存里又没有结论的头版本联系，按 `noteId` 排，取前 `NOTE_LINK_VERIFY_MAX` 条，每条一组，把存疑的那些“证据 × X”交第二档，`priority` 照传。其余的这次照第一档回，留在队列（R8）。
- 合并：`found` 这部分对得上；`not_found` → 这条证据确定断；`unverifiable`（`not_in_project` / `project_references` / `undecided`）→ 这部分 `unverifiable`（`analyzer_unavailable`）；`failed` → 这部分 `unchecked`（`unavailable`）。再按 R5 的“合起来”算这条联系的结果。第二档整个回失败（`WorkspaceResult` 不是 `ready`）：这一批都按 `failed` 合并。
- 存下的 `key_not_literal`、`language_unsupported` 核过以后仍是它，只有确定断时变 `broken`（F2-03）。
- **时限（只对 `agent`）。** `priority: 'agent'` 时，R6 用 `limits.checkDeadlineMs ?? NOTE_CHECK_DEADLINE_MS` 和第二档赛跑：时限先到，这次交第二档的整批联系都回 `unchecked`（`budget`）（§6 第 6 条），不逐组交付：一次 `verify` 只建一个程序、各组一起答完，组和组之间只差毫秒级（偏离设计 §3.5 `:188`“到时已核完的照回”，lead 裁定，§6 第 14 条）。没交第二档的（内存命中、第一档已定）照常回。第二档照常答完，答完时照 R7 记；这次的回复不等它。按钮、后台、`run_end` 不设时限。（设计 §3.5）
- 不是 `link` 的项照普通核对回，不建程序。
（设计 §3.4、§3.5、§4.2；F2-03）

**R7 内存结论。**
- 放在 `createNoteCheck` 的闭包里，每个 Host 一份（CP 只在 `CP:2747` 建一次）。键：项目、工作区、`noteId`；一项：版本、门的摘要表、结论。每条联系只留一项，新的替换旧的。只记头版本。
- 门的摘要表：第二档分析过的文件用它回的 `analysed`；配置用它回的 `config`；门里其余文件用这次第一档读到的摘要。所以“门读完、建程序前文件被改”不会把旧摘要配上新结论。
- **记的条件：** 这条联系这一组第二档的每个答案都属于 {`found`、`not_found`、`not_in_project`、`project_references`} 时，把合出来的结论记下，不管它是 `verified`、`broken` 还是 `unverifiable`（设计 §4.2 “原因确定的 unverifiable”；A10）。另要摘要对得上：`analysed` 里每个这次第一档也读过的文件（门里的文件），摘要都等于第一档读到的摘要；`config` 的路径是门里的配置时，它的摘要也要相等（口径按 R2：`analysed` 比原始字节摘要，`config` 比解码文字摘要；写法同 G4 的摘要比对）。有一个不等，这条联系这次回 `unchecked`（`unavailable`），不记，留在队列（R8）。因为第一档的字面 key、函数范围、行号范围是在第一档读到的字节上判的，两次读之间文件改了，只换摘要会把旧的那一半结论配上新摘要（设计 §4.1 `:215`）。
- **不记：** 这一组有 `failed` 或 `undecided`；第一档自己的结果（确定断、存疑，每次读重算）。时限到了时这次回的 `budget` 不记（结论等第二档答完再按上一条记）。
- 读时命中就用它，也就是“最近一次核的结论优先于写时存的结论”。不另设大小上限（每项估 1–2 KB）。
- **第二个例外：按摘要记的解析结果（11-04 提速，提速裁定第 1 条）。** 也放在 `createNoteCheck` 的闭包里，每个 Host 一份，重启就空。只存确切的答案：导航项和 `fileSyntaxOf` 按（路径，解码文字摘要）存；`namesInRanges` 的答案按（路径，摘要，范围，名字）存；范围或名字没存过就照常解析，算进 R4 的预算。Python/C++ 的单文件查不进这张表（进程自己记，W11）。键里有文字摘要，命中和不命中读出的一样（E2-35），不另写第二套算法。按源码字节做 LRU，上限是 NV 的模块内常量，8 MiB 源码字节（估：研究方向 3 的建议值，它量的每字节源码约 2.92 字节堆是存整份结果的，只存答案更小）。今天文件改过的旧注记每读一次就解析一次，一页里第 21 个起永远读成“这次没核”（`NV:731–741`）；有了它，一份改动只解析一次（E2-36）。
- `NV:1–6`、`:1275` 的注释（“从不存任何东西”“缓存只活一次调用”）改写，写明这两个例外。
（设计 §4.1、§4.2；§1 第 4 条）

**R8 存疑队列。** 第一档读出 `refs_pending`、内存里又没有结论时，把（项目、工作区、`noteId`、版本）放进 Host 内存的队列；只放头版本；同一条只留一项。记下这条的结论，或这条有了新版本，就移出；这条的头版本第一档读出的既不是 `refs_pending`、也不是 `unchecked`（`unavailable` / `budget`），也移出（例如文件改回写时的字节、读 `verified`，或第一档确定断了、读 `broken`；不然它永远占住队首）。读不了、超预算、第二档失败的留着。`doubtfulLinks(scope, max)` 按 `noteId` 给前 `max` 条。只核被读到过的存疑联系。（设计 §4.4）

**R9 断了的联系（给书记计数）。** 只记 `accepted`/`reviewed` 的头版本（和书记的待查读同一个范围，`RM:2598–2610`）；读历史版本不新增、也不覆盖登记。头版本读出 `broken` 时，把（项目、工作区、`noteId`、版本）记进 Host 内存；之后头版本读出不是 `broken`，或有了新版本，就移出。调用带 `heldByRun` 时，读出 `broken` 的项记上它（替换旧值）；不带的调用不清掉已有的值。`brokenLinks(scope)` 照给。时间由 Host 按自己的时钟记（S）。（§9-6；B10）

**R10 `currentEligible`（只对 `link`）。** 在今天的条件上补两项：所有锚点槽都 `live`（今天只看主锚点，F9）；`verification` 不是 `broken`、`unchecked`。`unverifiable` 照常算（8E :498）；存下的 `analyzer_unavailable` 在 R5 已读作存疑，所以不算，直到核过（§9-8）。（设计 §2.5；8E :497）

**R11 执行输入的“注记”一段（只对 `link` 行）。**
- 现行 → 结论行（不变）；`broken` → 只出一行“证据对不上”（不变）。
- 否则：`freshness` 是 `stale`、或 `staleReasons` 不为空、或 `verification` 是 `refs_pending`，出一行“需复查”（只出一次，用现有字符串）；`conflicting`、`sourceUnavailable` 照旧各一行。只有 `unchecked`（`unavailable` / `budget`）是唯一原因时不出行（8E C18 不变，修 `NV:1211` 遮蔽 stale 的问题）。
- **合并：** 只因 `refs_pending` 才出“需复查”的联系，一段里超过 `NOTE_DOUBT_LINES_MAX`（3）条时，这些行都不出，在第一条的位置换成一行合成行；不超过 3 条照逐条出。合成行不加新的行形状，字段取被合并的第一条（按 `noteId` 排）：`anchorKey`、`noteId`、`version`、`kind` 用它的，`conclusion` 用 `''`，`freshness` 用 `'unchecked'`，`label` = `S['note.warning.links_pending.prefix'] + k + S['note.warning.links_pending.suffix']`（k = 被合并的条数；两段新字符串，先例 F29；第一稿文字：前段“这些节点上另有 ”，后段“ 条联系待核，不能当现行结论”）。
- 这一行进不进由 §9-2 定为“出”；书记的 `stale` 读不收存疑（§9-3），收 `broken` 照旧（F11）。
（设计 §2.5、§2.6；§9-2、§9-3、§9-6(b)；8E :564）

**R12 Run 里改文件后的检查（§9-6 主路和 (a)；挂点见 §6 第 1 条）。**
- **挂在哪：** 普通 Work Run 的平台输入通道，在每个 `before_model` 安全点：`ED:1034–1039` 的 `controlInputsFor` 旁边加一个来源，和它合成一个 `InputSupply` 交给 `createMailboxInputSupply` 的 `controlInputs`（只改 `ED`，不改 `execution-inputs.ts`）。审查轮（`unknown_call_review`）不加。这是 Kernel 在 Run 里唯一能交给 agent 一条平台消息的地方：到 `ready_to_complete` 时 Kernel 直接提交完成、不拉输入（F26）。不改 Kernel。
- **查什么：** 每个安全点调一次 `readRunActivityFacts(owner, { through: 'kernel_tail', … })`（F27 的正本；`fromPosition` 用 `ED:771–775` 读到的已完成边界之后的位置），取 `changedFiles.definite ∪ possible`（去掉 `'.'`）。没有改动就交 `[]`。对这些文件，用现有的按锚点读找挂在上面的、这个 Run 看得到的、`accepted`/`reviewed` 的 `link`（五个锚点槽都算，F28），带 Run 自己的上下文。证据在改过的文件里、端不在的联系，这里不查（§6 第 8 条）。
- **怎么查（不等第二档）：**
  ```
  rows = await check.checkNotes(runCtx, { items: links, heldByRun: canonicalJson(runRef) })   // 第一档 + 内存结论，毫秒级
  对 rows 里 refs_pending 的头版本、且这个 Run 没有在等它的第二档的（闭包里一个“在核”集合）：
    void check.checkNotes(runCtx, { items: 这些（最多 NOTE_LINK_VERIFY_MAX 条）,
                                    verifyLinks: { priority: 'run_end' }, heldByRun: canonicalJson(runRef) })
          .catch(() => {}).finally(() => 从“在核”集合移出)
  交给执行者的：rows 里 verification 是 broken 的（第一档确定的，或内存里第二档已核出的）
  ```
  第二档核出断了的，结论进内存（R7）、记上 `heldByRun`（R9），在这个 Run 之后的安全点读到内存结论时交。Run 已经结束的，由书记兜底（S）。同一个文件改了又改，下一个安全点照样重查（不按路径去重）。（§9-6(a)；§1 第 1 条 “agent 调工具尽量不受影响”；A3）
- **交什么：** 每条断了的联系一个输入：
  ```
  inputId   = 'link-break:' + noteId + '@' + version + ':' + missing.join(',')
  text      = renderTemplate(promptTexts, 'link-breaks-input',
                { noteId, version: String(version), missing: missing.join('、') }, toolNames).text
  sourceRef = { kind: 'NoteLinkBreak', runRef, noteId, version }
  已经在 point.acceptedInputIds 里的不交
  ```
  同一条断、同一份文字，`inputId` 和文字都不变，不会撞 `input_conflict`（F37）。存疑的不交（§9-6(a)）。
- **不能让 Run 失败：** 整个来源包在 `try/catch` 里，任何失败（活动读、按锚点读、核对）都 `return []`，不抛（F37）。
- **模板：** 新模板 `link-breaks-input`（`resources/prompts/platform/templates/link-breaks-input.txt`，`version: 1`，`mentionsTools: []`），三个必填槽 `noteId`、`version`、`missing`；`slot-tables.ts` 加一条；照 K2 :553 的做法加进 `PT:386` 的 `DELIVERY_SET_TEMPLATE_IDS`（末尾），准备时冻结（F36）。第一稿正文（包定稿时可改，测试跟着改）：`联系 {{noteId}}（版本 {{version}}）被这次改动改断了：证据对不上（下标 {{missing}}）。交结果之前请重写或撤下它。`
- **skill：** `skill-platform-work` 加一句：平台说哪条联系被你改断了，就在交结果之前重写或撤下；这算工作结果的一部分。句子写在 `{{#tool:record_note}}` 块里，或不出现裸词 `check`；非写不可，按新行号补豁免行（F39）。
（§9-6 主路和 (a)；设计 §9-6 “先找现成的挂点”；决定 21）

**R13 “重新核对”路由。** `architecture/semantic-links/check`，和别的架构读同一个门；`items` 1–`NOTE_LINK_VERIFY_MAX` 条，超了或空回 `invalid`；调 `checkNotes(ctx, { items, verifyLinks: { priority: 'button' } })`；回包按 §2.0 的形状投影，投影放在 `semantic-layer-read.ts`（`readSemanticLinks` 的同一个文件，`core-http-types.ts:384–385` 的别名从它取）。按钮的样子归 E3（D87-1）。这条路由放在 R（不是设计 §7.1 的 H），因为 R 的验收行要用它“核一次”（§3.1）。（设计 §3.4）

**R14 平台身份的第二档和单文件查。** `NoteAnchorWorkspace` 加 `verify?`、`lookup?` 和必填的 `readWorkspaceFiles`；`noteCheckWorkspace` 里，必填的 `readWorkspaceFiles` 同 `readWorkspace`，直接写进 `checked` 的初始化对象（`NA:861`），不在后面补赋值（必填成员缺了，带类型的初始化先编译不过）；`verify?`、`lookup?` 照另外三个可选方法各加一行：
```
const checked: NoteAnchorWorkspace = { readWorkspace: (ctx, input) => workspace.readWorkspace(checking(ctx), input), readWorkspaceFiles: (ctx, input) => workspace.readWorkspaceFiles(checking(ctx), input) }
if (verify !== undefined) checked.verify = (ctx, req) => verify(checking(ctx), req)
if (lookup !== undefined) checked.lookup = (ctx, input) => lookup(checking(ctx), input)
```
CP 把 W12 的 `readWorkspaceFiles`（句柄上的）、分析器的 `verify` 和唯一的那个 `NativeSingleFilePort` 实例的 `lookup` 接进共用的 `noteWorkspace`（`CP:2714–2749`（3642））。这样 agent 的 `check_links`、Run 里的检查、写入闸门、R3 的读、G8 的写都用平台身份读工作区（F33）。两个 `close()` 由 CP 在平台关闭时调（W1、W11 已写）。（设计 §3.3；SF2 的做法）

### 2.4 G：写入闸门换第二档

- **G1 不开捕获。** 删 `openLinkCapture`（LE:257–266）、`referenceHits`（LE:285–306）、`checkSymbol` 和 `resolveSymbol` 的 TS 捕获分支、`loadEvidenceContent` 的捕获比对（LE:316–342）。8E C2 的“捕获和工作树对不上”不再出现，它防的事由 G4 的摘要比对接手。（设计 §3.4、§6.2 L3b 行）
- **G2 符号走第一档。** 三个端、符号 key、证据的 `symbolRequest`：`checkSymbol` 先看扩展名（不变，F44），TS/JS 才往下：从工作树读这个文件一次，`navigationItemsOf`，按名字（请求给了 `range` 时也比名字行，同 NA:370–371）匹配：一个 → 存定位 `{ language, qualifiedName: name, range: 名字行, fileDigest: 解码文字的 sha256, signatureDigest: signatureDigestOf(symbolRangeText(…)) }`；没有 → 没有命中；多个 → `symbol_ambiguous`，按起始行排列候选。不分页，没有命中上限。读文件 `not_found` 当没有命中；`forbidden` 照 M1 退回（证据）；别的失败 → `analyzer_unavailable`。（设计 §2.2 末段、§3.4）
- **G3 证据内容。** 只读工作树；存原始字节摘要（同今天 `LE:330`）。（设计 §2.2）
- **G4 引用走第二档。** 一条联系一次 `verify`（`priority: 'write'`，一组），问题是每条 TS/JS 证据要引用的每个 X（L3a 的表，`referenceFieldsOf`）。`found` → 这条对得上；`not_found` → 进 `evidence_missing`；`unverifiable` 或 `failed` → `analyzer_unavailable`。字面 key 照今天扫已读内容。**摘要比对（接手 C2）：** 对这一部分依赖的每个文件（证据文件、定义文件），`analysed` 里的摘要和 G 自己读到的原始字节摘要不同，这一部分按 `analyzer_unavailable` 存（之后读作存疑，由后台核）。（设计 §3.4、§5 “不在 TS 项目里”、§5 “竞态”；8E C2 :439）
- **G5 `analysisConfig`。** 这条联系有引用部分或符号 key 时，存第二档回的 `config`（路径和解码文字摘要；没有配置存 `null`/`null`），不另写选择规则（W3）。第二档整个失败、没有 `config` 时：照 `configureTypeScriptProject` 同一条规则在工作树找配置文件，存路径和解码文字摘要。只有字面 key 和行号范围或整个文件时 `null`/`null`（8E C5、D1 不变）。（设计 §2.2 末段）
- **G6 结果表和先后不变**（8E L3b 第 1–7 行）。工作区结果表里的捕获行删掉，读口和第二档的失败按 G2、G4 归。（设计 §6.2 L3b 结果表行）
- **G7 一般注记的符号锚点。** `resolveSymbol` 照今天按 `request.language` 分派（NA:264、:337，F6）：
  ```
  if (language === 'typescript') { 扩展名是 TS/JS ? G2 的单文件查找 : unresolved }
  else if (language === 'python' || language === 'cpp') G8
  else unresolved                                            // 例如 'cobol'，同今天
  ```
  不再每个锚点开捕获；读文件失败（`not_found` 以外）退回 `unavailable`，同第 4 片 L14 :734 的“捕获或查询失败整个写入回 unavailable”。（设计 §3.4、§6.4 L14；A13）
- **G8 一般注记的 Python/C++ 符号（§9-7；§0.1 第 1 条）。** 用 W11 的 `lookup`（`mode: 'write'`）解析：一个 → 存定位（口径同 G2：名字那一段、解码文字摘要、签名摘要）；解析成功但没命中 → `unresolved`（警告 `symbol_unresolved`，同今天）；多个 → `symbol_ambiguous`；`exact` 不论真假（C++ 有诊断或退回的解析是 `false`，W11），都照这几条走：找到一个就存，写时找得到就存（用户 11-04 选乙，C++ 精确解析读编译器自己的系统头文件目录，W11 第 1–4 条；那几个目录用不了的机器照甲只看工作区，存法一样）；W11 回 `unsupported`（解释器或 libclang 不可用，或这个文件的编译参数认不出）→ `unresolved`（同今天的“不支持”走法，`NA:342`）；回 `unavailable`（超时、进程崩溃、解析失败）→ 整个写入 `rejected`、`unavailable`，同 G7 的失败出口（第 4 片 L14 `:734`“捕获或查询失败整个写入回 unavailable”，`NA:343`）。只管一般注记；联系的端和证据仍只收 TS/JS（F44），E-27 不变。
  **后注（决定 121-54、121-58）：** Python 的解析失败已改：只退回那一个锚，回执带 `symbolProblems`；`unavailable` 只留给超时和崩溃。
- **G9 删没人用的扫描上限。** G1、G7、G8 之后 `NOTE_SYMBOL_HITS_MAX`、`SYMBOL_SCAN_PAGE`、`symbolHitsMax`（NA、NS、LE 的参数，CP 的 `noteLimits`）没人用（F48），一并删掉，不然生产可达检查报走不到（F38）。`NS` 只删这些传参（`:127`、`:766`、`:1522`、`:1602`）。

### 2.5 H：后台批量、核对操作

- **H1 在跑计数。** CP 里只有一个计数 helper，按 ref 记还没返回的调用数：`Map<canonicalJson(ref), n>`（Run 用 `runRef`，QueryRun 用它的 ref）。进入 runtime 端口的 `startRun`、`startQuery`（F25）时 n 加一，`finally` 里减一（成功或失败都减），n 到 0 才删这一项，S 也只在这时记结束时刻（S1）。“在跑个数”就是 map 的大小，S 也用它判“还在跑”。按调用数计、不按集合：同一个 Run 已进入后再调 `startRun` 只观察、马上返回（`ED:407–410`（3642）），它先返回时不能把还在跑的那次删掉。公共包装（`CP:2517`、`:2550`（3642））和给 Workflow 的 `rawRuntime`（`CP:2561`（3642））都经过这一个 helper（也可以在 `runtime.port` 上包一次再展开），不然 Workflow 起的 Work Run 数不到。不用 A1b 的按记录现算的计数：心跳每轮都要看一次，那个每次翻页读全部 Session，太贵；它照旧只给准入用（F25）。结束时刻不在 H 记，归 S1。（设计 §4.4；A20）
- **H2 后台批量。** 不新开计时器、不新开驱动：Host 的心跳循环里，`runScribeReminderCheck` 旁边，每个绑定的工作区调一次 `runLinkBatchCheck(scope)`（F42；7D2 的先例 `7d2-start-rulings.frozen.md:8649` “no new queue, timer or port”）。所以只有拿到租约的 Host 跑后台批量；没有租约的 Host 不进 Kernel、没有 Run，它上面的存疑等人点“重新核对”（偏离设计 §4.4 的“没有租约要求”，lead 裁定，§6 第 15 条）。满足下面任一条就做一批：
  1. 空闲：这个 Host 没有在跑的 Run 和 QueryRun 已满 `NOTE_LINK_IDLE_MS`（60 秒），且 `doubtfulLinks` 不空；
  2. 积压：`doubtfulLinks` 有 `NOTE_LINK_BACKLOG`（20）条，且距上次批量满 `NOTE_LINK_BACKLOG_GAP_MS`（10 分钟），忙的时候也做。
  三个常量放在 `host.ts`，照 `scribeReminderPeriodMs` 的写法做成 Host 选项（`host.ts:233`、`:2108`），时间用注入的时钟。一批：取前 `NOTE_LINK_VERIFY_MAX` 条，用 `hostContext(scope)` 调 `checkNotes(…, { verifyLinks: { priority: 'background' } })`。失败的留在队列，下次触发再试。不写记录、不加事件、不唤醒书记。Host 关闭照这个循环已有的 `attentionAbort` 收尾。（设计 §4.4；§1 第 4 条；8E L12 补一句；A19）
- **H3 只读核对工具 `check_links`（E2R1 裁定 18：取代第 2 稿 `record_note` 的 `op: "check"`）。**
  - **工具。** 新文件 `src/core/agent-runtime/link-check-tool.ts`（§2.0）。名字照现有工具的写法（同 `look_graph`、`find_graph`）；不叫 `check`（Kernel 保留名，F39）。声明照看、找（F49，`graph-tools.ts:513–529`）：`effectClass: 'read_only'`、`requiredCapabilities: ['workspace_read']`、`defaultTimeoutMs: 10000`、`outputLimitBytes: 64 * 1024`、`independentReadOnly: true`；可信上下文在创建时冻结（同 `graph-tools.ts:340–359`）；结果和失败用 `graph-tools.ts:538` 导出的 `success`、`failure`、`rejectedResult`，不另写。参数只有 `items`，1–`NOTE_LINK_VERIFY_MAX` 条，schema 顶层是 object（LG-1），strict。调 `check.checkNotes(ctx, { items, verifyLinks: { priority: 'agent' } })`（时限由 R6 掐，到时整批回 `unchecked`（`budget`），§6 第 14 条），按 §2.0 的形状回；`checkNotes` 回拒绝（例如编号不存在）时照原样作领域结果回。不写任何东西。
  - **名字登记。** `tool-group-assembly.ts:75–78` 的 `PLATFORM_COORDINATION_TOOL_NAMES` 加 `...LINK_CHECK_TOOL_NAMES`（于是也进 `RUNTIME_TOOL_NAMES`，`:106`）。`unknown-call-kinds.ts:24–26` 第 2 行（平台只读工具，不查提交回执）加 `'check_links'`：调用结果未知时按只读处理，所以不用查账分支。
  - **给谁（和看、找同一处）。** `host.ts:361`（3642）改成 `LOCAL_READ_TOOL_NAMES = ['read', ...GRAPH_TOOL_NAMES, ...LINK_CHECK_TOOL_NAMES]`。展开它的本地 Work 授权（有没有写前缀都有，`:444`）和秘书（`:366`）就都有；7D2 的参谋、审阅也展开它（`7d2-start-rulings.frozen.md:6459–6461`），7D2 落地后自然有，修订记进 §7。服务端不拒任何职责。
  - **装配（照看、找在 `tool-group-assembly.ts` 里的写法，每处紧挨 graph 那一段）。**
    - Work：`selectWorkToolGroup` 在 `:263` 旁加 `linkCheckNames = LINK_CHECK_TOOL_NAMES.filter(name => wanted.has(name))`；`:275–278` 的“全空回 `null`”带上它；选了而 `input.notes?.check` 没绑 → `unsupported`（写法同 `:295–296`）；在 graph 那一段（`:336–351`）之后建 `createLinkCheckTools({ context: input.context, check: input.notes.check, texts })`；`:424` 的名单里放在 `graphNames` 之后。
    - 最终名单：`finalToolNamesOf` 在 `:689` 旁加 `linkCheckNames`，Work、Query 都只按名字过滤、不看 `noteAdmission`（同 `graphNames`）；`owners`（`:632–647`）加可选的 `linkCheck?: boolean`，写法同 `memberCreation?`（`:638`、`:725`）：选了而 `owners.linkCheck === false` → `unsupported`；名单里放在 `graphNames` 之后。两处准备（`execution-preparation.ts:581`、`query-preparation.ts:442`）只冻结能力集，不传它；两处开始传真值：`ED:545–559`（3642）和 `query-execution.ts:381–386`（3642）的 `owners` 加 `linkCheck: deps.notes?.check !== undefined`。
    - Query：`query-execution.ts:411`（3642）旁加 `grantedLinkCheckNames`（按 `manifest.permissions.tools`，不看 `noteAdmission`）；`:433` 的条件带上它；选了而 `deps.notes?.check` 没绑 → `unsupported`（写法同 `:429–431`）；在看、找那一段（`:468–489`）之后用同一个 `toolContext` 建；`:571–583` 的名单和 `create` 里放在看、找之后。
  - **所以删掉第 2 稿的：** `RecordNoteArgs`、`RecordNoteRequestV1` 的 `check` 一支，`recordNoteRequestOf` 的 `check` 分派，`lookupToolCommit` 的 `check` 分支和 `noteCommandReceiptOf` 的参数收窄（E2R1 第 11 条作废），`record_note` 说明里关于 `check` 的话。H 不改 `NT`、`NC`、`NS`。第 17 条也作废：装配不再跟着 `record_note`，没有 `record_note` 的线（`noteAdmission` 为 `none` 的 Query、7D2 的 reviewer、没有写前缀的 Work Run）也有 `check_links`（§6 第 16 条）。
  （§9-4；设计 §3.5；E2R1 裁定 18）
- **H4 工具说明和 skill。** 新的 `resources/prompts/platform/tools/check_links.json`（格式同 `tools/look_graph.json`）写说明，意思照设计 §3.5 的引文：重新核对最多 20 条联系；平台会在 Host 空闲时自己核存疑的，平时不用调；只有马上要依据一条存疑的联系做事、需要先知道结果时才调；它比读慢，时限内没核完的这次回“这次没核”；它不写任何东西。说明另写一句耗时（§3.2 第 8 项）：通常要几秒，比读慢得多；Host 刚启动后的第一次可能到时限，这次回“这次没核”，平台之后会核完。不写具体秒数（时限可注入）。四个 skill（`skill-platform-work`、`-secretary`、`-adviser`、`-scribe`）在“注记”一段“先查再写”那一块之后各加一句，写在 `{{#tool:check_links}}` 块里：读到“存疑：跨文件引用待核”的联系平时不用管，平台空闲时会核；只有马上要依据它做事时才用 `check_links` 先核一次。`skill-platform-scribe` 那一句另带上第 2 稿的意思：核出断了会进你的待查，书记提醒里也会数。句子避开裸词 `check`（F39）。（设计 §3.5；§9-3、§9-4；E2R1 裁定 18）
- **H6 包。** `pack.json` 的 `tools` 加 `"check_links": "tools/check_links.json"`（在 `find_graph` 之后，`pack.json:212`）；改过的条目版本加一；生成物 `platform-pack.generated.ts` 用 `node scripts/build-platform-prompts.mjs` 重生成，不手改；`runtime-assets.json` 重算。R、S 的包改动照同样做法。（8E C20；开工裁定 §2.3 的合并收尾做法）

### 2.6 S：书记提醒数断了的联系

**后注（8E-2 S 落地，lead 2026-11-07）：** 已落地，见决定 121-53（`a1484d80`）。本节 S1–S5 按 lead 的 11 条开工裁定（L1–L11，压过本节和旧裁定）落下，要点见决定 121-53 和能力索引 WG230；正文不改。

- **S1 计时。** 每个提醒周期，Host 读 `brokenLinks(scope)`，按自己的注入时钟记每条第一次看到的时刻（第一次看到最多比平台发现晚一个提醒周期，默认 60 秒，`host.ts:262`（3642））。一条断了的联系“开始计时”的时刻：`heldByRun` 为空时是第一次看到；不为空时，那个 Run 还在跑（H1 的 map 里有它）就不计，结束了就从第一次看到和 Run 结束两者里取晚的。Run 的结束时刻由 S 在 H1 的计数 helper 里加记（n 到 0 时记 `canonicalJson(runRef)` → 结束时刻）；结束满 `SCRIBE_BROKEN_LINK_AGE_MS` 的条目删掉：那时“取晚的”和“第一次看到”算出的已计时都满 10 分钟，结果一样。时间在内存，重启重计。（§9-6 兜底）
- **S2 游标门（A7、B3）。** `runScribeReminderCheck` 今天“账本游标没动就返回”（F35）。断了的联系是改文件改出来的，计时靠时钟，两样都不动账本游标，所以这道门要同时比断了的联系：
  ```
  brokenKey = sha256(canonicalJson([[...已开始计时的 noteId@version].sort(), 已计时满 SCRIBE_BROKEN_LINK_AGE_MS 的条数]))
  if (state.computedAtCursor === cursor && state.brokenKey === brokenKey) { 重发待发的; return }
  … 照旧算 …
  state.brokenKey = brokenKey
  ```
  “上一条提醒没处理就不再发”照旧（`host.ts:2420`）。
- **S3 判门。** 已开始计时的满 `SCRIBE_BROKEN_LINK_THRESHOLD`（5）条，或最早一条已计时满 `SCRIBE_BROKEN_LINK_AGE_MS`（10 分钟），就和待审、该更新一起进提醒的判门（`host.ts:2441`）。两个常量照 `SCRIBE_PENDING_THRESHOLD` 放在 `host.ts:258–259` 旁边，数是用户定的（§9-6）。只数断了的，不数存疑。
- **S4 模板和请求号。** `scribe-reminder` 模板加一个必填槽 `brokenCount`（`slot-tables.ts:155–160` 加 `brokenCount: { required: true }`，计数总有一个数）；第一稿正文在“该更新 {{updateDueCount}} 条”后加“，断了的联系 {{brokenCount}} 条”。`requestId` 的身份集合加上这些联系的 `noteId@version`；没有断了的联系时身份集合和今天一样，请求号不变。
- **S5 和 7D2 O5b。** O5b 把提醒改成按范围分桶（F30）。S 落在 O5b 之后：断了的联系按同一个 `managingScopeOf` 分进各范围的桶，每个桶自己的 `brokenKey` 和计数。（§3.4）
- （§9-6 兜底；设计 §9-6；8E L12 :579 改）

## 3. 怎么施工

### 3.1 组、先后、依赖

| 组 | 前置 | 并行 | 落地 |
|---|---|---|---|
| W | §3.2 先量；A1a/A1b 已落（115-8） | 和 F2 并行（W 只动 `src/core/workspace/`、两个 Python 脚本、Kernel 补丁源 `sandbox/workspace/workspace-sandbox.ts` 和它的 4 个 dist 产物） | **和 R 一起落**：W 的分析器和单文件查在 R 以前没有生产调用者；落地前做 §3.2 末的空闲重量 |
| F2 | A1a/A1b 已落 | 和 W 并行 | 单独落 |
| R | W、F2（共用 `RM`、`CP`、`core-routes.ts`、`semantic-layer-read.ts`） | — | 和 W 一起；允许清单加 `doubtfulLinks`、`brokenLinks` 两条 kept-for |
| G | R | 和 H 并行（H 不改 `NS`、`NC`；两组共用 `CP` 和 `S8E-semantic-world.ts`，各改各的块） | 单独落 |
| H | R（`ED` 上 R 先 H 后） | 和 G 并行 | 单独落；删 `doubtfulLinks` 那条 kept-for |
| S | H（在跑计数）、7D2 O5b（§3.4） | — | 单独落；删 `brokenLinks` 那条 kept-for |

- 关键路径：§3.2 → W → R → G/H。S 另等 7D2 O5b。
- R13 的路由从设计 §7.1 的 H 挪进 R：R 的验收行要“核一次”，不然 R 的第二档合并和内存结论落地时没有测试（规则表 S5）。
- 第 9 片只在跑分里读 `RM`（`9-start-rulings.frozen.md:740`），不冲突。K2-M 的两个文件（`model-budget.ts`、`runtime-configuration.ts`）8E-2 不改（K2 :694 要求核一遍，核过）。

### 3.2 开工先量（W 开工第一步；结果报 lead，lead 冻结进本规格的初值以后，用到它的组才开）

| # | 量什么 | 定什么 | 等它的组 |
|---|---|---|---|
| 1 | 经平台读口读文件：一页 100 条联系，门都没变、门全变各一次（设计 §2.7） | 要不要 W12 | W |
| 2 | 第二档经真实读口在本仓库建程序：8E L3a 的例子冷、热，组合根 | 写进 §0 的估数 | — |
| 3 | 单文件导航树和捕获的 `symbols` 逐文件比（`src` 全部：名字、名字行、签名摘要）；每 MiB 解析耗时；确认构造函数没有 `nameSpan`（F41） | `NOTE_READ_PARSE_BYTES_MAX`：已量，定 1 MiB（11-03 晚；661/661 个文件和捕获一致，另有 10 个 `src/ui` 文件只有单文件看得到，同 F20、E2-20） | R |
| 4 | 第二档和整项目 `getReferencesAtPosition` 对拍：K1–K7、8E L3a 的 `Pick` 和简写属性、§4.2 的 E2-22 三份世界；E2-05、E2-06、E2-07、E2-23 写时是不是 `verified`；顺带量耗时 | 不一致的报 lead，改判法或改例子 | W、R |
| 5 | 分析线程在 vitest 里和构建后能不能加载（Node 24、TS 源码）；W1 的值导入写法过不过生产可达检查 | 线程文件的写法 | W |
| 6 | 解析缓存到上限时的堆 | 缓存上限的值 | W |
| 7 | 经真实读口在一条 import 链上建一次程序：读多少文件（含库和类型）、多久、和主线程往返几轮；试“按上一次的 import 图先取齐、再补缺” | 要不要预取 | W |
| 8 | 一次 `check_links` 冷、热各多久；10 秒工具超时里能核几条 | `NOTE_CHECK_DEADLINE_MS`（估 8 秒）、`NOTE_LINK_VERIFY_MAX`（估 20）、说明里写不写耗时 | R、H |
| 9 | Python 常驻进程每个文件多久；C++ 带头文件第一次解析、preamble 后重解析各多久、缓存占多少内存；单文件结果和 `python_index`、`cpp_index` 逐个对拍（口径照 W11“对拍”：Python 含签名摘要、`python_index` 去掉 import 名；C++ 比名字、种类、名字起点，签名摘要按名字那一段两边重算再比，不拿 `cpp_index` 的 extent 末尾比） | 已量（11-03 晚，负载 6.5–9.4，机器空闲时重量 C++）：Python 常驻进程每个文件中位约 3 毫秒、最慢 34 毫秒，去掉 import 名后 40/40 一致；C++ 只看工作区（`cpp_index` 的参数）首次 9–97 毫秒、重解析 1–21 毫秒，和 `cpp_index` 4/4 一致，但每个编译单元 26–39 个错误（找不到系统头文件），按 `exact: false` 算；读系统头文件（装了 `libclang-common-18-dev` 以后重量，用户选乙）诊断全 0，精确首次 324–1,378 毫秒，有 preamble 重解析 58–208 毫秒，留住 5 个翻译单元进程多 217 MiB；读时仍照 §9-7 只用留着的翻译单元、没有就退回，另加 R3 的等待上限 `NOTE_NATIVE_READ_WAIT_MS` | W、R、G |

- 第 2、4、7 项用的 8E L3a 例子：“经过”的两个字段不是导航项（F50），测量时按文字定位 X。耗时和对拍（6/6，另 40/40）照用；例子本身写不进去，8E 的例子按 §7 改。

量的时候不跑全量、不跑规模批；脚本放 `D:/cc-lead-notes/tools/`，Python 只在 WSL 跑。

**结果（11-03 晚，`impl/s8e/measure-first-report.md`）已冻结进** W1、W3、W5、W6、W7、W10、W11、W12、R3、R4、§2.0 的常量、H4、§0 和 §4.3（E2-23d、E2-29c、E2-29d、E2-33）。除第 1 项的重跑外，都是机器偏忙时量的（1 分钟负载 6–12，旁边一直跑着一个 5 并发的 vitest 全量，没守上一句）。11-04 又做了一轮第一档提速研究（`impl/s8e/speed-study-judge.md`，数据 `impl/s8e/speed-study-wf.json`，lead 裁定是 `measure-rulings.md` 末节），结果冻结进 W3、W10、W12、R3、R4、R7、§2.0、§0、§0.1 第 3 条的数和 §4.3（E2-34、E2-35、E2-36）。

**空闲重量（W 的验收步）。** W 施工完、和 R 一起落地之前（§3.1），在机器空闲时重量：1 分钟负载低于 4，本机不跑全量、规模批和别的测试。用 W 自己的代码和真实读口：第 1 项用 `readWorkspaceFiles`（门都没变、门全变，200 和 256 个文件）；第 3 项用 `navigationItemsOf`（每 MiB 多久）；第 2、7、8 项用 `verify`（冷、热、Host 刚启动的新进程含起线程；加一项“预取用的是另一片代码的上一次”：第 2 步接在第 1 步之后；线程堆的峰值）；第 9 项的 C++ 用 `lookup`，含精确首次和重解析（读系统头文件），和按 W11 参数留住的翻译单元每个占多少内存；W6 搜整个程序（第 4 项之后的改法）在本仓库 L3a 两步和第 8 项 1、20 条上多花多久；再量一次“一次写排在一次后台核后面”的总耗时（`record_note` 的工具超时是 10 秒，`note-tool.ts:406`）；加一次第一档提速后的整体实测（提速裁定第 6 条）：读和解析放在同一次 `checkNotes` 里，读满 256 个门文件、第一次解析满 1 MiB 改过的文字，再在同一状态读一次，工作区在本地盘和 `/mnt`（drvfs，自动选到异步版）各量一次。每项 5 次，记中位/最小，报 lead。重量只改 §0 的估数和 H4 说明里的耗时说法，不改规则和常量；有数让一条冻结的要求不成立（第一档典型 ≤100 毫秒、最坏约 450 毫秒，§0.1 第 3 条；`check_links` 在时限和工具超时之内；写在 10 秒以内），停下报 lead，由 lead 裁定。

### 3.3 每组的文件和白名单

**W**
```
^src/core/workspace/single-file-syntax\.ts$
^src/core/workspace/reference-analyzer\.ts$
^src/core/workspace/reference-analyzer-worker\.ts$
^src/core/workspace/native-single-file\.ts$
^src/core/workspace/analysis-runner\.ts$
^src/core/workspace/typescript-source-query\.ts$
^src/core/workspace/(ports|workspace-tools|capture|access|workspace-read)\.ts$
^src/core/workspace/README\.md$
^scripts/(python|cpp)-source-query\.py$
^vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox\.ts$
^vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox\.(js|js\.map|d\.ts|d\.ts\.map)$
^vendor/coding-agent/patches/README\.md$
^tests/data/S8E2-W-[a-z-]+-pure\.test\.ts$
^tests/data/S8E2-W-native-[a-z-]+\.test\.ts$
^tests/data/analysis-runner\.test\.ts$
^tests/kernel/S8E2-W-read-many\.test\.ts$
^tests/README\.md$
```
W12 要做（§3.2 第 1 项超了；11-04 提速定成 Kernel 的 `readMany`）：`workspace-tools.ts`、`capture.ts`、`access.ts`、`workspace-read.ts` 并在上面 `ports` 那一行（单个读和 `withAccess` 在 `capture.ts:189`、`:617`，逐路径判权限在 `access.ts:142`，前置检查和错误码在 `workspace-read.ts:45–63`）。Kernel 一侧只改补丁源；dist 的 4 个产物只由 `node scripts/build-kernel-patch.mjs --write` 生成、和补丁源一起提交（`--check` 要过），不手改；`vendor/coding-agent/patches/README.md` 照先例加一节（源和产物的哈希、命令）。`tests/README.md` 只改 `tests/kernel/` 那一行的文件数（`:18`）。`runtime-assets.json` 里两个脚本的摘要由 lead 在合并收尾时重算，施工组不提交。`S8E2-W-native-*` 只测常驻进程的公开 `lookup`（Python 用 WSL 的 python3，C++ 用现有 C++ 测试同一个 libclang 18，`tests/data/cpp-source-index.test.ts:54–57`）。

**F2**
```
^src/core/work-graph/notes/semantic-layer-read\.ts$
^src/core/work-graph/notes/note-read-model\.ts$
^src/core/work-graph/notes/note-related-scope\.ts$
^src/app/core-routes\.ts$
^src/app/core-http-types\.ts$
^src/composition/create-platform\.ts$
^tests/work-graph/S8E-F-flow-read\.test\.ts$
^tests/work-graph/S8E-R-route\.test\.ts$
^tests/architecture/production-reach-allowlist\.json$
^src/core/work-graph/notes/README\.md$
^src/app/README\.md$
^src/composition/README\.md$
```

**R**
```
^src/contracts/note\.ts$
^src/contracts/README\.md$
^src/core/work-graph/model/note-contracts\.ts$
^src/core/work-graph/views/note-views\.ts$
^src/core/work-graph/notes/note-read-model\.ts$
^src/core/work-graph/notes/note-anchors\.ts$
^src/core/work-graph/notes/link-evidence\.ts$
^src/core/work-graph/notes/semantic-layer-read\.ts$
^src/core/agent-runtime/execution-driver\.ts$
^src/core/agent-runtime/prompt-set-texts\.ts$
^src/app/core-routes\.ts$
^src/app/core-http-types\.ts$
^src/composition/create-platform\.ts$
^resources/prompts/platform/(pack\.json|strings\.json|templates/(link-breaks-input|skill-platform-work)\.txt)$
^src/contracts/prompts/slot-tables\.ts$
^src/contracts/prompts/platform-pack\.generated\.ts$
^runtime-assets\.json$
^tests/architecture/production-reach-allowlist\.json$
^tests/work-graph/S8E-F-(read|broken|warn|verify)\.test\.ts$
^tests/work-graph/S8E-R-route\.test\.ts$
^tests/work-graph/S8E2-R-[a-z-]+\.test\.ts$
^tests/work-graph/S4B-(note-symbol-recheck|note-anchor-status|memory-find-stale)\.test\.ts$
^tests/runtime/S4C2-assembly\.test\.ts$
^tests/runtime/S8E2-R-run-end\.test\.ts$
^tests/runtime/S7B-preparation-freeze\.test\.ts$
^tests/helpers/S7B-delivery-samples\.ts$
^tests/helpers/(S8E-semantic-world|S4B-note-check-fixture|S4A-note-fixture)\.ts$
^tests/contracts/(PC-platform-pack-v2|PC2-platform-scan|S6A-secretary-templates)\.test\.ts$
^tests/work-graph/S8E-R-pack\.test\.ts$
^src/core/work-graph/(model|views|notes)/README\.md$
^src/core/record-store/README\.md$
^src/core/agent-runtime/README\.md$
^src/contracts/prompts/README\.md$
^src/app/README\.md$
^src/composition/README\.md$
```
`LE` 只为导出 R5 要复用的纯函数（`literalInScope`、`evidenceScopeOf`、`referenceFieldsOf`）。`NA` 只加 `verify?`、`lookup?`、必填的 `readWorkspaceFiles`，包装是初始化对象里一项加两行（R14）。`src/core/record-store/README.md:51`、`model/README.md:119–121`、`:139`、`:160–163`、`views/README.md:159`、`src/contracts/README.md:207–208`、`:233` 是删常量、加字段引起的行号移位（复函第 7 条）。生成物和 `runtime-assets.json` 由 lead 在合并收尾时重算（开工裁定 §2.3 的做法），施工组不提交。

**G**
```
^src/core/work-graph/notes/link-evidence\.ts$
^src/core/work-graph/notes/note-anchors\.ts$
^src/core/work-graph/notes/note-service\.ts$
^src/core/work-graph/model/note-contracts\.ts$
^src/composition/create-platform\.ts$
^tests/work-graph/S8E-L2-(link-write|link-refusals)\.test\.ts$
^tests/work-graph/S8E-F-write\.test\.ts$
^tests/work-graph/S4A-note-symbol\.test\.ts$
^tests/work-graph/S8E2-G-[a-z-]+\.test\.ts$
^tests/helpers/(S8E-semantic-world|S4A-note-fixture)\.ts$
^tests/README\.md$
^src/core/work-graph/(notes|model)/README\.md$
```
`NC`、`CP` 只删 `NOTE_SYMBOL_HITS_MAX` 和 `symbolHitsMax`（G9）。

**H**
```
^src/app/host\.ts$
^src/composition/create-platform\.ts$
^src/core/agent-runtime/link-check-tool\.ts$
^src/core/agent-runtime/tool-group-assembly\.ts$
^src/core/agent-runtime/query-execution\.ts$
^src/core/agent-runtime/execution-driver\.ts$
^src/core/work-graph/state/unknown-call-kinds\.ts$
^resources/prompts/platform/(pack\.json|tools/check_links\.json|templates/skill-platform-(work|secretary|adviser|scribe)\.txt)$
^src/contracts/prompts/platform-pack\.generated\.ts$
^runtime-assets\.json$
^tests/architecture/production-reach-allowlist\.json$
^tests/state/unknown-call-kinds\.test\.ts$
^tests/runtime/K3-34-tool-name-constants\.test\.ts$
^tests/app/S6A-local-secretary\.test\.ts$
^tests/contracts/(PC-platform-pack-v2|PC2-platform-scan|S6A-secretary-templates)\.test\.ts$
^tests/work-graph/S8E-R-pack\.test\.ts$
^tests/helpers/S8E-semantic-world\.ts$
^tests/(app|work-graph|runtime)/S8E2-H-[a-z-]+\.test\.ts$
^src/core/agent-runtime/README\.md$
^src/core/work-graph/state/README\.md$
^src/app/README\.md$
^src/composition/README\.md$
^src/contracts/prompts/README\.md$
```
第 2 稿列的 `NT`、`NC`、`NS`、`tools/record_note.json`、`PC2-joint-tools`、`PC2-W-note-tool`、`S6B2-secretary-note-tools`、`AG6-agent-assembly` 随 E2R1 裁定 18 去掉（`record_note` 不改）。`D89-skill-render`、`A-01-review-template` 是 NW 为 skill 文本改过的测试，H 改四个 skill 后要不要动，开工副本上核，按需加。改 `LOCAL_READ_TOOL_NAMES` 会改本地授权的工具清单和配置修订号：逐字列这些清单的测试（已知 `S6A-local-secretary.test.ts:223`、`:226`）在开工副本上 grep `'find_graph'` 再核一遍，按需加。

**S**
```
^src/app/host\.ts$
^src/composition/create-platform\.ts$
^resources/prompts/platform/(pack\.json|templates/scribe-reminder\.txt)$
^src/contracts/prompts/slot-tables\.ts$
^src/contracts/prompts/platform-pack\.generated\.ts$
^runtime-assets\.json$
^tests/architecture/production-reach-allowlist\.json$
^tests/helpers/PC2-pack-fixture\.ts$
^tests/contracts/(PC2-resolve-pack|PC-platform-pack-v2)\.test\.ts$
^tests/app/(S4C2-scribe-reminders|S8E2-S-[a-z-]+)\.test\.ts$
^tests/helpers/S8E-semantic-world\.ts$
^src/app/README\.md$
```

### 3.4 共用文件的串行块

按四份冻结开工裁定的逐文件串行链和 K2 §3 的表核过。

- **总的先后（起草方建议，lead 定，§6 第 10 条）。** 四份冻结裁定都把 8E-2 排在 A1b 之前（`7d2-start-rulings.frozen.md:16–18`、`:8412`、`:8808`；`6c-start-rulings.frozen.md:63`；`9-start-rulings.frozen.md:29`）。115-8 改成 A1a/A1b 先落（F31）。本稿只把 A1a/A1b 提到 8E-2 前面，其余照冻结链：`A1a/A1b → 8E-2 {F2, W+R, G, H} → 7D2-1 其余包 → 6C → S9 → B06`；S 单列，在 7D2 O5b 之后；K2 的先后照 `slice-K2-SPEC.md:682–686`。冻结裁定 :8412 的规矩照用：落地集合不是依赖，共用文件上后落的一方 rebase。
- **为什么 S 单列。** S 改 `runScribeReminderCheck`，7D2 O5b 也改写这个函数，而且 O5b 的冻结裁定写死“原来的 `scribe-reminder` 模板和发送路径原样使用”（`:6565`）。S 在 O5b 之前落，就要改 O5b 的冻结裁定，让每个范围的桶带上断了的联系的计数；S 在 O5b 之后落，O5b 不用改，S 照分好的桶加。起草方建议后者。

| 文件 | 8E-2 的组 | 现有的链 | 先后 |
|---|---|---|---|
| `src/composition/create-platform.ts` | F2 → R → G → H；S | `7D2 A1b → O1b → O5b → C1 → 6C G3 → S9 G3 → S9 G7`（`9-start-rulings.frozen.md:211`）；K2、B06 G2 也改 | A1b 之后、O1b 之前。每组只改自己的块：F2 flows 接线；R 分析器和单文件查接进 `noteWorkspace`（`CP:2714–2749`）、路由、限额；G 删 `symbolHitsMax`；H 在跑计数、`doubtfulLinks` 交给 Host；S（O5b 之后、C1 之前）加 Run 结束时刻、`brokenLinks` 交给 Host |
| `src/app/host.ts` | H、S | `8C G5 → 7D2 A1b → O5b → C1 → 6C G3 → S9 G3`（`9-start-rulings.frozen.md:210`）；7D2 O1b、O2、O4b；B06 一行 | H：A1b 之后、O1b 之前（H2 只在心跳循环里加一个调用；H3 改 `LOCAL_READ_TOOL_NAMES` 一行，7D2 的参谋、审阅工具集在它后面展开它）。S：O5b 之后、C1 之前 |
| `src/app/core-routes.ts`、`core-http-types.ts` | F2 → R | `A1b → O5b`（`7d2-start-rulings.frozen.md:118`、`:121`） | A1b 之后、O5b 之前 |
| `src/core/agent-runtime/execution-driver.ts` | R → H | `8C G4 → 7D2 A1b → 6C G1 → S9 G1`（`9-start-rulings.frozen.md:163`）；7D2 O2；6C G1 改同一个装配块（`6c-start-rulings.frozen.md:139`，当时 `:1048`）；K2-P1 挪 `:948–958` | A1b 之后；O2、6C G1、K2-P1 在后，按符号重指。H 只在开始的 `owners` 里加一行（H3） |
| `src/core/agent-runtime/tool-group-assembly.ts` | H | `8C G5 → 7D2 O2/O5a/C1 → S9 G1`（`9-start-rulings.frozen.md:159`；`7d2-start-rulings.frozen.md:133`） | A1b 之后、O2 之前；O2、O5a、C1 按符号重指 |
| `src/core/agent-runtime/query-execution.ts` | H | `7D2 A1b → 7D2 C1 → 6C G1 → S9 G1`（`9-start-rulings.frozen.md:161`；`7d2-start-rulings.frozen.md:126`） | A1b 之后、C1 之前 |
| `src/core/agent-runtime/link-check-tool.ts`（新）、`tools/check_links.json`（新）、`src/core/work-graph/state/unknown-call-kinds.ts` | H | 四份冻结裁定都不碰（grep 过） | — |
| `src/core/agent-runtime/prompt-set-texts.ts` | R | K2-P2 加 `context-summary-request`（K2 :553、:761） | R 先（K2 在 6C 之后）。K2-P2 的改前、改后要带上 R 加的 `link-breaks-input`（§7） |
| `resources/prompts/platform/pack.json`、生成物、`runtime-assets.json`、`slot-tables.ts` | R → H → S | `8C G1 → 8E L3/F1 → 7D2 O5b/C1 → 6C G1 → S9 G1`（`9-start-rulings.frozen.md:168–171`）；K2-P2 | 生成物和摘要由 lead 合并收尾重算 |
| `templates/skill-platform-(scribe|adviser|secretary).txt` | H | 7D2 O5b 给 scribe 加一个工具块、改 adviser 的文字（`7d2-start-rulings.frozen.md:6090`、`:6088`）；NW 改过 | NW 之后、O5b 之前 |
| `templates/scribe-reminder.txt` | S | O5b “原样使用”（`:6565`） | O5b 之后 |
| `templates/skill-platform-work.txt` | R → H | NW 改过 | NW 之后（`tools/record_note.json`、`NT` 第 3 稿不改） |
| `src/core/work-graph/model/note-contracts.ts` | R → G | 7D2 O2（设计 §7.2） | O2 之前；O2 按符号重指 |
| `src/core/work-graph/notes/note-anchors.ts` | R → G | — | — |
| `src/core/work-graph/notes/note-read-model.ts` | F2 → R | 第 9 片只读 | — |
| `src/core/work-graph/notes/note-service.ts` | G | NW 改过；7D2 只读（`7d2-start-rulings.frozen.md:6727`） | NW 之后 |
| `src/core/workspace/analysis-runner.ts`、两个 Python 脚本 | W | 7D2、6C、第 9 片、B06 都不改（设计 §7.2 查过的白名单） | — |
| `vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox.ts` 和 4 个 dist 产物；`vendor/coding-agent/patches/README.md` | W | 四份冻结裁定和 K2 都不改这个补丁源（grep 过）；K2-K 也加 Kernel 补丁（K2 :700–704），补丁 README 照先例各加一节 | W 先（8E-2 在 K2 之前）；K2 落的时候 rebase，`build-kernel-patch.mjs --check` 两边都要过 |
| README（`src/app`、`src/composition`、`views`、`model`、`state`、`agent-runtime`、`contracts/prompts`、`src/contracts`） | 各组 | 照 `9-start-rulings.frozen.md:143` 的例外，按实际落地先后串行 | — |

### 3.5 行数和测试预算

- 每组的测试行（`tests/` 增删合计，含夹具）不超过它新增的生产行（规则表 S6，生产行只算加的，不含 README）。生产行的估数见 §0 的表。
- G 的问题：G 的生产主要是删（+130–190 / −200），§4.4 里 G 要删、改写的旧测试行估约 130，加上世界去掉捕获探针、重写 E-37、新行 E2-20、E2-21、E2-24、E2-29a/b，估 300–400 行，按 S6 会超。要 lead 事先裁定（§6 第 11 条）：§4.4 点名删的行（规则表 F12 允许按冻结的问题表删行）算不算进 G 的预算。
- 超了停下报哪几行推高，lead 裁定。
- Codex 第二轮补的三处（E2R2-c-01–03，lead 裁定照补）算进各组自己的测试预算（规则表 S6）：R 多 E2-30 一行（估 30–50 行）；H 把 E2-14 拆成 E2-14a、b，b 是新的普通 Query（估 40–80 行，走公开路由）；W 多 E2-31a、b 两行（共用一个 C++ 临时目录夹具，估 60–100 行）。都没量。
- 开工先量之后补的（第 4 稿，裁定第 14 条）：R 多 E2-23d、E2-33 两行；G、R 多 E2-29c、E2-29d 两行（E2-29d 是用户 11-04 选乙之后加的）；各估 20–30 行，都没量，算进各组自己的预算。
- 第一档提速（11-04，提速裁定第 4、5 条）：W 的生产多 Kernel 补丁约 +115/−8（补丁源的行算生产行，dist 的 4 个生成物不算）、src 约 45、W10 ±10–15，测试多 E2-34（43 个用例两种读法各跑一遍，估约 70–90 行）；R 的生产多约 25–35，测试多 E2-35、E2-36（估 40–60 行）。都没量，算进各组自己的预算。

## 4. 验收

### 4.1 测试入口

- 10-22 用户确认的 E1–E5（8E :590–600）不变。
- 改一处（§9-1）：数“第二档建程序的次数”代替数捕获。做法：世界原地包住 `noteWorkspace` 的 `verify`（同今天包捕获的做法，F32；规则表 A3），一次 `verify` 算一次建程序。
- 加三处（§9-1）：**E6** 路由 `architecture/semantic-links/check`；**E7** agent 的核对（第 3 稿起是只读工具 `check_links`，不再是 `record_note` 的 `op: "check"`；E2R1 裁定 18，用户 11-03 晚“肯定得改”）；**E8** Host 后台批量（空闲时间注入成很短）。
- 等确认（§0.1 第 2 条）：**E9** 真实 Work Run 里 Run 改文件后的平台消息；**E10** 书记提醒心跳。
- 少量纯函数：W 的 `navigationItemsOf`、`fileSyntaxOf`、`namesInRanges`（规则表 A5，`*-pure.test.ts`）。W11 的常驻进程经它的公开 `lookup` 测（规则表 A2 的“包住真实解释器”那一类，现有 `analysis-runner.test.ts` 的做法）。W12 的 Kernel `readMany` 经 Kernel 的冻结公开入口 `WorkspaceSandbox`（`vendor/coding-agent/dist/public-api.js`，同 `tests/kernel/K-readonly-sandbox.test.ts:37–41` 的导入）测，配真实的临时目录，不 mock（E2-34，提速裁定第 4 条）。
- 故障：读口故障用世界现有的 `faultReads`（今天只打 `readWorkspace`；R 让它也按路径打 `readWorkspaceFiles`，用同一个故障函数，不然第一档的门读绕过它；第二档读文件不经它，W3）；第二档故障和扣住用包在 `verify` 外面的失败或闸门（A2、A3），整次调用失败或扣住；捕获、查询两个故障口随 G 删掉（F32）。分析线程崩了重起（W1）、后台让位（W2）没有公开的注入点，不配验收行（§6 第 9 条）。
- 世界加 Host 选项的口（H2 的三个数、注入时钟）、让脚本模型调 `check_links` 的口和传生产授权（`localWorkbenchGrant`）的口（H）。

### 4.2 世界

用 8E §5.2 的手算世界（8E :604–711，19 个文件，没有 `tsconfig.json`）。下面几行要的文件只在那几行里写进去，不改共用的 19 个文件：

```text
src/wire3.ts                       （E2-05）
  1  import type { Access } from './contracts/access.js';
  2  export function wire(p: typeof import('./wg/permit.js')): Access {
  3    return {
  4      beforeCall: p.authorize,
  5    };
  6  }
src/wg/reg2.ts                     （E2-06；模块路径里不能含 X 的名字，不然路径字符串也算一处“other”）
  1  export { onPicked } from './permit.js'; export const PICK_KEY = 'wg.audit';
src/wg/gate.ts                     （E2-07、E2-12）
  1  export class Gate {
  2    constructor(readonly id: string) {}
  3  }
src/wire4.ts                       （E2-07、E2-12）
  1  import { handlers } from './wg/registry.js';
  2  import { Gate } from './wg/gate.js';
  3  handlers.set('wg.audit', () => { new Gate('x'); });
src/wire5.ts                       （E2-23a–d）
  1  import { onPicked } from './wg/permit.js';
  2  export const table = { 'wg.audit': onPicked };
src/wg/hub.ts                      （E2-33；中转文件，路径里不含 X 的名字）
  1  export * from './permit.js';
src/wire6.ts                       （E2-33）
  1  import { onPicked } from './wg/hub.js';
  2  export const table = { 'wg.audit': onPicked };
src/a/one.ts、src/a/two.ts         （E2-08，第 4 片的 S4B 夹具）
  1  export function one() {}        （two.ts 是 two），各 25 字节
src/wg/gate2.ts                    （E2-22①）
  1  import type { Access } from '../contracts/access.js';
  2  export class Gate implements Access {
  3    async beforeCall(id: string): Promise<void> { void id; }
  4  }
src/use-gate.ts                    （E2-22①）
  1  import { Gate } from './wg/gate2.js';
  2  const gate = new Gate();
  3  export const go = (id: string) => gate.beforeCall(id);
src/wg/base.ts                     （E2-22②）
  1  export class Base {
  2    beforeCall(id: string): void { void id; }
  3  }
  4  export class Child extends Base {
  5    override beforeCall(id: string): void { void id; }
  6  }
src/use-child.ts                   （E2-22②）
  1  import { Child } from './wg/base.js';
  2  const child = new Child();
  3  export const go = (id: string) => child.beforeCall(id);
src/wg/pair.ts                     （E2-22③）
  1  export interface A { beforeCall(id: string): void; kind: 'a'; }
  2  export interface B { beforeCall(id: string): void; kind: 'b'; }
  3  export type AB = A | B;
src/use-ab.ts                      （E2-22③）
  1  import type { AB } from './wg/pair.js';
  2  export const go = (ab: AB, id: string) => ab.beforeCall(id);
cpp/include/math.hpp               （E2-29a–d；照 tests/data/cpp-source-index.test.ts:22–25 的夹具）
  1  #pragma once
  2  #ifdef API_ENABLED
  3  int pick(int value);
  4  #endif
cpp/src/math.cpp                   （E2-29a–d；E2-29c、d 在第 1 行前各插一行 include，见那两行）
  1  #include "math.hpp"
  2  int pick(int value) { return value + 1; }
compile_commands.json              （E2-29a、c、d；cpp/src/math.cpp 一条，参数 clang++ -std=c++20 -DAPI_ENABLED=1 -I cpp/include -c）
—— 下面三个文件只给 E2-31a、b：W 层自己的临时目录，不进 S8E 世界；照 tests/data/cpp-source-index.test.ts:19–29 建
   （mkdtemp、真实 WorkspaceSandbox、compile_commands.json 的 arguments 写绝对路径、libclang 18 同 :54–57）
include/gate.hpp
  1  #pragma once
  2  #define GATE_ON 1
src/gate.cpp
  1  #include "gate.hpp"
  2  #if defined(API_ENABLED) && GATE_ON
  3  int pick(int value) { return value + 1; }
  4  #endif
compile_commands.json              （src/gate.cpp 一条，arguments：clang++ -std=c++20 -DAPI_ENABLED=1 -I <root>/include -c src/gate.cpp）
```

“碰一下”一个文件 = 在末尾加一行注释（TS、C++ 是 `// touched`，11 字节；Python 是 `# touched`），只为让摘要变、不改任何名字。W4 的“一处名字”按词边界找，注释、字符串里的也算一处（记 `other`）。

### 4.3 验收行

层：纯 = A5 纯表；E1–E10 = 入口；全部只跑 memory，除非写了 SQLite（规则表 S3）。“建”= 第二档建程序的次数。每行一个改坏（S5）。

**8E 冻结的行，两档以后的期望（设计 §6.2；没列的不变）**

| 行 | 组 | 做什么 | 期望（手算） | 改坏（让这一行红） |
|---|---|---|---|---|
| E-15（改） | R | K1 带 `basisFiles: ['src/compose.ts']`；改 `compose.ts` 第 10 行（`start` 改 `begin`）；E6 核 K1；再删 `permit.ts` 的 `authorize`（第 1–3 行） | 改后读：`freshness: 'stale'`，`unchecked`/`refs_pending`（第 7 行 `beforeCall`、`authorize` 都在），三端 `live`，建 0；核后：`verified`，仍 `stale`，建 1；删后：“到”`retired`、`['symbol_missing']`，“从”“经过”`live`，`broken`、`missing: [1]`，`currentEligible: false`，书记 `stale` 读里有它，建 0 | R5 改成“名字还在就算对得上” → 改后读成 `verified` |
| E-25a（改，第一次读） | R | 写 K1；`compose.ts` 第 7 行改成 `const access: Access = { beforeCall: async () => {} };`；E3 读、E5 书记 `stale` 读、E4 执行输入 | `unchecked`/`refs_pending`（第 7 行没有 `authorize`，但有导入名 `Access`），三端 `live`，`currentEligible: false`；书记 `stale` 读没有它；执行输入一行“需复查”；建 0 | R5 第 4 条对顶层 X 不看导入名 → 读成 `broken [1]` |
| E-25b（改，核过以后） | R | 接 E-25a；E6 核；再读三处 | 核回 `broken`、`missing: [1]`，建 1；书记读里有它，原因 `link_evidence_broken:1`；执行输入一行“证据对不上” | R6 把 `not_found` 当 `found` 合并 → 核后仍 `verified` |
| E-26（不变，加数） | R | 写 K1、K2；`compose.ts` 第 1 行前插一行注释 | K1 `broken [1]`（新第 7 行没有 `beforeCall`）；K2 `broken [0]`（新第 8 行没有 `onSelected`）；建 0 | R5 第 4 条成员规则删掉 → 两条读成 `refs_pending` |
| E-31（改） | R | 读 K1 两次；改 `compose.ts` 第 10 行后读；E6 核；再读；再只改 `wire2.ts` 第 2 行后读 | 前两次 `verified`，建 0；第三次 `unchecked`/`refs_pending`，建 0；核建 1，回 `verified`；第四次 `verified`，建 0（内存结论）；改 `wire2.ts` 后仍 `verified`，建 0。取代 8E 复审意见 N7 | R7 不记结论 → 第四次读成 `refs_pending` |
| E-32 | — | 删（读不再重核，没有这个上限） | — | — |
| E-33（不变，加数） | R | 照 8E :748 | 照 8E；建 0 | — |
| E-34（改） | R | 写 K1、K2 和流程 [K1, K2]；`compose.ts` 第 7 行改成 `const access: Access = { before: authorize };`；再写证据没坏、取代 K1 的 K1' | 改后第 1 步 `problem: 'broken'`（第 7 行没有 `beforeCall`），整条 `stale`；取代后第 1 步 `not_current`、`item: null`，整条 `stale`；`gapsAfter: [1]` | R5 第 4 条成员规则删掉 → 第 1 步 `unchecked` |
| E-37（改） | G | 写 K1，第二档注入失败；读；E6 核（仍失败）；读；恢复；E6 核；读 | 写 `accepted`，`warnings: ['evidence_unverifiable']`，存 `unverifiable`/`analyzer_unavailable`，三端有定位，证据 `fileDigest` 不是 `null`；写后核对 `unchecked`/`refs_pending`；读 `refs_pending`，建 0；失败时核回 `unchecked`/`unavailable`，不记，再读仍 `refs_pending`；恢复后核 `verified`、建 1，再读 `verified`、建 0。设计 E-37 写的“查不了”按设计 §4.2 和 E-40 ③ 统一成 `unchecked`/`unavailable` | R5 把存下的 `analyzer_unavailable` 读成 `unverifiable` → 写后核对红 |
| E-38（改字） | G | 照 8E :753 | 照 8E；“0 个捕获”换成“建 0” | — |
| E-40（改③） | R | ① `compose.ts` 第 7 行改成 `{ before: authorize }`，`run.ts` 读口 `forbidden`；② 改回第 7 行，只让 `run.ts` 读不了；③ 恢复，改 `compose.ts` 第 10 行，E6 核时让第二档整次回失败（`verify` 外层故障，不碰读口）；④ 写时 `compose.ts` 读口 `forbidden` | ① `broken [1]`；② `unchecked`/`unavailable`，`currentEligible: false`；③ 核回 `unchecked`/`unavailable`，不记，再读 `refs_pending`；④ `invalid`、`evidence_invalid: link.evidence[1].at.path` | R5 合起来的先后颠倒 → ① 读成 `unchecked` |
| E-45（改） | R | K1 带 `basisFiles: ['src/compose.ts']`；g1 在 `run.ts` 上准备执行。① 改 `compose.ts` 第 10 行；② 再让 `src/contracts/access.ts` 读口 `forbidden`；③ 恢复，`compose.ts` 第 7 行改成 `{ before: authorize }` | ① `freshness: 'stale'`，`staleReasons: ['file_changed']`，`unchecked`/`refs_pending`，执行输入只出一行“需复查”；② `freshness: 'unchecked'`（“经过”读不了，`unchecked` 压过 `stale`），`staleReasons: ['file_changed']`，`unchecked`/`unavailable`，仍出一行“需复查”（修 NV:1211 的遮蔽）；③ `broken` + `stale`，只出“证据对不上”一行 | R11 回到只看 `freshness === 'stale'` → ② 没有行 |
| E-46（改） | R | 写 K1、K2、K3 和流程 [K1, K2]、[K1, K3]；改 `compose.ts` 第 10 行；E3 读流程；E6 一次核三条；再读 | 改后两条流程都 `unchecked`、`currentEligible: false`（三条都 `refs_pending`）；核建 1；再读两条流程都 `fresh`、`currentEligible: true` | R6 每条联系各建一次 → 建 3 |
| E-47（改） | G | 照 8E :762，写时让 `run.ts`、`permit.ts`、`audit.ts`、`access.ts` 的工作树读在 `maxBytes > 1` 时失败（存在性那一次 `maxBytes: 1` 放行，F13），并让第二档失败 | 两条联系 `accepted`、存 `unverifiable`/`analyzer_unavailable`；写后核对 `unchecked`/`unavailable`（读口故障还在）；两条流程照 8E 不变 | G2 把读失败当没有命中 → `link_end_unresolved` |

**新行**

| 行 | 组 | 入口 | 做什么 | 期望（手算） | 改坏 |
|---|---|---|---|---|---|
| E2-01 | W | 纯 | `namesInRanges` 一张表，名字 `authorize`：`x.authorize`；`p?.authorize`；`{ authorize: 1 }`；`A.authorize`（类型限定名）；`import('./p.js').authorize`；`export { authorize } from './p.js'`；`// authorize`；`authorize(id)` | 前七格 `uses` 都是 `other`、`textual: true`；最后一格 `free` | 去掉“`.` 后不算”→ 第一格红 |
| E2-02 | W | 纯 | `fileSyntaxOf` 一张表：`import a, { b as c } from 'x';`；`const { d } = require('y');`；`const { e } = await import('z');`；`import * as ns from 'w';`；`const f = 1;`（无 import/export）；`declare global {}`+`export {}` | `importNames` 依次 `[a, c]`、`[d]`、`[e]`、`[ns]`、`[]`、`[]`；第五格 `isModule: false`；第六格 `globalAugmented: true` | 漏 `require` 解构 → 第二格红 |
| E2-03 | W | 纯 | `navigationItemsOf`：8E 世界的 `overload.ts`、`dual.ts` | `overload.ts`：一项 `pick`，名字行 1，`declarationRanges` [1–1, 2–2, 3–5]；`dual.ts`：`First`（1–3）、`authorize`（名字行 2，`parentKind: 'class'`）、`Second`（4–6）、`authorize`（名字行 5） | 只取 `spans[0]` → `pick` 只剩 [1–1] |
| E2-04 | R | E3 | `src/contracts/access.ts` 存成带 BOM 的文件后写 K1；不改任何文件，读 | `verified`，三端 `live`，`currentEligible: true`，建 0 | R2 改成拿原始字节摘要比符号定位 → `refs_pending` |
| E2-05 | R | E1、E3、E6 | 写 injects：从 `run.ts` `runModel` 到 `permit.ts` `authorize`，经过 `access.ts` `beforeCall`；[0] `use` 同 K1；[1] `wire`：`src/wire3.ts` 第 4 行。碰一下 `wire3.ts`；读；E6 核 | 写 `verified`；碰后读 `unchecked`/`refs_pending`，不是 `broken`（`authorize` 只作为属性出现）；核后 `verified`，建 1 | R5 第 5 条不排除 `.` 后的名字 → 读成 `broken [1]` |
| E2-06 | R | E1、E3 | 写 calls：从 `run.ts` `dispatch` 到 `permit.ts` `onPicked`，key `'wg.audit'`；[0] `register`：`src/wg/reg2.ts` 第 1 行；[1] `use` 同 K3。碰一下 `reg2.ts`；读 | 写 `verified`；碰后读 `unchecked`/`refs_pending`（`onPicked` 只在 `export … from` 里） | R5 第 5 条把 `export … from` 里的名字算自由标识符 → `broken [0]` |
| E2-07 | R | E1、E3 | 写 calls：从 `run.ts` `dispatch` 到 `src/wg/gate.ts` 的 `constructor`，key `'wg.audit'`；[0] `register`：`src/wire4.ts` 第 3 行；[1] `use` 同 K3。碰一下 `wire4.ts`；读 | 写 `verified`；碰后读 `unchecked`/`refs_pending`（构造函数不走确定规则） | 让 `constructor` 走成员规则 → `broken [0]` |
| E2-08 | R | 第 4 片 S4B 夹具 | 注入 `readParseBytesMax = 36`；两条一般注记，锚点 `src/a/one.ts` 的 `one`、`src/a/two.ts` 的 `two`（夹具定编号，`one` 在前）；两个文件都碰一下（各变 36 字节）；一次读两条 | `one` 那条 `live`、`fresh`；`two` 那条 `freshness: 'unchecked'`、`currentEligible: false` | 不查字节预算 → 第二条 `fresh` |
| E2-09 | R | E6 | 写 K1、K3；改 `compose.ts` 第 10 行（两条都存疑）；E6 的 `items` 给 21 条（K1、K3 轮流）；再给 0 条 | 都是 `invalid`，建 0 | 不查上限 → 回 `ready`、建 1 |
| E2-11 | R | E4 | 4 条联系：K1、K3 和两条话题不同、形状同 K3 的联系（证据都有一条在 `compose.ts`）；改 `compose.ts` 第 10 行（4 条都存疑）；g1 在 `run.ts` 上准备执行；再撤掉其中一条，再准备 | 4 条时：没有逐条的“需复查”，只有一行合成行，`label` 是“这些节点上另有 4 条联系待核，不能当现行结论”，`noteId` 是 4 条里最小的，`conclusion: ''`，`freshness: 'unchecked'`；3 条时：3 行“需复查”，没有合成行 | 合并门槛写成 ≥3 → 第二次也合并 |
| E2-12 | R | E1、E3 | 接 E2-07（不碰 `wire4.ts`）；把 `src/wg/gate.ts` 第 2 行改成 `  constructor(readonly id: string) { void id; }` | “到”槽仍 `live`，`staleReasons: ['symbol_signature_changed']`，`freshness: 'stale'`；`verification` 是 `unchecked`/`refs_pending`（“到”的文件变了，[0] 要引用它；构造函数不走确定规则）。构造函数的位置是整段声明（F41），改函数体就变签名摘要 | R3 不比签名摘要 → 读成 `freshness: 'fresh'` |
| E2-13 | R | E9（等 §0.1 第 2 条） | 写 K1、K2、K4；g1 的 Work Run，脚本模型用真实 `edit` 把 `src/wg/permit.ts` 第 1 行的 `authorize` 改成 `authorise`，再要求下一次回复 | 下一次模型请求收到一条平台输入，只有 K1：`联系 <K1>（版本 1）被这次改动改断了：证据对不上（下标 1）。…`（文字写任务书时按包模板手写）；K2 不在里面（“到”`onPicked` 还在，读存疑，交给后台第二档）；K4 不在里面（只有字面 key，仍 `verified`）。之后 E3 读 K1 `broken [1]`、“到”`retired`。三条都挂在 `permit.ts` 上，按锚点读找得到 | R12 把存疑也交给执行者 → 输入里有 K2 |
| E2-14a | H | E7 | 写 K1；改 `compose.ts` 第 10 行；一个 Work Run 用生产的 `localWorkbenchGrant`、工作区没有写前缀（这时只给 `read`、看、找、核，只读命令看工作区设置，没有 `record_note`，`host.ts:444–449`（3642）；把它当授权的先例 `tests/app/S7C-L2.test.ts:230`），脚本模型调 `check_links` `{ items: [K1] }` | 回 `verified`。也证明 R14：Run 的上下文经平台身份读到了工作区 | `check_links` 跟着 `record_note` 装配（只给有 `record_note` 的线）→ 调用时没有这个工具 |
| E2-14b | H | E7 | 写 K1；改 `compose.ts` 第 10 行；照 `tests/app/S6A-local-secretary.test.ts:150–209`（`runPlainQuery`）走公开路由跑一个普通 Query：`queries/submit`（`execution.kind: 'semantic_query'`，没有请求）→ `queries/claim` → `queries/prepare` → `queries/start`，用 Host 发布的本地 Query 资料（同 `:326–341`）；Query 的脚本模型调 `check_links` `{ items: [K1] }`（第 2 稿这里是秘书 Query，E2R2-c-03 换掉） | `queries/prepare` 回的 manifest `request: null`、`answerShape: null`，照 `planningNoteAdmission`（`src/core/work-graph/state/secretary-note.ts:62–73`）就是 `noteAdmission: none`；`permissions.tools` 有 `check_links`、没有 `record_note`（`:223` 的 `localTools` 加 `check_links`）；工具回 `verified`，建 1 | Query 的 `check_links` 装配加注记准入条件（`noteAdmission.class !== 'none'` 才建，像注记工具那样，`query-execution.ts:493`（3642））→ 这次 Query 没有这个工具，调用失败 |
| E2-15 | H | E7、E3 | 写 K1；注入 `checkDeadlineMs` 很短（世界的 `noteLimits`），闸门扣住 `verify`；改 `compose.ts` 第 10 行；调 `check_links` [K1]；（闸门还扣着）E3 读；放开闸门，等那次 `verify` 返回；E3 读 | `check_links` 在闸门放开之前就回了，`unchecked`/`budget`；放开前读 `refs_pending`；放开后读 `verified`，建 1（那次被扣住的核答完照 R7 记，没有再建） | R6 不掐时限 → `check_links` 在闸门放开前不回，这一步超时 |
| E2-16 | H | E8 | 写 K1；改 `compose.ts` 第 10 行；E3 读 K1（进队列）；空闲时间注入成很短，没有在跑的 Run；Host 心跳走一次；E3 读；Host 心跳再走一次 | 第一次心跳建 1；之后读 `verified`，建 0；第二次心跳建 0（队列空了） | H2 不看队列 → 第一次心跳建 0 |
| E2-18 | H | E8 | 积压条数注入成 2；K1、K3 都存疑（改 `compose.ts` 第 10 行后各读一次）；同时有一个在跑的 Run（脚本模型扣住）；注入时钟让“距上次批量”过 10 分钟；心跳走一次 | 做一批（积压触发），建 1 | 积压条件也要求空闲 → 建 0 |
| E2-19a | S | E10（等 §0.1 第 2 条） | 5 条形状同 K2、话题不同的联系；`compose.ts` 第 1 行前插注释（5 条都 `broken [0]`）；E3 读一次；Host 心跳一次（中间没有账本提交） | 提醒正文里“断了的联系 5 条” | 断了的条数不进判门 → 不发 |
| E2-19b | S | E10（同上） | 只有 1 条断了（E3 读过）；心跳一次；注入时钟 +10 分钟；心跳一次（中间都没有账本提交） | 第一次不发；第二次提醒正文里“断了的联系 1 条” | 游标门不比断了的联系（S2）→ 第二次不发 |
| E2-19c | S | E9、E10（同上） | 照 E2-13 让 K1 断在一个还在跑的 Run 里（脚本模型在下一次回复处扣住）；心跳一次；注入时钟 +10 分钟，心跳；放开让 Run 结束；时钟再 +10 分钟，心跳 | 前两次心跳都不发（第二次时离第一次看到已满 10 分钟，但 Run 还在跑）；Run 结束后满 10 分钟那次发，正文“断了的联系 1 条” | S1 不看 `heldByRun` → 第二次心跳就发 |
| E2-20 | G | E1 | 世界加 `tsconfig.json`（`exclude: ["src/ui"]`）和 `src/ui/panel.ts`（`export function show() {}`）；一般注记挂 `src/ui/panel.ts` 的 `show` | 存下定位（今天：`symbol_unresolved`） | G7 仍走捕获 → 没有定位 |
| E2-21 | G | E1 | 同上的世界，一条 injects 的 [1] `wire` 证据在 `src/ui/panel.ts`（写成引用“到”“经过”的样子） | `accepted`、`unverifiable`/`analyzer_unavailable`，不是 `evidence_missing`（等 §6 第 2 条） | G4 把 `not_in_project` 当 `not_found` → `evidence_missing` |
| E2-22 | R | E1、E3、E6 | 对拍三行（§4.2 的文件）。每行写 injects：“从”是证据文件（文件端，不带符号），“到”和“经过”见下；[0] `use`：证据文件第 3 行（③是第 2 行）；[1] `wire`：证据文件第 2–3 行（③是第 1–2 行）。①“到”`src/wg/gate2.ts` 的 `Gate`，“经过”`src/contracts/access.ts` 的 `beforeCall`，证据文件 `src/use-gate.ts`；②“到”`src/wg/base.ts` 的 `Child`，“经过”`src/wg/base.ts` 的 `beforeCall`（`range` 第 2 行，即 `Base` 的那个），证据文件 `src/use-child.ts`；③“到”`src/wg/pair.ts` 的 `AB`，“经过”`src/wg/pair.ts` 的 `beforeCall`（`range` 第 1 行，即 `A` 的那个），证据文件 `src/use-ab.ts`。每行写、碰一下证据文件、读、E6 核 | 三行写时都 `verified`；碰后都 `unchecked`/`refs_pending`（“经过”是成员、名字在；“到”是顶层、名字在且是导入绑定）；核后都 `verified`，各建 1。写时的答案和整项目 `getReferencesAtPosition` 同答（§3.2 第 4 项确认，不一致报 lead） | W6 改成只用 `getSymbolAtLocation` + `getAliasedSymbol` → 核成 `broken [0, 1]`（`gate.beforeCall`、`child.beforeCall`、`ab.beforeCall` 解析到的不是“经过”那个定义） |
| E2-23a | R | E1、E3 | 写 calls：从 `run.ts` `dispatch` 到 `permit.ts` `onPicked`，key `'wg.audit'`；[0] `register`：`src/wire5.ts` 第 2 行；[1] `use` 同 K3。写后把 `wire5.ts` 第 1 行换成 `// gone`；读 | 写 `verified`；改后读 `broken`、`missing: [0]`（R5 第 5 条：`onPicked` 每一处都是自由标识符，文件里没有绑定它的东西） | 删掉第 5 条 → 读成 `refs_pending` |
| E2-23b | R | E1、E3 | 同上写；把 `wire5.ts` 第 2 行换成 `export const table = { 'wg.audit': 0 };`；读 | `broken`、`missing: [0]`（R5 第 4 条顶层那一半：范围里既没有 `onPicked`，也没有导入名 `onPicked`） | 删掉第 4 条顶层那一半 → 读成 `refs_pending` |
| E2-23c | R | E1、E3、E6 | 同上写；把 `wire5.ts` 第 2 行换成 `export const table = { 'wg.audit': box.onPicked };`；读；E6 核；再读 | 读 `refs_pending`（`onPicked` 在 `.` 后）；核回 `unverifiable`/`analyzer_unavailable`（`onPicked` 在 `.` 后，`box` 解析不出来，编译器取不到这个属性，W6 的 `undecided`），建 1，不记；再读仍 `refs_pending` | W6 删掉 `undecided` → 核成 `broken [0]` |
| E2-23d | R | E1、E3、E6 | 同上写；把 `wire5.ts` 第 1 行换成 `import { authorize } from './wg/permit.js';`、第 2 行换成 `export const table = { 'wg.audit': onPicked, name: String(authorize) };`；读；E6 核；再读 | 读 `refs_pending`（`onPicked` 都是自由标识符、文件里没有绑定它，但范围里还有导入名 `authorize`，R5 第 5 条不成立）；核回 `broken`、`missing: [0]`，建 1（`onPicked` 只作自由标识符出现、解析不出来，`String` 在没有配置的世界里解析不出来，都不让 W6 回 `undecided`；整项目也找不到）；再读 `broken`、`missing: [0]`，建 0（内存结论） | W6 照第 3 稿，范围里有任何解析不出来的名字就回 `undecided` → 核回 `unverifiable`/`analyzer_unavailable`，不记，再读仍 `refs_pending` |
| E2-24 | G、R | E1、E5 | 一般注记挂 `src/robot/drive.py` 的 `main`（`symbolRequest: { language: 'python', name: 'main' }`）；碰一下 `drive.py`，`lookup` 读；再把第 1 行改成 `def run(node):`，`lookup` 读 | 写 `accepted`、没有警告，存定位 `{ language: 'python', qualifiedName: 'main', range: 1–1, fileDigest: <十六进制字面量>, signatureDigest: <十六进制字面量> }`（今天：`symbol_unresolved`、没有定位）。两个摘要都由写测试的人手算、写成十六进制字面量（同 `S4A-note-symbol.test.ts:41–43` 的写法），不调用 `signatureDigestOf` 等生产函数生成期望（规则表 F8）：`fileDigest` 是 E5 世界里 `drive.py` 原文（`tests/helpers/S8E-semantic-world.ts:184–185`）的 sha256，`signatureDigest` 是 `'main'` 折叠空白后的 sha256；规格不先算值。碰后 `live`、`fresh`；改名后 `anchorStatus: 'retired'`、`['symbol_missing']` | R3 把 `python` 定位一律读 `unchecked` → 改名后 `freshness: 'unchecked'` |
| E2-25 | R | E3 | 写 calls：从 `run.ts` `dispatch` 到 `audit.ts` `audit`，经过 `permit.ts` `onPicked`，key `'wg.audit'`；[0] `register`：`compose.ts` 第 9 行；[1] `use` 同 K3；然后删掉 `permit.ts` 第 4 行 | “经过”槽 `retired`、`['symbol_missing']`；`verification` 仍 `verified`（calls 的证据不引用“经过”，`LE:229`）；`freshness: 'fresh'`；`currentEligible: false` | R10 只看主锚点 → `currentEligible: true` |
| E2-26a | F2 | E2、E5 | 注入 `projectFlowQuota = 1`（世界的 `noteLimits`）；你经 `notes/write` 写 K1、K2、K3，再写两条流程 [K1, K2]、[K1, K3]（同 E-46 的两条，都 `accepted`）；`lookup` 读两条流程 | 两条流程都读出 `overQuota: true`（项目里现行的流程 2 条 > 1） | 不数 `flow` 的项目人口 → 都是 `false` |
| E2-26b | F2 | E2、E5 | 注入 `goalLinkQuota = 2`；你在同一个目标里写 K1、K2 和流程 [K1, K2]（人写不进待审，照收，`NS:1918–1930`）；`lookup` 读 K1 | K1 读出 `overQuota: true`（这个目标的联系和流程共 3 条 > 2；今天只数联系，2 条，读 `false`） | 目标人口不数 `flow` → `false` |
| E2-27 | F2 | E3 | `architecture/semantic-links`、`architecture/semantic-flows` 各传 `scope: { kind: 'bogus' }` | 都回 `invalid` | 不校验 `scope` → 500 |
| E2-29a | G、R | E1、E5 | 世界加 §4.2 的 `cpp/` 两个文件和 `compile_commands.json`；一般注记挂 `cpp/src/math.cpp` 的 `pick`（`language: 'cpp'`）；碰一下 `math.cpp`，读；再把第 2 行的 `pick` 改成 `take`，读 | 写存定位（今天：`symbol_unresolved`），`range` 2–2；碰后 `live`、`fresh`；改名后 `retired`、`['symbol_missing']`（有 `compile_commands.json`、写时留下了 preamble，`exact: true`） | 有 `compile_commands.json` 也退回不带头文件的解析、找不到读 `unchecked` → 改名后 `freshness: 'unchecked'` |
| E2-29b | G、R | E1、E5 | 同上，但没有 `compile_commands.json`；写；把 `pick` 改成 `take`，读 | 写存定位（不带头文件的单文件解析找得到第 2 行的 `pick`）；改名后 `freshness: 'unchecked'`，不是 `symbol_missing`（§9-7 “找不到读作存疑”） | 退回的解析找不到也读 `symbol_missing` → `retired` |
| E2-29c | G、R | E1、E5 | 同 E2-29a 的世界（有 `compile_commands.json`），`math.cpp` 第 1 行前插一行 `#include "/opt/e2-29c/extra.h"`（工作区外，也不在 W11 第 1 条放进的目录里）；写；把第 3 行的 `pick` 改成 `take`，读 | 写存定位，`range` 3–3（`KeepGoing` 照样往下解析）；改名后 `freshness: 'unchecked'`，不是 `symbol_missing`（这次解析有 fatal 级诊断“file not found”，W11 第 5 条，`exact: false`） | W11 第 5 条不看诊断（有 `compile_commands.json` 就 `exact: true`）→ 改名后 `retired`、`['symbol_missing']` |
| E2-29d | G、R | E1、E5 | 同 E2-29a 的世界，`math.cpp` 第 1 行前插一行 `#include <cstddef>`；写；把第 3 行的 `pick` 改成 `take`，读。跳过条件：精确模式不可用（W11 第 4 条那个只含 `#include <cstddef>` 的 C++ 内存小文件解析不出；测试自己用同一个 libclang 解析同样的小文件先试一次，不调生产的探测）；本机已装 `libclang-common-18-dev`，能跑 | 写存定位，`range` 3–3，写时建好 preamble；改名后的读是这个小文件带 preamble 的重解析，不靠贴着 `NOTE_NATIVE_READ_WAIT_MS`，读 `retired`、`['symbol_missing']`（精确解析读得到 `<cstddef>`，没有诊断，`exact: true`） | W11 第 1 条不把系统头文件映射进虚拟文件系统（照甲只看工作区）→ `<cstddef>` 找不到、有诊断、`exact: false`，改名后读 `freshness: 'unchecked'` |
| E2-30 | R | E3、E6 | 写 K3（8E §5.2：calls，key `'wg.audit'`；[0] `register` 是 `compose.ts` 第 9 行 `handlers.set('wg.audit', audit);`，`S8E-semantic-world.ts:171`、`:282–292`）；碰一下 `compose.ts`；E3 读；闸门扣住 `verify`（在真实 `verify` 开始之前，§4.1），E6 核 K3；扣着的时候把 `compose.ts` 第 9 行换成 `handlers.set('wg.other', audit);`（字面 key 没了，对“到” `audit` 的引用还在）；放开，等核对回来；E3 读（E2R2-c-01） | 碰后读 `unchecked`/`refs_pending`（第 9 行字面 key 在、`audit` 还在），建 0；核回 `unchecked`/`unavailable`，建 1，不记（`analysed` 里 `compose.ts` 的摘要不等于第一档读到的，R7）；之后读 `broken`、`missing: [0]`（第 9 行没有 `'wg.audit'`，R5 第 2 条），建 0 | 删掉 R7 的摘要比较 → 核回 `verified`，之后读也是 `verified`（内存结论按新摘要命中） |
| E2-31a | W | W 的公开 `lookup`（§4.1） | §4.2 的 `gate` 三个文件；同一个 `NativeSingleFilePort` 里 `lookup`（`language: 'cpp'`，`src/gate.cpp`，`mode: 'write'`）一次；只把 `include/gate.hpp` 第 2 行改成 `#define GATE_ON 0`（`gate.cpp`、`compile_commands.json` 不动）；再 `lookup` 一次（`mode: 'write'`，`text`、`digest` 同第一次）（E2R2-c-02） | 第一次 `parsed`、`exact: true`，`symbols` 里有 `pick`（名字起点 3 行 5 列）；第二次 `parsed`、`exact: true`，`symbols` 里没有 `pick` | 缓存命中后继续向重解析提供上次的头文件内容（翻译单元按“路径 + 参数”命中后，不换成这次经读口读到的，W11“头文件怎么到进程”、第 3 条；E2R3-02）→ 第二次还有 `pick` |
| E2-31b | W | 同上 | 新开一个临时目录建同样的三个文件、一个新的 `NativeSingleFilePort`；`lookup`（同上）一次；只把 `compile_commands.json` 里这一条的 `-DAPI_ENABLED=1` 删掉（两个源文件不动）；再 `lookup` 一次（E2R2-c-02） | 第一次有 `pick`；第二次 `parsed`、`exact: true`，`symbols` 里没有 `pick` | 翻译单元只按路径留、不看编译参数（W11“复用”）→ 第二次还有 `pick` |
| E2-33 | R | E1、E3、E6 | 写 calls：从 `run.ts` `dispatch` 到 `permit.ts` `onPicked`，key `'wg.audit'`；[0] `register`：`src/wire6.ts` 第 2 行（经 `src/wg/hub.ts` 的 `export *` 导入）；[1] `use` 同 K3。碰一下 `wire6.ts`；读；E6 核 | 写 `verified`（今天整项目捕获也找得到）；碰后读 `unchecked`/`refs_pending`（`onPicked` 是导入绑定）；核回 `verified`，建 1 | W6 只搜 [证据文件, X 的文件] → 写时 `evidence_missing`、`evidenceIndexes: [0]`，拒 |
| E2-34 | W | Kernel 公开入口 `WorkspaceSandbox`（§4.1） | 照提速研究的刁难夹具（`D:/cc-lead-notes/tools/tmp-sp8e2-readpath-b.ts:18–42`）在临时目录建工作区：普通文件、多层目录、指到工作区外和 `..` 的目录、文件、绝对路径符号链接，`.git`、`.env`、`hidden-tests`，FIFO、二进制、坏 UTF-8、超上限、文件当父目录、目录当文件、缺文件、缺目录、无读权限的目录和文件；43 个路径（含 `..`、绝对路径、反斜杠、空串、NUL、`C:/`、重复、乱序）。逐个调 `read(path, 1024)` 记下结果或错；再用 `via: 'sync'`、`via: 'async'` 各调一次 `readMany(这 43 个, 1024)`（提速裁定第 4 条） | 两次 `readMany` 的 43 项都和 `read` 逐项相同：读到的比 `path`、`content`、`byteLength`、`revision`、`mode`、`identity`；失败的比错误名、码、消息 | W12 的同步版不调抽出来的检查函数、少判“是不是普通文件” → `fifo` 那一项 `read` 回 `not_file`，`via: 'sync'` 的 `readMany` 回读到的空内容 |
| E2-35 | R | E3 | 写 K1；改 `compose.ts` 第 10 行；E3 读 K1；再把 `compose.ts` 第 7 行改成 `const access: Access = { before: authorize };`；E3 读 K1；不改文件再读一次（同一个 Host） | 第一次 `unchecked`/`refs_pending`（同 E-31 第三次）；第二次 `broken`、`missing: [1]`（第 7 行没有 `beforeCall`，同 E-40 ①）；第三次和第二次逐字相同（命中按摘要记下的解析结果）；三次都建 0 | 解析结果的键不带解码文字摘要、只按路径存（R7 第二个例外）→ 第二次命中第一次的答案，读成 `refs_pending` |
| E2-36 | R | 第 4 片 S4B 夹具 | 接 E2-08（`readParseBytesMax = 36`，两个文件都碰过，第一次读 `two` 那条 `unchecked`）；不改文件，用同一个夹具再读一次两条 | `one` 那条仍 `live`、`fresh`（命中，不占字节）；`two` 那条这次解析得到，`live`、`fresh` | 命中也扣字节预算（R4）→ `two` 那条仍 `freshness: 'unchecked'` |

8E 的 E-11、E-13、E-19b、E-42、E-43 归 F2，期望不变；E-27、E-35 的期望不变（只换故障点，§4.4）。第 1 稿的 E2-10（线程崩了重起）、E2-17（后台让位）删掉：外层的故障和闸门碰不到线程里面，改坏 W1、W2 这两行照样绿（§6 第 9 条）。

### 4.4 要改的旧测试

| 文件:行 | 组 | 现在 | 改成 |
|---|---|---|---|
| `tests/work-graph/S8E-L2-link-write.test.ts:241`（E-27） | G | 让 TS 捕获失败，期望 `['symbol_unresolved', 'evidence_unverifiable']` | 故障换成 `drive.py`、`teleop.py`、`ports.py` 三个端文件的工作树读在 `maxBytes > 1` 时失败；期望不变。它证明 `checkSymbol` 先看扩展名（F44）：改成先读文件，三个端都读成 `unavailable`，`symbol_unresolved` 就没了 |
| 同文件 `:312`（E-35 两变体） | G | “捕获失败”“读 JSON 失败” | 删“捕获失败”那一变体（没有对应物）；“读 JSON 失败”不变 |
| 同文件 `:363–:400`（E-37） | G | 字面 key 的 `data`，捕获查询 `source_stale` → `analyzer_unavailable`，`:394–395` 两处断言 | 整行按 §4.3 的 E-37 重写成 K1（要查引用）；这条 `data` 在新写法里单文件就核完，写和读都是 `verified` |
| 同文件 `:403`（选择器不可用） | G | 符号查询故障 | 改成 `run.ts` 的工作树读（`maxBytes > 1`）`unavailable`；期望不变（`evidence_unverifiable`，不当整个文件） |
| 同文件 `:470` | G | 工作树读不了，留捕获文字 | 期望不变（`['evidence_unverifiable']`：端读不了只记“查不了”，不加 `symbol_unresolved`，F44）；没有捕获文字可留，证据 `fileDigest: null`；“从”端 `runModel` 也读不了，存成普通文件锚点（L3 读回那一半跟着写） |
| 同文件 `:492`、`:520` | G | 捕获起没起、捕获里有没有文件的变体 | 删变体，各留一行（工作树没有这个文件 → `evidence_missing [1]`） |
| 同文件 `:548`（扫到命中上限） | G | 上限 → `analyzer_unavailable` | 删（单文件不分页） |
| 同文件 `:582`（E-38） | G | `counters()` 是 `{ captures: 0, queries: 0, textQueries: 0 }` | `{ builds: 0 }` |
| `tests/work-graph/S8E-L2-link-refusals.test.ts:246` | G | 符号查询 `forbidden` | `compose.ts` 工作树读 `forbidden`；期望 `evidence_invalid: link.evidence[0].at.path` 不变 |
| `tests/work-graph/S8E-F-write.test.ts:204`（E-47） | G | 让 TS 捕获失败 | 让四个端文件的工作树读在 `maxBytes > 1` 时失败，并让第二档失败 |
| 同文件 `:217–218` | G | `linkVerification` 是 `unverifiable`/`analyzer_unavailable` | `unchecked`/`unavailable` |
| `tests/helpers/S8E-semantic-world.ts` | R、G、H | `faultCaptures`、`faultQueries`、`{ captures, queries, textQueries }` | R 加 `verify` 的计数（`builds`）、失败和闸门，`faultReads` 也包住 `readWorkspaceFiles`（`:447` 今天只包 `readWorkspace`）；G 删捕获和查询两个口；H 加 Host 选项的口、调 `check_links` 的口和传生产授权的口 |
| `tests/README.md:165` | G | 世界有“捕获计数” | 改成“建程序计数” |
| `tests/work-graph/S4A-note-symbol.test.ts:176` | G | 跨页扫符号，找到 `f55` | 单文件找到；期望的定位不变（`range` 217–217，`fileDigest: PAGED_DIGEST`，`signatureDigest: F55_SIG`），标题改词 |
| 同文件 `:169`（`cobol` → `symbol_unresolved`） | G | — | 不变（G7 照旧按 `language` 分派） |
| 同文件 `:191` | G | TS 文件扫到上限不存定位 | 删（TS 不再分页；`symbolHitsMax` 删掉，G9） |
| `tests/work-graph/S4B-note-symbol-recheck.test.ts:44` | R | `symbolHitsMax: 2` 扫到上限 → `unchecked` | 删；`:28`、`:59` 不变 |
| `tests/work-graph/S4B-note-anchor-status.test.ts:155` | R | `symbolRecheckMax: 1`，第二项 `unchecked` | 期望不变（改成文件数预算）；标题改词；`:140`、`:171`、`:190` 不变 |
| `tests/helpers/S4B-note-check-fixture.ts:78`、`:135`；`tests/helpers/S4A-note-fixture.ts:50–54`、`:148` | R、G | 有 `linkRecheckMax`、`symbolHitsMax` | R 删 `linkRecheckMax`、加 `readParseBytesMax`、`checkDeadlineMs`；R 让 `S4B-note-check-fixture.ts:118–128` 的 `workspaceFault` 也包住句柄的 `readWorkspaceFiles`（同一个开关）；G 删 `symbolHitsMax` |
| `tests/runtime/S4C2-assembly.test.ts` | R | 执行输入的注记行 | 加 R11 的行（开工副本上核具体断言） |
| `tests/work-graph/S4B-memory-find-stale.test.ts` | R | 书记 `stale` 读 | 存疑的不进；`broken` 的进（开工副本上核） |
| `tests/runtime/S7B-preparation-freeze.test.ts:23–27` | R | 手抄的 `DELIVERY_IDS` 七个 | 末尾加 `'link-breaks-input'`；`:71`、`:113` 展开它，跟着变 |
| `tests/helpers/S7B-delivery-samples.ts:12–20`、`:23` 起 | R | `DELIVERY_SET_IDS` 七个；`DELIVERY_SET_TEXTS` 七份 | `'user-decision-response',` 之后加 `'link-breaks-input',`；`DELIVERY_SET_TEXTS` 加它的模板文字（逐字，不带结尾换行）；文件头注释里的 “seven” 改 “eight”，`:11` 注释加一句。展开它的测试（K2 :777 列的 5 个和别的）不另改 |
| `tests/contracts/PC2-platform-scan.test.ts:69–79` | R、H | 豁免行按行号冻结 | skill 新句子不在工具块外写裸词 `check` 时不改；写了或行号移位时，按新行号改豁免行（H 在四个 skill 的“先查再写”之后加句子，work、secretary、adviser、scribe 的豁免行都会移位） |
| 同文件 `:37–58`（`EVERY_TOOL_NAME`） | H | 展开各工具名常量；`:117` 要包里每个工具名都在里面 | 加 `...LINK_CHECK_TOOL_NAMES`（从 `link-check-tool.ts` 导入） |
| `tests/contracts/S6A-secretary-templates.test.ts:32–35` | R、H | 四个 skill 的 sha256 | 按新文件重算（R 改 work；H 改 work、secretary、adviser、scribe） |
| `tests/runtime/PC2-joint-tools.test.ts`、`tests/runtime/PC2-W-note-tool.test.ts`、`tests/runtime/S6B2-secretary-note-tools.test.ts`、`tests/app/AG6-agent-assembly.test.ts` | — | `record_note` 的规格和说明 | 不改（第 3 稿 `record_note` 不变，E2R1 裁定 18） |
| `tests/state/unknown-call-kinds.test.ts:23` | H | 第 2 行的平台只读工具名单 | 加 `'check_links'` |
| `tests/runtime/K3-34-tool-name-constants.test.ts:21`、`:27` | H | 只读的协作工具名逐个映射成 `read_only` | 加 `LINK_CHECK_TOOL_NAMES` 的每个名字映射成 `read_only` 一行 |
| `tests/app/S6A-local-secretary.test.ts:223`、`:226` | H | 本地授权、秘书的工具清单（修订号按它算） | `'find_graph'` 之后加 `'check_links'` |
| `tests/contracts/PC-platform-pack-v2.test.ts`、`tests/work-graph/S8E-R-pack.test.ts` | R、H、S | 包的摘要、字符串、`origins`；`PC-platform-pack-v2.test.ts:39–45` 的 `NAMED_SKILL_TOOLS`、`:54–55` 的 skill 版本 | R：`origins` 加 `'link-breaks-input': { packId: 'platform', version: 1, mentionsTools: [] }`、两段新字符串；H：`NAMED_SKILL_TOOLS` 加 `'check_links'`，四个 skill 的版本跟着 `pack.json`；H、S 按改的条目重算 |
| `tests/helpers/PC2-pack-fixture.ts:104`、`tests/contracts/PC2-resolve-pack.test.ts:157` | S | `scribe-reminder` 模板文字 `'{{marker}}\n{{pendingCount}}\n{{updateDueCount}}{{anchors}}'` | 加 `\n{{brokenCount}}`（必填槽，F46） |
| `tests/app/S4C2-scribe-reminders.test.ts:497`、`:506` | S | 正文含“待审 10 条”、请求号字面 | 不变（没有断了的联系时身份集合和请求号不变）；开工副本上核正文断言 |
| `tests/work-graph/S8E-R-route.test.ts` | F2、R | links 路由 | F2：坏 `scope` 行（E2-27）可放这里；R：check 路由的接线行 |
| `tests/architecture/production-reach-allowlist.json` | F2、R、H、S | — | F2 删两条（FR7）；R 加 `doubtfulLinks`、`brokenLinks` 两条 kept-for；H、S 各删一条 |

## 5. 不做的事

- 按计划或改动范围预先加载（§1 第 5 条）。
- 常驻的整项目分析；落盘的解析缓存；跨进程（多个 Host）共用。
- 跨次复用文件清单（W3）。每次核列全部文件要 0.6–1.8 秒（§3.2 第 2 项），但没有可靠的失效信号：`projectChanged` 只在采用、修订目录和检查通过时触发（`auto-capture-driver.ts:59–60`），`workspaceRevision` 是配置号（`host.ts:153`（3642）），Run 里的 `edit`、shell、git 和平台外的改动都会增删文件。清单旧了，模块解析看不到新文件、可能解析到别的文件，核出错的结论还会照 R7 记下。
- 第二档的结论落记录、租约、事件。
- 按锚点读、锚点上没注记又找不到文件时开的文本捕获（F14），开销没量，不动。
- 书记提醒心跳数存疑（只数断了的）。
- 目录修订号进门（§6 第 3 条）。
- 有注记、有联系的真实运行：重新量读写频率和读的延迟（例如第 9 片 G6 的场景）。
- 证明运行时走哪条分支、装的是哪个实现（8E L3e 不变）。
- Python/C++ 的引用核对，以及 Python/C++ 文件当联系的端（8E §1.2 不变，F44）。
- 探索工具 `symbols` 自己那份 Python `ast` 访问器（`exploration-tools.ts:21`）不改（§6 第 7 条）。
- 类型别名里的字段当联系的“到”“经过”或符号 key（F50）。同 8E-1，写时回 `link_end_unresolved`；要做就得改 8E L3 `:364` 的“规则同第 4 片 L14”，另问用户。
- 第一档提速里没收的（提速裁定第 1 条，`speed-study-judge.md` §4）：按 stat 元组判“没变的文件不读”（老内核时钟回拨、mmap 写、drvfs 上 Windows 程序改回 ChangeTime 都会读成没变）；`fs.watch`（队列溢出时悄悄丢事件，drvfs 上没有事件）；把每次新解析的预算降到 256 KiB（主线程的总工作不变，大改后的第一次读多出“这次没核”）；分析线程预解析、只扫词、不设父指针、换 JSDoc 模式。

## 6. 留给 lead 的问题

1. **R12 不等第二档。** Kernel 在最终回答之后不再拉输入（F26），没有“收尾”这个点。本稿在每个 `before_model` 安全点只做第一档（毫秒级），存疑的在后台用 `run_end` 优先级核，核出断了的在之后的安全点交。代价：最后一次改文件之后只剩一个安全点时，第二档核出的断交不到执行者，由书记兜底（S，Run 结束后 10 分钟）。另一个做法是在安全点等第二档（最多 `NOTE_CHECK_DEADLINE_MS`），每次改完文件后的模型请求可能多等几秒，偏离 §1 第 1 条和 §9-6(a) 的“每个 Run 一次、不占 agent”。本稿选不等。
2. **不在 TS 项目里的文件。** 设计 §5 建议答“查不了”（`unverifiable`/`analyzer_unavailable`），不答“找不到”，并改 8E C9 那句。但 §9-8 让存下的 `analyzer_unavailable` 读作存疑、不算现行。本稿的做法：写时存成 `analyzer_unavailable`，读作存疑；后台核出 `not_in_project` 记成 `unverifiable`/`analyzer_unavailable`，内存命中时照常算现行（8E :498）；重启后又是存疑，直到再核。同一个原因字在存下的和内存里意思不同。lead 定这样可以，还是加一个原因字。
3. **目录修订号进不进门。** 设计 §5 建议不进；本稿按不进写。
4. **第二档的判法**用 TS 引用引擎、只留证据文件里的命中（设计 §3.1，复函第 3 条；第 4 稿起搜整个程序，裁定第 5 条，W6）。设计把它列为 lead 定的，本稿按它写了。
5. **单文件导航树和捕获逐文件不一致时**（§3.2 第 3 项），lead 裁定是改单文件的取法还是接受差别。
6. **`check_links` 时限到了的原因字。** 本稿选 `unchecked`/`budget`；也可以是 `unavailable`。
7. **重复的 Python 访问器。** W11 的 Python 模式和探索工具 `symbols` 的 `PYTHON_AST`（`exploration-tools.ts:21`）规则相同，会有两份。本稿不改探索工具（AGENTS 第 3 条：不做顺手重构）。lead 定要不要以后让探索工具改用 W11 的常驻进程。
8. **R12 只看挂在改过的文件上的联系。** 证据在改过的文件里、端不在的联系（例如组合根里的接线）这里查不到，要等之后的读和书记。要查全得给证据路径加索引。本稿不加。
9. **W1 重起、W2 让位没有验收行。** 外层的故障和闸门只能整次失败或扣住整次 `verify`，碰不到线程里面。要配行，得给分析器留一个测试缝（例如创建时可注入 `{ spawnWorker?, beforeGroup?: (i) => Promise<void> }`），按 W 层的公开接口测“杀掉线程后下一次重起”和“组与组之间让位”；这是新入口，要 lead 写一行裁定，也要用户确认入口。不加就照本稿：两条规则只靠审查。（第 2 稿这里还有 `lookupToolCommit` 的 `check` 分支没有行；第 3 稿删了那个分支，E2R1 裁定 18。`check_links` 调用结果未知时按 `unknown-call-kinds.ts` 第 2 行当只读，也没有行，同样要崩溃夹具。）
10. **总的先后**（§3.4）：本稿建议 A1a/A1b 之后、7D2-1 其余包之前落 8E-2（S 除外），S 在 7D2 O5b 之后。lead 定；改了的话，§3.4 的表和 §7 的修订行跟着改。
11. **G 的测试预算**（§3.5）：§4.4 点名删的行算不算进 G 的预算。
12. **C++ 的“第二档”。** §9-7 写“第二档照旧开现成的整项目分析器、放后台或 Run 收尾”。本稿对 C++ 锚点不另做这一档：没有 `compile_commands.json` 时现成的 C++ 分析器本来就回不支持（F7），核不了；有的时候，存疑来自“preamble 还没建好”（后台用精确解析的参数预热以后，下一次读就是精确解析）或这次解析有 error、fatal 级诊断（W11 第 5 条，预热也去不掉）。选乙以后精确解析读系统头文件、`cpp_index` 不读，两者的编译参数不再相同，整项目分析器的结论不能拿来顶替精确解析。lead 确认这个读法，或者要求照字面加一条后台路径。
13. **`undecided` 会反复核。** 照 R7，`undecided` 不记，这种联系每次空闲都重建程序再核一遍，永远是存疑。设计接受不记（设计 §3.1、§4.2）。W6 收窄以后（§3.2 第 4 项），只剩范围里 X 的名字作属性出现、编译器又取不到那个属性的情形（例如 `box.onPicked` 的 `box` 解析不出来，或接收者是 `any`）；没有配置时的全局名、导入没了的 X 的名字不再让它 `undecided`。lead 知道这个代价，定接不接受。

**lead 裁定（E2R1，11-03 晚；`impl/s8e/e2r1-rulings.md`）。** 下面三条是 Codex 第一轮提的、lead 判为过度或改成别的做法，已定，不用再答。

14. **（裁定 15）`check_links` 到时限不逐组交付。** 设计 §3.5 `:188` 写“到时已核完的照回、照记”；Codex（E2R1-a-03 = b-05）要给 `verify` 加逐组完成的回调。不加：时限先到，这次交第二档的整批都回 `unchecked`（`budget`）；第二档照常答完，按 R7 记（R6）。理由：一次 `verify` 只建一个程序，各组之间只差毫秒级，逐组回传几乎不改变结果，却要给线程加一条逐组的消息通道、给 R7 的摘要表加一层。这是对设计的偏离，lead 已裁定。
15. **（裁定 16）后台批量要租约。** 设计 §4.4 `:237` 写“没有租约要求”；Codex（E2R1-c-05）要把核对挪到租约条件外面。代码不改：后台批量只在有租约的 Host 上跑，同自动抓（`host.ts:860`（3642））。理由：没有租约的 Host 不跑任何后台活（不进 Kernel、没有 Run）；它上面读照样读成存疑，不会读错；人点的“重新核对”路由不在租约门里（`leaseGated` 只挡 start、advance 这几条，`host.ts:2722–2733`（3642））。这是对设计的偏离，lead 已裁定（H2）。
16. **（裁定 17，由裁定 18 取代）只读线也能核。** Codex（E2R1-c-03）说没有 `record_note` 的线核不了。lead 先裁定照现有装配（第 17 条），用户 11-03 晚问“审阅的更需要可以看？”之后改成第 18 条：核对不挂在 `record_note` 上，改成单独的只读工具 `check_links`，和“看”“找”同一处装配，有看、找的线都有，7D2 的 reviewer、`noteAdmission` 为 `none` 的 Query、没有写前缀的 Work Run 在内（H3、H4、§7 的 7D2 修订）。第 11 条（`noteCommandReceiptOf` 收窄）和第 17 条随之作废。

**在研究（11-04）。** 第一档最坏情形的提速（读口批量、没变的文件不读、改后先解析）在研究，结果出来 lead 再定，不影响本稿。

## 7. 要改的文档（冻结时 lead 改）

- **HANDOFF：** 记 §3.2 开工先量和 11-04 第一档提速的结果（经平台读口：第一档典型约 5–15 毫秒；最坏本地盘空闲约 110–150 毫秒、忙时约 160–280 毫秒，Windows 盘约 0.4 秒，页上有改过的 C++ 函数注记时可能到约 300 毫秒；同一状态再读 20–45 毫秒；用户 11-04 选 A，要求典型 ≤100 毫秒、最坏约 450 毫秒，§0.1 第 3 条；第二档同一片代码第二次起约 2–2.5 秒，W3 改用 `readMany` 后估少约 1 秒，Host 刚启动 5–9 秒）。115-2 那句（`:2083`）的“典型 ≤100 毫秒、上限 300 毫秒”和“之后约 0.2–1 秒”是按普通文件读估的，各加这条实测说明。记用户 11-04 定的读法（“自动看目录或者磁盘格式就行……两种都会用……linux 也算”：Kernel `readMany` 按工作区根的文件系统自动选同步版或异步版，W12），和 Kernel 补丁 `sandbox/workspace/workspace-sandbox.ts` 加 `readMany`。记决定 117（用户 11-04，§0.1 第 4 条选乙：放宽 C++ 分析器“只读工作区文件”的规矩，只放宽到编译器自己的头文件目录，只读；机器上用不了时照旧只看工作区，W11）。记决定 116-2（§9 八件的用户答复，含 §0.1 两条的处理）。决定 87 的后注 `:799` 改写成一条新决定，草稿照设计 §6.1，“python/cpp 函数上的注记”那半句按 §9-7 写成“挂在 Python/C++ 函数上的注记也在单个文件里按名字重找（Python 常驻 `ast` 进程；C++ 有 `compile_commands.json` 时 libclang 单文件加 preamble，没有时找不到读作存疑）”；保证那一句（`:794`）不变。
- **DECISIONS.md：** 87-1（`:214`，“代码变化后重核”那一栏）、115-2（`:378`）、87（`:213`）跟着改；加 116-2、117 两行。
- **E3-UI-ITEMS D87-1（`:373`）：** “这次没核，和原因（预算用完或读不了）”加“或跨文件引用待核（存疑）”；加“重新核对”按钮。
- **8E 规格：** 按设计 §6.2 的表改：`:3` 状态加一句；F17 `:41` 注明 Python/C++ 一般注记两档后能存定位（联系的端仍不能）；F22 `:46` 注明两档后读侧不再开捕获；§0.3 第 4、5 条 `:84`、`:85`；§0.4 `:90`、`:93`；§2 `:164`（加 `refs_pending`、核对入口和路由的签名）、`:300`（删预算）；L3 `:363`；L1 `:353` 的括号、L3a C9 `:404`（一处改完，含三件：W6 的 `undecided`、§6 第 2 条的“不在 TS 项目里”、类型别名里的字段当不了端，F50）、`:420` 之后加实测结果（三处的文字见下）；L3b `:429–441`、`:442`、`:460–479`、`:482`；L3c `:487–500`（含 `:494`、`:497`、`:498`、`:500`）；L3d `:501–516` 整段改写成本规格 §2；L3e `:517–525`（加：第一档判不了跨文件；`extends`、`package.json`、再导出中转文件在门外）；L9 `:557`；L10 `:564`；L11 `:567–578`（加只读工具 `check_links`，和看、找一起给；不改 `record_note` 的 `op`）；L12 `:579`（后台批量不唤醒书记、存疑不进待查；书记提醒数断了的联系）；§5.1 `:598`、`:600`；§5.2 的 E 行照 §4.3；§6 `:780`、`:787`；§7 `:803–813` 换成本规格 §3；§8 `:823`。
  - `:353` 的括号“（L3a 例子的第 1 步）”改成“（L3a 例子的第 1 步；类型别名里的字段当不了端，见那里的实测结果）”。
  - `:404` 的“没有配置时分析器用 `noLib`（`typescript-source-query.ts:290–292`），经 `Pick` 这类映射类型的引用可能解析不出来；这时第 2 步的引用证据找不到，写时是 `evidence_missing`。”改成“没有配置时分析器用 `noLib`（`typescript-source-query.ts:114`），经 `Pick` 这类映射类型的引用可能解析不出来。8E-2 以后有三种情形：范围里 X 的名字作属性出现、编译器又取不到那个属性时，第二档不下结论（8E-2 W6 的 `undecided`），写时记 `analyzer_unavailable`、照收，读作存疑；证据或定义不在配置的项目文件里时，也记 `analyzer_unavailable`（8E-2 §6 第 2 条）；其余找不到的，写时仍是 `evidence_missing`。本例两步的“经过”是类型别名里的字段，不是导航项，写时先回 `link_end_unresolved`（见下面的实测结果）。”lead 答 §6 第 2 条时如果加了原因字，这里跟着换。
  - `:420`（“查不到就报 lead，改例子或改查法；……（C9）。”，原文不动）之后加一条，答 `:416–419` 要实测的三件事：“**实测结果（8E-2 开工先量，2026-11-03）：** 类型别名（`type X = { … }`）里的字段不是 TS 导航项：导航树把类型别名当叶子，不进它的类型字面量，接口、类的成员才是导航项。所以 `symbols` 查不到 `modelCalls`、`modelRequests`，两步的“经过”写时都回 `link_end_unresolved: extraAnchors[1]`。这个例子今天写不进去，两档以后也一样（8E-2 F50）。按位置查引用时，经 `Pick<…>` 读 `modelRequests` 的 :76（`model-call-access.ts:18–19`），和 :1183、:966 的简写属性都查得到。这个例子只用来说明一条联系怎么拆成两跳；能当“经过”的是接口或类的成员、顶层声明，例如 §5.2 的 `Access.beforeCall`。”
- **第 4 片规格：** L23 `:266`（单文件解析，含 Python/C++；“每页最多重解 20 次”改成“一次调用最多单文件解析 20 个文件，总字节不超过上限”）；`:527` 常量注释；M-15 `:657`；R4 `:750`（删“扫到上限”“捕获里读不到这个文件”两种 `unchecked`，加“超字节预算”和“C++ 退回的解析找不到”；“公开输入走不到”改成“有名字的项摘要就是名字，按名字找到的总相同；只有构造函数这类没有名字段的项会推（8E-2 F41、E2-12）”）；`:909` 的 `C(k)` 改词；`:979` 给联系的内存结论开例外；L14 `:734`（TS/JS 写时用单文件，Python/C++ 用常驻进程，不开捕获）；书记提醒：L16 `:224`、D-03 `:672`、§11.5 `:874–883`（`:880` 请求号的身份集合加断了的联系的编号；游标门同时比断了的联系）、§13 `:1021`；`:697` 的“`record_note` 三支 `op`”不变（第 2 稿要改成四支；第 3 稿核对是单独的只读工具，E2R1 裁定 18）。
- **K2 规格：** `:553`、`:761`、`:777–778` 的改前、改后：R 先落时，`DELIVERY_SET_TEMPLATE_IDS` 和 `S7B-delivery-samples.ts` 里已经有 `link-breaks-input`（第八个），K2-P2 的 `context-summary-request` 是第九个，“seven → eight”改成“eight → nine”。
- **书和开工裁定（偏差记录）：** 设计 §6.3 列的各处作废或改写；F2-04 作废，F2-02、F2-03 带进 R 的任务书。
- **能力索引：** WG52（`:294`，4A 写入解析符号）、WG53（`:295`，4B 读时符号重解析）、WG54（`:296`，“看”“找”旁加只读工具 `check_links`）、WG56（`:298`，书记提醒加断了的联系）、WG180–WG182（`:474–476`）随 G、R、H、S 落地改。
- **STATUS 和设计说明（只改措辞，签名摘要只盖名字那一段）：** STATUS `:479`（现在的主线）“符号定位按名字所在的行，签名摘要只看出改名”改成“符号定位按名字所在的行，签名摘要只盖名字那一段（改名读成 `symbol_missing`，改参数、改函数体读不出；只有构造函数这类没有名字段的会推 `symbol_signature_changed`）”。设计 `impl/s8e/design-two-tiers.md:249` 的“同一文件别处改了、函数还在、签名摘要没变，仍是 `live`、`fresh`”改成“同一文件别处改了、函数还在（签名摘要只盖名字那一段，改了参数也算还在），仍是 `live`、`fresh`”；`:341` 的“`symbol_signature_changed` 照名字范围比”那句留，“公开输入走不到”改成“只有构造函数这类没有名字段的项会推”。
- **源码 README：** 各组白名单里列的那些，施工组写，lead 审。
- **7D2、6C、第 9 片、B06 的修订记录：** 8E-2 的位置改成 A1a/A1b 之后（115-8）：7D2 `:16–18`、`:8412`、`:8808`；6C `:63`、`:335–336`（`CP`、`host.ts` 链里的“8E-2 F2”改成 8E-2 各组）、`:2444–2449`（“8E 不改 `host.ts`”已不成立：H 加心跳里一个调用，S 改书记提醒）；第 9 片 `:29`；B06 `:63`（不变，8E 仍在 B06 前）、`:72`（“8E 冻结 `host.ts` 为不改”已不成立）。S 若改在 O5b 之前落（§6 第 10 条），还要改 7D2 `:6565`。
- **7D2 冻结裁定的修订（E2R1 裁定 18，lead 冻结时记进 7D2 修订记录）：** 8E-2 H 先落，`LOCAL_READ_TOOL_NAMES` 多了只读的 `check_links`（H3）。① `:6457–6461`：参谋、审阅的工具集照写法展开 `LOCAL_READ_TOOL_NAMES`，代码不用改，集合里多了 `check_links`；`:6457` 的注释“The reviewer's is read-only and omits `record_note`”仍对，补半句“and includes the read-only `check_links`”。② `:6571–6576`：“the two lists above are the exact adviser/reviewer sets”的集合跟着多这一个；`LOCAL_READ_TOOL_NAMES` 的行号 `A/host.ts:353` 按 8E-2 落地后的树重指。③ `:7185–7190`：C1 探索轮“冻结的探索工具集正好是 `look_graph`/`find_graph`……”加 `check_links`（有看、找的线都有它）。④ 7D2 测试里逐个列出这几个集合、或按它们算绑定修订号的期望，跟着加 `check_links`。⑤ `:126`、`:133` 的 `R/query-execution.ts`、`R/tool-group-assembly.ts` 串行行：8E-2 H 排在 A1b 之后、C1（或 O2）之前，后落的 rebase。

## 8. 备忘（逐条改在哪几行）

### 8.1 第 3 稿（照 lead 裁定 E2R1）

下表的行号是第 3 稿的，对 `slice-8E2-SPEC.draft.v3.md` 看；第 4 稿的行号见 §8.2。行号是第 3 稿交稿时的（lead 11-03 晚在 `:251` 加了一行“头文件怎么到进程”，之后又按 Codex 第二轮补了三处，下表已按这两次重排）。裁定见 `impl/s8e/e2r1-rulings.md`，改法见 `impl/s8e/e2r1-screen.json` 每行的 fix。

| 裁定 | 改在哪（第 3 稿行号） |
|---|---|
| 1（a-01，C++ 编译参数） | W11 “C++” `:250`（翻译单元按“路径 + 这次的编译参数”留，身份用 `cpp-source-query.py:211` 的 `json.dumps(args)`；参数变了或头文件改了就丢掉重建，丢掉后读时退回 `exact: false` 并后台预热；`lookup` 每次带上这个文件当前的编译参数） |
| 2（a-02 = b-02，`lookup` 的注入链） | §2.0 `:159`（`NoteAnchorWorkspace` 加 `lookup?`）；R14 `:368–373`（包装加一行，CP 把唯一的 `NativeSingleFilePort` 接进 `noteWorkspace`，CP 行号按 3642）；§3.3 R 白名单说明 `:535`（“NA 只加 `verify?`、`lookup?` 和两行包装”） |
| 3（a-04，配置表的参数类型） | W3 `:237`（参数放宽成 `ReadonlyMap<string, { readonly content?: string }>`，不用空字符串） |
| 4（a-05，C++ 对拍口径） | W11 “对拍” `:253`；§3.2 第 9 项 `:458` |
| 5（a-06，删 `parentName`） | §2.0 `:207–208` |
| 6（b-01，记之前比摘要） | R7 “记的条件” `:320`；验收见下面 E2R2-c-01 |
| 7（b-03，拆出 `unsupported`） | §2.0 `NativeLookupV1` `:211`；W11 “一个执行器” `:248`；R3 `:286`（两种都读 `unchecked`）；G8 `:390`（`unsupported → unresolved`，`unavailable → rejected unavailable`，没命中 → `unresolved`） |
| 8（b-04，第一档已定的出队） | R8 `:326` |
| 9（b-06，只记头版本） | R9 `:328` |
| 10（c-01，按调用数计） | H1 `:395`（`Map<canonicalJson(ref), n>`，一个 helper，公共包装和 `rawRuntime` 都经过它，CP、ED 行号按 3642）；S1 `:415`（n 到 0 才记结束时刻） |
| 11（c-02，`noteCommandReceiptOf` 收窄） | 作废（第 18 条）。先照改过 H3 和 §3.1 G 行，随第 18 条删掉；最后留下的是 §3.1 `:438`（H 不改 `NS`） |
| 12（c-04，E2-19c 红不了） | E2-19c `:769`（加“心跳一次”，期望和改坏跟着改）；S1 `:415`（补半句“第一次看到最多比平台发现晚一个提醒周期”，`host.ts:262`（3642）） |
| 13（c-06，总链） | §3.4 `:602`（链去掉 K2，加“K2 的先后照 `slice-K2-SPEC.md:682–686`”） |
| 14（c-07，E2-24 的字面量） | E2-24 `:776` |
| 15（a-03 = b-05，不逐组交付） | R6 “时限” `:313`；§6 第 14 条 `:860` |
| 16（c-05，租约） | H2 `:396`（只加一句指向 §6）；§6 第 15 条 `:861` |
| 17（c-03，只读线的 `check`） | 作废（第 18 条）。先在 H3 加过那一句，随第 18 条删掉；经过记在 §6 第 16 条 `:862` |
| 18（补充，单独的只读核对工具） | 状态 `:3`；§0 `:26`、`:39`、`:47`、`:51`；F49（新）`:119`；§2.0 `:136`、`:141`、`:155–156`（`record_note` 不改）、`:222–228`（`link-check-tool.ts`）；R14 `:373`（改名）；H3 `:400–409`（整段改写）；H4 `:410`；H6 `:411`；§3.1 `:438–439`；§3.2 第 8 项 `:457`；§3.3 H 白名单 `:554–580`；§3.4 `:608`、`:610–613`、`:616`、`:618–619`、`:622`、`:624`；§4.1 `:639`（E7）、`:643`；E2-14a `:762`、E2-15 `:764`；§4.4 `:804`、`:816–823`；§6 第 6 条 `:849`、第 9 条 `:852`、第 16 条 `:862`；§7 `:869`（8E L11）、`:870`（第 4 片 `:697`）、`:873`（WG54）、`:876`（7D2 修订，新） |
| 头部 | 状态 `:3`；代码基线 `:4`（第 3 稿按 `D:/cxt/8e2-3642` 核，新写的、引到 A1a/A1b 改过的文件的行号标“（3642）”） |
| E2R2-c-01（Codex 第二轮，lead 裁定照补：R7 摘要比对没有验收） | 新行 E2-30 `:783`（核对途中把 K3 证据行的字面 key 改掉、引用留着，核回 `unchecked`/`unavailable`，之后读 `broken [0]`；改坏：删 R7 的摘要比较）；§3.5 `:631` |
| E2R2-c-02（同上：C++ 参数、头文件失效没有验收） | 新行 E2-31a `:784`（只改头文件；改坏：preamble 复用不看头文件摘要）、E2-31b `:785`（只改编译参数；改坏：翻译单元不看参数）；§4.2 新加 W 层的三个 `gate` 文件 `:708–718`（照 `tests/data/cpp-source-index.test.ts:19–29` 建）；§3.5 `:631` |
| E2R2-c-03（同上：没有覆盖 `noteAdmission: none` 的 Query） | E2-14 拆成 E2-14a `:762`（原来的 Work Run 部分，改坏不变）、E2-14b `:763`（第二次调用换成真实的普通 Query，照 `S6A-local-secretary.test.ts:150–209` 的公开流程；改坏：Query 的核对装配加注记准入条件）；§3.5 `:631` |

### 8.2 第 4 稿（照 `impl/s8e/measure-rulings.md`，开工先量之后）

行号是第 4 稿的。改法照 `impl/s8e/measure-wf.json` 那一条的 `spec_edits`，CRIT 改过的以 CRIT 为准。

| 裁定 | 改在哪（第 4 稿行号） |
|---|---|
| 1（SIG-1…3：签名摘要只盖名字那一段，只改措辞） | F5 `:90`；§0 `:32`；R3 `:322`；§7 第 4 片 R4 `:933`；§7 STATUS `:479` 和设计 `:249`、`:341` 一条 `:937` |
| 2（SIG-4 + CRIT-05：Syntactic 模式、共用一棵语法树） | §2.0 `:194–198`（`syntaxTreeOf`，两个函数改收树）；W10 `:272` |
| 3（SIG-5 + PERF-1 + CRIT-03：1 MiB、W12、第一档的数） | §2.0 `:155`、`:176`（`readWorkspaceFiles`）、`:225–228`（W12 的方法）；§0 `:25–29`、表 `:39`、`:41`、合计 `:46`；R4 `:328`；W12 `:293`；R14 `:407–413`；§3.2 第 3 项 `:492`；§3.3 W 白名单说明 `:525`、R 说明 `:581`；§4.1 故障 `:689`；§4.4 `:860`、`:867` |
| 4（ALIAS-1、-2、-4：类型别名的字段当不了端） | F50（新）`:135`；W5 `:267`；R5 第 4 条 `:337`；§3.2 `:500`；§5 `:898`；§7 8E `:929–932` |
| 5（CRIT-01：W6 搜整个程序） | W6 `:268`；§4.2 `:717–720`（`hub.ts`、`wire6.ts`）；E2-33（新）`:841`；§3.2 空闲重量 `:506`；§0 `:30`、表 `:39`；§6 第 4 条 `:905` |
| 6（W6-3：收窄 `undecided`） | W6 `:268`；E2-23c `:827`；E2-23d（新）`:828`；§4.2 `:714`；§6 第 13 条 `:914` |
| 7（CRIT-02：8E 的同一句合成一处） | §7 8E `:929`（清单）、`:930–932`（`:353`、`:404`、`:420` 的文字） |
| 8（PERF-3、-4、-5、-7、-8、-9） | §0 `:30`、`:53`、`:55`；§7 HANDOFF `:926`；W1 `:259`；W2 `:260`；W3 `:263`、`:264`；W7 `:269`；§5 `:889`；§2.0 `:156–157`；H4 `:450` |
| 9（PERF-6 + CRIT-10：库文件半句） | W3 `:262` |
| 10（PERF-10 + CRIT-08、-09：结果冻结在哪、空闲重量） | §3.2 `:504`、`:506`；§3.1 W 行 `:475`；§0 `:55` |
| 11（PYCPP-1、-2、-5、-6、-7） | W11 对拍 `:291`；§3.2 第 9 项 `:498`；W11 退回 `:287`、写 `:288`；§0 `:49`。PYCPP-1 给 W11 Python 加的那句没加（裁定：删），PYCPP-2 不改 |
| 12（PYCPP-4 + CRIT-07：读时等待上限 200 毫秒） | §2.0 `:159`；R3 等待上限 `:325` |
| 13（CRIT-06：有错误诊断就 `exact: false`） | §2.0 `:234–237`；W11 第 5 条 `:283`；§0 `:49`；§3.2 第 9 项 `:498`；E2-29c（新）`:836`；G8 `:430` |
| 14（CRIT-12：测试预算） | §3.5 `:678` |
| 15（写模式也复用） | W11 写 `:288` |
| 用户 11-04，§0.1 第 3 条选 A | §0.1 `:71–74`；§0 `:25`；§3.2 空闲重量 `:506`；§7 HANDOFF `:926` |
| 用户 11-04，§0.1 第 4 条选乙（决定 117） | §0.1 `:76–80`；W11 C++ `:276–288`（系统头文件六条 `:278–284`）；§2.0 `:234–237`；G8 `:430`；E2-29c `:836`、E2-29d（新）`:837`；§4.2 `:751–759`；§0 表 `:39`、`:46`、`:49`；§3.2 第 9 项 `:498`、空闲重量 `:506`；§3.5 `:678`；§7 HANDOFF、DECISIONS `:926–927` |
| §6 一行（第一档最坏情形的提速在研究） | `:922` |
| 头部 | 状态 `:3`；代码基线 `:4`（第 4 稿按 `D:/cxt/8e2-3642` 核；O1a、E3-5 的情况） |
| 回报后 1（O1a 改过的文件按 `D:/cxt/main-83e72aa2` 重查） | 代码基线 `:4`；F8 `:93`（`CP:541`）；F48 `:133`（`CP:537`）；§2.0 `:170`（`CP:536–542`）；FR7 `:305`（允许清单 `:1452`）；R7 `:357`（`CP:2747`）；§3.3 R 说明 `:581`（`record-store/README.md:51`，`src/contracts/README.md:207–208`、`:233`；`model`、`views` 的 README 行不变）；§3.4 表 `:653`（`CP:2714–2749`）。标“（3642）”的 `CP` 行和 `tests/README.md:165` 两棵树相同 |
| 回报后 2（`NOTE_NATIVE_READ_WAIT_MS` 改 300） | §2.0 `:159`；R3 等待上限 `:325`（先发 `lookup`，和 TS 的读、解析重叠）；R4 `:328`（有 Python/C++ 定位时分两次读）；E2-29d `:837`（写时建好 preamble，读不贴着上限） |
| 回报后 3（探测改成 C++ 的 `#include <cstddef>`） | §0.1 `:79`；W11 第 4 条 `:282`；E2-29d 跳过条件 `:837`（测试自己先试，不调生产的探测） |
| 回报后 4（精确模式去掉 `-nostdinc -nostdinc++`，只给默认搜索列表里的目录加 `directory-remap`） | W11 参数 `:277`；第 1 条 `:279`（列表用 `-v` 读或取探测包含到的文件所在目录，W 选一种，施工回复写出本机的列表）；E2-29d 改坏 `:837` |
| 回报后 5（PYCPP-3c） | §4.2 “碰一下” `:773` |
| 回报后 6（§6 第 12 条） | §6 第 12 条 `:913`；W11 退回 `:287`（预热用精确解析的参数） |
| 回报后 7（8E `:420` 的文字和它带的行号） | §7 `:929`（`:353` 在 L1，不在 L3a）、`:932`（`:420` 原文不动，之后加；`:76`、`:1183`、`:966` 是 8E 例子表里的代码位置，写明 `modelRequests` 和 `model-call-access.ts:18–19`）；8E `:353`、`:404`、`:416–420` 在 `D:/cxt/main-83e72aa2` 上核过，和 `8e2-3642`、`nw-75fe12a` 同行 |
| 回报后，为最后的快速核对 | E2-29c `:836`、E2-29d `:837` 的改坏写上规则名（W11 第 5 条、第 1 条）；E2-23d、E2-33 已有入口、步骤、期望和一个点名的改坏，不改；§3.3 W 白名单 `:518` 把 `workspace-tools.ts`、`capture.ts` 并进块里（`:525` 说明跟着改） |
| E2R3-01（Codex 快速核对，lead 照收：系统头文件逐个文件映射） | W11 第 1 条 `:279`（只收真实路径仍在列表目录里的文件，不用 `directory-remap`）；W11 参数 `:277`；§0.1 `:78`；E2-29d 改坏 `:837`；`measure-rulings.md` 用户答第 1 条 `:32`、回报后第 4 条 `:44` 同步改。上面“回报后 4”那一行的 `directory-remap` 由这一行取代 |
| E2R3-02（同上：E2-31a 红不了） | E2-31a 改坏 `:839`（缓存命中后继续向重解析提供上次的头文件内容）；步骤、期望不变 |
| E2R3-03（同上：必填成员后补赋值编译不过） | R14 `:407–412`（`readWorkspaceFiles` 写进 `checked` 的初始化对象，删后补的那一行）；§2.0 `:176`；§3.3 R 说明 `:581` |
| 第一档提速（`measure-rulings.md` 末节，6 条；综合 `speed-study-judge.md` §3）：行号说明 | 这一轮在正文加了 27 行，这一行起的行号是加行以后的。上面各行引的是加行以前的行号：`:194` 及以前不变；`:195–228` 加 1；`:229–293` 加 6；`:294–362` 加 15；`:363–520` 加 16；`:521–523` 加 19；`:524–669` 加 21；`:670–678` 加 22；`:679–841` 加 23；`:842–898` 加 26；`:899` 起加 27 |
| 提速 1（丙：`readMany` + 共用一棵树 + 按摘要记解析结果；不做 stat 缓存、`fs.watch`、降预算） | W12 `:299–308`；W10 `:278`；§2.0 `:187`、`:194–195`（`SyntaxTreeV1` 改成语言服务自己的树，加 `navigationItems()`）、`:229`、`:231–234`（W12 的注释和 Kernel `readMany` 的签名）；R4 `:343`（命中不算解析、不占 20 个文件和字节预算、仍算进 256 个读）；R7 `:377`（第二个例外，8 MiB 源码字节的 LRU，模块内常量）、`:378`；R3 `:340`（最坏改成约 300 毫秒由等待上限定）；§5 `:925`（没收的几样） |
| 提速 2（两种读法按 `fs.statfs` 自动选，用户 11-04） | W12 `:302–305`（本地盘名单 ext2/3/4、xfs、btrfs、tmpfs 用同步版，其余和 `statfs` 失败的用异步版；`via` 只给测试；批末复核两种都做）、`:306`（src 一侧：`readMany?` 照 `listObservationFiles?` 写成可选，手写的访问对象照样过类型检查）；§2.0 `:231–234`；§7 HANDOFF `:953`（记用户原话） |
| 提速 3（W3 也用 `readMany`） | W3 `:270`；§0 `:53` |
| 提速 4（测试行） | E2-34（W，`read` 对 `readMany`，43 个用例两种读法各一遍；改坏：同步版少判“是不是普通文件”）`:865`；E2-35（R，命中和不命中读出一样；改坏：键不带摘要）`:866`；E2-36（R，命中不占预算；改坏：命中也扣字节）`:867`；§4.1 `:711`（Kernel 公开入口 `WorkspaceSandbox`）；E2-01、E2-02、E2-03 不变 |
| 提速 5（估数和文字） | §0 `:25–28`、表 `:39`（W 875–1,320）、`:41`（R +595–825）、合计 `:46`（+2,190–3,205、−313）；§0.1 第 3 条 `:71`（只改数，A 不变，留下问用户时的数）；§3.5 `:701`；§3.3 W 白名单 `:534–544`（加补丁源、4 个 dist 产物、补丁 README、`access.ts`、`workspace-read.ts`、`tests/kernel/S8E2-W-read-many.test.ts`、`tests/README.md`）和说明 `:546`；§3.1 W 行 `:491`；§3.4 `:691`（补丁 README 和 K2-K 的先后）；§7 HANDOFF `:953`（115-2 `:2083` 那句加说明）；`measure-rulings.md:8`（第 3 条的 400–470 改成指向末节第 5 条） |
| 提速 6（空闲重量加一次整体实测） | §3.2 `:522`（读和解析同一次调用，本地盘和 `/mnt` 各一次）；结果冻结在哪 `:520` |
