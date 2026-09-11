# RAT-00 环境准备证据

本目录记录 2026-09-07 的实际本机检查，未调用真实模型、未读取 API 密钥文件、未安装系统工具或下载镜像。环境总体仍为 `BLOCKED`；生产 bubblewrap 隔离本身为 `READY`。

## 已完成

- 将既有 Node 24.18.0、npm 11.16.0、pnpm 11.21.0 缓存与 bubblewrap 0.9.0 复制到平台 `.local/toolchains/`。Node/bwrap 整树 SHA256 与来源一致；原项目未修改。
- 平台激活脚本 `.local/toolchains/activate.sh` 仅影响当前 shell，使用平台本地 COREPACK_HOME 并禁用网络下载。不改系统 PATH 或用户 profile。
- 使用内核已有 `ProcessSandbox.probe()` 与 `execute()` 实测生产 `bwrap-m3-v4`：测试工作区可写；源码、文档、宿主标记不可见；`.oracle`、`.evaluator`、`hidden-tests`、合成 `.env` 隐藏；系统目录与 `.git` 不能写；网络只有 lo，不能连接宿主临时本地监听。
- 隔离内 Python 3.12.3 可用，默认 `node` 命令不可用。
- 独立可行性探针只将 Node 单二进制放入测试工作区 `.runtime/bin/node`，使用 `PATH=/workspace/.runtime/bin:$PATH node` 成功。Node 读不到隐藏资料且不能写保护文件；官方 harness snapshot 前后 `changedPaths=[]`。

## 剩余条件

正式 RAT-02/03 仍需接入默认命令 PATH、环境层在基线快照前铺设及运行时保护。可行性探针不使正式 canary 变为 READY；本阶段未修改正式题库、题面、评分器或 `allowedChangedPaths`。

Docker/Podman、公开基准工具和多数 Python 评测依赖未安装，镜像清单未知。SWE-bench/Terminal-Bench 须在相应阶段准备环境。WSL 约 912 GiB 可用磁盘、24 个可见逻辑 CPU、约 15.5 GiB 内存；这只证明观察时的本机资源，不是容器任务实测。模型配置由父任务单独检查，本环境 worker 不读取任何真实凭据。

## 复用

在平台根目录的当前 shell 中激活：

```bash
source .local/toolchains/activate.sh
```

环境检查与探针源文件保存在 `.local/evaluation/rat-00/environment/`：

- `probe.mjs`：最小生产隔离探针，只使用合成隐藏标记。
- `stage-workspace-runtime.py`：为给定的专用工作区铺设固定 Node 单二进制；必须在 before-snapshot 之前执行。该脚本不更新已有评分器快照。
- `probe-runtime-overlay.mjs`：验证固定前缀的 Node 环境可行性，比较官方快照前后哈希。
- `collect-environment.py`：只读检查版本、磁盘、依赖存在性及已完成探针结果，生成机器报告。

`.local` 工具链是当前 WSL 的本地运行环境。bubblewrap 和 Node 依赖宿主系统库；不作为可跨系统使用的独立容器发行物。正式打包及更新方式仍由接入阶段决定。

## 证据读取

`environment-report.json` 是状态入口，`environment-raw.json` 保存版本、路径、整树摘要、磁盘、Python 依赖和系统能力原始观察。`isolation-probe.json` 与 `runtime-overlay-probe.json` 保存每条命令、stdout、stderr、退出码、超时和文件副作用。

首轮 Node 可行性探针误把“`.env` 能空读”作为唯一合格条件，实际操作系统返回 `EACCES`，所以产生一次断言 FAIL。保留 `attempt-1-*` 原始输出；修正为接受空内容或权限拒绝，并另验保护文件不可写后通过。没有放宽实际权限，也未把失败隐藏。

宿主 `.git` 只读；空挂载的隐藏目录及 sandbox `/tmp` 可保存临时写入，但不修改宿主对应资料。“仅工作区可写”在此指宿主持久写入边界。
