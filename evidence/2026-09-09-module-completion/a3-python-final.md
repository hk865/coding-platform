# MC-A3-PY 有限收尾证据

本记录对应 2026-09-09 收尾时的最终文件；不是阶段 A 或全产品完成证明。原 11/11 结果之后新增的分析器摘要与容量检查已重新验证。收尾只增加对应测试断言，没有扩展实现能力。

## 最终执行

每条命令的 Windows workdir 为 `D:\1.project\Software\agent_platform`，WSL 为已配置 Ubuntu-24.04；复用本地 Jedi 0.19.2 / Parso 0.8.4 隔离压缩包，没有安装依赖或调用模型。

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /mnt/d/1.project/Software/agent_platform && bash scripts/test-wsl.sh tests/data/python-source-index.test.ts > evidence/2026-09-09-module-completion/a3-python-tests-final.log 2>&1'
wsl.exe -d Ubuntu-24.04 -- bash -lc 'cd /mnt/d/1.project/Software/agent_platform && node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit > evidence/2026-09-09-module-completion/a3-python-types-final.log 2>&1'
```

- 局部测试：1 文件、12 项通过，46.79 秒；[原日志](a3-python-tests-final.log)。实际调用 Python `-I` 与 Jedi，在权限过滤的临时源码副本上分析，并使用真实 WorkspaceSandbox 文件读接口。
- 全库类型检查：失败，2 处均在票外 `tests/control/workspace-registration.test.ts:28–29`，`h.reopen` / `h.close` 为 unknown；Python 文件未报告类型错误。没有修改票外代码，也不把该命令报告为通过。[原日志](a3-python-types-final.log)
- 最终文件及依赖 SHA-256：[机器可读清单](a3-python-final-sha256.json)。清单写入后代码没有再修改。

## 已验证范围

- 普通包、src 命名空间布局、嵌套项目；pyrightconfig.json、pyproject.toml 的 Pyright/setuptools 配置、setup.cfg 的导入根与纯 Python 工作区依赖。
- 跨文件定义、别名引用、导入、静态调用候选；未执行项目 Python、setup.py 或构建后端。空 __init__.py 返回明确 module_file 文件锚点，锚点不与同位置声明合并。
- 源码修改、删除、配置、依赖正文、依赖清单和宿主 commit 身份变化使旧 snapshot 失效；相同 snapshot 的查询结果复用且不受调用方修改返回值影响。
- AST UTF-8 字节位置、Jedi Unicode 码点与编辑器一基 UTF-16 列的转换，包括中文和 emoji；拒绝拆开代理对的输入位置。
- 越界/拒绝配置根、不完整清单及读取中变化；即使 Adapter 忽略 maxBytes，实际超过 2 MiB 的单文件仍被拒绝。
- 输出的 analyzer 脚本、依赖 zip 和 manifest 摘要与磁盘真实字节一致，均进入 snapshot；每次 capture 校验 zip 摘要。未对安装目录进行并发篡改或缺失文件故障注入。

## 能力与证据边界

- 配置是有明确范围的数据解释器，不是完整 Pyright/打包环境实现。Pyright extends、executionEnvironments、venv/venvPath、typeshedPath、Python 版本/平台切换及具名 setuptools package-dir 重映射明确 unsupported；pyrightconfig.json 使用严格 JSON。include/exclude/ignore 不改变可读源码清单，coverage 明示该差异。
- 仅分析可读 Workspace 中的 .py/.pyi；不安装依赖、不发现外部环境、不执行 .pth、原生扩展和项目动态元数据。动态调用只能给静态候选或 unknown，不能声称完整运行时调用图。
- 增量能力是按完整内容摘要失效与查询结果复用；变更后重启隔离分析器，没有持久语言服务或多文件原子快照保证。
- 测试源码是临时真实文件夹具；commit 身份由测试宿主控制。没有真实模型、大型仓库性能、原生 Windows Python、浏览器或全产品链路验收。

配置字段依据：[Pyright 官方配置](https://github.com/microsoft/pyright/blob/main/docs/configuration.md)、[setuptools 包发现](https://setuptools.pypa.io/en/stable/userguide/package_discovery.html)、[setuptools setup.cfg](https://setuptools.pypa.io/en/latest/userguide/declarative_config.html)。
