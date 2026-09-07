#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const p1Directory = path.join(
  repositoryRoot,
  "dev_docs",
  "planning",
  "proposed",
  "P1-foundation",
);
const p1TicketsDirectory = path.join(p1Directory, "tickets");
const p1DagPath = path.join(p1Directory, "DAG.md");
const architecturePath = path.join(repositoryRoot, "ARCHITECTURE.md");
const allowedArtifactSources = new Set([
  "upstream",
  "local_fixture",
  "external_input",
]);
const routeStubPaths = [
  "dev_docs/design/总体架构.md",
  "dev_docs/design/任务图与完成判定.md",
  "dev_docs/planning/P0-产品定义与总体架构.md",
  "dev_docs/product/产品定义.md",
];
const expectedTicketIds = Array.from(
  { length: 18 },
  (_, index) => "P1-" + String(index).padStart(2, "0"),
);
const p0EvidenceTicketIds = ["01", "02", "03", "04", "05"];
const p0ArchivePayloadDigests = new Map([
  [
    "dev_docs/archive/v0.3-2026-09-04/README.md",
    "b6ca0aed1b6f9845fdad45f55bc0f2910868439563edf2b47e2c1508e732afba",
  ],
  [
    "dev_docs/archive/v0.3-2026-09-04/CONTEXT.md",
    "ef3b30a748f6721574014ddfa84b8319458b81c34c631af92f7fe1f8e718cabd",
  ],
  [
    "dev_docs/archive/v0.3-2026-09-04/dev_docs/product/产品定义.md",
    "ce6a68235ea4bd535f31edd41dce7d73679b3b7a4493ec5f4a36050c4f760526",
  ],
  [
    "dev_docs/archive/v0.3-2026-09-04/dev_docs/design/总体架构.md",
    "80f6ccd73bc4e6d185f67154a022a32bc36f2f0964f8eb22ce34d4da051b4b4d",
  ],
  [
    "dev_docs/archive/v0.3-2026-09-04/dev_docs/design/任务图与完成判定.md",
    "4c9bc4bb9be84b78bd99bc8a2a8487b89a9eeb11fa1322508d91920d32f19848",
  ],
  [
    "dev_docs/archive/v0.3-2026-09-04/dev_docs/planning/P0-产品定义与总体架构.md",
    "861bf2046e0ba200807d433e9d125507ee26f5d489e2b75da309356bbdcd6338",
  ],
]);
const fence = String.fromCharCode(96).repeat(3);
const metadataCache = new Map();
const results = [];

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function walkFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) =>
    relativePath(left).localeCompare(relativePath(right)),
  );
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let current = "";
  let quote = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== null) {
      current += character;
      if (character === quote && value[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }

    if (character === delimiter && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim() !== "") {
    parts.push(current.trim());
  }

  return parts;
}

function findTopLevelColon(value) {
  let quote = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== null) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    } else if (character === ":" && depth === 0) {
      return index;
    }
  }

  return -1;
}

function unquote(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' && last === '"') {
    return JSON.parse(value);
  }
  if (first === "'" && last === "'") {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value;
}

function parseInlineMap(value, context) {
  const body = value.slice(1, -1).trim();
  const parsed = {};

  if (body === "") {
    return parsed;
  }

  for (const part of splitTopLevel(body, ",")) {
    const separator = findTopLevelColon(part);
    if (separator === -1) {
      throw new Error(context + ": invalid inline map entry: " + part);
    }

    const key = unquote(part.slice(0, separator).trim());
    const rawValue = part.slice(separator + 1).trim();
    if (key === "" || rawValue === "") {
      throw new Error(context + ": empty inline map key/value: " + part);
    }
    parsed[key] = parseScalar(rawValue, context);
  }

  return parsed;
}

function parseScalar(rawValue, context) {
  const value = rawValue.trim();

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null" || value === "~") {
    return null;
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    return parseInlineMap(value, context);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body === ""
      ? []
      : splitTopLevel(body, ",").map((item) => parseScalar(item, context));
  }

  return unquote(value);
}

