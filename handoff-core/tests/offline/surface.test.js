'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  EFFORT_GEARS,
  setModelAndEffort,
  checkTurnConvergence,
  downloadWorkOutputs,
  classifyDivergence,
  forceStopAndSteer,
  STOP_BUTTON_SELECTORS,
  SEND_BUTTON_SELECTORS
} = require('../../lib/surface_manager');

test('surface_manager: EFFORT_GEARS correctly configures chat and work modes', () => {
  // Chat mode has 5 gears (0 to 4)
  assert.equal(EFFORT_GEARS.chat.labels.length, 5);
  assert.deepEqual(EFFORT_GEARS.chat.labels, ['Instant', 'Medium', 'High', 'Extra High', 'Pro']);
  assert.equal(EFFORT_GEARS.chat.aliases['instant'], 0);
  assert.equal(EFFORT_GEARS.chat.aliases['low'], 0);
  assert.equal(EFFORT_GEARS.chat.aliases['medium'], 1);
  assert.equal(EFFORT_GEARS.chat.aliases['high'], 2);
  assert.equal(EFFORT_GEARS.chat.aliases['extra_high'], 3);
  assert.equal(EFFORT_GEARS.chat.aliases['pro'], 4);

  // Work mode has 6 gears (0 to 5)
  assert.equal(EFFORT_GEARS.work.labels.length, 6);
  assert.deepEqual(EFFORT_GEARS.work.labels, ['Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra']);
  assert.equal(EFFORT_GEARS.work.aliases['light'], 0);
  assert.equal(EFFORT_GEARS.work.aliases['low'], 0);
  assert.equal(EFFORT_GEARS.work.aliases['medium'], 1);
  assert.equal(EFFORT_GEARS.work.aliases['high'], 2);
  assert.equal(EFFORT_GEARS.work.aliases['extra_high'], 3);
  assert.equal(EFFORT_GEARS.work.aliases['max'], 4);
  assert.equal(EFFORT_GEARS.work.aliases['ultra'], 5);
  assert.equal(EFFORT_GEARS.work.aliases['pro'], 5);
});

test('surface_manager: STOP_BUTTON_SELECTORS covers Work and Chat stop buttons', () => {
  assert.ok(STOP_BUTTON_SELECTORS.includes('aria-label="Stop answering"'), 'Must include Work mode Stop answering button');
  assert.ok(STOP_BUTTON_SELECTORS.includes('aria-label="Stop thinking"'), 'Must include Stop thinking button');
  assert.ok(STOP_BUTTON_SELECTORS.includes('data-testid="stop-button"'), 'Must include standard stop button');
  assert.ok(STOP_BUTTON_SELECTORS.includes('aria-label="Stop generating"'));
  assert.ok(SEND_BUTTON_SELECTORS.includes('data-testid="send-button"'));
});

test('surface_manager: checkTurnConvergence prevents premature read when Work mode stop button is present', async () => {
  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtns')) {
        // Simulating Work mode while generating: Stop answering button is active
        return Promise.resolve({
          hasStopButton: true,
          stopButtons: [{ ariaLabel: 'Stop answering', testid: null, innerText: '' }],
          sendReady: false,
          hasActiveSpinner: false,
          activeBadges: [],
          hasOutputs: false,
          outputsReady: true,
          textLength: 500, // Even if length > 300!
          currentUrl: 'https://chatgpt.com/c/test-work-conv-123'
        });
      }
      if (expr.includes('/backend-api/conversation/')) {
        return Promise.resolve({
          ok: true,
          title: 'Work Mode Task',
          currentNodeId: 'node-1',
          status: 'in_progress', // Backend turn still in progress!
          endTurn: false,
          latestMsgId: 'msg-1',
          textLength: 500,
          fullText: 'Work mode introductory analysis...'
        });
      }
      return Promise.resolve(null);
    }
  };

  const res = await checkTurnConvergence(mockClient, { convId: 'test-work-conv-123' });
  // Must NOT settle prematurely!
  assert.equal(res.isGenerating, true, 'isGenerating must be true when stop button is active');
  assert.equal(res.isSettled, false, 'isSettled must be false when generating');
  assert.equal(res.backendCompleted, false);
  assert.equal(res.hasStopButton, true);
});

