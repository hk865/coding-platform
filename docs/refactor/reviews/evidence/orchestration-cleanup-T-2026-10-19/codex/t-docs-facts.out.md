全程只读，未写文件、未运行测试。以下 `README.md`、`lead-acceptance.md` 均指 `draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/` 下的文件；同一问题在多处重复只计一次。

1. **TP 完成数及“含被吸收条目”的解释不成立。**  
   [lead-acceptance.md:24](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:24)、同文件:35、`draft/dsh-reply.md:18` 使用 **147 done／11 partial／15 BLOCKED**。逐项回复实际是 **157／7／9**，且被吸收项已经算作 done，例如 TP-005、TP-009。短注没有给出另外十项如何重新分类，不能用“含被吸收”解释。应采用可逐项复算的 157／7／9，或明确列出短注的重分类依据。来源：`evidence/dsh/t-reply-TP.md:7` 起的逐项表，尤其 :11、:15、:31、:171。

2. **TQ 应为 107 done，不应留作用户选择。**  
   [lead-acceptance.md:25](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:25)、同文件:31、`draft/dsh-reply.md:4` 应改为 **107 done、3 partial、5 BLOCKED，共115项**。逐项表展开完整覆盖115项；HANDOFF 的“100 done”少算七项，是汇总错误，不是另一种有效口径。来源：`evidence/dsh/t-reply-TQ.md:11` 至 :41；错误汇总在 :124。

3. **第二轮返工决定时间仍写错。**  
   [README.md:46](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md:46)、同文件:75、`lead-acceptance.md:16` 的“约18:15”应统一改为 **2026-10-20 18:14**。来源：`evidence/books/t-lead-summary.md:119`、:105。

4. **W2R1 的 Claude 人数前后矛盾。**  
   [lead-acceptance.md:106](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:106) 的“31 agents＋4个单agent”错误；正确是 **三个工作流5＋8＋5＝18个，另三个单agent，共21个**。`README.md:44` 已写对。来源：`evidence/checks/claude-workflows.txt:29`、:30、:31；`evidence/books/t-lead-summary.md:98`、:99。问题表 §6 的旧人数不能继续照抄。

5. **TQ-091 的修复对象与 W1 行号对应错了。**  
   [lead-acceptance.md:55](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:55) 把 `R4b-session-directory`、`task-claim-fixture` 对应到 W1-43、W1-27。实际 **W1-27 修 R4b；W1-43 修 S3-prepared-context-admission 的世界**。`task-claim-fixture` 的公开初始化属于 TP-107；另有 lead 的 `5daea2e` 给 R4b 补当前格式 catalog seed。来源：`evidence/dsh/t-reply-W1R1.md:35`、`evidence/books/t-w1-findings.md:71`、`evidence/books/t-items-TP.md:784`、`evidence/books/t-lead-summary.md:140`。

6. **把 T3-103 已被推翻的借口写成了事实。**  
   [lead-acceptance.md:69](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:69) 的“三个调用方不在白名单”不成立。W2b-26 明确指出：DSH 所说的两个 helper **就在 T2 白名单内**。应写“DSH 误称超出白名单而未接线；W2b-26 随后补齐三个调用方并删除 stub”。来源：`evidence/books/t-w2b-findings.md:91`。

7. **把 B-14 的历史 BLOCKED 清单当成最终遗留。**  
   [lead-acceptance.md:39](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:39)、同文件:84、:86 仍将七项列为保留 BLOCKED。后来 **TP-072／091、099、146、163、108(a)** 已分别经 W2-20、21、23、24、25 转换；这七项中最终只剩 **TP-124**。其中 late-lower-end 已改成真实前置下的 A6 `source_stale` 拒绝例。草稿自身 :40、:46、:47 也与 :86 冲突。来源：`evidence/books/t-w1r1-findings.md:62` 至 :67；`evidence/dsh/t-reply-W1R2.md:28` 至 :33。

