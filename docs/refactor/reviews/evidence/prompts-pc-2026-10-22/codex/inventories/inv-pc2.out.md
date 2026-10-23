已完成只读盘点。以下按当前文件定位；没有运行测试、构建、git 或网络，也没有改动文件。文中的新增文件名、接口和行数均是任务书建议，尚未落地。

最需要先冻结的是三个交界：**PC-1 的冻结包接口、准备时确定的历史来源、准备与开始共用的最终工具清单**。否则 PC-2 容易出现“准备验的是一份，实际发出的是另一份”。

**1. P1：磁盘位置与两次 realpath 检查**

| 项目 | 当前树 | PC-2 落点 |
|---|---|---|
| 设置目录 | CLI 将 `settingsDirectory` 相对配置文件目录解析；当前没有工作区包含检查。`src/app/main.ts:154`、`src/app/main.ts:163` | 沿用这个配置，不另设提示词根配置。 |
| 默认目录 | SQLite Host 默认用 `<storage.directory>/host-settings`；内存 Host 没有显式目录时关闭设置。`src/app/host.ts:325`、`src/app/host.ts:328` | 用户包为 `<settingsDirectory>/prompts/<packId>/`。无设置目录的 Host 仍可使用静态平台包。 |
| 设置文件 | `createHostSettings` 异步读取 `<settingsDirectory>/host-settings.json`，损坏时启动失败。`src/app/host-settings.ts:436`、`src/app/host-settings.ts:443`、`src/app/host-settings.ts:447`、`src/app/host-settings.ts:457` | 不把用户包正文塞进这个 JSON。 |
| 配置工作区 | CLI 在配置目录下解析工作区根；Host 启动先复制配置。`src/app/main.ts:101`、`src/app/host.ts:320` | 启动检查覆盖这份工作区列表。 |
| 恢复工作区 | 设置恢复通过 `assembly.openWorkspace` 打开；恢复发生在 reconcile 和 HTTP 服务启动前。`src/app/host-settings.ts:569`、`src/app/host.ts:1016`、`src/app/host.ts:1033` | 恢复根也必须检查，拒绝须转成明确的启动配置错误。 |
| 打开新工作区 | `openWorkspaceImpl` 已先 `realpath`、再确认目录，然后才做已有根匹配和注册。`src/app/host.ts:869`、`src/app/host.ts:872`、`src/app/host.ts:890`、`src/app/host.ts:902` | 在目录确认之后、已有根快捷返回和任何注册之前插入检查。 |

建议具体安排：

- **启动检查**：在 `src/app/host.ts:331` 附近建立提示词目录并取得真实路径，核配置工作区；设置文件解析完成后，在 `src/app/host-settings.ts:461` 后、恢复循环前核全部恢复根。可以通过 Host 回调完成，避免设置文件被解析两遍。
- **打开检查**：在 `src/app/host.ts:878` 附近比较真实路径；新根等于提示词目录，或包含提示词目录，返回 `invalid`，原因明确写出覆盖关系。恢复也走此检查，但启动层应保留具体原因。
- 包含关系应比较路径边界，不能用裸字符串前缀。现有真实路径边界判断可参考 `src/core/workspace/continuation-diff-reads.ts:129`、`src/core/workspace/continuation-diff-reads.ts:131`；它不是可直接调用的独立 Host helper，建议在 Host 提示词模块内提取小函数。
- 不直接复用 `canonicalExisting`：它在 `realpath` 失败时返回原路径，会把要求真实路径的检查降级成词法检查。`src/app/host.ts:634`。

**2. P1：解析、继承、校验，以及 D3 已经做了什么**

D3 目前提供的是**静态平台包数据和同步渲染器**。构建脚本异步读资源，生成 `platform-pack.generated.ts`；运行时使用生成模块。`scripts/build-platform-prompts.mjs:41`、`scripts/build-platform-prompts.mjs:127`、`src/contracts/prompts/platform-pack.generated.ts:1`、`src/core/agent-runtime/context-rendering.ts:182`。

`ResolvedPromptPackV1` 当前只有 `manifest/templates/strings/tools`，没有每个模板的来源包、继承解析结果或加载问题类型；`extends` 只是 manifest 字段。`src/contracts/prompts/prompt-pack.ts:10`、`src/contracts/prompts/prompt-pack.ts:22`。

建议冻结两层：

1. Host 的异步文件读取口：读用户包及父包，平台父包直接取静态模块。
2. contracts 的纯解析、继承、校验口：输入已读出的包文件，输出不可变的有效模板、逐模板来源、合并字符串表、工具文字和段序；不依赖文件系统。

继承建议明确为：

- 模板按 id 取最近子包的完整模板，保留其来源包和版本。
- `strings.json` 按键由子包覆盖父包。
- 工具文字按工具名覆盖；是否再逐参数路径合并，规格尚未明确，建议第一版按完整工具条目覆盖。
- 缺父包、循环继承、文件缺失、坏 JSON 均拒绝；不能退回平台包掩盖损坏。
- 每次**新准备**重新读用户包。不要按 `packId` 长期缓存正文；已经 prepared 的执行消费 PC-1 的冻结正文。现有模型缓存是按 binding id 缓存模型客户端，不能顺手拿来缓存用户包。`src/app/runtime-configuration.ts:386`、`src/app/runtime-configuration.ts:421`。

校验现状与新增量：

