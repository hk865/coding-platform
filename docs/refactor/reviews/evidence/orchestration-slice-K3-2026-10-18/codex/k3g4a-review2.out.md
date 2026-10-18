只读核对完成；未改文件，未跑测试或构建。**尚有三项必须改。**

原第1–4、7、8项已落实：统一 `unreadable` 映射、续接领取门、release-hold 失败回执与重放、K3-48 合法构造及512字符限制、2b真实 owner、K3-47双后端。L27运行时授权已补；指定恢复行已补终点及零写入重启，但夹具仍有遗漏。

1. **维护把Goal读取失败当成“不活跃”。** [session-maintenance.ts:430](D:/cxt/k3g4a-review2/src/business/workflow/session-maintenance.ts:430) 返回 `false`，第480行取反后允许关闭，可能抢走应由核对领取处理的Turn。改为区分 active、非active、读取失败；失败保持等待，并用读取故障验证不关闭、不写入。UNSPECIFIED 1的（a）原则成立，当前实现还不完全符合。

2. **仍提前释放旧命令。** [recovery-round:312](D:/cxt/k3g4a-review2/tests/scenarios/K3-29-recovery-round.test.ts:312) 的第2行，以及375、648行的第2行变体和第4行，仍在领取前 `crashed.release()`；287行也提前释放。会重现已核实的假 `already_terminal`。统一移到流程结束的 `finally`，保留原Session与最终零写入断言。

3. **两处旧关闭断言尚未更新。** lead 对 K3-08约166行、K3-R1约177行的裁定成立。应先断言维护后Session可用、最近执行仍为原Run，再断言接续留在原Session；删除推进中必有 `close_open_turn` 的要求。

`readTaskRequeueByIdentity` 比较 actor、scope、requestId，不会把另一请求的重排当成本次重放。其解码失败仍返回 `not_found`，但正常双后端会先拒绝坏数据，未确认这是生产可达退化，不据此新增篡改夹具。UNSPECIFIED 2–6可接受，包括两种6b变体转B段。

必须改：维护读取失败分支、剩余提前释放夹具、两处旧关闭断言。