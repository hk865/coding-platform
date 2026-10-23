本次仅作静态只读审查，未运行测试、构建或修改文件。

下文 `pc1-book.md` 指 `.lead-ref/books/pc1-book.md`；`PROMPTS-SPEC.md` 指 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`；`pc1b-reply.md` 指 `.lead-ref/replies/pc1b-reply.md`。

1．发现表

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| P-01 | 会出错 | `src/core/agent-runtime/context-work-recipe.ts:151`；`src/core/agent-runtime/architecture-reminders.ts:193` | 裁定14，`pc1-book.md:330`、`:343` | 准备调用树仍直接读取生成包。输入：已解析包把 `architecture.noObservation` 改为 `CUSTOM`，架构尚无观测且预算足够。应输出 `CUSTOM`，实际仍输出平台的“还没有观测”。该 helper 不是启动期工具工厂，也不是业务层例外。 | **需 lead 扩白名单**：让 `architecture-reminders.ts` 的渲染调用链接收 `PromptTextsV1`，准备显式传入；仅无参纯渲染调用保留平台默认。 |
| P-02 | 会出错 | `src/contracts/core/prepared-execution.ts:134`；`src/contracts/prompts/render-template.ts:208`；`src/core/agent-runtime/execution-preparation.ts:510` | `PROMPTS-SPEC.md:96`；裁定14 | 必填槽渲染失败被归为 `unavailable`。输入：完整包仅把 `k3.none` 设为 `''`，复核没有已写结论；`writtenLines` 变空，renderer 抛错，准备返回 `unavailable`。规格要求 `invalid`；原平台文本为“（无）”，不会触发该错误。 | 给渲染契约错误明确的错误类型，准备将其映射为带包名、模板和原因的 `invalid`；读取失败仍保持 `unavailable`。 |
| P-03 | 会出错 | `src/core/agent-runtime/prompt-set-texts.ts:271` | 裁定15，`pc1-book.md:370`；`PROMPTS-SPEC.md:168` | 平台分支遗漏旧 loader 的 ID `trim`。显式配置 `enabledIds: [' platform-secretary ']` 被 Host 原样保留（`src/app/runtime-configuration.ts:415`）。旧 loader 先 trim 后选中 secretary（`vendor/coding-agent/dist/core/ports/skill_provider/skill-provider-port.js:7`、`vendor/coding-agent/dist/skills/registry/skill-registry.js:28`）；新代码直接查 Map，返回未知 ID 的 `invalid`。 | 平台分支在查 `PLATFORM_SKILLS` 前保持旧选择请求的规范化规则，至少恢复 ID 的 `trim`，再判断未知 ID。 |
| P-04 | 会出错 | `src/core/agent-runtime/context-rendering.ts:127`；`src/core/work-graph/state/context-input.ts:113`；`src/core/work-graph/tasks/execution-entry-service.ts:1131` | 裁定14；`PROMPTS-SPEC.md:90`；`pc1-book.md:343` | 省略标记已读包，守卫仍认固定文字。输入：完整包将 prefix/suffix 改为 `SKIP ` / ` rows`，预算导致至少一行省略。渲染得到 `SKIP 1 rows`；入口仍用固定中文正则，返回 `invalid`（`context-input.ts:60`、`:125`）。原默认标记可以通过；使用合法替换字符串后也应通过。 | **需 lead 扩白名单并裁定接缝**：将冻结的省略标记词汇传给守卫，按同一冻结文本校验；不提前改变 PC-2 的段序、区间或 suffix 算法。 |
| P-05 | 违规 | `tests/runtime/W2-role-skills.test.ts:129`、`:148`、`:161` | `pc1-book.md:56`、`:706`；`.lead-ref/books/run-pc1b.md:85` | 旧测试被削弱且延时。原真实请求测试检查 secretary+scribe 和显式空选择，并限时60000；新测试只保留 secretary，改为120000。新增准备级检查不能代替被删的模型请求断言。旧未知 ID/目录失败的模型零调用断言也未保留。旧证据：`.lead-ref/base/tests/runtime/W2-role-skills.test.ts:150`、`:155`、`:158`、`:215`。 | 恢复原真实请求的多选、空选、错误时零模型调用断言及原限时，仅按新冻结输入接口改接线。 |
| P-06 | 违规 | `tests/runtime/PC-prepare-skill-selection.test.ts:21`、`:39`；`tests/runtime/PC-prepare-review-freeze.test.ts:32`；`tests/contracts/PC-prompt-texts-store.test.ts:81` | `pc1-book.md:53`、`:627`、`:682` | 新测试的部分期望来自生产元数据、生成包或生产哈希函数。平台 Skill 输入本身就是生成包，故把生产选择器改为“忽略传入 texts，永远读生成包”，相关测试仍过；review 的冻结模板期望也取自同一生成包。 | 使用独立字面量和独立计算的摘要；通过公开准备步骤注入明显不同的平台 Skill 内容，核对冻结内容、元数据和 source。 |
| P-07 | 违规 | `tests/contracts/PC-prompt-texts.test.ts:42`；`tests/contracts/PC-prompt-texts-store.test.ts:110` | 裁定17、19；`pc1-book.md:395`、`:405`、`:53` | “摘要错误”样例同时改变长度：`你好`为6字节，`hello`为5；`SAME_TEXT`为9，`OTHER_TEXT`为10。因此删除 `checkPromptBody` 的正文哈希检查（`src/contracts/prompts/prompt-set.ts:212`），长度检查仍让这些负例通过。 | 将摘要篡改负例改成与原正文**等 UTF-8 字节长**、摘要不同的正文，保留独立的长度负例。 |
| P-08 | 违规 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:42`；`tests/work-graph/PC-entry-frozen-review.test.ts:42` | 裁定17；PC-06，`pc1-book.md:390`、`:679` | 两个入口用例只换模板，没有使用不同于平台默认的冻结字符串。把入口改为“冻结模板＋当前生成包 strings”仍能通过。另一个 review 准备用例虽然改了字符串，却没有启动入口（`tests/runtime/PC-prepare-review-freeze.test.ts:27`）。 | 两个入口用例都在准备前注入实际会用到的字符串字面量，准备后再改该值，然后启动并核对冻结结果。 |
| P-09 | 违规 | `tests/work-graph/PC-entry-frozen-continuation.test.ts:75` | 裁定17；`pc1-book.md:397`、`:53` | 所谓“入口读不到正文”测试让所有 prompt-text 读取失败；Runtime 在调用入口前已因 `readPromptTexts` 返回失败（`src/core/agent-runtime/execution-driver.ts:656`），入口调用在`:677`。删除入口自己的不可读处理，此测试仍过。 | 用真实公开准备结果调用公开入口授权步骤，仅在该步骤注入正文读取失败，直接断言入口 `unavailable`，并核对模型未调用。 |
| P-10 | 违规 | `tests/runtime/PC-prepare-prompt-freeze.test.ts:33`、`:67`、`:99` | 裁定14第1、2步；`pc1-book.md:323`、`:328`、`:53` | 没有在第一次 await 期间改变配置，也没有计数 resolve。把 selection/provider/model 的读取挪到 await 后，或对稳定 source resolve 两次，现有测试仍过；直接 helper 测试不证明公开准备步骤的顺序。 | 为 Work、Query 的公开准备注入可暂停且计数的 source；暂停期间改变原配置对象，断言冻结原 selection/provider/model、Work snapshot selection，以及 resolve 恰好一次。 |
| P-11 | 违规 | `tests/contracts/PC-prompt-texts-store.test.ts:53`、`:110`；`tests/runtime/PC-joint-record-and-failure.test.ts:138`、`:154` | 裁定14第6步；`pc1-book.md:355`、`:361`、`:53` | 没有公开准备步骤的 prompt-text put 失败用例。store 单测始终 put 成功；联合失败用例故障的是 `PROMPT_TOOL_SPECS_CONTENT_TYPE`，且要求准备成功。把准备阶段正文存储失败错误码改为 `invalid`，这些用例仍过。 | 用冻结夹具已有的 `failPutContentType`，分别令 Work、Query 的 prompt-text put 失败，断言准备 `unavailable`、没有可启动的 prepared 结果、模型零调用。 |
| P-12 | 不整洁 | `src/core/agent-runtime/execution-preparation.ts:62`；`src/core/agent-runtime/query-preparation.ts:160` | 注释准确性；`pc1-book.md:68` | 注释仍说缺少 `promptPacks` 就 `unavailable`，实际 `resolvePromptPack` 安装平台默认（`src/core/agent-runtime/prompt-set-texts.ts:102`）。 | 将两处注释改为当前默认行为及生产接线责任。 |
| P-13 | 建议 | `src/core/agent-runtime/context-rendering.ts:69`；`src/core/work-graph/state/context-input.ts:65` | 裁定18；`pc1-book.md:399` | 两份 call-kind 合法段表目前一致，但没有共同来源；新增或修改调用类时可以漂移。私有表解释了本轮为何复制，并不使长期保留两份成为必要。 | 由 lead 批准，将代码拥有的合法段表放到 contracts，Runtime 与 WorkGraph 各自引用，保持既有顺序和投影行为。 |

