只读核对完成，未修改文件、运行测试或构建。下文 W/=src/core/workspace/，A/=src/core/work-graph/architecture/，T/=tests/data/。

1. **部分修复；必须改模式默认值。** 上次第1项列出的严格捕获行为已恢复：导出及关系上限（W/capture.ts:239、273）、完整来源及未解析列表（W/architecture-source.ts:87、90）。关系超量已有捕获阶段的测试（T/workspace-capture.test.ts:542），但不直接覆盖273行；完整来源有明确断言（T/S8E-A25-strict-capture.test.ts:109、112）。无需为保护分支另造不可达状态。
   
   UNSPECIFIED 1 不接受：W/architecture-source.ts:38 仍默认 `'observation'`，漏参就会静默精简。**修改思路：** mode 改必填，补齐纯函数测试调用；生产调用已显式传入（W/capture.ts:298）。

2. **已修复。** 模块层按语言状态和遍历来源数判断，不再依赖解析成功数（A/architecture-service.ts:846、847）；唯一文件失败的双后端用例保留模块并检查失败覆盖（T/S8E-file-fault-module-layer.test.ts:19、38、42）。

3. **实现已修，验收未完整。** 根集合内 noResolve、类型引用行号、所有循环分支的取消检查已改（W/typescript-light-scan.ts:253、118、399）。但 A-27 仍直调扫描器（T/S8E-A27-ts-light-scan-contract.test.ts:28、73、102），这些配置、源码和故障钩子均能走公开入口；取消也发生在后续成功文件，而非连续失败文件期间（同文件:87、89）。
   
   **必须改。修改思路：** 转入共享平台夹具，双后端检查公开结果；用可控时钟和取消回调让失败文件串实际经过让出点，断言下一文件未开始。否则不能证明任务书要求的失败路径取消。

4. **核心修复完成。** 写前与解码共用块校验（A/architecture-service.ts:896；A/architecture-record-codecs.ts:314），单项加外壳超限拒绝（A/architecture-service.ts:286）。UNSPECIFIED 2、3 可接受：超4096字符返回 invalid，单项过大返回 capacity（编解码文件:214；服务文件:891）。
   
   **建议：** A-12 手算注释漏计路径增加的2字节，节点应为164/165字节，不是162/163（T/S8E-A12-file-chunks.test.ts:93、107）；修改注释，65块结论不变。

5. **已修复。** Git 非仓库与命令错误分开，截断时按实际完整记录数报告“至少”，不再编造60,001（W/git-read.ts:229、230、278）。

6. **未清净；必须改。** 全树搜索未见其余目标旧格式读取及旧夹具引用残留，但整项 `inventory:null` 仍被接受（A/architecture-record-codecs.ts:471），新测试还把它当当前格式（T/S8E-old-format-rejection.test.ts:44、56）。当前生产者始终写对象（W/project-source-snapshot.ts:244、249、252），原注释也明确整项 null 只为旧记录（W/architecture-language-provider.ts:78）。
   
   **修改思路：** 删除整项 null 分支及相关可空类型，将测试改为对象，并断言整项 null 被拒绝。不能混同需要保留的 `reason:null`。外层版本1、显式 reason:null 均未误删（A/architecture-record-codecs.ts:503、215）；严格捕获恢复见第1项。

7. **部分修复；A-18 必须改。** A-17、A-19、A-09、A-23 已接公开入口和双后端（T/S8D-A17-ts-light-scan.test.ts:54；T/S8D-A19-ts-light-scan.test.ts:20；T/S8E-A09-scale.test.ts:33；T/S8E-A23-ignored-databases.test.ts:39、76）。
   
   UNSPECIFIED 4 是削弱断言：300条改验模块边（T/S8D-A18-ts-light-scan.test.ts:76、83），而引用与文件边分别产生（W/typescript-light-scan.ts:373、379）；文件边丢失时模块断言仍能通过。**修改思路：** 保留模块断言，再经公开文件 neighbors 逐个核对每个文件恰好指向环中的下一文件，双后端执行。

8. **生产去重已修，回报必须更正。** 存储端不再重复归一化、加载复用已有记录、服务不再二次精简，逐语言建立查找集合（A/architecture-service.ts:332、585、874；W/capture.ts:439）。
   
   回报仍用净增1,161对照新增上限1,290，宣称超量消失（.lead-ref/s8a-scale-rework1-final.md:14）；按其新增1,754计算，仍超464行。**修改思路：** 同口径说明剩余成本，不要求机械删464行。UNSPECIFIED 5 的逐项归因口径可接受，但不能替代总量说明。

8D 与 §10 暂不具备一起合入的条件。

先改完列出的几处