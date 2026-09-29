# AG1：Agent 发现关联 Session 并发出咨询

2026-09-27 用户授权“先把 Agent 相关计划写一下然后执行”。行为计划见 [AGENT-BEHAVIOR-PLAN](../AGENT-BEHAVIOR-PLAN.md)。基线为独立根 main d0dc9d6 加当前未提交工作，必须从本轮快照施工；保留已导入角色解析清理。状态：已两阶段实现、独审并精确导入。冻结测试151行、两条用例，未扩矩阵；独立6文件/42项、Node/UI类型、架构检查通过。[证据](../reviews/evidence/agent-behavior-2026-09-27/ag1/verification.json)。生产TS净+307行；没有新增owner、状态表或模型循环。

## 主审确定的行为与范围

真实 Work Run 的模型读取已有 Task/Module/Work 关联，选择相关 Session，查看其卡片，再通过已存在的 `send_session_message` 发咨询。只交付“发现→选择→咨询请求入箱”。发送不是启动接收方，不是答复，不创建 Task/Run，不声称两个 Agent 已协作执行。

新增 `src/core/agent-runtime/session-discovery-tools.ts`，沿现有 `{names,create}` 工厂：

- `SESSION_DISCOVERY_TOOL_NAMES = ['find_related_sessions', 'read_session_card']`。
- `createSessionDiscoveryTools({sessions, context})`；sessions 仅需原 SessionDirectoryPort 的 findSessions/readSession，context 来自 Runtime 实际绑定，模型不可提供身份或 workspace。
- `find_related_sessions` 参数为 `{target: WorkLinkTarget, page: {limit, cursor?, atLeastCursor?}}`。target 必填；直接调用原 findSessions，workspace 使用绑定 context，includeArchived 固定 false。复用现有 task/work/module target 结构和分页上限，严格 schema。只查当前打开的关联，不假称已支持 ended-work-link 发现。
- `read_session_card` 参数为 `{sessionRef: SessionRef}`。原 readSession 原样读取，无追加历史/源文件/模型调用。
- 两工具均 read_only，沿已有 Kernel extension registration，不修改 Kernel。success 的 JSON 保留完整 ReadResult（含 status/value/source），非 ready 保留原 typed result 且不能宣称成功；取消信号转发。不要复制邮箱写请求身份、重放、material/Role 检查到只读工具。
- execution-driver 把新工具名加入现有协调工具选择；ExecutionDriverDependencies 的 Pick 加入已有 `sessions`，不新增 composition dependency。仍只从 manifest/Role/Host 的有效 tools 集合装配。
- secretary skill 写出“查当前关联→按职责/可用性选择→必要时咨询；无候选/不可用如实报告”。普通状态读取不要求咨询；不得自动新建/唤醒/并发启动 Session。

## 目录只读边界

仅给 session-directory.ts 的 readSession/findSessions 增加窄 readContext helper。现有 trustedContext 与 admit/record/getOperation/生命周期写不变，仍 Host-only。

- Host read 复用原 trustedContext 与原 actorKey，保持既有 cursor。
- work_run read 同步快照绑定 project/workspace、RunRef 和信号；精确读取一个 Run，复用 tasks/run-state-service 的 decodeRun，核对完整 RunRef 和 Run.workspaceSnapshot.workspaceId。cursor 的 actorKey 可沿用字段名，内容为 canonical({kind:'work_run',runRef})。
- 不伪造 Host actor，不调用加载整条执行链的 readExecution，不重读 lease/Role/generation，不要求只读时 Run 仍 running；不存在的 Run 不能借此读取 workspace。Query 本批不开放。
- 校验目的仅是目录读取范围与分页身份，不是重复每次模型/工具准入；保留 owner 已有局部输入及分页一致性规则。

## Stage1：只写测试后 STOP

仅可写 `tests/composition/AG1-session-discovery.test.ts`，复用 C2-runtime-platform-fixture 和真实 SQLite/Kernel/Role/Plan/Session/claim，不新增 fixture，不改生产。工具名用上述字符串，当前生产应在未知工具处 RED，而不是导入/类型错误。

控制在两条有意义的行为用例：

1. 经正式 linkSessionWork 为第二 Session 关联一个已存在 Task，脚本 provider 通过真实 Kernel 调用 find_related_sessions → 从返回候选选择第二 Session → read_session_card → send_session_message → 正文。选择参数必须来自前一次真实工具结果，不能把第二 Session 硬编码进 provider 调用。最后核真实收件箱 message/body、接收 Session 仍 idle、普通源文件授权未被调用；证明读没有触发额外模型调用。受控 provider 仅证明接线，不声称模型自主选择质量。
2. 用真实 Run 的 work_run context 验同 workspace 能读；声明其它 workspace 拒绝；work_run 的分页 cursor 不能被 Host 使用；work_run 不取得创建/生命周期写权限。通过正式生产者造状态，不篡改数据库。

跑该文件一次，确认 RED 的准确位置，然后报告并 STOP。不要扩大恶意输入、并发、重启矩阵。

## Stage2：主审冻结测试后实现

只写 scope 中三源码、secretary内容与runtime-assets.json中该内容的摘要：新薄适配器、目录读边界、driver装配、角色说明及其必要资源清单。测试冻结只读。不要改 Kernel、Host HTTP、UI、Workflow、Query、控制生命周期、材料权限、Role绑定或此前清理。

先跑 AG1 与 C2 Runtime/组合根、R4b目录/A1发现中实际受影响文件，再 Node/UI类型及边界；通过即推进，不追求测试矩阵完备。未通过先区分契约、实现、fixture，不循环打磨非阻塞断言。单文件 bind mount 原地写入，禁止 rename 替换或放宽权限。

## 独审收口

主审将第二条测试收窄成正式Run身份下的直接目录读，避免重复模型流程；修正了输入跨await快照、只读工具错误文案、busy允许异步咨询及资源摘要同步。最终导入文件哈希与通过检查的隔离候选一致。Role/Host未授予工具时不会仅因Skill存在而可调用。AG2–AG5仍按行为计划推进，不把本批当完整Agent编排完成。

真实DeepSeek追加验收已通过：4次模型调用、3次成功工具调用，模型选择真实返回的idle候选并发送咨询；后续只读不调用模型，接收者仍待命。见[结果](../reviews/evidence/agent-behavior-2026-09-27/ag1/live-result.json)。未为此修改生产或默认测试集合。
