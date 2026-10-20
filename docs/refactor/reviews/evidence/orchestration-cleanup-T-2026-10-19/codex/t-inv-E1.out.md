E1 清点完成：**26 项候选，预计涉及约 466 行删除或改写**；其中 3 项为 `keep-note`，计 0 行。未写文件，未运行测试或构建，未联网。

清单中的 78 个文件均已检查：**16 个通读，62 个按测试名称、断言、夹具和相关实现抽查**。重复候选已在整个 `tests/` 树交叉检索。行数是施工规模估计，不是净删行承诺；不计区域外共享夹具的改动。

旧格式清理依据为 `docs/refactor/HANDOFF.md:565-569`，旧接口、重复和手写事实的处理依据为 `docs/refactor/HANDOFF.md:584-597`。下述“过时”指兼容要求应退场，**不表示对应生产分支已经删除**。

| 编号 | 类别 | 位置；测试名称 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---:|---|---|
| E1-01 | 过时 | `tests/app/MVP-ui-entry.test.ts:261-273`；`keeps display ids per scope and migrates only the explicit v1 scopeKey` 的迁移部分 | 手造 V1 存储并要求迁入当前格式；生产兼容入口在 `src/ui/state/display-preference.ts:106-137`。决定 79-1 已取消旧版本迁移要求。 | `delete`：仅删 V1 部分，随生产兼容分支清理 | 同测试 `tests/app/MVP-ui-entry.test.ts:239-259` 保留当前格式的 scope 隔离；`:276-323` 保留恢复和慢读取保护 | 13 | 否 | 高 |
| E1-02 | 过时 | `tests/app/S0-attention-edge-label.test.ts:21-64,68-96`；S0-01／02／03 | 夹具未提供 `readAttentionGraph`，落入旧 `queryTaskGraph` 分支；`src/app/attention-observer.ts:593-599,651-681` 明确区分新旧入口。`docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:595` 要求只走 assembler。 | `convert:当前图 owner/assembler.readAttentionGraph → createAttentionScanner`；保留三行的标签、kind 变化断言，不能直接把期望 edge 拼进返回值 | `tests/app/S3-attention-context.test.ts:300-333` 的 AT04 覆盖当前入口的标签变化、端点和渲染；`:462-479` 的 AT11 覆盖失败保护。S0 的 kind 变化仍须迁移保留 | 40 | 是 | 高 |
| E1-03 | 过时 | `tests/app/S2B-backfill-workflow.test.ts:67-89,236,242-244,255,259-261,352-385`；2B-18 的旧 Run 部分、2B-42 | `commitLegacyRun` 直接写没有定位记录、授权和 `startedAt` 的旧 Run；2B-42 专门要求兼容该形状。决定 79-1 取消这一旧数据要求。 | `delete`：删旧 Run 专项及仅供它们使用的本地 helper；保留 2B-18 的真实缺失、恢复和拒绝重试部分 | 旧格式要求已取消：`docs/refactor/HANDOFF.md:565-569`。当前恢复断言仍在 `tests/app/S2B-backfill-workflow.test.ts:256-287`；当前漏记行为在 `:290-329` | 65 | 是；旧行为例外 | 高 |
| E1-04 | 过时 | `tests/composition/platform.test.ts:79-83`；`public composition wires Host material and real workspace reads with narrow unsupported gaps` 的 N0 部分 | 只证明 N0 骨架返回 `unsupported`；`src/business/workflow/workflow.ts:810-818` 仍明确保留该骨架。决定 85-4 只明确“归 T”，不能据此声称已批准删除。 | `keep-note`：与生产区 N0 裁定联动，不能删整条组合测试 | 当前成功入口在 `tests/business/R5b-initial-planning-workflow.test.ts:247,286-320`，测试 `consumes the answer, adopts the candidate, then advances to a formal Goal completion`；这不等于覆盖旧 N0 拒绝契约 | 0 | 否 | 中 |
| E1-05 | 过时 | `tests/app/orchestration-mechanism.test.ts:181-187`；`normalizes the legacy replyMode=wait into the same single wait path` | `src/contracts/core/session-message.ts:37`、`src/core/agent-runtime/communication-tools.ts:318-319,417` 明确它只是旧等价输入；属于决定 79-4 的旧接口候选。 | `delete`：随 `replyMode` 兼容入口退出；消费者见 E1-06～09 | `tests/app/orchestration-mechanism.test.ts:169-178` 的显式字段等待测试；`:208-230` 的真实 mailbox 保存、读取和单次等待测试 | 7 | 否 | 高 |
| E1-06 | 过时 | `tests/app/A2-continuation-projection.test.ts:89`；TD-5 | 业务测试仍用 `replyMode: 'wait'` 生成等待，依赖 E1-05 的旧输入。 | `convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)`；保留 TD-5 全部行为断言 | 当前输入由 `tests/app/orchestration-mechanism.test.ts:169-178,208-230` 证明；本测试的暂停／恢复／取消投影仍保留 | 1 | 是 | 高 |
| E1-07 | 过时 | `tests/app/AG2b-collaboration.test.ts:167,169,390,487`；两轮咨询、busy 停止、重开只读三条测试 | 四处脚本消息依赖旧 `replyMode`。这些业务场景本身没有过时。 | `convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)` | 保留本文件 `:150`、`:382`、`:478` 三条原业务测试；当前字段契约见 `tests/app/orchestration-mechanism.test.ts:208-230` | 4 | 否 | 高 |
| E1-08 | 过时 | `tests/app/S5-decision-routes.test.ts:269`；RT07 | 路由绑定测试使用旧字段；真正要保护的是 `messages.sendMessage` 转发及不进入 `sendUserMessage`，断言在 `:271-274`。 | `convert:messages/send 使用 intent、needsReply、waitAfterSend` | 原 RT07 的转发断言继续保留；当前字段见 `src/contracts/core/session-message.ts:37-41` | 1 | 是 | 高 |
| E1-09 | 过时 | `tests/composition/WP2-wiring.test.ts:871`；F13 | 手造脚本参数仍为 `replyMode: 'wait'`；等待转移与回复接受行为仍有效。 | `convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)` | 保留 F13，尤其 `tests/composition/WP2-wiring.test.ts:955-979` 的转移、接受与通知消失断言 | 1 | 是 | 高 |
| E1-10 | 过时候选 | `tests/app/project-source-tool.test.ts:144-149,266-285`；`publishes one TS project protocol per trusted mode while retaining the full old wire and live stale checks` | 测试刻意维护旧 `project_index` wire、默认 legacy 模式和 oracle。生产注释也称其为既有调用方兼容：`src/core/agent-runtime/exploration-tools.ts:67-77`、`src/core/agent-runtime/observed-model-run.ts:79-88`。 | `keep-note`：由生产区先确认剩余 legacy 调用方的退出范围，再删旧 wire 专项及 oracle | 当前 `project_source` 在 `tests/app/project-source-tool.test.ts:154-202` 覆盖分页、冻结、verify 和 release；它与旧实时 wire 不等价，不能直接宣称完整替代 | 0 | 否 | 中 |
| E1-11 | 过时 | `tests/app/S2C-line-routes.test.ts:299-314`；2C-31(h) 的 D1 legacy L | D1 的 L 来自 `tests/helpers/S2C-L-line-support.ts:710-711`；该 helper 在 `:466-475` 直接编码并提交没有 provenance 的旧 Session。 | `keep-note`：与区域 F 的 D1/helper 清理同步；保留路由测试和其余当前 Session 场景 | 旧数据要求由 `docs/refactor/HANDOFF.md:565-569` 取消；当前路由转发断言仍在 `tests/app/S2C-line-routes.test.ts:301-321` | 0 | 是 | 高 |
| E1-12 | 重复 | `tests/app/A2-settings-automation.test.ts:95-104`；`a stored policy is read as stored and survives the next save` | 该测试断言读取、另一个设置保存后保留、重开后相同；`:125-143` 的公开保存流程做了相同断言。区别是旧测试取值为 `0/false`，流程测试为 `5/false`。 | `merge-into:tests/app/A2-settings-automation.test.ts::stores the whole policy, pushes it to the Host and publishes it; a reopened Host reads it back`；参数化保留 `0/false`，不能只删掉边界值 | 目标测试 `:129-143`；现有 0／10 保存边界在 `:144-147`，但应补入合并后的重开断言 | 12 | 否 | 高 |
| E1-13 | 重复 | `tests/app/RL-34-wiring-resource-caps.test.ts:101-112`；`RL-34 a saved setting reaches the Work shell and is read as bytes at execute` | 单次 shell 的 `EXPECTED_SAVED` 在 `:111`；后续同入口两次调用测试在 `:183-198` 首先断言同一个值，再断言新值。 | `merge-into:tests/app/RL-34-wiring-resource-caps.test.ts::RL-34 a Work reads the old value then the new value across two calls and its prepared execution carries no caps`；保留 RL-34 行归属 | 同文件 `:177-199`，尤其 `:198` | 12 | 是 | 高 |
| E1-14 | 重复 | `tests/app/RL-34-wiring-resource-caps.test.ts:155-175`；`RL-34 a saved setting reaches the workbench command page` | 手工组装 workbench 后断言保存值到达命令；完整 Host 流程已通过设置 HTTP 路由保存并运行命令，断言字节值及后续更新。 | `merge-into:tests/app/RL-44-host-restart-resource-caps.test.ts::RL-44 a live save reaches the next command through the production holder without a restart`；保留 RL-34 工作台入口映射 | `tests/app/RL-44-host-restart-resource-caps.test.ts:140-148` | 21 | 是 | 高 |
| E1-15 | 重复 | `tests/app/S8A-L8-auto-capture-gate.test.ts:502-524`；`retries the pending requests of the bound workspaces (sqlite)` | 直接调用 driver 的 `retryPending`，验证 A/B 的 seq=2、startup_retry、pending=false、捕获存在；完整 Host 重启测试具有同样前置场景和断言。 | `merge-into:tests/app/S8A-L8-host-close-restart.test.ts::K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)` | 目标 `:103-139`，相同断言在 `:125-131`。本地 `closeWithQueuedSecondCapture` 仍有其他使用者，不连带删除 | 23 | 是 | 高 |
| E1-16 | 重复 | `tests/app/S8A-L8-auto-capture-host.test.ts:168-185`；`the manual architecture/capture route still works (${backend})` | 两后端均在自动抓取后手动抓取，断言 committed、新 capture 和自动请求序号不变；watermark 正向用例逐项覆盖。 | `merge-into:tests/app/S8A-L8-http-watermark.test.ts::the same capture body without requestSeq still commits a real observation`；保留两后端 | `tests/app/S8A-L8-http-watermark.test.ts:60-82`，断言 `:68-80` | 18 | 是 | 高 |
| E1-17 | 重复 | `tests/app/S2C-line-routes.test.ts:166-170`；2C-31(d) | 单 Session 的 `routeList === reader.listWorkLines` 与 D1 数据集测试的同一转发断言重复；前者没有独有结果形状断言。 | `merge-into:tests/app/S2C-line-routes.test.ts::2C-31 (h) the routes return exactly the LE3 results over the 14-Session D1 dataset`；保留 (d) 行映射 | 同文件 `:301-302`。其余 fixture 仍供失败测试使用，不连带删 | 5 | 是 | 高 |
| E1-18 | 琐碎 | `tests/app/ui-refresh.test.ts:183-198`；`catches up every loop once, and the watches only when asked` | 直接调用 `catchUp(false/true)` 验证 loop/watch 次数；真实 SSE 连接流程已经验证 ready 只追赶 loops、不可恢复重连/reset 追赶 watches。 | `delete` | `tests/app/ui-live.test.ts:331-389`；`runs the loops on every ready, and the watches on reset or an unresumable reconnect only`，关键次数断言在 `:341-364,374-388` | 16 | 否 | 高 |
| E1-19 | 琐碎 | `tests/app/ui-store.test.ts:219-222`；`throws from state() while no scope is selected` | 直接测无 scope 异常；动作入口已有相同初态和同一异常文本断言。`src/ui/views/shell/actions.ts:31-33` 确认入口实际调用 `state()`。 | `delete` | `tests/app/ui-actions.test.ts:71-75`；`read the selected scope before the lookup, like the old switch` | 4 | 否 | 高 |
| E1-20 | 手写事实 | `tests/app/A2-host-instance-lease.test.ts:65,113-115`；HL-03 并发、K3-34 | 直接 JSON 写合法旧持有者的锁。公开获取入口已经存在，同文件 `:52-58` 已演示获取后模拟旧 PID 消失及接管。 | `convert:acquireHostInstanceLease → 模拟旧 PID 不存活 → contenders/takeover`；用返回的 instance ID，保留 release 清理 | `src/app/host-instance-lease.ts:113`；同文件 `:49-58` 是可复用生成步骤，不替代并发和证明标签断言 | 6 | 是 | 高 |
| E1-21 | 手写事实 | `tests/app/S2B-backfill-host.test.ts:146-148`；2B-20 | 直接写“另一活 Host 持锁”JSON，再测无租约不录制、不回填。 | `convert:acquireHostInstanceLease`；先真实持有，测试结束释放 | 公开入口 `src/app/host-instance-lease.ts:113`；保留原 `tests/app/S2B-backfill-host.test.ts:159-172` 行为断言 | 5 | 是 | 高 |
| E1-22 | 手写事实 | `tests/app/S2B-35-activity-routes.test.ts:200-204`；`startHost(lock)`，服务于 2B-35 无租约用例 | 用 raw JSON 制造合法竞争租约，公开 owner 能生成同一前置状态。 | `convert:acquireHostInstanceLease`；把 lease 纳入 fixture 清理 | `src/app/host-instance-lease.ts:113`；保留 `tests/app/S2B-35-activity-routes.test.ts:278-300` 的路由 busy 断言 | 5 | 是 | 高 |
| E1-23 | 手写事实 | `tests/app/S2B-r2-backfill-done-cursor.test.ts:44-65,80-88`；R9 | 两个 candidate 及 101 个 counted Run 依赖旧形状 raw seed；R9 的跨页 continuation 行为有效，不能删除。 | `convert:公开 Plan 创建/采用 → claim/enter/end → recordRunActivity`；建立 103 个当前格式 Run | 公开步骤已有：`tests/helpers/S2B-activity-fixture.ts:355-387,515-519,543-548`。现成 fixture 尚无 103-task 参数，需要扩展装配；保留原 `tests/app/S2B-r2-backfill-done-cursor.test.ts:98-114` | 35 | 是 | 中 |
| E1-24 | 手写事实 | `tests/composition/WP2-wiring.test.ts:129-139,767-772,934-935,1039-1050,1183-1184,1402-1403,1542-1543,1637-1638,1808-1822,1950-1951,2046-2047`；F09～F15 相关健康／reconcile 场景 | 把手造 `missing/ready/activeRunId` 直接交健康或 reconcile owner；真实写入并不使探测事实变真。相同问题已列入 T：`docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:91,104-105`。 | `convert:sessions.readSession → reconcile.probe → recordSessionHealth/reconcileRun/reconcileQuery`；missing/恢复从真实 Kernel 文件边界产生 | 公开 probe 在 `src/composition/create-platform.ts:2049-2068`；已有文件缺失／恢复夹具 `tests/helpers/A2-restart-fixture.ts:203-214`。保留 R/P 顺序、SES-13、失败原子性、重试及重开断言；不能一律换成完整 Host 重启而改变提交顺序 | 60 | 是 | 中 |
| E1-25 | 手写事实 | `tests/app/A2-runtime-capabilities.test.ts:244,262`；`says in the recoverRun reason that this Host has the setting automation.resumeOnStartup off...` | `writeAutomationSettings` 直接拼写配置文件：`tests/helpers/A2-restart-fixture.ts:217-224`。合法策略可由现有设置路由保存。 | `convert:automation/save → close → reopen`；仍分别测试持有／未持有租约 | `src/app/host-settings.ts:896`；SQLite 默认启用该目录见 `src/app/host.ts:324-329`；保存并重开示例 `tests/app/A2-settings-automation.test.ts:129-143` | 8 | 是 | 高 |
| E1-26 | 辅助 | `tests/app/support/S8A-L8-host.ts:32,58,177,295`；`Started`、`delay`、`StateReply`、`CaptureGateEntry` 的 export | 全 `tests/` 检索本模块导入，只有四处，均未导入这四个名字：`tests/app/S8A-L8-auto-capture-host.test.ts:13-17`、`S8A-L8-host-close-restart.test.ts:22-27`、`S8A-L8-host-restart.test.ts:18-21`、`S8A-L8-http-watermark.test.ts:15-18`。它们在模块内部仍被使用。 | `delete`：仅去掉四个无消费者的 `export`，保留定义和内部调用 | 内部使用在 `tests/app/support/S8A-L8-host.ts:127,180,189-194,297-299`；不是删除 helper 本身 | 4 | 否 | 高 |

