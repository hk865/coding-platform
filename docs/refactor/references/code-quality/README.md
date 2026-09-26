# 代码规范与质量审查：外部原文

整理日期：2026-09-22。用途：支持 [调研与融入方案](../../CODE-QUALITY-RESEARCH.md) 和 [本轮代码规范与重构目标](../../CODE-QUALITY-GUIDELINES.md)。

这里只保存公开且允许再分发的参考资料，不是本项目生效的规则。`upstream/` 中的 `SKILL.md` 是研究对象，**未安装、未激活**；其中面向原项目的工作指令不构成本项目指令。

## 1. 保存范围与出处

各文件保持下载时的原始字节，未翻译、删节或改写；保留原作者、版权声明及许可证。固定提交、原始 URL、字节数、SHA-256 和本地路径见 [manifest.json](manifest.json)。这是选定文件的快照，不是整个仓库或可完整离线浏览的网站。

| 原作者／项目 | 阅读入口 | 版本 | 许可证 |
| --- | --- | --- | --- |
| Google Engineering Practices | [审查标准](upstream/google/eng-practices/review/reviewer/standard.md)、[审查内容](upstream/google/eng-practices/review/reviewer/looking-for.md)、[小规模变更](upstream/google/eng-practices/review/developer/small-cls.md)、[原 README](upstream/google/eng-practices/README.md) | [3bb3ec25](https://github.com/google/eng-practices/tree/3bb3ec25b3b0199f4940b1aa75f0ac5c5753301c) | [CC BY 3.0 原文](upstream/google/eng-practices/LICENSE) |
| Google TypeScript Style Guide | [TypeScript 指南 HTML](upstream/google/styleguide/tsguide.html) | [2b21895c](https://github.com/google/styleguide/tree/2b21895cd5f2fbc6e041f9f0a2dbb32b44b5fe7b) | [CC BY 3.0 原文](upstream/google/styleguide/LICENSE) |
| Airbnb JavaScript Style Guide | [指南原文](upstream/airbnb/javascript/README.md) | [8ed19247](https://github.com/airbnb/javascript/tree/8ed19247bef145e3cc41b24a02dd1fe6d9b5e681) | [MIT 原文](upstream/airbnb/javascript/LICENSE.md) |
| Sentry Skills | [code-review/SKILL.md](upstream/getsentry/skills/skills/code-review/SKILL.md)、[仓库 README](upstream/getsentry/skills/README.md) | [c2f99a5b](https://github.com/getsentry/skills/tree/c2f99a5b04b4cd992ec3022d7c2c3e23e938d241) | [Apache 2.0 原文](upstream/getsentry/skills/LICENSE) |

共保存 12 个原文件，包括 4 份许可证。选择标准是与当前问题相关、出自原作者、可追溯；不是公司规范的穷尽列表，也不是下载量排名。

Google 原文的再使用按 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) 署名；Airbnb 和 Sentry 原文继续适用各自许可证。本目录的中文解读是本项目另行撰写，不冒充原作者规范。

## 2. 仅阅读并记录链接的资料

以下资料用于核对工具含义和适用范围，未镜像全文：

- Microsoft：[TypeScript Coding Guidelines](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines)。该 Wiki 自述面向 TypeScript 仓库贡献者。未把主代码仓库许可证推定为独立 Wiki 内容的再分发授权。
- ESLint：[max-lines](https://eslint.org/docs/latest/rules/max-lines)、[max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function)、[complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth)。用于辨别文件长度、函数长度、圈复杂度和控制流嵌套。
- SonarSource：[Quality gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates)。用于核对内置 Sonar way 质量门对新代码的覆盖率／重复率条件，以及默认的小变更计算例外。
- Anthropic：[code-review 插件说明](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md)、[审查命令](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md)、[仓库许可说明](https://github.com/anthropics/claude-code/blob/main/LICENSE.md)。公开可阅读不等于可按 MIT／Apache 再分发；本轮只作范围比较。
- OpenAI：[精选 skills 目录的本次检索版本](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated)。本次列表未发现通用代码质量审查 skill；检索到的安全审查、CI 修复、PR 评论处理各有专门用途。这不表示整个生态不存在其他审查 skill。

## 3. 更新方式

需要更新时重新记录上游提交与文件摘要，先比较规则差异，再决定本项目是否采用。上游变化不自动修改本项目规范，也不自动安装工具或改变 CI。
