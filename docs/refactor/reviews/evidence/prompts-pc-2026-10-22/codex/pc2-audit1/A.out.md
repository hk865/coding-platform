静态审查发现 **13 项：2 项行为偏差、8 项违规、3 项不整洁**。未修改文件，未运行测试、构建或网络操作。

下文简称均指唯一文件：`书`为 `.lead-ref/books/pc2-book.md`；`解析测试`为 `tests/contracts/PC2-resolve-pack.test.ts`；`块测试`为 `tests/contracts/PC2-tool-blocks.test.ts`；`解码测试`为 `tests/contracts/PC-prompt-set-v1.test.ts`。其余使用实际文件名及行号。

| 编号 | 类别 | 位置 | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| A-01 | 会出错 | `src/contracts/prompts/render-template.ts:220`；`src/contracts/prompts/resolve-pack.ts:223`、`:323` | 书`:167`，裁定4要求一次收齐问题 | **存在错误短路。** 个人包把 `unknown-call-review` 写成普通文字 `X`，应同时报告缺 `workspaceLines`、`writtenLines`，实际只报告前者。`list_files.parameters={"other":3}` 应同时报告参数值不是字符串、键集不同，实际跳过键集检查。固定字符串值不是字符串时，也跳过“固定键”检查。 | 累积所有能够独立判定的问题；模板校验返回问题集合，渲染需要抛异常时取其中一个。补上述多错误输入的完整字面问题列表。 |
| A-02 | 会出错 | `src/contracts/prompts/resolve-pack.ts:310` | 书`:153`，裁定4只禁止空描述；回复 `.lead-ref/replies/pc2-reply.md:55` | **擅自把“空”扩大为“纯空白”。** 输入合法继承包、`record_note.description=" "`、`parameters={}`：按书应接受并保留文字，实际拒绝为 `tool record_note has an empty description`。人会在保存和下一次准备时看到拒绝。回复确实说明了，但这不属于书允许自行选择的内容。 | 保留字符串类型检查，将空判断改为 `description === ''`，并补纯空白描述的接受例。 |
| A-03 | 不整洁 | `src/contracts/prompts/render-template.ts:234` | 书`:163`；回复`:8` | **“section 不属于模板”分支不可达。** `registerSlot` 已保证名字属于当前槽表；`collectSectionUses` 又只收 `SECTION_NAMES` 中的名字；`expected` 正是这两个集合的交集。因而每个收集到的 `use.name` 必在 `expected` 中。 | 删除这条后置分支，保留前面的“未声明槽”拒绝。无需修改 `section-extra` 夹具。 |
| A-04 | 违规 | `tests/contracts/PC2-resolve-pack.test.ts:22`、`:196` | 书`:141`、`:163`、`:826`，PC-02；运行单 `.lead-ref/books/run-pc2.md:66` | **50 个坏包没有覆盖全部必要校验。** 例如模板 `file` 非字符串、模板条目非对象，以及用顶层 `{{#role}}…{{/role}}` 代替直接 section 槽，都没有对应例；分别删掉解析器 `resolve-pack.ts:245`、`:256` 和 `render-template.ts:231` 的 `use.block` 条件，现有 A 测试不会发现。其他缺口见后面的检查表。 | 用现有 `pc2PackEntry` 构造遗漏输入，补齐对应的字面问题对象；特别区分“嵌套 section”与“section 自己是块”。不改冻结夹具。 |
| A-05 | 违规 | `tests/contracts/PC2-resolve-pack.test.ts:207`、`:218` | 书`:136`、`:139`、`:148`，裁定4 | **成功解析断言遗漏有效 manifest、字符串合并和非空参数覆盖。** PC-03 不检查返回的 `manifest`、`strings`；PC-25 只覆盖参数为空的 `record_note`。返回平台 manifest、漏掉字符串覆盖，或者工具描述取子包但参数仍取平台，都能通过相应 A 用例。 | 增加完整字面结果断言：请求包自己的 manifest、子覆盖父且保留未覆盖键的字符串表，以及覆盖 `list_files.prefix` 的整个工具条目。 |
| A-06 | 违规 | `tests/contracts/PC2-resolve-pack.test.ts:161`、`:212` | 书`:142`，裁定4；检查裁定 C2：`.lead-ref/books/pc2-chk2-rulings.md:21` | **继承声明来源没有被测住。** 所有预期 `mentionsTools` 都是 `[]`；夹具里的有效模板声明也都默认空数组。把来源声明错误地改成“从请求包 manifest 取，缺少就 `[]`”，仍能通过 A 的来源断言。中间父包供应、子包未覆盖的模板也没有区分例。 | 用现有夹具构造器增加父包供应的模板，赋予不同版本及非空声明；逐字断言供应包、供应版本、供应声明三项。 |
| A-07 | 违规 | `tests/contracts/PC-prompt-set-v1.test.ts:20`、`:238` | 书`:676`，裁定19；运行单`:66` | **规范正文的参数排序没有验收测试。** 解码测试中的正文和摘要只是输入常量，没有调用 `canonicalToolTextBody`；已有工具冻结和路由例仅断言空参数或单个 `prefix`。删除规范正文的参数排序，相关断言仍不变。 | 增加公开规范化函数测试：用插入顺序相反、英文排序与码点排序不同的至少两个键，比较完整字面 JSON 和该字面 JSON 的独立 SHA-256。 |
| A-08 | 违规 | `tests/contracts/PC2-tool-blocks.test.ts:16`；`tests/contracts/PC2-resolve-pack.test.ts:201` | 书`:169`、`:178`，裁定4错误接口 | **`PromptRenderError` 的公开字段没有被验收。** 坏包测试只看到转换后的消息；块测试只有成功输出。删掉 `code`、`templateId` 或 `slot` 的赋值，或者将必填空槽改回普通 `Error`，A 测试都不会失败。 | 经 `renderTemplate` 补三类错误测试，分别断言错误类、`code`、`templateId`、`slot`，使用独立字面期望。 |
| A-09 | 违规 | `.lead-ref/replies/pc2-reply.md:7`；`tests/runtime/PC2-review-shrink.test.ts:25` | 书`:185`、`:810`；PE8，归 Q，关联 A 的错误接口 | **把预期拒绝误当夹具不可用，漏掉 PE8。** `openPC2ReviewFixture('empty')` 注入 `k3.none=''`；夹具会返回 `preparation`，并不要求它 ready。只有调用 `start()` 才要求 ready。得到 `invalid` 正是这行要验收的结果。 | 由 lead 转交 Q：使用现有 `empty` 模式，直接断言 `fixture.preparation` 的完整 `invalid` 结果，不调用 `start()`。夹具无需补丁。 |
| A-10 | 违规 | `.lead-ref/parts/A.diff:718`；`tests/contracts/PC-prompt-set-v1.test.ts:63`、`:150` | 书`:58`、`:913`；运行单`:87` | **改了未列入旧测试修改授权的文件。** 此文件符合路径白名单，修改也没有削弱旧断言，但不在 §5.3，亦不命中其手写 binding/manifest 检索条件。回复承认修改，不能替代授权。 | 需 lead 补一条书面裁定：将该文件列入 §5.3、归 A，明确只允许新增字段及其严格解码测试；保留当前旧断言。 |
| A-11 | 违规 | `tests/contracts/PC-prompt-set-v1.test.ts:63`、`:239` | 书`:594`、`:654`，L2、裁定19 | **“不排序 toolNames”的正例会被原地修改骗过。** 输入和期望共用 `VALID`。若解码器先对传入的 `toolNames.sort()`，再返回原对象，期望也一起变化，`toEqual(VALID)` 仍通过。 | 将返回清单与独立字面 `['read','edit','shell']` 比较，同时断言传入清单仍等于这份独立字面值。 |
| A-12 | 不整洁 | `src/contracts/prompts/prompt-pack.ts:4`、`:60`；`prompt-set.ts:77`；`slot-tables.ts:12`、`:78`；`resolve-pack.ts:2`；`render-template.ts:284` | 书`:64`；本次审查的注释要求 | **当前规则说明陈旧，并混入施工历史。** 仍说段序留在代码、输入模板以后才到、冻结集保存 PC-1 固定顺序；另有“PC-2 swaps”“PC-2 ruling”“platform v1 没使用”等施工或旧版本叙述。 | 将这些注释统一改成当前职责和约束，删除施工批次叙述；明确输入模板决定段序、默认源与磁盘源的当前用途。 |
| A-13 | 不整洁 | `src/contracts/prompts/resolve-pack.ts:123`、`:167` | 本次审查的死代码要求 | `validateIdentity` 接收 `_index`、`_length`，函数体完全不使用；它只检查 manifest 的包名。 | 删除两个形参及对应实参。 |

