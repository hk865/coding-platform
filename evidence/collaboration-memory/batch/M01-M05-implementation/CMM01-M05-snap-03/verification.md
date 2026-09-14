# M01–M05 snap-03 验证

固定源码1319文件条目，SHA256 4064c26af78bf34b361623dab13338e8f3296708384129dff6b7577b2b85fb1f。对snap-02为1新增测试、6处修改；唯一生产行为变化为Host关闭生命周期，另有2README、1注释及2旧夹具适配。精确差分见source-diff-from-snap02.json。

M-AC-03已实施：拒绝新的HTTP受理，完整handler及response先排空（含workspace/settings），再关服务及清理未发请求的残留连接；close共享Promise。空连接原反例由false变true。新真实Host对照同时证明已发送headers但尚未发送body的请求可在关闭开始后提交并在重启后读取持久目标。未完成上传的已受理请求仍需按原HTTP超时/断连语义结束，不承诺强行截断任意上传。

repair-02：类型0诊断、6文件12例通过、新构建成功。稳定产物复跑 affected-stable.sh：完整tests/app、memory/query-input及两个旧失败测试，39文件183例全部通过。ui-regression.sh：31通过、1条件跳过。类型0、边界issues=[]、文档13/13；新构建成功。独立结论见acceptance/acceptance.md。

回归适用性：snap-02完整全量334文件，330通过/2失败/2跳过；2211通过/3失败/5跳过。三处失败分别是旧Handoff选择窗口断言两存储、旧夹具在消费者建Work后另bind，已迁移且保留隔离、退避及真实复用/link断言。本次复用snap-02未变化测试范围，加Host完整受影响集和浏览器，不宣称snap-03重新跑了全仓全量或覆盖I01–I04。

模型端为显式协议替身/本地HTTP服务；真实Host、SQLite/Vault、内核及工具、浏览器实际执行。未对用户外部项目新增真实模型质量或图像能力结论。旧FAIL及跳过保留。

## 验证运行干扰与稳定产物复跑

第一轮 affected 与 UI 内核构建重叠，20文件77失败/105通过。完整日志中38次出现 createEditToolDefinition is not a function；Query明示内核初始化失败，普通Run没有模型trace即退出。后启动的独立单例与新构建UI通过。原失败不能改写或仅凭重跑忽略；本轮采用停止全部构建、冻结685构建文件（0dd6cf0912a57b0569315aaf4c883713f6ce3ebe9918f62096809b3b43acd9b2）、新进程完整受影响集复跑，并在结束复算产物。此时源码无改动。

UI最终31通过/1按原配置跳过（MEMORY_MODEL_STUB未开启的三用途专用夹具）；原失败的公开经验重启7.3秒通过。默认全量另有C1_BROWSER四例及C1_REAL_MODEL一例跳过，原上游证据保留，不把本次替身验证说成真实模型质量。


## 最终复算

稳定运行前后685构建文件，SHA256 0dd6cf0912a57b0569315aaf4c883713f6ce3ebe9918f62096809b3b43acd9b2一致；源码1319条目4064c26af78bf34b361623dab13338e8f3296708384129dff6b7577b2b85fb1f一致，end-source-diff为空。独立方分别复算确认。未把77项受构建干扰的旧失败删除，也未把本轮描述成全仓重新全量通过。


补充格式检查：git-diff-check.log 报告5处文件末尾多余空行，无尾随内容空格；保留已独立验收的源码字节，未为格式提示改写快照。它不计作已通过的类型/边界/行为检查。最终文档状态更新后源码差分仍为空。
