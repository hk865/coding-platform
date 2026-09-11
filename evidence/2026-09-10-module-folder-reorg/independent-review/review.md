# 模块目录迁移独立审查

审查日期：2026-09-10。范围：用户提交的模块目录迁移结果；不重新审阅全部历史功能，不修产品源码或权威文档。当前工作树存在大量既有未提交修改，因此使用迁移前清单 745/763719…cfc6、迁移映射及最终 744/f36287…8d3a 作为固定比较范围，没有用 HEAD 以来全部差异冒充迁移差异。Standards、Spec 由两个未参与迁移的只读子 Agent 分别核对，主线程独立核对源码身份、路径与日志。

结论：代码目录迁移方向正确，本次检查未发现新增运行时错误或错误 import 目标；交付文档与审计数字有需修正的问题，不能原样认定“所有收口材料一致”。无需另开重复 Reviewer 恢复功能票。

## Standards

### S-01 / P2：权威 Module 目录表中 8 行错误

文档根 `dev_docs/interfaces/module-boundaries.md:10–19`：PlanCompiler、DispatchEngine、VerificationEngine、ArchitectureReconciler 全写成 `src/control/control-engine/`；StateLedger、ArtifactVault、ReadModelIndex、ContextCompiler 全写成 `src/data/workspace-reader/`。同页第 3 行示例也重复 ControlEngine 路径。新段声称一模块一目录，却与实际源码和 `scripts/module-map.mjs` 冲突，人员或 Agent 按规范导航会进入错误模块。

应改为各自的 `src/control/{plan-compiler,dispatch-engine,verification-engine,architecture-reconciler}/` 与 `src/data/{state-ledger,artifact-vault,read-model-index,context-compiler}/`，并修正文件数口径。文档校验 13/13 只证明其覆盖的检查，未检出本项语义错误。所有 Module 目录 README 的本地 Markdown 链接已独立检查，可解析。

维护性备注（不计缺陷）：`tests/contracts/module-ownership.test.ts:73` 的 MODULE_FILE_INVENTORY 是 12 份精确文件清单。它能发现未登记文件或移动，但合法新增/重命名同样需要更新清单；不能自动判定代码业务职责。目录映射已摆脱文件名名单，不等于测试不再维护名单。无需为此删除现有测试，准确限定其保障范围即可。

## Spec

### P-01 / P2：最终身份及验证原件未在主报告中收敛

`reorg-report.md:117–122` 与 `verification-summary.json` 仍以 after 752/01c88…d4d9 为结论，用户冻结身份是 final 744/f36287…8d3a。独立比较共同 742 文件哈希全部相同；final 增加 AGENTS.md、pnpm-lock.yaml，排除 10 个源码模式 workbench 生成资源。差异来自清单范围，未发现共同文件的实现漂移，但报告必须明确这层转换。744 清单不覆盖 workbench 字节，不能把这部分运行依赖描述成已由该摘要冻结。

迁移浏览器、构建、文档原始日志实际存在于 WSL `/tmp/reorg/browser2.log`、`build2.log`、`build3.log`、`docs-validate.txt`，并非没有执行；原 evidence 目录仅列 summary，未保存这些原件和摘要。审查已将原件复制到本目录的 `original-*` 文件，保留原位置，机器索引见 `review-results.json`。应在迁移主报告中引用持久证据及正确身份范围，不需要仅为文案口径重跑所有验证。没有可证明相同范围运行开始/结束身份的原始材料时，保留该边界，不事后补造运行时快照。

### P-02 / P3：迁移浏览器基线应为 25 → 25

`reorg-report.md:115`、`verification-summary.json.baselineComparison.browser` 写迁移前 23，混入了更早批次。DEF-17 已在 747/c399…ac61 身份下验收全仓 256/1664 和浏览器 25。其 `browser-final.log:15–16` 明确包含恢复入口两项；迁移前清单中的恢复 spec、HTTP fixture 与核心恢复测试 SHA 均匹配 DEF-17 最终清单，DEF-17 verification-results 引用的 7 份日志摘要亦已独立核对一致。

迁移 Agent 没有亲自执行 DEF-17 验收，不等于产品没有验收。正确做法是引用已接受 DEF-17 身份及实际迁移回归，而不是另开重复功能票。

### P-03 / P3：181 是迁移表行数，实际只有 180 个唯一文件

`path-migration-map.json.moves` 首两条均为 `src/app/terminal-sandbox.py → src/execution/worker-runtime/terminal-sandbox.py`，后一条只多了 previousGuessedFrom。共 181 行、180 个唯一旧路径、180 个唯一新路径。因此 `reorg-report.md:37` 与 content-preservation/report-data 中按 181 文件计数的表述不准确。去重并重新计算统计即可；当前没有证据表明此重复行造成文件丢失或 import 错接。

## 主线程独立源码与运行核对

- 最终清单 744 项逐文件读取、SHA-256 与整体 JSON 摘要复算，0 缺失、0 字节不符；整体摘要确为 `f36287a561fe4499043d370d1c73a7adbf012289db7d153974828760b3ec8d3a`。
- `audit.mjs` 用 TypeScript AST 枚举 685 个有迁移前对应的 TS/TSX/JS/MJS 文件，共 6066 处相对模块引用（含 import、export、类型 import、字面量 require/动态 import），当前解析失败为 0。这与原报告 1710 的统计口径不同，未直接沿用其数字。
- 将当前引用目标和文件位置按迁移表还原，672 文件的完整重建字节与 before SHA 精确相等；这同时校验对应正文与相对目标，不只是验证目标存在。
- 余下 13 文件由 `recover-before.mjs` 从本仓库 Git 对象查找，均匹配 before 清单的完整 SHA-256；对象号和原件见 `recovered-before.json`、`before/`。恢复到独立证据目录，没有覆盖工作树源码，Git blob 本身不证明历史生成时间。
- 逐项检查余下差异：module-map 改纯路径；检查器 fixture consumer 路径；copy-ui/verify 脚本及 Runtime、Python/C++、Reviewer fixture 的运行期路径；ledger-validation 注释路径；ReadModel 的三个冗余相对路径规范化。未发现额外业务逻辑改写。具体差异见 `diffs/`；这些是原字节与“逆转 import 后字节”的比较，非直接新旧文件原始 diff。
- 当前模块内全部 import.meta.dirname/url 位置已检查；内核、Skill、分析脚本和依赖路径层级与新目录对应。未发现漏改的同类位置。
- 新增目录测试 8/8 由本次独立执行通过，2.19s；边界检查 366 source / 367 inventory，issues=[]。见 `ownership-tests.log`、`boundaries.json`。
- 原全仓日志实际记录 257 文件 / 1672 项、800.81s；原浏览器日志实际记录 25 项通过。本次没有再执行全仓、浏览器、完整构建或模型任务，不能把原日志写成审查者重跑结果。

## 处置建议

修正 S-01 的 8 个路径及计数；把 P-01 的最终范围和已有日志关联补到主报告；修正 P-02 浏览器旧基线及 P-03 重复计数。保留 contracts 原位、旧失败和历史证据。无需重做目录迁移或重新实现 Reviewer，也不因本次检查声称整个产品完成。

本次仅新增 independent-review 下的审查脚本、报告、原件副本和结果，不修改原证据、产品代码或文档根。Standards：1 项 P2；Spec：1 项 P2、2 项 P3。没有发现 P0/P1 或已证明的新增运行时缺陷。
