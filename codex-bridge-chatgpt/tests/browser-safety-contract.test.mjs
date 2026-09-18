import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(repoRoot, 'skills', 'codex-bridge-chatgpt');

async function readSkillFile(relativePath) {
  return readFile(join(skillRoot, relativePath), 'utf8');
}

test('Skill blocks browser use until explicit versioned risk consent', async () => {
  const skill = await readSkillFile('SKILL.md');
  const doctor = await readSkillFile('references/doctor.md');

  for (const required of [
    'NEEDS_AUTOMATION_CONSENT',
    'AUTOMATION_DISABLED',
    'I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1',
  ]) {
    assert.match(`${skill}\n${doctor}`, new RegExp(required));
  }
  assert.match(skill, /before opening or claiming ChatGPT/i);
  assert.match(doctor, /non-zero account/i);
});

test('Browser Transport permits one visible send and one visible copy only', async () => {
  const transport = await readSkillFile('references/browser-transport.md');

  assert.match(transport, /activate Send exactly once/);
  assert.match(transport, /visible copy-response action/);
  assert.match(transport, /Do not extract response text from the DOM/);
  assert.match(transport, /indeterminate submission/i);
  assert.doesNotMatch(transport, /If the browser clipboard is empty, extract/i);
});

test('Browser safety failures stop without retry or hidden access', async () => {
  const skill = await readSkillFile('SKILL.md');
  const transport = await readSkillFile('references/browser-transport.md');
  const combined = `${skill}\n${transport}`;

  for (const blocker of [
    'login',
    'CAPTCHA',
    'rate-limit',
    'unusual-activity',
    'account restriction',
    'permission',
    'ambiguous-control',
    'selector-drift',
  ]) {
    assert.match(combined, new RegExp(blocker, 'i'));
  }

  assert.match(combined, /private endpoints/i);
  assert.match(combined, /cookies/i);
  assert.match(combined, /local storage/i);
  assert.match(combined, /session storage/i);
  assert.match(combined, /hidden auth/i);
  assert.match(combined, /Do not retry/i);
  assert.doesNotMatch(skill, /omits the result contract twice/i);
});

test('Receipt remains redacted and treats imported output as untrusted', async () => {
  const receipt = await readSkillFile('references/run-receipt.md');

  assert.match(receipt, /must not contain raw Packet or Result content/i);
  assert.match(receipt, /untrusted third-party content/i);
  assert.match(receipt, /cannot authorize/i);
  assert.match(receipt, /SHA-256/i);
});