同一清单的 JSON：

```json
[
  {
    "id": "E1-01",
    "category": "stale",
    "file": "tests/app/MVP-ui-entry.test.ts",
    "lines": ["261-273"],
    "tests": ["keeps display ids per scope and migrates only the explicit v1 scopeKey"],
    "evidence": "261-273 手造 V1 数据并验证迁移；src/ui/state/display-preference.ts:106-137 保留对应兼容入口。docs/refactor/HANDOFF.md:565-569 取消旧版本数据迁移要求。",
    "action": "delete",
    "covered_by": [
      "tests/app/MVP-ui-entry.test.ts:239-259::keeps display ids per scope and migrates only the explicit v1 scopeKey（保留当前格式部分）",
      "tests/app/MVP-ui-entry.test.ts:276-323::restores the original Goal/Session facts from formal reads and lets no slow read overwrite a later choice"
    ],
    "est_lines": 13,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-02",
    "category": "stale",
    "file": "tests/app/S0-attention-edge-label.test.ts",
    "lines": ["21-64", "68-96"],
    "tests": ["S0-01", "S0-02", "S0-03"],
    "evidence": "夹具未提供 readAttentionGraph，进入 src/app/attention-observer.ts:668-681 的旧 plans 分支；docs/refactor/design/orchestration-2026-10/slices/slice-3-SPEC.md:595 要求图部分只走 assembler。必须迁移标签和 kind 变化断言，不能把期望 edge 直接拼进新接口返回值。",
    "action": "convert:当前图 owner/assembler.readAttentionGraph → createAttentionScanner",
    "covered_by": [
      "tests/app/S3-attention-context.test.ts:300-333::AT04 reports the removed old edge and the added new edge with both endpoints locatable and no [object Object]",
      "tests/app/S3-attention-context.test.ts:462-479::AT11 keeps the old baseline and sends no full-graph deletion when the graph reader fails",
      "S0-03 的 kind 变化仍须迁移保留"
    ],
    "est_lines": 40,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-03",
    "category": "stale",
    "file": "tests/app/S2B-backfill-workflow.test.ts",
    "lines": ["67-89", "236", "242-244", "255", "259-261", "352-385"],
    "tests": [
      "2B-18 backfill writes unknown, retries the retryable reasons, and honours a rejected read（仅旧 Run 部分）",
      "2B-42 an old Run with no locator and no authorization is a candidate and backfills to unknown(no_history_locator)"
    ],
    "evidence": "67-89 的 commitLegacyRun 直接提交无定位记录、授权和 startedAt 的旧 Run。2B-42 专门保护该旧形状；docs/refactor/HANDOFF.md:565-569 已取消旧数据兼容要求。仅删除旧分支及本地专用 helper。",
    "action": "delete",
    "covered_by": [
      "旧格式兼容要求已取消：docs/refactor/HANDOFF.md:565-569",
      "tests/app/S2B-backfill-workflow.test.ts:256-287::2B-18（保留 Kernel 缺失、恢复及拒绝重试）",
      "tests/app/S2B-backfill-workflow.test.ts:290-329::2B-19"
    ],
    "est_lines": 65,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-04",
    "category": "stale",
    "file": "tests/composition/platform.test.ts",
    "lines": ["79-83"],
    "tests": ["%s: public composition wires Host material and real workspace reads with narrow unsupported gaps（N0 部分）"],
    "evidence": "只断言 N0 骨架 unsupported；src/business/workflow/workflow.ts:810-818 仍保留该契约。docs/refactor/HANDOFF.md:683 将 N0 归 T，但没有在该行批准删除。须联动生产区裁定，保留整条组合测试的其他行为。",
    "action": "keep-note",
    "covered_by": [
      "tests/business/R5b-initial-planning-workflow.test.ts:247,286-320::consumes the answer, adopts the candidate, then advances to a formal Goal completion",
      "当前成功流程不等于覆盖旧 N0 拒绝契约"
    ],
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-05",
    "category": "stale",
    "file": "tests/app/orchestration-mechanism.test.ts",
    "lines": ["181-187"],
    "tests": ["normalizes the legacy replyMode=wait into the same single wait path"],
    "evidence": "src/contracts/core/session-message.ts:37 与 src/core/agent-runtime/communication-tools.ts:318-319,417 明确 replyMode 只是旧等价输入；按 docs/refactor/HANDOFF.md:586,597 清理兼容入口。需同步迁移 E1-06 至 E1-09 的业务消费者。",
    "action": "delete",
    "covered_by": [
      "tests/app/orchestration-mechanism.test.ts:169-178::persists explicit intent/needsReply/waitAfterSend and registers exactly one real wait",
      "tests/app/orchestration-mechanism.test.ts:208-230::persists and reads back intent/needsReply/waitAfterSend through the real service"
    ],
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-06",
    "category": "stale",
    "file": "tests/app/A2-continuation-projection.test.ts",
    "lines": ["89"],
    "tests": ["TD-5: a paused yielded wait is blocked, a resumed one ready, a cancelled one failed; the Workflow claims neither stopped one"],
    "evidence": "89 的脚本消息依赖旧 replyMode 输入；TD-5 的投影和停止行为没有过时。",
    "action": "convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)",
    "covered_by": [
      "tests/app/orchestration-mechanism.test.ts:169-178,208-230::显式字段及真实 mailbox 流程",
      "保留 tests/app/A2-continuation-projection.test.ts:82 起的 TD-5 原行为断言"
    ],
    "est_lines": 1,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-07",
    "category": "stale",
    "file": "tests/app/AG2b-collaboration.test.ts",
    "lines": ["167", "169", "390", "487"],
    "tests": [
      "releases a busy B, runs two wait rounds and completes the real Task/Goal",
      "waits while B is busy, creates no replacement Session and confirms the stop through the real Run",
      "reopens read-only over the original messages/Query/history and refuses another scope"
    ],
    "evidence": "四处脚本消息依赖旧 replyMode。只迁移输入，保留两轮咨询、busy 停止及重开只读场景。",
    "action": "convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)",
    "covered_by": [
      "tests/app/orchestration-mechanism.test.ts:208-230::persists and reads back intent/needsReply/waitAfterSend through the real service",
      "保留本文件 150、382、478 起的三条业务测试"
    ],
    "est_lines": 4,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-08",
    "category": "stale",
    "file": "tests/app/S5-decision-routes.test.ts",
    "lines": ["269"],
    "tests": ["RT07 messages/send keeps the old SessionRef binding and never enters sendUserMessage"],
    "evidence": "269 使用旧 replyMode；271-274 真正保护的是 messages.sendMessage 转发及不调用 decisionMessages.sendUserMessage。",
    "action": "convert:messages/send 使用 intent、needsReply、waitAfterSend",
    "covered_by": [
      "tests/app/S5-decision-routes.test.ts:271-274::RT07 原转发断言",
      "src/contracts/core/session-message.ts:37-41::当前通信字段"
    ],
    "est_lines": 1,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-09",
    "category": "stale",
    "file": "tests/composition/WP2-wiring.test.ts",
    "lines": ["871"],
    "tests": ["F13 [%s] the real responsible link and wait transfer keep the notice; a successor execution accepting the reply removes it"],
    "evidence": "871 的发送脚本依赖旧 replyMode；955-979 的等待转移、回复接受和通知消失仍是有效业务行为。",
    "action": "convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)",
    "covered_by": [
      "保留 tests/composition/WP2-wiring.test.ts:955-979::F13",
      "tests/app/orchestration-mechanism.test.ts:208-230::当前显式字段真实 mailbox 流程"
    ],
    "est_lines": 1,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-10",
    "category": "stale",
    "file": "tests/app/project-source-tool.test.ts",
    "lines": ["144-149", "266-285"],
    "tests": ["publishes one TS project protocol per trusted mode while retaining the full old wire and live stale checks"],
    "evidence": "测试维护 legacy_live、默认旧模式及旧 wire oracle。src/core/agent-runtime/exploration-tools.ts:67-77、src/core/agent-runtime/observed-model-run.ts:79-88 说明其兼容用途；剩余生产调用方的退出范围尚须生产区确认。",
    "action": "keep-note",
    "covered_by": [
      "tests/app/project-source-tool.test.ts:154-202::当前 project_source 分页、冻结、verify 和 release 流程",
      "当前冻结协议与旧实时 wire 不等价，不能据此直接删除旧模式测试"
    ],
    "est_lines": 0,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "E1-11",
    "category": "stale",
    "file": "tests/app/S2C-line-routes.test.ts",
    "lines": ["299-314"],
    "tests": ["2C-31 (h) the routes return exactly the LE3 results over the 14-Session D1 dataset（legacy L 部分）"],
    "evidence": "tests/helpers/S2C-L-line-support.ts:710-711 创建 L；466-475 直接编码提交无 provenance 的旧 Session。按 docs/refactor/HANDOFF.md:565-569 应退场，但 D1 是跨区域共享规格夹具。",
    "action": "keep-note",
    "covered_by": [
      "旧数据兼容要求已取消：docs/refactor/HANDOFF.md:565-569",
      "保留 tests/app/S2C-line-routes.test.ts:301-321 的当前路由断言，随区域 F 更新 D1 和行映射"
    ],
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-12",
    "category": "duplicate",
    "file": "tests/app/A2-settings-automation.test.ts",
    "lines": ["95-104"],
    "tests": ["a stored policy is read as stored and survives the next save"],
    "evidence": "99-103 的读取、其他设置保存后保留和重开断言由125-143公开保存流程覆盖；原值为0/false，目标为5/false，合并时必须参数化保留0/false及重开检查。144-147只有保存边界断言，不足以代替该重开检查。",
    "action": "merge-into:tests/app/A2-settings-automation.test.ts::stores the whole policy, pushes it to the Host and publishes it; a reopened Host reads it back",
    "covered_by": [
      "tests/app/A2-settings-automation.test.ts:125-149::stores the whole policy, pushes it to the Host and publishes it; a reopened Host reads it back"
    ],
    "est_lines": 12,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-13",
    "category": "duplicate",
    "file": "tests/app/RL-34-wiring-resource-caps.test.ts",
    "lines": ["101-112"],
    "tests": ["RL-34 a saved setting reaches the Work shell and is read as bytes at execute"],
    "evidence": "111 的 EXPECTED_SAVED 断言已包含在177-199同一Work shell两次调用流程中；198同时断言旧值与新值。保留RL-34规格行归属。",
    "action": "merge-into:tests/app/RL-34-wiring-resource-caps.test.ts::RL-34 a Work reads the old value then the new value across two calls and its prepared execution carries no caps",
    "covered_by": [
      "tests/app/RL-34-wiring-resource-caps.test.ts:177-199::RL-34 a Work reads the old value then the new value across two calls and its prepared execution carries no caps"
    ],
    "est_lines": 12,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-14",
    "category": "duplicate",
    "file": "tests/app/RL-34-wiring-resource-caps.test.ts",
    "lines": ["155-175"],
    "tests": ["RL-34 a saved setting reaches the workbench command page"],
    "evidence": "168-174通过手工装配的workbench命令验证保存值；tests/app/RL-44-host-restart-resource-caps.test.ts:140-148通过完整Host设置路由及命令流程验证相同传递，并验证下一次保存生效。",
    "action": "merge-into:tests/app/RL-44-host-restart-resource-caps.test.ts::RL-44 a live save reaches the next command through the production holder without a restart",
    "covered_by": [
      "tests/app/RL-44-host-restart-resource-caps.test.ts:132-149::RL-44 a live save reaches the next command through the production holder without a restart"
    ],
    "est_lines": 21,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-15",
    "category": "duplicate",
    "file": "tests/app/S8A-L8-auto-capture-gate.test.ts",
    "lines": ["502-524"],
    "tests": ["retries the pending requests of the bound workspaces (sqlite)"],
    "evidence": "508直接驱动retryPending；511-517断言A/B的seq=2、startup_retry、pending=false和捕获存在。真实Host重启测试125-131做相同断言。470-499的helper仍有其他消费者，不计入删除。",
    "action": "merge-into:tests/app/S8A-L8-host-close-restart.test.ts::K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)",
    "covered_by": [
      "tests/app/S8A-L8-host-close-restart.test.ts:103-139::K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)"
    ],
    "est_lines": 23,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-16",
    "category": "duplicate",
    "file": "tests/app/S8A-L8-auto-capture-host.test.ts",
    "lines": ["168-185"],
    "tests": ["the manual architecture/capture route still works (${backend})"],
    "evidence": "179-183验证手动抓取committed、新capture及自动请求序号不变；tests/app/S8A-L8-http-watermark.test.ts:68-80覆盖同样两后端场景及断言。",
    "action": "merge-into:tests/app/S8A-L8-http-watermark.test.ts::the same capture body without requestSeq still commits a real observation",
    "covered_by": [
      "tests/app/S8A-L8-http-watermark.test.ts:60-82::the same capture body without requestSeq still commits a real observation"
    ],
    "est_lines": 18,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-17",
    "category": "duplicate",
    "file": "tests/app/S2C-line-routes.test.ts",
    "lines": ["166-170"],
    "tests": ["2C-31 (d) lines/list returns exactly the LE3 WorkLineReadPort value"],
    "evidence": "167-169的routeList等于reader.listWorkLines断言，由301-302的D1场景重复覆盖；原测试没有独有结果形状断言。保留(d)行映射，其他测试仍使用其fixture。",
    "action": "merge-into:tests/app/S2C-line-routes.test.ts::2C-31 (h) the routes return exactly the LE3 results over the 14-Session D1 dataset",
    "covered_by": [
      "tests/app/S2C-line-routes.test.ts:299-323::2C-31 (h) the routes return exactly the LE3 results over the 14-Session D1 dataset"
    ],
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-18",
    "category": "trivial",
    "file": "tests/app/ui-refresh.test.ts",
    "lines": ["183-198"],
    "tests": ["catches up every loop once, and the watches only when asked"],
    "evidence": "194、197直接检查catchUp后的loop/watch次数；tests/app/ui-live.test.ts:341-364,374-388已通过ready、重连、reset和coalesced change检查这些行为。",
    "action": "delete",
    "covered_by": [
      "tests/app/ui-live.test.ts:331-389::runs the loops on every ready, and the watches on reset or an unresumable reconnect only"
    ],
    "est_lines": 16,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-19",
    "category": "trivial",
    "file": "tests/app/ui-store.test.ts",
    "lines": ["219-222"],
    "tests": ["throws from state() while no scope is selected"],
    "evidence": "220-221的空scope及异常文本由tests/app/ui-actions.test.ts:72-74覆盖；src/ui/views/shell/actions.ts:31-33证明动作入口实际调用同一state()。",
    "action": "delete",
    "covered_by": [
      "tests/app/ui-actions.test.ts:71-75::read the selected scope before the lookup, like the old switch"
    ],
    "est_lines": 4,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "E1-20",
    "category": "handwritten",
    "file": "tests/app/A2-host-instance-lease.test.ts",
    "lines": ["65", "113-115"],
    "tests": [
      "HL-03 is exclusive: two Hosts starting together on one stale lock leave exactly one owner, whose lock stays in place",
      "K3-34 labels the takeover proof: HL-01, HL-03 (old instance id and pid), memory, and null when held"
    ],
    "evidence": "65和113手写合法锁JSON。公开acquireHostInstanceLease已存在；同文件52-58展示先获取、再模拟旧PID消失并接管的路径。改用返回的instance ID并保留release清理。",
    "action": "convert:acquireHostInstanceLease → 模拟旧 PID 不存活 → contenders/takeover",
    "covered_by": [
      "src/app/host-instance-lease.ts:113::acquireHostInstanceLease",
      "tests/app/A2-host-instance-lease.test.ts:49-58::HL-03 takes over a lock whose pid is gone; the old instance can no longer remove it (HL-06)",
      "保留原并发及K3-34断言"
    ],
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-21",
    "category": "handwritten",
    "file": "tests/app/S2B-backfill-host.test.ts",
    "lines": ["146-148"],
    "tests": ["2B-20 a Host without the instance lease writes no recording and no backfill"],
    "evidence": "手写活跃peer的锁JSON；src/app/host-instance-lease.ts:113的公开获取入口能生成该前置状态。测试结束释放真实lease。",
    "action": "convert:acquireHostInstanceLease",
    "covered_by": [
      "src/app/host-instance-lease.ts:113::acquireHostInstanceLease",
      "保留 tests/app/S2B-backfill-host.test.ts:159-172::2B-20 行为断言"
    ],
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-22",
    "category": "handwritten",
    "file": "tests/app/S2B-35-activity-routes.test.ts",
    "lines": ["200-204"],
    "tests": ["startHost(lock)；2B-35 无租约路由用例"],
    "evidence": "startHost以raw JSON制造合法竞争租约。公开acquireHostInstanceLease可生成同一状态，需把lease纳入fixture清理。",
    "action": "convert:acquireHostInstanceLease",
    "covered_by": [
      "src/app/host-instance-lease.ts:113::acquireHostInstanceLease",
      "保留 tests/app/S2B-35-activity-routes.test.ts:278-300 的busy断言"
    ],
    "est_lines": 5,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-23",
    "category": "handwritten",
    "file": "tests/app/S2B-r2-backfill-done-cursor.test.ts",
    "lines": ["44-65", "80-88"],
    "tests": ["R9 the batch-full probe keeps a non-null continuation instead of declaring done"],
    "evidence": "两个candidate和101个counted Run依赖旧形状raw seed。跨页continuation行为仍有效。tests/helpers/S2B-activity-fixture.ts:355-387,515-519,543-548已有公开Plan、Run生命周期和活动写入步骤，但现成fixture没有103-task参数，需要扩展装配。",
    "action": "convert:公开 Plan 创建/采用 → claim/enter/end → recordRunActivity",
    "covered_by": [
      "tests/helpers/S2B-activity-fixture.ts:355-387::proposePlan/applyPlanChange",
      "tests/helpers/S2B-activity-fixture.ts:515-519::runAndEnd",
      "tests/helpers/S2B-activity-fixture.ts:543-548::recordRunActivity",
      "保留 tests/app/S2B-r2-backfill-done-cursor.test.ts:98-114::R9"
    ],
    "est_lines": 35,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-24",
    "category": "handwritten",
    "file": "tests/composition/WP2-wiring.test.ts",
    "lines": [
      "129-139", "767-772", "934-935", "1039-1050", "1183-1184",
      "1402-1403", "1542-1543", "1637-1638", "1808-1822",
      "1950-1951", "2046-2047"
    ],
    "tests": [
      "F09 reply after unavailable",
      "F10 reply before unavailable、Work reconcile、Query recovery、Work recognition",
      "F11 same-cursor notices",
      "F12 SES-13 recovery",
      "F13 responsible link and wait transfer",
      "F14 Work reply、user answer、Query Answer",
      "F15 failed reply or health commit"
    ],
    "evidence": "直接把手造missing/ready/activeRunId交健康或reconcile owner。src/composition/create-platform.ts:2049-2068已有真实probe及后续入口；tests/helpers/A2-restart-fixture.ts:203-214已有真实Kernel文件缺失/恢复夹具。同类债务见docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:91,104-105。必须保留R/P提交顺序、SES-13、失败原子性及重开断言，不能用统一Host重启改变场景。",
    "action": "convert:sessions.readSession → reconcile.probe → recordSessionHealth/reconcileRun/reconcileQuery",
    "covered_by": [
      "src/composition/create-platform.ts:2049-2068::公开probe和健康/reconcile入口",
      "tests/helpers/A2-restart-fixture.ts:203-214::moveKernelAside/restoreKernel",
      "保留原F09至F15的业务断言"
    ],
    "est_lines": 60,
    "spec_row": true,
    "confidence": "中"
  },
  {
    "id": "E1-25",
    "category": "handwritten",
    "file": "tests/app/A2-runtime-capabilities.test.ts",
    "lines": ["244", "262"],
    "tests": ["says in the recoverRun reason that this Host has the setting automation.resumeOnStartup off, with or without the instance lease (LA-6, L-10)"],
    "evidence": "两处writeAutomationSettings调用经tests/helpers/A2-restart-fixture.ts:217-224直接拼配置JSON。src/app/host-settings.ts:896已有automation/save；src/app/host.ts:324-329证明SQLite默认启用设置目录。",
    "action": "convert:automation/save → close → reopen",
    "covered_by": [
      "tests/app/A2-settings-automation.test.ts:129-143::公开保存并重开示例",
      "保留 tests/app/A2-runtime-capabilities.test.ts:248-268 的有/无租约及能力说明断言"
    ],
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "E1-26",
    "category": "helper",
    "file": "tests/app/support/S8A-L8-host.ts",
    "lines": ["32", "58", "177", "295"],
    "tests": ["Started、delay、StateReply、CaptureGateEntry 的导出"],
    "evidence": "全tests树本模块只有四处导入，均不导入这四个名字：tests/app/S8A-L8-auto-capture-host.test.ts:13-17、tests/app/S8A-L8-host-close-restart.test.ts:22-27、tests/app/S8A-L8-host-restart.test.ts:18-21、tests/app/S8A-L8-http-watermark.test.ts:15-18。定义仍被模块内部使用，仅删除export修饰符。",
    "action": "delete",
    "covered_by": [
      "tests/app/support/S8A-L8-host.ts:127,180,189-194,297-299::保留内部类型和调用"
    ],
    "est_lines": 4,
    "spec_row": false,
    "confidence": "高"
  }
]
```

