# 本地 dsh 的分批实施与验收

> **2026-10-07 现行入口：** 本地入口见下文 §1，实测上限与任务书写法见 §6（[分级测试证据](reviews/evidence/dsh-ladder-2026-10-07/README.md)，HANDOFF 决定 32）。下面两段是 2026-09 的历史说法：两阶段的意思仍然有效，其中的 `coding-platform/next`、Astra、“DSH 4.1F”、原 `coding-platform/src` 等名称和路径已过时。

> **2026-09-25 当前执行方式：** 在已建立的 `coding-platform/next` 内采用 Astra 架构与接口 → DSH 4.1F 骨架与测试 → Astra 审核并冻结 → DSH 4.1F 实现 → Astra 审阅 → 物理隔离测试。中间审核是独立阶段，不得在同一次不间断调用中先写测试再直接实现。原 `coding-platform/src` 只读参考。最新 [A1 验收](reviews/next-a1-graph-session-2026-09-25.md)为 75 文件 / 719 项，已增加正式目录、Module/Task 关联、定向发现和显式生命周期；前序图历史、Source、Session/Claim、Role 等原语继续复用。先读[完整路径计划](IMPLEMENTATION-PLAN.md)与[能力索引](IMPLEMENTED-CAPABILITIES.md)，不要以局部实现范围代替双图、装配、咨询、编排与控制的产品目标。运行入口 [next/package.json](../../package.json)；环境和精确写范围见 [DSH-EXECUTION-HARNESS](DSH-EXECUTION-HARNESS.md)。

**原工程实施历史（2026-09-23–24，不是 next 的验收）：** 用户已授权主 Agent 负责架构、骨架和测试，dsh 按真实依赖分批并行实现代码。已经实际调用并完成 R2a、R2b、R2c、R2d.1 独立验收，R2d.2 也已独立验收，R2d.3也已沿同一会话完成并独立验收；R2e.1已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)。用户提交的 R3a / R4a 首轮实现曾未通过[9 月 23 日验收](reviews/R3a-R4a-independent-acceptance.md)；9 月 24 日已完成 Sol 骨架 / 测试与 dsh 受限返修并验收通过。R3b正文与规则已按两个受限Session并行实现，真实接线通过[功能验收](reviews/R3b-sol-dsh-acceptance.md)，临时reader依赖明确保留。原工程结果见[逐批验收](reviews/implementation-batches.md)，next 后续状态以新工程报告为准；不能仅凭 dsh 的完成报告认定通过；平台连续Session与范围并行尚未交付。

## 1. 本地入口（2026-10-07 核对）

**在哪里跑。** 只在 WSL 里跑（用户 han001），而且一律在单独的副本里跑。不在 Windows 工作树里跑，不在 `~/cc-work`（另一个测试工作流的槽位）里跑，也不在 `base` 本身里跑。

**安装与配置。**
- Node：`/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node`
- CLI：`/home/han001/projects/agents/dsh-runtime-current/node_modules/@deepseek-ai/dsh/lib/bin.js`，版本 0.1.7-rc.2。
- DSH_HOME 用默认的 `~/.dsh`：
  - 不改里面的 profile、设置和凭据；
  - 不读、不打印密钥。
- profile 用 `headless`，默认模型是 deepseek-flash。
- 不用 3080（用户自己的网页界面），也不用 3099（插件测试用的 agent-platform-dev）。不启动工作台 44797。

**换模型或参数。** 只用覆盖文件，不改 `~/.dsh`。
- 覆盖文件放在 `~/dsh-work/patches/`，用 `--patch` 传入。例如 `pro.yml` 换成 deepseek-v4-pro；`llm-deepseek` 的 provider 配置里可以开关 thinking，reasoningEffort 可设为 off/low/high/max。
- 覆盖会整段替换一个条目的配置，所以要保留的字段也要写上。
- 用之前先用 `--dump-config` 核对模型。
- `--patch` 必须写在 `--json` 前面，否则会报 `unknown option '--patch'`。
- 按实测，平时不需要换（见 §6.5）。

**副本。** 每个任务一个新副本，做法如下：
1. 目标提交的 `git archive`，加上 `node_modules`；
2. 再在 `vendor/coding-agent/node_modules` 里放 zod 和 openai。缺了它们，typecheck 会报 100 个 TS7006；
3. `git init`，提交一个基线提交。