8. **W2b-42 并非“只改理由文字”。**  
   [lead-acceptance.md:107](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:107) 应区分两阶段：返工1已加入真实 Query 保存 Answer、真实 `answerRef`、独立拒绝分组及前后状态断言；返工2才只是更正 SQLite-only 的理由。来源：`evidence/claude/t-reply-W2R1-agents.md:280` 至 :285；`evidence/books/t-w2r2-findings.md:58` 至 :60。

9. **W2b“不采纳”混用了分组数和发现数。**  
   [lead-acceptance.md:108](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:108) 的“12条（13个发现），7条不改”无法按来源复算。§5 是 **12个处理分组，明确列出16个发现编号**：B2 history 一组包含三个，S5 一组包含两个，末组又包含两个。按分组计数，应为 **六组不另改、三组落实为表行、三组接受适配／按§0处理／交用户**；不能把末组拆成两条后继续沿用12条总数。来源：`evidence/books/t-w2b-findings.md:136` 至 :151。

10. **W2c 的“不新开行”数量自相矛盾。**  
    [lead-acceptance.md:115](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:115) 将 W2b-41 算进“六条不新开行”，随后又说它落成 W2c-13。正确分组为 **五条不新开行、一条路线选择、两条采纳为 W2c-05／W2c-13**。来源：`evidence/books/t-w2r2-findings.md:65` 至 :79。

11. **`claimingSessionOf` 的报错条件写得过宽。**  
    [IMPLEMENTED-CAPABILITIES.md:3](D:/cxt/t-docs/draft/docs/refactor/IMPLEMENTED-CAPABILITIES.md:3)、`lead-acceptance.md:66`、:109 应补上条件：**Run 没有 `executionHistory`、需要回退读取 dispatch claim 时，dispatch 缺失才抛 `unavailable`**。有 executionHistory 时直接返回其中的 Session，不读取 dispatch。来源：`tree/src/core/work-graph/views/activity-read-helpers.ts:181` 至 :187。

12. **WG43 的引用范围少了一行。**  
    [IMPLEMENTED-CAPABILITIES.md:247](D:/cxt/t-docs/draft/docs/refactor/IMPLEMENTED-CAPABILITIES.md:247) 中，支持“`possiblyIncomplete` 包括没归到模块的文件”的代码在 **422行**；引用应由“409–421”改为“409–422”。行为描述本身正确。来源：`tree/src/core/work-graph/views/goal-conflicts.ts:420` 至 :422。

13. **“第一波类型检查等于没锁跑”过度概括。**  
    [DSH-WORKFLOW.md:412](D:/cxt/t-docs/draft/docs/refactor/DSH-WORKFLOW.md:412)、`README.md:79` 应改为：机器级锁不可用；**TP 改用副本内 `./.typecheck.lock`，TQ 才直接无锁运行**。TP 明确记录带本地 flock 的最终检查及约22秒耗时。汇总材料也写粗了，不能覆盖这份更具体的运行记录。来源：`evidence/dsh/t-reply-TP.md:217`、:218；`evidence/dsh/t-reply-TQ.md:58`、:85。

14. **逐轮表漏掉已有的 Claude 用量、耗时。**  
    [README.md:27](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md:27)、同文件:43–47 把部分已知用量留成“—”，所有 Claude 工作流耗时也未列。应补：
    - 盘点：53人／8.47M／29.0分钟；60人／10.41M／52.7分钟；
    - W2预审：2.30M／26.8分钟；账本覆盖：3.41M／12.7分钟；
    - W2R1三个工作流：1.39M／15.8分钟、0.59M／27.3分钟、1.03M／161.1分钟；
    - W2R1审查：1.26M／29.7分钟；W2R2：0.54M／7.5分钟；其审查：0.72M／11.1分钟。  
    来源：`evidence/checks/claude-workflows.txt:25` 至 :34。总数10工作流／179人／30.12M本身正确。

