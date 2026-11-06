"use strict";

const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendEl = document.getElementById("send");
const clearHistoryEl = document.getElementById("clearHistory");
const attachmentsEl = document.getElementById("attachments");
const modelLineEl = document.getElementById("modelLine");
const statusDotEl = document.getElementById("statusDot");
const chatSettingsEl = document.getElementById("chatSettings");
const setupDialogEl = document.getElementById("setupDialog");
const setupModelEl = document.getElementById("setupModel");
const setupKeyEl = document.getElementById("setupKey");
const setupTestEl = document.getElementById("setupTest");
const setupSaveEl = document.getElementById("setupSave");
const setupCancelEl = document.getElementById("setupCancel");
const setupKeyPageEl = document.getElementById("setupKeyPage");
const setupFeedbackEl = document.getElementById("setupFeedback");

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_MESSAGES = 100;

const state = {
  messages: [],
  attachments: [],
  sending: false,
  historyReady: false,
  configured: false,
  encryptionAvailable: false,
  setupBusy: false,
  composing: false,
};
let historySaveQueue = Promise.resolve();

function syncControls() {
  const blocked = state.sending || state.setupBusy || !state.configured;
  sendEl.disabled = blocked;
  inputEl.disabled = blocked;
  clearHistoryEl.disabled = state.sending;
  chatSettingsEl.disabled = state.sending || state.setupBusy;
  setupTestEl.disabled = state.setupBusy;
  setupSaveEl.disabled = state.setupBusy || !state.encryptionAvailable;
  setupCancelEl.disabled = state.setupBusy;
  setupModelEl.disabled = state.setupBusy;
  setupKeyEl.disabled = state.setupBusy;
  setupKeyPageEl.disabled = state.setupBusy;
}

function applySetup(setup) {
  state.configured = !!setup && setup.status === "ok" && setup.configured === true;
  state.encryptionAvailable = !!setup && setup.encryptionAvailable === true;
  setupModelEl.value = setup && setup.model ? setup.model : "gpt-6-luna";
  setupKeyEl.placeholder = state.configured ? "留空保留已加密保存的密钥" : "输入你的 API Key";
  if (state.configured) setModelStatus({ status: "ok", primary: setupModelEl.value });
  else setModelStatus({ status: "error", message: "尚未配置，打开聊天设置" });
  syncControls();
}

function showSetup() {
  setupKeyEl.value = "";
  setupFeedbackEl.textContent = state.encryptionAvailable ? "" : "系统安全存储不可用，暂不能保存密钥。";
  if (!setupDialogEl.open) setupDialogEl.showModal();
  setupKeyEl.focus();
}

async function openSetup() {
  if (state.sending || state.setupBusy) return;
  state.setupBusy = true;
  syncControls();
  try { applySetup(await window.chatAPI.getSetup()); }
  catch { applySetup(null); }
  finally { state.setupBusy = false; syncControls(); }
  showSetup();
}

function closeSetup() {
  if (state.setupBusy) return;
  setupKeyEl.value = "";
  setupDialogEl.close();
  inputEl.focus();
}

async function runSetupAction(save) {
  if (state.setupBusy || (save && !state.encryptionAvailable)) return;
  state.setupBusy = true;
  syncControls();
  setupFeedbackEl.textContent = save ? "正在加密保存…" : "正在测试连接…";
  try {
    const payload = { model: setupModelEl.value.trim(), apiKey: setupKeyEl.value };
    const result = await window.chatAPI[save ? "saveSetup" : "testSetup"](payload);
    setupFeedbackEl.textContent = result && result.message ? result.message : "操作失败，请重试。";
    if (save && result && result.status === "ok") {
      applySetup(result);
      setupKeyEl.value = "";
      setupDialogEl.close();
    }
  } catch {
    setupFeedbackEl.textContent = "操作失败，请重试。";
  } finally {
    state.setupBusy = false;
    syncControls();
    if (!setupDialogEl.open) inputEl.focus();
  }
}

chatSettingsEl.addEventListener("click", openSetup);
setupTestEl.addEventListener("click", () => runSetupAction(false));
setupSaveEl.addEventListener("click", () => runSetupAction(true));
setupCancelEl.addEventListener("click", closeSetup);
setupDialogEl.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSetup();
});
setupDialogEl.addEventListener("close", () => { setupKeyEl.value = ""; });
setupKeyPageEl.addEventListener("click", async () => {
  try {
    const result = await window.chatAPI.openKeyPage();
    if (!result || result.status !== "ok") setupFeedbackEl.textContent = "无法打开密钥管理页面。";
  } catch { setupFeedbackEl.textContent = "无法打开密钥管理页面。"; }
});

