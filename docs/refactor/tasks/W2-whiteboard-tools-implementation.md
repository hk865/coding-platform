# W2 工具与职责资源：第二阶段实现

Astra 已完成骨架/测试中审，18 项中 7 通过、11 因尚未实现转发/职责而红。精确 scope 仅 whiteboard-tools.ts 与三职责的 skill.json/content.md；两测试及 Plan/共享契约只读。先读 W2-whiteboard-tools-skeleton.md、W2-agent-whiteboard-skeleton.md、CODE-QUALITY-GUIDELINES §2.1、PRODUCT 最新未来节点补充，以及真实工具/Plan/Kernel Skill 接口。

冻结要求：工厂创建时同步固定可信 context/Goal，不能每次 handler 从可变 config 重读身份。真实 ToolCall 的 callId 形成稳定写入请求；原 AbortSignal 转发，拒绝模型注入身份/权限/请求id。四工具复用唯一 PlanTaskPort，不做 Host 冒充，不复制 Plan 规则。JSON 输出保留完整领域 ReadResult/WriteResult，包括 cursor/replayed、not_ready 与 rejected/code/reason/current，不只 value。保持正式提交后的晚取消回执，不将 committed 说成未提交。语义缺项由正式服务解释，不在工具中增加“完整验收/分配才可提案”门禁。

输入描述解释 Plan v2 与五类 pins 的真实格式和必要例子，复用领域校验，不造第二套语义 schema。职责正文：秘书从完整图追踪未推进未来意图和缺项；参谋在已有授权内逐步细化并使用 propose/apply，缺验收/依赖不是遗忘节点的理由；书记区分事实/推断，Run 结束或消息不是任务完成。按现有 FileSkillLoader 格式提供资源，不造 Skill 管理器。当前领域尚不支持的路径须如实说明工具拒绝，不能在 Skill 中宣称已落地。Memory/知识库不是本批门禁。

中审冻结真实 FileSkillLoader/subset/digest、完整 typed 结果和参数透传、工厂隔离及取消测试，并有真实 Kernel 工具轮次。记录型 Plan 端口仅证明 adapter，正式 Run/WorkGraph/组合根链另验；不拿关键词证明模型智能。

检查分别运行 `python3 tools/dsh-refactor/check.py next-types` 与 `python3 tools/dsh-refactor/check.py next-whiteboard-tools`。原地写 scope 文件，不创建临时兄弟文件或改测试，发现契约缺口报主审，不扩大范围。交付复用/行为/检查及真实剩余项后停止。
