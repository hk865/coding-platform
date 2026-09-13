# 实施准备基线与跨工具复现

准备快照采集：2026-09-12T15:00:46.376Z（UTC）。这是只读基线记录，不是功能测试结果；当前阶段仅制作开工材料。后续整批路线补全未改变这一原始基线，最新文档摘要见 upstream-documents.json；整批 1A/1B/1C/M/I 路线以 PLAN §7 为准。

## 1. 两仓与保留的工作

| 仓库 | 当前工作根 | HEAD / 分支 |
| --- | --- | --- |
| 产品 | `D:/1.project/Software/agent_platform` | `0eb02717d16412298c786166a75ca1a9d3e05ac7` / main |
| 文档 | `D:/1.project/Software/agent_learn/agent_dev/agent_platform` | `e99484fb2bd3296a32d8442e74b47d8ed569b3d5` / main |

WSL 是同一物理目录，分别为 `/mnt/d/1.project/Software/agent_platform` 和 `/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform`。AGENTS 中历史的 `software` 大小写应映射到本机同一目录；迁移到大小写敏感文件系统时按真实路径解析，不另建一份规范根。

[准备前基线 JSON](baseline/preparation-baseline.json) 保存两仓 HEAD、完整当时 status、已跟踪差异文件与 SHA-256、相关未跟踪文件、冲突检查和补丁摘要。

- 产品原有 **26 个已跟踪改动、5 个未跟踪文件**；包括 RoleSpec 多版本、协作选材、WorkMemory、Runtime 工具和 UI 模板增量。它们不是 CM-1A-001 的新成果。
- 其中四个未跟踪文件位于 `evidence/2026-09-12-agent-templates-memory/`，另一个是 `src/ui/tests/agent-templates.spec.ts`。历史证据只索引摘要，不复制成新 PASS。
- 文档原有 **5 个已跟踪改动、10 个未跟踪文件**；其中七个是本目录原有材料。准备基线记录其写前状态，实施消费的最新文档版本另见 [上游摘要](baseline/upstream-documents.json)。
- 两仓核对时均没有 unresolved merge entries。本轮产品源码与历史来源保持不变；准备文档的修改清单见 HANDOFF。

产品准备源码指纹：`sha256:1055474c3cabe50d6c5a2630eba4dc2983c306b6f67ca713ef16c62a03afb7a6`，涵盖 **1200** 个源码/测试/配置等输入文件。它须与 HEAD、工作树差异、上游文档版本共同使用；单独 HEAD 或单独文件列表都不足以识别验收对象。

## 2. 可交接的差异与版本

| 文件 | 用途 |
| --- | --- |
| [产品已有差异](baseline/product-working-tree.patch) | 产品 HEAD → 准备前工作树的全部已跟踪差异，含必要上下文与 Git 完整对象标识 |
| [产品新增源码](baseline/product-untracked-source.patch) | 已有未跟踪 UI 测试的可复现内容；不把其计作本票新增 |
| [文档已有差异](baseline/docs-working-tree.patch) | 文档 HEAD → 准备前的五个已跟踪规范/状态差异 |
| [未跟踪来源材料](baseline/docs-untracked-sources.patch) | 原始对话、讨论整理及范围澄清记录的内容副本，原路径原文保留 |
| [最终上游文档摘要](baseline/upstream-documents.json) | 本实施包、两根 AGENTS、直接规范/Module、工具配置等实际 SHA-256 |
| [准备前元数据](baseline/preparation-baseline.json) | 写前状态及逐文件摘要；不是实施后的证据 |

补丁是准备文档中的基线附件，未应用到产品代码，不是本轮实现差异。patch 摘要对应 UTF-8 原始补丁字节；校验用实际文件 SHA-256。它们不包含凭据、运行数据库、node_modules、dist 或全量历史证据。

### 在同一工作目录接手

先核对当前 status、基线文件摘要和源码指纹。不要重复应用已经存在的补丁。源码有新变化时记录采用的新输入快照与影响，只复核受影响链路；原有用户改动继续保留。

