已逐句核对新增内容；未写文件、未运行测试。以下将同源重复错误合并计数。

定位简写：S＝[slice-8-SPEC.md](D:/cxt/s8l8-docs/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md)，A＝[lead-acceptance.md](D:/cxt/s8l8-docs/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/lead-acceptance.md)，E＝[证据 README](D:/cxt/s8l8-docs/docs/refactor/reviews/evidence/orchestration-slice-8-L8-2026-10-18/README.md)。行号均指当前副本。

**必须改：**

1. **`failAutoCapture` 的取消并非公开路径不可达。** S:1051、A:94/100、STATUS:280 把它和 request acceptance 混为一谈。只有 `requestAutoCapture` 使用不保留 controller 的新 signal；failure 使用正在运行那轮的 signal，关闭会 abort。当前 P06 还保留了失败快照读取期间关闭的证明。应写“request acceptance 有入口限制；failure cancellation 可达，覆盖仍有缺项”。这是任务书本身的冲突：返工 4 裁定 2 与返工 2 裁定 4、当前代码不一致，不能直接抄成事实。[driver:252](D:/cxt/s8l8-docs/src/app/auto-capture-driver.ts:252)、[close:299](D:/cxt/s8l8-docs/src/app/auto-capture-driver.ts:299)、[P06:849](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-observation-state.test.ts:849)

2. **12／21 的范围和计数窗口写错。** S:30/1022–1023/1043、A:21/84、[WG59:260](D:/cxt/s8l8-docs/docs/refactor/IMPLEMENTED-CAPABILITIES.md:260) 将其写成整次 prepare 的固定读数或通用上限。实际是指定夹具下的**提醒依赖**读取：12 文件、6 块时 12 次；新增第 13 个文件、当前 7 块及 previous 6 块时 21 次。计数只在真实 reminder reader 执行期间开启，reader 返回便关闭，**不延续到 put**。[计数夹具:11](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-read-counts.test.ts:11)、[窗口:39](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-read-counts.test.ts:39)

3. **`previous` 不是按观测时间排序的前一个。** S:982 的这句不成立。代码把提交时被替换的 current 写入 `previousObservedRef`，没有比较 `observedAt`；手动抓取和自动抓取交错时，生成时间与提交顺序可以不同。改为“previous 是本次成功提交替换掉的观测”。[时间生成:1141](D:/cxt/s8l8-docs/src/core/work-graph/architecture/architecture-service.ts:1141)、[指针提交:1227](D:/cxt/s8l8-docs/src/core/work-graph/architecture/architecture-service.ts:1227)

4. **观测状态 DTO 和拒绝水位的路由混写。** S:988 漏了顶层 `previousPersistedRef`；A:16 的“previous 也带持久引用”错误，`previous` 仍只是 capture ref。此外，拒绝 `requestSeq` 的运行时检查属于 **`architecture/capture`**，不是该段正在描述的 `architecture/observation-state`。应明确字段层级和路由名。[契约:53](D:/cxt/s8l8-docs/src/contracts/architecture-observation.ts:53)、[解析器:540](D:/cxt/s8l8-docs/src/app/core-routes.ts:540)

5. **“不确定”的位置错误。** S:1003、A:18 写“行以 `，不确定` 结尾”；实际是内容末尾、时间括号之前，例如 `…，不确定（3 小时前的观测）`。[公开断言:130](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-reminders-public.test.ts:130)

6. **夹具只支持一种后端，不构成双后端豁免。** S:1028 将其列为通用例外，与同文 S:1044 及 verify4 明确相反。改为“持久化重启行按明确裁定只测 SQLite；夹具限制须记录为未覆盖，不能自动豁免”。[verify4:33](D:/cxt/s8l8-docs/.dsh-ref/codex/verify4.out.md:33)