2．逐裁定、逐行核对

- **裁定14：P-01、P-02、P-04、P-06、P-10、P-11、P-12。** 当前取值时序正确：Work 在首次 resolve 前取 selection/provider/model，并复制 snapshot selection；Query 同样提前取值（`execution-preparation.ts:389`、`:424`、`:676`；`query-preparation.ts:229`、`:234`）。resolve 一次、拒绝转为含包名和原因的 `invalid` 当前实现正确（`prompt-set-texts.ts:105`、`:110`）。
- **裁定14第4步：OK。** Work、Query 都使用规定的 `'\n\n'` 条件合并（`execution-preparation.ts:525`；`query-preparation.ts:297`）。
- **裁定14第6步：实现OK，测试P-11。** 模板访问由 Proxy 记录；正文按内容去重；保存模板、整张 strings、合并 base、Skills；失败映射为 `unavailable`（`prompt-set-texts.ts:72`、`:136`、`:145`、`:155`）。Work/Query 传各自 run origin（`execution-preparation.ts:541`；`query-preparation.ts:313`）。
- **裁定14第7步：OK。** `promptSet` 进入 manifest，大小测量和最终摘要都包含它；原收缩算法、顺序保留（`execution-preparation.ts:581`、`:598`、`:610`；`query-preparation.ts:337`、`:341`）。
- **裁定15：P-03、P-06。** 其余实现符合：`path.resolve` 判根、元数据取 `PLATFORM_SKILLS`、正文取传入模板、source 格式正确；其他目录调用公开 loader；未选择默认 coding-safety，显式空列表保持空（`prompt-set-texts.ts:247`、`:266`、`:268`、`:274`、`:277`、`:283`）。
- **裁定17：实现OK；测试P-07、P-08、P-09。** 入口通过自身 `deps.bodies`、`decodePromptSetV1`、`checkPromptBody` 读取冻结模板和 strings；不可读为 `unavailable`，仍做原 suffix 比较，没有引入 Runtime 依赖（`execution-entry-service.ts:996`、`:1002`、`:1010`、`:1020`、`:1048`、`:1130`、`:1285`）。
- **裁定18：OK；整理建议P-13。** Work/continuation 与 planning/copy 的投影符合当前合法段表，未提前让守卫读取 `sectionOrder`（`context-rendering.ts:80`、`:90`、`:96`；`context-input.ts:65`）。
- **裁定19：实现OK；验证强度P-07、P-09。** 先校验所属 manifest，再读子 ref 并验内容；没有要求子正文 origin 等于当前 run（`execution-entry-service.ts:327`、`:336`、`:494`、`:1245`、`:1250`；`prompt-set-texts.ts:194`、`:210`）。
- **PC-06的P部分：P-06、P-08、P-09、P-10。** 已有 Work/Query 的准备内容检查和入口模板冻结检查，但上述变异仍可漏过（`PC-prepare-prompt-freeze.test.ts:33`、`:67`；`PC-entry-frozen-continuation.test.ts:28`；`PC-entry-frozen-review.test.ts:37`）。
- **W2：P-05。**
- **AG6：OK。** 选中三项、排除其他项及工具权限断言仍在（`tests/app/AG6-agent-assembly.test.ts:220`）。
- **C2：OK。** 改为准备所得冻结输入，显式空 Skill 的真实请求检查仍在（`tests/runtime/C2-runtime-platform-tools.test.ts:1`；相关变更见 `.lead-ref/parts/P.diff` 中该文件段）。
- **WP1、S3手写 manifest：OK。** 增加 `promptSet` 及其必要导入，没有借机改变业务事实（`tests/helpers/WP1-units-fixture.ts:501`、`:544`；`tests/work-graph/S3-prepared-context-admission.test.ts:80`、`:547`）。
- **K3-35：OK。** 新增字段及预期键有对应调整，裁剪断言保留（`tests/runtime/K3-35-manifest-trim-pure.test.ts:250`、`:283`、`:346`、`:412`）。
- **冻结夹具：OK。** `(captured as StartArgs)[1].prepared` 是类型断言，不改变运行期表达式（`tests/helpers/PC-platform-fixture.ts:529`）。
- **P文件范围：OK。** 清单中的30个文件符合白名单；P-01、P-04所需补修文件当前不在白名单，须由 lead 裁定扩入（`.lead-ref/parts/P-files.txt:1`；`.lead-ref/books/pc1b-whitelist.txt:1`）。

