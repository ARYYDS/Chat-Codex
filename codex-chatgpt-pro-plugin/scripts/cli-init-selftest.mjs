import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-init-test-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-home-test-"));
const realRepo = realpathSync(repo);

function runInit(extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [resolve("bin", "chatgpt-pro"), "init", ...extraArgs],
    {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        CHATGPT_PRO_HOME: home,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  const first = runInit();
  assert.equal(first.ok, true);
  assert.equal(first.command, "init");
  assert.equal(first.project.repoRoot, realRepo);
  assert.equal(existsSync(resolve(repo, ".devspace/state/chatgpt-project.json")), true);
  assert.equal(existsSync(first.sessions.path), true);
  assert.equal(existsSync(resolve(repo, ".codex/skills/chatgpt-pro-line/SKILL.md")), true);

  const project = JSON.parse(readFileSync(resolve(repo, ".devspace/state/chatgpt-project.json"), "utf8"));
  assert.equal(project.repoRoot, realRepo);
  assert.equal(project.schemaVersion, 1);

  const sessions = JSON.parse(readFileSync(first.sessions.path, "utf8"));
  assert.deepEqual(sessions, {
    schemaVersion: 2,
    projectId: project.projectId,
    rooms: {},
    freshThreads: [],
  });

  const second = runInit();
  assert.equal(second.ok, true);
  assert.equal(second.project.projectId, first.project.projectId);
  assert.equal(second.sessions.path, first.sessions.path);
  assert.equal(second.sessions.created, false);
  assert.equal(second.skill.changed, false);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "cli-init" }, null, 2));
