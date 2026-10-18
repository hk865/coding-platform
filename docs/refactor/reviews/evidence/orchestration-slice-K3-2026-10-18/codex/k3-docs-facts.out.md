全程只读，未写文件、未运行测试。下列 `books/`、`dsh/`、`codex/`、`checks/` 均相对于 `.dsh-ref/evidence/`；“证据 README”和“验收”指 K3 证据目录中的两个文件。

1. **[验收:46](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:46)：错误地声称没有合并审查。** `codex/k3-merge-check.out.md:1、21–27` 明确报告 **1 类必须修复、3 处遗漏**。当前代码仍分别吞掉取消：`src/core/agent-runtime/context-assembler.ts:1086、1132`、`execution-preparation.ts:156`，且后者 `:170` 写 baseline 前没有取消检查。因此验收 `:43`“两边检查都保留”也必须加此例外，不能遗漏尚未关闭的 M1。

2. **[证据 README:59](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:59)：第 10 轮全量数字混用了 DSH 子集检查。** 正确全量是 **716 文件全过，9,559 过、5 跳过，2,834.25 秒，峰值 4,945,887,232 字节**，来源 `checks/r10-full-suite.txt:1–5`；规格 `:1865` 的这组数字正确。6,134／68／29 属于 DSH 沙箱中的 **375 文件子集**，来源 `dsh/k3-g4b3-rework10-final.md:24`，应另列并标明口径。

3. **[slice-K3-SPEC.md:1865](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1865)：第 9b 轮失败归因和“12 项首例”错误。** 122 项并非全是 prepare 拒绝，失败表还含 `production-reach`，见 `checks/r9b-full-suite.txt:31`；book 10 明确要求修审查读口接线及删除四个过时 allowlist 项，见 `books/k3-g4b3-rework-10.md:41–57`。K3-12／review-preparation 的 12 项是**之后合并 L8 时的 materials 漂移**，不是第 9b 轮首例，见 `.dsh-ref/k3-docs.md:14`。

4. **[证据 README:84](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:84)：第五项“矛盾更正”没有依据。** 第 10 轮回复没有给“外面 20 个文件”的实际名单，不能声称已依据名单证明两者属于不同集合。`books/k3-g4b3-rework-10.md:25–29` 是 20 个 K3 文件加 9 个外部文件；`dsh/k3-g4b3-rework10-final.md:24` 的“外面 20 个、41/41”与之口径不明。应保留此差异，并以两份原始全量结果作为验收数字。

5. **[slice-K3-SPEC.md:1859](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1859)、[证据 README:56、75](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:56)：102 行的分类少算 F-102。** 25＋76＝101。分类材料是 **101 行：生产 25＝5＋20，测试 76＝20＋56**；追加 F-102 后应为 **102 行：生产 26＝6 个行为问题＋20 个整洁项，测试仍 76**。来源 `checks/k3-business-classification.md:6、49、80、208`，追加见 `books/k3-g4b3-rework-9b.md:40–54`。

6. **[slice-K3-SPEC.md:1847、1858](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1847)：把逐次补表写成一次冻结 102 行，并引用不存在的 F-102 原表行。** `codex/k3-merge.out.md` 原表到 F-097；book 9 新增 F-098–F-101，book 9b 再加 F-102。应引用 `books/k3-g4b3-rework-9.md:115–154` 和 `books/k3-g4b3-rework-9b.md:40`；“不再增加裁定”应对应最终冻结 `checks/k3-final-freeze.md:5`，不能提前套在首次全审上。

7. **[证据 README:38、49、52–54](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:38)：多轮必改项计数不符声明的口径。** B1 初审是 **8 必改＋1 建议**，不是 9 必改（`books/k3-g4b1-rework-1.md:16`）；B3 review3 去掉重复汇总后有 **7 个独立必改点**（`:5、17、19、21、23〔两项〕、25`），不是 5；review6 应补 **6**（`:15–27`）；review7 有 **4**（`:16、18、20、22`）；review8 有 **5**（`:7、9、15、17、22`），草稿漏了 UNSPECIFIED 2。

