tests/app/gui.test.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
tests/contract-suite/console.contract.suite.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
tests/control/workspace-registration.test.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
tests/restart/persistent-restart.test.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
tests/restart/evidence/p1-01-evidence.test.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
tests/verification/code-graph-port.test.ts recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)
src/ui/tests/fixture-server.mjs recorded (pre-batch bytes were not frozen; independent review recovered them from dangling git blobs and confirmed no weakening)

## REV-05 处置

独立审查指出本批冻结的快照只覆盖 27 个受影响文件中的 22 个。上列 7 个文件
（含 `src/ui/tests/fixture-server.mjs`）在本批开始后、独立审查前被修改，
其**修复前字节未进入本批冻结**。

独立审查从悬空 git blob 恢复了其中 5 个可匹配 candidate-04 哈希的文件并逐行比对，
结论：改动为新增 `registerWorkspace` 陷阱、新增 `fixtureExecution: true`、
等价匹配器的调用点迁移、更严格的探针采用——**没有一处削弱**。
本批不伪造这些文件的"修复前"字节；此处只记录其修后状态与审查结论。
