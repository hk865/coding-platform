已完成只读静态审查；未运行测试、构建或联网，也未改动文件。

**1. 发现表**

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T3a-01 | 会出错 | `tests/app/A2-settings-automation.test.ts:122`、`:131`、`:140` | T3-004 | 零值分支只做“启动→重开”，随后把策略改成 5 才执行 `models/save`。原例检查的是“0/false→models/save→仍为0/false→重开”（`.lead-ref/base/tests/app/A2-settings-automation.test.ts:95`）。具体漏测：若 `models/save` 用 `autoReworkLimit || 3`，错误地把 0 存成 3，现测试仍通过。 | 在零值分支内、保存 5 之前执行原 `models/save`，恢复存盘仍为 0/false 和随后重开的断言。 |
| T3a-02 | 会出错 | `tests/work-graph/S8A-L8-observation-state.test.ts:395`、`:919`、`:924` | T3-019 | 新“迟到 ready”变体没有等待读取完成就通知闸门。关闭同步 abort（`src/app/auto-capture-driver.ts:299`），真实读取随后返回 cancelled（`src/core/work-graph/architecture/architecture-service.ts:1473`、`:1475`）。原例先 await 真实结果再进入闸门（`.lead-ref/base/tests/app/S8A-L8-capture-start.test.ts:327`）。具体漏测：驱动若在取消后收到 ready 时错误调用一次 capture，新例因收到 cancelled，计数仍为 0，照样通过。 | ready 分支先 await 真实读取并确认 ready，再通知 entered、等待释放，最后原样返回缓存的 ready。 |
| T3a-03 | 违规 | `tests/work-graph/S8A-L8-observation-state.test.ts:759`、`:766` | T3-018 | 无旧观测变体把原精确原因 `injected start-state throw` 改成了 `injected observation-state throw`；原值见 `.lead-ref/base/tests/app/S8A-L8-capture-start.test.ts:258`、`:265`。条目要求搬入精确原因，没有授权改值（`.lead-ref/books/t-items-T3.md:271`；`.lead-ref/books/t-book.md:57`）。这里仅判字面规则违规，不声称覆盖强度下降。 | 仅让新增无旧观测变体注入并断言原字符串，保留旧变体及 helper 默认文案。 |
| T3a-04 | 违规 | `tests/scenarios/C8-human-stop-respected.test.ts:458`、`:461`、`:462` | T3-027 | 没有完整迁入原精确请求断言：缺 `reason:null`、`next.taskId`、完整 `planRef` 的 revision，以及 `complete_task.input` 的 `taskRef/planRef/roundRef`。原断言见 `.lead-ref/base/tests/business/A2-workflow-auto-rework.test.ts:248`、`:257`；现有操作名序列不能替代这些字段断言。 | 用该真实场景取得的引用，逐项补回上述精确字段及 `complete_task` 请求断言。 |
| T3a-05 | 违规 | `tests/runtime/R4c-execution-history.test.ts:68`、`:111`、`:123`、`:126`、`:157`、`:177` | T2-025、T2-032 | 已转换行仍打开 Kernel Store，经 `rawRecords/positionsOf` 取得位置和数量，再生成期望，残留 F7/F8。规则见 `.lead-ref/books/test-rule-sheet-v1.md:76`、`:78`；转换期望要求见 `.lead-ref/books/t-book.md:83`。 | 改为公开历史读取作实际证据；固定脚本对应的位置、数量期望写成独立手算字面量并注释推导，不从库或程序输出生成。 |
| T3a-06 | 违规 | `tests/runtime/R4c-execution-history.test.ts:127` | T2-025、T2-032 | 交叉拼接两次执行的 `runId/turnId`，随后要求 owner 接受并返回 ready。它既不是公开返回的完整身份，也不是 A6 拒绝输入；违反 `.lead-ref/books/t-book.md:71`。真实身份成对生成见 `src/core/agent-runtime/execution-driver.ts:620`。 | 将这两个拼接身份子例单列 BLOCKED，原样保留基线子段，交 lead 冻结后续处理；不得把拼接值算作完成转换。 |
| T3a-07 | 违规 | `tests/runtime/R4c-execution-history.test.ts:276` | T2-025、T2-031、T2-032 | `not_ready` 子段仍由替身手造结果和 `owner-watermark` 游标，残留 F4，却未列为阻断；回复只申报 observer-down（`.lead-ref/replies/t-reply-T3.md:117`）。真实历史路径没有该水位等待入口（`src/core/agent-runtime/session-operations.ts:753`、`:767`；`src/core/work-graph/sessions/session-directory.ts:1178`）。 | 保留原子段，单列 BLOCKED／missing entry point，并从“已转换”范围中扣除；不另造水位或返回值替身。 |
| T3a-08 | 违规 | `tests/runtime/R4c-execution-history.test.ts:379`、`:400` | T2-025、T2-032 | 损坏历史子段仍把真实读取结果 spread 后改写正文、位置、记录身份等，属于 F2；不满足 A3 的原样返回，也不在 A7 损坏注入的两个文件范围内（`.lead-ref/books/test-rule-sheet-v1.md:35`、`:61`；`.lead-ref/books/test-rule-sheet-v2.md:50`）。 | 保留基线子段并单列 BLOCKED，停止将其计作完成转换；由 lead 裁定允许的替代入口，不增加同类改写 helper。 |
| T3a-09 | 违规 | `tests/runtime/R4c-execution-history.test.ts:199`、`:267`；`tests/runtime/R4b-session-recovery.test.ts:224` | T2-025、T2-030、T2-032 | 手造错误游标、身份及跨 Session 拒绝例仍未放入 `describe('rejects: …')`，也没有公开读取验证前后不变。刷新明确要求按 A6 保留（`.lead-ref/books/t-items-T3.md:90`、`:117`），A6 具体要求见 `.lead-ref/books/test-rule-sheet-v1.md:45`。 | 将这些拒绝子例按单一错误整理到 `rejects:` 块，保留原拒绝断言，并用真实公开历史读取核对调用前后不变。 |
| T3a-10 | 违规 | `tests/runtime/R4b-session-recovery.test.ts:100`、`:125`、`:147`、`:172` | T2-029 | bootstrap 转换后，三个恢复场景仍通过 `withStore→store.list` 断言 Kernel Session 已创建且唯一，残留 F7。公开 Session 查询只看到 WG 映射，不能证明未映射 Kernel Session 的实际存在和总数（`src/core/work-graph/sessions/session-directory.ts:1192`、`:1527`）。 | 将这些断言子段登记 BLOCKED／missing entry point，保留原断言等待 lead 冻结替代；不得降格成 `findSessions` 只有一项。 |
| T3a-11 | 违规 | `tests/composition/R3d-R3g-platform.test.ts:211` | T3-038 | 尾段仍打开数据库检查 pointer revision、readThrough、observedRef 和 active 记录，残留 F7，却标为 done（`.lead-ref/replies/t-reply-T3.md:56`）。公开 observationState 没有前两项内部字段（`src/contracts/architecture-observation.ts:53`）。 | 将该尾段单列 BLOCKED／missing entry point，保留原断言，由 lead 冻结等价公开验证；不能删除或放松这些断言。 |
| T3a-12 | 违规 | `tests/composition/R3d-R3g-platform.test.ts:54`、`:126`、`:132`、`:165` | T3-038 | digest 期望先由生产函数 `roleSpecContentDigest` 算出，随后又从安装返回的 pin 复制，违反 F8 和独立期望要求（`.lead-ref/books/t-book.md:83`）。 | 为固定角色内容给出独立推导的 digest 字面量和计算说明，用于这些期望；返回 pin 只用于后续公开调用的引用传递。 |
| T3a-13 | 违规 | `tests/composition/A1-graph-session-platform.test.ts:99`、`:156`、`:202` | T3-035 | 三处把整份 `adopted.value` 当期望，残留 F8。输入内容明列在 `:85`，但采用步骤若把 description 写错并返回同一错值，这些读取断言仍通过。 | 依据固定采用输入，独立列出 baseline/catalog 完整预期；这三处不再复制 `adopted.value`。 |
| T3a-14 | 不整洁 | `tests/helpers/WP2-duties-fixture.ts:1` | T3-101 | 删除完整夹具后，文件头仍称本文件创建真实 pinned roles、Sessions、entered Work 和 coordination matrix；现仅剩职责列表、映射和角色内容函数（`:12`、`:15`、`:22`）。 | 将文件头改为描述当前保留的三项职责，删除已不存在的流程说明。 |

