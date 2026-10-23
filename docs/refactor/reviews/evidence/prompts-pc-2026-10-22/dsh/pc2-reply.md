# PC-2 回复（2026-10-22 夜）

## 1. 疑问

1. **§5.3 漏了受裁定 15 的 57 字节影响的旧测试**（不在白名单，未改）：`tests/runtime/K3-15-blocked-omission`（4 个，断言整体大 57）、`K3-35-T-by-hand`（4）、`K3-35-approved-methods-brief`（2）。另有 `tests/app/AG6-agent-assembly`、`tests/runtime/C2-runtime-platform-tools` 的 “three deployed skills” 把 v2 Skill 模板原文（含 `{{#tool:}}`）当期望，而裁定 18 要求按最终工具表渲染。
2. **裁定 16 把未知授权的拒绝提到 prepare**：`requeue_task`/`reverify_round` 在 prepare 即 `unsupported`。旧测试仍期待 prepare ready、start 拒绝：`C2` GAP-46、`invariants-fuzz` seeds 4/14/16/23/43、`A2-requeue-service`、`R3e-reverify`、`S5-notices`。不在白名单，未改。
3. 冻结的 `openPC2QueryHistoryFixture` 不可用：Workflow 调 Runtime 对象的 `startQuery`，spy 的 port 捕不到；Query-with-basis 的执行半边未覆盖（纯规则覆盖 C7）。`openPC2ReviewFixture('empty')` 因 `k3.none:''` 触发 required slot empty → `invalid`，joint 只用 `shrink`。
4. `PC2-pack-fixture` 的 `section-extra` 先被 parser 的“未声明槽”拒绝，resolver 的“section 不属于模板”分支不可达；测试按 parser 字面断言。

## 2. 摘要

按书序完成 A →（W、T、H）→（G、Q）→ joint。A 冻结 `resolvePromptPackV1`、`PromptSetV1.toolNames/tools`、扩展 `origins`+`toolOrigins`、`PromptRenderError`；T 出 platform pack v2（base/Skill 工具块、work-input 顺序、stale-files-reminder、白板参数）与渲染材料；H 实现磁盘包源、六条设置路由、目录/链接边界与模型中 `promptPack`/`reasoningReplay`；W 改十处逐工具回退；G 让守卫读 `binding.sectionOrder` 并做区间相等+唯一出现；Q 冻结最终工具表、工具正文、历史判定和 review 收缩；joint 走公开路由/准备/启动覆盖 PC-03/04/05/06/08/18/20/21/26。生产与本轮新增/修改测试全绿；只有 bwrap 环境失败与上述书漏项、以及一处故意的历史游标放宽（§8）不在绿列。

## 3. 逐裁定、逐行（RED → GREEN，括号内为捕捉的变异）

- **A**：PC-01 `PC2-tool-blocks`（工具块总渲染）；PC-02 `PC2-resolve-pack` 50 个坏包各一条/多条字面 reason（`report` 置空）；PC-03 `base` 只覆盖子包（跳过 chain[0]）；PC-22 role-not-first（删 role-first 检查）；PC-25 `toolOrigins`（恒为 platform），另 shell/空描述/缺键/多键各一问题；codec（删 `toolNames/tools` 必填项、删排序检查）。
- **H**：PC-23 `PC2-H-directory-checks` 10 例（关掉 `assertRootOutsidePrompts` → 8 红）；PC-04 `PC2-H-pack-routes` 10（版本不 +1；跳过整包校验 → 字节变）；PC-25 `PC2-H-tool-routes` 4（digest=expected）；PC-05 `PC2-H-settings-model` 2（省略保存时保留旧包）。
- **W**：`PC2-W-*` 10 文件 28 例（整对象默认、忽略 texts、断掉透传、白板 pin 改读 `strings` → 13 红）。
- **T**：PC-18/20/21 `PC2-T-render`（去 role 末尾提醒；Skill 传错工具表；`residentBytes:=0`、重渲染少 `+2`）；PC-19 `PC2-platform-scan`（解包 Skill 句 → outside `[check,find_graph,look_graph]` vs `[]`）；`PC-platform-pack-v2` 重钉 v2 摘要/Skill 字节相等。
- **G**：PE9 `PC2-G-entry-guard` 4（删 `utf8Slice` 比较、删 `lastIndexOf`、恢复“必须最后”）；`PC2-G-context-order` 7（role-first/合法名/重复/顺序各一变异）；I-19 改按绑定区间。
- **Q**：PC-18 `PC2-history-decision-pure` 6（去掉 basis 的 cursor 条件）；PC-19 `PC2-declaration-prepare`（删声明拒绝）；PC-21 `PC2-review-shrink`（用旧 assembly 建 manifest）；PC-26 `PC2-tool-texts-freeze` 2（不存工具条目；只对 tool 正文 put 失败）。
- **joint**：PC-03/04/05/06/08/18/20/21/26 共 18 例（变异：`packId:chain[0]`、磁盘源记忆化、`promptSelectionOf` 强 platform、`trackPromptTexts` 固定 base、`sessionHistoryDecision` 忽略 `throughPosition`、prep 强加 `read`、`rerenderContextV1` 抄 residentBytes、`storePromptTexts` 丢工具条目）。

