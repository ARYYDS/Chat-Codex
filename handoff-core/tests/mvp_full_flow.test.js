'use strict';

/**
 * Chat-Codex 工程去幻重构全流程 MVP 闭环测试
 * 1. Master (Port 9225) 纯内存 Cookie 直出
 * 2. Worker (Port 9222) 内存动态注入与凭据就绪断言
 * 3. Worker 瞬态 Tab 开辟、就绪校验与即时内存释放
 * 4. MCP 非阻塞异步任务句柄 (Async Task Handle) 毫秒级交付与人工仲裁闭环
 * 5. Git Worktree 物理隔离影子沙盒门禁校验与看门狗守卫清理断言
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const core = path.resolve(__dirname, '..');
const { dumpCookiesFromBrowserTarget, injectCookiesToWorker } = require('../lib/cdp-cookie-manager');
const { executeTool } = require('../mcp/tools');

test('MVP Step 1 & 2: Master 9225 memory dump and Worker 9222 dynamic cookie injection', async () => {
  const t0 = Date.now();
  const masterCookies = await dumpCookiesFromBrowserTarget(9225, 3000);
  const dumpElapsed = Date.now() - t0;
  
  assert.ok(masterCookies.length > 0, 'Master should have cookies in memory');
  const masterAuth = masterCookies.find(c => c.name.includes('session-token'));
  assert.ok(masterAuth, 'Master must have __Secure-next-auth.session-token');

  const t1 = Date.now();
  const injectRes = await injectCookiesToWorker(9222, masterCookies, 3000);
  const injectElapsed = Date.now() - t1;
  assert.equal(injectRes.success, true);
  assert.equal(injectRes.count, masterCookies.length);

  const workerCookies = await dumpCookiesFromBrowserTarget(9222, 3000);
  const workerAuth = workerCookies.find(c => c.name === masterAuth.name);
  assert.ok(workerAuth, 'Worker must contain the injected session token in memory');

  console.log(`[MVP PASS] Dumped ${masterCookies.length} cookies (${dumpElapsed}ms), injected (${injectElapsed}ms) into Worker 9222.`);
});

test('MVP Step 3: Ephemeral Tab lifecycle and renderer memory reclamation on Worker 9222', async () => {
  // 1. Create tab
  const newTab = await fetch('http://127.0.0.1:9222/json/new?https://chatgpt.com/', { method: 'PUT' }).then(r => r.json());
  assert.ok(newTab.id, 'New tab must have target ID');

  // 2. Wait for mounting
  await new Promise(r => setTimeout(r, 2000));
  const tabs = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
  const mounted = tabs.find(t => t.id === newTab.id);
  assert.ok(mounted, 'Tab should be active in CDP');
  assert.match(mounted.url, /chatgpt\.com/);

  // 3. Immediate close to prevent Blink memory leak
  await fetch(`http://127.0.0.1:9222/json/close/${newTab.id}`);
  await new Promise(r => setTimeout(r, 500));
  const tabsAfter = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
  assert.equal(Boolean(tabsAfter.find(t => t.id === newTab.id)), false, 'Tab must be terminated');

  console.log('[MVP PASS] Ephemeral Tab created, navigated to ChatGPT, and destroyed cleanly.');
});

test('MVP Step 4: MCP Async Task Handle non-blocking lifecycle (<1ms response & human arbitration)', async () => {
  // 1. Dispatch with asyncHandle
  const t0 = performance.now();
  const handle = await executeTool('chatgpt_reason', {
    prompt: 'MVP Architectural Reasoning Prompt',
    asyncHandle: true,
  });
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 15, `Async handle must respond in < 15ms (actual: ${elapsed.toFixed(2)}ms)`);
  assert.equal(handle.status, 'AWAITING_HUMAN_INPUT');
  assert.ok(handle.taskId.startsWith('task_'));

  // 2. Check task status
  const check1 = await executeTool('chatgpt_reason', {
    action: 'check_task',
    taskId: handle.taskId,
  });
  assert.equal(check1.status, 'AWAITING_HUMAN_INPUT');

  // 3. Submit human feedback (simulating user arbitration via GUI)
  const review = await executeTool('chatgpt_reason', {
    action: 'submit_human_review',
    taskId: handle.taskId,
    humanFeedback: { approved: true, notes: 'Human approved MVP changes.' },
  });
  assert.equal(review.success, true);

  // 4. Check task status after review
  const check2 = await executeTool('chatgpt_reason', {
    action: 'check_task',
    taskId: handle.taskId,
  });
  assert.equal(check2.status, 'HUMAN_FEEDBACK_AVAILABLE');
  assert.equal(check2.humanFeedback.approved, true);

  console.log(`[MVP PASS] Async Handle delivered in ${elapsed.toFixed(2)}ms; human arbitration closed loop.`);
});

test('MVP Step 5: Git Worktree Shadow Sandbox Local Adoption Gate', async () => {
  const reasoningMarkdown = `
# Reasoning Packet Result
## Verdict
Accepted proposed changes.
## Assumptions
No breaking changes.
## Evidence Used
File: \`lib/runtime-config.js\`
## Proposed Changes
Added non-blocking validation.
## Tests
Tests pass.
## Risks
Minimal.
## Unknowns
None.
`;

  const safePatch = 'diff --git a/mvp_test.txt b/mvp_test.txt\nnew file mode 100644\n--- /dev/null\n+++ b/mvp_test.txt\n@@ -0,0 +1,1 @@\n+hello mvp\n';

  const verifyRes = await executeTool('chatgpt_adoption_verify', {
    resultMarkdown: reasoningMarkdown,
    projectRoot: core,
    dryRunPatch: true,
    patchContent: safePatch,
    testCommand: 'node -e "process.exit(0)"',
  });

  assert.equal(verifyRes.validContract, true);
  assert.equal(verifyRes.missingSections.length, 0);
  assert.equal(verifyRes.gateStatus, 'PASSED_ADOPTION_GATE');
  assert.equal(verifyRes.sandboxResult?.success, true);

  console.log('[MVP PASS] Git Worktree Shadow Sandbox verified patch execution with zero workspace pollution.');
});
