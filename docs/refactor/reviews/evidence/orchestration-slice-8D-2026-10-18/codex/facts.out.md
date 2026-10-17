全程只读，未改文件、未跑测试或构建。以下文件名均按当前目录定位。

1. **8A 接口**：`language`、`claims(path)`、`extractImports({source,signal})`，返回 `analyzerSnapshot/edges/unresolved/coverage`。TS 工厂在同文件87行；`capture.ts:105` 的非TS列表仍空，312行选择提供者，287行构造冻结读取器。接口不接 `expectedSnapshot`，8D须取第一页快照后逐页回传。覆盖字段及完整公式见 `architecture-inspection.ts:74`、`capture.ts:355`。（`architecture-language-provider.ts:20`）

2. **解析链**：两索引接读取器和查询，脚本收JSON材料、回结果/诊断/语义覆盖；支持符号、定义、引用、导入、调用。默认每页100、最多200，诊断分别截40/30；底层覆盖不是文件成功率。最小改两个索引及两个脚本：截断前记录逐文件成功/失败/跳过及全量统计，再透传。C++须统计被包含头文件，当前单个TU解析失败会终止整批。生产调用是 `exploration-tools.ts:170、171`；测试为 `tests/data/cpp-source-index.test.ts:31`、`python-source-index.test.ts:19`，生命周期见 `source-tool-lifecycle.test.ts:124`。（`cpp-source-index.ts:78`；`python-source-index.ts:90`；`cpp-source-query.py:248`）

3. **环境**：C++用标准库 `ctypes`，没有clang Python绑定；默认库为 `/usr/lib/llvm-18/lib/libclang.so.1`，构造参数可注入两路径。Python解释器硬编码 `/usr/bin/python3`。zip实查只有Jedi 0.19.2、Parso 0.8.4，SHA一致；随仓库提供，运行时校验并解压临时目录，提示的安装脚本实际不存在。两索引测试无环境跳过；C++注入不存在库测不可用，Python尚无缺包测试。分析器自身不需bwrap；沙箱挂入运行库、脚本/包且临时目录可写即可，属于静态判断。（`cpp-source-index.ts:18、61、66`；`python-source-index.ts:26、75`；`python-source-query.py:119、136`；`cpp-source-index.test.ts:91`；`process-sandbox.ts:2022、2028`）

4. **旧号对照**：L13引用的C++索引61/66/79、Python索引91、Python脚本232、C++脚本344均未变。8A旧抓取定位现应看 `project-source-snapshot.ts:122、157`、`capture.ts:550`。8D验收仍在 `slice-8-SPEC.md:373、420`。

5. **旧断言**：今天两语言均为 `unsupported`。必改 `tests/data/S8A-file-graph.test.ts:160、162、188`：Python覆盖和空边、C++覆盖；后者无编译数据库，8D应变 `failed`。底层索引的 `unsupported` 不应一起翻转。

6. **§9影响**：冻结一次、跳过文件仍计问题、失败不换配置、三页返回覆盖并复核权限。缺依赖的 `unknown` 看语言解析不足、未解引用、目标无归属、并列及失败文件；并列影响所有候选模块，源码问题列表截断影响全部缺依赖；`other`除外。（`slice-8-SPEC.md:467、485`；`formal-comparison.ts:113、125、145`）

7. **lead最小定案**：C++错误归属选“报错文件／整个失败TU”；跳过Python配置选“该语言失败／显式降级”；缺包夹具选“注入资源路径／独立部署副本”。另注意C++每页重解析。生产新增/改写粗估 **500–800行**，不计测试；脚本变更须同步资源摘要。（`cpp-source-query.py:248、256`；`python-source-query.py:22`；`python-source-index.ts:28`；`runtime-assets.json:55、59`）