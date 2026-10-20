发现 11 项。全程只读，未运行测试、构建、Git 写操作或网络请求。下文 `.lead-ref/base/` 的行号指被删除代码的基线版本；“OK”仅针对 G3 范围。

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G3-01 | 会出错 | `.lead-ref/base/tests/data/project-source-index.test.ts:41`、`:45`、`:47`、`:49`；`tests/data/typescript-source-query.test.ts:149` | TP-026 | 分析器增量断言没有迁移。旧测试分别检查：重复读取 `total:0`；新增 `src/new.ts`；重命名产生 added/deleted；修改产生 modified。旧入口直接返回分析器的 `changes`（`.lead-ref/base/src/core/workspace/project-source-index.ts:91`、`:96`），当前分析器仍计算并返回这些字段（`src/core/workspace/typescript-source-query.ts:168`、`:251`、`:265`）。新测试只迁入查询结果、include、别名和 72 文件断言（`tests/data/typescript-source-query.test.ts:163`）。例如新增文件后错误返回空 added，旧测试失败，新测试没有对应检查。 | 在 `typescript-source-query.test.ts` 中通过真实文件的重复捕获、新增、重命名、修改，保留原来的四组增量断言；不恢复旧索引类。 |
| G3-02 | 会出错 | `.lead-ref/base/tests/app/project-source-tool.test.ts:270`、`:274`；`tests/app/project-source-tool.test.ts:255` | TP-026 | 整条混合用例删除时，连当前 frozen 工具的名称和注册属性断言一起删了。`read_only`、`workspace_read`、60000 毫秒、65536 字节仍是生产定义（`src/core/agent-runtime/project-source-tool.ts:236`、`:239`）。接替用例检查分页、冻结读取和授权，没有检查这些属性（`tests/app/project-source-tool.test.ts:145`、`:180`、`:225`）。例如超时值误改，旧 `:274` 会失败，现无对应断言。 | 将原 frozen 名称断言及四个注册属性断言移入现有 frozen 用例；只删除 legacy 部分。 |
| G3-03 | 违规 | `tests/app/S0-attention-edge-label.test.ts:138`、`:166`、`:168` | TQ-001 | 新前置仍把测试手造的 Plan draft 交给 `plans.proposePlan` 接受，再采用，属于 F1（`.lead-ref/books/test-rule-sheet-v1.md:57`）。这不是原样保留 BLOCKED 部分，而是新增的绕行前置；书面改正明确要求 A1（`.lead-ref/books/t-items-TQ.md:14`）。 | 改为共享的真实初始规划链：公开 submit/createSession/claim/prepare/start，由脚本模型产生回复，再经 `planning_answer`、`adopt_initial_plan`。两边固定相同 project/goal/intent 和架构，独立计算预期标识与 revision，保留全部边变化断言。 |
| G3-04 | 违规 | `tests/app/A2-continuation-projection.test.ts:84`、`:91`、`:97`、`:105` | TP-069 | 四处原本检查一次 `advance` 的返回，改成检查整条 Workflow 的最后一步。基线单步调用见 `.lead-ref/base/tests/app/A2-continuation-projection.test.ts:47`、`:111`；新 helper 会继续执行 `next`（`tests/helpers/A2-restart-fixture.ts:93`、`:99`）。若第一次错误返回可继续的步骤，后续才 waiting，新断言可能通过，原断言会失败。条目只授权合并 helper，未授权改指断言。 | 四处通过已有共享 `post` 各调用一次 `workflow/advance`，检查该次返回的 value；初始启动链仍可使用 `driveWorkflow`。 |
| G3-05 | 违规 | `tests/business/WP1-start-refusal.test.ts:17`、`:42` | TP-009、TP-054 | 两处确实只是补 `await`，原业务断言未改；但这不是规则 1 的例外。该例外只允许删除符号引起的导入或使用清理（`.lead-ref/books/t-book.md:38`）；这里同名函数仍存在，只变成 async（`tests/helpers/WP1-units-fixture.ts:505`）。DSH 已承认文件在白名单外（`.lead-ref/replies/t-reply-TP.md:210`）。上游又以 assembler 补 binding、继续手造 prepared，绕过了其声明的 BLOCKED（`tests/helpers/WP1-units-fixture.ts:512`、`:515`、`:530`）。 | 将这两处改动与上游 WP1 的 BLOCKED 绕行一起撤回。真实 prepare 的迁移及本文件编辑范围须先纳入冻结方案，再施工。 |
| G3-06 | 违规 | `tests/composition/platform.test.ts:80` | TP-001、TP-005 | 未知 kind 的 unsupported 断言保住了，但没有按 A6 放入 `describe('rejects: …')`，也没有公开读取证明拒绝后状态不变；断言后直接关闭平台（`:82`、`:83`）。A6 明确要求这两项（`.lead-ref/books/test-rule-sheet-v1.md:45`），此前书核也明确要求按 A6 迁移（`.lead-ref/books/t-bk-TPa.out.md:19`）。 | 将该拒绝检查迁入 A6 场景，公开建立前置，仅令 kind 无效，通过公开读取比较拒绝前后状态；保留 unsupported 断言及双后端。 |
| G3-07 | 不整洁 | `tests/app/A2-continuation-projection.test.ts:35`；`tests/app/A2-requeue-route.test.ts:26`；`tests/app/A2-reverify-route.test.ts:28`、`:32` | TP-069 | helper 搬走后留下无用导入：continuation 的 `AG2B_GOAL_REF`、`plain`；requeue 的 `AG2B_WORK_TASK_ID`；reverify 的 `ReadResult`、`plain`。 | 删除上述无用导入。 |
| G3-08 | 不整洁 | `tests/app/AG2-consultation.test.ts:27`、`:31`、`:32`、`:33`、`:60`；`tests/app/R6-host.test.ts:25`、`:26` | TP-070 | CLI 启动合并后留下无用导入：AG2 的 `mkdir`、`writeFile`、`createLocalWorkbenchHost` 值导入、`loadWorkbenchCliConfig`、`ProviderRegistry`、新引入的 `readPageToken`；R6 的 `loadWorkbenchCliConfig`、`ProviderRegistry`。 | 删除这些导入；保留仍使用的 `LocalWorkbenchHost`、`ModelRequest` 类型。 |
| G3-09 | 不整洁 | `tests/app/S2B-r2-backfill-identity.test.ts:19`、`:25`；`tests/app/S2B-r2-backfill-revision-race.test.ts:17`、`:20`；`tests/app/S2B-r2-backfill-real-kernel.test.ts:23`、`:25`、`:26`、`:29`、`:65` | TP-071 | helper 合并后，identity、revision-race 的 `ReadResult`、`RunActivityViewV1` 无用；real-kernel 的 `RunRef`、`ReadResult`、`RunActivityViewV1`、`UI_PLATFORM_TOKEN_META_NAME` 无用。原读页面 token 的注释还贴在 `postActivityBackfill` 前（`:65`、`:67`）。 | 删除上述导入及错位的 token 注释。 |
| G3-10 | 不整洁 | `tests/data/R3b-body-boundaries.test.ts:2`、`:15`、`:21`、`:26`；`tests/data/R3b-materials-contract.test.ts:2`、`:11`、`:23` | TQ-094、TQ-095、TQ-096、TQ-097、TQ-099 | 删除用例后残留专用设施。body-boundaries 中有无用的 SQLite/临时目录导入、`ArtifactBodyRows`、`otherOwner`、`keyFor`、`rowFor` 和永远为空的目录清理；materials-contract 中也残留 SQLite/临时目录导入和空目录清理。现存用例分别从 `:32`、`:44` 开始，不再使用这些设施。 | 删除这些专用残留；保留 body-boundaries 的 `vi.restoreAllMocks()`、仍使用的 `refFor` 和现存用例。 |
| G3-11 | 不整洁 | `tests/app/S2C-line-routes.test.ts:293`、`:298` | TP-098、TP-161 | 删除旧 L 后，测试名仍写“14-Session”，注释仍写三个 archived head；当前数组只有 13 个 Session（`:304`），当前 D1 明确断言 archived 为 2（`tests/work-graph/S2C-lines-d1.test.ts:37`）。 | 测试名改为 13-Session，注释改为两个 archived head。 |

