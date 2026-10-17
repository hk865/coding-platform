**必须改**（编号沿用首轮）

- ①部分落实（草1；[git-read:173](D:/cxt/s8d-review/src/core/workspace/git-read.ts:173)）：放置、环境、递归剪枝、取消及超限不回退已对；现有 Git 读取仍拒绝子目录，须新增观测枚举，仅复用进程层，绕开同根检查。
- ④未闭合（草4；[TS:258](D:/cxt/s8d-review/src/core/workspace/typescript-source-query.ts:258)）：TS 能导入 JSON，按 `typescript` 文件计量仍漏算；改按冻结 TS/JS/JSON 保守预算，并补 JSON 超限例。
- ⑦部分落实（草8；[service:755](D:/cxt/s8d-review/src/core/work-graph/architecture/architecture-service.ts:755)）：A-12 须断言手算字面量，不能只与单块输出互比；A-15 补不变文件，用真实写入旁观断言增/改/删各1，其余用例可经公开入口或允许的注入构造。

**建议改**

- ⑤主体落实（草3、5；[provider:174](D:/cxt/s8d-review/src/core/workspace/architecture-language-provider.ts:174)）：共享结果、语言覆盖断言正确；8D 两提供者已处理 `rejected`，应保留现分支、补错误类型及截断，“空图不能成功”限定在分析失败时。
- ⑨基本落实（草9；[service:283](D:/cxt/s8d-review/src/core/work-graph/architecture/architecture-service.ts:283)）：600–900行可作粗估，须按枚举接缝和8D已有处理调整；返工后接做、一起合入合理，验收应覆盖最终组合树，“一轮”不限制返工。
- A-16（草8；[组合根:586](D:/cxt/s8d-review/src/composition/create-platform.ts:586)）：方案可行；固定规模修正前提交，经公开入口生成并关闭库，保存 `ledger.sqlite`、`artifacts.sqlite`、捕获引用及源码，放 `tests/fixtures/s8-observation-v1`，附提交号和一次性生成脚本；给 [.gitignore:21](D:/cxt/s8d-review/.gitignore:21) 加精确例外，每例复制到独立临时目录，库与工作区分开，避免并发互改。

**可以**

- ②已落实（草2、6；[codec:273](D:/cxt/s8d-review/src/core/work-graph/architecture/architecture-record-codecs.ts:273)、[分页:74](D:/cxt/s8d-review/src/core/work-graph/architecture/file-graph-index.ts:74)）：版本、跨块全局序号、成员摘要、共用读块和显式投影正确，按稿实现。
- ③已落实（草2；[映射:75](D:/cxt/s8d-review/src/core/workspace/architecture-source.ts:75)）：先紧凑快照、再写v2正文，保留模块未解析引用，按稿实现。
- ⑥已落实（草2、8；[service:718](D:/cxt/s8d-review/src/core/work-graph/architecture/architecture-service.ts:718)）：改动仍限TS/JS/JSON、只存三数，真实旧写口生成v1夹具正确，按上述隔离方式实施。
- ⑧已落实（草2、6、8；[契约:67](D:/cxt/s8d-review/src/contracts/architecture-source.ts:67)）：保留模块未解析上限、文件未解析引用计入块预算、A-09限定无未解析引用，按稿实施。

规格审查完