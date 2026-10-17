只读核对代码事实（不要改任何文件，不要跑测试或构建）。用中文回答，1,200 字以内，每条带“文件:行”。

当前目录是 lead 分支（8A 已合入，ce4369b1；4C-2 A 段已合入）。下一步施工第 8 片的 8D：C/C++、Python 的引用关系（`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` 的 L13（约 158–163 行）、§1 的 8D（约 182 行）、§3 的 8D 行（约 342 行）、§4 第 13 条（约 358 行）、§5.1 的 AE6（约 373 行）、§5.2 里 8D 的验收行、§5.3、§6 的 8D（约 443 行）、§9（8A 施工和验收中的限定，对 8D 同样有效）。lead 要据此写施工说明书。请核对：

1. **8A 留给 8D 的接口：** `ArchitectureLanguageProviderV1` 在哪、长什么样；TS/JS 提供者怎么接（文件、注册处）；`ProjectSourceAccess` 冻结材料和 `expectedSnapshot` 怎么传给提供者；`LanguageCoverageV1` 现在的形状和计算处；今天 C/C++、Python 文件在观测记录里读成什么（`unsupported`？），哪些测试断言了这一点。
2. **现有两个解析器：** `src/core/workspace/cpp-source-index.ts`、`python-source-index.ts`、`scripts/cpp-source-query.py`、`scripts/python-source-query.py` 今天的输入输出、分页、诊断截断（规格说 30/40 条）、`coverage` 的含义；要按 L13 给出“截断以前的逐文件解析结果和全量统计”，最小要改哪里；它们现在有哪些生产调用方和测试。
3. **运行环境：** libclang 默认路径（代码里是 `/usr/lib/llvm-18/lib/libclang.so.1`）、Python 的 clang 绑定从哪来（`.local/source-analyzers/analyzers.zip` 里有什么、怎么装、校验）、`pythonPath`、`libraryPath` 的注入点；测试里怎样做“可装/不可装”两种（现有测试怎么做的，有没有跳过条件）；bwrap 沙箱里能不能跑这两个分析器（DSH 的副本里没有 bwrap）。
4. **规格的旧行号对照：** 8D 相关段落引用的文件:行，和现在的对照（变了的列出新号）。
5. **要改断言的旧测试**（§5.3 的“语言覆盖的旧断言”）：具体哪些测试文件:行。
6. **和 8A §9 的读法的关系**：哪几条对 8D 有直接影响（例如 `unknown` 的算法、路径并列、跳过的文件）。
7. **风险和要 lead 先定的最小问题**（每条给最小选项），以及生产代码行数粗估（不计测试）。
