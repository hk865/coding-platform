# CM-1C-001 集中实现进度（未冻结）

root 唯一源码 writer。用户 2026-09-13 要求继续 1C；已上传的产品基线为 ce043a650ecfabd72c55f02695204d58dd9c8b64。以下均为新工作区增量，不继承 Gate B。

已接报告工具、精确提案/修改、人类四分支、全 Work 集事务校验、投递与接续、当前决定正文、实际调用许可/证据、浏览器决定卡片及 Host 触发。普通 GUI 首次参与关系分配已补齐并验证。源码修改即将停止，独立 Gate C 尚未判断。

## 实际验证

- host-08.log：23 用例通过。四种选择；SQLite 决定后重启、完整四个既存 Work（其中两个受影响、两个通知）；实际 coding-agent 内核与 Host 工具、当前材料、捕获 ModelRequest 和账本调用证据；同 key 影响集变化拒绝；canonical wait 省略 Delivery 双层拒绝；旧事件页/新运行事实混合时重读。投递后、绑定前/后异常注入，一个 Work 失败保留原因，不让另一个 Work 重复启动。异常注入是抛错与正常关闭重开，不冒充系统强杀。
- browser-03.log：四分支真实浏览器点击通过；浏览器生产组件、真实 Entry/Control/SQLite，Vite 测试 HTTP transport；不是完整 Node server 的浏览器端到端。browser/ 下有点击前后八张截图，已查看接受后的图。
- real-model-02.log/json：现有 DeepSeek deepseek-flash 配置下两个后继真实响应 completed；原始请求、分片输出、完整影响集和事件保留。报告生产者仍为标明的确定性协议替身，源项目为空隔离目录；不证明模型自动发现真实项目冲突或架构方案正确。
- real-model-01.json 是失效实验：漏传 client.stream options，只有调用尝试而没有响应；responses 为空。不得计作真实响应成功。后续测试补上非空响应与 completed 的断言，02 才是可用样例。
- types-07.log 与 ui-types-02.log：前后端类型通过。其后补测试类型时发现真实 client.stream 第二参数，已修，待下一次集中类型确认。
- boundary-02.json：模块边界 issues=[]。定向 coordination 扩大检查仍在执行；未跑本票全量。

## 已知限制与待办

完整集固定于人看到的工作区/版本；后续新 Work 不追溯加入历史决定。容量超界明确不可读，不截断。提案入口目前修改说明，保留已有结构化约束/来源，不隐式编辑依赖规则。接受仍需已有正式迁移/激活守卫。B 偏好维护未成为决定授权来源。

继续补生产初次分配接线、审查问题、文档与文件清单；计划修改清空后冻结，再集中全量回归及独立 Gate C。


## 集中实现收口

service-03：28/28 通过。首次分配、不接管历史、篡改拒绝、三路同时 drive 只产生两个正式 admission/两个有效后继；跨工作区版本的修改拒绝，修改不得降级受影响集合。service-browser-02：完整 pnpm build 产物的 Node server 与工作台四种点击 4/4 通过，含自动回流、当前模型请求、偏好不改事实/写权限和重启重放；browser-service/ 八图，已目视接受结果。service-browser-01 失败是测试错误地运行源码 server 的旧 UI 产物，已换用真实 dist server，不改产品路径绕过。

类型 types-13、UI ui-types-04、边界 boundary-03、文档 docs-02 通过。最后源码仅增加服务浏览器测试对真实构建的选择，冻结检查将再次执行类型/构建及集中全量。旧报告来源过期时必须重报；不以修改描述刷新旧来源。实际模型样例的范围仍如上。
