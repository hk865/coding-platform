/**
 * SEC3T：不分大小写的盘上，命令经 `.git` 的 ASCII 大小写变体绕只读挂载。
 * 裁定 `.dsh-ref/drbk/next1113c-lead-rulings.md:186`：只给 `.git` 的 7 个 ASCII
 * 变体（`.GIT`、`.Git`、`.gIt`、`.giT`、`.GIt`、`.GiT`、`.gIT`）加只读挂载，
 * 读写和只读两条挂载路径都盖到；`.workbench` 变体不挂（STATUS 缺口）；Unicode
 * 变体（`.gıt`、Kelvin）不挂。R3 只在证实不分大小写的根上注册（本机未注册），
 * ext4 的 D3-1 不误伤行绿。
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessSandbox, WorkspaceSandbox } from "../../vendor/coding-agent/dist/public-api.js";
import { executeRL } from "../helpers/RL-resource-caps-support.js";
import { tempRoot } from "../helpers/observation-source-fixture.js";

const GIT_VARIANTS: readonly string[] = [".GIT", ".Git", ".gIt", ".giT", ".GIt", ".GiT", ".gIT"];
const REAL_BWRAP = process.env["CODING_AGENT_BWRAP_PATH"] ?? execFileSync("which", ["bwrap"], { encoding: "utf8" }).trim();
const SANDBOX_OPTIONS = { workspaceMode: "read_write" as const, readOnlyPaths: [".workbench"] };
const tempRoots: string[] = [];
/** D3-1 is the ext4 guard; on a case-insensitive tmpdir it cannot exist and is not registered. */
const EXT4_CASE_SENSITIVE = (() => {
  const probe = mkdtempSync(path.join(tmpdir(), "dsec3-case-ext4-probe-"));
  try {
    mkdirSync(path.join(probe, ".git"));
    return !existsSync(path.join(probe, ".GIT"));
  } finally { rmSync(probe, { recursive: true, force: true }); }
})();

