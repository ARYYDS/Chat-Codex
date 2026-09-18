'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  estimateTextTokens,
  estimateReasoningTokens,
  generateTokenBill,
  appendTokenLedger,
  EFFORT_RATES,
} = require('../../lib/token_counter');

const {
  runStaggeredDispatch,
  QUESTIONS,
} = require('../../pipeline/dispatch_10_staggered');

test('token_counter: estimateTextTokens calculates accurate token counts across language types', () => {
  assert.equal(estimateTextTokens(''), 0);
  assert.equal(estimateTextTokens(null), 0);
  assert.equal(estimateTextTokens(undefined), 0);

  // Pure English words: "hello world" -> 2 words * 1.30 = 2.6 -> ceil = 3
  const enTokens = estimateTextTokens('hello world');
  assert.equal(enTokens, 3);

  // Pure CJK: 4 chars * 1.35 = 5.4 -> ceil = 6
  const cjkTokens = estimateTextTokens('你好世界');
  assert.equal(cjkTokens, 6);

  // Code symbols: "() {} []" -> 6 symbols * 0.40 = 2.4 -> ceil = 3
  const symTokens = estimateTextTokens('() {} []');
  assert.equal(symTokens, 3);

  // Mixed formula verification:
  // "测试 (Test) 2026!"
  // CJK: 测试 (2) -> 2 * 1.35 = 2.7
  // Words: Test, 2026 (2) -> 2 * 1.30 = 2.6
  // Symbols: (, ), ! (3) -> 3 * 0.40 = 1.2
  // Sum = 2.7 + 2.6 + 1.2 = 6.5 -> ceil = 7
  const mixed = estimateTextTokens('测试 (Test) 2026!');
  assert.equal(mixed, 7);
});

test('token_counter: estimateReasoningTokens accurately maps effort rates', () => {
  assert.equal(EFFORT_RATES.high, 52);
  assert.equal(EFFORT_RATES.medium, 38);
  assert.equal(EFFORT_RATES.low, 22);

  assert.equal(estimateReasoningTokens(10, 'High'), 520);
  assert.equal(estimateReasoningTokens(10, 'medium'), 380);
  assert.equal(estimateReasoningTokens(10, 'LOW'), 220);
  assert.equal(estimateReasoningTokens(0, 'High'), 0);
  assert.equal(estimateReasoningTokens(-5, 'High'), 0);
  // Default fallback to medium
  assert.equal(estimateReasoningTokens(10, 'unknown'), 380);
});

test('token_counter: generateTokenBill produces comprehensive token breakdown & cost', () => {
  const bill = generateTokenBill({
    promptText: 'Hello world',
    responseText: '你好世界',
    thinkSeconds: 10,
    effort: 'High',
    model: 'o3-mini',
    taskId: 1,
  });

  assert.equal(bill.taskId, 1);
  assert.equal(bill.model, 'o3-mini');
  assert.equal(bill.effort, 'High');
  assert.equal(bill.thinkSeconds, 10);
  assert.equal(bill.promptTokens, 3);
  assert.equal(bill.completionTokens, 6);
  assert.equal(bill.reasoningTokens, 520);
  assert.equal(bill.totalTokens, 3 + 6 + 520); // 529
  assert.ok(bill.estimatedCostUSD > 0);
  assert.equal(bill.details.promptLength, 11);
  assert.equal(bill.details.responseLength, 4);
});

test('token_counter: appendTokenLedger writes and appends to ledger file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-test-'));
  const testLedgerPath = path.join(tmpDir, 'runs', 'token_ledger.json');

  const bill1 = generateTokenBill({ promptText: 'Q1', responseText: 'A1', thinkSeconds: 5 });
  appendTokenLedger(bill1, testLedgerPath);

  assert.ok(fs.existsSync(testLedgerPath));
  let data = JSON.parse(fs.readFileSync(testLedgerPath, 'utf8'));
  assert.equal(data.length, 1);
  assert.equal(data[0].totalTokens, bill1.totalTokens);

  const bill2 = generateTokenBill({ promptText: 'Q2', responseText: 'A2', thinkSeconds: 8 });
  appendTokenLedger(bill2, testLedgerPath);

  data = JSON.parse(fs.readFileSync(testLedgerPath, 'utf8'));
  assert.equal(data.length, 2);
  assert.equal(data[1].totalTokens, bill2.totalTokens);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('dispatch_10_staggered: module exports runStaggeredDispatch and QUESTIONS array', () => {
  assert.equal(typeof runStaggeredDispatch, 'function');
  assert.ok(Array.isArray(QUESTIONS));
  assert.equal(QUESTIONS.length, 10);
  assert.equal(QUESTIONS[0].id, 1);
});

test('dispatch_10_staggered: lifecycle progress hook reports QUEUED stages on init', async () => {
  const events = [];
  const testQuestions = [
    { id: 101, title: 'Mock Task 1', prompt: 'Prompt 1' },
    { id: 102, title: 'Mock Task 2', prompt: 'Prompt 2' },
  ];

  // We test the queue initialization and invalid port failure gracefully
  // using an unreachable CDP host so it fails fast without hanging
  const result = await runStaggeredDispatch({
    cdpHost: 'http://127.0.0.1:59999',
    questions: testQuestions,
    staggerIntervalMs: 10,
    maxRounds: 1,
    persistLedger: false,
    outputFile: path.join(os.tmpdir(), 'test_dispatched.json'),
    onProgress: (ev) => events.push(ev),
  });

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);

  const queuedEvents = events.filter(e => e.stage === 'QUEUED');
  assert.equal(queuedEvents.length, 2);
  assert.equal(queuedEvents[0].taskId, 101);
  assert.equal(queuedEvents[1].taskId, 102);

  const dispatchedEvents = events.filter(e => e.stage === 'DISPATCHED');
  assert.ok(dispatchedEvents.length >= 1);
});

test('bin/handoff.js: help displays gui subcommand usage', () => {
  const cli = path.resolve(__dirname, '../../bin/handoff.js');
  const res = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /gui \[--port PORT\] \[--no-open\]/);
});
