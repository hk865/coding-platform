只读核对完成，未修改文件，未运行测试、构建或变异。发现 **1 项夹具错误、4 项验收违规**。以下“变异会失败”均为源码推演，不代表复现了 DSH 自报的 RED/GREEN。

**1. 发现表**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| A3-01 | 会出错 | `tests/helpers/PC-platform-fixture.ts:587`；`tests/helpers/K3-35-continuation-fixture.ts:710` | `.lead-ref/books/pc2-r2-findings.md:30`；`.lead-ref/audit2/FX.out.md:77` | 输入 `sourceHistory:'completed_turn'` 时，应返回具有非空源历史的夹具；实际完成首轮后直接 requeue，必被拒绝为 `busy: the selected Run is verifying; finalize its round first`。拒绝规则在 `src/core/work-graph/state/task-machine.ts:1216`。此外，仅补验证结算还不够：检查用 Host 返回工作区版本 1，而事实版本为 3，随后会被版本检查拒绝。 | 按下文补丁，仅在该显式分支启用公开验证结算，并使检查 Host 返回实际工作区版本；结算后重新读取 Run revision，再 requeue。之后补非空 K3 历史用例，保留原空基线。 |
| A3-02 | 违规 | `tests/state/PC2-G-query-bind-order.test.ts:61`、`:91`、`:113` | `.lead-ref/books/pc2-r2-findings.md:58`；`.lead-ref/books/pc2-book.md:55` | G2-02 的两个反例先用 `commitRaw` 手写 Project／Workspace 事实，手填 Kernel Session 创建事实，再另行装配 Query owner。最后调用 `bindPreparedQuery`，不能使前置过程变成公开步骤。 | 使用现有真实 Query 平台的公开创建、提交、领取和准备链；捕获实际装配的 QueryExecutionPort，通过公开材料接口保存反例，再调用该实例的 bind。删除手写事实及另造 owner，冻结夹具不改。 |
| A3-03 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:196`、`:207` | `.lead-ref/books/pc2-r2-findings.md:70`；`.lead-ref/audit2/J.out.md:7` | J2-03 仍只比较 brief 前后缀，并把 manifest 中的正文用于请求期望。marker 与 `BRE/BE` 之间多一个字符，现有断言仍可通过。“动态值导致无法完整比较”的理由不成立。 | 启动后从公开 `readContinuationBrief` 取得 digest，拼出完整字面 `marker + BRE/BE`，分别整段比较准备正文与实际请求正文；具体修改见下文。 |
| A3-04 | 违规 | `tests/runtime/PC2-joint-query-history.test.ts:107`、`:112`、`:146`、`:149` | `.lead-ref/books/pc2-r2-findings.md:11`、`:72` | J-04 已真实启动两种 Query，数值修正也正确，但源用户历史只检查 marker 前缀；当前 Query 输入只检查提醒等局部性质。源历史 marker 后的正文被破坏，仍可能通过。 | 为源用户输入及两种当前 Query 输入写独立完整期望，使用整文比较；保留助手回复、消息顺序、basis 和提醒断言，不从捕获请求复制期望。 |
| A3-05 | 违规 | `tests/runtime/PC2-joint-budget.test.ts:175`、`:185`、`:216` | `.lead-ref/books/pc2-r2-findings.md:74`；`.lead-ref/audit1/J.out.md:14` | J-08 只覆盖 notes、reminders 两段；inputs 有公开构造路径，不能按不可达豁免。完整当前请求仍与 `manifest.input` 比较，未提供独立全文期望。仅让 inputs 绕过预算的变异会漏过。 | 保留已有 Task 定义，公开追加带输入要求的新 Task，完成后同 Session 接续，验证非空 inputs 的整体省略；当前输入改用独立全文期望，动态标识按公开读取结果填入。footprint 保留真实不可达说明。 |

**2. 逐行结论**

下表的“OK”指静态实现及断言符合该行；运行结果与提交对象的核验边界另列。

| 行／裁定出处 | 结论及代码、测试证据 |
|---|---|
| A2-01，`.lead-ref/books/pc2-r2-findings.md:38` | **OK**。槽错误累计并继续解析；两种完整问题列表已补。`src/contracts/prompts/render-template.ts:106`、`:235`；`tests/contracts/PC2-resolve-pack.test.ts:469`、`:483`。 |
| A2-02，`.lead-ref/books/pc2-r2-findings.md:39` | **OK**。未知模板继续通用字段检查，只跳过槽表检查。`src/contracts/prompts/resolve-pack.ts:249`、`:276`；`tests/contracts/PC2-resolve-pack.test.ts:491`。 |
| A2-03，`.lead-ref/books/pc2-r2-findings.md:40` | **OK**。未知工具继续文件、JSON、描述及参数检查。`src/contracts/prompts/resolve-pack.ts:295`、`:311`；`tests/contracts/PC2-resolve-pack.test.ts:504`。 |
| A2-04，`.lead-ref/books/pc2-r2-findings.md:41` | **OK**。平台参数键提取不再依赖描述及参数值合法。`src/contracts/prompts/resolve-pack.ts:341`；`tests/contracts/PC2-resolve-pack.test.ts:515`、`:528`。 |
| A2-05，`.lead-ref/books/pc2-r2-findings.md:42` | **OK**。语法与身份分别报告，完整双错误断言已补。`src/contracts/prompts/resolve-pack.ts:180`；`tests/contracts/PC2-resolve-pack.test.ts:359`。 |
| A2-06，`.lead-ref/books/pc2-r2-findings.md:43` | **OK**。路径问题累计，非法路径停止后续内容检查。`src/contracts/prompts/resolve-pack.ts:37`、`:266`；`tests/contracts/PC2-resolve-pack.test.ts:368`。 |
| A2-07，`.lead-ref/books/pc2-r2-findings.md:44` | **OK**。七个指定输入均有完整字面问题列表。`tests/contracts/PC2-resolve-pack.test.ts:378`、`:386`、`:394`、`:402`、`:410`、`:419`、`:427`。 |
| A2-08，`.lead-ref/books/pc2-r2-findings.md:45` | **OK**。指定两处改为当前语法和错误类型说明。`src/contracts/prompts/render-template.ts:218`、`:309`。 |
| H2-01，`.lead-ref/books/pc2-r2-findings.md:46` | **OK**。仅 prompts 坏 JSON 附加 problems；非 prompts 完整响应回归已补。`src/app/server.ts:343`；`tests/app/PC2-H-settings-model.test.ts:112`。 |
| H2-02，`.lead-ref/books/pc2-r2-findings.md:47` | **OK**。非对象声明表保留给整包校验；两个保存反例比较完整拒绝及文件快照。`src/app/host-settings.ts:1004`、`:1019`；`tests/app/PC2-H-pack-routes.test.ts:181`；`tests/app/PC2-H-tool-routes.test.ts:107`。 |
| H2-03，`.lead-ref/books/pc2-r2-findings.md:48` | **OK**。链终止进入统一校验、合并；循环＋版本零＋缺文件完整反例已补。`src/app/prompt-packs.ts:276`、`:301`；`tests/app/PC2-H-pack-routes.test.ts:206`。 |
| H2-04，`.lead-ref/books/pc2-r2-findings.md:49` | **OK，同 J2-01**。Host 自己的平台执行链见 `tests/app/PC2-joint-routes-prepare.test.ts:257`、`:267`、`:282`。 |
| H2-05，`.lead-ref/books/pc2-r2-findings.md:50` | **OK**。五处批次前缀删除。`src/app/prompt-packs.ts:2`；`src/app/host.ts:250`、`:353`、`:927`；`src/composition/create-platform.ts:250`。 |
| T2-01，`.lead-ref/books/pc2-r2-findings.md:51` | **OK**。候选和最终后备均分别传 anomaly／review，指定容量反例已补。`src/contracts/continuation-brief.ts:651`、`:676`、`:680`；`tests/runtime/PC2-T-render.test.ts:448`。 |
| T2-02，`.lead-ref/books/pc2-r2-findings.md:52` | **OK**。两个模板包含嵌套及额外工具块，缺省和显式工具表均整文比较。`tests/runtime/PC2-T-render.test.ts:96`、`:366`、`:377`。 |
| T2-03，`.lead-ref/books/pc2-r2-findings.md:53` | **OK**。digest 改为固定 64 位字面值，全文期望不再调用生产摘要函数。`tests/runtime/PC2-T-render.test.ts:349`、`:357`。 |
| T2-04，`.lead-ref/books/pc2-r2-findings.md:54` | **rejected, untouched**。批准的四处输入迁移保留；本轮总差异没有这些文件的 hunk。`.lead-ref/parts/A-files.txt:1`。 |
| T2-05，`.lead-ref/books/pc2-r2-findings.md:55` | **OK（静态）**。general note 移入 reminders 会使 notes 区间中的正向断言失败。`src/core/agent-runtime/context-fact-text.ts:309`、`:318`；`tests/runtime/S4C2-assembly.test.ts:358`、`:359`。 |
| T2-06，`.lead-ref/books/pc2-r2-findings.md:56` | **OK**。三处仅修分项注释，最终数值不变。`tests/runtime/K3-15-blocked-omission.test.ts:10`；`tests/runtime/K3-35-T-by-hand.test.ts:37`；`tests/runtime/K3-35-approved-methods-brief.test.ts:169`。 |
| G2-01，`.lead-ref/books/pc2-r2-findings.md:57` | **OK**。先检查 binding／sections 结构；null、缺失 binding 两例已补。`src/core/work-graph/tasks/execution-entry-service.ts:1581`；`tests/work-graph/PC2-G-entry-guard.test.ts:125`、`:137`。 |
| G2-02，`.lead-ref/books/pc2-r2-findings.md:58` | **A3-02**。反例能触发 Query 的冻结顺序检查，但前置事实来源违规。`tests/state/PC2-G-query-bind-order.test.ts:61`、`:215`、`:223`。 |
| G2-03，`.lead-ref/books/pc2-r2-findings.md:59` | **OK**。brief、摘要、模板、不同字符串、工具列表、147 字节全文及边界均独立；正确及越界两例存在。`tests/state/PC2-G-I19-evidence.test.ts:34`、`:86`、`:89`、`:95`、`:204`、`:211`、`:238`。 |
| G2-04，`.lead-ref/books/pc2-r2-findings.md:60` | **OK（29 行回撤已核；提交全文比较见下述边界）**。新增证据移入 PC2 文件。`.lead-ref/parts/A.diff:3303`；`tests/state/PC2-G-I19-evidence.test.ts:237`。 |
| G2-05，`.lead-ref/books/pc2-r2-findings.md:61` | **OK**。指定生产注释删除返工行号。`.lead-ref/parts/A.diff:550`、`:585`、`:594`、`:623`。 |
| G2-06，`.lead-ref/books/pc2-r2-findings.md:62` | **OK**。实际输入改为 `[ROLE, GOAL, TASK]`，被交换两段确实缺席。`tests/state/PC2-G-context-order.test.ts:115`。 |
| Q2-01，`.lead-ref/books/pc2-r2-findings.md:63` | **rejected, untouched**。不再把获准的既有读取列为错误；本轮该文件仅改注释。`.lead-ref/parts/A.diff:525`。 |
| Q2-02，`.lead-ref/books/pc2-r2-findings.md:64` | **OK**。read／无 read 两支完整输入均为独立字面期望。`tests/runtime/PC2-declaration-prepare.test.ts:165`、`:189`、`:227`、`:238`。 |
| Q2-03，`.lead-ref/books/pc2-r2-findings.md:65` | **OK，同 J2-02**。`tests/runtime/PC2-joint-history.test.ts:229`。 |
| Q2-04，`.lead-ref/books/pc2-r2-findings.md:66` | **OK，同 J2-04**。`tests/runtime/PC2-joint-tools.test.ts:253`、`:313`。 |
| Q2-05，`.lead-ref/books/pc2-r2-findings.md:67` | **OK**。注释改为准备与启动的实际职责。`src/core/agent-runtime/context-history-facts.ts:40`。 |
| J2-01，`.lead-ref/books/pc2-r2-findings.md:68` | **OK**。同一 Host 平台准备、启动、读记录，覆盖双模型及同模型换包。`tests/app/PC2-joint-routes-prepare.test.ts:257`、`:267`、`:282`、`:355`、`:390`。 |
| J2-02，`.lead-ref/books/pc2-r2-findings.md:69` | **OK**。历史两条消息完整比较，且总消息数为三。`tests/runtime/PC2-joint-history.test.ts:229`、`:233`。 |
| J2-03，`.lead-ref/books/pc2-r2-findings.md:70` | **A3-03**。`tests/runtime/PC2-joint-tools.test.ts:196`、`:207`。 |
| J2-04，`.lead-ref/books/pc2-r2-findings.md:71` | **OK**。完整规范 JSON、原始正文、实际引用 digest 和 toolsDigest 均比较。`tests/runtime/PC2-joint-tools.test.ts:48`、`:69`、`:85`、`:253`、`:313`。 |
| J-04，`.lead-ref/books/pc2-r2-findings.md:72` | **A3-04**；reused 数值修正正确。`tests/runtime/PC2-joint-query-history.test.ts:131`、`:146`。 |
| J-06，`.lead-ref/books/pc2-r2-findings.md:73` | **A3-01**；如实报告夹具阻塞符合“不改冻结夹具”的裁定。`.lead-ref/replies/pc2-r2-reply.md:6`。 |
| J-08，`.lead-ref/books/pc2-r2-findings.md:74` | **A3-05**。`tests/runtime/PC2-joint-budget.test.ts:178`、`:216`。 |
| J-09，`.lead-ref/books/pc2-r2-findings.md:75` | **OK（测试修复；变异记录边界见下）**。真实准备、启动、完整 `ARESZ` 和工具名单俱全。`tests/runtime/PC2-joint-tools.test.ts:109`、`:121`、`:127`。 |
| F4，`.lead-ref/books/pc2-r2-findings.md:76` | **OK**。两文件只有批准的三个替换。`tests/runtime/K-readonly-command.test.ts:734`、`:1069`；`tests/runtime/RL-31-readonly-resource-caps.test.ts:163`。 |

四项 §1 裁定分别为：

- **F1 范围：OK。** 保留既有简报、seed、review 读取，不将其重新报错；本轮 history 文件仅改指定注释。`.lead-ref/books/pc2-r2-findings.md:16`；`.lead-ref/parts/A.diff:525`。
- **F1 输入形状：OK。** 按明确批准保留四处迁移。`.lead-ref/books/pc2-r2-findings.md:20`；`.lead-ref/parts/A-files.txt:1`。
- **F4：OK。** 全文比较确认只有三个批准替换。`.lead-ref/books/pc2-r2-findings.md:23`；`.lead-ref/parts/A.diff:1753`、`:1762`、`:2712`。
- **延期行现在执行：A3-01、A3-04、A3-05。** J-09 已补；J-06 按要求报告阻塞，不能据此视为验收完成。`.lead-ref/books/pc2-r2-findings.md:30`；`.lead-ref/replies/pc2-r2-reply.md:6`、`:19`。

变异声明的静态核对如下；注释行、rejected 行不需要另造行为变异。

| 声明 | 静态结论 |
|---|---|
| A2-01～A2-07 | 所述恢复短路、恢复平台值守卫、恢复 identity 互斥、路径早退、删除文件名匹配，均位于生产校验路径，会改变对应完整问题列表。`src/contracts/prompts/render-template.ts:106`；`src/contracts/prompts/resolve-pack.ts:180`、`:249`、`:266`、`:272`、`:295`、`:341`；`tests/contracts/PC2-resolve-pack.test.ts:359`、`:368`、`:410`、`:469`、`:491`、`:504`、`:515`。 |
| H2-01～H2-03 | 恢复所有路由加 problems、使非对象表进入赋值、恢复 cycle 早退，分别改变完整响应或产生异常，对应新增例会失败。`src/app/server.ts:343`；`src/app/host-settings.ts:1004`、`:1019`；`src/app/prompt-packs.ts:280`；相关测试位置见逐行表。 |
| T2-01、T2-02、T2-05 | 合槽会隐藏必需 review；删除工具节点递归会丢 shell；general note 移到 reminders 会丢 notes 正向断言，均会失败。`src/contracts/continuation-brief.ts:474`、`:651`；`src/core/agent-runtime/context-fact-text.ts:309`；`tests/runtime/PC2-T-render.test.ts:366`、`:448`；`tests/runtime/S4C2-assembly.test.ts:359`。 |
| T2-03 | 固定字面修复成立；回信只写“变异用生产 digest”，没有定位实际改动。若指生产 renderer 改为重新计算 brief digest，字面 marker 断言会失败；不能据该简写认证实际变异位置。`.lead-ref/replies/pc2-r2-reply.md:15`；`src/contracts/continuation-brief.ts:543`；`tests/runtime/PC2-T-render.test.ts:349`、`:359`。 |
| G2-01、G2-02、G2-06 | 绕过结构预检、仅绕过 Query 冻结顺序检查、删除逐元素比较，会使相应断言失败；G2-02 仍有 A3-02。`src/core/work-graph/tasks/execution-entry-service.ts:1581`；`src/core/work-graph/queries/query-execution.ts:1072`；`tests/state/PC2-G-context-order.test.ts:117`。 |
| G2-03 | 生产 renderer 忽略工具表会改变 147 字节正文；checker 忽略工具表、换回平台字符串、删除边界检查也分别被区分。后面三种是测试 checker 变异，不能单独冒充生产变异；回信另报了生产 renderer 变异。`tests/state/PC2-G-I19-evidence.test.ts:89`、`:101`、`:204`、`:211`、`:243`；`tests/state/invariants.ts:1932`、`:1943`；`.lead-ref/replies/pc2-r2-reply.md:16`。 |
| Q2-02、J2-01、J2-02、J2-04 | 重复拼接 guide、删除 Host 包源注入、启动时丢 Work basis、删除 search，均会被新增完整断言发现。`tests/runtime/PC2-declaration-prepare.test.ts:227`；`src/app/host.ts:558`；`src/core/agent-runtime/execution-driver.ts:781`；`tests/runtime/PC2-joint-history.test.ts:229`；`tests/runtime/PC2-joint-tools.test.ts:258`、`:318`。 |
| J-04、J-08 | 丢 Query basis 能杀 derived 例；零预算改为缺省预算能杀目前两段例。但不能证明完整历史及 inputs 规则，见 A3-04、A3-05。`src/core/agent-runtime/query-execution.ts:584`；`tests/runtime/PC2-joint-query-history.test.ts:103`；`tests/runtime/PC2-joint-budget.test.ts:178`、`:210`。 |
| J-09 | 测试能发现写／shell 工具及其模板块丢失。但“删 write+shell 授权”没有具体位置，无法证明所报操作改的是生产代码而非夹具授权。`.lead-ref/replies/pc2-r2-reply.md:19`；`tests/runtime/PC2-joint-tools.test.ts:114`、`:127`。 |
| F4 | 删除准备期授权读取会使执行期读取落在仍返回版本 1 的第二次读取，破坏这三个权限变化反例；是有效的生产侧反例方向。`.lead-ref/books/pc2-r2-findings.md:26`；`tests/runtime/K-readonly-command.test.ts:734`、`:1069`；`tests/runtime/RL-31-readonly-resource-caps.test.ts:163`。 |

还可明确指出三种**同规则但本轮指定用例未覆盖**的局部变异；这里不另要求扩大测试范围：

- H2-03 只恢复“缺父包”分支早退，新增 cycle 用例不能发现。`src/app/prompt-packs.ts:286`；`tests/app/PC2-H-pack-routes.test.ts:206`。
- T2-02 只删除普通 slot block 的递归，新增的 tool 内嵌 tool 用例不能发现。`src/contracts/continuation-brief.ts:475`；`tests/runtime/PC2-T-render.test.ts:99`、`:102`。
- T2-01 只在最后返回处重新合槽，当前必需 review 已超限的例子会提前抛错，不能触及该变异。`src/contracts/continuation-brief.ts:662`、`:680`；`tests/runtime/PC2-T-render.test.ts:455`。

范围及证据边界：

- 将四份冻结补丁在内存依次应用到提供的 base，所得 `PC-platform-fixture.ts`、`PC2-pack-fixture.ts`、`WP2-platform-support.ts` 与当前全文一致，未发现额外行变化。补丁起点为 `.lead-ref/audit2/FX.out.md:6`、`:77`、`:185`、`:244`；lead 的应用检查记录为 `.lead-ref/checks/pc2-fx-apply.log:1`。
- 提供的总差异没有 `PC-kernel-fixture.ts`、`PC2-host-fixture.ts` 的修改；没有这两份 base 快照及 Git 对象，因此不声称独立完成提交级字节认证。`.lead-ref/parts/A-files.txt:1`。
- G2-04 确实只撤回一行 import 和 28 行测试；没有 `af84802` 文件或对象，不能独立认证与该提交全文相同。`.lead-ref/parts/A.diff:3303`。
- 提供的 37 个变更路径均匹配白名单；生产 hunk 均可归入冻结行，未发现新增测试专用生产路径，也未证明另有生产行为回归。`.lead-ref/parts/A-files.txt:1`；`.lead-ref/books/pc2-r2-whitelist.txt:1`；`.lead-ref/parts/A.diff:1`。
- rework 1 全量记录确为两文件失败；rework 2 文件目前只有启动信息及五项静态检查成功，没有测试汇总，不能认定全量通过。`.lead-ref/checks/full-pc2-r1.txt:9`、`:13`；`.lead-ref/checks/full-pc2-r2.txt:1`。

**3. 未完成项**

**J2-03：动态值属实，无法形成完整期望的结论不成立。**

successor 经公开 claim 分配，最终使用组合层注入的 `randomUUID`；因此 runId 不能预先写死。`tests/helpers/PC-platform-fixture.ts:484`；`tests/helpers/WP2-platform-support.ts:911`；`src/composition/create-platform.ts:987`；`src/core/work-graph/tasks/claim-service.ts:1176`。

SQLite 也确实位于被扫描的工作区根：workspace root、平台存储及 Kernel 数据库使用同一目录；扫描排除集合没有 SQLite，普通文件实际字节进入摘要。`tests/helpers/WP2-platform-support.ts:769`、`:793`、`:800`；`src/core/workspace/candidate-workspace-reader.ts:6`、`:31`、`:46`。该摘要进入 brief checkpoint。`src/core/agent-runtime/context-workspace-facts.ts:56`、`:60`；`src/core/agent-runtime/continuation-brief-assembly.ts:865`。

但本例只需公开简报摘要，不需预测两个动态值。已有先例正是从公开返回值取得 digest／roundId 后填入独立全文期望。`tests/runtime/PC-joint-budget-removal.test.ts:132`、`:138`、`:151`。

在 `tests/runtime/PC2-joint-tools.test.ts:199` 启动成功、取得 `request` 后加入：

```ts
const saved = await fixture.base.platform.runtime.readContinuationBrief!(
  fixture.base.ctx, { runRef: continuation.runRef });