**2. 逐条结论**

“OK”表示本部分静态审查未发现问题；已申报的 partial 另见下一表。

- T1-070: OK（阻断核对：`tests/helpers/K3-35-runtime.ts:113`）
- T2-001: OK（`.lead-ref/parts/T3a.diff:734`）
- T2-002: OK（`.lead-ref/parts/T3a.diff:734`、`:2759`）
- T2-005: OK（`tests/kernel/README.md:20`）
- T2-009: OK（`.lead-ref/parts/T3a.diff:2533`、`:2572`）
- T2-022: OK（`.lead-ref/parts/T3a.diff:734`、`:2759`）
- T2-025: T3a-05、T3a-06、T3a-07、T3a-08、T3a-09
- T2-028: OK（`.lead-ref/parts/T3a.diff:2965`；`tests/runtime/R4c-execution-history.test.ts:272`）
- T2-029: T3a-10
- T2-030: T3a-09
- T2-031: T3a-07
- T2-032: T3a-05、T3a-06、T3a-07、T3a-08、T3a-09
- T3-002: OK（`tests/app/A2-runtime-capabilities.test.ts:210`、`:231`）
- T3-003: OK（`.lead-ref/parts/T3a.diff:5`、`:221`、`:2434`）
- T3-004: T3a-01
- T3-014: OK（`tests/app/S4C2-scribe-reminders.test.ts:471`；`.lead-ref/parts/T3a.diff:301`）
- T3-016: OK（`tests/app/S8A-L8-host-close-restart.test.ts:103`；`.lead-ref/parts/T3a.diff:364`）
- T3-018: T3a-03
- T3-019: T3a-02
- T3-023: OK（`tests/app/S3-attention-context.test.ts:238`；`.lead-ref/parts/T3a.diff:398`）
- T3-025: OK（`.lead-ref/parts/T3a.diff:417`、`:441`）
- T3-026: OK（`tests/app/ui-actions.test.ts:71`；`.lead-ref/parts/T3a.diff:477`）
- T3-027: T3a-04
- T3-035: T3a-13
- T3-036: OK（`.lead-ref/parts/T3a.diff:618`）
- T3-038: T3a-11、T3a-12
- T3-045: OK（`tests/data/S8D-compact-snapshot.test.ts:70`；`.lead-ref/parts/T3a.diff:1346`）
- T3-046: OK（`tests/data/S8D-compact-snapshot.test.ts:44`；`.lead-ref/parts/T3a.diff:1346`）
- T3-047: OK（`tests/data/S8D-A22-cpp-imports.test.ts:174`）
- T3-048: OK（`tests/data/S8D-A22-cpp-imports.test.ts:156`）
- T3-049: OK（`tests/data/S8D-A22-cpp-imports.test.ts:247`）
- T3-050: OK（`tests/data/S8D-A22-cpp-imports.test.ts:396`）
- T3-051: OK（`tests/data/S8D-A23-cpp-config.test.ts:285`；`.lead-ref/parts/T3a.diff:955`）
- T3-052: OK（`tests/data/S8D-A23-cpp-config.test.ts:216`）
- T3-053: OK（`tests/data/S8D-A23-cpp-config.test.ts:236`）
- T3-054: OK（`tests/data/S8D-A23-cpp-config.test.ts:253`）
- T3-055: OK（`tests/data/S8D-A23-cpp-config.test.ts:269`）
- T3-056: OK（`tests/data/S8D-A23-cpp-config.test.ts:301`）
- T3-057: OK（`tests/data/S8D-A23-cpp-config.test.ts:318`）
- T3-058: OK（`tests/data/S8D-A23-cpp-config.test.ts:333`）
- T3-059: OK（`tests/data/S8D-A23-cpp-config.test.ts:349`）
- T3-060: OK（`tests/data/S8D-A23-cpp-config.test.ts:172`；`.lead-ref/parts/T3a.diff:1038`、`:1112`）
- T3-061: OK（本部分覆盖端：`tests/data/S8D-A20-python-imports.test.ts:148`、`tests/data/S8D-A22-cpp-imports.test.ts:114`）
- T3-062: OK（`.lead-ref/parts/T3a.diff:779`、`:1142`）
- T3-063: OK（`.lead-ref/parts/T3a.diff:1508`、`:1535`、`:1555`）
- T3-065: OK（`.lead-ref/parts/T3a.diff:1573`、`:1586`）
- T3-066: OK（`tests/data/S8E-old-format-rejection.test.ts:58`；`.lead-ref/parts/T3a.diff:1330`）
- T3-067: OK（本部分覆盖端：`tests/data/S8D-A20-python-imports.test.ts:142`）
- T3-068: OK（`tests/data/S8D-A20-python-imports.test.ts:146`；`.lead-ref/parts/T3a.diff:1418`）
- T3-069: OK（`tests/data/S8D-A21-python-config.test.ts:191`）
- T3-070: OK（`tests/data/S8D-A21-python-config.test.ts:64`）
- T3-071: OK（`.lead-ref/parts/T3a.diff:1418`、`:1452`）
- T3-072: OK（`tests/data/S8D-A21-python-config.test.ts:110`）
- T3-073: OK（`tests/data/S8D-A21-python-config.test.ts:157`）
- T3-074: OK（`tests/data/S8D-A21-python-config.test.ts:172`）
- T3-075: OK（`tests/data/S8D-exploration-regressions.test.ts:89`；`.lead-ref/parts/T3a.diff:1484`）
- T3-076: OK（`.lead-ref/parts/T3a.diff:1601`、`:1666`）
- T3-079: OK（`tests/helpers/K3-35-continuation-fixture.ts:928`）
- T3-080: OK（保留导出的依据：`tests/runtime/K3-35-workspace-baseline-prepare.test.ts:16`、`:40`）
- T3-081: OK（`.lead-ref/parts/T3a.diff:1772`、`:2886`）
- T3-082: OK（`.lead-ref/parts/T3a.diff:1758`、`:1788`、`:1805`）
- T3-093: OK（`.lead-ref/parts/T3a.diff:2000`、`:2081`）
- T3-094: OK（`.lead-ref/parts/T3a.diff:2094`、`:2111`）
- T3-098: OK（`.lead-ref/parts/T3a.diff:2127`、`:2145`、`:2154`）
- T3-100: OK（`.lead-ref/parts/T3a.diff:2198`、`:2207`、`:2223`）
- T3-101: T3a-14

