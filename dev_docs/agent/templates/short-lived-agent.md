# 短生命周期 Agent 自由模板

状态：设计模板，尚非已实现的运行时 schema。上游依据：[ARCHITECTURE](../../../ARCHITECTURE.md#角色记忆与-context-的责任归属)。

用于配置产品运行时的一项临时工作；不是构建本产品的 Development Ticket，也不是必须常驻的新角色。职责名称和任务步骤可自由组合，框架约束保持明确。

## 配置模板

```yaml
template_name: <自定义名称>
template_revision: <版本>
role_label: <调查／检索／测试分析／实现，或自定义职责>
purpose: <这次要回答的问题或完成的有界工作>
parent_ref: <Runtime Task 或 QueryJob 引用>
scope: <Project／Workspace 与允许涉及的范围>
inputs:
  source_refs: [<规范、代码、报告或证据的版本化引用>]
  context_budget: <有限上限>
procedure: <按任务填写；可引用适用 Skill>
permissions:
  policy_ref: <已有授权策略及版本>
  tools: [<允许工具>]
  write_scope: [] # 默认只读；写入须显式授权并取得适用 lease
limits:
  token_budget: <有限上限>
  deadline: <截止条件>
  retry_limit: <有限次数>
outputs:
  - <答案或产物引用，以及对应来源／版本>
  - <验证结果、未验证判断与不确定性>
exit:
  success: <可检查的交付条件>
  stop: <预算耗尽、取消、缺少授权或无法继续>
  handoff: <已做事项、未解问题、产物与下一步>
```

## 绑定与退出

1. 协调者填写任务内容；框架核对引用、权限、有限预算和输出要求后绑定 Run。已授权任务无需每次请人批准。
2. ContextCompiler 加载必要材料。缺少事实时按权限检索；缺少授权时返回缺口，不自行扩大范围或启动无界子 Agent。
3. Run 产出结果与有界交接后退出；取消或耗尽预算时在适用安全点退出并报告未完成部分。框架负责资源回收、记录终态和验证交付，Agent 的成功声明不直接完成 Task／Goal。

例如：临时“接口冲突分析者”读取相关契约、代码差异和失败测试，输出冲突定位、方案及不确定性后退出；没有写入授权时只提案。静态查询已经足够时直接返回工具结果，无须创建此类 Run。