function flowCollectionDepth(value) {
  let quote = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== null) {
      if (character === quote && value[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (character.charCodeAt(0) === 34 || character.charCodeAt(0) === 39) {
      quote = character;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }

  return depth;
}

function extractYamlMetadata(filePath) {
  if (metadataCache.has(filePath)) {
    return metadataCache.get(filePath);
  }

  const text = readText(filePath);
  const openingMarker = fence + "yaml";
  const openingIndex = text.indexOf(openingMarker);
  if (openingIndex === -1) {
    throw new Error(relativePath(filePath) + ": missing fenced YAML metadata");
  }

  const bodyStart = text.indexOf("\n", openingIndex);
  const closingIndex = text.indexOf("\n" + fence, bodyStart + 1);
  if (bodyStart === -1 || closingIndex === -1) {
    throw new Error(relativePath(filePath) + ": unterminated YAML metadata");
  }

  const yaml = text.slice(bodyStart + 1, closingIndex);
  const metadata = {};
  let currentListKey = null;

  const yamlLines = yaml
    .replaceAll(String.fromCharCode(13), "")
    .split(String.fromCharCode(10));
  for (
    let zeroBasedLine = 0;
    zeroBasedLine < yamlLines.length;
    zeroBasedLine += 1
  ) {
    const lineNumber = zeroBasedLine + 1;
    let line = yamlLines[zeroBasedLine];
    const trimmedLine = line.trimStart();
    const flowCollectionStart =
      trimmedLine.startsWith("- {") || trimmedLine.startsWith("- [");

    if (flowCollectionStart) {
      const prefixLength = line.indexOf("-") + 2;
      const prefix = line.slice(0, prefixLength);
      let itemValue = line.slice(prefixLength);
      let depth = flowCollectionDepth(itemValue);
      while (depth > 0 && zeroBasedLine + 1 < yamlLines.length) {
        zeroBasedLine += 1;
        itemValue += " " + yamlLines[zeroBasedLine].trim();
        depth = flowCollectionDepth(itemValue);
      }
      if (depth !== 0) {
        throw new Error(
          relativePath(filePath) +
            ": unterminated flow collection at metadata line " +
            lineNumber,
        );
      }
      line = prefix + itemValue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    const topLevel = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (topLevel !== null) {
      const [, key, rawValue = ""] = topLevel;
      if (Object.hasOwn(metadata, key)) {
        throw new Error(
          relativePath(filePath) + ": duplicate metadata key " + key,
        );
      }
      metadata[key] =
        rawValue.trim() === ""
          ? []
          : parseScalar(
              rawValue,
              relativePath(filePath) + ":metadata:" + lineNumber,
            );
      currentListKey = rawValue.trim() === "" ? key : null;
      continue;
    }

    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (
      listItem !== null &&
      currentListKey !== null &&
      Array.isArray(metadata[currentListKey])
    ) {
      metadata[currentListKey].push(
        parseScalar(
          listItem[1],
          relativePath(filePath) + ":metadata:" + lineNumber,
        ),
      );
      continue;
    }

    throw new Error(
      relativePath(filePath) +
        ": unsupported YAML subset at metadata line " +
        lineNumber +
        ": " +
        line,
    );
  }

  metadataCache.set(filePath, metadata);
  return metadata;
}

function withoutFencedCode(text) {
  const kept = [];
  let activeFence = null;

  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*((?:\x60){3,}|~{3,})/);
    if (marker !== null) {
      const markerCharacter = marker[1][0];
      if (activeFence === null) {
        activeFence = markerCharacter;
      } else if (activeFence === markerCharacter) {
        activeFence = null;
      }
      kept.push("");
      continue;
    }

    kept.push(
      activeFence === null ? line.replace(/\x60[^\x60]*\x60/g, "") : "",
    );
  }

  return kept.join("\n");
}

function markdownLinkTargets(text) {
  const stripped = withoutFencedCode(text);
  const targets = [];
  const inlineLink =
    /!?\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
  const referenceDefinition = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;

  for (const match of stripped.matchAll(inlineLink)) {
    targets.push(match[1]);
  }
  for (const match of stripped.matchAll(referenceDefinition)) {
    targets.push(match[1]);
  }

  return targets;
}

function normalizeLocalTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }

  if (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return null;
  }

  target = target.split("#", 1)[0].split("?", 1)[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    return { error: "invalid URI encoding in link target " + rawTarget };
  }

  return { target };
}