平台字节对照与边界补充：

- 对 `.lead-ref/base/` 的对应文本逐项静态核对后，未发现平台默认下 brief、review、fact text、context rendering 的字符串替换改变标点、换行或拼接行为。新代码只是把原固定字符串取值改为同键 `packString`，并显式传包；不能把这一静态结论表述为已跑完整输出测试（`src/contracts/continuation-brief.ts:370`、`:378`；`src/contracts/core/prepared-execution.ts:115`；`src/core/agent-runtime/context-fact-text.ts:29`；`src/core/agent-runtime/context-rendering.ts:24`）。
- `packString` 缺键直接抛 `Error`，不逐键回退。当前平台表包含这些被引用的键；但 **C的 `decodePromptSetV1` 只验证 strings 的 ref/digest 结构，不验证正文键集合**，因此“通过该 decoder”不能证明所有渲染键存在。正文读回也只检查其为字符串字典（`continuation-brief.ts:371`；`src/contracts/prompts/prompt-set.ts:181`；`prompt-set-texts.ts:225`）。错误归类问题见P-02。
- K3-35按夹具字面量重算：`promptSet` 为978字节，加顶层字段名及分隔符13字节，共增加 **991字节**。指令预算65536、manifest预算262144；保留13项展开内容时指令63263字节；继续按原顺序缩到9项时，新 manifest269673字节，仍超限；8项时为242181字节，通过。因此仍缩去24项，和旧边界相同（`K3-35-manifest-trim-pure.test.ts:57`、`:69`、`:215`、`:250`、`:283`）。此计算没有调用生产 renderer。

