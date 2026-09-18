'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTurnConvergence, forceStop } = require('../../lib/surface_manager');

test('stall_watchdog: detects static frozen output when text unchanged beyond stall threshold', async () => {
  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtns')) {
        return Promise.resolve({
          hasStopButton: true,
          stopButtons: [{ ariaLabel: 'Stop answering' }],
          sendReady: false,
          hasActiveSpinner: false,
          activeBadges: [],
          hasOutputs: false,
          outputsReady: true,
          textLength: 14803,
          currentUrl: 'https://chatgpt.com/c/test-conv'
        });
      }
      if (expr.includes('/backend-api/conversation/')) {
        return Promise.resolve({
          ok: true,
          title: 'Stalled Generation Task',
          status: 'in_progress',
          endTurn: false,
          latestMsgId: 'msg-1',
          textLength: 14803,
          fullText: 'Long report text...'
        });
      }
      return Promise.resolve(null);
    }
  };

  const tracker = { lastTextLength: 0, lastChangeTime: Date.now() };

  // 第一次检测：记录初始字符数
  const res1 = await checkTurnConvergence(mockClient, {
    convId: 'test-conv',
    tracker,
    stallThresholdMs: 50
  });

  assert.equal(res1.isStalled, false);
  assert.equal(tracker.lastTextLength, 14803);

  // 模拟等待 60ms，再次检测（字数未发生变化）
  await new Promise(r => setTimeout(r, 60));

  const res2 = await checkTurnConvergence(mockClient, {
    convId: 'test-conv',
    tracker,
    stallThresholdMs: 50
  });

  // 应当被看门狗标记为停滞，允许上层调度器快速自刷新自愈
  assert.equal(res2.isStalled, true, 'isStalled must be true when text freezes beyond threshold');
});

test('stall_watchdog: detects zombie stop button and confirms convergence if backend is finished', async () => {
  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtns')) {
        // Next.js React 状态机延迟导致 DOM 中残留 Stop 按钮 (僵尸 Stop 按钮)
        return Promise.resolve({
          hasStopButton: true,
          stopButtons: [{ ariaLabel: 'Stop answering' }],
          sendReady: false,
          hasActiveSpinner: false,
          activeBadges: [],
          hasOutputs: true,
          outputsReady: true,
          textLength: 14980,
          currentUrl: 'https://chatgpt.com/c/test-conv'
        });
      }
      if (expr.includes('/backend-api/conversation/')) {
        // 后端确凿返回 finished_successfully 与 endTurn: true
        return Promise.resolve({
          ok: true,
          title: 'Astra Architectural Specification',
          status: 'finished_successfully',
          endTurn: true,
          latestMsgId: 'msg-final',
          textLength: 14980,
          fullText: '# Complete Technical Specification\n\nFull text...'
        });
      }
      return Promise.resolve(null);
    }
  };

  const res = await checkTurnConvergence(mockClient, { convId: 'test-conv' });

  assert.equal(res.isZombieStop, true, 'Must identify zombie stop button in DOM');
  assert.equal(res.backendCompleted, true, 'Backend status must be confirmed finished');
  assert.equal(res.isSettled, true, 'isSettled must be true despite zombie stop button');
  assert.equal(res.isGenerating, false, 'isGenerating must be false');
});

test('stall_watchdog: forceStop clicks physical stop button selector', async () => {
  let clicked = false;
  const mockClient = {
    eval(expr) {
      if (expr.includes('stopBtn.click()')) {
        clicked = true;
        return Promise.resolve({ success: true, clicked: true, label: 'Stop generating' });
      }
      return Promise.resolve({ success: false, clicked: false });
    }
  };

  const stopRes = await forceStop(mockClient);
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.clicked, true);
  assert.equal(clicked, true);
});
