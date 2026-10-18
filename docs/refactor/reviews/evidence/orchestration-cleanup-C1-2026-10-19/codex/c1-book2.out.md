**原 8 项：6 项已修复，1 项改了原意，1 项未修完；另有 1 处代码定位错误。** 全程未写文件、未运行测试。

| 原项 | 结论 | v2 依据 |
|---|---|---|
| 1．G1 公共能力清单 | **已修复**。PE-2/3、编号构造、VW-7 均已补入；另见下文定位错误。 | [c1-book.md:32](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:32) |
| 2．ref 落点及不能合并的近似副本 | **已修复**。严格检查复用点、宽松检查和不同错误协议均明确。 | [c1-book.md:38](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:38) |
| 3．rejection 协议差异 | **已修复**。verification-plan 排除；三种 current 规则分开。 | [c1-book.md:44](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:44) |
| 4．失败映射分型 | **已修复**。K3 不解析／附带冲突 pins、读写差异均保留。 | [c1-book.md:47](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:47) |
| 5．区域助手所有权及原出口 | **已修复**。区域助手归属和原签名包装已明确。 | [c1-book.md:14](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:14) |
| 6．阶段性 production-reach 失败 | **改了原意**。“The last kind exists only in G1”错误地排除了后续组继承的未接线声明。 | [c1-book.md:16](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:16) |
| 7．edge／legacy 编号范围 | **已修复**。两种编号、顺序、版本门槛和 atLeastCursor 排除均明确。 | [c1-book.md:18](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:18) |
| 8．冻结交接及行数口径 | **未修完**。交接和摘要限制已修；未跟踪文件统计方法仍错，快照基线后备遗漏。 | [c1-book.md:23](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:23)、[c1-book.md:54](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:54)、[c1-book.md:58](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:58) |

需要使用的修正文案：

**1．原第 6 项：修规则 4，并同步 §6 的报告要求。**

原建议明确允许“中间组”报告继承的阶段性失败：[c1-book.out.md:97](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.out.md:97)。例如 G2 完成后，G4/G5 的消费者仍未接线，检查仍会发现 G1 的不可达声明；检查代码见 [production-reach.test.ts:103](D:/cxt/k3-merge-review/tests/architecture/production-reach.test.ts:103)。

> G1（拆分时包括 G1a、G1b）冻结时，由 lead 按文件路径和符号名列出消费者尚在后续组的声明。此后的每个中间组均继承该表，并报告本次检查中仍未接线的子集及对应消费者组；本次引入或分组遗留的 production-reach 失败必须与该表精确对应。不得把它们称为通过，不得加假调用或修改 allowlist。全部消费者接线后，该表必须清零，最终合并树通过完整检查。§6 的对应报告要求适用于所有中间组。

**2．原第 8 项：修 §3 和 §5 的基线／统计说明。**

`git diff --stat` 同样不会统计未跟踪文件；现文不能兑现“new files included”。原要求见 [c1-book.out.md:118](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.out.md:118)。

> 每份 c1-run.md 指明施工根和可复核的基线提交或基线快照。新增＋删除相对该基线统计，净增减另报。Git 基线下，已跟踪文件使用相对基线的 diff；未跟踪的新文件逐文件与空文件比较并计入，不能用普通 git diff --stat 代替。没有 Git 基线时使用前后快照比较，不报告不存在的 git diff 数字。

**3．额外矛盾：§5 的 evidence 定位指向了另一种函数。**

[c1-book.md:35](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:35) 指向 `:151`，实际是返回 SHA 的 `fingerprintOf`；nullable canonical 包装是 [evidence-service.ts:148](D:/cxt/k3-merge-review/src/core/work-graph/evidence/evidence-service.ts:148) 的 `refKeyOf`。refresh 的 [c1-refresh.out.md:37](D:/cxt/k3-merge-review/.lead-ref/c1/c1-refresh.out.md:37) 原本正确，**我上一份 book 检查对此作了错误更正，需要撤回**。

将该句 evidence 部分替换为：

> XX-5 在 evidence/evidence-service.ts 的迁移目标是 refKeyOf（当前 :148–150），保留 canonicalJson 失败返回 null。fingerprintOf（:151）和 digestOf（:152）返回 SHA 且直接抛错，不接 nullable canonical 助手。

同段 rejection 的示例行号也顺手纠正：[c1-book.md:45](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:45) 的 `evidence-service.ts:139` 应写 `evidence-service.ts::reject（当前 :136–138）`。

**G1a/G1b 与白名单：拆分本身没有新增冲突。** [c1-book.md:27](D:/cxt/k3-merge-review/.lead-ref/c1/c1-book.md:27) 已承接 delta 的文件归属，因此必须在原 G1 集合内划分；`note-record-codecs.ts` 仍独占归 G3，不能被“other hit persistence files”收进 G1b，依据 [c1-delta.out.md:107](D:/cxt/k3-merge-review/.lead-ref/c1/c1-delta.out.md:107)、[c1-delta.out.md:109](D:/cxt/k3-merge-review/.lead-ref/c1/c1-delta.out.md:109)。实际 `c1-run.md` 未提供，本次不能核实具体白名单；不另计必须改。

must-fix count: 3