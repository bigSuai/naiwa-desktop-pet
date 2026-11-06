"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { parseDocument, DomUtils } = require("htmlparser2");

function shouldInclude(file) {
  const name = file.replace(/\\/g, "/");
  if (name.split("/").some((part) => [".git", ".clawd-data", "node_modules", "dist", "logs", "__pycache__"].includes(part))) return false;
  if (/(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|pem|pfx|key|log|bak|tmp)$/i.test(name)) return false;
  if (/^assets\/source\/naiwa\//.test(name)) {
    return /^assets\/source\/naiwa\/(?:ASSET-NOTICE\.md|UPSTREAM-LICENSE\.txt|(?:busy|error|idle|listen|target)\/\d+\.png|laugh-restoration-20261106\/raw-target\/[^/]+\.png)$/.test(name);
  }
  if (/^themes\/naiwa\//.test(name)) {
    return /^themes\/naiwa\/(?:assets\/[^/]+\.(?:png|ico|svg)|(?:theme|animation-manifest|continuous-motion)\.json|(?:build-theme|improve-motion)\.py|README\.md|THIRD-PARTY-NOTICES\.md|UPSTREAM-LICENSE\.txt|preview\.html)$/.test(name);
  }
  if (/^(?:src|agents|hooks|extensions|test|scripts|build|bin|themes|assets|docs|tools|perf|\.github)\//.test(name)) return true;
  return /^(?:package(?:-lock)?\.json|launch\.js|\.gitignore|LICENSE|NOTICE\.md|README(?:\.[\w-]+)?\.md|AGENTS\.md|CLAUDE\.md|test-[\w-]+\.sh)$/.test(name);
}

function scanPublicSource(root) {
  const violations = [];
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (file.replace(/\\/g, "/").startsWith(".git/")) continue;
    const absolute = path.join(root, file);
    if (!fs.lstatSync(absolute).isFile()) continue;
    const relative = file.replace(/\\/g, "/");
    if (!shouldInclude(relative)) violations.push({ file: relative, kind: "private-file" });
    const bytes = fs.statSync(absolute).size;
    if (bytes >= 95 * 1024 * 1024) violations.push({ file: relative, kind: "oversized-file" });
    if (/\.(?:png|ico|webp|gif|mp3|wav|woff2?|zip|exe)$/i.test(file)) continue;
    const text = fs.readFileSync(absolute, "utf8");
    if (/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/.test(text)) violations.push({ file: relative, kind: "credential" });
    if (/(?:C:[\\/]+Users[\\/]+20834|E:[\\/]+codex[\\/]|E:[\\/]+Apps[\\/]+clawd-on-desk)/i.test(text)) violations.push({ file: relative, kind: "machine-path" });
  }
  return violations;
}

function preparePublicSource(source, destination) {
  const root = path.resolve(source);
  const target = path.resolve(destination);
  if (target === root || target.startsWith(root + path.sep)) throw new Error("Publish snapshot must be outside the working repository.");
  if (fs.existsSync(target)) throw new Error("Destination exists; select a new snapshot directory.");
  const entries = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const files = [...new Set(entries)].filter(shouldInclude);
  for (const file of files) {
    const sourceFile = path.resolve(root, file);
    if (!sourceFile.startsWith(root + path.sep)) throw new Error("Invalid source path.");
    if (!fs.existsSync(sourceFile)) continue;
    if (!fs.lstatSync(sourceFile).isFile()) throw new Error(`Non-regular file: ${file}`);
    const output = path.join(target, file);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(sourceFile, output);
  }
  // Keep upstream translations while making the fork's guide the entry point.
  const guide = path.join(target, "README.naiwa.md");
  if (fs.existsSync(guide)) {
    const original = fs.readFileSync(path.join(target, "README.md"), "utf8");
    fs.mkdirSync(path.join(target, "docs"), { recursive: true });
    fs.writeFileSync(path.join(target, "docs", "UPSTREAM-README.md"), original);
    const document = parseDocument(original);
    const credits = DomUtils.getElementsByTagName("table", document.children, true)
      .map((table) => DomUtils.getOuterHTML(table))
      .filter((table) => table.includes("https://github.com/"));
    if (!credits.length) throw new Error("Missing upstream contributor credits.");
    fs.writeFileSync(path.join(target, "README.md"), fs.readFileSync(guide, "utf8") + "\n\n## 上游维护者与贡献者\n\n<details><summary>Clawd on Desk 原项目致谢</summary>\n\n" + credits.join("\n\n") + "\n\n</details>\n");
  }
  const violations = scanPublicSource(target);
  return { target, files: files.length, violations };
}

if (require.main === module) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("Usage: node scripts/prepare-public-source.js SOURCE NEW_DESTINATION");
  const result = preparePublicSource(source, destination);
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length) process.exitCode = 1;
}

module.exports = { shouldInclude, scanPublicSource, preparePublicSource };
