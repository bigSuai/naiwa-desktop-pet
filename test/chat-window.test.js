"use strict";

const assert = require("node:assert");
const EventEmitter = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const { describe, it } = require("node:test");

const CHAT_WINDOW_MODULE_PATH = require.resolve("../src/chat-window");

function loadChatWindowWithElectron(fakeElectron) {
  delete require.cache[CHAT_WINDOW_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/chat-window");
  } finally {
    Module._load = originalLoad;
  }
}

class IpcWindow {
  constructor() {
    this.webContents = { mainFrame: {}, isDestroyed: () => false, once() {}, send() {} };
  }
  isDestroyed() { return false; }
  setMenuBarVisibility() {}
  loadFile() {}
  once() {}
  on() {}
}

function ipcFixture(ctx = {}) {
  const handlers = new Map();
  const opened = [];
  const init = loadChatWindowWithElectron({ BrowserWindow: IpcWindow, nativeTheme: new EventEmitter(), shell: {
    openExternal: async (url) => { opened.push(url); },
  } });
  const chat = init(ctx);
  const window = chat.showChatWindow();
  chat.registerIpc({ handle: (channel, handler) => handlers.set(channel, handler) });
  return { handlers, opened, event: { sender: window.webContents, senderFrame: window.webContents.mainFrame }, window };
}

