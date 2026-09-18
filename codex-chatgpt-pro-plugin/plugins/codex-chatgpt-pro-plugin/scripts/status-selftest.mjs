import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-status-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-status-home-"));
mkdirSync(repo, { recursive: true });

process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const { ensureProjectState } = await import(`../src/project-state.mjs?status=${Date.now()}`);
const { acquireChatGptOperation } = await import(`../src/chatgpt-operation.mjs?status=${Date.now()}`);

function runChatgpt(args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: repo,
      CHATGPT_PRO_HOME: home,
    },
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

try {
  const project = ensureProjectState();
  const initial = runChatgpt(["status", "--alias=main"]);
  assert.equal(initial.ok, true);
  assert.equal(initial.operationKind, "registry-read");
  assert.equal(initial.project.projectId, project.projectId);
  assert.equal(initial.room.found, false);
  assert.equal(initial.locks.browser.busy, false);

  const lock = await acquireChatGptOperation({
    name: "fixture.active-call",
    kind: "live-browser",
    runId: "fixture-status-lock",
    project,
    alias: "main",
    requiresBrowser: true,
    noWait: true,
  });
  try {
    const locked = runChatgpt(["status", "--alias=main"]);
    assert.equal(locked.ok, true);
    assert.equal(locked.locks.browser.busy, true);
    assert.equal(locked.locks.browser.owner.runId, "fixture-status-lock");
    assert.equal(locked.operationKind, "registry-read");
  } finally {
    await lock.release();
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "status" }, null, 2));