四个重点的核对结论：

- **allowlist 未发现问题。** 对照基线逐项核对后，182 条变为 164 条，18 条删除、85 条 reason/note 修改，没有新增或重排；与合并记录一致（`.lead-ref/t-audit-merge-notes.md:8`）。其中 `kernelToolNameOf` 是明确授权的特殊情况：TP-056 要求接入生产后移除名单，而非删除声明（`.lead-ref/books/t-items-TP.md:404`；`src/core/work-graph/state/unknown-call-kinds.ts:44`；`src/core/agent-runtime/observed-model-run.ts:303`）。其余 17 个删除项对应声明已删除。
- **TP-035 文案正确。** 当前 note 保留 install/activate 两个入口，符合书面改正（`tests/architecture/production-reach-allowlist.json:542`；`.lead-ref/books/t-items-TP.md:259`）。DSH“没有书面改正”的说法与实际书不符（`.lead-ref/replies/t-reply-TP.md:257`），不构成当前 allowlist 的问题。
- **S0 的 `REVISION` 不应报 F8。** 它由测试本地字面值组成，摘要可从注释中的固定 JSON 独立复算；代码没有从生产常量或运行结果取得预期值（`tests/app/S0-attention-edge-label.test.ts:37`、`:46`、`:47`）。问题是 G3-03 的 F1 前置。
- **TP-026 没有迁完所有仍存在的行为。** include、别名、72 文件和跨文件查询已经迁入（`tests/data/typescript-source-query.test.ts:149`）；遗漏的是 G3-01、G3-02。旧 live 分页和 stale 协议本身随旧入口退出，不要求恢复。

