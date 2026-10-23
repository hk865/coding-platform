只做了静态只读核对。以下六项行为问题都是 **A-01 尚未修完**，所列反例在基线和当前树中结果相同；没有把它们算成本轮新增回归。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| A2-01 | 会出错 | `src/contracts/prompts/render-template.ts:104`、`:108`、`:223` | 冻结表 A-01；`.lead-ref/audit1/A.out.md:7`；书`:167` | **槽错误仍短路。** `unknown-call-review='{{items}}{{items}}'` 只报重复 `items`，漏掉缺少 `workspaceLines`、`writtenLines`；`base='{{one}}{{two}}'` 只报未知 `one`，漏掉未知 `two`。标记结构完整，遗漏的问题均可独立判断。 | 累积可继续解析的槽错误，继续检查后续标记及必填槽；真正无法继续解析的结构错误才终止。补完整字面问题列表，保留原首错。 |
| A2-02 | 会出错 | `src/contracts/prompts/resolve-pack.ts:238`、`:240`、`:246` | 冻结表 A-01；书`:141`、`:167` | **未知模板阻断通用字段检查。** 合法链中设置 `templates.bad={file:3,version:0,mentionsTools:3}`，只报未知模板，漏掉版本、声明数组及文件字段三项错误；这些检查不依赖槽表。 | 未知模板只跳过依赖槽表的检查；继续检查条目形状、版本、声明和文件字段，并补四项完整字面断言。 |
| A2-03 | 会出错 | `src/contracts/prompts/resolve-pack.ts:283`、`:285`、`:307` | 冻结表 A-01；书`:148`、`:167` | **未知工具阻断正文检查。** 已供应合法路径和 JSON 的 `mystery` 工具，正文为 `{"description":"","parameters":{"x":3}}`，只报没有平台文字，漏掉空描述及参数值非字符串。 | 报未知工具后继续文件、JSON、描述和参数的通用检查；仅平台参数键集比较依赖平台定义。补三项完整字面断言。 |
| A2-04 | 会出错 | `src/contracts/prompts/resolve-pack.ts:339`、`:340`、`:321` | 冻结表 A-01；书`:149`、`:153`、`:154`、`:167` | **平台字段值错误掩盖已知键集。** 纯解析输入中，平台 `list_files={description:3,parameters:{prefix:"P"}}`，子包为 `{description:"C",parameters:{other:"O"}}`，只报平台描述错误，漏子包 `parameters differ`。平台改为合法描述、`prefix:3` 也同样漏报；两例的参数键集都已知。 | 平台参数键集提取只依赖 `parameters` 是对象，不依赖描述或参数值合法；平台自身错误仍照常收集。补两例完整字面断言。 |
| A2-05 | 会出错 | `src/contracts/prompts/resolve-pack.ts:171`、`:172` | 冻结表 A-01；书`:136`、`:167` | **包名语法错误掩盖身份不匹配。** 链条目为 `child`、manifest 的 `packId="BAD!"`，只报非法包名，漏掉 manifest 包名不等于链条目。两个判断都能独立完成。 | 字符串类型通过后，分别检查语法和身份相等；补双错误字面断言，并更新现有 `id-syntax` 的完整问题列表（`tests/contracts/PC2-resolve-pack.test.ts:28`）。 |
| A2-06 | 会出错 | `src/contracts/prompts/resolve-pack.ts:35`、`:37` | 冻结表 A-01；书`:94`、`:95`、`:167` | **路径检查仍只返回一项。** 模板文件 `/a/../outside.txt` 同时违反相对路径和禁止 `..` 段规则，却只报 `must be relative`。 | 路径检查按原顺序收集全部问题，三个调用点报告全部结果；有路径问题时仍停止该文件的后续内容检查。补双错误字面断言。 |
| A2-07 | 违规 | `tests/contracts/PC2-resolve-pack.test.ts:289` | 冻结表 A-04；`.lead-ref/audit1/A.out.md:10`、`:27`、`:29`、`:41`、`:42`、`:43` | **只补了八例，未补完冻结缺口表。** 仍缺 `packId=3`、`extends=''`、`extends=3`、`templates=3`、供应模板文件名不符、空路径、Windows 绝对路径。比如删除 `resolve-pack.ts:263` 的 `supplied.file !== file`，现有 A 输入和断言均无法发现。 | 用现有构造器补齐这些已冻结输入，逐项比较完整字面问题列表并验证对应变异；不改冻结夹具。 |
| A2-08 | 不整洁 | `src/contracts/prompts/render-template.ts:209`、`:299` | 本轮注释要求第 6 条；冻结表 A-12；`.lead-ref/audit1/A.out.md:18` | 点名的旧注释已改，但生产代码仍留有 `D3 syntax` 和 `the plain Error it threw before`，仍以施工阶段或过去行为说明当前契约。 | 改为当前三种模板构造及错误类型的直接说明，删除阶段名和历史比较。 |

