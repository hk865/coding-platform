# R4.2 Kernel工具组安全点：只交骨架与测试

本轮只做 `R4-control-recovery-skeleton.md` **§10** 已核DTO、接缝和六组公开测试；§1–9是后续平台控制背景，不实现其中R4.1/3/4/5。本批独立于R5a，不改next/src/composition或Runtime/WorkGraph。

先读当前HANDOFF、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW/DSH-EXECUTION-HARNESS、next vendor两份README和原Kernel AGENTS/INTEGRATION；旧路径按C/AGENTS翻译。原C/src/tests/vendor源均只读。next冻结Kernel是唯一运行依赖，不安装依赖、不执行旧kernel:build。

主审已从当前maps按精确hash提取三源并扩展同一build-kernel-patch.mjs，**六源24项产物逐字再生通过，尚无行为变化**，证据见reviews/evidence/next-b2-2026-09-26/r4-tool-group-baseline-repro.json。无需再次提取覆盖；构建名单现已冻结，不扩scope。唯一写范围见R4-tool-group-barrier-skeleton-scope.json。原地写入，不用同级临时文件rename。

阶段一：完整ToolGroupBarrier三DTO、可选dependency和run/resume三处透传；未传callback保持旧行为。新callback边界明确unsupported，不悄悄忽略，不提前实现真正pause/drain/控制归约。类型能编译；生产只能从受管TS再由原脚本--write生成对应产物，不手改dist/map/d.ts。public-api仅type re-export，不扩模块状态机或Hook权限。

测试从dist/public-api.js导入，复用真实SQLite/脚本模型/required sink和现公开Tool定义；六组具体断言见§10.5，断最终行为，保持真实旧路径绿。不要为测试重写Kernel循环或seed paused。新红必须已到达本批unsupported接缝，未到达后半段如实报告。callback未返回、工具未结算、requiredsink未落盘均不能声称paused；取消/unknown原语义保持。

检查：python3 tools/dsh-refactor/check.py next-tool-group-barrier next-frozen-kernel next-kernel-history-public next-runtime-execution；next-types单跑；在next用node scripts/build-kernel-patch.mjs --check验证全部24项。不要重复原Kernel全工程矩阵。完成骨架/测试即STOP，等待中审，不进入第二阶段。报告文件/hash、真实首红和未到达断言、公开旧绿路径及产物再生结果。

## 当前指令：Stage1 中审返修

首次骨架已STOP。只执行原任务§10.6四项测试返修，仅tests/kernel/R4-tool-group-barrier.test.ts可改；四源/产物保持已审字节，构建名单只读，不进入实现。原§10.5仍是目标语义，§10.6补真实时点/收尾，不新增生产API。完成STOP。

## 当前最后一次 Stage1 小修

§10.6四项已独审满足，源/生成物继续冻结。仅改同一测试group3在releaseB后的等待：当前只竞速resultSinkEntered与outcome，若错误实现提前await after_group会卡住，finally无法到达。改成resultSinkEntered、afterGroupEntered和outcome三者竞速；提前进入after_group必须立即assert失败，走现有finally释放全部gate并await outcome。正常路径仍验证result sink未完成时after_group不可调用，不改目标断言、不新增测试矩阵。只跑原目标+邻接和types后STOP，给最终hash。不得改生产或任何生成物。