7. **提醒测试覆盖被扩大。** A:28 声称时间边界及 `src/a`／`src/a/inner` 都在纯函数和公开 prepare、两后端测过。时间边界在纯测试；精确路径对也只在纯测试，公开 prepare 使用的是 `src/a`／`src/a-inner`。S:1004 也应避免让人以为精确路径对经过公开证明。[纯时间测试:244](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-reminders-pure.test.ts:244)、[公开排序测试:72](D:/cxt/s8l8-docs/tests/work-graph/S8A-L8-reminders-public.test.ts:72)、[返工回复:31](D:/cxt/s8l8-docs/.dsh-ref/dsh/rework1-final.md:31)

8. **`failed` 事件时刻没有所称的测试证明。** A:35 将原因截断与 `occurredAt` 一起写成“有纯测试和公开记录断言”。材料明确说事件没有公开 reader，`occurredAt` 只做实现核对；公开记录断言检查的是保留 `requestedAt`。应拆开写，并把事件时刻列为静态核验。[返工 1 UNSPECIFIED 4](D:/cxt/s8l8-docs/.dsh-ref/dsh/rework1-final.md:30)、[复审接受项](D:/cxt/s8l8-docs/.dsh-ref/codex/review2.out.md:29)

9. **历史轮次被写成全部修完。** A:56 的“返工 1 改完”不实：review2 对第 3、6 项判部分，第 5 项判未完全修。A:58 将手写事实、读取计数等统称“返工 2 修”也过满：读取计数方法到返工 3 才闭合，真实组合回调仍进 T。应逐项写该轮结果及后续去向。[review2:7](D:/cxt/s8l8-docs/.dsh-ref/codex/review2.out.md:7)、[verify3:1](D:/cxt/s8l8-docs/.dsh-ref/codex/verify3.out.md:1)

10. **账本“都对上表里的行”抹掉了当轮削弱。** A:71 的 86／21／51 数量正确，但不能据此说三轮均已合法归属：返工 2 有 11 条削弱，返工 3 有 1 条；返工 4 才是 51 条均归 D、零削弱。应保留每轮裁定和后续恢复记录。[verify2:498](D:/cxt/s8l8-docs/.dsh-ref/codex/verify2.out.md:498)、[verify3:164](D:/cxt/s8l8-docs/.dsh-ref/codex/verify3.out.md:164)、[verify4:9](D:/cxt/s8l8-docs/.dsh-ref/codex/verify4.out.md:9)

11. **把回归运行写成了文件修改。** A:22 声称 R3d、R3d-R3g、R5a、R6-host 的改动均已解释；材料列的是这些文件的回归结果。施工回复明确说旧测试只改 WP2 的 F06，返工另改 Z01 等待。应删除那组不存在于材料中的“改动”声明。[施工回复:9](D:/cxt/s8l8-docs/.dsh-ref/dsh/impl-final.md:9)、[回归结果:15](D:/cxt/s8l8-docs/.dsh-ref/dsh/impl-final.md:15)

12. **P3 的逐位点实现描述不符合代码。** S:1017 声称列出的每个 await 后都有检查，但 `:123` 仍直接 `return await readPreviousTurn(...)`，由外层 `:186` 兜底；verify4 已明确指出。lead 补的是最后 workspace fallback 的后查。应描述实际检查层级，不能把任务书要求当作逐行实现结果。[当前代码:123](D:/cxt/s8l8-docs/src/core/agent-runtime/session-anomaly-facts.ts:123)、[verify4:5](D:/cxt/s8l8-docs/.dsh-ref/codex/verify4.out.md:5)

13. **T 中 A 的缺口被缩成了 requeue。** S:1052、A:101 的“逐 await 取消要经过 requeue”覆盖不了 verify3 的完整未测清单：还包括 catalog／observed facts、服务 basis/latest/previous 经公开 prepare 的证明、独立 assembler 边界等。应引用完整 A 表，并区分普通 prepare 与 requeue 的缺项；这里是补准欠账记录，不是要求本轮补测试。[verify3:54](D:/cxt/s8l8-docs/.dsh-ref/codex/verify3.out.md:54)

