**结论：数量主要暴露了测试造态方式的问题，也暴露了一小块 Kernel 事实读取接口的重复；不足以说明 K3 整体放错了层。建议采用“B 的最小版本＋C”：修好共享的真实造态路径，冻结发现表后收尾，本次不追加 Kernel 补丁。**

最关键的事实是：**Kernel 已经在执行工具前提交 `tool.started`，执行后提交结果。** 当前缺的主要不是这套日志，而是方便平台和测试使用的统一事实读口，以及可信、可复用的中断夹具。开始记录提交后、实际副作用发生前可以崩溃；副作用发生后、结果记录提交前也可以崩溃。再加一套日志仍然不能判断这两种情况下“事情到底做了没有”。执行顺序见 `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:938`、`:941`、`:946`；结果记录见 `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:742`。

本次全程只读，未修改文件、未运行测试或构建。下面把核实的数字、下界和设计估算分开。

**1．“约 600 个实例”究竟是什么**

首先应改正分母：

| 材料 | 数量 | 实际计数单位 |
|---|---:|---|
| G1–G7 | **652** | 跨规则、跨报告的命中次数 |
| H | **34** | 直接包含禁止路径或开放禁止输入的函数出口 |
| P | **14 必改、11 建议** | 独立生产修复项 |

G1–G7 分别为 83、81、111、71、105、100、101。汇总出处：`.lead-ref/reports/k3-audit-G1.out.md:391`、`k3-audit-G2.out.md:355`、`k3-audit-G3.out.md:358`、`k3-audit-G4.out.md:368`、`k3-audit-G5.out.md:456`、`k3-audit-G6.out.md:509`、`k3-audit-G7.out.md:505`。H 自己说明了函数出口口径，不能与调用方相加；P 则按独立修复项计数。见 `.lead-ref/reports/k3-audit-H.out.md:3`、`.lead-ref/reports/k3-audit-P.out.md:1`。

652 次里：

- **394 次是 F1–F6**：手造事实、覆盖读结果、代 Runtime/Host 写事实、替身端口、重复触发或编造失败。
- **51 次是 F7**：通过底层存储作断言。
- **207 次是 F8–F12**：期望值来源、时序、计数层次、无效拒绝测试和断言削弱。

因此，**即使所有 Kernel 前置状态都容易生成，也不会自动解决后两类。**

v2 又明确撤掉了三类误报，并改变范围口径：

- 真实调用者提交的路由／owner 请求体可以手建。
- 正常的 Host 根目录、授权、运行配置、时钟和 ID 可以由测试提供。
- 等待公开状态满足条件的有界轮询可以使用。
- 旧文件只算本片改动行，其余进 T 清单。

这些不是额外解释，直接写在 `.lead-ref/test-rule-sheet-v2b.md:6`、`:12`、`:31`、`:67` 和 F9 条款中。

**这里存在一个不能隐去的计数限制：这份副本没有普通测试的完整 diff，也没有 `.git`。所以不能精确给出全部 116 个测试文件经过 v2 的最终净数。** 现有 `b3-helpers.diff` 和 `b3-src.diff` 足以核定帮助函数与生产改行，但不能代替普通测试的范围证据。

我能给出的确定结果是：

> **仅在 B3 实际改动的帮助函数中，按 v2 仍确认了 18 个造态／伪结果源点，分布在 16 个函数里。**  
> 这是下界，不是“v2 全部只剩 18 项”。

按想达到的状态分类如下。“内容层位置”已按 v2 的输入规则重判，但普通测试中的旧行范围尚不能全部扣除；“B3 改行源点”则已经核对 helper diff。

| 想达到的状态 | 内容层可确认的唯一位置下界 | 已确认 B3 改行源点 | 承载这些新改源点的函数 | 真实使用中的生产者 |
|---|---:|---:|---:|---|
| Kernel Turn 开着，工具开始但没结果 | 2 个替身实现，实例化为 shell/read/mailbox 三种工具 | **1** | **1** | Kernel 执行循环；模型只发调用请求 |
| Kernel facts missing／unreadable | 5 个显式构造或传入 probe 的位置 | **1** | **1** | 存储故障及真实 Kernel 读取器 |
| Run 的 entered／执行绑定／调用被拦等状态 | 6 个位置 | **2** | **2** | Runtime、Run owner；Kernel 提供执行事实 |
| review 到达 `review_unavailable` 等阶段 | 16 个写入或调用位置 | **4** | **4 个配方函数，落到 2 个底层写入函数** | Host 能力事实、Workflow 判断、Review owner |
| card／disposition／proposal／请求所需的事实 | 12 个位置 | **3** | **3** | 模型通过工具、人通过决定入口、平台 owner |
| recognition 的输入事实和匹配结果 | 17 个位置：13 个 workspace 替身、3 个匹配替身、1 个 Kernel facts map | **7** | **5**，其中一个函数包含三个替身 | 生产识别器、Workspace reader、Kernel reader |
| **合计：已核定 B3 helper 子集** | 不作为全量总数相加 | **18** | **16** | — |

