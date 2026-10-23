本次仅作静态只读审查，未运行测试、构建或联网。发现 **1 项夹具错误、12 项验收违规**；未发现 J 的 allowlist 修改需要撤回，也未发现三份旧 PC-1 测试被放宽。

下文“任务书”指 `.lead-ref/books/pc2-book.md`，“回信”指 `.lead-ref/replies/pc2-reply.md`。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| J-01 | 违规 | `tests/runtime/PC2-joint-packs.test.ts:120`；`tests/app/PC2-H-settings-model.test.ts:20` | 任务书 `:834`，PC-05；裁定 7 `:287` | 没有“两个**设置模型**各选自己的包后执行”的联通用例。联合测试直接给绑定 A/B；H 测试只读设置。省略字段及重启后，也没有真实准备所得 `platform/current_run` 断言。启动目录中的模型原本没有这两个字段，不能检出“启动目录恢复旧值”的变异。 | 用现有 Host 夹具，经 `models/save`、`models/select` 后真实准备、启动并读记录；分别断言 A/B。另以启动目录已有非默认值为前提，省略保存、重启，再断言设置无字段、执行冻结为 `platform/current_run`。 |
| J-02 | 违规 | `tests/runtime/PC2-joint-packs.test.ts:138` | 任务书 `:840`，PC-06/08 设置半边；规格 `slice-6-7-PROMPTS-SPEC.md:430` | 注释称“设置模型改变”，实际是 `installBinding` 把 **modelId A 换成 B**，没有保存同一模型的新包。即使 Host 的设置保存完全不传递 `promptPack`，此例仍可通过。 | 保持同一个 modelId，经 Host `models/save` 把包 A 改为 B；旧准备启动断言 A，新准备启动断言 B。现有 Host 夹具足以承载，不需生产接缝。 |
| J-03 | 违规 | `tests/runtime/PC2-joint-packs.test.ts:97`、`:102`、`:111` | 任务书 `:839`；运行单 `run-pc2.md:67`、`:72`；规格 `:427` | `base` 比较完整，但标签冻结只检查拼接消息是否包含 `CHANGED ROLE`。旧标签丢失、任务输入其他字符改变，仍可能通过；没有本例冻结正文的手算 digest。 | 将开始后当前任务输入与手写完整旧正文比较，新准备与完整新正文比较；经 `readPromptRecord` 核相应正文及字面正文的 SHA-256。 |
| J-04 | 会出错 | `tests/helpers/PC2-pack-fixture.ts:411`、`:415`、`:427` | 任务书 §5.1 `:809`、PC-18 `:848` | Query 历史夹具确有错误：组合层在 `src/composition/create-platform.ts:1511` 展开复制 `runtime.port`，在 `:1774` 交给 Workflow；夹具随后 spy 原 port，拦不到复制对象中的方法。调用 `openPC2QueryHistoryFixture()` 本应返回派生/复用 Query 句柄，却会因捕获为空在 `:429` 抛错。 | **由 lead 修订并重新冻结夹具**：在创建平台前捕获 `createWorkflow` 收到的 `deps.runtime`，随后 spy 该对象的 `startQuery`，并以同一对象保存原调用。再补派生 Query 和无 basis 的复用 Query 的真实准备、启动用例。 |
| J-05 | 违规 | `tests/runtime/PC2-joint-history.test.ts:63`、`:90` | 任务书 PC-18 `:843` | 只有新 Session 和同 Session 接续，没有 LA-1 非空播种的提醒计数 1。`continuation()` 固定复用原 Session，见 `tests/helpers/PC-platform-fixture.ts:477`；这不等于公开接口不可达。仅删掉 Work 非空 seed 分支，联合测试不会发现。 | 在现有夹具内走公开步骤：结束首个 Run、`requeueTask`、公开 `runtime.createSession` 创建同角色新 Session、带 requeue 领取、准备和启动；断言历史前缀及提醒 1。新 Session 接口在 `src/core/agent-runtime/ports.ts:40`，领取 helper 可接受另一 Session，见 `tests/helpers/WP2-platform-support.ts:895`。 |
| J-06 | 违规 | `tests/runtime/PC2-joint-history.test.ts:128`、`:136` | 任务书 PC-18 `:848`；规格 P8 `:226` | 标题说 K3 seed “提醒一次”，实际明确断言 `throughPosition:null`、`takesSessionHistory:false`、提醒 0。这只能验证空基线，不能验证 K3 真正接历史时的提醒。源 Run 在新 Session 中直接阻塞，见 `tests/helpers/B2-crr-world.ts:141`、`:149`。 | **由 lead 补冻结夹具的非空前缀模式**：先在源 Session 公开执行一轮并结束，再在同 Session 建阻塞 Run，随后领取新 Session 的复核轮；测试准备及开始后的历史前缀和提醒 1，保留现有空基线例。 |
| J-07 | 违规 | `tests/runtime/PC2-joint-history.test.ts:80`、`:86`、`:111`、`:139` | 任务书裁定 14 `:456`、`:459`；PC-18 `:846`；运行单 `:67` | 没有验证“assembly 内只决定一次、Q 原样冻结”，也没有观察有 basis 的 Query 不读边界、无 basis 的 Query 读真实边界。另行调用纯函数不能证明生产准备走了它；`:88` 的期望位置还取自生产边界结果。重复计算或无条件读边界的变异均可漏过。 | 由 lead 冻结只转发的调用观察包装，记录准备期间的 assembly、规则调用及边界读取；经公开 prepare 分别断言次数、参数和冻结结果，位置期望写手算值。将独立纯函数调用留在纯测试，不充当联通证据。 |
| J-08 | 违规 | `tests/runtime/PC2-joint-history.test.ts:150` | 任务书 PC-18 `:844`；规格 `:457`、`:459` 指定 PE3 | “四个预算段都省略仍在角色末尾”只调用 `renderContext`，没有准备到模型请求的例子。真实准备若丢掉 `takesSessionHistory`，此例仍通过；同 Session 例也在 `:93` 没有启动接续 Run。 | 补真实准备和启动例。最小夹具扩展是给 `PCOptions` 增加并透传 `contextResidentBytes`；WP2 已支持该输入，见 `tests/helpers/WP2-platform-support.ts:96`、`:735`。以公开步骤造四段材料、预算置零，完整比较角色/当前输入并核四段省略。夹具修改由 lead 冻结。 |
| J-09 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:57`、`:61` | 任务书 PC-20 `:855`；§5.1 `:816` | `read+edit+shell` 的 prepare→request 被纯渲染替代。夹具限制属实，且不止 `writeScope:[]`：Role 写权限为 `none`，Host 还没有 `shellWorkspaceAccess`，见 `tests/helpers/WP2-platform-support.ts:560`、`:734`。生产在 `src/core/agent-runtime/execution-preparation.ts:424` 会拒绝 shell。 | **由 lead 修订夹具授权配置**：透传明确的写权限选项，同时生成 Role 的 `writeScope:'workspace'`、Host 的 `writeScope:['.']` 和 `shellWorkspaceAccess:'all_except_denied'`，再通过 `tools` 跑三工具准备、启动，断言完整 system 和实际工具名单。仅补 `writeScope` 不够；涉及 WP2 文件须补白名单裁定。 |
| J-10 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:76`；`tests/runtime/PC2-T-render.test.ts:51`、`:64` | 任务书 PC-20 `:854`；裁定 10 `:322` | 缺少能区分工具清单的“实际使用 Skill 和 continuation brief”例。联合测试禁用 Skills；T 的 Skill 例给 read/edit/shell，而该模板的块是 look_graph/find_graph/record_note；brief 模板根本没有工具块，见 `resources/prompts/platform/templates/continuation-brief.txt:1`。把这两处传入清单固定为 `[]` 可漏过。 | 在 J 新例中用 `pc2PackEntry` 提供含 `read` 块的 Skill 和 brief，通过 read/无 read 两种公开准备与接续启动，完整比较输出。无需改生产或冻结夹具，也无需给 `read_source` 新权限。 |
| J-11 | 违规 | `tests/runtime/PC2-joint-shrink-entry.test.ts:39`、`:72`、`:101` | 任务书 PC-21 `:861`；规格 `:465`；运行单 `:67` | 三块证据没有连起来：纯重渲染例的 review 在末尾；49 字节例有尾部 reminders，但未走 K3；入口例走的是 continuation。没有真实 K3 收缩后的提醒全文、两段手算范围及成功入口。Q 的旁证也只用生产 renderer 生成期望，且不启动，见 `tests/runtime/PC2-review-shrink.test.ts:39`、`:42`。此外联合 `:69` 用另一生产输出作期望。 | 用现成 `openPC2ReviewFixture('shrink')` 补一条完整链：证明实际发生收缩，比较手写 review、尾部提醒、手算范围/总字节及省略数据，然后调用其 `start()` 通过入口。保留纯预算例，但把 `:69` 改为字面值或删除这条重复断言。 |
| J-12 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:134`、`:171`、`:178`、`:202` | 任务书 PC-26 `:909`；裁定 20 `:684` | Query 没有在准备后再次改包；Work 恢复例只选择 read/list_files，改变的 `record_note` 从未注册，也没有恢复后的断言。**Work 准备后改包再启动已由 Q 例覆盖**，见 `tests/runtime/PC2-tool-texts-freeze.test.ts:55`，不重复报缺。 | Query 保留可变 source，prepare 后替换工具正文再 start，断言旧 `list_files.prefix`；Work 恢复例加入 `record_note`，并断言开始及恢复仍发送准备时的两项正文。现有夹具足够。 |
| J-13 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:124`、`:127`、`:160` | 任务书 PC-26 `:910`；运行单 `:72`；规格 `:191` | Work 的 `toolSpecsRef` 正文只查两个子串；Query 完全没调用 `readPromptRecord`。把 prefix 描述放进另一工具、夹杂多余正文，或仅让 Query 记录错误，都可能通过。 | Work、Query 都在执行后读 `readPromptRecord`，将 `toolSpecsRef` 对应正文与手写完整规范 JSON 比较，并核该字面 JSON 的 SHA-256；不要从捕获请求生成期望。 |

