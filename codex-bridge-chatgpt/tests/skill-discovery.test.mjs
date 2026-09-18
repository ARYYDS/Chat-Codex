import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(repoRoot, 'skills', 'codex-bridge-chatgpt');

test('publishes the Codex bridge skill under its portable package identity', async () => {
  const skill = await readFile(join(skillRoot, 'SKILL.md'), 'utf8');
  const name = skill.match(/^name:\s*([a-z0-9-]+)$/m)?.[1];

  assert.equal(name, 'codex-bridge-chatgpt');

  const interfaceYaml = await readFile(join(skillRoot, 'agents/openai.yaml'), 'utf8');
  assert.match(interfaceYaml, /^\s*display_name:\s*"Codex 桥接 ChatGPT"$/m);
  assert.match(interfaceYaml, /\$codex-bridge-chatgpt/);
});

test('keeps v0.2.0 release metadata aligned', async () => {
  const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(await readFile(join(repoRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const version = (await readFile(join(repoRoot, 'VERSION'), 'utf8')).trim();

  assert.equal(packageJson.version, '0.2.0');
  assert.equal(pluginJson.version, '0.2.0');
  assert.equal(version, '0.2.0');
});