这 18 个源点可以逐个复算：

| 类别 | 源点 |
|---|---|
| 工具替身 | `tests/helpers/K3-tool-seams.ts:146`；read、mailbox 共用这一实现，分别在 `:168`、`:161` 实例化 |
| 成品 probe | `tests/helpers/K3-35-continuation-fixture.ts:691` |
| Run／执行绑定 | `tests/helpers/B2-blocked-runtime.ts:95`、`:413` |
| review 阶段 | `tests/helpers/B2-crr-world.ts:193`；`tests/helpers/K3-blocked-command-fixture.ts:367`；`tests/helpers/K3-review-card-fixture.ts:389`；`tests/helpers/K3-proposal-round.ts:874` |
| 工具代行、请求身份、展示事实 | `tests/helpers/B2-blocked-runtime.ts:424`；`tests/helpers/B2-crr-world.ts:239`；`tests/helpers/K3-proposal-round.ts:571` |
| 五个 workspace 替身 | `tests/helpers/B2-401-world.ts:219`；`tests/helpers/B2-blocked-runtime.ts:260`；`tests/helpers/K3-blocked-command-fixture.ts:406`；`tests/helpers/K3-crr-fixture.ts:121`；`tests/helpers/K3-review-card-fixture.ts:162` |
| 匹配结果、Kernel 命令事实 | `tests/helpers/K3-review-card-fixture.ts:200`、`:139` |

有两个很能说明“为什么数字膨胀”的例子：

- review 阶段这条链在 G1–G7 产生 **24 次 F6 命中**，去重后是 **16 个位置**，最终落到 `settleK3Review` 和 `settleUnavailable` 两处写入。见 `tests/helpers/K3-proposal-round.ts:594`、`tests/helpers/B2-crr-world.ts:193`。
- `reconcileUnknown`、`reconcileUnknownTwice`、`createRecord`、`replayRecord` 开放的 probe 替换能力，最终共用 `hostReconcile` 的一处替换。不是四套独立的 Kernel 造态机制。见 `tests/helpers/K3-35-continuation-fixture.ts:691`、`:700`、`:711`、`:766`、`:771`。

所以，更接近实际工作量的描述是：**少量共享源头，沿许多测试传播；外加独立的断言质量问题和生产问题。**

**2．今天通过真实路径达到这些状态，成本在哪里**

下面按“独立事实责任域”计 owner 数：Run、Runtime、Kernel、Workspace、Review、Decision/Message、CRR。它不是函数数，也不是五模块数；不含最初 Project、Goal、Plan、Session 等通用初始化。

| 状态 | 公开步骤 | 主链 owner 数下限 | 是否需要 crash／Host restart／bubblewrap |
|---|---|---:|---|
| Run entered，Turn open | claim → prepare → start → scripted model → 真实工具入口闸门 | **3** | 不必 crash 或重启；真实 shell 执行需要 bwrap |
| started、缺 result | 上述链，在真实 handler 入口或真实结果返回前持住 | **3** | 观察未完成状态不必 crash；验证 Host 死亡必须真杀进程 |
| Kernel unreadable | 真实 Run 后，使真实存储读取失败或暂时移走数据库，再调用真实 probe | **3** | missing 不必重启；恢复场景按用例重启 |
| Run outcome_unknown | 公开 execution read → 真实 probe → reconcile | **3–4** | RUN-20 的 owner 场景不必真 crash；接管证明必须由 Host 生命周期产生 |
| 认定并建立 review | resolveUnknownRun → 读 Kernel → owner 回执 → workspace capture → RUN-22 提交 | **5** | 认定本身不要求 crash；需要真实原始事实 |
| review 结论、needs_decision | 领取 review Run → prepare/start → 模型调结论工具 → 正常结束 → Workflow settle | **5** | 正常流程不必重启；实际只读命令需要相应沙箱能力 |
| disposition／proposal／approval | 队列 → 人答卡 → 提方案 Run → 模型调方案工具 → settle → 批准 | **6** | 普通步骤不必 crash；恢复切点才需要 |
| blocked command／CRR／allowance | 处置写阻止记录 → 接续 Run → 真实 hook → 请求重跑工具 → 人答卡 → 消耗允许 | **7** | 被挡住的命令不执行；放行后的真实 shell 需要 bwrap |

