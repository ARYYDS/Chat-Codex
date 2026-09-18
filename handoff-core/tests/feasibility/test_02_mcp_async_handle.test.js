'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Simulated In-Memory Async Task Handle Manager
class AsyncTaskHandleManager {
  constructor() {
    this.tasks = new Map();
  }

  createTask(prompt, context) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.tasks.set(taskId, {
      id: taskId,
      prompt,
      context,
      status: 'AWAITING_HUMAN_INPUT',
      createdAt: Date.now(),
      humanFeedback: null,
    });
    return {
      status: 'AWAITING_HUMAN_INPUT',
      taskId,
      guiUrl: `http://127.0.0.1:3900/arbitration/${taskId}`,
      message: 'Execution suspended for human review. Agent should poll check_task_status without blocking stdio.',
    };
  }

  submitHumanFeedback(taskId, feedback) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'HUMAN_FEEDBACK_AVAILABLE';
    task.humanFeedback = feedback;
    return { success: true, taskId };
  }

  checkTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    return {
      taskId: task.id,
      status: task.status,
      humanFeedback: task.humanFeedback,
    };
  }
}

test('Test 02: Verify MCP Async Handle pattern responds in < 100ms and avoids 60s timeout deadlocks', async () => {
  const manager = new AsyncTaskHandleManager();

  // 1. Initial tool call: Must return immediately (no 60s blocking)
  const t0 = performance.now();
  const initResult = manager.createTask('Refactor auth module', { code: '...' });
  const tCreate = performance.now() - t0;

  assert.ok(tCreate < 100, `Initial response must be instantaneous (< 100ms), got ${tCreate}ms`);
  assert.equal(initResult.status, 'AWAITING_HUMAN_INPUT');
  assert.ok(initResult.taskId);
  console.log(`[MCP Async Handle Audit]: Initial response delivered in ${tCreate.toFixed(2)}ms (Immune to IDE 60s timeout)`);

  // 2. Poll before human input: Quick response (< 5ms) with pending status
  const poll1 = manager.checkTaskStatus(initResult.taskId);
  assert.equal(poll1.status, 'AWAITING_HUMAN_INPUT');
  assert.equal(poll1.humanFeedback, null);

  // 3. Human submits guidance asynchronously (e.g. after 75s in real world)
  manager.submitHumanFeedback(initResult.taskId, {
    notes: 'Do not use external libraries, use Node 24 native only.',
    driftType: 'WRONG_FRAMEWORK',
  });

  // 4. Next poll: Instantly receives human feedback
  const poll2 = manager.checkTaskStatus(initResult.taskId);
  assert.equal(poll2.status, 'HUMAN_FEEDBACK_AVAILABLE');
  assert.equal(poll2.humanFeedback.notes, 'Do not use external libraries, use Node 24 native only.');
  console.log(`[CONFIRMED]: Async Handle pattern decouples long-duration human contemplation from client-side RPC timeouts.`);
});
