**当前任务书还不足以让 DSH 无猜测地完成 G1。** 未写文件、未运行测试。以下 `persistence/`、`tasks/` 等路径均相对 `src/core/work-graph/`；报告路径均在 `.lead-ref/c1/`。

1. **G1 的条目清单没有完整覆盖要求它创建的公共能力。**

   [c1-book.md:29](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:29) 的逐项核对如下：

   | G1 条目 | 共用落点 | G1 内调用点 | 必须保留的差异 |
   |---|---|---|---|
   | XX-1 | 基础原语的 `contracts/validation/common.ts` 已明确 | 原 O/S/N/K 表够用；K3 新增范围需补，见第 2 条 | 基础规则已明确；不能据此统一所有同名 ref／整数检查 |
   | XX-2／SE-1 | `persistence/event-envelope.ts` 已明确 | 按编码函数名可定位；entry 的旧行号已漂移 | 字段顺序、原事件 JSON 已明确；规则 2 的 re-export 要改 |
   | XX-5 | `contracts/fingerprint.ts` 已明确 | 足够；evidence 当前是 `evidence-service.ts:151`，不是旧报告的 `:148` | nullable 与直接抛错的区别已明确 |
   | XX-6 | `contracts/validation/common.ts` 已明确 | 足够；entry 当前为 `execution-entry-codecs.ts:709`，delta 已更新 | null／数组／标量／解析失败边界已明确 |
   | XX-7／TA-7 | 模块已明确，具体出口未冻结 | 大部分消费者属于后续组；G1 负责提供实现 | K3 丢弃 revision-conflict pins 的事实没有明说，见第 4 条 |
   | rejection helpers | 模块已明确 | R 表有一处错误归类：`verification-plan.ts:53` | `issues`、三种 current 规则必须分开，见第 3 条 |
   | G1 文件中的 K3 重复 | 原语落点明确，ref 助手落点不完整 | `codec-fields.ts`、`codec-shape-checks.ts` 应改哪些出口仍需明确 | 严格／宽松 ref 检查不能互换 |
   | PE-1 | 不涉及共享落点 | 示例及本组文件范围足够 | 保留规则／原因的要求足够 |
   | 其他注释 | 不涉及共享落点 | `codec-fields.ts:2`、`:5`，`codec-shape-checks.ts:2` 等可定位 | 足够；只能裁施工标签，不能整块删规则说明 |

   另外，**PE-2／PE-3 没列入 G1 Items，却出现在执行顺序中**；`input-declaration-id.ts` 列为新文件，但没明确承担 TA-4／VW-4 的定义；VW-7 要求的读失败 code 归一函数也必须由 G1 提供。依据是 `c1-refresh.out.md:121`、`:122`、`:134`。

   建议任务书加入原文：

   > G1 明确包含 PE-2／PE-3、TA-4／VW-4 的公共编号函数定义，以及 VW-7 的公共读失败 code 归一函数定义。  
   > 带标签对象解析统一放入 `src/contracts/validation/common.ts`，搬用 `persistence/record-codecs.ts:100` 的实现，供 record、plan、decision、line-settings 四个 codec 使用；它与 nullable `parseObject` 是两个不同出口。  
   > `persistence/event-validation.ts` 承担 decision／line-settings 的外壳检查、内外一致性、actor 和共同正文检查；line 的 null proof 与 Workspace 检查留在原文件。检查顺序和返回协议保持原样。  
   > `input-declaration-id.ts` 只承担编号构造；读失败 code 归一函数放在 `read-result-failures.ts`。本组不切换其他组的消费者。  
   > 行号用于导航，迁移以具名函数及其函数体为准。execution-entry 的五个事件编码入口当前在 `:772、:793、:824、:839、:858`。