function setModelStatus(status) {
  statusDotEl.classList.remove("ready", "error");
  if (!status || status.status !== "ok") {
    statusDotEl.classList.add("error");
    modelLineEl.textContent = status && status.message ? status.message : "OpenClaw unavailable";
    return;
  }
  statusDotEl.classList.add("ready");
  const fallbackCount = Array.isArray(status.fallbacks) ? status.fallbacks.length : 0;
  modelLineEl.textContent = fallbackCount > 0
    ? `${status.primary} + ${fallbackCount} fallback${fallbackCount === 1 ? "" : "s"}`
    : status.primary;
}

function ensureEmptyState() {
  if (state.messages.length) return;
  messagesEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = "奶蛙 is here.";
  messagesEl.appendChild(empty);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeHistoryMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message === "object")
    .map((message) => {
      const role = ["user", "assistant", "system"].includes(message.role) ? message.role : "system";
      const text = typeof message.text === "string" ? message.text : "";
      const meta = typeof message.meta === "string" ? message.meta : "";
      const images = Array.isArray(message.images)
        ? message.images
            .filter((image) => image && typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
            .map((image) => ({ dataUrl: image.dataUrl, name: image.name || "image" }))
        : [];
      return {
        role,
        text,
        ...(images.length ? { images } : {}),
        ...(meta ? { meta } : {}),
        createdAt: typeof message.createdAt === "string" ? message.createdAt : nowIso(),
      };
    })
    .filter((message) => message.text || (message.images && message.images.length))
    .slice(-MAX_HISTORY_MESSAGES);
}

async function persistHistoryNow() {
  if (!state.historyReady || !window.chatAPI || typeof window.chatAPI.saveHistory !== "function") return;
  const snapshot = normalizeHistoryMessages(state.messages);
  historySaveQueue = historySaveQueue
    .catch(() => {})
    .then(() => window.chatAPI.saveHistory({ messages: snapshot }))
    .catch((err) => console.warn("Failed to save chat history:", err));
  await historySaveQueue;
}

function scheduleHistorySave() {
  persistHistoryNow();
}

function normalizeMathText(value) {
  return String(value || "")
    .replace(/\\begin\{pmatrix\}/g, "")
    .replace(/\\end\{pmatrix\}/g, "")
    .replace(/\\lambda/g, "λ")
    .replace(/\\mu/g, "μ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\gamma/g, "γ")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\Rightarrow/g, "⇒")
    .replace(/\\rightarrow/g, "→")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\quad/g, "  ")
    .replace(/\\\[/g, "")
    .replace(/\\\]/g, "")
    .replace(/\\\\/g, "\n")
    .replace(/&/g, "  ")
    .trim();
}

function readLatexGroup(source, openIndex) {
  if (source[openIndex] !== "{") return null;
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\" && i + 1 < source.length) {
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

function replaceLatexOneArg(source, command, replacer) {
  const needle = `\\${command}`;
  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    const found = source.indexOf(needle, cursor);
    if (found < 0) break;
    let groupStart = found + needle.length;
    while (/\s/.test(source[groupStart] || "")) groupStart += 1;
    const group = readLatexGroup(source, groupStart);
    if (!group) {
      out += source.slice(cursor, found + needle.length);
      cursor = found + needle.length;
      continue;
    }
    out += source.slice(cursor, found);
    out += replacer(group.body);
    cursor = group.end + 1;
  }
  return out + source.slice(cursor);
}

function replaceLatexTwoArgs(source, command, replacer) {
  const needle = `\\${command}`;
  let out = "";
  let cursor = 0;
  while (cursor < source.length) {
    const found = source.indexOf(needle, cursor);
    if (found < 0) break;
    let firstStart = found + needle.length;
    while (/\s/.test(source[firstStart] || "")) firstStart += 1;
    const first = readLatexGroup(source, firstStart);
    if (!first) {
      out += source.slice(cursor, found + needle.length);
      cursor = found + needle.length;
      continue;
    }
    let secondStart = first.end + 1;
    while (/\s/.test(source[secondStart] || "")) secondStart += 1;
    const second = readLatexGroup(source, secondStart);
    if (!second) {
      out += source.slice(cursor, found + needle.length);
      cursor = found + needle.length;
      continue;
    }
    out += source.slice(cursor, found);
    out += replacer(first.body, second.body);
    cursor = second.end + 1;
  }
  return out + source.slice(cursor);
}