### 在隔离目录或另一机器重建

需要两个仓库对应 HEAD 的 Git 对象或等价源码副本，以及本 collaboration-memory 目录的完整实施包。只传 Prompt 或只 checkout HEAD 会漏掉未提交基础。

1. 在明确的独立目标目录准备对应 HEAD，不在用户原工作树 reset/clean/覆盖。
2. 在产品副本对上述产品两个补丁先 `git apply --check`，确认目标与基线相符后应用；文档副本同理处理其两个补丁。
3. 将本 collaboration-memory 目录作为最新计划/执行材料一并复制到文档副本的相同相对位置。补丁不重复打包本目录，避免旧 Prompt 覆盖新版本。
4. 如需追溯历史测试，按 preparation-baseline.json 列表另外取得四个产品历史 evidence 文件并核对摘要；它们不是编译源码的必要输入，也不提供当前 PASS。
5. 按当前 package.json/lockfile 恢复本地工具依赖与内核构建，重新记录环境、源码及上游摘要。不要复制已配置凭据或数据库。

Git 补丁按 Git 内容规则记录。换平台的 CRLF/LF、文件模式或配置差异必须说明；不能把内容相近当作原始字节指纹相同。发生差异即建立新输入快照，独立验收针对其实际源码，历史 PASS 不自动继承。

本轮仅以反向 `git apply --reverse --check` 检查补丁与当前工作树相符；没有真的重建副本、安装依赖或编译运行。

## 3. 当前实际工具链

以下是本机只读版本/路径核对，不是跨机器固定依赖；权威命令仍是产品 package.json、scripts/test-wsl.sh 与 vendor 指令。

| 项目 | 本机状态 |
| --- | --- |
| Node 要求 | 根与内核 package.json：`>=24.15.0 <25` |
| Windows 当前会话 | Node 24.19.0、pnpm 11.19.0；npm 不在 PATH。这两个命令来自当前工具附带运行时，其他 Agent 不应假定自动拥有 |
| WSL Ubuntu-24.04 | Node 24.18.0、pnpm 11.21.0、Git 2.43.0 |
| WSL npm | 11.16.0 已安装，但默认 PATH 未含对应 bin |
| TypeScript / Vitest | 6.0.3 / 4.1.10 |
| bubblewrap | 产品 `.local/toolchains/bwrap/usr/bin/bwrap`，0.9.0；本轮未做 sandbox probe |
| Linux runner / 内核 dist | 存在；未证明与将来交付源码同步，实施时必须按需重建 |

当前 node_modules 的 TypeScript/Vitest 是 Linux 符号链接。推荐本机实施/验收使用 WSL，避免混用 Windows Node 与 Linux 依赖。其他开发工具只需能使用同一文件系统与 shell；不依赖 Codex 工具 API。

本机 WSL 初始化示例（换机器须重新定位，不把此旧工具目录当产品源码根）：

```bash
cd /mnt/d/1.project/Software/agent_platform
export PATH="/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin:$PATH"
node --version
npm --version
pnpm --version
```

这是使用已存在的工具，不安装或修改系统配置。本轮未执行依赖安装、功能测试或构建。

## 4. 未来实施/验收的实际入口

从产品根运行，执行者按 Ticket 选择新增与受影响用例：

```bash
pnpm kernel:build
pnpm typecheck
pnpm check:architecture
bash scripts/test-wsl.sh <本票新增及受影响测试路径>
bash scripts/test-wsl.sh
pnpm build
```

尖括号是待实施者填写的实际路径，不是可原样执行的命令。新增测试路径必须在交付 verification.md 中展开，接手者不应再猜。平台 Runtime 与若干测试直接引用 vendor/coding-agent/dist/public-api.js，故新副本先安装对应锁文件依赖、构建内核，再做平台类型/测试验证；内核公共 API 变化后同样先重建，不能使用旧声明或缺失的 dist。

现有回归起点（不是新功能已有覆盖）：

