import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { acquireChatGptOperation, withChatGptOperation } from "../src/chatgpt-operation.mjs";
import { browserProfileLockPaths } from "../src/browser-lock.mjs";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-operation-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-operation-home-"));
const lockRoot = mkdtempSync(resolve(tmpdir(), "chatgpt-operation-locks-"));
process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const { ensureProjectState } = await import(`../src/project-state.mjs?operation=${Date.now()}`);

try {
  const project = ensureProjectState();
  const registryOnly = await withChatGptOperation({
    name: "status",
    runId: "status-1",
    project,
    requiresBrowser: false,
    browserLockRoot: lockRoot,
  }, async (op) => ({ projectId: op.project.projectId }));
  assert.equal(registryOnly.value.projectId, project.projectId);
  assert.equal(registryOnly.locks.browser.required, false);
  assert.equal(existsSync(browserProfileLockPaths(lockRoot).lockDir), false);

  const firstStarted = withChatGptOperation({
    name: "call",
    runId: "call-1",
    project,
    alias: "main",
    requiresBrowser: true,
    browserLockRoot: lockRoot,
  }, async (op) => {
    assert.equal(op.operation.alias, "main");
    assert.equal(op.locks.browser.acquired, true);
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 150));
    return "held";
  });

  await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
  await assert.rejects(
    () => withChatGptOperation({
      name: "history.export",
      runId: "history-while-call",
      project,
      alias: "main",
      requiresBrowser: true,
      noWait: true,
      browserLockRoot: lockRoot,
    }, async () => "should-not-run"),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.owner.runId, "call-1");
      assert.equal(error.details.operation.name, "history.export");
      return true;
    },
  );

  const first = await firstStarted;
  assert.equal(first.value, "held");
  assert.equal(first.locks.browser.required, true);
  assert.equal(first.locks.browser.acquired, true);
  assert.equal(first.locks.browser.receipt.released, true);
  assert.equal(existsSync(browserProfileLockPaths(lockRoot).lockDir), false);

  const handle = await acquireChatGptOperation({
    name: "read",
    kind: "live-browser",
    runId: "read-handle",
    project,
    alias: "main",
    requiresBrowser: true,
    browserLockRoot: lockRoot,
  });
  assert.equal(handle.operation.name, "read");
  assert.equal(handle.operation.kind, "live-browser");
  assert.equal(handle.receipt().locks.browser.acquired, true);
  const releasedHandle = await handle.release();
  assert.equal(releasedHandle.locks.browser.receipt.released, true);

  const stateWrite = await withChatGptOperation({
    name: "rooms.rebind",
    runId: "rooms-1",
    project,
    alias: "main",
    requiresBrowser: false,
  }, async (op) =>
    op.withProjectStateWrite("fixture-write", () => ({ wrote: true })),
  );
  assert.deepEqual(stateWrite.value, { wrote: true });
  assert.equal(stateWrite.locks.projectState.length, 1);
  assert.equal(stateWrite.locks.projectState[0].reason, "fixture-write");
  assert.equal(stateWrite.locks.projectState[0].receipt.released, true);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  rmSync(lockRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "chatgpt-operation" }, null, 2));
