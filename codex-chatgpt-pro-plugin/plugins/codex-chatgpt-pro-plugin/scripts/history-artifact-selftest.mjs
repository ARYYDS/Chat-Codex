import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileHistoryArtifact, readHistoryArtifact } from "../src/chatgpt-history-artifact.mjs";
import { shapeConversationMessages } from "../src/chatgpt-messages.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const outDir = mkdtempSync(resolve(tmpdir(), "chatgpt-history-artifact-"));

function runChatgpt(args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

function runChatgptFail(args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0, `${args.join(" ")} should fail`);
  return JSON.parse(result.stdout);
}

try {
  const messages = shapeConversationMessages([
    { role: "user", text: "Please design the plugin architecture." },
    { role: "assistant", text: "Use repo-bound rooms and sealed receipts." },
    { role: "user", text: "Now include upload provenance." },
    { role: "assistant", text: "Stage uploads and record original/staged hashes." },
  ]);
  const compiled = compileHistoryArtifact({
    project: {
      displayName: "fixture-repo",
      projectId: "cgpt_fixture",
    },
    alias: "main",
    target: {
      id: "target-main",
      title: "Fixture Thread",
      url: "https://chatgpt.com/c/fixture-thread",
    },
    roomTarget: {
      targetBoundToRoom: true,
    },
    messages,
    exportedAt: "2026-06-17T08:00:00.000Z",
    last: 0,
    outDir,
  });

  assert.match(compiled.markdown, /# ChatGPT Conversation History/);
  assert.match(compiled.markdown, /Export scope: all visible/);
  assert.match(compiled.markdown, /History claim: all currently loaded visible ChatGPT DOM messages/);
  assert.match(compiled.markdown, /Absolute conversation complete: false/);
  assert.match(compiled.markdown, /Messages exported: 4/);
  assert.match(compiled.markdown, /## Message 0 - user/);
  assert.equal(compiled.markdown.includes("Stage uploads and record original/staged hashes."), true);
  assert.equal(compiled.json.messageCount, 4);
  assert.equal(compiled.json.historyCompleteness.claim, "all_loaded_dom_messages");
  assert.equal(compiled.json.historyCompleteness.loadAllAttempted, false);
  assert.equal(compiled.json.historyCompleteness.absoluteConversationComplete, false);
  assert.equal(compiled.json.historyCompleteness.olderMessagesMayExist, true);
  assert.equal(compiled.json.roleCounts.user, 2);
  assert.equal(compiled.json.roleCounts.assistant, 2);
  assert.equal(compiled.json.firstOrdinal, 0);
  assert.equal(compiled.json.lastOrdinal, 3);
  assert.equal(typeof compiled.json.transcriptSha256, "string");
  assert.equal(compiled.json.transcriptSha256.length, 64);
  assert.equal(typeof compiled.json.markdownSha256, "string");
  assert.equal(compiled.json.markdownSha256.length, 64);

  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, "history.json");
  writeFileSync(jsonPath, `${JSON.stringify(compiled.json, null, 2)}\n`);
  const read = readHistoryArtifact(jsonPath);
  assert.equal(read.ok, true);
  assert.equal(read.alias, "main");
  assert.equal(read.projectId, "cgpt_fixture");
  assert.equal(read.conversationUrl, "https://chatgpt.com/c/fixture-thread");
  assert.equal(read.messageCount, 4);
  assert.equal(read.roleCounts.assistant, 2);
  assert.equal(read.transcriptSha256, compiled.json.transcriptSha256);
  assert.equal(read.markdownSha256, compiled.json.markdownSha256);
  assert.equal(read.messages[3].text, "Stage uploads and record original/staged hashes.");

  const cliRead = runChatgpt(["history", "read", `--path=${jsonPath}`]);
  assert.equal(cliRead.ok, true);
  assert.equal(cliRead.exportScope, "all_visible");
  assert.equal(cliRead.historyCompleteness.claim, "all_loaded_dom_messages");
  assert.equal(cliRead.messageCount, 4);
  assert.equal(cliRead.transcriptSha256, compiled.json.transcriptSha256);
  assert.equal(cliRead.messages[0].text, "Please design the plugin architecture.");

  const largeOutDir = resolve(outDir, "large");
  mkdirSync(largeOutDir, { recursive: true });
  const largeUserText = `Large live-history user context\n${"session-history-line\n".repeat(2600)}`;
  const largeAssistantText = `Large live-history assistant response\n${"architecture-response-line\n".repeat(2600)}`;
  const largeMessages = shapeConversationMessages([
    { role: "user", text: largeUserText },
    { role: "assistant", text: largeAssistantText },
  ]);
  const largeCompiled = compileHistoryArtifact({
    project: {
      displayName: "fixture-repo",
      projectId: "cgpt_fixture",
    },
    alias: "main",
    target: {
      id: "target-large",
      title: "Large Fixture Thread",
      url: "https://chatgpt.com/c/large-fixture-thread",
    },
    roomTarget: {
      targetBoundToRoom: true,
    },
    messages: largeMessages,
    exportedAt: "2026-06-17T08:05:00.000Z",
    last: 0,
    outDir: largeOutDir,
  });
  const largeJsonPath = resolve(largeOutDir, "history.json");
  writeFileSync(largeJsonPath, `${JSON.stringify(largeCompiled.json, null, 2)}\n`);
  const largeCliRead = runChatgpt(["history", "read", `--path=${largeJsonPath}`]);
  assert.equal(largeCliRead.ok, true);
  assert.equal(largeCliRead.messageCount, 2);
  assert.equal(largeCliRead.messages[0].text, largeUserText.trim());
  assert.equal(largeCliRead.messages[1].text, largeAssistantText.trim());
  assert.equal(largeCliRead.transcriptSha256, largeCompiled.json.transcriptSha256);

  const loadAll = runChatgptFail(["history", "export", "--load-all", "--alias=main"]);
  assert.equal(loadAll.ok, false);
  assert.equal(loadAll.errorCode, "mode.unsupported");
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tested: "history-artifact",
  cli: "chatgpt-pro history read",
  exportScope: "all_visible",
}, null, 2));
