"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { crc32 } = require("node:zlib");

const PACING = Object.freeze({
  "naiwa-motion-idle.png": 3300,
  "naiwa-motion-thinking.png": 2400,
  "naiwa-motion-working.png": 1000,
  "naiwa-motion-dozing.png": 4200,
  "naiwa-motion-sleeping.png": 4800,
});

function retimeApng(input, durationMs) {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 60000) throw new Error("Invalid cycle duration");
  if (!Buffer.isBuffer(input) || input.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG");
  const controls = [];
  let expectedFrames = 0, total = 0, ended = false;
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset), end = offset + length + 12;
    if (end > input.length) throw new Error("Truncated PNG chunk");
    if (crc32(input.subarray(offset + 4, end - 4)) !== input.readUInt32BE(end - 4)) throw new Error("Invalid PNG checksum");
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") expectedFrames = input.readUInt32BE(offset + 8);
    if (type === "fcTL") {
      if (length !== 26) throw new Error("Invalid animation frame control");
      const delay = 1000 * input.readUInt16BE(offset + 28) / (input.readUInt16BE(offset + 30) || 100);
      if (delay <= 0) throw new Error("Non-positive frame delay");
      controls.push({ offset, end, delay });
      total += delay;
    }
    if (type === "IEND") ended = true;
    offset = end;
  }
  if (!ended || !expectedFrames || expectedFrames !== controls.length) throw new Error("Not a complete animated PNG");
  if (Math.round(total) === durationMs) return Buffer.from(input);
  const output = Buffer.from(input);
  let elapsed = 0, previousBoundary = 0;
  for (const frame of controls) {
    elapsed += frame.delay;
    const boundary = Math.round(elapsed / total * durationMs);
    const delay = boundary - previousBoundary;
    if (delay < 1 || delay > 65535) throw new Error("Target pacing cannot represent every frame");
    output.writeUInt16BE(delay, frame.offset + 28);
    output.writeUInt16BE(1000, frame.offset + 30);
    output.writeUInt32BE(crc32(output.subarray(frame.offset + 4, frame.end - 4)), frame.end - 4);
    previousBoundary = boundary;
  }
  return output;
}

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  const directory = path.join(__dirname, "..", "themes", "naiwa", "assets");
  for (const [name, durationMs] of Object.entries(PACING)) {
    const file = path.join(directory, name);
    const input = fs.readFileSync(file), output = retimeApng(input, durationMs);
    if (apply && !output.equals(input)) fs.writeFileSync(file, output);
    console.log(JSON.stringify({ name, durationMs, changed: !output.equals(input), applied: apply }));
  }
}

module.exports = { PACING, retimeApng };
