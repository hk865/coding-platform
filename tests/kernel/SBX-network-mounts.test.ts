/**
 * SBX-01…08（开工裁定 §3；SBX-09 在 `R4a-frozen-public.test.ts`）：`ProcessSandbox` 的 `network`（经平台代理 socket 联网，
 * 契约 §2.4、§3.1–3.3）、`hostMounts`（§3.4）和 shell 说明（§2.5）。只经 `public-api.js`，真实 bubblewrap（没有就以
 * “环境不可用”失败，不跳过）；桩代理是本文件的 unix socket 服务器，不连外网；期望值是契约 §2.4 的字面量和手算结果。
 * 每行第一行注释是它的具名改坏。今天两个选项还不存在（Kernel 不认、照旧跑；typecheck 报未知选项）。红点和落地后为什么绿：
 * 01 `:77` 七个变量都 unset、GET fail → 设变量、挂证书、绑 socket、起转发器，GET 经桩回 ok；
 * 02 `:92` 前置的代理 GET fail → 联网了，直连宿主端口仍被新网络空间挡住、只有 lo；
 * 03 `:103` HTTP_PROXY unset → 设了代理，NO_PROXY 让沙箱自己的 127.0.0.1 服务直连；04 `:119` 第一次打印 none → 每次 execute 现读；
 * 05 `:131` 两格 GET fail → 只读、有上限两条路都带联网参数；06 `:147` 没挂上 → 按 writable 用 --bind/--ro-bind 挂上；
 * 08 `:160` 联网版说明没有 platform proxy → 随 networkConfigured 变；07 `:178` 没拒、命令跑了 → realpath 比较后抛 launch_failed。
 */
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { connect, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShellToolDefinition, ProcessSandbox, ProcessSandboxError } from "../../vendor/coding-agent/dist/public-api.js";
import { executeRL, fixedSource, makeRLWorkspace, removeRLWorkspace, requireRLCapabilities, RL_MIB, shellQuote,
  type RLWorkspace } from "../helpers/RL-resource-caps-support.js";

const PROXY = "http://127.0.0.1:3128";
const NO_PROXY = "localhost,127.0.0.1,::1";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Options = NonNullable<ConstructorParameters<typeof ProcessSandbox>[3]>;
interface World { readonly ws: RLWorkspace; readonly aux: string; readonly socket: string; readonly seen: string[] }

