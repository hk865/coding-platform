# Host 真实目录与模型设置后端

当前用户要求类似 Codex/DSH 的多项目、多工作区、真实目录选择和模型配置。共享只读 DTO 为 `src/app/host-settings-types.ts`；不得改 DTO/UI，不创建 Agent 工具或新领域 owner。此任务由当前 dirty 根新 snapshot 两阶段 DSH 完成。

## 固定契约与范围

全部 `/api/real/settings/` suffix 均 POST，body 为 SettingsRoutes 对应 input，返回 SettingsResponse；snapshot 也 POST。保持现有 token/same-origin，设置只属于 Host 用户。目录浏览服务器实际目录，canonical realpath/stat，含空格/非 ASCII；不使用浏览器上传代替挂载。打开目录不写目标工程。省略 projectId 新项目，指定必须已有 Host projectId 并在该项目追加 workspace，canonical 根+目标 project 去重，不覆盖任何旧根。复用原 Project/Workspace owner 登记。新 scope 动态进入 byScope、source/tool roots、bootstrap/allowedScopes、KernelStore、query profile/workflow，不关停 Host。

配置保存 SQLite 目录下私有 host-settings 或显式 settingsDirectory；内存无配置可 unsupported。原子写文件 0600，默认不落源码目录。模型 catalog 支持现有真正 DeepSeek Chat/OpenAI Responses provider，每 workspace 独立 modelId。key 只写、不响应、不日志、不 localStorage、不 repo、不改 process.env，保留 env SecretSource；重开恢复模型和 workspace 选择。空/省略 key 保留原 key。无模型仍能打开目录与读文件。

新 scope 使用明确内建 local-workbench legacy role/template（guidance SHA-256 为真）和 platform-work skill；只授予现有工具。write/shell 随 DTO，commands 必须 writeAllowed。不复制旧 scope RoleSpec/路径/权限；不捏造 completion policy/checks，通过既有产品入口处理。

模型变更创建不可变 RuntimeHostBindings 新版。Host delegate 首次 resolve 按完整 RunRef/QueryRunRef 固定 resolver，以后旧 execution（包括 prepare 后未 start）仍走原 resolver/client/credential 快照；新 ref 才使用新版。不能全局替换使原 Run 后续授权失败，不能懒加载新 key 偷换原配置。保留原身份/授权校验。无需新持久 execution owner，复用已有运行事实与 Host 装配职责。

## Stage 1：接口与必要验收后 STOP

只写最小类型/函数接口与可编译 unsupported/未实现骨架、真实 owner/Host 验收测试。不要提前完整实现。测试固定：临时目录含空格/非 ASCII、重复/无效路径；同 project 两 workspace 与另一 project 隔离；同 token 新 scope 正式文件读；无 token 拒绝；保存/重开模型和选择、响应无 key；controlled provider 下 old Work/Query resolve→切换→old 仍旧/new ref 新模型（含同 catalog key 更新快照）。不得使用真实模型/真实凭据/三个候选工程。复用现有 fixtures，不自建第二 owner。Stage1 测试可因骨架失败，但必须真实覆盖，不用空结果假正例。

范围见相邻 scope JSON。若缺必要修改文件，先报告并 STOP 请求主审扩 scope，不绕过。新增 API 只走共享 DTO。Stage1 完成列接口、测试、明确后续实现接缝，STOP 等主审冻结，不自行 Stage2。

验证只相关 tests/types/build。Node24，vitest --configLoader native --no-cache --maxWorkers=1；构建到 /tmp/dsh-output，勿写 readonly node_modules/dist。父目录只读挂载，使用 Python 原位写文件，避免 edit 工具 rename EROFS。不得更改 scope 外文件、生成新管理器/调度框架、修改真实项目、输出请求/key/私有推理、导入根或提交推送。
