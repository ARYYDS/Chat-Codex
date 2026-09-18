#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONSENT_SCHEMA_VERSION = 1;
export const DISCLOSURE_VERSION = 1;
export const RISK_ACKNOWLEDGEMENT = 'I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1';

const currentFile = fileURLToPath(import.meta.url);

export function defaultConsentPath(environment = process.env) {
  const codexHome = environment.CODEX_HOME?.trim() || join(homedir(), '.codex');
  return join(codexHome, 'codex-bridge-chatgpt', 'automation-consent.json');
}

export async function consentStatus(stateFile = defaultConsentPath()) {
  let state;
  try {
    state = JSON.parse(await readFile(resolve(stateFile), 'utf8'));
  } catch (error) {
    return statusResult(error?.code === 'ENOENT' ? 'missing_state' : 'invalid_state');
  }

  if (!validStateShape(state)) return statusResult('invalid_state');
  if (state.disclosure_version !== DISCLOSURE_VERSION) {
    return statusResult('stale_disclosure');
  }
  if (!state.browser_automation_enabled) {
    return statusResult('user_disabled', false, 'AUTOMATION_DISABLED');
  }
  return statusResult(undefined, true, 'READY');
}

export async function writeConsentDecision(
  stateFile,
  browserAutomationEnabled,
  decidedAt = new Date().toISOString(),
) {
  const target = resolve(stateFile);
  const state = {
    schema_version: CONSENT_SCHEMA_VERSION,
    disclosure_version: DISCLOSURE_VERSION,
    browser_automation_enabled: browserAutomationEnabled,
    decided_at: decidedAt,
  };
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }

  return consentStatus(target);
}

function validStateShape(state) {
  return state !== null
    && typeof state === 'object'
    && !Array.isArray(state)
    && state.schema_version === CONSENT_SCHEMA_VERSION
    && Number.isInteger(state.disclosure_version)
    && typeof state.browser_automation_enabled === 'boolean'
    && typeof state.decided_at === 'string'
    && !Number.isNaN(Date.parse(state.decided_at));
}

function statusResult(
  reason,
  browserAutomationEnabled = null,
  status = 'NEEDS_AUTOMATION_CONSENT',
) {
  return {
    schema_version: CONSENT_SCHEMA_VERSION,
    disclosure_version: DISCLOSURE_VERSION,
    status,
    browser_automation_enabled: browserAutomationEnabled,
    reason: reason ?? null,
  };
}

function parseArgs(argv) {
  const command = argv[0];
  if (!['status', 'enable', 'disable'].includes(command)) {
    throw new Error('expected command: status, enable, or disable');
  }

  const options = {
    command,
    json: false,
    stateFile: defaultConsentPath(),
    acknowledgement: undefined,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--state-file' && argv[index + 1]) {
      options.stateFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--acknowledge-risk' && argv[index + 1]) {
      options.acknowledgement = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown or incomplete argument: ${argument}`);
  }
  return options;
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Codex bridge browser automation: ${result.status}`);
  if (result.reason !== null) console.log(`Reason: ${result.reason}`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      'usage: automation-consent.mjs <status|enable|disable> [--json] '
      + '[--state-file <path>] [--acknowledge-risk <token>]\n'
      + error.message,
    );
    process.exitCode = 2;
    return;
  }

  if (options.command === 'enable' && options.acknowledgement !== RISK_ACKNOWLEDGEMENT) {
    const result = {
      ...statusResult('exact_acknowledgement_required'),
      status: 'ACKNOWLEDGEMENT_REQUIRED',
    };
    printResult(result, options.json);
    process.exitCode = 2;
    return;
  }

  const result = options.command === 'status'
    ? await consentStatus(options.stateFile)
    : await writeConsentDecision(options.stateFile, options.command === 'enable');
  printResult(result, options.json);
  process.exitCode = options.command === 'status' && result.status !== 'READY' ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(currentFile)) {
  await main();
}
