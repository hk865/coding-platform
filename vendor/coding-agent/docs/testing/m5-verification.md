# M5 验证记录

更新时间：2026-08-27。

## 自动门禁

- 格式检查：通过；
- ESLint：通过；
- TypeScript strict typecheck：通过；
- 默认完整门禁：30 个文件，98 项通过、3 项按 capability 明确 skipped，共 101 项；
- 显式真实 bubblewrap 门禁：2 个 E2E 文件、6 项全部通过；
- build：通过；
- architecture check：通过（Core 未反向依赖 App/Provider）。

M5 新增覆盖：OpenAI/DeepSeek fixture
contract、ToolCall 参数增量、usage-only 最后 chunk、Provider 显式选择、配置优先级、CLI 参数、Skill 固定加载、Empty
Memory、外部 Tool 注册、Runtime + 固定 ToolList + SQLite required
sink 的完整离线 Composition 回放、terminal Session resume 不重复调用模型，以及 secret 不持久化。

真实 CLI
child-process 还覆盖非交互审批拒绝、模型等待期间 SIGINT 退出 130，以及 PTY 下两次交互审批后的
`read → edit → shell → final`。调用方取消优先级竞态已修复，持久化终态为唯一 `run.cancelled`。

## DeepSeek 真实低预算 smoke

密钥从工作区外指定 txt 临时注入，未输出或写入配置/Session。

- endpoint：DeepSeek 官方 API；
- model：`deepseek-v4-flash`；
- 第二次请求使用 `thinking=disabled`、`max_tokens=64`；
- 结果：`text_delta × 3 → usage_snapshot → completed(final_answer)`；
- usage：input 16、output 3；输出正文未记录在验证文档。

M6 候选提交 `f2f8f4048322a0c9f92beb21164e6dd35a7c3b08` 又使用正式 acceptance harness 完成 text +
`record_smoke_result`
ToolCall：两个场景均 passed，ToolCall 只验证流与固定参数并未执行；summary 不保存正文、reasoning 或原始参数。

OpenAI 本轮没有用户提供的凭据，因此只执行确定性官方 SDK/Responses fixture
contract，未做真实计费请求。

## 环境边界

WSL 系统路径没有预装 bubblewrap，但已使用项目本地 bubblewrap 0.9 和可用的 unprivileged
namespace 通过强制 M3/M5 E2E。DeepSeek 的真实无副作用 function
ToolCall 已完成；OpenAI 真实 text/ToolCall 仍待凭据。离线共享 contract 与完整 CLI 工具链已通过。
