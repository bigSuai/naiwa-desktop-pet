"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.resolve(__dirname, "..", ".clawd-data");
const HISTORY_FILE_NAME = "chat-history.json";
const MAX_MESSAGES = 100;
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 24000;
const MAX_META_CHARS = 300;
const MAX_IMAGES_PER_MESSAGE = 6;
const MAX_IMAGE_DATA_URL_CHARS = 1024 * 1024;

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function resolveDefaultChatHistoryPath(env = process.env) {
  const explicit = safeString(env.CLAWD_CHAT_HISTORY_PATH).trim();
  if (explicit) return explicit;
  const dataDir = safeString(env.CLAWD_DATA_DIR).trim() || DEFAULT_DATA_DIR;
  return path.join(dataDir, HISTORY_FILE_NAME);
}

function normalizeImageDataUrl(value) {
  const dataUrl = safeString(value && (value.dataUrl || value.url || value)).trim();
  if (!dataUrl || dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) return null;
  if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(dataUrl)) {
    return null;
  }
  return { dataUrl: dataUrl.replace(/\s+/g, ""), name: safeString(value && value.name).slice(0, 120) };
}

function normalizeMessage(entry) {
  if (!entry || typeof entry !== "object") return null;
  const allowedRoles = new Set(["user", "assistant", "system"]);
  const role = allowedRoles.has(entry.role) ? entry.role : "system";
  const text = safeString(entry.text || entry.content).slice(0, MAX_TEXT_CHARS);
  const meta = safeString(entry.meta).slice(0, MAX_META_CHARS);
  const images = Array.isArray(entry.images)
    ? entry.images.slice(0, MAX_IMAGES_PER_MESSAGE).map(normalizeImageDataUrl).filter(Boolean)
    : [];
  const createdAt = safeString(entry.createdAt) || new Date().toISOString();
  if (!text && !images.length) return null;
  return {
    role,
    text,
    ...(images.length ? { images } : {}),
    ...(meta ? { meta } : {}),
    createdAt,
  };
}

function normalizeMessages(rawMessages) {
  const list = Array.isArray(rawMessages)
    ? rawMessages
    : (rawMessages && Array.isArray(rawMessages.messages) ? rawMessages.messages : []);
  return list.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES);
}

function trimToBudget(messages, maxBytes = MAX_HISTORY_BYTES) {
  const out = messages.slice(-MAX_MESSAGES);
  while (out.length > 0 && Buffer.byteLength(JSON.stringify({ messages: out }), "utf8") > maxBytes) {
    out.shift();
  }
  return out;
}

function createChatHistoryStore(options = {}) {
  const filePath = options.filePath || resolveDefaultChatHistoryPath(options.env || process.env);
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes
    : MAX_HISTORY_BYTES;

  function load() {
    try {
      if (!fs.existsSync(filePath)) return { status: "ok", messages: [], path: filePath };
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
      return { status: "ok", messages: normalizeMessages(raw), path: filePath };
    } catch (err) {
      return {
        status: "error",
        messages: [],
        path: filePath,
        message: err && err.message ? err.message : String(err),
      };
    }
  }

  function save(payload) {
    try {
      const messages = trimToBudget(normalizeMessages(payload), maxBytes);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      fs.writeFileSync(tempPath, `${JSON.stringify({ version: 1, messages }, null, 2)}\n`, "utf8");
      fs.renameSync(tempPath, filePath);
      return { status: "ok", messages, path: filePath };
    } catch (err) {
      return {
        status: "error",
        messages: [],
        path: filePath,
        message: err && err.message ? err.message : String(err),
      };
    }
  }

  function clear() {
    return save({ messages: [] });
  }

  return { filePath, load, save, clear };
}

module.exports = {
  createChatHistoryStore,
  normalizeMessages,
  resolveDefaultChatHistoryPath,
};