expect(saved.status, JSON.stringify(saved)).toBe('ready');
if (saved.status !== 'ready' || saved.value === null) {
  throw new Error(JSON.stringify(saved));
}

const expectedBrief =
  `[continuation-brief v1 sha256:${saved.value.digest}]${brief}`;
expect(briefText).toBe(expectedBrief);

const current = request.messages.at(-1);
if (current === undefined || !('content' in current)) {
  throw new Error('PC-20 the request has no current input');
}
expect(sectionText(current.content, section)).toBe(expectedBrief);
```

删除原来的两条前后缀断言及 `toContain(briefText)`。`tests/runtime/PC2-joint-tools.test.ts:196`、`:207`。读取必须放在启动绑定后，否则接口明确返回 `incomplete`；本例模板没有 roundId，不需额外开启验证轮。`src/core/agent-runtime/runtime.ts:626`、`:637`；`tests/runtime/PC2-joint-tools.test.ts:166`。

**J-06：确认夹具阻塞；以下是最小修补文本。**

除了缺验证结算，检查 Host 的固定版本 1 与 S5 工作区版本 3 不一致；公开 `openVerification` 会拒绝该差异。`tests/helpers/K3-35-continuation-fixture.ts:544`；`tests/helpers/S5-decision-fixture.ts:152`；`src/core/work-graph/evidence/evidence-service.ts:932`。

以下为零上下文 unified diff，仅供 lead 落地并重新冻结；未应用、未编译、未运行。应用工具需支持零上下文差异。

```diff
--- a/tests/helpers/K3-35-continuation-fixture.ts
+++ b/tests/helpers/K3-35-continuation-fixture.ts
@@ -215,0 +216 @@
+  finalizeCompletedBeforeRequeue?: boolean;
@@ -544 +545,3 @@
-        return { status: 'ready' as const, value: { root: directory, workspaceRevision: 1 } };
+        return { status: 'ready' as const, value: { root: directory,
+          workspaceRevision: options.finalizeCompletedBeforeRequeue === true
+            ? world.fixture.workspace.revision : 1 } };
@@ -711 +714 @@
-    const current = await reads.readExecution(world.fixture.ctx, claim.runRef);
+    let current = await reads.readExecution(world.fixture.ctx, claim.runRef);
@@ -712,0 +716,27 @@
+    if (options.finalizeCompletedBeforeRequeue === true
+      && current.value.run.status === 'ended' && current.value.run.outcome === 'completed') {
+      const platform = await hostPlatform();
+      platform.registerCheckConfiguration({ configuration: {
+        configurationRevision: 'k3-35-requeue-checks@1',
+        workspace: world.fixture.base.workspaceRef,
+        executor: world.fixture.operatorActor,
+        permissionRevision: K3_35_HOST_REVISION,
+        sourceAccess: 'verification_workspace',
+        processAccess: 'all_except_denied',
+        deniedPrefixes: ['.git'],
+        checks: [],
+      } });
+      const opened = await platform.evidence.openVerification(world.fixture.ctx, {
+        input: { subjectRunRef: claim.runRef, subject: claim.task, planRef: claim.planRef },
+        meta: { requestId: `k3-35-open:${claim.runRef.runId}`, expected: [] },
+      });
+      if (opened.status !== 'committed') throw new Error(JSON.stringify(opened));
+      const finalized = await platform.evidence.finalizeChecks(world.fixture.ctx, {
+        input: { roundRef: opened.value.ref },
+        meta: { requestId: `k3-35-final:${claim.runRef.runId}`,
+          expected: [{ ref: opened.value.ref, revision: opened.value.revision }] },
+      });
+      if (finalized.status !== 'committed') throw new Error(JSON.stringify(finalized));
+      current = await reads.readExecution(world.fixture.ctx, claim.runRef);
+      if (current.status !== 'ready') throw new Error(JSON.stringify(current));
+    }
--- a/tests/helpers/PC-platform-fixture.ts
+++ b/tests/helpers/PC-platform-fixture.ts
@@ -572 +572 @@
-      harness = await openRealRunHarness(world);
+      harness = await openRealRunHarness(world, { finalizeCompletedBeforeRequeue: true });
```

这里复用 harness 已有的真实平台；它与原世界共享记录和正文存储，不增加另一套事实。`tests/helpers/K3-35-continuation-fixture.ts:566`、`:589`。

全部 32 个 `openRealRunHarness` 调用点已检查；只有上述 `completed_turn` 调用新增选项，其余保持原默认路径：

| 调用位置 |
|---|
| `tests/business/K3-41-release-hold.test.ts:516` |
| `tests/business/K3-review-workflow-rows.test.ts:122`、`:424` |
| `tests/helpers/B2-401-world.ts:210` |
| `tests/helpers/B2-blocked-runtime.ts:143` |
| `tests/helpers/B2-crr-world.ts:138`、`:210`、`:309` |
| `tests/helpers/K3-35-continuation-fixture.ts:829` |
| `tests/helpers/K3-blocked-command-fixture.ts:449` |
| `tests/helpers/K3-review-card-fixture.ts:455` |
| `tests/helpers/PC-platform-fixture.ts:572`、`:620` |
| `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:36` |
| `tests/runtime/K3-B3-newest-request-order.test.ts:94` |
| `tests/runtime/K3-merge-cancel-propagation.test.ts:61` |
| `tests/runtime/K3-review-preparation.test.ts:136` |
| `tests/scenarios/K3-29-startup-reconcile-2b.test.ts:84` |
| `tests/work-graph/K3-06-mixed-kinds-owner.test.ts:185` |
| `tests/work-graph/K3-15-disposition-effects.test.ts:97` |
| `tests/work-graph/K3-18-autonomy-facts.test.ts:79` |
| `tests/work-graph/K3-18-review-card-queue.test.ts:220` |
| `tests/work-graph/K3-26-unknown-call-review-storage.test.ts:227`、`:565` |
| `tests/work-graph/K3-47-claim-gate.test.ts:190` |
| `tests/work-graph/K3-47-continuation-gate.test.ts:130` |
| `tests/work-graph/K3-47-reader-facts.test.ts:104` |
| `tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:122`、`:195` |
| `tests/work-graph/UCR-settle-review.test.ts:145` |
| `tests/work-graph/unknown-call-review-list.scale.test.ts:143` |
| `tests/work-graph/unknown-call-review-list.test.ts:335` |

四个直接 PC 夹具调用均未传 `sourceHistory`，仍走原分支：`tests/helpers/PC2-pack-fixture.ts:353`；`tests/runtime/PC-joint-prepare-freeze.test.ts:285`；`tests/runtime/PC-prepare-review-freeze.test.ts:37`；`tests/runtime/PC-entry-frozen-review.test.ts:49`。四个间接调用也保留：`tests/runtime/PC2-declaration-prepare.test.ts:127`；`tests/runtime/PC2-joint-history.test.ts:262`；`tests/runtime/PC2-joint-shrink-entry.test.ts:126`；`tests/runtime/PC2-review-shrink.test.ts:25`。

补丁之后仍需新增直接使用 `openPCK3ReviewFixture({sourceHistory:'completed_turn'})` 的准备／启动用例，独立完整比较历史前缀并核提醒 1；当前空 seed 例明确断言 null／false／0，不能替代。`tests/helpers/PC-platform-fixture.ts:562`；`tests/runtime/PC2-joint-history.test.ts:269`。

**J-08：footprint 不可达属实；inputs 不可达不成立。**

`footprint` 是明确的未来段，生产投影固定为 `[]`，不应为验收伪造材料。`src/core/agent-runtime/context-fact-text.ts:314`。

已有 Run 的 `implement-a` 不能修改定义，这一限制属实；但规则只检查发生定义变化或新增的 Task，不禁止保留已有任务、追加新任务。`src/core/work-graph/state/plan-machine.ts:581`、`:602`。

可用公开步骤是：

1. 保留原任务定义，通过 Plan 公开变更追加未领取 Task及其输入要求，不修改已领取 Task。约束边界见 `src/core/work-graph/state/plan-machine.ts:581`。
2. 输入引用可使用第一次公开准备得到的 bundleRef；输入服务支持同作用域、execution-origin 的 Artifact。`src/core/work-graph/inputs/context-input-service.ts:488`。
3. 用同一 Session 公开领取新 Task；现有 claim helper 接受 taskId、planRef、Session。`tests/helpers/WP2-platform-support.ts:902`。
4. 新 Task 完成后经公开验证结算、requeue，再准备及启动同 Session 接续；非空输入会进入 inputs 的预算材料。`src/core/agent-runtime/context-work-recipe.ts:205`。
5. 独立断言 inputs 全省略及完整当前输入，动态简报标识从公开接口取得，不能继续使用 `currentInput.toBe(manifest.input)`。`tests/runtime/PC2-joint-budget.test.ts:216`；`tests/runtime/PC-joint-budget-removal.test.ts:132`。

因此，现有两段省略只能算部分完成；footprint 的产品限制不能同时豁免 inputs 和完整输入断言。`.lead-ref/audit1/J.out.md:14`；`tests/runtime/PC2-joint-budget.test.ts:178`。

**J-04：DSH 对 true／无 basis／提醒 1 的更正正确。**

准备使用已保存的 Session cursor；无 basis 时规则取该布尔值，启动再读取真实完成边界。源 Session 已完成一轮，故该 reused Query 应为 `true`、无 `sessionBasis`、提醒 1，不违反 F1。`src/core/agent-runtime/query-preparation.ts:329`；`src/core/agent-runtime/context-history-facts.ts:35`；`src/core/agent-runtime/query-execution.ts:585`；`tests/runtime/PC2-joint-query-history.test.ts:131`。剩余问题仅为 A3-04 的完整文本验收。

**4. 同一发现的 JSON**

```json
[
  {
    "id": "A3-01",
    "class": "会出错",
    "file": "tests/helpers/PC-platform-fixture.ts",
    "line": 587,
    "basis": ".lead-ref/books/pc2-r2-findings.md:30；.lead-ref/audit2/FX.out.md:77",
    "problem": "sourceHistory=completed_turn 完成首轮后直接 requeue，实际返回 busy：the selected Run is verifying; finalize its round first，无法返回预期的非空历史夹具。仅补结算还会遇到 Host workspaceRevision=1 与事实版本3不一致。",
    "fix": "仅在该显式分支启用公开 registerCheckConfiguration、openVerification、finalizeChecks；检查Host返回实际工作区版本，结算后重读Run revision再requeue。按正文补丁重新冻结，并补非空历史用例。"
  },
  {
    "id": "A3-02",
    "class": "违规",
    "file": "tests/state/PC2-G-query-bind-order.test.ts",
    "line": 61,
    "basis": ".lead-ref/books/pc2-r2-findings.md:58；.lead-ref/books/pc2-book.md:55",
    "problem": "G2-02通过commitRaw手写Project和Workspace事实，并手填Session创建事实后另造Query owner，不满足公开步骤要求。",
    "fix": "改用真实Query平台的公开创建、提交、领取和准备链，捕获实际装配的QueryExecutionPort，经公开材料接口保存反例后调用该实例bind；删除手写事实及另造owner。"
  },
  {
    "id": "A3-03",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 196,
    "basis": ".lead-ref/books/pc2-r2-findings.md:70；.lead-ref/audit2/J.out.md:7",
    "problem": "J2-03仍只检查brief前后缀，再以manifest正文作为请求期望；marker与BRE或BE之间多字仍可通过。",
    "fix": "启动后通过公开readContinuationBrief取得digest，独立拼完整marker加BRE或BE，分别整段比较准备正文和实际请求正文，删除前后缀及toContain(briefText)。"
  },
  {
    "id": "A3-04",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-query-history.test.ts",
    "line": 107,
    "basis": ".lead-ref/books/pc2-r2-findings.md:11；.lead-ref/books/pc2-r2-findings.md:72",
    "problem": "J-04真实启动已补，但源用户历史只检查marker前缀，当前Query输入只检查提醒等局部性质，未满足整文比较。",
    "fix": "为源用户输入和两种当前Query输入写独立完整期望并整文比较，保留助手回复、消息序列、basis及提醒断言，不复制捕获请求。"
  },
  {
    "id": "A3-05",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-budget.test.ts",
    "line": 216,
    "basis": ".lead-ref/books/pc2-r2-findings.md:74；.lead-ref/audit1/J.out.md:14",
    "problem": "J-08仅覆盖notes和reminders；inputs可通过公开追加新Task及输入要求构造。完整当前请求又以manifest.input作为期望，仍属自证。",
    "fix": "保留已有Task，公开追加带输入要求的新Task并完成同Session接续，验证非空inputs整体省略；用独立完整当前输入比较，动态标识由公开接口取得，保留footprint真实不可达说明。"
  }
]
```

会出错 1，违规 4，不整洁 0，建议 0