逐条覆盖情况如下。

| 行及要求 | 已有公开步骤、字面期望与缺口 |
|---|---|
| **PC-03：其余模板继承平台** | A 的纯测试完整比较模板和来源表，`tests/contracts/PC2-resolve-pack.test.ts:207`、`:211`；期望表为手写，`:138`、`:165`。 |
| **PC-03：冻结集来源及版本** | prepare→start→`readPromptRecord`，`tests/runtime/PC2-joint-packs.test.ts:51`、`:56`；完整 system=`CHILD`，冻结模板为 `work-input/platform/2`、`base/pc2-child/8`，`:55`、`:63`；work-input 全文比较在 `:71`。该联合例只使用这两个模板，不能抓住“仅冻结 continuation 来源时写错”的变异。 |
| **PC-04：保存、拒绝及读回** | H 例覆盖版本 7→8、文件快照、`invalid`、`revision_conflict`、未知对象及 broken list，见 `tests/app/PC2-H-pack-routes.test.ts:40`、`:73`、`:94`、`:110`、`:129`。 |
| **PC-04：prepared vs new** | `tests/app/PC2-joint-routes-prepare.test.ts:55` 先准备，`:58`、`:63` 经路由保存，`:73` 旧启动断言 `PC2_OLD_BASE/PC2_OLD_NOTE`，`:80` 新准备启动断言 `PC2_NEW_BASE/PC2_NEW_NOTE`。digest 来自 `:21`、`:22` 的字面 JSON。此项 **OK**；只改 Query 的冻结读取不会被这个 Work 例抓住。 |
| **PC-05：A/B 两模型执行** | A/B 字面标记和记录已有，`tests/runtime/PC2-joint-packs.test.ts:143`、`:147`、`:153`、`:157`；但没有设置路由到执行的链路：**J-01**。 |
| **PC-05：无字段、重启仍默认** | 设置无字段的读取已有，`tests/app/PC2-H-settings-model.test.ts:28`、`:62`、`:71`；真实 resolve 默认及启动目录旧值反例缺失：**J-01**。会漏掉 `settingsModelBinding` 不传选包、或只在 resolve 恢复旧值的变异。 |
| **PC-06/08：人的包及字符串改变** | prepare→source.change→start→新准备，`tests/runtime/PC2-joint-packs.test.ts:94`、`:97`、`:99`、`:106`；base 字面比较正确，任务输入冻结证据不足：**J-03**。 |
| **PC-06/08：设置改变同一模型的包** | 只有 registry 换 modelId，未走设置保存：**J-02**。 |
| **PC-18：0/1/1** | 新 Session 的 false/0 在 `tests/runtime/PC2-joint-history.test.ts:75`；同 Session 的 true/1 在 `:94`；LA-1 的 1 缺失：**J-05**。 |
| **PC-18：角色末尾、预算全省略、brief 无旧句** | 同 Session 按角色范围计数和尾部检查在 `:96`、`:102`；全文旧句总数 1、角色内 1，配合 brief 存在，能排除 brief 再带一句，`:104`、`:105`。预算全省略只有纯例，虽完整字面输出及 `[5,71)` 正确，仍缺 PE3：**J-08**。 |
| **PC-18：决定一次、K3、Query、边界读取** | 分别为 **J-07、J-06、J-04**。无 basis 的当前 Query 只验证空历史，`:111`；有 basis 的 Query 联通例不存在。 |
| **PC-20：四组纯渲染** | 四个完整 base 字面期望在 `tests/runtime/PC2-T-render.test.ts:39`、`:43`、`:47`、`:51`。Skill/brief 的清单敏感性不足：**J-10**。 |
| **PC-20：三组 prepare→request** | read→`ARZ`、search→`AZ` 在 `tests/runtime/PC2-joint-tools.test.ts:65`、`:80`、`:83`；三工具→`ARESZ` 只有纯调用，`:61`：**J-09**。准备强行添加 read 会被 `AZ` 抓住；仅丢 edit/shell 的联通变异不会。 |
| **PC-21：材料、预算、顺序、入口** | 纯重渲染完整文本、范围 `[5,14)`、`[16,19)`、`[21,36)` 在 `tests/runtime/PC2-joint-shrink-entry.test.ts:59`、`:62`；49 字节预算和重渲染 65 字节在 `:82`、`:94`；另一合法顺序、non-tail ready、改字 invalid 在 `:103`、`:106`、`:117`。真实 K3 收缩联通缺失：**J-11**；在 preparation 的 shrink 接线处恢复旧切前缀，会漏过这些联合例。 |
| **PC-26：请求正文及冻结 digest** | Work 两工具描述/参数在 `tests/runtime/PC2-joint-tools.test.ts:108`；digest 为 `sha(NOTE_BODY/LIST_BODY)`，`:117`；Query 权限、digest、描述及 prefix 在 `:155`、`:158`、`:163`。字面 JSON 定义在 `:41`、`:42`，不是从生产包取期望。 |
| **PC-26：再改包、恢复、记录、存储失败** | 冻结矩阵缺口 **J-12**；完整记录缺口 **J-13**。仅工具正文 content type 的 put 失败→`unavailable` 已覆盖，`:229`、`:236`；夹具按 content type 精确分流，`tests/helpers/PC-platform-fixture.ts:183`。漏存工具条目的变异会被 digest/正文及失败用例抓住。 |