逐项结论：

```text
TP-001: G3-06
TP-004: OK
TP-005: G3-06
TP-006: OK
TP-009: G3-05
TP-013: OK
TP-014: OK
TP-016: OK
TP-017: OK
TP-018: OK
TP-019: OK
TP-020: OK
TP-021: OK
TP-022: OK
TP-023: OK
TP-024: OK
TP-026: G3-01, G3-02
TP-027: OK
TP-028: OK
TP-031: OK
TP-032: OK
TP-033: OK
TP-034: OK
TP-035: OK
TP-036: OK
TP-037: OK
TP-038: OK
TP-039: OK
TP-040: OK
TP-042: OK
TP-043: OK
TP-044: OK
TP-049: OK
TP-050: OK
TP-051: OK
TP-054: G3-05
TP-056: OK
TP-057: OK
TP-058: OK
TP-062: OK
TP-064: OK
TP-067: OK
TP-068: OK
TP-069: G3-04, G3-07
TP-070: G3-08
TP-071: G3-09
TP-073: OK
TP-074: OK
TP-075: OK
TP-076: OK
TP-078: OK
TP-098: G3-11
TP-103: OK
TP-105: OK
TP-161: G3-11
TQ-001: G3-03
TQ-002: OK
TQ-003: OK
TQ-004: OK
TQ-005: OK
TQ-006: OK
TQ-007: OK
TQ-008: OK
TQ-009: OK
TQ-010: OK
TQ-011: OK
TQ-012: OK
TQ-013: OK
TQ-014: OK
TQ-015: OK
TQ-016: OK
TQ-017: OK
TQ-018: OK
TQ-019: OK
TQ-020: OK
TQ-021: OK
TQ-022: OK
TQ-023: OK
TQ-024: OK
TQ-025: OK
TQ-026: OK
TQ-027: OK
TQ-028: OK
TQ-029: OK
TQ-030: OK
TQ-031: OK
TQ-032: OK
TQ-033: OK
TQ-034: OK
TQ-035: OK
TQ-036: OK
TQ-037: OK
TQ-038: OK
TQ-039: OK
TQ-040: OK
TQ-041: OK
TQ-042: OK
TQ-043: OK
TQ-044: OK
TQ-045: OK
TQ-046: OK
TQ-047: OK
TQ-048: OK
TQ-049: OK
TQ-050: OK
TQ-051: OK
TQ-052: OK
TQ-053: OK
TQ-054: OK
TQ-055: OK
TQ-056: OK
TQ-057: OK
TQ-058: OK
TQ-059: OK
TQ-060: OK
TQ-061: OK
TQ-062: OK
TQ-063: OK
TQ-064: OK
TQ-065: OK
TQ-066: OK
TQ-067: OK
TQ-068: OK
TQ-069: OK
TQ-070: OK
TQ-073: OK
TQ-074: OK
TQ-075: OK
TQ-076: OK
TQ-077: OK
TQ-078: OK
TQ-079: OK
TQ-080: OK
TQ-081: OK
TQ-082: OK
TQ-083: OK
TQ-085: OK
TQ-086: OK
TQ-089: OK
TQ-090: OK
TQ-093: OK
TQ-094: G3-10
TQ-095: G3-10
TQ-096: G3-10
TQ-097: G3-10
TQ-098: OK
TQ-099: G3-10
```

BLOCKED 和 partial 部分：

