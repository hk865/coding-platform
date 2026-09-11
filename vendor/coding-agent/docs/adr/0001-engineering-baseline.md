# ADR-0001：M0 工程技术基线

```yaml
status: accepted
date: 2026-08-14
scope: M0 工程基线以及后续目录叶子命名
partially_superseded_by: ADR-0003（M5 Provider 范围）
```

## 背景

本项目用于逐阶段学习 Coding
Agent。M0 需要尽量减少工具概念，同时提前固定完整MVP 的物理边界。这里的选择不是“永远最佳”，而是当前学习目标下的默认方案。

## 决策

| 主题            | 决策                                             | 当前落点                                |
| --------------- | ------------------------------------------------ | --------------------------------------- |
| Runtime         | Node.js 24 LTS                                   | `.nvmrc`、`engines`、CI                 |
| 包管理器        | npm + lockfile                                   | `package-lock.json`                     |
| 模块格式        | 原生 ESM + TypeScript `NodeNext`                 | `type: module`、`tsconfig*.json`        |
| 语言约束        | TypeScript strict                                | `tsconfig.json`                         |
| 测试            | Vitest                                           | `vitest.config.ts`、`tests/`            |
| Schema          | Zod 4                                            | M1 起用于不可信边界的运行时校验         |
| 格式与静态检查  | Prettier + ESLint                                | 根配置与 CI                             |
| 第一家 Provider | OpenAI Responses API                             | `src/model/providers/openai/`，M5 实现  |
| 持久化 Adapter  | SQLite                                           | `src/storage/adapters/sqlite/`，M4 实现 |
| 支持平台        | Linux / WSL                                      | 不承诺 Windows 原生运行                 |
| CLI 首版        | 单次输入、流式输出、完成后退出                   | `src/app/cli/`，M5 实现                 |
| Sandbox         | Linux bubblewrap + workspace capability boundary | `src/sandbox/`，M3 实现                 |

## 理由和后果

### Node.js 24 LTS、npm、ESM

- Node 24 当前处于 LTS，适合固定学习基线；不采用仍处于 Current 的 Node 26。
- npm 随 Node 分发，少学习一层包管理工具。
- ESM 是新工程的原生模块方向；`NodeNext`
  让 TypeScript 按 Node 的真实解析规则检查扩展名和包格式，避免“类型检查能过、Node 运行失败”。
- 升级 Node 主版本需要新 ADR 和完整门禁验证。

### TypeScript、Vitest、Zod

- TypeScript strict 用编译器暴露边界不清和空值遗漏。
- Vitest 提供简洁的 TypeScript 测试体验；M0 只建立测试设施，不宣称业务覆盖。
- TypeScript 类型在运行时会被擦除，Provider、Tool 和持久化输入仍需要运行时校验；Zod 同时提供 schema 和类型推断。M0 固定库但不创建业务 schema。

### OpenAI Responses API

- 第一家 Provider 选择 OpenAI，未来使用官方 TypeScript SDK 和 Responses API 映射流式事件及工具调用。
- Core 只拥有 `ModelClientPort`；OpenAI SDK 类型不得进入 Core。
- M0 不安装 OpenAI SDK、不需要 API Key，也不固定模型名称；模型选择属于运行配置和后续评测问题。

### SQLite

- Session 与 Checkpoint 需要多记录原子提交和恢复一致性，SQLite 的事务语义比手写 JSON 文件替换更适合作为学习目标。
- M4 再通过小型 spike 选择 Node 驱动并冻结 schema；M0 只固定 Adapter 类别和目录名。
- SQLite 不是 Memory；Session/Checkpoint 和长期记忆保持不同契约。

### Linux bubblewrap sandbox

- `bubblewrap` 能通过 Linux
  namespace 限制可见文件系统、进程和网络，比字符串路径检查更接近强制执行边界。
- M3 必须先探测 `bwrap` 和 user
  namespace 能力；缺失时 shell/edit 等危险能力拒绝执行，不得静默退化为普通子进程。
- workspace 路径规范化仍保留为纵深防御，但不称作 OS sandbox。
- 当前开发环境尚未安装 `bwrap`；这不是 M0 阻塞项，是 M3 的显式前置条件。

## 未选择的方案

| 方案                      | 本轮不选原因                                   |
| ------------------------- | ---------------------------------------------- |
| pnpm workspace / monorepo | 当前只有一个包，会提前引入 workspace 管理概念  |
| CommonJS                  | 新项目无需背负双模块格式                       |
| Jest + 转译适配层         | 配置层比当前学习目标更重                       |
| JSON/JSONL 持久化         | 简单写入容易掩盖并发、原子提交和恢复一致性问题 |
| Docker 作为首版 sandbox   | 守护进程、镜像和挂载模型会扩大 M3 学习范围     |
| 仅靠 `realpath`/前缀检查  | 只能限制路径，不能限制进程、网络和系统调用     |

## 参考

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference)
- [Vitest getting started](https://vitest.dev/guide/)
- [Zod documentation](https://zod.dev/)
- [OpenAI model/API guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [SQLite atomic commit](https://sqlite.org/atomiccommit.html)
- [bubblewrap](https://github.com/containers/bubblewrap)
