"use strict";

const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

it("uses Electron networking for chat so system proxy settings apply", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(source.split("\n")[0], /\bnet\b/);
  const init = source.match(/const _chatModel = createChatSetup\([\s\S]*?\);/);
  assert.ok(init);
  const calls = [];
  let options;
  vm.runInNewContext(init[0], {
    createChatSetup(value) { options = value; return {}; },
    app: { getPath: () => "user-data" },
    safeStorage: {},
    net: { fetch: async (...args) => { calls.push(args); return "reply"; } },
  });
  const request = { method: "POST" };
  assert.equal(options.dataDir, "user-data");
  assert.equal(await options.fetch("https://api.openai.com/v1/responses", request), "reply");
  assert.deepEqual(calls, [["https://api.openai.com/v1/responses", request]]);
});