分类合计：

| 类别 | 项数 | 预计删除或改写行数 |
|---|---:|---:|
| stale／过时 | 11 | 132 |
| duplicate／重复 | 6 | 91 |
| trivial／琐碎 | 2 | 20 |
| handwritten／手写事实 | 6 | 119 |
| tamper／只为篡改 | 0 | 0 |
| helper／辅助 | 1 | 4 |
| **总计** | **26** | **466** |

以下边界没有列作删除项：

- `LEGACY_FILE` 这个名字本身不足以证明设置测试过时。当前写入仍允许 `automation/resourceCaps` 缺省；见 `src/app/host-settings.ts:291-297,471,512-513`。因此 `tests/app/A2-settings-automation.test.ts:86-93` 和 `tests/app/RL-40-43-resource-cap-settings.test.ts:131-143` 没有按旧格式测试整段删除。
- 坏锁、坏设置文件属于真实文件边界，保留：`tests/app/A2-host-instance-lease.test.ts:122-135`、`tests/app/A2-settings-automation.test.ts:106-115`、`tests/app/host-settings.test.ts:230-245`。
- `legacy_template` 仍是当前角色配置，不因名称清理；决定明确排除它：`docs/refactor/HANDOFF.md:597`。
- 内存／SQLite 两后端不能因为断言相似而合成单后端；依据 `docs/refactor/HANDOFF.md:683`。E1-16 的合并要求保留两后端。
- 没有删除历史展示、未来任务或停止／恢复行为。相关独有断言例如 `tests/app/R6-workbench.test.ts:353-368,418-425` 和 `tests/app/R6-host.test.ts:889-955`。
- E1-04 的 N0、E1-10 的旧源码模式、E1-11 的共享 D1 需要跨区域裁定；E1-23、E1-24 的转换存在具体公开入口，但没有通过本轮运行验证其改装成本。全部候选仍需 lead 审阅。