| 条目 | 部分 | DSH 原因是否属实 | 公开步骤是否可达 |
|---|---|---|---|
| TQ-001 | S0 的合法 Plan 前置 | **“不能生成字面 p1”属实；“不能满足本项”不属实。** 入口固定生成 `initial-plan-<hash>`，但哈希只依赖 projectId、goalId、intentId（`src/core/work-graph/tasks/initial-plan.ts:105`）；书面改正要求双方标识相同，没有要求必须是 p1（`.lead-ref/books/t-items-TQ.md:14`）。 | **可达。** 两个独立平台使用相同公开身份，脚本回复只改变依赖 kind/label；归一化保留模型的任务和依赖内容（`src/core/work-graph/tasks/initial-plan.ts:142`）。真实查询链示例见 `tests/app/R6-host.test.ts:729`、`:743`、`:749`、`:755`；随后 `planning_answer` 和采用入口见 `src/business/workflow/workflow.ts:828`、`:860`。当前新增 F1 绕行计 G3-03。 |
| TP-054（吸收 TP-009） | WP1 start-refusal 的真实 prepare | **对现有 double 属实。** 它把 `prepareExecution` 绑定为 forbidden，start 返回指定拒绝（`tests/helpers/WP1-units-fixture.ts:558`、`:559`）。这不能证明产品入口不可达。其 assembler 加手造 prepared 的替代路径也不是原样保留（`:512`、`:530`）。 | **测试所需前置可达。** 使用真实 `runtime.prepareExecution` 生成 prepared，再用 A2 包装真实 Runtime 的 start 边界注入一次指定拒绝；生产 prepare/start 接线见 `src/core/agent-runtime/runtime.ts:730`、`:731`，A2 允许这种故障包装（`.lead-ref/books/test-rule-sheet-v1.md:28`）。本次未经冻结的绕行及组外适配计 G3-05。 |

