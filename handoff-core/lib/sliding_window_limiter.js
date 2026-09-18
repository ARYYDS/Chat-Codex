'use strict';
const EventEmitter = require('node:events');

/**
 * SlidingWindowLimiter
 * 
 * 双轨滑动窗口流控器 (Dual-Track Sliding Window Limiter)
 * 专为 Chat 与 Work 双表面并发设计：
 * 1. 独立有界队列与配额隔离 (Chat 2~4 slots, Work 1~2 slots)
 * 2. All-or-Nothing 原子槽位申请，杜绝队头阻塞
 * 3. 全生命周期在途锁定 (RESERVED -> RUNNING -> PERSISTING -> ACKNOWLEDGED)
 * 4. 队列 TTL 超时与背压拒绝机制
 */
class SlidingWindowLimiter extends EventEmitter {
  constructor(options = {}) {
    super();

    // 动态配额配置：优先读取传入配置，缺省根据集群规模自适应
    const workersCount = Number.isInteger(options.workersCount) && options.workersCount > 0 
      ? options.workersCount 
      : 2;

    this.slots = {
      work: Number.isInteger(options.workSlots) ? options.workSlots : Math.max(1, Math.floor(workersCount / 2)),
      chat: Number.isInteger(options.chatSlots) ? options.chatSlots : Math.max(2, workersCount * 2)
    };

    this.totalSlots = Number.isInteger(options.totalSlots) 
      ? options.totalSlots 
      : (this.slots.work + this.slots.chat);

    this.capacity = {
      work: Number.isInteger(options.workCapacity) ? options.workCapacity : 8,
      chat: Number.isInteger(options.chatCapacity) ? options.chatCapacity : 20
    };

    this.queueTimeoutMs = {
      work: options.workTimeoutMs || (20 * 60 * 1000), // Work 允许等待 20 分钟
      chat: options.chatTimeoutMs || (60 * 1000)        // Chat 等待 60 秒超时
    };

    // 双轨有界等待队列
    this.queues = {
      work: [],
      chat: []
    };

    // 严密在途任务注册表 (taskId -> taskRecord)
    this.inFlightTasks = new Map();

    // 历史累计交付统计
    this.metrics = {
      totalAcquired: 0,
      totalReleased: 0,
      totalTimedOut: 0,
      totalRejected: 0
    };
  }

  /**
   * 检查指定模式当前在途任务数
   */
  getInFlightCount(mode) {
    if (!mode) return this.inFlightTasks.size;
    let count = 0;
    for (const task of this.inFlightTasks.values()) {
      if (task.mode === mode) count++;
    }
    return count;
  }

