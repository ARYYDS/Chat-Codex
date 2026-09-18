'use strict';
const { execSync } = require('node:child_process');

function cleanChromeDebugInstances() {
  console.log('[CleanChrome] Scanning running Chrome processes...');
  let jsonOutput = '';
  try {
    jsonOutput = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'chrome.exe\'\\" | ForEach-Object { [PSCustomObject]@{ ProcessId = $_.ProcessId; CommandLine = $_.CommandLine } } | ConvertTo-Json -Compress"',
      { encoding: 'utf-8', timeout: 8000 }
    ).trim();
  } catch (err) {
    console.log('[CleanChrome] No Chrome processes found or query timed out.');
    return { killed: 0, preserved: 0 };
  }

  if (!jsonOutput) {
    console.log('[CleanChrome] No Chrome processes currently running.');
    return { killed: 0, preserved: 0 };
  }

  let processes = [];
  try {
    const parsed = JSON.parse(jsonOutput);
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.log('[CleanChrome] Failed to parse process list JSON.');
    return { killed: 0, preserved: 0 };
  }

  let killed = 0;
  let preserved = 0;

  for (const proc of processes) {
    const pid = proc.ProcessId;
    const cmd = proc.CommandLine || '';

    const isDebugInstance =
      cmd.includes('--remote-debugging-port') ||
      cmd.includes('master-seed-profile') ||
      cmd.includes('sub-instance-1') ||
      cmd.includes('sub-instance-2') ||
      cmd.includes('sub-instance-cdp');

    if (isDebugInstance) {
      console.log(`[CleanChrome] Terminating debug Chrome PID ${pid}...`);
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        killed++;
      } catch {}
    } else {
      console.log(`[CleanChrome] Preserving official/regular user Chrome PID ${pid}.`);
      preserved++;
    }
  }

  console.log(`[CleanChrome] Summary: Cleaned ${killed} debug processes, preserved ${preserved} official user processes.`);
  return { killed, preserved };
}

if (require.main === module) {
  cleanChromeDebugInstances();
}

module.exports = { cleanChromeDebugInstances };