function compactChatMathCell(value) {
  return formatChatMathText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function formatLatexMatrix(body) {
  const rows = String(body || "")
    .replace(/\r\n/g, "\n")
    .split(/\\\\/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row
      .split("&")
      .map(compactChatMathCell)
      .filter(Boolean)
      .join(", "));
  return `[${rows.join("; ")}]`;
}

function formatChatMathText(value) {
  let text = String(value || "").replace(/\r\n/g, "\n");
  text = text
    .replace(/^\s*\\\[\s*/, "")
    .replace(/\s*\\\]\s*$/g, "")
    .replace(/^\s*\$\$\s*/, "")
    .replace(/\s*\$\$\s*$/g, "");

  text = text.replace(/\\begin\{([pbBvV]?matrix|smallmatrix)\}([\s\S]*?)\\end\{\1\}/g, (_match, _env, body) => {
    return formatLatexMatrix(body);
  });

  text = replaceLatexTwoArgs(text, "frac", (top, bottom) => {
    return `(${compactChatMathCell(top)})/(${compactChatMathCell(bottom)})`;
  });
  text = replaceLatexOneArg(text, "boxed", (body) => `[${compactChatMathCell(body)}]`);
  text = replaceLatexOneArg(text, "text", (body) => body);
  text = replaceLatexOneArg(text, "mathrm", (body) => compactChatMathCell(body));
  text = replaceLatexOneArg(text, "mathbf", (body) => compactChatMathCell(body));
  text = replaceLatexOneArg(text, "mathit", (body) => compactChatMathCell(body));

  return text
    .replace(/\\left|\\right/g, "")
    .replace(/\\lambda/g, "\u03bb")
    .replace(/\\mu/g, "\u03bc")
    .replace(/\\alpha/g, "\u03b1")
    .replace(/\\beta/g, "\u03b2")
    .replace(/\\gamma/g, "\u03b3")
    .replace(/\\Delta/g, "\u0394")
    .replace(/\\Rightarrow/g, "\u21d2")
    .replace(/\\rightarrow/g, "\u2192")
    .replace(/\\leq?/g, "\u2264")
    .replace(/\\geq?/g, "\u2265")
    .replace(/\\neq?/g, "!=")
    .replace(/\\infty/g, "\u221e")
    .replace(/\\times/g, "\u00d7")
    .replace(/\\cdot/g, "\u00b7")
    .replace(/\\quad|\\qquad/g, "  ")
    .replace(/\\[,;:!]/g, " ")
    .replace(/_\{([^{}]+)\}/g, "_$1")
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .replace(/\\begin\{[^}]+\}|\\end\{[^}]+\}/g, "")
    .replace(/\\\\/g, "\n")
    .replace(/&/g, "  ")
    .replace(/\\([A-Za-z]+)\b/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/([A-Za-z0-9])\[/g, "$1 [")
    .replace(/\]([A-Za-z0-9])/g, "] $1")
    .replace(/\s*=\s*/g, " = ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function appendInlineMarkdown(parent, text) {
  const source = String(text || "");
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|\\\([^)]+\\\)|\$[^$\n]+\$|\\boxed\{[^{}\n]+\})/g;
  let lastIndex = 0;
  let match;
  while ((match = tokenRe.exec(source))) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else {
      const math = document.createElement("span");
      math.className = "math-inline";
      math.textContent = formatChatMathText(token.replace(/^\\\(|\\\)$/g, "").replace(/^\$|\$$/g, ""));
      parent.appendChild(math);
    }
    lastIndex = tokenRe.lastIndex;
  }
  if (lastIndex < source.length) {
    parent.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function appendParagraph(parent, lines) {
  const p = document.createElement("p");
  appendInlineMarkdown(p, lines.join(" ").trim());
  parent.appendChild(p);
}

function appendList(parent, lines, ordered) {
  const list = document.createElement(ordered ? "ol" : "ul");
  for (const line of lines) {
    const li = document.createElement("li");
    appendInlineMarkdown(li, line.replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ""));
    list.appendChild(li);
  }
  parent.appendChild(list);
}

