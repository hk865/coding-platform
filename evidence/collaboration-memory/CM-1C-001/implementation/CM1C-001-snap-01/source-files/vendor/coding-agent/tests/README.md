# Tests

测试目录按被验证的架构边界分层，而不是按开发阶段堆叠：

| 目录            | 验证对象                                             |
| --------------- | ---------------------------------------------------- |
| `unit/`         | Context、模型流、配置、Web 投影等局部纯逻辑          |
| `contract/`     | Core schema/Port 与 Fake、真实 Adapter 的共同语义    |
| `integration/`  | Runtime、Tools、Storage、Composition、Web 的模块组合 |
| `e2e/`          | CLI 子进程、跨进程恢复和真实 bubblewrap              |
| `architecture/` | 静态依赖方向、内部导入解析与循环                     |
| `scenarios/`    | 真实文件任务、隔离 workspace 和业务验收器            |
| `review/`       | 独立回归与评审发现的固定复现                         |
| `smoke/`        | 最小工程入口                                         |

`fakes/`、`helpers/` 和 `fixtures/`
是测试基础设施，不属于生产依赖。默认测试不得访问真实账号或用户 workspace；需要外部能力的用例必须显式门禁。
