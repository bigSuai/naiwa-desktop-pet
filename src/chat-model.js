"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_OPENCLAW_STATE_DIR = path.join(os.homedir(), ".openclaw");
const DEFAULT_CONFIG_NAME = "openclaw.json";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_TOKENS = 2048;
const SYSTEM_PROMPT = [
  "You are 奶蛙 (Naiwa), a concise desktop-pet chat companion.",
  "Be helpful, warm, and direct.",
  "Use clear Markdown for structure.",
  "For math in this compact chat, prefer readable plain text or concise LaTeX blocks only when useful.",
].join(" ");
const MAX_TEXT_CHARS = 24000;
const MAX_MESSAGES = 24;
const MAX_IMAGES_PER_MESSAGE = 6;
const MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024;
const IMAGE_ONLY_PROMPT = "Please respond to this image.";
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProviderEnvName(providerId) {
  return String(providerId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveOpenClawConfigPath(env = process.env) {
  const explicit = safeString(env.OPENCLAW_CONFIG_PATH);
  if (explicit) return explicit;
  const stateDir = safeString(env.OPENCLAW_STATE_DIR) || DEFAULT_OPENCLAW_STATE_DIR;
  return path.join(stateDir, DEFAULT_CONFIG_NAME);
}

function resolveChatConfigPath(env = process.env) {
  const explicit = safeString(env.CLAWD_CHAT_CONFIG_PATH);
  if (explicit) return explicit;
  const dataDir = safeString(env.CLAWD_DATA_DIR) || path.resolve(__dirname, "..", ".clawd-data");
  const localPath = path.join(dataDir, "chat-config.json");
  return fs.existsSync(localPath) ? localPath : resolveOpenClawConfigPath(env);
}

function readDpapiApiKey(filePath) {
  if (process.platform !== "win32") throw new Error("Windows encrypted credentials require Windows.");
  const script = "$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString ([IO.File]::ReadAllText($env:CLAWD_OPENAI_KEY_FILE)); [Console]::Out.Write([Net.NetworkCredential]::new('', $s).Password)";
  try {
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const env = { ...process.env, CLAWD_OPENAI_KEY_FILE: filePath };
    // PowerShell 7's inherited module path breaks Windows PowerShell 5 autoload.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
    const key = execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      env,
      encoding: "utf8", windowsHide: true, timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16384,
    }).trim();
    if (!key) throw new Error("Empty credential");
    return key;
  } catch {
    throw new Error("Could not read the Windows encrypted OpenAI credential. Reconfigure it with the audio key setup tool.");
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function isSecureStorageAvailable(storage) {
  try {
    return !!storage && storage.isEncryptionAvailable() === true
      && (typeof storage.getSelectedStorageBackend !== "function" || storage.getSelectedStorageBackend() !== "basic_text");
  } catch {
    return false;
  }
}

function redactChatText(value, secrets = []) {
  let text = String(value || "");
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]");
}

function getOwn(obj, key) {
  return obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key)
    ? obj[key]
    : undefined;
}

function resolvePrimaryStringValue(raw) {
  if (typeof raw === "string") return safeString(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  return safeString(raw.primary);
}

function resolveFallbackValues(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  if (!Array.isArray(raw.fallbacks)) return [];
  return raw.fallbacks.map(safeString).filter(Boolean);
}

function resolveModelSelection(raw) {
  const primary = resolvePrimaryStringValue(raw);
  const fallbacks = resolveFallbackValues(raw);
  const ordered = [];
  const seen = new Set();
  for (const ref of [primary, ...fallbacks]) {
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    ordered.push(ref);
  }
  return {
    primary,
    fallbacks,
    ordered,
  };
}

function parseModelRef(ref) {
  const value = safeString(ref);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`OpenClaw model "${value || "(empty)"}" must use provider/model format.`);
  }
  return {
    ref: value,
    providerId: value.slice(0, slash),
    modelId: value.slice(slash + 1),
  };
}

function findModelDefinition(providerConfig, modelId) {
  const list = providerConfig && Array.isArray(providerConfig.models) ? providerConfig.models : [];
  return list.find((entry) => entry && entry.id === modelId) || null;
}

function normalizeHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || entry == null) continue;
    const stringValue = String(entry);
    if (stringValue) out[key] = stringValue;
  }
  return out;
}

function resolveProviderApiKey(config, providerId, providerConfig = {}) {
  const direct = safeString(providerConfig.apiKey);
  if (direct) return direct;
  const envConfig = config && config.env && typeof config.env === "object" ? config.env : {};
  const envName = normalizeProviderEnvName(providerId);
  const candidates = [
    `${envName}_API_KEY`,
    providerId === "openai" ? "OPENAI_API_KEY" : "",
    providerId === "anthropic" ? "ANTHROPIC_API_KEY" : "",
  ].filter(Boolean);
  for (const key of candidates) {
    const fromConfig = safeString(getOwn(envConfig, key));
    if (fromConfig) return fromConfig;
    const fromEnv = safeString(process.env[key]);
    if (fromEnv) return fromEnv;
  }
  return "";
}

