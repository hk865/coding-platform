# 源码施工规范（写代码和测试的 agent 必读）

本文件管“怎么写代码”。项目状态、分工和流程看根目录 [AGENTS.md](../AGENTS.md)；要做什么看任务书和规格。lead 维护本文件，
规则变了当场改。

## 1. 开工前读

1. 任务书，以及它点名的规格条目。任务书的裁定优先于规格原文。
2. `src/README.md` 的总图（要做什么、去哪个文件夹），再读你要改的每个文件夹的 `README.md`：这一层负责什么、有哪些
   文件、**哪些能力可以直接复用**、这一层不许做什么。
3. 模块边界：`docs/refactor/ARCHITECTURE.md` 和 `docs/refactor/module-target.json`（允许的依赖方向，
   `npm run check:architecture` 强制检查）。
4. 测试规则表 [`tests/RULES.md`](../tests/RULES.md)（§5 是摘要），和测试夹具清单 [`tests/README.md`](../tests/README.md)。

## 2. 复用优先

- 写任何辅助函数之前（字段校验、引用校验、版本守卫、回执重放、分页读取、错误映射、事件构造……），先查所在文件夹和
  相关文件夹的 README，再 `grep -rn` 一遍。找到了就调用；在报告里写明你查了什么、用了哪个。
- 同一条规则只在一处实现。两个调用方需要同一个判断，就共用一个函数；本轮替换掉的旧类型、常量、分支，本轮删掉。
- 现成的函数不完全合用：先看能不能加参数或拆出一个共用的纯函数；要改别的模块的文件，报给 lead，不另写一份。
- 收尾检查会机械标出“和别处同名的新函数”。每一条要么改成调用现成的，要么在回复里说明为什么另写。

## 3. 分层和写入

- 状态迁移只经过 `src/core/work-graph/state/` 的构造器（`npm run check:architecture` 和状态写入测试强制）。
- 模块和子模块之间只按 `docs/refactor/module-target.json` 的方向依赖。常踩的两条：WorkGraph 不 import Workflow、Runtime、
  `app`、`composition`，需要它们的能力就在 `src/core/work-graph/model/` 声明端口、由组合根注入；WorkGraph 内部 `queries` 不能 import `tasks`，
  两边都要用的纯函数放到 `model` 或 `persistence`。
- 对外发布的平台端口（`src/composition/create-platform.ts` 里 `platform` 对象上的方法）都经 `trackedCall`，
  关闭时要等它们做完；内部原始 owner 不外露。
- 带命令身份的写入有回执：重放返回原回执，不做与当前时间有关的检查；提交抛错后先按身份查回执，再决定结果。
- `vendor/coding-agent/dist` 是冻结的运行依赖，不手改；Kernel 补丁只经 `scripts/build-kernel-patch.mjs`。

## 4. 写法

- **不静默兜底。** 读失败、缺依赖、认不出的值，返回 `unavailable` / `invalid` 或把依赖设成必填，不当成正常的空结果、
  “没事可做”或“已提交”。
- **注释写规则和原因。** 可以引用仓库里的规格（如 `slice-6-SPEC.md` L4）。不写施工历史：不写“6A-1 加的”“group H”
  “任务书 §3.4”“返工 1”；任务书不在仓库里，这些引用以后没人看得懂。
- 拒绝和失败的结果用 `src/contracts/core/rejections.ts`、`results.ts` 里现成的形状。
- 不加没人用的声明。确实留给下一片用的，在 `tests/architecture/production-reach-allowlist.json` 写明消费者。

## 5. 测试（摘要；完整规则见 `tests/RULES.md`）

1. 经公开步骤到达前置状态：路由、公开 owner、Workflow 端口、Host 启动和重开。不手写事实、不读库核对、不扮演
   Runtime 或 Host 去调内部写入。先在 `tests/README.md` 找现成夹具，再考虑新写。
2. 期望值是字面量或手算的，不取自 `src` 的常量、生产函数或程序输出。
3. 服务层的行在内存和 SQLite 两种后端上都跑；需要重开的行在名字里写“SQLite only”。
4. 拒绝输入放进 `describe('rejects: …')`，一行只有一个错误，并用公开读取证明状态没变。
5. 每一行都要能抓住一个具体的生产改动：改坏生产代码，看它变红，撤回，看它变绿。
6. 不削弱：不删、不放松已有断言，不加 `skip`/`todo`/`only`，不抬超时。
7. 测试里不调用真实模型。

## 6. 收尾

1. 更新你改过的每个文件夹的 `README.md`：新文件、新的可复用能力、改了的边界。README 和代码不一致算缺陷。
2. 跑任务书列出的检查：类型检查、`npm run check:architecture`、`node scripts/build-kernel-patch.mjs --check`、相关
   测试，以及 lead 提供的检查脚本（施工记录注释、同名函数、未经 `trackedCall` 的对外端口、README 核对）。
3. 只提交本次任务相关的文件；不 amend、不 reset。
