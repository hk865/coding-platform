本轮结论：**14 个必须修改项，11 个建议项**。计数按独立修复项；同一修复项涉及的实例分别列行。

本报告只依据静态阅读和调用链追踪；未修改文件，未运行测试、构建或项目代码。没有把“生产自返工 2 后没有 finding”当作本轮免审依据。

**COVERAGE**

“读全”指按本次要求读完变更函数、类型及其调用方；不表示把大型文件中所有无关旧功能重新审计。后文同名文件均对应本表完整路径；`workflow/contracts.ts` 保留目录以免混淆。

| 文件及代码锚点 | 读全？ | 结果 |
|---|---|---|
| `src/app/collaboration-driver.ts:818` | 是 | clean on P1, P4, P5；既有退路单列 STATIC |
| `src/app/startup-reconcile.ts:545` | 是 | P1、P5：M05；P4：S11 |
| `src/business/workflow/contracts.ts:238` | 是 | P4：M09 |
| `src/business/workflow/decision-actions.ts:260` | 是 | P1：M04；P4：S04 |
| `src/business/workflow/workflow.ts:517` | 是 | P1、P5：M05；P4：M09 |
| `src/composition/create-platform.ts:764` | 是 | P4：S01；确认 M01 的正式来源 |
| `src/composition/tool-commit-lookup.ts:46` | 是 | clean on P1, P4, P5 |
| `src/contracts/command-rerun-request.ts:49` | 是 | clean on P1, P4, P5 |
| `src/contracts/continuation-brief.ts:509` | 是 | P4：S03 |
| `src/contracts/core/prepared-execution.ts:226` | 是 | clean on P1, P4, P5 |
| `src/contracts/core/results.ts:32` | 是 | clean on P1, P4, P5 |
| `src/contracts/ledger.ts:45` | 是 | clean on P1, P4, P5 |
| `src/core/agent-runtime/command-rerun-tools.ts:177` | 是 | clean on P1, P4, P5；未确认提交的异常有明确工具失败 |
| `src/core/agent-runtime/context-assembler.ts:1196` | 是 | P1：M14；P4、P5：M07、M08；P4：S01、S02、S03 |
| `src/core/agent-runtime/continuation-brief-assembly.ts:333` | 是 | P4：S02 |
| `src/core/agent-runtime/execution-contracts.ts:337` | 是 | P4：S07 |
| `src/core/agent-runtime/execution-driver.ts:533` | 是 | P1：M02 |
| `src/core/agent-runtime/execution-preparation.ts:248` | 是 | P1：M03、M14；P5：M08；P4：S01 |
| `src/core/agent-runtime/observed-model-run.ts:307` | 是 | clean on P1, P4, P5 |
| `src/core/agent-runtime/runtime.ts:492` | 是 | clean on P1, P4, P5；已追踪 prepare/start 转发 |
| `src/core/work-graph/communication/decision-application.ts:99` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/communication/decision-source-facts.ts:795` | 是 | P1：M14；P4：M10、S02 |
| `src/core/work-graph/model/command-recognition-contracts.ts:10` | 是 | P5：M06 所需的识别接口调整 |
| `src/core/work-graph/model/command-rerun-request-contracts.ts:12` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/model/kernel-command-read-contracts.ts:10` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/model/unknown-call-review-contracts.ts:27` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/notes/note-service.ts:535` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/persistence/decision-record-codecs.ts:223` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/sessions/message-record-codecs.ts:539` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/state/command-normalization.ts:515` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/state/command-rerun-request.ts:153` | 是 | P4：M12、M13 |
| `src/core/work-graph/tasks/codec-fields.ts:14` | 是 | clean on P1, P4, P5；共享实现本身正确 |
| `src/core/work-graph/tasks/codec-shape-checks.ts:1` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/command-expansion.ts:104` | 是 | P4：M11、S03、S08 |
| `src/core/work-graph/tasks/command-recognition.ts:134` | 是 | P5：M06；P4：S08 |
| `src/core/work-graph/tasks/command-rerun-request-card.ts:70` | 是 | P4：M10、S06 |
| `src/core/work-graph/tasks/command-rerun-request-codecs.ts:188` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/command-rerun-request-service.ts:752` | 是 | P1：M01、M04、M14；P5：M06、M08；P4：M12、M13、S03、S05、S09 |
| `src/core/work-graph/tasks/decision-source-identity.ts:14` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/goal-settings-service.ts:102` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/plan-readers.ts:1921` | 是 | clean on P1, P4, P5；向新 CRR ②链传播的异常见 M04 |
| `src/core/work-graph/tasks/receipt-replay.ts:110` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/revision-guard.ts:14` | 是 | P4：S09 |
| `src/core/work-graph/tasks/unknown-call-review-answers.ts:201` | 是 | P1、P5：M05 |
| `src/core/work-graph/tasks/unknown-call-review-codecs.ts:520` | 是 | clean on P1, P4, P5 |
| `src/core/work-graph/tasks/unknown-call-review-service.ts:185` | 是 | P1：M14；P4：S08；容量退化列 OPEN |
| `src/core/work-graph/views/decision-read-model.ts:547` | 是 | P1：M14；P4：M10、S02、S10 |

**P1 TABLE**

记号：`U`＝明确的 `unavailable`；`C`＝明确的 `cancelled`；`↑`＝Promise 拒绝继续向调用方传播；“保持”表示当前结果符合该边界的要求。“无 signal”只描述该存储接口，不假定它支持取消。已提交事实不能因稍后取消而改写成“未提交”。

下表先列新增和改变的链，再列为闭合这些链而检查的既有等待点。既有退路不计入本批必须修改数。

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `command-rerun-tools.ts:177` 请求 owner | C→工具 cancelled；其他拒绝→明确工具失败 | `:183`→execution_failed，说明可能已提交 | 前置取消拒绝；等待中取消由 dispatcher 最终覆盖；保持 |
| `command-rerun-request-service.ts:219` 读请求 | 非 ready→明确拒绝；缺记录独立处理 | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:318` 提交请求 | StoreFailure→明确拒绝 | U | `:302` 提交前检查；提交中取消不抹掉事实；保持 |
| `command-rerun-request-service.ts:361` 读任务关闭事实 | 所有非 ready→U | U | C/AbortError 被归 U；应保留取消，M14 |
| `command-rerun-request-service.ts:439` 按 Goal 分页 | 原样返回分页失败 | 下层已捕获外部读取异常 | 无 signal；保持 |
| `command-rerun-request-service.ts:450` 读关闭事实 | 明确拒绝 | 下层转 U | 继承 `:361` 的取消降格；M14 |
| `command-rerun-request-service.ts:458` 按别名分页 | 原样返回失败 | 下层转 U | 无 signal；保持 |
| `command-rerun-request-service.ts:462` 按 Task 分页 | 原样返回失败 | 下层转 U | 无 signal；保持 |
| `command-rerun-request-service.ts:498` 全 Task 查询的关闭事实 | 明确拒绝 | 下层转 U | 继承 `:361`；M14 |
| `command-rerun-request-service.ts:504` 全 Task 查询的一页 | 非 ready 原样返回 | 下层转 U | 无 signal；额外总页数上限见 M08 |
| `command-rerun-request-service.ts:531` lookup 一页 | invalid 保留，其他失败→U | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:619` lookupAll | 失败→invalid/U | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:721` 请求身份查回执 | ready 重放；not_found 继续；其他拒绝 | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:740` 读 Task CRR 集合 | 非 ready→明确失败 | 下层转 U | 不以空请求集代替失败；保持 |
| `command-rerun-request-service.ts:752` 读 Task reviews | rejected 保留；其他非 ready→空数组 | U | `not_ready` 最终可变成 not_blocked；必须拒绝，M01 |
| `command-rerun-request-service.ts:774` recognizer | rejected 保留；其他非 ready→U | U | AbortError→U；不得当不命中；当前没有普通失败放行 |
| `command-rerun-request-service.ts:823` 请求前关闭事实 | 明确拒绝 | 下层转 U | 继承 `:361`；M14 |
| `command-rerun-request-service.ts:829` 持久化 closed | 拒绝返回；提交后仍返回 Task busy | 下层转 U | 提交前查 signal；保持已提交 closed |
| `command-rerun-request-service.ts:842` pending 追加写法 | 拒绝返回；成功带真实 cursor | 下层转 U | 提交前查 signal；保持 |
| `command-rerun-request-service.ts:857` denied_final 追加写法 | 拒绝返回；成功仍为 refused 业务结果 | 下层转 U | 提交前查 signal；保持 |
| `command-rerun-request-service.ts:869` 同 Run denied 追加写法 | 拒绝返回；成功仍为 refused | 下层转 U | 提交前查 signal；保持 |
| `command-rerun-request-service.ts:900` 新建请求提交 | 明确 committed/rejected | 下层转 U | 提交前查 signal；保持 |
| `command-rerun-request-service.ts:942` 答复身份查回执 | ready 重放；not_found 继续；其他拒绝 | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:951` 读待答请求 | 缺失或失败明确返回 | 下层转 U | 无 signal；保持 |
| `command-rerun-request-service.ts:976` 答复前关闭事实 | 明确拒绝 | 下层转 U | 继承 `:361`；M14 |
| `command-rerun-request-service.ts:979` 答复时持久化 closed | 写失败返回；成功后 busy | 下层转 U | 保留已提交事实；保持 |
| `command-rerun-request-service.ts:985` 读 Goal | 明确返回失败 | ↑，最终 HTTP500 | ①已保存的信息随协调结果丢失；应返回分阶段失败，M04 |
| `command-rerun-request-service.ts:1062` 消耗允许前查回执 | ready 重放；not_found 继续；其他拒绝 | U | 存储无 signal；保持 |
| `command-rerun-request-service.ts:1071` 读允许记录 | 缺失或失败明确返回 | 下层转 U | 无 signal；保持 |
| `command-rerun-request-service.ts:1094` 消耗允许前读关闭事实 | 明确拒绝 | 下层转 U | 继承 `:361`；M14 |
| `command-rerun-request-service.ts:1106` 消耗时持久化 closed | 写失败返回；成功后 busy | 下层转 U | 不再放行；保持 |
| `command-rerun-request-service.ts:1144` readRequest 读记录 | 缺失或失败明确返回 | 下层转 U | 无 signal；保持 |
| `command-rerun-request-service.ts:1152` readRequest 读关闭事实 | 失败拒绝；仅真实 closed 才派生 closed | 下层转 U | 继承 `:361`；M14 |
| `command-rerun-request-service.ts:1186` 工具提交查询 | 映射 committed/not_committed/undetermined | undetermined | 无 signal；没有把未知认成未提交，保持 |
| `command-expansion.ts:142` 读 package 文件 | 失败→该展开 basis unavailable | 同样局部 unavailable | 取消也被当普通展开失败；Run/提交上层另有 guard，见 M14 |
| `command-expansion.ts:170` readPackage | 不可读明确留在展开事实中 | 外部读异常已转换 | 不阻断普通 package 读取失败，符合规定 |
| `command-expansion.ts:199` 一级脚本 | no-script 跳过；不可读记 basis | 意外异常↑ | 普通读取退化可接受；取消应与普通不可读区分 |
| `command-expansion.ts:218` 二级脚本 | no-script 跳过；不可读记 basis | 意外异常↑ | 同上 |
| `command-recognition.ts:73` 展开当前命令 | 使用显式 expansion 结果 | 请求 owner→U；hook→放行 | hook 整体失败须拦下，M02 |
| `command-recognition.ts:82` 读当前 package | 失败→局部 unavailable | 同样局部 unavailable | C 被混入局部退化；实际 Run 取消仍由 Kernel 收束 |
| `receipt-replay.ts:110` eventAt | 交 onFailure，拒绝重放 | 交 onFailure，拒绝重放 | 无 signal；保持 |

