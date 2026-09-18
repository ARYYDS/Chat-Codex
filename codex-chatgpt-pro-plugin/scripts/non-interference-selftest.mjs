import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../src/runtime-config.mjs";

const checkedFiles = [
  "scripts/chatgpt-call.mjs",
  "src/chatgpt-composer.mjs",
  "src/chatgpt-messages.mjs",
  "src/context-envelope.mjs",
  "src/transcript.mjs",
  "src/chatgpt/run-envelope.mjs",
  "src/repo-context-bundle.mjs",
  "src/chatgpt-upload.mjs",
  "src/atomic-json.mjs",
  "src/project-state-lock.mjs",
];

const forbidden = [
  "osascript",
  "AppleScript",
  "robotjs",
  "xdotool",
  "cliclick",
  "nut.js",
  "page.mouse",
  "page.keyboard",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
];

for (const file of checkedFiles) {
  const text = readFileSync(resolve(repoRoot, file), "utf8");
  for (const needle of forbidden) {
    assert.equal(
      text.includes(needle),
      false,
      `${file} must not use ${needle} in the canonical ChatGPT call path`,
    );
  }
}

console.log(JSON.stringify({ ok: true, tested: "non-interference", checkedFiles }, null, 2));
