# 完成 Work 后跨 flow 续原检查轮

真实事实：Work completed，open_checks 已创建正式Round，run_check在ProcessSandbox探测拒绝，尚未begin/spawn，check pending/ticket null。Host恢复正常沙箱后刷新生成新flow，select_work跳过未verified的原Task而执行其他Work，最终卡住。不得重新Kernel或claim。

两阶段DSH，lane work-check-resume-20260929，新当前根快照；scope六文件见同名scope。Stage1红例/窄接口后STOP待主审，不直接实现。

冻结：现EvidencePort可选queryOpenVerification(ctx,{subjectRunRef,subject,planRef})，返回ReadResult<RoundSnapshot>；同一现RecordStore.lookup新增VerificationRound按ref.projectId/workspaceId/goalId/taskId/runId/status=open索引。正式codec校验scope与plan；0明确not_found，1返回原round，>1 incomplete不猜latest。不存在端口/读取unknown绝不是无round，Workflow必须wait。无新表、owner、manager。SQLite已有snapshot加JSON表达式index可查询旧轮，无额外回填表；实际reopen路径要验证。

selectNext对active executable Work的正式Run ended/outcome completed且Task未satisfied/failed，先查原未finalized round：存在则nextAfterRound原轮，pending仅走原registeredcheck，executing/interrupted返回waiting；明确无轮才openWorkChecksStep。无重启Kernel/新claim，无成功/失败/取消重跑。保其他同Goal并行规则，不造全Goal锁。不同flow也是同轮，不能用新open绕unknown。现round replay/正式检查owner限制不变。

Stage1复用R5c composition fixture一条可达case：正式Work完成/openround→实际check入口在begin前拒绝（可现workspaceHost授权开关，不碰records、不伪造执行/成功）→恢复环境→新flow select回原round pending，provider次数不增加、RoundRef不换。正常原round begin后executing，再新flow必须waiting。SQLite重开后查到原轮，不用空列表冒充通过。复用既有helper，不造测试森林。只此测试文件+types；产品模型/live服务/真实用户工程禁动。


## 本批结果

2026-09-29：两阶段 DSH 与独审返修后六文件精确导入，R5c 4 项、类型、构建、边界通过。查询同 Run/Task/Plan 的原检查轮（含 finalized）；PASS 续完成、非 PASS 等待，未开始检查续原轮，运行/结果未知不重复执行。真实工作台点击继续后原轮 fc0f6261-ef3d-41c2-bb82-12662156d800 完成 PASS，随后目标 gate PASS、Goal COMPLETED；未新增模型调用。见 `../reviews/evidence/goal-cold-start-2026-09-29/check-resume-import-hashes.json` 与 `live-result.json`。
