# Development

开发资料按用途组织：

- [Getting Started](getting-started.md)：环境、安装、配置、构建和运行命令。
- [Release Checklist](release-checklist.md)：候选版本的可重复交付门禁。
- [Codex Review Improvement Plan](improvement-plan-from-codex-review.md)：已识别问题与修复背景。
- [Independent Quality Review](m6-independent-quality-review-2026-08-28.md) 与
  [Round 3](m6-independent-quality-re-review-round-3-2026-08-28.md)：独立评审证据。
- [Post-release Roadmap](post-m6-large-repo-roadmap.md)：大型仓库能力方向。
- [Context Compaction and Multi-agent Plan](m7-context-compaction-multi-agent-plan.md)：已拆分的历史 M7；平台规划已迁入
  [Agent Platform P0](/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/P0-产品定义与总体架构.md)。

入口命令以 `package.json` 为准；架构事实放在 `docs/architecture`
和模块 README，计划文档不能被当作当前能力说明。业务场景 runner 见
[`tests/scenarios/README.md`](../../tests/scenarios/README.md)。
