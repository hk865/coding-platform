只读核对；未改文件、未跑测试或构建。

1. **三处均正确。** Goal读取失败跳过、不关不写（[session-maintenance.ts:487、519](D:/cxt/k3g4a-review3/src/business/workflow/session-maintenance.ts:487)）；内存/SQLite覆盖失败轮及下一轮活跃让行（[S1-session-maintenance.test.ts:502、536、552](D:/cxt/k3g4a-review3/tests/business/S1-session-maintenance.test.ts:502)）。释放移至finally，原Session及零写入断言保留（[K3-29-recovery-round.test.ts:305、373、455、687](D:/cxt/k3g4a-review3/tests/scenarios/K3-29-recovery-round.test.ts:305)）。两旧断言按裁定替换，别的未动（[K3-08-wait-reply.test.ts:162](D:/cxt/k3g4a-review3/tests/scenarios/K3-08-wait-reply.test.ts:162)；[K3-R1-restart-flows.test.ts:176](D:/cxt/k3g4a-review3/tests/scenarios/K3-R1-restart-flows.test.ts:176)）。**修改思路：保持。**

2. **选(a)**，未知不能当不活跃。生产接planService并透传维护（[create-platform.ts:1525](D:/cxt/k3g4a-review3/src/composition/create-platform.ts:1525)；[workflow.ts:2402](D:/cxt/k3g4a-review3/src/business/workflow/workflow.ts:2402)），缺省改动无生产影响。测试也不会因缺省值改变：未接plans时，readTaskRow已提前挡住该分支（[session-maintenance.ts:421、475](D:/cxt/k3g4a-review3/src/business/workflow/session-maintenance.ts:421)）。**修改思路：保留代码，修正回复“以前会关”的说法。**

3. **未发现本次返工新增实错。** 依据上述变更路径，**修改思路：无需扩改。**

可以合入