/** 桩代理（裁定 §3）：记每个请求的首行；`CONNECT` 回 403，其余回 200 “ok”。 */
async function stubProxy(socketPath: string): Promise<string[]> {
  const seen: string[] = [];
  const server = createServer((client) => {
    let head = "";
    client.on("error", () => undefined).on("data", function onData(chunk: Buffer) {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      client.off("data", onData);
      seen.push(head.slice(0, head.indexOf("\r\n")));
      client.end(head.startsWith("CONNECT ") ? "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"
        : "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return seen;
}

/** 工作区，加它旁边的 aux 目录（桩代理 `p.sock`、挂载源，不和工作区重叠）；要真实 bubblewrap。 */
async function world(): Promise<World> {
  const ws = await makeRLWorkspace();
  const aux = await mkdtemp(path.join(tmpdir(), "sbx-"));
  cleanups.push(() => removeRLWorkspace(ws), () => rm(aux, { recursive: true, force: true }));
  await requireRLCapabilities(ws);
  const socket = path.join(aux, "p.sock");
  return { ws, aux, socket, seen: await stubProxy(socket) };
}

async function sandboxOf({ ws }: World, options: Options): Promise<ProcessSandbox> {
  const mode = options.workspaceMode === undefined ? {} : { workspaceMode: options.workspaceMode };
  return new ProcessSandbox(await ProcessSandbox.probe(ws.root, ws.workspace, mode), ws.root, ws.workspace, options);
}

const via = (socketPath: string) => ({ current: () => ({ socketPath }) });
/** 沙箱里 python urllib 的 GET（它自己读代理变量）：打印正文，失败打印 fail。 */
const get = (url: string): string => `python3 -c ${shellQuote("import sys,urllib.request as u\n"
  + "try: print(u.urlopen(sys.argv[1], timeout=10).read().decode())\nexcept Exception: print('fail')")} ${url}`;

describe("SBX ProcessSandbox network and host mounts", () => {
  it("SBX-01 sets the proxy variables, mounts the CA certificates and goes out through the forwarder", async () => {
    // 改坏：漏设任一代理变量或 NODE_USE_ENV_PROXY；不起转发器；不绑 socket；不挂 /etc/ssl/certs
    const w = await world();
    const vars = [["HTTP_PROXY", PROXY], ["HTTPS_PROXY", PROXY], ["http_proxy", PROXY], ["https_proxy", PROXY],
      ["NO_PROXY", NO_PROXY], ["no_proxy", NO_PROXY], ["NODE_USE_ENV_PROXY", "1"]];
    const result = await executeRL(await sandboxOf(w, { network: via(w.socket) }), `for v in ${vars.map(([name]) => name).join(" ")}; `
      + `do printf '%s=%s\\n' "$v" "\${!v-unset}"; done; test -s /etc/ssl/certs/ca-certificates.crt && echo ca; `
      + `${get("http://example.test/s1")}; ${get("https://example.test/s1")} >/dev/null`);
    expect(result.stdout.text).toBe(`${vars.map(([name, value]) => `${name}=${value}\n`).join("")}ca\nok\n`);
    expect(w.seen).toEqual(["GET http://example.test/s1 HTTP/1.1", "CONNECT example.test:443 HTTP/1.1"]);
  });

  it("SBX-02 with network on, the host's local port stays unreachable and only lo exists (safety: platform local services carry tokens)", async () => {
    // 改坏：联网时去掉 --unshare-net。宿主侧先证明这个本机端口真的连得上（照 KB-03）。
    const w = await world();
    const local = createServer();
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => local.close(resolve)));
    const { port } = local.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => { const s = connect(port, "127.0.0.1", () => resolve(void s.end())).once("error", reject); });
    const result = await executeRL(await sandboxOf(w, { network: via(w.socket) }), `${get("http://example.test/s2")}; `
      + `sed 1,2d /proc/net/dev | cut -d: -f1 | tr -d ' ' | grep -vx lo; `
      + `if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}'; then printf connected; exit 0; else printf blocked; exit 4; fi`);
    expect(result.stdout.text).toBe("ok\nblocked");
    expect(result.exitCode).toBe(4);
  });

  it("SBX-03 a server started inside the command is reached directly, not through the proxy (capability)", async () => {
    // 改坏：不设 NO_PROXY/no_proxy
    const w = await world();
    const poll = "import time,urllib.request as u\nfor _ in range(100):\n"
      + "  try: print(u.urlopen('http://127.0.0.1:8765/', timeout=5).read().decode()); break\n  except OSError: time.sleep(0.05)";
    const result = await executeRL(await sandboxOf(w, { network: via(w.socket) }), `printf '%s\\n' "\${HTTP_PROXY-unset}"; `
      + `python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & python3 -c ${shellQuote(poll)}; kill $!`);
    expect(result.stdout.text).toMatch(/^http:\/\/127\.0\.0\.1:3128\n[\s\S]*Directory listing for \//);
    expect(w.seen).toEqual([]);
  });

  it("SBX-04 reads current() afresh for every command: socket A, then no network, then socket B", async () => {
    // 改坏：构造时缓存 current()；current() 回 null 时仍加联网参数
    const w = await world();
    const otherSocket = path.join(w.aux, "q.sock");
    const seenB = await stubProxy(otherSocket);
    let route: { readonly socketPath: string } | null = { socketPath: w.socket };
    const sandbox = await sandboxOf(w, { network: { current: () => route } });
    const outputs: string[] = [];
    for (const next of [null, { socketPath: otherSocket }, null]) {
      outputs.push((await executeRL(sandbox, `printf '%s\\n' "\${HTTP_PROXY-none}"; ${get("http://example.test/s4")}`)).stdout.text);
      route = next;
    }
    expect(outputs).toEqual([`${PROXY}\nok\n`, "none\nfail\n", `${PROXY}\nok\n`]);
    expect([w.seen, seenB]).toEqual([["GET http://example.test/s4 HTTP/1.1"], ["GET http://example.test/s4 HTTP/1.1"]]);
  });

  it.each([
    ["read-only", { workspaceMode: "read_only" as const }, "ok\nread-only\n", "none"],
    ["capped", { resourceCaps: fixedSource({ memoryMaxBytes: 256 * RL_MIB, tasksMax: 64 }) }, "ok\nwritten\n", "applied"],
  ])("SBX-05 the %s path goes out through the proxy too", async (_label, options, stdout, caps) => {
    // 改坏：只在读写分支加联网参数（只读格红）；#runCapped 不传 net（有上限格红）
    const w = await world();
    const result = await executeRL(await sandboxOf(w, { ...options, network: via(w.socket) }),
      `${get("http://example.test/s5")}; touch /workspace/x 2>/dev/null && echo written || echo read-only`);
    expect(result.stdout.text).toBe(stdout);
    expect(result.resourceCaps.status).toBe(caps);
  });

  it.each([
    ["read-only", (aux: string) => ({ source: `${aux}/tool`, target: `${aux}/tool`, writable: false }),
      (aux: string) => `${aux}/tool/bin/hello; touch ${aux}/tool/x 2>/dev/null && echo wrote || echo ro`, "hello-sbx\nro\n", "tool/x", null],
    ["writable", (aux: string) => ({ source: `${aux}/cache`, target: "/home/agent/.cache/sbx", writable: true }),
      () => "echo data > /home/agent/.cache/sbx/f && echo wrote", "wrote\n", "cache/f", "data\n"],
  ])("SBX-06 mounts a %s host directory", async (_label, mount, command, stdout, hostFile, content) => {
    // 改坏：只读也用 --bind（只读格红）；可写也用 --ro-bind（可写格红）；不挂（两格都红）
    const w = await world();
    await mkdir(path.join(w.aux, "tool", "bin"), { recursive: true });
    await mkdir(path.join(w.aux, "cache"));
    await writeFile(path.join(w.aux, "tool", "bin", "hello"), "#!/bin/sh\necho hello-sbx\n", { mode: 0o755 });
    const result = await executeRL(await sandboxOf(w, { hostMounts: [mount(w.aux)] }), command(w.aux));
    expect(result.stdout.text).toBe(stdout);
    expect(await readFile(path.join(w.aux, hostFile), "utf8").catch(() => null)).toBe(content);
    expect(result.effects.changedPaths).toEqual([]);
  });

  it("SBX-08 the shell description follows networkConfigured", async () => {
    // 改坏：说明写死成一种
    const ws = await makeRLWorkspace();
    cleanups.push(() => removeRLWorkspace(ws));
    const profile = await ProcessSandbox.probe(ws.root, ws.workspace);
    const variants: Options[] = [{ network: { current: () => null } }, {}];
    const [networked, plain] = variants.map((options) =>
      createShellToolDefinition(new ProcessSandbox(profile, ws.root, ws.workspace, options)).description);
    expect(networked).toContain("through the platform proxy");
    expect(networked).not.toContain("network-disabled");
    expect(plain).toContain("network-disabled");
  });
});

describe("rejects: SBX-07 a host mount overlapping the workspace (safety: it would bypass .git read-only and the protected masks)", () => {
  it.each([
    ["the workspace root", ({ ws }: World) => ws.root],
    ["a directory inside it", ({ ws }: World) => path.join(ws.root, "sub")],
    ["its parent", ({ ws }: World) => path.dirname(ws.root)],
    ["a symlink to it", ({ aux }: World) => path.join(aux, "link")],
  ])("refuses %s and does not run the command", async (_label, source) => {
    // 改坏：删掉重叠检查（四格都红）；不做 realpath、直接比字面（符号链接那格红）
    const w = await world();
    await mkdir(path.join(w.ws.root, "sub"));
    await symlink(w.ws.root, path.join(w.aux, "link"));
    const run = executeRL(await sandboxOf(w, { hostMounts: [{ source: source(w), target: "/opt/sbx", writable: true }] }), "touch /workspace/sbx-ran");
    await expect(run).rejects.toThrow(ProcessSandboxError);
    await expect(run).rejects.toMatchObject({ code: "launch_failed", message: expect.stringContaining("宿主挂载和工作区重叠") });
    await expect(access(path.join(w.ws.root, "sbx-ran"))).rejects.toThrow();
  });
});