上述基线短路分别见 `.lead-ref/base/src/contracts/prompts/render-template.ts:104`、`:108`、`:216`，以及 `.lead-ref/base/src/contracts/prompts/resolve-pack.ts:35`、`:171`、`:241`、`:285`、`:343`。

renderer 的**首错选择本身稳定**：仍依次检查解析错误、必填槽缺失、section 位置、缺少 section、role 顺序；收集后抛 `errors[0]`。`unknown-call-review='X'` 因而仍抛 `PromptRenderError`，其 `code='template_invalid'`、`templateId='unknown-call-review'`、`slot='workspaceLines'`。当前实现和字面断言分别见 `src/contracts/prompts/render-template.ts:228`、`:229`、`:239`、`:245`、`:250`、`:315`，`tests/contracts/PC2-resolve-pack.test.ts:475`；原顺序见 `.lead-ref/base/src/contracts/prompts/render-template.ts:220`、`:230`、`:239`、`:244`。

逐行结论：

- **A-01: A2-01、A2-02、A2-03、A2-04、A2-05、A2-06。** 原三个反例已修，新增完整列表能杀死回复所称的三种短路变异（`tests/contracts/PC2-resolve-pack.test.ts:358`、`:370`、`:380`；回复`:32`）。
- **A-02: OK。** 只拒非字符串或 `''`，合并原样保留描述；空格字面断言能杀死恢复 `trim()` 的变异（`src/contracts/prompts/resolve-pack.ts:308`、`:153`；`tests/contracts/PC2-resolve-pack.test.ts:392`）。
- **A-03: OK。** 后置不可达分支已删除；前面的未知槽拒绝保留，没有附带行为修改（`.lead-ref/parts/A.diff:103`；`src/contracts/prompts/render-template.ts:104`、`:239`）。
- **A-04: A2-07。** 已新增八例使用完整字面问题列表，能杀死各自指定的删除检查变异；但没有补齐首轮检查表（`tests/contracts/PC2-resolve-pack.test.ts:289`；回复`:35`）。
- **A-05: OK。** 请求 manifest、完整字符串表和整个非空参数工具条目均为字面期望；能区分返回平台 manifest、只填缺键、沿用平台参数（`tests/contracts/PC2-resolve-pack.test.ts:403`、`:417`、`:437`）。
- **A-06: OK。** 父包来源、版本 7、非空声明均独立写死；清空声明或误取请求包声明都会失败（`tests/contracts/PC2-resolve-pack.test.ts:451`）。
- **A-07: OK。** 经公开规范化函数比较完整 JSON 和独立摘要字面；删除排序或改为码点排序都会改变结果（`tests/contracts/PC-prompt-set-v1.test.ts:340`；`src/contracts/prompts/prompt-set.ts:230`）。
- **A-08: OK。** 三类错误均经 `renderTemplate` 检查错误类及字段；抛末项、改普通 `Error`、清空 `slot` 都会失败（`tests/contracts/PC2-resolve-pack.test.ts:205`、`:474`）。
- **A-09: same as Q-10，OK。** 使用 `empty` 模式，直接比较准备拒绝结果的完整字面，没有调用 `start()`（`tests/runtime/PC2-declaration-prepare.test.ts:126`）。
- **A-10: rejected, untouched。** F3 已批准的原修改保留；本轮同文件的变化分别属于 A-07、A-11（`.lead-ref/books/pc2-findings.md:58`、`:74`；`.lead-ref/parts/A.diff:255`、`:266`、`:281`）。
- **A-11: OK。** 输入和返回的清单分别比较独立字面，原地排序不能再修改期望值蒙混通过（`tests/contracts/PC-prompt-set-v1.test.ts:240`）。
- **A-12: A2-08。** 原点名七处已修，剩余历史叙述见该项（`src/contracts/prompts/prompt-pack.ts:4`、`:61`、`:70`；`prompt-set.ts:76`；`slot-tables.ts:11`、`:78`；`resolve-pack.ts:2`；`render-template.ts:289`）。
- **A-13: OK。** 两个死形参及对应实参均已删除（`src/contracts/prompts/resolve-pack.ts:123`、`:166`）。