逐项检查如下。下表中的“无”指没有找到能针对该检查失败的 **A 测试**，不表示实现没有检查；表中单个分支遗漏并不另重复编号。

| 裁定4检查 | 实现位置 | 删除检查后会失败的用例／覆盖缺口 |
|---|---|---|
| `schemaVersion === 1` | `resolve-pack.ts:122` | `rejects schema-version…`，解析测试`:23`、`:197` |
| manifest 包名等于链条目 | `resolve-pack.ts:172` | `identity`，解析测试`:24` |
| 包名语法 | `resolve-pack.ts:171` | `id-syntax`，解析测试`:25`；包名非字符串分支`:170`无独立例 |
| 平台 `extends=null` | `resolve-pack.ts:180` | `platform-parent`，解析测试`:128` |
| 非平台必须有一个父包 | `resolve-pack.ts:184` | `null-parent`，解析测试`:26`；空字符串及其他类型无独立例 |
| 父包存在、链相邻一致 | `resolve-pack.ts:189`、`:194` | `missing-parent`、`cycle`、`duplicate-id`，解析测试`:27`、`:129`、`:134` |
| 每个包名只出现一次 | `resolve-pack.ts:90` | `duplicate-id`，解析测试`:129` |
| 链以平台结束 | `resolve-pack.ts:96` | `no-platform`，解析测试`:133` |
| 平台不能在中途 | `resolve-pack.ts:92` | 无；现有 `duplicate-id` 重复的是 `pc2-parent`，夹具 `PC2-pack-fixture.ts:211` |
| 空链拒绝 | `resolve-pack.ts:82` | 无 |
| 无环 | `resolve-pack.ts:90`、`:194` | `cycle`，解析测试`:134`。唯一、相邻一致、以平台结束且平台无父，已共同排除环；不必另有名为“cycle”的纯解析分支 |
| 返回请求包自身 manifest | `resolve-pack.ts:157` | 无直接断言，A-05 |
| 字符串表为对象、值为字符串 | `resolve-pack.ts:216`、`:222` | `strings-object`、`string-value`，解析测试`:33`、`:34` |
| 未知字符串键 | `resolve-pack.ts:228` | `unknown-string`，解析测试`:35` |
| 四个固定字符串键 | `resolve-pack.ts:227` | `fixed-heading/prefix/suffix/nameseparator`，解析测试`:36`；值同时错类型时漏报，A-01 |
| 字符串按键子覆盖父 | `resolve-pack.ts:149` | 无结果断言，A-05 |
| 模板集合、条目为对象 | `resolve-pack.ts:236`、`:245` | 无，A-04 |
| 模板文件字段及实际文件 | `resolve-pack.ts:256`、`:266` | `template-file-missing`，解析测试`:56`；非字符串、供应文件名不符无独立例，A-04 |
| 文件相对路径、禁止 `..` 段 | `resolve-pack.ts:33` | `template-file-parent/absolute`，解析测试`:59`；空路径、Windows 绝对路径无独立例 |
| 正整数模板版本 | `resolve-pack.ts:250` | `version-0/minus1/1minus5`，解析测试`:45` |
| `mentionsTools` 为字符串数组 | `resolve-pack.ts:253` | `mentions-array/value`，解析测试`:50` |
| 最近模板覆盖 | `resolve-pack.ts:138`、`:142` | PC-03 的 `keeps the platform templates…`，解析测试`:207`；中间父包供应的未覆盖模板未区分，A-06 |
| 来源包与版本来自供应项 | `resolve-pack.ts:143` | PC-03 完整 origins 断言，解析测试`:165`、`:212` |
| 来源声明来自供应项 | `resolve-pack.ts:146` | 只有全空声明，不能区分错误来源，A-06 |
| 最近包供应整个工具条目 | `resolve-pack.ts:151` | PC-25 `takes only record_note…`，解析测试`:218`；非空参数替换没有区分例，A-05 |
| `toolOrigins` | `resolve-pack.ts:154` | PC-25 完整映射，解析测试`:226` |
| 平台无文字的工具拒绝 | `resolve-pack.ts:285` | `tool-shell/read/pc2-unknown-tool`，解析测试`:105` |
| 空描述拒绝 | `resolve-pack.ts:310` | `tool-empty`，解析测试`:110`；纯空白的额外拒绝见 A-02 |
| 参数对象、字符串参数值 | `resolve-pack.ts:313`、`:319` | `tool-parameters-object/value`，解析测试`:111` |
| 参数键集完全一致 | `resolve-pack.ts:325`、`:350` | `tool-prefix-missing/extra`，解析测试`:117`；**只比较键数**的变异仍会通过这两个例 |
| 工具文件声明和正文形状 | `resolve-pack.ts:280`、`:289`、`:303` | `tool-file-missing`、`tool-json`，解析测试`:121`；集合非对象、文件字段非字符串、正文为合法 JSON 数组均无例，A-04 |
| 未知模板 | `resolve-pack.ts:241` | `unknown-template`，解析测试`:42` |
| 未知槽 | `render-template.ts:104` | `unknown-slot`，解析测试`:65` |
| 槽使用两次 | `render-template.ts:108` | `duplicate-slot`，解析测试`:68` |
| 必填槽缺失 | `render-template.ts:220` | `required-slot-missing`，解析测试`:72` |
| 游离 `{{` | `render-template.ts:69`、`:134` | `stray-open`，解析测试`:76` |
| 未闭合、错配块 | `render-template.ts:140`、`:165` | `unclosed-block/mismatched-block`，解析测试`:77` |
| 输入 section 必须顶层直接槽 | `render-template.ts:231` | 嵌套由 `section-nested` 覆盖，解析测试`:84`；顶层 section 块无例，A-04 |
| 输入 section 不得缺少 | `render-template.ts:239` | `section-missing`，解析测试`:88` |
| 输入 section 不得多出 | `render-template.ts:104` | `section-extra`，解析测试`:93`；后置分支是 A-03 |
| 非法段序、重复段 | `render-template.ts:244`、`:108` | `role-not-first`、`section-twice`，解析测试`:97`、`:101` |
| 一次收齐、从不抛出 | `resolve-pack.ts:119`、`:270` | 50 个输入均有 `not.toThrow` 和完整问题比较，解析测试`:200`；不能证明多错误收齐，且 A-01 已给出反例 |

