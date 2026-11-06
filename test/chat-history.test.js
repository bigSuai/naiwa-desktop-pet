"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  createChatHistoryStore,
  resolveDefaultChatHistoryPath,
} = require("../src/chat-history");

function makeTempPath(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-chat-history-"));
  if (t && typeof t.after === "function") {
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return path.join(dir, "history.json");
}

describe("chat history", () => {
  it("defaults to the E-drive project data directory unless overridden", () => {
    assert.ok(resolveDefaultChatHistoryPath({}).endsWith(path.join(".clawd-data", "chat-history.json")));
    assert.strictEqual(
      resolveDefaultChatHistoryPath({ CLAWD_DATA_DIR: "E:\\ClawdData" }),
      path.join("E:\\ClawdData", "chat-history.json")
    );
    assert.strictEqual(
      resolveDefaultChatHistoryPath({ CLAWD_CHAT_HISTORY_PATH: "E:\\ClawdData\\custom.json" }),
      "E:\\ClawdData\\custom.json"
    );
  });

  it("saves, loads, and clears normalized messages", (t) => {
    const historyPath = makeTempPath(t);
    const store = createChatHistoryStore({ filePath: historyPath });

    const saved = store.save({
      messages: [
        { role: "user", text: "hello", images: [{ dataUrl: "data:image/png;base64,AAAA" }] },
        { role: "assistant", text: "hi", meta: "openclaw/model" },
        { role: "debug", text: "" },
      ],
    });

    assert.strictEqual(saved.status, "ok");
    assert.strictEqual(fs.existsSync(historyPath), true);
    assert.deepStrictEqual(store.load().messages.map((message) => message.role), ["user", "assistant"]);

    const cleared = store.clear();
    assert.strictEqual(cleared.status, "ok");
    assert.strictEqual(fs.existsSync(historyPath), true, "an empty marker prevents importing cleared legacy history again");
    assert.deepStrictEqual(store.load().messages, []);
  });

  it("trims old messages to stay within the configured file budget", (t) => {
    const store = createChatHistoryStore({ filePath: makeTempPath(t), maxBytes: 800 });
    const payload = {
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        text: `message ${index} ${"x".repeat(80)}`,
      })),
    };

    const saved = store.save(payload);
    assert.strictEqual(saved.status, "ok");
    assert.ok(saved.messages.length < payload.messages.length);
    assert.ok(saved.messages.at(-1).text.startsWith("message 29"));
  });
});