共享链已经存在：

- claim、prepare、start：`tests/helpers/K3-35-continuation-fixture.ts:523`、`:555`、`:576`。
- 真实读取、probe、reconcile：同文件 `:687`、`:691`、`:694`。
- 人工认定入口：同文件 `:750`。生产入口自己读取 execution 和 review draft，再交 Run owner；测试不需要拼 draft。见 `src/composition/create-platform.ts:2042`、`:2055`、`:2070`、`:2074`。
- review／proposal 的选择、领取、prepare、start、settle：`src/business/workflow/workflow.ts:1470`、`:1515`、`:2413`、`:2422`、`:2546`。
- 结论和方案工具：`src/core/agent-runtime/unknown-call-review-tools.ts:180`、`:267`。
- 决策三步及允许消耗：`src/business/workflow/decision-actions.ts:538`、`:546`、`:481`；`src/core/agent-runtime/execution-driver.ts:500`。

**耗时不能从超时值推出来。** 找到的唯一明确 setup 测量是源码中的历史注释：完整 SQLite K3-35 world 独跑及与同组并跑时约 **1.0–1.6 秒**。见 `tests/runtime/K3-35-approved-methods-brief.test.ts:80`。其 `60_000` 是 hook 超时上限，不是耗时；返工记录还记载过并行全量中 setup 超过默认 10 秒的情况。见同文件 `:83`、`.lead-ref/k3-g4b3-rework-6.md:71`。

因此，对上表各状态可以作这样的规划判断：

- 进程内 Run／Kernel 状态：按**秒级 setup**预算，复用 world 后增量步骤更少。
- unreadable：在已有 world 上增加一次真实故障和读取，不应依赖固定 sleep。
- review／proposal／approval：在基础 setup 上增加一至数轮脚本模型执行，仍应按秒级预算。
- 真正 child Host kill／restart／bwrap：**目前没有可引用的实测时间**，不能拿旧替身夹具的 1.6 秒代替。

这确实比直接塞一份 record 贵。贵的主要原因是跨 **3–7 个责任域**，不是模型网络调用；scripted provider 不需要真实模型服务。其输入流实现见 `tests/helpers/B2-runtime-fixture.ts:69`、`:78`、`:89`。

**3．K3 的平台—Kernel 边界，哪里合理，哪里重复**

平台没有另写一套 Kernel reducer。它调用公开的 `createInitialRunState`、`reduceRunState`，按固定 Run／Turn 重放。见 `src/core/agent-runtime/kernel-turn-facts.ts:11`、`:53`、`:62`。

但平台确实重复整理了 Kernel 已记录的事实：

| 当前代码段 | 物理行数，含注释与空行 | 工作 |
|---|---:|---|
| `src/core/agent-runtime/kernel-turn-facts.ts:39` 至 92 | **54** | 找 Turn 起点、重放、提取未决调用 |
| `src/core/agent-runtime/run-reconcile.ts:482` 至 512 | **31** | 合并调用声明、开始位置和开始时间 |
| `src/core/agent-runtime/continuation-brief-assembly.ts:606` 至 614 | **9** | 再从 transcript 取调用参数 |
| 同文件 `:667` 至 739 | **73** | 合并 batch／结果，再生成平台摘要 |
| `src/core/agent-runtime/context-assembler.ts:1165` 至 1233 | **69** | 读取原调用声明，转成 command／cwd |
| **合计** | **236** | **相关代码段，不是可全部删除的行数** |

另有窗口读取和定位：`run-reconcile.ts:106` 至 145 为 **40 行**；`continuation-brief-assembly.ts:414` 至 598 为 **185 行**。这些混着平台 locator、认定、同 Session 接续、预算和失败策略，不能整体算成应下沉的代码。

