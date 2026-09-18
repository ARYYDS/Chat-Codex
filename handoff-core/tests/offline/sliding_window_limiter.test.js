'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SlidingWindowLimiter } = require('../../lib/sliding_window_limiter');

test('sliding_window_limiter: dual-track quota isolation ensures Work does not block Chat', async () => {
  const limiter = new SlidingWindowLimiter({
    workSlots: 1,
    chatSlots: 2,
    totalSlots: 3,
    workCapacity: 4,
    chatCapacity: 10
  });

  // 1. Work 申请占满其唯一种子槽位 (1/1)
  const workSlot1 = await limiter.acquireSlot({ mode: 'work', taskId: 'work-1' });
  assert.equal(workSlot1.taskId, 'work-1');
  assert.equal(workSlot1.mode, 'work');
  assert.equal(limiter.getInFlightCount('work'), 1);

  // 2. 验证：此时 Work 槽位已满，但 Chat 仍有两个空槽位，应可零延迟立即获取
  const chatSlot1 = await limiter.acquireSlot({ mode: 'chat', taskId: 'chat-1' });
  assert.equal(chatSlot1.taskId, 'chat-1');
  assert.equal(limiter.getInFlightCount('chat'), 1);

  const chatSlot2 = await limiter.acquireSlot({ mode: 'chat', taskId: 'chat-2' });
  assert.equal(chatSlot2.taskId, 'chat-2');
  assert.equal(limiter.getInFlightCount('chat'), 2);

  // 此时总并发 3 (1 work + 2 chat) 达到上限
  assert.equal(limiter.getStatus().total.inFlight, 3);

  // 释放一个 chat 槽位
  limiter.ackAndRelease('chat-1');
  assert.equal(limiter.getInFlightCount('chat'), 1);
  assert.equal(limiter.getInFlightCount('work'), 1);

  limiter.clear();
});

test('sliding_window_limiter: queue backpressure rejects tasks when capacity is exceeded', async () => {
  const limiter = new SlidingWindowLimiter({
    workSlots: 1,
    chatSlots: 1,
    workCapacity: 1,
    chatCapacity: 1
  });

  // 占满 work 槽位
  await limiter.acquireSlot({ mode: 'work', taskId: 'work-running' });

  // 1 个任务进入排队 (队列容量 1)
  let queuedResolved = false;
  const queuedPromise = limiter.acquireSlot({ mode: 'work', taskId: 'work-queued' }).then(() => {
    queuedResolved = true;
  });

  assert.equal(limiter.getStatus().work.queued, 1);

  // 第 2 个排队任务尝试入队，应被背压立即拒绝 (ERR_QUEUE_FULL)
  await assert.rejects(
    () => limiter.acquireSlot({ mode: 'work', taskId: 'work-overflow' }),
    /ERR_QUEUE_FULL/
  );

  // 释放正在运行的 work 任务，排队中的任务应自动被唤醒并分配
  limiter.ackAndRelease('work-running');
  await queuedPromise;
  assert.equal(queuedResolved, true);
  assert.equal(limiter.getStatus().work.queued, 0);
  assert.equal(limiter.getInFlightCount('work'), 1);

  limiter.clear();
});

test('sliding_window_limiter: queue timeout watchdog rejects stalled waiting requests', async () => {
  const limiter = new SlidingWindowLimiter({
    workSlots: 1,
    chatSlots: 1,
    workCapacity: 5,
    chatCapacity: 5
  });

  await limiter.acquireSlot({ mode: 'chat', taskId: 'chat-active' });

  // 排队任务设置极短超时 (50ms)
  await assert.rejects(
    () => limiter.acquireSlot({ mode: 'chat', taskId: 'chat-timeout', timeoutMs: 50 }),
    /ERR_QUEUE_TIMEOUT/
  );

  assert.equal(limiter.getStatus().chat.queued, 0);
  limiter.clear();
});

test('sliding_window_limiter: in-flight lifecycle state tracking and forceStop', async () => {
  const limiter = new SlidingWindowLimiter({
    workSlots: 2,
    chatSlots: 2
  });

  await limiter.acquireSlot({ mode: 'work', taskId: 'task-lifecycle' });
  assert.equal(limiter.inFlightTasks.get('task-lifecycle').state, 'RESERVED');

  // 推进状态流
  limiter.updateTaskState('task-lifecycle', 'THINKING');
  assert.equal(limiter.inFlightTasks.get('task-lifecycle').state, 'THINKING');

  limiter.updateTaskState('task-lifecycle', 'STREAMING', { chars: 2500 });
  assert.equal(limiter.inFlightTasks.get('task-lifecycle').meta.chars, 2500);

  limiter.updateTaskState('task-lifecycle', 'PERSISTING');
  assert.equal(limiter.inFlightTasks.get('task-lifecycle').state, 'PERSISTING');

  // 单任务 forceStop 测试
  const stopRes = limiter.forceStop('task-lifecycle');
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.wasInFlight, true);
  assert.equal(limiter.inFlightTasks.get('task-lifecycle').state, 'STOPPING');

  // 终态 ACK 落盘与内存回收
  const ackRes = limiter.ackAndRelease('task-lifecycle', { path: 'results.md' });
  assert.equal(ackRes.released, true);
  assert.equal(limiter.getInFlightCount('work'), 0);

  limiter.clear();
});
