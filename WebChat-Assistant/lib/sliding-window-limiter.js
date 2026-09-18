class SlidingWindowLimiter {
    constructor(options = {}) {
        this.chatLimit = options.chatLimit || 2;
        this.workLimit = options.workLimit || 1;
        this.chatQueueMax = options.chatQueueMax || 20;
        this.workQueueMax = options.workQueueMax || 8;
        this.chatTimeoutMs = options.chatTimeoutMs || 60000;
        this.workTimeoutMs = options.workTimeoutMs || 1200000; // 20 min

        this.chatRunning = new Map();
        this.workRunning = new Map();

        this.chatQueue = [];
        this.workQueue = [];

        this.onStateChange = options.onStateChange || null;
    }

    tryAcquire(taskId, type = 'chat', metadata = {}) {
        const normalizedType = type.toLowerCase() === 'work' ? 'work' : 'chat';
        const runningMap = normalizedType === 'work' ? this.workRunning : this.chatRunning;
        const limit = normalizedType === 'work' ? this.workLimit : this.chatLimit;

        if (runningMap.size < limit) {
            const entry = {
                taskId,
                type: normalizedType,
                state: 'RESERVED',
                acquiredAt: Date.now(),
                metadata
            };
            runningMap.set(taskId, entry);
            this._notify();
            return { acquired: true, slot: entry };
        }

        const queue = normalizedType === 'work' ? this.workQueue : this.chatQueue;
        const queueMax = normalizedType === 'work' ? this.workQueueMax : this.chatQueueMax;

        if (queue.length >= queueMax) {
            return {
                acquired: false,
                rejected: true,
                reason: `Queue overflow for ${normalizedType} track (max: ${queueMax})`
            };
        }

        return {
            acquired: false,
            rejected: false,
            queued: true,
            queuePosition: queue.length + 1
        };
    }

    acquireAsync(taskId, type = 'chat', metadata = {}) {
        const direct = this.tryAcquire(taskId, type, metadata);
        if (direct.acquired) return Promise.resolve(direct.slot);
        if (direct.rejected) return Promise.reject(new Error(direct.reason));

        const normalizedType = type.toLowerCase() === 'work' ? 'work' : 'chat';
        const queue = normalizedType === 'work' ? this.workQueue : this.chatQueue;
        const timeoutMs = normalizedType === 'work' ? this.workTimeoutMs : this.chatTimeoutMs;

        return new Promise((resolve, reject) => {
            const queueItem = {
                taskId,
                type: normalizedType,
                metadata,
                resolve,
                reject,
                enqueuedAt: Date.now(),
                timer: null
            };

            queueItem.timer = setTimeout(() => {
                const idx = queue.indexOf(queueItem);
                if (idx !== -1) queue.splice(idx, 1);
                reject(new Error(`Slot acquire timeout after ${timeoutMs}ms for task ${taskId}`));
                this._notify();
            }, timeoutMs);

            queue.push(queueItem);
            this._notify();
        });
    }

    setTaskState(taskId, state) {
        let entry = this.chatRunning.get(taskId) || this.workRunning.get(taskId);
        if (entry) {
            entry.state = state;
            entry.lastUpdated = Date.now();
            this._notify();
        }
    }

    releaseSlot(taskId) {
        let normalizedType = null;
        if (this.chatRunning.has(taskId)) {
            this.chatRunning.delete(taskId);
            normalizedType = 'chat';
        } else if (this.workRunning.has(taskId)) {
            this.workRunning.delete(taskId);
            normalizedType = 'work';
        }

        if (normalizedType) {
            this._pumpQueue(normalizedType);
            this._notify();
            return true;
        }
        return false;
    }

    forceStop(taskId) {
        // Check running maps
        if (this.chatRunning.has(taskId)) {
            const entry = this.chatRunning.get(taskId);
            entry.state = 'FORCE_STOPPED';
            this.releaseSlot(taskId);
            return { stopped: true, wasRunning: true, type: 'chat' };
        }
        if (this.workRunning.has(taskId)) {
            const entry = this.workRunning.get(taskId);
            entry.state = 'FORCE_STOPPED';
            this.releaseSlot(taskId);
            return { stopped: true, wasRunning: true, type: 'work' };
        }

        // Check queues
        for (let i = 0; i < this.chatQueue.length; i++) {
            if (this.chatQueue[i].taskId === taskId) {
                const [item] = this.chatQueue.splice(i, 1);
                clearTimeout(item.timer);
                item.reject(new Error('Task cancelled while queued (Force Stopped)'));
                this._notify();
                return { stopped: true, wasQueued: true, type: 'chat' };
            }
        }
        for (let i = 0; i < this.workQueue.length; i++) {
            if (this.workQueue[i].taskId === taskId) {
                const [item] = this.workQueue.splice(i, 1);
                clearTimeout(item.timer);
                item.reject(new Error('Task cancelled while queued (Force Stopped)'));
                this._notify();
                return { stopped: true, wasQueued: true, type: 'work' };
            }
        }

        return { stopped: false, notFound: true };
    }

    _pumpQueue(type) {
        const queue = type === 'work' ? this.workQueue : this.chatQueue;
        const runningMap = type === 'work' ? this.workRunning : this.chatRunning;
        const limit = type === 'work' ? this.workLimit : this.chatLimit;

        while (queue.length > 0 && runningMap.size < limit) {
            const item = queue.shift();
            clearTimeout(item.timer);
            const entry = {
                taskId: item.taskId,
                type,
                state: 'RESERVED',
                acquiredAt: Date.now(),
                metadata: item.metadata
            };
            runningMap.set(item.taskId, entry);
            item.resolve(entry);
        }
    }

    getStatus() {
        return {
            chat: {
                running: this.chatRunning.size,
                limit: this.chatLimit,
                queued: this.chatQueue.length,
                tasks: Array.from(this.chatRunning.values())
            },
            work: {
                running: this.workRunning.size,
                limit: this.workLimit,
                queued: this.workQueue.length,
                tasks: Array.from(this.workRunning.values())
            },
            totalInFlight: this.chatRunning.size + this.workRunning.size,
            totalQueued: this.chatQueue.length + this.workQueue.length
        };
    }

    _notify() {
        if (typeof this.onStateChange === 'function') {
            try { this.onStateChange(this.getStatus()); } catch (_) {}
        }
    }
}

module.exports = { SlidingWindowLimiter };