**旧测试改动及理由**：A 的 `PC-prompt-set-v1`（新必填字段+严格解码）；T 的 A2/K3-15/K3-35-renderer/S3-context-assembler/S4C2/S3-role-profiles/C3×3/A1/PC-prompt-section-order/PC-platform-pack-v2/PC-send-*（删简报句、工具表贯穿、v2 摘要）；H 的 S2B-backfill-host、S2B-35、S2B-r2 辅助（设置目录与工作区分开）；G 的 invariants(.test)/context-input ST08/WP1-goal-content/WP1-units-fixture/S3-prepared-context-admission/K3-35-owner/K3-unknown-call-review-section（sectionOrder、新必填 manifest 字段、去“最后”假设）；Q 的 PC-prompt-texts-store/K3-35-manifest-trim-pure/K3-review-preparation/PC-prepare-prompt-freeze/PC-read-record-work-query/PC-joint-prepare-freeze（同样机械补字段/改字面）；joint 的 PC-joint-budget-removal/PC-joint-record-and-failure/PC-prepare-review-freeze（57 字节简报句、set.tools 摘要、base v2）；`tests/state/invariants.ts` 与 I-19。无 `skip/todo/only`，无抬高旧上限。

## 4. 行数（新增/删除/合计；预算见书 §6）

| 组 | + | − | 合计 | 预算 |
| --- | ---: | ---: | ---: | ---: |
| A | 903 | 21 | 924 | 1,150 |
| W | 401 | 183 | 584 | 519 |
| T | 1,002 | 253 | 1,255 | 1,190 |
| H | 1,417 | 29 | 1,446 | 2,190 |
| G | 413 | 101 | 514 | 930 |
| Q | 1,054 | 237 | 1,291 | 1,160 |
| joint | 811 | 6 | 817 | — |
| **合计** | **5,967** | **796** | **6,763** | **7,139** |

## 5. 裁定 16 工具表函数的输入

`callKind: 'work' | 'query'`；`selected`（manifest.permissions.tools）；`readOnly`；`reviewPhase: 'review' | 'proposal' | null`；`hasBlockedCommands`（manifest.blockedCommands 非空）；`reviewSource`（sourceTools.includeReadSource，独立于 frozenSource）；`frozenSource`（projectSource.mode==='frozen'）；`materialTools`；`owners.{mailbox,decisionMessages,applicationReceipt,sessions,plans,graph,notes,unknownCallReviews,commandRerunRequests}`；`readonlyCommand.{requested, access, allowsReadWholeWorkspace}`。输出 `ToolGroupResult<string[]>`，先拒绝后数组，顺序照 `kernelEnabledToolNames`，绝不排序。

## 6. 检查与测试

检查（最后一次全量，`af84802` 前）：`build-kernel-patch --check` 0；`build-platform-prompts --check` 0；`typecheck` 0 错；`check:architecture` 0（`next source boundaries: OK`）；`build` 0。最后 8 行的 S1 修复合入后只重跑 `npm run typecheck`：0 错。

测试：本轮新增/修改 61 个测试文件，366 过、7 失败、29 跳过（失败仅 A1 + C3×3，均 `run_check` 的 bwrap 环境失败）；`tests/app` 70 文件 385 过、11 失败（bwrap + AG6 书漏项）；`tests/architecture` 53/53；十个 `PC2-W-*` 28/28；importers 扫描 365 文件、37 批，6,734 过、119 失败、30 跳过（失败为 bwrap、上述阶段/字面书漏项）；S1 两文件修后 18/18。bwrap 失败原文：`run_check` 返回 `{"status":"rejected","code":"unsupported","reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}`。未运行的 `tests/scenarios` importer（85 个，已跑 A1、C3×3、K3-12-14、K3-42-unexpanded-r2、S3-context-and-inputs、S3-query-graph）：A10-check-recovery A11-no-progress A4-duplicate-receipts A7-control A7-control-goal29 A8-host-restart A8-host-restart-attestation A8-host-restart-entry A8-host-restart-lease A8-host-restart-paused A8-host-restart-rework B2-09b-allowance-crash C3-paused-continue-brief C3-reply-other-session C5-gate-fix C5-reverify-guards C6-unrelated-adoption C7-defer-reactivate C7-supersede-failed-task C8-auto-rework-cap C8-budget C8-human-stop-respected K-R-attested-facts-source K-R-interrupted-brief K-W-fallback K-W-maintenance K-W-workflow-close K3-05-review-round K3-06-mixed-batch K3-07-real-host-kill K3-08-wait-reply K3-09-restart-between-calls K3-10-review-round-cells K3-11-review-reasons-r2 K3-15-card-hold K3-16-approval-round K3-16-proposal-round K3-17-review-answer-shape K3-18-one-card K3-19-review-unavailable K3-25-attestation-replay K3-26-inventory-scenarios K3-27-review-claim-close K3-28-attested-continuation K3-29-disposition-recovery K3-29-extras K3-29-maintenance-review-run K3-29-recovery-continuation K3-29-recovery-round K3-29-startup-answers K3-29-startup-reconcile-2b K3-29-startup-variants K3-37-stopped-review-round K3-42-truncated-command K3-44-crr-kind4 K3-44-hold-restart K3-44-recovery-answers K3-45-review-incomplete-r2 K3-R1-continuation-protection K3-R1-file-change K3-R1-restart-flows K3-R1-second-cleanup K3-R1-session-not-closable K3-R1-workspace-capture K3-r1-seams S1-archive-restart S1-wait-copy-retirement S2C-K-archive-interruption S2C-K-archive-tags S2C-K-archive-tags-checks S2C-K-goal-pause S2C-K-legacy-provenance S2C-K-paused-run24 S2C-K-retired S2C-K2-continue S2C-K2-controls S2C-K2-conversation S2C-K2-gate-checks S2C-K2-paused-archive S2C-K2-paused-transfer S2C-K2-query-not-entered S5-goal-conflict-rework WP1-wiring WP2-wiring-scenario harness。

