"use strict";

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { createOpenClawChatModel, loadOpenClawChatConfig, isSecureStorageAvailable } = require("./chat-model");

const DEFAULT_MODEL = "gpt-6-luna";
const OFFICIAL_BASE = "https://api.openai.com/v1";

function officialConfig(model, credentials, maxTokens = 2048) {
  return {
    agents: { defaults: { model: `openai/${model}` } },
    models: { providers: { openai: {
      api: "openai-responses", baseUrl: OFFICIAL_BASE, ...credentials,
      models: [{ id: model, input: ["text", "image"], maxTokens }],
    } } },
  };
}

function createChatSetup(options = {}) {
  if (typeof options.dataDir !== "string" || !options.dataDir.trim()) throw new Error("Chat setup requires a user data directory.");
  const configPath = path.join(path.resolve(options.dataDir), "chat-config.json");
  // Never fall back to Node fetch: Electron's injected net.fetch owns proxy routing.
  const fetch = options.fetch || (() => { throw new Error("Chat network unavailable."); });

  function modelOptions() {
    return {
      ...options, fetch,
      ...(fs.existsSync(configPath) ? { configPath, readConfig: undefined } : {}),
    };
  }

  function model() {
    return createOpenClawChatModel(modelOptions());
  }

  function getStatus() {
    try { return model().getStatus(); }
    catch { return { status: "error", message: "聊天配置不可用，请打开聊天设置。" }; }
  }

  function getSetup() {
    const status = getStatus();
    return {
      status: "ok",
      model: status.status === "ok" && status.models && status.models[0] ? status.models[0].model : DEFAULT_MODEL,
      configured: status.status === "ok" && status.configured === true,
      encryptionAvailable: isSecureStorageAvailable(options.safeStorage),
    };
  }

  function validate(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("请填写模型和 API Key。");
    if (Object.keys(payload).some((key) => !["model", "apiKey"].includes(key))) throw new Error("只支持 OpenAI 官方接口。");
    const selectedModel = payload.model === undefined || payload.model === "" ? DEFAULT_MODEL : payload.model;
    if (typeof selectedModel !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(selectedModel)) throw new Error("模型名称无效。");
    let apiKey = payload.apiKey;
    if (apiKey === "" || apiKey === undefined) {
      try {
        const config = loadOpenClawChatConfig(modelOptions());
        const candidate = config.candidates.find((entry) => !entry.unavailable && entry.apiKey
          && ["openai-responses", "openai-completions"].includes(entry.api)
          && entry.baseUrl.replace(/\/+$/, "") === OFFICIAL_BASE);
        if (candidate) apiKey = candidate.apiKey;
      } catch { /* A broken saved key must be replaced by the user. */ }
    }
    if (typeof apiKey !== "string" || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw new Error("请填写有效的 API Key。");
    return { model: selectedModel, apiKey };
  }

  async function testSetup(payload) {
    let credentials;
    try { credentials = validate(payload); }
    catch (err) { return { status: "error", message: err.message }; }
    try {
      const probe = createOpenClawChatModel({ fetch, readConfig: () => officialConfig(credentials.model, { apiKey: credentials.apiKey }, 16), configPath: "connection-test" });
      await probe.sendMessage({ messages: [{ role: "user", text: "Reply OK." }] });
      return { status: "ok", message: "连接成功。", model: credentials.model };
    } catch {
      return { status: "error", message: "连接失败，请检查密钥、模型权限及网络后重试。" };
    }
  }

  function saveSetup(payload) {
    if (!isSecureStorageAvailable(options.safeStorage)) return { status: "error", message: "系统安全存储不可用，无法加密保存。" };
    let credentials;
    try { credentials = validate(payload); }
    catch (err) { return { status: "error", message: err.message }; }
    let temporaryPath;
    try {
      const encrypted = options.safeStorage.encryptString(credentials.apiKey);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("Encryption failed");
      const config = officialConfig(credentials.model, { apiKeyEncrypted: encrypted.toString("base64") });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      temporaryPath = `${configPath}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
      fs.renameSync(temporaryPath, configPath);
      return { status: "ok", model: credentials.model, configured: true, encryptionAvailable: true, message: "已加密保存。" };
    } catch {
      return { status: "error", message: "加密保存失败，原有配置未更改。" };
    } finally {
      if (temporaryPath) {
        try { fs.unlinkSync(temporaryPath); } catch { /* Renamed or already absent. */ }
      }
    }
  }

  async function sendMessage(payload) {
    try { return await model().sendMessage(payload); }
    catch { throw new Error("聊天请求失败，请检查聊天设置和网络。"); }
  }

  return { getStatus, sendMessage, getSetup, testSetup, saveSetup };
}

module.exports = { createChatSetup };
