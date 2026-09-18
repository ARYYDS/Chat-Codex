const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./runtime-config');

function getTasksFilePath() {
    const runsRoot = loadConfig().runsRoot;
    return path.join(runsRoot, 'mcp_tasks.json');
}

function loadTasksStore() {
    const p = getTasksFilePath();
    if (!fs.existsSync(p)) return {};
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (_) {
        return {};
    }
}

function saveTasksStore(store) {
    const p = getTasksFilePath();
    try {
        const dir = path.dirname(p);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
    } catch (_) {}
}

function generateTaskId() {
    const prefix = 'task_' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const rand = crypto.randomBytes(4).toString('hex');
    return `${prefix}_${rand}`;
}

function createTask({ title, prompt, surface = 'chat', effort = 'high', clientTimeoutSec = 60, status = 'ACCEPTED' }) {
    const taskId = generateTaskId();
    const store = loadTasksStore();
    const task = {
        taskId,
        resultType: 'task',
        status,
        title: title || (prompt ? prompt.slice(0, 50) : 'Untitled Task'),
        prompt,
        surface,
        effort,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimatedWaitSec: surface === 'work' ? 120 : 45,
        clientTimeoutSec,
        progress: {
            stage: 'ACCEPTED',
            chars: 0,
            elapsedSec: 0
        },
        result: null
    };
    store[taskId] = task;
    saveTasksStore(store);
    return task;
}

function updateTask(taskId, patch) {
    const store = loadTasksStore();
    if (!store[taskId]) return null;
    store[taskId] = {
        ...store[taskId],
        ...patch,
        updatedAt: new Date().toISOString()
    };
    saveTasksStore(store);
    return store[taskId];
}

function completeTask(taskId, resultData) {
    return updateTask(taskId, {
        status: 'COMPLETED',
        'progress.stage': 'COMPLETED',
        completedAt: new Date().toISOString(),
        result: resultData
    });
}

function failTask(taskId, errorMsg) {
    return updateTask(taskId, {
        status: 'FAILED',
        'progress.stage': 'FAILED',
        error: errorMsg,
        failedAt: new Date().toISOString()
    });
}

function getTask(taskId) {
    const store = loadTasksStore();
    return store[taskId] || null;
}

function listTasks() {
    const store = loadTasksStore();
    return Object.values(store).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
    createTask,
    updateTask,
    completeTask,
    failTask,
    getTask,
    listTasks
};
