import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

try {
  const workspace = path.resolve(process.argv[2]);
  const moduleUrl = `${pathToFileURL(path.join(workspace, "src/timeout.mjs")).href}?trial=${Date.now()}`;
  const { effectiveTimeout } = await import(moduleUrl);
  assert.equal(effectiveTimeout({}, 5000), 5000);
  assert.equal(effectiveTimeout({ timeoutMs: undefined }, 5000), 5000);
  assert.equal(effectiveTimeout({ timeoutMs: null }, 5000), 5000);
  assert.equal(effectiveTimeout({ timeoutMs: 0 }, 5000), 0);
  assert.equal(effectiveTimeout({ timeoutMs: -1 }, 5000), -1);
  process.stdout.write('{"resolved":true,"checks":5}\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "assertion failed"}\n`);
  process.exitCode = 1;
}