每个新测试至少会漏掉的一个变异如下；单项漏掉但由邻项覆盖的，不另列发现。

| 新测试位置 | 此测试会漏掉的变异 |
|---|---|
| `tests/contracts/PC-prompt-section-order.test.ts:12` | Work准备不使用投影 helper；公开准备用例另有检查。 |
| `tests/contracts/PC-prompt-section-order.test.ts:20` | Query准备不保存 helper 的结果；公开准备用例另有检查。 |
| `tests/contracts/PC-prompt-texts-store.test.ts:71` | put 使用错误 run origin；此例只核正文、去重及返回 set。 |
| `tests/contracts/PC-prompt-texts-store.test.ts:95` | 不校验 base/Skill 正文完整性；本例所有正文都有效。 |
| `tests/contracts/PC-prompt-texts-store.test.ts:110` | 删除正文哈希检查，仍由长度差拒绝；P-07。 |
| `tests/contracts/PC-prompt-texts.test.ts:38` | 删除负向校验，正确样例仍通过。 |
| `tests/contracts/PC-prompt-texts.test.ts:42` | 删除正文哈希检查；P-07。 |
| `tests/contracts/PC-prompt-texts.test.ts:47` | 删除 record.ref 与请求 ref 的长度一致性检查；本例两边一起改。 |
| `tests/contracts/PC-prompt-texts.test.ts:55` | 删除 record.ref 与请求 ref 的 contentType 一致性检查；`:61`另测。 |
| `tests/contracts/PC-prompt-texts.test.ts:61` | 删除正文哈希检查，ref差异仍足以拒绝。 |
| `tests/contracts/PC-prompt-texts.test.ts:70` | 删除摘要或长度校验；此例只区分 source。 |
| `tests/contracts/PC-prompt-texts.test.ts:79` | 不检查必填槽为空；该 base 没有槽。 |
| `tests/contracts/PC-prompt-texts.test.ts:85` | 仅对该模板无视传入文本、改读生成包；两份模板恰好相同。 |
| `tests/runtime/PC-prepare-prompt-freeze.test.ts:33` | await后才读选择，或重复resolve；P-10。 |
| `tests/runtime/PC-prepare-prompt-freeze.test.ts:67` | Query中的同类时序或重复resolve错误；P-10。 |
| `tests/runtime/PC-prepare-prompt-freeze.test.ts:99` | 多次解析稳定的默认source。 |
| `tests/runtime/PC-prepare-prompt-freeze.test.ts:108` | 对同一稳定拒绝source重复resolve。 |
| `tests/runtime/PC-prepare-prompt-freeze.test.ts:120` | 准备没有向角色 renderer 传 texts；它只直接测试 helper。 |
| `tests/runtime/PC-prepare-review-freeze.test.ts:24` | 入口使用生成包strings；此例不进入入口，见P-08。 |
| `tests/runtime/PC-prepare-skill-selection.test.ts:32` | 忽略传入texts、固定读取生成包；P-06。 |
| `tests/runtime/PC-prepare-skill-selection.test.ts:46` | Skill正文取错来源；本例仅核ID和空列表。 |
| `tests/runtime/PC-prepare-skill-selection.test.ts:56` | 将所有平台ID一概拒绝；其他正例才能抓住。 |
| `tests/runtime/PC-prepare-skill-selection.test.ts:64` | 不把调用者signal传给loader；本例没有取消。 |
| `tests/runtime/PC-prepare-skill-selection.test.ts:75` | 调完正确root/request后返回空skills；本例未核返回内容。 |
| `tests/work-graph/PC-entry-frozen-continuation.test.ts:28` | 冻结模板配生成包strings；P-08。 |
| `tests/work-graph/PC-entry-frozen-continuation.test.ts:60` | 删除入口不可读处理；Runtime提前拒绝，见P-09。 |
| `tests/work-graph/PC-entry-frozen-review.test.ts:37` | 冻结模板配生成包strings；P-08。 |

