"use strict";
const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { shouldInclude, scanPublicSource } = require("../scripts/prepare-public-source");

it("excludes local credentials, history, backups and verification reports", () => {
  for (const file of [".clawd-data/chat-config.json", ".clawd-data/chat-history.json", ".env", "key.dpapi", "node_modules/a.js", "themes/naiwa/VALIDATION.md", "assets/source/naiwa/motion-20261106/restore-theme.ps1", "启动Clawd.ps1"]) {
    assert.equal(shouldInclude(file), false, file);
  }
  for (const file of ["src/main.js", "src/chat-setup.js", "test/chat-setup.test.js", "LICENSE", "themes/naiwa/theme.json", "themes/naiwa/assets/naiwa-working.png", "assets/source/naiwa/target/001.png", "assets/source/naiwa/laugh-restoration-20261106/raw-target/001.png"]) {
    assert.equal(shouldInclude(file), true, file);
  }
});

it("detects leaked credentials without echoing their value", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "naiwa-public-scan-"));
  const secret = "sk-proj-" + "A".repeat(60);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "leak.js"), JSON.stringify({ apiKey: secret }));
  try {
    const violations = scanPublicSource(root);
    assert.equal(violations[0].file, "src/leak.js");
    assert.equal(violations[0].kind, "credential");
    assert.ok(!JSON.stringify(violations).includes(secret));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