15. **合并经过遗漏了 lead 的实质修补。**  
    [README.md:29](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md:29)、同文件:41、:44，以及 `lead-acceptance.md:5` 的合并说明未交代：
    - 第一波 allowlist 按 `(file,name)` 合成164项，S5 fixture 取 TP 一侧；`5daea2e` 补的是空 modules、`since:null` 的当前 catalog；
    - 第二波唯一冲突是 `K3-35-continuation-fixture.ts` 的 re-export，取 T1＋T2 一侧；
    - W2R1 lead 为 W2b-01 保留 `admit-${requestId}` 身份，补 W2b-12 第三个标签，并应用被 Edit hook 拒绝的 agent 补丁。  
    来源：`evidence/books/t-lead-summary.md:136` 至 :149。只列提交号不能说明这些合并修正。

16. **漏记下一版规则表必须合并的已知差异。**  
    [lead-acceptance.md:150](D:/cxt/t-docs/draft/docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:150) 后的裁定收尾，以及 `DSH-WORKFLOW.md:412`，均未承接：**T 的 v2 从 v1 分出，缺 K3/L8 v3 的 A7 透传进程沙箱条目及 crash-fixture 措辞；W2b-27 后 `executeChecks:false` 的规则文字也已过时。下一片前应合成一份规则表。** 来源：`evidence/books/t-lead-summary.md:183` 至 :186；`evidence/books/t-end-list.md:47` 至 :49。

17. **STATUS 五处“进T”未区分完成与遗留，“都没有对应T条目”错误。**  
    [STATUS.md:42](D:/cxt/t-docs/draft/docs/refactor/STATUS.md:42)、同文件:48、:49、:295、:345，及 `draft/dsh-reply.md:9` 应按下表更新。历史叙述可以保留“当时转入T”，但当前限制不能继续把整个集合悬挂在已结束的T上。明确存在 T1-023、TP-142、TP-110、T3-039、T3-044 等对应项；也确实存在未解决的旧欠账。

另有几项核对结果需明确：N0 来源行删除前为 **`src/contracts/` 直属24个、`src/contracts/core/` 4个、`src/contracts/validation/` 3个，共31个**，现在为0；清单见 `evidence/books/t-items-TP.md:13`。四个生产文件确已删除。WG29 的旧 Session 回填已去掉，三个引用测试仍存在；WG43 的 port、reader、接线真实存在；WS5 两个类型位于 snapshot 文件；未发现能力页其他行继续引用 T 删除清单中的文件。上述除第11、12项外没有新增问题。

STATUS 的逐项结论如下。“未覆盖”指原欠账没有被T解决，并不表示该文件完全没有其他修改。原始清单位于：

- K3：`tree/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:124`、`checks/k3-final-freeze.md:35`。
- L8：`tree/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:99` 至 :107。

