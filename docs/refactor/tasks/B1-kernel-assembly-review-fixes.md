# B1 实现审阅返修

继续同一 implementation Session，只有原三个生产文件可写。主审加强了原6用例中的断言并刷新到你的只读快照，记录在本轮 evidence，不增加测试文件/模块。原规范不变。

修复三个确定缺陷：

1. `frozen=o.projectSource` 保留调用方对象；first await 后替换其 open 会改变本次可信工厂。首次 await 前捕获 mode/openOn/open 函数引用，保留原 receiver，后续不重新从可变对象取工厂。
2. `frozen.open` 同步抛错发生在 sourcePending 赋值前，下次工具调用会重试。先缓存 Promise，再调用捕获的工厂，统一同步 throw 与异步 reject 的一次尝试语义。沿用一个共享 pending，不新增重试器。
3. 工具在 await assertCurrent 后可能已被取消；resolver 前再判断 signal.aborted，避免已取消的调用启动第一次 capture。保留 resolver 后的检查与 finally 排空。

这三项分别由 first-use 配置变异、跨轮同步工厂异常、assertCurrent 挂起期间取消反例覆盖。修后跑类型与 B1 单文件，相关30项源工具/连续Session回归即可，不重复整套 tests/runtime。报告结果，停下交主审。
