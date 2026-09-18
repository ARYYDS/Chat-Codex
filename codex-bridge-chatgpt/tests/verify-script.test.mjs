import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('the portable verifier runs every deterministic package gate', () => {
  const run = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'verify.mjs'), '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.status, 'passed');
  assert.deepEqual(
    receipt.checks.map((check) => check.id),
    [
      'doctor',
      'browser_safety_contract',
      'packet',
      'result',
      'pair',
      'receipt',
      'complete',
      'architecture_asset_en',
      'architecture_asset_zh',
      'readme_en',
      'readme_zh',
    ],
  );
  assert.ok(receipt.checks.every((check) => check.status === 'passed'));
});