function arraysMatch(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function setDifference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function ticketIdFromAlias(alias) {
  if (alias === "P0") {
    return "P0-06";
  }

  const match = alias.match(/^T(\d{2})$/);
  return match === null ? null : "P1-" + match[1];
}

function extractMermaidTicketEdges(dagText, problems) {
  const blockPattern = new RegExp(
    "^" + fence + "mermaid\\s*\\r?\\n([\\s\\S]*?)\\r?\\n" + fence + "\\s*$",
    "gm",
  );
  const blocks = [...dagText.matchAll(blockPattern)].map((match) => match[1]);
  const graph = blocks.find(
    (block) => block.includes("flowchart") && block.includes("T00"),
  );

  if (graph === undefined) {
    problems.push(
      relativePath(p1DagPath) + ": missing DevelopmentTicketDAG Mermaid block",
    );
    return [];
  }

  const edges = [];
  const seen = new Set();
  const duplicateEdges = new Set();

  for (const line of graph.split(/\r?\n/)) {
    const match = line.match(
      /^\s*([A-Za-z][A-Za-z0-9_-]*)(?:\[[^\]]*\])?\s*-->\s*(?:\|[^|]*\|\s*)?([A-Za-z][A-Za-z0-9_-]*)/,
    );
    if (match === null) {
      continue;
    }

    const from = ticketIdFromAlias(match[1]);
    const to = ticketIdFromAlias(match[2]);
    if (to === null || !to.startsWith("P1-")) {
      continue;
    }
    if (from === null) {
      problems.push(
        relativePath(p1DagPath) +
          ": unknown predecessor alias " +
          match[1] +
          " for " +
          to,
      );
      continue;
    }

    if (from.startsWith("P1-")) {
      seen.add(from);
    }
    seen.add(to);

    const edgeKey = from + "->" + to;
    if (duplicateEdges.has(edgeKey)) {
      problems.push(
        relativePath(p1DagPath) + ": duplicate Mermaid edge " + edgeKey,
      );
      continue;
    }
    duplicateEdges.add(edgeKey);
    edges.push({ from, to });
  }

  for (const ticketId of expectedTicketIds) {
    if (!seen.has(ticketId)) {
      problems.push(
        relativePath(p1DagPath) +
          ": Mermaid graph does not mention ticket " +
          ticketId,
      );
    }
  }

  return edges;
}

function extractArchitectureDependencyEdges(problems) {
  const architectureText = readText(architecturePath);
  const heading = "## ModuleDependencyDAG";
  const sectionStart = architectureText.indexOf(heading);
  if (sectionStart === -1) {
    problems.push(relativePath(architecturePath) + ": missing " + heading);
    return [];
  }

  const nextSection = architectureText.indexOf(
    "\n## ",
    sectionStart + heading.length,
  );
  const section =
    nextSection === -1
      ? architectureText.slice(sectionStart)
      : architectureText.slice(sectionStart, nextSection);
  const blockPattern = new RegExp(
    "^" + fence + "mermaid\\s*\\r?\\n([\\s\\S]*?)\\r?\\n" + fence + "\\s*$",
    "gm",
  );
  const block = [...section.matchAll(blockPattern)]
    .map((match) => match[1])
    .find((candidate) => candidate.includes("flowchart"));

  if (block === undefined) {
    problems.push(
      relativePath(architecturePath) +
        ": ModuleDependencyDAG has no Mermaid flowchart",
    );
    return [];
  }

  const edges = [];
  const seenEdges = new Set();
  const edgePattern =
    /^\s*([A-Za-z][A-Za-z0-9_-]*)(?:\[[^\]]*\])?\s*(-->|-\.[A-Za-z0-9_-]+\.->)\s*([A-Za-z][A-Za-z0-9_-]*)/;

  for (const [zeroBasedLine, line] of block.split(/\r?\n/).entries()) {
    const containsArrow = line.includes("-->") || /-\..*\.->/.test(line);
    const match = line.match(edgePattern);
    if (match === null) {
      if (containsArrow) {
        problems.push(
          relativePath(architecturePath) +
            ": unparseable ModuleDependencyDAG edge at Mermaid line " +
            (zeroBasedLine + 1) +
            ": " +
            line.trim(),
        );
      }
      continue;
    }

    const edge = { from: match[1], to: match[3] };
    const key = edge.from + "->" + edge.to;
    if (seenEdges.has(key)) {
      problems.push(
        relativePath(architecturePath) +
          ": duplicate ModuleDependencyDAG edge " +
          key,
      );
      continue;
    }

    seenEdges.add(key);
    edges.push(edge);
  }

  if (edges.length === 0) {
    problems.push(
      relativePath(architecturePath) +
        ": ModuleDependencyDAG contains no dependency edges",
    );
  }

  return edges;
}

