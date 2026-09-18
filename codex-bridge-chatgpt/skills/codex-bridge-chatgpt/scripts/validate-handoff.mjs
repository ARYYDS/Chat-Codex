#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKET_SECTIONS = [
  '## Objective',
  '## Acceptance',
  '## Repository State',
  '## Evidence',
  '## Constraints',
  '## Questions',
];

const RESULT_SECTIONS = [
  '## Verdict',
  '## Assumptions',
  '## Evidence Used',
  '## Proposed Changes',
  '## Tests',
  '## Risks',
  '## Unknowns',
];

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*(?!\[REDACTED\])\S+/i,
];

const MODEL_STATUSES = new Set(['verified', 'unverified']);
const CHECK_STATUSES = new Set(['passed', 'failed', 'not_run']);
const LOCAL_CHANGE_STATUSES = new Set(['applied', 'no_changes_needed', 'failed', 'not_run']);
const PRIVACY_FIELDS = [
  'scope_minimized',
  'credentials_scan_passed',
  'semantic_privacy_reviewed',
  'raw_diff_excluded',
  'unrelated_files_excluded',
];

export function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const nonCjk = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '');
  return cjk + Math.ceil(nonCjk.length / 4);
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, '\n');
}

function exactLineCount(lines, value) {
  return lines.filter((line) => line.trim() === value).length;
}

function validateContract(text, { start, end, sections }) {
  const errors = [];
  const normalized = normalizeText(text);
  const lines = normalized.trim().split('\n');
  const openingCount = exactLineCount(lines, start);
  const closingCount = exactLineCount(lines, end);
  if (openingCount !== 1) errors.push(`opening marker must appear exactly once: ${start}`);
  if (closingCount !== 1) errors.push(`closing marker must appear exactly once: ${end}`);
  if (lines[0]?.trim() !== start || lines.at(-1)?.trim() !== end) {
    errors.push('non-empty text exists outside the contract markers');
  }

  const packetIdCount = lines.filter((line) => /^packet_id:\s*\S+\s*$/.test(line)).length;
  if (packetIdCount !== 1) errors.push('packet_id must appear exactly once');

  let previous = -1;
  for (const section of sections) {
    const count = exactLineCount(lines, section);
    const index = lines.findIndex((line) => line.trim() === section);
    if (count === 0) errors.push(`missing required section: ${section}`);
    else if (count > 1) errors.push(`required section must appear exactly once: ${section}`);
    else if (index < previous) errors.push(`section out of order: ${section}`);
    previous = Math.max(previous, index);
  }
  return errors;
}

export function validatePacket(text) {
  const errors = validateContract(text, {
    start: 'BEGIN_CONTEXT_PACKET',
    end: 'END_CONTEXT_PACKET',
    sections: PACKET_SECTIONS,
  });
  const reasonerCount = normalizeText(text)
    .split('\n')
    .filter((line) => /^requested_reasoner:\s*\S.+$/.test(line)).length;
  if (reasonerCount !== 1) errors.push('requested_reasoner must appear exactly once');
  const tokens = estimateTokens(text);
  if (tokens > 3000) errors.push(`packet exceeds 3000 approximate tokens: ${tokens}`);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push('packet contains a likely secret; redact it before browser transmission');
  }
  return errors;
}

export function validateResult(text) {
  const errors = validateContract(text, {
    start: 'BEGIN_REASONING_RESULT',
    end: 'END_REASONING_RESULT',
    sections: RESULT_SECTIONS,
  });
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push('result contains a likely secret; do not persist or execute it');
  }
  return errors;
}

function packetId(text) {
  return text.match(/^packet_id:\s*(\S+)/m)?.[1];
}

export function validatePair(packet, result) {
  const errors = [
    ...validatePacket(packet).map((error) => `packet: ${error}`),
    ...validateResult(result).map((error) => `result: ${error}`),
  ];
  const sentId = packetId(packet);
  const returnedId = packetId(result);
  if (sentId && returnedId && sentId !== returnedId) {
    errors.push(`packet_id mismatch: sent ${sentId}, returned ${returnedId}`);
  }
  return errors;
}

