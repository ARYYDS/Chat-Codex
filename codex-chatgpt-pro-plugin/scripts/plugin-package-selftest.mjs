import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertFile(path) {
  assert.ok(existsSync(path), `missing required file: ${path}`);
}

function walkFiles(root, files = []) {
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, files);
    else files.push(path);
  }
  return files;
}

function walkEntries(root, entries = []) {
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry);
    entries.push(path);
    if (statSync(path).isDirectory()) walkEntries(path, entries);
  }
  return entries;
}

const pkg = readJson("package.json");
const manifest = readJson(".codex-plugin/plugin.json");
const marketplace = readJson(".agents/plugins/marketplace.json");
const devSkillPath = ".codex/skills/chatgpt-pro-line/SKILL.md";
const pluginSkillPath = "skills/chatgpt-pro-line/SKILL.md";
const devSkill = readFileSync(devSkillPath, "utf8");
const pluginSkill = readFileSync(pluginSkillPath, "utf8");
const syncScript = readFileSync("scripts/sync-plugin-package.mjs", "utf8");

assert.equal(manifest.name, pkg.name);
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.interface?.displayName, "ChatGPT Pro Line");
assert.ok(manifest.interface?.capabilities?.includes("Interactive"));
assert.ok(manifest.interface?.capabilities?.includes("Read"));
assert.ok(manifest.interface?.capabilities?.includes("Write"));

assertFile(".codex-plugin/plugin.json");
assertFile(".agents/plugins/marketplace.json");
assertFile("bin/chatgpt-pro");
assertFile(devSkillPath);
assertFile(pluginSkillPath);
const pluginRoot = "plugins/codex-chatgpt-pro-plugin";
assert.ok(lstatSync(pluginRoot).isDirectory());
const pluginEntries = walkEntries(pluginRoot);
const pluginFiles = walkFiles(pluginRoot);
for (const disallowed of ["/.git/", "/.devspace/", "/node_modules/", "/.DS_Store", "/docs/assets"]) {
  assert.equal(
    pluginEntries.some((path) => path.includes(disallowed) || path.endsWith(disallowed.slice(1))),
    false,
    `packaged plugin must not contain ${disallowed}`,
  );
}
for (const pluginFile of pluginFiles) {
  const sourceFile = pluginFile.replace(`${resolve(pluginRoot)}/`, "");
  assertFile(sourceFile);
  assert.equal(
    readFileSync(pluginFile).equals(readFileSync(sourceFile)),
    true,
    `packaged plugin file is out of sync: ${sourceFile}`,
  );
}
accessSync("bin/chatgpt-pro", constants.X_OK);

assert.equal(pluginSkill, devSkill, "plugin skill copy must match repo-local .codex skill copy");
assert.match(pluginSkill, /<plugin-root>\/bin\/chatgpt-pro/);
assert.match(pluginSkill, /higher-level intelligence tasks/);
assert.match(pluginSkill, /npm run live:repo-thread-matrix/);
assert.match(pluginSkill, /global browser-profile lock/);
assert.match(syncScript, /isSymbolicLink/);
assert.match(syncScript, /dereference:\s*false/);
assert.match(syncScript, /secretPathFinding/);

assert.equal(marketplace.name, pkg.name);
const entry = marketplace.plugins?.find((candidate) => candidate.name === pkg.name);
assert.ok(entry, "marketplace must include this plugin");
assert.equal(entry.source?.source, "local");
assert.equal(entry.source?.path, "./plugins/codex-chatgpt-pro-plugin");
assert.equal(entry.policy?.installation, "AVAILABLE");
assert.equal(entry.policy?.authentication, "ON_INSTALL");
assert.equal(entry.category, "Developer Tools");

for (const file of [
  ".codex-plugin/",
  ".agents/plugins/marketplace.json",
  "plugins/codex-chatgpt-pro-plugin",
  "skills/",
  "bin/",
  "src/",
  "scripts/",
  "docs/*.md",
  "LICENSE",
  "README.md",
]) {
  assert.ok(pkg.files?.includes(file), `package.json files must include ${file}`);
}

const pack = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  cwd: resolve("."),
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
assert.equal(pack.status, 0, pack.stderr || pack.stdout);
const [packInfo] = JSON.parse(pack.stdout);
const packedFiles = (packInfo.files || []).map((entry) => entry.path);
assert.equal(packedFiles.some((file) => file.startsWith("docs/assets/")), false);
assert.equal(packedFiles.some((file) => file.includes("/.devspace/") || file.startsWith(".devspace/")), false);
assert.equal(packedFiles.some((file) => /\.env(\.|$)/.test(file)), false);

console.log(JSON.stringify({
  ok: true,
  tested: "plugin-package",
  plugin: {
    name: manifest.name,
    version: manifest.version,
    manifestPath: resolve(".codex-plugin/plugin.json"),
    marketplacePath: resolve(".agents/plugins/marketplace.json"),
    skillPath: resolve(pluginSkillPath),
    cliPath: resolve("bin/chatgpt-pro"),
  },
}, null, 2));