分级测试的副本做法是：`~/dsh-work/base` 只读，每次用 `cp -a` 复制一份；`~/dsh-work/ladder/<级别>/setup.sh` 负责建副本，并在副本外面记下基线提交。

**直接调用。** 一次跑一个任务，跑完就退出：

```bash
cd <副本> && DSH_TELEMETRY_MODE=DISABLED <node> <bin.js> --profile headless [--patch <覆盖.yml>] --json \
  [--session-id <id>] - < task.md > events.jsonl 2> err.txt
```

- 第一条事件给出 Session id。
- 在同一个 Session 里继续（返修，或者第二阶段）时，加 `--session-id`，并保持同一个副本、同一个 profile。
- 事件类型有：session、status（带 token 用量）、thinking、tool_call、tool_result、text、final。

**推荐经沙箱运行器跑：**
```bash
node ~/dsh-work/ladder/_common/run-dsh.mjs run <副本> <任务书> <运行名> --level <级别目录> [--session-id <id>]
```
- 它用 bubblewrap。运行中只看得见副本、私有的 `/tmp`，以及只读的 DSH 安装。看不见 `/mnt`（Windows 一侧）、base、其它副本和 `~/cc-work`。
- 默认上限是 20 分钟、1000 万 token。超了只杀它自己的进程，记为 `stopped: limit`。照用户的说法，DSH 每秒约 250–300 token，跑这么久说明卡住了，不是在干活。
- 它把 `run.json`（时间、token、工具调用次数）、`events.jsonl`、`final.md`、`scan.json`（越界路径）和 `git-status.txt` 写到 `~/dsh-work/ladder/_runs/<运行名>/`。
- 已知问题：这个运行器把 `--patch` 放在了 `--json` 后面。用覆盖文件之前，先在 `_common` 里改好参数顺序；改好的一份在证据的 `_results/L6work/run-dsh-fixed.mjs`。

**运行规矩。**
- 一次只跑一个 DSH，因为机器和测试工作流共用。
- 用后台工具调用启动。不要在 `wsl.exe` 里用 `nohup … &`，会被 SIGHUP 杀掉。
- 等待循环写进脚本文件。直接写在命令行里的 `pgrep -f` 会匹配到它自己。
- 给 DSH 看的检查输出，要在机器空闲时跑。负载下曾出现 14 个失败而不是 8 个，原因是 sqlite 计时。

**两阶段规则不变**（§2 第 3–5 条）：
- 新行为先由 lead 冻结接口和测试。DSH 第一阶段只写骨架和测试，写完就停。lead 审核并冻结之后，才进入第二阶段实现。
- DSH 自报的 PASS 只是输入。验收由 lead 和审查者做。

纯搬移（例如任务 D）没有新接口和新测试。这时冻结的是三样东西：lead 的搬移表、精确数量和检查脚本。
- 第一阶段：DSH 只出一份「计划改动清单」（dry run），然后停下。
- lead 用脚本逐行对照参考结果。
- 第二阶段：在同一个 Session 里执行改动，跑检查。

**历史入口作废。** 下面这些是 2026-09 的旧入口，只留作历史记录，现在不能用：hyh001 下的路径、0.1.6-alpha.1、`.dsh-vanilla`、`/tmp/coding-platform-dsh-run/run.py`、`tools/dsh-refactor/harness.py` 的 lane 挂载。历史 Session id 也不再续用。

## 2. 派发与接收规则

