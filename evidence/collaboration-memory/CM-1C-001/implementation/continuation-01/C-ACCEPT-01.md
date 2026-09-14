# C-ACCEPT-01：探索错误获得协调写入口

独立验收确认的高优先级回归。snap01 全量的 tests/app/explorations.test.ts 首例发现模型工具清单多出六个 coordination_* 和 report_architecture_conflict；同源码定向复现。不是过时期望：探索保持纯读，不因 Work 初次分配获得平台协调写能力。

根因：service 启用首次分配后，harness 没按实际持久 RunSpec.mode 区分普通 Work 和 explore。LeasedWorkerRuntime 与 WorkerRuntime 也未阻止非普通模式注入协调grant。

限定修复：首次分配仅 exact 已prepare且mode未设的普通Run；Leased不请求非普通模式协调grant；Runtime.start在执行开始前拒绝 explore/review 的coordination上下文。不要按readOnly一概禁止，因为普通只读document-advisor与admitted successor仍需协调。

证据：snap01/logs/full-regression.log、exploration-repro.log。旧snapshot保持不可变，集中修复在显式结束冻结后应用，出snap02。用户允许按影响决定是否重跑全量；独立验收同意在仅此缺陷、精确delta不扩展的前提下，采用旧全量未变化范围＋新冻结受影响集，不能宣称snap02全量0失败。

计划受影响集：explorations、exploration-runtime、reviewer-runtime-start-rejection、independent-review、real-runtime、semantic-query、coordination-capability、host-tool-chain、architecture-review-host/service/core。再执行types、UItypes、boundaries、build和源码/构建复算。强塞grant反例使用形状完整的测试principal，保证模式屏障先于工具调用和模型请求。

修复实施已完成。原 explorations 回归在 repair-targeted-01 中通过；新增已有参与关系的 explore 反例在 repair-capability-02 中通过。负向夹具不使用普通 Work 材料入口，避免在权限屏障前因不适用材料入口退出；真实探索材料流程由 explorations 原用例覆盖。准备 snap02 冻结定向复验；旧全量及失败保留。