function renderMarkdownText(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let list = [];
  let listOrdered = false;
  let math = [];
  let code = [];
  let inMath = false;
  let inCode = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    appendParagraph(frag, paragraph);
    paragraph = [];
  }
  function flushList() {
    if (!list.length) return;
    appendList(frag, list, listOrdered);
    list = [];
  }
  function flushMath() {
    if (!math.length) return;
    const pre = document.createElement("pre");
    pre.className = "math-block";
    pre.textContent = formatChatMathText(math.join("\n"));
    frag.appendChild(pre);
    math = [];
  }
  function flushCode() {
    if (!code.length) return;
    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.textContent = code.join("\n");
    pre.className = "code-block";
    pre.appendChild(codeEl);
    frag.appendChild(pre);
    code = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();

    if (inCode) {
      if (trimmed.startsWith("```")) {
        inCode = false;
        flushCode();
      } else {
        code.push(line);
      }
      continue;
    }
    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      inCode = true;
      continue;
    }

    if (inMath) {
      if (trimmed === "\\]" || trimmed === "$$") {
        inMath = false;
        flushMath();
      } else if (trimmed.endsWith("\\]")) {
        math.push(line.replace(/\\\]\s*$/, ""));
        inMath = false;
        flushMath();
      } else if (trimmed.endsWith("$$")) {
        math.push(line.replace(/\$\$\s*$/, ""));
        inMath = false;
        flushMath();
      } else {
        math.push(line);
      }
      continue;
    }
    const oneLineBracketMath = /^\\\[\s*([\s\S]+?)\s*\\\]$/.exec(trimmed);
    const oneLineDollarMath = /^\$\$\s*([\s\S]+?)\s*\$\$$/.exec(trimmed);
    if (oneLineBracketMath || oneLineDollarMath) {
      flushParagraph();
      flushList();
      math.push((oneLineBracketMath || oneLineDollarMath)[1]);
      flushMath();
      continue;
    }
    if (trimmed.startsWith("\\[") && trimmed !== "\\[") {
      flushParagraph();
      flushList();
      const rest = line.replace(/^\s*\\\[\s*/, "");
      if (rest.trim().endsWith("\\]")) {
        math.push(rest.replace(/\\\]\s*$/, ""));
        flushMath();
      } else {
        math.push(rest);
        inMath = true;
      }
      continue;
    }
    if (trimmed.startsWith("$$") && trimmed !== "$$") {
      flushParagraph();
      flushList();
      const rest = line.replace(/^\s*\$\$\s*/, "");
      if (rest.trim().endsWith("$$")) {
        math.push(rest.replace(/\$\$\s*$/, ""));
        flushMath();
      } else {
        math.push(rest);
        inMath = true;
      }
      continue;
    }
    if (trimmed === "\\[" || trimmed === "$$") {
      flushParagraph();
      flushList();
      inMath = true;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      frag.appendChild(document.createElement("hr"));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      const h = document.createElement(`h${level}`);
      appendInlineMarkdown(h, heading[2]);
      frag.appendChild(h);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+/.test(line);
    const unordered = /^\s*[-*]\s+/.test(line);
    if (ordered || unordered) {
      flushParagraph();
      if (list.length && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      list.push(line);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) flushCode();
  if (inMath) flushMath();
  flushParagraph();
  flushList();

  return frag;
}

function renderMessages() {
  messagesEl.innerHTML = "";
  if (!state.messages.length) {
    ensureEmptyState();
    return;
  }
  for (const message of state.messages) {
    const wrap = document.createElement("article");
    wrap.className = `message ${message.role}`;

    if (message.images && message.images.length) {
      const imageRow = document.createElement("div");
      imageRow.className = "image-row";
      for (const image of message.images) {
        const img = document.createElement("img");
        img.src = image.dataUrl;
        img.alt = "";
        imageRow.appendChild(img);
      }
      wrap.appendChild(imageRow);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.appendChild(renderMarkdownText(message.text || ""));
    wrap.appendChild(bubble);

    if (message.meta) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = message.meta;
      wrap.appendChild(meta);
    }

    messagesEl.appendChild(wrap);
  }
  scrollToBottom();
}

function renderAttachments() {
  attachmentsEl.innerHTML = "";
  attachmentsEl.hidden = state.attachments.length === 0;
  for (let i = 0; i < state.attachments.length; i += 1) {
    const attachment = state.attachments[i];
    const wrap = document.createElement("div");
    wrap.className = "attachment";
    const img = document.createElement("img");
    img.src = attachment.dataUrl;
    img.alt = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-attachment";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      state.attachments.splice(i, 1);
      renderAttachments();
      inputEl.focus();
    });
    wrap.appendChild(img);
    wrap.appendChild(remove);
    attachmentsEl.appendChild(wrap);
  }
}

