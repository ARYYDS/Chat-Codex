import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const publicScripts = [
  "scripts/chatgpt-call.mjs",
  "scripts/chatgpt-doctor.mjs",
  "scripts/chatgpt-read-current.mjs",
  "scripts/chatgpt-history.mjs",
  "scripts/chatgpt-choices.mjs",
  "scripts/chatgpt-rooms.mjs",
  "scripts/live-chatgpt-smoke.mjs",
  "scripts/login-check.mjs",
];

const liveBrowserTokens = [
  "connectToPage",
  "connectToChatGptSession",
  "newChatGptSession",
  "activateChatGptSession",
  "closeChatGptSession",
  "listChatGptSessions",
  "readChatGptChoices",
  "setChatGptChoices",
  "CdpSession",
];

for (const file of publicScripts) {
  const source = readFileSync(resolve(file), "utf8");
  const touchesLiveBrowser = liveBrowserTokens.some((token) => source.includes(token));
  if (touchesLiveBrowser) {
    assert.match(
      source,
      /["']\.\.\/src\/chatgpt-operation\.mjs["']/,
      `${file} touches live browser helpers and must route through chatgpt-operation.mjs`,
    );
    assert.doesNotMatch(
      source,
      /from ["']\.\.\/src\/browser-lock\.mjs["']/,
      `${file} must not import browser-lock.mjs directly`,
    );
  }
}

const coordinator = readFileSync(resolve("src/chatgpt-operation.mjs"), "utf8");
assert.match(coordinator, /from ["']\.\/browser-lock\.mjs["']/, "operation coordinator owns browser-lock import");
assert.match(coordinator, /acquireChatGptOperation/, "operation coordinator exposes operation handle");
assert.match(coordinator, /withChatGptOperation/, "operation coordinator exposes callback wrapper");

console.log(JSON.stringify({
  ok: true,
  tested: "operation-boundary",
  publicScripts,
}, null, 2));
