"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crc32 } = require("node:zlib");
const { probeApngCycle } = require("../src/animation-cycle");
const { retimeApng } = require("../scripts/retime-naiwa-motion");
const source = fs.readFileSync(path.join(__dirname, "../themes/naiwa/assets/naiwa-motion-idle.png"));

function chunks(buffer) {
  const result = [];
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const size = buffer.readUInt32BE(offset);
    result.push({ type: buffer.toString("ascii", offset + 4, offset + 8), raw: buffer.subarray(offset, offset + size + 12) });
    offset += size + 12;
  }
  return result;
}

test("pacing edits only frame delays and their CRC, never artwork pixels", () => {
  const output = retimeApng(source, 4400);
  assert.equal(probeApngCycle(output).ms, 4400);
  const before = chunks(source), after = chunks(output);
  assert.equal(before.length, after.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(before[i].type, after[i].type);
    if (before[i].type !== "fcTL") assert.deepEqual(after[i].raw, before[i].raw);
    else {
      assert.deepEqual(after[i].raw.subarray(0, 28), before[i].raw.subarray(0, 28));
      assert.deepEqual(after[i].raw.subarray(32, 34), before[i].raw.subarray(32, 34));
    }
    assert.equal(after[i].raw.readUInt32BE(after[i].raw.length - 4), crc32(after[i].raw.subarray(4, -4)));
  }
});

test("pacing is deterministic and idempotent", () => {
  const output = retimeApng(source, 3300);
  assert.deepEqual(retimeApng(output, 3300), output);
  assert.deepEqual(retimeApng(source, 3300), output);
});

test("pacing rejects invalid targets and truncated or static files", () => {
  for (const duration of [0, -1, NaN, 70000]) assert.throws(() => retimeApng(source, duration));
  assert.throws(() => retimeApng(Buffer.from("not a png"), 3000));
  assert.throws(() => retimeApng(source.subarray(0, 100), 3000));
});
