import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = resolve(packageRoot, "bin", "chatgpt-pro");
const alias = process.argv.find((arg) => arg.startsWith("--alias="))?.slice("--alias=".length) || "main";

const result = spawnSync(process.execPath, [bin, "rooms", "repair", `--alias=${alias}`], {
  cwd: packageRoot,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
assert.equal(result.status, 0, result.stderr || result.stdout);
const repaired = JSON.parse(result.stdout);

assert.equal(repaired.ok, true);
assert.equal(repaired.command, "repair");
assert.equal(repaired.result?.operation?.name, "rooms.repair");
assert.equal(repaired.result?.liveBrowser, true);
assert.equal(repaired.result?.locks?.browser?.receipt?.released, true);
assert.equal(repaired.result?.roomTarget?.targetBoundToRoom, true);
assert.equal(repaired.result?.room?.roomTargetVerification, "verified_live");
assert.equal(repaired.result?.room?.lastTargetRepair?.targetUrl, repaired.result?.target?.url);

console.log(JSON.stringify({
  ok: true,
  tested: "live-rooms-repair",
  alias,
  operation: repaired.result.operation.name,
  resolution: repaired.result.roomTarget.resolution,
  repaired: repaired.result.roomTarget.repaired,
  conversationUrl: repaired.result.room.activeConversationUrl,
  lockReleased: repaired.result.locks.browser.receipt.released,
}, null, 2));
