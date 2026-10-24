# src/contracts/validation：共享的命令体字段校验器与结构原语

## 负责什么，不负责什么
- 只做 wire shape 检查：字段存在性、类型、枚举、键集合、整数/摘要/大小边界；输出 `ValidationIssue[]`，或把 issue 填进调用者给的数组。
- 不授予权限、不判断业务准入、不读 store、不写记录；调用者仍要按领域规则核对 scope、authority 和 current facts。
- 依赖只能是 `src/contracts/`：不得 import `src/core`、`src/app`、`src/business`、`src/composition`。
- 纯函数：无 IO、无时钟、无随机数；同一输入得到同一组 issues 和顺序。

## 文件
- `common.ts` — issue 类型与结构原语：记录/字符串/整数/摘要判定、键集合、UTF-8 字节与码点计数、JSON 解析、`invalid`、字符串字段收集。
- `cursors.ts` — 账本游标形状：`c` 加十位数字，以及排除 `c0000000000` 的非零版本；Session codec 与字段表共用这一份。
- `data-format.ts` — 字段表格式（`../data-format.ts`）的唯一值检查 `checkShape`：按固定顺序返回第一个问题（声明顺序、深度优先，再未知键、再规则；事件先查四个信封键），文本是 `<name>.<path> is missing / is not allowed / is not recognized / is invalid`。
- `time.ts` — ISO UTC 时间形状（以 `Z` 结尾、`Date.parse` 可读）；Run 活动 codec 与字段表共用这一份。
- `goal.ts` — `CreateGoal` 命令体校验：版本、身份、aggregateId、expectedRevision、归一化后的非空 objective。
- `identity.ts` — actor（human/system/agent 及 agent 的完整 runRef）与命令身份（projectId/actor/idempotencyKey）。
- `role.ts` — 角色规格正文、协调角色矩阵、RoleSpecRevision pin，以及安装/激活角色规格命令。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `ValidationIssue`、`ValidationIssueCode`、`UnknownRecord` | `src/contracts/validation/common.ts:4`、`src/contracts/validation/common.ts:3`、`src/contracts/validation/common.ts:9` | 共享 issue 形状：path/code/message，以及宽松 JSON 记录类型。 | 所有校验器和调用方的错误接口。 |
| `isRecord` | `src/contracts/validation/common.ts:10` | 非 null、非数组的对象判定。 | 进入命令体/事件体前先收窄类型。 |
| `nonEmpty` | `src/contracts/validation/common.ts:13` | 非空字符串判定（不 trim）。 | 必填文本字段；不要用它代替业务文本长度规则。 |
| `isSha256Hex` | `src/contracts/validation/common.ts:17` | 64 位小写十六进制摘要。 | digest/argumentsDigest 字段。 |
| `isInt`、`isNonNeg`、`isPos` | `src/contracts/validation/common.ts:20`、`src/contracts/validation/common.ts:23`、`src/contracts/validation/common.ts:26` | 安全整数、非负整数、正整数判定。 | revision/序号/预算等数值字段。 |
| `hasOnlyKeys` | `src/contracts/validation/common.ts:29` | 所有键都在允许集合内；不检查缺失。 | 拒绝未知字段；不要另写 Object.keys 循环。 |
| `utf8Bytes`、`codePoints` | `src/contracts/validation/common.ts:32`、`src/contracts/validation/common.ts:35` | UTF-8 字节数与码点数。 | 文本上限；两者不能混用。 |
| `inList` | `src/contracts/validation/common.ts:38` | 字符串枚举收窄。 | 封闭枚举字段。 |
| `parseObject`、`parseTaggedObject` | `src/contracts/validation/common.ts:41`、`src/contracts/validation/common.ts:50` | 解析 JSON 对象；带标签的版本返回问题文本而不是抛错。 | 解码存储正文；保留“哪个正文坏了”的标签。 |
| `invalid` | `src/contracts/validation/common.ts:62` | 统一的 `{status:"invalid", reason}`。 | 纯校验/读取器的快速拒绝。 |
| `stringField`、`stringArrayField` | `src/contracts/validation/common.ts:65`、`src/contracts/validation/common.ts:82` | 读取必填字符串/字符串数组并追加 missing_field/bad_type；数组为空时按 allowEmpty 追加 bad_scope。 | 命令体字段收集；用同一个 displayPath 规则。 |
| `isPlatformCursor`、`isNonZeroPlatformCursor` | `src/contracts/validation/cursors.ts:8`、`src/contracts/validation/cursors.ts:12` | 账本游标形状；非零版本排除 `c0000000000`。 | 读写游标字段；`f.cursor('ledger' / 'ledgerNonZero')` 用同一份。 |
| `isIsoZulu` | `src/contracts/validation/time.ts:7` | 以 `Z` 结尾且 `Date.parse` 可读的 UTC 时间。 | ISO 时间字段；`f.isoTime()` 用同一份。 |
| `checkShape` | `src/contracts/validation/data-format.ts:24` | 按字段表格式检查一个值，返回第一个问题或 `null`；`pending` 允许记录的可绑定游标仍是 `null`。 | 字段表格式的检查只用这一个；RecordStore 编解码经 `src/core/work-graph/persistence/field-table-codec.ts`。 |
| `validateCreateGoalCommand` | `src/contracts/validation/goal.ts:6` | 校验 CreateGoal 命令的完整形状，含 NFC+trim 后非空 objective。 | WorkGraph 受理 CreateGoal 前的纯输入检查。 |
| `validateActor` | `src/contracts/validation/identity.ts:5` | 校验 human/system/agent actor；agent 必须带完整 runRef。 | 所有 actor 字段；本层只需要 `ValidationIssue[]` 时用这个入口。 |
| `validateCommandIdentity` | `src/contracts/validation/identity.ts:24` | 校验 projectId、actor、idempotencyKey。 | 所有命令的 identity 字段。 |
| `validateRoleSpecContent` | `src/contracts/validation/role.ts:18` | 校验角色规格正文：职责、材料、权限/工具、必产出、预算与退出条件。 | 安装角色规格与角色记录 codec 的安装期判据。 |
| `validateCoordinationRoleMatrix` | `src/contracts/validation/role.ts:132` | 校验 catalog 的每个 RoleSpecRevision pin，以及 coordinator 必须指向 catalog 内角色。 | 协调策略正文安装/解码时。 |
| `validateRoleSpecPin` | `src/contracts/validation/role.ts:166` | 校验 RoleSpecRevision 三元组 pin 与 digest。 | 任何引用角色规格版本的位置。 |
| `validateInstallRoleSpecRevisionCommand` | `src/contracts/validation/role.ts:199` | 校验安装角色规格命令体，并复用正文校验。 | 安装命令的纯输入检查。 |
| `validateActivateRoleSpecRevisionCommand` | `src/contracts/validation/role.ts:219` | 校验激活角色规格命令体（Project CAS + target pin）。 | 激活命令的纯输入检查。 |