以下返回 Promise 的位置也已追踪，没有因为缺少 `await` 关键字而漏掉：`command-rerun-request-service.ts:239`、`:277` 的回执重放，`:344` 的 closed 提交，`:1019` 的答复提交，以及 `tool-commit-lookup.ts:46` 的 owner 分派；失败均继续按各自调用链处理。

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `context-assembler.ts:1196` Kernel 窗口 | 所有非 ready→U | `:1220`→U | 真实 C 在此丢失；应保留，M14 |
| `context-assembler.ts:1249` review 命令事实 | 非 ready→空 facts map | 意外异常↑至 prepare | 取消也走摘要退路；该摘要退路为既有行为，见 STATIC |
| `context-assembler.ts:1390` Task reviews | mapRead，不当空集 | U | resolved C 可上返；总页数上限见 M08 |
| `context-assembler.ts:1422` Task CRRs | mapRead | U | resolved C 可上返；总页数上限见 M08 |
| `context-assembler.ts:1530` blocked lines | 非 ready→装配失败 | ↑至 prepare catch→U | 不以空段落代替失败；保持 |
| `execution-preparation.ts:263` Task reviews | rejected 保留；其他非 ready→U | U | C 保留；缺依赖默认空集见 M03 |
| `execution-preparation.ts:450` review 全集 | 非 ready 返回 prepare | 已捕获底层读取异常；意外异常↑ | 不形成成功 prepare；保持 |
| `execution-preparation.ts:461` Task closure | 所有非 ready→U | U | C/AbortError 降为 U；M14 |
| `execution-preparation.ts:490` assembleTask | 非 ready 原样返回 | U | 同一 ctx 向下传；不将失败装配当成功 |
| `execution-driver.ts:452` 当前 review | 非 ready→固定未确认拦截 | 同样拦截 | 不放行；保持 |
| `execution-driver.ts:471` Task 请求全集 | 非 ready→固定未确认拦截 | 同样拦截 | 不使用空请求集；保持 |
| `execution-driver.ts:500` 消耗一次允许 | 只有 committed 放行；其他拦截 | 拦截 | 提交后取消保留 used；Kernel 阻止随后执行，保持 |
| `execution-driver.ts:533` recognizer | 所有非 ready→CONTINUE | CONTINUE | 真 Run 取消仍由 Kernel 停止；普通识别失败必须拦截，M02 |
| `execution-preparation.ts:143` baseline root | 明确 unavailable baseline | 明确 unavailable baseline | 允许的 baseline 降级；保持 |
| `execution-preparation.ts:151` baseline capture | unavailable 带原因 | unavailable baseline | 保持 |
| `execution-preparation.ts:158` baseline put | unavailable baseline | unavailable baseline | 不伪造已保存 baseline；保持 |
| `execution-preparation.ts:334` execution | mapRead | U | `:361` 读后检查取消；保持 |
| `execution-preparation.ts:366` Role | mapRead | U | `:382` 读后检查取消；保持 |
| `execution-preparation.ts:387` Host 配置 | mapRead | U | `:419` 读后检查取消；保持 |
| `execution-preparation.ts:516` baseline helper | 明确 unavailable baseline | 意外异常↑ | baseline 不可用有字段表达；保持 |
| `execution-preparation.ts:570` body put | capacity/U | U | 不把失败 put 当成功；保持 |
| `context-assembler.ts:1283` review | mapRead | U | ctx 向下传；明确失败 |
| `context-assembler.ts:1295` 原 execution | mapRead | U | ctx 向下传；明确失败 |
| `context-assembler.ts:1298` reviewSessionBasis | 不可读→无历史 seed | ↑至 prepare | 既有退化；没有伪造历史边界 |
| `context-assembler.ts:1299` reviewCommandFacts | 失败→摘要退路 | ↑至 prepare | 既有行为，见 STATIC |
| `context-assembler.ts:1301` capture changes | 不可读→使用有计数的 sample | ↑至 prepare | 不声称取得完整变化；保持 |
| `context-assembler.ts:1478` continuation basis | mapRead | U | 明确失败 |
| `context-assembler.ts:1499` previous turn | retry→拒绝；not_entered 才找祖先 | ↑至 prepare | 不将读失败当未进入；保持 |
| `context-assembler.ts:1508` previous turn 备用入口 | 同上 | ↑至 prepare | 同上 |
| `context-assembler.ts:1513` workspace facts | 不可读字段显式 unavailable | ↑至 prepare | 不声称工作区无变化；保持 |
| `context-assembler.ts:1517` session basis | 不可读→无 seed | ↑至 prepare | 既有退化 |
| `context-assembler.ts:1526` 文件两侧 | 缺数据有原因、无 diff | ↑至 prepare | 不伪造 diff；保持 |
| `context-assembler.ts:1527` capture changes | 使用有计数 sample | ↑至 prepare | 同 `:1301` |
| `context-assembler.ts:1582` graph context | 非 ready 返回 | U | 明确失败 |
| `context-assembler.ts:1629` 可选上游 enrichment | 保留已有 executions | 保留已有 executions | 既有可选补充路径；不计本批新增 |
| `context-assembler.ts:1654` 输入页 | 非 ready 返回；来源变化冲突 | U | 不用半页凑成功输入；保持 |
| `context-assembler.ts:1692` brief 装配 | ok:false 返回 | ↑至 prepare；容量异常另映射 | 明确失败 |
| `context-assembler.ts:1712` review 装配 | ok:false 返回 | ↑至 prepare | 明确失败 |

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `execution-driver.ts:579` manifest | helper 拒绝原样返回 | body 读异常已转 U | 入口 `:554` 查取消；保持 |
| `execution-driver.ts:586` execution | mapRead | U | 明确失败 |
| `execution-driver.ts:626` resume delivery | 仅 ready 且 queued 才复入 | ↑ | 不假定投递成功；保持 |
| `execution-driver.ts:803` Role | mapRead | U | 明确失败 |
| `execution-driver.ts:817` Host 配置 | mapRead | U | `:853` 另查取消 |
| `execution-driver.ts:858` workspace root | mapWorkspace | U | 明确失败 |
| `execution-driver.ts:881` authorize entry | mapWrite | U | 不生成虚假 permit；保持 |
| `execution-driver.ts:900` 授权后重读 | mapRead | ↑ | 不沿用旧 revision；保持 |
| `execution-driver.ts:906` begin entry | mapWrite；重放仅观察 | U | 不重跑已进入轮次；保持 |
| `execution-driver.ts:923` completed boundary | 拒绝原样返回 | U | 只有明确 null 才 current_turn；保持 |
| `execution-driver.ts:984` entered tail | 保存实际结果 | 保存 enteredFailure 并 pause | 内部非取消 signal 保存已发生事实；保持 |
| `execution-driver.ts:1004` entered commit | 正常拒绝不重试 | 同身份重试一次 | 不抹掉已发生 entry；保持 |
| `execution-driver.ts:1011` entered commit 重试 | 明确结果 | U | 不伪造提交；保持 |
| `execution-driver.ts:1017` callEntered | 非 committed→pause；冲突真实重读 | 进入失败收束 | 保留失败事实；保持 |
| `execution-driver.ts:1023` 冲突后 execution | 非 ready→pause | pause | 不用旧 pin 重试；保持 |
| `execution-driver.ts:1043` 新 pin 的 callEntered | 非 committed→pause | 进入失败收束 | 保持 |
| `execution-driver.ts:1069` control | pause 按控制执行 | Kernel 收束失败/取消 | 不自行吞掉真实取消 |
| `execution-driver.ts:1083` 路径授权 | 非 ready/不允许→block | block | 不放行；保持 |
| `execution-driver.ts:1098` model binding | 明确失败 | 已知拒绝保留 code；其他 U | 不调用未授权 provider |
| `execution-driver.ts:1125` workspace 授权 | mapWorkspace | U | 明确失败 |
| `execution-driver.ts:1137` 当前授权 | 非 ready/版本变动→抛错 | 阻止 provider | 保持 |
| `execution-driver.ts:1174` barrier control | pause 按控制执行 | Kernel 收束 | 真实取消进入 Kernel 终态 |
| `execution-driver.ts:1189` control inputs | 实际读取失败不变空集 | Kernel input_supply_failed/取消 | 缺可选 control 的空集是既有接口行为 |
| `execution-driver.ts:1212` runObservedModel | 不凭返回值直接宣告 Run 完成 | 仍进入真实历史回收 | 取消依历史终态收束；保持 |
| `execution-driver.ts:1264` observation | 真实结果，必要时带 enteredFailure | ↑ | 使用独立 signal 保留事实；保持 |
| `execution-driver.ts:1269` revokeNotEntered | 仅可证未进入才撤回 | 失败留给启动恢复 | 不写虚假未进入；保持 |
| `observed-model-run.ts:158` group.close | 正常关闭 | 收集错误后继续关其他资源 | 清理失败不当清理成功 |
| `observed-model-run.ts:161` closeSource | 正常关闭 | 收集错误 | 同上 |
| `observed-model-run.ts:229` pending source drain | open 失败表示无已取得资源 | 进入资源收束 | 不声称 source 可用 |
| `observed-model-run.ts:234` source close | 正常关闭 | cleanupFailure | 清理异常保留 |
| `observed-model-run.ts:248` material-current | 无失败 union | 阻止 provider | 后续另查 signal |
| `observed-model-run.ts:249` beforeCall | 无失败 union | 阻止 provider | `:252` 检查 signal |
| `observed-model-run.ts:260` stream 前 source-current | 无失败 union | 阻止 provider | 不进入 provider |
| `observed-model-run.ts:265` stream 后 source-current | 无失败 union | Kernel/driver 历史回收 | 不伪造正常完成 |
| `observed-model-run.ts:269` loadAppConfig | 读取成功才继续 | finally 后↑ | 资源仍收束 |
| `observed-model-run.ts:279` eager source open | 成功才继续 | finally 后↑ | 没有旧 source 退路 |
| `observed-model-run.ts:307` Kernel run | 原样终态 | finally 后↑ | Kernel 保存取消终态 |
| `observed-model-run.ts:360` live event publish | best-effort 通知 | 不作终态证据 | 不影响已保存终态 |
| `observed-model-run.ts:385` resource close | 完成全部关闭尝试 | 按 cleanupFailure 上抛 | 不把清理失败隐藏为成功 |

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `decision-actions.ts:284` CRR applyAnswer | action 结果装入 outcome | ↑，越过协调 | resolved C 可保留；AbortError 丢阶段结果，M04 |
| `decision-actions.ts:472` applicationReceipt | null→application_not_recorded，保留 action | 正式接线捕获成 null | 无 signal；保持未补记事实 |
| `decision-actions.ts:481` 补记③ | 非 committed→application_not_recorded | ↑ | 已确认①②不能随异常消失；需阶段边界保护，M04 |
| `decision-actions.ts:507` adapter.apply | 非 ready→action rejection | ↑ | ②取消/异常应成为有限阶段结果，M04 |
| `decision-actions.ts:538` 答复① | 非 committed 整体拒绝 | ↑至 HTTP500 | 尚未确认①时不声称已答；保持事实边界 |
| `decision-actions.ts:546` 派发②③ | 返回 answer/action/application/state | ①已存但整体抛出 | 应保留①并报告后续失败，M04 |
| `decision-actions.ts:588` 重驱读正式答复 | 非 ready 返回 | ↑至 driver/HTTP | resolved C 保留；throw 取消仍外抛 |
| `decision-actions.ts:608` 重驱派发②③ | 返回落实结果 | ↑ | 同 M04 的阶段边界要求 |
| `create-platform.ts:772` Task review 分页 | 所有非 ready 原样回 owner | ↑至 owner catch | 自身没有变空集；下游 M01 |
| `create-platform.ts:911` receipt eventAt | 非 ready→null | null | 无 signal；③状态为未补记 |
| `plan-readers.ts:376` readMany | 明确领域失败 | ↑ | 无 signal；新 CRR ②链触发 M04 |
| `plan-readers.ts:399` readBatch | 明确失败或 not_found | ↑ | 同上 |
| `plan-readers.ts:1946` Goal/Plan window | 非 ready 原样回 | ↑ | 无 signal；不会默认 Task active |
| `plan-readers.ts:1953` canonical Task facts | 非 ready 原样回；缺 Task 拒绝 | ↑ | 无 signal；不会默认 Task active |
| `plan-readers.ts:2244` responsibility Goal | 非 ready 返回 | ↑ | 无 signal；明确失败 |
| `plan-readers.ts:2250` responsibility Plan | 非 ready 返回 | ↑ | 无 signal；明确失败 |
| `plan-readers.ts:2257` responsibility Task facts | 非 ready 返回 | ↑ | 无 signal；现在共用 closure pure |
| `plan-readers.ts:2284` origin Plan | 非 ready 返回 | ↑ | 不替换成当前 Plan 来源 |
| `unknown-call-review-answers.ts:156` 查②回执 | not_found→null；其他拒绝 | U | 无 signal；区分缺回执和读失败 |
| `unknown-call-review-answers.ts:184` 答复索引 | helper 失败→明确拒绝 | U 或保留已有 rejection | 存储无 signal |
| `unknown-call-review-answers.ts:206` CRR 回执 | null→continue，最终遗漏答案 | helper 已转拒绝 | 应把②未提交的 CRR 交给恢复，M05 |
| `unknown-call-review-answers.ts:218` UCR 回执 | null 跳过 UR7b 条目 | helper 已转拒绝 | UCR 另有 UR7 入口；不按 CRR 同报 |
| `unknown-call-review-service.ts:185` 原 execution | 所有非 ready→U | U | C/AbortError 降格；M14 |
| `unknown-call-review-service.ts:196` Kernel 命令事实 | 所有非 ready→U | U | C 降格；M14 |
| `unknown-call-review-service.ts:211` package 读取 | 局部展开 unavailable | 局部展开 unavailable | C 混入普通退化；提交前真 abort 仍被 `:485` 阻止 |
| `unknown-call-review-service.ts:235` 展开脚本 | 显式 expansions/truncated | ↑至②协调 | 不把普通 package 失败当处置失败；取消需独立 |
| `unknown-call-review-service.ts:443` loadReview | 明确失败/not_found | U | 无 signal |
| `unknown-call-review-service.ts:501` commitReview | WriteResult 返回 | U | `:485` 提交前取消检查 |
| `unknown-call-review-service.ts:1226` 查处置回执 | ready 重放；not_found 继续 | U | 重放先于可变守卫；保持 |
| `unknown-call-review-service.ts:1236` 读答复消息 | 失败返回 | helper 转换读取失败 | 后续 commit 有取消 guard |
| `unknown-call-review-service.ts:1266` loadReview | 失败返回 | U | 不用默认 review |
| `unknown-call-review-service.ts:1297` readGoal | 失败返回 | ↑ | 既有 UCR 异常链，不计新增实例 |
| `unknown-call-review-service.ts:1323` 答复正文 | rejected 保留；其他 U | ↑ | resolved C 保留；throw 取消外抛 |
| `unknown-call-review-service.ts:1335` 构建 blocked commands | ok:false→明确拒绝 | ↑ | 新链取消映射见 M14；真 abort 不提交 |
| `unknown-call-review-service.ts:1338` autonomy 数值 | 同步值 | 仅同步 pure 异常 | 无取消边界；旧冗余 await，不计 finding |
| `unknown-call-review-service.ts:1518` review 索引 | invalid 保留；其他 U；水位不齐最终 not_ready | U | 无 signal；证实 M01 可达 |
| `unknown-call-review-service.ts:1606` unapplied answers | 非 ready 原样回 | helper 转换 | 不以空集合替换失败 |
| `note-service.ts:535` write 回执重放 | 明确拒绝或原事件结果 | helper 捕获 eventAt 异常 | 无 signal；保持 |
| `note-service.ts:562` write 回执重查 | ready 重放；not_found→null；其他拒绝 | U | 无 signal；保持 |
| `note-service.ts:578` disposition 回执重放 | 明确拒绝或原事件结果 | helper 捕获 eventAt 异常 | 无 signal；保持 |
| `note-service.ts:602` disposition 回执重查 | ready 重放；not_found→null；其他拒绝 | U | 无 signal；保持 |
| `decision-application.ts:128` 查提交 | 非 ready 明确失败 | U | 无 signal；不把未知当有效回执 |
| `decision-application.ts:142` eventAt | 非 ready 明确失败 | U | 后续仍核 identity/proof；保持 |

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `decision-source-facts.ts:236` readMany | 明确失败；只有缺失才 not_found | U | 无 signal |
| `decision-source-facts.ts:257` readEncoded | 失败返回 | 下层捕获 | 无 signal |
| `decision-source-facts.ts:346` pin 读取 | 失败返回；revision 不符拒绝 | 下层捕获 | 无 signal |
| `decision-source-facts.ts:746` UCR Goal | 非 ready 返回 | 下层捕获 | 无 signal |
| `decision-source-facts.ts:755` UCR review | 缺失明确拒绝；其他返回 | ↑至① | resolved C 保留 |
| `decision-source-facts.ts:766` UCR Run | 失败返回 | 下层捕获 | 无 signal |
| `decision-source-facts.ts:774` UCR closure | 非 ready 返回 | ↑至① | 不默认 active |
| `decision-source-facts.ts:776` UCR target digests | 使用显式文件事实 | 失败传播 | 既有文件事实语义 |
| `decision-source-facts.ts:795` CRR Goal | 非 ready 返回 | 下层捕获 | 无 signal |
| `decision-source-facts.ts:805` CRR request | 缺失明确拒绝；其他返回 | ↑至① | resolved C 保留 |
| `decision-source-facts.ts:816` CRR review | 缺失明确拒绝；其他返回 | ↑至① | resolved C 保留 |
| `decision-source-facts.ts:823` CRR 原 Run | 失败返回 | 下层捕获 | 无 signal；多余 I/O，M10 |
| `decision-source-facts.ts:830` CRR closure | 非 ready 返回 | ↑至① | 不默认 active |
| `decision-source-facts.ts:841` CRR execution | 所有非 ready→U | U | C/AbortError 降格，M14 |
| `decision-source-facts.ts:848` CRR Kernel 文本 | 所有非 ready→U | 正式 helper 已转 U；其他↑ | C 降格，M14 |
| `decision-source-facts.ts:861` CRR 同别名历史 | 所有非 ready→U | ↑至① | C 的 code/reason 丢失，M14 |
| `decision-source-facts.ts:889` verifyPins | 明确拒绝 | 下层捕获 | 不用失效 pin 提交① |
| `decision-read-model.ts:277` collection | 非 ready 返回 | queue 外抛；单卡有公共 catch | 保留尚未被下层改写的 C |
| `decision-read-model.ts:280` 通用 Goal | 不可读可变 null | reader 捕获成 null | CRR projector 不用结果；S10 |
| `decision-read-model.ts:300` byKey | 非 ready 返回 | 公共单卡 catch | 保留尚未改写的 C |
| `decision-read-model.ts:306` 通用 Goal | 不可读可变 null | reader 捕获成 null | CRR projector 不用结果；S10 |
| `decision-read-model.ts:385` closure 缓存 | 非 ready 缓存并返回 | ↑ | 不缓存成功默认值 |
| `decision-read-model.ts:426` UCR Goal/Plan | 非 ready 返回 | ↑至公共查询 | 无 signal |
| `decision-read-model.ts:435` UCR reviews | 非 ready 返回 | ↑至公共查询 | resolved C 保留 |
| `decision-read-model.ts:445` UCR target digests | 使用显式文件事实 | 失败传播 | 既有文件事实语义 |
| `decision-read-model.ts:453` UCR 原 Run | 缺失/损坏明确失败 | storeFailureToRejection | 无 signal |
| `decision-read-model.ts:466` UCR closure | 非 ready 返回 | ↑ | 不默认 active |
| `decision-read-model.ts:485` UCR byKey review | 非 ready 返回；not_found 按无卡 | 公共单卡 catch | resolved C 保留 |
| `decision-read-model.ts:492` UCR byKey Goal/Plan | 非 ready 返回 | 公共单卡 catch | 无 signal |
| `decision-read-model.ts:496` UCR byKey Run | 缺失→ready null；读失败拒绝 | 拒绝 | 既有缺失策略 |
| `decision-read-model.ts:503` UCR byKey closure | 非 ready 返回 | 公共单卡 catch | 不默认 active |
| `decision-read-model.ts:505` UCR byKey digests | 显式文件事实 | 失败传播 | 既有语义 |
| `decision-read-model.ts:516` UCR base page | 非 ready 返回 | ↑至 queue | 不新增吞错 |
| `decision-read-model.ts:557` CRR alias list | 非 ready→只有 status 的 rejected | ↑ | C、code、reason 丢失，M14 |
| `decision-read-model.ts:580` CRR Goal/Plan | 非 ready 返回 | ↑ | 缺 Goal 明确失败 |
| `decision-read-model.ts:587` CRR closure | 非 ready 返回 | ↑ | 不默认 active |
| `decision-read-model.ts:593` CRR review | rejected 保留；其他 U | ↑ | resolved C 保留 |
| `decision-read-model.ts:609` CRR 原 Run | 缺失/损坏明确失败 | 拒绝 | 无 signal；多余 I/O，M10 |
| `decision-read-model.ts:631` CRR execution | rejected 保留；其他 U | ↑ | resolved C 保留 |
| `decision-read-model.ts:638` CRR Kernel 文本 | 所有非 ready→U | 正式 helper 先转 U | C 降格，M14 |
| `decision-read-model.ts:651` CRR alias helper | 非 ready→U | ↑ | 上游已丢 C，M14 |
| `decision-read-model.ts:669` pending CRR 集合 | 非 ready 返回 | ↑ | resolved C 保留 |
| `decision-read-model.ts:679` collection cardOf | 非 ready 返回 | ↑ | 保留 cardOf 尚保留的 C |
| `decision-read-model.ts:697` byKey request | not_found→无卡；其他返回 | 公共单卡 catch | resolved C 保留 |
| `decision-read-model.ts:704` byKey cardOf | 非 ready 返回；closed→历史卡 | 公共单卡 catch | 不把失败当 closed |
| `decision-read-model.ts:1188` 查已有答复 | 真实答复派生答复卡 | `:1195` 公共 catch | 不制造答复 |
| `decision-read-model.ts:1189` 派生开放卡 | provider 失败上抛到公共 catch | 公共 catch | 已带 code 的取消可保留 |
| `decision-read-model.ts:1192` 刷新 pins | 明确失败进公共 catch | 公共 catch | 不制造当前 pin |
| `decision-read-model.ts:1194` 终态读取 | 明确结果 | 公共 catch | 不制造终态 |
| `decision-read-model.ts:1370` provider byKey | 只有 not_found→null；其他抛出 | 公共 catch | 不把 C 当无卡 |