test('surface_manager: checkTurnConvergence confirms true quiescence when Quad-Lock conditions are satisfied', async () => {
  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtns')) {
        // Generation finished: no stop button, send button restored, outputs ready
        return Promise.resolve({
          hasStopButton: false,
          stopButtons: [],
          sendReady: true,
          hasActiveSpinner: false,
          activeBadges: [],
          hasOutputs: true,
          outputsReady: true,
          textLength: 12500,
          currentUrl: 'https://chatgpt.com/c/test-work-conv-123'
        });
      }
      if (expr.includes('/backend-api/conversation/')) {
        return Promise.resolve({
          ok: true,
          title: 'Work Mode Task Full Analysis',
          currentNodeId: 'node-final',
          status: 'finished_successfully',
          endTurn: true,
          latestMsgId: 'msg-final',
          textLength: 12500,
          fullText: '# Complete Technical Report\n\nFull architecture deep dive.'
        });
      }
      return Promise.resolve(null);
    }
  };

  const res = await checkTurnConvergence(mockClient, { convId: 'test-work-conv-123' });
  assert.equal(res.isGenerating, false, 'isGenerating must be false when turn finished');
  assert.equal(res.isSettled, true, 'isSettled must be true when all 4 locks pass');
  assert.equal(res.backendCompleted, true);
  assert.equal(res.hasOutputs, true);
  assert.equal(res.outputsReady, true);
  assert.equal(res.officialTitle, 'Work Mode Task Full Analysis');
});

