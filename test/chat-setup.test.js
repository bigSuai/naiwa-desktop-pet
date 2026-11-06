"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const setupModule = path.join(__dirname, "../src/chat-setup.js");

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-setup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const encrypted = Buffer.from("synthetic-encrypted-blob");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "test-keyring",
    encryptString: (key) => { assert.equal(key, "sk-synthetic-only"); return encrypted; },
    decryptString: (blob) => { assert.deepEqual(blob, encrypted); return "sk-synthetic-only"; },
  };
  assert.ok(fs.existsSync(setupModule), "chat setup module must exist");
  const { createChatSetup } = require(setupModule);
  const calls = [];
  const setup = createChatSetup({
    dataDir: path.join(dir, "userData"), safeStorage,
    env: { CLAWD_DATA_DIR: path.join(dir, "legacy"), OPENCLAW_CONFIG_PATH: path.join(dir, "missing.json") },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] }) };
    },
    ...overrides,
  });
  return { setup, dir, calls, safeStorage, file: path.join(dir, "userData", "chat-config.json") };
}

test("first run exposes only safe setup metadata without network or file writes", (t) => {
  const { setup, file, calls } = fixture(t);
  assert.deepEqual(setup.getSetup(), { status: "ok", model: "gpt-6-luna", configured: false, encryptionAvailable: true });
  assert.equal(setup.getStatus().status, "error");
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("factory construction is lazy before Electron app readiness", (t) => {
  let storageCalls = 0;
  const failBeforeReady = () => { storageCalls++; throw new Error("app is not ready"); };
  const safeStorage = { isEncryptionAvailable: failBeforeReady, encryptString: failBeforeReady, decryptString: failBeforeReady, getSelectedStorageBackend: failBeforeReady };
  const { file, calls } = fixture(t, { safeStorage, readConfig: () => { throw new Error("must not read during construction"); } });
  assert.equal(storageCalls, 0);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("saves only safeStorage ciphertext atomically and reloads from userData", async (t) => {
  const { setup, file, calls } = fixture(t);
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "ok");
  const raw = fs.readFileSync(file, "utf8");
  assert.ok(!raw.includes("sk-synthetic-only"));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["chat-config.json"]);
  assert.equal(setup.getSetup().configured, true);
  assert.ok(!JSON.stringify(setup.getSetup()).includes("apiKey"));
  assert.ok(!JSON.stringify(setup.getSetup()).includes("synthetic-encrypted"));
  assert.equal(setup.getStatus().primary, "openai/gpt-6-luna");
  assert.equal((await setup.sendMessage({ messages: [{ role: "user", text: "hello" }] })).text, "OK");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-synthetic-only");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(setup.saveSetup({ model: "gpt-next", apiKey: "" }).status, "ok");
  assert.equal(setup.getSetup().model, "gpt-next");
});

test("connection test makes one minimal injected request without persisting or returning output", async (t) => {
  const { setup, calls, file } = fixture(t);
  const result = await setup.testSetup({ apiKey: "sk-synthetic-only" });
  assert.equal(result.status, "ok");
  assert.equal(result.text, undefined);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.store, false);
  assert.ok(body.max_output_tokens <= 16);
  assert.equal(body.input.length, 1);
  assert.equal(fs.existsSync(file), false);
  assert.equal(setup.getSetup().configured, false);
});

test("connection errors and successful replies cannot echo the key and are not retried", async (t) => {
  let count = 0;
  const { setup } = fixture(t, { fetch: async () => { count++; throw new Error("Bearer sk-synthetic-only"); } });
  const result = await setup.testSetup({ apiKey: "sk-synthetic-only" });
  assert.equal(result.status, "error");
  assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
  assert.equal(count, 1);
});

for (const backend of ["unavailable", "basic_text"]) {
  test(`rejects saving when secure encryption is ${backend}`, (t) => {
    const safeStorage = { isEncryptionAvailable: () => backend !== "unavailable", getSelectedStorageBackend: () => backend };
    const { setup, file } = fixture(t, { safeStorage });
    assert.equal(setup.getSetup().encryptionAvailable, false);
    assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "error");
    assert.equal(fs.existsSync(file), false);
  });
}

