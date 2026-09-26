# C2 Runtime 平台工具：中审冻结后的实现

仅在主审完成骨架/测试导入并创建本次implementation lane后执行。详细契约以 `C2-runtime-platform-tools-skeleton.md` §1–8及中审修正为准。本次第二阶段实现，不重写测试，不重新做Stage1。

## 目标与范围

读原任务书、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW/DSH-EXECUTION-HARNESS、当前HANDOFF；沿真正的B2 entry/model、M2、W2、C1、Kernel公开扩展接口检查调用链。按implementation-scope只写三文件：execution-driver、mailbox-service、create-platform。已审核契约/adapter/decoder及全部测试只读；不改Kernel、旧工程、DSH配置，不新增管理层。原地写，不能临时同级文件rename。

1. driver从真实Run/Session/manifest创建固定work_run上下文、Run材料身份，以真实callId在完整Run/Session/operation命名空间派生稳定requestId。复用C1/W2两个工厂，names和实际definitions一致且严格取有效manifest交集；未知/缺依赖fresh早拒绝。先保留原entered/终态重放观察，再核fresh依赖，不因当前工具配置阻历史。
2. 同一次runObservedModel接coordinationTools。内置文件/进程权限和平台工具分组；仅平台工具时跳过初始sourceHost.authorize/assertCurrent/source factory，保留Kernel所需真实root。readOnly仍按文件writeScope，不为平台写打开文件权限。现有skills/resourceRoot/enabledIds/systemInstruction透传，显式空不回落。
3. mailbox新写receipt miss后复用readStoredManifest/recheckHostRoleAdmission与同次真实Run关联guard，替代旧重复Role解析；不得叠加另一授权算法或制造热换Role生命周期。fresh拒绝/commit冲突后回查原receipt；原已提交事实不能因后来撤权变成未发生。
4. 历史身份只读精确Run/outbox/Session，复用已导出的既有decoder；不为历史读查当前Plan/Attempt/Lease或模型预算。继续核外部caller确是原身份、actual accessscope和正文来源；不是扩大历史读范围。
5. 组合根沿原任务§3.1：同一个reads/source/bodies建M2 facts；提前唯一executionReader和可选authorizeConfiguration；唯一Plan注入delegatedWrites；C1/entry/model同回调，Runtime同plans/messages。无runtime配置不造假Host；tracked外部调用继续排空后关store，不回注包装端口。

## 验收

冻结13个目标测试包含真实Kernel通信往返、白板query/propose/apply/query、部署Skills、源码授权真实拒绝但平台工具成功、M1→W1→consumer→M2模型材料与撤权后历史保留。C1夹具显式entered seed只证领域入口；C2真实composition证明生产生命周期，不能混淆两者。

`python3 tools/dsh-refactor/check.py next-runtime-platform-tools next-session-mailbox next-runtime-execution next-whiteboard-tools next-agent-whiteboard next-b2-composition next-material-facts next-b2-material-admission`；next-types与next-architecture单跑。不改其它批次的目标红测；不重复全仓矩阵。

完成后交回差异/复用、真实达到的断言、scope hash及检查。非预期失败须定位真实消费者，接口不足先报主审；不得放宽测试、默认授全部tools/Skill、使用Hostctx替Agent或伪造无副作用。此批仅闭合现有原语消费者，不代表Workflow自动组织或完整产品。

## 独审返修：同请求 ack/respond 的真实竞争

原三生产文件实现已交回，独立13文件170项及types通过；mailbox独审发现真实同键竞争遗漏。本次继续原Session，只修改 mailbox-service.ts，保留driver/composition已审字节，全部冻结测试只读。

A/B 同 identity/fingerprint 首次 lookup 均 miss，fresh admission 成功后，A正式ack/respond提交，B随后loadMessage得到read/responded。当前B直接invalid，必须在这两个状态拒绝分支复用原 recheckAfterMiss 恢复已存在的原committed receipt；查不到仍保留原业务拒绝，不制造第二提交、重写正文或改变新请求语义。无需新授权算法、内部状态篡改测试或通用重试框架。主审已经用真实records wrapper在消息读取窗口构造该交错；新增参数化测试须全部实际达到，不放宽断言。

自检 next-runtime-platform-tools next-session-mailbox next-b2-composition，单独next-types。完成即STOP，报告最小差异/hash。其余13文件170项已独立验过，仅因本次窄变化复测相关集合，不重复29文件通用矩阵。
