import assert from "node:assert/strict";

import { effectsToReplay } from "./src/recover.mjs";

const pending = [{ id: "a" }, { id: "b" }];
assert.deepEqual(effectsToReplay(pending, []), pending);
console.log("public tests passed");
