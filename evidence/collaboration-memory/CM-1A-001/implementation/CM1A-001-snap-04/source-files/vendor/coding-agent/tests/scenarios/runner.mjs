#!/usr/bin/env node
/**
 * 最小业务场景 runner：发现、校验、执行验收器，输出结构化 JSON。
 *
 * 用法：
 *   node tests/scenarios/runner.mjs list                        # 发现全部场景
 *   node tests/scenarios/runner.mjs validate [scenarioId]       # 校验任务包结构
 *   node tests/scenarios/runner.mjs check <scenarioId> --workspace <dir> [--json <file>]
 *   node tests/scenarios/runner.mjs check <scenarioId> --from-base [--json <file>]
 *     # --from-base：从 base/ 复制出隔离临时工作区再运行验收器（oracle 不进入工作区）
 *
 * 约定（tests/scenarios/README.md）：
 *   scenario-id/
 *     task.md                用户只会看到的真实需求（症状，不含修复提示）
 *     base/                  固定起始仓库
 *     environment.yaml       依赖、工具、权限与预算（结构由显式 schema 校验）
 *     acceptance/check.mjs   可执行验收器：node check.mjs <workspace>，退出码 0=pass
 *     oracle/                仅供 evaluator 使用，Agent 不可见
 *     interruption-plan.md   取消/崩溃注入点
 *     expected-artifacts.md  patch、报告、截图等要求
 *
 * 本脚本只做协调与结构化输出，不降低验收标准：Agent 无法通过时记录失败分类与 trace。
 * 安全边界：list/validate/check 对 scenarioId 使用同一 canonical direct-child containment，
 * 拒绝 `..` 穿越、链接逃逸、绝对路径与深层路径；runner 自测需要临时场景时，应把本脚本
 * 复制到临时场景根再运行（本文件自包含，仅依赖 vendor/js-yaml.mjs，随目录一起复制）。
 * 隔离与防呆：check 拒绝把场景目录或 base/ 直接作为 workspace；--from-base 提供隔离副本。
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "./vendor/js-yaml.mjs";

const SCENARIOS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const REQUIRED_ENTRIES = [
  "task.md",
  "base",
  "environment.yaml",
  "acceptance",
  "oracle",
  "interruption-plan.md",
  "expected-artifacts.md",
];

const REQUIRED_ACCEPTANCE = ["check.mjs"];

/** 失败分类：Agent 未能通过时如实记录，禁止用降低验收标准换取绿灯。 */
const FAILURE_CLASSIFICATION = {
  PASS: "pass",
  ACCEPTANCE_FAILED: "acceptance_failed",
  RUNNER_ERROR: "runner_error",
  EXTERNAL_DEPENDENCY_MISSING: "external_dependency_missing",
  NOT_RUN: "not_run",
};

/** environment.yaml 顶层字段：schema 允许的键集合与必需键。 */
const ENV_TOP_LEVEL = new Set([
  "scenario",
  "title",
  "runtime",
  "dependencies",
  "tools",
  "permissions",
  "budget",
  "evaluation",
]);
const ENV_REQUIRED_TOP = [
  "scenario",
  "title",
  "runtime",
  "tools",
  "permissions",
  "budget",
  "evaluation",
];
const ENV_PERMISSION_FIELDS = new Set(["sandbox_mode", "approval_policy"]);
const ENV_BUDGET_FIELDS = new Set([
  "max_model_requests",
  "max_tool_calls",
  "max_input_tokens",
  "deadline_minutes",
]);
const ENV_EVALUATION_FIELDS = new Set(["layers", "metrics"]);

/** acceptance 输出协议：status 只允许 pass/fail；failureClassification 只允许五种分类。 */
const ACCEPTANCE_STATUS = new Set(["pass", "fail"]);
const ACCEPTANCE_CLASSIFICATION = new Set(Object.values(FAILURE_CLASSIFICATION));

function fail(message) {
  process.stderr.write(`[scenario-runner] ${message}\n`);
  process.exitCode = 2;
}