3．DSH自述核对

- **§1.1／§4.2／§9.3：冲突说明成立，处理不成立。** 无 selection 就跳过模型核对的分支确实存在，但裁定16要求通过 `promptSelectionOf` 比较，并未给予测试模型豁免；应修夹具一致性，不能为旧测试放宽生产规则。此项归S，不重复编P号（`pc1b-reply.md:5`、`:51`、`:114`；`src/core/agent-runtime/execution-driver.ts:121`；`src/core/agent-runtime/query-execution.ts:100`；`pc1-book.md:383`）。
- **§1.2／§4.3／§9.2：关于冻结helper缺陷成立。** 它传 `tools: []`，WP2把它放进Role规格；校验明确不许空数组，安装失败后夹具抛错。不是只有运行后才能识别的问题（`tests/helpers/PC-platform-fixture.ts:617`；`tests/helpers/WP2-platform-support.ts:560`、`:571`；`src/contracts/validation/role.ts:57`；`src/contracts/validation/common.ts:85`）。P的那一行类型修改没有修复或掩盖此运行期问题（`PC-platform-fixture.ts:529`）。
- **§1.5：不能作为完成度依据。** 体量估算不证明覆盖完整；P-01就是大规模字符串接线中仍留下的准备调用树遗漏（`pc1b-reply.md:9`；`architecture-reminders.ts:193`）。
- **§4.4：行为说明成立。** 缺source会安装平台source，点名包被拒仍转成 `invalid`，不会再尝试platform（`prompt-set-texts.ts:102`、`:110`）。书指定的 `runtime.ts` 默认也实际存在，当前生产准备调用者从该处取得依赖，composition亦显式接线，因此**未证明当前生产存在被隐藏的漏接线**；只是准备层再次兜底，使直接调用者无法靠缺依赖暴露接线错误（`src/core/agent-runtime/runtime.ts:543`、`:547`、`:877`；`src/composition/create-platform.ts:1188`）。相关注释错误为P-12。
- **§4.5：作为当前存储契约允许的来源标签成立；作为完整版本溯源不成立。** 实际所有正文使用 packId＋base.version；它不能代表继承模板各自的版本或自定义Skill文件版本。当前冻结内容真实性靠内容摘要，模板实际来源另有各自的 packId/version，未发现该标签导致读取错误（`prompt-set-texts.ts:137`、`:155`、`:175`；`src/contracts/prompts/prompt-set.ts:212`）。不能把这个 governance ref 解读为“所有正文都来自该base版本”。
- **§4.6：成立。** `PromptSkillV1`保留所需Skill字段，平台构造及自定义loader映射保持内容和source形状（`prompt-set-texts.ts:276`、`:286`）。
- **§4.8：`texts?`成立；复制表的理由成立，但不是长期必须保留两份。** 无参纯renderer兼容是书允许的，生产准备显式传值；表目前一致，漂移风险见P-13（`pc1-book.md:347`；`src/core/agent-runtime/context-types.ts:62`、`:70`；`execution-preparation.ts:507`；`context-rendering.ts:69`）。
- **§4.9：成立。** 冻结夹具只改类型断言（`tests/helpers/PC-platform-fixture.ts:529`）。
- **§8“准备调用树只剩无参默认import”：不成立。** 架构提醒直接读取生成包，见P-01（`pc1b-reply.md:108`；`context-work-recipe.ts:151`；`architecture-reminders.ts:193`）。
- **§9.6：成立。** 工作表已经说明 `RuntimeDeps` 是代码中 `RuntimeExecutionDependencies` 的简称，不构成接口缺失（`.lead-ref/books/run-pc1b.md:71`）。
- **§7关于旧测试覆盖均保留：不成立。** W2删掉了真实请求断言并延时，见P-05（`pc1b-reply.md:96`；`W2-role-skills.test.ts:161`）。

