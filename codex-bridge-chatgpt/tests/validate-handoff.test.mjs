import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  estimateTokens,
  receiptCompletionErrors,
  sha256Text,
  validatePacket,
  validatePair,
  validateReceipt,
  validateResult,
  verifyReceiptArtifacts,
} from '../skills/codex-bridge-chatgpt/scripts/validate-handoff.mjs';

const fixture = async (name) =>
  readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('accepts a bounded packet with every required section', async () => {
  const errors = validatePacket(await fixture('valid-packet.md'));
  assert.deepEqual(errors, []);
});

test('rejects packets containing likely secrets', async () => {
  const unsafe = (await fixture('packet-with-secret.md')).replace(
    '[INJECTED_BY_TEST]',
    `sk-${'a'.repeat(30)}`,
  );
  const errors = validatePacket(unsafe);
  assert.ok(errors.some((error) => error.includes('secret')));
});

test('rejects packets over the 3000 approximate-token ceiling', async () => {
  const oversized = `${await fixture('valid-packet.md')}\n${'证据'.repeat(12000)}`;
  assert.ok(estimateTokens(oversized) > 3000);
  assert.ok(validatePacket(oversized).some((error) => error.includes('3000')));
});

test('accepts a structured reasoning result', async () => {
  assert.deepEqual(validateResult(await fixture('valid-result.md')), []);
});

test('rejects a reasoning result that omits execution risks', async () => {
  const result = (await fixture('valid-result.md')).replace(
    /## Risks[\s\S]*?(?=\n## Unknowns)/,
    '',
  );
  assert.ok(validateResult(result).some((error) => error.includes('## Risks')));
});

test('rejects a result produced for a different packet', async () => {
  const result = (await fixture('valid-result.md')).replace(
    'packet_id: smoke-2026-08-30',
    'packet_id: another-task',
  );
  const errors = validatePair(await fixture('valid-packet.md'), result);
  assert.ok(errors.some((error) => error.includes('packet_id mismatch')));
});

test('accepts an honest incomplete run receipt without calling it complete', async () => {
  const receipt = JSON.parse(await fixture('valid-receipt-unverified.json'));
  assert.deepEqual(validateReceipt(receipt), []);
  assert.ok(receiptCompletionErrors(receipt).some((error) => error.includes('chatgpt_model')));
});

test('rejects a verified model status without observed model and evidence', async () => {
  const receipt = JSON.parse(await fixture('valid-receipt-unverified.json'));
  receipt.chatgpt_model.status = 'verified';
  receipt.chatgpt_model.observed = null;
  receipt.chatgpt_model.evidence = '';
  const errors = validateReceipt(receipt);
  assert.ok(errors.some((error) => error.includes('chatgpt_model')));
});

test('rejects duplicate or nested contract markers', async () => {
  const packet = (await fixture('valid-packet.md')).replace(
    'BEGIN_CONTEXT_PACKET',
    'BEGIN_CONTEXT_PACKET\nBEGIN_CONTEXT_PACKET',
  );
  assert.ok(validatePacket(packet).some((error) => error.includes('opening marker')));
});

test('rejects duplicate required sections and packet ids', async () => {
  const result = (await fixture('valid-result.md'))
    .replace('## Verdict', '## Verdict\nDuplicate verdict.\n\n## Verdict')
    .replace('packet_id: smoke-2026-08-30', 'packet_id: smoke-2026-08-30\npacket_id: duplicate');
  const errors = validateResult(result);
  assert.ok(errors.some((error) => error.includes('## Verdict')));
  assert.ok(errors.some((error) => error.includes('packet_id')));
});

test('rejects duplicate requested reasoners', async () => {
  const packet = (await fixture('valid-packet.md')).replace(
    'requested_reasoner: GPT-5.6 Sol',
    'requested_reasoner: GPT-5.6 Sol\nrequested_reasoner: GPT-5.5',
  );
  assert.ok(validatePacket(packet).some((error) => error.includes('requested_reasoner')));
});

test('rejects likely secrets in a reasoning result', async () => {
  const result = (await fixture('valid-result.md')).replace(
    '## Unknowns',
    `Leaked credential: sk-${'b'.repeat(30)}\n\n## Unknowns`,
  );
  assert.ok(validateResult(result).some((error) => error.includes('secret')));
});

test('rejects non-empty text outside the contract markers', async () => {
  const result = `Here is the answer.\n${await fixture('valid-result.md')}`;
  assert.ok(validateResult(result).some((error) => error.includes('outside')));
});

test('computes a stable SHA-256 content binding', () => {
  assert.equal(
    sha256Text('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('rejects malformed artifact hashes in a receipt', async () => {
  const receipt = JSON.parse(await fixture('valid-receipt-unverified.json'));
  receipt.artifacts.packet.sha256 = 'not-a-sha256';
  assert.ok(validateReceipt(receipt).some((error) => error.includes('sha256')));
});

test('requires preflight and postflight model evidence for completion', async () => {
  const receipt = JSON.parse(await fixture('valid-receipt-unverified.json'));
  receipt.codex_model.status = 'verified';
  receipt.codex_model.observed = 'gpt-5.6-luna';
  receipt.chatgpt_model.status = 'verified';
  receipt.chatgpt_model.observed = 'GPT-5.6 Sol';
  const errors = receiptCompletionErrors(receipt);
  assert.ok(errors.some((error) => error.includes('preflight')));
  assert.ok(errors.some((error) => error.includes('postflight')));
});

test('requires every privacy review field before completion', async () => {
  const receipt = JSON.parse(await fixture('valid-receipt-unverified.json'));
  receipt.privacy_review.semantic_privacy_reviewed = false;
  assert.ok(
    receiptCompletionErrors(receipt).some((error) => error.includes('semantic_privacy_reviewed')),
  );
});

test('verifies receipt hashes against the actual artifacts', async () => {
  const receipt = JSON.parse(
    await readFile(new URL('./artifacts/e2e-receipt-1k-sol.json', import.meta.url), 'utf8'),
  );
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  assert.deepEqual(await verifyReceiptArtifacts(receipt, repoRoot), []);

  receipt.artifacts.result.sha256 = 'f'.repeat(64);
  assert.ok(
    (await verifyReceiptArtifacts(receipt, repoRoot)).some((error) =>
      error.includes('result sha256 mismatch'),
    ),
  );
});