function buildP1Model() {
  const problems = [];
  const tickets = new Map();
  let dagMetadata = {};
  let dagText = "";

  const ticketFiles = fs
    .readdirSync(p1TicketsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(p1TicketsDirectory, entry.name))
    .sort();

  if (ticketFiles.length !== expectedTicketIds.length) {
    problems.push(
      relativePath(p1TicketsDirectory) +
        ": expected " + expectedTicketIds.length + " Markdown tickets, found " +
        ticketFiles.length,
    );
  }

  for (const ticketFile of ticketFiles) {
    const match = path.basename(ticketFile).match(/^(\d{2})-/);
    if (match === null) {
      problems.push(
        relativePath(ticketFile) +
          ": ticket filename must start with a two-digit id",
      );
      continue;
    }

    const ticketId = "P1-" + match[1];
    if (!expectedTicketIds.includes(ticketId)) {
      problems.push(
        relativePath(ticketFile) + ": unexpected ticket " + ticketId,
      );
      continue;
    }
    if (tickets.has(ticketId)) {
      problems.push(
        relativePath(ticketFile) + ": duplicate ticket " + ticketId,
      );
      continue;
    }

    try {
      tickets.set(ticketId, {
        id: ticketId,
        filePath: ticketFile,
        metadata: extractYamlMetadata(ticketFile),
      });
    } catch (error) {
      problems.push(error.message);
    }
  }

  for (const ticketId of expectedTicketIds) {
    if (!tickets.has(ticketId)) {
      problems.push("missing ticket metadata for " + ticketId);
    }
  }

  try {
    dagText = readText(p1DagPath);
    dagMetadata = extractYamlMetadata(p1DagPath);
  } catch (error) {
    problems.push(error.message);
  }

  const edges = extractMermaidTicketEdges(dagText, problems);
  return { problems, tickets, dagMetadata, edges };
}

function ticketAncestors(ticketId, tickets) {
  const ancestors = new Set();
  const frontier = [ticketId];

  while (frontier.length > 0) {
    const current = frontier.pop();
    const ticket = tickets.get(current);
    if (ticket === undefined) {
      continue;
    }

    const blockedBy = Array.isArray(ticket.metadata.blocked_by)
      ? ticket.metadata.blocked_by
      : [];
    for (const predecessor of blockedBy) {
      if (
        typeof predecessor === "string" &&
        predecessor.startsWith("P1-") &&
        !ancestors.has(predecessor)
      ) {
        ancestors.add(predecessor);
        frontier.push(predecessor);
      }
    }
  }

  return ancestors;
}

function headingAnchors(text) {
  const anchors = new Set();

  for (const line of withoutFencedCode(text).split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match === null) {
      continue;
    }

    const anchor = match[1]
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[\x60*_~]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .replace(/\s+/g, "-");

    anchors.add(anchor);
  }

  return anchors;
}

function runCheck(name, check) {
  const issues = [];

  try {
    check((message) => issues.push(message));
  } catch (error) {
    issues.push("validator exception: " + (error.stack || error.message));
  }

  results.push({ name, issues });
  if (issues.length === 0) {
    console.log("PASS  " + name);
    return;
  }

  console.log("FAIL  " + name + " (" + issues.length + ")");
  for (const issue of issues) {
    console.log("  - " + issue);
  }
}

const allRepositoryFiles = walkFiles(repositoryRoot);
const p1Model = buildP1Model();

runCheck("current Markdown local links resolve", (report) => {
  const currentMarkdown = allRepositoryFiles.filter((filePath) => {
    const relative = relativePath(filePath);
    if (!relative.endsWith(".md")) {
      return false;
    }
    return (
      !relative.startsWith("dev_docs/archive/") ||
      relative === "dev_docs/archive/INDEX.md"
    );
  });

  for (const markdownPath of currentMarkdown) {
    const seenTargets = new Set();
    for (const rawTarget of markdownLinkTargets(readText(markdownPath))) {
      if (seenTargets.has(rawTarget)) {
        continue;
      }
      seenTargets.add(rawTarget);

      const normalized = normalizeLocalTarget(rawTarget);
      if (normalized === null) {
        continue;
      }
      if (normalized.error !== undefined) {
        report(relativePath(markdownPath) + ": " + normalized.error);
        continue;
      }

      const resolved = path.isAbsolute(normalized.target)
        ? normalized.target
        : path.resolve(path.dirname(markdownPath), normalized.target);
      if (!fs.existsSync(resolved)) {
        report(
          relativePath(markdownPath) +
            ": missing local link target " +
            rawTarget +
            " (resolved as " +
            relativePath(resolved) +
            ")",
        );
      }
    }
  }
});

runCheck("route stubs are superseded and route-only", (report) => {
  for (const routeStub of routeStubPaths) {
    const routePath = path.join(repositoryRoot, routeStub);
    if (!fs.existsSync(routePath)) {
      report(routeStub + ": missing route stub");
      continue;
    }

    let metadata;
    try {
      metadata = extractYamlMetadata(routePath);
    } catch (error) {
      report(error.message);
      continue;
    }

    if (metadata.status !== "superseded") {
      report(
        routeStub +
          ": expected status superseded, found " +
          String(metadata.status),
      );
    }
    if (metadata.route_only !== true) {
      report(
        routeStub +
          ": expected route_only true, found " +
          String(metadata.route_only),
      );
    }
  }
});

