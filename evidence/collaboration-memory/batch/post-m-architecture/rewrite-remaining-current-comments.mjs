import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "src"], {
  encoding: "utf8",
}).split(/\r?\n/).filter((file) => /\.(?:ts|tsx|mjs)$/.test(file) && existsSync(file));

const changed = [];
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  after = after.replace(/ENTRY FILE \(shared baseline[^)]*\)\./gi, "Public entry.");
  after = after.replace(/ENTRY FILE \(shared baseline[^\n]*\n \* [^)]*\)\./gi, "Public entry.");
  after = after.replaceAll("ticket Acceptance", "versioned contract");
  after = after.replaceAll("ticket acceptance", "versioned contract");
  after = after.replaceAll("integrator pre-ruling", "recorded contract");
  after = after.replaceAll("shared baseline", "versioned contract");
  after = after.replaceAll("P1 scale", "the current bounded event volume");
  after = after.replaceAll("（P11）：", "");
  after = after.replaceAll("ticket acceptance 6/8/9/12", "the collaboration contract");
  if (after !== before) {
    writeFileSync(file, after);
    changed.push(file);
  }
}

process.stdout.write(JSON.stringify({ changed }, null, 2) + "\n");