最明显的重复拼装在 `run-reconcile.ts:482`：它先从 transcript 建调用表，再扫事件找声明和开始位置；找不到时使用空名称、空参数和 fallback position。见 `src/core/agent-runtime/run-reconcile.ts:486`、`:493`、`:508`。这些不是伪造成功，但说明平台承担了 Kernel 记录格式的解释工作。

可以集中到 Kernel 的，是：

- 调用是否只是声明、是否开始。
- 原始调用和实际执行调用。
- 开始、结果的记录位置与时间。
- Turn 状态、调用状态、已记录结果。
- 固定 Turn 内的身份隔离。

应留在平台的，是：

- 按工具种类决定如何核对。
- 用平台事务回执判断平台工具有没有提交。
- 工作区基准、git 变动和证据采集。
- Review 轮次、卡、人的决定、提方案和批准。
- 同任务再次中断时的保守规则。
- 原命令识别、CRR、一次允许及其消耗。

当前草稿读取器正是在 Kernel 事实之上增加这些业务判断：工具分类在 `src/core/agent-runtime/unknown-call-draft.ts:104`，平台回执判断在 `:112`，工作区采集和 review 条目生成在 `:174`。Kernel 日志无法代替平台 owner 的事务回执。

B3 的规模也不主要来自这 236 行。仅新增的 CRR owner、codec、card、请求工具、命令展开和识别六个文件就有 **2,506 行**，约占 B3 新增生产行的一半；它们不会因增加 Kernel 日志而消失。分别见：

- `src/core/work-graph/tasks/command-rerun-request-service.ts:1`：1,202 行；
- `command-rerun-request-codecs.ts:1`：425 行；
- `command-rerun-request-card.ts:1`：263 行；
- `src/core/agent-runtime/command-rerun-tools.ts:1`：229 行；
- `src/core/work-graph/tasks/command-expansion.ts:1`：229 行；
- `src/core/work-graph/tasks/command-recognition.ts:1`：158 行。

这些新增规模列于 `.lead-ref/b3-stat.txt:13`、`:34` 至 38。它们对应的是已经定下的重跑申请、静态识别和人工授权行为，不是重复实现 Kernel 执行循环。

**4．方案 A：做 Kernel 补丁**

我认为有价值的最小补丁是**只读的 Turn／调用事实投影**，不是再加开始／结果日志，也不是把 K3 流程移进去。

返回内容至少需要：

```text
原始 requestedCall
声明位置
started：实际 effectiveCall、位置、时间，或者 null
result：真实结果及位置，或者 null
调用状态
Turn 状态
```

不能只做“声明的 call 减去已有 result”：

- 声明先成为 `pending`；开始后才成为 `running`。
- Turn 结束时，未开始的变 `abandoned`，运行中的才变 `outcome_unknown`。
- hook 拒绝可以有失败结果而没有 `tool.started`。

分别见 `vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts:142`、`:169`、`:70`；`vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:881`。

最小落点可以使用已有受管源：

| 文件 | 拟改内容 |
|---|---|
| `vendor/coding-agent/patches/core/ports/session_store/session-history.ts` | 增加通用纯投影，复用已有重放能力 |
| `vendor/coding-agent/patches/public-api.ts` | 导出函数和类型 |

这两个位置已有重放／投影相关依赖和导出，见前者 `:8`、后者 `:219`。

**规模估算：**

- Kernel 增加约 **120–220 行**。
- 平台净减少约 **100–160 行**。
- 暂不算测试和文档，仓库总生产行数可能是 **减少约 40 行到增加约 120 行**。
- 不会删除 Review、CRR、Workflow 或卡片的整个业务文件。

这是设计估算，不是实施后的净删结果。236 行相关代码中仍须保留平台映射、失败处理、摘要和显示限制。

它能让哪些测试更容易：

- 调用声明／开始／结果／Turn 状态的组合，可以通过一个公开纯投影测，符合 A5。
- 平台读取同一类 Kernel 事实时不必分别拼格式。
- **需要真实 store、Run、review、卡或授权的场景仍需真实造态。** 新读口本身不能把一个 Run 变成 started，也不能生成合法的人类处置。

成本和风险：

