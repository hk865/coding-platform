# 文件目录浏览与文本快照解耦

用户普通文件树不能因binary/大文件导致text capture整体失败。复用Host已有WorkspaceSandbox.listFiles(maxEntries,{prefix,signal})，files/list只读路由；不新owner，不改Kernel，不放宽text capture或files/read。

一次有界库存DTO建议input={prefix?:string}，result={paths:string[],partial:boolean}，上限最多现有60000扫描entries，不提高。无server cursor/cache registry，UI本地每100条显示更多追加，refresh重新枚举。partial显式提示未完整列出，可用目录prefix缩小；根omit prefix。仅返回readPrefixes授权路径，原Kernel denied/symlink边界保留，ctx固定原scope，prefix/root不能越界。

目录页loading/error/empty/partial就地显示；失败保旧路径并标旧列表，不伪空；异步回包归属scope+prefix/请求代，不能串目录或覆盖刷新。sourcePage继续仅正式来源查询，不与目录枚举混用。普通open文件保持files/read。

7文件scope：workbench-tools/core-http-types/core-routes/host/main与现有MVP-workbench-tools/MVP-ui-entry测试。
Stage1仅必要接口骨架与最多2窄case：含binary/超过文本上限仍可列路径且read授权/范围成立；UI本地每100条追加不替换、固定scope/prefix。不要为测试建manager。STOP主审审核后Stage2。无模型/真实工程修改/服务变动。