夹具裁定及最小修补边界：

- **Query 捕获：回信 §1.3、§8.5 成立。** 精确原因是 **port 被展开复制后才安装 spy**，不是缺少 Query 生产入口。最小补丁是 J-04 所述，在 `createWorkflow` 工厂处捕获真正的接收对象；不改 `src/composition/create-platform.ts`。
- **`openPC2ReviewFixture('empty')`“不可用”：不成立。** 它本来就是 PE8 空必填槽注入：`tests/helpers/PC2-pack-fixture.ts:335`、`:348`；`writtenLines` 在没有结论时取 `k3.none`，`src/contracts/core/prepared-execution.ts:136`，而该槽必填，`src/contracts/prompts/slot-tables.ts:54`。返回 `invalid` 正是任务书 `:185`、`:810` 要求的行为；**不应把空串改成非空来修它**。
- **LA-1“冻结夹具没有现成模式”：成立；“无法按规则覆盖”：不成立。** `continuation()` 的便捷路径固定同 Session，但暴露的公开平台接口允许 J-05 的新 Session 路径；历史来源由生产状态函数派生，`src/core/work-graph/state/task-failure.ts:538`，异 Session 才产生 seed 的检查在 `src/core/agent-runtime/context-history-facts.ts:138`。无需手写 seed 或数据库事实。
- **K3 非空 seed：当前封装确实不给这个场景。** `openPCK3ReviewFixture` 直接创建 pending review，`tests/helpers/PC-platform-fixture.ts:561`；其源 Run 从新 Session 第一轮就阻塞。最小扩展应增加“先完成一轮，再同 Session 阻塞”的夹具模式，不能伪造 `sessionBasis`。
- **read/edit/shell 限制：成立，但回信原因不完整。** 必须同时补 Role 写权限、Host 写范围及 shell 授权；生产拒绝条件见 J-09。这个行有真实产品路径，不属于“任何公开路径都无法承载”。
- **无 read 使用 `['search']`：成立且合规。** 任务书 `:855` 要求“无 read 工具”，未要求权限数组为空；本例通过权限输入和真实启动比较 `AZ`，`tests/runtime/PC2-joint-tools.test.ts:67`、`:80`。