runCheck("P0 and P1 document status guards hold", (report) => {
  const expectations = new Map([
    ["README.md", "draft"],
    ["AGENTS.md", "draft"],
    ["PRODUCT.md", "draft"],
    ["CONTEXT.md", "draft"],
    ["ARCHITECTURE.md", "draft"],
    ["dev_docs/interfaces/completion-policy.md", "proposed"],
    ["dev_docs/planning/ROADMAP.md", "current"],
    ["dev_docs/planning/active/P0/DAG.md", "in_review"],
    ["dev_docs/planning/active/P0/tickets/06-user-review.md", "in_review"],
    ["dev_docs/planning/proposed/P1-foundation/DAG.md", "proposed"],
    ["dev_docs/evaluation/mvp-scenario.md", "proposed"],
    ["dev_docs/design/agent-entry-and-system-map.md", "draft"],
    ["dev_docs/product/用户需求原文.md", "source"],
  ]);

  for (const [documentPath, expectedStatus] of expectations) {
    const absolutePath = path.join(repositoryRoot, documentPath);
    if (!fs.existsSync(absolutePath)) {
      report(documentPath + ": missing status-guarded document");
      continue;
    }

    let metadata;
    try {
      metadata = extractYamlMetadata(absolutePath);
    } catch (error) {
      report(error.message);
      continue;
    }

    if (metadata.status !== expectedStatus) {
      report(
        documentPath +
          ": expected status " +
          expectedStatus +
          ", found " +
          String(metadata.status),
      );
    }
  }

  const graphMetadata = extractYamlMetadata(
    path.join(
      repositoryRoot,
      "dev_docs",
      "design",
      "agent-entry-and-system-map.md",
    ),
  );
  if (graphMetadata.source_of_truth !== false) {
    report(
      "dev_docs/design/agent-entry-and-system-map.md: source_of_truth must remain false",
    );
  }

  const sourceMetadata = extractYamlMetadata(
    path.join(repositoryRoot, "dev_docs", "product", "用户需求原文.md"),
  );
  if (sourceMetadata.default_agent_context !== false) {
    report(
      "dev_docs/product/用户需求原文.md: default_agent_context must remain false",
    );
  }
});

runCheck(
  "Architecture ModuleDependencyDAG is parseable and acyclic",
  (report) => {
    const graphProblems = [];
    const edges = extractArchitectureDependencyEdges(graphProblems);
    for (const problem of graphProblems) {
      report(problem);
    }

    const nodes = new Set();
    for (const edge of edges) {
      nodes.add(edge.from);
      nodes.add(edge.to);
    }

    const adjacency = new Map([...nodes].map((node) => [node, new Set()]));
    const indegree = new Map([...nodes].map((node) => [node, 0]));
    for (const edge of edges) {
      if (edge.from === edge.to) {
        report(
          relativePath(architecturePath) +
            ": self-cycle in ModuleDependencyDAG at " +
            edge.from,
        );
        continue;
      }
      if (!adjacency.get(edge.from).has(edge.to)) {
        adjacency.get(edge.from).add(edge.to);
        indegree.set(edge.to, indegree.get(edge.to) + 1);
      }
    }

    const queue = [...nodes].filter((node) => indegree.get(node) === 0).sort();
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      visited += 1;
      for (const successor of adjacency.get(current)) {
        indegree.set(successor, indegree.get(successor) - 1);
        if (indegree.get(successor) === 0) {
          queue.push(successor);
          queue.sort();
        }
      }
    }

    if (visited !== nodes.size) {
      const cycleMembers = [...nodes]
        .filter((node) => indegree.get(node) > 0)
        .sort();
      report(
        relativePath(architecturePath) +
          ": ModuleDependencyDAG contains a source dependency cycle involving " +
          cycleMembers.join(", "),
      );
    }
  },
);