function resolveProviderBaseUrl(config, providerId, providerConfig = {}) {
  const direct = safeString(providerConfig.baseUrl);
  if (direct) return direct;
  const envConfig = config && config.env && typeof config.env === "object" ? config.env : {};
  const envName = normalizeProviderEnvName(providerId);
  const candidates = [
    `${envName}_BASE_URL`,
    providerId === "openai" ? "OPENAI_BASE_URL" : "",
    providerId === "anthropic" ? "ANTHROPIC_BASE_URL" : "",
  ].filter(Boolean);
  for (const key of candidates) {
    const fromConfig = safeString(getOwn(envConfig, key));
    if (fromConfig) return fromConfig;
    const fromEnv = safeString(process.env[key]);
    if (fromEnv) return fromEnv;
  }
  return "";
}

function normalizePositiveMs(seconds, fallbackMs = DEFAULT_TIMEOUT_MS) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  return Math.max(1000, Math.round(n * 1000));
}

function resolveMaxTokens(modelDef, defaults) {
  const modelMax = Number(modelDef && modelDef.maxTokens);
  const defaultMax = Number(defaults && defaults.maxTokens);
  const selected = Number.isFinite(modelMax) && modelMax > 0
    ? modelMax
    : (Number.isFinite(defaultMax) && defaultMax > 0 ? defaultMax : DEFAULT_MAX_TOKENS);
  return Math.min(selected, DEFAULT_MAX_TOKENS);
}

function modelSupportsImages(modelDef) {
  if (!modelDef || !Array.isArray(modelDef.input)) return true;
  return modelDef.input.includes("image");
}

function loadOpenClawChatConfig(options = {}) {
  const configPath = options.configPath || resolveChatConfigPath(options.env || process.env);
  const config = (options.readConfig || readJsonFile)(configPath);
  const defaults = config && config.agents && config.agents.defaults ? config.agents.defaults : {};
  const selection = resolveModelSelection(defaults.model || config.model || config.models && config.models.default);
  if (!selection.ordered.length) {
    throw new Error("OpenClaw default model is not configured.");
  }

  const providers = config && config.models && config.models.providers && typeof config.models.providers === "object"
    ? config.models.providers
    : {};
  const candidates = [];
  for (const ref of selection.ordered) {
    const parsed = parseModelRef(ref);
    const providerConfig = providers[parsed.providerId];
    if (!providerConfig || typeof providerConfig !== "object") {
      candidates.push({ ...parsed, unavailable: true, reason: "provider-not-configured" });
      continue;
    }
    const api = safeString(providerConfig.api) || "openai-completions";
    const modelDef = findModelDefinition(providerConfig, parsed.modelId);
    const baseUrl = resolveProviderBaseUrl(config, parsed.providerId, providerConfig);
    const encryptedKeyFile = safeString(providerConfig.apiKeyDpapiFile);
    const encryptedKey = safeString(providerConfig.apiKeyEncrypted);
    // An official credential must never inherit an OpenClaw proxy-provider URL.
    if ((encryptedKeyFile || encryptedKey) && baseUrl.replace(/\/+$/, "") !== "https://api.openai.com/v1") {
      throw new Error("Windows encrypted credentials can only use the official OpenAI endpoint.");
    }
    let storedKey = "";
    if (encryptedKey) {
      if (!isSecureStorageAvailable(options.safeStorage)) throw new Error("Secure credential storage is unavailable.");
      try {
        storedKey = options.safeStorage.decryptString(Buffer.from(encryptedKey, "base64"));
        if (!safeString(storedKey)) throw new Error("Empty credential");
      } catch {
        throw new Error("Could not decrypt the chat credential. Please configure it again.");
      }
    }
    candidates.push({
      ...parsed,
      api,
      providerConfig,
      modelDef,
      baseUrl,
      apiKey: encryptedKey ? storedKey : encryptedKeyFile
        ? (options.readApiKeyFile || readDpapiApiKey)(encryptedKeyFile)
        : resolveProviderApiKey(config, parsed.providerId, providerConfig),
      headers: normalizeHeaders(providerConfig.headers),
      maxTokens: resolveMaxTokens(modelDef, defaults),
      timeoutMs: normalizePositiveMs(providerConfig.timeoutSeconds || defaults.timeoutSeconds, DEFAULT_TIMEOUT_MS),
      supportsImages: modelSupportsImages(modelDef),
    });
  }

  return {
    configPath,
    selection,
    candidates,
  };
}

