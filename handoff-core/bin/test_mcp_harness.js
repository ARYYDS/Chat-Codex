const { spawn } = require('child_process');

const p = spawn('node', ['C:\\code\\Chat-Codex\\handoff-core\\bin\\handoff.js', 'mcp'], {
  env: {
    ...process.env,
    NODE_OPTIONS: '--dns-result-order=ipv4first',
    HANDOFF_CONFIG: 'C:\\GPT-Chat-codex-handoff\\runtime.local.json'
  }
});

p.stdout.on('data', d => console.log('STDOUT:', d.toString()));
p.stderr.on('data', d => console.error('STDERR:', d.toString()));
p.on('exit', (code, sig) => console.log('EXIT:', code, sig));
p.on('error', err => console.error('ERROR:', err));

const initMsg = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'antigravity', version: '1.0' }
  }
});

p.stdin.write(initMsg + '\n');

setTimeout(() => {
  const toolsMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
  p.stdin.write(toolsMsg + '\n');
}, 300);

setTimeout(() => {
  p.stdin.end();
}, 800);
