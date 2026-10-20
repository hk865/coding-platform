清单标题写 64 条，但正文实际只有 T2-001～T2-063；以下按实际 63 条统计（`.lead-ref/books/t-items-T2.md:1`、`.lead-ref/books/t-items-T2.md:485`）。OK 均包含已采纳的“书面核对改正”。

| 编号 | 状态 | 现在的位置 | 说明（CHANGED 写新的动作） |
|---|---|---|---|
| T2-001 | OK | `tests/contracts/review-admission.test.ts:169` | 重复例仍在，按原动作删除。 |
| T2-002 | OK | `tests/contracts/review-admission.test.ts:79`；`tests/runtime/K3-19-review-admission-pure.test.ts:57` | 三项独有输入仍需迁入；与 001、022 一起处理。 |
| T2-003 | OK | `tests/helpers/S2C-K-scenario-support.ts:33`、`:127`、`:172` | 三个无消费者声明仍在。 |
| T2-004 | OK | `tests/helpers/S4B-text-search-support.ts:24`、`:94`、`:104`、`:183` | 按改正保留 change 导出。 |
| T2-005 | OK | `tests/kernel/R4a-frozen-public.test.ts:423`、`:627` | 两个旧格式例仍在；历史 README 按改正追加后注。 |
| T2-006 | OK | `tests/kernel/R4a-frozen-public.test.ts:396`、`:192` | 重复预算拒绝例仍可删除。 |
| T2-007 | OK | `tests/kernel/R4a-frozen-public.test.ts:152`、`:213`、`:382`、`:406` | 仍须先迁中间 Turn 和独有断言，再删重复组。 |
| T2-008 | OK | `tests/kernel/R4a-frozen-public.test.ts:596` | 篡改 checkpoint 的例仍在。 |
| T2-009 | OK | `tests/kernel/R4a-legacy-fixtures.ts:18`、`:31`、`:54` | 保留临时目录工具；等前置删除、转换完成后删 writer。 |
| T2-010 | OK | `tests/record-store/R3a-transaction-boundaries.test.ts:103`、`:123` | 原地篡改 scope 的例仍在。 |
| T2-011 | OK | `tests/record-store/R3a-transaction-boundaries.test.ts:17`；`src/core/work-graph/configuration/project-bootstrap-service.ts:1125` | 原公开注册转换仍可执行。 |
| T2-012 | OK | `tests/record-store/S2A-ordered-lookup.test.ts:47`；`tests/helpers/S4B-text-search-support.ts:69`、`:139` | 仍需补 lookup 类型、返回 dir，并保留本地特殊注册与分页。 |
| T2-013 | OK | `tests/record-store/S2C-count-lookup.test.ts:53`；`tests/helpers/S4B-text-search-support.ts:69` | 仍需补 countLookup 类型，与 012 同改。 |
| T2-014 | OK | `tests/record-store/S4B-text-search.test.ts:361`、`:380` | 重复双后端比较例仍在。 |
| T2-015 | OK | `tests/record-store/S4B-text-search.test.ts:675`、`:692`、`:709` | 三例仍可合为一例，保留全部断言。 |
| T2-016 | OK | `tests/record-store/SP-literal-type.test.ts:28`；`tests/record-store/SP-lookup-index-migration.test.ts:31` | 两份重复实现仍在；目标 helper 本来就是待新建，不算 GONE。 |
| T2-017 | OK | `tests/record-store/lookup.test.ts:174`、`:194` | 保留重开索引段，只删篡改段。 |
| T2-018 | OK | `tests/runtime/B2-04-allowance.test.ts:72`；`tests/runtime/B2-09-allowance-crash.test.ts:41` | 覆盖关系仍成立。 |
| T2-019 | OK | `tests/runtime/B2-09-allowance-crash.test.ts:65`；`tests/runtime/B2-04-allowance.test.ts:41` | 四条独有断言仍需先迁入。 |
| T2-020 | OK | `tests/runtime/C1-communication-tools.test.ts:115`、`:187`；`tests/runtime/C2-runtime-platform-tools.test.ts:70` | 名称和效果分类的重复例仍在。 |
| T2-021 | OK | `tests/runtime/K3-12-review-round-tools.test.ts:129`；`tests/runtime/K3-review-preparation.test.ts:168` | 原合并仍成立，保留后半段写入尝试测试。 |
| T2-022 | OK | `tests/runtime/K3-19-review-admission-pure.test.ts:57`；`tests/contracts/review-admission.test.ts:79` | 与 002 同一合并，不能漏三项独有输入。 |
| T2-023 | OK | `tests/runtime/K3-continuation-review-note.test.ts:160`、`:321`；`tests/runtime/K3-15-blocked-sentence-pure.test.ts:17` | 摘要字面值和 null 等价断言仍需一起迁。 |
| T2-024 | OK | `tests/runtime/R4b-session-input-boundaries.test.ts:45`；`tests/helpers/S4A-note-fixture.ts:178` | 手写 scope 仍在；公开注册示例仍适用。 |
| T2-025 | CHANGED | `tests/runtime/R4b-session-input-boundaries.test.ts:119`；`tests/runtime/R4c-execution-history.test.ts:93`；`.lead-ref/books/t-w1r1-findings.md:18` | 已命名的共享 helper 改封装 R7 的真实 Session、claim、start/finish；不再迁入接收自造 Kernel identity 的 runTurn。公开读历史取得游标，拒绝例按 A6 保留。 |
| T2-026 | OK | `tests/runtime/R4b-session-operations.test.ts:144` | 损坏 session.created 的例仍需删除。 |
| T2-027 | OK | `tests/runtime/R4b-session-operations.test.ts:50`；`src/core/work-graph/configuration/project-bootstrap-service.ts:1125` | 公开注册转换仍成立。 |
| T2-028 | OK | `tests/runtime/R4b-session-recovery.test.ts:204`；`tests/runtime/R4c-execution-history.test.ts:330` | 删除改库例，真实文件缺失覆盖仍在。 |
| T2-029 | OK | `tests/runtime/R4b-session-recovery.test.ts:51`；`src/core/work-graph/configuration/project-bootstrap-service.ts:1125` | 独立 bootstrap 工厂转换仍成立。 |
| T2-030 | CHANGED | `tests/runtime/R4b-session-recovery.test.ts:184`、`:192`；`src/core/agent-runtime/execution-driver.ts:620`；`.lead-ref/books/t-w1r1-findings.md:18` | 同一 Session 真实执行两次；两次 Kernel 身份均从 readExecution 取得。保留首张 limit:2 页，第二次后沿旧游标读完，验证非空且仅属第一次；取消固定身份及数字 6，跨 Session 拒绝按 A6 保留。 |
| T2-031 | OK | `tests/runtime/R4c-execution-history.test.ts:322` | 改库段仍在，保留相邻其他拒绝透传。 |
| T2-032 | OK | `tests/runtime/R4c-execution-history.test.ts:52` | 手写 scope 仍未转换。 |
| T2-033 | OK | `tests/runtime/R4c-kernel-history-range.test.ts:420`、`:452`、`:594` | 原删除范围仍适用，保留正常范围读取和隔离断言。 |
| T2-034 | OK | `tests/runtime/S3-context-assembler.test.ts:385`、`:647`、`:662`、`:855` | harness 及直接绑定仍在；按书面改正整体转换。 |
| T2-035 | OK | `tests/runtime/S3-graph-tools.test.ts:866`；`src/core/work-graph/architecture/catalog-service.ts:450` | 公开初始化链仍可用；保留 revision 1 和 schemas 改正。 |
| T2-036 | CHANGED | `tests/runtime/S3-graph-tools.test.ts:967`、`:1001`；`src/core/work-graph/tasks/context-input-service.ts:372`；`.lead-ref/books/test-rule-sheet-v2.md:32` | 保留原公开 claim、存正文转换；另外从真实 readTaskInputs 结果取得两项 declarationId，替换硬编码 legacy:r1/r2，并让四个 GT 调用使用真实 Run B 上下文。 |
| T2-037 | CHANGED | `tests/runtime/S4C-note-run-task-resolver.test.ts:54`、`:64`；`src/core/work-graph/tasks/plan-readers.ts:1444`、`:1453`；`.lead-ref/books/t-w1-findings.md:27` | GTN20 按原公开转换；GTN21 改用同一真实后端，在 rejects 中保留非 work、缺失 Run 两项拒绝并公开核对未变；删手造损坏记录子例及假端口，不再原样保留 GTN21。 |
| T2-038 | OK | `tests/runtime/S4C-note-tools.test.ts:123`、`:265`；`.lead-ref/books/test-rule-sheet-v2.md:45` | A7 前置条件已满足，可按改正合并严格形状和默认值。 |
| T2-039 | OK | `tests/scenarios/C6-unrelated-adoption.test.ts:54`、`:163` | 重复变体仍在。 |
| T2-040 | OK | `tests/scenarios/K3-05-review-round.test.ts:45`；`.lead-ref/books/test-rule-sheet-v2.md:59` | executeChecks:false 的 A7 前置条件已满足；按冻结存活清单迁移。 |
| T2-041 | OK | `tests/scenarios/K3-06-mixed-batch.test.ts:174`；`tests/scenarios/K3-05-review-round.test.ts:86` | 按改正补齐 purpose、数量和 rounds 后合并。 |
| T2-042 | OK | `tests/scenarios/K3-09-restart-between-calls.test.ts:108`；`tests/scenarios/support/review-card-round.ts:58` | 仍需扩充共享返回值、身份参数和释放责任。 |
| T2-043 | OK | `tests/scenarios/K3-13-two-commands.test.ts:107`；`tests/scenarios/K3-05-review-round.test.ts:86` | 独有断言迁完后删除整份源文件。 |
| T2-044 | OK | `tests/scenarios/K3-16-proposal-round.test.ts:125`；`tests/scenarios/K3-16-approval-round.test.ts:122`；`tests/scenarios/K3-29-startup-variants.test.ts:207` | 按改正拆开 prepare/start，保留中间检查。 |
| T2-045 | OK | `tests/scenarios/K3-19-missing-read-no-round.test.ts:181`；`tests/scenarios/K3-19-review-unavailable.test.ts:125` | 原覆盖关系仍成立，可删除源文件。 |
| T2-046 | OK | `tests/scenarios/K3-29-disposition-recovery.test.ts:109`、`:143` | 共享抽取仍需做；保留 host 身份和延后 release。 |
| T2-047 | OK | `tests/scenarios/K3-R1-file-change.test.ts:144`、`:186`、`:226` | 注入例仍在，按改正先迁断言再删。 |
| T2-048 | OK | `tests/scenarios/K3-r1-seams.test.ts:137`、`:162`；`tests/scenarios/K3-R1-restart-flows.test.ts:90`、`:97` | 两段待删代码及真实锁点覆盖仍在。 |
| T2-049 | OK | `tests/scenarios/S2C-K-unknown-outcome.test.ts:105`、`:174`；`tests/scenarios/S2C-K-retired.test.ts:243` | 仍可合并；目标名称保留三个规格编号。 |
| T2-050 | CHANGED | `tests/scenarios/S2C-K-unknown-outcome.test.ts:38`；`tests/scenarios/S2C-K-retired.test.ts:193`；`.lead-ref/books/test-rule-sheet-v2.md:50` | 只抽共享崩溃流程，并接收调用方故障回调；两份 damageKernel 留在原测试文件，不能把 SQL 注入迁入未获 A7 授权的 helper。 |
| T2-051 | OK | `tests/scenarios/S3-query-graph.test.ts:205`、`:317`、`:392`、`:441` | SQL Run 种子仍在；原转换及独立 tA 回复安排仍适用。 |
| T2-052 | OK | `tests/scenarios/S3-context-and-inputs.test.ts:269`、`:317`；`tests/scenarios/S3-query-graph.test.ts:294` | SC01 已有真实 tA 路径；承接它和 051 后再抽共享初始化。 |
| T2-053 | OK | `tests/scenarios/harness.test.ts:191`；`tests/scenarios/A11-no-progress.test.ts:398`；`tests/app/A2-automation-verdict.test.ts:119` | 按改正后的 cap0/cap1 覆盖说明删除。 |
| T2-054 | OK | `tests/scenarios/harness.ts:627` | 无调用的方法仍在。 |
| T2-055 | OK | `tests/scenarios/harness.ts:1284` | 无调用的方法仍在。 |
| T2-056 | OK | `tests/state/S1-anomaly.test.ts:106`、`:132` | UT21 仍是 UT19 的重复输入；合并名称保留编号。 |
| T2-057 | DONE | `tests/state/S1-session-archive.test.ts:166`、`:185` | UT08 后已直接接 UT49，UT09/UT10 已删除。 |
| T2-058 | DONE | `tests/state/S1-session-archive.test.ts:31` | 常量区已无 S_PLAIN，相关 SessionRef 导入也已去掉。 |
| T2-059 | OK | `tests/state/S2C-line-status.test.ts:148` | 旧 null conclusion 例仍在。 |
| T2-060 | OK | `tests/state/command-rerun-request-pure.test.ts:102`；`tests/state/command-rerun-request.test.ts:164` | 重复拒绝例仍可合并。 |
| T2-061 | OK | `tests/state/command-rerun-request-pure.test.ts:91`；`tests/state/K3-B3-shared-rules-pure.test.ts:89` | 仍需迁入 guard_failed，保留构造器上限例。 |
| T2-062 | OK | `tests/state/control-intent-machine.test.ts:602`、`:853`、`:859` | 三段仍在，按书面改正保留外层结束括号。 |
| T2-063 | OK | `tests/state/k3-review-claim.test.ts:79`、`:92`、`:100` | 重复空输入例仍在；真正 ordinary busy 例保留。 |