- 当前脚本管理 **15 份源、60 项生成物**；只改上述两份源，最多涉及八份生成物。必须通过受管构建再生，不能手改 dist。见 `scripts/build-kernel-patch.mjs:13`、`:29`、`:100`。
- 公开导出检查须同步：`tests/kernel/B2-history-public-export.test.ts:243`。
- 需要 lead 记录对已冻结技术接缝的变更。产品规则可以不变，但第 1–4 组相关契约仍须重核，范围见 `slice-K3-SPEC.md:1565`。
- 第 2 组的清单／认定、第 3 组核对输入、第 4 组卡与接续受直接影响；共享 reader 的普通 observer 也受影响。见 `src/core/agent-runtime/execution-observation.ts:580`。
- 主要风险是把未开始误当未决、混淆原始与实际调用、漏掉 batch 中已完成的结果、改变历史窗口边界。
- 不能顺带承诺提速：当前 Kernel `readTurnBounds` 本身先读整个 Session 再重放。见 `vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts:771`、`:776`。

**A 能改善边界，但不是当前数百次测试命中的主要解法。**

**5．方案 B：真实 Kernel 状态测试夹具**

现成材料已经够用，不需要先改 Kernel：

| 已有材料 | 能复用什么 | 限制 |
|---|---|---|
| `tests/helpers/B2-runtime-fixture.ts:69` | scripted model，真实 provider 流和回复闸门 | 不应直接造 Kernel record |
| `tests/helpers/K3-35-continuation-fixture.ts:523` | 真实 claim／prepare／start／认定链 | 部分依赖仍是假结果 |
| `tests/helpers/A2-restart-fixture.ts:203` | 移走真实 SQLite 及附属文件 | 证明 missing，不代表所有 damaged／unreadable |
| `tests/scenarios/support/git-workspace.ts:92` | 真实 git 基准和工作区 | RUN-25 应复用这类真实采集 |
| `tests/scenarios/harness.ts:128` | 真实 commit 委托、观察、定点失败 | 需保持真实结果不变 |
| `tests/helpers/B2-09b-crash.ts:37` | 同一 SQLite 上的公开 CRR 读取 | **它不是 crash 执行器** |

目前两个关键缺口：

第一，工具 gate 夹杂了工具替身。shell 替身去掉 capabilities，解闸后返回手写成功；read／mailbox 也是手写成功。见 `tests/helpers/K3-tool-seams.ts:85`、`:93`、`:146`。应改成包装真实 definition／handler，保留 capabilities，在入口或真实返回之前持住，然后原样返回真实结果。

第二，现有 `restart({crash:true})` 没有杀 Host 进程。它丢弃同进程对象、写一个陈旧锁；代码还明确旧 Host 之后可能继续追加 Kernel 记录。见 `tests/scenarios/harness.ts:1043`、`:1047`、`:1068`。这可以用于受控的中间状态模拟，不能证明旧工具已死或 bwrap 随父进程退出。

最小补足内容是：

- 一个共用 platform world，接真实 mailbox、workspace、识别器和 Kernel reader。
- 一个真实工具 gate。
- 仅供必须验证死亡／接管的用例使用的 child Host 控制器：等 IPC 确认切点，杀进程，等退出，用原配置和原数据库重启。
- 将已有场景需要的切点命名：开始后、作用完成但结果未记、轮结束但未 settle、答复后落实前、落实后补记前、允许已消耗但工具未执行。

工具入口 gate 到达时，`tool.started` 已提交；真实 handler 返回后的 gate，则能留下“已有副作用、结果未记录”的状态。已有顺序支持这两个切点。注意 `before_tool` 在 started 之前，不能把它当成“开始后”。见 `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:620`、`:638`、`:644`、`:742`。

**它能解决多少？**

以已核定的 **18 个 B3 helper 源点**为分母：

- 真工具 gate＋真实存储故障，直接替换 **2 个源点**。
- 再接真实 prepare／start／hook 和 Kernel command reader，可替换另外 **3 个**，共 **5/18**。
- 剩余 **13/18**：四个 review 阶段配方、三个工具／请求／展示事实源点、五个 workspace 替身、一个匹配结果替身，需要真实平台步骤和读口。**它们不是 Kernel crash harness 单独能解决的。**

这些修复会惠及传播出去的调用方，但不能据此宣称“解决 652 项”。例如 review 阶段的 16 个内容层位置，仍要通过真实能力失败和 Workflow settle，不能只把前面换成一次真 crash。生产判断和执行见 `src/business/workflow/workflow.ts:1477`、`:2542`。