describe("chat window", () => {
  it("loads the chat surface and sends model status after load", () => {
    let createdWindow = null;
    const nativeTheme = new EventEmitter();
    nativeTheme.shouldUseDarkColors = false;

    class FakeBrowserWindow {
      constructor(opts) {
        this.opts = opts;
        this.onceCallbacks = new Map();
        this.sent = [];
        this.webContents = {
          isDestroyed: () => false,
          once: (eventName, callback) => this.onceCallbacks.set(`web:${eventName}`, callback),
          send: (channel, payload) => this.sent.push({ channel, payload }),
        };
        createdWindow = this;
      }
      isDestroyed() { return false; }
      isMinimized() { return false; }
      restore() {}
      show() { this.shown = true; }
      focus() { this.focused = true; }
      setMenuBarVisibility(value) { this.menuBarVisible = value; }
      loadFile(filePath) { this.loadedFile = filePath; }
      once(eventName, callback) { this.onceCallbacks.set(eventName, callback); }
      on() {}
      setBackgroundColor(color) { this.backgroundColor = color; }
    }

    const initChatWindow = loadChatWindowWithElectron({
      BrowserWindow: FakeBrowserWindow,
      nativeTheme,
    });
    const chat = initChatWindow({
      t: () => "Localized Chat",
      getPetWindowBounds: () => ({ x: 100, y: 100, width: 120, height: 120 }),
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
      getModelStatus: () => ({ status: "ok", primary: "openclaw/model", fallbacks: [] }),
    });

    chat.showChatWindow();
    assert.ok(createdWindow.loadedFile.endsWith(path.join("src", "chat.html")));
    assert.ok(createdWindow.opts.webPreferences.preload.endsWith(path.join("src", "preload-chat.js")));
    assert.strictEqual(createdWindow.opts.title, "Localized Chat");
    assert.strictEqual(createdWindow.menuBarVisible, false);

    createdWindow.onceCallbacks.get("web:did-finish-load")();
    assert.deepStrictEqual(createdWindow.sent, [{
      channel: "chat:model-status",
      payload: { status: "ok", primary: "openclaw/model", fallbacks: [] },
    }]);
  });

  it("registers IPC handlers for status and message sends", async () => {
    const nativeTheme = new EventEmitter();
    nativeTheme.shouldUseDarkColors = false;
    const handlers = new Map();
    const ipcMain = {
      handle(channel, callback) {
        handlers.set(channel, callback);
      },
    };
    const initChatWindow = loadChatWindowWithElectron({
      BrowserWindow: IpcWindow,
      nativeTheme,
    });
    const chat = initChatWindow({
      getModelStatus: () => ({ status: "ok", primary: "openclaw/model" }),
      sendMessage: async () => ({ status: "ok", text: "hello" }),
      loadChatHistory: () => ({ status: "ok", messages: [{ role: "user", text: "saved" }] }),
      saveChatHistory: (payload) => ({ status: "ok", messages: payload.messages || [] }),
      clearChatHistory: () => ({ status: "ok", messages: [] }),
    });

    chat.registerIpc(ipcMain);
    const contents = chat.showChatWindow().webContents;
    const event = { sender: contents, senderFrame: contents.mainFrame };

    assert.deepStrictEqual(await handlers.get("chat:get-status")(event), {
      status: "ok",
      primary: "openclaw/model",
    });
    assert.deepStrictEqual(await handlers.get("chat:send-message")(event, { messages: [] }), {
      status: "ok",
      text: "hello",
    });
    assert.deepStrictEqual(await handlers.get("chat:get-history")(event), {
      status: "ok",
      messages: [{ role: "user", text: "saved" }],
    });
    assert.deepStrictEqual(await handlers.get("chat:save-history")(event, { messages: [{ role: "user", text: "new" }] }), {
      status: "ok",
      messages: [{ role: "user", text: "new" }],
    });
    assert.deepStrictEqual(await handlers.get("chat:clear-history")(event), {
      status: "ok",
      messages: [],
    });
  });

  it("delegates setup IPC and opens only the fixed official key page", async () => {
    const received = [];
    const { handlers, event, opened } = ipcFixture({
      getSetup: () => ({ status: "ok", configured: false }),
      testSetup: (p) => { received.push(p); return { status: "ok" }; },
      saveSetup: (p) => { received.push(p); return { status: "ok" }; },
    });
    for (const channel of ["chat:get-setup", "chat:test-setup", "chat:save-setup", "chat:open-key-page"]) assert.ok(handlers.has(channel), channel);
    assert.equal((await handlers.get("chat:get-setup")(event)).configured, false);
    const payload = { model: "gpt-6-luna", apiKey: "synthetic-only" };
    assert.equal((await handlers.get("chat:test-setup")(event, payload)).status, "ok");
    assert.equal((await handlers.get("chat:save-setup")(event, payload)).status, "ok");
    await handlers.get("chat:open-key-page")(event, "https://evil.test");
    assert.deepStrictEqual(opened, ["https://platform.openai.com/api-keys"]);
    assert.deepStrictEqual(received, [payload, payload]);
  });

  it("rejects missing, foreign and subframe senders for every chat IPC", async () => {
    let calls = 0;
    const fn = () => { calls++; return { status: "ok" }; };
    const { handlers, event, window, opened } = ipcFixture({ getSetup: fn, testSetup: fn, saveSetup: fn, sendMessage: fn, loadChatHistory: fn, saveChatHistory: fn, clearChatHistory: fn, getModelStatus: fn });
    window.webContents.mainFrame = {};
    for (const handler of handlers.values()) {
      for (const invalid of [undefined, { sender: {} }, { sender: event.sender, senderFrame: {} }]) {
        assert.equal((await handler(invalid, { apiKey: "synthetic-only" })).status, "error");
      }
    }
    assert.equal(calls, 0);
    assert.equal(opened.length, 0);
  });

  it("returns graceful errors for absent setup context and hides thrown secrets", async () => {
    const missing = ipcFixture();
    for (const channel of ["chat:get-setup", "chat:test-setup", "chat:save-setup"]) {
      assert.ok(missing.handlers.has(channel), channel);
      assert.equal((await missing.handlers.get(channel)(missing.event, {})).status, "error");
    }
    const broken = ipcFixture({ testSetup: () => { throw new Error("sk-synthetic-only"); } });
    const result = await broken.handlers.get("chat:test-setup")(broken.event, { apiKey: "sk-synthetic-only" });
    assert.equal(result.status, "error");
    assert.ok(!JSON.stringify(result).includes("sk-synthetic-only"));
  });

  it("fails closed when the sender frame cannot be verified", async () => {
    const { handlers, event, window } = ipcFixture({ getSetup: () => ({ status: "ok" }) });
    window.webContents.mainFrame = null;
    assert.equal((await handlers.get("chat:get-setup")(event)).status, "error");
  });

  it("limits setup IPC results to public fields and redacts echoed request keys", async () => {
    const { handlers, event } = ipcFixture({ testSetup: (p) => ({ status: "error", message: `Rejected ${p.apiKey}`, apiKey: p.apiKey, apiKeyEncrypted: "private-cipher" }) });
    const result = await handlers.get("chat:test-setup")(event, { apiKey: "synthetic-secret" });
    assert.equal(result.status, "error");
    assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
    assert.equal(result.apiKey, undefined);
    assert.equal(result.apiKeyEncrypted, undefined);
  });

  it("ignores a duplicate settings-open click while setup metadata is loading", async () => {
    let loads = 0; let finish;
    const r = rendererFixture({ getSetup: () => {
      loads++;
      if (loads === 1) return Promise.resolve({ status: "ok", configured: true, model: "model", encryptionAvailable: true });
      return new Promise((resolve) => { finish = resolve; });
    } });
    await flush();
    const pending = r.elements.get("chatSettings").listeners.click();
    r.elements.get("chatSettings").listeners.click();
    assert.equal(loads, 2);
    assert.equal(r.elements.get("chatSettings").disabled, true);
    finish({ status: "ok", configured: true, model: "model", encryptionAvailable: true });
    await pending;
  });

  it("preload exposes only the four controlled setup invocations", async () => {
    let api;
    const calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/preload-chat.js"), "utf8"), {
      require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: { on() {}, invoke: (...args) => { calls.push(args); } } }),
    });
    for (const name of ["getSetup", "testSetup", "saveSetup", "openKeyPage"]) assert.equal(typeof api[name], "function", name);
    api.getSetup(); api.testSetup({ model: "test" }); api.saveSetup({ model: "test" }); api.openKeyPage("https://evil.test");
    assert.deepStrictEqual(calls.map((c) => c[0]), ["chat:get-setup", "chat:test-setup", "chat:save-setup", "chat:open-key-page"]);
    assert.equal(calls[3].length, 1);
  });
});

