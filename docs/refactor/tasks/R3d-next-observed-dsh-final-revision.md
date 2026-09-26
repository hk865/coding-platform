继续同一 R3d Session。原四个生产文件写范围不变，测试和接口只读。主审已独立复现新增 30 项中的 4 项失败，结果见刷新后的 R3d-observed-boundaries.test.ts。修复以下两点，保留其他已通过行为。

1. 映射路径语义以现有 next/src/core/workspace/architecture-source.ts 的 mapArchitectureSource 为准。node.path 是 mapping.paths[0] 的代表路径，可以是目录，也可以是不存在的首路径；只要该 mapping 的其他路径匹配实际 sources，就合法产生节点。codec 不能要求 node.path 本身覆盖文件。应按 kind:id 对应明确 mapping，核对节点身份和代表路径，并确认至少一个真实 frozen source member 被该 mapping 的任一路径匹配。保持删除 Alpha 唯一源文件的损坏正文反例拒绝；不要把配置文件当 source member。现行权限核验针对真实 frozen files 与实际配置输入，目录或不存在的代表路径不是额外文件权限。真实 alpha 文件被撤权仍必须拒绝。graph-index 的多路径 anchor 保持现有规范。此处是主审对原先过宽“所有 mapping 路径鉴权”要求的澄清，不能改 WorkspaceTools 的语义。
2. releaseCaptureQuietly 使用同一调用身份和 workspace 范围，但释放这一清理操作必须使用 fresh non-aborted signal。当前用已 abort 的 ctx.signal 导致真实 registry 不释放，连续取消超过 retained 上限后正常捕获也失败。不能把正常捕获/提交信号换掉，不能为了释放绕过身份/权限。finally 清理及原始错误结果均保留。

先阅读相关现有 WorkspaceTools 实现和新测试，再就地修改允许文件。执行 next-observed（3 文件 / 30 项）、next-types、next-architecture。不得修改测试，不新增抽象层、不恢复全局 ledger horizon。最后报告实测结果和改动，不自行宣布主审验收通过。