runCheck("P1 ticket metadata matches an acyclic Mermaid DAG", (report) => {
  for (const problem of p1Model.problems) {
    report(problem);
  }

  const incoming = new Map(
    expectedTicketIds.map((ticketId) => [ticketId, new Set()]),
  );
  for (const edge of p1Model.edges) {
    if (incoming.has(edge.to)) {
      incoming.get(edge.to).add(edge.from);
    }
  }

  for (const ticketId of expectedTicketIds) {
    const ticket = p1Model.tickets.get(ticketId);
    if (ticket === undefined) {
      continue;
    }

    const metadata = ticket.metadata;
    if (metadata.status !== "proposed") {
      report(
        relativePath(ticket.filePath) +
          ": expected status proposed, found " +
          String(metadata.status),
      );
    }
    if (metadata.kind !== "tracer-bullet-vertical-slice") {
      report(
        relativePath(ticket.filePath) +
          ": expected kind tracer-bullet-vertical-slice, found " +
          String(metadata.kind),
      );
    }
    if (!Array.isArray(metadata.blocked_by)) {
      report(relativePath(ticket.filePath) + ": blocked_by must be a list");
      continue;
    }

    const declared = new Set(metadata.blocked_by);
    const drawn = incoming.get(ticketId) || new Set();
    const missingFromMermaid = setDifference(declared, drawn);
    const missingFromTicket = setDifference(drawn, declared);
    if (missingFromMermaid.length > 0 || missingFromTicket.length > 0) {
      report(
        relativePath(ticket.filePath) +
          ": blocked_by differs from Mermaid; ticket-only=[" +
          missingFromMermaid.join(", ") +
          "], Mermaid-only=[" +
          missingFromTicket.join(", ") +
          "]",
      );
    }
  }

  const adjacency = new Map(
    expectedTicketIds.map((ticketId) => [ticketId, new Set()]),
  );
  const indegree = new Map(expectedTicketIds.map((ticketId) => [ticketId, 0]));
  for (const edge of p1Model.edges) {
    if (!edge.from.startsWith("P1-") || !adjacency.has(edge.to)) {
      continue;
    }
    if (!adjacency.has(edge.from)) {
      report(relativePath(p1DagPath) + ": unknown ticket " + edge.from);
      continue;
    }
    if (!adjacency.get(edge.from).has(edge.to)) {
      adjacency.get(edge.from).add(edge.to);
      indegree.set(edge.to, indegree.get(edge.to) + 1);
    }
  }

  const queue = expectedTicketIds.filter(
    (ticketId) => indegree.get(ticketId) === 0,
  );
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    visited += 1;
    for (const successor of adjacency.get(current)) {
      indegree.set(successor, indegree.get(successor) - 1);
      if (indegree.get(successor) === 0) {
        queue.push(successor);
      }
    }
  }

  if (visited !== expectedTicketIds.length) {
    const cycleMembers = expectedTicketIds.filter(
      (ticketId) => indegree.get(ticketId) > 0,
    );
    report(
      relativePath(p1DagPath) +
        ": ticket graph contains a cycle involving " +
        cycleMembers.join(", "),
    );
  }
});

runCheck(
  "P1 artifact provenance is closed and outputs are unique",
  (report) => {
    const outputIndex = new Map();
    const interfaceOwnerIndex = new Map();

    for (const [ticketId, ticket] of p1Model.tickets) {
      const interfaces = ticket.metadata.interfaces_to_freeze ?? [];
      if (!Array.isArray(interfaces)) {
        report(
          relativePath(ticket.filePath) +
            ": interfaces_to_freeze must be a list",
        );
        continue;
      }

      for (const interfaceName of interfaces) {
        if (typeof interfaceName !== "string" || interfaceName.trim() === "") {
          report(
            relativePath(ticket.filePath) +
              ": every interfaces_to_freeze entry must be a non-empty string",
          );
          continue;
        }

        if (interfaceOwnerIndex.has(interfaceName)) {
          report(
            "interface " +
              interfaceName +
              " is first-frozen by both " +
              interfaceOwnerIndex.get(interfaceName) +
              " and " +
              ticketId,
          );
        } else {
          interfaceOwnerIndex.set(interfaceName, ticketId);
        }
      }
    }

    for (const [ticketId, ticket] of p1Model.tickets) {
      const outputs = ticket.metadata.output_artifacts;
      if (!Array.isArray(outputs)) {
        report(
          relativePath(ticket.filePath) + ": output_artifacts must be a list",
        );
        continue;
      }

      for (const artifact of outputs) {
        if (typeof artifact !== "string" || artifact.trim() === "") {
          report(
            relativePath(ticket.filePath) +
              ": every output_artifact must be a non-empty string",
          );
          continue;
        }

        if (outputIndex.has(artifact)) {
          report(
            "output artifact " +
              artifact +
              " is produced by both " +
              outputIndex.get(artifact) +
              " and " +
              ticketId,
          );
        } else {
          outputIndex.set(artifact, ticketId);
        }
      }
    }

    for (const [ticketId, ticket] of p1Model.tickets) {
      const inputs = ticket.metadata.input_artifacts;
      if (!Array.isArray(inputs)) {
        report(
          relativePath(ticket.filePath) + ": input_artifacts must be a list",
        );
        continue;
      }

      const ancestors = ticketAncestors(ticketId, p1Model.tickets);
      const seenInputs = new Set();

      for (const [index, input] of inputs.entries()) {
        const context =
          relativePath(ticket.filePath) + ": input_artifacts[" + index + "]";
        if (
          input === null ||
          typeof input !== "object" ||
          Array.isArray(input)
        ) {
          report(context + ": expected { artifact, source, producer }");
          continue;
        }

        const missingFields = ["artifact", "source", "producer"].filter(
          (field) =>
            typeof input[field] !== "string" || input[field].trim() === "",
        );
        if (missingFields.length > 0) {
          report(context + ": missing non-empty " + missingFields.join(", "));
          continue;
        }

        if (seenInputs.has(input.artifact)) {
          report(context + ": duplicate input artifact " + input.artifact);
        }
        seenInputs.add(input.artifact);

        if (!allowedArtifactSources.has(input.source)) {
          report(
            context +
              ": invalid source " +
              input.source +
              "; expected upstream, local_fixture, or external_input",
          );
          continue;
        }

        if (input.source === "local_fixture" && input.producer !== ticketId) {
          report(
            context +
              ": local_fixture producer must be " +
              ticketId +
              ", found " +
              input.producer,
          );
        }

        if (input.source === "upstream") {
          const producerTicket = p1Model.tickets.get(input.producer);
          if (producerTicket === undefined) {
            report(
              context +
                ": upstream producer is not a P1 ticket: " +
                input.producer,
            );
            continue;
          }
          if (!ancestors.has(input.producer)) {
            report(
              context +
                ": producer " +
                input.producer +
                " is not an ancestor of " +
                ticketId,
            );
          }

          const producerOutputs = Array.isArray(
            producerTicket.metadata.output_artifacts,
          )
            ? producerTicket.metadata.output_artifacts
            : [];
          if (!producerOutputs.includes(input.artifact)) {
            report(
              context +
                ": " +
                input.producer +
                " does not output " +
                input.artifact,
            );
          }
        }
      }
    }
  },
);