1. 先读[独立目标工程迁移与验收](reviews/next-completed-migration-2026-09-24.md)和 next 当前实现，再用已有 Prompt 5 [调查](../history/before-2026-09-22/refactor/source-analysis.md)定位必要旧行为；不重做全仓调查。主 Agent 细化[执行计划](refactor-plan.md)中 next 的一批。
2. 主 Agent 写任务书：只读旧行为对照、next 目标入口、固定接口/版本、允许修改文件、共享文件负责人、真实前置、保持行为及独立验收。默认不授权修改原 C/src，不要求把新实现重新接回旧系统。
3. 新行为由 Astra 冻结架构、接口和行为标准；DSH 4.1F 第一阶段只写骨架与测试，交付后停止。Astra 审查调用链、断言、正反例和红测原因，再冻结文件及测试 hash，才能派发第二阶段实现。测试由实现模型编写，不能因此称为独立验收；Astra须补查遗漏，必要时增加独立反例。已写好的Sol骨架和测试可复用，不为换分工而重写。独立批次的骨架 / 测试可并行准备，但不把缺少契约测试的范围交给 dsh 自行定义验收。目录移动仍使用逐字节比对、归属和相关既有测试，不重复造实现镜像测试。
4. 第二阶段的 dsh 只实现该批，能读/运行验收测试，不能放宽断言或自行修改设计。类型/边界失败由它修；涉及核心身份、权限、数据权威或范围的差异报主 Agent 判断。 若冻结测试与产品/接口语义冲突，给出具体断言和最小反例，由主审修正测试；不得为了数组长度、默认值或局部绿灯改变整体业务含义。主审也审查测试本身，测试不是免于审阅的真理。
5. Astra 独立审阅生产差异、接口、测试与真实消费者，运行相关检查；最后在不含旧平台源码的副本执行 typecheck/build/test/边界与装配验证。dsh 自报 PASS 只是输入，不代替独立验收。
6. 未通过时用同一 Session 精确返修；通过后记录证据，才接 next 内依赖它的调用者。冻结契约上的独立 scope 可并行，不把未验收能力当作已集成。next 无消费者副本及时删除；旧产品消费者和目录待新 Workflow/UI 最终切换后退出。
7. 并行期间相关局部检查可以同时运行；改写共同产物的命令单独协调。最终类型/集成验收使用可确认的工作树版本，避免在其它写者改到一半时记录全仓 PASS。

R2b 已实际触发这一闭环：原 11 项行为测试通过，但主审发现每份来源变化都重建 TS 服务；新增真实工厂工作量测试得到 6 次创建，随后返修。另补冻结身份不得被 Host 可变对象污染的测试。架构约束不能只靠提示词维持，必须有独立验证。

## 3. 每批提示词的必要约束

### 3.1 宽读、窄写：引用既有真源，不再建设一套“施工包”文档

依据用户 2026-09-24 的施工方式补充（引用任务“任务就绪状态审阅”）：每批 prompt 直接给**路径、用途、阅读顺序、本批不变量、精确写范围和验收入口**。阅读上下文覆盖整体目的与相邻模块，写权限仍保持狭窄；不能把只读依赖误当不存在的能力。

1. `docs/PRODUCT.md`：本批相关产品语义；`docs/refactor/intent/ORIGINAL-DIALOGUE.md`：有歧义时定位相关用户原话。
2. `docs/refactor/ARCHITECTURE.md`、`module-dag.md`：模块权责与允许依赖；不要求每次重读全部历史。
3. `docs/refactor/modules/core/<当前模块>.md`：数据权威、内部文件职责、操作与失败语义；按需读上下游模块相应章节。随后必读 [IMPLEMENTED-CAPABILITIES](IMPLEMENTED-CAPABILITIES.md) 的总览及本批相关条目，区分已接通、内部已用、组件已有与未实现。
4. `coding-platform/next/src/contracts/` 与当前模块 `contracts.ts`/`ports.ts`：实际冻结接口；相邻模块源码只读可查。
5. 当前 `next/src/` 骨架和 `next/tests/` 独立反例：沿实际完整调用链施工。索引只是入口，必须读被复用函数及其直接依赖、真实组合根和相应正反例；不能只读 Port 后重新实现已有能力。
6. `docs/refactor/tasks/` 当前任务和 scope：只写本批独有约束、允许文件、明确余项及固定检查名称。

能力索引只维护源码符号、装配状态、前提与证据，不复制完整类型或目标设计。长期语义只更新已有架构、模块、接口文档；本批差异留在现有 task prompt；已复现错误沉淀为语义回归。不要新增同义的 global-intent/invariants/module-context 文档组或复制权威正文。派发不是“给测试然后任它凑默认值”：先指出每项判据从哪条正式记录读取、谁证明读取完整、未知/不存在/禁止如何分别返回，再交骨架和测试。`unknown ≠ absent`、`absence ≠ authorization`、`candidate ≠ executable` 要由实际读结果与反例约束，不能只写口号。

本轮 R3c 的反例：任务状态必须读取 Plan、Run、TaskLease、TaskReduction；缺 provider/index/schema 不得解释成 pending/free；queryReadyTasks只产生task_state候选。对应规范在 WorkGraph 模块页，骨架在 tasks/plan-readers.ts，测试在 R3c-canonical-task-state/R3c-plan-adoption。该事实不要求再增加一个架构层。

