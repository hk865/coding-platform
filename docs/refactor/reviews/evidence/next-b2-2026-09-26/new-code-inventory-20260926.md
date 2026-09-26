# 2026-09-26 next 新代码统计（B1/W1 同口径对照）

测量时刻：2026-09-26T15:23:51.770568+00:00。只读统计，没有改生产代码、运行测试或派发 ended-work-link。

**用户关注的生产源码增长已核实：next/src 的 TypeScript 从 165 文件、30,464 行增至 225 文件、60,612 行，净增 30,148 行（+98.96%）；逐文件差分为新增行 30,591、删除行 443。** 60 个新增路径、48 个修改文件、0 个删除文件。这里的新增路径不等于全部重新手写：仍可能包含迁入或复用实现。

## 1. 可信基线与口径

- 基线是 `next-b1-w1-2026-09-25/final-workspace-check.json` 的165个src TS /30,464行及 `accepted-source-hashes.json`。165个文件的原文均从当前相同文件或保留lane快照按SHA256逐字匹配恢复，恢复结果正好30,464行，缺口0；每文件原来源路径和哈希见同名JSON。
- 这是9月25日B1/W1完成后至本次快照的增量，不是完整重构起点。Git HEAD仍为旧9月18日提交，next整体未跟踪，旧工作树混有历史变更；未把git status/diff全部算作本轮新增。
- 物理行包含空行和注释；非空行去空白但仍包含注释，不冒称去注释逻辑SLOC。新增/删除用相同逐行SequenceMatcher（禁用autojunk）对基线与当前各比较一次，不累加历次施工改写量。
- 主对照严格只计 `src/**/*.ts`。当前src另外175行手写CSS/HTML、16行README，故当前src全文件为60,803行；src代码为60,787行。此前任务的60,696是更早快照且含非TS，不能直接与30,464的TS基线相减。
- 依赖、旧工程、node_modules、dist重复生成物、source map、日志、运行证据大文件和私有DSH状态不进入生产源码。生成物与Kernel补丁分别披露。

## 2. 同口径 src TS 增长分布

| 模块 | 当前文件 | 基线行 | 当前行 | +新增行 | -删除行 | 净增长 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| src/core/work-graph | 81 | 16,975 | 35,054 | 18,438 | 359 | +18,079 |
| src/core/agent-runtime | 29 | 3,254 | 7,667 | 4,442 | 29 | +4,413 |
| src/ui | 2 | 0 | 3,485 | 3,485 | 0 | +3,485 |
| src/app | 7 | 0 | 1,200 | 1,200 | 0 | +1,200 |
| src/core/workspace | 28 | 2,889 | 3,782 | 908 | 15 | +893 |
| src/business/workflow | 4 | 36 | 911 | 890 | 15 | +875 |
| src/contracts | 60 | 3,810 | 4,607 | 807 | 10 | +797 |
| src/composition | 1 | 225 | 631 | 421 | 15 | +406 |
| src/core/record-store | 13 | 3,275 | 3,275 | 0 | 0 | +0 |

**WorkGraph占生产TS当前体积57.8%，占本阶段净增长60.0%。** Runtime约占增长14.6%，UI TS约占11.6%。RecordStore在这个基线之后没有增长。

| WorkGraph 子目录 | 当前文件 | 当前行 | 净增长 |
| --- | ---: | ---: | ---: |
| tasks | 30 | 12,831 | +5,991 |
| queries | 4 | 3,332 | +3,332 |
| communication | 3 | 2,020 | +2,020 |
| evidence | 5 | 1,918 | +1,918 |
| materials | 9 | 2,845 | +1,641 |
| configuration | 6 | 2,897 | +1,526 |
| persistence | 7 | 2,375 | +1,061 |
| architecture | 8 | 3,001 | +450 |
| root | 2 | 313 | +140 |
| sessions | 7 | 3,522 | +0 |

这些增长包含执行状态/模型准入、Query、通信、材料授权、证据完成、计划白板及初始化等真实新增能力；不能只称为测试增长，也不能在未查调用链前断言所有服务和校验都必要。

## 3. 当前代码按用途分开

