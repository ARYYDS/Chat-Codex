import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectToChatGptSession } from "../src/chatgpt-sessions.mjs";
import { snapshotConversationMessages } from "../src/chatgpt-messages.mjs";
import { compileHistoryArtifact, readHistoryArtifact } from "../src/chatgpt-history-artifact.mjs";
import { withChatGptOperation } from "../src/chatgpt-operation.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import { DEFAULT_CDP_PORT, devspaceRoot, runId as makeRunId } from "../src/runtime-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const command = process.argv[2] || "export";
const alias = arg("alias") || arg("session") || process.env.CHATGPT_SESSION || "main";
const conversationUrl = arg("conversation-url") || "";
const last = Number(arg("last") || process.env.CHATGPT_HISTORY_LAST || 0);
const requireVisibleMin = Number(arg("require-visible-min") || process.env.CHATGPT_HISTORY_REQUIRE_VISIBLE_MIN || 0);
const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const project = ensureProjectState();
const id = `${makeRunId()}-chatgpt-history-${alias}`;
const outDir = resolve(arg("out-dir") || resolve(devspaceRoot, "chatgpt-history", alias, id));
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);

let cdp = null;

async function printJson(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!process.stdout.write(text)) {
    await new Promise((resolve) => process.stdout.once("drain", resolve));
  }
}

try {
  if (command === "read") {
    const path = arg("path") || arg("history-json") || resolve(outDir, "history.json");
    await printJson(readHistoryArtifact(path));
    process.exit(0);
  }
  if (command !== "export") throw new Error(`Unknown history command: ${command}`);
  if (flag("load-all")) {
    const error = new Error(
      "history export --load-all is not implemented in v1. Use all-visible export, --last=N, or manually scroll/load the ChatGPT thread before exporting.",
    );
    error.errorCode = "mode.unsupported";
    throw error;
  }
  mkdirSync(outDir, { recursive: true });
  const operationResult = await withChatGptOperation({
    name: "history.export",
    runId: id,
    project,
    alias,
    requiresBrowser: true,
    lockTimeoutMs,
    noWait: flag("no-wait"),
    staleLockTtlMs,
  }, async () => {
    const connected = await connectToChatGptSession(port, alias, {
      allowRebind: flag("rebind-alias"),
      conversationUrl,
    });
    cdp = connected.cdp;
    try {
      const allMessages = await snapshotConversationMessages(cdp);
      if (requireVisibleMin > 0 && allMessages.length < requireVisibleMin) {
        const error = new Error(
          `Only ${allMessages.length} visible ChatGPT messages were loaded; required at least ${requireVisibleMin}.`,
        );
        error.errorCode = "history.visible_message_count_too_low";
        error.details = {
          visibleMessageCount: allMessages.length,
          requireVisibleMin,
        };
        throw error;
      }
      const messages = last > 0 ? allMessages.slice(-last) : allMessages;
      const exportedAt = new Date().toISOString();
      const target = {
        id: connected.target.id,
        title: connected.target.title,
        url: connected.target.url,
      };
      const compiled = compileHistoryArtifact({
        project,
        alias,
        target,
        roomTarget: connected.roomTarget,
        messages,
        exportedAt,
        last,
        outDir,
      });
      return {
        compiled,
        allMessages,
      };
    } finally {
      await cdp.close().catch(() => {});
      cdp = null;
    }
  });
  const { compiled, allMessages } = operationResult.value;
  const json = {
    ...compiled.json,
    command,
    operation: operationResult.operation,
    locks: operationResult.locks,
    totalVisibleMessageCount: allMessages.length,
    artifacts: {
      markdown: resolve(outDir, "chatgpt-history.md"),
      json: resolve(outDir, "history.json"),
    },
  };
  writeFileSync(json.artifacts.markdown, compiled.markdown);
  writeFileSync(json.artifacts.json, `${JSON.stringify(json, null, 2)}\n`);
  console.log(JSON.stringify(json, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    command,
    errorCode: error?.errorCode || "history.export_failed",
    ...(error?.details ? { details: error.details } : {}),
    error: String(error?.message || error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (cdp) await cdp.close().catch(() => {});
}