R3d/R3g 的补充经验：约束也必须有真实正例，不能把“更严格”自动当“更正确”。mapping 的目录/代表路径不等于实际文件，文件 kind 不等于编译器 indexed membership；读取目录、缺失首路径和已索引 JSON 的正例与撤权/损坏反例同时保留。读取水位须在报告缺失前检查，但写入仅约束实际依赖的记录，不能无依据加入全局水位使并行无关写入触发重复捕获。跨边界缺少证据时，先补提供者已有事实的窄 DTO，再让 dsh 实现消费端；不让它按扩展名或默认状态猜测。

本轮并行纠偏经验：不要把“文档已经审过”当永久免审。产品中的白板/编排边界曾在详细接口中扩为统一硬门槛；先按最新用户原话核对规则是否有真实消费者，再冻结骨架与测试。测试约束错误策略只会把漂移固化。当前 resource 预占接口已标旧草案，DSH 不得据其补成全量门禁；连续历史薄转发不依赖它。

### 3.2 复用必须在骨架审核时可核对

Astra 的当批 prompt 指明相关能力编号/路径和用途；DSH 在第一阶段现有交付报告中给出简短对照：**需求 → 已读的现有符号/消费者 → 直接调用或最小扩展 → 确实缺少的接线 → 对应测试**。不新增独立施工包，不提交冗长阅读日志，也不把阅读声明当作正确性证明。公开接口不够时先找提供者已有事实，不能复制实现或用默认值绕过。

主审在已有的骨架/测试冻结环节检查这份对照和实际 import/调用：重复 parser、canonical fold、角色解析、事务封装、历史重建和模型循环必须消除，或说明不可复用的具体语义/所有权差异。共享内部 helper 不自动成为跨模块公共 API；需要扩展时由原 owner 提供窄接缝。与已有能力重叠的测试优先扩展实际消费者，不用只验证新 mock 的测试冒充接线。

第二阶段继续使用审核后的对照；实现中发现可复用项可直接在已授权范围采用，需要变更冻结接口/测试则仍由主审处理。合入验收后由主 Agent 更新能力索引相关条目。读取量按真实依赖展开，不要求每批重读全仓或反复查全历史；索引、文档和源码随 lane 快照一同只读提供，旧 lane 的刷新由主审记录。

### 3.3 本批执行约束

**测试去重（2026-09-25）：** 新增测试对应尚未被覆盖的领域不变量或跨模块接缝，不按 B/C/D 各复制一份 Store/Kernel 全矩阵。重复 setup 可合并，必须保留原断言的独有风险；没有执行行为的条件 return 不算后端覆盖。单次真实产品链优先用 SQLite+真实 Kernel+本地 scripted model 验证，新的存储事务语义才同时覆盖 Memory/SQLite。中间修复只跑受影响集合，整合验收运行一次 `verify:isolated`；有新失败或底层变更才扩大重跑。

`python3 tools/dsh-refactor/check.py next-catalog next-graph-agent` 现在合并 next 测试文件并去重，只启动一次 Vitest；`--show` 可先查看实际命令而不运行。保留已有单入口兼容，类型/架构和旧过滤命令仍单独运行；不能把类型检查从最终隔离验收去掉。主审按唯一风险判断测试是否必要，不以数量减少作为成功标准。

- 明确“执行本批”，给任务书绝对路径；不让 dsh 自行重开模块设计。
- 写明 W/C/N 与 `T=C/next`，默认实现和测试在 T；旧 C/src 与旧 PASS 仅为参考。五目录存在不等于完整目标契约已实现，AgentRuntime 已有工具循环与来源绑定组件，正式 Workflow/Runtime 入口仍 unsupported，UI 未迁。
- 列出保留行为、禁止顺带实现的后续能力、独立测试文件及只允许变动的测试清单。
- 不 reset/restore/clean/stash、自动提交或 push；不读凭据/无关会话日志，不安装依赖。
- 直接使用已有 Node24、Vitest、TypeScript；按批执行，不每次全仓重跑。
- 要求交付真实调用链、删除/保留实现及退出条件、实际测试结果和未实现能力。

## 4. 继续入口