```json
[
  {
    "id": "G3-01",
    "class": "会出错",
    "file": ".lead-ref/base/tests/data/project-source-index.test.ts",
    "line": 41,
    "item": "TP-026",
    "problem": "删除了重复读取 total:0、新增、重命名及修改对应的分析器 changes 断言（原文件:41、45、47、49）。当前 src/core/workspace/typescript-source-query.ts:168、251、265 仍计算并返回这些字段；tests/data/typescript-source-query.test.ts:149 的迁入用例没有检查 changes。例如新增 src/new.ts 后错误返回空 added，旧断言失败，现无对应检查。",
    "fix": "在 typescript-source-query.test.ts 中通过真实文件的重复捕获、新增、重命名和修改，迁入原四组增量断言，不恢复旧索引类。"
  },
  {
    "id": "G3-02",
    "class": "会出错",
    "file": ".lead-ref/base/tests/app/project-source-tool.test.ts",
    "line": 274,
    "item": "TP-026",
    "problem": "删除混合用例时丢失当前 frozen 工具的名称断言（:270）及 effectClass、requiredCapabilities、defaultTimeoutMs、outputLimitBytes 断言（:274）。生产定义仍在 src/core/agent-runtime/project-source-tool.ts:236、239；接替测试 tests/app/project-source-tool.test.ts:145、180、225 没有检查这些属性。例如超时误改时旧断言失败，现无对应检查。",
    "fix": "把原 frozen 名称断言及四个注册属性断言迁入现有 frozen 用例，仅删除 legacy 部分。"
  },
  {
    "id": "G3-03",
    "class": "违规",
    "file": "tests/app/S0-attention-edge-label.test.ts",
    "line": 168,
    "item": "TQ-001",
    "problem": "planDraft 在:138 手造 Plan，:166 的 proposePlan 接受该 draft 后继续采用，违反规则表 F1 和条目要求的 A1；这是新增绕行前置，非原样保留 BLOCKED。initial-plan.ts:105 的确定性标识不妨碍双方标识相同，:142 保留模型依赖边。",
    "fix": "通过共享的真实查询 submit/createSession/claim/prepare/start 链及脚本模型回复，再经 planning_answer/adopt_initial_plan 生成计划；固定双方公开身份和架构，独立计算标识与 revision，保留全部边断言。"
  },
  {
    "id": "G3-04",
    "class": "违规",
    "file": "tests/app/A2-continuation-projection.test.ts",
    "line": 84,
    "item": "TP-069",
    "problem": ":84、91、97、105 把原单次 advance 返回断言改为 driveWorkflow(...).at(-1)。tests/helpers/A2-restart-fixture.ts:93、99 会继续执行 next；第一次错误推进、后来才 waiting 的结果可能通过新断言，原单步断言会失败。",
    "fix": "四处使用已有共享 post 各调用一次 workflow/advance，断言该次返回的 value；初始启动链继续使用 driveWorkflow。"
  },
  {
    "id": "G3-05",
    "class": "违规",
    "file": "tests/business/WP1-start-refusal.test.ts",
    "line": 17,
    "item": "TP-009, TP-054",
    "problem": ":17、42 虽仅补 await，但文件在白名单外，且同名函数仍在 tests/helpers/WP1-units-fixture.ts:505，不属于 t-book.md:38 的删除符号例外。上游:512、515、530 用 assembler 加手造 prepared 绕过声明的 BLOCKED。",
    "fix": "将两处 await 改动与上游 WP1 的 BLOCKED 绕行一起撤回；待真实 prepare 迁移及本文件编辑范围纳入冻结方案后再施工。"
  },
  {
    "id": "G3-06",
    "class": "违规",
    "file": "tests/composition/platform.test.ts",
    "line": 80,
    "item": "TP-001, TP-005",
    "problem": "未知 kind 的拒绝检查没有放入 describe('rejects: …')，也没有公开读取断言状态不变，:83 即关闭平台。违反 test-rule-sheet-v1.md:45 和 t-bk-TPa.out.md:19 的 A6 要求。",
    "fix": "将拒绝检查迁入 A6 场景，以公开步骤建立前置，仅令 kind 无效，通过公开读取比较拒绝前后状态，保留 unsupported 断言及双后端。"
  },
  {
    "id": "G3-07",
    "class": "不整洁",
    "file": "tests/app/A2-continuation-projection.test.ts",
    "line": 35,
    "item": "TP-069",
    "problem": "共享 helper 迁移留下无用导入：本文件:35 的 AG2B_GOAL_REF、plain；tests/app/A2-requeue-route.test.ts:26 的 AG2B_WORK_TASK_ID；tests/app/A2-reverify-route.test.ts:28、32 的 ReadResult、plain。",
    "fix": "删除列明的无用导入。"
  },
  {
    "id": "G3-08",
    "class": "不整洁",
    "file": "tests/app/AG2-consultation.test.ts",
    "line": 27,
    "item": "TP-070",
    "problem": "CLI 合并留下无用导入：本文件:27、31、32、33、60 的 mkdir、writeFile、createLocalWorkbenchHost 值导入、loadWorkbenchCliConfig、ProviderRegistry、readPageToken；tests/app/R6-host.test.ts:25、26 的 loadWorkbenchCliConfig、ProviderRegistry。",
    "fix": "删除列明的导入，保留仍使用的 LocalWorkbenchHost、ModelRequest 类型。"
  },
  {
    "id": "G3-09",
    "class": "不整洁",
    "file": "tests/app/S2B-r2-backfill-real-kernel.test.ts",
    "line": 23,
    "item": "TP-071",
    "problem": "本文件:23、25、26、29 留下无用 RunRef、ReadResult、RunActivityViewV1、UI_PLATFORM_TOKEN_META_NAME，:65 的 token 注释错贴在 POST helper 前。tests/app/S2B-r2-backfill-identity.test.ts:19、25 和 tests/app/S2B-r2-backfill-revision-race.test.ts:17、20 也留下无用 ReadResult、RunActivityViewV1。",
    "fix": "删除列明的无用导入及错位 token 注释。"
  },
  {
    "id": "G3-10",
    "class": "不整洁",
    "file": "tests/data/R3b-body-boundaries.test.ts",
    "line": 21,
    "item": "TQ-094, TQ-095, TQ-096, TQ-097, TQ-099",
    "problem": "本文件:2、15、21、26 残留已删用例专用的 SQLite/临时目录导入、ArtifactBodyRows、otherOwner、keyFor、rowFor 和空目录清理。tests/data/R3b-materials-contract.test.ts:2、11、23 同样残留 SQLite/临时目录导入及空目录清理。",
    "fix": "删除这些专用残留；保留 body-boundaries 的 vi.restoreAllMocks()、仍使用的 refFor 和现存用例。"
  },
  {
    "id": "G3-11",
    "class": "不整洁",
    "file": "tests/app/S2C-line-routes.test.ts",
    "line": 293,
    "item": "TP-098, TP-161",
    "problem": ":293 仍称 14-Session，:298 仍称三个 archived head；:304 的数组已为 13 个 Session，tests/work-graph/S2C-lines-d1.test.ts:37 明确断言 archived 为 2。",
    "fix": "测试名改为 13-Session，注释改为两个 archived head。"
  }
]
```

会出错 2，违规 4，不整洁 5，建议 0