function normalizeImageDataUrl(value) {
  const raw = safeString(value);
  if (!raw || raw.length > MAX_IMAGE_DATA_URL_CHARS) return null;
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(raw);
  if (!match) return null;
  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) return null;
  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;
  return {
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
    base64,
  };
}

function normalizeIncomingMessages(rawMessages) {
  const list = Array.isArray(rawMessages) ? rawMessages : [];
  const sliced = list.slice(-MAX_MESSAGES);
  const out = [];
  for (const entry of sliced) {
    if (!entry || typeof entry !== "object") continue;
    const role = entry.role === "assistant" ? "assistant" : "user";
    let text = safeString(entry.text || entry.content);
    if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
    const rawImages = Array.isArray(entry.images) ? entry.images : [];
    const images = rawImages
      .slice(0, MAX_IMAGES_PER_MESSAGE)
      .map((image) => normalizeImageDataUrl(image && (image.dataUrl || image.url || image)))
      .filter(Boolean);
    if (!text && images.length === 0) continue;
    out.push({ role, text, images });
  }
  return out;
}

function hasAnyImages(messages) {
  return messages.some((message) => Array.isArray(message.images) && message.images.length > 0);
}

function buildOpenAiContent(message) {
  if (!message.images.length) return message.text || "";
  const content = [];
  content.push({ type: "text", text: message.text || IMAGE_ONLY_PROMPT });
  for (const image of message.images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return content;
}

function buildOpenAiMessages(messages) {
  const out = [{
    role: "system",
    content: SYSTEM_PROMPT,
  }];
  for (const message of messages) {
    out.push({
      role: message.role,
      content: buildOpenAiContent(message),
    });
  }
  return out;
}

function buildAnthropicContent(message) {
  const content = [];
  if (message.text || message.images.length) {
    content.push({ type: "text", text: message.text || IMAGE_ONLY_PROMPT });
  }
  for (const image of message.images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      },
    });
  }
  return content.length ? content : [{ type: "text", text: "" }];
}

function buildAnthropicMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: buildAnthropicContent(message),
  }));
}

function joinBaseUrl(baseUrl, suffix, fallback) {
  const base = safeString(baseUrl) || fallback;
  return `${base.replace(/\/+$/, "")}${suffix}`;
}

function openAiUrl(candidate) {
  return joinBaseUrl(candidate.baseUrl, "/chat/completions", "https://api.openai.com/v1");
}