先读 [HANDOFF](HANDOFF.md) 与[独立目标工程迁移与验收](reviews/next-completed-migration-2026-09-24.md)，确认 reader/index 实际验收状态，再读 [refactor-plan](refactor-plan.md) 中 next 当前子批及任务书。原工程[批次证据](reviews/implementation-batches.md)只作历史对照。R2c 必须在 R2b 验收后实施；R3–R6 有细化清单，但不应把全部大任务一次交给 dsh 自由推演。没有新的产品取舍时继续执行已有授权，无需再次向用户询问是否开工。

原工程[并行任务](tasks/DSH-PARALLEL-IMPLEMENTATION.md)及后续 Sol / dsh 返修已完成，Store/WG Goal 与 Kernel 公开扩展通过[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)。后续按 refactor-plan 的真实依赖准备骨架与契约测试，再派发 dsh；不重做已完成任务，也不把 Kernel 子集通过当作平台 Session 已接通。

## 5. dsh 自行组队的必要条件

本地 [Agent Teams profile 说明](../../../deepseek-harness/deepseek-harness-master/packages/experimental/agent-team-profile/README.zh.md) 明确：随附 profile 不默认启用团队工具，必须显式加入 `@deepseek-ai/dsh-experimental-agent-team-profile`。上述基本调用只证明 headless 可运行，不证明所用 profile 已装团队层。此前入口核对仅阅读包说明和工具源码，未修改用户配置、未安装包、未启动模型；该次只读核对不代表后续R3a/R4a未实施。

该本地说明给出的启用命令如下；它会修改指定 profile，仅在准备启用时执行，不是本轮已执行记录：

```bash
dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
```

要在原 DSH_HOME 下调用本地 dsh，而非意外修改另一个默认目录。命令运行者还应保持已有 Node24/CLI 入口；以上为包的文档语法，不假设 shell 已存在 dsh 别名。

工具为 `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` 和 `team_task_*`。提示词必须明确要求使用 Agent Teams。成员共享 cwd；write_scopes 只是冲突提示，无工作树隔离和文件锁。Lead 管公共文件和集成，等待成员真实完成；缺工具时如实报告，或由主 Agent 外部分派独立 dsh Session，不把串行扮演多个角色称为并行。

## 6. 实测上限与任务书写法（2026-10-07 分级测试，决定 32）

### 6.1 测了什么

**测试条件。**
- DSH 0.1.7-rc.2，headless，模型是 deepseek-flash。另有一次用了 deepseek-v4-pro。
- 每次都在沙箱里、在 bfb6075 的新副本上跑。
- 检查在一次性克隆上做，不碰副本。
- 每一级用原样的任务书重复 3 次，再试三种做法：详细任务书、角色设定、两种反馈。

**总量。** 共 57 次运行（60 个 Session），DSH 用时合计 146 分钟，合计 8490 万 token。没有一次碰到上限。

| 级别 | 内容 | 原样任务书 3 次 | 最好的写法 |
|---|---|---|---|
| L1 | 照精确规格写一个新文件（冒烟测试） | 1/1 通过，16 秒 | — |
| L2 | 搬 4 个文件，改 35 个文件 | 3/3 通过，约 2.7 分钟、81 万 token | 原样即可 |
| L3a | 搬 8 个文件，改 76 个文件 | 3/3 通过，约 4.2 分钟、237 万 token | 原样即可 |
| L3 | 搬 17 个文件，改 157 个文件（即 bfb6075 上的整个任务 D） | 0/3：157 个文件全对，但都多改了 3 个无关文件里的 10 处 | 详细任务书，一次通过，5.9 分钟、188 万 token |
| L4 | 按冻结接口实现 79 行的纯函数，并自己写测试 | 3/3 通过 | 详细任务书，71 万 token（少 69%） |
| L5 | 按带期望值的用例表写 14 个测试 | 3/3 通过，测试内容完全相同 | 详细任务书，8 万 token |
| L5b | 同样 14 个测试，只给情形，值要从代码推出来 | 3/3 通过，和 L5 写出的测试相同 | 详细任务书，10 万 token |
| L6 | 不给用例，按规格加仓库实现 94 行的 owner 写入 | 3/3 通过 | 详细任务书，214 万 token（少 66%） |
| LD | 在代码和中文文档里查 10 处 | 3/3 全对，答案逐字节相同 | 详细任务书，16 万 token（少 50%） |

