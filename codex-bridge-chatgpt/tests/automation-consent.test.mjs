import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const consentScript = join(
  repoRoot,
  'skills',
  'codex-bridge-chatgpt',
  'scripts',
  'automation-consent.mjs',
);
const acknowledgement = 'I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1';

function runConsent(command, { stateFile, extraArgs = [], env = {} } = {}) {
  const args = [consentScript, command, '--json'];
  if (stateFile !== undefined) args.push('--state-file', stateFile);
  args.push(...extraArgs);
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    ...run,
    json: run.stdout.trim().length === 0 ? undefined : JSON.parse(run.stdout),
  };
}

async function withTemporaryState(run) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-bridge-consent-'));
  const stateFile = join(temporaryRoot, 'state', 'automation-consent.json');
  try {
    await mkdir(dirname(stateFile), { recursive: true });
    return await run(stateFile, temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test('missing consent fails closed without creating state', async () => {
  await withTemporaryState(async (stateFile) => {
    const result = runConsent('status', { stateFile });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.json.status, 'NEEDS_AUTOMATION_CONSENT');
    assert.equal(result.json.reason, 'missing_state');
    await assert.rejects(access(stateFile));
  });
});

test('enable requires the exact versioned risk acknowledgement', async () => {
  await withTemporaryState(async (stateFile) => {
    const result = runConsent('enable', {
      stateFile,
      extraArgs: ['--acknowledge-risk', 'wrong'],
    });

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(result.json.status, 'ACKNOWLEDGEMENT_REQUIRED');
    await assert.rejects(access(stateFile));
  });
});

test('explicit acknowledgement enables browser automation atomically', async () => {
  await withTemporaryState(async (stateFile) => {
    const enable = runConsent('enable', {
      stateFile,
      extraArgs: ['--acknowledge-risk', acknowledgement],
    });

    assert.equal(enable.status, 0, enable.stderr || enable.stdout);
    assert.equal(enable.json.status, 'READY');
    assert.equal(enable.json.browser_automation_enabled, true);

    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.deepEqual(Object.keys(saved), [
      'schema_version',
      'disclosure_version',
      'browser_automation_enabled',
      'decided_at',
    ]);
    assert.equal(saved.schema_version, 1);
    assert.equal(saved.disclosure_version, 1);
    assert.equal(saved.browser_automation_enabled, true);
    assert.equal(Number.isNaN(Date.parse(saved.decided_at)), false);

    if (process.platform !== 'win32') {
      assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
    }

    const status = runConsent('status', { stateFile });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.equal(status.json.status, 'READY');
  });
});

test('disable persists a fail-closed decision', async () => {
  await withTemporaryState(async (stateFile) => {
    const disable = runConsent('disable', { stateFile });
    assert.equal(disable.status, 0, disable.stderr || disable.stdout);
    assert.equal(disable.json.status, 'AUTOMATION_DISABLED');
    assert.equal(disable.json.browser_automation_enabled, false);

    const status = runConsent('status', { stateFile });
    assert.equal(status.status, 1, status.stderr || status.stdout);
    assert.equal(status.json.status, 'AUTOMATION_DISABLED');
    assert.equal(status.json.reason, 'user_disabled');
  });
});

test('stale disclosure versions require a new decision', async () => {
  await withTemporaryState(async (stateFile) => {
    await writeFile(stateFile, JSON.stringify({
      schema_version: 1,
      disclosure_version: 0,
      browser_automation_enabled: true,
      decided_at: '2026-08-31T00:00:00.000Z',
    }));

    const result = runConsent('status', { stateFile });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.json.status, 'NEEDS_AUTOMATION_CONSENT');
    assert.equal(result.json.reason, 'stale_disclosure');
  });
});

test('malformed consent fails closed without echoing state content', async () => {
  await withTemporaryState(async (stateFile) => {
    const marker = 'private-marker-must-not-leak';
    await writeFile(stateFile, `{not-json:${marker}`);

    const result = runConsent('status', { stateFile });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(result.json.status, 'NEEDS_AUTOMATION_CONSENT');
    assert.equal(result.json.reason, 'invalid_state');
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
  });
});

test('CODEX_HOME resolution stays inside the supplied isolated home', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'codex-bridge-home-'));
  try {
    const stateFile = join(
      temporaryRoot,
      'codex-bridge-chatgpt',
      'automation-consent.json',
    );
    const enable = runConsent('enable', {
      extraArgs: ['--acknowledge-risk', acknowledgement],
      env: { CODEX_HOME: temporaryRoot },
    });

    assert.equal(enable.status, 0, enable.stderr || enable.stdout);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).browser_automation_enabled, true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
