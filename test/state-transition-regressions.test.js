"use strict";

const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const themeLoader = require("../src/theme-loader");
const initState = require("../src/state");

themeLoader.init(path.join(__dirname, "..", "src"));
const defaultTheme = themeLoader.loadTheme("clawd");

function makeCtx() {
  const stateChanges = [];
  const sounds = [];
  return {
    theme: JSON.parse(JSON.stringify(defaultTheme)),
    doNotDisturb: false,
    miniMode: false,
    miniTransitioning: false,
    mouseOverPet: false,
    mouseStillSince: Date.now(),
    playSound: (name) => sounds.push(name),
    sendToRenderer: (channel, state) => {
      if (channel === "state-change") stateChanges.push(state);
    },
    sendToHitWin() {},
    syncHitWin() {},
    miniPeekIn() {},
    miniPeekOut() {},
    buildContextMenu() {},
    buildTrayMenu() {},
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    processKill: () => {
      const error = new Error("ESRCH");
      error.code = "ESRCH";
      throw error;
    },
    t: (key) => key,
    stateChanges,
    sounds,
  };
}

describe("state transition regressions", () => {
  let api;
  let ctx;

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000000 });
    ctx = makeCtx();
    api = initState(ctx);
  });

  afterEach(() => {
    api.cleanup();
    mock.timers.reset();
  });

  function update(id, state, event) {
    api.updateSession(id, state, event, { agentId: "claude-code" });
  }

  it("does not revive a queued permission notification after resolution", () => {
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");
    api.clearPermissionNotification("a");

    mock.timers.tick(ctx.theme.timings.minDisplay.working);

    assert.equal(api.getCurrentState(), "working");
    assert.ok(!ctx.stateChanges.includes("notification"));
    assert.ok(!ctx.sounds.includes("confirm"));
  });

  it("restores another active session after mini-happy finishes", () => {
    ctx.miniMode = true;
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("b", "working", "PreToolUse");
    update("a", "attention", "Stop");
    assert.equal(api.getCurrentState(), "mini-happy");

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

    assert.equal(api.resolveDisplayState(), "working");
    assert.equal(api.getCurrentState(), "mini-working");
  });

  it("leaves mini-working after the last session ends following a resolved alert", () => {
    ctx.miniMode = true;
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");
    api.clearPermissionNotification("a");
    assert.equal(api.getCurrentState(), "mini-working");

    update("a", "idle", "SessionEnd");
    mock.timers.tick(60000);

    assert.equal(api.sessions.size, 0);
    assert.equal(api.resolveDisplayState(), "idle");
    assert.equal(api.getCurrentState(), "mini-idle");
  });

  it("preserves a higher-priority queued error when permission resolves", () => {
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");
    update("b", "error", "PostToolUseFailure");
    api.clearPermissionNotification("a");

    mock.timers.tick(ctx.theme.timings.minDisplay.working);
    assert.equal(api.getCurrentState(), "error");
    mock.timers.tick(ctx.theme.timings.autoReturn.error);
    assert.equal(api.getCurrentState(), "working");
  });

  it("preserves the minimum display time of an already visible error", () => {
    update("a", "working", "PreToolUse");
    mock.timers.tick(ctx.theme.timings.minDisplay.working);
    update("b", "error", "PostToolUseFailure");
    update("a", "notification", "PermissionRequest");
    api.clearPermissionNotification("a");

    assert.equal(api.getCurrentState(), "error");
    mock.timers.tick(ctx.theme.timings.minDisplay.error - 1);
    assert.equal(api.getCurrentState(), "error");
    mock.timers.tick(1);
    assert.equal(api.getCurrentState(), "working");
    assert.ok(!ctx.stateChanges.includes("notification"));
  });

  it("keeps another session's queued permission notification", () => {
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");
    update("b", "notification", "PermissionRequest");
    api.clearPermissionNotification("a");

    mock.timers.tick(ctx.theme.timings.minDisplay.working);

    assert.equal(api.getCurrentState(), "notification");
    assert.equal(ctx.sounds.filter((sound) => sound === "confirm").length, 1);
  });

  it("keeps a queued Notification hook unrelated to the resolved permission", () => {
    update("a", "working", "PreToolUse");
    update("b", "notification", "Notification");
    api.clearPermissionNotification("a");

    mock.timers.tick(ctx.theme.timings.minDisplay.working);

    assert.equal(api.getCurrentState(), "notification");
  });

  it("keeps a queued notification while the same session has another permission", () => {
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");
    api.clearPermissionNotification("a", { hasPendingForSession: true });

    mock.timers.tick(ctx.theme.timings.minDisplay.working);

    assert.equal(api.getCurrentState(), "notification");
  });

  for (const state of ["thinking", "juggling"]) {
    it(`restores a remaining ${state} session after mini-happy finishes`, () => {
      ctx.miniMode = true;
      api.applyState("mini-idle");
      update("a", "working", "PreToolUse");
      update("b", state, state === "thinking" ? "UserPromptSubmit" : "SubagentStart");
      update("a", "attention", "Stop");

      mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

      assert.equal(api.resolveDisplayState(), state);
      assert.equal(api.getCurrentState(), "mini-working");
    });
  }

  it("resumes active mini work before considering hover peek", () => {
    ctx.miniMode = true;
    ctx.mouseOverPet = true;
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("b", "attention", "Stop");

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

    assert.equal(api.getCurrentState(), "mini-working");
    assert.ok(!ctx.stateChanges.includes("mini-peek"));
  });

  it("resumes active work after mini-alert finishes", () => {
    ctx.miniMode = true;
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("a", "notification", "PermissionRequest");

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-alert"]);

    assert.equal(api.getCurrentState(), "mini-working");
  });

  it("keeps a Kimi permission lock visible after mini-alert finishes", () => {
    ctx.miniMode = true;
    api.applyState("mini-idle");
    api.updateSession("kimi", "notification", "PermissionRequest", { agentId: "kimi-cli" });

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-alert"]);

    assert.equal(api.resolveDisplayState(), "notification");
    assert.equal(api.getCurrentState(), "mini-alert");
  });

  it("falls back to mini-idle when active work has no optional mini-working art", () => {
    ctx.miniMode = true;
    delete ctx.theme.miniMode.states["mini-working"];
    delete ctx.theme._stateBindings["mini-working"];
    api.refreshTheme();
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("b", "attention", "Stop");

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

    assert.equal(api.resolveDisplayState(), "working");
    assert.equal(api.getCurrentState(), "mini-idle");
  });

  it("preserves hover peek when mini-happy finishes without active sessions", () => {
    ctx.miniMode = true;
    ctx.mouseOverPet = true;
    api.applyState("mini-idle");
    update("a", "attention", "Stop");

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

    assert.equal(api.getCurrentState(), "mini-peek");
  });

  it("does not restore active work after DND cancels mini-happy", () => {
    ctx.miniMode = true;
    api.applyState("mini-idle");
    update("a", "working", "PreToolUse");
    update("b", "attention", "Stop");
    api.enableDoNotDisturb();

    mock.timers.tick(ctx.theme.timings.autoReturn["mini-happy"]);

    assert.equal(api.getCurrentState(), "mini-sleep");
  });
});