```json
[
  {"id":"T2-001","status":"OK","where":"tests/contracts/review-admission.test.ts:169","note":"重复例仍在，原动作适用。"},
  {"id":"T2-002","status":"OK","where":"tests/contracts/review-admission.test.ts:79; tests/runtime/K3-19-review-admission-pure.test.ts:57","note":"三项独有输入仍需迁入，与001、022同做。"},
  {"id":"T2-003","status":"OK","where":"tests/helpers/S2C-K-scenario-support.ts:33; tests/helpers/S2C-K-scenario-support.ts:127; tests/helpers/S2C-K-scenario-support.ts:172","note":"三个无消费者声明仍在。"},
  {"id":"T2-004","status":"OK","where":"tests/helpers/S4B-text-search-support.ts:24; tests/helpers/S4B-text-search-support.ts:104","note":"按书面改正保留change导出。"},
  {"id":"T2-005","status":"OK","where":"tests/kernel/R4a-frozen-public.test.ts:423; tests/kernel/R4a-frozen-public.test.ts:627","note":"两个旧格式例仍在。"},
  {"id":"T2-006","status":"OK","where":"tests/kernel/R4a-frozen-public.test.ts:396; tests/kernel/R4a-frozen-public.test.ts:192","note":"重复预算拒绝例仍可删除。"},
  {"id":"T2-007","status":"OK","where":"tests/kernel/R4a-frozen-public.test.ts:152; tests/kernel/R4a-frozen-public.test.ts:213; tests/kernel/R4a-frozen-public.test.ts:382","note":"先迁中间Turn和独有断言，再删重复组。"},
  {"id":"T2-008","status":"OK","where":"tests/kernel/R4a-frozen-public.test.ts:596","note":"篡改checkpoint例仍在。"},
  {"id":"T2-009","status":"OK","where":"tests/kernel/R4a-legacy-fixtures.ts:18; tests/kernel/R4a-legacy-fixtures.ts:31; tests/kernel/R4a-legacy-fixtures.ts:54","note":"保留临时目录工具，前置完成后删writer。"},
  {"id":"T2-010","status":"OK","where":"tests/record-store/R3a-transaction-boundaries.test.ts:123","note":"原地篡改scope仍在。"},
  {"id":"T2-011","status":"OK","where":"tests/record-store/R3a-transaction-boundaries.test.ts:17; src/core/work-graph/configuration/project-bootstrap-service.ts:1125","note":"公开注册转换仍可执行。"},
  {"id":"T2-012","status":"OK","where":"tests/record-store/S2A-ordered-lookup.test.ts:47; tests/helpers/S4B-text-search-support.ts:69; tests/helpers/S4B-text-search-support.ts:139","note":"仍需补lookup类型和dir，保留本地特殊注册与分页。"},
  {"id":"T2-013","status":"OK","where":"tests/record-store/S2C-count-lookup.test.ts:53; tests/helpers/S4B-text-search-support.ts:69","note":"仍需补countLookup类型，与012同改。"},
  {"id":"T2-014","status":"OK","where":"tests/record-store/S4B-text-search.test.ts:361; tests/record-store/S4B-text-search.test.ts:380","note":"重复双后端比较例仍在。"},
  {"id":"T2-015","status":"OK","where":"tests/record-store/S4B-text-search.test.ts:675; tests/record-store/S4B-text-search.test.ts:692; tests/record-store/S4B-text-search.test.ts:709","note":"三个重复准备仍可合并。"},
  {"id":"T2-016","status":"OK","where":"tests/record-store/SP-literal-type.test.ts:28; tests/record-store/SP-lookup-index-migration.test.ts:31","note":"重复实现仍在，目标helper原本就是待新建。"},
  {"id":"T2-017","status":"OK","where":"tests/record-store/lookup.test.ts:174; tests/record-store/lookup.test.ts:194","note":"保留索引重开段，只删篡改段。"},
  {"id":"T2-018","status":"OK","where":"tests/runtime/B2-04-allowance.test.ts:72; tests/runtime/B2-09-allowance-crash.test.ts:41","note":"覆盖关系仍成立。"},
  {"id":"T2-019","status":"OK","where":"tests/runtime/B2-09-allowance-crash.test.ts:65; tests/runtime/B2-04-allowance.test.ts:41","note":"四条独有断言仍需先迁入。"},
  {"id":"T2-020","status":"OK","where":"tests/runtime/C1-communication-tools.test.ts:115; tests/runtime/C1-communication-tools.test.ts:187; tests/runtime/C2-runtime-platform-tools.test.ts:70","note":"重复名称和效果分类例仍在。"},
  {"id":"T2-021","status":"OK","where":"tests/runtime/K3-12-review-round-tools.test.ts:129; tests/runtime/K3-review-preparation.test.ts:168","note":"原合并仍成立，保留后半段测试。"},
  {"id":"T2-022","status":"OK","where":"tests/runtime/K3-19-review-admission-pure.test.ts:57; tests/contracts/review-admission.test.ts:79","note":"与002同一合并，保留三项独有输入。"},
  {"id":"T2-023","status":"OK","where":"tests/runtime/K3-continuation-review-note.test.ts:160; tests/runtime/K3-continuation-review-note.test.ts:321; tests/runtime/K3-15-blocked-sentence-pure.test.ts:17","note":"摘要字面值和null等价断言仍需一起迁。"},
  {"id":"T2-024","status":"OK","where":"tests/runtime/R4b-session-input-boundaries.test.ts:45; tests/helpers/S4A-note-fixture.ts:178","note":"手写scope仍在，公开注册示例适用。"},
  {"id":"T2-025","status":"CHANGED","where":"tests/runtime/R4b-session-input-boundaries.test.ts:119; tests/runtime/R4c-execution-history.test.ts:93; .lead-ref/books/t-w1r1-findings.md:18; tests/helpers/S2B-runtime-steps-fixture.ts:319","note":"原拟抽取的runTurn接受测试自造Kernel身份，不符合R-8。","action":"已命名的共享helper改封装R7的真实Session、claim、start/finish；不迁入接收自造identity的runTurn。公开读历史取得游标，拒绝例按A6保留。"},
  {"id":"T2-026","status":"OK","where":"tests/runtime/R4b-session-operations.test.ts:144","note":"损坏session.created例仍需删除。"},
  {"id":"T2-027","status":"OK","where":"tests/runtime/R4b-session-operations.test.ts:50; src/core/work-graph/configuration/project-bootstrap-service.ts:1125","note":"公开注册转换仍成立。"},
  {"id":"T2-028","status":"OK","where":"tests/runtime/R4b-session-recovery.test.ts:204; tests/runtime/R4c-execution-history.test.ts:330","note":"改库例仍在，真实文件缺失覆盖仍在。"},
  {"id":"T2-029","status":"OK","where":"tests/runtime/R4b-session-recovery.test.ts:51; src/core/work-graph/configuration/project-bootstrap-service.ts:1125","note":"独立bootstrap工厂转换仍成立。"},
  {"id":"T2-030","status":"CHANGED","where":"tests/runtime/R4b-session-recovery.test.ts:184; tests/runtime/R4b-session-recovery.test.ts:192; src/core/agent-runtime/execution-driver.ts:620; .lead-ref/books/t-w1r1-findings.md:18","note":"固定runId/turnId的书面改正须服从R-8。","action":"同一Session真实执行两次，两次Kernel身份从readExecution取得。保留首张limit:2页，第二次后沿旧游标读完并验证非空且仅属第一次；取消固定身份和数字6，跨Session拒绝按A6保留。"},
  {"id":"T2-031","status":"OK","where":"tests/runtime/R4c-execution-history.test.ts:322","note":"改库段仍在，保留相邻拒绝透传。"},
  {"id":"T2-032","status":"OK","where":"tests/runtime/R4c-execution-history.test.ts:52","note":"手写scope仍未转换。"},
  {"id":"T2-033","status":"OK","where":"tests/runtime/R4c-kernel-history-range.test.ts:420; tests/runtime/R4c-kernel-history-range.test.ts:452; tests/runtime/R4c-kernel-history-range.test.ts:594","note":"原删除范围仍适用。"},
  {"id":"T2-034","status":"OK","where":"tests/runtime/S3-context-assembler.test.ts:385; tests/runtime/S3-context-assembler.test.ts:647; tests/runtime/S3-context-assembler.test.ts:662; tests/runtime/S3-context-assembler.test.ts:855","note":"按书面改正整体转换harness和直接绑定。"},
  {"id":"T2-035","status":"OK","where":"tests/runtime/S3-graph-tools.test.ts:866; src/core/work-graph/architecture/catalog-service.ts:450","note":"公开初始化链仍可用，保留revision1和schemas改正。"},
  {"id":"T2-036","status":"CHANGED","where":"tests/runtime/S3-graph-tools.test.ts:967; tests/runtime/S3-graph-tools.test.ts:1001; src/core/work-graph/tasks/context-input-service.ts:372; .lead-ref/books/test-rule-sheet-v2.md:32","note":"仍硬编码平台派生的declarationId。","action":"保留原公开claim和存正文转换；从真实readTaskInputs结果取得两项declarationId，替换legacy:r1/r2硬编码，并让四个GT调用使用真实Run B上下文。"},
  {"id":"T2-037","status":"CHANGED","where":"tests/runtime/S4C-note-run-task-resolver.test.ts:54; tests/runtime/S4C-note-run-task-resolver.test.ts:64; src/core/work-graph/tasks/plan-readers.ts:1444; src/core/work-graph/tasks/plan-readers.ts:1453; .lead-ref/books/t-w1-findings.md:27","note":"原样保留GTN21会留下手造记录和假端口。","action":"GTN20按原公开转换；GTN21用同一真实后端，在rejects中保留非work及缺失Run拒绝并公开核对未变；删除手造损坏记录子例及假端口。"},
  {"id":"T2-038","status":"OK","where":"tests/runtime/S4C-note-tools.test.ts:123; tests/runtime/S4C-note-tools.test.ts:265; .lead-ref/books/test-rule-sheet-v2.md:45","note":"A7前置条件已满足，按改正合并。"},
  {"id":"T2-039","status":"OK","where":"tests/scenarios/C6-unrelated-adoption.test.ts:54; tests/scenarios/C6-unrelated-adoption.test.ts:163","note":"重复变体仍在。"},
  {"id":"T2-040","status":"OK","where":"tests/scenarios/K3-05-review-round.test.ts:45; .lead-ref/books/test-rule-sheet-v2.md:59","note":"executeChecks:false的A7前置条件已满足。"},
  {"id":"T2-041","status":"OK","where":"tests/scenarios/K3-06-mixed-batch.test.ts:174; tests/scenarios/K3-05-review-round.test.ts:86","note":"按改正补齐purpose、数量及rounds再合并。"},
  {"id":"T2-042","status":"OK","where":"tests/scenarios/K3-09-restart-between-calls.test.ts:108; tests/scenarios/support/review-card-round.ts:58","note":"仍需扩充共享返回值、身份参数和释放责任。"},
  {"id":"T2-043","status":"OK","where":"tests/scenarios/K3-13-two-commands.test.ts:107; tests/scenarios/K3-05-review-round.test.ts:86","note":"独有断言迁完后删除整份源文件。"},
  {"id":"T2-044","status":"OK","where":"tests/scenarios/K3-16-proposal-round.test.ts:125; tests/scenarios/K3-16-approval-round.test.ts:122; tests/scenarios/K3-29-startup-variants.test.ts:207","note":"按改正拆开prepare/start并保留中间检查。"},
  {"id":"T2-045","status":"OK","where":"tests/scenarios/K3-19-missing-read-no-round.test.ts:181; tests/scenarios/K3-19-review-unavailable.test.ts:125","note":"覆盖关系仍成立。"},
  {"id":"T2-046","status":"OK","where":"tests/scenarios/K3-29-disposition-recovery.test.ts:109; tests/scenarios/K3-29-disposition-recovery.test.ts:143","note":"仍需共享抽取，保留host身份和延后release。"},
  {"id":"T2-047","status":"OK","where":"tests/scenarios/K3-R1-file-change.test.ts:144; tests/scenarios/K3-R1-file-change.test.ts:186; tests/scenarios/K3-R1-file-change.test.ts:226","note":"注入例仍在，先迁断言再删。"},
  {"id":"T2-048","status":"OK","where":"tests/scenarios/K3-r1-seams.test.ts:137; tests/scenarios/K3-r1-seams.test.ts:162; tests/scenarios/K3-R1-restart-flows.test.ts:90; tests/scenarios/K3-R1-restart-flows.test.ts:97","note":"待删段及真实锁点覆盖仍在。"},
  {"id":"T2-049","status":"OK","where":"tests/scenarios/S2C-K-unknown-outcome.test.ts:105; tests/scenarios/S2C-K-unknown-outcome.test.ts:174; tests/scenarios/S2C-K-retired.test.ts:243","note":"仍可合并，目标名称保留三个规格编号。"},
  {"id":"T2-050","status":"CHANGED","where":"tests/scenarios/S2C-K-unknown-outcome.test.ts:38; tests/scenarios/S2C-K-retired.test.ts:193; .lead-ref/books/test-rule-sheet-v2.md:50","note":"A7将damageKernel限定在两份测试文件。","action":"只抽共享崩溃流程并接收调用方故障回调；两份damageKernel留在原测试文件，不将SQL注入迁入未获A7授权的helper。"},
  {"id":"T2-051","status":"OK","where":"tests/scenarios/S3-query-graph.test.ts:205; tests/scenarios/S3-query-graph.test.ts:317; tests/scenarios/S3-query-graph.test.ts:392; tests/scenarios/S3-query-graph.test.ts:441","note":"SQL Run种子仍在，原转换及独立tA回复安排适用。"},
  {"id":"T2-052","status":"OK","where":"tests/scenarios/S3-context-and-inputs.test.ts:269; tests/scenarios/S3-context-and-inputs.test.ts:317; tests/scenarios/S3-query-graph.test.ts:294","note":"承接SC01真实tA路径和051后抽共享初始化。"},
  {"id":"T2-053","status":"OK","where":"tests/scenarios/harness.test.ts:191; tests/scenarios/A11-no-progress.test.ts:398; tests/app/A2-automation-verdict.test.ts:119","note":"按改正后的cap0/cap1覆盖说明删除。"},
  {"id":"T2-054","status":"OK","where":"tests/scenarios/harness.ts:627","note":"无调用方法仍在。"},
  {"id":"T2-055","status":"OK","where":"tests/scenarios/harness.ts:1284","note":"无调用方法仍在。"},
  {"id":"T2-056","status":"OK","where":"tests/state/S1-anomaly.test.ts:106; tests/state/S1-anomaly.test.ts:132","note":"重复输入仍在，合并名称保留编号。"},
  {"id":"T2-057","status":"DONE","where":"tests/state/S1-session-archive.test.ts:166; tests/state/S1-session-archive.test.ts:185","note":"UT08后直接接UT49，UT09和UT10已删除。"},
  {"id":"T2-058","status":"DONE","where":"tests/state/S1-session-archive.test.ts:12; tests/state/S1-session-archive.test.ts:31","note":"S_PLAIN及相关SessionRef导入已删除。"},
  {"id":"T2-059","status":"OK","where":"tests/state/S2C-line-status.test.ts:148","note":"旧null conclusion例仍在。"},
  {"id":"T2-060","status":"OK","where":"tests/state/command-rerun-request-pure.test.ts:102; tests/state/command-rerun-request.test.ts:164","note":"重复拒绝例仍可合并。"},
  {"id":"T2-061","status":"OK","where":"tests/state/command-rerun-request-pure.test.ts:91; tests/state/K3-B3-shared-rules-pure.test.ts:89","note":"迁入guard_failed，保留构造器上限例。"},
  {"id":"T2-062","status":"OK","where":"tests/state/control-intent-machine.test.ts:602; tests/state/control-intent-machine.test.ts:853; tests/state/control-intent-machine.test.ts:859","note":"三段仍在，按改正保留外层结束括号。"},
  {"id":"T2-063","status":"OK","where":"tests/state/k3-review-claim.test.ts:79; tests/state/k3-review-claim.test.ts:92; tests/state/k3-review-claim.test.ts:100","note":"重复空输入例仍在，保留真正ordinary busy例。"}
]
```

OK 56，DONE 2，GONE 0，CHANGED 5，BLOCK 0，条目 63/63