  /**
   * 核心方法：All-or-Nothing 原子槽位申请
   * @param {Object} params
   * @param {'chat'|'work'} params.mode 任务表面类型
   * @param {string} params.taskId 唯一任务标识
   * @param {number} [params.timeoutMs] 自定义等待超时
   * @param {Object} [params.meta] 附加元数据
   * @returns {Promise<{ slotId: string, mode: string, taskId: string }>}
   */
  acquireSlot({ mode = 'chat', taskId, timeoutMs, meta = {} }) {
    return new Promise((resolve, reject) => {
      const surfaceMode = mode.toLowerCase() === 'work' ? 'work' : 'chat';
      const actualTaskId = taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timeout = timeoutMs || this.queueTimeoutMs[surfaceMode];

      // 1. 检查是否重复申请
      if (this.inFlightTasks.has(actualTaskId)) {
        return reject(new Error(`ERR_DUPLICATE_TASK: Task ${actualTaskId} is already in-flight`));
      }

      // 2. 尝试立即分配 (All-or-Nothing 准则：模式槽位未满 且 全局总并发未满)
      if (this._canAllocate(surfaceMode)) {
        const slotRecord = this._allocate(surfaceMode, actualTaskId, meta);
        this.emit('acquired', slotRecord);
        return resolve({ slotId: actualTaskId, mode: surfaceMode, taskId: actualTaskId });
      }

      // 3. 模式槽位已满，检查队列背压上限
      const queue = this.queues[surfaceMode];
      if (queue.length >= this.capacity[surfaceMode]) {
        this.metrics.totalRejected++;
        this.emit('rejected', { taskId: actualTaskId, mode: surfaceMode, reason: 'QUEUE_FULL' });
        return reject(new Error(`ERR_QUEUE_FULL: Queue for mode "${surfaceMode}" is at capacity (${this.capacity[surfaceMode]})`));
      }

      // 4. 入队等待，设置 TTL 超时看门狗
      let timer = null;
      const queueEntry = {
        taskId: actualTaskId,
        mode: surfaceMode,
        enqueuedAt: Date.now(),
        timeoutMs: timeout,
        meta,
        resolve: (slot) => {
          if (timer) clearTimeout(timer);
          resolve(slot);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        }
      };

      if (timeout > 0 && Number.isFinite(timeout)) {
        timer = setTimeout(() => {
          // 从队列中剔除
          const idx = queue.findIndex(item => item.taskId === actualTaskId);
          if (idx !== -1) {
            queue.splice(idx, 1);
            this.metrics.totalTimedOut++;
            this.emit('timeout', { taskId: actualTaskId, mode: surfaceMode });
            queueEntry.reject(new Error(`ERR_QUEUE_TIMEOUT: Task ${actualTaskId} waiting timed out after ${timeout}ms in "${surfaceMode}" queue`));
          }
        }, timeout);
      }

      queueEntry.timer = timer;
      queue.push(queueEntry);
      this.emit('enqueued', { taskId: actualTaskId, mode: surfaceMode, queueLength: queue.length });
    });
  }

  /**
   * 状态机推进：更新在途任务状态
   * 状态流：RESERVED -> DISPATCHED -> THINKING -> STREAMING -> PERSISTING -> ACKNOWLEDGED
   */
  updateTaskState(taskId, state, meta = {}) {
    const task = this.inFlightTasks.get(taskId);
    if (!task) return false;
    task.state = state;
    task.updatedAt = Date.now();
    if (meta && typeof meta === 'object') {
      Object.assign(task.meta, meta);
    }
    this.emit('taskStateChanged', { taskId, state, meta: task.meta });
    return true;
  }

  /**
   * 确认并释放槽位 (ACK and Release)
   * 严格要求：只有 Markdown 研报落盘、Outputs 附件校验完成并关闭临时 Tab 后才调用
   */
  ackAndRelease(taskId, result = null) {
    return this._release(taskId, 'ACKNOWLEDGED', result);
  }

  /**
   * 异常或主动放弃时释放槽位
   */
  releaseSlot(taskId, reason = 'ABORTED', error = null) {
    return this._release(taskId, reason, null, error);
  }

  /**
   * 针对单任务的强制停止 (Force Stop)
   */
  forceStop(taskId) {
    // 1. 如果还在排队中，直接从队列剔除并拒绝
    for (const mode of ['work', 'chat']) {
      const q = this.queues[mode];
      const idx = q.findIndex(item => item.taskId === taskId);
      if (idx !== -1) {
        const [entry] = q.splice(idx, 1);
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(`ERR_TASK_FORCE_STOPPED: Task ${taskId} cancelled before execution`));
        this.emit('forceStopped', { taskId, mode, inQueue: true });
        return { success: true, wasQueued: true };
      }
    }

    // 2. 如果已在运行中，标记为 STOPPING 并通知外部执行物理 CDP stop-button 点击
    const task = this.inFlightTasks.get(taskId);
    if (task) {
      task.state = 'STOPPING';
      task.stoppingRequestedAt = Date.now();
      this.emit('forceStopped', { taskId, mode: task.mode, inFlight: true, task });
      return { success: true, wasInFlight: true, task };
    }

