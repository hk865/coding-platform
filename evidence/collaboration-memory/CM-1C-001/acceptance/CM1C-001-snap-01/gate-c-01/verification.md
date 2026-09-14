# 独立验证记录

产品 cwd /mnt/d/1.project/Software/agent_platform，WSL Node 24.18.0，PATH前置 /home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin。脚本调用现有 scripts/test-wsl.sh，maxWorkers=2；测试自行 mkdtemp/隔离SQLite/临时HTTP端口，不使用用户项目数据库、不修改被验代码、不构建 dist、不重复全量或付费模型调用。

- run-independent.sh：核心架构Review、Host场景、真实service三文件28用例PASS，58.97秒，targeted.exit-code=0。
- run-baseline.sh：architecture-inspection/baseline-evolution两文件46用例PASS，10.53秒，baseline.exit-code=0。含真实Writer推进Workspace后旧MigrationGate拒绝；报告/机械两来源兼容、baseline原子守卫和旧幂等。
- verify-snapshot.py：独立实际源码文件集合/逐文件摘要/source-files/19份冻结documents；snapshot-before.json 1288文件，同输入SHA，errors=[]。结束后再次运行。
- 真实模型不由独立方重复调用；独立解析冻结real-model.json并生成model-witness.json，两后继输出2210/1956字符，均实际提及本次review ID与proposalDigest。这增加本次采用行为证据，不是项目结论正确性的验证。原始producer为明确协议替身。
- 浏览器复用完整dist service-browser-02四按钮证据，审阅实际测试入口与modify-recorded.png可见版本2仍待决；最终构建逐文件清单核对后才能确认同输入构建，浏览器不与真实provider样例混称同一次运行。

真实模型样例的角色/Work历史材料不足按输出诚实保留，不声称完成所有M迁移或模型自主发现。源码与图示只读审查见source-review.md。

全量、类型/UI类型/Module边界、构建、文档以及结束指纹待主实施者集中完成；正式Gate另见acceptance.md。