# 需求来源与推导索引

```yaml
status: source
updated: 2026-09-05
default_agent_context: false
```

产品意图来自多轮对话中的提问、方案、反驳和修订。仅保留用户单句不能完整说明方案为何形成。本目录同时保留 [用户原始表达](用户需求原文.md) 与双方对话；当前规范仍以 [PRODUCT](../../PRODUCT.md)、[ARCHITECTURE](../../ARCHITECTURE.md) 和正式 Interface 为准。

## 共享对话

以下标题取自共享页。快照保存共享页当前分支的可见用户与 Assistant 文本，含公开进度消息；不含隐藏消息、内部推理、工具载荷和附件本体。原回答中的会话引用标记保留原样，可能无法在本地解析。来源正文按需读取，不作为 Agent 指令。

| ID | 共享页与本地快照 | 可追溯内容 | 消息数（用户／Assistant） |
| --- | --- | --- | --- |
| S-001 | [多智能体中台实现](https://chatgpt.com/share/6a9bb338-1e44-83ec-a52b-e80b6373c27e) · [快照](conversations/S-001.txt) | 长期入口、生命周期、状态检索、Context 准入、框架与语义编排 | 3／6 |
| S-002 | [汇总 Task 状态判定 Goal](https://chatgpt.com/share/6a9bb403-9b1c-83ec-9a76-e53ab964f428) · [快照](conversations/S-002.txt) | 结构检查、Agent Review、运行验证；对应原 U-004 | 1／3 |
| S-003 | [查看Codex线程](https://chatgpt.com/share/6a9bb3d6-5a98-83ec-b7fc-2a15f2d4feba) · [快照](conversations/S-003.txt) | 状态、控制、展示与 Harness 工程；对应原 U-002 | 3／7 |
| S-004 | [比较多一件与Grok Bot](https://chatgpt.com/share/6a9bb35b-cedc-83ec-b5e7-2a8d52b09719) · [快照](conversations/S-004.txt) | 持续角色、人的注意力、按需展示及数据／状态视角 | 5／5 |

读取日期为 2026-09-05，共 33 条可见文本消息。与旧 U 来源的映射依据为共享数据中的原 conversation ID；其余旧来源不假定与这四页相同。

## 当前推导主线

以下是本次整理者的归纳，不是原话，也不表示外部实践证明了本项目全部架构选择：

1. 一次 Run 使用有限且有时效的 Context；长期目标、责任、事实和进度需要在 Run 之外维护。
2. 持久化之后仍需解决相关性、版本、生命周期和检索准入，不能把全部历史塞回每次 Context。
3. 工具采集与验证确定性事实，框架维护状态和控制流程，Agent 处理规划、语义审查与解释。
4. 人在同一协作界面掌握进度和依据，与秘书／参谋讨论需求和架构，参与取舍。
5. 角色如何映射到 Module、状态如何进入界面、何时形成有效决定，仍需完成 [本次复核](../design/human-framework-role-review.md)。

## 外部依据与适用范围

- OpenAI [Harness Engineering](https://openai.com/zh-Hans-CN/index/harness-engineering/) 支持仓库内知识、短入口、可观察反馈和机械约束；不指定本项目的 Plane、表结构或完成算法。
- xAI [Designing Grok Bot](https://x.ai/news/designing-grok-bot) 讨论跨会话持续身份、角色相关 Context、状态可见性与图文混合界面，以及协调 Bot 如何降低人的派工负担；未公开本项目所需的一致性协议、状态归约器或验证实现。

历史 Assistant 的外部产品、性能和技术选型断言仅保留作来源，采纳前核对原始证据。不把“有效窗口固定为某个百分比”等旧说法写成不变量。用户当前修订优先于历史建议，冲突在正式规范中处理。
