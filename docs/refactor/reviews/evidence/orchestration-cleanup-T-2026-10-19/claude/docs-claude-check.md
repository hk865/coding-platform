# T docs workflow digest: {'confirmed': 45, 'corrected': 12, 'refuted': 13}

## readme (claims 135)
- [readme-1 CONFIRMED wrong] README.md:46
  problem: This is the old value the lead already corrected. The user's decision on who does wave-2 rework 2 was at 18:14.
  correct: README.md:46 should read "用户 18:14 决定；4 个 agent；…". README.md:75 should read "（用户 18:14，问“第二轮返工交给谁做？”，答“Claude 子 agent”）".
  source: evidence/books/t-lead-summary.md:105 ("18:14 **user decision**: rework 2 also by Claude subagents") and :119 ("user, 10-20 18:14")
- [readme-2 CONFIRMED wrong] README.md:75
  problem: The same old time again. The decision was at 18:14.
  correct: - **wave 2 返工 2 也交 Claude 子 agent**（用户 10-20 18:14，问“第二轮返工交给谁做？”，答“Claude 子 agent”）。
  source: evidence/books/t-lead-summary.md:119; :105
- [readme-3 CONFIRMED wrong] README.md:29
  problem: Neither commit is TP's. TP's own commit was `efa65cd` ("T TP"). `11d46d5` is the lead's wave-1 merge, in which TQ's diff (t-base..5057649) was applied onto TP with a three-way patch. `5daea2e` is the lead's fix to R4b-session-directory for TQ-091's downstream fixture. The README has no wave-1 merge row, so two lead commits end up credited to the DSH TP run.
  correct: TP row, 提交 column: `efa65cd`. Name the wave-1 merge separately as the lead's work: `11d46d5` (TQ's diff `t-base..5057649` applied onto TP with `git apply --3way`; the allowlist merged by (file, name) into 164 entries with no conflict; `tests/helpers/S5-decision-fixture.ts` keeps TP's side). Then the lead fix `5daea2e` (R4b-session-directory seeds a current-format ArchitectureCatalog row for TQ-091's downstream fixture). The W1 full suite ran at `5daea2e`.
  source: evidence/dsh/tb-TP-final.md:5 (`efa65cd T TP`); evidence/dsh/t-reply-TP.md:1,244; evidence/books/t-audit-merge-notes.md:4-16; evidence/books/t-lead-summary.md:54-55, 136-141
- [readme-4 REFUTED] README.md:41 `4807e64` is the lead's wave-2 merge ("T wave 2: merge T3"), which resolved one conflict. The DSH runs committed `5ec8f5e` (T1, with checkpoints `43532e3`, `4c160fa`), `26cde07` (T2) and `54380f7` (T3 || why: The draft does not state anything false here. The README's 提交 column gives the commit where a round's work lands on the official line, as the DSH task asks ("the resulting commit"). It does this for every round that ran in its own copy and was merged by the lead. Wave-1 TP (line 29) shows the lead's
- [readme-5 CONFIRMED misleading] README.md:40
  problem: The refresh dropped both the 7 DONE items and the 1 GONE item, and books/t-w2-dropped.md lists all eight. The README points only GONE 1 to that file, which suggests the DONE items were kept. It also leaves out the lead override for BLOCK 2.
  correct: Wave 2 刷新 cell: "OK 214、CHANGED 14（8＋5＋1）、DONE 7、GONE 1、BLOCK 2；DONE 7 和 GONE 1 都从条目里去掉（8 条，见 `books/t-w2-dropped.md`）；BLOCK 2（T1-025、T1-068）由 lead 推翻：其余部分照转，事件子部分保留". The last clause is optional but supported by the sources. The required fix is that the dropped file covers all 8 DONE/GONE items, not only GONE 1.
  source: evidence/books/t-w2-dropped.md:1-10; evidence/books/t-lead-summary.md:83-84; evidence/checks/codex-calls.txt:57-59
- [readme-6 CORRECTED contradiction] README.md:39
  problem: (1) The cited index gives different numbers: 148 rows from 1417 listed, 'Verdicts: F1 145, A7 越界 3'. The figures 312 and 4 are the sums of the headers of the eight final pass-2 answers (L1-L6, L7a, L7b) in codex-calls.txt, not counts from the index. (2) '各组都完成' comes right after the pass-1 groups. In fact pass 1 stalled: 6 of 7 t-v2g answers say 枚举不完整. In pass 2, L7 was also incomplete and was split into L7a and L7b, so there are 9 t-v2n answers, not 8.
  correct: Column 3 should say that pass 1 stalled and that L7 was split. For example: "`codex/t-v2-list`、`t-v2-full`；第一遍 7 组 `t-v2g-*`，卡在列举普通公开输入（6 组答“枚举不完整”）；第二遍只列 v2 改动的部分（`t-v2n-*`），L7 不完整后拆成 L7a／L7b（共 9 份答复），最后 8 组都枚举完整".

The result-column figures F1 312、record-store F3 0、A7 越界 4 are correct and may stay. If a unit is added, say they are call-site counts summed over the 8 final answers, and that the index merges them into 148 rows (F1 145、A7 越界 3). The index's rows list 330 F1 line numbers, so 312 should be credited to the answers, not to the index.
  source: evidence/books/t-v2-instances.md:3; evidence/checks/codex-calls.txt:35-50; evidence/books/t-lead-summary.md:76-78
- [readme-7 CONFIRMED omission] README.md:43
  problem: The material does have usage for these Claude audit workflows, and the inventory row (27) and the rework rows (44, 46) do fill in Claude workflow figures. Missing: pre-audit 12 agents / 2.30M, ledger-cover check 20 agents / 3.41M, W2R1 audit 8 agents / 1.26M, W2R2 audit 4 agents / 0.72M. Line 21 also names only checks/dsh-runs.txt as the usage source, although the Claude figures come from checks/claude-workflows.txt.
  correct: Line 43, usage cell for the W2a audit: Claude 预审 12 个 agent／2.30M＋账本覆盖 20 个 agent／3.41M (5.71M). Line 45, the W2R1 audit: Claude 8 个 agent／1.26M. Line 47, the W2R2 audit: Claude 4 个 agent／0.72M. The Codex part of these rows can stay "—". Line 21 should cite both sources, for example: 用量：DSH 按 `checks/dsh-runs.txt`（秒、token、上下文峰值）；Claude 工作流按 `checks/claude-workflows.txt`（agent 数、子 agent token）. With these figures the per-row Claude numbers add up to the 30.12M on line 55.
  source: evidence/checks/claude-workflows.txt:27-28, 32, 34
- [readme-8 CONFIRMED omission] README.md:55
  problem: This is the total for workflows only. The source says single agents outside workflows and the lead's own turns are not counted. That excludes the three single agents of wave-2 rework 1 (W2b-36, W2b-09, W2b-20) and the coverage-before Claude subagent. Without the caveat the line reads as the full Claude usage of T.
  correct: - Claude 工作流（10-19 起）：10 个，179 个 agent，30.12M 子 agent token（不含工作流外的单个 agent 和 lead 自己的轮次）。
  source: evidence/books/t-lead-summary.md:235-236; evidence/checks/claude-workflows.txt:37-38
