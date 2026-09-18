import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  renderEnvelopeTranscript,
  sealRunEnvelope,
  sha256Text,
  threadEchoMode,
  verifyRunEnvelope,
} from "../src/chatgpt/run-envelope.mjs";

const root = mkdtempSync(resolve(tmpdir(), "chatgpt-run-envelope-"));
const runDir = resolve(root, "call");
try {
  mkdirSync(runDir, { recursive: true });
  const sent = "Please review the architecture.";
  const received = "Use a sealed run envelope.";
  const receipt = {
    loop: "chatgpt-call",
    runDir,
    ok: true,
  };
  writeFileSync(resolve(runDir, "input.md"), sent);
  writeFileSync(resolve(runDir, "prompt.md"), sent);
  writeFileSync(resolve(runDir, "assistant.md"), received);

  const envelope = sealRunEnvelope({
    kind: "call",
    runDir,
    receipt,
    sentMarkdown: sent,
    receivedMarkdown: received,
    stdoutRendered: true,
  });
  const transcript = readFileSync(resolve(runDir, "transcript.md"), "utf8");
  assert.equal(transcript, envelope.transcriptMarkdown);
  assert.equal(transcript, renderEnvelopeTranscript({ kind: "call", sentMarkdown: sent, receivedMarkdown: received }));
  assert.equal(receipt.threadEcho.mode, "enabled");
  assert.equal(receipt.threadEcho.stdoutRendered, true);
  assert.equal(receipt.threadEcho.transcriptSha256, sha256Text(transcript));
  assert.equal(receipt.threadEcho.sentSha256, sha256Text(sent));
  assert.equal(receipt.threadEcho.receivedSha256, sha256Text(received));
  writeFileSync(resolve(runDir, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

  const verified = verifyRunEnvelope({ receiptPath: resolve(runDir, "receipt.json") });
  assert.equal(verified.ok, true);
  assert.equal(verified.threadEcho.transcriptSha256, receipt.threadEcho.transcriptSha256);

  const readDir = resolve(root, "read");
  const readReceipt = {
    loop: "chatgpt-read-current",
    runDir: readDir,
    ok: true,
  };
  mkdirSync(readDir, { recursive: true });
  writeFileSync(resolve(readDir, "assistant.md"), received);
  const readEnvelope = sealRunEnvelope({
    kind: "read",
    runDir: readDir,
    receipt: readReceipt,
    receivedMarkdown: received,
    stdoutRendered: false,
  });
  assert.equal(readEnvelope.threadEcho.mode, "disabled_by_env");
  assert.equal(readEnvelope.transcriptMarkdown.includes("## Message Sent To ChatGPT Pro"), false);
  assert.equal(readEnvelope.transcriptMarkdown.includes("## Message Received From ChatGPT Pro"), true);
  writeFileSync(resolve(readDir, "receipt.json"), `${JSON.stringify(readReceipt, null, 2)}\n`);
  assert.equal(verifyRunEnvelope({ receiptPath: resolve(readDir, "receipt.json") }).ok, true);

  assert.equal(threadEchoMode({ CHATGPT_THREAD_ECHO: "0" }), "disabled_by_env");
  assert.equal(threadEchoMode({ CHATGPT_THREAD_ECHO: "false" }), "disabled_by_env");
  assert.equal(threadEchoMode({}), "enabled");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "run-envelope" }, null, 2));