§1.3／§9.1、§1.4／§8的PC-15、§9.4以及读口工厂争议属于其他组；这里没有把它们算成P已完成或P发现。

4．同一发现表的JSON

```json
[
  {
    "id": "P-01",
    "class": "会出错",
    "file": "src/core/agent-runtime/context-work-recipe.ts",
    "line": 151,
    "basis": ".lead-ref/books/pc1-book.md:330、343，裁定14",
    "problem": "准备调用树中的architectureReminderRowEntries仍在architecture-reminders.ts:193直接读生成包。注入architecture.noObservation=CUSTOM且无观测时，应输出CUSTOM，实际输出平台的“还没有观测”。",
    "fix": "由lead扩白名单，让architecture-reminders.ts的渲染链接收PromptTextsV1，准备显式传入；只给无参纯渲染调用保留平台默认。"
  },
  {
    "id": "P-02",
    "class": "会出错",
    "file": "src/core/agent-runtime/execution-preparation.ts",
    "line": 510,
    "basis": "docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:96",
    "problem": "完整包将k3.none设为空且复核没有已写结论时，prepared-execution.ts:134产生空writtenLines，render-template.ts:208抛错，准备返回unavailable；规格要求invalid。",
    "fix": "给渲染契约错误明确类型，准备映射成带包名、模板和原因的invalid，读取失败仍保持unavailable。"
  },
  {
    "id": "P-03",
    "class": "会出错",
    "file": "src/core/agent-runtime/prompt-set-texts.ts",
    "line": 271,
    "basis": ".lead-ref/books/pc1-book.md:370；PROMPTS-SPEC.md:168",
    "problem": "平台Skill分支未保持旧loader的ID trim。enabledIds为[' platform-secretary ']时，旧loader规范化后成功，新分支直接Map查找并返回invalid；Host在runtime-configuration.ts:415保留该输入。",
    "fix": "平台分支在查PLATFORM_SKILLS前保持旧选择请求的规范化规则，恢复ID trim，再判断未知ID。"
  },
  {
    "id": "P-04",
    "class": "会出错",
    "file": "src/core/agent-runtime/context-rendering.ts",
    "line": 127,
    "basis": ".lead-ref/books/pc1-book.md:343；PROMPTS-SPEC.md:90",
    "problem": "省略标记使用包中的prefix/suffix，state/context-input.ts:113仍校验固定中文。合法包改为SKIP / rows且发生省略时，渲染SKIP 1 rows，入口返回invalid；默认中文可通过。",
    "fix": "由lead扩白名单并裁定接缝，将冻结省略词汇传给守卫校验；保持PC-1现有段序、区间及suffix算法。"
  },
  {
    "id": "P-05",
    "class": "违规",
    "file": "tests/runtime/W2-role-skills.test.ts",
    "line": 161,
    "basis": ".lead-ref/books/pc1-book.md:56、706；.lead-ref/books/run-pc1b.md:85",
    "problem": "相对base，删去真实请求的secretary+scribe、显式空选择断言，错误场景的模型零调用断言也未保留；同一真实请求测试由60000延长到120000。准备级检查不能替代原断言。",
    "fix": "恢复原多选、空选和错误时零模型调用的真实请求断言及原限时，仅改接冻结输入接口。"
  },
  {
    "id": "P-06",
    "class": "违规",
    "file": "tests/runtime/PC-prepare-skill-selection.test.ts",
    "line": 21,
    "basis": ".lead-ref/books/pc1-book.md:53、627、682",
    "problem": "Skill输入和期望来自生成包及生产元数据，review期望和部分摘要也来自生产代码。选择器忽略传入texts、固定读取生成包的变异仍通过；相关位置还包括PC-prepare-review-freeze.test.ts:32及PC-prompt-texts-store.test.ts:81。",
    "fix": "使用独立字面量和独立摘要计算，通过公开准备注入明显不同的平台Skill内容并核对冻结内容、元数据及source。"
  },
  {
    "id": "P-07",
    "class": "违规",
    "file": "tests/contracts/PC-prompt-texts.test.ts",
    "line": 42,
    "basis": ".lead-ref/books/pc1-book.md:395、405、53",
    "problem": "摘要负例同时改变UTF-8长度：你好6字节对hello5字节；PC-prompt-texts-store.test.ts:110使用SAME_TEXT9字节对OTHER_TEXT10字节。删掉正文哈希校验仍由长度校验拒绝。",
    "fix": "摘要篡改用等UTF-8字节长而摘要不同的正文，独立保留长度负例。"
  },
  {
    "id": "P-08",
    "class": "违规",
    "file": "tests/work-graph/PC-entry-frozen-continuation.test.ts",
    "line": 42,
    "basis": ".lead-ref/books/pc1-book.md:390、679，裁定17及PC-06",
    "problem": "continuation和PC-entry-frozen-review.test.ts:42只改变模板，未使用不同于默认的冻结字符串。入口改为冻结模板配生成包strings仍通过；修改字符串的准备测试没有启动入口。",
    "fix": "两个入口用例均在准备前注入实际使用的字符串字面量，准备后再改值，再启动并核对冻结结果。"
  },
  {
    "id": "P-09",
    "class": "违规",
    "file": "tests/work-graph/PC-entry-frozen-continuation.test.ts",
    "line": 75,
    "basis": ".lead-ref/books/pc1-book.md:397、53",
    "problem": "所有prompt-text读取都失败，execution-driver.ts:656在调用入口的:677之前已返回unavailable。删除入口自身的不可读处理，该测试仍通过。",
    "fix": "以真实公开准备结果调用公开入口授权步骤，只在该步骤注入读取失败，直接核对入口unavailable及模型未调用。"
  },
  {
    "id": "P-10",
    "class": "违规",
    "file": "tests/runtime/PC-prepare-prompt-freeze.test.ts",
    "line": 33,
    "basis": ".lead-ref/books/pc1-book.md:323、328、53",
    "problem": "Work和Query测试没有在首次await期间改变配置，也没有计数resolve；await后才读取选择或对稳定source重复resolve的变异仍通过，直接helper测试不能证明公开准备时序。",
    "fix": "为Work和Query公开准备注入可暂停且计数的source，暂停期间修改原配置，断言原selection/provider/model、Work snapshot selection及resolve恰好一次。"
  },
  {
    "id": "P-11",
    "class": "违规",
    "file": "tests/contracts/PC-prompt-texts-store.test.ts",
    "line": 53,
    "basis": ".lead-ref/books/pc1-book.md:355、361、53",
    "problem": "store单测put始终成功；联合失败用例只令PROMPT_TOOL_SPECS_CONTENT_TYPE失败且要求准备成功，没有公开Work/Query准备的prompt-text put失败用例。把该失败映射为invalid仍不会被抓住。",
    "fix": "使用冻结夹具的failPutContentType，让Work和Query的prompt-text put失败，核对准备unavailable、无可启动prepared结果、模型零调用。"
  },
  {
    "id": "P-12",
    "class": "不整洁",
    "file": "src/core/agent-runtime/execution-preparation.ts",
    "line": 62,
    "basis": ".lead-ref/books/pc1-book.md:68",
    "problem": "此处和query-preparation.ts:160注释称缺promptPacks返回unavailable，实际prompt-set-texts.ts:102安装平台默认。",
    "fix": "更新两处注释，准确说明默认行为及生产接线责任。"
  },
  {
    "id": "P-13",
    "class": "建议",
    "file": "src/core/agent-runtime/context-rendering.ts",
    "line": 69,
    "basis": ".lead-ref/books/pc1-book.md:399，裁定18",
    "problem": "这里与state/context-input.ts:65各自维护call-kind合法段表，目前一致但没有共同来源，后续可漂移。",
    "fix": "由lead批准将代码拥有的合法段表放入contracts，Runtime和WorkGraph共同引用，保持现有投影行为。"
  }
]
```

会出错 4，违规 7，不整洁 1，建议 1