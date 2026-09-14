import assert from "node:assert/strict";

import { effectiveTimeout } from "./src/timeout.mjs";

assert.equal(effectiveTimeout({}, 5000), 5000);
assert.equal(effectiveTimeout({ timeoutMs: 250 }, 5000), 250);
console.log("public tests passed");