| 调用点 | resolve-failure | throw | abort → 当前结局 → 所需结局 |
|---|---|---|---|
| `workflow.ts:1360` continuationHolder | 非 ready→原 Run | 原 Run | 既有取消退路，STATIC |
| `workflow.ts:1381` reviewGate/review | 非 ready→skip | skip | 既有取消退路，STATIC |
| `workflow.ts:1395` review round Run | 不可用→skip | catch→null→skip | 既有取消退路，STATIC |
| `workflow.ts:1412` 是否未入场 | 明确 boolean 门控 | ↑ | 不新增成功默认 |
| `workflow.ts:1440` UCR 答复 | 非 ready→skip | skip | 既有取消退路；没有 CRR 对应扫描，M05 |
| `workflow.ts:1485` review capability | 不可用→false | false | 既有 review_unavailable 退路 |
| `workflow.ts:1492` planReviewRound | selection/skip/rejection 分开 | ↑ | 不把失败当 claimed |
| `workflow.ts:1515` claimContinuation | null/拒绝分别处理 | ↑ | 不把 C 当 committed |
| `workflow.ts:1727` queryGoal | readRejection | ↑ | 明确失败 |
| `workflow.ts:1738` queryTaskGraph | readRejection | ↑ | 明确失败 |
| `workflow.ts:1781` reviewGate | 普通 Goal 对 skip 继续选其他任务 | ↑ | 接收上游已丢的取消，STATIC |
| `workflow.ts:1796` automationConfirmation | gated 则返回，否则继续 | ↑ | 既有逻辑；不补 CRR 扫描 |
| `workflow.ts:1815` continuationHolder | 使用 helper 返回的原 Run 退路 | helper 已捕获 | STATIC |
| `workflow.ts:1816` claimContinuation | null/拒绝分别处理 | ↑ | 不伪造 claim |
| `workflow.ts:1835` 是否未入场 | boolean 门控 | ↑ | 既有逻辑 |
| `workflow.ts:1846` readExecution | 非 ready 绕过 resume 分支 | ↑ | 既有退路，STATIC |
| `workflow.ts:1849` resumeRoundChain | 原样返回 | ↑ | 不额外吞取消 |
| `workflow.ts:1870` readContinuation | 明确拒绝/等待 | ↑ | 不伪造启动 |
| `workflow.ts:1874` readSession | 非 ready→waiting | ↑ | 既有 C→waiting，STATIC |
| `workflow.ts:1881` chooseSession | 明确 chosen/失败分支 | ↑ | 不新增 CRR 默认 |
| `workflow.ts:1894` buildClaimOperation | rejection 返回 | ↑ | 不制造操作 |
| `workflow.ts:1925` advanceGate | 原样返回 | ↑ | 不额外吞取消 |
| `workflow.ts:1950` 失败卡后的 selectNext | 拒绝返回；ready 带回原失败原因 | ↑ | 抛错时不能形成原失败的结构化结果 |
| `workflow.ts:2413` prepare | 非 ready→waiting | ↑至 driver/HTTP | 不继续 start |
| `workflow.ts:2422` start | 非 ready→waiting | ↑至 driver/HTTP | 不宣告正常完成 |
| `workflow.ts:2576` advanceReviewDisposition | 未落实有 failure，继续或等待 | ↑ | CRR 异常丢有限阶段结果，M04 |
| `workflow.ts:2591` 失败卡后继续 | 返回下一选择，保留失败 | ↑ | 同 `:1950` |
| `workflow.ts:2656` maintenance | 非 ready→空失败数组 | 空失败数组 | 既有静默退路，STATIC |
| `workflow.ts:2705` 交接答复消息 | 非 ready→hardFailure | null→hardFailure | C 归不可读，但不当已落实 |
| `workflow.ts:2755` 交接答复落实 | 失败加入 failedCardRefs，保留首失败 | 整个交接↑ | 应保留有限②失败结果，M04 |
| `workflow.ts:2794` 失败卡后继续 | failed-card 集合传入下一选择 | ↑ | 同 `:1950` |
| `workflow.ts:2814` 处理交接答案 | 非 null 返回；null 才继续 | ↑ | 没交接的 CRR 不会自行枚举，M05 |
| `workflow.ts:2818` maintenance | 接收 helper 的数组 | helper 已 catch | 既有空数组退路 |
| `workflow.ts:2819` selectNext | 包装明确结果 | ↑ | 不额外吞取消 |
| `workflow.ts:2825` performStep | 明确结果 | ↑ | 新 CRR 链的 M04 可传播至此 |
| `workflow.ts:2830` maintenance | 同 `:2818` | helper 已 catch | 既有退路 |
| `collaboration-driver.ts:812` 等待 admission | null 表示停止/取消 | 外层标 failed | null 有控制依据，不是假成功 |
| `collaboration-driver.ts:821` advanceWorkNow | 非 ready→failed/reason | 外层→failed/reason | stopRequested 保留停止语义 |
| `collaboration-driver.ts:822` runWithPump | 非 ready→failed/reason | 外层→failed/reason | failedCardRefs 正常接力 |
| `collaboration-driver.ts:881` awaitWake | false 退出，带既有 reason/控制状态 | 外层标 failed | stop/abort 结束等待 |
| `collaboration-driver.ts:884` pump 收尾 | 正常收尾 | catch 只收尾，pump 已记 reason | 不把收尾 Promise 当业务成功 |
| `startup-reconcile.ts:493` 自动化 Task 集合 | 失败有 problem 后返回空集 | problem | 启动 ctx 不中止；不是静默空集 |
| `startup-reconcile.ts:505` UCR kind3 答复 | not_found 无答复；其他失败记 problem | problem | 只覆盖 UCR；M05 |
| `startup-reconcile.ts:526` UCR kind4 答复 | 非 ready 记 problem | problem | UCR 的②后恢复入口 |
| `startup-reconcile.ts:545` CRR kind4 答复 | 非 ready 记 problem；ready 交接 | problem | helper 漏掉②前答案；M05 |
| `startup-reconcile.ts:586` open reviews | 失败有 problem，返回已读部分 | problem | 不静默丢读取失败 |
| `startup-reconcile.ts:613` Task graph | 非 ready 记 problem | problem | 启动 ctx 不中止 |
| `startup-reconcile.ts:634` queued control | 非 ready→false | scope catch→problem | 非 ready 本身无逐项失败记录；既有 STATIC |

