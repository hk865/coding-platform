1. [证据 README.md:9](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md:9)：**“注记游标共用一个编码函数”写错对象。** N7 合并的是架构图与文件图的游标编码。应改为“架构图和文件图共用游标编码函数”。来源：[refresh:172](D:/cxt/c1-docs-facts/.lead-ref/evidence/codex/c1-refresh.out.md:172)、[graph-index.ts:48](D:/cxt/c1-docs-facts/src/core/work-graph/architecture/graph-index.ts:48)、[file-graph-index.ts:18](D:/cxt/c1-docs-facts/src/core/work-graph/architecture/file-graph-index.ts:18)。

2. [证据 README.md:19](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md:19)：**“用量只计 DSH 主会话”没有所引材料支持。** [dsh-runs.txt:1](D:/cxt/c1-docs-facts/.lead-ref/evidence/checks/dsh-runs.txt:1)只标注 `tokens total`，没有说明是否包含子会话。应只写“用量按所列 run.json 的统计”，或补充统计口径证据。数字合计本身正确。

3. [lead-acceptance.md:31](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:31)：**把返工要求写成了实际结果。** G2 返工 1 的 decision 包装实际是 `{ pinProblem, pin }`，并非直接返回 `null`；恢复返回 `null` 的包装是随后 lead 的修复。应分别记录这两个阶段。来源：[G2 返工回复:11](D:/cxt/c1-docs-facts/.lead-ref/evidence/dsh/c1-g2-rw1-final.md:11)、[leadfix.diff:16](D:/cxt/c1-docs-facts/.lead-ref/evidence/checks/c1-g2-leadfix.diff:16)。

4. [lead-acceptance.md:40](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:40)：**“真正不同、不能接的七类”不准确。** 第七类是已经调用共享实现、为保留窄类型或名称而留下的薄包装，不是不能接线的副本。应写“列出七类保留项，其中第七类已委托共享实现”。来源：[G4 返工回复:21](D:/cxt/c1-docs-facts/.lead-ref/evidence/dsh/c1-g4-rw1-final.md:21)。

5. [lead-acceptance.md:80](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:80)及第 93 行：**“抛错的 `refKeyOf`／`sameRef`”误述了 `sameRef`。** 这些 `sameRef` 捕获异常并返回 `false`。应区分“会抛错的 `refKeyOf`”与“捕获异常、返回布尔值的 `sameRef`”。[裁定源文:28](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:28)也有这个错误；实际回复已区分两类：[G4 返工回复:15](D:/cxt/c1-docs-facts/.lead-ref/evidence/dsh/c1-g4-rw1-final.md:15)，源码见 [claim-service.ts:124](D:/cxt/c1-docs-facts/src/core/work-graph/tasks/claim-service.ts:124)、[execution-entry-service.ts:137](D:/cxt/c1-docs-facts/src/core/work-graph/tasks/execution-entry-service.ts:137)。

6. [lead-acceptance.md:107](D:/cxt/c1-docs-facts/docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/lead-acceptance.md:107)：**把 G2 接口表错误列成了仍存的限制。** 裁定 4 明确说 G2 已在返工 1 修正；本文件第 35、77 行也这样记载。应改为“G4、G3 的回复仍有上述错误；G2 第一版接口表错误已修正”。来源：[裁定源文:25](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:25)、[G2 返工回复:13](D:/cxt/c1-docs-facts/.lead-ref/evidence/dsh/c1-g2-rw1-final.md:13)。

7. [STATUS.md:87](D:/cxt/c1-docs-facts/docs/refactor/STATUS.md:87)：**“两个失败……都在预期内，build 后过”把 build 后通过的范围扩大了。** 证据只说 K3-07 在 build 后通过；production-reach 是九项待后组接线声明。应明确“其中 K3-07 在 build 后通过”。来源：[g1-full-suite.txt:9](D:/cxt/c1-docs-facts/.lead-ref/evidence/checks/g1-full-suite.txt:9)。

8. [STATUS.md:348](D:/cxt/c1-docs-facts/docs/refactor/STATUS.md:348)：**转交项引用“裁定 6–8”漏了 N0 的出处。** N0 对应裁定 3；卡源、近似实现、旧游标分别对应 6、7、8。应改为“裁定 3、6–8”。来源：[裁定源文:24](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:24)、[裁定源文:27](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:27)。

9. [HANDOFF.md:470](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:470)：**“只留一个 RecordStore 后端”已转交决定 84 的说法没有现有材料支持。** 决定 84-3 只明确接收编解码试点；C1 裁定也没有新增这个转交。决定 70 第 4 项原文仍是“4C 合入后补审注记部分时一起拿出来”。应保留原安排，或明确标注这是新增裁定并补出处。来源：[HANDOFF.md:467](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:467)、[HANDOFF.md:674](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:674)、[裁定源文:30](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:30)。

10. [DSH-WORKFLOW.md:396](D:/cxt/c1-docs-facts/docs/refactor/DSH-WORKFLOW.md:396)：**把 C1 的运行约束扩大为所有类型检查施工的规则，并称为决定 76 的例外，缺少决定依据。** 决定 76 原文是“DSH 的说明书不再写子任务个数的上限”；C1 裁定 5 支持这次运行的内存限制，但没有记录用户修改决定 76。应明确这是 C1 的 lead 补充约束，不把通用例外归于既有决定。来源：[HANDOFF.md:529](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:529)、[裁定源文:26](D:/cxt/c1-docs-facts/.lead-ref/evidence/books/c1-lead-rulings.md:26)。

11. [DSH-WORKFLOW.md:450](D:/cxt/c1-docs-facts/docs/refactor/DSH-WORKFLOW.md:450)：**步骤表无条件把返工 3 交给 DSH，与决定 81-3 及下方“停止”段不一致。** 81-3 原文：“全列里有业务行：返工 3 交 DSH……只剩测试行：不再开 DSH，交 Codex 写测试。”表格必须补上这个分支。来源：[HANDOFF.md:635](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:635)。

12. [DSH-WORKFLOW.md:452](D:/cxt/c1-docs-facts/docs/refactor/DSH-WORKFLOW.md:452)：**“测试行交 Codex”遗漏了决定 81-4 的实跑例外。** 原文：“要真实 Host 重启、门控时序、要靠跑出来的数字的测试，直接交 Opus”；Codex 只接纯函数、被拒输入、公开步骤断言等。应补上例外，避免把这些测试也派给不能运行测试的 Codex。来源：[HANDOFF.md:639](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:639)。

13. [DSH-WORKFLOW.md:452](D:/cxt/c1-docs-facts/docs/refactor/DSH-WORKFLOW.md:452)：**“Codex 漏查的（范围内、规则没变）在 DSH 循环外修”扩大了冻结后的必修范围。** 决定 81-6 只规定“正常使用会碰到的业务错”告知用户后交 Opus 或 lead，“其余进 T”；并非所有范围内漏查都立即修。应按该分类重写。来源：[HANDOFF.md:643](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:643)。

14. [DSH-WORKFLOW.md:452](D:/cxt/c1-docs-facts/docs/refactor/DSH-WORKFLOW.md:452)：**“同一类问题在两个分片里出现，下一片之前给它写一个检查脚本”是新增规则，决定 76、80、81 均未规定。** 80-3 指定的是断言台账、纯测试守卫和手写事实扫描；没有“两片出现即加脚本”的触发条件。应删除该强制规则，或另记其裁定来源。来源：[HANDOFF.md:617](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:617)、[HANDOFF.md:645](D:/cxt/c1-docs-facts/docs/refactor/HANDOFF.md:645)。

问题总数：14。