function usage() {
  process.stdout.write(
    [
      "用法：",
      "  node tests/scenarios/runner.mjs list",
      "  node tests/scenarios/runner.mjs validate [scenarioId]",
      "  node tests/scenarios/runner.mjs check <scenarioId> --workspace <dir> [--json <file>]",
      "  node tests/scenarios/runner.mjs check <scenarioId> --from-base [--json <file>]",
      "",
      "  --from-base：从 base/ 复制出隔离临时工作区再运行验收器（oracle 不进入工作区）",
      "",
    ].join("\n"),
  );
}

async function scenarioDirs() {
  const entries = await readdir(SCENARIOS_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "vendor", // runner 自包含依赖目录，不是场景
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * 解析 scenarioId 并做 canonical containment 校验：解析后的真实路径必须位于
 * SCENARIOS_ROOT 下（拒绝 `..` 穿越、绝对路径、链接逃逸与深层路径）。
 * list/validate/check 三个生产入口共用此函数，不提供外部场景例外。
 * @returns {Promise<string | null>} canonical 场景根；非法时返回 null
 */
async function resolveScenarioRoot(id) {
  const candidate = path.resolve(SCENARIOS_ROOT, id);
  let canonicalRoot;
  let canonicalCandidate;
  try {
    canonicalRoot = await realpath(SCENARIOS_ROOT);
    canonicalCandidate = await realpath(candidate);
  } catch {
    return null;
  }
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.includes(path.sep) || relative.includes("/")) return null; // 必须是直接子目录
  return canonicalCandidate;
}

async function isScenario(id) {
  const root = await resolveScenarioRoot(id);
  if (!root) return false;
  try {
    await stat(path.join(root, "task.md"));
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 解析逗号分隔字符串或字符串数组为去空白的字符串数组；不合法时返回 null。
 */
function splitList(value) {
  if (typeof value === "string") {
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : null;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item))) {
    return value;
  }
  return null;
}

/**
 * environment.yaml 显式 schema 校验：必需字段（scenario、title、runtime、tools、
 * permissions、budget、evaluation）、字段类型、嵌套结构、未知字段；重复 key 在
 * YAML 解析阶段即被拒绝。违反任一条即抛错，由 validate 记为 invalid。
 */
function validateEnvironmentSchema(env) {
  const errors = [];
  for (const key of ENV_REQUIRED_TOP) {
    if (!(key in env)) errors.push(`缺少必需字段 ${key}`);
  }
  for (const key of Object.keys(env)) {
    if (!ENV_TOP_LEVEL.has(key)) errors.push(`未知顶层字段 ${key}`);
  }
  for (const field of ["scenario", "title", "runtime"]) {
    if (field in env && !isNonEmptyString(env[field])) {
      errors.push(`${field} 必须是非空字符串`);
    }
  }
  if ("dependencies" in env && typeof env.dependencies !== "string") {
    errors.push("dependencies 必须是字符串");
  }
  if ("tools" in env && splitList(env.tools) === null) {
    errors.push("tools 必须是逗号分隔字符串或非空字符串数组");
  }
  if ("permissions" in env) {
    const value = env.permissions;
    if (!isPlainObject(value)) {
      errors.push("permissions 必须是映射");
    } else {
      for (const key of Object.keys(value)) {
        if (!ENV_PERMISSION_FIELDS.has(key)) errors.push(`permissions 未知字段 ${key}`);
      }
      if (!isNonEmptyString(value.sandbox_mode)) {
        errors.push("permissions.sandbox_mode 必须是非空字符串");
      }
      if (!isNonEmptyString(value.approval_policy)) {
        errors.push("permissions.approval_policy 必须是非空字符串");
      }
    }
  }
  if ("budget" in env) {
    const value = env.budget;
    if (!isPlainObject(value)) {
      errors.push("budget 必须是映射");
    } else {
      for (const key of Object.keys(value)) {
        if (!ENV_BUDGET_FIELDS.has(key)) errors.push(`budget 未知字段 ${key}`);
      }
      for (const field of ENV_BUDGET_FIELDS) {
        if (
          typeof value[field] !== "number" ||
          !Number.isFinite(value[field]) ||
          value[field] < 0
        ) {
          errors.push(`budget.${field} 必须是非负数字`);
        }
      }
    }
  }
  if ("evaluation" in env) {
    const value = env.evaluation;
    if (!isPlainObject(value)) {
      errors.push("evaluation 必须是映射");
    } else {
      for (const key of Object.keys(value)) {
        if (!ENV_EVALUATION_FIELDS.has(key)) errors.push(`evaluation 未知字段 ${key}`);
      }
      if (!isNonEmptyString(value.layers)) {
        errors.push("evaluation.layers 必须是非空字符串");
      }
      if (splitList(value.metrics) === null) {
        errors.push("evaluation.metrics 必须是逗号分隔字符串或非空字符串数组");
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`environment.yaml schema 校验失败：${errors.join("；")}`);
  }
  return env;
}

/**
 * 解析 environment.yaml：真实 YAML parser（vendored js-yaml），重复 key 视为结构错误，
 * 之后执行显式 schema 校验（必需字段、类型、嵌套结构、未知字段）。任何失败都抛错，
 * 由 validate 记为 invalid；不把“行级 key: value”当作合法结构。
 */
function parseEnvironmentYaml(raw) {
  let document;
  try {
    document = parseYaml(raw, {
      listener(event, message) {
        // js-yaml 通过 listener 上报重复 key 等警告：一律视为结构错误
        if (event === "warning") throw new Error(message);
      },
    });
  } catch (error) {
    throw new Error(`不是合法 YAML：${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (!isPlainObject(document)) {
    throw new Error("顶层必须是映射（key: value 结构）");
  }
  return validateEnvironmentSchema(document);
}

/**
 * acceptance 输出协议校验：pass 必须显式声明 status: "pass"；status 只允许 pass/fail；
 * failureClassification 只允许五种分类且与 status 一致；checks（若存在）必须是
 * { name: string, pass: boolean } 数组且与总 status 一致（pass 时不得存在未通过的
 * 阻塞检查项，fail 时必须存在未通过的阻塞检查项）。协议违规返回 { ok: false, error }，
 * 由 check 记为 runner_error，绝不把空对象/数组当作业务通过。
 * @returns {{ ok: true, status: string } | { ok: false, error: string }}
 */
function validateAcceptanceOutput(parsed, exitCode) {
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "acceptance 输出必须是 JSON 对象" };
  }
  const { status, failureClassification, checks } = parsed;
  if (status === undefined) {
    if (failureClassification === FAILURE_CLASSIFICATION.EXTERNAL_DEPENDENCY_MISSING) {
      if (exitCode === 0) {
        return { ok: false, error: "external_dependency_missing 与退出码 0 矛盾" };
      }
      return { ok: true, status: FAILURE_CLASSIFICATION.EXTERNAL_DEPENDENCY_MISSING };
    }
    return {
      ok: false,
      error: '缺少显式 status 字段（pass 必须显式声明 status: "pass"）',
    };
  }
  if (typeof status !== "string" || !ACCEPTANCE_STATUS.has(status)) {
    return {
      ok: false,
      error: `status 必须是 ${[...ACCEPTANCE_STATUS].join("/")}，实际为 ${String(status)}`,
    };
  }
  if (
    failureClassification !== undefined &&
    (typeof failureClassification !== "string" ||
      !ACCEPTANCE_CLASSIFICATION.has(failureClassification))
  ) {
    return {
      ok: false,
      error: `failureClassification 非法：${String(failureClassification)}`,
    };
  }
  if (checks !== undefined) {
    if (!Array.isArray(checks)) {
      return { ok: false, error: "checks 必须是数组" };
    }
    for (const item of checks) {
      if (!isPlainObject(item) || typeof item.name !== "string" || typeof item.pass !== "boolean") {
        return { ok: false, error: "checks 每一项必须包含 string name 与 boolean pass" };
      }
      if (item.nonBlocking !== undefined && typeof item.nonBlocking !== "boolean") {
        return { ok: false, error: "checks.nonBlocking 必须是布尔值" };
      }
    }
  }
  if (status === "pass") {
    if (exitCode !== 0) {
      return { ok: false, error: "status pass 与退出码非 0 矛盾" };
    }
    if (
      failureClassification !== undefined &&
      failureClassification !== FAILURE_CLASSIFICATION.PASS
    ) {
      return {
        ok: false,
        error: `status pass 与 failureClassification ${failureClassification} 矛盾`,
      };
    }
    if (
      checks !== undefined &&
      !checks.every((item) => item.pass === true || item.nonBlocking === true)
    ) {
      return {
        ok: false,
        error: "status pass 与未通过的 checks 矛盾（存在 pass=false 且非 nonBlocking 的检查项）",
      };
    }
    return { ok: true, status: FAILURE_CLASSIFICATION.PASS };
  }
  // status === "fail"
  if (exitCode === 0) {
    return { ok: false, error: "status fail 与退出码 0 矛盾" };
  }
  if (
    checks !== undefined &&
    !checks.some((item) => item.pass === false && item.nonBlocking !== true)
  ) {
    return {
      ok: false,
      error: "status fail 与全部通过的 checks 矛盾（fail 必须存在未通过的阻塞检查项）",
    };
  }
  if (failureClassification === FAILURE_CLASSIFICATION.PASS) {
    return { ok: false, error: "status fail 与 failureClassification pass 矛盾" };
  }
  if (failureClassification === FAILURE_CLASSIFICATION.EXTERNAL_DEPENDENCY_MISSING) {
    return { ok: true, status: FAILURE_CLASSIFICATION.EXTERNAL_DEPENDENCY_MISSING };
  }
  if (failureClassification === FAILURE_CLASSIFICATION.RUNNER_ERROR) {
    return { ok: true, status: FAILURE_CLASSIFICATION.RUNNER_ERROR };
  }
  return { ok: true, status: FAILURE_CLASSIFICATION.ACCEPTANCE_FAILED };
}

async function validateScenario(id) {
  const root = await resolveScenarioRoot(id);
  if (!root) {
    return {
      scenarioId: id,
      status: "invalid",
      checks: [{ path: "scenario-root", ok: false, kind: "missing-or-outside-scenarios-root" }],
      errors: [{ path: "scenario-root", message: "场景目录缺失或位于 tests/scenarios 之外" }],
    };
  }
  const checks = [];
  for (const name of REQUIRED_ENTRIES) {
    try {
      const info = await stat(path.join(root, name));
      checks.push({ path: name, ok: true, kind: info.isDirectory() ? "directory" : "file" });
    } catch {
      checks.push({ path: name, ok: false, kind: "missing" });
    }
  }
  for (const name of REQUIRED_ACCEPTANCE) {
    try {
      await stat(path.join(root, "acceptance", name));
      checks.push({ path: `acceptance/${name}`, ok: true, kind: "file" });
    } catch {
      checks.push({ path: `acceptance/${name}`, ok: false, kind: "missing" });
    }
  }
  try {
    const yaml = await readFile(path.join(root, "environment.yaml"), "utf8");
    parseEnvironmentYaml(yaml);
    checks.push({ path: "environment.yaml", ok: true, kind: "schema" });
  } catch (error) {
    checks.push({
      path: "environment.yaml",
      ok: false,
      kind: "schema",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const errors = checks.filter((check) => !check.ok);
  return { scenarioId: id, status: errors.length === 0 ? "valid" : "invalid", checks, errors };
}

/**
 * 从 base/ 复制出隔离临时工作区（oracle 等任务包文件不会进入工作区）。
 * @returns {Promise<string>} 新建的隔离工作区路径
 */
async function prepareWorkspace(id) {
  const root = await resolveScenarioRoot(id);
  const target = await mkdtemp(path.join(os.tmpdir(), `scenario-${id}-`));
  await cp(path.join(root, "base"), target, { recursive: true });
  return target;
}

/**
 * 防呆（canonical containment）：workspace 不得位于 SCENARIOS_ROOT 之内（含自身），
 * 也不得是 SCENARIOS_ROOT 的祖先（如仓库根）——这些位置都可能让 Agent 读到 oracle；
 * 同时拒绝指向这些位置的链接。
 */
async function assertAllowedWorkspace(workspaceResolved) {
  let canonicalWorkspace;
  let canonicalScenarios;
  try {
    canonicalWorkspace = await realpath(workspaceResolved);
    canonicalScenarios = await realpath(SCENARIOS_ROOT);
  } catch (error) {
    throw new Error(
      `workspace 无法解析：${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  const workspaceInScenarios = path.relative(canonicalScenarios, canonicalWorkspace);
  const scenariosInWorkspace = path.relative(canonicalWorkspace, canonicalScenarios);
  const inside = (rel) => rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (inside(workspaceInScenarios) || inside(scenariosInWorkspace)) {
    throw new Error(
      "不允许直接以场景目录或 base/ 作为 workspace（含 oracle 及其父目录，隔离风险）；请使用 --from-base 生成隔离副本",
    );
  }
}

async function runCheck(id, workspace, prepared) {
  const validation = await validateScenario(id);
  const scenario = await loadScenarioMeta(id);
  if (validation.status !== "valid") {
    return {
      ...scenario,
      command: "check",
      status: FAILURE_CLASSIFICATION.RUNNER_ERROR,
      detail: "任务包校验失败，无法执行验收器",
      validation,
      checks: [],
    };
  }
  let workspaceResolved;
  if (prepared) {
    try {
      workspaceResolved = await prepareWorkspace(id);
    } catch (error) {
      return {
        ...scenario,
        command: "check",
        status: FAILURE_CLASSIFICATION.RUNNER_ERROR,
        detail: `隔离工作区准备失败：${error instanceof Error ? error.message : String(error)}`,
        validation,
        checks: [],
      };
    }
  } else {
    try {
      workspaceResolved = path.resolve(workspace);
      await assertAllowedWorkspace(workspaceResolved);
      await stat(workspaceResolved);
    } catch (error) {
      return {
        ...scenario,
        command: "check",
        status: FAILURE_CLASSIFICATION.RUNNER_ERROR,
        detail: error instanceof Error ? error.message : `workspace 不存在：${workspace}`,
        validation,
        checks: [],
      };
    }
  }
  const acceptanceScript = path.join(SCENARIOS_ROOT, id, "acceptance", "check.mjs");
  const startedAt = Date.now();
  const spawned = spawnSync(process.execPath, [acceptanceScript, workspaceResolved], {
    encoding: "utf8",
    timeout: 300_000,
  });
  const elapsedMs = Date.now() - startedAt;
  const rawOutput = spawned.stdout ?? "";
  let parsedOutput = null;
  try {
    parsedOutput = JSON.parse(rawOutput);
  } catch {
    // acceptance 输出不是合法 JSON：视为验收器协议违规（runner error），不作为业务结果。
  }
  // 失败分类必须可信：
  //  - spawnSync 自己触发超时（error.killed/ETIMEDOUT）→ timedOut + runner_error；
  //  - 子进程自发信号退出（SIGTERM/SIGKILL 等）→ 不是 timeout，按 runner_error；
  //  - 输出不是合法 JSON：不论退出码一律 runner_error（协议违规，带 protocolError）；
  //  - 合法 JSON 必须通过 acceptance 输出协议校验（显式 status、分类一致性、checks
  //    结构与 checks-状态一致性），协议违规一律 runner_error，绝不制造业务假绿灯；
  //  - acceptance 显式声明的 failureClassification 必须保留（如 external_dependency_missing）。
  const killedByTimeout = spawned.error?.killed === true || spawned.error?.code === "ETIMEDOUT";
  const crashedBySignal = !killedByTimeout && spawned.signal !== null && spawned.status === null;
  const exitCode = spawned.status ?? null;
  let timedOut = false;
  let status;
  let protocolError;
  if (killedByTimeout) {
    timedOut = true;
    status = FAILURE_CLASSIFICATION.RUNNER_ERROR;
  } else if (crashedBySignal) {
    status = FAILURE_CLASSIFICATION.RUNNER_ERROR;
  } else if (parsedOutput === null) {
    // 任何不可解析的输出都是验收器协议违规：不论退出码一律 runner_error（带 protocolError），
    // 非 JSON 与协议结构错误一样不作为业务结果。
    protocolError = "acceptance 输出不是合法 JSON（协议违规）";
    status = FAILURE_CLASSIFICATION.RUNNER_ERROR;
  } else {
    const protocol = validateAcceptanceOutput(parsedOutput, exitCode);
    if (!protocol.ok) {
      protocolError = protocol.error;
      status = FAILURE_CLASSIFICATION.RUNNER_ERROR;
    } else {
      status = protocol.status;
    }
  }
  return {
    ...scenario,
    command: "check",
    status,
    exitCode,
    timedOut,
    signal: spawned.signal ?? null,
    stderr: (spawned.stderr ?? "").slice(0, 16_384),
    elapsedMs,
    acceptance: parsedOutput ?? { raw: rawOutput.slice(0, 16_384) },
    ...(protocolError !== undefined ? { protocolError } : {}),
    validation,
    workspacePath: workspaceResolved,
    prepared,
  };
}

async function loadScenarioMeta(id) {
  const root = await resolveScenarioRoot(id);
  if (!root) {
    return { scenarioId: id, title: id, taskSummary: "", runtime: "unknown", dependencies: "none" };
  }
  const task = await readFile(path.join(root, "task.md"), "utf8").catch(() => "");
  const environment = await readFile(path.join(root, "environment.yaml"), "utf8").catch(() => "");
  let env = {};
  try {
    env = parseEnvironmentYaml(environment);
  } catch {
    // 结构错误的环境文件按空处理（validate 会单独报告 invalid）
  }
  return {
    scenarioId: id,
    title: env.title ?? id,
    taskSummary:
      task
        .split("\n")
        .find((line) => line.trim().length > 0)
        ?.trim() ?? "",
    runtime: env.runtime ?? "unknown",
    dependencies: env.dependencies ?? "none",
  };
}

async function main() {
  const [command, arg, ...rest] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--workspace") options.workspace = rest[index + 1];
    if (rest[index] === "--from-base") options.fromBase = true;
    if (rest[index] === "--json") options.json = rest[index + 1];
  }

  if (command === "list") {
    const ids = await scenarioDirs();
    const scenarios = [];
    for (const id of ids) {
      if (await isScenario(id)) scenarios.push(await loadScenarioMeta(id));
    }
    const result = {
      runner: "scenario-runner",
      generatedAt: new Date().toISOString(),
      command: "list",
      status: "ok",
      count: scenarios.length,
      scenarios,
    };
    if (options.json) await writeFile(options.json, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  if (command === "validate") {
    const ids = arg ? [arg] : await scenarioDirs();
    const results = [];
    for (const id of ids) {
      const validation = await validateScenario(id);
      if (validation.status !== "valid" && !(await isScenario(id))) {
        fail(`未知场景：${id}`);
      }
      results.push(validation);
    }
    const result = {
      runner: "scenario-runner",
      generatedAt: new Date().toISOString(),
      command: "validate",
      status: results.every((item) => item.status === "valid") ? "ok" : "invalid",
      results,
    };
    if (options.json) await writeFile(options.json, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.status !== "ok") process.exitCode = 1;
    return;
  }

  if (command === "check") {
    if (!arg || (!options.workspace && !options.fromBase)) {
      fail("check 需要 <scenarioId> 与 --workspace <dir> 或 --from-base");
      usage();
      return;
    }
    if (options.fromBase && options.workspace) {
      fail("--from-base 与 --workspace 只能二选一");
      usage();
      return;
    }
    // 未知/越界 scenarioId 由 runCheck 内的 containment 校验兜底，
    // 输出结构化 runner_error（不执行任何外部 acceptance 脚本）。
    const result = await runCheck(arg, options.workspace, options.fromBase === true);
    if (options.json) await writeFile(options.json, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.status !== FAILURE_CLASSIFICATION.PASS) process.exitCode = 1;
    return;
  }

  usage();
  fail("未知命令");
}

await main();