A 的七个文件均在白名单内，差异可归到对应修复行；新增问题集合由解析器实际消费，没有发现测试专用生产出口或超时增加（`.lead-ref/parts/A-files.txt:1`；`.lead-ref/books/pc2-r1-whitelist.txt:1`、`:17`；`src/contracts/prompts/resolve-pack.ts:267`）。合法模板的渲染正文路径只有注释变化，未发现 A 差异引入额外字节变化（`.lead-ref/parts/A.diff:130`）。冻结夹具未列入全体差异清单；本次没有可用的四份基线副本，因此不声称完成夹具字节核验（`.lead-ref/all-files.txt:29`）。

DSH 自述核对：

- **§1.5 关于 A-10：成立。** 冻结裁定确为 rejected；A-09 也已由 Q-10 完成（回复`:13`、`:89`；冻结表`:73`、`:74`；`tests/runtime/PC2-declaration-prepare.test.ts:126`）。
- **§3 A-01 的三个反例及变异：成立；若据此表示整行完成，则不成立。** 尚有 A2-01～A2-06（回复`:32`；对应代码位置见发现表）。
- **§3 A-04 的“新增八例”：成立；整行完成不成立。** 剩余冻结缺口见 A2-07（回复`:35`；`tests/contracts/PC2-resolve-pack.test.ts:289`）。
- **§3 A-12 的“七处注释已改”：成立；全面满足本轮注释要求不成立。** 剩余见 A2-08（回复`:41`；`src/contracts/prompts/render-template.ts:209`、`:299`）。
- 本次只确认指定变异在静态上能否被断言识别，未将回复中的 RED/GREEN 数字当作已复核运行结果（回复`:30`）。

