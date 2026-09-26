# W2 工具与职责资源：第一阶段骨架/测试

本任务只做骨架/独立测试然后停止，不提前实现handler。主审架构见 W2-agent-whiteboard-skeleton.md，重点§5、§6.7/9/10、§8.3。本lane独立于B2/C1/M1与Plan实现，旧源码只读，唯一目标next。先读DSH-WORKFLOW、CODE-QUALITY及C1 communication-tools、原PlanTaskPort、B1 observed-model-run和Kernel FileSkillLoader真实接口。不要增加新Role/Skill子系统。

冻结 createWhiteboardTools / WhiteboardToolsConfig 和4工具名沿主任务§8.3；源码只有白板工具工厂。可信config固定Goal/context，requestId由实际callId+Run/op派生；模型不得提供ctx/权限/身份/请求id/作者。严格schema输入，typed拒绝不伪成功，正式写为平台状态副作用不是文件变更，首await前快照，真实signal转发，已commit后晚取消不能说未提交。复用PlanTaskPort/W1，全scope/未来任务/Agent授权由原正式服务把关，工具不扮Host。不新增Plan工具引擎。

骨架可以定义准确names/schema/effect，handler显式返回unsupported对应ToolExecutionFailed；业务算法第二阶段做。工具测试至少覆盖真实callId/固定scope/未知权限字段/typed结果/取消时序，不mock工具自己，让底层PlanPort记录实际请求；这些只是adapter边界证据，不宣称正式Plan生产接线。

资源目录仅 platform-secretary、platform-adviser、platform-scribe 各skill.json+content.md。按现有Kernel skill.json真实格式；阶段一合法manifest，content明确待实现职责占位，不提前以完整内容让职责测假绿。测试用真实FileSkillLoader验证资源、启用子集、摘要及在真实scripted Kernel请求出现（复用B1能力），测试期望第二阶段职责内容：秘书按局部图/Session事实解释可用与待决；参谋区分具体输入依赖和整体任务完成、在授权内propose/apply；书记区分事实/推断，不把Run ended/消息回复写成Task完成。不是模型能力评分，不能用关键词出现宣称真实角色智能。安全规范由组合根可信systemInstruction复用现有内容，不能复制vendor文件或造跨root loader。

精确scope JSON共9文件，主审预建。全部其他文件只读。遇接口缺口报告具体位置，不扩大scope。Python/Node原地写，禁止rename/probe，禁止修改DSH全局配置/凭据。检查 python3 tools/dsh-refactor/check.py next-types / next-whiteboard-tools。交付需求→复用→接缝→红测原因，独立中审后再实现。