test("invalid models, keys and third-party endpoint options never fetch or write", async (t) => {
  const { setup, calls, file } = fixture(t);
  for (const payload of [null, { model: "https://evil.test", apiKey: "sk-synthetic-only" }, { model: "a\nb", apiKey: "sk-synthetic-only" }, { model: "gpt-6-luna", apiKey: "bad\nkey" }, { apiKey: "sk-synthetic-only", baseURL: "https://evil.test" }]) {
    assert.equal(setup.saveSetup(payload).status, "error");
    assert.equal((await setup.testSetup(payload)).status, "error");
  }
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("legacy DPAPI configuration remains readable and untouched", async (t) => {
  const { setup, dir } = fixture(t, {
    readConfig: () => ({ agents: { defaults: { model: "openai/legacy-model" } }, models: { providers: { openai: {
      api: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKeyDpapiFile: "synthetic.dpapi",
    } } } }),
    readApiKeyFile: () => "sk-synthetic-only",
  });
  assert.equal(setup.getSetup().model, "legacy-model");
  assert.equal(setup.getSetup().configured, true);
  assert.equal((await setup.sendMessage({ messages: [{ role: "user", text: "hello" }] })).status, "ok");
  assert.deepEqual(fs.readdirSync(dir), []);
});

for (const action of ["testSetup", "saveSetup"]) {
  test(`blank key reuses the active official legacy DPAPI credential for ${action}`, async (t) => {
    let credentialPath;
    const { setup, dir, file, calls } = fixture(t, {
      readApiKeyFile: (requestedPath) => {
        assert.equal(requestedPath, credentialPath);
        return "sk-synthetic-only";
      },
    });
    const legacyPath = path.join(dir, "legacy", "chat-config.json");
    credentialPath = path.join(dir, "legacy", "synthetic.dpapi");
    const legacy = JSON.stringify({ agents: { defaults: { model: "openai/legacy-model" } }, models: { providers: { openai: {
      api: "openai-responses", baseUrl: "https://api.openai.com/v1", apiKeyDpapiFile: credentialPath,
    } } } });
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, legacy);
    fs.writeFileSync(credentialPath, "synthetic-dpapi-blob");
    assert.equal(setup.getSetup().configured, true);
    const result = await setup[action]({ model: "gpt-next", apiKey: "" });
    assert.equal(result.status, "ok");
    assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
    assert.ok(!JSON.stringify(setup.getSetup()).includes("synthetic-dpapi-blob"));
    assert.equal(fs.readFileSync(legacyPath, "utf8"), legacy);
    assert.equal(fs.readFileSync(credentialPath, "utf8"), "synthetic-dpapi-blob");
    if (action === "testSetup") {
      assert.equal(fs.existsSync(file), false);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
      assert.equal(calls[0].options.headers.Authorization, "Bearer sk-synthetic-only");
    } else {
      assert.equal(calls.length, 0);
      const saved = fs.readFileSync(file, "utf8");
      assert.ok(!saved.includes("sk-synthetic-only"));
      assert.ok(!saved.includes("apiKeyDpapiFile"));
      assert.ok(JSON.parse(saved).models.providers.openai.apiKeyEncrypted);
      assert.equal(setup.getSetup().model, "gpt-next");
    }
  });
}

test("blank key never reuses a third-party candidate even with the openai provider name", async (t) => {
  let baseUrl;
  const { setup, calls, file } = fixture(t, { readConfig: () => ({ model: "openai/legacy-model", models: { providers: { openai: {
    api: "openai-responses", baseUrl, apiKey: "sk-synthetic-only",
  } } } }) });
  for (baseUrl of ["https://third-party.test/v1", "https://api.openai.com.evil.test/v1", "https://api.openai.com/v1/other", "https://api.openai.com@evil.test/v1"]) {
    assert.equal(setup.getSetup().configured, true);
    assert.equal((await setup.testSetup({ apiKey: "" })).status, "error");
    assert.equal(setup.saveSetup({}).status, "error");
  }
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(file), false);
});

