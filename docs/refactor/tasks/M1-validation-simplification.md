# M1 已审核实现的局部去重

保持已冻结 M1 类型、测试、授权及失败语义。唯一写范围 `coding-platform/next/src/core/work-graph/materials/grant-service.ts`；这是原实现独审后的局部修订，不新增接口或能力。

1. grant 首轮遍历每份材料，在真实 openArtifact 并核精确 ref/digest/owner 后，针对同一个完整 owner RunRef 只调用一次 loadOwnerRun。已有 ownerRefs Map 可兼作该轮已验证集合，只有验证成功后加入；不提前信任正文自报owner。N材料/U owner的这部分直接authority调用由N降为U。不能跨 source.capture 缓存 owner：捕获后现有每个唯一 owner 正式重读和提交 guards 必须原样保留。每份材料自身读取/摘要/来源核对也保留。没有全局缓存或新的权限对象。
2. revoke 已在入口把 expected revision 严格限制为1，正式读取也限定 grant.revision=1；删掉随后恒真的两者相等比较，不删前两项约束。先核真实当前源码，若前提不成立则不删并说明。

先读现有 M1 任务与 CODE-QUALITY §2.1。冻结测试只读。运行 next-types、next-material-grants 与 next-material-readers，报告改动前后直接调用数量（不冒充端到端性能基准）、真实结果及保留边界，然后停止。禁止其它文件或DSH全局配置修改。
