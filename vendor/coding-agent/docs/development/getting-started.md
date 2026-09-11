# 开发指南

## 环境与安装

工程要求 Linux/WSL、Node.js 24 LTS 和 npm：

```bash
node --version
npm --version
npm ci
```

只有明确升级依赖时才使用 `npm install` 并更新 lockfile。

## 工程命令

| 命令                                | 作用                                     |
| ----------------------------------- | ---------------------------------------- |
| `npm run format:check`              | 检查格式                                 |
| `npm run lint`                      | 静态缺陷检查                             |
| `npm run typecheck`                 | TypeScript strict 检查                   |
| `npm run test`                      | build 后运行全部确定性测试与本机可用 E2E |
| `npm run test:e2e:bwrap`            | 强制真实 bubblewrap E2E                  |
| `npm run build`                     | 编译 `src` 到 `dist`                     |
| `npm run web`                       | 构建并启动本机 Web UI                    |
| `npm run check:architecture`        | 依赖方向与循环检查                       |
| `npm run benchmark:validate`        | 4 个 canary 预检                         |
| `npm run benchmark:baseline:replay` | 生成固定 replay 结果                     |
| `npm run smoke:providers`           | 真实 Provider 文本与无副作用 ToolCall    |
| `npm run benchmark:baseline:real`   | 真实模型执行 4 个 canary                 |
| `npm run check`                     | 完整本地确定性门禁                       |

## 本机 Web UI

```bash
npm run web
```

然后打开 `http://127.0.0.1:4173`。页面允许直接填写 workspace、Provider、model、Session、API
Key 和任务；Agent 的流式文本、edit/shell 审批、取消及最终状态均在同一页面完成。

Web 服务固定监听 `127.0.0.1`。API
Key 只用于当前任务，不写入 Session、日志或浏览器存储；刷新页面后需要重新填写。如果仓库自带
`.tooling/bwrap/usr/bin/bwrap`，Web 入口会自动使用；否则 shell 工具按既有策略 fail closed。

## 当前能力

M0–M5 主体实现已完成：Agent
Loop、read/edit/shell 安全链、Session/Checkpoint/SQLite 恢复、OpenAI/DeepSeek、CLI
run/resume、Skill/Empty
Memory 和外部 Tool 边界均已装配。M3 真实隔离门禁已通过，DeepSeek 真实 4-canary baseline 已完成 4/4
resolved；M6 只剩 OpenAI 真实 smoke 与候选版本标记。

系统没有 `/usr/bin/bwrap` 时，shell 必须 fail closed；这不是安全降级。测试或显式部署可设置绝对路径
`CODING_AGENT_BWRAP_PATH`，再运行 `npm run test:e2e:bwrap`。当前 WSL 已用项目本地 bubblewrap
0.9 完成 6/6 强制 E2E；该本地 binary 位于被忽略的 tooling，不作为源码分发。

## M6 真实外部门禁

Provider smoke 每次固定执行一次短文本和一次 `record_smoke_result`
ToolCall；该函数只验证模型输出，永远不会执行。先提交全部代码，确保工作区干净，再从环境注入所选 Provider 的密钥：

```bash
npm run smoke:providers -- --provider openai --model <model-id> --run-id <traceable-run-id>
npm run smoke:providers -- --provider deepseek --model <model-id> --run-id <traceable-run-id>
```

结果默认写入被 Git 忽略的
`benchmarks/results/<run-id>/summary.json`。证据只包含 commit、官方 endpoint
origin、模型、非敏感 Provider 选项、预算、事件类型、usage 以及正文/参数哈希；不保存密钥、完整正文、reasoning 或原始 Tool 参数。

真实模型 baseline 同样要求干净 commit 和明确模型，并复用生产的 bubblewrap 路径：

```bash
CODING_AGENT_BWRAP_PATH=/absolute/path/to/bwrap \
  npm run benchmark:baseline:real -- \
  --provider <openai|deepseek> --model <model-id> --run-id <traceable-run-id>
```

Replay 不能替代真实模型成绩。没有凭据或 bubblewrap 时必须失败，不允许降级成假成功。
