# C1 第二阶段：实现已中审的Session邮箱与工具

主审已完成骨架/测试中间审核，报告 docs/refactor/reviews/next-b2-c1-middle-review-2026-09-26.md。现在实现且仅实现本批；不停止在计划。施工 T=coding-platform/next，旧src/tests只读。先读 docs/refactor/tasks/C1-session-mailbox-skeleton.md（含末尾V2冻结补充）、DSH-WORKFLOW与真实上下游，直接复用原Store/Material/Role/WG11/Session。

只准写同名scope JSON的3个现有文件：mailbox-service.ts、message-record-codecs.ts、communication-tools.ts。全部接口、共享类型、测试和fixture只读。不要原子rename；用Python/Node原地写允许文件。不能创建probe或改scope外目录，权限无需升级。必要新文件或接口缺口报告主审，不绕过。

测试已由Astra修复并冻结：next-session-mailbox 61项（骨架51红/10绿），同一真实fixture/backend，Model/Kernel无需启动。stage1 adapter已恢复unsupported，需实际实现。不要删assert/放宽失败码/返回fake committed来过测试。实现通过后运行 next-types、next-architecture、next-session-mailbox及next-task-claim/next-material-readers适当回归（同批测试可合并）。报告真实结果、唯一风险及复用。

新动作work_run必须V2 entered+固定mapping+Session/lease exact owner/generation+原Role facts与envelope工具；原request回执先恢复，不被后来终态/RoleSpec授权矩阵变化误拒。body内部system Host仅已核邮箱业务后的精确正文执行，不代替原命令actor。send stable messageId、body先存再一次metadata/event/receipt提交；readBody核完整scope/messageId/part/sender/source，不接受调用方bodyRef。keyset live分页沿注册索引，不扫事件；不把cursor绑定全账本水位。message不是强wait/义务，不抢占、不隐式唤醒、不改Session/Task。

工具仅由真实callId+受信run闭包派生requestId；严格schema；异步开始前快照输入/context；将调用signal纳入实际服务取消，迟到取消不能掩盖已提交。读与平台状态写effect声明保留，不伪装workspace文件副作用。具体测试与接口冲突给出真实反例，由主审修订后明确刷新，不能实现者改测试。

交付后停止，等待主审独立代码审阅和集成；自检PASS不代表整个C1/B2产品完成。
