# R2e.2 Git 实现独审返修

2026-09-26，沿 `session-ab2de93d-ac91-4e37-8ca4-eaed4f88f4c4` 继续第二阶段；唯一可写仍为原 scope 的 `coding-platform/next/src/core/workspace/git-read.ts`。其余生产、测试、harness、文档只读。修复后 STOP，不扩 Git 产品范围。

原实现独立 12 文件 / 111 项与 types 通过，但发现三个公开路径可达问题，现冻结最小修复：

1. tree 路径 UTF-8 解码必须保留开头 U+FEFF：`TextDecoder('utf-8', {fatal:true,ignoreBOM:true})`。这是文件名身份，正文的 BOM 展示语义保持现有约定。
2. blob 读取非零退出为 unavailable，不是 capacity。只有真实 stdout 超限/字节长度超限才为 capacity；超限触发 kill 的非零退出需保持真正超限分类，按已观察原因区分。未知机器错误不猜 not_found，不新增 GC/对象损坏矩阵。
3. acquireRootHandle await 期间取消后，不得再启动 Git；真实 handle 仍在 finally 关闭。进程入口在 spawn 之前检查 signal.aborted，监听安装后也补已取消检查，沿已有取消结果/真实 child close 路径，不建管理器或生产测试注入口。

主审只读刷新 data test SHA `24b2406f09a4f862b506cd3a81bf4a5218b36fa749bd3f76ab45e3accf63ad17`。已有历史用例补 BOM 文件名与普通同名文件的不同正文和比较；只新增一例实际 FileHandle 取得后尚未返回的取消门闩。独立 red 为 3 失败 / 11 通过：两已有 SHA 格式用例因合法 BOM 路径 not_found，新增取消用例捕获 1 次真实 Git spawn；门闩及真实句柄清理完成。不得弱化测试或用 beforeOpen 代替真实窗口。

当前宿主 Git 是 Ubuntu 补丁版 2.43.0-1ubuntu7.3，已含 GIT_NO_LAZY_FETCH backport；现环境控制保留。不得改成当前二进制拒绝的 --no-lazy-fetch CLI，也不声称已覆盖真实 partial/promisor fetch 夹具。根句柄与 Git 顶层 dev/ino 身份核对、literal pathspec 和固定 -- 参数均有实际用途，保持。

运行原固定 next-git-read、next-git-read-neighbors、next-runtime-execution、next-types、next-architecture，报告真实结果与唯一文件 hash 后 STOP。无全量 Store/Kernel 矩阵。
