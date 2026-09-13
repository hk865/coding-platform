# 1B 真实模型验证（未冻结阶段）

2026-09-13，用户授权读取本地密钥文件，并确认提供方 DeepSeek、模型 deepseek-flash。官方当日入口确认 Base URL 为 https://api.deepseek.com，模型名为 deepseek-flash：[官方 API 入口](https://api-docs.deepseek.com/)。仅通过产品 createModelSettings 保存配置，密钥不写入本证据目录；配置属于 WSL 下默认 `.local/gui` 数据目录。

## 已观察结果

- `model-connection-01.json`：产品文字响应、工具调用结构与 usage 校验通过，工具实际执行次数为 0。
- `real-model-responses-01.json`：实际 HTTP Query → Context → ReadOnlyQueryRuntime → DeepSeek，六次 completed。修改偏好后关闭并重开 Host，随后三次输入采用 profile revision 2；此前三次为 revision 1。原始输入、输出、维护回执和采用记录保留在 JSON。

| 用途 | 修改前字数 | 修改后字数 | 观察 |
| --- | ---: | ---: | --- |
| 接话 | 403 | 302 | 保持三个主要段落 |
| 架构解释 | 407 | 1481 | 采用详细说明偏好，增加证据表、边界与未知项 |
| 进度汇报 | 395 | 283 | 保持进展、阻塞、下一步三部分 |

字数为 JavaScript 字符串 length，作为本次表达差异的描述，不是模型质量评分或验收阈值。测试前一般偏好要求中文、简洁、通常三句话；测试后仅架构允许详细，进度继续简洁。三个用途采用条目和历史版本可从原始输入核对。

## 适用范围

运行使用 Linux 临时隔离工作区及真实 Goal 元数据，未读取或修改用户提供的前端、SLAM 项目。空工作区限制了架构和进度内容深度；结果证明本次产品接线、重启刷新及真实表达差异，不证明对实际项目架构的理解正确或稳定遵守偏好的概率。

原始模型回答中关于权限、下一步、计划必要性的陈述是模型输出，未被采纳为产品事实或新的授权。没有执行图像输入测试；服务商图像能力不等于产品图像链路已验证。该证据不替代确定性故障测试、源码冻结、全量回归或独立 Gate B 结论。

## 用户授权的 Herdr 实际项目补充

用户随后提供更多真实项目目录。核对后采用实际根 `D:/1.project/Software/herdr-master/herdr-master`，经相同产品只读 Query Runtime 完成另一组六次真实 DeepSeek 回应，见 `real-herdr-responses-01.json`。问题将读取限制在根 README.md、AGENTS.md、Cargo.toml、src/main.rs；未运行项目命令或修改源码。模型配置复用安全设置，测试记忆与状态放 Linux 临时目录。

同样在修改偏好后重启：接话 586→498、架构 1217→3688、进度 691→404 字符；六次 completed，输入版本为修改前三次 v1、后三次 v2。与空工作区相比，本次有真实项目材料；这仍是单次表达/接线样例，不是架构正确性全面验收或稳定概率评估。字数减少/增加不是自动 PASS 规则，完整输出供独立判断。
