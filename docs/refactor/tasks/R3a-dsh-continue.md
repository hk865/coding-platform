# R3a 原 Session 返修：raw batch 输入隔离

沿用原任务全部约束。主 Agent 已独立重跑第一轮 23 项全部通过，并审查你报告的两个夹具冲突与 raw batch 缺口。

Sol 已修正两个 tests/core 夹具：非法 Goal@0 必须 corrupt，另用 schema 合法 Project@0 证明真实0仍可匹配，缺失仍不同于0。没有放宽 guard。Sol 新增独立用例复现 raw batch 在首次 await 后被调用者篡改 objective 和 goalId。测试只读。

写范围现为清单 R3a-dsh-write-scope.json 的4个文件：原3个加 src/core/work-graph/persistence/legacy-adapter.ts。只修其 ownBatch fallback，按原语义复制成功才继续；无法拥有的输入在副作用前 invalid_commit，不能JSON stringify静默丢字段。保持正常 raw batch / 旧库重放。不要新增层、生产文件或改变协议。

修正 task-service.ts 注释：structuredClone 支持循环引用；不要声称它因环失败。函数等不可克隆值才是这次拒绝原因，不顺便扩展新的JSON校验规则。

运行 check.py r3a（现在24项）、r3a-regression、platform-types、platform-architecture。历史Host测试的 EVIDENCE_OUTPUT_DIR 已指向私有输出，不得改测试/路径兜底。所有测试/配置/机械helper仍只读。原 Session继续，无需再派子agent。报告写 /tmp/dsh-output/implementation.md，明确自检非独立验收。
