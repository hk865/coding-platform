# AG2b骨架冻结

3个真实Host/SQLite/Kernel场景均在未公布driver HTTP路由404处RED，正式图/Session/忙碌Query前态已经建立。导入严格按lane originalAllowedHashes，outsideScope为空。

本轮已修：Session数含新A，原工具callId定位两轮response及同A Run/Session，正式check检验实际结果，再通过既有Query真正释放忙碌B以验证自动重查；stop读取原Run ended/cancelled，不仅看driver投影；reopen先确认完整成功。测试仍只有3场景。

冻结后Stage2只改生产scope，避免在实现中降低验收。接口补充：Host独立signal；新鲜Work期间才pump，旧entered/unknown纯观察不启动B；stop保留未知事实；业务等待与dispatcher超时保留余量；CollaborationMailboxPort在Core port扩展后使用原类型别名，不维护第二声明。UI须接实际next，浏览器不再自行推进Work。

## 受控 provider 累计预算前态修正

Stage2 首条正常链已完成两轮真实邮箱/Query往返，但第6次 A 请求被正式持久预算拒绝：前5轮无 usage 的受控 provider 已累计保留 input160755 + output2560，原 fixture 200000 不能容纳下一轮。主审只把测试 Work 的累计 tokenBudget 改为1000000，per-request context/Runtime上限、Query预算及生产校验不变；未删断言、未放宽生产权限。精确哈希见 stage1-fixture-amendment.json。只读 fixture 同步到Stage2 lane，manifest保持原样，因此最终audit须明确解释这一条授权前态变更，不能宣称未发生。