| 校验 | D3 当前已有 | P1/P10 还要做 |
|---|---|---|
| 未知槽位 | 拒绝模板中的未知槽位，也拒绝调用者传入的未知槽位。`src/contracts/prompts/render-template.ts:72`、`src/contracts/prompts/render-template.ts:195` | 变成可供加载、保存使用的公开校验结果。 |
| 重复槽位 | 所有槽位最多一次；条件块也计一次。`src/contracts/prompts/render-template.ts:64`、`src/contracts/prompts/render-template.ts:121` | 复用，不另写一套计数。 |
| 必填槽位 | 仅检查**传入值**非空，并未检查模板正文确实出现必填槽位。`src/contracts/prompts/render-template.ts:199`、`src/contracts/prompts/render-template.ts:203` | 加载、保存检查出现一次；准备时空值映射为 `invalid`。 |
| 语法 | 检查多余或未闭合 `{{`、错误闭块；支持条件块和工具块。`src/contracts/prompts/render-template.ts:86`、`src/contracts/prompts/render-template.ts:102`、`src/contracts/prompts/render-template.ts:105` | 复用解析树派生段序和块外文字，避免再写正则解析器。 |
| 工具块 | 工具名只检查非空；渲染按最终名字数组决定保留。`src/contracts/prompts/render-template.ts:114`、`src/contracts/prompts/render-template.ts:174` | 声明可用性检查与平台扫描测试另加。 |
| 文件与 JSON | 生成器读文件，检查字符串值、模板版本为整数、`mentionsTools` 为字符串数组、工具说明结构。`scripts/build-platform-prompts.mjs:44`、`scripts/build-platform-prompts.mjs:51`、`scripts/build-platform-prompts.mjs:56`、`scripts/build-platform-prompts.mjs:66` | 用户包还需 schema/id/继承、文件路径边界、合法版本、完整模板校验。生成器目前没有这些完整校验。 |
| 段序 | D3 没有加载时的段序校验；实际顺序仍由旧模板和调用代码共同决定。`resources/prompts/platform/templates/work-input.txt:3`、`src/core/agent-runtime/context-rendering.ts:190` | 加载、保存、准备统一核角色第一、允许段、重复段。 |

目前渲染错误是普通 `Error`；Work、Query 装配 catch 会返回 `unavailable`，不满足 P1。应引入可辨认的问题类型，例如 `{packId, templateId, reason}`，只把包错误、模板错误和必填槽位空值转成 `invalid`，其余基础设施失败仍按原语义处理。`src/contracts/prompts/render-template.ts:180`、`src/core/agent-runtime/execution-preparation.ts:487`、`src/core/agent-runtime/query-preparation.ts:242`。

异步读取可以放进现有准备链，不需要改成同步文件读取：两类 assembler 本来都返回 Promise。收缩循环和入口重渲染则必须只用冻结数据，保持纯同步计算。`src/core/agent-runtime/context-types.ts:59`。

**3. P1：编辑路由、权限、版本及原子保存**

路由应放在现有 settings 分支，不进 core 业务路由：

- HTTP 前缀在 `src/app/host-settings-types.ts:8`。
- 路由类型表在 `src/app/host-settings-types.ts:96`。
- 允许的 suffix 表在 `src/app/host-settings.ts:56`，分派在 `src/app/host-settings.ts:883`。
- 服务端 POST 分派在 `src/app/server.ts:394`；token 检查在 `src/app/server.ts:331`，同源检查在 `src/app/server.ts:363`。
- 最近的读写样板是 `snapshot`、`models/save`；保存的校验、持久化失败回滚、通知配置更新在 `src/app/host-settings.ts:609`、`src/app/host-settings.ts:648`、`src/app/host-settings.ts:653`。

建议四个 suffix 的最小 DTO：

| suffix | 输入 | 输出 |
|---|---|---|
| `prompts/packs/list` | 空对象 | 包列表及有效模板列表；每项含版本、来源包、问题 |
| `prompts/packs/create` | `{packId}` | 新包描述；固定继承 `platform` |
| `prompts/templates/read` | `{packId, templateId}` | 有效正文、版本、来源包、槽位表、`mentionsTools`、问题 |
| `prompts/templates/save` | 规格给出的五项 | 保存后的模板描述和新版本 |

这些是建议接口，规格只冻结了 save 的字段，其他响应形状仍需 lead 定稿。

**“只认人”目前不能直接声称已有。** settings HTTP 入口核 token，但 `HostSettingsPort.call` 不携带 principal；Host actor 类型允许 human 和 system。`src/app/server.ts:348`、`src/app/host-settings-types.ts:109`、`src/app/core-http-types.ts:118`。建议新编辑路由使用 Host 注入的可信 actor 检查，拒绝 system；不接受请求体自报的 actor。现有 token/同源检查继续保留。

错误码：

- `SettingsResponse` 目前没有 `revision_conflict` 或结构化 issues，应补类型。`src/app/host-settings-types.ts:107`。
- HTTP 层已经有 `revision_conflict → 409`；`invalid → 400`、`forbidden → 403`、`not_found → 404`，无需另造映射。`src/app/server.ts:150`、`src/app/server.ts:155`。
- 平台包 save 在写文件前返回 `forbidden`；版本不符返回 `revision_conflict`；校验失败返回 `invalid` 和问题列表。

原子写不能只照抄两次 rename。现有设置保存只涉及一个 JSON：同目录临时文件后 rename，调用通过队列串行。`src/app/host-settings.ts:505`、`src/app/host-settings.ts:517`、`src/app/host-settings.ts:901`。

建议模板保存采用：

1. 串行检查有效版本和新正文；
2. 写新的、不可变的版本文件；
3. 原子替换 manifest，使正文文件引用和版本号一起生效；
4. manifest 切换前失败不改变读者可见版本。

这样不会出现正文已更新、manifest 版本仍旧的半次保存。首次覆盖继承模板的 `expectedVersion` 和新版本规则需冻结，建议比较当前有效父模板版本，然后本地版本取该值加一。

路由测试样板在 `tests/app/host-settings.test.ts:98`、`:129`、`:140`；POST/token/同源覆盖在 `tests/app/host-settings.test.ts:181`。

**4. P2：选包从设置到准备的完整链**

