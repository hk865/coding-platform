# Runtime 独审末项：释放已结束的临时缓存

在原scope内仅修 execution-observation.ts：主审核到每次已完整结束的 Run 仍留在 cache Map，state 持有本 Turn transcript；每个结束Run累计不释放会使长期平台内存随历史增长。成功 recordRunResult 后移除该 Run 的 cache 和 pendingTerminals；读取正式 Run 已 ended 的早退分支也清理两份本地缓存（包含提交响应丢失/另观察器已落盘情形）。这些缓存不是第二历史库；未完成/写失败的原稳定 observation 仍须保留供当前重试，不能因此再次生成不同eventId。

不新增缓存管理器/公开方法/限制，不改冻结测试，冷读取仍沿持久 locator。运行 next-runtime-driver 与 next-types，报告结果后停止。其余已修行为保持。
