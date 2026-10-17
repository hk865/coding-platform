只读审查完成；未修改文件，未运行测试、构建或分析脚本。以下只列实际问题。未注明目录的 TS 文件均在 `src/core/workspace/`；“codec”指 `src/core/work-graph/architecture/architecture-record-codecs.ts`。

1. **必须改：旧记录的 `notes: []` 默认值没有从解码器返回。**  
   `readLanguageCoverage` 构造了默认值，但验证只检查返回值是否为空，随后解码仍返回原始 `languages`（codec:259、277、462、546）。

   最小反例：合法旧记录的语言项没有 `notes`，解码结果仍是 `undefined`。服务层另行补默认值，掩盖了底层契约错误（`src/core/work-graph/architecture/architecture-service.ts:594`）；新增旧记录测试也只断言语言名（`tests/work-graph/S8D-coverage-notes.test.ts:42`）。

   **修改思路：** 解码时使用 `readLanguageCoverage` 的结果，并在该测试断言 `notes: []`；无需等待 §10 的 A-16。

2. **必须改：数据库重复选择，拒绝合法的嵌套 B。**  
   提供者允许任意非根共同目录 B，脚本却按斜线数量限制层级（`architecture-language-provider.ts:195、220`；`scripts/cpp-source-query.py:592、600`）。

   最小反例：`out/build/a/compile_commands.json` 和 `out/build/b/compile_commands.json`。前者选中合并，后者报“有多个编译数据库”，整门语言失败。§11.4 只要求 B 不是工作区根。

   **修改思路：** 由拥有存在性、跳过信息的提供者独占选择；删除脚本的 `graph_select` 二次选择，脚本只解析已选数据库并计算合并说明。不要采用 UNSPECIFIED 2 的“收紧提供者”，那会缩窄冻结规格，也保留两份规则。

3. **必须改：宏说明符提取不一致，产生虚假的未解析引用。**  
   已展开宏的说明符去掉尾注释，未展开宏却保留尾注释（`scripts/cpp-source-query.py:365、828、849`）。

   最小反例：源码为 `#include HDR // note`，同一文件两条编译命令，一条定义 `HDR="target.h"`，另一条不定义。前者得到说明符 `HDR` 的边，后者得到 `HDR // note` 的未解析记录；runner 无法按同一说明符消除它（`analysis-runner.ts:259、273`）。

   **修改思路：** 两条路径共用说明符提取函数，统一处理注释、续行和定界符。当前正则还会把 `#include /*c*/ "missing.h"` 的说明符变成不带引号的名字，同处修正即可。

4. **必须改：把已经完成的预处理失败单元误判为“没做完”。**  
   runner 只凭 `done.files` 恰好包含一个失败主文件，就设置 `unfinished`（`analysis-runner.ts:221`）。

   最小反例：唯一主文件为 `#if 1\n`，另有未被包含的 `orphan.h`。脚本完成分析，主文件因 R2lex 失败（`scripts/cpp-source-query.py:815、823`）；`orphan.h` 应是“没有编译单元包含它”，现在却是“有编译单元没有做完”。

   **修改思路：** 区分“预处理出错”的逐文件失败与 §11.4 列出的整单元失败；不能仅用数组长度代替这个判断。无需扩展协议。

5. **必须改：64 MiB 输出上限没有跨重启累计。**  
   `total` 定义在每次启动新建的 `readLines` 内（`analysis-runner.ts:69、318`）。

   最小反例：第一次启动输出 40 MiB 后崩溃，重启再输出 40 MiB；两次均不超限，但整门语言已超过规定上限。重启越多，实际允许的输出越大。

   **修改思路：** 将字节计数放到 `runAnalysis` 生命周期，所有启动共享；每个进程只保留自己的分行缓冲。

6. **必须改：结束处理绕过输出排空，另有等待不受取消和限时控制。**  
   收到协议 `end` 就杀进程并返回，后续输出不再判读（`analysis-runner.ts:431`）。最小反例：正常结果、`end` 后紧接 `garbage`；已有结果会被记录为成功，违反“输出读不了优先”。

   另外，stdout 关闭但进程仍活着、且尚未开始单元时，代码直接 `await exited`，离开了限时及取消监听循环（`analysis-runner.ts:343、375、380`）。包装器关闭 stdout 后挂住即可使请求失去这些控制。

   **修改思路：** 将协议结束、stdout 结束和进程退出分开记录，统一在仍受取消及语言限时约束的循环中收尾；排空后优先处理输出错误，再按退出规则决定结果。