**FINDINGS**

以下每个编号只给一种修复方向；同编号下每行是一个实例。

| 编号／级别／类别 | 实例、原因与后果 | 一种修复方向 |
|---|---|---|
| M01／必须改／P1 | `command-rerun-request-service.ts:758` 把非 rejected 的非 ready review 读取变成 `[]`；随后 `command-recognition.ts:52` 返回 ready(null)，owner 在 `command-rerun-request-service.ts:791` 返回 not_blocked，工具在 `command-rerun-tools.ts:127` 给正常答复。 | owner 只接受 ready；所有其他读取结果明确返回失败，只有 ready 的空集合才表示没有记录。 |
| M01／必须改／P1 | `unknown-call-review-service.ts:1486` 为 Task 查询读取多个状态 tuple；`:1538` 在水位不能一致时真实返回 not_ready；`create-platform.ts:776` 原样传给上述 owner。因此不是仅类型上可能、正式接线不可达的分支。 | 同 M01。 |
| M02／必须改／P1 | `execution-driver.ts:536` 将 recognizer 整体抛错变成 CONTINUE_TOOL；存在阻止绑定时仍可能放行命令。 | 整体识别失败统一返回 `blockTool(SHELL_BLOCKED_UNCONFIRMED_TEXT)`。 |
| M02／必须改／P1 | `execution-driver.ts:537` 将 recognizer 所有非 ready 也变成 CONTINUE_TOOL；只有 ready(null) 才能证明本轮未匹配。package 局部不可读已在 `command-recognition.ts:85` 独立退化。 | 同 M02；保留 ready(null) 正常放行。 |
| M03／必须改／P1 | `execution-preparation.ts:256` 缺少 unknownCallReviews 时返回 ready([])，经 `:455` 生成空绑定、`:540` 不写 blockedCommands，最终 `execution-driver.ts:782` 不安装 hook；缺接线被说成“没有阻止记录”。正式组合根已在 `create-platform.ts:1185` 接线，风险限于仍支持的缺依赖构造路径。 | 缺 reader 明确返回 unavailable，停止 prepare。 |
| M04／必须改／P1 | `command-rerun-request-service.ts:985` 的 readGoal 可沿 `plan-readers.ts:376` 抛错；新 adapter 在 `decision-actions.ts:284` 不捕获，`:538` 已提交的①无法在 `:546` 返回；最终 `src/app/server.ts:253` 只有通用 HTTP500。已保存答复和②失败阶段信息丢失。 | 在 U6 各阶段等待边界捕获异常，保留已确认的①/②事实，将未确认阶段表示为结构化 unavailable/cancelled，并返回有限协调结果。 |
| M04／必须改／P1 | `decision-actions.ts:507` 的 adapter 等待没有异常边界；CRR 重驱经 `workflow.ts:2755` 抛出时，也不能形成该卡的 action failure 和 failed-card 接力结果。 | 同 M04。 |
| M04／必须改／P1 | `decision-actions.ts:481` 的③补记等待同样没有异常边界；若该端口抛错，已确认的 action 会随整个协调 Promise 一起外抛，而不是保留为 application_not_recorded。 | 同 M04；未知提交不能伪称“肯定未提交”。 |
| M05／必须改／P1、P5 | `unknown-call-review-answers.ts:207` 在 CRR ②回执不存在时跳过已保存的答复；崩溃发生于①后②前、或②明确失败时，该答案从恢复集合消失。任务书 `.lead-ref/k3-g4b3-impl.md:131` 要求两类已答未落实卡都由 Workflow 接力。 | 统一枚举 CRR 已答而未完成落实的消息，包含②无回执情况，接入启动与普通 Goal 推进，再由同一 advance 重放②③。 |
| M05／必须改／P1、P5 | `startup-reconcile.ts:545` 的新 CRR 扫描只能接到上述过滤后的列表；`:499` 的②前 kind3 扫描只遍历 UCR open reviews。 | 同 M05。 |
| M05／必须改／P1、P5 | `workflow.ts:1378` 的普通 reviewGate 只有 UCR；`:2813` 仅在调用者已提供 answers 时处理 CRR，因此普通推进也不补漏掉的②前答案。 | 同 M05。 |
| M06／必须改／P5 | `command-recognition.ts:134` 只返回排序后的第一个命中；owner 在 `command-rerun-request-service.ts:786` 将它与 rewriteOf 比较，其他命中即使包含 rewriteOf 目标也会被 `:788` 拒绝。与 `slice-K3-SPEC.md:539`“rewriteOf 在命中的那几条里→用它”不符。 | 让共享 recognizer 一次解析、一次展开后支持优先选择已验证的 rewriteOf 目标；未指定时仍取第一命中。 |
| M07／必须改／P4、P5 | `context-assembler.ts:1409` 先按记录的 createdAt/runId 排序，再于 `:1443` 各记录内部排 alias；同时间的 A#2 可早于 B#1。任务书 `.lead-ref/k3-g4b3-impl.md:142` 要求跨记录按 createdAt/alias。 | 共用展平后排序的 blocked-entry 投影，再供 binding、recognizer、brief 使用。 |
| M07／必须改／P4、P5 | `execution-preparation.ts:309` 与 `command-recognition.ts:42` 已采用全局展平排序，而接续说明另做一套不同规则；不是规格没有定义顺序。 | 同 M07。 |
| M08／必须改／P5 | `execution-preparation.ts:260`、`:285` 把 Task review 全读限制在 10,000 页；还有 nextCursor 时直接失败。任务书 `.lead-ref/k3-g4b3-impl.md:236` 要求读到底。 | 删除总页数 cap，保留重复游标检测，以 nextCursor=null 结束。 |
| M08／必须改／P5 | `context-assembler.ts:1387`、`:1407` 对 review 分页设置同一额外总量限制。 | 同 M08。 |
| M08／必须改／P5 | `context-assembler.ts:1419`、`:1439` 对 CRR 分页设置 10,000 页限制；`.lead-ref/k3-g4b3-impl.md:152` 只规定 ⌈R/200⌉，没有 R 总上限。 | 同 M08。 |
| M08／必须改／P5 | `command-rerun-request-service.ts:515` 的 `page >= 10_000` 在仍有下一页时拒绝合法查询；规格 `slice-K3-SPEC.md:541` 没有该总页数上限。 | 同 M08。 |
| M09／必须改／P4 | `workflow/contracts.ts:238` 保留 failedReviewRefs 输入，但新解析器 `workflow.ts:695` 只读取 failedCardRefs；注释“Host 仍发送旧字段”不符当前接线。 | 删除 retired failedReviewRefs 类型、生产投影、清理分支和相应过期说明。 |
| M09／必须改／P4 | `workflow/contracts.ts:272` 保留 failedReviewRefs 输出，driver 在 `collaboration-driver.ts:828` 只读取 failedCardRefs。 | 同 M09。 |
| M09／必须改／P4 | `workflow.ts:517` 计算旧 UCR-only 数组，`:523` 继续输出，没有生产消费者。 | 同 M09。 |
| M09／必须改／P4 | `workflow.ts:1957`、`:1959` 继续携带并删除旧字段；这是新 union 接线完成后留下的兼容链。 | 同 M09；公开输入拒绝旧字段的规则应与兼容读取区分。 |
| M10／必须改／P4 | `command-rerun-request-card.ts:77` 的 run 输入在完整 summary `:158` 和 facts `:192` 中均未使用；pins 在 `:200` 也没有 Run。 | 删除死 run 输入及为它专设的读取，保留取得 Kernel session 所需的 execution 读取。 |
| M10／必须改／P4 | `decision-read-model.ts:609` 专门读取并解码原 Run，只在 `:656` 传给死字段；随后 `:631` 仍需读取 execution。增加一次无用途 I/O 和无用途失败条件。 | 同 M10。 |
| M10／必须改／P4 | `decision-source-facts.ts:823` 同样专读原 Run，只在 `:873` 传死字段；`:841` 另读 execution。 | 同 M10。 |
| M11／必须改／P4 | `command-expansion.ts:111` 声明返回 actions、`:115` 重新计算、`:228` 返回；两个生产消费者 `command-recognition.ts:91` 和 `unknown-call-review-service.ts:247` 均只用 expansions/truncated。 | 删除该未消费返回字段及其原动作计算；保留脚本体动作计算。 |
| M12／必须改／P4 | `command-rerun-request-service.ts:826` 重新定义“同别名 open 请求”；已有 `state/command-rerun-request.ts:153` 的 openRequestForAlias 没有生产调用。 | 两处 owner 分支统一调用已有 openRequestForAlias，并移除因此失效的 reach 豁免。 |
| M12／必须改／P4 | `command-rerun-request-service.ts:835` 再复制一次 pending/unused allowed 判断，同一 owner 内已经决定两次。 | 同 M12。 |
| M12／必须改／P4 | `state/command-rerun-request.ts:142` 的输入类型、`:249` 的 sameTask、`:253` 的 sameReviewRef 只随未接线 helper 留存；不是需要再造第三套规则。 | 同 M12。 |
| M13／必须改／P4 | `command-rerun-request-service.ts:657` 在调用状态机前再次判断 8 条写法上限；状态机 `state/command-rerun-request.ts:222` 已拥有同一 capacity 规则。 | owner 只组装事件并映射状态机结果，让状态机成为追加上限的唯一业务判断处。 |
| M13／必须改／P4 | `command-rerun-request-service.ts:85` 为该预判断再声明 MAX_DECLARED_FORMS=8；和状态机的上限一起维护会分叉。 | 同 M13；codec 对存储形状的检查仍保留。 |
| M14／必须改／P1 | `context-assembler.ts:1199` 把 history window 的 C 改成 U；真实来源 `src/core/agent-runtime/session-operations.ts:959` 明确返回 cancelled，因此不是假设性类型分支。 | 在读取边界保留 cancelled；catch 区分取消与普通异常，调用方继续透传取消。 |
| M14／必须改／P1 | `context-assembler.ts:1221` 对所有异常一律 U，取消异常也失去分类。 | 同 M14。 |
| M14／必须改／P1 | `decision-source-facts.ts:845` 将 execution 的所有非 ready 改成 U，`:842` 的 catch 也无取消区分。 | 同 M14。 |
| M14／必须改／P1 | `decision-source-facts.ts:851` 再把 Kernel 读取失败统一改成 U；仅修底层仍会在这里丢 C。 | 同 M14。 |
| M14／必须改／P1 | `decision-source-facts.ts:866` 把 request 列表的 C/code/reason 全部改成 U。 | 同 M14。 |
| M14／必须改／P1 | `decision-read-model.ts:562` 将 alias 列表失败缩成没有 code/reason 的 rejected，`:653` 再改成 U。 | 同 M14。 |
| M14／必须改／P1 | `decision-read-model.ts:642` 把 Kernel 的 C 改成 U。 | 同 M14。 |
| M14／必须改／P1 | `unknown-call-review-service.ts:190`、`:186` 把 execution 的取消结果/异常改成 U。 | 同 M14。 |
| M14／必须改／P1 | `unknown-call-review-service.ts:202`、`:198` 把 Kernel 的取消结果/异常改成 U。 | 同 M14。 |
| M14／必须改／P1 | `command-rerun-request-service.ts:370`、`:362` 把 closure 的取消结果/异常改成 U。 | 同 M14。 |
| M14／必须改／P1 | `execution-preparation.ts:461` 后的失败映射也将 closure 取消归为 U。 | 同 M14。 |