runCheck("release_gates and mvp_waits_for are aligned", (report) => {
  const releaseGates = p1Model.dagMetadata.release_gates;
  const mvpWaitsFor = p1Model.dagMetadata.mvp_waits_for;

  if (!Array.isArray(releaseGates) || releaseGates.length === 0) {
    report(
      relativePath(p1DagPath) + ": release_gates must be a non-empty list",
    );
    return;
  }
  if (!Array.isArray(mvpWaitsFor) || mvpWaitsFor.length === 0) {
    report(
      relativePath(p1DagPath) + ": mvp_waits_for must be a non-empty list",
    );
    return;
  }
  if (!arraysMatch(releaseGates, mvpWaitsFor)) {
    report(
      relativePath(p1DagPath) +
        ": release_gates [" +
        releaseGates.join(", ") +
        "] != mvp_waits_for [" +
        mvpWaitsFor.join(", ") +
        "]",
    );
  }

  if (new Set(releaseGates).size !== releaseGates.length) {
    report(relativePath(p1DagPath) + ": release_gates contains duplicates");
  }
});

runCheck("P0-01 archive payload SHA-256 digests match", (report) => {
  for (const [payloadPath, expectedDigest] of p0ArchivePayloadDigests) {
    const absolutePath = path.join(repositoryRoot, payloadPath);
    if (!fs.existsSync(absolutePath)) {
      report(payloadPath + ": missing archived payload");
      continue;
    }

    const actualDigest = createHash("sha256")
      .update(fs.readFileSync(absolutePath))
      .digest("hex");
    if (actualDigest !== expectedDigest) {
      report(
        payloadPath +
          ": SHA-256 mismatch; expected " +
          expectedDigest +
          ", found " +
          actualDigest,
      );
    }
  }
});