7. **必须改：部分异常仍被错误归类或丢失类型。**  
   所有异步 spawn 错误都映射“分析器不可用”，包括 `EMFILE`、`EAGAIN`（`analysis-runner.ts:317、356`）；§11.5 已限定该类别为 `ENOENT/EACCES` 或 `unavailable`，这不是 UNSPECIFIED。

   Python 配置入口只捕获 `ConfigError`；合法但极深的 JSON 嵌套可使 `json.loads` 抛 `RecursionError`，最终被记成“第一个单元前退出”（`scripts/python-source-query.py:442、665`）。同步抛出的异常进入捕获层后，又只保存 message（`capture.ts:60、368`）。

   **修改思路：** 保留 spawn 原错误，只对规定代码映射不可用；Python 语言入口把其余普通异常输出为 `failed`；捕获边界统一使用“异常类型＋消息前 200 字符”。取消继续单独处理。

8. **必须改：验收测试缺少规定路径，并新增了事实注入。**  
   A-11(2)、A-20～A-23 主要停在 workspace 捕获层，没有按 §11.6 跑内存、SQLite 两套；A-20/A-22 的说明符也没有走规定的正式比较入口（`tests/composition/S8D-A11-python-failure.test.ts:60`；`tests/data/S8D-A20-python-imports.test.ts:60、187`；A-21:63；A-22:62、104；A-23:58）。

   最小漏检就是第 1 项：捕获正确、编码解码丢字段，这些测试仍可通过。应复用 A-06 的平台双后端夹具，保持现有字面期望，经文件页及 `compareFormalObserved` 验收；A-24 保留单后端例外。

   另有测试直接手写扫描状态和边：RUN-12 甚至注入“主文件整单元失败，但仍有指向输入材料外文件的边”，并要求保留（`tests/data/analysis-runner.test.ts:328、333、341`）。这违反任务书“故障注入可以，事实注入不可以”。**修改思路：** 合并规则用真实源码夹具验证；错误协议、超时和崩溃用转发真实解释器的包装器制造，删除被既有验收覆盖的假事实测试。

9. **必须改：C/C++ 没有逐行读取输入。**  
   脚本先 `sys.stdin.read().splitlines()` 保存全部序列化输入，再建立内容表（`scripts/cpp-source-query.py:869、882`），违反任务书 §4 的逐行读取要求。

   最小反例是一份接近捕获上限的材料：解析后的源码之外，还长期保留整份 JSON 行列表，增加无必要的内存成本。

   **修改思路：** `readline()` 读取 header，随后迭代 stdin，每行解析后直接放入内容表；这是局部替换，不涉及 VFS 或协议改动。

10. **必须改：Python 配置读取没有按冻结规格复用。**  
    旧 `project_configuration` 和新增 `plan_roots` 各自维护 pyright、setuptools、setup.cfg 分支及查找根顺序（`scripts/python-source-query.py:59、411、433`），而 §11.3 明确要求复用前者、增加观测模式。

    最小维护反例：共同的 `where → extraPaths` 顺序调整，需要同时修改两套实现；这是实质重复，不是重缩进造成的统计膨胀。

    **修改思路：** 共用配置分支和根的顺序，只按模式区分 JSONC、拒绝/忽略行为及原因格式；保住 `python_index` 的严格行为。

11. **建议：缩小无行为变化的差异，但不要按行数删除必要校验。**  
    旧 `python_index` 主体整体包进函数，造成约 145 行重缩进（`scripts/python-source-query.py:157`）。可先定义轻扫描函数、按 argv 分路并退出，再保留旧顶层主体，减少审查噪声。

    两提供者的结果转覆盖也重复，可共用一个小转换函数（`architecture-language-provider.ts:294、347`）。参数表是规格要求搬运的；runner 的字段类型、序号和背压检查对应协议要求（`analysis-runner.ts:128、160、411`），不能仅因超预算就删掉。超支应结合上述实际重复说明，不能主要归因于重缩进。

12. **建议：由 lead 明确截断后是否仍须去重。**  
    当前严格执行任务书的“去重、排序、截断、取 10”（`capture.ts:348`）。两个前 200 字符相同、尾部不同的说明会变成重复项；超长项不会存活，codec 也拒绝超过 200 字符的项（codec:262）。

    这不是擅自偏离绑定答复。若最终列表必须唯一，最小修改是由 lead 补明规则，再在 owner 截断后去重、最后取 10；不要让 codec 承担归一化。

UNSPECIFIED 1 不必增加固定引擎字面量断言，协议没有指定具体值。UNSPECIFIED 3 的末行无换行、重复相同 `ready`，没有明确的拒绝规则，不单独阻断（`analysis-runner.ts:86、405`）；spawn 分类则必须按第 7 项修。UNSPECIFIED 5 的 AE6 新措辞已落在测试说明中，无须制造不存在的旧断言（`tests/composition/S8D-A06-multilingual.test.ts:7`）。

先改完列出的几处