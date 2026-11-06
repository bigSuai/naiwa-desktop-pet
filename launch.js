#!/usr/bin/env node

// Cross-platform launcher that ensures Electron runs in GUI mode.
//
// Claude Code (and other Electron-based tools) set ELECTRON_RUN_AS_NODE=1,
// which forces Electron to behave as a plain Node.js process — the browser
// layer never initializes, so `require("electron").app` is undefined.
//
// This launcher strips that variable before spawning the real Electron binary.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const electron = require("electron");
const { buildElectronLaunchConfig } = require("./hooks/shared-process");

const forwardedArgs = process.argv.slice(2);
const extraArgs = process.env.CLAWD_DEBUG_VISIBLE === '1' ? ['--disable-gpu','--force-color-profile=srgb','--enable-logging','--v=1','--auto-open-devtools-for-tabs'] : [];
const launchConfig = buildElectronLaunchConfig(__dirname, { forwardedArgs: forwardedArgs.concat(extraArgs) });
const localToolBin = process.env.CLAWD_LOCAL_TOOL_BIN || path.resolve(__dirname, "..", "..", "codex", "bin");
const pathKey = Object.prototype.hasOwnProperty.call(launchConfig.env, "Path") ? "Path" : "PATH";
const pathParts = String(launchConfig.env[pathKey] || "").split(";").filter(Boolean);
if (fs.existsSync(localToolBin) && !pathParts.some((part) => part.toLowerCase() === localToolBin.toLowerCase())) {
  launchConfig.env[pathKey] = [localToolBin, ...pathParts].join(";");
}
const localRegistry = path.resolve(localToolBin, "..", "LOCAL_TOOLS.md");
if (fs.existsSync(localRegistry)) launchConfig.env.CODEX_LOCAL_TOOLS = launchConfig.env.CODEX_LOCAL_TOOLS || localRegistry;
const child = spawn(electron, launchConfig.args, {
  stdio: "inherit",
  env: launchConfig.env,
  cwd: launchConfig.cwd,
});

child.on("close", (code) => process.exit(code ?? 0));