runCheck(
  "completed P0-01..05 tickets have resolvable evidence_refs",
  (report) => {
    const p0TicketsDirectory = path.join(
      repositoryRoot,
      "dev_docs",
      "planning",
      "active",
      "P0",
      "tickets",
    );
    const entries = fs.readdirSync(p0TicketsDirectory);

    for (const ticketNumber of p0EvidenceTicketIds) {
      const matches = entries.filter((name) =>
        name.startsWith(ticketNumber + "-"),
      );
      if (matches.length !== 1) {
        report(
          relativePath(p0TicketsDirectory) +
            ": expected one P0-" +
            ticketNumber +
            " ticket, found " +
            matches.length,
        );
        continue;
      }

      const ticketPath = path.join(p0TicketsDirectory, matches[0]);
      let metadata;
      try {
        metadata = extractYamlMetadata(ticketPath);
      } catch (error) {
        report(error.message);
        continue;
      }

      if (metadata.status !== "completed") {
        report(
          relativePath(ticketPath) +
            ": expected completed, found " +
            String(metadata.status),
        );
      }
      if (
        !Array.isArray(metadata.evidence_refs) ||
        metadata.evidence_refs.length === 0
      ) {
        report(relativePath(ticketPath) + ": missing evidence_refs");
        continue;
      }

      for (const evidenceReference of metadata.evidence_refs) {
        if (
          typeof evidenceReference !== "string" ||
          evidenceReference.trim() === ""
        ) {
          report(relativePath(ticketPath) + ": evidence_ref must be a string");
          continue;
        }

        const [rawTarget, rawFragment = ""] = evidenceReference.split("#", 2);
        const evidencePath = path.resolve(path.dirname(ticketPath), rawTarget);
        if (!fs.existsSync(evidencePath)) {
          report(
            relativePath(ticketPath) +
              ": missing evidence target " +
              evidenceReference,
          );
          continue;
        }

        if (rawFragment !== "") {
          let fragment = rawFragment;
          try {
            fragment = decodeURIComponent(rawFragment).toLowerCase();
          } catch {
            report(
              relativePath(ticketPath) +
                ": invalid evidence anchor " +
                evidenceReference,
            );
            continue;
          }

          if (!headingAnchors(readText(evidencePath)).has(fragment)) {
            report(
              relativePath(ticketPath) +
                ": missing evidence anchor #" +
                rawFragment +
                " in " +
                relativePath(evidencePath),
            );
          }
        }
      }
    }
  },
);

runCheck("no patch backup artifacts remain", (report) => {
  for (const filePath of allRepositoryFiles) {
    if (filePath.endsWith(".orig") || filePath.endsWith(".rej")) {
      report(relativePath(filePath));
    }
  }
});

runCheck("module registry routes cover dependency graph", (report) => {
  const architecture = readText(architecturePath);
  const registry = architecture.split("## Module Registry")[1]?.split("## ModuleDependencyDAG")[0] ?? "";
  const names = new Set([...registry.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]\(dev_docs\/modules\/[^)]+\)/g)].map(match => match[1]));
  const problems = [];
  for (const {from, to} of extractArchitectureDependencyEdges(problems)) {
    for (const name of [from, to]) {
      if (name === "Apps" || name.endsWith("Adapter")) continue;
      if (!names.has(name)) report("Module " + name + " has no registry document route");
    }
  }
  for (const issue of problems) report(issue);
});

runCheck("G3 requires the complete role collaboration slice", (report) => {
  const dag = readText(p1DagPath);
  for (const edge of ["T07", "T15"]) {
    if (!new RegExp("^\\s*" + edge + "\\s*-->\\s*G3(?:\\[|\\s*$)", "m").test(dag)) {
      report("G3 must consume " + edge);
    }
  }
  const ticket = p1Model.tickets.get("P1-15");
  if (!ticket?.metadata.output_artifacts?.includes("autonomous-role-feedback-trace")) {
    report("P1-15 must deliver the role feedback trace");
  }
});

runCheck("Context continuity and completed-work inheritance gate coverage", (report) => {
  const requiredEdges = [
    ["P1-16", "P1-06"], ["P1-17", "P1-16"], ["P1-17", "P1-05"],
    ["P1-09", "P1-16"], ["P1-10", "P1-16"], ["P1-15", "P1-17"],
  ];
  for (const [consumer, producer] of requiredEdges) {
    if (!p1Model.tickets.get(consumer)?.metadata.blocked_by?.includes(producer)) {
      report(consumer + " must consume " + producer);
    }
  }
  const dag = readText(p1DagPath);
  if (!/^\s*T16\s*-->\s*G2(?:\[|\s*$)/m.test(dag)) {
    report("G2 must consume P1-16 context continuity evidence");
  }
  for (const [id, artifact] of [
    ["P1-16", "context-continuity-evidence"],
    ["P1-17", "completed-work-context-evidence"],
    ["P1-15", "cross-work-package-decision-feedback"],
  ]) {
    if (!p1Model.tickets.get(id)?.metadata.output_artifacts?.includes(artifact)) {
      report(id + " must produce " + artifact);
    }
  }
});

const failed = results.filter((result) => result.issues.length > 0);
const passedCount = results.length - failed.length;

console.log("");
console.log(
  "Documentation validation: " +
    passedCount +
    "/" +
    results.length +
    " checks passed.",
);

if (failed.length > 0) {
  const issueCount = failed.reduce(
    (total, result) => total + result.issues.length,
    0,
  );
  console.log(
    "Found " +
      issueCount +
      " issue" +
      (issueCount === 1 ? "" : "s") +
      " across " +
      failed.length +
      " failed check" +
      (failed.length === 1 ? "" : "s") +
      ".",
  );
  process.exitCode = 1;
} else {
  console.log("All documentation governance checks passed.");
}
