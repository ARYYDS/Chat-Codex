'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { globalTaskManager } = require('../../mcp/tools');

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

test('mcp_two_phase: chatgpt_reason in Work mode returns instant ticket < 500ms avoiding client timeout', () => {
  const t0 = performance.now();
  const responses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'chatgpt_reason',
        arguments: {
          prompt: 'Deep architecture analysis in Work surface',
          surface: 'work',
          model: 'gpt-6-astra'
        },
      },
    },
  ]);
  const duration = performance.now() - t0;

  assert.equal(responses.length, 1);
  const parsed = JSON.parse(responses[0].result.content[0].text);

  // 断言快速接单，绝不阻塞超过 1000ms
  assert.ok(duration < 1500, `Expected instant return, took ${duration}ms`);
  assert.equal(parsed.resultType, 'task');
  assert.equal(parsed.status, 'ACCEPTED');
  assert.equal(parsed.surface, 'work');
  assert.ok(parsed.taskId.startsWith('task_'));
  assert.equal(parsed.estimatedWaitSec, 120);

  // 验证两阶段查询：立即检查任务处于排队/处理中状态
  const checkRes = sendRpc([
    {
      jsonrpc: '2.0',
      id: 11,
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

  const checkParsed = JSON.parse(checkRes[0].result.content[0].text);
  assert.equal(checkParsed.taskId, parsed.taskId);
  assert.equal(checkParsed.status, 'ACCEPTED');
});

test('mcp_two_phase: fetch_result retrieves completed report and handles unknown task gracefully', () => {
  // 1. 创建并手动将任务标记为完成
  const task = globalTaskManager.createTask('Synthetic test task', { surface: 'work' });
  const sampleMarkdown = '# Report\n## Verdict\nPass\n## Proposed Changes\nNone';
  globalTaskManager.completeTask(task.taskId, {
    resultMarkdown: sampleMarkdown,
    metadata: { tokens: 1500 }
  });

  // 2. 通过 MCP fetch_result 提取报告正文
  const responses = sendRpc([
    {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'chatgpt_reason',
        arguments: {
          action: 'fetch_result',
          taskId: task.taskId,
        },
      },
    },
  ]);

  assert.equal(responses.length, 1);
  const parsed = JSON.parse(responses[0].result.content[0].text);
  assert.equal(parsed.success, true);
  assert.equal(parsed.taskId, task.taskId);
  assert.equal(parsed.isCompleted, true);
  assert.equal(parsed.status, 'COMPLETED');
  assert.equal(parsed.resultMarkdown, sampleMarkdown);

  // 3. 查询不存在的任务 ID
  const notFoundRes = sendRpc([
    {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'chatgpt_reason',
        arguments: {
          action: 'fetch_result',
          taskId: 'task_non_existent_9999',
        },
      },
    },
  ]);

  const notFoundParsed = JSON.parse(notFoundRes[0].result.content[0].text);
  assert.equal(notFoundParsed.success, false);
  assert.equal(notFoundParsed.status, 'NOT_FOUND');
});
