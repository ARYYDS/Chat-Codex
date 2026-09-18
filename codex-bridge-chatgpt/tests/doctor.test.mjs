import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceSkill = join(repoRoot, 'skills', 'codex-bridge-chatgpt');
const doctor = join(sourceSkill, 'scripts', 'doctor.mjs');

function runDoctor(skillRoot) {
  return spawnSync(process.execPath, [doctor, '--json', '--skill-root', skillRoot], {
    encoding: 'utf8',
  });
}

test('Doctor reports READY for a complete installation', () => {
  const run = runDoctor(sourceSkill);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).status, 'READY');
});

test('Doctor reports INVALID_INSTALLATION when a required contract is missing', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-bridge-doctor-'));
  const copiedSkill = join(temporaryRoot, 'codex-bridge-chatgpt');

  try {
    await cp(sourceSkill, copiedSkill, { recursive: true });
    await rm(join(copiedSkill, 'references', 'context-packet.md'));

    const run = runDoctor(copiedSkill);
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, 'INVALID_INSTALLATION');
    assert.ok(result.checks.some((check) => check.id === 'context_packet' && !check.ok));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('Doctor reports INVALID_INSTALLATION when automation consent helper is missing', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-bridge-doctor-'));
  const copiedSkill = join(temporaryRoot, 'codex-bridge-chatgpt');

  try {
    await cp(sourceSkill, copiedSkill, { recursive: true });
    await rm(join(copiedSkill, 'scripts', 'automation-consent.mjs'));

    const run = runDoctor(copiedSkill);
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, 'INVALID_INSTALLATION');
    assert.ok(result.checks.some((check) => check.id === 'automation_consent' && !check.ok));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