50 个坏包的期望理由确实是手写字面；`packId`、`templateId`（包括 `null`）、`reason`，以及工具问题的 `toolName`，均随整个问题列表比较，并非只检查状态或消息片段。依据是解析测试`:14`、`:22`、`:201`。但“50 项与夹具一一对应”（`:193`）只证明夹具清单没有漏配期望，不等于书的全部规则都有区分性输入。

其余重点结论：

- **普通 `Error` 没有找到可由磁盘个人包触发的反例。** 未声明模板先在解析时被拒绝（`resolve-pack.ts:241`）；遗漏模板继承平台供应项（`:138`），磁盘源固定补入生成的平台包（`src/app/prompt-packs.ts:230`）。调用槽名由调用方代码提供，包只改变文字。`render-template.ts:305`、`:308` 保留普通错误，目前不能据此判成个人包被错误映射为 `unavailable`。坏包由磁盘端口返回 `invalid`（`prompt-packs.ts:242`）；必填空槽通过 `PromptRenderError` 映射为 `invalid`（`src/core/agent-runtime/prompt-set-texts.ts:107`、`execution-preparation.ts:570`、`query-preparation.ts:324`）。
- **段集合当前一致，但可以漂移，没有专门把两表钉为相等的测试。** 槽表在 `slot-tables.ts:17`；解析器取其 section 交集（`render-template.ts:228`）；守卫另有 `state/context-input.ts:60`；渲染投影还有 `context-rendering.ts:67`。当前 Work 联集及两个 Query 集合对应一致。`PC-prompt-section-order.test.ts:15` 检查渲染投影，`PC2-G-context-order.test.ts:82` 检查部分守卫拒绝，二者没有完整的跨表等价断言。这里不把尚未发生的漂移列成行为错误。
- **规范化实现的排序一致。** 参数键使用英文 `localeCompare`（`prompt-set.ts:231`）；实际存储的工具数组也如此（`prompt-set-texts.ts:220`）；解码器按同一顺序检查（`prompt-set.ts:218`）。路由使用同一个正文函数和摘要函数（`src/app/host-settings.ts:1093`、`:1125`），没有另起算法。问题是 A-07 的测试缺口。
- **解码器会接受“形状正确但实际顺序错误”的 `toolNames`。这是其职责边界，不是漏掉排序校验。** L2 只要求 distinct/non-empty string array（书`:594`），解码器照做（`prompt-set.ts:207`）；它没有本次运行的权威清单可比较。Work、Query 启动分别逐元素比较重算结果（`execution-driver.ts:574`、`query-execution.ts:312`）。重复 `toolNames`、乱序/重复 `tools`、条目额外键都会拒绝；对应测试在解码测试`:152`、`:164`、`:168`、`:169`。英文排序与码点排序的区别也有负例（`:175`）。不应添加“看见已排序 toolNames 就拒绝”的规则。
- **两字段确实进入 manifest。** 存储层原样复制 `toolNames`、写入 `tools`（`prompt-set-texts.ts:237`）；Work manifest 放入整个 `promptSet`（`execution-preparation.ts:669`），随后整体序列化、计量、存储（`:707`、`:716`）；Query 同样在 `query-preparation.ts:395`、`:399`、`:405`。不存在 A 类型新增后被这两处摘要范围漏掉的情况。
- **PC-01 达到书规定的两个工具集和整行删除例。** `块测试:18`、`:25` 分别比较完整 `BASE\nEDIT\nEND\n`、`BASE\nEND\n`。它会漏掉“只处理无缩进 LF 标记行”的变异，因为冻结输入就是这种格式（`PC2-pack-fixture.ts:92`）；也会漏掉把工具名硬编码为 `edit` 的变异。这里不把书指定的单块例说成所有标记格式均已覆盖。
- **PC-25 指定的分辨点齐全。** `record_note` 描述覆盖、其他工具保留、仅该工具的来源变成子包，都有完整断言（解析测试`:222`、`:226`）；`shell`、空描述、缺 `prefix`、多 `prefix.extra` 有完整问题断言（`:229`）。它们分别仍会漏掉：覆盖时沿用父参数；只正确处理 `record_note` 的来源；额外放行 `read`（这一项另被 PC-02 捕获）；只对 `record_note` 检查空描述；参数只比数量。不能由这些例推断全部工具及键集变体均受保护。
- **A 的生产新增出口有实际消费者，没有找到仅供测试通过的生产路径。** 解析结果供 renderer、resolver 使用（`render-template.ts:309`、`resolve-pack.ts:270`）；规范正文供存储和路由使用，位置见上。A 的文件路径符合白名单（`.lead-ref/parts/A-files.txt:1`、`.lead-ref/books/pc2-whitelist.txt:1`、`:17`），`graph-context.ts` 只增加所要求的字段（`.lead-ref/parts/A.diff:5`）。提供的分组清单没有 A 与其他组的文件交集；冻结夹具未出现在改动清单中。没有基线夹具副本可作四文件独立字节核验，因此不把 DSH 的“未改”声明升级成已核验哈希结论。
- **没有在 A 差异中证明平台默认输入存在额外字节回归。** 原输出拼接和区间计算保留，新增的是校验、错误类型及书要求的冻结字段（`.lead-ref/parts/A.diff:209`、`:307`、`:334`）。旧测试也未删弱原断言；其问题是修改授权缺项 A-10，而非断言放宽（同 diff`:722`、`:835`）。

