const activeOdo = new Odometer('active-tasks');
const completedOdo = new Odometer('completed-tasks');
const tokensOdo = new Odometer('total-tokens');

function initEvents() {
    const sse = new EventSource('/api/events');

    sse.addEventListener('telemetry', (e) => {
        try {
            const data = JSON.parse(e.data);
            activeOdo.setValue(data.activeTasks || 0);
            completedOdo.setValue(data.completedTasks || 0);
            if (data.tasks) {
                renderTasksTable(data.tasks);
            }
        } catch (_) {}
    });

    sse.onerror = () => {
        // Fallback polling
        setTimeout(pollStatus, 3000);
    };
}

async function pollStatus() {
    try {
        const [statusRes, tasksRes, telemetryRes] = await Promise.all([
            fetch('/api/status').then(r => r.json()),
            fetch('/api/tasks').then(r => r.json()),
            fetch('/api/telemetry').then(r => r.json())
        ]);

        updateStatusBadges(statusRes);
        activeOdo.setValue(telemetryRes.activeTasks || 0);
        completedOdo.setValue(telemetryRes.completedTasks || 0);
        tokensOdo.setValue(telemetryRes.totalTokens || 0);
        renderTasksTable(tasksRes);
    } catch (_) {}
}

function updateStatusBadges(status) {
    const masterBadge = document.getElementById('master-badge');
    const workerBadge = document.getElementById('worker-badge');

    if (status.master?.connected) {
        masterBadge.className = 'badge badge-green';
        masterBadge.textContent = status.master.hasSessionToken ? 'Master: 9225 登录有效' : 'Master: 9225 未登录';
    } else {
        masterBadge.className = 'badge badge-red';
        masterBadge.textContent = 'Master: 9225 离线';
    }

    if (status.worker?.connected) {
        workerBadge.className = 'badge badge-green';
        workerBadge.textContent = 'Worker: 9222 在线';
    } else {
        workerBadge.className = 'badge badge-red';
        workerBadge.textContent = 'Worker: 9222 离线';
    }
}

function renderTasksTable(tasks) {
    const tbody = document.getElementById('task-table-body');
    if (!tasks || tasks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--text-muted);">暂无执行任务</td></tr>';
        return;
    }

    tbody.innerHTML = tasks.map(t => {
        const isRunning = t.status === 'RUNNING' || t.status === 'ACCEPTED';
        const isCompleted = t.status === 'COMPLETED';
        const stage = t.progress?.stage || t.status;

        let statusClass = 'badge-blue';
        if (t.status === 'COMPLETED') statusClass = 'badge-green';
        if (t.status === 'FAILED') statusClass = 'badge-red';

        let actionBtn = '';
        if (isRunning) {
            actionBtn = `<button class="stop-btn" onclick="stopTask('${t.taskId}')">🛑 强制停止</button>`;
        } else if (isCompleted) {
            actionBtn = `<button class="view-btn" onclick="openReport('${t.taskId}')">📄 查阅研报</button>`;
        }

        const totalTok = t.result?.tokens?.totalTokens || (t.tokens?.totalTokens) || '-';

        return `
            <tr>
                <td style="font-family: var(--font-mono); font-size: 0.8rem;">${t.taskId}</td>
                <td><strong>${t.title || 'Untitled'}</strong></td>
                <td><span class="badge badge-blue">${t.surface || 'work'}</span></td>
                <td><span class="badge ${statusClass}">${stage}</span></td>
                <td>${t.progress?.elapsedSec || t.durationSec || 0}s</td>
                <td style="font-family: var(--font-mono);">${totalTok}</td>
                <td>${actionBtn}</td>
            </tr>
        `;
    }).join('');
}

async function stopTask(taskId) {
    if (!confirm(`确定强制停止任务 ${taskId} 吗？`)) return;
    try {
        const res = await fetch(`/api/tasks/${taskId}/stop`, { method: 'POST' }).then(r => r.json());
        alert(`已发送强制停止信号！(物理按钮点击: ${res.physicalStopClicked ? '成功' : '已在后台标记中断'})`);
        pollStatus();
    } catch (e) {
        alert(`停止失败: ${e.message}`);
    }
}

async function openReport(taskId) {
    try {
        const data = await fetch(`/api/tasks/${taskId}/report`).then(r => r.json());
        document.getElementById('drawer-title').textContent = data.title;
        document.getElementById('drawer-subtitle').textContent = taskId;

        const body = document.getElementById('drawer-body');
        body.innerHTML = `<pre>${escapeHtml(data.markdown)}</pre>`;

        const vscodeBtn = document.getElementById('drawer-vscode-btn');
        if (data.archivePath) {
            vscodeBtn.style.display = 'inline-flex';
            vscodeBtn.onclick = () => {
                window.location.href = `vscode://file/${encodeURI(data.archivePath)}`;
            };
        } else {
            vscodeBtn.style.display = 'none';
        }

        document.getElementById('drawer').classList.add('open');
    } catch (e) {
        alert(`读取研报失败: ${e.message}`);
    }
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
}

function openDispatchModal() {
    document.getElementById('dispatch-modal').classList.add('active');
}

function closeDispatchModal() {
    document.getElementById('dispatch-modal').classList.remove('active');
}

async function submitDispatch() {
    const prompt = document.getElementById('dispatch-prompt').value.trim();
    if (!prompt) return alert('请输入任务提示词');
    const surface = document.getElementById('dispatch-surface').value;

    try {
        const res = await fetch('/api/tasks/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, surface })
        }).then(r => r.json());

        closeDispatchModal();
        document.getElementById('dispatch-prompt').value = '';
        pollStatus();
    } catch (e) {
        alert(`派发失败: ${e.message}`);
    }
}

async function syncCookies() {
    try {
        const res = await fetch('/api/master/sync', { method: 'POST' }).then(r => r.json());
        alert(`凭据同步完成！检测到母版 ${res.masterStatus?.totalCookies} 枚 Cookie`);
        pollStatus();
    } catch (e) {
        alert(`同步异常: ${e.message}`);
    }
}

function escapeHtml(text) {
    return (text || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    pollStatus();
});
