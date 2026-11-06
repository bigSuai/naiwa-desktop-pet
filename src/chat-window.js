"use strict";

const { BrowserWindow, nativeTheme, shell } = require("electron");
const { redactChatText } = require("./chat-model");
const path = require("path");

const DEFAULT_WIDTH = 440;
const DEFAULT_HEIGHT = 620;
const MIN_WIDTH = 340;
const MIN_HEIGHT = 420;
const LIGHT_BACKGROUND = "#f5f5f7";
const DARK_BACKGROUND = "#1c1c1f";

function getChatBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function isUsableBounds(bounds) {
  return !!bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const minX = workArea.x;
  const minY = workArea.y;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  return {
    x: Math.round(Math.min(Math.max(bounds.x, minX), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, minY), maxY)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = function initChatWindow(ctx) {
  let chatWindow = null;

  function computeInitialBounds() {
    const petBounds = typeof ctx.getPetWindowBounds === "function"
      ? ctx.getPetWindowBounds()
      : null;
    const cx = petBounds ? petBounds.x + petBounds.width / 2 : 0;
    const cy = petBounds ? petBounds.y + petBounds.height / 2 : 0;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, workArea.width));
    const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, workArea.height));
    const x = petBounds
      ? petBounds.x + petBounds.width + 18
      : workArea.x + (workArea.width - width) / 2;
    const y = petBounds
      ? petBounds.y + Math.round((petBounds.height - height) / 2)
      : workArea.y + (workArea.height - height) / 2;
    return clampBoundsToWorkArea({ x, y, width, height }, workArea);
  }

  function sendStatus() {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    if (!chatWindow.webContents || chatWindow.webContents.isDestroyed()) return;
    const status = typeof ctx.getModelStatus === "function"
      ? ctx.getModelStatus()
      : { status: "error", message: "model status unavailable" };
    chatWindow.webContents.send("chat:model-status", status);
  }

  function createChatWindow() {
    const opts = {
      ...computeInitialBounds(),
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: typeof ctx.t === "function" ? ctx.t("chatWindowTitle") : "奶蛙聊天",
      backgroundColor: getChatBackgroundColor(),
      webPreferences: {
        preload: path.join(__dirname, "preload-chat.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) opts.icon = ctx.iconPath;

    chatWindow = new BrowserWindow(opts);
    chatWindow.setMenuBarVisibility(false);
    chatWindow.loadFile(path.join(__dirname, "chat.html"));
    chatWindow.webContents.once("did-finish-load", () => {
      sendStatus();
    });
    chatWindow.once("ready-to-show", () => {
      if (!chatWindow || chatWindow.isDestroyed()) return;
      chatWindow.show();
      chatWindow.focus();
    });
    chatWindow.on("closed", () => {
      chatWindow = null;
    });
    return chatWindow;
  }

  function syncThemeBackground() {
    if (!chatWindow || chatWindow.isDestroyed()) return;
    chatWindow.setBackgroundColor(getChatBackgroundColor());
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", syncThemeBackground);
  }

  function showChatWindow() {
    if (chatWindow && !chatWindow.isDestroyed()) {
      if (chatWindow.isMinimized()) chatWindow.restore();
      chatWindow.show();
      chatWindow.focus();
      sendStatus();
      return chatWindow;
    }
    return createChatWindow();
  }

  function registerIpc(ipcMain) {
    function handle(channel, callback) {
      ipcMain.handle(channel, async (event, payload) => {
        if (!chatWindow || chatWindow.isDestroyed() || !chatWindow.webContents || chatWindow.webContents.isDestroyed()
          || !event || event.sender !== chatWindow.webContents
          || !event.senderFrame || event.senderFrame !== chatWindow.webContents.mainFrame) {
          return { status: "error", message: "无效的聊天窗口请求。" };
        }
        try { return await callback(payload); }
        catch { return { status: "error", message: "聊天操作失败，请重试。" }; }
      });
    }
    for (const [channel, method] of [["chat:get-setup", "getSetup"], ["chat:test-setup", "testSetup"], ["chat:save-setup", "saveSetup"]]) {
      handle(channel, async (payload) => {
        if (typeof ctx[method] !== "function") return { status: "error", message: "聊天设置暂不可用。" };
        const result = await ctx[method](payload);
        if (channel === "chat:save-setup" && result && result.status === "ok") sendStatus();
        if (!result || typeof result !== "object") return { status: "error", message: "聊天设置暂不可用。" };
        const publicResult = { status: result.status === "ok" ? "ok" : "error" };
        const secrets = payload && typeof payload.apiKey === "string" ? [payload.apiKey] : [];
        for (const field of ["model", "message"]) {
          if (typeof result[field] === "string") publicResult[field] = redactChatText(result[field], secrets);
        }
        for (const field of ["configured", "encryptionAvailable"]) {
          if (typeof result[field] === "boolean") publicResult[field] = result[field];
        }
        return publicResult;
      });
    }
    handle("chat:open-key-page", async () => {
      if (!shell || typeof shell.openExternal !== "function") return { status: "error", message: "无法打开密钥管理页面。" };
      await shell.openExternal("https://platform.openai.com/api-keys");
      return { status: "ok" };
    });
    handle("chat:get-status", () => {
      return typeof ctx.getModelStatus === "function"
        ? ctx.getModelStatus()
        : { status: "error", message: "model status unavailable" };
    });
    handle("chat:get-history", () => {
      return typeof ctx.loadChatHistory === "function"
        ? ctx.loadChatHistory()
        : { status: "ok", messages: [] };
    });
    handle("chat:save-history", (payload) => {
      return typeof ctx.saveChatHistory === "function"
        ? ctx.saveChatHistory(payload)
        : { status: "ok", messages: [] };
    });
    handle("chat:clear-history", () => {
      return typeof ctx.clearChatHistory === "function"
        ? ctx.clearChatHistory()
        : { status: "ok", messages: [] };
    });
    handle("chat:send-message", async (payload) => {
      try {
        if (typeof ctx.sendMessage !== "function") {
          return { status: "error", message: "chat model unavailable", attempts: [] };
        }
        return await ctx.sendMessage(payload);
      } catch (err) {
        return {
          status: "error",
          message: redactChatText(err && err.message ? err.message : String(err)),
          attempts: Array.isArray(err && err.attempts) ? err.attempts.map((attempt) => ({ model: redactChatText(attempt.model), message: redactChatText(attempt.message) })) : [],
        };
      }
    });
  }

  return {
    showChatWindow,
    sendStatus,
    registerIpc,
    getWindow: () => chatWindow,
  };
};
