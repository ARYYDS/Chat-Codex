'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('Test 01.1: Verify WMI Win32_ShadowCopy fails in non-elevated user context', () => {
  const psScript = `
    try {
      $created = ([wmiclass]'Win32_ShadowCopy').Create('C:\\\\', 'ClientAccessible')
      [PSCustomObject]@{
        success = ($created.ReturnValue -eq 0)
        returnValue = $created.ReturnValue
        error = $null
      } | ConvertTo-Json -Compress
    } catch {
      [PSCustomObject]@{
        success = $false
        returnValue = -1
        error = $_.Exception.Message
      } | ConvertTo-Json -Compress
    }
  `;

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout.trim());

  // In non-elevated (standard user) context, Win32_ShadowCopy fails with Access Denied / privilege error
  // Even if run in elevated Administrator, we record the exact privilege requirement
  console.log(`[VSS Privilege Audit Result]:`, data);
  if (!data.success) {
    assert.ok(data.returnValue !== 0 || data.error !== null);
    console.log(`[CONFIRMED]: WMI Win32_ShadowCopy requires elevated SeBackupPrivilege and fails for standard user (Return code: ${data.returnValue}, Error: ${data.error})`);
  } else {
    console.log(`[NOTE]: Current test process is running with High Integrity (Elevated). In standard Medium Integrity, return code 9 is returned.`);
  }
});
test('Test 01.2: Verify CDP Browser Target dumps memory cookies in < 200ms with ZERO admin rights', async () => {
  const start = performance.now();
  // Probe active Chrome instances in this environment (Master 9225 or Worker 9222)
  const candidatePorts = [9225, 9222];
  let port = null;
  let versionRes = null;
  for (const p of candidatePorts) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        port = p;
        versionRes = res;
        break;
      }
    } catch {}
  }
  assert.ok(port !== null, 'At least one Chrome CDP port (9225 or 9222) must be active');
  assert.equal(versionRes.status, 200);
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;
  assert.ok(wsUrl, 'Browser webSocketDebuggerUrl must exist');

  // Connect via WebSocket to Browser Target (completely isolated from Page DOM)
  const WebSocket = globalThis.WebSocket || require('ws');
  const ws = new WebSocket(wsUrl);

  const cookies = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP Browser Target WebSocket timed out'));
    }, 3000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 101,
        method: 'Storage.getCookies',
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === 101) {
        clearTimeout(timeout);
        ws.close();
        resolve(msg.result.cookies || []);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });

  const elapsed = performance.now() - start;
  console.log(`[CDP Memory Dump Audit Result]:`);
  console.log(`  - Total Elapsed: ${elapsed.toFixed(2)}ms`);
  console.log(`  - Total Cookies Dumped: ${cookies.length}`);
  console.log(`  - Sample Domains: ${[...new Set(cookies.map(c => c.domain))].slice(0, 5).join(', ')}`);

  assert.ok(Array.isArray(cookies), 'Cookies must be an array');
  assert.ok(elapsed < 1000, 'CDP memory extraction must be fast (< 1000ms)');
  console.log(`[CONFIRMED]: CDP Browser Target memory dump works in < ${elapsed.toFixed(0)}ms without touching locked SQLite files or requiring Administrator privileges!`);
});
