#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(repoRoot, 'skills', 'codex-bridge-chatgpt');
const doctor = join(skillRoot, 'scripts', 'doctor.mjs');
const validator = join(skillRoot, 'scripts', 'validate-handoff.mjs');

function runNode(id, args) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    id,
    status: run.status === 0 ? 'passed' : 'failed',
    exit_code: run.status,
    detail: (run.status === 0 ? run.stdout : run.stderr || run.stdout).trim(),
  };
}

async function architectureCheck(id, filename) {
  const path = join(repoRoot, 'assets', filename);
  try {
    const image = await readFile(path);
    const signature = image.subarray(0, 8).toString('hex');
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    const ok = signature === '89504e470d0a1a0a' && width >= 1200 && height >= 700;
    return {
      id,
      status: ok ? 'passed' : 'failed',
      exit_code: ok ? 0 : 1,
      detail: ok ? `PNG ${width}x${height}` : 'architecture PNG is missing or too small',
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      exit_code: 1,
      detail: error.message,
    };
  }
}

async function readmeCheck(id, filename, requiredFragments) {
  try {
    const content = await readFile(join(repoRoot, filename), 'utf8');
    const missing = requiredFragments.filter((fragment) => !content.includes(fragment));
    return {
      id,
      status: missing.length === 0 ? 'passed' : 'failed',
      exit_code: missing.length === 0 ? 0 : 1,
      detail: missing.length === 0 ? `${filename} bilingual contract present` : `missing: ${missing.join(', ')}`,
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      exit_code: 1,
      detail: error.message,
    };
  }
}

const checks = [
  runNode('doctor', [doctor, '--json']),
  runNode('browser_safety_contract', ['--test', 'tests/browser-safety-contract.test.mjs']),
  runNode('packet', [validator, 'packet', 'tests/artifacts/e2e-packet-1k.md']),
  runNode('result', [validator, 'result', 'tests/artifacts/e2e-result-1k-sol.md']),
  runNode('pair', [
    validator,
    'pair',
    'tests/artifacts/e2e-packet-1k.md',
    'tests/artifacts/e2e-result-1k-sol.md',
  ]),
  runNode('receipt', [validator, 'receipt', 'tests/artifacts/e2e-receipt-1k-sol.json']),
  runNode('complete', [validator, 'complete', 'tests/artifacts/e2e-receipt-1k-sol.json']),
  await architectureCheck('architecture_asset_en', 'codex-bridge-chatgpt-architecture.en.png'),
  await architectureCheck('architecture_asset_zh', 'codex-bridge-chatgpt-architecture.png'),
  await readmeCheck('readme_en', 'README.md', [
    '[简体中文](README.zh-CN.md)',
    '## Workflow',
    '## How it works',
    '## Installation',
    '## Quick start',
    'assets/codex-bridge-chatgpt-architecture.en.png',
    'Unofficial Experimental',
    'non-zero account risk',
    'NEEDS_AUTOMATION_CONSENT',
    'AUTOMATION_DISABLED',
  ]),
  await readmeCheck('readme_zh', 'README.zh-CN.md', [
    '[English](README.md)',
    '## 工作流',
    '## 工作原理',
    '## 安装',
    '## 快速上手',
    'assets/codex-bridge-chatgpt-architecture.png',
    'Unofficial Experimental',
    '非零账号风险',
    'NEEDS_AUTOMATION_CONSENT',
    'AUTOMATION_DISABLED',
  ]),
];

const receipt = {
  schema_version: 1,
  status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
  checks,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(receipt, null, 2));
} else {
  for (const check of checks) {
    console.log(`${check.status === 'passed' ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
  }
  console.log(`Verification: ${receipt.status}`);
}

process.exitCode = receipt.status === 'passed' ? 0 : 1;