8. **[证据 README:55、57](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:55)：两份检查放错轮次。** `k3-mutation-r9b.txt` 是对 **9b** 的检查，不是返工 8；`k3-verify9.out.md` 核的是 **9a＋9b**，不能只挂作 9a 的结论。来源 `books/k3-g4b3-rework-10.md:20–24`。

9. **[证据 README:25–40](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:25)：已有 lead 检查却大量填“—”。** 例如 group 3 首轮有 bwrap 检查 **83 文件、4,271 过、1 失败**（`books/k3-g3-impl-2.md:23`）；B1 施工有 **239 文件、5,156 测试通过**（`books/k3-g4b1-rework-1.md:15`）。任务 `.dsh-ref/k3-docs.md:22` 要求逐轮列 lead 检查，不能省成无记录。

10. **[证据 README:82](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:82)：T＝600 的“更正”为 16,385 不成立。** 第 10 轮最终清单没有作此裁定。当前纯极值测试的必需段为 **16,396＝16,384＋12**，见 `tests/runtime/K3-35-renderer-boundary-pure.test.ts:291–304`；真实单条路径的 T＝600 为 **12,764**，见 `tests/runtime/K3-35-T-by-hand.test.ts:25–45`。应分别记录，不能选一个历史值作为统一最终总数。

11. **[slice-K3-SPEC.md:1790](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1790)：第 4 组“四段”写成“三段”。** 正确是 **g4 整体四段；其中 g4b 从两段改为三段**。`books/k3-g4b-rulings.md:3–9` 的主语是 g4b。证据 README `:83` 的最终四段结论正确，但对原材料“两段→三段”的解释也应明确主语。

12. **[slice-K3-SPEC.md:13、1786](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1786)、[验收:18、25、66](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:18)：继续采用已撤回的多条目 owner 造态裁定。** 最终规则是：真实单条链保留；多条目转无存储纯测试，没有对应纯函数则删除该不可达行。不得再写“纯函数和 owner 层证明”、真实三类混合或注入 31／32 条仍由真实 Kernel 产生。来源 `books/k3-b3-rulings-v1.md:16–25`、`books/k3-g4b3-rework-5.md:27–30`；当前真实条目数见 `tests/runtime/K3-35-T-by-hand.test.ts:20–23`。

13. **[slice-K3-SPEC.md:1787、1866](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1787)、[验收:11](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:11)：queued-steer 并未替换成暂停。** 正确替换是：**排队插话＋其余守卫成立→RUN-25／W-26；Kernel 已接受则 Applied，否则 Superseded，接续说明保留文字**。来源 `books/k3-g2-impl-3.md:37–42`、`dsh/k3-g2c-final.md:13`。Applied pause 不可达是另一条结论。

14. **[slice-K3-SPEC.md:1787–1788](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1787)：源码行号和 UNSPECIFIED 来源过时。** 当前 `steered` 无 writer 注释在 `src/core/work-graph/state/run-machine.ts:190–191`；在途调用拒绝在 `:2161–2162、2345`。`2110／2294` 已不是所述守卫。不可达报告来自 `dsh/k3-g2c-final.md:16、34`，不是 book 3 的“UNSPECIFIED”章节。

15. **[slice-K3-SPEC.md:1796](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1796)：固定分派表及未知工具结果写错。** 当前有 mailbox、decision、plan、notes、CRR 五组；未匹配返回 **`{status:'undetermined', reason:'lookup_not_published'}`**，不是 `unknown_tool`。见 `src/composition/tool-commit-lookup.ts:19–35、48`。正确裁定来源为 `books/k3-g3-impl.md:34–38`。

