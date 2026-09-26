# R4.1 实现独立审阅返修：同身份并发回执

2026-09-26，接续当前 implementation lane/session。仅修改 `src/core/work-graph/tasks/control-service.ts`；另外两个已实现生产文件、所有接口、组合根及测试保持只读。不要重做已通过行为或扩大控制产品范围。

## 已证实的公开可达缺口

最初两个相同 requestId/payload/Run expected 的 lookup 都 miss，B 在真实 authority.load 之前暂停，A 完成真实 commit，B 再读 Run 得到新 revision，当前直接 revision_conflict。此时B是在重试已经提交的同一请求，必须恢复A的原事件/receipt而不是声称该请求冲突。

主审已在原目标测试加入单条真实反例：`replays a same-identity winner committed after both lookup misses but before the delayed authority read`。它包装真实 authority/Store，不改记录；原不同requestId竞争仍必须revision_conflict。冻结workgraph test最新hash为 `5222c47726fd2ceffb82feb0bae83b8f4a8ec733cb8008b7618a87cc53d37916`，已由主审只读刷新到本lane；composition test保持 `6c3bb6a049f965541dd5ac6e71a95918c8d2472c06fd1e00bbda2a1c2d95463b`。独立初始49项通过不能覆盖这个窗口，新增反例在当前实现应红。

## 最小修复

首次miss之后的当前Run状态拒绝，至少确切revision冲突处，重新以原identity+fingerprint查询回执；只在实际found时沿唯一现有replayControl恢复原event。真正miss保留原来的明确拒绝/current；其它lookup错误保持其真实判别，不能伪造missing或committed。不同请求真实CAS冲突保持冲突，不循环重试执行、不重新提交、不添加全局锁/新幂等库。可用一个本地窄helper共用该恢复，不复制replay解码。

原throw后unknown处理、Host scope、原始signal、新控制意图+Run原子事务、历史事实和三个freshgate均保持。未变codec/entry不能顺带重写。不存在Role hot-rebind测试或补丁。

## 检查与停止

运行 `next-control-intent next-execution-state next-b2-composition`，types/architecture单跑；不全量。现有20个控制目标含新增窗口与30邻接均应通过。测试不足先报告真实反例由主审处理，不写测试。完成交service hash、检查和有限修复说明即STOP，待主审独立复验。

## 第二次独立审阅：保留原恢复异常边界

同identity revision竞争已修复、50项独立检查和types通过，但抽取readIdentityReceipt时把原recoverControl覆盖eventAt的catch丢掉了。真实commit成功后ACK抛错、lookup found、随后eventAt读取抛错，会使submitControl的Promise直接reject，而不是返回结果未知。

本次**仍仅service.ts**最小修正：readIdentityReceipt的异常边界包含await replayControl（含真实eventAt），返回约定unavailable未知；不能重提commit/循环。其余两个生产hash继续保持。本问题通过已有lost-ack测试窗口B把故障点从lookup换到found后的eventAt复现，没有新增case或矩阵；最新测试hash `857070132fda5e20da1f3a2ff80103880fc3aeaed6a6509261d7fd4c7c185f56` 已主审只读刷新。保持lookup正常失败原判别、真正miss/current冲突、原fresh成功和同identity恢复。

只需复验next-control-intent及next-types；未动entry/codecs无需再跑所有邻接。完成即STOP交service最终hash，主审确认后导入。