2. **XX-1／K3 的 ref 合并需要明确落点，并列出不能合并的近似副本。**

   delta 只说严格 SessionRef “公共层保留一份”（`c1-delta.out.md:66`），但当前 **已经有可复用实现**：[rework-codecs.ts:171](D:/cxt/k3-merge-review/src/core/work-graph/persistence/rework-codecs.ts:171)。此外：

   | 看起来相同的两处 | 实际差异 |
   |---|---|
   | `execution-entry-codecs.ts:76` ↔ `tasks/codec-shape-checks.ts:12`／`rework-codecs.ts:131` | 前者允许额外 RunRef 字段，后者拒绝 |
   | `execution-entry-codecs.ts:91` ↔ `run-activity-codecs.ts:104`／`rework-codecs.ts:171` | 前者允许额外 SessionRef 字段，后者拒绝 |
   | `evidence-record-codecs.ts:184` ↔ `tasks/codec-shape-checks.ts:20` | 前者允许额外 TaskTriple 字段，后者拒绝 |
   | `decision-record-codecs.ts:180` ↔ `tasks/codec-shape-checks.ts:27` | 前者区分 “complete” 和 “valid” 两种错误，后者只有一种 |
   | `decision-record-codecs.ts:164` ↔ `rework-codecs.ts:115` | agent 额外字段及 runRef 错误文字不同 |
   | `evidence-record-codecs.ts:136` ↔ `tasks/codec-fields.ts:24` | 前者带 `minimum` 下界，后者只检查安全整数 |

   建议加入：

   > G1 将 `codec-fields.ts` 中跨层原语下沉到 contracts，并保留原名出口；`canonicalOf` 下沉到 fingerprint。明确保留整数、非负整数、正整数三个不同判断，UTF-8 字节数与码点数不得互换。  
   > 严格、带错误标签参数的 SessionRef 检查复用现有 `persistence/rework-codecs.ts::sessionRefProblem`。这里的“标签”是错误文字参数，不是给 SessionRef 增加 aggregateType。G3／G5 分别切换 note、UCR、session-anomaly 的对应副本。  
   > `codec-shape-checks.ts` 的 RunRef／TaskTriple 与 rework 中同形实现可改为原名转出；SessionMessageRef 保持自己的协议。  
   > 上表列出的宽松检查、不同错误分支、不同整数下界均保留，不因函数同名而接入严格公共版本。只迁移清单明确列出的同义实现。

3. **R 表误把 `verification-plan.rejected` 纳入了普通 rejection 接线。**

   `c1-refresh.out.md:101` 列出的 [verification-plan.ts:53](D:/cxt/k3-merge-review/src/core/work-graph/evidence/verification-plan.ts:53) 返回：

   ```ts
   { status: 'rejected', code, issues }
   ```

   普通原型 `tasks/context-input-service.ts:104` 返回的是 `{status, code, reason}`。两者连 code 集合也不同。

   current 还存在真实差异：`evidence-service.ts:139` 保留传入的空数组；`queries/query-execution.ts:83` 省略空数组；`read-result-failures.ts:30` 仅在参数为数组时附带 current，包括空数组。

   建议加入：

   > 覆盖 refresh R 表：`evidence/verification-plan.ts::rejected` 不接普通 Core rejection 助手，原 `{status:'rejected',code,issues}` 和专用 code union 保留。  
   > 公共 rejection 分别提供：不带 current、传入 current 时保留（包括空数组）、仅非空 current 时附带，以及 `{ok:false,code,reason}`。不得合成会补字段的万能出口。保留调用方的窄 code 类型。  
   > codec-invalid 单独保留 `{status:'invalid',reason}`。固定业务文字包装、固定业务结果字段不展开合并。

4. **XX-7 缺少完整的映射分型，尤其 K3 的 revision-conflict 行为。**

   对比 `sessions/session-directory.ts:152`、`tasks/execution-entry-service.ts:171` 与 [command-rerun-request-service.ts:101](D:/cxt/k3-merge-review/src/core/work-graph/tasks/command-rerun-request-service.ts:101)：前两者解析 current pins；K3 写映射直接丢弃它们。delta `:70` 提到了 unique 和 unsupported，却没有明确这一点。

   建议加入：

   > 在 `persistence/read-result-failures.ts` 分别提供以下独立出口，不用一个通用映射替换全部服务：  
   > — Session 四服务映射：搬用 directory `:144`；unique→revision_conflict，保留 owner 后缀；corrupt 保留 damage 前缀。  
   > — execution entry/history 映射：unique→busy，保留 Kernel 后缀；unsupported→unavailable。  
   > — K3 UCR／CRR／receipt 写映射：unique→busy，不加后缀；revision_conflict 不解析、不附带 current；unsupported／corrupt→unavailable。  
   > — K3 读映射：只保留 invalid、unsupported，其余→unavailable，reason 原样。  
   > pin 解码单独共享：只跳过 null revision、不可解析或非对象 refKey；不新增 ref schema 校验，不排序、不去重。claim 只切换 pin 解码，其 corrupt 不加前缀。  
   > 既有 `storeFailureToRejection` 的 code 集合及数组 current 行为保持；VW-7 仅抽取其中相同的 code 归一部分。

