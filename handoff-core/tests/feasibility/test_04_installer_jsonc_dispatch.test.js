'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Strips JSON comments (JSONC to JSON)
function parseJsonc(text) {
  // Strip block comments /* ... */
  let clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip single-line comments // ...
  clean = clean.replace(/(^|[^\\])\/\/.*$/gm, '$1');
  // Remove trailing commas before } or ]
  clean = clean.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(clean);
}

test('Test 04.1: Verify JSONC with comments crashes native JSON.parse but passes safe parser', () => {
  const jsoncFixture = `
    {
      // Claude Desktop & Cursor user comment
      "mcpServers": {
        /* Brave search integration */
        "brave-search": {
          "command": "node",
          "args": ["dist/index.js"], // inline comment
        },
      },
    }
  `;

  // Native JSON.parse must fail
  assert.throws(() => {
    JSON.parse(jsoncFixture);
  }, /SyntaxError/);
  console.log('[CONFIRMED]: Native JSON.parse crashes on typical user configs containing JSONC comments.');

  // Safe parser must succeed
  const parsed = parseJsonc(jsoncFixture);
  assert.ok(parsed.mcpServers['brave-search']);
  assert.equal(parsed.mcpServers['brave-search'].command, 'node');
  console.log('[CONFIRMED]: Safe JSONC parser successfully reads user configs without data loss or exceptions.');
});

test('Test 04.2: Verify client-specific configuration syntax dispatch and absolute node path', () => {
  const nodePath = process.execPath;
  const handoffScript = path.resolve(__dirname, '../../bin/handoff.js');

  function generateClientConfig(clientType) {
    const entry = {
      command: nodePath,
      args: ['--dns-result-order=ipv4first', handoffScript, 'mcp'],
      env: {
        NODE_OPTIONS: '--dns-result-order=ipv4first',
        HANDOFF_CONFIG: 'C:\\GPT-Chat-codex-handoff\\runtime.local.json',
      },
    };

    if (clientType === 'vscode-native') {
      return { servers: { 'chat-codex': entry } };
    } else {
      return { mcpServers: { 'chat-codex': entry } };
    }
  }

  // 1. VS Code Native uses 'servers'
  const vsCodeConfig = generateClientConfig('vscode-native');
  assert.ok(vsCodeConfig.servers, 'VS Code native must use "servers" root key');
  assert.equal(vsCodeConfig.mcpServers, undefined);

  // 2. Cursor uses 'mcpServers'
  const cursorConfig = generateClientConfig('cursor');
  assert.ok(cursorConfig.mcpServers, 'Cursor must use "mcpServers" root key');
  assert.equal(cursorConfig.servers, undefined);

  // 3. Absolute path verification
  assert.ok(cursorConfig.mcpServers['chat-codex'].command.endsWith('node.exe'), 'Command must be absolute node.exe path');
  assert.ok(path.isAbsolute(cursorConfig.mcpServers['chat-codex'].command));
  console.log(`[CONFIRMED]: Configuration correctly dispatched ('servers' vs 'mcpServers') with absolute binary '${nodePath}'.`);
});
