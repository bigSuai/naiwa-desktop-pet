"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  createOpenClawChatModel,
  loadOpenClawChatConfig,
  normalizeIncomingMessages,
  parseModelRef,
  resolveModelSelection,
  resolveChatConfigPath,
} = require("../src/chat-model");

function response(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    statusText: options.statusText || "OK",
    json: async () => body,
  };
}

function createConfig() {
  return {
    agents: {
      defaults: {
        model: {
          primary: "primary/gpt-main",
          fallbacks: ["fallback/claude-vision", "secondary/gpt-backup"],
        },
        timeoutSeconds: 30,
      },
    },
    models: {
      providers: {
        primary: {
          api: "openai-completions",
          baseUrl: "https://primary.example/v1",
          apiKey: "primary-key",
          models: [{ id: "gpt-main", input: ["text", "image"], maxTokens: 4096 }],
        },
        fallback: {
          api: "anthropic-messages",
          baseUrl: "https://fallback.example",
          apiKey: "fallback-key",
          models: [{ id: "claude-vision", input: ["text", "image"], maxTokens: 4096 }],
        },
        secondary: {
          api: "openai-completions",
          baseUrl: "https://secondary.example/v1",
          apiKey: "secondary-key",
          models: [{ id: "gpt-backup", input: ["text"], maxTokens: 4096 }],
        },
      },
    },
  };
}

describe("chat model config", () => {
  it("prefers a pet-only config without changing the OpenClaw default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-config-"));
    const configPath = path.join(dir, "chat-config.json");
    fs.writeFileSync(configPath, "{}");
    try {
      assert.strictEqual(resolveChatConfigPath({ CLAWD_DATA_DIR: dir }), configPath);
      fs.unlinkSync(configPath);
      assert.strictEqual(resolveChatConfigPath({ CLAWD_DATA_DIR: dir, OPENCLAW_CONFIG_PATH: "legacy.json" }), "legacy.json");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never sends the encrypted official credential to a third-party URL", () => {
    const config = createConfig();
    config.models.providers.primary.apiKeyDpapiFile = "credential.dpapi";
    let reads = 0;
    assert.throws(() => loadOpenClawChatConfig({
      configPath: "memory.json", readConfig: () => config,
      readApiKeyFile: () => { reads++; return "secret"; },
    }), /official OpenAI endpoint/);
    assert.strictEqual(reads, 0);
  });

  it("resolves OpenClaw default primary and fallbacks", () => {
    const cfg = loadOpenClawChatConfig({
      configPath: "memory.json",
      readConfig: () => createConfig(),
    });

    assert.strictEqual(cfg.selection.primary, "primary/gpt-main");
    assert.deepStrictEqual(cfg.selection.fallbacks, ["fallback/claude-vision", "secondary/gpt-backup"]);
    assert.deepStrictEqual(cfg.candidates.map((candidate) => candidate.ref), [
      "primary/gpt-main",
      "fallback/claude-vision",
      "secondary/gpt-backup",
    ]);
    assert.strictEqual(cfg.candidates[0].api, "openai-completions");
    assert.strictEqual(cfg.candidates[1].api, "anthropic-messages");
  });

  it("loads UTF-8 BOM prefixed OpenClaw config files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-chat-"));
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(configPath, `\uFEFF${JSON.stringify(createConfig())}`);
    try {
      const cfg = loadOpenClawChatConfig({ configPath });
      assert.strictEqual(cfg.selection.primary, "primary/gpt-main");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts string model selections", () => {
    assert.deepStrictEqual(resolveModelSelection("openai/gpt-5"), {
      primary: "openai/gpt-5",
      fallbacks: [],
      ordered: ["openai/gpt-5"],
    });
  });

  it("parses provider/model references on the first slash", () => {
    assert.deepStrictEqual(parseModelRef("openrouter/meta/llama"), {
      ref: "openrouter/meta/llama",
      providerId: "openrouter",
      modelId: "meta/llama",
    });
  });
});