afterEach(async () => { for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** R3 registers only on a verified case-insensitive root; an explicitly configured bad root throws. */
function probeCaseInsensitiveRoot(): { readonly root: string | null; readonly reason: string } {
  const configured = process.env["DSEC3_CASE_INSENSITIVE_ROOT"];
  const candidate = configured ?? "/mnt/d";
  if (!existsSync(candidate)) {
    if (configured !== undefined) throw new Error(`DSEC3_CASE_INSENSITIVE_ROOT=${configured} 不存在`);
    return { root: null, reason: `${candidate} 不存在` };
  }
  const probe = (() => {
    try { return mkdtempSync(path.join(candidate, "dsec3-case-")); } catch { return null; }
  })();
  if (probe === null) {
    if (configured !== undefined) throw new Error(`DSEC3_CASE_INSENSITIVE_ROOT=${configured} 不能建探针目录`);
    return { root: null, reason: `${candidate} 不能建探针目录` };
  }
  try {
    const git = path.join(probe, ".git");
    mkdirSync(git);
    let aliased = false;
    try {
      const [exact, folded] = [lstatSync(git), lstatSync(path.join(probe, ".GIT"))];
      aliased = exact.dev === folded.dev && exact.ino === folded.ino;
    } catch { aliased = false; }
    if (!aliased && configured !== undefined) throw new Error(`DSEC3_CASE_INSENSITIVE_ROOT=${configured} 的 .git/.GIT 不是同一个目录项`);
    return aliased ? { root: candidate, reason: "" }
      : { root: null, reason: `${candidate} 区分大小写（.git 与 .GIT 不同 dev:ino）` };
  } finally { rmSync(probe, { recursive: true, force: true }); }
}

/** Runs one real bwrap through a wrapper that records the argv bwrap received. */
async function bwrapArgv(root: string, mode: "read_only" | "read_write"): Promise<readonly string[]> {
  const workspace = await WorkspaceSandbox.create(root);
  const argvFile = path.join(root, "argv.txt");
  const wrapper = path.join(root, "bwrap-wrapper.sh");
  await writeFile(wrapper, ["#!/bin/sh", `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`, `exec ${JSON.stringify(REAL_BWRAP)} "$@"`, ""].join("\n"));
  await chmod(wrapper, 0o755);
  const sandbox = new ProcessSandbox({ available: true, version: "argv", bwrapPath: wrapper, reason: null }, root, workspace, { workspaceMode: mode, readOnlyPaths: [".workbench"] });
  await executeRL(sandbox, "true");
  return (await readFile(argvFile, "utf8")).split("\n").filter(Boolean);
}

function hasArgvTriplet(args: readonly string[], expected: readonly string[]): boolean {
  return args.some((_, index) => expected.every((token, offset) => args[index + offset] === token));
}

/** A gitfile `.git` with 7 hardlinked ASCII variants: same dev:ino on ext4, so the alias gate is real. */
async function gitfileRoot(prefix: string): Promise<string> {
  const root = await tempRoot(prefix, tempRoots);
  const git = path.join(root, ".git");
  await writeFile(git, "gitdir: /x\n");
  for (const variant of GIT_VARIANTS) await link(git, path.join(root, variant));
  await mkdir(path.join(root, ".workbench"));
  return root;
}

const caseProbe = probeCaseInsensitiveRoot();
const suiteName = caseProbe.root === null ? `DSEC3 .git 大小写变体（R3 未注册：${caseProbe.reason}）` : "DSEC3 .git 大小写变体";

describe(suiteName, () => {
  // R1 is the read-only path cell: the real classification (`#classifyProtectedPaths`
  // folds the 7 variants into the snapshot only when `.git`/`.GIT` share dev:ino), the
  // plan, and the read-only argv. A gitfile `.git` with 7 hardlinks gives the same
  // dev:ino on ext4, so the alias gate is exercised without a case-insensitive root.
  it("R1 read-only argv masks the 7 classified ASCII .git variants and no .workbench variant", async () => {
    const root = await gitfileRoot("dsec3-case-readonly-");
    const args = await bwrapArgv(root, "read_only");
    for (const name of [".git", ...GIT_VARIANTS]) {
      expect(hasArgvTriplet(args, ["--ro-bind", "/dev/null", `/workspace/${name}`]), name).toBe(true);
    }
    const workbenchTargets = args.filter((arg) => arg.startsWith("/workspace/") && path.basename(arg).toUpperCase() === ".WORKBENCH");
    expect(workbenchTargets).toEqual(["/workspace/.workbench"]);
  });

  // R2: read-write argv masks each existing non-directory variant with one
  // `--ro-bind /dev/null /workspace/<variant>` (three argv tokens). Only the
  // `.git`-is-a-file branch is exercised; the read-write directory branch on ext4 is
  // untested (UNSPECIFIED).
  it("R2 read-write argv masks every hardlinked non-directory .git variant and no .workbench variant", async () => {
    const root = await gitfileRoot("dsec3-case-argv-");
    const args = await bwrapArgv(root, "read_write");
    for (const variant of GIT_VARIANTS) {
      expect(hasArgvTriplet(args, ["--ro-bind", "/dev/null", `/workspace/${variant}`]), variant).toBe(true);
    }
    const workbenchTargets = args.filter((arg) => arg.startsWith("/workspace/") && path.basename(arg).toUpperCase() === ".WORKBENCH");
    expect(workbenchTargets).toEqual(["/workspace/.workbench"]);
  });

  // D3-1 green today (guard, not a feature row): the ext4 `.GIT` directory has a
  // different inode, so no alias is mounted and the write succeeds. After the package
  // lands, deleting `aliasesIgnoringCase` would mount `.GIT` read-only and turn this red.
  if (EXT4_CASE_SENSITIVE) {
    it("D3-1 ext4 keeps a real .GIT directory writable when .git is a different inode", async () => {
      const root = await tempRoot("dsec3-case-ext4-", tempRoots);
      await mkdir(path.join(root, ".git"));
      await mkdir(path.join(root, ".GIT"));
      await mkdir(path.join(root, ".workbench"));
      expect(lstatSync(path.join(root, ".GIT")).ino).not.toBe(lstatSync(path.join(root, ".git")).ino);
      const workspace = await WorkspaceSandbox.create(root);
      const sandbox = new ProcessSandbox({ available: true, version: "real", bwrapPath: REAL_BWRAP, reason: null }, root, workspace, SANDBOX_OPTIONS);
      const result = await executeRL(sandbox, "printf x > .GIT/ok");
      expect(result.exitCode, result.stderr.text).toBe(0);
      expect(await readFile(path.join(root, ".GIT", "ok"), "utf8")).toBe("x");
    });
  }

  // R3 red today on a case-insensitive root because `printf x > .GIT/config`
  // succeeds and rewrites the host `.git/config`. Green after the variant
  // directory is bound read-only.
  const caseRoot = caseProbe.root;
  if (caseRoot !== null) {
    it("R3 real bwrap refuses a write through .GIT and leaves .git/config unchanged", async () => {
      const root = await mkdtemp(path.join(caseRoot, "dsec3-case-r3-"));
      tempRoots.push(root);
      await mkdir(path.join(root, ".git"));
      await writeFile(path.join(root, ".git", "config"), "host-config\n");
      await mkdir(path.join(root, ".workbench"));
      const workspace = await WorkspaceSandbox.create(root);
      const sandbox = new ProcessSandbox({ available: true, version: "real", bwrapPath: REAL_BWRAP, reason: null }, root, workspace, SANDBOX_OPTIONS);
      const result = await executeRL(sandbox, "printf x > .GIT/config");
      expect(result.exitCode, result.stderr.text).not.toBe(0);
      expect(await readFile(path.join(root, ".git", "config"), "utf8")).toBe("host-config\n");
      // Mutation #7 (sec3mut): the read-write variant directory stays readable, not masked by /dev/null.
      const readBack = await executeRL(sandbox, "cat .GIT/config && cat .git/config");
      expect(readBack.exitCode, readBack.stderr.text).toBe(0);
      expect(readBack.stdout.text).toBe("host-config\nhost-config\n");
    });

    // Mutation #4 (sec3mut): the read-only plan binds the variant directory read-only (readable),
    // not as an ordinary protected directory masked by tmpfs.
    it("R3b read-only real bwrap reads .GIT/config and refuses writing it", async () => {
      const root = await mkdtemp(path.join(caseRoot, "dsec3-case-r3b-"));
      tempRoots.push(root);
      await mkdir(path.join(root, ".git"));
      await writeFile(path.join(root, ".git", "config"), "host-config\n");
      await mkdir(path.join(root, ".workbench"));
      const workspace = await WorkspaceSandbox.create(root);
      const sandbox = new ProcessSandbox({ available: true, version: "real", bwrapPath: REAL_BWRAP, reason: null }, root, workspace, { ...SANDBOX_OPTIONS, workspaceMode: "read_only" });
      const readBack = await executeRL(sandbox, "cat .GIT/config && cat .git/config");
      expect(readBack.exitCode, readBack.stderr.text).toBe(0);
      expect(readBack.stdout.text).toBe("host-config\nhost-config\n");
      const write = await executeRL(sandbox, "printf x > .GIT/config");
      expect(write.exitCode, write.stderr.text).not.toBe(0);
      expect(await readFile(path.join(root, ".git", "config"), "utf8")).toBe("host-config\n");
    });
  }
});