test("blank key rejects a saved ciphertext with a third-party endpoint before decryption", async (t) => {
  const { setup, file, safeStorage, calls } = fixture(t);
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "ok");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.models.providers.openai.baseUrl = "https://third-party.test/v1";
  const original = JSON.stringify(config);
  fs.writeFileSync(file, original);
  let decrypts = 0;
  safeStorage.decryptString = () => { decrypts++; return "sk-synthetic-only"; };
  assert.equal(setup.saveSetup({ apiKey: "" }).status, "error");
  assert.equal((await setup.testSetup({})).status, "error");
  assert.equal(decrypts, 0);
  assert.equal(calls.length, 0);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("userData wins over legacy and corrupt userData never silently falls back", (t) => {
  const { setup, file, dir } = fixture(t);
  fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
  const legacy = path.join(dir, "legacy", "chat-config.json");
  const original = JSON.stringify({ model: "legacy/model", models: { providers: { legacy: { apiKey: "fake-legacy-key" } } } });
  fs.writeFileSync(legacy, original);
  assert.equal(setup.getSetup().model, "model");
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "ok");
  assert.equal(setup.getSetup().model, "gpt-6-luna");
  assert.equal(fs.readFileSync(legacy, "utf8"), original);
  fs.writeFileSync(file, '{"apiKey":"sk-synthetic-only",broken');
  const result = setup.getSetup();
  assert.equal(result.configured, false);
  assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
});

test("failed atomic replacement preserves the existing configuration and removes temp files", (t) => {
  const { setup, file } = fixture(t);
  fs.mkdirSync(file, { recursive: true });
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "error");
  assert.ok(fs.statSync(file).isDirectory());
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["chat-config.json"]);
});

test("rename failures preserve a previous saved file with no ciphertext temp files left", (t) => {
  const { setup, file } = fixture(t);
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "ok");
  const previous = fs.readFileSync(file, "utf8");
  t.mock.method(fs, "renameSync", () => { throw new Error("sk-synthetic-only"); });
  const result = setup.saveSetup({ model: "next-model", apiKey: "sk-synthetic-only" });
  assert.equal(result.status, "error");
  assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["chat-config.json"]);
});

test("encryption and decryption exceptions do not expose secrets or touch existing data", async (t) => {
  const { setup, safeStorage, file } = fixture(t);
  setup.saveSetup({ apiKey: "sk-synthetic-only" });
  const previous = fs.readFileSync(file, "utf8");
  safeStorage.encryptString = () => { throw new Error("sk-synthetic-only"); };
  assert.equal(setup.saveSetup({ apiKey: "sk-synthetic-only" }).status, "error");
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  safeStorage.decryptString = () => { throw new Error("sk-synthetic-only"); };
  assert.equal(setup.getSetup().configured, false);
  assert.ok(!JSON.stringify(setup.getStatus()).includes("sk-synthetic-only"));
  await assert.rejects(setup.sendMessage({ messages: [{ role: "user", text: "hello" }] }), (err) => !err.message.includes("sk-synthetic-only"));
});

test("does not use global fetch without an injected Electron network function", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Should not be called"); });
  const { setup } = fixture(t, { fetch: undefined });
  assert.equal((await setup.testSetup({ apiKey: "sk-synthetic-only" })).status, "error");
  assert.equal(calls, 0);
});

test("successful connection tests discard all provider text including secret echoes", async (t) => {
  const { setup, file } = fixture(t, { fetch: async () => ({ ok: true, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: "sk-synthetic-only" }] }] }) }) });
  const result = await setup.testSetup({ apiKey: "sk-synthetic-only" });
  assert.equal(result.status, "ok");
  assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
  assert.equal(fs.existsSync(file), false);
});
