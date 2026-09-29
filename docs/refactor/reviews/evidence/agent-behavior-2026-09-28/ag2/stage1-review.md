# AG2 Stage1 中审冻结

2026-09-28，DSH session-fa035c5e-bfdf-4537-ae54-848a1687833c。仅新 AG2 测试变化，R6-host 未改，scope audit 无越界。主审独立运行：3 个 AG2 用例均真实抵达未发布 workflow/consultation 的 HTTP 404，既有 Host 9 项通过。

主审修正两处后冻结：错误 recipient claim 必须先存在正确绑定的 pending Query；第二条消息必须有真实 responded/Answer，不能以 undefined 的不相等冒充隔离证据。后者按现有 QueryJobAnswer ref 类型核对。其它消息独立 Answer 通过消费者路径验证；直接 Answer 错挂边界由 Stage2 实现审查核对，不宣称已有直接负向用例。

不增加异常矩阵。生产接口以 AG2 任务书为准，测试只读进入 Stage2。
