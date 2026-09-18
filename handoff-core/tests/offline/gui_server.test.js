'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const {
  getClusterTelemetry,
  getProcessMemory,
  recordEphemeralRelease,
  stopTelemetryPolling,
} = require('../../lib/gui-telemetry');

const { startGuiServer, broadcast } = require('../../gui/server');

test('gui-telemetry: getProcessMemory returns valid memory metrics', async () => {
  const nodeMem = await getProcessMemory('node');
  assert.equal(typeof nodeMem, 'number');
  assert.ok(nodeMem > 0, `Node memory should be positive, got ${nodeMem}`);

  const pidMem = await getProcessMemory(process.pid);
  assert.equal(typeof pidMem, 'number');
  assert.ok(pidMem > 0, `PID memory should be positive, got ${pidMem}`);
});

test('gui-telemetry: getClusterTelemetry returns complete schema and cached query < 50ms', async () => {
  const t0 = performance.now();
  const telemetry = await getClusterTelemetry();
  const durationFirst = performance.now() - t0;

  assert.ok(telemetry, 'Telemetry object must exist');
  assert.ok(Array.isArray(telemetry.workers), 'telemetry.workers must be an array');
  assert.equal(telemetry.workers.length, 2, 'Must include Worker 9222 and 9223');
  assert.equal(telemetry.workers[0].port, 9222);
  assert.equal(telemetry.workers[1].port, 9223);

  assert.ok(telemetry.master, 'Master object must exist');
  assert.equal(telemetry.master.port, 9225);

  assert.ok(telemetry.node, 'Node object must exist');
  assert.equal(telemetry.node.pid, process.pid);
  assert.ok(telemetry.node.memoryMB > 0);

  assert.ok(telemetry.ephemeral, 'Ephemeral object must exist');
  assert.equal(typeof telemetry.ephemeral.tabsClosed, 'number');
  assert.equal(typeof telemetry.ephemeral.savedMemoryMB, 'number');

  assert.ok(Array.isArray(telemetry.waveform), 'Waveform history must be an array');

  // 第二次读取（热缓存），验证严格控制在 < 50ms (通常 < 1ms)
  const t1 = performance.now();
  const cached = await getClusterTelemetry();
  const cachedDuration = performance.now() - t1;

  assert.ok(cachedDuration < 50, `Cached query took ${cachedDuration}ms, must be < 50ms`);
  assert.equal(cached.totalClusterMemoryMB, telemetry.totalClusterMemoryMB);
});

test('gui-telemetry: recordEphemeralRelease accumulates closed tabs and memory metrics', () => {
  const before = recordEphemeralRelease(0);
  const initialClosed = before.tabsClosed;
  const initialSaved = before.savedMemoryMB;

  const after = recordEphemeralRelease(2, 180);
  assert.equal(after.tabsClosed, initialClosed + 2);
  assert.equal(after.savedMemoryMB, initialSaved + 360);
});

