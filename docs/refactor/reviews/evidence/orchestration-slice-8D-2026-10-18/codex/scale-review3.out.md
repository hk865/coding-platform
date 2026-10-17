只读核对完成，未改文件、运行测试或构建。本轮未发现必须改项。

下文 W/=src/core/workspace/，A/=src/core/work-graph/architecture/，T/=tests/data/，R/=.lead-ref/。

1. 已修复：mode 必填且无默认值（W/architecture-source.ts:37）；五处纯函数调用均补参（T/S8D-compact-snapshot.test.ts:48；tests/work-graph/S8A-root-path.test.ts:75、94、121、168）。

2. 已修复：A-27 经共享平台夹具、双后端核对公开结果（T/S8E-A27-ts-light-scan-contract.test.ts:34、47、67）。取消在首个失败文件排队，断言只访问 a.ts、x1.ts 并返回 cancelled（同文件:99、110）。UNSPECIFIED 1 接受：setImmediate 在扫描器的让出回调之前排队，确实覆盖失败分支 finally，而非后续成功文件（W/typescript-light-scan.ts:327、399、297）。

3. 已修复：整项 inventory:null 被拒绝，git 的 reason:null 保留（A/architecture-record-codecs.ts:472、481、484）；正例和拒绝断言齐全（T/S8E-old-format-rejection.test.ts:56、78）。UNSPECIFIED 3 接受：新增拒绝文案不改变约定结果。

4. 已修复：模块层300边断言保留，双后端逐文件精确断言唯一后继（T/S8D-A18-ts-light-scan.test.ts:16、83、92、99）。UNSPECIFIED 2 接受：邻居直接来自已存文件边（A/architecture-service.ts:750；A/file-graph-index.ts:117、120）。按 `(from,to)` 的边身份，漏边得到空列表，多出不同目标则节点数增加；limit=10 不会把多个邻居藏成一个。因此无需修改 neighborsPage。回报已列两后端耗时（R/s8a-scale-rework2-final.md:11）。

5. 已更正：回报按新增行数写 +1,757/−593、超上限467，并说明构成（R/s8a-scale-rework2-final.md:3、5）。无基线 Git，累计数仅能核对回报口径，不能独立重算。

6. 已修复：注释改为164/165字节，65块断言保留（T/S8E-A12-file-chunks.test.ts:93、97、122）。

差异内未发现新增重复实现、静默默认或未经授权的断言削弱。A-27 保留的扫描器直测只检查公开结果不提供的行号（T/S8E-A27-ts-light-scan-contract.test.ts:116、124）；新增旧格式反例属于允许的纯解码测试（T/S8E-old-format-rejection.test.ts:6、78）。

就本轮审查，8D与§10的代码阻塞已清，可以一起合入；实际合入前仍须完成合并树全量，不能以回报中的局部检查替代（R/slice-8-SPEC-current.md:801）。

可以合入