如果把上述能力完整做成共享夹具，初步预算是 **3–5 个 helper／worker 文件、约 500–1,000 行新增或替换代码**，调用方迁移另算。这是工程估算。应以替换现有假路径为目标，不能在已有约 5,400 行 helper 上再叠一套并行体系；现有规模见 `.lead-ref/k3-g4b3-rework8-final.md:17`。

**6．方案 C：保留设计，按冻结发现表收尾**

C 是合理的，前提是“保留设计”不等于接受当前测试造法，也不等于仅重写审计标签。

冻结表应以**一个根问题一行、挂全部相关调用方**组织，至少写清：

| 字段 | 必须明确的内容 |
|---|---|
| 范围 | B3 改行、调用方继承问题，还是 T 旧债 |
| 目标状态 | 测试究竟需要哪一个真实前置状态 |
| 修复入口 | 采用哪个共享真实配方，或哪个真实依赖故障 |
| 不可达组合 | 移到哪一个无 store 的纯测试 |
| 拒绝输入 | 唯一错误是什么，公开读取如何证明没有改变 |
| 断言变动 | 哪些删除、移动、期望调整已获表内授权 |
| 完成证据 | 对应哪些既有用例；不把一个根修复重复算几十次 |

普通测试缺失的 diff 是最终范围冻结所需的材料。不能把未知范围先全部列为必须改，也不能把它全部归旧债。相关约束就是 v2 的 scope 和冻结条款，见 `.lead-ref/test-rule-sheet-v2b.md:12`、`:24`。

生产方面，P 的 14 项仍应由 lead 逐项裁定。至少以下两条与“测试是不是用了假前置”无关，我核对当前代码后认为确实需要处理：

- **整体识别失败时仍放行命令。** recognizer 抛错或返回非 ready 都返回 `CONTINUE_TOOL`；这与“明确没有匹配”混在一起。见 `src/core/agent-runtime/execution-driver.ts:533`、`:536`、`:537`。
- **CRR 答复已保存、②尚未提交时，恢复枚举跳过它。** `receiptExists` 返回 null 后直接 continue。见 `src/core/work-graph/tasks/unknown-call-review-answers.ts:201`、`:206`、`:207`。本批任务书要求两类已答未落实卡共用推进和启动接力，见 `.lead-ref/k3-g4b3-impl.md:131`。

Kernel facts 补丁不会修复这两条。

**7．建议、剩余轮次和合入含义**

| 选择 | 代码收益／代价 | 对本次收尾的影响 |
|---|---|---|
| A：现在加通用 Kernel facts 补丁 | 平台约 −100～−160 行；Kernel约 +120～+220 行；另有测试、导出和文档 | 新增冻结接缝审查、产物再生及跨组重验；仍须修测试造态 |
| B：加强共享真实夹具 | 约 500～1,000 行新增或替换测试基础设施，迁移另算 | 直接针对重复造态源头；不需要改变 K3 产品规则 |
| C：冻结表逐项修 | 不增加新 Kernel 接口 | 若仍逐测试各写一套前置，容易继续反复返工 |
| **建议：最小 B＋C** | 复用现有世界和配方，集中替换假源头 | 最少重开规格，最容易按根问题验收 |

我会把后续工作安排成**两个有界返工包**，这是计划，不是“两轮必过”的保证：

1. **共享根包**：先完成 v2 范围表；修真实工具 gate、probe 故障路径、真实读口及必要的进程 crash 控制。用冻结表中已有代表用例确认。
2. **调用方与生产包**：迁移受影响调用方；纯组合移纯测；修 lead 确认的 P 项；随后集中复核和既定合入检查。

不建议先做 A 再做 B：A 对 Kernel 事实解释有帮助，但预计只减少约 **100–160 行平台代码**，无法消掉上述 **13 个平台配方源点**，也无法解决断言和恢复授权问题。它会在当前收尾上增加一个独立验收面。

**K3 的合入结论是：保留现有业务设计，不以 Kernel 重构作为前置；r8 仍不能据此宣布可合入。** 需要完成 v2 范围冻结、修复确认的问题，并按仓库既定流程验收。现有返工回复报告的是 **6,884 通过、158 失败、29 跳过，并自行归为无新增失败**，不是全量全绿；本次没有重跑或验证这种归因。见 `.lead-ref/k3-g4b3-rework8-final.md:19`。