M14 是取消结果与原因丢失，**不等于已取消的 shell 仍执行**。真实 Run 的最终取消闭环见 STATIC；普通 package 不可读允许不展开，也不能据此把取消与普通不可读混为同一结果。

| 编号／级别／类别 | 实例、原因与后果 | 一种修复方向 |
|---|---|---|
| S01／建议／P4 | `execution-preparation.ts:248` 自行实现 Task reviews 全分页、任务筛选和游标规则。 | 提取一个共享 Task-review 全读函数，三个入口调用它。 |
| S01／建议／P4 | `context-assembler.ts:1383` 再实现同一分页；正式 prepare 已在 `execution-preparation.ts:492` 传入 taskReviews。 | 同 S01。 |
| S01／建议／P4 | `create-platform.ts:764` 又有 Task reviews 全分页；与另两处的循环守卫也不一致。 | 同 S01。 |
| S02／建议／P4 | `context-assembler.ts:1411` 对当前必填 blockedCommands 使用 `?? []`。 | 删除对已解码当前 record 的缺字段默认值。 |
| S02／建议／P4 | `context-assembler.ts:1443` 同样保留缺字段默认值。 | 同 S02。 |
| S02／建议／P4 | `continuation-brief-assembly.ts:333` 同样保留缺字段默认值。 | 同 S02。 |
| S02／建议／P4 | `decision-source-facts.ts:833` 同样保留缺字段默认值。 | 同 S02。 |
| S02／建议／P4 | `decision-read-model.ts:622` 同样保留缺字段默认值；当前 contract 在 `src/contracts/unknown-call-review.ts:288` 必填，decoder 在 `unknown-call-review-codecs.ts:520` 拒绝缺字段。 | 同 S02；不删除当前 brief/manifest 合法的可选字段。 |
| S03／建议／P4 | `src/contracts/continuation-brief.ts:509` 新建逐码点 UTF-8 截断，与 `context-assembler.ts:381` 同规则。 | 抽 contracts 层共享纯截断函数，各调用方保留自己的业务字节上限。 |
| S03／建议／P4 | `command-expansion.ts:69` 又实现同一截断规则。 | 同 S03。 |
| S03／建议／P4 | `command-rerun-request-service.ts:187` 再实现同一规则，并反复编码整个累积字符串。 | 同 S03。 |
| S04／建议／P4 | `decision-actions.ts:277` 再计算完整答复 identity 但只检查 null；`:261` 已验证同一 ref，helper `command-rerun-request-codecs.ts:407` 只有该解析失败才返回 null，两次之间没有 await。hash/key 未被使用。 | 删除 adapter 的第二次计算和不可达拒绝分支，identity 留给实际提交/重放 owner。 |
| S05／建议／P4 | `command-rerun-request-service.ts:614` 的 readTaskRequests 参数 ctx 在完整函数中未使用。 | 删除该参数及调用处对应实参。 |
| S06／建议／P4 | `command-rerun-request-card.ts:46` 的说明仍称 AggregateRef 不含 CRR，`:53` 保留 unknown 双重转换；当前 `src/contracts/ledger.ts:45` 已包含 CommandRerunRequestRef。 | 删除过期说明和多余类型转换。 |
| S07／建议／P4 | `execution-contracts.ts:339` 称缺 recognizer 作为“不可展开”，实际 `execution-driver.ts:525` 对缺依赖拦截。 | 将依赖注释改为缺接线失败关闭。 |
| S08／建议／P4 | `command-expansion.ts:41` 定义 words→text/hash 的动作比较键规则。 | 共用一个纯动作比较键函数，调用方不再重写 hash 配方。 |
| S08／建议／P4 | `command-recognition.ts:149` 的 shaOfWords 只转调 `:156` 的 commandKey，后者再次实现相同配方。 | 同 S08。 |
| S08／建议／P4 | `unknown-call-review-service.ts:234` 再实现 sha256(JSON.stringify(words))；`:232` 的 whole-text fallback 也可通过同一键函数构造。 | 同 S08。 |
| S09／建议／P4 | `command-rerun-request-service.ts:91` 的 isRecord 与 `codec-fields.ts:14` 重复。 | 复用已提取的通用字段纯函数。 |
| S09／建议／P4 | `command-rerun-request-service.ts:94` 的 nonEmpty 与 `codec-fields.ts:17` 重复。 | 同 S09。 |
| S09／建议／P4 | `command-rerun-request-service.ts:97` 的正安全整数检查与 `codec-fields.ts:30` 重复。 | 同 S09。 |
| S09／建议／P4 | `command-rerun-request-service.ts:100` 的 utf8Bytes 与 `codec-fields.ts:36` 重复。 | 同 S09。 |
| S09／建议／P4 | `command-rerun-request-service.ts:103` 的 codePoints 与 `codec-fields.ts:39` 重复。 | 同 S09。 |
| S09／建议／P4 | `revision-guard.ts:14` 再定义相同对象谓词。 | 同 S09。 |
| S10／建议／P4 | `decision-read-model.ts:280` 在 CRR facts 已形成后再读 Goal；CRR projector `:686` 不消费第三个 Goal 参数。 | 让已具备完整 facts 的 CRR source 跳过通用补读 Goal。 |
| S10／建议／P4 | `decision-read-model.ts:306` 的 byKey 路径有同一无用读取；新 CRR 在 `:709` 接上真实读口。 | 同 S10。 |
| S11／建议／P4 | `startup-reconcile.ts:31` 的 UnknownCallReviewRef 导入在当前生产文件中未使用。 | 删除无使用的类型导入。 |
| S11／建议／P4 | `startup-reconcile.ts:35` 的 SessionMessageRef 导入在当前生产文件中未使用。 | 同 S11。 |