| 层 | 当前位置 | 要补的字段或行为 |
|---|---|---|
| 设置公开模型、保存输入 | `src/app/host-settings-types.ts:10`、`src/app/host-settings-types.ts:69` | 可选 `promptPack`、`reasoningReplay` |
| 可信初始模型、持久化模型 | `src/app/host-settings.ts:100`、`src/app/host-settings.ts:112` | 同样携带两项 |
| 读取、初始化、公开投影、保存 | `src/app/host-settings.ts:375`、`:424`、`:528`、`:609` | 验证枚举和包 id；保持“缺省字段不补进读口” |
| 直接模型绑定 | `src/app/runtime-configuration.ts:46`、`:251` | 相同字段和默认规则 |
| 设置模型转运行绑定 | `src/app/host.ts:667` | 明确携带模型项 id、所选包、思考策略 |
| 直接绑定投影为设置目录 | `src/app/host.ts:793`、`:806` | 模型身份去重需考虑两项，避免不同选包的绑定被合成同一个模型项 |
| 模型配置解析 | `src/app/runtime-configuration.ts:417` | 当前只输出 revision/provider/model/baseUrl；需把选择信息传下去 |
| Runtime 配置 | `src/core/agent-runtime/execution-contracts.ts:129` | 与 PC-1 冻结接口一致 |
| Work 准备 | `src/core/agent-runtime/execution-preparation.ts:372`、`:377`、`:611` | 取默认值、加载一次、冻结；复制配置时保留新字段 |
| Query 准备 | `src/core/agent-runtime/query-preparation.ts:193`、`:204`、`:235` | 同样处理，不能只改 Work |

默认值只在有效配置解析时取 `platform/current_run`，设置读口保留缺省状态；当前公开投影就是按字段是否存在输出。`src/app/host-settings.ts:528`。

绑定钉住机制已经存在：Work/Query 第一次成功解析后，按 RunRef 保存当时的 `RuntimeHostBindings`；失败不钉住；设置变更安装新实例。它钉住的是绑定，不是磁盘包内容。`src/app/host-settings.ts:223`、`:230`、`:237`、`:255`。

PC-1 必须先交付并冻结：

- `PromptSetV1` 及正文存取、`readPromptRecord`；
- 模型项 id、provider、model、packId、reasoningReplay 的传递和比较；
- 准备后、开始和恢复只消费冻结正文；
- 冻结模板及字符串表可用于 brief/review 重渲染；
- 基础提示词、Skill 和工具说明进入最终请求的接线。

现有 Work 配置不符拒绝在 `src/core/agent-runtime/execution-driver.ts:572`；恢复缺活证明先 `busy` 在 `:388`；Query 已进入后只观察在 `src/core/agent-runtime/query-execution.ts:176`。PC-2 不应重新定义这些结果。

**5. P10：段序的全部改点**

| 位置 | 当前事实 | P10 修改 |
|---|---|---|
| 三份输入模板 | Work 是 role→goal→task→footprint→notes→reminders→inputs→continuation→review；planning 是 role→goal→task→footprint；copy 是 role→goal→task。`resources/prompts/platform/templates/work-input.txt:3`、`query-planning-input.txt:3`、`query-copy-input.txt:3` | Work 平台版把 reminders 移最后；Query 保留各自子集的相对顺序。 |
| 槽位表 | 三份表在 `src/contracts/prompts/slot-tables.ts:17`、`:29`、`:36`；输入模板目前只把 role 标必填 | 区分“模板必须有槽位”与“这次渲染的槽值可以为空”；派生每调用类段序。 |
| 展示与预算常量 | `OPTIONAL_SECTIONS` 从展示常量过滤出来。`src/core/agent-runtime/context-rendering.ts:37`、`:41` | 独立固定预算顺序 footprint→notes→reminders→inputs，不能随模板顺序变化。 |
| 预算算法 | 按固定顺序形成完整计费文字，枚举所有行前缀，取能放下的最长者。`src/core/agent-runtime/context-rendering.ts:94`、`:111` | 保留这个算法及省略说明计费；不要借 P10 改删减策略。 |
| 实际渲染 | 静态平台包、空工具数组。`src/core/agent-runtime/context-rendering.ts:182` | 改用本次冻结包及工具集合。 |
| 段数组 | 当前按代码固定顺序 push；非 role 段区间排除前导两个换行。`src/core/agent-runtime/context-rendering.ts:190`、`:196`、`:213`、`:224`、`:230` | 按冻结段序组织全部段，包括全省略的空区间项；区间来自实际渲染。 |
| 预算字节数 | 当前用最后可选段末尾减最后必填段末尾。`src/core/agent-runtime/context-rendering.ts:218` | 改取预算选择阶段的实际计费字节数，避免新顺序把 brief、review 或必填段夹进去。 |
| 绑定类型 | 尚无 sectionOrder。`src/contracts/graph-context.ts:104` | 加必填 `sectionOrder`，不兼容旧记录。 |
| Work/Query 绑定产生处 | `src/core/agent-runtime/context-work-recipe.ts:300`、`src/core/agent-runtime/context-query-recipe.ts:80` | 写入实际调用类对应的冻结顺序。 |
| 固定顺序守卫 | `src/core/work-graph/state/context-input.ts:44`、`:254` | 校验绑定顺序本身，再按它检查实际段。 |
| 尾段守卫 | brief/review 共用“最后、结束于全文末尾、后缀相同”。`src/core/work-graph/state/context-input.ts:178`、`:197`、`:202`、`:206` | 按 UTF-8 半开区间核完整正文与一次性，不要求最后。 |
| 入口重渲染 | 当前用静态 renderer，再 `endsWith`。`src/core/work-graph/tasks/execution-entry-service.ts:973`、`:1053`、`:1201` | 读 PC-1 冻结模板、字符串表；按绑定区间核。 |
| 收缩所需数据 | assembler 只交出 `reviewSectionStart`。`src/core/agent-runtime/context-types.ts:51` | 改交完整、不可变的渲染材料或纯重渲染函数；保留所有非 review 槽值。 |
| review 收缩 | **规格引用仍准确：`:519–557`**。当前把 review end 改成全文末尾，切 prefix 后拼 review。`src/core/agent-runtime/execution-preparation.ts:519`、`:548`、`:552`、`:557` | 每个候选重新渲染整份输入、全部区间、digest，再量完整 manifest；不得再切 prefix。 |

调用类允许段仍取当前规则，不要把 K3 复核轮误标成 `callKind: review`：