```text
tests/control/dispatch-claim.test.ts
tests/control/dispatch-start.test.ts
tests/control/dispatch-drive.test.ts
tests/control/workspace-drive.test.ts
tests/control/workspace-lease.test.ts
tests/control/work-identity-uniqueness.test.ts
tests/app/runtime-context.test.ts
tests/app/work-material-delivery.test.ts
tests/runtime/runtime-observation-journal.test.ts
tests/sqlite-ledger/sqlite-ledger.restart.test.ts
tests/integration/p1-16.real-kernel.continuity.test.ts
```

`scripts/test-wsl.sh` 会写隔离 runner 配置并执行 sandbox probe；首次 `--setup` 还会安装依赖。这些是实施/验收阶段操作，本轮没有运行。隔离能力失败时记录真实环境阻断，不能用危险的无隔离执行替代。

`pnpm build` 当前包含内核、平台和 UI 构建；vendor/INTEGRATION.md 中早期“平台 build 只构建平台”的叙述不是当前命令事实。涉及 UI/HTTP 消费者时按影响运行 `pnpm verify:ui-build`、`pnpm ui:typecheck`、`pnpm ui:test` 等现有入口；ui:test 使用 POSIX webServer 语法并会重建与启动夹具。1A 不要求完整前端产品验收，但不能忽略其实际共享变更造成的回归。

文档根命令：

```bash
cd /mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform
node dev_docs/verification/validate-docs.mjs
```

真实模型只在配置与授权均具备时运行。配置存在与否不要求暴露密钥；证据只保留脱敏的模型标识、运行参数、公开请求/响应关联信息。1A 的确定性流程测试可以先完成，真实模型效果单列“未验证”，不能据此宣称整批产品通过。

## 5. 源码快照与验收失效规则

准备源码指纹的算法：

1. 在产品根取 `git ls-files -z` 与 `git ls-files --others --exclude-standard -z` 的并集，按路径排序。
2. 包含 src/、tests/、scripts/、vendor/coding-agent/ 下文件，排除路径中的 node_modules/dist/coverage/.local/.git；另含根目录 json/yaml/yml/mjs/ts 文件与 .gitignore/.gitattributes。
3. 每项用 `path + NUL + 原始文件字节 SHA-256 + LF`；删除文件以 `deleted` 代替哈希。对拼接结果取 SHA-256。未跟踪历史 evidence、临时数据库和构建输出不进入该源码指纹。
4. HEAD、完整 Git 差异及其文件模式变化、输入文件清单、上游文档与工具版本另随快照保存；编译产物另外证明构建来源。

每票记录实际采用基线→交付源码的准确差异和新增文件内容；后续票的基线包含已经集成的前票结果，并记录来源快照。整批另交本准备基线→最终集成版本的差异，不只交 `git diff HEAD`（其中混有用户原改动）。可以在独立基线副本比较，或在实施前保存重叠文件的原始版本；不需要为此提交 Git。证据位置统一见 HANDOFF §3。

1A 不含完整 UI 产品验收仅是单票边界；B/C/M 的消费者与最终 I01–I04 必须运行适用的浏览器、跨入口及旧数据回归和实模型样例。任何依赖平台 dist 的集成样例都应先从当前快照重建平台，不能把上列测试命令顺序当作可使用旧平台产物的许可。

验收者开始与结束各核对一次被验输入快照。源码/规范/配置变化后，旧 PASS 对变化范围失效；生成新 snapshot，说明影响并重验。验收日志、报告等独立输出可以追加，不因它们增加就改变被验源码；新增验收用例的版本需另记。

## 6. 当前真实开工阻断

**没有已知必须由用户先裁决的产品或架构阻断。** 当前缺的是用户选择并明确指派实施 Agent，这是本轮约定的交接停点，不是工具不可用。

D01–D05、实际 sandbox preflight 和当前源码构建尚待未来实施 owner 执行；本轮只确认了必要工具的存在/版本。若后续环境检查失败或基线产生新冲突，再记录具体阻断和受影响验证；不预先把所有未定字段或 1B/1C 都当作 1A 开工门槛。