16. **[slice-K3-SPEC.md:1785、1789、1791、1797、1802–1806](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1785)：这些来源编号不能支持相应句子。** 应分别改为：U1–**U8 加后续未编号条目**（`books/k3-g1-impl.md:94–115`）；后移 `listUnappliedAnswers`（`k3-g3-impl.md:142–146`）；运行时不截断（`k3-g2-impl.md:124–141`）；统一请求号（`k3-g3-impl.md:40–50`）；忽略路径／链接及脏基准／双编辑（同书 `:77–81／62–76／99–102`）；second-cleanup（`k3-g3-impl-2.md:128–139`）。草稿所引 g2 impl-2、g2 impl-3 §8、g3 impl-2 §3 第 5–9 条、g3 impl-6 第 8 条等均对应不上。

17. **[slice-K3-SPEC.md:1810–1814](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1810)、[证据 README:30](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:30)：R1–R5 错归第四次施工书。** 五条实际都在 **`books/k3-g3-impl-2.md:30–54`（§2）**；应修正文献及轮次归属。

18. **[slice-K3-SPEC.md:1822、1829–1830、1841–1843](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1822)：B1／B2 多处节号或书名错误。** SQLite 重启裁定在 `books/k3-g4b1-rework-1.md:113–115`；按答复 reviewRef 恢复在 `k3-g4b1-impl.md:149–156`；Goal 提交守卫在 `k3-g4b1-rework-1.md:25–30`；审批文字、单位、B2/B3 分工分别在 `k3-g4b2-impl.md` **§8.1–3、§8.7、§8.9**（`:139–181`），不是所引 §2 第 3–7 条。

19. **[slice-K3-SPEC.md:1803](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1803)：`unknown` 标签缺少条件。** Artifact 不可读且路径不在样本中，还必须是**样本确实截断**，即 `changedCount > sample.length`，并先排除 `notVisible`；完整样本中没有该路径时返回 `unchanged`。见 `src/core/agent-runtime/continuation-brief-assembly.ts:244–255`，裁定也有此条件（`books/k3-g3-impl.md:70–73`）。

20. **[slice-K3-SPEC.md:1820](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1820)：UCR 非落实事件的 `proof` 不是 `null`。** 应**省略字段**；只有 `disposition_applied／approval_applied` 必须有对象 proof。`proof:null` 会被解码拒绝。来源 `books/k3-g4b1-impl.md:199–200`；代码 `src/core/work-graph/tasks/unknown-call-review-codecs.ts:641–645`。不要套用 CRR 的 null 约定。

21. **[slice-K3-SPEC.md:1830](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1830)：“只有内容基础变了才拒绝”错误。** 同次提交的 Goal revision 守卫也可能因并发暂停等返回 `revision_conflict`，暂停期间还可能 `busy`。正确是区分 **T02 内容变化**和**版本竞争**；后者重新读取后可在恢复时落实。见 `books/k3-g4b1-rework-2.md:29–37`。

22. **[slice-K3-SPEC.md:1842](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1842)：混淆工具参数与 owner 的 `cwd`。** 工具显式 `null` 是 `invalid_arguments`；省略会转成 owner 的 `null`，渲染为 `"."`；owner 本身接受 null，拒绝空串。见 `books/k3-g4b2-rework-1.md:38–40`、`src/core/work-graph/tasks/unknown-call-review-service.ts:690–702`。

23. **[slice-K3-SPEC.md:1845](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1845)：`CommandRerunRequestReplyV1` 是 owner 返回值，不是模型拿到的工具结果。** 工具将它映射为 L19a 的结果 union；无写 pending／allowed 分支还携带等待中的 command。见 `books/k3-g4b3-rework-1.md:56–64`、`src/core/work-graph/model/command-rerun-request-contracts.ts:22–36`、`src/core/agent-runtime/command-rerun-tools.ts:97–129`。“§§56–64”也应改成 §2 第 8 条或行号。