- `work`：基础七段加 `unknown_call_review`；
- `continuation/handoff`：基础七段加 `continuation`；
- `review`：role、task、reminders；
- `secretary`：role、goal、task、notes、reminders；
- `copy`：role、goal、task；
- `planning`：role、goal、task、footprint；
- `attention`：当前全集去掉 unknown_call_review。

这张表在 `src/core/work-graph/state/context-input.ts:51`、`:65`；所有调用要求 role，work/continuation/handoff 还要求 goal/task。`src/core/work-graph/state/context-input.ts:280`。

还需处理一个与可编辑字符串有关的现存不一致：渲染器从包取省略文字，但守卫写死中文正则和 `## Context omissions`。`src/core/agent-runtime/context-rendering.ts:67`、`src/core/work-graph/state/context-input.ts:60`、`:62`、`:113`。建议守卫核冻结字符串生成的预期标记，不能改了包后仍按旧中文核。

brief 改字的对应现有状态拒绝码是 **`invalid`**，不是配置不符的 `forbidden`。`src/core/work-graph/state/run-machine.ts:1549`、`:1563`。

**6. P8：必须按实际历史选择加提醒**

| 情况 | 当前决定点 |
|---|---|
| LA-1 播种候选 | 排除同 Session、已有 cursor、adapter 不同；从来源窗口找完成边界。`src/core/agent-runtime/context-history-facts.ts:57`、`:66`、`:81`、`:110` |
| 归档来源 | 接续配方跳过播种。`src/core/agent-runtime/context-continuation-recipe.ts:174` |
| K3 播种候选 | 从原 Run 得来源；同 Session 或已有 cursor 不另播种；取完成边界。`src/core/agent-runtime/context-history-facts.ts:121`、`:127`、`:140` |
| Work 最终决定 | **开始时**读当前 Session 完成边界，选择播种、current_turn 或同 Session 历史。`src/core/agent-runtime/execution-driver.ts:670`、`:682`、`:687`、`:689` |
| Query 派生来源 | sessionBasis 当前在输入装配之后才计算。`src/core/agent-runtime/query-preparation.ts:235`、`:249` |
| Query 最终决定 | 有 sessionBasis 时按其边界；没有时开始阶段读当前完成边界。`src/core/agent-runtime/query-execution.ts:473`、`:486`、`:491` |

因此，不能只检查 `continuationBrief`、`sessionBasis` 或 `session.historyCursor` 就加提醒；普通同 Session 复用会漏掉，空播种也可能误加。

建议把已有选择规则整理成共用的历史选择结果，在准备装配角色段前确定并冻结；开始消费同一来源和边界，必要时按已有有效性规则拒绝，不能临时改变已经绑定 digest 的任务输入。这一调整需与 PC-1 一起冻结记录归属。

角色文字入口在 `src/core/agent-runtime/context-work-recipe.ts:84` 和 `src/core/agent-runtime/context-query-recipe.ts:41`，最终 role 槽在 `src/core/agent-runtime/context-rendering.ts:124`。提醒应在最终角色内容末尾追加一次，并计入 role 区间；也要考虑全省略 fallback 会向必填段追加省略信息的路径。`src/core/agent-runtime/context-rendering.ts:159`。

旧句已不在原来的 `continuation-brief.ts:345`：现在位于 **`resources/prompts/platform/templates/continuation-brief.txt:5`**；实际调用模板在 `src/contracts/continuation-brief.ts:407`。PC-2 从模板删除这一行，并新增 `stale-files-reminder` 模板及其槽位表，不在多个调用者分别删句。

**7. P9：声明要对最终 Kernel 工具集合核**

`mentionsTools` 已进入 manifest 类型和生成器，但目前只是数据，没有准备时可用性检查。`src/contracts/prompts/prompt-pack.ts:11`、`scripts/build-platform-prompts.mjs:61`。

最终清单的计算已由 D2 集中：

- Work 组选择：`src/core/agent-runtime/tool-group-assembly.ts:195`。
- Query 图工具：`src/core/agent-runtime/tool-group-assembly.ts:307`。
- review/rerun 组及扩展顺序：`src/core/agent-runtime/tool-group-assembly.ts:342`、`:364`、`:390`。
- 最终 `kernelEnabledToolNames`：`src/core/agent-runtime/tool-group-assembly.ts:428`。
- 实际调用和交给 Kernel 的位置：`src/core/agent-runtime/observed-model-run.ts:276`、`:291`。

不能直接拿 `permissions.tools` 比较：普通分支有 Kernel 名称映射；固定来源分支换成 `read_source`，有 material tools 才加 `read_material`；探索和扩展工具也参与最终集合。`src/core/agent-runtime/tool-group-assembly.ts:437`、`:442`、`:444`。

建议准备和开始共用纯工具选择结果，准备在权限投影、固定来源及扩展能力确定之后、写 manifest 之前，核**本次实际使用模板**的声明。不能对包内所有模板一律核本次清单，否则平台包的 `unknown-call-proposal` 声明 `propose_safer_method` 会影响普通执行。`resources/prompts/platform/pack.json:36`。

基础模板四类期望：

| 最终工具清单 | system 期望 |
|---|---|
| 有 `read` | 出现普通 read 指导 |
| 只有 `read_source/read_material` | 出现相应固定来源指导，不出现普通 read 指导 |
| 没有读文件工具 | 不出现要求调用读文件工具的句子 |
| edit/shell 分别存在或缺失 | 各自句子独立出现或消失 |

迁移源不仅有开头几行：`coding-agent-v5` 后部还提到 edit/shell，必须一并包进工具块。`vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:12`、`:14`、`:15`、`:26`、`:30`。平台 `base.mentionsTools` 应为空，check 那行删除。

平台扫描测试建议复用解析树，只扫描模板字面文本中位于所有工具块之外的部分；按完整工具名边界匹配，不能把 `read_source` 算作 `read`，也不能扫描动态插入的目标或用户文字。已知名集合必须包含 `check`，即使它不被平台启用；保留名表已有它。`src/core/agent-runtime/tool-group-assembly.ts:76`。

