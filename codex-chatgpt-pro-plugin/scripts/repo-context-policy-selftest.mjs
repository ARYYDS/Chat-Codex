import assert from "node:assert/strict";
import { decideRepoContextMode } from "../src/repo-context-policy.mjs";

const trivial = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "Confirm the line is ready.",
});
assert.equal(trivial.effectiveMode, "off");
assert.equal(trivial.attached, false);
assert.equal(trivial.reason, "auto_no_repo_context_signal");

const architecture = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "Review the repo architecture and propose a multi-agent packaging plan.",
});
assert.equal(architecture.effectiveMode, "upload");
assert.equal(architecture.attached, true);
assert.equal(architecture.reason, "auto_keyword_match");
assert.ok(architecture.matchedKeywords.includes("repo_architecture"));

const commonReview = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "Review this one function and test the upload line.",
});
assert.equal(commonReview.effectiveMode, "off");
assert.equal(commonReview.attached, false);

const substring = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "This contest plan is unrelated to source upload.",
});
assert.equal(substring.effectiveMode, "off");

const longPrompt = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "x".repeat(1300),
});
assert.equal(longPrompt.effectiveMode, "off");

const withContextDir = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "Review the architecture.",
  contextDir: ".devspace/context/current",
});
assert.equal(withContextDir.effectiveMode, "off");
assert.equal(withContextDir.reason, "context_dir_supplied");

const withUpload = decideRepoContextMode({
  requestedMode: "auto",
  prompt: "Review the plugin architecture.",
  uploadFileCount: 1,
});
assert.equal(withUpload.effectiveMode, "off");
assert.equal(withUpload.reason, "upload_files_supplied");

const explicitUpload = decideRepoContextMode({
  requestedMode: "upload",
  prompt: "Confirm the line is ready.",
});
assert.equal(explicitUpload.effectiveMode, "upload");
assert.equal(explicitUpload.reason, "explicit");

assert.throws(
  () => decideRepoContextMode({ requestedMode: "mystery", prompt: "x" }),
  /Unsupported repo context mode/,
);

console.log(JSON.stringify({ ok: true, tested: "repo-context-policy" }, null, 2));