function validateModelRecord(receipt, field, errors) {
  const model = receipt[field];
  if (!model || typeof model !== 'object') {
    errors.push(`missing model record: ${field}`);
    return;
  }
  if (typeof model.requested !== 'string' || !model.requested.trim()) {
    errors.push(`${field}.requested must be a non-empty string`);
  }
  if (!MODEL_STATUSES.has(model.status)) {
    errors.push(`${field}.status must be verified or unverified`);
  }
  if (typeof model.evidence !== 'string' || !model.evidence.trim()) {
    errors.push(`${field}.evidence must be a non-empty local evidence note`);
  }
  if (model.status === 'verified' && (typeof model.observed !== 'string' || !model.observed.trim())) {
    errors.push(`${field}.observed is required when status is verified`);
  }
  if (field === 'chatgpt_model') {
    for (const evidenceField of ['preflight_visible', 'postflight_visible']) {
      if (typeof model[evidenceField] !== 'boolean') {
        errors.push(`${field}.${evidenceField} must be boolean`);
      }
    }
  }
}

function validateArtifact(receipt, field, errors) {
  const artifact = receipt.artifacts?.[field];
  if (!artifact || typeof artifact !== 'object') {
    errors.push(`missing artifact record: ${field}`);
    return;
  }
  if (typeof artifact.path !== 'string' || !artifact.path.trim()) {
    errors.push(`artifacts.${field}.path must be a non-empty string`);
  }
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    errors.push(`artifacts.${field}.sha256 must be 64 lowercase hex characters`);
  }
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['receipt must be a JSON object'];
  }
  if (receipt.schema_version !== 2) errors.push('schema_version must be 2');
  if (typeof receipt.packet_id !== 'string' || !receipt.packet_id.trim()) {
    errors.push('missing packet_id');
  }
  validateModelRecord(receipt, 'codex_model', errors);
  validateModelRecord(receipt, 'chatgpt_model', errors);
  for (const field of ['packet', 'result', 'browser_evidence']) {
    validateArtifact(receipt, field, errors);
  }
  if (!Number.isInteger(receipt.artifacts?.packet?.approximate_tokens) || receipt.artifacts.packet.approximate_tokens < 1) {
    errors.push('artifacts.packet.approximate_tokens must be a positive integer');
  }
  if (!receipt.privacy_review || typeof receipt.privacy_review !== 'object') {
    errors.push('missing privacy_review');
  } else {
    for (const field of PRIVACY_FIELDS) {
      if (typeof receipt.privacy_review[field] !== 'boolean') {
        errors.push(`privacy_review.${field} must be boolean`);
      }
    }
  }
  if (!new Set(['verified', 'failed']).has(receipt.browser_transport)) {
    errors.push('browser_transport must be verified or failed');
  }
  for (const field of [
    'packet_validation',
    'result_validation',
    'pair_validation',
    'local_revalidation',
    'tests',
  ]) {
    if (!CHECK_STATUSES.has(receipt[field])) {
      errors.push(`${field} must be passed, failed, or not_run`);
    }
  }
  if (!receipt.adoption || typeof receipt.adoption !== 'object') {
    errors.push('missing adoption record');
  } else {
    if (!CHECK_STATUSES.has(receipt.adoption.status)) {
      errors.push('adoption.status must be passed, failed, or not_run');
    }
    for (const field of ['accepted', 'rejected', 'deferred', 'local_evidence']) {
      if (!Array.isArray(receipt.adoption[field])) errors.push(`adoption.${field} must be an array`);
    }
  }
  if (!receipt.local_changes || typeof receipt.local_changes !== 'object') {
    errors.push('missing local_changes record');
  } else {
    if (!LOCAL_CHANGE_STATUSES.has(receipt.local_changes.status)) {
      errors.push('local_changes.status is invalid');
    }
    if (typeof receipt.local_changes.reason !== 'string' || !receipt.local_changes.reason.trim()) {
      errors.push('local_changes.reason must be non-empty');
    }
  }
  return errors;
}

