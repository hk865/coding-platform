继续同一个R3g Session，原scope不变。主审未通过，不导入主干。已刷新只读独立测试，先读最新R3g-role-spec.test.ts新增的review malformed permission/read option测试。修复：
1. resolveRoleBinding.declaredPermissions是必填待核集合。缺失不得默认空；tools/writeScope必须数组且每元素非空字符串，所有请求结构先校验，坏形状返回rejected invalid；有/无matrix都如此。RoleBinding也应检查完整必填字段及正整数bindingVersion；policyRevision仍仅来源metadata，不加授权限制。
2. readRoleSpec把input+options在首await前一起snapshot。options.atLeastCursor不可在await后读取原可变对象。
3. replayInstall/replayActivate在现有event scope/ref/idempotency校验之外核event.actor等于command.identity.actor，防损坏事件恢复错身份回执；不要要求重试commandId/correlation等于原事件（idempotency业务重试允许这些换值）。
4. activate把lookupCommit/原receipt恢复放在读当前spec/active之前（验证ctx、command形状/scope及fingerprint之后），避免原回执依赖当前active读取、重复校验；install的now/eventId等只在确认非replay后生成。保持原子Project/spec/active CAS、安装无Project门槛（旧治理初始化兼容），不要新增层。
运行next-roles、next-types、next-architecture。tests只读，不能放宽。本轮新增测试可能在你启动后再次刷新，结束前重新跑固定入口报告实际test count。不自行验收。