**ALLOWLIST**

提供的 `.lead-ref/b3-stat.txt:49` 显示该文件 **318 行删除，没有新增行**；`.lead-ref/groups/A.txt:1` 只指定这个 allowlist 文件。因此，“B3 新增的 allowlist entry”集合为空，没有逐项 keep/remove 的新增条目。

当前副本没有 `.git`，也没有提供 allowlist 的基线 diff；不能据此重建被删除的全部条目名称。以下是本次 P4 检查发现仍留在当前文件中的旧条目，**不冒称它们由 B3 新增**。

| 当前 entry | 判断 | 理由 |
|---|---|---|
| `tests/architecture/production-reach-allowlist.json:1121`，OpenCommandRerunRequestForAliasInputV1 | remove，随 M12 接线一起删除 | `:1124` 的理由仍是“第 4 组接线”；owner 已在 `command-rerun-request-service.ts:826` 自写相同选择规则，没有使用该类型对应 helper。 |
| `tests/architecture/production-reach-allowlist.json:1127`，openRequestForAlias | remove，随 M12 接线一起删除 | `:1130` 的“第 4 组接线”承诺没有兑现；应复用 `state/command-rerun-request.ts:153`，不应以豁免保护重复规则。 |
| `tests/architecture/production-reach-allowlist.json:1133`，sameTask | remove，随 M12 接线一起删除 | `:1136` 同一过期理由；它是 `state/command-rerun-request.ts:160` 所调用的 helper。 |
| `tests/architecture/production-reach-allowlist.json:1139`，sameReviewRef | remove，随 M12 接线一起删除 | `:1142` 同一过期理由；它是 `state/command-rerun-request.ts:161` 所调用的 helper。 |

