'use strict';

/**
 * MCP 异步任务句柄模式管理器 (Async Task Handle Manager)
 * 彻底破除 Stdio 挂起 60 秒触发 IDE 客户端 -32001 Request timed out 崩溃死锁的问题
 */

const fs = require('node:fs');
const path = require('node:path');

class AsyncTaskHandleManager {
  constructor(options = {}) {
    this.tasks = new Map();
    this.defaultAutonomousTimeoutMs = options.defaultAutonomousTimeoutMs || 300000; // 5分钟自主超时
    this.storageDir = options.storageDir || null;
    if (!this.storageDir) {
      try {
        const { loadConfig } = require('./runtime-config');
        this.storageDir = path.join(loadConfig().runtimeRoot, '.runtime', 'tasks');
      } catch {
        this.storageDir = null;
      }
    }
    if (this.storageDir) {
      try { fs.mkdirSync(this.storageDir, { recursive: true }); } catch {}
    }
  }

  _persist(task) {
    if (!this.storageDir) return;
    try {
      const file = path.join(this.storageDir, `${task.id}.json`);
      fs.writeFileSync(file, JSON.stringify(task, null, 2), 'utf8');
    } catch {}
  }

  _loadFromDisk(taskId) {
    if (!this.storageDir) return null;
    try {
      const file = path.join(this.storageDir, `${taskId}.json`);
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.tasks.set(taskId, data);
        return data;
      }
    } catch {}
    return null;
  }

  /**
   * 立即分配任务句柄并在 1ms 内返回给 IDE 客户端，防止 Stdio 管道阻塞超时
   */
  createTask(prompt, context = {}) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const initialStatus = context.status || (context.surface === 'work' ? 'ACCEPTED' : 'AWAITING_HUMAN_INPUT');
    const taskRecord = {
      id: taskId,
      prompt,
      context,
      status: initialStatus,
      createdAt: Date.now(),
      humanFeedback: null,
      resultMarkdown: null,
      metadata: null
    };
    this.tasks.set(taskId, taskRecord);
    this._persist(taskRecord);

    return {
      status: initialStatus,
      taskId,
      guiUrl: `http://127.0.0.1:3900/arbitration/${taskId}`,
      message: initialStatus === 'ACCEPTED' 
        ? 'Task accepted and scheduled. Use check_task or fetch_result to retrieve progress/results.' 
        : 'Execution suspended for human review. Agent should poll check_task_status without blocking stdio.',
    };
  }

  /**
   * 获取指定任务记录 (优先从内存，次级从磁盘)
   */
  getTask(taskId) {
    const disk = this._loadFromDisk(taskId);
    if (disk) {
      this.tasks.set(taskId, disk);
      return disk;
    }
    return this.tasks.get(taskId) || null;
  }

  /**
   * 完成任务并记录结果正文与元数据
   */
  completeTask(taskId, result = {}) {
    let task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'COMPLETED';
    task.resultMarkdown = result.resultMarkdown || result.text || '';
    task.metadata = result.metadata || {};
    task.completedAt = Date.now();
    this.tasks.set(taskId, task);
    this._persist(task);
    return { success: true, taskId, status: 'COMPLETED' };
  }

  /**
   * 外部 GUI 面板或人类架构师提交纠偏指引
   */
  submitHumanFeedback(taskId, feedback) {
    let task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'HUMAN_FEEDBACK_AVAILABLE';
    task.humanFeedback = feedback;
    task.resolvedAt = Date.now();
    this.tasks.set(taskId, task);
    this._persist(task);
    return { success: true, taskId };
  }

  /**
   * Agent 定期轮询（耗时 < 1ms），获取当前任务是处于等待中还是已有反馈
   */
  checkTaskStatus(taskId) {
    let task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // 检查是否已达到自主推演超时
    const now = Date.now();
    if (task.status === 'AWAITING_HUMAN_INPUT' && (now - task.createdAt) > this.defaultAutonomousTimeoutMs) {
      task.status = 'AUTONOMOUS_FALLBACK';
      task.humanFeedback = {
        notes: 'Autonomous fallback: Human review exceeded timeout. Proceeding with safe read-only analysis.',
      };
      this.tasks.set(taskId, task);
      this._persist(task);
    }

    return {
      taskId: task.id,
      status: task.status,
      humanFeedback: task.humanFeedback,
      resultMarkdown: task.resultMarkdown,
      metadata: task.metadata,
      createdAt: task.createdAt,
      completedAt: task.completedAt || null
    };
  }
}

module.exports = {
  AsyncTaskHandleManager,
};
