# AG1 验收范围

2026-09-27，独立 main d0dc9d6 加已有未提交角色解析清理为基线；最终逐文件哈希、增删、导入与检查见 [verification.json](verification.json)。本轮未提交/推送。

- 两阶段 DSH：同一 Session，先两条行为用例，中审冻结151行，再实现；主审窄修输入快照、busy异步咨询说明与资源摘要后独立验收。
- [确定性检查](tests.log)：6文件/42项；Node/UI类型与模块边界通过。只新增两条测试，复用真实SQLite/Kernel/Role/Plan/Session/claim fixture。
- [真实 DeepSeek 场景](live-result.json)：模型获得Task定位但未获得收件Session ID；从真实工具返回的busy/idle候选选择idle对象，查看卡片并发出咨询。4次provider，3个工具结果success，收件箱确有pending消息，接收方仍idle；后续消息/卡片读取provider增量0。不是接收Agent答复、自动唤醒或委托执行证据。
- fixture的协调策略仍是既有明确种子；不声称完成生产bootstrap或整个MVP。凭据只在内存供既有DeepSeek SDK使用，未写进证据或仓库。

`live-scenario.ts` 是本次单次验收脚本的凭据路径参数化副本，不加入默认测试集合。要复现：从仓库根将它复制为 `.toolchain/ag1-live.test.ts`，将 `live-config.mjs` 复制为 `.toolchain/ag1-live.config.mjs`，设置 `DEEPSEEK_API_KEY_FILE` 指向自己授权的凭据文件，再用本仓库 Node24 执行：

```sh
node node_modules/vitest/vitest.mjs run --config .toolchain/ag1-live.config.mjs --configLoader native --maxWorkers=1
```

会产生真实模型费用，仅写fixture临时目录和本证据结果，不访问三个候选真实工作区。代码、Skill或目标行为变化前无需重复运行。
