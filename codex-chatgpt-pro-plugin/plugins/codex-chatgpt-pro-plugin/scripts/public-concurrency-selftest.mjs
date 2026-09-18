import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const repo = mkdtempSync(resolve(tmpdir(), "chatgpt-public-concurrency-repo-"));
const home = mkdtempSync(resolve(tmpdir(), "chatgpt-public-concurrency-home-"));
mkdirSync(repo, { recursive: true });

process.env.CHATGPT_REPO_ROOT = repo;
process.env.CHATGPT_PRO_HOME = home;

const { ensureProjectState } = await import(`../src/project-state.mjs?public_concurrency=${Date.now()}`);
const { acquireChatGptOperation } = await import(`../src/chatgpt-operation.mjs?public_concurrency=${Date.now()}`);

function runChatgpt(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: repo,
      CHATGPT_PRO_HOME: home,
      CHATGPT_LOCK_TIMEOUT_MS: "50",
      CHATGPT_THREAD_ECHO: "0",
      CHROME_REMOTE_DEBUGGING_PORT: "9",
    },
  });
}

function runNodeScript(script, args = []) {
  return spawnSync(process.execPath, [resolve(packageRoot, script), ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CHATGPT_REPO_ROOT: repo,
      CHATGPT_PRO_HOME: home,
      CHATGPT_LOCK_TIMEOUT_MS: "50",
      CHATGPT_THREAD_ECHO: "0",
      CHROME_REMOTE_DEBUGGING_PORT: "9",
    },
  });
}

function parseJson(result) {
  const start = result.stdout.indexOf("{");
  if (start >= 0) return JSON.parse(result.stdout.slice(start));
  const receiptPath = result.stdout.match(/ChatGPT call receipt: (.+)/)?.[1]?.trim()
    || result.stdout.match(/Live ChatGPT smoke receipt: (.+)/)?.[1]?.trim();
  assert.ok(receiptPath, result.stdout || result.stderr);
  return JSON.parse(readFileSync(receiptPath, "utf8"));
}

function operationName(parsed) {
  return parsed.failure?.operation?.name
    || parsed.details?.operation?.name
    || parsed.operation?.name
    || null;
}

try {
  const project = ensureProjectState();
  const lock = await acquireChatGptOperation({
    name: "fixture.active-call",
    kind: "live-browser",
    runId: "fixture-active-call",
    project,
    alias: "main",
    requiresBrowser: true,
    noWait: true,
  });

  try {
    for (const args of [
      ["call", "--alias=main", "--no-wait", "--no-repo-context", "--prompt=fixture"],
      ["read", "--alias=main", "--no-wait"],
      ["history", "export", "--alias=main", "--no-wait"],
      ["rooms", "new", "--alias=critic", "--no-wait"],
      ["rooms", "rebind", "--alias=main", "--conversation-url=https://chatgpt.com/c/fixture-main", "--no-wait"],
      ["rooms", "repair", "--alias=main", "--no-wait"],
      ["rooms", "list"],
    ]) {
      const result = runChatgpt(args);
      const parsed = parseJson(result);
      if (args[0] === "rooms" && args[1] === "list") {
        assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.result.registryOnly, true);
      } else {
        assert.notEqual(result.status, 0, `${args.join(" ")} should fail while browser lock is held`);
        assert.equal(parsed.ok, false);
        assert.equal(parsed.errorCode, "lock.busy");
        assert.equal(operationName(parsed), args[0] === "read"
          ? "read"
          : args[0] === "call"
            ? "call"
            : args[0] === "history"
              ? "history.export"
              : `rooms.${args[1]}`);
      }
    }

    const choicesResult = runNodeScript("scripts/chatgpt-choices.mjs", ["--no-wait"]);
    const choicesParsed = parseJson(choicesResult);
    assert.notEqual(choicesResult.status, 0, "choices should use the live-browser operation lane");
    assert.equal(choicesParsed.errorCode, "lock.busy");
    assert.equal(operationName(choicesParsed), "choices.list");
  } finally {
    await lock.release();
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "public-concurrency" }, null, 2));