| 原欠账 | T 覆盖结论 | 依据 |
|---|---|---|
| K3 F-067：完整前置 C 手算 | **未覆盖该欠账；文件部分改造。** T1-023、W2b-21 改真实 Session／Run，补35字节差量，仍未给完整字段独立算式。 | `evidence/books/t-items-T2-w2.md:59`；`tree/tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:416`、:431 |
| K3 F-066：T600 公开 prepare 容量拒绝 | **未覆盖。** 仍验证12,764字节的成功 ready，不能承接容量拒绝。T3-081 只是合并 helper。 | `tree/tests/runtime/K3-35-T-by-hand.test.ts:166`、:172`；`evidence/books/t-items-T3-w2.md:690` |
| K3 G3／F-071、F-075 剩余测试 | **未覆盖。** 文件与基线一致，仍只调用 review reader，没有证明真实 prepare 失败关闭。 | `tree/tests/runtime/K3-B3-runtime-fail-closed.test.ts:28`、:48 |
| K3 G5／F-088 期望值自证 | **未覆盖。** 两处仍用生产函数生成期望；T2-061 只迁入另一条 capacity 拒绝断言。 | `tree/tests/state/K3-B3-shared-rules-pure.test.ts:56`、:59；`evidence/books/t-items-T2-w2.md:393` |
| K3 N-04 五个超时 | **未覆盖。** 两个300,000和三个120,000均保留。 | `tree/tests/scenarios/K3-44-crr-kind4.test.ts:289`、:339；`tree/tests/work-graph/B2-09-crr-owner.test.ts:536`、:548、:560 |
| K3 `K3-48-2` 手编码 UnknownCallReview | **已覆盖。** T1-023、W2b-21 用真实捕获、真实 review、Session／Run，替换原 `exactSizedRecord` 前置。 | `evidence/books/t-items-T2-w2.md:59`；`tree/tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:190`、:214、:326 |
| K3 `B2-blocked-runtime:260–271` 手造 WorkspaceFile | **未覆盖。** 文件与基线一致，仍由测试构造 `ready`、digest、版本等字段。 | `tree/tests/helpers/B2-blocked-runtime.ts:260` |
| K3 形式行 F-052：手造 Task closure | **已覆盖。** TP-142 改真实 disposition、真实 closure reader及其故障包装，并保留重新打开场景。 | `evidence/books/t-items-TP.md:1045`、:1051；`tree/tests/work-graph/B2-09-crr-owner.test.ts:456` |
| K3 F-091 的手造 Run／Role／assembler 前置 | **已覆盖该部分。** TP-110 改真实 claim、Runtime prepare及2001个真实文件变化。不能据此宣称整个 K3 默认世界全部公开化。 | `evidence/books/t-items-TP.md:807`、:813；`tree/tests/runtime/K3-35-workspace-baseline-prepare.test.ts:27`、:39、:43 |
| K3 F-054 等后端形式欠账 | **部分覆盖。** T2-035／036／037、W2b-30 补转换行的双后端；这不是原 K3 全部形式行的关闭证明。 | `evidence/books/t-w2b-findings.md:95`；K3 `lead-acceptance.md:140` |
| K3 其余形式行总集合 | **部分覆盖，不能整组标 done。** 原清单是37整行＋10部分行；上述已覆盖项之外，S5 默认手造 Session／entered、G3、G5、WorkspaceFile 等仍在。 | K3 `lead-acceptance.md:124`；`evidence/books/t-end-list.md:29`；`tree/tests/helpers/B2-blocked-runtime.ts:268` |
| L8 归档把 cancelled 转 unavailable facts | **未覆盖。** 该生产分支与基线一致。 | `tree/src/business/workflow/session-archive.ts:244` 至 :248 |
| L8 `requestAutoCapture`／`failAutoCapture` replay 分支 | **未覆盖。** T 没有解决公开重发入口问题；生产早、晚 restore 分支仍在。 | `tree/src/core/work-graph/architecture/architecture-service.ts:1301`、:1333、:1386、:1424 |
| L8 自动抓取 replay 测试 | **已覆盖对应测试。** T3-039 删除借重放获取 ref 的步骤，改用公开 `first.current.persistedRef`，保留模块层／文件层断言。 | `evidence/books/t-items-T3-w2.md:385`；`tree/tests/composition/S8A-L8-adoption-capture.test.ts:163` |
| L8 acceptance cancellation | **未覆盖。** 驱动仍只取新 controller 的 signal，不保存可取消的 controller。 | `tree/src/app/auto-capture-driver.ts:109` |
| L8 fail cancellation 的其余缺项 | **未覆盖。** 原P06部分覆盖仍在；T3-018／019 合并的是 start-state 失败／取消测试，不能算补齐 fail 的逐位点证明。 | `tree/src/app/auto-capture-driver.ts:252`；`evidence/books/t-items-T3-w2.md:265`、:274 |
| L8 A：普通 prepare 的逐 await 取消 | **未覆盖。** 所要求的 catalog／observed、basis／latest／previous、独立 assembler 边界没有因T补齐。相关公开测试和 prepare helper与基线一致。 | L8 `codex/verify3.out.md:54` 至 :74；`tree/tests/work-graph/S8A-L8-reminders-public.test.ts:233`；`tree/tests/helpers/S8A-L8-prepare.ts:1` |
| L8 UNSPECIFIED 2：requeue 逐 await | **未覆盖。** T 没建立缺失的 requeue 取消前置；不能把“夹具没建立”写成公共路径不可达。 | L8 `codex/verify3.out.md:77` 至 :81；`evidence/books/t-items-T3-w2.md:770` 仅清理 reminder helper 导出 |
| L8 B／UNSPECIFIED 5：真实组合回调 | **未覆盖。** 仍由测试 wrapper 调 `fireTrigger`，没有换成生产 composition 通知链。 | `tree/tests/work-graph/S8A-L8-observation-state.test.ts:173`、:192、:217 |
| L8 J：显式 cancelled、signal未置位时的 `input=null` | **未覆盖。** 原有公开拒绝和0 put断言仍在，但未补原要求的 `input=null`；该测试与基线一致。 | L8 `codex/verify3.out.md:148`；`tree/tests/work-graph/S8A-L8-reminders-public.test.ts:235` 至 :245 |
| L8 UNSPECIFIED 3：lookup-miss 后 late replay | **未覆盖。** 旧手造命令行已按L8裁定撤掉，不能算T完成；T未补对应公开路径。 | L8 `codex/verify3.out.md:451`；`evidence/books/t-items-T3-w2.md:265`、:274、:283 的改动范围 |
| L8 UNSPECIFIED 4：fail晚恢复 | **未覆盖。** revision guard仍先拒绝，late restore仍保留；未新增对应测试。 | `tree/src/core/work-graph/architecture/architecture-service.ts:1402`、:1424；L8 `codex/verify3.out.md:452` |
| L8 P3：手造健康探测 | **未覆盖。** 仍直接提交 `{verdict:'missing', activeRunId:null}`；测试与基线一致。 | `tree/tests/runtime/S1-archive-cancelled-reader.test.ts:75` |
| L8 P3：自己的归档组合 | **未覆盖。** 仍在测试中直接装配 archive service。 | `tree/tests/runtime/S1-archive-cancelled-reader.test.ts:104` |
| L8 P3：仅SQLite | **未覆盖。** TP-082 的无用导出清理没有改变后端选择。 | `tree/tests/helpers/S1-runtime-scenario-fixture.ts:159` |
| L8旧WP2 K4-25–K4-41 | **部分覆盖。** T3-044 将所列手造 probe 换成真实 probe；但例如K4-39要求的第二次真实Host restart仍未出现，当前仍用旧 `read.value` 再次 reconcile。 | `evidence/books/t-items-T2-w2.md:472`；`tree/tests/composition/WP2-wiring.test.ts:134`、:1881、:1895 |
| L8旧WP2 K4-42–K4-45 | **未覆盖。** 场景中的四个 missing／ready probe仍手造；T只改了该文件的消息参数。 | `tree/tests/scenarios/WP2-wiring-scenario.test.ts:197`、:243、:251、:257 |
| L8旧WP2 K4-46–K4-53 | **未覆盖这些原要求。** raw event 提取 requestId／responseRef及场景健康事件读取仍在，没有完成要求的公开回执替换或纯测试迁移。 | `tree/tests/composition/WP2-wiring.test.ts:56`、:334；`tree/tests/scenarios/WP2-wiring-scenario.test.ts:203`；L8 `codex/audit.out.md:171` 至 :178 |
| L8旧WP2 T33–T69 | **部分覆盖。** TP-107解决T33初始化，W2b-01解决T35真实Session，W1-19解决T36材料读取；但T37 raw coordination、T38手造只读副本及配置／root／授权替身仍在。不能整段记完成。 | `evidence/books/t-items-TP.md:784`；`evidence/dsh/t-reply-W1R1.md:27`；`tree/tests/helpers/task-claim-fixture.ts:364`；`tree/tests/helpers/WP2-platform-support.ts:534`、:590、:761、:766 |
| L8旧WP2 Q6：六个SHA的独立冻结依据 | **未覆盖。** 仍保留六个字面量及“固定身份”说明，没有补独立推导。 | `tree/tests/composition/WP2-wiring.test.ts:814` 至 :826；L8 `codex/audit.out.md:666` |
| L8 `host.ts:183` NUL scope key | **未覆盖。** 表达式保持原样。 | `tree/src/app/host.ts:183` |
| L8 `Pub:332` 写入正文未读回 | **未覆盖。** 测试与基线一致，仍只断言一次put及cancelled，没有读回正文。 | `tree/tests/work-graph/S8A-L8-reminders-public.test.ts:332`、:343、:347 |

问题数：17。