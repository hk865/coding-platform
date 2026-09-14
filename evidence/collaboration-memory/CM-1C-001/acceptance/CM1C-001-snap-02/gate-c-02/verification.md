# 命令与环境

WSL产品根 /mnt/d/1.project/Software/agent_platform，Node24.18.0 PATH见run-independent.sh，测试使用隔离数据库/端口，无用户工作数据写入。run-independent.sh退出0，5文件30例，105.49s。verify-snapshot.py起止退出0，1289文件/19文档均匹配；verify-delta.py退出0，八文件修复精确；verify-build.py退出0，666文件和全部结果日志校验。未重复构建或全量。集中11文件78例及新浏览器4例、旧全量未变范围的复用理由详见acceptance.md。
