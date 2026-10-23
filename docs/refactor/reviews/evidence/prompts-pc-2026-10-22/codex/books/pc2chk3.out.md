L1：已修，两个渲染签名均使用数组类型。  
L2：已修，工具清单的类型、校验、顺序、摘要和存储要求已补齐。  
L3：已修，统一为读取结果的 `tools` 经 `texts` 传递。  
L4：已修，两种配方都必须返回 `renderMaterial`。  
C1：已修，保留缺省调用，生产调用显式传包和工具清单。  
C2：已修，声明随供应模板的 `origins` 保存、读取和检查。  
C3：已修，两个源码条件分开，阻塞绑定改为布尔值。  
C4：部分修复，逐类 owner 条件仍未写全，见问题 2。  
C5：已修，保留省略元数据、实际计费值，并明确类型和函数出口。  
C6：已修，输入、返回判定和交接顺序已明确；新增必填输入影响旧调用，见问题 1。  
C7：已修，有 basis 的 Query 不读取或伪造目标边界。  
C8：已修，allowlist 归 Q，在联合步骤统一修改。  
C9：已修，`read_source` 限于渲染测试，未增加产品权限或注入点。  
D8：已修，两个白板工具分别读取自身的嵌套参数说明。

1. **阻塞｜裁定 14、§4、§5.3：新增必填装配输入缺少旧调用的修改授权。**

   `ContextAssembler` 现有输入没有 `toolNames`、`history`（`src/core/agent-runtime/context-types.ts:60`、`:65`）。未列入 §5.3、也不命中其绑定检索条件的旧测试，直接调用时没有这些字段：`tests/work-graph/S3-role-profiles.test.ts:197`。按 v3 增加必填字段，该调用不能通过类型检查；类型检查包含测试目录（`tsconfig.json:16`）。

   已列入范围的直接调用也需要机械补参，而目前授权原因仅覆盖段序或绑定：`tests/runtime/S3-context-assembler.test.ts:840`、`tests/runtime/S4C2-assembly.test.ts:383`、`tests/helpers/WP1-units-fixture.ts:468`。

   **改书：**§5.3 明确允许上述装配调用机械补齐冻结工具清单和对应历史输入，保留原断言；将 `S3-role-profiles.test.ts` 加入清单并归 T，其余保持已有 owner。不要通过放宽生产必填接口解决。

2. **应改｜裁定 16：补全用户决定与复核工具的 owner 条件。**

   用户决定工具同时要求 `mailbox` 和 `decisionMessages`，不是仅后者（`src/core/agent-runtime/tool-group-assembly.ts:213`、`:216`）。复核／提案 Run 缺少 `unknownCallReviews` 时直接返回 `unsupported`（`src/core/agent-runtime/execution-driver.ts:485`）。v3 对重跑工具写明了 owner 门槛，对这两处仍只作分散描述或引用。

   **改书：**明确写成“用户决定工具要求 `mailbox && decisionMessages`；Work 的 `reviewPhase !== null` 要求 `unknownCallReviews`，缺失先返回 `unsupported`，存在才按 phase 加入工具名”，纳入 `finalToolNamesOf` 的拒绝分支。

§4 未发现跨组重复归属。其余新增类型和签名未发现额外阻塞；但按当前修改授权，第 1 项已使整轮无法全绿。构建、架构检查及测试均未运行。

结论：改后再核