### 6.2 上限在哪里

**没找到规模和难度上的上限。**
- 每一级都有写法一次通过。
- 整个 ladder 里，得分低于满分的只有那一次 pro（15/16）。
- 规模不是限制。157 个文件一次跑完，约 6 分钟。DSH 会自己写 TypeScript 语法树脚本，所以成本跟步数走，不跟文件数走：从 L3a 到 L3，文件多了 2.1 倍，时间只多 1.3 倍，token 反而是 0.9 倍。

**可靠的事：**
- 规则写死的多文件机械修改；
- 按冻结接口和输出约定实现单个函数；
- 仓库里有样板时，按规格实现 owner 写入；
- 按用例写测试；
- 按标识符查代码和中文文档；
- 按指出的位置返修。

**开始出错的地方。** 不在任务大小，在任务书怎么写规则：
1. **规则的范围。** 笼统的一句话，它会用到所有够得着的地方。L3 原样的 3 次都把无关文件里的写法也“顺手改整齐”了。只有“分情况写的规则，加一个仓库里的例子”才挡住了。
2. **没写成规则的惯例。** L6 的 5 次 flash 全都漏了仓库惯用的“别的 workspace 的记录要拒绝”，因为规格那一行没列这一步。任务书写了“照代码库的做法”，结果字面规格赢了。
3. **大概的数字。** “约 360 处”变成了目标，实际 368 处它也接受了（L3，3/3）。
4. **自己列的清单不全。** L3 原样任务书下，过时注释只列出 38 条中的 14 条；L5 的“未规定事项”只列出 15 项里的 6–8 项。给了列举方法之后就全了。
5. **报告里的否定说法。** “没找到”“没建文件”“没有矛盾”这类话，大约每一级有一次是错的。CHECKS 里的数字几乎都对。
6. **流程纪律。** 搬移级别每个 Session 都用了 `/tmp`，尽管写了“只在当前目录”。没点名禁止的 git 命令，L3 里有 4/8 用了（add、rm、checkout）；点名之后没有再用。

**稳定性。** 同一级重复 3 次，结果从来没有不同：要么都对，要么像 L3 那样错得一模一样。“时好时坏”只出现在三处：
- 第一版脚本的 bug（L3a 5/5 都有，每次不同，都被它自己发现了）；
- 自选的测试用例；
- 报告里列了哪些项。

所以重复跑一遍查不出系统性错误，要靠任务书和 lead 的核对。

### 6.3 任务书怎么写

基础骨架用冒烟测试的四段：
- 一句开场：“这是规定完整的任务，照做，不做设计决定，没规定的写进报告”；
- 要做什么；
- 写范围；
- 检查命令和固定的四段报告：FILES CHANGED、CHECKS、UNSPECIFIED、NOTES。

缺什么再加什么：
1. **规则按情况写，并给一个仓库里的例子。** 例如：(a) 指向被搬文件的改；(b) 被搬文件里的相对路径按新目录写；(c) 其余一律不动，即使换个写法也能解析，例子 `src/core/agent-runtime/` 下的 `'../../core/workspace/x.js'`。依据：L3 原样 0/3，详细任务书一次通过。
2. **期望的不变量逐句写出来，** 不写“照代码库的做法”。依据：L6 5/5。
3. **给精确数量，按种类分开。** 例如“354 处、149 个文件 = 被搬文件 21 处/11 个 + 其它 333 处/138 个”。要求先 dry run，数量对上了才动手。依据：L3。
4. **列出要读的文件和行号范围，附几行接口摘录。** 引用样板文件和规格里的实现说明。依据：同样质量下 token 少 50–69%（L4、L5、L5b、L6、LD）。
5. **只跑点名的检查，并写出前后的精确数字。** 不许跑整个目录。依据：L6 约一半 token 花在可跑可不跑的测试上。
6. **点名禁止的 git 命令：** add、rm、checkout、restore、stash、reset、commit。**指定草稿目录：** 副本内，结束前删掉，不用 `/tmp`。
7. **要完整的清单，就给列举方法。** 例如“对每个旧文件名 git grep，带不带行号都算，逐条写 file:line”。“没找到”要写出用了哪条命令。
8. **要它报矛盾，就明说。** 例如“列出引用的规格和输出约定不一致的每一句”。否则它常写“没有矛盾”（L4 有 3/5 次）。
9. **格式上的选择在任务书里定死。** 例如值一律写成字符串、一项一行。同一规则如果有两种读法，选一种，并写出与之对应的数量。
10. **不要加角色设定。** 试了 7 级，没有一级变好；有 3 级明显更慢，1 级测试更弱。
11. **不要加它本来就会做的步骤清单。** 在 L2 和 L3a，这种清单没带来好处，多出来的命令只会变成多出来的步骤。