工具说明仍有静态模块绑定，例如 record_note、project_source、review 工具。`src/core/agent-runtime/note-tool.ts:188`、`src/core/agent-runtime/project-source-tool.ts:238`、`src/core/agent-runtime/unknown-call-review-tools.ts:213`。PC-1/PC-2 任务书必须明确由谁把合并后的工具文字用于最终 ToolSpec；仅实现用户包读取并不会自动生效。

**8. 测试入口、待补夹具和 §3.3 核对**

现有装置可以用，但不能整份照搬其所有观察手段：

| 入口 | 可用基础 | 要冻结的缺口 |
|---|---|---|
| PE1 | 公开 renderer 在 `src/contracts/prompts/render-template.ts:186`；纯输入渲染样例在 `tests/runtime/S3-context-assembler.test.ts:452` | 新的公开加载/校验口；手写父子小包、坏包、工具块、合法与非法段序包。 |
| PE2 | Host 临时目录、token、settings POST：`tests/app/host-settings.test.ts:98`、`:129`、`:140` | 导出专用 PC Host fixture；独立假数据目录；可预置/破坏包；记录 HTTP 状态及响应。现有 helpers 是该测试文件内局部函数。 |
| PE3 | 假模型记录请求：`tests/helpers/B2-runtime-fixture.ts:71`；真实 prepare/start 装置在 `:171`、`:310`；Host Query 准备样板在 `tests/app/host-settings.test.ts:480` | 注入包选择；暴露 Work/Query 请求；接 PC-1 的 `readPromptRecord`。 |
| PE8 | Work 真实准备：`tests/helpers/K3-35-prepare.ts:58`、`:93`；Query 同上 | 坏包、缺槽值、不可用工具声明，通过准备路径得到拒绝；不能直接调用私有 catch。 |
| PE9 | 状态函数样例：`tests/state/context-input.test.ts:64`、`:100`；入口装置：`tests/work-graph/S3-prepared-context-admission.test.ts:188`、`:525` | 冻结模板正文、sectionOrder、非尾部 brief/review、手算 UTF-8 区间及篡改单字的输入。 |

场景 harness 的 `advance` 默认跑数据库不变量，应在新 PC 用例显式传 `invariants:false`；restart 也有关闭项。不要调用 `counts/kernelSnapshot/manifestOf` 作为新用例验收。`tests/scenarios/harness.ts:626`、`:647`、`:667`、`:937`。prepared manifest 可经公开 `materials/open` 读取，已有 `preparedManifestOf`。`tests/scenarios/support/brief.ts:115`。

逐行测试安排：

| 验收行 | 入口和缺少的夹具 | 期望如何取得 |
|---|---|---|
| PC-01 | PE1；手写含普通槽、整行条件块、edit 工具块的小模板 | 两种工具集合各写完整输出字面值；中文按 UTF-8 手算区间。 |
| PC-02 | PE1、PE8；每个坏包只放一个错误 | 分别固定包 id、模板 id、原因类别；缺文件测试不顺带制造坏 manifest。 |
| PC-03 | PE1＋PE3；子包只覆盖 base | 手列 base 来自子包，其余使用模板来自 platform；经 `readPromptRecord` 验来源。 |
| PC-04 | PE2＋PE3；可保存的假数据目录、前后两次 prepared | 版本例如 7→8；旧 7 再存冲突；无效保存前后字节相同；已准备发旧文字，新准备发新文字。 |
| PC-05 | PE2＋PE3；两个模型绑定两个小包 | 用不同字面标记区分 A/B；缺省执行为 platform/current_run，设置读口仍不补字段。 |
| PC-18 | PE3；新 Session、LA-1、普通复用；加 K3 和 Query 同规则覆盖 | 提醒次数分别 0/1/1；在 role 末尾；四预算段全省略仍为 1；brief 中为 0。普通复用样板在 `tests/runtime/B2-runtime-execution.test.ts:487`。 |
| PC-19 | PE8；base 块外声明 check 的小包；平台扫描 fixture | 准备 `invalid`，原因含 base/check；平台扫描结果与手列声明集合相等。 |
| PC-20 | PE3；四类最终工具组合 | 对照手列句子集合与假模型收到的工具名字，不用生产选择函数生成期望。 |
| PC-21 | PE3＋PE9；v2、另一合法顺序、非尾部 brief、真正触发收缩的 K3 输入 | 完整文字和区间独立累计；提醒收缩前后逐字节相同；改 brief 单字回现有码。K3 装置可沿 `tests/runtime/K3-review-preparation.test.ts:76`、`tests/scenarios/K3-42-unexpanded-r2.test.ts:141`。 |
| PC-22 | PE2＋PE8；角色非首、非法段、重复段各一个包 | 保存和准备都拒绝；不从 renderer 的错误字符串反推期望。 |
| PC-23 | PE2；设置目录在配置工作区内、在恢复工作区内、打开其祖先、无关目录 | 前两者启动失败，祖先打开 `invalid`，无关目录成功；目录关系由 fixture 明确构造。 |

两个可直接写进夹具说明的手算例子：

- 区间小样 `角\n\n目\n\n任\n\n复\n\n提` 共 23 字节，五段分别 `[0,3)`、`[5,8)`、`[10,13)`、`[15,18)`、`[20,23)`。把复核文字换成两个“复”时，其区间变 `[15,21)`，提醒变 `[23,26)`；缩回后提醒正文不变。真实 K3 测试按冻结的完整字面正文同样累计，不调用生产 renderer 生成 expected。
- 预算小包用单字节标签 F/N/M/I，前三行分别 f/n/m，输入行十个 I，省略文字为 `omit 1`。四段全保留计费 29 字节；保留 F/N/M、输入只留省略文字计费 25 字节；预算 25 时保留提醒、略输入，即使展示把提醒排最后。当前算法会遍历所有前缀，正好能覆盖“更短前缀因省略标记反而更长”的情况。算法依据为 `src/core/agent-runtime/context-rendering.ts:94`、`:115`。

§3.3 当前清单核对结果：

