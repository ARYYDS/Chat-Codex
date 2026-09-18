import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const alias = process.argv.find((arg) => arg.startsWith("--alias="))?.slice("--alias=".length) || "main";

function run(args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

const current = run(["rooms", "show", `--alias=${alias}`]);
assert.equal(current.ok, true);
assert.equal(current.result?.found, true);
const conversationUrl = current.result.room.activeConversationUrl;
assert.match(conversationUrl, /^https:\/\/chatgpt\.com\/c\//);

const rebound = run(["rooms", "rebind", `--alias=${alias}`, `--conversation-url=${conversationUrl}`]);
assert.equal(rebound.ok, true);
assert.equal(rebound.command, "rebind");
assert.equal(rebound.result?.operation?.name, "rooms.rebind");
assert.equal(rebound.result?.liveBrowser, true);
assert.equal(rebound.result?.locks?.browser?.receipt?.released, true);
assert.equal(rebound.result?.roomTarget?.targetBoundToRoom, true);
assert.equal(rebound.result?.room?.roomTargetVerification, "verified_live");
assert.equal(rebound.result?.room?.activeConversationUrl, conversationUrl);

console.log(JSON.stringify({
  ok: true,
  tested: "live-rooms-rebind",
  alias,
  operation: rebound.result.operation.name,
  resolution: rebound.result.roomTarget.resolution,
  conversationUrl,
  lockReleased: rebound.result.locks.browser.receipt.released,
}, null, 2));