export function receiptCompletionErrors(receipt) {
  const errors = validateReceipt(receipt);
  if (errors.length) return errors;
  if (receipt.codex_model.status !== 'verified') errors.push('codex_model is not verified');
  if (receipt.chatgpt_model.status !== 'verified') errors.push('chatgpt_model is not verified');
  if (!receipt.chatgpt_model.preflight_visible) errors.push('chatgpt_model preflight evidence is not verified');
  if (!receipt.chatgpt_model.postflight_visible) errors.push('chatgpt_model postflight evidence is not verified');
  if (receipt.browser_transport !== 'verified') errors.push('browser transport is not verified');
  for (const field of PRIVACY_FIELDS) {
    if (!receipt.privacy_review[field]) errors.push(`privacy_review.${field} is not passed`);
  }
  for (const field of [
    'packet_validation',
    'result_validation',
    'pair_validation',
    'local_revalidation',
    'tests',
  ]) {
    if (receipt[field] !== 'passed') errors.push(`${field} is not passed`);
  }
  if (receipt.adoption.status !== 'passed') errors.push('adoption is not passed');
  if (!['applied', 'no_changes_needed'].includes(receipt.local_changes.status)) {
    errors.push('local_changes is not complete');
  }
  return errors;
}

export async function verifyReceiptArtifacts(receipt, baseDirectory) {
  const errors = [];
  for (const field of ['packet', 'result', 'browser_evidence']) {
    const artifact = receipt.artifacts?.[field];
    if (!artifact?.path || !artifact?.sha256) continue;
    try {
      const content = await readFile(resolve(baseDirectory, artifact.path), 'utf8');
      const actual = sha256Text(content);
      if (actual !== artifact.sha256) {
        errors.push(`${field} sha256 mismatch: expected ${artifact.sha256}, actual ${actual}`);
      }
    } catch (error) {
      errors.push(`${field} artifact cannot be read: ${error.message}`);
    }
  }
  return errors;
}

async function main() {
  const [mode, firstPath, secondPath] = process.argv.slice(2);
  if (!['packet', 'result', 'pair', 'receipt', 'complete', 'hash'].includes(mode) || !firstPath || (mode === 'pair' && !secondPath)) {
    console.error('usage: validate-handoff.mjs <packet|result> <markdown-file>');
    console.error('   or: validate-handoff.mjs pair <packet-file> <result-file>');
    console.error('   or: validate-handoff.mjs <receipt|complete> <receipt-json>');
    console.error('   or: validate-handoff.mjs hash <artifact-file>');
    process.exitCode = 2;
    return;
  }

  const text = await readFile(firstPath, 'utf8');
  if (mode === 'hash') {
    console.log(`${sha256Text(text)}  ${firstPath}`);
    return;
  }
  const result = mode === 'pair' ? await readFile(secondPath, 'utf8') : undefined;
  const parsedReceipt = ['receipt', 'complete'].includes(mode) ? JSON.parse(text) : undefined;
  const errors = mode === 'packet'
    ? validatePacket(text)
    : mode === 'result'
      ? validateResult(text)
      : mode === 'pair'
        ? validatePair(text, result)
        : mode === 'receipt'
          ? validateReceipt(parsedReceipt)
          : receiptCompletionErrors(parsedReceipt);
  if (mode === 'complete') {
    errors.push(...await verifyReceiptArtifacts(parsedReceipt, process.cwd()));
  }
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  const suffix = mode === 'packet'
    ? ` (~${estimateTokens(text)} tokens)`
    : mode === 'receipt' && receiptCompletionErrors(parsedReceipt).length
      ? ' (incomplete)'
      : '';
  console.log(`OK: valid ${mode}${suffix}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
