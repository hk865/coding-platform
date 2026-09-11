# ADR-0003：M5 多 Provider 基线

```yaml
status: accepted
date: 2026-08-26
scope: M5 Model Provider 注册、选择与首批 Adapter
supersedes:
  - ADR-0001 中“只选择第一家 OpenAI Provider 作为 M5 基线”的范围结论
```

## 背景

ADR-0001 在 M0 选择 OpenAI Responses API 作为第一家 Provider，以便先冻结 Core 的厂商无关
`ModelClientPort`。M5 设计阶段确认目标 Agent 需要兼容不同模型服务商，并明确要求兼容 DeepSeek。

直接给 OpenAI Adapter 更换 `baseURL`
无法可靠表达厂商在 API 风格、流事件、ToolCall、usage、错误和能力上的差异，也会把 endpoint 变成未经审查的信任边界。

## 决策

1. 在 `src/model/providers/registry/` 建立静态 Provider
   Registry 和 factory，Provider 由 CLI/配置显式选择。
2. M5 首批实现两个真实 Adapter：
   - `openai`：官方 OpenAI endpoint，Responses API；
   - `deepseek`：官方 DeepSeek endpoint，OpenAI 兼容 Chat Completions API。
3. 两个 Adapter 都只实现 Core 已有
   `ModelClientPort`；Core 和 Runtime 不引入 Provider 路由或厂商 SDK 类型。
4. 各 Provider 有独立 strict 配置 schema、秘密来源、协议 fixture、错误分类和人工 smoke。
5. MVP 生产 Tool list 仍为 `read`、`edit`、`shell`。Provider 只转换本地冻结的 function tool
   schema，不启用厂商 hosted tools。
6. M5 不做自动路由、fallback、负载均衡、模型评分、动态 Provider 插件或任意 OpenAI-compatible URL。

## 原因

- 验证 `ModelClientPort` 确实隔离了不同 API 风格，而不是只对单一厂商有效；
- 支持用户按环境、成本和模型能力显式选择服务商；
- 保持 Session 恢复、重试、预算、Tool 安全链和终态语义可复现；
- 把凭据、endpoint 和协议差异限制在独立 Adapter 内。

## 后果

- M5-01 的实现与测试工作从一个 Adapter 增加为 Registry、OpenAI 和 DeepSeek；
- `modelConfigId`/恢复兼容性必须包含 provider ID、model ID 和 provider-specific 稳定参数；
- 两个 Provider 都必须通过共享 ModelClientPort contract 和各自协议 fixture；
- 新增第三家 Provider 不修改 Runtime，但必须新增 Adapter、descriptor、配置 schema、fixture、文档和 smoke；
- 自动路由继续属于 MVP 后能力，未来引入时需要新的 ADR。

## 未选择方案

- **一个通用 OpenAI-compatible
  Adapter + 任意 baseURL**：无法准确声明 Responses/Chat、ToolCall 和错误语义差异，也扩大秘密与网络信任边界。
- **在 Core 中按 provider 分支**：破坏 Ports 的依赖方向，并让 Runtime 与厂商协议耦合。
- **M5 同时实现自动 fallback**：会使一次 Run 的重试、恢复、成本与输出难以复现，超出本阶段目标。
