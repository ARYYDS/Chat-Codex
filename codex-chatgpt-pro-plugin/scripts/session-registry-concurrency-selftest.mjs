import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../src/atomic-json.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function runWorker(runId, env) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: env.CHATGPT_REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectWorker);
    child.on("close", (status) => {
      if (status === 0) resolveWorker({ runId, stdout, stderr });
      else rejectWorker(new Error(`Worker ${runId} exited ${status}\n${stderr}\n${stdout}`));
    });
  });
}

if (process.env.SESSION_REGISTRY_CONCURRENCY_WORKER === "1") {
  const { recordChatGptAliasUse } = await import(`../src/chatgpt-sessions.mjs?worker=${process.env.RUN_ID}`);
  recordChatGptAliasUse({
    name: "main",
    target: {
      id: "target-1",
      title: "Concurrent Room",
      url: "https://chatgpt.com/c/concurrent-room",
    },
    runId: process.env.RUN_ID,
    receiptPath: `/tmp/${process.env.RUN_ID}/receipt.json`,
    transcriptPath: `/tmp/${process.env.RUN_ID}/transcript.md`,
  });
  process.exit(0);
}

const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-session-concurrency-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-pro-session-concurrency-home-"));
process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const {
  normalizeSessionRegistry,
  sessionRegistryPath,
} = await import(`../src/chatgpt-sessions.mjs?test=${Date.now()}`);
const { ensureProjectState } = await import(`../src/project-state.mjs?test=${Date.now()}`);

try {
  const project = ensureProjectState();
  const registry = normalizeSessionRegistry({
    rooms: {
      main: {
        targetId: "target-1",
        url: "https://chatgpt.com/c/concurrent-room",
        title: "Concurrent Room",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  }, project);
  mkdirSync(dirname(sessionRegistryPath), { recursive: true });
  writeJsonAtomic(sessionRegistryPath, registry);

  const workers = Array.from({ length: 8 }, (_, index) => `run-${index + 1}`);
  await Promise.all(
    workers.map((runId) =>
      runWorker(runId, {
        ...process.env,
        CHATGPT_REPO_ROOT: repo,
        CHATGPT_PRO_HOME: home,
        SESSION_REGISTRY_CONCURRENCY_WORKER: "1",
        RUN_ID: runId,
      }),
    ),
  );

  const saved = JSON.parse(readFileSync(sessionRegistryPath, "utf8"));
  assert.equal(saved.rooms.main.callCount, workers.length);
  assert.deepEqual(
    new Set(saved.rooms.main.recentRuns.map((run) => run.runId)),
    new Set(workers),
  );
  assert.ok(workers.includes(saved.rooms.main.lineage[0].lastRunId));
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "session-registry-concurrency" }, null, 2));
