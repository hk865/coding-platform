#!/usr/bin/env node
/**
 * 源码快照指纹（可复算）——本仓统一的固定源码证据入口。
 *
 * 算法正文在文档根 dev_docs/planning/active/collaboration-memory/BASELINE.md 第 5 节，
 * 这里只实现它，不再各自复制一份：
 *   1. 取 `git ls-files -z` 与 `git ls-files --others --exclude-standard -z` 的并集，按路径排序；
 *   2. 包含 src/、tests/、scripts/、vendor/coding-agent/ 下文件，排除路径中的
 *      node_modules / dist / coverage / .local / .git；另含根目录 json|yaml|yml|mjs|ts
 *      与 .gitignore / .gitattributes；
 *   3. 每项用 `path + NUL + 原始文件字节 SHA-256 + LF`；删除的文件以字面量 `deleted` 代替哈希；
 *      对拼接结果取 SHA-256 作为源码指纹；同时输出逐文件哈希，使快照可**逐文件**核对；
 *   4. 一并记录 HEAD、分支、工作树条目数、工具版本与生成时间。
 *
 * 用法：
 *   node scripts/source-snapshot.mjs                       # 打印 JSON 到 stdout
 *   node scripts/source-snapshot.mjs --out <path>          # 写入文件
 *   node scripts/source-snapshot.mjs --diff <old.json>     # 与旧快照逐文件比较，列出新增/删除/变化
 *
 * 只读取源码与 Git；仅 --out 写指定证据文件，不修改源文件或提交 Git。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ALGORITHM = "BASELINE.md §5：path + NUL + sha256(file bytes) + LF；排除 node_modules/dist/coverage/.local/.git";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
}

function collectFiles(root) {
  const tracked = git(root, ["ls-files", "-z"]).split("\u0000").filter(Boolean);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\u0000").filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort().filter((f) => {
    if (/(^|\/)(node_modules|dist|coverage|\.local|\.git)(\/|$)/.test(f)) return false;
    if (/^evidence\//.test(f)) return false;
    if (/^(src|tests|scripts|vendor\/coding-agent)\//.test(f)) return true;
    return /^[^/]+\.(json|ya?ml|mjs|ts)$/.test(f) || f === ".gitignore" || f === ".gitattributes";
  });
}

function computeSnapshot(root) {
  const files = collectFiles(root);
  const fold = createHash("sha256");
  const perFile = {};
  for (const f of files) {
    const abs = path.join(root, f);
    const fileHash = existsSync(abs)
      ? createHash("sha256").update(readFileSync(abs)).digest("hex")
      : "deleted";
    perFile[f] = fileHash;
    fold.update(f);
    fold.update(Buffer.from([0]));
    fold.update(fileHash);
    fold.update("\n");
  }
  const status = git(root, ["status", "--porcelain"]);
  return {
    generatedBy: "scripts/source-snapshot.mjs",
    capturedAt: new Date().toISOString(),
    productRoot: root,
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    toolVersions: { node: process.version, git: git(root, ["--version"]).trim(), platform: process.platform },
    sourceFingerprintAlgorithm: ALGORITHM,
    sourceFileCount: files.length,
    sourceFingerprintSha256: fold.digest("hex"),
    workingTreeEntryCount: status.split("\n").filter(Boolean).length,
    /** 逐文件哈希：让独立验收可以核对任意单个文件，而不只信一个总指纹。 */
    fileHashes: perFile,
  };
}

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const diffIndex = argv.indexOf("--diff");
const root = process.cwd();
const snapshot = computeSnapshot(root);

if (diffIndex !== -1) {
  const oldPath = argv[diffIndex + 1];
  if (!oldPath || !existsSync(oldPath)) {
    process.stderr.write("--diff 需要一个存在的旧快照 JSON 路径\n");
    process.exit(2);
  }
  const old = JSON.parse(readFileSync(oldPath, "utf8"));
  if (!old.fileHashes || typeof old.fileHashes !== 'object' || Array.isArray(old.fileHashes)) {
    process.stderr.write('--diff requires a snapshot with per-file hashes; reconstruct an older baseline before comparing.\n');
    process.exit(2);
  }
  const oldHashes = old.fileHashes;
  const added = Object.keys(snapshot.fileHashes).filter((f) => snapshot.fileHashes[f] !== "deleted" && (!(f in oldHashes) || oldHashes[f] === "deleted"));
  const removed = Object.keys(oldHashes).filter((f) => oldHashes[f] !== "deleted" && (!(f in snapshot.fileHashes) || snapshot.fileHashes[f] === "deleted"));
  const changed = Object.keys(snapshot.fileHashes).filter((f) => f in oldHashes && oldHashes[f] !== "deleted" && snapshot.fileHashes[f] !== "deleted" && oldHashes[f] !== snapshot.fileHashes[f]);
  const report = {
    oldHead: old.head ?? null,
    newHead: snapshot.head,
    fingerprintChanged: old.sourceFingerprintSha256 !== snapshot.sourceFingerprintSha256,
    added,
    removed,
    changed,
  };
  if (outIndex !== -1 && argv[outIndex + 1]) writeFileSync(argv[outIndex + 1], JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(0);
}

const json = JSON.stringify(snapshot, null, 2) + "\n";
if (outIndex !== -1 && argv[outIndex + 1]) {
  writeFileSync(argv[outIndex + 1], json);
  process.stdout.write(
    JSON.stringify(
      { wrote: argv[outIndex + 1], sourceFileCount: snapshot.sourceFileCount, sourceFingerprintSha256: snapshot.sourceFingerprintSha256 },
      null,
      2,
    ) + "\n",
  );
} else {
  process.stdout.write(json);
}
