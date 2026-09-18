'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const core = path.resolve(__dirname, '../..');
const cli = path.join(core, 'bin/handoff.js');

function sendRpc(requests) {
  const input = requests.map(r => JSON.stringify(r)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [cli, 'mcp'], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('mcp cli --help returns usage and registers all tools', () => {
  const result = spawnSync(process.execPath, [cli, 'mcp', '--help'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Chat-Codex MCP Server/);
  assert.match(result.stdout, /chatgpt_reason/);
  assert.match(result.stdout, /chatgpt_upload_context/);
  assert.match(result.stdout, /chatgpt_session_manage/);
  assert.match(result.stdout, /chatgpt_doctor/);
  assert.match(result.stdout, /chatgpt_adoption_verify/);
});

test('mcp stdio json-rpc tools/list returns exactly 6 tools with valid schemas', () => {
  const responses = sendRpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  ]);
  assert.equal(responses.length, 1);
  const res = responses[0];
  assert.equal(res.id, 1);
  assert.ok(Array.isArray(res.result.tools));
  assert.equal(res.result.tools.length, 6);
  const toolNames = res.result.tools.map(t => t.name);
  assert.deepEqual(toolNames.sort(), [
    'chatgpt_adoption_verify',
    'chatgpt_doctor',
    'chatgpt_reason',
    'chatgpt_session_manage',
    'chatgpt_surface_manage',
    'chatgpt_upload_context',
  ]);
});

test('mcp stdio json-rpc resources/list returns 3 registered resources', () => {
  const responses = sendRpc([
    { jsonrpc: '2.0', id: 2, method: 'resources/list' },
  ]);
  assert.equal(responses.length, 1);
  const res = responses[0];
  assert.equal(res.id, 2);
  assert.ok(Array.isArray(res.result.resources));
  assert.equal(res.result.resources.length, 3);
  const uris = res.result.resources.map(r => r.uri);
  assert.ok(uris.includes('chatgpt://runtime/status'));
  assert.ok(uris.includes('chatgpt://sessions/rooms'));
  assert.ok(uris.includes('chatgpt://history/recent'));
});

test('mcp tool chatgpt_adoption_verify validates 7-section structure and diffs', () => {
  const sampleMarkdown = `
# Reasoning Packet Result
## Verdict
Accepted proposed changes.
## Assumptions
No breaking changes.
## Evidence Used
File: \`lib/runtime-config.js\`
## Proposed Changes
Refactored logic.
## Tests
Tests pass.
## Risks
Minimal.
## Unknowns
None.
`;

  const responses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'chatgpt_adoption_verify',
        arguments: {
          resultMarkdown: sampleMarkdown,
          projectRoot: core,
        },
      },
    },
  ]);

  assert.equal(responses.length, 1);
  const parsed = JSON.parse(responses[0].result.content[0].text);
  assert.equal(parsed.validContract, true);
  assert.equal(parsed.missingSections.length, 0);
  assert.equal(parsed.gateStatus, 'PASSED_ADOPTION_GATE');
  assert.ok(parsed.filesEvaluated.length >= 1);
});

test('mcp tool chatgpt_upload_context creates monofile context offline', () => {
  const responses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'chatgpt_upload_context',
        arguments: {
          projectRoot: path.join(core, 'lib'),
        },
      },
    },
  ]);

  assert.equal(responses.length, 1);
  const parsed = JSON.parse(responses[0].result.content[0].text);
  assert.ok(parsed.bundledFilesCount > 0);
  assert.ok(parsed.totalBytes > 0);
  assert.ok(Array.isArray(parsed.bundleSummary));
});

test('mcp tool chatgpt_reason asyncHandle returns instant handle avoiding timeout', () => {
  const responses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'chatgpt_reason',
        arguments: {
          prompt: 'Test prompt for async handle',
          asyncHandle: true,
        },
      },
    },
  ]);

  assert.equal(responses.length, 1);
  const parsed = JSON.parse(responses[0].result.content[0].text);
  assert.equal(parsed.status, 'AWAITING_HUMAN_INPUT');
  assert.ok(parsed.taskId.startsWith('task_'));

  // Test checking the task status
  const checkResponses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'chatgpt_reason',
        arguments: {
          action: 'check_task',
          taskId: parsed.taskId,
        },
      },
    },
  ]);
  assert.equal(checkResponses.length, 1);
  const checkParsed = JSON.parse(checkResponses[0].result.content[0].text);
  assert.equal(checkParsed.taskId, parsed.taskId);
  assert.equal(checkParsed.status, 'AWAITING_HUMAN_INPUT');
});

test('mcp tool chatgpt_surface_manage inputSchema validates action, targetSurface, model, and effort', () => {
  const responses = sendRpc([
    { jsonrpc: '2.0', id: 7, method: 'tools/list' },
  ]);
  const tool = responses[0].result.tools.find(t => t.name === 'chatgpt_surface_manage');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.properties.action.enum, ['detect', 'switch', 'list_conversations', 'configure']);
  assert.deepEqual(tool.inputSchema.properties.targetSurface.enum, ['chat', 'work']);
  assert.ok(tool.inputSchema.properties.model);
  assert.ok(tool.inputSchema.properties.effort);

  const reasonTool = responses[0].result.tools.find(t => t.name === 'chatgpt_reason');
  assert.ok(reasonTool);
  assert.ok(reasonTool.inputSchema.properties.model);
  assert.ok(reasonTool.inputSchema.properties.reasoningEffort);
  assert.ok(reasonTool.inputSchema.properties.reasoningEffort.enum.includes('ultra'));
  assert.ok(reasonTool.inputSchema.properties.reasoningEffort.enum.includes('instant'));
});

test('handoff setup command detects installed editors and runs dry-run install', () => {
  const detectRes = spawnSync(process.execPath, [cli, 'setup'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(detectRes.status, 0);
  const detected = JSON.parse(detectRes.stdout);
  assert.ok(Array.isArray(detected.clients));
  assert.ok(detected.clients.some(c => c.id === 'vscode'));

  const dryRunRes = spawnSync(process.execPath, [cli, 'setup', '--install', 'vscode', '--dry-run'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(dryRunRes.status, 0);
  const dryRunJson = JSON.parse(dryRunRes.stdout);
  assert.equal(dryRunJson.dryRun, true);
  assert.equal(dryRunJson.results[0].target, 'VS Code Native MCP');
});