不建议因为详细 parser 已成为生产入口，就顺手删除公开 `parseShellActions`：`state/command-normalization.ts:515` 保留公开投影，任务书 `.lead-ref/k3-g4b3-impl.md:219` 要求保留公开接口。这与上面四项“应该接线却另写规则”的情况不同。

**STATIC claims**

以下是已核对的静态结论，不表示运行验证通过。

| 结论 | 证据及边界 |
|---|---|
| 正式路径共用 recognizer | `create-platform.ts:760` 创建一个实例，`:787` 注入 CRR owner，`:1189` 注入 Runtime；没有把请求工具和 hook 判成两套 matcher。 |
| 单纯 package 不可读允许局部退化 | `command-recognition.ts:85` 和 `command-expansion.ts:145` 明确留下不可展开结果；对应 `slice-K3-SPEC.md:481`。M02 针对整体识别失败，不针对此允许退化。 |
| 允许先提交 used，再放行 | `execution-driver.ts:500` 等 consumeAllowance，只有 committed 才继续；`command-rerun-request-service.ts:1123` 返回真实提交链，符合 `slice-K3-SPEC.md:531`。 |
| 真实 Run 取消仍会阻止 shell | `execution-driver.ts:1217` 传 controller.signal，`observed-model-run.ts:339` 传给 Kernel；`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:631` 在工具组前经过 barrier，`:275`、`:305` 检查停止，`:255` 保存取消终态。 |
| shell 还有执行前取消检查 | `vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js:48` 检查 signal；没有把 M02 描述成“用户取消后仍执行”。 |
| request 工具等待后取消不会最终显示成功 | `vendor/coding-agent/dist/tools/dispatcher/tool-dispatcher.js:130` 等 handler 后，`:140` 对父取消、`:143` 对工具超时覆盖最终结果；owner 无写分支的正常返回不能脱离该调用方判定。 |
| 工具未伪造 committed cursor | `command-rerun-tools.ts:188` 区分 committed/not_written，`:200` 使用提交结果；与 `src/contracts/core/results.ts:32` 的约束一致。 |
| pending/allowed 回复使用已存在请求命令 | `command-rerun-tools.ts:111`、`:117` 使用 owner outcome 中原请求的 command。 |
| 原命令正文来自 Kernel | `decision-read-model.ts:638`、`decision-source-facts.ts:848` 读 Kernel；正文缺失分别在 `decision-read-model.ts:647`、`decision-source-facts.ts:855` 拒绝，没有用请求命令或摘要替代。 |
| 卡片不重新展开 | `command-rerun-request-card.ts:165` 消费已存 match；`:171` 消费声明写法；卡片代码没有 package 读取入口。 |
| 卡片 pins 不含 Run | `command-rerun-request-card.ts:200` 只放请求、review、Goal，并在 `:205` 放 goalBases；因此 M10 的额外 Run 读取不能用 pins 辩护。 |
| Task closure 已共用 | `plan-readers.ts:1926` 先 satisfied，`:1930` 再 cancelled/superseded；新 CRR/UCR 消费方通过 `readTaskClosure` 使用同一规则。 |
| 回执重放已共用 | `receipt-replay.ts:110` 读取事件并检查失败，`:138` 返回实际 receipt cursor；Note 的不同错误文案不是第二套成功判定。 |
| 当前 CRR usedBy 不是旧格式 decoder | `command-rerun-request-codecs.ts:188` 校验当前 usedBy 形状；`state/command-rerun-request.ts:196` 写入消费 Run/call 信息，没有发现专为缺字段旧 CRR 加的迁移分支。 |
| 无阻止段时字段缺席属于当前格式 | `src/contracts/continuation-brief.ts:263` 与 `src/contracts/core/prepared-execution.ts:226` 的可选字段符合任务书 `.lead-ref/k3-g4b3-impl.md:240`；不能因决定 79 删除该可选性。 |
| binding 没有每 Task 32 条 cap | `execution-preparation.ts:302` 展平全部 review 的 blocked entries；`:309` 排序后全部返回。M08 是另一个分页总量限制。 |
| shell 当前 package 读取上限为 2 | `execution-driver.ts:534` 明确 maxPackageReads=2；与 `slice-K3-SPEC.md:482` 一致。 |
| brief 展示上限存在 | `src/contracts/continuation-brief.ts:390` 控制 16 行，`:534`、`:542`、`:545` 控制每种写法 160 字节、最多 3 种。 |
| brief 删除顺序符合任务书 | `src/contracts/continuation-brief.ts:411` 先处理 blocked 可选段，`:426` 涉及标题随最后一条移除；对应任务书 `.lead-ref/k3-g4b3-impl.md:245` 的补充。 |
| 必需固定句的条件正确 | `continuation-brief-assembly.ts:333` 根据本记录 blockedCommands 放字段；`src/contracts/continuation-brief.ts:934` 输出固定句。 |
| prepare/start 的明确失败不继续施工 | `workflow.ts:2415` 把 prepare 非 ready 转 waiting；`:2437` 对 start 非 ready 同样处理。 |
| U6 首答会校验来源和 pins | `src/core/work-graph/communication/decision-service.ts:824` 校验 exactPinSet，`:856` 保存规范 source；这不证明后续②时 goalBases 仍当前，见 OPEN。 |
| U6 重驱使用真实保存答复 | `decision-actions.ts:588` 读答复，`:598`、`:603` 核对 answerRef/selection；没有把调用方临时 selection 当正式答复。 |

