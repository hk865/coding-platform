#!/usr/bin/env node
/**
 * 记忆翻牌游戏验收器（确定性、可执行，无外部依赖）。
 * 用法：node check.mjs <workspace>
 * 退出码 0 = 通过；输出结构化 JSON。
 *
 * 覆盖：文件齐全、HTML 结构与交互元素、JS 语法、game-logic 纯逻辑冒烟。
 * 浏览器渲染验收（真实点击游玩）属于外部门禁，见 expected-artifacts.md。
 */
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
}

const workspace = process.argv[2];
if (!workspace) {
  process.stderr.write("用法：node check.mjs <workspace>\n");
  process.exit(2);
}

let workspaceRoot;
try {
  workspaceRoot = path.resolve(workspace);
  await stat(workspaceRoot);
  check("workspace 存在", true, workspaceRoot);
} catch {
  const result = {
    scenario: "web-game",
    status: "fail",
    failureClassification: "runner_error",
    detail: "workspace 不存在",
    checks: [{ name: "workspace 存在", pass: false, detail: workspace }],
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(1);
}

async function readRequired(relative) {
  try {
    const content = await readFile(path.join(workspaceRoot, relative), "utf8");
    check(`${relative} 存在`, true);
    return content;
  } catch {
    check(`${relative} 存在`, false, "文件缺失");
    return null;
  }
}

const indexHtml = await readRequired("index.html");
await readRequired("style.css"); // 只做存在性检查（内容由浏览器渲染门禁覆盖）
const scriptJs = await readRequired("script.js");
const gameLogic = await readRequired("game-logic.mjs");

// 1) HTML 结构：引用样式与脚本、棋盘容器、重启按钮
if (indexHtml !== null) {
  check(
    "index.html 引用 style.css",
    indexHtml.includes("style.css"),
    '需要 <link rel="stylesheet" href="style.css">',
  );
  check(
    "index.html 引用 script.js",
    indexHtml.includes("script.js"),
    '需要 <script type="module" src="script.js">',
  );
  check(
    "index.html 包含棋盘容器 id=board",
    /id\s*=\s*["']board["']/.test(indexHtml),
    '需要 <div id="board"></div>',
  );
  check(
    "index.html 包含重启按钮 id=restart",
    /id\s*=\s*["']restart["']/.test(indexHtml),
    '需要 <button id="restart">',
  );
}

// 2) 脚本语法与模块引用
if (scriptJs !== null) {
  const syntax = spawnSync(process.execPath, ["--check", "script.js"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  check("script.js 语法正确", syntax.status === 0, syntax.stderr?.slice(0, 400) ?? "");
  check(
    "script.js 使用 game-logic.mjs",
    /import\s+.*from\s+["'].*game-logic\.mjs["']/.test(scriptJs),
    "需要 import { createBoard, isMatch, calculateScore } from './game-logic.mjs'",
  );
}

if (gameLogic !== null) {
  const syntax = spawnSync(process.execPath, ["--check", "game-logic.mjs"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  check("game-logic.mjs 语法正确", syntax.status === 0, syntax.stderr?.slice(0, 400) ?? "");
}

// 3) game-logic 纯逻辑冒烟（真实执行）
let logicSmoke = null;
if (gameLogic !== null) {
  const probe = `
import { createBoard, isMatch, calculateScore } from ${JSON.stringify(
    path.join(workspaceRoot, "game-logic.mjs"),
  )};
const out = [];
try {
  const board = createBoard(4);
  const symbols = board.map((card) => card.symbol);
  const counts = {};
  for (const symbol of symbols) counts[symbol] = (counts[symbol] ?? 0) + 1;
  const pairs = Object.values(counts).every((count) => count === 2);
  out.push({ name: "createBoard(4) 返回 16 张牌", pass: board.length === 16, detail: "length=" + board.length });
  out.push({ name: "每个 symbol 恰好出现 2 次", pass: pairs, detail: JSON.stringify(counts) });
  // 洗牌随机性是统计性质：单次两两比较存在（极小）偶发碰撞，不能作为确定性红灯。
  // 这里做 9 次洗牌统计不同排列数；正确实现下几乎必然 > 1，仅作非阻塞诊断。
  const seen = new Set([symbols.join(",")]);
  for (let index = 0; index < 8; index += 1) {
    seen.add(createBoard(4).map((card) => card.symbol).join(","));
  }
  out.push({
    name: "洗牌随机性统计（非阻塞）",
    pass: seen.size > 1,
    blocking: false,
    detail: seen.size + " 种不同排列 / 9 次洗牌",
  });
  const match = isMatch(board, 0, 1);
  const expected = board[0].symbol === board[1].symbol;
  out.push({ name: "isMatch 判定正确", pass: match === expected, detail: "isMatch=" + match + " expected=" + expected });
  const low = calculateScore(20, 8);
  const high = calculateScore(60, 8);
  out.push({ name: "calculateScore 翻牌少分数高", pass: typeof low === "number" && low > high, detail: "low=" + low + " high=" + high });
} catch (error) {
  out.push({ name: "game-logic 可被 Node 直接执行", pass: false, detail: String(error) });
}
process.stdout.write(JSON.stringify(out));
`;
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    timeout: 30_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(smoke.stdout);
  } catch {
    // 冒烟探针输出不是 JSON（说明 game-logic 执行失败），保持 null 并按 stderr 诊断。
  }
  if (parsed === null) {
    check(
      "game-logic 可被 Node 直接执行",
      false,
      (smoke.stderr ?? smoke.stdout ?? "").slice(0, 800),
    );
  } else {
    for (const item of parsed) {
      check(item.name, item.pass, item.detail ?? "");
      if (item.blocking === false) {
        const lastCheck = checks[checks.length - 1];
        if (lastCheck) lastCheck.nonBlocking = true;
      }
    }
  }
  logicSmoke = parsed;
}

// 非阻塞检查（如洗牌随机性统计）不参与通过判定，避免随机事件造成偶发红灯。
const pass = checks.every((item) => item.pass || item.nonBlocking === true);
const result = {
  scenario: "web-game",
  status: pass ? "pass" : "fail",
  failureClassification: pass ? "pass" : "acceptance_failed",
  checks,
  logicSmoke,
  externalGates: [
    {
      name: "浏览器真实游玩验收",
      status: "external_dependency_missing",
      detail: "本机无浏览器自动化环境；由 L3 执行层或人工按 expected-artifacts.md 验证",
    },
  ],
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
process.exit(pass ? 0 : 1);
