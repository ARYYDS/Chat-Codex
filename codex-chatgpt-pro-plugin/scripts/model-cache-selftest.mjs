import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  buildModelStateCache,
  modelStateCachePath,
  readModelStateCache,
  writeModelStateCache,
} from "../src/model-state-cache.mjs";

const root = mkdtempSync(resolve(tmpdir(), "chatgpt-model-cache-"));

try {
  const missing = readModelStateCache({ root });
  assert.equal(missing.status, "missing");
  assert.equal(missing.stale, true);

  const observedAt = new Date("2026-06-17T08:00:00.000Z");
  const cache = buildModelStateCache({
    observedAt,
    ttlMs: 1_000,
    cdpEndpoint: "http://127.0.0.1:9222",
    profilePath: "/tmp/profile",
    targetUrl: "https://chatgpt.com/",
    choices: {
      account: { planLabel: "Pro", isPro: true, detected: true },
      intelligence: {
        current: "Pro",
        buttonLabel: "Pro",
        options: [{ label: "Pro", current: true, disabled: false }],
      },
      model: {
        current: "5.5",
        rootLabel: "GPT-5.5",
        options: [{ label: "5.5", current: true, disabled: false }],
      },
    },
  });
  const written = writeModelStateCache(cache, { root });
  assert.equal(written.path, modelStateCachePath(root));

  const fresh = readModelStateCache({ root, nowMs: Date.parse("2026-06-17T08:00:00.500Z") });
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.cache.model.selected, "5.5");
  assert.equal(fresh.stale, false);

  const stale = readModelStateCache({ root, nowMs: Date.parse("2026-06-17T08:00:02.000Z") });
  assert.equal(stale.status, "stale");
  assert.equal(stale.stale, true);

  writeFileSync(modelStateCachePath(root), "{ not json");
  const invalid = readModelStateCache({ root });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.stale, true);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tested: "model-cache" }, null, 2));