**3. partial 和 BLOCKED 核对**

| 条目 | 部分 | DSH 理由、类别是否属实 | 公开步骤是否可达 |
|---|---|---|---|
| T2-025 | observer-down | **属实，missing entry point 正确。** 回复见 `.lead-ref/replies/t-reply-T3.md:118`；真实 Runtime 把 publish 固定为空操作（`src/core/agent-runtime/execution-driver.ts:1253`、`src/core/agent-runtime/query-execution.ts:542`）。原直调子段仍保留于 `tests/runtime/R4c-execution-history.test.ts:413`。 | **不可达。** 真实 claim→start/finish 没有可注入失败 observer sink 的入口；此已申报子段不另列 finding。 |
| T1-070 | 第二个 Goal | **拒绝事实属实，但应归为白名单外必要修改阻断。** 当前测试 Host 只授权 GOAL_B（`tests/helpers/K3-35-runtime.ts:113`），且 options 没有可传入另一授权配置的选项（`:47`）。回复本身也承认该文件在白名单外（`.lead-ref/replies/t-reply-T2.md:77`；规则 `.lead-ref/books/t-book.md:48`）。 | 当前夹具的 Runtime start **不可达**第二 Goal；这是测试 Host 限制，不能据此裁成生产业务普遍 unreachable。 |
| T3-080 | `K3_35_TASK_ID` 保留 export | **属实。** 实际导出在 `tests/helpers/K3-35-continuation-fixture.ts:158`，仍有外部导入及使用（`tests/runtime/K3-35-workspace-baseline-prepare.test.ts:16`、`:40`）。 | 不涉及状态可达性；删除导出会破坏现有消费者。 |