旧测试与 allowlist 的结论：

| 项目 | 结论及证据 |
|---|---|
| `PC-joint-budget-removal` | **未放宽。** 唯一变更是 `tests/runtime/PC-joint-budget-removal.test.ts:36` 的完整输入字面量：旧文件提醒从 brief 移到角色尾部，reminders 移至 continuation 后。两份字面量的行内容及字符总数相同；数值断言仍保留在 `:57`、`:58`。对应裁定 9、15，任务书 `:310`、`:515`。 |
| `PC-joint-prepare-freeze` | **未放宽。** 只补 `origins[].mentionsTools`、`toolOrigins`，`tests/runtime/PC-joint-prepare-freeze.test.ts:127`；由任务书 `:142`、`:148` 的新结构强制。 |
| `PC-joint-record-and-failure` | **未放宽。** 只把 `set.tools` 的正文 digest 纳入被引用正文集合，`tests/runtime/PC-joint-record-and-failure.test.ts:64`；完整工具正文比较仍在 `:80`。对应裁定 19、20，任务书 `:658`、`:704`。 |
| 回信所谓这三份的“base v2”变化 | **表述不精确。** J 的三份旧测试没有 base v2 字面量改动；实际只有上述三类变更，见 `.lead-ref/parts/J.diff:130`、`:143`、`:157`。 |
| allowlist 的判断标准 | 已可达或已删除的条目必须移除，`tests/architecture/production-reach.test.ts:104`；`wire-format` 要命名读者，`kept-for` 要命名后续消费者，`:12`、`:14`。公开一个 port 本身不等于调用该成员，`:248`。 |
| 三个 `PromptRecord*` 类型 | **保留成立。** 条目在 `tests/architecture/production-reach-allowlist.json:1277`、`:1283`、`:1289`；它们属于读取结果的 wire contract，E3 路由是规格明确指定的消费者，`slice-6-7-PROMPTS-SPEC.md:189`。不必因消费者尚未来到就改成另一类别。 |
| `RuntimeExecutionPort.readPromptRecord` | **保留成立。** allowlist `:1295`；当前实现发布在 `src/core/agent-runtime/runtime.ts:916`，生产树没有调用入口，后续路由由规格 `:189` 明定。 |
| `messageOf`、`rejected` | **保留成立。** allowlist `:1301`、`:1307`；用于尚未被生产入口调用的 prompt-record 读取拒绝路径，`src/core/agent-runtime/runtime.ts:647`、`:667`、`:701`。 |
| `sameQueryRunRef`、`readQueryPromptSet` | **保留成立。** allowlist `:1313`、`:1319`；调用链为 `readPromptRecord`→`readQueryPromptSet`→身份检查，`src/core/agent-runtime/runtime.ts:744`、`:104`。 |
| `ModelRequestReadPort.listRunModelRequests`、`completeRunRef` | **保留成立。** allowlist `:1325`、`:1331`；调用链为 `readPromptRecord`→列表读取→引用检查，`src/core/agent-runtime/runtime.ts:715`、`src/core/work-graph/tasks/model-call-service.ts:370`、`:379`。 |
| A 的新增导出 | 未发现遗漏的仅测试导出。`resolvePromptPackV1` 由磁盘读取和保存校验消费，`src/app/prompt-packs.ts:190`、`src/app/host-settings.ts:1062`；正文规范化及 digest helper 由保存和冻结消费，`src/app/host-settings.ts:1125`、`src/core/agent-runtime/prompt-set-texts.ts:221`。 |
| H 的 DTO 类型 | 已有生产类型引用。它们进入 `SettingsRoutes`，`src/app/host-settings-types.ts:153`，并由 `HostSettingsPort.call`、实际 dispatch 使用，`:171`、`src/app/host-settings.ts:1147`、`:1167`；无需新 allowlist 项。 |
| T 的 material/rerender | 已有生产消费者。`ContextRenderMaterialV1` 进入装配结果，`src/core/agent-runtime/context-types.ts:126`；K3 preparation 调用 rerender，`src/core/agent-runtime/execution-preparation.ts:690`、`:697`。 |
| Q 的两个函数 | 已有生产消费者。`finalToolNamesOf` 在 Work/Query 准备及开始调用，`execution-preparation.ts:520`、`query-preparation.ts:267`、`execution-driver.ts:546`、`query-execution.ts:286`；历史规则由两种 recipe 及开始路径调用，`context-work-recipe.ts:286`、`context-query-recipe.ts:95`、`execution-driver.ts:779`、`query-execution.ts:583`，以上均在 `src/core/agent-runtime/`。 |