| 互斥文件分组 | 文件数 | 物理行 | 非空行 | B1以来已确认净变化 |
| --- | ---: | ---: | ---: | ---: |
| 生产实现（不含下列契约/Host/UI） | 123 | 48,425 | 45,746 | +23,032 |
| 接口/契约文件 | 94 | 7,730 | 7,450 | +2,659 |
| Host实现（接口文件另计） | 6 | 972 | 911 | +972 |
| UI实现（TS/CSS/HTML） | 4 | 3,660 | 3,425 | +3,660 |
| 测试代码（含helper与34行JS） | 134 | 38,063 | 35,892 | +17,379 |
| 工程脚本/分析器 | 8 | 1,279 | 1,211 | 完整基线未覆盖，不报总增删 |
| Kernel受管补丁完整源码 | 6 | 2,994 | 2,874 | 完整基线未覆盖，不报总增删 |
| 平台Skill资源 | 6 | 84 | 67 | 完整基线未覆盖，不报总增删 |
| next内文档 | 3 | 131 | 91 | 完整基线未覆盖，不报总增删 |

接口按文件归类：src/contracts/**、contracts.ts/ports.ts及*-contracts.ts/*-ports.ts/*-types.ts；其中混有验证实现的行仍留在该文件组，未用文件名冒充精确语义行分类。src/contracts目录本身是60文件/4,607行，跨模块接口合计94文件/7,730行。Host/UI整体按目录另见上表，不能把两套维度相加。

生产src代码共60,787行，测试代码38,063行，测试/生产约0.626；两者合计中测试占38.5%。按同口径TS，测试由82文件/20,650行增至133文件/38,029行，净增17,379行。比例仅描述体积，不证明过度测试或设计合理性。

当前活跃 `docs/` Markdown（排除history/archive/evidence）为269文件/28,488行。没有同一B1时刻的完整文档内容基线，故不报文档新增/删除总量；next自身文档与Skill资源单列。统计输出位于evidence，未把本报告计入自己。

## 4. 增长最多的源码文件

| 文件 | 基线行 → 当前行 | 净增长 | 定位标签 |
| --- | ---: | ---: | --- |
| src/ui/main.ts | 0 → 2,347 | +2,347 | 新增用户消费者/显示状态 |
| src/core/work-graph/tasks/execution-entry-service.ts | 0 → 1,657 | +1,657 | 正式执行状态/副作用准入 |
| src/core/work-graph/queries/query-execution.ts | 0 → 1,474 | +1,474 | Query执行/事实与重放 |
| src/core/work-graph/communication/mailbox-service.ts | 0 → 1,433 | +1,433 | 通信/邮箱领域事实 |
| src/ui/views.ts | 0 → 1,138 | +1,138 | 新增用户消费者/显示状态 |
| src/core/work-graph/evidence/evidence-service.ts | 0 → 1,041 | +1,041 | 证据/完成正式事实 |
| src/core/work-graph/configuration/project-bootstrap-service.ts | 0 → 989 | +989 | 正式初始化/配置 |
| src/core/work-graph/materials/grant-service.ts | 0 → 968 | +968 | 当前材料授权 |
| src/core/work-graph/tasks/plan-service.ts | 1,223 → 2,129 | +906 | 白板/计划变化与初始Plan |
| src/core/work-graph/queries/query-job-service.ts | 0 → 873 | +873 | Query执行/事实与重放 |
| src/core/work-graph/queries/query-record-codecs.ts | 0 → 762 | +762 | 持久化形状与事件协议 |
| src/business/workflow/workflow.ts | 7 → 714 | +707 | 正常工作推进消费者 |
| src/core/work-graph/tasks/completion.ts | 0 → 682 | +682 | 证据/完成正式事实 |
| src/core/agent-runtime/execution-driver.ts | 0 → 596 | +596 | 运行/来源消费者与接线 |
| src/core/workspace/git-read.ts | 0 → 537 | +537 | 运行/来源消费者与接线 |
| src/core/work-graph/persistence/execution-entry-codecs.ts | 0 → 496 | +496 | 持久化形状与事件协议 |
| src/core/agent-runtime/query-observation.ts | 0 → 479 | +479 | 运行/来源消费者与接线 |
| src/core/agent-runtime/query-execution.ts | 0 → 459 | +459 | 运行/来源消费者与接线 |
| src/core/work-graph/evidence/evidence-record-codecs.ts | 0 → 450 | +450 | 持久化形状与事件协议 |
| src/core/work-graph/configuration/project-bootstrap-record-codecs.ts | 0 → 449 | +449 | 持久化形状与事件协议 |

标签用于定位职责，不是逐行必要性认证。当前适合后续检查的候选：执行/Query/授权/邮箱四个大服务中的重复请求包装、身份/作用域检查与receipt恢复；Plan writer/reader/codec间重复规范化；Host/UI重复响应渲染与技术表单。只有核到相同事实被重复管理或合法正常路径重复校验，才能认定冗余；本次没有做此裁决或删代码。

## 5. 导入批次与去重

已整理本日证据目录中60份具有明确导入文件字段的记录，涉及198个去重路径（含测试、Kernel产物和实现）。完整批次→文件、文件→批次清单见JSON。108个新增/修改src TS文件中，107个能在这些记录里直接找到文件条目；其余列为未归属，不凭名称补造导入事实。

| 批次族（证据文件前缀） | 主要能力 | 统计处理 |
| --- | --- | --- |
| B2 / runtime / entry / shared-contract | 执行状态、Runtime、副作用准入与公共契约 | 同一文件骨架/实现/返修只在当前清单计一次 |
| C1 / C2 | 邮箱事实、平台工具消费者 | 与共用执行/材料文件存在交集，不累加批次文件体积 |
| M1 / M2 / b2-material | 材料授权与已读事实 | 领域逻辑和codec分别按文件归类 |
| W2 / r5b-initial-plan | 未来任务/白板、初始Plan | plan-service等共享文件不强行按最后一次导入归因全部增长 |
| R5a / R5b / R5c | 初始化、Query、Workflow | 真实能力新增，不把骨架和实现重复算两份 |
| R3e / R3d / R2e / git-read | 证据/完成、架构包含修订、固定版本读取/比较 | 已导入最终源码与原文差分 |
| R6 Host / Session / layout / browser repair | 工作台消费者和真实浏览器修复 | 多轮同文件只计最终主树 |
| R4 control-intent / control-runtime skeleton / tool-group | 正式控制意图、平台控制骨架、Kernel工具组安全点 | 未导入R4实现另列，不虚算已完成 |

批次记录用来追溯来源，不把每批+/-直接求和；共享文件跨批修改会重复累计，且本日记录不覆盖整个B1之前历史。

## 6. Kernel与生成物

| Kernel受管源 | 当前完整源码行 | 相对9月24日冻结source-map原文 + / - |
| --- | ---: | ---: |
| app/composition/composition-root.ts | 569 | +8 / -1 |
| app/composition/control-hooks.ts | 101 | +8 / -7 |
| app/composition/resume-composition.ts | 418 | +7 / -1 |
| core/runtime/loop/runtime-runner.ts | 994 | +119 / -0 |
| public-api.ts | 197 | +7 / -0 |
| storage/adapters/sqlite/sqlite-stores.ts | 715 | +104 / -10 |

六份受管文件是完整源码副本，共2,994行；与9月24日冻结产物source-map中哈希核对的原源码比，是+253/-19，净+234行，不能把2,994行全当新写。此补丁对照早于B1，并与src TS主对照分开，不叠加。

| 生成/冻结产物（不计生产源码） | 文件数 | 文本物理行 | 字节 |
| --- | ---: | ---: | ---: |
| dist | 167 | 23,468 | 1,236,366 |
| vendor/coding-agent/dist | 276 | 20,104 | 2,681,767 |

这些是磁盘现有生成/冻结文件，不代表本次重新构建或全部新生成；未运行构建。

## 7. 当前未导入R4/R6隔离范围

| lane | scope文件 / 已变化 | +新增行 | -删除行 | 净变化 | 状态 |
| --- | ---: | ---: | ---: | ---: | --- |
| r4-control-runtime-implementation-20260926 | 8 / 8 | 1,171 | 171 | +1,000 | 主审未导入候选快照 |
| r6-execution-entry-skeleton-20260926 | 12 / 12 | 1,111 | 8 | +1,103 | 主审未导入候选快照 |

两份候选分别对其manifest.originalAllowedHashes恢复的派发前原文比较，基线缺口0；仅统计各自允许文件，未复制整个workspace计数。R4八文件全为生产；R6十二文件含10生产文件及2测试文件，其中测试新增442行，其余净增661行。两lane的增量完全不计入当前主树统计。后续继续施工或导入会改变数字，不能据统计称验收通过。

## 8. 局限与完整清单

- 当前源码和已统计文件在读取结束时复核哈希，未发现读取期间变化；这是一个固定时刻的统计，不冻结并行任务。
- 无法由行数识别真实功能必要性、语义重复、复杂度、性能或完整交付；新增源码还包含待接线骨架及主树2行runtime-configuration预置文件。
- 文档/部分工程资源缺可靠B1总基线，已标未知，未强行追齐历史。Kernel使用独立9月24日源码对照。
- 每个文件的分类、当前/基线行数、+/-、SHA256、匹配快照来源、批次追溯，及未导入lane的逐文件差分，都保存在 [new-code-inventory-20260926.json](new-code-inventory-20260926.json)。