- **删旧句三处仍在**：`tests/contracts/A2-rework-contract-helpers.test.ts:398`、`tests/runtime/K3-15-blocked-sentence-pure.test.ts:52`、`tests/runtime/K3-35-renderer-boundary-pure.test.ts:39`。
- **CA01/CA12 仍在原位置**：整段旧文字在 `tests/runtime/S3-context-assembler.test.ts:459`，断言在 `:600`、`:813`、`:830`、`:832`。
- **I-19 尾部假设仍在**：`tests/state/invariants.ts:1863`、`:1864`；期望文字在 `tests/state/invariants.test.ts:1372`、`:1380`。不只改断言：其 manifest 投影目前没有段绑定和冻结正文信息，也要补够核验材料。`tests/state/invariants.ts:222`、`:525`。
- **手写绑定 grep 命中与规格相符**：WP1 fixture `:516`；K3 trim `:232`；K3 section `:55`；场景 S3 `:105`；state context-input `:88`；state WP1 `:56`；prepared admission `:188`。S3 assembler `:58`、`:608` 是格式常量引用，不是额外漏列的手写 manifest。
- **review 尾部假设明确存在**：`tests/runtime/K3-35-manifest-trim-pure.test.ts:213`、`:248`、`:269`；`tests/runtime/K3-review-preparation.test.ts:209`；`tests/runtime/K3-unknown-call-review-section.test.ts:63`。
- **清单有些文件只是相关覆盖**：`tests/runtime/K3-review-input-pure.test.ts:190` 是纯收缩计量；`tests/scenarios/K3-42-unexpanded-r2.test.ts:199` 核收缩结果；`tests/scenarios/K3-12-14-review-round.test.ts:161`、`:222` 核工具和复核结果。不能因为列在清单里就无差别重写断言。
- **发现漏列**：`tests/scenarios/C3-brief-idempotency.test.ts:80` 和 `:198` 明确要求 brief 是 input 后缀。当前场景若没有尾部提醒可能仍通过，但已经锁住 P10 不再保证的性质；应报 lead 补进白名单，再改为区间核。该文件还通过 SQL helper 取 manifest/turn，不能作为新 PC 用例的读取方式。`tests/scenarios/C3-brief-idempotency.test.ts:74`、`:196`。
- 第二条“inputDigest 与 manifestDigest”检索仍覆盖规格列出的十个文件，没有额外 PC-2 漏项；其中 WP1、context-input、S3 admission 等与 PC-1 共用，须顺序交接。对应入口例如 `tests/helpers/B2-execution-fixture.ts:240`、`tests/helpers/S2C-X-scale-fixture.ts:448`、`tests/helpers/WP1-units-fixture.ts:527`、`tests/state/run-machine.test.ts:88`、`tests/work-graph/C2-mailbox-admission.test.ts:62`。

上述 PC-2 测试文件均仍存在；没有需要追到已删除旧 UI 的条目。

**9. 规模、互斥分组和 PC-1 交接**

以下估算包含生产代码、Codex 夹具、DSH 测试、必要旧断言更新和平台生成文件；不含 PC-1 的 Kernel、冻结存储、请求记录工作，也不含 E3 界面。是任务书预算，不是实际 diff。

| 子部分 | 加 | 删 |
|---|---:|---:|
| P1：加载继承、校验、目录隔离、编辑及测试 | 1,830 | 170 |
| P2：设置和直接绑定、选择及测试 | 480 | 60 |
| P10：段序、区间、守卫、入口、收缩及测试 | 1,550 | 570 |
| P8：历史选择接线、提醒及测试 | 680 | 130 |
| P9：最终工具核对、base、扫描及测试 | 550 | 100 |
| 合计 | **5,090** | **1,030** |

建议六组，按**文件归属**分，不按 P 编号硬拆；否则 `host-settings.ts`、renderer 和 preparation 会被多组同时改。

