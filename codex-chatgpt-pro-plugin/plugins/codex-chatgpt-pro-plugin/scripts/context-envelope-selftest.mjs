import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composeContextEnvelope } from "../src/context-envelope.mjs";

const dir = mkdtempSync(join(tmpdir(), "chatgpt-context-"));
writeFileSync(join(dir, "codex-session-digest.md"), "# Digest\n\n- current state\n");
writeFileSync(join(dir, "repo-context.md"), "# Repo\n\nsrc/index.js\n");
writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ignored: "because repo-context exists" }));
writeFileSync(join(dir, "diff.patch"), "diff --git a/a b/a\n+hello\n");
writeFileSync(join(dir, "test-output.txt"), "x".repeat(64));

const result = composeContextEnvelope({
  prompt: "Review this repo state.",
  contextDir: dir,
  budgets: {
    "test-output.txt": 12,
  },
});

assert.equal(result.context.contextDir, dir);
assert.deepEqual(result.context.sectionOrder, [
  "codex-session-digest.md",
  "repo-context.md",
  "diff.patch",
  "test-output.txt",
]);
assert.equal(result.context.includedFiles.length, 3);
assert.equal(result.context.omittedFiles.length, 1);
assert.equal(result.context.omittedFiles[0].file, "test-output.txt");
assert.equal(result.context.omittedFiles[0].truncated, true);
assert.match(result.prompt, /## Codex Session Digest: `codex-session-digest\.md`/);
assert.match(result.prompt, /## Repo Context: `repo-context\.md`/);
assert.match(result.prompt, /## Current Diff: `diff\.patch`/);
assert.match(result.prompt, /Omitted: test-output\.txt is 64 chars/);
assert.match(result.prompt, /sha256: [a-f0-9]{64}/);
assert.ok(!result.prompt.includes("ignored"));

console.log(JSON.stringify({ ok: true, tested: "context-envelope" }, null, 2));
