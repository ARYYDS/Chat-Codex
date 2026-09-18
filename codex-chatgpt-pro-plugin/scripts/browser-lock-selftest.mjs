import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  acquireBrowserProfileLock,
  browserProfileLockPaths,
  readBrowserProfileLockStatus,
} from "../src/browser-lock.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const root = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lock-test-"));

try {
  const first = await acquireBrowserProfileLock({
    root,
    runId: "run-1",
    alias: "main",
    timeoutMs: 1_000,
    noWait: true,
  });
  assert.equal(first.owner.runId, "run-1");

  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-2",
      alias: "main",
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.busy, true);
      assert.equal(error.details.owner.runId, "run-1");
      return true;
    },
  );

  const waited = acquireBrowserProfileLock({
    root,
    runId: "run-3",
    alias: "debug",
    timeoutMs: 2_000,
  });
  setTimeout(() => {
    first.release().catch(() => {});
  }, 100);
  const third = await waited;
  assert.equal(third.owner.runId, "run-3");
  assert.equal(third.receipt().waitMs >= 50, true);
  await third.release();

  const paths = browserProfileLockPaths(root);
  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "dead-owner",
    pid: 999999999,
    hostname: "test",
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "dead-owner",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  const reclaimed = await acquireBrowserProfileLock({
    root,
    runId: "run-4",
    staleLockTtlMs: 1,
    noWait: true,
  });
  assert.equal(reclaimed.receipt().staleLockDetected, true);
  assert.equal(reclaimed.receipt().staleLockReclaimed, true);
  await reclaimed.release();

  mkdirSync(paths.lockDir, { recursive: true });
  writeJson(paths.ownerPath, {
    runId: "live-owner",
    pid: process.pid,
    hostname: "test",
    startedAt: "2020-01-01T00:00:00.000Z",
  });
  writeJson(paths.heartbeatPath, {
    runId: "live-owner",
    lastHeartbeatAt: "2020-01-01T00:00:00.000Z",
  });
  await assert.rejects(
    () => acquireBrowserProfileLock({
      root,
      runId: "run-5",
      staleLockTtlMs: 1,
      noWait: true,
    }),
    (error) => {
      assert.equal(error.errorCode, "lock.busy");
      assert.equal(error.details.lock.stale, true);
      assert.equal(error.details.lock.ownerAlive, true);
      return true;
    },
  );
  assert.equal(existsSync(paths.lockDir), true);
  assert.equal(readBrowserProfileLockStatus({ root, staleLockTtlMs: 1 }).owner.runId, "live-owner");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "browser-lock" }, null, 2));