阅读覆盖如下。路径后 `:1` 是文件入口；“通读”与“抽查”不混计。

通读 **16 个**：

- `tests/app/A2-host-instance-lease.test.ts:1`
- `tests/app/A2-settings-automation.test.ts:1`
- `tests/app/RL-44-host-restart-resource-caps.test.ts:1`
- `tests/app/S0-attention-edge-label.test.ts:1`
- `tests/app/S2B-backfill-host.test.ts:1`
- `tests/app/S2B-backfill-workflow.test.ts:1`
- `tests/app/S2B-r2-backfill-done-cursor.test.ts:1`
- `tests/app/S2B-r2-backfill-real-kernel.test.ts:1`
- `tests/app/S8A-L8-host-close-restart.test.ts:1`
- `tests/app/S8A-L8-host-restart.test.ts:1`
- `tests/app/change-feed.test.ts:1`
- `tests/app/change-stream.test.ts:1`
- `tests/app/support/S8A-L8-host.ts:1`
- `tests/app/ui-live-wiring.test.ts:1`
- `tests/app/ui-refresh.test.ts:1`
- `tests/composition/platform.test.ts:1`

抽查 **62 个**；检查了测试目录、关键断言及可疑 fixture，报告候选处另行展开上下文：

- `tests/app/A2-automation-verdict.test.ts:1`
- `tests/app/A2-continuation-projection.test.ts:1`
- `tests/app/A2-requeue-route.test.ts:1`
- `tests/app/A2-reverify-route.test.ts:1`
- `tests/app/A2-runtime-capabilities.test.ts:1`
- `tests/app/A2-startup-redrive-select.test.ts:1`
- `tests/app/AG2-consultation.test.ts:1`
- `tests/app/AG2b-collaboration.test.ts:1`
- `tests/app/AG6-agent-assembly.test.ts:1`
- `tests/app/K-R-runtime-capabilities.test.ts:1`
- `tests/app/K3-15-review-routes.test.ts:1`
- `tests/app/K3-19-review-capability-host.test.ts:1`
- `tests/app/MVP-ui-entry.test.ts:1`
- `tests/app/MVP-workbench-tools.test.ts:1`
- `tests/app/R6-host.test.ts:1`
- `tests/app/R6-workbench.test.ts:1`
- `tests/app/RL-33-workbench-resource-caps.test.ts:1`
- `tests/app/RL-34-wiring-resource-caps.test.ts:1`
- `tests/app/RL-40-43-resource-cap-settings.test.ts:1`
- `tests/app/S1-session-routes.test.ts:1`
- `tests/app/S2A-decision-routes.test.ts:1`
- `tests/app/S2B-35-activity-routes.test.ts:1`
- `tests/app/S2B-41-decision54-backfill-bound.test.ts:1`
- `tests/app/S2B-be2-late-evidence-activity.test.ts:1`
- `tests/app/S2B-be2-run09-activity.test.ts:1`
- `tests/app/S2B-be2-run18-activity.test.ts:1`
- `tests/app/S2B-be2-run23-activity.test.ts:1`
- `tests/app/S2B-be2-startup-reconcile-activity.test.ts:1`
- `tests/app/S2B-r2-backfill-identity.test.ts:1`
- `tests/app/S2B-r2-backfill-probe-first.test.ts:1`
- `tests/app/S2B-r2-backfill-revision-race.test.ts:1`
- `tests/app/S2B-r2-r6-probe-verdicts.test.ts:1`
- `tests/app/S2C-line-routes.test.ts:1`
- `tests/app/S3-attention-context.test.ts:1`
- `tests/app/S3-graph-routes.test.ts:1`
- `tests/app/S4C-note-routes.test.ts:1`
- `tests/app/S4C-record-note-host.test.ts:1`
- `tests/app/S4C2-scribe-reminders.test.ts:1`
- `tests/app/S5-decision-routes.test.ts:1`
- `tests/app/S5R2-driver-safe-point.test.ts:1`
- `tests/app/S8A-L8-auto-capture-gate.test.ts:1`
- `tests/app/S8A-L8-auto-capture-host.test.ts:1`
- `tests/app/S8A-L8-capture-start.test.ts:1`
- `tests/app/S8A-L8-http-watermark.test.ts:1`
- `tests/app/S8A-architecture-routes.test.ts:1`
- `tests/app/change-commit-observer.test.ts:1`
- `tests/app/change-emitters.test.ts:1`
- `tests/app/exploration-tools.test.ts:1`
- `tests/app/goal-conversation-start.test.ts:1`
- `tests/app/goal-fan-out-driver.test.ts:1`
- `tests/app/host-settings.test.ts:1`
- `tests/app/orchestration-mechanism.test.ts:1`
- `tests/app/project-source-tool.test.ts:1`
- `tests/app/reviewer-source-tools.test.ts:1`
- `tests/app/session-rendering.test.ts:1`
- `tests/app/settings-ui.test.ts:1`
- `tests/app/ui-actions.test.ts:1`
- `tests/app/ui-change-refetch.test.ts:1`
- `tests/app/ui-live.test.ts:1`
- `tests/app/ui-sse.test.ts:1`
- `tests/app/ui-store.test.ts:1`
- `tests/composition/WP2-wiring.test.ts:1`