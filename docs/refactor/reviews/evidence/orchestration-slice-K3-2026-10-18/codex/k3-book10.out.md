1. **Package R：20 个文件的归因成立，未见第三类原因。** 以下仅静态核对，未写文件、未运行测试。表中 L 是[失败摘录](D:/cxt/k3g4b3-review11/.lead-ref/k3-r9b-check-failures.txt)保留的原日志行号；文件默认在 `tests/runtime/`，省略 `.test.ts`。

| 文件 | 一条失败行 | 归因 |
|---|---|---|
| A2-reconcile-runtime | L3506：`Task review reader is not wired` | reader |
| B2-runtime-execution | L3919：`rejected/unavailable`，期望 `ready/undefined` | reader |
| `work-graph/WP1-goal-content-entry` | L4761：`Task review reader is not wired` | reader |
| S1-archive-files-brief | L4465：`Task review reader is not wired` | reader |
| K-readonly-command | L4255：`Task review reader is not wired` | reader |
| R4-control-runtime | L4401：`rejected`，期望 `ready` | reader |
| S2B-38-run08-unknown-activity | L4638：`rejected`，期望 `ready` | reader |
| S1-routed-replies | L4542：`Task review reader is not wired` | reader |
| K3-24-unknown-outcome-stability | L4330：`Task review reader is not wired` | reader |
| `app/S2B-be2-late-evidence-activity` | L3414：`Task review reader is not wired` | reader |
| S3-context-assembler | L4734：`expected a ready result, got rejected` | reader |
| R2e-git-source-loop | L4369：`Task review reader is not wired` | reader |
| `business/S1-archive-flow` | L3480：`Task review reader is not wired` | reader |
| S2B-r2-run08-current-revision | L4718：`rejected`，期望 `ready` | reader |
| S2B-45-inprocess-run21-activity | L4702：`rejected`，期望 `ready` | reader |
| S2B-44-backfill-late-evidence-race | L4686：`rejected`，期望 `ready` | reader |
| S2B-37-observer-reread-failure | L4622：`rejected`，期望 `ready` | reader |
| S2B-36-observer-cancel-reread | L4606：`rejected`，期望 `ready` | reader |
| S2B-15-end-retry-activity | L4590：`rejected`，期望 `ready` | reader |
| `architecture/production-reach` | L3456：四项数组，期望 `[]` | allowlist |

缺 reader 的共享装配点是：

- [B2-runtime-fixture:218](D:/cxt/k3g4b3-review11/tests/helpers/B2-runtime-fixture.ts:218)，依赖返回于 `:273`。
- [S2B-runtime-store-fixture:157](D:/cxt/k3g4b3-review11/tests/helpers/S2B-runtime-store-fixture.ts:157)，返回于 `:195`。
- [S1-runtime-scenario-fixture:235](D:/cxt/k3g4b3-review11/tests/helpers/S1-runtime-scenario-fixture.ts:235)。
- [WP1-entry-fixture:203](D:/cxt/k3g4b3-review11/tests/helpers/WP1-entry-fixture.ts:203)。

在这些点接同一 records 上的真实 owner，可覆盖相应消费者及 rebuild/reopen；底层 `task-claim-fixture:168、178` 已注册 review schemas/indexes。另有两处自行装配，必须单独接：[S1-archive-flow:255](D:/cxt/k3g4b3-review11/tests/business/S1-archive-flow.test.ts:255)、[S3-context-assembler:391](D:/cxt/k3g4b3-review11/tests/runtime/S3-context-assembler.test.ts:391)。后者没有现成真实 records，需要窄加真实 reader 的后端。

四个 allowlist 名称正确，修改位置是 `tests/architecture/production-reach-allowlist.json:1122、1128、1134、1140`。以上足以解除已知阻塞，不等于静态保证修后全部通过。

2. **Ruling 3：缺陷位置正确，但取消指引和 G6 例子需补句。**

`decision-read-model:550` 的返回类型丢掉 rejection，`:562` 丢掉具体结果，`:634–636` 再统一改成 unavailable；`context-assembler:1275` 确实吞取消。

**OPEN-1——最小补句：**“参考 `context-assembler.ts:1240` 的取消判定，让 `reviewCommandFacts` 返回取消结果，由 `assembleReviewForContext:1319`、`:1719–1720` 向 prepare 传播；不要抛进 `execution-preparation:458` 的 unavailable catch。”

`reviewCommandFacts` 本身没有书中所称“同一函数的现有取消检查”；prepare 已有检查在 `execution-preparation:377`。公开路径可达：真实 review prepare 在 Kernel window 读取处暂停后 abort；公开决定读选择**未答的 pending 卡**，在按 Task 列 sibling 请求时注入取消。注意真实 `listRequests:374` 不自行检查 signal：仅 A3 的 abort 后原样委托不足，须用已允许的 A2 取消故障包装。