### 6.4 反馈怎么给

- **不要只发检查输出。** 8 级里 8 次都什么也没改。大多只回一句“Confirmed”，常常连报告格式也丢了。L3 那次还多了一句错话。
- **发 lead 的审阅。** 写清楚：
  - 哪里有问题（file:line）；
  - 往哪个方向想；
  - 要重读任务书的哪一句；
  - 让它核对自己的数字；
  - 圈定能改的范围：“只在任务书要求时才改，并写出依据哪条规则”。

  不给答案，不给代码，不给结论，不给隐藏测试的结果。这样 9/9 次都修好了，或者正确地保住了本来就对的结果。每次 12 秒到 3.3 分钟。
- **位置要由 lead 自己找。** 用 `git diff --name-only` 对照期望清单，或者核对数量、自己 git grep、对照约定读它的 diff。绿色的检查输出里找不到位置。
- **告诉它只重跑哪些检查。** 否则它会重跑整个目录。
- **一般一轮就够。** 第二轮还不行就停下，由 lead 用别的办法完成。

### 6.5 模型和拆分

- **一律用 deepseek-flash。** pro 只跑了一次：更慢（394 秒），得分 15/16，还漏了 flash 搜索时 4/4 都找到的那条规格。thinking 和 reasoningEffort 没测，因为没有哪一级需要。
- **能用一个脚本做完的任务不拆。** L3 拆成 3 批：
  - 成本约 3 倍，批与批之间另需约 21 分钟检查；
  - 第一批照样犯同一个错；
  - 第二批用 `git checkout -- src tests` 收拾自己的错。要不是第一批违规 `git add -A` 了，这一下会把第一批抹掉。
- **要拆就按种类拆，不按大小拆。** 例如两阶段（dry run 和执行，或者骨架/测试和实现）。如果非要分批，每批通过后由 lead 提交，并点名禁止 checkout、restore、stash、reset。

### 6.6 lead 怎么核对

DSH 的报告只是输入。每次都要做：
1. `git status --short` 的形状对，`git status --ignored` 里没有残留；
2. `git diff --name-only` 等于期望清单；
3. 改动数量等于精确数量；纯修改时 numstat 的增删行数相等；
4. 冻结测试和隐藏测试的 sha 没变；
5. typecheck、`check:architecture` 通过；测试 id 与基线相同，没有新失败；
6. 没有提交，标签没有动；
7. `scan.json` 里没有越界访问。已知误报：它自己写进模块路径字符串里的 `..`，正则里的 `~`。
8. CHECKS 的每个数字都和检查结果对上；每一条否定说法都用 git grep 核实。

搬移任务另外要求：和参考脚本的结果逐字节相同。

各级的检查脚本在 `~/dsh-work/ladder/_common/`：`check-move.mjs`、`check-hidden.mjs`、`check-mutants.mjs`、`check-lookup.mjs`。

### 6.7 不要给它的

- 大概的数字；
- 不限范围的风格句子；
- 用“照代码库的惯例”代替写明的规则；
- 没有阅读清单的“需要的都在副本里”；
- 只有检查输出的反馈，或者负载下跑出来的检查输出；
- 答案、代码、结论或隐藏测试的结果；
- 角色设定；
- 设计决定，例如未归位文件放哪、断哪条依赖边；
- 副本以外的写权限：真实工作树、提交、推送、`~/.dsh`、3080/3099/44797 端口。

### 6.8 证据

分级测试的证据在 [reviews/evidence/dsh-ladder-2026-10-07](reviews/evidence/dsh-ladder-2026-10-07/README.md)：
- 总表：`SCORECARD.md`。
- 写法和依据：`GUIDE.md`。
- 任务 D 的做法：`TASK-D-PLAN.md`；搬移表草稿：`L3-MOVE-TABLE.md`（按 bfb6075 计数，任务 D 前要在删减后的代码上重算，决定 34）。
- 各级的细节：`<级别>-RESULTS.md`。
- 运行脚本、每次运行的记录和 `best.diff` 没有入库：在 WSL 的 `~/dsh-work/ladder/` 和本次会话的临时目录里。