test('surface_manager: downloadWorkOutputs triggers click and saves file with manifest', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-output-test-'));
  const dummyFile = path.join(tmpDir, 'Architecture-Review.md');
  const dummyContent = '# System Architecture Review\n\nGenerated by GPT-6 Astra.';
  
  const mockClient = {
    send(method, params) {
      return Promise.resolve({});
    },
    eval(expr) {
      if (expr.includes('Download file') || expr.includes('dlBtn')) {
        // Simulate click and file appearing
        fs.writeFileSync(dummyFile, dummyContent, 'utf-8');
        return Promise.resolve({ success: true, label: 'Download file' });
      }
      return Promise.resolve({});
    }
  };

  const res = await downloadWorkOutputs(mockClient, tmpDir, { timeoutMs: 3000 });
  assert.equal(res.success, true);
  assert.equal(res.filename, 'Architecture-Review.md');
  assert.ok(res.bytes > 0);
  assert.ok(res.sha256.length === 64);
  assert.ok(fs.existsSync(res.manifestPath));

  const manifest = JSON.parse(fs.readFileSync(res.manifestPath, 'utf-8'));
  assert.equal(manifest.filename, 'Architecture-Review.md');
  assert.equal(manifest.sha256, res.sha256);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('surface_manager: mock client setModelAndEffort configures work surface and effort', async () => {
  const sentMethods = [];
  const evalExpressions = [];

  const mockClient = {
    eval(expr) {
      evalExpressions.push(expr);
      // detectSurface response on home
      if (expr.includes('data-tpp-toggle-value="work"')) {
        return Promise.resolve({
          location: 'home',
          mode: 'work',
          conversationId: null,
          details: { chatFound: true, workFound: true }
        });
      }
      // pill rect
      if (expr.includes('getBoundingClientRect')) {
        return Promise.resolve({ x: 100, y: 200, width: 50, height: 20 });
      }
      // pill open state
      if (expr.includes("getAttribute('data-state') === 'open'")) {
        return Promise.resolve(false);
      }
      // model selection
      if (expr.includes('targetModelLower')) {
        return Promise.resolve({ success: true, name: 'GPT-6 Astra' });
      }
      // slider bounds
      if (expr.includes('aria-valuemin')) {
        return Promise.resolve({ min: 0, max: 5, current: 3 });
      }
      // result info
      if (expr.includes('resultInfo') || expr.includes('pillText')) {
        return Promise.resolve({ gear: 5, maxGear: 5, pillText: 'GPT-6 Astra Ultra' });
      }
      return Promise.resolve(true);
    },
    send(method, params) {
      sentMethods.push({ method, params });
      return Promise.resolve({});
    }
  };

  const result = await setModelAndEffort(mockClient, {
    surface: 'work',
    model: 'astra',
    effort: 'ultra'
  });

  assert.equal(result.success, true);
  assert.equal(result.surface, 'work');
  assert.equal(result.model, 'astra');
  assert.equal(result.effort.gear, 5);
  assert.equal(result.effort.label, 'Ultra');
  assert.ok(sentMethods.some(m => m.method === 'Input.dispatchMouseEvent'));
  assert.ok(sentMethods.some(m => m.method === 'Input.dispatchKeyEvent'));
});

test('surface_manager: classifyDivergence accurately distinguishes hard stop vs supplementary follow-ups', () => {
  // Severe divergence -> must stop and steer
  const r1 = classifyDivergence('当前的架构完全错误，推倒重来使用方案B');
  assert.equal(r1.isDivergent, true);
  assert.equal(r1.action, 'stop_and_steer');

  const r2 = classifyDivergence('刚才的提示词理解错需求了，方向跑偏，赶紧停止');
  assert.equal(r2.isDivergent, true);
  assert.equal(r2.action, 'stop_and_steer');

  const r3 = classifyDivergence('设计有问题，方案不可行，重写');
  assert.equal(r3.isDivergent, true);
  assert.equal(r3.action, 'stop_and_steer');

  // Supplementary / Refinement -> append turn
  const s1 = classifyDivergence('请在此基础上补充一个时序图');
  assert.equal(s1.isDivergent, false);
  assert.equal(s1.action, 'append_turn');

  const s2 = classifyDivergence('请把第3节的并发锁机制细化为代码示例');
  assert.equal(s2.isDivergent, false);
  assert.equal(s2.action, 'append_turn');

  const s3 = classifyDivergence('很好，继续深入推导性能瓶颈');
  assert.equal(s3.isDivergent, false);
  assert.equal(s3.action, 'append_turn');
});

test('surface_manager: forceStopAndSteer triggers physical Stop and injects corrective prompt', async () => {
  let stopClicked = false;
  let promptInjected = '';
  let sendClicked = false;
  let checkCount = 0;

  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtns')) {
        // First check: currently generating
        checkCount++;
        return Promise.resolve({
          hasStopButton: checkCount === 1,
          stopButtons: checkCount === 1 ? [{ ariaLabel: 'Stop answering' }] : [],
          sendReady: checkCount > 1,
          hasActiveSpinner: false,
          activeBadges: [],
          hasOutputs: false,
          outputsReady: true,
          textLength: 1200,
          currentUrl: 'https://chatgpt.com/c/test-steer'
        });
      }
      if (expr.includes('stopBtn.click()')) {
        stopClicked = true;
        return Promise.resolve({ clicked: true, label: 'Stop answering' });
      }
      if (expr.includes('isSendReady')) {
        // Poll check after stop: send button ready
        return Promise.resolve(true);
      }
      if (expr.includes('#prompt-textarea') && expr.includes('btn.click()')) {
        promptInjected = '架构完全错误，改用单体架构';
        sendClicked = true;
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    }
  };

  const steerRes = await forceStopAndSteer(mockClient, '架构完全错误，改用单体架构');
  assert.equal(steerRes.success, true);
  assert.equal(steerRes.interrupted, true);
  assert.equal(steerRes.action, 'interrupted_and_steered');
  assert.equal(stopClicked, true, 'Stop button must be clicked when generating');
  assert.equal(sendClicked, true, 'Send button must be clicked after injection');
  assert.equal(promptInjected, '架构完全错误，改用单体架构');
});

