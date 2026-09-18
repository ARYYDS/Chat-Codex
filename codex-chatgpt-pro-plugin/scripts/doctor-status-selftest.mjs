import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-doctor-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-doctor-home-"));
mkdirSync(repo, { recursive: true });

process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const { ensureProjectState } = await import(`../src/project-state.mjs?doctor=${Date.now()}`);
const { acquireChatGptOperation } = await import(`../src/chatgpt-operation.mjs?doctor=${Date.now()}`);

function runChatgpt(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: repo,
      CHATGPT_PRO_HOME: home,
      CHATGPT_LOCK_TIMEOUT_MS: "50",
      CHROME_REMOTE_DEBUGGING_PORT: "9",
    },
  });
}

function parseJson(result) {
  const start = result.stdout.indexOf("{");
  assert.notEqual(start, -1, result.stdout || result.stderr);
  return JSON.parse(result.stdout.slice(start));
}

try {
  const project = ensureProjectState();
  const lock = await acquireChatGptOperation({
    name: "fixture.active-call",
    kind: "live-browser",
    runId: "fixture-doctor-lock",
    project,
    alias: "main",
    requiresBrowser: true,
    noWait: true,
  });
  try {
    for (const args of [
      ["doctor", "--live", "--no-wait"],
      ["doctor", "--warm", "--no-wait"],
    ]) {
      const result = runChatgpt(args);
      const parsed = parseJson(result);
      assert.notEqual(result.status, 0, `${args.join(" ")} should fail under held browser lock`);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.errorCode, "lock.busy");
      assert.match(parsed.operation.name, /^doctor\./);
    }

    const status = runChatgpt(["status", "--alias=main"]);
    const statusJson = parseJson(status);
    assert.equal(status.status, 0);
    assert.equal(statusJson.ok, true);
    assert.equal(statusJson.operationKind, "registry-read");
    assert.equal(statusJson.locks.browser.busy, true);
    assert.equal(statusJson.locks.browser.owner.runId, "fixture-doctor-lock");
  } finally {
    await lock.release();
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "doctor-status" }, null, 2));
