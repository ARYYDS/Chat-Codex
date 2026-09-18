import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceSkill = join(repoRoot, 'skills', 'codex-bridge-chatgpt');

test('uses Node test discovery without a shell-expanded glob', async () => {
  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.test, 'node --test');
});

test('keeps text artifacts on canonical LF line endings across platforms', async () => {
  const attributes = await readFile(join(repoRoot, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
  assert.match(attributes, /^\*\.png binary$/m);
});

test('a copied skill package passes Doctor without relying on a symlink', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-bridge-chatgpt-'));
  const copiedSkill = join(temporaryRoot, basename(sourceSkill));

  try {
    await cp(sourceSkill, copiedSkill, { recursive: true });
    assert.equal((await lstat(copiedSkill)).isSymbolicLink(), false);

    const run = spawnSync(
      process.execPath,
      [join(copiedSkill, 'scripts', 'doctor.mjs'), '--json', '--skill-root', copiedSkill],
      { encoding: 'utf8' },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout);
    assert.equal(result.status, 'READY');
    assert.equal(result.skill_name, 'codex-bridge-chatgpt');

    const sourceSkillText = await readFile(join(copiedSkill, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(sourceSkillText, /\/Users\/example/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
