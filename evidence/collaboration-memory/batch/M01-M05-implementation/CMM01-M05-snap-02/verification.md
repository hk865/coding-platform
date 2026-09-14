# M01–M05 snap-02 验证

源码已冻结：1318 文件条目，SHA256 ddd635fab8a354513a4b203946003a2c82cae8185e0768dc3233f22fcf17cff6。相对 snap-01 三个新增文件、两个修改文件，无删除。source-snapshot.json、source-diff-from-snap01.json 和 file-list.md 可逐项复核。

修复前集中定向20文件83例通过；repair-01/targeted-02.log 新修复4文件12例通过。核心 types-03 无诊断，UI类型、边界 issues=[]、文档13/13通过。旧类型失败和 snap-01 独立 FAIL 保留。

全量回归及全套浏览器正在运行；尚未形成 PASS。运行入口 full-regression.sh、ui-regression.sh。浏览器使用新构建、独立 fixture 目录与端口4495，显式 bubblewrap 路径，未读取用户密钥。

独立逐票结论待 acceptance/acceptance.md。测试使用真实宿主/SQLite/Vault/内核，模型为协议替身，不代表外部项目效果或 I01–I04 完成。