以下是完整调用链中见到、但**本批没有新增该退路**的静态事实，不计上述 14 项。

| 既有实例 | 当前结果及范围 |
|---|---|
| `workflow.ts:1381` review 读取失败 | 被改为 skip；普通 Goal 在 `:1785` 可继续选其他任务，失败原因可能不再进入最终普通选择结果。 |
| `workflow.ts:1395` round Run 读取失败 | catch→null→skip；本批没有新增该读取退路。 |
| `workflow.ts:1440` UCR 答复读取失败 | 被改为 skip；不据此把 CRR 恢复缺口解释成已实现。 |
| `workflow.ts:1360` continuationHolder 失败 | `:1363` 回原 Run，随后 `:1815` 继续 claim；不是可靠的“已确认原 holder”。 |
| `workflow.ts:2656` maintenance 失败 | `:2662` 返回空数组，`:2818`、`:2830` 最终没有 maintenanceFailures；这是已有静默失败。 |
| `workflow.ts:1846` resume execution 非 ready | 绕过 resume 分支继续选择；本批没有改变该逻辑。 |
| `workflow.ts:1874` Session 非 ready | 转为 waiting，取消分类不能区分；既有逻辑。 |
| `collaboration-driver.ts:428` freshStart 读取失败 | `:432` 变 false，`:755` 文案把它解释为已进入/结束；既有逻辑。 |
| `collaboration-driver.ts:497` Goal 排序读取失败 | 返回原顺序；`:592` 的 throw 也有原顺序退路；本批只改 failed-card 接力。 |
| `startup-reconcile.ts:634` control 非 ready | 返回 false，`:422`、`:423` 可跳过对应控制，不记逐项读取失败；本批 CRR 扫描未改这里。 |
| `context-assembler.ts:1249` review 命令事实失败 | `:1255` 空 map 后使用记录摘要；`context-assembler.ts:425`、`:431` 是已有摘要与 truncated 处理，本轮不把它算成新增全文伪造。 |

**OPEN QUESTIONS**

这些项目不计 finding，也不替 lead 作产品决定。

| 问题 | 已知代码与规格 | 最小选项 |
|---|---|---|
| CRR ②是否必须重核当前 goalBases？ | CRR 在 `command-rerun-request-service.ts:985` 读当前 Goal 并检查 active，却没有按答复捕获的 basis 重核；UCR 在 `unknown-call-review-service.ts:1307` 有该检查。`slice-K3-SPEC.md:536` 写“照 L19 三步”，随后列 CRR 专门守卫。 | A：明确继承 T02，并共用当前 basis 守卫；B：明确 CRR 豁免该守卫。 |
| 16KiB 内放不下前 16 个动作时怎么退化？ | `unknown-call-review-service.ts:114` 先删 expansions，仍超限会把 actionCap 继续减到 0；`slice-K3-SPEC.md:487` 只写先丢末尾 expansion、再丢第 16 个以后的 action，没有定义“大动作本身仍超限”。 | A：允许进一步丢动作，并明确识别后果；B：规定保留比较键、裁剪展示信息的精确格式。 |
| 相同 createdAt 的“最新请求”如何定序？ | `context-assembler.ts:1447` 用跨聚合 revision 决定先后；任务书 `.lead-ref/k3-g4b3-impl.md:144` 只说 newest request。各请求自己的 revision 不等于创建先后。 | A：采用确定性的 requestRef 平局规则；B：采用正式记录的创建/声明顺序。 |
| 必需段刚好占满预算时是否允许省略提示消失？ | `src/contracts/continuation-brief.ts:499` 在提示本身放不下时只返回 head+suffix；B3 在 `:498` 把 blocked 省略数并入提示。未运行受支持极限事实来证明该边界是否可达。 | A：保证提示空间并规定其预算优先级；B：明确此极限情况允许无提示。 |
| Kernel 窗口到 64 页或游标停滞应返回什么？ | `context-assembler.ts:1195` 最多 64 页，`:1217` 不前进即退出并返回已收集 facts；CRR/UCR 新消费者对缺命令仍失败关闭，没有证实“缺全文仍成功写入”。 | A：保留有界读并明确 partial 语义；B：未读完时统一 unavailable。 |

**SEARCH LOG**

| 只读检查 | 方法与结果 |
|---|---|
| 差异清单 | 按 `.lead-ref/b3-src.diff` 的 `diff --git` 和 hunk 解析路径、变更位置；核对得到 47 个 src 文件、+5,080/−430。 |
| 输入文件 | 阅读裁定、coordinator 的返工说明 2–7、B3 实施书、返工 6/7/8，以及 K3 相关规格；按用户本轮明确范围检查 P5。 |
| 仓库入口 | 阅读 README、STATUS、HANDOFF 顶部和编排设计入口；没有重跑历史 completion audit。 |
| 搜索工具 | 先尝试环境中的 rg；不可用后用 Node `fs.readFile`/`fs.readdir` 只读搜索。没有载入或执行仓库 TypeScript。 |
| async 清单 | 对变更文件搜索 `await`，并追踪直接返回 Promise 的 owner/replay/forwarding；逐项查看 resolve 失败、throw、取消出口。 |
| CRR 识别 | 搜索 `createCommandRecognizer`、`recognize`、`rewriteOf`、`rewrite_of_mismatch`；检查共享实例、第一命中与指定目标的关系。 |
| CRR 恢复 | 搜索 `readUnappliedAnswers`、`readCommandRerunRequestAnswers`、`advanceReviewDisposition`、`answers`；追到启动、普通选择、交接和 HTTP 边界。 |
| 三步异常 | 从 `command-rerun-request-service.ts:985` 追到 `decision-actions.ts:546`、`workflow.ts:2911`、`create-platform.ts:1113`、`src/app/core-routes.ts:1133`、`src/app/server.ts:253`。 |
| 非 ready 来源 | 阅读 `unknown-call-review-service.ts:1436` 的完整 listReviews 和 `create-platform.ts:764` wrapper；确认多 tuple 水位不齐能真实产生 not_ready。 |
| 取消闭环 | 搜索 Kernel `signal.aborted`、before_tool、barrier、dispatcher；核对 history reader 的独立 cancelled 返回及 shell 最终停止检查。 |
| 旧接口 | 全 src 搜索 `failedReviewRefs`、`failedCardRefs`；旧字段只剩类型、投影、删除/拒绝代码，没有生产消费者。 |
| open 请求规则 | 全 src 搜索 `openRequestForAlias`、其输入类型和调用；确认生产 owner 另写两处 open 判断。 |
| 死返回字段 | 阅读 expandShellScripts 全函数及全部生产调用；确认 `.actions` 返回值无人消费。 |
| 卡片死输入 | 阅读 CRR card summary/facts 全函数，搜索 run 字段及两个调用方；确认多余 Run 读取只用于传死字段。 |
| 重复 helper | 搜索 UTF-8 截断、动作 hash、字段谓词、pinRevision、receipt replay；区分真正重复与 codec 必要边界检查。 |
| 当前格式 | 搜索 blockedCommands 缺字段默认、usedBy、schemaVersion；区分当前合法可选 brief/manifest 与已解码 record 的旧形状默认。 |
| allowlist | 阅读当前 allowlist、`.lead-ref/groups/A.txt` 和 `.lead-ref/b3-stat.txt:49`；未把旧条目冒称 B3 新增。 |
| 验证限制 | 未运行测试、构建、类型检查或真实模型；本报告的“可达”表示生产接线和静态分支证明，不表示运行复现。 |

P: files read 47/47; must-fix 14; suggestions 11