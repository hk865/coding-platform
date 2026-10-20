| 编号 | 类别（错/误导/漏/不一致） | 位置（file:line） | 问题 | 依据（file:line） | 改法 |
|---|---|---|---|---|---|
| D-01 | 错 | `docs/refactor/STATUS.md:93`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:73`；`docs/refactor/design/orchestration-2026-10/slices/README.md:3` | 最终全量被标成 `bd58f4a`，并称 `full-final.txt` 缺失；现有最终检查记录对应 `20afbfa`。这里的问题是提交号和文件存在性，不是待填的测试数字。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/checks/full-final.txt:1`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/checks/full-tfr2.txt:1` | 最终全量改指 `20afbfa`；删除“文件缺失”，保留尚未完成的结果占位。 |
| D-02 | 错 | `docs/refactor/STATUS.md:93` | 把 `d4140be` 的 755 文件、9,668 项通过写成“T 轮的全量”，混淆 T 与 T 后小修。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/checks/full-tf1.txt:1`；`docs/refactor/reviews/evidence/orchestration-cleanup-T-2026-10-19/lead-acceptance.md:5` | 改为“T 后小修五组完成、返工前的全量”。T 合入全量仍是 766 文件、9,774 项通过。 |
| D-03 | 错 | `docs/refactor/STATUS.md:54`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:41` | “每处／所有 `provenance === null` 分支”已删除不成立；Session 来历读取中仍有这些判断。 | `src/business/workflow/workflow.ts:2107`；`src/core/work-graph/views/track-read-model.ts:875`；`src/core/work-graph/communication/mailbox-service.ts:524` | 限定为任务书列出的读者及旧来历链路；不要宣称全仓所有空值判断均已删除。原任务书也有限定范围：`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/books/tf-book.md:82`。 |
| D-04 | 错 | `docs/refactor/IMPLEMENTED-CAPABILITIES.md:3` | “删掉 290 个未使用的本地名”混淆计数单位。290 是诊断条数，其中包含整条 import 的诊断；另有清单外的级联删除。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/dsh/tf-reply.md:348`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/dsh/tf5-before.txt:10`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/codex/P8.out.md:5` | 改成“`--noUnusedLocals` 的诊断由 290 条降至 0”。 |
| D-05 | 错 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:171` | 规模拆分提案写成接缝 A–G，漏了 QA-17 所需的 H；H 是否加入也仍待裁定。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/scale/t-scale.out.md:97`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/scale/t-scale.out.md:219` | 改为 A–H，并保留 H 的签名传播成本及待裁定说明。 |
| D-06 | 误导 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:166` | 把 1,155 MB、796 MB 称为“堆峰值”，容易被拿来当执行期间的最大堆占用；实际记录是每个文件结束后的堆用量。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/mem/summary.txt:3`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/mem/analyze.py:38` | 改为“文件结束后记录的堆用量最大的两个”，与 scope 内存峰值分开。 |
| D-07 | 误导 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:55`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:136` | “正常流程没有谁在 prepare 和 entry 之间写 Workspace”省掉了“串行执行链”的限定。并发置顶、标通知已读仍会改版本并触发拒绝。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/codex/P6.out.md:24`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/codex/P6.out.md:25`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/codex/P6.out.md:29` | 明确为“正常串行 Workflow 不会自行插入这些写入”；补明并发设置仍可能触发 AD08 冲突。 |
| D-08 | 不一致 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:159`；`docs/refactor/STATUS.md:311` | README 称五个结构收窄条目在“决定 85-1／STATUS”追踪，但 STATUS 的并账清单和结构轮清单没有列它们；另外，已裁定随结构轮处理的 B-023 也未进入“留下的”清单。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/books/tf-findings.md:29`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/books/tf-findings.md:97`；`docs/refactor/STATUS.md:312`；`docs/refactor/STATUS.md:373` | 在 STATUS 明列五行及 B-023，链接本轮裁定；或把 README 的追踪位置改为实际记录处。 |
| D-09 | 不一致 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/README.md:141`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/dsh/tf1-rows-final.tsv:155` | README 已否定“RUN-23 没有授权”，但它引用的最终结果表仍把这句话写在 B-023 的 `lead_note` 中。 | `docs/refactor/reviews/evidence/fix-after-T-2026-10-20/books/tf-findings.md:97`；`src/core/work-graph/state/run-machine.ts:2126`；`src/core/work-graph/state/run-machine.ts:1025` | 更正最终表的 lead 注记，保留原始 DSH 回复；采用“调用点类型仍可选、收窄随结构轮”的最终理由。 |
| D-10 | 漏 | `docs/UI-WORKBENCH.md:26` | 仍说 E3 实现时才替换旧界面、删除旧视图，没有注明此次已提前删除。 | `docs/refactor/HANDOFF.md:707`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/checks/merge.txt:16` | 加日期说明旧界面已删，E3 从冻结原型实现。 |
| D-11 | 漏 | `docs/refactor/design/orchestration-2026-10/DESIGN.md:86`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:931`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:1046`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:1265`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:1271`；`docs/refactor/design/orchestration-2026-10/DESIGN.md:1272` | 仍把旧主对话、“问一问”、浏览器规划问题、归档按钮和成员对话当作现存或可继续修改的界面；第 6 片还明确写“暂时保留浏览器流程”。 | `docs/refactor/HANDOFF.md:707`；`docs/refactor/STATUS.md:92` | 给这些旧实现依据加删除日期；施工与可见效果改为后端入口和待 E3 实现的界面。 |
| D-12 | 漏 | `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:133`；`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:217`；`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:319`；`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:335`；`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:369` | F6 已补删除说明，但其他位置仍要求沿用旧 `planning.ts` 的人工采用入口，并称“旧界面的主对话照旧”。 | `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md:73`；`docs/refactor/HANDOFF.md:707` | 将旧 UI 函数标为历史定位；现行流程直接点名保留的后端入口，交互入口留给 E3。 |
| D-13 | 漏 | `docs/refactor/design/orchestration-2026-10/slices/slice-7-SPEC.md:705` | 施工协调清单仍把“界面路由表”列为各片需要修改的共用登记文件。 | `docs/refactor/design/orchestration-2026-10/slices/README.md:154` | 删除该现行施工项，注明旧 `src/ui/api/routes.ts` 已删除。 |
| D-14 | 漏 | `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:456`；`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:956` | 文件清单仍要求修改旧设置页、图页；L8 限定仍称手动抓取“按钮和路由不变”，没有说明按钮已随旧界面删除。 | `docs/refactor/HANDOFF.md:707`；`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/checks/merge.txt:16` | 标注旧 UI 文件和按钮已删；保留路由说明，将按钮实现指向 E3。 |

OK — `README.md:86`  
OK — `AGENTS.md:3`  
OK — `docs/AGENTS.md:3`  
OK — `docs/README.md:1`  
OK — `docs/MVP-BEHAVIOR.md:1`  
OK — `docs/refactor/DSH-WORKFLOW.md:314`  
OK — `docs/refactor/HANDOFF.md:693`  
OK — `docs/refactor/STATE-MACHINES-SPEC.md:7`  
OK — `docs/refactor/design/orchestration-2026-10/README.md:3`  
OK — `docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md:3`  
OK — `docs/refactor/design/orchestration-2026-10/STATE.md:39`  
OK — `docs/refactor/design/orchestration-2026-10/STRUCTURE-DRAFT.md:397`  
OK — `docs/refactor/module-dag.md:94`  
OK — `docs/refactor/modules/core/agent-runtime.md:309`

第 9、K2 片核对了分片条目：`docs/refactor/design/orchestration-2026-10/DESIGN.md:1274`、`docs/refactor/design/orchestration-2026-10/DESIGN.md:1275`；未发现旧工作台漏注。

错 5，误导 2，漏 5，不一致 2