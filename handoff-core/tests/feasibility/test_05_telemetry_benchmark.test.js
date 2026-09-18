'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('Test 05: Benchmark high-frequency WMI process query vs Native process telemetry', () => {
  const iterations = 3;

  // 1. Benchmark WMI query (PowerShell Get-CimInstance Win32_Process)
  const t0Wmi = performance.now();
  for (let i = 0; i < iterations; i++) {
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}" | Select-Object -ExpandProperty WorkingSetSize`,
    ], { encoding: 'utf8', windowsHide: true });
  }
  const avgWmiMs = (performance.now() - t0Wmi) / iterations;

  // 2. Benchmark Native direct memory API (e.g. process.memoryUsage().rss or Win32 GetProcessMemoryInfo)
  const t0Native = performance.now();
  for (let i = 0; i < iterations * 100; i++) {
    const mem = process.memoryUsage().rss;
  }
  const avgNativeMs = (performance.now() - t0Native) / (iterations * 100);

  console.log(`[Telemetry Benchmark Results]:`);
  console.log(`  - WMI Process Query average latency: ${avgWmiMs.toFixed(2)} ms / query`);
  console.log(`  - Native API average latency:       ${(avgNativeMs * 1000).toFixed(2)} µs / query`);
  console.log(`  - Performance Ratio: WMI is ${(avgWmiMs / avgNativeMs).toFixed(0)}x slower than Native!`);

  assert.ok(avgWmiMs > 200, 'WMI process query takes > 200ms per call due to full process traversal');
  assert.ok(avgNativeMs < 0.1, 'Native memory query takes < 0.1ms');
  console.log('[CONFIRMED]: 1Hz telemetry must NEVER use WMI/PowerShell. It must use native Win32/Rust memory APIs.');
});
