只读核对，未改文件、未跑测试或构建；实测数字未复跑。

1. **部分成立。** `files`、首抓的`changes.added`、`indexedSources`重复保存路径；两份unresolved及“unmapped source”也属实。256KiB限制正文和单块，240KiB限制模块快照，64限制块数；10,000限制分析及导出，溢出后分析失败、模块清空，并非保留截断结果。报告还漏了模块unresolved最多2,048条。[capture.ts:563](D:/cxt/s8d-facts/src/core/workspace/capture.ts:563)、[architecture-source.ts:51](D:/cxt/s8d-facts/src/core/workspace/architecture-source.ts:51)、[architecture-source.ts:67](D:/cxt/s8d-facts/src/contracts/architecture-source.ts:67)、[architecture-service.ts:752](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:752)。

2. **成立，但“全算进来”需限定。** 清单来自工作树递归，不查Git跟踪清单或`.gitignore`；普通`node_modules`文件会进入，但仍受权限、符号链接跳过及60,000项枚举限制。`fileGraph.unresolved`无独立数量/字节上限，仅间接受分析限制。[workspace-sandbox.js:318](D:/cxt/s8d-facts/vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js:318)、[capture.ts:335](D:/cxt/s8d-facts/src/core/workspace/capture.ts:335)。

3. **A部分成立，优于B/C。** 改service、codecs、capture、模块映射、provider及相关契约，复用线性打包、摘要核验、差异计算；v2节点存摘要/大小/indexed，授权和previous读分块，保留v1分支及成员摘要校验。unresolved搬块须保留行号：模块查询也消费它。估400–700生产行，200–250偏低。[architecture-record-codecs.ts:369](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-record-codecs.ts:369)、[graph-index.ts:147](D:/cxt/s8d-facts/src/core/work-graph/architecture/graph-index.ts:147)。
   
   分析可先定10万原始import、文件导出2万；原始import不等于去重边。应复用首次TS结果，避免再次建分析器；8D继续用冻结材料、固定snapshot翻页，三语言合计10万边。时间/内存随源码及结果增长，报告40.8秒/2.1GB不能外推到10万。[capture.ts:205](D:/cxt/s8d-facts/src/core/workspace/capture.ts:205)、[architecture-language-provider.ts:99](D:/cxt/s8d-facts/src/core/workspace/architecture-language-provider.ts:99)。
   
   64块仅16MiB；按62字节路径估算约73块，尚未计unresolved，不能保证L12数量上限。可优化A为边存节点序号，另定字节预算。授权只读节点/问题块并逐路径核验；直接复用整图读取则每次最多64次、16MiB，比较两份翻倍。[architecture-service.ts:573](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:573)。

4. **成立，规格与测试须补。** 改L12“模块级不变”、64块约束；§9第1条写独立分析限额，第4条补两类v1兼容，第5条写授权读法，第8条改为v2容量规则。公开入口补超过2,000文件提交、超过10,000引用、分页/previous增删改、撤权、多语言合计超限；旧v1读取及previous沿服务入口验。[slice-8-SPEC.md:152](D:/cxt/s8d-facts/docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:152)、[S8A-file-layer.test.ts:497](D:/cxt/s8d-facts/tests/work-graph/S8A-file-layer.test.ts:497)。

还要先查清：10万import的耗时与内存峰值，并由lead定下总字节预算。