import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = pkg.scripts || {};
const skill = readFileSync(".codex/skills/chatgpt-pro-line/SKILL.md", "utf8");
const readme = readFileSync("README.md", "utf8");

for (const name of [
  "test",
  "test:deterministic",
  "test:v1",
  "plugin:sync",
  "test:plugin-package",
  "test:plugin-install",
  "live:doctor",
  "live:history-export",
  "live:rooms-rebind",
  "live:rooms-repair",
  "live:repo-thread-matrix",
  "test:live",
]) {
  assert.ok(scripts[name], `package.json is missing script ${name}`);
}

assert.equal(scripts.test, "npm run test:deterministic");
assert.match(scripts["test:v1"], /test:deterministic/);
assert.match(scripts["test:deterministic"], /test:plugin-package/);
assert.match(scripts["test:deterministic"], /test:plugin-install/);
assert.match(scripts["test:live"], /live:doctor/);
assert.match(scripts["test:live"], /live:history-export/);
assert.match(scripts["test:live"], /live:rooms-rebind/);
assert.match(scripts["test:live"], /live:rooms-repair/);
assert.match(scripts["test:live"], /live:repo-thread-matrix/);

for (const command of [
  "chatgpt-pro doctor --warm",
  "chatgpt-pro doctor --live",
  "chatgpt-pro status --alias=main",
  "chatgpt-pro rooms new --alias=critic",
  "chatgpt-pro rooms rebind --alias=spec",
  "chatgpt-pro rooms repair --alias=main",
  "chatgpt-pro history export --alias=spec",
  "chatgpt-pro call --alias=main",
]) {
  assert.ok(skill.includes(command), `Skill.md missing ${command}`);
}

assert.match(skill, /higher-level intelligence tasks/);
assert.match(skill, /Do not burn the line on trivial syntax/);
assert.match(skill, /roomTargetVerification: not_verified_registry_only/);
assert.match(skill, /all-visible/);

assert.match(readme, /`npm test`: runs deterministic tests only/);
assert.match(readme, /Room lifecycle commands/);
assert.match(readme, /live:history-export/);
assert.match(readme, /test:plugin-install/);

console.log(JSON.stringify({
  ok: true,
  tested: "v1-readiness",
  deterministicGate: "npm run test:v1",
  liveChecklist: [
    "npm run live:doctor",
    "npm run live:history-export",
    "npm run live:rooms-rebind",
    "npm run live:rooms-repair",
    "npm run live:repo-thread-matrix",
  ],
}, null, 2));
