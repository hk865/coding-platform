# 本地 dsh 的分批实施与验收

> **2026-09-25 当前执行方式：** 在已建立的 `coding-platform/next` 内采用 Astra 架构与接口 → DSH 4.1F 骨架与测试 → Astra 审核并冻结 → DSH 4.1F 实现 → Astra 审阅 → 物理隔离测试。中间审核是独立阶段，不得在同一次不间断调用中先写测试再直接实现。原 `coding-platform/src` 只读参考。最新 [A1 验收](reviews/next-a1-graph-session-2026-09-25.md)为 75 文件 / 719 项，已增加正式目录、Module/Task 关联、定向发现和显式生命周期；前序图历史、Source、Session/Claim、Role 等原语继续复用。先读[完整路径计划](IMPLEMENTATION-PLAN.md)与[能力索引](IMPLEMENTED-CAPABILITIES.md)，不要以局部实现范围代替双图、装配、咨询、编排与控制的产品目标。运行入口 [next/package.json](../../package.json)；环境和精确写范围见 [DSH-EXECUTION-HARNESS](DSH-EXECUTION-HARNESS.md)。

**原工程实施历史（2026-09-23–24，不是 next 的验收）：** 用户已授权主 Agent 负责架构、骨架和测试，dsh 按真实依赖分批并行实现代码。已经实际调用并完成 R2a、R2b、R2c、R2d.1 独立验收，R2d.2 也已独立验收，R2d.3也已沿同一会话完成并独立验收；R2e.1已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)。用户提交的 R3a / R4a 首轮实现曾未通过[9 月 23 日验收](reviews/R3a-R4a-independent-acceptance.md)；9 月 24 日已完成 Sol 骨架 / 测试与 dsh 受限返修并验收通过。R3b正文与规则已按两个受限Session并行实现，真实接线通过[功能验收](reviews/R3b-sol-dsh-acceptance.md)，临时reader依赖明确保留。原工程结果见[逐批验收](reviews/implementation-batches.md)，next 后续状态以新工程报告为准；不能仅凭 dsh 的完成报告认定通过；平台连续Session与范围并行尚未交付。

## 1. 真实本地入口

- CLI：`/home/hyh001/projects/deepseek-harness/deepseek-harness-master/apps/cli/lib/bin.js`，已核对版本 `0.1.6-alpha.1`。
- DSH_HOME：`/home/hyh001/projects/deepseek-harness/.dsh-vanilla`；沿用现有已配置环境，不读取/打印凭据，不修改权限模式。
- Node：`/home/hyh001/projects/coding-platform/.toolchain/node-v24.21.0-linux-x64/bin/node`。
- dsh 外层运行 cwd 可保持 `/home/hyh001/projects/coding-platform`；任务书写范围必须落在 `coding-platform/next/`。新产品构建/测试 cwd 为 `coding-platform/next`，原 `coding-platform/src` 只读。
- 原工程源码捕获阶段 R2a–R2c 的历史 Session：`session-b1f94780-085b-43e3-a1d6-40b391dfcba2`，相邻实现与修复连续复用。当时 R2d.1 转向运行工具模块，使用 `session-f5c2b6c6-58f6-4f3f-9427-07abe0d24d69`，依据落盘任务书与独立测试接手。R2d修复继续复用该Session；R2e.1回到源码核心Session b1f94780，依据最新任务书/实际文件接上已验收R2d端口。此前在同一工作树串行派发是当时执行安排，不再作为全局限制。按当前[并行设计](PARALLEL-COLLABORATION.md)，公开契约冻结后，文件范围不冲突的内部实现可并行；公共契约、组合根、模块map及共用fixture由指定集成者协调。会改同一文件/输出/数据库的任务先交接范围，不能互相覆盖。

原工程已验证的 CLI 调用示例（下列 Session 是历史值，新批使用其任务书登记的 Session；`TASK_FILE` 是冻结任务，不是自行扩写的总目标）：

```bash
cd /home/hyh001/projects/coding-platform
env DSH_HOME=/home/hyh001/projects/deepseek-harness/.dsh-vanilla \
    DSH_TELEMETRY_MODE=DISABLED \
  .toolchain/node-v24.21.0-linux-x64/bin/node \
  /home/hyh001/projects/deepseek-harness/deepseek-harness-master/apps/cli/lib/bin.js \
  --profile headless --json \
  --session-id session-f5c2b6c6-58f6-4f3f-9427-07abe0d24d69 \
  - < "$TASK_FILE"
```

第一次创建 Session 时省略 `--session-id`；继续时保持原 cwd 和 profile。调用参数和 stdin 已实际验证，未依赖 GUI。GUI 启动脚本另使用 `web --host 127.0.0.1 --port 3080 --no-open`，无需为了本任务启动网页。

原工程批次中主 Agent 曾用 `/tmp/coding-platform-dsh-run/run.py` 调上述 CLI：仅显示 Session、工具名、最终输出文件与退出码，丢弃 thinking 事件；各批保存独立 final/result 记录。该 `/tmp` 包装脚本是运行辅助，不是产品依赖；丢失后可按上面入口重建。必要验收结论已经另存文档，不能要求接手者读取全部原会话日志。

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
