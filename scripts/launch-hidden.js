"use strict";

const { spawn } = require("child_process");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const LAUNCH_SCRIPT = path.join(APP_DIR, "launch.js");
const DATA_DIR = process.env.CLAWD_DATA_DIR || path.join(APP_DIR, ".clawd-data");

const child = spawn(process.execPath, [LAUNCH_SCRIPT], {
  cwd: APP_DIR,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...process.env,
    CLAWD_DATA_DIR: DATA_DIR,
    CLAWD_HIDDEN_LAUNCH: "1",
  },
});

child.unref();