| 组 | 唯一文件归属与交付 | 加/删/合计 |
|---|---|---:|
| G1 包的纯接口 | `src/contracts/prompts/` 的非生成文件、`src/contracts/graph-context.ts`；新增纯加载/校验模块、PE1 测试、手写包 fixture。冻结有效模板来源、问题、段序接口。现有入口：`prompt-pack.ts:22`、`render-template.ts:186`、`graph-context.ts:104`。 | 950/100/**1,050** |
| G2 设置和磁盘服务 | `src/app/host-settings*.ts`、`src/app/server.ts`；新增 Host 包仓库/编辑服务、路由 fixture 和 PE2 测试。两项模型字段的持久化也在本组。入口：`host-settings.ts:436`、`server.ts:329`。 | 990/50/**1,040** |
| G3 Host 接线 | `src/app/host.ts`、`src/app/runtime-configuration.ts`；新增选择/目录隔离 Host 测试。独占启动、恢复、打开根检查及模型传递。入口：`host.ts:315`、`:869`、`runtime-configuration.ts:386`。 | 800/100/**900** |
| G4 模板及上下文装配 | `context-rendering.ts`、`context-types.ts`、相关 `context-*-recipe.ts`、`context-history-facts.ts`；平台资源、生成模块、生成器与资源清单；S3 renderer 测试及三份删旧句测试。冻结完整重渲染材料与角色提醒规则。入口：`context-rendering.ts:80`、`context-types.ts:42`。 | 930/260/**1,190** |
| G5 守卫及入口 | `state/context-input.ts`、`tasks/execution-entry-service.ts`；PE9、I-19、WP1/S3 手写绑定等相关旧测试；经 lead 增列后含 C3。入口：`context-input.ts:178`、`execution-entry-service.ts:1190`。 | 650/280/**930** |
| G6 准备至实际请求 | `execution-contracts.ts`、Work/Query preparation、driver/execution、`observed-model-run.ts`、`tool-group-assembly.ts`；K3 收缩相关旧测试、新 PE3/PE8 联合验收与平台工具扫描测试。入口：`execution-preparation.ts:519`、`query-execution.ts:473`、`tool-group-assembly.ts:428`。 | 770/240/**1,010** |

组间顺序建议 G1→G2→G3→G4→G5→G6。每个旧测试文件只归一组，例如 K3 manifest-trim/review-preparation 归 G6，K3 section 守卫归 G5，S3 assembler 归 G4。Codex 先冻结 fixture 文件，后续组消费它们，不各自继续修改同一 fixture。

需要在第一组开工前冻结的接口：

- `resolvePack` 的来源、合并结果、问题格式，以及模板到调用类的映射。
- Host 包服务的 list/create/read/save DTO、CAS 语义和提交点。
- PC-1 的有效模型选择与 PromptSet 输入。
- 历史选择结果：mode、来源 Session、完成边界及保存位置。
- 最终工具选择结果，准备和执行复用。
- 完整输入重渲染材料：冻结包、非 review 槽值、预算选择结果；替换 review 后返回全文和全部区间。
- 状态守卫接收冻结段序、冻结标记和重渲染正文的方式。

PC-1 与 PC-2 明确重叠的文件包括 runtime 配置契约、两类 preparation、两类 execution、`observed-model-run.ts`、输入绑定契约、brief/review renderer、平台资源及生成文件；对应现有接点为 `src/core/agent-runtime/execution-contracts.ts:129`、`execution-preparation.ts:525`、`query-preparation.ts:255`、`observed-model-run.ts:245`、`src/contracts/continuation-brief.ts:407`、`src/contracts/core/prepared-execution.ts:161`。这些应由 PC-1 先落地接口，再由 PC-2 顺序修改，不并行占有。

**规格引用的 F1–F22 当前定位补表**

| 事实 | 当前定位及变化 |
|---|---|
| F1 | 基础提示词仍在 `vendor/coding-agent/dist/app/prompts/coding-agent-system-prompt.js:2`、`:12`；check 实现在 `vendor/coding-agent/dist/tools/builtin/check/check-tool.js:96`。最终清单从原 observed 引用移到 `src/core/agent-runtime/tool-group-assembly.ts:428`。 |
| F2 | Kernel system 顺序仍在 `vendor/coding-agent/dist/core/context/builder/context-builder.js:25`；Host 后加说明移到 `src/core/agent-runtime/observed-model-run.ts:257`。 |
| F3 | 同步回调仍是 `vendor/coding-agent/patches/app/composition/composition-root.ts:117`、`:423`；首次 Skill 读取在 `:415`，恢复在 `vendor/coding-agent/patches/app/composition/resume-composition.ts:311`、`:318`，固定 base 在 `:406`。root `:330` 当前是已有 Turn 转恢复分支。 |
| F4 | `vendor/coding-agent/dist/core/context/types/context-types.js:50`；`vendor/coding-agent/dist/skills/loader/file-skill-loader.js:78`；包装 source 在 `vendor/coding-agent/dist/core/context/builder/context-builder.js:20`；配置契约在 `vendor/coding-agent/patches/app/composition/composition-contracts.ts:24`。 |
| F5 | 原 assembler 行号失效，现为 `resources/prompts/platform/templates/work-input.txt:3`、`src/core/agent-runtime/context-rendering.ts:37`、`src/core/agent-runtime/context-work-recipe.ts:265`。 |
| F6 | 原 assembler 预算段移到 `src/core/agent-runtime/context-rendering.ts:80`、`:94`、`:115`。 |
| F7 | 守卫关键位置仍为 `src/core/work-graph/state/context-input.ts:44`、`:197`、`:255`、`:282`、`:294`；入口 `src/core/work-graph/tasks/execution-entry-service.ts:973`、`:1201`；CA12 `tests/runtime/S3-context-assembler.test.ts:813`。 |
| F8 | 仍在 `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:666`、`:679`、`:686`、`:687`。 |
| F9 | 当前删组识别在 `vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:30`；实际类别删除顺序在 `:123`、`:126`、`:131`、`:136`。补丁清单仍看 `scripts/build-kernel-patch.mjs:13`。 |
| F10 | Kernel 估算在 `vendor/coding-agent/dist/core/context/selection_policy/context-selection-policy.js:9`；hook 复核仍在 `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:714`；平台计量在 `src/core/agent-runtime/model-budget.ts:82`。 |
| F11 | DeepSeek 思考仍在 `vendor/coding-agent/dist/model/providers/deepseek/deepseek-model-client.js:28`；合法消息记录在 `vendor/coding-agent/dist/core/runtime/loop/model-stream-consumer.js:137`、`vendor/coding-agent/dist/core/runtime/state/run-state.js:130`。 |
| F12 | 结果结构在 `vendor/coding-agent/dist/core/ports/tool_executor/tool-executor-port.js:53`；整结果序列化现为 DeepSeek `deepseek-model-client.js:44`、OpenAI `openai-model-client.js:43`。 |
| F13 | Query 历史选择移到 `src/core/agent-runtime/query-execution.ts:473`。 |
| F14 | Work 选择移到 `src/core/agent-runtime/execution-driver.ts:670`；归档排除移到 `src/core/agent-runtime/context-continuation-recipe.ts:174`；图历史分支仍在 `src/core/agent-runtime/graph-tools.ts:358`，Session 卡工具仍在 `src/core/agent-runtime/session-discovery-tools.ts:139`。 |
| F15 | “文字写在业务源码里”已改变：初始化指导取静态模板于 `src/core/agent-runtime/query-preparation.ts:51`；白板工具取工具表于 `whiteboard-tools.ts:432`；project_source `project-source-tool.ts:238`；note `note-tool.ts:188`；brief `src/contracts/continuation-brief.ts:407`；角色 `role-profiles.ts:23`；review/proposal `src/contracts/core/prepared-execution.ts:161`、`:188`；review 工具 `unknown-call-review-tools.ts:213`；rerun `command-rerun-tools.ts:207`；咨询 `src/business/workflow/consultation.ts:449`；答复前缀 `execution-inputs.ts:61`。它们仍绑定静态平台包。 |
| F16 | Work 记录入口移到 `src/core/agent-runtime/observed-model-run.ts:245`；许可投影 `src/core/agent-runtime/model-call-access.ts:77`、`:88`，服务投影 `src/core/work-graph/tasks/model-call-service.ts:146`，codec `model-request-codecs.ts:81`；Query 重写仍在 `src/core/work-graph/queries/query-execution.ts:1310`，admitted 在 `:1393`；类型 `src/contracts/query-job.ts:358`。 |
| F17 | Work 存 manifest 仍为 `src/core/agent-runtime/execution-preparation.ts:561`；Query 移到 `src/core/agent-runtime/query-preparation.ts:284`；body 去重在 `src/core/record-store/body-store.ts:27`、`:36`。 |
| F18 | 固定来源读工具移到 `src/core/agent-runtime/tool-group-assembly.ts:442`。注意 read_material 有条件，不是总有。 |
| F19 | Work 配置拒绝当前为 `src/core/agent-runtime/execution-driver.ts:574`，恢复 busy 在 `:393`；Query 已进入观察和配置拒绝在 `src/core/agent-runtime/query-execution.ts:176`、`:202`。 |
| F20 | 模型字段仍在 `src/app/host-settings-types.ts:10`；DeepSeek 窗口分支在 `src/app/host.ts:261`。 |
| F21 | Skill 清单现为 `runtime-assets.json:47`、`:51`；目录接口和解析仍为 `src/app/runtime-configuration.ts:58`、`:373`；测试仍为 `tests/runtime/W2-role-skills.test.ts:33`、`tests/app/AG6-agent-assembly.test.ts:178`。 |
| F22 | 公开导出仍在 `vendor/coding-agent/dist/public-api.d.ts:33`、`:40`。 |

**规格与当前树不一致、或仍需选择的点**

1. **D3 不是用户包加载器。** `extends`、来源追踪、加载时完整校验都未实现；不能把生成器当作运行时 resolver。建议按第 2 项分成异步 Host 读取和纯解析两层。`src/contracts/prompts/prompt-pack.ts:22`、`scripts/build-platform-prompts.mjs:41`。
2. **必填“出现一次”尚未实现。** 当前只查值非空；同时 P1 的“不能加减槽位”和只要求必填出现之间有空隙。建议冻结“输入模板的段槽必须保留，运行时可为空；其他模板遵照明确的必填表”。`src/contracts/prompts/render-template.ts:203`。
3. **条件块的重复计数需要写清。** `{{#x}}{{x}}{{/x}}` 当前会被视为重复；必填段放在可能关闭的工具块里也不能保证出现。建议保留 D3 语义，并要求输入段槽为顶层、不可被工具条件隐藏。`src/contracts/prompts/render-template.ts:121`。
4. **一份 work-input 同时含 continuation 和 review 槽，但调用类不同时允许两者。** 建议从模板顺序按调用类允许段投影，运行时拒绝不允许的非空段；不能把两个槽同时存在直接判成坏平台包。`src/contracts/prompts/slot-tables.ts:17`、`src/core/work-graph/state/context-input.ts:66`。
5. **“只认人”缺明确执行点。** 建议可信 Host actor 检查，不把 token 等同于人类身份，不接受请求体声明。`src/app/host-settings-types.ts:109`、`src/app/core-http-types.ts:118`。
6. **编辑协议未定完整。** 需定 create/list/read DTO、包已存在时的码、继承模板首次覆盖版本，以及包级错误的 templateId 表示。建议分别用 `invalid`、有效父版本加一、包级 `templateId:null`。
7. **多文件原子提交未定。** 建议不可变版本正文加 manifest 原子切换；外部手改不保证遵守版本号，因此每次准备仍重新校验。现有单文件保存不能直接提供两文件原子性。`src/app/host-settings.ts:505`。
8. **文件边界和继承合并未定。** 建议限制包 id、拒绝越界/外指文件、拒绝继承环；字符串按键覆盖，工具按完整条目覆盖。生成器当前直接 resolve 文件名。`scripts/build-platform-prompts.mjs:63`、`:69`。
9. **直接绑定缺“模型项 id”。** 建议设置模型显式传 settings id，直接配置使用明确约定的 binding id，不能从 revision 字符串拆。`src/app/runtime-configuration.ts:46`、`src/app/host.ts:667`。
10. **历史选择晚于输入冻结。** 建议与 PC-1 一起冻结准备时来源和边界；不能开始时补提醒而不更新绑定，也不能仅凭 sessionBasis 判断。`src/core/agent-runtime/execution-driver.ts:670`、`src/core/agent-runtime/query-preparation.ts:249`。
11. **最终工具清单当前在执行侧才形成。** 建议准备和执行共用纯选择结果；声明可用性只查本次使用模板，平台静态扫描则覆盖全部模板。`src/core/agent-runtime/observed-model-run.ts:276`、`resources/prompts/platform/pack.json:36`。
12. **段序之外还有预算和标记耦合。** 必须同时改固定 push、residentBytes 首尾差和守卫硬编码省略文字。`src/core/agent-runtime/context-rendering.ts:190`、`:218`、`src/core/work-graph/state/context-input.ts:60`。
13. **工具文字、角色及事实标签仍静态绑定。** 建议 PC-1 明确交付冻结文字的消费接口；PC-2 在其上选包，不另铺第二套全局可变包。`src/core/agent-runtime/role-profiles.ts:23`、`src/core/agent-runtime/note-tool.ts:188`。
14. **§3.3 漏 C3 两个后缀断言。** 建议 lead 增列后再修改；现有 K3 pure manifest 还把含 unknown_call_review 的绑定写成 `callKind:review`，新 PE9 fixture 应使用真实 Work 类。`tests/scenarios/C3-brief-idempotency.test.ts:80`、`:198`、`tests/runtime/K3-35-manifest-trim-pure.test.ts:232`。
15. **现有场景装置含 SQL 观察，不能直接作为新 PC 验收口。** 建议冻结专用 fixture，关闭自动不变量，使用请求捕获、公开材料读口和 PC-1 记录读口。`tests/scenarios/harness.ts:667`、`tests/scenarios/support/brief.ts:115`。
16. **规格原总量 3,000–4,000 行不足以覆盖当前两片的完整施工面。** 本次估算仅 PC-2，已包含上述必要夹具、旧断言和生成物；建议按六个文件互斥组重新下任务书，不沿用原总量压缩必需项。

PC-2 估计：加 5090、删 1030