function anthropicUrl(candidate) {
  const base = safeString(candidate.baseUrl) || "https://api.anthropic.com";
  const normalized = base.replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

async function readJsonResponse(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractOpenAiText(body) {
  const choice = body && Array.isArray(body.choices) ? body.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : null;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function extractAnthropicText(body) {
  if (!body || !Array.isArray(body.content)) return "";
  return body.content
    .map((part) => part && part.type === "text" && typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function providerErrorMessage(body, status, statusText) {
  const error = body && body.error;
  if (error && typeof error === "object") {
    const message = safeString(error.message);
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
}

async function postJson(fetchFn, url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    return { res, responseBody: await readJsonResponse(res) };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiCandidate(candidate, messages, fetchFn) {
  if (!candidate.apiKey) throw new Error("API key is missing for provider.");
  const body = {
    model: candidate.modelId,
    messages: buildOpenAiMessages(messages),
    max_tokens: candidate.maxTokens,
  };
  const { res, responseBody } = await postJson(fetchFn, openAiUrl(candidate), {
    "Content-Type": "application/json",
    Authorization: `Bearer ${candidate.apiKey}`,
    ...candidate.headers,
  }, body, candidate.timeoutMs);
  if (!res.ok) throw new Error(providerErrorMessage(responseBody, res.status, res.statusText));
  const text = extractOpenAiText(responseBody);
  if (!text) throw new Error("Provider response did not contain text.");
  return text;
}

async function callOpenAiResponsesCandidate(candidate, messages, fetchFn) {
  if (!candidate.apiKey) throw new Error("API key is missing for provider.");
  const input = messages.map((message) => ({
    role: message.role,
    content: [
      { type: message.role === "assistant" ? "output_text" : "input_text", text: message.text || IMAGE_ONLY_PROMPT },
      ...(message.role === "user" ? message.images.map((image) => ({ type: "input_image", image_url: image.dataUrl })) : []),
    ],
  }));
  const body = {
    model: candidate.modelId, instructions: SYSTEM_PROMPT, input,
    max_output_tokens: candidate.maxTokens, store: false,
    reasoning: { effort: "none" },
  };
  const { res, responseBody } = await postJson(fetchFn, joinBaseUrl(candidate.baseUrl, "/responses", "https://api.openai.com/v1"), {
    "Content-Type": "application/json",
    ...candidate.headers,
    Authorization: `Bearer ${candidate.apiKey}`,
  }, body, candidate.timeoutMs);
  if (!res.ok) throw new Error(providerErrorMessage(responseBody, res.status, res.statusText));
  if (responseBody && responseBody.status && responseBody.status !== "completed") {
    throw new Error(`OpenAI response was not completed (${responseBody.status}).`);
  }
  const text = (responseBody && Array.isArray(responseBody.output) ? responseBody.output : [])
    .filter((item) => item && item.type === "message" && item.role !== "user")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part) => part && part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text).join("").trim();
  if (!text) throw new Error("Provider response did not contain text.");
  return text;
}

async function callAnthropicCandidate(candidate, messages, fetchFn) {
  if (!candidate.apiKey) throw new Error("API key is missing for provider.");
  const body = {
    model: candidate.modelId,
    system: SYSTEM_PROMPT,
    messages: buildAnthropicMessages(messages),
    max_tokens: candidate.maxTokens,
  };
  const { res, responseBody } = await postJson(fetchFn, anthropicUrl(candidate), {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": candidate.apiKey,
    ...candidate.headers,
  }, body, candidate.timeoutMs);
  if (!res.ok) throw new Error(providerErrorMessage(responseBody, res.status, res.statusText));
  const text = extractAnthropicText(responseBody);
  if (!text) throw new Error("Provider response did not contain text.");
  return text;
}

async function callCandidate(candidate, messages, fetchFn) {
  if (candidate.unavailable) throw new Error(candidate.reason || "Model is unavailable.");
  if (candidate.api === "anthropic-messages") return callAnthropicCandidate(candidate, messages, fetchFn);
  if (candidate.api === "openai-completions") return callOpenAiCandidate(candidate, messages, fetchFn);
  if (candidate.api === "openai-responses") return callOpenAiResponsesCandidate(candidate, messages, fetchFn);
  throw new Error(`Unsupported OpenClaw provider API "${candidate.api}".`);
}

function publicCandidate(candidate) {
  return {
    ref: candidate.ref,
    provider: candidate.providerId,
    model: candidate.modelId,
    api: candidate.api || null,
    supportsImages: candidate.supportsImages !== false,
    unavailable: candidate.unavailable === true,
    reason: candidate.reason || null,
  };
}

function publicError(candidate, err, secrets) {
  return {
    model: candidate.ref,
    message: redactChatText(err && err.message ? err.message : String(err), secrets),
  };
}

function createOpenClawChatModel(options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("OpenClaw chat requires fetch support in the main process.");
  }

  function getConfig() {
    return loadOpenClawChatConfig(options);
  }

  function getStatus() {
    try {
      const cfg = getConfig();
      return {
        status: "ok",
        configPath: cfg.configPath,
        primary: cfg.selection.primary,
        fallbacks: cfg.selection.fallbacks,
        models: cfg.candidates.map(publicCandidate),
        configured: cfg.candidates.some((candidate) => !candidate.unavailable && !!candidate.apiKey),
      };
    } catch (err) {
      return {
        status: "error",
        message: "聊天配置不可用，请打开聊天设置。",
        configPath: options.configPath || resolveChatConfigPath(options.env || process.env),
      };
    }
  }

  async function sendMessage(payload = {}) {
    const messages = normalizeIncomingMessages(payload.messages);
    if (!messages.length) throw new Error("Message is empty.");
    let cfg;
    try { cfg = getConfig(); }
    catch { throw new Error("聊天配置不可用，请打开聊天设置。"); }
    const secrets = cfg.candidates.map((candidate) => candidate.apiKey);
    const wantsImages = hasAnyImages(messages);
    const attempts = [];
    for (let index = 0; index < cfg.candidates.length; index += 1) {
      const candidate = cfg.candidates[index];
      if (wantsImages && candidate.supportsImages === false) {
        attempts.push({ model: candidate.ref, message: "Model does not advertise image input." });
        continue;
      }
      try {
        const text = await callCandidate(candidate, messages, fetchFn);
        return {
          status: "ok",
          text: redactChatText(text, secrets),
          model: candidate.ref,
          provider: candidate.providerId,
          fallbackUsed: index > 0,
          attempts,
        };
      } catch (err) {
        attempts.push(publicError(candidate, err, secrets));
      }
    }
    const last = attempts[attempts.length - 1];
    const reason = last ? last.message : "No model candidates were available.";
    const error = new Error(`奶蛙 chat failed: ${reason}`);
    error.attempts = attempts;
    throw error;
  }

  return {
    getStatus,
    sendMessage,
  };
}

module.exports = {
  createOpenClawChatModel,
  loadOpenClawChatConfig,
  normalizeIncomingMessages,
  parseModelRef,
  resolveModelSelection,
  resolveOpenClawConfigPath,
  resolveChatConfigPath,
  isSecureStorageAvailable,
  redactChatText,
};
