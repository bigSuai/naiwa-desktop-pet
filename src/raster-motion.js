"use strict";
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClawdRasterMotion = api;
})(globalThis, function () {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  function createRasterMotionController({ requestFrame, cancelFrame, now = () => performance.now() }) {
    let config = null, element = null, saved = null, frame = null, previousTime = null;
    let paused = false, reduced = false;
    let position = [0, 0, 0], target = [0, 0, 0];

    function cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      previousTime = null;
    }

    function paint() {
      if (!element) return;
      element.style.translate = `${position[0].toFixed(3)}px ${position[1].toFixed(3)}px`;
      element.style.rotate = `${position[2].toFixed(3)}deg`;
    }

    function detach() {
      cancel();
      if (element && saved) Object.assign(element.style, saved);
      element = null;
      saved = null;
      position = [0, 0, 0];
      target = [0, 0, 0];
    }

    function configure(input) {
      detach();
      config = input && input.enabled === true ? {
        states: new Set(Array.isArray(input.states) ? input.states : []),
        maxX: clamp(finite(input.maxX, 1.8), 0, 4),
        maxY: clamp(finite(input.maxY, 0.6), 0, 2),
        maxRotation: clamp(finite(input.maxRotation, 0.45), 0, 1.2),
        easeMs: clamp(finite(input.easeMs, 110), 60, 400),
      } : null;
    }

    function attach(next, state) {
      if (!config || !config.states.has(state) || !next || next.tagName !== "IMG") {
        detach();
        return;
      }
      if (element === next) return;
      detach();
      element = next;
      saved = {
        translate: next.style.translate || "", rotate: next.style.rotate || "",
        transformOrigin: next.style.transformOrigin || "",
      };
      // Individual transforms preserve the renderer's existing mini-mode flip.
      element.style.transformOrigin = "50% 92.5%";
    }

    function tick(timestamp) {
      frame = null;
      if (!element || element.isConnected === false || !config) { detach(); return; }
      if (paused || reduced) return;
      const time = finite(timestamp, now());
      const elapsed = previousTime === null ? 16.667 : clamp(time - previousTime, 1, 64);
      previousTime = time;
      const alpha = 1 - Math.exp(-elapsed / config.easeMs);
      let settled = true;
      position = position.map((value, i) => {
        const next = value + (target[i] - value) * alpha;
        if (Math.abs(target[i] - next) < 0.008) return target[i];
        settled = false;
        return next;
      });
      paint();
      if (!settled) frame = requestFrame(tick);
      else previousTime = null;
    }

    function move(dx, dy, range = 3) {
      if (!element || !config || paused || reduced) return;
      const divisor = Number.isFinite(range) && range > 0 ? range : 3;
      const x = clamp(finite(dx, 0) / divisor, -1, 1);
      const y = clamp(finite(dy, 0) / divisor, -1, 1);
      target = [x * config.maxX, y * config.maxY, x * config.maxRotation];
      if (frame === null && position.some((value, i) => Math.abs(target[i] - value) > 0.001)) frame = requestFrame(tick);
    }

    function suspend() {
      if (!paused && !reduced) return;
      cancel();
      position = [0, 0, 0];
      target = [0, 0, 0];
      paint();
    }

    return {
      configure, attach, detach, move,
      setPaused(value) { paused = !!value; suspend(); },
      setReducedMotion(value) { reduced = !!value; suspend(); },
    };
  }

  return { createRasterMotionController };
});