describe("chat model requests", () => {
  it("does not leak config parser details through status or sends", async () => {
    const model = createOpenClawChatModel({ readConfig: () => { throw new Error("invalid JSON: private-config-key"); }, configPath: "memory.json", fetch: async () => {} });
    assert.ok(!model.getStatus().message.includes("private-config-key"));
    await assert.rejects(model.sendMessage({ messages: [{ role: "user", text: "hello" }] }), (err) => {
      assert.ok(!err.message.includes("private-config-key")); return true;
    });
  });

  it("redacts all configured keys in replies, attempts and thrown provider errors", async () => {
    const config = createConfig();
    const model = createOpenClawChatModel({
      configPath: "memory.json", readConfig: () => config,
      fetch: async () => { throw new Error("leaked primary-key fallback-key secondary-key"); },
    });
    await assert.rejects(model.sendMessage({ messages: [{ role: "user", text: "hi" }] }), (err) => {
      assert.ok(!JSON.stringify({ message: err.message, attempts: err.attempts }).includes("primary-key"));
      assert.ok(!JSON.stringify(err.attempts).includes("fallback-key"));
      return true;
    });
    const echo = createOpenClawChatModel({
      configPath: "memory.json", readConfig: () => config,
      fetch: async () => response({ choices: [{ message: { content: "primary-key fallback-key" } }] }),
    });
    assert.ok(!(await echo.sendMessage({ messages: [{ role: "user", text: "hi" }] })).text.includes("primary-key"));
  });

  it("decrypts safeStorage only for an official endpoint and never exposes ciphertext", () => {
    const config = createConfig();
    config.agents.defaults.model = "openai/gpt-6-luna";
    config.models.providers.openai = { api: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKeyEncrypted: Buffer.from("fake-cipher").toString("base64") };
    let decrypts = 0;
    const options = { configPath: "memory.json", readConfig: () => config, safeStorage: {
      isEncryptionAvailable: () => true,
      decryptString: () => { decrypts++; return "fake-decrypted-key"; },
    } };
    assert.equal(loadOpenClawChatConfig(options).candidates[0].apiKey, "fake-decrypted-key");
    config.models.providers.openai.baseUrl = "https://third-party.test/v1";
    assert.throws(() => loadOpenClawChatConfig(options), /official OpenAI endpoint/);
    assert.equal(decrypts, 1);
  });

  it("keeps the timeout active until the response body is received", async () => {
    const config = createConfig();
    config.agents.defaults.model = "primary/gpt-main";
    config.models.providers.primary.timeoutSeconds = 0.001;
    const model = createOpenClawChatModel({
      configPath: "memory.json", readConfig: () => config,
      fetch: async (_url, opts) => ({
        ok: true,
        json: () => new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ choices: [{ message: { content: "too late" } }] }), 1300);
          opts.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Timed out reading body"));
          }, { once: true });
        }),
      }),
    });
    await assert.rejects(model.sendMessage({ messages: [{ role: "user", text: "hi" }] }), /did not contain text|Timed out/);
  });

  it("uses official Responses for Luna with images and no server-side storage", async () => {
    const config = createConfig();
    config.agents.defaults.model = "openai/gpt-6-luna";
    config.models.providers.openai = {
      api: "openai-responses", baseUrl: "https://api.openai.com/v1",
      apiKeyDpapiFile: "credential.dpapi",
      models: [{ id: "gpt-6-luna", input: ["text", "image"] }],
    };
    let call;
    const model = createOpenClawChatModel({
      configPath: "memory.json", readConfig: () => config,
      readApiKeyFile: () => "official-key",
      fetch: async (url, opts) => {
        call = { url, headers: opts.headers, body: JSON.parse(opts.body) };
        return response({ status: "completed", output: [{
          type: "message", content: [{ type: "output_text", text: "Luna reply" }],
        }] });
      },
    });
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = await model.sendMessage({ messages: [
      { role: "user", text: "hi" }, { role: "assistant", text: "hello" },
      { role: "user", text: "look", images: [png] },
    ] });
    assert.strictEqual(result.text, "Luna reply");
    assert.strictEqual(call.url, "https://api.openai.com/v1/responses");
    assert.strictEqual(call.headers.Authorization, "Bearer official-key");
    assert.strictEqual(call.body.model, "gpt-6-luna");
    assert.strictEqual(call.body.store, false);
    assert.strictEqual(call.body.reasoning.effort, "none");
    assert.strictEqual(call.body.input[1].content[0].type, "output_text");
    assert.deepStrictEqual(call.body.input[2].content[1], { type: "input_image", image_url: png });
    assert.ok(!JSON.stringify(model.getStatus()).includes("official-key"));
  });

  it("tries the fallback model after a primary provider failure", async () => {
    const calls = [];
    const model = createOpenClawChatModel({
      configPath: "memory.json",
      readConfig: () => createConfig(),
      fetch: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
        if (calls.length === 1) {
          return response({ error: { message: "primary down" } }, { ok: false, status: 500, statusText: "Down" });
        }
        return response({ content: [{ type: "text", text: "fallback reply" }] });
      },
    });

    const result = await model.sendMessage({
      messages: [{ role: "user", text: "hello" }],
    });

    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.text, "fallback reply");
    assert.strictEqual(result.model, "fallback/claude-vision");
    assert.strictEqual(result.fallbackUsed, true);
    assert.strictEqual(calls[0].url, "https://primary.example/v1/chat/completions");
    assert.strictEqual(calls[1].url, "https://fallback.example/v1/messages");
    assert.strictEqual(calls[1].headers["x-api-key"], "fallback-key");
  });

  it("passes pasted images to image-capable models", async () => {
    const calls = [];
    const model = createOpenClawChatModel({
      configPath: "memory.json",
      readConfig: () => createConfig(),
      fetch: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return response({ choices: [{ message: { content: "saw image" } }] });
      },
    });

    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = await model.sendMessage({
      messages: [{ role: "user", text: "what is this?", images: [{ dataUrl: png }] }],
    });

    assert.strictEqual(result.text, "saw image");
    const content = calls[0].body.messages[1].content;
    assert.strictEqual(content[0].type, "text");
    assert.strictEqual(content[1].type, "image_url");
    assert.strictEqual(content[1].image_url.url, png);
  });

  it("skips non-image fallback models when an image is present", async () => {
    const config = createConfig();
    config.agents.defaults.model = {
      primary: "secondary/gpt-backup",
      fallbacks: ["fallback/claude-vision"],
    };
    const calls = [];
    const model = createOpenClawChatModel({
      configPath: "memory.json",
      readConfig: () => config,
      fetch: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return response({ content: [{ type: "text", text: "vision fallback" }] });
      },
    });

    const result = await model.sendMessage({
      messages: [{ role: "user", text: "look", images: [{ dataUrl: "data:image/jpeg;base64,abcd" }] }],
    });

    assert.strictEqual(result.text, "vision fallback");
    assert.strictEqual(result.model, "fallback/claude-vision");
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].body.messages[0].content[1].source.media_type, "image/jpeg");
  });

  it("normalizes message history without accepting arbitrary image URLs", () => {
    const messages = normalizeIncomingMessages([
      { role: "user", text: "hi", images: ["https://example.com/not-accepted.png"] },
      { role: "assistant", text: "hello" },
    ]);

    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0].images, []);
    assert.strictEqual(messages[1].role, "assistant");
  });
});