- [readme-9 REFUTED] README.md:23 The coverage run before T is missing. Decision 79-4 makes it part of T, a Claude subagent ran it on copy s9tcov (13:29-15:25), and the dependency was committed as 47cc63e8. The README has no row for i || why: The round table matches the rows the lead's task book asks for, and the book puts the coverage material in lead-acceptance.md, where the draft already has it. The book's README item asks for "a table of all rounds" and then names them: the inventory, the book checks, wave 1 (TP, TQ, TQ2, reworks 1–3
- [readme-10 CONFIRMED omission] README.md:44
  problem: The README cites none of the Claude evidence files it relies on. Missing: the W2R1 agents' report claude/t-reply-W2R1-agents.md (the W2R2 row does cite its counterpart), the pre-audit claude/w2-preaudit-dump.md, the ledger-cover check claude/w2-ledger-cover-dump.md, and the audits claude/w2r1-claude-audit.md and claude/w2r2-claude-audit.md. The task book lists all of these as material to cite.
  correct: Add the Claude sources to the "说明书 / 运行文件" cells:
- Row 43, W2a 审查: `claude/w2-preaudit-dump.md` for the pre-audit (12 agents, 40 确认／4 否决) and `claude/w2-ledger-cover-dump.md` for the ledger-cover check (20 agents, 15 确认／4 否决).
- Row 44, W2R1: `claude/t-reply-W2R1-agents.md`.
- Row 45, W2R1 审查: `claude/w2r1-claude-audit.md` (8 agents, 19 条, 13 确认).
- Row 47, W2R2 审查: `claude/w2r2-claude-audit.md` (4 agents, 5 条, 5 确认).

Row 46 is already right with `claude/t-reply-W2R2-agents.md`.

Use these `claude/` paths, not the `checks/...` paths t-lead-summary.md gives.
  source: evidence/books/t-docs.md:36-38; files present in evidence/claude/
- [readme-11 REFUTED] README.md:47 0/0/0 is Codex's count only. The table this audit produced (W2d-01..05) came entirely from the Claude audit, which the source classes as 不整洁 3 and 建议 2. Shown as 0/0/0 next to a five-row table, the au || why: Row 47's "0／0／0" is not wrong. It follows the rule the table applies to every Codex＋Claude row: the review column holds the Codex counts, and Claude's results go in the file column. The header line 21 says so: "审查列依次是会出错／违规／不整洁；Claude 的确认／否决数写在文件列". The other mixed rows prove the rule. The W2a 审查 ro
- [readme-12 CONFIRMED misleading] README.md:5
  problem: The wave-1 build (TP and TQ, from 18:00) followed rule sheet v1. v2 was frozen at 22:55, after that build, and from then on it bound the wave-1 reworks (R-1) and wave 2. The README also never cites the v2 sheet (books/test-rule-sheet-v2.md).
  correct: 手写事实的测试改成公开步骤：wave 1 施工（TP、TQ）按测试规则表 v1；v2（`books/test-rule-sheet-v2.md`，10-19 22:55 冻结）从 wave 1 返工 1 起用，wave 1 的返工里只用于问题表点名的行（R-1），wave 2 整体按 v2。
  source: evidence/books/t-book.md:59; evidence/books/t-lead-summary.md:61-62, 158; evidence/books/t-book-w2.md:65-66
  NOTES: I checked these against the material and found them correct:
- DSH figures: every DSH row's seconds, tokens and peaks match checks/dsh-runs.txt. The inventory sums to 9,212 s and 155.1M, with a peak of 285,899. The totals are 21 runs, 52,714 s and 501,534,416 tokens, with a peak of 367,721.
- Claude workflow figures match checks/claude-workflows.txt: 60/10.41M, 53/8.47M, 0.59+1.39+1.03=3.01M, 0.54M, and the subset of 10 workflows, 179 agents and 30.12M.
- Codex audit counts match codex-calls.txt: G1..G7 5/35/20, r1 1/7/6, r2 1/9/2, r3 1/1/0, w2a 15/47/8, w2r1a 3/0/1, w2r2a 0/0/0, w2r3q 0/0/0. The refresh counts are 214/14/7/1/2, and the total is 64 answers.
- Full-suite figures match t-lead-summary §6 and checks/full-W2R1.txt and full-W2R2.txt.
- Finding-table id ranges and rulings match t-w1/t-w1r1/t-w1r2/t-w2b/t-w2r2/t-w2r3.
- The inventory counts are right: 721/529/192, and per t-final.json tests 368 = delete 142, merge 124, convert 88, other 14, and production 161.
- The allowlist goes from 182 (pre-batch 62, wire-format 49, kept-for 71) to 164 (wire-format 109, kept-for 55), counted in t-inv and in tree.
- The four production files are gone from tree. Test files go from 773 to 766, and the lists of deleted and added files agree (9 test files deleted, 2 added; 5 helpers deleted; 8 helper and support files added).
- The size section matches `git diff --no-index --shortstat` between t-inv, t-w2base, t-w2pre-M and tree: 169 files +783/−3,300; 431 files +16,450/−24,083; and every per-wave figure.
- Every path the README cites exists under evidence/, including dsh/t-A1-final.md, codex/t-r1-B14 and codex/t-w2r3q. The CHANGED count is already 14.

Low-severity points left out of the findings:
- Row 27 gives the match counts (同 262, 冲突 133, 新 195; these sum to DSH's 590) right next to books/t-final-summary.txt. That file's source breakdown is codex+dsh 249, conflict 131, codex 146, dsh-new 195, and the lead ruled on '131 conflicts' (t-lead-summary.md:31). A label such as '匹配时' would avoid confusion.
- The material contradicts itself: t-lead-summary.md:61 puts the v2 freeze at 22:55, 'after' t-v2-list, but codex-calls.txt:34 dates t-v2-list at 23:00.
- The table has no rows for the wave-2 books (books/t-book-w2.md) or the wave-1 book (books/t-book.md) that the book check examined.
- I could not check the commit hashes against git history, because neither tree nor t-inv is a git repository. I checked them only against the evidence files.

## acc-waves1 (claims 64)
- [acc-waves1-1 CONFIRMED wrong] lead-acceptance.md:25
  problem: I expanded the TQ reply's item table myself. It covers all 115 ids TQ-001..TQ-115, each once: 107 done, 3 partial (TQ-001, TQ-091, TQ-111), 5 BLOCKED (TQ-103, 104, 112, 114, 115). 107+3+5 = 115. The HANDOFF's '100 done' gives 100+3+5 = 108, which does not add up to 115. So '100' is an arithmetic slip in the segment-1 HANDOFF. tb-TQ-final.md:10 and t-lead-summary.md:51 copied it. There is nothing left for the lead to check.
  correct: lead-acceptance.md:25 should read `| 1 | TQ | 115 | 107 | 3 | 5 BLOCKED |`. Line 31 should drop "差 7，待 lead 核" and say instead that the reply's per-item table gives 107 done, and that the HANDOFF (dsh/t-reply-TQ.md:124), tb-TQ-final.md:10 and t-lead-summary.md:51 say "100 done" by an arithmetic slip (100+3+5=108≠115). The partial 3 and BLOCKED 5 counts agree in both sources.
  source: dsh/t-reply-TQ.md:11-41 (item table), :124 (HANDOFF '100 项 done'); dsh/tb-TQ-final.md:10; books/t-lead-summary.md:51-52
- [acc-waves1-2 CONFIRMED contradiction] lead-acceptance.md:24
  problem: The TP reply's own item table, 173 rows, gives 157 done, 7 partial and 9 BLOCKED. Partial: TP-025, 030, 054, 099, 108, 118, 165. BLOCKED: TP-010, 072, 081, 091, 117, 124, 146, 148, 163. All 9 absorbed items (TP-005, 009, 014, 041, 074, 084, 132, 157, 172) are marked done. The 147/11/15 'including absorbed items' in the final note cannot be rebuilt from the table, even by giving each absorbed item its absorber's status (at most +1 partial). The draft's own bullets at lines 37-48 name exactly those 7 partial and 9 BLOCKED ids, so the header counts contradict them. The draft flags the TQ mismatch but not this one.
  correct: Line 24: `| 1 | TP | 173 | 157 | 7 | 9 BLOCKED |` (from the reply's item table), with a footnote like the TQ one. Example: "回复逐项表 173 项为 157 done、7 partial、9 BLOCKED；tb-TP-final.md 与 lead 摘要写 147/11/15（‘含被吸收条目’），按逐项表重算不出（9 条被吸收条目都记 done），待 lead 核。" Line 35: "（7 partial、9 BLOCKED）". Remove "计数含被吸收条目", or replace it with the same pointer to the mismatch.
  source: dsh/t-reply-TP.md:7-179 (item table; absorbed notes at :11,:15,:20,:47,:80,:90,:138,:163,:178); dsh/tb-TP-final.md:6; books/t-lead-summary.md:53
- [acc-waves1-3 CONFIRMED wrong] lead-acceptance.md:16
  problem: The time is still the old value. The lead's corrected time for this user decision is 18:14.
  correct: 18:14（10-20），用户被问 "第二轮返工交给谁做？"，答 "Claude 子 agent"；wave 2 返工 2 仍由 Claude 子 agent 做。 (Minimal fix: replace "约 18:15" with "18:14"; the date 10-20 already comes from line 14.)
  source: books/t-lead-summary.md:105, :119
- [acc-waves1-4 CONFIRMED wrong] lead-acceptance.md:40
  problem: This has it backwards. Wave 1 converted only the governance part (policy install/activate, architecture adopt) to public steps. The Project@1, Workspace@3 and pre-adoption Goal@6 checkpoints are the two handwritten seedCommits that stayed BLOCKED (S5-decision-fixture :560 and :599). B-14 names 'the Project@1, Workspace@3 and Goal@6 checkpoints' as still BLOCKED. Only W2-21 later built Project@1, Workspace@3 and Goal@6 through public steps.
  correct: S5 检查点（TP-099）：治理部分（policy install/activate 走公开 bootstrap、架构走 adoptInitialArchitecture）已改公开；Project@1、Workspace@3、采用前 Goal@6 这几个检查点仍是两个手写 `seedCommit`（S5-decision-fixture.ts:560 的 Project/Workspace、:599 的初始 Goal），按 B-14 留 BLOCKED。W2-21 后来用 createProject、registerWorkspace + setLinePins、公开 createGoal/reorder/setGoalSettings 走到这些 revision（107 个 importer 钉住 Goal @7–@9 和 Workspace@3）。
  source: books/t-items-TP.md:723, :728 (书面核对改正: 治理公开转换，其余检查点标记 BLOCKED); books/t-w1-findings.md:146 (B-14); books/t-w1r1-findings.md:63 (W2-21); dsh/t-reply-W1R2.md:29
- [acc-waves1-5 CONFIRMED misleading] lead-acceptance.md:39
  problem: This leaves out what happened later, and reads as if the part is still BLOCKED. B-14 kept the late-lower-end sub-case BLOCKED after rework 1. W2-25 then converted it to an A6 row, and rework 2 reported it done. The tree has `describe('rejects: a graph-history cursor whose outer upper is above the real end')`. B-08(a)'s second-Run prepare/start, which rework 1 left BLOCKED, was converted by W2-17. W2-17 is partial only because its later-Turn sub-case was deleted under R-4. The neighbouring bullets do give the later W2 outcomes (W2-10, W2-20, W2-21).
  correct: …TP-108 的 `seedRun` 按 B-08 逐处裁；B-08(a) 的 late-lower-end 先留 BLOCKED（B-14），W2-25 后来按 A6 转成真实 cursor 拒绝行（只把外层 `u` 设为真实 end+1，断言收紧为 `source_stale`）；B-08(a) 第二个 Run 的 prepare/start 在 rework 1 标 BLOCKED，W2-17 后来转成真实（R-7），later-Turn 子例按 R-4 删除（W2-17 仍 partial）。
  source: books/t-w1r1-findings.md:51 (W2-17), :67 (W2-25); dsh/t-reply-W1R2.md:25, :33; dsh/t-reply-W1R1.md:56; tree tests/runtime/R4c-graph-history.test.ts:577
- [acc-waves1-6 CONFIRMED misleading] lead-acceptance.md:47
  problem: Only TP-124 has a missing entry point (GAP-46, execution-driver.ts:239-243). DSH gave a different reason for the other three: the conversion path was not frozen ('真实 Kernel 身份冲突触发点未冻结', 'Host unavailable 探测/归档链未冻结', '公开 GR 世界/GR06-07 映射未冻结'). The rulings then found public paths: B-09 says real end/requeue/claim/probe/archive for TP-148, W2-23 converts TP-146 as an A6 row, and W2-24 converts TP-163. All three were done (TP-148's probe step via W3-08). Putting them under 'no public entry' is wrong.
  correct: Split line 47. Correct text:

"没有公开入口（TP-124）：Agent requeue 无 Runtime 工具入口（GAP-46，真实 start 在任何模型调用前拒绝 requeue_task，`execution-driver.ts:239-243`）；W2-22 保持 BLOCKED，lead 记入 L-3。"

Then add the other three under the existing category "说明书未冻结" (line 45), or under a new line:

"说明书未冻结公开路径（TP-146、TP-148、TP-163）：Kernel slot 冲突触发点、Host probe/archive 链、GR 世界与 GR06/07 映射未由书冻结；GR 世界里 running Run 同时开验证轮那部分按原写法不可达。后来全部转为公开步骤：TP-148 按 B-09（返工 1 完成），W2-08 时 probe 一步 BLOCKED，W3-08 补完；TP-146 按 W2-23 改为 A6 行；TP-163 按 W2-24 转换，并带 R-6 改正。"
  source: dsh/t-reply-TP.md:152,154,169 and :200-203; books/t-w1-findings.md:141 (B-09); books/t-w1r1-findings.md:64-66 (W2-22..W2-24); dsh/t-reply-W1R2.md:31-32; dsh/t-reply-W1R3.md:16 (W3-08)
- [acc-waves1-7 CONFIRMED contradiction] lead-acceptance.md:54
  problem: The wave-1 table's §6 closes TQ-001's partial part. B-15 says 'closed: TQ-001 (R-1, pending the v2 list)'. No later reply or table keeps it partial. Saying the item is 'still recorded partial' contradicts B-15.
  correct: TQ-001 was partial in the build reply: the real initial-plan entry forces planId to `initial-plan-<hash>`, so it cannot produce `plan:p1`, and DSH asked the lead to rule. The lead closed it in B-15 under R-1. The `plans/propose` draft body is a public input, so the S0 path of propose + test draft is allowed and Codex's v2 list confirmed it. G3-03 is not taken under §5 ("v2 允许", no change). Suggested text: "…S0 走 propose + 测试 draft 是允许的。按 §5 不采纳 G3-03；B-15 按 R-1 关闭（回复里的 partial 标记和上表计数未改）。"
  source: books/t-w1-findings.md:147 (B-15), :127 (§5 G3-03); dsh/t-reply-TQ.md:11, :45
- [acc-waves1-8 CORRECTED misleading] lead-acceptance.md:55
  problem: (1) B-15 says TQ-091 is 'closed by the merge and W1-27', so 'still recorded partial' contradicts the table. (2) The fix is credited to the wrong row for one fixture. task-claim-fixture was closed by the merge, because TP's copy already adopts publicly at task-claim-fixture.ts:270 (TP-107). W1-43 fixed the bare baseline in S3-prepared-context-admission's own world, not either of the two fixtures named. The R4b fixture first got the lead's merge fix 5daea2e (a handwritten current-format catalog row), which W1-27 then replaced with adoptInitialArchitecture.
  correct: TQ-091（partial）：生产收窄完成；TQ 的回复记下两处下游夹具仍 seed 裸 baseline、当前读返回 `unavailable`。`task-claim-fixture` 由 wave 1 合并关闭（TP-107 已改成公开 `adoptInitialArchitecture`，合并副本 `task-claim-fixture.ts:270`）；`R4b-session-directory` 先由 lead 合并修 `5daea2e` 补当前格式 catalog 行，再由 W1-27 改成公开 `adoptInitialArchitecture`；W1-43 另修 `S3-prepared-context-admission` 自己世界里的裸 baseline（TQ-091 × TP-054 的合并回归）。B-15 记为关闭（条目计数仍按回复记 partial）。
  source: books/t-w1-findings.md:147 (B-15), :71 (W1-43), :95 (W1-27); books/t-lead-summary.md:55, :140-141 (5daea2e); dsh/t-reply-TQ.md:46
- [acc-waves1-9 CORRECTED unsupported] lead-acceptance.md:56
  problem: Rework 1 reports B-11 done: rows 22-62 deleted under R-4, catalog race half kept as wave 1 made it. That leaves no open part of TQ-111. No source records the item as partial after B-11. The bullet also leaves out W2-14: the cover named for B-11 (plan-machine.test.ts:670-672) does not run the physical-removal check, and that check went to L-2.
  correct: Remove "（条目仍记 partial）". Suggested line 56: "TQ-111（partial）：22–62 行要“Plan 物理移除 Task”，公开 plan change 拒绝（`plan-validation.ts:338`）；B-11 在 rework 1 按 R-4 删掉这一行（done，W2-14 确认删除成立），catalog race 半段保持 wave-1 的转换；之后这一条没有留下的部分。" It may add "物理移除检查 `plan-validation.ts:337-338` 没有直接测试，进 L-2" but does not need to, because lines 93 and 172 already say it.
  source: dsh/t-reply-W1R1.md:59; books/t-w1-findings.md:143 (B-11); books/t-w1r1-findings.md:40 (W2-14), :90
- [acc-waves1-10 CONFIRMED contradiction] lead-acceptance.md:12
  problem: Every count in the material says 60 core-http-types entries, not 61. The t-base allowlist has 60 pre-batch entries on src/app/core-http-types.ts and 2 on src/app/main.ts, 62 in all, and the tree has 0 pre-batch. Codex P1 lists 60 core-http-types pre-batch findings plus 2 main.ts. TQ converted 60 (TQ-002～TQ-061 '60 项'). The summary's size line also says pre-batch 62 → 0. Only the summary's wording of the user decision says 61, and the draft copies it.
  correct: 决定 1：60 个 `core-http-types` 别名和 2 个 `main.ts` CLI 类型保留；允许清单里这 62 条的理由从 pre-batch 改成 wire-format（pre-batch 62 → 0）。The same 61 → 60 fix is needed in the lead's sources: evidence/books/t-lead-summary.md:36, D:/cc-lead-notes/impl/t/t-state.md:53 and D:/cc-lead-notes/impl/t/handoff-79-4-result.md:2, which also says 61.
  source: D:/cxt/t-inv/tests/architecture/production-reach-allowlist.json (60 core-http-types + 2 main.ts with reason pre-batch); codex/t-inv-P1.out.md (60 + 2 allowlist-pre-batch rows); dsh/t-reply-TQ.md:12, :14; books/t-lead-summary.md:36 vs :224
- [acc-waves1-11 CONFIRMED omission] lead-acceptance.md:39
  problem: This gives the outcome of TP-054's C1 part but not of its WP1-units part (B-06 → W1-10). W1-10 stayed BLOCKED: WF01 has no public step that changes a Goal's objective or Workspace (graph-context.ts:181, goal-settings-machine.ts:233). The WF02 cause exists, but the row was kept whole under R-5. Line 48 repeats C1 and again omits WP1.
  correct: Line 39: after "W1-13 用真实 prepare/start + A3 gate 关掉 C1；" add, for example: "WP1-units（B-06 → W1-10）留 BLOCKED：WF01 没有公开步骤改 Goal 的 objective/Workspace（`graph-context.ts:181`、`goal-settings-machine.ts:233`）；WF02 的公开原因存在，但一行两半，按 R-5 整行保留 R-2 形态。" Line 48 should not leave TP-054 looking fully closed. Either add the WP1 Runtime double (B-06 → W1-10, still BLOCKED) or say that W1-13 closes only the C1 part (B-05).
  source: books/t-w1-findings.md:78 (W1-10), :138 (B-06); books/t-w1r1-findings.md:79-80; dsh/t-reply-W1R1.md:18, :163
- [acc-waves1-12 CONFIRMED omission] lead-acceptance.md:43
  problem: TP-117 is BLOCKED in the reply, but the BLOCKED-by-category list leaves it out. It only appears in the by-group list at line 38, so this list has 8 of the 9 BLOCKED items.
  correct: Add a TP-117 bullet to the list at lead-acceptance.md:43-47, for example: "手写已接受事实（TP-117；TP-030、TP-118 同因 partial）：两个 `workFixture` 消费者用 `state.set` 原地改写已接受事实；B-04 逐断言裁：revoked authorization、changed read-grant、changed Reviewer digest 三个原地改写子例按 R-3 删，ended-Run 子例改真实 Runtime；accepted ReviewWork + running 的 base 留 BLOCKED（R-5），因为真实 source reader 对 ReviewWork 返回 `unsupported`（`src/core/work-graph/source-authority-reader.ts:158`）。"
  source: dsh/t-reply-TP.md:123, :198; books/t-w1-findings.md:136 (B-04); books/t-w1r1-findings.md:83-84
- [acc-waves1-13 CONFIRMED omission] lead-acceptance.md:57
  problem: The bullet gives the ruling but not the outcome. Line 59 gives TQ-115's outcome. Rework 1 reports B-10 done: seedAcceptedTask goes through public adopt→createGoal→proposePlan→readPlanProposal→applyPlanChange, then the real archive chain. With that, these three are closed.
  correct: - TQ-103、TQ-104、TQ-112（BLOCKED）：`seedAcceptedTask`、occupancy、cancel、link、archive 都依赖一个合法已接受 Plan；B-10 让先公开 propose/review/adopt，再按书的路由走（R-5）。返工 1 完成 B-10：`seedAcceptedTask` 改走公开 adopt→createGoal→proposePlan→readPlanProposal→applyPlanChange；archive 链改成公开 claim（不开 responsible link）→busy→真实 cancel 未进入的 Run→开 link→archive 拒绝→关 link→archive；`graph-session-fixture.ts` 不再有 `overwriteSession`。三条关掉。
  source: dsh/t-reply-W1R1.md:58, :156
- [acc-waves1-14 REFUTED] lead-acceptance.md:58 This leaves out what happened. Rework 1 left B-12 partial: IN04 deleted under R-4, the Run seeds and IN14 still BLOCKED. W2-18 converted the three Run seeds and IN14 to real claims, start/finish and m || why: The facts the checker gives are right, but they don't make line 58 wrong or misleading. Line 58 says three things: TQ-114's wave-1 status (BLOCKED), its reason (the mixed world and IN14), and what ruling B-12 directs (the verb is 让, meaning "has it do"). It never says rework 1 carried B-12 out. All 
  NOTES: I found 14 problems in lead-acceptance.md lines 1-61.

The TQ count needs no lead check. I expanded the item table in dsh/t-reply-TQ.md (the TQ-002～TQ-061 range counts as 60 ids). It covers all 115 ids once each: 107 done, 3 partial, 5 BLOCKED. '100' is a slip in the segment-1 HANDOFF (100+3+5 = 108), copied into tb-TQ-final.md and t-lead-summary.md:51. The acceptance should state 107.

The TP row (147/11/15) has the same kind of mismatch, which the draft does not flag. The TP reply's item table gives 157/7/9. The '147/11/15 含被吸收条目' appears only in tb-TP-final.md:6 and t-lead-summary.md:53, and the table cannot reproduce it. All 9 absorbed items are marked done, and the draft's own bullets name exactly 7 partial and 9 BLOCKED ids.

The wave-2 rows are correct against the replies and final notes:
- T1: 65/3/1 BLOCKED.
- T2: 58/3/1 not started.
- T3: 97/2/0. T3-045 is recorded 'done（046）'.

These claims check out:
- Lines 5-6: 47cc63e8 changes exactly package.json, package-lock.json and scripts/check-boundaries.mjs (git show --stat).
- Lines 11-15: the user decisions and both quotes match t-lead-summary.md:36-38 and :97-98.
- Lines 37-38: B-02, B-03 and B-04 outcomes.
- Line 41: AD06 via W2-10; AD08 and L-1.
- Lines 45-46: B-01 dropped; W2-20 uses 103 real Runs.
- Line 54: initial-plan.ts forces `initial-plan-<hash>` (the same in t-inv and the tree).
- Line 56: plan-validation.ts:338 is the physical-removal refusal (the same in t-inv and the tree).
- Line 59: TQ-115 via B-13, W2-19 and W3-05.
- Line 60: TQ2 ran 19:42-19:45 and committed 5057649 (dsh-runs.txt, tb-TQ2-final.md).

I could not verify '37 个提交（DSH 11、Claude Code 26）' (line 7): the tree has no git history. The DSH replies cite only 10 DSH commit hashes (efa65cd, 5057649, ed26c44, 1c31c27, 254617d, 43532e3, 4c160fa, 5ec8f5e, 26cde07, 54380f7), so the lead may want to recount DSH 11.

'返工 3 由 lead…' (line 17) sits under 用户的决定 but is not a user decision. That is a placement issue only, so I did not report it.

To count the TQ table I wrote one temporary file, /tmp/tq.txt, and deleted it right after. No repository files were touched.

## acc-waves2 (claims 62)
- [acc-waves2-1 CONFIRMED wrong] lead-acceptance.md:69
  problem: The bullet repeats DSH's reason as fact, but the lead's frozen row W2b-26 says that reason was wrong. Two of the three callers, `tests/helpers/K3-review-card-fixture.ts` and `tests/helpers/S2A-window-fixture.ts`, are on T2's whitelist. Only `tests/app/S5-decision-routes.test.ts` is off T2's list; it is on T3's list.
  correct: T3-103：`executed-files-stub.ts` 还在。DSH 说三个调用方不在白名单，但 `K3-review-card-fixture.ts` 和 `S2A-window-fixture.ts` 在 T2 白名单上（`t-files-T2-w2.txt:13-14`），只有 `S5-decision-routes.test.ts` 不在（它在 T3 的单子上）。W2b-26 把三处都接上真实 reader 并删了 stub。
  source: evidence/books/t-w2b-findings.md:91 (W2b-26: 'the reply said the two helpers are off the whitelist, but `t-files-T2.txt:13-14` lists them'); evidence/books/t-files-T2-w2.txt:13-14; evidence/books/t-files-T3-w2.txt:14; evidence/dsh/t-reply-w2-T2-a.md:79
- [acc-waves2-2 CORRECTED misleading] lead-acceptance.md:86
  problem: These 7 sit under 'retained BLOCKED' with reasons that read as final. They were not final. Codex's B-14 evaluation found 6 of the 7 publicly reachable, and rework 2 converted them: W2-20 (TP-072/TP-091), W2-21 (TP-099), W2-23 (TP-146), W2-24 (TP-163), W2-25 (TP-108(a)). Only TP-124 stays BLOCKED (W2-22). Calling TP-072/TP-091 '不可达' contradicts Codex ('公开可达') and the draft's own line 46 (W2-20 converted them with 103 real Runs). TP-099 was converted too; only the empty `noticeSeen` precondition was dropped under R-4. The draft's own line 94 lists the true end state (W2-11, W2-22, W1-10, W1-15, B-04 ReviewWork, AD08), so the two lines disagree.
  correct: Replace the B-14 sentence in line 86 with: "B-14 在 rework 1 后另列 7 条仍 BLOCKED（其中 TP-108(a) 是 B-08(a) 的子例），由 W2 表 §3 裁定：Codex `t-r1-B14` 的评估是 convert 5、R-4 1（TP-099 只删不可达的持久化空 noticeSeen 检查点）、keep 1。rework 2 把其中 6 条转成公开链：W2-20（TP-072/TP-091，103 个真实 Run）、W2-21（TP-099，保留 importer 断言的 revision；按 R-4 去掉 `S5-decision-routes.test.ts:246` 前置条件里的 decisionSettings 部分）、W2-23（TP-146，A6）、W2-24（TP-163，GR world 公开链）、W2-25（TP-108(a)，A6，断言收紧为 source_stale）。只有 TP-124 仍 BLOCKED（W2-22：GAP-46，missing entry point，`execution-driver.ts:239-243`）。" The rest of the line 86 bullet (W1-10, W1-15, W1-26 AD08, B-04 ReviewWork) stays as written.
  source: evidence/codex/t-r1-B14.out.md:23, :90-96; evidence/books/t-w1r1-findings.md:62-67 (W2-20..W2-25); evidence/dsh/t-reply-W1R2.md:28-33; evidence/books/t-w1r2-findings.md:42-44
- [acc-waves2-3 CONFIRMED omission] lead-acceptance.md:90
  problem: The 14 findings make up only W2-01..W2-14. Table W2 has 25 rows; line 91 says '25 行都处理了'. The source line leaves out the other 11. W2-15..W2-19 are BLOCKED parts the lead reopened under R-7 (§2). W2-20..W2-25 are the B-14 rulings, based on Codex's separate evaluation `codex/t-r1-B14` (§3).
  correct: 来源：Codex 对 rework 1 的两组审查（`codex/t-r1-R1`、`t-r1-R2`）：会出错 1、违规 7、不整洁 6，lead 对回 rework-1 表和代码，14 条全部成立，成为 W2-01..W2-14；同两组审查的 BLOCKED 核对给出了公开路径，按 R-7 重开 5 个 BLOCKED 部分（W2-15..W2-19：W1-25、W1-21、B-08(a)、B-12、B-13）；Codex 对 B-14 清单的逐条评估（`codex/t-r1-B14`）成为 6 条 B-14 裁定（W2-20..W2-25：TP-072/091、TP-099、TP-124、TP-146、TP-163、TP-108(a)），合计 25 行。
  source: evidence/books/t-w1r1-findings.md:3-4, :42-67; evidence/books/t-lead-summary.md:66-67
- [acc-waves2-4 REFUTED] lead-acceptance.md:67 The bullet leaves out W2b-20's 会出错 finding: DSH reported the second-Goal sub-case BLOCKED but deleted its records and both assertions (w2-base :88-127). That goes against R-5/R-20, which keep a BLOCKE || why: Every claim in draft line 67 checks out against the sources. The finding names no wrong value. It only asks for detail that this bullet list is not clearly required to carry.
(1) The reason is DSH's own final reply, nearly word for word. tb2-T2-a-final.md:8 has "T1-070（第二 Goal 被 `K3-35-runtime.ts:11
- [acc-waves2-5 CONFIRMED misleading] lead-acceptance.md:99
  problem: Only DSH says all 12 were done. Codex's review of rework 3 says W3-01's 'done' did not hold at `254617d`: IN05 failed on both backends in the bubblewrap full suite W1R3 (772/773 files, 2 failed) because the anomaly lookup index was not registered. W3-01 was finished only by the lead's `67d547d`. As written, line 99 says the rows were done at `254617d`.
  correct: 关法：DSH rework 3 `254617d`，回复报 12 行全部 done；W3-12 只更正回复里的 ledger 配对（`S3-graph-context.test.ts:917` 属 W2-24）。复核：W3-01 的 done 不成立。W1R3 全量 772/773，IN05 在两个后端失败（lookup index `session-anomaly-by-task` 未注册；DSH 环境无 bwrap，没跑到）。Codex `codex/t-r3-P1` 的 1 会出错 + 1 违规都归 W3-01，其余 11 行 OK。lead 按决定 81 落 `67d547d`（注册 Session anomaly schema、用真实 mailbox）和 `d4c4cea`（`makeRunA2` 类型收窄）；wave 1 收在 `d4c4cea`。
  source: evidence/codex/t-r3-P1.out.md:1, :9-12; evidence/books/t-lead-summary.md:72-75, :199
- [acc-waves2-6 CONFIRMED unsupported] lead-acceptance.md:81
  problem: The cited file has none of these numbers. `checks/full-W1.txt` shows only the copy, the exit codes (build/typecheck/architecture 0, vitest exit 1), an empty 'failing files:' list and the start/end times. The counts and the 2,542 s come from the lead summary, and from t-w1-findings §2b, which cites `full-W1-vitest.log`; that log is not in the evidence folder.
  correct: Keep the numbers and change the citation. For example: "合并副本全量（`books/t-lead-summary.md` §6 W1 行；`books/t-w1-findings.md` §2b；运行记录 `checks/full-W1.txt` 只有提交 5daea2e、退出码和 21:46–22:29 起止时间）：767/772 个文件，24 失败、9,913 过、5 跳过、2,542 s；……" (in English: "Merged-copy full suite (cited to the lead summary §6 W1 row and t-w1-findings §2b; the run record checks/full-W1.txt holds only commit 5daea2e, the exit codes and the 21:46–22:29 start/end times): 767/772 files, 24 failed, 9,913 passed, 5 skipped, 2,542 s; ...") Another option is to add the W1 vitest summary to checks/full-W1.txt, as was done for full-W2R1.txt.
  source: evidence/checks/full-W1.txt:1-7; evidence/books/t-lead-summary.md:196; evidence/books/t-w1-findings.md:62
- [acc-waves2-7 REFUTED] lead-acceptance.md:86 A real source reader does exist. It has no ReviewWork provider and returns `unsupported` for ReviewWork. The draft's own line 38 says this correctly ('真实 reader 返回 `unsupported`'). || why: At line 86 the subject of the sentence is the accepted ReviewWork. "B-04 的 accepted ReviewWork 没有真实 source reader" means ReviewWork has no real reader. It does not say that no real source reader exists at all. The code says the same thing: the tree's own comment reads "ReviewWork has no provider her
  NOTES: Checked draft lines 62-101 of lead-acceptance.md: the 10 wave-2 segment-a bullets and the W1, W2 and W3 table summaries.

Verified correct:
- Codex audit counts: G1..G7 = 5/35/20; R1+R2 = 1/7/6; Q1+Q2 = 1/9/2.
- W1 outcome '44 行里 40 done、2 partial (W1-26, W1-28)、2 BLOCKED (W1-10, W1-15)'. W1-21 and W1-25 were BLOCKED after rework 1 and done after W2-16 and W2-15; W1-28 is partial through W2-11.
- §5 '4 条（7 个 Codex 发现）'; B-14's 7 parts; 16 = 8 (W1-43 AD01-04 ×2) + 8 (W1-44).
- Commits ed26c44, 1c31c27, 254617d, 67d547d, d4c4cea.
- W2 '25 行都处理了'.
- File:line cites in the tree: plan-readers.ts:598, decision-contracts.ts:247, plan-validation.ts:337-338. execution-driver.ts:1253 holds the `publish` no-op in the tree; base 3a9f6d94 has it at :1254.
- The tree confirms W2b-57 (test file gone, `claimingSessionOf` throws `unavailable`), W2b-26 (stub deleted) and the T3-080 export kept.
- All 10 segment-a partial/BLOCKED/not-started items appear in the wave-2 bullets.

Outside this part, and not reported as findings: line 16 still says '约 18:15'; the corrected time is 18:14. I did not check README.md or the other drafts for the old CHANGED count of 16. Note also that t-lead-summary.md:83 itself still says 'CHANGED 16'.

## acc-tables2 (claims 74)
- [acc-tables2-1 CONFIRMED wrong] lead-acceptance.md:106
  problem: Wrong counts. Rework 1 ran three Claude workflows with 5 + 8 + 5 = 18 agents, plus three single agents (W2b-36, W2b-09, W2b-20). The draft also contradicts itself: its own README.md:44 says '5＋8＋5 个 agent（3 个工作流），另 3 个单 agent'. The '31 + 4' comes from t-w2b-findings.md:157, which is wrong in the same way and should be corrected too.
  correct: 关法：按 14:41 用户决定交 Claude 子 agent（3 个工作流共 18 个 agent：5＋8＋5，另 3 个单 agent：W2b-36、W2b-09、W2b-20），lead 逐 diff 审、按 clone 提交合并 `722ddf3`；W2b-20 由 `03b9cfd` 补，R-22 给它 `600_000`。 (The evidence file t-w2b-findings.md:157-158 carries the same wrong "31 agents in three workflows plus four single agents" and should also read 18 agents in three workflows plus three single agents.)
  source: evidence/checks/claude-workflows.txt:29-31 (10-20 06:56 8 agents, 07:01 5 agents, 09:23 5 agents); evidence/books/t-lead-summary.md:98-100; draft README.md:44
- [acc-tables2-2 REFUTED] lead-acceptance.md:106 Misleading. The text says all of rework 1 followed the 14:41 decision. In fact the first two workflows (the lead rows, 5 agents; the more-rows workflow, 8 agents) started at 14:31 and 14:40, before th || why: Line 106 says the same thing as its own source, the frozen W2b table, and the draft does not hide the earlier start. The table states it directly: "By the user's decision at 14:41, Claude subagents applied the whole table instead" (evidence/books/t-w2b-findings.md:14-15). Its §6 says the same and gi
- [acc-tables2-3 CONFIRMED misleading] lead-acceptance.md:107
  problem: Misleading. Rework 1 did W2b-42 in full: a real Query in the locked scope, approval with the returned answerRef, the expected forbidden/unchanged result, and R-18. Only later, in rework 2, did the lead correct the table's stated reason why the row is SQLite-only. Read in the row-outcome line, the claim suggests the row itself changed only reason text.
  correct: W2b-42 在 rework 1 done（锁定 scope 里跑真实 Query，用返回的 answerRef 批准，断言 forbidden 且 settings 快照不变；两行拒绝都按 R-18）；rework 2 里 lead 只更正了表 §6 里“只跑 SQLite”的理由（memory Host 给了 settingsDirectory 也有 settings，`src/app/host.ts:324-329`），这一行仍只跑 SQLite。
  source: evidence/books/t-w2b-findings.md:112, :194; evidence/books/t-w2r2-findings.md:58-60
- [acc-tables2-4 CONFIRMED wrong] lead-acceptance.md:108
  problem: The counts mix units and do not match the source. §5 has 12 entries. Six take no action (B2 positions, guard 2, S3-host plan body, vi.mock, T1-015 wording, and the skeptic-rejected P T1a-06/P T3b-07), and the draft itself names only those six. '7' comes from counting the last entry as two. The 12 entries cite 16 finding ids, not 13: P T1b-02, C T1b-02, L T1-L1-01, C T1a-04, C T1a-06, C T1b-11, P T1b-06, P T1b-11, C T2a-13, C T2b-02, C T2a-04, L T1-L1-02, P T1b-07, L T3-L2-03, P T1a-06, P T3b-07. The draft's own 7 + 3 + 3 = 13 also does not equal 12.
  correct: 不采纳：§5 的 12 条（16 个发现）里 6 条不改：B2 历史位置按 R-16、guard 2 的顺序使真实路径成立、S3-host plan 的 body 是公开输入、`vi.mock` 捕获按 R-21、T1-015 只是回复措辞、P T1a-06/P T3b-07 被怀疑者驳回；3 条已落成行（W2b-04、W2b-17、W2b-46）；3 条按 §0：T2-051 按接受的适配、K3-19 不在白名单、S5 默认路径交用户。
  source: evidence/books/t-w2b-findings.md:134-151
- [acc-tables2-5 CONFIRMED contradiction] lead-acceptance.md:115
  problem: Internal contradiction. W2b-41 is counted among the entries that open no row, but it became row W2c-13 (adopted as a suggestion), as the same sentence says. Of the 8 entries in §3: 5 take no action, 1 is the route conflict settled inside W2c-01, and 2 became rows: W2c-05 (as a table correction) and W2c-13 (as a suggestion).
  correct: 不采纳：§3 的 8 条里 5 条不新开行（gate/only-carrier、`k3_35` 导出：不改；第二个 F07：进用户的 T 结束清单；K3-48-2 Session、K3 review round Sessions：S5 默认路径交用户）；1 条路线冲突选 task-graph read（W2c-01）；2 条落成行（W2b-55 尾巴作为表更正落成 W2c-05，W2b-41 作为建议落成 W2c-13）。
  source: evidence/books/t-w2r2-findings.md:63-79, :50
- [acc-tables2-6 CONFIRMED unsupported] lead-acceptance.md:105
  problem: The cited file does not have these numbers. checks/full-W2a.txt holds only the build/typecheck/architecture exit codes, 'vitest exit 1', an empty 'failing files:' list and 'ended 14:21'; it has no vitest summary. The numbers are only in the lead's summary table. The values match that summary, but the citation does not support them.
  correct: Keep the values but change the citation to the lead's summary. For example: "wave-2 合并全量（`books/t-lead-summary.md` §6；`checks/full-W2a.txt` 只记 vitest exit 1：760/766 个文件，8 个测试失败、9,724 过、3 跳过、2,797 s）". Alternatively, the lead adds the stripped vitest summary to `checks/full-W2a.txt` (Test Files 6 failed | 760 passed (766); Tests 8 failed | 9724 passed | 3 skipped; Duration ~2797 s), as was done for full-W2R1.txt. The citation is right once that is done. Optional: write "8 个测试失败" instead of "8 失败", since 766−760 = 6 failing files, not 8.
  source: evidence/checks/full-W2a.txt:1-7; evidence/books/t-lead-summary.md:200
  NOTES: I checked lines 102-151 claim by claim; the numbers below hold against the sources.
- Codex wave-2 audit: 15/47/8 (sum of the six t-w2a-*.out.md tallies).
- Codex audit of rework 1: 3/0/1 (t-w2r1a-P1..P3).
- Codex audit of rework 2 and the quick check: 0 findings (t-w2r2a-P1/P2, t-w2r3q).
- Claude pre-audit: 40 confirmed. The dump has 40 entries; the missing ids are T1a-06, T1b-07, T3b-05 and T3b-07, which gives the 4 rejected.
- Ledger cover: 15 confirmed (15 entries).
- Claude audit of rework 1: 19 findings, 13 confirmed, 6 refuted (verdict arrays).
- Claude audit of rework 2: 5 findings, all confirmed (3 不整洁, 2 建议).
- Full suites W2R1 and W2R2: the numbers match their files.
- Rework commits: 722ddf3, 03b9cfd, 222cd58, fc63710, 36fa14b, 9aef728, c05c7d7 and 9a69bdb (5 files, +15/−6) all match.
- Rework 3 checks: 6/6 and 2/2 match. The W2c-04 digest (183 bytes, 27272b14…55d5) matches.
- Rows: 55 done and 2 partial after R-24 is right. In rework 1 alone it was 54 done and 3 partial (W2b-09, W2b-17, W2b-55); the draft explains this. W2c: 14 of 14 rows done.
- Code claims in the tree hold: claimingSessionOf throws unavailable with the ref key (activity-read-helpers.ts:187); plan-contracts.ts:89-125 TaskRow has no revision or reducedAt; goal-phase.ts:21-31; architecture-observation.ts:53-60 has no revision or readThrough; the 600_000 timeout is at unknown-call-review-list.test.ts:50; the 120_000 timeout is at S2C-node-detail-anomalies.test.ts:207.
- Rulings: all 24 one-line summaries keep the meaning of their full texts in §0 of t-w1, t-w1r1, t-w1r2, t-w2b and t-w2r2. R-18 leaves out "applies to the rows this table names", which does not change its meaning.

Outside my part, seen while checking:
- lead-acceptance.md:16 and README.md:46 still say "约 18:15" for the user's decision on rework 2; the corrected time is 18:14.
- lead-acceptance.md:172 places `provenNotEnteredKernel` in `activity-read-helpers.ts`. The function is defined in src/contracts/run-activity.ts:91 and does not appear in activity-read-helpers.ts in the tree.

## acc-tail (claims 52)
- [acc-tail-1 CONFIRMED bad-path] lead-acceptance.md:172
  problem: Wrong file. `provenNotEnteredKernel` is not in `activity-read-helpers.ts` at all, before or after T. It is defined in `src/contracts/run-activity.ts:91`. The test T deleted (`tests/work-graph/S2B-r2-r5-not-entered.test.ts`) reached it through the track reader (`readTrackBars`; the call is at `track-read-model.ts:312` after T). The `activity-read-helpers.ts:176-183` that the W2b-57 row names is T1-036's `claimingSessionOf` `unavailable` branch, a different thing. The source end list makes the same mistake.
  correct: L-2 没有测试的生产 guard：`provenNotEnteredKernel`（`src/contracts/run-activity.ts:91`；删掉的 `S2B-r2-r5-not-entered.test.ts` 经 `readTrackBars` 走到它，`track-read-model.ts:312`）…. Fix the same file name in books/t-end-list.md:23.
  source: tree src/contracts/run-activity.ts:91; grep shows no match in tree src/core/work-graph/views/activity-read-helpers.ts; t-inv tests/work-graph/S2B-r2-r5-not-entered.test.ts:1-8; evidence/books/t-w2b-findings.md:132 (W2b-57); evidence/books/t-end-list.md:23 (has the same error)
- [acc-tail-2 CORRECTED misleading] lead-acceptance.md:173
  problem: Misleading. 2,457 s has no label, so it reads as the before-T time (the end list even calls it "before T"). It is actually W1R1 on `ed26c44`, already after wave 1. No time was recorded for the before-T suite (`—`). The series also stops at W2R1 and leaves out the last measured full suite, W2R2 on `c05c7d7` at 3,476 s, which is the slowest. The end list was written at 19:10, before W2R2 ended at 19:21.
  correct: L-4 测试时间：全量 T 前约 2,520 s（决定 85-5 合入时那次，`fix-d85-5-2026-10-19/checks/full-suite.txt`；跑在 lead 第二处修改之前）→ 2,457 s（W1R1，`ed26c44`）→ 3,072 s（W1R2）→ 3,017 s（W2R1）→ 3,476 s（W2R2，`c05c7d7`，最后一次测量的全量）；真实世界换掉手写状态。……
  source: evidence/books/t-lead-summary.md:195-202 (checks table); evidence/checks/full-W2R2.txt (Duration 3476.42s); evidence/books/t-w1r2-findings.md:53 ("The suite went from 2,457 s to 3,072 s", i.e. W1R1→W1R2); evidence/books/t-end-list.md:26 (mislabels 2,457 s as before T)
- [acc-tail-3 CONFIRMED misleading] lead-acceptance.md:156
  problem: Only true of TP-002. Seven of the 31 files also had declarations changed by other T items: `dispatch.ts` lost `ExecutionAuthorizationV1`, `goal-change.ts` lost `AmendGoalRequestV1` and more, `human-role-collaboration.ts` lost `CoordinationPolicyPin`, `ledger.ts` made `desiredStateRevision`/`desiredStateRequestedBy` required, `plan.ts` dropped the schemaVersion 1 draft/snapshot unions, `query-job.ts` made `execution`/`submission` required, and `role-spec.ts` lost `roleSpecRevisionRefFor`. Read as a statement about T, "声明不动" is wrong.
  correct: 裁定 3 → TP-002（Codex P1-183）：TP-002 只删这 31 个文件第 1 行的 N0 来源注释，不动声明（其中 dispatch、goal-change、human-role-collaboration、ledger、plan、query-job、role-spec 7 个文件的声明由别的 T 条目另改，如 TP-011、TP-013、TP-014、TP-017）。现在 `grep -rn "Migrated contract declarations" src` 为 0。（Or simply drop "声明不动" and keep "T 删了 31 行".）
  source: evidence/books/t-items-TP.md:15 (TP-002: 只删第 1 行，不动声明); diff of t-inv vs tree src/contracts/{dispatch,goal-change,human-role-collaboration,ledger,plan,query-job,role-spec}.ts
- [acc-tail-4 CONFIRMED wrong] lead-acceptance.md:157
  problem: The parenthesis gives P1-184 to both items. Only TP-064 is P1-184. TP-066 comes from inventory finding P2a-14.
  correct: - 裁定 8：旧游标容忍 → TP-064（P1-184）、TP-066（P2a-14）。 (Rest of the line unchanged.)
  source: evidence/books/t-items-TP.md:464 (TP-064 · P1-184) and :479 (TP-066 · P2a-14); evidence/books/t-final.json:17839 (codex_id P1-184)
  NOTES: I checked these claims and found them correct. (1) N0 provenance line: before T it is in exactly 31 files, all under t-inv/src/contracts (including core/ and validation/), all on line 1, and not in tests. After T, grep for it in tree src/tests returns 0. (2) `decodeQueryCursor` (tree track-read-model.ts:206-224) rejects a cursor unless `ca` is a string or null (:222); `decodeCursor` then returns null. The `ca ?? null` and the 'earlier versions' comment (t-inv :224-226) are gone. (3) claim-contracts.ts:92 reads `export type TaskClaimOutbox = DispatchOutboxRecord;`. `TaskDispatchStateV1` and `N0GoalInput` have 0 hits in tree src and tests; before T they had 8 and 6 hits. (4) RL-12-15-conditions.test.ts:360 and :403 are `>= 9_900`, and :361/:404 keep `<= 12_000` (before T: 10_000). (5) The id mapping matches t-items and t-final.json: P1-183=TP-002, P1-184=TP-064, P1-185=TP-040, P1-186=TP-003, P1-187=TQ-092, P1-188=TP-001. The DSH replies mark all of them done. C1 rulings 3, 8, 12 and 14 and decision 85-4 match the C1 lead-acceptance and HANDOFF:683. (6) The before-T coverage numbers match the vitest-summary values in coverage/before-summary.txt: 75.38/69.58/89.02/83.78, 1,129, 23,577, 30 and 487. (7) Left for the user: graph-context-reader.ts:1010 is `baseSources` with no Workspace source, and it is identical at t-base (:1013). execution-driver.ts:239-243 is the unknown-tool-name refusal. plan-readers.ts:1390 is the `phase !== 'satisfied'` filter. plan-validation.ts:337-338 is the physical-removal check. session-operations.ts:426 is the cursor binding refusal. createAuxSession writes the Kernel Session through `kernelStores.withStore`. The timeouts and measured times for W2b-08 and W2b-20 match t-w2b-findings.md:173/182. The missing-public-read entries match t-w2b-findings §6 and W2c-05. (8) Known limits: every checks/full-*.txt says bubblewrap and 5 workers. The context-limit runs (TQ, W1R1, W1R2) match checks/dsh-runs.txt. The coverage-after restart after 33 s matches summary §3.7. full-TMERGE.txt has no vitest line yet. (9) execution-driver.ts:1253 (cited at draft line 71, outside this part) is `publish: async () => {}`, a no-op, which supports the T2-025 observer-down point. Not an error, only a citation gap: the source notes for bullets 169, 170, 172 and 173 name labels ('L-1 AD08', 'L-2', ...) rather than a file. For consistency with 171, 174 and 175 they could cite `books/t-end-list.md` items 1, 2, 4 and 5. The drafts' known stale values ('约 18:15'/18:25, CHANGED 16) do not appear in lines 152-185.

## capabilities (claims 64)
- [capabilities-1 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:247
  problem: The line range is one line short. Line 421 has only the first two terms of possiblyIncomplete. The unmapped-file term (`mapped.some((file) => file.moduleRef === null)`) is on line 422, and the object closes at 423.
  correct: 409–422 行只在读取器的 `availability` 不是 `available` 时把这个标志置 false，`possiblyIncomplete` 也覆盖 `availability !== 'available'` 和没归到模块的文件. "409–423 行" is also acceptable if the closing of the returned object should be included. 422 is the minimum that covers the unmapped-file term.
  source: D:/cxt/t-docs/tree/src/core/work-graph/views/goal-conflicts.ts:409-423
- [capabilities-2 CORRECTED misleading] IMPLEMENTED-CAPABILITIES.md:247
  problem: The row asks what the hint reads for executed files today, and this wording suggests `not_available` can still happen. The only production port (createGoalExecutedFilesReader) always returns `availability: 'available'` and never `not_available`. T's own item T3-103 states the same. So in production the hint always reads `executedFiles: 'available'`. A reader failure is not `not_available`: it fails the whole conflict read at line 411. The row also leaves out the reader's own `possiblyIncomplete` (active Runs, unknown activity, a Run with no activity that is not proven not-entered, `changedFiles.possiblyIncomplete`), which is the first term on line 421.
  correct: 执行改过的文件经真实的 `GoalExecutedFilesPort` 读（`createGoalExecutedFilesReader`，create-platform.ts 944–945 行装配）。真实读取器成功时只回 `availability: 'available'`（goal-executed-files-reader.ts 203–205 行），从不回 `not_available`；读取失败时整个冲突读取直接返回失败（goal-conflicts.ts 411 行，经 240 行），所以今天冲突读取里的 `executedFiles` 总是 `available`。267 行的 `not_available` 分支和 421 行的 `availability !== 'available'` 只有别的端口实现报 `not_available` 时才会走到，生产里没有（唯一会这样报的 `executed-files-stub.ts` 已由 T3-103 删掉）。`possiblyIncomplete`（421–422 行）有三个来源。第一是读取器自己的标志：没有活动记录的进行中（starting/running）Run、没有活动记录又证明不了没进入的已结束 Run、活动状态为 unknown 的 Run、`changedFiles.possiblyIncomplete`（goal-executed-files-reader.ts 169–187 行）。第二是没归到模块的文件。第三是上面那条生产里走不到的 `availability` 分支。
  source: D:/cxt/t-docs/tree/src/core/work-graph/tasks/goal-executed-files-reader.ts:62,169-190,203-205; D:/cxt/t-docs/tree/src/core/work-graph/views/goal-conflicts.ts:411,420-422; D:/cxt/t-docs/evidence/books/t-items-T2-w2.md:535
- [capabilities-3 REFUTED] IMPLEMENTED-CAPABILITIES.md:247 T did not change this behaviour. The real reader has been wired into production since slice 2B (L13, merged 2026-10-15). At the same time the stub was moved to tests/helpers and became test-only. T on || why: The checker has the history right, but the history does not make the draft row wrong or misleading. In the base tree (3a9f6d94) production already wired the real reader: t-inv/src/composition/create-platform.ts:961-962. The stub was already test-only, and its own header says it was moved there by 2B
- [capabilities-4 REFUTED] IMPLEMENTED-CAPABILITIES.md:299 T's items say to change this row, not delete it: TQ-089 says "改 IMPLEMENTED-CAPABILITIES.md:298" and TQ-069 says "一行随之改". Deleting the row also deletes facts that are still true: the decision-34 note  || why: The draft does drop the role-source-reader.ts row (draft/docs-draft.diff:64-68), but that is not a factual error.
(1) Neither source says to keep the row. TQ-089 says "改 IMPLEMENTED-CAPABILITIES.md:298" and TQ-069 says "一行随之改". Both only say the row must be edited, and removing a row whose only subj
- [capabilities-5 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:255
  problem: T removed this behaviour (TP-063). Automatic-rework notices read only commit positions now. The legacy-group reads (`readEqualityToEnd`, `legacySince`) and both legacy lookups (`s2a-requeue-legacy`, `s2a-round-reverify-legacy`) are deleted. A record without a commit position read from the ordered index is `unavailable`. The known-limit sentence names an index that no longer exists.
  correct: In WG48, replace "自动返工按已看位置之后的提交位置读；旧式（没有 `since`）的记录走旧式组。" with: "自动返工只按已看位置之后的提交位置读；有序索引读到没有提交位置的记录读作 `unavailable`（T 按决定 79 删了旧式组读取和 `s2a-requeue-legacy`、`s2a-round-reverify-legacy` 两条索引，TP-063）。" For the known limit, either drop "2A 的两个专门排序索引被 SQLite 选的旧式组索引替代、只多写入开销" or mark it: "2A 时 SQLite 选了列相同的旧式组索引；T 删了那两条索引，之后没有重查查询计划。" Keep the 5,001-record full-suite slowdown clause as it is.
  source: D:/cxt/t-inv/src/core/work-graph/tasks/claim-record-codecs.ts:61,71-75; D:/cxt/t-inv/src/core/work-graph/persistence/evidence-record-codecs.ts:723,731-735; D:/cxt/t-inv/src/core/work-graph/views/automatic-rework-notices.ts:203-209,256-259; D:/cxt/t-docs/tree/src/core/work-graph/tasks/claim-record-codecs.ts:60-71; D:/cxt/t-docs/tree/src/core/work-graph/views/automatic-rework-notices.ts:119-134; D:/
- [capabilities-6 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:206
  problem: T removed this behaviour (TQ-091). `ArchitectureRevision.catalog` is now non-null. A baseline with no catalog row now reads `unavailable` and no longer returns null.
  correct: Replace "历史 baseline 无 catalog 返回 null，不冒充空目录" with: "baseline 旁边没有目录行时（按当前指针读或按版本读）读作 `unavailable`，不冒充空目录（决定 79，T 的 TQ-091：`ArchitectureRevision.catalog` 改为非空）". The rest of the row stays as it is.
  source: D:/cxt/t-docs/tree/src/core/work-graph/architecture/catalog-contracts.ts:89-94; D:/cxt/t-docs/tree/src/core/work-graph/architecture/catalog-service.ts:414-419; D:/cxt/t-inv/src/core/work-graph/architecture/catalog-contracts.ts:88-93; D:/cxt/t-inv/src/core/work-graph/architecture/catalog-service.ts:420; D:/cxt/t-docs/evidence/books/t-items-TQ.md:570
- [capabilities-7 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:238
  problem: T removed the old-manifest half (TP-054, TP-009). `contextGoalContentProblem` no longer passes a missing binding or a null Goal digest. Any digest that differs from the current one, null included, is rejected. `contextAssembly` is now required on both manifests. The test GE03 ("commits the same unbound manifest when the stored Goal digest is null") was deleted. Only the re-authorization pass remains.
  correct: Replace "再授权、没有摘要的旧清单照旧通过；" with, for example: "再授权、没有对应 Goal 来源的清单照旧通过；T 起执行清单必须带 `contextAssembly`（缺了拒为 `invalid`），Goal 来源的摘要和当前不同（含 null）就拒为 `revision_conflict`（`context_goal_changed:`）（TP-054、TP-009）；". Keep "Query 不改". The test link list stays valid; GE03 is gone from WP1-goal-content-entry.test.ts.
  source: D:/cxt/t-docs/tree/src/core/work-graph/state/context-input.ts:365-387; D:/cxt/t-inv/src/core/work-graph/state/context-input.ts:374,381-383; D:/cxt/t-docs/tree/src/contracts/core/prepared-execution.ts:202,268; D:/cxt/t-inv/tests/work-graph/WP1-goal-content-entry.test.ts:79; D:/cxt/t-docs/evidence/books/t-items-TP.md:389
- [capabilities-8 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:260
  problem: T deleted the open-time drop of the 4B FTS5 tables (TQ-072): `LEGACY_TABLES_SQL` and the drop at open are both gone. The tree file has no FTS reference. Open still rebuilds. Dated line 25 ("打开时换掉 4B 的 FTS5 表") is a history line and can stay, but the WG53 row describes current behaviour.
  correct: WG53 row: "SQLite 存紧凑表和代号、打开时重建、读时按代际追上别的连接" (drop "并删掉 4B 的 FTS5 表"). If the history should stay in the row, add a note such as "（4B 的 FTS5 旧表在开库时删掉的那段旧升级，T 已删，TQ-072）".
  source: D:/cxt/t-inv/src/core/record-store/sqlite-text-scan.ts:13-15,59-60,136-148; D:/cxt/t-docs/tree/src/core/record-store/sqlite-text-scan.ts (no fts/legacy match); D:/cxt/t-docs/evidence/books/t-items-TQ.md:449
- [capabilities-9 CONFIRMED wrong] IMPLEMENTED-CAPABILITIES.md:311
  problem: T deleted `withLegacyReader` together with the legacy store entries and `registerLegacy` (TP-027). The registry interface now has only forWorkspace, byAdapterId and withStore.
  correct: RT2 entry: "`createKernelStoreRegistry`；`forWorkspace/byAdapterId/withStore`". The interface also has an optional `registerCurrent`, both before and after T. The pre-T row never listed it, so adding it is not needed for T. If the lead wants the full list, it is `forWorkspace/byAdapterId/withStore/registerCurrent`.
  source: D:/cxt/t-docs/tree/src/core/agent-runtime/kernel-store-locator.ts:16-20,78-83; D:/cxt/t-inv/src/core/agent-runtime/kernel-store-locator.ts:30,117; D:/cxt/t-docs/evidence/books/t-items-TP.md:195
- [capabilities-10 CONFIRMED misleading] IMPLEMENTED-CAPABILITIES.md:313
  problem: T removed the Query events history scan and the old authority branch (TP-030). Query source capture now takes only `Pick<SourceAuthorityReads, 'load' | 'readQuerySubmission'>` and resolves the initiator from the exact submission read. No production code reads `events` any more.
  correct: RT4 (draft :313): replace "Query 仍用完整 authority/events，未迁 provider 不伪造" with something like "Query 原发起者只用 `load` 和按 Job 自己的 submission locator 的精确读取（`readQuerySubmission`），不扫 events；T（TP-030）删掉了历史扫描和旧 authority 分支；缺精确读取时拒绝，不伪造". Line 202: replace "Query 原发起者路径仍要求完整 SourceAuthorityReads 和真实事件来源" with "Query 原发起者路径只要 `load` 和 `readQuerySubmission`（从正式 submission locator 精确读原提交事件和 actor，T 的 TP-030 已删事件扫描）". Keep the rest of the sentence (ReviewWork provider 仍缺；不能以空 events、固定 actor 或测试 seed 补足).
  source: D:/cxt/t-docs/tree/src/core/agent-runtime/source-capture-access.ts:258-259,622-641; D:/cxt/t-inv/src/core/agent-runtime/source-capture-access.ts:265,632,673-712; D:/cxt/t-docs/evidence/books/t-items-TP.md:217
- [capabilities-11 CORRECTED wrong] IMPLEMENTED-CAPABILITIES.md:340
  problem: The optional Workflow dependency `legacyProvenance` (LegacySessionProvenancePort) and the maintenance backfill that used it were removed in T, along with session-provenance-facts.ts (TP-062, TP-007). No `legacyProvenance` is left in src. This is the same S1-SES-02 backfill the WG29 edit removes, so the page now contradicts itself.
  correct: Keep the 2026-10-09 sentence as written. Append a dated note in the page's own style, for example: "2026-10-20 补注（T）：上面的 `legacyProvenance` 已删，旧 Session 来历补填不再存在（TP-007、TP-062）；Workflow 的可选依赖里不再有它。" Do not rewrite the 10-09 dependency list in place.
  source: D:/cxt/t-inv/src/business/workflow/ports.ts:141; D:/cxt/t-inv/src/business/workflow/session-maintenance.ts:377-381; D:/cxt/t-inv/src/composition/create-platform.ts:806; D:/cxt/t-docs/tree/src/business/workflow/ports.ts:125-145 (no legacyProvenance); D:/cxt/t-docs/evidence/books/t-items-TP.md:20,449
- [capabilities-12 REFUTED] IMPLEMENTED-CAPABILITIES.md:85 T removed the `replyMode` input from the tool schema, the mailbox and the stored fields (TP-031). It no longer appears anywhere in src. The current explicit call uses intent, needsReply and waitAfterS || why: The finding is right that T removed `replyMode` from src (TP-031). The tree has no `replyMode` anywhere in src, and the base had it at communication-tools.ts:319, :412 and :417. But the draft line is not wrong and not misleading.

1. Line 85 sits under the heading at draft line 83, "## 历史限定交付证据（不是当前
  NOTES: The rewrites of the four named rows check out, apart from the WG43 and role-source-reader findings above. The full scan found eight more places that still describe what T removed. WG43 answers: the stub tests/helpers/executed-files-stub.ts was test-only from slice 2B L13 (2026-10-15) on. Executed files have been real since 2B, through createGoalExecutedFilesReader wired at create-platform.ts:944-945.

Verified OK:
- T dated line (line 3): the four deleted production files match checks/t-files-deleted-added.txt. The claimingSessionOf change matches W2b-57: tree activity-read-helpers.ts:183-187 throws unavailable with the ref key; base :182 returned null.
- WG29 (line 230): the S1-SES-02 backfill is gone from src (no LegacySessionProvenancePort, backfillSessionProvenance, SessionProvenanceBackfilled, legacy_provenance). SessionRecord.provenance is required (contracts/core/session.ts:40), and the decoder refuses a record without it (session-record-codecs.ts:736). The three cited tests exist; after T, S1-provenance.test.ts holds only SV14. The remaining text is true.
- WG43 line numbers 944-945 and 267 are correct.
- WS5 (line 292): ProjectSourceQuery (line 33) and ProjectSourceAccess (line 19) are in project-source-snapshot.ts. SourceIndex is still used by exploration-tools.ts:109. Both cited tests exist.
- No other link or name of a file T deleted appears in the draft. All ../../ links resolve in the tree, except one .toolchain path that was already missing before T.

Not draft errors, for the lead:
- Code comment create-platform.ts:941-943 still says the test-only stub is injected by the slice-5 tests; the stub is deleted.
- Code that only serves null provenance is still in the tree: session-facts.ts:278-308 (legacyPending sweep), work-line-reader.ts:284,310 (readLegacyUnchecked), line-status.ts:443-447 (provenance_unchecked). TP-122 listed these for deletion.
- WS4 (line 291) names the old ProjectSourceIndex as history; T has since deleted the whole class.

## status (claims 58)
- [status-1 CONFIRMED misleading] STATUS.md:52
  problem: 88 is the number of inventory rows whose final action is 'convert'. It is not a count of tests and not a count of handwritten-fact rows. Of the 88, 83 are category 'handwritten' and 5 are category 'stale'. A row is one finding, and many rows cover a helper or fixture used by several tests. It is also the planned count, not the result. Some items ended partial or BLOCKED, the reworks under rule sheet v2 converted more handwritten state, and the 29 tamper rows were deleted under R-3 rather than converted. Written as '88 项…测试', it reads as 88 tests converted.
  correct: 清点里定为“改公开步骤”的 88 条（手写事实 83、过时 5，涉及 78 个文件里的 152 条测试）按规则表转换，做不完的记 partial/BLOCKED
  source: evidence/books/t-final-summary.txt:5 (convert 88), :33 (handwritten convert 83), :52 (stale convert 5), :55 (tamper delete 29); evidence/books/t-lead-summary.md:30
- [status-2 REFUTED] STATUS.md:52 The 766 / 9,774 / 3 figures come from the W2R2 full suite at c05c7d7. That suite ran before the lead's rework 3 (9a69bdb) and before the merge tree e99b385, and the merge-tree suite is still pending.  || why: Draft STATUS.md line 52 copies the lead's own size statement for T word for word. Summary §7 gives the size of t-base..9a69bdb and includes "Tests passed 10,089 → 9,774, skipped 5 → 3". The DSH task asks for "the size" in the T bullet and points to §7 as the source. The figures are given as size, ne
- [status-3 CONFIRMED unsupported] STATUS.md:87
  problem: The line says '全过' before the merge suite has a result; full-TMERGE.txt so far holds only build, typecheck and check:architecture. The file is cited as a bare `checks/…` path, and this line does not name the T evidence folder. Line 90 (C1) and line 88 (8D) name their evidence folder for the same kind of path. The note '目前只有这三项 0' is a working remark that will be wrong once the lead fills the line.
  correct: - **T 合入时的最后一次检查：** 合并树（`e99b385`；WSL、bubblewrap、5 个并行、scope 7G）：【lead 填】（测试文件数、过／跳过的项数、秒数和是否全过）；构建、类型检查、模块边界检查都是 0（[T 证据](reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md)的 `checks/full-TMERGE.txt`）。 Two changes: drop the presumed "全过" so the lead writes the outcome, and drop the note "目前只有这三项 0".
  source: evidence/checks/full-TMERGE.txt:1-4; draft/docs/refactor/STATUS.md:88,90
- [status-4 CONFIRMED omission] STATUS.md:340
  problem: The rewritten paragraph skips the step before the decision-83 section: the user's choices on the end-of-T list. The book requires that step in this order. AGENTS.md:3 and slices/README.md:3 both say the user decides the T end list first. So the STATUS summary paragraph contradicts them; only item 3 (line 351) mentions the list.
  correct: In draft/docs/refactor/STATUS.md:340, replace "接下来，lead 给第 6、7 片补“提示词和上下文”一节（决定 83），冻结后先做 6A 之前的结构一轮，再开 6A。" with "接下来由用户定 T 结束清单上的各项（`books/t-end-list.md`），然后 lead 给第 6、7 片补“提示词和上下文”一节（决定 83），冻结后先做 6A 之前的结构一轮（决定 85-1），再开 6A。" The essential fix is adding the user step before the decision-83 section. The "（决定 85-1）" reference and the list path are optional, but they match AGENTS.md:3.
  source: evidence/books/t-docs.md:93-95; draft/AGENTS.md:3; draft/docs/refactor/design/orchestration-2026-10/slices/README.md:3
- [status-5 CORRECTED misleading] STATUS.md:351
  problem: The end list has two parts: 'For the user to decide' (7 items) and 'The lead's own (no user decision)'. So '各项由用户定' is wrong for half the list. One of the lead's items is still pending: HANDOFF 83-3 assigned the base prompt's `check` contradiction to 'C1 或 T', and the end list says neither took it and it goes into the decision-83 section. Item 3, item 6 (line 354) and the paragraph at line 340 drop it without carrying it forward. AGENTS.md:3 repeats the '各项' wording.
  correct: STATUS.md:351: "T 结束清单里“交用户定”的 7 项由用户定（`books/t-end-list.md`，【lead 填：用户的决定】）" (optionally: "清单后半是 lead 自己的事，不用用户定"). AGENTS.md:3: "接下来由用户定 T 结束清单里“交用户定”的 7 项（`books/t-end-list.md`）". A note on the 83-3 `check` contradiction is optional, not required. The end list puts it among the lead's own items, for the decision-83 section, and HANDOFF 83-3 already records it.
  source: evidence/books/t-end-list.md:6-38 (user part), :40-51 (lead part, 83-3 at :50-51); tree/docs/refactor/HANDOFF.md:667
- [status-6 CORRECTED bad-path] STATUS.md:351
  problem: The path is relative to the T evidence folder, not to docs/refactor/STATUS.md. The book's 'paths relative to the evidence folder' rule applies only to the evidence README and the acceptance. The same bare path appears in draft/AGENTS.md:3 (repo root) and draft/docs/refactor/design/orchestration-2026-10/slices/README.md:3, where it does not resolve either.
  correct: Leave STATUS.md:351 as written ("T 结束清单上的各项由用户定（`books/t-end-list.md`，【lead 填：用户的决定】）"). The same bullet already links the T evidence, and it matches the book and the STATUS convention.

In draft/AGENTS.md:3, anchor the path to the T evidence, for example "（[T 证据](docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md)的 `books/t-end-list.md`）". The checker's full path `docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/books/t-end-list.md` would also work.

In draft/docs/refactor/design/orchestration-2026-10/slices/README.md:3, follow the file's own convention: "（[T 证据](../../../reviews/evidence/orchestration-cleanup-T-2026-10-19/README.md)的 `books/t-end-list.md`）". The checker's `../../../reviews/evidence/orchestration-cleanup-T-2026-10-19/books/t-end-list.md` would also resolve.

Both forms depend on the lead copying the material into the evidence folder.
  source: evidence/books/t-docs.md:122-125 (relative paths only inside the evidence folder); draft/AGENTS.md:3; draft/docs/refactor/design/orchestration-2026-10/slices/README.md:3
- [status-7 REFUTED] STATUS.md:351 Decision 79-4 also requires a full coverage run after T and a triage of what stays uncovered. Both are still pending: the after-T numbers and comparison are 【lead 填】, and L-2 waits on the triage. Neit || why: The draft sentence is accurate as written. It says only that decision 79-4's test cleanup and the removal of production code kept for old data or old interfaces are done. It does not say the coverage-after run or the triage is done. Calling this a misleading omission does not hold up, for three reas
- [status-8 CONFIRMED misleading] DSH-WORKFLOW.md:412
  problem: The in-copy lock did not start in wave 2. TP switched to `./.typecheck.lock` by itself in wave 1; TQ ran with no lock, then TQ2 was told to run plain `npm run typecheck`. Every wave-1 rework book (W1R1, W1R1b, W1R2, W1R3) already named `./.typecheck.lock`. A per-copy lock also serialises only within one run. T1–T3 ran in parallel, each with its own lock, so the machine-wide single slot the wave-1 book wanted (one typecheck slot shared across groups) was not restored. Saying wave 2 'uses the in-copy lock' after 'wave 1 ran unlocked' suggests a fix that did not happen across runs.
  correct: (a) wave 1 书里写的机器级锁 `/home/han001/dsh-work/t-typecheck.lock` 在 DSH 沙箱外，建不了（Permission denied）。TP 自己改用副本里的 `./.typecheck.lock`；TQ 不加锁跑，TQ2 按 lead 裁定也直接跑 `npm run typecheck`。从 wave-1 返工 1 起，各书都写 `flock ./.typecheck.lock`。副本里的锁只让一个运行内部排队：wave-1 的返工一次只跑一个，所以等于整机一个槽；wave 2 的 T1–T3 同时跑，各用各的锁，彼此不排队。
  source: evidence/books/t-book.md:91-92; evidence/books/t-run-TP.md:30; evidence/dsh/t-reply-TP.md:217-218; evidence/dsh/t-reply-TQ.md:58; evidence/books/t-run-TQ2.md:13; evidence/books/t-run-W1R1.md:42; evidence/books/t-run-W1R1b.md:36,80; evidence/books/t-run-T1-w2.md:101; evidence/books/t-lead-summary.md:85
- [status-9 REFUTED] DSH-WORKFLOW.md:412 This gets the roles wrong. R-10 tells DSH to run the sandbox tests itself with CODING_AGENT_BWRAP_PATH. If the sandbox still fails, DSH lists each test as an environment failure with its error text, a || why: The draft line is a short summary that matches the lead's own task for this bullet and is backed by the material. The finding rests on two claims, and the evidence contradicts both. (1) "The books do not list the tests." That is wrong. The TQ2 book names the sandbox tests itself and says the lead ru
- [status-10 CONFIRMED misleading] DSH-WORKFLOW.md:412
  problem: The three peaks are correct, but TQ is the wave-1 build group (TP/TQ), not a rework book. The lead's own book t-docs.md:117-118 has the same slip. Also, 360K is the runner's handoff trigger: each of these runs stopped with 'handoff:context (… > 360000)', and rework 2 reached 367,721. The paragraph right above this bullet (DSH-WORKFLOW.md:398) calls 360000 the `--handoff-at` value and puts `--max-context` at 450000, so '上限' contradicts it.
  correct: （c）大的书碰到 360K 的交接线（`--handoff-at 360000`，运行器记 `handoff:context`）：wave-1 施工的 TQ 峰值 360,740，wave-1 返工 1 的分段 1 是 360,573，返工 2 是 367,721；续做的书让协调者保持精简——不读审查回答和条目文件，子 agent 最多回报 40 行（`books/t-run-W1R1b.md`），分段 2 的峰值是 233,193。 (The lead should also update line 411 '交接只在试跑里触发过', since T now had three real handoffs.)
  source: evidence/checks/dsh-runs.txt:14,16,18; evidence/books/t-lead-summary.md:50-52,123-124; draft/docs/refactor/DSH-WORKFLOW.md:398
- [status-11 CONFIRMED omission] DSH-WORKFLOW.md:412
  problem: The sentence implies the lean rules kept the context down. But rework 2 ran after W1R1b with the same lean rules and still passed the handoff line at 367,721; the summary notes it had committed everything by then. The rules were: do not read the audit answers or the items files, coordinate only, subagents report in at most 40 lines. Citing only segment 2's 233,193 overstates what the rules achieved.
  correct: After "分段 2 的峰值是 233,193", add: "；返工 2 的书（`books/t-run-W1R2.md`）带同样的规则，峰值仍到 367,721，但那时已全部提交（`1c31c27`）" (that is, the rules let the coordinator finish its work; they did not keep it under the 360K limit).
  source: evidence/books/t-run-W1R2.md:13-18,74; evidence/checks/dsh-runs.txt:17-18; evidence/books/t-lead-summary.md:68
  NOTES: Verified and correct:
- src 169 files +783/−3,300 and tests 431 files +16,450/−24,083: recomputed with git diff --no-index between t-inv and tree.
- Test files 773 → 766: counted *.test.ts in both trees; 9 deleted and 2 added in checks/t-files-deleted-added.txt.
- Allowlist 182 → 164: counted from production-reach-allowlist.json in both trees. Before: pre-batch 62, kept-for 71, wire-format 49. After: wire-format 109, kept-for 55.
- The rest of the T bullet holds: DSH did the wave-1/2 builds and all three wave-1 reworks (dsh-runs.txt 13-22); wave-2 reworks 1 and 2 went to Claude subagents by the user's 14:41 and 18:14 decisions; the lead did rework 3 (decision 80-4).
- Last-check line: e99b385, bubblewrap, 5 workers, and build/typecheck/architecture 0 match full-TMERGE.txt.
- DSH-WORKFLOW numbers match dsh-runs.txt (360,740, 360,573, 367,721, 233,193). The IN05 facts match r3-in05.txt: 2 failures, memory and sqlite.
- The rules in t-run-W1R1b.md match the draft: no audit answers, no items files, at most 40 lines.
- Decision 85-1 is the structure round before 6A (HANDOFF:677-679); c54d00e0 is 85-5.
- The C1 items the old item 3 sent to T are done in the tree, so dropping them is not a loss: N0GoalInput 0 hits, TaskDispatchStateV1 0 hits, TaskClaimOutbox = DispatchOutboxRecord at claim-contracts.ts:92.
- The old '（不再和 T 并行）' is moot now.

Placement: the DSH-WORKFLOW bullet is inside §6.10 (heading line 294, next heading '## 7' at line 414). It is the third item of the list after the coordinator-mode/handoff table (lines 410-412), so the list is unbroken. It is a separate topic, though. Other topics in §6.10 open with a bold paragraph, and part (a) belongs with the paragraph '一个运行里的类型检查' at line 396. A bold lead paragraph would read better; this is a layout point, not an error.

The known corrections (18:14, CHANGED 14) do not occur in these four files.

Outside the hunks, not reported as findings:
- STATUS lines 42, 48, 49, 295 and 345 still send items 'to T'. DSH listed them in dsh-reply.md:9-14.
- STATUS '缺口' has no entry for the L-1 AD08 production gap that T found (t-end-list.md:8-11). The lead may want to add it after the user decides.
- The T bullet does not mention that wave 1 closed on the lead applying Codex's two patches (67d547d, d4c4cea; decision 81).

## to-T (claims 46)
- [to-T-1 CORRECTED misleading] STATUS.md:49
  problem: This is a present-tense known limit, and T is now merged. T did none of the five named things. No T item names F-067, F-066, G3, G5 or N-04, and the code at each named line is the same as before T. T touched the form rows only where its own inventory happened to reach them. Left as it is, the sentence says these are handled by T, which has finished.
  correct: Replace the last sentence of draft STATUS.md:49 with something like the text below. It keeps K3's history and states what T did and did not do.

“F-067 的完整前置手算、F-066、G3、G5、N-04 的五个超时原定进 T（§10.10）；T（2026-10-20）没有做这几项，也没列进 T 末的清单，仍未做。§10.10 的形式行，T 只顺带碰到一部分：`K3-48-2:213–217` 的手编码记录由 T1-023 换成真实链；F-027 的 K3-19 部分由 T2-022 并入 contracts（`K3-26-unknown-call-review-pure:159` 仍用生产键）；其余（如 F-014、`B2-blocked-runtime:260–271`、T-040）仍在。”

The facts behind it:
- **F-067:** The prefix C is still a stated measured literal, not a field-by-field sum: tree K3-48-2 test lines 416-417 read `156,024 + 274 + 422` and `156,105 + 274 + 341`. W2b-21 only moved these numbers by 35 bytes and added the note at :418-423.
- **F-066:** The only change is the import at tree K3-35-T-by-hand.test.ts:53. :166-168 still expects prepare `ready`.
- **G3:** K3-B3-runtime-fail-closed.test.ts is identical before and after T.
- **G5:** K3-B3-shared-rules-pure.test.ts:56 and :59 are unchanged. T2-061 only added :115 `expect(ninth.reason).toBe('guard_failed')`.
- **N-04:** K3-44-crr-kind4 tree :289 and :339 are still `300_000`. B2-09-crr-owner base :524/:536/:548 are now tree :536/:548/:560 and are still `120_000`.
- **F-014:** Not done. K3-15-blocked-omission and K3-15-blocked-sentence are unchanged.
  source: tree/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1888-1905 (§10.9 last two bullets, §10.10); tree/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/checks/k3-final-freeze.md (F-067 and N-04 rows, 'Stay in T'); diff of t-inv against tree for the files named; evidence/books/t-items-T2-w2.md:59-66 (T1-023), t-items-T3-w2.md:65 (T2-022), :690 (T3-081); evidence/bo
- [to-T-2 CORRECTED misleading] STATUS.md:295
  problem: This is a present-tense L8 known limit, and T is now merged. Most of what the L8 acceptance's 'move to T' list names was not done in T. (a) P3's fixture limits are unchanged. tree tests/helpers/S1-runtime-scenario-fixture.ts:138 still hand-builds the `missing` probe, :159 still pins `createTaskClaimFixture('sqlite', …)`, and S1-archive-cancelled-reader.test.ts is unchanged. TP-082 only deleted the unused `S1_T1`. (b) The code no public step reaches is still in production: the auto-capture replay branches at architecture-service.ts:1304, 1335, 1389 and 1426 are identical before and after, and auto-capture-driver.ts:109 still passes `new AbortController().signal`. (c) session-archive.ts:244-248 still turns `cancelled` into unavailable. host.ts:183 still keys scopes with NUL. Pub:332 (S8A-L8-reminders-public.test.ts, file unchanged) still does not read the body back. (d) These test-form items are not done either: row A, the per-await cancellation proofs (tests/helpers/S8A-L8-prepare.ts unchanged); row B, the copied trigger wrapper (S8A-L8-observation-state.test.ts:165-175 still there); J, `input = null` (Pub:235, file unchanged); and UNSPECIFIED 4. Only part of the old WP2 debt was done. T3-044 converted K4-25 to K4-41 (WP2-wiring.test.ts hand-built probes). TP-107 converted T33. T1-003 and W2b-01 converted T35. TP-108 is partial (seedRun is BLOCKED). These remain: K4-42 to K4-45 (WP2-wiring-scenario.test.ts:198 and :252 still hand-build probes); K4-46 to K4-53 (raw event reads, WP2-wiring.test.ts:56, :334, :338); T36 (task-claim-fixture.ts:292, `unsupported` stub); T37 to T49 (WP2-platform-support.ts); T59 to T69 (rows that run on SQLite only, e.g. F01 at WP2-wiring.test.ts:183); and Q6 (the SHA literals, now at :818).
  correct: Replace the line with a statement that T did not take the L8 "移到清理轮 T" list as items. Then say what T covered on the way and what is still open.

Done in T:
- T3-044 converted K4-25 to K4-41: the WP2-wiring.test.ts recordHealth at :134 now moves the Kernel aside and runs the real probe.
- TP-107 converted T33 (public bootstrap at task-claim-fixture.ts:237-262).
- T1-003, with the lead's fix W2b-01, converted T35 (real createSessionOperations.createSession at :361-372).
- T3-039 switched the S8A-L8-adoption-capture replay test to the public persistedRef.
- TP-108 is partial: seedRun is BLOCKED and still in the fixture at :450.

Still open:
- P3's fixture limits. S1-runtime-scenario-fixture.ts:138 still hand-builds the `missing` probe, and :159 still pins `createTaskClaimFixture('sqlite', …)`. T only removed `S1_T1`.
- The replay branches no public step reaches: architecture-service.ts:1304, :1335, :1389, :1426, unchanged.
- The acceptance cancellation: auto-capture-driver.ts:109 still passes `new AbortController().signal`.
- session-archive.ts:244-248 (already a separate bullet, line 294).
- The NUL scope key at host.ts:183.
- Pub:332 still does not read the body back (the file is unchanged).
- Row A (S8A-L8-prepare.ts unchanged).
- Row B: the copied wrapper is still at S8A-L8-observation-state.test.ts:165-175.
- J, and UNSPECIFIED 2-5.
- K4-42 to K4-45 (tests/scenarios/WP2-wiring-scenario.test.ts:198, :244, :252, :258) and K4-46 to K4-53 (raw reads, for example WP2-wiring.test.ts:56, :334, :338).
- T34 (task-claim-fixture.ts:324 then :345).
- T36 (the `unsupported` materials stub at :292).
- T37 to T49 (WP2-platform-support.ts) and T50 to T69.
- Q6: the SHA literals, now at WP2-wiring.test.ts:818-826.

None of the open items is on books/t-end-list.md, so the lead has to choose: put them on the end-of-T list or keep them as a dated limit.
  source: tree/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md:83-84, :91-93, :97-108; tree/.../codex/audit.out.md:143-178, :244-316, :666; checks/user-decisions-1018.md:30, :38-41; diff of t-inv against tree for the files named; evidence/books/t-items-T2-w2.md:472-479 (T3-044); t-items-TP.md:784-797 (TP-107, TP-108); t-w2b-findings.md:61 (W2b-01 on T1-003); t-items-T3-
- [to-T-3 CORRECTED misleading] dsh-reply.md:9
  problem: This is only half true. F-067, F-066, G3, G5, N-04 and P3 do have no T item. But several other things in the source lists these sentences summarise were done by T items. From K3 §10.10: T1-023 (K3-48-2:213-217), T3-081 (F-014), T2-022 (F-027), W2b-27 (F-019's stand-in), and for book 7's old-T files TP-079, TP-080, TP-144, T1-013, T1-016, T1-017, T1-018, T1-022, TP-074 to TP-076 and TP-143 to TP-146. From L8's WP2 debt: T3-044 (K4-25 to K4-41), TP-107 (T33), T1-003 (T35). The lead should not take 'no T item' to mean nothing in these lists changed.
  correct: Suggested text for the reply:

None of F-067, F-066, G3, G5, N-04 or P3 has a T item. They are unchanged after T and still open:
- G3: K3-B3-runtime-fail-closed.test.ts is unchanged.
- G5: K3-B3-shared-rules-pure.test.ts:56/59 is unchanged.
- N-04: the 300_000 timeouts at K3-44-crr-kind4.test.ts:289 and :340 are still there.
- P3: S1-runtime-scenario-fixture.ts:159 is still SQLite-only and still has the hand-made probe.

The bundled lists behind STATUS line 49 ("形式行在 T（§10）") and line 295 ("完整清单见 L8 验收") were partly done in T:
- K3 §10.10:
  - T1-023 converts K3-48-2:213–217 (done; it cites §10.10:1898).
  - The book-7 / book-9b old-T files are covered by T1-013, T1-016, T1-017, T1-018, T1-022, TP-074, TP-075, TP-076, TP-079, TP-080, TP-143, TP-144 and TP-145 (all done); TP-146 is BLOCKED.
  - T3-081 and T2-022 removed files named in F-014's and F-027's rows. Their remaining gaps are only partly closed.
- The L8 T list:
  - T3-044 makes the probes real for K4-25 to K4-41.
  - TP-107 covers T33.
  - T1-003 covers T35.
  - T3-039 deletes the auto-capture replay test.

The rest of each list stays open, including K4-42 to K4-53, T34 and T36 to T69, Q6, F-019's fake `available` probe and the P3 rows. Lines 42, 48 and 345 are history and can stay as they are. W2b-27, a rework row rather than a T item, removed only the stand-in's executeChecks path.
  source: evidence/books/t-items-T2-w2.md:59, :472; t-items-T3-w2.md:65, :690; t-items-TP.md:784; t-w2b-findings.md:61, :188; evidence/dsh/t-reply-w2-T2-a.md:16, :63 (done); tree K3 spec §10.10 (slice-K3-SPEC.md:1890-1905); L8 audit.out.md:143-159, :244-246
- [to-T-4 CONFIRMED contradiction] README.md:22
  problem: This line was not edited; it matches the tree. It still names T as the next step. The draft's own status line at :3 says T has been merged and that the next step is the user's choices on the end-of-T list. The two lines contradict each other.
  correct: At draft slices/README.md:22, replace the tail "C1 已合入（2026-10-19，`35b5f5b1`）；接着 T（决定 79；决定 84 的结构审查已做完，见决定 85），然后第 6、7 片的“提示词和上下文”一节（决定 83），冻结后先做 6A 之前的结构一轮（决定 85-1），再开 6A。" with "C1 已合入（2026-10-19，`35b5f5b1`）；T 已合入（`【lead 填】`）；接着用户在 T 结束清单（`books/t-end-list.md`）上的选择，然后第 6、7 片的“提示词和上下文”一节（决定 83），冻结后先做 6A 之前的结构一轮（决定 85-1），再开 6A。" A merge date of 2026-10-20 may be added if the lead confirms it. The draft and the book only give 2026-10-20 as the date line; the merge commit is still 【lead 填】.
  source: draft/docs/refactor/design/orchestration-2026-10/slices/README.md:3; diff of tree against draft slices/README.md (only line 3 changed); evidence/books/t-docs.md item 5
  NOTES: I checked the five STATUS sentences against the source lists. Lines 42, 48 and 345 are historical records of the 10-18 decisions and the K3 audit scope, and they are still true as history, so they are not findings. Lines 49 and 295 are present-tense known limits and now mislead (findings 1 and 2). T did not adopt the K3 §10.10 list or the L8 'move to T' list as items. It covered them only where its own whole-suite inventory reached the same files. T's books did take in C1's transfers explicitly (t-items-TP.md:60, :482). None of what is left from the K3 and L8 lists is on books/t-end-list.md.

Per-thing lines, in the form: sentence line | thing (file:line, before → after) | covered / partly / not covered | T item or evidence

49/48 | F-067 remainder (prefix C worked out field by field), K3-48-2-unknown-call-review-model-text-budget.test.ts inv :512-522 → tree :413-431 | not covered | no T item. W2b-21 only shifted the measured numbers (155,989 → 156,024; cwd 457/376 → 422/341)
49 | F-066 (public prepare refusal over capacity), K3-35-T-by-hand.test.ts:166-168 | not covered | file changed only at the :53 import (T3-081)
49 | G3, K3-B3-runtime-fail-closed.test.ts:28, :48 | not covered | file unchanged
49 | G5, K3-B3-shared-rules-pure.test.ts:56, :59 | not covered | unchanged; T2-061 added only :115
49 | N-04 five timeouts: K3-44-crr-kind4:290, 340 (tree 289, 339; 300_000) and B2-09-crr-owner:524, 536, 548 (tree 536, 548, 560; 120_000) | not covered | no T item
49 (§10.10) | K3-48-2:213-217, the hand-encoded UnknownCallReview | covered | T1-023 done (dsh/t-reply-w2-T2-a.md:16)
49 (§10.10) | B2-blocked-runtime:260-271, the hand-built WorkspaceFile | not covered | tests/helpers/B2-blocked-runtime.ts unchanged
49/48/345 | form rows (book 9b §1, book 10 ruling 2) | partly | covered: F-014 by T3-081; F-019 by W2b-27; F-027 by T2-022 and TQ-108; F-001, F-003, F-005, F-015, F-016, F-025, F-036, F-046, F-090, F-091 files touched by T2/T3/TP items. Unchanged: F-002 K3-tool-seams.ts, F-004 K3-35-prepare.ts, F-006 B2-blocked-runtime.ts with runtime/B2-02-recognition-unified, B2-05-06-denial, B2-16-hook-*; F-010 K3-crr-fixture.ts; F-011 K3-prefix-claim.ts; F-012 S1-public-anchor.ts; F-013 K-R-attested-facts-source.test.ts; F-028 (B2-03-request-tool, B2-15-replay, B2-401-world.test, B2-07-crr-card-closed, B2-18-request-reads); F-029 B2-02-recognition-unified.test.ts:228; F-048 K3-receipt-replay.test.ts. F-001's K3 world still uses the handwritten createS5Session (K3-review-card-fixture.ts:458; t-end-list.md:30)
49 (§10.10) | T-040 K3-mixed-seams.ts | not covered | unchanged
49 (§10.10) | F-093, F-095, F-096 (S3-context-assembler.test.ts); F-094 (S4C2-assembly.test.ts) | partly / not covered | T2-034, done in wave-2 rework 1 as W2b-35, converted S3 rows 384-434 and 660-661. S4C2-assembly unchanged
49 (§10.10) | book 7 §3 old T: B2-execution-fixture, B2-model-request, B2-execution-result, B2-runtime-fixture, K3-11, K3-14, K3-45, K-R-close-open-turn, B2-execution-entry | covered / partly | TP-079, TP-144, T1-013, TP-080, T1-016, T1-017, T1-018, T1-022 (work-graph/K3-45-review-incomplete deleted), TP-074 to TP-076, TP-143 to TP-146
345 | 'the rest goes to T' (group 1-3 files B3 did not touch) | covered as an audit | the T inventory spanned the whole suite (t-lead-summary §1, 11 areas). Rule sheet v2 bound only T's items (t-end-list.md:28)
42/295 | L8 auto-capture replay branches (production) | not covered | architecture-service.ts:1304, 1335, 1389, 1426 identical before and after. T3-039 only switched S8A-L8-adoption-capture's replay use to the public persistedRef
42/295 | requestAutoCapture acceptance cancellation (auto-capture-driver.ts:109) | not covered | unchanged
42/295 | failAutoCapture cancellation, rows beyond P06 | not covered | no T item; S8A-L8-observation-state changes are T3-018 and T3-019 merges of capture-start rows
42/295 | rework 3 row A (per-await proofs; requeue per-await rows) | not covered | S8A-L8-prepare.ts and S8A-L8-read-counts.test.ts unchanged
42/295 | row B (copied composition trigger wrapper), S8A-L8-observation-state.test.ts:165-175 | not covered | still there
42/295 | J (`input = null`), S8A-L8-reminders-public.test.ts:235 | not covered | file unchanged
42/295 | rework 3 UNSPECIFIED 2-5 | not covered | no T item
295 | P3: hand-built health probe (S1-runtime-scenario-fixture.ts inv :139 → tree :138), own archive composition, SQLite only (:159) | not covered | only TP-082 deleted S1_T1
295 | WP2 debt K4-25 to K4-41 (WP2-wiring hand-built probes) | covered | T3-044 done
295 | K4-42 to K4-45 (WP2-wiring-scenario:197-257) and K4-46 to K4-53 (raw event reads) | not covered | tree WP2-wiring-scenario.test.ts:198, :252; WP2-wiring.test.ts:56, :334, :338
295 | T33 (task-claim-fixture governance/Project/Workspace) | covered | TP-107 done; TP-108 partial (seedRun BLOCKED)
295 | T35 (task-claim-fixture Kernel/Session) | covered | T1-003 and W2b-01
295 | T36 (materials `unsupported` stub, tree task-claim-fixture.ts:292), T37 to T49 (WP2-platform-support.ts), T59 to T69 (SQLite-only WP2 rows) | not covered | no T item
295 | Q6 (SHA literals, WP2-wiring inv :798 → tree :818) | not covered | unchanged
295 | host.ts:183 NUL scope key | not covered | unchanged
295 | Pub:332 body not read back | not covered | file unchanged
295 (L8 acceptance :83) | session-archive.ts:244-248 cancelled → unavailable | not covered | unchanged; STATUS draft :292 still lists it, correctly

Method: I compared files between D:/cxt/t-inv and D:/cxt/t-docs/tree with diff, and searched evidence/books/t-items-*.md, t-final.json, the T finding tables and the DSH replies for each id and file name. node and python are not on this machine, so I used bash, grep and diff only.

## critic (claims 142)
- [critic-1 omission] lead-acceptance.md:5
  problem: The acceptance leaves out every lead merge and merge fix in summary §4, although the C1 counterpart has bullets for both ('合并时的修复', '合并'). Missing items: (a) the wave-1 merge `11d46d5`. TQ's diff `t-base..5057649` was applied onto TP's `efa65cd` with a three-way patch. Two files conflicted. The allowlist was merged entry by entry on (file, name): base 182, TP 177, TQ 169, result 164, and no entry was changed by both sides. `S5-decision-fixture.ts` kept TP's version, and TQ's edit to it, which was outside TQ's whitelist, was dropped. Typecheck 0 and check:architecture OK. (b) The lead fix `5daea2e`: R4b-session-directory seeds a current-format ArchitectureCatalog row. The acceptance never names `5daea2e`. (c) The wave-2 merge `4807e64`, with one conflict on the re-export line of `tests/helpers/K3-35-continuation-fixture.ts` (T2 removed baseBrief/G/sha/task, T3 removed G/task), resolved by taking the T1+T2 side. The lead patch files `checks/t-lead-fix-P1.patch` and `checks/t-lead-fix-W1R3.diff` are not cited either.
  correct: Add a merge and lead-fix bullet group: 11d46d5 (method, allowlist 182/177/169 → 164 with no conflicting entry, S5 fixture takes TP's side, TQ's off-whitelist edit dropped), 5daea2e, 67d547d/d4c4cea (with the patch files), the 4807e64 conflict and how it was resolved, and 9a69bdb.
  source: books/t-lead-summary.md:54-55, :136-150; books/t-audit-merge-notes.md:3-23; tree/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:5-6
- [critic-2 omission] lead-acceptance.md:106
  problem: The lead's own edits in wave-2 rework 1 are missing. The lead applied W2b-12 itself (the name prints the third label value). Rows W2b-37/39/40/41/43/45/51 were applied by the lead from one agent's patch after the Edit hook refused that agent. The lead removed the now-unused `SessionRef` import (W2b-07). Summary §4 also lists W2b-01 (task-claim-fixture passes `meta: { requestId: `admit-${requestId}` }`, R-15) as a lead fix. Neither draft names the per-copy commits (9b5c10a, 3e8f580, ed47f57, 3317425, e94ad5d, 3d05d71) or the checks run on 722ddf3 (typecheck 0, check:architecture OK).
  correct: State that the lead applied W2b-12, applied the refused agent's patch for rows 37/39/40/41/43/45/51, removed the unused SessionRef import (and W2b-01 per summary §4), and committed per copy before merging to 722ddf3. Typecheck 0, architecture OK.
  source: books/t-lead-summary.md:147-149; books/t-w2b-findings.md:157-163, :172, :176
- [critic-3 omission] lead-acceptance.md:106
  problem: Summary §6 lists the assertion-ledger check as one of T's checks, and neither draft records it. In that check every REMOVED or LOOSENED line is mapped to an item or a row. The ledgers are: wave 1 and the wave-2 build in `dsh/ledger-*.txt`; W2R1 `checks/ledger-W2R1.txt` (88 lines and 2 deleted files, each mapped, no unplanned deletion); W2R2 `checks/ledger-W2R2.txt` (9 removed assertions and 2 removed tests, each mapped); W2R3 `checks/ledger-W2R3.txt` (0 lines). The acceptance says how each table was closed but never says that no unplanned assertion deletion was found.
  correct: Add one line per rework, or a short '账本' bullet: wave 1 and the build in dsh/ledger-*.txt; W2R1 88 lines + 2 deleted files, all mapped; W2R2 9 assertions + 2 tests, all mapped; W2R3 0; no unplanned deletion.
  source: books/t-lead-summary.md:205-207; books/t-w2b-findings.md:162-165; books/t-w2r2-findings.md:91-96
- [critic-4 omission] README.md:27
  problem: Neither draft records the lead's rulings on the inventory. (1) The conflicts were ruled as the skeptics judged: Codex side 86, DSH side 43, neither 2, 131 in all. (2) The 9 refuted P1 keeps became deletes. (3) The Role writer chain was kept, with its notes rewritten to decision 6 and MVP-BEHAVIOR B01. (The C1 transfers and RL-15b are covered.) The README gives only the match workflow's figures. Because it cites t-final-summary.txt, which counts 131 conflict rows, 'conflict 133' reads as the final count.
  correct: Add the inventory rulings: 131 conflicts settled as the skeptics judged (Codex 86, DSH 43, neither 2); 9 refuted P1 keeps → delete; Role writer chain kept with its notes rewritten to decision 6 / MVP-BEHAVIOR B01. Say that 133 is the match workflow's count and 131 is the final table's.
  source: books/t-lead-summary.md:28, :31-33; books/t-final-summary.txt:3-4
- [critic-5 omission] lead-acceptance.md:150
  problem: Several lead items appear in no draft. (1) Summary §5 ends with the t-w2r2 §0 note: rule sheet v2's A7 entry 3 still says `executeChecks: false`, which no longer exists after W2b-27, and the next sheet must also be reconciled with the K3/L8 sheet v3 (A7 pass-through sandbox entry, crash-fixture wording). (2) The end list's 'The lead's own' items: the 293 unused names under --noUnusedLocals (12 in files T touched, all older than T; note only), and merging the v2 and v3 rule sheets before the next slice. (Decision 83-3 is already reported, and the capabilities stub line is fixed.) These are open to-dos and are recorded nowhere.
  correct: Add the A7-entry-3 / v3 reconciliation note after R-24, and add a 'lead 自己的' list: next rule sheet (v2+v3 merged, A7 entry 3 wording), 293 unused names (note only), the decision-83-3 contradiction.
  source: books/t-lead-summary.md:183-186, :240-243; books/t-end-list.md:40-51; books/t-w2r2-findings.md:30-33
- [critic-6 omission] lead-acceptance.md:107
  problem: W2b-18's result leaves an open lead item that the drafts, and the end list too, leave out. 'the SV03 cover post-note is still for the lead'. W2b-18 moved SV03's 'lookup and index rebuild write nothing' cover to `tests/record-store/lookup.test.ts`, and the row says 'The lead writes the cover post-note.' The slice-1 spec's SV03 row (tree slice-1-SPEC.md:956) still describes the old-format Outbox world.
  correct: Record the open lead item: write the SV03 cover post-note (now covered at tests/record-store/lookup.test.ts:101, :201) in slice-1-SPEC SV03.
  source: books/t-w2b-findings.md:78, :180; tree/docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:956
- [critic-7 omission] lead-acceptance.md:29
  problem: W2b-47 restored the deleted case of `tests/data/S8D-platform-fixture.test.ts` exactly. The table and its result say 'T3-067 for this case: not done'. So part of item T3-067 ended undone after the reworks, and no draft records it. The segment-a counts in the table are not wrong, but the wave-2 outcome bullets leave this out while they do give later outcomes for the other items.
  correct: Add a bullet: T3-067 — W2b-47 restored the deleted second-capture case (h.py → g.py edge, Python file count 3); T3-067 is not done for that case.
  source: books/t-w2b-findings.md:117, :195
- [critic-8 misleading] README.md:82
  problem: Decision 81-1 says the three rounds count only DSH reworks, and 'Codex 写测试补丁、Opus 修、lead 小改都不算轮'. The C1 README counts the same way ('只数 DSH 返工'). In wave 2, reworks 1 and 2 were Claude subagents and rework 3 was the lead, so by 81-1 wave 2 had 0 DSH reworks. '3 轮' matches the tables' own framing ('rework n of at most 3') and the book's request, but stated as 'decision 81's count' it misstates the rule.
  correct: e.g. '按冻结表数：wave 1 三轮都是 DSH；wave 2 三轮里返工 1、2 是 Claude 子 agent、返工 3 是 lead（按 81-1 只数 DSH 的口径，wave 2 是 0 轮）。'
  source: tree/docs/refactor/HANDOFF.md:626; tree/docs/refactor/DSH-WORKFLOW.md:452; tree/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md (过程, first bullet); books/t-w2b-findings.md:12; books/t-docs.md:67-68
- [critic-9 wrong] README.md:79
  problem: This makes the same error as the DSH-WORKFLOW:412 finding, in a second draft, so both need the fix. TP did not run unlocked: it switched to `./.typecheck.lock` itself. Only TQ ran without a lock, and TQ2 ran plain typecheck as the lead ruled. The in-copy lock started in wave-1 rework 1, not wave 2: t-run-W1R1, W1R1b, W1R2 and W1R3 all name `./.typecheck.lock`. Summary §3 item 6 carries the same simplification.
  correct: 'wave 1 书里的机器级 flock 锁在 DSH 沙箱外：TP 自己改用副本内 ./.typecheck.lock，TQ 没带锁；从 wave 1 返工 1 起各书都用副本内的锁。'
  source: dsh/tb-TP-final.md:21; dsh/t-reply-TP.md:218; dsh/t-reply-TQ.md:58, :85; books/t-run-TP.md:30; books/t-run-W1R1.md:42; books/t-run-W1R2.md:43; books/t-run-W1R3.md:37; books/t-lead-summary.md:126-127
- [critic-10 omission] README.md:82
  problem: The frozen wave-2 table records a fifth book error. The lead left `tests/scenarios/K3-19-review-unavailable.test.ts` off T2's whitelist by mistake; it is on T1's list. T2-040 and T2-042 had to edit it, and the edit was accepted as a DSH adaptation (Codex C T2a-13). The README's list at line 79 and the count at line 82 leave it out.
  correct: Five book errors: add 'K3-19-review-unavailable.test.ts 漏在 T2 白名单外（T2-040/T2-042，作为接受的适配）'.
  source: books/t-w2b-findings.md:50-51, :146; books/t-files-T1-w2.txt:18
- [critic-11 wrong] README.md:30
  problem: The README:29 finding covers the TP row, but the same mis-crediting is on the TQ row and the wave-2 rows. TQ made no commit of its own; TQ's work was committed as `5057649` in the TQ2 segment, and `11d46d5` is the lead's wave-1 merge. `4807e64` is the lead's wave-2 merge, which had one conflict. T1 committed `5ec8f5e`, `43532e3` and `4c160fa`, and T3's commit was `54380f7`. The table has no wave-2 merge row, so the conflict resolution is not shown.
  correct: TQ: 提交 '—（TQ2 提交 5057649）'. T1: 5ec8f5e/43532e3/4c160fa; T3: 54380f7. Add a 'wave 2 合并 | lead | 4807e64（一处冲突，取 T1+T2 侧）' row, with the W2a suite on it.
  source: books/t-audit-merge-notes.md:3-6; dsh/tb2-T1-a-final.md:5; checks/w2-env-T3.txt:1; books/t-lead-summary.md:89, :145-146
- [critic-12 contradiction] DSH-WORKFLOW.md:411
  problem: This is left unchanged right above the new T bullet (line 412), which says TQ, W1R1 segment 1 and W1R2 reached the 360K limit. dsh-runs.txt shows all three stopped with 'handoff:context (… > 360000)' in real runs, and K3 group 1 had stopped at 360,000 too (STATUS:48). The two adjacent lines contradict each other.
  correct: Rewrite 411: handoff has fired in real runs (K3 group 1; T: TQ 360,740, W1R1 segment 1 360,573, W1R2 367,721), not only in the trial.
  source: checks/dsh-runs.txt (rows tb-TQ-1019, tb-W1R1-1019, tb-W1R2-1020); draft/docs/refactor/STATUS.md:48
- [critic-13 bad-path] DSH-WORKFLOW.md:412
  problem: This path is relative to the T evidence folder, so it does not resolve from docs/refactor/DSH-WORKFLOW.md. The STATUS:351 finding names the same bare-path problem in STATUS, AGENTS and slices/README, but not in this file.
  correct: `reviews/evidence/orchestration-cleanup-T-2026-10-19/books/t-run-W1R1b.md` (as a link, once the lead has copied the material).
  source: books/t-docs.md:123-125 (the evidence-relative rule applies only inside the evidence folder)
- [critic-14 omission] lead-acceptance.md:105
  problem: The W1 suite's failures are explained in the acceptance at line 81, but the W2a suite's 8 failures are not. Per the summary they were id shifts from one shared helper and 30 s timeouts on scale rows. In the table: W2b-01 [FS] is the task-claim-fixture requestId shift (2B-26 on both backends, F11 [sqlite], M08), and W2b-03 (1000 filler Sessions, timed out at 30 s), W2b-08 [FS] and W2b-20 [FS] are the timeouts. These causes are why R-15, R-14 and R-22 exist.
  correct: Add: '8 条失败：共享 helper 移动了 id（W2b-01，R-15）和 scale 行 30 s 超时（W2b-03、W2b-08、W2b-20）'.
  source: books/t-lead-summary.md:89-90; books/t-w2b-findings.md:61, :63, :68, :85
- [critic-15 omission] lead-acceptance.md:14
  problem: Deviation 4 is missing from the acceptance. The lead started Claude workflows on rework-1 rows at 14:31 and 14:40, before the user's 14:41 decision. Read with line 15, the text suggests all Claude rework work came after 14:41. The README (line 77) records it; the acceptance's list of deviations (line 18) covers only reworks 1 and 2.
  correct: Add: '14:41 之前（14:31、14:40）lead 已用两个工作流做返工 1 的行（5 个、8 个 agent），同样过审、过账本、过审查。'
  source: books/t-lead-summary.md:97-99, :121-122; checks/claude-workflows.txt (rows 2026-10-20T07:01 27.3 min, 06:56 15.8 min)
- [critic-16 omission] lead-acceptance.md:11
  problem: The user's decisions section leaves out the user's approval of the dev dependency `@vitest/coverage-v8` 4.1.10, which was committed as `47cc63e8` and not pushed. The merge copy rests on it (line 6), and it is the only change outside T's commits.
  correct: Add: 'T 前覆盖率要的开发依赖 `@vitest/coverage-v8` 4.1.10 经用户同意，提交为 `47cc63e8`（未推送）。'
  source: books/t-lead-summary.md:34-35
- [critic-17 omission] lead-acceptance.md:164
  problem: The coverage-before check needs more detail. It was a Claude subagent run in copy s9tcov, 13:29–15:25, and it ran twice. Run 1 wrote no report, because coverage.reportOnFailure defaults to false. Both runs had the same 13 failing tests, all in tests/architecture/boundaries.test.ts, rejecting the then-unapproved dependency @vitest/coverage-v8. So the numbers come from run 2 of a suite with 13 expected failures. The README's round table and totals leave out this run too.
  correct: Add: 'Claude 子 agent 在 s9tcov 跑（13:29–15:25），第二次带 --coverage.reportOnFailure；两次都只有 boundaries.test.ts 的 13 项失败（未批准的 @vitest/coverage-v8）'.
  source: coverage/before-summary.txt:2-3; books/t-lead-summary.md:34
- [critic-18 omission] lead-acceptance.md:181
  problem: The two recorded lead sandbox runs are neither cited nor given results. (1) `checks/r3-in05.txt` (04:45, 254617d): S3-context-inputs 2 failed (IN05 on both backends, lookup index session-anomaly-by-task not registered), 30 passed; IN11 passed. (2) `checks/w2-env-T3.txt` (13:34, T3 at 54380f7): 10 files, 71 passed, 1 failed (K3-07, missing dist build output). The book lists both files as material.
  correct: Add the two runs with their results and cite checks/r3-in05.txt and checks/w2-env-T3.txt.
  source: checks/r3-in05.txt:1-10; checks/w2-env-T3.txt:1-8; books/t-docs.md:45
- [critic-19 omission] STATE-MACHINES-SPEC.md:5277
  problem: This is a long-lived spec that T made stale, and the drafts do not touch it or list it for the lead. T deleted session-provenance-facts.ts and the backfill (TP-062, TP-007), and `legacy_provenance_backfilled` has 0 hits in src (4 before T). The same spec still lists `replyMode` as a SessionMessage field and send flag (:3293, :3308, :3344). TP-031 removed replyMode, which has 0 hits in src or tests (39 in src before T). Specs are the lead's to edit, but nothing in the drafts or the end list carries this forward.
  correct: Add to the lead's own list: update STATE-MACHINES-SPEC S1-SES-02 (:5277) and the replyMode rows (:3293, :3308, :3344) for TP-062/TP-007 and TP-031.
  source: books/t-items-TP.md:51, :224, :448; grep of tree/src (0 hits) vs /d/cxt/t-inv/src
- [critic-20 omission] workspace.md:31
  problem: The WorkspaceTools module design doc lists files and a test that T deleted as current module members: `src/core/workspace/project-source-index.ts` (TP-026), `role-source-reader.ts` (TQ-089) and `tests/data/project-source-index.test.ts`. The drafts fix only the capabilities rows WS5 and role-source-reader, not this doc. (module-dag.md:153 also names session-provenance-facts.ts, but in a list dated 2026-10-09.)
  correct: List for the lead: add a dated note to modules/core/workspace.md §2/§3/§9 saying these files were deleted in T (or point to capabilities WS5).
  source: checks/t-files-deleted-added.txt; books/t-items-TP.md:186; books/t-items-TQ.md:555
- [critic-21 omission] DSH-WORKFLOW.md:454
  problem: DSH-WORKFLOW §7.1 still gives rule sheet v1 as the rule set. T ran under v2, which changed A1: a value a public route or tool receives is a public input even when its type is called a draft, plus the A7 entries. K3/L8 has v3, and the end list asks that v2 and v3 be merged before the next slice. The draft adds a T bullet to §6.10 but leaves §7.1 unchanged and says nothing of v2 or v3.
  correct: At least a pointer in §7.1: v2 (T, books/test-rule-sheet-v2.md) and v3 (K3/L8) supersede parts of v1; one merged sheet is due before the next slice (lead item).
  source: books/t-end-list.md:47-49; books/t-w1-findings.md:13-18 (R-1); books/t-lead-summary.md:183-186
  NOTES: These are all new, beyond the listed findings. The most important: the acceptance has no merge or lead-fix section (11d46d5/5daea2e/4807e64 and the lead's edits in W2R1). Neither draft mentions the assertion ledgers. The inventory rulings are missing. The lead items are missing: the rule-sheet A7/v3 note, the 293 unused names, and the SV03 post-note left over from W2b-18, which is missing from the end list too. T3-067 is partly not done (W2b-47). README:82's 'decision-81 count 3 and 3' conflicts with 81-1. README:79 repeats the typecheck-lock error. A fifth book error is recorded (the K3-19 whitelist slip). DSH-WORKFLOW:411 is now contradicted by line 412. Stale long-lived docs: STATE-MACHINES-SPEC (S1-SES-02 backfill, replyMode), modules/core/workspace.md, DSH-WORKFLOW §7.1 (rule sheet v1). Checked and found clean: MVP-BEHAVIOR, docs/AGENTS.md, and root AGENTS.md (no reference to deleted files or removed behaviour). Root README.md's status line (2026-10-13) was already stale before T; I did not report it. IMPLEMENTED-CAPABILITIES:85 (AG2b, replyMode) sits under the history heading; I did not report it. Sources disagree with each other in places (not draft errors): t-w2b's header says frozen 15:00 vs the summary's 14:38; t-w2r2 says frozen 18:30 while its agents ran 18:16–18:24; summary §4 calls W2b-01 a lead fix while t-w2b §6 says subagents did every row except W2b-12 and the patched rows.