因此回信 §7 的“未删除 allowlist 项、三个注记改为 E3 路由”**成立**，其消费者真实存在于冻结规格中；这里没有证明应删的已可达条目。J 的九个文件均匹配白名单，见 `.lead-ref/parts/J-files.txt:1` 和 `.lead-ref/books/pc2-whitelist.txt:16`、`:17`；J diff 未改冻结夹具。

相关裁定与行汇总：

- §2 规则 1：OK（仅就 J 的旧测试变更）。
- §2 规则 2：J-03、J-07、J-08、J-10、J-11、J-13。
- §2 规则 3／allowlist：OK。
- §4 J 范围与所有权：OK；仅凭源码不认定回信所称测试运行顺序已被验证。
- §5.1：J-04、J-06、J-08、J-09。
- 裁定 4 的继承部分：OK。
- 裁定 6 的 prepared/new 联通：OK。
- 裁定 7：J-01。
- 裁定 8：J-01、J-02。
- 裁定 9：OK。
- 裁定 10：J-10、J-11。
- 裁定 11：OK。
- 裁定 12：OK（合法 non-tail 与改字拒绝）；K3 联通证据另见 J-11。
- 裁定 13：J-11。
- 裁定 14：J-04、J-05、J-06、J-07。
- 裁定 15：J-08。
- 裁定 16：J-09、J-10。
- 裁定 17 的渲染字面例：OK。
- 裁定 19：OK（本次工具正文 digest、失败类型部分）。
- 裁定 20：J-12、J-13。
- PC-03：OK。
- PC-04：OK。
- PC-05：J-01。
- PC-06：J-02、J-03。
- PC-08：J-02。
- PC-18：J-04、J-05、J-06、J-07、J-08。
- PC-20：J-09、J-10。
- PC-21：J-11。
- PC-26：J-12、J-13。
- §5.3 三份旧 PC-1 联合测试：OK。