### 6.9 第一次真做：任务 D（2026-10-07 实测）

任务 D（WorkGraph 搬 18 个文件，改 158 个文件里 380 处 import 路径和 12 处路径字符串，提交 0cd45508）按 [TASK-D-PLAN](reviews/evidence/dsh-ladder-2026-10-07/TASK-D-PLAN.md) 交给 DSH，用的是 §6.3 的写法：精确计数、分情况的规则加仓库里的例子、点名禁止的 git 命令、给旧名的列举方法。分两段：第一段只列出每一处要改的地方后停下，lead 几秒钟对照，392/392 行一致；第二段在同一 Session 里照做。没用到带指导的返工轮。结果和参考脚本逐字节一致，带回本分支后全量测试 216 个文件、5245 项通过。

- **DSH 用量：** 第一段 183 秒、100 万 token、26 次工具调用；第二段实际约 205 秒（墙钟 292 秒，其间主机睡眠 87 秒）、117 万 token、14 次；共约 6.5 分钟、217 万 token、40 次。在计划估计（6–10 分钟、200–380 万 token）之内，比 L3 一次跑完（352 秒、188 万 token）多约 30 万 token。停止点守住了：第一段除了草稿目录没改任何文件。
- **lead 用量：** DSH 阶段约 56 次工具调用、47 分钟，其中约 37 分钟在等（检查器约 30 分钟，其中 22 分钟是主机睡眠），读和查约 10–15 分钟；带回本分支约 47 次、25 分钟，其中全量测试约 17 分钟。准备阶段（重算计数、基线、参考搬移的对照、写任务书）的调用次数没记，机器时间主要是五次全量测试。lead 的 token 数没记。
- **报告：** 数字全对，旧名清单 38/38，否定说法全对；只有一处把字符偏移写成了行号，不影响结果。
- **要注意：** 仓库里方案的证据目录带着参考脚本和答案清单，建副本时要删掉（这次由准备阶段的金丝雀检查发现）。主机睡眠会拉长墙钟，算用量时按系统日志扣掉。

证据在 [reviews/evidence/workgraph-move-2026-10-07](reviews/evidence/workgraph-move-2026-10-07/README.md)。

## 7. 换一个模型来审查：Codex（2026-10-07 试验）

用户问：能不能在 DSH 实现之后，换一个模型来审查，再让 DSH 返工？试验在 [reviews/evidence/codex-review-trial-2026-10-07](reviews/evidence/codex-review-trial-2026-10-07/README.md)。拿本批 3 个结果已知的提交让 Codex 审：唯一的真问题它找到了（A，xhigh，6.5 分钟），没有一条误报；另外两个只漏了一个小问题和一件它看不到的计划内容。

**放进决定 36 的循环里：**
1. DSH 按任务书实现；
2. 同时开始三件事：脚本核对（§6.6）；Codex 只读审查；lead 读 diff；
3. lead 逐条核实 Codex 的问题，去掉误报，和自己的发现一起写成返工说明（§6.4）；
4. DSH 返工。

**怎么用：**
- 命令：`codex exec -s read-only --ephemeral --json -o <输出> "<说明>"`，让它用 `git show <sha>` 看提交。Codex 装在 `%LOCALAPPDATA%\OpenAI\Codex\bin\…\codex.exe`，不在 PATH 上；WSL 里没有。
- 在一次性副本上审，检出到要审的提交。
- 推理强度：改状态、改逻辑的片用 xhigh，其余用 high（用户 2026-10-07）。纯搬移不用它审，和参考脚本逐字节对照就够了。
- 说明里附上任务书和规格的相关行。它只看得到给它的东西，要查“是否照计划做全了”，就得把计划给它。
- 它的结论和 DSH 的报告一样，只是输入，由 lead 核实。
- 用的是用户的 ChatGPT 额度，代码会发给 OpenAI。用户同意了这次试验和以后按这个做法审查。

**还没解决：** 在 Windows 沙箱里它跑 shell 命令会失败（目录名无效），这次靠它自带的 JS 读取工具完成了。以后可以试着把副本放到沙箱用户能进的目录。
