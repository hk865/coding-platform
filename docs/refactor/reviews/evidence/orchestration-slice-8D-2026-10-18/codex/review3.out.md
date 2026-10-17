只读核对完成；未改文件，未运行测试、构建或分析脚本。

下文源码 TS 文件在 `src/core/workspace/`，codec/service 在 `src/core/work-graph/architecture/`；测试未注明目录的在 `tests/data/`。

1. **修好。** 解码返回补齐后的覆盖，服务层不再补 notes，旧记录断言已补（`architecture-record-codecs.ts:548`；`architecture-service.ts:594`；`tests/work-graph/S8D-coverage-notes.test.ts:49`）。
2. **修好。** TS 独占数据库选择，脚本只读选中项并计算合并说明；嵌套 B 已有验收行（`architecture-language-provider.ts:212`；`scripts/cpp-source-query.py:617`；`S8D-A23-cpp-config.test.ts:104`）。
3. **部分，必须改。** 共用提取器已有，但调用前仍用两套取材：展开路径截前 400 字节，未展开路径只取诊断位置的两行（`scripts/cpp-source-query.py:759、767、846、862`）。例如说明符前有超过 400 字节的完整块注释，展开路径会把注释截坏，退回 clang 拼写，仍丢失源码原写法；多行续行也未统一。**修改思路：** 两条路径共用完整逻辑指令取材，再交给现有提取器，去掉任意的 400 字节／两行截断。
4. **修好。** 已排除“预处理出错”的完成单元，孤立头文件预期正确（`analysis-runner.ts:223`；`S8D-A22-cpp-imports.test.ts:337`）。
5. **修好。** 字节计数属于整次语言运行，跨启动共享（`analysis-runner.ts:75、310、342`）。
6. **修好。** 协议 end、stdout 结束、进程退出分开处理，等待保留限时及取消，end 后仍解析输出（`analysis-runner.ts:350、394、415、424、472`）。
7. **修好。** spawn 分类、Python 普通异常、捕获边界类型和截断均落实（`analysis-runner.ts:319、338`；`scripts/python-source-query.py:586`；`capture.ts:60`）。
8. **部分，必须改。** 双后端入口已接通：`tests/composition/S8D-A11-python-failure.test.ts:32`、`S8D-A20-python-imports.test.ts:108`、`S8D-A21-python-config.test.ts:61`、`S8D-A22-cpp-imports.test.ts:13`、`S8D-A23-cpp-config.test.ts:34`。共同夹具真实创建平台、抓取、读文件页、调用正式比较（`tests/helpers/S8D-platform-fixture.ts:121、204、210、213`）；A-20/A-22 从比较结果取 unresolved，原字面期望保留。仍有下面两处验收退步。
9. **修好。** header 用 readline，文件逐行入表（`scripts/cpp-source-query.py:884、897`）。
10. **修好。** 两模式共用配置分支及根顺序，严格模式保留拒绝行为（`scripts/python-source-query.py:191、226、280、320、336`）。
11. **修好。** 旧主体恢复顶层；两提供者共用覆盖转换（`scripts/python-source-query.py:578、599`；`architecture-language-provider.ts:199、311、359`）。
12. **修好。** owner 先截断、再去重排序取十项，codec 只检查（`capture.ts:69、358`；`architecture-record-codecs.ts:259`）。

第 8 项的两处必改：

- **A-11(2) 挂住场景被删。** 包装器现在打印垃圾后直接执行真实 Python，会正常结束（`tests/composition/S8D-A11-python-failure.test.ts:27`），不符合 §11.6 的“挂住、不退出”（`slice-8-SPEC.md:743`）。这会放过“等 EOF 才发现垃圾”的退步。**修改思路：** 包装真实解释器，注入垃圾后保持存活，验证平台主动终止，保留现有字面断言。
- **旧 RUN-01 未等价替换。** 删掉了“全部失败时按主文件选原因”和“同一说明符有边就消除未解析”的断言（`.lead-ref/rework2.diff:4521、4472`）；新例只覆盖普通成功文件、去重和原因优先级（`analysis-runner.test.ts:138、156、161`），不能守住这两条合并规则。**修改思路：** 用真实条件编译头文件制造不同失败原因；同一宏包含用两条编译命令分别定义／不定义宏，恢复字面断言。

未见继续以伪造的合法结果验收业务事实。修改 ready、注入错误序号属于坏协议故障（`analysis-runner.test.ts:222、391`）；脚本测试实际启动解释器（`S8D-cpp-import-graph-script.test.ts:51`；`S8D-python-import-graph-script.test.ts:25`）。

**建议补正替换清单。** 回复遗漏旧 RUN-04→新 RUN-03、旧 RUN-06→新 RUN-04（`analysis-runner.test.ts:192、201`），以及脚本普通合并例改成嵌套目录例（`.lead-ref/rework2.diff:4063`）。其余列出的替换方向成立，但 RUN-01 须补上述覆盖。

UNSPECIFIED：1 接受 typeof（`capture.ts:63`）；2 接受 10,000 层夹具（`S8D-python-import-graph-script.test.ts:192`）；3 接受中途 failed 终止整门语言（`analysis-runner.ts:441`）；4 接受不恢复假协议，自包含已有真实源码断言（`S8D-cpp-import-graph-script.test.ts:162`）；5 接受末行和相同 ready（`analysis-runner.ts:88、448`）；6 不必新增固定版本断言，但**建议改正回复**：engine 已断言 libclang（`analysis-runner.test.ts:151`）。

对 +2,160/−125，不按预算删必需逻辑。只建议清理具体残留：前一循环已为每个路径写入结果，后面的补缺循环不可达（`analysis-runner.ts:235、250`）；Python 的 implicit 参数没有传入 true 的调用（`scripts/python-source-query.py:146、208、284、316`）。另有本轮复制的夹具：A-06 仍保留自己的平台初始化，共同 helper 又写一份；建议让 A-06 也复用它，避免两套授权和登记流程漂移（`tests/composition/S8D-A06-multilingual.test.ts:50、84`；`tests/helpers/S8D-platform-fixture.ts:87、121`）。

先改完列出的几处