回信 §3 的联合变异声明，按断言静态核对：

| 声称的变异 | 判断 |
|---|---|
| 来源强制 `chain[0]` | **能抓住**：平台 work-input 来源的字面断言，`tests/runtime/PC2-joint-packs.test.ts:65`。 |
| 忽略包源变化 | **能抓住**：新准备要求新 base，`tests/app/PC2-joint-routes-prepare.test.ts:84`。 |
| `promptSelectionOf` 强制 platform | **能抓住**：个人包执行与 A/B 字面标记，`tests/runtime/PC2-joint-packs.test.ts:55`、`:143`。但不能替代真实设置链，J-01/J-02。 |
| `trackPromptTexts` 固定 base | **能抓住**：新准备要求 `PC2_CHANGED_BASE`，`tests/runtime/PC2-joint-packs.test.ts:110`。 |
| `sessionHistoryDecision` 忽略 `throughPosition` | **不能笼统认定联合覆盖成立**：若改坏 cursor 分支的输出位置，`:86` 可抓；若仅忽略非空 basis 的位置，联合用例只有 null basis，`:136`，会漏。纯函数测试 `tests/runtime/PC2-history-decision-pure.test.ts:18` 不能补成执行联通证据。 |
| preparation 强制 read | **能抓住**：无 read 例要求 `AZ`，`tests/runtime/PC2-joint-tools.test.ts:67`、`:83`。 |
| rerender 丢 `residentBytes` | **能抓住纯函数变异**：49 的字面断言，`tests/runtime/PC2-joint-shrink-entry.test.ts:95`；不能证明 preparation 正确消费结果，J-11。 |
| `storePromptTexts` 漏工具条目 | **能抓住**：条目 digest 和正文断言，`tests/runtime/PC2-joint-tools.test.ts:117`、`:123`。 |