## 7. allowlist

`analyzeProductionReach` 报 `REACHED_ENTRIES []`，未删任何条目；joint 仅把 `PromptRecordRequestV1/ReadResultV1/ReadV1` 三条 `wire-format` 注记改为“E3 加 HTTP 路由”。保留的 PC-2 条目及其后续消费者：`readPromptRecord`、`sameQueryRunRef`、`readQueryPromptSet`、`messageOf`、`rejected`、`ModelRequestReadPort.listRunModelRequests`、`completeRunRef`、上述三个 PromptRecord 类型 → E3 HTTP 路由；其余注明 slice 3/8。

## 8. 与书不同的接缝、UNSPECIFIED

1. A：`renderTemplate` 对 `template_invalid`/`illegal_section_order` 也抛 `PromptRenderError`（未声明模板/调用槽仍普通 Error）；input 模板的 section 集来自 slot table，contracts 不能导入 `state/context-input`；canonical 工具正文按 `localeCompare(…,'en')` 排序；环以邻接/缺父问题呈现；空白 description 也拒绝。
2. T：`renderMaterial.pack` 由 `PromptTextsV1` 造型转换（PC-1 的 assembler 输入是 texts?，实际传 resolved pack）；review recipe 不填 material；`CONTEXT_SECTION_ORDER` 改为 v2 九名序，`PC-prompt-section-order` 不在 §5.3 但随之更新；`queryPreparedSectionOrder` 只为存在的模板记 call kind。
3. H：磁盘源由 Host 构造后作为 `TargetPlatformOptions.promptPacks` 传入（composition 不依赖 Host）；保存目标父目录比书更严（须在包内且在 prompts 内）；坏包 list 列出可读链声明；不存在的配置根跳过覆盖检查。
4. Q：prepare 以能力集 owners 冻结、start 再按实际 owners 复查；Query 的 read-only 门以冻结能力判断，真实策略在注册时复查；Query 最终表只取 graph 家族；`readCompletedHistoryBoundary` 把 Workflow 自己写入但本平台解不出的游标视作“无可解码完成历史”→ `{cursor:null,position:0}`，Run 以 current_turn 开始（更严做法需改 `session-operations.ts`/S1 夹具，均不在白名单）。
5. joint：Query-with-basis 执行半边因冻结夹具不可用未覆盖；`openPC2ReviewFixture('empty')` 不可用；frozen 夹具下 LA-1 非空 seed 不可达；read+edit+shell 只走 renderer 字面（平台夹具 hardcode `writeScope: []`）；无 read 的公开列表用 `['search']`。

## 9. HANDOFF

- **已完成**：A、W、T、H、G、Q、joint 全部落盘并提交（`ccb2a2a`、`e461676`、`4baaaff`、`1e39433`、`4191889`、`c0db852`、`3901c5b` 及各自修复提交，最后 `af84802`）；工作树干净；scope/冻结夹具检查为空；五项检查绿。
- **半成品**：无。唯一未落盘的是本回复本身（正在写入 `.dsh-ref/pc2-reply.md`）。
- **未开始**：无。
- **下一会话必须知道**：① 两族“书漏项”测试（K3-15-blocked-omission/K3-35-T-by-hand/K3-35-approved-methods-brief/AG6/C2 的 Skill 字面；C2 GAP-46、invariants-fuzz、A2-requeue-service/R3e-reverify/S5-notices 的 prepare 阶段）不在白名单，未改；② 环境无 `/usr/bin/bwrap`，相关 scenario/kernel/app 测试按环境失败列出；③ allowlist 未删条目；④ 若要更严的 history 游标规则，改 `session-operations.ts` 或 S1 夹具并重跑 `tests/business/S1-*`；⑤ `.dsh-scratch/` 已按 coordinator-mode 在结束前删除；本轮日志摘要都在本回复与提交里。
