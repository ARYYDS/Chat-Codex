const { execSync } = require('child_process');

try {
  const output = execSync('powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*handoff.js*mcp*\' } | Select-Object -Property ProcessId, CommandLine | ConvertTo-Json"', { encoding: 'utf8' });
  const procs = JSON.parse(output.trim() || '[]');
  const arr = Array.isArray(procs) ? procs : [procs];
  for (const p of arr) {
    if (p && p.ProcessId) {
      console.log(`Killing MCP process PID ${p.ProcessId}: ${p.CommandLine}`);
      try {
        process.kill(p.ProcessId, 'SIGTERM');
      } catch (e) {
        execSync(`taskkill /PID ${p.ProcessId} /F`);
      }
    }
  }
  console.log('Done.');
} catch (err) {
  console.log('No MCP processes or error:', err.message);
}
