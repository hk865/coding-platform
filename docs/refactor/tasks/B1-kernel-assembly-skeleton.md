# B1：复用现有模型循环的角色配置和实际进入接缝

**状态：已完成并通过独立物理隔离验收。** 见 [B1/W1 报告](../reviews/next-b1-w1-2026-09-25.md)。以下保留当时骨架阶段要求；已完成中间审核、实现及返修，不应重新按骨架阶段派发。

阶段一只交骨架/测试，主审中审后才实现。W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。整体B仍包括正式prepare/entry、原历史观察归约及释放；本切片落实它所消费的Kernel适配接缝，不得宣称platform.startRun或整个B已完成。知识库/Memory不在本批。

阅读：docs/AGENTS.md、PRODUCT.md §5–6；docs/refactor/{ARCHITECTURE,IMPLEMENTED-CAPABILITIES,DSH-WORKFLOW}.md；modules/core/agent-runtime.md §7.1；T/src/core/agent-runtime/{observed-model-run,exploration-tools,project-source-tool,source-tool-ports}.ts；对应 tests/runtime/{R4c-session-continuity,source-tool-lifecycle}.test.ts 与 tests/app/project-source-tool.test.ts；冻结 Kernel 公开 RunAppInput/HookPort/skills 和真实 composition-root/runtime-runner。只读已有提供者，不能新建 SkillManager、模型循环或授权系统。

## 冻结方向与接口

在既有 ObservedModelRunOptions 加可选的 `controlHooks?: readonly HookPort[]`、`skills?: {resourceRoot:string;enabledIds:string[]}`；类型来自Kernel公开API或其准确形状，不复制hook协议。未传skills保留原coding-safety行为；显式传入只使用这份可信Host配置，包括显式空enabledIds。不把调用方任意模型JSON接到该字段；这里只是内部Host接缝，RoleSpec版本解析与正式装配在B后续消费者。

现有projectSource frozen分支增加 `openOn?: 'before_run' | 'first_use'`；缺省before_run保持既有消费者语义。first_use先注册project_source而不调用factory、不回落project_index；实际第一次该工具执行才打开，同一个Run至多一个共享open Promise。并发调用复用，open失败不自动重试/改live；无read权限、未使用或before_model暂停不打开。关闭时先排空tool group，再关闭实际创建的source一次；挂起open也须等待并关闭，不能泄漏或close后再open。

为复用原project_source协议，仅扩展 ProjectSourceToolOptions.access 和 SourceToolOptions.projectSource.access 为 `RuntimeSourceCaptureAccess | (() => Promise<RuntimeSourceCaptureAccess>)`。工具参数/路径验证通过后、dispatch前才解析access；不构造伪造Context/root占位对象。open/close所有权仍在runObservedModel，工具不自行关闭共享source。原对象形式保持兼容。

在runCodingAgent原调用中透传controlHooks与skills。hooks数组和skills可变字段在首次await前快照，Hook execute函数保留，不JSON复制。不要采用onConfiguration作异步屏障，不修改冻结Kernel，不吞hook错误，不自行写WG状态。

## 骨架阶段

现有三个生产文件只增加类型/职责注释及必要明确unsupported分支保证编译；原既有路径保持。不得完成新行为。新增一个 tests/runtime/B1-kernel-assembly.test.ts，用真实冻结Kernel/SQLite与本地scripted model，集中4–6个独有场景，避免复制已有生命周期和history全矩阵：

1. 真实自建skill进入模型systemPrompt，显式空skills不偷偷回退coding-safety；可信配置快照不受await后外部变异影响。复用同fixture合并相关断言。
2. before_model确实等到测试barrier完成才调用model；hook中读固定Kernel Session可见turn.started/run.started。暂停时零model、零source factory。
3. first_use第一次真实project_source调用打开，后续/并行复用一次，最终关闭一次；不使用时零打开。保留原工具协议和现有源授权。
4. lazy open失败不回落project_index，不重复factory；暂停/错误清理不泄漏资源。必要竞争只验证本次新增时序，不再测整个SourceIndex/Store。

测试模型不得联网。测试断言来自上述接口，不能用mock Kernel来假装Hook被等待。需要读Kernel原历史用公共SqliteStores/现有reader。新增skill只在测试临时目录里写符合现有loader格式的资源，不安装依赖/改Kernel资源。

检查：`source W/.toolchain/env.sh; cd T; node ../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`；专项 `node ../node_modules/vitest/vitest.mjs run tests/runtime/B1-kernel-assembly.test.ts --maxWorkers=1 --no-cache --configLoader=native`。新测试应因新能力unsupported而红，类型/导入正常；交付后停止，等待中审。报告需求→复用符号→新增接点→实际测试结果。只在scope列出的文件原地写入，禁止rename替换、测试以外的临时写入、提交、安装依赖、额外模型。整个仓与相邻模块可只读查阅。
