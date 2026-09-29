# AG6 装配验收与真实模型样本

2026-09-28。结论：**配置、指令加载与调用链通过；语义抽查仍有问题。** 本批不代表自动 Agent 编排、正式 Reviewer 流程或完整 MVP 完成。

## 已验证内容

- 两阶段 DSH：Stage1 的三个预期失败及五个既有通过，主审冻结两份测试；Stage2 scope 无越界、原工作区无被动改写，再精确导入九个实现/资源文件。见 `stage1-review.json`、`stage1-scope.json`、`stage2-scope.json`。
- 独立 4 文件/19 项：AG6 Host 装配、W2 实际 Kernel 指令加载、R6 Host、AG1 Session 发现；Node/UI 类型、模块边界/资源摘要与隔离物理构建均通过。见 `tests.log`、`types.log`、`architecture.log`、`build.log`。
- 真实模型第一轮后，只修正文案中的证据约束与资源摘要；最终 2 文件/8 项和边界/摘要通过。见 `prompt-recheck.log`、`assets-recheck.log`。TS 未再改变，未重复扩大测试范围。
- `verification.json` 的 `importedHashes` 是首次独立验证并导入的版本，`currentHashes` 是最终资源版本；冻结测试哈希保持不变。不能用首次构建快照冒充之后文案从未改动。

生产 TypeScript 仅改 `src/app/runtime-configuration.ts`，将显式 platform bundle 转为原 Runtime skills 形状；未修改 Kernel、图 owner 或工具权限。共同 `platform-work` 与秘书/参谋/书记/审查指令可以组合，不因配置创建 Session 或启动模型。一个统一工作台按成员查看各 Agent，不新增三个职责入口。

## 真实模型抽查

`live-round1.json` 保留初轮结果，`live-result.json` 是一次针对性提示词修正后的结果；对应日志为 `live-round1.log` / `live.log`。每轮四个独立临时 Session 按需顺序运行，总共 8 次真实 DeepSeek `deepseek-flash` 调用，`thinking=disabled`。所有调用 completed，provider 错误 0、工具调用 0。四个样本不是平台启动时创建四个 Agent 的策略。

链路为真实 Host 配置 preset → resolve → Runtime `runObservedModel` → Kernel → provider；材料为脚本内虚构的小型项目事实。没有读取或修改候选真实测试工程，没有启动正式 WorkGraph/Reviewer 消费者。机械断言只检查调用结果，不判断文字结论正确。主审逐条阅读结果，具体问题见 [语义复核](semantic-review.md)。回答仍可能添加无来源关系、夸大证据或提出不必要流程，不可直接作为正式采用/验收结论。

## 按需复现

保存的 `ag6-live.test.ts` 和 `ag6-live.config.mjs` 保持实际执行版本；相对 import 以仓库根下 `.toolchain/` 为运行位置。复现会产生模型费用并覆盖当前 `live-result.json` / `live.log`，先另存需要保留的证据，再从仓库根执行：

```bash
mkdir -p .toolchain
cp docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag6/ag6-live.test.ts .toolchain/
cp docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag6/ag6-live.config.mjs .toolchain/
DEEPSEEK_API_KEY_FILE=/absolute/path/to/local-key-file /path/to/node24 node_modules/vitest/vitest.mjs run --config .toolchain/ag6-live.config.mjs
```

密钥仅在进程内读取和交给 provider，证据没有密钥、请求对象或模型内部推理；只保存模型公开答复、调用数量、状态与耗时。样本用临时空工作区及临时数据库，执行结束清理。常规装配复验不需要密钥：

```bash
/path/to/node24 node_modules/vitest/vitest.mjs run tests/app/AG6-agent-assembly.test.ts tests/runtime/W2-role-skills.test.ts --maxWorkers=1
/path/to/node24 scripts/check-boundaries.mjs
```

咨询接收/回复、Agent 驱动派发、正式 Reviewer 结果与完成消费、自动规模调度和原生压缩不在本次交付证明内。完整义务仍见原行为计划及 MVP 审计，不自动转出当前范围。