逐裁定、逐行：

- 裁定4：A-01、A-02、A-03、A-04、A-05、A-06、A-08、A-09。
- 裁定5：A-01（与错类型同时发生时漏报）；四个独立固定键检查及用例正确，`resolve-pack.ts:227`、解析测试`:36`。
- 裁定9，A 的模板校验部分：A-03、A-04。
- 裁定19及 L2：A-07、A-11；类型、当前排序和严格形状解码实现正确，`prompt-set.ts:102`、`:161`、`:207`、`:229`。
- §4 A 的生产归属及 `sectionOrder` 类型：OK，书`:761`、`graph-context.ts:109`。
- PC-01：OK，块测试`:16`。
- PC-02：A-01、A-04。
- PC-03，解析部分：A-05、A-06。
- PC-22，加载部分：OK，解析测试`:245`。
- PC-25，书指定的解析例：OK；整条工具覆盖规则的额外未区分处见 A-05。
- `PromptRenderError` 字段及必填空槽使用：实现 OK；验收缺口 A-08、A-09。
- 旧测试、注释及清理要求：A-10、A-12、A-13。

DSH 自述核对：

- 回复 §1.4：**成立。** `section-extra` 应保留 parser 的“未声明槽”消息；不可达的是 `render-template.ts:234`，并非夹具缺陷。见 A-03。
- 回复 §1.3 中“empty 夹具不可用”：**不成立。** 夹具返回拒绝结果的代码在 `PC2-pack-fixture.ts:357`、`:369`；仅 `start()` 有 ready 限制（`:371`）。这是现成 PE8 输入，见 A-09。无需夹具补丁。
- 回复 §8.1 的错误类选择：**成立。** 三类代码及字段符合书；普通调用错误没有证明可由磁盘个人包触发错误分类。实现位置为 `render-template.ts:21`、`:305`、`:319`。
- 回复 §8.1 的 section 集来自槽表：**成立。** 当前集合对应正确；“因此不会漂移”则没有依据，相关独立表及测试位置见上。
- 回复 §8.1 的规范正文英文排序：**成立。** 正文、工具数组、路由一致；测试不足见 A-07。
- 回复 §8.1 的环用邻接问题呈现：**成立。** 书允许选择问题字段，没有要求固定环消息；当前链约束足以拒绝环，`resolve-pack.ts:90`、`:181`、`:194`。
- 回复 §8.1 的纯空白描述也拒绝：**实现陈述成立，作为合规选择不成立。** 会影响人的保存和准备，且已在回复说明；书未授权扩大条件，见 A-02。
- 回复 §3 的“50 个坏包各有字面理由”：**成立；完整覆盖所有检查的含义不成立。** 字面断言见解析测试`:22`、`:201`，缺口见 A-04 至 A-08。`report` 整体置空过于粗，只证明会拒绝，不能证明每个规则分别被测住。
- A 的读取链 DTO、问题 DTO、错误类名及代码集合这些可选接缝：**成立。** 实际形状符合冻结书，`prompt-pack.ts:24`、`:32`、`:53`，`render-template.ts:21`；回复`:12`、`:55` 已交代。