同一能力的两种判据：actor 形状只有两份，且不能互换。本文件的 `validateActor`（`src/contracts/validation/identity.ts:5`）是 `void` 加追加 `ValidationIssue` 的契约层检查（因此本层不能 import WorkGraph）；`src/core/work-graph/persistence/rework-codecs.ts:98` 的 `actorRefProblem` 是 WorkGraph codec 的共用判据，返回首个 `string | null`。不要再复制第三份。

## 内部用
无。本目录导出的原语和 `validate*` 都是给 WorkGraph 解码器、服务入口和测试共用的。

## 不要做
- 不要在 WorkGraph/app 另写命令体字段校验；先复用这里的 `validate*` 和 `common.ts` 原语（同类错误见 CS-11、FP-17、M1-31）。
- 不要把结构校验当授权：通过 `isRecord` 或 `validate*` 不代表对象可被接受；scope、所有权和 current revision 仍由 owner 判断。
- 不要在校验器里读 store、查当前版本或做身份/范围判断；这些属于调用方的领域规则。
- 不要因为第一个错误就跳过后面可独立判定的字段；按同一路径顺序返回完整 issues。字段表格式（`data-format.ts`）是例外：它只返回第一个问题，顺序固定。
- 不要在 `contracts` 里 import 上层或使用上层类型；需要结构时用 `UnknownRecord` 加本地窄类型。
- 不要只改这里或只改调用方的字段规则；命令体规则与 owner 的 codec 必须同步（M1-31）。