    return { success: false, reason: 'TASK_NOT_FOUND' };
  }

  /**
   * 内部槽位分配
   */
  _canAllocate(mode) {
    const currentModeInFlight = this.getInFlightCount(mode);
    const totalInFlight = this.inFlightTasks.size;
    return (currentModeInFlight < this.slots[mode]) && (totalInFlight < this.totalSlots);
  }

  _allocate(mode, taskId, meta = {}) {
    const record = {
      taskId,
      mode,
      state: 'RESERVED',
      acquiredAt: Date.now(),
      updatedAt: Date.now(),
      meta: { ...meta }
    };
    this.inFlightTasks.set(taskId, record);
    this.metrics.totalAcquired++;
    return record;
  }

  /**
   * 内部释放并触发滑动窗口推进 (_drain)
   */
  _release(taskId, finalState, result = null, error = null) {
    const task = this.inFlightTasks.get(taskId);
    if (!task) return { released: false, reason: 'NOT_IN_FLIGHT' };

    const durationMs = Date.now() - task.acquiredAt;
    this.inFlightTasks.delete(taskId);
    this.metrics.totalReleased++;

    const eventPayload = {
      taskId,
      mode: task.mode,
      finalState,
      durationMs,
      result,
      error
    };

    this.emit('released', eventPayload);

    // 滑动窗口推进：唤醒下一个符合条件的等待者
    this._drain();

    return { released: true, ...eventPayload };
  }

  /**
   * 排队排空器 (Drain Loop)：遵循配额隔离与公平调度
   */
  _drain() {
    // 优先满足 Work 队列还是 Chat 队列？
    // 检查各自配额：Work 有空槽则调度 Work，Chat 有空槽则调度 Chat，互不干扰
    for (const mode of ['chat', 'work']) {
      const q = this.queues[mode];
      while (q.length > 0 && this._canAllocate(mode)) {
        const nextEntry = q.shift();
        if (nextEntry.timer) clearTimeout(nextEntry.timer);

        const slotRecord = this._allocate(mode, nextEntry.taskId, nextEntry.meta);
        this.emit('acquired', slotRecord);
        nextEntry.resolve({ slotId: nextEntry.taskId, mode, taskId: nextEntry.taskId });
      }
    }
  }

  /**
   * 获取流控器实时遥测大盘
   */
  getStatus() {
    const chatInFlight = this.getInFlightCount('chat');
    const workInFlight = this.getInFlightCount('work');

    const inFlightList = Array.from(this.inFlightTasks.values()).map(t => ({
      taskId: t.taskId,
      mode: t.mode,
      state: t.state,
      durationSec: Math.floor((Date.now() - t.acquiredAt) / 1000),
      meta: t.meta
    }));

    const queuedList = [
      ...this.queues.chat.map(q => ({ taskId: q.taskId, mode: 'chat', waitSec: Math.floor((Date.now() - q.enqueuedAt) / 1000) })),
      ...this.queues.work.map(q => ({ taskId: q.taskId, mode: 'work', waitSec: Math.floor((Date.now() - q.enqueuedAt) / 1000) }))
    ];

    return {
      chat: {
        inFlight: chatInFlight,
        slots: this.slots.chat,
        queued: this.queues.chat.length,
        capacity: this.capacity.chat
      },
      work: {
        inFlight: workInFlight,
        slots: this.slots.work,
        queued: this.queues.work.length,
        capacity: this.capacity.work
      },
      total: {
        inFlight: this.inFlightTasks.size,
        limit: this.totalSlots
      },
      metrics: { ...this.metrics },
      inFlightTasks: inFlightList,
      queuedTasks: queuedList
    };
  }

  /**
   * 销毁清理所有挂起的定时器
   */
  clear() {
    for (const mode of ['work', 'chat']) {
      while (this.queues[mode].length > 0) {
        const item = this.queues[mode].shift();
        if (item.timer) clearTimeout(item.timer);
        item.reject(new Error('ERR_LIMITER_CLOSED: Limiter cleared'));
      }
    }
    this.inFlightTasks.clear();
  }
}

module.exports = { SlidingWindowLimiter };
