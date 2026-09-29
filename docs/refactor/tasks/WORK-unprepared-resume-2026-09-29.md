# 原 Work Run 未准入时恢复 prepare

真实阻塞：旧grant含不支持project_source，prepare前配置拒绝；已claim Run status=starting、envelope=null、无executionAuthorization/inputBinding/Kernel运行事实。配置修复后重启正常select_work仍因existingRun停住。

冻结scope仅workflow.ts与现有R5c-workflow-platform.test.ts。基于当前dirty根新lane work-unprepared-resume-20260929，两阶段DSH。

selectNext当前active executable Work已有row.execution时，读取正式readExecution。仅Run starting且未授权、无envelope/inputBinding/进入或运行事实、无paused/cancelled控制时，返回原Run既有perform prepare（按当前flow产生requestId）。保TaskAttempt/Session/Lease，不重新claim/create，不造恢复管理器。已授权/entered/运行/未知/终态保现有规则，不重启。prepare/start owner全校验不变。

Stage1仅现有测试添加一个公开可达正常case：真实claim→Host resolver配置拒绝prepare→恢复配置→普通selectWork返回同Run prepare，核TaskAttempt/Session/Lease不变；必要边界使用正式prepare/entry实际已授权Run不能再次resume。复用现fixture/controlled model，禁止直接篡改records制造前态。生产不实现；窄测试红因/类型报告后STOP等主审Stage2。无需产品模型/live/真实工程写入。Stage2批准后只小修selectNext，限定本test/types通过即STOP，不扩大矩阵。