24. **[slice-K3-SPEC.md:1846](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1846)：把两项无关裁定接成同一行为。** closed Task 对应的 prepare 可 ready、随后 start 被拒，意味着没有执行；`run_crashed` 的接受范围则是 **B2-16／B2-18 的 401-world 读取计数前置**，来自 `beforeReply` 故障。应分开写，来源 `books/k3-g4b3-rework-5.md:31–34、44–46`。

25. **[证据 README:8](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/README.md:8)、[IMPLEMENTED-CAPABILITIES.md:263](D:/cxt/k3-docs-review/docs/refactor/IMPLEMENTED-CAPABILITIES.md:263)：把 UCR 能力套给 CRR。** hold/release 属于 UCR；CRR 没有这两个操作，答复选项是 **allow_rerun／deny／deny_final 三个**。见 `src/core/work-graph/model/command-rerun-request-contracts.ts:81–116`。WG60 的“四个选项”应明确限定为 UCR 处置卡。

26. **[验收:38](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:38)：“进 T 的 76 行”不是最终待办数。** 20＋56 是历史分类数量，不能直接当剩余 T 数量；其中 F-098、F-099 等已经修好。F-099 的关闭见 `codex/k3-verify9.out.md:41`，F-098 关闭见 `codex/k3-final-list.out.md:104`。应按最终逐项处置列剩余项，再计数。

27. **[验收:33](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:33)：N-02、N-03 不应列作进 T。** 最终冻结将 N-02 接受为获准替换，N-03 接受为局部删减；只有 N-04 的新增超时记入 T。来源 `checks/k3-final-freeze.md:11–13`；草稿自身 `:37` 已正确写出，前后矛盾。

28. **[验收:30–38](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:30)：没有完成任务要求的“每个冻结行如何关闭或进 T”。** 只有部分编号和分类总数，没有 F-001–F-102 的可追溯处置；例如已修的 F-099 完全未列，不能由“整洁项全进 T”代替。任务要求见 `.dsh-ref/k3-docs.md:23`，F-099 结论见 `codex/k3-verify9.out.md:41`。

29. **[slice-K3-SPEC.md:1891](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1891)：T-040 被反向记录。** `books/k3-g4b3-rework-9.md:49` 明确说 **`K3-mixed-seams.ts`（T-040）留在 T**。§10.10 中应写“在 T”，不能写“不在”。

30. **[slice-K3-SPEC.md:1891](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1891)：F-093–F-096 并非四条保护缺口。** F-093、094、095 是 protection_gap；**F-096 是 form_only**。见 `checks/k3-business-classification.md:192–195`。这也解释了 20 条保护缺口排除旧片三条后为何剩 17。

31. **[验收:53](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:53)：把早期遗漏继续写成最终 T。** K3-48（三）的 SQLite 行后来已补，当前 `tests/work-graph/K3-48-3-required-writes.test.ts:55` 明确参数化 memory／sqlite；补齐记录见 `dsh/k3-g4a-rework1-final.md:19`。K3-29 的后续变体也已被 B1 明确要求并落实，见 `books/k3-g4b1-rework-1.md:117–124`、`tests/scenarios/K3-29-startup-variants.test.ts:97、125、173`。不能只据最早 4A 回复判它们仍在 T。

32. **[slice-K3-SPEC.md:1876](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1876)、[验收:54、65](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:54)：扩大了 K3-08（二）的不可达范围。** 不可达的是**同批 wait-send 与命令同时在途**；核对轮期间向原 Session 投递待处理消息、核对轮不接受而接续接受，仍有真实测试。见 `tests/scenarios/K3-08-wait-reply.test.ts:192–199、231–233`。正确来源是 `dsh/k3-g4a-final.md:33`，不存在 `books/k3-g4a-final.md`。

