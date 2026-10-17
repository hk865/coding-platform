**必须改**

1. §1：[access:89](D:/cxt/s8d-facts/src/core/workspace/access.ts:89)加观测专用枚举，勿套[验证器:45](D:/cxt/s8d-facts/src/core/workspace/verification-workspace-reader.ts:45)的同根限制。子模块、链接、已删文件口径可以；补子目录cwd、相对路径、取消/超限不回退。回退须递归前剪枝，不能全扫后过滤；旧硬跳过也须对齐。[沙箱:605](D:/cxt/s8d-facts/vendor/coding-agent/patches/sandbox/workspace/workspace-sandbox.ts:605)禁全局配置，与“全局忽略一致”冲突，须选定环境。
2. §2、6：[codec:273](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-record-codecs.ts:273)补块/清单版本、跨块序号及成员摘要校验；[service:522](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:522)统一授权、previous读块；[分页:74](D:/cxt/s8d-facts/src/core/work-graph/architecture/file-graph-index.ts:74)显式投影，防新增字段泄出。
3. §2：[映射:75](D:/cxt/s8d-facts/src/core/workspace/architecture-source.ts:75)先触发240KiB，不能仅改落库正文。先生成紧凑快照；保留architecture.unresolved供[模块查询:147](D:/cxt/s8d-facts/src/core/work-graph/architecture/graph-index.ts:147)，文件unresolved供[正式比较:48](D:/cxt/s8d-facts/src/core/work-graph/architecture/formal-comparison.ts:48)。
4. §4：[TS:260](D:/cxt/s8d-facts/src/core/workspace/typescript-source-query.ts:260)根文件可预算，但漏import带入文件；改按冻结输入保守计量或预解析依赖闭包，否则2,000/40MiB挡不住实际程序。
5. §5、A-11：[provider:126](D:/cxt/s8d-facts/src/core/workspace/architecture-language-provider.ts:126)已把第二次异常转failed；[capture:598](D:/cxt/s8d-facts/src/core/workspace/capture.ts:598)仍沿用第一次成功。改共用结果、同步两层覆盖；断言语言complete，页complete只是分页。8D的[C++:80](D:/cxt/s8d-facts/src/core/workspace/cpp-source-index.ts:80)、[Python:92](D:/cxt/s8d-facts/src/core/workspace/python-source-index.ts:92)还须处理rejected，保持L13逐语言失败。
6. §2、A-12：[service:755](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:755)旧改动只算TS/JSON；明确保持此范围，否则v1缺非TS摘要无法比较。旧版用真实旧写口造，撤掉“不做旧库夹具”，不能沿用手写记录。
7. §8：[service:655](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:655)不公开change/删除路径；这些改用真实写入旁观断言。补授权收窄、深层跳过、字节上限、超过万条引用、跨块边、多语言合计上限及v1 previous；A-12列明改/增/删/不变四个文件。

**建议改**

8. §2、6、A-09：[契约:67](D:/cxt/s8d-facts/src/contracts/architecture-source.ts:67)仍限unresolved；删“正文只随模块增长”。A-09限定无未解析引用；64×256KiB计入unresolved、删除项，超限capacity。
9. §9：[打包:283](D:/cxt/s8d-facts/src/core/work-graph/architecture/architecture-service.ts:283)等兼容改动使400–700行偏乐观，按枚举/编解码/分析/接线重估；改正“8D之前、之后”矛盾；副本无决定77，补出处。

**可以**

10. §3、7：[capture:556](D:/cxt/s8d-facts/src/core/workspace/capture.ts:556)共用分析并提前释放、保留冻结核对，符合规模修复；明确仅观测生效，保留第4片严格捕获。

规格审查完