以下子段应补报 BLOCKED，不能继续算作完成：

| 条目 | 部分 | DSH 理由是否属实 | 公开步骤是否可达 |
|---|---|---|---|
| T2-025、T2-032 | 拼接 Kernel 身份 | 未申报，见 T3a-06；当前构造在 `tests/runtime/R4c-execution-history.test.ts:127`。 | 没有公开步骤返回该拼接结果；真实身份成对产生（`src/core/agent-runtime/execution-driver.ts:620`）。 |
| T2-025、T2-031、T2-032 | not_ready 透传 | 未申报，见 T3a-07；当前替身在 `tests/runtime/R4c-execution-history.test.ts:276`。 | **不可达，missing entry point。** 真实 Session 读取没有该水位等待分支（`src/core/work-graph/sessions/session-directory.ts:1178`）。 |
| T2-025、T2-032 | 损坏历史返回页 | 未申报，见 T3a-08；当前靠改写结果制造（`tests/runtime/R4c-execution-history.test.ts:400`）。 | 没有本文件可用的允许入口；A7 损坏注入只授权另外两个文件（`.lead-ref/books/test-rule-sheet-v2.md:50`）。 |
| T2-029 | 未映射 Kernel Session 实际存在及唯一性 | 未申报，见 T3a-10；直接读库在 `tests/runtime/R4b-session-recovery.test.ts:147`。 | **不可达，missing entry point。** `getSessionOperation` 读取 WG operation，不能证明 Kernel 实际数量（`src/core/work-graph/sessions/session-directory.ts:1069`）；`findSessions` 只查 WG Session 映射（`:1527`）。 |
| T3-038 | 内部 observation pointer revision/readThrough | 未申报且标 done（`.lead-ref/replies/t-reply-T3.md:56`），见 T3a-11。 | **不可达，missing entry point。** 公开 observationState 没有这两个内部字段（`src/contracts/architecture-observation.ts:53`）。 |