以上只判断断言能否区分变异，不把回信 `.lead-ref/replies/pc2-reply.md:22` 当作已实际运行变异的证据。

```json
[
  {
    "id": "J-01",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-packs.test.ts",
    "line": 120,
    "basis": ".lead-ref/books/pc2-book.md:834；裁定7:287",
    "problem": "PC-05没有两个设置模型选包到真实执行的链路；省略字段及重启后只检查设置快照，没有验证执行解析为platform/current_run，也未用启动目录已有非默认值验证旧值不会恢复。",
    "fix": "用现有Host夹具经models/save、models/select后准备、启动和readPromptRecord，断言A/B；以启动目录已有非默认值为前提省略保存并重启，断言设置无字段且执行冻结为platform/current_run。"
  },
  {
    "id": "J-02",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-packs.test.ts",
    "line": 138,
    "basis": ".lead-ref/books/pc2-book.md:840；slice-6-7-PROMPTS-SPEC.md:430",
    "problem": "所谓设置改变实际通过installBinding将modelId A换成B，没有测试同一模型经设置保存更换包；Host不传递保存后的promptPack也能通过。",
    "fix": "保持同一个modelId，在准备后经Host models/save将包A改成B，断言旧准备启动使用A、新准备启动使用B。"
  },
  {
    "id": "J-03",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-packs.test.ts",
    "line": 102,
    "basis": ".lead-ref/books/pc2-book.md:839；.lead-ref/books/run-pc2.md:67、72；slice-6-7-PROMPTS-SPEC.md:427",
    "problem": "字符串标签冻结只检查消息中是否包含CHANGED ROLE，没有完整任务输入比较及本例正文的手算digest；旧标签丢失或其他正文变化可漏过。",
    "fix": "对旧准备和新准备发送的当前任务输入分别比较完整手写正文，并经readPromptRecord核相应正文及字面正文的SHA-256。"
  },
  {
    "id": "J-04",
    "class": "会出错",
    "file": "tests/helpers/PC2-pack-fixture.ts",
    "line": 415,
    "basis": ".lead-ref/books/pc2-book.md:809、848",
    "problem": "组合层已复制runtime.port给Workflow，夹具随后spy原port.startQuery无法截获调用；openPC2QueryHistoryFixture本应返回Query句柄，却在捕获为空时抛No unique derived Query start。",
    "fix": "由lead修订并重新冻结夹具：创建平台前捕获createWorkflow的deps.runtime，spy该实际接收对象的startQuery并保存同一对象的原方法；随后补派生及复用Query的准备和启动断言，不改生产组合层。"
  },
  {
    "id": "J-05",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 90,
    "basis": ".lead-ref/books/pc2-book.md:843",
    "problem": "缺LA-1非空播种的真实执行及提醒1；continuation便捷方法固定同Session，但公开平台接口仍可承载新Session路径。",
    "fix": "在现有夹具内公开结束首个Run、requeueTask、runtime.createSession创建同角色新Session、带requeue领取，再准备和启动，断言历史前缀及提醒1；不手写seed。"
  },
  {
    "id": "J-06",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 136,
    "basis": ".lead-ref/books/pc2-book.md:848；slice-6-7-PROMPTS-SPEC.md:226",
    "problem": "K3用例只有throughPosition:null、takesSessionHistory:false及提醒0，不能验证K3真正接历史时的提醒；当前封装的源Run从新Session第一轮直接阻塞。",
    "fix": "由lead补并冻结非空前缀夹具模式：源Session先公开执行并结束一轮，再同Session建立阻塞Run，随后在新Session领取复核轮，验证准备和开始后的历史前缀及提醒1；保留空基线例。"
  },
  {
    "id": "J-07",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 86,
    "basis": ".lead-ref/books/pc2-book.md:456、459、846；.lead-ref/books/run-pc2.md:67",
    "problem": "另行调用纯函数不能证明assembly只决定一次、Q原样冻结或Query按basis跳过边界读取；throughPosition期望还取自生产边界结果。",
    "fix": "由lead冻结仅转发的观察包装，经公开prepare记录assembly、规则调用和边界读取，按手算字面值断言次数、参数及冻结结果；独立纯函数调用不作为联通验收。"
  },
  {
    "id": "J-08",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 150,
    "basis": ".lead-ref/books/pc2-book.md:844；slice-6-7-PROMPTS-SPEC.md:457、459",
    "problem": "四个预算段全省略仍保留提醒只通过renderContext验证，缺准备到模型请求的PE3路径；同Session接续例也未启动。",
    "fix": "由lead给PCOptions增加并透传WP2已有的contextResidentBytes选项后冻结；公开生成四段材料，以零预算准备和启动，完整比较角色和当前输入并核四段省略。"
  },
  {
    "id": "J-09",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 57,
    "basis": ".lead-ref/books/pc2-book.md:816、855",
    "problem": "read+edit+shell的prepare-to-request被纯渲染替代。夹具除空writeScope外，还固定Role只读并缺Host shellWorkspaceAccess，真实准备会拒绝shell。",
    "fix": "由lead修订并冻结完整写授权夹具选项：Role writeScope为workspace，Host writeScope为['.']且shellWorkspaceAccess为all_except_denied，再经tools跑三工具准备和启动，核完整system与实际工具名单；WP2修改需补白名单裁定。"
  },
  {
    "id": "J-10",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 76,
    "basis": ".lead-ref/books/pc2-book.md:854、322",
    "problem": "缺能区分工具清单的实际使用Skill及continuation brief用例。联合测试禁用Skills；T的Skill清单不命中模板工具块，brief模板没有工具块，固定传空清单可漏过。",
    "fix": "在J新增含read工具块的Skill和brief个人包，用read及无read两种公开准备和接续启动完整比较输出；不改生产、冻结夹具或read_source权限。"
  },
  {
    "id": "J-11",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-shrink-entry.test.ts",
    "line": 39,
    "basis": ".lead-ref/books/pc2-book.md:861；slice-6-7-PROMPTS-SPEC.md:465；.lead-ref/books/run-pc2.md:67",
    "problem": "纯重渲染、预算例、continuation入口分开，缺真实K3收缩后的尾部提醒全文、手算两段范围及成功入口；Q旁证从生产renderer生成期望且不启动，联合第69行也用生产输出作期望。",
    "fix": "使用现成openPC2ReviewFixture('shrink')补完整链：证明收缩、比较手写review和尾部提醒、手算范围和总字节及省略数据，然后start通过入口；第69行改为字面值或删除重复断言。"
  },
  {
    "id": "J-12",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 134,
    "basis": ".lead-ref/books/pc2-book.md:909、684",
    "problem": "Query没有准备后再改包的启动例；Work恢复只选择read/list_files，record_note未注册也未核恢复后的正文。Work准备后改包再启动已由Q测试覆盖。",
    "fix": "Query保留可变source，在prepare后替换正文再start并断言旧list_files.prefix；Work恢复例加入record_note，断言开始及恢复都发送准备时的两项正文。"
  },
  {
    "id": "J-13",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 127,
    "basis": ".lead-ref/books/pc2-book.md:910；.lead-ref/books/run-pc2.md:72；slice-6-7-PROMPTS-SPEC.md:191",
    "problem": "Work的toolSpecsRef正文只查两个子串，Query不读PromptRecord；正文错放字段、夹杂额外内容或仅Query记录错误可漏过。",
    "fix": "Work和Query执行后都读readPromptRecord，将toolSpecsRef正文与手写完整规范JSON比较，并核字面JSON的SHA-256；不从捕获请求生成期望。"
  }
]
```

会出错 1，违规 12，不整洁 0，建议 0