14. **开始读失败的例外遗漏，`not_found` 也未限定对象。** S:965 的合法 `not_found` 只适用于目录读取；observation-state 的 `not_found`／`not_ready` 会转为 unavailable failure。另有目录 `not_ready` 仍直接退出、保留 pending，review2 明确接受其当前不可产生的限制。应补此限定，删掉无条件的“不再出现静默退出”。[driver:195](D:/cxt/s8l8-docs/src/app/auto-capture-driver.ts:195)、[driver:216](D:/cxt/s8l8-docs/src/app/auto-capture-driver.ts:216)、[接受例外](D:/cxt/s8l8-docs/.dsh-ref/codex/review2.out.md:19)

15. **UNSPECIFIED 编号对应错误。** A:93 把 2、3、4、5 对应成 requeue、晚恢复、真实回调、`input=null`。正确是：2＝requeue 覆盖；3＝lookup-miss 后 late replay 的手造内部命令测试；4＝fail 晚恢复静态核对；5＝复制组合回调。`input=null` 是独立的 J 行。[verify3:449](D:/cxt/s8l8-docs/.dsh-ref/codex/verify3.out.md:449)

16. **多处引用指向不存在或不同的条目。** S:972 的 `review1 P11` 应为 [audit P11](D:/cxt/s8l8-docs/.dsh-ref/codex/audit.out.md:365)；S:1052–1055 所引返工 3 书的 UNSPECIFIED 应改引返工回复／verify3；S:1052–1054 的 `verify4 A/B/J` 不存在，应引 verify3 对应行及返工 4 的延期决定；S:1056 的“返工 4 书 UNSPECIFIED”应引返工回复和 verify4。另 A:61 把 book5 写成决定“重放行删掉”，其原建议是 BLOCKED、等待冻结入口，删除依据是后来的最终裁定。[book5:214](D:/cxt/s8l8-docs/.dsh-ref/codex/book5.out.md:214)、[最终延期裁定](D:/cxt/s8l8-docs/.dsh-ref/books/l8-rework-4.md:19)

17. **“5 个子 agent”没有材料依据。** E:21 的精确数量在所给任务书、回复、检查材料中找不到支持。不能认定其为假，但目前不能作为已核事实落稿；删除数量，或补实际运行记录。协调者模式本身有依据。

**建议措辞：**

1. E:4、S:950 的“各抓一次”改为：“每次非重放提交发送一次触发；等待中的触发会合并，不保证每次提交对应一次抓取。”
2. E:7、WG59 的“最多 10 行”改为：“最多列出 10 条提醒，超过时另加一行省略说明，总计可为 11 行。”
3. S:962/972 的“取消什么也不写”改为：“提交前取消不发布观测或失败记录；已写入的正文不回滚，已取得 committed 回执的结果保持。”
4. S:1045、A:86 的“不改正文格式”改为：“模块正文格式保持不变；文件图块的 v2 正文增加工作区范围。”
5. A:91 改为：“2/2 和 6/6 是返工 4、lead 补丁之前的运行结果；所给材料没有补丁后的运行结论。”
6. STATUS:78 改为：“合并树全量及类型、边界、构建检查的实际环境与结果待 lead 填入证据。”目前占位符不能证明这些检查已经运行。
7. 源码定位注明版本，例如 S:953 改为：“驱动的 scope key 使用规范 JSON 元组；当前实现见 `auto-capture-driver.ts:72`，任务书的 `:65` 为历史行号。”

其余轮次时长、token 换算、上下文峰值、增删行数、净增及超预算算术，与所给材料一致；55 项分类、审查汇总及分轮测试数字未发现另一个数值错误。AGENTS 和 slices README 的新增状态未见额外矛盾；合入提交及合并树全量仍属明确待填项。

必须改：17 项；建议：7 项。