**4. JSON**

```json
[
  {
    "id": "T3a-01",
    "class": "会出错",
    "file": "tests/app/A2-settings-automation.test.ts",
    "line": 122,
    "item": "T3-004",
    "problem": "零值分支只启动和重开，131行先改成5，140行才调用models/save，丢失原0/false经过另一设置保存后仍保持的覆盖。若models/save用autoReworkLimit || 3将0错误存成3，现测试仍通过。原覆盖见.lead-ref/base/tests/app/A2-settings-automation.test.ts:95。",
    "fix": "在零值分支内、保存5之前执行原models/save，恢复存盘仍为0/false及随后重开的断言。"
  },
  {
    "id": "T3a-02",
    "class": "会出错",
    "file": "tests/work-graph/S8A-L8-observation-state.test.ts",
    "line": 395,
    "item": "T3-019",
    "problem": "helper未await真实读取就通知entered，924行关闭同步abort，真实owner在src/core/work-graph/architecture/architecture-service.ts:1475返回cancelled，未覆盖迟到ready。若驱动在取消后收到ready时错误调用一次capture，此测试仍因收到cancelled而通过；原来源.lead-ref/base/tests/app/S8A-L8-capture-start.test.ts:327先等待真实结果。",
    "fix": "ready分支先await真实读取并确认ready，再通知entered、等待释放，最后原样返回缓存的ready。"
  },
  {
    "id": "T3a-03",
    "class": "违规",
    "file": "tests/work-graph/S8A-L8-observation-state.test.ts",
    "line": 766,
    "item": "T3-018",
    "problem": "无旧观测变体把原精确原因injected start-state throw改成injected observation-state throw。原值见.lead-ref/base/tests/app/S8A-L8-capture-start.test.ts:258、265；条目.lead-ref/books/t-items-T3.md:271未授权改值。",
    "fix": "仅让新增无旧观测变体注入并断言原字符串，保留旧变体及helper默认文案。"
  },
  {
    "id": "T3a-04",
    "class": "违规",
    "file": "tests/scenarios/C8-human-stop-respected.test.ts",
    "line": 458,
    "item": "T3-027",
    "problem": "未迁入reason:null、next.taskId、planRef.revision以及complete_task.input的taskRef/planRef/roundRef精确断言。原断言见.lead-ref/base/tests/business/A2-workflow-auto-rework.test.ts:248、257；462行操作名序列不能替代这些字段。",
    "fix": "用真实场景取得的引用，补回缺失字段和complete_task请求的精确断言。"
  },
  {
    "id": "T3a-05",
    "class": "违规",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 111,
    "item": "T2-025、T2-032",
    "problem": "68行rawRecords打开Kernel Store，111、157行读取后经positionsOf派生位置和数量期望，123、126、177行等据此断言，残留F7/F8。",
    "fix": "使用公开历史读取作实际证据；固定脚本对应的位置和数量期望写成独立手算字面量并注释推导，不从库或程序输出生成。"
  },
  {
    "id": "T3a-06",
    "class": "违规",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 127,
    "item": "T2-025、T2-032",
    "problem": "交叉拼接两次执行的runId/turnId并要求返回ready，不是公开返回的完整身份，也不是A6拒绝输入，违反.lead-ref/books/t-book.md:71。",
    "fix": "将两个拼接身份子例单列BLOCKED，原样保留基线子段，交lead冻结后续处理，不计为完成转换。"
  },
  {
    "id": "T3a-07",
    "class": "违规",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 276,
    "item": "T2-025、T2-031、T2-032",
    "problem": "替身仍手造not_ready结果和owner-watermark游标，残留F4且漏报BLOCKED；真实路径没有相应水位等待入口，见src/core/agent-runtime/session-operations.ts:753、767及src/core/work-graph/sessions/session-directory.ts:1178。",
    "fix": "保留原子段，单列BLOCKED/missing entry point，从已转换范围扣除，不另造水位或返回值替身。"
  },
  {
    "id": "T3a-08",
    "class": "违规",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 400,
    "item": "T2-025、T2-032",
    "problem": "损坏历史子段spread后改写真实返回页的正文、位置和身份，属于F2，不满足A3；本文件也不在.lead-ref/books/test-rule-sheet-v2.md:50的A7损坏注入范围内。",
    "fix": "保留基线子段并单列BLOCKED，停止计作完成转换，由lead裁定允许的替代入口，不增加同类改写helper。"
  },
  {
    "id": "T3a-09",
    "class": "违规",
    "file": "tests/runtime/R4c-execution-history.test.ts",
    "line": 199,
    "item": "T2-025、T2-030、T2-032",
    "problem": "199行起的错误游标等拒绝例、267行跨工作区例及tests/runtime/R4b-session-recovery.test.ts:224跨Session例，缺少rejects块和公开读取验证前后不变，未落实.lead-ref/books/t-items-T3.md:90、117要求的A6。",
    "fix": "按单一错误整理到describe('rejects: …')块，保留拒绝断言，并用真实公开历史读取核对调用前后不变。"
  },
  {
    "id": "T3a-10",
    "class": "违规",
    "file": "tests/runtime/R4b-session-recovery.test.ts",
    "line": 100,
    "item": "T2-029",
    "problem": "100、125、147、172行仍通过withStore/store.list断言Kernel Session存在及唯一性，残留F7。公开readSession/findSessions只看到WG映射，不能证明未映射Kernel实际存在和总数，见src/core/work-graph/sessions/session-directory.ts:1192、1527。",
    "fix": "这些断言子段登记BLOCKED/missing entry point，保留原断言等待lead冻结替代，不降格成findSessions只有一项。"
  },
  {
    "id": "T3a-11",
    "class": "违规",
    "file": "tests/composition/R3d-R3g-platform.test.ts",
    "line": 211,
    "item": "T3-038",
    "problem": "尾段仍打开数据库检查pointer revision、readThrough、observedRef和active记录，残留F7却标done。公开observationState没有前两字段，见src/contracts/architecture-observation.ts:53。",
    "fix": "该尾段单列BLOCKED/missing entry point，保留原断言，由lead冻结等价公开验证，不删除或放松断言。"
  },
  {
    "id": "T3a-12",
    "class": "违规",
    "file": "tests/composition/R3d-R3g-platform.test.ts",
    "line": 126,
    "item": "T3-038",
    "problem": "54行生产函数计算digest，126行用该结果作期望，132、165行又复制返回pin的digest，违反F8和.lead-ref/books/t-book.md:83。",
    "fix": "为固定角色内容给出独立推导的digest字面量和计算说明用于期望，返回pin只用于后续公开调用的引用传递。"
  },
  {
    "id": "T3a-13",
    "class": "违规",
    "file": "tests/composition/A1-graph-session-platform.test.ts",
    "line": 99,
    "item": "T3-035",
    "problem": "99、156、202行以完整adopted.value作为期望，残留F8。若采用步骤将85行起输入的description写错且返回同一错误内容，后续读取断言仍通过。",
    "fix": "依据固定采用输入独立列出baseline/catalog完整预期，三处不再复制adopted.value。"
  },
  {
    "id": "T3a-14",
    "class": "不整洁",
    "file": "tests/helpers/WP2-duties-fixture.ts",
    "line": 1,
    "item": "T3-101",
    "problem": "文件头仍描述创建真实角色、Session、entered Work和coordination matrix；删除夹具后实际仅保留12、15、22行的职责列表、映射和角色内容函数。",
    "fix": "将文件头改为描述当前保留的三项职责，删除已不存在的流程说明。"
  }
]
```

会出错 2，违规 11，不整洁 1，建议 0