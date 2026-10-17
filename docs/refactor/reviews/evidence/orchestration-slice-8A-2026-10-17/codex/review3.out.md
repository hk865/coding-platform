只读核对完成；未修改文件、未运行测试或构建。以下“旧版会失败”均为静态推演。

路径缩写：`W=src/core/workspace`，`A=src/core/work-graph/architecture`，`V=src/core/work-graph/views`，`T=tests/work-graph`，`F=T/S8A-file-layer.test.ts`。

1. **部分完成：配置跳过后的降级。** NUL 配置案例已修：保留文件、清空模块输入并补配置失败 issue（`W/capture.ts:565`、`:567`、`:340`）。回归 `F:556` 在旧版会因捕获被拒而失败。另有下述容量分支缺口。
2. **是：并列路径的失败归属。** 全部并列模块均进入未知集合，仍排除 `other`（`A/formal-comparison.ts:132`、`:137`）。回归 `T/S8A-formal-comparison.test.ts:378` 在旧版得到 `proven`，不符合预期 `unknown`。
3. **是：搜索根目录。** 复用全部模块语义（`V/graph-context-reader.ts:1595`）。回归 `T/S3-graph-context.test.ts:1219` 在旧版漏掉第二个模块。
4. **是：文件锚点先判归属。** 全 mappings 参与判断，再过滤没有节点的归属者（`A/graph-index.ts:103`、`:108`）。回归 `T/S8A-root-path.test.ts:174` 在旧版返回 A，而非空数组。
5. **部分完成：收窄授权。** 公共加载器已核对 issue 路径（`A/architecture-service.ts:600`）；回归 `F:611` 在旧版三个入口仍返回 ready，断言会失败。但拒绝原因仍泄露路径，见下。
6. **是：公共分页助手。** 已统一加载、旧记录、覆盖组装和异常处理（`A/architecture-service.ts:645`）。既有分页、游标及旧记录用例见 `F:187`、`:244`、`:300`。这是保持行为的提取，撤回提取不应导致行为测试失败；不应人为补一个“必须失败”的测试。

**必须改：首轮分析失败没有贯穿后续处理。** 首轮使用 `maxQueryResults`，异常被吞后清空 sources（`W/capture.ts:553`、`:560`、`:567`）；文件提供者却用更高上限重新分析（`W/architecture-language-provider.ts:80`、`:103`）。第二轮成功后仍进入模块映射（`A/architecture-service.ts:745`），空 sources 导致整次观测返回 invalid（`W/architecture-source.ts:32`；`W/capture.ts:245`）。  
**修改思路：** 保存并传递首轮失败状态及原因，统一生成失败覆盖和空模块层。补两源文件、三条 import、`maxQueryResults=2`、根 mapping 的回归；当前实现会失败。

**必须改：拒绝响应仍暴露撤权路径。** 新增拒绝原因直接拼入 `issue.path`，并原样返回（`A/architecture-service.ts:602`、`:94`、`:648`），所以仍能获知 `private/bad.ts`。现有测试只验状态和错误码（`F:611`）。  
**修改思路：** 使用不含受限路径的通用原因；三个入口均断言完整响应不含该路径。这条断言在当前实现会失败。

两个 UNSPECIFIED 均可接受：

- **`projectConfiguration:null`：接受。** 表示没有成功解析的配置（`W/capture.ts:585`），请求路径仍保留并用于失败 issue（`:641`、`:342`）；符合非空配置须有冻结文件的约束（`A/architecture-record-codecs.ts:415`），无需放宽 codec。
- **callback 不带 `captureRef/languages`：接受。** 使用现有分页数据类型（`A/file-graph-index.ts:19`），由助手统一补齐（`A/architecture-service.ts:655`），职责清楚。

先改完列出的几处