test('gui-server: full HTTP and SSE server lifecycle and REST endpoints verification', async () => {
  const TEST_PORT = 8799;
  const instance = await startGuiServer({ port: TEST_PORT });
  assert.equal(instance.port, TEST_PORT);

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    // 1. 静态资源分发验证 (HTML, CSS, JS)
    const resHtml = await fetch(`${baseUrl}/index.html`);
    assert.equal(resHtml.status, 200);
    assert.match(resHtml.headers.get('content-type'), /text\/html/);
    const htmlBody = await resHtml.text();
    assert.ok(htmlBody.includes('Chat-Codex'), 'HTML should contain Chat-Codex');

    const resCss = await fetch(`${baseUrl}/styles.css`);
    assert.equal(resCss.status, 200);
    assert.match(resCss.headers.get('content-type'), /text\/css/);

    const resJs = await fetch(`${baseUrl}/app.js`);
    assert.equal(resJs.status, 200);
    assert.match(resJs.headers.get('content-type'), /application\/javascript/);

    // 2. GET /api/status
    const resStatus = await fetch(`${baseUrl}/api/status`);
    assert.equal(resStatus.status, 200);
    const statusData = await resStatus.json();
    assert.equal(statusData.ok, true);
    assert.ok(statusData.master);
    assert.ok(Array.isArray(statusData.workers));
    assert.ok(statusData.mcp);
    assert.ok(statusData.config);

    // 3. GET /api/telemetry
    const resTelem = await fetch(`${baseUrl}/api/telemetry`);
    assert.equal(resTelem.status, 200);
    const telemData = await resTelem.json();
    assert.equal(telemData.ok, true);
    assert.equal(typeof telemData.activeWindows, 'number');
    assert.equal(typeof telemData.totalDispatched, 'number');
    assert.equal(typeof telemData.estimatedTokens, 'number');
    assert.equal(typeof telemData.gateAdoptionRate, 'number');
    assert.ok(Array.isArray(telemData.memoryHistory));

    // 4. GET /api/workers
    const resWorkers = await fetch(`${baseUrl}/api/workers`);
    assert.equal(resWorkers.status, 200);
    const workersData = await resWorkers.json();
    assert.equal(workersData.success, true);
    assert.equal(workersData.workers.length, 2);

    // 5. POST /api/workers/gc
    const resGc = await fetch(`${baseUrl}/api/workers/gc`, { method: 'POST' });
    assert.equal(resGc.status, 200);
    const gcData = await resGc.json();
    assert.equal(gcData.success, true);
    assert.ok(gcData.closedTabsCount >= 1);
    assert.ok(gcData.estimatedSavedMB >= 180);

    // 6. GET /api/tasks
    const resTasks = await fetch(`${baseUrl}/api/tasks`);
    assert.equal(resTasks.status, 200);
    const tasksData = await resTasks.json();
    assert.equal(tasksData.success, true);
    assert.equal(tasksData.tasks.length, 10);
    assert.equal(tasksData.tasks[0].id, 1);

    // 7. GET /api/tasks/1/report
    const resReport = await fetch(`${baseUrl}/api/tasks/1/report`);
    assert.equal(resReport.status, 200);
    const reportData = await resReport.json();
    assert.equal(reportData.success, true);
    assert.equal(reportData.id, 1);
    assert.ok(reportData.markdown, 'Report must contain markdown text');
    assert.ok(typeof reportData.diff === 'string', 'Report must contain diff string');

    // 8. POST /api/tasks/1/arbitrate
    const resArbitrate = await fetch(`${baseUrl}/api/tasks/1/arbitrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject',
        reason: 'Hallucination in Turnstile discussion',
        prompt: 'Please verify with 2026 Cloudflare official changelog.',
      }),
    });
    assert.equal(resArbitrate.status, 200);
    const arbData = await resArbitrate.json();
    assert.equal(arbData.success, true);
    assert.equal(arbData.id, '1');
    assert.equal(arbData.arbitration.action, 'reject');

    // 9. POST /api/setup/install with dryRun
    const resSetup = await fetch(`${baseUrl}/api/setup/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'all', dryRun: true }),
    });
    assert.equal(resSetup.status, 200);
    const setupData = await resSetup.json();
    assert.equal(setupData.success, true);
    assert.equal(setupData.dryRun, true);

    // 10. GET /api/events (SSE Stream & Broadcast)
    await new Promise((resolve, reject) => {
      const sseReq = http.request(
        `${baseUrl}/api/events`,
        {
          headers: { Accept: 'text/event-stream' },
        },
        (sseRes) => {
          assert.equal(sseRes.statusCode, 200);
          assert.match(sseRes.headers['content-type'], /text\/event-stream/);

          let buffer = '';
          sseRes.on('data', (chunk) => {
            buffer += chunk.toString();
            if (buffer.includes('event: telemetry') || buffer.includes(': connected')) {
              // 发送一次广播测试
              broadcast('custom_test_event', { testOk: true });
            }
            if (buffer.includes('custom_test_event')) {
              sseReq.destroy();
              resolve();
            }
          });

          sseRes.on('error', reject);
        }
      );

      sseReq.on('error', (err) => {
        if (err.code !== 'ECONNRESET') reject(err);
      });

      sseReq.end();
    });

  } finally {
    // 优雅关闭服务与定时器
    await instance.close();
    stopTelemetryPolling();
  }
});