33. **[验收:55](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:55)：不存在所称“读不出时 prepare 跳过”的最终裁定。** 所引 4A UNSPECIFIED 2 是 wait-send 不可达，7 是领取守卫，见 `dsh/k3-g4a-final.md:33、38`。当前 prepare 对 review 读取非 ready 直接返回失败，closure 读取失败也返回拒绝，见 `src/core/agent-runtime/execution-preparation.ts:428–452`。应删除这项错误“已知限制”。

34. **[验收:27](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:27)：B2-18 页数公式漏掉空集的一次读取。** 最终裁定是 **`max(1, ceil(R/200))`**；R＝0／1／200／201 时分别为 1／1／1／2。来源 `books/k3-g4b3-rework-9.md:122–123`，不是无条件 `ceil(R/200)`。

35. **[验收:63](D:/cxt/k3-docs-review/docs/refactor/reviews/evidence/orchestration-slice-K3-2026-10-18/lead-acceptance.md:63)：没有证据证明 K3-07“只失败在缺 bwrap”。** 草稿 `:61` 已承认没有该行单独运行记录；现有全量汇总不能补出其故障原因。应保留“未找到 K3-07 独立验收记录”，不要把其他 bwrap 失败推广到该行；也没有已批准将它移 T 的来源。

36. **[slice-K3-SPEC.md:1868–1878](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1868)：漏记明确要求写入规格的两项已知限制。** Q-15 是前 16 个动作仍超过 16 KiB 时继续裁剪的限制；Q-17 是必需段占满预算时省略提示可能消失。问题原文在 `codex/k3-merge.out.md:739、741`；`books/k3-g4b3-rework-9.md:145` 明确要求本轮不改、由 lead 写进规格。§10.9 没有这两项。

37. **[slice-K3-SPEC.md:1841–1847、1866](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1841)：§10 没收齐任务要求的已定读法。** 至少漏了：审批答复自己的文字／批注留在 Session message、接续仍用原 safer_method 附言（`books/k3-g4b2-impl.md:166–170`，明确要求后注）；固定自查文字“没有自查依据”（`books/k3-g4b3-rework-9.md:124–126`）；K3-46 UR7 扩展行登记（`:133`）；Kernel 完整窗口、恰好第 64 页结束可 ready、剩余／停滞／提前结束不可返回部分事实（`:146–154`）。泛称“UNSPECIFIED 已接受”不能代替具体规则。

38. **[STATUS.md:340](D:/cxt/k3-docs-review/docs/refactor/STATUS.md:340)：第 1–3 组施工基线写错。** 不能写成均在 8A 和 4C-2 之后开始；group 1 书明确基线是 **`6f900eaa`、合入到 4B**，见 `books/k3-g1-impl.md:15–18`。合并时统一变更基点 `f15f25a4` 应另述，不能倒写成早期施工基线。

39. **[STATUS.md:340](D:/cxt/k3-docs-review/docs/refactor/STATUS.md:340)：“生产代码返工 2 后就没有问题”错误。** 只能说“当时后续几轮审查未再报告生产问题”；之后全审仍发现 5 个行为问题，又新增 F-102，第 10 轮还有生产修复。见 `checks/k3-business-classification.md:49`、`books/k3-g4b3-rework-9b.md:40`、`dsh/k3-g4b3-rework10-final.md:20`。

40. **[slices/README.md:3、21](D:/cxt/k3-docs-review/docs/refactor/design/orchestration-2026-10/slices/README.md:3)：缺少任务要求的 K3 最后全量占位。** 已写合入，但没有“最后全量：K3 合入全量 `【lead 填】`”。要求明确在 `.dsh-ref/k3-docs.md:26`；AGENTS 和 STATUS 已保留该占位，分片入口也应补齐。

五项“材料里的更正”中，**F-067→T 正确**（`checks/k3-final-freeze.md:10`），**D1＝72 正确**（`codex/k3-final-list.out.md:110`）；分段结论需限定主语，另两项分别见第 10、4 条。DSH 用量合计、合并规模及 STATUS 下一步顺序未发现数字或事实问题。

问题总数：40。