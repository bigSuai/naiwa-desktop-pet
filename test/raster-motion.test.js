"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRasterMotionController } = require("../src/raster-motion");

function harness() {
  const frames = new Map();
  let time = 0, sequence = 0;
  const controller = createRasterMotionController({
    requestFrame: (callback) => { frames.set(++sequence, callback); return sequence; },
    cancelFrame: (id) => frames.delete(id), now: () => time,
  });
  controller.configure({ enabled: true, states: ["idle", "mini-idle"], maxX: 1.8, maxY: 0.6, maxRotation: 0.45, easeMs: 110 });
  const element = { tagName: "IMG", isConnected: true, style: { transform: "scaleX(-1)", transformOrigin: "old-origin" } };
  const step = () => { time += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); };
  const settle = () => { for (let i = 0; frames.size && i < 120; i++) step(); assert.equal(frames.size, 0, "RAF must stop after settling"); };
  return { controller, element, frames, step, settle };
}

test("raster following is bounded, eased, preserves mirroring and stops when settled", () => {
  const h = harness();
  h.controller.attach(h.element, "idle");
  h.controller.move(30, 30, 3);
  h.step();
  assert.ok(parseFloat(h.element.style.translate) > 0 && parseFloat(h.element.style.translate) < 1.8);
  h.settle();
  assert.equal(h.element.style.translate, "1.800px 0.600px");
  assert.equal(h.element.style.rotate, "0.450deg");
  assert.equal(h.element.style.transform, "scaleX(-1)");
  h.controller.detach();
  assert.equal(h.element.style.translate, "");
  assert.equal(h.element.style.transformOrigin, "old-origin");
});

test("working, reactions and SVG themes are never given raster pointer motion", () => {
  const h = harness();
  for (const state of ["working", "notification", "error", "sleeping", null]) {
    h.controller.attach(h.element, state);
    h.controller.move(3, 1, 3);
    assert.equal(h.frames.size, 0);
  }
  h.controller.attach({ ...h.element, tagName: "OBJECT" }, "idle");
  h.controller.move(3, 1, 3);
  assert.equal(h.frames.size, 0);
});

test("power pause, reduced motion and detached media cancel pending work", () => {
  for (const method of ["setPaused", "setReducedMotion"]) {
    const h = harness();
    h.controller.attach(h.element, "idle");
    h.controller.move(3, 1, 3);
    h.controller[method](true);
    assert.equal(h.frames.size, 0);
    h.controller.move(3, 1, 3);
    assert.equal(h.frames.size, 0);
    h.controller[method](false);
    h.controller.move(-3, 0, 3);
    assert.ok(h.frames.size > 0);
    h.element.isConnected = false;
    h.step();
    assert.equal(h.frames.size, 0);
    assert.equal(h.element.style.translate, "");
  }
});

test("theme changes and invalid coordinates cannot leak transforms or RAF loops", () => {
  const h = harness();
  h.controller.attach(h.element, "idle");
  h.controller.move(3, 1, 3);
  h.settle();
  h.controller.move(NaN, Infinity, 0);
  h.settle();
  assert.equal(h.element.style.translate, "0.000px 0.000px");
  h.controller.configure(null);
  h.controller.attach(h.element, "idle");
  h.controller.move(3, 1, 3);
  assert.equal(h.frames.size, 0);
  assert.equal(h.element.style.translate, "");
});
