# M02 实施决定

输入：M01 工作检查点 05e0935ddda2b5d1c8e1e6d09c2d040f78d27e795fd6b1daa53b521e66fa1b33，1296 文件。它是成熟调度 seam 的实施输入，不是 M01 独立 PASS。共同收尾仍需固定完整快照。

D01：Query 使用独立 QueryRun/只读运行端口，不合并普通 Run。新增可选的版本化查询执行绑定，原样保留开始时的轮次、请求和来源。绑定随 StartQueryJob 事务落账；旧记录缺失绑定不得推断或重跑。

D02：Runtime 增加只读 inspectQuery，按完整请求指纹读取持久结果或报告本进程仍在执行。恢复只补交已持久结果；缺失/未知记录保留原始状态并在工作台明确标为需对账，不重新调用模型。原有无绑定历史输入保持可读。

D04：不能从“本进程看不到结果”推出“查询已失败”，也不能关闭另一路仍在执行的查询；未知状态作为带来源的 Runtime 观察显示，不伪造 canonical 终态。活跃或待对账记录不占用待办扫描额度，避免阻挡后来的 pending 查询。

D03：恢复复用正常答案的身份、字数、来源、陈旧性和提交检查；原始来源不以当前重新编译结果冒充。Control 受理和 Ledger 提交均校验绑定，必要的两层检查保留。

D05：只读 Runtime 的准备窗口用 exact 请求的本地 promise 合并重复调用；此 map 不授予启动权，QueryRun CAS 仍是持久前提。取消先闭合 canonical QueryJob，再通知 exact Runtime；准备中的取消不会晚启动模型，Host 关闭等待准备及执行结束。

D06：inspectQuery 读取 ArtifactVault journal 的已提交观察，不读可能尚未保存成功的可变 result。新增 exact-key read，避免每个查询复制其他运行全部 trace。历史结果保持原字节；缺失/冲突的观察不伪造成功。

D07：新取消结果明确 QueryRun.outcome=cancelled，Control 和 Ledger 对应复核。过去写成 answered 的历史记录不重写。UI 原 FixtureAnswers 更名 QueryAnswers，实际覆盖独立模型查询与测试回答；新增明确取消操作和独立的 recovery 观察。
