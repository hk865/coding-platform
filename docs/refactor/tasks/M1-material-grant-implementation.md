# M1 材料授权第二阶段

已完成Astra中审，冻结接口/两份测试，现授权实现scope JSON仅3文件：grant-service.ts、grant-record-codecs.ts、material-source-provider.ts。先读 M1-material-grant-skeleton.md、reviews/next-b2-c1-middle-review-2026-09-26.md、DSH-WORKFLOW/CODE-QUALITY及实际Material authority/reader/provider/WorkspaceAccess。全部测试、共享类型、旧工程只读。Python/Node原地写，无rename/probe/扩大scope。

27条中审测试是明确红点，类型已过。fixture已改正式claim→MaterialPort.store→W1采用实际TaskInput→consumer claim。新grant/revoke生产者必须接原RecordStore/Material authority，而不是塞假grant或跳过原current校验。外层MaterialAccessGrantSnapshot@1复用原注册；新增events仅注册一次。只有Host、same project/workspace/Goal，真实Run owner和reader，拒绝ownerless/platform_operation/Query。missing reader=not_found；Query owner本批forbidden。精确Goal+Workspace pins，材料来源+owner全部实际读取，原请求重放先恢复回执，不因撤销/过期重放复活旧grant；revoke不要求当前source/Plan有效。

provider必须用原WorkspaceAccessFactory + WorkspaceSourceApplicability，两次真实观察比较，采集末尾重新open授权，核root/revision/subject/permission；每个成功open finally release，预取消0open，不存在的资源无需release。调用间合法新revision可生成新pin，不能永久绑定旧revision；同次改变要拒绝。listFiles硬上限60000不能传60001。不要重复来源算法或把绝对root误作sourceIdentity.workspace。

原报告是原报告，grant只授权读取，不能重标为当前验证证据。读取resolver与writer必须共享同一source provider，组合根由主审接线。临时unsupported codec已回退为stub，需要真实实现。已有判据缺少安全commit guards时给精确接缝建议，不能默认取消guard。

自检 check.py next-types next-architecture next-material-grants，适当回归next-material-readers；不要改测试让绿。报告真实通过/失败、注册依赖及唯一剩余。交付后停止等主审独立验收。