function autosizeInput() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 132)}px`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(files) {
  for (const file of files) {
    if (state.attachments.length >= MAX_IMAGES) break;
    if (!file || !file.type || !file.type.startsWith("image/")) continue;
    if (file.size > MAX_IMAGE_BYTES) continue;
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) state.attachments.push({ dataUrl, name: file.name || "image" });
  }
  renderAttachments();
}

function buildPayloadMessages() {
  return state.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      text: message.text,
      images: message.role === "user" && Array.isArray(message.images) ? message.images : [],
    }));
}

function setSending(sending) {
  state.sending = sending;
  syncControls();
}

async function sendMessage() {
  if (state.sending || state.setupBusy || !state.configured) return;
  const text = inputEl.value.trim();
  const images = state.attachments.slice();
  if (!text && !images.length) return;

  state.messages.push({ role: "user", text, images, createdAt: nowIso() });
  inputEl.value = "";
  state.attachments = [];
  autosizeInput();
  renderAttachments();
  renderMessages();
  scheduleHistorySave();
  setSending(true);

  try {
    const result = await window.chatAPI.sendMessage({ messages: buildPayloadMessages() });
    if (result && result.status === "ok") {
      state.messages.push({
        role: "assistant",
        text: result.text || "",
        meta: result.fallbackUsed ? `via ${result.model}` : result.model,
        createdAt: nowIso(),
      });
    } else {
      const message = result && result.message ? result.message : "Chat failed.";
      state.messages.push({ role: "system", text: message, createdAt: nowIso() });
    }
  } catch (err) {
    state.messages.push({
      role: "system",
      text: err && err.message ? err.message : String(err),
      createdAt: nowIso(),
    });
  } finally {
    setSending(false);
    renderMessages();
    scheduleHistorySave();
    inputEl.focus();
  }
}

inputEl.addEventListener("input", autosizeInput);
inputEl.addEventListener("compositionstart", () => { state.composing = true; });
inputEl.addEventListener("compositionend", () => { state.composing = false; });
inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !state.composing && event.keyCode !== 229) {
    event.preventDefault();
    sendMessage();
  }
});

sendEl.addEventListener("click", sendMessage);

clearHistoryEl.addEventListener("click", async () => {
  if (state.sending) return;
  state.messages = [];
  renderMessages();
  try {
    await window.chatAPI.clearHistory();
  } catch (err) {
    state.messages.push({
      role: "system",
      text: err && err.message ? err.message : String(err),
      createdAt: nowIso(),
    });
    renderMessages();
  }
  inputEl.focus();
});

document.addEventListener("paste", (event) => {
  if (setupDialogEl.open || state.setupBusy || state.sending) return;
  const items = event.clipboardData && Array.from(event.clipboardData.items || []);
  const files = items
    .filter((item) => item.kind === "file" && item.type && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  addImageFiles(files).catch((err) => {
    state.messages.push({
      role: "system",
      text: err && err.message ? err.message : String(err),
      createdAt: nowIso(),
    });
    renderMessages();
    scheduleHistorySave();
  });
});

window.chatAPI.onStatus(setModelStatus);
window.chatAPI.getStatus().then(setModelStatus).catch((err) => {
  setModelStatus({ status: "error", message: err && err.message ? err.message : String(err) });
});

async function loadHistory() {
  const pendingMessages = state.messages.slice();
  try {
    const result = await window.chatAPI.getHistory();
    const loadedMessages = result && result.status === "ok"
      ? normalizeHistoryMessages(result.messages)
      : [];
    state.messages = normalizeHistoryMessages(loadedMessages.concat(pendingMessages));
  } catch (err) {
    state.messages = pendingMessages;
    console.warn("Failed to load chat history:", err);
  } finally {
    state.historyReady = true;
    renderMessages();
    if (pendingMessages.length) scheduleHistorySave();
  }
}

ensureEmptyState();
autosizeInput();
loadHistory();
syncControls();
window.chatAPI.getSetup().then((setup) => {
  applySetup(setup);
  if (!state.configured) showSetup();
}).catch(() => {
  applySetup(null);
  showSetup();
  setupFeedbackEl.textContent = "聊天设置暂不可用，请稍后重试。";
});
