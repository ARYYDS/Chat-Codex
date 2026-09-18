import assert from "node:assert/strict";
import { dirname } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lineage-test-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-lineage-home-"));
process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const {
  normalizeSessionRegistry,
  recordChatGptAliasUse,
  recordFreshThread,
  sessionRegistryPath,
} = await import(`../src/chatgpt-sessions.mjs?test=${Date.now()}`);
const { ensureProjectState } = await import(`../src/project-state.mjs?test=${Date.now()}`);

try {
  const project = ensureProjectState();
  const legacy = normalizeSessionRegistry({
    aliases: {
      main: {
        targetId: "target-1",
        url: "https://chatgpt.com/c/legacy-room",
        title: "Legacy Room",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  }, project);

  assert.equal(legacy.schemaVersion, 2);
  assert.equal(legacy.rooms.main.activeThreadId, "chatgpt:legacy-room");
  assert.equal(legacy.rooms.main.lineage.length, 1);
  assert.equal(legacy.rooms.main.lineage[0].status, "active");

  mkdirSync(dirname(sessionRegistryPath), { recursive: true });
  writeFileSync(sessionRegistryPath, `${JSON.stringify(legacy, null, 2)}\n`);
  const aliasUse = recordChatGptAliasUse({
    name: "main",
    target: {
      id: "target-1",
      title: "Legacy Room",
      url: "https://chatgpt.com/c/legacy-room",
    },
    runId: "run-1",
    receiptPath: "/tmp/run-1/receipt.json",
    transcriptPath: "/tmp/run-1/transcript.md",
  });
  assert.equal(aliasUse.callCount, 1);
  assert.equal(aliasUse.recentRuns[0].runId, "run-1");
  assert.equal(aliasUse.lineage[0].lastRunId, "run-1");

  const fresh = recordFreshThread({
    aliasHint: "critic",
    target: {
      id: "target-fresh",
      title: "Fresh Review",
      url: "https://chatgpt.com/c/fresh-review",
    },
    runId: "fresh-1",
    receiptPath: "/tmp/fresh-1/receipt.json",
    transcriptPath: "/tmp/fresh-1/transcript.md",
  });
  assert.equal(fresh.threadId, "chatgpt:fresh-review");

  const saved = JSON.parse(readFileSync(sessionRegistryPath, "utf8"));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(saved.rooms.main.recentRuns.length, 1);
  assert.equal(saved.freshThreads[0].aliasHint, "critic");
  assert.equal(existsSync(sessionRegistryPath), true);
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "session-lineage" }, null, 2));
