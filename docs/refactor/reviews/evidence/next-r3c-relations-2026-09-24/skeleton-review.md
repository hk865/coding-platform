# Astra 中间审核：已通过修订后的骨架与测试

2026-09-24。DSH第一阶段 session-793152ca-22bb-4af3-bb57-17212884ac19 已结束且只改一个批准测试文件。原有Sol产物复用。

原提交并非直接通过：主审核实固定Store只按aggregateType注册codec，不持久独立schemaId；因此改为稳定PlanRevisionSnapshot@1机械编码器 + 显式正文schemaVersion1/2，拒绝未知正文与v1新字段，不扩Store。删除DSH额外提出的legacy Proposal根层任意字段拒绝断言：本批新字段属于Plan正文，不应在另一层重写历史兼容规则。

修正关系fixture缺Run注册，改用真实material/governance schema；消费者保持pending，只有生产者Run运行；修正部分对象数组断言；更新已有两处错误候选测试预期。新增真实跨Goal已接受Plan绑定反例与组合根Host-current来源拒绝、重启及关闭入口测试。明确历史Plan选择只定位引用，current由当前reader材料授权判定。

类型检查PASS；冻结红测12项，9失败/3通过，均为新行为缺失（v2正文、缺phase默认值、旧前驱门槛），无夹具注册错误。测试hash见frozen-inputs.json。下一阶段仅准修改5个生产文件，重新启动调用；不是连续自由施工。最终验收仍需独立审阅和隔离构建测试。
