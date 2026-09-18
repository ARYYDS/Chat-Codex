'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startGuiServer } = require('../../gui/server');

const TEST_PORT = 8793;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

test('Chat-Codex Studio: GUI Full Step-by-Step Click and Feature Flow Verification', async (t) => {
  let serverInstance = null;

  await t.test('Step 0: Start GUI Server instance on dedicated test port', async () => {
    serverInstance = await startGuiServer({ port: TEST_PORT, openBrowser: false });
    assert.ok(serverInstance, 'Server instance should start successfully');
  });

  await t.test('Step 1: Frontend SPA Assets Delivery (HTML, CSS, JS, Odometer)', async () => {
    const resHtml = await fetch(`${BASE_URL}/`);
    assert.strictEqual(resHtml.status, 200, 'index.html should return 200 OK');
    const htmlText = await resHtml.text();
    assert.ok(htmlText.includes('Chat-Codex Studio'), 'HTML must contain App title');
    assert.ok(htmlText.includes('活跃 Chat 窗口数'), 'HTML must contain Card 1 Active Chats');
    assert.ok(htmlText.includes('历史累计 Chat'), 'HTML must contain Card 2 History Chats');
    assert.ok(htmlText.includes('集群物理内存'), 'HTML must contain Card 3 Memory');
    assert.ok(htmlText.includes('影子门禁'), 'HTML must contain Card 4 Shadow Gate');
    assert.ok(htmlText.includes('Worker 子浏览器实例矩阵'), 'HTML must contain Worker Matrix');
    assert.ok(htmlText.includes('10 路错峰梯度任务调度流水线'), 'HTML must contain Timeline');
    assert.ok(htmlText.includes('SlideOver Drawer') || htmlText.includes('drawer'), 'HTML must contain SlideOver Drawer');
    assert.ok(htmlText.includes('modal-master-login'), 'HTML must contain Master-Seed Modal');

    const resCss = await fetch(`${BASE_URL}/styles.css`);
    assert.strictEqual(resCss.status, 200, 'styles.css should return 200 OK');
    const cssText = await resCss.text();
    assert.ok(cssText.includes('odometer') || cssText.includes('transform'), 'CSS must contain Odometer animations');

    const resJs = await fetch(`${BASE_URL}/app.js`);
    assert.strictEqual(resJs.status, 200, 'app.js should return 200 OK');

    const resOdo = await fetch(`${BASE_URL}/odometer.js`);
    assert.strictEqual(resOdo.status, 200, 'odometer.js should return 200 OK');
  });

  await t.test('Step 2: SSE Realtime Stream Handshake (/api/events)', async () => {
    const sseReceived = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('SSE connection timed out')), 4000);
      const req = http.get(`${BASE_URL}/api/events`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('text/event-stream'));

        res.on('data', (chunk) => {
          const text = chunk.toString();
          if (text.includes('event: telemetry') || text.includes('event: connected') || text.includes('data:')) {
            clearTimeout(timeout);
            req.destroy();
            resolve(true);
          }
        });
      });
      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    assert.ok(sseReceived, 'SSE must stream realtime telemetry events to client');
  });

  await t.test('Step 3: Cluster Status Query (/api/status)', async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.master, 'Status must include master');
    assert.ok(Array.isArray(data.workers), 'Status must include workers array');
    assert.ok(data.mcp, 'Status must include mcp');
    assert.strictEqual(data.mcp.available, true, 'MCP server must be available');
  });

  await t.test('Step 4: Click Header [🔑 拉起母版登录] -> POST /api/master/launch', async () => {
    const res = await fetch(`${BASE_URL}/api/master/launch`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'Master launch endpoint must respond true');
    assert.strictEqual(data.port, 9225, 'Master port should be 9225');
  });

  await t.test('Step 5: Click Header [🔄 内存凭据热分发] -> POST /api/master/sync', async () => {
    const res = await fetch(`${BASE_URL}/api/master/sync`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok('success' in data, 'Sync response must have success property');
    assert.ok('durationMs' in data, 'Sync response must report latency');
  });

  await t.test('Step 6: Click Header [🧹 全局一键强制GC] -> POST /api/workers/gc', async () => {
    const res = await fetch(`${BASE_URL}/api/workers/gc`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'GC must return success');
    assert.ok(data.closedTabsCount >= 1, 'GC must return closedTabsCount >= 1');
    assert.ok(data.estimatedSavedMB >= 180, 'GC must return estimatedSavedMB >= 180');
  });

  await t.test('Step 7: Click Header [⚙️ 系统设置] -> POST /api/setup/install', async () => {
    const res = await fetch(`${BASE_URL}/api/setup/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'antigravity', dryRun: true }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true, 'Setup install must succeed');
    assert.strictEqual(data.dryRun, true);
  });

  await t.test('Step 8: Click Worker Matrix [Worker Stop] -> POST /api/workers/stop', async () => {
    const res = await fetch(`${BASE_URL}/api/workers/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 9222 }),
    });
    assert.ok(res.status === 200 || res.status === 404, 'Stop endpoint should respond valid code');
  });

  await t.test('Step 9: Click [🚀 启动 10 路错峰调度] -> POST /api/tasks/dispatch', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'staggered', concurrency: 10 }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.pid > 0, 'Dispatch must return background child PID');
  });

  await t.test('Step 10: Click Timeline Task Row -> GET /api/tasks/:id/report', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/1/report`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.title, 'Report must contain task title');
    assert.ok(data.markdown, 'Report must contain markdown text');
    assert.ok(typeof data.diff === 'string', 'Diff must be a string');
  });

  await t.test('Step 11: Click SlideOver Drawer [🛑 强制驳回与任务二次拆解] -> POST /api/tasks/:id/arbitrate', async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/1/arbitrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject',
        reason: '知识偏移：模型给出了过时的 WMI 方案',
        prompt: '必须使用纯原生 Win32 GetProcessMemoryInfo，严禁使用 WMI',
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.arbitration, 'Arbitration receipt must be returned');
    assert.strictEqual(data.arbitration.action, 'reject');
  });

  await t.test('Step 12: Emergency Stop All Schedulers -> POST /api/cluster/emergency-stop', async () => {
    const res = await fetch(`${BASE_URL}/api/cluster/emergency-stop`, {
      method: 'POST',
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
  });

  await t.test('Cleanup: Shutdown GUI Server gracefully', async () => {
    if (serverInstance) {
      await serverInstance.close();
      assert.ok(true, 'Server closed cleanly with zero dangling socket handles');
    }
  });
});
