按“书面核对改正”后的动作判定。清单实际有 **105 项**：T3-008 后直接是 T3-010，未列 T3-009（`.lead-ref/books/t-items-T3.md:58`、`.lead-ref/books/t-items-T3.md:66`）。

| 编号 | 状态 | 现在的位置 | 说明（CHANGED 写新的动作） |
|---|---|---|---|
| T3-001 | OK | `tests/app/A2-host-instance-lease.test.ts:65`、`:113` | 两处手写锁仍在；按原动作取得真实租约。 |
| T3-002 | OK | `tests/app/A2-runtime-capabilities.test.ts:244`、`:262`；`src/app/host-settings.ts:831` | 仍需改为启动、公开保存设置、关闭、重开。 |
| T3-003 | OK | `tests/app/A2-runtime-capabilities.test.ts:60`；`tests/app/K-R-runtime-capabilities.test.ts:39` | 按书面改正抽共享夹具，保留两边配置差异。 |
| T3-004 | OK | `tests/app/A2-settings-automation.test.ts:95`、`:125` | 合并时仍须带入零值、false 的重开读取断言。 |
| T3-005 | DONE | `tests/app/AG2b-collaboration.test.ts:167`、`:169`、`:390`、`:487` | 四处均已使用显式通信字段。 |
| T3-006 | OK | `tests/app/R6-workbench.test.ts:314`、`:358`；`tests/app/session-rendering.test.ts:407` | 原合并成立；来源历史块现至369行，独有断言仍须搬入。 |
| T3-007 | OK | `tests/app/RL-34-wiring-resource-caps.test.ts:101`、`:177` | 合并到两次调用读取新旧值的用例。 |
| T3-008 | OK | `tests/app/RL-34-wiring-resource-caps.test.ts:155`；`tests/app/RL-44-host-restart-resource-caps.test.ts:132` | 按书面改正，目标名称保留 RL-34、RL-44。 |
| T3-010 | OK | `tests/app/S2B-35-activity-routes.test.ts:196`；`src/app/host-instance-lease.ts:113` | 手写锁仍需换真实租约。 |
| T3-011 | OK | `tests/app/S2B-41-decision54-backfill-bound.test.ts:214`、`:226`；`src/core/agent-runtime/runtime.ts:266`、`:303` | 仍按原动作先真实 requeue 授权，再由 Runtime 关闭并更新健康。 |
| T3-012 | OK | `tests/app/S2B-41-decision54-backfill-bound.test.ts:104`、`:113`；`tests/helpers/S2B-be2-reconcile-support.ts:71`、`:83` | 两份重复函数仍可合并。 |
| T3-013 | OK | `tests/app/S2B-backfill-host.test.ts:139`；`src/app/host-instance-lease.ts:113` | 手写锁仍需换真实租约。 |
| T3-014 | OK | `tests/app/S4C2-scribe-reminders.test.ts:719`、`:471` | 原删除及 D-03 覆盖关系成立。 |
| T3-015 | DONE | `tests/app/S5-decision-routes.test.ts:271` | RT07 已使用显式通信字段。 |
| T3-016 | OK | `tests/app/S8A-L8-auto-capture-gate.test.ts:502`；`tests/app/S8A-L8-host-close-restart.test.ts:103` | 按原动作合并并清理专用参数。 |
| T3-017 | OK | `tests/app/S8A-L8-http-watermark.test.ts:60`；`tests/app/S8A-L8-auto-capture-host.test.ts:168` | 删除 watermark 正例，保留手动抓取规格行。 |
| T3-018 | OK | `tests/app/S8A-L8-capture-start.test.ts:215`、`:255`；`tests/work-graph/S8A-L8-observation-state.test.ts:671`、`:695` | 书面改正仍必要：加入无旧观测变体和精确原因。 |
| T3-019 | OK | `tests/app/S8A-L8-capture-start.test.ts:310`；`tests/work-graph/S8A-L8-observation-state.test.ts:717`、`:745`、`:771` | 保留书面改正要求的三种无旧观测变体及计数。 |
| T3-020 | OK | `tests/app/S8A-L8-capture-start.test.ts:114`、`:150` | 原删除范围成立。 |
| T3-021 | OK | `tests/app/host-settings.test.ts:833`；`src/app/host.ts:979`、`:993` | 真实保存 Answer、解析 setup.checks 的路径仍在。 |
| T3-022 | GONE | `tests/app/orchestration-mechanism.test.ts:169`、`:181`；`src/contracts/core/session-message.ts:38` | 旧兼容行已消失；现在181行是通知用例，不得按旧行号删除。 |
| T3-023 | OK | `tests/app/orchestration-mechanism.test.ts:28`；`tests/app/S3-attention-context.test.ts:238` | 原删除及 AT01 覆盖成立。 |
| T3-024 | OK | `tests/app/support/S8A-L8-host.ts:32`、`:58`、`:177`、`:295` | 仍只去四处 export。 |
| T3-025 | OK | `tests/app/ui-refresh.test.ts:183`；`tests/app/ui-live.test.ts:370` | 先补 reset 前后各加一次的断言，再删来源。 |
| T3-026 | OK | `tests/app/ui-store.test.ts:219`；`tests/app/ui-actions.test.ts:71` | 原删除成立。 |
| T3-027 | OK | `tests/business/A2-workflow-auto-rework.test.ts:243`；`tests/scenarios/C8-human-stop-respected.test.ts:420` | 原合并成立，来源起点移到243行。 |
| T3-028 | OK | `tests/business/K3-17-goal-guard.test.ts:62`；`tests/business/K3-46-review-advance-failures.test.ts:255`、`:279`、`:328`；`tests/business/K3-UR7-crr-failed-set.test.ts:151` | 仍可抽共用提交拦截包装，保留各自回调。 |
| T3-029 | OK | `tests/business/K3-41-release-hold.test.ts:306`、`:364` | 按书面改正保留真实崩溃、暂停后恢复两种前置。 |
| T3-030 | OK | `tests/business/K3-46-review-advance-failures.test.ts:123`、`:156`、`:312`；`tests/business/K3-UR7-crr-failed-set.test.ts:85`、`:178`、`:318` | 按书面改正抽取；睡眠轮询仍须换通知。 |
| T3-031 | OK | `tests/business/K3-UR7-crr-failed-set.test.ts:540`；`tests/business/K3-46-review-advance-failures.test.ts:626` | 合并两个被拒字段及 next 检查，按 A6 保留拒绝行。 |
| T3-032 | OK | `tests/business/K3-review-workflow-rows.test.ts:560`；`tests/business/K3-15-ur3h.test.ts:203` | 原合并成立。 |
| T3-033 | OK | `tests/business/K3-review-workflow-rows.test.ts:735`、`:936`；`tests/helpers/K3-proposal-round.ts:383`、`:526` | 按书面改正走真实轮次，独立列期望，保留 next 检查。 |
| T3-034 | OK | `tests/business/K3-review-workflow-rows.test.ts:972`、`:1064`、`:1253` | 按书面改正接真实 settings/mailbox 后统一。 |
| T3-035 | OK | `tests/composition/A1-graph-session-platform.test.ts:41`、`:233` | 同文件公开登记路径仍可替换 seed。 |
| T3-036 | OK | `tests/composition/K-R-previous-turn-bounds.test.ts:93` | 保留缺少接缝的一例并搬入另一例断言。 |
| T3-037 | OK | `tests/composition/R3c-R4b-platform.test.ts:41`、`:77`、`:92`；`tests/composition/R5a-project-bootstrap-platform.test.ts:107` | 公共治理链仍适用；期望按书面改正独立确定。 |
| T3-038 | OK | `tests/composition/R3d-R3g-platform.test.ts:83`；`tests/composition/R5a-project-bootstrap-platform.test.ts:107` | 改公开创建项目、登记工作区。 |
| T3-039 | OK | `tests/composition/S8A-L8-adoption-capture.test.ts:174`、`:180`；`src/contracts/architecture-observation.ts:54` | 改用公开 persistedRef，保留双层读取断言。 |
| T3-040 | OK | `tests/composition/S8A-L8-pass-capture.test.ts:380`、`:405` | 合并规格第2、3行，保留双后端。 |
| T3-041 | OK | `tests/composition/W1-future-plan-platform.test.ts:134`；`tests/composition/R5a-project-bootstrap-platform.test.ts:107` | 公开治理链仍适用，与042协调清理 raw schema。 |
| T3-042 | OK | `tests/composition/W1-future-plan-platform.test.ts:173`；`src/core/work-graph/state/task-machine.ts:142` | 公开采用后 claim 即可；starting 仍投影为 running。 |
| T3-043 | OK | `tests/composition/W2-future-intent-platform.test.ts:116`；`tests/composition/R5a-project-bootstrap-platform.test.ts:107` | 公开治理链仍适用。 |
| T3-044 | OK | `tests/composition/WP2-wiring.test.ts:134`、`:1403`；`src/composition/create-platform.ts:2027`；`tests/helpers/A2-restart-fixture.ts:213`、`:221` | 移开、真实 probe、及时恢复的动作仍适用；原样传探测结果。 |
| T3-045 | OK | `tests/data/S8D-compact-snapshot.test.ts:76`；`tests/data/S8D-observed-v2-codecs.test.ts:261` | 按书面改正交046统一处理，不删 compact 来源。 |
| T3-046 | OK | `tests/data/S8D-observed-v2-codecs.test.ts:261`；`tests/data/S8D-compact-snapshot.test.ts:84` | 删除 codecs 重复块，保留 compact 文件。 |
| T3-047 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:120`；`tests/data/S8D-A22-cpp-imports.test.ts:174` | 原合并成立。 |
| T3-048 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:307`；`tests/data/S8D-A22-cpp-imports.test.ts:156` | 原合并成立。 |
| T3-049 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:368`；`tests/data/S8D-A22-cpp-imports.test.ts:247` | 原合并成立。 |
| T3-050 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:233`；`tests/data/S8D-A22-cpp-imports.test.ts:389` | 仍须给目标补 files、parsed 断言。 |
| T3-051 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:73`、`:130`、`:204`；`.lead-ref/books/t-items-T3.md:382` | 按书面改正保留协议、三元说明符用例，只并指定其余例。 |
| T3-052 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:405`；`tests/data/S8D-A23-cpp-config.test.ts:216` | 原合并成立。 |
| T3-053 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:417`；`tests/data/S8D-A23-cpp-config.test.ts:236` | 原合并成立。 |
| T3-054 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:425`；`tests/data/S8D-A23-cpp-config.test.ts:253` | 原合并成立。 |
| T3-055 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:434`；`tests/data/S8D-A23-cpp-config.test.ts:269` | 原合并成立。 |
| T3-056 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:443`；`tests/data/S8D-A23-cpp-config.test.ts:301` | 原合并成立。 |
| T3-057 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:452`；`tests/data/S8D-A23-cpp-config.test.ts:318` | 与058一起处理同一来源用例。 |
| T3-058 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:457`；`tests/data/S8D-A23-cpp-config.test.ts:333` | 原合并成立。 |
| T3-059 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:464`；`tests/data/S8D-A23-cpp-config.test.ts:349` | 原合并成立。 |
| T3-060 | OK | `tests/data/S8D-cpp-import-graph-script.test.ts:377`、`:391`、`:472`、`:502`、`:521`；`.lead-ref/books/t-items-T3.md:446` | 按书面改正保留四个协议用例，其余指定例合并。 |
| T3-061 | OK | `tests/data/S8D-formal-unresolved-reason.test.ts:22`；`tests/data/S8D-A22-cpp-imports.test.ts:59`、`:114` | 原删除成立。 |
| T3-062 | OK | `tests/data/S8D-language-providers.test.ts:33`；`tests/data/S8A-file-graph.test.ts:33`；`tests/data/S8E-A25-strict-capture.test.ts:35`；`.lead-ref/books/t-items-T3.md:461` | 三个来源仍在；目标本来就是待新建，不能判 GONE。 |
| T3-063 | OK | `tests/data/S8D-observation-inventory.test.ts:104`、`:132`；`tests/data/S8E-A07-git-inventory.test.ts:37`、`:40` | 先补删除文件、符号链接输入及排除断言。 |
| T3-064 | OK | `tests/data/S8D-observation-inventory.test.ts:151`；`tests/data/S8E-A08-skip-list.test.ts:21` | 按书面改正补完整路径及 issues 断言。 |
| T3-065 | OK | `tests/data/S8D-observation-inventory.test.ts:168`；`tests/data/S8E-A23-ignored-databases.test.ts:40` | 仍须搬入跳过目录中的数据库输入。 |
| T3-066 | OK | `tests/data/S8D-observed-v2-codecs.test.ts:188`；`tests/data/S8E-old-format-rejection.test.ts:60` | 只删指定 it，保留 describe 和共享输入。 |
| T3-067 | OK | `tests/data/S8D-platform-fixture.test.ts:10`；`tests/data/S8E-A15-previous-observation.test.ts:24` | 原删除成立。 |
| T3-068 | OK | `tests/data/S8D-python-import-graph-script.test.ts:130`、`:95` | 只并自边例，保留整组协议断言。 |
| T3-069 | OK | `tests/data/S8D-python-import-graph-script.test.ts:140`；`tests/data/S8D-A21-python-config.test.ts:191` | 原合并成立。 |
| T3-070 | OK | `tests/data/S8D-python-import-graph-script.test.ts:149`；`tests/data/S8D-A21-python-config.test.ts:64` | 原合并成立。 |
| T3-071 | OK | `tests/data/S8D-python-import-graph-script.test.ts:157`；`.lead-ref/books/t-items-T3.md:523` | 保留157行协议例；只合并条目指定五例。 |
| T3-072 | OK | `tests/data/S8D-python-import-graph-script.test.ts:166`；`tests/data/S8D-A21-python-config.test.ts:122` | 目标仍需补 reason:null。 |
| T3-073 | OK | `tests/data/S8D-python-import-graph-script.test.ts:174`；`tests/data/S8D-A21-python-config.test.ts:157` | 原合并成立。 |
| T3-074 | OK | `tests/data/S8D-python-import-graph-script.test.ts:182`；`tests/data/S8D-A21-python-config.test.ts:172` | 原合并成立。 |
| T3-075 | OK | `tests/data/S8D-python-import-graph-script.test.ts:219`；`tests/data/S8D-exploration-regressions.test.ts:89` | 原合并成立。 |
| T3-076 | OK | `tests/data/S8E-A26-git-classification.test.ts:71`；`tests/data/S8D-observation-inventory.test.ts:55` | 按书面改正抽取，保留授权、版本和释放差异。 |
| T3-077 | OK | `tests/helpers/B2-401-world.ts:185`；`tests/helpers/K3-blocked-command-fixture.ts:532` | 共用入口仍固定真实 Kernel facts，无须新增选项。 |
| T3-078 | OK | `tests/helpers/B2-crr-world.ts:231` | 原删除成立。 |
| T3-079 | OK | `tests/helpers/K3-35-continuation-fixture.ts:924`；`tests/helpers/K3-proposal-round.ts:783`、`:810` | 仍须先加 planRef 透传，再合并。 |
| T3-080 | OK | `tests/helpers/K3-35-continuation-fixture.ts:119`、`:130`、`:157`、`:199`、`:212`、`:236` | 原导出清理成立。 |
| T3-081 | OK | `tests/helpers/K3-35-required-review-block.ts:9`；`tests/helpers/K3-continuation-pure-fixture.ts:149` | 改直接导入后删转出口文件。 |
| T3-082 | OK | `tests/helpers/K3-continuation-pure-fixture.ts:23`、`:129`、`:136` | 与080、081同批清理。 |
| T3-083 | OK | `tests/helpers/K3-padded-review-record.ts:29`、`:58` | 原12处导出清理成立。 |
| T3-084 | OK | `tests/helpers/K3-proposal-round.ts:898`、`:910` | 删除死函数、类型和示例；其余指定项只去 export。 |
| T3-085 | OK | `tests/helpers/RL-query-fixture.ts:19`、`:54` | 原导出清理成立。 |
| T3-086 | OK | `tests/helpers/RL-resource-caps-support.ts:33`、`:140`、`:236` | 原死代码删除成立。 |
| T3-087 | OK | `tests/helpers/S2B-be2-reconcile-support.ts:68`、`:188` | 原四处导出清理成立。 |
| T3-088 | OK | `tests/helpers/S2B-r2-calendar-reverify-support.ts:149` | 连同专用导入、注释删除。 |
| T3-089 | OK | `tests/helpers/S2B-r3-r4-support.ts:37`、`:39`；`tests/work-graph/S2B-r4-session-workspace.test.ts:46`、`:66`；`.lead-ref/books/t-w1-findings.md:27` | 两文件仍应删除；按 R-3 保留生产守卫。 |
| T3-090 | OK | `tests/helpers/S2C-D-node-support.ts:630` | 原删除成立。 |
| T3-091 | OK | `tests/helpers/S2C-K2-scenario-support.ts:35` | 原删除成立。 |
| T3-092 | OK | `tests/helpers/S4C2-note-card-fixture.ts:42`、`:43` | 原删除成立。 |
| T3-093 | OK | `tests/helpers/S8A-L8-reminder-world.ts:47`、`:154`、`:162` | 原13处导出清理成立。 |
| T3-094 | OK | `tests/helpers/S8D-platform-fixture.ts:46`、`:53`、`:79`、`:81` | 原四处导出清理成立。 |
| T3-095 | OK | `tests/helpers/W2-whiteboard-fixture.ts:63`、`:73`、`:77` | 原删除及去 export 范围成立。 |
| T3-096 | OK | `tests/work-graph/A2-disposition-change.test.ts:599`；`tests/helpers/W2-whiteboard-fixture.ts:292`、`:329`；`.lead-ref/books/t-items-T3.md:708` | T3 仍只改第五处；等待 T1 四处合入后删 helper。 |
| T3-097 | OK | `tests/helpers/WP1-entry-fixture.ts:92`、`:141`、`:326` | 原删除及导出清理成立。 |
| T3-098 | OK | `tests/helpers/WP1-handover-fixture.ts:113`、`:437`、`:508`、`:518`、`:529`、`:564` | 原清理范围成立。 |
| T3-099 | OK | `tests/helpers/WP1-scenario-fixture.ts:76`、`:122`、`:132` | 原七个类型去 export；末两处行号已移动。 |
| T3-100 | OK | `tests/helpers/WP1-units-fixture.ts:83`、`:336`、`:342`、`:491` | 原四个类型去 export；末项移到491行。 |
| T3-101 | OK | `tests/helpers/WP2-duties-fixture.ts:34`、`:45`、`:74`、`:98`、`:200` | 原删除成立；末尾类型现位于200行。 |
| T3-102 | OK | `tests/helpers/WP2-platform-support.ts:52`、`:183`、`:866`、`:871` | 原删除及导出清理成立。 |
| T3-103 | OK | `tests/helpers/executed-files-stub.ts:21`；`tests/helpers/task-claim-fixture.ts:199`；`tests/helpers/S5-decision-fixture.ts:262`、`:498` | 仍按书面改正接真 reader、补注册及实际转发；不能换另一手造 DTO。 |
| T3-104 | OK | `tests/helpers/orchestration-fixture.ts:146` | 原删除成立。 |
| T3-105 | OK | `tests/runtime/S5-user-message-tools.test.ts:247`、`:324`、`:406`；`tests/helpers/S2B-runtime-steps-fixture.ts:319` | 书面改正仍适用：真实 Runtime、Workflow、工具与通知；不是已完成。 |
| T3-106 | CHANGED | `tests/work-graph/A2-disposition-change.test.ts:447`、`:449`、`:479`；`src/core/work-graph/tasks/execution-entry-service.ts:900`；`src/core/work-graph/tasks/claim-service.ts:1212`；`.lead-ref/books/t-w1-findings.md:27`、`:31` | **按 R-3/R-4 删除447–450的两条不可达前置行和479–508的直接重持 Lease 竞态；其余分支用共享真实 Runtime、公开停止/检查/completeTask 转换，拒绝行按 A6 保留并公开读取零变化；取消这三处旧 BLOCKED 待裁定安排，生产守卫保留。** |

```json
[
  {"id":"T3-001","status":"OK","where":"tests/app/A2-host-instance-lease.test.ts:65,113","note":"两处手写锁仍需按原动作转换。"},
  {"id":"T3-002","status":"OK","where":"tests/app/A2-runtime-capabilities.test.ts:244,262; src/app/host-settings.ts:831","note":"公开保存设置后关闭、重开。"},
  {"id":"T3-003","status":"OK","where":"tests/app/A2-runtime-capabilities.test.ts:60; tests/app/K-R-runtime-capabilities.test.ts:39","note":"按书面改正抽共享夹具。"},
  {"id":"T3-004","status":"OK","where":"tests/app/A2-settings-automation.test.ts:95,125","note":"合并时保留零值和false的重开断言。"},
  {"id":"T3-005","status":"DONE","where":"tests/app/AG2b-collaboration.test.ts:167,169,390,487","note":"四处均已使用显式通信字段。"},
  {"id":"T3-006","status":"OK","where":"tests/app/R6-workbench.test.ts:314,358; tests/app/session-rendering.test.ts:407","note":"来源历史块现至369行，独有断言仍须搬入。"},
  {"id":"T3-007","status":"OK","where":"tests/app/RL-34-wiring-resource-caps.test.ts:101,177","note":"原合并成立。"},
  {"id":"T3-008","status":"OK","where":"tests/app/RL-34-wiring-resource-caps.test.ts:155; tests/app/RL-44-host-restart-resource-caps.test.ts:132","note":"目标名称保留RL-34和RL-44。"},
  {"id":"T3-010","status":"OK","where":"tests/app/S2B-35-activity-routes.test.ts:196; src/app/host-instance-lease.ts:113","note":"手写锁仍需换真实租约。"},
  {"id":"T3-011","status":"OK","where":"tests/app/S2B-41-decision54-backfill-bound.test.ts:214,226; src/core/agent-runtime/runtime.ts:266,303","note":"先真实requeue授权，再由Runtime关闭并更新健康。"},
  {"id":"T3-012","status":"OK","where":"tests/app/S2B-41-decision54-backfill-bound.test.ts:104,113; tests/helpers/S2B-be2-reconcile-support.ts:71,83","note":"重复函数仍可合并。"},
  {"id":"T3-013","status":"OK","where":"tests/app/S2B-backfill-host.test.ts:139; src/app/host-instance-lease.ts:113","note":"手写锁仍需换真实租约。"},
  {"id":"T3-014","status":"OK","where":"tests/app/S4C2-scribe-reminders.test.ts:719,471","note":"原删除及覆盖成立。"},
  {"id":"T3-015","status":"DONE","where":"tests/app/S5-decision-routes.test.ts:271","note":"RT07已使用显式通信字段。"},
  {"id":"T3-016","status":"OK","where":"tests/app/S8A-L8-auto-capture-gate.test.ts:502; tests/app/S8A-L8-host-close-restart.test.ts:103","note":"原合并和参数清理成立。"},
  {"id":"T3-017","status":"OK","where":"tests/app/S8A-L8-http-watermark.test.ts:60; tests/app/S8A-L8-auto-capture-host.test.ts:168","note":"删除watermark正例，保留手动抓取规格行。"},
  {"id":"T3-018","status":"OK","where":"tests/app/S8A-L8-capture-start.test.ts:215,255; tests/work-graph/S8A-L8-observation-state.test.ts:671,695","note":"按书面改正加入无旧观测变体和精确原因。"},
  {"id":"T3-019","status":"OK","where":"tests/app/S8A-L8-capture-start.test.ts:310; tests/work-graph/S8A-L8-observation-state.test.ts:717,745,771","note":"保留三种无旧观测变体及计数。"},
  {"id":"T3-020","status":"OK","where":"tests/app/S8A-L8-capture-start.test.ts:114,150","note":"原删除范围成立。"},
  {"id":"T3-021","status":"OK","where":"tests/app/host-settings.test.ts:833; src/app/host.ts:979,993","note":"真实Answer及setup.checks路径仍在。"},
  {"id":"T3-022","status":"GONE","where":"tests/app/orchestration-mechanism.test.ts:169,181; src/contracts/core/session-message.ts:38","note":"旧兼容行已消失；现在181行的通知用例不能删。"},
  {"id":"T3-023","status":"OK","where":"tests/app/orchestration-mechanism.test.ts:28; tests/app/S3-attention-context.test.ts:238","note":"原删除及覆盖成立。"},
  {"id":"T3-024","status":"OK","where":"tests/app/support/S8A-L8-host.ts:32,58,177,295","note":"只去四处export。"},
  {"id":"T3-025","status":"OK","where":"tests/app/ui-refresh.test.ts:183; tests/app/ui-live.test.ts:370","note":"先补reset前后计数断言，再删来源。"},
  {"id":"T3-026","status":"OK","where":"tests/app/ui-store.test.ts:219; tests/app/ui-actions.test.ts:71","note":"原删除成立。"},
  {"id":"T3-027","status":"OK","where":"tests/business/A2-workflow-auto-rework.test.ts:243; tests/scenarios/C8-human-stop-respected.test.ts:420","note":"原合并成立，来源起点已移动。"},
  {"id":"T3-028","status":"OK","where":"tests/business/K3-17-goal-guard.test.ts:62; tests/business/K3-46-review-advance-failures.test.ts:255,279,328; tests/business/K3-UR7-crr-failed-set.test.ts:151","note":"抽共用提交拦截包装并保留回调差异。"},
  {"id":"T3-029","status":"OK","where":"tests/business/K3-41-release-hold.test.ts:306,364","note":"按书面改正保留两种前置。"},
  {"id":"T3-030","status":"OK","where":"tests/business/K3-46-review-advance-failures.test.ts:123,156,312; tests/business/K3-UR7-crr-failed-set.test.ts:85,178,318","note":"按书面改正抽取并用通知替换轮询。"},
  {"id":"T3-031","status":"OK","where":"tests/business/K3-UR7-crr-failed-set.test.ts:540; tests/business/K3-46-review-advance-failures.test.ts:626","note":"合并双字段拒绝及next检查，按A6组织。"},
  {"id":"T3-032","status":"OK","where":"tests/business/K3-review-workflow-rows.test.ts:560; tests/business/K3-15-ur3h.test.ts:203","note":"原合并成立。"},
  {"id":"T3-033","status":"OK","where":"tests/business/K3-review-workflow-rows.test.ts:735,936; tests/helpers/K3-proposal-round.ts:383,526","note":"按书面改正走真实轮次并独立列期望。"},
  {"id":"T3-034","status":"OK","where":"tests/business/K3-review-workflow-rows.test.ts:972,1064,1253","note":"接真实settings和mailbox后统一。"},
  {"id":"T3-035","status":"OK","where":"tests/composition/A1-graph-session-platform.test.ts:41,233","note":"同文件公开登记路径仍适用。"},
  {"id":"T3-036","status":"OK","where":"tests/composition/K-R-previous-turn-bounds.test.ts:93","note":"保留缺少接缝的一例并搬入另一例断言。"},
  {"id":"T3-037","status":"OK","where":"tests/composition/R3c-R4b-platform.test.ts:41,77,92; tests/composition/R5a-project-bootstrap-platform.test.ts:107","note":"公开治理链及书面改正仍适用。"},
  {"id":"T3-038","status":"OK","where":"tests/composition/R3d-R3g-platform.test.ts:83; tests/composition/R5a-project-bootstrap-platform.test.ts:107","note":"改公开创建项目、登记工作区。"},
  {"id":"T3-039","status":"OK","where":"tests/composition/S8A-L8-adoption-capture.test.ts:174,180; src/contracts/architecture-observation.ts:54","note":"改用公开persistedRef，保留双层断言。"},
  {"id":"T3-040","status":"OK","where":"tests/composition/S8A-L8-pass-capture.test.ts:380,405","note":"合并规格第2、3行并保留双后端。"},
  {"id":"T3-041","status":"OK","where":"tests/composition/W1-future-plan-platform.test.ts:134; tests/composition/R5a-project-bootstrap-platform.test.ts:107","note":"公开治理链仍适用，与042协调清理。"},
  {"id":"T3-042","status":"OK","where":"tests/composition/W1-future-plan-platform.test.ts:173; src/core/work-graph/state/task-machine.ts:142","note":"公开采用后claim即可，starting仍投影为running。"},
  {"id":"T3-043","status":"OK","where":"tests/composition/W2-future-intent-platform.test.ts:116; tests/composition/R5a-project-bootstrap-platform.test.ts:107","note":"公开治理链仍适用。"},
  {"id":"T3-044","status":"OK","where":"tests/composition/WP2-wiring.test.ts:134,1403; src/composition/create-platform.ts:2027; tests/helpers/A2-restart-fixture.ts:213,221","note":"移开、真实probe、及时恢复仍适用，原样传结果。"},
  {"id":"T3-045","status":"OK","where":"tests/data/S8D-compact-snapshot.test.ts:76; tests/data/S8D-observed-v2-codecs.test.ts:261","note":"交046统一处理，保留compact来源。"},
  {"id":"T3-046","status":"OK","where":"tests/data/S8D-observed-v2-codecs.test.ts:261; tests/data/S8D-compact-snapshot.test.ts:84","note":"删除codecs重复块。"},
  {"id":"T3-047","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:120; tests/data/S8D-A22-cpp-imports.test.ts:174","note":"原合并成立。"},
  {"id":"T3-048","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:307; tests/data/S8D-A22-cpp-imports.test.ts:156","note":"原合并成立。"},
  {"id":"T3-049","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:368; tests/data/S8D-A22-cpp-imports.test.ts:247","note":"原合并成立。"},
  {"id":"T3-050","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:233; tests/data/S8D-A22-cpp-imports.test.ts:389","note":"目标仍须补files、parsed断言。"},
  {"id":"T3-051","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:73,130,204; .lead-ref/books/t-items-T3.md:382","note":"按书面改正保留协议及三元说明符用例。"},
  {"id":"T3-052","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:405; tests/data/S8D-A23-cpp-config.test.ts:216","note":"原合并成立。"},
  {"id":"T3-053","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:417; tests/data/S8D-A23-cpp-config.test.ts:236","note":"原合并成立。"},
  {"id":"T3-054","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:425; tests/data/S8D-A23-cpp-config.test.ts:253","note":"原合并成立。"},
  {"id":"T3-055","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:434; tests/data/S8D-A23-cpp-config.test.ts:269","note":"原合并成立。"},
  {"id":"T3-056","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:443; tests/data/S8D-A23-cpp-config.test.ts:301","note":"原合并成立。"},
  {"id":"T3-057","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:452; tests/data/S8D-A23-cpp-config.test.ts:318","note":"与058一起处理来源用例。"},
  {"id":"T3-058","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:457; tests/data/S8D-A23-cpp-config.test.ts:333","note":"原合并成立。"},
  {"id":"T3-059","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:464; tests/data/S8D-A23-cpp-config.test.ts:349","note":"原合并成立。"},
  {"id":"T3-060","status":"OK","where":"tests/data/S8D-cpp-import-graph-script.test.ts:377,391,472,502,521; .lead-ref/books/t-items-T3.md:446","note":"按书面改正保留四个协议用例。"},
  {"id":"T3-061","status":"OK","where":"tests/data/S8D-formal-unresolved-reason.test.ts:22; tests/data/S8D-A22-cpp-imports.test.ts:59,114","note":"原删除成立。"},
  {"id":"T3-062","status":"OK","where":"tests/data/S8D-language-providers.test.ts:33; tests/data/S8A-file-graph.test.ts:33; tests/data/S8E-A25-strict-capture.test.ts:35; .lead-ref/books/t-items-T3.md:461","note":"三个来源仍在，目标本来待新建。"},
  {"id":"T3-063","status":"OK","where":"tests/data/S8D-observation-inventory.test.ts:104,132; tests/data/S8E-A07-git-inventory.test.ts:37,40","note":"先补删除文件、符号链接及排除断言。"},
  {"id":"T3-064","status":"OK","where":"tests/data/S8D-observation-inventory.test.ts:151; tests/data/S8E-A08-skip-list.test.ts:21","note":"按书面改正补路径和issues断言。"},
  {"id":"T3-065","status":"OK","where":"tests/data/S8D-observation-inventory.test.ts:168; tests/data/S8E-A23-ignored-databases.test.ts:40","note":"仍须搬入跳过目录中的数据库输入。"},
  {"id":"T3-066","status":"OK","where":"tests/data/S8D-observed-v2-codecs.test.ts:188; tests/data/S8E-old-format-rejection.test.ts:60","note":"只删指定it。"},
  {"id":"T3-067","status":"OK","where":"tests/data/S8D-platform-fixture.test.ts:10; tests/data/S8E-A15-previous-observation.test.ts:24","note":"原删除成立。"},
  {"id":"T3-068","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:130,95","note":"只并自边例，保留整组协议断言。"},
  {"id":"T3-069","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:140; tests/data/S8D-A21-python-config.test.ts:191","note":"原合并成立。"},
  {"id":"T3-070","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:149; tests/data/S8D-A21-python-config.test.ts:64","note":"原合并成立。"},
  {"id":"T3-071","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:157; .lead-ref/books/t-items-T3.md:523","note":"保留157行协议例，只并指定五例。"},
  {"id":"T3-072","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:166; tests/data/S8D-A21-python-config.test.ts:122","note":"目标仍须补reason:null。"},
  {"id":"T3-073","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:174; tests/data/S8D-A21-python-config.test.ts:157","note":"原合并成立。"},
  {"id":"T3-074","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:182; tests/data/S8D-A21-python-config.test.ts:172","note":"原合并成立。"},
  {"id":"T3-075","status":"OK","where":"tests/data/S8D-python-import-graph-script.test.ts:219; tests/data/S8D-exploration-regressions.test.ts:89","note":"原合并成立。"},
  {"id":"T3-076","status":"OK","where":"tests/data/S8E-A26-git-classification.test.ts:71; tests/data/S8D-observation-inventory.test.ts:55","note":"按书面改正保留授权、版本和释放差异。"},
  {"id":"T3-077","status":"OK","where":"tests/helpers/B2-401-world.ts:185; tests/helpers/K3-blocked-command-fixture.ts:532","note":"共用入口仍适用，无须新选项。"},
  {"id":"T3-078","status":"OK","where":"tests/helpers/B2-crr-world.ts:231","note":"原删除成立。"},
  {"id":"T3-079","status":"OK","where":"tests/helpers/K3-35-continuation-fixture.ts:924; tests/helpers/K3-proposal-round.ts:783,810","note":"先加planRef透传，再合并。"},
  {"id":"T3-080","status":"OK","where":"tests/helpers/K3-35-continuation-fixture.ts:119,130,157,199,212,236","note":"原导出清理成立。"},
  {"id":"T3-081","status":"OK","where":"tests/helpers/K3-35-required-review-block.ts:9; tests/helpers/K3-continuation-pure-fixture.ts:149","note":"改直接导入后删转出口文件。"},
  {"id":"T3-082","status":"OK","where":"tests/helpers/K3-continuation-pure-fixture.ts:23,129,136","note":"与080、081同批清理。"},
  {"id":"T3-083","status":"OK","where":"tests/helpers/K3-padded-review-record.ts:29,58","note":"原12处导出清理成立。"},
  {"id":"T3-084","status":"OK","where":"tests/helpers/K3-proposal-round.ts:898,910","note":"死函数整删，其余指定项只去export。"},
  {"id":"T3-085","status":"OK","where":"tests/helpers/RL-query-fixture.ts:19,54","note":"原导出清理成立。"},
  {"id":"T3-086","status":"OK","where":"tests/helpers/RL-resource-caps-support.ts:33,140,236","note":"原死代码删除成立。"},
  {"id":"T3-087","status":"OK","where":"tests/helpers/S2B-be2-reconcile-support.ts:68,188","note":"原四处导出清理成立。"},
  {"id":"T3-088","status":"OK","where":"tests/helpers/S2B-r2-calendar-reverify-support.ts:149","note":"连同专用导入及注释删除。"},
  {"id":"T3-089","status":"OK","where":"tests/helpers/S2B-r3-r4-support.ts:37,39; tests/work-graph/S2B-r4-session-workspace.test.ts:46,66; .lead-ref/books/t-w1-findings.md:27","note":"两文件仍应删除，按R-3保留生产守卫。"},
  {"id":"T3-090","status":"OK","where":"tests/helpers/S2C-D-node-support.ts:630","note":"原删除成立。"},
  {"id":"T3-091","status":"OK","where":"tests/helpers/S2C-K2-scenario-support.ts:35","note":"原删除成立。"},
  {"id":"T3-092","status":"OK","where":"tests/helpers/S4C2-note-card-fixture.ts:42,43","note":"原删除成立。"},
  {"id":"T3-093","status":"OK","where":"tests/helpers/S8A-L8-reminder-world.ts:47,154,162","note":"原13处导出清理成立。"},
  {"id":"T3-094","status":"OK","where":"tests/helpers/S8D-platform-fixture.ts:46,53,79,81","note":"原四处导出清理成立。"},
  {"id":"T3-095","status":"OK","where":"tests/helpers/W2-whiteboard-fixture.ts:63,73,77","note":"原删除及导出清理成立。"},
  {"id":"T3-096","status":"OK","where":"tests/work-graph/A2-disposition-change.test.ts:599; tests/helpers/W2-whiteboard-fixture.ts:292,329; .lead-ref/books/t-items-T3.md:708","note":"T3只改第五处，T1四处合入后再删helper。"},
  {"id":"T3-097","status":"OK","where":"tests/helpers/WP1-entry-fixture.ts:92,141,326","note":"原删除及导出清理成立。"},
  {"id":"T3-098","status":"OK","where":"tests/helpers/WP1-handover-fixture.ts:113,437,508,518,529,564","note":"原清理范围成立。"},
  {"id":"T3-099","status":"OK","where":"tests/helpers/WP1-scenario-fixture.ts:76,122,132","note":"七个类型去export，末两处行号移动。"},
  {"id":"T3-100","status":"OK","where":"tests/helpers/WP1-units-fixture.ts:83,336,342,491","note":"四个类型去export，末项移到491行。"},
  {"id":"T3-101","status":"OK","where":"tests/helpers/WP2-duties-fixture.ts:34,45,74,98,200","note":"原删除成立，末尾类型现位于200行。"},
  {"id":"T3-102","status":"OK","where":"tests/helpers/WP2-platform-support.ts:52,183,866,871","note":"原删除及导出清理成立。"},
  {"id":"T3-103","status":"OK","where":"tests/helpers/executed-files-stub.ts:21; tests/helpers/task-claim-fixture.ts:199; tests/helpers/S5-decision-fixture.ts:262,498","note":"按书面改正接真reader、补注册及实际转发。"},
  {"id":"T3-104","status":"OK","where":"tests/helpers/orchestration-fixture.ts:146","note":"原删除成立。"},
  {"id":"T3-105","status":"OK","where":"tests/runtime/S5-user-message-tools.test.ts:247,324,406; tests/helpers/S2B-runtime-steps-fixture.ts:319","note":"书面改正仍适用，真实Runtime路径可用，尚未完成转换。"},
  {"id":"T3-106","status":"CHANGED","where":"tests/work-graph/A2-disposition-change.test.ts:447,449,479; src/core/work-graph/tasks/execution-entry-service.ts:900; src/core/work-graph/tasks/claim-service.ts:1212; .lead-ref/books/t-w1-findings.md:27,31","note":"R-3/R-4已取代三处旧BLOCKED待裁定安排。","action":"删除447–450的两条不可达前置行和479–508的直接重持Lease竞态；其余分支用共享真实Runtime、公开停止/检查/completeTask转换，拒绝行按A6保留并公开读取零变化；取消这三处旧BLOCKED待裁定安排，生产守卫保留。"}
]
```

OK 101，DONE 2，GONE 1，CHANGED 1，BLOCK 0，条目 105/105