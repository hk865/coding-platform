只读快检完成；未改文件，未运行测试、构建或分析脚本。以下未注明目录的测试文件均在 `tests/data/`。

1. **功能已修好，但引入一处必须改的回退。** 两条路径统一取完整逻辑指令，去掉截断并拼接续行（`scripts/cpp-source-query.py:415、865、881`）；新测试直接断言 `HDR`、`NOPE`（`S8D-cpp-import-graph-script.test.ts:251、264`）。但新函数每处理一条引用都重新拆分整个文件（`scripts/cpp-source-query.py:421`），违反规格“每个文件的行首偏移只算一次”（`slice-8-SPEC.md:661`）。长度 N、引用数 M 的文件新增 O(N×M) 扫描和分配，可能把正常单元拖到超时。**修改思路：** 按文件缓存物理行或行首索引，两条路径共用，再定位、拼接当前指令。

2. **挂住保护已恢复；输入转交仍建议修正。** 包装器打印垃圾后等待、长睡眠；内存和 SQLite 都保留 Python 失败、TS 正常及仅有 TS 边的字面断言（`tests/composition/S8D-A11-python-failure.test.ts:35、40、52、56、59`）。不过第35行用非交互 `/bin/sh` 的后台命令启动 Python，未显式转交 stdin，子进程默认从 `/dev/null` 读，实际没拿到平台输入。垃圾后挂住的保护仍有效，但“转发真实解释器”不完整。**修改思路：** 前台运行真实 Python，结束后再睡眠，保留原输入和挂住行为。

3. **已修好。** RUN-16 用真实条件编译制造 FOO/BAR 两种失败，断言按主文件排序选 BAR（`analysis-runner.test.ts:423、426、439`）；RUN-17 用两条编译命令分别不定义／定义 HDR，断言只留边、未解析为空（`:451、455、466、467`）。没有注入合法协议事实。

4. **已修好。** 补缺循环删除后，前一循环仍覆盖所有路径（`src/core/workspace/analysis-runner.ts:235、248`）；`implicit` 参数和分支已删（`scripts/python-source-query.py:146`）。A-06 改用公共夹具，业务字面断言保留（`tests/composition/S8D-A06-multilingual.test.ts:94、102、109、118`）；公共夹具仍检查捕获和读取失败（`tests/helpers/S8D-platform-fixture.ts:191、198`）。未见留下第二份初始化或削弱断言。

5. **已修好。** 回复补齐三条替换关系并更正引擎说明（`.lead-ref/s8d-rework3-final.md:22`）；对应测试和 `libclang` 断言存在（`analysis-runner.test.ts:151、192、201`；`S8D-cpp-import-graph-script.test.ts:362`）。

先改完列出的几处