function rendererFixture(api = {}) {
  const elements = new Map();
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.style = {}; this.value = ""; this.hidden = false; this.disabled = false; this.classList = { add() {}, remove() {} }; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    appendChild(child) { this.children.push(child); return child; }
    set innerHTML(_) { this.children = []; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    setAttribute() {}
  }
  const html = fs.readFileSync(path.join(__dirname, "../src/chat.html"), "utf8");
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], new Element());
  const history = [{ role: "user", text: "existing conversation" }];
  const calls = [];
  const context = vm.createContext({ console, setTimeout, clearTimeout, document: {
    getElementById: (id) => elements.get(id), createElement: () => new Element(), createTextNode: (text) => ({ text }), createDocumentFragment: () => new Element(), addEventListener() {},
  }, window: { chatAPI: {
    getStatus: async () => ({ status: "error" }), onStatus() {},
    getSetup: async () => ({ status: "ok", model: "gpt-6-luna", configured: false, encryptionAvailable: true }),
    getHistory: async () => ({ status: "ok", messages: history }), saveHistory: async () => {}, clearHistory: async () => {},
    sendMessage: async () => { calls.push("send"); return { status: "ok", text: "hi" }; },
    testSetup: async () => ({ status: "ok" }), saveSetup: async () => ({ status: "ok", model: "gpt-next", configured: true, encryptionAvailable: true }), openKeyPage: async () => ({ status: "ok" }), ...api,
  } } });
  assert.ok(elements.has("setupDialog"), "compact setup dialog must exist");
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/chat-renderer.js"), "utf8"), context);
  return { elements, calls, context, run: (code) => vm.runInContext(code, context) };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("chat setup renderer", () => {
  it("opens on first run, cancels without erasing history, and reopens from settings", async () => {
    const r = rendererFixture(); await flush();
    assert.equal(r.elements.get("setupDialog").open, true);
    assert.equal(r.elements.get("setupModel").value, "gpt-6-luna");
    assert.equal(r.elements.get("send").disabled, true);
    r.elements.get("setupCancel").listeners.click();
    assert.equal(r.elements.get("setupDialog").open, false);
    assert.equal(r.run("state.messages[0].text"), "existing conversation");
    await r.elements.get("chatSettings").listeners.click();
    assert.equal(r.elements.get("setupDialog").open, true);
  });

  it("does not open for configured users and save updates the header without clearing history", async () => {
    const r = rendererFixture({ getSetup: async () => ({ status: "ok", model: "old-model", configured: true, encryptionAvailable: true }) }); await flush();
    assert.ok(!r.elements.get("setupDialog").open);
    await r.elements.get("chatSettings").listeners.click();
    r.elements.get("setupKey").value = "sk-synthetic-only";
    await r.elements.get("setupSave").listeners.click();
    assert.equal(r.elements.get("setupDialog").open, false);
    assert.equal(r.elements.get("setupKey").value, "");
    assert.equal(r.elements.get("send").disabled, false);
    assert.ok(r.elements.get("modelLine").textContent.includes("gpt-next"));
    assert.equal(r.run("state.messages[0].text"), "existing conversation");
  });

  it("disables duplicate actions while testing and does not auto-save", async () => {
    let finish; let tests = 0; let saves = 0;
    const r = rendererFixture({ testSetup: () => { tests++; return new Promise((resolve) => { finish = resolve; }); }, saveSetup: async () => { saves++; } }); await flush();
    r.elements.get("setupKey").value = "sk-synthetic-only";
    const pending = r.elements.get("setupTest").listeners.click();
    r.elements.get("setupTest").listeners.click();
    assert.equal(r.elements.get("setupSave").disabled, true);
    assert.equal(r.elements.get("setupCancel").disabled, true);
    finish({ status: "ok" }); await pending;
    assert.equal(tests, 1); assert.equal(saves, 0);
    assert.equal(r.elements.get("setupSave").disabled, false);
  });

  it("disables saving without secure storage and hides unexpected IPC exception details", async () => {
    const r = rendererFixture({ getSetup: async () => ({ status: "ok", configured: false, encryptionAvailable: false }), testSetup: async () => { throw new Error("sk-synthetic-only"); } }); await flush();
    assert.equal(r.elements.get("setupSave").disabled, true);
    await r.elements.get("setupTest").listeners.click();
    assert.ok(!r.elements.get("setupFeedback").textContent.includes("sk-synthetic-only"));
  });

  it("composition Enter never sends, normal Enter still sends", async () => {
    const r = rendererFixture({ getSetup: async () => ({ status: "ok", configured: true, model: "model", encryptionAvailable: true }) }); await flush();
    const input = r.elements.get("input"); input.value = "hello";
    const keydown = input.listeners.keydown;
    const event = { key: "Enter", preventDefault() {} };
    keydown({ ...event, isComposing: true }); keydown({ ...event, keyCode: 229 });
    input.listeners.compositionstart(); keydown(event); input.listeners.compositionend();
    assert.equal(r.calls.length, 0);
    keydown(event); await flush();
    assert.equal(r.calls.length, 1);
  });
});
