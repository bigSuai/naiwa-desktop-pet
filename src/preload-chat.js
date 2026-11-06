"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const statusListeners = new Set();

ipcRenderer.on("chat:model-status", (_event, payload) => {
  for (const cb of statusListeners) {
    try { cb(payload); } catch (err) { console.warn("chat status listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("chatAPI", {
  getStatus: () => ipcRenderer.invoke("chat:get-status"),
  getSetup: () => ipcRenderer.invoke("chat:get-setup"),
  testSetup: (payload) => ipcRenderer.invoke("chat:test-setup", payload),
  saveSetup: (payload) => ipcRenderer.invoke("chat:save-setup", payload),
  openKeyPage: () => ipcRenderer.invoke("chat:open-key-page"),
  getHistory: () => ipcRenderer.invoke("chat:get-history"),
  saveHistory: (payload) => ipcRenderer.invoke("chat:save-history", payload),
  clearHistory: () => ipcRenderer.invoke("chat:clear-history"),
  sendMessage: (payload) => ipcRenderer.invoke("chat:send-message", payload),
  onStatus: (cb) => {
    if (typeof cb !== "function") return () => {};
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  },
});