5. **规则 2 同时误限了区域助手的所有权和领域出口的保留方式。**

   [c1-book.md:16](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:16) 的 “only G1 creates or edits them” 与 delta `:108–111` 明确分配给 G2–G5 的局部助手冲突。“every existing export as a re-export” 则与 refresh `:12` 要求保留领域参数类型的编码包装冲突，例如 `decision-record-codecs.ts:53`、`execution-history-codecs.ts:130`。

   建议把规则 2 替换为：

   > 只有本书明确分配给 G1 的跨组公共模块由 G1 创建和修改。G2–G5 各自创建、修改 delta 分配给本组的区域助手；跨组消费者只导入。  
   > 保留现有导出名称、参数／返回类型及行为。同签名、同协议的已搬移助手可原名 re-export；事件编码器、业务包装和返回形状不同的入口保留原签名包装，内部调用公共实现。未迁移的导出不动。

6. **规则 4 的“任何测试失败都是行为改变”与分组顺序无法同时成立。**

   G1 创建编号函数和几类失败映射，消费者却属于 G2／G4／G5。它们在 G1 单独结束时可能尚无生产调用。[production-reach.test.ts:103](D:/cxt/k3-merge-review/tests/architecture/production-reach.test.ts:103) 会拒绝未列入 allowlist 的不可达声明；`:104` 还会拒绝已经失效的 allowlist 项。这是结构门禁，不等于业务行为变化。

   建议替换相关文字：

   > 测试源码、断言和 allowlist 不修改。测试失败先区分本次行为回归、既有／环境失败和分组造成的暂未接线；不得仅凭失败就断言行为改变。  
   > G1 冻结时，lead 在交接表逐符号列出“消费者在后续组”的声明。中间组必须照实报告 production-reach 的阶段性失败，且新增失败只能与该冻结表精确对应；不得称为测试通过，不得加假调用或放宽 allowlist。全部消费者接线后，这些例外必须归零，最终合并树通过完整检查。  
   > 相关测试选择包含经 fixture／helper 间接依赖改动文件的测试，不能只 grep 测试文件中的直接 import。

7. **规则 6 把 TA-4／VW-4 的范围从两种编号缩成了 edge 编号。**

   `c1-book.md:20` 写 “only the edge-id call”；refresh `:122`、delta `:30` 要求保留并抽取 `edge:`／`legacy:` 编号。当前 assembler 两处分别在 [context-assembler.ts:766](D:/cxt/k3-merge-review/src/core/agent-runtime/context-assembler.ts:766) 和 `:780`。

   建议替换为：

   > `execution-preparation.ts` 完全不动。`context-assembler.ts` 仅修改 `declarationsForTask` 内 edge 编号表达式（当前 :766–768）、legacy 编号表达式（:780）及必要 import。不合并整个枚举函数，不排序；assembler／graph reader 保持先 edge 后 legacy，两个 task 服务保持先 legacy 后 edge。entry 的 schemaVersion 门槛及对象复制保持。  
   > `atLeastCursor` 修复明确不在任何 C1 组内；delta 的“另列提交”不构成本次授权。

8. **缺少后续组可执行的冻结交接内容，以及可复核的行数口径。**

   `c1-book.md:34` 的 300-word 回复不足以同时承担 API 冻结、未接线清单、测试列表和后续组交接；delta `:120` 要求的是冻结公共出口。当前副本无 Git 元数据，delta `:3` 已说明，因此 book `:25` 的 `git diff --shortstat` 也需要施工基线前提。

   建议加入：

   > 每次 `c1-run.md` 指明施工根、基线提交／快照、准确文件白名单、前置组版本和冻结接口表。接口表逐项写模块路径、导出名、签名、返回形状、原实现来源及消费者所属组。  
   > G1 冻结本组公共接口；G4 冻结终态候选选择接口后，G3 才启动。区域助手按第 2 条归属，不允许其他组临时改公共签名。N12 明确纳入 G5，沿 delta :71 保留一次 readMany、notFound 形状和各自错误模板。  
   > 300-word 限制只用于摘要；接口表、逐项完成表、测试列表和跨组待接线表不受此限。  
   > 新增＋删除相对本次施工基线统计，必须包含新增文件；净减另报。没有 Git 基线时采用前后快照比较，不报告不存在的 git diff 数字。

**体量判断：目前不必强制拆 G1，但应按接近上限安排。** 按当前明确迁移的约 100 个函数／编码入口粗数，原函数段约 490 行；加上公共实现、接线和独立注释清理，预算约 **1,000–1,200 行新增＋删除**较稳妥。它不是实际 diff；delta `:107` 的 800–1,050 也只是估算。

任务书可补一句：

> 若完整列项后的预计改动超过 1,200 行，按文件拆为 G1a／G1b：G1a 持有 contracts、两个 tasks helper 文件、rework-codecs、read-result-failures、新公共 helper 文件及 record／decision／line-settings codecs；G1b 持有其余命中的 persistence 文件及 materials／evidence。G1b 在 G1a 接口冻结后执行；不为达到 600 行凑改动。

must-fix count: 8