卡比较器 [command-rerun-request-card:142](D:/cxt/k3g4b3-review11/src/core/work-graph/tasks/command-rerun-request-card.ts:142)确为时间降序、ref key 码元序降序。公开 owner 的 `requestRerun` 接受 `meta.requestId`，`:869–872` 使用注入时钟和该 ID；固定 A8 时钟可造同刻请求，但首条 deny 后须换 Run，避免 `denied_in_this_run`。真实 Runtime 工具链则由 `tool-commit-arguments:64` 生成 `c2-tool:`＋hash，不能把 callId=`a/B` 当作保存的 requestId。

**OPEN-2——最小补句：**“G6 在公开 owner 请求入口指定 a/B；先验证 brief 选 a，再真实消耗 B 的 allowance、于更晚时刻创建第三个 pending 请求，公开读其卡并断言‘以前’顺序为 a、B；保留严格早于当前请求的过滤。”

原因是卡 `:171–173` 排除同刻 sibling，且 answered 卡走保存答复；原书的两个请求不能直接完成所述卡片断言。上述例子还须实际满足删 sort 后选错的 mutation 要求。

3. **Ruling 4：G1、G2 都有现成路径。**

G1：通过 [harness:1074](D:/cxt/k3g4b3-review11/tests/scenarios/harness.ts:1074) 的 `h.post('decisions/answer', …)`；用 `commitGate` 在①或②持久化后卡住旧 Host（`:142–149`），`:1063` 解除对新 Host 的包装，再 [restart:1097](D:/cxt/k3g4b3-review11/tests/scenarios/harness.ts:1097) `{crash:true}`，保持 `resumeOnStartup:true`。A8 先例是 [A8-host-restart-entry:91](D:/cxt/k3g4b3-review11/tests/scenarios/A8-host-restart-entry.test.ts:91)，`:120–125` 明确验证无手动 advance 的自动推进。

恢复链为 `startup-reconcile:543` 枚举 CRR 答复 → `host:1036` 交接 → Workflow ②/③。成功例必须读回 allowed 和 application；失败例还须证明②故障确实被命中，不能只断言“仍未落实”。这样删除 `host:1036` **静态预期会失败**；本次没有执行 mutation。

G2：公开答复完成①后，仅让身份前缀 `crr-answer:` 的②提交**在调用真实 commit 前失败一次**（`command-rerun-request-service:1067`；身份见 codecs `:418`），其余调用委托真实后端。公开读回答复、pending 请求及空 application，再普通 advance 或重启。不要使用现有 `failNextApplicationCommit`：`K3-review-card-fixture:233` 拦的是③。此时 `applied === null`，插入 `continue` 才会漏掉恢复对象。

4. **§3 各行及 rulings 5–7：除上述两处，足以施工，无须新增产品设计决定。**

- F-069：三种 reader 故障各自独立，命中 `:741`。
- F-072：故障须进入②，例如其 `readGoal:1027` 抛异常；不能再停在 coordinator 的答复读取。
- F-073、F-020/F-035：按第3项；后两项另恢复 D27。
- F-100：两例都先形成①已存、②未提交；否则 `:959` 回执重放会绕过 Goal basis 守卫。
- F-021、F-026：指定位置和替换规则明确。
- F-032／裁定7：接 recognizer 后，第二轮用不同命令；若重复原命令，先取得真实一次性许可。
- F-054：七处明确；必须真正使用两种后端，不能只给原 stub 测试套 `.each`。
- F-066／裁定6：移 T 和删除未用入口可执行。15,030 尚未独立证实，verify9 的差项算式是15,031；应把移 T 记作 lead 裁定，不记成已证明公共不可达。
- F-067：固定公共输入、完整增量手算、长拒短受及完整读回，要求充分。

裁定5定位充分：D27 恢复公开 `readRequest.state === 'allowed'`；D82 恢复真实 reader 的 throw。A72/A78 是单目标 `#1`；A74 是 rerun/handle 不出现 blocked sentence；A77/A82/A84 是三条完整处置文字；A80 是 disposition＜targets 顺序。它们不全是“文案”，但逐个 ID 加原台账足以无歧义恢复。D10 已明确授权。

5. **未发现漏掉的业务必修行。** verify9 尚未关闭且分类为 behavior_bug/protection_gap 的各行均已收入 §3；F-066 是明确裁定移 T。没有把形式或卫生项重新列入范围。

OPEN count: 2