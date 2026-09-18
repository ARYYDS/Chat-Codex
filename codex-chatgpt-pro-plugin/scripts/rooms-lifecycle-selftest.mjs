import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-rooms-lifecycle-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-rooms-lifecycle-home-"));

function run(args, { expectOk = true } = {}) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_PRO_HOME: home,
      CHROME_REMOTE_DEBUGGING_PORT: "9",
    },
  });
  if (expectOk) {
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  } else {
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail`);
  }
  return JSON.parse(result.stdout);
}

try {
  mkdirSync(repo, { recursive: true });
  spawnSync("git", ["init"], { cwd: repo, encoding: "utf8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Codex",
      GIT_AUTHOR_EMAIL: "codex@example.invalid",
      GIT_COMMITTER_NAME: "Codex",
      GIT_COMMITTER_EMAIL: "codex@example.invalid",
    },
  });

  const init = run(["init"]);
  assert.equal(init.ok, true);

  const first = run([
    "rooms",
    "rebind",
    "--alias=spec",
    "--conversation-url=https://chatgpt.com/c/spec-thread-v1",
    "--registry-only",
  ]);
  assert.equal(first.ok, true);
  assert.equal(first.result.registryOnly, true);
  assert.equal(first.result.liveVerified, false);
  assert.equal(first.result.room.activeConversationUrl, "https://chatgpt.com/c/spec-thread-v1");
  assert.equal(first.result.room.roomTargetVerification, "not_verified_registry_only");
  assert.equal(first.result.room.lineage.length, 1);
  assert.equal(first.result.room.lineage[0].status, "active");

  const second = run([
    "rooms",
    "rebind",
    "--alias=spec",
    "--conversation-url=https://chatgpt.com/c/spec-thread-v2",
    "--registry-only",
  ]);
  assert.equal(second.result.room.activeConversationUrl, "https://chatgpt.com/c/spec-thread-v2");
  assert.deepEqual(second.result.room.lineage.map((entry) => entry.status), ["archived", "active"]);
  assert.equal(second.result.room.lineage[0].conversationUrl, "https://chatgpt.com/c/spec-thread-v1");
  assert.equal(second.result.room.lineage[1].conversationUrl, "https://chatgpt.com/c/spec-thread-v2");

  const show = run(["rooms", "show", "--alias=spec"]);
  assert.equal(show.result.found, true);
  assert.equal(show.result.registryOnly, true);
  assert.equal(show.result.room.activeThreadId, "chatgpt:spec-thread-v2");
  assert.equal(show.result.room.roomTargetVerification, "not_verified_registry_only");

  const invalid = run([
    "rooms",
    "rebind",
    "--alias=bad",
    "--conversation-url=https://example.com/not-chatgpt",
    "--registry-only",
  ], { expectOk: false });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "room.conversation_url_invalid");
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "rooms-lifecycle" }, null, 2));
