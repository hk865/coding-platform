# 010 命令怎么联网：沙箱不开网卡，只绑进 Host 代理的 socket；沙箱里的转发器用 Host 自己的 node

状态：采用（SBX 写 Kernel 选项；NET-B 写代理、拒地址、记主机和接线）
日期：2026-11-13

## 背景和约束

- 121-112：命令联网公网全开；本机和内网不通；每个 Run 记连过的主机。白名单、提权卡以后再说。
- 硬线（agent-permissions-v2 裁定第 1 条）：沙箱碰不到平台本机服务。平台网页默认只绑 127.0.0.1，带每个 Host 随机生成的令牌（`server.ts:208`、`:224`、`:236-240`，`host.ts:627`）；模型和搜索密钥不进沙箱。
- 今天的 Kernel 沙箱用 `--unshare-net`：新网络空间里只有沙箱自己的 lo。钉这一条的格（`K-readonly-sandbox.test.ts` KB-03、`RL-12-15-conditions.test.ts` RL-14）守的就是上一条。
- 不改恢复约束：每个 Run 的 socket 路径都不同，进了恢复约束，每次恢复都会是 `conflict`（lead 裁定 SBX Q3）。
- 拒地址要按解析出的 IP 判，而且连的就是查过的那个 IP（防 DNS rebinding）。这只能在一个由 Host 掌握的地方做。

## 选项

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| **A. 不开网卡，只绑代理 socket（选）** | 保留 `--unshare-net`；Host 的 HTTP 代理挂在 unix socket 上，绑进沙箱；沙箱里一个小转发器在 127.0.0.1:3128 监听、每个连接接到那个 socket；设 `HTTP(S)_PROXY`、`NO_PROXY`、`NODE_USE_ENV_PROXY` | 出口只有一个，拒和记都在 Host 的代理里；本机端口直连照旧不通，KB-03/RL-14 原样成立；沙箱里自己起的服务照样直连 | 只有走 HTTP 代理的工具能联网：ssh、`git@` 地址、裸 TCP 不行（写进 shell 说明）；每条联网命令多起一个进程 |
| B. 共享 Host 网络（去掉 `--unshare-net`）再在代理外加防火墙 | 沙箱用 Host 的网卡，靠 nftables 或 seccomp 拦本机和内网 | 所有协议都通 | 本机端口直连要靠另一层拦；规则要 root 或额外权限，按发行版不同；硬线从“没有路”变成“有路但拦着” |
| C. slirp4netns / pasta 给沙箱一张用户态网卡 | 每条命令起一个用户态网络栈，按目的地址过滤 | 所有协议都通，不要 root | 多一个外部依赖；过滤规则要自己维护，DNS rebinding 要另做；不是每台机器都有 |

## 转发器用什么

| 选项 | 好处 | 坏处 |
|---|---|---|
| **Host 自己的 node（`process.execPath` 只读绑进去，选）** | 一定在（Host 就是它）；没有“没装就不联网”的后备分支 | 每条联网命令多约 40 MB 内存、几个线程；实测每条命令多约 80 毫秒（不联网 17 毫秒，联网 98 毫秒，WSL，5 次平均） |
| `/usr/bin/python3`（计划原文） | 更轻 | 宿主可能没有；没有时要一个公开路径造不出、测不到的后备分支 |

## 决定

选 A + Host 的 node。

- 转发器在进程替换里再放后台：命令里不带参数的 `wait` 不会等它（实测：直接放进程替换时，bash 5.2 的 `wait` 会一直等转发器）。命令结束时 bwrap 的 pid 空间整个结束，转发器跟着结束。
- 起跑段最多等 5 秒转发器说 `r`；没等到，stderr 写一句“这条命令没有网络”，命令照跑（风险可逆，提示不拒，121-111）。
- 不挂 `/etc/resolv.conf`：代理解析主机名，工具发的是绝对 URI 或 `CONNECT`。
- 联网和宿主挂载都不进 `effectiveOptions`，所以不进恢复约束。它们不放宽工作区、`.git`、受保护路径或密钥：挂载和工作区重叠就不跑。

## 代价和以后

- 不走代理变量的工具没有网（ssh、`git@`、自己开 socket 的程序）。要的话以后再加别的出口，仍然经 Host。
- Node 的 `fetch` 在 `NODE_USE_ENV_PROXY=1` 下，`http://` 地址也走 `CONNECT host:80`（实测），所以 NET-B 的代理对 80 端口的 `CONNECT` 也要放行。
- shell 说明随 `networkConfigured` 变，而说明在 `enabledToolSchemaDigest` 里（`composition-root.ts`、`resume-composition.ts` 的配置快照），恢复时整份配置快照要和记录相同。所以带 shell 的 Run 开始和恢复时，“给没给 `network`”必须一样（实测：开始没给、恢复给了是 `conflict`；只加 `hostMounts` 不影响）。NET-B 对带 shell 的 Run 一律给 `network`，要关就让 `current()` 回 null。
- 工作区里自带的凭据（`.git/config` 远端地址里的令牌、`.npmrc`、`.pypirc`、`.netrc`），联网后命令能用到。lead 裁定 SBX Q4 取“接受、记下”，PRODUCT 照实写。
