# 独立仓库 DSH 施工工具

由 `docs/refactor/archive/2026-09-27-workspace-tooling/` 的两份脚本迁移。根目录由脚本位置确定，当前根就是独立工程；不读取父目录源码、依赖或旧 lane 基线。两阶段与最终人工逐文件导入沿根 `AGENTS.md` 和 `docs/refactor/DSH-WORKFLOW.md`，这里不新增产品流程。

## 配置与只读预览

Python 3.9+、Linux bubblewrap 和 Node `>=24.15.0 <25` 是运行前提。Node 从 `CODING_PLATFORM_NODE` 或 `PATH` 选择；不内置旧工作区回退。现有 DSH CLI、配置目录必须显式指定，脚本不安装依赖、不解析或打印凭据、不改变 headless profile / 权限模式。

```sh
export CODING_PLATFORM_NODE=/home/hyh001/projects/coding-platform/.toolchain/node-v24.21.0-linux-x64/bin/node
export CODING_PLATFORM_DSH_CLI=/home/hyh001/projects/deepseek-harness/deepseek-harness-master/apps/cli/lib/bin.js
export DSH_HOME=/home/hyh001/projects/deepseek-harness/.dsh-vanilla
python3 tools/dsh-refactor/harness.py --show
python3 tools/dsh-refactor/check.py next-catalog next-graph-agent --show
python3 tools/dsh-refactor/check.py next-build --show
```

以上是本机已知入口，也可替换为其他现有安装；`DSH_CLI` 是 CLI 的备选环境变量，`CODING_PLATFORM_DSH_HOME` 可覆盖 `DSH_HOME`。`--show` 只检查路径与 Node 版本并显示计划，不创建 lane、临时构建或 DSH 状态，也不运行产品检查。

## 审定 scope 后执行

scope 的 `writableFiles` 必须是独立根相对的、已存在的普通文件，例如 `src/ui/main.ts`；不接受旧 `coding-platform/next/` 前缀、目录写入或符号链接。新文件由主审先建占位再加入 scope。`dshStateDirectories` 仅允许 `profiles`、`sessions`、`storages`、`cache`、`llm-deepseek`、`attachments`。

```sh
python3 tools/dsh-refactor/harness.py prepare batch-name docs/refactor/tasks/batch-scope.json
python3 tools/dsh-refactor/harness.py run batch-name /tmp/batch-prompt.md
# 返修时传实际落盘的原 Session，禁止使用历史任务里的 Session 猜测续接。
python3 tools/dsh-refactor/harness.py run batch-name /tmp/batch-repair.md session-ACTUAL
python3 tools/dsh-refactor/harness.py exec batch-name python3 tools/dsh-refactor/check.py next-r6-host
python3 tools/dsh-refactor/harness.py audit batch-name
```

`prepare` 捕获当前整个工作树，包含未提交/未跟踪文件；排除 `.git`、各层 `node_modules`、`.toolchain`、精确路径 `docs/refactor/reviews/evidence`、缓存、coverage、根 `dist`，保留正式 `src/core/work-graph/evidence` 源码、`vendor/coding-agent/dist`、受管补丁、resources 与 `.local/source-analyzers`。本仓库自己的两个已安装依赖目录只读挂载，不允许回落旧工程依赖。全局文件系统只读，只有每个 scope 文件、lane 私有 DSH 状态和临时输出可写；单文件挂载要求原地写，不能原子 rename 或放开父目录。

DSH 启动时可能重写的 profiles 从原目录复制到 lane；其它指定状态目录为空的 lane 私有目录。原 settings/凭据/会话保持只读。stderr 仅保存在本地诊断文件，不自动展示；结构化事件只记录类型/Session/工具/状态/原因元数据，thinking 正文丢弃，final 报告单独保存。不要提交 `.toolchain` 或诊断状态。

每个 lane 位于 `.toolchain/dsh-refactor-runs/`；manifest 保存工作树快照、精确授权文件原始哈希及独立根身份。`audit` 同时报告越界变更和主工作树基线变化，包含删除与符号链接替换。不会自动导入、提交或覆盖旧工作区；不支持把旧根 lane 搬进来继续。

## 固定检查与限制

保留全部 58 个现有 `next-*` 名称，删除旧产品选择器。多个无过滤 Vitest 入口合并并去重，保持单 worker、无共享缓存和 native config loader；类型、边界、构建单独执行。传错误名称会列出当前名称，不执行检查。

`next-build` 复制独立根到临时物理目录，只链接本仓库已安装的第三方依赖，保留冻结 Kernel 产物；完成或失败都删除该临时目录。需要浏览器验收的保留构建由主审另行明确安排。其它检查对 lane 运行；本脚本不放宽超时或改断言。

2026-09-27：Python 编译、选择器路径和 `--show` 已核；随后已通过本 runner 实际准备并运行独立 `r6-work-control-skeleton-standalone-20260927` lane 的 Stage1，DSH 正常退出，范围审计无越界。骨架中审未发现必须返修项，但候选未导入、未进入 Stage2，因用户将本轮收窄到真实模型非语义错误而保持 STOP；DSH 自报检查不是产品验收。真实模型输出契约修复随后使用独立新 lane 完成相同两阶段流程，两文件已正式导入，相关 4 文件 / 4 项、类型与构建通过；最终真实 DeepSeek 限定路径验收完成后按用户要求停止施工。实际执行仍要求当前主机允许 bubblewrap namespace；不提供降级到宽权限的替代方案。
