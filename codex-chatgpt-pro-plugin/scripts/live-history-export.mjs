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

const exported = run(["history", "export", `--alias=${alias}`, "--require-visible-min=1"]);
assert.equal(exported.ok, true);
assert.equal(exported.exportScope, "all_visible");
assert.equal(exported.roomTarget?.targetBoundToRoom, true);
assert.equal(exported.locks?.browser?.receipt?.released, true);
assert.ok(exported.messageCount > 0, "live history export should include visible messages");
assert.ok((exported.roleCounts?.user || 0) > 0, "live history export should include user messages");
assert.ok((exported.roleCounts?.assistant || 0) > 0, "live history export should include assistant messages");
assert.equal(exported.historyCompleteness?.claim, "all_loaded_dom_messages");

const readback = run(["history", "read", `--path=${exported.artifacts.json}`]);
assert.equal(readback.ok, true);
assert.equal(readback.messageCount, exported.messageCount);
assert.equal(readback.transcriptSha256, exported.transcriptSha256);
assert.equal(readback.historyCompleteness?.claim, "all_loaded_dom_messages");

console.log(JSON.stringify({
  ok: true,
  tested: "live-history-export",
  alias,
  artifact: exported.artifacts.json,
  markdown: exported.artifacts.markdown,
  messageCount: exported.messageCount,
  roleCounts: exported.roleCounts,
  exportScope: exported.exportScope,
  historyCompleteness: exported.historyCompleteness,
  targetBoundToRoom: exported.roomTarget.targetBoundToRoom,
  lockReleased: exported.locks.browser.receipt.released,
}, null, 2));
