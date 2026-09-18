import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const help = spawnSync(process.execPath, [resolve("bin/chatgpt-pro"), "help"], {
  cwd: resolve("."),
  encoding: "utf8",
});
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /doctor\s+Warm or verify/);
assert.match(help.stdout, /status\s+Show repo room/);
assert.match(help.stdout, /rooms <command>/);
assert.doesNotMatch(help.stdout, /sessions <command>/);
assert.match(help.stdout, /Repo room lifecycle commands/);

const skill = readFileSync(".codex/skills/chatgpt-pro-line/SKILL.md", "utf8");
const pluginSkill = readFileSync("skills/chatgpt-pro-line/SKILL.md", "utf8");
assert.match(skill, /chatgpt-pro doctor --warm/);
assert.match(skill, /chatgpt-pro doctor --live/);
assert.match(skill, /chatgpt-pro status --alias=main/);
assert.match(skill, /chatgpt-pro call --alias=main/);
assert.match(skill, /chatgpt-pro rooms new --alias=critic/);
assert.match(skill, /chatgpt-pro rooms rebind --alias=spec/);
assert.match(skill, /chatgpt-pro rooms repair --alias=main/);
assert.equal(pluginSkill, skill);

const readme = readFileSync("README.md", "utf8");
assert.match(readme, /chatgpt-pro doctor/);
assert.match(readme, /chatgpt-pro status --alias=main/);
assert.match(readme, /chatgpt-pro rooms rebind --alias=spec/);
assert.match(readme, /chatgpt-pro rooms repair --alias=main/);
assert.match(readme, /npm run test:v1/);
assert.match(readme, /npm run test:live/);
assert.match(readme, /`npm test`: runs deterministic tests only/);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync(".codex-plugin/plugin.json", "utf8"));
const marketplace = JSON.parse(readFileSync(".agents/plugins/marketplace.json", "utf8"));
const codexConfig = readFileSync(".codex/config.toml", "utf8");
assert.equal(manifest.name, pkg.name);
assert.equal(manifest.skills, "./skills/");
assert.equal(marketplace.plugins?.some((entry) =>
  entry.name === pkg.name
  && entry.source?.source === "local"
  && entry.source?.path === "./plugins/codex-chatgpt-pro-plugin",
), true);
assert.ok(pkg.scripts["test:plugin-package"]);
assert.ok(pkg.scripts["test:plugin-install"]);
assert.ok(pkg.scripts["plugin:sync"]);
assert.equal(pkg.devDependencies?.["chrome-devtools-mcp"], "1.2.0");
assert.doesNotMatch(codexConfig, /command\s*=\s*"npx"/);
assert.match(codexConfig, /command\s*=\s*"\.\/node_modules\/\.bin\/chrome-devtools-mcp"/);
assert.equal(pkg.files?.includes("docs/"), false);
assert.ok(pkg.files?.includes("docs/*.md"));
assert.match(pkg.scripts["test:v1"], /test:deterministic/);
assert.match(pkg.scripts["test:deterministic"], /test:plugin-package/);
assert.match(pkg.scripts["test:deterministic"], /test:plugin-install/);
assert.match(pkg.scripts["test:live"], /live:history-export/);
assert.match(pkg.scripts["test:live"], /live:rooms-rebind/);
assert.match(pkg.scripts["test:live"], /live:rooms-repair/);
assert.match(pkg.scripts["test:live"], /live:repo-thread-matrix/);

console.log(JSON.stringify({ ok: true, tested: "package-surface" }, null, 2));