```json
[
  {
    "id": "A2-01",
    "class": "会出错",
    "file": "src/contracts/prompts/render-template.ts",
    "line": 104,
    "basis": "冻结表 A-01；.lead-ref/audit1/A.out.md:7；.lead-ref/books/pc2-book.md:167",
    "problem": "未知槽和重复槽仍立即抛出，parseTemplateV1:223 随即返回单项。unknown-call-review='{{items}}{{items}}'漏报两个必填槽缺失；base='{{one}}{{two}}'漏报未知two。基线和当前结果相同，属于冻结修复未完成。",
    "fix": "累积可继续解析的槽错误，继续解析后续标记并检查必填槽；真正不能继续解析的结构错误才终止。补完整字面问题列表并保留原首错。"
  },
  {
    "id": "A2-02",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 238,
    "basis": "冻结表 A-01；.lead-ref/books/pc2-book.md:141、:167",
    "problem": "未知模板立即continue。templates.bad={file:3,version:0,mentionsTools:3}在基线和当前均只报告未知模板，漏掉不依赖槽表的版本、声明数组和文件字段错误。",
    "fix": "未知模板只跳过依赖槽表的检查，继续检查条目形状、版本、声明和文件字段，并补四项完整字面断言。"
  },
  {
    "id": "A2-03",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 283,
    "basis": "冻结表 A-01；.lead-ref/books/pc2-book.md:148、:167",
    "problem": "未知工具立即continue。已供应合法路径及JSON的mystery正文为{\"description\":\"\",\"parameters\":{\"x\":3}}时，基线和当前均只报没有平台文字，漏报空描述和参数值非字符串。",
    "fix": "未知工具继续接受通用文件、JSON、描述和参数校验，仅平台参数键集比较依赖平台定义；补三项完整字面断言。"
  },
  {
    "id": "A2-04",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 339,
    "basis": "冻结表 A-01；.lead-ref/books/pc2-book.md:149、:153、:154、:167",
    "problem": "平台描述或参数值类型错误会丢掉整个工具条目，导致:321跳过子包键集检查。平台list_files={description:3,parameters:{prefix:'P'}}，子包={description:'C',parameters:{other:'O'}}，只报告平台描述错误；平台改为合法描述和prefix:3也同样漏报子包parameters differ。这是纯解析契约反例，基线和当前结果相同。",
    "fix": "平台参数键集提取仅依赖parameters是对象，不依赖描述或参数值合法；保留平台自身错误收集，补两例完整字面断言。"
  },
  {
    "id": "A2-05",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 171,
    "basis": "冻结表 A-01；.lead-ref/books/pc2-book.md:136、:167",
    "problem": "包名语法检查与身份检查互斥。链条目child、manifest packId='BAD!'在基线和当前均只报告非法包名，漏报与链条目身份不匹配。",
    "fix": "字符串类型通过后分别检查语法及身份相等；补双错误字面断言，并更新tests/contracts/PC2-resolve-pack.test.ts:28的id-syntax完整问题列表。"
  },
  {
    "id": "A2-06",
    "class": "会出错",
    "file": "src/contracts/prompts/resolve-pack.ts",
    "line": 35,
    "basis": "冻结表 A-01；.lead-ref/books/pc2-book.md:94、:95、:167",
    "problem": "fileProblem先返回绝对路径错误，跳过独立的父目录段检查。模板文件/a/../outside.txt在基线和当前均只报告must be relative，漏报must not contain a '..' segment。",
    "fix": "路径检查按原顺序收集全部问题，三个调用点报告全部结果；有路径问题仍停止该文件的后续内容检查。补双错误字面断言。"
  },
  {
    "id": "A2-07",
    "class": "违规",
    "file": "tests/contracts/PC2-resolve-pack.test.ts",
    "line": 289,
    "basis": "冻结表 A-04；.lead-ref/audit1/A.out.md:10、:27、:29、:41、:42、:43",
    "problem": "新增八例未补完冻结检查表。仍缺packId非字符串、extends空字符串和其他非字符串、templates非对象、供应模板文件名不匹配、空路径、Windows绝对路径。例如删除resolve-pack.ts:263的supplied.file !== file，现有A断言无法发现。",
    "fix": "用现有pc2PackEntry补齐这些已冻结输入，逐项比较完整字面问题列表并验证对应变异；不修改冻结夹具。"
  },
  {
    "id": "A2-08",
    "class": "不整洁",
    "file": "src/contracts/prompts/render-template.ts",
    "line": 209,
    "basis": "本轮注释要求第6条；冻结表 A-12；.lead-ref/audit1/A.out.md:18",
    "problem": "点名的旧注释已修，但:209仍有D3 syntax，:299仍有the plain Error it threw before，生产注释仍包含施工阶段或历史行为叙述。",
    "fix": "改为当前三种模板构造及错误类型的直接说明，删除阶段名和历史比较。"
  }
]
```

会出错 6，违规 1，不整洁 1，建议 0