```json
[
  {
    "id": "A-01",
    "class": "会出错",
    "file": "src/contracts/prompts/render-template.ts",
    "line": 220,
    "basis": ".lead-ref/books/pc2-book.md:167，裁定4：一次收齐所有问题",
    "problem": "校验短路。unknown-call-review 正文为 X 时，应报告 workspaceLines 和 writtenLines 两个必填槽缺失，实际只报告前者。resolve-pack.ts:323 还会因参数值错误跳过键集不同检查；:223 会跳过固定键检查。",
    "fix": "累积所有可独立判定的问题，模板校验返回问题集合，渲染抛异常时选取其中一个；补多错误输入的完整字面问题列表。"
  },
  {
    "id": "A-02",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 310,
    "basis": ".lead-ref/books/pc2-book.md:153，裁定4只禁止空描述",
    "problem": "record_note.description 为单个空格且 parameters 为 {} 时，按书应接受并保留，实际因 trim 拒绝。回复虽说明该选择，但书未授权扩大条件。",
    "fix": "保留字符串类型检查，将空判断改为 description === ''，补纯空白描述接受例。"
  },
  {
    "id": "A-03",
    "class": "不整洁",
    "file": "src/contracts/prompts/render-template.ts",
    "line": 234,
    "basis": ".lead-ref/books/pc2-book.md:163；.lead-ref/replies/pc2-reply.md:8",
    "problem": "section 不属于模板分支不可达：registerSlot 已限定名字属于槽表，collectSectionUses 只收 SECTION_NAMES，expected 就是两者交集。",
    "fix": "删除后置不可达分支，保留未声明槽拒绝；不修改 section-extra 夹具。"
  },
  {
    "id": "A-04",
    "class": "违规",
    "file": "tests/contracts/PC2-resolve-pack.test.ts",
    "line": 22,
    "basis": ".lead-ref/books/pc2-book.md:141、:163、:826，PC-02",
    "problem": "50 个坏包未覆盖全部必要校验，包括模板文件非字符串、模板条目非对象、顶层 section 块等；删除对应检查仍能通过现有 A 测试。",
    "fix": "使用现有 pc2PackEntry 构造遗漏输入，逐项补完整字面问题对象，区分嵌套 section 与 section 自己是块；不改冻结夹具。"
  },
  {
    "id": "A-05",
    "class": "违规",
    "file": "tests/contracts/PC2-resolve-pack.test.ts",
    "line": 207,
    "basis": ".lead-ref/books/pc2-book.md:136、:139、:148，裁定4",
    "problem": "成功解析测试不检查有效 manifest、字符串合并；工具覆盖只用空参数的 record_note。返回平台 manifest、漏掉字符串覆盖或沿用父工具参数，均可通过相应 A 用例。",
    "fix": "补请求包 manifest、子覆盖父且保留其余键的完整字符串表，以及覆盖 list_files.prefix 的整个工具条目的字面断言。"
  },
  {
    "id": "A-06",
    "class": "违规",
    "file": "tests/contracts/PC2-resolve-pack.test.ts",
    "line": 161,
    "basis": ".lead-ref/books/pc2-book.md:142，裁定4；pc2-chk2-rulings.md:21，C2",
    "problem": "所有有效 origins 期望的 mentionsTools 都是空数组，无法发现从请求包而非供应包取声明的错误；也未区分中间父包供应的未覆盖模板。",
    "fix": "通过现有构造器增加父包供应模板，使用不同版本和非空声明，逐字断言供应包、版本、声明三项。"
  },
  {
    "id": "A-07",
    "class": "违规",
    "file": "tests/contracts/PC-prompt-set-v1.test.ts",
    "line": 20,
    "basis": ".lead-ref/books/pc2-book.md:676，裁定19",
    "problem": "正文和摘要只是解码测试输入，没有验收 canonicalToolTextBody；已有冻结与路由断言仅用空参数或单个 prefix，删除参数键排序仍不会改变这些期望。",
    "fix": "增加公开规范化函数测试，以插入顺序相反且英文排序不同于码点排序的多个键，比较完整字面 JSON 及其独立 SHA-256。"
  },
  {
    "id": "A-08",
    "class": "违规",
    "file": "tests/contracts/PC2-tool-blocks.test.ts",
    "line": 16,
    "basis": ".lead-ref/books/pc2-book.md:169、:178，裁定4错误接口",
    "problem": "A 测试不验收 PromptRenderError 的类、code、templateId、slot，也不直接检查必填空槽抛出的类型。删字段赋值或改回普通 Error 均不会被 A 测试发现。",
    "fix": "经 renderTemplate 补三类错误的公开契约测试，使用独立字面期望断言错误类及三个字段。"
  },
  {
    "id": "A-09",
    "class": "违规",
    "file": ".lead-ref/replies/pc2-reply.md",
    "line": 7,
    "basis": ".lead-ref/books/pc2-book.md:185、:810，PE8，归 Q",
    "problem": "把 empty 夹具返回预期 invalid 误认为夹具不可用，漏掉必填空槽经准备拒绝的验收。PC2-pack-fixture.ts:369 会返回 preparation，只有 start 才要求 ready。",
    "fix": "由 lead 转交 Q，使用现有 empty 模式直接断言 fixture.preparation 的完整 invalid 结果，不调用 start；无需修改夹具。"
  },
  {
    "id": "A-10",
    "class": "违规",
    "file": ".lead-ref/parts/A.diff",
    "line": 718,
    "basis": ".lead-ref/books/pc2-book.md:58、:913；.lead-ref/books/run-pc2.md:87",
    "problem": "PC-prompt-set-v1.test.ts 符合路径白名单，但没有旧测试修改授权，也不命中指定 binding/manifest 检索条件。当前修改未削弱旧断言。",
    "fix": "由 lead 补书面裁定，将该文件列入 §5.3 并归 A，只允许新增字段及其严格解码测试，保留当前旧断言。"
  },
  {
    "id": "A-11",
    "class": "违规",
    "file": "tests/contracts/PC-prompt-set-v1.test.ts",
    "line": 239,
    "basis": ".lead-ref/books/pc2-book.md:594、:654，L2、裁定19",
    "problem": "解码器输入和期望共用 VALID。若解码器原地排序 toolNames，再返回输入，期望同步被修改，toEqual(VALID) 仍通过，不能守住不得排序的规则。",
    "fix": "将返回清单及调用后的输入清单分别与独立字面 ['read','edit','shell'] 比较。"
  },
  {
    "id": "A-12",
    "class": "不整洁",
    "file": "src/contracts/prompts/prompt-pack.ts",
    "line": 4,
    "basis": ".lead-ref/books/pc2-book.md:64；本次审查的注释要求",
    "problem": "A 文件仍有段序留在代码、输入模板以后才到、PC-1 固定顺序等过时说明，以及 PC-2 swaps、PC-2 ruling、platform v1 未使用等施工历史。相关位置为 prompt-pack.ts:60、prompt-set.ts:77、slot-tables.ts:12和:78、resolve-pack.ts:2、render-template.ts:284。",
    "fix": "将这些注释改为当前职责和约束，删除施工批次叙述，明确输入模板决定段序及两类包源的当前用途。"
  },
  {
    "id": "A-13",
    "class": "不整洁",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 167,
    "basis": "本次审查的死代码要求",
    "problem": "validateIdentity 的 _index、_length 两个形参从未使用，调用处仍传入。",
    "fix": "删除两个形参及 resolve-pack.ts:123 的对应实参。"
  }
]
```

会出错 2，违规 8，不整洁 3，建议 0